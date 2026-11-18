import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runBacktest, runGrid, chopSeries } from "../src/services/backtest.js";

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

test("tightenOnAdverseAtr: vela forte contra aproxima o stop (só aperta) e perde menos que o stop original", () => {
  // sobe 45 velas, cai 3 de uma vez (vela forte contra) e segue descendo devagar até o stop original
  const cs = series((i) => { const k = Math.floor(i / 60), m = i % 60; return m < 45 ? 100 + k * 10 + m * 0.5 : 100 + k * 10 + 19.5 - (m - 45) * 0.6; }, 400);
  const opts = { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 2 };
  const base = runBacktest(cs, opts);
  const cut = runBacktest(cs, { ...opts, tightenOnAdverseAtr: 1 });
  assert.equal(base.tradeList.filter((t) => t.reason === "cut").length, 0);
  const cuts = cut.tradeList.filter((t) => t.reason === "cut");
  assert.ok(cuts.length >= 1, JSON.stringify(cut.trades.byReason));
  for (const t of cuts) {
    assert.ok(t.barsHeld >= 1);
    // o stop final ficou mais perto (ou do lado do lucro) que o da entrada
    assert.ok(t.dir === "LONG" ? t.stop > t.initStop : t.stop < t.initStop);
    assert.ok(t.netR > -0.6, `perda cortada: ${t.netR}`);
  }
  const sum = (r) => r.tradeList.reduce((x, t) => x + t.netR, 0);
  assert.ok(sum(cut) > sum(base), `${sum(cut)} > ${sum(base)}`);
  assert.equal(cut.meta.params.exit.tightenOnAdverseAtr, 1);
  assert.deepEqual(cut, runBacktest(cs, { ...opts, tightenOnAdverseAtr: 1 }));
});

test("maxStopPct: não abre trade com stop longe demais (como o Ricardo no bot)", () => {
  const cs = series((i) => 100 + i * 0.5 + 10 * Math.sin(i / 7), 400);
  const opts = { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 2 };
  const all = runBacktest(cs, { ...opts, maxStopPct: null });
  const capped = runBacktest(cs, { ...opts, maxStopPct: 2 });
  const pct = (t) => (Math.abs(t.entry - t.initStop) / t.entry) * 100;
  assert.ok(all.tradeList.some((t) => pct(t) > 2), "a série precisa ter stops largos");
  assert.ok(capped.tradeList.every((t) => pct(t) <= 2 + 1e-9));
  assert.equal(runBacktest(cs, opts).meta.params.exit.maxStopPct, 15);
});

test("chopSeries: marca lateral agitado, não tendência nem lateral calmo", () => {
  const day = (i, c, range) => ({ ts: i * 86_400_000, open: c, high: c + range, low: c - range, close: c });
  const cs = [];
  for (let i = 0; i < 230; i++) cs.push(day(i, 100 + i * 0.5, 0.5)); // tendência calma
  for (let i = 230; i < 260; i++) cs.push(day(i, 215 + (i % 2 ? 4 : -4), 6)); // lateral agitado
  const chop = chopSeries(cs, 0.2);
  assert.equal(chop.slice(0, 230).some(Boolean), false, "tendência não é caos");
  assert.equal(chop[259], true, "lateral com volatilidade alta é caos");
  assert.equal(chopSeries(cs, 0.01)[259], true);
  const calm = cs.map((c, i) => (i >= 230 ? day(i, 215 + (i % 2 ? 0.1 : -0.1), 0.2) : c));
  assert.equal(chopSeries(calm, 0.2)[259], false, "lateral calmo não é caos");
});

test("skipChop: não abre trade quando o período maior está em caos", () => {
  const cs = series((i) => 100 + i * 0.5 + 10 * Math.sin(i / 7), 400);
  const opts = { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 2 };
  // período maior todo em caos: alterna forte, sem sair do lugar, com volatilidade crescente
  const htf = Array.from({ length: 260 }, (_, k) => {
    const c = 100 + (k % 2 ? 1 : -1) * (1 + k * 0.05);
    return { ts: cs[0].ts - (260 - k) * 3_600_000 + 400 * 3_600_000, open: c, high: c + 1 + k * 0.05, low: c - 1 - k * 0.05, close: c };
  });
  const free = runBacktest(cs, { ...opts, htfCandles: htf });
  const skip = runBacktest(cs, { ...opts, htfCandles: htf, skipChop: 0.2 });
  assert.ok(free.tradeList.length > 0);
  assert.ok(skip.tradeList.length < free.tradeList.length);
  assert.equal(skip.meta.params.filters.skipChop, 0.2);
  assert.equal(runBacktest(cs, opts).meta.params.filters.skipChop, null);
});

test("alignHtfByClose: vela diária só aparece quando fecha", async () => {
  const { alignHtfByClose } = await import("../src/services/backtest.js");
  const day = [{ ts: 0, close: 1 }, { ts: 86_400_000, close: 2 }];
  const a = alignHtfByClose(day, "60", "D");
  assert.equal(a[0].ts, 86_400_000 - 3_600_000); // última vela de 1h do dia
  assert.equal(alignHtfByClose(day, "60", "240")[1].ts, 86_400_000 + 3 * 3_600_000);
  assert.equal(alignHtfByClose(null, "60", "D"), null);
});

test("fundingCrowd: não vende com a multidão vendida nem compra com a multidão comprada", () => {
  const cs = series((i) => 100 + 20 * Math.sin(i / 25) + 3 * Math.sin(i / 4), 400);
  const opts = { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 2 };
  const fund = (rate) => Array.from({ length: 60 }, (_, k) => ({ ts: cs[0].ts + k * 8 * 3_600_000, rate }));
  const free = runBacktest(cs, opts).tradeList;
  const shortsCrowded = runBacktest(cs, { ...opts, fundingCrowd: 0.0003, funding: fund(-0.001) }).tradeList;
  const longsCrowded = runBacktest(cs, { ...opts, fundingCrowd: 0.0003, funding: fund(0.002) }).tradeList;
  const normal = runBacktest(cs, { ...opts, fundingCrowd: 0.0003, funding: fund(0.0001) }).tradeList;
  assert.ok(free.some((t) => t.dir === "SHORT") && free.some((t) => t.dir === "LONG"));
  assert.equal(shortsCrowded.some((t) => t.dir === "SHORT"), false);
  assert.ok(shortsCrowded.some((t) => t.dir === "LONG"));
  assert.equal(longsCrowded.some((t) => t.dir === "LONG"), false);
  assert.deepEqual(normal, free, "funding normal não muda nada");
  assert.deepEqual(runBacktest(cs, { ...opts, fundingCrowd: 0.0003 }).tradeList, free, "sem dados de funding o filtro não age");
});

test("skipLowAdx: não abre com o mercado parado (ADX baixo)", async () => {
  const { adxSeries } = await import("../src/services/backtest.js");
  const trend = series((i) => 100 + i * 0.8, 200);
  const flat = series((i) => 100 + (i % 2 ? 0.5 : -0.5) + 0.3 * Math.sin(i / 5), 200);
  assert.ok(adxSeries(trend).at(-1) > 40, "tendência limpa tem ADX alto");
  assert.ok(adxSeries(flat).at(-1) < 20, "lateral tem ADX baixo");
  const cs = series((i) => 100 + 20 * Math.sin(i / 25) + 3 * Math.sin(i / 4), 400);
  const opts = { warmup: 60, minProbEntry: 0, singleTarget: true, rr1: 2 };
  const adx = adxSeries(cs);
  const free = runBacktest(cs, opts);
  // limite = mediana do ADX nos sinais que entraram: metade deles fica abaixo
  const atEntry = free.tradeList.map((t) => adx[t.entryIdx - 1]).sort((x, y) => x - y);
  const thr = atEntry[atEntry.length >> 1];
  const skip = runBacktest(cs, { ...opts, skipLowAdx: thr });
  assert.ok(skip.tradeList.length < free.tradeList.length);
  for (const t of skip.tradeList) assert.ok(adx[t.entryIdx - 1] >= thr, "toda entrada tem ADX >= limite no sinal");
  assert.equal(skip.meta.params.filters.skipLowAdx, thr);
});
