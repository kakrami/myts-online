import { RequestCoordinator, RevisionRefresh, AppError } from "./transport.js";
import { ConnectionFlow, ownerSessionExpired, discoveryMessage } from "./connection-flow.js";
import { mountShell, updateShell, bindShell, applyTheme, setDetail } from "../ui-original/shell.js";
import * as screens from "../ui-original/screens.js";
import * as forms from "../ui-original/forms.js";
import { escapeHTML as e, button, icon, empty, pickerHTML, moreButton, formatDate, unwrap, safeImageURL } from "../ui-original/presentation.js";
import { bindSwipe, animateDateView } from "../ui-original/interactions.js";

const defaultRoutes = {
  bootstrap:"/api/bootstrap", overview:"/api/overview", schedule:"/api/schedule", calendar:"/api/calendar", revisions:"/api/revisions",
  accounts:"/api/accounts", ownerInitialize:"/api/owner/initialize", ownerLogin:"/api/owner/login", ownerLogout:"/api/owner/logout",
  teamsnapConfig:"/api/accounts/teamsnap/config", teamsnapAuthorize:"/api/accounts/teamsnap/authorize", teamsnapCallback:"/api/accounts/teamsnap/callback",
  traceStart:"/api/accounts/trace/start", traceVerify:"/api/accounts/trace/verify", traceCancel:"/api/accounts/trace/cancel", traceAttempt:"/api/accounts/trace/attempt", connections:"/api/connections", teams:"/api/teams",
};
const pageItems = value => Array.isArray(value) ? value : value?.items ?? [];
const addDays = (value,offset) => {const date=new Date(value+"T12:00:00Z");date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
const localDay = (timezone="America/Los_Angeles") => {const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
const fullCalendarRange = day => {const first=day.slice(0,7)+"-01",weekday=new Date(first+"T12:00:00Z").getUTCDay(),from=addDays(first,-weekday);return {from,to:addDays(from,42)};};
const monthStep = (day,offset) => {const date=new Date(day.slice(0,7)+"-01T12:00:00Z");date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,10);};

/** Mount only from the isolated build's explicit entry. No source collection runs here. */
export function createApp({host=document.body,fetcher=fetch,routes={},handlers={},maintenanceInterval=5000}={}) {
  routes={...defaultRoutes,...routes};
  const viewerToken=location.pathname.startsWith("/view/") ? location.pathname.split("/")[2] : null;
  const transport=new RequestCoordinator((path,options)=>fetcher(path,{...options,headers:{...options.headers,...(viewerToken ? {"x-view-key":viewerToken} : {})}}));
  const state={bootstrap:null,team:null,season:null,view:"overview",filters:{mode:"day",type:"all",period:"all",date:localDay(),sort:"date",direction:"asc"},model:null,routeEpoch:0,details:[],modal:null,editorDirty:false,traceAttempt:null,attachChoice:null,theme:"light",active:false,teamCatalog:null,seasonCatalog:null,catalogRevision:null};
  let sessionStorage;try{sessionStorage=window.sessionStorage;}catch{}
  const connection=new ConnectionFlow({storage:sessionStorage});
  const refresh=new RevisionRefresh(transport,model=>reloadVisible(model),error=>showError(error),{onInitial:model=>Object.entries(model.revision??{}).some(([key,value])=>['seasons','teams','branding'].includes(key)&&value!==state.catalogRevision?.[key])?reloadVisible(model):undefined});
  const discoveryTransport=new RequestCoordinator((path,options)=>fetcher(path,{...options,headers:{...options.headers,...(viewerToken ? {"x-view-key":viewerToken} : {})}}));
  const discoveryRefresh=new RevisionRefresh(discoveryTransport,()=>refreshAccountChooser(),error=>showError(error));
  let interactionEpoch=0,maintenanceTimer=null,maintenanceChecking=false,maintenanceReturn=null,maintenanceOAuth=null;
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
  const isMaintenance=()=>['maintenance','upgrade_required','upgrading'].includes(state.bootstrap?.setup?.state);
  const needsInitialization=()=>!!state.bootstrap?.setup&&!isMaintenance()&&(state.bootstrap.setup.state!=="ready"||state.bootstrap.setup.owner_ready===false);
  const maintenanceModel=()=>{
    const setup=state.bootstrap?.setup??{},labels={sealing:'Preparing the update',transfers:'Preserving saved files and Coach plans',expanding:'Preparing saved data',roots:'Updating saved connections',memberships:'Updating saved seasons',receipts:'Preserving connection history',rosters:'Updating saved rosters',events:'Updating saved events',validating:'Checking the update'};
    return {label:labels[setup.phase]??'Preparing the update',progress:Math.min(100,Math.max(0,Number(setup.progress)||0))};
  };
  function scheduleMaintenanceCheck(){if(!state.active||!isMaintenance()||maintenanceTimer||maintenanceChecking)return;maintenanceTimer=setTimeout(()=>{maintenanceTimer=null;void checkMaintenance();},maintenanceInterval);}
  async function checkMaintenance(){
    if(!state.active||!isMaintenance()||maintenanceChecking)return false;
    clearTimeout(maintenanceTimer);maintenanceTimer=null;maintenanceChecking=true;
    try{
      const restored=await bootstrap({preferredTeam:maintenanceReturn?.team??null,preferredSeason:maintenanceReturn?.season??null,accept:()=>state.active});
      if(restored&&!isMaintenance()&&state.active){if(maintenanceOAuth){const callback=maintenanceOAuth;maintenanceOAuth=null;await completeOAuthReturn(callback);}else if(role()==='owner'&&connection.value)await resumeConnection();}
      return restored;
    }catch(error){if(state.active&&isMaintenance())updateShell(host,{...shellModel(),login_error:'The update is still being checked. This page will retry automatically.'});return false;}
    finally{maintenanceChecking=false;scheduleMaintenanceCheck();}
  }
  const shellModel=()=>({mode:role()!=="anonymous" ? "dashboard" : "login",version:state.bootstrap?.version??"",owner_login:!!state.bootstrap&&!isMaintenance()&&location.pathname.startsWith("/admin"),maintenance:isMaintenance()?maintenanceModel():null,needs_initialization:needsInitialization(),teams:(state.bootstrap?.teams??[]).map(team=>({value:team.id,label:team.name,group:team.group??"My team",logo:team.display_logo??team.logo_url??null})),selected_team_id:state.team,seasons:(selectedTeam()?.seasons??[]).map(season=>({value:season.id,label:season.label})),selected_season_id:state.season,season_pending:!!state.team&&!state.season,active_view:state.view,owner:role()==="owner",allowed_views:["overview","schedule","competitions","team","bookmarks"].filter(canView),team_catalog:state.teamCatalog,season_catalog:state.seasonCatalog,login_title:isMaintenance()?"Updating myTS":needsInitialization() ? "Initialize myTS" : "Owner console",login_help:isMaintenance()?"Your saved dashboard is being updated. This page will reopen automatically when it is ready.":state.bootstrap?.setup?.state==="ready"&&state.bootstrap.setup.owner_ready===false ? "Finish owner access with the configured owner password." : needsInitialization() ? "Use the configured owner password to initialize this installation." : undefined});
  const notice=message=>{clearTimeout(toastTimer);const node=host.querySelector("#toast");if(node){node.textContent=message;node.classList.remove("hidden");toastTimer=setTimeout(()=>node.classList.add("hidden"),4500);}};
  function showError(error,{target=null}={}) {
    if(error?.name==="AbortError")return;
    if(error?.code==='installation_maintenance'){if(state.active&&!isMaintenance())void bootstrap().catch(()=>notice('myTS is being updated. Reload this page to check its progress.'));return;}
    const message=error?.message??"The request failed.";
    if(target)target.innerHTML=`<div class="login-error" role="alert">${e(message)}</div>`;
    else notice(message);
    handlers.onError?.(error,api);
    if(ownerSessionExpired(error) && role()!=="anonymous"){dismissConnection();logoCache.clear();handlers.closeDetail?.(api);refresh.stop();closeModal();state.details=[];state.bootstrap={...state.bootstrap,session:{role:"anonymous"},teams:[]};state.team=null;state.season=null;transport.select({role:"anonymous"});discoveryTransport.select({role:"anonymous"});setDetail(host,{open:false,bodyHTML:"",actionsHTML:""});host.querySelector("#accountBody").innerHTML="";updateShell(host,{...shellModel(),login_error:message});}
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
    const season=seasons.find(s=>s.id===seasonId)??(!seasonId?seasons[0]:null);if(!season&&seasonId)throw new AppError('That season is no longer available.','season_forbidden',403);
    return {team:{...team,seasons},season,catalog};
  }
  function installContext(prepared){const pinned=prepared.team;state.bootstrap.teams=[...(state.bootstrap.teams??[]).filter(t=>t.id!==pinned.id).slice(0,50).map(t=>({...t,seasons:[]})),pinned];state.seasonCatalog=prepared.catalog;updateContext(pinned.id,prepared.season?.id??null);}
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
    interactionEpoch++;
    const prepared=await prepareContext(route.team,route.season);if(!prepared)return;
    historyHandling=true;
    try{installContext(prepared);state.filters={...state.filters,...route.filters};state.view=route.view;state.details=(route.details??[]).filter(detail=>canDetail(detail.kind));await renderView();root().scrollTop=route.scroll??0;const detail=state.details.at(-1);if(detail&&handlers.openDetail)await handlers.openDetail(detail,api);else setDetail(host,{open:false});void refresh.start(pathFor(routes.revisions));}catch(error){showError(error);}finally{historyHandling=false;}
  }
  async function bootstrap({accept=()=>true,preferredTeam=state.team,preferredSeason=state.season}={}){
    const result=await transport.read("bootstrap",routes.bootstrap+(preferredTeam?"?"+new URLSearchParams({preferred_team_id:preferredTeam,...(preferredSeason?{preferred_season_id:preferredSeason}:{})}):""));if(result.discarded||!state.active||!accept())return false;
    const model=unwrap(result.data);
    if(['maintenance','upgrade_required','upgrading'].includes(model.setup?.state)){
      if(!isMaintenance())maintenanceReturn=captureRoute();
      // Pause the visible flow without cancelling its recoverable Trace/OAuth or
      // immutable command intent while the server is read-only for an update.
      connection.dismiss();state.bootstrap=model;updateContext(null,null);root().innerHTML='';host.querySelector('#accountBody').innerHTML='';scheduleMaintenanceCheck();return false;
    }
    clearTimeout(maintenanceTimer);maintenanceTimer=null;
    const restore=maintenanceReturn;maintenanceReturn=null;
    if(restore){preferredTeam??=restore.team;preferredSeason??=restore.season;}
    if(model.selected_team&&!model.teams?.some(t=>t.id===model.selected_team.id))model.teams=[...model.teams??[],model.selected_team];if(model.selected_team){const row=model.teams.find(t=>t.id===model.selected_team.id);if(!row.seasons)row.seasons=[];if(model.selected_season&&!row.seasons.some(s=>s.id===model.selected_season.id))row.seasons.push(model.selected_season);}state.teamCatalog=model.team_catalog?{...model.team_catalog,cursor:null,trail:[],has_previous:false}:null;state.seasonCatalog=model.season_catalog?{...model.season_catalog,cursor:null,trail:[],has_previous:false}:null;state.bootstrap=model;state.catalogRevision={seasons:model.season_catalog?.revision,teams:model.team_catalog?.revision,branding:model.team_catalog?.branding_revision};state.theme=model.preferences?.theme??state.theme;applyTheme(state.theme);
    const team=model.teams?.find(t=>t.id===preferredTeam)??model.teams?.find(t=>t.id===(model.selected_team?.id??model.selection?.team_id??model.selected_team_id))??model.teams?.[0];
    const season=team?.seasons?.find(s=>s.id===preferredSeason)??team?.seasons?.find(s=>s.id===(model.selected_season?.id??model.selection?.team_season_id??model.selected_season_id))??team?.seasons?.[0];
    updateContext(team?.id??null,season?.id??null);if(restore&&scopeMatches(restore))state.filters={...state.filters,...restore.filters};if(role()==="viewer"&&!canView(state.view))state.view=["overview","schedule","competitions","team","bookmarks","reports"].find(canView)??"unavailable";
    if(role()==="anonymous"){root().innerHTML="";setDetail(host,{open:false,bodyHTML:"",actionsHTML:""});host.querySelector("#accountBody").innerHTML="";saveHistory(true);return true;}
    if(!state.team){root().innerHTML=role()==="owner"?`${empty("Connect an account and choose your team.")}<div class="action-row">${button("source-manage","Connect TeamSnap",{data:{provider:"teamsnap"}})}${button("source-manage","Connect Trace",{data:{provider:"trace"}})}${button("search","Find a GotSport team")}</div>`:empty("This shared team is no longer available.");saveHistory(true);return true;}
    await renderView();if(!accept())return false;void hydrateCatalog();saveHistory(true);void refresh.start(pathFor(routes.revisions));return true;
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
  async function selectScheduleDay(day){
    if(typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+"T12:00:00Z"))||new Date(day+"T12:00:00Z").toISOString().slice(0,10)!==day)throw new AppError("Choose a valid schedule date.","invalid_selection");
    const contains=season=>season.start_day<=day&&day<season.end_day;
    if(!contains(selectedSeason()??{})){
      const intent=interactionEpoch,teamId=state.team,seen=new Set();let season=(selectedTeam()?.seasons??[]).find(contains),cursor=null;
      while(!season){const page=await readSeasons(teamId,{cursor});if(!page||intent!==interactionEpoch||teamId!==state.team)return false;season=page.rows.find(contains);cursor=page.catalog.next_cursor;if(!cursor)break;if(seen.has(cursor))throw new AppError("The season list changed. Reopen Schedule.","cursor_restart");seen.add(cursor);}
      if(!season){notice("There is no saved season for that date yet.");return false;}
      const prepared=await prepareContext(teamId,season.id);if(!prepared||intent!==interactionEpoch)return false;installContext(prepared);void refresh.start(pathFor(routes.revisions));
    }
    state.filters.date=day;state.filters.mode="day";state.filters.type="all";state.filters.period="all";return true;
  }
  function scheduleModel(envelope,calendarEnvelope=null,neighbors={}){
    const page=unwrap(envelope),selection=envelope.selection??selection(),calendarData=unwrap(calendarEnvelope),counts=new Map((calendarData.days??[]).map(day=>[day.day,day]));
    const date=selection.date??state.filters.date,bounds=selectedSeason(),days=[];let previous=false,next=false;
    for(let i=-3;i<=3;i++){const day=addDays(date,i);if(bounds?.start_day&&day<bounds.start_day){if(!previous)days.push({label:"Previous",season_id:neighbors.previous?.id,available:!!neighbors.previous,boundary:"end"});previous=true;continue;}if(bounds?.end_day&&day>=bounds.end_day){if(!next)days.push({label:"Next",season_id:neighbors.next?.id,available:!!neighbors.next,boundary:"start"});next=true;continue;}const count=counts.get(day);days.push({day,today:day===localDay(selection.timezone),kinds:count?.kinds??[],total:count?.total??0});}
    return {...envelope,data:{mode:selection.mode,filter:selection.type,period:selection.period,selected_day:date,month_label:formatDate(date,{month:"short",day:undefined}),season_label:selectedSeason()?.label,days,events:page}};
  }
  async function renderView({append=false,cursor=null}={}){
    if(!state.team)return;if(!canView(state.view)){root().innerHTML=empty("No dashboard sections are available through this viewer link.");updateShell(host,shellModel());return;}
    const epoch=++state.routeEpoch,captured=captureRoute();gestureCleanup?.();gestureCleanup=null;
    if(!state.season){
      state.model=null;root().classList.remove('schedule-day-view');root().removeAttribute('aria-busy');
      const available=selectedTeam()?.seasons??[];
      root().innerHTML=empty(available.length?'Season data is available. Choose a season to view your team.':'No dated season data is available yet. Seasons will appear here as saved dates are resolved.')+`<div class="action-row">${available.length?button('season','View '+available[0].label,{data:{value:available[0].id}}):''}${role()==='owner'?button('status-open','View import progress')+button('settings','Settings'):''}</div>`;
      updateShell(host,shellModel());return;
    }
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
      updateShell(host,shellModel());applyCapabilities();handlers.afterRender?.(state.view,api);
      if(unwrap(envelope).windowed)root().insertAdjacentHTML('afterbegin',`<p class="scope-caption">Showing the latest 200 loaded rows. Full totals cover this selection. ${button('list-restart','Return to first page',{className:'text-action'})}</p>`);
      if(envelope.projection_pending)root().insertAdjacentHTML("afterbegin",'<p class="scope-caption" role="status">Saved data is updating in the background.</p>');
    }catch(error){if(epoch!==state.routeEpoch)return;if(error.code==="cursor_restart"&&cursor){notice("The list changed. Reloading this selection.");return renderView();}showError(error,{target:root()});}
    finally{if(epoch===state.routeEpoch)root()?.removeAttribute("aria-busy");}
  }
  function openModal({title="",html="",kind="custom",data={},connection:connectionModal=false}){
    handlers.closeModal?.(api);
    if(!connectionModal)dismissConnection();
    modalGestureCleanup?.();modalGestureCleanup=null;state.routeEpoch++;const modal=host.querySelector("#accountModal");host.querySelector("#accountModalTitle").textContent=title;host.querySelector("#accountBody").innerHTML=html;modal.classList.remove("hidden");state.modal={kind,data,connection:connectionModal};applyCapabilities();modal.querySelector("input,select,button")?.focus();
  }
  function closeModal(){handlers.closeModal?.(api);dismissConnection();modalGestureCleanup?.();modalGestureCleanup=null;state.routeEpoch++;host.querySelectorAll(".modal").forEach(modal=>modal.classList.add("hidden"));if(pendingDiscard)resolveDiscard(false);discoveryRefresh.stop();state.modal=null;state.traceAttempt=null;state.attachChoice=null;}
  async function settings(){
    const epoch=state.routeEpoch;let accounts=[];
    if(role()==="owner"){const result=await transport.read("accounts",routes.accounts);if(!guarded(epoch,result))return;accounts=unwrap(result.data).accounts??[];}
    const providers=role()==="owner" ? ["teamsnap","gotsport","trace"].map(provider=>{const account=accounts.find(a=>a.provider===provider);return {provider,label:{teamsnap:"TeamSnap",gotsport:"GotSport",trace:"Trace"}[provider],state:account?.authorization_state??"disconnected",status_label:account?.status_label??(account ? "Authorization connected · update status unavailable" : "Not connected")};}) : state.bootstrap.providers??[];
    openModal({title:"Settings",kind:"settings",html:screens.settingsBody({owner:role()==="owner",theme:state.theme,version:state.bootstrap.version,providers,has_team:!!state.team,can_reports:!!state.team&&canView("reports")})});
  }
  const providerLabel=provider=>({teamsnap:'TeamSnap',trace:'Trace',gotsport:'GotSport'}[provider]??provider);
  const flowCurrent=ticket=>state.active&&connection.current(ticket);
  function connectionModal(options){openModal({...options,connection:true});}
  function connectionError(error){
    if(ownerSessionExpired(error)||error?.code==='installation_maintenance'){showError(error);return;}
    const body=host.querySelector('#accountBody');let target=body?.querySelector('[data-connection-error]');
    if(!target&&body){body.insertAdjacentHTML('afterbegin','<div data-connection-error role="alert"></div>');target=body.querySelector('[data-connection-error]');}
    if(target)target.innerHTML=`<p class="login-error">${e(error?.message??'The request did not finish. Try again.')}</p>`;
    else showError(error);
  }
  async function cancelTrace(attempt){if(!attempt)return;try{await transport.command(routes.traceCancel,{attempt});}catch(error){if(ownerSessionExpired(error)&&state.active)showError(error);else if(state.active)notice('Trace cancellation could not be confirmed. Do not use the old code; the attempt will expire.');}}
  function dismissConnection(){
    if(!connection.active)return;
    const attempt=connection.value?.attempt;connection.update({attempt:null,attemptExpires:null});connection.dismiss();
    if(attempt)void cancelTrace(attempt);
  }
  function loadingConnection(message){connectionModal({title:providerLabel(connection.value.provider),kind:'connection-loading',html:`<p class="modal-copy" role="status">${e(message)}</p>${button('connection-cancel','Cancel')}`});}
  function ensureConnection(provider){if(!connection.active||connection.value?.provider!==provider)connection.begin(provider,{teamId:state.team,teamName:selectedTeam()?.name,seasonId:state.season});return connection.ticket();}
  async function manageSource(provider,{forceSignIn=false,repair=false,addTeam=false}={}){
    requireOwner();
    if(connection.value?.pending)return resumeConnection();
    dismissConnection();connection.begin(provider,addTeam?{}:{teamId:state.team,teamName:selectedTeam()?.name,seasonId:state.season});
    if(provider==='gotsport')return showGotSport();
    if(forceSignIn)return providerSignIn({repair});
    return chooseAccount();
  }
  async function chooseAccount({cursor=null,trail=[]}={}){
    const ticket=connection.ticket(),provider=connection.value.provider;connection.update({stage:'accounts'});loadingConnection('Checking your saved account…');
    try{
      const result=await transport.read('connection-accounts',routes.accounts+(cursor?'?'+new URLSearchParams({cursor}):''));if(!flowCurrent(ticket)||result.discarded)return;
      const page=unwrap(result.data),accounts=(page.accounts??[]).filter(a=>a.provider===provider&&a.active!==false&&a.authorization_state==='connected');
      if(accounts.length===1&&!cursor&&!page.next_cursor){connection.update({accountId:accounts[0].id,accountName:accounts[0].name});return accountTeams(provider,accounts[0].id);}
      if(!accounts.length&&!cursor&&!page.next_cursor)return providerSignIn();
      connectionModal({title:`Choose ${providerLabel(provider)} account`,kind:'connection-accounts',data:{cursor,trail,next_cursor:page.next_cursor},html:`<p class="modal-copy">Use an account already connected to myTS.${!accounts.length?' No matching connected account is on this page.':''}</p>${accounts.map(a=>`<div class="card section"><div class="card-body">${button('connection-account',a.name||providerLabel(provider)+' account',{data:{account:a.id,name:a.name??'',provider}})}</div></div>`).join('')}<div class="action-row">${trail.length?button('connection-accounts-previous','Previous accounts'):''}${page.next_cursor?button('connection-accounts-more','More accounts',{data:{cursor:page.next_cursor}}):''}${button('connection-sign-in','Use another account')}${button('connection-cancel','Cancel')}</div>`});
    }catch(error){if(flowCurrent(ticket))connectionError(error);}
  }
  async function providerSignIn({repair=false}={}){
    const ticket=connection.ticket(),provider=connection.value.provider;discoveryRefresh.stop();connection.update({stage:'sign-in',accountId:null,accountName:null});
    if(provider==='trace'){connectionModal({title:'Sign in to Trace',kind:'trace-auth',html:forms.traceLogin({})});return;}
    loadingConnection('Checking TeamSnap app setup…');
    try{const result=await transport.read('teamsnap-config',routes.teamsnapConfig);if(!flowCurrent(ticket)||result.discarded)return;const config=unwrap(result.data),setup=repair||config.requires_client_id;
      connectionModal({title:setup?'TeamSnap app setup':'Sign in to TeamSnap',kind:'teamsnap-auth',html:`<p class="modal-copy">${setup?'The site owner must register a TeamSnap app once before anyone can connect here. Use its Client ID and exact callback below. Registration availability is controlled by TeamSnap.':'Continue to TeamSnap to allow read-only access to your teams. Your saved app registration can be repaired below if sign-in fails.'}</p>${setup?`<p class="source-note">Callback: <b>${e(config.redirect_uri??location.origin+'/admin')}</b><br><a href="https://github.com/teamsnap/teamsnap-javascript-sdk/wiki/Quick-Start" target="_blank" rel="noopener noreferrer">TeamSnap registration instructions</a></p>`:''}<form data-form="teamsnap-authorize">${setup?forms.inputField('client_id','Registered TeamSnap Client ID',config.client_id??'',{required:true}):''}<div class="action-row"><button class="btn primary" type="submit">${setup?'Save setup and sign in':'Sign in to TeamSnap'}</button>${!setup?button('teamsnap-repair','Change app setup'):''}${button('connection-cancel','Cancel')}</div></form>`});
    }catch(error){if(flowCurrent(ticket))connectionError(error);}
  }
  async function authorizeTeamSnap(clientId){
    requireOwner();const ticket=connection.ticket();connection.update({stage:'authorizing'});
    try{const result=await transport.command(routes.teamsnapAuthorize,clientId?{client_id:clientId}:{});if(!flowCurrent(ticket)||result.discarded)return;const url=new URL(result.data.authorization_url);if(url.protocol!=='https:'||url.hostname!=='auth.teamsnap.com')throw new AppError('TeamSnap returned an invalid sign-in address.','oauth_url_invalid');location.assign(url.href);}
    catch(error){if(flowCurrent(ticket)){connection.update({stage:'sign-in'});connectionError(error);}}
  }
  async function completeOAuthReturn(callback){
    let ticket;
    try{
      if(role()!=='owner')throw new AppError('Sign in as the owner, then reconnect TeamSnap.','sign_in_required',401);
      if(connection.value?.provider!=='teamsnap')connection.begin('teamsnap',{teamId:state.team,teamName:selectedTeam()?.name,seasonId:state.season});else connection.resume();
      ticket=connection.ticket();loadingConnection('Confirming your TeamSnap sign-in…');
      const result=await transport.command(routes.teamsnapCallback,callback);if(!flowCurrent(ticket)||result.discarded)return;
      connection.update({accountId:result.data.account?.id,accountName:result.data.account?.name,stage:'teams'});await accountTeams('teamsnap',result.data.account?.id);
    }catch(error){if(ticket&&!flowCurrent(ticket))return;if(error.code==='installation_maintenance'){maintenanceOAuth=callback;showError(error);return;}if(role()==='owner'){await providerSignIn({repair:error.code==='oauth_client_invalid'});connectionError(error);}else showError(error);}
    finally{if(maintenanceOAuth!==callback)for(const key of Object.keys(callback))callback[key]=null;}
  }
  async function oauthReturn(){
    const values=new URLSearchParams(location.hash.slice(1));if(!values.has('access_token')&&!values.has('error'))return false;
    const callback=Object.fromEntries(['state','access_token','token_type','expires_in','scope','error','error_description'].filter(key=>values.has(key)).map(key=>[key,values.get(key)]));
    history.replaceState(history.state,'',location.pathname+location.search);
    // Strip the fragment before any await. A maintenance pause keeps this only
    // in memory, never in browser storage or a saved connection command.
    try{await bootstrap();if(isMaintenance()){maintenanceOAuth=callback;return true;}await completeOAuthReturn(callback);}
    catch(error){for(const key of Object.keys(callback))callback[key]=null;showError(error);}
    return true;
  }
  async function accountTeams(provider,accountId=null,{cursor=null,trail=[],poll=true}={}){
    requireOwner();if(connection.value?.pending)return resumeConnection();const ticket=ensureConnection(provider);if(!accountId)return chooseAccount();
    connection.update({stage:'teams',accountId});
    try{const params=new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}),result=await transport.read('source-teams',`${routes.accounts}/${encodeURIComponent(accountId)}/teams?${params}`);if(!flowCurrent(ticket)||result.discarded)return;
      const model=unwrap(result.data),teams=model.teams??model.items??[],pending=['queued','running'].includes(model.discovery?.state);
      connectionModal({title:pending?'Finding teams':'Choose a team',kind:'source-teams',data:{provider,account_id:accountId,teams,cursor,trail,next_cursor:model.next_cursor},html:forms.candidateTeams({provider,account_id:accountId,account_name:connection.value.accountName,teams,pending,message:discoveryMessage(model)+(connection.value.destination?.teamName?' Connect to '+connection.value.destination.teamName+'.':'')})+`<div class="action-row">${trail.length?button('account-teams-previous','Previous teams'):''}${model.next_cursor?button('account-teams-more','Next teams',{data:{cursor:model.next_cursor}}):''}${button('connection-refresh','Refresh teams')}${button('connection-sign-in',model.discovery?.state==='blocked'||model.discovery?.state==='failed'?'Reconnect and retry discovery':'Use another account')}${button('connection-cancel','Close')}</div>`});
      if(poll)void discoveryRefresh.start(`${routes.accounts}/${encodeURIComponent(accountId)}/revisions`);
    }catch(error){if(flowCurrent(ticket)){connectionModal({title:`${providerLabel(provider)} teams`,kind:'connection-recovery',html:`<p class="modal-copy">Your myTS sign-in and saved content are still available. Try refreshing teams, or sign in to this provider again.</p><div class="action-row">${button('connection-refresh','Retry')}${button('connection-sign-in','Reconnect account')}${button('connection-cancel','Close')}</div>`});connectionError(error);}}
  }
  async function refreshAccountChooser(){const chooser=state.modal;if(chooser?.kind!=='source-teams'||!chooser.data.account_id||!connection.active)return;try{await accountTeams(chooser.data.provider,chooser.data.account_id,{cursor:chooser.data.cursor,trail:chooser.data.trail,poll:false});}catch(error){if(error.code==='cursor_restart')await accountTeams(chooser.data.provider,chooser.data.account_id,{poll:false});else throw error;}}
  function showGotSport({teams=null,model={},error=null}={}){
    const draft=connection.value.draft??{},page=model.page??1;connection.update({stage:'search'});
    connectionModal({title:'Find a GotSport team',kind:teams?'source-teams':'source-search',data:{provider:'gotsport',account_id:null,teams:teams??[]},html:forms.gotSportSearch({...draft,query:draft.q,error})+(teams?forms.candidateTeams({provider:'gotsport',teams,message:`${model.total??teams.length} matching teams${model.page?' · Page '+page:''}`})+`<div class="action-row">${page>1?button('gotsport-search-previous','Previous teams',{data:{page:page-1}}):''}${model.next_page?button('gotsport-search-more','Next teams',{data:{page:model.next_page}}):''}</div>`:'')});
  }
  async function searchGotSport(params){
    requireOwner();if(connection.value?.pending)return resumeConnection();const ticket=ensureConnection('gotsport'),draft={...connection.value.draft,...params,q:String(params.q??connection.value.draft.q??'').trim()};connection.update({draft});
    const link=/^(?:https?:\/\/|\d+$)/i.test(draft.q);
    if(!draft.q)return showGotSport({error:'Enter a team name or public team link.'});
    if(!link&&(!draft.age||!draft.gender)){connection.update({draft:{...draft,filtersRequested:true}});return showGotSport();}
    loadingConnection('Finding matching GotSport teams…');
    try{const result=link?await transport.command('/api/sources/gotsport/resolve',{url:draft.q}):await transport.read('gotsport-search','/api/sources/gotsport/search?'+new URLSearchParams(Object.entries({q:draft.q,state:draft.state??'',age:draft.age,gender:draft.gender,page:params.page??1}).filter(([,v])=>v!==''&&v!=null)));if(!flowCurrent(ticket)||result.discarded)return;const model=unwrap(result.data);showGotSport({teams:model.teams??[],model});}
    catch(error){if(flowCurrent(ticket)){if(ownerSessionExpired(error))showError(error);else showGotSport({error:error.message});}}
  }
  async function sendTraceCode(form){
    requireOwner();const ticket=connection.ticket();connection.update({stage:'sending'});
    try{const result=await transport.command(routes.traceStart,{email:String(form.get('email')??'')});if(!flowCurrent(ticket)||result.discarded){if(result.data?.attempt)void cancelTrace(result.data.attempt);return;}state.traceAttempt=result.data.attempt;connection.update({stage:'code',attempt:state.traceAttempt,attemptExpires:result.data.expires_at});connectionModal({title:'Check your Trace email',kind:'trace-auth',html:forms.traceLogin({stage:'code',challenge_id:state.traceAttempt})});}
    catch(error){if(flowCurrent(ticket)){connection.update({stage:'sign-in'});connectionError(error);}}
  }
  async function verifyTraceCode(form,event){
    requireOwner();const ticket=connection.ticket(),attempt=connection.value.attempt;let code=String(form.get('code')??'');event.target.querySelector('[name="code"]').value='';connection.update({stage:'verifying'});
    try{const result=await transport.command(routes.traceVerify,{attempt,code});if(!flowCurrent(ticket)||result.discarded)return;state.traceAttempt=null;connection.update({attempt:null,attemptExpires:null,accountId:result.data.account?.id,accountName:result.data.account?.name});await accountTeams('trace',result.data.account?.id);}
    catch(error){if(flowCurrent(ticket)){connection.update({stage:'code'});connectionError(error);}}
    finally{code=null;form.delete('code');}
  }
  async function resumeConnection(){
    requireOwner();if(!connection.value)return;connection.resume();const ticket=connection.ticket(),flow=connection.value;
    if(flow.pending){state.attachChoice={source:flow.source,provider:flow.provider,account_id:flow.accountId,pendingAttach:flow.pending};return showConnectionRetry();}
    if(flow.source){state.attachChoice={source:flow.source,provider:flow.provider,account_id:flow.accountId};return connectSelectedSource();}
    if(flow.provider==='gotsport')return showGotSport();
    if(flow.provider==='trace'&&flow.attempt){
      loadingConnection('Checking your pending Trace sign-in…');
      try{const result=await transport.read('trace-attempt',routes.traceAttempt+'?'+new URLSearchParams({attempt:flow.attempt}));if(!flowCurrent(ticket)||result.discarded)return;const attempt=unwrap(result.data);state.traceAttempt=attempt.attempt;
        if(attempt.stage==='failed'){connection.update({attempt:null,attemptExpires:null});void cancelTrace(attempt.attempt);await providerSignIn();connectionError(new AppError('That Trace attempt cannot be reused. Send a new code to continue.','trace_attempt_invalid'));return;}
        if(attempt.stage==='verifying'){connectionModal({title:'Checking Trace sign-in',kind:'trace-auth',html:`<p class="modal-copy">The previous verification is still settling. Check again shortly; do not request another code yet.</p><div class="action-row">${button('connection-resume','Check again')}${button('connection-cancel','Cancel')}</div>`});return;}
        connection.update({stage:'code'});connectionModal({title:'Enter your Trace code',kind:'trace-auth',html:forms.traceLogin({stage:'code',challenge_id:attempt.attempt})});return;
      }catch(error){if(!flowCurrent(ticket))return;if(error.status!==410){connectionError(error);return;}connection.update({attempt:null,attemptExpires:null});}
    }
    if(flow.accountId)return accountTeams(flow.provider,flow.accountId);
    return chooseAccount();
  }
  async function connectSelectedSource(){
    const choice=state.attachChoice,flow=connection.value;if(!choice||!flow)return;
    const explicitTeam=Object.hasOwn(flow.draft??{},'destination')?(String(flow.draft.destination).split(':')[0]||null):flow.destination?.teamId??null;
    const pending=connection.pending(routes.connections,{source_team_id:choice.source.id,account_id:choice.account_id,
      ...(explicitTeam?{team_id:explicitTeam}:{new_team:{name:choice.source.name,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Los_Angeles',timezone_source:'device',kind:flow.draft?.kind??'own'}})},
      {teamId:explicitTeam,seasonId:flow.destination?.seasonId??null});
    choice.pendingAttach=pending;return commitAttachment();
  }
  async function changeConnectionScope(row,mode){
    requireOwner();if(connection.value?.pending)return resumeConnection();
    if(row.app_team_id!==state.team||!['fixed_seasons','observed_history'].includes(mode))throw new AppError('Reload this team connection.','connection_unavailable');
    dismissConnection();connection.begin(row.provider,{teamId:state.team,teamName:selectedTeam()?.name,seasonId:state.season});
    const source={id:row.source_team_id,provider:row.provider,name:row.name};state.attachChoice={source,account_id:row.account_id,provider:row.provider};connection.update({source,accountId:row.account_id});
    state.attachChoice.pendingAttach=connection.pending(routes.connections,{team_id:state.team,source_team_id:row.source_team_id,account_id:row.account_id,kind:selectedTeam()?.kind??'own',connection_generation:row.generation,scope:{mode,...(mode==='fixed_seasons'?{season_ids:(row.seasons??[]).filter(season=>!season.excluded).map(season=>season.id)}:{})}},{teamId:state.team,seasonId:state.season});return commitAttachment();
  }
  async function sourceTeamChoice(data){
    const m=state.modal?.data??{},source=m.teams?.find(t=>t.id===data.id);if(!source)throw new AppError('Choose a team from this account.','source_team_invalid');
    state.attachChoice={source,account_id:m.account_id??data.account??null,provider:m.provider??data.provider};discoveryRefresh.stop();connection.update({source,accountId:state.attachChoice.account_id});
    return connectSelectedSource();
  }
  async function followSourceTeam(candidate){
    requireOwner();if(candidate.provider!=='gotsport'||!candidate.official_url)throw new AppError('This public team has no verified follow link.','source_team_unverified');if(connection.value?.pending)return resumeConnection();dismissConnection();connection.begin('gotsport',{});connection.update({draft:{kind:'followed'}});const ticket=connection.ticket();loadingConnection('Checking this public team…');
    const result=await transport.command('/api/sources/gotsport/resolve',{url:candidate.official_url});if(!flowCurrent(ticket)||result.discarded)return;const teams=unwrap(result.data).teams??[],source=teams.find(t=>t.id===candidate.id)??(teams.length===1?teams[0]:null);if(!source)throw new AppError('Choose this team from the verified public results.','source_team_unverified');state.attachChoice={source,account_id:null,provider:'gotsport'};connection.update({source});return connectSelectedSource();
  }
  async function showDestinationChoice(cursor=null,trail=[]){
    const ticket=connection.ticket();loadingConnection('Finding your saved teams…');
    const result=await transport.read('connection-destinations',routes.teams+'?'+new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}));if(!flowCurrent(ticket)||result.discarded)return;
    const model=unwrap(result.data);connectionModal({title:'Choose the destination team',kind:'connection-destination',data:{teams:model.items??[],cursor,trail},html:`<p class="modal-copy">This source is connected to more than one saved team. Choose the team to open or connect.</p>${(model.items??[]).map(team=>button('connection-destination',team.name,{data:{id:team.id}})).join('')}<div class="action-row">${trail.length?button('connection-destinations-previous','Previous teams'):''}${model.next_cursor?button('connection-destinations-more','More teams',{data:{cursor:model.next_cursor}}):''}${button('connection-cancel','Cancel')}</div>`});
  }
  function showClubChoice(conflict){
    const choice=state.attachChoice;if(!choice?.pendingAttach)throw new AppError("Choose the provider team again.","source_team_invalid");
    choice.clubConflict=conflict;
    const model=conflict.club_choice,heading=model.kind==='logo'?'Choose the shared club logo':'Choose the club record';
    const cards=(model.choices??[]).map(option=>{const record=option.value==='current'?model.current:model.source,image=safeImageURL(record?.logo);return `<label class="card section"><span class="card-body"><input type="radio" name="keep" value="${e(option.value)}" required> <b>${e(option.label)}</b>${image?`<img src="${e(image)}" alt="${e(record?.name??'Club')}" style="width:48px;height:48px;object-fit:contain;vertical-align:middle;margin:4px">`:''}<span class="source-note">${e(record?.name??'Club')}<br>Applies to ${e(option.affected_team_count??option.affected_teams?.length??1)} teams: ${e((option.affected_teams??[]).map(team=>typeof team==='object'?team.name??team.label??team.id:team).join(', ')||'the selected team')}${option.affected_team_count>(option.affected_teams?.length??0)?' (first 20 shown)':''}</span></span></label>`;}).join('');
    connectionModal({title:heading,kind:'club-choice',html:`<p class="modal-copy">This source and your existing club have different saved records. Choose the record to keep before connecting the team.</p><form data-form="source-club-choice">${cards}<label class="source-note"><input type="checkbox" name="confirmed" required> I have reviewed the teams affected by this shared club choice.</label><div class="action-row"><button class="btn primary" type="submit">Use selected record & connect</button>${button('close-modal','Cancel')}</div></form>`});
  }
  function showConnectionRetry(error=null){
    const creating=connection.value.pending?.path===routes.connections;
    connectionModal({title:'Finish connecting',kind:'connection-pending',html:`<p class="modal-copy">${e(connection.value.source?.name??'Your team')} · ${creating?'This connection may already be saved. Retry safely to recover the same connection and its background import.':'This source may already be attached. Retrying can reconnect it if it was disconnected elsewhere. Review that choice before continuing.'}</p>${error?`<p class="login-error" role="alert">${e(error.message)}</p>`:''}<div class="action-row">${creating?button('connection-check-saved','Check saved connection'):''}${button('connection-retry',creating?'Check and finish connection':'Reconnect this source if needed',{className:'btn primary'})}${button('connection-abandon','Start over')}${button('connection-cancel','Close')}</div>`});
  }
  async function checkSavedConnection(){
    const ticket=connection.ticket(),pending=connection.value.pending;if(pending?.path!==routes.connections)return;
    loadingConnection('Checking the saved connection…');
    try{const result=await transport.read('connection-receipt',routes.connections+'?'+new URLSearchParams({request_id:pending.requestId}));if(!flowCurrent(ticket)||result.discarded)return;const saved=unwrap(result.data);
      if(!saved.found){showConnectionRetry(new AppError('No saved connection was found yet. A request still in progress may finish; retry with the same request or check again.','connection_not_found'));return;}
      connectionModal({title:'Connection record found',kind:'connection-receipt',data:saved,html:`<p class="modal-copy">${saved.team_available?'The team was saved.':'The team has since been removed or is being removed.'} ${(saved.connection_active??saved.attachment_active)?'Its source link is saved.':'Its source link is no longer active.'} ${saved.account_active===false?'The provider account now needs reconnection.':''} This check does not start or confirm an import.</p><div class="action-row">${saved.team_available?button('connection-open-saved','Open saved team',{className:'btn primary'}):''}${button('connection-resume','Return to recovery')}${button('connection-abandon','Start over')}</div>`});
    }catch(error){if(flowCurrent(ticket)){showConnectionRetry(error);if(ownerSessionExpired(error))showError(error);}}
  }
  async function openSavedConnection(){
    const saved=state.modal?.kind==='connection-receipt'?state.modal.data:null;if(!saved?.team_available)return;
    const intent=interactionEpoch;connection.clear();closeModal();await bootstrap({accept:()=>state.active&&interactionEpoch===intent,preferredTeam:saved.team_id,preferredSeason:saved.season_id});
  }
  async function commitAttachment(keep=null){
    requireOwner();const choice=state.attachChoice,pending=choice?.pendingAttach??connection.value?.pending;if(!pending)throw new AppError('Choose the provider team again.','source_team_invalid');
    const ticket=connection.ticket(),body={...pending.body};
    if(keep){const conflict=choice.clubConflict?.club_choice;if(!conflict||!(conflict.choices??[]).some(row=>row.value===keep))throw new AppError('Choose one of the saved club records.','club_choice_required');body.revision=conflict.expected.profile_revision;body.club_choice={kind:conflict.kind,keep,...conflict.expected};pending.body=body;connection.update({pending});}
    loadingConnection('Connecting your team and queuing its import…');let result;
    try{result=await transport.command(pending.path,body,{idempotencyKey:pending.requestId});}
    catch(error){if(!flowCurrent(ticket))return;if(ownerSessionExpired(error)||error?.code==='installation_maintenance'){showError(error);return;}if(error.status===409&&error.details?.club_choice){showClubChoice(error.details);return;}if(error.status===409&&error.code==='connection_destination_required'){return showDestinationChoice();}showConnectionRetry(error);return;}
    if(!flowCurrent(ticket)||result.discarded)return;
    const model=unwrap(result.data),teamId=model.team_id??pending.teamId,seasonId=pending.body.team_id&&pending.seasonId?pending.seasonId:Object.hasOwn(model,'season_id')?model.season_id:pending.seasonId??null;
    const intent=interactionEpoch;connection.clear();state.attachChoice=null;closeModal();
    if(!await bootstrap({accept:()=>state.active&&interactionEpoch===intent,preferredTeam:teamId,preferredSeason:seasonId}))return;
    // Queue acceptance is not completion. The status screen reports persisted
    // stages/coverage and continues to be available after every tab is closed.
    openModal({title:model.queued?'Connected · Import queued':'Team connected',kind:'connection-progress',html:`<p class="modal-copy">${model.queued?'Your team is connected. Available data will appear as the server imports it; this page can be closed.':'Your team is already connected. Its saved data and background status are available.'}</p><div class="action-row">${button('status-open','View import progress',{className:'btn primary'})}${button('close-modal','View team')}</div>`});
  }
  async function calendar(){
    const epoch=state.routeEpoch,range=fullCalendarRange(state.filters.date),result=await transport.read("calendar-modal",pathFor(routes.calendar,{...state.filters,...range}));if(!guarded(epoch,result))return;
    const data=unwrap(result.data),counts=new Map((data.days??[]).map(d=>[d.day,d]));
    openModal({title:"Choose schedule date",kind:"calendar",html:screens.calendar({label:formatDate(state.filters.date,{month:"long",year:"numeric",day:undefined}),days:Array.from({length:42},(_,i)=>{const day=addDays(range.from,i),count=counts.get(day);return {day,selected:day===state.filters.date,today:day===localDay(selectedTeam()?.timezone),other_month:day.slice(0,7)!==state.filters.date.slice(0,7),kinds:count?.kinds??[],total:count?.total??0};})})});
    modalGestureCleanup=bindSwipe(host.querySelector("#accountBody .calendar-grid"),{disabled:()=>state.modal?.kind!=="calendar",onStep:direction=>void action("calendar-month",{offset:direction})});
  }
  async function refreshCatalogs(revision={}){
    const previous=state.catalogRevision??{},captured=captureRoute(),epoch=state.routeEpoch,intent=interactionEpoch;
    const seasonsChanged=revision.seasons!==undefined&&revision.seasons!==previous.seasons;
    const teamsChanged=role()==='owner'&&((revision.teams!==undefined&&revision.teams!==previous.teams)||(revision.branding!==undefined&&revision.branding!==previous.branding));
    const results=await Promise.all([
      seasonsChanged?transport.read('refresh-seasons',`${routes.teams}/${encodeURIComponent(captured.team)}/seasons?`+new URLSearchParams({limit:'25',...(captured.season?{preferred_season_id:captured.season}:{})})):null,
      teamsChanged?transport.read('refresh-teams',routes.teams+'?'+new URLSearchParams({limit:'50',preferred_team_id:captured.team})):null,
    ]);
    if(!state.active||epoch!==state.routeEpoch||intent!==interactionEpoch||!scopeMatches(captured)||results.some(result=>result?.discarded))return false;
    const [seasonResult,teamResult]=results;
    if(teamResult){const model=unwrap(teamResult.data),selected=selectedTeam(),pin=model.preferred_team;const teams=(model.items??[]).map(team=>({...team,seasons:team.id===state.team?selected?.seasons??[]:[]}));if(pin&&!teams.some(team=>team.id===pin.id))teams.push({...pin,seasons:selected?.seasons??[]});state.bootstrap.teams=teams;state.teamCatalog={total:model.total,revision:model.revision,branding_revision:model.branding_revision,next_cursor:model.next_cursor,cursor:null,trail:[],has_previous:false};}
    if(seasonResult&&selectedTeam()){const model=unwrap(seasonResult.data),rows=[...model.items??[]];if(model.preferred_season&&!rows.some(season=>season.id===model.preferred_season.id))rows.push(model.preferred_season);selectedTeam().seasons=rows;state.seasonCatalog={team_id:captured.team,total:model.total,revision:model.revision,next_cursor:model.next_cursor,cursor:null,trail:[],has_previous:false};}
    state.catalogRevision={...previous,...revision};if(seasonResult||teamResult)updateShell(host,shellModel());return true;
  }
  async function reloadVisible(model={}){
    const intent=interactionEpoch,captured=captureRoute();
    if(!await refreshCatalogs(model.revision??{}))return false;
    if(state.editorDirty){notice("Saved data changed. Your unsaved edits are preserved.");return;}
    if(connection.active)return false;
    const modal=state.modal;await renderView();if(intent!==interactionEpoch||!scopeMatches(captured)||state.modal!==modal)return;
    if(modal?.kind==="settings")await (handlers.actions?.settings ? handlers.actions.settings({},api) : settings());else if(modal?.kind==="calendar")await calendar();else if(modal&&handlers.refreshModal)await handlers.refreshModal(modal,api);if(intent===interactionEpoch&&handlers.refreshDetail&&state.details.length)await handlers.refreshDetail(state.details.at(-1),api);
  }
  async function action(name,data={}){
    interactionEpoch++;
    try{
      if(!state.season&&["included-games","branding-kits","branding-kits-reset","reports","report-export","award-add","calendar","tracking-capture","source-identities","trace-tracks"].includes(name)){notice("Choose a dated season first.");return;}
      if(name==="discard-confirm"||name==="discard-cancel"){resolveDiscard(name==="discard-confirm");return;}
      if(name==="back"&&pendingDiscard){resolveDiscard(false);return;}
      if(name==="close-modal"&&state.editorDirty&&["editor","inclusion","inclusion-reset","coach-editor","branding","branding-kits","branding-kits-reset","award-editor","team-editor","identity","tracks"].includes(state.modal?.kind)&&!await canLeave())return;
      if(["nav","team-select","season-select","season","close-detail","back","match","player","team","competition","match-player"].includes(name)&&!await canLeave())return;
      if(["detail-tab","h2h-range","analysis-team","analysis-period","analysis-kind","analysis-more","analysis-previous","lineup-edit","player-edit","match-edit","included-games","settings","add-team","source-manage","search","account-teams","branding-logo","branding-kits","branding-kits-reset","data-files","share-copy","status-open","usage","award-add","award-edit","team-rename","team-remove","source-identities","identity-evidence","identity-kind","trace-tracks"].includes(name)&&state.editorDirty&&!await canLeave())return;
      if(name==="nav"){if(!canView(data.view))throw new AppError("This dashboard section is not shared through this link.","share_scope_denied",403);handlers.closeDetail?.(api);state.view=data.view;state.details=[];setDetail(host,{open:false});closeModal();root()?.classList.remove("schedule-day-view");if(data.view==="schedule"&&(data.filter||data.period)){state.filters.mode="season";state.filters.type=data.filter??"all";state.filters.period=data.filter==="analyzed"?"all":data.period??"upcoming";}saveHistory();return renderView();}
      if(name==="team-select"){const prepared=await prepareContext(data.value);if(!prepared)return;installContext(prepared);saveHistory();await renderView();void refresh.start(pathFor(routes.revisions));return;}
      if(name==="season-select"||name==="season"){const prepared=await prepareContext(state.team,data.value);if(!prepared)return;installContext(prepared);if(data.boundary)state.filters.date=data.boundary==="start"?prepared.season.start_day:addDays(prepared.season.end_day,-1);saveHistory();await renderView();void refresh.start(pathFor(routes.revisions));return;}
      if(name==='teams-more')return teamsPage(data.cursor,[...state.teamCatalog?.trail??[],state.teamCatalog?.cursor??null]);
      if(name==='teams-previous'){const trail=[...state.teamCatalog?.trail??[]],cursor=trail.pop()??null;return teamsPage(cursor,trail);}
      if(name==='seasons-more')return seasonsPage(data.cursor,[...state.seasonCatalog?.trail??[],state.seasonCatalog?.cursor??null]);
      if(name==='seasons-previous'){const trail=[...state.seasonCatalog?.trail??[]],cursor=trail.pop()??null;return seasonsPage(cursor,trail);}
      if(name==="schedule-mode"){state.filters.mode=data.value;if(data.value==="day"){state.filters.type="all";state.filters.period="all";}else if(state.filters.type!=="analyzed"&&state.filters.period==="all")state.filters.period=selectedSeason()?.end_day<=localDay(selectedTeam()?.timezone)?"past":"upcoming";saveHistory(true);return renderView();}
      if(name==="schedule-filter"){state.filters.type=data.value;state.filters.mode="season";if(data.value==="analyzed")state.filters.period="all";else if(state.filters.period==="all")state.filters.period=selectedSeason()?.end_day<=localDay(selectedTeam()?.timezone)?"past":"upcoming";saveHistory(true);return renderView();}
      if(name==="schedule-period"){state.filters.period=data.value;saveHistory(true);return renderView();}
      if(name==="today"){if(!await selectScheduleDay(localDay(selectedTeam()?.timezone)))return;saveHistory(true);return renderView();}
      if(name==="day"){if(!await selectScheduleDay(data.day))return;closeModal();saveHistory(true);await renderView();animateDateView(root().querySelector(".schedule-day-surface"));return;}
      if(name==="date-shift"){if(!await selectScheduleDay(addDays(state.filters.date,Number(data.offset))))return;saveHistory(true);return renderView();}
      if(name==="calendar-month"){state.filters.date=monthStep(state.filters.date,Number(data.offset));return calendar();}
      if(name==="calendar")return calendar();
      if(name==="more")return handlers.actions?.more ? handlers.actions.more(data,api) : renderView({append:true,cursor:data.cursor});
      if(name==="settings")return handlers.actions?.settings ? handlers.actions.settings(data,api) : settings();
      if(name==="close-modal"){closeModal();return;}
      if(name==='connection-cancel'){closeModal();return;}
      if(name==='connection-resume')return resumeConnection();
      if(name==='connection-retry')return commitAttachment();
      if(name==='connection-check-saved')return checkSavedConnection();
      if(name==='connection-open-saved')return openSavedConnection();
      if(name==='connection-abandon'){connectionModal({title:'Start another connection?',kind:'connection-abandon',html:`<p class="modal-copy">The previous connection may already be saved. Starting over will keep every saved team and source link. Check your team list before connecting the same team again.</p><div class="action-row">${button('connection-abandon-confirm','Keep saved teams and start over')}${button('connection-resume','Return to pending connection')}</div>`});return;}
      if(name==='connection-abandon-confirm'){const provider=connection.value.provider,addTeam=connection.value.intent==='add';connection.clear();state.attachChoice=null;return manageSource(provider,{addTeam});}
      if(name==='connection-accounts-more'){const page=state.modal?.data;return chooseAccount({cursor:data.cursor,trail:[...page?.trail??[],page?.cursor??null]});}
      if(name==='connection-accounts-previous'){const trail=[...state.modal?.data?.trail??[]],cursor=trail.pop()??null;return chooseAccount({cursor,trail});}
      if(name==='connection-account'){connection.update({accountId:data.account,accountName:data.name});return accountTeams(data.provider,data.account);}
      if(name==='connection-sign-in'||name==='teamsnap-repair'){const attempt=connection.value?.attempt;connection.update({attempt:null,attemptExpires:null});connection.resume();if(attempt)void cancelTrace(attempt);return providerSignIn({repair:name==='teamsnap-repair'});}
      if(name==='trace-change-email'){const attempt=connection.value?.attempt;connection.update({attempt:null,attemptExpires:null});connection.resume();if(attempt)void cancelTrace(attempt);return providerSignIn();}
      if(name==='connection-refresh')return accountTeams(connection.value.provider,connection.value.accountId);
      if(name==='gotsport-search-more'||name==='gotsport-search-previous')return searchGotSport({...connection.value.draft,page:Number(data.page)});
      if(name==="source-manage")return handlers.actions?.["source-manage"] ? handlers.actions["source-manage"](data,api) : manageSource(data.provider);
      if(name==='add-team'){requireOwner();if(connection.value?.pending)return resumeConnection();openModal({title:'Add team',kind:'add-team',html:`<p class="modal-copy">Choose where to find your team.</p><div class="action-row">${['teamsnap','trace','gotsport'].map(provider=>button('connection-provider',providerLabel(provider),{data:{provider}})).join('')}</div>`});return;}
      if(name==='connection-destination'){const team=state.modal?.kind==='connection-destination'&&state.modal.data.teams.find(team=>team.id===data.id);if(!team)throw new AppError('Choose a saved team.','team_forbidden');connection.update({intent:'existing',destination:{teamId:team.id,teamName:team.name,seasonId:team.id===state.team?state.season:null},pending:null,requestId:null});if(state.attachChoice)state.attachChoice.pendingAttach=null;return connectSelectedSource();}
      if(name==='connection-destinations-more'){const page=state.modal.data;return showDestinationChoice(data.cursor,[...page.trail,page.cursor]);}
      if(name==='connection-destinations-previous'){const trail=[...state.modal.data.trail],cursor=trail.pop()??null;return showDestinationChoice(cursor,trail);}
      if(name==='connection-provider')return manageSource(data.provider,{addTeam:true});
      if(name==="search")return manageSource("gotsport",{addTeam:true});
      if(name==="account-teams")return accountTeams(data.provider,data.account);
      if(name==='account-teams-more'){const chooser=state.modal?.data;if(chooser?.account_id)return accountTeams(chooser.provider,chooser.account_id,{cursor:data.cursor,trail:[...(chooser.trail??[]),chooser.cursor],poll:false});}
      if(name==='account-teams-previous'){const chooser=state.modal?.data;if(chooser?.account_id){const trail=[...(chooser.trail??[])],cursor=trail.pop()??null;return accountTeams(chooser.provider,chooser.account_id,{cursor,trail,poll:false});}}
      if(name==="source-team-select")return sourceTeamChoice(data);
      if(name==="theme-cycle"){const intent=interactionEpoch;state.theme=["light","dark","soccer"][(["light","dark","soccer"].indexOf(state.theme)+1)%3];applyTheme(state.theme);if(handlers.saveTheme)await handlers.saveTheme(state.theme,api);if(intent===interactionEpoch&&state.modal?.kind==="settings"){if(handlers.actions?.settings)await handlers.actions.settings({},api);else await settings();}return;}
      if(name==="sign-out"){dismissConnection();connection.clear();await transport.command(routes.ownerLogout,{});refresh.stop();state.team=null;state.season=null;transport.select({role:"anonymous"});await bootstrap();return;}
      if(name==="close-detail"){const detail=state.details[0];handlers.closeDetail?.(api);state.details=[];setDetail(host,{open:false});await restoreDetailOrigin(detail);saveHistory(true);return;}
      if(name==="back"){if(state.modal){closeModal();return;}if(state.details.length){const detail=state.details.pop(),previous=state.details.at(-1);if(previous&&handlers.openDetail)await handlers.openDetail(previous,api);else {handlers.closeDetail?.(api);setDetail(host,{open:false});await restoreDetailOrigin(detail);}saveHistory(true);}return;}
      if(['match','player','match-player','competition','team'].includes(name)&&!canDetail(name))throw new AppError('These details are not shared through this link.','share_scope_denied',403);
      if(['match','player','match-player','competition'].includes(name)&&data.team_season_id&&(data.team_season_id!==state.season||(data.team_id&&data.team_id!==state.team))){const origin=captureRoute(),prepared=await prepareContext(data.team_id??state.team,data.team_season_id);if(!prepared)return;installContext(prepared);await renderView();void refresh.start(pathFor(routes.revisions));data={...data,origin};}
      if(handlers.actions?.[name])return handlers.actions[name](data,api);
      if(["match","player","team","competition","match-player"].includes(name)&&handlers.openDetail){const detail={kind:name,id:data.id,tab:data.tab??"overview",origin:captureRoute(),...data};state.details.push(detail);saveHistory();return handlers.openDetail(detail,api);}
      notice("This action is unavailable for the selected saved record.");
    }catch(error){showError(error);}
  }
  async function submit(name,form,event){
    interactionEpoch++;
    const controls=[...event.target.querySelectorAll("button[type=submit]")];controls.forEach(node=>node.disabled=true);
    try{
      if(name==="owner-login"){
        if(isMaintenance()){event.target.querySelector('[name="key"]').value='';form.delete('key');return;}
        let password=String(form.get("key")??"");event.target.querySelector('[name="key"]').value="";
        try{
          const initializing=needsInitialization();let done=false;
          for(let step=0;step<100;step++){
            const result=await transport.command(initializing?routes.ownerInitialize:routes.ownerLogin,{password});
            if(result.data.continue){const help=host.querySelector("#loginText");if(help)help.textContent=`Initializing myTS · ${result.data.setup?.progress??0}%`;continue;}done=true;break;
          }
          if(!done)throw new AppError("Initialization has not finished. Sign in again to resume.","setup_incomplete");
          await bootstrap();if(role()==='owner'&&connection.value)await resumeConnection();
        }finally{password=null;form.delete("key");}
      }else if(name==="teamsnap-authorize")await authorizeTeamSnap(String(form.get("client_id")??"").trim());
      else if(name==='trace-send-code')await sendTraceCode(form);
      else if(name==='trace-verify-code')await verifyTraceCode(form,event);
      else if(name==='gotsport-search')await searchGotSport({q:form.get('q'),state:form.get('state'),age:form.get('age'),gender:form.get('gender'),page:1});
      else if(name==='source-club-choice'){if(!form.get('confirmed'))throw new AppError('Confirm the shared teams affected by this choice.','club_choice_confirmation_required');await commitAttachment(String(form.get('keep')??''));}
      else if(handlers.forms?.[name])await handlers.forms[name](form,{...event.target.dataset},api);
      else throw new AppError("This form has not been connected in this review build yet.","workflow_unimplemented");
    }catch(error){if(name==="owner-login"){
      // Read the persisted phase after failure or a lost response so the next
      // attempt resumes owner setup/sign-in and never displays an old cursor.
      try{await bootstrap();}catch{const help=host.querySelector("#loginText");if(help)help.textContent="Sign in again to resume.";}
      const node=host.querySelector("#loginError");node.textContent=error.message;node.classList.remove("hidden");
    }else if(connection.active)connectionError(error);else showError(error);}
    finally{controls.forEach(node=>node.disabled=false);}
  }
  const api={state,transport,host,context,selection,pathFor,applyCapabilities,action,bootstrap,renderView,refreshSavedState:reloadVisible,checkMaintenance,settings,canView,hydrateModel,followSourceTeam,changeConnectionScope,manageSource,accountTeams,searchGotSport,resumeConnection,connection,openModal,closeModal,setDetail:options=>{setDetail(host,options);applyCapabilities();},requireOwner,notice,showError,captureRoute,canLeave};
  return {
    ...api,
    async start(){state.active=true;mountShell(host,{mode:"login",owner_login:false,login_title:"Opening myTS",login_help:"Checking your saved dashboard…"});unbind=bindShell(host,{onAction:action,onSubmit:submit,onInput:(name,value,event)=>{if(connection.active&&event.target.closest('form')?.dataset.form==='gotsport-search'&&['q','state','age','gender'].includes(name))connection.update({draft:{...connection.value.draft,[name]:value}});if(handlers.inputs?.[name])handlers.inputs[name](value,api,event);else if(["player-correction","match-correction","included-games","coach-profile","coach-availability","coach-clock-correction","branding-kits","branding-logo","award-save","team-rename"].includes(event.target.closest("form")?.dataset.form))state.editorDirty=true;},onInteraction:(name,event)=>handlers.interactions?.[name]?.(event,api)});window.addEventListener("popstate",restoreHistory);transport.select({role:"anonymous",viewer:!!viewerToken});discoveryTransport.select({role:"anonymous"});try{if(!await oauthReturn()){await bootstrap();if(role()==='owner'&&connection.value)await resumeConnection();}}catch(error){const loginError=host.querySelector("#loginError");loginError.textContent=error.message;loginError.classList.remove("hidden");updateShell(host,{...shellModel(),login_error:error.message});showError(error);}return api;},
    stop(){connection.dismiss();if(maintenanceOAuth)for(const key of Object.keys(maintenanceOAuth))maintenanceOAuth[key]=null;maintenanceOAuth=null;clearTimeout(maintenanceTimer);maintenanceTimer=null;clearTimeout(toastTimer);logoCache.clear();state.active=false;handlers.cleanup?.(api);state.routeEpoch++;refresh.stop();discoveryRefresh.stop();transport.abortAll();discoveryTransport.abortAll();window.removeEventListener("popstate",restoreHistory);unbind?.();gestureCleanup?.();modalGestureCleanup?.();state.traceAttempt=null;state.attachChoice=null;if(pendingDiscard)resolveDiscard(false);},
  };
}
export async function startApp(options={}){const app=createApp(options);await app.start();return app;}
