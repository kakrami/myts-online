import { inclusionSQL } from './inclusion.js';
import { localDay } from './selection.js';
import { publishedGameScopeCTE } from '../domain/team-game-scope.js';

/** Attendance is an event history, not a completed-game statistics query.
 * Keep the saved season inclusion controls, but allow practices and past
 * scheduled events (TeamSnap does not assert completed result status).
 */
export function attendanceSelectionFilter(selection, {now=Date.now(),where,params=[]}={}) {
  const at=new Date(now).toISOString(),day=localDay(at,selection.timezone);
  const clauses=['e.app_team_id=?','e.team_season_id=?',"e.status<>'CANCELLED'",'e.conditional=0','e.identity_conflict=0',inclusionSQL('e'),
    '((e.starts_at IS NOT NULL AND e.starts_at<=?) OR(e.starts_at IS NULL AND e.local_day<=?))'];
  const values=[selection.team_id,selection.team_season_id,at,day];
  if(!selection.include_june)clauses.push("substr(COALESCE(e.local_day,substr(e.starts_at,1,10)),6,2)<>'06'");
  if(where){clauses.push('('+where+')');values.push(...params);}
  return {sql:clauses.join(' AND '),params:values};
}

/** Shared event/player attendance cells. The caller supplies season-qualified
 * published team-local events. Missing evidence never becomes a provider NR response.
 * Coverage is checked against the event's own attached account and source team,
 * rather than any complete TeamSnap collection attached to this season.
 */
export function attendanceCTE(events='attendance_events',{gamePrefix=null}={}) {
  if(!/^[a-z_]+$/.test(events))throw new Error('Invalid attendance event relation.');
  if(gamePrefix!==null&&!/^[a-z_]+$/.test(gamePrefix))throw new Error('Invalid attendance game relation.');
  const prefix=gamePrefix??'attendance_game',membership=gamePrefix===null?`attendance_game_selection AS(SELECT DISTINCT app_team_id,team_season_id FROM ${events}),${publishedGameScopeCTE('attendance_game_selection',prefix)},`:'';
  return `${membership}
  attendance_source_refs AS(
    SELECT DISTINCT e.app_team_id,e.team_season_id,e.event_id,m.source_event_id,m.participant_source_team_id AS source_team_id,m.account_id
    FROM ${events} e JOIN ${prefix}_targets g ON g.app_team_id=e.app_team_id AND g.team_season_id=e.team_season_id AND g.event_id=e.event_id AND g.locally_available=1
    JOIN ${prefix}_checked m ON m.run_id=g.run_id AND m.app_team_id=g.app_team_id AND m.team_season_id=g.team_season_id AND m.target_event_id=g.event_id AND m.entitled=1
    WHERE m.provider='teamsnap'),
  attendance_tracking AS(
    SELECT r.app_team_id,r.team_season_id,r.event_id,MAX(l.availability_enabled) AS enabled,
      CASE WHEN MIN(l.availability_enabled)<>MAX(l.availability_enabled) THEN 1 ELSE 0 END AS tracking_conflict,
      MAX(EXISTS(SELECT 1 FROM source_attendance s WHERE s.source_event_id=r.source_event_id AND s.source_team_id=r.source_team_id AND s.account_id=r.account_id)) AS has_response,
      MIN(COALESCE(c.complete,0)) AS scope_complete
    FROM attendance_source_refs r JOIN source_teams t ON t.id=r.source_team_id AND t.provider='teamsnap' AND t.account_id=r.account_id
    LEFT JOIN source_event_logistics l ON l.source_event_id=r.source_event_id AND l.source_team_id=r.source_team_id AND l.account_id=r.account_id
    LEFT JOIN source_component_coverage c ON c.provider='teamsnap' AND c.account_id=r.account_id AND c.kind='attendance' AND c.scope='teamsnap:'||t.native_id
    GROUP BY r.app_team_id,r.team_season_id,r.event_id),
  attendance_responses AS(
    SELECT r.app_team_id,r.team_season_id,r.event_id,pc.canonical_id AS player_id,CASE WHEN COUNT(DISTINCT s.status)>1 THEN 'Conflict' ELSE MIN(s.status) END AS status
    FROM attendance_source_refs r JOIN source_attendance s ON s.source_event_id=r.source_event_id AND s.source_team_id=r.source_team_id AND s.account_id=r.account_id
    JOIN source_players sp ON sp.id=s.source_player_id AND sp.account_id=r.account_id AND sp.provider='teamsnap'
    JOIN player_source_links pl ON pl.source_player_id=sp.id JOIN canonical_player_ids pc ON pc.input_id=pl.player_id
    JOIN team_players p ON p.app_team_id=r.app_team_id AND p.team_season_id=r.team_season_id AND p.player_id=pc.canonical_id
    GROUP BY r.app_team_id,r.team_season_id,r.event_id,pc.canonical_id),
  attendance_native AS(
    SELECT e.app_team_id,e.team_season_id,e.event_id,p.player_id,p.name,p.jersey,
      CASE WHEN t.enabled=1 OR(t.enabled IS NULL AND t.has_response=1) THEN COALESCE(r.status,'Unavailable') ELSE 'Untracked' END AS status,
      r.status IS NOT NULL AS has_response,
      CASE WHEN t.enabled=1 OR(t.enabled IS NULL AND t.has_response=1) THEN 1 ELSE 0 END AS tracked,
      CASE WHEN t.tracking_conflict=1 THEN 0 ELSE COALESCE(t.scope_complete,0) END AS scope_complete,
      COALESCE(t.tracking_conflict,0) AS tracking_conflict
    FROM ${events} e JOIN ${prefix}_targets g ON g.app_team_id=e.app_team_id AND g.team_season_id=e.team_season_id AND g.event_id=e.event_id AND g.locally_available=1
    JOIN team_players p ON p.app_team_id=e.app_team_id AND p.team_season_id=e.team_season_id
    LEFT JOIN attendance_tracking t ON t.app_team_id=e.app_team_id AND t.team_season_id=e.team_season_id AND t.event_id=e.event_id
    LEFT JOIN attendance_responses r ON r.app_team_id=e.app_team_id AND r.team_season_id=e.team_season_id AND r.event_id=e.event_id AND r.player_id=p.player_id)`;
}

// Both clocks are monotonic. Domain changes include canonical identity and
// attachment decisions which can alter the evidence view before projection.
export const ATTENDANCE_EVIDENCE_CLOCK_SQL=`(COALESCE((SELECT revision FROM source_serialization_clock WHERE id=1),0)+COALESCE((SELECT mutation_revision FROM domain_installation WHERE id=1),0))`;

// Attendance is read from retained evidence before a new projection publishes.
// A conservative source clock also notices deletions and coverage changes;
// callers hash it into opaque cursor revisions rather than exposing it.
export function attendanceStateQuery(db,selection) {
  return db.prepare(`SELECT r.content_revision,r.status_revision,(SELECT p.published_run_id FROM team_projection_state p WHERE p.team_season_id=? AND p.app_team_id=r.app_team_id) AS published_run_id,COALESCE((SELECT p.pending FROM team_projection_state p WHERE p.team_season_id=? AND p.app_team_id=r.app_team_id),r.pending) AS pending,${ATTENDANCE_EVIDENCE_CLOCK_SQL} AS attendance_source_revision FROM team_read_state r WHERE r.app_team_id=?`).bind(selection.team_season_id,selection.team_season_id,selection.team_id);
}
