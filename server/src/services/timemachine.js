// server/src/services/timemachine.js
// Máquina do Tempo: antes de cada entrada, o Ricardo pergunta "se o futuro se parecer com o
// passado recente deste ativo, essa entrada ganha ou perde dinheiro?". Duas respostas:
//
//   1) Replays (simulação): reconstrói o futuro 10.000 vezes sorteando velas FECHADAS recentes
//      do próprio ativo (cada vela vira proporções da anterior) e vê o que vem primeiro:
//      stop, alvo ou nenhum dos dois no horizonte. Vela que toca os dois conta como stop.
//   2) Histórico (real): a MESMA regra do bot (estratégia + gate) nas velas passadas reais,
//      com taxas e slippage (é o motor de backtest).
//
// Ideia inspirada no "Time Machine" de github.com/Jakeschincariol/day-trader-skill (MIT),
// adaptada para cripto 24h e para o nosso bot. É uma simulação, não uma previsão.
// Função pura: não acessa rede nem envia ordens.
import { runBacktest } from "./backtest.js";

const round = (n, p = 3) => (Number.isFinite(+n) ? Number(Number(n).toFixed(p)) : 0);

/** Gerador pseudoaleatório com semente (mesma entrada → mesmo resultado). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semente estável a partir de um texto (ex.: "BTCUSDT|60|<ts da vela>"). */
export function seedFrom(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Cada vela como proporções do fechamento anterior: abertura, máxima, mínima, fechamento. */
export function barRatios(candles) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const p = Number(candles[i - 1].close);
    const c = candles[i];
    if (!(p > 0)) continue;
    const r = { o: c.open / p, h: c.high / p, l: c.low / p, c: c.close / p };
    if (Object.values(r).every((x) => Number.isFinite(x) && x > 0)) out.push(r);
  }
  return out;
}

/**
 * Replays de Monte Carlo (bootstrap das velas).
 * @param {{candles:Array, dir:'LONG'|'SHORT', entry:number, stop:number, tp:number,
 *   replays?:number, horizon?:number, seed?:number, costPct?:number}} o
 *   costPct: custo de ida e volta em % do preço (taxa + slippage nos dois lados).
 */
export function simulate({ candles, dir, entry, stop, tp, replays = 10_000, horizon = 100, seed = 19, costPct = 0.15 }) {
  const ratios = barRatios(candles);
  const risk = Math.abs(entry - stop);
  if (ratios.length < 30 || !(risk > 0) || !(entry > 0)) return null;
  const long = dir === "LONG";
  const rTarget = Math.abs(tp - entry) / risk;
  const costR = ((costPct / 100) * entry) / risk;
  const rand = mulberry32(seed);
  let target = 0, stopped = 0, neither = 0, sumR = 0;

  for (let k = 0; k < replays; k++) {
    let price = entry, result = null;
    for (let b = 0; b < horizon && result === null; b++) {
      const r = ratios[Math.floor(rand() * ratios.length)];
      const open = price * r.o, high = price * r.h, low = price * r.l;
      // abertura já além do stop (gap) também conta como -1R (na vida real pode ser pior)
      const hitStop = long ? low <= stop || open <= stop : high >= stop || open >= stop;
      const hitTp = long ? high >= tp : low <= tp;
      if (hitStop) result = -1;
      else if (hitTp) result = rTarget;
      price *= r.c;
    }
    if (result === -1) stopped++;
    else if (result !== null) target++;
    else {
      neither++;
      result = ((long ? 1 : -1) * (price - entry)) / risk;
    }
    sumR += result;
  }

  const decided = target + stopped;
  return {
    replays, horizon, sample: ratios.length,
    targetPct: round((target / replays) * 100, 1),
    stopPct: round((stopped / replays) * 100, 1),
    neitherPct: round((neither / replays) * 100, 1),
    // dos replays que bateram um dos lados, quantos bateram o alvo primeiro
    targetFirstPct: decided ? round((target / decided) * 100, 1) : null,
    // alvo de R vezes o risco precisa vencer 1 em (1 + R) só para empatar (antes das taxas)
    breakEvenPct: round(100 / (1 + rTarget), 1),
    rTarget: round(rTarget, 2),
    costR: round(costR, 3),
    expectancyR: round(sumR / replays - costR, 3),
  };
}

/** A mesma regra do bot nas velas passadas reais (com taxas). */
export function history({ candles, htfCandles = null, dir, params = {} }) {
  if (!Array.isArray(candles) || candles.length < 120) return null;
  const bt = runBacktest(candles, { htfCandles, ...params });
  const all = bt.tradeList || [];
  const same = all.filter((t) => t.dir === dir);
  const stats = (list) => ({
    n: list.length,
    winPct: list.length ? round((list.filter((t) => t.netR > 0).length / list.length) * 100, 1) : null,
    expectancyR: list.length ? round(list.reduce((s, t) => s + t.netR, 0) / list.length, 3) : null,
  });
  return { candles: candles.length, all: stats(all), same: stats(same) };
}

export const MIN_HISTORY = 10;

/**
 * Veredito: o Ricardo barra quando a simulação E o histórico real concordam que a entrada
 * perde dinheiro (ou quando a simulação perde e não há histórico suficiente para contestar).
 */
export function verdict(mc, hist) {
  if (!mc) return { ok: true, available: false, text: "sem velas suficientes para simular (não barra)" };
  const h = hist && (hist.same.n >= MIN_HISTORY ? { ...hist.same, scope: "mesma direção" } : hist.all.n >= MIN_HISTORY ? { ...hist.all, scope: "as duas direções" } : null);
  const mcLoses = mc.expectancyR < 0;
  const histLoses = h ? h.expectancyR < 0 : null;
  const ok = !(mcLoses && (histLoses === null || histLoses));
  const fmt = (r) => `${r > 0 ? "+" : ""}${r.toFixed(2).replace(".", ",")} R`;
  const sim = `simulação: alvo antes do stop em ${String(mc.targetFirstPct ?? 0).replace(".", ",")}% (empate ${String(mc.breakEvenPct).replace(".", ",")}%), ${fmt(mc.expectancyR)}/trade`;
  const real = h ? `histórico: ${h.n} trades (${h.scope}), ${fmt(h.expectancyR)}/trade` : "histórico: poucos trades para concluir";
  return { ok, available: true, mcExpectancyR: mc.expectancyR, histExpectancyR: h?.expectancyR ?? null, histN: h?.n ?? 0, text: `${sim} · ${real}` };
}

/** Tudo junto, para o bot: replays + histórico + veredito. */
export function evaluateTrade({ candles, htfCandles = null, dir, entry, stop, tp, params = {}, seed, replays, horizon }) {
  const mc = simulate({ candles, dir, entry, stop, tp, seed, replays, horizon });
  let hist = null;
  try { hist = history({ candles, htfCandles, dir, params }); } catch { hist = null; }
  return { mc, history: hist, verdict: verdict(mc, hist) };
}
