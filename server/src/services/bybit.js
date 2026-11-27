// server/src/services/bybit.js
// Cliente único da Bybit (mercado público v5) com cache TTL em memória.

const BYBIT_BASE = (process.env.BYBIT_BASE_URL || "https://api.bybit.com").replace(/\/$/, "");

const toNum = (n, d = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
};

// ───────────────────────── cache simples com TTL ─────────────────────────
const cache = new Map();
async function memo(key, ttlMs, fetcher) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t <= ttlMs) return hit.v;
  const v = await fetcher();
  cache.set(key, { v, t: now });
  return v;
}

const isRateLimit = (status, text) => status === 403 || status === 429 || /too many visits|rate limit/i.test(String(text));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Busca com até 2 novas tentativas quando a Bybit responde "muitos acessos" (limite por IP). */
async function fetchJson(url, signal, attempt = 0) {
  try {
    return await fetchJsonOnce(url, signal);
  } catch (e) {
    if (attempt < 2 && isRateLimit(e.status, e.message)) {
      await sleep(1500 * (attempt + 1));
      return fetchJson(url, signal, attempt + 1);
    }
    throw e;
  }
}

async function fetchJsonOnce(url, signal) {
  const r = await fetch(url, { signal:signal || AbortSignal.timeout(20_000) });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* corpo não-JSON */
  }
  if (!r.ok) {
    const e = new Error(json?.retMsg || json?.message || `${r.status} ${r.statusText}`);
    e.status = r.status;
    throw e;
  }
  if (json && json.retCode !== 0) {
    const e = new Error(json.retMsg || "Bybit error");
    e.status = 502;
    e.raw = json;
    throw e;
  }
  return json ?? {};
}

/**
 * Klines normalizadas em ordem ASCENDENTE (mais antiga -> mais recente).
 * TTL do cache é curto e proporcional ao timeframe.
 * @returns {Promise<Array<{ts:number,open:number,high:number,low:number,close:number,volume:number,turnover:number}>>}
 */
export async function getKlines({
  symbol = "BTCUSDT",
  interval = "1",
  limit = 300,
  category = "linear",
  signal,
  start,
  end,
} = {}) {
  const sym = String(symbol).toUpperCase();
  const iv = String(interval);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000);
  const cat = String(category);

  const q = new URLSearchParams({ category: cat, symbol: sym, interval: iv, limit: String(lim) });
  if (Number.isFinite(start)) q.set("start", String(Math.floor(start)));
  if (Number.isFinite(end)) q.set("end", String(Math.floor(end)));
  const url = `${BYBIT_BASE}/v5/market/kline?${q}`;

  // 1m -> 10s de cache; timeframes maiores -> mais tempo
  const ivMin = iv.toUpperCase() === "D" ? 1440 : iv.toUpperCase() === "W" ? 10080 : parseInt(iv, 10) || 1;
  const ttl = Math.min(5 * 60_000, Math.max(10_000, ivMin * 1000));

  return memo(`kline:${cat}:${sym}:${iv}:${lim}:${start ?? ""}:${end ?? ""}`, ttl, async () => {
    const json = await fetchJson(url, signal);
    const list = Array.isArray(json?.result?.list) ? json.result.list : [];
    return list
      .slice()
      .reverse()
      .map((r) => ({
        ts: toNum(r?.[0]),
        open: toNum(r?.[1]),
        high: toNum(r?.[2]),
        low: toNum(r?.[3]),
        close: toNum(r?.[4]),
        volume: toNum(r?.[5]),
        turnover: toNum(r?.[6]),
      }));
  });
}

/** Cotação 24h (preço, variação, volume) dos contratos USDT pedidos, na ordem pedida. Cache de 20 s. */
let tickCache = null;
/**
 * Histórico de funding (público). Cada item: { ts: hora da liquidação, rate: taxa (0.0001 = 0,01%) }, do mais antigo ao mais novo.
 * 200 liquidações cobrem ~66 dias com funding de 8h, mais que as 1.000 velas de 1h da escola.
 */
export async function getFundingHistory({ symbol = "BTCUSDT", limit = 200, category = "linear", endTime, signal } = {}) {
  const sym = String(symbol).toUpperCase();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 200);
  const q = new URLSearchParams({ category: String(category), symbol: sym, limit: String(lim) });
  if (Number.isFinite(endTime)) q.set("endTime", String(Math.floor(endTime)));
  return memo(`funding:${category}:${sym}:${lim}:${endTime ?? ""}`, 10 * 60_000, async () => {
    const json = await fetchJson(`${BYBIT_BASE}/v5/market/funding/history?${q}`, signal);
    const list = Array.isArray(json?.result?.list) ? json.result.list : [];
    return list
      .map((r) => ({ ts: toNum(r?.fundingRateTimestamp), rate: toNum(r?.fundingRate) }))
      .filter((r) => r.ts > 0 && Number.isFinite(r.rate))
      .sort((x, y) => x.ts - y.ts);
  });
}

export async function allLinearTickers() {
  if (!tickCache || Date.now() - tickCache.at > 20_000) {
    const json = await fetchJson(`${BYBIT_BASE}/v5/market/tickers?category=linear`);
    tickCache = { at: Date.now(), list: json.result?.list || [] };
  }
  return tickCache.list;
}
export async function getTickers(symbols) {
  const bySym = new Map((await allLinearTickers()).map((t) => [t.symbol, t]));
  return symbols.map((s) => bySym.get(s)).filter(Boolean).map((t) => ({
    symbol: t.symbol, price: Number(t.lastPrice), change24hPct: Number(t.price24hPcnt) * 100,
    turnover24h: Number(t.turnover24h), high24h: Number(t.highPrice24h), low24h: Number(t.lowPrice24h),
  }));
}

export function _clearCache() {
  cache.clear();
}
