import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSource,SourceTransport} from '../src/sources/index.js';
import {teamSnapPageRequest,teamSnapPageMetadata,advanceTeamSnapPage,reduceTeamSnapPage} from '../src/sources/teamsnap-pagination.js';
import {beginTeamSnapRefresh,finishTeamSnapRefresh} from '../src/sources/teamsnap-refresh.js';
const ENDPOINT='https://api.teamsnap.com/v3/availabilities/search?team_id=999999999999999';
const TEAM='999999999999999',NOW=Date.now(),H='f'.repeat(64),ACCOUNT='a'.repeat(36);
const sizeOf=value=>Buffer.byteLength(JSON.stringify(value));
const pairs=n=>Array.from({length:n},(_,i)=>String(800000000000000+i)+':'+String(700000000000000+i));
const row=i=>({id:`opaque-${i}`,team_id:TEAM,event_id:String(800000000000000+i),member_id:String(700000000000000+i),status_code:i%3});
const collection=(rows,size,number,total,next=null)=>({collection:{items:rows.map(r=>({data:Object.entries(r).map(([name,value])=>({name,value}))})),page_info:{page_size:size,page_number:number,total_items:total},links:next?[{rel:'next',href:next}]:[]}});
async function refreshFixture({account=ACCOUNT,url=ENDPOINT,args={url},now=NOW}={}) {
 const options={kind:'attendance',teamId:TEAM,accountId:account,authorizationGeneration:1,endpoint:url,args,now};
 let prepared=await beginTeamSnapRefresh(options);
 const full=finishTeamSnapRefresh(prepared.refresh,{count:10000,pages:100,digest:H,total:10000,now});
 prepared=await beginTeamSnapRefresh({...options,cursor:full,now:now+60000});
 const recent=finishTeamSnapRefresh(prepared.refresh,{count:1000,pages:10,digest:H,total:1000,now:now+60000});
 return {options,prepared:await beginTeamSnapRefresh({...options,cursor:recent,now:now+120000})};
}
function worstCursor(state,refresh) {
 const max=Number.MAX_SAFE_INTEGER,url=new URL(state.base);url.searchParams.set('page_number',String(max));url.searchParams.sort();
 return {...state,url:url.href,refresh,offset:state.size,digest:H,total:max,rolling:H,previous:{digest:H,pages:max,count:max,total:max},pages:max,count:max,pass:3,page_changes:2,retry_at:max,previous_ids:Array(state.size).fill('999999999999999:999999999999999'),page_hashes:Array(8).fill(H)};
}

test('new attendance requests100 while events retain25 and a valid active25 cursor is unchanged',async()=>{
 const {prepared}=await refreshFixture();
 const fresh=teamSnapPageRequest('attendance',TEAM,prepared.endpoint,{}, {refresh:prepared.refresh});assert.equal(fresh.size,100);
 const old=reduceTeamSnapPage(reduceTeamSnapPage(fresh)),cp={...old,url:old.base.replace('page_number=1','page_number=2'),offset:7,digest:H,total:5455,rolling:H,previous:{digest:H,pages:219,count:5455,total:5455},pages:1,count:25,pass:2,previous_ids:pairs(25),page_hashes:[H],refresh:prepared.refresh};
 assert.equal(cp.size,25);assert.deepEqual(teamSnapPageRequest('attendance',TEAM,prepared.endpoint,cp,{refresh:prepared.refresh}),cp);
 assert.equal(teamSnapPageRequest('events',TEAM,'https://api.teamsnap.com/v3/events/search?team_id='+TEAM).size,25);
});

test('full bound checkpoints fit8192 with max native IDs, receipts, window, escaping and account metadata',async()=>{
 const url=ENDPOINT+'&unused='+'x'.repeat(2048-ENDPOINT.length-8);
 for(const account of [ACCOUNT,'雪'.repeat(240),'\\'.repeat(240)]) {
  const {prepared}=await refreshFixture({account,url}),state=teamSnapPageRequest('attendance',TEAM,prepared.endpoint,{}, {refresh:prepared.refresh});
  const checkpoint=worstCursor(state,prepared.refresh);assert.ok(sizeOf(checkpoint)<=8192,`${account.length}: ${sizeOf(checkpoint)}`);
  assert.ok([100,50,25,12,6,3,1].includes(state.size));assert.deepEqual(checkpoint.refresh,prepared.refresh);
  if(account!==ACCOUNT)assert.ok(state.size<100);
 }
 const base=await refreshFixture(),state=teamSnapPageRequest('attendance',TEAM,base.prepared.endpoint);
 const overhead=sizeOf(worstCursor(state,base.prepared.refresh)),extra=8192-overhead;
 const at={...base.prepared.refresh,binding:{...base.prepared.refresh.binding,account_id:ACCOUNT+'x'.repeat(extra)}};
 assert.equal(sizeOf(worstCursor(state,at)),8192);assert.equal(teamSnapPageRequest('attendance',TEAM,base.prepared.endpoint,{}, {refresh:at}).size,100);
 const over={...at,binding:{...at.binding,account_id:at.binding.account_id+'x'}};
 assert.equal(sizeOf(worstCursor(state,over)),8193);assert.equal(teamSnapPageRequest('attendance',TEAM,base.prepared.endpoint,{}, {refresh:over}).size,50);
});

test('valid server page cap restarts without saving differently partitioned rows or reusing proof',async()=>{
 const state=teamSnapPageRequest('attendance',TEAM,ENDPOINT),next=new URL(state.base);next.searchParams.set('page_size','50');next.searchParams.set('page_number','2');
 const metadata=teamSnapPageMetadata(collection(Array.from({length:50},(_,i)=>row(i)),50,1,200,next.href),state,50);
 assert.deepEqual(metadata,{reducedSize:50});const reduced=reduceTeamSnapPage({...state,previous:{digest:H,count:200,pages:2,total:200}},metadata.reducedSize);
 assert.equal(reduced.size,50);assert.equal(reduced.pages,0);assert.equal(reduced.offset,0);assert.equal(reduced.previous,null);assert.equal(reduced.pass,1);assert.equal(new URL(reduced.url).searchParams.get('page_number'),'1');
 const odd=teamSnapPageMetadata(collection([],37,1,0),state,0);assert.equal(reduceTeamSnapPage(state,odd.reducedSize).size,25);
});

test('cap metadata and continuations cannot change scope, filters, sequence or terminal evidence',()=>{
 const state=teamSnapPageRequest('attendance',TEAM,ENDPOINT),next=new URL(state.base);next.searchParams.set('page_size','50');next.searchParams.set('page_number','2');
 for(const mutate of [u=>u.searchParams.set('team_id','1'),u=>u.pathname='/v3/events/search',u=>u.searchParams.set('started_after','2026-01-01'),u=>u.searchParams.set('page_size','25'),u=>u.searchParams.append('page_size','50'),u=>u.searchParams.set('page_number','3'),u=>u.username='bad']){
  const u=new URL(next);mutate(u);assert.throws(()=>teamSnapPageMetadata(collection([],50,1,200,u.href),state,50),e=>e.code==='contract_violation');
 }
 for(const [size,number,total,count]of [[0,1,200,0],[101,1,200,100],[50,2,200,50],[50,1,200,49],[50,1,-1,0]])assert.throws(()=>teamSnapPageMetadata(collection([],size,number,total),state,count),e=>e.code==='unsupported_response');
 const old=reduceTeamSnapPage(reduceTeamSnapPage(state));assert.throws(()=>teamSnapPageMetadata(collection([],12,1,100),old,12),e=>e.code==='unsupported_response','old25 contract is not broadened');
});

function collectorFixture({status=200,cap=null,rows=Array.from({length:200},(_,i)=>row(i))}={}){
 const calls=[],account={id:ACCOUNT,provider:'teamsnap',native_id:TEAM,generation:1};
 const fetch=async endpoint=>{const u=new URL(endpoint),size=Number(u.searchParams.get('page_size')),number=Number(u.searchParams.get('page_number'));calls.push({size,number,url:u.href});const code=typeof status==='function'?status({size,number,calls}):status;if(code!==200)return new Response('{}',{status:code,headers:{'content-type':'application/json'}});const actual=cap?Math.min(cap,size):size,next=new URL(u);next.searchParams.set('page_size',String(actual));next.searchParams.set('page_number',String(number+1));return Response.json(collection(rows.slice((number-1)*actual,number*actual),actual,number,rows.length,number*actual<rows.length?next.href:null));};
 return {calls,step:cursor=>collectSource({provider:'teamsnap',kind:'attendance',scope:'teamsnap:'+TEAM,args:{team_id:TEAM},cursor:cursor??{},transport:new SourceTransport({}, {fetch}),credential:'synthetic',account,scanId:'synthetic-scan'})};
}

test('one exact first-page HTTP400 retries25 without saving and retains the bound refresh window',async()=>{
 const f=collectorFixture({status:({size})=>size>25?400:200});const first=await f.step();assert.equal(first.complete,false);assert.equal(first.records.attendance?.length??0,0);assert.equal(first.checkpoint.size,25);assert.equal(first.checkpoint.count,0);const refresh=first.checkpoint.refresh;
 let cursor=first.checkpoint,last,total=0;for(let i=0;i<20;i++){last=await f.step(cursor);total+=last.records.attendance?.length??0;if(last.complete)break;assert.deepEqual(last.checkpoint.refresh,refresh);cursor=last.checkpoint;}
 assert.equal(last.complete,true);assert.equal(total,400);assert.deepEqual(f.calls.map(x=>x.size),[100,...Array(16).fill(25)]);assert.equal(last.sourceCoverage[0].count,200);
 const bad=collectorFixture({status:400}),fallback=await bad.step();await assert.rejects(()=>bad.step(fallback.checkpoint),e=>e.code==='source_http');assert.deepEqual(bad.calls.map(x=>x.size),[100,25]);
});

test('fallback never masks authentication/rate/server/malformed data failures or later/verification400s',async()=>{
 for(const [status,code]of [[401,'authentication_required'],[403,'source_access_denied'],[429,'rate_limited'],[500,'source_http']]){const f=collectorFixture({status});await assert.rejects(()=>f.step(),e=>e.code===code);assert.equal(f.calls.length,1);}
 const later=collectorFixture({status:({number})=>number===2?400:200}),first=await later.step();assert.equal(first.checkpoint.pages,1);await assert.rejects(()=>later.step(first.checkpoint),e=>e.code==='source_http');
 const verify=collectorFixture({rows:Array.from({length:100},(_,i)=>row(i)),status:({calls})=>calls.length>1?400:200}),pass1=await verify.step();assert.equal(pass1.checkpoint.pass,2);assert.ok(pass1.checkpoint.previous);await assert.rejects(()=>verify.step(pass1.checkpoint),e=>e.code==='source_http');
});

test('collector validates explicit cap, re-requests page one and finishes matching smaller traversals',async()=>{
 const f=collectorFixture({cap:40});let result=await f.step(),count=0;assert.equal(result.records.attendance?.length??0,0);assert.equal(result.checkpoint.size,25);
 for(let i=0;i<20&&!result.complete;i++){result=await f.step(result.checkpoint);count+=result.records.attendance?.length??0;}
 assert.equal(result.complete,true);assert.equal(count,400);assert.equal(result.sourceCoverage[0].count,200);assert.deepEqual(f.calls.map(x=>x.size),[100,...Array(16).fill(25)]);
 const state=teamSnapPageRequest('attendance',TEAM,ENDPOINT),smaller=reduceTeamSnapPage(state,40),reduced=reduceTeamSnapPage(smaller);assert.equal(smaller.size,25);assert.equal(reduced.size,12);assert.equal(teamSnapPageRequest('attendance',TEAM,ENDPOINT,reduced).size,12);
});

test('unproved preferred-size metadata falls back only before first save and never conceals unsafe links',()=>{
 const state=teamSnapPageRequest('attendance',TEAM,ENDPOINT),noInfo={collection:{items:[],links:[]}};
 assert.deepEqual(teamSnapPageMetadata(noInfo,state,25),{reducedSize:25});
 const valid=new URL(state.base);valid.searchParams.set('page_number','2');
 assert.deepEqual(teamSnapPageMetadata({collection:{links:[{rel:'next',href:valid.href}]}},state,25),{reducedSize:25});
 for(const mutate of [u=>u.searchParams.set('team_id','1'),u=>u.searchParams.set('page_size','25'),u=>u.searchParams.append('page_number','999'),u=>u.hostname='foreign.invalid']){const next=new URL(valid);mutate(next);assert.throws(()=>teamSnapPageMetadata({collection:{links:[{rel:'next',href:next.href}]}},state,25),e=>e.code==='contract_violation');}
 assert.throws(()=>teamSnapPageMetadata({collection:{links:[{rel:'next',href:valid.href},{rel:'next',href:valid.href}]}},state,25),e=>e.code==='unsupported_response');
 for(const change of [{pages:1,count:100},{pass:2,previous:{digest:H,pages:1,count:25,total:25}},{offset:1,digest:H}])assert.throws(()=>teamSnapPageMetadata(noInfo,{...state,...change},25),e=>e.code==='unsupported_response');
 const old=reduceTeamSnapPage(reduceTeamSnapPage(state));assert.equal(teamSnapPageMetadata(noInfo,old,10).terminal,true,'old25 short terminal proof remains compatible');
});

test('HTTP400 compatibility retry requires one newly appended observation for this exact request',async()=>{
 for(const mode of ['absent','old','extra','endpoint','params','code']){
  const observations=[],error=Object.assign(new Error('synthetic'),{code:'source_http'});
  if(mode==='old')observations.push({status:400,code:'source_http'});
  const transport={observations,async get(endpoint){const url=new URL(endpoint),o={status:400,code:'source_http',endpoint:url.origin+url.pathname,params:Object.fromEntries(url.searchParams)};
   if(mode==='endpoint')o.endpoint='https://api.teamsnap.com/v3/events/search';if(mode==='params')o.params.team_id='1';if(mode==='code')o.code='other';
   if(!['absent','old'].includes(mode))observations.push(o);if(mode==='extra')observations.push(o);throw error;
  }};
  await assert.rejects(()=>collectSource({provider:'teamsnap',kind:'attendance',scope:'teamsnap:'+TEAM,args:{team_id:TEAM},transport,credential:'synthetic',account:{id:ACCOUNT,provider:'teamsnap',native_id:TEAM,generation:1},scanId:'synthetic'}),e=>e===error);
 }
});
