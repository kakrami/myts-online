import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConnectionCommand,connectionRequestKey} from '../src/domain/connection-commands.js';
import {nativeCanonicalId} from '../src/domain/identity.js';
const body=()=>({request_id:'request-a',source_team_id:'gotsport/public/123',new_team:{name:'  Test team  ',timezone:'UTC',kind:'own'}});
test('modern normalized selections have no invented year and use full immutable SHA256 payload hashes',async()=>{
  const input=body(),normalized=await normalizeConnectionCommand(input);assert.equal(normalized.newTeam.season_year,null);assert.equal(normalized.scope,null);assert.match(normalized.payloadHash,/^[0-9a-f]{64}$/);
  const reordered=await normalizeConnectionCommand({...input,new_team:{kind:'own',timezone:'UTC',name:'Test team'}});assert.equal(normalized.payloadHash,reordered.payloadHash);
});
test('v1 identity verification uses precisely the original normalized command fields',async()=>{
  const input=body();input.new_team.season_year=2024;const normalized=await normalizeConnectionCommand(input);
  assert.equal(normalized.legacyTeamId,await nativeCanonicalId('connection',JSON.stringify({request_id:'request-a',source_team_id:'gotsport/public/123',account_id:null,new_team:{name:'Test team',timezone:'UTC',season_year:2024,kind:'own'}})));
});
test('request ID is independent of the payload hash but a changed selection changes the hash',async()=>{
  const first=await normalizeConnectionCommand(body()),second=await normalizeConnectionCommand({...body(),request_id:'request-b'}),changed=await normalizeConnectionCommand({...body(),new_team:{...body().new_team,season_year:2024}});
  assert.equal(first.payloadHash,second.payloadHash);assert.notEqual(first.legacyTeamId,second.legacyTeamId);assert.notEqual(first.payloadHash,changed.payloadHash);
});
test('fixed-season identity is stable over ordering and duplicate IDs',async()=>{
  const first=await normalizeConnectionCommand({request_id:'one',source_team_id:'gotsport/public/1',team_id:'team',scope:{mode:'fixed_seasons',season_ids:['b','a','a']}}),second=await normalizeConnectionCommand({request_id:'two',source_team_id:'gotsport/public/1',team_id:'team',scope:{mode:'fixed_seasons',season_ids:['a','b']}});
  assert.deepEqual(first.scope.season_ids,['a','b']);assert.equal(first.payloadHash,second.payloadHash);
});
test('ambiguous destinations, invalid scope, forbidden years and unbounded receipt IDs are rejected',async()=>{
  for(const value of [{}, {...body(),team_id:'existing'}, {...body(),team_id:''}, {...body(),season_id:'old'}, {...body(),new_team:{...body().new_team,timezone:'Not/AZone'}}, {...body(),new_team:{...body().new_team,season_year:1999}}, {...body(),scope:{mode:'fixed_seasons',season_ids:['elsewhere']}}, {...body(),scope:{mode:'observed_history',season_ids:[]}}, {...body(),connection_generation:-1}])await assert.rejects(normalizeConnectionCommand(value));
  for(const value of ['',null,'bad/key','a'.repeat(129)])assert.throws(()=>connectionRequestKey(value));
});
