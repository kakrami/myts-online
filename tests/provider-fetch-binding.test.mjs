import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';

// Exercise the native Workerd global fetch, not an injected JavaScript fetch.
// Every outbound HTTPS request is intercepted locally. No provider account,
// external network request, credential, or user browser is involved.
const root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||'.');
let mf,outgoing=[];
const secret='synthetic-private-value';
test.before(async()=>{
 const modules={};for(const file of (await readdir(path.join(root,'src'),{recursive:true})).filter(f=>f.endsWith('.js'))){const name='src/'+file;modules[name]={type:'esm',contents:await readFile(path.join(root,name),'utf8')};}
 modules['web/app/coach-tactics.js']={type:'esm',contents:await readFile(path.join(root,'web/app/coach-tactics.js'),'utf8')};modules['web/app/schedule-query.js']={type:'esm',contents:await readFile(path.join(root,'web/app/schedule-query.js'),'utf8')};
 modules['binding-test.js']={type:'esm',contents:`
 import {SourceTransport} from './src/sources/http.js';
 import {CaptureTransport} from './src/sources/tracking-capture.js';
 import {ts} from './src/sources/teamsnap.js';
 export default {async fetch(request,env){
  const input=await request.json();let transport;
  const injected=async()=>Response.json({via:'options'});
  if(input.mode==='source-binding')transport=new SourceTransport(env);
  else if(input.mode==='source-options')transport=new SourceTransport(env,{fetch:injected});
  else if(input.mode==='capture-binding')transport=new CaptureTransport(env);
  else if(input.mode==='capture-options')transport=new CaptureTransport(env,{fetch:injected});
  else if(input.mode==='capture-inherited')transport=new CaptureTransport(new SourceTransport());
  else if(input.mode==='capture')transport=new CaptureTransport({}, {timeoutMs:input.timeoutMs});
  else if(input.mode==='source-error')transport=new SourceTransport({}, {fetch:async()=>{throw new TypeError('private runtime detail: ${secret}');}});
  else transport=new SourceTransport({}, {timeoutMs:input.timeoutMs});
  try{
   const value=input.mode==='teamsnap'?await ts(transport,'me','${secret}'):(await transport.get(input.url,{...(input.mode.startsWith('capture')?{credential:'${secret}'}:{headers:{Authorization:'Bearer ${secret}'}})})).value;
   return Response.json({ok:true,value,observations:transport.observations});
  }catch(error){return Response.json({ok:false,code:error.code,status:error.status,message:error.message,observations:transport.observations});}
 }};`};
 const mock=`export default {async fetch(){return Response.json({via:'binding'});}};`;
 mf=new Miniflare({telemetry:{enabled:false},logRequests:false,workers:[{
  config:{name:'transport-test',compatibilityDate:'2026-09-09',manifest:{mainModule:'binding-test.js',modulesRoot:root,modules},env:{PROVIDER_FETCH:{type:'worker',worker:'provider'}},exports:{}},
  dev:{outboundService:{type:'fetcher',handler:async request=>{
   const url=new URL(request.url);outgoing.push({host:url.hostname,path:url.pathname,authorization:request.headers.get('authorization'),cookie:request.headers.get('cookie')});
   if(url.pathname==='/timeout'){await new Promise(r=>setTimeout(r,300));return Response.json({ok:true});}
   if(url.pathname==='/challenge')return new Response('<html>challenge</html>',{status:403,headers:{'cf-mitigated':'challenge','content-type':'text/html'}});
   if(url.pathname==='/redirect')return new Response('',{status:302,headers:{location:'https://teams.traceup.com/other-origin'}});
   if(url.pathname==='/bad-json')return new Response('not json',{headers:{'content-type':'application/json'}});
   if(url.pathname.startsWith('/status/'))return Response.json({error:'synthetic'}, {status:Number(url.pathname.split('/').at(-1)),headers:{'retry-after':'3'}});
   if(url.pathname==='/v3/me')return Response.json({collection:{items:[{data:[{name:'id',value:123},{name:'name',value:'Synthetic coach'}]}]}});
   return Response.json({via:'native-global',host:url.hostname});
  }}}
 },{config:{name:'provider',compatibilityDate:'2026-09-09',manifest:{mainModule:'provider.js',modulesRoot:root,modules:{'provider.js':{type:'esm',contents:mock}}},env:{},exports:{}}}]});
 await mf.ready;
});
test.after(async()=>{await mf?.dispose();});
async function invoke(mode,url='https://api.teamsnap.com/ok',extra={}){const result=await mf.dispatchFetch('http://localhost/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode,url,...extra})});assert.equal(result.status,200);return result.json();}

test('native global fetch reaches TeamSnap, GotSport and Trace without a provider binding',async()=>{
 for(const host of ['api.teamsnap.com','system.gotsport.com','teams.traceup.com']){const before=outgoing.length,result=await invoke('source','https://'+host+'/ok');assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.via,'native-global');assert.equal(outgoing.length,before+1);assert.equal(outgoing.at(-1).host,host);assert.equal(result.observations[0].status,200);}
});
test('TeamSnap /me uses native fetch and preserves the bearer/collection contract',async()=>{
 const before=outgoing.length,result=await invoke('teamsnap');assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.collection.items[0].data[0].value,123);assert.equal(outgoing.length,before+1);assert.equal(outgoing.at(-1).path,'/v3/me');assert.equal(outgoing.at(-1).authorization,'Bearer '+secret);assert.ok(!JSON.stringify(result).includes(secret));
});
test('standalone and inherited capture transports use native global fetch',async()=>{
 for(const mode of ['capture','capture-inherited']){const before=outgoing.length,result=await invoke(mode,'https://go.traceup.com/ok');assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.via,'native-global');assert.equal(outgoing.length,before+1);assert.equal(outgoing.at(-1).cookie,secret);}
});
test('service-binding receivers and explicit fetch override precedence stay intact',async()=>{
 for(const [mode,via]of [['source-binding','binding'],['capture-binding','binding'],['source-options','options'],['capture-options','options']]){const before=outgoing.length,result=await invoke(mode,mode.startsWith('capture')?'https://go.traceup.com/ok':'https://api.teamsnap.com/ok');assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.via,via);assert.equal(outgoing.length,before);}
});
test('source transport keeps authorization, rate-limit, challenge, redirect and format errors typed',async()=>{
 for(const [route,code]of [['status/401','authentication_required'],['status/403','source_access_denied'],['status/429','rate_limited'],['challenge','human_verification'],['redirect','source_redirect'],['bad-json','unsupported_response']]){const result=await invoke('source','https://api.teamsnap.com/'+route);assert.equal(result.ok,false);assert.equal(result.code,code,JSON.stringify(result));}
});
test('capture transport keeps authorization, rate-limit, challenge and cross-origin redirect restrictions',async()=>{
 for(const [route,code]of [['status/401','authentication_required'],['status/403','source_access_denied'],['status/429','rate_limited'],['challenge','human_verification'],['redirect','capture_redirect_origin']]){const result=await invoke('capture','https://go.traceup.com/'+route);assert.equal(result.ok,false);assert.equal(result.code,code,JSON.stringify(result));}
});
test('native aborts retain timeout classification in both transports',async()=>{
 for(const mode of ['source','capture']){const result=await invoke(mode,(mode==='source'?'https://api.teamsnap.com':'https://go.traceup.com')+'/timeout',{timeoutMs:20});assert.equal(result.ok,false);assert.equal(result.code,'collector_timeout',JSON.stringify(result));}
});
test('endpoint restrictions fail before outbound calls and observations never retain credentials',async()=>{
 for(const mode of ['source','capture']){const before=outgoing.length,result=await invoke(mode,'https://foreign.invalid/ok');assert.equal(result.ok,false);assert.equal(outgoing.length,before);}
 const result=await invoke('source','https://api.teamsnap.com/ok?access_token='+secret+'&email='+secret+'&code='+secret+'&page=2');assert.equal(result.ok,true);assert.deepEqual(result.observations[0].params,{page:'2'});assert.ok(!JSON.stringify(result).includes(secret));
 const failed=await invoke('source-error');assert.equal(failed.code,'source_network');assert.equal(failed.message,'Provider network request failed.');assert.ok(!JSON.stringify(failed).includes(secret));
});
