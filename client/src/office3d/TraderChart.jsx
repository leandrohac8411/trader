import { useEffect, useRef, useState } from 'react';
import { analyzeStrategy, getKlines } from '../services/api.js';

const fmt=(v,n=2)=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:n}):'—';
const stamp=ts=>new Date(ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

export default function TraderChart({symbol,interval,connected,onSignal}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [bars,setBars]=useState(()=>window.matchMedia('(max-width:650px)').matches?30:65),[hover,setHover]=useState(null);
  const plot=useRef(null),[plotWidth,setPlotWidth]=useState(1000);
  const signalCallback=useRef(onSignal);
  useEffect(()=>{signalCallback.current=onSignal;},[onSignal]);
  useEffect(()=>{const observer=new ResizeObserver(entries=>{setPlotWidth(Math.max(320,entries[0].contentRect.width));});observer.observe(plot.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    let alive=true,timer;
    setData(null);setError('');setLoading(true);setHover(null);signalCallback.current(null);
    async function load(){
      if(!connected){setError('Sem conexão com o servidor. Aguardando reconexão.');setLoading(false);return;}
      try {
        const [prices,analysis]=await Promise.all([getKlines(symbol,interval,'linear',300),analyzeStrategy({symbol,interval,limit:300})]);
        if(!alive)return;
        const candles=prices.data?.candles;
        if(!Array.isArray(candles)||candles.length<2||candles.some(c=>['ts','open','high','low','close'].some(key=>!Number.isFinite(c[key]))||c.low<=0||c.high<c.low||c.open<=0||c.close<=0))throw Error('Histórico indisponível.');
        const result={candles,analysis:analysis.data,updatedAt:Date.now()};
        setData(result);signalCallback.current({...analysis.data,chartSymbol:symbol,chartInterval:interval});setError('');
      } catch {if(alive){setError('Não foi possível atualizar as velas. Tentando novamente automaticamente.');signalCallback.current(null);}}
      finally{if(alive){setLoading(false);timer=setTimeout(load,15000);}}
    }
    load();return()=>{alive=false;clearTimeout(timer);};
  },[symbol,interval,connected]);
  const candles=data?.candles.slice(-bars)||[];
  const selected=candles[Math.min(hover??candles.length-1,candles.length-1)];
  const width=plotWidth,height=plotWidth<500?350:430,left=14,right=85,top=24,bottom=46;
  const chartWidth=width-left-right,chartHeight=height-top-bottom;
  const min=candles.length?Math.min(...candles.map(c=>c.low)):0,max=candles.length?Math.max(...candles.map(c=>c.high)):1;
  const margin=Math.max((max-min)*.12,max*.0002),low=min-margin,high=max+margin;
  const y=price=>top+(high-price)/(high-low)*chartHeight;
  const step=chartWidth/(candles.length||1),body=Math.max(2,step*.57);
  const last=candles.at(-1),lastPrice=last?.close;
  const levels=data?.analysis?.levels;
  const active=connected&&!error&&['LONG','SHORT'].includes(data?.analysis?.signal);
  return <section className="trader-chart" aria-label={`Gráfico de velas ${symbol}`}>
    <div className="chart-toolbar"><div><span className="chart-provider">BYBIT · CONTRATO USDT</span><h3>{symbol.replace('USDT','')} <small>/ USDT</small><b>{fmt(lastPrice,4)}</b></h3></div>
      <div className="chart-zoom"><button aria-label="Mostrar mais velas" onClick={()=>setBars(n=>Math.min(180,n+20))}>−</button><span>{bars} velas</span><button aria-label="Aproximar velas" onClick={()=>setBars(n=>Math.max(25,n-20))}>+</button></div>
    </div>
    <div className="candle-ohlc"><span>{selected?stamp(selected.ts):'—'}</span><span>A <b>{fmt(selected?.open,4)}</b></span><span>M <b>{fmt(selected?.high,4)}</b></span><span>m <b>{fmt(selected?.low,4)}</b></span><span>F <b>{fmt(selected?.close,4)}</b></span><small>Última vela em formação</small></div>
    {error&&<div className="chart-error" role="alert">{error}</div>}
    <div ref={plot} className="candles-area" style={{opacity:!connected||error.length>0 ? .6 : 1}}>
      {!data?<div className="chart-loading">{loading?'Carregando velas reais da Bybit…':'Aguardando dados do mercado.'}</div>:<svg className="candles-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${candles.length} velas de ${symbol}, período ${interval} minutos. Preço mais recente ${fmt(lastPrice,4)} USDT.`}
        onMouseLeave={()=>setHover(null)} onMouseMove={event=>{const rect=event.currentTarget.getBoundingClientRect();const x=(event.clientX-rect.left)/rect.width*width;setHover(Math.max(0,Math.min(candles.length-1,Math.floor((x-left)/step))));}}>
        <defs><clipPath id="candle-plot"><rect x={left} y={top} width={chartWidth} height={chartHeight}/></clipPath></defs>
        {Array.from({length:6},(_,i)=>{const price=low+(high-low)*i/5;return <g key={i}><line x1={left} x2={width-right} y1={y(price)} y2={y(price)} stroke="#29404a" strokeDasharray="3 5"/><text x={width-right+12} y={y(price)+4} fill="#7896a4" fontSize="11">{fmt(price,4)}</text></g>;})}
        <g clipPath="url(#candle-plot)">{candles.map((c,i)=>{const x=left+(i+.5)*step,color=c.close>=c.open?'#83c6ac':'#de9587';return <g key={c.ts}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1.3"/><rect x={x-body/2} y={y(Math.max(c.open,c.close))} width={body} height={Math.max(1.4,Math.abs(y(c.open)-y(c.close)))} rx=".6" fill={color}/></g>;})}
          {active&&[['Entrada',levels?.entry,'#b6c7dd'],['Stop',levels?.stop,'#e6a08b'],['TP1',levels?.tp1,'#aed19f']].map(([label,price,color])=>price>=low&&price<=high?<g key={label}><line x1={left} x2={width-right} y1={y(price)} y2={y(price)} stroke={color} strokeDasharray="8 5" opacity=".65"/><text x={left+8} y={y(price)-5} fill={color} fontSize="11">{label}</text></g>:null)}
        </g>
        {last&&<g><line x1={left} x2={width-right} y1={y(lastPrice)} y2={y(lastPrice)} stroke="#b8cdb8" strokeDasharray="2 4" opacity=".6"/><rect x={width-right+3} y={y(lastPrice)-10} width={80} height={20} rx="3" fill="#a8c9b7"/><text x={width-right+8} y={y(lastPrice)+4} fill="#16292b" fontSize="10">{fmt(lastPrice,4)}</text></g>}
        {hover!=null&&selected&&<g><line x1={left+(hover+.5)*step} x2={left+(hover+.5)*step} y1={top} y2={height-bottom} stroke="#a7b4b9" strokeDasharray="3 4" opacity=".5"/><circle cx={left+(hover+.5)*step} cy={y(selected.close)} r="3" fill="#c7d9d3"/></g>}
        {candles.filter((_,i)=>i%Math.max(1,Math.floor(candles.length/7))===0).map(c=>{const i=candles.indexOf(c);return <text key={c.ts} x={left+(i+.5)*step} y={height-16} fill="#6e8b98" fontSize="11" textAnchor="middle">{Number(interval)>=60?new Date(c.ts).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}):stamp(c.ts)}</text>;})}
      </svg>}
    </div>
    <div className="chart-footnote"><span>{connected&&!error?'● Dados públicos da Bybit':'● Leitura indisponível'}{data?` · consultado ${stamp(data.updatedAt)}`:''}</span><span>Consulta automática a cada 15s</span></div>
  </section>;
}
