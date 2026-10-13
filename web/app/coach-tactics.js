// Coach geometry is independent of analyzed-lineup slot indices. The three
// striker positions have separate durable identities but share one rating.
export const COACH_SLOTS = Object.freeze([
 ['GK',50,91],['SW',50,81],['LB',15,70],['LCB',35,70],['CB',50,70],['RCB',65,70],['RB',85,70],
 ['LWB',9,58],['RWB',91,58],['LM',18,44],['LCM',35,44],['CDM',50,56],['CM',50,44],['CAM',50,32],['RCM',65,44],['RM',82,44],
 ['LW',18,19],['RW',82,19],['SS',40,24],['CF',60,24],['ST:L',35,9,'ST','Left'],['ST',50,9,'ST','Center'],['ST:R',65,9,'ST','Right']
].map(([id,x,y,position=id,side=null],index)=>Object.freeze({id,x,y,position,side,index})));
export const COACH_POSITIONS=Object.freeze([...new Set(COACH_SLOTS.map(s=>s.position))]);
export const coachPosition=slot=>COACH_SLOTS.find(s=>s.id===slot)?.position??slot;
export function coachPositionGroup(position){const p=coachPosition(position);return p==='GK'?'GK':['SW','LB','LWB','LCB','CB','RCB','RB','RWB','DEF'].includes(p)?'DEF':['LM','LCM','CDM','CM','CAM','RCM','RM','MID'].includes(p)?'MID':['LW','SS','CF','ST','RW','LF','RF','FWD'].includes(p)?'FWD':'';}
export function starterSuggestion(s,profiles={},hints={}){
 const preferred=s.format===7?[0,3,6,10,14,19,21]:[0,2,4,6,10,12,14,17,21],chosen=new Set(),field={},reasons=[];
 for(const index of preferred){const {id:position}=COACH_SLOTS[index],code=coachPosition(position),group=coachPositionGroup(code);let best=null,bestScore=-Infinity,record=null;
  for(const p of s.roster??[]){if(!(s.active??[]).includes(p.id)||chosen.has(p.id))continue;const a=profiles[p.id]??{},rating=a.positions?.[code]??0,same=Math.max(0,...Object.entries(a.positions??{}).filter(([key])=>coachPositionGroup(key)===group).map(([,value])=>value)),natural=hints[p.id]?.assigned_position===code?2:0,score=rating*10+same*3+natural;if(score>bestScore){best=p;bestScore=score;record={rating,same,natural};}}
  if(best){field[position]=best.id;chosen.add(best.id);reasons.push({player:best.id,position,score:bestScore,rating:record.rating,hint_used:!!record.natural,reason:`${best.name??best.id} · ${record.rating?record.rating+'/5 at '+code:record.same?group.toLowerCase()+' position':record.natural?'Assigned position '+code:'Available player'}`});}
 }
 return {field,reasons,applied:false};
}
export function substitutionRecommendations(s,profiles={},hints={}){
 if(!s||!['running','paused'].includes(s.phase)||s.clock_review)return [];
 const index=slot=>COACH_SLOTS.find(s=>s.id===slot)?.index??100;
 const on=Object.entries(s.field??{}).sort(([a],[b])=>index(a)-index(b)),used=new Set(on.map(([,id])=>id)),bench=(s.roster??[]).filter(p=>(s.active??[]).includes(p.id)&&!used.has(p.id)),out=[];
 for(const [slot,id]of on){const current=s.roster.find(p=>p.id===id);if(!current)continue;const code=coachPosition(slot),group=coachPositionGroup(code),minutes=(s.minutes_ms?.[id]??0)/60000,profile=profiles[id]??{};
  for(const p of bench){const a=profiles[p.id]??{},rating=a.positions?.[code]??0,groupMatch=Object.keys(a.positions??{}).some(pos=>coachPositionGroup(pos)===group),benchMinutes=(s.minutes_ms?.[p.id]??0)/60000,sourceRole=hints[p.id]?.resolved_position??hints[p.id]?.position;if(!rating&&!groupMatch&&sourceRole!==code)continue;
   const recent=(hints[p.id]?.recent_trace_minutes??[]).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>0).slice(-5),recentAvg=recent.length?recent.reduce((a,b)=>a+b,0)/recent.length:null,target=a.target_minutes??s.half_minutes*2/s.roster.length*s.format,need=Math.max(0,target-benchMinutes),over=minutes-(profile.target_minutes??target),score=rating*8+(groupMatch?3:0)+Math.min(15,need)/3+Math.max(0,over)/3+(a.endurance??3)+(sourceRole===code?1:0)-Math.max(0,benchMinutes-minutes)/2;
   out.push({out:current,in:p,slot,score,reason:`${rating?rating+'/5 at '+code:sourceRole===code?'Played here previously':group.toLowerCase()+' position'} · ${Math.round(benchMinutes)} min today; ${current.name} ${Math.round(minutes)} min${recentAvg!=null?' · recent Trace estimate ~'+Math.round(recentAvg)+' min':''}`});
  }
 }
 return out.sort((a,b)=>b.score-a.score).slice(0,3);
}
