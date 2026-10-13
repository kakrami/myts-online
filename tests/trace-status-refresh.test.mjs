import test from 'node:test';
import assert from 'node:assert/strict';
import {traceStorage} from './fixtures/trace-analysis-native.mjs';
import {traceStatusScenario} from './fixtures/trace-status-refresh-fixture.mjs';
import {TEAM_GAMES_QUERY,RICH_GAME_QUERY} from '../src/sources/trace-contracts.js';
const NOW=Date.parse('2026-10-13T06:00:00Z');
async function fixture(t,options={}){t.mock.timers.enable({apis:['Date'],now:NOW});const store=traceStorage();t.after(()=>store.close());const scenario=traceStatusScenario(store.db,options);await scenario.run('games');store.sqlite.exec("INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES('team','Us','UTC',2026,'2026-10-13');INSERT INTO team_read_state(app_team_id) VALUES('team');INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,created_at) VALUES('root','team','trace/account/400','account','observed_history','2026-10-13');");return {...store,...scenario,tick:()=>t.mock.timers.tick(1000),root:()=>store.all("SELECT input_revision FROM team_source_connections WHERE id='root'")[0].input_revision,event:id=>store.all(`SELECT * FROM source_events WHERE native_id='${id||4001}'`)[0]};}

test('29 unchanged discovery and typed-header games cannot reproduce 58 root increments from omitted status',async t=>{
 const f=await fixture(t,{count:29}),start=f.root();
 // Initial rich auxiliary facts are allowed; only the event status omission is a no-op.
 for(const game of f.games){f.tick();await f.run('game',game.game_id);}
 assert.equal(f.root(),start);for(const row of f.all('SELECT evidence FROM source_events'))assert.equal(JSON.parse(row.evidence).provider_status,'completed');
 for(let round=0;round<3;round++){
  f.tick();assert.equal((await f.run('games')).changed,false);
  for(const game of f.games){f.tick();assert.equal((await f.run('game',game.game_id)).changed,false);}
  assert.equal(f.root(),start);
 }
 assert.match(TEAM_GAMES_QUERY,/sport_type status/);assert.doesNotMatch(RICH_GAME_QUERY,/\bstatus\b/);
 // Every native fixture input except status exists in both explicit contracts.
 for(const query of [TEAM_GAMES_QUERY,RICH_GAME_QUERY])for(const field of ['game_id','full_date','approx_half_duration','home_team','away_team','team_id','name','title','score'])assert.match(query,new RegExp('\\b'+field+'\\b'));
 assert.equal(f.calls.filter(c=>c.operationName==='game').length,116);
});

test('explicit discovery cancellations, postponements and clears remain authoritative across typed headers',async t=>{
 const f=await fixture(t);await f.run('game');
 for(const [native,expected]of [['cancelled','CANCELLED'],['canceled','CANCELLED'],['postponed','POSTPONED'],['scheduled','UNKNOWN'],['','UNKNOWN'],[null,'UNKNOWN']]){
  f.setStatus(native);f.tick();const before=f.root();await f.run('games');assert.equal(f.event().status,expected);assert.equal(JSON.parse(f.event().evidence).provider_status,native??'');if(native!==null)assert.ok(f.root()>before);
  const accepted=f.event(),revision=f.root();f.tick();assert.equal((await f.run('game')).changed,false);assert.deepEqual(f.event(),accepted);assert.equal(f.root(),revision);
 }
});

test('typed headers still accept real date, participant, score, label and half-duration changes',async t=>{
 const f=await fixture(t);await f.run('game');f.setStatus('cancelled');f.tick();await f.run('games');
 const cases=[
  [g=>g.full_date='2027-03-01T12:00:00Z',r=>assert.equal(r.starts_at,'2027-03-01T12:00:00.000Z')],
  [g=>g.away_team.team_id=402,r=>assert.equal(r.away_source_team_id,'trace/account/402')],
  [g=>g.away_team.title='Corrected opponent',r=>assert.equal(r.away_label,'Corrected opponent')],
  [g=>g.home_team.score=4,r=>assert.equal(JSON.parse(r.evidence).reported_scores.home,4)],
  [g=>g.approx_half_duration=30,r=>assert.equal(JSON.parse(r.evidence).half_minutes,30)],
 ];
 for(const [mutate,check]of cases){f.tick();mutate(f.games[0]);const before=f.root();assert.equal((await f.run('game')).changed,true);assert.ok(f.root()>before);check(f.event());assert.equal(f.event().status,'CANCELLED');assert.equal(JSON.parse(f.event().evidence).provider_status,'cancelled');}
 f.setStatus('');f.tick();await f.run('games');assert.equal(f.event().status,'SCHEDULED');f.games[0].full_date='2020-01-01T12:00:00Z';f.tick();await f.run('game');assert.equal(f.event().status,'UNKNOWN','ordinary status still derives from the new header date');
});

test('header preservation is fenced to the exact typed provider page and retains source precedence',async t=>{
 const f=await fixture(t);await f.run('game');
 for(const alter of [page=>delete page.component,page=>page.provider='teamsnap',page=>page.checkpoint.protocol='legacy',page=>page.checkpoint.stage='derived',page=>page.checkpoint.offset=100]){
  f.tick();await f.run('games');f.tick();const page=await f.collect('game');alter(page);const before=f.root();await f.save(page);assert.ok(f.root()>before);assert.equal(JSON.parse(f.event().evidence).provider_status,'');
 }
 f.tick();await f.run('games');const accepted=f.event();
 const imported=await f.collect('game');imported.provenance='file_import';imported.sourceCoverage=[];imported.replacements=[];imported.fixtures[0].observed_at='2099-01-01T00:00:00Z';await f.save(imported);assert.deepEqual(f.event(),accepted);
 const stale=await f.collect('game');stale.fixtures[0].starts_at='2020-01-01T00:00:00Z';stale.fixtures[0].observed_at='2020-01-01T00:00:00Z';await f.save(stale);assert.deepEqual(f.event(),accepted);
 // A saved file cannot provide provider authority to a newly verified header.
 f.sqlite.exec("UPDATE source_events SET provenance='file_import' WHERE native_id='4001'");f.tick();await f.run('game');assert.equal(f.event().provenance,'provider');assert.equal(JSON.parse(f.event().evidence).provider_status,'');
});


test('first-ever rich header has no invented discovery status and unexpected explicit status is not hidden',async t=>{
 const f=await fixture(t),game=structuredClone(f.games[0]);game.game_id=4999;for(const moment of game.moments)moment.game_id=4999;f.games.push(game);
 f.tick();assert.equal((await f.run('game',4999)).changed,true);assert.equal(JSON.parse(f.event(4999).evidence).provider_status,'');assert.equal(f.event(4999).status,'UNKNOWN');
 const page=await f.collect('game');page.fixtures[0].status='POSTPONED';const payload=JSON.parse(page.fixtures[0].payload);payload.provider_status='postponed';page.fixtures[0].payload=JSON.stringify(payload);f.tick();page.fixtures[0].observed_at=new Date().toISOString();const before=f.root();await f.save(page);assert.ok(f.root()>before);assert.equal(f.event().status,'POSTPONED');assert.equal(JSON.parse(f.event().evidence).provider_status,'postponed');
});
