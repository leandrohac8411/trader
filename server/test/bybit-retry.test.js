import test from "node:test";
import assert from "node:assert/strict";
import { getFundingHistory, _clearCache } from "../src/services/bybit.js";

test("Bybit: tenta de novo quando responde 'Too many visits' (limite de acessos)", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ retCode: 10006, retMsg: "Too many visits. Exceeded the API Rate Limit." }), { status: 403 });
    return new Response(JSON.stringify({ retCode: 0, result: { list: [{ fundingRateTimestamp: "1000", fundingRate: "0.0001" }] } }), { status: 200 });
  };
  try {
    _clearCache?.();
    const f = await getFundingHistory({ symbol: "RETRYUSDT", limit: 1 });
    assert.equal(calls, 2);
    assert.deepEqual(f, [{ ts: 1000, rate: 0.0001 }]);
  } finally {
    globalThis.fetch = real;
  }
});

test("Bybit: outros erros não são repetidos", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ retCode: 10001, retMsg: "params error" }), { status: 400 }); };
  try {
    _clearCache?.();
    await assert.rejects(getFundingHistory({ symbol: "BADUSDT", limit: 1 }), /params error/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = real;
  }
});
