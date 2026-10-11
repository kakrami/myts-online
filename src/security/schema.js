// Fresh-install tables. No old authentication records are read or converted.
export const SECURITY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS security_owner (
    id INTEGER PRIMARY KEY CHECK(id=1),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_iterations INTEGER NOT NULL CHECK(password_iterations>=600000),
    password_revision INTEGER NOT NULL CHECK(password_revision>0),
    last_password_change TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS security_installation (
    id INTEGER PRIMARY KEY CHECK(id=1),
    vault_key_id TEXT NOT NULL UNIQUE,
    vault_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS security_account_credentials (
    account_id TEXT PRIMARY KEY REFERENCES provider_accounts(id) ON DELETE CASCADE,
    account_generation INTEGER NOT NULL CHECK(account_generation>0),
    ciphertext TEXT NOT NULL,
    expires_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS security_sessions (
    token_hash TEXT PRIMARY KEY,
    password_revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS security_sessions_expiry ON security_sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS security_viewer_tokens (
    token_hash TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES app_teams(id) ON DELETE CASCADE,
    categories TEXT NOT NULL CHECK(json_valid(categories)),
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    encrypted_token TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS security_viewer_team ON security_viewer_tokens(team_id,revoked_at)`,
  `CREATE TABLE IF NOT EXISTS security_connection_config (
    provider TEXT PRIMARY KEY CHECK(provider='teamsnap'),
    client_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS security_oauth_states (
    state_hash TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL REFERENCES security_sessions(token_hash) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider='teamsnap'),
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS security_oauth_expiry ON security_oauth_states(expires_at)`,
  `CREATE TABLE IF NOT EXISTS security_trace_attempts (
    attempt_hash TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL REFERENCES security_sessions(token_hash) ON DELETE CASCADE,
    pending_ciphertext TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','verifying','failed')),
    verification_count INTEGER NOT NULL DEFAULT 0,
    claim_id TEXT,
    lease_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS security_trace_expiry ON security_trace_attempts(expires_at)`,
  `CREATE TABLE IF NOT EXISTS security_rate_limits (
    bucket_hash TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
];

export async function installSecuritySchema(db) {
  await db.batch(SECURITY_SCHEMA.map((sql) => db.prepare(sql)));
}
