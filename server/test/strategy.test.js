import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeCandles, higherTF, trendBias } from "../src/services/strategy.js";

function series(fn, n = 140) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = fn(i);
    out.push({ ts: 1_700_000_000_000 + i * 300_000, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 100 });
  }
  return out;
}

test("tendência de alta -> consenso LONG, níveis ordenados, probabilidade alta", () => {
  // minProbEntry: 0 isola a direção do gate de entrada
  const r = analyzeCandles(series((i) => 100 + i), { minProbEntry: 0 });
  assert.equal(r.signal, "LONG");
  assert.equal(r.rawSignal, "LONG");
  assert.ok(r.confidence >= 0.75);
  assert.ok([0, 0.25, 0.5, 0.75, 1].includes(r.confidence));
  assert.ok(Number.isInteger(r.probability) && r.probability >= 0 && r.probability <= 100);
  assert.ok(r.probability >= 70, `probabilidade baixa demais: ${r.probability}`);
  assert.ok(r.biasUp >= 80, `biasUp baixo demais: ${r.biasUp}`);
  const { entry, stop, tp1, tp2 } = r.levels;
  assert.ok(stop < entry && entry < tp1 && tp1 < tp2, JSON.stringify(r.levels));
});

test("tendência de baixa -> consenso SHORT, viés de alta baixo", () => {
  const r = analyzeCandles(series((i) => 300 - i), { minProbEntry: 0 });
  assert.equal(r.signal, "SHORT");
  assert.ok(r.probability >= 70, `probabilidade: ${r.probability}`);
  assert.ok(r.biasUp <= 20, `biasUp: ${r.biasUp}`);
  const { entry, stop, tp1, tp2 } = r.levels;
  assert.ok(stop > entry && entry > tp1 && tp1 > tp2, JSON.stringify(r.levels));
});

test("gate de entrada: consenso LONG mas probabilidade < minProbEntry -> NEUTRAL", () => {
  const r = analyzeCandles(series((i) => 100 + i), { minProbEntry: 99 });
  assert.equal(r.rawSignal, "LONG");
  assert.equal(r.signal, "NEUTRAL");
  assert.equal(r.levels.stop, null);
  assert.equal(r.stage, "ready"); // probabilidade alta, só não passou do gate
});

test("mais tendência -> mais viés de alta (monotônico)", () => {
  const fraca = analyzeCandles(series((i) => 100 + i * 0.05), { minProbEntry: 0 });
  const forte = analyzeCandles(series((i) => 100 + i * 1.5), { minProbEntry: 0 });
  assert.ok(forte.biasUp >= fraca.biasUp, `${forte.biasUp} < ${fraca.biasUp}`);
});

test("mercado sem variação -> NEUTRAL, sem níveis", () => {
  const r = analyzeCandles(series(() => 100));
  assert.equal(r.signal, "NEUTRAL");
  assert.equal(r.confidence, 0);
  assert.equal(r.levels.stop, null);
});

test("subiu e voltou (sem posição líquida) -> não dispara LONG forte", () => {
  // sobe 40 velas, desce 40, estabiliza 60
  const r = analyzeCandles(
    series((i) => (i < 40 ? 100 + i : i < 80 ? 140 - (i - 40) : 100), 160)
  );
  assert.notEqual(r.signal, "LONG");
});

test("poucas velas -> erro", () => {
  assert.throws(() => analyzeCandles(series((i) => i, 40)), /Poucas velas/);
});

test("filtro HTF em conflito derruba a confiança um degrau", () => {
  const candles = series((i) => 100 + i); // LTF altista
  const base = analyzeCandles(candles, { htfCloses: null });
  const conflicted = analyzeCandles(candles, {
    htfCloses: Array.from({ length: 80 }, (_, i) => 500 - i), // HTF baixista
  });
  assert.equal(conflicted.indicators.htf.conflict, true);
  assert.ok(conflicted.confidence <= base.confidence - 0.25 + 1e-9);
});

test("higherTF sobe um nível", () => {
  assert.equal(higherTF("1"), "15");
  assert.equal(higherTF("5"), "60");
  assert.equal(higherTF("60"), "D");
  assert.equal(higherTF("D"), "W");
});

test("trendBias detecta alta e baixa", () => {
  assert.equal(trendBias(Array.from({ length: 80 }, (_, i) => 100 + i)), "up");
  assert.equal(trendBias(Array.from({ length: 80 }, (_, i) => 500 - i)), "down");
});

test("fixture real da Bybit produz payload válido", () => {
  const raw = JSON.parse(readFileSync(new URL("./fixtures/btc-5m.json", import.meta.url)));
  const candles = raw.result.list
    .slice()
    .reverse()
    .map((r) => ({
      ts: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  const r = analyzeCandles(candles);
  assert.ok(["LONG", "SHORT", "NEUTRAL"].includes(r.signal));
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
  assert.ok(Number.isInteger(r.probability) && r.probability >= 0 && r.probability <= 100);
  assert.ok(Number.isInteger(r.biasUp) && r.biasUp >= 0 && r.biasUp <= 100);
  assert.match(r.consensus, /^[0-4]\/4$/);
  assert.equal(r.candlesUsed, candles.length);
});
