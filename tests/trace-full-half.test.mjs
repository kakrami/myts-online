import test from 'node:test';
import assert from 'node:assert/strict';
import {traceNativeGame,traceProvider,gamePages,traceStorage} from './fixtures/trace-analysis-native.mjs';

async function fixture({seconds=120,mode='normal'}={}){
 const game=traceNativeGame();game.moments.forEach(m=>m.duration=seconds);
 const p=traceProvider(game),original=p.transport.fetcher;
 let fullRequests=0;const spans=[];
 p.transport.fetcher=async(url,options)=>{
  const request=JSON.parse(options.body||'{}');
  if(request.operationName!=='getHaloData')return original(url,options);
  const s=request.variables.segments[0];spans.push([s.local_start,s.duration]);
  const full=s.duration===seconds*1000;if(full)fullRequests++;
  if(full&&mode==='oversize')return new Response(' '.repeat(8_000_001),{headers:{'Content-Type':'application/json'}});
  if(full&&mode==='unsupported')return Response.json({data:{halo:{}}});
  if(['401','403','429','500'].includes(mode))return new Response('{}',{status:Number(mode),headers:{'Content-Type':'application/json','Retry-After':'60'}});
  const ring=[];for(let at=s.local_start;at<s.local_start+s.duration;at+=1000)ring.push([at,'L'],[Math.min(at+500,s.local_start+s.duration),'L'],[at+750,'DISCONTINUITY']);
  return Response.json({data:{halo:{ring}},...(mode==='near_limit'?{padding:'x'.repeat(7_800_000)}:{})});
 };
 const store=traceStorage();for(const page of await gamePages(p))await store.save(page);
 const child=(await gamePages(p)).flatMap(v=>v.children).find(v=>v.kind==='tracking');
 return {p,store,child,spans,get fullRequests(){return fullRequests;}};
}
async function drain(f,cursor={}){
 const pages=[],start=f.p.transport.calls,cpu=process.cpuUsage(),wall=performance.now();
 for(let i=0;i<30;i++){
  const page=await f.p.collect('tracking',f.child.args,cursor);
  assert.ok(Buffer.byteLength(JSON.stringify(page.checkpoint))<=8192);
  for(const row of page.records.trace_parts||[]){assert.ok(Buffer.byteLength(row.value)<=60000);assert.ok(JSON.parse(row.value).segments.length<=1000);}
  await f.store.save(page);pages.push(page);if(page.complete)break;cursor=page.checkpoint;
 }
 assert.ok(pages.at(-1).complete);const used=process.cpuUsage(cpu);
 return {pages:pages.length,requests:f.p.transport.calls-start,wall_ms:performance.now()-wall,cpu_ms:(used.user+used.system)/1000,
 intervals:f.store.all('SELECT segments FROM source_tracking_segments').flatMap(r=>JSON.parse(r.segments))};
}
for(const seconds of [120,2500,10000])test(`full half and legacy chunks preserve ${seconds} intervals with bounded persistence`,async t=>{
 const full=await fixture({seconds}),legacy=await fixture({seconds});t.after(()=>{full.store.close();legacy.store.close();});
 const a=await drain(full),b=await drain(legacy,{chunk:0});
 assert.equal(a.intervals.length,seconds);assert.deepEqual(a.intervals,b.intervals);
 assert.equal(full.fullRequests,a.pages);assert.equal(legacy.fullRequests,0);
 assert.ok(a.requests<=b.requests);
 t.diagnostic(JSON.stringify({seconds,full:{...a,intervals:undefined},legacy:{...b,intervals:undefined},synthetic:true}));
});
for(const mode of ['oversize','unsupported'])test(`${mode} full response saves fallback before segmented requests`,async t=>{
 const f=await fixture({mode});t.after(()=>f.store.close());
 const page=await f.p.collect('tracking',f.child.args,{});await f.store.save(page);
 assert.deepEqual(page.checkpoint,{chunk:0,chunk_pages:{}});assert.equal(page.complete,false);assert.deepEqual(page.records,{});
 assert.equal(f.spans.length,1);assert.equal(page.coverage[0].complete,false);
 const result=await drain(f,page.checkpoint);assert.equal(f.fullRequests,1);assert.equal(result.requests,8);assert.equal(result.intervals.length,120);
});
for(const mode of ['401','403','429','500'])test(`${mode} never triggers segmented fallback`,async t=>{
 const f=await fixture({mode});t.after(()=>f.store.close());
 await assert.rejects(()=>f.p.collect('tracking',f.child.args,{}),e=>e.status===Number(mode)||mode==='429'&&e.code==='rate_limited'||mode==='500'&&e.code==='source_http');
 assert.equal(f.spans.length,1);assert.equal(f.store.all('SELECT * FROM source_tracking_segments').length,0);
});
test('near-limit full response retains transport and record bounds',async t=>{
 const f=await fixture({mode:'near_limit'});t.after(()=>f.store.close());const result=await drain(f);
 assert.equal(result.pages,1);assert.equal(result.requests,2);
 const observation=f.p.transport.observations.at(-1);assert.ok(observation.bytes>7_800_000&&observation.bytes<=8_000_000);
 t.diagnostic(JSON.stringify({bytes:observation.bytes,cpu_ms:result.cpu_ms,wall_ms:result.wall_ms,synthetic:true}));
});
test('legacy final chunk retains cursor and completes without full-half request',async t=>{
 const f=await fixture();t.after(()=>f.store.close());
 const page=await f.p.collect('tracking',f.child.args,{chunk:3,chunk_pages:{0:1,1:1,2:1}});
 assert.equal(page.complete,true);assert.deepEqual(f.spans,[[90000,30000]]);assert.equal(f.fullRequests,0);
 assert.deepEqual(page.replacements[0].chunk_pages,{0:1,1:1,2:1,3:1});
});

test('full-half completion cleans old chunk rows only after bounded continuation finishes',async t=>{
 const f=await fixture({seconds:5000});t.after(()=>f.store.close());
 await drain(f,{chunk:0});assert.equal(f.store.all('SELECT * FROM source_tracking_segments').length,8);
 const first=await f.p.collect('tracking',f.child.args,{});await f.store.save(first);
 assert.equal(first.complete,false);assert.equal(first.coverage[0].complete,false);assert.deepEqual(first.replacements,[]);
 assert.equal(first.checkpoint.protocol,'trace-tracking-full-v1');
 await drain(f,first.checkpoint);
 const rows=f.store.all('SELECT chunk,page_offset,segments FROM source_tracking_segments ORDER BY page_offset');
 assert.deepEqual(rows.map(r=>[r.chunk,r.page_offset]),[[0,0],[0,1000],[0,2000],[0,3000],[0,4000]]);
 assert.equal(rows.reduce((n,r)=>n+JSON.parse(r.segments).length,0),5000);
});
test('changed full response restarts bounded paging rather than mixing digests',async t=>{
 const f=await fixture({seconds:5000});t.after(()=>f.store.close());
 const first=await f.p.collect('tracking',f.child.args,{});await f.store.save(first);
 const original=f.p.transport.fetcher;f.p.transport.fetcher=async(url,options)=>{
  const response=await original(url,options);if(JSON.parse(options.body||'{}').operationName!=='getHaloData')return response;
  const value=await response.json();value.data.halo.ring=value.data.halo.ring.slice(0,1800);return Response.json(value);
 };
 const changed=await f.p.collect('tracking',f.child.args,first.checkpoint);await f.store.save(changed);
 assert.equal(changed.complete,true);assert.equal(JSON.parse(changed.records.trace_parts[0].value).segments.length,600);
 assert.equal(f.store.all('SELECT * FROM source_tracking_segments').length,1);
});
test('invocation request budget yields without segmented fallback or persistence',async t=>{
 const f=await fixture();t.after(()=>f.store.close());f.p.transport.maxCalls=f.p.transport.calls+1;
 await assert.rejects(()=>f.p.collect('tracking',f.child.args,{}),e=>e.code==='invocation_budget');
 assert.equal(f.spans.length,0);assert.equal(f.store.all('SELECT * FROM source_tracking_segments').length,0);
});
