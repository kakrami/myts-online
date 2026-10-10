import { body, fail, hash, json, stamp, text, parse } from "./core.js";
const COOKIE = "myts7_session";
const b64 = (a) =>
  btoa(String.fromCharCode(...a))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const unb64 = (s) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
async function signing(env) {
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 16)
    throw fail("Set ADMIN_KEY to at least 16 characters.", 503, "setup_secret");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function seal(env, value) {
  const k = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("myts7:" + env.ADMIN_KEY),
      ),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    ),
    iv = crypto.getRandomValues(new Uint8Array(12));
  return (
    b64(iv) +
    "." +
    b64(
      new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          k,
          new TextEncoder().encode(value),
        ),
      ),
    )
  );
}
export async function unseal(env, value) {
  if (!value) return "";
  try {
    const k = await crypto.subtle.importKey(
        "raw",
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode("myts7:" + env.ADMIN_KEY),
        ),
        "AES-GCM",
        false,
        ["decrypt"],
      ),
      [iv, data] = value.split(".");
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(iv) },
        k,
        unb64(data),
      ),
    );
  } catch {
    throw fail(
      "Stored provider authorization cannot be read. Reconnect the provider.",
      401,
      "credentials_unreadable",
    );
  }
}
export async function rate(db, id, max = 10, ms = 600000) {
  const slot = Math.floor(Date.now() / ms),
    r = await db
      .prepare(
        "INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET hits=hits+1 RETURNING hits",
      )
      .bind(id + ":" + slot, (slot + 1) * ms)
      .first();
  if (r.hits > max)
    throw fail("Too many attempts. Try again later.", 429, "rate_limit");
}
export function sameOrigin(r) {
  if (
    r.headers.get("origin") !== new URL(r.url).origin ||
    r.headers.get("sec-fetch-site") === "cross-site"
  )
    throw fail("Same-origin request required.", 403, "origin_required");
}
export async function access(r, env, db) {
  const unsafe = !["GET", "HEAD"].includes(r.method);
  let owner = false;
  const explicit = r.headers.get("x-admin-key");
  if (explicit) {
    owner = (await hash(explicit)) === (await hash(env.ADMIN_KEY || ""));
    if (!owner) throw fail("Invalid admin key.", 401, "unauthorized");
  } else {
    const token =
        (r.headers.get("cookie") || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith(COOKIE + "="))
          ?.slice(COOKIE.length + 1) || "",
      [exp, sig] = token.split(".");
    if (
      /^\d+$/.test(exp || "") &&
      Number(exp) > Date.now() &&
      Number(exp) <= Date.now() + 7 * 86400000 &&
      sig
    ) {
      try {
        owner = await crypto.subtle.verify(
          "HMAC",
          await signing(env),
          unb64(sig),
          new TextEncoder().encode(exp),
        );
      } catch {
        owner = false;
      }
    }
    if (owner && unsafe) sameOrigin(r);
  }
  if (owner) return { owner: true, space: null };
  const viewer =
    r.headers.get("x-view-key") || new URL(r.url).searchParams.get("share");
  if (viewer && r.method === "GET") {
    const row = await db
      .prepare("SELECT space_id FROM shares WHERE token_hash=? AND revoked=0")
      .bind(await hash(viewer))
      .first();
    if (row) return { owner: false, space: row.space_id };
  }
  throw fail("Sign in to continue.", 401, "unauthorized");
}
export const ownerOnly = (a) => {
  if (!a.owner) throw fail("Owner access required.", 403, "owner_required");
};
export const spaceAccess = (a, id) => {
  if (!a.owner && a.space !== id)
    throw fail("This link does not include that team.", 403, "space_forbidden");
};
export async function session(r, env, db) {
  sameOrigin(r);
  const cookie = (v, age) =>
    `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
  if (r.method === "DELETE")
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  const b = await body(r, 4096);
  await rate(
    db,
    "login:" + (await hash(r.headers.get("cf-connecting-ip") || "local")),
    10,
  );
  const k = await signing(env);
  if ((await hash(text(b.key, 300))) !== (await hash(env.ADMIN_KEY)))
    throw fail("Invalid admin key.", 401, "unauthorized");
  const exp = String(Date.now() + 7 * 86400000),
    sig = b64(
      new Uint8Array(
        await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(exp)),
      ),
    );
  return json({ ok: true }, 200, {
    "Set-Cookie": cookie(exp + "." + sig, 604800),
  });
}
export async function share(db, space) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))),
    id = crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE shares SET revoked=1 WHERE space_id=?").bind(space),
    db
      .prepare("INSERT INTO shares VALUES(?,?,?,?,0)")
      .bind(id, space, await hash(token), stamp()),
  ]);
  return token;
}
