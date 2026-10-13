import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fullFixture,finishProjection,forceEquivalentProjection} from './team-game-projection-coordinator.test.mjs';
import {loadTeamGameCandidates} from '../src/domain/team-game-candidates.js';
const NOW=Date.parse('2026-10-13T00:00:00Z'),GS='gotsport/public/201',LV='live/public/301';
const SOURCE_TABLES=['source_events','source_event_teams','event_source_links','events','source_teams','source_team_links'];
const OWNER_TABLES=['domain_overrides','coach_sessions','coach_session_players','coach_lineup','coach_stints','coach_timeline','analysis_overrides','analysis_lineup_headers','analysis_lineup_assignments','analysis_track_assignments','game_bookmarks'];
const snapshot=(f,tables)=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
async function insert(f,table,row){await f.db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row)).run();}
async function bridge(f,{expires=NOW-1,observed=NOW-3600000}={}){
 const at=new Date(observed).toISOString(),endpoint=p=>'https://gotsportlive-api.azurewebsites.net/api/clubapi/'+p;
 const evidence={team_id:'201',live_team_id:'301',external_key:'201',external_source_name:'GotSport',external_source_id:6,default_season:true,item_id:'301',club:'51',season:'61',season_name:'2026',verified_at:at,expires_at:new Date(expires).toISOString(),observations:[{endpoint:endpoint('initclubteams'),params:{ClubID:'51'},status:200,hash:'a'.repeat(64),at},{endpoint:endpoint('getteams'),params:{ClubID:'51',SeasonID:'61'},status:200,hash:'b'.repeat(64),at}]};
 await insert(f,'source_team_links',{a:GS,b:LV,kind:'provider_external_key',evidence:JSON.stringify(evidence)});
 await f.db.prepare('UPDATE team_source_connections SET reconciled_revision=input_revision').run();
 return evidence;
}
async function ownerState(f){
 const event='canonical-z-private-000',at=new Date(NOW).toISOString();
 await insert(f,'domain_overrides',{app_team_id:'team',kind:'event',entity_id:event,fields:'{"title":"Owner title"}',revision:1});
 await insert(f,'game_bookmarks',{app_team_id:'team',event_id:event,saved_at:at,snapshot:'{}'});
 await insert(f,'coach_sessions',{app_team_id:'team',team_season_id:'season',event_id:event,format:7,half_minutes:25,phase:'setup',period:1,elapsed_ms:0,period_start_ms:0,revision:1,updated_at:at,write_token:'bridge-expiry-test'});
}

test('expired unused bridge cannot stall direct-root pairs in exported production SyncRuntime',async t=>{
 t.mock.timers.enable({apis:['Date'],now:NOW});const f=await fullFixture({pairs:24});t.after(()=>f.close());
 await bridge(f);await ownerState(f);const sources=snapshot(f,SOURCE_TABLES),owners=snapshot(f,OWNER_TABLES),errors=[];
 const batch=f.raw.batch;f.raw.batch=async statements=>{try{return await batch(statements);}catch(e){errors.push({code:e.code,message:e.message});throw e;}};
 const pages=await finishProjection(f,t);
 assert.deepEqual(errors,[]);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_events').get().n,24);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_game_source_rows').get().n,48);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_game_publications WHERE disposition='accepted'").get().n,24);
 assert.ok(f.sqlite.prepare('SELECT fence FROM team_game_publications').all().every(p=>JSON.parse(p.fence).valid_until===null));
 assert.deepEqual(snapshot(f,SOURCE_TABLES),sources);assert.deepEqual(snapshot(f,OWNER_TABLES),owners);
 assert.equal(f.sqlite.prepare('SELECT writer_mode FROM installation_team_games_upgrade').get().writer_mode,null);
 assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 t.diagnostic(JSON.stringify({pages:pages.length,maxStatements:Math.max(...pages.map(p=>p.statements)),sourceRows:48,acceptedPairs:24,transactionErrors:errors}));
});

async function livePeer(f){
 const source=f.sqlite.prepare("SELECT * FROM source_events WHERE id='a-public-000'").get();
 await insert(f,'source_events',{...source,id:'live-peer',provider:'live',native_id:'live-peer',home_source_team_id:LV,away_source_team_id:'live/public/302',content_hash:'hash-live-peer'});
 for(const [source_team_id,side] of [[LV,'home'],['live/public/302','away']])await insert(f,'source_event_teams',{source_team_id,source_event_id:'live-peer',side});
 await insert(f,'event_source_links',{source_event_id:'live-peer',event_id:'canonical-a-public-000',reason:'source_identity',evidence:'{}'});
 const job=f.sqlite.prepare("SELECT * FROM sync_jobs WHERE provider='gotsport' AND component='profile'").get(),coverage=f.sqlite.prepare("SELECT * FROM source_component_coverage WHERE provider='gotsport' AND kind='profile'").get();
 for(const component of ['upcoming','membership']){
  const id='live-'+component;
  await insert(f,'sync_jobs',{...job,id,provider:'live',component,scope:'301',resource_key:'301',args:'{"team_id":"301"}'});
  await insert(f,'sync_job_subscribers',{job_id:id,kind:'team',demand_key:'connection:pub',app_team_id:'team',generation:1});
  await insert(f,'source_component_coverage',{...coverage,id,provider:'live',kind:component,scope:'301'});
 }
}
async function freshClock(f,t){
 const now=Date.parse(f.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') at").get().at);t.mock.timers.setTime(now);
 // Leave the already-complete provider jobs out of this projection-only run.
 await f.db.prepare("UPDATE sync_jobs SET next_at=? WHERE stage='source'").bind(now+86400000).run();return now;
}
for(const valid of [true,false])test(`${valid?'valid':'expired'} required bridge ${valid?'admits':'cannot admit'} canonical peer identity in exported production SyncRuntime`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:NOW});const f=await fullFixture({pairs:1});t.after(()=>f.close());const now=await freshClock(f,t);
 await livePeer(f);await bridge(f,{observed:now,expires:now+(valid?3600000:-1)});await ownerState(f);
 const before=snapshot(f,[...SOURCE_TABLES,...OWNER_TABLES]);
 const candidate=await loadTeamGameCandidates(f.db,{teamId:'team',seasonId:'season',canonicalEventIds:['canonical-z-private-000'],now});
 assert.equal(candidate.connectionSnapshot.aliases.length,valid?1:0);
 assert.equal(candidate.sourceSnapshot.events.find(e=>e.source_id==='live-peer').source_team_id,valid?LV:null);
 if(!valid)assert.ok(candidate.reasons.includes('canonical_member_scope_unproven'));
 const pages=await finishProjection(f,t),members=f.sqlite.prepare('SELECT * FROM team_game_source_rows ORDER BY source_event_id').all();
 if(valid){
  assert.deepEqual(members.map(m=>m.source_event_id),['a-public-000','live-peer','z-private-000']);
  const peer=members.find(m=>m.source_event_id==='live-peer');assert.equal(peer.connected_source_team_id,GS);assert.equal(peer.participant_source_team_id,LV);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_events').get().n,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_game_publications WHERE disposition='accepted'").get().n,1);
  assert.ok(f.sqlite.prepare('SELECT fence FROM team_game_publications').all().every(p=>JSON.parse(p.fence).valid_until===now+3600000));
 }else{
  assert.deepEqual(members.map(m=>m.source_event_id),['a-public-000','z-private-000']);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_game_publications WHERE disposition='accepted'").get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_events').get().n,2);
 }
 assert.deepEqual(snapshot(f,[...SOURCE_TABLES,...OWNER_TABLES]),before);
 assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 if(!valid){
  const prior=f.sqlite.prepare('SELECT published_run_id FROM team_projection_state').get().published_run_id;
  await f.db.prepare("UPDATE source_team_links SET evidence=json_set(evidence,'$.expires_at',?)").bind(new Date(now+3600000).toISOString()).run();
  await f.db.prepare('UPDATE team_source_connections SET reconciled_revision=input_revision').run();
  await forceEquivalentProjection(f);await finishProjection(f,t);
  assert.notEqual(f.sqlite.prepare('SELECT published_run_id FROM team_projection_state').get().published_run_id,prior);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_events').get().n,1);
  const renewed=f.sqlite.prepare('SELECT m.source_event_id FROM team_game_source_rows m JOIN team_projection_state p ON p.published_run_id=m.run_id ORDER BY m.source_event_id').all();
  assert.deepEqual(renewed.map(m=>m.source_event_id),['a-public-000','live-peer','z-private-000']);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_game_publications g JOIN team_projection_state p ON p.published_run_id=g.run_id WHERE disposition='accepted'").get().n,1);
  for(const table of [...SOURCE_TABLES,...OWNER_TABLES].filter(table=>table!=='source_team_links'))assert.deepEqual(snapshot(f,[table])[table],before[table]);
 }
 t.diagnostic(JSON.stringify({valid,pages:pages.length,maxStatements:Math.max(...pages.map(p=>p.statements)),members:members.map(m=>m.source_event_id)}));
});

for(const boundary of ['expires_at','observation'])test(`admitted bridge ${boundary} crossing between read and commit atomically rejects production page`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:NOW});const f=await fullFixture({pairs:1});t.after(()=>f.close());const now=await freshClock(f,t),cutoff=now+15000;
 await livePeer(f);await bridge(f,{observed:boundary==='observation'?cutoff-6*3600000:now,expires:boundary==='expires_at'?cutoff:now+3600000});await ownerState(f);
 const before=snapshot(f,[...SOURCE_TABLES,...OWNER_TABLES]),prepare=f.raw.prepare,batch=f.raw.batch;let attempted=false,rejected=null,jobBefore;
 f.raw.prepare=sql=>{const annotate=(statement,params=[])=>({...statement,testSQL:sql,testParams:params,bind(...p){return annotate(statement.bind(...p),p);}});return annotate(prepare(sql));};
 f.raw.batch=async statements=>{
  const publication=statements.find(s=>s.testSQL.startsWith('INSERT INTO team_game_publications('));
  if(publication&&!attempted){
   attempted=true;jobBefore=f.sqlite.prepare('SELECT checkpoint,pages_saved FROM sync_jobs WHERE id=?').get(f.jobId);
   const captured=JSON.parse(publication.testParams[0]);assert.equal(captured.length,1);assert.equal(JSON.parse(captured[0].fence).valid_until,cutoff);
   assert.ok(Date.now()<cutoff,'the bridge was still admitted at acquisition');
   const sqlNow=()=>Date.parse(f.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') at").get().at);
   await delay(Math.max(0,cutoff-sqlNow()+25));assert.ok(sqlNow()>=cutoff);
   try{return await batch(statements);}catch(e){rejected={code:e.code,message:e.message};throw e;}
  }
  return batch(statements);
 };
 for(let i=0;i<100&&!attempted;i++){t.mock.timers.setTime(Math.max(Date.now(),f.alarm));await f.runtime.alarm();}
 assert.equal(attempted,true);assert.equal(rejected?.code,'ERR_SQLITE_ERROR');assert.match(rejected.message,/CHECK constraint failed/);
 assert.deepEqual(f.sqlite.prepare('SELECT checkpoint,pages_saved FROM sync_jobs WHERE id=?').get(f.jobId),jobBefore);
 for(const table of ['team_events','team_event_rows','team_game_source_rows','team_game_publications','team_game_associations','team_game_decision_revisions'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);
 assert.equal(f.sqlite.prepare('SELECT published_run_id FROM team_projection_state').get().published_run_id,null);
 assert.equal(f.sqlite.prepare('SELECT writer_mode FROM installation_team_games_upgrade').get().writer_mode,null);
 assert.deepEqual(snapshot(f,[...SOURCE_TABLES,...OWNER_TABLES]),before);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 t.diagnostic(JSON.stringify({boundary,cutoff,rejected,atomicRollback:true}));
});
