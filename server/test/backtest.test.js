import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runBacktest, runGrid } from "../src/services/backtest.js";

function series(fn, n = 400) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = fn(i);
    out.push({
      ts: 1_700_000_000_000 + i * 3_600_000,
      open: fn(Math.max(0, i - 1)),
      high: c + Math.abs(c) * 0.002,
      low: c - Math.abs(c) * 0.002,
      close: c,
      volume: 100,
    });
  }
  return out;
}

test("alta com ondas -> trades LONG lucrativos", () => {
  const r = runBacktest(series((i) => 100 + i * 0.6 + 8 * Math.sin(i / 9)), { warmup: 60 });
  assert.ok(r.trades.n >= 3, `poucos trades: ${r.trades.n}`);
  assert.ok(r.trades.expectancyR > 0, `expectativa: ${r.trades.expectancyR}`);
  assert.ok(r.trades.winRate >= 0.5, `winRate: ${r.trades.winRate}`);
  assert.ok(r.trades.totalReturnPct > 0);
  assert.ok(r.tradeList.every((t) => t.dir === "LONG"));
});

test("baixa com ondas -> trades SHORT lucrativos", () => {
  const r = runBacktest(series((i) => 300 - i * 0.6 - 8 * Math.sin(i / 9)), { warmup: 60 });
  assert.ok(r.trades.n >= 3);
  assert.ok(r.trades.expectancyR > 0);
  assert.ok(r.tradeList.every((t) => t.dir === "SHORT"));
});

test("retorno futuro coerente com a direção da tendência", () => {
  const up = runBacktest(series((i) => 100 + i), { warmup: 60 });
  assert.ok(up.byForwardBar[20].winRate > 0.8, `up fwd20 winRate ${up.byForwardBar[20].winRate}`);
  const down = runBacktest(series((i) => 500 - i), { warmup: 60 });
  assert.ok(down.byForwardBar[20].winRate > 0.8, `down fwd20 winRate ${down.byForwardBar[20].winRate}`);
});

test("shape do report é sólido e a soma das faixas bate", () => {
  const r = runBacktest(series((i) => 100 + i * 0.4 + 10 * Math.sin(i / 7)), { warmup: 60 });
  for (const v of Object.values(r.trades)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v));
  }
  assert.equal(r.trades.equityCurve.length, r.trades.n + 1);
  assert.equal(
    r.calibration.reduce((s, b) => s + b.n, 0),
    r.meta.signals
  );
  assert.ok(r.calibration.every((b) => b.winRate == null || (b.winRate >= 0 && b.winRate <= 1)));
});

test("determinístico: mesma entrada -> mesmo report", () => {
  const mk = () => series((i) => 100 + i * 0.5 + 6 * Math.sin(i / 8));
  assert.deepEqual(runBacktest(mk(), { warmup: 60 }), runBacktest(mk(), { warmup: 60 }));
});

test("poucas velas -> erro", () => {
  assert.throws(() => runBacktest(series((i) => i, 70), { warmup: 60 }), /Poucas velas/);
});

test("exitOnReverse:false -> nenhuma saída por 'reverse'", () => {
  const cs = series((i) => 100 + i * 0.5 + 12 * Math.sin(i / 6), 400);
  const withRev = runBacktest(cs, { warmup: 60, minProbEntry: 0, exitOnReverse: true });
  const noRev = runBacktest(cs, { warmup: 60, minProbEntry: 0, exitOnReverse: false });
  assert.ok((withRev.trades.byReason.reverse ?? 0) >= 0);
  assert.equal(noRev.trades.byReason.reverse ?? 0, 0);
});

test("breakevenAfterTp1 -> aparecem saídas em 'be' perto do zero", () => {
  const cs = series((i) => 100 + i * 0.5 + 10 * Math.sin(i / 7), 400);
  const r = runBacktest(cs, { warmup: 60, minProbEntry: 0, breakevenAfterTp1: true });
  const be = r.tradeList.filter((t) => t.reason === "be");
  if (be.length) {
    assert.ok(be.every((t) => Math.abs(t.netR) < 0.6), JSON.stringify(be.map((t) => t.netR)));
  }
  assert.ok(r.tradeList.every((t) => Number.isFinite(t.netR)));
});

test("trailAtr -> saídas por 'trail' e determinístico", () => {
  // sobe com repuxos periódicos de -20 que acionam o trailing stop
  const cs = series((i) => 100 + i * 0.5 - (i % 40 >= 37 ? 20 : 0), 400);
  const r = runBacktest(cs, { warmup: 60, minProbEntry: 0, trailAtr: 2, exitOnReverse: false });
  const r2 = runBacktest(cs, { warmup: 60, minProbEntry: 0, trailAtr: 2, exitOnReverse: false });
  assert.deepEqual(r, r2);
  assert.ok((r.trades.byReason.trail ?? 0) >= 1, JSON.stringify(r.trades.byReason));
});

test("runGrid -> ranking por expectativa, best definido", () => {
  const cs = series((i) => 100 + i * 0.5 + 9 * Math.sin(i / 8), 500);
  const g = runGrid(cs, { warmup: 60, minTrades: 5 });
  assert.ok(g.variants.length > 10);
  for (let k = 1; k < g.variants.length; k++) {
    assert.ok(g.variants[k - 1].expectancyR >= g.variants[k].expectancyR);
  }
  assert.ok(g.best);
  assert.ok(g.best.trades >= 5 || g.note);
});

test("fixture real da Bybit roda sem quebrar", () => {
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
  const r = runBacktest(candles, { warmup: 60, meta: { symbol: "BTCUSDT", interval: "5" } });
  assert.ok(r.trades.n >= 0);
  assert.ok(r.meta.signals >= 0);
  assert.equal(r.meta.candles, candles.length);
});

test("alvo único (como o bot): nunca sai no TP2, mesmo quando o TP2 fica antes do alvo", () => {
  // rr1 3 > rr2 2,5: antes da correção, trades que tocavam 2,5R saíam como ganho no TP2
  const cs = series((i) => 100 + i * 0.5 + 10 * Math.sin(i / 7), 400);
  const r = runBacktest(cs, { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 3 });
  assert.ok(r.tradeList.length > 0);
  assert.equal(r.tradeList.filter((t) => t.reason === "tp2").length, 0, JSON.stringify(r.trades.byReason));
});

test("breakevenAtR: o stop vai para a entrada depois de X R a favor (vela seguinte)", () => {
  const cs = series((i) => 100 + i * 0.5 - (i % 40 >= 37 ? 20 : 0), 400);
  const base = runBacktest(cs, { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 3 });
  const be = runBacktest(cs, { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 3, breakevenAtR: 1 });
  assert.equal(base.tradeList.filter((t) => t.reason === "be").length, 0);
  const exits = be.tradeList.filter((t) => t.reason === "be");
  assert.ok(exits.length >= 1, JSON.stringify(be.trades.byReason));
  for (const t of exits) {
    assert.ok(t.mfe >= 1, `mfe ${t.mfe}`);
    assert.ok(t.barsHeld >= 1);
    assert.ok(t.netR < 0 && t.netR > -0.3, `só os custos: ${t.netR}`); // sai na entrada, paga taxas
  }
  assert.deepEqual(be, runBacktest(cs, { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 3, breakevenAtR: 1 }));
});

test("trade guarda o stop da entrada (initStop) mesmo quando o stop anda", () => {
  const cs = series((i) => 100 + i * 0.5 - (i % 40 >= 37 ? 20 : 0), 400);
  const r = runBacktest(cs, { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 3, breakevenAtR: 1 });
  const moved = r.tradeList.filter((t) => t.reason === "be");
  assert.ok(moved.length >= 1);
  for (const t of moved) assert.ok(Math.abs(t.entry - t.initStop) > 0 && t.stop === t.entry);
});
