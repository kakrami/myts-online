// Relocation is part of the caller's canonical calendar-membership transaction.
// This module neither commits nor publishes: the caller must check precondition,
// replace each $FENCE with its transaction guard, and dirty both projections.
const MAX_KEYS = 256;
const MAX_SNAPSHOT_BYTES = 32000;
// Published projections can lag a committed move. Their old row must never
// authorize recreating private game state in the former season. No resolution
// means legacy membership still applies; a pending/null resolution grants none.
export function acceptedGameSeason(teamId,seasonId,eventId) {
  return {sql:`NOT EXISTS(SELECT 1 FROM team_event_season_resolutions r WHERE r.app_team_id=? AND r.event_id IN(SELECT input_id FROM canonical_event_ids WHERE canonical_id=(SELECT canonical_id FROM canonical_event_ids WHERE input_id=?)) AND r.team_season_id IS NOT ?)`,params:[teamId,eventId,seasonId]};
}
const EVENT_SCOPE = 'event_id IN(SELECT id FROM event_ids)';
const TRACK_SCOPE = `EXISTS(SELECT 1 FROM event_source_links l JOIN canonical_event_ids c ON c.input_id=l.event_id WHERE l.source_event_id=analysis_track_assignments.source_event_id AND c.canonical_id=(SELECT event_id FROM scope))`;
const from = `(SELECT from_season_id FROM scope)`;
const to = `(SELECT to_season_id FROM scope)`;
const team = `(SELECT team_id FROM scope)`;
const scoped = (table, season = from) => `app_team_id=${team} AND team_season_id=${season} AND ${table === 'analysis_track_assignments' ? TRACK_SCOPE : EVENT_SCOPE}`;
const PREFIX = `WITH scope AS(SELECT ? AS team_id,? AS from_season_id,? AS to_season_id,? AS event_id),event_ids AS(SELECT input_id AS id FROM canonical_event_ids WHERE canonical_id=(SELECT event_id FROM scope))`;
const lists = [
  ['analysis_overrides', ['event_id','kind','player_id','revision'], " AND kind IN('match','player_match')"],
  ['analysis_track_assignments', ['source_event_id','source_team_id','gid','revision'], ''],
  ['analysis_lineup_headers', ['event_id','revision'], ''],
  ['coach_sessions', ['event_id','revision'], ''],
];
const children = ['analysis_lineup_assignments','coach_session_players','coach_lineup','coach_stints','coach_timeline'];
const listSQL = ([table, fields, extra]) => `(SELECT json_group_array(json(row_value)) FROM(SELECT json_array(${fields.join(',')}) AS row_value FROM ${table} WHERE ${scoped(table)}${extra} ORDER BY ${fields.slice(0,-1).join(',')} LIMIT ${MAX_KEYS + 1}))`;
const conflict=(code,table,condition)=>`CASE WHEN ${condition} THEN json_object('code','${code}','table','${table}') END`;
const collisionSQL = lists.map(([table,,extra]) => conflict('destination_collision',table,`EXISTS(SELECT 1 FROM ${table} WHERE ${scoped(table,to)}${extra})`)).concat([
  conflict('ambiguous_source_state','analysis_lineup_headers',`(SELECT count(*) FROM analysis_lineup_headers WHERE ${scoped('analysis_lineup_headers')})>1`),
  conflict('ambiguous_source_state','coach_sessions',`(SELECT count(*) FROM coach_sessions WHERE ${scoped('coach_sessions')})>1`),
  conflict('unverified_track_scope','analysis_track_assignments',`EXISTS(SELECT 1 FROM analysis_track_assignments WHERE ${scoped('analysis_track_assignments')} AND NOT EXISTS(SELECT 1 FROM source_event_teams st WHERE st.source_event_id=analysis_track_assignments.source_event_id AND st.source_team_id=analysis_track_assignments.source_team_id))`),
  ...lists.map(([table,,extra]) => conflict('state_limit',table,`(SELECT count(*) FROM(SELECT 1 FROM ${table} WHERE ${scoped(table)}${extra} LIMIT ${MAX_KEYS + 1}))>${MAX_KEYS}`)),
]).join(',');
const snapshotSQL = `json_array(${lists.map(listSQL).join(',')},${children.map(table => `(SELECT count(*) FROM ${table} WHERE ${scoped(table)})`).join(',')})`;
const INSPECT = `${PREFIX},observed AS(SELECT
  EXISTS(SELECT 1 FROM app_teams t JOIN team_seasons old ON old.app_team_id=t.id AND old.id=${from} JOIN team_seasons next ON next.app_team_id=t.id AND next.id=${to} WHERE t.id=${team} AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id))
  AND EXISTS(SELECT 1 FROM canonical_event_ids c WHERE c.input_id=(SELECT event_id FROM scope) AND c.canonical_id=c.input_id)
  AND (EXISTS(SELECT 1 FROM team_event_season_resolutions r WHERE r.app_team_id=${team} AND r.event_id=(SELECT event_id FROM scope) AND r.team_season_id=${from})
    OR(NOT EXISTS(SELECT 1 FROM team_event_season_resolutions r WHERE r.app_team_id=${team} AND r.event_id=(SELECT event_id FROM scope)) AND EXISTS(SELECT 1 FROM team_events e WHERE e.app_team_id=${team} AND e.team_season_id=${from} AND e.event_id=(SELECT event_id FROM scope)))) AS valid_scope,
  ${snapshotSQL} AS snapshot,
  (SELECT json_group_array(json(value)) FROM json_each(json_array(${collisionSQL})) WHERE type<>'null') AS conflicts)
 SELECT valid_scope,CASE WHEN length(CAST(snapshot AS BLOB))<=${MAX_SNAPSHOT_BYTES} THEN snapshot END AS snapshot,conflicts FROM observed`;

/**
 * Return a bounded, optimistic SQL plan for one canonical game's owner state.
 * The season IDs must already exist, belong to this team, and match its last
 * accepted membership. A collision never chooses a winner or moves any rows.
 * Revision snapshots include keys, so inserted/deleted rows also invalidate a
 * prepared plan. Normal child writers increment their owning header revision;
 * child counts additionally detect changed membership. IDs and content are read
 * live by the atomic SQL moves, never copied out through an unbounded JS array.
 */
export async function prepareGameSeasonMove(db,{teamId,eventId,fromSeasonId,toSeasonId}) {
  const params=[teamId,fromSeasonId,toSeasonId,eventId];
  if(params.some(value=>typeof value!=='string'||!value||value.length>512))return {ok:false,conflicts:[{code:'invalid_scope',table:null}],statements:[],statementCount:0,precondition:null};
  const inspection=await db.prepare(INSPECT).bind(...params).first();
  if(fromSeasonId===toSeasonId&&inspection?.valid_scope)return {ok:true,conflicts:[],statements:[],statementCount:0,precondition:{sql:`EXISTS(SELECT 1 FROM(${INSPECT}) WHERE valid_scope=1)`,params}};
  const conflicts=JSON.parse(inspection?.conflicts??'[]');
  if(!inspection?.valid_scope)conflicts.unshift({code:'invalid_scope',table:null});
  if(inspection?.snapshot==null)conflicts.push({code:'state_limit',table:null});
  if(conflicts.length)return {ok:false,conflicts,statements:[],statementCount:0,precondition:null};
  const statements=[];
  // Collector mutations must start with their write verb. Expand the small
  // scope expressions to ordinary placeholders instead of a leading WITH.
  const values={team_id:teamId,from_season_id:fromSeasonId,to_season_id:toSeasonId,event_id:eventId};
  const add=sql=>{
    const bindings=[];
    const expanded=sql.replaceAll('(SELECT id FROM event_ids)','(SELECT input_id FROM canonical_event_ids WHERE canonical_id=(SELECT event_id FROM scope))')
      .replace(/\(SELECT (team_id|from_season_id|to_season_id|event_id) FROM scope\)/g,(_,key)=>{bindings.push(values[key]);return '?';});
    statements.push({sql:`${expanded} AND $FENCE`,params:bindings});
  };
  add(`UPDATE analysis_overrides SET team_season_id=${to},revision=revision+1 WHERE ${scoped('analysis_overrides')} AND kind IN('match','player_match')`);
  add(`UPDATE analysis_track_assignments SET team_season_id=${to},revision=revision+1 WHERE ${scoped('analysis_track_assignments')}`);
  // Immediate foreign keys are intentional. Insert destination parents before
  // repointing children, then delete only the now-empty source parents.
  add(`INSERT INTO analysis_lineup_headers SELECT app_team_id,${to},event_id,format,revision+1,updated_at FROM analysis_lineup_headers WHERE ${scoped('analysis_lineup_headers')}`);
  add(`UPDATE analysis_lineup_assignments SET team_season_id=${to} WHERE ${scoped('analysis_lineup_assignments')}`);
  add(`DELETE FROM analysis_lineup_headers WHERE ${scoped('analysis_lineup_headers')}`);
  add(`INSERT INTO coach_sessions SELECT app_team_id,${to},event_id,format,half_minutes,phase,period,elapsed_ms,period_start_ms,running_since,clock_review,revision+1,updated_at,write_token FROM coach_sessions WHERE ${scoped('coach_sessions')}`);
  add(`INSERT INTO coach_session_players SELECT app_team_id,${to},event_id,player_id,name,jersey,available,availability_source,minutes_override_ms FROM coach_session_players WHERE ${scoped('coach_session_players')}`);
  for(const table of ['coach_lineup','coach_stints','coach_timeline'])add(`UPDATE ${table} SET team_season_id=${to} WHERE ${scoped(table)}`);
  add(`DELETE FROM coach_session_players WHERE ${scoped('coach_session_players')}`);
  add(`DELETE FROM coach_sessions WHERE ${scoped('coach_sessions')}`);
  return {ok:true,conflicts:[],statements,statementCount:statements.length,precondition:{sql:`EXISTS(SELECT 1 FROM(${INSPECT}) WHERE valid_scope=1 AND conflicts='[]' AND snapshot=?)`,params:[...params,inspection.snapshot]}};
}
