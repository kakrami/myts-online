import {
  VERSION,
  body,
  fail,
  json,
  parse,
  stamp,
  text,
  bytes,
} from "../core.js";
import { share } from "../auth.js";
import { matchAnalytics } from "../services/analytics.js";
import {
  allowedCorrections,
  teamsInSpace,
  projection,
  requireFixture,
  fixturePage,
  upsertCorrection,
} from "../api-helpers.js";
export async function adminRoutes(context) {
  const { request, env, db, url, path, method, a, space } = context;
  if (path === "/api/admin/share" && method === "POST") {
    const token = await share(db, space);
    return json({ url: url.origin + "/view/" + token });
  }
  if (path === "/api/admin/conflicts" && method === "POST") {
    const b = await body(request, 4096),
      c = await db
        .prepare("SELECT * FROM conflicts WHERE id=? AND resolved=0")
        .bind(b.id)
        .first();
    if (!c) throw fail("Conflict is no longer open.", 409, "revision_conflict");
    const fixture = await requireFixture(db, a, space, c.fixture_id),
      prior = parse(c.previous),
      incoming = parse(c.incoming);
    if (fixture.revision !== prior.revision)
      throw fail(
        "Game changed. Reload the evidence before resolving.",
        409,
        "revision_conflict",
      );
    const cols = [
        "competition_id",
        "division_id",
        "home_id",
        "away_id",
        "starts_at",
        "local_day",
        "type",
        "status",
        "conditional",
        "home_score",
        "away_score",
        "payload",
        "observed_at",
      ],
      guard = "EXISTS(SELECT 1 FROM conflicts WHERE id=? AND resolved=2)",
      stmts = [
        db
          .prepare(
            "UPDATE conflicts SET resolved=? WHERE id=? AND resolved=0 AND EXISTS(SELECT 1 FROM fixtures WHERE id=? AND revision=?)",
          )
          .bind(b.accept === true ? 2 : 1, c.id, fixture.id, prior.revision),
      ];
    if (b.accept === true) {
      stmts.push(
        db
          .prepare(
            `UPDATE fixtures SET ${cols.map((c) => c + "=?").join(",")},revision=revision+1 WHERE id=? AND revision=? AND ${guard}`,
          )
          .bind(
            ...cols.map((c) => incoming[c] ?? null),
            fixture.id,
            prior.revision,
            c.id,
          ),
        db
          .prepare(`DELETE FROM team_fixtures WHERE fixture_id=? AND ${guard}`)
          .bind(fixture.id, c.id),
        ...["home_id", "away_id"]
          .filter((side) => incoming[side])
          .map((side) =>
            db
              .prepare(
                `INSERT OR IGNORE INTO team_fixtures SELECT ?,?,? WHERE ${guard}`,
              )
              .bind(
                incoming[side],
                fixture.id,
                incoming.starts_at || incoming.local_day || "9999-12-31",
                c.id,
              ),
          ),
        db
          .prepare("UPDATE conflicts SET resolved=1 WHERE id=? AND resolved=2")
          .bind(c.id),
      );
    }
    const r = await db.batch(stmts);
    if (r[0].meta.changes !== 1)
      throw fail("Game changed during resolution.", 409, "revision_conflict");
    return json({ ok: true });
  }
  if (path === "/api/admin/corrections" && method === "PUT") {
    const b = await body(request, 40000);
    if (b.kind === "match") await requireFixture(db, a, space, b.entity_id);
    if (b.kind === "fixture_link") {
      const source = await requireFixture(db, a, space, b.entity_id),
        target = await requireFixture(db, a, space, b.value?.trace_fixture_id);
      if (
        source.provider === "trace" ||
        target.provider !== "trace" ||
        source.type !== "game" ||
        source.conditional ||
        target.conditional
      )
        throw fail("Choose a confirmed game and a Trace game.");
      const duplicate = await db
        .prepare(
          "SELECT entity_id FROM corrections WHERE space_id=? AND kind='fixture_link' AND entity_id<>? AND json_extract(value,'$.trace_fixture_id')=? LIMIT 1",
        )
        .bind(space, b.entity_id, target.id)
        .first();
      if (duplicate)
        throw fail(
          "This Trace game is already matched. Unlink the other schedule entry first.",
          409,
          "identity_conflict",
        );
    }
    if (b.kind === "player_link") {
      const ids = [b.entity_id, b.value?.trace_player_id],
        own = await teamsInSpace(db, space, false),
        p = (
          await db
            .prepare(
              "SELECT DISTINCT p.id,p.provider FROM players p JOIN team_players tp ON tp.player_id=p.id WHERE p.id IN (SELECT value FROM json_each(?)) AND tp.team_id IN (SELECT value FROM json_each(?))",
            )
            .bind(JSON.stringify(ids), JSON.stringify(own.map((t) => t.id)))
            .all()
        ).results;
      if (
        p.length !== 2 ||
        p.find((p) => p.id === ids[0])?.provider !== "teamsnap" ||
        p.find((p) => p.id === ids[1])?.provider !== "trace"
      )
        throw fail("Choose a player from each connected roster.");
    }
    return json({ ok: true, revision: await upsertCorrection(db, space, b) });
  }
  if (path === "/api/admin/corrections" && method === "GET") {
    const kind = url.searchParams.get("kind"),
      entity = url.searchParams.get("entity_id") || "",
      season = url.searchParams.get("season") || "";
    if (!allowedCorrections.has(kind)) throw fail("Choose a correction kind.");
    return json({
      corrections: (
        await db
          .prepare(
            "SELECT * FROM corrections WHERE space_id=? AND kind=? AND (?='' OR entity_id=?) AND (?='' OR season=?) ORDER BY entity_id,season LIMIT 500",
          )
          .bind(space, kind, entity, entity, season, season)
          .all()
      ).results.map((c) => ({ ...c, value: parse(c.value) })),
    });
  }
  if (path === "/api/admin/corrections" && method === "DELETE") {
    const b = await body(request, 4096),
      r = await db
        .prepare(
          "DELETE FROM corrections WHERE space_id=? AND kind=? AND entity_id=? AND season=? AND revision=?",
        )
        .bind(space, b.kind, b.entity_id, b.season || "", b.revision)
        .run();
    if (r.meta.changes !== 1)
      throw fail("Correction changed. Reload.", 409, "revision_conflict");
    return json({ ok: true });
  }
  if (path === "/api/admin/branding" && method === "PUT") {
    const b = await body(request, 400000),
      club = text(b.club_id, 100);
    if (!club) throw fail("A verified club is required.");
    const own = await teamsInSpace(db, space, false);
    if (!own.some((t) => t.club_id === club))
      throw fail("Club is not linked to this team.", 409);
    if (b.logo != null) {
      if (
        b.logo !== "" &&
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.logo)
      )
        throw fail("Use a PNG logo.");
      if (bytes(b.logo) > 350000) throw fail("Logo is too large.", 413);
      await db
        .prepare(
          "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind("logo:" + club, JSON.stringify(b.logo))
        .run();
    }
    if (b.kits != null) {
      if (
        !Array.isArray(b.kits) ||
        b.kits.length > 20 ||
        b.kits.some(
          (k) => !text(k.name, 40) || !/^#[0-9a-f]{6}$/i.test(k.color),
        )
      )
        throw fail("Enter valid kit names and colors.");
      await db
        .prepare(
          "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind("kits:" + club + ":" + text(b.season, 30), JSON.stringify(b.kits))
        .run();
    }
    return json({ ok: true });
  }
  if (path === "/api/admin/export" && method === "GET") {
    const kind = url.searchParams.get("kind") || "fixtures";
    if (kind === "fixture") {
      const fixture = await requireFixture(
        db,
        a,
        space,
        url.searchParams.get("id"),
      );
      return json(
        {
          contract: "myts.source-evidence",
          version: 1,
          app_version: VERSION,
          generated_at: stamp(),
          fixture: projection(fixture),
          analytics:
            fixture.provider === "trace"
              ? await matchAnalytics(db, fixture.id, space)
              : null,
          conflicts: (
            await db
              .prepare(
                "SELECT * FROM conflicts WHERE fixture_id=? ORDER BY observed_at",
              )
              .bind(fixture.id)
              .all()
          ).results.map((c) => ({
            ...c,
            previous: parse(c.previous),
            incoming: parse(c.incoming),
          })),
        },
        200,
        { "Content-Disposition": 'attachment; filename="myts-evidence.json"' },
      );
    }
    if (kind === "diagnostics") {
      const jobs = (
          await db
            .prepare(
              "SELECT id,provider,kind,state,cursor,next_at,lease_until,pages,rows_saved,coverage,last_attempt,last_retrieved,last_saved,last_complete,last_error FROM jobs ORDER BY id LIMIT 2000",
            )
            .all()
        ).results,
        observations = (
          await db
            .prepare("SELECT * FROM observations ORDER BY at DESC LIMIT 100")
            .all()
        ).results;
      return json(
        {
          app_version: VERSION,
          generated_at: stamp(),
          queries: db.used,
          rows_read: db.read,
          rows_written: db.written,
          jobs,
          observations,
        },
        200,
        {
          "Content-Disposition": 'attachment; filename="myts-diagnostics.json"',
        },
      );
    }
    const result = await fixturePage(db, space, url);
    return json(
      { contract: "myts.export", version: 1, app_version: VERSION, ...result },
      200,
      { "Content-Disposition": 'attachment; filename="myts-games.json"' },
    );
  }
}
