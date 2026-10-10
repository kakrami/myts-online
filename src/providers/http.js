import { fail, hash, requireValue, stamp, bytes } from "../core.js";
const HOSTS = new Set([
  "api.teamsnap.com",
  "rankings.gotsport.com",
  "system.gotsport.com",
  "gotsportlive-api.azurewebsites.net",
  "teams.traceup.com",
  "api.traceup.com",
  "app.traceup.com",
  "go.traceup.com",
  "traceid.traceup.com",
  "lapi.traceup.com",
]);
export class Transport {
  constructor(env, job = {}) {
    this.env = env;
    this.job = job;
    this.calls = 0;
    this.deadline = Date.now() + 22000;
    this.observations = [];
  }
  async get(url, options = {}, contract = "json") {
    const u = new URL(url);
    requireValue(
      u.protocol === "https:" &&
        (HOSTS.has(u.hostname) ||
          (u.hostname.endsWith(".traceup.com") && contract === "radar")) &&
        !u.username &&
        !u.password,
      "Unsupported provider URL.",
    );
    if (this.calls >= 8 || Date.now() + 500 >= this.deadline)
      throw fail(
        "Collection continues in the next background run.",
        409,
        "request_limit",
      );
    const { maxBytes = 2_000_000, ...fetchOptions } = options;
    this.calls++;
    const at = stamp(),
      obs = {
        id: crypto.randomUUID(),
        job_id: this.job.id || "interactive",
        scan_id: this.job.scan_id || "",
        endpoint: u.origin + u.pathname,
        params: JSON.stringify(
          Object.fromEntries(
            [...u.searchParams].filter(
              ([k]) => !/(token|key|email|code)/i.test(k),
            ),
          ),
        ),
        at,
        status: null,
        rows_count: null,
        bytes: 0,
        hash: null,
        error: null,
      };
    const controller = new AbortController(),
      timer = setTimeout(
        () => controller.abort(),
        Math.max(100, Math.min(10000, this.deadline - Date.now())),
      );
    try {
      const fetcher =
        this.env.PROVIDER_FETCH?.fetch?.bind(this.env.PROVIDER_FETCH) || fetch;
      const r = await fetcher(u.href, {
        ...fetchOptions,
        redirect: "manual",
        signal: controller.signal,
      });
      obs.status = r.status;
      if (r.status === 429) {
        const e = fail(
          "Provider rate limit. Updates will retry.",
          503,
          "source_rate_limited",
        );
        const v = r.headers.get("retry-after");
        e.retry_ms = /^\d+$/.test(v || "")
          ? Number(v) * 1000
          : Math.max(0, Date.parse(v) - Date.now()) || 900000;
        throw e;
      }
      if ([401, 403].includes(r.status))
        throw fail(
          "Provider authorization expired or access was blocked.",
          401,
          "source_auth",
        );
      if (r.status >= 300 && r.status < 400)
        throw fail(
          "Provider redirected to a verification or sign-in page.",
          502,
          "source_verification",
        );
      if (!r.ok)
        throw fail(`Provider returned HTTP ${r.status}.`, 502, "source_http");
      requireValue(
        /json/i.test(r.headers.get("content-type") || ""),
        "Provider returned a page or human-verification challenge.",
        "source_verification",
      );
      const reader = r.body.getReader(),
        decoder = new TextDecoder();
      let raw = "";
      try {
        for (;;) {
          const p = await reader.read();
          if (p.done) break;
          obs.bytes += p.value.length;
          if (obs.bytes > maxBytes) {
            await reader.cancel();
            throw fail("Provider page is too large.", 502, "source_size");
          }
          raw += decoder.decode(p.value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }
      raw += decoder.decode();
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw fail("Provider returned invalid JSON.", 502, "source_json");
      }
      obs.hash = await hash(raw);
      obs.rows_count = Array.isArray(value) ? value.length : null;
      return { value, response: r, observation: obs };
    } catch (e) {
      const error = e.code
        ? e
        : fail(
            controller.signal.aborted
              ? "Provider request timed out."
              : "Provider network request failed.",
            502,
            controller.signal.aborted ? "source_timeout" : "source_network",
          );
      obs.error = JSON.stringify({ code: error.code, message: error.message });
      throw error;
    } finally {
      clearTimeout(timer);
      this.observations.push(obs);
    }
  }
}
export function url(origin, path, params = {}) {
  const u = new URL(path, origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.href;
}
export function unique(rows, id) {
  requireValue(Array.isArray(rows), "Expected a source array.");
  const ids = rows.map(id);
  requireValue(
    ids.every(Boolean) && new Set(ids).size === ids.length,
    "Source contains invalid or duplicate identities.",
  );
  return rows;
}
