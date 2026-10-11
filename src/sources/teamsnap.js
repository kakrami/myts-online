import { instant, key, native, parse, requireValue, stamp, teamRecord, text, job, localDate } from "./common.js";
import { url, unique } from "./http.js";

const API = "https://api.teamsnap.com/v3/";
const PAGE_SIZE = 150;
const TEAM_RELS = new Set(["teams", "active_teams", "archived_teams", "past_teams", "retired_teams", "team_history"]);
const RELS = { roster: "members", events: "events", attendance: "availabilities", locations: "locations", opponents: "opponents" };
const ACTION_RELS = new Set([...TEAM_RELS, ...Object.values(RELS)]);

export function collection(raw) {
  requireValue(Array.isArray(raw?.collection?.items) && !raw.collection.error, "TeamSnap returned an invalid collection.", "unsupported_response");
  return raw.collection.items.map((item) => {
    requireValue(Array.isArray(item.data), "TeamSnap item data is missing.", "unsupported_response");
    const fields = {};
    for (const field of item.data) {
      if (!field?.name) continue;
      requireValue(!Object.hasOwn(fields, field.name), "TeamSnap repeated an item field.", "unsupported_response");
      fields[field.name] = field.value;
    }
    // Metadata can contain external image/help links. Only API actions are followed.
    fields.links = Object.fromEntries((item.links || []).filter((link) => ACTION_RELS.has(link.rel) && link.href).map((link) => [link.rel, tsURL(link.href)]));
    fields.href = item.href ? tsURL(item.href) : null;
    return fields;
  });
}

export function tsURL(value) {
  const u = new URL(value, API);
  requireValue(u.origin === "https://api.teamsnap.com" && u.pathname.startsWith("/v3/") && !u.username && !u.password, "Unsupported TeamSnap link.", "contract_violation");
  requireValue(u.href.length <= 2048, "TeamSnap link exceeds its bound.", "contract_violation");
  return u.href;
}

export async function ts(transport, value, credential) {
  return (await transport.get(tsURL(value), { headers: { Authorization: "Bearer " + credential, Accept: "application/vnd.collection+json, application/json" } })).value;
}

function nextPage(raw) {
  const links = (raw.collection?.links || []).filter((link) => link.rel === "next");
  requireValue(links.length <= 1, "TeamSnap returned ambiguous pagination.", "unsupported_response");
  return links[0]?.href ? tsURL(links[0].href) : null;
}

async function signature(rows) {
  const value = new TextEncoder().encode(JSON.stringify(rows));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), (v) => v.toString(16).padStart(2, "0")).join("");
}

function assertTeam(row, teamId) {
  if (row.team_id !== undefined && row.team_id !== null) requireValue(native(row.team_id) === teamId, "TeamSnap returned a record for another team.", "contract_violation");
}

function refs(args, kind, id) {
  const source = args.references?.[kind];
  if (Array.isArray(source)) return parse(source.find((r) => String(r.id) === String(id))?.value || {});
  return parse(source?.[String(id)] || {});
}

function score(value) {
  if (value == null || value === "") return null;
  requireValue(Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1000, "TeamSnap returned an invalid score.", "unsupported_response");
  return Number(value);
}

function event(row, teamId, args, accountId) {
  assertTeam(row, teamId);
  const team = key("teamsnap", teamId), opponent = refs(args, "opponents", row.opponent_id), location = refs(args, "locations", row.location_id);
  const gameType=text(row.game_type).toLowerCase(),gameCode=Number(row.game_type_code),orientationKnown=[1,2].includes(gameCode)||["home","away"].includes(gameType);
  requireValue(![1,2].includes(gameCode)||!["home","away"].includes(gameType)||(gameCode===1)===(gameType==="home"),"TeamSnap home/away fields conflict.","contract_violation");
  const ownHome=gameCode===2?false:gameCode===1?true:gameType==="away"?false:true;
  const teamName = text(args.team_name) || "Team", opponentName = text(row.opponent_name || opponent.name) || "Opponent";
  const sf = score(row.points_for_team ?? row.team_score), sa = score(row.points_for_opponent ?? row.opponent_score);
  const start = instant(row.start_date || row.start_at || row.starts_at || row.date);
  requireValue(start, "TeamSnap event has no kickoff.", "unsupported_response");
  // TeamSnap distinguishes entering a live score from finalizing it. The public
  // API/SDK documentation reviewed does not expose a verified final-state field.
  const future=Date.parse(start)>Date.now(),cancelled=row.is_canceled===true||row.is_canceled===1||row.is_cancelled===true,tbd=row.is_tbd===true||row.is_tbd===1;
  const reported={points_for_team:row.points_for_team??null,points_for_opponent:row.points_for_opponent??null,team_score:row.team_score??null,opponent_score:row.opponent_score??null,results:row.results??null,formatted_results:row.formatted_results??null,results_url:row.results_url??null,shootout_points_for_team:row.shootout_points_for_team??null,shootout_points_for_opponent:row.shootout_points_for_opponent??null,is_overtime:row.is_overtime??null,is_shootout:row.is_shootout??null,status:row.status??null,is_tbd:row.is_tbd??null,doesnt_count_towards_record:row.doesnt_count_towards_record??null};
  return {
    id: key("teamsnap", row.id), provider: "teamsnap", native_id: native(row.id), account_id: accountId,
    competition_id: null, division_id: null, home_id: ownHome ? team : null, away_id: ownHome ? null : team,
    starts_at: tbd?null:start, local_day: tbd?localDate(start,row.time_zone_iana_name||args.timezone||"America/Los_Angeles"):null,
    type: row.is_game === true || row.is_game === 1 ? "game" : /practice/i.test(row.type || row.name || "") ? "practice" : "event",
    status: cancelled?"CANCELLED":future?"SCHEDULED":"UNKNOWN",
    conditional: 0, home_score: null, away_score: null,
    payload: JSON.stringify({ home_name: ownHome ? teamName : opponentName, away_name: ownHome ? opponentName : teamName,
      title: text(row.name || row.formatted_title || row.label), venue: text(row.location_name || location.name),
      address: text([location.address, location.city, location.state, location.zip].filter(Boolean).join(", ")),
      notes: text(row.notes, 8000), uniform: text(row.uniform), arrival_at: row.arrival_date || null,
      arrival_minutes: row.minutes_to_arrive_early ?? null, availability_enabled: row.is_availability_enabled ?? row.availability_enabled ?? null,
      source_url: row.href, opponent_id: native(row.opponent_id) || null, location_id: native(row.location_id) || null,
      game_type:row.game_type??null,game_type_code:row.game_type_code??null,orientation_verified:orientationKnown,time_pending:tbd,
      reported,reported_scores:{home:ownHome?sf:sa,away:ownHome?sa:sf},result_state:sf!==null&&sa!==null?"unverified":"unpublished",record_eligible:false }), observed_at: stamp(),
  };
}

export async function collectTeamSnap({ j, args = {}, cursor = {}, transport, credential, account }) {
  requireValue(account?.provider === "teamsnap" && account.id && native(account.native_id) && credential, "TeamSnap is disconnected.", "authentication_required");
  const out = { records: {}, fixtures: [], children: [], complete: true, checkpoint: { finished: true }, coverage: [], replacements: [] };
  if (j.kind === "catalog" && !cursor.url) {
    const raw = await ts(transport, "me", credential), me = collection(raw)[0];
    requireValue(native(me?.id) === native(account.native_id), "TeamSnap returned another account.", "account_access_lost");
    const links = [...new Set([url(API, "teams/search", { user_id: me.id }),
      ...(raw.collection.links || []).filter((l) => TEAM_RELS.has(l.rel)).map((l) => tsURL(l.href)),
      ...Object.entries(me.links || {}).filter(([rel]) => TEAM_RELS.has(rel)).map(([, href]) => tsURL(href))])];
    return { ...out, complete: false, checkpoint: { url: links[0], remaining: links.slice(1), visited: [], offset: 0 } };
  }
  requireValue(j.kind === "catalog" || Object.hasOwn(RELS, j.kind), "Unsupported TeamSnap job.", "invalid_job");
  const teamId = j.kind === "catalog" ? null : native(args.team_id);
  requireValue(j.kind === "catalog" || teamId, "TeamSnap team identity is missing.", "contract_violation");
  const endpoint = tsURL(cursor.url || args.url || url(API, RELS[j.kind] + "/search", { team_id: teamId }));
  const endpointTeam = new URL(endpoint).searchParams.get("team_id");
  if (teamId && endpointTeam !== null) requireValue(native(endpointTeam) === teamId, "TeamSnap endpoint belongs to another team.", "contract_violation");
  const raw = await ts(transport, endpoint, credential), all = unique(collection(raw), (r) => native(r.id)), digest = await signature(all);
  const offset = cursor.digest && cursor.digest !== digest ? 0 : Number(cursor.offset || 0);
  requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= all.length, "Invalid TeamSnap checkpoint.", "contract_violation");
  const rows = all.slice(offset, offset + (j.kind === "catalog" ? 20 : PAGE_SIZE)), next = nextPage(raw), moreRows = offset + rows.length < all.length;
  const visited = [...(cursor.visited || [])], pageMark = (await signature(endpoint)).slice(0, 16), nextMark = next ? (await signature(next)).slice(0, 16) : null;
  if (!moreRows) visited.push(pageMark);
  requireValue(visited.length <= 200 && (!nextMark || !visited.includes(nextMark)), "TeamSnap pagination repeated a page or exceeded its bound.", "unsupported_response");
  const remaining = cursor.remaining || [], nextURL = moreRows ? endpoint : next || remaining[0];
  out.complete = !nextURL;
  out.checkpoint = nextURL ? { url: nextURL, offset: moreRows ? offset + rows.length : 0, digest: moreRows ? digest : null,
    remaining: moreRows || next ? remaining : remaining.slice(1), visited } : { finished: true };
  const accountId = account.id, team = teamId ? key("teamsnap", teamId) : null;
  if (j.kind === "catalog") {
    out.records.teams = rows.map((r) => ({ ...teamRecord("teamsnap", r.id, r.name || r.team_name,
      { timezone: text(r.time_zone || r.timezone) || null, links: r.links, source_url: r.href, catalog_scan_id: j.scan_id, account_owned: true },
      { season: text(r.season_name || r.season_label || r.season), archived: +(r.is_archived === true || r.is_retired === true) }), account_id: accountId }));
    for (const r of rows) for (const kind of Object.keys(RELS)) {
      const rel = RELS[kind], link = r.links?.[rel] || url(API, rel + "/search", { team_id: r.id });
      out.children.push(job("teamsnap", kind, key("teamsnap", r.id), { team_id: native(r.id), team_name: text(r.name || r.team_name), url: tsURL(link) }));
    }
  } else {
    rows.forEach((r) => assertTeam(r, teamId));
    if (j.kind === "roster") {
      out.records.players = rows.filter((r) => r.is_non_player !== true && r.is_player !== false && !["coach", "manager", "owner"].includes(String(r.member_type || r.type).toLowerCase())).map((r) => ({
        id: key("teamsnap", r.id), provider: "teamsnap", native_id: native(r.id), account_id: accountId,
        name: text([r.first_name, r.last_name].filter(Boolean).join(" ") || r.name || r.label), jersey: text(r.jersey_number ?? r.jersey ?? r.number, 20),
        details: JSON.stringify({ position: text(r.position || r.position_name), active: r.is_active !== false }), observed_at: stamp() }));
      out.records.team_players = out.records.players.map((p) => ({ team_id: team, player_id: p.id, account_id: accountId, active: +(parse(p.details).active !== false), scan_id: j.scan_id }));
    } else if (j.kind === "events") out.fixtures = rows.map((r) => event(r, teamId, args, accountId));
    else if (j.kind === "attendance") out.records.attendance = rows.map((r) => {
      requireValue(native(r.event_id) && native(r.member_id), "TeamSnap attendance identity is incomplete.", "unsupported_response");
      const nativeStatus = r.status_code ?? null;
      const normalized = nativeStatus === null ? "NR" : nativeStatus === 0 || nativeStatus === "0" ? "No" : nativeStatus === 1 || nativeStatus === "1" ? "Yes" : nativeStatus === 2 || nativeStatus === "2" ? "Maybe" : "Unknown";
      return { fixture_id: key("teamsnap", r.event_id), player_id: key("teamsnap", r.member_id), team_id: team, account_id: accountId,
        status: nativeStatus === null ? "" : String(nativeStatus), native_status: nativeStatus, normalized_status: normalized,
        evidence: { contract: "teamsnap-javascript-sdk/AVAILABILITIES", status_code: nativeStatus }, observed_at: stamp() };
    });
    else out.records.references_data = rows.map((r) => ({ team_id: team, account_id: accountId, kind: j.kind, id: native(r.id),
      value: JSON.stringify({ name: text(r.name || r.label), address: text(r.address), city: text(r.city), state: text(r.state), zip: text(r.zip) }), observed_at: stamp() }));
  }
  out.coverage.push({ provider: "teamsnap", account_id: accountId, kind: j.kind, scope: team || accountId, complete: out.complete, count: rows.length, observed_at: stamp() });
  if (out.complete && ["catalog", "roster"].includes(j.kind)) out.replacements.push({ kind: j.kind, team_id: team, account_id: accountId, scan_id: j.scan_id });
  return out;
}
