import { body, fail, json, native, parse, stamp, text } from "../core.js";
import { rate, seal, unseal } from "../auth.js";
import { enqueue, job, retry, wake, runOne } from "../jobs.js";
import { Transport } from "../providers/http.js";
import { collection, ts } from "../providers/teamsnap.js";
import {
  APP,
  TEAMS,
  cookieFrom,
  traceRequest,
  traceTeams,
} from "../providers/trace.js";
export async function accountsRoutes(context) {
  const { request, env, db, url, path, method, a, space } = context;
  if (path === "/api/admin/teamsnap/connect" && method === "POST") {
    const b = await body(request, 12000),
      token = text(b.access_token, 10000);
    if (!token) throw fail("TeamSnap access token missing.");
    const t = new Transport(env),
      me = collection(await ts(t, "me", token))[0];
    if (!native(me?.id))
      throw fail(
        "TeamSnap did not confirm the account.",
        502,
        "teamsnap_account",
      );
    const id = "teamsnap:account";
    await db
      .prepare(
        `INSERT INTO connections VALUES(?,NULL,'teamsnap',NULL,?,?,?,1,1,?) ON CONFLICT(id) DO UPDATE SET native_id=excluded.native_id,secret=excluded.secret,options=excluded.options,revision=connections.revision+1,active=1`,
      )
      .bind(
        id,
        String(me.id),
        await seal(env, token),
        JSON.stringify({ client_id: text(b.client_id) }),
        stamp(),
      )
      .run();
    await enqueue(db, job("teamsnap", "catalog", "account", {}, id));
    await db
      .prepare(
        "UPDATE jobs SET cursor='{}',coverage='partial',scan_id=? WHERE id='teamsnap/catalog/account' AND lease_until<=?",
      )
      .bind(crypto.randomUUID(), Date.now())
      .run();
    await retry(db, "teamsnap/catalog/account");
    await wake(env);
    return json({ ok: true, queued: true });
  }
  if (path === "/api/admin/trace/send-code" && method === "POST") {
    const b = await body(request, 4096),
      email = text(b.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw fail("Enter the email used for Trace.");
    await rate(db, "trace-send", 5, 1200000);
    const t = new Transport(env),
      guest = cookieFrom(
        (
          await traceRequest(t, TEAMS + "/users/self/logout", "", {
            method: "POST",
            body: new FormData(),
          })
        ).response,
      ),
      lookup = (
        await traceRequest(
          t,
          "https://lapi.traceup.com/tracebot-prod/42/users/search?email=" +
            encodeURIComponent(email),
        )
      ).value,
      uid = native(lookup.data?.id || lookup.data?.user_id || lookup.user_id);
    if (!uid) throw fail("Trace account was not found.", 400, "trace_account");
    const form = new FormData();
    form.set("email", email);
    form.set("email_type", "magic-code");
    form.set("proceed_url", APP + "/traceid");
    const sent = (
      await traceRequest(t, TEAMS + "/autologin-url/send", guest, {
        method: "POST",
        body: form,
      })
    ).value;
    if (sent.success === false)
      throw fail("Trace could not send the code.", 502, "trace_send");
    await db
      .prepare(
        "INSERT INTO auth_pending VALUES('trace',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at",
      )
      .bind(
        await seal(env, JSON.stringify({ cookie: guest, user_id: uid })),
        Date.now() + 1200000,
      )
      .run();
    return json({ ok: true });
  }
  if (path === "/api/admin/trace/verify-code" && method === "POST") {
    const b = await body(request, 4096),
      row = await db
        .prepare("SELECT * FROM auth_pending WHERE id='trace'")
        .first();
    if (!row || row.expires_at < Date.now())
      throw fail("Send a new Trace code.", 410, "trace_expired");
    await rate(db, "trace-verify", 10, 1200000);
    const pending = parse(await unseal(env, row.value)),
      form = new FormData();
    form.set("user_id", pending.user_id);
    form.set("code", text(b.code, 200));
    const t = new Transport(env),
      login = await traceRequest(
        t,
        TEAMS + "/users/login/by-code",
        pending.cookie,
        { method: "POST", body: form },
      );
    if (login.value.success === false)
      throw fail("Trace rejected that code.", 400, "trace_code");
    const cookie = cookieFrom(login.response) || pending.cookie,
      valid = (await traceRequest(t, TEAMS + "/users/self", cookie)).value;
    if (
      !cookie ||
      valid.success === false ||
      native(
        valid.data?.user_id || valid.data?.id || valid.user_id || valid.id,
      ) !== pending.user_id
    )
      throw fail(
        "Trace sign-in did not establish a session.",
        502,
        "trace_session",
      );
    await db
      .prepare(
        `INSERT INTO connections VALUES('trace:account',NULL,'trace',NULL,?,?, '{}',1,1,?) ON CONFLICT(id) DO UPDATE SET native_id=excluded.native_id,secret=excluded.secret,revision=connections.revision+1,active=1`,
      )
      .bind(pending.user_id, await seal(env, cookie), stamp())
      .run();
    await db
      .prepare(
        "UPDATE connections SET secret=CASE WHEN json_extract(options,'$.account_id')=? THEN ? ELSE secret END,active=CASE WHEN json_extract(options,'$.account_id')=? THEN 1 ELSE 0 END,revision=revision+1 WHERE provider='trace' AND id<>'trace:account'",
      )
      .bind(pending.user_id, await seal(env, cookie), pending.user_id)
      .run();
    await db.prepare("DELETE FROM auth_pending WHERE id='trace'").run();
    return json({
      ok: true,
      teams: (await traceTeams(t, cookie)).map((r) => ({
        id: String(r.team_id),
        name: text(r.title || r.name),
        slug: text(r.name),
      })),
    });
  }
  if (path === "/api/admin/trace/teams" && method === "GET") {
    const account = await db
      .prepare(
        "SELECT secret FROM connections WHERE id='trace:account' AND active=1",
      )
      .first();
    if (!account) throw fail("Sign in to Trace first.", 401, "trace_signin");
    const rows = await traceTeams(
      new Transport(env),
      await unseal(env, account.secret),
    );
    return json({
      teams: rows.map((r) => ({
        id: String(r.team_id),
        name: text(r.title || r.name),
        slug: text(r.name),
      })),
    });
  }
  if (path === "/api/admin/runtime/run" && method === "POST") {
    const result = await runOne(db, env);
    return json(result, result.state === "error" ? 502 : 200);
  }
}
