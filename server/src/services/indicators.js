// server/src/services/indicators.js
// Biblioteca única de indicadores técnicos.
// Implementações "defensivas": nunca retornam undefined/NaN e sempre têm o mesmo
// comprimento do array de entrada (posições sem valor calculável são preenchidas).

function safeArray(len, fill = 0) {
  return Array.from({ length: len }, () => fill);
}

/** Média móvel simples. Posições < p-1 ficam null. */
export function SMA(values, p) {
  const n = values.length;
  const out = Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = Number(values[i] ?? 0);
    sum += v;
    if (i >= p) sum -= Number(values[i - p] ?? 0);
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

/** Desvio padrão populacional em janela p. */
export function STD(values, p) {
  const n = values.length;
  const out = Array(n).fill(null);
  const sma = SMA(values, p);
  for (let i = 0; i < n; i++) {
    if (sma[i] == null) continue;
    let s2 = 0;
    for (let j = i - p + 1; j <= i; j++) {
      const d = Number(values[j] ?? 0) - sma[i];
      s2 += d * d;
    }
    out[i] = Math.sqrt(s2 / p);
  }
  return out;
}

/** EMA. Semeia com o primeiro valor; todas as posições preenchidas. */
export function EMA(prices, period) {
  const n = prices.length;
  const out = safeArray(n, 0);
  if (n === 0 || period <= 0) return out;
  const k = 2 / (period + 1);
  let ema = Number(prices[0] ?? 0);
  out[0] = ema;
  for (let i = 1; i < n; i++) {
    const p = Number(prices[i] ?? ema);
    ema = p * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function rsiFrom(avgGain, avgLoss) {
  if (avgGain === 0 && avgLoss === 0) return 50; // série sem variação
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** RSI de Wilder. Posições < period recebem o primeiro RSI calculado. */
export function RSI(prices, period = 14) {
  const n = prices.length;
  const out = safeArray(n, 50);
  if (n < period + 1) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = Number(prices[i] ?? 0) - Number(prices[i - 1] ?? 0);
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = rsiFrom(avgGain, avgLoss);

  for (let i = period + 1; i < n; i++) {
    const diff = Number(prices[i] ?? 0) - Number(prices[i - 1] ?? 0);
    const g = Math.max(0, diff);
    const l = Math.max(0, -diff);
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  for (let i = 0; i < period; i++) out[i] = out[period];
  return out;
}

/** MACD (linha, sinal, histograma). */
export function MACD(prices, fast = 12, slow = 26, signal = 9) {
  const n = prices.length;
  const macd = safeArray(n, 0);
  const signalLine = safeArray(n, 0);
  const hist = safeArray(n, 0);
  if (n === 0) return { macd, signal: signalLine, hist };

  const emaFast = EMA(prices, fast);
  const emaSlow = EMA(prices, slow);
  for (let i = 0; i < n; i++) macd[i] = emaFast[i] - emaSlow[i];

  const emaSignal = EMA(macd, signal);
  for (let i = 0; i < n; i++) {
    signalLine[i] = emaSignal[i];
    hist[i] = macd[i] - signalLine[i];
  }
  return { macd, signal: signalLine, hist };
}

/** ATR de Wilder. */
export function ATR(high, low, close, period = 14) {
  const n = close.length;
  const out = safeArray(n, 0);
  if (n === 0) return out;

  const tr = safeArray(n, 0);
  for (let i = 0; i < n; i++) {
    const h = Number(high[i] ?? close[i] ?? 0);
    const l = Number(low[i] ?? close[i] ?? 0);
    const pc = i > 0 ? Number(close[i - 1] ?? close[i] ?? 0) : Number(close[i] ?? 0);
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let atr = tr[0];
  out[0] = atr;
  for (let i = 1; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * SuperTrend simplificado: direção "up" / "down" / "neutral" por vela.
 * Usa banda média ± mult*ATR e mantém a tendência anterior quando o preço
 * fica dentro das bandas.
 */
export function SuperTrend(high, low, close, period = 7, mult = 3) {
  const n = close.length;
  const dir = Array.from({ length: n }, () => "neutral");
  const upper = safeArray(n, 0);
  const lower = safeArray(n, 0);
  if (n === 0) return { dir, upper, lower };

  const atr = ATR(high, low, close, period);
  for (let i = 0; i < n; i++) {
    const mid = ((Number(high[i] ?? close[i] ?? 0)) + (Number(low[i] ?? close[i] ?? 0))) / 2;
    upper[i] = mid + mult * atr[i];
    lower[i] = mid - mult * atr[i];
  }
  let trend = "neutral";
  for (let i = 1; i < n; i++) {
    const c = Number(close[i] ?? close[i - 1] ?? 0);
    trend = c > upper[i - 1] ? "up" : c < lower[i - 1] ? "down" : trend;
    dir[i] = trend;
  }
  dir[0] = dir[1] || "neutral";
  return { dir, upper, lower };
}

export function lastN(arr, n = 1) {
  return arr.length ? arr[arr.length - n] : null;
}
