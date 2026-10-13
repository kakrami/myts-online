// Accepted analysis may outlive a team projection. Never display native facts
// whose original source/team is no longer part of that published target. The
// caller's shared game scope also checks normalized membership and local intent.
export const savedMatchAnalysis=`(SELECT a.* FROM match_analysis a WHERE a.source_event_id IS NULL OR EXISTS(
  SELECT 1 FROM team_event_rows e JOIN team_projection_state p ON p.app_team_id=e.app_team_id AND p.team_season_id=e.team_season_id AND p.published_run_id=e.run_id
  JOIN team_projection_runs run ON run.id=e.run_id
  JOIN json_each(e.source_ids) j JOIN source_event_teams t ON t.source_event_id=j.value
  WHERE e.app_team_id=a.app_team_id AND e.team_season_id=a.team_season_id AND e.event_id=a.event_id AND j.value=a.source_event_id AND t.source_team_id=a.source_team_id
    AND(run.team_game_version=0 OR EXISTS(SELECT 1 FROM team_game_source_rows m WHERE m.run_id=e.run_id AND m.app_team_id=e.app_team_id AND m.team_season_id=e.team_season_id AND m.target_event_id=e.event_id AND m.source_event_id=a.source_event_id AND m.participant_source_team_id=a.source_team_id))))`;

const identifier=value=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw new TypeError('Invalid analysis relation.');return value;};
// Preserve completed-game coverage and add retained, accepted player facts.
// Readiness, date and result status never erase a known quantity. A future
// schedule entry with no saved player row does not imply missing analytics.
export function analysisCoverageSQL(saved='selected_analysis',alias='e') {
  saved=identifier(saved);alias=identifier(alias);
  return `${alias}.status<>'CANCELLED' AND (${alias}.status IN('FINAL','COMPLETED') OR EXISTS(SELECT 1 FROM ${saved} a JOIN player_match_analysis p ON p.run_id=a.active_run AND p.app_team_id=a.app_team_id AND p.team_season_id=a.team_season_id AND p.event_id=a.event_id WHERE a.app_team_id=${alias}.app_team_id AND a.team_season_id=${alias}.team_season_id AND a.event_id=${alias}.event_id))`;
}

// Original Analyzed games came from accepted published match payloads, not
// discovery fixtures or fetched headers. Keep pre-existing ready/manual reads,
// and admit accepted partial Trace payloads (even with no player rows). A first
// rejected attempt has publishable=false; a rejected rebuild keeps prior proof.
export function acceptedAnalysisPublicationSQL(alias='a') {
  alias=identifier(alias);
  return `(${alias}.state IN('ready','estimated') OR json_extract(${alias}.evidence,'$.accepted_state') IN('ready','estimated') OR (json_extract(${alias}.evidence,'$.analysis.publishable')=1 AND COALESCE(json_extract(${alias}.evidence,'$.accepted_state'),${alias}.state) IN('incomplete','human_review') AND json_extract(${alias}.evidence,'$.source_provenance.header') IN('provider','file_import')))`;
}

// Reuse the caller's published-game membership instead of embedding another
// deep scope query. Every consumer applies the same Included Games predicate.
export function analyzedEventsCTE(selection,gamePrefix,prefix='catalog') {
  selection=identifier(selection);gamePrefix=identifier(gamePrefix);prefix=identifier(prefix);
  return `${prefix}_saved AS MATERIALIZED(SELECT a.* FROM ${savedMatchAnalysis} a JOIN ${selection} scope ON scope.app_team_id=a.app_team_id AND scope.team_season_id=a.team_season_id),
    ${prefix}_events AS MATERIALIZED(SELECT e.*,a.state AS analysis_state FROM ${gamePrefix}_targets e JOIN ${prefix}_saved a ON a.app_team_id=e.app_team_id AND a.team_season_id=e.team_season_id AND a.event_id=e.event_id WHERE e.locally_available=1 AND e.status<>'CANCELLED' AND ${acceptedAnalysisPublicationSQL()})`;
}
