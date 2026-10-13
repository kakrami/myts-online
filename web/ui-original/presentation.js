import { icon } from "./icons.js";
export { icon };
export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const unwrap = model => model?.data ?? model ?? {};
export function formatNumber(value, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
}
export function formatDate(value, { timezone = "America/Los_Angeles", ...options } = {}) {
  if (!value) return "—";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const date = new Date(dateOnly ? value + "T12:00:00Z" : value);
  if (!Number.isFinite(date.getTime())) return "—";
  try { return new Intl.DateTimeFormat(undefined, { timeZone: dateOnly ? "UTC" : timezone, month: "short", day: "numeric", ...options }).format(date); }
  catch { return "—"; }
}
export function safeURL(value) {
  if (!value) return "";
  try { const u = new URL(value, "https://myts.invalid"); return ["https:","http:"].includes(u.protocol) ? String(value) : ""; } catch { return ""; }
}
export function safeImageURL(value) {
  if(typeof value==="string"&&value.length<=128000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value))return value;
  return safeURL(value);
}
export function highlight(value, query = "") {
  const text = String(value ?? ""), term = String(query).trim();
  if (!term) return escapeHTML(text);
  let out = "", start = 0, index;
  while ((index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase(), start)) !== -1) {
    out += escapeHTML(text.slice(start, index)) + "<mark>" + escapeHTML(text.slice(index, index + term.length)) + "</mark>";
    start = index + term.length;
  }
  return out + escapeHTML(text.slice(start));
}
export function dataAttrs(data = {}) {
  return Object.entries(data).filter(([key,value]) => /^[a-z][a-z0-9_-]*$/.test(key) && value != null).map(([key,value]) => ` data-${key}="${escapeHTML(value)}"`).join("");
}
export function button(action, label, { className = "btn small", data = {}, title = "", disabled = false, pressed, html = false } = {}) {
  return `<button type="button" class="${escapeHTML(className)}" data-action="${escapeHTML(action)}"${dataAttrs(data)}${title ? ` aria-label="${escapeHTML(title)}" title="${escapeHTML(title)}"` : ""}${disabled ? " disabled" : ""}${pressed == null ? "" : ` aria-pressed="${!!pressed}"`}>${html ? label : escapeHTML(label)}</button>`;
}
export function empty(message, sources = []) {
  return `<div class="empty">${escapeHTML(message)}${sources.length ? `<div class="source-note">${sources.map(escapeHTML).join(" · ")}</div>` : ""}</div>`;
}
export function pageHead(title, subtitle = "", actionsHTML = "") {
  return `<div class="page-head"><div><h1>${escapeHTML(title)}</h1>${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ""}</div>${actionsHTML ? `<div class="page-actions">${actionsHTML}</div>` : ""}</div>`;
}
export function seg(items, selected, { action, label = "", data = {} } = {}) {
  return `<div class="seg" role="group" aria-label="${escapeHTML(label)}">${items.map(item => button(action, item.label, { className: item.value === selected ? "active" : "", data: {...data,value:item.value}, pressed:item.value === selected })).join("")}</div>`;
}
export function detailTabs(tabs, selected, { action = "detail-tab", data = {} } = {}) {
  return `<div class="entity-tabs" role="tablist">${tabs.map(tab => `<button type="button" role="tab" class="${tab.id === selected ? "active" : ""}" aria-selected="${tab.id === selected}" data-action="${escapeHTML(action)}"${dataAttrs({...data,tab:tab.id})}${tab.disabled ? " disabled" : ""}>${escapeHTML(tab.label)}</button>`).join("")}</div>`;
}
export function pickerHTML(id, label, items = [], selected = "", { action = "select", extraAction = null, extraActions = [] } = {}) {
  const choice = items.find(item => String(item.value ?? item.id) === String(selected));
  const itemLabel=item=>item?.logo?teamIdentity({name:item.label??item.name,logo:item.logo},{interactive:false}):escapeHTML(item?.label??item?.name??label);
  let lastGroup = null;
  return `<div class="app-select ${id === "teamPicker" ? "team-picker" : id === "seasonPicker" ? "season-picker" : ""}" id="${escapeHTML(id)}"><button type="button" class="app-select-trigger" data-action="picker-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHTML(label)}"><span class="app-select-value">${choice?itemLabel(choice):escapeHTML(label)}</span>${icon("chevron-down")}</button><div class="app-select-menu hidden" role="listbox" aria-label="${escapeHTML(label)}">${items.map(item => {
    const group = item.group, heading = group && group !== lastGroup ? `<div class="app-select-group">${escapeHTML(group)}</div>` : ""; lastGroup = group;
    const value = item.value ?? item.id;
    return heading + `<button type="button" class="app-select-option ${String(value) === String(selected) ? "selected" : ""}" role="option" aria-selected="${String(value) === String(selected)}" data-action="${escapeHTML(action)}" data-value="${escapeHTML(value)}">${itemLabel(item)}</button>`;
  }).join("")}${[...(extraAction?[extraAction]:[]),...extraActions].map(item=>button(item.action,item.label,{className:"app-select-option",data:item.data??{}})).join("")}</div></div>`;
}
export const KIT_COLORS={Black:'#111111',White:'#ffffff',Red:'#dc2626',Gray:'#808080',Blue:'#2563eb',Navy:'#172554',Green:'#15803d',Yellow:'#facc15',Orange:'#f97316',Purple:'#9333ea',Pink:'#ec4899'};
export function kitColor(kit={}){if(/^#[0-9a-f]{6}$/i.test(kit.color??''))return kit.color;const name=String(kit.name??'').trim().replace(/\s+/g,' ').toLowerCase().replace(/\s+(kit|uniform|jersey)$/,'').replace(/^grey$/,'gray');return Object.entries(KIT_COLORS).find(([key])=>key.toLowerCase()===name)?.[1]??'';}
export function kitIcon(kit={}){const color=kitColor(kit),name=String(kit.name??'Kit'),hint=kit.color_origin==='name_palette'?' — color based on kit name':'';return `<span class="kit-icon" role="img" aria-label="${escapeHTML(name)}${hint}${color?'':' — color not set'}" title="${escapeHTML(name)}${hint}${color?'':' — color not set'}"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M9 3 3 6 1 12 6 14 8 10 8 25 20 25 20 10 22 14 27 12 25 6 19 3Q14 8 9 3Z" fill="${color||'none'}" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M10 3Q14 11 18 3" fill="none" stroke="currentColor" stroke-width="1.25"/></svg></span>`;}
export function teamKits(kits=[]){return kits.length?`<span class="team-colors" aria-label="Team kits">${kits.slice(0,32).map(kitIcon).join('')}</span>`:'';}
export function teamIdentity(team = {}, { query = "", interactive = true } = {}) {
  const id = team.id ?? "", logo = safeImageURL(team.logo??team.logo_url);
  const inside = `<span class="team-display"><span class="club-badge" aria-hidden="true">${logo ? `<img src="${escapeHTML(logo)}" alt="" loading="lazy">` : icon("people")}</span><span class="team-display-label">${highlight(team.name ?? "Team",query)}</span>${teamKits(team.kits??[])}</span>`;
  return interactive && id ? `<button type="button" class="team-link" data-action="team" data-id="${escapeHTML(id)}">${inside}</button>` : inside;
}
// Provider and owner titles may be empty strings. Keep display/accessibility
// fallback independent of canonical identity and bookmark keys.
export function eventTitle(event={}) {
  event=event&&typeof event==='object'?event:{};
  const text=value=>typeof value==='string'?value.trim():'';
  return text(event.title)||[text(event.home?.name)||text(event.home_name),text(event.away?.name)||text(event.away_name)].filter(Boolean).join(' vs ')||
    (['game','division_match'].includes(event.kind??event.type)?'Match':event.type==='practice'?'Practice':'Event');
}
export function matchRow(event, { timezone = "America/Los_Angeles", query = "", grouped = false, showYear = false } = {}) {
  const game = ["game","division_match"].includes(event.kind ?? event.type), cancelled = event.status === "CANCELLED" || event.cancelled;
  const day = event.starts_at ?? event.local_day;
  const time = event.time_pending || !event.starts_at ? "Time TBD" : formatDate(event.starts_at,{timezone,hour:"numeric",minute:"2-digit",month:undefined,day:undefined});
  const home = event.home ?? {id:event.home_id,name:event.home_name,logo:event.home_logo};
  const away = event.away ?? {id:event.away_id,name:event.away_name,logo:event.away_logo};
  const meta = [event.conditional ? "Conditional fixture · participants TBD" : event.competition_name ?? event.title, event.source_label ?? event.provider_label].filter(Boolean).join(" · ");
  const scored = !cancelled && event.home_score != null && event.away_score != null;
  const sides = game ? `<div class="fixture-versus"><span class="fixture-status" title="${escapeHTML(event.status_label ?? event.status)}">${scored && event.status === "FINAL" ? "FT" : event.conditional ? "TBD" : ""}</span><div class="fixture-side home">${teamIdentity(home,{query,interactive:false})}</div><div class="fixture-center"><strong class="fixture-score">${scored ? escapeHTML(event.home_score)+"–"+escapeHTML(event.away_score) : escapeHTML(time)}</strong>${event.round ? `<small class="fixture-stage">${escapeHTML(event.round)}</small>` : ""}</div><div class="fixture-side away">${teamIdentity(away,{query,interactive:false})}</div><div class="fixture-actions">${event.bookmarked ? `<span class="favorite-mark" role="img" aria-label="Bookmarked game">${icon("bookmark-fill")}</span>` : ""}${event.has_player_stats ? `<span class="fixture-stats" role="img" aria-label="Player stats available">${icon("bar-chart")}</span>` : ""}</div></div>` : `<b>${highlight(eventTitle(event),query)}</b>`;
  return `<article class="schedule-row ${game ? "versus-row" : ""} ${grouped ? "grouped-match" : ""} ${cancelled ? "cancelled" : ""}"><div class="schedule-open"><button class="match-hit" type="button" data-action="match" data-id="${escapeHTML(event.id)}"${dataAttrs({...(event.team_season_id?{team_season_id:event.team_season_id}:{}),...(event.app_team_id?{team_id:event.app_team_id}:{}),...(event.historical_context?{h2h_anchor:event.historical_context.anchor_event_id,team_id:event.historical_context.team_id,team_season_id:event.historical_context.team_season_id}:{})})} aria-label="${escapeHTML("Open match details: " + eventTitle(event))}"></button>${grouped ? `<span class="when fixture-kickoff">${escapeHTML(time)}</span>` : `<div class="fixture-date">${escapeHTML(formatDate(day,{timezone,...(showYear ? {year:"numeric"} : {})}))}</div>`}<div class="main">${sides}<div class="fixture-meta"><small>${highlight(meta,query)}</small></div>${(event.identity_conflict||event.duplicate_review||event.possible_duplicate) && !event.conditional ? '<span class="event-status">Possible duplicate</span>' : ""}${event.result_conflict ? '<span class="event-status">Conflicting results</span>' : ""}${event.status && !["FINAL","SCHEDULED"].includes(event.status) ? `<span class="event-status">${escapeHTML(event.status_label ?? event.status)}</span>` : ""}</div></div></article>`;
}
export function tableHTML({ id = "", columns = [], rows = [], className = "", tableClassName = "", footerHTML = "", rowAction = "", rowData = {}, query = "", sort = {}, sortAction = "sort", sortData = {} } = {}) {
  return `<div class="table-wrap card ${escapeHTML(className)}"><table class="table ${escapeHTML(tableClassName)}"${id ? ` id="${escapeHTML(id)}"` : ""}><thead><tr>${columns.map(c => `<th class="${c.numeric ? "num" : ""}"${sort.key === c.key ? ` aria-sort="${sort.direction === "desc" ? "descending" : "ascending"}"` : ""}>${c.sortable === false ? escapeHTML(c.label) : button(sortAction,c.label,{className:"text-action",data:{...sortData,key:c.key,direction:sort.key === c.key && sort.direction === "asc" ? "desc" : "asc"}})}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr${rowAction ? ` class="click" data-action="${escapeHTML(rowAction)}" data-id="${escapeHTML(row.id)}"${dataAttrs(typeof rowData==='function'?rowData(row):rowData)} tabindex="0"` : ""}>${columns.map(c => `<td class="${c.numeric ? "num" : ""}" data-label="${escapeHTML(c.label)}">${typeof c.render === "function" ? c.render(row,query) : c.numeric ? formatNumber(row[c.key],c.digits ?? 0) : highlight(row[c.key],query)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length}">${empty(query ? "No matching players." : "No saved data for this selection.")}</td></tr>`}</tbody>${footerHTML ? `<tfoot>${footerHTML}</tfoot>` : ""}</table></div>`;
}
export function detailFacts(items = []) {
  return `<div class="card detail-facts" role="list">${items.filter(item => item.value != null).map(item => `<div class="detail-fact" role="listitem"><span>${escapeHTML(item.label)}</span><b>${escapeHTML(item.value)}</b>${item.sub ? `<small>${escapeHTML(item.sub)}</small>` : ""}</div>`).join("")}</div>`;
}
export function moreButton(page = {}, { action = "more", data = {} } = {}) {
  return page.next_cursor ? `<div class="ui-load-more">${button(action,"More",{data:{...data,cursor:page.next_cursor}})}</div>` : "";
}
export function sourceRows(providers = [], { owner = false } = {}) {
  return `<div class="account-sources">${providers.map(p => `<section class="account-source"><div class="source-head">${icon(p.provider === "trace" ? "camera-video" : p.provider === "gotsport" ? "trophy" : "people")}<div><b>${escapeHTML(p.label ?? p.name ?? p.provider)}</b><span class="source-summary">${icon(p.state === "ready" ? "check-circle" : p.state?.startsWith("blocked") || p.error ? "exclamation-circle" : "clock")}<span>${escapeHTML(p.status_label ?? p.state ?? "Not connected")}</span></span></div>${owner ? button("source-manage","Manage",{data:{provider:p.provider}}) : ""}</div></section>`).join("")}</div>`;
}
export function settingsBody(model) {
  const m = unwrap(model), theme = m.theme ?? "light";
  return `<div class="account-preference"><div><b>Theme</b><small>Light, Dark, or Soccer Green</small></div>${button("theme-cycle",icon(theme === "dark" ? "moon" : "sun"),{className:"icon-btn theme-cycle",title:"Change theme",html:true})}</div>${m.can_reports===false?"":`<div class="account-preference"><div><b>Reports</b><small>Review and export team data.</small></div>${button("reports","Open reports")}</div>`}${sourceRows(m.providers ?? [],{owner:m.owner})}${m.owner && m.has_viewer_link ? `<section class="account-share"><div><b>Private viewer link</b><small>Read-only access to this team's dashboard.</small></div><div class="action-row">${button("share-copy",icon("copy")+"Copy link",{html:true})}${button("share-replace","Replace link")}</div></section>` : ""}<div class="account-footer">${m.owner&&m.has_team!==false ? button("diagnostics",icon("download")+"Diagnostics",{html:true})+button("usage","D1 usage") : "<span></span>"}<span class="version-line">myTS v${escapeHTML(m.version)}</span>${m.owner ? button("sign-out","Sign out") : ""}</div>`;
}
