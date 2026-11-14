import { useEffect, useRef, useState } from 'react';
import OfficeScene from './OfficeScene.jsx';
import useOffice from './useOffice.js';
import MarketView from './MarketView.jsx';
import AgentWorkspace from './AgentWorkspace.jsx';
import './office.css';
import './office-v2.css';
import './office-v2-cream.css';
import { CHARACTER_ATLAS, CHARACTER_CELLS } from './characters.js';
import { CAMERAS } from './createOfficeScene.js';
import { Ficha, GoalsStrip, SchoolBoard, ManagerCard, ProposalsCard } from './GameUI.jsx';
import DemoDesk from './DemoDesk.jsx';
import Ticker from './Ticker.jsx';
import DashboardV2 from './DashboardV2.jsx';
import Clock from './Clock.jsx';
import logoV2 from './assets/logo-v2.webp';

// Abas do escritório (endereço = hash, para poder favoritar ou compartilhar).
const VIEWS=[
  {id:'office',hash:'#office',label:'Escritório',icon:'office',title:'O mercado lá fora. Sua equipe aqui',sub:'Explore o escritório e acompanhe cada decisão.'},
  {id:'desk',hash:'#mesa',label:'Mesa demo',short:'Mesa',icon:'wallet',title:'A conta demo, sem enfeite',sub:'Saldo, entradas, saídas e se a estratégia está ganhando ou não.'},
  {id:'market',hash:'#mercado',label:'Mercado',icon:'pulse',title:'Radar de sinais',sub:'Os cinco mercados acompanhados pela Alice, ao vivo.'},
  {id:'school',hash:'#escola',label:'Escola & gerente',short:'Escola',icon:'cap',title:'Escola de traders e parecer do gerente',sub:'Variações da estratégia em teste e o parecer do Claude.'},
];
const viewFromHash=()=>VIEWS.find(v=>v.hash===window.location.hash)?.id||'office';

const TEAM=[
  {id:'ceo',name:'Arthur',role:'CEO',color:'#e6ad63',task:'Consolida resultados e incidentes.',action:'Preparar relatório'},
  {id:'analyst',name:'Alice',role:'Analista técnica',color:'#61c9bc',task:'Consulta indicadores e identifica sinais.',action:'Analisar mercado'},
  {id:'risk',name:'Ricardo',role:'Gerente de risco',color:'#c6a7ef',task:'Revisa limites e o estado registrado.',action:'Revisar controles'},
  {id:'trader',name:'Lucas',role:'Trader demo',color:'#ee927b',task:'Acompanha os registros de execução demo.',action:'Consultar execução'},
  {id:'scientist',name:'Sofia',role:'Cientista de dados',color:'#82b8eb',task:'Executa backtests e compara resultados.',action:'Rodar backtest'},
  {id:'auditor',name:'Daniel',role:'Auditor',color:'#bed18a',task:'Confere registros e identifica divergências.',action:'Auditar registros'},
];
const time=value=>value?new Date(value).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
const date=value=>value?new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const number=(value,digits=2)=>typeof value==='number'?value.toLocaleString('pt-BR',{maximumFractionDigits:digits}):'—';

function Icon({name,size=20,...props}) {
  const paths={office:<><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 8h.01M15 8h.01M9 12h.01M15 12h.01"/></>,
    chart:<><path d="M4 4v16h17M8 15l4-5 4 3 5-7"/></>,people:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0112 0v3M16 5a3 3 0 010 6M18 14a5 5 0 013 5"/></>,
    pulse:<path d="M2 12h5l3-8 4 16 3-8h5"/>,arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,
    shield:<><path d="M12 3l8 3v6c0 4-8 9-8 9s-8-5-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
    refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 8a7 7 0 0112-2l2 3M4 15l2 3a7 7 0 0012-2"/></>,
    plus:<path d="M12 5v14M5 12h14"/>,minus:<path d="M5 12h14"/>,reset:<><path d="M3 10a9 9 0 111 7M3 4v6h6"/></>,
    pause:<><path d="M9 5v14M15 5v14"/></>,play:<path d="m8 4 12 8-12 8z"/>,send:<><path d="m3 3 19 9-19 9 4-9zM7 12h15"/></>,
    globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 010 18 17 17 0 010-18"/></>,close:<path d="m6 6 12 12M18 6 6 18"/>,
    wallet:<><path d="M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M3 7l12-4 2 4M16 13h2"/></>,
    cap:<><path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]||paths.pulse}</svg>;
}

function Portrait({agent,large=false}) {
  const {col,row}=CHARACTER_CELLS[agent.id];
  return <span className={`agent-portrait portrait-rendered ${large?'portrait-large':''}`} aria-hidden="true"
    style={{'--agent-color':agent.color,backgroundImage:`url("${CHARACTER_ATLAS}")`,backgroundPosition:`${col*50}% ${row*100}%`}}/>;
}

const MOODS=[['perigo','Perigo'],['alerta','Alerta'],['normal','Normal'],['confiante','Confiante']];
function MoodMeter({mood}) {
  if(!mood)return null;
  const streak=mood.streak>0?`${mood.streak}V seguidas`:mood.streak<0?`${-mood.streak}D seguidas`:'sem sequência';
  return <div className={`mood-meter mood-${mood.mood}`} aria-label={`Humor do Lucas: ${mood.label}`}>
    <div className="mood-title"><span><span className="caps">Humor do Lucas</span></span><small>{streak}</small></div>
    <div className="mood-scale">{MOODS.map(([id,label])=><span key={id} className={mood.mood===id?'is-active':''}>{label}</span>)}</div>
    <p>{mood.reason}.{mood.cooldown?` Pausa no lounge: ${mood.cooldownReason}.`:''} <em>Leitura dos registros locais; não altera o bot.</em></p>
  </div>;
}

function MarketInputs({symbol,onSymbol,interval,onInterval}) {
  return <div className="task-inputs"><label>Mercado<select value={symbol} onChange={e=>onSymbol(e.target.value)}>{['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'].map(s=><option key={s}>{s}</option>)}</select></label><label>Período<select value={interval} onChange={e=>onInterval(e.target.value)}><option value="60">1 hora</option><option value="240">4 horas</option></select></label></div>;
}

function Result({result}) {
  if(!result)return <div className="agent-empty"><Icon name="pulse" size={25}/><p>Pronto para a próxima consulta.</p><span>Execute uma tarefa para ver os dados e as conclusões deste agente.</span></div>;
  if(result.kind==='signal')return <div className="agent-result">
    <div className="result-title">{result.title}</div>
    <div className="signal-heading"><strong>{result.signal==='LONG'?'Entrada de compra':result.signal==='SHORT'?'Entrada de venda':result.decision||'Aguardar'}</strong><span>{result.probability}<small>/100</small></span></div>
    <div className="score-track"><i style={{width:`${result.probability}%`}}/></div>
    <dl className="result-data"><div><dt>Preço consultado</dt><dd>US$ {number(result.price)}</dd></div><div><dt>Consenso</dt><dd>{result.consensus}</dd></div><div><dt>Última vela</dt><dd>{time(result.lastCandleAt)}</dd></div></dl>
    {['LONG','SHORT'].includes(result.signal)&&result.levels&&<dl className="result-data"><div><dt>Entrada de referência</dt><dd>{number(result.levels.entry,5)}</dd></div><div><dt>Stop</dt><dd>{number(result.levels.stop,5)}</dd></div><div><dt>Alvo TP1</dt><dd>{number(result.levels.tp1,5)}</dd></div></dl>}
    <ul className="reason-list">{result.reasons?.slice(0,4).map((r,i)=><li key={i}>{r}</li>)}</ul><p className="result-note">{result.note}</p>
  </div>;
  if(result.kind==='backtest')return <div className="agent-result"><div className="result-title">{result.title}</div>
    <dl className="result-data"><div><dt>Operações</dt><dd>{result.stats.n}</dd></div><div><dt>Acerto</dt><dd>{number(result.stats.winRate*100,1)}%</dd></div><div><dt>Expectativa</dt><dd>{number(result.stats.expectancyR,3)} R</dd></div><div><dt>Retorno simulado</dt><dd>{number(result.stats.totalReturnPct)}%</dd></div><div><dt>Maior queda</dt><dd>{number(result.stats.maxDrawdownPct)}%</dd></div></dl>
    <p className="result-note">{result.note}</p></div>;
  return <div className="agent-result"><div className="result-title">{result.title}</div><ul className="review-list">{result.items?.map((item,i)=><li key={i}>{item}</li>)}</ul></div>;
}

export default function Office({onDashboard}) {
  const {snapshot,connection,error,refresh,run,chat,runSchool,reviewManager,setMonitorInterval,notifications,enableNotifications}=useOffice();
  const [selected,setSelected]=useState('analyst'),[tab,setTab]=useState('activity');
  const [symbol,setSymbol]=useState('BTCUSDT'),[interval,setIntervalValue]=useState('60');
  const [running,setRunning]=useState(null),[actionError,setActionError]=useState('');
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [prompt,setPrompt]=useState(''),[messages,setMessages]=useState({}),[chatting,setChatting]=useState(false);
  const [eventsExpanded,setEventsExpanded]=useState(false);
  const [analysisView,setAnalysisView]=useState('live');
  const [focused,setFocused]=useState(null);
  const [cam,setCam]=useState(null);
  const [view,setViewState]=useState(viewFromHash);
  // Visual: v1 (original) ou v2 (nova cara). ?ui=1/2 na URL escolhe; a escolha fica salva neste navegador.
  const [ui,setUiState]=useState(()=>{const q=new URLSearchParams(window.location.search).get('ui');if(q==='1'||q==='2')return q;try{return localStorage.getItem('office-ui')||'2';}catch{return '2';}});
  function setUi(v){setUiState(v);try{localStorage.setItem('office-ui',v);}catch{/* sem armazenamento */}}
  useEffect(()=>{const sync=()=>setViewState(viewFromHash());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
  function setView(id){const v=VIEWS.find(x=>x.id===id);setViewState(id);if(v&&window.location.hash!==v.hash)history.replaceState(null,'',v.hash);window.scrollTo({top:0,behavior:'instant'});}
  const current=VIEWS.find(v=>v.id===view)||VIEWS[0];
  const scene=useRef(null),chatScroll=useRef(null);
  const agents=snapshot?.agents||TEAM;
  const agent=agents.find(a=>a.id===selected)||TEAM[1];
  const connected=connection==='connected';
  const events=snapshot?.events||[];
  const agentEvents=events.filter(e=>e.agentId===selected);
  const busy=running===selected||agent.state==='working';
  const visibleMessages=messages[selected]||[];
  const liveSignal=snapshot?.monitor?.items?.find(item=>item.symbol===symbol);
  const liveResult=connected&&liveSignal&&!liveSignal.stale&&!liveSignal.error?{...liveSignal,kind:'signal',
    title:`${symbol} · ${liveSignal.interval}m · automático`,note:'Atualizado automaticamente pela estratégia existente. Não envia ordens.'}:null;
  useEffect(()=>{chatScroll.current?.scrollTo({top:chatScroll.current.scrollHeight,behavior:'smooth'});},[messages,selected]);
  useEffect(()=>{if(!focused)return;const back=event=>{if(event.key==='Escape')setFocused(null);};window.addEventListener('keydown',back);return()=>window.removeEventListener('keydown',back);},[focused]);
  function select(id){setViewState('office');if(window.location.hash!=='#office')history.replaceState(null,'','#office');setSelected(id);setActionError('');setFocused(id);setTab('activity');requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}));}
  function showOffice(){setFocused(null);setActionError('');setView('office');}
  function locate(){setFocused(null);requestAnimationFrame(()=>requestAnimationFrame(()=>scene.current?.focus(selected)));}
  async function perform(){
    if(selected==='analyst')setAnalysisView('manual');
    setRunning(selected);setActionError('');
    try{await run(selected,{symbol,interval});}catch(e){setActionError(e.message);}finally{setRunning(null);}
  }
  async function send(e){
    e.preventDefault();if(!prompt.trim()||chatting)return;
    const id=selected,text=prompt.trim();setPrompt('');setChatting(true);
    setMessages(m=>({...m,[id]:[...(m[id]||[]),{role:'user',text}]}));
    try{const answer=await chat(id,text);setMessages(m=>({...m,[id]:[...(m[id]||[]),{role:'assistant',text:answer.text}]}));}
    catch(e){setMessages(m=>({...m,[id]:[...(m[id]||[]),{role:'error',text:e.message}]}));}
    finally{setChatting(false);}
  }
  return <div className={`office-app ${ui==='2'?'ui-v2':''} ${reduced?'reduce-motion':''}`}>
    <aside className="office-rail">
      <a className="office-logo" href="#office" onClick={showOffice} aria-label="Escritório Crypto Trading"><span>c</span><i/></a>
      <a className="v2-brand" href="#office" onClick={showOffice} aria-label="Crypto Trading Co. · trading & pesquisa"><img src={logoV2} alt=""/></a>
      <nav className="rail-nav" aria-label="Seções">{VIEWS.map(v=><button key={v.id} className={view===v.id&&!focused?'rail-active':''} aria-current={view===v.id?'page':undefined}
          onClick={()=>{setFocused(null);setView(v.id);}} title={v.label} aria-label={v.label}><Icon name={v.icon}/><span className="rail-label">{v.label}</span></button>)}
        <button onClick={onDashboard} title="Dashboard clássico" aria-label="Abrir dashboard clássico"><Icon name="chart"/><span className="rail-label">Dashboard clássico</span></button></nav>
      <div className="rail-bottom"><span className="operator-avatar">LC</span><span className="rail-version">v0.1</span></div>
    </aside>
    <div className="office-workspace">
      <header className="office-header"><div className="office-wordmark">CRYPTO<span>TRADING CO.</span></div><div className="header-divider"/>
        <div className="office-breadcrumb">Workspace <span>/</span> <strong>{focused?agent.name:current.label}</strong></div>
        {ui==='2'&&<nav className="v2-head-tabs" aria-label="Seções"><span>Workspace</span>{VIEWS.map(v=><button key={v.id} aria-current={view===v.id&&!focused?'page':undefined} className={view===v.id&&!focused?'is-active':''} onClick={()=>{setFocused(null);setView(v.id);}}>{v.label}</button>)}</nav>}
        <div className="header-right"><div className="ui-switch" role="group" aria-label="Versão do visual">{['1','2'].map(v=><button key={v} aria-pressed={ui===v} onClick={()=>setUi(v)}><span className="ui-word">Visual </span>{v}</button>)}</div><span className="demo-badge">{ui==='2'?<i className={`v2-live ${connected?'on':''}`} title={connected?'Conectado ao servidor':'Reconectando…'}/>:<Icon name="shield" size={14}/>} Bybit Demo</span>{ui==='2'&&<Clock/>}<button className="classic-button" onClick={onDashboard}>Dashboard clássico <Icon name="arrow" size={16}/></button></div>
      </header>
      {ui==='2'&&<Ticker monitor={snapshot?.monitor} desk={snapshot?.results?`${snapshot.results.totalPnlUsd>=0?'+':'−'}US$ ${Math.abs(snapshot.results.totalPnlUsd).toLocaleString('pt-BR',{maximumFractionDigits:0})} realizado`:null}/>}
      <main className="office-main">
        <nav className="view-tabs" role="tablist" aria-label="Seções do escritório">{VIEWS.map(v=><button key={v.id} role="tab" aria-selected={view===v.id&&!focused} className={view===v.id&&!focused?'is-active':''}
          onClick={()=>{setFocused(null);setView(v.id);}}><Icon name={v.icon} size={15}/>{v.label}</button>)}</nav>
        <div className="office-title-row"><div><div className="office-eyebrow"><span className="caps">{focused?'Acompanhando um agente':'Seu centro de operações'}</span></div>{ui==='2'?<><h1>{focused?agent.name:current.label}</h1><p>{focused?`${agent.role}: a estação, os dados e a atividade.`:current.sub}</p></>
          :<><h1>{focused?`${agent.name} · ${agent.role}`:current.title}<span>.</span></h1><p>{focused?'A estação, os dados e a atividade deste agente.':current.sub}</p></>}</div>
          <div className={`connection-pill ${connected?'is-connected':''}`} role="status"><i/>{connected?'Conectado ao servidor':connection==='connecting'?'Conectando…':'Reconectando…'}<span>{snapshot?time(snapshot.updatedAt):'—'}</span></div>
        </div>
        {connected&&snapshot?.scheduler?.stale&&<div className="office-warning office-warning-bot" role="alert"><span><b>Bot parado:</b> {snapshot.scheduler.lastTickAt?`o agendador não chama o bot desde ${date(snapshot.scheduler.lastTickAt)}`:'o agendador ainda não chamou o bot nenhuma vez'}. Sem ele não há entradas nem saídas registradas. O radar atualiza enquanto esta página estiver aberta. Confira a tarefa no cron-job.org.</span></div>}
        {(error||!connected&&snapshot)&&<div className="office-warning" role="alert">{error||'Conexão interrompida. Os dados abaixo são da última atualização; novas consultas estão indisponíveis.'}<button onClick={refresh}>Tentar novamente</button></div>}
        {focused&&<div className="agent-focus-nav"><button onClick={showOffice}>← Voltar ao escritório</button><span>O monitor de sinais continua funcionando</span><label>Funcionário<select aria-label="Trocar agente em foco" value={selected} onChange={e=>select(e.target.value)}>{agents.map(a=><option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}</select></label></div>}
        {!focused&&view==='desk'&&<><DemoDesk snapshot={snapshot} connected={connected}/><ProposalsCard proposals={snapshot?.proposals} bot={snapshot?.bot}/><GoalsStrip game={snapshot?.game} mood={snapshot?.crew?.trader}/></>}
        {!focused&&view==='market'&&<MarketView snapshot={snapshot} connected={connected} onInterval={setMonitorInterval} notifications={notifications} onNotifications={enableNotifications}/>}
        {!focused&&view==='school'&&<><SchoolBoard school={snapshot?.school} onRun={runSchool} disabled={!connected}/><ManagerCard manager={snapshot?.manager} onReview={reviewManager} disabled={!connected}/></>}
        {ui==='2'&&!focused&&view==='office'&&<DashboardV2 agents={agents} snapshot={snapshot} connected={connected} selected={selected} onSelect={select} reduced={reduced} sceneRef={scene} cam={cam} onCamera={setCam}/>}
        {(focused||(view==='office'&&ui!=='2'))&&<div className={`office-floor-layout ${focused?'office-focused-layout':''} ${focused&&selected==='trader'?'agent-focus-trader':''}`}>
          {focused?<AgentWorkspace key={focused} agent={agent} snapshot={snapshot} connected={connected}/>:<section className="floor-column" aria-label="Escritório interativo">
            <div className="floor-topbar"><div><i className="floor-dot"/> Escritório <span>/ 6 estações</span></div><div className="floor-tools">
              <select className="camera-select" aria-label="Escolher câmera" value={cam?.id||''} onChange={e=>scene.current?.setCamera(e.target.value)}>
                {!cam?.id&&<option value="">Câmera livre</option>}
                {CAMERAS.map((c,i)=><option key={c.id} value={c.id}>CAM {String(i+1).padStart(2,'0')} · {c.label}</option>)}
              </select>
              <button className={`tour-button ${cam?.tour?'is-on':''}`} title={cam?.tour?'Parar tour':'Tour automático pelas câmeras'} aria-pressed={!!cam?.tour} onClick={()=>scene.current?.tour(!cam?.tour)}><Icon name={cam?.tour?'pause':'play'} size={13}/> Tour</button>
              <button title={reduced?'Ativar animações':'Pausar animações'} aria-label={reduced?'Ativar animações':'Pausar animações'} onClick={()=>setReduced(v=>!v)}><Icon name={reduced?'play':'pause'} size={16}/></button>
              <button title="Redefinir câmera" aria-label="Redefinir câmera" onClick={()=>scene.current?.reset()}><Icon name="reset" size={16}/></button>
              <button title="Afastar" aria-label="Afastar câmera" onClick={()=>scene.current?.zoom(-.15)}><Icon name="minus" size={16}/></button>
              <button title="Aproximar" aria-label="Aproximar câmera" onClick={()=>scene.current?.zoom(.15)}><Icon name="plus" size={16}/></button>
            </div></div>
            <OfficeScene agents={agents} snapshot={snapshot} selected={selected} onSelect={select} reduced={reduced} sceneRef={scene} onCamera={setCam}/>
            <div className="floor-status"><span><Icon name="shield" size={14}/>{snapshot?.monitor?.enabled?'Monitor de sinais ativo':'Ambiente de pesquisa'}</span><span>{snapshot?.bot.enabled?(snapshot.bot.dryRun?'Execução em dry-run':'Execução demo habilitada'):'Execução demo desligada'}<i/></span></div>
            <section className="team-strip" id="office-team" aria-label="Sua equipe">{agents.map(a=><button key={a.id} onClick={()=>select(a.id)} aria-pressed={selected===a.id} className={`team-member ${selected===a.id?'is-selected':''}`} style={{'--agent-color':a.color}}><Portrait agent={a}/><span><strong>{a.name}</strong><small>{a.role}</small></span><i className={a.state==='working'?'working-dot':''}/></button>)}</section>
          </section>}
          <aside className="agent-panel" style={{'--agent-color':agent.color}} aria-label={`Painel de ${agent.name}`}>
            <div className="agent-panel-eyebrow"><b className="caps">Sua equipe</b><span className="caps">Funcionário selecionado</span></div>
            <div className="agent-identity"><div className="portrait-frame"><Portrait agent={agent} large/></div><div><span className="agent-state"><i/>{!connected?'Sem conexão':selected==='trader'&&snapshot?.crew?.trader?.cooldown?'Pausa no lounge':focused&&selected==='trader'?'Acompanhando velas':busy?'Analisando mercado':agent.state==='monitoring'?'Monitorando automaticamente':agent.state==='error'?'Consulta falhou':'Disponível'}</span><h2>{agent.name}</h2><p>{agent.role}</p></div></div>
            <p className="agent-description">{agent.task}</p>
            <div className="panel-ficha"><Ficha id={agent.id} name={agent.name} color={agent.color} snapshot={snapshot} compact/></div>
            {selected==='trader'&&<MoodMeter mood={snapshot?.crew?.trader}/>}
            <button className="agent-locate" onClick={locate}>Ver {agent.name} no escritório <Icon name="arrow" size={13}/></button>
            <div className="agent-tabs" role="tablist" aria-label="Informações do agente"><button role="tab" aria-selected={tab==='activity'} onClick={()=>setTab('activity')}>Atividade</button><button role="tab" aria-selected={tab==='chat'} onClick={()=>setTab('chat')}>Conversar <Icon name="globe" size={12}/></button></div>
            {tab==='activity'?<div className="agent-activity" role="tabpanel">
              <div className="task-heading"><span className="caps">{selected==='analyst'&&snapshot?.monitor?.enabled?'Acompanhamento ao vivo':'Tarefa do agente'}</span><small>{busy?'Consulta em andamento':selected==='analyst'&&snapshot?.monitor?.lastScan?`Atualizado ${time(snapshot.monitor.lastScan)}`:agent.lastRun?`Consultado ${time(agent.lastRun)}`:'Ainda não consultado'}</small></div>
              {selected==='analyst'&&snapshot?.monitor?.enabled?<details className="manual-analysis"><summary>Fazer uma consulta extra (opcional)</summary><MarketInputs symbol={symbol} onSymbol={setSymbol} interval={interval} onInterval={setIntervalValue}/><button className="agent-action" disabled={!connected||busy||running!==null} onClick={perform}>Consultar agora <Icon name="arrow" size={15}/></button></details>:<>
                {['analyst','scientist'].includes(selected)&&<MarketInputs symbol={symbol} onSymbol={setSymbol} interval={interval} onInterval={setIntervalValue}/>}
                <button className="agent-action" disabled={!connected||busy||running!==null} onClick={perform}><Icon name={busy?'refresh':'play'} size={15}/>{busy?'Consultando…':agent.action}<Icon name="arrow" size={15}/></button>
              </>}
              {(actionError||agent.error)&&<p role="alert" className="action-error">{actionError||agent.error}</p>}
              {selected==='analyst'&&snapshot?.monitor?.enabled&&<p className="result-note">Alice acompanha os cinco ativos e atualiza os sinais automaticamente. Você não precisa iniciar consultas.</p>}
              {selected==='analyst'&&analysisView==='manual'&&<button className="agent-locate" style={{margin:'14px 0'}} onClick={()=>setAnalysisView('live')}>Voltar ao radar automático <Icon name="arrow" size={13}/></button>}
              {selected==='analyst'&&analysisView==='live'&&!liveResult?<p className="result-note">{snapshot?.monitor?.running?'Alice está consultando os cinco mercados. Os sinais aparecerão aqui.':'Aguardando uma leitura válida do mercado. O monitor tenta novamente automaticamente.'}</p>:<Result result={selected==='analyst'&&analysisView==='live'?liveResult:agent.result}/>}
              <div className="agent-recent"><div className="task-heading"><span className="caps">Últimos registros</span><small>{agentEvents.length}</small></div>{agentEvents.length?agentEvents.slice(0,3).map(e=><div className="agent-event" key={e.id}><i/><p>{e.message}<small>{date(e.ts)}</small></p></div>):<p className="quiet-copy">As tarefas e consultas deste agente aparecerão aqui.</p>}</div>
            </div>:<div className="agent-chat" role="tabpanel"><p className="chat-context">Converse com {agent.name} sobre os dados consultados e o histórico disponível. A conversa não executa operações.</p>
              {!snapshot?.aiEnabled&&<div className="chat-unavailable">Groq não configurado. As tarefas dos agentes continuam disponíveis na aba Atividade.</div>}
              <div className="chat-messages" ref={chatScroll} aria-live="polite">{visibleMessages.length?visibleMessages.map((m,i)=><div key={i} className={`chat-message chat-${m.role}`}><span>{m.role==='user'?'Você':agent.name}</span><p>{m.text}</p></div>):<div className="chat-starters"><span>Comece uma conversa</span>{['O que os dados mostram agora?','Quais pontos precisam de atenção?'].map(p=><button key={p} onClick={()=>setPrompt(p)}>{p}<Icon name="arrow" size={14}/></button>)}</div>}{chatting&&<div className="chat-thinking">Consultando a IA…</div>}</div>
              <form className="chat-form" onSubmit={send}><input aria-label={`Mensagem para ${agent.name}`} value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={2000} placeholder={`Conversar com ${agent.name}…`} disabled={!snapshot?.aiEnabled||!connected}/><button aria-label="Enviar mensagem" disabled={!prompt.trim()||chatting||!connected||!snapshot?.aiEnabled}><Icon name="send" size={17}/></button></form>
            </div>}
            <div className="agent-panel-footer"><Icon name="shield" size={13}/> Somente demo. Nenhuma ordem por esta tela.</div>
          </aside>
        </div>}
        {!focused&&view==='office'&&<section className={`office-events ${eventsExpanded?'events-expanded':''}`} aria-label="Registro de atividade"><div className="events-title"><div><Icon name="pulse" size={17}/><h2>O que acontece no escritório</h2><span className="caps">Registros reais</span></div><button onClick={()=>setEventsExpanded(v=>!v)}>{eventsExpanded?'Recolher':'Ver histórico'} <Icon name="arrow" size={15}/></button></div>
          <div className="event-table"><div className="event-table-head"><span className="caps">Horário</span><span className="caps">Origem</span><span className="caps">Atividade</span><span className="caps">Registro</span></div>{events.length?events.slice(0,eventsExpanded?40:4).map(e=>{const a=agents.find(a=>a.id===e.agentId);return <button className="event-row" key={e.id} onClick={()=>select(e.agentId)}><time>{date(e.ts)}</time><span className="event-origin"><i style={{background:a?.color}}/>{a?.name||'Sistema'}</span><span>{e.message}</span><small className={e.source==='bot'?'event-historical':''}>{e.source==='bot'?'Histórico do bot':'Consulta do escritório'}</small></button>;}):<div className="events-empty">Selecione um agente e execute uma consulta para começar.</div>}</div>
        </section>}
        <footer className="office-footer"><span>CRYPTO TRADING CO. <i/> Seu laboratório de mercado.</span><span>Estados reais · Pesquisa simulada · Sem ordens nesta tela</span></footer>
      </main>
    </div>
    {/* Celular: menu fixo embaixo (a barra lateral e as abas do topo somem). */}
    <nav className="mobile-nav" aria-label="Menu">{VIEWS.map(v=><button key={v.id} className={view===v.id&&!focused?'is-active':''} aria-current={view===v.id&&!focused?'page':undefined}
        onClick={()=>{setFocused(null);setView(v.id);}}><Icon name={v.icon} size={21}/><span>{v.short||v.label}</span></button>)}
      <button onClick={onDashboard}><Icon name="chart" size={21}/><span>Clássico</span></button></nav>
  </div>;
}
