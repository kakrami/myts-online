import { fail, hash, native, requireValue, stamp, text } from "./common.js";
import { APP, GRAPH, TEAMS } from "./trace.js";
import { HALO_QUERY, RICH_GAME_QUERY } from "./trace-contracts.js";

export const CAPTURE_LIMITS = Object.freeze({ requests: 7, response_bytes: 12 * 1024 * 1024, metadata_bytes: 2 * 1024 * 1024, halo_bytes: 1024 * 1024, radar_prefix_bytes: 128 * 1024, page_ms: 22_000, redirects: 2 });
const AUTH_HOSTS = new Set(["go.traceup.com", "teams.traceup.com"]);
const sensitive = /token|secret|password|cookie|email|code|signature|credential|authorization|session|policy|(?:^|_)sig(?:$|_)|(?:^|_)key(?:$|_)/i;
const challenge = (value) => /\/cdn-cgi\/challenge-platform\b|\bcf-chl-[\w-]+|challenges\.cloudflare\.com\/turnstile\/|(?:google\.com|recaptcha\.net)\/recaptcha\/(?:api|enterprise)\.js|hcaptcha\.com\/1\/api\.js/i.test(value || "");
function endpoint(value) {
  let u; try { u = new URL(value); } catch { throw fail("Invalid Trace capture endpoint.", 400, "capture_asset_invalid"); }
  const authority = String(value).match(/^https:\/\/([^/?#]*)/i)?.[1] || "";
  requireValue(u.protocol === "https:" && !u.username && !u.password && !u.port && !authority.includes(":") && (u.hostname === "traceup.com" || u.hostname.endsWith(".traceup.com")), "Unsupported Trace capture endpoint.", "capture_asset_invalid");
  requireValue(u.href.length <= 4096, "Trace capture endpoint exceeds its bound.", "capture_asset_invalid");
  return u;
}

function failure(code, status = 502, availability = "unavailable", retryAfterMs = 0) {
  return Object.assign(fail("Trace tracking capture could not retrieve this source.", status, code), { availability, retryAfterMs });
}

/** A read-only, streaming capture transport. No response body or credential is logged. */
export class CaptureTransport {
  constructor(base = {}, options = {}) {
    // Standalone captures need the same native receiver as shared source calls.
    this.fetcher = options.fetch || base.fetcher || base.PROVIDER_FETCH?.fetch?.bind(base.PROVIDER_FETCH) || fetch.bind(globalThis);
    this.timeoutMs = Math.min(10_000, options.timeoutMs || 10_000);
    this.startPage();
  }
  startPage(usage = {}) {
    const requests = Number(usage.requests || 0), bytes = Number(usage.response_bytes || 0);
    requireValue(Number.isSafeInteger(requests) && requests >= 0 && requests <= CAPTURE_LIMITS.requests && Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= CAPTURE_LIMITS.response_bytes, "Invalid capture usage checkpoint.", "capture_checkpoint_invalid");
    this.requests = requests; this.bytes = bytes; this.deadline = Date.now() + CAPTURE_LIMITS.page_ms; this.observations = [];
  }
  usage() { return { requests: this.requests, response_bytes: this.bytes }; }
  async get(value, { credential = "", method = "GET", body = null, maxBytes = CAPTURE_LIMITS.halo_bytes, retainPrefix = false } = {}) {
    requireValue(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= CAPTURE_LIMITS.metadata_bytes, "Invalid capture response bound.", "capture_checkpoint_invalid");
    let u = endpoint(value);
    requireValue(method === "GET" || method === "POST", "Unsupported capture method.", "capture_asset_invalid");
    requireValue(body === null || (AUTH_HOSTS.has(u.hostname) && method === "POST"), "Credential-bearing bodies cannot be sent to tracking assets.", "capture_asset_invalid");
    for (let redirect = 0;; redirect++) {
      if (this.requests >= CAPTURE_LIMITS.requests || this.bytes >= CAPTURE_LIMITS.response_bytes || Date.now() + 100 >= this.deadline) throw failure("capture_budget_reached", 409, "partial");
      const observation = { endpoint: u.origin + u.pathname, params: Object.fromEntries([...u.searchParams].filter(([name]) => !sensitive.test(name))), at: stamp(), status: null, bytes: 0, retained_bytes: 0, truncated: false, code: null, hash: null };
      this.requests++;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(this.timeoutMs, this.deadline - Date.now())));
      try {
        const headers = { Accept: "application/json", Origin: APP, Referer: APP + "/" };
        if (credential && AUTH_HOSTS.has(u.hostname)) headers.Cookie = credential;
        if (body !== null) headers["Content-Type"] = "application/json";
        const response = await this.fetcher(u.href, { method, body, headers, redirect: "manual", signal: controller.signal });
        observation.status = response.status;
        if (response.headers.get("cf-mitigated") === "challenge") { await response.body?.cancel(); throw failure("human_verification", response.status || 502, "verification_required"); }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location"); await response.body?.cancel();
          if (challenge(location)) throw failure("human_verification", 502, "verification_required");
          if (!location || redirect >= CAPTURE_LIMITS.redirects) throw failure("capture_redirect_limit");
          const next = endpoint(new URL(location, u).href);
          if (next.origin !== u.origin) throw failure("capture_redirect_origin");
          // Do not replay a POST body to a GET endpoint following 302/303 semantics.
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) { method = "GET"; body = null; }
          u = next; continue;
        }
        if (response.status === 401) { await response.body?.cancel(); throw failure("authentication_required", 401, "authentication_required"); }
        if (response.status === 429) {
          const retry = response.headers.get("retry-after") || "", retryAfterMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
          await response.body?.cancel(); throw failure("rate_limited", 429, "rate_limited", retryAfterMs);
        }
        if (!response.body) throw failure("capture_empty_response");
        const isDiagnostic = !response.ok || /(?:text\/html|application\/xhtml)/i.test(response.headers.get("content-type") || "");
        const limit = isDiagnostic ? Math.min(maxBytes, 65_536) : maxBytes;
        const length = Number(response.headers.get("content-length"));
        if (!isDiagnostic && !retainPrefix && Number.isSafeInteger(length) && length > 0 && (length > limit || length > CAPTURE_LIMITS.response_bytes - this.bytes)) {
          await response.body.cancel();
          throw failure(length > CAPTURE_LIMITS.response_bytes - this.bytes ? "capture_byte_budget_reached" : "capture_response_too_large", 413, "partial");
        }
        const reader = response.body.getReader(), chunks = []; let retained = 0, truncated = false;
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            observation.bytes += part.value.byteLength; this.bytes += part.value.byteLength;
            if (this.bytes > CAPTURE_LIMITS.response_bytes) { await reader.cancel(); throw failure("capture_byte_budget_reached", 413, "partial"); }
            const take = part.value.subarray(0, Math.max(0, limit - retained));
            if (take.byteLength) { chunks.push(take); retained += take.byteLength; }
            if (part.value.byteLength > take.byteLength) { truncated = true; await reader.cancel(); break; }
            if (Date.now() >= this.deadline) { await reader.cancel(); throw failure("collector_timeout", 502, "partial"); }
          }
        } finally { reader.releaseLock(); }
        const all = new Uint8Array(retained); let offset = 0;
        for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
        const raw = new TextDecoder().decode(all);
        observation.retained_bytes = retained; observation.truncated = truncated; observation.hash = await hash(raw); observation.hash_scope = truncated ? "retained_prefix" : "complete_body";
        if (challenge(raw) && isDiagnostic) throw failure("human_verification", response.status || 502, "verification_required");
        if (response.status === 403) throw failure("source_access_denied", 403, "restricted");
        if (!response.ok) throw failure("source_http", response.status >= 500 ? 502 : response.status);
        if (isDiagnostic) throw failure("unsupported_response");
        if (truncated) {
          if (!retainPrefix) throw failure("capture_response_too_large", 413, "partial");
          observation.retrieved_at = stamp();
          return { value: null, prefix: raw, truncated: true, retainedBytes: retained, response, observation };
        }
        let parsed; try { parsed = JSON.parse(raw); } catch { throw failure("unsupported_response"); }
        observation.retrieved_at = stamp();
        return { value: parsed, prefix: retainPrefix ? raw : null, truncated: false, retainedBytes: retained, response, observation };
      } catch (error) {
        // Numeric DOMException codes must not bypass the safe source taxonomy.
        const safe = controller.signal.aborted ? failure("collector_timeout", 502, "partial")
          : typeof error?.code === "string" ? error : failure("source_network", 502, "partial");
        observation.code = safe.code; throw safe;
      } finally { clearTimeout(timer); this.observations.push(observation); }
    }
  }
}

function validate(selection) {
  requireValue(selection && native(selection.game_id) && native(selection.team_id) && ["home", "away"].includes(selection.side), "Select a native Trace game and team.", "capture_selection_invalid");
  const half = Number(selection.half), start = Number(selection.start_seconds), duration = Number(selection.duration_seconds);
  requireValue([1, 2].includes(half) && selection.start_seconds != null && Number.isFinite(start) && start >= 0 && start <= 7200 && Number.isFinite(duration) && duration >= 1 && duration <= 600, "Select a valid half and tracking window.", "capture_selection_invalid");
  requireValue(Array.isArray(selection.tracks) && selection.tracks.length >= 1 && selection.tracks.length <= 4, "Select one to four observed tracks.", "capture_selection_invalid");
  const gids = selection.tracks.map((track) => String(track?.gid || ""));
  requireValue(gids.every((gid) => /^[A-Za-z0-9_.:-]{1,160}$/.test(gid)) && new Set(gids).size === gids.length, "Select unique native tracks.", "capture_selection_invalid");
  return { game_id: native(selection.game_id), team_id: native(selection.team_id), side: selection.side, half, start_seconds: start, duration_seconds: duration, gids };
}
function scope(account, selection) { return { account_id: account.id, generation: account.generation, ...selection }; }
function queryError(raw) {
  if (!raw?.errors?.length) return;
  const codes = raw.errors.map((error) => String(error.extensions?.code || "").toUpperCase());
  if (codes.some((code) => ["UNAUTHENTICATED", "TOKEN_EXPIRED"].includes(code))) throw failure("authentication_required", 401, "authentication_required");
  if (codes.some((code) => ["FORBIDDEN", "ACCESS_DENIED", "UNAUTHORIZED"].includes(code))) throw failure("source_access_denied", 403, "restricted");
  throw failure("capture_graphql_error");
}
function explicitAsset(moment, game) {
  const path = text(moment.dynamic_jfile, 4096), base = text(moment.base_path || game.base_path, 4096);
  if (!path) return null;
  try {
    if (/^https:\/\//.test(path)) return endpoint(path).href;
    if (!base) return null;
    const source = endpoint(base.replace(/\/?$/, "/"));
    return endpoint(new URL(path, source).href).href;
  } catch { return null; }
}
function verifiedMetadata(raw, selection) {
  queryError(raw); const game = raw?.data?.game;
  requireValue(native(game?.game_id) === selection.game_id, "Trace returned another game.", "capture_game_mismatch");
  const own = native(game[selection.side + "_team"]?.team_id), other = native(game[(selection.side === "home" ? "away" : "home") + "_team"]?.team_id);
  requireValue(own === selection.team_id && other && other !== own, "Trace returned another team or side.", "capture_team_mismatch");
  if (game.access?.allowed === false || game.permissions?.view === false) throw failure("source_access_denied", 403, "restricted");
  requireValue(Array.isArray(game.team_members) && Array.isArray(game.moments), "Trace tracking metadata is missing.", "capture_metadata_invalid");
  const candidates = game.moments.filter((m) => m.type === "FullGameVideo" && Number(m.half) === selection.half && (!m.camera?.name || !String(m.camera.name).startsWith("sf_")));
  requireValue(candidates.length === 1, "Trace half has no unique native full-game clip.", "capture_half_ambiguous");
  const moment = candidates[0], clip = { game_clip_id: native(moment.game_clip_id), start_time: Number(moment.start_time), duration_seconds: Number(moment.duration || moment.dynamic_duration), half: selection.half };
  requireValue(clip.game_clip_id && Number.isFinite(clip.start_time) && Number.isFinite(clip.duration_seconds) && clip.duration_seconds > 0 && (moment.game_id == null || native(moment.game_id) === selection.game_id), "Trace native clip is invalid.", "capture_half_invalid");
  requireValue(selection.start_seconds + selection.duration_seconds <= clip.duration_seconds, "Tracking window exceeds the native half.", "capture_window_invalid");
  const tracks = selection.gids.map((gid) => {
    const matches = game.team_members.filter((m) => String(m.gid || "") === gid);
    requireValue(matches.length === 1, "Selected track is missing or ambiguous.", "capture_track_mismatch");
    const m = matches[0];
    requireValue(m.is_player === true && m.side === selection.side && (m.team_id == null || native(m.team_id) === selection.team_id), "Selected track is not a player on this team and side.", "capture_track_mismatch");
    const nativePrefix = gid.match(/^(home|away)[_-]/)?.[1];
    requireValue(!nativePrefix || nativePrefix === selection.side, "Selected track has a conflicting native side.", "capture_track_mismatch");
    const position = text(m.position, 80), name = text([m.user?.first_name, m.user?.last_name].filter(Boolean).join(" ") || m.user?.name || m.pg_name || gid, 200);
    const goalie = position.toLowerCase() === "goalie" || gid.includes("goalkeeper");
    return { gid, query_gid: goalie ? selection.side + "_goalie" : gid.replaceAll("-", "_"), name, jersey: text(m.jersey_number, 20), position, side: selection.side, is_dummy: m.user?.is_dummy === true };
  });
  return { clip, tracks, asset_url: explicitAsset(moment, game), game: { game_id: selection.game_id, team_id: selection.team_id, side: selection.side, full_date: text(game.full_date), home: { team_id: native(game.home_team?.team_id), name: text(game.home_team?.title || game.home_team?.name, 200) }, away: { team_id: native(game.away_team?.team_id), name: text(game.away_team?.title || game.away_team?.name, 200) }, access: "authenticated_response" } };
}
function availabilityFor(error) { return error.availability || (error.code === "authentication_required" ? "authentication_required" : error.status === 403 ? "restricted" : "unavailable"); }

/** Collect exactly one bounded source slice; storage/publication belong to the caller. */
export async function collectTrackingCapture({ transport, credential, account, selection, cursor = {} }) {
  const capture = transport instanceof CaptureTransport ? transport : new CaptureTransport(transport || {});
  let selected, state, phase = cursor.phase || "initialize";
  const respond = (record, checkpoint, complete, availability = "available", coverageState = complete ? "complete" : "partial") => ({ record, checkpoint, complete, coverage: coverageState,
    captureCoverage: { phase, availability, ...capture.usage(), limits: CAPTURE_LIMITS }, observations: capture.observations,
    retrievedAt: capture.observations.filter((o) => o.status >= 200 && o.status < 300 && o.hash && !o.code).at(-1)?.retrieved_at });
  try {
    capture.startPage(cursor.usage || {});
    requireValue(account?.id && account.provider === "trace" && native(account.native_id) && credential, "Trace authorization is required.", "authentication_required");
    selected = validate(selection); state = scope(account, selected);
    if (phase !== "initialize") {
      if (phase === "finished") {
        requireValue(cursor.version === 1 && JSON.stringify(cursor.scope) === JSON.stringify(state), "Tracking capture checkpoint changed scope.", "capture_checkpoint_invalid");
        if (cursor.failure_code) return { ...respond({ kind: cursor.failure_stage === "initialize" ? "metadata" : cursor.failure_stage, provider: "trace", status: "failed", availability: cursor.availability,
          error: { code: cursor.failure_code }, attempted_at: cursor.failure_at }, cursor, true, cursor.availability, cursor.terminal_coverage || "partial"), failure: { stage: cursor.failure_stage, code: cursor.failure_code, availability: cursor.availability } };
        return respond(null, cursor, true, cursor.availability || "available", cursor.partial ? "partial" : "complete");
      }
      requireValue(cursor.version === 1 && JSON.stringify(cursor.scope) === JSON.stringify(state) && Array.isArray(cursor.tracks) && cursor.tracks.length === selected.gids.length && cursor.tracks.every((track, index) => track.gid === selected.gids[index]) && cursor.clip?.game_clip_id, "Tracking capture checkpoint changed scope.", "capture_checkpoint_invalid");
      requireValue(["radar", "halo", "finished"].includes(phase), "Tracking capture checkpoint has an invalid phase.", "capture_checkpoint_invalid");
      requireValue(native(cursor.clip.game_clip_id) && cursor.clip.half === selected.half && Number.isFinite(cursor.clip.start_time) && Number.isFinite(cursor.clip.duration_seconds) && selected.start_seconds + selected.duration_seconds <= cursor.clip.duration_seconds,
        "Tracking capture clip checkpoint is invalid.", "capture_checkpoint_invalid");
      requireValue(cursor.tracks.every((track) => track.side === selected.side && typeof track.name === "string" && track.name.length <= 200 && typeof track.jersey === "string" && track.jersey.length <= 20 &&
        track.query_gid === (String(track.position).toLowerCase() === "goalie" || track.gid.includes("goalkeeper") ? selected.side + "_goalie" : track.gid.replaceAll("-", "_"))), "Tracking capture track checkpoint is invalid.", "capture_checkpoint_invalid");
    }
    if (phase === "initialize") {
      requireValue(typeof selection.profile_hash === "string" && selection.profile_hash.length <= 160 && /^[A-Za-z0-9_.-]+$/.test(selection.profile_hash), "Trace profile must be resolved before capture.", "capture_profile_missing");
      const tokenRaw = await capture.get(TEAMS + "/users/self/token", { credential, maxBytes: 65_536 }), token = tokenRaw.value?.data ?? tokenRaw.value;
      requireValue(native(token?.user_id) === native(account.native_id) && text(token.token) && token.timestamp, "Trace returned another account or an expired token.", "authentication_required");
      const raw = await capture.get(GRAPH, { credential, method: "POST", maxBytes: CAPTURE_LIMITS.metadata_bytes,
        body: JSON.stringify({ operationName: "game", query: RICH_GAME_QUERY, variables: { game_id: Number(selected.game_id), hash_key: selection.profile_hash, moment_id: null, gid: null, token } }) });
      const verified = verifiedMetadata(raw.value, selected), at = stamp();
      const checkpoint = { version: 1, phase: "radar", scope: state, clip: verified.clip, tracks: verified.tracks, asset_url: verified.asset_url, index: 0, partial: false, verified_at: at, usage: capture.usage() };
      return respond({ kind: "metadata", provider: "trace", status: "captured", game: verified.game, half: selected.half, clip: verified.clip, tracks: verified.tracks,
        window: { start_seconds: selected.start_seconds, duration_seconds: selected.duration_seconds, start_epoch_ms: Math.round(verified.clip.start_time + selected.start_seconds * 1000), duration_ms: Math.round(selected.duration_seconds * 1000) }, retrieved_at: at }, checkpoint, false);
    }
    if (phase === "radar") {
      const checkpoint = { ...cursor, phase: "halo", usage: capture.usage() };
      if (!cursor.asset_url) {
        checkpoint.partial = true;
        return respond({ kind: "radar", provider: "trace", half: selected.half, status: "unavailable", availability: "unavailable", reason: "Fresh metadata has no explicit supported radar asset.", attempted_at: stamp() }, checkpoint, false, "unavailable");
      }
      const raw = await capture.get(cursor.asset_url, { credential, maxBytes: CAPTURE_LIMITS.radar_prefix_bytes, retainPrefix: true });
      checkpoint.usage = capture.usage(); checkpoint.partial ||= raw.truncated;
      const record = { kind: "radar", provider: "trace", half: selected.half, status: raw.truncated ? "truncated" : "captured", retained_bytes: raw.retainedBytes, capture_truncated: raw.truncated,
        ...(raw.truncated ? { raw_text_prefix: raw.prefix, reason: "Bounded prefix; the complete radar response was not retained." } : { data: raw.value }), retrieved_at: stamp() };
      return respond(record, checkpoint, false, raw.truncated ? "partial" : "available");
    }
    const index = Number(cursor.index || 0);
    requireValue(Number.isInteger(index) && index >= 0 && index < cursor.tracks.length, "Invalid selected track checkpoint.", "capture_checkpoint_invalid");
    const track = cursor.tracks[index], clip = cursor.clip;
    const segment = { start: Math.round(clip.start_time + selected.start_seconds * 1000), local_start: Math.round(selected.start_seconds * 1000), duration: Math.round(selected.duration_seconds * 1000), game_clip_id: Number(clip.game_clip_id),
      gid: track.query_gid, player_name: [track.jersey ? "#" + track.jersey : "", track.name].filter(Boolean).join(" "), sport_type: "soccer" };
    const raw = await capture.get(GRAPH, { credential, method: "POST", maxBytes: CAPTURE_LIMITS.halo_bytes, body: JSON.stringify({ operationName: "getHaloData", query: HALO_QUERY, variables: { segments: [segment], eduButtonSize: { width: 115, height: 72 } } }) });
    queryError(raw.value);
    requireValue(Array.isArray(raw.value?.data?.halo?.ring), "Trace returned no raw Halo ring.", "capture_halo_unavailable");
    const complete = index + 1 === cursor.tracks.length, checkpoint = { ...cursor, phase: complete ? "finished" : "halo", index: index + 1, usage: capture.usage(), availability: cursor.partial ? "partial" : "available" };
    return respond({ kind: "halo", provider: "trace", half: selected.half, gid: track.gid, query_gid: track.query_gid, name: track.name, status: "captured", segment,
      data: { ring: raw.value.data.halo.ring, playerName: raw.value.data.halo.playerName ?? null, eduButton: raw.value.data.halo.eduButton ?? null }, retrieved_at: stamp() }, checkpoint, complete, cursor.partial ? "partial" : "available", complete && !cursor.partial ? "complete" : "partial");
  } catch (error) {
    const code = typeof error.code === "string" ? error.code : "capture_failed", availability = availabilityFor(error);
    const record = { kind: phase === "initialize" ? "metadata" : phase === "radar" ? "radar" : "halo", provider: "trace", status: "failed", availability,
      error: { code, http_status: Number(error.status) || 502, retry_after_ms: Math.max(0, Number(error.retryAfterMs) || 0) }, attempted_at: stamp() };
    if (phase === "halo" && cursor.tracks?.[Number(cursor.index || 0)]) record.gid = cursor.tracks[Number(cursor.index || 0)].gid;
    const coverage = ["restricted", "authentication_required", "verification_required"].includes(availability) ? "restricted" : /invalid|mismatch|ambiguous|unsupported|graphql_error|profile_missing/.test(code) ? "unsupported" : "partial";
    return { ...respond(record, { version: 1, phase: "finished", scope: state || null, complete: true, partial: true, availability, failure_code: code, failure_stage: phase, failure_at: record.attempted_at, terminal_coverage: coverage, usage: capture.usage() }, true, availability, coverage), failure: { stage: phase, code, availability } };
  }
}
