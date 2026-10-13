import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture as candidateFixture} from './team-game-candidates.test.mjs';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {COACH_SCHEMA} from '../src/coaching/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {buildProjectionPage} from '../src/domain/projector.js';
import {prepareTeamGameProjection,stageTeamGameProjection,addTeamGamePublicationAssertions,pinTeamGameAccepted,applyTeamGameOwnerValueConflicts} from '../src/domain/team-game-projection.js';
const NOW=Date.parse('2026-10-13T00:00:00Z');
export async function fixture(t,options={}){
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const f=await candidateFixture(options);t.after(()=>f.close());
  for(const sql of [...ANALYSIS_SCHEMA,...COACH_SCHEMA,...TEAM_FEATURE_SCHEMA])f.sqlite.exec(sql);
  const execute=statements=>{assert.ok(statements.length<=40,'bounded write envelope');f.sqlite.exec('BEGIN');try{for(const {sql,params}of statements)f.sqlite.prepare(sql.replaceAll('$FENCE','1')).run(...params);f.sqlite.exec('COMMIT');}catch(e){f.sqlite.exec('ROLLBACK');throw e;}};
  const team=async()=>({...f.sqlite.prepare("SELECT * FROM app_teams WHERE id='team'").get(),season_id:'season'});
  const repo={db:f.db,team};
  const build=async(checkpoint={})=>{for(let i=0;i<100;i++){const before=f.reads.length;const page=await buildProjectionPage(repo,'team','season',checkpoint);if(process.env.PROJECTION_METRICS)console.log('PAGE',checkpoint.phase,f.reads.length-before,page.statements.length);execute(page.statements);checkpoint=page.checkpoint;if(page.complete)return checkpoint;}throw new Error('projection did not settle');};
  const dirty=()=>f.sqlite.exec("UPDATE team_projection_state SET input_revision=input_revision+1,pending=1;UPDATE team_read_state SET pending=1");
  const seed=async()=>{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();for(const id of ['canonical-ts','canonical-pub'])f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:id,team_season_id:'season',state:'resolved',effective_day:'2026-10-12',starts_at:'2026-10-12T18:00:00.000Z',local_day:'2026-10-12',basis:'native',evidence:'{}'});};
  return {...f,execute,repo,team,build,dirty,seed,rows:(sql,...p)=>f.sqlite.prepare(sql).all(...p).map(r=>({...r}))};
}
test('ordinary projection publishes one safe group with exact normalized membership and untouched native IDs',async t=>{
 const f=await fixture(t);await f.seed();const originals=f.rows('SELECT * FROM event_source_links');
 await f.build();const rows=f.rows('SELECT * FROM team_events');assert.equal(rows.length,1);assert.deepEqual(JSON.parse(rows[0].source_ids),['pub','ts']);assert.equal(rows[0].event_id,'canonical-ts');
 assert.equal(f.rows('SELECT * FROM team_game_source_rows').length,2);assert.equal(f.rows('SELECT * FROM team_game_publications')[0].disposition,'accepted');
 assert.equal(f.rows('SELECT * FROM team_game_associations')[0].accepted_revision,1);assert.deepEqual(f.rows('SELECT * FROM event_source_links'),originals);
 assert.equal(f.rows('PRAGMA foreign_key_check').length,0);
});
test('legacy attachments produce the same group without invented root authority',async t=>{
 const f=await fixture(t,{legacy:true});await f.seed();await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,1);for(const row of f.rows('SELECT * FROM team_game_source_rows')){assert.equal(row.entitlement_kind,'legacy_attachment');assert.equal(row.connection_id,null);assert.equal(row.membership_generation,null);}
});
test('native singleton publishes a version-one normalized member with incomplete inference evidence',async t=>{
 const f=await fixture(t);f.event('ts');f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:'canonical-ts',team_season_id:'season',state:'resolved',effective_day:'2026-10-12',starts_at:'2026-10-12T18:00:00.000Z',local_day:'2026-10-12',basis:'native',evidence:'{}'});await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.equal(f.rows('SELECT * FROM team_game_source_rows').length,1);assert.equal(f.rows('SELECT * FROM team_game_publications').length,0);assert.equal(f.rows("SELECT team_game_version FROM team_projection_runs WHERE state='published'")[0].team_game_version,1);
});
test('version-zero building checkpoint restarts and old published version-zero remains readable',async t=>{
 const f=await fixture(t);f.insert('team_projection_runs',{id:'old',app_team_id:'team',team_season_id:'season',input_revision:0,state:'building',created_at:new Date().toISOString()});const page=await buildProjectionPage(f.repo,'team','season',{runId:'old',phase:'events'});f.execute(page.statements);assert.notEqual(page.checkpoint.runId,'old');assert.equal(f.rows("SELECT state FROM team_projection_runs WHERE id='old'")[0].state,'obsolete');assert.equal(f.rows('SELECT team_game_version FROM team_projection_runs WHERE id=?',page.checkpoint.runId)[0].team_game_version,1);
});
test('unchanged and freshness-only repeat reuses semantic decision and stable target',async t=>{
 const f=await fixture(t);await f.seed();await f.build();const prior=f.rows('SELECT association_id,head_revision,accepted_revision FROM team_game_associations');await f.complete({recent:true});f.dirty();await f.build();assert.deepEqual(f.rows('SELECT association_id,head_revision,accepted_revision FROM team_game_associations'),prior);assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.equal(f.rows('SELECT * FROM team_game_decision_revisions').length,1);
});
test('independent bookmarks prevent automatic state collapse and remain byte-identical',async t=>{
 const f=await fixture(t);await f.seed();for(const event_id of ['canonical-ts','canonical-pub'])f.insert('game_bookmarks',{app_team_id:'team',event_id,snapshot:JSON.stringify({title:event_id}),saved_at:new Date().toISOString()});const saved=f.rows('SELECT * FROM game_bookmarks');await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,2);assert.equal(f.rows('SELECT * FROM team_game_source_rows').length,2);assert.deepEqual(f.rows('SELECT * FROM game_bookmarks'),saved);
});
test('a same-minute competitor beyond the requested native page blocks grouping',async t=>{
 const f=await fixture(t);await f.seed();f.event('zzz-other',{provider:'gotsport',opponent:'Totally Unrelated'});await f.complete();await f.build();assert.equal(f.rows('SELECT * FROM team_game_associations').length,0);assert.equal(f.rows('SELECT * FROM team_events').length,2);
});
async function ownerReject(f){
 const a=f.rows('SELECT * FROM team_game_associations')[0],prior=f.rows('SELECT * FROM team_game_decision_revisions WHERE association_id=? AND revision=?',a.association_id,a.head_revision)[0],revision=a.head_revision+1;
 f.insert('team_game_decision_revisions',{...prior,revision,authority:'owner',decision:'rejected',algorithm_version:'owner-command-v1',request_id:'reject-pair',request_hash:'b'.repeat(64),predecessor_revision:a.head_revision});
 f.sqlite.prepare('UPDATE team_game_associations SET head_revision=?,owner_revision=? WHERE association_id=?').run(revision,revision,a.association_id);f.dirty();return {associationId:a.association_id,revision};
}
export async function until(f,phase,cp={}){for(let i=0;i<100;i++){if(cp.phase===phase)return cp;const page=await buildProjectionPage(f.repo,'team','season',cp);f.execute(page.statements);cp=page.checkpoint;}throw new Error('phase not reached');}
test('owner rejection survives repeat projection and becomes an exact state-only hold',async t=>{
 const f=await fixture(t);await f.seed();await f.build();const rejection=await ownerReject(f);await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,2);assert.equal(f.rows('SELECT * FROM team_game_publications')[0].disposition,'state_hold');
 assert.equal(f.rows('SELECT * FROM team_game_associations')[0].owner_revision,rejection.revision);assert.equal(f.rows('SELECT * FROM team_game_associations')[0].accepted_revision,1);
 const head=f.rows('SELECT head_revision FROM team_game_associations')[0].head_revision;f.dirty();await f.build();assert.equal(f.rows('SELECT head_revision FROM team_game_associations')[0].head_revision,head);assert.equal(f.rows('SELECT * FROM team_events').length,2);
});
test('one-sided reschedule retains accepted target and complete original placement under review',async t=>{
 const f=await fixture(t);await f.seed();await f.build();f.sqlite.exec("UPDATE source_events SET starts_at='2027-07-12T18:00:00.000Z',content_hash='moved' WHERE id='ts';DELETE FROM team_event_season_resolutions WHERE event_id='canonical-ts'");f.dirty();await f.build();
 const row=f.rows('SELECT * FROM team_events')[0];assert.equal(row.event_id,'canonical-ts');assert.equal(row.starts_at,'2026-10-12T18:00:00.000Z');assert.equal(row.local_day,'2026-10-12');assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.equal(f.rows('SELECT * FROM team_game_publications')[0].disposition,'review');assert.equal(f.rows('SELECT accepted_revision FROM team_game_associations')[0].accepted_revision,1);
});
test('revoking private scope removes membership and keeps owned saved-state locator',async t=>{
 const f=await fixture(t);await f.seed();f.insert('game_bookmarks',{app_team_id:'team',event_id:'canonical-ts',snapshot:'{"title":"saved"}',saved_at:new Date().toISOString()});await f.build();f.sqlite.exec("UPDATE team_source_connections SET active=0 WHERE id='ts';DELETE FROM team_event_season_resolutions WHERE event_id='canonical-ts'");f.dirty();await f.build();
 assert.deepEqual(f.rows('SELECT source_event_id FROM team_game_source_rows'),[{source_event_id:'pub'}]);const p=f.rows('SELECT * FROM team_game_publications')[0];assert.equal(p.disposition,'state_hold');assert.ok(JSON.parse(p.state_scope_roots).includes('canonical-ts'));assert.equal(f.rows('SELECT * FROM game_bookmarks').length,1);
});
test('state insertion after assessment rolls back the entire staged page',async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'events');const page=await buildProjectionPage(f.repo,'team','season',cp);f.insert('game_bookmarks',{app_team_id:'team',event_id:'canonical-pub',snapshot:'{}',saved_at:new Date().toISOString()});assert.throws(()=>f.execute(page.statements),/CHECK constraint/);assert.equal(f.rows('SELECT * FROM team_game_associations').length,0);assert.equal(f.rows('SELECT * FROM team_event_rows').length,0);
});
test('changed job generation behind the cursor restarts instead of pinning stale authority forever',async t=>{
 const f=await fixture(t);await f.seed();let cp=await until(f,'publish');f.sqlite.exec("UPDATE sync_jobs SET generation=generation+1 WHERE provider='gotsport' AND component='history'");const page=await buildProjectionPage(f.repo,'team','season',cp);f.execute(page.statements);assert.deepEqual(page.checkpoint,{});assert.equal(f.rows('SELECT * FROM team_events').length,0);await f.build(page.checkpoint);assert.equal(f.rows('SELECT * FROM team_events').length,1);
});
test('global unrelated mutation and ordinary status churn do not restart a team build',async t=>{
 const f=await fixture(t);await f.seed();let cp={};for(let i=0;i<30;i++){const page=await buildProjectionPage(f.repo,'team','season',cp);f.execute(page.statements);cp=page.checkpoint;f.sqlite.exec('UPDATE domain_installation SET source_revision=source_revision+1,mutation_revision=mutation_revision+1;UPDATE team_read_state SET status_revision=status_revision+1');if(page.complete)break;assert.ok(i<29);}
 assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.equal(f.rows("SELECT * FROM team_projection_runs WHERE state='obsolete'").length,0);
});
test('lost acknowledgment at staged and published boundaries is idempotent',async t=>{
 const f=await fixture(t);await f.seed();let cp=await until(f,'events');let p=await buildProjectionPage(f.repo,'team','season',cp);f.execute(p.statements);p=await buildProjectionPage(f.repo,'team','season',cp);f.execute(p.statements);assert.equal(f.rows('SELECT * FROM team_game_decision_revisions').length,1);cp=await until(f,'publish',p.checkpoint);p=await buildProjectionPage(f.repo,'team','season',cp);f.execute(p.statements);const accepted=f.rows('SELECT * FROM team_game_associations');p=await buildProjectionPage(f.repo,'team','season',cp);f.execute(p.statements);assert.equal(p.checkpoint.phase,'cleanup');assert.deepEqual(f.rows('SELECT * FROM team_game_associations'),accepted);assert.equal(f.rows("SELECT * FROM team_projection_runs WHERE state='published'").length,1);
});
test('24 disconnected safe neighborhoods do not become an artificial Cartesian assessment overflow',async t=>{
 const f=await fixture(t);for(let i=0;i<24;i++){const day=String(i+1).padStart(2,'0'),start=`2026-10-${day}T18:00:00.000Z`;for(const [prefix,provider]of [['a-public','gotsport'],['z-private','teamsnap']]){const event=f.event(prefix+i,{provider,start});f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:event,team_season_id:'season',state:'resolved',effective_day:`2026-10-${day}`,starts_at:start,local_day:`2026-10-${day}`,basis:'native',evidence:'{}'});}}await f.complete();await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,24);assert.equal(f.rows('SELECT * FROM team_game_source_rows').length,48);assert.equal(f.rows('SELECT * FROM team_game_associations').length,24);assert.ok(f.rows('SELECT disposition FROM team_game_publications').every(p=>p.disposition==='accepted'));
});
test('state reference overflow retains native rows and an explicit complete original-key locator',async t=>{
 const f=await fixture(t);await f.seed();f.insert('coach_sessions',{app_team_id:'team',team_season_id:'season',event_id:'canonical-ts',format:7,half_minutes:25,phase:'setup',period:1,elapsed_ms:0,period_start_ms:0,revision:1,updated_at:new Date().toISOString(),write_token:'test'});
 for(let i=0;i<260;i++)f.insert('coach_timeline',{id:'timeline-'+i,app_team_id:'team',team_season_id:'season',event_id:'canonical-ts',sequence:i,kind:'note',period:1,match_ms:0,recorded_at:new Date().toISOString(),detail:'{}'});
 await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,2);const p=f.rows('SELECT * FROM team_game_publications')[0];assert.equal(p.disposition,'state_hold');assert.equal(p.state_refs_complete,0);assert.equal(p.state_refs,'[]');assert.deepEqual(JSON.parse(p.state_scope_roots),['canonical-pub','canonical-ts']);assert.equal(f.rows('SELECT * FROM coach_timeline').length,260);
});
test('history pruning retains owner intent, published acceptance and32 unpinned records',async t=>{
 const f=await fixture(t);await f.seed();await f.build();await ownerReject(f);await f.build();const a=f.rows('SELECT * FROM team_game_associations')[0],template=f.rows('SELECT * FROM team_game_decision_revisions WHERE revision=?',a.head_revision)[0];
 for(let revision=a.head_revision+1;revision<=a.head_revision+45;revision++){f.insert('team_game_decision_revisions',{...template,revision,predecessor_revision:revision-1,semantic_hash:String(revision).padStart(64,'0')});f.sqlite.prepare('UPDATE team_game_associations SET head_revision=? WHERE association_id=?').run(revision,a.association_id);}
 await f.build({phase:'cleanup'});const after=f.rows('SELECT * FROM team_game_associations')[0];assert.equal(after.owner_revision,2);assert.equal(after.accepted_revision,1);assert.equal(after.head_revision,a.head_revision+45);const revisions=f.rows('SELECT revision FROM team_game_decision_revisions').map(r=>r.revision);assert.ok(revisions.includes(1)&&revisions.includes(2)&&revisions.includes(a.head_revision));assert.ok(revisions.length<=36);assert.equal(f.rows('PRAGMA foreign_key_check').length,0);
});
test('new legacy competitor behind the cursor is detected without trusting global freshness counters',async t=>{
 const f=await fixture(t,{legacy:true});await f.seed();let cp=await until(f,'publish');f.event('late-public',{provider:'gotsport',opponent:'Unrelated'});const page=await buildProjectionPage(f.repo,'team','season',cp);f.execute(page.statements);assert.deepEqual(page.checkpoint,{});assert.equal(f.rows('SELECT * FROM team_events').length,0);await f.build(page.checkpoint);assert.equal(f.rows("SELECT * FROM team_game_publications WHERE disposition='accepted'").length,0);
});
test('a pre-existing native Trace member stays normalized in its unchanged native group',async t=>{
 const f=await fixture(t);f.insert('provider_accounts',{id:'trace-account',provider:'trace',native_id:'91',name:'Trace'});f.source('trace-team','trace','trace-account');f.connect('trace','trace-team','trace-account');
 f.event('ts');f.event('trace',{provider:'trace',own:'trace-team',account:'trace-account',canonical:'canonical-ts'});f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:'canonical-ts',team_season_id:'season',state:'resolved',effective_day:'2026-10-12',starts_at:'2026-10-12T18:00:00.000Z',local_day:'2026-10-12',basis:'native',evidence:'{}'});await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.deepEqual(JSON.parse(f.rows('SELECT source_ids FROM team_events')[0].source_ids),['trace','ts']);assert.equal(f.rows('SELECT * FROM team_game_source_rows').length,2);assert.equal(f.rows('SELECT * FROM team_game_associations').length,0);
});
test('a cross-season move without an entitled destination retains the accepted old placement',async t=>{
 const f=await fixture(t);await f.seed();await f.build();
 f.sqlite.exec("UPDATE source_events SET starts_at='2027-07-12T18:00:00.000Z',content_hash='moved-'||id;UPDATE team_event_season_resolutions SET starts_at='2027-07-12T18:00:00.000Z',effective_day='2027-07-12',local_day='2027-07-12'");f.dirty();await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.equal(f.rows('SELECT local_day FROM team_events')[0].local_day,'2026-10-12');assert.equal(f.rows('SELECT * FROM team_game_publish_batches').length,0);assert.equal(f.rows('SELECT accepted_revision FROM team_game_associations')[0].accepted_revision,1);
});

test('publication fence hash covers its exact owner-qualified stored receipt and state refs omit owner payload',async t=>{
 const f=await fixture(t);await f.seed();f.insert('game_bookmarks',{app_team_id:'team',event_id:'canonical-ts',snapshot:'{"private_note":"NEVER_COPY_OWNER_PAYLOAD"}',saved_at:new Date().toISOString()});await f.build();
 const p=f.rows('SELECT * FROM team_game_publications')[0],ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
 assert.equal(p.fence_hash,createHash('sha256').update(JSON.stringify(ordered(JSON.parse(p.fence)))).digest('hex'));assert.ok(!JSON.stringify(f.rows('SELECT * FROM team_game_decision_revisions')).includes('NEVER_COPY_OWNER_PAYLOAD'));assert.ok(!p.state_refs.includes('NEVER_COPY_OWNER_PAYLOAD'));assert.ok(f.rows('SELECT snapshot FROM game_bookmarks')[0].snapshot.includes('NEVER_COPY_OWNER_PAYLOAD'));
});


test('owner request replay identity survives more than32 later matcher revisions and repeated pruning',async t=>{
 const f=await fixture(t);await f.seed();await f.build();await ownerReject(f);
 const original=f.rows("SELECT * FROM team_game_decision_revisions WHERE request_id='reject-pair'")[0];
 const revision=3;f.insert('team_game_decision_revisions',{...original,revision,request_id:'second-owner-intent',request_hash:'c'.repeat(64),predecessor_revision:2});f.sqlite.prepare('UPDATE team_game_associations SET head_revision=?,owner_revision=? WHERE association_id=?').run(revision,revision,original.association_id);
 await f.build();const a=f.rows('SELECT * FROM team_game_associations')[0],template=f.rows('SELECT * FROM team_game_decision_revisions WHERE revision=?',a.head_revision)[0];
 for(let revision=a.head_revision+1;revision<=a.head_revision+45;revision++){f.insert('team_game_decision_revisions',{...template,revision,predecessor_revision:revision-1,semantic_hash:String(revision).padStart(64,'0')});f.sqlite.prepare('UPDATE team_game_associations SET head_revision=? WHERE association_id=?').run(revision,a.association_id);}
 await f.build({phase:'cleanup'});await f.build({phase:'cleanup'});
 assert.deepEqual(f.rows("SELECT * FROM team_game_decision_revisions WHERE app_team_id='team' AND request_id='reject-pair'"),[original]);assert.equal(f.rows("SELECT COUNT(*) n FROM team_game_decision_revisions WHERE authority='owner'")[0].n,2);assert.ok(f.rows("SELECT * FROM team_game_decision_revisions WHERE authority='matcher'").length<=35);assert.deepEqual(f.rows('PRAGMA foreign_key_check'),[]);
});


test('manual identity confirmation leaves contradictory result dimensions unresolved until explicit corrections',()=>{
 const value={identity_conflict:0,result_conflict:0,status:'FINAL',home_score:4,away_score:2,goals_for:4,goals_against:2};
 const assessment=conflicts=>[{decision:'accepted',evidence:{owner_confirmation:{policy:'owner-team-game-v1',value_conflicts:conflicts}}}];
 const score=assessment(['authoritative_final_score_conflict']),status=assessment(['initial_game_status_conflict']);
 let actual=applyTeamGameOwnerValueConflicts(value,{},score);assert.deepEqual(actual,{...value,result_conflict:1,status:'UNKNOWN',home_score:null,away_score:null,goals_for:null,goals_against:null});
 actual=applyTeamGameOwnerValueConflicts(value,{home_score:4,away_score:2},score);assert.deepEqual(actual,value);
 actual=applyTeamGameOwnerValueConflicts(value,{home_score:4,away_score:2},status);assert.equal(actual.status,'UNKNOWN');assert.equal(actual.result_conflict,1);assert.equal(actual.identity_conflict,0);
 actual=applyTeamGameOwnerValueConflicts(value,{status:'FINAL',home_score:4,away_score:2},assessment(['authoritative_final_score_conflict','initial_game_status_conflict']));assert.deepEqual(actual,value);
 actual=applyTeamGameOwnerValueConflicts(value,{home_score:4},score);assert.equal(actual.home_score,null);assert.equal(actual.away_score,null);assert.equal(actual.result_conflict,1);
});

async function ownerConfirm(f){
 const a=f.rows('SELECT * FROM team_game_associations')[0],prior=f.rows('SELECT * FROM team_game_decision_revisions WHERE association_id=? AND revision=?',a.association_id,a.head_revision)[0],revision=a.head_revision+1;
 const proof={...JSON.parse(prior.proof),manual_policy:'owner-team-game-v1',owner_confirmation:'same_game_for_this_team'};
 f.insert('team_game_decision_revisions',{...prior,revision,authority:'owner',decision:'accepted',algorithm_version:'owner-team-game-v1',request_id:'confirm-pair',request_hash:'b'.repeat(64),predecessor_revision:a.head_revision,proof:JSON.stringify(proof)});
 f.sqlite.prepare('UPDATE team_game_associations SET head_revision=?,owner_revision=? WHERE association_id=?').run(revision,revision,a.association_id);f.dirty();
}
for(const publicStatus of ['FINAL','SCHEDULED'])test(`manual confirmed cancelled versus ${publicStatus} publishes identity but requires explicit value correction`,async t=>{
 const f=await fixture(t);await f.seed();await f.build();await ownerConfirm(f);
 f.sqlite.prepare("UPDATE source_events SET status=CASE WHEN id='ts' THEN 'CANCELLED' ELSE ? END,home_score=4,away_score=2,content_hash='changed-'||id").run(publicStatus);f.dirty();await f.build();
 let row=f.rows('SELECT * FROM team_events')[0];assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.equal(row.identity_conflict,0);assert.equal(row.result_conflict,1);assert.equal(row.status,'UNKNOWN');assert.equal(row.home_score,null);assert.equal(row.away_score,null);assert.equal(f.rows('SELECT disposition FROM team_game_publications')[0].disposition,'accepted');
 const proof=JSON.parse(f.rows('SELECT proof FROM team_game_decision_revisions ORDER BY revision DESC LIMIT 1')[0].proof);assert.ok(proof.assessments[0].evidence.owner_confirmation.value_conflicts.includes('initial_game_status_conflict'));
 f.insert('domain_overrides',{app_team_id:'team',kind:'event',entity_id:row.event_id,fields:JSON.stringify({status:'FINAL',home_score:4,away_score:2}),revision:1});f.dirty();await f.build();row=f.rows('SELECT * FROM team_events')[0];assert.equal(row.result_conflict,0);assert.equal(row.status,'FINAL');assert.equal(row.home_score,4);assert.equal(row.away_score,2);assert.equal(row.identity_conflict,0);
});
test('manual confirmed conflicting public finals keep exact native membership and unresolved scores',async t=>{
 const f=await fixture(t);await f.seed();f.event('live-peer',{provider:'live',canonical:'canonical-pub'});f.bridge();
 const current=f.rows("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') at")[0].at;t.mock.timers.setTime(Date.parse(current));f.sqlite.prepare("UPDATE source_team_links SET evidence=json_set(evidence,'$.verified_at',?,'$.expires_at',?,'$.observations[0].at',?,'$.observations[1].at',?)").run(current,new Date(Date.parse(current)+3600000).toISOString(),current,current);
 const job=f.rows("SELECT * FROM sync_jobs WHERE provider='gotsport' AND component='profile'")[0],coverage=f.rows("SELECT * FROM source_component_coverage WHERE provider='gotsport' AND kind='profile'")[0];
 for(const component of ['upcoming','membership']){const id='live-'+component;f.insert('sync_jobs',{...job,id,provider:'live',component,scope:'301',resource_key:'301',args:'{"team_id":"301"}'});f.insert('sync_job_subscribers',{job_id:id,kind:'team',demand_key:'connection:pub',app_team_id:'team',generation:1});f.insert('source_component_coverage',{...coverage,id,provider:'live',kind:component,scope:'301'});}
 f.sqlite.exec("UPDATE source_events SET status='FINAL',home_score=4,away_score=2");await f.build();assert.equal(f.rows('SELECT * FROM team_events').length,1);await ownerConfirm(f);
 f.sqlite.exec("UPDATE source_events SET home_score=1,away_score=1,content_hash='different-official-final' WHERE id='live-peer'");f.dirty();await f.build();
 const row=f.rows('SELECT * FROM team_events')[0];assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.deepEqual(JSON.parse(row.source_ids),['live-peer','pub','ts']);assert.equal(row.identity_conflict,0);assert.equal(row.result_conflict,1);assert.equal(row.status,'UNKNOWN');assert.equal(row.home_score,null);assert.equal(row.away_score,null);assert.equal(f.rows('SELECT disposition FROM team_game_publications')[0].disposition,'accepted');
});

test('unrelated owner-state volume is excluded before bounded scoped materialization',async t=>{
 const f=await fixture(t);await f.seed();f.event('unrelated',{start:'2026-12-01T18:00:00Z'});
 f.insert('coach_sessions',{app_team_id:'team',team_season_id:'season',event_id:'canonical-unrelated',format:7,half_minutes:25,phase:'setup',period:1,elapsed_ms:0,period_start_ms:0,revision:1,updated_at:new Date().toISOString(),write_token:'test'});
 for(let i=0;i<300;i++)f.insert('coach_timeline',{id:'unrelated-state-'+i,app_team_id:'team',team_season_id:'season',event_id:'canonical-unrelated',sequence:i,kind:'note',period:1,match_ms:0,recorded_at:new Date().toISOString(),detail:'{}'});
 await f.complete();await f.build();const publication=f.rows('SELECT * FROM team_game_publications')[0];assert.equal(publication.disposition,'accepted');assert.equal(publication.state_refs,'[]');assert.equal(publication.state_refs_complete,1);assert.equal(f.rows('SELECT COUNT(*) n FROM coach_timeline')[0].n,300);
 const acquisition=f.reads.find(r=>r.sql.includes('owner_state_scope AS MATERIALIZED')&&r.sql.includes('LIMIT 257'));assert.ok(acquisition);assert.ok(acquisition.sql.includes('owned WHERE EXISTS'));assert.ok(acquisition.bytes<16000);
});

for(const field of ['source_universe[0].hash','owner_revision'])test(`one mutated publication ${field} cannot hide behind another publication with the same fence hash`,async t=>{
 const f=await fixture(t);await f.seed();for(const [id,provider] of [['ts2','teamsnap'],['pub2','gotsport']]){const event=f.event(id,{provider,start:'2026-10-13T18:00:00.000Z'});f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:event,team_season_id:'season',state:'resolved',effective_day:'2026-10-13',starts_at:'2026-10-13T18:00:00.000Z',local_day:'2026-10-13',basis:'native',evidence:'{}'});}await f.complete();const cp=await until(f,'publish');
 const rows=f.rows('SELECT * FROM team_game_publications ORDER BY association_id');assert.equal(rows.length,2);assert.equal(rows[0].fence_hash,rows[1].fence_hash);
 f.sqlite.prepare('UPDATE team_game_publications SET fence=json_set(fence,?,?) WHERE run_id=? AND association_id=?').run('$.'+field,field==='owner_revision'?123:'tampered-source',cp.runId,rows[1].association_id);
 const page=await buildProjectionPage(f.repo,'team','season',cp);f.execute(page.statements);assert.deepEqual(page.checkpoint,{});assert.equal(f.rows('SELECT * FROM team_events').length,0);assert.equal(f.rows('SELECT published_run_id FROM team_projection_state')[0].published_run_id,null);
});

test('equivalent forced replacement renews current fences without changing projection content identity',async t=>{
 const f=await fixture(t);await f.seed();await f.build();const before=f.rows('SELECT p.*,r.content_revision FROM team_projection_state p JOIN team_read_state r USING(app_team_id)')[0],head=f.rows('SELECT association_id,head_revision,accepted_revision FROM team_game_associations');
 await f.complete({recent:true});f.dirty();await f.build();const after=f.rows('SELECT p.*,r.content_revision FROM team_projection_state p JOIN team_read_state r USING(app_team_id)')[0];
 assert.notEqual(after.published_run_id,before.published_run_id);assert.equal(after.content_revision,before.content_revision);assert.equal(after.projection_hash,before.projection_hash);assert.deepEqual(f.rows('SELECT association_id,head_revision,accepted_revision FROM team_game_associations'),head);assert.equal(after.pending,0);
});
test('credential generation alone revalidates membership without rewriting saved game meaning',async t=>{
 const f=await fixture(t);await f.seed();await f.build();const before=f.rows('SELECT p.projection_hash,r.content_revision FROM team_projection_state p JOIN team_read_state r USING(app_team_id)')[0],head=f.rows('SELECT association_id,head_revision,accepted_revision FROM team_game_associations');
 f.sqlite.exec("UPDATE provider_accounts SET active=0,generation=2 WHERE id='account';UPDATE sync_jobs SET state='disabled' WHERE provider='teamsnap'");f.dirty();await f.build();
 assert.deepEqual(f.rows('SELECT association_id,head_revision,accepted_revision FROM team_game_associations'),head);assert.deepEqual(f.rows('SELECT p.projection_hash,r.content_revision FROM team_projection_state p JOIN team_read_state r USING(app_team_id)')[0],before);assert.equal(f.rows("SELECT account_generation FROM team_game_source_rows WHERE provider='teamsnap'")[0].account_generation,2);
});
test('material presentation change advances content even when the stable game target is retained',async t=>{
 const f=await fixture(t);await f.seed();await f.build();const before=f.rows('SELECT content_revision FROM team_read_state')[0].content_revision;
 f.sqlite.exec("UPDATE source_events SET venue='New Stadium',content_hash='changed-venue-'||id");f.dirty();await f.build();assert.equal(f.rows('SELECT content_revision FROM team_read_state')[0].content_revision,before+1);assert.equal(f.rows('SELECT event_id FROM team_events')[0].event_id,'canonical-ts');assert.equal(f.rows('SELECT venue FROM team_events')[0].venue,'New Stadium');
});

for(const type of ['practice','event','game'])test(`ordinary native ${type} singleton is not an unresolved inferred identity`,async t=>{
 const f=await fixture(t);f.event('ts',{extra:{type}});f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:'canonical-ts',team_season_id:'season',state:'resolved',effective_day:'2026-10-12',starts_at:'2026-10-12T18:00:00.000Z',local_day:'2026-10-12',basis:'native',evidence:'{}'});await f.build();const row=f.rows('SELECT * FROM team_events')[0];assert.equal(row.type,type);assert.equal(row.identity_conflict,0);assert.deepEqual(JSON.parse(row.source_ids),['ts']);assert.equal(f.rows('SELECT * FROM team_game_source_rows').length,1);
});

for(const foreign of [false,true])test(`native canonical ambiguity remains visible with ${foreign?'foreign hidden':'two entitled'} private members`,async t=>{
 const f=await fixture(t);f.event('ts');
 if(foreign){f.insert('provider_accounts',{id:'foreign',provider:'teamsnap',native_id:'22',name:'Foreign'});f.source('teamsnap/foreign/101','teamsnap','foreign');}
 f.event('peer',{canonical:'canonical-ts',...(foreign?{own:'teamsnap/foreign/101',account:'foreign',opponent:'SECRET PRIVATE'}:{})});
 f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:'canonical-ts',team_season_id:'season',state:'resolved',effective_day:'2026-10-12',starts_at:'2026-10-12T18:00:00.000Z',local_day:'2026-10-12',basis:'native',evidence:'{}'});await f.complete();await f.build();
 const row=f.rows('SELECT * FROM team_events')[0];assert.equal(row.identity_conflict,1);assert.deepEqual(JSON.parse(row.source_ids),foreign?['ts']:['peer','ts']);assert.equal(f.rows('SELECT * FROM team_game_associations').length,0);assert.ok(!JSON.stringify(row).includes('SECRET PRIVATE'));
});
test('ordinary native fallback retains conditional-game exclusion',async t=>{
 const f=await fixture(t);await f.seed();f.sqlite.exec("UPDATE source_events SET conditional=1 WHERE id='ts'");await f.build();const row=f.rows("SELECT * FROM team_events WHERE event_id='canonical-ts'")[0];assert.equal(row.conditional,1);assert.equal(f.rows("SELECT * FROM team_game_publications WHERE disposition='accepted'").length,0);
});
for(const mutation of ['input','pointer','source'])test(`held equivalent pre-publish ${mutation} change rolls back refreshed proof publication`,async t=>{
 const f=await fixture(t);await f.seed();await f.build();const before=f.rows('SELECT p.*,r.content_revision FROM team_projection_state p JOIN team_read_state r USING(app_team_id)')[0];f.dirty();const cp=await until(f,'publish'),page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.changed,false);assert.equal(page.published,true);
 if(mutation==='input')f.sqlite.exec('UPDATE team_projection_state SET input_revision=input_revision+1');
 if(mutation==='pointer')f.sqlite.exec('UPDATE team_projection_state SET published_run_id=NULL');
 if(mutation==='source')f.sqlite.exec("UPDATE source_events SET venue='Changed after collection',content_hash='held-change-'||id");
 assert.throws(()=>f.execute(page.statements),/CHECK constraint/);assert.equal(f.rows('SELECT content_revision FROM team_read_state')[0].content_revision,before.content_revision);assert.equal(f.rows('SELECT state FROM team_projection_runs WHERE id=?',cp.runId)[0].state,'building');assert.equal(f.rows('SELECT published_run_id FROM team_projection_state')[0].published_run_id,mutation==='pointer'?null:before.published_run_id);
});

test('inferred schedule timestamp follows selected public source within the one-minute match window',async t=>{
 const f=await fixture(t);await f.seed();f.sqlite.exec("UPDATE source_events SET starts_at='2026-10-12T18:00:31.000Z' WHERE id='ts';UPDATE team_event_season_resolutions SET starts_at='2026-10-12T18:00:31.000Z' WHERE event_id='canonical-ts'");await f.build();const row=f.rows('SELECT * FROM team_events')[0];assert.equal(row.schedule_source_id,'pub');assert.equal(row.starts_at,'2026-10-12T18:00:00.000Z');assert.equal(row.local_day,'2026-10-12');
 f.sqlite.exec("UPDATE source_events SET starts_at='2027-07-12T18:00:00.000Z',content_hash='reschedule' WHERE id='ts'");f.dirty();await f.build();const retained=f.rows('SELECT * FROM team_events')[0];assert.equal(retained.starts_at,row.starts_at);assert.equal(retained.local_day,row.local_day);assert.equal(f.rows('SELECT disposition FROM team_game_publications')[0].disposition,'review');
});
for(const fields of [{starts_at:'2026-10-13T19:15:00.000Z'},{local_day:'2026-10-13'}])test(`explicit owner date overrides inferred source schedule: ${JSON.stringify(fields)}`,async t=>{
 const f=await fixture(t);await f.seed();f.insert('domain_overrides',{app_team_id:'team',kind:'event',entity_id:'canonical-ts',fields:JSON.stringify(fields),revision:1});await f.build();const row=f.rows('SELECT * FROM team_events')[0];assert.equal(row.starts_at,fields.starts_at??null);assert.equal(row.local_day,'2026-10-13');assert.equal(row.schedule_source_id,'pub');
});
