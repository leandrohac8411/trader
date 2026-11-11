// client/src/services/api.js
// Cliente HTTP único do front. Base vazia => usa o proxy do Vite (/api -> :4000).

const API_BASE = import.meta?.env?.VITE_API_BASE?.replace(/\/$/, "") || "";

async function parseJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function request(
  path,
  { method = "GET", body, headers, timeout = 15000, retries = 0 } = {}
) {
  const url = /^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await parseJson(res);
    if (!res.ok) {
      if (retries > 0 && (res.status >= 500 || res.status === 429)) {
        await new Promise((r) => setTimeout(r, 300 * 2 ** (retries - 1)));
        return request(path, { method, body, headers, timeout, retries: retries - 1 });
      }
      throw new Error(json?.error || json?.message || `${res.status} ${res.statusText}`);
    }
    return json ?? {};
  } finally {
    clearTimeout(id);
  }
}

export const API = {
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
};

/* ----------------------------- CoinMarketCap ----------------------------- */
export const getGlobalMetrics = () => API.get("/api/cmc/global-metrics", { retries: 1 });

export async function getListingsLatest({ limit = 10, convert = "USD" } = {}) {
  const qs = `limit=${limit}&convert=${encodeURIComponent(convert)}`;
  return API.get(`/api/cmc/listings-latest?${qs}`, { retries: 1 });
}

export const getCategories = (limit = 20) =>
  API.get(`/api/cmc/categories?limit=${limit}`, { retries: 1 });

export const getNewListings = (limit = 10) =>
  API.get(`/api/cmc/new-listings?limit=${limit}`, { retries: 1 });

/* ------------------------------ ETH + F&G ------------------------------- */
export const getEthGas = () => API.get("/api/eth/gas", { retries: 1 });
export const getFearGreed = () => API.get("/api/fng", { retries: 1 });

/* -------------------------------- Bybit -------------------------------- */
export function getKlines(symbol = "BTCUSDT", interval = "1", category = "linear", limit = 200) {
  const q = new URLSearchParams({ symbol, interval: String(interval), category, limit: String(limit) });
  return API.get(`/api/bybit/kline?${q}`, { retries: 1 });
}

/* ------------------------------ Estratégia ------------------------------ */
export function analyzeStrategy({
  symbol = "BTCUSDT",
  interval = "5",
  limit = 300,
  category = "linear",
  htf = true,
} = {}) {
  const q = new URLSearchParams({
    symbol,
    interval: String(interval),
    limit: String(limit),
    category,
    htf: htf ? "1" : "0",
  });
  return API.get(`/api/strategy/analyze?${q}`, { retries: 0 });
}

/* ----------------------- Comentário de IA (Groq) ----------------------- */
export function aiAnalyze({ symbol = "BTCUSDT", interval = "60", limit = 300, category = "linear" } = {}) {
  const q = new URLSearchParams({ symbol, interval: String(interval), limit: String(limit), category });
  return API.get(`/api/ai/analyze?${q}`, { retries: 0, timeout: 30000 });
}

export const aiChat = (prompt) => API.post("/api/ai/chat", { prompt }, { timeout: 30000 });

/* ------------------------------ Backtest ------------------------------ */
export function runBacktest({ symbol = "BTCUSDT", interval = "60", bars = 1000, htf = true } = {}) {
  const q = new URLSearchParams({
    symbol,
    interval: String(interval),
    limit: String(bars),
    htf: htf ? "1" : "0",
  });
  return API.get(`/api/backtest?${q}`, { retries: 0, timeout: 45000 });
}

export function runBacktestGrid({ symbol = "BTCUSDT", interval = "60", bars = 1000, htf = true } = {}) {
  const q = new URLSearchParams({
    symbol,
    interval: String(interval),
    limit: String(bars),
    htf: htf ? "1" : "0",
  });
  return API.get(`/api/backtest/grid?${q}`, { retries: 0, timeout: 60000 });
}

/* ------------------------- Bot demo (forward-test) ------------------------- */
export const getBotStatus = () => API.get("/api/bot/status", { retries: 1, timeout: 20000 });
export const getBotReport = () => API.get("/api/bot/report", { retries: 1 });
export const getBotTrades = (limit = 100) => API.get(`/api/bot/trades?limit=${limit}`, { retries: 1 });
export const getBotWatch = () => API.get("/api/bot/watch", { retries: 1, timeout: 20000 });
export const getBotLog = (limit = 80) => API.get(`/api/bot/log?limit=${limit}`, { retries: 1 });
export const botPause = () => API.post("/api/bot/pause");
export const botResume = () => API.post("/api/bot/resume");
