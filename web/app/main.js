import { RequestCoordinator, RevisionRefresh, AppError } from "./transport.js";
import { mountShell, updateShell, bindShell, applyTheme, setDetail } from "../ui-original/shell.js";
import * as screens from "../ui-original/screens.js";
import * as forms from "../ui-original/forms.js";
import { escapeHTML as e, button, icon, empty, pickerHTML, moreButton, formatDate, unwrap, safeImageURL } from "../ui-original/presentation.js";
import { bindSwipe, animateDateView } from "../ui-original/interactions.js";

const defaultRoutes = {
  bootstrap:"/api/bootstrap", overview:"/api/overview", schedule:"/api/schedule", calendar:"/api/calendar", revisions:"/api/revisions",
  accounts:"/api/accounts", ownerInitialize:"/api/owner/initialize", ownerLogin:"/api/owner/login", ownerLogout:"/api/owner/logout",
  teamsnapConfig:"/api/accounts/teamsnap/config", teamsnapAuthorize:"/api/accounts/teamsnap/authorize", teamsnapCallback:"/api/accounts/teamsnap/callback",
  traceStart:"/api/accounts/trace/start", traceVerify:"/api/accounts/trace/verify", teams:"/api/teams",
};
const pageItems = value => Array.isArray(value) ? value : value?.items ?? [];
const addDays = (value,offset) => {const date=new Date(value+"T12:00:00Z");date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
const localDay = (timezone="America/Los_Angeles") => {const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
const fullCalendarRange = day => {const first=day.slice(0,7)+"-01",weekday=new Date(first+"T12:00:00Z").getUTCDay(),from=addDays(first,-weekday);return {from,to:addDays(from,42)};};
const monthStep = (day,offset) => {const date=new Date(day.slice(0,7)+"-01T12:00:00Z");date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,10);};

/** Mount only from the isolated build's explicit entry. No source collection runs here. */
export function createApp({host=document.body,fetcher=fetch,routes={},handlers={}}={}) {
  routes={...defaultRoutes,...routes};
  const viewerToken=location.pathname.startsWith("/view/") ? location.pathname.split("/")[2] : null;
  const transport=new RequestCoordinator((path,options)=>fetcher(path,{...options,headers:{...options.headers,...(viewerToken ? {"x-view-key":viewerToken} : {})}}));
  const state={bootstrap:null,team:null,season:null,view:"overview",filters:{mode:"day",type:"all",period:"all",date:localDay(),sort:"date",direction:"asc"},model:null,routeEpoch:0,details:[],modal:null,editorDirty:false,traceAttempt:null,attachChoice:null,theme:"light",active:false,teamCatalog:null,seasonCatalog:null};
  const refresh=new RevisionRefresh(transport,()=>reloadVisible(),error=>showError(error));
  const discoveryTransport=new RequestCoordinator((path,options)=>fetcher(path,{...options,headers:{...options.headers,...(viewerToken ? {"x-view-key":viewerToken} : {})}}));
  const discoveryRefresh=new RevisionRefresh(discoveryTransport,()=>refreshAccountChooser(),error=>showError(error));
  let unbind=null,gestureCleanup=null,modalGestureCleanup=null,pendingDiscard=null,historyHandling=false,toastTimer=null;
  const logoCache=new Map();
  const root=()=>host.querySelector("#root"), role=()=>state.bootstrap?.session?.role??"anonymous";
  const categories=()=>new Set(role()==='owner'?['overview','schedule','competitions','team','bookmarks','reports','matches','players']:state.bootstrap?.session?.categories??[]);
  const canView=view=>role()==='owner'||(role()==='viewer'&&categories().has(view));
  const canDetail=kind=>role()==='owner'||(role()==='viewer'&&(kind==='team'?['team','competitions','matches'].some(v=>categories().has(v)):categories().has(kind==='match'||kind==='match-player'?'matches':kind==='player'?'players':'competitions')));
  function applyCapabilities(){if(role()!=='viewer')return;for(const node of host.querySelectorAll('[data-action="match"],[data-action="match-player"],[data-action="player"],[data-action="competition"],[data-action="team"]')){const allowed=node.dataset.action==='team'&&state.bootstrap.teams.some(t=>t.id===node.dataset.id)?canView('team'):canDetail(node.dataset.action);if(node.tagName==='BUTTON')node.disabled=!allowed;node.setAttribute('aria-disabled',String(!allowed));if(node.tagName==='TR'&&!allowed){node.classList.remove('click');node.tabIndex=-1;}}}
  const selectedTeam=()=>state.bootstrap?.teams?.find(team=>team.id===state.team);
  const selectedSeason=()=>selectedTeam()?.seasons?.find(season=>season.id===state.season);
  const context=()=>({team_id:state.team,team_season_id:state.season});
  const pathFor=(path,params={})=>path+"?"+new URLSearchParams(Object.entries({...context(),...params}).filter(([,value])=>value!=null));
  const needsInitialization=()=>!!state.bootstrap?.setup&&(state.bootstrap.setup.state!=="ready"||state.bootstrap.setup.owner_ready===false);
  const shellModel=()=>({mode:role()!=="anonymous" ? "dashboard" : "login",version:state.bootstrap?.version??"",owner_login:location.pathname.startsWith("/admin"),needs_initialization:needsInitialization(),teams:(state.bootstrap?.teams??[]).map(team=>({value:team.id,label:team.name,group:team.group??"My team",logo:team.display_logo??team.logo_url??null})),selected_team_id:state.team,seasons:(selectedTeam()?.seasons??[]).map(season=>({value:season.id,label:season.label})),selected_season_id:state.season,active_view:state.view,owner:role()==="owner",allowed_views:["overview","schedule","competitions","team","bookmarks"].filter(canView),team_catalog:state.teamCatalog,season_catalog:state.seasonCatalog,login_title:needsInitialization() ? "Initialize myTS" : "Owner console",login_help:state.bootstrap?.setup?.state==="ready"&&state.bootstrap.setup.owner_ready===false ? "Finish owner access with the configured owner password." : needsInitialization() ? "Use the configured owner password to initialize this installation." : undefined});
  const notice=message=>{clearTimeout(toastTimer);const node=host.querySelector("#toast");if(node){node.textContent=message;node.classList.remove("hidden");toastTimer=setTimeout(()=>node.classList.add("hidden"),4500);}};
  function showError(error,{target=null}={}) {
    if(error?.name==="AbortError")return;
    const message=error?.message??"The request failed.";
    if(target)target.innerHTML=`<div class="login-error" role="alert">${e(message)}</div>`;
    else notice(message);
    handlers.onError?.(error,api);
    if(error?.status===401 && role()!=="anonymous"){logoCache.clear();handlers.closeDetail?.(api);refresh.stop();closeModal();state.details=[];state.bootstrap={...state.bootstrap,session:{role:"anonymous"},teams:[]};state.team=null;state.season=null;transport.select({role:"anonymous"});discoveryTransport.select({role:"anonymous"});setDetail(host,{open:false,bodyHTML:"",actionsHTML:""});host.querySelector("#accountBody").innerHTML="";updateShell(host,{...shellModel(),login_error:message});}
  }
  function guarded(epoch,result) {return !result.discarded && epoch===state.routeEpoch && state.active;}
  function requireOwner(){if(role()!=="owner")throw new AppError("Sign in as the owner to manage this team.","owner_required",403);}
  function updateContext(team,season){logoCache.clear();handlers.contextChanged?.(api);state.team=team;state.season=season;state.details=[];setDetail(host,{open:false,bodyHTML:"",actionsHTML:""});closeModal();state.model=null;state.routeEpoch++;const today=localDay(selectedTeam()?.timezone),bounds=selectedSeason();state.filters.date=bounds?.start_day&&today<bounds.start_day ? bounds.start_day : bounds?.end_day&&today>=bounds.end_day ? addDays(bounds.end_day,-1) : today;transport.select({role:role(),team_id:team,team_season_id:season,viewer:!!viewerToken});discoveryTransport.select({role:role(),team_id:team,team_season_id:season});refresh.stop();updateShell(host,shellModel());}
  async function protectedLogo(ref){if(!ref?.team_id)return null;const key=`${role()}:${ref.club_id??ref.team_id}:${ref.revision??0}`;if(!logoCache.has(key)){if(logoCache.size>=50)logoCache.delete(logoCache.keys().next().value);logoCache.set(key,transport.read('logo:'+key,`/api/teams/${encodeURIComponent(ref.team_id)}/logo`).then(result=>result.discarded?null:safeImageURL(unwrap(result.data).logo)).catch(error=>{if(error.name==='AbortError')return null;return null;}));}return logoCache.get(key);}
  async function hydrateModel(envelope){const epoch=state.routeEpoch,m=unwrap(envelope),events=[...(m.event?[m.event]:[]),...pageItems(m.events),...pageItems(m.items),...pageItems(m.matches),...pageItems(m.next_event?[m.next_event]:[]),...(m.latest_result?[m.latest_result]:[]),...(m.competitions?.items??[]).flatMap(c=>pageItems(c.events))];const refs=[];for(const event of events)for(const side of [event.home,event.away])if(side?.logo_ref)refs.push(side);for(let offset=0;offset<refs.length;offset+=4){await Promise.all(refs.slice(offset,offset+4).map(async side=>{const logo=await protectedLogo(side.logo_ref);if(epoch===state.routeEpoch&&state.active&&logo)side.logo=logo;}));if(epoch!==state.routeEpoch)return envelope;}return envelope;}
  async function hydrateCatalog(){const epoch=state.routeEpoch,rows=(state.bootstrap?.teams??[]).filter(t=>t.owner_logo_available);for(let offset=0;offset<rows.length;offset+=4){await Promise.all(rows.slice(offset,offset+4).map(async team=>{const logo=await protectedLogo({team_id:team.id,club_id:team.club_id,revision:team.logo_revision});if(epoch===state.routeEpoch&&state.active)team.display_logo=logo;}));if(epoch!==state.routeEpoch)return;}if(epoch===state.routeEpoch&&state.active)updateShell(host,shellModel());}
  async function readSeasons(teamId,{cursor=null,trail=[],preferred=teamId===state.team?state.season:null}={}){
    const epoch=state.routeEpoch,params=new URLSearchParams({limit:'25',...(cursor?{cursor}:{}),...(preferred?{preferred_season_id:preferred}:{})}),result=await transport.read('season-catalog',`${routes.teams}/${encodeURIComponent(teamId)}/seasons?${params}`);if(!guarded(epoch,result))return null;
    const page=unwrap(result.data),rows=[...page.items??[]],pin=page.preferred_season??selectedTeam()?.seasons?.find(s=>s.id===preferred);if(pin&&!rows.some(s=>s.id===pin.id))rows.push(pin);
    return {rows,catalog:{team_id:teamId,total:page.total,revision:page.revision,next_cursor:page.next_cursor,cursor,trail,has_previous:trail.length>0}};
  }
  async function prepareContext(teamId,seasonId=null){
    const epoch=state.routeEpoch;let team=state.bootstrap.teams?.find(t=>t.id===teamId);
    if(!team){requireOwner();const result=await transport.read('team-context',routes.teams+'?'+new URLSearchParams({limit:'50',preferred_team_id:teamId}));if(!guarded(epoch,result))return null;team=unwrap(result.data).preferred_team;if(!team)throw new AppError('That team is no longer available.','team_forbidden',403);}
    let seasons=team.seasons??[],catalog=teamId===state.seasonCatalog?.team_id?state.seasonCatalog:null;
    if(!seasons.length||(seasonId&&!seasons.some(s=>s.id===seasonId))){const loaded=await readSeasons(teamId,{preferred:seasonId});if(!loaded)return null;seasons=loaded.rows;catalog=loaded.catalog;}
    const season=seasons.find(s=>s.id===seasonId)??(!seasonId?seasons[0]:null);if(!season)throw new AppError('That season is no longer available.','season_forbidden',403);
    return {team:{...team,seasons},season,catalog};
  }
  function installContext(prepared){const pinned=prepared.team;state.bootstrap.teams=[...(state.bootstrap.teams??[]).filter(t=>t.id!==pinned.id).slice(0,50).map(t=>({...t,seasons:[]})),pinned];state.seasonCatalog=prepared.catalog;updateContext(pinned.id,prepared.season.id);}
  async function teamsPage(cursor=null,trail=[]){requireOwner();const epoch=state.routeEpoch,result=await transport.read('team-catalog',routes.teams+'?'+new URLSearchParams({limit:'50',...(cursor?{cursor}:{}),...(state.team?{preferred_team_id:state.team}:{})}));if(!guarded(epoch,result))return false;const model=unwrap(result.data),selected=selectedTeam(),pin=model.preferred_team?{...model.preferred_team,seasons:selected?.seasons??[]}:selected,teams=(model.items??[]).map(t=>t.id===pin?.id?{...t,...pin}:{...t,seasons:[]});if(pin&&!teams.some(t=>t.id===pin.id))teams.push(pin);state.bootstrap.teams=teams;state.teamCatalog={total:model.total,revision:model.revision,next_cursor:model.next_cursor,cursor,trail,has_previous:trail.length>0};await hydrateCatalog();updateShell(host,shellModel());return true;}
  async function seasonsPage(cursor=null,trail=[]){const loaded=await readSeasons(state.team,{cursor,trail});if(!loaded)return;selectedTeam().seasons=loaded.rows;state.seasonCatalog=loaded.catalog;updateShell(host,shellModel());}
  function selection(){return {...context(),...state.filters};}
  function captureRoute(){return {team:state.team,season:state.season,view:state.view,filters:{...state.filters},scroll:root()?.scrollTop??0};}
  function scopeMatches(route){return route.team===state.team&&route.season===state.season;}
  async function restoreDetailOrigin(detail){const origin=detail?.origin;if(!origin||scopeMatches(origin))return;const prepared=await prepareContext(origin.team,origin.season);if(!prepared)return;installContext(prepared);state.view=origin.view;state.filters={...state.filters,...origin.filters};await renderView();root().scrollTop=origin.scroll??0;void refresh.start(pathFor(routes.revisions));}
  function saveHistory(replace=false){if(historyHandling)return;const value={mytsUi:true,route:{...captureRoute(),details:state.details.slice(-20)}};history[replace ? "replaceState" : "pushState"](value,"");}
  function resolveDiscard(accepted){const pending=pendingDiscard;pendingDiscard=null;host.querySelector("#confirmModal").classList.add("hidden");if(accepted)state.editorDirty=false;pending?.resolve(accepted);}
  async function canLeave(){
    if(!state.editorDirty)return true;
    if(handlers.beforeNavigate)return !!await handlers.beforeNavigate(api);
    if(pendingDiscard)return pendingDiscard.promise;
    const modal=host.querySelector("#confirmModal");host.querySelector("#confirmTitle").textContent="Discard unsaved changes?";host.querySelector("#confirmText").textContent="Your changes have not been saved. Keep editing or discard them before leaving.";host.querySelector("#confirmCancel").textContent="Keep editing";host.querySelector("#confirmAction").textContent="Discard";modal.classList.remove("hidden");
    let resolve;const promise=new Promise(done=>resolve=done);pendingDiscard={promise,resolve};modal.querySelector("#confirmCancel")?.focus();return promise;
  }
  async function restoreHistory(event){
    const route=event.state?.mytsUi&&event.state.route;if(!route||!state.active||role()==="anonymous"||!canView(route.view))return;
    if(!await canLeave()){saveHistory();return;}
    const prepared=await prepareContext(route.team,route.season);if(!prepared)return;
    historyHandling=true;
    try{installContext(prepared);state.filters={...state.filters,...route.filters};state.view=route.view;state.details=(route.details??[]).filter(detail=>canDetail(detail.kind));await renderView();root().scrollTop=route.scroll??0;const detail=state.details.at(-1);if(detail&&handlers.openDetail)await handlers.openDetail(detail,api);else setDetail(host,{open:false});void refresh.start(pathFor(routes.revisions));}catch(error){showError(error);}finally{historyHandling=false;}
  }
  async function bootstrap(){
    const result=await transport.read("bootstrap",routes.bootstrap+(state.team?"?"+new URLSearchParams({preferred_team_id:state.team,...(state.season?{preferred_season_id:state.season}:{})}):""));if(result.discarded)return;
    const model=unwrap(result.data);if(model.selected_team&&!model.teams?.some(t=>t.id===model.selected_team.id))model.teams=[...model.teams??[],model.selected_team];if(model.selected_team){const row=model.teams.find(t=>t.id===model.selected_team.id);if(!row.seasons)row.seasons=[];if(model.selected_season&&!row.seasons.some(s=>s.id===model.selected_season.id))row.seasons.push(model.selected_season);}state.teamCatalog=model.team_catalog?{...model.team_catalog,cursor:null,trail:[],has_previous:false}:null;state.seasonCatalog=model.season_catalog?{...model.season_catalog,cursor:null,trail:[],has_previous:false}:null;state.bootstrap=model;state.theme=model.preferences?.theme??state.theme;applyTheme(state.theme);
    const team=model.teams?.find(t=>t.id===state.team)??model.teams?.find(t=>t.id===(model.selected_team?.id??model.selection?.team_id??model.selected_team_id))??model.teams?.[0];
    const season=team?.seasons?.find(s=>s.id===state.season)??team?.seasons?.find(s=>s.id===(model.selected_season?.id??model.selection?.team_season_id??model.selected_season_id))??team?.seasons?.[0];
    updateContext(team?.id??null,season?.id??null);if(role()==="viewer"&&!canView(state.view))state.view=["overview","schedule","competitions","team","bookmarks","reports"].find(canView)??"unavailable";
    if(role()==="anonymous"){root().innerHTML="";setDetail(host,{open:false,bodyHTML:"",actionsHTML:""});host.querySelector("#accountBody").innerHTML="";saveHistory(true);return;}
    if(!state.team){root().innerHTML=role()==="owner"?`${empty("Connect an account and choose your team.")}<div class="action-row">${button("source-manage","Connect TeamSnap",{data:{provider:"teamsnap"}})}${button("source-manage","Connect Trace",{data:{provider:"trace"}})}${button("search","Find a GotSport team")}</div>`:empty("This shared team is no longer available.");saveHistory(true);return;}
    await renderView();void hydrateCatalog();saveHistory(true);void refresh.start(pathFor(routes.revisions));
  }
  async function scheduleNeighbors(day=state.filters.date){
    const current=selectedSeason(),year=current?.year??Number(current?.start_day?.slice(0,4));
    const needed={previous:!!current?.start_day&&addDays(day,-3)<current.start_day,next:!!current?.end_day&&addDays(day,3)>=current.end_day},neighbors={};
    const inspect=rows=>{for(const side of ["previous","next"]){const target=year+(side==="previous"?-1:1);neighbors[side]??=rows.find(season=>(season.year??Number(season.start_day?.slice(0,4)))===target)??null;}};
    inspect(selectedTeam()?.seasons??[]);if(!Object.keys(needed).some(side=>needed[side]&&!neighbors[side])||!state.seasonCatalog?.next_cursor&&!state.seasonCatalog?.cursor)return neighbors;
    const epoch=state.routeEpoch,captured=context(),seen=new Set();let cursor=null;
    do{const page=await readSeasons(captured.team_id,{cursor,preferred:captured.team_season_id});if(!page||epoch!==state.routeEpoch||captured.team_id!==state.team||captured.team_season_id!==state.season)return null;inspect(page.rows);cursor=page.catalog.next_cursor;if(cursor){if(seen.has(cursor))throw new AppError("The season list changed. Reopen Schedule.","cursor_restart",409);seen.add(cursor);}}while(cursor&&Object.keys(needed).some(side=>needed[side]&&!neighbors[side]));
    return neighbors;
  }
  const scheduleDay=day=>{const season=selectedSeason();return season?.start_day&&day<season.start_day?season.start_day:season?.end_day&&day>=season.end_day?addDays(season.end_day,-1):day;};
  function scheduleModel(envelope,calendarEnvelope=null,neighbors={}){
    const page=unwrap(envelope),selection=envelope.selection??selection(),calendarData=unwrap(calendarEnvelope),counts=new Map((calendarData.days??[]).map(day=>[day.day,day]));
    const date=selection.date??state.filters.date,bounds=selectedSeason(),days=[];let previous=false,next=false;
    for(let i=-3;i<=3;i++){const day=addDays(date,i);if(bounds?.start_day&&day<bounds.start_day){if(!previous)days.push({label:"Previous",season_id:neighbors.previous?.id,available:!!neighbors.previous,boundary:"end"});previous=true;continue;}if(bounds?.end_day&&day>=bounds.end_day){if(!next)days.push({label:"Next",season_id:neighbors.next?.id,available:!!neighbors.next,boundary:"start"});next=true;continue;}const count=counts.get(day);days.push({day,today:day===localDay(selection.timezone),kinds:count?.kinds??[],total:count?.total??0});}
    return {...envelope,data:{mode:selection.mode,filter:selection.type,period:selection.period,selected_day:date,month_label:formatDate(date,{month:"short",day:undefined}),season_label:selectedSeason()?.label,days,events:page}};
  }
  async function renderView({append=false,cursor=null}={}){
    if(!state.team||!state.season)return;if(!canView(state.view)){root().innerHTML=empty("No dashboard sections are available through this viewer link.");updateShell(host,shellModel());return;}
    const epoch=++state.routeEpoch,captured=captureRoute();gestureCleanup?.();gestureCleanup=null;
    root().setAttribute("aria-busy","true");
    try{
      const route=routes[state.view];
      if(!route){root().innerHTML=empty("This dashboard section is unavailable.");return;}
      const params={...(state.view==="schedule" ? state.filters : {}),...(handlers.viewParams?.(state.view,api)??{}),...(cursor?{cursor}:{})};
      const result=await transport.read("view",pathFor(route,params));if(!guarded(epoch,result)||!scopeMatches(captured))return;
      let envelope=await hydrateModel(result.data);if(!guarded(epoch,result))return;
      if(append && state.model){if(handlers.append)envelope=handlers.append(state.view,state.model,envelope,api);else{const old=unwrap(state.model),page=unwrap(envelope);if(!Array.isArray(old.items)||!Array.isArray(page.items))throw new AppError("This saved list cannot load a further page.","page_contract");envelope={...envelope,data:{...page,items:[...old.items,...page.items]}};}}
      state.model=envelope;
      if(handlers.present?.[state.view]){const markup=await handlers.present[state.view](envelope,api);if(!guarded(epoch,result))return;root().innerHTML=markup;}
      else if(state.view==="overview")root().innerHTML=screens.overview({...envelope,data:{...unwrap(envelope),team_name:selectedTeam()?.name}});
      else if(state.view==="schedule"){
        const range={from:addDays(state.filters.date,-3),to:addDays(state.filters.date,4)},cal=await transport.read("calendar-counts",pathFor(routes.calendar,{...state.filters,...range}));if(!guarded(epoch,cal))return;
        const neighbors=await scheduleNeighbors();if(!neighbors||!guarded(epoch,cal))return;root().innerHTML=screens.schedule(scheduleModel(envelope,cal.data,neighbors));root().classList.toggle("schedule-day-view",state.filters.mode==="day");
        const gestures=[".schedule-day-surface",".schedule-date-window"].map(selector=>root().querySelector(selector)).filter(Boolean).map(node=>bindSwipe(node,{onStep:direction=>void action("day",{day:addDays(state.filters.date,direction)})}));gestureCleanup=()=>gestures.forEach(cleanup=>cleanup());
      }else if(screens[state.view])root().innerHTML=screens[state.view](envelope);
      else if(handlers.renderView){const markup=await handlers.renderView(state.view,envelope,{state,context:context()});if(!guarded(epoch,result))return;root().innerHTML=markup;}
      else root().innerHTML=empty("This dashboard section is unavailable.");
      updateShell(host,shellModel());applyCapabilities();
      if(unwrap(envelope).windowed)root().insertAdjacentHTML('afterbegin',`<p class="scope-caption">Showing the latest 200 loaded rows. Full totals cover this selection. ${button('list-restart','Return to first page',{className:'text-action'})}</p>`);
      if(envelope.projection_pending)root().insertAdjacentHTML("afterbegin",'<p class="scope-caption" role="status">Saved data is updating in the background.</p>');
    }catch(error){if(epoch!==state.routeEpoch)return;if(error.code==="cursor_restart"&&cursor){notice("The list changed. Reloading this selection.");return renderView();}showError(error,{target:root()});}
    finally{if(epoch===state.routeEpoch)root()?.removeAttribute("aria-busy");}
  }
  function openModal({title="",html="",kind="custom",data={}}){
    modalGestureCleanup?.();modalGestureCleanup=null;state.routeEpoch++;const modal=host.querySelector("#accountModal");host.querySelector("#accountModalTitle").textContent=title;host.querySelector("#accountBody").innerHTML=html;modal.classList.remove("hidden");state.modal={kind,data};applyCapabilities();modal.querySelector("input,select,button")?.focus();
  }
  function closeModal(){modalGestureCleanup?.();modalGestureCleanup=null;state.routeEpoch++;host.querySelectorAll(".modal").forEach(modal=>modal.classList.add("hidden"));if(pendingDiscard)resolveDiscard(false);discoveryRefresh.stop();state.modal=null;state.traceAttempt=null;state.attachChoice=null;}
  async function settings(){
    const epoch=state.routeEpoch;let accounts=[];
    if(role()==="owner"){const result=await transport.read("accounts",routes.accounts);if(!guarded(epoch,result))return;accounts=unwrap(result.data).accounts??[];}
    const providers=role()==="owner" ? ["teamsnap","gotsport","trace"].map(provider=>{const account=accounts.find(a=>a.provider===provider);return {provider,label:{teamsnap:"TeamSnap",gotsport:"GotSport",trace:"Trace"}[provider],state:account?.authorization_state??"disconnected",status_label:account?.status_label??(account ? "Authorization connected · update status unavailable" : "Not connected")};}) : state.bootstrap.providers??[];
    openModal({title:"Settings",kind:"settings",html:screens.settingsBody({owner:role()==="owner",theme:state.theme,version:state.bootstrap.version,providers,has_team:!!state.team,can_reports:!!state.team&&canView("reports")})});
  }
  async function manageSource(provider){
    requireOwner();
    if(provider==="trace"){openModal({title:"Connect Trace",kind:"trace-auth",html:forms.traceLogin({})});return;}
    if(provider==="gotsport"){openModal({title:"Find a GotSport team",kind:"source-search",html:forms.gotSportSearch({})});return;}
    const epoch=state.routeEpoch,result=await transport.read("teamsnap-config",routes.teamsnapConfig);if(!guarded(epoch,result))return;const config=unwrap(result.data);
    openModal({title:"TeamSnap · Manage",kind:"teamsnap-auth",html:`<form data-form="teamsnap-authorize">${config.requires_client_id ? `<div class="field">${forms.inputField("client_id","TeamSnap Client ID",config.client_id??"",{required:true})}<p class="login-help">Only needed for the first TeamSnap connection. The redirect URL is this site's <b>/admin</b> page.</p></div>` : ""}<div class="action-row"><button class="btn primary" type="submit">${config.requires_client_id ? "Connect TeamSnap" : "Reconnect TeamSnap"}</button>${button("account-teams","Choose a team",{data:{provider}})}</div></form>`});
  }
  async function authorizeTeamSnap(clientId){requireOwner();const result=await transport.command(routes.teamsnapAuthorize,clientId ? {client_id:clientId} : {});if(result.discarded)return;const url=new URL(result.data.authorization_url);if(url.protocol!=="https:"||url.hostname!=="auth.teamsnap.com")throw new AppError("TeamSnap returned an invalid sign-in address.","oauth_url_invalid");location.assign(url.href);}
  async function oauthReturn(){
    const values=new URLSearchParams(location.hash.slice(1));if(!values.has("access_token")&&!values.has("error"))return false;
    const callback={state:values.get("state"),access_token:values.get("access_token"),token_type:values.get("token_type"),expires_in:values.get("expires_in"),error:values.get("error"),error_description:values.get("error_description")};
    history.replaceState(history.state,"",location.pathname+location.search);
    try{await transport.command(routes.teamsnapCallback,callback);await bootstrap();await accountTeams("teamsnap");return true;}finally{for(const key of Object.keys(callback))callback[key]=null;}
  }
  async function accountTeams(provider,accountId=null,{cursor=null,trail=[],poll=true}={}){
    requireOwner();const epoch=state.routeEpoch;let id=accountId;
    if(!id){const accounts=await transport.read("accounts",routes.accounts);if(!guarded(epoch,accounts))return;id=unwrap(accounts.data).accounts?.find(a=>a.provider===provider&&a.active!==false)?.id;}
    if(!id){await manageSource(provider);return;}
    const params=new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}),result=await transport.read("source-teams",`${routes.accounts}/${encodeURIComponent(id)}/teams?${params}`);if(!guarded(epoch,result))return;const model=unwrap(result.data),teams=model.teams??model.items??[];
    openModal({title:"Choose team",kind:"source-teams",data:{provider,account_id:id,teams,cursor,trail,next_cursor:model.next_cursor},html:forms.candidateTeams({provider,account_id:id,teams,pending:["queued","running"].includes(model.discovery?.state),message:`${model.total??teams.length} accessible teams · ${model.discovery?.state??'catalog saved'}`})+`<div class="action-row">${trail.length?button('account-teams-previous','Previous teams'):''}${model.next_cursor?button('account-teams-more','Next teams',{data:{cursor:model.next_cursor}}):''}</div>`});
    if(poll)void discoveryRefresh.start(`${routes.accounts}/${encodeURIComponent(id)}/revisions`);
  }
  async function refreshAccountChooser(){const chooser=state.modal;if(chooser?.kind!=="source-teams"||!chooser.data.account_id)return;try{await accountTeams(chooser.data.provider,chooser.data.account_id,{cursor:chooser.data.cursor,trail:chooser.data.trail,poll:false});}catch(error){if(error.code==='cursor_restart'){notice('Your team catalog changed. Showing its first page.');await accountTeams(chooser.data.provider,chooser.data.account_id,{poll:false});}else throw error;}}
  const attachmentTeams=()=>{const team=state.attachChoice?.destinationTeam;return [...(state.bootstrap.teams??[]).filter(t=>t.id!==team?.id),...(team?[team]:[])];};
  function attachmentDraft(){const node=host.querySelector('form[data-form="source-attach"]');return node?{destination:node.elements.destination.value,name:node.elements.name?.value,season_year:node.elements.season_year?.value,kind:node.elements.kind?.value}:{};}
  function renderAttachment(choice,values={}){
    const source=choice.source,year=Number(state.filters.date.slice(0,4))-(Number(state.filters.date.slice(5,7))<6?1:0),destination=values.destination??(state.team&&state.season?state.team+':'+state.season:''),teams=attachmentTeams(),catalog=choice.destinationCatalog??(choice.destinationTeam?.id===state.team?state.seasonCatalog:null);
    const options=teams.map(t=>`<optgroup label="${e(t.name)}">${t.seasons?.length?t.seasons.map(season=>{const key=t.id+':'+season.id;return `<option value="${e(key)}"${key===destination?' selected':''}>${e(t.name)} · ${e(season.label)}</option>`;}).join(''):`<option value="${e(t.id+':')}">${e(t.name)} · Choose season</option>`}</optgroup>`).join('');
    const kind=choice.provider==='gotsport'?`<label>Team group<select name="kind"><option value="own"${values.kind!=='followed'?' selected':''}>My team</option><option value="followed"${values.kind==='followed'?' selected':''}>Followed team</option></select></label>`:'';
    openModal({title:'Connect team',kind:'source-attach',html:`<p class="modal-copy">${e(source.name)}</p><form data-form="source-attach"><div class="edit-fields"><label>Destination<select name="destination"><option value=""${destination===''?' selected':''}>Create this team</option>${options}</select></label></div><div class="action-row">${state.teamCatalog?.has_previous?button('attachment-teams-previous','Previous teams'):''}${state.teamCatalog?.next_cursor?button('attachment-teams-more','More teams',{data:{cursor:state.teamCatalog.next_cursor}}):''}${catalog?.has_previous?button('attachment-seasons-previous','Previous seasons'):''}${catalog?.next_cursor?button('attachment-seasons-more','Older destination seasons',{data:{cursor:catalog.next_cursor}}):''}</div><div class="edit-fields" data-new-team-fields${destination?' hidden':''}>${kind}${forms.inputField('name','New team name',values.name??source.name,{required:true})}${forms.inputField('season_year','New season starts',values.season_year??year,{type:'number',min:2000,max:2200,required:true})}</div><div class="action-row"><button class="btn primary" type="submit">Connect team</button></div></form>`});toggleNewTeamFields();
  }
  function sourceTeamChoice(data){
    const m=state.modal?.data??{},source=m.teams?.find(t=>t.id===data.id);if(!source)throw new AppError('Choose a team from this account.','source_team_invalid');state.attachChoice={source,account_id:m.account_id??data.account,provider:m.provider??data.provider,destinationTeam:selectedTeam()??null,destinationCatalog:state.seasonCatalog};discoveryRefresh.stop();renderAttachment(state.attachChoice);
  }
  async function followSourceTeam(candidate){requireOwner();let source=candidate;if(candidate.provider!=='gotsport'||!candidate.official_url)throw new AppError('This public team has no verified follow link.','source_team_unverified');const epoch=state.routeEpoch,result=await transport.command('/api/sources/gotsport/resolve',{url:candidate.official_url});if(!guarded(epoch,result))return;const teams=unwrap(result.data).teams??[];source=teams.find(t=>t.id===candidate.id)??(teams.length===1?teams[0]:null);if(!source)throw new AppError('Choose this team from the verified public results.','source_team_unverified');state.attachChoice={source,account_id:null,provider:'gotsport',destinationTeam:selectedTeam()??null,destinationCatalog:state.seasonCatalog};renderAttachment(state.attachChoice,{destination:'',kind:'followed',name:source.name});}
  function toggleNewTeamFields(){const form=host.querySelector('form[data-form="source-attach"]'),group=form?.querySelector('[data-new-team-fields]');if(!group)return;const existing=!!form.elements.destination.value;group.hidden=existing;group.querySelectorAll('input,select').forEach(node=>node.disabled=existing);}
  async function destinationChanged(){
    const choice=state.attachChoice;if(!choice)return;const values=attachmentDraft(),destination=values.destination??'';toggleNewTeamFields();
    if(!destination){renderAttachment(choice,values);return;}
    if(!destination.endsWith(':'))return;
    const prepared=await prepareContext(destination.slice(0,-1));if(!prepared||state.attachChoice!==choice)return;choice.destinationTeam=prepared.team;choice.destinationCatalog=prepared.catalog;renderAttachment(choice,{...values,destination:prepared.team.id+':'+prepared.season.id});
  }
  async function attachmentCatalog(name,data){const choice=state.attachChoice;if(!choice)return;const values=attachmentDraft();if(name.includes('teams-')){const trail=[...state.teamCatalog?.trail??[]],cursor=name.endsWith('previous')?trail.pop()??null:data.cursor;if(!name.endsWith('previous'))trail.push(state.teamCatalog?.cursor??null);if(!await teamsPage(cursor,trail)||state.attachChoice!==choice)return;}else{const team=choice.destinationTeam??selectedTeam();if(!team)return;const current=choice.destinationCatalog??state.seasonCatalog,trail=[...current?.trail??[]],cursor=name.endsWith('previous')?trail.pop()??null:data.cursor;if(!name.endsWith('previous'))trail.push(current?.cursor??null);const selected=(team.seasons??[]).find(row=>team.id+':'+row.id===values.destination),loaded=await readSeasons(team.id,{cursor,trail,preferred:selected?.id});if(!loaded||state.attachChoice!==choice)return;choice.destinationTeam={...team,seasons:loaded.rows};choice.destinationCatalog=loaded.catalog;}renderAttachment(choice,values);}
  function showClubChoice(conflict){
    const choice=state.attachChoice;if(!choice?.pendingAttach)throw new AppError("Choose the provider team again.","source_team_invalid");
    choice.clubConflict=conflict;
    const model=conflict.club_choice,heading=model.kind==='logo'?'Choose the shared club logo':'Choose the club record';
    const cards=(model.choices??[]).map(option=>{const record=option.value==='current'?model.current:model.source,image=safeImageURL(record?.logo);return `<label class="card section"><span class="card-body"><input type="radio" name="keep" value="${e(option.value)}" required> <b>${e(option.label)}</b>${image?`<img src="${e(image)}" alt="${e(record?.name??'Club')}" style="width:48px;height:48px;object-fit:contain;vertical-align:middle;margin:4px">`:''}<span class="source-note">${e(record?.name??'Club')}<br>Applies to ${e(option.affected_team_count??option.affected_teams?.length??1)} teams: ${e((option.affected_teams??[]).map(team=>typeof team==='object'?team.name??team.label??team.id:team).join(', ')||'the selected team')}${option.affected_team_count>(option.affected_teams?.length??0)?' (first 20 shown)':''}</span></span></label>`;}).join('');
    openModal({title:heading,kind:'club-choice',html:`<p class="modal-copy">This source and your existing club have different saved records. Choose the record to keep before connecting the team.</p><form data-form="source-club-choice">${cards}<label class="source-note"><input type="checkbox" name="confirmed" required> I have reviewed the teams affected by this shared club choice.</label><div class="action-row"><button class="btn primary" type="submit">Use selected record & connect</button>${button('close-modal','Cancel')}</div></form>`});
  }
  async function commitAttachment(keep=null){
    requireOwner();const choice=state.attachChoice,pending=choice?.pendingAttach;if(!pending)throw new AppError('Choose the provider team again.','source_team_invalid');
    const epoch=state.routeEpoch,body={...pending.body};
    if(keep){const conflict=choice.clubConflict?.club_choice;if(!conflict||!(conflict.choices??[]).some(row=>row.value===keep))throw new AppError('Choose one of the saved club records.','club_choice_required');body.revision=conflict.expected.profile_revision;body.club_choice={kind:conflict.kind,keep,...conflict.expected};}
    let result;
    try{result=await transport.command(`${routes.teams}/${encodeURIComponent(pending.teamId)}/attachments`,body,{idempotencyKey:pending.requestId});}
    catch(error){if(epoch!==state.routeEpoch||state.attachChoice!==choice||!state.active)return;if(error.status===409&&error.details?.club_choice){showClubChoice(error.details);return;}throw error;}
    if(!guarded(epoch,result)||state.attachChoice!==choice)return;
    state.attachChoice=null;closeModal();state.team=pending.teamId;state.season=pending.seasonId;await bootstrap();notice('Team connected. Background updates are queued.');
  }
  async function attachSource(form){
    requireOwner();const choice=state.attachChoice;if(!choice)throw new AppError("Choose the provider team again.","source_team_invalid");if(choice.pendingAttach)return commitAttachment();const epoch=state.routeEpoch,destination=String(form.get("destination")??"");let teamId,seasonId;
    if(destination){const match=attachmentTeams().flatMap(team=>(team.seasons??[]).map(season=>({team,season,key:team.id+":"+season.id}))).find(row=>row.key===destination);if(!match)throw new AppError("Choose an available team and season.","team_forbidden");teamId=match.team.id;seasonId=match.season.id;}
    else{const requestId=crypto.randomUUID(),created=await transport.command(routes.teams,{name:String(form.get("name")??""),timezone:selectedTeam()?.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone,season_year:Number(form.get("season_year")),request_id:requestId},{idempotencyKey:requestId});if(!guarded(epoch,created)||state.attachChoice!==choice)return;const team=created.data.team??created.data;teamId=team.id;seasonId=team.season?.id??team.seasons?.[0]?.id??created.data.season_id;}
    if(!seasonId)throw new AppError("Choose a season before attaching this source.","season_required");
    choice.pendingAttach={teamId,seasonId,requestId:crypto.randomUUID(),body:{source_team_id:choice.source.id,account_id:choice.account_id,season_id:seasonId,...(!destination?{kind:form.get("kind")??"own"}:{})}};
    return commitAttachment();
  }
  async function calendar(){
    const epoch=state.routeEpoch,range=fullCalendarRange(state.filters.date),result=await transport.read("calendar-modal",pathFor(routes.calendar,{...state.filters,...range}));if(!guarded(epoch,result))return;
    const data=unwrap(result.data),counts=new Map((data.days??[]).map(d=>[d.day,d]));
    openModal({title:"Choose schedule date",kind:"calendar",html:screens.calendar({label:formatDate(state.filters.date,{month:"long",year:"numeric",day:undefined}),days:Array.from({length:42},(_,i)=>{const day=addDays(range.from,i),count=counts.get(day);return {day,selected:day===state.filters.date,today:day===localDay(selectedTeam()?.timezone),other_month:day.slice(0,7)!==state.filters.date.slice(0,7),kinds:count?.kinds??[],total:count?.total??0};})})});
    modalGestureCleanup=bindSwipe(host.querySelector("#accountBody .calendar-grid"),{disabled:()=>state.modal?.kind!=="calendar",onStep:direction=>void action("calendar-month",{offset:direction})});
  }
  async function reloadVisible(){
    if(state.editorDirty){notice("Saved data changed. Your unsaved edits are preserved.");return;}
    const modal=state.modal;await renderView();if(modal?.kind==="settings")await (handlers.actions?.settings ? handlers.actions.settings({},api) : settings());else if(modal?.kind==="calendar")await calendar();else if(modal&&handlers.refreshModal)await handlers.refreshModal(modal,api);if(handlers.refreshDetail&&state.details.length)await handlers.refreshDetail(state.details.at(-1),api);
  }
  async function action(name,data={}){
    try{
      if(name==="discard-confirm"||name==="discard-cancel"){resolveDiscard(name==="discard-confirm");return;}
      if(name==="back"&&pendingDiscard){resolveDiscard(false);return;}
      if(name==="close-modal"&&state.editorDirty&&["editor","inclusion","inclusion-reset","coach-editor","branding","branding-kits","branding-kits-reset","award-editor","team-editor","identity","tracks"].includes(state.modal?.kind)&&!await canLeave())return;
      if(["nav","team-select","season-select","season","close-detail","back","match","player","team","competition","match-player"].includes(name)&&!await canLeave())return;
      if(["detail-tab","analysis-team","analysis-period","analysis-kind","analysis-more","analysis-previous","lineup-edit","player-edit","match-edit","included-games","settings","source-manage","search","account-teams","branding-logo","branding-kits","branding-kits-reset","data-files","share-copy","status-open","usage","award-add","award-edit","team-rename","team-remove","source-identities","identity-evidence","identity-kind","trace-tracks"].includes(name)&&state.editorDirty&&!await canLeave())return;
      if(name==="nav"){if(!canView(data.view))throw new AppError("This dashboard section is not shared through this link.","share_scope_denied",403);handlers.closeDetail?.(api);state.view=data.view;state.details=[];setDetail(host,{open:false});closeModal();root()?.classList.remove("schedule-day-view");if(data.filter)state.filters.type=data.filter;if(data.period)state.filters.period=data.period;saveHistory();return renderView();}
      if(name==="team-select"){const prepared=await prepareContext(data.value);if(!prepared)return;installContext(prepared);saveHistory();await renderView();void refresh.start(pathFor(routes.revisions));return;}
      if(name==="season-select"||name==="season"){const prepared=await prepareContext(state.team,data.value);if(!prepared)return;installContext(prepared);if(data.boundary)state.filters.date=data.boundary==="start"?prepared.season.start_day:addDays(prepared.season.end_day,-1);saveHistory();await renderView();void refresh.start(pathFor(routes.revisions));return;}
      if(name==='teams-more')return teamsPage(data.cursor,[...state.teamCatalog?.trail??[],state.teamCatalog?.cursor??null]);
      if(name==='teams-previous'){const trail=[...state.teamCatalog?.trail??[]],cursor=trail.pop()??null;return teamsPage(cursor,trail);}
      if(name==='seasons-more')return seasonsPage(data.cursor,[...state.seasonCatalog?.trail??[],state.seasonCatalog?.cursor??null]);
      if(name==='seasons-previous'){const trail=[...state.seasonCatalog?.trail??[]],cursor=trail.pop()??null;return seasonsPage(cursor,trail);}
      if(name==="schedule-mode"){state.filters.mode=data.value;return renderView();}
      if(name==="schedule-filter"){state.filters.type=data.value;return renderView();}
      if(name==="schedule-period"){state.filters.period=data.value;return renderView();}
      if(name==="today"){state.filters.date=scheduleDay(localDay(selectedTeam()?.timezone));state.filters.mode="day";return renderView();}
      if(name==="day"){state.filters.date=scheduleDay(data.day);state.filters.mode="day";closeModal();await renderView();animateDateView(root().querySelector(".schedule-day-surface"));return;}
      if(name==="date-shift"){state.filters.date=scheduleDay(addDays(state.filters.date,Number(data.offset)));return renderView();}
      if(name==="calendar-month"){state.filters.date=monthStep(state.filters.date,Number(data.offset));return calendar();}
      if(name==="calendar")return calendar();
      if(name==="more")return handlers.actions?.more ? handlers.actions.more(data,api) : renderView({append:true,cursor:data.cursor});
      if(name==="settings")return handlers.actions?.settings ? handlers.actions.settings(data,api) : settings();
      if(name==="close-modal"){closeModal();return;}
      if(name==="source-manage")return handlers.actions?.["source-manage"] ? handlers.actions["source-manage"](data,api) : manageSource(data.provider);
      if(name==="search")return manageSource("gotsport");
      if(name==="account-teams")return accountTeams(data.provider,data.account);
      if(name==='account-teams-more'){const chooser=state.modal?.data;if(chooser?.account_id)return accountTeams(chooser.provider,chooser.account_id,{cursor:data.cursor,trail:[...(chooser.trail??[]),chooser.cursor],poll:false});}
      if(name==='account-teams-previous'){const chooser=state.modal?.data;if(chooser?.account_id){const trail=[...(chooser.trail??[])],cursor=trail.pop()??null;return accountTeams(chooser.provider,chooser.account_id,{cursor,trail,poll:false});}}
      if(name==="source-team-select")return sourceTeamChoice(data);
      if(['attachment-teams-more','attachment-teams-previous','attachment-seasons-more','attachment-seasons-previous'].includes(name))return attachmentCatalog(name,data);
      if(name==="theme-cycle"){state.theme=["light","dark","soccer"][(["light","dark","soccer"].indexOf(state.theme)+1)%3];applyTheme(state.theme);if(handlers.saveTheme)await handlers.saveTheme(state.theme,api);if(state.modal?.kind==="settings")await settings();return;}
      if(name==="sign-out"){await transport.command(routes.ownerLogout,{});refresh.stop();state.team=null;state.season=null;transport.select({role:"anonymous"});await bootstrap();return;}
      if(name==="close-detail"){const detail=state.details[0];handlers.closeDetail?.(api);state.details=[];setDetail(host,{open:false});await restoreDetailOrigin(detail);saveHistory(true);return;}
      if(name==="back"){if(state.modal){closeModal();return;}if(state.details.length){const detail=state.details.pop(),previous=state.details.at(-1);if(previous&&handlers.openDetail)await handlers.openDetail(previous,api);else {handlers.closeDetail?.(api);setDetail(host,{open:false});await restoreDetailOrigin(detail);}saveHistory(true);}return;}
      if(['match','player','match-player','competition','team'].includes(name)&&!canDetail(name))throw new AppError('These details are not shared through this link.','share_scope_denied',403);
      if(['match','player','match-player'].includes(name)&&data.team_season_id&&(data.team_season_id!==state.season||(data.team_id&&data.team_id!==state.team))){const origin=captureRoute(),prepared=await prepareContext(data.team_id??state.team,data.team_season_id);if(!prepared)return;installContext(prepared);await renderView();void refresh.start(pathFor(routes.revisions));data={...data,origin};}
      if(handlers.actions?.[name])return handlers.actions[name](data,api);
      if(["match","player","team","competition","match-player"].includes(name)&&handlers.openDetail){const detail={kind:name,id:data.id,tab:data.tab??"overview",origin:captureRoute(),...data};state.details.push(detail);saveHistory();return handlers.openDetail(detail,api);}
      notice("This action is unavailable for the selected saved record.");
    }catch(error){showError(error);}
  }
  async function submit(name,form,event){
    const controls=[...event.target.querySelectorAll("button[type=submit]")];controls.forEach(node=>node.disabled=true);
    try{
      if(name==="owner-login"){
        let password=String(form.get("key")??"");event.target.querySelector('[name="key"]').value="";
        try{
          const initializing=needsInitialization();let done=false;
          for(let step=0;step<100;step++){
            const result=await transport.command(initializing?routes.ownerInitialize:routes.ownerLogin,{password});
            if(result.data.continue){const help=host.querySelector("#loginText");if(help)help.textContent=`Initializing myTS · ${result.data.setup?.progress??0}%`;continue;}done=true;break;
          }
          if(!done)throw new AppError("Initialization has not finished. Sign in again to resume.","setup_incomplete");
          await bootstrap();
        }finally{password=null;form.delete("key");}
      }else if(name==="teamsnap-authorize")await authorizeTeamSnap(String(form.get("client_id")??"").trim());
      else if(name==="trace-send-code"){
        requireOwner();const result=await transport.command(routes.traceStart,{email:String(form.get("email")??"")});if(result.discarded)return;state.traceAttempt=result.data.attempt;openModal({title:"Connect Trace",kind:"trace-auth",html:forms.traceLogin({stage:"code",challenge_id:state.traceAttempt})});
      }else if(name==="trace-verify-code"){
        requireOwner();let code=String(form.get("code")??"");event.target.querySelector('[name="code"]').value="";try{const result=await transport.command(routes.traceVerify,{attempt:state.traceAttempt,code});if(result.discarded)return;state.traceAttempt=null;await accountTeams("trace",result.data.account?.id);}finally{code=null;form.delete("code");}
      }else if(name==="source-attach")await attachSource(form);
      else if(name==='source-club-choice'){if(!form.get('confirmed'))throw new AppError('Confirm the shared teams affected by this choice.','club_choice_confirmation_required');await commitAttachment(String(form.get('keep')??''));}
      else if(handlers.forms?.[name])await handlers.forms[name](form,{...event.target.dataset},api);
      else throw new AppError("This form has not been connected in this review build yet.","workflow_unimplemented");
    }catch(error){if(name==="owner-login"){
      // Read the persisted phase after failure or a lost response so the next
      // attempt resumes owner setup/sign-in and never displays an old cursor.
      try{await bootstrap();}catch{const help=host.querySelector("#loginText");if(help)help.textContent="Sign in again to resume.";}
      const node=host.querySelector("#loginError");node.textContent=error.message;node.classList.remove("hidden");
    }else showError(error);}
    finally{controls.forEach(node=>node.disabled=false);}
  }
  const api={state,transport,host,context,selection,pathFor,action,bootstrap,renderView,settings,canView,hydrateModel,followSourceTeam,manageSource,accountTeams,openModal,closeModal,setDetail:options=>{setDetail(host,options);applyCapabilities();},requireOwner,notice,showError,captureRoute,canLeave};
  return {
    ...api,
    async start(){state.active=true;mountShell(host,{mode:"login",owner_login:location.pathname.startsWith("/admin")});unbind=bindShell(host,{onAction:action,onSubmit:submit,onInput:(name,value,event)=>{if(name==="destination"&&event.target.closest("form")?.dataset.form==="source-attach")void destinationChanged().catch(error=>showError(error));else if(handlers.inputs?.[name])handlers.inputs[name](value,api,event);else if(["player-correction","match-correction","included-games","coach-profile","coach-availability","coach-clock-correction","branding-kits","branding-logo","award-save","team-rename"].includes(event.target.closest("form")?.dataset.form))state.editorDirty=true;},onInteraction:(name,event)=>handlers.interactions?.[name]?.(event,api)});window.addEventListener("popstate",restoreHistory);transport.select({role:"anonymous",viewer:!!viewerToken});discoveryTransport.select({role:"anonymous"});try{if(!await oauthReturn())await bootstrap();}catch(error){const loginError=host.querySelector("#loginError");loginError.textContent=error.message;loginError.classList.remove("hidden");updateShell(host,{...shellModel(),login_error:error.message});showError(error);}return api;},
    stop(){clearTimeout(toastTimer);logoCache.clear();state.active=false;handlers.cleanup?.(api);state.routeEpoch++;refresh.stop();discoveryRefresh.stop();transport.abortAll();discoveryTransport.abortAll();window.removeEventListener("popstate",restoreHistory);unbind?.();gestureCleanup?.();modalGestureCleanup?.();state.traceAttempt=null;state.attachChoice=null;if(pendingDiscard)resolveDiscard(false);},
  };
}
export async function startApp(options={}){const app=createApp(options);await app.start();return app;}
