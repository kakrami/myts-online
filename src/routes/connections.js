import { body, fail, json, key, native, parse, stamp, text } from "../core.js";
import { unseal } from "../auth.js";
import { bulk, teamRecord } from "../db.js";
import { enqueueRoot, job, retry, wake } from "../jobs.js";
import { Transport } from "../providers/http.js";
import { traceTeams } from "../providers/trace.js";
import { teamsInSpace, requireFixture, connectPublic } from "../api-helpers.js";
export async function connectionsRoutes(context) {
  const { request, env, db, url, path, method, a, space } = context;
  if (path === "/api/admin/connections" && method === "GET") {
    const rows = (
      await db
        .prepare(
          "SELECT id,provider,team_id,native_id,active,created_at FROM connections WHERE space_id=? OR provider='teamsnap' OR id='trace:account' OR team_id IN (SELECT team_id FROM space_teams WHERE space_id=? AND role<>'followed')",
        )
        .bind(space, space)
        .all()
    ).results;
    return json({
      connections: rows,
      teams: await teamsInSpace(db, space, false),
    });
  }
  if (path === "/api/admin/gotsport/connect" && method === "PUT") {
    const b = await body(request, 4096),
      id = native(b.team_id);
    if (!id) throw fail("Enter a GotSport team ID.");
    await connectPublic(db, space, id, "connected");
    await wake(env);
    return json({ ok: true, queued: true });
  }
  if (path === "/api/admin/gotsport/connect" && method === "DELETE") {
    const id = url.searchParams.get("id");
    await db.batch([
      db
        .prepare(
          "DELETE FROM space_teams WHERE space_id=? AND team_id=? AND role='connected'",
        )
        .bind(space, id),
      db
        .prepare(
          "UPDATE subscriptions SET active=0 WHERE space_id=? AND entity_id=? AND kind='connected'",
        )
        .bind(space, id),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/admin/trace/connect" && method === "PUT") {
    const b = await body(request, 4096),
      id = native(b.team_id),
      account = await db
        .prepare(
          "SELECT * FROM connections WHERE id='trace:account' AND active=1",
        )
        .first();
    if (!account) throw fail("Sign in to Trace.", 401, "trace_signin");
    const teams = await traceTeams(
        new Transport(env),
        await unseal(env, account.secret),
      ),
      selected = teams.find((t) => native(t.team_id) === id);
    if (!selected)
      throw fail("Trace team does not belong to this account.", 403);
    const tid = key("trace", id),
      cid = "trace:team:" + id;
    await db.batch([
      bulk(db, "teams", [
        teamRecord("trace", id, selected.title || selected.name),
      ]),
      db
        .prepare(
          "INSERT INTO space_teams VALUES(?,?,'connected') ON CONFLICT(space_id,team_id) DO UPDATE SET role=excluded.role",
        )
        .bind(space, tid),
      db
        .prepare(
          `INSERT INTO connections VALUES(?,NULL,'trace',?,?,?,?,1,1,?) ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,options=excluded.options,revision=connections.revision+1,active=1`,
        )
        .bind(
          cid,
          tid,
          id,
          account.secret,
          JSON.stringify({
            slug: text(selected.name),
            account_id: account.native_id,
          }),
          stamp(),
        ),
    ]);
    await enqueueRoot(
      db,
      job("trace", "catalog", tid, {}, cid),
      space,
      "connected",
      tid,
    );
    await enqueueRoot(
      db,
      job("trace", "roster", tid, {}, cid),
      space,
      "connected",
      tid,
    );
    await retry(db, `trace/catalog/${tid}`);
    await retry(db, `trace/roster/${tid}`);
    await wake(env);
    return json({ ok: true, queued: true });
  }
  if (path === "/api/admin/connections" && method === "DELETE") {
    const id = url.searchParams.get("id"),
      row = await db
        .prepare("SELECT * FROM connections WHERE id=?")
        .bind(id)
        .first();
    if (!row) throw fail("Connection not found.", 404);
    if (row.provider === "trace" && row.team_id) {
      await db.batch([
        db
          .prepare(
            "DELETE FROM space_teams WHERE space_id=? AND team_id=? AND role='connected'",
          )
          .bind(space, row.team_id),
        db
          .prepare(
            "UPDATE subscriptions SET active=0 WHERE space_id=? AND entity_id=? AND kind='connected'",
          )
          .bind(space, row.team_id),
        db
          .prepare(
            "UPDATE connections SET active=0,revision=revision+1 WHERE id=? AND NOT EXISTS(SELECT 1 FROM space_teams WHERE team_id=? AND role='connected')",
          )
          .bind(id, row.team_id),
      ]);
    } else {
      await db
        .prepare(
          "UPDATE connections SET active=0,revision=revision+1 WHERE id=?",
        )
        .bind(id)
        .run();
      if (row.provider === "teamsnap")
        await db
          .prepare(
            "DELETE FROM space_teams WHERE role='primary' AND team_id LIKE 'teamsnap:%'",
          )
          .run();
      if (id === "trace:account")
        await db
          .prepare(
            "UPDATE connections SET active=0,revision=revision+1 WHERE provider='trace'",
          )
          .run();
    }
    return json({ ok: true });
  }
  if (path === "/api/admin/favorites" && ["PUT", "DELETE"].includes(method)) {
    const b = await body(request, 4096),
      kind = b.kind,
      id = text(b.id, 150);
    if (!["team", "fixture"].includes(kind)) throw fail("Invalid bookmark.");
    if (method === "DELETE") {
      await db.batch([
        db
          .prepare(
            "DELETE FROM favorites WHERE space_id=? AND kind=? AND entity_id=?",
          )
          .bind(space, kind, id),
        db
          .prepare(
            "UPDATE subscriptions SET active=0 WHERE space_id=? AND kind IN (?,?) AND entity_id=?",
          )
          .bind(space, kind, kind === "team" ? "followed" : kind, id),
        ...(kind === "team"
          ? [
              db
                .prepare(
                  "DELETE FROM space_teams WHERE space_id=? AND team_id=? AND role='followed'",
                )
                .bind(space, id),
            ]
          : []),
      ]);
      return json({ ok: true });
    }
    if (kind === "team") {
      if (!/^gotsport:\d+$/.test(id)) throw fail("Choose a GotSport team.");
      await connectPublic(db, space, id.split(":")[1], "followed");
    } else {
      const f = await requireFixture(db, a, space, id);
      if (
        !["gotsport", "live"].includes(f.provider) ||
        f.conditional ||
        f.type !== "game"
      )
        throw fail("Only confirmed GotSport games can be bookmarked.");
      const p = parse(f.payload);
      if (f.provider === "live")
        await enqueueRoot(
          db,
          job("live", "fixture", id, { game_id: f.native_id }),
          space,
          kind,
          id,
        );
      else if (f.division_id)
        await enqueueRoot(
          db,
          job("gotsport", "division", f.division_id, {
            event: f.competition_id.split(":")[1],
            group: f.division_id.split(":")[1],
            brackets: p.bracket_id ? [p.bracket_id] : [],
          }),
          space,
          kind,
          id,
        );
      else
        await enqueueRoot(
          db,
          job("gotsport", "history", f.home_id.split(":")[1], {
            team_id: f.home_id.split(":")[1],
          }),
          space,
          kind,
          id,
        );
    }
    await db
      .prepare("INSERT OR IGNORE INTO favorites VALUES(?,?,?,?)")
      .bind(space, kind, id, stamp())
      .run();
    await wake(env);
    return json({ ok: true });
  }
  if (path === "/api/admin/retry" && method === "POST") {
    const b = await body(request, 4096);
    if (b.id) await retry(db, b.id);
    else
      await db
        .prepare(
          `UPDATE jobs SET next_at=?,state='queued' WHERE lease_until<=? AND (connection_id IN (SELECT id FROM connections WHERE space_id=? OR provider='teamsnap') OR EXISTS(SELECT 1 FROM job_interests i JOIN subscriptions s ON s.id=i.subscription_id WHERE i.job_id=jobs.id AND s.space_id=? AND s.active=1))`,
        )
        .bind(Date.now(), Date.now(), space, space)
        .run();
    await wake(env);
    return json({ ok: true, queued: true });
  }
}
