import test from "node:test";
import assert from "node:assert/strict";
import { reviewProposal, proposalSummary } from "../src/services/approval.js";

const cfg = { riskPct: 1, maxOpen: 3, maxNotionalPct: 0.2, dryRun: false };
const base = {
  symbol: "BTCUSDT", tf: "60", dir: "LONG", entry: 100, stop: 98, tp: 103, probability: 90, gate: 85, riskPct: 1, equity: 10_000,
  sizing: { ok: true, qty: 10, notional: 1000, riskUsd: 20, capped: true },
};
const ids = (r) => r.checks.filter((c) => !c.ok).map((c) => c.id);

test("aprova proposta dentro de todos os limites", () => {
  const r = reviewProposal({ proposal: base, cfg, openCount: 1 });
  assert.equal(r.approved, true);
  assert.equal(r.reason, null);
  assert.equal(r.checks.length, 8);
});

test("barra cada limite com o motivo certo", () => {
  assert.deepEqual(ids(reviewProposal({ proposal: { ...base, probability: 80 }, cfg })), ["gate"]);
  assert.deepEqual(ids(reviewProposal({ proposal: { ...base, stop: 101 }, cfg })), ["levels"]);
  assert.deepEqual(ids(reviewProposal({ proposal: { ...base, stop: 80 }, cfg })), ["levels"]); // stop a 20%
  assert.deepEqual(ids(reviewProposal({ proposal: { ...base, riskPct: 2.5 }, cfg })), ["risk"]);
  assert.deepEqual(ids(reviewProposal({ proposal: { ...base, sizing: { ...base.sizing, notional: 2500 } }, cfg })), ["notional"]);
  assert.deepEqual(ids(reviewProposal({ proposal: { ...base, sizing: { ...base.sizing, riskUsd: 150 } }, cfg })), ["riskUsd"]);
  assert.deepEqual(ids(reviewProposal({ proposal: base, cfg, openCount: 3 })), ["maxOpen"]);
  assert.deepEqual(ids(reviewProposal({ proposal: base, cfg, symbolBusy: true })), ["symbol"]);
  const small = reviewProposal({ proposal: { ...base, sizing: { ok: false, qty: 0, notional: 0, riskUsd: 0, reason: "qty 0 abaixo do mínimo 0.001" } }, cfg });
  assert.equal(small.approved, false);
  assert.match(small.reason, /mínimo da corretora/);
});

test("SHORT exige stop acima e alvo abaixo; dry-run não ocupa vaga", () => {
  const short = { ...base, dir: "SHORT", stop: 102, tp: 97 };
  assert.equal(reviewProposal({ proposal: short, cfg }).approved, true);
  assert.deepEqual(ids(reviewProposal({ proposal: { ...short, tp: 104 }, cfg })), ["levels"]);
  assert.equal(reviewProposal({ proposal: base, cfg: { ...cfg, dryRun: true }, openCount: 9 }).approved, true);
});

test("proposalSummary não leva equity", () => {
  const s = proposalSummary(base);
  assert.equal(s.equity, undefined);
  assert.equal(s.notional, 1000);
});
