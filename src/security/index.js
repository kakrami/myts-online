import { base64url, constantEqual, decodeBase64url, decrypt, digest, encrypt, passwordVerifier, randomToken } from './crypto.js';
export { SECURITY_SCHEMA, installSecuritySchema } from './schema.js';

export const OWNER_COOKIE = 'myts_session';
export const PASSWORD_ITERATIONS = 600000;
export const VIEWER_CATEGORIES = Object.freeze(['overview', 'schedule', 'competitions', 'team', 'players', 'matches', 'bookmarks', 'reports']);
// Internal route contract, never a category that can be granted to a token.
export const SHARED_METADATA_PROJECTION = 'shared_metadata';
const SESSION_MS = 7 * 86400000;
const OAUTH_MS = 10 * 60000;
const TRACE_MS = 20 * 60000;
const TRACE_CLAIM_MS = 120000;
const ACTIVE_SESSION = `SELECT 1 FROM security_sessions s JOIN security_owner o ON o.id=1
  WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
    AND s.password_revision=o.password_revision`;

export class SecurityError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.status = status;
  }
}
const reject = (code, message, status) => { throw new SecurityError(code, message, status); };
const opaque = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 300)
    reject('password_invalid', 'Use a password between 16 and 300 characters.');
  return value; // Passwords are never trimmed or Unicode-normalized.
}
function requiredText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    reject('input_invalid', label + ' is required.');
  return value.trim();
}
function callbackOrigin(value) {
  let url;
  try { url = new URL(value); } catch { reject('oauth_origin_invalid', 'The callback origin is invalid.'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))))
    reject('oauth_origin_invalid', 'The callback origin is invalid.');
  return url.origin;
}

export function assertSameOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site')
    reject('origin_required', 'Same-origin request required.', 403);
}

export function ownerCookie(token, maxAge = SESSION_MS / 1000) {
  if (token !== '' && !opaque(token)) reject('session_invalid', 'Invalid session token.', 401);
  return `${OWNER_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function requestSession(request) {
  const values = (request.headers.get('cookie') || '').split(';').map((v) => v.trim())
    .filter((v) => v.startsWith(OWNER_COOKIE + '='));
  return values.length === 1 ? values[0].slice(OWNER_COOKIE.length + 1) : '';
}

/** A single-installation store. db implements the native D1 prepare/bind/batch API. */
export class SecurityStore {
  #bootstrapPassword;
  constructor(db, { now = Date.now, bootstrapPassword } = {}) {
    this.db = db;
    this.now = now;
    this.#bootstrapPassword = bootstrapPassword;
  }

  async ownerConfigured() {
    return !!(await this.db.prepare('SELECT id FROM security_owner WHERE id=1').first());
  }

  async consumeRate(namespace, clientKey, maximum = 10, windowMs = 600000) {
    const now = this.now(), slot = Math.floor(now / windowMs);
    const hash = await digest(namespace + ':' + String(clientKey || 'unknown') + ':' + slot);
    const row = await this.db.prepare(`INSERT INTO security_rate_limits VALUES(?,1,?)
      ON CONFLICT(bucket_hash) DO UPDATE SET count=count+1 RETURNING count`)
      .bind(hash, (slot + 1) * windowMs).first();
    if (row.count > maximum) reject('rate_limited', 'Too many attempts. Try again later.', 429);
  }

  async initializeOwner(password, { clientKey = 'unknown' } = {}) {
    passwordInput(password);
    let phase = 'rate-limit';
    try {
      await this.consumeRate('owner-initialize', clientKey);
      phase = 'owner-read';
      const existing = await this.db.prepare('SELECT * FROM security_owner WHERE id=1').first();
      // A committed initialization can be retried after a lost response. The
      // stored verifier, including any subsequent rotation, is authoritative.
      if (existing) {
        phase = 'resume-password';
        if (!(await this.#verifyPassword(password, existing))) reject('password_incorrect', 'Incorrect password.', 401);
        phase = 'resume-session';
        return await this.#issueSession(existing.password_revision);
      }
      if (typeof this.#bootstrapPassword !== 'string' || this.#bootstrapPassword.length < 16)
        reject('bootstrap_unconfigured', 'The initial owner password must be configured for this installation.', 503);
      phase = 'bootstrap-password';
      const [inputHash, expectedHash] = await Promise.all([digest(password), digest(this.#bootstrapPassword)]);
      if (!constantEqual(new TextEncoder().encode(inputHash), new TextEncoder().encode(expectedHash)))
        reject('password_incorrect', 'Incorrect password.', 401);
      const now = this.now(), salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
      phase = 'password-derivation';
      const hash = base64url(await passwordVerifier(password, salt, PASSWORD_ITERATIONS));
      phase = 'session-derivation';
      const token = randomToken(), tokenHash = await digest(token), initializationId = crypto.randomUUID();
      // D1 rolls back the whole batch if any statement fails. All cryptographic
      // material is ready before vault, owner and first session commit together.
      phase = 'owner-batch';
      const results = await this.db.batch([
        this.db.prepare(`INSERT INTO security_installation VALUES(1,?,?,?) ON CONFLICT(id) DO NOTHING`)
          .bind(crypto.randomUUID(), randomToken(), now),
        this.db.prepare(`INSERT INTO security_owner VALUES(1,?,?,?,1,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id`)
          .bind(salt, hash, PASSWORD_ITERATIONS, initializationId, now, now),
        this.db.prepare(`INSERT INTO security_sessions
          SELECT ?,password_revision,?,?,NULL FROM security_owner
          WHERE id=1 AND password_revision=1 AND last_password_change=? RETURNING expires_at`)
          .bind(tokenHash, now, now + SESSION_MS, initializationId),
      ]);
      if (results[1].results.length) {
        if (!results[2].results.length) throw new Error('Initial session was not committed.');
        return { token, expires_at: results[2].results[0].expires_at };
      }
      // Another initializer won the transaction. Its nonce blocked our session;
      // verify its actual password before issuing any authenticated response.
      phase = 'concurrent-password';
      const winner = await this.db.prepare('SELECT * FROM security_owner WHERE id=1').first();
      if (!(await this.#verifyPassword(password, winner))) reject('password_incorrect', 'Incorrect password.', 401);
      phase = 'concurrent-session';
      return await this.#issueSession(winner.password_revision);
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      // Log only a bounded stage and known error class. Passwords, SQL values,
      // salts, hashes, vault keys and raw exception messages are never logged.
      const errorClass = ['Error', 'TypeError', 'RangeError', 'NotSupportedError', 'OperationError'].includes(error?.name) ? error.name : 'Error';
      console.error(JSON.stringify({ event: 'owner_initialization_failed', phase, error_class: errorClass }));
      reject('owner_initialization_failed', 'Owner access could not be initialized. Sign in again to resume.', 503);
    }
  }

  async #verifyPassword(password, row) {
    if (typeof password !== 'string' || password.length > 300 || !row) return false;
    const actual = await passwordVerifier(password, row.password_salt, row.password_iterations);
    return constantEqual(actual, decodeBase64url(row.password_hash));
  }

  async login(password, { clientKey = 'unknown' } = {}) {
    await this.consumeRate('owner-login', clientKey);
    const row = await this.db.prepare('SELECT * FROM security_owner WHERE id=1').first();
    if (!row) reject('owner_uninitialized', 'Initialize owner access first.', 409);
    if (!(await this.#verifyPassword(password, row))) reject('password_incorrect', 'Incorrect password.', 401);
    return this.#issueSession(row.password_revision);
  }

  async #issueSession(passwordRevision) {
    const token = randomToken(), hash = await digest(token), now = this.now();
    const row = await this.db.prepare(`INSERT INTO security_sessions
      SELECT ?,password_revision,?,?,NULL FROM security_owner WHERE id=1 AND password_revision=? RETURNING expires_at`)
      .bind(hash, now, now + SESSION_MS, passwordRevision).first();
    if (!row) reject('password_changed', 'The password changed. Sign in again.', 409);
    return { token, expires_at: row.expires_at };
  }

  async requireOwnerSession(token) {
    if (!opaque(token)) reject('sign_in_required', 'Sign in to continue.', 401);
    const hash = await digest(token), now = this.now();
    const row = await this.db.prepare(`SELECT s.expires_at FROM security_sessions s JOIN security_owner o ON o.id=1
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.password_revision=o.password_revision`)
      .bind(hash, now).first();
    if (!row) reject('sign_in_required', 'Sign in to continue.', 401);
    return { role: 'owner', session_id: hash, expires_at: row.expires_at };
  }

  async revokeSession(token) {
    if (!opaque(token)) return;
    await this.db.prepare('UPDATE security_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL')
      .bind(this.now(), await digest(token)).run();
  }

  /** Routes are owner-only unless they explicitly declare a safe team projection. */
  async authenticateRequest(request, { projection } = {}) {
    const unsafe = !['GET', 'HEAD'].includes(request.method);
    if (unsafe) assertSameOrigin(request);
    if (request.headers.has('x-view-key')) {
      if (unsafe || !projection) reject('sign_in_required', 'This shared view is read-only.', 401);
      return this.authorizeViewer(request.headers.get('x-view-key'), projection.teamId, projection.category);
    }
    const token = requestSession(request);
    if (token) {
      try { return await this.requireOwnerSession(token); }
      catch (error) { if (!(error instanceof SecurityError && error.code === 'sign_in_required')) throw error; }
    }
    if (unsafe || !projection) reject('sign_in_required', 'Sign in to continue.', 401);
    const viewer = request.headers.get('x-view-key');
    return this.authorizeViewer(viewer, projection.teamId, projection.category);
  }

  async rotateOwnerPassword(token, currentPassword, newPassword) {
    const owner = await this.requireOwnerSession(token);
    passwordInput(newPassword);
    await this.consumeRate('owner-password-change', owner.session_id);
    const row = await this.db.prepare('SELECT * FROM security_owner WHERE id=1').first();
    if (!(await this.#verifyPassword(currentPassword, row))) reject('password_incorrect', 'Incorrect password.', 401);
    const now = this.now(), salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const hash = base64url(await passwordVerifier(newPassword, salt, PASSWORD_ITERATIONS));
    const changeId = crypto.randomUUID();
    const results = await this.db.batch([
      this.db.prepare(`UPDATE security_owner SET password_salt=?,password_hash=?,password_iterations=?,
        password_revision=password_revision+1,last_password_change=?,updated_at=? WHERE id=1 AND password_revision=?
        AND EXISTS(${ACTIVE_SESSION}) RETURNING password_revision`)
        .bind(salt, hash, PASSWORD_ITERATIONS, changeId, now, row.password_revision, owner.session_id, now),
      this.db.prepare(`UPDATE security_sessions SET revoked_at=? WHERE revoked_at IS NULL AND
        EXISTS(SELECT 1 FROM security_owner WHERE id=1 AND last_password_change=?)`).bind(now, changeId),
      this.db.prepare(`DELETE FROM security_oauth_states WHERE EXISTS(SELECT 1 FROM security_owner WHERE id=1 AND last_password_change=?)`).bind(changeId),
      this.db.prepare(`DELETE FROM security_trace_attempts WHERE EXISTS(SELECT 1 FROM security_owner WHERE id=1 AND last_password_change=?)`).bind(changeId),
    ]);
    if (!results[0].results.length) reject('password_changed', 'The password changed. Sign in again.', 409);
    return this.#issueSession(results[0].results[0].password_revision);
  }

  async #vault() {
    const row = await this.db.prepare('SELECT vault_key_id,vault_key FROM security_installation WHERE id=1').first();
    if (!row) reject('owner_uninitialized', 'Initialize owner access first.', 409);
    return { id: row.vault_key_id, bytes: decodeBase64url(row.vault_key) };
  }

  async encryptCredential(accountId, plaintext) {
    const binding = requiredText(accountId, 'Credential account', 240);
    if (typeof plaintext !== 'string' || !plaintext || new TextEncoder().encode(plaintext).length > 32768)
      reject('credential_invalid', 'Provider authorization is invalid.');
    const key = await this.#vault();
    return encrypt(key.bytes, key.id, binding, plaintext);
  }

  async decryptCredential(accountId, envelope) {
    const binding = requiredText(accountId, 'Credential account', 240);
    if (typeof envelope !== 'string' || envelope.length > 50000)
      reject('credential_unreadable', 'Stored provider authorization cannot be read. Reconnect the provider.', 401);
    const key = await this.#vault();
    try { return await decrypt(key.bytes, key.id, binding, envelope); }
    catch { reject('credential_unreadable', 'Stored provider authorization cannot be read. Reconnect the provider.', 401); }
  }

  /** Installation-internal only; never include this key in a route response or diagnostics. */
  async getCursorSigningKey() {
    const vault = await this.#vault(), encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', vault.bytes, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({
      name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(vault.id), info: encoder.encode('myts-cursor-signing-v1'),
    }, key, 256));
  }

  /** Trusted account writer calls this after provider identity verification. */
  async storeAccountCredential(accountId, plaintext, { generation, expiresAt = null } = {}) {
    if (!Number.isSafeInteger(generation) || generation < 1 ||
        (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now())))
      reject('credential_invalid', 'Provider authorization generation or expiry is invalid.');
    const ciphertext = await this.encryptCredential(accountId, plaintext), now = this.now();
    const row = await this.db.prepare(`INSERT INTO security_account_credentials
      SELECT id,generation,?,?,? FROM provider_accounts WHERE id=? AND generation=? AND active=1
      ON CONFLICT(account_id) DO UPDATE SET account_generation=excluded.account_generation,
        ciphertext=excluded.ciphertext,expires_at=excluded.expires_at,updated_at=excluded.updated_at RETURNING account_id`)
      .bind(ciphertext, expiresAt, now, accountId, generation).first();
    if (!row) reject('account_changed', 'Provider authorization changed. Reconnect the provider.', 409);
    return { account_id: accountId, generation, expires_at: expiresAt };
  }

  /** Trusted collector receives a credential only for the captured active generation. */
  async loadAccountCredential(accountId, { generation } = {}) {
    if (!Number.isSafeInteger(generation) || generation < 1)
      reject('credential_invalid', 'Provider authorization generation is invalid.');
    const row = await this.db.prepare(`SELECT c.ciphertext,c.expires_at FROM security_account_credentials c
      JOIN provider_accounts a ON a.id=c.account_id WHERE a.id=? AND a.active=1 AND a.generation=?
        AND c.account_generation=a.generation`).bind(accountId, generation).first();
    if (!row) reject('account_changed', 'Provider authorization changed. Reconnect the provider.', 409);
    if (row.expires_at !== null && row.expires_at <= this.now())
      reject('provider_authorization_expired', 'Provider authorization expired. Reconnect the provider.', 401);
    return { credential: await this.decryptCredential(accountId, row.ciphertext), expires_at: row.expires_at };
  }

  async createViewerToken(ownerToken, teamId, { categories = VIEWER_CATEGORIES, expiresAt = null } = {}) {
    const owner = await this.requireOwnerSession(ownerToken), team = requiredText(teamId, 'Team', 200);
    if (!(await this.db.prepare('SELECT id FROM app_teams WHERE id=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=app_teams.id)').bind(team).first()))
      reject('team_not_found', 'This team is unavailable.', 404);
    if (!Array.isArray(categories) || !categories.length || categories.some((v) => !VIEWER_CATEGORIES.includes(v)))
      reject('share_scope_invalid', 'Choose supported team views for this link.');
    if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now()))
      reject('share_expiry_invalid', 'The share link expiry must be in the future.');
    const token = randomToken(), hash = await digest(token), now = this.now(), encryptedToken = await this.encryptCredential('viewer/'+team+'/'+hash,token);
    const results = await this.db.batch([
      this.db.prepare(`UPDATE security_viewer_tokens SET revoked_at=? WHERE team_id=? AND revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=security_viewer_tokens.team_id) AND EXISTS(${ACTIVE_SESSION})`)
        .bind(now, team, owner.session_id, now),
      this.db.prepare(`INSERT INTO security_viewer_tokens SELECT ?,?,?,?, ?,NULL,? WHERE EXISTS(${ACTIVE_SESSION})
        AND EXISTS(SELECT 1 FROM app_teams WHERE id=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=app_teams.id)) RETURNING token_hash`)
        .bind(hash, team, JSON.stringify([...new Set(categories)]), now, expiresAt, encryptedToken,owner.session_id, now, team),
    ]);
    if (!results[1].results.length) {
      await this.requireOwnerSession(ownerToken);
      reject('team_not_found', 'This team is unavailable.', 404);
    }
    return { token, team_id: team, categories: [...new Set(categories)], expires_at: expiresAt };
  }

  async retrieveOwnerViewerLink(ownerToken,teamId) {
    const owner=await this.requireOwnerSession(ownerToken),team=requiredText(teamId,'Team',200),now=this.now();
    const row=await this.db.prepare(`SELECT token_hash,team_id,categories,expires_at,encrypted_token FROM security_viewer_tokens WHERE team_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=security_viewer_tokens.team_id) AND EXISTS(${ACTIVE_SESSION}) ORDER BY created_at DESC,token_hash LIMIT 1`).bind(team,now,owner.session_id,now).first();
    if(!row)return {team_id:team,token:null,categories:[],expires_at:null};
    const token=await this.decryptCredential('viewer/'+team+'/'+row.token_hash,row.encrypted_token);
    if(await digest(token)!==row.token_hash)reject('share_invalid','The saved viewer link is unavailable.',409);
    await this.requireOwnerSession(ownerToken);
    return {team_id:team,token,categories:JSON.parse(row.categories),expires_at:row.expires_at};
  }

  async revokeViewerTokens(ownerToken, teamId) {
    const owner = await this.requireOwnerSession(ownerToken), now = this.now();
    await this.db.prepare(`UPDATE security_viewer_tokens SET revoked_at=? WHERE team_id=? AND revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=security_viewer_tokens.team_id) AND EXISTS(${ACTIVE_SESSION})`)
      .bind(now, requiredText(teamId, 'Team', 200), owner.session_id, now).run();
  }

  async viewerPrincipal(token) {
    if (!opaque(token)) reject('share_invalid', 'This shared link is unavailable.', 401);
    const row = await this.db.prepare(`SELECT team_id,categories,expires_at FROM security_viewer_tokens
      WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=security_viewer_tokens.team_id)`)
      .bind(await digest(token), this.now()).first();
    if (!row) reject('share_invalid', 'This shared link is unavailable.', 401);
    return { role: 'viewer', team_id: row.team_id, categories: JSON.parse(row.categories), expires_at: row.expires_at };
  }

  async authorizeViewer(token, teamId, category) {
    const principal = await this.viewerPrincipal(token);
    authorizeProjection(principal, teamId, category);
    return principal;
  }

  async beginTeamSnapOAuth(ownerToken, { origin, clientId } = {}) {
    const owner = await this.requireOwnerSession(ownerToken), site = callbackOrigin(origin), now = this.now();
    await this.consumeRate('teamsnap-oauth', owner.session_id, 12);
    const stored = clientId === undefined ? await this.db.prepare(`SELECT client_id FROM security_connection_config WHERE provider='teamsnap'`).first() : null;
    const client = requiredText(clientId ?? stored?.client_id, 'TeamSnap Client ID', 200);
    const state = randomToken(), hash = await digest(state), redirect = site + '/admin';
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO security_connection_config SELECT 'teamsnap',?,? WHERE EXISTS(${ACTIVE_SESSION})
        ON CONFLICT(provider) DO UPDATE SET client_id=excluded.client_id,updated_at=excluded.updated_at`)
        .bind(client, now, owner.session_id, now),
      this.db.prepare(`INSERT INTO security_oauth_states SELECT ?,?,'teamsnap',?,?,?,? WHERE EXISTS(${ACTIVE_SESSION}) RETURNING state_hash`)
        .bind(hash, owner.session_id, client, redirect, now, now + OAUTH_MS, owner.session_id, now),
    ]);
    if (!results[1].results.length) reject('sign_in_required', 'Sign in to continue.', 401);
    const url = new URL('https://auth.teamsnap.com/oauth/authorize');
    for (const [key, value] of Object.entries({ client_id: client, redirect_uri: redirect, response_type: 'token', scope: 'read', state }))
      url.searchParams.set(key, value);
    return { authorization_url: url.href, state, expires_at: now + OAUTH_MS, redirect_uri: redirect };
  }

  async teamSnapConfiguration(ownerToken, { origin } = {}) {
    await this.requireOwnerSession(ownerToken);
    const row = await this.db.prepare(`SELECT client_id FROM security_connection_config WHERE provider='teamsnap'`).first();
    // A saved Client ID is operator input, not proof of a registered provider app.
    return { client_id: row?.client_id ?? null, requires_client_id: !row, client_id_status: row ? 'saved' : 'missing',
      ...(origin === undefined ? {} : { redirect_uri: callbackOrigin(origin) + '/admin' }) };
  }

  async completeTeamSnapOAuth(ownerToken, returned, { origin } = {}) {
    const owner = await this.requireOwnerSession(ownerToken), site = callbackOrigin(origin), now = this.now();
    if (!returned || !opaque(returned.state)) reject('oauth_state_invalid', 'TeamSnap sign-in could not be verified.', 403);
    const row = await this.db.prepare(`DELETE FROM security_oauth_states WHERE state_hash=? AND session_hash=? AND
      provider='teamsnap' AND redirect_uri=? AND expires_at>? AND EXISTS(${ACTIVE_SESSION}) RETURNING client_id`)
      .bind(await digest(returned.state), owner.session_id, site + '/admin', now, owner.session_id, now).first();
    if (!row) reject('oauth_state_invalid', 'TeamSnap sign-in could not be verified. Start a new connection.', 403);
    if (returned.error) {
      if (['invalid_client', 'unauthorized_client', 'redirect_uri_mismatch', 'invalid_redirect_uri'].includes(returned.error))
        reject('oauth_client_invalid', 'Check the saved TeamSnap Client ID and register this site’s /admin callback with TeamSnap, then try again.');
      const error = new SecurityError('oauth_provider_error', 'TeamSnap did not authorize the connection. Start a new connection.', 400);
      error.provider_error = typeof returned.error === 'string' && /^[a-z_]{1,60}$/.test(returned.error) ? returned.error : 'unknown_error';
      throw error;
    }
    if (typeof returned.access_token !== 'string' || !returned.access_token || returned.access_token.length > 16384)
      reject('oauth_token_missing', 'TeamSnap did not return an access token.');
    // URLSearchParams.get() represents missing optional fields as null. Only
    // null/undefined mean absent; provided values must retain strict validation.
    if (returned.token_type != null && (typeof returned.token_type !== 'string' || !/^bearer$/i.test(returned.token_type)))
      reject('oauth_token_invalid', 'TeamSnap returned an unsupported token type.');
    if (returned.expires_in != null && typeof returned.expires_in !== 'number' &&
        !(typeof returned.expires_in === 'string' && /^\d{1,8}$/.test(returned.expires_in)))
      reject('oauth_token_invalid', 'TeamSnap returned an invalid token expiry.');
    const seconds = returned.expires_in == null ? null : Number(returned.expires_in);
    if (seconds !== null && (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 365 * 86400))
      reject('oauth_token_invalid', 'TeamSnap returned an invalid token expiry.');
    if (returned.scope != null && returned.scope !== 'read')
      reject('oauth_scope_invalid', 'TeamSnap returned an unsupported authorization scope.');
    // Provider /me verification is required before the account writer stores this token.
    return { access_token: returned.access_token, client_id: row.client_id, expires_at: seconds === null ? null : now + seconds * 1000 };
  }

  async beginTraceAttempt(ownerToken, { email, userId, guestCookie } = {}) {
    const owner = await this.requireOwnerSession(ownerToken), now = this.now();
    await this.consumeRate('trace-start', owner.session_id, 5, TRACE_MS);
    const address = requiredText(email, 'Trace email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) reject('trace_email_invalid', 'Enter the email used for Trace.');
    const pending = { email: address, user_id: requiredText(String(userId ?? ''), 'Trace account', 100), guest_cookie: requiredText(guestCookie, 'Trace guest session', 12000) };
    const handle = randomToken(), hash = await digest(handle);
    const ciphertext = await this.encryptCredential('trace-attempt:' + hash, JSON.stringify(pending));
    const row = await this.db.prepare(`INSERT INTO security_trace_attempts
      SELECT ?,?,?,'pending',0,NULL,0,?,? WHERE EXISTS(${ACTIVE_SESSION}) RETURNING expires_at`)
      .bind(hash, owner.session_id, ciphertext, now, now + TRACE_MS, owner.session_id, now).first();
    if (!row) reject('sign_in_required', 'Sign in to continue.', 401);
    return { attempt: handle, expires_at: row.expires_at };
  }

  async claimTraceAttempt(ownerToken, handle) {
    const owner = await this.requireOwnerSession(ownerToken), now = this.now();
    if (!opaque(handle)) reject('trace_attempt_invalid', 'Send a new Trace code.', 410);
    const hash = await digest(handle), claim = crypto.randomUUID();
    const row = await this.db.prepare(`UPDATE security_trace_attempts SET state='verifying',verification_count=verification_count+1,
      claim_id=?,lease_until=? WHERE attempt_hash=? AND session_hash=? AND expires_at>? AND verification_count<8 AND
      (state='pending' OR (state='verifying' AND lease_until<=?)) AND EXISTS(${ACTIVE_SESSION}) RETURNING pending_ciphertext`)
      .bind(claim, now + TRACE_CLAIM_MS, hash, owner.session_id, now, now, owner.session_id, now).first();
    if (!row) reject('trace_attempt_invalid', 'This Trace sign-in attempt expired, is in use, or is unavailable. Send a new code.', 410);
    const pending = JSON.parse(await this.decryptCredential('trace-attempt:' + hash, row.pending_ciphertext));
    return { claim_id: claim, ...pending };
  }

  async traceAttemptStatus(ownerToken, handle) {
    const owner = await this.requireOwnerSession(ownerToken), now = this.now();
    if (!opaque(handle)) reject('trace_attempt_invalid', 'This Trace sign-in attempt is unavailable. Send a new code.', 410);
    const row = await this.db.prepare(`SELECT state,verification_count,lease_until,expires_at FROM security_trace_attempts
      WHERE attempt_hash=? AND session_hash=? AND expires_at>? AND EXISTS(${ACTIVE_SESSION})`)
      .bind(await digest(handle), owner.session_id, now, owner.session_id, now).first();
    if (!row) reject('trace_attempt_invalid', 'This Trace sign-in attempt is unavailable. Send a new code.', 410);
    const verifying = row.state === 'verifying' && row.lease_until > now;
    const stage = verifying ? 'verifying' : row.state === 'failed' || row.verification_count >= 8 ? 'failed' : 'pending';
    return { attempt: handle, stage, expires_at: row.expires_at, retry_at: verifying ? Math.min(row.lease_until, row.expires_at) : null };
  }

  /** The account writer checks and consumes this claim inside its credential transaction. */
  async prepareTraceAttemptCommit(ownerToken, handle, claimId) {
    const owner = await this.requireOwnerSession(ownerToken), now = this.now();
    if (!opaque(handle) || typeof claimId !== 'string') reject('trace_attempt_invalid', 'This Trace sign-in attempt is unavailable.', 410);
    const hash = await digest(handle);
    const sql = `EXISTS(SELECT 1 FROM security_trace_attempts WHERE attempt_hash=? AND session_hash=? AND claim_id=?
      AND state='verifying' AND lease_until>? AND expires_at>? AND EXISTS(${ACTIVE_SESSION}))`;
    const params = [hash, owner.session_id, claimId, now, now, owner.session_id, now];
    if (!(await this.db.prepare(`SELECT 1 AS allowed WHERE ${sql}`).bind(...params).first()))
      reject('trace_attempt_invalid', 'This Trace sign-in attempt is unavailable. Send a new code.', 410);
    return { sql, params, consume: (guard, token) => this.db.prepare(`DELETE FROM security_trace_attempts
      WHERE attempt_hash=? AND session_hash=? AND claim_id=? AND ${guard}`).bind(hash, owner.session_id, claimId, token) };
  }

  async finishTraceAttempt(ownerToken, handle, claimId, { success, retryable = true } = {}) {
    const owner = await this.requireOwnerSession(ownerToken), now = this.now();
    if (!opaque(handle) || typeof claimId !== 'string') reject('trace_attempt_invalid', 'This Trace sign-in attempt is unavailable.', 410);
    const hash = await digest(handle);
    const sql = success
      ? `DELETE FROM security_trace_attempts WHERE attempt_hash=? AND session_hash=? AND claim_id=? AND state='verifying'
          AND lease_until>? AND expires_at>? AND EXISTS(${ACTIVE_SESSION}) RETURNING attempt_hash`
      : `UPDATE security_trace_attempts SET state=CASE WHEN verification_count>=8 OR ?=0 THEN 'failed' ELSE 'pending' END,
          claim_id=NULL,lease_until=0 WHERE attempt_hash=? AND session_hash=? AND claim_id=? AND state='verifying'
          AND lease_until>? AND expires_at>? AND EXISTS(${ACTIVE_SESSION}) RETURNING attempt_hash`;
    const args = [hash, owner.session_id, claimId, now, now, owner.session_id, now];
    if (!success) args.unshift(retryable ? 1 : 0);
    if (!(await this.db.prepare(sql).bind(...args).first()))
      reject('trace_attempt_invalid', 'This Trace sign-in attempt is unavailable. Send a new code.', 410);
    return { complete: !!success };
  }

  async cancelTraceAttempt(ownerToken, handle) {
    const owner = await this.requireOwnerSession(ownerToken), now = this.now();
    if (!opaque(handle)) reject('trace_attempt_invalid', 'This Trace sign-in attempt is unavailable.', 410);
    await this.db.prepare(`DELETE FROM security_trace_attempts WHERE attempt_hash=? AND session_hash=? AND EXISTS(${ACTIVE_SESSION})`)
      .bind(await digest(handle), owner.session_id, owner.session_id, now).run();
  }

  async pruneExpired() {
    const now = this.now();
    await this.db.batch([
      this.db.prepare('DELETE FROM security_oauth_states WHERE expires_at<=?').bind(now),
      this.db.prepare('DELETE FROM security_trace_attempts WHERE expires_at<=?').bind(now),
      this.db.prepare('DELETE FROM security_rate_limits WHERE expires_at<=?').bind(now),
      this.db.prepare('DELETE FROM security_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL').bind(now),
    ]);
  }
}

/** Only safe, authorized team projections may be handed to a viewer. */
export function authorizeProjection(principal, teamId, category) {
  if (principal?.role === 'owner') return;
  const categories=Array.isArray(principal?.categories)?principal.categories:[];
  const included=category===SHARED_METADATA_PROJECTION
    ? categories.some(value=>VIEWER_CATEGORIES.includes(value))
    : VIEWER_CATEGORIES.includes(category)&&categories.includes(category);
  if (principal?.role !== 'viewer' || principal.team_id !== teamId || !included)
    reject('scope_forbidden', 'This link does not include that view.', 403);
}

export function requireOwner(principal) {
  if (principal?.role !== 'owner') reject('owner_required', 'Owner access required.', 403);
}
