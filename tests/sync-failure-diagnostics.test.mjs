import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {BudgetDB} from '../src/sync/budget.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {SyncError,classifyFailure,logSyncFailure} from '../src/sync/errors.js';

const NOW=Date.parse('2026-10-13T00:00:00Z'),SECRET='PRIVATE_DIAGNOSTIC_MARKER';
const lease={provider:'domain',component:'projection',stage:'projection',attempts:3,generation:2,last_attempt_at:NOW,lease_until:NOW+45000,id:SECRET,args:{secret:SECRET},checkpoint:{secret:SECRET}};
function capture(t) {
  const messages=[];t.mock.method(console,'warn',(...args)=>messages.push(args));return messages;
}
function logReason(error) {
  logSyncFailure('commit',error,{lease});
}
async function fixture(t) {
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
  for(const sql of [...DOMAIN_SCHEMA,...SYNC_SCHEMA])sqlite.exec(sql);
  sqlite.prepare("INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES(?,?,'UTC',2026,?)").run(SECRET,SECRET,new Date(NOW).toISOString());
  sqlite.prepare('INSERT INTO team_read_state(app_team_id) VALUES(?)').run(SECRET);
  const batches=[],errors=[];
  const prepare=(sql,params=[])=>({bind(...values){return prepare(sql,values);},async all(){const results=sqlite.prepare(sql).all(...params).map(row=>({...row}));return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}};},async run(){return this.all();},async first(){return(await this.all()).results[0]??null;}});
  const raw={prepare,async batch(statements){batches.push(statements.length);sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){errors.push(error);sqlite.exec('ROLLBACK');throw error;}}};
  const coordinator=new JobCoordinator(raw);
  const id=await coordinator.enqueue({provider:'domain',component:'projection',stage:'projection',scope:SECRET,resourceKey:SECRET,args:{secret:SECRET},recurring:false},[{kind:'team',key:SECRET,teamId:SECRET}]);batches.length=0;
  const values=new Map();let alarm=null;
  const storage={async get(key){return values.get(key);},async put(key,value){values.set(key,value);},async getAlarm(){return alarm;},async setAlarm(value){alarm=value;},async deleteAlarm(){alarm=null;}};
  return {sqlite,raw,batches,errors,id,storage,values,get alarm(){return alarm;}};
}
const invalidPage={statements:[{sql:'INSERT INTO domain_team_preconditions(id,expected_input,actual_input) SELECT 1,1,0 WHERE $FENCE',params:[]}],checkpoint:{secret:SECRET},complete:false};
const validPage={statements:[],checkpoint:{page:1},complete:true};

for(const [name,original,reason] of [
  ['SQLite commit rejection',null,'precondition'],
  ['collector rejection',new SyncError('contract_violation',SECRET),'contract'],
])test(`${name} remains visible when the real failure write exhausts BudgetDB`,async t=>{
  const f=await fixture(t),messages=capture(t),budget=new BudgetDB(f.raw,10),coordinator=new JobCoordinator(budget);
  const failures=[],fail=coordinator.fail.bind(coordinator);
  coordinator.fail=async(lease,error)=>{failures.push(error);try{return await fail(lease,error);}catch(secondary){failures.push(secondary);throw secondary;}};
  let thrown;
  try {await coordinator.runOne(async({db})=>{
    for(let i=0;i<(original?7:2);i++)await db.prepare('SELECT 1').first();
    if(original)throw original;return invalidPage;
  });}catch(error){thrown=error;}
  assert.strictEqual(thrown,failures[1]);assert.strictEqual(failures[0],original??f.errors[0]);
  assert.equal(thrown.code,'invocation_budget');assert.equal(budget.used,10);assert.equal(budget.remaining,0);
  assert.deepEqual(f.batches,original?[3]:[3,5],'no diagnostic DB reads or writes');
  const job=f.sqlite.prepare('SELECT state,attempts,failures,pages_saved,checkpoint,last_error_code FROM sync_jobs WHERE id=?').get(f.id);
  assert.deepEqual({...job},{state:'running',attempts:1,failures:0,pages_saved:0,checkpoint:'{}',last_error_code:null});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM domain_team_preconditions').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM sync_commit_fences').get().n,0);
  assert.deepEqual(messages.map(([value])=>[value.phase,value.reason]),[[original?'collect':'commit',reason],['fail','invocation_budget']]);
  assert.equal(messages[1][0].original_reason,reason);assert.equal(messages[1][0].original_phase,original?'collect':'commit');
  assert.deepEqual(messages[0][0],{event:'sync_failure_diagnostic',phase:original?'collect':'commit',reason,statements_used:10,statements_remaining:0,attempt:1,generation:1,elapsed_ms:0,lease_remaining_ms:45000});
  assert.equal(JSON.stringify(messages).includes(SECRET),false);
});

test('real runtime still resolves and persists the same masked budget status, while logging both errors',async t=>{
  const f=await fixture(t),messages=capture(t);
  const Runtime=createSyncRuntime(async({db})=>{for(let i=0;i<2;i++)await db.prepare('SELECT 1').first();return invalidPage;},{statementLimit:10});
  const runtime=new Runtime({storage:f.storage},{DB:f.raw});
  assert.equal(await runtime.alarm(),undefined);assert.equal(runtime.running,null);
  assert.equal(f.values.get('last_run').state,'error');assert.deepEqual(f.values.get('last_run').error,classifyFailure(new SyncError('invocation_budget','Continue in another invocation.',{retryAfterMs:1000})));
  assert.equal(f.values.get('last_run').statements,10);assert.equal(f.alarm,NOW+45500);
  assert.deepEqual(messages.map(([value])=>[value.phase,value.reason]),[['commit','precondition'],['fail','invocation_budget'],['runtime_job','invocation_budget']]);
  assert.equal(f.sqlite.prepare('SELECT attempts FROM sync_jobs WHERE id=?').get(f.id).attempts,1);
  assert.equal(JSON.stringify(messages).includes(SECRET),false);assert.deepEqual(f.batches,[3,5]);
});

test('a committed claim whose response is lost logs runtime_claim with no invented lease fields',async t=>{
  const f=await fixture(t),messages=capture(t),error=new Error(SECRET),batch=f.raw.batch.bind(f.raw);let calls=0;
  f.raw.batch=async statements=>{const result=await batch(statements);if(++calls===1)throw error;return result;};
  const Runtime=createSyncRuntime(async()=>{assert.fail('the lost claim never returned a lease');});
  await new Runtime({storage:f.storage},{DB:f.raw}).alarm();
  assert.equal(f.sqlite.prepare('SELECT attempts FROM sync_jobs WHERE id=?').get(f.id).attempts,1);
  assert.deepEqual(messages,[[{event:'sync_failure_diagnostic',phase:'runtime_claim',reason:'unknown',statements_used:3,statements_remaining:45,elapsed_ms:0}]]);
  assert.deepEqual(f.values.get('last_run').error,classifyFailure(error));assert.deepEqual(f.batches,[3]);
});

test('real commit and fail lease loss retain unchanged result classifications and no writes',async t=>{
  const f=await fixture(t),messages=capture(t),db=new BudgetDB(f.raw,48),coordinator=new JobCoordinator(db),claimed=await coordinator.claim();
  t.mock.timers.setTime(NOW+45001);
  assert.deepEqual(await coordinator.commit(claimed,validPage),{state:'lease_lost',committed:false});
  const original=new Error(SECRET);
  assert.deepEqual(await coordinator.fail(claimed,original),{state:'lease_lost',error:classifyFailure(original)});
  assert.deepEqual(messages.map(([value])=>[value.phase,value.reason,value.lease_remaining_ms]),[['commit','lease_lost',0],['fail','lease_lost',0]]);
  assert.equal(f.sqlite.prepare('SELECT failures+pages_saved n FROM sync_jobs WHERE id=?').get(f.id).n,0);
  assert.deepEqual(f.batches,[3,4,3]);
});

test('successful jobs and successfully recorded failures keep the original results',async t=>{
  const f=await fixture(t),messages=capture(t),coordinator=new JobCoordinator(new BudgetDB(f.raw,48));
  const result=await coordinator.runOne(async()=>validPage);
  assert.deepEqual(result,{jobId:f.id,provider:'domain',component:'projection',stage:'projection',state:'ready',committed:true,coverage:'complete'});
  assert.deepEqual(messages,[]);
  f.sqlite.prepare("UPDATE sync_jobs SET state='queued',next_at=? WHERE id=?").run(NOW,f.id);
  const original=new SyncError('contract_violation',SECRET),failed=await coordinator.runOne(async()=>{throw original;});
  assert.deepEqual(failed,{jobId:f.id,provider:'domain',component:'projection',stage:'projection',state:'retrying',error:classifyFailure(original)});
  assert.deepEqual(messages.map(([value])=>[value.phase,value.reason]),[['collect','contract']]);
});

test('only exact allowlisted D1/SQLite messages and codes become static reasons',t=>{
  const messages=capture(t);
  const cases=[
    [{message:'D1_ERROR: CHECK constraint failed: expected_input=actual_input: SQLITE_CONSTRAINT'},'precondition'],
    [{message:'D1_ERROR: CHECK constraint failed: '+SECRET+': SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)'},'constraint_check'],
    [{message:'D1_ERROR: CHECK constraint failed: expected_input=actual_input: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_'+SECRET+')'},'unknown'],
    [{message:'D1_ERROR: CHECK constraint failed: expected_input=actual_input: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK) '+SECRET},'unknown'],
    [{message:'D1_ERROR: CHECK constraint failed: expected_input=actual_input: SQLITE_ERROR (extended: SQLITE_CONSTRAINT_CHECK)'},'unknown'],
    [{message:'D1_ERROR: team_game_scope_mismatch: SQLITE_CONSTRAINT'},'constraint_scope'],
    [{message:'D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT'},'constraint_foreign_key'],
    [{message:'D1_ERROR: UNIQUE constraint failed: secret_table.secret_column: SQLITE_CONSTRAINT'},'constraint_unique'],
    [{message:'D1_ERROR: NOT NULL constraint failed: secret_table.secret_column: SQLITE_CONSTRAINT'},'constraint_not_null'],
    [{message:'D1_ERROR: CHECK constraint failed: '+SECRET+': SQLITE_CONSTRAINT'},'constraint'],
    [{message:'D1_ERROR: Expression tree is too large (maximum depth 100): SQLITE_ERROR'},'sql_depth'],
    [{cause:new Error('too many terms in compound SELECT')},'sql_terms'],
    [{cause:{cause:{message:'D1_ERROR: too many SQL variables: SQLITE_ERROR'}}},'sql_parameters'],
    [{message:'string or blob too big'},'sql_size'],
    [{message:'D1_ERROR: team_game_extension_permit_required: SQLITE_CONSTRAINT'},'epoch'],
    [{code:'installation_maintenance',message:SECRET},'epoch'],
    [{code:'ERR_SQLITE_ERROR',errcode:275,errstr:SECRET},'constraint_check'],
    [{errno:787},'constraint_foreign_key'],[{code:'SQLITE_CONSTRAINT_TRIGGER'},'constraint_trigger'],
    [{code:'SQLITE_TOOBIG'},'sql_size'],[{code:SECRET,message:SECRET},'unknown'],
    [{message:SECRET+' too many SQL variables'},'unknown'],
    [{message:'too many SQL variables '+SECRET},'unknown'],
    [{message:'x'.repeat(2000)+'too many SQL variables'},'unknown'],
  ];
  for(const [error,expected] of cases){logReason(error);assert.equal(messages.at(-1)[0].reason,expected);}
  const text=JSON.stringify(messages);for(const secret of [SECRET,'secret_table','secret_column','D1_ERROR','SQLITE_'])assert.equal(text.includes(secret),false);
});

test('hostile errors, bounded causes, numeric fields and logger failures cannot leak or replace an exception',async t=>{
  const messages=capture(t);let invoked=0;
  const hostile={};for(const name of ['message','code','errcode','errno','cause','stack','toJSON','toString'])Object.defineProperty(hostile,name,{get(){invoked++;throw new Error(SECRET);}});
  logReason(hostile);logReason(Object.assign(Object.create({message:'too many SQL variables'}),{code:SECRET}));
  const revoked=Proxy.revocable({},{});revoked.revoke();logReason(revoked.proxy);
  const cyclic={};cyclic.cause=cyclic;logReason(cyclic);
  const deep={cause:{cause:{cause:{cause:{message:'too many SQL variables'}}}}};logReason(deep);
  assert.equal(invoked,0);assert.ok(messages.every(([entry])=>entry.reason==='unknown'));
  logSyncFailure('commit',hostile,{lease:{...lease,attempts:Infinity,generation:SECRET},db:{used:1e12,remaining:-1},started:NOW});
  assert.equal(messages.at(-1)[0].statements_used,1000000);assert.equal('generation' in messages.at(-1)[0],false);assert.equal('attempt' in messages.at(-1)[0],false);assert.equal('statements_remaining' in messages.at(-1)[0],false);
  assert.doesNotThrow(()=>logSyncFailure('commit',hostile,{lease,db:{get used(){throw new Error(SECRET);}}}));
  const count=messages.length;logSyncFailure(SECRET,hostile,{lease});logSyncFailure('collect',hostile,{lease:{...lease,provider:'teamsnap'}});assert.equal(messages.length,count);
  assert.equal(JSON.stringify(messages).includes(SECRET),false);
  const primary=new SyncError('contract_violation',SECRET),secondary=new Error(SECRET),coordinator=new JobCoordinator({});
  coordinator.claim=async()=>lease;coordinator.fail=async(_lease,error)=>{assert.strictEqual(error,primary);throw secondary;};
  t.mock.method(console,'warn',()=>{throw new Error('logger failure');});
  await assert.rejects(coordinator.runOne(async()=>{throw primary;}),error=>error===secondary);
});

// Exact Error.message shape observed in the held-expiry native D1 regression.
test('native extended CHECK suffix retains precondition when failure recording masks it',async t=>{
  const messages=capture(t),original=Object.freeze(new Error('D1_ERROR: CHECK constraint failed: expected_input=actual_input: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)'));
  const secondary=new SyncError('invocation_budget',SECRET),coordinator=new JobCoordinator({});
  coordinator.claim=async()=>lease;coordinator.commit=async()=>{throw original;};
  coordinator.fail=async(_lease,error)=>{assert.strictEqual(error,original);throw secondary;};
  await assert.rejects(coordinator.runOne(async()=>validPage),error=>error===secondary);
  assert.deepEqual(messages.map(([entry])=>[entry.phase,entry.reason]),[['commit','precondition'],['fail','invocation_budget']]);
  assert.equal(messages[1][0].original_phase,'commit');assert.equal(messages[1][0].original_reason,'precondition');
  const text=JSON.stringify(messages);for(const secret of [SECRET,'expected_input','actual_input','D1_ERROR','SQLITE_','extended'])assert.equal(text.includes(secret),false);
});
