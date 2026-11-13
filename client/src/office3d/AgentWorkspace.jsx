import { useState } from 'react';
import TraderChart from './TraderChart.jsx';

const stamp=ts=>new Date(ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const number=n=>Number.isFinite(n)?n.toLocaleString('pt-BR',{maximumFractionDigits:4}):'—';

export default function AgentWorkspace({agent,snapshot,connected}) {
  const [symbol,setSymbol]=useState('BTCUSDT'),[interval,setIntervalValue]=useState('1'),[signal,setSignal]=useState(null);
  const readings=snapshot?.monitor?.items||[];
  const entry=readings.filter(r=>!r.stale&&!r.error&&['LONG','SHORT'].includes(r.signal));
  const events=(snapshot?.events||[]).filter(e=>e.agentId===agent.id);
  const positions=snapshot?.bot?.positions||[],trades=snapshot?.bot?.closedTrades||[];
  if(agent.id!=='trader')return <section className="agent-workspace role-workspace" aria-label={`Estação de ${agent.name}`}>
    <div className="workstation-title"><span>ESTAÇÃO DE {agent.role.toUpperCase()}</span><h2>O que {agent.name} está acompanhando</h2></div>
    {agent.id==='analyst'?<><p className="workspace-explanation">Varredura automática dos cinco mercados. Os sinais continuam sendo atualizados enquanto você navega.</p><div className="focused-markets">{readings.length?readings.map(r=><div key={r.symbol}><strong>{r.symbol}</strong><b>{!connected||r.error||r.stale?'Dados indisponíveis':r.decision}</b><span>Score {!connected||r.error||r.stale?'—':`${r.probability}/100`}</span></div>):<p>Aguardando a próxima leitura automática.</p>}</div></>:
      <div className="role-task-overview"><h3>{agent.result?.title||agent.task}</h3><p>{agent.state==='working'?'Consulta em andamento.':agent.lastRun?`Última consulta: ${stamp(agent.lastRun)}`:'Nenhuma consulta executada nesta sessão.'}</p>
        <ul>{(agent.result?.items||[]).map((item,i)=><li key={i}>{item}</li>)}</ul>
        {agent.result?.stats&&<div className="focused-markets"><div><strong>Operações</strong><b>{agent.result.stats.n}</b></div><div><strong>Acerto histórico</strong><b>{number(agent.result.stats.winRate*100)}%</b></div><div><strong>Expectativa</strong><b>{number(agent.result.stats.expectancyR)} R</b></div></div>}
      </div>}
    <Activity events={events}/>
  </section>;
  const fresh=connected&&signal?.chartSymbol===symbol&&signal?.chartInterval===interval;
  const signalText=!fresh?'Aguardando leitura':signal.signal==='LONG'?'Sinal de compra':signal.signal==='SHORT'?'Sinal de venda':'Aguardando entrada';
  return <section className="agent-workspace trader-workspace" aria-label="Estação de trading do Lucas">
    <div className="workstation-title"><div><span><span className="caps">Mesa de trading · Bybit Demo</span></span><h2>O mercado na mesa do Lucas.</h2></div><span className="workstation-live">{connected?'● Acompanhamento ao vivo':'● Reconectando'}</span></div>
    <div className="trader-task-status"><i/><div><strong>{snapshot?.bot.enabled?'Acompanhando mercado e registros do bot demo':'Acompanhando o mercado · execução demo desligada'}</strong><p>Lucas mostra as velas e os sinais. {entry.length?`${entry.length} ativo(s) com sinal no radar.`:'O radar continua procurando sinais automaticamente.'}</p></div></div>
    <div className="workstation-controls"><div className="market-select"><label htmlFor="trader-symbol">Mercado</label><select id="trader-symbol" value={symbol} onChange={e=>{setSymbol(e.target.value);setSignal(null);}}>{['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'].map(s=><option key={s}>{s}</option>)}</select></div><div className="chart-timeframes" aria-label="Período das velas">{['1','5','15','60','240'].map(tf=><button key={tf} onClick={()=>{setIntervalValue(tf);setSignal(null);}} aria-pressed={interval===tf}>{tf==='60'?'1h':tf==='240'?'4h':`${tf}m`}</button>)}</div></div>
    <TraderChart symbol={symbol} interval={interval} connected={connected} onSignal={setSignal}/>
    <div className="trader-decision"><div><small><span className="caps">Leitura da estratégia</span></small><strong>{signalText}</strong><span>{fresh?`Consenso ${signal.consensus} · score ${signal.probability}/100`:'Consultando indicadores no mesmo período das velas.'}</span></div><div><small><span className="caps">Stop de referência</span></small><strong>{fresh?number(signal.levels?.stop):'—'}</strong></div><div><small><span className="caps">Alvo TP1</span></small><strong>{fresh?number(signal.levels?.tp1):'—'}</strong></div></div>
    <p className="workspace-disclosure">Sinais não são ordens executadas. Posições e trades abaixo são registros locais, sem confirmação atual da corretora.</p>
    <div className="trader-records"><div><h3>Posições registradas <span>{positions.length}</span></h3>{positions.length?positions.map(p=><div className="trader-record" key={p.key}><strong>{p.key}</strong><span>{p.side==='Buy'?'Compra':'Venda'} · entrada {number(p.entry)}</span><small>Registro local</small></div>):<p>Nenhuma posição no arquivo local.</p>}</div><div><h3>Últimos encerramentos</h3>{trades.length?trades.slice(-3).reverse().map((t,i)=><div className="trader-record" key={i}><strong>{t.symbol} · {t.dir}</strong><span>PnL demo registrado: US$ {number(t.pnlUsd)}</span><small>{stamp(t.closedAt)}</small></div>):<p>Nenhum encerramento registrado.</p>}</div></div>
    <Activity events={events}/>
  </section>;
}

function Activity({events}) {
  return <div className="focused-activity"><h3>Atividade deste agente</h3>{events.length?events.slice(0,6).map(e=><div key={e.id}><time>{stamp(e.ts)}</time><p>{e.message}</p><span>{e.source==='bot'?'Histórico do bot':'Registro do escritório'}</span></div>):<p>Ainda não há eventos registrados para este agente.</p>}</div>;
}
