import {manualLineupDisplay} from './lineup-display.js';
import {ownerFormat} from './manual-format.js';
import {resolveMatchAnalysis,RESOLVER_VERSION} from './resolver/resolve.js';
import {normalizePosition} from './resolver/lineup.js';
import {nativeSpatial} from './spatial.js';
export const ANALYSIS_ALGORITHM_VERSION='shared-match/'+RESOLVER_VERSION+'/adapter-3';
export const parse=v=>typeof v==='string'?JSON.parse(v||'{}'):v||{};
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const present=(v,k)=>Object.hasOwn(v,k)&&v[k]!==null&&v[k]!==undefined;
const round=v=>v===null?null:Math.round(v*1000)/1000;
const supported=v=>normalizePosition(v)?.label||null;
const bool=v=>v===true||v===1?true:v===false||v===0?false:null;
const compact=f=>({state:f.state,basis:f.provenance.basis,source_refs:f.provenance.sourceRefs.slice(0,32),...(f.provenance.parts?{parts:f.provenance.parts.map(p=>({state:p.state,half:p.half,value:p.value}))}:{})});
export function manualLayer(fields={}){
 const result={};for(const [from,to] of [['minutes','totalSeconds'],['field_minutes','fieldSeconds'],['gk_minutes','gkSeconds']])if(present(fields,from))result[to]=fields[from]*60;
 for(const key of ['goals','assists','position'])if(present(fields,key)&&fields[key]!=='')result[key]=fields[key];
 for(const key of ['appearance','started'])if(present(fields,key))result[key]=bool(fields[key]);
 for(const [from,to]of [['slot_x','slotX'],['slot_y','slotY']])if(present(fields,from))result[to]=fields[from];
 return result;
}
function factRows(rows,members,assignedSources){
 const gids=new Set(members.map(m=>m.gid).filter(Boolean)),sources=new Set(members.map(m=>m.source_player_id).filter(Boolean));
 return rows.filter(r=>r.track_gid?members.some(m=>m.gid===r.track_gid&&m.assigned_player_id):r.source_player_id&&sources.has(r.source_player_id)&&!assignedSources.has(r.source_player_id));
}
function nativeState(rows,gids,members){
 const scopes=rows.flatMap(r=>r.track_gid?[r.track_gid]:members.filter(m=>m.source_player_id===r.source_player_id).map(m=>m.gid).filter(Boolean)),covered=new Set(scopes),complete=gids.length>0&&gids.every(g=>covered.has(g));
 return {complete,state:scopes.length!==covered.size?'human_review':rows.some(r=>r.state==='restricted')?'restricted':rows.length&&rows.every(r=>r.state==='unpublished')?'unpublished':!complete?'pending':rows.every(r=>r.state==='ready')?'ready':'incomplete'};
}
const sumNative=v=>v&&['offensive','middle','defensive'].every(k=>finite(v[k])!==null)?v.offensive+v.middle+v.defensive:null;
/** Adapt one complete authorized, bounded event snapshot. No I/O or per-page inference. */
export function resolveSnapshot(c){
 const usableNative=!!c.source&&c.header?.availability==='ready',header=parse(c.header?.evidence),radars=usableNative?c.components.filter(r=>r.kind==='radar'):[],clips=c.components.filter(r=>r.kind==='clip');
 const halves=[];for(const r of radars){const evidence=parse(r.evidence),window=evidence.analysis?.play_window,clip=clips.find(v=>v.half===r.half),clock=parse(clip?.evidence);if(!window||![1,2].includes(r.half)||finite(window.start)===null||finite(window.end)===null||window.end<=window.start)continue;
  const ownedGids=[...new Set(c.members.filter(m=>m.player_id&&m.side===c.source?.side&&(m.dummy===0||m.assigned_player_id)).map(m=>m.gid).filter(Boolean))],trackingComplete=ownedGids.length>0&&ownedGids.every(gid=>c.coverage.some(v=>v.kind==='tracking'&&v.scope===c.scope+':'+gid+':'+r.half&&v.complete));halves.push({id:r.half,start:window.start,end:window.end,complete:window.complete===true&&trackingComplete,...(clock.game_clip_id&&finite(clock.start)!==null?{clockOriginMs:clock.start}:{})});}
 const proof=radars.map(r=>parse(r.evidence).analysis).find(v=>v?.both_sides_verified===true),formatEvidence=proof?{bothSidesVerified:true,baselineTracks:proof.play_window?.baseline_tracks,historyFormatFamily:proof.history_format_family,declaredFormat:proof.declared_format}:undefined;
 const scopedMembers=c.members.filter(m=>m.side===c.source?.side&&(m.dummy===0||m.assigned_player_id)&&m.player_id),assignedSources=new Set(c.members.filter(m=>m.assigned_player_id&&m.source_player_id).map(m=>m.source_player_id));
 const manualIds=new Set([...c.overrides.filter(v=>v.kind==='player_match').map(v=>v.player_id),...c.lineup.map(v=>v.player_id)]),ids=[...new Set([...scopedMembers.map(m=>m.player_id),...manualIds])].sort();
 if(ids.length>128)throw Object.assign(new RangeError('A match has more than 128 canonical participants.'),{code:'analysis_bound'});
 const baseFacts=new Map(),players=ids.map(id=>{
  const members=scopedMembers.filter(m=>m.player_id===id),gids=[...new Set(members.map(v=>v.gid).filter(Boolean))],manual=parse(c.overrides.find(v=>v.kind==='player_match'&&v.player_id===id)?.fields),season=parse(c.overrides.find(v=>v.kind==='player_season'&&v.player_id===id)?.fields);
  const selected=usableNative?factRows(c.summaries,members,assignedSources):[],full=selected.filter(v=>v.period==='full'),native=nativeState(full,gids,members),summaries=native.state==='ready'?full.map(v=>parse(v.summary)):[],nativeTotal=fn=>summaries.length&&summaries.every(v=>fn(v)!==null)?summaries.reduce((n,v)=>n+fn(v),0):null;
  const maps=usableNative?factRows(c.heatmaps,members,assignedSources):[],map=maps.filter(v=>v.period==='full'),spatial=map.length===1?nativeSpatial(map[0]):null;
  // Collection completeness is independent of radar-derived playing windows.
  // Missing radar still leaves calculated minutes unknown in the resolver.
  const tracking=usableNative?c.tracking.filter(t=>gids.includes(t.gid)):[],trackingComplete=usableNative&&gids.length>0&&[1,2].every(half=>clips.some(clip=>clip.half===half)&&gids.every(gid=>c.coverage.some(v=>v.kind==='tracking'&&v.scope===c.scope+':'+gid+':'+half&&v.complete)));
  const credited=usableNative?c.credited.find(v=>v.player_id===id):null,reported={match:{},halves:{}};if(usableNative&&c.momentsComplete){reported.match.goals=credited?.goals||0;reported.match.assists=credited?.assists||0;}if((credited?.goals||0)+(credited?.assists||0)>0)reported.match.appearance=true;
  const positions=[...new Set(members.map(m=>supported(m.position)).filter(Boolean))];if(usableNative&&positions.length===1)reported.match.position=positions[0];
  const layer={match:manualLayer(manual),halves:{}};
  // Preserve original pitch-anchor intent, but let a later explicit half slot
  // override only that half. Do not pass competing point/ordinal intents.
  if(present(manual,'slot_x')&&present(manual,'slot_y')){for(const h of [1,2])layer.halves[h]={slotX:manual.slot_x,slotY:manual.slot_y};delete layer.match.slotX;delete layer.match.slotY;}
  for(const assignment of c.lineup.filter(v=>v.player_id===id)){const decision={started:assignment.slot_kind==='field'};if(assignment.position)decision.position=assignment.position;if(assignment.slot_kind==='field'){decision.appearance=true;decision.role=assignment.position==='GK'||assignment.slot===1?'goalkeeper':'field';decision.slot=assignment.slot;}layer.halves[assignment.half]=decision;}
  // A provider position label is not a timed role assignment. Spatial evidence
  // is useful for positions only with source-proved attacking orientation.
  const spatialFor=(s,h)=>{const orientation=radars.find(r=>r.half===h);const evidence=parse(orientation?.evidence).analysis;if(!s||evidence?.display_orientation!=='own_goal_left')return null;return {...s,display_orientation:'own_goal_left',tactical_left_is_top:evidence.tactical_left_is_top===true};};
  const spatialHalves={};for(const h of [1,2]){const rows=maps.filter(v=>v.period===String(h));if(rows.length===1)spatialHalves[h]=spatialFor(nativeSpatial(rows[0]),h);}
  baseFacts.set(id,{members,gids,native,full,tracking,trackingComplete,spatial,nativeValues:{passes_all:nativeTotal(v=>sumNative(v.passes_all)),passes_complete:nativeTotal(v=>sumNative(v.passes_complete)),shots:nativeTotal(v=>finite(v.shots?.total)??sumNative(v.shots)),shots_made:nativeTotal(v=>finite(v.shots?.made)),turnovers_won:nativeTotal(v=>sumNative(v.turnovers_won)),turnovers_lost:nativeTotal(v=>sumNative(v.turnovers_lost)),box_touches:nativeTotal(v=>sumNative(v.box_touches)),player_touches:nativeTotal(v=>sumNative(v.player_touches)),possession:summaries.length===1?finite(summaries[0].total_possession):null}});
  return {id,eligible:members.length>0||manualIds.has(id),manual:layer,reported,season:{position:supported(season.position)},spatial:{halves:spatialHalves}};
 });
 const observations=(usableNative?c.tracking:[]).map((t,i)=>{const matches=c.members.filter(m=>m.gid===t.gid&&m.side===c.source.side),mapped=[...new Set(matches.filter(m=>m.player_id&&(m.dummy===0||m.assigned_player_id)).map(m=>m.player_id))],roleProof=parse(radars.find(r=>r.half===t.half)?.evidence).analysis?.track_roles?.find(v=>v.gid===t.gid&&v.side===c.source.side&&v.verified===true),role=roleProof&&['field','goalkeeper'].includes(roleProof.role)?roleProof.role:'unknown';return {id:'observation:'+i,playerId:mapped.length===1?mapped[0]:null,half:t.half,side:matches.length||roleProof?'own':'opponent',dummy:role==='goalkeeper'&&mapped.length===0?false:matches.length>0&&matches.every(m=>m.dummy&&!m.assigned_player_id),mapping:mapped.length===1?'verified':'unresolved',role,segments:parse(t.segments),source:{id:t.id}};});
 const format={};const manualFormat=ownerFormat(c.overrides.find(v=>v.kind==='match'),c.lineupHeader);if([7,9].includes(manualFormat))format.manual=manualFormat;if(usableNative&&header.analysis?.format_verified===true&&[7,9].includes(header.analysis.format))format.reported=header.analysis.format;
 const result=resolveMatchAnalysis({context:{teamId:c.teamId,seasonId:c.seasonId,eventId:c.eventId,inputRevision:c.input,sourceRevision:c.revision.source_revision,commitSignature:c.input},format,formatEvidence,halves,players,observations});
 const facts=result.players.map(p=>{
  const b=baseFacts.get(p.id),quality=(f,type)=>f.value===null?c.source?c.header?.availability==='restricted'?'restricted':'pending':'unsupported':f.state==='manual'?'manual':f.state==='season_default'?'season_default':type==='minutes'&&p.estimatedSeconds>0?'estimated':['reported','inferred','mixed'].includes(f.state)?(type==='minutes'&&!b.trackingComplete&&f.state!=='reported'?'incomplete':'published'):f.state;
  const analysis={version:ANALYSIS_ALGORITHM_VERSION,observed_seconds:p.observedSeconds,estimated_seconds:p.estimatedSeconds,halves:{}};
  for(const [key,field]of [['appearance','appearance'],['started','started'],['minutes','minutes'],['field_minutes','fieldMinutes'],['gk_minutes','gkMinutes'],['position','position']])analysis[key]=compact(p[field]);
  for(const [h,half]of Object.entries(p.halves))analysis.halves[h]={minutes:round(half.totalSeconds.value===null?null:half.totalSeconds.value/60),field_minutes:round(half.fieldSeconds.value===null?null:half.fieldSeconds.value/60),gk_minutes:round(half.gkSeconds.value===null?null:half.gkSeconds.value/60),appearance:half.appearance.value,started:half.started.value,position:half.position.value,lineup_state:result.lineups[h]?.slots.some(v=>v.player_id===p.id)?'field':result.lineups[h]?.bench.includes(p.id)?'bench':result.lineups[h]?.unknown.includes(p.id)?'unknown':null,states:{minutes:half.totalSeconds.state,field_minutes:half.fieldSeconds.state,gk_minutes:half.gkSeconds.state,position:half.position.state},observed_seconds:half.observedSeconds,estimated_seconds:half.estimatedSeconds,lower_bound_seconds:half.lowerBoundSeconds?.value??null,unknown_role_seconds:half.unknownRoleSeconds??null};
  const sourceProvenance={event:c.source?.provenance||null,native:b.full.some(v=>v.provenance==='file_import')?'file_import':b.full.length?'provider':null,tracking:b.tracking.some(v=>v.provenance==='file_import')?'file_import':b.tracking.length?'provider':null,moments:c.momentsImported?'file_import':c.source?'provider':null,corrections:Object.keys(players.find(v=>v.id===p.id).manual.match).length?'manual':null};
  return {app_team_id:c.teamId,team_season_id:c.seasonId,event_id:c.eventId,player_id:p.id,appearance:p.appearance.value===null?null:Number(p.appearance.value),started:p.started.value===null?null:Number(p.started.value),minutes:round(p.minutes.value),field_minutes:round(p.fieldMinutes.value),gk_minutes:round(p.gkMinutes.value),goals:p.goals.value,assists:p.assists.value,position:p.position.value,minutes_state:quality(p.minutes,'minutes'),goals_state:quality(p.goals,'goals'),assists_state:quality(p.assists,'assists'),position_state:quality(p.position,'position'),native_state:c.source?['restricted','unpublished'].includes(c.header?.availability)?c.header.availability:b.native.state:'unsupported',tracking_state:b.trackingComplete?'complete':b.tracking.length?'incomplete':c.source?'pending':'unsupported',...b.nativeValues,spatial:b.spatial?JSON.stringify(b.spatial):null,source_ids:JSON.stringify([...new Set(b.members.map(v=>v.source_player_id).filter(Boolean))]),evidence:JSON.stringify({analysis,source_provenance:sourceProvenance,native_summary_ids:b.full.map(v=>v.id),native_complete:b.native.complete,tracking_complete:b.trackingComplete,moments_complete:c.momentsComplete,override_revisions:c.overrides.filter(v=>v.player_id===p.id).map(v=>({kind:v.kind,revision:v.revision}))})};
 });
 const lineups=Object.fromEntries(Object.entries(result.lineups).map(([h,l])=>[h,{formation:l.formation,slots:l.slots.map((s,i)=>({id:String(i+1),slot:i+1,position:s.position,x:s.x,y:s.y,player_id:s.player_id,name:c.rosterLabels?.find(v=>v.player_id===s.player_id)?.name||null,jersey:c.rosterLabels?.find(v=>v.player_id===s.player_id)?.jersey||null,state:s.provenance?.kind||'unknown'})),bench_count:(l.bench||[]).length,unknown_count:(l.unknown||[]).length}]));
 for(const h of [1,2])if(!lineups[h]){const saved=c.lineup.filter(v=>v.half===h),display=manualLineupDisplay(result.format.value,saved,[...(c.rosterLabels||[]),...Object.values(parse(c.published?.evidence).lineups||{}).flatMap(l=>l.slots||[])]);if(!display)continue;lineups[h]=display;for(const f of facts){const evidence=parse(f.evidence),a=saved.find(v=>v.player_id===f.player_id);evidence.analysis.halves[h]={lineup_state:a?a.slot_kind==='field'?'field':'bench':'unknown',clock_unavailable:true};f.evidence=JSON.stringify(evidence);}}
 return {result,facts,lineups,halves};
}
