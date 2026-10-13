import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSource} from '../src/sources/index.js';
const api='https://api.teamsnap.com/v3/',account={provider:'teamsnap',id:'account',native_id:'123',generation:1};
const col=(rows,links=[])=>({collection:{items:rows.map(row=>({data:Object.entries(row).map(([name,value])=>({name,value})),links:[]})),links}});
async function collect(cursor={},handler){return collectSource({provider:'teamsnap',kind:'catalog',scope:account.id,cursor,credential:'synthetic',account,scanId:'scan',transport:{observations:[],async get(endpoint){return {value:await handler(endpoint)};}}});}
test('bare catalog metadata links normalize to account search while archived filters remain',async()=>{
 const calls=[],archived=api+'teams/search?user_id=123&is_archived=true';const handler=endpoint=>{calls.push(endpoint);if(endpoint===api+'me')return col([{id:123}],[{rel:'teams',href:api+'teams'},{rel:'archived_teams',href:archived}]);if(endpoint===api+'teams/search?user_id=123')return col([{id:321,name:'Active'}]);if(endpoint===archived)return col([{id:322,name:'Archived',is_archived:true}]);assert.fail('Unscoped/metadata request '+endpoint);};
 let cursor={},all=[];for(let i=0;i<4;i++){const page=await collect(cursor,handler);all.push(...page.records.teams||[]);if(page.complete)break;cursor=page.checkpoint;}
 assert.deepEqual(calls,[api+'me',api+'teams/search?user_id=123',archived]);assert.deepEqual(all.map(x=>x.native_id),['321','322']);assert.equal(all[1].archived,1);
});
test('old bare metadata continuation safely resumes via the same account search',async()=>{const calls=[];const page=await collect({url:api+'teams',offset:0,digest:null,remaining:[api+'teams'],visited:['old']},endpoint=>{calls.push(endpoint);return col([{id:321,name:'Saved team'}]);});assert.equal(page.complete,true);assert.deepEqual(calls,[api+'teams/search?user_id=123']);assert.equal(page.records.teams.length,1);assert.equal(page.replacements[0].kind,'catalog');});
test('missing catalog items only accepts an explicit scoped empty search, not metadata or malformed documents',async()=>{
 const cursor={url:api+'teams/search?user_id=123',remaining:[],visited:[]};const empty=await collect(cursor,()=>({collection:{href:api+'teams/search?user_id=123',queries:[]}}));assert.equal(empty.complete,true);assert.equal(empty.records.teams.length,0);
 for(const raw of [{collection:{href:api+'teams',queries:[]}},{collection:{}},{collection:{href:cursor.url,error:{message:'not allowed'}}}])await assert.rejects(()=>collect(cursor,()=>raw),e=>e.code==='unsupported_response');
 for(const href of [api+'teams/search?user_id=999',api+'teams/search?user_id=123&user_id=999']){
  await assert.rejects(()=>collect({url:href},()=>assert.fail('must reject before fetch')),e=>e.code==='contract_violation');
  await assert.rejects(()=>collect(cursor,()=>({collection:{href}})),e=>e.code==='contract_violation');
 }
 for(const href of [api+'teams/search',api+'teams/search?user_id=123&is_archived=true'])await assert.rejects(()=>collect(cursor,()=>({collection:{href}})),e=>e.code==='unsupported_response');
});
