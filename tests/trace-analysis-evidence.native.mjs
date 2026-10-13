import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {traceNativeGame,traceProvider,gamePages} from './fixtures/trace-analysis-native.mjs';

// Separate native slot. Synthetic HTTP responses, production collector and
// SourceTransport. This does not measure a target Cloudflare account's CPU quota.
test('Workerd collects the maximum bounded Trace radar and rejects frame+1',async()=>{
 const modules={},names=['src/sources/trace.js','src/sources/common.js','src/sources/http.js','src/sources/trace-contracts.js'];
 for(const name of names)modules[name]={type:'esm',contents:await readFile(name,'utf8')};
 const fingerprint=createHash('sha256').update(names.map(n=>n+'\0'+modules[n].contents).join('\0')).digest('hex');
 const pages=await gamePages(traceProvider(traceNativeGame())),args=pages.flatMap(p=>p.children).find(c=>c.kind==='radar').args;
 modules['trace-resource-entry.js']={type:'esm',contents:`
  import {collectTrace} from './src/sources/trace.js';
  import {SourceTransport} from './src/sources/http.js';
  import {classifyFailure} from './src/sync/errors.js';
  export default {async fetch(request){
   const raw=await request.text(),transport=new SourceTransport({}, {fetch:async(url)=>url.endsWith('/users/self/token')?Response.json({data:{user_id:1,token:'synthetic-token',timestamp:1}}):new Response(raw,{headers:{'Content-Type':'application/json'}})});
   try{const result=await collectTrace({j:{kind:'radar',scan_id:'native-test'},args:${JSON.stringify(args)},transport,credential:'PHPSESSID=synthetic',account:{id:'account',provider:'trace',native_id:'1'}});return Response.json({complete:result.complete,value:JSON.parse(result.records.trace_parts[0].value),calls:transport.calls,response_bytes:transport.observations.at(-1).bytes});}
   catch(error){return Response.json({error:classifyFailure(error),calls:transport.calls});}
  }};`};
 modules['src/sync/errors.js']={type:'esm',contents:await readFile('src/sync/errors.js','utf8')};
 modules['src/sources/teamsnap-diagnostics.js']={type:'esm',contents:await readFile('src/sources/teamsnap-diagnostics.js','utf8')};
 const mf=new Miniflare({cf:false,inspectorPort:0,telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'trace-resource',compatibilityDate:'2026-09-09',manifest:{mainModule:'trace-resource-entry.js',modulesRoot:path.resolve('.'),modules},env:{},exports:{}}}]});
 let socket,heapBefore=null,heapAfter=null,heapRetained=null,profilerError=null,call,heapTimer=null,heapSampling=false;const heapSamples=[];
 try{
  await mf.ready;console.log(JSON.stringify({trace_native_stage:'ready'}));
  try{const endpoint=new URL(await mf.getInspectorURL());endpoint.protocol='http:';endpoint.pathname='/json/list';const targets=await(await fetch(endpoint)).json(),target=targets.find(v=>v.id==='core:user:trace-resource');if(!target?.webSocketDebuggerUrl)throw Error('Trace Worker inspector target unavailable');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Trace Worker inspector connection timed out')),5000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(Error('Trace Worker inspector connection failed'));};});const pending=new Map();let id=0;socket.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);pending.delete(v.id);if(!p)return;v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}};call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('Inspector timeout: '+method));},5000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id:key,method,params}));});heapBefore=await call('Runtime.getHeapUsage');await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:100});await call('Profiler.start');heapTimer=setInterval(async()=>{if(heapSampling)return;heapSampling=true;try{heapSamples.push(await call('Runtime.getHeapUsage'));}catch{}finally{heapSampling=false;}},20);}catch(error){profilerError=error.message;}
  console.log(JSON.stringify({trace_native_stage:'collect',telemetry_error:profilerError}));
  const actors=Object.fromEntries(Array.from({length:10},(_,i)=>[String(i),{}])),radar={frm:Array.from({length:60000},(_,i)=>({t:i*10,a:actors})),padding:''};
  radar.padding='x'.repeat(8_000_000-Buffer.byteLength(JSON.stringify(radar)));const body=JSON.stringify(radar);assert.equal(Buffer.byteLength(body),8_000_000);const started=performance.now();
  const result=await(await mf.dispatchFetch('http://localhost/radar',{method:'POST',body})).json(),elapsed=performance.now()-started;
  assert.equal(result.complete,true);assert.equal(result.calls,2);assert.equal(result.value.samples,60000);assert.equal(result.value.analysis.play_window.end,5999.9);assert.equal(result.value.analysis.both_sides_verified,null);assert.equal(result.response_bytes,Buffer.byteLength(body));
  console.log(JSON.stringify({trace_native_stage:'collected'}));if(heapTimer){clearInterval(heapTimer);heapTimer=null;}let profile=null;try{if(call){profile=(await call('Profiler.stop')).profile;heapAfter=await call('Runtime.getHeapUsage');await call('HeapProfiler.collectGarbage');heapRetained=await call('Runtime.getHeapUsage');}}catch(error){profilerError=error.message;}
  const samples={};if(profile){const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame.functionName||'(anonymous)']));for(let i=0;i<(profile.samples||[]).length;i++){const name=nodes.get(profile.samples[i]);samples[name]=(samples[name]||0)+(profile.timeDeltas?.[i]||0);}}
  const transportOver=await(await mf.dispatchFetch('http://localhost/radar',{method:'POST',body:body+' '})).json();assert.equal(transportOver.error.code,'record_too_large');assert.equal(transportOver.error.kind,'permanent');
  delete radar.padding;radar.frm.push({t:600000,a:{}});const over=await(await mf.dispatchFetch('http://localhost/radar',{method:'POST',body:JSON.stringify(radar)})).json();assert.equal(over.error.code,'record_too_large');assert.equal(over.error.kind,'permanent');
  console.log(JSON.stringify({trace_radar_native:{source_fingerprint:fingerprint,frames:60000,actor_observations:600000,response_bytes:result.response_bytes,typed_reduction_bytes:720000,collector_wall_ms:elapsed,heap_before:heapBefore,heap_after:heapAfter,heap_retained_after_gc:heapRetained,maximum_sampled_heap_used_bytes:Math.max(0,...heapSamples.map(h=>h.usedSize),heapAfter?.usedSize||0),heap_samples:heapSamples.length,actual_peak_heap_unavailable:true,profile_top_samples_us:Object.entries(samples).sort((a,b)=>b[1]-a[1]).slice(0,12),telemetry_error:profilerError,private_provider_receipt:false,cloudflare_plan_cpu_verified:false}}));
 }finally{if(heapTimer)clearInterval(heapTimer);socket?.close();await mf.dispose();}
});
