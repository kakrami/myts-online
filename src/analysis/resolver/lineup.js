/**
 * Pure own-team lineup resolver. Canonical identities, dated eligibility and
 * participation/starts are proved before this call. Geometry cannot create them.
 */
import { projectLineupPositions } from './layout.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v),cmp=(a,b)=>a<b?-1:a>b?1:0,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const GROUP={GK:'GK',LB:'DEF',CB:'DEF',RB:'DEF',LCB:'DEF',RCB:'DEF',SW:'DEF',LWB:'DEF',RWB:'DEF',DEF:'DEF',LM:'MID',CM:'MID',RM:'MID',LCM:'MID',RCM:'MID',DM:'MID',AM:'MID',CDM:'MID',CAM:'MID',MID:'MID',LF:'FWD',RF:'FWD',ST:'FWD',CF:'FWD',SS:'FWD',LW:'FWD',RW:'FWD',FWD:'FWD'};
const ALIAS={GOALKEEPER:'GK',KEEPER:'GK',DEFENDER:'DEF',DEFENCE:'DEF',DEFENSE:'DEF',MIDFIELDER:'MID',MIDFIELD:'MID',FORWARD:'FWD',STRIKER:'ST'};
export function normalizePosition(value){if(typeof value!=='string')return null;const s=value.trim().toUpperCase(),p=ALIAS[s]||s;return GROUP[p]?{label:p,group:GROUP[p]}:null;}
function validGrid(s){return !!s&&Number.isInteger(s.grid_cols)&&Number.isInteger(s.grid_rows)&&s.grid_cols>0&&s.grid_cols<=128&&s.grid_rows>0&&s.grid_rows<=128&&Array.isArray(s.grid)&&s.grid.length<=4096&&s.grid.length===s.grid_cols*s.grid_rows&&s.grid.every(v=>finite(v)&&v>=0)&&s.grid.some(v=>v>0)&&finite(s.grid.reduce((a,b)=>a+b,0));}
function usable(s){return !!s&&finite(s.avg_x)&&finite(s.avg_y)&&s.avg_x>=0&&s.avg_x<=1&&s.avg_y>=0&&s.avg_y<=1&&String(s.display_orientation||'').startsWith('own_goal_left')&&((finite(s.samples)&&s.samples>=30)||validGrid(s));}
export function isGoalkeeper(p){return finite(p.minutes)&&finite(p.gkMinutes)&&p.minutes>0&&p.gkMinutes>=5&&p.gkMinutes>=.6*p.minutes;}
export function inferSpatialPosition(input,options={}){
 const player=input&&Object.hasOwn(input,'spatial')?input:null,s=player?player.spatial:input;
 const peers=Array.isArray(options)?options.filter(p=>p.id!==player?.id&&finite(p.minutes)&&p.minutes>0&&!isGoalkeeper(p)).map(p=>p.spatial):(options.peers||[]);
 if(player&&isGoalkeeper(player))return{label:'GK',group:'GK',attack:0,side:.5,quality:1,provenance:{kind:'inferred',basis:'goalkeeper_minutes',value:'GK'}};
 if(!usable(s))return null;
 const xs=peers.filter(usable).map(v=>v.avg_x).sort((a,b)=>a-b),median=xs.length>=3?xs[Math.floor(xs.length/2)]:.5,shift=clamp((median-.5)*.6,-.12,.12),third=k=>finite(s[k])?s[k]:0;
 const depth=clamp(s.avg_x-shift+(third('attacking_third_pct')-third('defensive_third_pct'))*.0008,0,1),group=depth<.4?'DEF':depth>.6?'FWD':'MID',lateral=s.tactical_left_is_top===true&&validGrid(s),side=lateral?(s.avg_y<.36?'L':s.avg_y>.64?'R':'C'):null;
 const label=side?{DEF:{L:'LB',C:'CB',R:'RB'},MID:{L:'LM',C:'CM',R:'RM'},FWD:{L:'LW',C:'ST',R:'RW'}}[group][side]:group;
 return{group,label,attack:depth,side:lateral?s.avg_y:null,quality:validGrid(s)?1:Math.min(1,s.samples/500),provenance:{kind:'inferred',basis:'heatmap',value:label}};
}
function assigned(value,kind,provenance){const label=normalizePosition(value)?.label;return label?{label,group:GROUP[label],attack:{GK:0,DEF:.25,MID:.5,FWD:.75}[GROUP[label]],side:label.startsWith('L')?.2:label.startsWith('R')?.8:.5,quality:1,provenance:provenance||{kind,basis:'position',value:label}}:null;}
function evidence(p,players,format){
 const explicit=assigned(p.manualPosition,'manual')||assigned(p.reportedPosition,'reported');if(explicit)return explicit;
 const resolved=typeof p.position==='object'&&p.position!==null?assigned(p.position.value,'reported',p.position.provenance):assigned(p.position,'reported');if(resolved){if(p.position?.provenance?.kind==='inferred'&&resolved.group!=='GK'){const sp=inferSpatialPosition(p,players);if(sp)return{...sp,label:resolved.label,group:resolved.group,provenance:resolved.provenance};}return resolved;}
 if(isGoalkeeper(p))return{label:'GK',group:'GK',attack:0,side:.5,quality:1,provenance:{kind:'inferred',basis:'goalkeeper_minutes',value:'GK'}};
 const peers=players.filter(q=>q.id!==p.id&&q.minutes>0&&!isGoalkeeper(q)).map(q=>q.spatial);
 return inferSpatialPosition(p.spatial,{format,peers})||assigned(p.seasonPosition,'season_default');
}
function shape(format,entries){const defaults=format===7?[2,3,1]:[3,3,2],counts=['DEF','MID','FWD'].map(g=>entries.filter(e=>e.e.group===g).length);return entries.length===format-1?counts:defaults;}
function slotsFor(counts){
 const slots=[{slot:'GK',position:'GK',x:50,y:91,player_id:null,provenance:null}];
 for(let band=0;band<3;band++){const n=counts[band],group=['DEF','MID','FWD'][band];for(let j=0;j<n;j++){
 const span=band===0?70:band===1?64:30,x=n===1?50:50-span/2+j*span/(n-1);
 const position=group==='DEF'?(n===1?'CB':j===0?'LB':j===n-1?'RB':'CB'):group==='MID'?(n===1?'CM':j===0?'LM':j===n-1?'RM':'CM'):n===1?'ST':j===0?'LF':j===n-1?'RF':'ST';
 slots.push({slot:group+'-'+(j+1),position,x,y:[70,44,19][band],player_id:null,provenance:null});
 }}return slots;
}
const rank=e=>({manual:0,reported:1,inferred:2,season_default:3}[e.provenance?.kind]??2),priority=v=>v.p.manualSlot!=null?-1:rank(v.e);
export function resolveLineup({format,players=[],half}){
 if(!Array.isArray(players)||players.length>128||players.some(p=>!p||typeof p.id!=='string'||!p.id)||new Set(players.map(p=>p.id)).size!==players.length)throw new TypeError('Canonical player IDs must be distinct nonempty bounded strings');
 for(const p of players)if(p.manualSlot!=null&&p.manualPoint!=null)throw new RangeError('choose format slot or pitch anchor intent');
 const eligible=players.filter(p=>p.eligible===true&&p.appearance!==false).sort((a,b)=>cmp(a.id,b.id)),bench=eligible.filter(p=>p.appearance===true&&p.started===false).map(p=>p.id);
 const unknown=new Set([...eligible.filter(p=>p.appearance!==true||typeof p.started!=='boolean'),...players.filter(p=>p.eligible==null&&p.appearance!==false)].map(p=>p.id)),warnings=[];
 if(format!==7&&format!==9)return{format:null,formation:null,slots:[],bench,unknown:[...new Set([...unknown,...eligible.filter(p=>!bench.includes(p.id)).map(p=>p.id)])].sort(cmp),warnings:[{code:'unknown_format'}]};
 let entries=eligible.filter(p=>p.appearance===true&&p.started===true).map(p=>({p,e:evidence(p,eligible,format)||(Number.isInteger(p.manualSlot)&&p.manualSlot>=1&&p.manualSlot<=format?assigned(slotsFor(format===7?[2,3,1]:[3,3,2])[p.manualSlot-1].position,'manual',{kind:'manual',basis:'slot',value:p.manualSlot}):null)}));
 entries=entries.filter(v=>{if(v.p.manualSlot==null)return true;if(!Number.isInteger(v.p.manualSlot)||v.p.manualSlot<1||v.p.manualSlot>format||(v.p.manualSlot===1&&v.e?.group!=='GK')||(v.p.manualSlot!==1&&v.e?.group==='GK')){warnings.push({code:'invalid_manual_slot',player_ids:[v.p.id],slot:v.p.manualSlot});unknown.add(v.p.id);return false;}return true;});
 for(const v of entries)if(!v.e)unknown.add(v.p.id);
 const keepers=entries.filter(v=>v.e?.group==='GK').sort((a,b)=>priority(a)-priority(b)||(b.p.gkMinutes||0)-(a.p.gkMinutes||0)||cmp(a.p.id,b.p.id));
 if(keepers.length>1){warnings.push({code:'multiple_starting_goalkeepers',player_ids:keepers.map(v=>v.p.id)});for(const v of keepers.slice(1))unknown.add(v.p.id);}
 let field=entries.filter(v=>v.e&&v.e.group!=='GK').sort((a,b)=>priority(a)-priority(b)||cmp(a.p.id,b.p.id));const claimed=new Map();
 field=field.filter(v=>{if(v.p.manualSlot==null)return true;const old=claimed.get(v.p.manualSlot);if(old){warnings.push({code:'duplicate_manual_slot',player_ids:[old.p.id,v.p.id],slot:v.p.manualSlot});unknown.add(v.p.id);return false;}claimed.set(v.p.manualSlot,v);return true;});
 if(field.length>format-1){warnings.push({code:'too_many_evidenced_starters',player_ids:field.map(v=>v.p.id)});for(const v of field.slice(format-1))unknown.add(v.p.id);field=field.slice(0,format-1);}
 const selected=[...keepers.slice(0,1),...field],counts=shape(format,field),slots=slotsFor(counts),proof=v=>({...v.e.provenance,player_id:v.p.id});
 if(keepers.length)Object.assign(slots[0],{player_id:keepers[0].p.id,provenance:proof(keepers[0])});
 const locked=new Map();
 field=field.filter(v=>{if(v.p.manualSlot==null)return true;const index=v.p.manualSlot-1,old=locked.get(index);if(old){warnings.push({code:'duplicate_manual_slot',player_ids:[old.p.id,v.p.id],slot:v.p.manualSlot});unknown.add(v.p.id);return false;}locked.set(index,v);Object.assign(slots[index],{player_id:v.p.id,provenance:{kind:'manual',basis:'slot',value:v.p.manualSlot,player_id:v.p.id,position:proof(v)}});if(GROUP[slots[index].position]!==v.e.group)warnings.push({code:'manual_slot_position_conflict',player_ids:[v.p.id]});return false;});
 const available=slots.slice(1).filter(s=>s.player_id===null),capacity=available.length,lateral=entries.filter(v=>v.e?.group!=='GK'&&usable(v.p.spatial)&&v.p.spatial.tactical_left_is_top===true&&validGrid(v.p.spatial)).map(v=>v.p.spatial.avg_y).sort((a,b)=>a-b),center=lateral.length?lateral[Math.floor(lateral.length/2)]:.5;
 let layer=new Map([[0,{cost:0,path:[]}]]);
 for(const v of field){const next=new Map(),s=usable(v.p.spatial)?v.p.spatial:null,targetX=v.e.side===null?50:s&&s.tactical_left_is_top===true&&validGrid(s)?clamp(50+(s.avg_y-center)*110,7,93):v.e.side*100,targetY=s?90-v.e.attack*80:{DEF:70,MID:44,FWD:19}[v.e.group];
 for(const [mask,state]of layer)for(let j=0;j<capacity;j++){if(mask&(1<<j))continue;const slot=available[j],same=GROUP[slot.position]===v.e.group,cost=state.cost+.065*(slot.x-targetX)**2+.085*(slot.y-targetY)**2+(same?0:250)+(v.e.provenance?.kind==='manual'&&slot.position!==v.e.label?180:0),key=mask|(1<<j),old=next.get(key);if(!old||cost<old.cost)next.set(key,{cost,path:[...state.path,j]});}layer=next;}
 const best=[...layer.values()].sort((a,b)=>a.cost-b.cost||cmp(a.path.join(','),b.path.join(',')))[0];
 if(best)field.forEach((v,i)=>{const slot=available[best.path[i]];Object.assign(slot,{player_id:v.p.id,provenance:proof(v)});if(GROUP[slot.position]!==v.e.group)warnings.push({code:'formation_position_conflict',player_ids:[v.p.id]});});
 const positions=projectLineupPositions(selected.map(v=>({id:v.p.id,evidence:v.e,spatial:v.p.spatial,manualPoint:v.p.manualPoint})));
 for(const position of positions){const slot=slots.find(s=>s.player_id===position.player_id);if(!slot)continue;if(locked.has(slots.indexOf(slot)))Object.assign(position,{x:slot.x,y:slot.y,label:slot.position,basis:'manual_format_slot'});else Object.assign(slot,{x:position.x,y:position.y,position:position.label});}
 if(half!==1&&half!==2)warnings.push({code:'unspecified_half'});
 return{format,formation:counts.filter(n=>n>0).join('-'),slots,positions,bench,unknown:[...unknown].sort(cmp),warnings};
}
