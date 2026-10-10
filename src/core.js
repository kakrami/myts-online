export const VERSION = "7.0.0";
export const stamp = () => new Date().toISOString();
export const parse = (v, f = {}) => {
  try {
    return JSON.parse(v);
  } catch {
    return f;
  }
};
export const text = (v, max = 500) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
export function fail(message, status = 400, code = "invalid_request") {
  const e = new Error(message);
  Object.assign(e, { status, code });
  return e;
}
export function requireValue(v, message, code = "source_contract") {
  if (!v) throw fail(message, 502, code);
  return v;
}
export function native(v) {
  const s = String(v ?? "");
  return /^[1-9]\d{0,14}$/.test(s) ? s : "";
}
export function key(provider, id) {
  return `${provider}:${requireValue(native(id), "Invalid source identity.")}`;
}
export function instant(v) {
  if (!v) return null;
  requireValue(
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(v) &&
      Number.isFinite(Date.parse(v)),
    "Source kickoff has no valid offset.",
  );
  return new Date(v).toISOString();
}
export function day(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  requireValue(
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s,
    "Invalid source date.",
  );
  return s;
}
export function safeUrl(v) {
  try {
    const u = new URL(v);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export function json(v, status = 200, headers = {}) {
  return new Response(JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export async function body(r, limit = 1_500_000) {
  if (Number(r.headers.get("content-length")) > limit)
    throw fail("Request is too large.", 413);
  let bytes = 0,
    out = "";
  const reader = r.body?.getReader();
  if (!reader) return {};
  const decode = new TextDecoder();
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      bytes += p.value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw fail("Request is too large.", 413);
      }
      out += decode.decode(p.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(out + decode.decode());
  } catch {
    throw fail("Invalid JSON.");
  }
}
export const bytes = (v) =>
  new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v))
    .length;
export async function hash(v) {
  const a = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(v)),
  );
  return [...new Uint8Array(a)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function errInfo(e) {
  return {
    code: e.code || "internal_error",
    message: e.code ? text(e.message) : "An internal operation failed.",
    at: stamp(),
    status: e.status || 500,
  };
}
export function zone(v) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v }).format(0);
    return v;
  } catch {
    throw fail("Choose a valid time zone.");
  }
}
export const norm = (v) =>
  text(v)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
