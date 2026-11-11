import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createMarketMonitor } from '../src/services/market-monitor.js';

const signal=(side='LONG')=>({price:100,probability:88,signal:side,stage:side==='NEUTRAL'?'watch':'go'});

test('scans all five original watchlist markets without a browser or trading client',async()=>{
  const calls=[];
  const m=createMarketMonitor({analyze:async q=>{calls.push(q);return signal();}});
  await m.scan();
  assert.equal(calls.length,5);assert.ok(calls.every(q=>q.interval==='1'&&q.limit==='300'));
  assert.equal(m.snapshot().items.length,5);assert.equal(m.snapshot().scanCount,1);
});
test('unchanged signals are deduplicated; a withdrawn entry is explicitly reported',async()=>{
  let side='LONG';const events=[];
  const m=createMarketMonitor({symbols:['BTCUSDT'],analyze:async()=>signal(side),onEvent:e=>events.push(e)});
  await m.scan();await m.scan();assert.equal(events.length,1);assert.equal(events[0].type,'signal.detected');
  side='NEUTRAL';await m.scan();assert.equal(events.length,2);assert.equal(events[1].type,'signal.withdrawn');
  assert.equal(m.snapshot().items[0].signal,'NEUTRAL');
});
test('partial upstream failure invalidates that market without preserving an old entry',async()=>{
  let fail=false;
  const m=createMarketMonitor({symbols:['BTCUSDT','ETHUSDT'],analyze:async q=>{if(fail&&q.symbol==='BTCUSDT')throw Error('secret');return signal();}});
  await m.scan();fail=true;await m.scan();
  const [btc,eth]=m.snapshot().items;
  assert.equal(btc.signal,null);assert.equal(btc.stale,true);assert.equal(eth.signal,'LONG');
  assert.ok(!JSON.stringify(m.snapshot()).includes('secret'));
});
test('overlapping cycles do not duplicate requests',async()=>{
  let done;const pending=new Promise(resolve=>{done=resolve;});let calls=0;
  const m=createMarketMonitor({symbols:['BTCUSDT'],analyze:()=>{calls++;return pending;}});
  const first=m.scan();assert.equal(await m.scan(),false);assert.equal(calls,1);
  done(signal());await first;assert.equal(m.snapshot().scanCount,1);
});
test('old timeframe results cannot overwrite the newly selected timeframe',async()=>{
  let done;const pending=new Promise(resolve=>{done=resolve;});
  const m=createMarketMonitor({symbols:['BTCUSDT'],analyze:()=>pending});
  const task=m.scan();m.configure('15');done(signal());await task;
  assert.equal(m.snapshot().interval,'15');assert.equal(m.snapshot().items.length,0);
  assert.throws(()=>m.configure('nonsense'),e=>e.status===400);
});
test('cached readings become stale after two scan periods',async()=>{
  let now=1000000;
  const m=createMarketMonitor({symbols:['BTCUSDT'],scanMs:45000,now:()=>now,analyze:async()=>signal()});
  await m.scan();assert.equal(m.snapshot().items[0].stale,false);
  now+=90001;assert.equal(m.snapshot().items[0].stale,true);
});
test('a timed-out market is aborted and cannot remain an actionable signal',async()=>{
  let requestSignal;
  const m=createMarketMonitor({symbols:['BTCUSDT'],timeoutMs:10,analyze:(_q,options)=>{requestSignal=options.signal;return new Promise(()=>{});}});
  await m.scan();assert.equal(requestSignal.aborted,true);assert.equal(m.snapshot().items[0].signal,null);
});
test('invalid market data is rejected',async()=>{
  const m=createMarketMonitor({symbols:['BTCUSDT'],analyze:async()=>({...signal(),price:NaN})});
  await m.scan();assert.equal(m.snapshot().items[0].signal,null);
});
test('start runs repeatedly with no subscribers and stop prevents future cycles',async t=>{
  let calls=0;
  const m=createMarketMonitor({symbols:['BTCUSDT'],scanMs:20,analyze:async()=>{calls++;return signal();}});
  t.after(()=>m.stop());m.start();
  for(let i=0;i<20&&calls<2;i++)await delay(10);
  assert.ok(calls>=2);m.stop();const stopped=calls;await delay(50);
  assert.equal(calls,stopped);assert.equal(m.snapshot().enabled,false);
});
test('changing timeframe mid-scan starts the new timeframe promptly',async t=>{
  const calls=[];
  const m=createMarketMonitor({symbols:['BTCUSDT'],scanMs:5000,analyze:async q=>{calls.push(q.interval);await delay(60);return signal();}});
  t.after(()=>m.stop());
  m.start();await delay(20);m.configure('5');await delay(1300);
  assert.ok(calls.includes('5'),'new timeframe not scanned: '+calls);
});
