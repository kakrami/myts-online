import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,until} from './team-game-projection.test.mjs';
import {buildProjectionPage} from '../src/domain/projector.js';

test('accepted controls survive scan-id and last-save-only renewal at stable input',async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'publish'),input=f.rows('SELECT input_revision FROM team_projection_state'),sources=f.rows('SELECT * FROM source_events');
 f.sqlite.exec("UPDATE sync_jobs SET scan_id=scan_id||'-renewed',last_saved_at=COALESCE(last_saved_at,0)+1 WHERE id='gotsport-history'");
 const page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.checkpoint.runId,cp.runId);assert.equal(page.published,true);f.execute(page.statements);
 assert.deepEqual(f.rows('SELECT input_revision FROM team_projection_state'),input);assert.deepEqual(f.rows('SELECT * FROM source_events'),sources);assert.equal(f.rows('SELECT * FROM team_events').length,1);
});

async function morePairs(f,n=30){for(let i=0;i<n;i++){const start=new Date(Date.parse('2026-09-01T18:00:00Z')+i*86400000).toISOString();for(const [prefix,provider]of [['a-pub-','gotsport'],['z-ts-','teamsnap']]){const id=f.event(prefix+String(i).padStart(3,'0'),{provider,start});f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:id,team_season_id:'season',state:'resolved',effective_day:start.slice(0,10),starts_at:start,local_day:start.slice(0,10),basis:'native',evidence:'{}'});}}await f.complete();}
function refresh(f){f.sqlite.exec("UPDATE sync_jobs SET state='running',checkpoint='{}',scan_id=scan_id||'-refresh',last_saved_at=COALESCE(last_saved_at,0)+1 WHERE provider='gotsport'");}

test('accepted full-root proof advances new neighborhoods while every public job stays running',async t=>{
 const f=await fixture(t);await morePairs(f);let cp=await until(f,'events'),page=await buildProjectionPage(f.repo,'team','season',cp);f.execute(page.statements);cp=page.checkpoint;const run=cp.runId;
 assert.equal(cp.acceptedControls.accepted_evidence.full_scope,true);refresh(f);
 for(let i=0;i<30;i++){page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,undefined);assert.equal(page.checkpoint.runId,run);f.execute(page.statements);cp=page.checkpoint;if(page.published)break;assert.ok(i<29);}
 assert.equal(f.rows('SELECT * FROM team_events').length,30);assert.equal(f.rows("SELECT count(*) n FROM sync_jobs WHERE provider='gotsport' AND state='running'")[0].n,3);assert.equal(f.rows("SELECT count(*) n FROM team_projection_runs WHERE state='obsolete'")[0].n,0);
});

test('first native-only page retains genuine full-root control proof under raw CAS',async t=>{
 const f=await fixture(t);await f.seed();const id=f.event('000-native',{start:'2026-10-11T18:00:00.000Z'});f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:id,team_season_id:'season',state:'resolved',effective_day:'2026-10-11',starts_at:'2026-10-11T18:00:00.000Z',local_day:'2026-10-11',basis:'native',evidence:'{}'});await f.complete();let cp={...await until(f,'events'),gamePagePolicy:2,gamePageSize:1};let page=await buildProjectionPage(f.repo,'team','season',cp);assert.ok(page.checkpoint.acceptedControls);f.execute(page.statements);cp=page.checkpoint;assert.equal(f.rows('SELECT * FROM team_game_publications').length,0);refresh(f);page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,undefined);assert.notEqual(page.checkpoint.cursor,cp.cursor);f.execute(page.statements);await f.build(page.checkpoint);assert.equal(f.rows('SELECT * FROM team_events').length,2);
});

test('new build during refresh preserves cursor without borrowing last-complete clocks',async t=>{
 const f=await fixture(t);await f.seed();let cp=await until(f,'events');refresh(f);const page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,'source_evidence');assert.equal(page.checkpoint.runId,cp.runId);assert.equal(page.checkpoint.cursor,cp.cursor);assert.equal(page.checkpoint.acceptedControls,undefined);f.execute(page.statements);assert.equal(f.rows('SELECT * FROM team_game_publications').length,0);await f.complete();await f.build(page.checkpoint);assert.equal(f.rows('SELECT * FROM team_events').length,1);
});

for(const terminal of ['failed','blocked','ready'])test(`terminal ${terminal} required discovery does not wait on unrelated active work`,async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'events');f.sqlite.prepare("UPDATE sync_jobs SET state=?,coverage='unsupported' WHERE id='gotsport-profile'").run(terminal);f.sqlite.exec("UPDATE sync_jobs SET state='running',checkpoint='{}' WHERE id='gotsport-history'");const page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,undefined);assert.equal(page.checkpoint.acceptedControls,undefined);f.execute(page.statements);assert.equal(f.rows("SELECT * FROM team_game_publications WHERE disposition='accepted'").length,0);
});

for(const mutate of [r=>{delete r.accepted_evidence;},r=>{r.accepted_evidence.complete=false;},r=>{r.accepted_evidence.full_scope='true';},r=>{r.control_witness.version=1;}])test('malformed accepted-control receipt is never silently reinterpreted',async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'publish'),r=JSON.parse(f.rows('SELECT fence FROM team_game_publications')[0].fence);mutate(r);f.sqlite.prepare('UPDATE team_game_publications SET fence=?').run(JSON.stringify(r));const page=await buildProjectionPage(f.repo,'team','season',cp);assert.deepEqual(page.checkpoint,{});f.execute(page.statements);assert.equal(f.rows('SELECT * FROM team_events').length,0);
});

import {beginTeamSnapRefresh} from '../src/sources/teamsnap-refresh.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {JOB_FIELDS,COVERAGE_FIELDS,controlWitness} from '../src/domain/team-game-control-witness.js';

test('TeamSnap outside-active-window success cannot seed full-root reuse inside the active range',async t=>{
 const f=await fixture(t);await f.seed();const id=f.event('000-old',{start:'2026-09-01T18:00:00.000Z'});f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:id,team_season_id:'season',state:'resolved',effective_day:'2026-09-01',starts_at:'2026-09-01T18:00:00.000Z',local_day:'2026-09-01',basis:'native',evidence:'{}'});await f.complete();const j=f.rows("SELECT * FROM sync_jobs WHERE provider='teamsnap'")[0],refresh=(await beginTeamSnapRefresh({kind:'events',teamId:'101',accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args:JSON.parse(j.args),cursor:JSON.parse(j.checkpoint),now:Date.now()})).refresh;f.sqlite.prepare("UPDATE sync_jobs SET state='running',checkpoint=? WHERE provider='teamsnap'").run(JSON.stringify({protocol:'teamsnap-pages-v1',refresh}));let cp={...await until(f,'events'),gamePagePolicy:2,gamePageSize:1},page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,undefined);assert.equal(page.checkpoint.acceptedControls,undefined);f.execute(page.statements);cp=page.checkpoint;page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,'source_evidence');assert.equal(page.checkpoint.cursor,cp.cursor);f.execute(page.statements);
});

test('first-ever terminal-incomplete work with a last-complete clock never mints accepted proof',async t=>{
 const f=await fixture(t);await f.seed();f.sqlite.exec("UPDATE sync_jobs SET checkpoint='{}',coverage='partial' WHERE provider='gotsport'");const cp=await until(f,'events'),page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,undefined);assert.equal(page.checkpoint.acceptedControls,undefined);f.execute(page.statements);assert.equal(f.rows("SELECT * FROM team_game_publications WHERE disposition='accepted'").length,0);
});

for(const version of [1,2])test(`legacy receipt v${version} retains exact execution rules and restarts once`,async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'publish'),r=JSON.parse(f.rows('SELECT fence FROM team_game_publications')[0].fence),control={jobs:f.rows('SELECT '+JOB_FIELDS.join(',')+' FROM sync_jobs'),coverage:f.rows('SELECT '+COVERAGE_FIELDS.join(',')+' FROM source_component_coverage'),subscribers:f.rows('SELECT job_id,kind,app_team_id,demand_key,generation FROM sync_job_subscribers')};r.version=version;delete r.accepted_evidence;if(version===1){delete r.control_witness;r.jobs=control.jobs;r.coverage=control.coverage;}else r.control_witness=await controlWitness(control);f.sqlite.prepare('UPDATE team_game_publications SET fence=?').run(JSON.stringify(r));f.sqlite.exec("UPDATE sync_jobs SET scan_id=scan_id||'-new' WHERE id='gotsport-history'");const page=await buildProjectionPage(f.repo,'team','season',cp);assert.deepEqual(page.checkpoint,{});f.execute(page.statements);assert.equal(f.rows('SELECT * FROM team_events').length,0);await f.build(page.checkpoint);assert.equal(f.rows('SELECT * FROM team_events').length,1);
});

test('source-evidence deferral commits same cursor as queued for60s and leaves ordinary delay unchanged',async t=>{
 const f=await fixture(t);await f.seed();f.sqlite.exec('UPDATE sync_jobs SET recurring=0');const at=Date.now(),coordinator=new JobCoordinator(f.db,{clock:()=>at}),id=await coordinator.enqueue({provider:'domain',component:'projection',stage:'projection',scope:'team',resourceKey:'season',args:{teamId:'team',seasonId:'season'},priority:100,recurring:false},[{kind:'team',key:'projection:team:season',teamId:'team'}]);const lease=await coordinator.claim();assert.equal(lease.id,id);const cp={runId:'same-hidden-run',phase:'events',cursor:'retained'};await coordinator.commit(lease,{statements:[],checkpoint:cp,complete:false,coverage:'partial',projectionDeferred:'source_evidence'});const saved=f.rows('SELECT state,checkpoint,next_at,failures,last_error_code FROM sync_jobs WHERE id=?',id)[0];assert.equal(saved.state,'queued');assert.deepEqual(JSON.parse(saved.checkpoint),cp);assert.equal(saved.next_at,at+60000);assert.equal(saved.failures,0);assert.equal(saved.last_error_code,null);assert.equal(await coordinator.nextWake(),at+60000);assert.equal(await coordinator.claim(),null);f.sqlite.prepare('UPDATE sync_jobs SET next_at=? WHERE id=?').run(at,id);const next=await coordinator.claim();await coordinator.commit(next,{statements:[],checkpoint:cp,complete:false,coverage:'partial'});assert.equal(f.rows('SELECT next_at FROM sync_jobs WHERE id=?',id)[0].next_at,at+500);
});

test('non-projection collectors cannot request the projection-only deferral',async t=>{
 const f=await fixture(t);await f.seed();const coordinator=new JobCoordinator(f.db,{clock:()=>Date.now()}),lease=f.rows("SELECT * FROM sync_jobs WHERE id='gotsport-history'")[0];await assert.rejects(coordinator.commit(lease,{statements:[],complete:false,coverage:'partial',projectionDeferred:'source_evidence'}),{code:'contract_violation'});
});

for(const component of ['profile','catalog','history'])for(const state of ['queued','running','retrying'])test(`missing ${component} coverage waits for its exact ${state} discovery job`,async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'events');f.sqlite.prepare("UPDATE sync_jobs SET state=?,checkpoint='{}',coverage='partial',generation=generation+1 WHERE id=?").run(state,'gotsport-'+component);f.sqlite.prepare('UPDATE source_component_coverage SET complete=0 WHERE id=?').run('coverage-gotsport-'+component);
 const page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,'source_evidence');assert.equal(page.checkpoint.runId,cp.runId);assert.equal(page.checkpoint.cursor,cp.cursor);assert.equal(page.checkpoint.acceptedControls,undefined);f.execute(page.statements);assert.equal(f.rows('SELECT * FROM team_event_rows').length,0);assert.equal(f.rows('SELECT * FROM team_game_publications').length,0);
 f.sqlite.prepare("UPDATE sync_jobs SET state='ready',checkpoint=?,coverage='complete' WHERE id=?").run(JSON.stringify({finished:true}),'gotsport-'+component);f.sqlite.prepare('UPDATE source_component_coverage SET complete=1 WHERE id=?').run('coverage-gotsport-'+component);await f.build(page.checkpoint);assert.equal(f.rows('SELECT * FROM team_events').length,1);assert.equal(f.rows("SELECT * FROM team_game_publications WHERE disposition='accepted'").length,1);
});

for(const state of ['ready','failed','blocked','disabled'])test(`missing required coverage with ${state} responsible job is not hidden by unrelated active history`,async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'events');f.sqlite.prepare("UPDATE sync_jobs SET state=?,coverage=? WHERE id='gotsport-profile'").run(state,state==='ready'?'complete':'unsupported');f.sqlite.exec("UPDATE source_component_coverage SET complete=0 WHERE id='coverage-gotsport-profile';UPDATE sync_jobs SET state='running',checkpoint='{}' WHERE id='gotsport-history'");const page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,undefined);assert.equal(page.checkpoint.acceptedControls,undefined);f.execute(page.statements);assert.equal(f.rows("SELECT * FROM team_game_publications WHERE disposition='accepted'").length,0);
});

test('absent required coverage waits only for its own active job',async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'events');f.sqlite.exec("DELETE FROM source_component_coverage WHERE id='coverage-gotsport-history';UPDATE sync_jobs SET state='queued',checkpoint='{}',coverage='none' WHERE id='gotsport-history'");const page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.projectionDeferred,'source_evidence');assert.equal(page.checkpoint.cursor,cp.cursor);f.execute(page.statements);assert.equal(f.rows('SELECT * FROM team_game_publications').length,0);
});
