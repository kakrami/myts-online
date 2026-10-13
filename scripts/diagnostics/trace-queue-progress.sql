-- Run twice >=2 minutes apart; read only, same published run and three targets.
WITH clock AS (
 SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS ms
), scoped AS (
 SELECT DISTINCT r.account_id,e.native_id AS game_id,t.native_id AS team_id,
 e.id AS event_id,t.id AS source_team_id,
 (e.provenance='provider' AND t.provenance='provider'
  AND e.scope=r.account_id AND t.scope=r.account_id
  AND e.account_id=r.account_id AND t.account_id=r.account_id
  AND julianday(COALESCE(e.starts_at,e.local_day))
      BETWEEN julianday('now')-60 AND julianday('now')+30
  AND EXISTS(SELECT 1 FROM source_event_teams m
      WHERE m.source_event_id=e.id AND m.source_team_id=t.id)) AS recent_native
 FROM team_game_source_rows r
 JOIN source_events e ON e.id=r.source_event_id
 JOIN source_teams t ON t.id=r.connected_source_team_id
 WHERE r.run_id='d02d51f9-19b1-45c3-87bc-99ca2d3ccec5'
 AND r.provider='trace' AND e.provider='trace' AND t.provider='trace'
), jobs AS MATERIALIZED (
 SELECT DISTINCT j.*,
 j.priority+CAST((clock.ms-j.ready_since)/300000 AS INTEGER) AS aged_priority,
 COALESCE(s.recent_native AND j.resource_key=j.scope
 AND substr(j.scope,1,length('trace:'||s.game_id||':trace:'||s.team_id||':'))
 ='trace:'||s.game_id||':trace:'||s.team_id||':',0) AS class4
 FROM scoped s JOIN sync_jobs j ON j.account_id=s.account_id
 AND CAST(json_extract(j.args,'$.game_id') AS TEXT)=s.game_id
 AND CAST(json_extract(j.args,'$.team_id') AS TEXT)=s.team_id
 CROSS JOIN clock
 WHERE j.provider='trace' AND j.stage='analysis'
 AND j.component IN('tracking','analytics','radar')
), eligible AS MATERIALIZED (
 SELECT j.* FROM jobs j CROSS JOIN clock
 WHERE j.class4=1 AND j.state IN('queued','running','ready','retrying')
 AND NOT(j.state='ready' AND j.recurring=0)
 AND j.next_at<=clock.ms AND j.lease_until<=clock.ms
 AND EXISTS(SELECT 1 FROM provider_accounts a WHERE a.id=j.account_id
   AND a.active=1 AND a.generation=j.authorization_generation AND a.provider=j.provider)
 AND EXISTS(
  SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=j.id
  AND substr(s.demand_key,1,15)<>'public-history:'
  AND (s.kind='account' OR (
   NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id)
   AND CASE WHEN substr(s.demand_key,1,11)='connection:' THEN EXISTS(
    SELECT 1 FROM team_source_connections c
    JOIN source_teams st ON st.id=c.source_team_id
    LEFT JOIN provider_accounts pa ON pa.id=c.account_id
    LEFT JOIN account_source_teams ast ON ast.account_id=c.account_id
      AND ast.source_team_id=c.source_team_id
    WHERE c.id=substr(s.demand_key,12) AND c.app_team_id=s.app_team_id
    AND c.active=1 AND c.generation=s.generation AND st.provenance='provider'
    AND (c.account_id IS NULL OR (pa.active=1 AND ast.source_team_id IS NOT NULL))
   ) ELSE (
    NOT EXISTS(SELECT 1 FROM team_source_attachments a WHERE a.id=s.demand_key)
    OR EXISTS(
     SELECT 1 FROM team_source_attachments a
     LEFT JOIN source_teams st ON st.id=a.source_team_id
     LEFT JOIN provider_accounts pa ON pa.id=a.account_id
     LEFT JOIN account_source_teams ast ON ast.account_id=a.account_id
       AND ast.source_team_id=a.source_team_id
     WHERE a.id=s.demand_key AND a.app_team_id=s.app_team_id
     AND a.active=1 AND a.generation=s.generation AND st.provenance='provider'
     AND (a.account_id IS NULL OR (pa.active=1 AND ast.source_team_id IS NOT NULL))
    )
   ) END
  ))
 )
), totals AS (
 SELECT count(*) AS scoped_jobs,sum(generation) AS generation_sum,
 sum(attempts) AS attempts_sum,sum(pages_saved) AS pages_sum,
 sum(CASE WHEN component='tracking' THEN pages_saved ELSE 0 END) AS tracking_pages,
 sum(CASE WHEN component='analytics' THEN pages_saved ELSE 0 END) AS analytics_pages,
 sum(component='tracking' AND coverage='complete') AS tracking_complete,
 sum(component='analytics' AND coverage='complete') AS analytics_complete,
 max(last_saved_at) AS latest_save
 FROM jobs
)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS sampled_at,
 (SELECT count(*) FROM scoped) AS scoped_matches,
 EXISTS(SELECT 1 FROM team_projection_state
 WHERE published_run_id='d02d51f9-19b1-45c3-87bc-99ca2d3ccec5') AS publication_active,
 t.id AS job_id,t.state,t.generation,t.scan_id,t.aged_priority,
 t.attempts,t.pages_saved,t.rows_saved,t.last_saved_at,t.next_at,
 json_extract(t.checkpoint,'$.chunk') AS chunk,
 json_extract(t.checkpoint,'$.offset') AS page_offset,
 json_extract(t.checkpoint,'$.chunk_pages."3"') AS chunk_3_pages,
 json_extract(t.checkpoint,'$.finished') AS finished,
 EXISTS(SELECT 1 FROM eligible e WHERE e.id=t.id) AS eligible,
 (SELECT count(*) FROM eligible) AS scoped_eligible_class4,
 (SELECT count(*) FROM eligible e WHERE
 e.aged_priority>t.aged_priority OR
 (e.aged_priority=t.aged_priority AND
 (e.next_at<t.next_at OR (e.next_at=t.next_at AND e.id<t.id)))) AS scoped_predecessors,
 totals.*
FROM jobs t CROSS JOIN totals
WHERE t.id IN('d40e451b-e917-4c58-a5b8-050605a8b673',
 'da2ac6b4-fa12-4d25-a115-ab1ef69883cc','e2b2d477-ddd6-4980-a3d3-3c95efb4516f')
ORDER BY t.id LIMIT 3;
