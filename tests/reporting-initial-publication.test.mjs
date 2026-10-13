import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {APPLICATION_SCHEMA} from '../src/application/installation-schema.js';
import {DomainRepository} from '../src/domain/repository.js';
import {TeamFeatures} from '../src/application/team-features.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {ApplicationSyncService,collectApplicationJob} from '../src/application/sync-service.js';
import {ReportingService} from '../src/reporting/service.js';

async function fixture({queryBuilders={}}={}){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const sql of APPLICATION_SCHEMA)sqlite.exec(sql);sqlite.prepare('INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,1,?)').run(new Date().toISOString());
 const db={prepare(sql){const p={sql,params:[],bind(...params){return {...p,params};},async all(){const results=sqlite.prepare(sql).all(...this.params).map(r=>({...r}));return {results,meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return sqlite.prepare(sql).get(...this.params)||null;},async run(){const r=sqlite.prepare(sql).run(...this.params);return {meta:{changes:r.changes}};}};return p;},async batch(ss){sqlite.exec('BEGIN');try{const out=await Promise.all(ss.map(s=>s.all()));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 let at=Date.now();const clock=()=>at,jobs=new JobCoordinator(db,{clock,reportTurn:false}),sync=new ApplicationSyncService(db,{}, {coordinatorOptions:{clock}}),reports=new ReportingService(db,{coordinator:jobs,now:clock,queryBuilders}),repo=new DomainRepository(db),features=new TeamFeatures(db,{owner:true}),team=await repo.createTeam({name:'Immediate reports',timezone:'UTC',seasonYear:2026}),scope={team_id:team.id,team_season_id:team.season_id};
 const all=sql=>sqlite.prepare(sql).all().map(r=>({...r}));
 const apply=page=>{sqlite.exec('BEGIN');try{const changes=page.statements.map(s=>sqlite.prepare(s.sql.replaceAll('$FENCE','1')).run(...s.params).changes);sqlite.exec('COMMIT');return changes;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 const step=async()=>{at+=2000;return jobs.runOne(context=>collectApplicationJob(context,{reportCollector:job=>reports.collect(job)}),{env:{}});};
 async function publish(){await sync.recoverLocalDemand({wake:false});for(let i=0;i<20;i++){if(sqlite.prepare('SELECT pending FROM team_projection_state').get().pending===0)return i;const result=await step();assert.equal(result.provider,'domain','initial projection priority must outrank waiting reports');}assert.fail('Initial projection did not publish within its bounded empty pages.');}
 async function drain(){for(let i=0;i<40;i++){const result=await step();assert.ok(!['failed','blocked','retrying'].includes(result.state),JSON.stringify(result));if(result.state==='idle')return i;}assert.fail('Reports did not settle within bounded coordinator work.');}
 const create=async(type='season',options={})=>reports.snapshot((await reports.create(scope,{type,...options})).data.snapshot_id);
 const rename=()=>features.renameTeam(team.id,'Owner changed report context',0);
 return {sqlite,db,all,apply,step,publish,drain,create,rename,reports,repo,sync,scope,close:()=>sqlite.close()};
}
const marker=snapshot=>JSON.parse(snapshot.selection).report_initial_publication;

test('ordinary immediate new-team reports wait for initial projection and all four settle without data arrival',async()=>{
 const f=await fixture();try{
  const ids=[];for(const type of ['season','matches','players','availability']){const s=await f.create(type);ids.push(s.id);assert.equal(s.content_revision,0);assert.ok(marker(s));const waiting=await f.reports.capture(s);assert.equal(waiting.complete,false);assert.deepEqual(waiting.statements,[]);assert.equal((await f.reports.preview(s.id)).selection.report_initial_publication,undefined);}
  // Exercise a real scheduler attempt before recovery; it must remain resumable.
  assert.equal((await f.step()).state,'queued');assert.ok(await f.publish()<=7);assert.ok(await f.drain()<=12);
  for(const id of ids){const s=await f.reports.snapshot(id);assert.equal(s.state,'ready');assert.equal(s.content_revision,1);assert.equal(s.captured,s.type==='season'?6:0);assert.equal(marker(s),undefined);}
  assert.equal(f.all("SELECT * FROM sync_jobs WHERE provider='reports' AND state<>'ready'").length,0);
 }finally{f.close();}
});

test('initialization rejects real owner changes before publication and source/input clock changes',async()=>{
 for(const mutation of ['owner','source','input']){const f=await fixture();try{const s=await f.create();if(mutation==='owner')await f.rename();else if(mutation==='source')f.sqlite.exec('INSERT INTO source_serialization_clock(id,revision) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET revision=revision+1');else f.sqlite.exec('UPDATE team_projection_state SET input_revision=input_revision+1');f.apply(await f.reports.capture(s));assert.equal((await f.reports.snapshot(s.id)).error_code,'report_changed',mutation);assert.equal(f.all('SELECT * FROM report_rows').length,0);}finally{f.close();}}
});

test('stale initial-pin commit cannot absorb a mutation between read and write',async()=>{
 const f=await fixture();try{const s=await f.create();await f.publish();const page=await f.reports.capture(s);assert.equal(page.checkpoint.initial_publication_pinned,true);await f.rename();assert.deepEqual(f.apply(page),[0]);let saved=await f.reports.snapshot(s.id);assert.ok(marker(saved));assert.equal(saved.content_revision,0);assert.equal(saved.captured,0);f.apply(await f.reports.capture(saved));saved=await f.reports.snapshot(s.id);assert.equal(saved.state,'failed');assert.equal(saved.error_code,'report_changed');}finally{f.close();}
});

test('lost pin reply is replay-safe and a later mutation fails the pinned snapshot',async()=>{
 const f=await fixture();try{const s=await f.create();await f.publish();const page=await f.reports.capture(s);assert.deepEqual(f.apply(page),[1]);const pinned=await f.reports.snapshot(s.id);assert.equal(marker(pinned),undefined);assert.equal(pinned.content_revision,1);assert.deepEqual(f.apply(page),[0]);assert.deepEqual(await f.reports.snapshot(s.id),pinned);await f.rename();assert.deepEqual(f.apply(page),[0]);f.apply(await f.reports.capture(await f.reports.snapshot(s.id)));assert.equal((await f.reports.snapshot(s.id)).state,'failed');assert.equal(f.all('SELECT * FROM report_rows').length,0);}finally{f.close();}
});

test('unmarked pre-upgrade and partial snapshots retain strict immutable revision rejection',async()=>{
 const f=await fixture({queryBuilders:{season:()=>({sql:"WITH RECURSIVE n(id) AS(VALUES(0) UNION ALL SELECT id+1 FROM n WHERE id<136) SELECT printf('%03d',id) AS id,'Record '||id AS metric,id AS value FROM n",params:[]})}});try{
  const old=await f.create();f.sqlite.prepare("UPDATE report_snapshots SET selection=json_remove(selection,'$.report_initial_publication') WHERE id=?").run(old.id);await f.publish();f.apply(await f.reports.capture(await f.reports.snapshot(old.id)));assert.equal((await f.reports.snapshot(old.id)).error_code,'report_changed');
  f.reports.captureAtAdmission=false;const s=await f.create();assert.equal(marker(s),undefined);f.apply(await f.reports.capture(s));const partial=await f.reports.snapshot(s.id);assert.equal(partial.captured,100);const before=f.all('SELECT * FROM report_rows ORDER BY ordinal');await f.rename();f.apply(await f.reports.capture(partial));assert.equal((await f.reports.snapshot(s.id)).state,'failed');assert.deepEqual(f.all('SELECT * FROM report_rows ORDER BY ordinal'),before);
 }finally{f.close();}
});

test('initial publication refreshes count/query before capture and never repins a ready report',async()=>{
 const f=await fixture({queryBuilders:{season:selection=>({sql:'SELECT player_id AS id,name AS metric,jersey AS value FROM team_players WHERE app_team_id=? AND team_season_id=?',params:[selection.team_id,selection.team_season_id]})}});try{
  const s=await f.create();assert.equal(s.total,0);await f.publish();const run=f.sqlite.prepare('SELECT published_run_id FROM team_projection_state').get().published_run_id;
  // A row staged by the first projection is invisible at admission, visible at pin.
  f.sqlite.prepare("INSERT INTO players(id,created_at) VALUES('player','2026-10-12')").run();f.sqlite.prepare("INSERT INTO team_player_rows(run_id,app_team_id,team_season_id,player_id,name,jersey,source_ids) VALUES(?,?,?,'player','First published player','2','[]')").run(run,f.scope.team_id,f.scope.team_season_id);
  f.apply(await f.reports.capture(s));let saved=await f.reports.snapshot(s.id);assert.equal(saved.total,1);assert.equal(saved.captured,0);assert.equal(marker(saved),undefined);f.apply(await f.reports.capture(saved));saved=await f.reports.snapshot(s.id);assert.equal(saved.state,'ready');const rows=f.all('SELECT * FROM report_rows');await f.rename();assert.deepEqual((await f.reports.capture(saved)).statements,[]);assert.deepEqual(f.all('SELECT * FROM report_rows'),rows);
 }finally{f.close();}
});


test('a first publication racing snapshot admission safely rejects rather than storing a stale marker',async()=>{
 const f=await fixture();try{const prepare=f.db.prepare.bind(f.db);let raced=false;f.db.prepare=sql=>{const p=prepare(sql);if(!sql.startsWith('INSERT INTO report_snapshots'))return p;return {...p,bind(...params){const bound=p.bind(...params);return {...bound,async run(){if(!raced){raced=true;await f.publish();}return bound.run();}};}};};await assert.rejects(f.create(),e=>e.code==='report_changed');assert.equal(raced,true);assert.equal(f.all('SELECT * FROM report_snapshots').length,0);}finally{f.close();}
});
