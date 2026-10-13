import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {V714_OBJECTS,V714_FINGERPRINT,V714_CURSOR} from '../src/application/schema-v714.js';
import {V731_SCHEMA as SCHEMA} from '../src/application/schema-v731.js';
import {sqlOperation,INSTALLATION_EPOCH} from '../src/application/installation-epoch.js';
import {nativeCanonicalId} from '../src/domain/identity.js';
import {TRANSFER_TABLES,TRANSFER_PARENT_NAMES,TRANSFER_PLAN,transferCursor} from '../src/application/transfer-schema-upgrade.js';
import {schemaIdentityV731 as schemaIdentity,validateRemoteDatabaseV731 as validateRemoteDatabase} from '../scripts/release-check.mjs';

const START='2026-10-12T05:20:00.000Z',COMPLETE='2026-10-12T05:29:49.040Z';
async function harness({mode}={}){
 const root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||'.'),modules={};
 for(const file of(await readdir(path.join(root,'src'),{recursive:true})).filter(file=>file.endsWith('.js')))modules['src/'+file]={type:'esm',contents:await readFile(path.join(root,'src',file),'utf8')};
 // Historical714 ->731 harness uses its frozen engine, writer and schema.
 // Current extension acceptance is tested separately; no production fallback.
 modules['worker.js']={type:'esm',contents:(await readFile(path.join(root,'worker.js'),'utf8')).replace("import {SCHEMA,SEED} from './src/application/installation-schema.js';","import {V731_SCHEMA as SCHEMA,V731_SEED as SEED} from './src/application/schema-v731.js';").replace("from './src/application/schema-upgrade.js'","from './src/application/schema-upgrade-v731.js'").replace("from './src/application/installation-epoch.js'","from './src/application/installation-epoch-v731.js'")};
 modules['web/app/coach-tactics.js']={type:'esm',contents:await readFile(path.join(root,'web/app/coach-tactics.js'),'utf8')};for(const name of ['web/app/schedule-query.js','web/app/reporting/encoders.js','web/app/reporting/font-metrics.js'])modules[name]={type:'esm',contents:await readFile(path.join(root,name),'utf8')};
 modules['upgrade-test-worker.js']={type:'esm',contents:`
  import app,{SyncRuntime} from './worker.js';
  export {SyncRuntime};
  import {InstallationUpgrade} from './src/application/schema-upgrade-v731.js';
  import {V731_SCHEMA as SCHEMA,V731_SEED as SEED} from './src/application/schema-v731.js';
  import {wrapDatabase} from './src/application/installation-epoch-v731.js';
  import {BudgetDB} from './src/sync/budget.js';
  export default {async fetch(request,env){
   const body=await request.json(),db=new BudgetDB(env.DB,body.limit??50);
   try{let result;
    if(body.op==='http'){const response=await app.fetch(new Request('https://upgrade.test'+body.path,{method:body.method??'GET',headers:{'Content-Type':'application/json',Origin:'https://upgrade.test'},...(body.data?{body:JSON.stringify(body.data)}:{})}),env,{});return Response.json({result:{status:response.status,data:await response.json()}});}
    if(body.op==='cron'){const pending=[];await app.scheduled({},env,{waitUntil(task){pending.push(task);}});await Promise.all(pending);return Response.json({result:{ok:true}});}
    if(body.op==='runtime'){const response=await env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/'+body.path,{method:body.path==='wake'?'POST':'GET'});return Response.json({result:await response.json()});}
    const installation=new InstallationUpgrade(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:'native-upgrade-fixture-password',upgradeMode:body.mode??env.MYTS_UPGRADE_MODE});
    if(body.failBatch){const transact=installation.transact.bind(installation);installation.transact=(journal,statements,next)=>transact(journal,[...statements,db.prepare('UPDATE installation_upgrade SET assertion=0 WHERE id=1')],next);}
    if(body.op==='inspect')result=await installation.inspect();
    else if(body.op==='advance'){result=await installation.advanceUpgrade();if(body.loseAck)throw Error('simulated_committed_response_loss');}
    else if(body.op==='fresh')result=await installation.advance('native-upgrade-fixture-password');
    else if(body.op==='transact'){await installation.transact(body.journal,body.statements.map(row=>db.prepare(row.sql).bind(...(row.params??[]))));result={ok:true};}
    else if(body.op==='run')result=await wrapDatabase(db).prepare(body.sql).run();
    else if(body.op==='first')result=await wrapDatabase(db).prepare(body.sql).first('name');
    else if(body.op==='exec')result=await wrapDatabase(db).exec(body.sql);
    else {const writer=body.op==='wrapped'?wrapDatabase(db):db;result=await writer.batch(body.statements.map(row=>writer.prepare(row.sql).bind(...(row.params??[]))));}
    return Response.json({result,used:db.used});
   }catch(error){return Response.json({error:{code:error.code??null,message:error.message},used:db.used},{status:409});}
  }};
 `};
 const mf=new Miniflare({cf:false,telemetry:{enabled:false},workers:[{config:{name:'upgrade-proof',compatibilityDate:'2026-09-09',manifest:{mainModule:'upgrade-test-worker.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'upgrade-proof'},SYNC:{type:'durable-object',worker:'upgrade-proof',exportName:'SyncRuntime'},...(mode===undefined?{}:{MYTS_UPGRADE_MODE:{type:'text',value:mode}})},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}}}}]});await mf.ready;
 async function call(body){const response=await mf.dispatchFetch('https://upgrade.test/',{method:'POST',body:JSON.stringify(body)}),value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error.message),{code:value.error.code,used:value.used});return value;}
 const batch=async statements=>(await call({op:'raw',statements})).result;
 const query=async(sql,params=[])=>(await batch([{sql,params}]))[0].results;
 return {call,batch,query,dispose:()=>mf.dispose()};
}
async function oldInstall(h){
 const order={table:0,index:1,view:2,trigger:3},objects=[...V714_OBJECTS].sort((a,b)=>order[a.type]-order[b.type]||a.name.localeCompare(b.name));
 for(let start=0;start<objects.length;start+=24)await h.batch(objects.slice(start,start+24).map(row=>({sql:row.sql})));
 await h.batch([{sql:'INSERT INTO setup_state VALUES(1,?,270,\'ready\',?,?)',params:[V714_FINGERPRINT,START,COMPLETE]},{sql:'INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,1,?)',params:[START]}]);
}
async function snapshot(h){const tables=V714_OBJECTS.filter(row=>row.type==='table'&&row.name!=='setup_state').map(row=>row.name),rows={};for(let i=0;i<tables.length;i+=20){const names=tables.slice(i,i+20),values=await h.batch(names.map(name=>({sql:'SELECT '+(TRANSFER_PARENT_NAMES.includes(name)?TRANSFER_TABLES.find(table=>table.name===name).columns.join(','):'*')+' FROM '+name+' ORDER BY rowid'})));names.forEach((name,index)=>{rows[name]=values[index].results;});}return rows;}
async function fixture(h){
 const original=await nativeCanonicalId('connection-attachment','team');
 await h.batch([
  {sql:`INSERT INTO security_owner VALUES(1,'fixture-salt','fixture-hash',600000,1,?,1,1)`,params:[START]},
  {sql:`INSERT INTO security_installation VALUES(1,'fixture-vault-id','fixture-vault-value',1)`},
  {sql:`INSERT INTO provider_accounts VALUES('account','teamsnap','native-account','Fixture account',3,1)`},
  {sql:`INSERT INTO security_account_credentials VALUES('account',3,'fixture-ciphertext',NULL,1)`},
  {sql:`INSERT INTO security_sessions VALUES('fixture-session',1,1,9999999999999,NULL)`},
  {sql:`INSERT INTO app_teams VALUES('team','Saved team','UTC',2026,'old-request',?)`,params:[START]},
  {sql:`INSERT INTO app_teams VALUES('missing','Missing original attachment','UTC',2026,'missing-request',?)`,params:[START]},
  {sql:`INSERT INTO team_read_state(app_team_id) VALUES('team'),('missing')`},
  {sql:`INSERT INTO team_seasons VALUES('season-old','team',2025,'2025-06-01','2026-06-01','2025-06-01T00:00:00Z','2026-06-01T00:00:00Z',0),('season-new','team',2026,'2026-06-01','2027-06-01','2026-06-01T00:00:00Z','2027-06-01T00:00:00Z',1)`},
  {sql:`INSERT INTO source_teams(id,provider,scope,account_id,native_id,name,name_authority,archived,evidence,content_hash,observed_at) VALUES('source','teamsnap','account','account','native-team','Saved provider team',1,0,'{}','fixture-source-hash',?)`,params:[START]},
  {sql:`INSERT INTO source_players(id,provider,scope,account_id,native_id,name,jersey,evidence,content_hash,observed_at) VALUES('player-source','teamsnap','account','account','native-player','Current name','99','{}','current-hash',?)`,params:[START]},
  {sql:`INSERT INTO source_roster_memberships VALUES('source','player-source',0,'saved-scan','provider')`},
  {sql:`INSERT INTO team_source_attachments VALUES(?,'team','season-old','source','account',0,2),('other-attachment','team','season-new','source','account',1,1)`,params:[original]},
  {sql:`INSERT INTO players VALUES('player',?)`,params:[START]},
  {sql:`INSERT INTO team_projection_runs VALUES('old-run','team','season-old',1,'published',?),('new-run','team','season-new',1,'published',?)`,params:[START,START]},
  {sql:`INSERT INTO team_projection_state(team_season_id,app_team_id,published_run_id) VALUES('season-old','team','old-run'),('season-new','team','new-run')`},
  {sql:`INSERT INTO team_player_rows VALUES('old-run','team','season-old','player','Historical name','7','["player-source"]')`},
  {sql:`INSERT INTO sync_jobs(id,provider,account_scope,account_id,authorization_generation,component,scope,resource_key,scan_id,ready_since,next_at,interval_ms,state,lease_token,lease_until,checkpoint) VALUES('retained-job','teamsnap','account','account',3,'events','source','source','scan',1,1,900000,'running','old-worker-lease',9999999999999,'{"offset":12}')`},
  {sql:`INSERT INTO sync_job_subscribers VALUES('retained-job','team',?,'team',2)`,params:[original]},
 ]);
 await h.batch([
  {sql:`INSERT INTO events VALUES('unique-event',?),('duplicate-event',?),('undated-event',?)`,params:[START,START,START]},
  {sql:`INSERT INTO source_events(id,provider,scope,account_id,native_id,starts_at,time_precision,type,status,conditional,home_source_team_id,home_label,away_label,title,venue,evidence,content_hash,observed_at) SELECT value,'teamsnap','account','account',value,CASE WHEN value='undated-source' THEN NULL ELSE '2025-10-10T10:00:00Z' END,CASE WHEN value='undated-source' THEN 'pending' ELSE 'instant' END,'game','FINAL',0,'source','Home','Away','Saved game','','{}','event-hash',? FROM json_each('["unique-source","duplicate-source","undated-source"]')`,params:[START]},
  {sql:`INSERT INTO event_source_links VALUES('unique-source','unique-event','native','{}',1),('duplicate-source','duplicate-event','native','{}',1),('undated-source','undated-event','native','{}',1)`},
  {sql:`INSERT INTO source_event_teams VALUES('source','unique-source','home'),('source','duplicate-source','home'),('source','undated-source','home')`},
  {sql:`INSERT INTO team_event_rows(run_id,app_team_id,team_season_id,event_id,starts_at,type,status,conditional,own_side,home_name,away_name,title,venue,source_ids,schedule_source_id,result_source_id) VALUES('old-run','team','season-old','unique-event','2025-10-10T10:00:00Z','game','FINAL',0,'home','Home','Away','Saved game','','["unique-source"]','unique-source','unique-source'),('old-run','team','season-old','duplicate-event','2025-10-10T10:00:00Z','game','FINAL',0,'home','Home','Away','Saved game','','["duplicate-source"]','duplicate-source','duplicate-source'),('new-run','team','season-new','duplicate-event','2026-10-10T10:00:00Z','game','FINAL',0,'home','Home','Away','Saved game','','["duplicate-source"]','duplicate-source','duplicate-source'),('old-run','team','season-old','undated-event',NULL,'game','SCHEDULED',0,'home','Home','Away','Saved game','','["undated-source"]','undated-source','undated-source')`},
 ]);
}

async function transferFixture(h){
 await h.batch([
  {sql:`INSERT INTO data_file_exports(id,app_team_id,team_season_id,kind,scope,sections,source_revision,capture_signature,state,checkpoint,part_count,byte_length,created_at,expires_at) VALUES('retained-export','team','season-old','dataset','{"season":"season-old"}','[]',7,'retained-signature','capturing','{"offset":19}',19,1216000,1,9999999999999)`},
  {sql:`INSERT INTO data_file_imports VALUES('retained-import','team','season-old','{"legacy_scope":"season-old"}','applying',7,2,1,9999999999999)`},
 ]);
 for(let i=0;i<19;i++)await h.batch([
  {sql:`INSERT INTO data_file_entries VALUES('retained-export',?,?,NULL,1,?,123,64000,?)`,params:[i,'segment-'+i,'retained-hash-'+i,i*64000]},
  {sql:`INSERT INTO data_file_parts(rowid,export_id,ordinal,bytes) VALUES(?,'retained-export',?,randomblob(64000))`,params:[i===18?'9007199254740993':String(i-2),i]},
 ]);
 for(let i=0;i<7;i++)await h.batch([{sql:`INSERT INTO data_file_import_segments VALUES('retained-import',?,?,?)`,params:[i,JSON.stringify({ordinal:i,saved:'x'.repeat(700000)}),i<2?1:0]}]);
}

async function coachFixture(h){
 await h.batch([{sql:"INSERT INTO players VALUES('coach-player-2',?),('coach-player-3',?)",params:[START,START]},
  {sql:"INSERT INTO coach_profiles VALUES('team','season-old','player',4,77,9,?,'preserved-profile-token')",params:[START]},
  {sql:"INSERT INTO coach_profile_positions VALUES('team','season-old','player','LF',5),('team','season-old','player','RF',3)"}]);
 const sessions=[['season-old','unique-event','running',1,60],['season-old','duplicate-event','paused',1,30],['season-new','duplicate-event','halftime',2,40],['season-new','undated-event','finished',2,5],['season-new','unique-event','setup',1,35]];
 for(const [index,[season,event,phase,period,half]]of sessions.entries()){
  await h.batch([{sql:'INSERT INTO coach_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',params:['team',season,event,index%2?9:7,half,phase,period,123456,9876,phase==='running'?START:null,index%2,17+index,START,'preserved-session-token-'+index]}]);
  await h.batch(['player','coach-player-2','coach-player-3'].map((player,i)=>({sql:'INSERT INTO coach_session_players VALUES(?,?,?,?,?,?,?,?,?)',params:['team',season,event,player,'Captured name '+i,'0'+i,i===2?0:1,i===2?'owner_unavailable':'saved_provider',i===2?43210:null]})));
  await h.batch([{sql:"INSERT INTO coach_lineup VALUES('team',?,?,'LF','player'),('team',?,?,'RF','coach-player-2')",params:[season,event,season,event]},
   {sql:"INSERT INTO coach_stints VALUES(?,'team',?,?,'player','LF',?,123,NULL),(?,'team',?,?,'coach-player-2','RF',?,456,123456)",params:['open-'+index,season,event,period,'closed-'+index,season,event,period]}]);
  for(let sequence=1;sequence<=4;sequence++)await h.batch([{sql:'INSERT INTO coach_timeline VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',params:['timeline-'+index+'-'+sequence,'team',season,event,sequence,'preserved-owner-correction',period,12345,START,'player','coach-player-2','LF',1000,43210,JSON.stringify({note:'é'.repeat(7900),sequence})]}]);
 }
 await assert.rejects(h.query("UPDATE coach_sessions SET half_minutes=90"),/CHECK constraint failed/);
}

test('SQL admission recognizes CTE mutations and denies schema/journal/exec bypasses',()=>{
 for(const sql of ['SELECT 1','WITH x AS(SELECT 1) SELECT * FROM x','/* UPDATE */ SELECT \'DELETE\''])assert.equal(sqlOperation(sql),'read');
 for(const sql of ['INSERT INTO a VALUES(1)','UPDATE a SET b=1','DELETE FROM a','REPLACE INTO a VALUES(1)','WITH x AS(SELECT 1) UPDATE a SET b=1','WITH x AS(SELECT 1) DELETE FROM a'])assert.equal(sqlOperation(sql),'write');
 for(const sql of ['DROP TABLE a','ALTER TABLE a ADD COLUMN z','PRAGMA foreign_keys=OFF','UPDATE "installation_upgrade" SET phase=\'complete\'','SELECT 1; DELETE FROM a',"UPDATE 'installation_upgrade' SET writer_mode=NULL",'INSERT INTO [installation_upgrade](id) VALUES(1)'])assert.throws(()=>sqlOperation(sql));
});

test('exact 7.1.4 upgrade is resumable, fenced, byte-bounded, and preserves original data and transfer jobs',async()=>{
 const h=await harness();try{
  await oldInstall(h);await fixture(h);await transferFixture(h);await coachFixture(h);const before=await snapshot(h);
  assert.equal((await h.call({op:'inspect'})).result.state,'upgrade_required');
  await h.call({op:'advance'});
  let state=(await h.call({op:'inspect'})).result;assert.equal(state.phase,'sealing');
  for(const field of ['phase','to_fingerprint','cursor'])await assert.rejects(h.query(`UPDATE installation_upgrade SET ${field}='unauthorized'`),/installation_upgrade_permit_required/);
  const wrong={...state.journal,cursor:'99999'};
  await assert.rejects(h.call({op:'transact',journal:wrong,statements:[{sql:'CREATE TABLE should_rollback(id INTEGER)'}]}));
  assert.deepEqual(await h.query("SELECT name FROM sqlite_master WHERE name='should_rollback'"),[]);
  const releaseIdentity=await schemaIdentity(),seenPhases=new Set(),failedTransferSteps=new Set();let byteCapObserved=false,maxUsed=0;
  let passes=0;for(;passes<300;passes++){
   if(state.phase==='transfers'){
    const cursor=transferCursor(state.journal.cursor),failureKey=cursor.step+(cursor.table>=5?':coach':'');
    if(['copy','drain','swap','restore'].includes(cursor.step)&&!failedTransferSteps.has(failureKey)){
     const saved=await snapshot(h),savedJournal=state.journal;
     await assert.rejects(h.call({op:'advance',failBatch:true}),/CHECK constraint failed/);
     assert.deepEqual(await snapshot(h),saved);assert.deepEqual((await h.call({op:'inspect'})).result.journal,savedJournal);failedTransferSteps.add(failureKey);
    }
    if(cursor.step==='copy'&&[0,5].includes(cursor.table)&&cursor.after===null){
     await assert.rejects(h.call({op:'advance',loseAck:true}),/simulated_committed_response_loss/);
     await assert.rejects(h.call({op:'transact',journal:state.journal,statements:[]}),/CHECK constraint failed/);
     state=(await h.call({op:'inspect'})).result;
    }
   }
   const prior=state;const result=await h.call({op:'advance'});assert.ok(result.used<=50,'Native statement budget');maxUsed=Math.max(maxUsed,result.used);
   if(passes===0){await assert.rejects(h.call({op:'transact',journal:prior.journal,statements:[{sql:'CREATE TABLE lost_ack_replay(id INTEGER)'}]}));assert.deepEqual(await h.query("SELECT name FROM sqlite_master WHERE name='lost_ack_replay'"),[]);}
   state=(await h.call({op:'inspect'})).result;
   if(prior.phase==='transfers'){const c=transferCursor(prior.journal.cursor);if(c.step==='copy'&&c.table===4&&c.after===null){assert.equal((await h.query('SELECT COUNT(*) n FROM installation_transfer_copy_data_file_import_segments'))[0].n,5);byteCapObserved=true;}}
   if(state.state==='ready')break;
   const phaseKey=state.phase==='transfers'?'transfers:'+transferCursor(state.journal.cursor).step:state.phase;
   if(!seenPhases.has(phaseKey)){seenPhases.add(phaseKey);const objects=await h.query("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"),setup=(await h.query('SELECT * FROM setup_state'))[0];assert.equal(validateRemoteDatabase(objects.filter(row=>row.type==='table').map(row=>row.name),setup,{schema_version:1},releaseIdentity,{objects,journal:state.journal}).state,'upgrading');}
  }
  assert.ok(passes<300);assert.equal(state.state,'ready');
  const after=await snapshot(h),expected=structuredClone(before),priorClock=before.source_serialization_clock[0].revision;
  assert.equal(after.source_serialization_clock[0].revision,priorClock+1);expected.source_serialization_clock[0].revision=priorClock+1;
  const rosterStamp=after.source_row_versions.filter(row=>row.table_name==='connection_roster_evidence');assert.equal(rosterStamp.length,1);assert.equal(rosterStamp[0].revision,priorClock+1);
  expected.source_row_versions.push(...rosterStamp);assert.deepEqual(after,expected);
  assert.deepEqual([...failedTransferSteps].sort(),['copy','copy:coach','drain','drain:coach','restore','restore:coach','swap']);assert.ok(byteCapObserved);
  assert.ok(seenPhases.has('transfers:verify_stage')&&seenPhases.has('transfers:verify_final'));
  assert.equal((await h.query("SELECT CAST(rowid AS TEXT) id FROM data_file_parts WHERE ordinal=18"))[0].id,'9007199254740993');
  assert.deepEqual(await h.query("SELECT scope_kind,team_season_id FROM data_file_exports UNION ALL SELECT scope_kind,team_season_id FROM data_file_imports"),[{scope_kind:'legacy_season',team_season_id:'season-old'},{scope_kind:'legacy_season',team_season_id:'season-old'}]);
  assert.deepEqual(await h.query("SELECT name FROM sqlite_master WHERE name LIKE 'installation_transfer_copy_%'"),[]);
  assert.deepEqual(await h.query('PRAGMA foreign_key_check'),[]);
  assert.equal((await h.query('SELECT count(*) n FROM coach_sessions'))[0].n,5);
  assert.equal((await h.query('SELECT count(*) n FROM coach_timeline'))[0].n,20);
  assert.equal((await h.query("SELECT count(*) n FROM coach_stints WHERE end_ms IS NULL"))[0].n,5);
  await h.call({op:'wrapped',statements:[{sql:"UPDATE coach_sessions SET half_minutes=90 WHERE team_season_id='season-old' AND event_id='unique-event'"}]});
  assert.equal((await h.query("SELECT half_minutes FROM coach_sessions WHERE team_season_id='season-old' AND event_id='unique-event'"))[0].half_minutes,90);
  await assert.rejects(h.query("UPDATE coach_sessions SET half_minutes=60"),/installation_epoch_required/);
  console.log(JSON.stringify({proof:'exact-upgrade-file-and-coach-preservation',passes,maxUsed,maxPageRows:TRANSFER_PLAN.maxRows,maxPageBytes:TRANSFER_PLAN.maxBytes,coachSessions:5,coachTimelineRows:20,coachOpenStints:5,targetHalfMinutes:90}));
  const setup=(await h.query('SELECT * FROM setup_state'))[0];assert.equal(setup.started_at,START);assert.equal(setup.completed_at,COMPLETE);assert.equal(setup.state,'ready');assert.equal(setup.next_index,SCHEMA.length);assert.notEqual(setup.schema_fingerprint,V714_FINGERPRINT);
  const root=(await h.query('SELECT * FROM team_source_connections'))[0];assert.equal(root.scope_mode,'fixed_seasons');assert.equal(root.scope_origin,'legacy_ambiguous');assert.equal(root.active,1);
  assert.deepEqual((await h.query('SELECT team_season_id,active,excluded FROM team_connection_seasons ORDER BY team_season_id')),[{team_season_id:'season-new',active:1,excluded:0},{team_season_id:'season-old',active:0,excluded:1}]);
  const receipt=(await h.query("SELECT * FROM connection_command_receipts WHERE request_id='old-request'"))[0];assert.equal(receipt.payload_version,1);assert.equal(receipt.payload_hash,null);assert.equal(receipt.connection_id,root.id);
  assert.equal((await h.query("SELECT connection_id FROM connection_command_receipts WHERE request_id='missing-request'"))[0].connection_id,await nativeCanonicalId('legacy-unresolved-connection','missing'));
  const roster=(await h.query('SELECT name,jersey,basis,certainty FROM connection_roster_evidence'))[0];assert.deepEqual(roster,{name:'Historical name',jersey:'7',basis:'accepted_projection',certainty:'preserved_uncertain'});
  assert.deepEqual(await h.query('SELECT event_id,team_season_id,state,effective_day FROM team_event_season_resolutions ORDER BY event_id'),[{event_id:'duplicate-event',team_season_id:null,state:'conflict',effective_day:null},{event_id:'undated-event',team_season_id:'season-old',state:'pending',effective_day:null},{event_id:'unique-event',team_season_id:'season-old',state:'resolved',effective_day:'2025-10-10'}]);
  for(const sql of ["UPDATE app_teams SET name='late old' WHERE id='team'","DELETE FROM security_sessions","INSERT INTO owner_preferences VALUES(1,'light',1)","UPDATE sync_jobs SET checkpoint='{}' WHERE id='retained-job'"]){await assert.rejects(h.query(sql),/installation_epoch_required/);}
  await assert.rejects(h.query("UPDATE setup_state SET state='initializing'"),/installation_epoch_required/);
  const write={sql:"UPDATE app_teams SET name='new writer' WHERE id='team'"};
  await assert.rejects(h.call({op:'wrapped',limit:2,statements:[write]}),error=>error.code==='invocation_budget'&&error.used===0);
  assert.equal((await h.query("SELECT name FROM app_teams WHERE id='team'"))[0].name,'Saved team');
  await assert.rejects(h.call({op:'exec',sql:'SELECT 1'}),error=>error.code==='installation_write_contract');
  assert.equal((await h.call({op:'run',limit:3,sql:"UPDATE app_teams SET name='direct run' WHERE id='team'"})).used,3);
  const returned=await h.call({op:'first',limit:3,sql:"UPDATE app_teams SET name='first writer' WHERE id='team' RETURNING name"});assert.equal(returned.used,3);assert.equal(returned.result,'first writer');
  assert.equal((await h.call({op:'wrapped',limit:1,statements:[{sql:'SELECT 1'}]})).used,1);
  const success=await h.call({op:'wrapped',limit:3,statements:[write]});assert.equal(success.used,3);assert.equal(success.result.length,1);
  assert.equal((await h.call({op:'wrapped',limit:3,statements:[{sql:"WITH selected AS(SELECT 'team' id) UPDATE app_teams SET name='CTE writer' WHERE id IN(SELECT id FROM selected)"}]})).used,3);
  const concurrent=await Promise.allSettled(Array.from({length:12},(_,i)=>h.call({op:i%2?'raw':'wrapped',statements:[{sql:`UPDATE app_teams SET name='${i%2?'old':'new'}-${i}' WHERE id='team'`}]})));
  assert.equal(concurrent.filter(value=>value.status==='fulfilled').length,6);
  await assert.rejects(h.batch([{sql:"UPDATE installation_upgrade SET writer_mode='application',writer_epoch=?,permit_guard=0 WHERE id=1",params:[INSTALLATION_EPOCH]},{sql:"UPDATE app_teams SET name='leaked permit' WHERE id='team'"}]));
  assert.equal((await h.query('SELECT writer_mode,permit_guard FROM installation_upgrade'))[0].writer_mode,null);
  assert.notEqual((await h.query("SELECT name FROM app_teams WHERE id='team'"))[0].name,'leaked permit');
  await assert.rejects(h.batch([{sql:"UPDATE installation_upgrade SET writer_mode='application',writer_epoch=?,permit_guard=0 WHERE id=1",params:[INSTALLATION_EPOCH]},{sql:"UPDATE installation_upgrade SET phase='sealing' WHERE id=1"},{sql:'UPDATE installation_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1'}]),/installation_upgrade_permit_required/);
  const identity=await schemaIdentity(),objects=await h.query("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"),journal=(await h.query('SELECT * FROM installation_upgrade'))[0];
  assert.equal(validateRemoteDatabase(objects.filter(row=>row.type==='table').map(row=>row.name),setup,{schema_version:1},identity,{objects,journal}).state,'ready');
  const altered=objects.map(row=>row.name==='team_source_connections'?{...row,sql:row.sql.replace('scope_origin','wrong_column')}:row);
  assert.throws(()=>validateRemoteDatabase(objects.filter(row=>row.type==='table').map(row=>row.name),setup,{schema_version:1},identity,{objects:altered,journal}),/physical schema/);
 }finally{await h.dispose();}
});

test('fresh target schema reaches ready with guarded setup and no upgrade origin',async()=>{
 const h=await harness();try{
  let result;for(let step=0;step<Math.ceil(SCHEMA.length/30)+2;step++){result=await h.call({op:'fresh'});assert.ok(result.used<=50);if(!result.result.continue)break;}
  assert.equal(result.result.continue,false);assert.equal((await h.call({op:'inspect'})).result.state,'ready');
  assert.equal((await h.query('SELECT from_fingerprint FROM installation_upgrade'))[0].from_fingerprint,null);
  await assert.rejects(h.query("UPDATE setup_state SET state='initializing'"),/installation_epoch_required/);
 }finally{await h.dispose();}
});

test('unknown physical old-schema changes fail before any journal or setup write',async()=>{
 const h=await harness();try{
  await oldInstall(h);await h.query('DROP INDEX source_teams_name');
  await assert.rejects(h.call({op:'advance'}),error=>error.code==='installation_schema_mismatch');
  assert.deepEqual(await h.query("SELECT name FROM sqlite_master WHERE name='installation_upgrade'"),[]);
  assert.deepEqual((await h.query('SELECT schema_fingerprint,next_index,completed_at FROM setup_state'))[0],{schema_fingerprint:V714_FINGERPRINT,next_index:V714_CURSOR,completed_at:COMPLETE});
 }finally{await h.dispose();}
});


test('maintenance pauses exact old and partial schema across HTTP, cron and native DO; normal resumes',async()=>{
 const h=await harness({mode:'maintenance'});try{
  await oldInstall(h);const setup=await h.query('SELECT * FROM setup_state');
  for(const path of ['/api/bootstrap','/api/health'])assert.equal((await h.call({op:'http',path})).result.status,200);
  assert.equal((await h.call({op:'http',path:'/api/bootstrap'})).result.data.setup.state,'maintenance');
  for(const [path,method,data] of [['/api/connections','POST',{}],['/api/owner/initialize','POST',{password:'native-upgrade-fixture-password'}],['/api/overview','GET',null]]){
   const response=(await h.call({op:'http',path,method,data})).result;assert.equal(response.status,503);assert.equal(response.data.error.code,'installation_maintenance');
  }
  assert.equal((await h.call({op:'advance'})).result.state,'maintenance');
  await h.call({op:'cron'});assert.equal((await h.call({op:'runtime',path:'wake'})).result.queued,false);
  assert.equal((await h.call({op:'runtime',path:'status'})).result.setup_state,'maintenance');
  assert.deepEqual(await h.query("SELECT name FROM sqlite_master WHERE name='installation_upgrade'"),[]);assert.deepEqual(await h.query('SELECT * FROM setup_state'),setup);
  await h.call({op:'advance',mode:'normal'});const before=await h.query('SELECT * FROM installation_upgrade');
  await h.call({op:'cron'});await h.call({op:'advance'});assert.deepEqual(await h.query('SELECT * FROM installation_upgrade'),before);
  await h.call({op:'advance',mode:'normal'});assert.notDeepEqual(await h.query('SELECT * FROM installation_upgrade'),before);
  await h.query('DROP INDEX source_teams_name');await assert.rejects(h.call({op:'inspect'}),error=>error.code==='installation_schema_mismatch');
 }finally{await h.dispose();}
});

test('unknown mode fails closed without creating even fresh schema and health remains available',async()=>{
 const h=await harness({mode:'invalid-mode'});try{
  for(const op of ['inspect','fresh','advance','cron'])await assert.rejects(h.call({op}),error=>error.code==='installation_mode_invalid');
  const response=(await h.call({op:'http',path:'/api/bootstrap'})).result;assert.equal(response.status,503);assert.equal(response.data.error.code,'installation_mode_invalid');
  assert.equal((await h.call({op:'http',path:'/api/health'})).result.status,200);
  assert.equal((await h.call({op:'runtime',path:'wake'})).result.state,'blocked');
  assert.deepEqual((await h.call({op:'raw',mode:'normal',statements:[{sql:"SELECT name FROM sqlite_master WHERE name='setup_state'"}]})).result[0].results,[]);
 }finally{await h.dispose();}
});

test('deployed normal candidate advances exact old schema through native alarms without browser polling writes',async()=>{
 const h=await harness();try{
  await oldInstall(h);await h.call({op:'cron'});
  const deadline=Date.now()+90000;let state;
  do{state=(await h.call({op:'inspect'})).result;if(state.state==='ready')break;await new Promise(resolve=>setTimeout(resolve,200));}while(Date.now()<deadline);
  assert.equal(state.state,'ready');const status=(await h.call({op:'runtime',path:'status'})).result;if(status.statements!==undefined)assert.ok(status.statements<=50);
  assert.equal((await h.query('SELECT completed_at FROM setup_state'))[0].completed_at,COMPLETE);
 }finally{await h.dispose();}
});

test('committed Coach child-drain and parent-swap lost acknowledgements resume without cascade loss',async()=>{
 const h=await harness();try{
  await oldInstall(h);await fixture(h);await coachFixture(h);
  const names=['coach_sessions','coach_session_players','coach_lineup','coach_stints','coach_timeline'];
  const coachSnapshot=async()=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await h.query('SELECT CAST(rowid AS TEXT) original_rowid,* FROM '+name+' ORDER BY rowid')])));
  const before=await coachSnapshot(),foreignKeys=Object.fromEntries(await Promise.all(names.slice(1).map(async name=>[name,await h.query('PRAGMA foreign_key_list('+name+')')])));
  let state=(await h.call({op:'inspect'})).result,passes=0;const interrupted=[];
  while(state.state!=='ready'&&passes++<300){
   const cursor=state.phase==='transfers'?transferCursor(state.journal.cursor):null;
   const point=cursor?.step==='drain'&&cursor.table===8&&cursor.after===null?'child-drain':cursor?.step==='swap'?'parent-swap':null;
   if(point&&!interrupted.includes(point)){
    const stale=state.journal;
    await assert.rejects(h.call({op:'advance',loseAck:true}),/simulated_committed_response_loss/);
    // A fresh invocation reconstructs authority entirely from durable journal
    // and exact physical schema; the old acknowledged cursor cannot act again.
    state=(await h.call({op:'inspect'})).result;
    await assert.rejects(h.call({op:'transact',journal:stale,statements:[{sql:"UPDATE app_teams SET name='stale continuation' WHERE id='team'"}]}),/CHECK constraint failed/);
    assert.equal((await h.query("SELECT name FROM app_teams WHERE id='team'"))[0].name,'Saved team');
    for(const name of names.slice(1))assert.equal((await h.query('SELECT count(*) n FROM '+name))[0].n,0,name);
    assert.equal((await h.query('SELECT count(*) n FROM coach_sessions'))[0].n,point==='child-drain'?5:0);
    if(point==='parent-swap')assert.match((await h.query("SELECT sql FROM sqlite_master WHERE name='coach_sessions'"))[0].sql,/half_minutes BETWEEN 5 AND 90/);
    interrupted.push(point);continue;
   }
   await h.call({op:'advance'});state=(await h.call({op:'inspect'})).result;
  }
  assert.equal(state.state,'ready');assert.deepEqual(interrupted,['child-drain','parent-swap']);assert.deepEqual(await coachSnapshot(),before);
  for(const name of names.slice(1))assert.deepEqual(await h.query('PRAGMA foreign_key_list('+name+')'),foreignKeys[name]);
  assert.deepEqual(await h.query('PRAGMA foreign_key_check'),[]);assert.deepEqual(await h.query("SELECT name FROM sqlite_master WHERE name LIKE 'installation_transfer_copy_%'"),[]);
  console.log(JSON.stringify({proof:'coach-committed-interruption-resume',boundaries:interrupted,passes,preservedTables:names}));
 }finally{await h.dispose();}
});
