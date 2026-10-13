import { hash, native, requireValue } from './common.js';

export const TEAMSNAP_REFRESH_PROTOCOL = 'teamsnap-refresh-v1';
export const TEAMSNAP_FULL_REFRESH_MS = 24 * 60 * 60 * 1000;
export const TEAMSNAP_RECENT_PAST_MS = 30 * 86400000;
export const TEAMSNAP_RECENT_FUTURE_MS = 90 * 86400000;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = (value, now) => integer(value) && value <= now + 60000;
const digest = value => /^[a-f0-9]{64}$/.test(value || '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const iso = value => new Date(value).toISOString();

function sourceEndpoint(kind, teamId, value) {
  const rel = kind === 'events' ? 'events' : 'availabilities', source = new URL(value);
  requireValue(source.origin === 'https://api.teamsnap.com' && !source.username && !source.password && !source.hash &&
    ['/v3/' + rel, '/v3/' + rel + '/search'].includes(source.pathname), 'TeamSnap refresh endpoint changed.');
  requireValue([...source.searchParams.keys()].every((key, index, keys) => keys.indexOf(key) === index && !/token|password|secret|credential|authorization|cookie/i.test(key)), 'TeamSnap refresh query is ambiguous.');
  requireValue(!source.searchParams.has('team_id') || source.searchParams.get('team_id') === teamId, 'TeamSnap refresh belongs to another team.');
  // A provider link or imported argument cannot narrow an authoritative scan.
  // Build its scope locally; only this module may add incremental filters.
  source.search = '';
  source.searchParams.set('team_id', teamId);
  return source.href;
}

function filters(mode, startedAt) {
  if (mode === 'full') return {};
  // Official TeamSnapSDK schemas.json exposes these event-date filters for
  // both collections. Event updated_since exists, but its value semantics are
  // unverified, so changes outside this window wait for a full reconciliation.
  return { started_after: iso(Math.max(0, startedAt - TEAMSNAP_RECENT_PAST_MS)), started_before: iso(startedAt + TEAMSNAP_RECENT_FUTURE_MS) };
}

function validReceipt(receipt, mode, now) {
  return receipt && receipt.mode === mode && timestamp(receipt.started_at, now) && timestamp(receipt.completed_at, now) &&
    receipt.started_at <= receipt.completed_at && integer(receipt.count) && integer(receipt.pages) && receipt.pages > 0 &&
    digest(receipt.digest) && (receipt.total === null || integer(receipt.total) && receipt.total === receipt.count) &&
    receipt.filters && typeof receipt.filters === 'object' && !Array.isArray(receipt.filters);
}

function validateRefresh(refresh, now) {
  requireValue(refresh.full === null || validReceipt(refresh.full, 'full', now) && same(refresh.full.filters, {}), 'Invalid TeamSnap full-history receipt.');
  requireValue(refresh.recent === null || validReceipt(refresh.recent, 'recent', now) && refresh.full && refresh.recent.started_at >= refresh.full.started_at,
    'Invalid TeamSnap recent-refresh receipt.');
  if (refresh.active !== null) {
    const active = refresh.active;
    requireValue(active && ['full', 'recent'].includes(active.mode) && timestamp(active.started_at, now) &&
      (active.mode === 'full' || refresh.full) && (!refresh.full || active.started_at >= refresh.full.started_at) &&
      (!refresh.recent || active.started_at >= refresh.recent.started_at) &&
      same(active.filters, filters(active.mode, active.started_at)),
    'Invalid TeamSnap refresh window.');
  } else requireValue(refresh.full, 'TeamSnap completion lacks a full-history receipt.');
}

/** Refresh authority is generated server-side from the current account and
 * full job payload. Neither URL arguments nor old checkpoints supply filters.
 * Active work retains its exact window across retries and verification passes.
 */
export async function beginTeamSnapRefresh({ kind, teamId, accountId, authorizationGeneration = 0, endpoint, args = {}, cursor = {}, now = Date.now() }) {
  requireValue(['events', 'attendance'].includes(kind) && native(teamId) === teamId && typeof accountId === 'string' && accountId &&
    integer(authorizationGeneration) && timestamp(now, now), 'Invalid TeamSnap refresh identity.');
  const source = sourceEndpoint(kind, teamId, endpoint);
  const binding = { kind, team_id: teamId, account_id: accountId, authorization_generation: authorizationGeneration,
    args_url: typeof args.url === 'string' ? args.url : null, payload: await hash(args), source,
    // Legacy attendance counts used availability IDs and could exceed distinct
    // stored pairs. Revalidate those active/completed proofs once with a full
    // page-one scan. Event bindings and receipts remain byte-for-byte unchanged.
    ...(kind === 'attendance' ? { identity_version: 'event-member-v1' } : {}) };
  const saved = cursor.refresh;
  const matches = saved?.protocol === TEAMSNAP_REFRESH_PROTOCOL && same(saved.binding, binding);
  let refresh = matches ? saved : { protocol: TEAMSNAP_REFRESH_PROTOCOL, binding, full: null, recent: null, active: null };
  if (matches) validateRefresh(refresh, now);
  const resume = matches && !cursor.finished && refresh.active !== null;
  if (!resume) {
    const mode = !refresh.full || now >= refresh.full.started_at + TEAMSNAP_FULL_REFRESH_MS ? 'full' : 'recent';
    refresh = { ...refresh, active: { mode, started_at: now, filters: filters(mode, now) } };
  }
  const request = new URL(source);
  for (const [key, value] of Object.entries(refresh.active.filters)) request.searchParams.set(key, value);
  return { endpoint: request.href, cursor: resume ? cursor : {}, refresh };
}

/** Only a verified terminal traversal can advance either freshness receipt. */
export function finishTeamSnapRefresh(refresh, { count, pages, digest: traversalDigest, total = null, now = Date.now() }) {
  validateRefresh(refresh, now);
  requireValue(refresh.active, 'TeamSnap refresh is already finished.');
  const receipt = { ...refresh.active, completed_at: now, count, pages, digest: traversalDigest, total };
  requireValue(validReceipt(receipt, refresh.active.mode, now), 'Invalid TeamSnap completed traversal.');
  const completed = refresh.active.mode === 'full' ? { ...refresh, full: receipt, recent: null, active: null } : { ...refresh, recent: receipt, active: null };
  return { finished: true, protocol: TEAMSNAP_REFRESH_PROTOCOL, refresh: completed };
}

/** Recent counts are a different scope and never overwrite all-history proof. */
export function teamSnapRefreshCoverage(refresh, { complete, count, now = Date.now() }) {
  requireValue(refresh?.active && typeof complete === 'boolean' && integer(count), 'Invalid TeamSnap refresh coverage.');
  return { kind: refresh.binding.kind + (refresh.active.mode === 'recent' ? '_recent' : ''), complete, count, observed_at: iso(now) };
}
