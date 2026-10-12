// Saved authorized evidence remains available when login/collection is paused.
// Once a durable connection exists, its current intent and season restriction
// are authoritative; an obsolete active attachment cannot bypass removal.
export function savedAnalysisSourceSQL(a='a'){
 return `(NOT EXISTS(SELECT 1 FROM team_source_connections analysis_root WHERE analysis_root.app_team_id=${a}.app_team_id AND analysis_root.source_team_id=${a}.source_team_id) OR EXISTS(SELECT 1 FROM team_source_connections analysis_root JOIN team_connection_seasons analysis_membership ON analysis_membership.connection_id=analysis_root.id AND analysis_membership.team_season_id=${a}.team_season_id WHERE analysis_root.app_team_id=${a}.app_team_id AND analysis_root.source_team_id=${a}.source_team_id AND analysis_root.account_id IS ${a}.account_id AND analysis_root.active=1 AND analysis_membership.active=1 AND analysis_membership.excluded=0))`;
}
