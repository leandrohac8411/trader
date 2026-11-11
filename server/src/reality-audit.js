// Independent, read-only research harness. Never imports the private trading client.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { computeIndicators, evaluateBar, trendBiasSeries } from './services/strategy.js';
import { runBacktest } from './services/backtest.js';

const dir = new URL('../backtests/reality/', import.meta.url);
mkdirSync(dir, { recursive: true });
const day = 86400000;
const end = Date.UTC(2026, 10, 10); // fixed cutoff: only complete UTC days
const start = end - 365 * day;
const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
async function candles(symbol, tf, from) {
  const file = new URL(`${symbol}-${tf}.json`, dir);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const found = new Map();
  let cursor = end - 1;
  while (cursor >= from) {
    const qs = new URLSearchParams({ category: 'linear', symbol, interval: tf, limit: '1000', end: String(cursor) });
    let json;
    for (let retry = 0; retry < 3; retry++) {
      try {
        const r = await fetch(`https://api.bybit.com/v5/market/kline?${qs}`, { signal: AbortSignal.timeout(20000) });
        json = await r.json();
        if (!r.ok || json.retCode !== 0) throw Error(JSON.stringify(json));
        break;
      } catch (e) { if (retry === 2) throw e; await new Promise(r => setTimeout(r, 1000)); }
    }
    const rows = json.result.list;
    if (!rows.length) break;
    for (const r of rows) {
      const [ts, open, high, low, close, volume] = r.map(Number);
      if (ts >= from && ts < end) found.set(ts, { ts, open, high, low, close, volume });
    }
    const next = Math.min(...rows.map(r => Number(r[0]))) - 1;
    if (next >= cursor) throw Error('pagination did not advance');
    cursor = next;
    await new Promise(r => setTimeout(r, 80));
  }
  const out = [...found.values()].sort((a,b) => a.ts-b.ts);
  const ms = tf === 'D' ? day : Number(tf)*60000;
  if (out.some((c,i) => i && c.ts-out[i-1].ts !== ms)) throw Error(`Gap: ${symbol} ${tf}`);
  writeFileSync(file, JSON.stringify(out));
  return out;
}

function summary(trades) {
  let eq = 1, peak = 1, dd = 0;
  for (const t of trades) { eq *= 1+t.accountReturn; peak = Math.max(peak,eq); dd = Math.max(dd,1-eq/peak); }
  const wins = trades.filter(t=>t.netR>0), losses = trades.filter(t=>t.netR<=0);
  const sum = (a,k) => a.reduce((s,t)=>s+t[k],0);
  // Seeded moving-block bootstrap preserves some local serial dependence.
  let seed = 1729;
  const rnd = () => ((seed = (1664525*seed+1013904223)>>>0)/4294967296);
  const means = [];
  if (trades.length) for (let b=0;b<2000;b++) {
    let total=0, n=0;
    while(n<trades.length) { const k=Math.floor(rnd()*trades.length); for(let j=0;j<5&&n<trades.length;j++,n++) total+=trades[(k+j)%trades.length].netR; }
    means.push(total/trades.length);
  }
  means.sort((a,b)=>a-b);
  return { n:trades.length, winRate:wins.length/trades.length||0, expectancyR:sum(trades,'netR')/trades.length||0,
    profitFactor: losses.length ? sum(wins,'netR')/-sum(losses,'netR') : null,
    cappedAccountReturnPct:(eq-1)*100, maxDrawdownPct:dd*100,
    blockBootstrap95R:trades.length>=20?[means[50],means[1949]]:null };
}

function simulate(cs, daily, tf, costSidePct) {
  const ms = Number(tf)*60000;
  const hb = trendBiasSeries(daily.map(c=>c.close));
  let hp=-1, pos=null, lastSignal=null, lastExit=-Infinity;
  const trades=[], signals=[];
  let ambiguous=0;
  for(let i=299;i<cs.length;i++) {
    const c=cs[i];
    // Stop first on ambiguous bars; gaps execute at the worse opening price.
    if(pos) {
      const hitStop=pos.dir===1?c.low<=pos.stop:c.high>=pos.stop;
      const hitTp=pos.dir===1?c.high>=pos.tp:c.low<=pos.tp;
      if(hitStop||hitTp||i===cs.length-1) {
        if(hitStop&&hitTp) ambiguous++;
        const exit=hitStop?(pos.dir===1?Math.min(c.open,pos.stop):Math.max(c.open,pos.stop)):hitTp?pos.tp:c.close;
        const cost=2*costSidePct/100*pos.entry;
        // Adverse funding scenario: 0.01% notional each 8 hours, regardless of side.
        const funding=Math.floor((c.ts+ms-pos.openTs)/(8*3600000))*0.0001*pos.entry;
        const net=pos.dir*(exit-pos.entry)-cost-funding;
        const qty=Math.min(0.01/pos.risk,0.2/pos.entry);
        trades.push({...pos,exit,exitTs:c.ts+ms,reason:hitStop?'stop':hitTp?'tp1':'end',netR:net/pos.risk,accountReturn:qty*net});
        pos=null; lastExit=i;
      }
    }
    const decisionTs=c.ts+ms;
    while(hp+1<daily.length && daily[hp+1].ts+day<=decisionTs) hp++;
    const window=cs.slice(i-299,i+1);
    const ev=evaluateBar(window,computeIndicators(window),299,{htfBias:hp>=54?hb[hp]:null});
    if(c.ts>=start && ev.rawSignal!=='NEUTRAL') signals.push({ts:c.ts,probability:ev.probability,dir:ev.rawSignal==='LONG'?1:-1,i});
    if(c.ts<start) { lastSignal=ev.signal; continue; }
    if(!pos && i>lastExit && i+1<cs.length && ev.signal!=='NEUTRAL' &&
      (lastSignal!==ev.signal || i-lastExit>=10)) {
      const entry=cs[i+1].open, dir=ev.signal==='LONG'?1:-1;
      if(dir*(entry-ev.levels.stop)>0 && dir*(ev.levels.tp1-entry)>0)
        pos={dir,entry,stop:ev.levels.stop,tp:ev.levels.tp1,risk:Math.abs(entry-ev.levels.stop),openTs:cs[i+1].ts,probability:ev.probability};
    }
    lastSignal=ev.signal;
  }
  const split=Date.UTC(2026,7,10);
  const calibration=[85,90].map(lo=>{
    const ss=signals.filter(s=>s.probability>=lo&&s.probability<(lo===85?90:101)&&s.i+20<cs.length);
    return {range:lo===85?'85-89':'90-100',n:ss.length,winRate20:ss.filter(s=>s.dir*(cs[s.i+20].close-cs[s.i].close)>0).length/ss.length||0};
  });
  return {full:summary(trades), recent3Months:summary(trades.filter(t=>t.openTs>=split)),
    first9Months:summary(trades.filter(t=>t.openTs<split)), ambiguousBars:ambiguous,calibration,trades};
}

const rows=[];
for(const symbol of symbols) {
  const daily=await candles(symbol,'D',start-120*day);
  for(const tf of ['60','240']) {
    const cs=await candles(symbol,tf,start-300*Number(tf)*60000);
    const original=runBacktest(cs,{htfCandles:daily,singleTarget:false,warmup:300});
    // Same engine with only the two most material known biases removed.
    const shifted=daily.map(c=>({...c,ts:c.ts+day-Number(tf)*60000}));
    const corrected=runBacktest(cs,{htfCandles:shifted,singleTarget:true,warmup:300});
    const realistic=simulate(cs,daily,tf,0.075);
    const stress=simulate(cs,daily,tf,0.15);
    const row={symbol,tf,candles:cs.length,from:new Date(start).toISOString(),to:new Date(end).toISOString(),original:original.trades,corrected:corrected.trades,realistic,stress};
    rows.push(row);
    writeFileSync(new URL('results.json',dir),JSON.stringify({cutoff:new Date(end).toISOString(),
      methodology:{source:'Bybit v5 linear public klines',start:new Date(start).toISOString(),
        recentStart:'2026-08-10T00:00:00.000Z',rollingWindow:300,gate:85,cooldownBars:10,
        entry:'next candle open after closed signal candle',htf:'closed daily candles only',
        exit:'full TP1, stop first if both touched; worse opening price on stop gaps; terminal mark-to-market',
        feePctPerSide:0.055,slippagePctPerSide:0.02,stressTotalCostPctPerSide:0.15,
        funding:'adverse assumed 0.01% notional per 8h elapsed; NOT historical funding',
        sizing:'1% risk capped at 20% equity notional, recomputed each trade',
        bootstrap:'2000 seeded moving-block resamples of 5 trades; intervals omitted below 20 trades',
        limitations:['independent market streams, not combined portfolio','does not replay live unfinished candles',
          'no order book, latency, instrument lot rounding or exchange rejections',
          'no shared max-open or daily loss pause','recent holdout is descriptive, not proven unseen during original development',
          'forward calibration samples overlap and are not independent','funding scenario is an assumption, not actual exchange payments']},rows},null,2));
    console.log(JSON.stringify({symbol,tf,originalR:original.trades.expectancyR,correctedR:corrected.trades.expectancyR,realistic:realistic.full,recent:realistic.recent3Months,stressR:stress.full.expectancyR,calibration:realistic.calibration}));
  }
}
