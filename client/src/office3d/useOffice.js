import { useCallback, useEffect, useRef, useState } from 'react';
import { API } from '../services/api.js';

const base = import.meta.env.VITE_API_BASE?.replace(/\/$/,'') || '';
const POLL = import.meta.env.VITE_OFFICE_POLL === '1';
export default function useOffice() {
  const [snapshot,setSnapshot]=useState(null);
  const [connection,setConnection]=useState('connecting');
  const [error,setError]=useState('');
  const reconnect=useRef(null);
  const openedAt=useRef(Date.now()),seenAlerts=useRef(new Set());
  const [notifications,setNotifications]=useState(()=>!('Notification' in window)?'unsupported':Notification.permission==='denied'?'denied':Notification.permission==='granted'&&localStorage.getItem('office-alerts')!=='off'?'on':'off');
  // Browser notifications for new signals (same for SSE and polling).
  const notify=useCallback(alerts=>{
    for(const alert of alerts||[]){
      if(seenAlerts.current.has(alert.id))continue;seenAlerts.current.add(alert.id);
      if(alert.ts<openedAt.current||!['signal.detected','signal.withdrawn'].includes(alert.type))continue;
      if('Notification' in window&&Notification.permission==='granted'&&localStorage.getItem('office-alerts')!=='off'){
        try{new Notification(alert.type==='signal.detected'?'Novo sinal no escritório':'Sinal retirado — aguardar',{body:alert.message,tag:`office-${alert.symbol}-${alert.interval}`});}catch{/* In-app alerts remain available. */}
      }
    }
    if(seenAlerts.current.size>500)seenAlerts.current=new Set((alerts||[]).map(a=>a.id));
  },[]);
  const refresh=useCallback(async()=>{
    try {const json=await API.get('/api/office/snapshot');setSnapshot(json.data);setError('');reconnect.current?.();}
    catch {setError('Não foi possível consultar o servidor. Verifique se o backend está ligado.');}
  },[]);
  // Vercel (serverless) não mantém conexão aberta: consulta o snapshot a cada 15 s,
  // só com a aba visível (aba escondida não gasta banda do Upstash) e de novo ao voltar.
  useEffect(()=>{
    if(!POLL)return undefined;
    let alive=true,lastRefresh=0;
    // Com o site aberto, pede uma leitura do radar quando os dados passam do intervalo
    // (o servidor ignora se outra leitura acabou de acontecer). Ordens continuam só pelo agendador.
    const radarStale=s=>{const m=s?.monitor;if(!s?.scheduler||!m)return false;const last=Date.parse(m.lastScan||0);return !last||Date.now()-last>(m.scanMs||300000);};
    const load=async()=>{
      try{
        let json=await API.get('/api/office/snapshot');if(!alive)return;
        setSnapshot(json.data);setConnection('connected');setError('');notify(json.data?.monitor?.alerts);
        if(radarStale(json.data)&&Date.now()-lastRefresh>60_000){
          lastRefresh=Date.now();
          await API.post('/api/office/refresh',{},{timeout:60000});
          json=await API.get('/api/office/snapshot');if(!alive)return;setSnapshot(json.data);notify(json.data?.monitor?.alerts);
        }
      }
      catch{if(alive)setConnection('reconnecting');}
    };
    const visible=()=>!document.hidden;
    load();const timer=setInterval(()=>{if(visible())load();},15_000);
    const onShow=()=>{if(visible())load();};
    document.addEventListener('visibilitychange',onShow);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',onShow);};
  },[notify]);
  useEffect(()=>{
    if(POLL)return undefined;
    let alive=true,last=Date.now(),stream;
    function connect(){
      stream?.close();last=Date.now();
      const source=new EventSource(`${base}/api/office/events`);stream=source;
      source.addEventListener('snapshot',event=>{
        if(!alive||stream!==source)return;
        try {const value=JSON.parse(event.data);setSnapshot(value);setConnection('connected');setError('');last=Date.now();
          notify(value.monitor?.alerts);
        }
        catch {setConnection('reconnecting');}
      });
      source.addEventListener('unavailable',()=>{if(alive&&stream===source)setConnection('reconnecting');});
      source.onerror=()=>{if(alive&&stream===source)setConnection('reconnecting');};
    }
    reconnect.current=connect;connect();
    // A proxy can leave an SSE socket open after the API restarts. Reopen stale streams.
    const check=setInterval(()=>{if(Date.now()-last>16000){setConnection('reconnecting');connect();}},5000);
    return ()=>{alive=false;stream.close();reconnect.current=null;clearInterval(check);};
  },[notify]);
  const run=useCallback(async(id,params)=>{
    const response=await API.post(`/api/office/agents/${id}/run`,params,{timeout:60000});
    await refresh();return response.data;
  },[refresh]);
  const chat=useCallback(async(id,prompt)=>{
    const response=await API.post(`/api/office/agents/${id}/chat`,{prompt},{timeout:45000});
    return response.data;
  },[]);
  const runSchool=useCallback(async()=>{await API.post('/api/office/school/run',{},{timeout:180000});await refresh();},[refresh]);
  const reviewManager=useCallback(async()=>{await API.post('/api/office/manager/review',{},{timeout:180000});await refresh();},[refresh]);
  const setMonitorInterval=useCallback(async interval=>{await API.post('/api/office/monitor',{interval});await refresh();},[refresh]);
  const enableNotifications=useCallback(async()=>{
    if(!('Notification' in window))return;
    if(Notification.permission==='granted'&&localStorage.getItem('office-alerts')!=='off'){localStorage.setItem('office-alerts','off');setNotifications('off');return;}
    try {
      const permission=await Notification.requestPermission();
      if(permission==='granted'){localStorage.setItem('office-alerts','on');setNotifications('on');}
      else setNotifications(permission==='denied'?'denied':'off');
    } catch {setNotifications('denied');}
  },[]);
  return {snapshot,connection,error,refresh,run,chat,runSchool,reviewManager,setMonitorInterval,notifications,enableNotifications};
}
