import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../web/app/main.js';
import {createFeatureBridge} from '../web/app/features.js';
import {createDataFileController} from '../web/app/data-files.js';
import {createTrackingCaptureController} from '../web/app/tracking-capture.js';
import {createReportsController} from '../web/app/reports.js';

// Deterministic, in-process DOM integration. No browser, listener, provider, or
// account is used. To run without changing the application's dependencies:
// npm install --prefix /tmp/myts-dom-harness --cache /tmp/myts-dom-npm-cache \
//   --no-save --package-lock=false --ignore-scripts jsdom@26.1.0
// MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom/lib/api.js \
//   node --test tests/connection-ui.test.mjs
const require=createRequire(import.meta.url);
let domModule;
try {domModule=require(process.env.MYTS_JSDOM_MODULE||'jsdom');}
catch(error) {if(process.env.MYTS_JSDOM_MODULE)throw error;}
const uiTest=(name,run)=>test(name,{skip:domModule?false:'Set MYTS_JSDOM_MODULE to a jsdom installation for deterministic DOM integration.',concurrency:false},run);
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const failure=(code,message,status=401)=>response({error:{code,message}},status);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label='UI transition') {for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail(`Timed out waiting for ${label}`);}
const team=(id='destination-a',name='Existing team')=>({id,name,timezone:'UTC',seasons:[{id:`${id}-season`,label:'2026–2027',year:2026,start_day:'2026-06-01',end_day:'2027-06-01'}]});
const account=(provider='trace',id='account-a',name='Coach account')=>({id,provider,name,display_name:name,label:name,active:true,authorization_state:'connected'});
const source=(provider='trace',id='source-a',name='United U12')=>({id,provider,name,season_label:'2026-2027'});

async function fixture({accounts=[],teams=[],sourceTeams=[source()],resolve:resolveRequest=()=>{},storage=null,role='owner',categories=['overview'],maintenanceInterval=5000,url='https://myts.example/admin'}={}) {
  const {JSDOM,VirtualConsole}=domModule,errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url,virtualConsole,pretendToBeVisual:true});
  const saved=new Map(),set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
  const redirects=[];
  for(const key of ['window','document','history','sessionStorage','localStorage','FormData','AbortController','AbortSignal','HTMLElement','Element','Node','Event','MouseEvent','CustomEvent'])set(key,key==='window'?dom.window:dom.window[key]);
  set('location',{get origin(){return dom.window.location.origin;},get pathname(){return dom.window.location.pathname;},get search(){return dom.window.location.search;},get hash(){return dom.window.location.hash;},set hash(value){dom.window.location.hash=value;},assign:url=>redirects.push(url)});
  for(const [key,value] of Object.entries(storage??{}))dom.window.sessionStorage.setItem(key,value);
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  const calls=[],unexpected=[],model={accounts,teams,sourceTeams,role,categories},fetcher=async(path,options={})=>{
    const url=new URL(path,'https://myts.example'),call={path:url.pathname,url,method:options.method??'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers??{},signal:options.signal};
    calls.push(call);
    const overridden=await resolveRequest(call,model,calls);
    if(overridden!==undefined)return overridden instanceof Response?overridden:response(overridden);
    if(call.path==='/api/bootstrap')return response({version:'connection-ui-fixture',setup:{state:'ready',owner_ready:true},session:{role:model.role,categories:model.categories},teams:structuredClone(model.teams),preferences:{theme:'light'}});
    if(/^\/api\/teams\/[^/]+\/seasons$/.test(call.path)){const row=model.teams.find(team=>team.id===decodeURIComponent(call.path.split('/')[3]));return response({items:structuredClone(row?.seasons??[]),total:row?.seasons?.length??0,revision:1,next_cursor:null,preferred_season:row?.seasons?.find(season=>season.id===call.url.searchParams.get('preferred_season_id'))??null});}
    if(call.path==='/api/teams'&&call.method==='GET')return response({items:structuredClone(model.teams),total:model.teams.length,revision:1,next_cursor:null,preferred_team:structuredClone(model.teams.find(team=>team.id===call.url.searchParams.get('preferred_team_id'))??null)});
    if(call.path==='/api/connections'&&call.method==='POST'){let row=model.teams.find(team=>team.id===call.body.team_id);if(!row){row={id:'connected-team',name:call.body.new_team.name,timezone:call.body.new_team.timezone,seasons:[]};model.teams.push(row);}return response({team_id:row.id,season_id:row.seasons[0]?.id??null,connection_id:'connection-root',queued:true});}
    if(call.path==='/api/accounts')return response({accounts:structuredClone(model.accounts)});
    if(/^\/api\/accounts\/[^/]+\/teams$/.test(call.path))return response({teams:structuredClone(model.sourceTeams),total:model.sourceTeams.length,discovery:{state:'ready'}});
    if(call.path.endsWith('/revisions'))return response({revision:1});
    if(call.path==='/api/overview')return response({data:{}});
    if(call.path==='/api/status')return response({data:{providers:[],attachments:[]}});
    if(call.path==='/api/accounts/trace/cancel')return response({cancelled:true});
    if(call.path==='/api/accounts/teamsnap/config')return response({requires_client_id:false});
    unexpected.push(call);return failure('unexpected_fixture_route',`Unexpected fixture route: ${call.method} ${call.path}`,500);
  };
  let app;
  const mount=async()=>{const hooks=createFeatureBridge({dataFiles:createDataFileController(),reports:createReportsController({fetcher}),trackingCapture:createTrackingCaptureController({fetcher})});app=createApp({...hooks,host:dom.window.document.body,fetcher,maintenanceInterval});await app.start();return app;};
  const query=selector=>dom.window.document.querySelector(selector);
  const click=async(selector)=>{const node=query(selector);assert.ok(node,`Missing clickable element: ${selector}`);assert.notEqual(node.disabled,true,`Disabled element: ${selector}`);node.click();await tick();};
  const fill=(selector,value)=>{const node=query(selector);assert.ok(node,`Missing field: ${selector}`);node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  const submit=async(selector)=>{const form=query(selector);assert.ok(form,`Missing form: ${selector}`);form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();};
  try {await mount();}catch(error){for(const [key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];dom.window.close();throw error;}
  return {get app(){return app;},dom,calls,model,redirects,query,click,fill,submit,async reload(){app.stop();dom.window.document.body.innerHTML='';return mount();},savedStorage(){return Object.fromEntries(Object.keys(dom.window.sessionStorage).map(key=>[key,dom.window.sessionStorage.getItem(key)]));},async close(){app.stop();dom.window.close();for(const [key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];assert.deepEqual(unexpected.map(call=>`${call.method} ${call.path}`),[]);assert.deepEqual(errors,[]);}};
}
async function withUI(options,run){const ui=await fixture(options);try{await run(ui);}finally{await ui.close();}}
const hasCall=(ui,path)=>ui.calls.some(call=>call.path===path);
const root=(provider,extra={})=>({id:provider+'-root',provider,app_team_id:'destination-a',source_team_id:provider+'-source',name:provider+' source',active:true,account_id:provider==='gotsport'?null:provider+'-account',authorization_state:provider==='gotsport'?'public':'connected',generation:3,seasons:[{id:'destination-a-season',year:2026,active:true,excluded:false,attachment_id:provider+'-attachment'}],...extra});
const status=(connections=[root('teamsnap'),root('gotsport'),root('trace')])=>({data:{providers:connections.map(row=>({provider:row.provider,total:1,groups:[{stage:'source',state:'ready',coverage:'complete',count:1}]})),connections,connections_page:{total:connections.length},jobs:{items:[],total:0}}});
async function manage(ui,provider){await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');await ui.click(`[data-action="source-manage"][data-provider="${provider}"]`);await until(()=>ui.app.state.modal?.kind==='source-status');assert.equal(ui.app.state.modal.data.provider,provider);assert.equal(ui.query('#accountModalTitle').textContent,({teamsnap:'TeamSnap',trace:'Trace',gotsport:'GotSport'})[provider]+' · Manage');}



uiTest('ordinary Settings Manage leads with each provider controls, never generic team settings',async()=>{
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?status():undefined},async ui=>{
  for(const [provider,expected] of [['teamsnap',['Sync now','Reconnect']],['trace',['Connection','Check for updates','Import data','Export data','Export source evidence','Tracking evidence']],['gotsport',['Club logo','Club kits']]]){
   await manage(ui,provider);
   const buttons=[...ui.query('#accountBody').querySelectorAll('button')].map(node=>node.textContent.trim());
   assert.deepEqual(buttons.slice(0,expected.length),expected);
   if(provider!=='gotsport'){assert.equal(ui.query('[data-action="branding-logo"]'),null);assert.equal(ui.query('[data-action="branding-kits"]'),null);}
   else{assert.equal(ui.query('[data-action="source-reconnect"]'),null);assert.equal(ui.query('[data-action="account-teams"]'),null);assert.equal(ui.query('[data-action="account-disconnect"]'),null);}
   await ui.click('[data-close="accountModal"]');
  }
  assert.ok(ui.calls.every(call=>call.method==='GET'));
 });
});

for(const provider of ['teamsnap','trace','gotsport'])uiTest(`disconnected ${provider} Manage stays a provider sheet until its explicit connection action`,async()=>{
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?status([]):undefined},async ui=>{
  await manage(ui,provider);
  assert.equal(ui.app.connection.value,null);assert.equal(hasCall(ui,'/api/accounts'),false);
  assert.ok(ui.calls.every(call=>call.method==='GET'));
  if(provider==='gotsport')assert.ok(ui.query('form[data-form="gotsport-search"]'));
  else{
   assert.equal(ui.query('[data-action="source-sync"]').disabled,true);
   await ui.click(provider==='trace'?'[data-action="source-connect"]':'[data-action="source-reconnect"]');
   await until(()=>ui.app.state.modal?.kind===(provider==='trace'?'trace-auth':'teamsnap-auth'));
   assert.equal(ui.app.connection.value.provider,provider);
   assert.equal(hasCall(ui,provider==='trace'?'/api/accounts/teamsnap/config':'/api/accounts/trace/start'),false);
   await ui.click('[data-action="connection-cancel"]');assert.equal(ui.app.connection.value,null);
  }
 });
});

uiTest('Trace Connection reuses only Trace accounts; Reconnect enters only its email flow; TeamSnap keeps OAuth',async()=>{
 await withUI({teams:[team()],accounts:[account('teamsnap','teamsnap-account'),account('trace','trace-account')],resolve:call=>call.path==='/api/status'?status():undefined},async ui=>{
  await manage(ui,'trace');await ui.click('[data-action="source-connect"]');await until(()=>ui.app.state.modal?.kind==='source-teams');
  assert.equal(ui.app.state.modal.data.provider,'trace');assert.ok(hasCall(ui,'/api/accounts/trace-account/teams'));assert.equal(hasCall(ui,'/api/accounts/teamsnap-account/teams'),false);
  await ui.click('[data-action="connection-cancel"]');await manage(ui,'trace');await ui.click('[data-action="source-reconnect"]');
  await until(()=>ui.query('form[data-form="trace-send-code"]'));assert.equal(ui.app.connection.value.provider,'trace');
  await ui.click('[data-action="connection-cancel"]');await manage(ui,'teamsnap');await ui.click('[data-action="source-reconnect"]');
  await until(()=>ui.query('form[data-form="teamsnap-authorize"]'));assert.equal(ui.app.connection.value.provider,'teamsnap');
  assert.ok(hasCall(ui,'/api/accounts/teamsnap/config'));assert.ok(ui.calls.every(call=>call.method==='GET'));
 });
});

uiTest('GotSport Save team uses public resolve and the exact reviewed candidate with no private account calls',async()=>{
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status')return status();
  if(call.path==='/api/sources/gotsport/resolve')return {teams:[source('gotsport','public-new','Public new')]};
 }},async ui=>{
  await manage(ui,'gotsport');ui.fill('[name="q"]','12345');await ui.submit('form[data-form="gotsport-search"]');
  await until(()=>ui.query('[data-action="source-team-select"]'));assert.equal(ui.app.connection.value.provider,'gotsport');
  assert.deepEqual(ui.calls.find(call=>call.path==='/api/sources/gotsport/resolve').body,{url:'12345'});
  assert.equal(ui.calls.some(call=>call.path.startsWith('/api/accounts')),false);
  assert.equal(hasCall(ui,'/api/connections'),false,'The public result must be reviewed before it is attached.');
  await ui.click('[data-action="source-team-select"][data-id="public-new"]');await until(()=>hasCall(ui,'/api/connections'));
  const saved=ui.calls.find(call=>call.path==='/api/connections');assert.equal(saved.body.source_team_id,'public-new');assert.equal(saved.body.team_id,'destination-a');assert.equal(saved.body.account_id,null);
  assert.equal(ui.calls.some(call=>call.method==='DELETE'||call.path.endsWith('/sync')),false);
 });
});

for(const dismissal of ['close','back','history'])uiTest(`late Manage status cannot reopen after ${dismissal}`,async()=>{
 const held=deferred();let requests=0;
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?(++requests===2?held.promise:status()):undefined},async ui=>{
  await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');
  await ui.click('[data-action="source-manage"][data-provider="trace"]');await until(()=>requests===2);
  if(dismissal==='close')await ui.click('[data-close="accountModal"]');
  else if(dismissal==='back')await ui.app.action('back');
  else{ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route:{...ui.app.captureRoute(),details:[]}}}));await until(()=>ui.app.state.modal===null);}
  held.resolve(status());for(let i=0;i<5;i++)await tick();assert.equal(ui.app.state.modal,null);assert.equal(ui.app.connection.value,null);
 });
});

uiTest('newer GotSport Manage wins over a late Trace reply with exact provider isolation',async()=>{
 const held=deferred();let requests=0;
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?(++requests===2?held.promise:status()):undefined},async ui=>{
  await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');
  await ui.click('[data-action="source-manage"][data-provider="trace"]');await until(()=>requests===2);
  await ui.click('[data-action="source-manage"][data-provider="gotsport"]');await until(()=>ui.app.state.modal?.kind==='source-status');
  held.resolve(status());for(let i=0;i<5;i++)await tick();assert.equal(ui.app.state.modal.data.provider,'gotsport');assert.ok(ui.query('form[data-form="gotsport-search"]'));assert.equal(ui.query('[data-action="source-reconnect"]'),null);
 });
});

uiTest('expired Trace keeps saved history separate from authorization and complete source jobs',async()=>{
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?status([root('trace',{authorization_state:'expired'})]):undefined},async ui=>{
  await manage(ui,'trace');assert.match(ui.query('#accountBody').textContent,/Reconnect required · Saved data available/);assert.equal(ui.query('[data-action="source-sync"]').disabled,true);assert.doesNotMatch(ui.query('#accountBody').textContent,/Source update complete|Analyzed|1 ready/);
 });
});

uiTest('Trace source completion does not claim analysis publication or an analyzed count',async()=>{
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status')return status([root('trace')]);
  if(call.path==='/api/overview')return {projection_pending:true,data:{stats:{analyzed:0}}};
 }},async ui=>{
  assert.match(ui.query('#root').textContent,/Saved data is updating in the background/);
  await manage(ui,'trace');assert.match(ui.query('#accountBody').textContent,/Source update complete/);assert.doesNotMatch(ui.query('#accountBody').textContent,/Analyzed|Latest update complete|1 ready/);
 });
});

uiTest('genuinely interrupted Trace reconnect restores its challenge without persisting the email or code',async()=>{
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status')return status();
  if(call.path==='/api/accounts/trace/start')return {attempt:'interrupted-attempt',expires_at:Date.now()+600000};
  if(call.path==='/api/accounts/trace/attempt')return {attempt:'interrupted-attempt',stage:'code'};
 }},async ui=>{
  await manage(ui,'trace');await ui.click('[data-action="source-reconnect"]');await until(()=>ui.query('form[data-form="trace-send-code"]'));
  ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');await until(()=>ui.query('form[data-form="trace-verify-code"]'));
  ui.fill('[name="code"]','938475');assert.doesNotMatch(JSON.stringify(ui.savedStorage()),/synthetic@example|938475/);
  await ui.reload();assert.equal(ui.app.state.modal.kind,'trace-auth');assert.ok(ui.query('form[data-form="trace-verify-code"]'));assert.equal(ui.app.connection.value.provider,'trace');assert.equal(ui.app.connection.value.attempt,'interrupted-attempt');
  assert.equal(ui.query('[name="code"]').value,'');assert.equal(ui.calls.filter(call=>call.path==='/api/accounts/trace/start').length,1);
  assert.equal(ui.calls.find(call=>call.path==='/api/accounts/trace/attempt').url.searchParams.get('attempt'),'interrupted-attempt');
  await ui.click('[data-action="connection-cancel"]');await until(()=>hasCall(ui,'/api/accounts/trace/cancel'));await ui.reload();assert.equal(ui.app.state.modal,null);assert.equal(ui.app.connection.value,null);
 });
});

uiTest('a late reconnect reply cannot replace a newer provider Manage sheet',async()=>{
 const held=deferred();
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status')return status();
  if(call.path==='/api/accounts/trace/start')return held.promise;
 }},async ui=>{
  await manage(ui,'trace');await ui.click('[data-action="source-reconnect"]');await until(()=>ui.query('form[data-form="trace-send-code"]'));
  ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');await until(()=>hasCall(ui,'/api/accounts/trace/start'));
  await ui.click('[data-action="connection-cancel"]');await manage(ui,'teamsnap');held.resolve({attempt:'late-manage-attempt',expires_at:Date.now()+600000});
  await until(()=>hasCall(ui,'/api/accounts/trace/cancel'));assert.equal(ui.app.state.modal.kind,'source-status');assert.equal(ui.app.state.modal.data.provider,'teamsnap');assert.equal(ui.query('form[data-form="trace-verify-code"]'),null);assert.equal(ui.app.connection.value,null);
 });
});

uiTest('Manage connection actions preserve an uncertain command and its original provider and request ID',async()=>{
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status')return status();
  if(call.path==='/api/sources/gotsport/resolve')return {teams:[source('gotsport','public-pending','Public pending')]};
  if(call.path==='/api/connections'&&call.method==='POST')return failure('temporarily_unavailable','The response was lost.',503);
 }},async ui=>{
  await manage(ui,'gotsport');ui.fill('[name="q"]','12345');await ui.submit('form[data-form="gotsport-search"]');await until(()=>ui.query('[data-action="source-team-select"]'));
  await ui.click('[data-action="source-team-select"]');await until(()=>ui.app.state.modal?.kind==='connection-pending');
  const original=structuredClone(ui.app.connection.value.pending);assert.ok(original.requestId);assert.equal(original.body.request_id,original.requestId);
  await ui.click('[data-action="connection-cancel"]');await manage(ui,'trace');await ui.click('[data-action="source-connect"]');
  await until(()=>ui.app.state.modal?.kind==='connection-pending');assert.equal(ui.app.connection.value.provider,'gotsport');assert.deepEqual(ui.app.connection.value.pending,original);
  await ui.click('[data-action="connection-retry"]');await until(()=>ui.calls.filter(call=>call.path==='/api/connections').length===2);
  assert.deepEqual(ui.calls.filter(call=>call.path==='/api/connections').map(call=>call.body),[original.body,original.body]);
  assert.equal(ui.calls.some(call=>call.path.startsWith('/api/accounts')),false);
 });
});

for(const provider of ['teamsnap','trace'])uiTest(`${provider} update targets only the chosen provider connection`,async()=>{
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status')return status();
  if(call.path===`/api/connections/${provider}-root/sync`)return {queued:true};
 }},async ui=>{
  await manage(ui,provider);await ui.click('[data-action="source-sync"]');await until(()=>ui.calls.some(call=>call.method==='POST'));
  assert.deepEqual(ui.calls.filter(call=>call.method==='POST').map(call=>call.path),[`/api/connections/${provider}-root/sync`]);
  assert.equal(ui.app.state.modal.data.provider,provider);
 });
});

for(const dismissal of ['close','escape','backdrop','back'])uiTest(`provider ${dismissal} returns to Settings and restores its exact opener`,async()=>{
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?status():undefined},async ui=>{
  await manage(ui,'trace');const historyLength=ui.dom.window.history.length;
  if(dismissal==='close')await ui.click('[data-close="accountModal"]');
  else if(dismissal==='escape'){ui.dom.window.document.body.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();}
  else if(dismissal==='backdrop')await ui.click('#accountModal');
  else await ui.app.action('back');
  assert.equal(ui.app.state.modal.kind,'settings');assert.equal(ui.query('#accountModalTitle').textContent,'Settings');assert.equal(ui.dom.window.document.activeElement.dataset.provider,'trace');assert.equal(ui.dom.window.history.length,historyLength);
  assert.equal(ui.app.connection.value,null);assert.ok(ui.calls.every(call=>call.method==='GET'));
  await ui.click('[data-close="accountModal"]');assert.equal(ui.app.state.modal,null);
 });
});

uiTest('source sheet dismissal respects an existing dirty confirmation before restoring Settings',async()=>{
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?status():undefined},async ui=>{
  await manage(ui,'trace');ui.app.state.editorDirty=true;
  await ui.click('[data-close="accountModal"]');assert.equal(ui.query('#confirmModal').classList.contains('hidden'),false);
  await ui.click('#confirmCancel');assert.equal(ui.app.state.modal.kind,'source-status');assert.equal(ui.app.state.editorDirty,true);
  await ui.click('[data-close="accountModal"]');await ui.click('#confirmAction');await until(()=>ui.app.state.modal?.kind==='settings');assert.equal(ui.app.state.editorDirty,false);
 });
});

uiTest('explicit navigation drops the provider parent and a late update cannot restore it',async()=>{
 const held=deferred();
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status')return status();
  if(call.path==='/api/connections/trace-root/sync')return held.promise;
 }},async ui=>{
  await manage(ui,'trace');await ui.click('[data-action="source-sync"]');await until(()=>hasCall(ui,'/api/connections/trace-root/sync'));
  await ui.click('[data-action="nav"][data-view="overview"]');await until(()=>ui.app.state.modal===null);held.resolve({queued:true});for(let i=0;i<5;i++)await tick();
  assert.equal(ui.app.state.modal,null);assert.equal(ui.app.state.view,'overview');assert.equal(ui.query('#accountModal').classList.contains('hidden'),true);
 });
});

uiTest('returning to Settings after Sync replaces the old complete headline with authoritative queued status',async()=>{
 let queued=false;
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status'){const model=status();if(queued)model.data.providers.find(row=>row.provider==='trace').groups[0].state='queued';return model;}
  if(call.path==='/api/connections/trace-root/sync'){queued=true;return {queued:true};}
 }},async ui=>{
  await manage(ui,'trace');assert.match(ui.query('#accountBody').textContent,/Source update complete/);
  await ui.click('[data-action="source-sync"]');await until(()=>/Update queued/.test(ui.query('#accountBody').textContent));
  await ui.click('[data-close="accountModal"]');await until(()=>ui.app.state.modal?.kind==='settings'&&ui.query('[data-action="source-manage"][data-provider="trace"]').closest('.account-source').textContent.includes('Update queued'));
  assert.equal(ui.dom.window.document.activeElement.dataset.provider,'trace');
 });
});

for(const next of ['close','navigation','provider'])uiTest(`late restored Settings refresh cannot replace a newer ${next}`,async()=>{
 const held=deferred();let reads=0;
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?(++reads===3?held.promise:status()):undefined},async ui=>{
  await manage(ui,'trace');await ui.click('[data-close="accountModal"]');await until(()=>reads===3);assert.equal(ui.app.state.modal.kind,'settings');
  if(next==='close')await ui.click('[data-close="accountModal"]');
  else if(next==='navigation')await ui.click('[data-action="nav"][data-view="overview"]');
  else{await ui.click('[data-action="source-manage"][data-provider="gotsport"]');await until(()=>ui.app.state.modal?.data.provider==='gotsport');}
  held.resolve(status());for(let i=0;i<6;i++)await tick();
  if(next==='provider'){assert.equal(ui.app.state.modal.kind,'source-status');assert.equal(ui.app.state.modal.data.provider,'gotsport');assert.ok(ui.query('form[data-form="gotsport-search"]'));}
  else assert.equal(ui.app.state.modal,null);
 });
});

uiTest('failed Settings refresh preserves usable controls without restoring a stale complete headline',async()=>{
 const held=deferred();let reads=0;
 await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?(++reads===3?held.promise:status()):undefined},async ui=>{
  await manage(ui,'trace');await ui.click('[data-close="accountModal"]');await until(()=>reads===3);
  const summary=()=>ui.query('[data-action="source-manage"][data-provider="trace"]').closest('.account-source').querySelector('.source-summary').textContent;
  assert.equal(summary(),'Checking source status…');held.resolve(failure('temporary_failure','Try again shortly.',503));await until(()=>summary()==='Update status unavailable');
  assert.equal(ui.app.state.modal.kind,'settings');assert.equal(ui.dom.window.document.activeElement.dataset.provider,'trace');assert.match(ui.query('#toast').textContent,/Try again shortly/);
  await ui.click('[data-action="source-manage"][data-provider="trace"]');await until(()=>ui.app.state.modal?.kind==='source-status');assert.match(ui.query('#accountBody').textContent,/Source update complete/);
 });
});
