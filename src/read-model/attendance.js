import { inclusionSQL } from './inclusion.js';
import { localDay } from './selection.js';

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
 * canonical events. Missing evidence never becomes a provider NR response.
 * Coverage is checked against the event's own attached account and source team,
 * rather than any complete TeamSnap collection attached to this season.
 */
export function attendanceCTE(events='attendance_events') {
  if(!/^[a-z_]+$/.test(events))throw new Error('Invalid attendance event relation.');
  return `attendance_source_refs AS(
    SELECT e.app_team_id,e.team_season_id,e.event_id,l.source_event_id,l.source_team_id,l.account_id
    FROM ${events} e JOIN canonical_event_ids ci ON ci.canonical_id=e.event_id JOIN event_source_links el ON el.event_id=ci.input_id
    JOIN source_event_logistics l ON l.source_event_id=el.source_event_id
    JOIN team_source_attachments a ON a.app_team_id=e.app_team_id AND a.team_season_id=e.team_season_id AND a.source_team_id=l.source_team_id AND a.account_id=l.account_id AND a.active=1
    UNION
    SELECT e.app_team_id,e.team_season_id,e.event_id,s.source_event_id,s.source_team_id,s.account_id
    FROM ${events} e JOIN canonical_attendance c ON c.app_team_id=e.app_team_id AND c.team_season_id=e.team_season_id AND c.event_id=e.event_id
    JOIN source_attendance s ON s.source_event_id=c.source_event_id AND s.source_player_id=c.source_player_id
    JOIN team_source_attachments a ON a.app_team_id=e.app_team_id AND a.team_season_id=e.team_season_id AND a.source_team_id=s.source_team_id AND a.account_id=s.account_id AND a.active=1),
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
    SELECT c.app_team_id,c.team_season_id,c.event_id,c.player_id,CASE WHEN COUNT(DISTINCT c.status)>1 THEN 'Conflict' ELSE MIN(c.status) END AS status
    FROM canonical_attendance c JOIN ${events} e ON e.app_team_id=c.app_team_id AND e.team_season_id=c.team_season_id AND e.event_id=c.event_id
    GROUP BY c.app_team_id,c.team_season_id,c.event_id,c.player_id),
  attendance_native AS(
    SELECT e.app_team_id,e.team_season_id,e.event_id,p.player_id,p.name,p.jersey,
      CASE WHEN t.enabled=1 OR(t.enabled IS NULL AND t.has_response=1) THEN COALESCE(r.status,'Unavailable') ELSE 'Untracked' END AS status,
      r.status IS NOT NULL AS has_response,
      CASE WHEN t.enabled=1 OR(t.enabled IS NULL AND t.has_response=1) THEN 1 ELSE 0 END AS tracked,
      CASE WHEN t.tracking_conflict=1 THEN 0 ELSE COALESCE(t.scope_complete,0) END AS scope_complete,
      COALESCE(t.tracking_conflict,0) AS tracking_conflict
    FROM ${events} e JOIN team_players p ON p.app_team_id=e.app_team_id AND p.team_season_id=e.team_season_id
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
  return db.prepare(`SELECT r.content_revision,r.status_revision,COALESCE((SELECT p.pending FROM team_projection_state p WHERE p.team_season_id=? AND p.app_team_id=r.app_team_id),r.pending) AS pending,${ATTENDANCE_EVIDENCE_CLOCK_SQL} AS attendance_source_revision FROM team_read_state r WHERE r.app_team_id=?`).bind(selection.team_season_id,selection.team_id);
}
