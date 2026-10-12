import { normalizeSegments, intervalDuration } from './intervals.js';
const EPSILON=1e-7,MAX_PLAYERS=128,MAX_SEGMENTS=4096,hasSeconds=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
/** Actual half quantities. Per-fact manual > reported > observed; estimates assert no timing.
 * Unknown participation/roles remain unknown; contradictory hard values remain visible.
 */
export function allocateHalf(input={}) {
 const window=input.window,windowKnown=!!window&&Number.isFinite(window.start)&&Number.isFinite(window.end)&&window.end>window.start;
 const duration=windowKnown?window.end-window.start:null,format=input.format===7||input.format===9?input.format:null,violations=[];
 const issue=(code,details={})=>{const result={code,...details};violations.push(result);return result;};
 if(format&&duration!==null&&!Number.isFinite(format*duration))return{players:[],capacitySeconds:null,assignedSeconds:null,assignedIsLowerBound:true,unallocatedSeconds:null,unassignedGkSeconds:null,overCapacity:true,publishable:false,coverage:'numeric_overflow_rejected',violations:[{code:'allocation_numeric_overflow'}]};
 const rawPlayers=Array.isArray(input.players)?input.players:[],rawKeeper=Array.isArray(input.keeperSegments)?input.keeperSegments:[];
 const segmentCount=rawKeeper.length+rawPlayers.reduce((sum,p)=>sum+(Array.isArray(p.segments)?p.segments.length:0)+(Array.isArray(p.goalkeeperSegments)?p.goalkeeperSegments.length:0)+(Array.isArray(p.unknownRoleSegments)?p.unknownRoleSegments.length:0),0);
 if(rawPlayers.length>MAX_PLAYERS||segmentCount>MAX_SEGMENTS)return{players:[],capacitySeconds:format&&duration!==null?format*duration:null,assignedSeconds:null,unallocatedSeconds:null,unassignedGkSeconds:null,overCapacity:false,publishable:false,coverage:'bounded_input_rejected',violations:[{code:'allocation_input_limit',players:rawPlayers.length,segments:segmentCount}]};
 const bound=windowKnown?window:undefined,normalize=v=>normalizeSegments(Array.isArray(v)?v:[],bound),union=s=>normalize(s);
 const overlap=(a,b)=>{let seconds=0,i=0,j=0;while(i<a.length&&j<b.length){seconds+=Math.max(0,Math.min(a[i][1],b[j][1])-Math.max(a[i][0],b[j][0]));if(a[i][1]<=b[j][1])i++;else j++;}return seconds;};
 const scalar=(p,key,rowIssues)=>{const v=p[key];if(v==null)return null;if(hasSeconds(v))return v===0?0:v;rowIssues.push(issue('invalid_seconds',{playerId:p.id,field:key}));return null;};
 const identities=new Set();
 const rows=rawPlayers.map(p=>{
  const rowIssues=[];if(typeof p.id!=='string'||!p.id||identities.has(p.id))rowIssues.push(issue('invalid_or_duplicate_player',{playerId:p.id??null}));identities.add(p.id);
  const field=normalize(p.segments),keeper=normalize(p.goalkeeperSegments),unknown=normalize(p.unknownRoleSegments),knownRoles=union([...field,...keeper]);
  const observed=intervalDuration(union([...knownRoles,...unknown])),observedGk=intervalDuration(keeper),observedField=intervalDuration(field),unknownRoleObserved=Math.max(0,intervalDuration(unknown)-overlap(unknown,knownRoles));
  const manual=scalar(p,'manualSeconds',rowIssues),reported=scalar(p,'reportedSeconds',rowIssues),manualGk=scalar(p,'manualGkSeconds',rowIssues),reportedGk=scalar(p,'reportedGkSeconds',rowIssues),manualField=scalar(p,'manualFieldSeconds',rowIssues),reportedField=scalar(p,'reportedFieldSeconds',rowIssues);
  const totalHard=manual!==null?manual:reported,gkHard=manualGk!==null?manualGk:reportedGk,fieldHard=manualField!==null?manualField:reportedField,explicitRole=p.role==='field'||p.role==='goalkeeper'?p.role:null;
  let totalBasis=manual!==null?'manual':reported!==null?'reported':observed>0?'observed':null,gkBasis=manualGk!==null?'manual':reportedGk!==null?'reported':observedGk>0?'observed':null,fieldBasis=manualField!==null?'manual':reportedField!==null?'reported':observedField>0?'observed':null;
  const knownParticipant=p.appearance===true||observed>0||(totalHard??0)>0||(gkHard??0)>0||(fieldHard??0)>0||p.started===true;
  const selectedGk=gkHard??(explicitRole==='field'?0:observedGk),selectedField=fieldHard??(explicitRole==='goalkeeper'?0:observedField);
  const hasQuantityEvidence=totalHard!==null||fieldHard!==null||gkHard!==null||observed>0;
  const fieldRoleCloses=totalHard===null&&fieldHard!==null&&gkHard===null&&(explicitRole==='field'||duration!==null&&Math.abs(fieldHard-duration)<=EPSILON);
  const keeperRoleCloses=totalHard===null&&gkHard!==null&&fieldHard===null&&(explicitRole==='goalkeeper'||duration!==null&&Math.abs(gkHard-duration)<=EPSILON);
  const isolatedHardRole=totalHard===null&&!(fieldHard!==null&&gkHard!==null)&&(
   fieldHard!==null&&gkHard===null&&(observedGk===0||unknownRoleObserved>EPSILON)&&!fieldRoleCloses
   ||gkHard!==null&&fieldHard===null&&(observedField===0||unknownRoleObserved>EPSILON)&&!keeperRoleCloses);
  let total=totalHard!==null?totalHard:!hasQuantityEvidence||isolatedHardRole?null:fieldRoleCloses?fieldHard:keeperRoleCloses?gkHard:fieldHard!==null||gkHard!==null?selectedField+selectedGk+(fieldHard!==null&&gkHard!==null?0:unknownRoleObserved):observed;
  if(total!==null&&!Number.isFinite(total)){rowIssues.push(issue('allocation_numeric_overflow',{playerId:p.id}));total=null;}
  if(p.appearance===false&&totalHard===null&&fieldHard===null&&gkHard===null)total=0;
  if(totalHard===null&&(fieldHard!==null||gkHard!==null))totalBasis=explicitRole==='field'&&fieldHard!==null&&gkHard===null?fieldBasis:explicitRole==='goalkeeper'&&gkHard!==null&&fieldHard===null?gkBasis:'mixedderived';
  const hasRoleEvidence=field.length>0||keeper.length>0||fieldHard!==null||gkHard!==null||explicitRole!==null,completeRoleDecision=fieldRoleCloses||keeperRoleCloses||explicitRole!==null||(fieldHard!==null&&gkHard!==null)||(totalHard!==null&&(fieldHard!==null||gkHard!==null));
  let rolesUnknown=total!==null&&total>0&&(!hasRoleEvidence||(unknownRoleObserved>EPSILON&&!completeRoleDecision));
  let gk=gkHard!==null?gkHard:fieldRoleCloses?0:total===null?null:totalHard!==null&&fieldHard!==null?total-fieldHard:explicitRole==='goalkeeper'?total:explicitRole==='field'?0:Math.min(observedGk,total);
  let fieldSeconds=fieldHard!==null?fieldHard:keeperRoleCloses?0:total===null?null:gkHard!==null&&totalHard===null?selectedField:gk===null||gk>total+EPSILON?null:Math.max(0,total-gk);
  if(gk!==null&&gk<0){rowIssues.push(issue('negative_derived_role',{playerId:p.id}));gk=null;}
  if(total===0&&fieldHard===null&&gkHard===null){gk=0;fieldSeconds=0;rolesUnknown=false;}
  if(totalHard!==null&&fieldHard!==null&&gkHard===null)gkBasis='mixedderived';
  if(totalHard!==null&&fieldHard===null&&hasRoleEvidence)fieldBasis='mixedderived';
  if(totalHard!==null&&gkHard===null&&gk!==null&&Math.abs(gk-observedGk)>EPSILON)gkBasis='mixedderived';
  if(explicitRole==='field'&&fieldHard===null)fieldBasis=totalBasis;if(explicitRole==='goalkeeper'&&gkHard===null)gkBasis=totalBasis;
  if(fieldRoleCloses)gkBasis='mixedderived';if(keeperRoleCloses)fieldBasis='mixedderived';
  if(total===null)rolesUnknown=true;
  const unknownRole=total===null?null:rolesUnknown?!hasRoleEvidence?total:Math.max(0,total-selectedField-selectedGk):0;
  if(p.appearance===false&&((total??0)>0||(fieldSeconds??0)>0||(gk??0)>0))rowIssues.push(issue('confirmed_dnp_positive_seconds',{playerId:p.id}));
  if(p.eligible!==true&&(p.appearance===true||p.started===true||(total??0)>0||(fieldSeconds??0)>0||(gk??0)>0))rowIssues.push(issue('participation_outside_eligibility',{playerId:p.id}));
  if(duration!==null&&((total??0)>duration+EPSILON||(gk??0)>duration+EPSILON||(fieldSeconds??0)>duration+EPSILON))rowIssues.push(issue('player_exceeds_window',{playerId:p.id,durationSeconds:duration}));
  if((gk??0)<0||(fieldSeconds??0)<0||(gk??0)>(total??Infinity)+EPSILON||(fieldSeconds??0)>(total??Infinity)+EPSILON)rowIssues.push(issue('role_exceeds_total',{playerId:p.id}));
  if(totalHard!==null&&fieldHard!==null&&gkHard!==null&&Math.abs(totalHard-fieldHard-gkHard)>EPSILON)rowIssues.push(issue('hard_role_total_conflict',{playerId:p.id}));
  if(explicitRole==='field'&&(gkHard??0)>0||explicitRole==='goalkeeper'&&(fieldHard??0)>0)rowIssues.push(issue('role_intent_quantity_conflict',{playerId:p.id}));
  if(totalHard===null&&fieldHard===null&&gkHard===null&&explicitRole===null&&overlap(field,keeper)>EPSILON)rowIssues.push(issue('overlapping_field_goalkeeper_roles',{playerId:p.id}));
  const supportedLowerBound=total!==null?total:Math.max(selectedField+selectedGk,unknownRoleObserved),lowerBoundSeconds=Number.isFinite(supportedLowerBound)?supportedLowerBound:null;
  const fieldCandidate=p.eligible===true&&p.appearance!==false&&knownParticipant&&hasQuantityEvidence&&total!==null&&p.allowEstimate!==false&&totalHard===null&&fieldHard===null&&fieldSeconds!==null&&!rolesUnknown&&explicitRole!=='goalkeeper'&&(field.length>0||explicitRole==='field');
  return{p,field,keeper,unknown,total,lowerBoundSeconds,gk,fieldSeconds,observed,observedGk,observedField,unknownRole,rolesUnknown,totalHard,fieldHard,gkHard,totalBasis,fieldBasis,gkBasis,fieldCandidate,estimated:0,inferred:0,rowIssues};
 });
 const channel=normalize(rawKeeper),keeperCandidates=duration===null?[]:rows.filter(r=>r.p.eligible===true&&r.p.appearance!==false&&!r.field.length&&!r.unknown.length&&r.gkHard!==null&&Math.abs(r.gkHard-duration)<=EPSILON),channelOwner=keeperCandidates.length===1?keeperCandidates[0]:null;
 if(channelOwner&&channel.length){channelOwner.inferred=Math.max(0,intervalDuration(channel)-overlap(channel,channelOwner.keeper));channelOwner.keeper=union([...channelOwner.keeper,...channel]);}
 const mappedKeeper=union(rows.flatMap(r=>r.keeper)),genericKeeperObservedSeconds=intervalDuration(channel),unmappedChannelSeconds=Math.max(0,genericKeeperObservedSeconds-overlap(channel,mappedKeeper)),selectedNamedGk=rows.reduce((sum,r)=>sum+(r.gk??0),0);
 const unassignedGk=duration===null?unmappedChannelSeconds:Math.min(unmappedChannelSeconds,Math.max(0,duration-selectedNamedGk));
 if(windowKnown&&format){
  const effective=rows.filter(r=>r.totalHard===null&&r.fieldHard===null&&r.gkHard===null&&r.p.role!=='field'&&r.p.role!=='goalkeeper');
  const points=[...new Set([window.start,window.end,...effective.flatMap(r=>[...r.field,...r.keeper,...r.unknown].flat()),...channel.flat()])].sort((a,b)=>a-b);
  if(points.length>MAX_SEGMENTS)issue('allocation_timeline_limit',{endpoints:points.length});
  else for(let i=1;i<points.length;i++){const start=points[i-1],end=points[i];if(end<=start)continue;const present=s=>s.some(([a,b])=>a<end&&b>start),fields=effective.filter(r=>present(r.field)).map(r=>r.p.id),keepers=effective.filter(r=>present(r.keeper)).map(r=>r.p.id),participants=effective.filter(r=>present(r.field)||present(r.keeper)||present(r.unknown)).map(r=>r.p.id),unnamedKeeper=present(channel)&&!present(mappedKeeper)?1:0;
   if(participants.length+unnamedKeeper>format){issue('team_timeline_capacity',{start,end,playerIds:participants,unassignedKeeper:!!unnamedKeeper});break;}
   if(fields.length>format-1){issue('field_timeline_capacity',{start,end,playerIds:fields});break;}
   if(keepers.length>1){issue('goalkeeper_timeline_capacity',{start,end,playerIds:keepers});break;}
  }
 }
 const fieldAssigned=()=>rows.reduce((sum,r)=>sum+((r.rolesUnknown||r.total===null)&&r.fieldHard===null?r.observedField:r.fieldSeconds??0),0),gkAssigned=()=>rows.reduce((sum,r)=>sum+((r.rolesUnknown||r.total===null)&&r.gkHard===null?r.observedGk:r.gk??0),0)+unassignedGk,assigned=()=>rows.reduce((sum,r)=>sum+(r.total??r.lowerBoundSeconds??0),0),capacity=format&&duration!==null?format*duration:null;
 const finiteAccounting=Number.isFinite(fieldAssigned())&&Number.isFinite(gkAssigned())&&Number.isFinite(assigned());
 if(!finiteAccounting)issue('allocation_numeric_overflow');
 if(finiteAccounting&&duration!==null&&gkAssigned()>duration+EPSILON)issue('goalkeeper_capacity',{assignedSeconds:gkAssigned(),capacitySeconds:duration});
 if(finiteAccounting&&format&&duration!==null&&fieldAssigned()>(format-1)*duration+EPSILON)issue('field_capacity',{assignedSeconds:fieldAssigned(),capacitySeconds:(format-1)*duration});
 if(finiteAccounting&&capacity!==null&&assigned()+unassignedGk>capacity+EPSILON)issue('team_capacity',{assignedSeconds:assigned()+unassignedGk,capacitySeconds:capacity});
 if(input.estimateCapacity!==false&&capacity!==null&&violations.length===0){
  let budget=Math.max(0,Math.min(capacity-assigned()-unassignedGk,(format-1)*duration-fieldAssigned()));
  const compare=(a,b)=>a.total-b.total||(String(a.p.id)<String(b.p.id)?-1:String(a.p.id)>String(b.p.id)?1:0);
  let candidates=rows.filter(r=>r.fieldCandidate&&r.total<duration-EPSILON).sort(compare);
  for(let pass=0;budget>EPSILON&&candidates.length&&pass<MAX_PLAYERS*2;pass++){
   const minimum=candidates[0].total,low=candidates.filter(r=>r.total<=minimum+EPSILON),next=candidates.find(r=>r.total>minimum+EPSILON)?.total??duration,step=Math.min(next-minimum,...low.map(r=>duration-r.total),budget/low.length);
   if(!(step>EPSILON))break;for(const r of low){r.total+=step;r.fieldSeconds+=step;r.estimated+=step;}budget=Math.max(0,budget-step*low.length);candidates=candidates.filter(r=>r.total<duration-EPSILON).sort(compare);
  }
 }
 const resultPlayers=rows.map(r=>{
  const state=r.rowIssues.length?'conflicting':r.total===null?'unknown':r.p.appearance===false&&r.total===0?'confirmed_dnp':r.estimated>EPSILON?'estimated':r.totalBasis==='manual'||r.fieldBasis==='manual'||r.gkBasis==='manual'?'manual':r.totalBasis==='reported'||r.fieldBasis==='reported'||r.gkBasis==='reported'?'reported':r.observed>0?windowKnown&&format?'observed':'provisional':r.p.started===true||r.p.appearance===true?'provisional':'unknown';
  return{id:r.p.id,totalSeconds:r.total,lowerBoundSeconds:r.total??r.lowerBoundSeconds,fieldSeconds:r.rolesUnknown&&r.fieldHard===null?null:r.fieldSeconds,gkSeconds:r.rolesUnknown&&r.gkHard===null?null:r.gk,unknownRoleSeconds:r.unknownRole,observedSeconds:r.observed,observedTotalSeconds:r.observed,observedFieldSeconds:r.observedField,observedGkSeconds:r.observedGk,inferredSeconds:r.inferred,estimatedSeconds:r.estimated,state,
   provenance:{total:r.totalBasis??(r.gkBasis?'role_'+r.gkBasis:null),field:r.fieldBasis,goalkeeper:r.gkBasis,capacity:r.estimated>EPSILON?'bounded_field_capacity_estimate':null,sourceDiscrepancy:r.totalHard!==null&&Math.abs(r.totalHard-r.observed)>EPSILON?'selected_total_replaces_observed':null,roleDiscrepancy:r.gkHard===null&&r.gk!==null&&r.gk<r.observedGk-EPSILON?'observed_keeper_bounded_by_selected_total':null,roles:r.rolesUnknown?'partly_unknown':'resolved',window:windowKnown?'actual_half_window':'unknown',coverage:input.evidenceComplete===true?'complete_observations':'incomplete_observations',genericKeeper:r.inferred>EPSILON?'unique_explicit_full_half_keeper':null},constraintViolations:r.rowIssues};
 });
 const assignedSeconds=Number.isFinite(assigned())?assigned():null,overCapacity=capacity!==null&&(assignedSeconds===null||assignedSeconds+unassignedGk>capacity+EPSILON);
 return{players:resultPlayers,capacitySeconds:capacity,assignedSeconds,assignedIsLowerBound:rows.some(r=>r.total===null),unallocatedSeconds:capacity===null||assignedSeconds===null?null:Math.max(0,capacity-assignedSeconds-unassignedGk),unassignedGkSeconds:unassignedGk,genericKeeperObservedSeconds,unmappedKeeperObservedSeconds:unmappedChannelSeconds,goalkeeperAccounting:'anonymous_quantity_bounded_by_selected_named_roles',overCapacity,publishable:violations.length===0,coverage:windowKnown&&format?input.evidenceComplete===true?'complete_observations':'incomplete_observations':'unknown_format_or_window',violations};
}
