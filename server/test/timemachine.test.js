import test from "node:test";
import assert from "node:assert/strict";
import { simulate, verdict, barRatios, mulberry32, seedFrom, history } from "../src/services/timemachine.js";

// velas sintéticas: cada uma sobe/desce "step" com amplitude fixa
function series(n, step, start = 100, amp = 0.005) { // amp: pavio em fração do preço
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p, c = p * (1 + step);
    out.push({ ts: i * 3_600_000, open: o, high: Math.max(o, c) * (1 + amp), low: Math.min(o, c) * (1 - amp), close: c, volume: 1 });
    p = c;
  }
  return out;
}

test("mulberry32/seedFrom: mesma semente, mesma sequência", () => {
  const a = mulberry32(seedFrom("BTC|60|1")), b = mulberry32(seedFrom("BTC|60|1"));
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(seedFrom("BTC|60|1"), seedFrom("BTC|60|2"));
});

test("barRatios: proporções da vela anterior", () => {
  const r = barRatios([{ close: 100 }, { open: 100, high: 102, low: 99, close: 101 }]);
  assert.deepEqual(r, [{ o: 1, h: 1.02, l: 0.99, c: 1.01 }]);
});

test("simulate: em queda constante a venda bate o alvo e a compra bate o stop", () => {
  const c = series(200, -0.01);
  const short = simulate({ candles: c, dir: "SHORT", entry: 100, stop: 103, tp: 95.5, replays: 2000, seed: 1 });
  assert.equal(short.targetPct, 100);
  assert.ok(short.expectancyR > 1);
  const long = simulate({ candles: c, dir: "LONG", entry: 100, stop: 97, tp: 104.5, replays: 2000, seed: 1 });
  assert.equal(long.stopPct, 100);
  assert.ok(long.expectancyR < -1); // -1 R menos as taxas
  assert.equal(long.breakEvenPct, 40); // alvo 1,5R precisa de 40% só para empatar
});

test("simulate: mesma semente dá o mesmo resultado; poucas velas devolve null", () => {
  const c = series(200, 0.0005, 100, 0.012);
  const a = simulate({ candles: c, dir: "LONG", entry: 100, stop: 98, tp: 103, seed: 7 });
  const b = simulate({ candles: c, dir: "LONG", entry: 100, stop: 98, tp: 103, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.targetPct + a.stopPct + a.neitherPct, 100);
  assert.equal(simulate({ candles: series(10, 0), dir: "LONG", entry: 100, stop: 98, tp: 103 }), null);
});

test("verdict: barra só quando simulação e histórico concordam que perde", () => {
  const mcLose = { expectancyR: -0.2, targetFirstPct: 30, breakEvenPct: 40 };
  const mcWin = { expectancyR: 0.1, targetFirstPct: 50, breakEvenPct: 40 };
  const h = (exp, n = 20) => ({ all: { n, expectancyR: exp }, same: { n, expectancyR: exp } });
  assert.equal(verdict(mcLose, h(-0.1)).ok, false);
  assert.equal(verdict(mcLose, h(0.2)).ok, true); // histórico real contesta a simulação
  assert.equal(verdict(mcWin, h(-0.3)).ok, true);
  assert.equal(verdict(mcLose, h(-0.5, 3)).ok, false); // histórico curto não contesta
  assert.equal(verdict(null, null).ok, true); // sem dados não barra
  assert.match(verdict(mcLose, h(-0.1)).text, /simulação: alvo antes do stop em 30% \(empate 40%\), -0,20 R\/trade · histórico: 20 trades/);
});

test("history: roda a mesma regra do bot nas velas passadas", () => {
  const h = history({ candles: series(400, -0.002, 100, 0.003), dir: "SHORT" });
  assert.equal(h.candles, 400);
  assert.ok(h.all.n >= h.same.n);
  assert.equal(history({ candles: series(50, 0), dir: "SHORT" }), null);
});
