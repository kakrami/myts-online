import {publishedGameScopeCTE} from '../domain/team-game-scope.js';

// Saved authorized evidence remains available when login/collection is paused.
// Once a durable connection exists, its current intent and season restriction
// are authoritative; an obsolete active attachment cannot bypass removal.
export function savedAnalysisSourceSQL(a='a'){
 return `(NOT EXISTS(SELECT 1 FROM team_source_connections analysis_root WHERE analysis_root.app_team_id=${a}.app_team_id AND analysis_root.source_team_id=${a}.source_team_id) OR EXISTS(SELECT 1 FROM team_source_connections analysis_root JOIN team_connection_seasons analysis_membership ON analysis_membership.connection_id=analysis_root.id AND analysis_membership.team_season_id=${a}.team_season_id WHERE analysis_root.app_team_id=${a}.app_team_id AND analysis_root.source_team_id=${a}.source_team_id AND analysis_root.account_id IS ${a}.account_id AND analysis_root.active=1 AND analysis_membership.active=1 AND analysis_membership.excluded=0))`;
}

// Local saved evidence and upstream fetch permission have separate lifetimes.
// Every native context here is an exact member of the captured publication;
// current global aliases or an unrelated active attachment cannot add Trace.
export function savedAnalysisContextsQuery(db,game) {
 return db.prepare(`WITH analysis_selection AS(SELECT ? AS app_team_id,? AS team_season_id),${publishedGameScopeCTE('analysis_selection','analysis_game')}
  SELECT e.*,m.participant_source_team_id AS source_team_id,t.native_id AS native_team_id,et.side,
    a.id AS attachment_id,a.generation AS attachment_generation,a.active AS attachment_active,
    root.generation AS connection_generation,membership.generation AS membership_generation,
    p.generation,p.active AS account_active,COALESCE(s.input_revision,0) AS input_revision
  FROM analysis_game_checked m JOIN analysis_game_targets g ON g.run_id=m.run_id AND g.app_team_id=m.app_team_id AND g.team_season_id=m.team_season_id AND g.event_id=m.target_event_id AND g.locally_available=1
  JOIN source_events e ON e.id=m.source_event_id JOIN source_teams t ON t.id=m.participant_source_team_id AND t.account_id IS m.account_id
  JOIN source_event_teams et ON et.source_event_id=m.source_event_id AND et.source_team_id=m.participant_source_team_id
  JOIN provider_accounts p ON p.id=m.account_id LEFT JOIN source_event_state s ON s.source_event_id=e.id
  LEFT JOIN team_source_attachments a ON a.id=m.attachment_id AND a.app_team_id=m.app_team_id AND a.team_season_id=m.team_season_id AND a.source_team_id=m.connected_source_team_id AND a.account_id IS m.account_id
  LEFT JOIN team_source_connections root ON root.id=m.connection_id
  LEFT JOIN team_connection_seasons membership ON membership.connection_id=m.connection_id AND membership.team_season_id=m.team_season_id
  WHERE m.run_id=? AND m.target_event_id=? AND m.provider='trace' AND m.entitled=1
  ORDER BY e.id,m.participant_source_team_id LIMIT 3`).bind(game.app_team_id,game.team_season_id,game.run_id,game.event_id);
}
