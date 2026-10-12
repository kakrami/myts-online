import { requireValue } from './common.js';

// TeamSnap's advertised page_size enables paging; page_number is one-based.
// Keep the provider response cap unchanged. Local SQL-byte slicing is separate.
export const TEAMSNAP_PAGE_SIZE = 25;
const VERSION = 'teamsnap-pages-v1';
const MAX_PASSES = 3;
const CATCHUP_DELAY_MS = 900000;
const API = 'https://api.teamsnap.com';
const integer = value => Number.isSafeInteger(value) && value >= 0;
const secret = /token|password|secret|credential|authorization|cookie/i;
const canonical = value => { const u = new URL(value); u.searchParams.sort(); return u.href; };
const uniqueQuery = value => { const u=new URL(value); const keys=[...u.searchParams.keys()]; return keys.every((key,i)=>keys.indexOf(key)===i); };
const identity = value => { const u = new URL(value); u.searchParams.delete('page_number'); return canonical(u); };
const atPage = (base, page) => { const u = new URL(base); u.searchParams.set('page_number', String(page)); return canonical(u); };
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), n => n.toString(16).padStart(2, '0')).join('');
const validHash = value => value === null || /^[a-f0-9]{64}$/.test(value || '');

export function teamSnapPageRequest(kind, teamId, original, cursor = {}) {
  const rel = kind === 'events' ? 'events' : 'availabilities', u = new URL(original);
  requireValue(u.origin === API && ['/v3/' + rel, '/v3/' + rel + '/search'].includes(u.pathname) && !u.username && !u.password && !u.hash,
    'TeamSnap collection endpoint changed.', 'contract_violation');
  requireValue([...u.searchParams.keys()].every((key, i, keys) => !secret.test(key) && keys.indexOf(key) === i), 'TeamSnap query is ambiguous.', 'contract_violation');
  requireValue(!u.searchParams.has('team_id') || u.searchParams.get('team_id') === teamId, 'TeamSnap endpoint belongs to another team.', 'contract_violation');
  u.searchParams.set('team_id', teamId);
  const size = cursor.protocol === VERSION && [25,12,6,3,1].includes(cursor.size) ? cursor.size : TEAMSNAP_PAGE_SIZE;
  u.searchParams.set('page_size', String(size));
  u.searchParams.set('page_number', '1');
  if (!u.searchParams.has(kind === 'events' ? 'sort_start_date' : 'sort_event_id')) u.searchParams.set(kind === 'events' ? 'sort_start_date' : 'sort_event_id', 'desc');
  const base = canonical(u), fresh = { protocol: VERSION, size, base, url: base, page_changes: 0, previous_ids: [], page_hashes: [], offset: 0, digest: null, total: null, rolling: null, previous: null, pages: 0, count: 0, pass: 1 };
  // Old full-response offsets cannot be applied to newly paginated responses.
  if (cursor.protocol !== VERSION || cursor.base !== base) return fresh;
  requireValue(uniqueQuery(cursor.url) && identity(cursor.url) === identity(base) && integer(cursor.offset) && integer(cursor.pages) && integer(cursor.count) && integer(cursor.pass) && cursor.pass > 0 && (cursor.total === null || integer(cursor.total)) && validHash(cursor.digest) && validHash(cursor.rolling), 'Invalid TeamSnap continuation.', 'contract_violation');
  const number = Number(new URL(cursor.url).searchParams.get('page_number'));
  requireValue(Number.isSafeInteger(number) && number > 0 && number === cursor.pages + 1, 'TeamSnap page sequence changed.', 'contract_violation');
  if (cursor.previous !== null) requireValue(validHash(cursor.previous?.digest) && integer(cursor.previous?.pages) && integer(cursor.previous?.count) && (cursor.previous?.total === null || integer(cursor.previous?.total)), 'Invalid TeamSnap verification receipt.', 'contract_violation');
  return { ...cursor, url: canonical(cursor.url) };
}

export function teamSnapPageMetadata(raw, state, length) {
  const number = state.pages + 1, info = raw.collection?.page_info;
  requireValue(length <= state.size, 'TeamSnap did not honor bounded pagination.', 'unsupported_response');
  let total = null;
  if (info !== undefined && info !== null) {
    requireValue(integer(info.total_items) && info.page_size === state.size && info.page_number === number,
      'TeamSnap returned invalid page metadata.', 'unsupported_response');
    total = info.total_items;
    requireValue(length === Math.min(state.size, Math.max(0, total - (number - 1) * state.size)), 'TeamSnap page count disagrees with its metadata.', 'unsupported_response');
  }
  const links = (raw.collection?.links || []).filter(link => link.rel === 'next');
  requireValue(links.length <= 1, 'TeamSnap returned ambiguous pagination.', 'unsupported_response');
  let next = null;
  if (links.length) {
    requireValue(typeof links[0].href === 'string', 'TeamSnap next page is missing.', 'unsupported_response');
    const u = new URL(links[0].href, state.url);
    requireValue(!u.username && !u.password && !u.hash && uniqueQuery(u) && identity(u) === identity(state.base) && u.searchParams.get('page_number') === String(number + 1), 'TeamSnap continuation changed its source scope.', 'contract_violation');
    next = canonical(u);
  }
  const terminal = total !== null ? number * state.size >= total : length < state.size && !next;
  if (total !== null) {
    requireValue(!terminal || !next, 'TeamSnap terminal metadata has another page.', 'unsupported_response');
    if (!terminal && !next) next = atPage(state.base, number + 1);
  } else requireValue(terminal || next, 'TeamSnap has no proven collection continuation.', 'unsupported_response');
  return { number, total, next, terminal, changed: state.pages > 0 && state.total !== total };
}

export function restartTeamSnapPass(state, now = Date.now()) {
  return { ...state, url: state.base, page_changes: 0, previous_ids: [], page_hashes: [], offset: 0, digest: null, total: null, rolling: null, previous: null, pages: 0, count: 0, pass: state.pass >= MAX_PASSES ? 1 : state.pass + 1, retry_at: state.pass >= MAX_PASSES ? now + CATCHUP_DELAY_MS : 0 };
}

export async function advanceTeamSnapPage(state, metadata, pageDigest, length, offset, consumed, ids = [], idDigest = null) {
  if (offset + consumed < length) return { complete: false, checkpoint: { ...state, offset: offset + consumed, digest: pageDigest } };
  const rolling = await digest([state.rolling, metadata.number, metadata.total, pageDigest]), count = state.count + length, pages = state.pages + 1;
  if (!metadata.terminal) return { complete: false, checkpoint: { ...state, url: metadata.next, page_changes: 0, previous_ids: ids, page_hashes: [...(state.page_hashes||[]),idDigest].slice(-8), offset: 0, digest: null, total: metadata.total, rolling, pages, count } };
  const receipt = { digest: rolling, pages, count, total: metadata.total };
  const stable = state.previous && Object.keys(receipt).every(key => receipt[key] === state.previous[key]);
  if (stable) return { complete: true, checkpoint: { finished: true }, traversal: receipt };
  // Two matching traversals are convergence evidence, never a snapshot promise.
  return { complete: false, checkpoint: { ...restartTeamSnapPass(state), previous: receipt } };
}

export function reduceTeamSnapPage(state) {
  requireValue(state.size > 1, 'A single TeamSnap item exceeds the response bound.', 'record_too_large');
  const size = Math.max(1, Math.floor(state.size / 2)), base = new URL(state.base); base.searchParams.set('page_size', String(size));
  const next = canonical(base);
  return { ...restartTeamSnapPass(state), size, base: next, url: next, pass: 1, retry_at: 0 };
}
