import test from 'node:test';
import assert from 'node:assert/strict';
import {eventTitle,matchRow} from '../web/ui-original/presentation.js';
for(const provider of ['teamsnap','trace','gotsport','live'])test(`${provider} blank title uses actual participant names without changing ID/status`,()=>{
 for(const title of ['',null,undefined,'  ']){const event={id:provider+'-id',provider,type:'game',title,home_name:'White & Blue',away_name:'<United>',status:'UNKNOWN'},before=structuredClone(event);assert.equal(eventTitle(event),'White & Blue vs <United>');const html=matchRow(event);assert.match(html,/Open match details: White &amp; Blue vs &lt;United&gt;/);assert.match(html,new RegExp('data-id="'+provider+'-id"'));assert.match(html,/UNKNOWN/);assert.deepEqual(event,before);}
});
test('explicit title, structured participants and genuinely unknown event remain distinct',()=>{
 assert.equal(eventTitle({title:' Owner title ',home_name:'A',away_name:'B'}),'Owner title');assert.equal(eventTitle({type:'game',home:{name:'A'},away:{name:'B'}}),'A vs B');
 assert.equal(eventTitle({type:'game'}),'Match');assert.equal(eventTitle({type:'practice'}),'Practice');assert.equal(eventTitle({type:'other'}),'Event');assert.equal(eventTitle(null),'Event');assert.equal(eventTitle(undefined),'Event');
});
