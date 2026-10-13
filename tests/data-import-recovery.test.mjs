import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {COACH_SCHEMA} from '../src/coaching/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {DATA_FILE_SCHEMA} from '../src/reporting/data-schema.js';
import {SECURITY_SCHEMA} from '../src/security/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {SyncError} from '../src/sync/errors.js';

const AT = '2026-10-12T12:00:00.000Z';
const ROOT = 'gotsport/public/root';
const IMPORT_PENDING = 'data_import_recovery_pending';
const RECOVERY_PENDING = 'connection_recovery_pending';

// No native worker or mocked coordinator: claims, fenced source writes,
// checkpoints, failures, and connection-dirty triggers execute in SQLite.
// Only Durable Object storage, its clock/alarm, and the recovery consumer are
// deterministic stand-ins. The consumer records the facts it actually sees.
function fixture(t) {
  t.mock.timers.enable({apis:['Date'], now:Date.parse(AT)});
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON;');
  for (const sql of [...DOMAIN_SCHEMA, ...ANALYSIS_SCHEMA, ...COACH_SCHEMA,
    ...TEAM_FEATURE_SCHEMA, ...DATA_FILE_SCHEMA, ...SYNC_SCHEMA, ...SECURITY_SCHEMA]) sqlite.exec(sql);
  const prepared = (sql, params = []) => ({
    sql, params,
    bind(...values) { return prepared(sql, values); },
    async all() {
      const results = sqlite.prepare(sql).all(...params).map(row => ({...row}));
      return {results, meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};
    },
    async first(column) {
      const row = (await this.all()).results[0] ?? null;
      return column ? row?.[column] ?? null : row;
    },
    async run() { return this.all(); },
  });
  const db = {
    prepare:prepared,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.all());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const insert = (table, row) => sqlite.prepare(
    `INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(() => '?')})`,
  ).run(...Object.values(row));
  insert('domain_installation', {id:1, schema_version:1, created_at:AT});
  insert('app_teams', {id:'team', name:'Team', timezone:'UTC', season_year:0, created_at:AT});
  insert('team_read_state', {app_team_id:'team'});
  insert('source_teams', {
    id:ROOT, provider:'gotsport', scope:'public', native_id:'root', name:'Root',
    name_authority:3, archived:0, evidence:'{}', content_hash:'root', observed_at:AT,
  });
  insert('team_source_connections', {
    id:'connection', app_team_id:'team', source_team_id:ROOT,
    scope_mode:'observed_history', input_revision:1, reconciled_revision:1, created_at:AT,
  });

  const values = new Map(), writes = [], collections = [], recoveries = [];
  let alarm = Date.now(), failPut = null;
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) {
      if (failPut?.(key, value)) {
        failPut = null;
        throw new Error('Interrupted after committed import, before durable recovery promotion.');
      }
      writes.push({key, value:structuredClone(value)});
      values.set(key, structuredClone(value));
    },
    async delete(key) { writes.push({key, value:undefined}); return values.delete(key); },
    async getAlarm() { return alarm; },
    async setAlarm(at) { alarm = at; },
    async deleteAlarm() { alarm = null; },
  };
  const collect = async ({lease, args, checkpoint}) => {
    const page = (checkpoint.page || 0) + 1;
    collections.push({resource:lease.resource_key, page, importPending:values.get(IMPORT_PENDING)});
    if (args.failAt === page) throw new SyncError('fixture_import_failure', 'Import interrupted.', {kind:args.failureKind});
    const native = `${lease.resource_key}-${page}`, id = 'gotsport/public/' + native;
    const imported = lease.component === 'data-import';
    return {
      complete:page === args.pages,
      checkpoint:{page},
      rowsSaved:1,
      statements:[
        {
          sql:`INSERT INTO source_events(id,provider,scope,native_id,local_day,time_precision,type,status,conditional,home_source_team_id,home_label,away_label,title,venue,evidence,provenance,content_hash,observed_at)
            SELECT ?,'gotsport','public',?,'2024-08-04','day','game','FINAL',0,?,'Home','Away',?,'Field','{}',?,?,? WHERE $FENCE`,
          params:[id, native, ROOT, native, imported ? 'file_import' : 'provider', native, AT],
        },
        {sql:"INSERT INTO source_event_teams(source_team_id,source_event_id,side) SELECT ?,?,'home' WHERE $FENCE", params:[ROOT, id]},
      ],
    };
  };
  const options = {
    clock:Date.now, pageDelayMs:10, alarmDelayMs:1, runtimeRetryMs:1000,
    retryBaseMs:60000, leaseMs:45000,
    async recoverConnections({db:budgetDb}) {
      const facts = (await budgetDb.prepare('SELECT native_id FROM source_events ORDER BY native_id').all()).results.map(row => row.native_id);
      const dirty = (await budgetDb.prepare('SELECT id,input_revision,reconciled_revision FROM team_source_connections WHERE input_revision>reconciled_revision').all()).results;
      recoveries.push({at:Date.now(), facts, dirty});
      await budgetDb.prepare('UPDATE team_source_connections SET reconciled_revision=input_revision WHERE input_revision>reconciled_revision').run();
      return {processed:dirty.length, more:false};
    },
  };
  const Runtime = createSyncRuntime(collect, options);
  const coordinator = new JobCoordinator(db, options);
  let runtime = new Runtime({storage}, {DB:db});
  const one = (sql, ...params) => ({...sqlite.prepare(sql).get(...params)});
  return {
    db, values, writes, collections, recoveries, one,
    get runtime() { return runtime; },
    get alarm() { return alarm; },
    elapse(ms) { t.mock.timers.tick(ms); },
    restart() { runtime = new Runtime({storage}, {DB:db}); },
    failNextPut(predicate) { failPut = predicate; },
    async enqueue(resource, {pages = 3, provider = 'reports', component = 'data-import', priority = 50, ...args} = {}) {
      return coordinator.enqueue({
        provider, component, stage:component === 'data-import' ? 'export' : 'source',
        scope:'team', resourceKey:resource, args:{pages, ...args}, priority, recurring:false,
      }, [{kind:'team', teamId:'team', key:'data-file/' + resource}]);
    },
    async step() {
      assert.notEqual(alarm, null, 'Outstanding work must have a durable alarm.');
      t.mock.timers.setTime(Math.max(Date.now(), alarm));
      alarm = null; // Durable Object consumes the scheduled alarm before delivery.
      await runtime.alarm();
      const last = values.get('last_run');
      assert.ok(last, 'Each invocation must expose its result.');
      return last;
    },
    facts() { return sqlite.prepare('SELECT native_id FROM source_events ORDER BY native_id').all().map(row => row.native_id); },
    dirty() { return one('SELECT COUNT(*) AS n FROM team_source_connections WHERE input_revision>reconciled_revision').n; },
  };
}

async function expectRun(f, state, resource) {
  const result = await f.step();
  assert.equal(result.state, state, JSON.stringify(result));
  if (resource) assert.equal(result.jobId, resource);
  assert.ok(result.statements <= 48, 'Recovery coalescing must retain the invocation statement ceiling.');
  return result;
}

async function expectSettled(f, facts, recoveries) {
  await expectRun(f, 'recovering_connections');
  assert.equal(f.recoveries.length, recoveries);
  assert.deepEqual(f.recoveries.at(-1).facts, facts);
  assert.ok(f.recoveries.at(-1).dirty.length > 0, 'Recovery must observe saved source demand.');
  assert.deepEqual(f.facts(), facts);
  assert.equal(f.dirty(), 0);
  assert.equal(!!f.values.get(IMPORT_PENDING), false);
  assert.equal(!!f.values.get(RECOVERY_PENDING), false);
  await expectRun(f, 'idle');
  assert.equal(f.alarm, null);
}

test('multiple committed import pages coalesce into one recovery after the final source save', async t => {
  const f = fixture(t), id = await f.enqueue('import');
  for (let page = 1; page <= 3; page++) {
    await expectRun(f, page === 3 ? 'ready' : 'queued', id);
    assert.equal(f.facts().length, page, 'Each real fenced page commits before recovery.');
    assert.equal(f.recoveries.length, 0);
    assert.equal(f.collections.at(-1).importPending, true, 'The deferred obligation must be durable before the collector runs.');
    assert.equal(!!f.values.get(RECOVERY_PENDING), page === 3, 'Intermediate pages must not schedule root recovery.');
    assert.equal(!!f.values.get(IMPORT_PENDING), page !== 3);
  }
  await expectSettled(f, ['import-1', 'import-2', 'import-3'], 1);
});

for (const reason of ['explicit wake', 'provider commit']) test(`${reason} still recovers immediately while import work is deferred`, async t => {
  const f = fixture(t), id = await f.enqueue('import');
  await expectRun(f, 'queued', id);
  if (reason === 'explicit wake') {
    f.elapse(9); // Wake just before the pending page's due alarm.
    assert.deepEqual(await f.runtime.wake(), {queued:true});
  } else {
    const provider = await f.enqueue('provider', {pages:1, provider:'gotsport', component:'event', priority:100});
    await expectRun(f, 'ready', provider);
  }
  assert.equal(f.values.get(RECOVERY_PENDING), true);
  await expectRun(f, 'recovering_connections');
  const firstFacts = reason === 'explicit wake' ? ['import-1'] : ['import-1', 'provider-1'];
  assert.deepEqual(f.recoveries[0].facts, firstFacts);
  assert.equal(f.values.get(IMPORT_PENDING), true, 'An independent recovery must preserve unfinished import demand.');
  await expectRun(f, 'queued', id);
  assert.equal(f.values.get(RECOVERY_PENDING), false);
  await expectRun(f, 'ready', id);
  await expectSettled(f, [...firstFacts.filter(value => value !== 'import-1'), 'import-1', 'import-2', 'import-3'].sort(), 2);
});

for (const [kind, state] of [['permanent', 'failed'], ['blocked', 'blocked'], ['temporary', 'retrying']]) {
  test(`${state} import releases source saves from preceding committed pages`, async t => {
    const f = fixture(t), id = await f.enqueue('import', {pages:3, failAt:3, failureKind:kind});
    await expectRun(f, 'queued', id);
    await expectRun(f, 'queued', id);
    assert.equal(f.recoveries.length, 0);
    await expectRun(f, state, id);
    assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?', id).state, state);
    assert.equal(f.one('SELECT pages_saved FROM sync_jobs WHERE id=?', id).pages_saved, 2);
    assert.equal(f.values.get(RECOVERY_PENDING), true, 'A non-committing terminal/backoff result must release earlier source saves.');
    assert.equal(!!f.values.get(IMPORT_PENDING), false);
    const failedAt = Date.now();
    await expectRun(f, 'recovering_connections');
    assert.deepEqual(f.recoveries[0].facts, ['import-1', 'import-2']);
    assert.equal(f.dirty(), 0);
    assert.ok(Date.now() < failedAt + 60000, 'Recovery must not wait for retry backoff.');
    await expectRun(f, 'idle');
    if (state === 'retrying') assert.equal(f.alarm, f.one('SELECT next_at FROM sync_jobs WHERE id=?', id).next_at);
    else assert.equal(f.alarm, null);
  });
}

test('interruption after final database commit keeps deferred recovery durable until restart promotes it in order', async t => {
  const f = fixture(t), id = await f.enqueue('import', {pages:1});
  f.failNextPut((key, value) => key === RECOVERY_PENDING && value === true);
  await expectRun(f, 'error');
  assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?', id).state, 'ready');
  assert.deepEqual(f.facts(), ['import-1']);
  assert.equal(f.recoveries.length, 0);
  assert.equal(f.values.get(IMPORT_PENDING), true, 'A final committed page cannot lose its recovery obligation during promotion.');
  assert.equal(!!f.values.get(RECOVERY_PENDING), false);
  assert.notEqual(f.alarm, null);
  const before = f.writes.length;
  f.restart();
  await expectRun(f, 'idle');
  assert.equal(f.collections.length, 1, 'Restart must not replay a completed non-recurring import.');
  assert.equal(f.values.get(RECOVERY_PENDING), true);
  assert.equal(!!f.values.get(IMPORT_PENDING), false);
  const writes = f.writes.slice(before);
  const promoted = writes.findIndex(write => write.key === RECOVERY_PENDING && write.value === true);
  const cleared = writes.findIndex(write => write.key === IMPORT_PENDING && !write.value);
  assert.ok(promoted >= 0 && cleared > promoted, 'Persist recovery promotion before clearing the deferred marker.');
  await expectSettled(f, ['import-1'], 1);
});

test('interleaved imports retain eventual recovery when one import finishes before the other', async t => {
  const f = fixture(t);
  const a = await f.enqueue('a', {pages:3, priority:60});
  const b = await f.enqueue('b', {pages:2, priority:50});
  await expectRun(f, 'queued', a);
  await expectRun(f, 'queued', b);
  await expectRun(f, 'queued', a);
  await expectRun(f, 'ready', b);
  assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?', a).state, 'queued');
  assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?', b).state, 'ready');
  await expectRun(f, 'recovering_connections');
  assert.deepEqual(f.recoveries[0].facts, ['a-1', 'a-2', 'b-1', 'b-2']);
  assert.equal(f.dirty(), 0);
  // Recovery may run before a's next page is due. That idle invocation must
  // preserve its already scheduled continuation rather than clear the alarm.
  await expectRun(f, 'idle');
  assert.notEqual(f.alarm, null);
  await expectRun(f, 'ready', a);
  assert.equal(f.collections.at(-1).importPending, true, 'The surviving import must establish fresh durable demand.');
  assert.equal(f.values.get(RECOVERY_PENDING), true);
  await expectSettled(f, ['a-1', 'a-2', 'a-3', 'b-1', 'b-2'], 2);
});
