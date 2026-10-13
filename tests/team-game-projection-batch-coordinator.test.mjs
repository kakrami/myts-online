import test from 'node:test';
import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fullFixture,finishProjection} from './team-game-projection-coordinator.test.mjs';
import {ApplicationSyncService} from '../src/application/sync-service.js';
const NOW=Date.parse('2026-10-13T00:00:00Z');
export const crossSeasonStatements=[
 "INSERT INTO team_seasons(id,app_team_id,year,start_day,end_day,start_at,end_at) VALUES('next','team',2027,'2027-06-01','2028-06-01','2027-06-01T07:00:00Z','2028-06-01T07:00:00Z')",
 "INSERT INTO team_projection_state(team_season_id,app_team_id) VALUES('next','team')",
 "INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id,account_id,active,generation) SELECT id||'-next',app_team_id,'next',source_team_id,account_id,active,generation FROM team_source_attachments WHERE team_season_id='season'",
 "INSERT INTO team_connection_seasons(connection_id,team_season_id,attachment_id,basis,generation,active,excluded) SELECT connection_id,'next',attachment_id||'-next',basis,generation,active,excluded FROM team_connection_seasons WHERE team_season_id='season'",
 "UPDATE source_events SET venue='Updated Field',content_hash='moved-proof-'||id,starts_at=CASE WHEN id IN('a-public-000','z-private-000') THEN '2027-07-12T18:00:00.000Z' ELSE starts_at END",
 "UPDATE team_event_season_resolutions SET team_season_id='next',starts_at='2027-07-12T18:00:00.000Z',local_day='2027-07-12',effective_day='2027-07-12' WHERE event_id IN('canonical-a-public-000','canonical-z-private-000')",
 "UPDATE team_projection_state SET input_revision=input_revision+1,pending=1 WHERE team_season_id='season'",
];
test('production coordinator cross-season48 group replacement fits50SQL and compiles every batch query at native limits',async t=>{
 t.mock.timers.enable({apis:['Date'],now:NOW});const f=await fullFixture({pairs:48});t.after(()=>f.close());await finishProjection(f,t);await f.db.prepare("UPDATE sync_jobs SET next_at=? WHERE stage='source'").bind(NOW+86400000).run();for(const sql of crossSeasonStatements)await f.db.prepare(sql).run();
 await new ApplicationSyncService(f.db,{}).enqueueProjection('team','season',{wake:false});await f.runtime.wake();const pages=await finishProjection(f,t);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_game_publish_batches WHERE state='published'").get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_events').get().n,48);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_events WHERE team_season_id='next'").get().n,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_game_source_rows m JOIN team_projection_state p ON p.published_run_id=m.run_id").get().n,96);
 const catalogs=f.sqlite.prepare("SELECT args FROM sync_jobs WHERE provider='analysis' AND component='catalog'").all().map(j=>JSON.parse(j.args).seasonId);assert.ok(catalogs.includes('season')&&catalogs.includes('next'),JSON.stringify(catalogs));assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 const directory=await mkdtemp(path.join(tmpdir(),'myts-batch-sql-limits-'));t.after(()=>rm(directory,{recursive:true,force:true}));const database=path.join(directory,'fixture.db'),queries=path.join(directory,'queries.json');await backup(f.sqlite,database);await writeFile(queries,JSON.stringify(f.queries));
 const proof=spawnSync('python3',['-c',`import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1])
for key,value in [('SQLITE_LIMIT_EXPR_DEPTH',100),('SQLITE_LIMIT_COMPOUND_SELECT',5),('SQLITE_LIMIT_VARIABLE_NUMBER',100),('SQLITE_LIMIT_SQL_LENGTH',100000)]: c.setlimit(getattr(sqlite3,key),value)
queries=json.load(open(sys.argv[2]));seen=set()
for i,q in enumerate(queries):
 if q['sql'] in seen:continue
 seen.add(q['sql'])
 try:c.execute('EXPLAIN '+q['sql'],q['params']).fetchall()
 except Exception as e:raise RuntimeError('query '+str(i)+' failed: '+str(e)+'; SQL='+q['sql'][:500]) from e
print(json.dumps({'queries':len(queries),'unique':len(seen),'sqlBytes':max(len(q['sql'].encode()) for q in queries),'parameters':max(len(q['params']) for q in queries)}))`,database,queries],{encoding:'utf8',maxBuffer:1_000_000});assert.equal(proof.status,0,proof.stderr);t.diagnostic(JSON.stringify({maxStatements:Math.max(...pages.map(p=>p.statements)),pages:pages.length,shape:JSON.parse(proof.stdout)}));
});
test('production coordinator serializes simultaneous moves and recovers deferred seasons after a lost wake',async t=>{
 t.mock.timers.enable({apis:['Date'],now:NOW});const f=await fullFixture({pairs:2});t.after(()=>f.close());await finishProjection(f,t);await f.db.prepare("UPDATE sync_jobs SET next_at=? WHERE stage='source'").bind(NOW+86400000).run();for(const sql of crossSeasonStatements)await f.db.prepare(sql).run();
 await f.db.prepare("UPDATE source_events SET starts_at='2027-07-13T18:00:00.000Z' WHERE id IN('a-public-001','z-private-001')").run();await f.db.prepare("UPDATE team_event_season_resolutions SET team_season_id='next',starts_at='2027-07-13T18:00:00.000Z',local_day='2027-07-13',effective_day='2027-07-13' WHERE event_id IN('canonical-a-public-001','canonical-z-private-001')").run();await new ApplicationSyncService(f.db,{}).enqueueProjection('team','season',{wake:false});await f.runtime.wake();
 let interrupted=false,maximum=0;
 for(let page=0;page<150;page++){
  t.mock.timers.setTime(Math.max(Date.now(),f.alarm));await f.runtime.alarm();const result=f.values.get('last_run');maximum=Math.max(maximum,result.statements);assert.ok(result.statements<=50);assert.ok(!['error','retrying','failed','blocked'].includes(result.state),JSON.stringify(result));
  if(!interrupted&&f.sqlite.prepare("SELECT COUNT(*) n FROM team_game_publish_batches WHERE state='published'").get().n){interrupted=true;assert.ok(f.sqlite.prepare("SELECT COUNT(*) n FROM team_projection_state WHERE pending=1").get().n>0);f.values.delete('connection_recovery_pending');f.values.delete('last_run');await f.runtime.wake();}
  if(interrupted&&f.sqlite.prepare("SELECT COUNT(*) n FROM team_projection_state WHERE pending=1").get().n===0&&f.sqlite.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE provider='domain' AND component='projection' AND state<>'ready'").get().n===0)break;assert.ok(page<149);
 }
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_events WHERE team_season_id='next'").get().n,2);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM team_projection_runs WHERE state='obsolete'").get().n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_game_source_rows').get().n,4);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_game_publish_batches').get().n,1);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);t.diagnostic(JSON.stringify({maximum,interrupted}));
});
