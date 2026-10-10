import { body, fail, json, parse, stamp, text } from "../core.js";
import { heatRole } from "../services/analytics.js";
import { localDate } from "../services/season.js";
import * as Coach from "../services/coach.js";
import { teamsInSpace, requireFixture, coachRoster } from "../api-helpers.js";
export async function coachRoutes(context) {
  const { request, env, db, url, path, method, a, space } = context;
  if (path === "/api/admin/coach/profiles" && method === "GET") {
    const season = text(url.searchParams.get("season"), 30),
      rows = (
        await db
          .prepare(
            "SELECT * FROM coach_profiles WHERE space_id=? AND season IN (?,?)",
          )
          .bind(space, season, String(Number(season) - 1))
          .all()
      ).results;
    return json({
      profiles: rows.map((p) => ({ ...p, value: parse(p.value) })),
    });
  }
  if (path === "/api/admin/coach/profiles" && method === "PUT") {
    const b = await body(request, 4096),
      value = Coach.profile(b.value),
      season = text(b.season, 30);
    if (!/^20\d{2}$/.test(season)) throw fail("Invalid season.");
    const revision = Number(b.revision) || 0;
    if (!revision) {
      const r = await db
        .prepare("INSERT OR IGNORE INTO coach_profiles VALUES(?,?,?,?,1,?)")
        .bind(space, b.player_id, season, JSON.stringify(value), stamp())
        .run();
      if (r.meta.changes !== 1)
        throw fail("Profile changed. Reload.", 409, "revision_conflict");
    } else {
      const r = await db
        .prepare(
          "UPDATE coach_profiles SET value=?,revision=revision+1,updated_at=? WHERE space_id=? AND player_id=? AND season=? AND revision=?",
        )
        .bind(
          JSON.stringify(value),
          stamp(),
          space,
          b.player_id,
          season,
          revision,
        )
        .run();
      if (r.meta.changes !== 1)
        throw fail("Profile changed. Reload.", 409, "revision_conflict");
    }
    return json({ ok: true, revision: revision + 1 });
  }
  if (path === "/api/admin/coach" && method === "GET") {
    const id = url.searchParams.get("id"),
      fixture = await requireFixture(db, a, space, id);
    return json({
      session: await Coach.coachData(db, space, id),
      roster: await coachRoster(db, space, fixture),
    });
  }
  if (path === "/api/admin/coach" && method === "POST") {
    const b = await body(request, 32000),
      fixture = await requireFixture(db, a, space, b.fixture_id);
    if (fixture.type !== "game" || fixture.conditional)
      throw fail("Choose a confirmed game.");
    const own = await teamsInSpace(db, space, false);
    if (!own.some((t) => [fixture.home_id, fixture.away_id].includes(t.id)))
      throw fail("Coach is available for your connected teams.");
    let session = await Coach.coachData(db, space, fixture.id);
    if (b.action.type === "create") {
      if (session)
        throw fail("A match session already exists.", 409, "revision_conflict");
      const value = Coach.createSession(
        await coachRoster(db, space, fixture),
        Number(b.action.format),
        Number(b.action.half_minutes),
      );
      const revision = await Coach.saveSession(db, space, fixture.id, value, 0);
      return json({ session: { value, revision } });
    }
    if (!session || session.revision !== b.revision)
      throw fail(
        "Match changed on another device. Reload.",
        409,
        "revision_conflict",
      );
    if (b.action.type === "suggest") {
      const date =
          localDate(fixture.starts_at || fixture.local_day) ||
          new Date().toISOString().slice(0, 10),
        year = String(
          Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 7 ? 1 : 0),
        ),
        profiles = (
          await db
            .prepare(
              "SELECT player_id,value FROM coach_profiles WHERE space_id=? AND season<=? ORDER BY season",
            )
            .bind(space, year)
            .all()
        ).results,
        ids = JSON.stringify(own.map((t) => t.id)),
        scopes = (
          await db
            .prepare(
              "SELECT player_id,value FROM trace_stats WHERE team_id IN (SELECT value FROM json_each(?)) AND period='1' AND state='ready' AND fixture_id=(SELECT s.fixture_id FROM trace_stats s JOIN fixtures f ON f.id=s.fixture_id WHERE s.team_id IN (SELECT value FROM json_each(?)) AND s.period='1' ORDER BY COALESCE(f.starts_at,f.local_day) DESC LIMIT 1)",
            )
            .bind(ids, ids)
            .all()
        ).results,
        links = (
          await db
            .prepare(
              "SELECT entity_id,value FROM corrections WHERE space_id=? AND kind='player_link'",
            )
            .bind(space)
            .all()
        ).results,
        hints = Object.fromEntries(
          scopes.map((s) => [s.player_id, heatRole(parse(s.value).heatmap)]),
        );
      for (const link of links) {
        const traceId = parse(link.value).trace_player_id;
        if (hints[traceId]) hints[link.entity_id] = hints[traceId];
      }
      return json({
        suggestion: Coach.suggest(
          session.value,
          Object.fromEntries(
            profiles.map((p) => [p.player_id, parse(p.value)]),
          ),
          hints,
        ),
      });
    }
    const value = Coach.apply(session.value, b.action),
      revision = await Coach.saveSession(
        db,
        space,
        fixture.id,
        value,
        b.revision,
      );
    return json({ session: { value, revision } });
  }
}
