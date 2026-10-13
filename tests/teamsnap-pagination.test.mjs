import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSource,SourceTransport} from '../src/sources/index.js';
import {teamSnapPageRequest,teamSnapPageMetadata,reduceTeamSnapPage} from '../src/sources/teamsnap-pagination.js';
import {beginTeamSnapRefresh} from '../src/sources/teamsnap-refresh.js';
const account={id:'synthetic-account',provider:'teamsnap',native_id:'123',generation:1};
const event=(id,extra={})=>({id,team_id:321,is_game:true,name:'Game '+id,start_date:'2026-09-01T18:00:00Z',game_type_code:1,game_type:'home',...extra});
const attendance=id=>({id,team_id:321,event_id:4000+Math.floor(id/11),member_id:100+id%11,status_code:id%3});
const col=(rows,info,links=[])=>({collection:{items:rows.map(r=>({data:Object.entries(r).map(([name,value])=>({name,value}))})),links,...(info?{page_info:info}:{})}});
function harness(kind,initial,{change,extraMetadata=0}={}){
 let rows=initial,requests=[],returns=[];
 const fetch=async endpoint=>{const u=new URL(endpoint),number=Number(u.searchParams.get('page_number')),size=Number(u.searchParams.get('page_size'));requests.push({number,size,url:u.href});if(change)rows=change(rows,{number,size,requests})||rows;
  const page=rows.slice((number-1)*size,number*size).map(r=>({...r,...(extraMetadata?{ignored:'x'.repeat(extraMetadata)}:{})}));
  const next=new URL(u);next.searchParams.set('page_number',String(number+1));const value=col(page,{page_number:number,page_size:size,total_items:rows.length},number*size<rows.length?[{rel:'next',href:next.href}]:[]),body=JSON.stringify(value);returns.push(new TextEncoder().encode(body).length);return Response.json(value);};
 return {requests,returns,async step(cursor={}){return collectSource({provider:'teamsnap',kind,scope:'teamsnap:321',args:{team_id:'321'},cursor,transport:new SourceTransport({}, {fetch}),credential:'synthetic',account,scanId:'synthetic-scan'});}};
}
async function drain(h,{cursor={},onPage,limit=1500}={}){const saved=new Map();let pages=0,result;for(;pages<limit;pages++){result=await h.step(cursor);const records=result.fixtures.length?result.fixtures:result.records.attendance||[];for(const r of records)saved.set(r.native_id||r.fixture_id+'|'+r.player_id,r);if(onPage)await onPage(result,{saved,pages,cursor});if(result.complete)return {saved,pages:pages+1,result};cursor=result.checkpoint;}throw new Error('Continuation did not settle');}

test('paged events and attendance retain every row, verify two traversals and report total coverage',async()=>{
 for(const kind of ['events','attendance']){const expected=kind==='events'?67:267,rows=Array.from({length:expected},(_,i)=>kind==='events'?event(4000+i):attendance(5000+i)),h=harness(kind,rows);let firstFinalSaved=false;
 const r=await drain(h,{onPage:(page,{saved})=>{if(!page.complete&&saved.size===expected)firstFinalSaved=true;}});
 assert.equal(r.saved.size,expected);assert.equal(firstFinalSaved,true);assert.deepEqual(h.requests.map(x=>x.number),[1,2,3,1,2,3]);assert.equal(r.result.sourceCoverage[0].count,expected);assert.equal(r.result.coverage,'complete');}
});

test('oversized total histories are fetched as bounded pages; byte prefixes resume without truncating Unicode notes',async()=>{
 const rows=Array.from({length:101},(_,i)=>event(4000+i,{notes:'雪'.repeat(7900),ignored:'x'.repeat(10000)}));assert.ok(new TextEncoder().encode(JSON.stringify(col(rows))).length>2_000_000);
 const h=harness('events',rows),r=await drain(h);assert.equal(r.saved.size,101);assert.ok(h.requests.length>10,'local byte windows cause resumable re-reads of the same provider page');assert.ok(h.returns.every(n=>n<2_000_000));for(const row of r.saved.values())assert.equal(JSON.parse(row.payload).notes,'雪'.repeat(7900));
});

test('provider page above transport bound reduces persisted page size, restarts and never raises the cap',async()=>{
 const h=harness('events',Array.from({length:27},(_,i)=>event(4000+i)),{extraMetadata:100000});const r=await drain(h);assert.equal(h.requests[0].size,25);assert.equal(h.requests[1].size,12);assert.equal(r.saved.size,27);assert.ok(h.requests.slice(1).every(x=>x.size===12));
 const bad=harness('events',[event(1)],{extraMetadata:2100000});let cursor={};for(let i=0;i<4;i++){const page=await bad.step(cursor);assert.equal(page.complete,false);cursor=page.checkpoint;}await assert.rejects(()=>bad.step(cursor),e=>e.code==='record_too_large');assert.deepEqual(bad.requests.map(x=>x.size),[25,12,6,3,1]);
});

test('old offsets restart safely, changed local page restarts at zero, and lost replies are idempotent',async()=>{
 const rows=Array.from({length:30},(_,i)=>event(4000+i,{notes:'雪'.repeat(7900)})),h=harness('events',rows);const first=await h.step({url:'https://api.teamsnap.com/v3/events/search?team_id=321',offset:150,digest:'old'});assert.equal(h.requests[0].number,1);assert.ok(first.checkpoint.offset>0);
 const repeated=await h.step({});assert.deepEqual(first.fixtures.map(x=>x.id),repeated.fixtures.map(x=>x.id));
 rows[0]=event(9000,{notes:'雪'.repeat(7900)});const changed=await h.step(first.checkpoint);assert.equal(changed.fixtures[0].native_id,'9000');assert.equal(changed.checkpoint.offset,first.checkpoint.offset);
 const r=await drain(h,{cursor:changed.checkpoint});assert.ok(r.saved.has('9000'),'verification re-observes the changed first row');
});

test('same-count internal reorder and a decreasing total force another full stable traversal',async()=>{
 let pass=0,moved=false;const rows=Array.from({length:76},(_,i)=>event(4000+i));const h=harness('events',rows,{change:(list,{number})=>{if(number===1)pass++;if(pass===2&&number===2&&!moved){moved=true;[list[30],list[60]]=[list[60],list[30]];}return list;}});
 const result=await drain(h);assert.equal(result.saved.size,76);assert.equal(pass,3,'changed traversal requires a subsequent matching complete pass');
 let removed=false;const shrinking=harness('events',Array.from({length:51},(_,i)=>event(6000+i)),{change:(list,{number})=>{if(number===2&&!removed){removed=true;return list.slice(0,50);}return list;}});const r=await drain(shrinking);assert.equal(r.result.sourceCoverage[0].count,50);assert.ok(shrinking.requests.filter(x=>x.number===1).length>=3);
});

test('saved25 scans retain more than200 pages while new100 scans reduce calls without a history cutoff',async()=>{
 const prepared=await beginTeamSnapRefresh({kind:'attendance',teamId:'321',accountId:account.id,authorizationGeneration:account.generation,endpoint:'https://api.teamsnap.com/v3/availabilities/search?team_id=321',args:{team_id:'321'}});
 const fresh=teamSnapPageRequest('attendance','321',prepared.endpoint),legacy={...reduceTeamSnapPage(reduceTeamSnapPage(fresh)),refresh:prepared.refresh};
 for(const cursor of [legacy,{}]){const h=harness('attendance',Array.from({length:5001},(_,i)=>attendance(10000+i)));let largest=0;const r=await drain(h,{cursor,onPage:p=>{largest=Math.max(largest,new TextEncoder().encode(JSON.stringify(p.checkpoint)).length);}});assert.equal(r.saved.size,5001);assert.equal(h.requests.length,cursor===legacy?402:102);assert.ok(h.requests.every(r=>r.size===(cursor===legacy?25:100)));assert.ok(largest<8192);}
});

test('next links cannot alter endpoint, team, filters, credentials, page size or page number',()=>{
 const state=teamSnapPageRequest('events','321','https://api.teamsnap.com/v3/events/search?team_id=321');const valid=new URL(state.url);valid.searchParams.set('page_number','2');
 for(const mutate of [u=>u.hostname='evil.invalid',u=>u.pathname='/v3/availabilities/search',u=>u.searchParams.set('team_id','322'),u=>u.searchParams.set('started_after','2026-01-01'),u=>u.searchParams.set('access_token','secret'),u=>u.searchParams.set('page_size','50'),u=>u.searchParams.set('page_number','1'),u=>u.username='bad',u=>u.searchParams.append('page_number','999')]){const u=new URL(valid);mutate(u);assert.throws(()=>teamSnapPageMetadata(col([],null,[{rel:'next',href:u.href}]),state,25),e=>e.code==='contract_violation');}
 assert.throws(()=>teamSnapPageMetadata(col([],null),state,25),e=>e.code==='unsupported_response');assert.throws(()=>teamSnapPageMetadata(col([],{page_number:1,page_size:25,total_items:26}),state,24),e=>e.code==='unsupported_response');
});


test('continually changing local slices pause durably instead of spinning or declaring completion',async()=>{
 let revision=0;const h=harness('events',Array.from({length:25},(_,i)=>event(4000+i,{notes:'雪'.repeat(7900)})),{change:rows=>{rows[0].name='Revision '+revision++;return rows;}});let cursor={};for(let i=0;i<4;i++){const page=await h.step(cursor);assert.equal(page.complete,false);cursor=page.checkpoint;}assert.ok(cursor.retry_at>Date.now());const count=h.requests.length;await assert.rejects(()=>h.step(cursor),e=>e.code==='source_changing'&&e.retryAfterMs>0);assert.equal(h.requests.length,count);
});


test('repeated adjacent/nonadjacent pages and native-ID overlap cannot certify inflated completeness',async()=>{
 const first=Array.from({length:25},(_,i)=>event(4000+i)),second=Array.from({length:25},(_,i)=>event(5000+i));
 for(const rows of [[...first,...first],[...first,...second,...first],[...first,...Array.from({length:25},(_,i)=>event(4020+i))]]){
  const h=harness('events',rows);let cursor={},complete=false,accepted=0;for(let i=0;i<15;i++){let p;try{p=await h.step(cursor);}catch(e){assert.equal(e.code,'source_changing');break;}complete ||= p.complete;accepted+=p.fixtures.length;cursor=p.checkpoint;}
  assert.equal(complete,false);assert.ok(cursor.retry_at>Date.now());assert.ok(h.requests.length<=9,'three unstable passes then a delayed retry');assert.ok(accepted<rows.length*3);
 }
});
