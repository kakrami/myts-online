import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare } from 'miniflare';
import { initializeDomain } from '../src/domain/schema.js';
import { DomainRepository } from '../src/domain/repository.js';
import { SecurityStore, installSecuritySchema } from '../src/security/index.js';

// Private upstream responses below are deliberately simulated. These tests do not validate real provider login.
const PASSWORD = 'owner-password-for-http-tests';
const ORIGIN = 'https://myts-test.example';
let mf, db, signals, cookie;
const good = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };

test.before(async () => {
  const root = path.resolve('.'), modules = {};
  for (const folder of ['src/security', 'src/domain', 'src/sources']) {
    for (const file of await readdir(path.join(root, folder), {recursive:true})) if (file.endsWith('.js'))
      modules[folder + '/' + file] = { type: 'esm', contents: await readFile(path.join(root, folder, file), 'utf8') };
  }
  modules['src/application/auth-routes.js'] = { type: 'esm', contents: await readFile('src/application/auth-routes.js', 'utf8') };
  modules['tests/auth-http-entry.js'] = { type: 'esm', contents: `
    import { applicationAuthRoutes } from '../src/application/auth-routes.js';
    import { SecurityStore } from '../src/security/index.js';
    import { DomainRepository } from '../src/domain/repository.js';
    import { SourceTransport } from '../src/sources/http.js';
    export default { async fetch(request, env) {
      const security = new SecurityStore(env.DB, { bootstrapPassword: '${PASSWORD}' });
      const domain = new DomainRepository(env.DB);
      try {
        return await applicationAuthRoutes(request, { security, domain,
          transportFactory: () => new SourceTransport({}, { fetch: async (url, options) => {
            const response = await env.PROVIDER.fetch(url, options);
            if (new URL(url).pathname === '/v3/me' && await env.TEST.get('mode') === 'revoke-session')
              await env.DB.prepare('UPDATE security_sessions SET revoked_at=?').bind(Date.now()).run();
            return response;
          }, maxCalls: 8, deadlineMs: 90000, timeoutMs: 15000 }),
          enqueueDiscovery: async (account) => {
            const queued = JSON.parse(await env.TEST.get('queued') || '[]');
            queued.push({accountId: account.id, provider: account.provider, generation: account.generation, kind: 'catalog'});
            await env.TEST.put('queued', JSON.stringify(queued));
          },
        }) || Response.json({error:{code:'not_found'}}, {status:404});
      } catch (error) { return Response.json({error:{code:error.code || 'unexpected_error',message:error.message}}, {status:error.status || 500}); }
    } };
  ` };
  const provider = `
    const json = (value,status=200,headers={}) => Response.json(value,{status,headers});
    export default { async fetch(request,env) {
      const url = new URL(request.url), mode = await env.TEST.get('mode');
      const calls = JSON.parse(await env.TEST.get('calls') || '[]');
      calls.push({host:url.hostname,path:url.pathname,method:request.method,has_authorization:request.headers.has('authorization'),has_cookie:request.headers.has('cookie')});
      await env.TEST.put('calls',JSON.stringify(calls));
      if (url.hostname === 'api.teamsnap.com' && url.pathname === '/v3/me') {
        if (request.headers.get('authorization') !== 'Bearer synthetic-teamsnap-token') return json({error:'denied'},401);
        if (mode === 'wrong-teamsnap-shape') return json({collection:{items:[]}});
        return json({collection:{items:[{data:[{name:'id',value:501},{name:'name',value:'Owner TeamSnap'}],links:[]}],links:[]}});
      }
      if (url.pathname.endsWith('/users/self/logout')) return json({success:true},200,{'Set-Cookie':'PHPSESSID=synthetic-guest; HttpOnly; Secure'});
      if (url.pathname.endsWith('/users/search')) return json({data:mode === 'no-trace-account' ? null : {user_id:601}});
      if (url.pathname.endsWith('/autologin-url/send')) return json({success:true});
      if (url.pathname.endsWith('/users/login/by-code')) {
        const form = await request.formData();
        return form.get('code') === '123456' ? json({success:true},200,{'Set-Cookie':'PHPSESSID=synthetic-authenticated; HttpOnly; Secure'}) : json({success:false});
      }
      if (url.pathname.endsWith('/users/self/token')) return json({data:{user_id:601,token:'synthetic-graphql-token',timestamp:1700000000}});
      if (url.pathname.endsWith('/users/self/teams')) return mode === 'trace-restricted' ? json({error:'denied'},403)
        : json({data:[{team_id:701,title:'Verified provider team',name:'verified-provider-team',season:'2026/2027'}]});
      if (url.pathname.endsWith('/users/self')) return json({success:true,data:{user_id:mode === 'wrong-trace-account' ? 999 : 601,first_name:'Trace',last_name:'Owner'}});
      return json({error:'unsupported mock route'},404);
    } };
  `;
  mf = new Miniflare({ telemetry: { enabled: false }, workers: [
    { config: { name: 'auth-http', compatibilityDate: '2026-09-09', manifest: { mainModule: 'tests/auth-http-entry.js', modulesRoot: root, modules },
      env: { DB: { type: 'd1', id: 'auth-http-db' }, TEST: { type: 'kv', id: 'auth-http-signals' }, PROVIDER: { type: 'worker', worker: 'auth-provider' } }, exports: {} } },
    { config: { name: 'auth-provider', compatibilityDate: '2026-09-09', manifest: { mainModule: 'provider.js', modulesRoot: root, modules: { 'provider.js': { type: 'esm', contents: provider } } },
      env: { TEST: { type: 'kv', id: 'auth-http-signals' } }, exports: {} } },
  ] });
  await mf.ready;
  db = await mf.getD1Database('DB', 'auth-http');
  signals = await mf.getKVNamespace('TEST', 'auth-http');
  await initializeDomain(db);
  await installSecuritySchema(db);
});

test.beforeEach(async () => {
  await db.batch(['security_oauth_states', 'security_trace_attempts', 'security_account_credentials', 'security_viewer_tokens',
    'security_connection_config', 'security_rate_limits', 'security_sessions', 'security_owner', 'security_installation',
    'team_source_attachments', 'account_source_teams', 'source_team_links', 'source_teams', 'team_projection_state', 'team_read_state',
    'team_seasons', 'app_teams', 'provider_accounts', 'domain_fences', 'domain_source_preconditions', 'domain_projection_preconditions']
    .map((table) => db.prepare('DELETE FROM ' + table)));
  await db.prepare('UPDATE domain_installation SET source_revision=0,mutation_revision=0').run();
  await signals.put('calls', '[]'); await signals.put('queued', '[]'); await signals.put('mode', '');
  cookie = '';
});
test.after(async () => { await mf?.dispose(); });

async function req(route, options = {}) {
  const method = options.method || 'GET';
  const response = await mf.dispatchFetch(ORIGIN + route, { method,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...options.headers },
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  if (options.updateCookie !== false && response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function owner() { return good(await req('/api/owner/initialize', { method: 'POST', body: { password: PASSWORD } })); }
async function calls() { return JSON.parse(await signals.get('calls') || '[]'); }
async function queued() { return JSON.parse(await signals.get('queued') || '[]'); }
async function oauth() { return good(await req('/api/accounts/teamsnap/authorize', { method: 'POST', body: { client_id: 'one-time-app-client' } })); }
async function connectTeamSnap(state) {
  return req('/api/accounts/teamsnap/callback', { method: 'POST', body: { state, access_token: 'synthetic-teamsnap-token', token_type: 'Bearer' } });
}

test('owner HTTP initialization, login and logout preserve a single password flow without token JSON responses', async () => {
  assert.deepEqual(good(await req('/api/owner/session')), { configured: false, authenticated: false, role: null });
  assert.equal((await req('/api/owner/initialize', { method: 'POST', body: { password: 'arbitrary-visitor-password' } })).body.error.code, 'password_incorrect');
  const initialized = await owner();
  assert.equal(initialized.token, undefined);
  assert.match(cookie, /^myts_session=/);
  assert.equal(good(await req('/api/owner/session')).authenticated, true);
  assert.equal(good(await req('/api/accounts')).accounts.length, 0);
  good(await req('/api/owner/logout', { method: 'POST', body: {} }));
  assert.equal(good(await req('/api/owner/session')).authenticated, false);
  assert.equal((await req('/api/accounts')).status, 401);
  assert.equal((await req('/api/owner/login', { method: 'POST', body: { password: 'incorrect-password' } })).status, 401);
  good(await req('/api/owner/login', { method: 'POST', body: { password: PASSWORD } }));
  assert.equal(good(await req('/api/owner/session')).authenticated, true);
});

test('wrong, missing and provider-error OAuth state never invokes the upstream or creates an account/team', async () => {
  await owner();
  const flow = await oauth();
  assert.equal(new URL(flow.authorization_url).searchParams.get('redirect_uri'), ORIGIN + '/admin');
  for (const state of [null, '', 'wrong']) assert.equal((await connectTeamSnap(state)).status, 403);
  const denied = await req('/api/accounts/teamsnap/callback', { method: 'POST', body: { state: flow.state, error: 'access_denied' } });
  assert.equal(denied.body.error.code, 'oauth_provider_error');
  assert.equal((await connectTeamSnap(flow.state)).status, 403);
  assert.equal((await calls()).length, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM provider_accounts').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM app_teams').first()).n, 0);
});

test('verified TeamSnap identity commits account and encrypted credential atomically and queues only source discovery', async () => {
  await owner();
  const connected = good(await connectTeamSnap((await oauth()).state));
  assert.equal(connected.account.provider, 'teamsnap');
  assert.equal(connected.account.authorization_state, 'connected');
  assert.equal(connected.discovery.state, 'queued');
  const credential = await new SecurityStore(db).loadAccountCredential(connected.account.id, { generation: connected.account.generation });
  assert.equal(credential.credential, 'synthetic-teamsnap-token');
  assert.equal((await queued()).length, 1);
  assert.equal((await queued())[0].kind, 'catalog');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM app_teams').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM source_teams').first()).n, 0);
  const safe = good(await req('/api/accounts'));
  assert.ok(!JSON.stringify(safe).includes('synthetic-teamsnap-token'));
  assert.equal(safe.accounts[0].id, connected.account.id);
  assert.equal((await connectTeamSnap((await oauth()).state)).body.account.generation, connected.account.generation + 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM provider_accounts').first()).n, 1);
  assert.ok(!(await calls()).some((call) => Object.hasOwn(call, 'authorization')));
});

test('owner revocation during provider HTTPS prevents account and credential commit', async () => {
  await owner();
  const flow = await oauth();
  await signals.put('mode', 'revoke-session');
  const result = await connectTeamSnap(flow.state);
  assert.equal(result.status, 401);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM provider_accounts').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM security_account_credentials').first()).n, 0);
  assert.equal((await queued()).length, 0);
});

test('a credential write failure rolls back account generation and preserves prior working authorization', async () => {
  await owner();
  const connected = good(await connectTeamSnap((await oauth()).state));
  await db.prepare(`CREATE TRIGGER auth_test_reject_credential BEFORE UPDATE ON security_account_credentials
    BEGIN SELECT RAISE(ABORT,'synthetic credential commit failure'); END`).run();
  try {
    assert.equal((await connectTeamSnap((await oauth()).state)).status, 500);
    const account = await db.prepare('SELECT generation FROM provider_accounts WHERE id=?').bind(connected.account.id).first();
    assert.equal(account.generation, connected.account.generation);
    assert.equal((await new SecurityStore(db).loadAccountCredential(connected.account.id, { generation: account.generation })).credential, 'synthetic-teamsnap-token');
    assert.equal((await queued()).length, 1);
  } finally { await db.prepare('DROP TRIGGER auth_test_reject_credential').run(); }
});

test('Trace wrong-code retry preserves its independent attempt; verified identity queues discovery without appteam creation', async () => {
  await owner();
  const a = good(await req('/api/accounts/trace/start', { method: 'POST', body: { email: 'owner@example.com' } }));
  const b = good(await req('/api/accounts/trace/start', { method: 'POST', body: { email: 'owner@example.com' } }));
  assert.notEqual(a.attempt, b.attempt);
  const wrong = await req('/api/accounts/trace/verify', { method: 'POST', body: { attempt: a.attempt, code: '654321' } });
  assert.equal(wrong.body.error.code, 'trace_code_rejected');
  const connected = good(await req('/api/accounts/trace/verify', { method: 'POST', body: { attempt: a.attempt, code: '123456' } }));
  assert.equal(connected.account.provider, 'trace');
  assert.equal(connected.account.authorization_state, 'connected');
  assert.equal(connected.verified_team_count, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM app_teams').first()).n, 0);
  assert.equal((await queued())[0].provider, 'trace');
  assert.equal((await new SecurityStore(db).loadAccountCredential(connected.account.id, { generation: connected.account.generation })).credential, 'PHPSESSID=synthetic-authenticated');
  assert.equal((await req('/api/accounts/trace/verify', { method: 'POST', body: { attempt: a.attempt, code: '123456' } })).status, 410);
  good(await req('/api/accounts/trace/cancel', { method: 'POST', body: { attempt: b.attempt } }));
});

test('wrong Trace identity and denied team access never commit private authorization', async () => {
  await owner();
  const attempt = good(await req('/api/accounts/trace/start', { method: 'POST', body: { email: 'owner@example.com' } }));
  await signals.put('mode', 'wrong-trace-account');
  assert.equal((await req('/api/accounts/trace/verify', { method: 'POST', body: { attempt: attempt.attempt, code: '123456' } })).body.error.code, 'trace_identity_invalid');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM provider_accounts').first()).n, 0);
  await signals.put('mode', '');
  const denied = good(await req('/api/accounts/trace/start', { method: 'POST', body: { email: 'owner@example.com' } }));
  await signals.put('mode', 'trace-restricted');
  assert.equal((await req('/api/accounts/trace/verify', { method: 'POST', body: { attempt: denied.attempt, code: '123456' } })).body.error.code, 'source_access_denied');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM security_account_credentials').first()).n, 0);
  assert.equal((await queued()).length, 0);
});

test('account disconnect is global authorization scope and retains canonical team attachments', async () => {
  await owner();
  const connected = good(await connectTeamSnap((await oauth()).state));
  const domain = new DomainRepository(db), account = connected.account;
  const app = await domain.createTeam({ name: 'User selected team', seasonYear: 2026 });
  await domain.ingestSourcePage({ accountId: account.id, generation: account.generation, records: { teams: [{
    id: 'teamsnap:701', provider: 'teamsnap', native_id: '701', name: 'Verified team', archived: 0,
    details: JSON.stringify({ account_owned: true }), observed_at: new Date().toISOString(),
  }] } });
  const source = await db.prepare('SELECT id FROM source_teams').first();
  const attachment = await domain.attachTeam({ teamId: app.id, seasonId: app.season_id, sourceTeamId: source.id, accountId: account.id });
  const result = good(await req('/api/accounts/' + account.id, { method: 'DELETE' }));
  assert.equal(result.authorization_state, 'disconnected');
  assert.equal((await db.prepare('SELECT active FROM team_source_attachments WHERE id=?').bind(attachment.id).first()).active, 1);
  assert.equal((await db.prepare('SELECT active FROM provider_accounts WHERE id=?').bind(account.id).first()).active, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM security_account_credentials').first()).n, 0);
  assert.equal(good(await req('/api/accounts')).accounts[0].authorization_state, 'disconnected');
});

test('viewer tokens cannot access account/setup/credential surfaces and share replacement revokes previous link', async () => {
  await owner();
  const team = await new DomainRepository(db).createTeam({ name: 'Shared team', seasonYear: 2026 });
  const first = good(await req('/api/teams/' + team.id + '/share', { method: 'POST', body: {} }));
  assert.equal(good(await req('/api/teams/'+team.id+'/share')).viewer_url,first.viewer_url);
  const shared = decodeURIComponent(new URL(first.viewer_url).pathname.slice('/view/'.length));
  for (const route of ['/api/accounts', '/api/accounts/teamsnap/config'])
    assert.equal((await req(route + '?share=' + shared, { headers: { cookie: '' } })).status, 401);
  // Explicit shared mode cannot inherit this valid owner session's privileges.
  for(const route of ['/api/owner/session','/api/accounts','/api/accounts/teamsnap/config','/api/teams/'+team.id+'/share'])
    assert.equal((await req(route,{headers:{'x-view-key':shared}})).status,401);
  for(const route of ['/api/owner/logout','/api/accounts/teamsnap/authorize','/api/accounts/trace/start'])
    assert.equal((await req(route,{method:'POST',body:{},headers:{'x-view-key':shared}})).status,401);
  assert.equal(good(await req('/api/owner/session')).authenticated,true);
  assert.equal((await calls()).length,0);
  const second = good(await req('/api/teams/' + team.id + '/share', { method: 'POST', body: {} }));
  assert.notEqual(first.viewer_url, second.viewer_url);
  await assert.rejects(new SecurityStore(db).viewerPrincipal(shared), (failure) => failure.code === 'share_invalid');
  const replaced = decodeURIComponent(new URL(second.viewer_url).pathname.slice('/view/'.length));
  assert.equal((await new SecurityStore(db).authorizeViewer(replaced, team.id, 'schedule')).role, 'viewer');
});

test('auth HTTP bodies and cross-origin writes are rejected before providers or persistent account writes', async () => {
  await owner();
  assert.equal((await req('/api/accounts/teamsnap/authorize', { method: 'POST', body: {}, headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await req('/api/accounts/trace/start', { method: 'POST', raw: '[]' })).body.error.code, 'json_invalid');
  assert.equal((await req('/api/accounts/trace/start', { method: 'POST', body: { email: 'x'.repeat(5000) } })).status, 413);
  assert.equal((await req('/api/accounts/trace/start', { method: 'POST', raw: '{broken' })).body.error.code, 'json_invalid');
  assert.equal((await calls()).length, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM provider_accounts').first()).n, 0);
});
