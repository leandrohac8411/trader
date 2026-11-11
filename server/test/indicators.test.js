import test from "node:test";
import assert from "node:assert/strict";
import { SMA, EMA, RSI, MACD, ATR } from "../src/services/indicators.js";

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("SMA janela 3", () => {
  assert.deepEqual(SMA([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("EMA semeia com o primeiro valor (k=0.5 para período 3)", () => {
  const out = EMA([1, 2, 3, 4, 5], 3);
  assert.equal(out[0], 1);
  assert.ok(approx(out[1], 1.5));
  assert.ok(approx(out[2], 2.25));
  assert.ok(approx(out[3], 3.125));
  assert.ok(approx(out[4], 4.0625));
});

test("RSI = 100 em série só de altas, 0 em série só de baixas", () => {
  const up = Array.from({ length: 20 }, (_, i) => i + 1);
  const down = Array.from({ length: 20 }, (_, i) => 20 - i);
  assert.equal(RSI(up, 14).at(-1), 100);
  assert.equal(RSI(down, 14).at(-1), 0);
});

test("RSI tem o mesmo comprimento da entrada e nada de NaN", () => {
  const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i));
  const r = RSI(prices, 14);
  assert.equal(r.length, 50);
  assert.ok(r.every((v) => Number.isFinite(v)));
});

test("MACD de série constante -> histograma ~ 0", () => {
  const flat = Array(60).fill(100);
  const m = MACD(flat);
  assert.ok(approx(m.hist.at(-1), 0));
});

test("ATR de Wilder (período 2) confere com cálculo manual", () => {
  const high = [10, 12, 11];
  const low = [8, 9, 10];
  const close = [9, 11, 10];
  const atr = ATR(high, low, close, 2);
  assert.ok(approx(atr[0], 2));
  assert.ok(approx(atr[1], 2.5));
  assert.ok(approx(atr[2], 1.75));
});
