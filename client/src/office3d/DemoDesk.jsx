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

const dayLabel = d => {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd, 12));
  return `${dt.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')} ${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

// Quanto ganhou e quanto perdeu em cada dia (trades encerrados, horário de Brasília).
function DailyBoard({ byDay = [], today }) {
  const t = byDay.find(d => d.day === today) || { trades: 0, wins: 0, losses: 0, gainUsd: 0, lossUsd: 0, netUsd: 0 };
  const max = Math.max(1, ...byDay.map(d => Math.max(d.gainUsd, -d.lossUsd)));
  return <div className="desk-box daily-board">
    <h3>Ganhos e perdas por dia <em>horário de Brasília · só trades encerrados</em></h3>
    <div className="daily-today">
      <div className={t.gainUsd > 0 ? 'g' : ''}><span>Ganhou hoje</span><b>{usd(t.gainUsd, true)}</b><small>{t.wins} trade{t.wins === 1 ? '' : 's'} no lucro</small></div>
      <div className={t.lossUsd < 0 ? 'l' : ''}><span>Perdeu hoje</span><b>{t.lossUsd ? usd(t.lossUsd, true) : usd(0)}</b><small>{t.losses} trade{t.losses === 1 ? '' : 's'} no prejuízo</small></div>
      <div className={t.netUsd > 0 ? 'n pos' : t.netUsd < 0 ? 'n neg' : 'n'}><span>Resultado do dia</span><b>{usd(t.netUsd, true)}</b><small>{t.trades ? `${t.trades} encerrado${t.trades === 1 ? '' : 's'} hoje` : 'nenhum trade fechou hoje'}</small></div>
    </div>
    {!byDay.length ? <p className="quiet-copy">Nenhum dia com trade encerrado ainda.</p>
      : <ul className="daily-list">{byDay.map(d => <li key={d.day} className={d.day === today ? 'is-today' : ''}>
        <span className="daily-date">{d.day === today ? 'Hoje' : dayLabel(d.day)}<small>{d.wins}V · {d.losses}D</small></span>
        <span className="daily-bars" aria-hidden="true"><i className="g" style={{ width: `${(d.gainUsd / max) * 100}%` }} /><i className="l" style={{ width: `${(-d.lossUsd / max) * 100}%` }} /></span>
        <span className="daily-nums"><b className="pos">{d.gainUsd ? usd(d.gainUsd, true) : '—'}</b><b className="neg">{d.lossUsd ? usd(d.lossUsd, true) : '—'}</b></span>
        <span className={`daily-net ${d.netUsd > 0 ? 'pos' : d.netUsd < 0 ? 'neg' : ''}`}>{usd(d.netUsd, true)}</span>
      </li>)}</ul>}
  </div>;
}

// Onde o preço está entre o stop (esquerda) e o alvo (direita); o tracinho é a entrada.
export function positionTrack({ side, entry, markPrice: mark, stopLoss: stop, takeProfit: tp }) {
  if (![entry, mark, stop, tp].every(Number.isFinite) || stop === tp) return null;
  const at = (x) => Math.min(100, Math.max(0, ((x - stop) / (tp - stop)) * 100));
  const towardTarget = side === 'Buy' ? mark >= entry : mark <= entry;
  const share = towardTarget ? (mark - entry) / (tp - entry) : (mark - entry) / (stop - entry);
  const pct = Math.round(Math.min(1, Math.max(0, share || 0)) * 100);
  return { markPct: at(mark), entryPct: at(entry), towardTarget, pct,
    label: towardTarget ? `${pct}% do caminho até o alvo` : `${pct}% do caminho até o stop` };
}

function PositionTrack({ p }) {
  const t = positionTrack(p);
  if (!t) return '—';
  return <div className={`pos-track ${t.towardTarget ? 'good' : 'bad'}`} title={t.label}>
    <span className="pos-track-bar" aria-hidden="true"><i className="entry" style={{ left: `${t.entryPct}%` }} /><i className="mark" style={{ left: `${t.markPct}%` }} /></span>
    <small>{t.label}</small>
  </div>;
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
      <div><span className="goal-eyebrow"><span className="caps">A estratégia está ganhando na demo?</span></span>
        <h2>{res.verdict.label}</h2><p>{res.verdict.detail}</p>
        {res.since && <small className="desk-since">Contando desde {new Date(res.since).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}, quando começou a rodada atual do bot.{res.excluded ? ` ${res.excluded} trade${res.excluded === 1 ? '' : 's'} de rodadas antigas (configuração anterior) fica${res.excluded === 1 ? '' : 'm'} de fora.` : ''}</small>}</div>
      <div className="desk-status"><i className={bot?.enabled && !bot?.paused ? 'on' : ''} />{status}</div>
    </div>

    <div className="desk-kpis">
      <div><span>Saldo da conta demo</span><b>{desk?.equity != null ? usd(desk.equity) : bot?.enabled ? (error ? '—' : '…') : '—'}</b><small>{desk?.at ? `ao vivo · ${when(desk.at)}` : bot?.enabled ? 'consultando a Bybit Demo' : 'bot desligado'}</small></div>
      <div><span>Saldo hoje</span><b className={today > 0 ? 'pos' : today < 0 ? 'neg' : ''}>{today != null ? usd(today, true) : '—'}</b><small>desde 21h (00h UTC), com posições abertas</small></div>
      <div><span>Lucro realizado</span><b className={res.totalPnlUsd > 0 ? 'pos' : res.totalPnlUsd < 0 ? 'neg' : ''}>{usd(res.totalPnlUsd, true)}</b><small>{res.n} trades encerrados</small></div>
      <div><span>Acerto</span><b>{res.n ? `${Math.round(res.winRate * 100)}%` : '—'}</b><small>{res.wins}V · {res.losses}D</small></div>
      <div><span>Expectativa</span><b className={res.expectancyR > 0 ? 'pos' : res.expectancyR < 0 ? 'neg' : ''}>{res.n ? r3(res.expectancyR) : '—'}</b><small>{res.ciR ? `95%: ${r3(res.ciR[0])} a ${r3(res.ciR[1])}` : 'por trade, em risco'}</small></div>
      <div><span>Maior queda</span><b>{res.n ? usd(-res.maxDrawdownUsd) : '—'}</b><small>do pico do lucro realizado</small></div>
    </div>
    <div className="desk-progress" aria-label={`${res.n} de ${res.minSample} trades para começar a concluir`}>
      <i style={{ width: `${Math.min(100, (res.n / res.minSample) * 100)}%` }} /><span>{Math.min(res.n, res.minSample)}/{res.minSample} trades para a primeira conclusão</span>
    </div>

    <DailyBoard byDay={res.byDay} today={res.today} />

    <div className="desk-grid">
      <div className="desk-box"><h3>Lucro acumulado (realizado)</h3><Curve points={res.curve} /></div>
      <div className="desk-box"><h3>Posições abertas agora {unreal != null && desk?.positions?.length ? <em className={unreal >= 0 ? 'pos' : 'neg'}>{usd(unreal, true)} não realizado</em> : null}</h3>
        {error && <p className="school-error">{error}</p>}
        {!bot?.enabled ? <p className="quiet-copy">Ligue o bot (DEMO_BOT=1) para ver as posições da conta demo.</p>
          : !desk ? <p className="quiet-copy">Consultando…</p>
          : !desk.positions?.length ? <p className="quiet-copy">Nenhuma posição aberta na conta demo.</p>
          : <table className="desk-table"><thead><tr><th>Ativo</th><th>Lado</th><th>Entrada</th><th>Agora</th><th>Stop</th><th>Alvo</th><th>Andamento</th><th>Resultado</th></tr></thead>
            <tbody>{desk.positions.map(p => <tr key={p.symbol}><td data-label="Ativo">{p.symbol.replace('USDT', '')}</td><td data-label="Lado">{p.side === 'Buy' ? 'Compra' : 'Venda'}</td><td data-label="Entrada">{p.entry}</td><td data-label="Agora">{p.markPrice ?? '—'}</td><td data-label="Stop">{p.stopLoss ?? '—'}</td><td data-label="Alvo">{p.takeProfit ?? '—'}</td>
              <td data-label="Andamento"><PositionTrack p={p} /></td>
              <td data-label="Resultado" className={p.unrealisedPnl >= 0 ? 'pos' : 'neg'}>{usd(p.unrealisedPnl, true)}</td></tr>)}</tbody></table>}
      </div>
    </div>

    <div className="desk-box"><h3>Entradas e saídas encerradas</h3>
      {!res.trades.length ? <p className="quiet-copy">Nenhum trade encerrado registrado ainda.</p>
        : <div className="desk-scroll"><table className="desk-table"><thead><tr><th>Fechou</th><th>Ativo</th><th>Direção</th><th>Entrada → saída</th><th>Saiu por</th><th>R</th><th>Resultado</th></tr></thead>
          <tbody>{res.trades.map(t => <tr key={`${t.symbol}-${t.closedAt}`}><td data-label="Fechou">{when(t.closedAt)}</td><td data-label="Ativo">{t.symbol?.replace('USDT', '')} · {tfLabel(t.tf)}</td><td data-label="Direção">{t.dir === 'LONG' ? 'Compra' : 'Venda'}</td>
            <td data-label="Entrada → saída">{t.entry} → {t.exit ?? '—'}</td><td data-label="Saiu por">{REASON[t.reason] || t.reason}</td><td data-label="R" className={t.netR > 0 ? 'pos' : 'neg'}>{r3(t.netR)}</td><td data-label="Resultado" className={t.pnlUsd > 0 ? 'pos' : 'neg'}>{usd(t.pnlUsd, true)}</td></tr>)}</tbody></table></div>}
      <small className="desk-note">Registros locais do bot, não reconciliados com a corretora. Conta demo: dinheiro fictício, sem garantia para conta real. Não é recomendação de investimento.</small>
    </div>
  </section>;
}
