import { CoachingService } from "./service.js";
const fail = (message, status = 400, code = "coach_invalid") => Object.assign(new Error(message), { status, code });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
async function body(request) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw fail("Send JSON for this action.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw fail("Supply a Coach action.");
  let bytes = 0, chunks = [];
  for (; ; ) {
    const { done, value: value2 } = await reader.read();
    if (done) break;
    bytes += value2.byteLength;
    if (bytes > 32e3) {
      await reader.cancel();
      throw fail("This Coach action is too large.", 413);
    }
    chunks.push(value2);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw fail("Send valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("Supply a Coach action.");
  return value;
}
function writeOrigin(request, url) {
  if (request.headers.get("origin") !== url.origin) throw fail("Open this action in the app.", 403, "origin_invalid");
}
function selection(value) {
  return { team_id: value.team_id, team_season_id: value.team_season_id, event_id: value.event_id, player_id: value.player_id };
}
async function coachingRoutes(request, { actor, db, now, resolveAvailability, resolveRoleHints } = {}) {
  const url = new URL(request.url), path = url.pathname;
  if (!["/api/coach", "/api/coach/profiles", "/api/coach/profiles/resolve"].includes(path)) return null;
  if (!actor?.owner && actor?.role !== "owner") throw fail("Coach is available only to the owner.", 403, "owner_required");
  const service = new CoachingService(db, actor, { now, resolveAvailability, resolveRoleHints });
  if (request.method === "GET" && path !== "/api/coach/profiles/resolve") {
    const scope = selection(Object.fromEntries(url.searchParams));
    return json(path === "/api/coach" ? await service.read(scope) : { profiles: await service.profiles(scope) });
  }
  if (path === "/api/coach" && request.method === "POST" || path === "/api/coach/profiles" && request.method === "PUT" || path === "/api/coach/profiles/resolve" && request.method === "POST") {
    writeOrigin(request, url);
    const value = await body(request), scope = selection(value);
    if (path === "/api/coach/profiles/resolve") return json(await service.resolveProfileIdentity(scope, value.choice));
    if (path === "/api/coach/profiles") return json({ profile: await service.setProfile(scope, value.value, value.revision) });
    return json(await service.command(scope, value.action, value.revision));
  }
  return json({ error: { code: "method_not_allowed", message: "That method is unavailable." } }, 405);
}
export {
  coachingRoutes
};
