import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../web/app/main.js';
import {createFeatureBridge} from '../web/app/features.js';
import {createDataFileController} from '../web/app/data-files.js';
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
  const mount=async()=>{const hooks=createFeatureBridge({dataFiles:createDataFileController(),reports:createReportsController({fetcher})});app=createApp({...hooks,host:dom.window.document.body,fetcher,maintenanceInterval});await app.start();return app;};
  const query=selector=>dom.window.document.querySelector(selector);
  const click=async(selector)=>{const node=query(selector);assert.ok(node,`Missing clickable element: ${selector}`);assert.notEqual(node.disabled,true,`Disabled element: ${selector}`);node.click();await tick();};
  const fill=(selector,value)=>{const node=query(selector);assert.ok(node,`Missing field: ${selector}`);node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  const submit=async(selector)=>{const form=query(selector);assert.ok(form,`Missing form: ${selector}`);form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();};
  try {await mount();}catch(error){for(const [key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];dom.window.close();throw error;}
  return {get app(){return app;},dom,calls,model,redirects,query,click,fill,submit,async reload(){app.stop();dom.window.document.body.innerHTML='';return mount();},savedStorage(){return Object.fromEntries(Object.keys(dom.window.sessionStorage).map(key=>[key,dom.window.sessionStorage.getItem(key)]));},async close(){app.stop();dom.window.close();for(const [key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];assert.deepEqual(unexpected.map(call=>`${call.method} ${call.path}`),[]);assert.deepEqual(errors,[]);}};
}
async function withUI(options,run){const ui=await fixture(options);try{await run(ui);}finally{await ui.close();}}
const hasCall=(ui,path)=>ui.calls.some(call=>call.path===path);

uiTest('original Overview shortcuts enter season scope and Day clears invisible filters',async()=>{
 await withUI({teams:[team()],resolve:call=>{
   if(call.path==='/api/schedule')return {data:{items:[],total:0}};
   if(call.path==='/api/calendar')return {data:{days:[]}};
 }},async ui=>{
   await ui.app.action('nav',{view:'schedule',period:'upcoming'});
   let last=ui.calls.filter(call=>call.path==='/api/schedule').at(-1);assert.equal(last.url.searchParams.get('mode'),'season');assert.equal(last.url.searchParams.get('type'),'all');assert.equal(last.url.searchParams.get('period'),'upcoming');
   await ui.app.action('nav',{view:'schedule',period:'past',filter:'games'});
   last=ui.calls.filter(call=>call.path==='/api/schedule').at(-1);assert.equal(last.url.searchParams.get('mode'),'season');assert.equal(last.url.searchParams.get('period'),'past');assert.equal(last.url.searchParams.get('type'),'games');
   await ui.app.action('nav',{view:'schedule',filter:'analyzed'});
   assert.equal(ui.app.state.filters.period,'all');assert.equal(ui.app.state.filters.type,'analyzed');
   await ui.app.action('schedule-mode',{value:'day'});
   last=ui.calls.filter(call=>call.path==='/api/schedule').at(-1);assert.equal(last.url.searchParams.get('mode'),'day');assert.equal(last.url.searchParams.get('type'),'all');assert.equal(last.url.searchParams.get('period'),'all');
   await ui.app.action('schedule-filter',{value:'analyzed'});assert.equal(ui.app.state.filters.mode,'season');assert.equal(ui.app.state.filters.period,'all');
   await ui.app.action('day',{day:'2026-10-12'});assert.equal(ui.app.state.filters.type,'all');assert.equal(ui.app.state.filters.period,'all');
 });
});

uiTest('theme cycling retains the complete original Settings controls and provider rows',async()=>{
 let theme='light',revision=0;
 await withUI({teams:[team()],resolve:call=>{
   if(call.path==='/api/preferences'){if(call.method==='PATCH'){theme=call.body.theme;revision++;}return {theme,revision};}
 }},async ui=>{
   await ui.app.action('settings');const actions=()=>[...ui.query('#accountBody').querySelectorAll('[data-action]')].map(node=>node.dataset.action).sort();
   const original=actions();for(const name of ['data-files','source-identities','team-rename','team-remove','status-open'])assert.ok(original.includes(name),name);
   for(const expected of ['dark','soccer','light']){await ui.app.action('theme-cycle');assert.equal(ui.app.state.theme,expected);assert.equal(ui.app.state.modal.kind,'settings');assert.deepEqual(actions(),original);assert.deepEqual([...ui.query('#accountBody').querySelectorAll('[data-action="source-manage"]')].map(node=>node.dataset.provider).sort(),['gotsport','teamsnap','trace']);}
 });
});

uiTest('calendar and date-strip navigation cross saved June season boundaries without clamping',async()=>{
 const row=team();row.seasons.push({id:'next-season',label:'2027–2028',year:2027,start_day:'2027-06-01',end_day:'2028-06-01'});
 await withUI({teams:[row],resolve:call=>{
   if(call.path==='/api/schedule')return {data:{items:[],total:0}};
   if(call.path==='/api/calendar')return {data:{days:[]}};
 }},async ui=>{
   await ui.app.action('nav',{view:'schedule'});await ui.app.action('day',{day:'2027-06-01'});
   assert.equal(ui.app.state.season,'next-season');assert.equal(ui.app.state.filters.date,'2027-06-01');
   let last=ui.calls.filter(call=>call.path==='/api/schedule').at(-1);assert.equal(last.url.searchParams.get('team_season_id'),'next-season');assert.equal(last.url.searchParams.get('date'),'2027-06-01');
   await ui.app.action('date-shift',{offset:-1});assert.equal(ui.app.state.season,row.seasons[0].id);assert.equal(ui.app.state.filters.date,'2027-05-31');
   assert.equal(ui.dom.window.history.state.route.filters.date,'2027-05-31');
   const before=ui.calls.filter(call=>call.path==='/api/schedule').length;await ui.app.action('day',{day:'2029-06-01'});
   assert.equal(ui.app.state.filters.date,'2027-05-31');assert.equal(ui.calls.filter(call=>call.path==='/api/schedule').length,before);assert.match(ui.query('#toast').textContent,/no saved season/i);
   assert.equal(ui.calls.some(call=>call.method==='POST'&&call.path.includes('season')),false);
 });
});

uiTest('historical trophy details load their recorded season and Back restores the original context',async()=>{
 const row=team();row.seasons.push({id:'historical-season',label:'2023–2024',year:2023,start_day:'2023-06-01',end_day:'2024-06-01'});
 await withUI({teams:[row],resolve:call=>call.path==='/api/competitions/historic-cup'?{data:{competition:{id:'historic-cup',name:'Historical Cup'},divisions:[],events:{items:[]},standings:{pools:[]}}}:undefined},async ui=>{
  const original=ui.app.state.season;await ui.app.action('competition',{id:'historic-cup',tab:'standings',team_season_id:'historical-season'});
  assert.equal(ui.app.state.season,'historical-season');const call=ui.calls.find(call=>call.path==='/api/competitions/historic-cup');assert.equal(call.url.searchParams.get('team_season_id'),'historical-season');assert.equal(call.url.searchParams.get('tab'),'standings');
  await ui.app.action('close-detail');assert.equal(ui.app.state.season,original);assert.equal(ui.app.state.details.length,0);
 });
});

uiTest('connection harness mounts the real owner shell without contacting a provider',async()=>{
  await withUI({},async ui=>{
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
    assert.equal(ui.query('#app').classList.contains('hidden'),false);
    assert.ok(ui.query('[data-action="source-manage"][data-provider="trace"]'));
    assert.deepEqual(ui.calls.map(call=>call.path),['/api/bootstrap']);
  });
});

for(const provider of ['trace','teamsnap'])uiTest(`${provider} reuses its one named connected account without requesting sign-in`,async()=>{
  await withUI({accounts:[account(provider)],sourceTeams:[source(provider)]},async ui=>{
    await ui.click(`[data-action="source-manage"][data-provider="${provider}"]`);
    await until(()=>ui.query('[data-action="source-team-select"]'),'saved account team choices');
    assert.match(ui.query('#accountBody').textContent,/Coach account/);
    assert.equal(ui.app.state.modal.kind,'source-teams');
    assert.equal(hasCall(ui,'/api/accounts/trace/start'),false);
    assert.equal(hasCall(ui,'/api/accounts/teamsnap/config'),false);
    assert.equal(hasCall(ui,'/api/accounts/teamsnap/authorize'),false);
    assert.ok(hasCall(ui,'/api/accounts/account-a/teams'));
  });
});

uiTest('multiple connected accounts require an explicit named account selection',async()=>{
  await withUI({accounts:[account('trace','account-a','Coach One'),account('trace','account-b','Coach Two'),{...account('trace','inactive','Old Account'),active:false},account('teamsnap','other-provider','Other Provider')]},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="connection-account"]'),'account chooser');
    const choices=[...ui.dom.window.document.querySelectorAll('[data-action="connection-account"]')];
    assert.deepEqual(choices.map(node=>node.textContent),['Coach One','Coach Two']);
    assert.equal(ui.calls.some(call=>call.path.endsWith('/teams')),false);
    await ui.click('[data-action="connection-account"][data-account="account-b"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'selected account teams');
    assert.ok(hasCall(ui,'/api/accounts/account-b/teams'));
    assert.equal(hasCall(ui,'/api/accounts/account-a/teams'),false);
    assert.match(ui.query('#accountBody').textContent,/Coach Two/);
  });
});

uiTest('provider 401 offers recovery while preserving the owner session and saved team',async()=>{
  const saved=team();
  await withUI({teams:[saved],accounts:[account()],resolve:call=>call.path==='/api/accounts/account-a/teams'?failure('provider_authorization_expired','Reconnect Trace to continue.'):undefined},async ui=>{
    await ui.app.manageSource('trace');
    await until(()=>ui.query('[data-action="connection-refresh"]'),'provider recovery choices');
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
    assert.equal(ui.app.state.team,saved.id);
    assert.equal(ui.query('#app').classList.contains('hidden'),false);
    assert.equal(ui.query('#loginScreen').classList.contains('hidden'),true);
    assert.match(ui.query('#accountBody').textContent,/Reconnect Trace/);
    assert.ok(ui.query('[data-action="connection-sign-in"]'));
  });
});

uiTest('explicit owner-session expiry still signs the owner out',async()=>{
  await withUI({accounts:[account()],resolve:call=>call.path==='/api/accounts/account-a/teams'?failure('sign_in_required','Sign in to continue.'):undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.app.state.bootstrap.session.role==='anonymous','owner logout on session expiry');
    assert.equal(ui.query('#loginScreen').classList.contains('hidden'),false);
    assert.equal(ui.query('#app').classList.contains('hidden'),true);
    assert.equal(ui.app.state.modal,null);
  });
});

for(const nextFlow of [false,true])uiTest(`late Trace send result cannot reopen ${nextFlow?'or replace a newer flow':'a cancelled flow'}`,async()=>{
  const gate=deferred();
  await withUI({resolve:call=>call.path==='/api/accounts/trace/start'?gate.promise:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');
    await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>hasCall(ui,'/api/accounts/trace/start'),'Trace request started');
    await ui.click('[data-action="connection-cancel"]');
    assert.equal(ui.app.state.modal,null);
    if(nextFlow){await ui.click('#teamSearchBtn');await until(()=>ui.query('form[data-form="gotsport-search"]'),'new GotSport flow');}
    gate.resolve({attempt:'late-attempt',expires_at:Date.now()+600000});
    await until(()=>hasCall(ui,'/api/accounts/trace/cancel'),'late Trace attempt cancellation');
    assert.equal(ui.query('form[data-form="trace-verify-code"]'),null);
    if(nextFlow)assert.ok(ui.query('form[data-form="gotsport-search"]'));
    else assert.equal(ui.query('#accountModal').classList.contains('hidden'),true);
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
    assert.deepEqual(ui.calls.find(call=>call.path==='/api/accounts/trace/cancel').body,{attempt:'late-attempt'});
    assert.doesNotMatch(JSON.stringify(ui.savedStorage()),/synthetic@example|late-attempt/);
    if(!nextFlow){assert.equal(ui.savedStorage()['myts.connection.v1'],undefined);await ui.reload();assert.equal(ui.app.state.modal,null);}
  });
});

for(const nextFlow of [false,true])uiTest(`late Trace verification cannot reopen ${nextFlow?'or replace a newer flow':'a cancelled flow'}`,async()=>{
  const gate=deferred();
  await withUI({resolve:call=>call.path==='/api/accounts/trace/start'?{attempt:'verify-attempt',expires_at:Date.now()+600000}:call.path==='/api/accounts/trace/verify'?gate.promise:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>ui.query('form[data-form="trace-verify-code"]'),'Trace code form');
    ui.fill('[name="code"]','938475');await ui.submit('form[data-form="trace-verify-code"]');
    await until(()=>hasCall(ui,'/api/accounts/trace/verify'),'Trace verification started');
    assert.equal(ui.query('[name="code"]').value,'');
    await ui.click('[data-action="connection-cancel"]');
    if(nextFlow){await ui.click('#teamSearchBtn');await until(()=>ui.query('form[data-form="gotsport-search"]'),'new GotSport flow');}
    gate.resolve({account:account('trace','late-account','Late account')});
    for(let i=0;i<5;i++)await tick();
    assert.equal(hasCall(ui,'/api/accounts/late-account/teams'),false);
    assert.equal(ui.query('[data-action="source-team-select"]'),null);
    if(nextFlow)assert.ok(ui.query('form[data-form="gotsport-search"]'));
    else assert.equal(ui.app.state.modal,null);
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
    assert.doesNotMatch(JSON.stringify(ui.savedStorage()),/938475|synthetic@example/);
    if(!nextFlow){assert.equal(ui.savedStorage()['myts.connection.v1'],undefined);await ui.reload();assert.equal(ui.app.state.modal,null);}
  });
});

uiTest('late TeamSnap authorization cannot redirect after cancellation',async()=>{
  const gate=deferred();
  await withUI({resolve:call=>call.path==='/api/accounts/teamsnap/authorize'?gate.promise:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="teamsnap"]');
    await until(()=>ui.query('form[data-form="teamsnap-authorize"]'),'TeamSnap sign-in form');
    await ui.submit('form[data-form="teamsnap-authorize"]');
    await until(()=>hasCall(ui,'/api/accounts/teamsnap/authorize'),'TeamSnap authorization started');
    await ui.click('[data-action="connection-cancel"]');
    await ui.click('#teamSearchBtn');
    gate.resolve({authorization_url:'https://auth.teamsnap.com/oauth/authorize?state=synthetic-state'});
    for(let i=0;i<5;i++)await tick();
    assert.deepEqual(ui.redirects,[]);
    assert.ok(ui.query('form[data-form="gotsport-search"]'));
  });
});

uiTest('GotSport name search progressively asks for real required filters with no fake defaults',async()=>{
  await withUI({resolve:call=>call.path==='/api/sources/gotsport/search'?{teams:[source('gotsport')],total:1,page:1}:undefined},async ui=>{
    await ui.click('#teamSearchBtn');
    await until(()=>ui.query('form[data-form="gotsport-search"]'),'GotSport search form');
    assert.equal(ui.dom.window.document.querySelectorAll('form[data-form="gotsport-search"] input').length,1);
    assert.equal(ui.query('[name="age"]'),null);assert.equal(ui.query('[name="gender"]'),null);
    assert.equal(ui.query('[name="url"]'),null);
    ui.fill('[name="q"]','United');await ui.submit('form[data-form="gotsport-search"]');
    await until(()=>ui.query('[name="age"]'),'progressive required filters');
    assert.equal(ui.query('[name="q"]').value,'United');
    assert.equal(ui.query('[name="age"]').value,'');assert.equal(ui.query('[name="gender"]').value,'');assert.equal(ui.query('[name="state"]').value,'');
    assert.equal(ui.query('[name="age"]').required,true);assert.equal(ui.query('[name="gender"]').required,true);
    assert.equal(hasCall(ui,'/api/sources/gotsport/search'),false);
    await ui.submit('form[data-form="gotsport-search"]');
    assert.equal(hasCall(ui,'/api/sources/gotsport/search'),false);
    ui.fill('[name="age"]','12');ui.fill('[name="gender"]','f');
    await ui.submit('form[data-form="gotsport-search"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'GotSport matches');
    const request=ui.calls.find(call=>call.path==='/api/sources/gotsport/search');
    assert.deepEqual(Object.fromEntries(request.url.searchParams),{q:'United',age:'12',gender:'f',page:'1'});
    assert.equal(ui.query('[name="url"]'),null);
  });
});

uiTest('the same GotSport field resolves a public link directly without age/category defaults',async()=>{
  await withUI({resolve:call=>call.path==='/api/sources/gotsport/resolve'?{teams:[source('gotsport')]}:undefined},async ui=>{
    await ui.click('#teamSearchBtn');
    await until(()=>ui.query('form[data-form="gotsport-search"]'),'GotSport search form');
    const url='https://rankings.gotsport.com/teams/123456';ui.fill('[name="q"]',url);
    await ui.submit('form[data-form="gotsport-search"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'resolved GotSport team');
    assert.deepEqual(ui.calls.find(call=>call.path==='/api/sources/gotsport/resolve').body,{url});
    assert.equal(hasCall(ui,'/api/sources/gotsport/search'),false);
    assert.equal(ui.query('[name="age"]'),null);assert.equal(ui.query('[name="gender"]'),null);
    assert.equal(ui.query('[name="url"]'),null);
  });
});

uiTest('lost create-and-connect response retries the identical durable command after refresh',async()=>{
  let attempts=0;const connected=team('new-team','United U12');
  await withUI({accounts:[account()],resolve:(call,model)=>{
    if(call.path!=='/api/connections')return;
    attempts++;model.teams=[connected];
    if(attempts===1)throw new TypeError('Synthetic connection response lost after commit.');
    return {team_id:connected.id,season_id:connected.seasons[0].id,queued:true,replayed:true};
  }},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('[data-action="connection-retry"]'),'safe retry after lost response');
    const first=ui.calls.find(call=>call.path==='/api/connections');
    assert.equal(first.method,'POST');assert.equal(first.body.request_id,first.headers['Idempotency-Key']);
    assert.equal(first.body.source_team_id,'source-a');assert.equal(first.body.account_id,'account-a');
    assert.equal(first.body.new_team.name,'United U12');assert.equal(first.body.new_team.timezone_source,'device');assert.equal(Object.hasOwn(first.body.new_team,'season_year'),false);
    const pending=JSON.parse(ui.savedStorage()['myts.connection.v1']).pending;
    assert.equal(pending.requestId,first.body.request_id);
    await ui.click('[data-action="connection-cancel"]');
    assert.equal(ui.app.state.modal,null);
    assert.deepEqual(JSON.parse(ui.savedStorage()['myts.connection.v1']).pending,pending);
    await ui.reload();
    assert.ok(ui.query('[data-action="connection-retry"]'));
    assert.equal(attempts,1,'Refresh must not silently submit an uncertain command.');
    await ui.click('[data-action="connection-retry"]');
    await until(()=>ui.app.state.modal?.kind==='connection-progress','queued connection success');
    const commands=ui.calls.filter(call=>call.path==='/api/connections');
    assert.equal(commands.length,2);assert.deepEqual(commands[1].body,commands[0].body);
    assert.equal(commands[1].headers['Idempotency-Key'],commands[0].headers['Idempotency-Key']);
    assert.equal(ui.calls.some(call=>call.path==='/api/teams'&&call.method==='POST'),false);
    assert.equal(ui.app.state.team,connected.id);assert.equal(ui.app.state.season,connected.seasons[0].id);
    assert.equal(ui.savedStorage()['myts.connection.v1'],undefined);
    assert.match(ui.query('#accountModalTitle').textContent,/Import queued/);
    assert.doesNotMatch(ui.query('#accountBody').textContent,/import complete|all data imported/i);
  });
});

uiTest('refresh during provider discovery keeps the original logical destination without a season boundary',async()=>{
  const intended=team('intended','Intended team'),current=team('current','Other team');
  await withUI({teams:[intended,current],accounts:[account()]},async ui=>{
    await ui.app.manageSource('trace');await until(()=>ui.query('[data-action="source-team-select"]'));
    ui.model.teams=[current,intended];await ui.reload();assert.equal(ui.app.state.team,current.id);
    await ui.click('[data-action="source-team-select"]');await until(()=>hasCall(ui,'/api/connections'));
    const command=ui.calls.find(call=>call.path==='/api/connections');assert.equal(command.body.team_id,intended.id);
    assert.equal(Object.hasOwn(command.body,'season_id'),false);assert.equal(Object.hasOwn(command.body,'new_team'),false);
  });
});

uiTest('uncertain existing-team command preserves its intended destination across reload',async()=>{
  const intended=team('intended','Intended team'),current=team('current','Other team');
  await withUI({teams:[intended,current],accounts:[account()],resolve:call=>{if(call.path==='/api/connections')throw new TypeError('Synthetic lost reply');}},async ui=>{
    await ui.app.manageSource('trace');await until(()=>ui.query('[data-action="source-team-select"]'));await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('[data-action="connection-retry"]'));const before=ui.app.connection.value.pending;
    ui.model.teams=[current,intended];await ui.reload();assert.equal(ui.app.state.team,current.id);
    assert.deepEqual(ui.app.connection.value.pending,before);assert.equal(before.body.team_id,intended.id);
    await ui.click('[data-action="connection-retry"]');await until(()=>ui.calls.filter(call=>call.path==='/api/connections').length===2);
    assert.deepEqual(ui.calls.filter(call=>call.path==='/api/connections').map(call=>call.body),[before.body,before.body]);
  });
});

uiTest('an undated archived source connects immediately without a year and opens a pending team',async()=>{
  await withUI({accounts:[account()],sourceTeams:[{...source(),season_label:'Spring',archived:true}]},async ui=>{
    await ui.click('[data-action="add-team"]');await ui.click('[data-action="connection-provider"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="source-team-select"]'));await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.app.state.modal?.kind==='connection-progress');
    const command=ui.calls.find(call=>call.path==='/api/connections');assert.equal(command.body.new_team.name,'United U12');
    assert.equal(Object.hasOwn(command.body.new_team,'season_year'),false);assert.equal(ui.query('[name="season_year"]'),null);
    assert.equal(ui.query('form[data-form="source-attach"]'),null);assert.equal(ui.app.state.season,null);
    assert.match(ui.query('#root').textContent,/No dated season data/);assert.equal(hasCall(ui,'/api/overview'),false);
    await ui.reload();assert.equal(ui.app.state.season,null);assert.match(ui.query('#root').textContent,/No dated season data/);
    await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');assert.ok(ui.query('[data-action="source-manage"]'));
  });
});

uiTest('explicit Trace Cancel stays dismissed after Settings Reports and a full remount',async()=>{
  await withUI({teams:[team()],resolve:call=>{
    if(call.path==='/api/team')return {data:{team:team(),roster:{items:[],total:0}}};
    if(call.path==='/api/reports')return {data:{type:'season',columns:[],rows:{items:[],total:0},scope_label:'This season',scope_note:'Saved data'}};
  }},async ui=>{
    await ui.click('[data-action="nav"][data-view="team"]');
    await until(()=>ui.app.state.view==='team'&&!ui.query('#root').hasAttribute('aria-busy'),'Team view');
    await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    await ui.click('[data-action="connection-cancel"]');
    assert.equal(ui.app.state.modal,null);assert.equal(ui.app.state.view,'team');
    await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');
    await ui.click('[data-action="reports"]');
    await until(()=>ui.app.state.view==='reports'&&!ui.query('#root').hasAttribute('aria-busy'),'Reports view');
    assert.equal(ui.app.state.modal,null);
    await ui.reload();
    assert.equal(ui.app.state.modal,null,'An explicitly cancelled sign-in must not reopen over Overview after reload.');
    assert.equal(ui.app.connection.value,null);
    assert.equal(ui.savedStorage()['myts.connection.v1'],undefined);
    assert.equal(hasCall(ui,'/api/accounts/trace/start'),false);
  });
});

for(const dismissal of ['cancel','close','navigation','history'])uiTest(`Trace code ${dismissal} cancels the server attempt and cannot restore on reload`,async()=>{
  await withUI({teams:[team()],resolve:call=>call.path==='/api/accounts/trace/start'?{attempt:'cancelled-attempt',expires_at:Date.now()+600000}:undefined},async ui=>{
    await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>ui.query('form[data-form="trace-verify-code"]'),'Trace code form');
    if(dismissal==='cancel')await ui.click('[data-action="connection-cancel"]');
    else if(dismissal==='close')await ui.click('[data-close="accountModal"]');
    else if(dismissal==='navigation')await ui.click('[data-action="nav"][data-view="overview"]');
    else {
      const route={...ui.app.captureRoute(),view:'overview',details:[]};
      ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route}}));
      await until(()=>ui.app.state.modal===null&&!ui.query('#root').hasAttribute('aria-busy'),'history dismissal');
    }
    assert.equal(ui.app.state.modal,null);assert.equal(ui.app.connection.value,null);
    assert.equal(ui.savedStorage()['myts.connection.v1'],undefined);
    await ui.reload();
    assert.equal(ui.app.state.modal,null);assert.equal(ui.app.connection.value,null);
    assert.equal(ui.query('#accountModal').classList.contains('hidden'),true);
    assert.deepEqual(ui.calls.filter(call=>call.path==='/api/accounts/trace/cancel').map(call=>call.body),[{attempt:'cancelled-attempt'}]);
    assert.equal(hasCall(ui,'/api/accounts/trace/attempt'),false);
    assert.equal(ui.calls.filter(call=>call.path==='/api/accounts/trace/start').length,1);
  });
});

uiTest('refresh restores a pending Trace code challenge without retaining email or code',async()=>{
  await withUI({resolve:call=>call.path==='/api/accounts/trace/start'?{attempt:'resumable-attempt',expires_at:Date.now()+600000}:call.path==='/api/accounts/trace/attempt'?{attempt:'resumable-attempt',stage:'code',expires_at:Date.now()+600000}:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>ui.query('form[data-form="trace-verify-code"]'),'Trace code form');
    ui.fill('[name="code"]','938475');
    assert.doesNotMatch(JSON.stringify(ui.savedStorage()),/938475|synthetic@example/);
    await ui.reload();
    assert.ok(ui.query('form[data-form="trace-verify-code"]'));assert.equal(ui.query('[name="code"]').value,'');
    assert.equal(ui.calls.filter(call=>call.path==='/api/accounts/trace/start').length,1);
    const resume=ui.calls.find(call=>call.path==='/api/accounts/trace/attempt');
    assert.equal(resume.url.searchParams.get('attempt'),'resumable-attempt');
    assert.equal(hasCall(ui,'/api/accounts/trace/cancel'),false,'A page refresh must not cancel a resumable challenge.');
  });
});

for(const path of ['/api/accounts','/api/accounts/teamsnap/config'])uiTest(`cancelled ${path.endsWith('config')?'TeamSnap setup':'saved account'} read cannot replace a newer flow`,async()=>{
  const gate=deferred();
  await withUI({resolve:call=>call.path===path?gate.promise:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="teamsnap"]');
    await until(()=>hasCall(ui,path),'gated connection read');
    await ui.click('[data-action="connection-cancel"]');await ui.click('#teamSearchBtn');
    gate.resolve(path==='/api/accounts'?{accounts:[account('teamsnap')]}:{requires_client_id:true});
    for(let i=0;i<5;i++)await tick();
    assert.ok(ui.query('form[data-form="gotsport-search"]'));
    assert.equal(ui.query('form[data-form="teamsnap-authorize"]'),null);
    assert.equal(hasCall(ui,'/api/accounts/account-a/teams'),false);
    assert.deepEqual(ui.redirects,[]);
  });
});

for(const [state,pattern] of [['queued',/Finding your teams/],['running',/Finding your teams/],['blocked',/Reconnect the account/],['failed',/could not finish finding teams/],['ready',/No accessible teams/]])uiTest(`${state} discovery is explained with a recovery action`,async()=>{
  await withUI({accounts:[account()],resolve:call=>call.path==='/api/accounts/account-a/teams'?{teams:[],total:0,discovery:{state}}:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="connection-refresh"]'),'discovery state');
    assert.match(ui.query('#accountBody').textContent,pattern);
    assert.ok(ui.query('[data-action="connection-sign-in"]'));
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
    assert.equal(ui.query('[data-action="source-team-select"]'),null);
  });
});

uiTest('expired Trace challenge recovers to email sign-in on refresh',async()=>{
  await withUI({resolve:call=>call.path==='/api/accounts/trace/start'?{attempt:'expired-attempt',expires_at:Date.now()+1000}:call.path==='/api/accounts/trace/attempt'?failure('trace_attempt_expired','The code expired.',410):undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>ui.query('form[data-form="trace-verify-code"]'),'Trace code form');
    await ui.reload();
    assert.ok(ui.query('form[data-form="trace-send-code"]'));
    assert.equal(ui.query('form[data-form="trace-verify-code"]'),null);
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
    assert.equal(ui.app.connection.value.attempt,null);
  });
});

uiTest('a settling Trace verification resumes with a check action rather than a duplicate code request',async()=>{
  await withUI({resolve:call=>call.path==='/api/accounts/trace/start'?{attempt:'settling-attempt',expires_at:Date.now()+600000}:call.path==='/api/accounts/trace/attempt'?{attempt:'settling-attempt',stage:'verifying'}:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>ui.query('form[data-form="trace-verify-code"]'),'Trace code form');
    await ui.reload();
    assert.ok(ui.query('[data-action="connection-resume"]'));
    assert.equal(ui.query('form[data-form="trace-send-code"]'),null);
    assert.equal(ui.query('form[data-form="trace-verify-code"]'),null);
    assert.match(ui.query('#accountBody').textContent,/still settling/);
    assert.equal(ui.calls.filter(call=>call.path==='/api/accounts/trace/start').length,1);
  });
});

uiTest('changing Trace email cancels its old challenge and prevents a late verification from taking over',async()=>{
  const gate=deferred();
  await withUI({resolve:call=>call.path==='/api/accounts/trace/start'?{attempt:'old-attempt',expires_at:Date.now()+600000}:call.path==='/api/accounts/trace/verify'?gate.promise:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>ui.query('form[data-form="trace-verify-code"]'),'Trace code form');
    ui.fill('[name="code"]','938475');await ui.submit('form[data-form="trace-verify-code"]');
    await until(()=>hasCall(ui,'/api/accounts/trace/verify'),'Trace verification');
    await ui.click('[data-action="trace-change-email"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'new email form');
    gate.resolve({account:account('trace','old-account')});for(let i=0;i<5;i++)await tick();
    assert.ok(ui.query('form[data-form="trace-send-code"]'));
    assert.equal(hasCall(ui,'/api/accounts/old-account/teams'),false);
    assert.deepEqual(ui.calls.find(call=>call.path==='/api/accounts/trace/cancel').body,{attempt:'old-attempt'});
  });
});

uiTest('late TeamSnap callback cannot reopen cancelled UI and its token is stripped before the request',async()=>{
  const gate=deferred(),order=[];let callbackHash;
  await withUI({resolve:call=>{if(call.path==='/api/accounts/teamsnap/callback'){callbackHash=globalThis.location.hash;order.push('callback');return gate.promise;}}},async ui=>{
    globalThis.location.hash='#access_token=synthetic-callback-token&state=synthetic-state&token_type=bearer';
    assert.match(ui.dom.window.location.hash,/access_token=synthetic-callback-token/,'The real DOM URL must initially contain the callback token.');
    const replace=ui.dom.window.history.replaceState.bind(ui.dom.window.history);
    ui.dom.window.history.replaceState=(value,title,url)=>{if(url==='/admin')order.push('strip');return replace(value,title,url);};
    const reloading=ui.reload();
    await until(()=>hasCall(ui,'/api/accounts/teamsnap/callback'),'TeamSnap callback submission');
    assert.equal(callbackHash,'','The fragment must be absent at callback fetch time.');
    assert.deepEqual(order,['strip','callback']);
    assert.equal(ui.dom.window.location.hash,'');
    assert.doesNotMatch(JSON.stringify(ui.savedStorage()),/synthetic-callback-token/);
    await ui.click('[data-action="connection-cancel"]');await ui.click('#teamSearchBtn');
    gate.resolve({account:account('teamsnap','callback-account')});await reloading;
    assert.ok(ui.query('form[data-form="gotsport-search"]'));
    assert.equal(hasCall(ui,'/api/accounts/callback-account/teams'),false);
    assert.deepEqual(ui.redirects,[]);
  });
});

uiTest('post-connection bootstrap cannot overwrite a newer navigation or connection screen',async()=>{
  const gate=deferred(),original=team('original','Original team'),next=team('next','Next team'),connected=team('connected','Imported team');let bootstraps=0;
  await withUI({teams:[original,next],accounts:[account()],resolve:(call,model)=>{
    if(call.path==='/api/bootstrap'&&++bootstraps===2)return gate.promise;
    if(call.path==='/api/connections'){model.teams=[connected,original,next];return {team_id:connected.id,season_id:connected.seasons[0].id,queued:true};}
  }},async ui=>{
    await ui.app.manageSource('trace',{addTeam:true});
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>bootstraps===2,'post-connection bootstrap');
    await ui.app.action('team-select',{value:next.id});
    await ui.click('#teamSearchBtn');
    assert.equal(ui.app.state.team,next.id);assert.ok(ui.query('form[data-form="gotsport-search"]'));
    gate.resolve({version:'stale-bootstrap',setup:{state:'ready',owner_ready:true},session:{role:'owner'},teams:[connected,original,next],preferences:{theme:'dark'}});
    for(let i=0;i<5;i++)await tick();
    assert.equal(ui.app.state.team,next.id);assert.equal(ui.app.state.season,next.seasons[0].id);
    assert.ok(ui.query('form[data-form="gotsport-search"]'));
    assert.notEqual(ui.app.state.bootstrap.version,'stale-bootstrap');
    assert.notEqual(ui.app.state.theme,'dark');
    assert.notEqual(ui.app.state.modal?.kind,'connection-progress');
  });
});

uiTest('terminal pending failure can explicitly start over without deleting saved teams',async()=>{
  const saved=team('saved','Keep this team');
  await withUI({teams:[saved],accounts:[account()],resolve:call=>call.path==='/api/connections'?failure('source_scope','This provider team is no longer accessible.',403):undefined},async ui=>{
    await ui.app.manageSource('trace');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('[data-action="connection-abandon"]'),'pending failure');
    const pending=ui.app.connection.value.pending;assert.ok(pending);
    await ui.click('[data-action="connection-abandon"]');
    assert.ok(ui.query('[data-action="connection-abandon-confirm"]'));
    assert.match(ui.query('#accountBody').textContent,/keep every saved team and source link/i);
    assert.deepEqual(ui.app.connection.value.pending,pending,'Starting over needs its explicit confirmation.');
    await ui.click('[data-action="connection-abandon-confirm"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'fresh connection selection');
    assert.equal(ui.app.connection.value.pending,null);
    assert.equal(ui.app.state.bootstrap.teams[0].id,saved.id);
    assert.equal(ui.model.teams[0].id,saved.id);
    assert.equal(ui.calls.some(call=>call.method==='DELETE'),false);
    assert.equal(ui.calls.filter(call=>call.path==='/api/connections').length,1);
    await ui.click('#teamSearchBtn');
    assert.ok(ui.query('form[data-form="gotsport-search"]'));
    assert.equal(ui.app.connection.value.provider,'gotsport');
  });
});

uiTest('owner expiry retains uncertain pending identity for recovery after sign-in',async()=>{
  await withUI({accounts:[account()],resolve:call=>call.path==='/api/connections'?failure('sign_in_required','Sign in to continue.'):undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.app.state.bootstrap.session.role==='anonymous','owner expiry');
    const request=ui.calls.find(call=>call.path==='/api/connections');
    const stored=JSON.parse(ui.savedStorage()['myts.connection.v1']);
    assert.equal(stored.pending.requestId,request.body.request_id);
    await ui.reload();
    assert.ok(ui.query('[data-action="connection-retry"]'));
    assert.equal(ui.app.connection.value.pending.requestId,request.body.request_id);
    assert.equal(ui.calls.filter(call=>call.path==='/api/connections').length,1);
  });
});

uiTest('explicit owner sign-out clears saved connection intent',async()=>{
  await withUI({accounts:[account()],resolve:(call,model)=>{
    if(call.path==='/api/connections')throw new TypeError('Synthetic lost response.');
    if(call.path==='/api/owner/logout'){model.role='anonymous';return {signed_out:true};}
  }},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('[data-action="connection-retry"]'),'pending connection');
    assert.ok(ui.savedStorage()['myts.connection.v1']);
    await ui.app.action('sign-out');
    assert.equal(ui.app.state.bootstrap.session.role,'anonymous');
    assert.equal(ui.savedStorage()['myts.connection.v1'],undefined);
    assert.equal(ui.app.connection.value,null);
  });
});

uiTest('same-team history navigation invalidates a held post-connection bootstrap',async()=>{
  const gate=deferred(),saved=team('saved','Saved team'),connected=team('connected','Imported team');let bootstraps=0;
  await withUI({teams:[saved],accounts:[account()],resolve:(call,model)=>{
    if(call.path==='/api/bootstrap'&&++bootstraps===2)return gate.promise;
    if(call.path==='/api/bookmarks')return {data:{events:{items:[]}}};
    if(call.path==='/api/connections'){model.teams=[connected,saved];return {team_id:connected.id,season_id:connected.seasons[0].id,queued:true};}
  }},async ui=>{
    await ui.app.manageSource('trace',{addTeam:true});
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>bootstraps===2,'post-connection bootstrap');
    const bootstrapCall=ui.calls.filter(call=>call.path==='/api/bootstrap')[1];
    const route={...ui.app.captureRoute(),view:'bookmarks',details:[]};
    ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route}}));
    await until(()=>ui.app.state.view==='bookmarks'&&!ui.query('#root').hasAttribute('aria-busy'),'same-team historical view');
    assert.equal(ui.app.state.team,saved.id);
    assert.equal(bootstrapCall.signal.aborted,false,'The same team keeps transport scope unchanged, so history must fence this response separately.');
    gate.resolve({version:'stale-history-bootstrap',setup:{state:'ready',owner_ready:true},session:{role:'owner'},teams:[connected,saved],preferences:{theme:'dark'}});
    for(let i=0;i<5;i++)await tick();
    assert.equal(ui.app.state.team,saved.id);assert.equal(ui.app.state.season,saved.seasons[0].id);
    assert.equal(ui.app.state.view,'bookmarks');assert.equal(ui.app.state.modal,null);
    assert.notEqual(ui.app.state.bootstrap.version,'stale-history-bootstrap');assert.notEqual(ui.app.state.theme,'dark');
  });
});

uiTest('read-only pending receipt recovery opens the saved team without replaying the POST',async()=>{
  const saved={...team('saved-connection','Recovered team'),seasons:[]};
  await withUI({accounts:[account()],resolve:(call,model)=>{
    if(call.path!=='/api/connections')return;
    if(call.method==='GET')return {found:true,team_id:saved.id,season_id:null,team_available:true,connection_active:true,account_active:false};
    model.teams=[saved];throw new TypeError('Synthetic response lost after commit.');
  }},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('[data-action="connection-check-saved"]'),'read-only receipt check');
    const command=ui.calls.find(call=>call.path==='/api/connections'&&call.method==='POST');
    await ui.click('[data-action="connection-check-saved"]');
    await until(()=>ui.query('[data-action="connection-open-saved"]'),'saved receipt found');
    const receipt=ui.calls.find(call=>call.path==='/api/connections'&&call.method==='GET');
    assert.equal(receipt.url.searchParams.get('request_id'),command.body.request_id);
    assert.match(ui.query('#accountBody').textContent,/provider account now needs reconnection/i);
    assert.match(ui.query('#accountBody').textContent,/does not start or confirm an import/i);
    await ui.click('[data-action="connection-open-saved"]');
    await until(()=>ui.app.state.team===saved.id&&ui.app.state.modal===null,'saved team opened');
    assert.equal(ui.app.state.season,null);
    assert.equal(ui.calls.filter(call=>call.method!=='GET').length,1);
    assert.equal(ui.calls.filter(call=>call.path==='/api/connections'&&call.method==='POST').length,1);
    assert.equal(ui.savedStorage()['myts.connection.v1'],undefined);
    assert.equal(ui.app.state.modal,null);
  });
});

uiTest('paged named account selection does not silently choose the first account and can move back',async()=>{
  await withUI({resolve:call=>{
    if(call.path!=='/api/accounts')return;
    return call.url.searchParams.get('cursor')==='page-two'?{accounts:[account('trace','account-b','Second coach')],next_cursor:null}:{accounts:[account('trace','account-a','First coach')],next_cursor:'page-two'};
  }},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="connection-accounts-more"]'),'more named accounts');
    assert.match(ui.query('[data-action="connection-account"]').textContent,/First coach/);
    assert.equal(ui.calls.some(call=>call.path.endsWith('/teams')),false);
    await ui.click('[data-action="connection-accounts-more"]');
    await until(()=>ui.query('[data-action="connection-accounts-previous"]'),'second account page');
    assert.match(ui.query('[data-action="connection-account"]').textContent,/Second coach/);
    assert.equal(ui.calls.some(call=>call.path.endsWith('/teams')),false);
    await ui.click('[data-action="connection-accounts-previous"]');
    await until(()=>ui.query('[data-action="connection-accounts-more"]'),'first account page restored');
    assert.match(ui.query('[data-action="connection-account"]').textContent,/First coach/);
    await ui.click('[data-action="connection-accounts-more"]');
    await until(()=>ui.query('[data-action="connection-account"][data-account="account-b"]'),'second named account');
    await ui.click('[data-action="connection-account"][data-account="account-b"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'chosen account teams');
    assert.ok(hasCall(ui,'/api/accounts/account-b/teams'));
    assert.equal(hasCall(ui,'/api/accounts/account-a/teams'),false);
    assert.deepEqual(ui.calls.filter(call=>call.path==='/api/accounts').map(call=>call.url.searchParams.get('cursor')),[null,'page-two',null,'page-two']);
  });
});

uiTest('an account page with no matching provider still offers the next saved-account page',async()=>{
  await withUI({resolve:call=>{
    if(call.path!=='/api/accounts')return;
    return call.url.searchParams.get('cursor')==='trace-page'?{accounts:[account('trace','trace-later','Trace coach')]}:{accounts:[account('teamsnap','teamsnap-first','TeamSnap coach')],next_cursor:'trace-page'};
  }},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="connection-accounts-more"]'),'next provider account page');
    assert.equal(ui.query('[data-action="connection-account"]'),null);
    assert.equal(ui.query('form[data-form="trace-send-code"]'),null);
    assert.match(ui.query('#accountBody').textContent,/No matching connected account is on this page/);
    await ui.click('[data-action="connection-accounts-more"]');
    await until(()=>ui.query('[data-action="connection-account"][data-account="trace-later"]'),'saved Trace account');
    await ui.click('[data-action="connection-account"][data-account="trace-later"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'saved Trace account teams');
    assert.equal(hasCall(ui,'/api/accounts/trace/start'),false);
    assert.ok(hasCall(ui,'/api/accounts/trace-later/teams'));
  });
});

uiTest('failed Trace challenge resumes at a new email form with a useful explanation',async()=>{
  await withUI({resolve:call=>call.path==='/api/accounts/trace/start'?{attempt:'failed-attempt',expires_at:Date.now()+600000}:call.path==='/api/accounts/trace/attempt'?{attempt:'failed-attempt',stage:'failed'}:undefined},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>ui.query('form[data-form="trace-verify-code"]'),'Trace code form');
    await ui.reload();
    assert.ok(ui.query('form[data-form="trace-send-code"]'));
    assert.equal(ui.query('form[data-form="trace-verify-code"]'),null);
    assert.match(ui.query('#accountBody').textContent,/cannot be reused.*Send a new code/s);
    assert.equal(ui.app.connection.value.attempt,null);
    assert.deepEqual(ui.calls.find(call=>call.path==='/api/accounts/trace/cancel').body,{attempt:'failed-attempt'});
    assert.equal(ui.calls.filter(call=>call.path==='/api/accounts/trace/start').length,1,'Recovery must wait for the user to request a new code.');
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
  });
});

uiTest('GotSport text and progressive filter edits survive refresh before submission',async()=>{
  await withUI({},async ui=>{
    await ui.click('#teamSearchBtn');
    await until(()=>ui.query('form[data-form="gotsport-search"]'),'GotSport search form');
    ui.fill('[name="q"]','Draft United');await ui.reload();
    assert.equal(ui.query('[name="q"]').value,'Draft United');
    assert.equal(ui.query('[name="age"]'),null);
    await ui.submit('form[data-form="gotsport-search"]');
    await until(()=>ui.query('[name="age"]'),'progressive filters');
    ui.fill('[name="age"]','14');ui.fill('[name="gender"]','f');ui.fill('[name="state"]','CA');
    await ui.reload();
    assert.equal(ui.query('[name="q"]').value,'Draft United');
    assert.equal(ui.query('[name="age"]').value,'14');assert.equal(ui.query('[name="gender"]').value,'f');assert.equal(ui.query('[name="state"]').value,'CA');
    assert.equal(hasCall(ui,'/api/sources/gotsport/search'),false);assert.equal(hasCall(ui,'/api/sources/gotsport/resolve'),false);
  });
});

uiTest('alternate account and search entry points cannot silently replace an uncertain command',async()=>{
  await withUI({accounts:[account()],resolve:call=>{if(call.path==='/api/connections'&&call.method==='POST')throw new TypeError('Synthetic lost connection reply.');}},async ui=>{
    await ui.app.manageSource('trace');await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('[data-action="connection-retry"]'),'pending command');const pending=JSON.parse(ui.savedStorage()['myts.connection.v1']).pending;
    await ui.app.action('connection-cancel');await ui.app.action('account-teams',{provider:'teamsnap',account:'other-account'});
    assert.ok(ui.query('[data-action="connection-retry"]'));assert.deepEqual(ui.app.connection.value.pending,pending);
    await ui.app.action('connection-cancel');await ui.app.searchGotSport({q:'Different team',age:12,gender:'f'});
    assert.ok(ui.query('[data-action="connection-retry"]'));assert.deepEqual(ui.app.connection.value.pending,pending);
    assert.equal(ui.calls.some(call=>call.path==='/api/accounts/other-account/teams'||call.path==='/api/sources/gotsport/search'),false);
  });
});

uiTest('Add team never inherits the displayed team and repeated source clicks submit once',async()=>{
  const existing=team('existing','Existing destination');
  await withUI({teams:[existing],accounts:[account()]},async ui=>{
    await ui.click('[data-action="add-team"]');await ui.click('[data-action="connection-provider"][data-provider="trace"]');await until(()=>ui.query('[data-action="source-team-select"]'));
    const candidate=ui.query('[data-action="source-team-select"]');candidate.click();candidate.click();
    await until(()=>ui.app.state.modal?.kind==='connection-progress');const commands=ui.calls.filter(call=>call.path==='/api/connections');
    assert.equal(commands.length,1);assert.equal(commands[0].body.team_id,undefined);assert.equal(commands[0].body.new_team.name,'United U12');assert.equal(ui.app.state.season,null);
  });
});

uiTest('switching to a pending team clears prior content and keeps root Manage and status usable',async()=>{
  const existing=team(),pending={...team('pending','Pending team'),seasons:[]};
  const root={id:'root-1',app_team_id:pending.id,source_team_id:'source-a',account_id:'account-a',provider:'trace',name:'Pending source',active:true,generation:4,scope_mode:'observed_history',seasons:[],authorization_state:'connected'};
  await withUI({teams:[existing,pending],accounts:[account()],resolve:call=>{
    if(['/api/data/exports','/api/data/imports'].includes(call.path))return {items:[]};
    if(call.path==='/api/overview')return {data:{team_name:'Old visible team'}};
    if(call.path==='/api/status')return {data:{season_resolution:{state:'pending',total:0},connections:[root],connections_page:{total:1},providers:[{provider:'trace',total:1,groups:[{state:'ready',coverage:'complete',count:1}]}]}};
    if(call.path==='/api/connections/root-1/sync')return {queued:true};
    if(call.path==='/api/connections/root-1'&&call.method==='DELETE'){root.active=false;return {detached:true};}
  }},async ui=>{
    await ui.app.action('team-select',{value:pending.id});assert.equal(ui.app.state.season,null);assert.match(ui.query('#root').textContent,/No dated season data/);
    assert.equal(ui.query('[data-action="included-games"]'),null);await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');
    assert.equal(ui.query('[data-action="reports"]'),null);assert.ok(ui.query('[data-action="data-files"]'));assert.equal(ui.query('[data-action="source-identities"]'),null);await ui.click('[data-action="data-files"]');await until(()=>hasCall(ui,'/api/data/exports')&&hasCall(ui,'/api/data/imports'));assert.equal(ui.calls.find(call=>call.path==='/api/data/exports').url.searchParams.get('team_season_id'),null);await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');await ui.click('[data-action="source-manage"][data-provider="trace"]');await until(()=>ui.app.state.modal?.kind==='source-status');
    assert.match(ui.query('#accountBody').textContent,/Pending source/);assert.equal(ui.query('[data-action="branding-kits"]'),null);
    await ui.click('[data-action="source-sync"]');await until(()=>hasCall(ui,'/api/connections/root-1/sync'));
    await until(()=>ui.app.state.modal?.kind==='source-status');await ui.click('[data-action="status-open"]');await until(()=>ui.app.state.modal?.kind==='status');
    assert.match(ui.query('#accountBody').textContent,/Waiting for dated season information/);assert.doesNotMatch(ui.query('#accountBody').textContent,/Ready\. Available/);
    await ui.app.action('source-manage',{provider:'trace'});await ui.click('[data-action="source-unlink"]');await ui.submit('form[data-form="source-unlink"]');
    await until(()=>hasCall(ui,'/api/connections/root-1'));assert.deepEqual(ui.calls.find(call=>call.path==='/api/connections/root-1').body,{team_id:pending.id,generation:4});
  });
});

uiTest('season catalog polling discovers evidence without selecting a season or bootstrapping again',async()=>{
  const pending={...team('pending','Pending team'),seasons:[]};
  await withUI({teams:[pending]},async ui=>{
    const before=ui.calls.filter(call=>call.path==='/api/bootstrap').length;
    ui.model.teams[0].seasons=team('pending').seasons;
    await ui.app.refreshSavedState({revision:{seasons:2,status:2}});
    assert.equal(ui.app.state.team,pending.id);assert.equal(ui.app.state.season,null);assert.match(ui.query('#root').textContent,/Season data is available/);
    assert.ok(ui.query('[data-action="season-select"]'));assert.equal(ui.calls.filter(call=>call.path==='/api/bootstrap').length,before);
    await ui.click('[data-action="season"]');await until(()=>ui.app.state.season==='pending-season');
  });
});

uiTest('catalog refresh preserves selected season and an open provider flow',async()=>{
  const existing=team('existing');
  await withUI({teams:[existing]},async ui=>{
    await ui.click('#teamSearchBtn');ui.fill('[name="q"]','My drafted team');const currentSeason=ui.app.state.season;
    ui.model.teams[0].seasons=[{...existing.seasons[0],id:'new-season',year:2027,label:'2027–2028'},...existing.seasons];
    await ui.app.refreshSavedState({revision:{seasons:2,content:2}});
    assert.equal(ui.app.state.season,currentSeason);assert.equal(ui.app.state.modal.kind,'source-search');assert.equal(ui.query('[name="q"]').value,'My drafted team');
    assert.ok(ui.query('[data-action="season-select"][data-value="new-season"]'));
  });
});

uiTest('late catalog refresh cannot replace a newer team selection',async()=>{
  const a=team('a'),b=team('b'),gate=deferred();let hold=false;
  await withUI({teams:[a,b],resolve:call=>{if(hold&&call.path==='/api/teams/a/seasons')return gate.promise;}},async ui=>{
    hold=true;const refreshing=ui.app.refreshSavedState({revision:{seasons:2}});await until(()=>hasCall(ui,'/api/teams/a/seasons'));
    await ui.app.action('team-select',{value:b.id});gate.resolve({items:[{...a.seasons[0],id:'stale-season'}],total:1,revision:2});await refreshing;
    assert.equal(ui.app.state.team,b.id);assert.equal(ui.app.state.season,b.seasons[0].id);assert.equal(ui.query('[data-value="stale-season"]'),null);
  });
});

uiTest('the first revision read catches seasons published between bootstrap and polling',async()=>{
  const pending={...team('pending'),seasons:[]};
  await withUI({teams:[pending],resolve:call=>{
    if(call.path==='/api/revisions')return {revision:{seasons:2}};
    if(call.path==='/api/teams/pending/seasons')return {items:team('pending').seasons,total:1,revision:2};
  }},async ui=>{await until(()=>ui.query('[data-action="season-select"]'));assert.equal(ui.app.state.season,null);assert.equal(ui.calls.filter(call=>call.path==='/api/bootstrap').length,1);});
});

uiTest('a pending viewer receives a category-safe empty screen without owner controls',async()=>{
  await withUI({teams:[{...team('shared'),seasons:[]}],role:'viewer',categories:['overview']},async ui=>{
    assert.match(ui.query('#root').textContent,/No dated season data/);assert.equal(ui.query('[data-action="add-team"]'),null);assert.equal(ui.query('[data-action="included-games"]'),null);assert.equal(ui.query('[data-action="source-manage"]'),null);
    assert.equal(ui.calls.some(call=>call.path==='/api/accounts'||call.path==='/api/connections'),false);
    await ui.click('#accountBtn');await until(()=>ui.app.state.modal?.kind==='settings');assert.equal(ui.query('[data-action="source-manage"]'),null);assert.equal(ui.query('[data-action="diagnostics"]'),null);assert.equal(ui.query('[data-action="share-copy"]'),null);
  });
});

uiTest('an ambiguous existing exact source asks for a named team only after the server requires it',async()=>{
  const a=team('a','Alpha'),b=team('b','Beta');let attempts=0;
  await withUI({teams:[a,b],accounts:[account()],resolve:call=>{if(call.path==='/api/connections'&&++attempts===1)return failure('connection_destination_required','Choose the destination team.',409);}},async ui=>{
    await ui.app.manageSource('trace',{addTeam:true});await ui.click('[data-action="source-team-select"]');await until(()=>ui.app.state.modal?.kind==='connection-destination');
    assert.equal(ui.query('[name="season_year"]'),null);assert.match(ui.query('#accountBody').textContent,/Alpha/);assert.match(ui.query('#accountBody').textContent,/Beta/);
    await ui.click('[data-action="connection-destination"][data-id="b"]');await until(()=>ui.app.state.modal?.kind==='connection-progress');
    const commands=ui.calls.filter(call=>call.path==='/api/connections');assert.equal(commands[1].body.team_id,'b');assert.notEqual(commands[1].body.request_id,commands[0].body.request_id);
  });
});

uiTest('confirmed club choice is retained exactly if its command reply is lost',async()=>{
  let attempts=0;const existing=team(),expected={profile_revision:2,current_logo_revision:0,source_logo_revision:0,current_club_team_count:1,source_club_team_count:1};
  await withUI({teams:[existing],accounts:[account()],resolve:call=>{
    if(call.path!=='/api/connections')return;
    if(++attempts===1)return response({error:{code:'club_choice_required',message:'Choose club',details:{club_choice:{kind:'club',expected,choices:[{value:'current',label:'Keep current club'}],current:{name:'Current'},source:{name:'Source'}}}}},409);
    if(attempts===2)throw new TypeError('Synthetic lost approved reply');
    return {team_id:existing.id,season_id:existing.seasons[0].id,queued:true};
  }},async ui=>{
    await ui.app.manageSource('trace');await ui.click('[data-action="source-team-select"]');await until(()=>ui.query('form[data-form="source-club-choice"]'));
    ui.query('[name="keep"]').checked=true;ui.query('[name="confirmed"]').checked=true;await ui.submit('form[data-form="source-club-choice"]');await until(()=>ui.query('[data-action="connection-retry"]'));
    const approved=ui.calls.filter(call=>call.path==='/api/connections')[1].body;await ui.reload();await ui.click('[data-action="connection-retry"]');await until(()=>ui.app.state.modal?.kind==='connection-progress');
    assert.deepEqual(ui.calls.filter(call=>call.path==='/api/connections')[2].body,approved);
  });
});

uiTest('legacy ambiguous scope asks once per source and its approved continuing scope survives retry',async()=>{
  const existing=team(),root={id:'legacy-root',app_team_id:existing.id,source_team_id:'source-a',account_id:'account-a',provider:'trace',name:'Legacy source',active:true,generation:7,scope_mode:'fixed_seasons',scope_origin:'legacy_ambiguous',seasons:[{id:existing.seasons[0].id,year:2026,active:true,excluded:false}]};
  await withUI({teams:[existing],resolve:call=>{
    if(call.path==='/api/status')return {data:{connections:[root],connections_page:{total:1},providers:[]}};
    if(call.path==='/api/connections')throw new TypeError('Synthetic lost scope reply');
  }},async ui=>{
    await ui.app.action('source-manage',{provider:'trace'});await ui.click('[data-action="source-seasons-review"]');assert.equal(hasCall(ui,'/api/connections'),false);
    await ui.click('[data-action="source-season-choice"][data-mode="observed_history"]');await until(()=>ui.query('[data-action="connection-retry"]'));
    const command=ui.calls.find(call=>call.path==='/api/connections');assert.deepEqual(command.body.scope,{mode:'observed_history'});assert.equal(command.body.connection_generation,7);assert.equal(command.body.team_id,existing.id);
    await ui.reload();assert.deepEqual(ui.app.connection.value.pending.body,command.body);
  });
});

uiTest('Manage shows bounded saved roster names awaiting season evidence without historical jersey or role claims',async()=>{
  const existing=team(),roster={total:25,limit:20,truncated:true,items:Array.from({length:20},(_,i)=>({source_player_id:'pending-'+i,name:i===0?'<script>Saved name</script>':'Pending player '+i,jersey:'PRIVATE_CURRENT_JERSEY',position:'PRIVATE_CURRENT_ROLE'}))};
  const root={id:'roster-root',app_team_id:existing.id,provider:'trace',name:'Source roster',active:true,generation:1,seasons:[],reconciliation_pending:false,pending_roster:roster,season_resolution:{state:'needs_evidence',pending_events:0,conflicting_events:0,excluded_events:0,excluded_reasons:[]}};
  await withUI({teams:[existing],resolve:call=>call.path==='/api/status'?{data:{connections:[root],connections_page:{total:1},providers:[{provider:'trace',total:1,groups:[{state:'ready',coverage:'complete',count:1}]}]}}:undefined},async ui=>{
    await ui.app.action('source-manage',{provider:'trace'});const body=ui.query('#accountBody');
    assert.match(body.textContent,/25 source roster records awaiting season evidence/);assert.match(body.textContent,/Showing the first 20 of 25/);assert.match(body.textContent,/Pending player 19/);
    assert.match(body.textContent,/Saved data is waiting for season evidence/);assert.equal(body.querySelectorAll('[data-pending-roster] li').length,20);assert.equal(body.querySelector('script'),null);
    assert.doesNotMatch(body.textContent,/PRIVATE_CURRENT_JERSEY|PRIVATE_CURRENT_ROLE/);assert.equal(ui.query('[name="season_year"]'),null);
  });
});

uiTest('Manage distinguishes unresolved events and saved exclusions from a completed evidence scan',async()=>{
  const pending={...team('pending'),seasons:[]},evidence={pending_events:2,conflicting_events:1,excluded_events:3,excluded_reasons:[{reason:'outside_saved_seasons_or_excluded',count:3}]};
  const root={id:'event-root',app_team_id:pending.id,provider:'trace',name:'Saved events',active:true,generation:1,input_revision:4,reconciled_revision:4,reconciliation_pending:false,seasons:[],pending_roster:{total:0,items:[]},season_resolution:{state:'needs_evidence',...evidence}};
  await withUI({teams:[pending],resolve:call=>call.path==='/api/status'?{data:{connections:[root],connections_page:{total:1},season_resolution:{state:'pending'},pending_roster:{total:0,items:[]},evidence,providers:[{provider:'trace',total:1,groups:[{state:'ready',coverage:'complete',count:1}]}]}}:undefined},async ui=>{
    await ui.app.action('source-manage',{provider:'trace'});assert.match(ui.query('#accountBody').textContent,/2 event records awaiting season evidence/);assert.match(ui.query('#accountBody').textContent,/1 event records with conflicting season dates/);assert.match(ui.query('#accountBody').textContent,/3 event records excluded by saved season choices/);
    assert.match(ui.query('#accountBody').textContent,/Outside the saved seasons or in an excluded season/);await ui.click('[data-action="status-open"]');await until(()=>ui.app.state.modal?.kind==='status');
    assert.match(ui.query('#accountBody').textContent,/Waiting for dated season information/);assert.doesNotMatch(ui.query('#accountBody').textContent,/Ready\. Available/);
  });
});


for(const phase of ['upgrade_required','upgrading','maintenance'])uiTest(`${phase} shows update progress without an owner initialization or password prompt`,async()=>{
  await withUI({resolve:call=>call.path==='/api/bootstrap'?{setup:{state:phase,phase:'rosters',progress:62},session:{role:'anonymous'},teams:[]}:undefined},async ui=>{
    assert.equal(ui.query('#loginTitle').textContent,'Updating myTS');
    assert.equal(ui.query('#loginForm').classList.contains('hidden'),true);
    assert.equal(ui.query('#adminKey').disabled,true);
    assert.equal(ui.query('#maintenanceStatus').classList.contains('hidden'),false);
    assert.equal(ui.query('#maintenanceProgress').value,62);
    assert.match(ui.query('#maintenanceLabel').textContent,/Updating saved rosters/);
    assert.doesNotMatch(ui.query('#loginText').textContent,/password|initialize|reset/i);
    await ui.submit('#loginForm');
    assert.equal(ui.calls.some(call=>call.method==='POST'),false);
  });
});

for(const restoredRole of ['owner','anonymous'])uiTest(`maintenance polling resumes the existing ${restoredRole==='owner'?'signed-in dashboard':'signed-out login'} when ready`,async()=>{
  let ready=false,progress=0;
  const saved=team();
  await withUI({teams:[saved],role:restoredRole,resolve:call=>call.path==='/api/bootstrap'&&!ready?{setup:{state:progress?'upgrading':'upgrade_required',phase:progress?'validating':'sealing',progress},session:{role:'anonymous'},teams:[]}:undefined},async ui=>{
    progress=87;await ui.app.checkMaintenance();
    assert.equal(ui.query('#maintenanceProgress').value,87);
    assert.match(ui.query('#maintenanceLabel').textContent,/Checking the update/);
    ready=true;await ui.app.checkMaintenance();
    assert.equal(ui.app.state.bootstrap.session.role,restoredRole);
    assert.equal(ui.query('#maintenanceStatus').classList.contains('hidden'),true);
    assert.equal(ui.query('#adminKey').disabled,false);
    if(restoredRole==='owner'){
      assert.equal(ui.query('#app').classList.contains('hidden'),false);
      assert.equal(ui.app.state.team,saved.id);
      assert.equal(ui.app.state.season,saved.seasons[0].id);
    }else{
      assert.equal(ui.query('#loginForm').classList.contains('hidden'),false);
      assert.equal(ui.query('#loginButton').textContent,'Sign in');
      assert.equal(ui.query('#loginTitle').textContent,'Owner console');
    }
    assert.equal(ui.calls.some(call=>call.method==='POST'),false);
    assert.equal(hasCall(ui,'/api/owner/initialize'),false);
  });
});

uiTest('maintenance polling retries a temporary read failure and resumes automatically',async()=>{
  let attempts=0;
  await withUI({maintenanceInterval:5,resolve:call=>{
    if(call.path!=='/api/bootstrap')return;
    attempts++;if(attempts===1)return {setup:{state:'upgrading',phase:'events',progress:75},session:{role:'anonymous'},teams:[]};
    if(attempts===2)throw new TypeError('Temporary offline response');
  }},async ui=>{
    for(let i=0;i<30&&ui.app.state.bootstrap.session.role!=='owner';i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
    assert.ok(attempts>=3);
    assert.equal(ui.query('#app').classList.contains('hidden'),false);
    assert.equal(ui.calls.some(call=>call.method==='POST'),false);
  });
});

uiTest('a stopped maintenance poll cannot reopen the app with a delayed ready response',async()=>{
  const gate=deferred();let reads=0;
  await withUI({resolve:call=>call.path==='/api/bootstrap'?(++reads===1?{setup:{state:'upgrading',phase:'events',progress:75},session:{role:'anonymous'},teams:[]}:gate.promise):undefined},async ui=>{
    const polling=ui.app.checkMaintenance();await until(()=>reads===2,'maintenance read');ui.app.stop();
    gate.resolve({setup:{state:'ready',owner_ready:true},session:{role:'owner'},teams:[team()]});await polling;
    assert.equal(ui.app.state.bootstrap.setup.state,'upgrading');
    assert.equal(ui.query('#app').classList.contains('hidden'),true);
  });
});


uiTest('maintenance keeps a returned TeamSnap authorization in memory until the owner session resumes',async()=>{
  let ready=false;
  await withUI({url:'https://myts.example/admin#access_token=synthetic-maintenance-token&state=synthetic-state',accounts:[account('teamsnap')],sourceTeams:[source('teamsnap')],resolve:call=>{
    if(call.path==='/api/bootstrap'&&!ready)return {setup:{state:'upgrading',phase:'roots',progress:25},session:{role:'anonymous'},teams:[]};
    if(call.path==='/api/accounts/teamsnap/callback')return {account:account('teamsnap')};
  }},async ui=>{
    assert.equal(ui.dom.window.location.hash,'');
    assert.equal(hasCall(ui,'/api/accounts/teamsnap/callback'),false);
    assert.doesNotMatch(JSON.stringify(ui.savedStorage()),/synthetic-maintenance-token/);
    ready=true;await ui.app.checkMaintenance();
    assert.equal(ui.calls.find(call=>call.path==='/api/accounts/teamsnap/callback').body.access_token,'synthetic-maintenance-token');
    assert.equal(ui.app.state.modal.kind,'source-teams');
    assert.doesNotMatch(JSON.stringify(ui.savedStorage()),/synthetic-maintenance-token/);
    assert.equal(hasCall(ui,'/api/owner/initialize'),false);
  });
});

uiTest('maintenance interruption preserves a pending Trace challenge without cancelling it',async()=>{
  let updating=false;
  await withUI({resolve:call=>{
    if(call.path==='/api/bootstrap'&&updating)return {setup:{state:'upgrading',phase:'events',progress:75},session:{role:'anonymous'},teams:[]};
    if(call.path==='/api/accounts/trace/start')return {attempt:'maintenance-attempt',expires_at:Date.now()+600000};
    if(call.path==='/api/accounts/trace/attempt')return {attempt:'maintenance-attempt',stage:'code',expires_at:Date.now()+600000};
  }},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('form[data-form="trace-send-code"]'),'Trace email form');
    ui.fill('[name="email"]','synthetic@example.invalid');await ui.submit('form[data-form="trace-send-code"]');
    await until(()=>ui.query('form[data-form="trace-verify-code"]'),'Trace code form');
    updating=true;await ui.app.bootstrap();
    assert.equal(ui.app.connection.active,false);
    assert.equal(JSON.parse(ui.savedStorage()['myts.connection.v1']).attempt,'maintenance-attempt');
    updating=false;await ui.app.checkMaintenance();
    assert.ok(ui.query('form[data-form="trace-verify-code"]'));
    assert.equal(ui.app.connection.value.attempt,'maintenance-attempt');
    assert.equal(ui.calls.filter(call=>call.path==='/api/accounts/trace/start').length,1);
    assert.equal(hasCall(ui,'/api/accounts/trace/cancel'),false);
  });
});

uiTest('maintenance preserves the selected saved season and immutable pending connection intent',async()=>{
  let updating=false;
  const saved=team();saved.seasons.push({id:'older-season',year:2024,label:'2024–2025',start_day:'2024-06-01',end_day:'2025-06-01'});
  await withUI({teams:[saved],resolve:call=>call.path==='/api/bootstrap'&&updating?{setup:{state:'upgrading',phase:'events',progress:75},session:{role:'anonymous'},teams:[]}:undefined},async ui=>{
    await ui.app.action('season',{value:'older-season'});
    ui.app.connection.begin('trace',{teamId:saved.id,seasonId:'older-season'});
    const pending=ui.app.connection.pending('/api/connections',{team_id:saved.id,source_team_id:'source-a',account_id:'account-a'},{teamId:saved.id,seasonId:'older-season'});
    const serialized=JSON.stringify(pending);
    updating=true;await ui.app.bootstrap();
    assert.equal(ui.app.state.bootstrap.setup.state,'upgrading');
    assert.equal(JSON.stringify(ui.app.connection.value.pending),serialized);
    assert.equal(ui.app.connection.active,false);
    updating=false;await ui.app.checkMaintenance();
    assert.equal(ui.app.state.team,saved.id);assert.equal(ui.app.state.season,'older-season');
    assert.equal(JSON.stringify(ui.app.connection.value.pending),serialized);
    assert.ok(ui.query('[data-action="connection-retry"]'));
    assert.equal(ui.calls.some(call=>call.method==='POST'),false);
  });
});

uiTest('fixed owner connection exposes preserved date correction review without widening seasons until chosen',async()=>{
  const existing=team(),evidence={pending_events:0,conflicting_events:0,excluded_events:1,needs_review_events:1,excluded_reasons:[{reason:'season_scope_conflict',count:1,desired_years:[2027],desired_years_total:1,desired_years_truncated:false}]};
  const root={id:'scope-conflict-root',app_team_id:existing.id,source_team_id:'source-a',account_id:'account-a',provider:'trace',name:'Restricted source',active:true,generation:9,scope_mode:'fixed_seasons',scope_origin:'owner',seasons:[{id:existing.seasons[0].id,year:2026,active:true,excluded:false}],season_resolution:{state:'needs_review',...evidence}};
  await withUI({teams:[existing],resolve:call=>call.path==='/api/status'?{data:{connections:[root],connections_page:{total:1},evidence,providers:[{provider:'trace',groups:[{state:'ready',coverage:'complete',count:1}]}]}}:undefined},async ui=>{
    await ui.app.action('source-manage',{provider:'trace'});
    assert.match(ui.query('[data-scope-conflict]').textContent,/Saved date correction cannot be applied to the allowed seasons: 1\. Desired season: 2027–2028/);
    assert.match(ui.query('#accountBody').textContent,/Saved date correction needs review/);
    assert.equal(hasCall(ui,'/api/connections'),false);assert.equal(ui.query('[name="season_year"]'),null);
    await ui.click('[data-action="source-seasons-review"]');assert.match(ui.query('#accountBody').textContent,/Your saved date correction is retained/);
    assert.equal(hasCall(ui,'/api/connections'),false);
    await ui.click('[data-action="source-season-choice"][data-mode="observed_history"]');await until(()=>hasCall(ui,'/api/connections'));
    const command=ui.calls.find(call=>call.path==='/api/connections').body;
    assert.equal(command.team_id,existing.id);assert.equal(command.connection_generation,9);assert.deepEqual(command.scope,{mode:'observed_history'});
    assert.equal(ui.app.state.season,existing.seasons[0].id);
  });
});

uiTest('completed import still reports correction review and bounds desired season labels',async()=>{
  const evidence={pending_events:0,conflicting_events:0,excluded_events:25,needs_review_events:25,excluded_reasons:[{reason:'season_scope_conflict',count:25,desired_years:['<script>',1900,...Array.from({length:25},(_,i)=>2030-i)],desired_years_total:25,desired_years_truncated:true}]};
  await withUI({teams:[team()],resolve:call=>call.path==='/api/status'?{data:{evidence,providers:[{provider:'trace',groups:[{state:'ready',coverage:'complete',count:1}]}]}}:undefined},async ui=>{
    await ui.app.action('status-open',{});const body=ui.query('#accountBody');
    assert.match(body.querySelector('[role="status"]').textContent,/Saved date correction needs review/);
    assert.doesNotMatch(body.querySelector('[role="status"]').textContent,/Ready\./);
    assert.match(body.querySelector('[data-scope-conflict]').textContent,/2030–2031/);
    assert.match(body.querySelector('[data-scope-conflict]').textContent,/Additional requested seasons also need review/);
    assert.equal((body.querySelector('[data-scope-conflict]').textContent.match(/\d{4}–\d{4}/g)??[]).length,20);
    assert.equal(body.querySelector('script'),null);assert.doesNotMatch(body.textContent,/1900–1901|2006–2007/);
    assert.equal(ui.calls.some(call=>call.method==='POST'),false);
  });
});

uiTest('Included games reset explains July–May totals and preserves explicit June inclusion until confirmed',async()=>{
  const saved=team();saved.seasons[0].include_june=true;let june=true;
  await withUI({teams:[saved],resolve:(call,model)=>{
    if(call.path==='/api/inclusion'&&call.method==='GET')return {data:{include_june:june,revision:7,content_revision:11,groups:[],total:0}};
    if(call.path==='/api/inclusion'&&call.method==='DELETE'){june=false;model.teams[0].seasons[0].include_june=false;return {ok:true,include_june:false,revision:8,content_revision:12};}
  }},async ui=>{
    await ui.app.action('included-games',{});assert.equal(ui.query('[name="include_june"]').checked,true);
    await ui.click('[data-action="inclusion-reset"]');
    assert.equal(ui.query('#accountBody .modal-copy').textContent,'Restore all game selections to source inheritance and return this season to July–May totals, with June excluded. Unsaved choices will be discarded after reset succeeds.');
    assert.equal(june,true);assert.equal(ui.calls.some(call=>call.method==='DELETE'),false);
    await ui.click('[data-action="inclusion-reset-cancel"]');assert.equal(ui.query('[name="include_june"]').checked,true);assert.equal(june,true);
    await ui.click('[data-action="inclusion-reset"]');await ui.submit('form[data-form="inclusion-reset"]');await until(()=>!june,'explicit reset');
    assert.deepEqual(ui.calls.find(call=>call.method==='DELETE').body,{revision:7,content_revision:11});
    await until(()=>ui.app.state.modal===null,'reset refresh');assert.equal(ui.app.state.bootstrap.teams[0].seasons[0].include_june,false);
  });
});

uiTest('Manage separates changed saved roster evidence from unassigned names and keeps review bounded',async()=>{
  const saved=team(),review={total:25,limit:20,truncated:true,items:Array.from({length:20},(_,i)=>({source_player_id:'historical-'+i,name:i===0?'Inactive saved <script>name</script>':'Earlier roster name '+i,jersey:'DO_NOT_ASSERT_JERSEY',position:'DO_NOT_ASSERT_ROLE'}))};
  const pending={total:1,items:[{source_player_id:'new-player',name:'Unassigned new name'}],limit:20,truncated:false};
  const root={id:'roster-review-root',app_team_id:saved.id,source_team_id:'source-a',provider:'trace',name:'Saved roster source',active:true,generation:2,scope_mode:'observed_history',seasons:[{id:saved.seasons[0].id,year:2026,active:true,excluded:false}],pending_roster:pending,roster_review:review,season_resolution:{state:'needs_review',needs_review_events:0}};
  await withUI({teams:[saved],resolve:call=>call.path==='/api/status'?{data:{connections:[root],connections_page:{total:1},pending_roster:pending,roster_review:review,providers:[{provider:'trace',groups:[{state:'ready',coverage:'complete',count:1}]}]}}:undefined},async ui=>{
    await ui.app.action('source-manage',{provider:'trace'});const body=ui.query('#accountBody'),reviewCard=body.querySelector('[data-roster-review]');
    assert.match(reviewCard.textContent,/25 saved roster records need review/);assert.match(reviewCard.textContent,/Saved season evidence changed/);assert.match(reviewCard.textContent,/previous dated season evidence is no longer verified/);assert.match(reviewCard.textContent,/Inactive saved/);
    assert.match(reviewCard.textContent,/Showing the first 20 of 25/);assert.equal(reviewCard.querySelectorAll('li').length,20);assert.equal(reviewCard.querySelector('script'),null);
    assert.doesNotMatch(reviewCard.textContent,/Unassigned new name|DO_NOT_ASSERT_JERSEY|DO_NOT_ASSERT_ROLE/);assert.match(body.querySelector('[data-pending-roster]').textContent,/Unassigned new name/);
    assert.match(body.textContent,/Saved roster season evidence needs review/);assert.equal(ui.query('[name="season_year"]'),null);assert.equal(ui.calls.some(call=>call.method==='POST'),false);
    await ui.click('[data-action="status-open"]');await until(()=>ui.app.state.modal?.kind==='status');
    assert.match(ui.query('#accountBody [role="status"]').textContent,/Saved roster season evidence changed and needs review/);assert.doesNotMatch(ui.query('#accountBody [role="status"]').textContent,/Ready\./);
  });
});


uiTest('TeamSnap status distinguishes recent attendance scans from verified full history',async()=>{
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/status')return {data:{summary:{total:1,ready:1},providers:[],jobs:{items:[{id:'attendance-job',provider:'teamsnap',component:'attendance',state:'ready',coverage:'partial',refresh_mode:'recent',last_complete_at:Date.parse('2026-10-12T20:00:00Z'),last_full_completed_at:Date.parse('2026-10-11T23:00:00Z')}],total:1}}};
 }},async ui=>{await ui.app.action('status-open',{});await until(()=>ui.query('[data-history-refresh]'));const body=ui.query('#accountBody').textContent;assert.match(body,/All history checked:/);assert.match(body,/Latest scan covers recent and upcoming events/);assert.match(body,/past 30 days and next 90 days/);assert.match(body,/Older edits are checked when the scheduled full-history scan completes/);assert.match(body,/Last finished scan:/);assert.doesNotMatch(body,/All history checked: Never/);});
});

uiTest('Schedule derives direction for period, filter and Day transitions instead of retaining stale asc',async()=>{
 await withUI({teams:[team()],resolve:call=>{
   if(call.path==='/api/schedule')return {selection:Object.fromEntries(call.url.searchParams),data:{items:[],total:0}};
   if(call.path==='/api/calendar')return {data:{days:[]}};
 }},async ui=>{
   const query=()=>Object.fromEntries(ui.calls.filter(call=>call.path==='/api/schedule').at(-1).url.searchParams);
   await ui.app.action('nav',{view:'schedule',period:'past',filter:'games'});
   assert.equal(query().direction,'desc');assert.equal(query().period,'past');
   assert.ok(ui.query('[data-action="schedule-period"][data-value="past"][aria-pressed="true"]'));
   await ui.app.action('schedule-filter',{value:'practices'});assert.equal(query().direction,'desc');assert.equal(query().type,'practices');
   await ui.app.action('schedule-period',{value:'upcoming'});assert.equal(query().direction,'asc');
   await ui.app.action('schedule-filter',{value:'analyzed'});assert.equal(query().direction,'desc');assert.equal(query().period,'all');
   await ui.app.action('schedule-filter',{value:'all'});assert.equal(query().direction,'asc');assert.equal(query().period,'upcoming');
   await ui.app.action('schedule-period',{value:'past'});await ui.app.action('schedule-mode',{value:'day'});
   assert.equal(query().direction,'asc');assert.equal(query().mode,'day');assert.equal(query().period,'all');
   assert.ok(ui.query('.schedule-date-strip'));
 });
});

uiTest('Schedule historical season and restored history use effective Past while preserving current preference',async()=>{
 const row=team();row.seasons.push({id:'historical-season',label:'2024–2025',year:2024,start_day:'2024-06-01',end_day:'2025-06-01'});
 await withUI({teams:[row],resolve:call=>{
   if(call.path==='/api/schedule')return {selection:Object.fromEntries(call.url.searchParams),data:{items:[],total:0}};
   if(call.path==='/api/calendar')return {data:{days:[]}};
 }},async ui=>{
   const query=()=>Object.fromEntries(ui.calls.filter(call=>call.path==='/api/schedule').at(-1).url.searchParams);
   await ui.app.action('nav',{view:'schedule',period:'upcoming'});assert.equal(query().direction,'asc');
   await ui.app.action('season-select',{value:'historical-season'});
   assert.equal(query().period,'past');assert.equal(query().direction,'desc');assert.equal(ui.app.state.filters.period,'upcoming');
   await ui.app.action('calendar');const calendarQuery=ui.calls.filter(call=>call.path==='/api/calendar').at(-1).url.searchParams;assert.equal(calendarQuery.get('period'),'past');assert.equal(calendarQuery.get('direction'),'desc');assert.equal(ui.app.state.filters.period,'upcoming');assert.equal(ui.app.state.modal.kind,'calendar');await ui.app.action('close-modal');
   await ui.app.action('season-select',{value:row.seasons[0].id});assert.equal(query().period,'upcoming');assert.equal(query().direction,'asc');
   const route={...ui.app.captureRoute(),filters:{...ui.app.state.filters,mode:'season',period:'past',direction:'asc'}};
   const count=ui.calls.filter(call=>call.path==='/api/schedule').length;
   ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route}}));
   await until(()=>ui.calls.filter(call=>call.path==='/api/schedule').length>count&&!ui.query('#root').hasAttribute('aria-busy'),'restored Past rendering');
   assert.equal(query().period,'past');assert.equal(query().direction,'desc');
   await ui.app.action('schedule-mode',{value:'day'});await ui.app.action('season-select',{value:'historical-season'});
   assert.equal(query().mode,'day');assert.equal(query().period,'all');assert.equal(query().direction,'asc');
 });
});

uiTest('Schedule pagination appends in query order and reversal/filter/season changes fence stale pages',async()=>{
 const held=deferred(),row=team();row.seasons.push({id:'historical-season',label:'2024–2025',year:2024,start_day:'2024-06-01',end_day:'2025-06-01'});
 await withUI({teams:[row],resolve:call=>{
   if(call.path==='/api/calendar')return {data:{days:[]}};
   if(call.path==='/api/schedule'){
     const q=Object.fromEntries(call.url.searchParams),id=q.cursor?'older':q.period==='past'?'newest':'upcoming';
     const result={selection:q,data:{items:[{id,starts_at:'2026-10-12T12:00:00Z',status:'UNKNOWN',type:'game',title:id,home:{name:'Team'},away:{name:id}}],total:2,next_cursor:q.cursor?null:'page-two'}};
     if(q.cursor==='held')return held.promise;return result;
   }
 }},async ui=>{
   await ui.app.action('nav',{view:'schedule',period:'past'});await ui.app.action('more',{cursor:'page-two',view:'schedule'});
   assert.deepEqual(ui.app.state.model.data.items.map(e=>e.id),['newest','older']);
   assert.ok(ui.app.state.model.data.items.every(e=>e.status==='UNKNOWN'));
   const pending=ui.app.action('more',{cursor:'held',view:'schedule'});await until(()=>ui.calls.some(c=>c.url.searchParams.get('cursor')==='held'));
   await ui.app.action('schedule-period',{value:'upcoming'});
   held.resolve(response({selection:{period:'past',direction:'desc'},data:{items:[{id:'late-old'}],total:3}}));await pending;
   assert.deepEqual(ui.app.state.model.data.items.map(e=>e.id),['upcoming']);
   for(const [name,data]of [['schedule-filter',{value:'practices'}],['schedule-mode',{value:'day'}],['season-select',{value:'historical-season'}]]){
     await ui.app.action(name,data);const last=ui.calls.filter(c=>c.path==='/api/schedule').at(-1);
     assert.equal(last.url.searchParams.has('cursor'),false);assert.equal(ui.app.state.model.data.items.length,1);
   }
 });
});

uiTest('Schedule safely restarts an old-order cursor without accepting it under the new policy',async()=>{
 const late=deferred();
 await withUI({teams:[team()],resolve:call=>{
   if(call.path==='/api/calendar')return {data:{days:[]}};
   if(call.path==='/api/schedule'){
     if(call.url.searchParams.get('cursor')==='late-old')return late.promise;
     if(call.url.searchParams.has('cursor'))return failure('cursor_selection','The cursor belongs to another selection.',400);
     return {selection:Object.fromEntries(call.url.searchParams),data:{items:[{id:'saved-game',status:'UNKNOWN',type:'game',title:'Saved game',starts_at:'2026-10-12T12:00:00Z',home:{name:'Home'},away:{name:'Away'}}],total:1,next_cursor:null}};
   }
 }},async ui=>{
   await ui.app.action('nav',{view:'schedule',period:'past'});
   await ui.app.action('more',{cursor:'old-order-token',view:'schedule'});
   const calls=ui.calls.filter(c=>c.path==='/api/schedule');assert.equal(calls.length,3);
   assert.equal(calls[1].url.searchParams.get('cursor'),'old-order-token');assert.equal(calls[2].url.searchParams.has('cursor'),false);
   assert.equal(calls[2].url.searchParams.get('direction'),'desc');assert.deepEqual(ui.app.state.model.data.items.map(e=>e.id),['saved-game']);
   assert.equal(ui.app.state.model.data.items[0].status,'UNKNOWN');assert.match(ui.query('#toast').textContent,/Reloading this selection/);
   assert.doesNotMatch(ui.query('#root').textContent,/another selection/);
   const pending=ui.app.action('more',{cursor:'late-old',view:'schedule'});await until(()=>ui.calls.some(c=>c.url.searchParams.get('cursor')==='late-old'));
   await ui.app.action('schedule-period',{value:'upcoming'});const count=ui.calls.filter(c=>c.path==='/api/schedule').length;
   late.resolve(failure('cursor_selection','The cursor belongs to another selection.',400));await pending;
   assert.equal(ui.calls.filter(c=>c.path==='/api/schedule').length,count);assert.equal(ui.app.state.model.selection.period,'upcoming');
 });
});

uiTest('blank provider game titles get one shared accessible fallback without changing identity',async()=>{
 await withUI({teams:[team()],resolve:call=>{
  if(call.path==='/api/schedule')return {data:{items:[{id:'live-game',type:'game',title:'',home_name:'White',away_name:'Albion',starts_at:'2026-10-23T18:00:00Z',status:'SCHEDULED'}],total:1}};
  if(call.path==='/api/calendar')return {data:{days:[]}};
  if(call.path==='/api/matches/live-game')return {data:{event:{id:'live-game',type:'game',title:' ',home_name:'White',away_name:'Albion',starts_at:'2026-10-23T18:00:00Z',status:'SCHEDULED'},capabilities:{can_bookmark:true}}};
 }},async ui=>{
  await ui.app.action('nav',{view:'schedule'});const card=ui.query('[data-action="match"][data-id="live-game"]');assert.equal(card.getAttribute('aria-label'),'Open match details: White vs Albion');
  await ui.app.action('match',{id:'live-game'});assert.equal(ui.query('#entityTitle').textContent,'White vs Albion');assert.equal(ui.query('[data-action="bookmark"]').dataset.id,'live-game');assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);
 });
});
