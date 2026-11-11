// server/src/services/fng.js
// Índice Fear & Greed (Alternative.me), com cache curto.

let _cache = { v: null, t: 0 };
const TTL = 5 * 60_000;

/** @returns {Promise<{ value:number|null, classification:string|null, timestamp:number|null }>} */
export async function getFearGreed() {
  const now = Date.now();
  if (_cache.v && now - _cache.t <= TTL) return _cache.v;

  const r = await fetch("https://api.alternative.me/fng/?limit=1");
  if (!r.ok) throw new Error(`FNG ${r.status} ${r.statusText}`);
  const j = await r.json();
  const d = j?.data?.[0];
  const out = d
    ? {
        value: Number(d.value),
        classification: d.value_classification ?? null,
        timestamp: Number(d.timestamp) * 1000,
      }
    : { value: null, classification: null, timestamp: null };

  _cache = { v: out, t: now };
  return out;
}
