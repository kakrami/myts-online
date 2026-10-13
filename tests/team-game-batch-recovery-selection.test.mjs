import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ApplicationSyncService} from '../src/application/sync-service.js';

// Isolated relational selection proof. The actual full-schema batch lifecycle
// and coordinator/native transactions are tested by the projector fixtures.
function fixture(t,state='preparing'){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec(`CREATE TABLE team_projection_state(app_team_id TEXT,team_season_id TEXT,pending INTEGER);
 CREATE TABLE sync_jobs(id TEXT,provider TEXT,account_scope TEXT,component TEXT,scope TEXT,resource_key TEXT,state TEXT,args TEXT,next_at INTEGER);
 CREATE TABLE team_source_connections(id TEXT,app_team_id TEXT,active INTEGER,input_revision INTEGER,reconciled_revision INTEGER,generation INTEGER);
 CREATE TABLE team_lifecycle(team_id TEXT);
 CREATE TABLE team_game_publish_batches(app_team_id TEXT,state TEXT,from_team_season_id TEXT,to_team_season_id TEXT);
 INSERT INTO team_projection_state VALUES('team','from',1),('team','to',1),('team','third',1),('other','other-season',1);`);
 sqlite.prepare('INSERT INTO team_game_publish_batches VALUES(?,?,?,?)').run('team',state,'from','to');
 const db={prepare(sql){
  return {bind(...args){
   return {async all(){return {results:sqlite.prepare(sql).all(...args).map(row=>({...row}))};}};
  }};
 }};
 const service=new ApplicationSyncService(db,{}),queued=[];
 service.enqueueProjection=async(team,season)=>{queued.push([team,season]);sqlite.prepare("INSERT INTO sync_jobs VALUES(?,'domain','public','projection',?,?,'queued','{}',0)").run(team+':'+season,team,season);return {queued:true};};
 return {sqlite,service,queued};
}
for(const state of ['preparing','ready'])test('active '+state+' batch defers destination without suppressing owner or other work',async t=>{
 const f=fixture(t,state);assert.equal((await f.service.recoverProjections({limit:5,wake:false})).queued,3);assert.deepEqual(f.queued,[['other','other-season'],['team','from'],['team','third']]);
 assert.deepEqual(await f.service.recoverProjections({limit:5,wake:false}),{queued:0,more:false});
 f.sqlite.exec("DELETE FROM sync_jobs WHERE resource_key='from'");assert.equal((await f.service.recoverProjections({limit:5,wake:false})).queued,1);assert.deepEqual(f.queued.at(-1),['team','from']);
});
for(const state of ['published','obsolete'])test('terminal '+state+' batch permits destination recovery',async t=>{const f=fixture(t,state);assert.equal((await f.service.recoverProjections({limit:5,wake:false})).queued,4);assert.ok(f.queued.some(([,season])=>season==='to'));});
test('same-named foreign batch cannot suppress another team',async t=>{const f=fixture(t);f.sqlite.exec("UPDATE team_game_publish_batches SET app_team_id='foreign'");assert.equal((await f.service.recoverProjections({limit:5,wake:false})).queued,4);});
test('batch recovery retains dirty-root and lifecycle barriers',async t=>{const f=fixture(t);f.sqlite.exec("INSERT INTO team_source_connections VALUES('root','team',1,2,1,1);INSERT INTO team_lifecycle VALUES('other')");assert.deepEqual(await f.service.recoverProjections({limit:5,wake:false}),{queued:0,more:false});assert.deepEqual(f.queued,[]);});
