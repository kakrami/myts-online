import { bytes, day, fail, instant, key, native, requireValue, stamp, teamRecord, text, job, datePriority } from "./common.js";
import { unique } from "./http.js";
import * as Q from "./trace-contracts.js";

export const APP = "https://go.traceup.com", TEAMS = "https://teams.traceup.com/webapp", GRAPH = APP + "/traceid-prod/graphql", LAPI = "https://lapi.traceup.com/traceid-prod/graphql";
const RECORD_LIMIT = 60_000;
const RADAR_FRAME_LIMIT = 60_000, RADAR_ACTOR_LIMIT = 128, RADAR_OBSERVATION_LIMIT = 600_000;

export async function traceRequest(transport, endpoint, cookie = "", options = {}) {
  return transport.get(endpoint, { ...options, headers: { Accept: "application/json", Origin: APP, Referer: APP + "/", ...(cookie ? { Cookie: cookie } : {}), ...options.headers } }, options.maxBytes ? "radar" : "json");
}

export async function graphql(transport, cookie, query, variables, operationName, endpoint = GRAPH) {
  const { value } = await traceRequest(transport, endpoint, cookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationName, query, variables }), maxBytes: 8_000_000 });
  if (value?.errors?.length) {
    const codes = value.errors.map((e) => String(e.extensions?.code || "").toUpperCase());
    if (codes.some((c) => ["UNAUTHENTICATED", "AUTHENTICATION_REQUIRED", "TOKEN_EXPIRED"].includes(c))) throw fail("Trace authorization expired.", 401, "authentication_required");
    if (codes.some((c) => ["FORBIDDEN", "ACCESS_DENIED", "UNAUTHORIZED"].includes(c))) throw fail("Trace account cannot access this content.", 403, "account_access_lost");
    throw fail("Trace GraphQL data is unavailable.", 502, "unsupported_response");
  }
  requireValue(value?.data && typeof value.data === "object", "Trace GraphQL data is unavailable.", "unsupported_response");
  return value.data;
}

export async function tokenFor(transport, cookie, account = null) {
  const p = (await traceRequest(transport, TEAMS + "/users/self/token", cookie)).value, token = p.data ?? p;
  requireValue(native(token?.user_id) && text(token.token) && token.timestamp, "Trace session expired.", "authentication_required");
  if (account) requireValue(native(token.user_id) === native(account.native_id), "Trace returned another account.", "account_access_lost");
  return token;
}

export function cookieFrom(response) {
  const values = response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  for (const raw of values) { const match = raw.match(/(?:^|,\s*)PHPSESSID=([^;,\s]+)/i); if (match) return "PHPSESSID=" + match[1]; }
  return "";
}

export async function traceTeams(transport, cookie) {
  const p = (await traceRequest(transport, TEAMS + "/users/self/teams?sport_type=any", cookie)).value;
  return unique(p.data ?? p, (r) => native(r.team_id));
}

function display(member) {
  return text([member.user?.first_name, member.user?.last_name].filter(Boolean).join(" ") || member.user?.name || member.pg_name || member.gid);
}

function score(value) {
  if (value == null || value === "") return null;
  requireValue(Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1000, "Trace score is invalid.", "unsupported_response");
  return Number(value);
}

export function traceFixture(game, teamId, accountId) {
  const h = native(game.home_team?.team_id), a = native(game.away_team?.team_id);
  requireValue(native(game.game_id) && h && a && h !== a && [h, a].includes(teamId), "Trace fixture has foreign participants.", "contract_violation");
  const start = /Z$|[+-]\d\d:\d\d$/.test(game.full_date || "") ? instant(game.full_date) : null;
  const hs = score(game.home_team.score), as = score(game.away_team.score);
  return { id: key("trace", game.game_id), provider: "trace", native_id: native(game.game_id), account_id: accountId,
    competition_id: null, division_id: null, home_id: key("trace", h), away_id: key("trace", a), starts_at: start, local_day: start ? null : day(game.full_date), type: "game",
    status: ['cancelled','canceled'].includes(text(game.status).toLowerCase()) ? "CANCELLED" : text(game.status).toLowerCase()==='postponed' ? "POSTPONED" : start&&Date.parse(start)>Date.now() ? "SCHEDULED" : "UNKNOWN",
    conditional: 0, home_score: null, away_score: null,
    payload: JSON.stringify({ home_name: text(game.home_team.title || game.home_team.name), away_name: text(game.away_team.title || game.away_team.name),
      half_minutes: Number(game.approx_half_duration) || null, provider_status: text(game.status), reported_scores:{home:hs,away:as},result_state:hs!==null&&as!==null?'unverified':'unpublished',record_eligible:false,source_url: APP + "/traceid/game/" + game.game_id, time_pending: !start }), observed_at: stamp() };
}

function assertMemberTeam(member, teamId) {
  if (member.team_id !== undefined && member.team_id !== null) requireValue(native(member.team_id) === teamId, "Trace returned a roster member for another team.", "contract_violation");
  const direct = native(member.user_id), nested = native(member.user?.user_id);
  requireValue(!direct || !nested || direct === nested, "Trace returned conflicting player identities.", "contract_violation");
}

function player(member, accountId, teamId) {
  assertMemberTeam(member, teamId);
  const id = native(member.user_id || member.user?.user_id);
  return id && member.is_player === true && member.user?.is_dummy !== true && !/^(?:tracer|dummy|unidentified)(?:\s|$)/i.test(display(member))
    ? { id: key("trace", id), provider: "trace", native_id: id, account_id: accountId, name: display(member), jersey: text(member.jersey_number, 20),
      details: JSON.stringify({ position: text(member.position), team_id: teamId, is_dummy: false, active: member.is_active !== false }), observed_at: stamp() } : null;
}

function part(fixtureId, teamKey, accountId, name, value) {
  requireValue(bytes(value) <= RECORD_LIMIT, "Trace component exceeds its record bound.", "record_too_large");
  return { fixture_id: fixtureId, team_id: teamKey, account_id: accountId, part: name, value: JSON.stringify(value), observed_at: stamp() };
}

async function signature(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (v) => v.toString(16).padStart(2, "0")).join("");
}

async function slice(rows, cursor, limit) {
  const digest = await signature(rows), offset = cursor.digest && cursor.digest !== digest ? 0 : Number(cursor.offset || 0);
  requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= rows.length, "Invalid Trace checkpoint.", "contract_violation");
  const page = rows.slice(offset, offset + limit), complete = offset + page.length >= rows.length;
  return { page, offset, complete, checkpoint: complete ? { finished: true } : { offset: offset + page.length, digest } };
}

function ownMembers(game, teamId, side) {
  requireValue(Array.isArray(game.team_members), "Trace detailed roster is missing.", "unsupported_response");
  return game.team_members.filter((member) => {
    const declared = member.team_id == null ? null : native(member.team_id);
    if (member.side === side) requireValue(!declared || declared === teamId, "Trace game member has conflicting team and side.", "contract_violation");
    if (declared === teamId) requireValue(!member.side || member.side === side, "Trace game member has conflicting team and side.", "contract_violation");
    return member.is_player === true && (member.side === side || (!member.side && declared === teamId));
  });
}

function clipsFor(game) {
  return [1, 2].map((half) => {
    const candidates = game.moments.filter((m) => m.type === "FullGameVideo" && Number(m.half) === half && !text(m.camera?.name).startsWith("sf_"));
    return candidates.find((m) => m.camera?.name === "tracecam" || m.camera?.type === "Trace" || m.camera?.category === "camera") || candidates[0];
  }).filter(Boolean).map((m) => {
    if (m.game_id != null) requireValue(native(m.game_id) === native(game.game_id), "Trace full-half clip belongs to another game.", "contract_violation");
    const clip = { half: Number(m.half), game_clip_id: Number(m.game_clip_id), start: Number(m.start_time), duration: Number(m.duration || m.dynamic_duration) };
    requireValue(m.start_time !== null && m.start_time !== undefined && m.start_time !== "" && native(clip.game_clip_id) && Number.isFinite(clip.start) && clip.start >= 0 && Number.isFinite(clip.duration) && clip.duration > 0, "Trace full-half timing is incomplete.", "unsupported_response");
    return { source: m, clip };
  });
}

// Carry only exact native member IDs, never player names or position labels.
// These are produced by the authenticated game collector, not accepted from
// imported analysis summaries or from self-declared radar analysis properties.
function nativeRoleScope(game, accountId) {
  const home = native(game.home_team?.team_id), away = native(game.away_team?.team_id);
  const scope = { account_id: accountId, game_id: native(game.game_id), home_team_id: home, away_team_id: away, home: [], away: [] };
  for (const m of game.team_members) {
    if (m.is_player !== true || !["home", "away"].includes(m.side)) continue;
    const team = m.side === "home" ? home : away, gid = text(m.gid, 160);
    // A side label and a GID pattern alone are not a provider team identity.
    if (m.gid !== gid || native(m.team_id) !== team || !new RegExp("^" + m.side + "-(?:\\d+|goalkeeper)$").test(gid)) continue;
    if (!scope[m.side].includes(gid)) scope[m.side].push(gid);
  }
  scope.home.sort(); scope.away.sort();
  // Leave proof unknown rather than exceeding the scheduler's 8 KiB job bound.
  return scope.home.length + scope.away.length <= 128 && bytes(scope) <= 5000 ? scope : null;
}

function roleProof(scope, args, accountId) {
  if (!scope || scope.account_id !== accountId || scope.game_id !== native(args.game_id) || !native(scope.home_team_id) || !native(scope.away_team_id) || scope.home_team_id === scope.away_team_id || ![scope.home_team_id, scope.away_team_id].includes(native(args.team_id))) return [];
  const roles = [];
  for (const side of ["home", "away"]) {
    if (!Array.isArray(scope[side]) || scope[side].length > 128) return [];
    for (const gid of scope[side]) {
      if (typeof gid !== "string" || gid.length > 160 || !new RegExp("^" + side + "-(?:\\d+|goalkeeper)$").test(gid)) return [];
      roles.push({ gid, side, role: gid === side + "-goalkeeper" ? "goalkeeper" : "field", verified: true });
    }
  }
  return roles.length <= 128 && new Set(roles.map((r) => r.gid)).size === roles.length ? roles : [];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function movingMedian(values) {
  const result = new Float64Array(values.length), window = [];
  let lo = 0, hi = 0;
  const insert = (value) => { let i = 0; while (i < window.length && window[i] <= value) i++; window.splice(i, 0, value); };
  for (let i = 0; i < values.length; i++) {
    const nextLo = Math.max(0, i - 5), nextHi = Math.min(values.length, i + 6);
    while (lo < nextLo) window.splice(window.indexOf(values[lo++]), 1);
    while (hi < nextHi) insert(values[hi++]);
    const mid = Math.floor(window.length / 2);
    result[i] = window.length % 2 ? window[mid] : (window[mid - 1] + window[mid]) / 2;
  }
  return result;
}

// Original 6.20.133 TraceSourceTools algorithm, with bounded rolling reductions.
// Radar time is centiseconds; Halo and play-window time is half-local seconds.
// Caps reject the entire asset explicitly; no partial prefix becomes proof.
function radarAnalysis(radar, args, accountId) {
  const frames = radar.frm;
  requireValue(frames.length <= RADAR_FRAME_LIMIT, "Trace radar exceeds its frame bound.", "record_too_large");
  const counts = new Uint16Array(frames.length), balanced = new Uint16Array(frames.length);
  const roles = roleProof(args.native_role_scope, args, accountId), known = new Map(roles.map((r) => [r.gid, r]));
  let previous = -Infinity, observations = 0, allKnown = roles.length > 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    requireValue(frame && typeof frame.t === "number" && Number.isFinite(frame.t) && frame.t >= 0 && frame.t >= previous && frame.a && typeof frame.a === "object" && !Array.isArray(frame.a), "Trace radar frame is invalid.", "unsupported_response");
    previous = frame.t;
    const ids = Object.keys(frame.a); observations += ids.length;
    requireValue(ids.length <= RADAR_ACTOR_LIMIT && observations <= RADAR_OBSERVATION_LIMIT, "Trace radar exceeds its actor observation bound.", "record_too_large");
    counts[i] = ids.length;
    let home = 0, away = 0, keepers = 0;
    for (const gid of ids) {
      const role = known.get(gid);
      if (!role) { allKnown = false; continue; }
      if (role.side === "home") home++; else away++;
      if (role.role === "goalkeeper") keepers++;
    }
    // Counts alone cannot establish equal team capacity or include a keeper.
    if (home > 0 && home === away && keepers === 2) balanced[i] = home + away;
  }
  requireValue(frames.at(-1).t > frames[0].t, "Trace radar timing is invalid.", "unsupported_response");
  const smooth = movingMedian(counts), a = Math.floor(smooth.length * .2), b = Math.max(Math.floor(smooth.length * .8), a + 1);
  const baseline = median(smooth.subarray(a, b)), threshold = baseline - Math.max(3, baseline * .22);
  let lo = 0, hi = 0, good = 0, first = null, last = null, balancedFrames = 0;
  for (let i = 0; i < frames.length; i++) {
    const nextLo = Math.max(0, i - 10), nextHi = Math.min(frames.length, i + 11);
    while (lo < nextLo) good -= Number(smooth[lo++] >= threshold);
    while (hi < nextHi) good += Number(smooth[hi++] >= threshold);
    if (good / (hi - lo) >= .8) { first ??= i; last = i; }
    if (i >= a && i < b && balanced[i] === baseline) balancedFrames++;
  }
  const start = frames[first ?? 0].t / 100, end = frames[last ?? (frames.length - 1)].t / 100, round = (n, p = 1000) => Math.round(n * p) / p;
  const both = allKnown && baseline > 0 && balancedFrames / (b - a) >= .8;
  // Preserve the legacy raw population scalar without a second frame traversal.
  counts.sort();
  return { population: counts[Math.floor(counts.length / 2)], analysis: {
    play_window: baseline > 0 && end > start ? { start: round(start), end: round(end), duration: round(end - start), baseline_tracks: round(baseline, 100), threshold_tracks: round(threshold, 100), complete: true } : null,
    both_sides_verified: both ? true : null, track_roles: roles,
    basis: "native_radar_sustained_population", role_basis: roles.length ? "native_game_member_team_side_gid" : null,
    population_basis: both ? "balanced_native_sides_with_goalkeepers" : null } };
}

function assetURL(value, base) {
  const u = new URL(value, base?.startsWith("https:") ? base.replace(/\/?$/, "/") : APP + "/");
  requireValue(u.protocol === "https:" && !u.username && !u.password && (u.hostname === "traceup.com" || u.hostname.endsWith(".traceup.com")), "Trace asset URL is unsupported.", "contract_violation");
  return u.href;
}

function derivedChildren(game, args, members, side, accountId) {
  const teamId = native(args.team_id), fixtureId = key("trace", args.game_id), teamKey = key("trace", teamId), clips = clipsFor(game), children = [], native_role_scope = nativeRoleScope(game, accountId);
  for (const { source, clip } of clips) {
    if (source.dynamic_jfile) children.push(job("trace", "radar", fixtureId + ":" + teamKey + ":" + clip.half, { team_id: teamId, game_id: native(args.game_id), half: clip.half, url: assetURL(source.dynamic_jfile, source.base_path || game.base_path), ...(native_role_scope ? { native_role_scope } : {}) }));
    const seen = new Set();
    for (const member of members) {
      const gid = text(member.gid, 160);
      if (!gid || seen.has(gid)) continue;
      seen.add(gid);
      // Anonymous native channels are evidence, never a guessed person.
      const identified = player(member, null, teamId), playerId = identified ? identified.id : `track:${native(args.game_id)}:${teamId}:${gid}`;
      children.push(job("trace", "tracking", fixtureId + ":" + teamKey + ":" + gid + ":" + clip.half, { team_id: teamId, game_id: native(args.game_id), half: clip.half, gid, player_id: playerId, jersey: text(member.jersey_number, 20), name: display(member), clip }));
    }
  }
  const periods = [{ id: "full", start: null, end: null }, ...clips.map(({ clip }) => ({ id: String(clip.half), start: clip.start, end: clip.start + clip.duration * 1000 }))];
  for (const period of periods) {
    for(const scopeSide of [side,side==='home'?'away':'home'])children.push(job("trace", "analytics", fixtureId + ":" + teamKey + ":team:"+scopeSide+":" + period.id, { team_id: teamId, game_id: native(args.game_id), player_id: "team", side:scopeSide, gids: [], period }));
    const nativePlayers=new Map();for(const member of members){const p=player(member,null,teamId),gid=text(member.gid,160);if(p&&gid){if(!nativePlayers.has(p.id))nativePlayers.set(p.id,new Set());nativePlayers.get(p.id).add(gid);}}
    for(const [player_id,gids]of nativePlayers)children.push(job("trace", "analytics", fixtureId + ":" + teamKey + ":" + player_id + ":"+side+":" + period.id, { team_id: teamId, game_id: native(args.game_id), player_id, side, gids:[...gids], period }));
  }
  return children.map((child) => {
    const childArgs = { ...child.args, reported_date: text(game.full_date) };
    if (childArgs.native_role_scope && bytes(childArgs) > 8192) delete childArgs.native_role_scope;
    return { ...child, args: childArgs, priority: datePriority(game.full_date) };
  });
}

function segments(ring) {
  requireValue(Array.isArray(ring), "Trace tracking response has no ring.", "unsupported_response");
  const out = []; let lo = null, hi = null;
  const flush = () => { if (lo !== null && hi > lo) out.push([lo / 1000, hi / 1000]); lo = hi = null; };
  for (const sample of ring) {
    requireValue(Array.isArray(sample) && sample.length >= 2, "Trace tracking sample is invalid.", "unsupported_response");
    if (sample[1] === "DISCONTINUITY") flush();
    else if (sample[1] === "L" && Number.isFinite(sample[0])) { lo = lo === null ? sample[0] : Math.min(lo, sample[0]); hi = hi === null ? sample[0] : Math.max(hi, sample[0]); }
  }
  flush(); return out;
}

function availability(stats) {
  requireValue(stats && typeof stats.available === "string" && stats.available, "Trace analytics availability is missing.", "unsupported_response");
  return ["upgrade", "ask"].includes(stats.available) ? "restricted" : stats.available === "none" ? "unpublished" : "ready";
}

function statHeader(stats) {
  const header = {};
  for (const [name, value] of Object.entries(stats)) header[name] = value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "items")) : value;
  return header;
}

export async function collectTrace({ j, args = {}, cursor = {}, transport, credential, account }) {
  requireValue(account?.provider === "trace" && account.id && native(account.native_id) && credential, "Trace is disconnected.", "authentication_required");
  const token = await tokenFor(transport, credential, account), accountId = account.id;
  const out = { records: {}, fixtures: [], children: [], complete: true, checkpoint: { finished: true }, coverage: [], replacements: [] };
  const coverage = (kind, scope, complete, count, extra = {}) => ({ provider: "trace", account_id: accountId, kind, scope, complete, count, observed_at: stamp(), ...extra });
  if (j.kind === "catalog") {
    const rows = await traceTeams(transport, credential), page = await slice(rows, cursor, 50);
    out.records.teams = page.page.map((r) => ({ ...teamRecord("trace", r.team_id, r.title || r.name, { slug: text(r.name), catalog_scan_id: j.scan_id, account_owned: true }, { season: text(r.season_name || r.season), archived: +(r.is_archived === true) }), account_id: accountId }));
    for (const r of page.page) for (const kind of ["games", "roster"]) out.children.push(job("trace", kind, key("trace", r.team_id), { team_id: native(r.team_id), slug: text(r.name), team_name: text(r.title || r.name), profile_hash: text(args.profile_hash), roster_ids: args.roster_ids || [] }));
    out.complete = page.complete; out.checkpoint = page.checkpoint; out.coverage.push(coverage("catalog", accountId, page.complete, page.page.length));
    if (page.complete) out.replacements.push({ kind: "catalog", account_id: accountId, scan_id: j.scan_id });
    return out;
  }
  const teamId = native(args.team_id);
  requireValue(teamId, "Trace team identity is missing.", "contract_violation");
  const teamKey = key("trace", teamId), gameId = native(args.game_id), fixtureId = gameId ? key("trace", gameId) : null;
  const sourcePart = (name, value) => part(fixtureId, teamKey, accountId, name, value);
  if (j.kind === "games") {
    const d = await graphql(transport, credential, Q.TEAM_GAMES_QUERY, { team_id: Number(teamId), token }, "teamGames");
    const games = unique(d.teamGames, (g) => native(g.game_id)).sort((a,b)=>datePriority(b.full_date)-datePriority(a.full_date)||(Date.parse(b.full_date)||0)-(Date.parse(a.full_date)||0)||Number(a.game_id)-Number(b.game_id));
    games.forEach((g) => traceFixture(g, teamId, accountId));
    const page = await slice(games, cursor, 100);
    out.fixtures = page.page.map((g) => traceFixture(g, teamId, accountId));
    out.records.teams = [...new Map(page.page.flatMap((g) => [g.home_team, g.away_team]).map((r) => [native(r.team_id), { ...teamRecord("trace", r.team_id, r.title || r.name, { participant_observation: true, account_owned: false }), account_id: accountId }])).values()];
    out.children = page.page.map((g) => ({...job("trace", "game", key("trace", g.game_id) + ":" + teamKey, { ...args, team_id: teamId, game_id: native(g.game_id),reported_date:text(g.full_date) }),priority:datePriority(g.full_date)}));
    out.complete = page.complete; out.checkpoint = page.checkpoint; out.coverage.push(coverage("games", teamKey, page.complete, page.page.length));
    return out;
  }
  if (j.kind === "roster") {
    requireValue(text(args.slug), "Trace team profile is missing.", "contract_violation");
    const d = await graphql(transport, credential, Q.TEAM_MEMBERS_QUERY, { team_hash: args.slug, game_id: null, token, include_all: true }, "getTeamMembers");
    requireValue(Array.isArray(d.teamMembers), "Trace roster is missing.", "unsupported_response");
    // The verified teamMembers query requests team_id. A missing row identity is a contract failure.
    d.teamMembers.forEach((m) => { requireValue(native(m.team_id), "Trace roster member has no team identity.", "contract_violation"); assertMemberTeam(m, teamId); });
    const page = await slice(d.teamMembers, cursor, 150);
    out.records.players = [...new Map(page.page.map((m) => player(m, accountId, teamId)).filter(Boolean).map((p) => [p.id, p])).values()];
    out.records.team_players = out.records.players.map((p) => ({ team_id: teamKey, player_id: p.id, account_id: accountId, active: +(JSON.parse(p.details).active !== false), scan_id: j.scan_id }));
    out.complete = page.complete; out.checkpoint = page.checkpoint; out.coverage.push(coverage("roster", teamKey, page.complete, page.page.length));
    if (page.complete) out.replacements.push({ kind: "roster", team_id: teamKey, account_id: accountId, scan_id: j.scan_id });
    return out;
  }
  requireValue(gameId, "Trace game identity is missing.", "contract_violation");
  if (j.kind === "game") {
    let profile = text(args.profile_hash || cursor.profile_hash), work = cursor;
    if (!profile) {
      if (!cursor.users) {
        const d = await graphql(transport, credential, Q.USER_RELATIONS_QUERY, { to_user_id: Number(account.native_id), token, include_self: true }, "getUserRelations", LAPI);
        requireValue(Array.isArray(d.userRelations), "Trace account relations are missing.", "unsupported_response");
        const users = [...new Set([account.native_id, ...d.userRelations.map((r) => r.user_id || r.user?.user_id), ...(args.roster_ids || [])].map(native).filter(Boolean))];
        requireValue(users.length <= 200, "Trace authorized profile search exceeds its bound.", "contract_violation");
        return { ...out, complete: false, checkpoint: { users, index: 0 } };
      }
      const user = cursor.users[Number(cursor.index || 0)];
      requireValue(native(user), "No authorized Trace profile provides this game.", "account_access_lost");
      const d = await graphql(transport, credential, Q.PROFILE_BY_USER_QUERY, { user_id: Number(user), token }, "findProfileByUserId", LAPI);
      if (d.profile?.user_id != null) requireValue(native(d.profile.user_id) === native(user), "Trace returned another player profile.", "contract_violation");
      profile = text(d.profile?.hash_key);
      if (!profile) return { ...out, complete: false, checkpoint: { ...cursor, index: Number(cursor.index || 0) + 1 } };
    }
    const d = await graphql(transport, credential, Q.RICH_GAME_QUERY, { game_id: Number(gameId), hash_key: profile, moment_id: null, gid: null, token }, "game"), game = d.game;
    requireValue(native(game?.game_id) === gameId && Array.isArray(game.team_members) && Array.isArray(game.moments), "Trace detailed game response is invalid.", "unsupported_response");
    const fixture = traceFixture(game, teamId, accountId), side = native(game.home_team.team_id) === teamId ? "home" : "away";
    if (!game.moments.length && !args.profile_hash && !cursor.profile_hash && Number(cursor.index || 0) + 1 < (cursor.users || []).length && game.access?.allowed !== false) return { ...out, complete: false, checkpoint: { ...cursor, index: Number(cursor.index || 0) + 1 } };
    const digest = await signature(game), changed = cursor.digest && cursor.digest !== digest;
    work = changed ? { stage: "header", offset: 0 } : work;
    const stage = work.stage || "header", offset = Number(work.offset || 0), members = ownMembers(game, teamId, side), clips = clipsFor(game);
    requireValue(Number.isSafeInteger(offset) && offset >= 0, "Invalid Trace game checkpoint.", "contract_violation");
    const continuing = (nextStage, nextOffset = 0) => ({ ...out, complete: false, checkpoint: { profile_hash: profile, digest, stage: nextStage, offset: nextOffset } });
    if (stage === "header") {
      out.fixtures = [fixture];
      out.records.teams = [game.home_team, game.away_team].map((r) => ({ ...teamRecord("trace", r.team_id, r.title || r.name, { participant_observation: true, account_owned: false }), account_id: accountId }));
      out.records.trace_parts = [sourcePart("header", { game_id: gameId, full_date: text(game.full_date), own_side: side,
        home: game.home_team, away: game.away_team, approx_half_duration: game.approx_half_duration ?? null, base_path: text(game.base_path, 2000), num_equip: game.num_equip ?? null,
        profile_hash: profile, access: game.access || null, permissions: game.permissions || null,
        availability: game.access?.allowed === false ? "restricted" : game.moments.length ? "ready" : "unpublished", moment_count: game.moments.length }),
        ...clips.map(({ clip }) => sourcePart("clip:" + clip.half, clip))];
      return continuing("members");
    }
    if (stage === "members") {
      requireValue(offset <= members.length, "Trace roster checkpoint exceeds its scope.", "contract_violation");
      const page = members.slice(offset, offset + 100);
      out.records.players = [...new Map(page.map((m) => player(m, accountId, teamId)).filter(Boolean).map((p) => [p.id, p])).values()];
      // A game appearance is not a current roster scan; the separate roster job owns membership replacement.
      out.records.trace_parts = page.map((m, i) => sourcePart("member:" + String(offset + i).padStart(5, "0"), {
        gid: text(m.gid, 160), side: m.side || side, team_id: teamId, user_id: native(m.user_id || m.user?.user_id) || null,
        name: display(m), jersey: text(m.jersey_number, 20), position: text(m.position), dummy: m.user?.is_dummy === true,
        default_trace_number: m.default_trace_number ?? null, join_time: m.join_time ?? null, leave_time: m.leave_time ?? null }));
      return offset + page.length < members.length ? continuing("members", offset + page.length) : continuing("moments");
    }
    if (stage === "moments") {
      requireValue(offset <= game.moments.length, "Trace moment checkpoint exceeds its scope.", "contract_violation");
      const page = game.moments.slice(offset, offset + 100);
      out.records.trace_parts = page.map((m, i) => {
        if (m.game_id != null) requireValue(native(m.game_id) === gameId, "Trace moment belongs to another game.", "contract_violation");
        return sourcePart("moment:" + String(offset + i).padStart(7, "0"), {
          game_clip_id: native(m.game_clip_id) || null, team_id: native(m.team_id) || null, half: m.half ?? null, time: m.time ?? null,
          duration: m.duration ?? null, start_time: m.start_time ?? null, type: text(m.type), title: text(m.title), keywords: m.keywords || [],
          gids: m.gids || [], trace_numbers: m.trace_numbers || [], side: text(m.side), dynamic_jfile: text(m.dynamic_jfile, 2000), dynamic_hls: text(m.dynamic_hls, 2000),
          base_path: text(m.base_path, 2000), spotlights: m.spotlights || [], tags: m.tags || [], camera: m.camera || null });
      });
      return offset + page.length < game.moments.length ? continuing("moments", offset + page.length) : continuing("derived");
    }
    requireValue(stage === "derived", "Trace game checkpoint has an unknown stage.", "contract_violation");
    const children = game.access?.allowed === false ? [] : derivedChildren(game, args, members, side, accountId);
    requireValue(offset <= children.length, "Trace child checkpoint exceeds its scope.", "contract_violation");
    out.children = children.slice(offset, offset + 100);
    if (offset + out.children.length < children.length) return continuing("derived", offset + out.children.length);
    out.coverage.push(coverage("game", fixtureId + ":" + teamKey, true, game.moments.length, { availability: game.access?.allowed === false ? "restricted" : game.moments.length ? "ready" : "unpublished" }));
    out.replacements.push({ kind: "trace_game_parts", fixture_id: fixtureId, team_id: teamKey, account_id: accountId, scan_id: j.scan_id,
      member_count: members.length, moment_count: game.moments.length, halves: clips.map(({ clip }) => clip.half) });
    return out;
  }
  if (j.kind === "analytics") {
    requireValue(["home", "away"].includes(args.side) && Array.isArray(args.gids) && args.period?.id && args.player_id, "Trace analytics scope is incomplete.", "contract_violation");
    if(args.player_id.startsWith('track:'))requireValue(text(args.track_gid,160)&&args.player_id==='track:'+encodeURIComponent(args.track_gid)&&args.gids.length===1&&args.gids[0]===args.track_gid,'Trace track analytics identity is incomplete.','contract_violation');
    const vars = { game_id: Number(gameId), side: args.side, gids: args.gids.length ? args.gids : null, start: args.period.start ?? null, end: args.period.end ?? null, invert_touches: false, token };
    const d = await graphql(transport, credential, Q.TRACE_NATIVE_STATS_QUERY, vars, "gameStats"), stats = d.gameStats, state = availability(stats);
    // Scalar summary and typed item rows are separate. No full-game analytics blob is persisted.
    const summary = statHeader(stats);
    let heatmap = null, heatState = state === "ready" ? "not_requested" : state;
    if (state === "ready" && args.gids.length) {
      const h = await graphql(transport, credential, Q.TRACE_NATIVE_HEAT_QUERY, { game_id: Number(gameId), gids: args.gids, start: args.period.start ?? null, end: args.period.end ?? null, token }, "gameStatsHeatmap");
      requireValue(h.playerGameHeatMap && Object.hasOwn(h.playerGameHeatMap, "map"), "Trace heat map result is missing.", "unsupported_response");
      heatmap = h.playerGameHeatMap.map;
      if (heatmap !== null) requireValue(Array.isArray(heatmap) && heatmap.every((row) => Array.isArray(row) && row.length === heatmap[0]?.length && row.every((v) => Number.isFinite(v) && v >= 0)), "Trace heat map is invalid.", "unsupported_response");
      heatState = heatmap?.length ? "ready" : "unpublished";
    }
    const header = { stats: summary, heatmap, heatmap_state: heatState };
    requireValue(bytes(header) <= RECORD_LIMIT, "Trace analytics summary exceeds its record bound.", "record_too_large");
    out.records.trace_stats = [{ fixture_id: fixtureId, team_id: teamKey, account_id: accountId, player_id: args.player_id,track_gid:args.track_gid||null,side:args.side,period: args.period.id, value: JSON.stringify(header), state, observed_at: stamp() }];
    const events = state === "ready" ? Object.entries(stats).flatMap(([kind, value]) => (Array.isArray(value?.items) ? value.items : []).map((item, index) => ({ kind, index, item }))) : [];
    const page = await slice(events, cursor, 100);
    out.records.trace_parts = page.page.map(({ kind, index, item }) => sourcePart(`stats:${args.player_id}:${args.side}:${args.period.id}:${kind}:${String(index).padStart(7, "0")}`, {...item,scope_side:args.side,...(args.track_gid?{scope_gid:args.track_gid}:{})}));
    out.complete = page.complete; out.checkpoint = page.checkpoint;
    out.coverage.push(coverage("analytics", fixtureId + ":" + teamKey + ":" + args.player_id + ":"+args.side+":" + args.period.id, page.complete, page.page.length, { availability: state, heatmap_availability: heatState }));
    if (page.complete) out.replacements.push({ kind: "trace_stat_parts", fixture_id: fixtureId, team_id: teamKey, account_id: accountId, player_id: args.player_id, period: args.period.id,
      side:args.side,track_gid:args.track_gid||null,item_counts: Object.fromEntries(Object.entries(stats).filter(([, v]) => Array.isArray(v?.items)).map(([k, v]) => [k, state === "ready" ? v.items.length : 0])) });
    return out;
  }
  if (j.kind === "tracking") {
    const chunk = Number(cursor.chunk || 0), count = 4, duration = Math.round(args.clip?.duration * 1000);
    requireValue(Number.isInteger(chunk) && chunk >= 0 && chunk < count && duration > 0 && Number.isFinite(args.clip?.start) && native(args.clip?.game_clip_id) && text(args.gid), "Trace tracking scope is incomplete.", "contract_violation");
    const lo = Math.round(duration * chunk / count), hi = Math.round(duration * (chunk + 1) / count);
    const d = await graphql(transport, credential, Q.HALO_QUERY, { segments: [{ start: args.clip.start + lo, local_start: lo, duration: hi - lo, game_clip_id: args.clip.game_clip_id,
      gid: args.gid.replaceAll("-", "_"), player_name: [args.jersey ? "#" + args.jersey : "", args.name].filter(Boolean).join(" "), sport_type: "soccer" }], eduButtonSize: { width: 115, height: 72 } }, "getHaloData");
    const ranges = segments(d.halo?.ring), page = await slice(ranges, cursor, 1000);
    out.records.trace_parts = [sourcePart(`tracking:${args.half}:${args.gid}:${chunk}:${page.offset}`, { player_id: args.player_id, gid: args.gid, half: args.half, chunk, segments: page.page })];
    const chunkPages = { ...(cursor.chunk_pages || {}), ...(page.complete ? { [chunk]: Math.max(1, Math.ceil((page.offset + page.page.length) / 1000)) } : {}) };
    out.complete = page.complete && chunk === count - 1;
    out.checkpoint = !page.complete ? { ...page.checkpoint, chunk, chunk_pages: chunkPages } : out.complete ? { finished: true } : { chunk: chunk + 1, chunk_pages: chunkPages };
    out.coverage.push(coverage("tracking", fixtureId + ":" + teamKey + ":" + args.gid + ":" + args.half, out.complete, page.page.length));
    if (out.complete) out.replacements.push({ kind: "trace_tracking_parts", fixture_id: fixtureId, team_id: teamKey, account_id: accountId, half: args.half, gid: args.gid, chunk_pages: chunkPages, segment_page_size: 1000 });
    return out;
  }
  if (j.kind === "radar") {
    requireValue([1, 2].includes(args.half), "Trace radar half is invalid.", "contract_violation");
    const endpoint = assetURL(args.url), { value: radar } = await traceRequest(transport, endpoint, credential, { maxBytes: 8_000_000 });
    requireValue(Array.isArray(radar?.frm) && radar.frm.length > 1, "Trace radar is empty.", "unsupported_response");
    const { analysis, population } = radarAnalysis(radar, args, accountId);
    const start = radar.frm[0].t / 100, end = radar.frm.at(-1).t / 100;
    requireValue(Number.isFinite(start) && Number.isFinite(end) && end > start, "Trace radar timing is invalid.", "unsupported_response");
    out.records.trace_parts = [sourcePart("radar:" + args.half, { half: args.half, start, end, population, geometry: radar.setup?.field?.coordinates ?? null, samples: radar.frm.length, analysis })];
    out.coverage.push(coverage("radar", fixtureId + ":" + teamKey + ":" + args.half, true, radar.frm.length));
    out.replacements.push({ kind: "trace_radar_parts", fixture_id: fixtureId, team_id: teamKey, account_id: accountId, half: args.half, valid_parts: ["radar:" + args.half] });
    return out;
  }
  throw fail("Unsupported Trace job.", 500, "invalid_job");
}
