import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshDatabase,refreshScenario,jobSpec,publicRows} from './fixtures/gotsport-refresh-fixture.mjs';
import {publicHistoryBridgeRows} from '../src/sync/public-history-bridge.js';
const NOW=Date.parse('2026-10-13T06:00:00Z');
async function fixture(t){t.mock.timers.enable({apis:['Date'],now:NOW});const f=refreshDatabase();t.after(()=>f.close());const scenario=refreshScenario(f.db),jobs=await scenario.initialize();return {...f,...scenario,jobs,tick:()=>t.mock.timers.tick(1000)};}
async function scan(f,job,mutate,{onPage=()=>{}}={}){let cursor={},pages=[],scanId=crypto.randomUUID();do{f.tick();const saved=await f.run(jobSpec(job,{cursor,scanId,mutate}));pages.push(saved);await onPage(saved);cursor=saved.page.checkpoint;}while(!cursor.finished);return pages;}
const event=f=>f.one("SELECT * FROM source_events WHERE id='gotsport/public/1001'");

test('real history and division bytes stop oscillating richer native context without hiding source corrections',async t=>{
 const f=await fixture(t);f.tick();await f.run(jobSpec(f.jobs.division));f.tick();await f.run(jobSpec(f.jobs.standings));
 const initial=await event(f),root=await f.root();
 for(let round=0;round<3;round++)for(const spec of [{component:'history',scope:'212707',args:{team_id:'212707'}},jobSpec(f.jobs.event),jobSpec(f.jobs.division),jobSpec(f.jobs.standings)]){
  f.tick();const result=await f.run(spec);assert.equal(result.changed,false,spec.component);assert.equal(result.rootDelta,0,spec.component);
 }
 assert.deepEqual(await event(f),initial);assert.equal((await f.root()).input_revision,root.input_revision);
 for(const [field,mutate,expected]of [
  ['starts_at',value=>{value.matches[0].matchTime='2026-10-10T18:00:00Z';return value;},'2026-10-10T18:00:00.000Z'],
  ['venue',value=>{value.matches[0].venue={name:'Corrected field'};return value;},'Corrected field'],
  ['away_source_team_id',value=>{value.matches[0].awayTeam={team_id:444444,full_name:'Corrected opponent'};return value;},'gotsport/public/444444'],
  ['home_score',value=>{value.matches[0].home_score=4;return value;},4],
 ]){f.tick();const result=await f.history({mutate});assert.ok(result.changed&&result.rootDelta>0,field);assert.equal((await event(f))[field],expected);assert.equal((await event(f)).division_key,initial.division_key);}
 // A different bracket or schedule is contradictory identity, not omission.
 for(const field of ['event_id','bracket_id','schedule_id']){f.tick();await f.run(jobSpec(f.jobs.division));f.tick();const changed=await f.history({mutate:value=>{value.matches[0][field]=999;return value;}});assert.ok(changed.rootDelta>0);assert.equal((await event(f)).division_key,null,field);}
 // An authoritative division update/removal has no history-omission privilege.
 f.tick();await f.run(jobSpec(f.jobs.division));const page=await f.collect(jobSpec(f.jobs.division));page.fixtures[0].division_id=null;const payload=JSON.parse(page.fixtures[0].payload);Object.assign(payload,{division_id:null,group_id:null,context:null});page.fixtures[0].payload=JSON.stringify(payload);f.tick();page.fixtures[0].observed_at=new Date().toISOString();assert.ok((await f.save(page)).rootDelta>0);assert.equal((await event(f)).division_key,null);
});

test('real 101-row division and standings refreshes retain accepted coverage across unchanged partial pages',async t=>{
 const f=await fixture(t);const mutate=publicRows(101);
 for(const job of [f.jobs.division,f.jobs.standings])await scan(f,job,mutate);
 const coverage=async()=>({division:await f.rows('SELECT * FROM source_division_coverage ORDER BY id'),standings:await f.rows('SELECT * FROM source_standings_coverage ORDER BY source_division_id'),component:await f.rows("SELECT * FROM source_component_coverage WHERE kind='standings' ORDER BY id")});
 const accepted=await coverage(),before=await f.root();
 for(let round=0;round<3;round++)for(const job of [f.jobs.division,f.jobs.standings]){
  const pages=await scan(f,job,mutate,{onPage:async saved=>{assert.equal(saved.changed,false);assert.equal(saved.rootDelta,0);assert.deepEqual(await coverage(),accepted);}});assert.equal(pages.length,2);assert.equal(pages[0].complete,false);assert.equal(pages[1].complete,true);
 }
 assert.equal((await f.root()).input_revision,before.input_revision);
 // A failed/interrupted refresh leaves its earlier complete receipt unchanged.
 const partial=await f.run(jobSpec(f.jobs.division,{mutate}));assert.equal(partial.complete,false);assert.deepEqual(await coverage(),accepted);
 // A correction behind the current source cursor still changes facts and roots.
 const corrected=(value,url)=>{const rows=mutate(value,url);if(url.pathname.endsWith('/flight_matches'))rows[0].matchTime='2026-09-01T12:00:00Z';return rows;};
 const changed=await scan(f,f.jobs.division,corrected);assert.ok(changed[0].changed&&changed[0].rootDelta>0);assert.equal((await event(f)).starts_at,'2026-09-01T12:00:00.000Z');
 // Terminal count and publication changes remain real accepted evidence changes.
 const smaller=await scan(f,f.jobs.standings,publicRows(100));assert.ok(smaller[0].changed&&smaller[0].rootDelta>0);assert.equal((await f.one('SELECT record_count FROM source_standings_coverage')).record_count,100);assert.equal((await f.one('SELECT COUNT(*) n FROM source_standings')).n,100);
 const empty=await scan(f,f.jobs.standings,publicRows(0));assert.ok(empty[0].changed&&empty[0].rootDelta>0);assert.equal((await f.one('SELECT availability FROM source_standings_coverage')).availability,'unpublished');assert.equal((await f.one('SELECT COUNT(*) n FROM source_standings')).n,0);
});

test('coverage retention is confined to matching provider collector progress and never imported or generic claims',async t=>{
 const f=await fixture(t);await scan(f,f.jobs.division,publicRows(101));
 for(const mutation of [page=>delete page.component,page=>page.resourceKey='gotsport:999',page=>page.provider='live',page=>page.complete=true]){
  const page=await f.collect(jobSpec(f.jobs.division,{mutate:publicRows(101)}));mutation(page);assert.ok((await f.save(page)).changed);await scan(f,f.jobs.division,publicRows(101));
 }
 const page=await f.collect(jobSpec(f.jobs.division,{mutate:publicRows(101)}));await assert.rejects(f.repo.buildSourcePage({...page,provenance:'file_import'}),e=>e.code==='import_authority');
});

test('exact bridge replays are no-ops while proof renewal, expiry recovery and revocation stay truthful',async t=>{
 const f=await fixture(t),spec={provider:'live',component:'participant',scope:'700:50:60',args:{team_id:'700',club_id:'50',season:'60',season_name:'2026'}};
 const first=await f.run(spec);assert.ok(first.rootDelta>0);const original=await f.one('SELECT evidence FROM source_team_links');
 const replay=await f.save(first.page);assert.equal(replay.changed,false);assert.equal(replay.rootDelta,0);assert.deepEqual(await f.one('SELECT evidence FROM source_team_links'),original);
 f.tick();const renewal=await f.run(spec);assert.equal(renewal.changed,false);assert.equal(renewal.rootDelta,1,'renewal deliberately retains existing root trigger, separately from byte-identical replay');
 const renewed=JSON.parse((await f.one('SELECT evidence FROM source_team_links')).evidence);assert.ok(Date.parse(renewed.expires_at)>Date.parse(JSON.parse(original.evidence).expires_at));
 const authorized=()=>f.rows(publicHistoryBridgeRows(String(Date.now())));assert.equal((await authorized()).length,1);
 t.mock.timers.tick(21600001);assert.equal((await authorized()).length,0);const recovered=await f.run(spec);assert.ok(recovered.changed&&recovered.rootDelta>0);assert.equal((await authorized()).length,1);
 const semantic=await f.collect(spec);const proof=JSON.parse(semantic.records.identity_links[0].evidence);proof.season_name='2027';semantic.records.identity_links[0].evidence=JSON.stringify(proof);f.tick();assert.ok((await f.save(semantic)).rootDelta>0);assert.equal((await authorized()).length,0,'contradictory proof cannot borrow stale current team identity');
 const before=(await f.root()).input_revision;await f.db.prepare('DELETE FROM source_team_links').run();assert.ok((await f.root()).input_revision>before);assert.equal((await authorized()).length,0);
});

test('history enrichment retention cannot promote file authority or admit stale provider changes',async t=>{
 const f=await fixture(t);f.tick();await f.run(jobSpec(f.jobs.division));const saved=await event(f),page=await f.collect({component:'history',scope:'212707',args:{team_id:'212707'}});
 const imported={...page,provenance:'file_import',sourceCoverage:[],replacements:[]};imported.fixtures[0].starts_at='2027-01-01T00:00:00Z';imported.fixtures[0].observed_at='2099-01-01T00:00:00Z';await f.repo.ingestSourcePage(imported);assert.deepEqual(await event(f),saved);
 const stale=await f.collect({component:'history',scope:'212707',args:{team_id:'212707'}});stale.fixtures[0].starts_at='2027-01-01T00:00:00Z';stale.fixtures[0].observed_at='2020-01-01T00:00:00Z';await f.save(stale);assert.deepEqual(await event(f),saved);
});

test('two distinct single-page division responses remain stable across historical participant labels under a saved profile',async t=>{
 const f=await fixture(t),a=f.jobs.division,b={...a,scope:'gotsport:201',args:{...a.args,group:'201',brackets:['301']}};
 const mutate=(value,url)=>url.pathname.endsWith('/flight_matches')?[{...value[0],id:1002,schedule_id:201,bracket_id:301,homeTeam:{...value[0].homeTeam,full_name:'Test Club Older Historical Name',team_logo:'/historical-logo.png'}}]:value;
 await f.run(jobSpec(a));await f.run(jobSpec(b,{mutate}));
 for(let i=0;i<3;i++)for(const spec of [jobSpec(a),jobSpec(b,{mutate})]){f.tick();const result=await f.run(spec);assert.equal(result.changed,false);assert.equal(result.rootDelta,0);}
 assert.equal((await f.one("SELECT name_authority FROM source_teams WHERE id='gotsport/public/212707'")).name_authority,0);
 // Equal-authority contradictory labels remain genuine source input. This patch
 // does not suppress an unresolved identity conflict or pretend to choose one.
 await f.db.prepare("UPDATE source_teams SET name_authority=3,evidence='{}' WHERE id='gotsport/public/212707'").run();
 f.tick();assert.ok((await f.run(jobSpec(a))).rootDelta>0);f.tick();assert.ok((await f.run(jobSpec(b,{mutate}))).rootDelta>0);
});
