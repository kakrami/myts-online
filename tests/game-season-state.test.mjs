import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {COACH_SCHEMA} from '../src/coaching/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {prepareGameSeasonMove} from '../src/domain/game-season-state.js';
import {AnalysisService} from '../src/analysis/service.js';
import {NativeTrackService} from '../src/analysis/tracks.js';
import {CoachingService} from '../src/coaching/service.js';

const OWNER_TABLES=['analysis_overrides','analysis_track_assignments','analysis_lineup_headers','analysis_lineup_assignments','coach_sessions','coach_session_players','coach_lineup','coach_stints','coach_timeline'];
const PRESERVED_TABLES=['game_bookmarks','coach_profiles','coach_profile_positions','season_controls','season_inclusion_rules','club_season_kits','club_season_kit_rows'];
const AT='2026-05-31T18:00:00.000Z';
let fixtureNumber=0;
async function fixture(db,{alias=false}={}) {
  const prefix='move-'+(++fixtureNumber),teamId=prefix+'-team',otherTeam=prefix+'-other',fromSeasonId=prefix+'-old',toSeasonId=prefix+'-new',otherSeason=prefix+'-foreign',eventId=prefix+'-event',storageEventId=alias?prefix+'-alias':eventId,sourceEvent=prefix+'-source-event',sourceTeam=prefix+'-source-team',otherSource=prefix+'-other-source',player=prefix+'-player',club=prefix+'-club';
  const statements=[],add=(sql,...params)=>statements.push(db.prepare(sql).bind(...params));
  for(const id of [teamId,otherTeam]){add("INSERT INTO app_teams VALUES(?,?,'UTC',2025,NULL,?)",id,id,AT);add('INSERT INTO team_read_state(app_team_id) VALUES(?)',id);}
  for(const [id,team,year,june] of [[fromSeasonId,teamId,2025,0],[toSeasonId,teamId,2026,1],[otherSeason,otherTeam,2026,0]]){
    add('INSERT INTO team_seasons VALUES(?,?,?,?,?,?,?,?)',id,team,year,`${year}-06-01`,`${year+1}-06-01`,`${year}-06-01T00:00:00Z`,`${year+1}-06-01T00:00:00Z`,june);
    add("INSERT INTO team_projection_state(team_season_id,app_team_id,pending,published_input_revision) VALUES(?,?,0,0)",id,team);
  }
  for(const id of new Set([eventId,storageEventId]))add('INSERT INTO events VALUES(?,?)',id,AT);
  if(alias)add('INSERT INTO event_aliases VALUES(?,?)',storageEventId,eventId);
  add('INSERT INTO players VALUES(?,?)',player,AT);
  for(const id of [sourceTeam,otherSource])add("INSERT INTO source_teams(id,provider,scope,native_id,name,name_authority,archived,evidence,content_hash,observed_at) VALUES(?,'gotsport','public',?,?,3,0,'{}','source-hash',?)",id,id,id,AT);
  add("INSERT INTO source_events(id,provider,scope,native_id,local_day,time_precision,type,status,conditional,home_source_team_id,home_label,away_label,title,venue,evidence,content_hash,observed_at) VALUES(?,'gotsport','public',?,'2026-05-31','day','game','scheduled',0,?,'Us','Them','Final','Field','{}','event-hash',?)",sourceEvent,sourceEvent,sourceTeam,AT);
  add("INSERT INTO source_event_teams VALUES(?,?,'home')",sourceTeam,sourceEvent);
  add("INSERT INTO event_source_links VALUES(?,?,'native','{}',1)",sourceEvent,storageEventId);
  add("INSERT INTO team_event_season_resolutions(app_team_id,event_id,team_season_id,state,effective_day,local_day,basis,evidence,revision) VALUES(?,?,?,'resolved','2026-05-31','2026-05-31','date','{}',7)",teamId,eventId,fromSeasonId);
  add("INSERT INTO analysis_overrides VALUES(?,?,'match',?,'','{\"duration_minutes\":50}',4,?)",teamId,fromSeasonId,storageEventId,AT);
  add("INSERT INTO analysis_overrides VALUES(?,?,'player_match',?,?,'{\"goals\":2}',6,?)",teamId,fromSeasonId,storageEventId,player,AT);
  add("INSERT INTO analysis_overrides VALUES(?,?,'player_season','',?,'{\"position\":\"GK\"}',9,?)",teamId,fromSeasonId,player,AT);
  add('INSERT INTO analysis_track_assignments VALUES(?,?,?,?,?,?,3,?)',teamId,fromSeasonId,sourceEvent,sourceTeam,'gid',player,AT);
  add('INSERT INTO analysis_lineup_headers VALUES(?,?,?,9,8,?)',teamId,fromSeasonId,storageEventId,AT);
  add("INSERT INTO analysis_lineup_assignments VALUES(?,?,?,1,?,'field',1,'GK')",teamId,fromSeasonId,storageEventId,player);
  add("INSERT INTO coach_sessions VALUES(?,?,?,9,25,'running',2,60000,50000,?,0,12,?,'last-owner-token')",teamId,fromSeasonId,storageEventId,AT,AT);
  add("INSERT INTO coach_session_players VALUES(?,?,?,?,?,'12',1,'owner',300000)",teamId,fromSeasonId,storageEventId,player,'Keeper');
  add("INSERT INTO coach_lineup VALUES(?,?,?,'GK',?)",teamId,fromSeasonId,storageEventId,player);
  add("INSERT INTO coach_stints VALUES(?,?,?,?,?,'GK',2,50000,NULL)",prefix+'-stint',teamId,fromSeasonId,storageEventId,player);
  add("INSERT INTO coach_timeline VALUES(?,?,?,?,1,'start',2,50000,?,NULL,?,'GK',NULL,NULL,'{\"saved\":true}')",prefix+'-timeline',teamId,fromSeasonId,storageEventId,AT,player);
  add("INSERT INTO game_bookmarks VALUES(?,?,?,?)",teamId,eventId,JSON.stringify({id:eventId,local_day:'2026-05-31'}),AT);
  add("INSERT INTO coach_profiles VALUES(?,?,?,4,40,15,?,'profile-token')",teamId,fromSeasonId,player,AT);
  add("INSERT INTO coach_profile_positions VALUES(?,?,?,'GK',5)",teamId,fromSeasonId,player);
  add('INSERT INTO season_controls VALUES(?,14)',fromSeasonId);
  add("INSERT INTO season_inclusion_rules VALUES(?,'event',?,0,6)",fromSeasonId,eventId);
  add('INSERT INTO app_clubs VALUES(?,?,NULL)',club,'Club');
  add('INSERT INTO club_season_kits VALUES(?,2025,4,1)',club);
  add("INSERT INTO club_season_kit_rows VALUES(?,2025,0,'Home','#ff0000')",club);
  // Another team's state for the same canonical source game is never relocated.
  add('INSERT INTO analysis_track_assignments VALUES(?,?,?,?,?,?,20,?)',otherTeam,otherSeason,sourceEvent,sourceTeam,'other-gid',player,AT);
  add("INSERT INTO analysis_overrides VALUES(?,?,'match',?,'','{\"format\":7}',20,?)",otherTeam,otherSeason,eventId,AT);
  await db.batch(statements);
  return {prefix,teamId,otherTeam,fromSeasonId,toSeasonId,otherSeason,eventId,storageEventId,sourceEvent,sourceTeam,otherSource,player};
}
async function snapshot(db,tables=[...OWNER_TABLES,...PRESERVED_TABLES,'team_event_season_resolutions','team_projection_state','team_seasons']) {
  const rows=await db.batch(tables.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`)));
  return Object.fromEntries(tables.map((table,index)=>[table,rows[index].results]));
}
async function publishOldSeason(db,f) {
  const run=f.prefix+'-published';
  await db.batch([
    db.prepare('INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id) VALUES(?,?,?,?)').bind(f.prefix+'-attachment',f.teamId,f.fromSeasonId,f.sourceTeam),
    db.prepare("INSERT INTO team_projection_runs(id,app_team_id,team_season_id,input_revision,state,created_at) VALUES(?,?,?,0,'published',?)").bind(run,f.teamId,f.fromSeasonId,AT),
    db.prepare("INSERT INTO team_event_rows(run_id,app_team_id,team_season_id,event_id,local_day,type,status,conditional,own_side,home_name,away_name,title,venue,source_ids,schedule_source_id,result_source_id) VALUES(?,?,?,?,'2026-05-31','game','SCHEDULED',0,'home','Us','Them','Game','Field',?,?,?)").bind(run,f.teamId,f.fromSeasonId,f.eventId,JSON.stringify([f.sourceEvent]),f.sourceEvent,f.sourceEvent),
    db.prepare("INSERT INTO team_player_rows VALUES(?,?,?,?,?,'12','[]')").bind(run,f.teamId,f.fromSeasonId,f.player,'Keeper'),
    db.prepare('UPDATE team_projection_state SET published_run_id=? WHERE team_season_id=?').bind(run,f.fromSeasonId),
  ]);
  return {team_id:f.teamId,team_season_id:f.fromSeasonId,event_id:f.eventId};
}
// Execute SQL in the actual Worker binding, avoiding Miniflare's separate
// synchronous getD1Database proxy transport. No retries or simulated database.
function nativeDatabase(mf) {
  const invoke=async body=>{
    const response=await mf.dispatchFetch('http://localhost/__sql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),result=await response.json();
    if(result.error)throw new Error(result.error);return result.value;
  };
  const statement=(sql,params=[])=>({sql,params,bind(...values){return statement(sql,values);},first(){return invoke({method:'first',statements:[{sql,params}]});},all(){return invoke({method:'all',statements:[{sql,params}]});},run(){return invoke({method:'run',statements:[{sql,params}]});}});
  return {prepare:sql=>statement(sql),batch:statements=>invoke({method:'batch',statements:statements.map(({sql,params})=>({sql,params}))})};
}
function transaction(db,f,plan,{faultAt=-1}={}) {
  assert.ok(plan.ok);const token=crypto.randomUUID(),guard='EXISTS(SELECT 1 FROM feature_write_fences WHERE token=?)';
  for(const statement of plan.statements)assert.match(statement.sql,/^(?:INSERT|UPDATE|DELETE)\s/,'collector write-verb contract');
  const statements=[db.prepare(`INSERT INTO feature_write_fences VALUES(?,CASE WHEN(${plan.precondition.sql}) THEN 1 ELSE 0 END)`).bind(token,...plan.precondition.params)];
  statements.push(...plan.statements.map(s=>db.prepare(s.sql.replace('$FENCE',guard)).bind(...s.params,token)));
  if(faultAt>=0)statements.splice(faultAt+1,0,db.prepare('INSERT INTO domain_import_preconditions VALUES(1,1,0)'));
  statements.push(db.prepare("UPDATE team_event_season_resolutions SET team_season_id=?,effective_day='2026-06-01',local_day='2026-06-01',revision=revision+1 WHERE app_team_id=? AND event_id=?").bind(f.toSeasonId,f.teamId,f.eventId));
  statements.push(db.prepare('UPDATE team_projection_state SET pending=1,input_revision=input_revision+1 WHERE app_team_id=? AND team_season_id IN(?,?)').bind(f.teamId,f.fromSeasonId,f.toSeasonId));
  statements.push(db.prepare('DELETE FROM feature_write_fences WHERE token=?').bind(token));
  assert.ok(statements.length+2<=48,'including the runtime writer-epoch wrapper');
  return db.batch(statements);
}

test('native D1 atomically preserves game-scoped owner state across June 1',async t=>{
  // Avoid reusing a localhost socket after the Miniflare bridge closes it. This
  // changes only test transport; no failed call or database action is retried.
  const previousDispatcher=getGlobalDispatcher(),dispatcher=new Agent({pipelining:0});setGlobalDispatcher(dispatcher);
  const worker=`export default {async fetch(request,env){try{const input=await request.json(),statements=input.statements.map(s=>env.DB.prepare(s.sql).bind(...s.params));const value=input.method==='batch'?await env.DB.batch(statements):await statements[0][input.method]();return Response.json({value});}catch(error){return Response.json({error:String(error)});}}};`;
  const mf=new Miniflare({telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'game-season-state',compatibilityDate:'2026-09-09',manifest:{mainModule:'fixture.js',modulesRoot:process.cwd(),modules:{'fixture.js':{type:'esm',contents:worker}}},env:{DB:{type:'d1',id:'game-season-state'}},exports:{}}}]});
  try {
    await mf.ready;const db=nativeDatabase(mf);
    const schema=[...DOMAIN_SCHEMA,...ANALYSIS_SCHEMA,...COACH_SCHEMA,...TEAM_FEATURE_SCHEMA];
    for(let i=0;i<schema.length;i+=40)await db.batch(schema.slice(i,i+40).map(sql=>db.prepare(sql)));
    await db.prepare("INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,1,?)").bind(AT).run();
    await t.test('immediate FKs, full owner state, stable IDs, revisions, and fixed period settings',async()=>{
      const f=await fixture(db),before=await snapshot(db);
      await assert.rejects(db.prepare('UPDATE coach_sessions SET team_season_id=? WHERE app_team_id=?').bind(f.toSeasonId,f.teamId).run(),/FOREIGN KEY/);
      assert.deepEqual(await snapshot(db),before);
      const plan=await prepareGameSeasonMove(db,f);assert.equal(plan.ok,true);assert.equal(plan.statementCount,12);
      assert.deepEqual(await snapshot(db),before,'preparation never commits');
      await transaction(db,f,plan);const after=await snapshot(db);
      for(const table of OWNER_TABLES){
        const old=before[table].filter(r=>r.app_team_id===f.teamId&&!(table==='analysis_overrides'&&r.kind==='player_season'));
        const moved=after[table].filter(r=>r.app_team_id===f.teamId&&r.team_season_id===f.toSeasonId);
        assert.deepEqual(moved,old.map(r=>({...r,team_season_id:f.toSeasonId,...('revision' in r?{revision:r.revision+1}:{})})),table);
        assert.deepEqual(after[table].filter(r=>r.app_team_id===f.otherTeam),before[table].filter(r=>r.app_team_id===f.otherTeam),table+' wrong team');
      }
      for(const table of PRESERVED_TABLES)assert.deepEqual(after[table],before[table],table);
      assert.deepEqual(after.team_seasons,before.team_seasons);
      assert.deepEqual(after.analysis_overrides.filter(r=>r.kind==='player_season'),before.analysis_overrides.filter(r=>r.kind==='player_season'));
      assert.equal(after.coach_sessions.filter(r=>r.app_team_id===f.teamId).length,1);
      assert.equal(after.team_event_season_resolutions.find(r=>r.app_team_id===f.teamId).effective_day,'2026-06-01');
      assert.equal(after.team_projection_state.filter(r=>r.app_team_id===f.teamId&&r.pending===1).length,2);
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
      assert.equal((await prepareGameSeasonMove(db,f)).ok,false,'stale old membership cannot replay a move');
      await assert.rejects(transaction(db,f,plan),/feature_revision_current/);
      assert.deepEqual(await snapshot(db),after,'a lost commit response cannot duplicate the moved Coach session');
    });
    await t.test('canonical aliases keep storage identity and destination aliases collide',async()=>{
      const f=await fixture(db,{alias:true}),plan=await prepareGameSeasonMove(db,f);assert.ok(plan.ok);await transaction(db,f,plan);
      assert.equal((await db.prepare('SELECT event_id FROM coach_sessions WHERE app_team_id=?').bind(f.teamId).first()).event_id,f.storageEventId);
      const other=await fixture(db,{alias:true});
      await db.prepare("INSERT INTO analysis_overrides VALUES(?,?,'match',?,'','{}',1,?)").bind(other.teamId,other.toSeasonId,other.eventId,AT).run();
      const before=await snapshot(db),blocked=await prepareGameSeasonMove(db,other);assert.equal(blocked.ok,false);assert.ok(blocked.conflicts.some(r=>r.code==='destination_collision'));assert.deepEqual(await snapshot(db),before);
    });
    await t.test('all destination owner-state collisions retain both copies and accepted date',async()=>{
      for(const table of ['analysis_overrides','analysis_track_assignments','analysis_lineup_headers','coach_sessions']){
        const f=await fixture(db);
        const row=await db.prepare(`SELECT * FROM ${table} WHERE app_team_id=? LIMIT 1`).bind(f.teamId).first();row.team_season_id=f.toSeasonId;
        await db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
        const before=await snapshot(db),plan=await prepareGameSeasonMove(db,f);assert.equal(plan.ok,false,table);assert.ok(plan.conflicts.some(r=>r.table===table&&r.code==='destination_collision'));assert.deepEqual(plan.statements,[]);assert.deepEqual(await snapshot(db),before);
      }
    });
    await t.test('foreign season, wrong team, noncanonical event and unverified track scope are refused',async()=>{
      const f=await fixture(db,{alias:true});
      for(const change of [{toSeasonId:f.otherSeason},{teamId:f.otherTeam},{eventId:f.storageEventId},{teamId:f.otherTeam,toSeasonId:f.fromSeasonId}]){
        const plan=await prepareGameSeasonMove(db,{...f,...change});assert.equal(plan.ok,false);assert.ok(plan.conflicts.some(r=>r.code==='invalid_scope'));
      }
      await db.prepare('UPDATE analysis_track_assignments SET source_team_id=? WHERE app_team_id=?').bind(f.otherSource,f.teamId).run();
      const before=await snapshot(db),plan=await prepareGameSeasonMove(db,f);assert.equal(plan.ok,false);assert.ok(plan.conflicts.some(r=>r.code==='unverified_track_scope'));assert.deepEqual(await snapshot(db),before);
    });
    await t.test('existing ambiguous Coach identities are retained for review',async()=>{
      const f=await fixture(db,{alias:true});
      const row=await db.prepare('SELECT * FROM coach_sessions WHERE app_team_id=?').bind(f.teamId).first();row.event_id=f.eventId;
      await db.prepare(`INSERT INTO coach_sessions(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
      const before=await snapshot(db),plan=await prepareGameSeasonMove(db,f);assert.equal(plan.ok,false);assert.ok(plan.conflicts.some(r=>r.code==='ambiguous_source_state'&&r.table==='coach_sessions'));assert.deepEqual(await snapshot(db),before);
    });
    await t.test('concurrent parent revisions, inserted keys and destination state invalidate prepared work',async()=>{
      for(const table of ['analysis_overrides','analysis_track_assignments','analysis_lineup_headers','coach_sessions']){
        const f=await fixture(db),plan=await prepareGameSeasonMove(db,f);
        await db.prepare(`UPDATE ${table} SET revision=revision+1 WHERE app_team_id=?`).bind(f.teamId).run();
        const before=await snapshot(db);await assert.rejects(transaction(db,f,plan),/feature_revision_current/);assert.deepEqual(await snapshot(db),before,table);
      }
      for(const destination of [false,true]){
        const f=await fixture(db),plan=await prepareGameSeasonMove(db,f);
        await db.prepare("INSERT INTO analysis_overrides VALUES(?,?,'player_match',?,?,'{}',1,?)").bind(f.teamId,destination?f.toSeasonId:f.fromSeasonId,f.eventId,'new-player-key',AT).run();
        const before=await snapshot(db);await assert.rejects(transaction(db,f,plan),/feature_revision_current/);assert.deepEqual(await snapshot(db),before);
      }
      for(const table of ['analysis_track_assignments','analysis_lineup_assignments']){
        const f=await fixture(db),plan=await prepareGameSeasonMove(db,f);
        await db.prepare(`DELETE FROM ${table} WHERE app_team_id=?`).bind(f.teamId).run();
        const before=await snapshot(db);await assert.rejects(transaction(db,f,plan),/feature_revision_current/);assert.deepEqual(await snapshot(db),before);
      }
    });
    await t.test('a lost caller fence makes every prepared mutation inert',async()=>{
      const f=await fixture(db),before=await snapshot(db),plan=await prepareGameSeasonMove(db,f);
      await db.batch(plan.statements.map(s=>db.prepare(s.sql.replace('$FENCE','0')).bind(...s.params)));
      assert.deepEqual(await snapshot(db),before);
    });
    await t.test('failure at every relocation boundary rolls back parents, children, date and projections',async()=>{
      const f=await fixture(db),before=await snapshot(db);
      for(let at=0;at<=12;at++){
        const plan=await prepareGameSeasonMove(db,f);await assert.rejects(transaction(db,f,plan,{faultAt:at}),/CHECK constraint/);assert.deepEqual(await snapshot(db),before,'fault boundary '+at);
        assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
      }
      await transaction(db,f,await prepareGameSeasonMove(db,f));
    });
    await t.test('large owner-state key sets stop for review without unbounded output',async()=>{
      const f=await fixture(db);
      await db.prepare("INSERT INTO analysis_overrides SELECT ?,?,'player_match',?,printf('extra-%d',value),'{}',1,? FROM json_each(?)").bind(f.teamId,f.fromSeasonId,f.eventId,AT,JSON.stringify(Array.from({length:257},(_,i)=>i))).run();
      const before=await snapshot(db),plan=await prepareGameSeasonMove(db,f);assert.equal(plan.ok,false);assert.ok(plan.conflicts.some(r=>r.code==='state_limit'));assert.deepEqual(plan.statements,[]);assert.deepEqual(await snapshot(db),before);
    });
    await t.test('an old published projection cannot recreate game edits after a move',async()=>{
      const f=await fixture(db),scope=await publishOldSeason(db,f),actor={owner:true};
      await transaction(db,f,await prepareGameSeasonMove(db,f));
      assert.ok(await db.prepare('SELECT 1 FROM team_events WHERE app_team_id=? AND team_season_id=?').bind(f.teamId,f.fromSeasonId).first(),'old projection deliberately remains published');
      const before=await snapshot(db),analysis=new AnalysisService(db,actor),coach=new CoachingService(db,actor),tracks=new NativeTrackService(db,actor);
      await assert.rejects(analysis.set(scope,{kind:'match',eventId:f.eventId},{format:9},0),e=>e.code==='not_found');
      await assert.rejects(analysis.setLineup(scope,f.eventId,{format:9,assignments:[],revision:0}),e=>e.code==='not_found');
      await assert.rejects(coach.command(scope,{type:'create'},0),e=>e.code==='event_not_found');
      await assert.rejects(tracks.context(scope,f.eventId),e=>e.code==='not_found');
      assert.deepEqual(await snapshot(db),before);
      // Season-wide attributes keep their independent scope.
      await analysis.set(scope,{kind:'player_season',playerId:f.player},{jersey:'13'},9);
    });
    await t.test('accepted membership is rechecked inside Coach and analysis commit boundaries',async()=>{
      for(const kind of ['analysis','coach']){
        const f=await fixture(db),scope=await publishOldSeason(db,f),plan=await prepareGameSeasonMove(db,f);let moved=false;
        const racing={prepare:sql=>db.prepare(sql),batch:async statements=>{
          const target=kind==='coach'?/INSERT INTO coach_write_fences/:/INSERT INTO domain_fences/;
          if(!moved&&statements.some(s=>target.test(s.sql))){moved=true;await transaction(db,f,plan);}
          return db.batch(statements);
        }};
        if(kind==='analysis')await assert.rejects(new AnalysisService(racing,{owner:true}).set(scope,{kind:'match',eventId:f.eventId},{format:9},4),e=>e.code==='revision_conflict');
        else await assert.rejects(new CoachingService(racing,{owner:true}).command(scope,{type:'pause'},12),e=>e.code==='revision_conflict');
        assert.equal(moved,true);assert.equal((await db.prepare('SELECT count(*) n FROM coach_sessions WHERE app_team_id=?').bind(f.teamId).first()).n,1);
        assert.equal((await db.prepare('SELECT count(*) n FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind<>\'player_season\'').bind(f.teamId,f.fromSeasonId).first()).n,0);
      }
    });
    await t.test('legacy published games with no resolution still permit existing edits',async()=>{
      const f=await fixture(db),scope=await publishOldSeason(db,f);
      await db.prepare('DELETE FROM team_event_season_resolutions WHERE app_team_id=?').bind(f.teamId).run();
      await new AnalysisService(db,{owner:true}).set(scope,{kind:'match',eventId:f.eventId},{format:9},4);
      await new CoachingService(db,{owner:true}).command(scope,{type:'pause'},12);
      assert.equal((await db.prepare('SELECT revision FROM coach_sessions WHERE app_team_id=?').bind(f.teamId).first()).revision,13);
    });
  } finally {await mf.dispose();setGlobalDispatcher(previousDispatcher);await dispatcher.close();}
});
