import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SecurityStore, installSecuritySchema } from '../src/security/index.js';
import { digest, randomToken } from '../src/security/crypto.js';
import { initializeDomain } from '../src/domain/schema.js';
import { DomainRepository } from '../src/domain/repository.js';
import { applicationAuthRoutes } from '../src/application/auth-routes.js';
import { SourceTransport } from '../src/sources/http.js';

const ORIGIN = 'https://provider-recovery.example';
// Deterministic SQLite coverage calls the real stores/routes directly. Native
// Workerd/D1 HTTP coverage remains in application-auth.test.js. Providers below
// are simulated; no real provider registrations, login or entitlements are asserted.
async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      const wrap = (params = []) => ({
        sql, bind: (...values) => wrap(values),
        execute() {
          const results = sqlite.prepare(sql).all(...params).map(row => ({ ...row }));
          return { results, meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get().n) } };
        },
        async first() { return this.execute().results[0] ?? null; },
        async all() { return this.execute(); },
        async run() { return this.execute(); },
      });
      return wrap();
    },
    async batch(statements) {
      if (h.beforeBatch) await h.beforeBatch(statements);
      sqlite.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const h = { db, now: Date.now(), beforeBatch: null, calls: [], queued: [], beforeProvider: null };
  await initializeDomain(db);
  await installSecuritySchema(db);
  await db.prepare('INSERT INTO security_owner VALUES(1,?,?,600000,1,?,?,?)')
    .bind('fixture-unused-salt', 'fixture-unused-verifier', 'fixture-initialization', h.now, h.now).run();
  await db.prepare('INSERT INTO security_installation VALUES(1,?,?,?)').bind(crypto.randomUUID(), randomToken(), h.now).run();
  h.security = new SecurityStore(db, { now: () => h.now });
  h.domain = new DomainRepository(db);
  h.session = async () => {
    const token = randomToken();
    await db.prepare('INSERT INTO security_sessions VALUES(?,1,?,?,NULL)').bind(await digest(token), h.now, h.now + 86400000).run();
    return token;
  };
  h.token = await h.session();
  h.req = async (route, { method = 'GET', body, token = h.token, headers = {} } = {}) => {
    const request = new Request(ORIGIN + route, { method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: 'myts_session=' + token, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    try {
      const response = await applicationAuthRoutes(request, { security: h.security, domain: h.domain,
        enqueueDiscovery: async account => { h.queued.push(account); },
        transportFactory: () => new SourceTransport({}, { fetch: async (url, options) => {
          const path = new URL(url).pathname; h.calls.push(path);
          if (h.beforeProvider) await h.beforeProvider(path);
          if (path === '/v3/me') return Response.json({ collection: { items: [{ data: [{ name: 'id', value: 501 }, { name: 'name', value: 'TeamSnap owner' }], links: [] }], links: [] } });
          if (path.endsWith('/users/login/by-code')) return Response.json({ success: options.body.get('code') !== 'wrong' }, { headers: { 'Set-Cookie': 'PHPSESSID=fixture-authenticated; Secure; HttpOnly' } });
          if (path.endsWith('/users/self')) return Response.json({ data: { user_id: 601, name: 'Trace owner' } });
          if (path.endsWith('/users/self/token')) return Response.json({ data: { user_id: 601, token: 'fixture-provider-token', timestamp: 1700000000 } });
          if (path.endsWith('/users/self/teams')) return Response.json({ data: [{ team_id: 701 }] });
          throw new Error('Unexpected fixture provider endpoint: ' + path);
        } }),
      });
      return { status: response.status, body: await response.json() };
    } catch (failure) { return { status: failure.status ?? 500, body: { error: { code: failure.code ?? 'unexpected_error', message: failure.message } } }; }
  };
  h.oauth = (body = {}) => h.req('/api/accounts/teamsnap/authorize', { method: 'POST', body: { client_id: 'fixture-client', ...body } });
  h.callback = (state, optional = {}) => h.req('/api/accounts/teamsnap/callback', { method: 'POST', body: { state, access_token: 'fixture-access-token', ...optional } });
  h.trace = () => h.security.beginTraceAttempt(h.token, { email: 'owner@example.com', userId: '601', guestCookie: 'PHPSESSID=fixture-guest' });
  h.status = (attempt, options) => h.req('/api/accounts/trace/attempt?attempt=' + encodeURIComponent(attempt), options);
  h.verify = attempt => h.req('/api/accounts/trace/verify', { method: 'POST', body: { attempt, code: '123456' } });
  h.counts = async () => db.prepare('SELECT (SELECT COUNT(*) FROM provider_accounts) AS accounts,(SELECT COUNT(*) FROM security_account_credentials) AS credentials').first();
  return h;
}
const good = result => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };

test('TeamSnap callback accepts omitted/null optional fields and strict valid expiry without widening scope', async t => {
  const h = await fixture(t);
  for (const optional of [{}, { token_type: null, expires_in: null }, { token_type: 'Bearer', expires_in: '3600', scope: 'read' }]) {
    const flow = good(await h.oauth());
    assert.equal(new URL(flow.authorization_url).searchParams.get('scope'), 'read');
    const connected = good(await h.callback(flow.state, optional));
    assert.equal(connected.account.expires_at, optional.expires_in ? h.now + 3600000 : null);
    assert.equal(connected.account.authorization_state, 'connected');
  }
  assert.deepEqual(await h.counts(), { accounts: 1, credentials: 1 });
});

test('TeamSnap malformed provided optional values are rejected before upstream calls', async t => {
  const h = await fixture(t);
  for (const optional of [
    { token_type: '' }, { token_type: ['Bearer'] }, { token_type: {} }, { token_type: true }, { token_type: 'Basic' },
    { expires_in: '' }, { expires_in: ' ' }, { expires_in: true }, { expires_in: [] }, { expires_in: [3600] },
    { expires_in: '1e3' }, { expires_in: '0x10' }, { expires_in: '3.5' }, { expires_in: 0 }, { expires_in: -1 },
    { expires_in: 1.5 }, { expires_in: 31536001 }, { scope: 'read write' }, { scope: ['read'] },
  ]) {
    await h.db.prepare('DELETE FROM security_rate_limits').run();
    const flow = good(await h.oauth());
    const result = await h.callback(flow.state, optional);
    assert.equal(result.status, 400, JSON.stringify(optional));
    assert.match(result.body.error.code, /^oauth_(token|scope)_invalid$/);
    assert.equal((await h.callback(flow.state)).body.error.code, 'oauth_state_invalid');
  }
  assert.equal(h.calls.length, 0);
  assert.deepEqual(await h.counts(), { accounts: 0, credentials: 0 });
});

test('TeamSnap saved bad Client ID can be repaired without asserting provider registration', async t => {
  const h = await fixture(t);
  const empty = good(await h.req('/api/accounts/teamsnap/config'));
  assert.equal(empty.client_id_status, 'missing');
  assert.equal(empty.redirect_uri, ORIGIN + '/admin');
  const bad = good(await h.oauth({ client_id: 'incorrect-client' }));
  assert.equal((await h.callback(bad.state, { error: 'invalid_client' })).body.error.code, 'oauth_client_invalid');
  const saved = good(await h.req('/api/accounts/teamsnap/config'));
  assert.equal(saved.client_id, 'incorrect-client');
  assert.equal(saved.client_id_status, 'saved');
  assert.equal(saved.requires_client_id, false);
  const repair = good(await h.oauth({ client_id: 'repaired-client' }));
  assert.equal(new URL(repair.authorization_url).searchParams.get('client_id'), 'repaired-client');
  good(await h.callback(repair.state));
  const reused = good(await h.req('/api/accounts/teamsnap/authorize', { method: 'POST', body: {} }));
  assert.equal(new URL(reused.authorization_url).searchParams.get('client_id'), 'repaired-client');
  assert.deepEqual(await h.counts(), { accounts: 1, credentials: 1 });
});

test('TeamSnap state still rejects missing/replayed/wrong-session/expired/origin-mismatched callbacks', async t => {
  const h = await fixture(t), flow = good(await h.oauth()), other = await h.session();
  assert.equal((await h.callback(null)).body.error.code, 'oauth_state_invalid');
  assert.equal((await h.req('/api/accounts/teamsnap/callback', { method: 'POST', token: other, body: { state: flow.state, access_token: 'fixture' } })).status, 403);
  assert.equal((await h.req('/api/accounts/teamsnap/callback', { method: 'POST', headers: { origin: 'https://wrong.example' }, body: { state: flow.state, access_token: 'fixture' } })).status, 403);
  good(await h.callback(flow.state));
  assert.equal((await h.callback(flow.state)).status, 403);
  const expired = good(await h.oauth()); h.now += 10 * 60000;
  assert.equal((await h.callback(expired.state)).status, 403);
  const revoked = good(await h.oauth()); await h.security.revokeSession(h.token);
  assert.equal((await h.callback(revoked.state)).body.error.code, 'sign_in_required');
  assert.equal(h.calls.length, 1);
});

test('Trace recovery exposes only safe state to the same live owner session', async t => {
  const h = await fixture(t), a = await h.trace(), b = await h.trace();
  assert.notEqual(a.attempt, b.attempt);
  assert.deepEqual(good(await h.status(a.attempt)), { attempt: a.attempt, stage: 'pending', expires_at: a.expires_at, retry_at: null });
  const pending = await h.db.prepare('SELECT pending_ciphertext FROM security_trace_attempts').first();
  for (const secret of ['owner@example.com', 'fixture-guest']) assert.ok(!pending.pending_ciphertext.includes(secret));
  const other = await h.session();
  assert.equal((await h.status(a.attempt, { token: other })).status, 410);
  good(await h.req('/api/accounts/trace/cancel', { method: 'POST', token: other, body: { attempt: a.attempt } }));
  assert.equal(good(await h.status(a.attempt)).stage, 'pending');
  assert.equal((await h.status(a.attempt, { headers: { 'x-view-key': randomToken() } })).status, 401);
  const claim = await h.security.claimTraceAttempt(h.token, a.attempt);
  assert.deepEqual(good(await h.status(a.attempt)), { attempt: a.attempt, stage: 'verifying', expires_at: a.expires_at, retry_at: h.now + 120000 });
  // A new SecurityStore models process loss; the claim lease can recover without resending email.
  h.security = new SecurityStore(h.db, { now: () => h.now }); h.now += 120000;
  assert.equal(good(await h.status(a.attempt)).stage, 'pending');
  const reclaimed = await h.security.claimTraceAttempt(h.token, a.attempt);
  assert.notEqual(reclaimed.claim_id, claim.claim_id);
  await h.security.finishTraceAttempt(h.token, a.attempt, reclaimed.claim_id, { success: false });
  good(await h.req('/api/accounts/trace/cancel', { method: 'POST', body: { attempt: a.attempt } }));
  assert.equal((await h.status(a.attempt)).status, 410);
  assert.equal(good(await h.status(b.attempt)).stage, 'pending');
  await h.security.revokeSession(h.token);
  assert.equal((await h.status(b.attempt)).body.error.code, 'sign_in_required');
});

test('Trace recovery preserves the twenty-minute expiry and eight-verification bound', async t => {
  const h = await fixture(t), a = await h.trace();
  assert.equal(a.expires_at, h.now + 20 * 60000);
  for (let i = 0; i < 8; i++) {
    const claim = await h.security.claimTraceAttempt(h.token, a.attempt);
    await h.security.finishTraceAttempt(h.token, a.attempt, claim.claim_id, { success: false });
  }
  assert.equal(good(await h.status(a.attempt)).stage, 'failed');
  await assert.rejects(h.security.claimTraceAttempt(h.token, a.attempt), error => error.code === 'trace_attempt_invalid');
  const b = await h.trace(); h.now = b.expires_at;
  assert.equal((await h.status(b.attempt)).status, 410);
  assert.equal((await h.verify(b.attempt)).status, 410);
  assert.equal(h.calls.length, 0);
});

test('Trace cancel during provider verification prevents a late account or credential commit', async t => {
  const h = await fixture(t), a = await h.trace();
  h.beforeProvider = async path => {
    if (path.endsWith('/users/self/teams')) good(await h.req('/api/accounts/trace/cancel', { method: 'POST', body: { attempt: a.attempt } }));
  };
  assert.equal((await h.verify(a.attempt)).body.error.code, 'trace_attempt_invalid');
  assert.deepEqual(await h.counts(), { accounts: 0, credentials: 0 });
  assert.equal(h.queued.length, 0);
});

test('Trace cancellation after claim precheck but before the atomic batch wins without modifying prior credentials', async t => {
  const h = await fixture(t), first = await h.trace();
  const connected = good(await h.verify(first.attempt));
  const previous = await h.db.prepare('SELECT * FROM security_account_credentials').first();
  const a = await h.trace();
  h.beforeBatch = async statements => {
    if (!statements.some(statement => statement.sql.includes('INSERT INTO provider_accounts'))) return;
    h.beforeBatch = null;
    good(await h.req('/api/accounts/trace/cancel', { method: 'POST', body: { attempt: a.attempt } }));
  };
  assert.equal((await h.verify(a.attempt)).body.error.code, 'trace_attempt_invalid');
  assert.equal((await h.db.prepare('SELECT generation FROM provider_accounts').first()).generation, connected.account.generation);
  assert.deepEqual(await h.db.prepare('SELECT * FROM security_account_credentials').first(), previous);
  assert.equal(h.queued.length, 1);
});

test('Trace owner revocation immediately before commit blocks the whole account transaction', async t => {
  const h = await fixture(t), a = await h.trace();
  h.beforeBatch = async statements => {
    if (!statements.some(statement => statement.sql.includes('INSERT INTO provider_accounts'))) return;
    h.beforeBatch = null; await h.security.revokeSession(h.token);
  };
  assert.equal((await h.verify(a.attempt)).body.error.code, 'sign_in_required');
  assert.deepEqual(await h.counts(), { accounts: 0, credentials: 0 });
  assert.equal(h.queued.length, 0);
});

test('Trace credential failure rolls back attempt consumption and account write, permitting a safe retry', async t => {
  const h = await fixture(t), a = await h.trace();
  await h.db.prepare("CREATE TRIGGER reject_trace_credential BEFORE INSERT ON security_account_credentials BEGIN SELECT RAISE(ABORT,'fixture credential failure'); END").run();
  assert.equal((await h.verify(a.attempt)).status, 500);
  assert.deepEqual(await h.counts(), { accounts: 0, credentials: 0 });
  assert.equal(good(await h.status(a.attempt)).stage, 'pending');
  await h.db.prepare('DROP TRIGGER reject_trace_credential').run();
  const connected = good(await h.verify(a.attempt));
  assert.equal(connected.account.provider, 'trace');
  assert.deepEqual(await h.counts(), { accounts: 1, credentials: 1 });
  assert.equal((await h.status(a.attempt)).status, 410);
  // If verification commits first, a later cancellation cannot undo that authorization.
  good(await h.req('/api/accounts/trace/cancel', { method: 'POST', body: { attempt: a.attempt } }));
  assert.equal((await h.security.loadAccountCredential(connected.account.id, { generation: 1 })).credential, 'PHPSESSID=fixture-authenticated');
  assert.equal(h.queued.length, 1);
});

test('Trace attempt-consumption failure rolls back the earlier account and encrypted credential writes', async t => {
  const h = await fixture(t), a = await h.trace();
  await h.db.prepare("CREATE TRIGGER reject_trace_consumption BEFORE DELETE ON security_trace_attempts BEGIN SELECT RAISE(ABORT,'fixture consume failure'); END").run();
  assert.equal((await h.verify(a.attempt)).status, 500);
  assert.deepEqual(await h.counts(), { accounts: 0, credentials: 0 });
  assert.equal(good(await h.status(a.attempt)).stage, 'pending');
  assert.equal(h.queued.length, 0);
  await h.db.prepare('DROP TRIGGER reject_trace_consumption').run();
  good(await h.verify(a.attempt));
  assert.deepEqual(await h.counts(), { accounts: 1, credentials: 1 });
});
