// Provider-native DTO helpers. This module has no persistence or application entities.
export const stamp = () => new Date().toISOString();
export const text = (value, max = 1000) => String(value ?? "").trim().slice(0, max);
export const norm = (value) => text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
export const bytes = (value) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length;
export const parse = (value, fallback = {}) => { try { return typeof value === "string" ? JSON.parse(value) : value || fallback; } catch { return fallback; } };
export function fail(message, status = 502, code = "contract_violation") {
  return Object.assign(new Error(message), { status, code });
}
export function requireValue(value, message, code = "contract_violation") {
  if (!value) throw fail(message, 502, code === "source_contract" ? "contract_violation" : code);
  return value;
}
export function native(value) { const s = String(value ?? ""); return /^[1-9]\d{0,14}$/.test(s) ? s : ""; }
export function key(provider, value) { return `${provider}:${requireValue(native(value), "Invalid provider-native identity.")}`; }
export function instant(value) {
  if (!value) return null;
  requireValue(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(String(value)) && Number.isFinite(Date.parse(value)), "Source kickoff needs an explicit offset.");
  return new Date(value).toISOString();
}
export function day(value) {
  if (!value) return null;
  const d = String(value).slice(0, 10);
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d, "Invalid provider date.");
  return d;
}
export const date = day;
export async function hash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(typeof value==="string"?value:JSON.stringify(value)))),(v)=>v.toString(16).padStart(2,"0")).join(""); }
export function localDate(value, timezone = "America/Los_Angeles") {
  if (!value) return null;
  requireValue(Number.isFinite(Date.parse(value)), "Invalid source time.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}
export function teamRecord(provider, id, name, details = {}, extra = {}) {
  return { id: key(provider, id), provider, native_id: String(id), name: text(name) || "Team", details: JSON.stringify(details), observed_at: stamp(), ...extra };
}
export function job(provider, kind, scope, args = {}, accountId = null) {
  return { provider, kind, scope: String(scope), args, ...(accountId ? { accountId } : {}) };
}
export function datePriority(value,now=Date.now()) {
  const time=Date.parse(value||"");
  if(!Number.isFinite(time))return 40;
  if(time<now-60*86400000)return 20;
  if(time>now+30*86400000)return 40;
  return 80;
}
export function result() { return { records: {}, fixtures: [], children: [], complete: true, checkpoint: { finished: true }, coverage: null, replacements: [] }; }
export function score(value) {
  if (value === null || value === undefined || value === "") return null;
  requireValue(Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1000, "Invalid source score.");
  return Number(value);
}
