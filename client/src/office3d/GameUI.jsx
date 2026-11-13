import { useState } from 'react';
import { FICHAS, liveStat } from './fichas.js';

export function Ficha({ id, name, color, snapshot, compact = false }) {
  const f = FICHAS[id];
  if (!f) return null;
  return <div className={`ficha ${compact ? 'ficha-compact' : ''}`} style={{ '--agent-color': color || f.color }}>
    <div className="ficha-head"><span className="ficha-emoji" aria-hidden="true">{f.emoji}</span>
      <div><strong>{(f.name || name || '').toUpperCase()}</strong><em>{f.title}</em></div><small>FICHA</small></div>
    <dl>{f.traits.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <p className="ficha-live"><i />{liveStat(id, snapshot)}</p>
  </div>;
}

const Dots = ({ value, total, kind }) => <span className={`dots dots-${kind}`} aria-label={`${value} de ${total}`}>
  {Array.from({ length: total }, (_, i) => <i key={i} className={i < value ? 'on' : ''} />)}
</span>;

export function GoalsStrip({ game, mood }) {
  if (!game) return null;
  const { ladder, goal, achievements } = game;
  const unlocked = achievements.filter(a => a.done).length;
  const today = mood?.today || { wins: 0, losses: 0 };
  return <section className="goals-strip" aria-label="Placar, regra e metas">
    <div className="goal-card">
      <span className="goal-eyebrow"><span className="caps">Placar de hoje</span></span>
      <strong className="goal-big">{today.wins}V · {today.losses}D</strong>
      <small>trades registrados pelo bot demo (dia UTC)</small>
    </div>
    <div className="goal-card">
      <span className="goal-eyebrow">A REGRA · {ladder.name.toUpperCase()} · RISCO {ladder.riskPct}%</span>
      <div className="rule-row"><span>+1 degrau</span><Dots value={ladder.wins} total={ladder.winsToUp} kind="win" /><b>{ladder.wins}/{ladder.winsToUp}V</b></div>
      <div className="rule-row"><span>−1 degrau</span><Dots value={ladder.losses} total={ladder.lossesToDown} kind="loss" /><b>{ladder.losses}/{ladder.lossesToDown}D</b></div>
      <small>{ladder.appliedToBot ? 'Aplicada ao bot demo (BOT_LADDER=1).' : 'Só no placar: o bot usa o risco base. Ative com BOT_LADDER=1.'} Ou queda de {ladder.ddDownPct}% desce um degrau. Teto: 2× a base.</small>
    </div>
    <div className="goal-card">
      <span className="goal-eyebrow"><span className="caps">Meta do escritório</span></span>
      <div className="goal-bar"><i style={{ width: `${goal.pct * 100}%` }} /></div>
      <div className="goal-row"><b>US$ {goal.totalUsd.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</b><span>de US$ {goal.targetUsd.toLocaleString('pt-BR')}</span></div>
      <small>{goal.reached ? 'Meta atingida (em conta demo).' : 'Lucro registrado em conta demo; não é retorno real.'}</small>
    </div>
    <div className="goal-card">
      <span className="goal-eyebrow">CONQUISTAS · {unlocked}/{achievements.length}</span>
      <div className="badges">{achievements.map(a => <span key={a.id} className={a.done ? 'is-done' : ''} title={a.done ? `Desbloqueada em ${new Date(a.at).toLocaleDateString('pt-BR')}` : 'Ainda não'}>{a.done ? '★' : '☆'} {a.label}</span>)}</div>
    </div>
  </section>;
}

const r2 = v => `${v > 0 ? '+' : ''}${Number(v || 0).toFixed(2)}`;
const tone = (st, enough = true) => !st.n || !enough ? '' : st.expectancyR > 0 ? 'is-pos' : 'is-neg';

export function SchoolBoard({ school, onRun, disabled }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!school) return null;
  const rules = school.rules || {};
  const promoted = school.students.find(s => s.id === school.promotion?.studentId);
  const go = async () => {
    setBusy(true); setErr('');
    try { await onRun(); } catch { setErr('Não foi possível reavaliar agora.'); } finally { setBusy(false); }
  };
  const when = school.lastRun ? new Date(school.lastRun).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
  return <section className="school-board" aria-label="Escola de traders">
    <header>
      <div><span className="goal-eyebrow"><span className="caps">Escola de traders · professora Sofia</span></span>
        <h3>{school.students?.length || 'As'} variações da estratégia, avaliadas em papel</h3>
        <small>Velas de 1h (4h para quem tem a etiqueta) em {school.symbols?.length || 0} mercados ({school.candles || 0} velas cada). Estudo = primeiros {Math.round((rules.split || 0.7) * 100)}% · prova = o resto · papel = trades iniciados depois de {new Date(school.startedAt).toLocaleDateString('pt-BR')}.</small></div>
      <div className="school-run"><small>{school.running || busy ? 'Avaliando…' : when ? `Avaliada ${when}` : 'Primeira avaliação em breve'}</small>
        <button type="button" onClick={go} disabled={disabled || busy || school.running}>Reavaliar agora</button></div>
    </header>
    {err && <p className="school-error" role="alert">{err}</p>}
    {school.lastError && <p className="school-error" role="alert">{school.lastError}</p>}
    {school.students.length > 0 && <div className="school-table" role="table">
      <div role="row" className="school-row school-head"><span>#</span><span>Aluno</span><span>Estudo</span><span>Prova</span><span>Papel</span><span>Situação</span></div>
      {school.students.map(s => <div role="row" key={s.id} className={`school-row ${s.id === school.candidateId ? 'is-candidate' : ''}`} style={{ '--agent-color': s.color }}>
        <span>{s.rank}</span>
        <span className="school-name"><b>{s.emoji} {s.name}</b><small>{s.style}</small></span>
        <span className={tone(s.study, s.study.n >= rules.minStudy)}>{r2(s.study.expectancyR)} R<small>{s.study.n} trades · {Math.round(s.study.winRate * 100)}%</small></span>
        <span className={tone(s.exam, s.exam.n >= rules.minExam)}>{s.exam.n ? `${r2(s.exam.expectancyR)} R` : '—'}<small>{s.exam.n} trades</small></span>
        <span className={tone(s.paper, s.paper.n >= rules.minPaper)}>{s.paper.n ? `${r2(s.paper.expectancyR)} R` : '—'}<small>{s.paper.n}/{rules.minPaper}</small></span>
        <span className={`school-status st-${s.status.code}`}>{s.status.label}</span>
      </div>)}
    </div>}
    {school.promotion && <div className={`school-promo ${school.promotion.ready ? 'is-ready' : ''}`}>
      {school.promotion.ready
        ? <p><b>🎓 {promoted?.name} está pronto para promoção.</b> {school.promotion.appliedToBot ? 'O bot demo já usa os parâmetros deste aluno.' : 'O bot continua com a estratégia atual; para usar este aluno, ative BOT_SCHOOL_PROMOTE=1.'}</p>
        : <p><b>Ninguém promovido.</b> {school.promotion.reasons.join(' ')}</p>}
      <small>Promoção exige: expectativa positiva no estudo com ≥{rules.minStudy} trades, aprovação na prova (≥{rules.minExam}), ≥{rules.minPaper} trades em papel com expectativa positiva e superar a turma base. Custos de taxa e slippage incluídos; funding não. Resultado passado não garante resultado futuro.</small>
    </div>}
  </section>;
}

const STATUS_LABEL = { ok: 'OK', atencao: 'Atenção', alerta: 'Alerta' };
const AREA_LABEL = { risco: 'Risco', trader: 'Trader', estrategia: 'Estratégia', escola: 'Escola', metas: 'Metas', operacao: 'Operação' };

export function ManagerCard({ manager, onReview, disabled }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!manager) return null;
  const r = manager.last;
  const go = async () => {
    setBusy(true); setErr('');
    try { await onReview(); } catch (e) { setErr(e?.message || 'Não foi possível gerar o parecer.'); } finally { setBusy(false); }
  };
  return <section className="manager-card" aria-label="Parecer do gerente">
    <header>
      <div><span className="goal-eyebrow"><span className="caps">Gerente · Claude</span></span>
        <h3>Parecer do escritório</h3>
        <small>Lê o estado atual (humor, regra, metas, escola, sinais) e escreve um parecer. Só leitura: não envia ordens nem muda configuração. Cada parecer é uma chamada paga à API.</small></div>
      <div className="school-run"><small>{busy || manager.running ? 'Escrevendo…' : r ? `Último: ${new Date(r.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Nenhum parecer ainda'}</small>
        <button type="button" onClick={go} disabled={disabled || busy || manager.running || !manager.enabled}>Pedir parecer</button></div>
    </header>
    {!manager.enabled && <p className="school-error">Indisponível: configure <code>ANTHROPIC_API_KEY</code> no <code>server/.env</code> e reinicie o servidor.</p>}
    {(err || manager.error) && <p className="school-error" role="alert">{err || manager.error}</p>}
    {r && <div className="manager-body">
      <p className="manager-summary">{r.resumo}</p>
      <ul>{r.pontos.map((p, i) => <li key={i} className={`mg-${p.status}`}><b>{AREA_LABEL[p.area] || p.area}</b><em>{STATUS_LABEL[p.status]}</em><span>{p.texto}</span></li>)}</ul>
      {r.proximos_passos.length > 0 && <><span className="goal-eyebrow"><span className="caps">Próximos passos</span></span><ol>{r.proximos_passos.map((x, i) => <li key={i}>{x}</li>)}</ol></>}
      <small>{r.model} · não é recomendação de investimento.</small>
    </div>}
  </section>;
}

export function ProposalsCard({ proposals, bot }) {
  if (!proposals) return null;
  const approved = proposals.filter(p => p.decision === 'approved').length;
  return <section className="proposals-card" aria-label="Propostas do bot">
    <header>
      <div><span className="goal-eyebrow">PROPOSTA → APROVAÇÃO → EXECUÇÃO · RICARDO</span>
        <h3>Propostas do bot demo</h3>
        <small>Cada entrada vira uma proposta; o Ricardo confere 8 limites (gate, stop/alvo, risco, tamanho, notional, perda no stop, vagas, ativo livre) e, se tudo passar, roda a Máquina do Tempo (10.000 replays do futuro + a mesma regra no histórico real). Só então o bot executa. Barradas não viram ordem.</small></div>
      <div className="proposals-tally"><span><b>{approved}</b> aprovadas · <b>{proposals.length - approved}</b> barradas</span><small>últimas {proposals.length}</small></div>
    </header>
    {!proposals.length ? <p className="quiet-copy">{bot?.enabled ? 'Nenhuma proposta registrada ainda: o bot só propõe quando surge sinal novo acima do gate.' : 'Nenhuma proposta: a execução demo está desligada neste servidor (DEMO_BOT=0).'}</p>
      : <ul className="proposals-list">{proposals.map(p => <li key={`${p.ts}-${p.symbol}`} className={p.decision === 'approved' ? 'is-ok' : 'is-blocked'}>
        <div className="proposal-head"><b>{p.decision === 'approved' ? '✓ Aprovada' : '✗ Barrada'}</b><span>{p.symbol} · {p.tf === '240' ? '4h' : p.tf === '60' ? '1h' : `${p.tf}m`} · {p.dir}</span>
          {p.outcome && <em className={`outcome o-${p.outcome}`}>{{ opened: 'ordem aberta na demo', 'dry-run': 'só simulada (dry-run)', failed: 'envio falhou na corretora', pending: 'aguardando envio' }[p.outcome]}</em>}
          <small>{new Date(p.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>
        {p.reason && <p>{p.reason}</p>}
        {p.timeMachine && !p.reason && <p className="proposal-tm">⏳ Máquina do Tempo: {p.timeMachine.text}</p>}
        {p.checks.length > 0 && <div className="proposal-checks">{p.checks.map(c => <span key={c.label} className={c.ok ? 'ok' : 'no'} title={c.detail}>{c.ok ? '✓' : '✗'} {c.label}</span>)}</div>}
      </li>)}</ul>}
  </section>;
}
