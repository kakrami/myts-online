import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beginTeamSnapRefresh, finishTeamSnapRefresh, teamSnapRefreshCoverage, TEAMSNAP_FULL_REFRESH_MS, TEAMSNAP_RECENT_PAST_MS, TEAMSNAP_RECENT_FUTURE_MS } from '../src/sources/teamsnap-refresh.js';
import { JobCoordinator } from '../src/sync/coordinator.js';
import { initializeDomain } from '../src/domain/schema.js';
import { installSyncSchema } from '../src/sync/schema.js';
import { collectSource } from '../src/sources/index.js';

const NOW = Date.parse('2026-10-12T18:00:00Z'), INTERVAL = 15 * 60000;
const options = (kind = 'events', extra = {}) => ({ kind, teamId: '321', accountId: 'account', authorizationGeneration: 1,
  endpoint: `https://api.teamsnap.com/v3/${kind === 'events' ? 'events' : 'availabilities'}/search?team_id=321`, args: { team_id: '321', team_name: 'Team' }, now: NOW, ...extra });
const completed = (refresh, now = NOW + 1000, count = 160) => finishTeamSnapRefresh(refresh, { count, pages: Math.max(1, Math.ceil(count / 25)), digest: 'a'.repeat(64), total: count, now });
const parameters = value => Object.fromEntries(new URL(value).searchParams);

test('initial full history is followed by bounded recent runs and a full reconciliation at 24 hours', async () => {
  const initial = await beginTeamSnapRefresh(options());
  assert.equal(initial.refresh.active.mode, 'full');
  assert.deepEqual(parameters(initial.endpoint), { team_id: '321' });
  let checkpoint = completed(initial.refresh);
  const fullReceipt = structuredClone(checkpoint.refresh.full);
  for (const elapsed of [INTERVAL, INTERVAL * 2, INTERVAL * 3, INTERVAL * 95]) {
    const next = await beginTeamSnapRefresh(options('events', { cursor: checkpoint, now: NOW + elapsed }));
    assert.equal(next.refresh.active.mode, 'recent');
    assert.deepEqual(parameters(next.endpoint), { team_id: '321', started_after: new Date(NOW + elapsed - TEAMSNAP_RECENT_PAST_MS).toISOString(), started_before: new Date(NOW + elapsed + TEAMSNAP_RECENT_FUTURE_MS).toISOString() });
    const coverage = teamSnapRefreshCoverage(next.refresh, { complete: true, count: 2, now: NOW + elapsed + 1000 });
    assert.equal(coverage.kind, 'events_recent');
    checkpoint = completed(next.refresh, NOW + elapsed + 1000, 2);
    assert.deepEqual(checkpoint.refresh.full, fullReceipt, 'recent success cannot rewrite full count, digest or timestamp');
    assert.ok(JSON.stringify(checkpoint).length < 8192);
  }
  const full = await beginTeamSnapRefresh(options('events', { cursor: checkpoint, now: NOW + TEAMSNAP_FULL_REFRESH_MS }));
  assert.equal(full.refresh.active.mode, 'full');
  assert.deepEqual(parameters(full.endpoint), { team_id: '321' });
  assert.equal(teamSnapRefreshCoverage(full.refresh, { complete: true, count: 161 }).kind, 'events');
});

test('attendance refresh uses only a frozen date window; an old edit returns on the next full pass', async () => {
  const source = [{ id: 1, at: NOW - 365 * 86400000, status: 'Yes' }, { id: 2, at: NOW - 86400000, status: 'Yes' }, { id: 3, at: NOW + 180 * 86400000, status: 'Yes' }];
  const saved = new Map(), coverage = new Map();
  const ingest = plan => {
    const query = parameters(plan.endpoint);
    assert.equal(query.updated_since, undefined, 'availability updated_since is not a verified capability');
    const rows = source.filter(row => (!query.started_after || row.at > Date.parse(query.started_after)) && (!query.started_before || row.at < Date.parse(query.started_before)));
    rows.forEach(row => saved.set(row.id, row.status));
    const proof = teamSnapRefreshCoverage(plan.refresh, { complete: true, count: rows.length, now: plan.refresh.active.started_at + 1000 });
    coverage.set(proof.kind, proof);
    return completed(plan.refresh, plan.refresh.active.started_at + 1000, rows.length);
  };
  let checkpoint = ingest(await beginTeamSnapRefresh(options('attendance')));
  const fullCoverage = structuredClone(coverage.get('attendance')), fullReceipt = structuredClone(checkpoint.refresh.full);
  source.forEach(row => row.status = 'No');
  for (const elapsed of [INTERVAL, 2 * INTERVAL, 3 * INTERVAL]) {
    const recent = await beginTeamSnapRefresh(options('attendance', { cursor: checkpoint, now: NOW + elapsed }));
    const query = parameters(recent.endpoint);
    assert.equal(Date.parse(query.started_after), NOW + elapsed - TEAMSNAP_RECENT_PAST_MS);
    assert.equal(Date.parse(query.started_before), NOW + elapsed + TEAMSNAP_RECENT_FUTURE_MS);
    checkpoint = ingest(recent);
    assert.deepEqual(checkpoint.refresh.full, fullReceipt);
    assert.deepEqual(coverage.get('attendance'), fullCoverage);
    assert.deepEqual([...saved], [[1, 'Yes'], [2, 'No'], [3, 'Yes']], 'a recent window never deletes retained history or pretends it reread older edits');
  }
  checkpoint = ingest(await beginTeamSnapRefresh(options('attendance', { cursor: checkpoint, now: NOW + TEAMSNAP_FULL_REFRESH_MS })));
  assert.deepEqual([...saved], [[1, 'No'], [2, 'No'], [3, 'No']]);
  assert.equal(checkpoint.refresh.full.started_at, NOW + TEAMSNAP_FULL_REFRESH_MS);
  assert.equal(coverage.get('attendance').count, 3);
});

test('interrupted scans and failed refreshes keep their window, receipts and continuation', async () => {
  for (const kind of ['events', 'attendance']) {
    const initial = await beginTeamSnapRefresh(options(kind));
    const full = completed(initial.refresh);
    const recent = await beginTeamSnapRefresh(options(kind, { cursor: full, now: NOW + INTERVAL }));
    const cursor = { protocol: 'teamsnap-pages-v1', url: recent.endpoint + '&page_number=2', offset: 4, pass: 2, refresh: recent.refresh };
    const original = structuredClone(cursor);
    for (const elapsed of [2 * INTERVAL, 2 * TEAMSNAP_FULL_REFRESH_MS]) {
      const retry = await beginTeamSnapRefresh(options(kind, { cursor, now: NOW + elapsed }));
      assert.deepEqual(retry.cursor, original);
      assert.equal(retry.endpoint, recent.endpoint);
      assert.deepEqual(retry.refresh.full, full.refresh.full);
      assert.equal(retry.refresh.recent, null, 'failed work cannot advance successful freshness');
    }
    const finish = completed(recent.refresh, NOW + 2 * INTERVAL, 3);
    assert.equal(finish.refresh.recent.started_at, NOW + INTERVAL);
    assert.deepEqual(finish.refresh.full, full.refresh.full);
  }
});

test('stale account, team, generation, endpoint or non-URL payload binding restarts full history', async () => {
  const full = completed((await beginTeamSnapRefresh(options())).refresh);
  for (const extra of [{ accountId: 'other' }, { authorizationGeneration: 2 }, { args: { team_id: '321', team_name: 'Renamed' } },
    { teamId: '322', endpoint: 'https://api.teamsnap.com/v3/events/search?team_id=322' }, { endpoint: 'https://api.teamsnap.com/v3/events?team_id=321' }]) {
    const next = await beginTeamSnapRefresh(options('events', { cursor: full, now: NOW + INTERVAL, ...extra }));
    assert.equal(next.refresh.active.mode, 'full');
    assert.equal(next.refresh.full, null);
    assert.deepEqual(next.cursor, {});
  }
  const old = await beginTeamSnapRefresh(options('events', { cursor: { finished: true, offset: 100000 } }));
  assert.equal(old.refresh.active.mode, 'full');
});

test('source URL filters cannot confer full-scan coverage or invent availability update filters', async () => {
  for (const kind of ['events', 'attendance']) {
    const opts = options(kind), endpoint = opts.endpoint + '&updated_since=2099-01-01&started_after=2099-01-01&event_id=9&page_number=99';
    const full = await beginTeamSnapRefresh({ ...opts, endpoint, args: { ...opts.args, url: endpoint } });
    assert.deepEqual(parameters(full.endpoint), { team_id: '321' });
    assert.equal(full.refresh.active.mode, 'full');
  }
  for (const endpoint of ['https://outside.example/v3/events/search?team_id=321', 'https://api.teamsnap.com/v3/events/search?team_id=999', 'https://api.teamsnap.com/v3/events/search?team_id=321&team_id=321', 'https://api.teamsnap.com/v3/events/search?token=secret']) {
    await assert.rejects(beginTeamSnapRefresh(options('events', { endpoint })), { code: 'contract_violation' });
  }
});

test('matching-bound but malformed receipts and altered active filters fail before a request', async () => {
  const full = completed((await beginTeamSnapRefresh(options())).refresh);
  for (const mutate of [receipt => receipt.refresh.full.count = -1, receipt => receipt.refresh.full.completed_at = NOW - 1,
    receipt => receipt.refresh.full.filters = { updated_since: '2099-01-01' }]) {
    const broken = structuredClone(full); mutate(broken);
    await assert.rejects(beginTeamSnapRefresh(options('events', { cursor: broken, now: NOW + INTERVAL })), { code: 'contract_violation' });
  }
  const recent = await beginTeamSnapRefresh(options('events', { cursor: full, now: NOW + INTERVAL }));
  const cursor = { protocol: 'teamsnap-pages-v1', refresh: structuredClone(recent.refresh) };
  cursor.refresh.active.filters.updated_since = '2099-01-01';
  await assert.rejects(beginTeamSnapRefresh(options('events', { cursor, now: NOW + 2 * INTERVAL })), { code: 'contract_violation' });
});

test('production collector refreshes recent events and attendance while old edits wait for full reconciliation', async t => {
  let now = NOW; t.mock.method(Date, 'now', () => now);
  for (const kind of ['events', 'attendance']) {
    now = NOW;
    const source = Array.from({ length: 60 }, (_, index) => ({ id: 1000 + index, team_id: 321,
      start_date: new Date(NOW - (index === 59 ? 1 : 365) * 86400000).toISOString(), updated_at: new Date(NOW - 7 * 86400000).toISOString(),
      ...(kind === 'events' ? { is_game: true, game_type: 'home', name: 'Game ' + index, notes: 'original' } : { event_id: 2000 + index, member_id: 3000, status_code: 1 }) }));
    const calls = [], saved = new Map(), coverage = new Map();
    const transport = { observations: [], async get(value) {
      const u = new URL(value), page = Number(u.searchParams.get('page_number')), size = Number(u.searchParams.get('page_size'));
      assert.equal(u.searchParams.has('updated_since'), false, 'neither collection uses an unverified update-cursor value');
      const selected = source.filter(row => (!u.searchParams.has('started_after') || row.start_date > u.searchParams.get('started_after')) &&
        (!u.searchParams.has('started_before') || row.start_date < u.searchParams.get('started_before')));
      const rows = selected.slice((page - 1) * size, page * size); calls.push({ url: value, count: rows.length });
      return { value: { collection: { items: rows.map(row => ({ data: Object.entries(row).map(([name, value]) => ({ name, value })) })), links: [],
        page_info: { total_items: selected.length, page_size: size, page_number: page } } } };
    } };
    async function scan(cursor = {}) {
      for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
        const page = await collectSource({ provider: 'teamsnap', kind, scope: 'teamsnap:321', args: options(kind).args, cursor, transport,
          credential: 'synthetic-test-only', account: { id: 'account', provider: 'teamsnap', native_id: '123', generation: 1 }, scanId: 'synthetic' });
        assert.deepEqual(page.replacements, [], 'neither refresh scope can replace missing history');
        for (const row of kind === 'events' ? page.fixtures : page.records.attendance) saved.set(kind === 'events' ? row.native_id : row.fixture_id, kind === 'events' ? JSON.parse(row.payload).notes : row.normalized_status);
        page.sourceCoverage.forEach(proof => coverage.set(proof.kind, proof));
        if (page.complete) return page;
        cursor = page.checkpoint;
      }
      throw Error('Synthetic refresh failed to converge');
    }
    const initial = await scan(), initialCalls = calls.length, fullReceipt = structuredClone(initial.checkpoint.refresh.full), fullCoverage = structuredClone(coverage.get(kind));
    assert.equal(saved.size, 60); assert.equal(initial.coverage, 'complete'); assert.equal(initialCalls, 6);
    now += INTERVAL;
    source[0].notes = 'old edit'; source[0].status_code = 0; source[0].updated_at = new Date(now).toISOString();
    source[59].notes = 'recent edit'; source[59].status_code = 0; source[59].updated_at = new Date(now).toISOString();
    const recent = await scan(initial.checkpoint);
    assert.equal(recent.coverage, 'partial'); assert.equal(calls.length - initialCalls, 2);
    assert.deepEqual(recent.checkpoint.refresh.full, fullReceipt); assert.deepEqual(coverage.get(kind), fullCoverage);
    assert.equal(saved.size, 60);
    assert.equal(saved.get(kind === 'events' ? '1000' : 'teamsnap:2000'), kind === 'events' ? 'original' : 'Yes', 'out-of-window edits remain unchanged until full reconciliation');
    assert.equal(saved.get(kind === 'events' ? '1059' : 'teamsnap:2059'), kind === 'events' ? 'recent edit' : 'No');
    now = NOW + TEAMSNAP_FULL_REFRESH_MS;
    const reconciled = await scan(recent.checkpoint);
    assert.equal(reconciled.coverage, 'complete'); assert.equal(reconciled.checkpoint.refresh.full.count, 60);
    assert.equal(saved.get(kind === 'events' ? '1000' : 'teamsnap:2000'), kind === 'events' ? 'old edit' : 'No');
  }
});

async function coordinatorFixture(t) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON'); t.after(() => sqlite.close());
  const prepare = (sql, params = []) => ({ sql, bind: (...values) => prepare(sql, values), async all() { const results = sqlite.prepare(sql).all(...params).map(row => ({ ...row })); return { results, meta: { changes: Number(sqlite.prepare('SELECT changes() n').get().n) } }; }, async first() { return (await this.all()).results[0] || null; }, async run() { return this.all(); } });
  const db = { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  await initializeDomain(db); await installSyncSchema(db);
  await db.prepare("INSERT INTO provider_accounts(id,provider,native_id,name) VALUES('account','teamsnap','123','Synthetic')").run();
  let now = NOW;
  const coordinator = new JobCoordinator(db, { clock: () => now, pageDelayMs: 1 });
  const spec = { provider: 'teamsnap', component: 'events', scope: 'teamsnap:321', resourceKey: 'teamsnap:321', accountId: 'account', accountGeneration: 1, args: options().args, intervalMs: INTERVAL };
  const demand = [{ kind: 'account', key: 'account' }], id = await coordinator.enqueue(spec, demand);
  const receipt = completed((await beginTeamSnapRefresh(options())).refresh);
  const ready = async checkpoint => db.prepare("UPDATE sync_jobs SET state='ready',checkpoint=?,next_at=0,lease_until=0,lease_token=NULL WHERE id=?").bind(JSON.stringify(checkpoint), id).run();
  return { db, coordinator, spec, demand, id, receipt, ready, setNow: value => now = value };
}

test('claim preserves exactly typed TeamSnap terminal receipts and resets all invalid bindings', async t => {
  const h = await coordinatorFixture(t);
  await h.ready(h.receipt); h.setNow(NOW + INTERVAL);
  const claimed = await h.coordinator.claim();
  assert.deepEqual(claimed.checkpoint, h.receipt);
  // Defense in depth even if another writer changes args without the normal
  // coordinator reset: SQL admits the typed shape, then payload hashing forces
  // a full scan before a narrowed provider request can be constructed.
  const changedArgs = { ...h.spec.args, team_name: 'Changed outside normal enqueue' };
  await h.db.prepare('UPDATE sync_jobs SET args=? WHERE id=?').bind(JSON.stringify(changedArgs), h.id).run();
  await h.ready(h.receipt);
  const changedLease = await h.coordinator.claim();
  const changedPlan = await beginTeamSnapRefresh(options('events', { args: changedLease.args, cursor: changedLease.checkpoint, now: NOW + INTERVAL }));
  assert.equal(changedPlan.refresh.active.mode, 'full'); assert.equal(changedPlan.refresh.full, null);
  await h.db.prepare('UPDATE sync_jobs SET args=? WHERE id=?').bind(JSON.stringify(h.spec.args), h.id).run();
  const failures = [value => value.protocol = 'unknown', value => value.finished = false,
    value => value.refresh.protocol = 'unknown', value => value.refresh.binding.account_id = 'other',
    value => value.refresh.binding.authorization_generation = 2, value => value.refresh.binding.team_id = '999',
    value => value.refresh.binding.kind = 'attendance', value => value.refresh.binding.args_url = 'https://api.teamsnap.com/v3/events',
    value => value.refresh.binding.payload = 'not-a-hash', value => value.refresh.active = {}, value => value.refresh.full = null];
  for (const mutate of failures) {
    const invalid = structuredClone(h.receipt); mutate(invalid); await h.ready(invalid);
    assert.deepEqual((await h.coordinator.claim()).checkpoint, {});
  }
  for (const component of ['roster', 'catalog', 'locations']) {
    await h.db.prepare('UPDATE sync_jobs SET component=? WHERE id=?').bind(component, h.id).run(); await h.ready(h.receipt);
    assert.deepEqual((await h.coordinator.claim()).checkpoint, {});
  }
  await h.db.prepare("UPDATE sync_jobs SET provider='trace',component='events' WHERE id=?").bind(h.id).run();
  await h.db.prepare("UPDATE provider_accounts SET provider='trace' WHERE id='account'").run(); await h.ready(h.receipt);
  assert.deepEqual((await h.coordinator.claim()).checkpoint, {});
});

test('changed args, manual refresh and authorization restart clear saved full-history receipts', async t => {
  const h = await coordinatorFixture(t);
  await h.ready(h.receipt);
  await h.coordinator.enqueue({ ...h.spec, args: { ...h.spec.args, team_name: 'Renamed' } }, h.demand);
  assert.deepEqual((await h.coordinator.claim()).checkpoint, {});
  await h.ready(h.receipt);
  await h.coordinator.enqueueMany([{ ...h.spec, args: { ...h.spec.args, team_name: 'Renamed' } }], h.demand, { refresh: true });
  assert.deepEqual((await h.coordinator.claim()).checkpoint, {});
  await h.ready(h.receipt);
  await h.db.prepare("UPDATE provider_accounts SET generation=2 WHERE id='account'").run();
  await h.coordinator.restartAccount('account');
  const renewed = await h.coordinator.claim();
  assert.deepEqual(renewed.checkpoint, {}); assert.equal(renewed.authorization_generation, 2);
});

test('normal connection refresh recovers permanent record_too_large jobs without replacing account, root or job identities', async t => {
  const h = await coordinatorFixture(t), at = new Date(NOW).toISOString();
  await h.db.prepare("INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES('team','Team','UTC',2026,?)").bind(at).run();
  await h.db.prepare("INSERT INTO team_read_state(app_team_id) VALUES('team')").run();
  await h.db.prepare("INSERT INTO source_teams(id,provider,scope,account_id,native_id,name,name_authority,archived,evidence,content_hash,observed_at) VALUES('source','teamsnap','account','account','321','Team',1,0,'{}','synthetic',?)").bind(at).run();
  await h.db.prepare("INSERT INTO account_source_teams(account_id,source_team_id) VALUES('account','source')").run();
  await h.db.prepare("INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,created_at) VALUES('root','team','source','account','observed_history',?)").bind(at).run();
  const demand = [{ kind: 'team', key: 'connection:root', teamId: 'team', generation: 1 }];
  const beforeAccount = await h.db.prepare("SELECT * FROM provider_accounts WHERE id='account'").first();
  const beforeRoot = await h.db.prepare("SELECT * FROM team_source_connections WHERE id='root'").first();
  for (const kind of ['events', 'attendance']) {
    const spec = { ...h.spec, component: kind }, id = await h.coordinator.enqueue(spec, demand);
    await h.db.prepare("DELETE FROM sync_job_subscribers WHERE job_id=? AND kind='account'").bind(id).run();
    for (const checkpoint of [{}, { url: options(kind).endpoint, offset: 5000, digest: 'legacy-whole-response', visited: ['old-page'] },
      { protocol: 'teamsnap-pages-v1', url: options(kind).endpoint + '&page_number=7', offset: 4 }]) {
      await h.db.prepare("UPDATE sync_jobs SET state='failed',failure_kind='permanent',last_error_code='record_too_large',checkpoint=?,lease_token=NULL,lease_until=0 WHERE id=?").bind(JSON.stringify(checkpoint), id).run();
      // This is the production syncConnection(refresh:true) queue operation.
      const refreshed = await h.coordinator.enqueueMany([spec], demand, { refresh: true });
      assert.deepEqual(refreshed, [id]);
      const lease = await h.coordinator.claim();
      assert.equal(lease.id, id); assert.equal(lease.account_id, 'account'); assert.equal(lease.authorization_generation, 1);
      const plan = await beginTeamSnapRefresh(options(kind, { args: lease.args, cursor: lease.checkpoint }));
      assert.equal(plan.refresh.active.mode, 'full'); assert.equal(plan.refresh.full, null);
      assert.deepEqual(plan.cursor, {}, 'legacy offsets cannot skip rows in the new bounded traversal');
      assert.deepEqual(parameters(plan.endpoint), { team_id: '321' });
      assert.deepEqual(await h.db.prepare("SELECT * FROM provider_accounts WHERE id='account'").first(), beforeAccount);
      assert.deepEqual(await h.db.prepare("SELECT * FROM team_source_connections WHERE id='root'").first(), beforeRoot);
      assert.equal((await h.db.prepare("SELECT job_id FROM sync_job_subscribers WHERE job_id=? AND demand_key='connection:root'").bind(id).first()).job_id, id);
      assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM provider_accounts').first()).n, 1);
      assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM team_source_connections').first()).n, 1);
    }
  }
  assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE provider='teamsnap' AND component IN('events','attendance')").first()).n, 2);
});

test('full TeamSnap verification yields to new and existing roots without changing stored priority or recent scans', async t => {
  const h=await coordinatorFixture(t),at=new Date(NOW).toISOString();
  await h.db.prepare("INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES('team','Team','UTC',2026,?)").bind(at).run();
  await h.db.prepare("INSERT INTO team_read_state(app_team_id) VALUES('team')").run();
  await h.db.prepare("INSERT INTO source_teams(id,provider,scope,account_id,native_id,name,name_authority,archived,evidence,content_hash,observed_at) VALUES('source','teamsnap','account','account','321','Team',1,0,'{}','synthetic',?)").bind(at).run();
  await h.db.prepare("INSERT INTO account_source_teams(account_id,source_team_id) VALUES('account','source')").run();
  await h.db.prepare("INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,created_at) VALUES('root','team','source','account','observed_history',?)").bind(at).run();
  const rootId=await h.coordinator.enqueue({provider:'domain',component:'connection',stage:'projection',scope:'team',resourceKey:'root',args:{connectionId:'root',teamId:'team',generation:1,inputRevision:0},priority:90,recurring:false},[{kind:'team',key:'connection:root',teamId:'team',generation:1}]);
  const refresh=(await beginTeamSnapRefresh(options())).refresh;
  const checkpoint={protocol:'teamsnap-pages-v1',pass:2,previous:{digest:'a'.repeat(64),pages:7,count:160,total:160},refresh};
  async function claim(cursor,priority=90){
    await h.db.prepare("UPDATE sync_jobs SET state='queued',lease_token=NULL,lease_until=0,next_at=0,ready_since=?,priority=CASE WHEN id=? THEN 97 ELSE ? END,checkpoint=CASE WHEN id=? THEN ? ELSE '{}' END WHERE id IN(?,?)").bind(NOW,h.id,priority,h.id,JSON.stringify(cursor),h.id,rootId).run();
    return h.coordinator.claim();
  }
  for(const rootPriority of [90,20]){assert.equal((await claim(checkpoint,rootPriority)).id,rootId);assert.equal((await h.db.prepare('SELECT priority FROM sync_jobs WHERE id=?').bind(h.id).first()).priority,97);}
  const variants=[{}, {...checkpoint,pass:1,previous:null}, {...checkpoint,previous:{...checkpoint.previous,digest:'invalid'}}, {...checkpoint,refresh:{...refresh,active:{...refresh.active,mode:'recent'}}}, {...checkpoint,refresh:{...refresh,binding:{...refresh.binding,account_id:'other'}}}, {...checkpoint,refresh:{...refresh,binding:{...refresh.binding,authorization_generation:2}}}];
  for(const cursor of variants)assert.equal((await claim(cursor)).id,h.id,'first, recent, old and invalid scans retain ordinary source scheduling');
  await claim(checkpoint,20);await h.db.prepare("UPDATE sync_jobs SET state='ready',lease_token=NULL,lease_until=0 WHERE id=?").bind(rootId).run();
  assert.equal((await h.coordinator.claim()).id,h.id,'verification remains runnable after local work drains');
});
