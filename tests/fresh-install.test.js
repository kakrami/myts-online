import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './harness.js';
import {FreshInstallation,installationSchema} from '../src/application/fresh-install.js';

const password='test-owner-password-for-fresh-install';
const schema=Array.from({length:65},(_,i)=>`CREATE TABLE fresh_${i}(id TEXT PRIMARY KEY,value TEXT)`);
test('fresh initialization is bounded, resumable, idempotent and rejects other schemas',async()=>{
  const h=await harness({setup:false});
  try{
    const install=new FreshInstallation(h.db,{schema,bootstrapPassword:password});
    assert.deepEqual(await install.inspect(),{state:'empty',progress:0});
    await assert.rejects(install.advance('incorrect'),e=>e.code==='password_incorrect');
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'fresh_%' OR name='setup_state'").first()).n,0);
    let result=await install.advance(password);assert.equal(result.continue,true);assert.equal(result.setup.progress,46);
    // Simulate a process disappearing between phases: no in-memory state is retained.
    const resumed=new FreshInstallation(h.db,{schema,bootstrapPassword:password});
    result=await resumed.advance(password);assert.equal(result.setup.progress,92);
    result=await resumed.advance(password);assert.equal(result.continue,false);assert.equal(result.setup.state,'ready');
    assert.deepEqual(await resumed.advance(password),result);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'fresh_%'").first()).n,65);
    await assert.rejects(new FreshInstallation(h.db,{schema:[...schema,'CREATE TABLE extra(id TEXT)'],bootstrapPassword:password}).inspect(),e=>e.code==='fresh_database_required');
  }finally{await h.dispose();}
});
test('populated and partially foreign databases cannot be initialized',async()=>{
  const h=await harness({setup:false});
  try{
    await h.db.prepare('CREATE TABLE existing(id TEXT)').run();
    await assert.rejects(new FreshInstallation(h.db,{schema,bootstrapPassword:password}).advance(password),e=>e.code==='fresh_database_required');
  }finally{await h.dispose();}
});
test('an interrupted atomic phase makes no partial schema progress and can retry',async()=>{
  const h=await harness({setup:false});let crash=false;
  const db={prepare:sql=>h.db.prepare(sql),batch:async statements=>{if(crash){crash=false;throw new Error('Simulated interruption before commit.');}return h.db.batch(statements);}};
  try{
    const install=new FreshInstallation(db,{schema,bootstrapPassword:password});
    await install.advance(password);crash=true;
    await assert.rejects(install.advance(password),/interruption/);
    assert.equal((await install.inspect()).next_index,30);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'fresh_%'").first()).n,30);
    assert.equal((await install.advance(password)).setup.progress,92);
  }finally{await h.dispose();}
});
test('installation accepts only CREATE statements and at most thirty per phase',()=>{
  assert.throws(()=>installationSchema([['ALTER TABLE previous ADD COLUMN value TEXT']]),/invalid/);
  assert.throws(()=>new FreshInstallation({}, {schema,bootstrapPassword:password,batchSize:31}),/batch/);
});
test('a ready installation refuses missing required tables or its domain seed',async()=>{
  const h=await harness({setup:false});
  try{
    const required=['CREATE TABLE domain_installation(id INTEGER PRIMARY KEY,schema_version INTEGER)','CREATE TABLE required_record(id TEXT PRIMARY KEY)'];
    const seed=[{sql:'INSERT INTO domain_installation(id,schema_version) VALUES(1,1)',params:[]}];
    const install=new FreshInstallation(h.db,{schema:required,seed,bootstrapPassword:password});
    assert.equal((await install.advance(password)).setup.state,'ready');
    await h.db.prepare('DROP TABLE required_record').run();
    await assert.rejects(install.inspect(),error=>error.code==='installation_incomplete');
    await assert.rejects(install.advance(password),error=>error.code==='installation_incomplete');
    await h.db.prepare(required[1]).run();
    await h.db.prepare('DELETE FROM domain_installation WHERE id=1').run();
    await assert.rejects(install.inspect(),error=>error.code==='installation_incomplete');
  }finally{await h.dispose();}
});
