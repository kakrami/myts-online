// Frozen pre-factoring predicate oracle from consumer commit24d3f93.
// Test-only: compares all authority and selection semantics while query shape changes.
import {statisticalSelectionSQL} from '../../src/read-model/inclusion.js';
import {attendanceCTE,attendanceSelectionFilter} from '../../src/read-model/attendance.js';
import {rosterProvenanceSQL} from '../../src/read-model/roster-provenance.js';
import {publishedGameScopeCTE} from '../../src/domain/team-game-scope.js';
import {savedAnalysisSourceSQL} from '../../src/analysis/source-scope.js';
const invalid=message=>Object.assign(new Error(message),{code:'analysis_source_scope',status:409,failureKind:'blocked'});
const text=(v,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max;
const generation=v=>Number.isSafeInteger(v)&&v>0;
// Keep conjunctions balanced: D1's depth100 includes expanded canonical views
// and the transaction fence around these same immutable authority predicates.
const all=clauses=>{if(clauses.length===1)return '('+clauses[0]+')';const at=Math.floor(clauses.length/2);return '('+all(clauses.slice(0,at))+' AND '+all(clauses.slice(at))+')';};

/** Recheck only provider-backed fetch authority. Own collected pages may advance
 * source input revision, so it deliberately is not a continuation precondition.
 * Use before outbound requests and inside the page's existing commit fence. */
export function priorSourceCollectionProof(proof,{args,accountId,accountGeneration,teamId=null,seasonId=null}={}){
 const fields=['version','app_team_id','team_season_id','source_event_id','source_team_id','event_content_hash','member_id','member_content_hash','source_input_revision','attachment_id','attachment_generation','connection_generation','membership_generation','clips'];
 if(!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).some(k=>!fields.includes(k))||proof.version!==1||!['app_team_id','team_season_id','source_event_id','source_team_id','event_content_hash','member_id','member_content_hash','attachment_id'].every(k=>text(proof[k]))||!generation(proof.attachment_generation)||!generation(accountGeneration)||!text(accountId)||!Array.isArray(proof.clips)||proof.clips.length>2)throw invalid('Saved track fetch authority is incomplete.');
 for(const key of ['connection_generation','membership_generation'])if(proof[key]!==null&&!generation(proof[key]))throw invalid('Saved track connection generation is invalid.');
 if((proof.connection_generation===null)!==(proof.membership_generation===null)||teamId!==null&&teamId!==proof.app_team_id||seasonId!==null&&seasonId!==proof.team_season_id)throw invalid('Saved track fetch scope changed.');
 const gid=args?.track_gid||args?.gid;if(!text(gid,160)||!text(args?.game_id,256)||!text(args?.team_id,256)||!['home','away'].includes(args?.side)||args.player_id!=='track:'+encodeURIComponent(gid)||args.gids&&(!Array.isArray(args.gids)||args.gids.length!==1||args.gids[0]!==gid))throw invalid('Saved track native scope is invalid.');
 const halves=new Set(),ids=new Set();for(const c of proof.clips){if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['id','content_hash','half'].includes(k))||!text(c.id)||!text(c.content_hash)||![1,2].includes(c.half)||halves.has(c.half)||ids.has(c.id))throw invalid('Saved track clip authority is invalid.');halves.add(c.half);ids.add(c.id);}
 const clauses=[`e.id=?`,`e.provider='trace'`,`e.account_id=?`,`e.native_id=?`,`e.provenance='provider'`,`e.content_hash=?`,`account.active=1`,`account.generation=?`,`a.id=?`,`a.app_team_id=?`,`a.team_season_id=?`,`a.active=1`,`a.generation=?`,`native_team.id=?`,`native_team.provider='trace'`,`native_team.account_id=e.account_id`,`native_team.native_id=?`,`m.id=?`,`m.account_id=e.account_id`,`m.source_event_id=e.id`,`m.source_team_id=a.source_team_id`,`m.gid=?`,`m.side=?`,`m.side=event_team.side`,`m.provenance='provider'`,`m.content_hash=?`,savedAnalysisSourceSQL(),`(SELECT generation FROM team_source_connections root WHERE root.app_team_id=a.app_team_id AND root.source_team_id=a.source_team_id) IS ?`,`(SELECT membership.generation FROM team_connection_seasons membership JOIN team_source_connections root ON root.id=membership.connection_id WHERE root.app_team_id=a.app_team_id AND root.source_team_id=a.source_team_id AND membership.team_season_id=a.team_season_id) IS ?`,`NOT EXISTS(SELECT 1 FROM team_lifecycle lifecycle WHERE lifecycle.team_id=a.app_team_id)`,
 `EXISTS(SELECT 1 FROM analysis_game_targets target JOIN analysis_game_checked member ON member.run_id=target.run_id AND member.app_team_id=target.app_team_id AND member.team_season_id=target.team_season_id AND member.target_event_id=target.event_id WHERE target.app_team_id=a.app_team_id AND target.team_season_id=a.team_season_id AND target.locally_available=1 AND member.entitled=1 AND member.source_event_id=e.id AND member.participant_source_team_id=a.source_team_id AND member.account_id IS e.account_id AND NOT EXISTS(SELECT 1 FROM team_event_season_resolutions resolution WHERE resolution.app_team_id=a.app_team_id AND resolution.event_id IN(target.event_id,member.original_event_id) AND resolution.team_season_id IS NOT a.team_season_id))`,
 `NOT EXISTS(SELECT 1 FROM json_each(?) approved WHERE NOT EXISTS(SELECT 1 FROM source_trace_components clip WHERE clip.id=json_extract(approved.value,'$.id') AND clip.content_hash=json_extract(approved.value,'$.content_hash') AND clip.half=json_extract(approved.value,'$.half') AND clip.kind='clip' AND clip.provenance='provider' AND clip.account_id=e.account_id AND clip.source_event_id=e.id AND clip.source_team_id=a.source_team_id))`];
 const params=[proof.source_event_id,accountId,args.game_id,proof.event_content_hash,accountGeneration,proof.attachment_id,proof.app_team_id,proof.team_season_id,proof.attachment_generation,proof.source_team_id,args.team_id,proof.member_id,gid,args.side,proof.member_content_hash,proof.connection_generation,proof.membership_generation,JSON.stringify(proof.clips)];
 if(args.clip){if(![1,2].includes(args.half)||args.clip.half!==args.half||!halves.has(args.half)||![args.clip.start,args.clip.duration].every(Number.isFinite)||args.clip.duration<=0||!Number.isSafeInteger(args.clip.game_clip_id)||args.clip.game_clip_id<=0)throw invalid('Saved track clip changed.');clauses.push(`EXISTS(SELECT 1 FROM source_trace_components clip WHERE clip.account_id=e.account_id AND clip.source_event_id=e.id AND clip.source_team_id=a.source_team_id AND clip.provenance='provider' AND clip.kind='clip' AND clip.half=? AND json_extract(clip.evidence,'$.game_clip_id')=? AND json_extract(clip.evidence,'$.start')=? AND json_extract(clip.evidence,'$.duration')=?)`);params.push(args.half,args.clip.game_clip_id,args.clip.start,args.clip.duration);}
 else if(args.period){if(!['full','1','2'].includes(args.period.id))throw invalid('Saved track analytics period is invalid.');if(args.period.id==='full'){if(args.period.start!==null||args.period.end!==null)throw invalid('Saved track full-game bounds changed.');}else{const half=Number(args.period.id);if(!halves.has(half)||![args.period.start,args.period.end].every(Number.isFinite))throw invalid('Saved track half bounds changed.');clauses.push(`EXISTS(SELECT 1 FROM source_trace_components clip WHERE clip.account_id=e.account_id AND clip.source_event_id=e.id AND clip.source_team_id=a.source_team_id AND clip.provenance='provider' AND clip.kind='clip' AND clip.half=? AND json_extract(clip.evidence,'$.start')=? AND json_extract(clip.evidence,'$.start')+1000*json_extract(clip.evidence,'$.duration')=?)`);params.push(half,args.period.start,args.period.end);}}
 else throw invalid('Saved track collection component is invalid.');
 return {sql:`EXISTS(WITH analysis_selection AS(SELECT ? AS app_team_id,? AS team_season_id),${publishedGameScopeCTE('analysis_selection','analysis_game')} SELECT 1 FROM source_events e JOIN provider_accounts account ON account.id=e.account_id JOIN team_source_attachments a ON a.account_id=e.account_id JOIN source_teams native_team ON native_team.id=a.source_team_id JOIN source_event_teams event_team ON event_team.source_event_id=e.id AND event_team.source_team_id=a.source_team_id JOIN source_game_members m ON m.source_event_id=e.id AND m.source_team_id=a.source_team_id WHERE ${all(clauses)})`,params:[proof.app_team_id,proof.team_season_id,...params]};
}

export const savedMatchAnalysis=`(SELECT a.* FROM match_analysis a WHERE a.source_event_id IS NULL OR EXISTS(
  SELECT 1 FROM team_event_rows e JOIN team_projection_state p ON p.app_team_id=e.app_team_id AND p.team_season_id=e.team_season_id AND p.published_run_id=e.run_id
  JOIN team_projection_runs run ON run.id=e.run_id
  JOIN json_each(e.source_ids) j JOIN source_event_teams t ON t.source_event_id=j.value
  WHERE e.app_team_id=a.app_team_id AND e.team_season_id=a.team_season_id AND e.event_id=a.event_id AND j.value=a.source_event_id AND t.source_team_id=a.source_team_id
    AND(run.team_game_version=0 OR EXISTS(SELECT 1 FROM team_game_source_rows m WHERE m.run_id=e.run_id AND m.app_team_id=e.app_team_id AND m.team_season_id=e.team_season_id AND m.target_event_id=e.event_id AND m.source_event_id=a.source_event_id AND m.participant_source_team_id=a.source_team_id))))`;
const savedPlayerMatches=`(SELECT p.* FROM effective_player_matches p JOIN ${savedMatchAnalysis} a ON a.app_team_id=p.app_team_id AND a.team_season_id=p.team_season_id AND a.event_id=p.event_id AND a.active_run=p.run_id)`;
function selectionFilter(selection,options={}) {
  const clauses=['e.app_team_id=?','e.team_season_id=?',statisticalSelectionSQL(selection),"e.status IN('FINAL','COMPLETED')"],params=[selection.team_id,selection.team_season_id];
  if(selection.mode==='day'){clauses.push("COALESCE(e.local_day,substr(e.starts_at,1,10))=?");params.push(selection.date);}
  if(selection.type==='practices')clauses.push('0');
  if(selection.type==='analyzed')clauses.push(`EXISTS(SELECT 1 FROM ${savedMatchAnalysis} a WHERE a.app_team_id=e.app_team_id AND a.team_season_id=e.team_season_id AND a.event_id=e.event_id AND a.state IN('ready','estimated'))`);
  if(selection.period==='upcoming')clauses.push('0');
  if(selection.search){clauses.push("(e.home_name LIKE ? ESCAPE '\\' OR e.away_name LIKE ? ESCAPE '\\' OR e.title LIKE ? ESCAPE '\\')");const q='%'+selection.search.replace(/[\\%_]/g,v=>'\\'+v)+'%';params.push(q,q,q);}
  if(options.where){clauses.push('('+options.where+')');params.push(...(options.params||[]));}
  return {sql:clauses.join(' AND '),params};
}

// Select accepted events and native analytics from one published membership.
// A new global Trace alias cannot add an unpublished source to the game.
function selectedEventsCTE(filter) {
  return `selection_candidates AS(SELECT e.* FROM team_events e WHERE ${filter.sql}),analysis_selection AS(SELECT DISTINCT app_team_id,team_season_id FROM selection_candidates),${publishedGameScopeCTE('analysis_selection','analysis_game')},selected_events AS(SELECT e.* FROM selection_candidates e JOIN analysis_game_targets g ON g.app_team_id=e.app_team_id AND g.team_season_id=e.team_season_id AND g.event_id=e.event_id WHERE g.locally_available=1)`;
}
export function priorPlayerSeasonQuery(selection,options={}) {
  const filter=selectionFilter(selection,options),attendanceFilter=attendanceSelectionFilter(selection,options);
  // Original attendance is Yes / all selected tracked past events, rounded once.
  // Missing, unknown, conflicting and incomplete evidence stays explicit in the
  // counts and event cells; it does not remove an event from that denominator.
  const sql=`WITH ${selectedEventsCTE(filter)},attendance_events AS(SELECT e.* FROM team_events e WHERE ${attendanceFilter.sql}),${attendanceCTE()},
  attendance_totals AS(SELECT player_id,COUNT(*) AS attendance_events,SUM(has_response) AS attendance_responses,SUM(scope_complete) AS attendance_covered_events,SUM(status='Yes') AS yes,SUM(status='No') AS no,SUM(status='Maybe') AS maybe,SUM(status='NR') AS nr,SUM(status IN('Unknown','Unavailable')) AS unknown_responses,SUM(status='Unavailable') AS missing_responses,SUM(status='Conflict') AS attendance_conflicts FROM attendance_native WHERE tracked=1 GROUP BY player_id),
  player_totals AS(SELECT p.player_id,COUNT(*) AS analyzed_matches,SUM(p.appearance) AS apps,SUM(p.started) AS starts,SUM(p.minutes) AS minutes,SUM(p.field_minutes) AS field_minutes,SUM(p.gk_minutes) AS gk_minutes,
   SUM(CASE WHEN p.goals_state='manual' OR (p.goals_state='published' AND COALESCE(json_extract(a.evidence,'$.goal_total_conflict'),0)=0) THEN p.goals END) AS goals,
   SUM(CASE WHEN p.assists_state IN('published','manual') THEN p.assists END) AS assists,
   CASE WHEN COUNT(DISTINCT p.position)=1 THEN MIN(p.position) WHEN COUNT(DISTINCT p.position)>1 THEN 'Mixed' END AS match_position,
   SUM(p.minutes IS NOT NULL) AS minutes_matches,SUM(p.minutes_state='estimated') AS estimated_matches,SUM(p.minutes_state IN('incomplete','pending','human_review')) AS incomplete_matches,
   SUM(p.native_state='ready') AS native_matches,SUM(p.native_state='restricted') AS restricted_matches,SUM(p.native_state='unpublished') AS unpublished_matches,SUM(p.native_state='human_review') AS review_matches,
   SUM(p.goals IS NOT NULL AND p.goals_state IN('published','manual')) AS goals_matches,SUM(p.assists IS NOT NULL AND p.assists_state IN('published','manual')) AS assists_matches,
   SUM(p.passes_all) AS passes_all,SUM(p.passes_complete) AS passes_complete,SUM(p.shots) AS shots,SUM(p.shots_made) AS shots_made,SUM(p.turnovers_won) AS turnovers_won,SUM(p.turnovers_lost) AS turnovers_lost,SUM(p.box_touches) AS box_touches,SUM(p.player_touches) AS player_touches
   FROM ${savedPlayerMatches} p JOIN selected_events e ON e.app_team_id=p.app_team_id AND e.team_season_id=p.team_season_id AND e.event_id=p.event_id JOIN ${savedMatchAnalysis} a ON a.app_team_id=p.app_team_id AND a.team_season_id=p.team_season_id AND a.event_id=p.event_id GROUP BY p.player_id),
  effective AS(SELECT t.player_id AS id,t.name AS player,t.name,${rosterProvenanceSQL('t')} AS roster_provenance,COALESCE(json_extract(o.fields,'$.jersey'),t.jersey) AS jersey,CASE WHEN p.analyzed_matches>0 THEN p.match_position ELSE json_extract(o.fields,'$.position') END AS position,p.apps,p.starts,p.minutes,p.field_minutes,p.gk_minutes,p.goals,p.assists,
   CASE WHEN p.goals IS NOT NULL AND p.assists IS NOT NULL THEN p.goals+p.assists END AS g_plus_a,
   CASE WHEN p.minutes>0 AND p.goals IS NOT NULL AND p.assists IS NOT NULL THEN ROUND((p.goals+p.assists)*60.0/p.minutes,3) END AS g_plus_a_per_60,
   COALESCE(p.analyzed_matches,0) AS analyzed_matches,(SELECT COUNT(*) FROM selected_events) AS selected_matches,COALESCE(p.minutes_matches,0) AS minutes_matches,COALESCE(p.estimated_matches,0) AS estimated_matches,COALESCE(p.incomplete_matches,0) AS incomplete_matches,COALESCE(p.native_matches,0) AS native_matches,COALESCE(p.restricted_matches,0) AS restricted_matches,COALESCE(p.unpublished_matches,0) AS unpublished_matches,COALESCE(p.review_matches,0) AS review_matches,COALESCE(p.goals_matches,0) AS goals_matches,COALESCE(p.assists_matches,0) AS assists_matches,
   p.passes_all,p.passes_complete,p.shots,p.shots_made,p.turnovers_won,p.turnovers_lost,p.box_touches,p.player_touches,
   COALESCE(a.yes,0) AS yes,COALESCE(a.no,0) AS no,COALESCE(a.maybe,0) AS maybe,COALESCE(a.nr,0) AS nr,COALESCE(a.attendance_responses,0) AS attendance_responses,COALESCE(a.attendance_conflicts,0) AS attendance_conflicts,
   COALESCE(a.attendance_events,0) AS attendance_events,COALESCE(a.unknown_responses,0) AS attendance_unknown,COALESCE(a.missing_responses,0) AS attendance_missing,
   CASE WHEN a.attendance_events>0 THEN ROUND(a.yes*1.0/a.attendance_events*100) END AS attendance_pct
   FROM team_players t LEFT JOIN player_totals p ON p.player_id=t.player_id LEFT JOIN attendance_totals a ON a.player_id=t.player_id LEFT JOIN analysis_overrides o ON o.app_team_id=t.app_team_id AND o.team_season_id=t.team_season_id AND o.kind='player_season' AND o.player_id=t.player_id AND o.event_id='' WHERE t.app_team_id=? AND t.team_season_id=?) SELECT * FROM effective`;
  return {sql,params:[...filter.params,...attendanceFilter.params,selection.team_id,selection.team_season_id]};
}

