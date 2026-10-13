import test from 'node:test';
import {ReportingService} from '../src/reporting/service.js';
import assert from 'node:assert/strict';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {collectApplicationJob,ApplicationSyncService} from '../src/application/sync-service.js';

import {progressiveFixture as fixture,addSecondRootAndHistory,AT} from './fixtures/progressive-root-service-fixture.mjs';

async function preferred(f,turn){return new JobCoordinator(f.db,{clock:()=>AT,publicHistory:true,ordinaryTurn:turn}).claim();}
const child={component:'tracking',stage:'analysis',scope:'trace:20:trace:10:g0:1',resourceKey:'trace:20:trace:10:g0:1',args:{game_id:'20',team_id:'10',gid:'g0',half:1},priority:20};

test('overdue dirty root wins its turn without changing saved priority; clean and young roots do not',async t=>{
 for(const mode of ['dirty','clean','young','no-last-date'])await t.test(mode,async t=>{const f=fixture(t),root=await f.root(),busy=await f.enqueue();if(mode==='clean')f.sqlite.exec('UPDATE team_source_connections SET reconciled_revision=input_revision');if(mode==='young')f.sqlite.prepare('UPDATE team_source_connections SET last_reconciled_at=?').run(new Date(AT-59000).toISOString());if(mode==='no-last-date')f.sqlite.exec("UPDATE team_source_connections SET last_reconciled_at=NULL,created_at='2026-10-13T05:00:00Z'");assert.equal((await preferred(f,0)).id,['dirty','no-last-date'].includes(mode)?root:busy);assert.equal(f.one('SELECT priority FROM sync_jobs WHERE id=?',root).priority,20);});
});

for(const [name,mutate]of [
 ['exact stored recent child',()=>{}],
 ['wrong event scope',f=>{f.insert('provider_accounts',{id:'elsewhere',provider:'trace',native_id:'elsewhere',name:'Elsewhere'});f.sqlite.exec("UPDATE source_events SET scope='elsewhere',account_id='elsewhere'");}],
 ['wrong team scope',f=>{f.insert('provider_accounts',{id:'elsewhere',provider:'trace',native_id:'elsewhere',name:'Elsewhere'});f.insert('source_teams',{...f.one("SELECT * FROM source_teams WHERE id='source-team'"),id:'foreign-team',scope:'elsewhere',account_id:'elsewhere'});f.sqlite.exec("UPDATE source_event_teams SET source_team_id='foreign-team'");}],
 ['wrong event native id',f=>f.sqlite.exec("UPDATE source_events SET native_id='other'")],
 ['wrong team native id',f=>f.sqlite.exec("UPDATE source_teams SET native_id='other'")],
 ['old date',f=>f.sqlite.exec("UPDATE source_events SET starts_at='2025-01-01',local_day='2025-01-01'")],
 ['unknown date',f=>f.sqlite.exec('UPDATE source_events SET starts_at=NULL,local_day=NULL')],
 ['reported date alone',f=>{f.sqlite.exec('UPDATE source_events SET starts_at=NULL,local_day=NULL');}],
 ['wrong job scope',()=>{}],
 ['file-import event',f=>f.sqlite.exec("UPDATE source_events SET provenance='file_import'")],
])test(`current-child preference: ${name}`,async t=>{const f=fixture(t);mutate(f);const current=await f.enqueue({...child,args:{...child.args,reported_date:'2026-10-13'},...name==='wrong job scope'?{scope:'trace:OTHER:trace:10:g0:1'}:{}}),bulk=await f.enqueue();const actual=await preferred(f,1);assert.equal(actual.id,name==='exact stored recent child'?current:bulk,name);});

for(const [name,mutation]of [
 ['generation',"UPDATE team_source_connections SET generation=2"],
 ['unlink',"UPDATE team_source_connections SET active=0"],
 ['lifecycle',"INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES('team','deleting','now')"],
])test(`root preference never bypasses ${name} authority`,async t=>{const f=fixture(t);await f.root();f.sqlite.exec(mutation);assert.equal(await preferred(f,0),null);});

for(const [name,mutation]of [['generation',"UPDATE provider_accounts SET generation=2"],['revocation',"UPDATE provider_accounts SET active=0"]])test(`current child never bypasses account ${name}`,async t=>{const f=fixture(t);await f.enqueue(child);f.sqlite.exec(mutation);assert.equal(await preferred(f,1),null);});

test('due, lease, and blocked radar predicates are preserved',async t=>{const f=fixture(t);const root=await f.root(),radar=await f.enqueue({...child,component:'radar'}),busy=await f.enqueue();f.sqlite.prepare("UPDATE sync_jobs SET state='blocked',last_error_code='provider_forbidden' WHERE id=?").run(radar);f.sqlite.prepare('UPDATE sync_jobs SET next_at=? WHERE id=?').run(AT+1000,root);assert.equal((await preferred(f,0)).id,busy);f.sqlite.prepare('UPDATE sync_jobs SET next_at=?,lease_until=? WHERE id=?').run(AT,AT+1000,root);assert.equal(await preferred(f,0),null);assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',radar).state,'blocked');});

test('durable ordinary turns survive lost storage reply and runtime restart without idle classes',async t=>{const f=fixture(t);await f.root();await f.enqueue(child);await f.enqueue();const seen=[];const Runtime=createSyncRuntime(async({lease,checkpoint})=>{seen.push([lease.provider,lease.component]);return {statements:[],checkpoint:{pages:(checkpoint.pages||0)+1},complete:false};},{dependencyFairness:true,reportFairness:true,clock:()=>AT,pageDelayMs:0});let lose=true;const put=f.ctx.storage.put;f.ctx.storage.put=async(k,v)=>{await put(k,v);if(k==='ordinary_service_turn'&&lose){lose=false;throw new Error('lost turn write reply');}};await new Runtime(f.ctx,{DB:f.db}).run();assert.equal(f.values.get('last_run').state,'error');assert.equal(f.values.get('ordinary_service_turn'),1);assert.ok(f.values.get('alarm'));assert.equal(seen.length,0);for(let i=0;i<6;i++)await new Runtime(f.ctx,{DB:f.db}).run();assert.deepEqual(seen.map(v=>v[1]),['tracking','games','connection','tracking','games','connection']);});

for(const only of [0,1,2])test(`missing ordinary classes never make a class-${only} queue idle`,async t=>{const f=fixture(t);if(only===0)await f.root();else if(only===1)await f.enqueue(child);else await f.enqueue();let count=0;const Runtime=createSyncRuntime(async()=>{count++;return {statements:[],complete:false};},{dependencyFairness:true,reportFairness:true,clock:()=>AT,pageDelayMs:0});for(let i=0;i<6;i++)await new Runtime(f.ctx,{DB:f.db}).run();assert.equal(count,6);});

test('live-shaped roots finish coalesced catch-up and publish partial saved analysis while priority-97 arrivals continue',async t=>{
 const f=fixture(t);addSecondRootAndHistory(f);
 const rootIds=[];for(const [id,inputRevision,passRevision]of [['root',401,401],['gotsport-root',346,337]]){
  const job=await f.root({resourceKey:id,args:{connectionId:id,teamId:'team',generation:1,inputRevision},key:'connection:'+id});rootIds.push(job);
  f.sqlite.prepare('UPDATE sync_jobs SET checkpoint=? WHERE id=?').run(JSON.stringify({phase:'boundaries',after:'',inputRevision:passRevision,passRevision,generation:1,timezone:'UTC'}),job);
 }
 const service=new ApplicationSyncService(f.db,{}, {coordinatorOptions:{clock:()=>AT}});
 assert.equal((await service.recoverProjections({wake:false})).queued,0,'dirty root gate withholds projection');
 const reports=new ReportingService(f.db,{coordinator:f.jobs,now:()=>AT,captureAtAdmission:false,queryBuilders:{matches:()=>({sql:"SELECT id,'2026-09-01' AS date,'Game' AS type,'Final' AS status,'Them' AS opponent,venue AS location,'Saved' AS source,'' AS competition,'2-1' AS score,'Win' AS result,NULL AS attendance FROM source_events ORDER BY id",params:[]})}});
 const report=(await reports.create({team_id:'team',team_season_id:'season'},{type:'matches'})).data;
 for(let batch=0;batch<8;batch++)await f.jobs.enqueueMany(Array.from({length:16},(_,n)=>{const i=batch*16+n;return ({provider:'trace',accountId:'account',accountGeneration:1,component:'games',stage:'source',scope:'trace:10',resourceKey:'saved-backfill-'+i,args:{},priority:97,recurring:false});}),[{kind:'team',teamId:'team',key:'connection:root',generation:1}]);
 const backlog=await f.enqueue({resourceKey:'backlog',priority:97}),seen=[],pageCounts={},rootsCompleted={},checks=[];let partialAt=null,corrected=false,catchup=false;
 const Runtime=createSyncRuntime(async context=>{
  const {lease,checkpoint}=context;seen.push(lease.provider+':'+lease.component);pageCounts[lease.id]=(pageCounts[lease.id]||0)+1;
  if(lease.provider==='reports')return new ReportingService(context.db,{now:()=>AT}).collect(context);
  if(['trace','gotsport'].includes(lease.provider))return {statements:[],checkpoint:{pages:(checkpoint.pages||0)+1},complete:lease.resource_key!=='backlog',coverage:'partial'};
  const page=await collectApplicationJob(context);
  if(lease.component==='connection'){
   if(lease.resource_key==='root'&&checkpoint.phase==='events'&&page.checkpoint.after&&!corrected){
    // Mutate behind the committed cursor after this invocation, preserving the
    // coalesced pass. The next page must eventually restart and accept it.
    checks.push(()=>{f.sqlite.exec("UPDATE source_events SET venue='Corrected behind cursor',content_hash='corrected' WHERE id='source-event'");corrected=true;});
   }
   if(lease.resource_key==='root'&&corrected&&page.checkpoint.phase==='boundaries')catchup=true;
   if(page.complete)rootsCompleted[lease.resource_key]=seen.length;
  }
  return page;
 },{publicHistory:true,reportFairness:true,dependencyFairness:true,clock:()=>AT,pageDelayMs:0,statementLimit:50,recoverConnections:({db,env})=>new ApplicationSyncService(db,env).recoverLocalDemand({wake:false})});
 for(let i=0;i<2000;i++){
  await f.enqueue({resourceKey:'arrival-'+i});
  await new Runtime(f.ctx,{DB:f.db}).run();
  const result=f.values.get('last_run');assert.ok(!['error','failed','blocked','retrying','lease_lost'].includes(result.state),JSON.stringify(result));assert.ok(result.statements<=50);
  while(checks.length)checks.shift()();
  const analysis=f.one("SELECT * FROM match_analysis WHERE event_id='event'");if(analysis){partialAt=i+1;break;}
 }
 const roots=f.rows('SELECT id,input_revision,reconciled_revision FROM team_source_connections');assert.ok(roots.every(r=>r.input_revision===r.reconciled_revision),JSON.stringify(roots));assert.equal(Object.keys(rootsCompleted).length,2);assert.ok(corrected&&catchup,'behind-cursor change required a new pass');assert.ok(partialAt,'actual application analysis must publish before backlog drain');
 const analysis=f.one("SELECT * FROM match_analysis WHERE event_id='event'");assert.equal(analysis.state,'incomplete');assert.ok(analysis.player_count>0);assert.equal(f.one("SELECT minutes FROM effective_player_matches WHERE player_id='player-006'").minutes,null,'partial saved analysis does not invent missing minutes');
 assert.equal((await reports.snapshot(report.snapshot_id)).state,'ready');assert.ok(seen.includes('reports:capture'));assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',backlog).state,'queued');assert.ok(f.one("SELECT count(*) n FROM sync_jobs WHERE provider='trace' AND state='queued'").n>100);assert.ok(seen.includes('trace:games'));assert.equal(f.one("SELECT venue FROM team_events WHERE event_id='event'").venue,'Corrected behind cursor');
 console.log(JSON.stringify({progressive_service:{turns:partialAt,root_pages:rootIds.map(id=>pageCounts[id]),root_finish_turns:rootsCompleted,bulk_pages:seen.filter(x=>x==='trace:games').length,pending_backlog:f.one("SELECT count(*) n FROM sync_jobs WHERE provider='trace' AND state='queued'").n,analysis_state:analysis.state,players:analysis.player_count,behind_cursor_catchup:true,report_state:(await reports.snapshot(report.snapshot_id)).state}}));
});

for(const [name,overrides]of [['wrong connectionId',{connectionId:'elsewhere'}],['wrong teamId',{teamId:'elsewhere'}],['wrong args generation',{generation:2}]])test(`root preference rejects ${name} without changing ordinary eligibility`,async t=>{const f=fixture(t);await f.root({args:{connectionId:'root',teamId:'team',generation:1,inputRevision:401,...overrides}});const busy=await f.enqueue();assert.equal((await preferred(f,0)).id,busy);});

for(const [component,priority,current]of [['catalog',1,true],['match',40,true],['match',20,false]])test(`local analysis ${component} priority${priority} uses its existing currentness classification`,async t=>{const f=fixture(t);const analysis=await f.enqueue({provider:'analysis',component,stage:'analysis',scope:'team',resourceKey:'season:event',args:{teamId:'team',seasonId:'season',eventId:'event'},priority}),busy=await f.enqueue();assert.equal((await preferred(f,1)).id,current?analysis:busy);});

test('a resource-key mismatch cannot borrow exact native child scope',async t=>{const f=fixture(t);await f.enqueue({...child,resourceKey:'different'});const busy=await f.enqueue();assert.equal((await preferred(f,1)).id,busy);});

for(const mutation of ['generation=generation+1','active=0'])test(`an already-collected preferred root cannot commit after ${mutation}`,async t=>{const f=fixture(t);await f.root();const jobs=new JobCoordinator(f.db,{clock:()=>AT,publicHistory:true,ordinaryTurn:0}),lease=await jobs.claim(),page=await collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});f.sqlite.exec('UPDATE team_source_connections SET '+mutation);const result=await jobs.commit(lease,page);assert.equal(result.committed,false);assert.equal(f.one('SELECT pages_saved FROM sync_jobs WHERE id=?',lease.id).pages_saved,0);});

test('real recovery-only invocations preserve the ordinary turn and arm continuation',async t=>{const f=fixture(t);await f.root();await f.enqueue();f.values.set('connection_recovery_pending',true);f.values.set('ordinary_service_turn',2);const Runtime=createSyncRuntime(()=>assert.fail('recovery must yield before claim'),{dependencyFairness:true,reportFairness:true,clock:()=>AT,recoverConnections:({db,env})=>new ApplicationSyncService(db,env).recoverLocalDemand({wake:false})});await new Runtime(f.ctx,{DB:f.db}).run();assert.equal(f.values.get('last_run').state,'recovering_connections');assert.equal(f.values.get('ordinary_service_turn'),2);assert.equal(f.values.has('report_service_turn'),false);assert.ok(f.values.get('alarm'));});

test('finite priority97 arrivals drain and then priority20 historical work completes',async t=>{
 const f=fixture(t),high=await f.enqueue({resourceKey:'finite-backfill'}),low=await f.enqueue({component:'analytics',stage:'analysis',scope:'trace:old:trace:10:team:home:full',resourceKey:'trace:old:trace:10:team:home:full',args:{game_id:'old',team_id:'10'},priority:20}),seen=[];
 const Runtime=createSyncRuntime(async({lease,checkpoint})=>{seen.push(lease.id);return {statements:[],checkpoint:{page:(checkpoint.page||0)+1},complete:lease.id!==high||(checkpoint.page||0)>=4};},{dependencyFairness:true,reportFairness:true,clock:()=>AT,pageDelayMs:0});
 for(let turn=0;turn<20;turn++){await f.enqueue({resourceKey:'finite-arrival-'+turn});await new Runtime(f.ctx,{DB:f.db}).run();assert.notEqual(f.values.get('last_run').state,'idle');}
 assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',low).state,'queued');
 for(let turn=0;turn<10&&f.one('SELECT state FROM sync_jobs WHERE id=?',low).state!=='ready';turn++)await new Runtime(f.ctx,{DB:f.db}).run();
 assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',low).state,'ready');assert.equal(f.one('SELECT COUNT(*) n FROM sync_jobs WHERE priority=97 AND state<>\'ready\'').n,0);assert.ok(seen.indexOf(low)>=20);
});

test('actual analysis publishes a saved reported stat with no radar while clock and minutes remain unknown',async t=>{
 const f=fixture(t);f.sqlite.exec("DELETE FROM source_trace_components WHERE kind='radar'; UPDATE team_source_connections SET reconciled_revision=input_revision");
 f.insert('source_stat_summaries',{id:'reported-summary',account_id:'account',source_team_id:'source-team',source_event_id:'source-event',source_player_id:'native-0',side:'home',period:'full',state:'ready',summary:JSON.stringify({shots:{total:4,made:2}}),content_hash:'reported-stat',observed_at:new Date(AT).toISOString()});
 const radar=await f.enqueue({...child,component:'radar'});f.sqlite.prepare("UPDATE sync_jobs SET state='blocked',last_error_code='provider_forbidden',last_error_message='HTTP 403' WHERE id=?").run(radar);
 await f.enqueue({provider:'analysis',component:'match',stage:'analysis',scope:'team',resourceKey:'season:event',args:{teamId:'team',seasonId:'season',eventId:'event'},priority:70});
 const Runtime=createSyncRuntime(collectApplicationJob,{dependencyFairness:true,reportFairness:true,publicHistory:true,clock:()=>AT,pageDelayMs:0,statementLimit:50});await new Runtime(f.ctx,{DB:f.db}).run();assert.equal(f.values.get('last_run').state,'ready',JSON.stringify(f.values.get('last_run')));
 const fact=f.one("SELECT * FROM effective_player_matches WHERE player_id='player-000'"),match=f.one("SELECT * FROM match_analysis WHERE event_id='event'");assert.equal(fact.shots,4);assert.equal(fact.shots_made,2);assert.equal(fact.native_state,'ready');assert.equal(fact.minutes,null);assert.equal(fact.field_minutes,null);assert.equal(fact.gk_minutes,null);assert.equal(match.duration_minutes,null);assert.equal(match.format,null);assert.equal(f.one("SELECT count(*) n FROM source_trace_components WHERE kind='radar'").n,0);assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',radar).state,'blocked');
});

test('diagnostic matcher recognizes actual public-history-prefixed claim SQL',async t=>{const f=fixture(t);await f.root();const prepare=f.db.prepare,captured=[];f.db.prepare=sql=>{if(sql.includes('eligible AS MATERIALIZED'))captured.push(sql);return prepare(sql);};await new JobCoordinator(f.db,{clock:()=>AT,publicHistory:true,reportTurn:true,ordinaryTurn:0}).claim();assert.equal(captured.length,1);assert.ok(!captured[0].startsWith('WITH eligible'));assert.equal(Buffer.byteLength(captured[0]),23200);});
