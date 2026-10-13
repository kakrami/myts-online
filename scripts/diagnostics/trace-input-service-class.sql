-- Read only, same three tracking jobs and same published run; no personal data.
WITH scoped AS (
 SELECT j.id AS job_id,j.scope,j.resource_key,j.account_id,
 e.id AS event_id,t.id AS team_id,e.native_id AS game_native,t.native_id AS team_native,
 e.provenance AS event_provenance,t.provenance AS team_provenance,
 e.scope AS event_scope,t.scope AS team_scope,
 e.account_id AS event_account,t.account_id AS team_account,
 COALESCE(e.starts_at,e.local_day) AS event_date,
 EXISTS(SELECT 1 FROM source_event_teams m
   WHERE m.source_event_id=e.id AND m.source_team_id=t.id) AS membership,
 EXISTS(SELECT 1 FROM sync_job_subscribers s
   JOIN team_projection_state p ON p.app_team_id=s.app_team_id
   WHERE s.job_id=j.id AND s.kind='team' AND p.published_run_id=r.run_id
   AND p.app_team_id=r.app_team_id AND p.team_season_id=r.team_season_id) AS active_publication
 FROM sync_jobs j JOIN team_game_source_rows r ON r.account_id=j.account_id
 JOIN source_events e ON e.id=r.source_event_id
 JOIN source_teams t ON t.id=r.connected_source_team_id
 WHERE r.run_id='d02d51f9-19b1-45c3-87bc-99ca2d3ccec5'
 AND r.provider='trace' AND e.provider='trace' AND t.provider='trace'
 AND j.provider='trace' AND j.stage='analysis' AND j.component='tracking'
 AND j.id IN ('d40e451b-e917-4c58-a5b8-050605a8b673',
 'da2ac6b4-fa12-4d25-a115-ab1ef69883cc','e2b2d477-ddd6-4980-a3d3-3c95efb4516f')
 AND e.native_id=CAST(json_extract(j.args,'$.game_id') AS TEXT)
 AND t.native_id=CAST(json_extract(j.args,'$.team_id') AS TEXT)
), checks AS (
 SELECT job_id,active_publication,
 COALESCE(julianday(event_date) BETWEEN julianday('now')-60 AND julianday('now')+30,0) AS recent_window,
 (event_provenance='provider' AND team_provenance='provider'
 AND event_scope=account_id AND team_scope=account_id
 AND event_account=account_id AND team_account=account_id AND membership=1
 AND resource_key=scope AND substr(scope,1,length('trace:'||game_native||':trace:'||team_native||':'))
 ='trace:'||game_native||':trace:'||team_native||':') AS native_scope_verified
 FROM scoped
)
SELECT DISTINCT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS sampled_at,job_id,
 recent_window,native_scope_verified,active_publication,
 CASE WHEN native_scope_verified AND recent_window THEN 4 ELSE 2 END AS current_service_class,
 CASE WHEN native_scope_verified AND (recent_window OR active_publication) THEN 4 ELSE 2 END AS candidate_service_class
FROM checks ORDER BY job_id LIMIT 3;
