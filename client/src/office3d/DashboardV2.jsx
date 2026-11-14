// Visual 2: o escritório como dashboard (cena 3D de dia + cartões com os dados reais do bot).
// Tudo vem do snapshot do escritório, da conta demo (/api/office/desk) e das velas públicas da Bybit.
import { useEffect, useMemo, useState } from 'react';
import OfficeScene from './OfficeScene.jsx';
import { CAMERAS } from './createOfficeScene.js';
import { useDesk, PositionTrack } from './DemoDesk.jsx';
import { getKlines } from '../services/api.js';
import { Coin } from './coins.jsx';
import useTickers from './useTickers.js';

const usd = (v, sign = false) => typeof v === 'number'
  ? `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}US$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const pct = (v, sign = false) => typeof v === 'number' ? `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '—';
const price = v => typeof v === 'number' ? v.toLocaleString('pt-BR', { minimumFractionDigits: v < 10 ? 4 : 2, maximumFractionDigits: v < 10 ? 4 : 2 }) : '—';
const hhmm = v => v ? new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
const coin = s => s?.replace('USDT', '') || '';
const NAMES = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP' };
const big = v => !Number.isFinite(v) ? '—' : v >= 1e9 ? `${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi` : `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mi`;
const STATE = { working: ['Em consulta', 'warn'], monitoring: ['Monitorando', 'ok'], error: ['Falha', 'bad'], idle: ['Disponível', 'ok'] };

function Card({ title, sub, action, className = '', children }) {
  return <section className={`v2-card ${className}`}>
    {(title || action) && <header className="v2-card-head"><div><h2>{title}</h2>{sub && <span>{sub}</span>}</div>{action}</header>}
    {children}
  </section>;
}

// ── Conta demo ───────────────────────────────────────────────────────────
function AccountCard({ desk, results, connected }) {
  const equity = desk?.equity;
  const pnl = results?.totalPnlUsd;
  const base = typeof equity === 'number' && typeof pnl === 'number' ? equity - (desk?.positions || []).reduce((s, p) => s + (p.unrealisedPnl || 0), 0) - pnl : null;
  const pnlPct = base > 0 ? (pnl / base) * 100 : null;
  const ddPct = base > 0 && results ? (results.maxDrawdownUsd / base) * 100 : null;
  return <Card className="v2-account" title={<>Conta demo <small>Bybit</small></>}
    action={<span className={`v2-pill ${connected ? 'ok' : 'off'}`}><i />{connected ? 'Online' : 'Sem conexão'}</span>}>
    <div className="v2-account-top">
      <div><span>Saldo da conta</span><b>{usd(equity)}</b></div>
      <div><span>P&amp;L realizado</span><b className={pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}>{usd(pnl, true)}</b>{pnlPct != null && <em className={pnl >= 0 ? 'up' : 'down'}>{pct(pnlPct, true)}</em>}</div>
    </div>
    <div className="v2-account-stats">
      <div><span>Acerto</span><b>{results?.n ? pct(results.winRate * 100) : '—'}</b></div>
      <div><span>Trades</span><b>{results?.n ?? '—'}</b></div>
      <div><span>Maior queda</span><b className={ddPct > 0 ? 'down' : ''}>{ddPct ? pct(-ddPct) : '—'}</b></div>
    </div>
  </Card>;
}

// ── Equipe ────────────────────────────────────────────────────────────────
function AgentsCard({ agents, snapshot, connected, onSelect }) {
  return <Card className="v2-agents" title={<>Agentes <small>status</small></>} action={<button className="v2-link" onClick={() => onSelect('analyst')}>Ver equipe →</button>}>
    <ul>{agents.map(a => {
      const lounge = a.id === 'trader' && snapshot?.crew?.trader?.cooldown;
      const [label, tone] = !connected ? ['Sem conexão', 'off'] : lounge ? ['No lounge', 'warn'] : STATE[a.state] || STATE.idle;
      return <li key={a.id}><button onClick={() => onSelect(a.id)}>
        <i className={`v2-dot ${tone}`} /><b>{a.name}</b><span>{a.role}</span><em className={tone}>{label}</em>
      </button></li>;
    })}</ul>
  </Card>;
}

// ── Mercado ───────────────────────────────────────────────────────────────
function MarketCard({ monitor, symbol, onPick }) {
  const tickers = useTickers();
  const items = (monitor?.symbols || []).map(s => monitor?.items?.find(i => i.symbol === s) || { symbol: s });
  return <Card className="v2-market" title="Mercado em tempo real" sub={monitor?.lastScan ? `leitura ${hhmm(monitor.lastScan)}` : 'aguardando leitura'}>
    <table className="v2-table">
      <thead><tr><th>Par</th><th className="num">Preço</th><th className="num">24h</th><th className="num">Vol. (US$)</th><th className="num">Score</th></tr></thead>
      <tbody>{items.map(it => {
        const ok = Number.isFinite(it.price) && !it.error && !it.stale;
        const t = tickers?.bySymbol?.[it.symbol], px = Number.isFinite(t?.price) ? t.price : ok ? it.price : null, ch = t?.change24hPct;
        return <tr key={it.symbol} className={symbol === it.symbol ? 'is-on' : ''} onClick={() => onPick(it.symbol)}>
          <td><span className="v2-pair"><Coin symbol={it.symbol} />{coin(it.symbol)}<small>USDT</small></span></td>
          <td className="num">{price(px)}</td>
          <td className={`num ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}`}>{Number.isFinite(ch) ? pct(ch, true) : '—'}</td>
          <td className="num v2-dim">{big(t?.turnover24h)}</td>
          <td className="num" title={ok ? `${it.signal === 'LONG' ? 'Compra' : it.signal === 'SHORT' ? 'Venda' : it.decision || 'Neutro'} · score da estratégia` : ''}><span className="v2-score"><span className="bar"><i className={ok && it.probability >= 90 ? 'hot' : ''} style={{ width: `${ok ? it.probability : 0}%` }} /></span>{ok ? it.probability : '—'}</span></td>
        </tr>;
      })}</tbody>
    </table>
  </Card>;
}

// ── Gráfico (velas claras + EMA 20/50 + volume) ─────────────────────────
const ema = (vals, n) => { const k = 2 / (n + 1); let e = vals[0]; return vals.map(v => (e = v * k + e * (1 - k))); };
const TFS = [['15', '15m'], ['60', '1h'], ['240', '4h'], ['D', '1d']];
function ChartCard({ symbol, onSymbol, connected }) {
  const tickers = useTickers();
  const options = tickers?.list?.length ? tickers.list : [{ symbol }];
  const name = tickers?.bySymbol?.[symbol]?.name || NAMES[coin(symbol)] || coin(symbol);
  const [tf, setTf] = useState('60'), [candles, setCandles] = useState(null), [err, setErr] = useState('');
  useEffect(() => {
    let alive = true, timer;
    setCandles(null); setErr('');
    const load = async () => {
      if (!document.hidden) {
        try { const r = await getKlines(symbol, tf, 'linear', 120); if (alive) { setCandles(r.data?.candles || []); setErr(''); } }
        catch { if (alive) setErr('Velas indisponíveis agora.'); }
      }
      if (alive) timer = setTimeout(load, 30_000);
    };
    if (connected) load();
    return () => { alive = false; clearTimeout(timer); };
  }, [symbol, tf, connected]);
  const view = useMemo(() => {
    if (!candles?.length) return null;
    const cs = candles.slice(-90), closes = candles.map(c => c.close);
    const e20 = ema(closes, 20).slice(-cs.length), e50 = ema(closes, 50).slice(-cs.length);
    const W = 640, H = 260, VH = 44, R = 64, top = 10;
    const lo = Math.min(...cs.map(c => c.low)), hi = Math.max(...cs.map(c => c.high)), span = hi - lo || 1;
    const y = p => top + (hi - p) / span * (H - top - VH - 14);
    const step = (W - R) / cs.length, x = i => (i + 0.5) * step;
    const vmax = Math.max(...cs.map(c => c.volume || 0)) || 1;
    const line = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const first = cs[0].open, last = cs.at(-1).close;
    return { cs, W, H, VH, R, y, step, x, vmax, e20: line(e20), e50: line(e50), last, change: (last - first) / first * 100,
      ticks: [0, 0.25, 0.5, 0.75, 1].map(f => hi - f * span) };
  }, [candles]);
  return <Card className="v2-chart" title={<span className="v2-pair big"><Coin symbol={symbol} size={30} /><select className="v2-symbol" aria-label="Moeda do gráfico" value={symbol} onChange={e => onSymbol(e.target.value)}>{options.some(o => o.symbol === symbol) ? null : <option value={symbol}>{symbol}</option>}{options.map(o => <option key={o.symbol} value={o.symbol}>{o.symbol}</option>)}</select><small>{name} / Tether</small></span>}
    action={<div className="v2-seg" role="group" aria-label="Período">{TFS.map(([v, l]) => <button key={v} aria-pressed={tf === v} onClick={() => setTf(v)}>{l}</button>)}</div>}>
    <div className="v2-chart-price"><b>{view ? price(view.last) : '—'}</b>{view && <em className={view.change >= 0 ? 'up' : 'down'}>{pct(view.change, true)}</em>}<span>no período exibido</span></div>
    {err && <p className="v2-muted">{err}</p>}
    {!view ? <div className="v2-chart-empty">{connected ? 'Carregando velas da Bybit…' : 'Sem conexão com o servidor.'}</div> :
      <svg className="v2-candles" viewBox={`0 0 ${view.W} ${view.H}`} role="img" aria-label={`Velas de ${symbol}`}>
        {view.ticks.map(t => <g key={t}><line x1="0" x2={view.W - view.R} y1={view.y(t)} y2={view.y(t)} className="grid" /><text x={view.W - view.R + 8} y={view.y(t) + 4}>{price(t)}</text></g>)}
        {view.cs.map((c, i) => <rect key={`v${c.ts}`} className={c.close >= c.open ? 'vol up' : 'vol down'} x={view.x(i) - view.step * 0.35} width={view.step * 0.7}
          y={view.H - (c.volume || 0) / view.vmax * view.VH} height={(c.volume || 0) / view.vmax * view.VH} />)}
        {view.cs.map((c, i) => { const up = c.close >= c.open; return <g key={c.ts} className={up ? 'up' : 'down'}>
          <line x1={view.x(i)} x2={view.x(i)} y1={view.y(c.high)} y2={view.y(c.low)} />
          <rect x={view.x(i) - view.step * 0.32} width={view.step * 0.64} y={view.y(Math.max(c.open, c.close))} height={Math.max(1, Math.abs(view.y(c.open) - view.y(c.close)))} rx="0.6" />
        </g>; })}
        <path d={view.e50} className="ema slow" /><path d={view.e20} className="ema fast" />
        <line x1="0" x2={view.W - view.R} y1={view.y(view.last)} y2={view.y(view.last)} className="last" />
        <rect x={view.W - view.R + 2} y={view.y(view.last) - 9} width={view.R - 4} height="18" rx="3" className="last-tag" />
        <text x={view.W - view.R + 8} y={view.y(view.last) + 4} className="last-txt">{price(view.last)}</text>
      </svg>}
    <div className="v2-legend"><span><i className="fast" />EMA 20</span><span><i className="slow" />EMA 50</span><span className="v2-muted">Bybit · contrato USDT</span></div>
  </Card>;
}

// ── Sinais, propostas e posições ─────────────────────────────────────────
function SignalsCard({ snapshot, desk }) {
  const [tab, setTab] = useState('positions');
  const positions = snapshot?.bot?.positions || [];
  const live = Object.fromEntries((desk?.positions || []).map(p => [p.symbol, p]));
  const proposals = snapshot?.proposals || [];
  const alerts = snapshot?.monitor?.alerts || [];
  const tabs = [['positions', `Posições ${positions.length}`], ['proposals', 'Propostas'], ['alerts', 'Alertas']];
  return <Card className="v2-signals" title="Sinais e propostas" action={<div className="v2-tabs" role="tablist">{tabs.map(([id, l]) =>
    <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{l}</button>)}</div>}>
    {tab === 'positions' && (positions.length ? <ul className="v2-rows">{positions.map(p => {
      const sym = p.key.split('|')[0], d = live[sym];
      return <li key={p.key} className="v2-posrow"><span className="v2-pair"><Coin symbol={sym} />{coin(sym)}</span>
        <span className={`v2-dir ${p.side === 'Buy' ? 'up' : 'down'}`}>{p.side === 'Buy' ? '↗ Long' : '↘ Short'}</span>
        <b className={d?.unrealisedPnl > 0 ? 'up' : d?.unrealisedPnl < 0 ? 'down' : ''}>{d ? usd(d.unrealisedPnl, true) : '—'}</b>
        <span className="v2-track">{d ? <PositionTrack p={{ side: p.side, entry: p.entry, markPrice: d.markPrice, stopLoss: p.stop, takeProfit: p.tp }} /> : <small className="v2-muted">aguardando preço</small>}</span></li>;
    })}</ul> : <p className="v2-empty">Nenhuma posição aberta.</p>)}
    {tab === 'proposals' && (proposals.length ? <ul className="v2-rows">{proposals.slice(0, 6).map(p => <li key={`${p.ts}${p.symbol}`}>
      <span className="v2-pair"><Coin symbol={p.symbol} />{coin(p.symbol)}</span>
      <span className={`v2-dir ${p.dir === 'LONG' ? 'up' : 'down'}`}>{p.dir === 'LONG' ? '↗ Long' : '↘ Short'}</span>
      <span className={`v2-chip ${p.decision === 'approved' ? 'ok' : 'bad'}`} title={p.reason}>{p.decision === 'approved' ? 'Aprovada' : 'Barrada'}</span>
      <time>{hhmm(p.ts)}</time></li>)}</ul> : <p className="v2-empty">Nenhuma proposta recente. O bot só propõe com score ≥ {snapshot?.bot?.config?.minProb ?? 90}.</p>)}
    {tab === 'alerts' && (alerts.length ? <ul className="v2-rows">{alerts.slice(0, 6).map(a => <li key={a.id}>
      <span className="v2-pair"><Coin symbol={a.symbol} />{coin(a.symbol)}</span>
      <span className="v2-alert">{a.message.split('—')[1]?.trim() || a.message}</span><time>{hhmm(a.ts)}</time></li>)}</ul> : <p className="v2-empty">Sem alertas ainda.</p>)}
  </Card>;
}

// ── Linha de baixo ────────────────────────────────────────────────────────
function PerformanceCard({ results }) {
  const pts = [0, ...(results?.curve || []).map(p => p.pnl)];
  const W = 300, H = 90, min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1) * W).toFixed(1)},${(H - 6 - (v - min) / span * (H - 12)).toFixed(1)}`).join(' ');
  const total = results?.totalPnlUsd ?? 0;
  return <Card className="v2-perf" title="Performance da conta" sub={results?.since ? `desde ${new Date(results.since).toLocaleDateString('pt-BR')}` : ''}>
    <b className={`v2-big ${total > 0 ? 'up' : total < 0 ? 'down' : ''}`}>{usd(total, true)}</b>
    <span className="v2-muted">{results?.verdict?.label || 'Sem dados'}</span>
    {pts.length > 2 ? <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="v2-spark"><path d={`${d} L${W},${H} L0,${H} Z`} className="area" /><path d={d} className={total >= 0 ? 'up' : 'down'} /></svg>
      : <p className="v2-empty">A curva aparece a partir do segundo trade encerrado.</p>}
  </Card>;
}

function DistributionCard({ results }) {
  const n = results?.n || 0, w = results?.wins || 0, l = results?.losses || 0;
  const r = 34, c = 2 * Math.PI * r, wl = n ? (w / n) * c : 0;
  return <Card className="v2-dist" title="Distribuição de trades">
    <div className="v2-dist-body">
      <svg viewBox="0 0 90 90" className="v2-donut" aria-label={`${w} ganhos e ${l} perdas`}>
        <circle cx="45" cy="45" r={r} className="track" />
        {n > 0 && <><circle cx="45" cy="45" r={r} className="loss" /><circle cx="45" cy="45" r={r} className="win" strokeDasharray={`${wl} ${c}`} /></>}
        <text x="45" y="45" className="n">{n}</text><text x="45" y="58" className="lbl">trades</text>
      </svg>
      <ul><li><i className="win" />{w} ganhos <span>({n ? pct(w / n * 100) : '0%'})</span></li><li><i className="loss" />{l} perdas <span>({n ? pct(l / n * 100) : '0%'})</span></li></ul>
    </div>
  </Card>;
}

function OpenPnlCard({ desk }) {
  const ps = desk?.positions || [];
  const max = Math.max(1, ...ps.map(p => Math.abs(p.unrealisedPnl || 0)));
  const total = ps.reduce((s, p) => s + (p.unrealisedPnl || 0), 0);
  return <Card className="v2-openpnl" title="Resultado em aberto" sub={ps.length ? `${ps.length} posições · ainda não realizado` : ''}
    action={ps.length ? <b className={total >= 0 ? 'up' : 'down'}>{usd(total, true)}</b> : null}>
    {ps.length ? <ul>{ps.map(p => <li key={p.symbol}><span>{coin(p.symbol)}</span>
      <span className="bar"><i className={p.unrealisedPnl >= 0 ? 'up' : 'down'} style={{ width: `${Math.abs(p.unrealisedPnl || 0) / max * 100}%` }} /></span>
      <b className={p.unrealisedPnl >= 0 ? 'up' : 'down'}>{usd(p.unrealisedPnl, true)}</b></li>)}</ul> : <p className="v2-empty">Sem posições abertas.</p>}
  </Card>;
}

function RiskCard({ snapshot, desk }) {
  const cfg = snapshot?.bot?.config, equity = desk?.equity;
  const atRisk = (snapshot?.bot?.positions || []).reduce((s, p) => s + (p.riskUsd || 0), 0);
  const exposure = equity > 0 ? (atRisk / equity) * 100 : null;
  const limit = cfg ? cfg.maxOpen * cfg.riskPct : null;
  const share = exposure != null && limit ? Math.min(1, exposure / limit) : 0;
  const [label, tone] = exposure == null ? ['—', ''] : share < 0.6 ? ['Seguro', 'ok'] : share < 0.9 ? ['Atenção', 'warn'] : ['No limite', 'bad'];
  return <Card className="v2-risk" title="Risco da conta" action={<span className={`v2-chip ${tone}`}>{label}</span>}>
    <div className="v2-risk-bar"><i style={{ width: `${share * 100}%` }} className={tone} /></div>
    <div className="v2-risk-nums"><span>Em risco se todos os stops baterem: <b>{exposure != null ? pct(exposure) : '—'}</b></span><span>Limite: <b>{limit != null ? pct(limit) : '—'}</b></span></div>
    <p className="v2-muted">{cfg ? `${cfg.riskPct}% por trade · até ${cfg.maxOpen} posições · pausa com −${cfg.dailyLossLimitPct}% no dia` : ''}</p>
  </Card>;
}

// ── Página ────────────────────────────────────────────────────────────────
export default function DashboardV2({ agents, snapshot, connected, selected, onSelect, reduced, sceneRef, cam, onCamera }) {
  const { desk } = useDesk(connected);
  const [symbol, setSymbol] = useState('BTCUSDT');
  // a faixa de cotações manda a moeda clicada para o gráfico
  useEffect(() => {
    const pick = e => { setSymbol(e.detail); document.querySelector('.v2-chart')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    window.addEventListener('v2-chart-symbol', pick);
    return () => window.removeEventListener('v2-chart-symbol', pick);
  }, []);
  const open = snapshot?.bot?.positions?.length || 0;
  return <div className="v2-dash">
    <Card className="v2-scene" title="Escritório · agentes de trading" sub={`6 estações · ${open} posiç${open === 1 ? 'ão aberta' : 'ões abertas'}`}
      action={<div className="v2-scene-tools">
        <select aria-label="Escolher câmera" value={cam?.id || ''} onChange={e => sceneRef.current?.setCamera(e.target.value)}>
          {!cam?.id && <option value="">Câmera livre</option>}
          {CAMERAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button aria-pressed={!!cam?.tour} onClick={() => sceneRef.current?.tour(!cam?.tour)}>{cam?.tour ? 'Parar tour' : 'Tour'}</button>
        <button aria-label="Afastar" onClick={() => sceneRef.current?.zoom(-0.15)}>−</button>
        <button aria-label="Aproximar" onClick={() => sceneRef.current?.zoom(0.15)}>+</button>
      </div>}>
      <OfficeScene theme="day" agents={agents} snapshot={snapshot} selected={selected} onSelect={onSelect} reduced={reduced} sceneRef={sceneRef} onCamera={onCamera} />
    </Card>
    <div className="v2-side">
      <AccountCard desk={desk} results={snapshot?.results} connected={connected} />
      <AgentsCard agents={agents} snapshot={snapshot} connected={connected} onSelect={onSelect} />
    </div>
    <MarketCard monitor={snapshot?.monitor} symbol={symbol} onPick={setSymbol} />
    <ChartCard symbol={symbol} onSymbol={setSymbol} connected={connected} />
    <SignalsCard snapshot={snapshot} desk={desk} />
    <PerformanceCard results={snapshot?.results} />
    <DistributionCard results={snapshot?.results} />
    <OpenPnlCard desk={desk} />
    <RiskCard snapshot={snapshot} desk={desk} />
  </div>;
}
