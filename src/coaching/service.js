import {acceptedGameSeason} from '../domain/game-season-state.js';
import {COACH_SLOTS,COACH_POSITIONS,starterSuggestion,substitutionRecommendations} from '../../web/app/coach-tactics.js';
import {statisticalSelectionSQL} from '../read-model/inclusion.js';
import {playerSeasonQuery} from '../analysis/reads.js';

const POSITIONS = new Set([...COACH_POSITIONS,"LF","RF"]);
const SLOTS = new Set([...COACH_SLOTS.map(s=>s.id),"LF","RF"]);
const MAX_GAP = 12 * 36e5;
const fail = (message, status = 400, code = "coach_invalid") => Object.assign(new Error(message), { status, code });
const id = (value) => {
  if (typeof value !== "string" || !value || value.length > 128) throw fail("Choose a valid team, season, match, or player.");
  return value;
};
const uuid = () => crypto.randomUUID();
const clone = (value) => structuredClone(value);
const stable = (value) => JSON.stringify(value);
const stamp = (at) => new Date(at).toISOString();
function own(actor) {
  if (!actor?.owner && actor?.role !== "owner") throw fail("Coach is available only to the owner.", 403, "owner_required");
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail("Supply the current revision.");
  return value;
}
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function finite(value, min, max, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw fail(label);
  return value;
}
function validateProfile(value) {
  if (!object(value) || Object.keys(value).some((k) => !["positions", "endurance", "target_minutes"].includes(k))) throw fail("Invalid Coach attributes.");
  const positions = value.positions ?? {};
  if (!object(positions) || Object.keys(positions).length > 3 || Object.entries(positions).some(([p, n]) => !POSITIONS.has(p) || !Number.isInteger(n) || n < 1 || n > 5)) throw fail("Rate up to three positions from 1 to 5.");
  if (value.endurance != null && (!Number.isInteger(value.endurance) || value.endurance < 1 || value.endurance > 5)) throw fail("Rate endurance from 1 to 5.");
  if (value.target_minutes != null && (!Number.isInteger(value.target_minutes) || value.target_minutes < 0 || value.target_minutes > 180)) throw fail("Choose whole target minutes from 0 to 180.");
  return { positions: { ...positions }, endurance: value.endurance ?? null, target_minutes: value.target_minutes ?? null };
}
function scopeParams(scope) {
  return [scope.team_id, scope.team_season_id, scope.event_id];
}
function liveClock(s, at) {
  const gap = s.phase === "running" ? Math.max(0, at - Date.parse(s.running_since)) : 0;
  return { elapsed: s.elapsed_ms + (gap <= MAX_GAP ? gap : 0), review: s.clock_review || gap > MAX_GAP, unaccounted: gap > MAX_GAP ? gap : 0 };
}
function closeOpen(s, at) {
  for (const stint of s.stints) if (stint.end_ms == null) stint.end_ms = at;
}
function openField(s, at) {
  for (const [position, player_id] of Object.entries(s.field)) s.stints.push({ id: uuid(), player_id, position, period: s.period, start_ms: at, end_ms: null });
}
function advance(s, at) {
  if (s.phase !== "running") return;
  const clock = liveClock(s, at);
  if (clock.review) throw fail("The clock needs review. Pause and correct it before continuing.", 409, "clock_review");
  s.elapsed_ms = clock.elapsed;
  s.running_since = stamp(at);
}
function checkField(s, field) {
  if (!object(field)) throw fail("Choose a valid lineup.");
  const values = Object.values(field);
  if (Object.keys(field).some((p) => !SLOTS.has(p)) || values.some((p) => !s.players.some((r) => r.player_id === p && r.available)) || new Set(values).size !== values.length || values.length > s.format) throw fail("Use distinct available players in valid positions within the playing format.");
}
function minutes(s, end) {
  const result = Object.fromEntries(s.players.map((p) => [p.player_id, 0]));
  for (const t of s.stints) result[t.player_id] = (result[t.player_id] || 0) + Math.max(0, (t.end_ms ?? end) - t.start_ms);
  return result;
}
function changeField(s, next) {
  checkField(s, next);
  if (s.phase === "running") {
    for (const t of s.stints) if (t.end_ms == null && next[t.position] !== t.player_id) t.end_ms = s.elapsed_ms;
    for (const [position, player_id] of Object.entries(next)) if (s.field[position] !== player_id) s.stints.push({ id: uuid(), player_id, position, period: s.period, start_ms: s.elapsed_ms, end_ms: null });
  }
  s.field = { ...next };
}
function lateCorrection(s, a) {
  const valid = new Set(s.players.map((p) => p.player_id));
  if (!["paused", "halftime", "finished"].includes(s.phase) || !valid.has(a.out) || !valid.has(a.in) || a.out === a.in) throw fail("Pause or finish before correcting a substitution.");
  const start = Math.round(finite(a.at_minutes, 0, s.elapsed_ms / 6e4, "Choose a valid substitution time.") * 6e4);
  const end = start + Math.round(finite(a.duration, 1e-3, s.elapsed_ms / 6e4, "Choose a valid substitution duration.") * 6e4);
  if (end > s.elapsed_ms) throw fail("That correction extends beyond the recorded match clock.");
  if (s.players.some((p) => [a.out, a.in].includes(p.player_id) && p.minutes_override_ms != null)) throw fail("Restore the affected player-minute overrides before correcting their timeline.");
  const affected = s.stints.filter((t) => t.player_id === a.out && t.start_ms < end && (t.end_ms ?? s.elapsed_ms) > start).sort((x, y) => x.start_ms - y.start_ms);
  if (affected.length > 250) throw fail("Correct this long interval in smaller sections.");
  let covered = start;
  for (const t of affected) {
    const from = Math.max(start, t.start_ms), to = Math.min(end, t.end_ms ?? s.elapsed_ms);
    if (from !== covered) throw fail("The outgoing player was not on the field throughout that interval.");
    if (s.stints.some((other) => other.player_id === a.in && other.start_ms < to && (other.end_ms ?? s.elapsed_ms) > from)) throw fail("The incoming player was already on the field during that interval.");
    covered = to;
  }
  if (covered !== end) throw fail("The outgoing player was not on the field throughout that interval.");
  const replaced = new Set(affected.map((t) => t.id));
  s.stints = s.stints.filter((t) => !replaced.has(t.id));
  for (const t of affected) {
    const from = Math.max(start, t.start_ms), to = Math.min(end, t.end_ms ?? s.elapsed_ms), oldEnd = t.end_ms ?? s.elapsed_ms;
    if (t.start_ms < from) s.stints.push({ ...t, id: uuid(), end_ms: from });
    s.stints.push({ ...t, id: uuid(), player_id: a.in, start_ms: from, end_ms: to });
    if (to < oldEnd) s.stints.push({ ...t, id: uuid(), start_ms: to, end_ms: oldEnd });
  }
  // A missed substitution ending at the stopped clock also changes the
  // current field, as in the original Coach workflow. Earlier interval-only
  // repairs retain the current lineup.
  if(end===s.elapsed_ms){const position=Object.keys(s.field).find(key=>s.field[key]===a.out);if(position){if(!s.players.some(p=>p.player_id===a.in&&p.available)||Object.values(s.field).includes(a.in))throw fail("Choose an available bench player for the missed substitution.");changeField(s,{...s.field,[position]:a.in});}}
  return { range_start_ms: start, range_end_ms: end };
}
function correction(s, a) {
  if (!["paused", "halftime", "finished"].includes(s.phase)) throw fail("Pause or finish before correcting the clock or minutes.");
  if (a.elapsed_ms != null) {
    const next = Math.round(finite(a.elapsed_ms, 0, MAX_GAP, "Choose a valid corrected clock."));
    if (next < s.period_start_ms) throw fail("The corrected clock cannot move before the start of this half.");
    if (next < s.elapsed_ms) {
      s.stints = s.stints.filter((t) => t.start_ms < next).map((t) => ({ ...t, end_ms: Math.min(t.end_ms ?? s.elapsed_ms, next) }));
    } else if (next > s.elapsed_ms) {
      checkField(s,s.field);
      for (const [position, player_id] of Object.entries(s.field)) s.stints.push({ id: uuid(), player_id, position, period: s.period, start_ms: s.elapsed_ms, end_ms: next });
    }
    s.elapsed_ms = next;
  }
  if (a.minutes != null) {
    if (!object(a.minutes)) throw fail("Choose valid player-minute corrections.");
    for (const [player, mins] of Object.entries(a.minutes)) {
      const p = s.players.find((p2) => p2.player_id === player);
      if (!p) throw fail("Choose a player in this match.");
      p.minutes_override_ms = mins == null ? null : Math.round(finite(mins, 0, s.elapsed_ms / 6e4, "Player minutes cannot exceed the recorded match clock.") * 6e4);
    }
  }
  const base = minutes(s, s.elapsed_ms), resolved = s.players.map((p) => p.minutes_override_ms ?? base[p.player_id]);
  if (resolved.some((ms) => ms > s.elapsed_ms) || resolved.reduce((a2, b) => a2 + b, 0) > s.format * s.elapsed_ms) throw fail("Player-minute corrections exceed the playing capacity. Correct the clock or another player too.");
  s.clock_review = false;
}
function applyCoachCommand(session, action, at = Date.now()) {
  if (!object(action) || typeof action.type !== "string") throw fail("Choose a Coach action.");
  const s = clone(session), a = {...action}, requestedType=a.type, type = ({finish:"end",next_half:"resume",sub:"substitute"})[a.type]??a.type;
  if (s.history.length >= 1e3) throw fail("The match timeline has reached its limit.", 409, "coach_history");
  let extra = {};
  if(type === "configure") {
    if(s.phase!=="setup")throw fail("Configure the game before starting the clock.",409,"coach_state");
    if(![7,9].includes(a.format)||!Number.isInteger(a.half_minutes)||a.half_minutes<5||a.half_minutes>90)throw fail("Choose 7v7 or 9v9 and a half length from 5 to 90 minutes.");
    if(Object.keys(s.field).length>a.format)throw fail("Remove starters before reducing the game format.");
    s.format=a.format;s.half_minutes=a.half_minutes;
  } else if (type === "availability") {
    if (!["setup", "paused", "halftime"].includes(s.phase) || !Array.isArray(a.players)) throw fail("Pause before changing availability.");
    const selected = new Set(a.players);
    if (selected.size !== a.players.length || a.players.some((p) => !s.players.some((r) => r.player_id === p))) throw fail("Choose distinct roster players.");
    if (Object.values(s.field).some((p) => !selected.has(p))) throw fail("Remove unavailable players from the field first.");
    s.players.forEach((p) => {
      p.available = selected.has(p.player_id);
      p.availability_source = "coach";
    });
  } else if (type === "lineup") {
    if (!["setup", "paused", "halftime"].includes(s.phase)) throw fail("Pause before changing the lineup.");
    changeField(s, a.field);
  } else if (type === "start" || type === "resume") {
    if (requestedType === "next_half" && s.phase !== "halftime" || (type === "start" ? s.phase !== "setup" : !["paused", "halftime"].includes(s.phase))) throw fail("That clock action is unavailable.", 409);
    if (s.clock_review) throw fail("Correct the interrupted clock before resuming.", 409, "clock_review");
    checkField(s, s.field);
    if (Object.keys(s.field).length !== s.format) throw fail(`Place ${s.format} players before starting.`, 409);
    if(s.phase==="halftime"){s.period=2;s.period_start_ms=s.elapsed_ms;}
    s.phase = "running";
    s.running_since = stamp(at);
    openField(s, s.elapsed_ms);
  } else if (type === "pause") {
    if (s.phase !== "running") throw fail("The clock is already paused.", 409);
    const clock = liveClock(s, at);
    if (clock.review) s.clock_review = true;
    else advance(s, at);
    closeOpen(s, s.elapsed_ms);
    s.phase = "paused";
    s.running_since = null;
  } else if (type === "substitute") {
    if (!["running", "paused"].includes(s.phase)) throw fail("Start the match first.", 409);
    const position = Object.entries(s.field).find(([, p]) => p === a.out)?.[0];
    if (!position || !s.players.some((p) => p.player_id === a.in && p.available) || Object.values(s.field).includes(a.in)) throw fail("Choose an on-field player and an available bench player.");
    advance(s, at);
    changeField(s, { ...s.field, [position]: a.in });
    extra.position = position;
  } else if (type === "move") {
    if (!["setup", "running", "paused", "halftime"].includes(s.phase) || !SLOTS.has(a.position)) throw fail("Choose a valid position move.");
    const old = Object.entries(s.field).find(([, p]) => p === a.player)?.[0];
    if (!old) throw fail("Choose an on-field player.");
    advance(s, at);
    const next = { ...s.field }, other = next[a.position];
    delete next[old];
    next[a.position] = a.player;
    if (other) next[old] = other;
    changeField(s, next);
  } else if (type === "halftime" || type === "end") {
    if (!["running", "paused", "halftime"].includes(s.phase) || type === "halftime" && (s.period !== 1 || s.phase === "halftime")) throw fail("That match action is unavailable.", 409);
    advance(s, at);
    closeOpen(s, s.elapsed_ms);
    s.running_since = null;
    if (type === "halftime") {
      s.phase = "halftime";

    } else s.phase = "finished";
  } else if (type === "correct") correction(s, a);
  else if (type === "late_substitute") extra = lateCorrection(s, a);
  else if(type === "correct_sub"){if(!Object.values(s.field).includes(a.out)||Object.values(s.field).includes(a.in)||!s.players.some(p=>p.player_id===a.in&&p.available))throw fail("Choose an on-field player and available substitute.");const delta=finite(a.delta,1,3600000,"Choose a valid missed substitution duration.");if(!Number.isInteger(delta))throw fail("Choose whole milliseconds.");const base=minutes(s,s.elapsed_ms),out=s.players.find(p=>p.player_id===a.out),incoming=s.players.find(p=>p.player_id===a.in),outValue=out.minutes_override_ms,inValue=incoming.minutes_override_ms;if((outValue??base[a.out])<delta||(inValue??base[a.in])+delta>s.elapsed_ms)throw fail("The missed substitution exceeds the players’ recorded time.");out.minutes_override_ms=null;incoming.minutes_override_ms=null;extra=lateCorrection(s,{...a,at_minutes:(s.elapsed_ms-delta)/60000,duration:delta/60000});if(outValue!=null)out.minutes_override_ms=outValue-delta;if(inValue!=null)incoming.minutes_override_ms=inValue+delta;}
  else if(type === "adjust_clock"){const delta=finite(a.delta,-900000,900000,"Adjust the clock by at most 15 minutes.");if(!Number.isInteger(delta))throw fail("Choose whole milliseconds.");const before=minutes(s,s.elapsed_ms),on=new Set(Object.values(s.field)),values=Object.fromEntries(s.players.map(p=>[p.player_id,((p.minutes_override_ms??before[p.player_id])+(on.has(p.player_id)?delta:0))/60000])),overridden=new Set(s.players.filter(p=>p.minutes_override_ms!=null).map(p=>p.player_id));correction(s,{elapsed_ms:s.elapsed_ms+delta,minutes:values});const after=minutes(s,s.elapsed_ms);for(const p of s.players)if(!overridden.has(p.player_id)&&p.minutes_override_ms===after[p.player_id])p.minutes_override_ms=null;}
  else if(type === "adjust_minutes"){const delta=finite(a.delta,-3600000,3600000,"Adjust player minutes by at most 60 minutes."),p=s.players.find(p=>p.player_id===a.player);if(!Number.isInteger(delta)||!p)throw fail("Choose a roster player and whole milliseconds.");correction(s,{minutes:{[a.player]:((p.minutes_override_ms??minutes(s,s.elapsed_ms)[a.player])+delta)/60000}});}
  else throw fail("Unknown Coach action.");
  const detail = {};
  if(type === "configure"){detail.format=s.format;detail.half_minutes=s.half_minutes;}
  if(a.delta!=null)detail.delta=a.delta;
  if (type === "lineup") detail.field = s.field;
  if (type === "availability") detail.players = a.players;
  if (type === "correct") {
    if (a.elapsed_ms != null) detail.elapsed_ms = s.elapsed_ms;
    if (a.minutes != null) detail.minutes = a.minutes;
  }
  s.history.push({ id: uuid(), sequence: s.history.length + 1, kind: requestedType, period: s.period, match_ms: s.elapsed_ms, recorded_at: stamp(at), player_out: a.out ?? null, player_in: a.in ?? a.player ?? null, position: extra.position ?? a.position ?? null, range_start_ms: extra.range_start_ms ?? null, range_end_ms: extra.range_end_ms ?? null, detail });
  return s;
}
function presentCoachSession(session, at = Date.now()) {
  if (!session) return null;
  const s = session, clock = liveClock(s, at), base = minutes(s, clock.elapsed), resolved = Object.fromEntries(s.players.map((p) => [p.player_id, p.minutes_override_ms ?? base[p.player_id]]));
  const history = s.history.map((h) => ({ ...h, type: h.kind, at: h.recorded_at, elapsed_ms: h.match_ms, label: h.kind.replaceAll("_", " "), clock_label: `${Math.floor(h.match_ms / 6e4)}:${String(Math.floor(h.match_ms / 1e3) % 60).padStart(2, "0")}` }));
  return { sampled_at: at, period_start_ms: s.period_start_ms, revision: s.revision, format: s.format, half_minutes: s.half_minutes, phase: s.phase, period: s.period, elapsed_ms: s.elapsed_ms, live_elapsed_ms: clock.elapsed, period_elapsed_ms: clock.elapsed - s.period_start_ms, running_since: s.running_since, clock_review: Boolean(clock.review), unaccounted_ms: clock.unaccounted, clock: { elapsed_ms: s.elapsed_ms, running_since: s.running_since }, field: { ...s.field }, active: s.players.filter((p) => p.available).map((p) => p.player_id), minutes_ms: resolved, recorded_minutes_ms: base, minutes_capacity_ms: s.format * clock.elapsed, minutes_recorded_total_ms: Object.values(base).reduce((a, b) => a + b, 0), minutes_total_ms: Object.values(resolved).reduce((a, b) => a + b, 0), roster: s.players.map((p) => ({ id: p.player_id, name: p.name, jersey: p.jersey, available: Boolean(p.available), availability_source: p.availability_source, minutes: resolved[p.player_id] / 6e4, minutes_overridden: p.minutes_override_ms != null })), history, timeline: history };
}
function suggestCoachLineup(session, profiles = {}, hints = {}, at = Date.now()) {
  return starterSuggestion(presentCoachSession(session,at),profiles,hints);
}
function suggestCoachSubstitutions(session,profiles={},hints={},at=Date.now()){
  return substitutionRecommendations(presentCoachSession(session,at),profiles,hints);
}
class CoachingService {
  constructor(db, actor, { now = () => Date.now(), resolveAvailability, resolveRoleHints } = {}) {
    this.db = db;
    this.actor = actor;
    this.now = now;
    this.resolveAvailability = resolveAvailability ?? ((scope) => this.attendanceAvailability(scope));
    this.resolveRoleHints = resolveRoleHints??(scope=>this.roleHints(scope));
  }
  async writeTeam(teamId, statements, gameScope=null) {
    own(this.actor);
    const token = uuid(), accepted=gameScope?acceptedGameSeason(teamId,gameScope.team_season_id,gameScope.event_id):{sql:'1',params:[]};
    try {
      return (await this.db.batch([this.db.prepare(`INSERT INTO coach_write_fences VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM app_teams WHERE id=?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=?) AND (${accepted.sql}) THEN 1 ELSE 0 END)`).bind(token, teamId, teamId,...accepted.params), ...statements, this.db.prepare("DELETE FROM coach_write_fences WHERE token=?").bind(token)])).slice(1, -1);
    } catch (error) {
      if (String(error.message).includes("coach_team_alive")) {
        if(gameScope&&!(await this.db.prepare(`SELECT ${accepted.sql} AS accepted`).bind(...accepted.params).first())?.accepted)throw fail("This match moved to another season. Reload before editing.",409,"revision_conflict");
        throw fail("This team was removed. Reload before editing.", 409, "team_removed");
      }
      throw error;
    }
  }
  async attendanceAvailability(scope) {
    own(this.actor);
    const rows = (await this.db.prepare("SELECT player_id,status FROM canonical_attendance WHERE app_team_id=? AND team_season_id=? AND event_id=?").bind(...scopeParams(scope)).all()).results, labels = { No: "no", Yes: "yes", Maybe: "maybe", NR: "nr", Unknown: "unknown" }, result = {};
    for (const player of new Set(rows.map((p) => p.player_id))) {
      const statuses = new Set(rows.filter((p) => p.player_id === player).map((p) => labels[p.status] ?? "unknown"));
      result[player] = statuses.size === 1 ? [...statuses][0] : "unresolved";
    }
    return result;
  }
  async roleHints(scope) {
    own(this.actor);
    const season=await this.db.prepare("SELECT include_june FROM team_seasons WHERE app_team_id=? AND id=?").bind(scope.team_id,scope.team_season_id).first();
    const selection={...scope,mode:'season',period:'all',type:'all',search:'',include_june:!!season?.include_june,timezone:'UTC'};
    const summary=playerSeasonQuery(selection),selected=statisticalSelectionSQL(selection);
    const rows=await this.db.batch([
      this.db.prepare(`SELECT p.id,p.position,json_extract(o.fields,'$.position') AS assigned_position FROM (${summary.sql}) p LEFT JOIN analysis_overrides o ON o.app_team_id=? AND o.team_season_id=? AND o.kind='player_season' AND o.event_id='' AND o.player_id=p.id`).bind(...summary.params,scope.team_id,scope.team_season_id),
      this.db.prepare(`WITH recent AS(SELECT p.player_id,p.minutes,ROW_NUMBER() OVER(PARTITION BY p.player_id ORDER BY COALESCE(e.local_day,substr(e.starts_at,1,10)) DESC,e.event_id DESC) AS rank FROM effective_player_matches p JOIN team_events e ON e.app_team_id=p.app_team_id AND e.team_season_id=p.team_season_id AND e.event_id=p.event_id JOIN match_analysis a ON a.app_team_id=p.app_team_id AND a.team_season_id=p.team_season_id AND a.event_id=p.event_id JOIN source_events source ON source.id=a.source_event_id AND source.provider='trace' WHERE p.app_team_id=? AND p.team_season_id=? AND ${selected} AND e.status IN('FINAL','COMPLETED') AND p.minutes>0) SELECT player_id,minutes FROM recent WHERE rank<=5 ORDER BY player_id,rank DESC`).bind(scope.team_id,scope.team_season_id)
    ]);
    const hints=Object.fromEntries(rows[0].results.map(p=>[p.id,{assigned_position:p.assigned_position??null,resolved_position:p.position??null,recent_trace_minutes:[]}]));
    for(const p of rows[1].results)if(hints[p.player_id])hints[p.player_id].recent_trace_minutes.push(p.minutes);
    return hints;
  }
  async canonicalId(kind, value) {
    own(this.actor);
    id(value);
    const view = kind === "player" ? "canonical_player_ids" : "canonical_event_ids";
    const row = await this.db.prepare(`SELECT canonical_id FROM ${view} WHERE input_id=?`).bind(value).first();
    return row?.canonical_id ?? value;
  }
  async context(scope, { event = false, player = false } = {}) {
    own(this.actor);
    id(scope.team_id);
    id(scope.team_season_id);
    const season = await this.db.prepare("SELECT s.* FROM team_seasons s JOIN app_teams t ON t.id=s.app_team_id WHERE s.app_team_id=? AND s.id=?").bind(scope.team_id, scope.team_season_id).first();
    if (!season) throw fail("That team season is unavailable.", 404, "selection_invalid");
    if (event) {
      scope.event_id = await this.canonicalId("event", scope.event_id);
      const accepted=acceptedGameSeason(scope.team_id,scope.team_season_id,scope.event_id);
      const row = await this.db.prepare(`SELECT * FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=? AND (${accepted.sql})`).bind(...scopeParams(scope),...accepted.params).first();
      if (!row) throw fail("That match is unavailable.", 404, "event_not_found");
      if (row.type !== "game" || row.conditional) throw fail("Coach requires a confirmed game.", 409, "coach_unavailable");
    }
    if (player) {
      scope.player_id = await this.canonicalId("player", scope.player_id);
      if (!await this.db.prepare("SELECT 1 FROM team_players WHERE app_team_id=? AND team_season_id=? AND player_id=?").bind(scope.team_id, scope.team_season_id, scope.player_id).first()) throw fail("That player is not in this team season.", 404, "player_not_found");
    }
    return season;
  }
  async profiles(scope) {
    scope = { ...scope };
    const season = await this.context(scope);
    const latest = `WITH ranked AS(SELECT p.*,c.canonical_id,s.year,row_number() OVER(PARTITION BY p.player_id ORDER BY s.year DESC) AS rank FROM coach_profiles p JOIN team_seasons s ON s.id=p.team_season_id JOIN canonical_player_ids c ON c.input_id=p.player_id WHERE p.app_team_id=? AND s.year<=? AND EXISTS(SELECT 1 FROM team_players r WHERE r.app_team_id=? AND r.team_season_id=? AND r.player_id=c.canonical_id))`;
    const params = [scope.team_id, season.year, scope.team_id, scope.team_season_id];
    const result = await this.db.batch([
      this.db.prepare(`${latest} SELECT * FROM ranked WHERE rank=1 ORDER BY player_id`).bind(...params),
      this.db.prepare(`${latest} SELECT r.* FROM coach_profile_positions r JOIN ranked p ON p.app_team_id=r.app_team_id AND p.team_season_id=r.team_season_id AND p.player_id=r.player_id WHERE p.rank=1`).bind(...params)
    ]);
    const profiles = {}, rows = result[0].results, ratings = result[1].results;
    const model = (row) => ({ player_id: row.canonical_id, source_player_id: row.player_id, team_season_id: row.team_season_id, revision: row.team_season_id === scope.team_season_id ? row.revision : 0, inherited: row.team_season_id !== scope.team_season_id, source_revision: row.revision, value: { endurance: row.endurance, target_minutes: row.target_minutes, positions: Object.fromEntries(ratings.filter((p) => p.team_season_id === row.team_season_id && p.player_id === row.player_id).map((p) => [p.position, p.rating])) } });
    for (const canonical of new Set(rows.map((p) => p.canonical_id))) {
      const candidates = rows.filter((p) => p.canonical_id === canonical), latestYear = Math.max(...candidates.map((p) => p.year)), latestRows = candidates.filter((p) => p.year === latestYear);
      profiles[canonical] = latestRows.length === 1 ? model(latestRows[0]) : { player_id: canonical, conflict: true, revision: null, choices: latestRows.map(model) };
    }
    return profiles;
  }
  async setProfile(scope, value, expectedRevision) {
    scope = { ...scope };
    await this.context(scope, { player: true });
    const logical = (await this.profiles(scope))[scope.player_id];
    if (logical?.conflict) throw fail("Choose which Coach attributes to retain for this linked player.", 409, "private_identity_conflict");
    const physical = logical && !logical.inherited ? logical.source_player_id : scope.player_id;
    const v = validateProfile(value), r = revision(expectedRevision), token = uuid(), at = stamp(this.now()), key = [scope.team_id, scope.team_season_id, physical];
    const first = r === 0 ? this.db.prepare("INSERT INTO coach_profiles(app_team_id,team_season_id,player_id,endurance,target_minutes,revision,updated_at,write_token) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING").bind(...key, v.endurance, v.target_minutes, at, token) : this.db.prepare("UPDATE coach_profiles SET endurance=?,target_minutes=?,revision=revision+1,updated_at=?,write_token=? WHERE app_team_id=? AND team_season_id=? AND player_id=? AND revision=?").bind(v.endurance, v.target_minutes, at, token, ...key, r);
    const guard = "EXISTS(SELECT 1 FROM coach_profiles p WHERE p.app_team_id=? AND p.team_season_id=? AND p.player_id=? AND p.write_token=?)";
    const result = await this.writeTeam(scope.team_id, [first, this.db.prepare(`DELETE FROM coach_profile_positions WHERE app_team_id=? AND team_season_id=? AND player_id=? AND ${guard}`).bind(...key, ...key, token), this.db.prepare(`INSERT INTO coach_profile_positions SELECT ?,?,?,json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?) WHERE ${guard}`).bind(...key, stable(Object.entries(v.positions)), ...key, token)]);
    if (result[0].meta.changes !== 1) throw fail("Coach attributes changed on another device. Reload before saving.", 409, "revision_conflict");
    return { player_id: scope.player_id, team_season_id: scope.team_season_id, revision: r + 1, inherited: false, value: v };
  }
  async load(scope) {
    own(this.actor);
    const candidates = (await this.db.prepare("SELECT s.* FROM coach_sessions s JOIN canonical_event_ids c ON c.input_id=s.event_id WHERE s.app_team_id=? AND s.team_season_id=? AND c.canonical_id=?").bind(...scopeParams(scope)).all()).results;
    if (candidates.length > 1) throw Object.assign(fail("Choose which private Coach plan to retain for this linked match.", 409, "private_identity_conflict"), { conflict: { kind: "session", choices: candidates.map((s) => ({ event_id: s.event_id, revision: s.revision, phase: s.phase, format: s.format, elapsed_ms: s.elapsed_ms, updated_at: s.updated_at })) } });
    const row = candidates[0];
    if (!row) return null;
    const key = [scope.team_id, scope.team_season_id, row.event_id], result = await this.db.batch([
      this.db.prepare("SELECT * FROM coach_session_players WHERE app_team_id=? AND team_season_id=? AND event_id=? ORDER BY name COLLATE NOCASE,player_id").bind(...key),
      this.db.prepare("SELECT position,player_id FROM coach_lineup WHERE app_team_id=? AND team_season_id=? AND event_id=?").bind(...key),
      this.db.prepare("SELECT id,player_id,position,period,start_ms,end_ms FROM coach_stints WHERE app_team_id=? AND team_season_id=? AND event_id=? ORDER BY start_ms,id").bind(...key),
      this.db.prepare("SELECT * FROM coach_timeline WHERE app_team_id=? AND team_season_id=? AND event_id=? ORDER BY sequence").bind(...key)
    ]);
    const mapping = (await this.db.prepare("SELECT c.input_id,c.canonical_id FROM canonical_player_ids c JOIN coach_session_players p ON p.player_id=c.input_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.event_id=?").bind(...key).all()).results, map = Object.fromEntries(mapping.map((p) => [p.input_id, p.canonical_id]));
    const roster = result[0].results.map((p) => ({ ...p, storage_player_id: p.player_id, player_id: map[p.player_id] ?? p.player_id, available: Boolean(p.available) }));
    if (new Set(roster.map((p) => p.player_id)).size !== roster.length) throw Object.assign(fail("This plan contains two entries for a linked player. Choose the retained entry.", 409, "private_identity_conflict"), { conflict: { kind: "session_player", event_id: row.event_id, revision: row.revision, choices: roster.map((p) => ({ player_id: p.player_id, source_player_id: p.storage_player_id, name: p.name })) } });
    return { ...row, clock_review: Boolean(row.clock_review), players: roster, field: Object.fromEntries(result[1].results.map((p) => [p.position, map[p.player_id] ?? p.player_id])), stints: result[2].results.map((p) => ({ ...p, player_id: map[p.player_id] ?? p.player_id })), history: result[3].results.map((p) => ({ ...p, player_out: map[p.player_out] ?? p.player_out, player_in: map[p.player_in] ?? p.player_in, detail: JSON.parse(p.detail) })) };
  }
  async read(scope) {
    scope = { ...scope };
    await this.context(scope, { event: true });
    let session, identity_conflict;
    try {
      session = await this.load(scope);
    } catch (error) {
      if (error.code !== "private_identity_conflict") throw error;
      identity_conflict = error.conflict;
    }
    const attendance = await this.resolveAvailability(scope), roster = (await this.db.prepare("SELECT player_id AS id,name,jersey FROM team_players WHERE app_team_id=? AND team_season_id=? ORDER BY name COLLATE NOCASE,player_id").bind(scope.team_id, scope.team_season_id).all()).results.map((p) => ({ ...p, available: attendance[p.id] !== "no", availability_source: attendance[p.id] ? `attendance:${attendance[p.id]}` : "attendance:unknown" }));
    const formatRow=await this.db.prepare("SELECT format FROM match_analysis WHERE app_team_id=? AND team_season_id=? AND event_id=?").bind(...scopeParams(scope)).first();
    const profiles=await this.profiles(scope),role_hints=await this.resolveRoleHints(scope),at=this.now(),values=Object.fromEntries(Object.entries(profiles).filter(([,p])=>!p.conflict).map(([key,p])=>[key,p.value]));
    return { owner: true, event_id: scope.event_id, format: [7,9].includes(formatRow?.format)?formatRow.format:7, session: presentCoachSession(session, at), roster, profiles, role_hints, recommendations: session?suggestCoachSubstitutions(session,values,role_hints,at):[], ...identity_conflict ? { identity_conflict } : {} };
  }
  async command(scope, action, expectedRevision) {
    scope = { ...scope };
    await this.context(scope, { event: true });
    if (action?.type === "resolve_session_identity") return this.resolveSessionIdentity(scope, action);
    if (action?.type === "resolve_player_identity") return this.resolveSessionPlayerIdentity(scope, action, expectedRevision);
    const r = revision(expectedRevision), existing = await this.load(scope), at = this.now();
    if (action?.type === "create") {
      if (existing || r !== 0) throw fail("A Coach plan already exists. Reload it.", 409, "revision_conflict");
      const format = Number(action.format ?? 7), half = Number(action.half_minutes ?? 25);
      if (![7, 9].includes(format) || !Number.isInteger(half) || half < 5 || half > 90) throw fail("Choose 7v7 or 9v9 and a half length from 5 to 90 minutes.");
      const roster = (await this.db.prepare("SELECT player_id,name,jersey FROM team_players WHERE app_team_id=? AND team_season_id=? ORDER BY name COLLATE NOCASE,player_id").bind(scope.team_id, scope.team_season_id).all()).results;
      if (!roster.length || roster.length > 100) throw fail("A Coach plan needs a roster of 1 to 100 players.");
      const attendance = await this.resolveAvailability(scope);
      const next2 = { format, half_minutes: half, phase: "setup", period: 1, elapsed_ms: 0, period_start_ms: 0, running_since: null, clock_review: false, field: {}, players: roster.map((p) => ({ ...p, available: attendance[p.player_id] !== "no", availability_source: attendance[p.player_id] ? `attendance:${attendance[p.player_id]}` : "attendance:unknown", minutes_override_ms: null })), stints: [], history: [] };
      await this.persist(scope, null, next2, r, at);
      return { session: presentCoachSession({ ...next2, revision: 1 }, at) };
    }
    if (!existing || existing.revision !== r) throw fail("The Coach plan changed on another device. Reload before editing.", 409, "revision_conflict");
    if (action?.type === "suggest") {
      const profiles = await this.profiles(scope);
      if (Object.values(profiles).some((p) => p.conflict)) throw fail("Resolve conflicting Coach attributes before requesting a suggestion.", 409, "private_identity_conflict");
      return { revision: r, suggestion: suggestCoachLineup(existing, Object.fromEntries(Object.entries(profiles).map(([k, p]) => [k, p.value])), await this.resolveRoleHints(scope), at) };
    }
    const next = applyCoachCommand(existing, action, at);
    await this.persist(scope, existing, next, r, at);
    return { session: presentCoachSession({ ...next, revision: r + 1 }, at) };
  }
  resolutionExpected(expected, key, keep) {
    if (!Array.isArray(expected) || expected.length < 2 || expected.length > 100 || new Set(expected.map((p) => p[key])).size !== expected.length || !expected.some((p) => p[key] === keep)) throw fail("Confirm each conflicting record and the one to retain.");
    for (const row of expected) {
      id(row[key]);
      if (revision(row.revision) === 0) throw fail("Supply the current revisions of both records.");
    }
    return expected;
  }
  async resolutionBatch(statements, teamId, gameScope=null) {
    own(this.actor);
    try {
      return await this.writeTeam(teamId, statements,gameScope);
    } catch (error) {
      if (String(error.message).includes("expected_count=actual_count") || String(error.message).includes("expected_matches=actual_matches")) throw fail("These private records changed on another device. Reload before choosing.", 409, "revision_conflict");
      throw error;
    }
  }
  async resolveProfileIdentity(scope, choice) {
    scope = { ...scope };
    await this.context(scope, { player: true });
    if (choice?.discard !== true) throw fail("Explicitly confirm discarding the other private attributes.");
    const conflict = (await this.profiles(scope))[scope.player_id];
    if (!conflict?.conflict) throw fail("These attributes no longer require a choice. Reload.", 409, "revision_conflict");
    const sourceSeason = conflict.choices[0].team_season_id;
    const keep = id(choice.keep_player_id), expected = this.resolutionExpected(choice.expected, "player_id", keep), token = uuid(), n = expected.length, key = [scope.team_id, sourceSeason, scope.player_id];
    const filter = "p.app_team_id=? AND p.team_season_id=? AND p.player_id IN(SELECT input_id FROM canonical_player_ids WHERE canonical_id=?)";
    const first = this.db.prepare(`INSERT INTO coach_resolution_preconditions VALUES(?,?,(SELECT count(*) FROM coach_profiles p WHERE ${filter}),?,(SELECT count(*) FROM coach_profiles p JOIN json_each(?) x ON p.player_id=json_extract(x.value,'$.player_id') AND p.revision=json_extract(x.value,'$.revision') WHERE ${filter}))`).bind(token, n, ...key, n, stable(expected), ...key);
    const guard = "EXISTS(SELECT 1 FROM coach_resolution_preconditions WHERE id=?)";
    await this.resolutionBatch([first, this.db.prepare(`DELETE FROM coach_profiles WHERE app_team_id=? AND team_season_id=? AND player_id IN(SELECT input_id FROM canonical_player_ids WHERE canonical_id=?) AND player_id<>? AND ${guard}`).bind(...key, keep, token), this.db.prepare(`UPDATE coach_profiles SET revision=revision+1,updated_at=?,write_token=? WHERE app_team_id=? AND team_season_id=? AND player_id=? AND ${guard}`).bind(stamp(this.now()), token, scope.team_id, sourceSeason, keep, token), this.db.prepare("DELETE FROM coach_resolution_preconditions WHERE id=?").bind(token)], scope.team_id);
    return { profile: (await this.profiles(scope))[scope.player_id] };
  }
  async resolveSessionIdentity(scope, choice) {
    own(this.actor);
    if (choice?.discard !== true) throw fail("Explicitly confirm discarding the other private plan.");
    const keep = id(choice.keep_event_id), expected = this.resolutionExpected(choice.expected, "event_id", keep), token = uuid(), n = expected.length, key = scopeParams(scope);
    const filter = "s.app_team_id=? AND s.team_season_id=? AND s.event_id IN(SELECT input_id FROM canonical_event_ids WHERE canonical_id=?)";
    const first = this.db.prepare(`INSERT INTO coach_resolution_preconditions VALUES(?,?,(SELECT count(*) FROM coach_sessions s WHERE ${filter}),?,(SELECT count(*) FROM coach_sessions s JOIN json_each(?) x ON s.event_id=json_extract(x.value,'$.event_id') AND s.revision=json_extract(x.value,'$.revision') WHERE ${filter}))`).bind(token, n, ...key, n, stable(expected), ...key);
    const guard = "EXISTS(SELECT 1 FROM coach_resolution_preconditions WHERE id=?)", statements = [first];
    for (const table of ["coach_stints", "coach_lineup", "coach_session_players", "coach_timeline", "coach_sessions"]) statements.push(this.db.prepare(`DELETE FROM ${table} WHERE app_team_id=? AND team_season_id=? AND event_id IN(SELECT input_id FROM canonical_event_ids WHERE canonical_id=?) AND event_id<>? AND ${guard}`).bind(...key, keep, token));
    statements.push(this.db.prepare(`UPDATE coach_sessions SET revision=revision+1,updated_at=?,write_token=? WHERE app_team_id=? AND team_season_id=? AND event_id=? AND ${guard}`).bind(stamp(this.now()), token, scope.team_id, scope.team_season_id, keep, token), this.db.prepare("DELETE FROM coach_resolution_preconditions WHERE id=?").bind(token));
    await this.resolutionBatch(statements, scope.team_id,scope);
    return { session: (await this.read(scope)).session };
  }
  async resolveSessionPlayerIdentity(scope, choice, expectedRevision) {
    own(this.actor);
    if (choice?.discard !== true) throw fail("Explicitly confirm discarding the duplicate private entry and its recorded intervals.");
    const keep = id(choice.keep_player_id), r = revision(expectedRevision), rows = (await this.db.prepare("SELECT s.* FROM coach_sessions s JOIN canonical_event_ids c ON c.input_id=s.event_id WHERE s.app_team_id=? AND s.team_season_id=? AND c.canonical_id=?").bind(...scopeParams(scope)).all()).results;
    if (rows.length !== 1) throw fail("Choose the retained private match plan first.", 409, "private_identity_conflict");
    const session = rows[0];
    if (session.revision !== r) throw fail("The Coach plan changed on another device.", 409, "revision_conflict");
    const key = [scope.team_id, scope.team_season_id, session.event_id], canonical = await this.canonicalId("player", keep), members = (await this.db.prepare("SELECT p.player_id FROM coach_session_players p JOIN canonical_player_ids c ON c.input_id=p.player_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.event_id=? AND c.canonical_id=?").bind(...key, canonical).all()).results;
    if (members.length < 2 || !members.some((p) => p.player_id === keep)) throw fail("Choose an entry from this conflicting plan.");
    const removed = members.filter((p) => p.player_id !== keep).map((p) => p.player_id), token = uuid(), at = this.now(), clock = liveClock(session, at), elapsed = clock.elapsed, phase = session.phase === "running" ? "paused" : session.phase;
    const first = this.db.prepare("UPDATE coach_sessions SET phase=?,running_since=NULL,elapsed_ms=?,clock_review=?,revision=revision+1,updated_at=?,write_token=? WHERE app_team_id=? AND team_season_id=? AND event_id=? AND revision=?").bind(phase, elapsed, Number(clock.review), stamp(at), token, ...key, r), guard = "EXISTS(SELECT 1 FROM coach_sessions s WHERE s.app_team_id=? AND s.team_season_id=? AND s.event_id=? AND s.write_token=?)", guardParams = [...key, token], statements = [first];
    statements.push(this.db.prepare(`UPDATE coach_stints SET end_ms=? WHERE app_team_id=? AND team_season_id=? AND event_id=? AND end_ms IS NULL AND ${guard}`).bind(elapsed, ...key, ...guardParams));
    for (const table of ["coach_stints", "coach_lineup", "coach_session_players"]) statements.push(this.db.prepare(`DELETE FROM ${table} WHERE app_team_id=? AND team_season_id=? AND event_id=? AND player_id IN(SELECT value FROM json_each(?)) AND ${guard}`).bind(...key, stable(removed), ...guardParams));
    statements.push(this.db.prepare(`INSERT INTO coach_timeline SELECT ?,?,?,?,COALESCE(max(sequence),0)+1,'resolve_player_identity',?,?,?,NULL,?,NULL,NULL,NULL,? FROM coach_timeline WHERE app_team_id=? AND team_season_id=? AND event_id=? AND ${guard} HAVING ${guard}`).bind(uuid(), ...key, session.period, elapsed, stamp(at), keep, stable({ retained_player_id: keep, discarded_player_ids: removed }), ...key, ...guardParams, ...guardParams));
    const result = await this.writeTeam(scope.team_id, statements,scope);
    if (result[0].meta.changes !== 1) throw fail("The Coach plan changed on another device.", 409, "revision_conflict");
    return { session: (await this.read(scope)).session };
  }
  async persist(scope, old, next, r, at) {
    own(this.actor);
    const key = [scope.team_id, scope.team_season_id, old?.event_id ?? scope.event_id], stored = Object.fromEntries(next.players.map((p) => [p.player_id, p.storage_player_id ?? p.player_id])), storagePlayers = next.players.map((p) => ({ ...p, player_id: stored[p.player_id] })), storageField = Object.fromEntries(Object.entries(next.field).map(([position, p]) => [position, stored[p]])), token = uuid(), first = old ? this.db.prepare("UPDATE coach_sessions SET format=?,half_minutes=?,phase=?,period=?,elapsed_ms=?,period_start_ms=?,running_since=?,clock_review=?,revision=revision+1,updated_at=?,write_token=? WHERE app_team_id=? AND team_season_id=? AND event_id=? AND revision=?").bind(next.format, next.half_minutes, next.phase, next.period, next.elapsed_ms, next.period_start_ms, next.running_since, Number(next.clock_review), stamp(at), token, ...key, r) : this.db.prepare("INSERT INTO coach_sessions(app_team_id,team_season_id,event_id,format,half_minutes,phase,period,elapsed_ms,period_start_ms,running_since,clock_review,revision,updated_at,write_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING").bind(...key, next.format, next.half_minutes, next.phase, next.period, next.elapsed_ms, next.period_start_ms, next.running_since, Number(next.clock_review), stamp(at), token);
    const guard = "EXISTS(SELECT 1 FROM coach_sessions s WHERE s.app_team_id=? AND s.team_season_id=? AND s.event_id=? AND s.write_token=?)", guardParams = [...key, token], statements = [first];
    if (!old) statements.push(this.db.prepare(`INSERT INTO coach_session_players SELECT ?,?,?,json_extract(value,'$.player_id'),json_extract(value,'$.name'),json_extract(value,'$.jersey'),json_extract(value,'$.available'),json_extract(value,'$.availability_source'),json_extract(value,'$.minutes_override_ms') FROM json_each(?) WHERE ${guard}`).bind(...key, stable(storagePlayers), ...guardParams));
    else if (stable(old.players) !== stable(storagePlayers)) statements.push(this.db.prepare(`UPDATE coach_session_players SET available=json_extract((SELECT value FROM json_each(?) WHERE json_extract(value,'$.player_id')=coach_session_players.player_id),'$.available'),availability_source=json_extract((SELECT value FROM json_each(?) WHERE json_extract(value,'$.player_id')=coach_session_players.player_id),'$.availability_source'),minutes_override_ms=json_extract((SELECT value FROM json_each(?) WHERE json_extract(value,'$.player_id')=coach_session_players.player_id),'$.minutes_override_ms') WHERE app_team_id=? AND team_season_id=? AND event_id=? AND ${guard}`).bind(stable(storagePlayers), stable(storagePlayers), stable(storagePlayers), ...key, ...guardParams));
    if (!old || stable(old.field) !== stable(next.field)) statements.push(this.db.prepare(`DELETE FROM coach_lineup WHERE app_team_id=? AND team_season_id=? AND event_id=? AND ${guard}`).bind(...key, ...guardParams), this.db.prepare(`INSERT INTO coach_lineup SELECT ?,?,?,key,value FROM json_each(?) WHERE ${guard}`).bind(...key, stable(storageField), ...guardParams));
    const oldStints = new Map((old?.stints ?? []).map((p) => [p.id, p])), newStints = new Map(next.stints.map((p) => [p.id, p])), removed = [...oldStints.keys()].filter((k) => !newStints.has(k)), changed = next.stints.filter((p) => !oldStints.has(p.id) || stable(oldStints.get(p.id)) !== stable(p));
    if (removed.length) statements.push(this.db.prepare(`DELETE FROM coach_stints WHERE id IN(SELECT value FROM json_each(?)) AND app_team_id=? AND team_season_id=? AND event_id=? AND ${guard}`).bind(stable(removed), ...key, ...guardParams));
    if (changed.length) statements.push(this.db.prepare(`INSERT INTO coach_stints SELECT json_extract(value,'$.id'),?,?,?,json_extract(value,'$.player_id'),json_extract(value,'$.position'),json_extract(value,'$.period'),json_extract(value,'$.start_ms'),json_extract(value,'$.end_ms') FROM json_each(?) WHERE ${guard} ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,position=excluded.position,period=excluded.period,start_ms=excluded.start_ms,end_ms=excluded.end_ms`).bind(...key, stable(changed.map((p) => ({ ...p, player_id: stored[p.player_id] }))), ...guardParams));
    const added = next.history.slice(old?.history.length ?? 0);
    if (added.length) statements.push(this.db.prepare(`INSERT INTO coach_timeline SELECT json_extract(value,'$.id'),?,?,?,json_extract(value,'$.sequence'),json_extract(value,'$.kind'),json_extract(value,'$.period'),json_extract(value,'$.match_ms'),json_extract(value,'$.recorded_at'),json_extract(value,'$.player_out'),json_extract(value,'$.player_in'),json_extract(value,'$.position'),json_extract(value,'$.range_start_ms'),json_extract(value,'$.range_end_ms'),json_extract(value,'$.detail') FROM json_each(?) WHERE ${guard}`).bind(...key, stable(added.map((p) => ({ ...p, player_out: stored[p.player_out] ?? p.player_out, player_in: stored[p.player_in] ?? p.player_in }))), ...guardParams));
    const result = await this.writeTeam(scope.team_id, statements,scope);
    if (result[0].meta.changes !== 1) throw fail("The Coach plan changed on another device. Reload before editing.", 409, "revision_conflict");
  }
}
export {
  CoachingService,
  applyCoachCommand,
  presentCoachSession,
  suggestCoachLineup,
  suggestCoachSubstitutions,
  validateProfile
};
