// Gamificação do escritório: escada de risco (regra 10V/5D), meta e conquistas.
// Funções puras sobre o histórico de trades do bot demo.

export const LADDER_LEVELS = [
  { level: -1, multiplier: 0.5, name: 'Cauteloso' },
  { level: 0, multiplier: 1, name: 'Base' },
  { level: 1, multiplier: 1.5, name: 'Nível 1' },
  { level: 2, multiplier: 2, name: 'Nível 2' },
];
const MIN_LEVEL = LADDER_LEVELS[0].level;
const MAX_LEVEL = LADDER_LEVELS.at(-1).level;

const round = (v, p = 3) => Number(Number(v).toFixed(p));
const sorted = trades => trades
  .filter(t => Number.isFinite(Number(t.pnlUsd)) && Number.isFinite(Number(t.closedAt)))
  .sort((a, b) => a.closedAt - b.closedAt);

// A cada `winsToUp` vitórias o risco sobe um degrau; a cada `lossesToDown` derrotas,
// ou queda de `ddDownPct`% desde o pico (desde a última mudança), desce um degrau.
// Os contadores zeram a cada mudança de degrau. O risco nunca passa de 2× a base.
export function computeLadder({ trades = [], baseRiskPct = 1, equityBase = 0, winsToUp = 10, lossesToDown = 5, ddDownPct = 10 } = {}) {
  let level = 0, wins = 0, losses = 0, pnl = 0, peak = 0;
  const history = [];
  const change = (to, ts, reason) => {
    if (to !== level) history.push({ ts, from: level, to, reason });
    level = to;
    wins = 0; losses = 0; pnl = 0; peak = 0;
  };
  for (const t of sorted(trades)) {
    const usd = Number(t.pnlUsd);
    usd > 0 ? wins++ : losses++;
    pnl += usd;
    peak = Math.max(peak, pnl);
    const dd = equityBase > 0 ? ((peak - pnl) / equityBase) * 100 : 0;
    if (wins >= winsToUp) change(Math.min(MAX_LEVEL, level + 1), t.closedAt, `${winsToUp} vitórias`);
    else if (losses >= lossesToDown) change(Math.max(MIN_LEVEL, level - 1), t.closedAt, `${lossesToDown} derrotas`);
    else if (dd >= ddDownPct) change(Math.max(MIN_LEVEL, level - 1), t.closedAt, `queda de ${ddDownPct}%`);
  }
  const step = LADDER_LEVELS.find(l => l.level === level);
  const dd = equityBase > 0 ? ((peak - pnl) / equityBase) * 100 : null;
  return {
    level, name: step.name, multiplier: step.multiplier,
    baseRiskPct, riskPct: round(baseRiskPct * step.multiplier),
    wins, losses, winsToUp, lossesToDown, ddPct: dd == null ? null : round(dd, 2), ddDownPct,
    minLevel: MIN_LEVEL, maxLevel: MAX_LEVEL, history: history.slice(-10),
  };
}

export function computeGoal({ trades = [], targetUsd = 1000 } = {}) {
  const totalUsd = round(sorted(trades).reduce((s, t) => s + Number(t.pnlUsd), 0), 2);
  const target = targetUsd > 0 ? targetUsd : 1000;
  return { targetUsd: target, totalUsd, pct: round(Math.min(1, Math.max(0, totalUsd / target)), 3), reached: totalUsd >= target };
}

export function computeAchievements({ trades = [], ladder, goal } = {}) {
  const list = sorted(trades);
  const firstWin = list.find(t => Number(t.pnlUsd) > 0);
  let run = 0, streakAt = null;
  for (const t of list) {
    run = Number(t.pnlUsd) > 0 ? run + 1 : 0;
    if (run >= 3 && !streakAt) streakAt = t.closedAt;
  }
  const byDay = new Map();
  for (const t of list) {
    const day = new Date(t.closedAt).toISOString().slice(0, 10);
    byDay.set(day, { sum: (byDay.get(day)?.sum || 0) + Number(t.pnlUsd), at: t.closedAt });
  }
  const greenDay = [...byDay.values()].find(d => d.sum > 0);
  const levelUp = ladder?.history?.find(h => h.to > h.from);
  let cum = 0, goalAt = null;
  for (const t of list) { cum += Number(t.pnlUsd); if (goal && !goalAt && cum >= goal.targetUsd) goalAt = t.closedAt; }
  const item = (id, label, at) => ({ id, label, done: at != null, at: at ?? null });
  return [
    item('first-trade', 'Primeiro trade', list[0]?.closedAt),
    item('first-win', 'Primeira vitória', firstWin?.closedAt),
    item('green-day', 'Dia no verde', greenDay?.at),
    item('streak-3', '3 vitórias seguidas', streakAt),
    item('trades-10', '10 trades', list[9]?.closedAt),
    item('level-up', 'Subiu de nível', levelUp?.ts),
    item('goal', 'Meta atingida', goalAt),
  ];
}
