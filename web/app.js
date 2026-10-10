import { download, excel } from "./export.js";
const VERSION = "7.0.0",
  $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  I = {
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    settings:
      '<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4"/><circle cx="12" cy="12" r="5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
    next: '<path d="m10 5 7 7-7 7"/>',
    overview: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    schedule:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
    competitions:
      '<path d="M7 3h10v6a5 5 0 0 1-10 0ZM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 2v6m-4 1h8"/>',
    team: '<circle cx="9" cy="7" r="3"/><path d="M2 20v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
    bookmarks: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
    star: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
    refresh: '<path d="M20 7a9 9 0 1 0 1 9M20 2v6h-6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    stats: '<path d="M4 20v-6m8 6V8m8 12V3"/>',
    share:
      '<circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="m8 11 8-5m-8 7 8 5"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    pause: '<path d="M8 4v16m8-16v16"/>',
  };
const icon = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || I.stats}</svg>`;
const state = {
  owner: false,
  spaces: [],
  space: null,
  settings: { timezone: "America/Los_Angeles" },
  view: "overview",
  season: "all",
  teams: [],
  favorites: new Set(),
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDay: null,
  filter: "all",
  range: "upcoming",
  fixtures: [],
  pageCursor: null,
  sheets: [],
  busy: 0,
  requestVersion: 0,
  coach: null,
  coachFixture: null,
  coachSelected: null,
  lastStatus: null,
  share: location.pathname.startsWith("/view/")
    ? location.pathname.split("/")[2]
    : null,
};
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
async function request(path, opts = {}) {
  const headers = {
    Accept: "application/json",
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
    ...(state.share ? { "x-view-key": state.share } : {}),
    ...opts.headers,
  };
  state.busy++;
  $("#busy").hidden = false;
  try {
    const r = await fetch(path, {
        ...opts,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }),
      p = await r.json();
    if (!r.ok) {
      const e = new Error(p.error?.message || "Request failed.");
      e.code = p.error?.code;
      e.status = r.status;
      throw e;
    }
    return p;
  } finally {
    state.busy--;
    $("#busy").hidden = state.busy === 0;
  }
}
const endpoint = (path, params = {}) =>
  path + "?" + new URLSearchParams({ space: state.space, ...params });
function errorCard(e) {
  return `<div class="alert error">${esc(e.message)}</div>`;
}
function button(action, label, kind = "", data = "") {
  return `<button data-action="${action}" class="${kind}" ${data}>${label}</button>`;
}
function badge(label, kind = "") {
  return `<span class="badge ${kind}">${esc(label)}</span>`;
}
const empty = (title, detail = "", action = "") =>
  `<div class="empty"><h2>${esc(title)}</h2><p>${esc(detail)}</p>${action}</div>`;
const field = (name, label, value = "", type = "text", extra = "") =>
  `<div class="field"><label for="field-${esc(name)}">${esc(label)}</label><input id="field-${esc(name)}" name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const formatDate = (v, options = {}) => {
  if (!v) return "Date pending";
  const d = new Date(v.length === 10 ? v + "T12:00:00" : v);
  return Number.isFinite(+d)
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: state.settings.timezone,
        ...options,
      }).format(d)
    : "Date pending";
};
function localDay(v) {
  if (!v) return "";
  if (v.length === 10) return v;
  const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: state.settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(v)),
    get = (t) => p.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function teamLogo(team) {
  if (!team) return "";
  const ownClubs = [
      ...new Set(
        state.teams
          .filter((t) => t.role !== "followed")
          .map((t) => t.club_id)
          .filter(Boolean),
      ),
    ],
    club =
      team.club_id ||
      (state.teams.some((t) => t.id === team.id && t.role !== "followed") &&
      ownClubs.length === 1
        ? ownClubs[0]
        : null),
    src = state.brandingValues?.["logo:" + club] || team.details?.logo;
  return src
    ? `<img class="club-logo" src="${esc(src)}" alt="" loading="lazy">`
    : "";
}
function kitsHTML(team, season) {
  const kits =
    state.brandingValues?.["kits:" + team.club_id + ":" + season] || [];
  return kits.length
    ? `<div class="chips">${kits.map((k) => `<span class="badge"><i class="kit-swatch" style="background:${esc(k.color)}"></i>${esc(k.name)}</span>`).join("")}</div>`
    : "";
}
function fixtureRow(f) {
  const d = f.starts_at || f.local_day,
    own = new Set(
      state.teams.filter((t) => t.role !== "followed").map((t) => t.id),
    ),
    fav = state.favorites.has(f.id);
  return `<div class="fixture" role="button" tabindex="0" data-action="fixture" data-id="${esc(f.id)}"><div class="date"><b>${esc(formatDate(d, { day: "numeric" }))}</b><small>${esc(formatDate(d, { month: "short" }))}</small></div><div class="sides"><div class="side"><span ${own.has(f.home_id) ? 'style="font-weight:700"' : ""}>${esc(f.home_name || "Home")}</span><b>${f.home_score ?? ""}</b></div><div class="side"><span ${own.has(f.away_id) ? 'style="font-weight:700"' : ""}>${esc(f.away_name || "Away")}</span><b>${f.away_score ?? ""}</b></div><div class="meta">${esc(f.type !== "game" ? f.title || f.type : [f.time_pending ? "Time TBD" : formatDate(d, { hour: "numeric", minute: "2-digit" }), f.venue || f.round].filter(Boolean).join(" · "))} · ${esc(f.provider === "live" ? "GotSport Live" : f.provider === "gotsport" ? "GotSport" : f.provider === "teamsnap" ? "TeamSnap" : "Trace")}${f.conditional ? " · Conditional slot" : ""}${["CANCELLED", "POSTPONED", "INTERRUPTED"].includes(f.status) ? " · " + f.status : ""}</div></div><div class="mark">${fav ? icon("bookmarks") : f.provider === "trace" ? icon("stats") : ""}</div></div>`;
}
function nav() {
  const tabs = [
    ["overview", "Overview"],
    ["schedule", "Schedule"],
    ["competitions", "Competitions"],
    ["team", "Team"],
    ["bookmarks", "Bookmarks"],
  ];
  $("#nav").innerHTML = tabs
    .map(
      ([id, label]) =>
        `<button data-action="nav" data-view="${id}" class="${state.view === id ? "active" : ""}">${icon(id)}<span>${label}</span></button>`,
    )
    .join("");
}
function selectors() {
  const select = $("#team-picker");
  select.innerHTML = state.spaces
    .map(
      (s) =>
        `<option value="${esc(s.id)}" ${s.id === state.space ? "selected" : ""}>${esc(s.name)}</option>`,
    )
    .join("");
  const y = new Date().getFullYear();
  $("#season-picker").innerHTML =
    '<option value="all">All seasons</option>' +
    Array.from({ length: 10 }, (_, i) => y + 1 - i)
      .map(
        (n) =>
          `<option value="${n}" ${String(n) === state.season ? "selected" : ""}>${n}–${n + 1}</option>`,
      )
      .join("");
  $("#context").hidden = !state.spaces.length;
  $("#nav").hidden = !state.spaces.length;
  $("#search-open").hidden = !state.spaces.length;
}
function mount(html) {
  $("#root").innerHTML = html;
  nav();
}
function showSheet(title, html, kind = "", data = {}, actions = "") {
  const desc = { title, html, kind, data, actions };
  state.sheets.push(desc);
  history.pushState({ mytsSheet: state.sheets.length }, "");
  paintSheet(desc);
}
function replaceSheet(title, html, kind = "", data = {}, actions = "") {
  const desc = { title, html, kind, data, actions };
  if (state.sheets.length) state.sheets[state.sheets.length - 1] = desc;
  else state.sheets.push(desc);
  paintSheet(desc);
}
function paintSheet(d) {
  $("#sheet-title").textContent = d.title;
  $("#sheet-body").innerHTML = d.html;
  $("#sheet-actions").innerHTML = d.actions;
  $("#sheet-back").hidden = state.sheets.length < 2;
  if (!$("#sheet").open) $("#sheet").showModal();
  $("#sheet-body").scrollTop = 0;
  if (d.kind === "coach") renderCoach();
  drawHeatmaps();
}
function closeSheet() {
  if (state.sheets.length) history.go(-state.sheets.length);
  else $("#sheet").close();
}
window.addEventListener("popstate", async (e) => {
  const n = e.state?.mytsSheet || 0;
  state.sheets = state.sheets.slice(0, n);
  if (n && state.sheets[n - 1]) {
    const desc = state.sheets[n - 1];
    paintSheet(desc);
    if (state.refreshAfterBack) {
      state.refreshAfterBack = false;
      try {
        if (desc.kind === "fixture") await showFixture(desc.data.id, true);
        if (desc.kind === "player") await showPlayer(desc.data.id, true);
        if (desc.kind === "stats-player")
          await statsPlayer(desc.data.id, desc.data.fixture, true);
      } catch (err) {
        toast(err.message);
      }
    }
  } else {
    state.sheets = [];
    $("#sheet").close();
    state.coach = null;
    state.refreshAfterBack = false;
  }
});
$("#sheet").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeSheet();
});
$("#sheet").addEventListener("click", (e) => {
  if (e.target === $("#sheet")) closeSheet();
});
function login(error = "", installed = true) {
  $("#context").hidden = true;
  $("#nav").hidden = true;
  mount(
    `<form class="login card" data-form="login"><h1>Welcome to myTS</h1><p class="muted">${installed ? "Sign in to manage your teams." : "Start your fresh myTS installation."}</p>${field("key", "Admin key", "", "password", 'required autocomplete="current-password"')}<p class="error-text">${esc(error)}</p><button class="primary" type="submit">${installed ? "Sign in" : "Initialize & sign in"}</button></form>`,
  );
}
async function boot() {
  document.body.dataset.theme = localStorage.getItem("myts7_theme") || "";
  $("#search-open").innerHTML = icon("search");
  $("#settings-open").innerHTML = icon("settings");
  $("#sheet-close").innerHTML = icon("close");
  $("#sheet-back").innerHTML = icon("back");
  let token = null,
    client = sessionStorage.getItem("myts7_client");
  if (location.hash.includes("access_token")) {
    const q = new URLSearchParams(location.hash.slice(1)),
      expected = sessionStorage.getItem("myts7_oauth");
    history.replaceState(null, "", "/admin");
    if (q.get("state") !== expected) {
      toast("TeamSnap sign-in state did not match. Try again.");
    } else token = q.get("access_token");
    sessionStorage.removeItem("myts7_oauth");
  }
  try {
    const system = await request("/api/state");
    state.installed = system.installed;
    if (!system.secret_configured) {
      mount(
        empty(
          "Setup required",
          "Set the ADMIN_KEY secret in Cloudflare, then reload.",
        ),
      );
      return;
    }
    if (!system.installed) {
      login("", false);
      return;
    }
    const b = await request("/api/bootstrap");
    state.owner = b.owner;
    state.spaces = b.spaces;
    state.settings = { ...state.settings, ...b.settings };
    state.space = state.share
      ? b.spaces[0]?.id
      : localStorage.getItem("myts7_space");
    if (!state.spaces.some((s) => s.id === state.space))
      state.space = state.spaces[0]?.id;
    selectors();
    if (token) {
      await request("/api/admin/teamsnap/connect", {
        method: "POST",
        body: { access_token: token, client_id: client },
      });
      toast("TeamSnap connected. Teams are being collected.");
    }
    if (!state.space) {
      mount(
        empty(
          "Add your teams",
          "Connect TeamSnap or create a team to get started.",
          state.owner ? button("settings", "Connect accounts", "primary") : "",
        ),
      );
      return;
    }
    await loadContext();
    await render();
  } catch (e) {
    if (e.status === 401 && !state.share) login();
    else mount(errorCard(e));
  }
}
async function loadContext() {
  const [teams, favorites, branding] = await Promise.all([
    request(endpoint("/api/teams")),
    request(endpoint("/api/favorites")),
    request(endpoint("/api/branding")),
  ]);
  state.teams = teams.teams;
  state.brandingValues = branding.branding;
  state.favorites = new Set(favorites.favorites.map((f) => f.entity_id));
}
async function getAllFixtures(params) {
  let items = [],
    cursor = null;
  for (let i = 0; i < 30; i++) {
    const p = await request(
      endpoint("/api/fixtures", {
        limit: 100,
        ...params,
        ...(cursor ? { cursor } : {}),
      }),
    );
    items.push(...p.items);
    cursor = p.cursor;
    if (!cursor) return items;
  }
  throw new Error(
    "This range contains too many events. Select a smaller range.",
  );
}
async function render() {
  const seq = ++state.requestVersion;
  nav();
  const root = $("#root");
  root.setAttribute("aria-busy", "true");
  try {
    let html = "";
    if (state.view === "overview") {
      const today = localDay(new Date().toISOString()),
        next = await request(
          endpoint("/api/fixtures", { from: today, limit: 8 }),
        ),
        past = await request(
          endpoint("/api/fixtures", {
            ...(state.season === "all"
              ? { from: String(new Date().getFullYear() - 1) + "-07-01" }
              : { season: state.season }),
            to: today,
            limit: 100,
          }),
        ),
        status = await request(endpoint("/api/status")),
        games = past.items.filter(
          (f) => f.type === "game" && f.status === "FINAL",
        ),
        ours = new Set(
          state.teams.filter((t) => t.role !== "followed").map((t) => t.id),
        );
      let wins = 0,
        draws = 0,
        losses = 0;
      for (const g of games) {
        const home = ours.has(g.home_id),
          a = home ? g.home_score : g.away_score,
          b = home ? g.away_score : g.home_score;
        if (a == null || b == null) continue;
        if (a > b) wins++;
        else if (a === b) draws++;
        else losses++;
      }
      html = `<div class="toolbar"><h2 class="row">${teamLogo(state.teams.find((t) => t.club_id && t.role !== "followed"))}${esc(state.spaces.find((s) => s.id === state.space)?.name)}</h2>${button("status", icon("refresh"), "icon", 'aria-label="Sync status"')}</div>${status.summary.error ? `<div class="alert">${status.summary.error} source component${status.summary.error === 1 ? " is" : "s are"} delayed. ${button("status", "View status", "ghost")}</div>` : ""}<div class="grid"><div class="stat"><b>${games.length}${past.cursor ? "+" : ""}</b><small>Saved completed games</small></div><div class="stat"><b>${wins}–${draws}–${losses}</b><small>W · D · L${past.cursor ? " · recent page" : ""}</small></div></div><div class="section-title"><h3>Coming up</h3>${button("nav", "Schedule", "ghost", 'data-view="schedule"')}</div><div class="card" style="padding:0">${next.items.length ? next.items.map(fixtureRow).join("") : empty("No upcoming events", "Schedules will appear as providers publish them.")}</div><div class="section-title"><h3>Sources</h3>${state.owner ? button("settings", "Manage", "ghost") : ""}</div><div class="card">${[
        "teamsnap",
        "gotsport",
        "live",
        "trace",
      ]
        .map((p) => {
          const source = status.providers.find((j) => j.provider === p),
            has = state.teams.some((t) => t.provider === p),
            label = {
              teamsnap: "TeamSnap",
              gotsport: "GotSport",
              live: "GotSport Live",
              trace: "Trace",
            }[p];
          return `<div class="list-row"><span class="grow">${label}</span>${badge(source?.error ? "Delayed" : source?.running ? "Updating" : source?.pending ? "Collecting" : source?.total ? "Saved" : has ? "Connected" : "Not connected", source?.error ? "warn" : source?.total && !source.pending ? "good" : "")}</div>`;
        })
        .join("")}</div>`;
    } else if (state.view === "schedule") {
      const dateKey = (d) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
        from = dateKey(state.month),
        to = dateKey(
          new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1),
        );
      state.fixtures = await getAllFixtures({ from, to, filter: state.filter });
      html = scheduleHTML();
    } else if (state.view === "competitions") {
      const awards = await request(
          endpoint("/api/awards", { season: state.season }),
        ),
        p = await request(
          endpoint("/api/competitions", {
            limit: 100,
            ...(state.pageCursor ? { cursor: state.pageCursor } : {}),
          }),
        );
      state.nextPage = p.cursor;
      const rows = p.items.filter(
        (c) =>
          state.season === "all" ||
          !c.starts_on ||
          (c.starts_on >=
            state.season +
              "-" +
              (state.settings.include_preseason ? "06" : "07") +
              "-01" &&
            c.starts_on < String(Number(state.season) + 1) + "-07-01"),
      );
      html = `<div class="toolbar"><h2>Competitions</h2>${button("status", icon("refresh"), "icon", 'aria-label="Sync status"')}</div>${rows.length ? rows.map((c) => `<div class="card clickable" role="button" tabindex="0" data-action="division" data-id="${esc(c.division_id)}"><div class="row between"><b>${esc(c.name)}</b>${badge(c.kind)}</div><p class="muted" style="margin:5px 0">${esc(c.division_name)}</p><small>${esc(c.starts_on || "Dates pending")} ${c.ends_on ? "– " + esc(c.ends_on) : ""} · ${esc(c.provider === "live" ? "GotSport Live" : "GotSport")}</small></div>`).join("") : empty("No saved competitions", "Connect GotSport to collect published competitions and standings.")}${p.cursor ? button("next-page", "More competitions", "ghost") : ""}${awards.awards.length ? `<h3>Awards</h3><div class="card">${awards.awards.map((a) => `<div class="list-row">${icon("competitions")}<div class="grow">${esc(a.title)}<br><small>${esc(a.season)}–${Number(a.season) + 1} · Owner recorded</small></div></div>`).join("")}</div>` : ""}`;
    } else if (state.view === "team") {
      const p = await request(
        endpoint("/api/players", {
          limit: 100,
          ...(state.pageCursor ? { cursor: state.pageCursor } : {}),
        }),
      );
      state.nextPage = p.cursor;
      state.players = p.players;
      html = `<div class="toolbar"><h2>Players <small>${p.players.length}</small></h2><div class="row">${button("export-players", icon("download"), "icon", 'aria-label="Export players"')}</div></div><div class="card" style="padding:0 10px">${p.players.length ? p.players.map((p) => `<div class="list-row clickable" role="button" tabindex="0" data-action="player" data-id="${esc(p.id)}"><div class="avatar">${esc(p.jersey || "–")}</div><div class="grow"><b>${esc(p.name)}</b><br><small>${esc(p.provider === "trace" ? "Trace" : "TeamSnap")} · ${esc(p.details.position || "Player")}</small></div>${icon("next")}</div>`).join("") : empty("No saved roster", "Connect TeamSnap or Trace to collect players.")}</div>${p.cursor ? button("next-page", "More players") : ""}<div class="section-title"><h3>Connected teams</h3></div><div class="card">${state.teams.map((t) => `<div class="list-row clickable" data-action="team" data-id="${esc(t.id)}"><span class="grow">${esc(t.name)}<br><small>${esc(t.provider)} ${esc(t.season || "")}</small></span>${icon("next")}</div>`).join("")}</div>`;
    } else if (state.view === "bookmarks") {
      const p = await request(
        endpoint("/api/favorites", {
          limit: 100,
          ...(state.pageCursor ? { cursor: state.pageCursor } : {}),
        }),
      );
      state.nextPage = p.cursor;
      html = `<div class="toolbar"><h2>Bookmarks</h2>${button("search", "Find teams", "ghost")}</div><div class="section-title"><h3>Teams</h3></div><div class="card">${p.teams.length ? p.teams.map((t) => `<div class="list-row"><div class="grow clickable" data-action="team" data-id="${esc(t.id)}"><b>${esc(t.name)}</b></div>${state.owner ? button("favorite-team", icon("star"), "icon", 'data-id="' + esc(t.id) + '" aria-label="Unfollow team"') : ""}</div>`).join("") : empty("Follow a team", "Find a GotSport team to follow its games and competitions.")}</div><div class="section-title"><h3>Saved games</h3></div><div class="card" style="padding:0">${p.fixtures.length ? p.fixtures.map(fixtureRow).join("") : empty("No bookmarked games", "Save a confirmed GotSport game from its overview.")}</div>${p.cursor ? button("next-page", "More saved games") : ""}`;
    }
    if (seq === state.requestVersion) mount(html);
  } catch (e) {
    if (seq === state.requestVersion) mount(errorCard(e));
  } finally {
    root.removeAttribute("aria-busy");
  }
}
function scheduleHTML() {
  const m = state.month,
    y = m.getFullYear(),
    mo = m.getMonth(),
    first = new Date(y, mo, 1),
    start = new Date(y, mo, 1 - first.getDay()),
    today = localDay(new Date().toISOString()),
    counts = new Set(
      state.fixtures.map((f) => localDay(f.starts_at || f.local_day)),
    ),
    dates = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
      return `<button class="${d.getMonth() !== mo ? "other " : ""}${today === key ? "today " : ""}${state.selectedDay === key ? "selected " : ""}${counts.has(key) ? "has" : ""}" data-action="day" data-day="${key}" aria-label="${esc(formatDate(key, { month: "long", day: "numeric" }))}">${d.getDate()}</button>`;
    }).join("");
  const now = Date.now(),
    fixtures = state.fixtures.filter(
      (f) =>
        (!state.selectedDay ||
          localDay(f.starts_at || f.local_day) === state.selectedDay) &&
        (state.selectedDay ||
          state.range === "all" ||
          (state.range === "past"
            ? Date.parse(f.starts_at || f.local_day) < now
            : Date.parse(f.starts_at || f.local_day) >= now)),
    );
  return `<div class="calendar-head">${button("month-prev", icon("back"), "icon", 'aria-label="Previous month"')}<h2>${esc(formatDate(new Date(y, mo, 15).toISOString(), { month: "long", year: "numeric" }))}</h2>${button("month-next", icon("next"), "icon", 'aria-label="Next month"')}</div><div class="calendar" id="calendar">${["S", "M", "T", "W", "T", "F", "S"].map((s) => `<div class="weekday">${s}</div>`).join("")}${dates}</div><div class="toolbar"><div class="chips">${[
    ["all", "All"],
    ["game", "Games"],
    ["practice", "Practices"],
  ]
    .map(([id, label]) =>
      button(
        "filter",
        label,
        state.filter === id ? "active" : "",
        'data-filter="' + id + '"',
      ),
    )
    .join(
      "",
    )}</div>${button("today", "Today", "ghost")}</div><div class="toolbar"><div class="chips">${[
    ["past", "Past"],
    ["upcoming", "Upcoming"],
    ["all", "All dates"],
  ]
    .map(([id, label]) =>
      button(
        "range",
        label,
        state.range === id ? "active" : "",
        'data-range="' + id + '"',
      ),
    )
    .join(
      "",
    )}</div><div class="row">${button("export-games", icon("download"), "icon", 'aria-label="Export games"')}</div></div><div class="card" style="padding:0">${fixtures.length ? fixtures.map(fixtureRow).join("") : empty("No events in this view", "Try All dates or another month.")}</div>${state.season !== "all" && mo === 5 ? button("next-season", "Next season", "primary") : ""}`;
}
async function showFixture(id, replace = false) {
  const p = await request(endpoint("/api/fixture", { id })),
    f = p.fixture;
  state.detail = p;
  let h2h = { games: [] };
  if (f.home_id && f.away_id)
    h2h = await request(endpoint("/api/head-to-head", { id }));
  const actions =
    state.owner && ["live", "gotsport"].includes(f.provider) && !f.conditional
      ? button(
          "favorite-fixture",
          icon("bookmarks"),
          "icon" + (p.saved ? " active" : ""),
          'data-id="' +
            esc(id) +
            '" aria-label="' +
            (p.saved ? "Remove bookmark" : "Save game") +
            '"',
        )
      : "";
  const teams = `<div class="split-score"><div class="team-name" data-action="team" data-id="${esc(f.home_id || "")}">${esc(f.home_name)}</div><div class="score">${f.home_score ?? "–"} : ${f.away_score ?? "–"}</div><div class="team-name" data-action="team" data-id="${esc(f.away_id || "")}">${esc(f.away_name)}</div></div>`;
  const attendance = p.attendance.length
    ? `<details open><summary>Attendance</summary><div class="chips">${[
        ["1", "Yes"],
        ["0", "No"],
        ["2", "Maybe"],
        ["", "NR"],
      ]
        .map(([code, label]) =>
          badge(
            label +
              ": " +
              p.attendance.filter((x) =>
                !["0", "1", "2"].includes(x.status)
                  ? code === ""
                  : x.status === code,
              ).length,
          ),
        )
        .join(
          "",
        )}</div>${p.attendance.map((x) => `<div class="list-row"><span class="grow">${esc(x.name)}</span>${badge({ 1: "Yes", 0: "No", 2: "Maybe" }[x.status] || "NR", x.status === "1" ? "good" : x.status === "0" ? "bad" : "")}</div>`).join("")}</details>`
    : "";
  const analytics = p.analytics ? statsHTML(p.analytics, id) : "";
  (replace ? replaceSheet : showSheet)(
    f.type === "game" ? "Game overview" : f.title || "Event",
    `${teams}<div class="card"><div class="row wrap">${badge(f.status)}${badge(f.provider === "live" ? "GotSport Live" : f.provider)}${f.conditional ? badge("Conditional slot", "warn") : ""}</div><p>${esc(formatDate(f.starts_at || f.local_day, { weekday: "long", month: "short", day: "numeric", year: "numeric" }))} · ${f.time_pending ? "Time TBD" : esc(formatDate(f.starts_at, { hour: "numeric", minute: "2-digit" }))}</p>${f.venue ? `<b>${esc(f.venue)} ${esc(f.field || "")}</b><br>` : ""}${f.address ? `<small>${esc(f.address)}</small>` : ""}${f.arrival_at || f.arrival_minutes ? `<p><small>Arrival ${f.arrival_at ? esc(formatDate(f.arrival_at, { hour: "numeric", minute: "2-digit" })) : esc(f.arrival_minutes) + " min early"}</small></p>` : ""}${f.uniform ? `<p><small>Uniform: ${esc(f.uniform)}</small></p>` : ""}${f.notes ? `<p>${esc(f.notes)}</p>` : ""}${f.source_url ? `<a href="${esc(f.source_url)}" target="_blank" rel="noopener">Official source ↗</a>` : ""}</div>${p.conflicts.length ? '<div class="alert">Source data conflicts with a saved game. Both observations are available in the evidence export.</div>' : ""}${p.conflicts.length && state.owner ? p.conflicts.map((c) => `<details><summary>Review source conflict</summary><p><small>Saved: ${esc(c.previous.home_id)} vs ${esc(c.previous.away_id)} · ${c.previous.home_score ?? "–"}:${c.previous.away_score ?? "–"}<br>Incoming: ${esc(c.incoming.home_id)} vs ${esc(c.incoming.away_id)} · ${c.incoming.home_score ?? "–"}:${c.incoming.away_score ?? "–"}</small></p><div class="row wrap">${button("conflict-accept", "Accept source", "", `data-id="${esc(c.id)}"`)}${button("conflict-keep", "Keep saved", "", `data-id="${esc(c.id)}"`)}</div></details>`).join("") : ""}${attendance}${h2h.games.length ? `<details><summary>Head to head · ${h2h.games.length} saved games</summary>${h2h.games.map(fixtureRow).join("")}</details>` : ""}${analytics}<div class="row wrap no-print">${state.owner && !f.conditional && f.type === "game" ? button("coach", "Coach", "primary", 'data-id="' + esc(id) + '"') : ""}${state.owner ? button("match-correction", "Edit match", "", `data-id="${esc(id)}"`) : ""}${state.owner && f.provider !== "trace" && f.type === "game" ? button("fixture-links", "Match Trace game", "", `data-id="${esc(id)}"`) : ""}${state.owner ? button("evidence", "Evidence", "", `data-id="${esc(id)}"`) : ""}${button("print", "PDF")}</div>`,
    "fixture",
    { id },
    actions,
  );
}
function statsHTML(a, id) {
  const c = a.constraints || {},
    rows = a.players || [];
  return `<div class="section-title"><h3>Trace analysis</h3>${badge(a.state, a.state === "partial" ? "warn" : "good")}</div>${a.warnings?.length ? `<div class="alert">${a.warnings.map(esc).join("<br>")}</div>` : ""}${c.target_minutes != null ? `<small>${c.format}v${c.format} · ${c.assigned_minutes}/${c.target_minutes} player minutes · ${c.unresolved_minutes} unresolved</small>` : ""}<div class="table-scroll"><table data-sortable><thead><tr>${["Player", "Min", "GK", "G", "A"].map((s, i) => `<th><button data-action="sort" data-col="${i}">${s}</button></th>`).join("")}</tr></thead><tbody>${rows.map((p) => `<tr><td><a href="#" data-action="stats-player" data-id="${esc(p.id)}" data-fixture="${esc(id)}">${esc(p.name)}</a></td><td>${p.minutes}</td><td>${p.gk_minutes}</td><td>${p.goals}</td><td>${p.assists}</td></tr>`).join("")}</tbody></table></div>${a.events?.length ? `<details><summary>Goals & assists</summary>${a.events.map((e) => `<div class="list-row"><span class="grow">${esc(e.kind)} · ${esc(rows.find((p) => p.id === e.player_id)?.name || "Unresolved")}</span><small>H${e.half} · ${esc(e.confidence)}</small></div>`).join("")}</details>` : ""}<div class="row wrap no-print" style="margin:12px 0">${button("export-match", "Excel", "", `data-id="${esc(id)}"`)}${button("print", "PDF")}${state.owner ? button("identity-editor", "Player identities", "", `data-id="${esc(id)}"`) : ""}</div>`;
}
async function showPlayer(id, replace = false) {
  const p = await request(
      endpoint("/api/player", {
        id,
        ...(state.season !== "all" ? { season: state.season } : {}),
      }),
    ),
    r = p.player;
  state.playerDetail = p;
  const rows = p.stats;
  (replace ? replaceSheet : showSheet)(
    r.name,
    `<div class="row"><div class="avatar">${esc(r.jersey || "–")}</div><b>${esc(r.name)}</b>${badge(r.provider)}</div><p class="muted">${esc(r.details.position || "Player")}</p>${rows.length ? `<h3>Saved game analytics</h3><div id="player-games">${rows.map((s) => `<div class="list-row clickable" data-action="stats-player" data-id="${esc(s.player_id)}" data-fixture="${esc(s.fixture_id)}"><div class="grow">${esc(s.payload.home_name)} vs ${esc(s.payload.away_name)}<br><small>${esc(formatDate(s.starts_at || s.local_day, { month: "short", day: "numeric" }))}</small></div>${badge(s.state)}</div>`).join("")}</div>${p.cursor ? button("player-more", "More saved games", "", `data-id="${esc(id)}" data-cursor="${esc(p.cursor)}"`) : ""}` : empty("No saved game statistics", "Trace statistics will appear as collection completes.")}<div class="row wrap">${state.owner ? button("coach-profile", "Coach attributes", "", `data-id="${esc(id)}"`) : ""}${state.owner ? button("player-correction", "Edit statistics", "", `data-id="${esc(id)}"`) : ""}${state.owner && r.provider === "teamsnap" ? button("player-links", "Match Trace player", "", `data-id="${esc(id)}"`) : ""}${button("print", "PDF")}</div>`,
    "player",
    { id },
  );
}
async function statsPlayer(id, fixture, replace = false) {
  const p = await request(endpoint("/api/fixture", { id: fixture })),
    a = p.analytics;
  if (!a) throw new Error("No Trace analysis is available.");
  const player = a.players.find((p) => p.id === id),
    scopes = a.scopes.filter((s) => s.player_id === id);
  state.statPlayer = { p, player, id, fixture };
  (replace ? replaceSheet : showSheet)(
    player?.name || "Player statistics",
    `${player ? `<div class="grid"><div class="stat"><b>${player.minutes}</b><small>Estimated minutes</small></div><div class="stat"><b>${player.goals} / ${player.assists}</b><small>Goals / assists</small></div></div>` : ""}${scopes
      .map(
        (s) =>
          `<div class="section-title"><h3>${s.period === "full" ? "Full game" : "Half " + esc(s.period)}</h3>${badge(s.state)}</div>${s.value.heatmap?.length ? `<canvas class="heatmap" data-heat="${esc(JSON.stringify(s.value.heatmap))}" width="600" height="360" aria-label="Player heat map"></canvas>` : ""}<div class="grid">${Object.entries(
            s.value.stats || {},
          )
            .filter(([, v]) => typeof v === "number")
            .map(
              ([k, v]) =>
                `<div class="stat"><b>${Math.round(v * 10) / 10}</b><small>${esc(k.replaceAll("_", " "))}</small></div>`,
            )
            .join(
              "",
            )}</div><details><summary>Published statistics</summary>${nativeStatsTable(s.value.stats)}</details>`,
      )
      .join(
        "",
      )}${state.owner ? button("player-correction", "Correct match statistics", "", `data-id="${esc(id)}" data-fixture="${esc(fixture)}"`) : ""}`,
    "stats-player",
    { id, fixture },
  );
}
function nativeStatsTable(v) {
  const rows = [];
  function walk(o, path = "") {
    for (const [k, x] of Object.entries(o || {})) {
      if (typeof x === "number" || typeof x === "string")
        rows.push([path + k, x]);
      else if (x && typeof x === "object" && !Array.isArray(x))
        walk(x, path + k + " · ");
    }
  }
  walk(v);
  return `<table><tbody>${rows.map(([k, x]) => `<tr><td>${esc(k.replaceAll("_", " "))}</td><td>${esc(x)}</td></tr>`).join("")}</tbody></table>`;
}
function drawHeatmaps() {
  for (const c of document.querySelectorAll("canvas[data-heat]")) {
    const map = JSON.parse(c.dataset.heat),
      ctx = c.getContext("2d"),
      max = Math.max(...map.flat(), 1),
      w = c.width / map[0].length,
      h = c.height / map.length;
    ctx.fillStyle = "#174b2d";
    ctx.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < map.length; y++)
      for (let x = 0; x < map[y].length; x++) {
        const alpha = Math.sqrt(map[y][x] / max);
        if (alpha) {
          ctx.fillStyle = `rgba(255,185,55,${alpha * 0.8})`;
          ctx.fillRect(x * w, y * h, w + 1, h + 1);
        }
      }
    ctx.strokeStyle = "#d4e9d999";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
    ctx.beginPath();
    ctx.moveTo(c.width / 2, 0);
    ctx.lineTo(c.width / 2, c.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.width / 2, c.height / 2, 45, 0, Math.PI * 2);
    ctx.stroke();
  }
}
async function showDivision(id) {
  const p = await request(endpoint("/api/division", { id }));
  state.divisionDetail = p;
  const pools = [...new Set(p.standings.map((s) => s.pool_id))];
  showSheet(
    p.division.competition_name,
    `<p class="muted">${esc(p.division.name)}</p><div class="chips">${badge(p.division.kind)}${p.jobs.map((j) => badge(j.kind + ": " + (j.last_error ? "Delayed" : j.coverage), j.last_error ? "warn" : "")).join("")}</div>${p.division.competition_details.website ? `<p><a href="${esc(p.division.competition_details.website)}" target="_blank" rel="noopener">Competition website ↗</a></p>` : ""}<details><summary>Award assessment</summary><small>${esc(p.awards.reason)}</small>${p.awards.awards.map((a) => `<p>${icon("competitions")} ${esc(a.title)} · ${esc(a.date)}</p>`).join("")}</details><details open><summary>Standings</summary>${
      pools.length
        ? pools
            .map(
              (pool) =>
                `<h3>${esc(p.division.details.pools?.find((x) => x.id === pool)?.name || "Pool " + pool)}</h3><div class="table-scroll"><table data-sortable><thead><tr>${["#", "Team", "MP", "W", "D", "L", "GF", "GA", "GD", "Pts"].map((s, i) => `<th><button data-action="sort" data-col="${i}">${s}</button></th>`).join("")}</tr></thead><tbody>${p.standings
                  .filter((s) => s.pool_id === pool)
                  .map(
                    (s) =>
                      `<tr><td>${s.rank ?? "–"}</td><td><a href="#" data-action="team" data-id="${esc(s.team_id)}">${esc(s.payload.name)}</a></td>${["mp", "w", "d", "l", "gf", "ga", "gd", "pts"].map((k) => `<td class="num">${s.payload[k] ?? "–"}</td>`).join("")}</tr>`,
                  )
                  .join("")}</tbody></table></div>`,
            )
            .join("")
        : '<p class="muted">No published standings saved yet.</p>'
    }</details><h3>Category games</h3><div id="division-games">${p.fixtures.map(fixtureRow).join("")}</div>${p.more ? button("division-more", "More games", "", `data-id="${esc(id)}"`) : ""}<div class="row wrap">${button("export-division", "Excel")}${button("print", "PDF")}</div>`,
    "division",
    { id },
  );
}
async function showTeam(id) {
  if (!id || id.startsWith("registration:")) return;
  const p = await request(endpoint("/api/team", { id })),
    games = await request(endpoint("/api/fixtures", { team: id, limit: 30 }));
  state.browseTeam = { p, games };
  showSheet(
    p.team.name,
    `<div class="row between"><span class="row">${teamLogo(p.team)}${badge(p.team.provider)} ${esc(p.team.season || "")}</span>${state.owner && p.team.provider === "gotsport" ? button("favorite-team", icon("star"), "icon", `data-id="${esc(id)}" aria-label="Follow or unfollow team"`) : ""}</div><p class="muted">${esc(p.team.details.club_name || "")}</p>${kitsHTML(p.team, state.season === "all" ? String(new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0)) : state.season)}<div class="grid"><div class="stat"><b>${p.totals.fixtures}</b><small>Saved games</small></div><div class="stat"><b>${p.totals.finals || 0}</b><small>Completed</small></div></div><div class="section-title"><h3>Competitions</h3></div>${p.divisions.map((d) => `<div class="list-row clickable" data-action="division" data-id="${esc(d.id)}"><span class="grow">${esc(d.competition_name)}<br><small>${esc(d.name)}</small></span>${icon("next")}</div>`).join("") || '<p class="muted">No saved competition memberships.</p>'}<div class="section-title"><h3>Games</h3></div><div id="team-games">${games.items.map(fixtureRow).join("") || empty("No saved games", state.favorites.has(id) ? "Collection is running in the background." : "Follow this team to collect its games.")}</div>${games.cursor ? button("team-more", "More games", "", `data-id="${esc(id)}" data-cursor="${esc(games.cursor)}"`) : ""}`,
    "team",
    { id },
  );
}
async function settings() {
  let connections = { connections: [], teams: [] };
  if (state.owner && state.space)
    connections = await request(endpoint("/api/admin/connections"));
  showSheet(
    "Settings",
    `<div class="card"><div class="row between"><b>Appearance</b><select id="theme" style="width:130px"><option value="">System</option><option value="dark">Dark</option><option value="light">Light</option><option value="green">Soccer Green</option></select></div><small>myTS ${VERSION}</small></div>${
      state.owner
        ? `<form data-form="settings" class="card">${field("timezone", "Time zone", state.settings.timezone)}${field("client_id", "TeamSnap Client ID", state.settings.client_id || "")}<label class="row"><input type="checkbox" name="include_preseason" ${state.settings.include_preseason ? "checked" : ""}>Include preseason</label><div class="actions"><button class="primary">Save settings</button></div></form><div class="card"><h3>Accounts & teams</h3><div class="row wrap">${button("teamsnap-oauth", "Connect TeamSnap", "primary")}${button("trace-auth", "Sign in to Trace")}</div>${connections.connections
            .filter((c) => c.active)
            .map(
              (c) =>
                `<div class="connection row"><span class="grow">${esc(c.provider)} ${esc(c.native_id || "")}</span>${button("disconnect", "Disconnect", "danger", `data-id="${esc(c.id)}"`)}</div>`,
            )
            .join(
              "",
            )}<form data-form="space" style="margin-top:16px">${field("name", "Create a team")}<button>Create team</button></form></div>${
            state.space
              ? `<div class="card"><h3>This team</h3><form data-form="gotsport">${field("team_id", "GotSport team ID", "", "text", 'inputmode="numeric" required')}<button class="primary">Connect GotSport</button></form>${connections.teams
                  .filter((t) => t.provider === "gotsport")
                  .map(
                    (t) =>
                      `<div class="connection row"><span class="grow">${esc(t.name)}</span>${button("gotsport-disconnect", "Disconnect", "danger", `data-id="${esc(t.id)}"`)}</div>`,
                  )
                  .join(
                    "",
                  )}<div class="row wrap" style="margin-top:12px">${button("trace-select", "Connect Trace team")}${button("branding", "Club logo & kits")}${button("share", "Viewer link")}${button("season-editor", "Season positions & awards")}${button("status", "Sync status")}</div></div>`
              : ""
          }<div class="row wrap">${button("logout", "Sign out", "danger")}</div>`
        : ""
    }`,
    "settings",
  );
  $("#theme").value = localStorage.getItem("myts7_theme") || "";
}
function search() {
  showSheet(
    "Find a GotSport team",
    `<form data-form="search"><div class="cols">${field("q", "Team or club", "", "search")}${field("state", "State code", "NV", "text", 'maxlength="3"')}</div><div class="cols">${field("age", "Age group", 10, "number", 'min="7" max="19"')}<div class="field"><label>Team</label><select name="gender"><option value="m">Boys</option><option value="f">Girls</option></select></div></div><button class="primary">Search</button></form><div id="search-results"></div>`,
    "search",
  );
}
async function status() {
  let p = await request(endpoint("/api/status", { limit: 100 }));
  let cursor = p.cursor;
  while (cursor) {
    const next = await request(endpoint("/api/status", { limit: 100, cursor }));
    p.jobs.push(...next.jobs);
    cursor = next.cursor;
    if (p.jobs.length >= 3000 && cursor) break;
  }
  state.status = p;
  showSheet(
    "Sync status",
    `<div class="grid"><div class="stat"><b>${p.summary.ready}</b><small>Complete components</small></div><div class="stat"><b>${p.summary.error}</b><small>Delayed components</small></div></div><div class="row wrap" style="margin-top:12px">${state.owner ? button("retry", "Retry due work", "primary") : ""}${state.owner ? button("diagnostics", "Download diagnostics") : ""}</div><p><small>Each source updates independently. Saved pages remain visible while the scan continues.</small></p>${p.jobs.length < p.summary.total ? `<p><small>Showing ${p.jobs.length} of ${p.summary.total} components. Totals include every component.</small></p>` : ""}${p.jobs.map((j) => `<details><summary><span>${esc(j.provider)} · ${esc(j.kind)}</span> ${badge(j.state, j.last_error ? "warn" : j.last_complete ? "good" : "")}<br><small>${esc(j.scope)}</small></summary>${j.last_error ? `<div class="alert error">${esc(j.last_error.message)}</div>` : ""}<small>Attempt: ${esc(j.last_attempt || "Not attempted")}<br>Retrieved: ${esc(j.last_retrieved || "Not retrieved")}<br>Saved: ${esc(j.last_saved || "Not saved")}<br>Complete: ${esc(j.last_complete || "Not complete")}<br>Coverage: ${esc(j.coverage)} · ${j.pages} pages · ${j.rows_saved} records</small>${state.owner ? `<div style="margin-top:8px">${button("retry-job", "Retry", "", `data-id="${esc(j.id)}"`)}</div>` : ""}</details>`).join("")}`,
    "status",
  );
}
const pitchPositions = {
  GK: [50, 88],
  LB: [20, 70],
  CB: [50, 72],
  RB: [80, 70],
  LWB: [12, 57],
  RWB: [88, 57],
  LM: [20, 43],
  CM: [50, 47],
  RM: [80, 43],
  CDM: [50, 58],
  CAM: [50, 34],
  LW: [18, 21],
  RW: [82, 21],
  ST: [50, 15],
  CF: [50, 23],
};
async function coach(id) {
  const p = await request(endpoint("/api/admin/coach", { id }));
  state.coach = p.session;
  state.coachFixture = id;
  state.coachRoster = p.roster;
  state.coachSelected = null;
  showSheet(
    "Coach",
    p.session
      ? ""
      : `<form data-form="coach-create"><div class="cols"><div class="field"><label>Format</label><select name="format"><option value="9">9v9</option><option value="7">7v7</option></select></div>${field("half_minutes", "Minutes per half", 25, "number", 'min="5" max="60" required')}</div><p class="muted">Confirm attendance and the starting lineup before kickoff.</p><button class="primary">Create match plan</button></form>`,
    "coach",
    { id },
  );
}
function coachTime(s) {
  return (
    s.elapsed_ms +
    (s.phase === "running"
      ? Math.max(0, Date.now() - Date.parse(s.running_since))
      : 0)
  );
}
const clock = (v) =>
  `${String(Math.floor(v / 60000)).padStart(2, "0")}:${String(Math.floor(v / 1000) % 60).padStart(2, "0")}`;
function renderCoach() {
  if (!state.coach) return;
  const s = state.coach.value,
    roster = new Map(s.roster.map((p) => [p.id, p])),
    positions =
      s.format === 7
        ? ["GK", "LB", "RB", "LM", "CM", "RM", "ST"]
        : ["GK", "LB", "CB", "RB", "LM", "CM", "RM", "LW", "ST"],
    bench = s.roster.filter(
      (p) => s.active.includes(p.id) && !Object.values(s.field).includes(p.id),
    );
  $("#sheet-body").innerHTML =
    `<div class="row between"><div><div id="coach-clock" class="clock">${clock(coachTime(s))}</div><small>Half ${s.period} · ${s.format}v${s.format} · ${esc(s.phase)}</small></div><div class="row wrap">${s.phase === "running" ? button("coach-action", icon("pause"), "icon", 'data-type="pause" aria-label="Pause"') : ["setup", "paused", "halftime"].includes(s.phase) ? button("coach-action", icon("play"), "icon", 'data-type="' + (s.phase === "setup" ? "start" : "resume") + '" aria-label="Start or resume"') : ""}${s.period === 1 && ["running", "paused"].includes(s.phase) ? button("coach-action", "Halftime", "", 'data-type="halftime"') : ""}${["running", "paused", "halftime"].includes(s.phase) ? button("coach-action", "End", "", 'data-type="end"') : ""}</div></div><div class="pitch" id="coach-pitch">${positions
      .map((pos) => {
        const p = roster.get(s.field[pos]),
          xy = pitchPositions[pos];
        return `<button class="position ${state.coachSelected === p?.id ? "chosen" : ""}" style="left:${xy[0]}%;top:${xy[1]}%" data-action="coach-position" data-position="${pos}" data-id="${esc(p?.id || "")}"><b>${esc(p?.jersey || pos)}</b><span>${esc(p?.name?.split(" ")[0] || "Place")}</span></button>`;
      })
      .join(
        "",
      )}</div><small>Tap a player, then a position or bench player. Drag players to move them.</small><h3>Bench</h3><div class="bench">${bench.map((p) => button("coach-bench", (p.jersey ? "#" + esc(p.jersey) + " " : "") + esc(p.name), state.coachSelected === p.id ? "chosen" : "", `data-id="${esc(p.id)}" draggable="true"`)).join("") || "<small>No available bench players.</small>"}</div><div class="row wrap" style="margin-top:12px">${["setup", "paused", "halftime"].includes(s.phase) ? button("coach-suggest", "Suggest lineup") : ""}${button("coach-reload", "Reload")}</div>${s.clock_review ? '<div class="alert">A long clock interruption needs review. Correct the clock and player minutes before resuming.</div>' : ""}<details><summary>Attendance override</summary><form data-form="coach-availability" class="checks">${s.roster.map((p) => `<label><input type="checkbox" name="players" value="${esc(p.id)}" ${s.active.includes(p.id) ? "checked" : ""}>${esc(p.name)}</label>`).join("")}<button>Save availability</button></form></details><details><summary>Recorded minutes</summary><table><tbody>${s.roster.map((p) => `<tr><td>${esc(p.name)}</td><td>${Math.round(((s.minutes_ms[p.id] || 0) + (s.phase === "running" && Object.values(s.field).includes(p.id) ? coachTime(s) - s.elapsed_ms : 0)) / 6000) / 10}</td></tr>`).join("")}</tbody></table></details>${["paused", "finished"].includes(s.phase) ? `<details><summary>Corrections</summary><form data-form="coach-correct">${field("elapsed", "Clock minutes", Math.round(s.elapsed_ms / 6000) / 10, "number", 'min="0" max="720" step="0.1"')}<div class="cols">${s.roster.map((p) => field("minutes:" + p.id, p.name, Math.round((s.minutes_ms[p.id] || 0) / 6000) / 10, "number", 'min="0" max="180" step="0.1"')).join("")}</div><button>Save correction</button></form><details><summary>Late substitution</summary><form data-form="coach-late"><div class="cols"><div class="field"><label>Outgoing</label><select name="out">${s.roster.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></div><div class="field"><label>Incoming</label><select name="in">${s.roster.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></div>${field("at_minutes", "Match minute", 0, "number", 'min="0" step="0.1"')}${field("duration", "Minutes to transfer", 0, "number", 'min="0" step="0.1"')}</div><button>Save late substitution</button></form></details></details>` : ""}<details><summary>Match timeline · ${s.history.length}</summary><div class="timeline">${[
      ...s.history,
    ]
      .reverse()
      .map(
        (h) =>
          `<div class="list-row"><b>${clock(h.elapsed_ms)}</b><span>${esc(h.type)}${h.out ? " · " + esc(roster.get(h.out)?.name) + " → " + esc(roster.get(h.in)?.name) : ""}</span></div>`,
      )
      .join("")}</div></details>`;
}
async function coachAction(action) {
  if (state.coachPending) return;
  state.coachPending = true;
  try {
    const p = await request(endpoint("/api/admin/coach"), {
      method: "POST",
      body: {
        fixture_id: state.coachFixture,
        revision: state.coach?.revision || 0,
        action,
      },
    });
    if (p.session) {
      state.coach = p.session;
      state.coachSelected = null;
      renderCoach();
    }
    return p;
  } catch (e) {
    if (e.status === 409 && e.code === "revision_conflict") {
      const p = await request(
        endpoint("/api/admin/coach", { id: state.coachFixture }),
      );
      state.coach = p.session;
      renderCoach();
    }
    throw e;
  } finally {
    state.coachPending = false;
  }
}
async function editCoachProfile(id) {
  const season =
      state.season === "all" ? String(new Date().getFullYear()) : state.season,
    p = await request(endpoint("/api/admin/coach/profiles", { season })),
    rows = p.profiles
      .filter((p) => p.player_id === id)
      .sort((a, b) => a.season.localeCompare(b.season)),
    current = rows.find((p) => p.season === season),
    value = (current || rows.at(-1))?.value || {},
    positions = Object.entries(value.positions || {});
  state.profileEdit = { id, season, revision: current?.revision || 0 };
  showSheet(
    "Coach attributes",
    `<form data-form="coach-profile"><p class="muted">Season ${season}</p>${[
      0, 1, 2,
    ]
      .map(
        (i) =>
          `<div class="cols"><div class="field"><label>Position ${i + 1}</label><select name="position${i}"><option value="">None</option>${Object.keys(
            pitchPositions,
          )
            .map(
              (pos) =>
                `<option ${positions[i]?.[0] === pos ? "selected" : ""}>${pos}</option>`,
            )
            .join(
              "",
            )}</select></div>${field("rating" + i, "Strength (1–5)", positions[i]?.[1] || 3, "number", 'min="1" max="5"')}</div>`,
      )
      .join(
        "",
      )}<div class="cols">${field("endurance", "Endurance (1–5)", value.endurance ?? "", "number", 'min="1" max="5"')}${field("target_minutes", "Target minutes", value.target_minutes ?? "", "number", 'min="0" max="180"')}</div><button class="primary">Save attributes</button></form>`,
    "coach-profile",
    { id },
  );
}
async function matchCorrection(id) {
  const p =
      state.detail?.fixture?.id === id
        ? state.detail
        : await request(endpoint("/api/fixture", { id })),
    c = p.corrections[0],
    value = c?.value || {};
  state.correctionEdit = {
    kind: "match",
    entity_id: id,
    revision: c?.revision || 0,
    season: c?.season || "",
    value,
  };
  showSheet(
    "Match correction",
    `<form data-form="match-correction"><div class="field"><label>Playing format</label><select name="format"><option value="">Source evidence</option><option value="7" ${value.format === 7 ? "selected" : ""}>7v7</option><option value="9" ${value.format === 9 ? "selected" : ""}>9v9</option></select></div><div class="field"><label>Note</label><textarea name="note">${esc(value.note || "")}</textarea></div>${
      p.analytics
        ? `<h3>Positions by half</h3><p><small>Match corrections take priority over heat maps and season positions.</small></p><div class="table-scroll"><table><thead><tr><th>Player</th><th>H1</th><th>H2</th></tr></thead><tbody>${p.analytics.players
            .map(
              (pl) =>
                `<tr><td>${esc(pl.name)}</td>${[1, 2]
                  .map(
                    (h) =>
                      `<td><select name="pos:${h}:${esc(pl.id)}" aria-label="${esc(pl.name)} half ${h}"><option value="">Source</option>${Object.keys(
                        pitchPositions,
                      )
                        .map(
                          (pos) =>
                            `<option value="${pos}" ${value.lineup?.[h]?.[pl.id] === pos ? "selected" : ""}>${pos}</option>`,
                        )
                        .join("")}</select></td>`,
                  )
                  .join("")}</tr>`,
            )
            .join(
              "",
            )}</tbody></table></div>${p.analytics.events.length ? `<h3>Goal & assist attribution</h3>${p.analytics.events.map((e) => `<div class="field"><label>${esc(e.kind)} · H${e.half} · ${esc(e.time ?? "")}</label><select name="event:${esc(e.id)}"><option value="">Source / unresolved</option>${p.analytics.players.map((pl) => `<option value="${esc(pl.id)}" ${value.events?.[String(e.id)]?.player_id === pl.id ? "selected" : ""}>${esc(pl.name)}</option>`).join("")}</select></div>`).join("")}` : ""}`
        : ""
    }<div class="actions"><button class="primary">Save correction</button>${c ? button("correction-reset", "Reset", "danger") : ""}</div></form>`,
    "match-correction",
    { id },
  );
}
async function playerCorrection(id, fixture) {
  let c = null,
    value = {};
  if (fixture) {
    const p = await request(endpoint("/api/player", { id }));
    c = p.corrections.find((c) => c.kind === "player" && c.season === fixture);
    value = c?.value || {};
  } else {
    const p =
      state.playerDetail?.player?.id === id
        ? state.playerDetail
        : await request(endpoint("/api/player", { id }));
    c = p.corrections.find((c) => c.kind === "player" && c.season === "");
    value = c?.value || {};
  }
  state.correctionEdit = {
    kind: "player",
    entity_id: id,
    season: fixture || "",
    revision: c?.revision || 0,
    value,
  };
  showSheet(
    "Player correction",
    `<form data-form="player-correction"><p class="muted">${fixture ? "This game" : "General player correction"}</p><div class="cols">${[
      ["minutes", "Minutes"],
      ["field_minutes", "Field minutes"],
      ["gk_minutes", "Goalkeeper minutes"],
      ["goals", "Goals"],
      ["assists", "Assists"],
    ]
      .map(([k, label]) =>
        field(k, label, value[k] ?? "", "number", 'min="0" step="0.1"'),
      )
      .join(
        "",
      )}</div><div class="actions"><button class="primary">Save correction</button>${c ? button("correction-reset", "Reset", "danger") : ""}</div></form>`,
    "player-correction",
    { id, fixture },
  );
}
async function identityEditor(id, replace = false) {
  const p = await request(endpoint("/api/fixture", { id })),
    fixture = p.fixture.trace_fixture_id || id,
    roster = p.analytics?.parts.find((p) => p.part === "roster")?.value || [],
    players = [
      ...new Map(
        [
          ...(await allPlayers()).filter((p) => p.provider === "trace"),
          ...(p.analytics?.players || []),
        ].map((p) => [p.id, p]),
      ).values(),
    ],
    corrections = (
      await request(
        endpoint("/api/admin/corrections", {
          kind: "identity",
          season: fixture,
        }),
      )
    ).corrections;
  state.identityEdit = { source: id, fixture, roster, players, corrections };
  (replace ? replaceSheet : showSheet)(
    "Player identities",
    `<p class="muted">Assign an unresolved source track only when you can verify the player. Choose Keep source identity to remove a correction.</p>${roster
      .map((r) => {
        const c = corrections.find((c) => c.entity_id === r.gid);
        return `<form data-form="identity" class="card" data-gid="${esc(r.gid)}"><b>${esc(r.name)} <small>${esc(r.gid)}</small></b><div class="field"><label>Verified player</label><select name="player"><option value="">Keep source identity</option>${players.map((p) => `<option value="${esc(p.id)}" ${c?.value.user_id === p.id.slice(6) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div><button>Save identity</button></form>`;
      })
      .join("")}`,
    "identity",
    { id },
  );
}
async function searchPage() {
  const p = await request(
    endpoint("/api/search", { ...state.searchQuery, page: state.searchPage }),
  );
  $("#search-results").innerHTML =
    `<p><small>${p.total} ranked results · page ${p.page}/${p.pages || 1}</small></p>${[...new Map([...p.teams, ...p.indexed].map((t) => [t.id, t])).values()].map((t) => `<div class="list-row"><div class="grow clickable" data-action="team" data-id="${esc(t.id)}">${esc(t.name)}</div>${state.owner ? button("favorite-team", icon("star"), "icon", `data-id="${esc(t.id)}" aria-label="Follow team"`) : ""}</div>`).join("") || empty("No results", "Try another name, age group, or state.")}${p.page < p.pages ? button("search-more", "Next search page") : ""}`;
}
async function allPlayers() {
  const rows = [];
  let cursor = null;
  do {
    const p = await request(
      endpoint("/api/players", { limit: 100, ...(cursor ? { cursor } : {}) }),
    );
    rows.push(...p.players);
    cursor = p.cursor;
  } while (cursor);
  return rows;
}
async function fixtureLinks(id) {
  const p = await request(endpoint("/api/fixture", { id })),
    day = localDay(p.fixture.starts_at || p.fixture.local_day),
    d = new Date(day + "T12:00:00Z"),
    before = new Date(+d - 14 * 86400000).toISOString().slice(0, 10),
    after = new Date(+d + 15 * 86400000).toISOString().slice(0, 10),
    games = await getAllFixtures({ from: before, to: after }),
    c = (
      await request(
        endpoint("/api/admin/corrections", {
          kind: "fixture_link",
          entity_id: id,
        }),
      )
    ).corrections[0];
  state.correctionEdit = {
    kind: "fixture_link",
    entity_id: id,
    season: "",
    revision: c?.revision || 0,
  };
  showSheet(
    "Match Trace game",
    `<p><small>Verify the opponent and date. This links statistics to this schedule entry without changing either source record.</small></p><form data-form="source-link"><div class="field"><label>Trace game</label><select name="target"><option value="">Choose game</option>${[...games.filter((g) => g.provider === "trace"), ...(p.fixture.trace_fixture_id ? [{ id: p.fixture.trace_fixture_id, home_name: "Currently linked", away_name: "Trace game", starts_at: p.fixture.starts_at }] : [])].map((g) => `<option value="${esc(g.id)}" ${c?.value.trace_fixture_id === g.id ? "selected" : ""}>${esc(g.home_name)} vs ${esc(g.away_name)} · ${esc(localDay(g.starts_at || g.local_day))}</option>`).join("")}</select></div>${field("manual_target", "Or enter a Trace game ID", "", "text", 'placeholder="trace:12345"')}<div class="actions"><button class="primary">Save match</button>${c ? button("correction-reset", "Unlink", "danger") : ""}</div></form>`,
    "fixture-links",
    { id },
  );
}
async function playerLinks(id) {
  const players = await allPlayers(),
    c = (
      await request(
        endpoint("/api/admin/corrections", {
          kind: "player_link",
          entity_id: id,
        }),
      )
    ).corrections[0];
  state.correctionEdit = {
    kind: "player_link",
    entity_id: id,
    season: "",
    revision: c?.revision || 0,
  };
  showSheet(
    "Match Trace player",
    `<p><small>Link only a verified roster identity. Matching names alone does not establish identity.</small></p><form data-form="source-link"><div class="field"><label>Trace player</label><select name="target" required><option value="">Choose player</option>${players
      .filter((p) => p.provider === "trace")
      .map(
        (p) =>
          `<option value="${esc(p.id)}" ${c?.value.trace_player_id === p.id ? "selected" : ""}>${esc(p.name)} · #${esc(p.jersey)}</option>`,
      )
      .join(
        "",
      )}</select></div><div class="actions"><button class="primary">Save match</button>${c ? button("correction-reset", "Unlink", "danger") : ""}</div></form>`,
    "player-links",
    { id },
  );
}
async function seasonEditor() {
  const y =
      state.season === "all"
        ? String(new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0))
        : state.season,
    c = (
      await request(
        endpoint("/api/admin/corrections", {
          kind: "season",
          entity_id: state.space,
          season: y,
        }),
      )
    ).corrections[0],
    players = (await allPlayers()).filter((p) => p.provider === "trace"),
    value = c?.value || {};
  state.correctionEdit = {
    kind: "season",
    entity_id: state.space,
    season: y,
    revision: c?.revision || 0,
    value,
  };
  showSheet(
    "Season positions & awards",
    `<form data-form="season"><p class="muted">${y}–${Number(y) + 1}</p><h3>Default positions</h3><small>Used when match corrections and heat-map evidence do not resolve a position.</small>${players
      .map(
        (p) =>
          `<div class="list-row"><label class="grow">${esc(p.name)}</label><select name="position:${esc(p.id)}" aria-label="${esc(p.name)} default position" style="width:100px"><option value="">Source</option>${Object.keys(
            pitchPositions,
          )
            .map(
              (pos) =>
                `<option ${value.positions?.[p.id] === pos ? "selected" : ""}>${pos}</option>`,
            )
            .join("")}</select></div>`,
      )
      .join(
        "",
      )}<h3>Awards</h3><small>Record verified awards; an unfinished pool’s current first place is not a trophy.</small>${Array.from({ length: 8 }, (_, i) => field("award" + i, "Award " + (i + 1), value.awards?.[i]?.title || "")).join("")}<div class="actions"><button class="primary">Save season</button>${c ? button("correction-reset", "Reset", "danger") : ""}</div></form>`,
    "season",
    { season: y },
  );
}
async function branding() {
  const b = await request(endpoint("/api/branding")),
    club = state.teams.find((t) => t.club_id)?.club_id;
  if (!club) throw new Error("No verified club identity is available yet.");
  state.branding = { club, b };
  const season =
      state.season === "all" ? String(new Date().getFullYear()) : state.season,
    kits = b.branding["kits:" + club + ":" + season] || [];
  showSheet(
    "Club logo & kits",
    `<form data-form="branding"><p class="muted">Shared across this club’s connected teams.</p><div class="field"><label>Club logo (PNG)</label><input type="file" name="logo" accept="image/png"></div><h3>Kits · ${season}</h3><div id="kit-rows">${(kits.length
      ? kits
      : [
          { name: "Home", color: "#ffffff" },
          { name: "Away", color: "#187444" },
        ]
    )
      .map(
        (k) =>
          `<div class="row" style="margin-bottom:8px"><input name="kit_name" value="${esc(k.name)}" aria-label="Kit name"><input name="kit_color" type="color" value="${esc(k.color)}" aria-label="Kit color">${button("kit-remove", icon("close"), "icon", 'aria-label="Remove kit"')}</div>`,
      )
      .join(
        "",
      )}</div>${button("kit-add", "Add kit")}<div class="actions"><button class="primary">Save branding</button>${button("logo-reset", "Reset logo", "danger")}</div></form>`,
    "branding",
    { club, season },
  );
}
async function traceAuth() {
  showSheet(
    "Trace sign-in",
    `<form data-form="trace-send">${field("email", "Trace account email", "", "email", 'required autocomplete="email"')}<button class="primary">Send sign-in code</button></form>`,
    "trace-auth",
  );
}
async function traceSelect(teams = null) {
  if (!teams) teams = (await request("/api/admin/trace/teams")).teams;
  state.traceChoices = teams;
  showSheet(
    "Connect Trace team",
    `<p class="muted">Select the team for ${esc(state.spaces.find((s) => s.id === state.space)?.name || "this space")}.</p>${teams.map((t) => `<div class="list-row"><span class="grow">${esc(t.name)}</span>${button("trace-connect", "Connect", "", `data-id="${esc(t.id)}"`)}</div>`).join("")}`,
    "trace-select",
  );
}
async function fetchDownload(path, name) {
  const p = await request(path);
  download(
    new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
    name,
  );
}
async function navigate(action, el) {
  const id = el?.dataset.id;
  switch (action) {
    case "nav":
      state.view = el.dataset.view;
      state.pageCursor = null;
      await render();
      break;
    case "settings":
      await settings();
      break;
    case "search":
      search();
      break;
    case "status":
      await status();
      break;
    case "fixture":
      await showFixture(id);
      break;
    case "division":
      await showDivision(id);
      break;
    case "team":
      await showTeam(id);
      break;
    case "player":
      await showPlayer(id);
      break;
    case "stats-player":
      await statsPlayer(id, el.dataset.fixture);
      break;
    case "close":
      closeSheet();
      break;
    case "back":
      history.back();
      break;
    case "month-prev":
    case "month-next":
      state.month = new Date(
        state.month.getFullYear(),
        state.month.getMonth() + (action === "month-next" ? 1 : -1),
        1,
      );
      state.selectedDay = null;
      await render();
      $("#calendar")?.classList.add(
        action === "month-next" ? "slide-left" : "slide-right",
      );
      break;
    case "day":
      state.selectedDay =
        state.selectedDay === el.dataset.day ? null : el.dataset.day;
      mount(scheduleHTML());
      break;
    case "filter":
      state.filter = el.dataset.filter;
      await render();
      break;
    case "range":
      state.range = el.dataset.range;
      state.selectedDay = null;
      mount(scheduleHTML());
      break;
    case "today":
      state.month = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
      );
      state.selectedDay = localDay(new Date().toISOString());
      await render();
      break;
    case "next-season":
      state.season = String(Number(state.season) + 1);
      state.month = new Date(Number(state.season), 6, 1);
      selectors();
      await render();
      break;
    case "search-more":
      state.searchPage++;
      await searchPage();
      break;
    case "next-page":
      state.pageCursor = state.nextPage;
      await render();
      break;
    case "retry":
      await request(endpoint("/api/admin/retry"), { method: "POST", body: {} });
      toast("Background updates queued.");
      break;
    case "retry-job":
      await request(endpoint("/api/admin/retry"), {
        method: "POST",
        body: { id },
      });
      toast("Retry queued.");
      break;
    case "diagnostics":
      await fetchDownload(
        endpoint("/api/admin/export", { kind: "diagnostics" }),
        "myts-diagnostics.json",
      );
      break;
    case "evidence":
      await fetchDownload(
        endpoint("/api/admin/export", { kind: "fixture", id }),
        "myts-evidence.json",
      );
      break;
    case "favorite-fixture":
    case "favorite-team": {
      const kind = action === "favorite-team" ? "team" : "fixture",
        saved = state.favorites.has(id);
      await request(endpoint("/api/admin/favorites"), {
        method: saved ? "DELETE" : "PUT",
        body: { kind, id },
      });
      saved ? state.favorites.delete(id) : state.favorites.add(id);
      toast(
        saved
          ? "Bookmark removed."
          : kind === "team"
            ? "Following team."
            : "Game saved.",
      );
      await loadContext();
      if (action === "favorite-fixture") {
        el.classList.toggle("active", !saved);
        el.setAttribute("aria-label", saved ? "Save game" : "Remove bookmark");
      }
      await render();
      break;
    }
    case "teamsnap-oauth": {
      const client = state.settings.client_id || $("#field-client_id")?.value;
      if (!client) throw new Error("Save your TeamSnap Client ID first.");
      const token = crypto.randomUUID();
      sessionStorage.setItem("myts7_oauth", token);
      sessionStorage.setItem("myts7_client", client);
      const u = new URL("https://auth.teamsnap.com/oauth/authorize");
      u.search = new URLSearchParams({
        client_id: client,
        redirect_uri: location.origin + "/oauth",
        response_type: "token",
        scope: "read",
        state: token,
      });
      location.assign(u);
      break;
    }
    case "trace-auth":
      await traceAuth();
      break;
    case "trace-select":
      await traceSelect();
      break;
    case "trace-connect":
      await request(endpoint("/api/admin/trace/connect"), {
        method: "PUT",
        body: { team_id: id },
      });
      toast("Trace connected. Background collection queued.");
      await loadContext();
      closeSheet();
      await render();
      break;
    case "disconnect":
      if (confirm("Disconnect this provider?")) {
        await request(endpoint("/api/admin/connections", { id }), {
          method: "DELETE",
        });
        toast("Disconnected.");
        await settings();
      }
      break;
    case "gotsport-disconnect":
      await request(endpoint("/api/admin/gotsport/connect", { id }), {
        method: "DELETE",
      });
      await loadContext();
      toast("Disconnected.");
      await render();
      break;
    case "logout":
      await request("/api/session", { method: "DELETE" });
      closeSheet();
      login();
      break;
    case "share": {
      const p = await request(endpoint("/api/admin/share"), {
        method: "POST",
        body: {},
      });
      showSheet(
        "Viewer link",
        `<p class="muted">This link shares this team’s dashboard. Coach settings remain private. Previous links are revoked.</p><input readonly id="viewer-url" value="${esc(p.url)}"><div class="actions">${button("copy-link", "Copy link", "primary")}</div>`,
        "share",
      );
      break;
    }
    case "copy-link":
      await navigator.clipboard.writeText($("#viewer-url").value);
      toast("Link copied.");
      break;
    case "branding":
      await branding();
      break;
    case "kit-add":
      $("#kit-rows").insertAdjacentHTML(
        "beforeend",
        `<div class="row" style="margin-bottom:8px"><input name="kit_name" placeholder="Kit name" aria-label="Kit name"><input name="kit_color" type="color" value="#ffffff" aria-label="Kit color">${button("kit-remove", icon("close"), "icon", 'aria-label="Remove kit"')}</div>`,
      );
      break;
    case "kit-remove":
      el.closest(".row").remove();
      break;
    case "logo-reset":
      await request(endpoint("/api/admin/branding"), {
        method: "PUT",
        body: { club_id: state.branding.club, logo: "" },
      });
      toast("Logo reset.");
      break;
    case "print":
      document.body.classList.add("printing");
      window.print();
      document.body.classList.remove("printing");
      break;
    case "sort": {
      const table = el.closest("table"),
        col = Number(el.dataset.col),
        dir = el.dataset.dir === "asc" ? -1 : 1;
      el.dataset.dir = dir === 1 ? "asc" : "desc";
      const tbody = table.tBodies[0],
        rows = [...tbody.rows];
      rows.sort((a, b) => {
        const av = a.cells[col].textContent.trim(),
          bv = b.cells[col].textContent.trim();
        return (
          dir *
          (av !== "" &&
          bv !== "" &&
          !Number.isNaN(Number(av)) &&
          !Number.isNaN(Number(bv))
            ? Number(av) - Number(bv)
            : av.localeCompare(bv))
        );
      });
      rows.forEach((r) => tbody.append(r));
      break;
    }
    case "coach":
      await coach(id);
      break;
    case "coach-profile":
      await editCoachProfile(id);
      break;
    case "coach-action":
      await coachAction({ type: el.dataset.type });
      break;
    case "coach-bench":
      if (
        state.coachSelected &&
        Object.values(state.coach.value.field).includes(state.coachSelected)
      ) {
        await coachAction({
          type: "substitute",
          out: state.coachSelected,
          in: id,
        });
      } else {
        state.coachSelected = state.coachSelected === id ? null : id;
        renderCoach();
      }
      break;
    case "coach-position": {
      const position = el.dataset.position,
        s = state.coach.value;
      if (state.coachSelected && state.coachSelected !== id) {
        if (Object.values(s.field).includes(state.coachSelected)) {
          await coachAction({
            type: "move",
            player: state.coachSelected,
            position,
          });
        } else if (["setup", "paused", "halftime"].includes(s.phase)) {
          const field = { ...s.field, [position]: state.coachSelected };
          await coachAction({ type: "lineup", field });
        } else if (id) {
          await coachAction({
            type: "substitute",
            out: id,
            in: state.coachSelected,
          });
        }
      } else {
        state.coachSelected = state.coachSelected === id ? null : id;
        renderCoach();
      }
      break;
    }
    case "coach-suggest": {
      const p = await coachAction({ type: "suggest" });
      showSheet(
        "Suggested lineup",
        `<p class="muted">Review before applying.</p>${p.suggestion.reasons.map((r) => `<div class="list-row"><b>${esc(r.position)}</b><div class="grow">${esc(state.coach.value.roster.find((p) => p.id === r.player)?.name)}<br><small>${esc(r.reason)}</small></div></div>`).join("")}${button("coach-apply", "Apply lineup", "primary")}`,
        "coach-suggestion",
        { suggestion: p.suggestion },
      );
      break;
    }
    case "coach-apply": {
      const suggestion = state.sheets.at(-1).data.suggestion;
      await coachAction({ type: "lineup", field: suggestion.field });
      history.back();
      break;
    }
    case "coach-reload": {
      const p = await request(
        endpoint("/api/admin/coach", { id: state.coachFixture }),
      );
      state.coach = p.session;
      renderCoach();
      break;
    }
    case "conflict-accept":
    case "conflict-keep":
      await request(endpoint("/api/admin/conflicts"), {
        method: "POST",
        body: { id, accept: action === "conflict-accept" },
      });
      state.refreshAfterBack = true;
      toast("Conflict resolved.");
      history.back();
      break;
    case "fixture-links":
      await fixtureLinks(id);
      break;
    case "player-links":
      await playerLinks(id);
      break;
    case "season-editor":
      await seasonEditor();
      break;
    case "match-correction":
      await matchCorrection(id);
      break;
    case "player-correction":
      await playerCorrection(id, el.dataset.fixture);
      break;
    case "identity-editor":
      await identityEditor(id);
      break;
    case "correction-reset":
      await request(endpoint("/api/admin/corrections"), {
        method: "DELETE",
        body: state.correctionEdit,
      });
      state.refreshAfterBack = true;
      toast("Correction reset.");
      history.back();
      break;
    case "export-games":
      excel(
        [
          [
            "Date",
            "Home",
            "Away",
            "Home score",
            "Away score",
            "Venue",
            "Status",
            "Source",
          ],
          ...state.fixtures.map((f) => [
            f.starts_at || f.local_day,
            f.home_name,
            f.away_name,
            f.home_score,
            f.away_score,
            f.venue,
            f.status,
            f.provider,
          ]),
        ],
        "myts-games.xlsx",
      );
      break;
    case "export-players":
      excel(
        [
          ["Player", "Jersey", "Source", "Position"],
          ...(state.players || []).map((p) => [
            p.name,
            p.jersey,
            p.provider,
            p.details.position || "",
          ]),
        ],
        "myts-players.xlsx",
      );
      break;
    case "export-match": {
      const p =
        state.detail?.fixture?.id === id
          ? state.detail
          : await request(endpoint("/api/fixture", { id }));
      excel(
        [
          ["Player", "Minutes", "Field", "Goalkeeper", "Goals", "Assists"],
          ...p.analytics.players.map((p) => [
            p.name,
            p.minutes,
            p.field_minutes,
            p.gk_minutes,
            p.goals,
            p.assists,
          ]),
        ],
        "myts-match.xlsx",
      );
      break;
    }
    case "export-division":
      excel(
        [
          [
            "Pool",
            "Rank",
            "Team",
            "MP",
            "W",
            "D",
            "L",
            "GF",
            "GA",
            "GD",
            "Pts",
          ],
          ...state.divisionDetail.standings.map((s) => [
            s.pool_id,
            s.rank,
            s.payload.name,
            ...["mp", "w", "d", "l", "gf", "ga", "gd", "pts"].map(
              (k) => s.payload[k],
            ),
          ]),
        ],
        "myts-standings.xlsx",
      );
      break;
    case "player-more": {
      const p = await request(
        endpoint("/api/player", {
          id,
          cursor: el.dataset.cursor,
          ...(state.season !== "all" ? { season: state.season } : {}),
        }),
      );
      $("#player-games").insertAdjacentHTML(
        "beforeend",
        p.stats
          .map(
            (s) =>
              `<div class="list-row clickable" data-action="stats-player" data-id="${esc(s.player_id)}" data-fixture="${esc(s.fixture_id)}"><span class="grow">${esc(s.payload.home_name)} vs ${esc(s.payload.away_name)}<br><small>${esc(formatDate(s.starts_at || s.local_day, { month: "short", day: "numeric" }))}</small></span>${badge(s.state)}</div>`,
          )
          .join(""),
      );
      if (p.cursor) el.dataset.cursor = p.cursor;
      else el.remove();
      break;
    }
    case "team-more": {
      const p = await request(
        endpoint("/api/fixtures", {
          team: id,
          cursor: el.dataset.cursor,
          limit: 40,
        }),
      );
      $("#team-games").insertAdjacentHTML(
        "beforeend",
        p.items.map(fixtureRow).join(""),
      );
      if (p.cursor) el.dataset.cursor = p.cursor;
      else el.remove();
      break;
    }
    case "division-more": {
      const div = state.divisionDetail,
        last = div.fixtures.at(-1),
        cursor =
          el.dataset.cursor ||
          btoa(
            JSON.stringify([
              last.starts_at || last.local_day || "9999",
              last.id,
            ]),
          ),
        p = await request(
          endpoint("/api/division/fixtures", { id, cursor, limit: 100 }),
        );
      $("#division-games").insertAdjacentHTML(
        "beforeend",
        p.items.map(fixtureRow).join(""),
      );
      if (p.cursor) el.dataset.cursor = p.cursor;
      else el.remove();
      break;
    }
  }
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  if (state.suppressClickUntil > Date.now()) return;
  if (el.disabled) return;
  el.disabled = true;
  try {
    await navigate(el.dataset.action, el);
  } catch (err) {
    toast(err.message);
  } finally {
    el.disabled = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("[role=button][data-action]"))
    e.target.click();
});
$("#search-open").addEventListener("click", search);
$("#settings-open").addEventListener("click", () =>
  settings().catch((e) => toast(e.message)),
);
$("#sheet-close").addEventListener("click", closeSheet);
$("#sheet-back").addEventListener("click", () => history.back());
$("#team-picker").addEventListener("change", async (e) => {
  state.space = e.target.value;
  localStorage.setItem("myts7_space", state.space);
  state.pageCursor = null;
  await loadContext();
  await render();
});
$("#season-picker").addEventListener("change", async (e) => {
  state.season = e.target.value;
  state.pageCursor = null;
  if (state.season !== "all") {
    const mo = new Date().getMonth();
    state.month = new Date(Number(state.season) + (mo < 6 ? 1 : 0), mo, 1);
  }
  await render();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "theme") {
    localStorage.setItem("myts7_theme", e.target.value);
    document.body.dataset.theme = e.target.value;
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form),
    get = (k) => data.get(k),
    number = (k) => (get(k) === "" || get(k) == null ? null : Number(get(k)));
  const buttons = [...form.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    switch (form.dataset.form) {
      case "login":
        if (!state.installed) {
          await request("/api/setup", {
            method: "POST",
            headers: { "x-admin-key": get("key") },
            body: {},
          });
          state.installed = true;
        }
        await request("/api/session", {
          method: "POST",
          body: { key: get("key") },
        });
        await boot();
        break;
      case "settings":
        await request("/api/admin/settings", {
          method: "PUT",
          body: {
            timezone: get("timezone"),
            client_id: get("client_id"),
            include_preseason: data.has("include_preseason"),
          },
        });
        state.settings = {
          ...state.settings,
          timezone: get("timezone"),
          client_id: get("client_id"),
          include_preseason: data.has("include_preseason"),
        };
        toast("Settings saved.");
        break;
      case "space": {
        const p = await request("/api/admin/spaces", {
          method: "POST",
          body: { name: get("name") },
        });
        state.spaces.push(p);
        state.space = p.id;
        selectors();
        await loadContext();
        await render();
        toast("Team created.");
        break;
      }
      case "gotsport":
        await request(endpoint("/api/admin/gotsport/connect"), {
          method: "PUT",
          body: { team_id: get("team_id") },
        });
        await loadContext();
        await render();
        toast("GotSport connected. Background collection queued.");
        break;
      case "search":
        state.searchQuery = {
          q: get("q"),
          age: get("age"),
          gender: get("gender"),
          state: get("state"),
        };
        state.searchPage = 1;
        await searchPage();
        break;
      case "trace-send":
        await request("/api/admin/trace/send-code", {
          method: "POST",
          body: { email: get("email") },
        });
        replaceSheet(
          "Trace sign-in",
          `<form data-form="trace-code">${field("code", "Email sign-in code", "", "text", 'required autocomplete="one-time-code"')}<button class="primary">Verify code</button></form>`,
          "trace-auth",
        );
        toast("Code sent.");
        break;
      case "trace-code": {
        const p = await request("/api/admin/trace/verify-code", {
          method: "POST",
          body: { code: get("code") },
        });
        await traceSelect(p.teams);
        break;
      }
      case "branding": {
        const season = state.sheets.at(-1).data.season,
          kits = data
            .getAll("kit_name")
            .map((name, i) => ({ name, color: data.getAll("kit_color")[i] })),
          payload = { club_id: state.branding.club, season, kits },
          file = get("logo");
        if (file?.size) {
          if (file.type !== "image/png") throw new Error("Use a PNG logo.");
          const img = await createImageBitmap(file),
            canvas = document.createElement("canvas"),
            scale = Math.min(1, 256 / img.width, 256 / img.height);
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas
            .getContext("2d")
            .drawImage(img, 0, 0, canvas.width, canvas.height);
          payload.logo = canvas.toDataURL("image/png");
          img.close();
        }
        await request(endpoint("/api/admin/branding"), {
          method: "PUT",
          body: payload,
        });
        await loadContext();
        await render();
        toast("Club branding saved.");
        break;
      }
      case "coach-create":
        await coachAction({
          type: "create",
          format: number("format"),
          half_minutes: number("half_minutes"),
        });
        break;
      case "coach-availability":
        await coachAction({
          type: "availability",
          players: data.getAll("players"),
        });
        break;
      case "coach-correct": {
        const minutes = {};
        for (const [k, v] of data)
          if (k.startsWith("minutes:")) minutes[k.slice(8)] = Number(v);
        await coachAction({
          type: "correct",
          elapsed_ms: number("elapsed") * 60000,
          minutes,
        });
        break;
      }
      case "coach-late":
        await coachAction({
          type: "late_substitute",
          out: get("out"),
          in: get("in"),
          at_minutes: number("at_minutes"),
          duration: number("duration"),
        });
        break;
      case "coach-profile": {
        const value = {
          positions: {},
          endurance: number("endurance"),
          target_minutes: number("target_minutes"),
        };
        for (let i = 0; i < 3; i++)
          if (get("position" + i))
            value.positions[get("position" + i)] = number("rating" + i);
        const { id, season, revision } = state.profileEdit;
        await request(endpoint("/api/admin/coach/profiles"), {
          method: "PUT",
          body: { player_id: id, season, revision, value },
        });
        toast("Coach attributes saved.");
        history.back();
        break;
      }
      case "match-correction": {
        const value = { ...state.correctionEdit.value, note: get("note") };
        if (number("format")) value.format = number("format");
        else delete value.format;
        value.lineup = {};
        value.events = {};
        for (const [k, v] of data) {
          if (k.startsWith("pos:") && v) {
            const [_, half, ...id] = k.split(":");
            value.lineup[half] ??= {};
            value.lineup[half][id.join(":")] = v;
          }
          if (k.startsWith("event:") && v)
            value.events[k.slice(6)] = { player_id: v };
        }
        for (const half of [1, 2])
          if (
            Object.values(value.lineup[half] || {}).filter((p) => p === "GK")
              .length > 1
          )
            throw new Error("Choose one goalkeeper per half.");
        await request(endpoint("/api/admin/corrections"), {
          method: "PUT",
          body: { ...state.correctionEdit, value },
        });
        state.refreshAfterBack = true;
        toast("Match correction saved.");
        history.back();
        break;
      }
      case "player-correction": {
        const value = {};
        for (const k of [
          "minutes",
          "field_minutes",
          "gk_minutes",
          "goals",
          "assists",
        ])
          if (number(k) != null) value[k] = number(k);
        await request(endpoint("/api/admin/corrections"), {
          method: "PUT",
          body: { ...state.correctionEdit, value },
        });
        state.refreshAfterBack = true;
        toast("Player correction saved.");
        history.back();
        break;
      }
      case "source-link": {
        const edit = state.correctionEdit;
        await request(endpoint("/api/admin/corrections"), {
          method: "PUT",
          body: {
            ...edit,
            value: {
              [edit.kind === "fixture_link"
                ? "trace_fixture_id"
                : "trace_player_id"]: get("manual_target")
                ? get("manual_target").startsWith("trace:")
                  ? get("manual_target")
                  : "trace:" + get("manual_target")
                : get("target"),
            },
          },
        });
        state.refreshAfterBack = true;
        toast("Sources matched.");
        await loadContext();
        history.back();
        await render();
        break;
      }
      case "season": {
        const positions = {},
          awards = [];
        for (const [k, v] of data)
          if (k.startsWith("position:") && v) positions[k.slice(9)] = v;
        for (let i = 0; i < 8; i++)
          if (get("award" + i))
            awards.push({ title: get("award" + i), source: "manual" });
        await request(endpoint("/api/admin/corrections"), {
          method: "PUT",
          body: {
            ...state.correctionEdit,
            value: { ...state.correctionEdit.value, positions, awards },
          },
        });
        toast("Season corrections saved.");
        history.back();
        break;
      }
      case "identity": {
        const id = get("player"),
          edit = state.identityEdit,
          c = edit.corrections.find((c) => c.entity_id === form.dataset.gid),
          correction = {
            kind: "identity",
            entity_id: form.dataset.gid,
            season: edit.fixture,
            revision: c?.revision || 0,
          };
        if (id) {
          const player = edit.players.find((p) => p.id === id);
          if (!player) throw new Error("Select a verified player.");
          await request(endpoint("/api/admin/corrections"), {
            method: "PUT",
            body: {
              ...correction,
              value: { user_id: id.slice(6), name: player.name },
            },
          });
        } else if (c) {
          await request(endpoint("/api/admin/corrections"), {
            method: "DELETE",
            body: correction,
          });
        }
        state.refreshAfterBack = true;
        toast(id ? "Identity saved." : "Source identity restored.");
        await identityEditor(edit.source, true);
        break;
      }
    }
  } catch (err) {
    toast(err.message);
    if (form.dataset.form === "login") login(err.message, state.installed);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});
let touchStart = null;
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest("#calendar"))
    touchStart = { x: e.clientX, y: e.clientY };
  const player = e.target.closest(".position[data-id],.bench button[data-id]");
  if (player?.dataset.id && state.coach) {
    state.drag = {
      id: player.dataset.id,
      x: e.clientX,
      y: e.clientY,
      pointer: e.pointerId,
      moved: false,
    };
  }
});
document.addEventListener("pointermove", (e) => {
  if (
    state.drag &&
    e.pointerId === state.drag.pointer &&
    Math.hypot(e.clientX - state.drag.x, e.clientY - state.drag.y) > 12
  )
    state.drag.moved = true;
});
document.addEventListener("pointerup", async (e) => {
  if (touchStart && e.target.closest("#calendar")) {
    const dx = e.clientX - touchStart.x,
      dy = e.clientY - touchStart.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
      await navigate(dx < 0 ? "month-next" : "month-prev");
  }
  touchStart = null;
  if (state.drag?.moved) {
    state.suppressClickUntil = Date.now() + 500;
    const id = state.drag.id,
      target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest(".position");
    state.drag = null;
    if (target) {
      try {
        state.coachSelected = id;
        await navigate("coach-position", target);
      } catch (err) {
        toast(err.message);
      }
    }
  }
  state.drag = null;
});
document.addEventListener("pointercancel", () => {
  state.drag = null;
  touchStart = null;
});
setInterval(() => {
  if (state.sheets.at(-1)?.kind === "coach" && state.coach && $("#coach-clock"))
    $("#coach-clock").textContent = clock(coachTime(state.coach.value));
}, 1000);
setInterval(async () => {
  if (document.hidden || state.busy) return;
  try {
    if (
      state.sheets.at(-1)?.kind === "coach" &&
      state.coach &&
      !state.coachPending
    ) {
      const p = await request(
        endpoint("/api/admin/coach", { id: state.coachFixture }),
      );
      if (p.session && p.session.revision !== state.coach.revision) {
        state.coach = p.session;
        renderCoach();
        toast("Coach session updated from another device.");
      }
    } else if (state.space && !state.sheets.length) {
      const p = await request(endpoint("/api/status")),
        signature = p.jobs.map((j) => j.last_saved).join("|");
      if (state.lastStatus && signature !== state.lastStatus) {
        await loadContext();
        await render();
      }
      state.lastStatus = signature;
    }
    if (!state.spaces.length && state.owner) {
      const p = await request("/api/bootstrap");
      if (p.spaces.length) {
        state.spaces = p.spaces;
        state.space = p.spaces[0].id;
        selectors();
        await loadContext();
        await render();
      }
    }
  } catch {}
}, 15000);
boot();
