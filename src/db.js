import { bytes, fail, stamp } from "./core.js";
export class DB {
  constructor(raw, limit = 48) {
    this.raw = raw;
    this.limit = limit;
    this.used = 0;
    this.read = 0;
    this.written = 0;
  }
  prepare(q) {
    const p = this.raw.prepare(q),
      self = this;
    function wrap(s) {
      return {
        bind(...a) {
          return wrap(s.bind(...a));
        },
        async first(column) {
          self.reserve(1);
          const r = await s.all();
          self.measure(r);
          const first = r.results[0] || null;
          return column && first ? (first[column] ?? null) : first;
        },
        async all() {
          self.reserve(1);
          const r = await s.all();
          self.measure(r);
          return r;
        },
        async run() {
          self.reserve(1);
          const r = await s.run();
          self.measure(r);
          return r;
        },
        _raw: s,
      };
    }
    return wrap(p);
  }
  reserve(n) {
    if (this.used + n > this.limit)
      throw fail(
        "Work continues in another background invocation.",
        409,
        "invocation_limit",
      );
    this.used += n;
  }
  async batch(stmts) {
    this.reserve(stmts.length);
    const r = await this.raw.batch(stmts.map((s) => s._raw || s));
    r.forEach((x) => this.measure(x));
    return r;
  }
  measure(r) {
    this.read += Number(r?.meta?.rows_read) || 0;
    this.written += Number(r?.meta?.rows_written) || 0;
  }
}
export const TABLES = {
  references_data: ["team_id", "kind", "id", "value", "observed_at"],
  teams: [
    "id",
    "provider",
    "native_id",
    "name",
    "club_id",
    "season",
    "archived",
    "details",
    "observed_at",
  ],
  clubs: ["id", "provider", "native_id", "name", "logo"],
  competitions: [
    "id",
    "provider",
    "native_id",
    "name",
    "kind",
    "starts_on",
    "ends_on",
    "details",
    "observed_at",
  ],
  divisions: ["id", "competition_id", "name", "details", "observed_at"],
  memberships: [
    "team_id",
    "division_id",
    "registration_id",
    "evidence",
    "observed_at",
  ],
  team_fixtures: ["team_id", "fixture_id", "starts_at"],
  players: [
    "id",
    "provider",
    "native_id",
    "name",
    "jersey",
    "details",
    "observed_at",
  ],
  team_players: ["team_id", "player_id", "active", "scan_id"],
  attendance: ["fixture_id", "player_id", "status", "observed_at"],
  identity_links: ["a", "b", "kind", "evidence", "observed_at"],
  standings: [
    "division_id",
    "pool_id",
    "team_id",
    "rank",
    "payload",
    "scan_id",
    "observed_at",
  ],
  space_teams: ["space_id", "team_id", "role"],
  spaces: ["id", "name", "created_at"],
  trace_parts: ["fixture_id", "team_id", "part", "value", "observed_at"],
  trace_stats: [
    "fixture_id",
    "team_id",
    "player_id",
    "period",
    "value",
    "state",
    "observed_at",
  ],
};
const PRIMARY = {
  references_data: ["team_id", "kind", "id"],
  memberships: ["team_id", "division_id", "registration_id"],
  team_fixtures: ["team_id", "fixture_id"],
  team_players: ["team_id", "player_id"],
  attendance: ["fixture_id", "player_id"],
  identity_links: ["a", "b"],
  standings: ["division_id", "pool_id", "team_id"],
  space_teams: ["space_id", "team_id"],
  trace_parts: ["fixture_id", "team_id", "part"],
  trace_stats: ["fixture_id", "team_id", "player_id", "period"],
};
export function bulk(db, table, rows, guard = "1", guardArgs = []) {
  if (!rows.length) return null;
  const cols = TABLES[table];
  if (!cols) throw new Error("Unknown table");
  for (const row of rows) {
    if (bytes(row) > 1_100_000)
      throw fail("A source record is too large.", 502, "record_size");
    for (const c of cols)
      if (row[c] === undefined) throw new Error(`Missing ${table}.${c}`);
  }
  const keys = PRIMARY[table] || ["id"];
  let updates = cols
    .filter((c) => !keys.includes(c))
    .map((c) => `${c}=excluded.${c}`)
    .join(",");
  if (table === "teams")
    updates = cols
      .filter((c) => !keys.includes(c))
      .map((c) =>
        c === "details"
          ? "details=json_patch(teams.details,excluded.details)"
          : ["club_id", "season"].includes(c)
            ? `${c}=COALESCE(NULLIF(excluded.${c},''),teams.${c})`
            : c === "name"
              ? "name=CASE WHEN (json_extract(teams.details,'$.profile')=1 AND COALESCE(json_extract(excluded.details,'$.profile'),0)<>1) OR (excluded.name LIKE 'Team %' AND teams.name NOT LIKE 'Team %') THEN teams.name ELSE excluded.name END"
              : `${c}=excluded.${c}`,
      )
      .join(",");
  if (table === "team_players")
    updates =
      "active=CASE WHEN excluded.scan_id='' THEN team_players.active ELSE excluded.active END,scan_id=CASE WHEN excluded.scan_id='' THEN team_players.scan_id ELSE excluded.scan_id END";
  if (table === "clubs")
    updates = updates.replace(
      "logo=excluded.logo",
      "logo=COALESCE(excluded.logo,clubs.logo)",
    );
  if (table === "competitions")
    updates = cols
      .filter((c) => !keys.includes(c))
      .map((c) =>
        c === "details"
          ? "details=json_patch(competitions.details,excluded.details)"
          : ["starts_on", "ends_on"].includes(c)
            ? `${c}=COALESCE(excluded.${c},competitions.${c})`
            : c === "kind"
              ? "kind=CASE WHEN excluded.kind='unknown' THEN competitions.kind ELSE excluded.kind END"
              : c === "name"
                ? "name=CASE WHEN excluded.name='Competition' THEN competitions.name ELSE excluded.name END"
                : `${c}=excluded.${c}`,
      )
      .join(",");
  if (table === "divisions")
    updates =
      "competition_id=excluded.competition_id,name=CASE WHEN excluded.name='Published category' THEN divisions.name ELSE excluded.name END,details=CASE WHEN excluded.name='Published category' THEN divisions.details ELSE excluded.details END,observed_at=excluded.observed_at";
  const payload = JSON.stringify(rows);
  if (bytes(payload) > 1_750_000)
    throw fail("Provider page exceeds the transaction size.", 502, "page_size");
  return db
    .prepare(
      `INSERT INTO ${table}(${cols.join(",")}) SELECT ${cols.map((c) => `json_extract(value,'$.${c}')`).join(",")} FROM json_each(?) WHERE (${guard}) ON CONFLICT(${keys.join(",")}) DO UPDATE SET ${updates}`,
    )
    .bind(payload, ...guardArgs);
}
export async function writeRows(db, table, rows) {
  const q = bulk(db, table, rows);
  if (q) await q.run();
}
export function teamRecord(provider, id, name, details = {}, extra = {}) {
  return {
    id: `${provider}:${id}`,
    provider,
    native_id: String(id),
    name: String(name || `Team ${id}`),
    club_id: null,
    season: null,
    archived: 0,
    details: JSON.stringify(details),
    observed_at: stamp(),
    ...extra,
  };
}
