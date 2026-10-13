import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../web/app/main.js';
import {createFeatureBridge} from '../web/app/features.js';

// In-process actual-main DOM coverage. No browser, provider, network or account.
// MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom/lib/api.js \
//   node --test tests/attendance-retry-ui.test.mjs
const require=createRequire(import.meta.url);
let domModule;try{domModule=require(process.env.MYTS_JSDOM_MODULE||'jsdom');}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const uiTest=(name,run)=>test(name,{skip:domModule?false:'Set MYTS_JSDOM_MODULE to run actual-main DOM tests.',concurrency:false},run);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label='UI transition'){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('Timed out: '+label);}
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const failure=(code='attendance_retry_unavailable',message='The connection changed. Reload its status.',status=409)=>response({error:{code,message}},status);
const root=(overrides={})=>({id:'root-a',app_team_id:'team-a',provider:'teamsnap',name:'Synthetic source team',active:true,generation:7,attendance_retry_available:true,seasons:[],...overrides});
const queued=(id='root-a')=>({connection_id:id,component:'attendance',queued:true,already_queued:false});
const retrySelector='[data-action="source-attendance-retry"]';
const retryStatus='[data-attendance-retry-status]';
async function fixture({connections=[root()],legacy=false,role='owner',resolve=()=>{}}={}){
 const {JSDOM,VirtualConsole}=domModule,errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error));
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://myts.example/admin',virtualConsole:vc,pretendToBeVisual:true}),saved=new Map();
 const set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
 for(const key of ['window','document','history','location','sessionStorage','localStorage','FormData','AbortController','AbortSignal','HTMLElement','Element','Node','Event','MouseEvent','CustomEvent'])set(key,key==='window'?dom.window:dom.window[key]);
 dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 const teams=['a','b'].map(id=>({id:'team-'+id,name:'Team '+id,timezone:'UTC',seasons:[{id:'season-'+id,label:'2026–2027',year:2026,start_day:'2026-06-01',end_day:'2027-06-01'}]}));
 const model={role,status:{[legacy?'attachments':'connections']:connections,providers:[{provider:'teamsnap',total:1,groups:[{stage:'source',state:'failed',coverage:'partial',count:1}]}],jobs:{items:[{provider:'teamsnap',component:'attendance',state:'failed',id:'unrelated-page-job'}],next_cursor:'more-jobs'}}},calls=[],unexpected=[];
 const fetcher=async(path,options={})=>{
  const url=new URL(path,'https://myts.example'),call={url,path:url.pathname,method:options.method??'GET',body:options.body?JSON.parse(options.body):null};calls.push(call);
  const override=await resolve(call,model);if(override!==undefined)return override instanceof Response?override:response(override);
  if(call.path==='/api/bootstrap')return response({version:'retry-ui-fixture',setup:{state:'ready',owner_ready:true},session:{role:model.role,categories:['overview','schedule']},teams,preferences:{theme:'light'}});
  if(call.path==='/api/teams')return response({items:teams,total:teams.length,revision:1,next_cursor:null});
  if(/^\/api\/teams\/[^/]+\/seasons$/.test(call.path))return response({items:teams.find(team=>team.id===call.path.split('/')[3]).seasons,total:1,revision:1,next_cursor:null});
  if(call.path==='/api/revisions')return response({revision:1});
  if(call.path==='/api/calendar')return response({data:{days:[]}});
  if(call.path==='/api/overview'||call.path==='/api/schedule')return response({data:{items:[],total:0}});
  if(call.path==='/api/status')return response({data:structuredClone(model.status)});
  if(call.path==='/api/accounts')return response({accounts:[]});
  unexpected.push(call);return failure('fixture_route','Unexpected '+call.path,500);
 };
 const app=createApp({...createFeatureBridge(),host:dom.window.document.body,fetcher});
 const query=selector=>dom.window.document.querySelector(selector);
 const click=async(selector)=>{const node=query(selector);assert.ok(node,'Missing '+selector);assert.notEqual(node.disabled,true,'Disabled '+selector);node.click();await tick();};
 const ui={app,model,calls,query,click,dom,async manage(provider='teamsnap'){await click('#accountBtn');await until(()=>app.state.modal?.kind==='settings');await click(`[data-action="source-manage"][data-provider="${provider}"]`);await until(()=>app.state.modal?.kind==='source-status');},posts:()=>calls.filter(call=>call.method==='POST')};
 ui.close=close;
 try{await app.start();return ui;}catch(error){await close();throw error;}
 async function close(){app.stop();dom.window.close();for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);}
}
async function withUI(options,run){const ui=await fixture(options);try{await run(ui);}finally{await ui.close();}}

uiTest('ordinary Settings → Manage → Retry attendance posts only the exact selected typed root',async()=>{
 await withUI({resolve:call=>call.path==='/api/connections/root-a/attendance/retry'?queued():undefined},async ui=>{
  await ui.manage();assert.match(ui.query(retryStatus).textContent,/failed/);await ui.click(retrySelector);
  await until(()=>/retry queued/.test(ui.query(retryStatus)?.textContent??''));
  assert.deepEqual(ui.posts().map(({path,body})=>({path,body})),[{path:'/api/connections/root-a/attendance/retry',body:{team_id:'team-a',generation:7}}]);
  assert.equal(ui.query(retrySelector),null);assert.match(ui.query(retryStatus).textContent,/View import progress/);assert.doesNotMatch(ui.query(retryStatus).textContent,/complete|finished/i);
  assert.equal(ui.app.state.modal.kind,'source-status');assert.equal(ui.calls.some(call=>call.path.endsWith('/sync')),false);
 });
});

uiTest('source picker uses exact root availability, never another root or the failed jobs page',async()=>{
 await withUI({connections:[root({attendance_retry_available:false}),root({id:'root-b',generation:9})],resolve:call=>call.path==='/api/connections/root-b/attendance/retry'?queued('root-b'):undefined},async ui=>{
  await ui.manage();assert.equal(ui.query(retrySelector),null);
  await ui.click('[data-action="source-attachment-select"][data-value="root-b"]');await until(()=>ui.app.state.modal?.data.attachment_id==='root-b');
  await ui.click(retrySelector);await until(()=>ui.posts().length===1);assert.deepEqual(ui.posts()[0].body,{team_id:'team-a',generation:9});assert.equal(ui.posts()[0].path,'/api/connections/root-b/attendance/retry');
 });
});

for(const [name,options,provider] of [
 ['queued, running or ready root', {connections:[root({attendance_retry_available:false})]},'teamsnap'],
 ['missing availability on older server', {connections:[root({attendance_retry_available:undefined})]},'teamsnap'],
 ['legacy seasonal attachment', {connections:[root()],legacy:true},'teamsnap'],
 ['another destination team', {connections:[root({app_team_id:'team-b'})]},'teamsnap'],
 ['other provider', {connections:[root({provider:'trace'})]},'trace'],
 ['inactive root beside active healthy root', {connections:[root({active:false}),root({id:'healthy',attendance_retry_available:false})]},'teamsnap'],
])uiTest(`Retry attendance stays hidden for ${name}`,async()=>{
 await withUI(options,async ui=>{await ui.manage(provider);assert.equal(ui.query(retrySelector),null);await ui.app.action('source-attendance-retry');assert.deepEqual(ui.posts(),[]);});
});

uiTest('duplicate ordinary clicks and a repeated action send one pending request',async()=>{
 const gate=deferred();await withUI({resolve:call=>call.path.endsWith('/attendance/retry')?gate.promise:undefined},async ui=>{
  await ui.manage();const button=ui.query(retrySelector);button.click();button.click();await until(()=>ui.posts().length===1);assert.equal(button.disabled,true);
  await ui.app.action('source-attendance-retry');assert.equal(ui.posts().length,1);gate.resolve(queued());await until(()=>ui.query(retrySelector)===null);
 });
});

for(const transition of ['close','new-modal','navigation','team','back'])for(const outcome of ['success','error'])uiTest(`late retry ${outcome} is ignored after ${transition}`,async()=>{
 const gate=deferred();await withUI({resolve:call=>call.path.endsWith('/attendance/retry')?gate.promise:undefined},async ui=>{
  await ui.manage();await ui.click(retrySelector);await until(()=>ui.posts().length===1);
  if(transition==='close')await ui.click('[data-close="accountModal"]');
  if(transition==='new-modal')await ui.click('[data-action="status-open"]');
  if(transition==='navigation')await ui.click('[data-action="nav"][data-view="schedule"]');
  if(transition==='team')await ui.click('[data-action="team-select"][data-value="team-b"]');
  if(transition==='back')await ui.app.action('back');
  await until(()=>['close','back'].includes(transition)?ui.app.state.modal?.kind==='settings':transition==='new-modal'?ui.app.state.modal?.kind==='status':transition==='team'?ui.app.state.team==='team-b'&&ui.app.state.modal===null:ui.app.state.modal===null);
  const modal=ui.app.state.modal,body=ui.query('#accountBody').innerHTML,toast=ui.query('#toast').textContent,route=ui.app.state.routeEpoch;
  gate.resolve(outcome==='success'?queued():failure('sign_in_required','Late failure must not sign out the new screen.',401));
  for(let i=0;i<6;i++)await tick();
  assert.equal(ui.app.state.modal,modal);assert.equal(ui.query('#accountBody').innerHTML,body);assert.equal(ui.query('#toast').textContent,toast);assert.equal(ui.app.state.routeEpoch,route);assert.equal(ui.app.state.bootstrap.session.role,'owner');assert.equal(ui.posts().length,1);
 });
});

uiTest('current failure offers retry and reload; a successful retry remains queued only',async()=>{
 let attempt=0;await withUI({resolve:call=>call.path.endsWith('/attendance/retry')?(++attempt===1?failure('attendance_retry_unavailable','Reload this changed connection <img src=x>.'):queued()):undefined},async ui=>{
  await ui.manage();await ui.click(retrySelector);await until(()=>/not confirmed/.test(ui.query(retryStatus)?.textContent??''));assert.equal(ui.query(retrySelector).disabled,false);assert.match(ui.query(retryStatus).textContent,/Try again or reload status/);assert.equal(ui.query('[data-attendance-retry] img'),null);
  await ui.click('[data-attendance-retry] [data-action="source-manage"]');await until(()=>/Attendance update failed/.test(ui.query(retryStatus)?.textContent??''));await ui.click(retrySelector);await until(()=>ui.query(retrySelector)===null);assert.equal(ui.posts().length,2);
 });
});

uiTest('unconfirmed response cannot claim queued and keeps recovery controls',async()=>{
 await withUI({resolve:call=>call.path.endsWith('/attendance/retry')?{queued:false}:undefined},async ui=>{
  await ui.manage();await ui.click(retrySelector);await until(()=>/not confirmed/.test(ui.query(retryStatus)?.textContent??''));assert.equal(ui.query(retrySelector).disabled,false);assert.doesNotMatch(ui.query(retryStatus).textContent,/retry queued/i);
 });
});

uiTest('current owner expiry uses normal sign-in recovery',async()=>{
 await withUI({resolve:call=>call.path.endsWith('/attendance/retry')?failure('sign_in_required','Sign in to continue.',401):undefined},async ui=>{
  await ui.manage();await ui.click(retrySelector);await until(()=>ui.app.state.bootstrap.session.role==='anonymous');assert.equal(ui.app.state.modal,null);assert.equal(ui.query('#loginScreen').classList.contains('hidden'),false);
 });
});

uiTest('owner gate and modal scope prevent a stale action from posting',async()=>{
 await withUI({},async ui=>{
  await ui.manage();ui.app.state.bootstrap.session.role='viewer';await assert.rejects(()=>ui.app.action('source-attendance-retry'),/owner/);assert.deepEqual(ui.posts(),[]);
  ui.app.state.bootstrap.session.role='owner';await ui.click('[data-close="accountModal"]');await ui.app.action('source-attendance-retry');assert.deepEqual(ui.posts(),[]);
 });
});

for(const outcome of ['success','error'])uiTest(`reopened pending Manage suppresses duplicate retry; explicit Reload status recovers after ${outcome}`,async()=>{
 const gate=deferred();await withUI({resolve:call=>call.path.endsWith('/attendance/retry')?gate.promise:undefined},async ui=>{
  await ui.manage();await ui.click(retrySelector);await until(()=>ui.posts().length===1);await ui.click('[data-close="accountModal"]');await ui.manage();
  assert.equal(ui.query(retrySelector).disabled,true);assert.match(ui.query(retryStatus).textContent,/Reload status/);const before=ui.query('#accountBody').innerHTML;
  if(outcome==='success')ui.model.status.connections[0].attendance_retry_available=false;
  gate.resolve(outcome==='success'?queued():failure());for(let i=0;i<6;i++)await tick();
  assert.equal(ui.query('#accountBody').innerHTML,before);assert.equal(ui.posts().length,1);
  await ui.click('[data-attendance-retry] [data-action="source-manage"]');
  await until(()=>outcome==='success'?ui.query(retrySelector)===null:ui.query(retrySelector)?.disabled===false);
  assert.equal(ui.posts().length,1);
 });
});

for(const direction of ['back','forward'])for(const outcome of ['success','error'])uiTest(`browser ${direction} preserves its destination after late retry ${outcome}`,async()=>{
 const gate=deferred();await withUI({resolve:call=>call.path.endsWith('/attendance/retry')?gate.promise:undefined},async ui=>{
  await ui.click('[data-action="nav"][data-view="schedule"]');await until(()=>ui.app.state.view==='schedule');
  if(direction==='forward'){ui.dom.window.history.back();await until(()=>ui.app.state.view==='overview','initial history back');}
  await ui.manage();await ui.click(retrySelector);await until(()=>ui.posts().length===1);ui.dom.window.history[direction]();
  const view=direction==='back'?'overview':'schedule';await until(()=>ui.app.state.modal===null&&ui.app.state.view===view,'history destination');
  const epoch=ui.app.state.routeEpoch,toast=ui.query('#toast').textContent;
  gate.resolve(outcome==='success'?queued():failure());for(let i=0;i<6;i++)await tick();
  assert.equal(ui.app.state.modal,null);assert.equal(ui.app.state.view,view);assert.equal(ui.dom.window.history.state.route.view,view);assert.equal(ui.app.state.routeEpoch,epoch);assert.equal(ui.query('#toast').textContent,toast);assert.equal(ui.posts().length,1);
 });
});
