import { VERSION, body, errInfo, fail, hash, json, stamp } from "./src/core.js";
import { DB } from "./src/db.js";
import { installed, initialize } from "./src/schema.js";
import { access, ownerOnly, session, sameOrigin } from "./src/auth.js";
import { api } from "./src/api.js";
import { runOne, wake } from "./src/jobs.js";
const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://auth.teamsnap.com",
};
export class SyncRuntime {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.running = null;
    this.arming = Promise.resolve();
  }
  async arm(at = Date.now() + 1000) {
    const p = this.arming.then(async () => {
      const current = await this.ctx.storage.getAlarm();
      if (current === null || current > at || current < Date.now() - 60000)
        await this.ctx.storage.setAlarm(at);
    });
    this.arming = p.catch(() => {});
    return p;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/wake" && request.method === "POST") {
      await this.arm();
      return json({ queued: true }, 202);
    }
    if (path === "/status")
      return json(
        (await this.ctx.storage.get("last_run")) || { state: "not_started" },
      );
    return json({ error: "not_found" }, 404);
  }
  async alarm() {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async run() {
    const db = new DB(this.env.DB),
      started = stamp();
    let result;
    try {
      if (!(await installed(db))) return;
      result = await runOne(db, this.env);
      const maintenance = await this.ctx.storage.get("maintenance_at");
      if (
        (!maintenance || Date.now() - maintenance > 3600000) &&
        db.used + 5 <= db.limit
      ) {
        await db.batch([
          db
            .prepare(
              "DELETE FROM observations WHERE id IN (SELECT id FROM observations WHERE at<? ORDER BY at LIMIT 2000)",
            )
            .bind(new Date(Date.now() - 14 * 86400000).toISOString()),
          db
            .prepare("DELETE FROM rate_limits WHERE expires_at<?")
            .bind(Date.now()),
          db
            .prepare("DELETE FROM auth_pending WHERE expires_at<?")
            .bind(Date.now()),
          db.prepare(
            "DELETE FROM scan_rows WHERE rowid IN (SELECT r.rowid FROM scan_rows r WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=r.job_id AND j.scan_id=r.scan_id) LIMIT 2000)",
          ),
        ]);
        await this.ctx.storage.put("maintenance_at", Date.now());
      }
      await this.ctx.storage.put("last_run", {
        started_at: started,
        finished_at: stamp(),
        ...result,
        queries: db.used,
        rows_read: db.read,
        rows_written: db.written,
      });
      const next = await db
        .prepare(
          `SELECT MIN(next_at) AS next FROM jobs WHERE state<>'disabled' AND (provider='teamsnap' AND (kind='catalog' OR EXISTS(SELECT 1 FROM space_teams st WHERE st.team_id=jobs.scope AND st.role='primary')) AND EXISTS(SELECT 1 FROM connections c WHERE c.id=jobs.connection_id AND c.active=1) OR EXISTS(SELECT 1 FROM job_interests i JOIN subscriptions s ON s.id=i.subscription_id WHERE i.job_id=jobs.id AND s.active=1))`,
        )
        .first();
      if (next.next != null)
        await this.arm(Math.max(Date.now() + 1000, Number(next.next)));
    } catch (e) {
      await this.ctx.storage.put("last_run", {
        started_at: started,
        finished_at: stamp(),
        state: "error",
        error: errInfo(e),
        queries: db.used,
        rows_read: db.read,
        rows_written: db.written,
      });
      await this.arm(Date.now() + 60000);
    }
  }
}
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    try {
      if (u.pathname === "/api/health")
        return json({ service: "myTS", version: VERSION });
      if (u.pathname === "/api/state") {
        const db = new DB(env.DB);
        return json({
          version: VERSION,
          installed: await installed(db),
          secret_configured: !!env.ADMIN_KEY && env.ADMIN_KEY.length >= 16,
        });
      }
      if (u.pathname === "/api/setup" && request.method === "POST") {
        const provided = request.headers.get("x-admin-key");
        if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 16)
          throw fail(
            "Set ADMIN_KEY to at least 16 characters.",
            503,
            "setup_secret",
          );
        if (!provided || (await hash(provided)) !== (await hash(env.ADMIN_KEY)))
          throw fail("Invalid admin key.", 401, "unauthorized");
        if (!(await installed(env.DB))) await initialize(env.DB);
        return json({ ok: true, version: VERSION });
      }
      if (u.pathname.startsWith("/api/")) {
        const db = new DB(env.DB);
        if (!(await installed(db)))
          throw fail(
            "Initialize the fresh database first.",
            503,
            "setup_database",
          );
        if (u.pathname === "/api/session")
          return await session(request, env, db);
        if (u.pathname === "/api/admin/runtime" && request.method === "GET") {
          ownerOnly(await access(request, env, db));
          return env.SYNC.get(env.SYNC.idFromName("scheduler")).fetch(
            "https://sync/status",
          );
        }
        return await api(request, env, db);
      }
      if (!["GET", "HEAD"].includes(request.method))
        throw fail("Method not allowed.", 405, "method_not_allowed");
      const target = new URL(request.url);
      if (
        u.pathname === "/" ||
        u.pathname === "/admin" ||
        u.pathname === "/oauth" ||
        /^\/view\/[A-Za-z0-9_-]{20,}$/.test(u.pathname)
      )
        target.pathname = "/";
      const response = await env.ASSETS.fetch(new Request(target, request));
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(HEADERS)) headers.set(k, v);
      headers.set(
        "Cache-Control",
        target.pathname === "/" || target.pathname.endsWith(".html")
          ? "no-store"
          : "public, max-age=300",
      );
      return new Response(response.body, { status: response.status, headers });
    } catch (e) {
      console.error(
        "myTS request failed",
        e.code || "internal_error",
        e.code ? "" : e.message,
      );
      return json({ error: errInfo(e) }, e.status || 500);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(wake(env));
  },
};
