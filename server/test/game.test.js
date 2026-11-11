import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLadder, computeGoal, computeAchievements } from '../src/services/game.js';

let clock = 0;
const trade = pnlUsd => ({ pnlUsd, closedAt: Date.UTC(2026, 10, 1) + (clock += 3_600_000) });
const many = (n, pnl) => Array.from({ length: n }, () => trade(pnl));

test('starts at the base level with base risk', () => {
  const l = computeLadder({ baseRiskPct: 1 });
  assert.equal(l.level, 0);
  assert.equal(l.riskPct, 1);
  assert.equal(l.wins, 0);
});

test('10 wins (not necessarily in a row) climb one step and reset the counters', () => {
  const trades = [...many(4, 10), trade(-5), ...many(6, 10), ...many(2, 10)];
  const l = computeLadder({ trades, baseRiskPct: 1 });
  assert.equal(l.level, 1);
  assert.equal(l.riskPct, 1.5);
  assert.equal(l.wins, 2);
  assert.equal(l.losses, 0);
  assert.equal(l.history[0].reason, '10 vitórias');
});

test('5 losses step down; the floor is half the base risk', () => {
  const l = computeLadder({ trades: many(15, -5), baseRiskPct: 1 });
  assert.equal(l.level, -1);
  assert.equal(l.riskPct, 0.5);
  assert.equal(l.history.length, 1); // only one real change: 0 → -1
});

test('the risk never goes above 2x the base', () => {
  const l = computeLadder({ trades: many(60, 10), baseRiskPct: 1 });
  assert.equal(l.level, 2);
  assert.equal(l.riskPct, 2);
});

test('a 10% drop from the peak since the last change steps down', () => {
  const trades = [trade(300), trade(200), trade(-700), trade(-400)];
  const l = computeLadder({ trades, baseRiskPct: 1, equityBase: 10_000 });
  assert.equal(l.level, -1);
  assert.equal(l.history[0].reason, 'queda de 10%');
});

test('goal progress is clamped and flags when reached', () => {
  assert.deepEqual(computeGoal({ trades: [trade(250)], targetUsd: 1000 }), { targetUsd: 1000, totalUsd: 250, pct: 0.25, reached: false });
  assert.equal(computeGoal({ trades: [trade(-50)], targetUsd: 1000 }).pct, 0);
  assert.equal(computeGoal({ trades: [trade(1200)], targetUsd: 1000 }).reached, true);
});

test('achievements are unlocked only by recorded trades', () => {
  assert.ok(computeAchievements({ trades: [] }).every(a => !a.done));
  const trades = [trade(-5), ...many(3, 10)];
  const ladder = computeLadder({ trades });
  const goal = computeGoal({ trades, targetUsd: 20 });
  const a = Object.fromEntries(computeAchievements({ trades, ladder, goal }).map(x => [x.id, x.done]));
  assert.deepEqual(a, { 'first-trade': true, 'first-win': true, 'green-day': true, 'streak-3': true, 'trades-10': false, 'level-up': false, goal: true });
});
