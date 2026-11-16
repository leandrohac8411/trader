// Análise de lookahead (ideia do Freqtrade): o simulador não pode "espiar o futuro".
// Roda o backtest com TODAS as velas e de novo com as velas cortadas em vários pontos, como se o mundo
// acabasse ali. Todo trade que já tinha fechado antes do corte tem de sair IDÊNTICO nas duas rodadas;
// se mudar, alguma conta usou uma vela que ainda não existia.
import test from "node:test";
import assert from "node:assert/strict";
import { runBacktest, alignHtfByClose } from "../src/services/backtest.js";

const HOUR = 3_600_000, DAY = 86_400_000;

/** Passeio aleatório com semente: tendências, lateralizações e volatilidade que muda (para o filtro de caos agir). */
function makeCandles(n, seed = 7, { chopFrom = Infinity } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = [];
  let price = 100, drift = 0;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 900);
    if (i % 300 === 0) drift = (rnd() - 0.5) * 0.004;
    const vol = i >= chopFrom ? 0.03 : 0.004 + 0.006 * (wave + 1);
    if (wave > 0.3) drift *= 0.9; // fases agitadas andam de lado (caos lateral)
    if (i >= chopFrom) { drift = (100 - price) / price / 24; } // reta final: volta sempre para 100, bem agitada
    const open = price;
    price = Math.max(1, price * (1 + drift + (rnd() - 0.5) * vol));
    out.push({ ts: i * HOUR, open, high: Math.max(open, price) * (1 + rnd() * vol / 2), low: Math.min(open, price) * (1 - rnd() * vol / 2), close: price, volume: 1000 });
  }
  return out;
}

/** Vela diária montada com as velas de 1h que existem. A última pode estar incompleta (dia em andamento). */
function dailyFrom(candles) {
  const days = new Map();
  for (const c of candles) {
    const k = Math.floor(c.ts / DAY) * DAY;
    const d = days.get(k);
    if (!d) days.set(k, { ts: k, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, bars: 1 });
    else Object.assign(d, { high: Math.max(d.high, c.high), low: Math.min(d.low, c.low), close: c.close, volume: d.volume + c.volume, bars: d.bars + 1 });
  }
  return [...days.values()];
}
const closedDays = (candles) => dailyFrom(candles).filter((d) => d.bars === 24);

const PARAMS = { warmup: 400, minProbEntry: 60, singleTarget: true, rr1: 2, breakevenAtR: 1.5, tightenOnAdverseAtr: 1, skipChop: 0.2 };
// cortes espalhados (inclusive no meio do dia): a decisão de TODA vela antes do corte tem de ser igual
const CUTS = Array.from({ length: 160 }, (_, j) => 2600 + j * 23);
const sig = (t) => JSON.stringify(t);

/**
 * Compara, em cada corte, a decisão de cada vela (sinal, score, stop, alvo, caos) e os trades já fechados.
 * `htfFor(candlesVisíveis)` monta o período maior que o simulador receberia naquele momento.
 * @returns {{bars:number, trades:number}} quanto foi comparado
 */
function compare(candles, htfFor) {
  const fullRun = runBacktest(candles, { ...PARAMS, collectSignals: true, htfCandles: htfFor(candles) });
  const fullBars = new Map(fullRun.signalLog.map((x) => [x.i, sig(x)]));
  let bars = 0, trades = 0;
  for (const k of CUTS) {
    const seen = candles.slice(0, k);
    const cut = runBacktest(seen, { ...PARAMS, collectSignals: true, htfCandles: htfFor(seen) });
    for (const x of cut.signalLog) {
      assert.equal(sig(x), fullBars.get(x.i), `vela ${x.i} decidiu diferente com o corte em ${k}: o simulador olhou o futuro`);
      bars++;
    }
    const done = (l) => l.filter((t) => t.exitIdx < k - 2).map(sig);
    const a = done(fullRun.tradeList);
    assert.deepEqual(done(cut.tradeList), a, `trades diferentes antes do corte em ${k}: o simulador olhou o futuro`);
    trades += a.length;
  }
  return { bars, trades };
}

test("lookahead: simulador com a vela diária alinhada pelo fechamento não muda o passado", () => {
  const candles = makeCandles(6200);
  const n = compare(candles, (seen) => alignHtfByClose(closedDays(seen), "60", "D"));
  assert.ok(n.trades > 50, `poucos trades comparados (${n.trades}); o teste precisa de amostra`);
});

test("lookahead: o teste pega o erro antigo (vela diária pelo horário de abertura)", () => {
  // Controle negativo: é como o validate.mjs funcionava até 16/11/2026. Com o dia inteiro na mão às 10:00,
  // o passado muda quando o futuro é cortado; se este teste deixar de falhar, a análise ficou cega.
  const candles = makeCandles(6200);
  assert.throws(() => compare(candles, (seen) => dailyFrom(seen)), /olhou o futuro/);
});

test("lookahead: o filtro de caos lateral sozinho também não espia", () => {
  const candles = makeCandles(6200, 99, { chopFrom: 5200 });
  const htfFor = (seen) => alignHtfByClose(closedDays(seen), "60", "D");
  const log = runBacktest(candles, { ...PARAMS, collectSignals: true, htfCandles: htfFor(candles) }).signalLog;
  assert.ok(log.some((x) => x.chop) && log.some((x) => !x.chop), "a série precisa ter caos lateral e tendência");
  compare(candles, htfFor);
});
