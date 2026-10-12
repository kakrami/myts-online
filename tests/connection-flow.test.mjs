import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionFlow,sourceSeasonYear,ownerSessionExpired,discoveryMessage,importPhase} from '../web/app/connection-flow.js';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values};};
test('dismiss, newer flow and clear invalidate pending UI transitions',()=>{
 const flow=new ConnectionFlow();const first=flow.begin('trace');assert.ok(flow.current(first));flow.dismiss();assert.ok(!flow.current(first));const resumed=flow.resume();assert.ok(flow.current(resumed));assert.ok(!flow.current(first));flow.begin('teamsnap');assert.ok(!flow.current(resumed));flow.clear();assert.equal(flow.value,null);
});
test('refresh retains nonsecret attempt and destination while old tickets stay inactive',()=>{
 const storage=memory(),flow=new ConnectionFlow({storage});flow.begin('trace',{teamId:'team',seasonId:'season'});flow.update({attempt:'opaque-session-bound-attempt',attemptExpires:999,stage:'trace-code',email:'do-not-store',code:'123456',access_token:'do-not-store'});
 const restored=new ConnectionFlow({storage});assert.equal(restored.active,false);assert.equal(restored.value.attempt,'opaque-session-bound-attempt');assert.deepEqual(restored.value.destination,{teamId:'team',seasonId:'season'});assert.ok(!JSON.stringify([...storage.values]).includes('do-not-store'));assert.ok(!JSON.stringify([...storage.values]).includes('123456'));
});
test('one immutable request identity survives repeated submit, dismissal and reload',()=>{
 const storage=memory(),flow=new ConnectionFlow({storage,uuid:()=> 'stable-id'});flow.begin('gotsport');const pending=flow.pending('/api/connections',{source_team_id:'source',new_team:{name:'Named team',timezone:'UTC',season_year:2026,kind:'own'}});flow.dismiss();const restored=new ConnectionFlow({storage});restored.resume();const retry=restored.pending('/api/connections',{source_team_id:'different'});assert.deepEqual(retry,pending);assert.equal(retry.body.request_id,'stable-id');
});
test('stored command bodies and source metadata cannot persist authentication material',()=>{
 const storage=memory(),flow=new ConnectionFlow({storage});flow.begin('teamsnap');flow.update({source:{id:'team',provider:'teamsnap',name:'Team',access_token:'secret'},draft:{name:'Team',code:'secret'}});flow.pending('/api/connections',{source_team_id:'team',password:'secret',new_team:{name:'Team',access_token:'secret'}});assert.ok(!JSON.stringify([...storage.values]).includes('secret'));
});
test('provider 401 keeps the owner signed in; only explicit owner-session expiry signs out',()=>{
 assert.equal(ownerSessionExpired({status:401,code:'authentication_required'}),false);assert.equal(ownerSessionExpired({status:401,code:'provider_authorization_expired'}),false);assert.equal(ownerSessionExpired({status:401,code:'sign_in_required'}),true);assert.equal(ownerSessionExpired({status:403,code:'sign_in_required'}),false);
});
test('only an unambiguous consecutive source season label derives a year',()=>{
 assert.equal(sourceSeasonYear({season_label:'2026-2027'}),2026);assert.equal(sourceSeasonYear({season_label:'2025/26'}),2025);for(const season_label of ['2026','Fall','2026-2028','Spring 2026',null])assert.equal(sourceSeasonYear({season_label}),null);
});
test('discovery distinguishes pending, blocked, failed and no-access results',()=>{
 assert.match(discoveryMessage({discovery:{state:'queued'}}),/Finding/);assert.match(discoveryMessage({discovery:{state:'blocked'}}),/Reconnect/);assert.match(discoveryMessage({discovery:{state:'failed'}}),/Saved teams/);assert.match(discoveryMessage({total:0,discovery:{state:'ready'}}),/team access/);
});

test('import phases distinguish queue acceptance, active work, partial coverage and ready',()=>{
 assert.match(importPhase([{state:'queued',coverage:'none'}]),/queued/);assert.match(importPhase([{state:'running',coverage:'partial'}]),/Importing/);assert.match(importPhase([{state:'ready',coverage:'complete'}]),/Ready/);assert.match(importPhase([{state:'blocked',coverage:'restricted'}]),/attention/);assert.match(importPhase([{state:'ready',coverage:'unpublished'}]),/not published/);assert.doesNotMatch(importPhase([]),/Ready/);
});
