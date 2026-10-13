-- Read only: eligibility for the same three jobs, restricted to the published run.
-- live_demand is generated from JobCoordinator.demanded for private Trace jobs.
WITH clock AS (SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now_ms),
checks AS (
 SELECT j.id AS job_id,j.state,j.priority,j.ready_since,j.next_at,j.lease_until,
 j.last_attempt_at,j.last_saved_at,j.attempts,
 j.priority+CAST((clock.now_ms-j.ready_since)/300000 AS INTEGER) AS aged_priority,
 j.next_at<=clock.now_ms AS due,j.lease_until<=clock.now_ms AS lease_expired,
 EXISTS(SELECT 1 FROM provider_accounts a WHERE a.id=j.account_id
   AND a.generation=j.authorization_generation AND a.active=1 AND a.provider=j.provider) AS account_current,
 EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=j.id AND (1) AND ((s.kind='account' AND NOT (substr(s.demand_key,1,15)='public-history:')) OR (j.stage='maintenance' AND NOT (substr(s.demand_key,1,15)='public-history:') AND EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id AND l.state='deleting')) OR (j.stage<>'maintenance' AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id) AND (CASE WHEN substr(s.demand_key,1,15)='public-history:' THEN 0 WHEN substr(s.demand_key,1,11)='connection:' THEN EXISTS(SELECT 1 FROM team_source_connections c JOIN source_teams st ON st.id=c.source_team_id LEFT JOIN provider_accounts pa ON pa.id=c.account_id LEFT JOIN account_source_teams ast ON ast.account_id=c.account_id AND ast.source_team_id=c.source_team_id WHERE c.id=substr(s.demand_key,12) AND c.app_team_id=s.app_team_id AND c.active=1 AND c.generation=s.generation AND CASE WHEN j.provider='domain' AND j.component='connection' THEN st.provenance='provider' OR c.scope_mode='fixed_seasons' ELSE st.provenance='provider' AND (c.account_id IS NULL OR (pa.active=1 AND ast.source_team_id IS NOT NULL)) END) ELSE (NOT EXISTS(SELECT 1 FROM team_source_attachments a WHERE a.id=s.demand_key) OR EXISTS(SELECT 1 FROM team_source_attachments a LEFT JOIN source_teams st ON st.id=a.source_team_id LEFT JOIN provider_accounts pa ON pa.id=a.account_id LEFT JOIN account_source_teams ast ON ast.account_id=a.account_id AND ast.source_team_id=a.source_team_id WHERE a.id=s.demand_key AND a.app_team_id=s.app_team_id AND a.active=1 AND a.generation=s.generation AND (j.provider IN('domain','analysis','reports','maintenance') OR (st.provenance='provider' AND (a.account_id IS NULL OR (pa.active=1 AND ast.source_team_id IS NOT NULL)))))) END)))) AS live_demand
 FROM sync_jobs j CROSS JOIN clock
 WHERE j.provider='trace' AND j.stage='analysis' AND j.component='tracking'
 AND j.id IN ('e2b2d477-ddd6-4980-a3d3-3c95efb4516f',
 'da2ac6b4-fa12-4d25-a115-ab1ef69883cc','d40e451b-e917-4c58-a5b8-050605a8b673')
 AND EXISTS(SELECT 1 FROM team_game_source_rows r
   JOIN source_events e ON e.id=r.source_event_id
   JOIN source_teams t ON t.id=r.connected_source_team_id
   WHERE r.run_id='d02d51f9-19b1-45c3-87bc-99ca2d3ccec5' AND r.provider='trace'
   AND r.account_id=j.account_id
   AND e.native_id=CAST(json_extract(j.args,'$.game_id') AS TEXT)
   AND t.native_id=CAST(json_extract(j.args,'$.team_id') AS TEXT))
)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS sampled_at,*,
 (state IN ('queued','running','retrying') AND due AND lease_expired AND account_current AND live_demand) AS claim_eligible
FROM checks ORDER BY job_id;
