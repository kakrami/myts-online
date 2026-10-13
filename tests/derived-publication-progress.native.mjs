import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {freshHarness,TEST_PASSWORD} from './fresh-harness.js';
import {derivedPublicationFixture,DERIVED_AT,DERIVED_SCOPE,DERIVED_SEED_TABLES} from './fixtures/derived-publication-fixture.mjs';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {InstallationUpgrade} from '../src/application/schema-upgrade.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {collectApplicationJob,ApplicationSyncService} from '../src/application/sync-service.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {BudgetDB} from '../src/sync/budget.js';
import {buildMatchAnalysisPage} from '../src/analysis/projector.js';
import {acceptedAnalysisPublicationSQL} from '../src/analysis/eligibility.js';
import {AnalysisReads} from '../src/analysis/reads.js';
import {FeatureReads} from '../src/read-model/feature-reads.js';
import {ReportingService} from '../src/reporting/service.js';

async function runtimeMap(){
 const paths=['worker.js','package.json','release-manifest.json','wrangler.jsonc'];
 for(const directory of ['src','web'])for(const name of await readdir(new URL('../'+directory+'/',import.meta.url),{recursive:true,withFileTypes:true}))if(name.isFile())paths.push(name.parentPath.replace(new URL('../',import.meta.url).pathname,'')+'/'+name.name);
 paths.sort();return Object.fromEntries(await Promise.all(paths.map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])));
}
function traceDatabase(raw,sql,batches){
 const record=(statement,params)=>sql.push({bytes:Buffer.byteLength(statement),parameter_bytes:Buffer.byteLength(JSON.stringify(params)),claim:statement.includes('eligible AS MATERIALIZED')});
 return {prepare(statement){const p=raw.prepare(statement);const decorate=(bound,params=[])=>({_raw:bound,statement,params,bind(...values){return decorate(p.bind(...values),values);},async all(){record(statement,params);return bound.all();},async run(){record(statement,params);return bound.run();},async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;}});return decorate(p);},async batch(statements){batches.push({statements:statements.length,sql_bytes:statements.reduce((n,s)=>n+Buffer.byteLength(s.statement||''),0),parameter_bytes:statements.reduce((n,s)=>n+Buffer.byteLength(JSON.stringify(s.params||[])),0)});for(const s of statements)record(s.statement||'',s.params||[]);return raw.batch(statements.map(s=>s._raw||s));}};
}

// Serialize with all other workerd tests. Virtual clock steps exercise durable
// page delay/fairness; turn counts are NOT production or provider latency claims.
test('native derived collection publishes membership and accepted partial analysis before same-season finite backlog drains',async()=>{
 const before=await runtimeMap(),source=await derivedPublicationFixture(),h=await freshHarness();
 const receipts=[],sql=[],batches=[],pages=[],readReceipts=[],input={team_id:'team',team_season_id:'season',mode:'season',period:'all'};
 let baselineReproduction=null;let now=Date.now(),virtualStart=now,turn=0,stage='initialization',firstMembership=null,firstUseful=null,drained=null,negative=null;
 const rows=async(statement,...params)=>(await h.db.prepare(statement).bind(...params).all()).results,one=async(statement,...params)=>(await rows(statement,...params))[0]??null;
 const clock=()=>now,options={publicHistory:true,reportFairness:true,dependencyFairness:true,clock,pageDelayMs:20000,statementLimit:50};
 const subscribers=[{kind:'team',teamId:'team',key:'connection:root',generation:1}];let jobs;
 const storage=new Map(),ctx={storage:{async get(k){return storage.get(k);},async put(k,v){storage.set(k,structuredClone(v));},async getAlarm(){return storage.get('alarm')??null;},async setAlarm(at){storage.set('alarm',at);},async deleteAlarm(){storage.delete('alarm');}}};
 const traced=traceDatabase(h.rawDb,sql,batches);
 const service=db=>new ApplicationSyncService(db,{}, {coordinatorOptions:options,wake:async()=>{storage.set('connection_recovery_pending',true);}});
 const pendingDerived=async()=>(await one("SELECT COUNT(*) n FROM sync_jobs WHERE provider='trace' AND stage='analysis' AND state IN('queued','running','retrying')")).n;
 const blockedScope='trace:4001:trace:400:2';
 const Runtime=createSyncRuntime(async context=>{
  const {lease,checkpoint}=context;
  const page=await collectApplicationJob(context,{credentialLoader:async()=>'PHPSESSID=synthetic',transportFactory:source.transportFactory,reportCollector:c=>new ReportingService(c.db,{now:clock}).collect(c)});
  pages.push({turn,provider:lease.provider,component:lease.component,scope:lease.scope,complete:page.complete,before:checkpoint,after:page.checkpoint,rows_saved:page.rowsSaved??null,statements:page.statements.length});
  return page;
 },{...options,wrapDatabase,recoverConnections:({db})=>service(db).recoverLocalDemand({wake:false}),inspectInstallation:async({db})=>{const state=await new InstallationUpgrade(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:TEST_PASSWORD}).inspect();return state.state==='ready'?{...state,identity:state.schema_fingerprint+':'+state.started_at}:state;}});
 async function run(){
  now=Math.max(Date.now(),now+5000);turn++;const sourceBefore=await one("SELECT s.input_revision,p.input_revision AS membership_input,e.content_hash AS structural_hash FROM source_event_state s JOIN source_events e ON e.id=s.source_event_id CROSS JOIN team_projection_state p WHERE s.source_event_id=? AND p.team_season_id='season'",DERIVED_SCOPE.sourceEventId);const begin=sql.length;await new Runtime(ctx,{DB:traced}).run();const result=storage.get('last_run');
  const actualSql=sql.length-begin,sourceAfter=await one("SELECT s.input_revision,p.input_revision AS membership_input,e.content_hash AS structural_hash,(SELECT COUNT(*) FROM team_projection_runs WHERE state='obsolete') obsolete_runs FROM source_event_state s JOIN source_events e ON e.id=s.source_event_id CROSS JOIN team_projection_state p WHERE s.source_event_id=? AND p.team_season_id='season'",DERIVED_SCOPE.sourceEventId);receipts.push({turn,...result,actual_sql:actualSql,source_input_before:sourceBefore?.input_revision??0,source_input_after:sourceAfter?.input_revision??0,membership_input_before:sourceBefore?.membership_input,membership_input_after:sourceAfter?.membership_input,structural_hash_before:sourceBefore?.structural_hash,structural_hash_after:sourceAfter?.structural_hash,obsolete_runs:sourceAfter?.obsolete_runs});
  const optional403=result.provider==='trace'&&result.component==='radar'&&result.state==='blocked'&&result.error?.code==='source_access_denied';
  assert.ok(optional403||!['error','failed','blocked','retrying','lease_lost'].includes(result.state),JSON.stringify(result));
  assert.ok(result.statements<=50,JSON.stringify(result));assert.ok(actualSql<=50,'raw epoch-wrapped invocation SQL <=50');
  return result;
 }
 async function readAction(name,fn){const budget=new BudgetDB(traced,50),result=await fn(wrapDatabase(budget));readReceipts.push({action:name,statements:budget.used,rows_read:budget.rowsRead,rows_written:budget.rowsWritten});assert.ok(budget.used<=50);return result;}
 async function save(status,error=null){
  const after=await runtimeMap();assert.deepEqual(after,before,'full runtime must remain frozen');
  const receipt={status,error,stage,turn,baseline_reproduction:baselineReproduction,first_membership:firstMembership,first_useful:firstUseful,drained,negative,virtual_clock:{start:virtualStart,step_ms:5000,page_delay_ms:20000,production_latency_claim:false},source_files:Object.keys(before).length,source_map_sha256:createHash('sha256').update(JSON.stringify(before)).digest('hex'),max_invocation_statements:Math.max(0,...receipts.map(r=>r.statements)),max_actual_invocation_sql:Math.max(0,...receipts.map(r=>r.actual_sql)),max_sql_bytes:Math.max(0,...sql.map(s=>s.bytes)),max_parameter_bytes:Math.max(0,...sql.map(s=>s.parameter_bytes)),max_transaction_statements:Math.max(0,...batches.map(b=>b.statements)),max_transaction_sql_bytes:Math.max(0,...batches.map(b=>b.sql_bytes)),max_transaction_parameter_bytes:Math.max(0,...batches.map(b=>b.parameter_bytes)),claim_sql_bytes:Math.max(0,...sql.filter(s=>s.claim).map(s=>s.bytes)),query_and_transaction_bounds_asserted:true,actual_epoch_wrapped_native_d1:true,synthetic_provider_only:true,provider_calls:source.calls.length,runtime_restarted_each_turn:true,read_receipts:readReceipts,pages,receipts,source_map_before:before,source_map_after:after};
  await mkdir('tmp/derived-publication',{recursive:true});await writeFile('tmp/derived-publication/native-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify({native_derived_publication:{...receipt,pages:undefined,receipts:undefined,source_map_before:undefined,source_map_after:undefined}}));
 }
 try{
  await h.initialize();jobs=new JobCoordinator(h.db,options);stage='seeding saved canonical native game';
  for(const table of DERIVED_SEED_TABLES){const records=source.rows('SELECT * FROM '+table);for(let offset=0;offset<records.length;offset+=24)await h.db.batch(records.slice(offset,offset+24).map(row=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row))));}
  // A prior completed native game scan is saved evidence, not an empty backlog.
  const savedGame=await jobs.enqueue({provider:'trace',component:'game',stage:'source',scope:'trace:4001:trace:400',resourceKey:'trace:4001:trace:400',accountId:'account',accountGeneration:1,recurring:false,priority:80,args:{team_id:'400',game_id:'4001',profile_hash:'synthetic-profile'}},subscribers);
  await h.db.prepare("UPDATE sync_jobs SET state='ready',checkpoint='{\"finished\":true}',pages_saved=4 WHERE id=?").bind(savedGame).run();
  const root=await one("SELECT input_revision,generation FROM team_source_connections WHERE id='root'");
  await jobs.enqueue({provider:'domain',component:'connection',stage:'projection',scope:'team',resourceKey:'root',args:{connectionId:'root',teamId:'team',generation:root.generation,inputRevision:root.input_revision},priority:20,recurring:false},subscribers);
  const ordered=[source.children.find(c=>c.component==='radar'&&c.args.half===1),source.children.find(c=>c.component==='analytics'),source.children.find(c=>c.component==='tracking')];
  ordered.push(...source.children.filter(child=>!ordered.includes(child)));
  for(const child of ordered){await jobs.enqueue({...child,nextAt:now++},subscribers);}
  now=Date.now();virtualStart=now;stage='sustained same-season derived writes';
  for(;turn<2000;){
   const result=await run(),pending=await pendingDerived(),projection=await one("SELECT * FROM team_projection_state WHERE team_season_id='season'");
   if(process.env.MYTS_DERIVED_BASELINE==='1'){const invalidations=receipts.filter(r=>r.provider==='trace'&&r.committed&&r.source_input_after>r.source_input_before&&r.membership_input_after>r.membership_input_before&&r.structural_hash_before===r.structural_hash_after);if(receipts.at(-1).obsolete_runs>=2&&invalidations.length>=2){baselineReproduction={derived_invalidations:invalidations.map(r=>({turn:r.turn,component:r.component,source_input_before:r.source_input_before,source_input_after:r.source_input_after,membership_input_before:r.membership_input_before,membership_input_after:r.membership_input_after,structural_hash:r.structural_hash_after})),obsolete_runs:receipts.at(-1).obsolete_runs,pending_derived:pending,membership_published:!!projection.published_run_id};stage='baseline target regression reproduced';await save('baseline-regression-reproduced');return;}}
   if(!firstMembership&&projection.published_run_id){firstMembership={turn,pending_derived:pending,published_run:projection.published_run_id,event_count:(await one("SELECT COUNT(*) n FROM team_events WHERE team_season_id='season'")).n,source_revision:(await one('SELECT input_revision FROM source_event_state WHERE source_event_id=?',DERIVED_SCOPE.sourceEventId)).input_revision,content_revision:(await one("SELECT content_revision FROM team_read_state WHERE app_team_id='team'")).content_revision};assert.ok(pending>0,'membership must publish before finite derived backlog drains');}
   const accepted=await one(`SELECT a.* FROM match_analysis a WHERE a.source_event_id=? AND ${acceptedAnalysisPublicationSQL('a')}`,DERIVED_SCOPE.sourceEventId);
   if(!firstUseful&&accepted){
    assert.ok(pending>0,'accepted partial analysis must publish before finite derived backlog drains');assert.equal(accepted.state,'incomplete');
    const overview=await readAction('first-useful-overview',db=>new FeatureReads(db,{owner:true},{now:clock}).overview(input));
    const schedule=await readAction('first-useful-analyzed-schedule',db=>new FeatureReads(db,{owner:true},{now:clock}).schedule({...input,type:'analyzed'}));
    const team=await readAction('first-useful-team',db=>new AnalysisReads(db,{owner:true},{now:clock}).team(input));
    assert.ok(overview.data.analyzed_count>=1);assert.equal(schedule.data.total,overview.data.analyzed_count);assert.ok(schedule.data.items.some(row=>row.id===accepted.event_id||row.event_id===accepted.event_id));assert.ok(team.data.players.items.length>0);
    firstUseful={turn,pending_derived:pending,state:accepted.state,player_count:accepted.player_count,event_id:accepted.event_id,input_hash:accepted.input_hash,overview_analyzed:overview.data.analyzed_count,schedule_analyzed:schedule.data.total,team_players:team.data.players.items.length,source_revision:(await one('SELECT input_revision FROM source_event_state WHERE source_event_id=?',DERIVED_SCOPE.sourceEventId)).input_revision};
    console.log(JSON.stringify({native_derived_first_useful:firstUseful}));
   }
   if(!pending){assert.ok(firstMembership&&firstUseful,'finite backlog drained before useful publication');if(result.state==='idle'&&!storage.get('connection_recovery_pending')&&projection.pending===0){drained={turn,source_revision:(await one('SELECT input_revision FROM source_event_state WHERE source_event_id=?',DERIVED_SCOPE.sourceEventId)).input_revision,match_jobs:(await one("SELECT COUNT(*) n FROM sync_jobs WHERE provider='analysis' AND component='match'")).n};break;}}
   if(turn%100===0)console.log(JSON.stringify({native_derived_checkpoint:{turn,pending,phase:result.state,last_page:pages.at(-1),first_membership:firstMembership?.turn,first_useful:firstUseful?.turn}}));
  }
  assert.ok(drained,'finite derived and durable local demand must drain');
  assert.ok(firstMembership.event_count>=26,'real multipage season membership was published');
  const projectionPages=pages.filter(p=>p.provider==='domain'&&p.component==='projection'),eventPages=projectionPages.filter(p=>p.before.phase==='events'&&p.after.cursor);
  assert.ok(eventPages.length>=2,'membership must need multiple event pages');
  const buildStart=projectionPages[0].turn,buildEnd=firstMembership.turn;
  const interleaved=pages.filter(p=>p.provider==='trace'&&['tracking','analytics','radar'].includes(p.component)&&p.turn>buildStart&&p.turn<buildEnd);
  assert.ok(interleaved.length>=2,'actual derived source writes must land during membership build');
  assert.ok(pages.some(p=>p.component==='tracking')&&pages.some(p=>p.component==='analytics')&&pages.some(p=>p.component==='radar'));
  assert.equal((await one("SELECT state FROM sync_jobs WHERE provider='trace' AND component='radar' AND scope=?",blockedScope)).state,'blocked');
  assert.equal((await one("SELECT COUNT(*) n FROM sync_jobs WHERE state IN('queued','running','retrying')")).n,0);
  assert.equal((await one("SELECT COUNT(*) n FROM(SELECT resource_key FROM sync_jobs WHERE provider='analysis' AND component='match' GROUP BY resource_key HAVING COUNT(*)>1)")).n,0);
  const fresh=await readAction('drained-exact-match-input',db=>buildMatchAnalysisPage(db,{...DERIVED_SCOPE,eventId:firstUseful.event_id}));
  const published=await one('SELECT * FROM match_analysis WHERE event_id=?',firstUseful.event_id);assert.equal(fresh.checkpoint.input,published.input_hash,'last derived input must be incorporated without browser-driven recovery');assert.equal(fresh.rowsSaved,0,'drained analysis must already be current');
  drained.final_input_hash=published.input_hash;drained.source_clock=fresh.checkpoint.sourceClock;drained.changed_derived_commits=receipts.filter(r=>r.provider==='trace'&&r.committed&&r.source_input_after>r.source_input_before).map(r=>({turn:r.turn,component:r.component,before:r.source_input_before,after:r.source_input_after}));assert.ok(drained.changed_derived_commits.some(r=>r.turn<firstMembership.turn)&&drained.changed_derived_commits.some(r=>r.turn>firstMembership.turn),'changed same-game derived commits must bracket membership publication');drained.analysis_publications=pages.filter(p=>p.provider==='analysis'&&p.component==='match'&&p.rows_saved>0).length;drained.interleaved_derived_pages=interleaved.length;drained.event_pages=eventPages.length;
  assert.ok(drained.source_revision>firstUseful.source_revision,'additional same-match source evidence arrived after first useful publication');
  const acknowledged=await one("SELECT checkpoint FROM sync_jobs WHERE provider='analysis' AND component='match' AND resource_key=?",'season:'+firstUseful.event_id);assert.equal(JSON.parse(acknowledged.checkpoint).sourceClock,fresh.checkpoint.sourceClock,'durable acknowledgement must match the exact final source clock');
  const settled=await rows("SELECT id,generation,state,checkpoint,attempts FROM sync_jobs WHERE provider='analysis' ORDER BY id");for(let repeat=0;repeat<2;repeat++){const recovery=await readAction('unchanged-recovery-'+repeat,db=>service(db).recoverLocalDemand({wake:false}));assert.equal(recovery.queued,0);assert.equal(recovery.analysesQueued,0);}assert.deepEqual(await rows("SELECT id,generation,state,checkpoint,attempts FROM sync_jobs WHERE provider='analysis' ORDER BY id"),settled);drained.unchanged_recovery_hot_loop=false;
  // Prepare with live authority, then execute the real owner detach command.
  // A stale analysis page must not cross that revocation or change saved facts.
  stage='real connection revocation negative';
  await service(h.db).enqueueMatchAnalysis('team','season',firstUseful.event_id,{wake:false});
  const negativeBudget=new BudgetDB(traced,50),negativeCoordinator=new JobCoordinator(wrapDatabase(negativeBudget),options),lease=await negativeCoordinator.claim();
  assert.equal(lease.provider,'analysis');assert.equal(lease.component,'match');
  const stale=await collectApplicationJob({db:wrapDatabase(negativeBudget),env:{},lease,args:lease.args,checkpoint:lease.checkpoint});
  const savedBefore=await rows('SELECT * FROM match_analysis ORDER BY event_id');
  await service(h.db).detachConnection({teamId:'team',connectionId:'root',generation:1});
  await assert.rejects(()=>negativeCoordinator.commit(lease,stale),/CHECK constraint|precondition/i);
  assert.deepEqual(await rows('SELECT * FROM match_analysis ORDER BY event_id'),savedBefore,'revoked stale publication must roll back');
  assert.equal((await new FeatureReads(h.db,{owner:true},{now:clock}).overview(input)).data.analyzed_count,0);
  negative={real_command:'ApplicationSyncService.detachConnection',stale_analysis_atomic_rejection:true,visible_analyzed_after_revocation:0,statements:negativeBudget.used};assert.ok(negativeBudget.used<=50);
  assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);assert.deepEqual(await one('SELECT writer_mode,writer_epoch,permit_guard FROM installation_upgrade'),{writer_mode:null,writer_epoch:null,permit_guard:null});
  assert.ok(sql.some(s=>s.claim));assert.ok(sql.every(s=>s.bytes<1_000_000));assert.ok(batches.every(b=>b.statements<=50&&b.parameter_bytes<=2_000_000));
  stage='complete';await save('passed');
 }catch(error){await save('failed',String(error));console.error(JSON.stringify({native_derived_failure:{stage,turn,error:String(error),jobs:await rows("SELECT provider,component,resource_key,state,last_error_code,last_error_message FROM sync_jobs WHERE state IN('failed','blocked','retrying')")}}));throw error;}
 finally{source.close();await h.dispose();}
});
