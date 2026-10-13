import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {backup} from 'node:sqlite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {progressiveFixture,AT} from './fixtures/progressive-root-service-fixture.mjs';

function publishTrace(f){
 f.sqlite.exec("UPDATE source_events SET starts_at='2025-09-01T12:00:00Z',local_day='2025-09-01' WHERE id='source-event'");
 f.insert('team_projection_runs',{id:'historical-run',app_team_id:'team',team_season_id:'season',input_revision:1,state:'building',created_at:new Date(AT).toISOString(),team_game_version:1});
 f.insert('team_event_rows',{...f.one("SELECT * FROM team_event_rows WHERE run_id='team-run'"),run_id:'historical-run'});
 f.insert('team_game_source_rows',{run_id:'historical-run',app_team_id:'team',team_season_id:'season',target_event_id:'event',
  source_event_id:'source-event',association_id:null,original_event_id:'event',provider:'trace',account_id:'account',account_generation:1,
  entitlement_kind:'root',connection_id:'root',connection_generation:1,connection_input_revision:f.one("SELECT input_revision FROM team_source_connections WHERE id='root'").input_revision,membership_generation:1,
  attachment_id:'attachment',attachment_generation:1,connected_source_team_id:'source-team',participant_source_team_id:'source-team',
  source_hash:'event',source_input_revision:f.one("SELECT input_revision FROM source_event_state WHERE source_event_id='source-event'")?.input_revision??0,event_link_revision:1,own_proof_hash:'a'.repeat(64)});
 f.sqlite.exec("UPDATE team_projection_runs SET state='published' WHERE id='historical-run'; UPDATE team_projection_state SET published_run_id='historical-run'");
}
const tracking={component:'tracking',stage:'analysis',scope:'trace:20:trace:10:g0:1',resourceKey:'trace:20:trace:10:g0:1',args:{game_id:'20',team_id:'10',gid:'g0',half:1},priority:20};

test('historical published tracking finishes four pages on its input turns despite continuous priority-97 bulk',async t=>{
 const f=progressiveFixture(t);publishTrace(f);
 const id=await f.enqueue(tracking),bulk=await f.enqueue({resourceKey:'busy',priority:97});
 const jobs=new JobCoordinator(f.db,{clock:()=>AT,ordinaryTurn:4,pageDelayMs:0,publicHistory:true});
 for(let i=0;i<4;i++){
  const lease=await jobs.claim();assert.equal(lease.id,id);
  const result=await jobs.commit(lease,{statements:[],checkpoint:i===3?{finished:true}:{chunk:i+1},complete:i===3,rowsSaved:1});
  assert.equal(result.committed,true);
 }
 assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',id).state,'ready');
 assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',bulk).attempts,0);
 assert.equal(f.one('SELECT priority FROM sync_jobs WHERE id=?',id).priority,20);
 // No exclusive lock: ordinary bulk preference still serves the busy job.
 assert.equal((await new JobCoordinator(f.db,{clock:()=>AT,ordinaryTurn:2}).claim()).id,bulk);
});

for(const change of ['unpublished','wrong_team','wrong_account','revoked','denied'])test(`published-input preference does not admit ${change} work`,async t=>{
 const f=progressiveFixture(t);publishTrace(f);
 const id=await f.enqueue(tracking),bulk=await f.enqueue({resourceKey:'busy',priority:97});
 if(change==='unpublished')f.sqlite.exec('UPDATE team_projection_state SET published_run_id=NULL');
 if(change==='wrong_team')f.sqlite.prepare('UPDATE sync_jobs SET args=? WHERE id=?').run(JSON.stringify({...tracking.args,team_id:'999'}),id);
 if(change==='wrong_account')f.sqlite.prepare('UPDATE sync_jobs SET authorization_generation=2 WHERE id=?').run(id);
 if(change==='revoked')f.sqlite.exec('UPDATE team_source_connections SET generation=generation+1');
 if(change==='denied')f.sqlite.prepare("UPDATE sync_jobs SET state='blocked',last_error_code='source_access_denied',failure_kind='blocked' WHERE id=?").run(id);
 const before=f.one('SELECT state,checkpoint,attempts,last_error_code FROM sync_jobs WHERE id=?',id);
 const lease=await new JobCoordinator(f.db,{clock:()=>AT,ordinaryTurn:4,publicHistory:true}).claim();
 // Revoking the shared root makes both jobs ineligible.
 assert.equal(lease?.id??null,change==='revoked'?null:bulk);
 assert.deepEqual(f.one('SELECT state,checkpoint,attempts,last_error_code FROM sync_jobs WHERE id=?',id),before);
});

// Compile the actual claim statements with the SQL ceilings used by D1.
// This is a constrained SQLite check, not a deployed D1 acceptance test.
test('published-input claim fits D1 SQL limits',async t=>{
 const f=progressiveFixture(t);publishTrace(f);await f.enqueue(tracking);
 const diagnostic=readFileSync(new URL('../scripts/diagnostics/trace-input-service-class.sql',import.meta.url),'utf8');
 assert.deepEqual(f.sqlite.prepare(diagnostic).all(),[]);
 const queries=[{sql:diagnostic,params:[]}],prepare=f.db.prepare;
 f.db.prepare=sql=>{
  const statement=prepare(sql),bind=statement.bind;
  if(!sql.includes('?'))queries.push({sql,params:[]});
  statement.bind=(...params)=>{queries.push({sql,params});return bind(...params);};
  return statement;
 };
 assert.ok(await new JobCoordinator(f.db,{clock:()=>AT,ordinaryTurn:4}).claim());
 const dir=await mkdtemp(path.join(tmpdir(),'myts-input-sql-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await backup(f.sqlite,path.join(dir,'fixture.db'));await writeFile(path.join(dir,'queries.json'),JSON.stringify(queries));
 const proof=spawnSync('python3',['-c',`
import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1])
for key,value in [('SQLITE_LIMIT_EXPR_DEPTH',100),('SQLITE_LIMIT_COMPOUND_SELECT',5),('SQLITE_LIMIT_VARIABLE_NUMBER',100),('SQLITE_LIMIT_SQL_LENGTH',100000)]: c.setlimit(getattr(sqlite3,key),value)
queries=json.load(open(sys.argv[2]))
assert queries
for q in queries: c.execute('EXPLAIN '+q['sql'],q['params']).fetchall()
print(json.dumps({'statements':len(queries),'maxSqlBytes':max(len(q['sql'].encode()) for q in queries),'maxParameters':max(len(q['params']) for q in queries)}))
`,path.join(dir,'fixture.db'),path.join(dir,'queries.json')],{encoding:'utf8'});
 assert.equal(proof.status,0,proof.stderr);t.diagnostic(proof.stdout.trim());
});

test('bounded queue diagnostic orders eligible predecessors and measures saved progress',async t=>{
 const f=progressiveFixture(t);publishTrace(f);
 f.sqlite.exec("UPDATE source_events SET starts_at='2026-10-01T12:00:00Z',local_day='2026-10-01' WHERE id='source-event'");
 const id=await f.enqueue(tracking);
 const peer=await f.enqueue({...tracking,component:'analytics',resourceKey:'trace:20:trace:10:peer',scope:'trace:20:trace:10:peer',priority:80});
 const denied=await f.enqueue({...tracking,component:'radar',resourceKey:'trace:20:trace:10:radar',scope:'trace:20:trace:10:radar',priority:90});
 f.sqlite.prepare("UPDATE sync_jobs SET state='blocked',last_error_code='source_access_denied' WHERE id=?").run(denied);
 const stale=await f.enqueue({...tracking,resourceKey:'trace:20:trace:10:stale',scope:'trace:20:trace:10:stale',priority:90});
 f.sqlite.prepare('UPDATE sync_jobs SET authorization_generation=2 WHERE id=?').run(stale);
 await f.enqueue({...tracking,resourceKey:'foreign',scope:'foreign',args:{...tracking.args,game_id:'999'}});
 const sql=readFileSync(new URL('../scripts/diagnostics/trace-queue-progress.sql',import.meta.url),'utf8')
 .replaceAll('d02d51f9-19b1-45c3-87bc-99ca2d3ccec5','historical-run')
 .replaceAll('d40e451b-e917-4c58-a5b8-050605a8b673',id)
 .replace("CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)",String(AT))
 .replaceAll("julianday('now')",`julianday('${new Date(AT).toISOString()}')`);
 const before=f.sqlite.prepare(sql).get();
 assert.equal(before.scoped_matches,1);assert.equal(before.scoped_jobs,4);
 assert.equal(before.eligible,1);assert.equal(before.scoped_eligible_class4,2);assert.equal(before.scoped_predecessors,1);
 const coordinator=new JobCoordinator(f.db,{clock:()=>AT,ordinaryTurn:4});
 const lease=await coordinator.claim();assert.equal(lease.id,peer);
 assert.equal((await coordinator.commit(lease,{statements:[],complete:true,rowsSaved:2})).committed,true);
 const after=f.sqlite.prepare(sql).get();
 assert.equal(after.scoped_predecessors,0);assert.equal(after.pages_sum-before.pages_sum,1);
 assert.equal(after.analytics_complete-before.analytics_complete,1);
 assert.equal(after.attempts_sum-before.attempts_sum,1);
 assert.equal(after.pages_saved,before.pages_saved);assert.equal(after.scan_id,before.scan_id);
 assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',denied).attempts,0);
});
