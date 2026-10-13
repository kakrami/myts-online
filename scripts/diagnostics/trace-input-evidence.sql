-- READ ONLY. Run Q1 twice at least two minutes apart; ordinary background work only.
-- Do not refresh, wake, retry, clear checkpoints, or open the app to induce work.
-- Raw args/checkpoint, URLs, headers, error messages and personal rows are excluded.
-- Q1: Same-job continuation. scan_id is an opaque collection identifier, not a token.
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS sampled_at,
 id AS job_id,component,state,coverage,generation,scan_id,
 attempts,failures,pages_saved,rows_saved,last_attempt_at,last_saved_at,
 last_complete_at,next_at,failure_kind,last_error_code,
 json_extract(checkpoint,'$.chunk') AS chunk,
 json_extract(checkpoint,'$.offset') AS page_offset,
 json_extract(checkpoint,'$.chunk_pages."0"') AS chunk_0_pages,
 json_extract(checkpoint,'$.chunk_pages."1"') AS chunk_1_pages,
 json_extract(checkpoint,'$.chunk_pages."2"') AS chunk_2_pages,
 json_extract(checkpoint,'$.chunk_pages."3"') AS chunk_3_pages,
 json_extract(checkpoint,'$.finished') AS finished
FROM sync_jobs WHERE provider='trace' AND component='tracking' AND id IN (
 'e2b2d477-ddd6-4980-a3d3-3c95efb4516f',
 'da2ac6b4-fa12-4d25-a115-ab1ef69883cc',
 'd40e451b-e917-4c58-a5b8-050605a8b673') ORDER BY id;

-- Q2: Scope check and queued/complete/blocked work. Expect 13 scoped matches; do not broaden if different.
WITH scoped AS (
 SELECT DISTINCT s.source_event_id,s.connected_source_team_id AS source_team_id,
        s.account_id,e.native_id AS game_native_id,t.native_id AS team_native_id,
        dense_rank() OVER (ORDER BY s.source_event_id,s.connected_source_team_id) AS match_no
 FROM team_game_source_rows s
 JOIN source_events e ON e.id=s.source_event_id
 JOIN source_teams t ON t.id=s.connected_source_team_id
 WHERE s.run_id='d02d51f9-19b1-45c3-87bc-99ca2d3ccec5' AND s.provider='trace'
), jobs AS (
 SELECT j.*,s.match_no FROM scoped s JOIN sync_jobs j
 ON j.provider='trace' AND j.account_id=s.account_id
 AND CAST(json_extract(j.args,'$.game_id') AS TEXT)=s.game_native_id
 AND CAST(json_extract(j.args,'$.team_id') AS TEXT)=s.team_native_id
 WHERE j.stage='analysis' AND j.component IN ('tracking','analytics','radar')
)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS sampled_at,
 (SELECT count(*) FROM scoped) AS scoped_matches,
 EXISTS(SELECT 1 FROM team_projection_state WHERE published_run_id=
 'd02d51f9-19b1-45c3-87bc-99ca2d3ccec5') AS publication_still_active,
 component,state,coverage,last_error_code,count(*) AS jobs,
 count(DISTINCT match_no) AS matches,sum(attempts>0) AS attempted_jobs,
 sum(rows_saved) AS cumulative_rows_saved,max(last_saved_at) AS latest_save
FROM jobs GROUP BY component,state,coverage,last_error_code
ORDER BY component,state,coverage,last_error_code;

-- Q3: Per-match/half radar evidence and tracking collection, without player/track rows.
WITH scoped AS (
 SELECT DISTINCT s.source_event_id,s.connected_source_team_id AS source_team_id,
        s.account_id,e.native_id AS game_native_id,t.native_id AS team_native_id,
        dense_rank() OVER (ORDER BY s.source_event_id,s.connected_source_team_id) AS match_no
 FROM team_game_source_rows s
 JOIN source_events e ON e.id=s.source_event_id
 JOIN source_teams t ON t.id=s.connected_source_team_id
 WHERE s.run_id='d02d51f9-19b1-45c3-87bc-99ca2d3ccec5' AND s.provider='trace'
), jobs AS (
 SELECT j.*,s.match_no FROM scoped s JOIN sync_jobs j
 ON j.provider='trace' AND j.account_id=s.account_id
 AND CAST(json_extract(j.args,'$.game_id') AS TEXT)=s.game_native_id
 AND CAST(json_extract(j.args,'$.team_id') AS TEXT)=s.team_native_id
 WHERE j.stage='analysis' AND j.component IN ('tracking','analytics','radar')
), halves(half) AS (VALUES(1),(2))
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS sampled_at,s.match_no,h.half,
 (SELECT count(*) FROM source_trace_components c WHERE c.source_event_id=s.source_event_id
   AND c.source_team_id=s.source_team_id AND c.account_id=s.account_id AND c.kind='clip' AND c.half=h.half) AS clip_rows,
 (SELECT count(*) FROM source_trace_components c WHERE c.source_event_id=s.source_event_id
   AND c.source_team_id=s.source_team_id AND c.account_id=s.account_id AND c.kind='radar' AND c.half=h.half) AS radar_rows,
 r.provenance AS radar_provenance,r.observed_at AS radar_saved_at,
 json_extract(r.evidence,'$.analysis.play_window.start') AS window_start,
 json_extract(r.evidence,'$.analysis.play_window.end') AS window_end,
 json_extract(r.evidence,'$.analysis.play_window.complete') AS window_complete,
 json_extract(r.evidence,'$.analysis.both_sides_verified') AS both_sides_verified,
 (SELECT count(*) FROM jobs j WHERE j.match_no=s.match_no AND j.component='tracking'
   AND json_extract(j.args,'$.half')=h.half) AS tracking_jobs,
 (SELECT count(*) FROM jobs j JOIN source_component_coverage c
   ON c.provider=j.provider AND c.account_id=j.account_id AND c.kind=j.component AND c.scope=j.scope
   WHERE j.match_no=s.match_no AND j.component='tracking' AND json_extract(j.args,'$.half')=h.half
   AND c.complete=1 AND c.scan_id=j.scan_id) AS current_scan_tracking_complete,
 (SELECT count(*) FROM jobs j JOIN source_component_coverage c
   ON c.provider=j.provider AND c.account_id=j.account_id AND c.kind=j.component AND c.scope=j.scope
   WHERE j.match_no=s.match_no AND j.component='tracking' AND json_extract(j.args,'$.half')=h.half
   AND c.complete=1) AS saved_tracking_complete,
 (SELECT count(*) FROM source_tracking_segments t WHERE t.source_event_id=s.source_event_id
   AND t.source_team_id=s.source_team_id AND t.account_id=s.account_id AND t.half=h.half) AS tracking_rows
FROM scoped s CROSS JOIN halves h LEFT JOIN source_trace_components r
 ON r.source_event_id=s.source_event_id AND r.source_team_id=s.source_team_id
 AND r.account_id=s.account_id AND r.kind='radar' AND r.half=h.half
ORDER BY s.match_no,h.half;

-- Q4: Existing radar diagnostics only. No request is sent. No raw endpoint or response is returned.
WITH scoped AS (
 SELECT DISTINCT s.source_event_id,s.connected_source_team_id AS source_team_id,
        s.account_id,e.native_id AS game_native_id,t.native_id AS team_native_id,
        dense_rank() OVER (ORDER BY s.source_event_id,s.connected_source_team_id) AS match_no
 FROM team_game_source_rows s
 JOIN source_events e ON e.id=s.source_event_id
 JOIN source_teams t ON t.id=s.connected_source_team_id
 WHERE s.run_id='d02d51f9-19b1-45c3-87bc-99ca2d3ccec5' AND s.provider='trace'
), jobs AS (
 SELECT j.*,s.match_no FROM scoped s JOIN sync_jobs j
 ON j.provider='trace' AND j.account_id=s.account_id
 AND CAST(json_extract(j.args,'$.game_id') AS TEXT)=s.game_native_id
 AND CAST(json_extract(j.args,'$.team_id') AS TEXT)=s.team_native_id
 WHERE j.stage='analysis' AND j.component IN ('tracking','analytics','radar')
), observations AS (
 SELECT o.*,row_number() OVER(PARTITION BY o.job_id ORDER BY o.at DESC,o.id DESC) AS rn
 FROM sync_observations o JOIN jobs j ON j.id=o.job_id WHERE j.component='radar'
)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS sampled_at,j.match_no,j.id AS job_id,
 json_extract(j.args,'$.half') AS half,j.state,j.coverage,j.attempts,j.failures,
 j.last_error_code,j.failure_kind,j.last_attempt_at,j.last_saved_at,j.next_at,
 CASE WHEN json_extract(j.args,'$.url') LIKE 'https://go.traceup.com/%' THEN 'go.traceup.com'
      WHEN json_extract(j.args,'$.url') LIKE 'https://traceup.com/%' THEN 'traceup.com'
      ELSE 'other_or_missing' END AS asset_host_class,
 CASE WHEN instr(COALESCE(json_extract(j.args,'$.url'),''),'?')>0 THEN 1 ELSE 0 END AS asset_has_query,
 o.at AS observation_at,o.attempt AS observation_attempt,o.scan_id=j.scan_id AS same_scan,
 o.status AS http_status,o.error_code AS observation_error,o.bytes AS received_bytes,
 o.retrieved_at,o.rows_count,
 CASE WHEN o.endpoint IS NULL THEN 'none'
      WHEN o.endpoint LIKE '%/users/self/token' THEN 'token_endpoint'
      WHEN o.endpoint LIKE '%/graphql' THEN 'graphql_endpoint'
      ELSE 'asset_or_other_endpoint' END AS endpoint_class
FROM jobs j LEFT JOIN observations o ON o.job_id=j.id AND o.rn<=4
WHERE j.component='radar' ORDER BY j.match_no,half,o.at DESC;
