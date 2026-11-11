// "Humor" do trader: leitura pura dos registros locais do bot demo.
// Só apresentação — não altera tamanho de posição nem envia comandos ao bot.

export const MOODS = {
  perigo: 'Perigo',
  alerta: 'Alerta',
  normal: 'Normal',
  confiante: 'Confiante',
};

const utcDay = ts => new Date(ts).toISOString().slice(0, 10);
const round = (v, p = 2) => Number(Number(v).toFixed(p));

export function computeTraderMood({ trades = [], now = Date.now(), dayStartEquity = 0, dailyLossLimitPct = 0, paused = false } = {}) {
  const closed = trades
    .filter(t => Number.isFinite(Number(t.pnlUsd)) && Number.isFinite(Number(t.closedAt)))
    .sort((a, b) => a.closedAt - b.closedAt);

  // Sequência atual: positiva = vitórias seguidas, negativa = derrotas seguidas.
  let streak = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const win = Number(closed[i].pnlUsd) > 0;
    if (streak === 0) streak = win ? 1 : -1;
    else if (win === streak > 0) streak += win ? 1 : -1;
    else break;
  }

  const today = closed.filter(t => utcDay(t.closedAt) === utcDay(now));
  const todayPnlUsd = round(today.reduce((s, t) => s + Number(t.pnlUsd), 0));
  const todayPct = dayStartEquity > 0 ? round((todayPnlUsd / dayStartEquity) * 100, 3) : null;
  const lossUsage = todayPct != null && todayPct < 0 && dailyLossLimitPct > 0 ? round(-todayPct / dailyLossLimitPct, 3) : 0;
  const wins = today.filter(t => Number(t.pnlUsd) > 0).length;

  const base = { streak, todayPnlUsd, todayPct, lossUsage, today: { wins, losses: today.length - wins } };
  const result = (mood, reason) => ({
    ...base, mood, label: MOODS[mood], reason,
    // Pausa no lounge: trava de perda acionada, bot pausado ou humor em perigo.
    cooldown: mood === 'perigo' || Boolean(paused),
    cooldownReason: paused === 'daily-loss' ? 'Trava de perda diária acionada' : paused ? 'Bot pausado' : mood === 'perigo' ? reason : null,
  });

  if (paused === 'daily-loss') return result('perigo', 'Trava de perda diária acionada');
  if (lossUsage >= 0.75) return result('perigo', `Perda do dia em ${Math.round(lossUsage * 100)}% do limite`);
  if (streak <= -3) return result('perigo', `${-streak} derrotas seguidas`);
  if (!closed.length) return result('normal', 'Sem trades registrados');
  if (streak < 0) return result('alerta', streak === -1 ? 'Último trade foi derrota' : `${-streak} derrotas seguidas`);
  if (todayPnlUsd < 0) return result('alerta', 'Resultado do dia negativo');
  if (streak >= 3) return result('confiante', `${streak} vitórias seguidas`);
  return result('normal', streak > 0 ? `${streak} vitória(s) seguida(s)` : 'Sem sequência');
}
