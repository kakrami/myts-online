import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapModel} from '../src/application/bootstrap.js';

for(const state of ['maintenance','upgrade_required','upgrading'])test(`bootstrap exposes safe ${state} progress without reading private team or owner tables`,async()=>{
  const unavailable=new Proxy({},{get(){assert.fail('A maintenance bootstrap must not query application tables.');}});
  const result=await bootstrapModel(new Request('https://myts.example/api/bootstrap'),{
    db:unavailable,security:unavailable,
    installation:{inspect:async()=>({state,phase:'rosters',progress:62,cursor:'private-cursor',journal:{private:'journal'},schema_fingerprint:'private-fingerprint'})},
  });
  assert.deepEqual(result.setup,{state,phase:'rosters',progress:62});
  assert.deepEqual(result.session,{role:'anonymous'});
  assert.deepEqual(result.teams,[]);
  assert.doesNotMatch(JSON.stringify(result),/private-|journal|owner_ready/);
});

test('bootstrap omits unknown maintenance phase details',async()=>{
  const result=await bootstrapModel(new Request('https://myts.example/api/bootstrap'),{installation:{inspect:async()=>({state:'upgrading',phase:'unrecognized internal detail',progress:0})}});
  assert.deepEqual(result.setup,{state:'upgrading',progress:0});
});
