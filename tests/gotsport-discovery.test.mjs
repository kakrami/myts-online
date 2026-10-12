import test from 'node:test';
import assert from 'node:assert/strict';
import {searchGotSport,resolveGotSportPage} from '../src/sources/discovery.js';
test('GotSport name search requires explicit age and category before any provider call',async()=>{
 let calls=0;const transport={get:async()=>{calls++;throw new Error('unexpected provider call');}};
 for(const args of [{q:'United'},{q:'United',age:12},{q:'United',gender:'f'},{q:'United',age:'',gender:'m'}])await assert.rejects(searchGotSport(transport,args),e=>e.code==='search_filters_required');
 assert.equal(calls,0);
});
test('GotSport discovery makes one bounded requested page, with no invented state/category/age',async()=>{
 const calls=[],transport={get:async value=>{calls.push(new URL(value));return {value:{team_ranking_data:[{team_id:123,team_name:'United',club_name:'City',age:12,gender:'f',team_association:'CA'}],pagination:{total_pages:3,total_count:20}}};}};
 const result=await searchGotSport(transport,{q:'United',age:12,gender:'f',page:2});assert.equal(calls.length,1);const query=calls[0].searchParams;
 assert.equal(query.get('search[age]'),'12');assert.equal(query.get('search[gender]'),'f');assert.equal(query.get('search[page]'),'2');assert.equal(query.has('search[team_association]'),false);
 assert.equal(result.nextPage,3);assert.equal(result.teams[0].name,'City United');assert.equal(result.teams[0].region,'CA');
});
test('unsupported or ambiguous GotSport URLs fail before network access',async()=>{
 let calls=0;const transport={get:async()=>{calls++;throw new Error('unexpected provider call');}};
 for(const link of ['https://system.gotsport.com/org_event/events/123','https://example.com/teams/123','http://rankings.gotsport.com/teams/123','https://rankings.gotsport.com/teams/123?season=1','https://rankings.gotsport.com/teams/123#details'])await assert.rejects(resolveGotSportPage(transport,link));
 assert.equal(calls,0);
});
