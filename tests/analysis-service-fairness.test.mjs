import test from 'node:test';
import assert from 'node:assert/strict';
import {JobCoordinator,ORDINARY_SERVICE_CYCLE} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {collectApplicationJob} from '../src/application/sync-service.js';
import {ReportingService} from '../src/reporting/service.js';
import {progressiveFixture as fixture,AT} from './fixtures/progressive-root-service-fixture.mjs';

// Real coordinator SQL, durable runtime and published source fixture. Pressure
// collectors intentionally stay nonterminal to isolate service fairness; the
// saved-match checks below invoke the actual application analysis collector.
const derived={component:'tracking',stage:'analysis',scope:'trace:20:trace:10:g0:1',resourceKey:'trace:20:trace:10:g0:1',args:{game_id:'20',team_id:'10',gid:'g0',half:1},priority:20};
const match={provider:'analysis',component:'match',stage:'analysis',scope:'team',resourceKey:'season:event',args:{teamId:'team',seasonId:'season',eventId:'event'},priority:20};
const publication={provider:'domain',component:'projection',stage:'projection',scope:'team',resourceKey:'season',args:{teamId:'team',seasonId:'season'},priority:100};
const catalog={provider:'analysis',component:'catalog',stage:'analysis',scope:'team',resourceKey:'season',args:{teamId:'team',seasonId:'season'},priority:75};
async function queue(f,{reports=true,priority=20,phase='cleanup'}={}){
 const ids={root:await f.root(),publication:await f.enqueue(publication),catalog:await f.enqueue(catalog),match:await f.enqueue({...match,priority}),derived:await f.enqueue(derived),bulk:await f.enqueue({resourceKey:'bulk'})};
 f.sqlite.prepare('UPDATE sync_jobs SET checkpoint=? WHERE id=?').run(JSON.stringify({phase,runId:'team-run',legacyCursor:'keep'}),ids.publication);
 if(reports){
  const service=new ReportingService(f.db,{coordinator:f.jobs,now:()=>AT,captureAtAdmission:false,queryBuilders:{matches:()=>({sql:"SELECT id,'2026-09-01' AS date,'Game' AS type,'Final' AS status,'Them' AS opponent,venue AS location,'Saved' AS source,'' AS competition,'2-1' AS score,'Win' AS result,NULL AS attendance FROM source_events ORDER BY id",params:[]})}});
  const created=await service.create({team_id:'team',team_season_id:'season'},{type:'matches'});
  ids.report=f.one("SELECT id FROM sync_jobs WHERE provider='reports' AND component='capture' AND resource_key=?",created.data.snapshot_id).id;
 }
 return ids;
}
const classify=(ids,id)=>Object.entries(ids).find(([,value])=>value===id)?.[0];
const counts=items=>Object.fromEntries([...new Set(items)].sort().map(item=>[item,items.filter(value=>value===item).length]));
const runtimeOptions={dependencyFairness:true,reportFairness:true,publicHistory:true,clock:()=>AT,pageDelayMs:0,statementLimit:50};
async function run(f,Runtime){await new Runtime(f.ctx,{DB:f.db}).run();const result=f.values.get('last_run');assert.ok(!['idle','error','failed','blocked','retrying','lease_lost'].includes(result.state),JSON.stringify(result));assert.ok(result.statements<=50);return result;}

test('seven positions preserve every ordinary class under either alternating Reports parity',()=>{
 assert.deepEqual(ORDINARY_SERVICE_CYCLE,[0,1,5,3,4,2,2]);assert.ok(Object.isFrozen(ORDINARY_SERVICE_CYCLE));
 for(let start=0;start<7;start++)for(const reportParity of [0,1]){
  const ordinary=Array.from({length:14},(_,i)=>i).filter(i=>i%2!==reportParity).map(i=>ORDINARY_SERVICE_CYCLE[(start+i)%7]);
  assert.deepEqual(counts(ordinary),{'0':1,'1':1,'2':2,'3':1,'4':1,'5':1});
 }
});

for(const phase of ['events','cleanup','catch-up'])for(const reportStart of [true,false])test(`fixed-clock ${phase} pressure and continuous Reports ${reportStart} serve all classes on every restart`,async t=>{
 const f=fixture(t),ids=await queue(f,{phase}),seen=[];f.values.set('report_service_turn',reportStart);
 const before=f.rows('SELECT id,priority FROM sync_jobs ORDER BY id'),published=f.one('SELECT published_run_id FROM team_projection_state').published_run_id;
 const Runtime=createSyncRuntime(async({lease,checkpoint})=>{seen.push(classify(ids,lease.id));return {statements:[],checkpoint:{...checkpoint,pages:(checkpoint.pages||0)+1},complete:false};},runtimeOptions);
 for(let i=0;i<28;i++)await run(f,Runtime);
 for(let start=0;start<=14;start++)assert.deepEqual(counts(seen.slice(start,start+14)),{bulk:2,catalog:1,derived:1,match:1,publication:1,report:7,root:1});
 assert.deepEqual(f.rows('SELECT id,priority FROM sync_jobs ORDER BY id'),before,'service never rewrites stored priorities');
 assert.equal(f.one('SELECT published_run_id FROM team_projection_state').published_run_id,published);
 assert.equal(JSON.parse(f.one('SELECT checkpoint FROM sync_jobs WHERE id=?',ids.publication).checkpoint).legacyCursor,'keep');
 assert.ok(f.rows('SELECT attempts FROM sync_jobs').every(row=>row.attempts>0));
});

for(const priority of [20,70])test(`real saved-match priority ${priority} publishes while cleanup, catalog, root, derived, bulk and Reports remain queued`,async t=>{
 const f=fixture(t),ids=await queue(f,{priority}),seen=[];
 const Runtime=createSyncRuntime(async context=>{seen.push(classify(ids,context.lease.id));return context.lease.id===ids.match?collectApplicationJob(context):{statements:[],checkpoint:{...context.checkpoint,pages:(context.checkpoint.pages||0)+1},complete:false};},runtimeOptions);
 for(let i=0;i<14&&!f.one("SELECT event_id FROM match_analysis WHERE event_id='event'");i++)await run(f,Runtime);
 const analysis=f.one("SELECT * FROM match_analysis WHERE event_id='event'");assert.ok(analysis,'saved output publishes within fourteen claim opportunities');assert.ok(analysis.player_count>0);
 assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',ids.match).state,'ready');
 for(const [kind,id]of Object.entries(ids))if(kind!=='match')assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',id).state,'queued',kind);
 assert.equal(f.one('SELECT priority FROM sync_jobs WHERE id=?',ids.match).priority,priority);
 assert.equal(f.one('SELECT published_run_id FROM team_projection_state').published_run_id,'team-run');
 assert.ok(seen.includes('publication')&&seen.includes('report'));
});

test('finite priority-70 match queue and priority-97 bulk queue both drain before their older priority-20 work',async t=>{
 const f=fixture(t),ids=await queue(f),highMatch=await f.enqueue({...match,resourceKey:'season:recent',priority:70}),oldBulk=await f.enqueue({component:'analytics',stage:'analysis',scope:'trace:old:trace:10:team:home:full',resourceKey:'trace:old:trace:10:team:home:full',args:{game_id:'old',team_id:'10'},priority:20}),seen=[];
 const finite=new Set([highMatch,ids.match,ids.bulk,oldBulk]);
 const Runtime=createSyncRuntime(async({lease,checkpoint})=>{seen.push(lease.id);const pages=(checkpoint.pages||0)+1;return {statements:[],checkpoint:{...checkpoint,pages},complete:finite.has(lease.id)&&(lease.id===highMatch||lease.id===ids.bulk?pages===3:true)};},runtimeOptions);
 for(let i=0;i<70&&[ids.match,oldBulk].some(id=>f.one('SELECT state FROM sync_jobs WHERE id=?',id).state!=='ready');i++)await run(f,Runtime);
 for(const id of finite)assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',id).state,'ready');
 assert.ok(seen.indexOf(ids.match)>seen.lastIndexOf(highMatch));assert.ok(seen.indexOf(oldBulk)>seen.lastIndexOf(ids.bulk));
 for(const kind of ['root','publication','catalog','derived','report'])assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',ids[kind]).state,'queued');
});

for(const kind of ['root','publication','catalog','match','derived','bulk','report'])test(`missing preferences never idle a ${kind}-only queue`,async t=>{
 const f=fixture(t),ids=await queue(f);f.sqlite.prepare('DELETE FROM sync_jobs WHERE id<>?').run(ids[kind]);let collected=0;
 const Runtime=createSyncRuntime(async()=>{collected++;return {statements:[],complete:false};},runtimeOptions);for(let i=0;i<14;i++)await run(f,Runtime);assert.equal(collected,14);
});

for(const saved of [0,1,2,3,4,5,6,-1,7,1.5,'3',null])test(`persisted ordinary position ${JSON.stringify(saved)} resumes or safely resets`,async t=>{
 const f=fixture(t),ids=await queue(f,{reports:false});f.values.set('ordinary_service_turn',saved);
 const turn=Number.isInteger(saved)&&saved>=0&&saved<7?saved:0,expected={0:'root',1:'publication',2:'bulk',3:'match',4:'derived',5:'catalog'}[ORDINARY_SERVICE_CYCLE[turn]];
 const Runtime=createSyncRuntime(async({lease})=>{assert.equal(lease.id,ids[expected]);return {statements:[],complete:false};},runtimeOptions);
 await run(f,Runtime);assert.equal(f.values.get('ordinary_service_turn'),(turn+1)%7);
});

test('lost preclaim turn reply keeps recovery armed and every class live after restart',async t=>{
 const f=fixture(t),ids=await queue(f),seen=[];f.values.set('ordinary_service_turn',3);
 const put=f.ctx.storage.put;let lost=false;f.ctx.storage.put=async(k,v)=>{await put(k,v);if(k==='ordinary_service_turn'&&!lost){lost=true;throw new Error('lost saved turn reply');}};
 const Runtime=createSyncRuntime(async({lease,checkpoint})=>{seen.push(classify(ids,lease.id));return {statements:[],checkpoint:{...checkpoint,pages:(checkpoint.pages||0)+1},complete:false};},runtimeOptions);
 await new Runtime(f.ctx,{DB:f.db}).run();assert.equal(f.values.get('last_run').state,'error');assert.equal(f.values.get('ordinary_service_turn'),4);assert.ok(f.values.get('alarm'));assert.equal(seen.length,0);
 for(let i=0;i<14;i++)await run(f,Runtime);
 assert.deepEqual(counts(seen),{bulk:2,catalog:1,derived:1,match:1,publication:1,report:7,root:1});
});

for(const [name,sql,params]of [
 ['future due','UPDATE sync_jobs SET next_at=? WHERE id=?',[AT+1]],
 ['live lease',"UPDATE sync_jobs SET state='running',lease_until=? WHERE id=?",[AT+1]],
 ['blocked',"UPDATE sync_jobs SET state='blocked' WHERE id=?",[]],
 ['completed nonrecurring',"UPDATE sync_jobs SET state='ready' WHERE id=?",[]],
 ['revoked root',"UPDATE team_source_connections SET active=0",null],
 ['stale subscriber generation',"UPDATE team_source_connections SET generation=2",null],
 ['deleted lifecycle',"INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES('team','deleting','now')",null],
])test(`match preference cannot bypass ${name}`,async t=>{
 const f=fixture(t),id=await f.enqueue(match);f.sqlite.prepare(sql).run(...(params===null?[]:[...params,id]));
 assert.equal(await new JobCoordinator(f.db,{clock:()=>AT,publicHistory:true,ordinaryTurn:3}).claim(),null);assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',id).attempts,0);
});

for(const field of ['generation','active'])test(`preferred current-derived claim cannot commit after account ${field} changes`,async t=>{
 const f=fixture(t),id=await f.enqueue(derived),jobs=new JobCoordinator(f.db,{clock:()=>AT,publicHistory:true,ordinaryTurn:4}),lease=await jobs.claim();assert.equal(lease.id,id);
 f.sqlite.exec(`UPDATE provider_accounts SET ${field}=${field==='generation'?'generation+1':'0'}`);
 assert.equal((await jobs.commit(lease,{statements:[],complete:true})).committed,false);assert.equal(f.one('SELECT pages_saved FROM sync_jobs WHERE id=?',id).pages_saved,0);
});

test('current-derived preference is evaluated from stored native source dates at each claim clock',async t=>{
 const f=fixture(t),id=await f.enqueue(derived),busy=await f.enqueue();
 // The saved native fixture starts 42 days before AT. It is current now, but
 // no longer current 20 days later; a job argument cannot retain preference.
 let lease=await new JobCoordinator(f.db,{clock:()=>AT,ordinaryTurn:4}).claim();assert.equal(lease.id,id);
 f.sqlite.prepare("UPDATE sync_jobs SET state='queued',lease_until=0,lease_token=NULL WHERE id=?").run(id);
 lease=await new JobCoordinator(f.db,{clock:()=>AT+20*86400000,ordinaryTurn:4}).claim();assert.equal(lease.id,busy);assert.equal(f.one('SELECT priority FROM sync_jobs WHERE id=?',id).priority,20);
});

for(const mutation of ['active=0','generation=generation+1'])test(`preferred saved match cannot commit after root ${mutation}`,async t=>{
 const f=fixture(t),id=await f.enqueue(match),jobs=new JobCoordinator(f.db,{clock:()=>AT,publicHistory:true,ordinaryTurn:3}),lease=await jobs.claim();assert.equal(lease.id,id);
 const page=await collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});f.sqlite.exec('UPDATE team_source_connections SET '+mutation);
 assert.equal((await jobs.commit(lease,page)).committed,false);assert.equal(f.one('SELECT pages_saved FROM sync_jobs WHERE id=?',id).pages_saved,0);assert.equal(f.one('SELECT COUNT(*) n FROM match_analysis').n,0);
});

test('a preferred saved match retains its old cursor across a crashed claim and lease recovery',async t=>{
 const f=fixture(t),id=await f.enqueue(match),checkpoint={phase:'saved-page',after:'old-cursor',pages:2};f.sqlite.prepare('UPDATE sync_jobs SET checkpoint=? WHERE id=?').run(JSON.stringify(checkpoint),id);
 const jobs=new JobCoordinator(f.db,{clock:()=>AT,ordinaryTurn:3}),lease=await jobs.claim();assert.deepEqual(lease.checkpoint,checkpoint);
 f.values.set('ordinary_service_turn',4);let seen=0;
 const Runtime=createSyncRuntime(async context=>{seen++;assert.equal(context.lease.id,id);assert.deepEqual(context.checkpoint,checkpoint);return {statements:[],checkpoint:{...context.checkpoint,pages:3},complete:false};},{...runtimeOptions,clock:()=>Date.now()});
 await new Runtime(f.ctx,{DB:f.db}).run();assert.equal(f.values.get('last_run').state,'idle');assert.equal(seen,0);assert.ok(f.values.get('alarm')>=lease.lease_until);
 t.mock.timers.setTime(lease.lease_until);await run(f,Runtime);assert.equal(seen,1);assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',id).attempts,2);
 assert.equal(JSON.parse(f.one('SELECT checkpoint FROM sync_jobs WHERE id=?',id).checkpoint).after,'old-cursor');
});
