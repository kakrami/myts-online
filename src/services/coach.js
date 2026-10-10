import { fail, parse, requireValue, stamp } from "../core.js";
const POSITIONS = new Set([
  "GK",
  "LB",
  "CB",
  "RB",
  "LWB",
  "RWB",
  "LM",
  "CM",
  "RM",
  "CDM",
  "CAM",
  "LW",
  "RW",
  "ST",
  "CF",
]);
export function profile(value) {
  const positions = value.positions || {};
  if (
    Object.keys(positions).length > 3 ||
    Object.entries(positions).some(
      ([k, v]) => !POSITIONS.has(k) || !Number.isInteger(v) || v < 1 || v > 5,
    )
  )
    throw fail("Rate up to three positions from 1 to 5.");
  if (
    value.endurance != null &&
    (!Number.isInteger(value.endurance) ||
      value.endurance < 1 ||
      value.endurance > 5)
  )
    throw fail("Rate endurance from 1 to 5.");
  for (const k of ["endurance", "target_minutes"])
    if (
      value[k] != null &&
      (!Number.isFinite(value[k]) ||
        value[k] < 0 ||
        value[k] > (k === "endurance" ? 5 : 180))
    )
      throw fail("Invalid coach rating.");
  return {
    positions,
    endurance: value.endurance ?? null,
    target_minutes: value.target_minutes ?? null,
  };
}
export function elapsed(s, at = Date.now()) {
  return (
    s.elapsed_ms +
    (s.phase === "running" ? Math.max(0, at - Date.parse(s.running_since)) : 0)
  );
}
function account(s, at) {
  if (s.phase !== "running") return;
  const delta = Math.max(0, at - Date.parse(s.running_since));
  if (delta > 12 * 3600000)
    throw fail(
      "Clock has been running too long. Pause and correct the clock.",
      409,
      "clock_review",
    );
  s.elapsed_ms += delta;
  s.period_elapsed_ms += delta;
  for (const id of Object.values(s.field))
    s.minutes_ms[id] = (s.minutes_ms[id] || 0) + delta;
  s.running_since = new Date(at).toISOString();
}
export function createSession(roster, format = 9, half = 25) {
  if (
    ![7, 9].includes(format) ||
    !Number.isInteger(half) ||
    half < 5 ||
    half > 60
  )
    throw fail("Choose 7v7 or 9v9 and a valid half length.");
  return {
    format,
    half_minutes: half,
    phase: "setup",
    period: 1,
    elapsed_ms: 0,
    period_elapsed_ms: 0,
    running_since: null,
    roster,
    active: roster.filter((p) => p.available !== false).map((p) => p.id),
    field: {},
    minutes_ms: {},
    history: [],
  };
}
export function apply(s, action, at = Date.now()) {
  s = structuredClone(s);
  if (s.history.length >= 1000)
    throw fail("The match timeline is full.", 409, "coach_history");
  const valid = new Set(s.roster.map((p) => p.id)),
    type = action.type;
  if (type === "availability") {
    if (!["setup", "paused", "halftime"].includes(s.phase))
      throw fail("Pause the clock to change availability.", 409);
    const list = [...new Set(action.players || [])];
    if (list.some((p) => !valid.has(p))) throw fail("Unknown player.");
    if (Object.values(s.field).some((p) => !list.includes(p)))
      throw fail("Remove excluded players from the field first.");
    s.active = list;
  } else if (type === "lineup") {
    if (!["setup", "paused", "halftime"].includes(s.phase))
      throw fail("Pause before changing the lineup.", 409);
    const f = action.field || {},
      ids = Object.values(f);
    if (
      Object.keys(f).some((p) => !POSITIONS.has(p)) ||
      ids.some((p) => !s.active.includes(p)) ||
      new Set(ids).size !== ids.length ||
      ids.length > s.format
    )
      throw fail("Invalid lineup.");
    s.field = { ...f };
  } else if (type === "start" || type === "resume") {
    if (
      !["setup", "paused", "halftime"].includes(s.phase) ||
      Object.values(s.field).length !== s.format ||
      !s.field.GK
    )
      throw fail(
        `Place ${s.format} players, including a goalkeeper, before starting.`,
        409,
      );
    if (s.clock_review)
      throw fail(
        "Correct the interrupted clock before resuming.",
        409,
        "clock_review",
      );
    s.phase = "running";
    s.running_since = new Date(at).toISOString();
  } else if (type === "pause") {
    if (s.phase !== "running") throw fail("The clock is already paused.", 409);
    const gap = Math.max(0, at - Date.parse(s.running_since));
    if (gap > 12 * 3600000) s.clock_review = { unaccounted_ms: gap };
    else account(s, at);
    s.phase = "paused";
    s.running_since = null;
  } else if (type === "substitute") {
    if (!["running", "paused"].includes(s.phase))
      throw fail("Start the match first.", 409);
    const pos = Object.entries(s.field).find(
      ([, id]) => id === action.out,
    )?.[0];
    if (
      !pos ||
      !s.active.includes(action.in) ||
      Object.values(s.field).includes(action.in)
    )
      throw fail("Select an on-field player and an available bench player.");
    account(s, at);
    s.field[pos] = action.in;
  } else if (type === "move") {
    if (
      !["running", "paused", "setup", "halftime"].includes(s.phase) ||
      !POSITIONS.has(action.position) ||
      !Object.values(s.field).includes(action.player)
    )
      throw fail("Invalid position move.");
    account(s, at);
    const old = Object.entries(s.field).find(
        ([, id]) => id === action.player,
      )[0],
      other = s.field[action.position];
    delete s.field[old];
    s.field[action.position] = action.player;
    if (other) s.field[old] = other;
  } else if (type === "halftime") {
    if (s.period !== 1 || !["running", "paused"].includes(s.phase))
      throw fail("Halftime is unavailable.", 409);
    account(s, at);
    s.phase = "halftime";
    s.period = 2;
    s.period_elapsed_ms = 0;
    s.running_since = null;
  } else if (type === "end") {
    if (!["running", "paused", "halftime"].includes(s.phase))
      throw fail("The match has not started.", 409);
    account(s, at);
    s.phase = "finished";
    s.running_since = null;
  } else if (type === "correct") {
    if (!["paused", "finished"].includes(s.phase))
      throw fail("Pause before correcting the clock or minutes.", 409);
    if (action.elapsed_ms != null) {
      if (
        !Number.isFinite(action.elapsed_ms) ||
        action.elapsed_ms < 0 ||
        action.elapsed_ms > 12 * 3600000
      )
        throw fail("Invalid clock correction.");
      s.elapsed_ms = action.elapsed_ms;
    }
    for (const [id, mins] of Object.entries(action.minutes || {})) {
      if (!valid.has(id) || !Number.isFinite(mins) || mins < 0 || mins > 180)
        throw fail("Invalid minute correction.");
      s.minutes_ms[id] = Math.round(mins * 60000);
    }
    delete s.clock_review;
  } else if (type === "late_substitute") {
    if (
      !["paused", "finished"].includes(s.phase) ||
      !valid.has(action.out) ||
      !valid.has(action.in) ||
      action.out === action.in ||
      !Number.isFinite(action.at_minutes) ||
      !Number.isFinite(action.duration) ||
      action.at_minutes < 0 ||
      action.duration <= 0 ||
      action.at_minutes + action.duration > s.elapsed_ms / 60000
    )
      throw fail("Invalid late substitution correction.");
    const delta = action.duration * 60000;
    if ((s.minutes_ms[action.out] || 0) < delta)
      throw fail(
        "The outgoing player has fewer recorded minutes than that correction.",
      );
    s.minutes_ms[action.out] -= delta;
    s.minutes_ms[action.in] = (s.minutes_ms[action.in] || 0) + delta;
  } else throw fail("Unknown coach action.");
  s.history.push({
    ...action,
    at: new Date(at).toISOString(),
    elapsed_ms: elapsed(s, at),
  });
  return s;
}
export function suggest(s, profiles, hints = {}) {
  const positions =
      s.format === 7
        ? ["GK", "LB", "RB", "LM", "CM", "RM", "ST"]
        : ["GK", "LB", "CB", "RB", "LM", "CM", "RM", "LW", "ST"],
    remaining = s.roster.filter((p) => s.active.includes(p.id)),
    field = {},
    reasons = [];
  for (const pos of positions) {
    const ranked = remaining
      .map((p) => {
        const a = profiles[p.id] || {},
          rating = a.positions?.[pos] || 0,
          played = (s.minutes_ms[p.id] || 0) / 60000,
          hint = hints[p.id],
          family =
            pos === "GK"
              ? "GK"
              : ["LB", "CB", "RB", "LWB", "RWB"].includes(pos)
                ? "DEF"
                : ["LM", "CM", "RM", "CDM", "CAM"].includes(pos)
                  ? "MID"
                  : "FWD",
          hintScore = hint?.position === family ? 6 : 0,
          target = a.target_minutes ?? s.half_minutes,
          score =
            rating * 12 +
            (rating ? 0 : hintScore) +
            Math.max(-20, Math.min(20, (target - played) / 2)) +
            (a.endurance || 0);
        return { p, rating, played, score, hint: hintScore };
      })
      .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
    const chosen = ranked[0];
    if (!chosen) break;
    field[pos] = chosen.p.id;
    reasons.push({
      player: chosen.p.id,
      position: pos,
      reason: `${chosen.rating ? "Manual position rating " + chosen.rating + "/5" : chosen.hint ? "Trace heat-map hint" : "No position evidence"} · ${Math.round(chosen.played)} recorded minutes`,
    });
    remaining.splice(
      remaining.findIndex((p) => p.id === chosen.p.id),
      1,
    );
  }
  return { field, reasons };
}
export async function coachData(db, space, fixture) {
  const row = await db
    .prepare("SELECT * FROM coach_sessions WHERE space_id=? AND fixture_id=?")
    .bind(space, fixture)
    .first();
  return row ? { ...row, value: parse(row.value) } : null;
}
export async function saveSession(db, space, fixture, value, revision) {
  const at = stamp();
  if (revision === 0) {
    const r = await db
      .prepare("INSERT OR IGNORE INTO coach_sessions VALUES(?,?,?,1,?)")
      .bind(space, fixture, JSON.stringify(value), at)
      .run();
    if (r.meta.changes !== 1)
      throw fail(
        "Another device created this match. Reload.",
        409,
        "revision_conflict",
      );
    return 1;
  }
  const r = await db
    .prepare(
      "UPDATE coach_sessions SET value=?,revision=revision+1,updated_at=? WHERE space_id=? AND fixture_id=? AND revision=?",
    )
    .bind(JSON.stringify(value), at, space, fixture, revision)
    .run();
  if (r.meta.changes !== 1)
    throw fail(
      "This match changed on another device. Reload.",
      409,
      "revision_conflict",
    );
  return revision + 1;
}
