import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';

const queries=readFileSync(new URL('../scripts/diagnostics/trace-input-evidence.sql',import.meta.url),'utf8')
 .replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
const run='d02d51f9-19b1-45c3-87bc-99ca2d3ccec5';

test('all diagnostic SELECTs compile against the actual complete schemas',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const sql of [...DOMAIN_SCHEMA,...SYNC_SCHEMA,...ANALYSIS_SCHEMA])db.exec(sql);
  assert.equal(queries.length,4);
  for(const query of queries){assert.match(query,/^(SELECT|WITH)\b/);db.prepare(query).all();}
 }finally{db.close();}
});

test('populated diagnostics find analysis-stage provider children and exclude other scopes',()=>{
 const db=new DatabaseSync(':memory:');try{
  // Minimal relational fixture; full-schema compilation is independently tested above.
  db.exec(`CREATE TABLE team_game_source_rows(run_id,source_event_id,connected_source_team_id,account_id,provider);
   CREATE TABLE source_events(id,native_id); CREATE TABLE source_teams(id,native_id);
   CREATE TABLE team_projection_state(published_run_id);
   CREATE TABLE sync_jobs(id,provider,account_id,args,stage,component,state,coverage,last_error_code,
    attempts,rows_saved,last_saved_at,scope,scan_id,failures,failure_kind,last_attempt_at,next_at);
   CREATE TABLE source_component_coverage(provider,account_id,kind,scope,complete,scan_id);
   CREATE TABLE source_trace_components(source_event_id,source_team_id,account_id,kind,half,provenance,observed_at,evidence);
   CREATE TABLE source_tracking_segments(source_event_id,source_team_id,account_id,half);
   CREATE TABLE sync_observations(id,job_id,at,attempt,scan_id,status,error_code,bytes,retrieved_at,rows_count,endpoint);`);
  db.prepare('INSERT INTO team_game_source_rows VALUES(?,?,?,?,?)').run(run,'event','team','account','trace');
  db.prepare('INSERT INTO team_projection_state VALUES(?)').run(run);
  db.exec("INSERT INTO source_events VALUES('event','20'); INSERT INTO source_teams VALUES('team','10');");
  const insert=(id,component,{game='20',team='10',account='account',stage='analysis'}={})=>{
   const args=JSON.stringify({game_id:game,team_id:team,half:1,url:'https://go.traceup.com/private-person/radar.json?token=DO_NOT_RETURN',name:'DO_NOT_RETURN'});
   db.prepare('INSERT INTO sync_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    id,'trace',account,args,stage,component,component==='radar'?'blocked':'ready',component==='radar'?'none':'complete',
    component==='radar'?'source_access_denied':null,1,component==='radar'?0:4,100,'trace:20:trace:10:g1:1','scan',0,
    component==='radar'?'blocked':null,90,101);
  };
  insert('tracking','tracking');insert('radar','radar');insert('analytics','analytics');
  insert('wrong-game','tracking',{game:'21'});insert('wrong-team','tracking',{team:'11'});
  insert('wrong-account','tracking',{account:'elsewhere'});insert('wrong-stage','tracking',{stage:'source'});
  db.exec("INSERT INTO source_component_coverage VALUES('trace','account','tracking','trace:20:trace:10:g1:1',1,'scan');");
  db.exec("INSERT INTO source_trace_components VALUES('event','team','account','clip',1,'provider','stamp','{}');");
  db.exec("INSERT INTO source_tracking_segments VALUES('event','team','account',1);");
  db.exec("INSERT INTO sync_observations VALUES('observation','radar',100,1,'scan',403,'source_access_denied',20,NULL,NULL,'https://go.traceup.com/private-person/radar.json');");
  const q2=db.prepare(queries[1]).all(),q3=db.prepare(queries[2]).all(),q4=db.prepare(queries[3]).all();
  assert.equal(q2.length,3);assert.ok(q2.every(r=>r.jobs===1&&r.scoped_matches===1&&r.publication_still_active===1));
  assert.equal(q3.length,2);assert.equal(q3[0].tracking_jobs,1);assert.equal(q3[0].current_scan_tracking_complete,1);
  assert.equal(q3[0].saved_tracking_complete,1);assert.equal(q3[1].tracking_jobs,0);
  assert.equal(q4.length,1);assert.equal(q4[0].job_id,'radar');assert.equal(q4[0].http_status,403);
  assert.equal(q4[0].endpoint_class,'asset_or_other_endpoint');assert.equal(q4[0].asset_has_query,1);
  assert.doesNotMatch(JSON.stringify([q2,q3,q4]),/DO_NOT_RETURN|private-person|https:\/\//);
  db.exec("UPDATE team_game_source_rows SET run_id='other-run'");
  for(const q of queries.slice(1))assert.equal(db.prepare(q).all().length,0,'never broaden past the anchored run');
 }finally{db.close();}
});
