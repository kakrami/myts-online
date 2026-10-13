import {momentClock} from './resolver/intervals.js';
import {parse} from './resolver-adapter.js';
/** Complete published facts supply leaders; a paged UI table is never the source. */
export function matchHighlights(c,resolved){
 const names=new Map((c.rosterLabels||[]).map(m=>[m.player_id,{name:m.name,jersey:m.jersey}])),facts=resolved.facts;
 const ranked=facts.filter(p=>p.goals!==null&&p.assists!==null).map(p=>({id:p.player_id,...(names.get(p.player_id)||{name:null,jersey:null}),position:p.position,goals:p.goals,assists:p.assists,ga:p.goals+p.assists,minutes:p.minutes,attacking_third_pct:parse(p.spatial).attacking_third_pct??null,manual:p.goals_state==='manual'||p.assists_state==='manual'})).sort((a,b)=>b.ga-a.ga||(b.goals-a.goals)||a.id.localeCompare(b.id));
 const sourceManual=ranked.some(v=>v.manual),seen=new Set();let home=0,away=0;
 const raw=(c.goalMoments||[]).map(m=>{const evidence=parse(m.evidence);let clock={seconds:null,basis:'missing_clock'};try{clock=momentClock({half:m.half,...(typeof evidence.start_time==='number'?{startTimeMs:evidence.start_time}:{})},resolved.halves);}catch{}return {m,evidence,clock};}).sort((a,b)=>(a.m.half??3)-(b.m.half??3)||(a.clock.seconds??Infinity)-(b.clock.seconds??Infinity)||a.m.id.localeCompare(b.m.id));
 // Any unknown timing or side makes the entire running-score order unavailable.
 let known=!!c.momentsComplete&&!c.timelineTruncated&&raw.every(v=>v.clock.seconds!==null&&['home','away'].includes(v.m.side));const clocks=new Set();for(const v of raw){const key=v.m.half+':'+v.clock.seconds;if(clocks.has(key))known=false;clocks.add(key);}
 const firstHalf=resolved.halves.find(v=>v.id===1),items=[];for(const {m,clock}of raw){const key=m.clip_id||m.id;if(seen.has(key))continue;seen.add(key);const side=['home','away'].includes(m.side)?m.side:null;if(side==='home')home++;if(side==='away')away++;
  const credit=(c.creditedMoments||[]).find(v=>v.kind==='goal'&&v.native_key===key),assist=(c.creditedMoments||[]).find(v=>v.kind==='assist'&&v.native_key===key),own=side===c.source?.side;
  items.push({id:String(items.length+1),half:[1,2].includes(m.half)?m.half:null,match_minute:clock.seconds===null||m.half===2&&!firstHalf?null:Math.floor((clock.seconds+(m.half===2?firstHalf.end-firstHalf.start:0))/60),scorer:own&&credit?names.get(credit.player_id)?.name||null:null,assist:own&&assist?names.get(assist.player_id)?.name||null:null,side,score_home:known?home:null,score_away:known?away:null});
 }
 return {leaders:{items:ranked.slice(0,4),total:ranked.length},goal_timeline:{items:items.slice(0,24),total:items.length,truncated:!!c.timelineTruncated||items.length>24,state:!c.momentsComplete||c.timelineTruncated?'incomplete':known?'published':'partial',source_only:sourceManual}};
}
