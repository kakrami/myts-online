import test from 'node:test';
import assert from 'node:assert/strict';
import {freshHarness,TEST_PASSWORD} from './fresh-harness.js';
import {SCHEMA} from '../src/application/installation-schema.js';

test('schema completion yields before owner derivation and gated commit on a fresh 48-statement request',async()=>{
 const h=await freshHarness();try{
  let final,steps=0;
  do{
   final=await h.request('/api/owner/initialize',{method:'POST',body:{password:TEST_PASSWORD}});
   assert.equal(final.status,202,JSON.stringify(final.data));assert.equal(final.data.continue,true);
   assert.equal(final.headers.get('set-cookie'),null);
   assert.ok(++steps<=Math.ceil(SCHEMA.length/30)+1);
  }while(final.data.setup.state!=='ready');
  const row=await h.rawDb.prepare('SELECT next_index,state,(SELECT COUNT(*) FROM security_owner) owners,(SELECT COUNT(*) FROM security_installation) vaults,(SELECT COUNT(*) FROM security_sessions) sessions FROM setup_state WHERE id=1').first();
  assert.deepEqual(row,{next_index:SCHEMA.length,state:'ready',owners:0,vaults:0,sessions:0});
  const initialized=await h.request('/api/owner/initialize',{method:'POST',body:{password:TEST_PASSWORD}});
  assert.equal(initialized.status,200,JSON.stringify(initialized.data));assert.equal(initialized.data.continue,false);assert.equal(initialized.data.setup.owner_ready,true);assert.ok(initialized.headers.get('set-cookie'));
  assert.deepEqual(await h.rawDb.prepare('SELECT (SELECT COUNT(*) FROM security_owner) owners,(SELECT COUNT(*) FROM security_installation) vaults,(SELECT COUNT(*) FROM security_sessions) sessions').first(),{owners:1,vaults:1,sessions:1});
 }finally{await h.dispose();}
});
