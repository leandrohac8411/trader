// server/src/index.js
// Back-end único do crypto-dashboard.
import express from "express";
import cors from "cors";
import morgan from "morgan";
import "dotenv/config";
import nodemailer from "nodemailer";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basicAuth, isLoopback, safeEqual } from "./auth.js";
import { configureFromEnv, withContext, hydrate, persist, withLock, isRedis } from "./services/datafs.js";

import {
  getGlobalMetrics,
  getListingsLatest,
  getNewListings,
  getCategories,
  getQuotesLatest,
} from "./services/cmc.js";
import { getEthGas } from "./services/eth.js";
import { getFearGreed } from "./services/fng.js";
import { getKlines, getTickers } from "./services/bybit.js";
import { analyzeCandles, higherTF } from "./services/strategy.js";
import { runBacktest, runGrid } from "./services/backtest.js";
import { chatLLM, AI_ENABLED, AI_MODEL } from "./services/ai.js";
import * as bot from "./services/bot.js";
import { getPositions as demoPositions, getEquity as demoEquity } from "./services/bybit-demo.js";
import { createOffice } from "./services/office.js";
import { createManager } from "./services/manager.js";

const app = express();
// Vercel (serverless): sem processo ligado; o bot roda quando /api/bot/tick é chamado
// (cron-job.org) e os dados ficam no Upstash Redis (services/datafs.js).
const SERVERLESS = process.env.VERCEL === "1";
const storage = configureFromEnv();
// Senha de acesso (HTTP Basic) para tudo menos /api/health. Obrigatória fora do loopback e no Vercel.
const APP_USER = process.env.APP_USER || "admin";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const TICK_SECRET = process.env.TICK_SECRET || "";
if (SERVERLESS) {
  // Falha fechado: sem senha ou sem banco, nada além do /api/health responde.
  app.use((req, res, next) => {
    if (req.path === "/api/health") return next();
    if (!APP_PASSWORD) return res.status(503).json({ error: "Defina APP_PASSWORD nas variáveis do projeto no Vercel." });
    if (!storage.redis) return res.status(503).json({ error: "Conecte o Upstash Redis ao projeto (Storage → Upstash)." });
    next();
  });
}
if (APP_PASSWORD) app.use(basicAuth({ user: APP_USER, password: APP_PASSWORD, open: ["/api/health", "/api/bot/tick"] }));
// Modo Redis: cada requisição carrega os dados no começo e grava o que mudou antes de responder.
// Dados públicos de mercado (velas, cotações) não tocam no banco: não gastam banda do Upstash.
const NO_STORAGE = { test: (path) => path.startsWith("/api/bybit/") };
app.use((req, res, next) => {
  if (!isRedis() || NO_STORAGE.test(req.path)) return next();
  withContext(async () => {
    try { await hydrate(); } catch { return res.status(503).json({ error: "Armazenamento indisponível agora." }); }
    const end = res.end.bind(res);
    let flushed = false;
    res.end = (...args) => {
      if (flushed) return end(...args);
      flushed = true;
      persist().catch((e) => console.error("persist falhou:", e.message)).finally(() => end(...args));
      return res;
    };
    next();
  });
});
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

const round = (n, p = 2) => Number(Number(n).toFixed(p));

// ───────────────────────────── alertas por e-mail ─────────────────────────────
const ALERT_CONSENSUS = Number(process.env.ALERT_CONSENSUS || 3); // votos (de 4)
const NOTIFY_TOKEN = process.env.NOTIFY_TOKEN || "";

const smtpEnabled =
  !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;

let transporter = null;
if (smtpEnabled) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
let lastEmailKey = null;
let lastEmailTs = 0;

// ─────────────────────────────── rotas simples ───────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    runtime: SERVERLESS ? "vercel" : "server",
    version: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
    storage: isRedis() ? "redis" : "files",
    ready: !SERVERLESS || (!!APP_PASSWORD && storage.redis && !!TICK_SECRET),
    time: new Date().toISOString(),
    ai: { enabled: AI_ENABLED, model: AI_ENABLED ? AI_MODEL : null },
    alerts: { smtpEnabled, ALERT_CONSENSUS },
  });
});

app.get("/api/cmc/global-metrics", async (_req, res) => {
  try {
    res.json({ data: await getGlobalMetrics() });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get(["/api/cmc/listings-latest", "/api/cmc/listings/latest"], async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "10", 10);
    const convert = req.query.convert || "USD";
    res.json({ data: await getListingsLatest({ limit, convert }) });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/cmc/new-listings", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "10", 10);
    res.json({ data: await getNewListings({ limit }) });
  } catch (e) {
    res.status(200).json({ data: [], warning: e.message || String(e) });
  }
});

app.get("/api/cmc/categories", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "20", 10);
    res.json({ data: await getCategories({ limit }) });
  } catch (e) {
    res.status(200).json({ data: [], warning: e.message || String(e) });
  }
});

app.get("/api/eth/gas", async (_req, res) => {
  try {
    const gas = await getEthGas();
    let usd = null;
    if (typeof gas.gwei === "number") {
      const quotes = await getQuotesLatest({ symbol: "ETH", convert: "USD" });
      const ethPrice = quotes?.ETH?.quote?.USD?.price ?? null;
      if (ethPrice) usd = ethPrice * (gas.gwei * 1e-9) * 21000;
    }
    res.json({
      data: {
        gwei: gas.gwei ?? null,
        usd: usd != null ? round(usd, 2) : null,
        source: gas.source,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    res.status(200).json({ data: { gwei: null, usd: null }, warning: e.message || String(e) });
  }
});

app.get("/api/fng", async (_req, res) => {
  try {
    res.json({ data: await getFearGreed() });
  } catch (e) {
    res
      .status(200)
      .json({ data: { value: null, classification: null }, warning: e.message || String(e) });
  }
});

// ───────────────────────────── Bybit klines (proxy) ─────────────────────────────
app.get("/api/bybit/kline", async (req, res) => {
  try {
    const symbol = (req.query.symbol || "BTCUSDT").toUpperCase();
    const interval = String(req.query.interval || "1");
    const category = req.query.category || "linear";
    const limit = Math.min(parseInt(req.query.limit || "200", 10), 1000);
    const candles = await getKlines({ symbol, interval, category, limit });
    res.json({ data: { symbol, interval, category, candles } });
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || String(e) });
  }
});

// Cotação 24h dos mercados acompanhados (faixa de preços e tabela do visual 2). Só dados públicos.
app.get("/api/bybit/tickers", async (req, res) => {
  try {
    const symbols = String(req.query.symbols || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT").toUpperCase().split(",").filter((s) => /^[A-Z0-9]{2,20}$/.test(s)).slice(0, 20);
    res.json({ data: await getTickers(symbols) });
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message || String(e) });
  }
});

// ───────────────────────────── estratégia (consenso) ─────────────────────────────
async function runStrategy(query, { signal:requestSignal } = {}) {
  const symbol = (query.symbol || "BTCUSDT").toUpperCase();
  const interval = String(query.interval || "5");
  const category = query.category || "linear";
  const limit = Math.min(parseInt(query.limit || "300", 10), 1000);
  const useHtf = String(query.htf ?? "1") !== "0";

  const candles = await getKlines({ symbol, interval, category, limit, signal:requestSignal });

  let htfCloses = null;
  if (useHtf) {
    try {
      const htf = await getKlines({
        symbol,
        interval: higherTF(interval),
        category,
        limit: 240,
        signal:requestSignal,
      });
      htfCloses = htf.map((c) => c.close);
    } catch {
      /* HTF é opcional */
    }
  }

  const result = analyzeCandles(candles, { htfCloses });
  return {
    symbol,
    interval,
    category,
    ...result,
    updatedAt: new Date().toISOString(),
  };
}

app.get("/api/strategy/analyze", async (req, res) => {
  try {
    res.json({ data: await runStrategy(req.query) });
  } catch (e) {
    const status = /Poucas velas/.test(e.message || "") ? 400 : 502;
    res.status(status).json({ error: e.message || String(e) });
  }
});

// ───────────────────────────── backtest ─────────────────────────────
const btCache = new Map(); // key -> { v, t }
const BT_TTL = 10 * 60_000;

async function btInputs(query) {
  const symbol = (query.symbol || "BTCUSDT").toUpperCase();
  const interval = String(query.interval || "60");
  const category = query.category || "linear";
  const bars = Math.min(parseInt(query.limit || query.bars || "1000", 10), 1000);
  const useHtf = String(query.htf ?? "1") !== "0";
  const candles = await getKlines({ symbol, interval, category, limit: bars });
  const htfCandles = useHtf
    ? await getKlines({ symbol, interval: higherTF(interval), category, limit: 1000 })
    : null;
  return { symbol, interval, category, bars, useHtf, candles, htfCandles };
}

async function cached(kind, query, fn) {
  const inputs = await btInputs(query);
  const { symbol, interval, category, bars, useHtf } = inputs;
  const key = `${kind}|${symbol}|${interval}|${category}|${bars}|${useHtf}`;
  const hit = btCache.get(key);
  if (hit && Date.now() - hit.t <= BT_TTL) return hit.v;
  const v = fn(inputs);
  btCache.set(key, { v, t: Date.now() });
  return v;
}

app.get("/api/backtest", async (req, res) => {
  try {
    const data = await cached("bt", req.query, ({ candles, htfCandles, symbol, interval }) =>
      runBacktest(candles, { htfCandles, meta: { symbol, interval } })
    );
    res.json({ data });
  } catch (e) {
    const status = /Poucas velas/.test(e.message || "") ? 400 : 502;
    res.status(status).json({ error: e.message || String(e) });
  }
});

app.get("/api/backtest/grid", async (req, res) => {
  try {
    const data = await cached("grid", req.query, ({ candles, htfCandles, symbol, interval }) =>
      runGrid(candles, { htfCandles, meta: { symbol, interval } })
    );
    res.json({ data });
  } catch (e) {
    const status = /Poucas velas/.test(e.message || "") ? 400 : 502;
    res.status(status).json({ error: e.message || String(e) });
  }
});

// ───────────────────────────── IA: comentário sobre os números ─────────────────────────────
function buildAnalysisMessages(payload, candles) {
  const tail = candles.slice(-10).map((c) => ({
    t: new Date(Number(c.ts)).toISOString().slice(11, 16),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
  }));

  const system =
    "Você é um analista técnico de cripto. Recebe indicadores JÁ CALCULADOS e o sinal " +
    "de uma estratégia de consenso. NÃO invente números nem recalcule nada: comente o que " +
    "os dados mostram, aponte riscos e diga o que invalidaria o cenário. Português, " +
    "objetivo, no máximo 6 frases. Não é recomendação de investimento.";

  const user = [
    `Símbolo: ${payload.symbol} | Timeframe: ${payload.interval}`,
    `Sinal (gate 85%): ${payload.signal} | Consenso bruto: ${payload.rawSignal} ${payload.consensus} | Probabilidade técnica: ${payload.probability}% | Viés de alta: ${payload.biasUp}% | Estágio: ${payload.stage}`,
    `Preço: ${payload.price}`,
    `Indicadores: ${JSON.stringify(payload.indicators)}`,
    `Níveis: ${JSON.stringify(payload.levels)}`,
    `Motivos: ${payload.reasons.join(" ")}`,
    `Últimas velas (OHLCV): ${JSON.stringify(tail)}`,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function runAiAnalyze(query) {
  const symbol = (query.symbol || "BTCUSDT").toUpperCase();
  const interval = String(query.interval || "60");
  const category = query.category || "linear";
  const limit = Math.min(parseInt(query.limit || "300", 10), 1000);

  const candles = await getKlines({ symbol, interval, category, limit });

  let htfCloses = null;
  try {
    const htf = await getKlines({ symbol, interval: higherTF(interval), category, limit: 240 });
    htfCloses = htf.map((c) => c.close);
  } catch {
    /* opcional */
  }

  const strat = analyzeCandles(candles, { htfCloses });
  const payload = { symbol, interval, category, ...strat, updatedAt: new Date().toISOString() };

  let ai = { provider: "disabled", text: "" };
  try {
    ai = await chatLLM({ messages: buildAnalysisMessages(payload, candles) });
  } catch (e) {
    ai = { provider: "error", text: "", error: e.message || String(e) };
  }
  return { data: payload, ai: { provider: ai.provider, text: ai.text, error: ai.error } };
}

app.get("/api/ai/analyze", async (req, res) => {
  try {
    res.json(await runAiAnalyze(req.query));
  } catch (e) {
    const status = /Poucas velas/.test(e.message || "") ? 400 : 502;
    res.status(status).json({ error: e.message || String(e) });
  }
});
app.post("/api/ai/analyze", async (req, res) => {
  try {
    res.json(await runAiAnalyze({ ...req.query, ...req.body }));
  } catch (e) {
    const status = /Poucas velas/.test(e.message || "") ? 400 : 502;
    res.status(status).json({ error: e.message || String(e) });
  }
});

// chat livre (mantido para não quebrar chamadas antigas do front)
app.post("/api/ai/chat", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ ok: false, error: "prompt é obrigatório" });
    const out = await chatLLM({
      messages: [
        { role: "system", content: "Você é um assistente de análise de cripto. Não é recomendação de investimento." },
        { role: "user", content: prompt },
      ],
    });
    res.json({ ok: true, provider: out.provider, text: out.text });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || String(e) });
  }
});

// ───────────────────────────── e-mail (opcional, protegido) ─────────────────────────────
app.post("/api/notify/email", async (req, res) => {
  try {
    if (!smtpEnabled) return res.status(400).json({ ok: false, error: "SMTP não configurado" });
    if (!NOTIFY_TOKEN) return res.status(403).json({ ok: false, error: "NOTIFY_TOKEN não configurado" });
    if (req.get("x-notify-token") !== NOTIFY_TOKEN)
      return res.status(401).json({ ok: false, error: "token inválido" });

    const { to, subject, text, html } = req.body || {};
    if (!to || !subject || !text)
      return res.status(400).json({ ok: false, error: "to, subject, text são obrigatórios" });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// ───────────────────────────── bot demo (forward-test) ─────────────────────────────
function botTokenOk(req) {
  return !bot.CFG.token || req.get("x-bot-token") === bot.CFG.token;
}

app.get("/api/bot/status", async (_req, res) => {
  if (!bot.CFG.enabled) return res.json({ enabled: false });
  try {
    const s = bot.loadState();
    const [equity, positions] = await Promise.all([demoEquity(), demoPositions()]);
    const dayStart = s.dayStartEquity || equity;
    res.json({
      enabled: true,
      paused: s.paused || false,
      equity: round(equity, 2),
      dayStartEquity: round(dayStart, 2),
      todayPnlPct: dayStart ? round(((equity - dayStart) / dayStart) * 100, 2) : 0,
      open: positions,
      config: {
        symbols: bot.CFG.symbols,
        timeframes: bot.CFG.timeframes,
        riskPct: bot.CFG.riskPct,
        minProb: bot.CFG.minProb, profile: bot.CFG.profile, rr1: bot.CFG.rr1, stMult: bot.CFG.stMult,
        dailyLossLimitPct: bot.CFG.dailyLossLimitPct,
        maxOpen: bot.CFG.maxOpen,
        maxNotionalPct: bot.CFG.maxNotionalPct,
        dryRun: bot.CFG.dryRun,
      },
    });
  } catch (e) {
    res.status(502).json({ enabled: true, error: e.message || String(e) });
  }
});

app.get("/api/bot/log", (req, res) => {
  if (!bot.CFG.enabled) return res.json({ enabled: false, events: [] });
  const limit = Math.min(parseInt(req.query.limit || "80", 10), 500);
  res.json({ enabled: true, events: bot.readEvents(limit).reverse() });
});

// "radar": estado ao vivo de tudo que o bot está de olho, pra nunca ficar no escuro
app.get("/api/bot/watch", async (_req, res) => {
  if (!bot.CFG.enabled) return res.json({ enabled: false, items: [] });
  try {
    const positions = await demoPositions();
    const bySymbol = Object.fromEntries(positions.map((p) => [p.symbol, p]));
    const items = [];
    for (const symbol of bot.CFG.symbols) {
      for (const tf of bot.CFG.timeframes) {
        try {
          const candles = await getKlines({ symbol, interval: tf, limit: 300 });
          let htfCloses = null;
          try {
            const h = await getKlines({ symbol, interval: higherTF(tf), limit: 300 });
            htfCloses = h.map((c) => c.close);
          } catch {
            /* opcional */
          }
          const a = analyzeCandles(candles, { htfCloses, ...bot.strategyParams() });
          items.push({
            symbol,
            tf,
            price: a.price,
            signal: a.signal,
            rawSignal: a.rawSignal,
            stage: a.stage,
            lean: a.lean,
            probability: a.probability,
            consensus: a.consensus,
            hasOpenPosition: !!bySymbol[symbol],
          });
        } catch (e) {
          items.push({ symbol, tf, error: e.message });
        }
      }
    }
    items.sort((x, y) => (y.probability ?? 0) - (x.probability ?? 0));
    res.json({ enabled: true, items });
  } catch (e) {
    res.status(502).json({ enabled: true, error: e.message || String(e) });
  }
});

app.get("/api/bot/trades", (req, res) => {
  if (!bot.CFG.enabled) return res.json({ enabled: false, trades: [] });
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
  res.json({ enabled: true, trades: bot.readTrades(limit).reverse() });
});

app.get("/api/bot/report", (_req, res) => {
  if (!bot.CFG.enabled) return res.json({ enabled: false });
  res.json({ enabled: true, live: bot.aggregateTrades(bot.readTrades(0)) });
});

app.post("/api/bot/pause", (req, res) => {
  if (!bot.CFG.enabled) return res.status(400).json({ error: "bot desligado" });
  if (!botTokenOk(req)) return res.status(401).json({ error: "token inválido" });
  res.json({ paused: bot.setPaused("manual") });
});

app.post("/api/bot/resume", (req, res) => {
  if (!bot.CFG.enabled) return res.status(400).json({ error: "bot desligado" });
  if (!botTokenOk(req)) return res.status(401).json({ error: "token inválido" });
  res.json({ paused: bot.setPaused(false) });
});

// Tick do bot (Vercel): chamado a cada poucos minutos pelo cron-job.org com a chave TICK_SECRET.
// Uma trava no Redis impede dois ticks ao mesmo tempo (= ordem duplicada).
app.all("/api/bot/tick", async (req, res) => {
  const key = req.get("x-tick-key") || String(req.query.key || "");
  if (!TICK_SECRET || !key || !safeEqual(key, TICK_SECRET)) return res.status(401).json({ error: "chave do tick inválida" });
  const out = await withLock("tick", 280, async () => {
    let b, o;
    try { b = await bot.tickOnce(); } catch { b = { failed: true }; }
    try { o = await office.cycle(); } catch { o = { failed: true }; }
    // Resumo mínimo: nada de logs/erros da corretora na resposta.
    const botSummary = b.failed ? { failed: true } : b.skipped ? { skipped: b.skipped } : b.paused ? { paused: b.paused } : { ok: true, open: b.open };
    return { bot: botSummary, office: o };
  });
  res.json(out.ran ? { ok: true, ...out.value } : { ok: false, busy: "outro tick em andamento" });
});

// Serverless: o site aberto pede uma leitura do radar quando os dados estão velhos.
// Só o radar (sem bot, sem escola); a trava evita leituras repetidas em paralelo.
app.post("/api/office/refresh", async (_req, res) => {
  if (!SERVERLESS) return res.json({ data: { skipped: "servidor com loop próprio" } });
  const out = await withLock("radar", 60, () => office.refreshRadar());
  res.json({ data: out.ran ? out.value : { busy: true } });
});

// Escritório: observação e pesquisa; nenhum comando de execução é exposto aqui.
const office = createOffice({
  bot, analyze: runStrategy, chat: chatLLM, aiEnabled: AI_ENABLED, serverless: SERVERLESS,
  // Gerente (Claude): parecer só leitura, sob demanda. Precisa de ANTHROPIC_API_KEY.
  manager: createManager({ dataDir: new URL('../data/', import.meta.url) }),
  // Saldo e posições da conta DEMO (bybit-demo.js só aceita api-demo.bybit.com).
  deskStatus: async () => {
    const s = bot.loadState();
    const [equity, positions] = await Promise.all([demoEquity(), demoPositions()]);
    return { equity: round(equity, 2), dayStartEquity: round(s.dayStartEquity || equity, 2), paused: s.paused || false,
      dryRun: bot.CFG.dryRun, positions: positions.map(p => ({ symbol: p.symbol, side: p.side, size: p.size, entry: p.entry,
        unrealisedPnl: round(p.unrealisedPnl, 2), markPrice: p.markPrice, stopLoss: p.stopLoss, takeProfit: p.takeProfit })) };
  },
  // Escola: 1.000 velas do período do aluno (1h ou 4h) + período maior alinhado pelo FECHAMENTO (sem lookahead).
  loadSchoolInputs: async (symbol, interval = '60') => {
    const inputs = await btInputs({ symbol, interval, limit: '1000', htf: '1' });
    const htfMs = bot.tfMinutes(higherTF(interval)) * 60_000;
    const shift = htfMs - bot.tfMinutes(interval) * 60_000;
    // Descarta a vela maior ainda em formação.
    return { candles: inputs.candles, htfCandles: inputs.htfCandles?.slice(0, -1).map(c => ({ ...c, ts: c.ts + shift })) };
  },
  backtest: async ({ symbol, interval }) => {
    const inputs = await btInputs({ symbol, interval, limit: '1000', htf: '1' });
    const ms = Number(interval) * 60_000;
    const htfMs = higherTF(interval) === 'D' ? 86_400_000 : Number(higherTF(interval)) * 60_000;
    const report = runBacktest(inputs.candles, {
      htfCandles: inputs.htfCandles?.map(c=>({ ...c, ts:c.ts+htfMs-ms })),
      singleTarget:true, meta:{ symbol, interval },
    });
    return { stats:report.trades, meta:report.meta,
      note:'Pesquisa em até 1.000 velas, com HTF fechado e saída integral no TP1. Não reproduz o bot intravela nem inclui funding.' };
  },
});
app.use('/api/office', office.router);

// Front-end compilado (imagem Docker copia client/dist para server/client/dist).
const CLIENT_DIST = process.env.CLIENT_DIST || fileURLToPath(new URL("../client/dist/", import.meta.url));
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: "index.html", maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile("index.html", { root: CLIENT_DIST }));
}

// 404 + handler de erro
app.use((_req, res) => res.status(404).json({ error: "not found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("Unhandled:", err);
  res.status(500).json({ error: err?.message || "internal error" });
});

// No Vercel não há servidor ligado: o app é exportado e roda a cada requisição.
if (!SERVERLESS) {
  const port = process.env.PORT || 4000;
  // Local by default; set HOST=0.0.0.0 only behind auth (e.g. container/Fly).
  const host = process.env.HOST || "127.0.0.1";
  if (!isLoopback(host) && !APP_PASSWORD) {
    // Fail closed: nunca expor escritório e rotas do bot sem senha.
    console.error(`Recusando iniciar em ${host} sem APP_PASSWORD. Defina APP_PASSWORD (fly secrets set APP_PASSWORD=...).`);
    process.exit(1);
  }
  const server = app.listen(port, host, () => {
    console.log(`Server on http://${host}:${port}`);
    office.start();
    bot.startBot();
  });
  const shutdown = () => { office.stop(); server.close(); server.closeIdleConnections(); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export default app;
export { app, runStrategy };
