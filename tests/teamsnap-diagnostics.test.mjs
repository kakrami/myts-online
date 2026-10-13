import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSource,SourceTransport} from '../src/sources/index.js';
import {classifyFailure} from '../src/sync/errors.js';
import {annotateTeamSnapAttendance,teamSnapDiagnosticSuffix} from '../src/sources/teamsnap-diagnostics.js';
const account={id:'synthetic-account',provider:'teamsnap',native_id:'123',generation:1};
const secret='private-name-token-never-persist';
const row=(id,extra={})=>({id,team_id:321,event_id:4000+Number(id||1),member_id:100,status_code:1,...extra});
const collection=(rows,{links=[],itemLinks=[],href,info}={})=>({collection:{items:rows.map(r=>({data:Object.entries(r).map(([name,value])=>({name,value})),links:itemLinks,...(href?{href}:{})})),links,...(info?{page_info:info}:{})}});
async function collect(value,{kind='attendance'}={}){
 const transport=new SourceTransport({}, {fetch:async()=>Response.json(value)});
 try{return await collectSource({provider:'teamsnap',kind,scope:'teamsnap:321',args:{team_id:'321'},transport,credential:'synthetic-credential',account,scanId:'synthetic-scan'});}
 catch(error){assert.equal(transport.observations[0].status,200);assert.equal(transport.observations[0].code,null);throw error;}
}
async function rejected(value,reason,counts){
 let original;await assert.rejects(()=>collect(value),e=>{original=e;return e.code==='contract_violation';});
 const failure=classifyFailure(original);assert.equal(failure.code,'contract_violation');assert.equal(failure.kind,'permanent');
 assert.ok(failure.message.includes('Diagnostic: '+reason),failure.message);assert.ok(failure.message.length<512);assert.ok(!failure.message.includes(secret));
 for(const [key,value]of Object.entries(counts||{}))assert.ok(failure.message.includes(key+'='+value),failure.message);
 return failure;
}
test('opaque or missing availability IDs are accepted when numeric event/member pairs are valid',async()=>{
 for(const id of [undefined,null,secret,'100:200','1234567890123456']) {
  const page=await collect(collection([row(id,{event_id:4001})],{info:{total_items:1,page_size:100,page_number:1}}));
  assert.equal(page.records.attendance[0].fixture_id,'teamsnap:4001');assert.equal(page.records.attendance[0].player_id,'teamsnap:100');
  assert.ok(!JSON.stringify(page).includes(secret));
 }
});
test('duplicate event/member pairs remain rejected without exposing either identity; duplicate availability IDs alone are harmless',async()=>{
 await rejected(collection([row(1),row('1')]),'attendance_duplicate_pair',{items:2,valid_pairs:2,duplicate_pairs:1});
 const page=await collect(collection([row(1),row('1',{event_id:4002})],{info:{total_items:2,page_size:100,page_number:1}}));assert.equal(page.records.attendance.length,2);
});
test('foreign team guard remains authoritative and produces only a mismatch count',async()=>{
 await rejected(collection([row(1,{team_id:secret})]),'attendance_team_scope',{items:1,foreign_teams:1});
});
test('next-link diagnostic retains exact endpoint/filter/page guards without publishing URLs or query values',async()=>{
 const rows=Array.from({length:25},(_,i)=>row(i+1));
 const url='https://api.teamsnap.com/v3/availabilities/search?team_id=321&page_size=25&page_number=2';
 await rejected(collection(rows,{links:[{rel:'next',href:url}]}),'attendance_next_scope',{next_count:1,same_origin:1,same_path:1,same_query:0,next_number:1,unique_query:1,safe_url:1});
 await rejected(collection(rows,{links:[{rel:'next',href:url+'&sort_event_id=desc&page_number=999&secret='+secret}]}),'attendance_next_scope',{unique_query:0});
});
test('item and recognized action-link failures keep their exact static reason',async()=>{
 await rejected(collection([row(1)],{href:'https://'+secret+'.invalid/private'}),'attendance_link_scope');
 await rejected(collection([row(1)],{itemLinks:[{rel:'events',href:'https://'+secret+'.invalid/private'}]}),'attendance_link_scope');
 await rejected(collection([row(1)],{href:'https://api.teamsnap.com/v3/'+secret.repeat(100)}),'attendance_link_bound');
});
test('valid, unknown and null statuses retain their original successful normalized records',async()=>{
 for(const [status,expected]of [[0,'No'],['0','No'],[1,'Yes'],['1','Yes'],[2,'Maybe'],['2','Maybe'],[null,'NR'],[secret,'Unknown'],[{notes:secret},'Unknown']]) {
  const page=await collect(collection([row(1,{status_code:status})],{info:{total_items:1,page_size:100,page_number:1}}));assert.equal(page.records.attendance[0].normalized_status,expected);assert.equal(page.complete,false);assert.equal(page.checkpoint.previous.count,1);
 }
});
test('other providers/components and unknown or differently classified errors keep the exact original generic behavior',async()=>{
 const arbitrary=Object.assign(new Error(secret),{code:'contract_violation'});assert.equal(annotateTeamSnapAttendance(arbitrary,{kind:'attendance'}),arbitrary);assert.equal(arbitrary.teamsnapDiagnostic,undefined);
 assert.deepEqual(classifyFailure(arbitrary),{code:'contract_violation',kind:'permanent',message:'The collector result did not satisfy its storage contract.',retryAfterMs:0});
 const known=Object.assign(new Error('Source contains missing or duplicate native identities.'),{code:'contract_violation'});annotateTeamSnapAttendance(known,{kind:'events',raw:collection([row(secret)])});assert.equal(known.teamsnapDiagnostic,undefined);
 let missing;await assert.rejects(()=>collect(collection([row(1,{event_id:null})])),e=>(missing=e,e.code==='unsupported_response'));assert.equal(missing.teamsnapDiagnostic,undefined);assert.equal(classifyFailure(missing).message,'This source returned an unsupported data format.');
});
test('persistence independently rejects forged reason, count type/range, flags and every extra key',()=>{
 const base={code:'contract_violation',teamsnapDiagnostic:{reason:'attendance_identity',counts:{items:25,invalid_ids:1}}};
 const output=teamSnapDiagnosticSuffix(base);assert.ok(output.includes('items=25'));assert.ok(!output.includes(secret));assert.ok(!output.includes('secret'));
 assert.equal(teamSnapDiagnosticSuffix({...base,teamsnapDiagnostic:{...base.teamsnapDiagnostic,counts:{...base.teamsnapDiagnostic.counts,secret}}}), '');
 for(const value of [secret,NaN,Infinity,-1,501,1.5,null,[],{}])assert.equal(teamSnapDiagnosticSuffix({...base,teamsnapDiagnostic:{...base.teamsnapDiagnostic,counts:{items:value}}}), '');
 for(const reason of [secret,'__proto__','constructor',null,{},[]])assert.equal(teamSnapDiagnosticSuffix({...base,teamsnapDiagnostic:{reason,counts:{items:1}}}), '');
 assert.equal(teamSnapDiagnosticSuffix({...base,code:'authentication_required'}),'');
 assert.equal(teamSnapDiagnosticSuffix({...base,teamsnapDiagnostic:{reason:'attendance_next_scope',counts:{same_query:2}}}),'');
});
test('an oversized diagnostic input preserves the original error and emits no sampled count masquerading as a total',()=>{
 const e=Object.assign(new Error('Source contains missing or duplicate native identities.'),{code:'contract_violation'});annotateTeamSnapAttendance(e,{kind:'attendance',raw:collection(Array.from({length:501},()=>row(secret)))});
 assert.equal(teamSnapDiagnosticSuffix(e),' Diagnostic: attendance_identity.');assert.equal(e.code,'contract_violation');
});

test('diagnostic exceptions and oversized field shapes preserve the exact original permanent error',()=>{
 const make=()=>Object.assign(new Error('Source contains missing or duplicate native identities.'),{code:'contract_violation'});
 for(const raw of [{get collection(){throw new Error(secret);}}, {collection:{items:[{data:Array.from({length:129},(_,i)=>({name:'private'+i,value:secret}))}]}}]) {
  const e=make();assert.equal(annotateTeamSnapAttendance(e,{kind:'attendance',raw}),e);assert.equal(e.teamsnapDiagnostic,undefined);assert.equal(classifyFailure(e).kind,'permanent');assert.equal(classifyFailure(e).message,'The collector result did not satisfy its storage contract.');
 }
 const frozen=Object.freeze(make());assert.equal(annotateTeamSnapAttendance(frozen,{kind:'attendance',raw:collection([row(secret)])}),frozen);
 const hostile={code:'contract_violation',get teamsnapDiagnostic(){throw new Error(secret);}};assert.equal(teamSnapDiagnosticSuffix(hostile),'');
});
