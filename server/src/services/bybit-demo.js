// server/src/services/bybit-demo.js
// Cliente PRIVADO da Bybit **Demo Trading** (dinheiro fake, preços reais do mainnet).
// Nunca lê BYBIT_API_KEY/SECRET (mainnet) — só BYBIT_DEMO_KEY/SECRET.
// Base URL travada; qualquer outra coisa lança erro.

import crypto from "node:crypto";

export const DEMO_BASE = "https://api-demo.bybit.com";
const RECV_WINDOW = "5000";

/** Segurança: garante que só falamos com a demo. */
export function assertDemoBase(url) {
  if (url !== DEMO_BASE) {
    throw new Error(`bybit-demo: base URL proibida (${url}). Só ${DEMO_BASE} é permitido.`);
  }
  return url;
}
assertDemoBase(DEMO_BASE);

/**
 * Assinatura Bybit v5 (HMAC-SHA256, X-BAPI-SIGN-TYPE 2).
 * GET : ts + apiKey + recvWindow + queryString
 * POST: ts + apiKey + recvWindow + rawJsonBody
 */
export function signV5({ apiKey, apiSecret, timestamp, recvWindow = RECV_WINDOW, payload = "" }) {
  const base = `${timestamp}${apiKey}${recvWindow}${payload}`;
  return crypto.createHmac("sha256", apiSecret).update(base).digest("hex");
}

export function demoConfigured() {
  return !!(process.env.BYBIT_DEMO_KEY && process.env.BYBIT_DEMO_SECRET);
}

async function parse(r) {
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* não-JSON */
  }
  if (!r.ok) {
    const e = new Error(json?.retMsg || `${r.status} ${r.statusText}`);
    e.status = r.status;
    throw e;
  }
  if (json && json.retCode !== 0) {
    const e = new Error(`Bybit ${json.retCode}: ${json.retMsg}`);
    e.status = 502;
    e.raw = json;
    throw e;
  }
  return json?.result ?? {};
}

async function priv(method, path, params = {}) {
  const apiKey = process.env.BYBIT_DEMO_KEY;
  const apiSecret = process.env.BYBIT_DEMO_SECRET;
  if (!apiKey || !apiSecret) throw new Error("BYBIT_DEMO_KEY/SECRET ausentes");

  const ts = String(Date.now());
  let url = `${assertDemoBase(DEMO_BASE)}${path}`;
  let body;
  let payload;

  if (method === "GET") {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
    ).toString();
    if (qs) url += `?${qs}`;
    payload = qs;
  } else {
    body = JSON.stringify(params);
    payload = body;
  }

  const sign = signV5({ apiKey, apiSecret, timestamp: ts, payload });
  const r = await fetch(url, {
    method,
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": sign,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });
  return parse(r);
}

// dados de mercado da demo == mainnet, e não precisam de assinatura
async function pub(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${DEMO_BASE}${path}${qs ? `?${qs}` : ""}`);
  return parse(r);
}

// ─────────────────────────────── API usada pelo bot ───────────────────────────────

/** Equity total da conta demo (UNIFIED), em USDT. */
export async function getEquity() {
  const res = await priv("GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" });
  const acc = res.list?.[0];
  const eq = Number(acc?.totalEquity);
  return Number.isFinite(eq) ? eq : 0;
}

const instrCache = new Map();
/** Filtros do instrumento: { qtyStep, minOrderQty, tickSize }. */
export async function getInstrument(symbol) {
  if (instrCache.has(symbol)) return instrCache.get(symbol);
  const res = await pub("/v5/market/instruments-info", { category: "linear", symbol });
  const it = res.list?.[0] || {};
  const out = {
    qtyStep: Number(it.lotSizeFilter?.qtyStep ?? 0.001),
    minOrderQty: Number(it.lotSizeFilter?.minOrderQty ?? 0.001),
    maxOrderQty: Number(it.lotSizeFilter?.maxOrderQty ?? Infinity),
    tickSize: Number(it.priceFilter?.tickSize ?? 0.01),
  };
  instrCache.set(symbol, out);
  return out;
}

export async function setLeverage(symbol, x = 2) {
  try {
    await priv("POST", "/v5/position/set-leverage", {
      category: "linear",
      symbol,
      buyLeverage: String(x),
      sellLeverage: String(x),
    });
  } catch (e) {
    // retCode 110043 = "leverage não modificada" → ok
    if (!/110043|not modified/i.test(e.message || "")) throw e;
  }
}

export async function placeMarketOrder({ symbol, side, qty }) {
  return priv("POST", "/v5/order/create", {
    category: "linear",
    symbol,
    side, // "Buy" | "Sell"
    orderType: "Market",
    qty: String(qty),
    positionIdx: 0,
  });
}

export async function setTradingStop({ symbol, stopLoss, takeProfit }) {
  return priv("POST", "/v5/position/trading-stop", {
    category: "linear",
    symbol,
    tpslMode: "Full",
    positionIdx: 0,
    ...(stopLoss != null ? { stopLoss: String(stopLoss) } : {}),
    ...(takeProfit != null ? { takeProfit: String(takeProfit) } : {}),
  });
}

/** Posições abertas (size > 0). */
export async function getPositions() {
  const res = await priv("GET", "/v5/position/list", { category: "linear", settleCoin: "USDT" });
  return (res.list || [])
    .filter((p) => Number(p.size) > 0)
    .map((p) => ({
      symbol: p.symbol,
      side: p.side, // Buy | Sell
      size: Number(p.size),
      entry: Number(p.avgPrice),
      unrealisedPnl: Number(p.unrealisedPnl),
      markPrice: Number(p.markPrice) || null,
      stopLoss: Number(p.stopLoss) || null,
      takeProfit: Number(p.takeProfit) || null,
    }));
}

export async function closeMarket({ symbol, side, qty }) {
  // fecha uma posição: ordem de mercado no lado oposto, reduceOnly
  return priv("POST", "/v5/order/create", {
    category: "linear",
    symbol,
    side: side === "Buy" ? "Sell" : "Buy",
    orderType: "Market",
    qty: String(qty),
    positionIdx: 0,
    reduceOnly: true,
  });
}

/** PnL realizado das últimas posições fechadas de um símbolo. */
export async function getClosedPnl({ symbol, limit = 20 }) {
  const res = await priv("GET", "/v5/position/closed-pnl", { category: "linear", symbol, limit });
  return (res.list || []).map((p) => ({
    symbol: p.symbol,
    side: p.side,
    qty: Number(p.qty),
    entry: Number(p.avgEntryPrice),
    exit: Number(p.avgExitPrice),
    closedPnl: Number(p.closedPnl),
    closedAt: Number(p.updatedTime),
  }));
}
