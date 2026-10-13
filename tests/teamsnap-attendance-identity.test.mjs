import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSource, SourceTransport } from '../src/sources/index.js';
import { collection } from '../src/sources/teamsnap.js';
import { native, hash } from '../src/sources/common.js';
import { unique } from '../src/sources/http.js';
import { beginTeamSnapRefresh, finishTeamSnapRefresh, TEAMSNAP_FULL_REFRESH_MS } from '../src/sources/teamsnap-refresh.js';
import { classifyFailure } from '../src/sync/errors.js';

const ACCOUNT = { id: 'synthetic-account', provider: 'teamsnap', native_id: '123', generation: 1 };
const TEAM = '321', NOW = Date.parse('2026-10-12T18:00:00Z');
const row = (i, extra = {}) => ({ id: `${100 + i}-${4000 + i}`, team_id: 321, event_id: 4000 + i, member_id: 100 + i, status_code: i % 3, ...extra });
const pair = r => `${native(r.event_id)}:${native(r.member_id)}`;
const dtoPair = r => `${r.fixture_id.slice(9)}:${r.player_id.slice(9)}`;
const semantics = ({ observed_at, ...record }) => record;
const storedSemantics = ({ fixture_id, player_id, team_id, account_id, status, normalized_status }) => ({ fixture_id, player_id, team_id, account_id, status, normalized_status });
const payload = (rows, info, extra = {}) => ({ collection: { items: rows.map(r => {
  const { item_href, item_links, ...fields } = r;
  return { data: Object.entries(fields).map(([name, value]) => ({ name, value })), ...(item_href ? { href: item_href } : {}), ...(item_links ? { links: item_links } : {}) };
}), links: [], ...(info ? { page_info: info } : {}), ...extra } });
function harness(initial, { kind = 'attendance', mutate, account = ACCOUNT, teamId = TEAM } = {}) {
  const requests = [], observations = [];
  let rows = initial;
  return { requests, observations, async step(cursor = {}, override = {}) {
    const currentAccount = override.account || account, currentTeam = override.teamId || teamId;
    const transport = new SourceTransport({}, { fetch: async endpoint => {
      const u = new URL(endpoint), number = Number(u.searchParams.get('page_number')), size = Number(u.searchParams.get('page_size'));
      requests.push({ number, size, url: u.href });
      if (mutate) rows = mutate(rows, { number, size, requests }) || rows;
      const selected = rows.slice((number - 1) * size, number * size);
      return Response.json(payload(selected, { total_items: rows.length, page_size: size, page_number: number }));
    } });
    try { return await collectSource({ provider: 'teamsnap', kind, scope: 'teamsnap:' + currentTeam,
      args: { team_id: currentTeam }, cursor, transport, credential: 'synthetic-only', account: currentAccount, scanId: 'synthetic-scan' }); }
    finally { observations.push(...transport.observations); }
  } };
}
async function drain(h, cursor = {}, limit = 100) {
  const saved = new Map();
  for (let i = 0; i < limit; i++) {
    const page = await h.step(cursor);
    for (const r of page.records.attendance || []) saved.set(`${r.account_id}|${r.team_id}|${dtoPair(r)}`, r);
    if (page.complete) return { saved, page };
    cursor = page.checkpoint;
  }
  throw Error('Synthetic traversal did not converge');
}
const options = (kind = 'attendance', extra = {}) => ({ kind, teamId: TEAM, accountId: ACCOUNT.id, authorizationGeneration: 1,
  endpoint: `https://api.teamsnap.com/v3/${kind === 'attendance' ? 'availabilities' : 'events'}/search?team_id=${TEAM}`,
  args: { team_id: TEAM }, now: NOW, ...extra });
const finish = (refresh, now = NOW + 1000) => finishTeamSnapRefresh(refresh, { count: 50, pages: 2, digest: 'a'.repeat(64), total: 50, now });

test('synthetic reproduction of live 25-invalid-ID/25-valid-pair signature turns green without claiming live IDs', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(i));
  const decoded = collection(payload(rows));
  assert.throws(() => unique(decoded, r => native(r.id)), { code: 'contract_violation' }, 'the old native availability-ID guard rejects this exact diagnostic shape');
  assert.equal(decoded.filter(r => !native(r.id)).length, 25);
  assert.equal(new Set(decoded.filter(r => native(r.id)).map(r => native(r.id))).size, 0);
  assert.equal(decoded.filter(r => native(r.event_id) && native(r.member_id)).length, 25);
  assert.equal(new Set(decoded.map(pair)).size, 25);
  const h = harness(rows), result = await drain(h);
  assert.deepEqual(h.requests.map(r => r.number), [1, 1]);
  assert.equal(result.saved.size, 25); assert.equal(result.page.sourceCoverage[0].count, 25);
  assert.equal(result.page.checkpoint.refresh.full.count, 25);
  assert.ok(h.observations.every(o => o.status === 200 && o.code === null));
});

test('opaque, missing, null, duplicate and changing numeric top-level IDs are irrelevant to pair identity', async () => {
  const rows = [row(0, { id: undefined }), row(1, { id: null }), row(2, { id: 'opaque' }), row(3, { id: 12 }), row(4, { id: '12' })];
  const h = harness(rows, { mutate: (list, { requests }) => list.map((r, i) => ({ ...r, id: requests.length % 2 ? r.id : (i % 2 ? null : 900 + i) })) });
  const { saved, page } = await drain(h);
  assert.equal(saved.size, 5); assert.equal(h.requests.length, 2); assert.equal(page.checkpoint.refresh.full.count, 5);
  for (const r of saved.values()) assert.deepEqual(Object.keys(r).sort(), ['account_id', 'evidence', 'fixture_id', 'native_status', 'normalized_status', 'observed_at', 'player_id', 'status', 'team_id'].sort());
});

test('pair IDs keep the strict numeric contract and foreign team records remain rejected without requiring collected references', async () => {
  for (const field of ['event_id', 'member_id']) for (const value of [undefined, null, '', 0, -1, '01', '2-3', ' 1', '1234567890123456', true, {}, [], [1]]) {
    await assert.rejects(() => harness([row(0, { [field]: value })]).step(), { code: 'unsupported_response' });
  }
  for (const value of [322, '322', 'opaque', '0321', false, {}, [], [321]]) {
    await assert.rejects(() => harness([row(0, { team_id: value })]).step(), e => e.code === 'contract_violation' && e.teamsnapDiagnostic?.reason === 'attendance_team_scope' && e.teamsnapDiagnostic.counts.foreign_teams === 1);
  }
  for (const value of [321, '321', null, undefined]) {
    const page = await harness([row(0, { team_id: value, event_id: '999999999999999', member_id: 999999999999998 })]).step();
    assert.equal(page.records.attendance.length, 1); assert.equal(page.records.attendance[0].fixture_id, 'teamsnap:999999999999999');
  }
});

test('same-page repeated numeric/string pairs and conflicting statuses fail before any page can be returned', async () => {
  for (const status of [0, 1, 2, null, 'private-status']) {
    const rows = [row(0, { id: 10, status_code: 1 }), row(0, { id: 11, event_id: '4000', member_id: '100', status_code: status })];
    await assert.rejects(() => harness(rows).step(), e => {
      const failure = classifyFailure(e);
      assert.equal(e.teamsnapDiagnostic?.reason, 'attendance_duplicate_pair');
      assert.deepEqual(e.teamsnapDiagnostic.counts, { items: 2, valid_pairs: 2, duplicate_pairs: 1 });
      assert.ok(!failure.message.includes('private-status')); assert.ok(!failure.message.includes('4000'));
      return e.code === 'contract_violation';
    });
  }
  // A duplicate beyond a would-be local byte slice must still reject the entire provider page.
  const large = Array.from({ length: 25 }, (_, i) => row(i, { status_code: 'x'.repeat(7000) }));
  large[24] = { ...large[0], id: 9000 };
  await assert.rejects(() => harness(large).step(), e => e.teamsnapDiagnostic?.reason === 'attendance_duplicate_pair');
});

test('multiple provider pages retain all pairs and require two full ordered traversals', async () => {
  const rows = Array.from({ length: 67 }, (_, i) => row(i, { id: i % 2 ? null : 'same-id' }));
  const h = harness(rows), { saved, page } = await drain(h);
  assert.equal(saved.size, 67); assert.deepEqual(h.requests.map(r => r.number), [1, 2, 3, 1, 2, 3]);
  assert.equal(page.coverage, 'complete'); assert.equal(page.sourceCoverage[0].count, 67); assert.equal(page.checkpoint.refresh.full.pages, 3);
});

test('previous IDs and the bounded eight-page repeat ring use canonical pair keys', async () => {
  const rows = Array.from({ length: 251 }, (_, i) => row(i));
  const h = harness(rows); let cursor = {};
  for (let number = 1; number <= 10; number++) {
    const page = await h.step(cursor); cursor = page.checkpoint;
    const ids = rows.slice((number - 1) * 25, number * 25).map(pair);
    assert.deepEqual(cursor.previous_ids, ids);
    assert.equal(cursor.page_hashes.at(-1), await hash([...ids].sort()));
    assert.equal(cursor.page_hashes.length, Math.min(number, 8));
    assert.ok(JSON.stringify(cursor).length < 8192);
  }
});

test('adjacent pair overlap and nonadjacent pair-page repeats cannot inflate completeness even when availability IDs change', async () => {
  const first = Array.from({ length: 25 }, (_, i) => row(i)), second = Array.from({ length: 25 }, (_, i) => row(100 + i));
  for (const rows of [[...first, ...first], [...first, ...second, ...first], [...first, ...Array.from({ length: 25 }, (_, i) => row(20 + i))]]) {
    const h = harness(rows, { mutate: (list, { requests }) => list.map((r, i) => ({ ...r, id: 100000 * requests.length + i })) });
    let cursor = {}, completed = false, discarded = 0;
    for (let attempt = 0; attempt < 15; attempt++) {
      let page; try { page = await h.step(cursor); } catch (e) { assert.equal(e.code, 'source_changing'); break; }
      completed ||= page.complete; if (!page.records.attendance?.length) discarded++;
      cursor = page.checkpoint;
    }
    assert.equal(completed, false); assert.equal(discarded, 3); assert.ok(cursor.retry_at > Date.now()); assert.ok(h.requests.length <= 9);
  }
});

test('local byte slices restart for normalized semantic changes and lost replies replay the same pair prefix', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(i, { status_code: 'x'.repeat(7000) })), h = harness(rows);
  const first = await h.step(); assert.ok(first.checkpoint.offset > 0 && first.checkpoint.offset < 25);
  const replay = await h.step(); assert.deepEqual(first.records.attendance.map(semantics), replay.records.attendance.map(semantics));
  rows[0].status_code = 'y'.repeat(7000);
  const changed = await h.step(first.checkpoint);
  assert.equal(changed.records.attendance[0].fixture_id, 'teamsnap:4000');
  assert.equal(changed.records.attendance[0].status, 'y'.repeat(7000));
  assert.equal(changed.checkpoint.offset, first.checkpoint.offset); assert.notEqual(changed.checkpoint.digest, first.checkpoint.digest);
  const { saved, page } = await drain(h, changed.checkpoint);
  assert.equal(saved.size, 25); assert.equal(page.checkpoint.refresh.full.count, 25);
});

test('local byte slices continue through unused metadata changes but inspect every pair and team on reread', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(i, { status_code: 'x'.repeat(7000) })), h = harness(rows);
  const first = await h.step(); const offset = first.checkpoint.offset;
  for (const r of rows) { r.id = null; r.item_href = 'https://api.teamsnap.com/v3/availabilities/changed'; r.unused = 'new metadata'; }
  const resumed = await h.step(first.checkpoint);
  assert.equal(resumed.records.attendance[0].fixture_id, 'teamsnap:' + (4000 + offset));
  assert.equal(resumed.checkpoint.digest, first.checkpoint.digest); assert.ok(resumed.checkpoint.offset > offset);
  rows[0].event_id = 'invalid';
  await assert.rejects(() => h.step(resumed.checkpoint), { code: 'unsupported_response' });
  rows[0].event_id = 4000; rows[0].team_id = 322;
  await assert.rejects(() => h.step(resumed.checkpoint), e => e.teamsnapDiagnostic?.reason === 'attendance_team_scope');
});

test('ordered attendance digest covers exact persisted statuses and excludes generated times, raw-type differences and unused metadata', async () => {
  const rows = [row(0, { status_code: 1 }), row(1, { status_code: 9 })];
  const h = harness(rows), first = await h.step();
  const expected = await hash([null, 1, 2, await hash(first.records.attendance.map(storedSemantics))]);
  assert.equal(first.checkpoint.previous.digest, expected);
  rows[1].status_code = 10; // Both are Unknown, but the persisted source_status changes.
  const changed = await h.step(first.checkpoint); assert.equal(changed.complete, false); assert.notEqual(changed.checkpoint.previous.digest, expected);
  rows[0].status_code = '1'; // Same stored Yes/source_status despite different DTO native/evidence types.
  rows[0].id = 'changed'; rows[0].item_href = 'https://api.teamsnap.com/v3/availabilities/new'; rows[1].unused = 7;
  const settled = await h.step(changed.checkpoint); assert.equal(settled.complete, true); assert.equal(h.requests.length, 3);
  const equivalent = harness([row(0, { status_code: 1 })], { mutate: (list, { requests }) => requests.length === 2 ? [{ ...list[0], status_code: '1' }] : list });
  await drain(equivalent); assert.equal(equivalent.requests.length, 2, 'representation-only status changes preserve convergence');
  const reordered = harness([row(0), row(1)], { mutate: (list, { requests }) => requests.length === 2 ? [...list].reverse() : list });
  await drain(reordered); assert.equal(reordered.requests.length, 3, 'row order remains convergence evidence');
});

test('status changes outside the local slice also invalidate page digest and require a matching traversal', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(i, { status_code: 'x'.repeat(7000) })), h = harness(rows);
  const first = await h.step(); rows[24].status_code = 'z'.repeat(7000);
  const changed = await h.step(first.checkpoint);
  assert.equal(changed.records.attendance[0].fixture_id, 'teamsnap:4000');
  assert.notEqual(changed.checkpoint.digest, first.checkpoint.digest);
  const { saved } = await drain(h, changed.checkpoint);
  assert.equal(saved.size, 25); assert.equal([...saved.values()].find(r => r.fixture_id === 'teamsnap:4024').status, 'z'.repeat(7000));
});

test('legacy active and completed attendance proofs migrate once to a fresh full traversal without mutating input', async () => {
  const initial = await beginTeamSnapRefresh(options()), terminal = finish(initial.refresh);
  const recent = await beginTeamSnapRefresh(options('attendance', { cursor: terminal, now: NOW + 900000 }));
  const active = { protocol: 'teamsnap-pages-v1', url: 'old-page-9', offset: 7, count: 999, previous_ids: ['old-id'], refresh: recent.refresh };
  for (const original of [active, terminal]) {
    const old = structuredClone(original); delete old.refresh.binding.identity_version;
    const before = JSON.stringify(old), renewed = await beginTeamSnapRefresh(options('attendance', { cursor: old, now: NOW + 1800000 }));
    assert.equal(JSON.stringify(old), before); assert.deepEqual(renewed.cursor, {});
    assert.equal(renewed.refresh.active.mode, 'full'); assert.deepEqual(renewed.refresh.active.filters, {});
    assert.equal(renewed.refresh.full, null); assert.equal(renewed.refresh.recent, null);
    assert.equal(renewed.refresh.binding.identity_version, 'event-member-v1');
    const newCursor = { protocol: 'teamsnap-pages-v1', offset: 3, refresh: renewed.refresh };
    const resumed = await beginTeamSnapRefresh(options('attendance', { cursor: newCursor, now: NOW + TEAMSNAP_FULL_REFRESH_MS + 1 }));
    assert.equal(resumed.cursor, newCursor); assert.equal(resumed.refresh, renewed.refresh);
    const done = finish(renewed.refresh, NOW + 1801000);
    const next = await beginTeamSnapRefresh(options('attendance', { cursor: done, now: NOW + 2700000 }));
    assert.equal(next.refresh.active.mode, 'recent'); assert.deepEqual(next.refresh.full, done.refresh.full);
  }
});

test('new attendance recent resumes keep their exact frozen window and bound account/team changes cannot reuse a cursor', async () => {
  const full = finish((await beginTeamSnapRefresh(options())).refresh);
  const recent = await beginTeamSnapRefresh(options('attendance', { cursor: full, now: NOW + 900000 }));
  const cursor = { protocol: 'teamsnap-pages-v1', offset: 3, refresh: recent.refresh };
  const resumed = await beginTeamSnapRefresh(options('attendance', { cursor, now: NOW + TEAMSNAP_FULL_REFRESH_MS + 900000 }));
  assert.equal(resumed.cursor, cursor); assert.deepEqual(resumed.refresh.active, recent.refresh.active); assert.equal(resumed.endpoint, recent.endpoint);
  for (const extra of [{ accountId: 'other-account' }, { authorizationGeneration: 2 }, { teamId: '322', args: { team_id: '322' }, endpoint: 'https://api.teamsnap.com/v3/availabilities/search?team_id=322' }]) {
    const next = await beginTeamSnapRefresh(options('attendance', { cursor, now: NOW + 1800000, ...extra }));
    assert.deepEqual(next.cursor, {}); assert.equal(next.refresh.active.mode, 'full'); assert.equal(next.refresh.full, null);
  }
  const rows = Array.from({ length: 30 }, (_, i) => row(i)), h = harness(rows), first = await h.step();
  const other = await h.step(first.checkpoint, { account: { ...ACCOUNT, id: 'other-account' } });
  assert.equal(h.requests.at(-1).number, 1); assert.ok(other.records.attendance.every(r => r.account_id === 'other-account'));
  rows.forEach(r => { r.team_id = 322; });
  const nextTeam = await h.step(first.checkpoint, { teamId: '322' });
  assert.equal(h.requests.at(-1).number, 1); assert.ok(nextTeam.records.attendance.every(r => r.team_id === 'teamsnap:322'));
});

test('events retain exact legacy binding, raw-row rolling digest, numeric-ID guard and full/recent receipt behavior', async () => {
  const plan = await beginTeamSnapRefresh(options('events'));
  assert.deepEqual(plan.refresh.binding, { kind: 'events', team_id: TEAM, account_id: ACCOUNT.id, authorization_generation: 1,
    args_url: null, payload: await hash({ team_id: TEAM }), source: options('events').endpoint });
  const full = finish(plan.refresh), next = await beginTeamSnapRefresh(options('events', { cursor: full, now: NOW + 900000 }));
  assert.equal(next.refresh.active.mode, 'recent'); assert.deepEqual(next.refresh.full, full.refresh.full);
  const recent = finish(next.refresh, NOW + 901000); assert.deepEqual(recent.refresh.full, full.refresh.full);
  assert.equal((await beginTeamSnapRefresh(options('events', { cursor: recent, now: NOW + TEAMSNAP_FULL_REFRESH_MS }))).refresh.active.mode, 'full');
  const rows = [{ id: 4000, team_id: 321, start_date: '2026-09-01T18:00:00Z', is_game: true, name: 'Synthetic game' }];
  const h = harness(rows, { kind: 'events' }), page = await h.step();
  assert.equal(page.checkpoint.previous.digest, await hash([null, 1, 1, await hash(collection(payload(rows)))]));
  rows[0].id = '100-4000'; await assert.rejects(() => h.step(), { code: 'contract_violation' });
});
