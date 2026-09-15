// Public evidence collector. No browser sessions, logins, inferred IDs, or myTS writes.
const VERSION = "1.2.1";
const DEFAULT_TEAM_ID = "212707";
const SYSTEM_ORIGIN = "https://system.gotsport.com";
const RANKINGS_ORIGIN = "https://rankings.gotsport.com";
const MAX_API_BYTES = 2_000_000;
const MAX_ASSET_BYTES = 8_000_000;
const MAX_ASSETS = 5;
const MAX_EXCERPTS = 120;
const REPORT_TTL_MS = 15 * 60_000;
const inFlight = new Map();

const clean = value => String(value ?? "").trim();
const numericId = value => /^[1-9]\d{0,11}$/.test(clean(value)) ? clean(value) : "";
const unique = values => [...new Set(values)];
const iso = time => new Date(time).toISOString();
const short = (value, size = 1000) => String(value ?? "").slice(0, size);

function asTeamId(value) {
  const id = numericId(value || DEFAULT_TEAM_ID);
  if (!id) throw new Error("Team ID must be a positive numeric GotSport Rankings team ID.");
  return id;
}
function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}
function allowedUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password &&
      [SYSTEM_ORIGIN, RANKINGS_ORIGIN].includes(url.origin);
  } catch { return false; }
}
function retryAfterMs(value, nowMs = Date.now()) {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(clean(value))) return Math.ceil(Number(value) * 1000);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - nowMs) : 0;
}
async function readBounded(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`Response exceeds the ${maxBytes}-byte safety limit.`);
  }
  if (!response.body) return { text: "", bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new Error(`Response exceeds the ${maxBytes}-byte safety limit.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return { text: text + decoder.decode(), bytes };
  } finally { reader.releaseLock(); }
}
async function fetchPublic(url, accept, maxBytes, options) {
  const { fetcher, clock, deadline } = options;
  const result = { url, final_url: url, status: 0, content_type: "", ok: false, bytes: 0, text: "", error: "", retry_after_ms: 0 };
  const controller = new AbortController();
  const remaining = Math.max(1, Math.min(12_000, deadline - clock()));
  if (deadline <= clock()) return { ...result, error: "Collection time budget reached." };
  const timer = setTimeout(() => controller.abort(), remaining);
  let next = url;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!allowedUrl(next)) throw new Error("Refused a request outside the two public GotSport origins.");
      const response = await fetcher(next, {
        method: "GET", redirect: "manual", credentials: "omit",
        headers: { accept }, signal: controller.signal,
      });
      result.status = response.status;
      result.final_url = next;
      result.content_type = clean(response.headers.get("content-type"));
      result.retry_after_ms = retryAfterMs(response.headers.get("retry-after"), clock());
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        void response.body?.cancel().catch(() => {});
        if (!location) throw new Error("Redirect without a Location header.");
        next = new URL(location, next).href;
        if (/\/verify_captchas(?:\/|\?|$)/i.test(next)) throw new Error("Public request redirected to verification. No challenge was attempted.");
        if (redirects === 3) throw new Error("Too many redirects.");
        continue;
      }
      const body = await readBounded(response, maxBytes);
      result.text = body.text;
      result.bytes = body.bytes;
      result.ok = response.ok;
      if (!response.ok) result.error = `HTTP ${response.status}`;
      return result;
    }
  } catch (error) { result.error = short(error?.message || error); }
  finally { clearTimeout(timer); }
  return result;
}
function publicResponseInfo(result) {
  const { text, ...info } = result;
  return info;
}

// These exact field relationships were returned in the user's v1.1 diagnostic.
function extractUpcoming(matches, teamId, sourceUrl) {
  if (!Array.isArray(matches)) throw new Error("Expected the public upcoming-matches API to return a JSON array.");
  const facts = [], errors = [], seen = new Map();
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    if (!match || typeof match !== "object" || Array.isArray(match)) {
      errors.push({ index, error: "Match is not an object." });
      continue;
    }
    const homeId = numericId(match.homeTeam?.team_id), awayId = numericId(match.awayTeam?.team_id);
    const home = homeId === teamId, away = awayId === teamId;
    if (home === away) {
      errors.push({ index, match_id: clean(match.id), error: "The requested team must match exactly one homeTeam/awayTeam team_id." });
      continue;
    }
    const side = home ? "home" : "away";
    const eventId = numericId(match.event_id), matchId = numericId(match.id);
    const registrationId = numericId(match[`${side}_team_reg_id`]);
    if (!eventId || !matchId || !registrationId) {
      errors.push({ index, error: "Missing exact event_id, match id, or matching team registration id." });
      continue;
    }
    const fact = {
      match_id: matchId, event_id: eventId, event_name: clean(match.event_name),
      event_team_id: registrationId, team_side: side,
      bracket_id: numericId(match.bracket_id), schedule_id: numericId(match.schedule_id),
      division_name: clean(match.division_name), match_date: clean(match.match_date), match_time: clean(match.matchTime),
      home_team_id: homeId, away_team_id: awayId,
      home_team_reg_id: numericId(match.home_team_reg_id), away_team_reg_id: numericId(match.away_team_reg_id),
      home_team_name: clean(match.homeTeam?.full_name), away_team_name: clean(match.awayTeam?.full_name),
      source_url: sourceUrl,
      evidence: { team_id_path: `$[${index}].${side}Team.team_id`, registration_id_path: `$[${index}].${side}_team_reg_id`, event_id_path: `$[${index}].event_id` },
    };
    const signature = JSON.stringify({ ...fact, evidence: undefined });
    if (seen.has(matchId)) {
      if (seen.get(matchId) !== signature) errors.push({ index, match_id: matchId, error: "Conflicting duplicate match identity." });
      continue;
    }
    seen.set(matchId, signature);
    facts.push(fact);
  }
  const pairs = new Map();
  for (const fact of facts) {
    const key = `${fact.event_id}:${fact.event_team_id}`;
    if (!pairs.has(key)) pairs.set(key, {
      event_id: fact.event_id, event_name: fact.event_name, event_team_id: fact.event_team_id,
      bracket_ids: [], schedule_ids: [], match_ids: [], source_url: sourceUrl,
    });
    const ref = pairs.get(key);
    ref.match_ids.push(fact.match_id);
    if (fact.bracket_id) ref.bracket_ids = unique([...ref.bracket_ids, fact.bracket_id]);
    if (fact.schedule_id) ref.schedule_ids = unique([...ref.schedule_ids, fact.schedule_id]);
  }
  return { valid: !errors.length, facts, event_team_refs: [...pairs.values()], errors };
}
function scriptUrl(raw, base) {
  try {
    const url = new URL(raw.replaceAll("&amp;", "&"), base);
    if (url.origin !== RANKINGS_ORIGIN || !/\.(?:m?js)$/.test(url.pathname) || url.username || url.password) return "";
    return url.href;
  } catch { return ""; }
}
function scriptReferences(html, pageUrl) {
  const urls = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = scriptUrl(match[1], pageUrl);
    if (url) urls.push(url);
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']modulepreload["']/i.test(match[0])) continue;
    const href = match[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = href ? scriptUrl(href, pageUrl) : "";
    if (url) urls.push(url);
  }
  return unique(urls);
}
function importedScripts(source, base) {
  const urls = [];
  // Only literal ECMAScript import references have a known URL resolution rule.
  // Vite dependency arrays and interpolated paths are left in the evidence,
  // not turned into speculative requests.
  const patterns = [
    /\bimport\s*\(\s*["']((?:\/|\.\.?\/)[^"'\\\s]{1,220}\.(?:m?js)(?:\?[^"'\\\s]*)?)["']/g,
    /\b(?:from|import)\s*["']((?:\/|\.\.?\/)[^"'\\\s]{1,220}\.(?:m?js)(?:\?[^"'\\\s]*)?)["']/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
    const url = scriptUrl(match[1], base);
    if (url) urls.push(url);
  }
  return unique(urls);
}
function routeEvidence(source, sourceUrl, limit = MAX_EXCERPTS) {
  const pattern = /\/api\/(?:v\d+\/)?|\bbracket_id\b|\bschedule_id\b|\bschedule_group_id\b|\bgroup_id\b|\bplayoff_element\b/g;
  const hits = [];
  for (const match of source.matchAll(pattern)) hits.push({ term: match[0], index: match.index });
  const excerpts = [];
  let coveredThrough = -1;
  for (const hit of hits) {
    if (hit.index < coveredThrough) continue;
    if (excerpts.length >= limit) break;
    const start = Math.max(0, hit.index - 450), end = Math.min(source.length, hit.index + 1000);
    excerpts.push({ source_url: sourceUrl, character_offset: hit.index, term: hit.term, snippet: source.slice(start, end) });
    coveredThrough = end;
  }
  return {
    terms_found: unique(hits.map(hit => hit.term)), hit_count: hits.length,
    excerpts, excerpt_limit_reached: hits.some(hit => hit.index >= coveredThrough),
  };
}
async function discoverRoutes(teamId, options) {
  const url = `${RANKINGS_ORIGIN}/teams/${teamId}/upcoming-games`;
  const page = await fetchPublic(url, "text/html", 1_000_000, options);
  const result = { page: publicResponseInfo(page), discovered_script_urls: [], assets: [], api_snippets: [], complete: false, errors: [] };
  if (!page.ok || !/text\/html/i.test(page.content_type)) {
    result.errors.push(page.error || "Rankings page did not return HTML.");
    return result;
  }
  const queue = scriptReferences(page.text, url), queued = new Set(queue);
  result.discovered_script_urls = [...queue];
  if (!queue.length) result.errors.push("Rankings HTML contained no supported same-origin JavaScript reference.");
  while (queue.length && result.assets.length < MAX_ASSETS && options.clock() < options.deadline) {
    const assetUrl = queue.shift();
    const asset = await fetchPublic(assetUrl, "application/javascript,text/javascript", MAX_ASSET_BYTES, options);
    const info = { ...publicResponseInfo(asset), terms_found: [], hit_count: 0, excerpt_limit_reached: false };
    if (asset.ok && /(?:javascript|ecmascript|text\/plain|application\/octet-stream)/i.test(asset.content_type) && !/^\s*</.test(asset.text)) {
      const evidence = routeEvidence(asset.text, assetUrl, Math.max(0, MAX_EXCERPTS - result.api_snippets.length));
      info.terms_found = evidence.terms_found;
      info.hit_count = evidence.hit_count;
      info.excerpt_limit_reached = evidence.excerpt_limit_reached;
      result.api_snippets.push(...evidence.excerpts);
      for (const imported of importedScripts(asset.text, assetUrl)) if (!queued.has(imported)) {
        queued.add(imported); queue.push(imported); result.discovered_script_urls.push(imported);
      }
    } else {
      info.ok = false;
      info.error ||= "Script reference did not return a JavaScript response.";
      result.errors.push(`${assetUrl}: ${info.error}`);
    }
    result.assets.push(info);
    if (asset.status === 429) {
      result.errors.push("Rankings asset requests stopped after HTTP 429; Retry-After is recorded.");
      break;
    }
  }
  result.uninspected_script_urls = queue;
  result.complete = result.assets.length > 0 && !result.errors.length && !queue.length && !result.assets.some(asset => asset.excerpt_limit_reached);
  return result;
}

async function runProbe(teamId, { fetcher = fetch, clock = Date.now } = {}) {
  const started = clock();
  const options = { fetcher, clock, deadline: started + 25_000 };
  const report = {
    probe_version: VERSION, started_at: iso(started), team_id: teamId,
    input_only: { rankings_team_id: teamId }, success: false, stage: "starting",
    collection_status: "running", browser: { used: false, launch_attempts: 0 },
    proof: { concrete_paths: [], team_event_registration_paths: [], missing: ["Authoritative division/group mapping", "Complete published division schedule, including playoff fixtures"] },
    warnings: [],
  };
  // Attach every result immediately. An error later must not erase earlier evidence.
  const apiUrl = `${SYSTEM_ORIGIN}/api/v1/teams/${teamId}/matches?upcoming=true`;
  const api = await fetchPublic(apiUrl, "application/json", MAX_API_BYTES, options);
  report.rankings = { discovery_method: "direct-public-json-api", direct_upcoming_api: publicResponseInfo(api), upcoming_matches: [], upcoming_event_team_refs: [] };
  let valid = false;
  if (api.ok) {
    try {
      if (!/application\/(?:[\w.+-]*\+)?json/i.test(api.content_type)) throw new Error("Upcoming endpoint did not return JSON content.");
      const parsed = JSON.parse(api.text);
      const extracted = extractUpcoming(parsed, teamId, apiUrl);
      report.rankings.raw_upcoming_matches = parsed;
      report.rankings.upcoming_matches = extracted.facts;
      report.rankings.upcoming_event_team_refs = extracted.event_team_refs;
      report.rankings.validation_errors = extracted.errors;
      report.rankings.direct_upcoming_api.schema_valid = extracted.valid;
      valid = extracted.valid;
      report.proof.team_event_registration_paths = extracted.event_team_refs;
      if (!extracted.valid) report.warnings.push("Some API records failed exact identity checks. Valid records are retained, but discovery is not marked complete.");
    } catch (error) {
      report.rankings.direct_upcoming_api.schema_valid = false;
      report.rankings.direct_upcoming_api.error = short(error.message || error);
      report.rankings.response_preview = short(api.text);
    }
  }
  try { report.rankings_bundle_discovery = await discoverRoutes(teamId, options); }
  catch (error) { report.rankings_bundle_discovery = { complete: false, errors: [short(error?.message || error)] }; }
  report.discovery_complete = valid;
  const routesComplete = report.rankings_bundle_discovery.complete;
  report.collection_status = valid && routesComplete ? "complete" : valid || routesComplete ? "partial" : "failed";
  report.stage = valid ? (report.rankings.upcoming_matches.length ? "evidence-collected-division-unresolved" : "no-upcoming-matches") : "upcoming-api-unavailable";
  report.warnings.push("This report does not prove a full tournament schedule. Bracket and schedule IDs are not substituted for group IDs. JavaScript excerpts are evidence for inspection, not a verified schedule API.");
  const responses = [api, report.rankings_bundle_discovery.page, ...(report.rankings_bundle_discovery.assets || [])].filter(Boolean);
  const transient = responses.some(response => response.status === 429 || response.status >= 500 || !response.status);
  const requestedDelay = Math.max(0, ...responses.map(response => response.retry_after_ms || 0));
  const finished = clock();
  const ttlMs = transient ? Math.max(60_000, requestedDelay) : REPORT_TTL_MS;
  report.finished_at = iso(finished);
  report.next_check_at = iso(finished + ttlMs);
  report.retry_recommended = transient;
  report.retry_reason = transient ? "A public HTTP request was unavailable or rate-limited. No browser retry is involved." : "";
  return report;
}

async function cachedProbe(teamId, origin, { cache, fetcher = fetch, clock = Date.now } = {}) {
  const key = new Request(`${origin}/_probe_report/${VERSION}/${teamId}`);
  let cacheError = "";
  if (cache) {
    try {
      const response = await cache.match(key);
      if (response) {
        const report = await response.json();
        if (report.probe_version === VERSION && Date.parse(report.next_check_at) > clock()) return { ...report, cached: true };
      }
    } catch (error) { cacheError = short(error?.message || error); }
  }
  if (inFlight.has(key.url)) return { ...await inFlight.get(key.url), shared_in_flight: true };
  const task = (async () => {
    const report = await runProbe(teamId, { fetcher, clock });
    report.report_url = `${origin}/api/probe?team=${teamId}`;
    report.cached = false;
    if (cacheError) report.warnings.push(`Report cache read failed: ${cacheError}`);
    if (cache) {
      const maxAge = Math.max(1, Math.ceil((Date.parse(report.next_check_at) - clock()) / 1000));
      try { await cache.put(key, json(report, 200, { "cache-control": `public, max-age=${maxAge}` })); }
      catch (error) { report.warnings.push(`Report cache write failed: ${short(error?.message || error)}`); }
    }
    return report;
  })();
  inFlight.set(key.url, task);
  try { return await task; } finally { inFlight.delete(key.url); }
}

const UI = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GotSport diagnostic</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2521;background:#f4f6f5}*{box-sizing:border-box}body{margin:0}.wrap{max-width:880px;margin:auto;padding:22px 16px}header{display:flex;align-items:baseline;gap:10px}h1{font-size:22px;margin:0}small,.muted{color:#64716a}p{line-height:1.5}.card{background:white;border:1px solid #dce3df;border-radius:12px;padding:16px;margin-top:16px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}button{font:inherit;font-size:14px;border:1px solid #cbd6cf;background:#fff;border-radius:8px;padding:9px 12px;cursor:pointer}button:disabled{opacity:.5;cursor:default}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.45;max-height:55vh;overflow:auto;margin:10px 0 0}a{overflow-wrap:anywhere;color:inherit}#status{font-weight:650}#summary{margin:8px 0 0;font-size:14px}details summary{cursor:pointer;font-size:14px}.muted{font-size:13px}</style></head>
<body><main class="wrap"><header><h1>GotSport diagnostic</h1><small>v${VERSION}</small></header>
<p class="muted">Public API and JavaScript evidence only. No browser sessions. myTS is unchanged.</p>
<section class="card"><div id="status" role="status" aria-live="polite">Collecting public evidence…</div><p id="summary">Starting with team ${DEFAULT_TEAM_ID}.</p><p id="next" class="muted"></p>
<div class="actions"><button id="download" disabled>Download report</button><button id="copy" disabled>Copy report link</button></div><p id="link" class="muted"></p></section>
<section class="card"><details><summary>Collected evidence</summary><pre id="output">Waiting…</pre></details></section></main>
<script>
let last=null, busy=false, retries=0, retryTimer=null;
const statusEl=document.getElementById('status'),summary=document.getElementById('summary'),next=document.getElementById('next'),out=document.getElementById('output'),download=document.getElementById('download'),copy=document.getElementById('copy'),link=document.getElementById('link');
const team=new URLSearchParams(location.search).get('team')||'${DEFAULT_TEAM_ID}';
async function run(){
 if(busy)return;busy=true;clearTimeout(retryTimer);
 try{
  const response=await fetch('/api/probe?team='+encodeURIComponent(team),{cache:'no-store'}),j=await response.json();
  if(!response.ok)throw new Error(j.error||('HTTP '+response.status));
  last=j;out.textContent=JSON.stringify(j,null,2);
  const matches=j.rankings?.upcoming_matches?.length||0,events=j.rankings?.upcoming_event_team_refs?.length||0;
  statusEl.textContent=j.collection_status==='complete'?'Evidence collected':j.collection_status==='partial'?'Partial evidence retained':'Source unavailable';
  summary.textContent=j.discovery_complete?(matches+' team matches across '+events+' event entries. Full division/playoff schedule is not yet proven.'):'The API response could not be validated. Any other collected evidence is retained below.';
  next.textContent=j.cached?'Showing the saved report; no new source requests were needed.':'No Cloudflare browser was launched.';
  if(j.report_url){const a=document.createElement('a');a.href=j.report_url;a.textContent=j.report_url;link.replaceChildren(a);copy.disabled=false;}
  download.disabled=false;
  if(j.retry_recommended&&retries<2){const delay=Math.max(1000,Date.parse(j.next_check_at)-Date.now()+1000);retries++;next.textContent+=' An HTTP retry is scheduled for '+new Date(j.next_check_at).toLocaleTimeString()+' while this page stays open.';retryTimer=setTimeout(run,Math.min(delay,2147483647));}
 }catch(error){statusEl.textContent='Diagnostic request failed';summary.textContent=error.message;next.textContent='No browser sessions are used by this version.';if(!last)out.textContent=error.message;}
 finally{busy=false;}
}
download.onclick=()=>{if(!last)return;const url=URL.createObjectURL(new Blob([JSON.stringify(last,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='gotsport_probe_'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
copy.onclick=async()=>{try{await navigator.clipboard.writeText(last.report_url);copy.textContent='Link copied';}catch{link.textContent=last.report_url;}};
run();
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) return json({ error: "Method not allowed." }, 405, { allow: "GET, HEAD" });
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname === "/") return new Response(request.method === "HEAD" ? null : UI, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
    if (url.pathname !== "/api/probe") return new Response("Not found", { status: 404 });
    if (request.method === "HEAD") return new Response(null, { status: 200 });
    let teamId;
    try { teamId = asTeamId(url.searchParams.get("team")); }
    catch (error) { return json({ error: error.message, probe_version: VERSION }, 400); }
    try {
      const cache = typeof caches !== "undefined" ? caches.default : undefined;
      return json(await cachedProbe(teamId, url.origin, { cache }));
    } catch (error) {
      return json({ probe_version: VERSION, success: false, stage: "collector-error", browser: { used: false, launch_attempts: 0 }, error: short(error?.message || error) }, 500);
    }
  },
};

// Named exports let the regression tests exercise exactly the shipped implementation.
export { VERSION, asTeamId, allowedUrl, retryAfterMs, readBounded, extractUpcoming, scriptReferences, importedScripts, routeEvidence, runProbe, cachedProbe };
