// Fresh installation only. The domain schema owns provider_accounts, app_teams,
// and team_read_state; source records and credentials never live in this engine.
export const SYNC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS team_lifecycle(team_id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN('deleting','deleted')),requested_at TEXT NOT NULL,deleted_at TEXT)`,
  `CREATE TABLE sync_jobs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    account_scope TEXT NOT NULL,
    account_id TEXT REFERENCES provider_accounts(id) ON DELETE CASCADE,
    authorization_generation INTEGER NOT NULL DEFAULT 0,
    component TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'source' CHECK(stage IN ('source','projection','analysis','export','maintenance')),
    scope TEXT NOT NULL,
    resource_key TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(args)),
    checkpoint TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint)),
    scan_id TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','retrying','blocked','failed','disabled')),
    coverage TEXT NOT NULL DEFAULT 'none' CHECK(coverage IN ('none','partial','complete','unpublished','restricted','unsupported')),
    priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100),
    ready_since INTEGER NOT NULL,
    next_at INTEGER NOT NULL,
    interval_ms INTEGER NOT NULL CHECK(interval_ms > 0),
    recurring INTEGER NOT NULL DEFAULT 1 CHECK(recurring IN (0,1)),
    lease_token TEXT,
    lease_until INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    pages_saved INTEGER NOT NULL DEFAULT 0,
    rows_saved INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    last_retrieved_at INTEGER,
    last_saved_at INTEGER,
    last_complete_at INTEGER,
    last_error_code TEXT,
    last_error_message TEXT,
    failure_kind TEXT CHECK(failure_kind IS NULL OR failure_kind IN ('temporary','blocked','permanent')),
    UNIQUE(provider,account_scope,component,scope,resource_key),
    CHECK((account_scope='public' AND account_id IS NULL AND authorization_generation=0) OR (account_scope=account_id AND account_id IS NOT NULL))
  )`,
  `CREATE INDEX sync_jobs_due ON sync_jobs(state,next_at,lease_until,priority)`,
  `CREATE INDEX sync_jobs_account ON sync_jobs(account_id,authorization_generation)`,
  `CREATE TABLE sync_job_subscribers (
    job_id TEXT NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('team','account')),
    demand_key TEXT NOT NULL,
    app_team_id TEXT REFERENCES app_teams(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(job_id,kind,demand_key),
    CHECK((kind='team' AND app_team_id IS NOT NULL) OR (kind='account' AND app_team_id IS NULL))
  )`,
  `CREATE INDEX sync_subscribers_team ON sync_job_subscribers(app_team_id,job_id)`,
  `CREATE INDEX sync_subscribers_demand ON sync_job_subscribers(kind,demand_key,job_id)`,
  `CREATE TABLE sync_account_read_state (
    account_id TEXT PRIMARY KEY REFERENCES provider_accounts(id) ON DELETE CASCADE,
    catalog_revision INTEGER NOT NULL DEFAULT 0,
    status_revision INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE sync_observations (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
    scan_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    status INTEGER,
    at INTEGER NOT NULL,
    retrieved_at INTEGER,
    bytes INTEGER NOT NULL,
    content_hash TEXT,
    rows_count INTEGER,
    error_code TEXT
  )`,
  `CREATE INDEX sync_observations_recent ON sync_observations(at,job_id)`,
  `CREATE TABLE sync_commit_fences (
    job_id TEXT PRIMARY KEY REFERENCES sync_jobs(id) ON DELETE CASCADE,
    commit_token TEXT NOT NULL
  )`,
];
export async function installSyncSchema(db) {
  await db.batch(SYNC_SCHEMA.map(sql => db.prepare(sql)));
}
