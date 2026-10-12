import { escapeHTML as e, pickerHTML } from "./presentation.js";
import { replaceIcons } from "./icons.js";
const template = "<a class=\"skip-link\" href=\"#root\">Skip to content</a><div id=\"progress\"></div>\n<section class=\"login\" id=\"loginScreen\">\n  <div class=\"login-card\">\n    <div class=\"login-brand\"><div class=\"logo\">TS</div><div class=\"brand-copy\"><b>myTS <span class=\"version js-version\"></span></b><span>Team and performance dashboard</span></div></div>\n    <h1 id=\"loginTitle\">Open myTS</h1><p id=\"loginText\">Use the private team link from your manager.</p>\n    <form id=\"loginForm\" class=\"hidden\">\n      <div class=\"field\"><label for=\"adminKey\">Owner password</label><input id=\"adminKey\" type=\"password\" autocomplete=\"current-password\" placeholder=\"Owner password\"></div>\n      <button class=\"btn primary full\" type=\"submit\" id=\"loginButton\"><i class=\"bi bi-shield-lock\"></i>Open owner console</button>\n    </form>\n    <div id=\"loginError\" class=\"login-error hidden\"></div>\n  </div>\n</section>\n<div id=\"app\" class=\"hidden\">\n  <header class=\"appbar\">\n    <div class=\"appbar-top\">\n      <div class=\"app-brand\"><div class=\"logo\">TS</div><div class=\"app-title\">myTS <span class=\"version js-version\"></span></div></div>\n      <div class=\"selectors\">\n        <div class=\"app-select team-picker\" id=\"teamPicker\">\n          <button type=\"button\" class=\"app-select-trigger\" aria-haspopup=\"listbox\" aria-expanded=\"false\" aria-label=\"Team\"><span class=\"app-select-value\">Team</span><i class=\"bi bi-chevron-down\"></i></button>\n          <div class=\"app-select-menu hidden\"></div>\n        </div>\n        <div class=\"app-select season-picker\" id=\"seasonPicker\">\n          <button type=\"button\" class=\"app-select-trigger\" aria-haspopup=\"listbox\" aria-expanded=\"false\" aria-label=\"Season\"><span class=\"app-select-value\">Season</span><i class=\"bi bi-chevron-down\"></i></button>\n          <div class=\"app-select-menu hidden\"></div>\n        </div>\n      </div>\n      <div class=\"app-actions\"><button type=\"button\" class=\"icon-btn\" id=\"teamSearchBtn\" title=\"Find a team\" aria-label=\"Find a team\"><i class=\"bi bi-search\"></i></button><button class=\"icon-btn\" id=\"accountBtn\" data-label=\"Settings\" title=\"Settings\" aria-label=\"Settings\"><i class=\"bi bi-sliders\"></i></button></div>\n    </div>\n    <div id=\"selectScrim\" class=\"select-scrim hidden\" aria-hidden=\"true\"></div>\n    <nav class=\"primary-nav\" id=\"nav\" aria-label=\"Primary\"><button class=\"nav-btn active\" data-view=\"overview\"><i class=\"bi bi-grid\"></i><span>Overview</span></button><button class=\"nav-btn\" data-view=\"matches\"><i class=\"bi bi-calendar3\"></i><span>Schedule</span></button><button class=\"nav-btn\" data-view=\"tournaments\"><i class=\"bi bi-trophy\"></i><span>Competitions</span></button><button class=\"nav-btn\" data-view=\"team\"><i class=\"bi bi-people\"></i><span>Team</span></button><button class=\"nav-btn\" data-view=\"favorites\"><i class=\"bi bi-bookmark\"></i><span>Bookmarks</span></button></nav>\n  </header>\n  <div class=\"workspace\"><main id=\"root\" tabindex=\"-1\"></main></div>\n</div>\n<div id=\"entity\" class=\"entity hidden\" role=\"dialog\" aria-modal=\"false\" aria-labelledby=\"entityTitle\"><div class=\"entity-card\"><div class=\"entity-top\"><button id=\"entityBack\" class=\"hidden\" type=\"button\" aria-label=\"Back\"><i class=\"bi bi-chevron-left\"></i></button><div class=\"entity-title\" id=\"entityTitle\"></div><div id=\"entityActions\" class=\"page-actions\"></div><button id=\"entityClose\" type=\"button\" aria-label=\"Close\"><i class=\"bi bi-x-lg\"></i></button></div><div class=\"entity-body\" id=\"entityBody\"></div></div></div>\n<div id=\"sourceModal\" class=\"modal hidden\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"sourceModalTitle\"><div class=\"modal-card settings-card\"><div class=\"modal-head\"><h2 id=\"sourceModalTitle\">Manage source</h2><button type=\"button\" class=\"icon-btn\" data-close=\"sourceModal\" aria-label=\"Close\"><i class=\"bi bi-x-lg\"></i></button></div><div class=\"modal-body\"><div id=\"sourceControls\"></div><div class=\"source-detail-info\" tabindex=\"0\" aria-label=\"Update details\"><p id=\"sourceDetailStatus\" class=\"modal-copy\" role=\"status\"></p><p id=\"sourceDetailError\" class=\"source-note\"></p><p id=\"sourceDetailHelp\" class=\"modal-copy\"></p><p id=\"sourceDetailLast\" class=\"source-note\"></p><p id=\"sourceDetailProgress\" class=\"source-note\"></p></div></div><div class=\"modal-foot\"><button type=\"button\" class=\"btn small\" id=\"sourceDiagnostics\">Diagnostics</button></div></div></div>\n<div id=\"accountModal\" class=\"modal hidden\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"accountModalTitle\"><div class=\"modal-card\"><div class=\"modal-head\"><h2 id=\"accountModalTitle\">Settings</h2><button class=\"icon-btn\" data-close=\"accountModal\" aria-label=\"Close\"><i class=\"bi bi-x-lg\"></i></button></div><div class=\"modal-body\" id=\"accountBody\"></div></div></div>\n\n<div id=\"traceModal\" class=\"modal hidden\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"traceModalTitle\"><div class=\"modal-card\"><div class=\"modal-head\"><h2 id=\"traceModalTitle\">Connect Trace</h2><button class=\"icon-btn\" data-close=\"traceModal\" aria-label=\"Close\"><i class=\"bi bi-x-lg\"></i></button></div><div class=\"modal-body\"><p class=\"modal-copy\" id=\"traceModalText\"></p><div id=\"traceModalContent\"></div><div id=\"traceModalError\" class=\"login-error hidden\"></div></div><div class=\"modal-foot\"><button class=\"btn danger hidden\" id=\"traceDisconnectBtn\">Disconnect</button><button class=\"btn primary\" id=\"traceActionBtn\">Continue</button></div></div></div>\n<div id=\"confirmModal\" class=\"modal hidden\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"confirmTitle\"><div class=\"modal-card confirm-card\"><div class=\"confirm-icon\" id=\"confirmIcon\"><i class=\"bi bi-exclamation-circle\"></i></div><div class=\"modal-body confirm-body\"><h2 id=\"confirmTitle\">Confirm action</h2><p id=\"confirmText\"></p></div><div class=\"modal-foot\"><button class=\"btn\" id=\"confirmCancel\">Cancel</button><button class=\"btn primary\" id=\"confirmAction\">Continue</button></div></div></div>\n\n<div class=\"notifications\"><div id=\"toast\" class=\"toast hidden\" role=\"status\" aria-live=\"polite\"></div></div>\n";

export function renderShell(model = {}) {
  const version = e(model.version ?? ""), oldViews = {matches:"schedule",tournaments:"competitions",favorites:"bookmarks"};
  return replaceIcons(template).replace(/<span class="version js-version"><\/span>/g, `<span class="version js-version">${version}</span>`).replace(/data-view="([a-z]+)"/g, (_,value) => `data-action="nav" data-view="${oldViews[value] ?? value}"`).replace('<form id="loginForm"', '<div id="maintenanceStatus" class="source-note hidden" role="status" aria-live="polite"><p id="maintenanceLabel"></p><progress id="maintenanceProgress" max="100" value="0" aria-label="Update progress"></progress></div><form id="loginForm"').replace('id="loginForm"','id="loginForm" data-form="owner-login"').replace('id="adminKey"','id="adminKey" name="key"');
}
export function applyTheme(theme = "light", root = document.documentElement) {
  const value = ["light","dark","soccer"].includes(theme) ? theme : theme === "green" ? "soccer" : "light";
  root.dataset.theme = value;
  root.style.colorScheme = value === "dark" ? "dark" : "light";
  const color = {light:"#f4f6f5",dark:"#101713",soccer:"#e7f2df"}[value];
  root.ownerDocument?.querySelector('meta[name="theme-color"]')?.setAttribute("content",color);
  return value;
}
export function updateShell(host, model = {}) {
  const dashboard = model.mode === "dashboard";
  host.querySelector("#app")?.classList.toggle("hidden",!dashboard);
  host.querySelector("#loginScreen")?.classList.toggle("hidden",dashboard);
  host.querySelectorAll(".js-version").forEach(node => node.textContent = model.version ?? "");
  const form=host.querySelector("#loginForm");
  form?.classList.toggle("hidden",!model.owner_login||!!model.maintenance);
  host.querySelector('#maintenanceStatus')?.classList.toggle('hidden',!model.maintenance);
  const maintenanceLabel=host.querySelector('#maintenanceLabel');if(maintenanceLabel)maintenanceLabel.textContent=model.maintenance?`${model.maintenance.label} · ${model.maintenance.progress}%`:'';
  const maintenanceProgress=host.querySelector('#maintenanceProgress');if(maintenanceProgress)maintenanceProgress.value=model.maintenance?.progress??0;
  const loginButton=host.querySelector('#loginButton');if(loginButton)loginButton.innerHTML=replaceIcons('<i class="bi bi-shield-lock"></i>')+(model.needs_initialization?'Initialize & sign in':'Sign in');
  const password=host.querySelector("#adminKey");if(password){password.autocomplete=model.needs_initialization?"new-password":"current-password";password.disabled=!!model.maintenance;if(model.maintenance)password.value="";}
  const title=host.querySelector("#loginTitle"); if(title) title.textContent=model.login_title ?? (model.owner_login ? "Owner console" : "Private dashboard");
  const intro=host.querySelector("#loginText"); if(intro) intro.textContent=model.login_help ?? (model.owner_login ? "Enter the owner key to manage the dashboard." : "Use the private viewer link provided by the team owner.");
  const error=host.querySelector("#loginError"); if(error) {error.textContent=model.login_error ?? "";error.classList.toggle("hidden",!model.login_error);}
  const team=host.querySelector("#teamPicker"); if(team) team.outerHTML=pickerHTML("teamPicker","Team",model.teams ?? [],model.selected_team_id,{action:"team-select",extraActions:[...(model.owner?[{action:'add-team',label:'Add team'}]:[]),...(model.team_catalog?.has_previous?[{action:"teams-previous",label:"Previous team choices"}]:[]),...(model.team_catalog?.next_cursor?[{action:"teams-more",label:"More teams",data:{cursor:model.team_catalog.next_cursor}}]:[])]});
  const season=host.querySelector("#seasonPicker"); if(season) season.outerHTML=pickerHTML("seasonPicker",model.season_pending?"Choose season":"Season",model.seasons ?? [],model.selected_season_id,{action:"season-select",extraAction:model.owner===false||!model.selected_season_id?null:{action:"included-games",label:"Included games"},extraActions:[...(model.season_catalog?.has_previous?[{action:"seasons-previous",label:"Previous seasons"}]:[]),...(model.season_catalog?.next_cursor?[{action:"seasons-more",label:"Older seasons",data:{cursor:model.season_catalog.next_cursor}}]:[])]});
  host.querySelector("#teamSearchBtn")?.classList.toggle("hidden",model.owner===false);
  host.querySelector("#nav")?.classList.toggle("hidden",Array.isArray(model.allowed_views)&&model.allowed_views.length===0);
  host.querySelectorAll(".nav-btn").forEach(node=>{node.classList.toggle("hidden",Array.isArray(model.allowed_views)&&!model.allowed_views.includes(node.dataset.view));const active=node.dataset.view===model.active_view;node.classList.toggle("active",active);if(active)node.setAttribute("aria-current","page");else node.removeAttribute("aria-current");});
}
export function mountShell(host, model = {}) {
  host.innerHTML=renderShell(model);updateShell(host,model);return host;
}
export function bindShell(host, callbacks = {}) {
  const handlers=typeof callbacks === "function" ? {onAction:callbacks} : callbacks;
  const signal=new AbortController();
  const emit=(action,data,event)=>handlers.onAction?.(action,data,event);
  const closePickers=except=>host.querySelectorAll(".app-select").forEach(picker=>{if(picker!==except){picker.querySelector(".app-select-menu")?.classList.add("hidden");picker.querySelector(".app-select-trigger")?.setAttribute("aria-expanded","false");}});
  const click=event=>{
    handlers.onInteraction?.("click",event);
    const node=event.target.closest("[data-action],[data-close],#accountBtn,#teamSearchBtn,#entityBack,#entityClose,#confirmCancel,#confirmAction");
    if(!node || !host.contains(node)) {closePickers();return;}
    if(node.disabled||node.getAttribute("aria-disabled")==="true")return;
    const action=node.dataset.action ?? (node.dataset.close ? "close-modal" : {accountBtn:"settings",teamSearchBtn:"search",entityBack:"back",entityClose:"close-detail",confirmCancel:"discard-cancel",confirmAction:"discard-confirm"}[node.id]);
    if(action==="picker-toggle") {
      const picker=node.closest(".app-select"),menu=picker.querySelector(".app-select-menu");closePickers(picker);
      const open=menu.classList.contains("hidden");menu.classList.toggle("hidden",!open);node.setAttribute("aria-expanded",String(open));if(open)menu.querySelector('[aria-selected="true"],button')?.focus();return;
    }
    if(node.closest(".app-select-menu")) {closePickers();node.closest(".app-select")?.querySelector(".app-select-trigger")?.focus();}
    emit(action,{...node.dataset,...(node.dataset.close ? {id:node.dataset.close} : {})},event);
  };
  host.addEventListener("click",click,{signal:signal.signal});
  host.addEventListener("submit",event=>{const form=event.target.closest("form");if(!form)return;event.preventDefault();handlers.onSubmit?.(form.dataset.form ?? form.id,new FormData(form),event);},{signal:signal.signal});
  host.addEventListener("input",event=>{const node=event.target.closest("[data-input],form input,form select,form textarea");if(node)handlers.onInput?.(node.dataset.input??node.name,node.type==="checkbox" ? node.checked : node.value,event);},{signal:signal.signal});
  host.addEventListener("change",event=>{const node=event.target.closest("[data-change]");if(node)emit(node.dataset.change,{...node.dataset,value:node.type==="checkbox" ? node.checked : node.value},event);},{signal:signal.signal});
  host.addEventListener("keydown",event=>{
    if(event.key==="Escape"){closePickers();emit("back",{},event);return;}
    const option=event.target.closest('.app-select-menu [role="option"]');
    if(option && ["ArrowDown","ArrowUp","Home","End"].includes(event.key)) {event.preventDefault();const buttons=[...option.closest(".app-select-menu").querySelectorAll('[role="option"]')],i=buttons.indexOf(option),next=event.key==="Home" ? 0 : event.key==="End" ? buttons.length-1 : (i+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();return;}
    handlers.onInteraction?.("keydown",event);
    const row=event.target.closest('tr[data-action]');if(row && event.key==="Enter"){event.preventDefault();emit(row.dataset.action,{...row.dataset},event);}
  },{signal:signal.signal});
  host.addEventListener("toggle",event=>handlers.onInteraction?.("toggle",event),{signal:signal.signal,capture:true});
  for(const name of ["dragstart","dragover","drop","dragend","pointerdown","pointerup","pointercancel"]) host.addEventListener(name,event=>handlers.onInteraction?.(name,event),{signal:signal.signal});
  return ()=>signal.abort();
}
export function setDetail(host, { title = "", bodyHTML = "", actionsHTML = "", can_back = false, open = true } = {}) {
  const entity=host.querySelector("#entity");entity?.classList.toggle("hidden",!open);
  const heading=host.querySelector("#entityTitle");if(heading)heading.textContent=title;
  const body=host.querySelector("#entityBody");if(body)body.innerHTML=bodyHTML;
  const actions=host.querySelector("#entityActions");if(actions)actions.innerHTML=actionsHTML;
  host.querySelector("#entityBack")?.classList.toggle("hidden",!can_back);
}
