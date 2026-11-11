import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { createOffice } from '../src/services/office.js';

function setup(t, overrides={}) {
  const path=mkdtempSync(join(tmpdir(),'office-test-'));
  t.after(()=>{
    assert.ok(resolve(path).startsWith(resolve(join(tmpdir(),'office-test-'))));
    rmSync(path,{recursive:true,force:true});
  });
  const bot={
    CFG:{enabled:false,dryRun:true,riskPct:1,maxOpen:3,dailyLossLimitPct:4,minProb:85,maxNotionalPct:.2,token:'PRIVATE_TOKEN'},
    loadState:()=>({paused:false,dayKey:'2026-09-03',keys:{'BTCUSDT|60':{open:{entry:100,stop:95}}}}),
    readTrades:()=>[],readEvents:()=>[{ts:1000,type:'error',symbol:'BTCUSDT',detail:'PRIVATE_PROVIDER_ERROR'}],
    aggregateTrades:()=>({n:0,winRate:0,expectancyR:0}),
    setPaused:()=>assert.fail('Office must never mutate the bot'),
  };
  return createOffice({bot,analyze:async()=>({signal:'NEUTRAL',probability:60}),backtest:async()=>({stats:{n:0}}),
    chat:async()=>({text:'Contexto disponível.',provider:'groq'}),aiEnabled:false,
    dataDir:pathToFileURL(path+'/'),...overrides});
}
test('snapshot is read-only, marks unreconciled history and omits credentials/provider errors',t=>{
  const s=setup(t).snapshot();
  assert.equal(s.readOnly,true);assert.equal(s.bot.reconciled,false);assert.equal(s.bot.source,'local-history');
  assert.equal(s.agents.length,6);assert.ok(s.agents.every(a=>a.state==='idle'));
  assert.ok(!JSON.stringify(s).includes('PRIVATE_'));
});
test('analyst task calls existing analysis and persists a correlated lifecycle',async t=>{
  const office=setup(t,{analyze:async query=>{assert.equal(query.symbol,'ETHUSDT');return {signal:'LONG',probability:88};}});
  const result=await office.run('analyst',{symbol:'ETHUSDT',interval:'240'});
  assert.equal(result.signal,'LONG');
  const s=office.snapshot(),events=s.events.filter(e=>e.source==='office');
  assert.equal(events.length,2);assert.equal(events[0].correlationId,events[1].correlationId);
  assert.equal(s.agents.find(a=>a.id==='analyst').result.probability,88);
});
test('duplicate concurrent tasks are rejected and working state is observable',async t=>{
  let done;const result=new Promise(resolve=>{done=resolve;});
  const office=setup(t,{analyze:()=>result});const task=office.run('analyst');
  assert.equal(office.snapshot().agents.find(a=>a.id==='analyst').state,'working');
  await assert.rejects(office.run('analyst'),e=>e.status===409);
  done({signal:'NEUTRAL'});await task;
});
test('invalid requests do not create jobs or call analysis',async t=>{
  const office=setup(t,{analyze:()=>assert.fail('Invalid input reached strategy')});
  await assert.rejects(office.run('missing'),e=>e.status===404);
  await assert.rejects(office.run('analyst',{symbol:'../../env'}),e=>e.status===400);
  await assert.rejects(office.run('analyst',{interval:'1'}),e=>e.status===400);
  assert.equal(office.snapshot().events.filter(e=>e.source==='office').length,0);
});
test('upstream errors become truthful failure states without leaking secrets',async t=>{
  const office=setup(t,{analyze:async()=>{throw Error('PRIVATE_SECRET');}});
  await assert.rejects(office.run('analyst'),e=>e.status===502&&!e.message.includes('PRIVATE_SECRET'));
  const s=office.snapshot();assert.equal(s.agents.find(a=>a.id==='analyst').state,'error');
  assert.ok(!JSON.stringify(s).includes('PRIVATE_SECRET'));
});
test('risk review never claims approval; executor never submits orders',async t=>{
  const office=setup(t);
  const risk=await office.run('risk'),trader=await office.run('trader');
  assert.ok(risk.items.some(s=>s.includes('Nenhuma proposta aprovada')));
  assert.ok(trader.items.some(s=>s.includes('não envia ordens')));
});
test('HTTP routes reject chat without configured AI and return the real snapshot',async t=>{
  const office=setup(t),app=express();app.use(express.json());app.use('/api/office',office.router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}/api/office`;
  assert.equal((await fetch(url+'/snapshot')).status,200);
  const res=await fetch(url+'/agents/analyst/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'hello'})});
  assert.equal(res.status,503);assert.match((await res.json()).error,/Groq/);
});
test('chat context contains no token or provider errors and supplies no tools',async t=>{
  const office=setup(t,{aiEnabled:true,chat:async args=>{
    assert.ok(!JSON.stringify(args).includes('PRIVATE_'));assert.equal(args.tools,undefined);
    assert.match(args.messages[0].content,/não envia ordens/);
    return {text:'Consulta contextual.',provider:'groq'};
  }});
  const app=express();app.use(express.json());app.use('/api/office',office.router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const res=await fetch(`http://127.0.0.1:${server.address().port}/api/office/agents/analyst/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'O que consta nos registros?'})});
  assert.equal(res.status,200);assert.equal((await res.json()).data.text,'Consulta contextual.');
});
test('SSE emits a real snapshot and releases the connection on disconnect',async t=>{
  const office=setup(t),app=express();app.use('/api/office',office.router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const controller=new AbortController();
  const res=await fetch(`http://127.0.0.1:${server.address().port}/api/office/events`,{signal:controller.signal});
  assert.match(res.headers.get('content-type'),/text\/event-stream/);
  const reader=res.body.getReader(),first=await reader.read();
  const body=new TextDecoder().decode(first.value);
  assert.match(body,/event: snapshot/);assert.match(body,/"reconciled":false/);
  controller.abort();await reader.cancel().catch(()=>{});
});
