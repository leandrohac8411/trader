import test from "node:test";
import assert from "node:assert/strict";
import { restoreUrl } from "../../api/_url.mjs";

test("restoreUrl reconstrói o caminho original do rewrite do Vercel", () => {
  assert.equal(restoreUrl("/api/index?__path=office/snapshot"), "/api/office/snapshot");
  assert.equal(restoreUrl("/api/index?__path=office%2Fagents%2Fceo%2Frun"), "/api/office/agents/ceo/run");
  assert.equal(restoreUrl("/api/index?__path=bot/tick&key=abc"), "/api/bot/tick?key=abc");
  assert.equal(restoreUrl("/api/office/snapshot"), "/api/office/snapshot"); // já original
  assert.equal(restoreUrl("/api/klines?symbol=BTCUSDT"), "/api/klines?symbol=BTCUSDT");
});
