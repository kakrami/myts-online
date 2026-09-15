import puppeteer from "@cloudflare/puppeteer";

const VERSION = "1.1.0";
const DEFAULT_TEAM_ID = "212707";
const MAX_CAPTURE_BODY = 700_000;
const MAX_EVENTS_TO_PROBE = 6;
const MAX_REPORT_RESPONSES = 80;

function clean(v) { return String(v ?? "").trim(); }
function uniq(values) { return [...new Set(values.filter(Boolean))]; }
function now() { return new Date().toISOString(); }
function asTeamId(raw) {
  const v = clean(raw || DEFAULT_TEAM_ID);
  if (!/^\d{3,12}$/.test(v)) throw new Error("Team ID must be numeric.");
  return v;
}
function short(s, n = 800) {
  s = clean(s);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function isGotSportUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "rankings.gotsport.com" || h === "system.gotsport.com";
  } catch { return false; }
}
function parseJsonMaybe(text) {
  const s = clean(text);
  if (!s || !["{", "["].includes(s[0])) return null;
  try { return JSON.parse(s); } catch { return null; }
}
function exactObjectEvidence(root, sourceUrl) {
  const out = [];
  const stack = [{ value: root, path: "$" }];
  const seen = new Set();
  let visited = 0;
  const exactIdKeys = new Set(["event_id", "eventId", "org_event_id", "orgEventId"]);
  const teamKeys = new Set(["event_team_id", "eventTeamId"]);
  const groupKeys = new Set(["group_id", "groupId", "schedule_group_id", "scheduleGroupId"]);
  const nameKeys = ["event_name", "eventName", "competition_name", "competitionName", "name", "title"];

  while (stack.length && visited < 10000) {
    const { value, path } = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value); visited++;
    if (!Array.isArray(value)) {
      let eventId = "", eventTeamId = "", groupId = "", name = "";
      for (const [k, v] of Object.entries(value)) {
        const sv = clean(v);
        if (exactIdKeys.has(k) && /^\d+$/.test(sv)) eventId = sv;
        if (teamKeys.has(k) && /^\d+$/.test(sv)) eventTeamId = sv;
        if (groupKeys.has(k) && /^\d+$/.test(sv)) groupId = sv;
      }
      for (const k of nameKeys) {
        if (typeof value[k] === "string" && clean(value[k])) { name = clean(value[k]); break; }
      }
      if (eventId || eventTeamId || groupId) {
        out.push({ source: "json-exact-key", source_url: sourceUrl, path, event_id: eventId, event_team_id: eventTeamId, group_id: groupId, name: short(name, 180) });
      }
      for (const [k, v] of Object.entries(value)) if (v && typeof v === "object") stack.push({ value: v, path: `${path}.${k}` });
    } else {
      for (let i = value.length - 1; i >= 0; i--) if (value[i] && typeof value[i] === "object") stack.push({ value: value[i], path: `${path}[${i}]` });
    }
  }
  return out;
}
function regexEvidence(text, sourceUrl) {
  const out = [];
  const s = String(text || "");
  const add = (kind, m, eventId = "", eventTeamId = "", groupId = "") => out.push({
    source: kind, source_url: sourceUrl, evidence: short(m[0], 260), event_id: eventId, event_team_id: eventTeamId, group_id: groupId,
  });

  for (const m of s.matchAll(/(?:https?:\/\/system\.gotsport\.com)?\/org_event\/events\/(\d+)\/schedules\?[^"'<>\s]*\bteam=(\d+)/gi)) add("team-schedule-url", m, m[1], m[2], "");
  for (const m of s.matchAll(/(?:https?:\/\/system\.gotsport\.com)?\/org_event\/events\/(\d+)\/schedules\?[^"'<>\s]*\bgroup=(\d+)/gi)) add("group-schedule-url", m, m[1], "", m[2]);
  for (const m of s.matchAll(/\/org_event\/events\/(\d+)(?:\/|\b)/gi)) add("event-url", m, m[1], "", "");
  for (const m of s.matchAll(/"(?:event_id|eventId|org_event_id|orgEventId)"\s*:\s*"?(\d+)"?/g)) add("event-json-text", m, m[1], "", "");
  for (const m of s.matchAll(/"(?:event_team_id|eventTeamId)"\s*:\s*"?(\d+)"?/g)) add("event-team-json-text", m, "", m[1], "");
  for (const m of s.matchAll(/"(?:group_id|groupId|schedule_group_id|scheduleGroupId)"\s*:\s*"?(\d+)"?/g)) add("group-json-text", m, "", "", m[1]);
  return out;
}
function mergeEvidence(items) {
  const map = new Map();
  for (const e of items) {
    const key = [e.source, e.source_url, e.path || "", e.event_id || "", e.event_team_id || "", e.group_id || "", e.evidence || ""].join("|");
    if (!map.has(key)) map.set(key, e);
  }
  return [...map.values()];
}
function evidencePairs(evidence) {
  const eventIds = uniq(evidence.map(e => clean(e.event_id)).filter(x => /^\d+$/.test(x)));
  const directTeamPairs = [];
  const directGroupPairs = [];
  for (const e of evidence) {
    if (/^\d+$/.test(clean(e.event_id)) && /^\d+$/.test(clean(e.event_team_id))) directTeamPairs.push({ event_id: clean(e.event_id), event_team_id: clean(e.event_team_id), evidence: e.source, source_url: e.source_url });
    if (/^\d+$/.test(clean(e.event_id)) && /^\d+$/.test(clean(e.group_id))) directGroupPairs.push({ event_id: clean(e.event_id), group_id: clean(e.group_id), evidence: e.source, source_url: e.source_url });
  }
  const dedupe = arr => [...new Map(arr.map(x => [`${x.event_id}|${x.event_team_id || x.group_id}`, x])).values()];
  return { event_ids: eventIds, team_pairs: dedupe(directTeamPairs), group_pairs: dedupe(directGroupPairs) };
}

function createRecorder(page, label) {
  const records = [];
  const tasks = [];
  const handler = response => {
    const task = (async () => {
      const url = response.url();
      if (!isGotSportUrl(url)) return;
      const status = response.status();
      const headers = response.headers();
      const contentType = clean(headers["content-type"] || "");
      const interesting = /json|javascript|text\/html/i.test(contentType) || /api|graphql|rank|game|event|schedule|team|group/i.test(url);
      let body = "";
      if (interesting) {
        try {
          body = await response.text();
          if (body.length > MAX_CAPTURE_BODY) body = body.slice(0, MAX_CAPTURE_BODY);
        } catch {}
      }
      records.push({ label, url, status, content_type: contentType, body });
    })();
    tasks.push(task);
  };
  page.on("response", handler);
  return {
    records,
    async settle() {
      const snapshot = tasks.slice();
      await Promise.allSettled(snapshot);
    },
    stop() { page.off("response", handler); },
  };
}

async function waitForSettled(page) {
  try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 12000 }); } catch {}
  try { await new Promise(r => setTimeout(r, 1000)); } catch {}
}

async function pageSnapshot(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\r/g, "").trim();
    const links = [...document.querySelectorAll("a[href]")].map(a => ({
      href: a.href,
      text: (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim(),
    })).filter(x => x.href).slice(0, 1500);
    const selects = [...document.querySelectorAll("select")].map((s, i) => ({
      index: i,
      name: s.getAttribute("name") || "",
      id: s.id || "",
      value: s.value || "",
      options: [...s.options].map(o => ({ value: o.value, text: (o.textContent || "").replace(/\s+/g, " ").trim(), selected: o.selected })).slice(0, 300),
    })).slice(0, 80);
    const inputs = [...document.querySelectorAll("input")].map((x, i) => ({ index: i, name: x.getAttribute("name") || "", id: x.id || "", type: x.type || "", value: x.value || "" })).slice(0, 300);
    const rows = [...document.querySelectorAll("table tr")].map(tr => [...tr.querySelectorAll("th,td")].map(c => (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)).filter(r => r.length).slice(0, 1000);
    const headings = [...document.querySelectorAll("h1,h2,h3,h4")].map(h => (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 200);
    return { title: document.title || "", url: location.href, text: text.slice(0, 180000), links, selects, inputs, rows, headings };
  });
}

async function waitThroughVerification(page, requestedUrl) {
  const state = { seen: false, passed: false, attempts: 0, urls: [] };
  for (let i = 0; i < 12; i++) {
    state.attempts++;
    const u = page.url();
    state.urls.push(u);
    let body = "";
    try { body = await page.evaluate(() => document.body?.innerText || ""); } catch {}
    const blocked = /\/verify_captchas\/|Please verify to continue|Verifying, please wait|JavaScript is required to verify/i.test(`${u}\n${body}`);
    if (!blocked) {
      if (state.seen) state.passed = true;
      return state;
    }
    state.seen = true;
    await new Promise(r => setTimeout(r, 1500));
  }
  // One retry of the exact requested public URL after the JS challenge had time to establish state/cookies.
  if (state.seen) {
    try {
      await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      await waitForSettled(page);
      const u = page.url();
      state.urls.push(u);
      let body = "";
      try { body = await page.evaluate(() => document.body?.innerText || ""); } catch {}
      const blocked = /\/verify_captchas\/|Please verify to continue|Verifying, please wait|JavaScript is required to verify/i.test(`${u}\n${body}`);
      if (!blocked) state.passed = true;
    } catch {}
  }
  return state;
}

async function navigateAndCapture(page, url, label) {
  const recorder = createRecorder(page, label);
  let navigation = { requested_url: url, final_url: "", status: 0, title: "", error: "" };
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForSettled(page);
    navigation.verification = await waitThroughVerification(page, url);
    navigation.final_url = page.url();
    navigation.status = response?.status?.() || 0;
    navigation.title = await page.title().catch(() => "");
  } catch (e) {
    navigation.error = clean(e?.message || e);
    navigation.final_url = page.url();
  }
  await recorder.settle();
  recorder.stop();
  let snap;
  try { snap = await pageSnapshot(page); } catch (e) { snap = { title: navigation.title, url: navigation.final_url, text: "", links: [], selects: [], rows: [], headings: [], snapshot_error: clean(e?.message || e) }; }
  return { navigation, snapshot: snap, responses: recorder.records };
}

function evidenceFromCapture(capture) {
  const out = [];
  const snap = capture.snapshot || {};
  const sourceUrl = snap.url || capture.navigation?.final_url || capture.navigation?.requested_url || "";
  out.push(...regexEvidence(snap.text || "", sourceUrl));
  for (const l of snap.links || []) out.push(...regexEvidence(`${l.href} ${l.text}`, l.href));
  for (const s of snap.selects || []) {
    out.push(...regexEvidence(`${s.name} ${s.id} ${s.value}`, sourceUrl));
    for (const o of s.options || []) out.push(...regexEvidence(`${o.value} ${o.text}`, sourceUrl));
  }
  for (const i of snap.inputs || []) out.push(...regexEvidence(`${i.name} ${i.id} ${i.value}`, sourceUrl));
  for (const r of snap.rows || []) out.push(...regexEvidence(r.join(" | "), sourceUrl));
  for (const res of capture.responses || []) {
    out.push(...regexEvidence(`${res.url}\n${res.body || ""}`, res.url));
    const parsed = parseJsonMaybe(res.body);
    if (parsed) out.push(...exactObjectEvidence(parsed, res.url));
  }
  return mergeEvidence(out);
}

function upcomingFactsFromArray(parsed, rankingsTeamId, sourceUrl) {
  const out = [];
  const teamId = clean(rankingsTeamId);
  if (!Array.isArray(parsed)) return out;
  for (const m of parsed) {
    if (!m || typeof m !== "object") continue;
    const homeTeamId = clean(m.homeTeam?.team_id ?? m.home_team_id ?? "");
    const awayTeamId = clean(m.awayTeam?.team_id ?? m.away_team_id ?? "");
    const homeReg = clean(m.home_team_reg_id ?? "");
    const awayReg = clean(m.away_team_reg_id ?? "");
    let eventTeamId = "", side = "";
    if (homeTeamId === teamId && /^\d+$/.test(homeReg)) { eventTeamId = homeReg; side = "home"; }
    if (awayTeamId === teamId && /^\d+$/.test(awayReg)) { eventTeamId = awayReg; side = "away"; }
    out.push({
      match_id: clean(m.id), event_id: clean(m.event_id), event_name: clean(m.event_name || m.competition_name),
      event_team_id: eventTeamId, team_side: side, bracket_id: clean(m.bracket_id), schedule_id: clean(m.schedule_id),
      division_name: clean(m.division_name), match_date: clean(m.match_date), match_time: clean(m.matchTime),
      home_team_reg_id: homeReg, away_team_reg_id: awayReg, home_team_id: homeTeamId, away_team_id: awayTeamId,
      home_team_name: clean(m.homeTeam?.full_name), away_team_name: clean(m.awayTeam?.full_name), source_url: sourceUrl,
    });
  }
  return out;
}

function upcomingMatchFacts(capture, rankingsTeamId) {
  const out = [];
  for (const res of capture.responses || []) {
    if (!/\/api\/v1\/teams\/\d+\/matches\?[^#]*upcoming=true/i.test(res.url)) continue;
    const parsed = parseJsonMaybe(res.body);
    out.push(...upcomingFactsFromArray(parsed, rankingsTeamId, res.url));
  }
  return out;
}

async function directUpcoming(teamId) {
  const url = `https://system.gotsport.com/api/v1/teams/${teamId}/matches?upcoming=true`;
  const result = { url, status: 0, content_type: "", ok: false, error: "", facts: [], body_preview: "" };
  try {
    const r = await fetch(url, { headers: { accept: "application/json,text/plain,*/*" } });
    result.status = r.status;
    result.content_type = clean(r.headers.get("content-type") || "");
    const body = await r.text();
    result.body_preview = short(body, 5000);
    const parsed = parseJsonMaybe(body);
    result.facts = upcomingFactsFromArray(parsed, teamId, url);
    result.ok = r.ok && Array.isArray(parsed);
  } catch (e) {
    result.error = clean(e?.message || e);
  }
  return result;
}

function eventTeamRefsFromUpcoming(facts) {
  const byEvent = new Map();
  for (const f of facts) {
    if (!/^\d+$/.test(f.event_id) || !/^\d+$/.test(f.event_team_id)) continue;
    if (!byEvent.has(f.event_id)) byEvent.set(f.event_id, new Set());
    byEvent.get(f.event_id).add(f.event_team_id);
  }
  const out = [];
  for (const [event_id, ids] of byEvent) {
    if (ids.size === 1) out.push({ event_id, event_team_id: [...ids][0], evidence: "upcoming-match-team-registration", source_url: facts.find(f => f.event_id === event_id)?.source_url || "" });
  }
  return out;
}

function directTeamLinks(capture) {
  const out = [];
  for (const l of capture.snapshot?.links || []) {
    const m = l.href.match(/\/org_event\/events\/(\d+)\/schedules\?[^#]*\bteam=(\d+)/i);
    if (m) out.push({ event_id: m[1], event_team_id: m[2], url: l.href, label: l.text });
  }
  for (const r of capture.responses || []) {
    for (const m of `${r.url}\n${r.body || ""}`.matchAll(/(?:https?:\/\/system\.gotsport\.com)?\/org_event\/events\/(\d+)\/schedules\?[^"'<>\s]*\bteam=(\d+)/gi)) {
      out.push({ event_id: m[1], event_team_id: m[2], url: new URL(m[0], "https://system.gotsport.com").href, label: "network evidence" });
    }
  }
  return [...new Map(out.map(x => [`${x.event_id}|${x.event_team_id}`, x])).values()];
}

function authoritativeGroupFromTeamCapture(capture, eventId) {
  const candidates = [];
  const add = (groupId, why, label = "", url = "") => {
    groupId = clean(groupId);
    if (/^\d+$/.test(groupId)) candidates.push({ group_id: groupId, evidence: why, label: short(label, 180), url });
  };

  // A selected group control is authoritative page state, not a name guess.
  for (const s of capture.snapshot?.selects || []) {
    const selected = (s.options || []).filter(o => o.selected);
    for (const o of selected) {
      const v = `${o.value} ${s.value}`;
      let m = v.match(/(?:\bgroup=|^)(\d+)$/i) || v.match(/[?&]group=(\d+)/i);
      if (m) add(m[1], "selected-group-control", o.text, capture.snapshot.url);
    }
  }

  // Exact input/form state.
  for (const i of capture.snapshot?.inputs || []) {
    if (/group/i.test(`${i.name} ${i.id}`) && /^\d+$/.test(clean(i.value))) add(i.value, "team-page-group-input", `${i.name || i.id}`, capture.snapshot.url);
    const m = clean(i.value).match(/[?&]group=(\d+)/i);
    if (m) add(m[1], "team-page-group-input-url", `${i.name || i.id}`, capture.snapshot.url);
  }

  // Explicit group links already present on the team-filtered page.
  for (const l of capture.snapshot?.links || []) {
    const m = l.href.match(new RegExp(`/org_event/events/${eventId}/schedules\\?[^#]*\\bgroup=(\\d+)`, "i"));
    if (m) add(m[1], "team-page-group-link", l.text, l.href);
  }

  // Exact group_id keys in JSON returned while the team page is loaded.
  for (const res of capture.responses || []) {
    const parsed = parseJsonMaybe(res.body);
    if (!parsed) continue;
    for (const e of exactObjectEvidence(parsed, res.url)) if (e.group_id) add(e.group_id, "team-page-json-group-id", e.name, res.url);
  }

  const unique = [...new Map(candidates.map(x => [x.group_id, x])).values()];
  if (unique.length === 1) return { resolved: true, ...unique[0], all_candidates: unique };
  return { resolved: false, group_id: "", evidence: unique.length ? "multiple-authoritative-group-candidates" : "no-authoritative-group-id", all_candidates: unique };
}

function playoffEvidence(capture) {
  const text = [capture.snapshot?.text || "", ...(capture.snapshot?.rows || []).map(r => r.join(" | "))].join("\n");
  const stages = [];
  const patterns = [
    ["Quarterfinal", /\bquarter[ -]?final(?:s)?\b|\bQF\b/gi],
    ["Semifinal", /\bsemi[ -]?final(?:s)?\b|\bSF\b/gi],
    ["Final", /\bchampionship\b|\bfinal\b/gi],
    ["Consolation", /\bconsolation\b|\bthird[ -]?place\b|\b3rd[ -]?place\b/gi],
  ];
  for (const [name, re] of patterns) if (re.test(text)) stages.push(name);
  const placeholders = uniq((text.match(/(?:winner|loser|first|second|1st|2nd)\s+(?:of\s+)?[^\n|]{0,80}/gi) || []).map(x => short(x, 120))).slice(0, 20);
  return { stages: uniq(stages), placeholders, row_count: capture.snapshot?.rows?.length || 0 };
}

function compactResponses(records) {
  return records.slice(0, MAX_REPORT_RESPONSES).map(r => ({
    label: r.label,
    url: r.url,
    status: r.status,
    content_type: r.content_type,
    body_preview: short(r.body, 2200),
  }));
}

async function runProbe(env, teamId) {
  const started = now();
  const rankingsUrl = `https://rankings.gotsport.com/teams/${teamId}/upcoming-games`;
  const report = {
    probe_version: VERSION,
    started_at: started,
    team_id: teamId,
    input_only: { rankings_team_id: teamId },
    success: false,
    stage: "starting",
    proof: {},
    warnings: [],
  };

  report.stage = "upcoming-api";
  const direct = await directUpcoming(teamId);
  let rankings = null, rankingsEvidence = [], pairs = { event_ids: [], team_pairs: [], group_pairs: [] }, teamLinks = [];
  let upcomingFacts = direct.ok ? direct.facts : [];

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 900 });

    if (!upcomingFacts.length) {
      report.stage = "rankings-browser-fallback";
      rankings = await navigateAndCapture(page, rankingsUrl, "rankings");
      rankingsEvidence = evidenceFromCapture(rankings);
      pairs = evidencePairs(rankingsEvidence);
      teamLinks = directTeamLinks(rankings);
      upcomingFacts = upcomingMatchFacts(rankings, teamId);
    }
    const upcomingRefs = eventTeamRefsFromUpcoming(upcomingFacts);
    report.rankings = {
      discovery_method: direct.ok && direct.facts.length ? "direct-public-json-api" : "browser-network-fallback",
      direct_upcoming_api: direct,
      navigation: rankings?.navigation || null,
      title: rankings?.snapshot?.title || "",
      headings: rankings?.snapshot?.headings || [],
      text_preview: rankings ? short(rankings.snapshot.text, 8000) : "",
      upcoming_matches_api: uniq(upcomingFacts.map(x => x.source_url)),
      upcoming_matches: upcomingFacts,
      upcoming_event_team_refs: upcomingRefs,
      exact_evidence: rankingsEvidence.slice(0, 200),
      discovered_event_ids: uniq(upcomingFacts.map(x => x.event_id).filter(Boolean)),
      direct_team_schedule_links: teamLinks,
      network_responses: rankings ? compactResponses(rankings.responses) : [],
    };

    if (!upcomingRefs.length) {
      report.stage = "rankings-no-concrete-upcoming-event-team-id";
      report.warnings.push("Neither the direct public upcoming-matches API nor its browser fallback exposed one unambiguous event-team registration ID for an upcoming event. Production integration must stop here rather than infer one.");
      return report;
    }

    // Only upcoming events with an event-team registration ID concretely tied to this rankings team.
    const eventIds = uniq(upcomingRefs.map(x => x.event_id)).slice(0, MAX_EVENTS_TO_PROBE);
    report.events = [];
    for (const eventId of eventIds) {
      const event = { event_id: eventId, team_schedule: null, group: null, division_schedule: null, success: false };
      let teamRef = upcomingRefs.find(x => x.event_id === eventId) || teamLinks.find(x => x.event_id === eventId) || pairs.team_pairs.find(x => x.event_id === eventId);

      if (!teamRef?.event_team_id) {
        // Render the public event schedule to see whether GotSport exposes an exact team-filter link.
        const baseUrl = `https://system.gotsport.com/org_event/events/${eventId}/schedules`;
        const base = await navigateAndCapture(page, baseUrl, `event-${eventId}`);
        const exact = directTeamLinks(base);
        event.event_page = {
          navigation: base.navigation,
          team_schedule_links: exact,
          network_responses: compactResponses(base.responses),
        };
        if (exact.length === 1) teamRef = exact[0];
        else if (exact.length > 1) {
          event.failure = "Event page exposed multiple team schedule links and none was authoritatively tied to the Rankings team. No name-scoring fallback was used.";
          report.events.push(event);
          continue;
        }
      }

      if (!teamRef?.event_team_id) {
        event.failure = "No concrete event-team ID was exposed for this event.";
        report.events.push(event);
        continue;
      }

      const teamUrl = teamRef.url || `https://system.gotsport.com/org_event/events/${eventId}/schedules?team=${teamRef.event_team_id}`;
      report.stage = `event-${eventId}-team`;
      const teamCapture = await navigateAndCapture(page, teamUrl, `event-${eventId}-team`);
      const group = authoritativeGroupFromTeamCapture(teamCapture, eventId);
      event.team_schedule = {
        event_team_id: teamRef.event_team_id,
        requested_url: teamUrl,
        navigation: teamCapture.navigation,
        group_resolution: group,
        headings: teamCapture.snapshot.headings,
        text_preview: short(teamCapture.snapshot.text, 5000),
        network_responses: compactResponses(teamCapture.responses),
      };

      if (!group.resolved) {
        event.failure = "The team-filtered public schedule did not expose exactly one authoritative group ID. No division-name/frequency guess was used.";
        report.events.push(event);
        continue;
      }

      const groupUrl = `https://system.gotsport.com/org_event/events/${eventId}/schedules?group=${group.group_id}`;
      report.stage = `event-${eventId}-group`;
      const groupCapture = await navigateAndCapture(page, groupUrl, `event-${eventId}-group`);
      const playoffs = playoffEvidence(groupCapture);
      event.group = { group_id: group.group_id, evidence: group.evidence, label: group.label || "" };
      event.division_schedule = {
        requested_url: groupUrl,
        navigation: groupCapture.navigation,
        headings: groupCapture.snapshot.headings,
        rows: (groupCapture.snapshot.rows || []).slice(0, 250),
        playoff_evidence: playoffs,
        text_preview: short(groupCapture.snapshot.text, 8000),
        network_responses: compactResponses(groupCapture.responses),
      };
      event.success = !!groupCapture.snapshot.text && !/Please verify to continue|JavaScript is required to verify/i.test(groupCapture.snapshot.text);
      report.events.push(event);
    }

    const proven = report.events.filter(e => e.success && e.team_schedule?.event_team_id && e.group?.group_id);
    report.success = proven.length > 0;
    report.stage = report.success ? "complete" : "incomplete";
    report.proof = {
      concrete_paths: proven.map(e => ({
        event_id: e.event_id,
        event_team_id: e.team_schedule.event_team_id,
        group_id: e.group.group_id,
        team_schedule_url: e.team_schedule.requested_url,
        group_schedule_url: e.division_schedule.requested_url,
        playoff_stages_seen: e.division_schedule.playoff_evidence.stages,
      })),
      requirement: "Every ID above came from concrete DOM/network/page state. No name-scoring or frequency-based fallback was used.",
    };
    if (!report.success) report.warnings.push("The full zero-input chain was not proven. This report intentionally stops instead of guessing.");
    return report;
  } finally {
    await browser.close().catch(() => {});
  }
}

const UI = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>myTS GotSport Probe</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#18201c;background:#f4f6f5}*{box-sizing:border-box}body{margin:0}.wrap{max-width:920px;margin:auto;padding:28px 18px 70px}h1{font-size:26px;margin:0 0 6px}p{color:#64706a;line-height:1.5}.card{background:#fff;border:1px solid #dde3df;border-radius:14px;padding:18px;margin-top:16px}.status{display:flex;align-items:center;gap:10px;font-weight:700}.dot{width:10px;height:10px;border-radius:99px;background:#c18427}.ok .dot{background:#078b55}.bad .dot{background:#c94957}button{border:1px solid #ccd5d0;border-radius:10px;background:#fff;padding:10px 13px;font-weight:650}pre{white-space:pre-wrap;word-break:break-word;background:#111513;color:#eaf3ee;border-radius:12px;padding:14px;max-height:58vh;overflow:auto;font-size:12px}.muted{font-size:13px;color:#6c7771}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}</style></head>
<body><div class="wrap"><h1>myTS GotSport Probe <small style="font-size:12px;color:#748078">v${VERSION}</small></h1>
<p>Zero-input diagnostic for GotSport Rankings team <b>${DEFAULT_TEAM_ID}</b>. This does not modify myTS or any database.</p>
<div class="card"><div id="status" class="status"><span class="dot"></span><span>Running live GotSport probe…</span></div><div id="summary" class="muted" style="margin-top:8px">Browser Run is tracing the actual page and network data.</div><div class="actions"><button id="rerun">Run again</button><button id="download" disabled>Download report</button></div></div>
<div class="card"><b>Result</b><pre id="out">Waiting…</pre></div></div>
<script>
let last=null; const out=document.getElementById('out'), status=document.getElementById('status'), summary=document.getElementById('summary'), dl=document.getElementById('download');
async function run(){status.className='status';status.querySelector('span:last-child').textContent='Running live GotSport probe…';summary.textContent='Browser Run is tracing the actual page and network data.';out.textContent='Running…';dl.disabled=true;try{const r=await fetch('/api/probe',{cache:'no-store'}),j=await r.json();last=j;out.textContent=JSON.stringify(j,null,2);status.className='status '+(j.success?'ok':'bad');status.querySelector('span:last-child').textContent=j.success?'Concrete GotSport chain proven':'Probe stopped before proof';const n=j.proof?.concrete_paths?.length||0;summary.textContent=j.success?('Resolved '+n+' concrete event → team → group path'+(n===1?'':'s')+'.'):('Stopped at '+(j.stage||'unknown')+' rather than guessing.');dl.disabled=false;}catch(e){status.className='status bad';status.querySelector('span:last-child').textContent='Probe failed';summary.textContent=e.message;out.textContent=e.stack||e.message;}}
document.getElementById('rerun').onclick=run;dl.onclick=()=>{if(!last)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(last,null,2)],{type:'application/json'}));a.download='gotsport_probe_'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};run();
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response(UI, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (url.pathname === "/api/probe") {
      try {
        const teamId = asTeamId(url.searchParams.get("team") || DEFAULT_TEAM_ID);
        const report = await runProbe(env, teamId);
        return json(report, report.success ? 200 : 422);
      } catch (e) {
        return json({ probe_version: VERSION, success: false, stage: "fatal", error: clean(e?.message || e), stack: short(e?.stack || "", 4000), at: now() }, 500);
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
