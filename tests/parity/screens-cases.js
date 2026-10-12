export function runScreensCases({screens,assert}) {
 const results=[],check=(name,run)=>{run();results.push(name);};
 const event={id:"match-1",kind:"game",type:"game",status:"FINAL",local_day:"2026-09-12",time_pending:true,home:{id:"team-1",name:"Home"},away:{id:"team-2",name:"Away"},home_score:2,away_score:1};
 check("roster search highlights escaped names",()=>{
  const html=screens.roster({data:{query:"anne",players:{items:[{id:"player-1",name:"Anne <script>",jersey:"7",position:"CM"}],total:1},totals:{},sort:{key:"name",direction:"asc"}}});
  assert.match(html,/<mark>Anne<\/mark> &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-action="player" data-id="player-1"/);
 });
 check("match conflicts remain visible in the detail header",()=>{
  const html=screens.matchDetail({data:{event:{...event,identity_conflict:true,result_conflict:true,logistics_conflicts:["arrival","uniform","<script>"]},capabilities:{}}});
  assert.match(html,/Match identity needs review/);assert.match(html,/Conflicting results require review/);assert.match(html,/Conflicting arrival time, uniform from connected sources/);assert.doesNotMatch(html,/<script>/);
  assert.match(screens.matchDetail({data:{event:{...event,conditional:true},capabilities:{}}}),/participants are not confirmed/);assert.doesNotMatch(screens.matchDetail({data:{event,capabilities:{}}}),/needs review|Conflicting results/);
 });
 check("H2H shows full returned aggregate and limited history alongside a paged list",()=>{
  const html=screens.matchDetail({data:{event,capabilities:{has_h2h:true},h2h:{record:{games:12,wins:8,draws:1,losses:3,goals_for:29,goals_against:14},events:{items:[event],total:15,next_cursor:"next-h2h"},coverage:"saved_history",history_complete:false,note:"Saved <meetings> are incomplete."}}},{tab:"h2h"});
  assert.match(html,/Games<\/span><b>12<\/b>/);assert.match(html,/Wins<\/span><b>8<\/b>/);assert.match(html,/Goals for<\/span><b>29<\/b>/);assert.match(html,/Saved history/);assert.match(html,/Saved &lt;meetings&gt; are incomplete/);assert.match(html,/data-tab="h2h"/);assert.match(html,/data-cursor="next-h2h"/);assert.doesNotMatch(html,/Complete history/);
  assert.match(screens.matchDetail({data:{event,capabilities:{has_h2h:true},h2h:{record:{},events:{items:[]},history_complete:false}}},{tab:"h2h"}),/No saved meetings/);
 });
 check("player overview renders only provided distance, attacking and attendance facts",()=>{
  const provided=screens.playerDetail({data:{player:{id:"player-1",name:"Anne"},stats:{apps:5,starts:3,minutes:100,goals:1,assists:1,g_plus_a_per_60:1.2,attendance_pct:0},spatial:{tracked_distance_m:1500,attacking_third_pct:0}}});
  assert.match(provided,/G\+A \/ 60<\/span><b>1\.2<\/b>/);assert.match(provided,/Tracked distance<\/span><b>1\.5 km<\/b>/);assert.match(provided,/Attacking third<\/span><b>0\.0%<\/b>/);assert.match(provided,/Attendance<\/span><b>0%<\/b>/);
  const missing=screens.playerDetail({data:{player:{id:"player-1",name:"Anne"},stats:{attendance_pct:null},spatial:null}});assert.doesNotMatch(missing,/Tracked distance|Attacking third|<span>Attendance<\/span>/);
 });
 check("match players retain starter state, identity, fact provenance and valid sort controls",()=>{
  const players=[{id:"player-1",name:"Anne <script>",jersey:"7",position:"CM",minutes:0,gk_minutes:0,goals:0,assists:1,started:false,minutes_state:"estimated",goals_state:"published",assists_state:"manual",attacking_third_pct:0},{id:"player-2",name:"Ben",started:null,minutes:null,minutes_state:"pending",goals:null,assists:null}];
  const html=screens.matchDetail({data:{event,capabilities:{has_players:true},players:{items:players,sort:{key:"minutes",direction:"desc"}}}},{tab:"players"});
  assert.match(html,/Anne &lt;script&gt;/);assert.match(html,/#7 · CM/);assert.match(html,/data-label="Start">No<\/td>/);assert.match(html,/data-label="Start">—<\/td>/);assert.match(html,/>Estimated<\/small>/);assert.match(html,/>Manual<\/small>/);assert.match(html,/data-label="Attacking">0\.0%<\/td>/);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/data-key="started"/);assert.doesNotMatch(html,/data-key="attacking_third_pct"/);
  const without=screens.matchDetail({data:{event,capabilities:{has_players:true},players:{items:[{id:"player-1",name:"Anne",minutes:0,started:true}]}}},{tab:"players"});assert.doesNotMatch(without,/data-label="Attacking"/);assert.match(without,/data-label="Start">Yes<\/td>/);
 });
 return results;
}
