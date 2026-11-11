// server/src/services/strategy.js
// Motor de estratégia por CONSENSO. Funções puras: sem rede, sem Express.
// Entrada: velas ascendentes [{ ts, open, high, low, close, volume }].
//
// - computeIndicators(candles, opts)  -> arrays de indicadores (uma vez)
// - evaluateBar(candles, ind, i, opts) -> sinal/probabilidade/níveis NA vela i
// - analyzeCandles(candles, opts)      -> wrapper: avalia a última vela (i = n-1)

import { EMA, RSI, MACD, ATR, SuperTrend } from "./indicators.js";

const round = (n, p = 2) => Number(Number(n).toFixed(p));
const clampUnit = (x) => Math.max(-1, Math.min(1, x));

export const DEFAULTS = {
  emaFast: 20,
  emaSlow: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  stPeriod: 7,
  stMult: 3,
  rr1: 1.5,
  rr2: 2.5,
  lookback: 5,
  minProbEntry: 85, // só emite COMPRA/VENDA quando a probabilidade técnica >= isto
};

// zonas de prontidão (usadas pelas cores do painel)
export function stageFor(signal, probability) {
  if (signal === "LONG" || signal === "SHORT") return "go";
  if (probability >= 75) return "ready";
  if (probability >= 50) return "watch";
  return "none";
}

/**
 * Sobe um nível de timeframe (para o filtro HTF opcional).
 * 1->15, 3->45, 5->60, 15/30->240, 60/240->D, D->W
 */
export function higherTF(tf) {
  const m = String(tf).toUpperCase();
  if (m === "D") return "W";
  const num = parseInt(m, 10);
  if (Number.isNaN(num)) return "D";
  if (num <= 1) return "15";
  if (num <= 3) return "45";
  if (num <= 5) return "60";
  if (num <= 30) return "240";
  return "D";
}

/** Viés de tendência de uma série de fechamentos: "up" | "down" | "neutral". */
export function trendBias(closes) {
  const n = closes.length;
  if (n < 55) return "neutral";
  return trendBiasSeries(closes)[n - 1];
}

/**
 * Viés de tendência EM CADA índice de uma série de fechamentos.
 * Calcula EMA/RSI/MACD uma vez só (recursivos → sem lookahead ao ler o índice i).
 * @returns {("up"|"down"|"neutral")[]}
 */
export function trendBiasSeries(closes) {
  const n = closes.length;
  const out = new Array(n).fill("neutral");
  if (n < 55) return out;
  const e20 = EMA(closes, 20);
  const e50 = EMA(closes, 50);
  const r = RSI(closes, 14);
  const m = MACD(closes);
  for (let i = 54; i < n; i++) {
    let score = 0;
    if (e20[i] > e50[i]) score++;
    else if (e20[i] < e50[i]) score--;
    if (r[i] > 52) score++;
    else if (r[i] < 48) score--;
    if (m.hist[i] > 0) score++;
    else if (m.hist[i] < 0) score--;
    out[i] = score >= 2 ? "up" : score <= -2 ? "down" : "neutral";
  }
  return out;
}

/**
 * Calcula todos os indicadores uma única vez sobre a série completa.
 * Como EMA/RSI/MACD/ATR/SuperTrend são recursivos desde o início, ler o índice i
 * dá exatamente o mesmo valor que recalcular sobre candles.slice(0, i+1) — logo,
 * usar isto num backtest não introduz lookahead.
 */
export function computeIndicators(candles, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const close = candles.map((c) => Number(c.close ?? 0));
  const high = candles.map((c) => Number(c.high ?? c.close ?? 0));
  const low = candles.map((c) => Number(c.low ?? c.close ?? 0));
  return {
    close,
    high,
    low,
    ema20: EMA(close, o.emaFast),
    ema50: EMA(close, o.emaSlow),
    rsi: RSI(close, o.rsiPeriod),
    macd: MACD(close),
    atr: ATR(high, low, close, o.atrPeriod),
    st: SuperTrend(high, low, close, o.stPeriod, o.stMult),
  };
}

/**
 * Avalia a estratégia NA vela `i`.
 * @param {Array} candles
 * @param {ReturnType<typeof computeIndicators>} ind
 * @param {number} i índice da vela a avaliar
 * @param {object} [opts]
 * @param {number[]|null} [opts.htfCloses] fechamentos do timeframe maior COM ts <= candles[i].ts
 * @param {"up"|"down"|"neutral"|null} [opts.htfBias] viés HTF já calculado (mais rápido que htfCloses)
 */
export function evaluateBar(candles, ind, i, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { close, high, low, ema20, ema50, rsi, macd, atr, st } = ind;
  const htfCloses = opts.htfCloses ?? null;

  const price = close[i];
  const atrNow = Math.max(1e-9, atr[i]);

  // 4 votos independentes
  const emaBull = ema20[i] > ema50[i];
  const macdUp = macd.hist[i] > 0;
  const rsiUp = rsi[i] > 50;
  const trendUp = st.dir[i] === "up";
  const trendDn = st.dir[i] === "down";

  const longScore = [emaBull, macdUp, rsiUp, trendUp].filter(Boolean).length;
  const shortScore = [!emaBull, macd.hist[i] < 0, rsi[i] < 50, trendDn].filter(Boolean).length;

  // sinal "bruto" do consenso (antes do gate de probabilidade)
  let rawSignal = "NEUTRAL";
  let votesFor = Math.max(longScore, shortScore);
  if (longScore >= 3 && longScore >= shortScore) {
    rawSignal = "LONG";
    votesFor = longScore;
  } else if (shortScore >= 3 && shortScore > longScore) {
    rawSignal = "SHORT";
    votesFor = shortScore;
  }

  // Filtro HTF opcional (não muda o sinal; anota e pode reduzir a confiança)
  let htf;
  const htfBias =
    opts.htfBias ??
    (Array.isArray(htfCloses) && htfCloses.length >= 55
      ? trendBias(htfCloses.map(Number))
      : null);
  if (htfBias) {
    htf = { bias: htfBias };
    if (rawSignal === "LONG" && htfBias === "down") htf.conflict = true;
    if (rawSignal === "SHORT" && htfBias === "up") htf.conflict = true;
  }

  const confidence = rawSignal === "NEUTRAL" ? 0 : votesFor / 4;
  const adjConfidence =
    htf?.conflict && confidence > 0 ? Math.max(0, confidence - 0.25) : confidence;

  // ─── Probabilidade contínua (0..100%) ──────────────────────────────────────
  const emaComp = clampUnit(Math.tanh((ema20[i] - ema50[i]) / (0.0025 * price)));
  const rsiComp = clampUnit((rsi[i] - 50) / 25);
  const atrPct = atrNow / Math.max(1e-9, price);
  const macdComp = clampUnit(Math.tanh(macd.hist[i] / (0.5 * atrPct * price)));
  const stComp = st.dir[i] === "up" ? 1 : st.dir[i] === "down" ? -1 : 0;

  let edge = 0.3 * emaComp + 0.25 * rsiComp + 0.25 * macdComp + 0.2 * stComp;
  if (htf?.bias === "up") edge += 0.1;
  else if (htf?.bias === "down") edge -= 0.1;
  edge = clampUnit(edge);

  const biasUp = 1 / (1 + Math.exp(-3 * edge));
  const scoreForSignal =
    rawSignal === "LONG"
      ? biasUp
      : rawSignal === "SHORT"
      ? 1 - biasUp
      : Math.max(biasUp, 1 - biasUp);
  const probabilityPct = Math.round(scoreForSignal * 100);
  const biasUpPct = Math.round(biasUp * 100);

  // Gate de entrada: só vira COMPRA/VENDA com probabilidade suficiente
  const minProbEntry = o.minProbEntry ?? 0;
  const signal =
    rawSignal !== "NEUTRAL" && probabilityPct >= minProbEntry ? rawSignal : "NEUTRAL";
  const lean = rawSignal !== "NEUTRAL" ? rawSignal : biasUp >= 0.5 ? "LONG" : "SHORT";
  const stage = stageFor(signal, probabilityPct);

  // Níveis por ATR + swing recente (janela ATÉ i — sem lookahead)
  const lb = Math.min(o.lookback, i);
  const entry = price;
  let stop = null;
  let tp1 = null;
  let tp2 = null;
  if (signal === "LONG") {
    const recentLow = Math.min(...low.slice(i - lb, i + 1));
    stop = recentLow - 0.5 * atrNow;
    const risk = Math.max(1e-9, entry - stop);
    tp1 = entry + o.rr1 * risk;
    tp2 = entry + o.rr2 * risk;
  } else if (signal === "SHORT") {
    const recentHigh = Math.max(...high.slice(i - lb, i + 1));
    stop = recentHigh + 0.5 * atrNow;
    const risk = Math.max(1e-9, stop - entry);
    tp1 = entry - o.rr1 * risk;
    tp2 = entry - o.rr2 * risk;
  }

  const reasons = buildReasons({
    signal,
    rawSignal,
    probability: probabilityPct,
    minProbEntry,
    emaBull,
    rsi: rsi[i],
    macdHist: macd.hist[i],
    stDir: st.dir[i],
    atrPct: 100 * atrPct,
    htf,
  });

  return {
    signal,
    rawSignal,
    stage, // "go" | "ready" | "watch" | "none" — alimenta as cores do painel
    lean, // direção de interesse quando ainda não há sinal ("LONG"/"SHORT")
    probability: probabilityPct,
    biasUp: biasUpPct,
    confidence: round(adjConfidence, 2),
    consensus: `${votesFor}/4`,
    votes: { long: longScore, short: shortScore },
    edge: round(edge, 3),
    price: round(price, 6),
    indicators: {
      ema20: round(ema20[i], 6),
      ema50: round(ema50[i], 6),
      rsi14: round(rsi[i], 2),
      macdHist: round(macd.hist[i], 6),
      atr14: round(atrNow, 6),
      supertrend: st.dir[i],
      htf: htf || undefined,
    },
    levels: {
      entry: round(entry, 6),
      stop: stop != null ? round(stop, 6) : null,
      tp1: tp1 != null ? round(tp1, 6) : null,
      tp2: tp2 != null ? round(tp2, 6) : null,
    },
    reasons,
    why: reasons, // alias de compatibilidade com o front
    candlesUsed: i + 1,
    lastCandleAt: candles[i]?.ts ? new Date(Number(candles[i].ts)).toISOString() : null,
  };
}

/**
 * Avalia a ÚLTIMA vela. Mantém a assinatura/saída originais.
 * @param {object} [opts]
 * @param {number[]|null} [opts.htfCloses] fechamentos do timeframe maior (série toda)
 */
export function analyzeCandles(candles, opts = {}) {
  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < 60) {
    throw new Error("Poucas velas para análise (mínimo 60; use limit >= 120).");
  }
  const ind = computeIndicators(candles, opts);
  return evaluateBar(candles, ind, n - 1, opts);
}

function buildReasons({ signal, rawSignal, probability, minProbEntry, emaBull, rsi, macdHist, stDir, atrPct, htf }) {
  const out = [];
  out.push(
    emaBull
      ? "EMA20 acima da EMA50 (viés altista)."
      : "EMA20 abaixo da EMA50 (viés baixista)."
  );
  if (rsi >= 70) out.push(`RSI(14) sobrecomprado (${round(rsi, 1)}).`);
  else if (rsi <= 30) out.push(`RSI(14) sobrevendido (${round(rsi, 1)}).`);
  else out.push(`RSI(14) ${rsi > 50 ? "acima de 50" : "abaixo de 50"} (${round(rsi, 1)}).`);
  out.push(`MACD histograma ${macdHist >= 0 ? "positivo" : "negativo"} (${round(macdHist, 4)}).`);
  if (stDir === "up") out.push("SuperTrend em tendência de alta.");
  else if (stDir === "down") out.push("SuperTrend em tendência de baixa.");
  out.push(`Volatilidade (ATR14) ≈ ${round(atrPct, 2)}% do preço.`);
  if (htf?.bias && htf.bias !== "neutral") {
    out.push(
      htf.conflict
        ? `Atenção: timeframe maior está ${htf.bias === "up" ? "altista" : "baixista"}, contra o sinal.`
        : `Timeframe maior confirma (${htf.bias === "up" ? "altista" : "baixista"}).`
    );
  }
  if (signal === "NEUTRAL") {
    if (rawSignal !== "NEUTRAL" && probability < (minProbEntry ?? 85)) {
      out.push(
        `Consenso a favor de ${rawSignal}, mas probabilidade ${probability}% < ${minProbEntry}% — aguardando confirmação.`
      );
    } else {
      out.push("Sem consenso mínimo (3/4) — melhor aguardar.");
    }
  }
  return out;
}
