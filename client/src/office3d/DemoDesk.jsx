import { useEffect, useState } from 'react';
import { API } from '../services/api.js';

const usd = (v, sign = false) => typeof v === 'number'
  ? `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}US$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const r3 = v => typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(2)} R` : '—';
const when = v => v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const tfLabel = tf => tf === '240' ? '4h' : tf === '60' ? '1h' : tf ? `${tf}m` : '';
const REASON = { tp: 'Alvo', stop: 'Stop', unknown: '?' };

// Live balance and positions come from the demo account (read-only route, cached 15 s).
function useDesk(enabled) {
  const [desk, setDesk] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = async () => {
      try { const j = await API.get('/api/office/desk'); if (alive) { setDesk(j.data); setError(''); } }
      catch { if (alive) setError('Não foi possível consultar a conta demo agora.'); }
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [enabled]);
  return { desk, error };
}

function Curve({ points }) {
  if (points.length < 2) return <div className="desk-curve-empty">A curva aparece a partir do segundo trade encerrado.</div>;
  const W = 600, H = 150, pad = 8;
  const vals = [0, ...points.map(p => p.pnl)];
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = i => pad + (i / (vals.length - 1)) * (W - pad * 2);
  const y = v => H - pad - ((v - min) / span) * (H - pad * 2);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = vals[vals.length - 1];
  return <svg className="desk-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Lucro acumulado realizado: ${usd(last, true)}`}>
    <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="zero" />
    <path d={d} className={last >= 0 ? 'up' : 'down'} />
  </svg>;
}

export default function DemoDesk({ snapshot, connected }) {
  const bot = snapshot?.bot, res = snapshot?.results;
  const { desk, error } = useDesk(!!bot?.enabled && connected);
  if (!res) return null;
  const today = desk?.equity != null && desk?.dayStartEquity ? desk.equity - desk.dayStartEquity : null;
  const unreal = desk?.positions?.reduce((s, p) => s + (p.unrealisedPnl || 0), 0) ?? null;
  const status = !bot?.enabled ? 'Bot desligado neste servidor' : bot.paused ? `Bot pausado (${bot.paused})` : bot.dryRun ? 'Bot em dry-run (não envia ordem)' : 'Bot operando na conta demo';
  return <section className="demo-desk" aria-label="Mesa demo: resultado da conta">
    <div className={`desk-verdict v-${res.verdict.code}`}>
      <div><span className="goal-eyebrow">A ESTRATÉGIA ESTÁ GANHANDO NA DEMO?</span>
        <h2>{res.verdict.label}</h2><p>{res.verdict.detail}</p></div>
      <div className="desk-status"><i className={bot?.enabled && !bot?.paused ? 'on' : ''} />{status}</div>
    </div>

    <div className="desk-kpis">
      <div><span>Saldo da conta demo</span><b>{desk?.equity != null ? usd(desk.equity) : bot?.enabled ? (error ? '—' : '…') : '—'}</b><small>{desk?.at ? `ao vivo · ${when(desk.at)}` : bot?.enabled ? 'consultando a Bybit Demo' : 'bot desligado'}</small></div>
      <div><span>Hoje (UTC)</span><b className={today > 0 ? 'pos' : today < 0 ? 'neg' : ''}>{today != null ? usd(today, true) : '—'}</b><small>saldo contra o início do dia</small></div>
      <div><span>Lucro realizado</span><b className={res.totalPnlUsd > 0 ? 'pos' : res.totalPnlUsd < 0 ? 'neg' : ''}>{usd(res.totalPnlUsd, true)}</b><small>{res.n} trades encerrados</small></div>
      <div><span>Acerto</span><b>{res.n ? `${Math.round(res.winRate * 100)}%` : '—'}</b><small>{res.wins}V · {res.losses}D</small></div>
      <div><span>Expectativa</span><b className={res.expectancyR > 0 ? 'pos' : res.expectancyR < 0 ? 'neg' : ''}>{res.n ? r3(res.expectancyR) : '—'}</b><small>{res.ciR ? `95%: ${r3(res.ciR[0])} a ${r3(res.ciR[1])}` : 'por trade, em risco'}</small></div>
      <div><span>Maior queda</span><b>{res.n ? usd(-res.maxDrawdownUsd) : '—'}</b><small>do pico do lucro realizado</small></div>
    </div>
    <div className="desk-progress" aria-label={`${res.n} de ${res.minSample} trades para começar a concluir`}>
      <i style={{ width: `${Math.min(100, (res.n / res.minSample) * 100)}%` }} /><span>{Math.min(res.n, res.minSample)}/{res.minSample} trades para a primeira conclusão</span>
    </div>

    <div className="desk-grid">
      <div className="desk-box"><h3>Lucro acumulado (realizado)</h3><Curve points={res.curve} /></div>
      <div className="desk-box"><h3>Posições abertas agora {unreal != null && desk?.positions?.length ? <em className={unreal >= 0 ? 'pos' : 'neg'}>{usd(unreal, true)} não realizado</em> : null}</h3>
        {error && <p className="school-error">{error}</p>}
        {!bot?.enabled ? <p className="quiet-copy">Ligue o bot (DEMO_BOT=1) para ver as posições da conta demo.</p>
          : !desk ? <p className="quiet-copy">Consultando…</p>
          : !desk.positions?.length ? <p className="quiet-copy">Nenhuma posição aberta na conta demo.</p>
          : <table className="desk-table"><thead><tr><th>Ativo</th><th>Lado</th><th>Entrada</th><th>Stop</th><th>Alvo</th><th>Resultado</th></tr></thead>
            <tbody>{desk.positions.map(p => <tr key={p.symbol}><td>{p.symbol.replace('USDT', '')}</td><td>{p.side === 'Buy' ? 'Compra' : 'Venda'}</td><td>{p.entry}</td><td>{p.stopLoss ?? '—'}</td><td>{p.takeProfit ?? '—'}</td>
              <td className={p.unrealisedPnl >= 0 ? 'pos' : 'neg'}>{usd(p.unrealisedPnl, true)}</td></tr>)}</tbody></table>}
      </div>
    </div>

    <div className="desk-box"><h3>Entradas e saídas encerradas</h3>
      {!res.trades.length ? <p className="quiet-copy">Nenhum trade encerrado registrado ainda.</p>
        : <div className="desk-scroll"><table className="desk-table"><thead><tr><th>Fechou</th><th>Ativo</th><th>Direção</th><th>Entrada → saída</th><th>Saiu por</th><th>R</th><th>Resultado</th></tr></thead>
          <tbody>{res.trades.map(t => <tr key={`${t.symbol}-${t.closedAt}`}><td>{when(t.closedAt)}</td><td>{t.symbol?.replace('USDT', '')} · {tfLabel(t.tf)}</td><td>{t.dir === 'LONG' ? 'Compra' : 'Venda'}</td>
            <td>{t.entry} → {t.exit ?? '—'}</td><td>{REASON[t.reason] || t.reason}</td><td className={t.netR > 0 ? 'pos' : 'neg'}>{r3(t.netR)}</td><td className={t.pnlUsd > 0 ? 'pos' : 'neg'}>{usd(t.pnlUsd, true)}</td></tr>)}</tbody></table></div>}
      <small className="desk-note">Registros locais do bot, não reconciliados com a corretora. Conta demo: dinheiro fictício, sem garantia para conta real. Não é recomendação de investimento.</small>
    </div>
  </section>;
}
