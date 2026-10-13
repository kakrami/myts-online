import { instant, key, native, parse, requireValue, stamp, teamRecord, text, job, localDate } from "./common.js";
import { url, unique } from "./http.js";
import { annotateTeamSnapAttendance } from "./teamsnap-diagnostics.js";
import { beginTeamSnapRefresh, finishTeamSnapRefresh, teamSnapRefreshCoverage } from "./teamsnap-refresh.js";
import { teamSnapBatchLength } from "./teamsnap-batch.js";
import { teamSnapPageRequest, teamSnapPageMetadata, restartTeamSnapPass, reduceTeamSnapPage, advanceTeamSnapPage } from "./teamsnap-pagination.js";

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

function catalogURL(value, accountNativeId) {
  const u=new URL(tsURL(value));
  requireValue(!u.hash&&new Set(u.searchParams.keys()).size===[...u.searchParams.keys()].length,"TeamSnap catalog has ambiguous scope.","contract_violation");
  requireValue(!u.searchParams.has('user_id')||native(u.searchParams.get('user_id'))===native(accountNativeId),"TeamSnap catalog belongs to another account.","contract_violation");
  // The bare collection is a schema/queries document, not a team data page.
  // Its supported account-scoped search is already the primary discovery path.
  if(u.pathname==='/v3/teams'&&!u.search) return url(API,'teams/search',{user_id:accountNativeId});
  return u.href;
}

export async function ts(transport, value, credential) {
  return (await transport.get(tsURL(value), { headers: { Authorization: "Bearer " + credential, Accept: "application/vnd.collection+json, application/json" } })).value;
}

function emptyCatalogSearch(raw, endpoint, accountNativeId) {
  if(!raw?.collection||raw.collection.items!==undefined||raw.collection.error||!raw.collection.href)return false;
  if(new URL(tsURL(raw.collection.href)).pathname!=='/v3/teams/search')return false;
  const expected=new URL(catalogURL(endpoint,accountNativeId)), actual=new URL(catalogURL(raw.collection.href,accountNativeId));
  if(expected.pathname!=='/v3/teams/search'||actual.pathname!==expected.pathname||expected.searchParams.get('user_id')!==native(accountNativeId))return false;
  expected.searchParams.sort();actual.searchParams.sort();
  return actual.href===expected.href;
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

function attendanceIdentity(r) {
  requireValue([r.event_id,r.member_id].every(value=>['string','number'].includes(typeof value)&&native(value)), "TeamSnap attendance identity is incomplete.", "unsupported_response");
  // Availability IDs may be opaque (or absent). Storage identifies attendance
  // by the numeric event/member pair within the refresh's bound account/team.
  return native(r.event_id) + ':' + native(r.member_id);
}

function attendanceRecord(r, team, accountId) {
  attendanceIdentity(r);
  const nativeStatus = r.status_code ?? null;
  const normalized = nativeStatus === null ? "NR" : nativeStatus === 0 || nativeStatus === "0" ? "No" : nativeStatus === 1 || nativeStatus === "1" ? "Yes" : nativeStatus === 2 || nativeStatus === "2" ? "Maybe" : "Unknown";
  return { fixture_id: key("teamsnap", r.event_id), player_id: key("teamsnap", r.member_id), team_id: team, account_id: accountId,
    status: nativeStatus === null ? "" : String(nativeStatus), native_status: nativeStatus, normalized_status: normalized,
    evidence: { contract: "teamsnap-javascript-sdk/AVAILABILITIES", status_code: nativeStatus }, observed_at: stamp() };
}

async function collectPagedTeamSnap(context) {
  const {j,args,account,teamId}=context,original=tsURL(args.url || url(API,RELS[j.kind]+"/search",{team_id:teamId}));
  const prepared=await beginTeamSnapRefresh({kind:j.kind,teamId,accountId:account.id,authorizationGeneration:account.generation??0,endpoint:original,args,cursor:context.cursor});
  const out=await collectPagedTeamSnapRows({...context,cursor:prepared.cursor,endpoint:prepared.endpoint,refresh:prepared.refresh});
  const count=out.coverage[0]?.count??0;
  out.coverage=[{provider:"teamsnap",account_id:account.id,scope:key("teamsnap",teamId),...teamSnapRefreshCoverage(prepared.refresh,{complete:out.complete,count})}];
  out.coverageState=prepared.refresh.active.mode==='recent'?'partial':out.complete?'complete':'partial';
  out.checkpoint=out.complete?finishTeamSnapRefresh(prepared.refresh,out.traversal):{...out.checkpoint,refresh:prepared.refresh};
  delete out.traversal;
  return out;
}

async function collectPagedTeamSnapRows({j,args,cursor,transport,credential,account,teamId,out,endpoint,refresh}) {
  const team = key("teamsnap",teamId);
  let state = teamSnapPageRequest(j.kind,teamId,endpoint,cursor,{refresh});
  if(state.retry_at > Date.now()) throw Object.assign(new Error("TeamSnap is changing; saved data remains available."),{code:"source_changing",retryAfterMs:state.retry_at-Date.now()});
  const observationsBefore=transport.observations?.length;
  let raw;
  try { raw = await ts(transport,state.url,credential); }
  catch(error) {
    // Page100 is a preference, not a claimed provider maximum. A single first-
    // page HTTP400 may retry the previously working25 partition. Require the
    // exact newly appended transport observation; never infer from error text.
    const observation=Number.isInteger(observationsBefore)&&transport.observations?.length===observationsBefore+1?transport.observations[observationsBefore]:null;
    const requested=new URL(state.url),params=Object.fromEntries(requested.searchParams);
    const firstPreference=j.kind==='attendance'&&state.size>25&&state.pages===0&&state.count===0&&state.offset===0&&state.pass===1&&state.previous===null&&state.digest===null&&state.rolling===null;
    if(firstPreference&&error.code==='source_http'&&observation?.code==='source_http'&&observation.status===400&&observation.endpoint===requested.origin+requested.pathname&&
      observation.params&&Object.keys(observation.params).length===Object.keys(params).length&&Object.entries(params).every(([key,value])=>observation.params[key]===value)) {
      out.complete=false;out.checkpoint=reduceTeamSnapPage(state,25);return out;
    }
    if(error.code!=="record_too_large") throw error;
    out.complete=false;out.checkpoint=reduceTeamSnapPage(state);
    out.coverage.push({provider:"teamsnap",account_id:account.id,kind:j.kind,scope:team,complete:false,count:0,observed_at:stamp()});
    return out;
  }
  try {
  // Missing items is accepted only with explicit scoped empty-page evidence.
  if(raw?.collection && raw.collection.items===undefined && raw.collection.page_info?.total_items===0 && !raw.collection.error) raw={...raw,collection:{...raw.collection,items:[]}};
  const attendance=j.kind==='attendance',all=attendance?collection(raw):unique(collection(raw),r=>native(r.id));
  const ids=all.map(attendance?attendanceIdentity:r=>native(r.id));
  if(attendance)requireValue(new Set(ids).size===ids.length,"TeamSnap attendance contains duplicate event/member pairs.","contract_violation");
  // Validate the whole attendance page before a local byte slice is admitted.
  // Hash the fields persisted by source_attendance, in provider order. Its
  // source_status uses the normalized string status, not raw status-code types
  // or the unused native_status/evidence DTO fields. Generated observation
  // times and unused availability IDs/hrefs cannot invalidate convergence.
  const normalized=attendance?all.map(r=>{
    requireValue(r.team_id==null||['string','number'].includes(typeof r.team_id),"TeamSnap returned a record for another team.","contract_violation");
    assertTeam(r,teamId);return attendanceRecord(r,team,account.id);
  }):null;
  const pageDigest=await signature(attendance?normalized.map(({fixture_id,player_id,team_id,account_id,status,normalized_status})=>({fixture_id,player_id,team_id,account_id,status,normalized_status})):all),metadata=teamSnapPageMetadata(raw,state,all.length);
  if(metadata.reducedSize){out.complete=false;out.checkpoint=reduceTeamSnapPage(state,metadata.reducedSize);return out;}
  if(metadata.changed){out.complete=false;out.checkpoint=restartTeamSnapPass(state);return out;}
  const idDigest=await signature([...ids].sort());
  if(state.pages>0 && (ids.some(id=>(state.previous_ids||[]).includes(id)) || (ids.length&&(state.page_hashes||[]).includes(idDigest)))){
    // Offset pagination may shift while the source changes. Never count a
    // repeated/overlapping page as new data or let it certify completeness.
    out.complete=false;out.checkpoint=restartTeamSnapPass(state);return out;
  }
  const changedPage=state.digest&&state.digest!==pageDigest;
  if(changedPage){
    state={...state,page_changes:(state.page_changes||0)+1};
    if(state.page_changes>=3){out.complete=false;out.checkpoint={...restartTeamSnapPass(state),pass:1,retry_at:Date.now()+900000};return out;}
  }
  const offset=changedPage?0:state.offset;
  requireValue(offset<=all.length,"Invalid TeamSnap page offset.","contract_violation");
  const candidates=attendance?normalized.slice(offset):all.slice(offset).map(r=>{assertTeam(r,teamId);return event(r,teamId,args,account.id);});
  const consumed=teamSnapBatchLength(j.kind,candidates,{accountId:account.id,scanId:j.scan_id});
  if(j.kind==='events')out.fixtures=candidates.slice(0,consumed);else out.records.attendance=candidates.slice(0,consumed);
  Object.assign(out,await advanceTeamSnapPage(state,metadata,pageDigest,all.length,offset,consumed,ids,idDigest));
  out.coverage.push({provider:"teamsnap",account_id:account.id,kind:j.kind,scope:team,complete:out.complete,
    count:out.complete?state.count+all.length:state.count+offset+consumed,observed_at:stamp()});
  return out;
  } catch(error) { throw annotateTeamSnapAttendance(error,{kind:j.kind,raw,state,teamId}); }
}

export async function collectTeamSnap({ j, args = {}, cursor = {}, transport, credential, account }) {
  requireValue(account?.provider === "teamsnap" && account.id && native(account.native_id) && credential, "TeamSnap is disconnected.", "authentication_required");
  const out = { records: {}, fixtures: [], children: [], complete: true, checkpoint: { finished: true }, coverage: [], replacements: [] };
  if (j.kind === "catalog" && !cursor.url) {
    const raw = await ts(transport, "me", credential), me = collection(raw)[0];
    requireValue(native(me?.id) === native(account.native_id), "TeamSnap returned another account.", "account_access_lost");
    const links = [...new Set([url(API, "teams/search", { user_id: me.id }),
      ...(raw.collection.links || []).filter((l) => TEAM_RELS.has(l.rel)).map((l) => catalogURL(l.href,account.native_id)),
      ...Object.entries(me.links || {}).filter(([rel]) => TEAM_RELS.has(rel)).map(([, href]) => catalogURL(href,account.native_id))])];
    return { ...out, complete: false, checkpoint: { url: links[0], remaining: links.slice(1), visited: [], offset: 0 } };
  }
  requireValue(j.kind === "catalog" || Object.hasOwn(RELS, j.kind), "Unsupported TeamSnap job.", "invalid_job");
  const teamId = j.kind === "catalog" ? null : native(args.team_id);
  requireValue(j.kind === "catalog" || teamId, "TeamSnap team identity is missing.", "contract_violation");
  if(["events","attendance"].includes(j.kind)) return collectPagedTeamSnap({j,args,cursor,transport,credential,account,teamId,out});
  const requested = tsURL(cursor.url || args.url || url(API, RELS[j.kind] + "/search", { team_id: teamId }));
  const endpoint = j.kind==='catalog'?catalogURL(requested,account.native_id):requested;
  const endpointTeam = new URL(endpoint).searchParams.get("team_id");
  if (teamId && endpointTeam !== null) requireValue(native(endpointTeam) === teamId, "TeamSnap endpoint belongs to another team.", "contract_violation");
  let raw = await ts(transport, endpoint, credential);
  if(j.kind==='catalog'&&emptyCatalogSearch(raw,endpoint,account.native_id))raw={...raw,collection:{...raw.collection,items:[]}};
  const all = unique(collection(raw), (r) => native(r.id)), digest = await signature(all);
  const offset = cursor.digest && cursor.digest !== digest ? 0 : Number(cursor.offset || 0);
  requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset <= all.length, "Invalid TeamSnap checkpoint.", "contract_violation");
  const rows = all.slice(offset, offset + (j.kind === "catalog" ? 20 : PAGE_SIZE)), next = nextPage(raw), moreRows = offset + rows.length < all.length;
  const visited = [...(cursor.visited || [])], pageMark = (await signature(endpoint)).slice(0, 16), nextMark = next ? (await signature(next)).slice(0, 16) : null;
  if (!moreRows) visited.push(pageMark);
  requireValue(visited.length <= 200 && (!nextMark || !visited.includes(nextMark)), "TeamSnap pagination repeated a page or exceeded its bound.", "unsupported_response");
  const remaining = j.kind==='catalog'?[...new Set((cursor.remaining||[]).map(href=>catalogURL(href,account.native_id)))].filter(href=>href!==endpoint):cursor.remaining||[], nextURL = moreRows ? endpoint : next || remaining[0];
  out.complete = !nextURL;
  out.checkpoint = nextURL ? { url: nextURL, offset: moreRows ? offset + rows.length : 0, digest: moreRows ? digest : null,
    remaining: moreRows || next ? remaining : remaining.slice(1), visited } : { finished: true };
  const accountId = account.id, team = teamId ? key("teamsnap", teamId) : null;
  if (j.kind === "catalog") {
    out.records.teams = rows.map((r) => ({ ...teamRecord("teamsnap", r.id, r.name || r.team_name,
      { timezone: text(r.time_zone || r.timezone) || null, season_start_date: text(r.season_start_date) || null, season_end_date: text(r.season_end_date) || null, links: r.links, source_url: r.href, catalog_scan_id: j.scan_id, account_owned: true },
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
        details: JSON.stringify({ position: text(r.position || r.position_name), active: r.is_active !== false, roster_start_date:text(r.roster_start_date)||null,roster_end_date:text(r.roster_end_date)||null }), observed_at: stamp() }));
      out.records.team_players = out.records.players.map((p) => ({ team_id: team, player_id: p.id, account_id: accountId, active: +(parse(p.details).active !== false), scan_id: j.scan_id }));
    } else if (j.kind === "events") out.fixtures = rows.map((r) => event(r, teamId, args, accountId));
    else if (j.kind === "attendance") out.records.attendance = rows.map(r=>attendanceRecord(r,team,accountId));
    else out.records.references_data = rows.map((r) => ({ team_id: team, account_id: accountId, kind: j.kind, id: native(r.id),
      value: JSON.stringify({ name: text(r.name || r.label), address: text(r.address), city: text(r.city), state: text(r.state), zip: text(r.zip) }), observed_at: stamp() }));
  }
  out.coverage.push({ provider: "teamsnap", account_id: accountId, kind: j.kind, scope: team || accountId, complete: out.complete, count: rows.length, observed_at: stamp() });
  if (out.complete && ["catalog", "roster"].includes(j.kind)) out.replacements.push({ kind: j.kind, team_id: team, account_id: accountId, scan_id: j.scan_id });
  return out;
}
