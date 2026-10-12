import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../web/app/main.js';
import {createFeatureBridge} from '../web/app/features.js';

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
const team=(id='destination-a',name='Existing team')=>({id,name,timezone:'UTC',seasons:[{id:`${id}-season`,label:'2026–2027',year:2026,start_day:'2026-07-01',end_day:'2027-07-01'}]});
const account=(provider='trace',id='account-a',name='Coach account')=>({id,provider,name,display_name:name,label:name,active:true,authorization_state:'connected'});
const source=(provider='trace',id='source-a',name='United U12')=>({id,provider,name,season_label:'2026-2027'});

async function fixture({accounts=[],teams=[],sourceTeams=[source()],resolve:resolveRequest=()=>{},storage=null}={}) {
  const {JSDOM,VirtualConsole}=domModule,errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://myts.example/admin',virtualConsole,pretendToBeVisual:true});
  const saved=new Map(),set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
  const redirects=[];
  for(const key of ['window','document','history','sessionStorage','localStorage','FormData','AbortController','AbortSignal','HTMLElement','Element','Node','Event','MouseEvent','CustomEvent'])set(key,key==='window'?dom.window:dom.window[key]);
  set('location',{get origin(){return dom.window.location.origin;},get pathname(){return dom.window.location.pathname;},get search(){return dom.window.location.search;},get hash(){return dom.window.location.hash;},set hash(value){dom.window.location.hash=value;},assign:url=>redirects.push(url)});
  for(const [key,value] of Object.entries(storage??{}))dom.window.sessionStorage.setItem(key,value);
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  const calls=[],unexpected=[],model={accounts,teams,sourceTeams,role:'owner'},fetcher=async(path,options={})=>{
    const url=new URL(path,'https://myts.example'),call={path:url.pathname,url,method:options.method??'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers??{},signal:options.signal};
    calls.push(call);
    const overridden=await resolveRequest(call,model,calls);
    if(overridden!==undefined)return overridden instanceof Response?overridden:response(overridden);
    if(call.path==='/api/bootstrap')return response({version:'connection-ui-fixture',setup:{state:'ready',owner_ready:true},session:{role:model.role},teams:structuredClone(model.teams),preferences:{theme:'light'}});
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
  const mount=async()=>{const hooks=createFeatureBridge();app=createApp({...hooks,host:dom.window.document.body,fetcher});await app.start();return app;};
  const query=selector=>dom.window.document.querySelector(selector);
  const click=async(selector)=>{const node=query(selector);assert.ok(node,`Missing clickable element: ${selector}`);assert.notEqual(node.disabled,true,`Disabled element: ${selector}`);node.click();await tick();};
  const fill=(selector,value)=>{const node=query(selector);assert.ok(node,`Missing field: ${selector}`);node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  const submit=async(selector)=>{const form=query(selector);assert.ok(form,`Missing form: ${selector}`);form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();};
  try {await mount();}catch(error){for(const [key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];dom.window.close();throw error;}
  return {get app(){return app;},dom,calls,model,redirects,query,click,fill,submit,async reload(){app.stop();dom.window.document.body.innerHTML='';return mount();},savedStorage(){return Object.fromEntries(Object.keys(dom.window.sessionStorage).map(key=>[key,dom.window.sessionStorage.getItem(key)]));},async close(){app.stop();dom.window.close();for(const [key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];assert.deepEqual(unexpected.map(call=>`${call.method} ${call.path}`),[]);assert.deepEqual(errors,[]);}};
}
async function withUI(options,run){const ui=await fixture(options);try{await run(ui);}finally{await ui.close();}}
const hasCall=(ui,path)=>ui.calls.some(call=>call.path===path);

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
    await until(()=>ui.query('form[data-form="source-attach"]'),'confirmation');
    assert.equal(ui.query('[name="name"]').value,'United U12');assert.equal(ui.query('[name="season_year"]').value,'2026');
    await ui.submit('form[data-form="source-attach"]');
    await until(()=>ui.query('[data-action="connection-retry"]'),'safe retry after lost response');
    const first=ui.calls.find(call=>call.path==='/api/connections');
    assert.equal(first.method,'POST');assert.equal(first.body.request_id,first.headers['Idempotency-Key']);
    assert.equal(first.body.source_team_id,'source-a');assert.equal(first.body.account_id,'account-a');
    assert.equal(first.body.new_team.name,'United U12');assert.equal(first.body.new_team.season_year,2026);
    const pending=JSON.parse(ui.savedStorage()['myts.connection.v1']).pending;
    assert.equal(pending.requestId,first.body.request_id);
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

uiTest('refresh during provider discovery keeps the original intended destination',async()=>{
  const intended=team('intended','Intended team'),current=team('current','Other team');
  await withUI({teams:[intended,current],accounts:[account()],resolve:call=>call.path==='/api/teams/intended/seasons'?{items:intended.seasons}:undefined},async ui=>{
    await ui.app.manageSource('trace');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    ui.model.teams=[current,{...intended,seasons:[]}];
    await ui.reload();
    assert.equal(ui.app.state.team,current.id);
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('form[data-form="source-attach"]'),'resumed attachment');
    assert.equal(ui.query('[name="destination"]').value,`${intended.id}:${intended.seasons[0].id}`);
    assert.match(ui.query('#accountBody').textContent,/Connect to Intended team/);
  });
});

uiTest('refresh at confirmation restores an intended destination outside the bootstrap season page',async()=>{
  const intended=team('intended','Intended team'),current=team('current','Other team');
  await withUI({teams:[intended,current],accounts:[account()],resolve:call=>call.path==='/api/teams/intended/seasons'?{items:intended.seasons}:undefined},async ui=>{
    await ui.app.manageSource('trace');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('form[data-form="source-attach"]'),'initial confirmation');
    assert.equal(ui.query('[name="destination"]').value,`${intended.id}:${intended.seasons[0].id}`);
    ui.model.teams=[current,{...intended,seasons:[]}];
    await ui.reload();
    assert.equal(ui.app.state.team,current.id);
    assert.equal(ui.query('[name="destination"]').value,`${intended.id}:${intended.seasons[0].id}`);
    assert.match(ui.query('#accountBody').textContent,/Connect to Intended team/);
    assert.equal(ui.query('[data-new-team-fields]').hidden,true);
  });
});

uiTest('an ambiguous provider season asks for a year without inventing a current-season default',async()=>{
  await withUI({accounts:[account()],sourceTeams:[{...source(),season_label:'Spring'}]},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('form[data-form="source-attach"]'),'confirmation');
    const year=ui.query('[name="season_year"]');
    assert.equal(year.value,'');assert.equal(year.required,true);assert.ok(year.closest('[data-season-question]'));
    assert.equal(year.closest('details'),null,'A required season question must be visible before advanced details.');
    await ui.submit('form[data-form="source-attach"]');
    assert.equal(hasCall(ui,'/api/connections'),false);
    assert.equal(ui.app.state.bootstrap.session.role,'owner');
    assert.match(ui.query('#accountBody').textContent,/year this season starts/);
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
    await ui.app.manageSource('trace');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('form[data-form="source-attach"]'),'connection confirmation');
    ui.fill('[name="destination"]','');await ui.submit('form[data-form="source-attach"]');
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
    await until(()=>ui.query('form[data-form="source-attach"]'),'connection confirmation');
    ui.fill('[name="destination"]','');await ui.submit('form[data-form="source-attach"]');
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
    await until(()=>ui.query('form[data-form="source-attach"]'),'connection confirmation');
    await ui.submit('form[data-form="source-attach"]');
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
    await until(()=>ui.query('form[data-form="source-attach"]'),'connection confirmation');
    await ui.submit('form[data-form="source-attach"]');
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
    await ui.app.manageSource('trace');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('form[data-form="source-attach"]'),'connection confirmation');
    ui.fill('[name="destination"]','');await ui.submit('form[data-form="source-attach"]');
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
  const saved=team('saved-connection','Recovered team');
  await withUI({accounts:[account()],resolve:(call,model)=>{
    if(call.path!=='/api/connections')return;
    if(call.method==='GET')return {found:true,team_id:saved.id,season_id:saved.seasons[0].id,team_available:true,attachment_active:true,account_active:false};
    model.teams=[saved];throw new TypeError('Synthetic response lost after commit.');
  }},async ui=>{
    await ui.click('[data-action="source-manage"][data-provider="trace"]');
    await until(()=>ui.query('[data-action="source-team-select"]'),'source team chooser');
    await ui.click('[data-action="source-team-select"]');
    await until(()=>ui.query('form[data-form="source-attach"]'),'connection confirmation');
    await ui.submit('form[data-form="source-attach"]');
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
    assert.equal(ui.app.state.season,saved.seasons[0].id);
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
    await ui.app.manageSource('trace');await ui.click('[data-action="source-team-select"]');await ui.submit('form[data-form="source-attach"]');
    await until(()=>ui.query('[data-action="connection-retry"]'),'pending command');const pending=JSON.parse(ui.savedStorage()['myts.connection.v1']).pending;
    await ui.app.action('connection-cancel');await ui.app.action('account-teams',{provider:'teamsnap',account:'other-account'});
    assert.ok(ui.query('[data-action="connection-retry"]'));assert.deepEqual(ui.app.connection.value.pending,pending);
    await ui.app.action('connection-cancel');await ui.app.searchGotSport({q:'Different team',age:12,gender:'f'});
    assert.ok(ui.query('[data-action="connection-retry"]'));assert.deepEqual(ui.app.connection.value.pending,pending);
    assert.equal(ui.calls.some(call=>call.path==='/api/accounts/other-account/teams'||call.path==='/api/sources/gotsport/search'),false);
  });
});
