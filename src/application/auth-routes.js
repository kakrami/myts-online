import { SecurityError, assertSameOrigin, ownerCookie, requestSession } from '../security/index.js';
import { SourceTransport } from '../sources/http.js';
import { collection, ts } from '../sources/teamsnap.js';
import { APP, TEAMS, cookieFrom, tokenFor, traceRequest, traceTeams } from '../sources/trace.js';
import { native } from '../sources/common.js';

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
} });
const error = (code, message, status = 400) => { throw new SecurityError(code, message, status); };
function field(value, label, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) error('input_invalid', label + ' is required.');
  return value.trim();
}

/** Bound bytes while reading, including chunked bodies without Content-Length. */
export async function readAuthBody(request, maximum = 4096) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    error('json_required', 'Send a JSON request.', 415);
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximum)
    error('request_too_large', 'The request exceeds its size limit.', 413);
  const reader = request.body?.getReader();
  if (!reader) error('json_invalid', 'The request body is missing.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, raw = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > maximum) { await reader.cancel(); error('request_too_large', 'The request exceeds its size limit.', 413); }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
  } catch (failure) {
    if (failure instanceof SecurityError) throw failure;
    error('json_invalid', 'The request body is invalid.');
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(raw); } catch { error('json_invalid', 'The request body is invalid.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) error('json_invalid', 'Send a JSON object.');
  return body;
}

const SESSION_CONDITION = `EXISTS(SELECT 1 FROM security_sessions s JOIN security_owner o ON o.id=1
  WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.password_revision=o.password_revision)`;
function sessionCondition(owner, security) { return { sql: SESSION_CONDITION, params: [owner.session_id, security.now()] }; }

function accountPublic(row, now) {
  return {
    id: row.id, provider: row.provider, native_id: row.native_id, name: row.name, generation: row.generation,
    active: !!row.active,
    authorization_state: !row.active ? 'disconnected' : row.credential_generation !== row.generation ? 'reconnect_required'
      : row.credential_expires_at !== null && row.credential_expires_at <= now ? 'expired' : 'connected',
    expires_at: row.credential_expires_at ?? null,
  };
}
const ACCOUNT_SELECT = `SELECT a.id,a.provider,a.native_id,a.name,a.generation,a.active,
  c.account_generation AS credential_generation,c.expires_at AS credential_expires_at
  FROM provider_accounts a LEFT JOIN security_account_credentials c ON c.account_id=a.id`;

/**
 * Matched-route handler. Schema setup and the final error/CSP response belong to the entry point.
 * enqueueDiscovery(account) must durably enqueue source-only catalog work and return after commit.
 */
export async function applicationAuthRoutes(request, services) {
  const { security, domain, enqueueDiscovery } = services;
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if(path.startsWith('/api/owner/')&&request.headers.has('x-view-key'))error('sign_in_required','This shared view is read-only.',401);
  const clientKey = request.headers.get('cf-connecting-ip') || 'local';
  const makeTransport = services.transportFactory || (() => new SourceTransport({}, { maxCalls: 8, deadlineMs: 90000, timeoutMs: 15000 }));
  const sessionResponse = (session) => json({ ok: true, role: 'owner', expires_at: session.expires_at }, 200, { 'Set-Cookie': ownerCookie(session.token) });

  if (path === '/api/owner/session' && method === 'GET') {
    const configured = await security.ownerConfigured();
    let authenticated = false;
    if (configured && requestSession(request)) {
      try { await security.requireOwnerSession(requestSession(request)); authenticated = true; }
      catch (failure) { if (!(failure instanceof SecurityError && failure.code === 'sign_in_required')) throw failure; }
    }
    return json({ configured, authenticated, role: authenticated ? 'owner' : null });
  }
  if (path === '/api/owner/initialize' && method === 'POST') {
    assertSameOrigin(request);
    const body = await readAuthBody(request);
    return sessionResponse(await security.initializeOwner(body.password, { clientKey }));
  }
  if (path === '/api/owner/login' && method === 'POST') {
    assertSameOrigin(request);
    const body = await readAuthBody(request);
    return sessionResponse(await security.login(body.password, { clientKey }));
  }
  if (path === '/api/owner/logout' && method === 'POST') {
    assertSameOrigin(request);
    await security.revokeSession(requestSession(request));
    return json({ ok: true }, 200, { 'Set-Cookie': ownerCookie('', 0) });
  }
  if (path === '/api/owner/password' && method === 'PUT') {
    await security.authenticateRequest(request);
    const body = await readAuthBody(request);
    return sessionResponse(await security.rotateOwnerPassword(requestSession(request), body.current_password, body.password));
  }

  const shareMatch = path.match(/^\/api\/teams\/([^/]+)\/share$/);
  if (shareMatch && ['GET','POST', 'DELETE'].includes(method)) {
    await security.authenticateRequest(request);
    let teamId;
    try { teamId = decodeURIComponent(shareMatch[1]); } catch { error('input_invalid', 'The team is invalid.'); }
    if(method==='GET') {const result=await security.retrieveOwnerViewerLink(requestSession(request),teamId);return json({ok:true,team_id:teamId,categories:result.categories,expires_at:result.expires_at,viewer_url:result.token?url.origin+'/view/'+encodeURIComponent(result.token):null});}
    if (method === 'DELETE') {
      await security.revokeViewerTokens(requestSession(request), teamId);
      return json({ ok: true });
    }
    const body = await readAuthBody(request);
    const result = await security.createViewerToken(requestSession(request), teamId, { categories: body.categories, expiresAt: body.expires_at });
    return json({ ok: true, team_id: teamId, categories: result.categories, expires_at: result.expires_at,
      viewer_url: url.origin + '/view/' + encodeURIComponent(result.token) });
  }

  const matched = path === '/api/accounts' && method === 'GET'
    || path === '/api/accounts/teamsnap/config' && method === 'GET'
    || path === '/api/accounts/trace/attempt' && method === 'GET'
    || ['/api/accounts/teamsnap/authorize', '/api/accounts/teamsnap/callback', '/api/accounts/trace/start', '/api/accounts/trace/verify', '/api/accounts/trace/cancel'].includes(path) && method === 'POST'
    || /^\/api\/accounts\/[^/]+$/.test(path) && method === 'DELETE';
  if (!matched) return null;
  const owner = await security.authenticateRequest(request), sessionToken = requestSession(request);

  if (path === '/api/accounts' && method === 'GET') {
    const cursor = url.searchParams.get('cursor') || '';
    if (cursor.length > 200) error('input_invalid', 'The account cursor is invalid.');
    const rows = (await domain.db.prepare(ACCOUNT_SELECT + ' WHERE a.id>? ORDER BY a.id LIMIT 101').bind(cursor).all()).results;
    return json({ accounts: rows.slice(0, 100).map((row) => accountPublic(row, security.now())), next_cursor: rows.length > 100 ? rows[99].id : null });
  }
  if (path === '/api/accounts/teamsnap/config')
    return json(await security.teamSnapConfiguration(sessionToken, { origin: url.origin }));
  if (path === '/api/accounts/trace/attempt')
    return json(await security.traceAttemptStatus(sessionToken, url.searchParams.get('attempt')));
  if (path === '/api/accounts/teamsnap/authorize') {
    const body = await readAuthBody(request);
    return json(await security.beginTeamSnapOAuth(sessionToken, { origin: url.origin, clientId: body.client_id }));
  }
  if (method === 'DELETE') {
    let accountId;
    try { accountId = decodeURIComponent(path.slice('/api/accounts/'.length)); } catch { error('input_invalid', 'The account is invalid.'); }
    await domain.disconnectAccount(accountId, {
      precondition: sessionCondition(owner, security),
      additionalStatements: (guard, token, id) => [domain.db.prepare(`DELETE FROM security_account_credentials WHERE account_id=? AND ${guard}`).bind(id, token)],
    });
    return json({ ok: true, account_id: accountId, authorization_state: 'disconnected' });
  }

  async function saveAuthorization(provider, nativeId, name, credential, expiresAt = null, traceClaim = null) {
    if (typeof enqueueDiscovery !== 'function') error('discovery_unconfigured', 'Background discovery is not configured.', 503);
    await security.requireOwnerSession(sessionToken);
    const existing = await domain.db.prepare('SELECT id FROM provider_accounts WHERE provider=? AND native_id=?').bind(provider, nativeId).first();
    const accountId = existing?.id || crypto.randomUUID();
    const ciphertext = await security.encryptCredential(accountId, credential);
    const condition = sessionCondition(owner, security);
    condition.sql += ' AND NOT EXISTS(SELECT 1 FROM provider_accounts WHERE provider=? AND native_id=? AND id<>?)';
    condition.params.push(provider, nativeId, accountId);
    const traceCommit = traceClaim && await security.prepareTraceAttemptCommit(sessionToken, traceClaim.attempt, traceClaim.claim_id);
    if (traceCommit) { condition.sql += ' AND ' + traceCommit.sql; condition.params.push(...traceCommit.params); }
    let account;
    try { account = await domain.registerAccount({ provider, nativeId, name, accountId, precondition: condition,
      additionalStatements: (guard, token, id) => [domain.db.prepare(`INSERT INTO security_account_credentials
        SELECT id,generation,?,?,? FROM provider_accounts WHERE id=? AND ${guard}
        ON CONFLICT(account_id) DO UPDATE SET account_generation=excluded.account_generation,ciphertext=excluded.ciphertext,
          expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(ciphertext, expiresAt, security.now(), id, token),
        ...(traceCommit ? [traceCommit.consume(guard, token)] : [])],
    }); } catch (failure) {
      if (failure.code === 'revision_conflict') {
        await security.requireOwnerSession(sessionToken);
        if (traceClaim) await security.prepareTraceAttemptCommit(sessionToken, traceClaim.attempt, traceClaim.claim_id);
      }
      throw failure;
    }
    await enqueueDiscovery(account);
    const safe = await domain.db.prepare(ACCOUNT_SELECT + ' WHERE a.id=?').bind(account.id).first();
    return { ok: true, account: accountPublic(safe, security.now()), discovery: { state: 'queued' } };
  }

  if (path === '/api/accounts/teamsnap/callback') {
    const body = await readAuthBody(request, 24576);
    // Consume/check state before constructing transport or making any provider request.
    const returned = await security.completeTeamSnapOAuth(sessionToken, body, { origin: url.origin });
    const me = collection(await ts(makeTransport(), 'me', returned.access_token));
    if (me.length !== 1 || !native(me[0]?.id)) error('teamsnap_identity_invalid', 'TeamSnap did not confirm the account.', 502);
    const name = String(me[0].name || [me[0].first_name, me[0].last_name].filter(Boolean).join(' ') || 'TeamSnap account').slice(0, 200);
    return json(await saveAuthorization('teamsnap', String(me[0].id), name, returned.access_token, returned.expires_at));
  }

  if (path === '/api/accounts/trace/start') {
    const body = await readAuthBody(request), email = field(body.email, 'Trace email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error('trace_email_invalid', 'Enter the email used for Trace.');
    await security.consumeRate('trace-code-send', owner.session_id, 5, 1200000);
    const transport = makeTransport();
    const guest = cookieFrom((await traceRequest(transport, TEAMS + '/users/self/logout', '', { method: 'POST', body: new FormData() })).response);
    if (!guest) error('trace_guest_session_missing', 'Trace did not establish a sign-in session. Try again.', 502);
    const lookup = (await traceRequest(transport, 'https://lapi.traceup.com/tracebot-prod/42/users/search?email=' + encodeURIComponent(email))).value;
    const userId = native(lookup.data?.id || lookup.data?.user_id || lookup.user_id);
    if (!userId) error('trace_account_not_found', 'Trace could not find that account.', 404);
    const form = new FormData();
    form.set('email', email); form.set('email_type', 'magic-code'); form.set('proceed_url', APP + '/traceid');
    const sent = (await traceRequest(transport, TEAMS + '/autologin-url/send', guest, { method: 'POST', body: form })).value;
    if (sent.success === false) error('trace_code_not_sent', 'Trace could not send the sign-in code.', 502);
    return json(await security.beginTraceAttempt(sessionToken, { email, userId, guestCookie: guest }));
  }
  if (path === '/api/accounts/trace/cancel') {
    const body = await readAuthBody(request);
    await security.cancelTraceAttempt(sessionToken, body.attempt);
    return json({ ok: true });
  }
  if (path === '/api/accounts/trace/verify') {
    const body = await readAuthBody(request), code = field(body.code, 'Trace code', 200);
    const claim = await security.claimTraceAttempt(sessionToken, body.attempt), transport = makeTransport();
    let verified = false;
    try {
      const form = new FormData(); form.set('user_id', claim.user_id); form.set('code', code);
      const login = await traceRequest(transport, TEAMS + '/users/login/by-code', claim.guest_cookie, { method: 'POST', body: form });
      if (login.value.success === false) error('trace_code_rejected', 'Trace rejected that sign-in code.');
      const cookie = cookieFrom(login.response) || claim.guest_cookie;
      const response = (await traceRequest(transport, TEAMS + '/users/self', cookie)).value;
      const identity = response.data ?? response;
      if (response.success === false || native(identity?.user_id || identity?.id) !== claim.user_id)
        error('trace_identity_invalid', 'Trace did not confirm the selected account.', 502);
      await tokenFor(transport, cookie, { native_id: claim.user_id });
      const teams = await traceTeams(transport, cookie);
      const name = String(identity.name || [identity.first_name, identity.last_name].filter(Boolean).join(' ') || 'Trace account').slice(0, 200);
      const connected = await saveAuthorization('trace', claim.user_id, name, cookie, null, { attempt: body.attempt, claim_id: claim.claim_id });
      verified = true;
      return json({ ...connected, verified_team_count: teams.length });
    } catch (failure) {
      if (!verified) {
        try { await security.finishTraceAttempt(sessionToken, body.attempt, claim.claim_id, {
          success: false, retryable: !['trace_identity_invalid', 'account_access_lost', 'authentication_required'].includes(failure.code),
        }); } catch (releaseFailure) {
          if (!(releaseFailure instanceof SecurityError && ['trace_attempt_invalid', 'sign_in_required'].includes(releaseFailure.code))) throw releaseFailure;
        }
      }
      throw failure;
    }
  }
  return null;
}
