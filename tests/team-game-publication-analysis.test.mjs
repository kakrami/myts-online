import test from 'node:test';
import assert from 'node:assert/strict';
import {DomainRepository} from '../src/domain/repository.js';
import {collectApplicationJob} from '../src/application/sync-service.js';
const context={db:{},env:{},lease:{provider:'domain',component:'projection',stage:'projection',scope:'team',resource_key:'from'},args:{teamId:'team',seasonId:'from',requestId:'request'},checkpoint:{}};
async function collect(t,patch){t.mock.method(DomainRepository.prototype,'buildProjectionPage',async()=>({statements:[],checkpoint:{done:true},complete:true,published:true,...patch}));return collectApplicationJob(context);}
test('ordinary publication still admits exactly its own analysis catalog',async t=>{const result=await collect(t,{});assert.deepEqual(result.children.map(c=>c.args),[{teamId:'team',seasonId:'from',requestId:'request'}]);assert.equal(result.children[0].subscriberMode,'inherit');});
test('atomic two-season publication admits both exact scoped analysis catalogs',async t=>{const result=await collect(t,{publishedSeasons:['from','to']});assert.deepEqual(result.children.map(c=>[c.provider,c.component,c.scope,c.resourceKey]),[['analysis','catalog','team','from'],['analysis','catalog','team','to']]);assert.ok(result.children.every(c=>c.args.requestId==='request'&&c.subscriberMode==='inherit'));});
test('unpublished two-run preparation creates no analysis catalog',async t=>{const result=await collect(t,{published:false,publishedSeasons:['from','to']});assert.deepEqual(result.children,[]);});
test('two-season catalogs reserve the existing total child bound',async t=>{const result=await collect(t,{publishedSeasons:['from','to'],affectedTeams:Array.from({length:128},(_,i)=>({app_team_id:'team'+i,team_season_id:'season'+i}))});assert.equal(result.children.length,128);assert.equal(result.children.filter(c=>c.component==='catalog').length,2);});
for(const publishedSeasons of [[],['to'],['from','from'],['from','to','third'],['from',null],['from','x'.repeat(241)]])test('invalid publication season envelope fails closed: '+JSON.stringify(publishedSeasons),async t=>{await assert.rejects(collect(t,{publishedSeasons}),e=>e.code==='invalid_job');});
