import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTraderMood } from '../src/services/crew.js';

const NOW = Date.parse('2026-11-10T15:00:00Z');
const DAY = 86_400_000;
const t = (pnlUsd, closedAt = NOW - DAY) => ({ pnlUsd, closedAt });

test('no trades is a normal mood without cooldown', () => {
  const m = computeTraderMood({ now: NOW });
  assert.equal(m.mood, 'normal');
  assert.equal(m.cooldown, false);
  assert.equal(m.streak, 0);
});

test('streak counts only the latest run of results', () => {
  const m = computeTraderMood({ now: NOW, trades: [t(-5, NOW - 5e6), t(10, NOW - 4e6), t(12, NOW - 3e6), t(8, NOW - 2e6)] });
  assert.equal(m.streak, 3);
  assert.equal(m.mood, 'confiante');
});

test('one loss puts the trader on alert; three in a row is danger and cooldown', () => {
  assert.equal(computeTraderMood({ now: NOW, trades: [t(10, NOW - 3e6), t(-4, NOW - 2e6)] }).mood, 'alerta');
  const danger = computeTraderMood({ now: NOW, trades: [t(-1, NOW - 3e6), t(-2, NOW - 2e6), t(-3, NOW - 1e6)] });
  assert.equal(danger.mood, 'perigo');
  assert.equal(danger.cooldown, true);
  assert.match(danger.cooldownReason, /3 derrotas/);
});

test('loss near the daily limit is danger, measured against the day start equity', () => {
  const m = computeTraderMood({ now: NOW, dayStartEquity: 10_000, dailyLossLimitPct: 4, trades: [t(50, NOW - 3e6), t(-350, NOW - 1e6)] });
  assert.equal(m.todayPct, -3);
  assert.equal(m.lossUsage, 0.75);
  assert.equal(m.mood, 'perigo');
  assert.deepEqual(m.today, { wins: 1, losses: 1 });
});

test('yesterday losses do not count against today', () => {
  const m = computeTraderMood({ now: NOW, dayStartEquity: 10_000, dailyLossLimitPct: 4, trades: [t(-900, NOW - DAY), t(20, NOW - 1e6)] });
  assert.equal(m.todayPnlUsd, 20);
  assert.equal(m.mood, 'normal');
});

test('the daily-loss pause and a manual pause both send the trader to the lounge', () => {
  const lock = computeTraderMood({ now: NOW, paused: 'daily-loss' });
  assert.equal(lock.mood, 'perigo');
  assert.equal(lock.cooldownReason, 'Trava de perda diária acionada');
  const manual = computeTraderMood({ now: NOW, paused: 'manual', trades: [t(10)] });
  assert.equal(manual.mood, 'normal');
  assert.equal(manual.cooldown, true);
  assert.equal(manual.cooldownReason, 'Bot pausado');
});

test('malformed records are ignored', () => {
  const m = computeTraderMood({ now: NOW, trades: [{ pnlUsd: 'x', closedAt: NOW }, { pnlUsd: 5 }, t(5)] });
  assert.equal(m.streak, 1);
});

test('lounge pause from a losing streak ends 3 h after the last loss; a new loss restarts it', () => {
  const streak = [t(-1, NOW - 6 * 3_600_000), t(-2, NOW - 5 * 3_600_000)];
  const fresh = computeTraderMood({ now: NOW, trades: [...streak, t(-3, NOW - 3_600_000)] });
  assert.equal(fresh.cooldown, true);
  assert.equal(fresh.cooldownUntil, NOW - 3_600_000 + 3 * 3_600_000);
  const later = computeTraderMood({ now: NOW, trades: [...streak, t(-3, NOW - 4 * 3_600_000)] });
  assert.equal(later.mood, 'perigo', 'o humor continua em perigo');
  assert.equal(later.cooldown, false, 'mas o trader já voltou do lounge');
  assert.equal(later.cooldownReason, null);
  const again = computeTraderMood({ now: NOW, trades: [...streak, t(-3, NOW - 4 * 3_600_000), t(-4, NOW - 600_000)] });
  assert.equal(again.cooldown, true, 'derrota nova: volta ao lounge');
  const locked = computeTraderMood({ now: NOW, paused: 'daily-loss', trades: [...streak, t(-3, NOW - 4.5 * 3_600_000)] });
  assert.equal(locked.cooldown, true, 'trava de perda diária não tem prazo');
  assert.equal(locked.cooldownUntil, null);
});
