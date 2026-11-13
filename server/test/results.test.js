import test from "node:test";
import assert from "node:assert/strict";
import { computeResults } from "../src/services/results.js";

const mk = (rs) => rs.map((r, i) => ({ symbol: "BTCUSDT", tf: "60", dir: "LONG", netR: r, pnlUsd: r * 100, closedAt: 1000 + i }));

test("sem trades e amostra pequena não concluem nada", () => {
  assert.equal(computeResults([]).verdict.code, "sem-dados");
  const r = computeResults(mk([1.4, -0.15]));
  assert.equal(r.verdict.code, "amostra");
  assert.equal(r.n, 2);
  assert.equal(r.totalPnlUsd, 125);
  assert.match(r.verdict.detail, /2 de 30/);
});

test("veredito usa o intervalo de 95% da expectativa", () => {
  const pos = Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? -1 : 1)); // média 0,5 R
  assert.equal(computeResults(mk(pos)).verdict.code, "positivo");
  assert.equal(computeResults(mk(pos.map((r) => -r))).verdict.code, "negativo");
  const coin = Array.from({ length: 40 }, (_, i) => (i % 2 ? 1 : -1.05)); // média ~0
  const c = computeResults(mk(coin));
  assert.equal(c.verdict.code, "inconclusivo");
  assert.ok(c.ciR[0] < 0 && c.ciR[1] > 0);
});

test("curva, drawdown e lista recente ordenada", () => {
  const r = computeResults(mk([1, -2, -1, 3]));
  assert.deepEqual(r.curve.map((p) => p.pnl), [100, -100, -200, 100]);
  assert.equal(r.maxDrawdownUsd, 300);
  assert.equal(r.trades[0].netR, 3); // mais recente primeiro
  assert.equal(r.wins, 2);
  assert.equal(r.avgLossUsd, -150);
});

test("dailyResults: ganho, perda e líquido por dia no horário de Brasília", async () => {
  const { dailyResults, dayKey } = await import("../src/services/results.js");
  const at = (iso) => Date.parse(iso);
  const trades = [
    { closedAt: at("2026-11-12T05:12:00Z"), pnlUsd: 988 },  // 02:12 de 12/11 em Brasília
    { closedAt: at("2026-11-12T02:30:00Z"), pnlUsd: -400 }, // 23:30 de 11/11 em Brasília
    { closedAt: at("2026-11-11T22:48:00Z"), pnlUsd: 726 },
    { closedAt: at("2026-11-12T15:00:00Z"), pnlUsd: -1200 },
    { closedAt: null, pnlUsd: 50 },                          // sem fechamento: ignora
  ];
  const d = dailyResults(trades);
  assert.deepEqual(d.map((x) => x.day), ["2026-11-12", "2026-11-11"]);
  assert.deepEqual(d[0], { day: "2026-11-12", trades: 2, wins: 1, losses: 1, gainUsd: 988, lossUsd: -1200, netUsd: -212 });
  assert.deepEqual(d[1], { day: "2026-11-11", trades: 2, wins: 1, losses: 1, gainUsd: 726, lossUsd: -400, netUsd: 326 });
  assert.equal(dayKey(at("2026-11-13T02:59:00Z")), "2026-11-12");
});

test("computeResults conta só a rodada atual (trades abertos antes de 'since' ficam fora)", () => {
  const at = (iso) => Date.parse(iso);
  const trades = [
    { netR: -1, pnlUsd: -268.91, openedAt: at("2026-09-01T17:10:00Z"), closedAt: at("2026-09-01T17:11:00Z") },
    { netR: 1.4, pnlUsd: 766.12, openedAt: at("2026-09-03T03:01:00Z"), closedAt: at("2026-09-03T11:19:00Z") },
    { netR: 1.5, pnlUsd: 695.04, openedAt: at("2026-11-11T17:47:00Z"), closedAt: at("2026-11-11T23:07:00Z") },
    { netR: -1, pnlUsd: -876.4, openedAt: at("2026-11-13T02:42:00Z"), closedAt: at("2026-11-13T13:38:00Z") },
  ];
  const r = computeResults(trades, { since: "2026-11-11T00:00:00Z" });
  assert.equal(r.n, 2);
  assert.equal(r.excluded, 2);
  assert.equal(r.totalPnlUsd, -181.36);
  assert.equal(r.since, "2026-11-11T00:00:00.000Z");
  assert.equal(computeResults(trades, { since: null }).n, 4);
});
