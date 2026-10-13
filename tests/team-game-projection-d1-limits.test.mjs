import test from 'node:test';
import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fullFixture,forceEquivalentProjection,finishProjection} from './team-game-projection-coordinator.test.mjs';
const NOW=Date.parse('2026-10-13T00:00:00Z');
test('every48-pair coordinator query compiles within native D1 expression100 compound5 parameters100 SQL100k',async t=>{
 t.mock.timers.enable({apis:['Date'],now:NOW});const f=await fullFixture({pairs:48});t.after(()=>f.close());
 for(let page=0;page<80;page++){
  t.mock.timers.setTime(Math.max(Date.now(),f.alarm));await f.runtime.alarm();const run=f.values.get('last_run');assert.ok(!['error','retrying','failed','blocked'].includes(run.state),JSON.stringify(run));
  if(f.sqlite.prepare('SELECT state FROM sync_jobs WHERE id=?').get(f.jobId).state==='ready')break;assert.ok(page<79);
 }
 await forceEquivalentProjection(f);await finishProjection(f,t);
 const directory=await mkdtemp(path.join(tmpdir(),'myts-projection-sql-limits-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const database=path.join(directory,'fixture.db'),queries=path.join(directory,'queries.json');await backup(f.sqlite,database);await writeFile(queries,JSON.stringify(f.queries));
 const proof=spawnSync('python3',['-c',`
import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1])
for key,value in [('SQLITE_LIMIT_EXPR_DEPTH',100),('SQLITE_LIMIT_COMPOUND_SELECT',5),('SQLITE_LIMIT_VARIABLE_NUMBER',100),('SQLITE_LIMIT_SQL_LENGTH',100000)]: c.setlimit(getattr(sqlite3,key),value)
queries=json.load(open(sys.argv[2]));seen=set()
for i,q in enumerate(queries):
 if q['sql'] in seen: continue
 seen.add(q['sql'])
 try: c.execute('EXPLAIN '+q['sql'],q['params']).fetchall()
 except Exception as e: raise RuntimeError('query '+str(i)+' failed: '+str(e)+'; SQL='+q['sql'][:500]) from e
print(json.dumps({'queries':len(queries),'uniqueStatements':len(seen),'maxSqlBytes':max(len(q['sql'].encode()) for q in queries),'maxParameters':max(len(q['params']) for q in queries)}))
`,database,queries],{encoding:'utf8',maxBuffer:1_000_000});
 assert.equal(proof.status,0,proof.stderr);t.diagnostic(proof.stdout.trim());assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM team_events').get().n,48);
});
