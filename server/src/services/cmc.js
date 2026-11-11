// server/src/services/cmc.js
import axios from "axios";

/* ============================ Config ============================ */
const CMC_BASE =
  process.env.CMC_BASE_URL?.replace(/\/$/, "") ||
  "https://pro-api.coinmarketcap.com/v1";
const CMC_KEY = process.env.CMC_API_KEY ?? "";

const CMC = axios.create({
  baseURL: CMC_BASE,
  headers: {
    "X-CMC_PRO_API_KEY": CMC_KEY,
    Accept: "application/json",
  },
  timeout: 12_000,
});

/* ============================ Helpers ============================ */
const cache = new Map();
/**
 * Memoization simples (cache em memória com TTL)
 */
async function memo(key, ttlMs, fetcher) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t <= ttlMs) return hit.v;
  const v = await fetcher();
  cache.set(key, { v, t: now });
  return v;
}

/**
 * Retry com backoff para 429/5xx
 */
async function withRetry(fn, tries = 2, baseDelay = 350) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status || e?.status;
      // 429/5xx → tenta de novo
      if (status === 429 || (status >= 500 && status <= 599)) {
        await new Promise((r) => setTimeout(r, baseDelay * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * Normaliza CMC → shape do front
 */
function normalizeCmcListings(arr, convert = "USD") {
  return arr.map((c) => ({
    name: c.name,
    symbol: c.symbol,
    cmc_rank: c.cmc_rank,
    quote: {
      USD: {
        price: c.quote?.[convert]?.price ?? null,
        volume_24h: c.quote?.[convert]?.volume_24h ?? null,
        percent_change_24h: c.quote?.[convert]?.percent_change_24h ?? null,
      },
    },
    source: "cmc",
  }));
}

/**
 * Normaliza CoinGecko → shape do front
 */
function normalizeCgListings(arr) {
  return arr.map((c) => ({
    name: c.name,
    symbol: (c.symbol || "").toUpperCase(),
    cmc_rank: c.market_cap_rank ?? null,
    quote: {
      USD: {
        price: c.current_price ?? null,
        volume_24h: c.total_volume ?? null,
        percent_change_24h: c.price_change_percentage_24h ?? null,
      },
    },
    source: "coingecko",
  }));
}

/* ============================ Endpoints ============================ */

/** -------- GLOBAL METRICS (cache 5 min) -------- */
export async function getGlobalMetrics() {
  return memo("cmc:global-metrics", 5 * 60_000, async () => {
    const { data } = await withRetry(() =>
      CMC.get("/global-metrics/quotes/latest")
    );
    return data.data;
  });
}

/**
 * -------- LISTINGS (Top N) com fallback e cache 60s --------
 * Retorna no shape:
 * { name, symbol, quote: { USD: { price, volume_24h, percent_change_24h } }, source }
 */
export async function getListingsLatest({ limit = 10, convert = "USD" } = {}) {
  const key = `cmc:listings:${limit}:${convert}`;
  return memo(key, 60_000, async () => {
    // 1) CMC
    try {
      const { data } = await withRetry(() =>
        CMC.get("/cryptocurrency/listings/latest", {
          params: { start: 1, limit, convert },
        })
      );
      const arr = Array.isArray(data?.data) ? data.data : [];
      return normalizeCmcListings(arr.slice(0, limit), convert);
    } catch (_) {
      // 2) CoinGecko fallback (sem chave)
      const { data } = await axios.get(
        "https://api.coingecko.com/api/v3/coins/markets",
        {
          params: {
            vs_currency: "usd",
            order: "market_cap_desc",
            per_page: limit,
            page: 1,
            price_change_percentage: "24h",
          },
          timeout: 12_000,
        }
      );
      const arr = Array.isArray(data) ? data : [];
      return normalizeCgListings(arr.slice(0, limit));
    }
  });
}

/** -------- NOVAS LISTAGENS (se o plano permitir) -------- */
export async function getNewListings({ limit = 10 } = {}) {
  // Sem cache aqui por ser mais eventual; trate erros e retorne []
  try {
    const { data } = await withRetry(() =>
      CMC.get("/cryptocurrency/listings/new", { params: { limit } })
    );
    return data.data ?? [];
  } catch {
    return [];
  }
}

/**
 * -------- CATEGORIAS / SETORES (cache 10 min) --------
 * CoinGecko como fonte primária: já traz market_cap_change_24h por categoria,
 * que a CMC não retorna em vários planos. CMC vira fallback (só nomes).
 */
export async function getCategories({ limit = 20 } = {}) {
  const key = `sectors:${limit}`;
  return memo(key, 10 * 60_000, async () => {
    try {
      const { data } = await axios.get(
        "https://api.coingecko.com/api/v3/coins/categories",
        { params: { order: "market_cap_change_24h_desc" }, timeout: 12_000 }
      );
      const arr = Array.isArray(data) ? data : [];
      return arr
        .filter(
          (c) =>
            c.market_cap_change_24h != null &&
            Number(c.market_cap) > 2e8 && // ignora micro-categorias ruidosas
            Math.abs(c.market_cap_change_24h) < 60
        )
        .sort((a, b) => b.market_cap_change_24h - a.market_cap_change_24h)
        .slice(0, limit)
        .map((c) => ({
          name: c.name ?? "Category",
          market_cap_change_24h: c.market_cap_change_24h ?? null,
          volume_change_24h: null,
        }));
    } catch {
      const { data } = await withRetry(() => CMC.get("/cryptocurrency/categories"));
      const arr = Array.isArray(data?.data) ? data.data : [];
      return arr.slice(0, limit).map((c) => ({
        name: c.name ?? c.title ?? "Category",
        market_cap_change_24h: c.market_cap_change_24h ?? null,
        volume_change_24h: c.volume_change_24h ?? null,
      }));
    }
  });
}

/** -------- QUOTES (cache 60s) -------- */
export async function getQuotesLatest({ symbol = "ETH", convert = "USD" } = {}) {
  const key = `cmc:quotes:${symbol}:${convert}`;
  return memo(key, 60_000, async () => {
    const { data } = await withRetry(() =>
      CMC.get("/cryptocurrency/quotes/latest", { params: { symbol, convert } })
    );
    return data.data;
  });
}
