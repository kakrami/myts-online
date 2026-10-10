import {
  VERSION,
  body,
  fail,
  json,
  key,
  parse,
  stamp,
  text,
  zone,
} from "./core.js";
import { access, ownerOnly } from "./auth.js";
import { getSpace } from "./api-helpers.js";
import { accountsRoutes } from "./routes/accounts.js";
import { catalogRoutes } from "./routes/catalog.js";
import { connectionsRoutes } from "./routes/connections.js";
import { adminRoutes } from "./routes/admin.js";
import { coachRoutes } from "./routes/coach.js";
const connectionPaths = new Set([
  "/api/admin/connections",
  "/api/admin/gotsport/connect",
  "/api/admin/trace/connect",
  "/api/admin/favorites",
  "/api/admin/retry",
]);
export async function api(request, env, db) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method,
    a = await access(request, env, db);
  if (path.startsWith("/api/admin/")) ownerOnly(a);
  if (path === "/api/bootstrap" && method === "GET") {
    const rows = (
      await db
        .prepare(
          a.owner
            ? "SELECT * FROM spaces ORDER BY name,id"
            : "SELECT * FROM spaces WHERE id=?",
        )
        .bind(...(a.owner ? [] : [a.space]))
        .all()
    ).results;
    const settings = Object.fromEntries(
      (
        await db
          .prepare(
            "SELECT key,value FROM settings WHERE key IN ('timezone','include_preseason','client_id')",
          )
          .all()
      ).results.map((r) => [r.key, parse(r.value, r.value)]),
    );
    return json({ version: VERSION, owner: a.owner, spaces: rows, settings });
  }
  if (path === "/api/admin/spaces" && method === "POST") {
    const b = await body(request, 4096),
      name = text(b.name, 100);
    if (!name) throw fail("Enter a team name.");
    const id = "space:" + crypto.randomUUID();
    await db
      .prepare("INSERT INTO spaces VALUES(?,?,?)")
      .bind(id, name, stamp())
      .run();
    return json({ id, name }, 201);
  }
  if (path === "/api/admin/settings" && method === "PUT") {
    const b = await body(request, 4096),
      values = {};
    if (b.timezone) values.timezone = zone(b.timezone);
    if (b.client_id != null) values.client_id = text(b.client_id, 200);
    if (b.include_preseason != null)
      values.include_preseason = !!b.include_preseason;
    await db.batch(
      Object.entries(values).map(([k, v]) =>
        db
          .prepare(
            "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          )
          .bind(k, JSON.stringify(v)),
      ),
    );
    return json({ ok: true });
  }
  const context = { request, env, db, url, path, method, a };
  let response = await accountsRoutes(context);
  if (response) return response;
  context.space = await getSpace(db, a, url);
  const route = connectionPaths.has(path)
    ? connectionsRoutes
    : path.startsWith("/api/admin/coach")
      ? coachRoutes
      : path.startsWith("/api/admin/")
        ? adminRoutes
        : catalogRoutes;
  response = await route(context);
  if (response) return response;
  throw fail("Route was not found.", 404, "not_found");
}
