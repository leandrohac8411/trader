// server/src/services/bot.js
// Worker de FORWARD-TEST na Bybit Demo Trading (dinheiro fake, preços reais).
// Roda junto com o servidor Express. Abre/fecha posições demo conforme a estratégia
// calibrada e registra cada trade fechado pra comparar com o backtest.

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "./datafs.js";
import { getKlines } from "./bybit.js";
import { analyzeCandles, higherTF } from "./strategy.js";
import * as demo from "./bybit-demo.js";
import { computeLadder } from "./game.js";
import { readPromotion } from "./school.js";
import { reviewProposal, proposalSummary } from "./approval.js";
import { evaluateTrade, seedFrom } from "./timemachine.js";

const DATA_DIR = new URL("../../data/", import.meta.url);
const STATE_FILE = new URL("bot-state.json", DATA_DIR);
const TRADES_FILE = new URL("bot-trades.jsonl", DATA_DIR);
// permite os testes apontarem pra um arquivo à parte, sem sujar o log real do bot
const EVENTS_FILE = process.env.BOT_EVENTS_FILE
  ? new URL(process.env.BOT_EVENTS_FILE, DATA_DIR)
  : new URL("bot-events.jsonl", DATA_DIR);
const MAX_EVENTS = 500; // a tela lê no máximo 300; menos dados = menos banda no Upstash

/**
 * Perfis validados em docs/validacao-estrategia.md (carteira 3 anos, treino 2023–25, teste 2026).
 *   v1: a configuração antiga (perdeu −12% em 3 anos).
 *   v2: score ≥ 90, alvo 3R, SuperTrend 4 (melhor candidata em 1h+4h: +60%, queda máx. −21%).
 */
export const STRATEGY_PROFILES = {
  v1: { minProb: 85, rr1: 1.5, stMult: 3 },
  v2: { minProb: 90, rr1: 3, stMult: 4 },
};

export function profileParams(profile, env = process.env) {
  if (profile === "custom") {
    return { minProb: Number(env.BOT_MIN_PROB || 90), rr1: Number(env.BOT_RR1 || 3), stMult: Number(env.BOT_ST_MULT || 4) };
  }
  return { ...(STRATEGY_PROFILES[profile] || STRATEGY_PROFILES.v2) };
}

export const CFG = {
  enabled: process.env.DEMO_BOT === "1" && demo.demoConfigured(),
  symbols: (process.env.BOT_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  timeframes: (process.env.BOT_TIMEFRAMES || "60,240").split(",").map((s) => s.trim()).filter(Boolean),
  riskPct: Number(process.env.BOT_RISK_PCT || 1),
  // escada de risco 10V/5D (game.js). Opt-in: só ajusta o risco por trade com BOT_LADDER=1.
  ladder: process.env.BOT_LADDER === "1",
  // Escola de traders: usa os parâmetros do aluno promovido (só com BOT_SCHOOL_PROMOTE=1).
  schoolPromote: process.env.BOT_SCHOOL_PROMOTE === "1",
  // Máquina do Tempo antes de cada entrada (timemachine.js). Desligue com BOT_TIMEMACHINE=0.
  timeMachine: process.env.BOT_TIMEMACHINE !== "0",
  // Perfil da estratégia (ver STRATEGY_PROFILES). "custom" usa BOT_MIN_PROB/BOT_RR1/BOT_ST_MULT.
  profile: process.env.BOT_PROFILE || "v2",
  ...profileParams(process.env.BOT_PROFILE || "v2"),
  reentryCooldown: Number(process.env.BOT_REENTRY_COOLDOWN || 10),
  dailyLossLimitPct: Number(process.env.BOT_DAILY_LOSS_LIMIT_PCT || 4),
  maxOpen: Number(process.env.BOT_MAX_OPEN || 3),
  maxOpensPerTick: Number(process.env.BOT_MAX_OPENS_PER_TICK || 1),
  // teto DURO do tamanho da posição, como fração da equity (evita posição gigante
  // quando o stop é apertado). Se o teto morde, o risco em $ fica menor que riskPct.
  maxNotionalPct: Number(process.env.BOT_MAX_NOTIONAL_PCT || 0.2),
  leverage: Number(process.env.BOT_LEVERAGE || 2),
  // modo seguro: registra "would_open" no feed mas NÃO manda ordem. Comece com 1.
  dryRun: process.env.BOT_DRY_RUN !== "0",
  token: process.env.BOT_TOKEN || "",
  tickMs: Number(process.env.BOT_TICK_MS || 60_000),
};

// ─────────────────────────────── helpers puros (testáveis) ───────────────────────────────

export function roundToStep(x, step) {
  if (!step || step <= 0) return x;
  // Corta no passo e limpa o resíduo de ponto flutuante (0.479000…04 → 0.479):
  // a Bybit recusa quantidades com casas além do passo ("Qty invalid").
  const decimals = (String(step).split(".")[1] || "").replace(/0+$/, "").length;
  return Number((Math.floor(x / step + 1e-9) * step).toFixed(decimals));
}

export function tfMinutes(tf) {
  const s = String(tf).toUpperCase();
  if (s === "D") return 1440;
  if (s === "W") return 10080;
  return parseInt(s, 10) || 1;
}

/**
 * Só as velas FECHADAS (a Bybit devolve a vela em formação como a última).
 * O backtest decide com velas fechadas; o bot ao vivo tem de seguir a mesma regra,
 * senão um sinal no meio da vela pode sumir quando ela fecha.
 */
export function closedCandles(candles, tf, now = Date.now()) {
  const ms = tfMinutes(tf) * 60_000;
  return candles.filter((c) => Number(c.ts) + ms <= now);
}

/**
 * A entrada é a mercado, ao preço de AGORA, não ao fechamento da vela.
 * Só entra se o preço atual ainda estiver entre o stop e o alvo (do lado certo).
 */
/** Busca até 1000 velas fechadas e roda a Máquina do Tempo. Falha de dados não barra a entrada. */
async function runTimeMachine({ symbol, tf, dir, entry, stop, tp, params }) {
  try {
    const candles = closedCandles(await getKlines({ symbol, interval: tf, limit: 1000 }), tf);
    let htfCandles = null;
    try {
      htfCandles = closedCandles(await getKlines({ symbol, interval: higherTF(tf), limit: 1000 }), higherTF(tf));
    } catch {
      /* período maior opcional */
    }
    const seed = seedFrom(`${symbol}|${tf}|${candles.at(-1)?.ts}`);
    return evaluateTrade({ candles, htfCandles, dir, entry, stop, tp, params, seed }).verdict;
  } catch (e) {
    return { ok: true, available: false, text: `indisponível agora (${String(e.message).slice(0, 60)}), não barra` };
  }
}

export function entryStillValid({ dir, live, stop, tp }) {
  if (![live, stop, tp].every(Number.isFinite)) return false;
  return dir === "LONG" ? live > stop && live < tp : dir === "SHORT" ? live < stop && live > tp : false;
}

export function cooldownMs(tf, candles = CFG.reentryCooldown) {
  return tfMinutes(tf) * candles * 60_000;
}

export function isFreshSignal({ signal, lastSignal, lastExitTs = 0, now = Date.now(), cd = 0 }) {
  if (signal !== "LONG" && signal !== "SHORT") return false;
  if (lastSignal !== signal) return true; // transição
  return now - lastExitTs >= cd; // ou já passou o cooldown pra reentrar
}

/**
 * Tamanho da posição por risco fixo, com TETO DURO de notional.
 * @returns {{ ok:boolean, qty:number, notional:number, riskUsd:number, capped:boolean, reason?:string }}
 */
export function sizePosition({
  equity,
  riskPct,
  entry,
  stop,
  qtyStep,
  minOrderQty,
  maxOrderQty = Infinity,
  leverage = 1,
  maxNotionalPct = 0.2,
}) {
  const dist = stop == null ? 0 : Math.abs(entry - stop);
  if (!(equity > 1) || !(entry > 0) || !(dist > 0) || stop == null) {
    return { ok: false, qty: 0, notional: 0, riskUsd: 0, capped: false, reason: "parâmetros inválidos (equity/entry/stop)" };
  }

  const riskUsd = equity * (riskPct / 100);
  const wantQty = riskUsd / dist;

  // teto de notional (fração da equity) + teto de qty do instrumento
  const capQtyByNotional = (equity * maxNotionalPct) / entry;
  const capped = wantQty > capQtyByNotional || wantQty > maxOrderQty;
  let qty = roundToStep(Math.min(wantQty, capQtyByNotional, maxOrderQty), qtyStep);

  const notional = qty * entry;
  if (qty < (minOrderQty || 0) || qty <= 0) {
    return { ok: false, qty, notional, riskUsd: 0, capped, reason: `qty ${qty} abaixo do mínimo ${minOrderQty}` };
  }
  return { ok: true, qty, notional, riskUsd: qty * dist, capped };
}

/**
 * Adota posições abertas na corretora que o estado não conhece (ex.: banco novo, estado perdido).
 * Sem isso o bot nunca registraria o fechamento delas. O período real é desconhecido: usa o mais
 * lento (o que dura mais). Muta o estado e devolve as posições adotadas.
 */
export function adoptPositions({ state, positions, symbols, timeframes, now = Date.now() }) {
  const tracked = new Set(Object.entries(state.keys || {}).filter(([, k]) => k.open).map(([key]) => key.split("|")[0]));
  const tf = timeframes.at(-1);
  const adopted = [];
  for (const p of positions) {
    if (!symbols.includes(p.symbol) || tracked.has(p.symbol) || !(p.size > 0)) continue;
    const key = `${p.symbol}|${tf}`;
    const ks = (state.keys[key] ||= { lastSignal: null, lastExitTs: 0, open: null, lastStage: null, lastBlockReason: null });
    const risk = p.stopLoss ? p.size * Math.abs(p.entry - p.stopLoss) : 0;
    ks.open = { side: p.side, qty: p.size, entry: p.entry, stop: p.stopLoss, tp: p.takeProfit,
      riskUsd: risk, prob: null, openedAt: p.openedAt || now, adopted: true };
    adopted.push({ key, symbol: p.symbol, tf, side: p.side, entry: p.entry, stop: p.stopLoss, tp: p.takeProfit });
  }
  return adopted;
}

/** Agrega o log de trades no MESMO shape do report.trades do backtest. */
// Risco efetivo por trade: base, ou o degrau da escada 10V/5D quando BOT_LADDER=1.
export function effectiveRiskPct({ trades = [], equityBase = 0, cfg = CFG } = {}) {
  if (!cfg.ladder) return cfg.riskPct;
  return computeLadder({ trades, baseRiskPct: cfg.riskPct, equityBase }).riskPct;
}

// Parâmetros da estratégia: gate base, mais os do aluno promovido quando permitido.
export function strategyParams({ cfg = CFG, promotion = null } = {}) {
  const base = { minProbEntry: cfg.minProb, ...(cfg.rr1 ? { rr1: cfg.rr1 } : {}), ...(cfg.stMult ? { stMult: cfg.stMult } : {}) };
  if (!cfg.schoolPromote || !promotion?.params) return base;
  return { ...base, ...promotion.params };
}

export function aggregateTrades(trades) {
  const rs = trades.map((t) => Number(t.netR)).filter(Number.isFinite);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const gW = wins.reduce((s, r) => s + r, 0);
  const gL = Math.abs(losses.reduce((s, r) => s + r, 0));
  const n = trades.length;
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const rnd = (v, p = 3) => Number(Number(v).toFixed(p));
  return {
    n,
    wins: wins.length,
    winRate: rnd(n ? wins.length / n : 0),
    avgR: rnd(mean(rs)),
    expectancyR: rnd(mean(rs)),
    profitFactor: gL > 0 ? rnd(gW / gL, 2) : null,
    totalPnlPct: rnd(trades.reduce((s, t) => s + (Number(t.netPnlPct) || 0), 0), 2),
    byReason: trades.reduce((o, t) => ((o[t.reason] = (o[t.reason] || 0) + 1), o), {}),
    bySymbol: trades.reduce((o, t) => ((o[t.symbol] = (o[t.symbol] || 0) + 1), o), {}),
  };
}

// ─────────────────────────────── estado + log ───────────────────────────────

function ensureDir() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* já existe */
  }
}

export function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { paused: false, dayKey: null, dayStartEquity: 0, keys: {} };
  }
}

function saveState(s) {
  ensureDir();
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

export function readTrades(limit = 500) {
  if (!existsSync(TRADES_FILE)) return [];
  const lines = readFileSync(TRADES_FILE, "utf8").trim().split("\n").filter(Boolean);
  const out = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* linha corrompida — ignora */
    }
  }
  // Ignora registros antigos sem saída nem motivo (fechamento não encontrado): não são trades reais.
  const real = out.filter(isRecordedTrade);
  return limit ? real.slice(-limit) : real;
}

export function isRecordedTrade(t) {
  return !(t && t.exit == null && t.reason === "unknown");
}

function appendTrade(t) {
  ensureDir();
  appendFileSync(TRADES_FILE, JSON.stringify(t) + "\n");
}

/**
 * Log de eventos legível por humano — tudo que o bot "decide" ao longo do tempo:
 * mudança de estágio (formando→prepare-se→entrada), abriu, fechou, bloqueado.
 * Serve pra nunca ficar no escuro sobre o que está acontecendo.
 */
export function appendEvent(e) {
  ensureDir();
  appendFileSync(EVENTS_FILE, JSON.stringify({ ts: Date.now(), ...e }) + "\n");
  // corta o arquivo de vez em quando (barato: só quando passa muito do limite)
  const all = readEvents(0);
  if (all.length > MAX_EVENTS * 1.5) {
    writeFileSync(EVENTS_FILE, all.slice(-MAX_EVENTS).map((x) => JSON.stringify(x)).join("\n") + "\n");
  }
}

export function readEvents(limit = 200) {
  if (!existsSync(EVENTS_FILE)) return [];
  const lines = readFileSync(EVENTS_FILE, "utf8").trim().split("\n").filter(Boolean);
  const out = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* linha corrompida — ignora */
    }
  }
  return limit ? out.slice(-limit) : out;
}

// ─────────────────────────────── loop ───────────────────────────────

let timer = null;
let running = false;
const leverageSet = new Set();

export async function tickOnce() {
  if (!CFG.enabled) return { skipped: "bot desligado" };
  if (running) return { skipped: "tick anterior ainda rodando" };
  running = true;
  const log = [];
  try {
    const s = loadState();
    const equity = await demo.getEquity();

    // sem saldo plausível → não faz nada (nem opera, nem define baseline)
    if (!(equity > 1)) {
      saveState(s);
      return { skipped: "sem saldo na conta demo", equity, log };
    }

    const today = new Date().toISOString().slice(0, 10);
    // (re)define o baseline do dia se virou o dia OU se está zerado/ausente
    if (s.dayKey !== today || !(s.dayStartEquity > 0)) {
      s.dayKey = today;
      s.dayStartEquity = equity;
      if (s.paused === "daily-loss") s.paused = false;
      log.push(`baseline do dia = ${equity.toFixed(2)}`);
    }
    if (equity <= s.dayStartEquity * (1 - CFG.dailyLossLimitPct / 100)) {
      s.paused = "daily-loss";
    }
    if (s.paused) {
      saveState(s);
      return { paused: s.paused, equity, log };
    }

    const stratParams = strategyParams({ promotion: CFG.schoolPromote ? readPromotion(DATA_DIR) : null });
    const positions = await demo.getPositions();
    const posBySymbol = Object.fromEntries(positions.map((p) => [p.symbol, p]));
    for (const a of adoptPositions({ state: s, positions, symbols: CFG.symbols, timeframes: CFG.timeframes })) {
      appendEvent({ type: "adopted", symbol: a.symbol, tf: a.tf, dir: a.side === "Buy" ? "LONG" : "SHORT", entry: a.entry, stop: a.stop, tp: a.tp });
      log.push(`${a.key}: posição já aberta na corretora adotada (stop ${a.stop}, alvo ${a.tp})`);
    }
    // conta posições REAIS na corretora, não só o que está no nosso estado
    let openCount = Math.max(positions.length, Object.values(s.keys).filter((k) => k.open).length);
    let opensThisTick = 0;

    for (const symbol of CFG.symbols) {
      for (const tf of CFG.timeframes) {
        const key = `${symbol}|${tf}`;
        const ks = (s.keys[key] ||= {
          lastSignal: null,
          lastExitTs: 0,
          open: null,
          lastStage: null,
          lastBlockReason: null,
        });

        let candles;
        let livePrice = null;
        let htfCloses = null;
        try {
          const raw = await getKlines({ symbol, interval: tf, limit: 300 });
          livePrice = Number(raw.at(-1)?.close);
          candles = closedCandles(raw, tf);
          try {
            const h = await getKlines({ symbol, interval: higherTF(tf), limit: 300 });
            htfCloses = closedCandles(h, higherTF(tf)).map((c) => c.close);
          } catch {
            /* HTF opcional */
          }
        } catch (e) {
          log.push(`${key}: erro klines ${e.message}`);
          continue;
        }

        let a;
        try {
          a = analyzeCandles(candles, { htfCloses, ...stratParams });
        } catch (e) {
          log.push(`${key}: erro analyze ${e.message}`);
          continue;
        }
        const signal = a.signal;

        // primeiro contato: só aprende o estado (e avisa que está de olho)
        if (ks.lastSignal === null) {
          ks.lastSignal = signal;
          ks.lastStage = a.stage;
          appendEvent({
            type: "watching",
            symbol,
            tf,
            stage: a.stage,
            signal,
            probability: a.probability,
            lean: a.lean,
            price: a.price,
          });
          continue;
        }

        // mudou de faixa (formando/prepare-se/entrada)? registra — é o "vai entrar" chegando
        // (só loga se já conhecíamos o estágio anterior — evita "undefined → X" ao migrar
        // estado antigo salvo antes deste campo existir)
        if (ks.lastStage != null && a.stage !== ks.lastStage) {
          appendEvent({
            type: "stage",
            symbol,
            tf,
            stage: a.stage,
            prevStage: ks.lastStage,
            signal,
            probability: a.probability,
            lean: a.lean,
            price: a.price,
          });
        }
        ks.lastStage = a.stage;

        // posição nossa aberta? checa se fechou na corretora
        if (ks.open) {
          const still = posBySymbol[symbol];
          const sameSide = still && still.side === (ks.open.side);
          if (!sameSide) {
            try {
              const closed = await demo.getClosedPnl({ symbol, limit: 10 });
              const c = closed
                .filter((x) => x.closedAt >= ks.open.openedAt - 5_000)
                .sort((x, y) => y.closedAt - x.closedAt)[0];
              if (!c) {
                // Sem registro de fechamento na corretora (ex.: posição antiga fora do histórico
                // consultado): não inventa um trade com resultado 0 — só registra o fato.
                appendEvent({ type: "unreconciled", symbol, tf, dir: ks.open.side === "Buy" ? "LONG" : "SHORT",
                  entry: ks.open.entry, openedAt: ks.open.openedAt });
                log.push(`${key}: posição sumiu sem registro de fechamento — trade não contabilizado`);
                throw Object.assign(new Error("sem fechamento"), { quiet: true });
              }
              const pnl = c.closedPnl;
              const netR = ks.open.riskUsd > 0 ? pnl / ks.open.riskUsd : 0;
              const notional = ks.open.qty * ks.open.entry;
              const exit = c?.exit ?? null;
              const reason =
                exit == null
                  ? "unknown"
                  : Math.abs(exit - ks.open.tp) < Math.abs(exit - ks.open.stop)
                  ? "tp"
                  : "stop";
              const tradeLine = {
                symbol,
                tf,
                dir: ks.open.side === "Buy" ? "LONG" : "SHORT",
                entry: ks.open.entry,
                exit,
                stop: ks.open.stop,
                tp: ks.open.tp,
                reason,
                netR: Number(netR.toFixed(3)),
                netPnlPct: notional > 0 ? Number(((pnl / notional) * 100).toFixed(3)) : 0,
                pnlUsd: Number(pnl.toFixed(4)),
                probability: ks.open.prob,
                openedAt: ks.open.openedAt,
                closedAt: c?.closedAt ?? Date.now(),
              };
              appendTrade(tradeLine);
              appendEvent({ type: "closed", ...tradeLine });
              log.push(`${key}: FECHOU ${reason} netR ${netR.toFixed(2)} pnl ${pnl.toFixed(2)}`);
            } catch (e) {
              if (!e.quiet) log.push(`${key}: erro ao registrar fechamento ${e.message}`);
            }
            ks.open = null;
            ks.lastExitTs = Date.now();
            openCount = Math.max(0, openCount - 1);
          }
        }

        // sem posição nossa → talvez abrir (no dry-run o teto de "abertas" não se aplica,
        // já que nada fica de fato aberto — assim dá pra ver o bot decidindo ao longo do tempo)
        if (
          !ks.open &&
          (signal === "LONG" || signal === "SHORT") &&
          a.levels.stop != null &&
          opensThisTick < CFG.maxOpensPerTick &&
          isFreshSignal({
            signal,
            lastSignal: ks.lastSignal,
            lastExitTs: ks.lastExitTs,
            cd: cooldownMs(tf),
          })
        ) {
          if (!entryStillValid({ dir: signal, live: livePrice, stop: a.levels.stop, tp: a.levels.tp1 })) {
            log.push(`${key}: sinal ${signal} na vela fechada, mas o preço atual (${livePrice}) já saiu da faixa stop/alvo`);
            ks.lastSignal = signal;
            continue;
          }
          a = { ...a, price: livePrice }; // tamanho e registro pelo preço real de entrada
          try {
            const instr = await demo.getInstrument(symbol);
            const side = signal === "LONG" ? "Buy" : "Sell";
            const riskPct = effectiveRiskPct({ trades: readTrades(500), equityBase: s.dayStartEquity });
            const sz = sizePosition({
              equity,
              riskPct,
              entry: a.price,
              stop: a.levels.stop,
              qtyStep: instr.qtyStep,
              minOrderQty: instr.minOrderQty,
              maxOrderQty: instr.maxOrderQty,
              leverage: CFG.leverage,
              maxNotionalPct: CFG.maxNotionalPct,
            });

            // Proposta → Ricardo confere os limites → aprova ou barra (com motivo).
            const proposal = {
              symbol, tf, dir: signal, entry: a.price, stop: a.levels.stop, tp: a.levels.tp1,
              probability: a.probability, gate: stratParams.minProbEntry ?? CFG.minProb, riskPct, equity, sizing: sz,
            };
            let decision = reviewProposal({ proposal, cfg: CFG, openCount, symbolBusy: !!posBySymbol[symbol] });
            // Passou nos limites? Só então roda a Máquina do Tempo (uma vez por vela fechada).
            if (decision.approved && CFG.timeMachine) {
              const candleTs = candles.at(-1)?.ts;
              if (ks.tm?.candleTs !== candleTs) {
                ks.tm = { candleTs, verdict: await runTimeMachine({ symbol, tf, dir: signal, entry: a.price, stop: a.levels.stop, tp: a.levels.tp1, params: stratParams }) };
              }
              proposal.timeMachine = ks.tm.verdict;
              decision = reviewProposal({ proposal, cfg: CFG, openCount, symbolBusy: !!posBySymbol[symbol] });
            }

            if (!decision.approved) {
              log.push(`${key}: barrada pelo risco (${decision.reason})`);
              // registra só quando o motivo muda (evita repetir a cada tick)
              // os números da Máquina do Tempo mudam a cada tick: registra uma vez por motivo
              const blockKey = decision.failedId === "timemachine" ? "timemachine" : decision.reason;
              if (ks.lastBlockReason !== blockKey) {
                appendEvent({ type: "blocked", by: "risk", reason: decision.reason, checks: decision.checks, ...proposalSummary(proposal) });
                ks.lastBlockReason = blockKey;
              }
            } else if (CFG.dryRun) {
              appendEvent({ type: "approved", by: "risk", checks: decision.checks, ...proposalSummary(proposal) });
              // modo seguro: só registra o que FARIA (e entra em cooldown pra não repetir)
              ks.lastBlockReason = null;
              ks.lastExitTs = Date.now();
              opensThisTick++;
              appendEvent({
                type: "would_open",
                symbol,
                tf,
                dir: side === "Buy" ? "LONG" : "SHORT",
                qty: sz.qty,
                entry: a.price,
                stop: a.levels.stop,
                tp: a.levels.tp1,
                notional: Number(sz.notional.toFixed(0)),
                riskUsd: Number(sz.riskUsd.toFixed(2)),
                capped: sz.capped,
                probability: a.probability,
              });
              log.push(`${key}: [DRY] abriria ${side} qty ${sz.qty} notional $${sz.notional.toFixed(0)} risco $${sz.riskUsd.toFixed(0)}`);
            } else {
              appendEvent({ type: "approved", by: "risk", checks: decision.checks, ...proposalSummary(proposal) });
              ks.lastBlockReason = null;
              if (!leverageSet.has(symbol)) {
                await demo.setLeverage(symbol, CFG.leverage);
                leverageSet.add(symbol);
              }
              await demo.placeMarketOrder({ symbol, side, qty: sz.qty });
              await new Promise((r) => setTimeout(r, 700));
              const rt = (p) => roundToStep(p, instr.tickSize);
              try {
                await demo.setTradingStop({ symbol, stopLoss: rt(a.levels.stop), takeProfit: rt(a.levels.tp1) });
              } catch (e) {
                log.push(`${key}: trading-stop falhou (${e.message}) — 1 retry`);
                await new Promise((r) => setTimeout(r, 900));
                await demo.setTradingStop({ symbol, stopLoss: rt(a.levels.stop), takeProfit: rt(a.levels.tp1) });
              }
              ks.open = {
                side,
                qty: sz.qty,
                entry: a.price,
                stop: a.levels.stop,
                tp: a.levels.tp1,
                riskUsd: sz.riskUsd,
                prob: a.probability,
                openedAt: Date.now(),
              };
              opensThisTick++;
              openCount++;
              appendEvent({
                type: "opened",
                symbol,
                tf,
                dir: side === "Buy" ? "LONG" : "SHORT",
                qty: sz.qty,
                entry: a.price,
                stop: a.levels.stop,
                tp: a.levels.tp1,
                notional: Number(sz.notional.toFixed(0)),
                riskUsd: Number(sz.riskUsd.toFixed(2)),
                probability: a.probability,
              });
              log.push(`${key}: ABRIU ${side} qty ${sz.qty} @ ${a.price} notional $${sz.notional.toFixed(0)}`);
            }
          } catch (e) {
            log.push(`${key}: erro ao abrir ${e.message}`);
            appendEvent({ type: "error", symbol, tf, detail: e.message });
          }
        }

        ks.lastSignal = signal;
      }
    }

    saveState(s);
    return { equity, dayStartEquity: s.dayStartEquity, open: openCount, log };
  } finally {
    running = false;
  }
}

export function startBot() {
  if (!CFG.enabled) {
    console.log("bot demo: DESLIGADO (defina DEMO_BOT=1 + BYBIT_DEMO_KEY/SECRET)");
    return;
  }
  console.log(
    `bot demo: LIGADO${CFG.dryRun ? " [DRY-RUN — não manda ordem]" : ""} — ${CFG.symbols.join(",")} × [${CFG.timeframes.join(",")}] · risco ${CFG.riskPct}% · perfil ${CFG.profile} (gate ${CFG.minProb}%, alvo ${CFG.rr1}R, SuperTrend ${CFG.stMult}) · notional máx ${(CFG.maxNotionalPct * 100).toFixed(0)}% da conta · máx ${CFG.maxOpen} abertas`
  );
  const run = () =>
    tickOnce()
      .then((r) => r?.log?.length && r.log.forEach((l) => console.log("  bot:", l)))
      .catch((e) => console.error("bot tick erro:", e.message));
  run();
  timer = setInterval(run, CFG.tickMs);
  const stop = () => {
    if (timer) clearInterval(timer);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

export function setPaused(v) {
  const s = loadState();
  s.paused = v;
  saveState(s);
  return s.paused;
}
