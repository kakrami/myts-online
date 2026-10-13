import test from 'node:test';
import assert from 'node:assert/strict';
import {matchDetail,roster,playerDetail} from '../web/ui-original/screens.js';
const event={id:'match',type:'game',status:'FINAL',local_day:'2026-08-01',home_name:'Home',away_name:'Away',home_score:2,away_score:1};
test('original overview restores bounded leaders and source goal timeline with unknown facts preserved',()=>{
 const html=matchDetail({data:{event,capabilities:{has_players:true},leaders:{items:[{id:'p',name:'A <script>',minutes:0,ga:0,position:'GK',manual:true}]},goal_timeline:{items:[{id:'g1',match_minute:0,scorer:'A <script>',assist:'B & C',score_home:1,score_away:0},{id:'g2',half:2,scorer:null,score_home:null,score_away:null}],total:3,truncated:true,state:'partial'}}});
 for(const text of ['Match leaders','Goals','A &lt;script&gt;','Assist: B &amp; C','Source timeline','Showing 2 of 3','1–0','—–—','0′'])assert.ok(html.includes(text),text);
 assert.match(html,/data-action="match-player" data-id="p" data-match="match"/);assert.doesNotMatch(html,/<script>/);
});
test('unknown match leaders or goals are not manufactured from empty paged players',()=>{
 const html=matchDetail({data:{event,players:{items:[]},leaders:{items:[]},goal_timeline:{items:[],state:'pending'}}});assert.doesNotMatch(html,/Match leaders|class="goal-event"/);
});
test('original match table keeps Start and Attacking columns when facts are unavailable',()=>{
 const html=matchDetail({data:{event,capabilities:{has_players:true},players:{items:[{id:'p',name:'P',started:null,minutes:null}]}}},{tab:'players'});
 assert.match(html,/data-label="Start">—/);assert.match(html,/data-label="Attacking">—/);assert.doesNotMatch(html,/data-label="GK"/);
});
test('ordinary roster and player overview visibly label imported and preserved history',()=>{
 assert.match(roster({data:{players:{items:[{id:'p',name:'P',roster_provenance:'imported'}]}}}),/Imported history/);
 assert.match(playerDetail({data:{player:{id:'p',name:'P',roster_provenance:'preserved'},stats:{}}}),/Preserved history/);
});
