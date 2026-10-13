import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {SECURITY_SCHEMA} from '../src/security/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {COACH_SCHEMA} from '../src/coaching/schema.js';
import {REPORT_SCHEMA} from '../src/reporting/schema.js';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {buildConnectionPage} from '../src/domain/connection-materializer.js';
import {beginTeamSnapRefresh,finishTeamSnapRefresh} from '../src/sources/teamsnap-refresh.js';
import {loadTeamGameCandidates} from '../src/domain/team-game-candidates.js';
import {resolvePublishedGame,gameScopeRevision} from '../src/domain/team-game-scope.js';
import {ReadRepository} from '../src/read-model/repository.js';
import {FeatureReads,publicEventsCTE} from '../src/read-model/feature-reads.js';
import {CursorCodec} from '../src/read-model/cursor.js';
import {AnalysisReads} from '../src/analysis/reads.js';
import {buildMatchAnalysisPage} from '../src/analysis/projector.js';
import {ReportingService} from '../src/reporting/service.js';
import {TEAM_FEATURE_SCHEMA,TeamFeatures} from '../src/application/team-features.js';
import {EventEditor} from '../src/application/event-editor.js';
import {TeamGameDecisions} from '../src/application/team-game-decisions.js';

const NOW=Date.parse('2026-10-13T00:00:00Z'),AT=new Date(NOW).toISOString();
const INPUT={team_id:'team',team_season_id:'season',period:'all'};
const TS=sourceKey('teamsnap','401','account'),PUBLIC=sourceKey('gotsport','501');
const TS_TEAM=sourceKey('teamsnap','101','account'),PUBLIC_TEAM=sourceKey('gotsport','201');

// Scope: synthetic collector-shaped pages enter the production source ingester.
// The HTTP collectors, job leases and native D1 runtime are intentionally absent.
// The SQLite adapter and complete receipt construction follow the existing
// candidate/decision fixtures, without importing and re-running their test suites.
async function workflowFixture(t){
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const sql=new DatabaseSync(':memory:');
  t.after(()=>sql.close());
  sql.exec('PRAGMA foreign_keys=ON');
  for(const ddl of [...DOMAIN_SCHEMA,...SYNC_SCHEMA,...SECURITY_SCHEMA,...ANALYSIS_SCHEMA,...COACH_SCHEMA,...TEAM_FEATURE_SCHEMA,...REPORT_SCHEMA])sql.exec(ddl);
  const rows=(query,...params)=>sql.prepare(query).all(...params).map(row=>({...row}));
  const insert=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
  let maxBatch=0;
  const prepare=(query,params=[])=>({bind(...values){return prepare(query,values);},async all(){const results=rows(query,...params);return {results,meta:{changes:sql.prepare('SELECT changes() n').get().n}};},async first(){return (await this.all()).results[0]??null;},async run(){return this.all();}});
  const db={prepare,async batch(statements){maxBatch=Math.max(maxBatch,statements.length);sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const commit=async page=>{assert.ok(page.statements.length<=48,'bounded production page');await db.batch(page.statements.map(q=>db.prepare(q.sql.replaceAll('$FENCE','1')).bind(...q.params)));};
  const settle=async(make,label)=>{let checkpoint={};for(let page=0;page<100;page++){const result=await make(checkpoint);await commit(result);checkpoint=result.checkpoint;if(result.complete)return checkpoint;}assert.fail(label+' did not settle in 100 bounded pages');};
  insert('domain_installation',{id:1,schema_version:1,created_at:AT});
  insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'11',name:'Synthetic owner'});
  insert('provider_accounts',{id:'foreign-account',provider:'teamsnap',native_id:'22',name:'Synthetic other owner'});
  insert('security_owner',{id:1,password_salt:'fixture',password_hash:'fixture',password_iterations:600000,password_revision:1,last_password_change:AT,created_at:NOW,updated_at:NOW});
  insert('security_sessions',{token_hash:'session',password_revision:1,created_at:NOW,expires_at:NOW+86400000});
  const domain=new DomainRepository(db);
  for(const [teamId,seasonId] of [['team','season'],['other-team','other-season']])await domain.createTeam({teamId,seasonId,name:teamId,timezone:'America/Los_Angeles',seasonYear:2026});
  insert('app_clubs',{id:'club',name:'Synthetic club'});
  for(const team of ['team','other-team'])insert('team_profiles',{app_team_id:team,club_id:'club',kind:'own'});
  const nativeTeam=(provider,native_id,name,details={})=>({provider,native_id,name,details});
  const nativeEvent=(provider,native_id,home_id,away_id,overrides={})=>({provider,native_id,home_id,away_id,type:'game',status:'SCHEDULED',starts_at:'2026-10-12T18:00:31Z',payload:{home_name:'Synthetic home',away_name:'Cedar Heat FC U11 Central',venue:'Juniper Ridge Sports Complex',orientation_verified:true,opponent_id:'41',home_real:true,away_real:true,notes:'Synthetic private arrival note',availability_enabled:true,reported_scores:{home:9,away:9}},...overrides});
  const tsPage={provider:'teamsnap',component:'events',accountId:'account',generation:1,records:{
    teams:[nativeTeam('teamsnap','101','Synthetic home',{account_owned:true,season_start_date:'2026-06-01',season_end_date:'2027-05-31'}),nativeTeam('teamsnap','999','Synthetic wrong team',{account_owned:true})],
    players:[{provider:'teamsnap',native_id:'601',name:'Synthetic player',jersey:'7',details:{season_start_date:'2026-06-01',season_end_date:'2027-05-31'}}],
    team_players:[{team_id:'teamsnap:101',player_id:'teamsnap:601',active:true}],
    attendance:[{account_id:'account',team_id:'teamsnap:101',fixture_id:'teamsnap:401',player_id:'teamsnap:601',status_code:1}],
  },fixtures:[nativeEvent('teamsnap','401','teamsnap:101',null),nativeEvent('teamsnap','402','teamsnap:999',null,{payload:{home_name:'Wrong team',away_name:'SECRET_WRONG_TEAM',venue:'Juniper Ridge Sports Complex'}})]};
  const publicPage={provider:'gotsport',component:'history',records:{teams:[nativeTeam('gotsport','201','Synthetic home'),nativeTeam('gotsport','202','Cedar Heat FC U11 BOYS Central')]},fixtures:[]};
  await domain.ingestSourcePage(tsPage);
  await domain.ingestSourcePage(publicPage);
  await domain.ingestSourcePage({provider:'teamsnap',component:'events',accountId:'foreign-account',generation:1,records:{teams:[nativeTeam('teamsnap','101','Synthetic foreign account',{account_owned:true})]},fixtures:[nativeEvent('teamsnap','401','teamsnap:101',null,{payload:{home_name:'Foreign account',away_name:'SECRET_FOREIGN_ACCOUNT',venue:'Juniper Ridge Sports Complex'}})]});
  for(const [id,source,account] of [['ts-root',TS_TEAM,'account'],['public-root',PUBLIC_TEAM,null]]){
    insert('team_source_attachments',{id:'attachment-'+id,app_team_id:'team',team_season_id:'season',source_team_id:source,account_id:account});
    insert('team_source_connections',{id,app_team_id:'team',source_team_id:source,account_id:account,scope_mode:'fixed_seasons',created_at:AT});
    insert('team_connection_seasons',{connection_id:id,team_season_id:'season',attachment_id:'attachment-'+id,basis:'fixed'});
  }
  const reconcile=async()=>{for(const id of ['ts-root','public-root'])await settle(checkpoint=>buildConnectionPage(db,{connectionId:id,teamId:'team',generation:1,checkpoint}),'root '+id);};
  const project=()=>settle(checkpoint=>domain.buildProjectionPage('team','season',checkpoint),'team projection');
  const completeCoverage=async()=>{
    sql.exec('DELETE FROM sync_job_subscribers;DELETE FROM sync_jobs;DELETE FROM source_component_coverage');
    for(const [root,provider,native,components] of [['ts-root','teamsnap','101',['events']],['public-root','gotsport','201',['profile','catalog','history']]])for(const component of components){
      const account=provider==='teamsnap'?'account':null,id=provider+'-'+component,scope=account?'teamsnap:'+native:native,args={team_id:native};
      const count=rows('SELECT COUNT(*) n FROM source_event_teams WHERE source_team_id=?',account?TS_TEAM:PUBLIC_TEAM)[0].n;
      let checkpoint={finished:true};
      if(account){const {refresh}=await beginTeamSnapRefresh({kind:'events',teamId:native,accountId:account,authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args,now:NOW-3600000});checkpoint=finishTeamSnapRefresh(refresh,{count,pages:1,digest:'a'.repeat(64),total:count,now:NOW-3500000});}
      insert('sync_jobs',{id,provider,account_scope:account??'public',account_id:account,authorization_generation:account?1:0,component,scope,resource_key:scope,args:JSON.stringify(args),checkpoint:JSON.stringify(checkpoint),scan_id:'scan-'+id,state:'ready',coverage:'complete',ready_since:NOW,next_at:NOW+3600000,interval_ms:3600000,last_complete_at:NOW});
      insert('sync_job_subscribers',{job_id:id,kind:'team',demand_key:'connection:'+root,app_team_id:'team',generation:1});
      insert('source_component_coverage',{id:'coverage-'+id,provider,scope,account_id:account,kind:component,complete:1,record_count:count,scan_id:'scan-'+id,observed_at:AT});
    }
    insert('source_component_coverage',{id:'attendance-coverage',provider:'teamsnap',scope:'teamsnap:101',account_id:'account',kind:'attendance',complete:1,record_count:1,scan_id:'attendance-scan',observed_at:AT});
  };
  const options={now:()=>NOW,cursor:new CursorCodec(new Uint8Array(32).fill(4))},sync={enqueueProjection:async()=>({queued:true}),wake:async()=>{}};
  const reads=new ReadRepository(db,{owner:true},options),analysis=new AnalysisReads(db,{owner:true},options);
  const features=new FeatureReads(db,{owner:true},{...options,analysisReads:analysis});
  const bookmarks=new TeamFeatures(db,{owner:true},options),editor=new EventEditor(db,{owner:true},{reads:features,sync});
  const decisions=new TeamGameDecisions(db,{...options,actor:{owner:true},principal:{role:'owner',session_id:'session'},sync});
  const reports=new ReportingService(db,options);
  const analyze=eventId=>settle(cursor=>buildMatchAnalysisPage(db,{teamId:'team',seasonId:'season',eventId,cursor}),'analysis');
  const decide=async(review,decision)=>decisions.decide({...INPUT,source_ids:review.source_ids,association_id:review.association_id,head_revision:review.head_revision,owner_revision:review.owner_revision,review_token:review.review_token,decision,request_id:crypto.randomUUID(),confirmation:decision==='accepted'?'same_game_for_this_team':'keep_separate_for_this_team'});
  const currentMembers=()=>rows('SELECT m.* FROM team_game_source_rows m JOIN team_projection_state p ON p.published_run_id=m.run_id WHERE p.app_team_id=? AND p.team_season_id=? ORDER BY m.source_event_id','team','season');
  return {db,sql,rows,insert,domain,nativeEvent,publicPage,reconcile,project,completeCoverage,reads,analysis,features,bookmarks,editor,decisions,reports,analyze,decide,currentMembers,maxBatch:()=>maxBatch};
}

test('typed ingestion to joined publication and shared consumers survives owner rejection, reacceptance and revocation',async t=>{
  const f=await workflowFixture(t);
  const authorityGaps=[];
  await f.completeCoverage();
  await f.reconcile();
  await f.project();
  const original=f.rows('SELECT event_id FROM event_source_links WHERE source_event_id=?',TS)[0].event_id;
  const player=f.rows('SELECT player_id FROM player_source_links WHERE source_player_id=?',sourceKey('teamsnap','601','account'))[0].player_id;
  assert.equal(f.rows('SELECT * FROM team_events WHERE app_team_id=?','team').length,1);
  let edit=await f.editor.read(INPUT,original);
  await f.bookmarks.bookmark('team',original,true,{game_scope_revision:edit.game_scope_revision});
  await f.editor.save({...INPUT,game_scope_revision:edit.game_scope_revision},original,{home_score:2,away_score:1},0);
  await f.reconcile();
  await f.project();
  for(const [kind,player_id,fields] of [['match','',{format:7,duration_minutes:50}],['player_match',player,{appearance:true,minutes:25,goals:1,assists:0}]])f.insert('analysis_overrides',{app_team_id:'team',team_season_id:'season',event_id:original,kind,player_id,fields:JSON.stringify(fields),revision:1,updated_at:AT});
  const savedState=()=>({bookmarks:f.rows('SELECT * FROM game_bookmarks'),corrections:f.rows('SELECT * FROM domain_overrides'),analysis:f.rows('SELECT * FROM analysis_overrides ORDER BY kind')});
  const saved=savedState();
  await f.domain.ingestSourcePage({...f.publicPage,fixtures:[f.nativeEvent('gotsport','501','gotsport:201','gotsport:202',{starts_at:'2026-10-12T18:00:00Z',status:'FINAL',home_score:2,away_score:1,payload:{home_name:'Synthetic home',away_name:'Cedar Heat FC U11 BOYS Central',venue:'Juniper-Ridge Soccer Complex Field 01 South',home_real:true,away_real:true,orientation_verified:true}})]});
  await f.completeCoverage();
  await f.reconcile();
  const publicOriginal=f.rows('SELECT event_id FROM event_source_links WHERE source_event_id=?',PUBLIC)[0].event_id;
  const nativeSources=f.rows('SELECT * FROM source_events ORDER BY id'),nativeLinks=f.rows('SELECT * FROM event_source_links ORDER BY source_event_id');
  const publicHistory=()=>f.rows('WITH '+publicEventsCTE()+' SELECT id,source_event_id,provider,starts_at,status,home_score,away_score,title,venue FROM e','other-team','other-season');
  const publicBefore=publicHistory();
  assert.equal(publicBefore.length,1);
  assert.equal(publicBefore[0].source_event_id,PUBLIC);
  const candidates=await loadTeamGameCandidates(f.db,{teamId:'team',seasonId:'season',canonicalEventIds:[original],now:NOW});
  assert.equal(candidates.complete,true);
  assert.deepEqual(candidates.rawRows.map(row=>row.id).sort(),[PUBLIC,TS].sort());
  assert.equal(JSON.stringify(candidates).includes('SECRET_'),false);
  await f.project();
  edit=await f.editor.read(INPUT,PUBLIC);
  await f.editor.save({...INPUT,game_scope_revision:edit.game_scope_revision},PUBLIC,{home_score:2,away_score:1},1);
  assert.equal(f.rows('SELECT entity_id FROM domain_overrides')[0].entity_id,original,'editing a public source preserves the sole original correction key');
  saved.corrections=f.rows('SELECT * FROM domain_overrides');
  await f.reconcile();
  await f.project();
  await f.analyze(original);
  const association=f.rows('SELECT * FROM team_game_associations')[0];
  assert.equal(association.target_event_id,original);
  assert.equal(f.rows('SELECT authority FROM team_game_decision_revisions WHERE revision=1')[0].authority,'matcher');
  assert.deepEqual(f.currentMembers().map(row=>row.source_event_id),[PUBLIC,TS].sort());
  assert.deepEqual(new Set(f.currentMembers().map(row=>row.original_event_id)),new Set([original,publicOriginal]));
  assert.ok(f.currentMembers().every(row=>row.entitlement_kind==='root'&&row.connection_generation===1));

  async function joinedConsumers(){
    const schedule=await f.reads.schedule(INPUT);
    assert.equal(schedule.data.items.length,1);
    assert.equal(schedule.data.items[0].id,original);
    const published=f.rows('SELECT * FROM team_events WHERE app_team_id=?','team')[0];
    assert.equal(published.schedule_source_id,PUBLIC);
    assert.equal(published.result_source_id,PUBLIC);
    if(Date.parse(published.starts_at)!==Date.parse('2026-10-12T18:00:00Z'))authorityGaps.push({schedule_source_id:published.schedule_source_id,starts_at:published.starts_at,expected:'2026-10-12T18:00:00.000Z'});
    if(published.venue!=='Juniper-Ridge Soccer Complex Field 01 South')authorityGaps.push({schedule_source_id:published.schedule_source_id,venue:published.venue,expected:'Juniper-Ridge Soccer Complex Field 01 South'});
    assert.equal(published.status,'FINAL');
    assert.deepEqual([published.home_score,published.away_score],[2,1]);
    const token=schedule.data.items[0].game_scope_revision;
    for(const reference of [TS,PUBLIC,original,publicOriginal]){
      const game=await resolvePublishedGame(f.db,'team','season',reference);
      assert.equal(game.event_id,original);
      assert.deepEqual(game.source_ids,[PUBLIC,TS].sort());
      assert.equal(await gameScopeRevision(game),token);
      const detail=(await f.features.match(INPUT,reference)).data;
      assert.equal(detail.event.id,original);
      assert.equal(detail.attendance.totals.yes,1);
      assert.equal(detail.attendance.coverage,'complete');
      assert.equal(detail.players.items.length,1);
      assert.equal(detail.players.items[0].minutes,25);
      assert.equal(detail.players.items[0].goals,1);
      assert.equal(detail.h2h.events.total,1);
      assert.equal(detail.h2h.events.items[0].id,publicOriginal);
      assert.equal(JSON.stringify(detail.h2h).includes('Synthetic private arrival note'),false);
      const owner=await f.editor.read(INPUT,reference);
      assert.equal(owner.id,original);
      assert.deepEqual(owner.override,{home_score:2,away_score:1});
    }
    const summary=(await f.analysis.summary(INPUT,player)).data;
    assert.equal(summary.minutes,25);
    assert.equal(summary.goals,1);
    const profile=(await f.analysis.player(INPUT,player)).data;
    assert.equal(profile.matches.total,1);
    assert.equal(profile.matches.items[0].event_id,original);
    assert.equal(profile.spatial.state,'unavailable','manual stats do not invent native spatial analytics');
    const bookmark=await f.bookmarks.bookmarks('team',{period:'all'});
    assert.equal(bookmark.events.items.length,1);
    assert.deepEqual(bookmark.events.items[0].saved_event_ids,[original]);
    for(const type of ['matches','players','availability']){
      const report=await f.reports.create(INPUT,{type});
      assert.equal(report.data.state,'ready');
      assert.equal(report.data.rows.total,1);
      if(type==='matches'){assert.equal(report.data.rows.items[0]._report_id,original);assert.equal(report.data.rows.items[0].attendance,'100%');}
      if(type==='players'){assert.equal(report.data.rows.items[0].minutes,25);assert.equal(report.data.rows.items[0].goals,1);}
    }
    assert.deepEqual(publicHistory(),publicBefore,'public H2H/history remains provider-native and public-only');
    assert.deepEqual(savedState(),saved,'physical original owner keys and bytes survive grouping');
    assert.deepEqual(f.rows('SELECT * FROM source_events ORDER BY id'),nativeSources);
    assert.deepEqual(f.rows('SELECT * FROM event_source_links ORDER BY source_event_id'),nativeLinks);
    assert.equal(f.rows('SELECT * FROM event_aliases').length,0);
  }
  await joinedConsumers();

  await assert.rejects(f.decisions.review({...INPUT,team_id:'other-team',team_season_id:'other-season',source_ids:[TS,PUBLIC]}),error=>error.status===403);
  await assert.rejects(f.decisions.review({...INPUT,source_ids:[sourceKey('teamsnap','401','foreign-account'),PUBLIC]}),error=>error.status===403);
  await assert.rejects(f.decisions.review({...INPUT,source_ids:[sourceKey('teamsnap','402','account'),PUBLIC]}),error=>error.status===403);
  assert.equal(await resolvePublishedGame(f.db,'other-team','other-season',TS),null);
  const review=()=>f.decisions.review({...INPUT,association_id:association.association_id});
  await f.decide(await review(),'rejected');
  assert.equal((await resolvePublishedGame(f.db,'team','season',PUBLIC)).available,false);
  await f.project();
  const split=(await f.reads.schedule(INPUT)).data.items;
  assert.equal(split.length,2);
  assert.deepEqual(new Set(split.map(row=>row.id)),new Set([original,publicOriginal]));
  assert.equal((await f.features.match(INPUT,original)).data.attendance.totals.yes,1);
  assert.equal((await f.features.match(INPUT,publicOriginal)).data.attendance.coverage,'untracked');
  assert.equal((await f.editor.read(INPUT,original)).revision,2);
  assert.equal((await f.editor.read(INPUT,publicOriginal)).revision,0);
  assert.deepEqual(savedState(),saved);
  const rejectedRun=f.rows('SELECT published_run_id FROM team_projection_state WHERE team_season_id=?','season')[0].published_run_id;
  const reaccept=await review();
  assert.equal(reaccept.can_accept,true,JSON.stringify(reaccept.reasons));
  await f.decide(reaccept,'accepted');
  assert.equal(f.rows('SELECT published_run_id FROM team_projection_state WHERE team_season_id=?','season')[0].published_run_id,rejectedRun);
  const awaitingPublication=await resolvePublishedGame(f.db,'team','season',PUBLIC);
  assert.equal(awaitingPublication.event_id,publicOriginal,'reaccept must not expose the joined target before publication');
  assert.deepEqual(awaitingPublication.source_ids,[PUBLIC]);
  assert.equal((await f.reads.schedule(INPUT)).data.items.length,2);
  await f.project();
  assert.notEqual(f.rows('SELECT published_run_id FROM team_projection_state WHERE team_season_id=?','season')[0].published_run_id,rejectedRun);
  await f.analyze(original);
  await joinedConsumers();
  assert.deepEqual(f.rows("SELECT decision FROM team_game_decision_revisions WHERE authority='owner' ORDER BY revision").map(row=>row.decision),['rejected','accepted']);

  f.sql.exec("UPDATE team_source_connections SET active=0 WHERE id='ts-root';UPDATE team_projection_state SET pending=1,input_revision=input_revision+1 WHERE team_season_id='season';UPDATE team_read_state SET pending=1 WHERE app_team_id='team'");
  assert.equal((await resolvePublishedGame(f.db,'team','season',PUBLIC)).available,false);
  const revoked=await review();
  assert.equal(revoked.can_accept,false);
  assert.deepEqual(revoked.evidence,[]);
  await f.project();
  assert.deepEqual(f.currentMembers().map(row=>row.source_event_id),[PUBLIC]);
  const savedEditor=await f.editor.read(INPUT,original);
  assert.equal(savedEditor.state_only,true);
  assert.equal(savedEditor.can_edit,false);
  assert.deepEqual(savedState(),saved);
  const publicDetail=(await f.features.match(INPUT,publicOriginal)).data;
  assert.equal(publicDetail.attendance.coverage,'untracked');
  assert.equal(JSON.stringify(publicDetail).includes('Synthetic private arrival note'),false);
  assert.deepEqual(publicHistory(),publicBefore);
  await f.bookmarks.bookmark('team',original,false);
  assert.equal(f.rows('SELECT * FROM game_bookmarks').length,0,'exact original bookmark key remains removable after revocation');
  assert.deepEqual(f.rows('SELECT * FROM domain_overrides'),saved.corrections);
  assert.deepEqual(f.rows('SELECT * FROM source_events ORDER BY id'),nativeSources);
  assert.deepEqual(f.rows('SELECT * FROM event_source_links ORDER BY source_event_id'),nativeLinks);
  assert.deepEqual(f.rows('PRAGMA foreign_key_check'),[]);
  assert.ok(f.maxBatch()<=48);
  t.diagnostic('Synthetic typed-page ingestion; real root/projector/consumer/owner-command workflow. No HTTP collectors, native D1, cross-season transition, or production access.');
  assert.deepEqual(authorityGaps,[],'the published kickoff and venue must use their declared public schedule authority');
});
