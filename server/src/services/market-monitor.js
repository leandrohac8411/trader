import { randomUUID } from 'node:crypto';

export const WATCH_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'];
export const WATCH_INTERVALS = ['1','5','15','60','240'];
const decision = a => a.signal === 'LONG' ? 'Entrada de compra' : a.signal === 'SHORT' ? 'Entrada de venda' :
  a.stage === 'ready' ? 'Preparando' : a.stage === 'watch' ? 'Formando' : 'Aguardar';

// Public-market observation only. This module has no access to execution or LLM clients.
export function createMarketMonitor({ analyze, onChange=()=>{}, onEvent=()=>{}, symbols=WATCH_SYMBOLS,
  interval='1', scanMs=45_000, timeoutMs=25_000, now=Date.now }) {
  let enabled=false,running=false,timer=null,ticket=0,lastScan=null,nextScan=null,scanCount=0,generation=0;
  let items=[],alerts=[];
  const previous=new Map(),controllers=new Set();
  function snapshot() {
    return { enabled,running,interval,symbols,scanMs,scanCount,lastScan,nextScan,
      items:items.map(item=>({...item,stale:!!item.error || now()-Date.parse(item.updatedAt)>scanMs*2})),
      alerts:alerts.slice(0,20) };
  }
  async function scan() {
    if(running)return false;
    running=true;const version=generation,tf=interval;
    onChange();
    try {
      const results=await Promise.all(symbols.map(async symbol=>{
        const ctrl=new AbortController();controllers.add(ctrl);let deadline;
        try {
          const data=await Promise.race([
            analyze({symbol,interval:tf,limit:'300'},{signal:ctrl.signal}),
            new Promise((_,reject)=>{deadline=setTimeout(()=>{ctrl.abort();reject(Error('timeout'));},timeoutMs);}),
          ]);
          if(!data || !Number.isFinite(data.price) || data.price<=0 || !Number.isFinite(data.probability) ||
            !['LONG','SHORT','NEUTRAL'].includes(data.signal)) throw Error('invalid market data');
          return {...data,symbol,interval:tf,decision:decision(data),updatedAt:new Date(now()).toISOString(),error:null};
        } catch {return {symbol,interval:tf,signal:null,decision:'Dados indisponíveis',error:'Falha na consulta de mercado.',updatedAt:new Date(now()).toISOString()};}
        finally {clearTimeout(deadline);controllers.delete(ctrl);}
      }));
      // Ignore an obsolete cycle after changing timeframe or stopping.
      if(version!==generation)return false;
      for(const item of results) {
        const key=`${item.symbol}|${tf}`,prev=previous.get(key);
        const state=item.error?'error':`${item.signal}|${item.stage}`;
        if(prev!==state) {
          const type=item.error?'market.unavailable':item.signal==='LONG'||item.signal==='SHORT'?'signal.detected':
            prev?.startsWith('LONG|')||prev?.startsWith('SHORT|')?'signal.withdrawn':'signal.updated';
          const message=`${item.symbol} · ${tf}m — ${item.decision}${item.error?'':` · score ${item.probability}/100`}`;
          const alert={id:randomUUID(),ts:now(),symbol:item.symbol,interval:tf,signal:item.signal,type,message};
          alerts.unshift(alert);alerts=alerts.slice(0,30);
          onEvent({agentId:'analyst',type,message,correlationId:alert.id});
          previous.set(key,state);
        }
      }
      items=results;scanCount++;lastScan=new Date(now()).toISOString();
      return true;
    } finally {
      running=false;
      if(enabled)nextScan=new Date(now()+scanMs).toISOString();
      onChange();
    }
  }
  function schedule(delay=scanMs) {
    clearTimeout(timer);
    if(!enabled)return;
    const mine=++ticket;
    nextScan=new Date(now()+delay).toISOString();
    timer=setTimeout(async()=>{
      if(running){schedule(250);return;}
      try{await scan();}catch{items=symbols.map(symbol=>({symbol,interval,signal:null,decision:'Dados indisponíveis',error:'Falha ao atualizar o monitor.',updatedAt:new Date(now()).toISOString()}));onChange();}
      // A newer schedule (e.g. configure() mid-scan) owns the timer; do not clobber it.
      finally{if(mine===ticket)schedule();}
    },delay);
    timer.unref?.();
  }
  function start() {if(enabled)return;enabled=true;nextScan=new Date(now()).toISOString();schedule(0);}
  function stop() {enabled=false;generation++;clearTimeout(timer);nextScan=null;controllers.forEach(c=>c.abort());}
  function configure(tf) {
    if(!WATCH_INTERVALS.includes(String(tf)))throw Object.assign(Error('Período inválido.'),{status:400});
    if(String(tf)===interval)return snapshot();
    interval=String(tf);generation++;items=[];lastScan=null;alerts=[];previous.clear();controllers.forEach(c=>c.abort());
    schedule(running?1000:0);onChange();return snapshot();
  }
  return {snapshot,scan,start,stop,configure};
}
