import { useEffect, useState } from 'react';

export default function MarketRadar({monitor,connected,onInterval,onSelect,notifications,onNotifications}) {
  const [now,setNow]=useState(Date.now);
  const [error,setError]=useState('');
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const seconds=monitor?.nextScan?Math.max(0,Math.ceil((Date.parse(monitor.nextScan)-now)/1000)):null;
  const activeAlert=connected?monitor?.alerts?.find(alert=>alert.type==='signal.detected'&&monitor.items.some(item=>
    !item.stale&&!item.error&&item.symbol===alert.symbol&&item.interval===alert.interval&&item.signal===alert.signal&&now-Date.parse(item.updatedAt)<monitor.scanMs*2)):null;
  const latest=activeAlert||monitor?.alerts?.[0];
  const status=!connected?'Sem conexão':!monitor?.enabled?'Iniciando monitoramento':monitor.running?'Analisando o mercado':seconds==null?'Aguardando a próxima leitura':seconds>90?`Próxima leitura em ~${Math.ceil(seconds/60)} min`:seconds>0?`Próxima leitura em ${seconds}s`:'Lendo o mercado…';
  const symbols=monitor?.symbols||['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'];
  async function change(e){setError('');try{await onInterval(e.target.value);}catch(err){setError(err.message);}}
  return <section className="market-radar" aria-label="Monitoramento automático de sinais">
    <div className="radar-heading"><div><i className={connected&&monitor?.enabled?'radar-live':''}/><h2>Alice está de olho no mercado</h2><span>MONITORAMENTO AUTOMÁTICO</span></div>
      <div className="radar-controls"><label>Período <select aria-label="Período do monitoramento automático" value={monitor?.interval||'1'} disabled={!connected} onChange={change}><option value="1">1 minuto</option><option value="5">5 minutos</option><option value="15">15 minutos</option><option value="60">1 hora</option><option value="240">4 horas</option></select></label>
        <button onClick={onNotifications} disabled={notifications==='unsupported'}>{notifications==='on'?'Avisos ativados':notifications==='denied'?'Avisos bloqueados':'Ativar avisos'}</button></div>
    </div>
    <div className="radar-markets">{symbols.map(symbol=>{
      const item=monitor?.items?.find(i=>i.symbol===symbol);
      const stale=!connected||!item||item.stale||now-Date.parse(item.updatedAt)>((monitor?.scanMs||45000)*2);
      const signal=stale?null:item.signal;
      const hot=signal==='LONG'||signal==='SHORT';
      return <button className={`radar-market ${hot?'radar-entry':''} ${signal==='SHORT'?'radar-short':''}`} key={symbol} onClick={()=>onSelect(symbol)}>
        <div><strong>{symbol.replace('USDT','')}<small>/ USDT</small></strong><span>{stale?'—':`${item.probability}/100`}</span></div>
        <b>{!item?'Aguardando leitura':item.error?'Dados indisponíveis':stale?'Leitura desatualizada':item.decision}</b>
        <p>{stale?'Sem sinal válido':`US$ ${item.price.toLocaleString('pt-BR',{maximumFractionDigits:4})}`}<span>{item&&!stale?new Date(item.updatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):''}</span></p>
      </button>;
    })}</div>
    <div className="radar-bottom" role="status"><span><i/>{status}{monitor?.scanCount?` · ${monitor.scanCount} leituras concluídas`:''}</span><span>{(monitor?.scanMs||45000)>=60000?`Atualiza a cada ${Math.round((monitor?.scanMs||0)/60000)} min`:`Atualiza sozinho a cada ${Math.round((monitor?.scanMs||45000)/1000)}s`} · Score ≠ chance de lucro</span></div>
    {latest&&<div className={`radar-alert ${activeAlert?'radar-alert-entry':''}`} aria-live="polite"><strong>{activeAlert?'Sinal ativo':'Último aviso'}</strong><span>{latest.message}</span><time>{new Date(latest.ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time></div>}
    {error&&<p className="action-error" role="alert">{error}</p>}
  </section>;
}
