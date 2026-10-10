import {
  VERSION,
  fail,
  json,
  key,
  native,
  parse,
  stamp,
  text,
} from "../core.js";
import { Transport, unique } from "../providers/http.js";
import { ranking } from "../providers/gotsport.js";
import { matchAnalytics } from "../services/analytics.js";
import { assessAwards } from "../services/awards.js";
import { seasonRange, seasonSettings } from "../services/season.js";
import {
  teamsInSpace,
  projection,
  pageArgs,
  paged,
  requireTeam,
  requireFixture,
  fixturePage,
} from "../api-helpers.js";
export async function catalogRoutes(context) {
  const { request, env, db, url, path, method, a, space } = context;
  if (path === "/api/teams" && method === "GET")
    return json({ teams: await teamsInSpace(db, space, true) });
  if (path === "/api/team" && method === "GET") {
    const id = url.searchParams.get("id"),
      team = await requireTeam(db, a, space, id),
      totals = await db
        .prepare(
          "SELECT COUNT(*) AS fixtures,SUM(f.status='FINAL') AS finals FROM fixtures f JOIN team_fixtures tf ON tf.fixture_id=f.id WHERE tf.team_id=?",
        )
        .bind(id)
        .first(),
      members = (
        await db
          .prepare(
            "SELECT d.*,c.name AS competition_name,c.kind FROM memberships m JOIN divisions d ON d.id=m.division_id JOIN competitions c ON c.id=d.competition_id WHERE m.team_id=? GROUP BY d.id ORDER BY c.starts_on DESC",
          )
          .bind(id)
          .all()
      ).results;
    return json({
      team,
      totals,
      divisions: members.map((d) => ({ ...d, details: parse(d.details) })),
    });
  }
  if (path === "/api/fixtures" && method === "GET") {
    if (url.searchParams.get("team"))
      await requireTeam(db, a, space, url.searchParams.get("team"));
    return json(await fixturePage(db, space, url));
  }
  if (path === "/api/fixture" && method === "GET") {
    const r = await requireFixture(db, a, space, url.searchParams.get("id")),
      attendance = (
        await db
          .prepare(
            "SELECT a.*,p.name,p.jersey FROM attendance a JOIN players p ON p.id=a.player_id WHERE a.fixture_id=? ORDER BY p.name",
          )
          .bind(r.id)
          .all()
      ).results,
      corrections = (
        await db
          .prepare(
            "SELECT * FROM corrections WHERE space_id=? AND kind='match' AND entity_id=?",
          )
          .bind(space, r.id)
          .all()
      ).results.map((c) => ({ ...c, value: parse(c.value) })),
      favorites = await db
        .prepare(
          "SELECT 1 AS saved FROM favorites WHERE space_id=? AND kind='fixture' AND entity_id=?",
        )
        .bind(space, r.id)
        .first(),
      conflicts = (
        await db
          .prepare(
            "SELECT id,kind,previous,incoming,observed_at FROM conflicts WHERE fixture_id=? AND resolved=0 ORDER BY observed_at DESC LIMIT 10",
          )
          .bind(r.id)
          .all()
      ).results.map((c) => ({
        ...c,
        previous: parse(c.previous),
        incoming: parse(c.incoming),
      }));
    const link = await db
        .prepare(
          "SELECT value FROM corrections WHERE space_id=? AND kind='fixture_link' AND entity_id=?",
        )
        .bind(space, r.id)
        .first(),
      traceId =
        r.provider === "trace" ? r.id : parse(link?.value).trace_fixture_id;
    let analytics = null;
    if (traceId) {
      await requireFixture(db, a, space, traceId);
      analytics = await matchAnalytics(db, traceId, space, r.id);
    }
    return json({
      fixture: { ...projection(r), trace_fixture_id: traceId || null },
      attendance,
      corrections,
      saved: !!favorites,
      conflicts,
      analytics,
    });
  }
  if (path === "/api/head-to-head" && method === "GET") {
    const id = url.searchParams.get("id"),
      fixture = await requireFixture(db, a, space, id);
    if (!fixture.home_id || !fixture.away_id || fixture.conditional)
      return json({ games: [], coverage: "unresolved_participants" });
    const rows = (
      await db
        .prepare(
          "SELECT f.* FROM team_fixtures tf JOIN fixtures f ON f.id=tf.fixture_id WHERE tf.team_id=? AND f.id<>? AND f.status='FINAL' AND ((f.home_id=? AND f.away_id=?) OR (f.home_id=? AND f.away_id=?)) ORDER BY COALESCE(f.starts_at,f.local_day) DESC LIMIT 100",
        )
        .bind(
          fixture.home_id,
          id,
          fixture.home_id,
          fixture.away_id,
          fixture.away_id,
          fixture.home_id,
        )
        .all()
    ).results;
    return json({
      games: rows.map(projection),
      coverage: "saved_source_games",
    });
  }
  if (path === "/api/competitions" && method === "GET") {
    const teams = await teamsInSpace(db, space, false),
      ids = JSON.stringify(teams.map((t) => t.id)),
      { limit, cursor } = pageArgs(url),
      rows = (
        await db
          .prepare(
            `SELECT DISTINCT c.*,d.id AS division_id,d.name AS division_name FROM competitions c JOIN divisions d ON d.competition_id=c.id JOIN memberships m ON m.division_id=d.id WHERE m.team_id IN (SELECT value FROM json_each(?)) AND (?='' OR (COALESCE(c.starts_on,''),d.id)>(?,?)) ORDER BY COALESCE(c.starts_on,''),d.id LIMIT ?`,
          )
          .bind(
            ids,
            cursor ? "yes" : "",
            cursor?.[0] || "",
            cursor?.[1] || "",
            limit + 1,
          )
          .all()
      ).results,
      out = paged(rows, limit, (c) => [c.starts_on || "", c.division_id]);
    out.items = out.items.map((c) => ({ ...c, details: parse(c.details) }));
    return json(out);
  }
  if (path === "/api/division" && method === "GET") {
    const id = url.searchParams.get("id"),
      r = await db
        .prepare(
          "SELECT d.*,c.name AS competition_name,c.kind,c.ends_on,c.details AS competition_details FROM divisions d JOIN competitions c ON c.id=d.competition_id WHERE d.id=?",
        )
        .bind(id)
        .first();
    if (!r) throw fail("Division was not found.", 404);
    const fixtures = (
      await db
        .prepare(
          "SELECT * FROM fixtures WHERE division_id=? ORDER BY COALESCE(starts_at,local_day),id LIMIT 101",
        )
        .bind(id)
        .all()
    ).results;
    const standings = (
      await db
        .prepare(
          "SELECT * FROM standings WHERE division_id=? ORDER BY pool_id,COALESCE(rank,999),team_id LIMIT 500",
        )
        .bind(id)
        .all()
    ).results;
    const jobs = (
      await db
        .prepare(
          "SELECT kind,state,coverage,last_saved,last_complete,last_error FROM jobs WHERE scope=?",
        )
        .bind(id)
        .all()
    ).results;
    const awardFixtures =
        fixtures.length > 100
          ? (
              await db
                .prepare(
                  "SELECT * FROM fixtures WHERE division_id=? ORDER BY id LIMIT 1001",
                )
                .bind(id)
                .all()
            ).results
          : fixtures,
      ownIds = (await teamsInSpace(db, space, false)).map((t) => t.id),
      awards =
        awardFixtures.length > 1000
          ? {
              state: "partial",
              reason: "Award verification exceeds its bounded review size.",
              awards: [],
            }
          : assessAwards(
              { name: r.competition_name, ends_on: r.ends_on },
              awardFixtures,
              standings,
              ownIds,
            );
    return json({
      awards,
      division: {
        ...r,
        details: parse(r.details),
        competition_details: parse(r.competition_details),
      },
      fixtures: fixtures.slice(0, 100).map(projection),
      more: fixtures.length > 100,
      standings: standings.map((s) => ({ ...s, payload: parse(s.payload) })),
      jobs: jobs.map((j) => ({ ...j, last_error: parse(j.last_error, null) })),
    });
  }
  if (path === "/api/division/fixtures" && method === "GET") {
    const { limit, cursor } = pageArgs(url),
      rows = (
        await db
          .prepare(
            `SELECT * FROM fixtures WHERE division_id=? AND (?='' OR (COALESCE(starts_at,local_day,'9999'),id)>(?,?)) ORDER BY COALESCE(starts_at,local_day,'9999'),id LIMIT ?`,
          )
          .bind(
            url.searchParams.get("id"),
            cursor ? "yes" : "",
            cursor?.[0] || "",
            cursor?.[1] || "",
            limit + 1,
          )
          .all()
      ).results,
      out = paged(rows, limit, (f) => [
        f.starts_at || f.local_day || "9999",
        f.id,
      ]);
    out.items = out.items.map(projection);
    return json(out);
  }
  if (path === "/api/awards" && method === "GET") {
    const season = url.searchParams.get("season") || "",
      rows = (
        await db
          .prepare(
            "SELECT season,value FROM corrections WHERE space_id=? AND entity_id=? AND kind='season' AND (?='' OR ?='all' OR season=?) ORDER BY season DESC",
          )
          .bind(space, space, season, season, season)
          .all()
      ).results;
    return json({
      awards: rows.flatMap((r) =>
        (parse(r.value).awards || []).map((a) => ({
          ...a,
          season: r.season,
          source: "owner_recorded",
        })),
      ),
    });
  }
  if (path === "/api/players" && method === "GET") {
    const teams = await teamsInSpace(db, space, false),
      { limit, cursor } = pageArgs(url),
      rows = (
        await db
          .prepare(
            `SELECT DISTINCT p.*,(SELECT json_extract(value,'$.trace_player_id') FROM corrections c WHERE c.space_id=? AND c.kind='player_link' AND c.entity_id=p.id LIMIT 1) AS trace_player_id FROM players p JOIN team_players tp ON tp.player_id=p.id WHERE tp.team_id IN (SELECT value FROM json_each(?)) AND tp.active=1 AND (?='' OR (p.name,p.id)>(?,?)) ORDER BY p.name,p.id LIMIT ?`,
          )
          .bind(
            space,
            JSON.stringify(teams.map((t) => t.id)),
            cursor ? "yes" : "",
            cursor?.[0] || "",
            cursor?.[1] || "",
            limit + 1,
          )
          .all()
      ).results,
      out = paged(rows, limit, (p) => [p.name, p.id]);
    return json({
      players: out.items.map((p) => ({ ...p, details: parse(p.details) })),
      cursor: out.cursor,
    });
  }
  if (path === "/api/player" && method === "GET") {
    const id = url.searchParams.get("id"),
      p = await db.prepare("SELECT * FROM players WHERE id=?").bind(id).first();
    if (!p) throw fail("Player was not found.", 404);
    const teams = await teamsInSpace(db, space, false),
      visible = await db
        .prepare(
          "SELECT 1 AS ok FROM team_players WHERE player_id=? AND team_id IN (SELECT value FROM json_each(?))",
        )
        .bind(id, JSON.stringify(teams.map((t) => t.id)))
        .first();
    if (!visible) throw fail("Player is outside this team.", 403);
    const { limit, cursor } = pageArgs(url),
      playerLink = await db
        .prepare(
          "SELECT value FROM corrections WHERE space_id=? AND kind='player_link' AND entity_id=?",
        )
        .bind(space, id)
        .first(),
      tracePlayer = parse(playerLink?.value).trace_player_id || id,
      season = url.searchParams.get("season") || "",
      settings = await seasonSettings(db),
      range = seasonRange(season, settings.include_preseason),
      stats = (
        await db
          .prepare(
            `SELECT s.*,f.starts_at,f.local_day,f.payload FROM trace_stats s JOIN fixtures f ON f.id=s.fixture_id WHERE s.player_id=? AND s.team_id IN (SELECT value FROM json_each(?)) AND s.period='full' AND (?='' OR COALESCE(f.starts_at,f.local_day)>=?) AND (?='' OR COALESCE(f.starts_at,f.local_day)<?) AND (?='' OR (COALESCE(f.starts_at,f.local_day,''),s.fixture_id)<(?,?)) ORDER BY COALESCE(f.starts_at,f.local_day,'') DESC,s.fixture_id DESC LIMIT ?`,
          )
          .bind(
            tracePlayer,
            JSON.stringify(teams.map((t) => t.id)),
            range?.from || "",
            range?.from || "",
            range?.to || "",
            range?.to || "",
            cursor ? "yes" : "",
            cursor?.[0] || "",
            cursor?.[1] || "",
            limit + 1,
          )
          .all()
      ).results;
    const corrections = (
      await db
        .prepare("SELECT * FROM corrections WHERE space_id=? AND entity_id=?")
        .bind(space, id)
        .all()
    ).results.map((c) => ({ ...c, value: parse(c.value) }));
    return json({
      player: {
        ...p,
        details: parse(p.details),
        trace_player_id: tracePlayer !== id ? tracePlayer : null,
      },
      stats: stats.slice(0, limit).map((s) => ({
        ...s,
        value: parse(s.value),
        payload: parse(s.payload),
      })),
      cursor:
        stats.length > limit
          ? btoa(
              JSON.stringify([
                stats[limit - 1].starts_at || stats[limit - 1].local_day || "",
                stats[limit - 1].fixture_id,
              ]),
            )
          : null,
      more: stats.length > limit,
      corrections,
    });
  }
  if (path === "/api/favorites" && method === "GET") {
    const favorites = (
        await db
          .prepare(
            "SELECT * FROM favorites WHERE space_id=? ORDER BY created_at DESC LIMIT 10001",
          )
          .bind(space)
          .all()
      ).results,
      teams = (
        await db
          .prepare(
            "SELECT t.* FROM favorites v JOIN teams t ON t.id=v.entity_id WHERE v.space_id=? AND v.kind='team' ORDER BY t.name LIMIT 100",
          )
          .bind(space)
          .all()
      ).results,
      { limit, cursor } = pageArgs(url),
      fixtures = (
        await db
          .prepare(
            "SELECT f.* FROM favorites v JOIN fixtures f ON f.id=v.entity_id WHERE v.space_id=? AND v.kind='fixture' AND (?='' OR (COALESCE(f.starts_at,f.local_day,''),f.id)<(?,?)) ORDER BY COALESCE(f.starts_at,f.local_day,'') DESC,f.id DESC LIMIT ?",
          )
          .bind(
            space,
            cursor ? "yes" : "",
            cursor?.[0] || "",
            cursor?.[1] || "",
            limit + 1,
          )
          .all()
      ).results;
    return json({
      favorites,
      teams: teams.map((t) => ({ ...t, details: parse(t.details) })),
      fixtures: fixtures.slice(0, limit).map(projection),
      cursor:
        fixtures.length > limit
          ? btoa(
              JSON.stringify([
                fixtures[limit - 1].starts_at ||
                  fixtures[limit - 1].local_day ||
                  "",
                fixtures[limit - 1].id,
              ]),
            )
          : null,
      keys_more: favorites.length > 10000,
    });
  }
  if (path === "/api/search" && method === "GET") {
    const q = text(url.searchParams.get("q"), 100),
      age = Number(url.searchParams.get("age") || 10),
      gender = url.searchParams.get("gender") || "m",
      region = text(url.searchParams.get("state"), 8),
      page = Number(url.searchParams.get("page") || 1);
    if (
      !Number.isInteger(age) ||
      age < 7 ||
      age > 19 ||
      !["m", "f"].includes(gender) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000 ||
      (region && !/^[A-Z]{2,3}$/.test(region))
    )
      throw fail("Invalid search filters.");
    const indexed = (
      await db
        .prepare(
          "SELECT * FROM teams WHERE provider='gotsport' AND instr(lower(name),lower(?))>0 ORDER BY name LIMIT 30",
        )
        .bind(q)
        .all()
    ).results;
    const raw = await ranking(new Transport(env), "/team_ranking_data", {
      "search[team_or_club_name]": q,
      "search[team_country]": "USA",
      "search[age]": age,
      "search[gender]": gender,
      "search[page]": page,
      ...(region
        ? { "search[team_association]": region, "search[filter_by]": "state" }
        : {}),
    });
    if (!Array.isArray(raw.team_ranking_data) || !raw.pagination)
      throw fail("Team search response is invalid.", 502, "search_contract");
    const rows = unique(raw.team_ranking_data, (r) => native(r.team_id)).map(
      (r) => ({
        id: key("gotsport", r.team_id),
        provider: "gotsport",
        native_id: String(r.team_id),
        name: [text(r.club_name), text(r.team_name)].filter(Boolean).join(" "),
        club: text(r.club_name),
        age: r.age,
        gender: r.gender,
        region: r.team_association,
      }),
    );
    return json({
      teams: rows,
      indexed: indexed.map((r) => ({ ...r, details: parse(r.details) })),
      page,
      pages: raw.pagination.total_pages,
      total: raw.pagination.total_count,
    });
  }
  if (path === "/api/status" && method === "GET") {
    const teams = await teamsInSpace(db, space, true),
      ids = JSON.stringify(teams.map((t) => t.id)),
      at = Date.now(),
      { limit, cursor } = pageArgs(url),
      clause = `j.state<>'disabled' AND (j.connection_id IN (SELECT id FROM connections WHERE space_id=?) OR (j.provider='teamsnap' AND (j.scope IN (SELECT value FROM json_each(?)) OR (?=1 AND j.kind='catalog'))) OR EXISTS(SELECT 1 FROM job_interests i JOIN subscriptions s ON s.id=i.subscription_id WHERE i.job_id=j.id AND s.space_id=? AND s.active=1))`,
      args = [space, ids, a.owner ? 1 : 0, space],
      jobs = (
        await db
          .prepare(
            `SELECT j.id,j.provider,j.kind,j.scope,j.state,j.cursor,j.next_at,j.lease_until,j.attempts,j.failures,j.last_attempt,j.last_retrieved,j.last_saved,j.last_complete,j.last_error,j.pages,j.rows_saved,j.coverage FROM jobs j WHERE ${clause} AND (?='' OR j.id>?) ORDER BY j.id LIMIT ?`,
          )
          .bind(...args, cursor ? "yes" : "", cursor?.[1] || "", limit + 1)
          .all()
      ).results,
      summary = await db
        .prepare(
          `SELECT COUNT(*) AS total,COALESCE(SUM(j.state='error'),0) AS error,COALESCE(SUM(j.lease_until>?),0) AS running,COALESCE(SUM(j.last_complete IS NULL OR j.state IN ('queued','running')),0) AS pending,COALESCE(SUM(j.last_complete IS NOT NULL AND j.state='ready'),0) AS ready FROM jobs j WHERE ${clause}`,
        )
        .bind(at, ...args)
        .first(),
      out = paged(jobs, limit, (j) => ["", j.id]),
      providers = (
        await db
          .prepare(
            `SELECT j.provider,COUNT(*) AS total,COALESCE(SUM(j.state='error'),0) AS error,COALESCE(SUM(j.lease_until>?),0) AS running,COALESCE(SUM(j.last_complete IS NULL OR j.state IN ('queued','running')),0) AS pending FROM jobs j WHERE ${clause} GROUP BY j.provider`,
          )
          .bind(at, ...args)
          .all()
      ).results;
    return json({
      version: VERSION,
      generated_at: stamp(),
      jobs: out.items.map((j) => ({
        ...j,
        cursor: parse(j.cursor),
        last_error: parse(j.last_error, null),
        state:
          j.lease_until > at
            ? "running"
            : j.state === "running"
              ? "waiting_retry"
              : j.state,
      })),
      cursor: out.cursor,
      summary,
      providers,
      note: "A successful retrieval, saved page, and complete source scan are separate checkpoints.",
    });
  }
  if (path === "/api/branding" && method === "GET") {
    const teams = await teamsInSpace(db, space, false),
      clubs = JSON.stringify([
        ...new Set(teams.map((t) => t.club_id).filter(Boolean)),
      ]),
      rows = (
        await db
          .prepare(
            "SELECT key,value FROM settings WHERE substr(key,1,5)='logo:' OR substr(key,1,5)='kits:'",
          )
          .all()
      ).results;
    return json({
      branding: Object.fromEntries(
        rows
          .filter((r) =>
            JSON.parse(clubs).some(
              (c) =>
                r.key.startsWith("logo:" + c) ||
                r.key.startsWith("kits:" + c + ":"),
            ),
          )
          .map((r) => [r.key, parse(r.value)]),
      ),
    });
  }
}
