import { fail, key, parse, stamp, text, bytes } from "./core.js";
import { spaceAccess } from "./auth.js";
import { teamRecord, writeRows } from "./db.js";
import { enqueueRoot, job, retry } from "./jobs.js";
import { seasonRange, seasonSettings, dayStart } from "./services/season.js";
export const allowedCorrections = new Set([
  "match",
  "player",
  "identity",
  "player_link",
  "fixture_link",
  "season",
]);
export async function teamsInSpace(db, space, includeFollowed = false) {
  const rows = (
    await db
      .prepare(
        `WITH roots AS (SELECT team_id AS id FROM space_teams WHERE space_id=? ${includeFollowed ? "" : "AND role<>'followed'"} ${includeFollowed ? "UNION SELECT entity_id FROM favorites WHERE space_id=? AND kind='team'" : ""}) SELECT t.* FROM teams t WHERE t.id IN (SELECT id FROM roots UNION SELECT b FROM identity_links WHERE a IN (SELECT id FROM roots) AND kind='provider_external_key' UNION SELECT a FROM identity_links WHERE b IN (SELECT id FROM roots) AND kind='provider_external_key') ORDER BY t.provider,t.name`,
      )
      .bind(space, ...(includeFollowed ? [space] : []))
      .all()
  ).results;
  const own = includeFollowed
    ? new Set((await teamsInSpace(db, space, false)).map((t) => t.id))
    : new Set(rows.map((t) => t.id));
  return rows.map((r) => ({
    ...r,
    role: own.has(r.id) ? "connected" : "followed",
    details: parse(r.details),
  }));
}
export async function getSpace(db, a, url) {
  const id = url.searchParams.get("space") || a.space;
  if (!id) throw fail("Choose a team.");
  spaceAccess(a, id);
  if (!(await db.prepare("SELECT id FROM spaces WHERE id=?").bind(id).first()))
    throw fail("Team space was not found.", 404);
  return id;
}
export function projection(r) {
  return {
    ...parse(r.payload),
    ...r,
    payload: undefined,
    conditional: !!r.conditional,
  };
}
export function pageArgs(url) {
  const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit")) || 40),
    ),
    cursor = url.searchParams.get("cursor") || "";
  if (cursor.length > 3000) throw fail("Invalid page cursor.");
  const c = cursor ? parse(atob(cursor), null) : null;
  if (
    cursor &&
    (!c ||
      !Array.isArray(c) ||
      c.length !== 2 ||
      c.some((x) => typeof x !== "string"))
  )
    throw fail("Invalid page cursor.");
  return { limit, cursor: c };
}
export function paged(rows, limit, keyFn) {
  const more = rows.length > limit,
    list = rows.slice(0, limit),
    last = list.at(-1);
  return {
    items: list,
    cursor: more && last ? btoa(JSON.stringify(keyFn(last))) : null,
  };
}
export async function requireTeam(db, a, space, id) {
  let r = await db.prepare("SELECT * FROM teams WHERE id=?").bind(id).first();
  if (!r && /^gotsport:[1-9]\d{0,14}$/.test(id))
    r = teamRecord("gotsport", id.split(":")[1], "Team " + id.split(":")[1]);
  if (!r) throw fail("Team was not found.", 404);
  if (!["gotsport", "live"].includes(r.provider)) {
    const own = await teamsInSpace(db, space, true);
    if (!own.some((t) => t.id === id))
      throw fail("Team is outside this viewer link.", 403);
  }
  return { ...r, details: parse(r.details) };
}
export async function requireFixture(db, a, space, id) {
  const r = await db
    .prepare("SELECT * FROM fixtures WHERE id=?")
    .bind(id)
    .first();
  if (!r) throw fail("Game was not found.", 404);
  if (!["gotsport", "live"].includes(r.provider)) {
    const own = await teamsInSpace(db, space, true);
    if (!own.some((t) => [r.home_id, r.away_id].includes(t.id)))
      throw fail("Game is outside this viewer link.", 403);
  }
  return r;
}
export async function connectPublic(db, space, id, role) {
  const tid = key("gotsport", id);
  await writeRows(db, "teams", [teamRecord("gotsport", id, "Team " + id)]);
  await db
    .prepare(
      "INSERT INTO space_teams VALUES(?,?,?) ON CONFLICT(space_id,team_id) DO UPDATE SET role=CASE WHEN space_teams.role IN ('primary','connected') THEN space_teams.role ELSE excluded.role END",
    )
    .bind(space, tid, role)
    .run();
  await enqueueRoot(
    db,
    job("gotsport", "profile", id, { team_id: id }),
    space,
    role,
    tid,
  );
  await enqueueRoot(
    db,
    job("gotsport", "history", id, { team_id: id }),
    space,
    role,
    tid,
  );
  await enqueueRoot(
    db,
    job("gotsport", "catalog", id, { team_id: id }),
    space,
    role,
    tid,
  );
  await retry(db, `gotsport/catalog/${id}`);
  await retry(db, `gotsport/profile/${id}`);
  await retry(db, `gotsport/history/${id}`);
}
export async function fixturePage(db, space, url) {
  let teams = await teamsInSpace(db, space, false);
  const specific = url.searchParams.get("team");
  if (specific) teams = [{ id: specific }];
  const ids = JSON.stringify(teams.map((t) => t.id)),
    { limit, cursor } = pageArgs(url),
    settings = await seasonSettings(db),
    range = seasonRange(
      url.searchParams.get("season"),
      settings.include_preseason,
    ),
    from = url.searchParams.get("from") || range?.from || "",
    to = url.searchParams.get("to") || range?.to || "",
    fromUTC = from ? dayStart(from, settings.timezone) : "",
    toUTC = to ? dayStart(to, settings.timezone) : "",
    filter = url.searchParams.get("filter") || "all";
  const rows = (
    await db
      .prepare(
        `SELECT f.*,(SELECT json_extract(c.value,'$.trace_fixture_id') FROM corrections c WHERE c.space_id=? AND c.kind='fixture_link' AND c.entity_id=f.id LIMIT 1) AS trace_fixture_id FROM fixtures f WHERE EXISTS(SELECT 1 FROM team_fixtures tf WHERE tf.fixture_id=f.id AND tf.team_id IN (SELECT value FROM json_each(?))) AND (?='' OR (f.starts_at IS NOT NULL AND f.starts_at>=?) OR (f.starts_at IS NULL AND f.local_day>=?)) AND (?='' OR (f.starts_at IS NOT NULL AND f.starts_at<?) OR (f.starts_at IS NULL AND f.local_day<?)) AND (?='all' OR f.type=?) AND (?='' OR (COALESCE(f.starts_at,f.local_day,'9999'),f.id)>(?,?)) AND NOT EXISTS(SELECT 1 FROM corrections c JOIN team_fixtures tf ON tf.fixture_id=c.entity_id WHERE c.space_id=? AND c.kind='fixture_link' AND json_extract(c.value,'$.trace_fixture_id')=f.id AND tf.team_id IN (SELECT value FROM json_each(?))) ORDER BY COALESCE(f.starts_at,f.local_day,'9999'),f.id LIMIT ?`,
      )
      .bind(
        space,
        ids,
        from,
        fromUTC,
        from,
        to,
        toUTC,
        to,
        filter,
        filter,
        cursor ? "yes" : "",
        cursor?.[0] || "",
        cursor?.[1] || "",
        space,
        ids,
        limit + 1,
      )
      .all()
  ).results;
  const out = paged(rows, limit, (r) => [
    r.starts_at || r.local_day || "9999",
    r.id,
  ]);
  out.items = out.items.map(projection);
  return out;
}
export async function upsertCorrection(db, space, b) {
  if (
    !allowedCorrections.has(b.kind) ||
    typeof b.entity_id !== "string" ||
    b.entity_id.length > 200 ||
    bytes(b.value) > 32000
  )
    throw fail("Invalid correction.");
  const revision = Number(b.revision) || 0,
    season = text(b.season, 30),
    value = JSON.stringify(b.value),
    at = stamp();
  if (revision === 0) {
    const r = await db
      .prepare("INSERT OR IGNORE INTO corrections VALUES(?,?,?,?,?,1,?)")
      .bind(space, b.kind, b.entity_id, season, value, at)
      .run();
    if (r.meta.changes !== 1)
      throw fail("Correction changed. Reload.", 409, "revision_conflict");
    return 1;
  }
  const r = await db
    .prepare(
      "UPDATE corrections SET value=?,revision=revision+1,updated_at=? WHERE space_id=? AND kind=? AND entity_id=? AND season=? AND revision=?",
    )
    .bind(value, at, space, b.kind, b.entity_id, season, revision)
    .run();
  if (r.meta.changes !== 1)
    throw fail("Correction changed. Reload.", 409, "revision_conflict");
  return revision + 1;
}
export async function coachRoster(db, space, fixture) {
  const teams = await teamsInSpace(db, space, false),
    own = teams.filter((t) =>
      [fixture.home_id, fixture.away_id].includes(t.id),
    ),
    primary = teams.find((t) => t.provider === "teamsnap") || own[0];
  if (!primary) throw fail("No connected roster is available.", 409);
  const rows = (
    await db
      .prepare(
        "SELECT p.*,a.status FROM players p JOIN team_players tp ON tp.player_id=p.id LEFT JOIN attendance a ON a.player_id=p.id AND a.fixture_id=? WHERE tp.team_id=? AND tp.active=1 ORDER BY p.name",
      )
      .bind(fixture.id, primary.id)
      .all()
  ).results;
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    jersey: p.jersey,
    available: p.status !== "0",
  }));
}
