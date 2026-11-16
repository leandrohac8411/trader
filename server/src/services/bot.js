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
import { alignHtfByClose } from "./backtest.js";

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
//   v3 (13/11, depois da correção do simulador): só 1h, alvo 2R, score ≥ 90, SuperTrend 4 e stop no
//      empate quando a posição anda 1,5R a favor (+74% em 3 anos, queda máx. −22%; v2 caiu para +2%).
export const STRATEGY_PROFILES = {
  v1: { minProb: 85, rr1: 1.5, stMult: 3, breakevenAtR: null },
  v2: { minProb: 90, rr1: 3, stMult: 4, breakevenAtR: null },
  v3: { minProb: 90, rr1: 2, stMult: 4, breakevenAtR: 1.5, timeframes: ["60"] },
};

export function profileParams(profile, env = process.env) {
  if (profile === "custom") {
    return { minProb: Number(env.BOT_MIN_PROB || 90), rr1: Number(env.BOT_RR1 || 3), stMult: Number(env.BOT_ST_MULT || 4),
      breakevenAtR: env.BOT_BREAKEVEN_R ? Number(env.BOT_BREAKEVEN_R) : null };
  }
  return { ...(STRATEGY_PROFILES[profile] || STRATEGY_PROFILES.v3) };
}

/** Stop no empate: o preço andou `atR` vezes o risco a favor desde a entrada (velas fechadas)? */
export function reachedBreakeven({ side, entry, stop0, candles, openedAt, atR }) {
  const risk = Math.abs(entry - stop0);
  if (!atR || !(risk > 0)) return false;
  const after = (candles || []).filter((c) => c.ts >= openedAt);
  if (!after.length) return false;
  const fav = side === "Buy" ? Math.max(...after.map((c) => c.high)) - entry : entry - Math.min(...after.map((c) => c.low));
  return fav >= atR * risk;
}

export const PENDING_CLOSE_MS = 24 * 3_600_000;

/** O fechamento da corretora que corresponde a esta posição (o mais recente depois da abertura). */
export function matchClose(closed, open) {
  const qty = Number(open?.qty);
  return (closed || [])
    .filter((x) => x.closedAt >= open.openedAt - 5_000)
    .filter((x) => !(qty > 0) || !(x.qty > 0) || Math.abs(x.qty - qty) / qty < 0.02)
    .sort((x, y) => y.closedAt - x.closedAt)[0] || null;
}

/**
 * Fechamento montado pelas execuções, quando o closed-pnl da Bybit atrasa (na demo já levou horas).
 * Soma as execuções do lado oposto que fecharam posição depois da abertura até cobrir a quantidade.
 * Resultado = (saída − entrada) × qtd no sentido do trade − taxas das execuções da abertura e do fechamento.
 */
export function closeFromExecutions(execs, open) {
  const qty = Number(open?.qty);
  if (!(qty > 0) || !Array.isArray(execs)) return null;
  const from = (open.openedAt || 0) - 5_000;
  const list = execs.filter((e) => e.time >= from && (!e.execType || e.execType === "Trade")).sort((a, b) => a.time - b.time);
  const closeSide = open.side === "Buy" ? "Sell" : "Buy";
  let filled = 0, value = 0, fees = 0, last = null;
  for (const e of list) {
    if (e.side !== closeSide) continue;
    // a demo devolve closedSize 0 até nos fechamentos: no modo de posição única, o lado oposto depois da abertura é o fechamento
    const size = e.closedSize > 0 ? e.closedSize : e.qty;
    if (!(size > 0)) continue;
    const q = Math.min(size, qty - filled);
    filled += q; value += q * e.price; fees += e.fee * (q / e.qty || 1); last = e.time;
    if (filled >= qty * 0.98) break;
  }
  if (filled < qty * 0.98) return null;
  const openFees = list.filter((e) => e.side === open.side && e.time <= last).reduce((s, e) => s + e.fee, 0);
  const exit = value / filled;
  const dir = open.side === "Buy" ? 1 : -1;
  return { qty: filled, exit, closedPnl: dir * (exit - open.entry) * filled - fees - openFees, closedAt: last, source: "executions" };
}

/**
 * Último recurso (a demo às vezes não publica nem o closed-pnl nem a execução do fechamento):
 * o primeiro toque no stop ou no alvo nas velas públicas entre a abertura e a hora em que a posição sumiu.
 * Vela que toca os dois conta como stop (conservador). Taxa estimada de 0,055% na entrada e na saída.
 */
export const ESTIMATE_AFTER_MS = 30 * 60_000;
export function estimateCloseFromCandles(candles, open, { until = Infinity, feePct = 0.055 } = {}) {
  const qty = Number(open?.qty);
  if (!(qty > 0) || !Number.isFinite(open.stop) || !Number.isFinite(open.tp) || !Array.isArray(candles)) return null;
  const short = open.side === "Sell";
  const list = [...candles].sort((a, b) => a.ts - b.ts);
  const step = list.length > 1 ? list[1].ts - list[0].ts : 60_000;
  for (const c of list) {
    if (c.ts + step <= (open.openedAt || 0) || c.ts > until) continue; // só velas que terminam depois da abertura
    const hitStop = short ? c.high >= open.stop : c.low <= open.stop;
    const hitTp = short ? c.low <= open.tp : c.high >= open.tp;
    if (!hitStop && !hitTp) continue;
    const exit = hitStop ? open.stop : open.tp;
    const fees = qty * (open.entry + exit) * (feePct / 100);
    return { qty, exit, closedPnl: (short ? -1 : 1) * (exit - open.entry) * qty - fees, closedAt: c.ts, source: "estimate" };
  }
  return null;
}

/** Fechamento da posição: o registro da Bybit (closed-pnl) ou, se ainda não saiu, as execuções. */
export async function findClose(demo, symbol, open) {
  const c = matchClose(await demo.getClosedPnl({ symbol, limit: 50 }), open);
  if (c || !demo.getExecutions) return c;
  return closeFromExecutions(await demo.getExecutions({ symbol, startTime: Math.max(0, (open.openedAt || 0) - 5_000), limit: 100 }), open);
}

/** Linha do trade a partir da posição e do fechamento da corretora. */
export function closeTradeLine({ symbol, tf, open, c }) {
  const stop0 = open.stop0 ?? open.stop;
  const qty = open.qty || c.qty;
  const riskUsd = open.riskUsd > 0 ? open.riskUsd : qty * Math.abs(open.entry - stop0);
  const pnl = c.closedPnl;
  const exit = c.exit ?? null;
  const reason = exit == null ? "unknown"
    : Math.abs(exit - open.tp) < Math.abs(exit - open.stop) ? "tp"
    : open.beMoved ? "be" : "stop";
  const notional = qty * open.entry;
  return {
    symbol, tf, dir: open.side === "Buy" ? "LONG" : "SHORT", entry: open.entry, exit, stop: open.stop, tp: open.tp, reason,
    netR: Number((riskUsd > 0 ? pnl / riskUsd : 0).toFixed(3)),
    netPnlPct: notional > 0 ? Number(((pnl / notional) * 100).toFixed(3)) : 0,
    pnlUsd: Number(pnl.toFixed(4)), probability: open.prob ?? null, openedAt: open.openedAt, closedAt: c.closedAt ?? Date.now(),
    ...(c.source ? { source: c.source } : {}),
  };
}

/** "unreconciled" dos últimos 3 dias que ainda não viraram trade: volta para a fila de pendentes. */
export function backfillPending({ events = [], trades = [], now = Date.now() }) {
  const out = [];
  for (const u of events.filter((e) => e.type === "unreconciled" && e.ts > now - 3 * 86_400_000)) {
    if (trades.some((t) => t.symbol === u.symbol && t.openedAt === u.openedAt)) continue;
    const src = events.filter((e) => (e.type === "opened" || e.type === "adopted") && e.symbol === u.symbol && e.tf === u.tf && e.entry === u.entry)
      .sort((a, b) => b.ts - a.ts)[0];
    if (!src || out.some((p) => p.symbol === u.symbol && p.open.openedAt === u.openedAt)) continue;
    const be = events.find((e) => e.type === "breakeven" && e.symbol === u.symbol && e.tf === u.tf && e.entry === u.entry && e.ts >= u.openedAt);
    out.push({ symbol: u.symbol, tf: u.tf, since: now, open: { side: u.dir === "LONG" ? "Buy" : "Sell", entry: u.entry,
      stop: be ? be.stop : src.stop, stop0: src.stop, beMoved: !!be, tp: src.tp,
      qty: src.qty ?? null, riskUsd: src.riskUsd ?? null, prob: src.probability ?? null, openedAt: u.openedAt } });
  }
  return out;
}

/** Períodos que o tick percorre num ativo: os do perfil + os de posições ainda abertas (só para acompanhar). */
export function tickTimeframes(symbol, timeframes, keys = {}) {
  const open = Object.entries(keys).filter(([k, v]) => v?.open && k.startsWith(`${symbol}|`)).map(([k]) => k.split("|")[1]);
  return [...new Set([...timeframes, ...open])];
}

// 14/11/2026: top 10 por valor de mercado (3 anos de v3: ganhou do grupo de 5 em todos os anos; top 15 piorou)
export const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "TRXUSDT"];

/** BOT_SYMBOLS aceita a lista ("BTCUSDT,ETHUSDT") ou só a quantidade ("10" = as 10 primeiras da lista padrão). */
export function parseSymbols(raw) {
  const v = String(raw ?? "").trim();
  if (/^[0-9]+$/.test(v)) return DEFAULT_SYMBOLS.slice(0, Math.max(1, Math.min(DEFAULT_SYMBOLS.length, Number(v))));
  const list = v.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{2,20}USDT$/.test(s));
  return list.length ? list : DEFAULT_SYMBOLS;
}

export const CFG = {
  enabled: process.env.DEMO_BOT === "1" && demo.demoConfigured(),
  symbols: parseSymbols(process.env.BOT_SYMBOLS),
  timeframes: (process.env.BOT_TIMEFRAMES || "60,240").split(",").map((s) => s.trim()).filter(Boolean),
  riskPct: Number(process.env.BOT_RISK_PCT || 1),
  // escada de risco 10V/5D (game.js). Opt-in: só ajusta o risco por trade com BOT_LADDER=1.
  ladder: process.env.BOT_LADDER === "1",
  // Escola de traders: usa os parâmetros do aluno promovido (só com BOT_SCHOOL_PROMOTE=1).
  schoolPromote: process.env.BOT_SCHOOL_PROMOTE === "1",
  // Máquina do Tempo antes de cada entrada (timemachine.js). Desligue com BOT_TIMEMACHINE=0.
  timeMachine: process.env.BOT_TIMEMACHINE !== "0",
  // Perfil da estratégia (ver STRATEGY_PROFILES). "custom" usa BOT_MIN_PROB/BOT_RR1/BOT_ST_MULT.
  // (um perfil com `timeframes`, como o v3, substitui BOT_TIMEFRAMES)
  profile: process.env.BOT_PROFILE || "v3",
  ...profileParams(process.env.BOT_PROFILE || "v3"),
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
    // período maior alinhado pelo fechamento: o histórico não pode ver a vela diária ainda em formação
    return evaluateTrade({ candles, htfCandles: alignHtfByClose(htfCandles, tf, higherTF(tf)), dir, entry, stop, tp, params, seed }).verdict;
  } catch (e) {
    return { ok: true, available: false, text: `indisponível agora (${String(e.message).slice(0, 60)}), não barra` };
  }
}

export function entryStillValid({ dir, live, stop, tp, minRR = 0 }) {
  if (![live, stop, tp].every(Number.isFinite)) return false;
  const inside = dir === "LONG" ? live > stop && live < tp : dir === "SHORT" ? live < stop && live > tp : false;
  return inside && liveRR({ live, stop, tp }) >= minRR;
}

/** Ganho/risco a partir do preço atual (stop e alvo vêm do fechamento da vela do sinal). */
export function liveRR({ live, stop, tp }) {
  const risk = Math.abs(live - stop);
  return risk > 0 ? Math.abs(tp - live) / risk : 0;
}

// Entrada atrasada (vaga abriu minutos depois do sinal): o preço já andou e o alvo ficou perto.
// O backtest entra logo na vela seguinte, então só entra se ainda sobrar pelo menos 75% do alvo do perfil.
export const MIN_LIVE_RR_SHARE = 0.75;

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
 * lento (o que dura mais). A hora de abertura também é desconhecida (o createdTime da Bybit é de
 * quando o "slot" da posição nasceu, meses atrás): usa a hora da adoção. Muta o estado e devolve as adotadas.
 */
export function adoptPositions({ state, positions, symbols, timeframes, now = Date.now() }) {
  // adotadas antes desta correção ficaram com a hora velha da Bybit: passa para agora (uma vez)
  for (const k of Object.values(state.keys || {})) {
    if (k.open?.adopted && !k.open.adoptedAt) Object.assign(k.open, { openedAt: now, adoptedAt: now });
  }
  const tracked = new Set(Object.entries(state.keys || {}).filter(([, k]) => k.open).map(([key]) => key.split("|")[0]));
  const tf = timeframes.at(-1);
  const adopted = [];
  for (const p of positions) {
    if (!symbols.includes(p.symbol) || tracked.has(p.symbol) || !(p.size > 0)) continue;
    const key = `${p.symbol}|${tf}`;
    const ks = (state.keys[key] ||= { lastSignal: null, lastExitTs: 0, open: null, lastStage: null, lastBlockReason: null });
    const risk = p.stopLoss ? p.size * Math.abs(p.entry - p.stopLoss) : 0;
    ks.open = { side: p.side, qty: p.size, entry: p.entry, stop: p.stopLoss, tp: p.takeProfit,
      riskUsd: risk, prob: null, openedAt: now, adoptedAt: now, adopted: true };
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

/**
 * Uma linha por moeda no status: a nota do 1h, a direção e o que falta para o bot entrar.
 * Sinal "novo" = o bot entraria agora (respeitadas vagas, Ricardo e preço); "antigo" = já foi tratado.
 */
export function scoreLine({ symbol, tf, probability, signal, lean, minProb, open, fresh, paused }) {
  const tfTxt = tf === "60" ? "1h" : tf === "240" ? "4h" : `${tf}m`;
  const dir = (d) => (d === "LONG" ? "compra" : "venda");
  const nota = Math.round(Number(probability) || 0);
  const base = { symbol, tf, score: nota, signal, lean };
  if (open) return { ...base, text: `${symbol} ${tfTxt}: posição aberta (${dir(open)}), nota ${nota}` };
  if (signal === "LONG" || signal === "SHORT") {
    if (paused) return { ...base, text: `${symbol} ${tfTxt}: sinal de ${dir(signal)} (nota ${nota}), mas o bot está pausado` };
    return { ...base, text: fresh
      ? `${symbol} ${tfTxt}: sinal NOVO de ${dir(signal)} (nota ${nota}) — avaliado para entrada`
      : `${symbol} ${tfTxt}: sinal de ${dir(signal)} (nota ${nota}) já tratado — espera um sinal novo` };
  }
  const falta = Math.max(0, minProb - nota);
  return { ...base, text: `${symbol} ${tfTxt}: nota ${nota}/${minProb}, inclinada para ${dir(lean)} — sem sinal${falta ? ` (faltam ${falta})` : ""}` };
}

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
    // Pausa (perda do dia ou manual) bloqueia só ENTRADAS novas: o bot continua registrando fechamentos,
    // movendo o stop para o empate e adotando posições. Antes ele parava tudo e o empate não subia.
    const paused = s.paused || null;
    if (paused) log.push(`pausado (${paused}): sem entradas novas; posições abertas seguem acompanhadas`);

    const stratParams = strategyParams({ promotion: CFG.schoolPromote ? readPromotion(DATA_DIR) : null });
    const positions = await demo.getPositions();
    const posBySymbol = Object.fromEntries(positions.map((p) => [p.symbol, p]));
    for (const a of adoptPositions({ state: s, positions, symbols: CFG.symbols, timeframes: CFG.timeframes })) {
      appendEvent({ type: "adopted", symbol: a.symbol, tf: a.tf, dir: a.side === "Buy" ? "LONG" : "SHORT", entry: a.entry, stop: a.stop, tp: a.tp });
      log.push(`${a.key}: posição já aberta na corretora adotada (stop ${a.stop}, alvo ${a.tp})`);
    }
    // Fechamentos que a corretora ainda não tinha publicado (e, uma vez, os "unreconciled" recentes).
    if (!s.backfilledUnreconciled) {
      s.pendingCloses = [...(s.pendingCloses || []), ...backfillPending({ events: readEvents(500), trades: readTrades(500), now: Date.now() })];
      s.backfilledUnreconciled = true;
    }
    if (s.pendingCloses?.length) {
      const still = [];
      for (const p of s.pendingCloses) {
        let c = null;
        p.tries = (p.tries || 0) + 1;
        try {
          const closed = await demo.getClosedPnl({ symbol: p.symbol, limit: 50 });
          c = matchClose(closed, p.open);
          if (!c) {
            const ex = await demo.getExecutions({ symbol: p.symbol, startTime: Math.max(0, (p.open.openedAt || 0) - 5_000), limit: 100 });
            c = closeFromExecutions(ex, p.open);
            if (!c && Date.now() - p.since > ESTIMATE_AFTER_MS) {
              // velas de 1 min cobrem ~16 h; janelas maiores usam 5 min
              const span = p.since - (p.open.openedAt || p.since);
              const interval = span <= 950 * 60_000 ? "1" : "5";
              const candles = await getKlines({ symbol: p.symbol, interval, limit: 1000, start: (p.open.openedAt || 0) - 60_000, end: p.since + 60_000 });
              c = estimateCloseFromCandles(candles, p.open, { until: p.since + 60_000 });
            }
            // o que a corretora devolveu, para dar para ver por que não casou (em /api/bot/status)
            p.info = `closed-pnl: ${closed.length} (mais recente ${closed[0] ? new Date(closed[0].closedAt).toISOString() : "—"}, qtd ${closed[0]?.qty ?? "—"}) · execuções: ${ex.length} [${ex.map((e) => `${e.side} ${e.qty}@${e.price} fechou ${e.closedSize} ${e.execType || ""} ${new Date(e.time).toISOString().slice(11, 16)}`).join("; ")}] · posição qtd ${p.open.qty ?? "—"} aberta ${p.open.openedAt ? new Date(p.open.openedAt).toISOString() : "—"}`;
            delete p.error;
          }
        } catch (e) { p.error = String(e.message || e).slice(0, 200); }
        if (c) {
          const tradeLine = closeTradeLine({ symbol: p.symbol, tf: p.tf, open: p.open, c });
          appendTrade(tradeLine);
          appendEvent({ type: "closed", late: true, ...tradeLine });
          log.push(`${p.symbol}|${p.tf}: fechamento encontrado depois — ${tradeLine.reason} pnl ${tradeLine.pnlUsd}`);
        } else if (Date.now() - p.since > PENDING_CLOSE_MS) {
          appendEvent({ type: "unreconciled", symbol: p.symbol, tf: p.tf, dir: p.open.side === "Buy" ? "LONG" : "SHORT",
            entry: p.open.entry, openedAt: p.open.openedAt });
          log.push(`${p.symbol}|${p.tf}: sem registro de fechamento depois de 24 h — trade não contabilizado`);
        } else still.push(p);
      }
      s.pendingCloses = still;
    }
    // conta posições REAIS na corretora, não só o que está no nosso estado
    let openCount = Math.max(positions.length, Object.values(s.keys).filter((k) => k.open).length);
    const scores = [];
    let opensThisTick = 0;

    for (const symbol of CFG.symbols) {
      for (const tf of tickTimeframes(symbol, CFG.timeframes, s.keys)) {
        const key = `${symbol}|${tf}`;
        // período fora do perfil (ex.: 4h depois da troca para o v3): só acompanha a posição aberta
        const manageOnly = !CFG.timeframes.includes(tf);
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
              const c = await findClose(demo, symbol, ks.open);
              if (c) {
                const tradeLine = closeTradeLine({ symbol, tf, open: ks.open, c });
                appendTrade(tradeLine);
                appendEvent({ type: "closed", ...tradeLine });
                log.push(`${key}: FECHOU ${tradeLine.reason} netR ${tradeLine.netR} pnl ${tradeLine.pnlUsd}`);
              } else {
                // A Bybit às vezes demora a publicar o fechamento: tenta de novo nas próximas rodadas.
                (s.pendingCloses ||= []).push({ symbol, tf, open: { ...ks.open }, since: Date.now() });
                log.push(`${key}: posição fechou, aguardando o registro da corretora`);
              }
            } catch (e) {
              (s.pendingCloses ||= []).push({ symbol, tf, open: { ...ks.open }, since: Date.now() });
              log.push(`${key}: erro ao registrar fechamento ${e.message} — tenta de novo`);
            }
            ks.open = null;
            ks.lastExitTs = Date.now();
            openCount = Math.max(0, openCount - 1);
          }
        }

        // stop no empate (perfil v3): andou X R a favor numa vela fechada → stop vai para a entrada
        if (ks.open && CFG.breakevenAtR && !ks.open.beMoved && posBySymbol[symbol]?.side === ks.open.side
          && reachedBreakeven({ side: ks.open.side, entry: ks.open.entry, stop0: ks.open.stop0 ?? ks.open.stop,
            candles, openedAt: ks.open.openedAt, atR: CFG.breakevenAtR })) {
          try {
            const instr = await demo.getInstrument(symbol);
            const be = roundToStep(ks.open.entry, instr.tickSize);
            if (!CFG.dryRun) await demo.setTradingStop({ symbol, stopLoss: be });
            ks.open.stop0 ??= ks.open.stop;
            ks.open.stop = be;
            ks.open.beMoved = true;
            appendEvent({ type: "breakeven", symbol, tf, dir: ks.open.side === "Buy" ? "LONG" : "SHORT", entry: ks.open.entry, stop: be });
            log.push(`${key}: andou ${CFG.breakevenAtR}R a favor — stop no empate (${be})`);
          } catch (e) {
            log.push(`${key}: erro ao subir o stop para o empate ${e.message}`);
          }
        }

        if (!manageOnly) {
          scores.push(scoreLine({ symbol, tf, probability: a.probability, signal, lean: a.lean, minProb: CFG.minProb,
            open: ks.open ? (ks.open.side === "Buy" ? "LONG" : "SHORT") : null, paused,
            fresh: !ks.open && isFreshSignal({ signal, lastSignal: ks.lastSignal, lastExitTs: ks.lastExitTs, cd: cooldownMs(tf) }) }));
        }
        if (manageOnly) continue;
        if (paused) {
          // sinal que nasce na pausa é consumido: não vira entrada atrasada quando a pausa acabar
          ks.lastSignal = signal;
          continue;
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
          const minRR = CFG.rr1 ? CFG.rr1 * MIN_LIVE_RR_SHARE : 0;
          if (!entryStillValid({ dir: signal, live: livePrice, stop: a.levels.stop, tp: a.levels.tp1, minRR })) {
            const rr = liveRR({ live: livePrice, stop: a.levels.stop, tp: a.levels.tp1 });
            appendEvent({ type: "skipped", symbol, tf, dir: signal, reason: Number.isFinite(rr) && rr > 0 ? `entrada atrasada: sobram ${rr.toFixed(2)}R (mínimo ${minRR.toFixed(2)}R)` : "preço já saiu da faixa stop/alvo", price: livePrice, stop: a.levels.stop, tp: a.levels.tp1 });
            log.push(`${key}: sinal ${signal} na vela fechada, mas no preço atual (${livePrice}) ${Number.isFinite(rr) && rr > 0 ? `sobram só ${rr.toFixed(2)}R (mínimo ${minRR.toFixed(2)}R)` : "já saiu da faixa stop/alvo"}`);
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

    s.lastTick = { at: Date.now(), log: log.slice(-60), scores };
    saveState(s);
    return { ...(paused ? { paused } : {}), equity, dayStartEquity: s.dayStartEquity, open: openCount, log };
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
