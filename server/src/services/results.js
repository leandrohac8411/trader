// server/src/services/results.js
// "Está ganhando dinheiro na demo ou não?" — resposta honesta a partir dos trades
// encerrados que o bot registrou. Função pura.
//
// O veredito usa a expectativa em R (lucro médio por trade, em unidades de risco) e um
// intervalo de confiança de 95% (aprox. normal: média ± 1,96·dp/√n). Com poucos trades,
// o intervalo é largo demais para concluir qualquer coisa — e o veredito diz isso.

const round = (v, p = 2) => (Number.isFinite(+v) ? Number(Number(v).toFixed(p)) : 0);

export const MIN_SAMPLE = 30;

export function computeResults(trades = [], { minSample = MIN_SAMPLE } = {}) {
  const list = trades
    .filter((t) => Number.isFinite(Number(t.netR)))
    .sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));
  const rs = list.map((t) => Number(t.netR));
  const usd = list.map((t) => Number(t.pnlUsd) || 0);
  const n = rs.length;
  const mean = n ? rs.reduce((s, r) => s + r, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(rs.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? (1.96 * sd) / Math.sqrt(n) : null;
  const wins = usd.filter((v, i) => rs[i] > 0);
  const losses = usd.filter((v, i) => rs[i] <= 0);

  let cum = 0, peak = 0, dd = 0;
  const curve = list.map((t, i) => {
    cum += usd[i];
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
    return { t: t.closedAt || null, pnl: round(cum) };
  });

  let verdict;
  if (n === 0) verdict = { code: "sem-dados", label: "Sem trades encerrados", detail: "O bot ainda não fechou nenhuma operação na conta demo." };
  else if (n < minSample) verdict = { code: "amostra", label: "Cedo demais para concluir",
    detail: `${n} de ${minSample} trades mínimos. Com tão poucos, sorte e azar pesam mais que a estratégia.` };
  else if (mean - half > 0) verdict = { code: "positivo", label: "Ganhando de forma consistente (demo)",
    detail: `Expectativa entre ${round(mean - half, 3)} e ${round(mean + half, 3)} R por trade (95%). Ainda é conta demo: sem garantia para dinheiro real.` };
  else if (mean + half < 0) verdict = { code: "negativo", label: "Perdendo de forma consistente",
    detail: `Expectativa entre ${round(mean - half, 3)} e ${round(mean + half, 3)} R por trade (95%). Do jeito que está, a estratégia não serve.` };
  else verdict = { code: "inconclusivo", label: "Inconclusivo",
    detail: `Expectativa entre ${round(mean - half, 3)} e ${round(mean + half, 3)} R por trade (95%): pode ser positiva ou negativa. Precisa de mais trades.` };

  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate: round(n ? wins.length / n : 0, 3),
    expectancyR: round(mean, 3),
    ciR: half == null ? null : [round(mean - half, 3), round(mean + half, 3)],
    totalPnlUsd: round(cum),
    avgWinUsd: round(wins.length ? wins.reduce((s, v) => s + v, 0) / wins.length : 0),
    avgLossUsd: round(losses.length ? losses.reduce((s, v) => s + v, 0) / losses.length : 0),
    maxDrawdownUsd: round(dd),
    minSample,
    verdict,
    curve,
    trades: list.slice(-50).reverse().map((t) => ({
      symbol: t.symbol, tf: t.tf, dir: t.dir, entry: t.entry, exit: t.exit, reason: t.reason,
      netR: round(t.netR, 3), pnlUsd: round(t.pnlUsd), openedAt: t.openedAt || null, closedAt: t.closedAt || null,
    })),
  };
}
