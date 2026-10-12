import { fail, requireValue, stamp } from "./common.js";
const HOSTS = new Set(["api.teamsnap.com", "system.gotsport.com", "gotsportlive-api.azurewebsites.net", "teams.traceup.com", "api.traceup.com", "app.traceup.com", "go.traceup.com", "traceid.traceup.com", "lapi.traceup.com"]);
const sensitive = /token|secret|password|cookie|email|code|(?:^|_)key(?:$|_)/i;
async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (v) => v.toString(16).padStart(2, "0")).join(""); }
const challengeMarker=(value)=>/\/cdn-cgi\/challenge-platform\b|\bcf-chl-[\w-]+|challenges\.cloudflare\.com\/turnstile\/|(?:google\.com|recaptcha\.net)\/recaptcha\/(?:api|enterprise)\.js|hcaptcha\.com\/1\/api\.js/i.test(value||"");
async function diagnosticPrefix(response,observation) {
  const reader=response.body?.getReader();if(!reader)return "";
  const decoder=new TextDecoder();let raw="",captured=0;
  try {
    for(;;){const part=await reader.read();if(part.done)break;observation.bytes+=part.value.length;const bounded=part.value.subarray(0,65536-captured);captured+=bounded.length;raw+=decoder.decode(bounded,{stream:true});if(captured>=65536){await reader.cancel();break;}}
  }finally{reader.releaseLock();}
  return raw.slice(0,65536);
}
export function url(origin, path, params = {}) {
  const u = new URL(path, origin);
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== null) u.searchParams.set(name, String(value));
  return u.href;
}
export function unique(rows, identity) {
  requireValue(Array.isArray(rows), "Expected a provider array.");
  const ids = rows.map(identity);
  requireValue(ids.every(Boolean) && new Set(ids).size === ids.length, "Source contains missing or duplicate native identities.");
  return rows;
}
export class SourceTransport {
  constructor(env = {}, options = {}) {
    // Workerd's global fetch requires its own receiver when stored as a method.
    this.fetcher = options.fetch || env.PROVIDER_FETCH?.fetch?.bind(env.PROVIDER_FETCH) || fetch.bind(globalThis);
    this.maxCalls = options.maxCalls ?? 8;
    this.deadline = Date.now() + (options.deadlineMs ?? 22000);
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.calls = 0;
    this.observations = [];
  }
  async get(endpoint, options = {}, contract = "json") {
    const u = new URL(endpoint);
    requireValue(u.protocol === "https:" && !u.username && !u.password && !u.port && (HOSTS.has(u.hostname) || (contract === "radar" && u.hostname.endsWith(".traceup.com"))), "Unsupported provider endpoint.", "unsupported_response");
    if (this.calls >= this.maxCalls || Date.now() + 500 >= this.deadline) throw Object.assign(fail("Collection continues in another invocation.", 409, "invocation_budget"), { retryAfterMs: 1000 });
    const { maxBytes = 2_000_000, ...fetchOptions } = options;
    requireValue(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 8_000_000, "Invalid request size contract.");
    this.calls++;
    const observation = { endpoint: u.origin + u.pathname, params: Object.fromEntries([...u.searchParams].filter(([name]) => !sensitive.test(name))), at: stamp(), status: null, bytes: 0, hash: null, rows_count: null, code: null };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(100, Math.min(this.timeoutMs, this.deadline - Date.now())));
    try {
      const response = await this.fetcher(u.href, { ...fetchOptions, redirect: "manual", signal: controller.signal });
      observation.status = response.status;
      if(response.headers.get("cf-mitigated")==="challenge") throw Object.assign(fail("Provider returned a verified challenge.",502,"human_verification"),{failureKind:"blocked"});
      if (response.status === 429) {
        const retry = response.headers.get("retry-after") || "";
        throw Object.assign(fail("Provider rate limit.", 503, "rate_limited"), { retryAfterMs: /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 900000 });
      }
      if (response.status === 401) throw fail("Provider sign-in required.", 401, "authentication_required");
      const jsonType = /json/i.test(response.headers.get("content-type") || "");
      if (response.status >= 300 && response.status < 400) {
        const prefix=await diagnosticPrefix(response,observation);
        if(challengeMarker(response.headers.get("location"))||challengeMarker(prefix))throw Object.assign(fail("Provider returned a verified challenge.",502,"human_verification"),{failureKind:"blocked"});
        throw fail("Provider redirected the request.",502,"source_redirect");
      }
      if (response.status === 403) {
        const prefix=await diagnosticPrefix(response,observation),code=challengeMarker(prefix)?"human_verification":"source_access_denied";
        throw Object.assign(fail(code==="human_verification"?"Provider returned a verified challenge.":"Provider access was denied.",403,code),{failureKind:"blocked"});
      }
      if (!response.ok) throw fail(`Provider returned HTTP ${response.status}.`, 502, "source_http");
      if (!jsonType) {
        const prefix=await diagnosticPrefix(response,observation);
        if(challengeMarker(prefix))throw Object.assign(fail("Provider returned a verified challenge.",502,"human_verification"),{failureKind:"blocked"});
        throw fail("Provider returned an unsupported format.",502,"unsupported_response");
      }
      const reader = response.body?.getReader();
      requireValue(reader, "Provider response body is missing.", "unsupported_response");
      const decode = new TextDecoder(); let raw = "";
      try {
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; observation.bytes += chunk.value.length; if (observation.bytes > maxBytes) { await reader.cancel(); throw fail("Provider page exceeded its bound.", 502, "record_too_large"); } raw += decode.decode(chunk.value, { stream: true }); }
      } finally { reader.releaseLock(); }
      raw += decode.decode();
      let value; try { value = JSON.parse(raw); } catch { throw fail("Provider returned invalid JSON.", 502, "unsupported_response"); }
      observation.hash = await digest(raw);
      observation.rows_count = Array.isArray(value) ? value.length : null;
      observation.retrieved_at = stamp();
      return { value, response, observation };
    } catch (error) {
      // Native AbortError has numeric DOMException.code=20, not a source code.
      const failure = controller.signal.aborted ? fail("Provider request timed out.", 502, "collector_timeout")
        : typeof error?.code === "string" ? error : fail("Provider network request failed.", 502, "source_network");
      observation.code = failure.code;
      throw failure;
    } finally { clearTimeout(timer); this.observations.push(observation); }
  }
}
