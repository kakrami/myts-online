import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../web/app/main.js';
import {createFeatureBridge} from '../web/app/features.js';

// Actual-main DOM integration, synthetic status only. No network/provider writes.
// MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom/lib/api.js \
//   node --test tests/source-progress-ui.test.mjs
const require=createRequire(import.meta.url);
let domModule;try{domModule=require(process.env.MYTS_JSDOM_MODULE||'jsdom');}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const uiTest=(name,run)=>test(name,{skip:domModule?false:'Set MYTS_JSDOM_MODULE to run actual-main DOM tests.',concurrency:false},run);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label='UI transition'){for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail('Timed out: '+label);}
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const group=(state,coverage='none',count=1)=>({stage:'source',state,coverage,count});
const provider=(groups=[],extra={})=>({provider:'trace',total:groups.reduce((n,g)=>n+g.count,0),groups,...extra});
const root=(extra={})=>({id:'trace-root',provider:'trace',app_team_id:'team-a',name:'Synthetic source',active:true,account_id:'trace-account',authorization_state:'connected',generation:1,seasons:[],...extra});
const liveGroups=[group('blocked','none',9),group('queued','none',501),group('queued','partial',160),group('ready','complete',3)];
async function fixture({status,resolve=()=>{}}={}){
 const {JSDOM,VirtualConsole}=domModule,errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error));
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://myts.example/admin',virtualConsole:vc,pretendToBeVisual:true}),saved=new Map();
 const set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
 for(const key of ['window','document','history','location','sessionStorage','localStorage','FormData','AbortController','AbortSignal','HTMLElement','Element','Node','Event','MouseEvent','CustomEvent'])set(key,key==='window'?dom.window:dom.window[key]);
 dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 const teams=[{id:'team-a',name:'Synthetic team',timezone:'UTC',seasons:[{id:'season-a',label:'2026–2027',year:2026,start_day:'2026-06-01',end_day:'2027-06-01'}]}];
 const model={status:status??{providers:[provider(liveGroups)],connections:[root()],connections_page:{total:1},summary:{total:673},jobs:{items:[{provider:'trace',component:'analytics',state:'blocked',coverage:'restricted',last_error_message:'Permission denied for this component.'}],total:673}}},calls=[],unexpected=[],downloads=[],blobs=[];
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-diagnostics';};URL.revokeObjectURL=()=>{};
 dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,download:this.download});};
 const fetcher=async(path,options={})=>{
  const url=new URL(path,'https://myts.example'),call={path:url.pathname,method:options.method??'GET',url};calls.push(call);
  const override=await resolve(call,model);if(override!==undefined)return response(override);
  if(call.path==='/api/bootstrap')return response({version:'source-progress-fixture',setup:{state:'ready',owner_ready:true},session:{role:'owner',categories:['overview']},teams,preferences:{theme:'light'}});
  if(call.path==='/api/teams')return response({items:teams,total:1,revision:1,next_cursor:null});
  if(call.path==='/api/teams/team-a/seasons')return response({items:teams[0].seasons,total:1,revision:1,next_cursor:null});
  if(call.path==='/api/revisions')return response({revision:1});
  if(call.path==='/api/overview')return response({data:{}});
  if(call.path==='/api/status')return response({data:structuredClone(model.status)});
  if(call.path==='/api/accounts')return response({accounts:[]});
  unexpected.push(call);return response({error:{message:'Unexpected '+call.path}});
 };
 const app=createApp({...createFeatureBridge(),host:dom.window.document.body,fetcher});
 const query=selector=>dom.window.document.querySelector(selector);
 const click=async selector=>{const node=query(selector);assert.ok(node,'Missing '+selector);assert.notEqual(node.disabled,true);node.click();await tick();};
 const summary=providerName=>query(`[data-action="source-manage"][data-provider="${providerName}"]`)?.closest('.account-source').querySelector('.source-summary').textContent;
 const ui={app,model,calls,query,click,summary,downloads,blobs,async settings(){await click('#accountBtn');await until(()=>app.state.modal?.kind==='settings');},async close(){app.stop();dom.window.close();URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);assert.ok(calls.every(call=>call.method==='GET'),'Opening status must not write or trigger sync.');}};
 try{await app.start();return ui;}catch(error){await ui.close();throw error;}
}
async function withUI(options,run){const ui=await fixture(options);try{await run(ui);}finally{await ui.close();}}

uiTest('ordinary Settings → Manage → Update details and Diagnostics preserve full evidence behind the concise live-shaped summary',async()=>{
 await withUI({},async ui=>{
  await ui.settings();assert.equal(ui.summary('trace'),'Update queued · Some data needs attention');
  assert.doesNotMatch(ui.summary('trace'),/501|160|none|partial|%|complete/);
  assert.deepEqual([...ui.query('#accountBody').querySelectorAll('[data-action="source-manage"]')].map(node=>node.dataset.provider),['teamsnap','gotsport','trace']);
  await ui.click('[data-action="source-manage"][data-provider="trace"]');await until(()=>ui.app.state.modal?.kind==='source-status');
  assert.match(ui.query('#accountBody').textContent,/Update queued · Some data needs attention/);
  for(const action of ['source-sync','source-reconnect','account-teams','source-unlink','status-open','diagnostics'])assert.ok(ui.query(`[data-action="${action}"]`),action);
  await ui.click('[data-action="diagnostics"]');await until(()=>ui.downloads.length===1);
  assert.equal(ui.downloads[0].download,'myts-diagnostics.json');
  const raw=JSON.parse(await ui.blobs[0].text());assert.deepEqual(raw.providers[0].groups,liveGroups);assert.equal(raw.summary.total,673);assert.equal(raw.jobs.items[0].last_error_message,'Permission denied for this component.');
  await ui.click('[data-action="status-open"]');await until(()=>ui.app.state.modal?.kind==='status');
  assert.match(ui.query('#accountBody').textContent,/673 background jobs/);
  for(const label of ['source · blocked · none','source · queued · none','source · queued · partial','Permission denied for this component.'])assert.ok(ui.query('#accountBody').textContent.includes(label),label);
  await ui.click('[data-close="accountModal"]');assert.equal(ui.app.state.modal,null);
  await ui.settings();assert.equal(ui.summary('trace'),'Update queued · Some data needs attention');
 });
});

uiTest('reopening actual Settings reflects status transitions without changing the workflow or writing',async()=>{
 await withUI({},async ui=>{
  for(const [groups,expected] of [
   [[group('running','partial')],'Updating in background'],
   [[group('retrying','partial')],'Retry scheduled'],
   [[group('failed','partial')],'Some data needs attention'],
   [[group('ready','partial')],'Saved data available'],
   [[group('ready','restricted')],'Some data is unavailable'],
   [[group('ready','unpublished')],'Some data is not published'],
   [[group('ready','complete')],'Source update complete'],
   [[], 'Connected · Waiting for background work'],
  ]){
   ui.model.status.providers=[provider(groups)];await ui.settings();assert.equal(ui.summary('trace'),expected);
   assert.ok(ui.query('[data-action="status-open"]'));assert.ok(ui.query('[data-action="diagnostics"]'));
   await ui.click('[data-close="accountModal"]');assert.equal(ui.app.state.modal,null);
  }
  ui.model.status.providers=[];ui.model.status.connections=[root({authorization_state:'disconnected',imported_roster_total:4})];
  await ui.settings();assert.equal(ui.summary('trace'),'Disconnected · Saved data available');
  await ui.click('[data-close="accountModal"]');ui.model.status.connections=[root({authorization_state:'expired'})];
  await ui.settings();assert.equal(ui.summary('trace'),'Reconnect required');
  await ui.click('[data-close="accountModal"]');ui.model.status.connections=[];
  await ui.settings();assert.equal(ui.summary('trace'),'No background work recorded');
 });
});

uiTest('trusted provider summary is escaped and zero-job typed context does not replace it',async()=>{
 const label='Saved history <img src=x> · Waiting for season evidence';
 await withUI({status:{providers:[provider([],{status_label:label})],connections:[root()]}},async ui=>{
  await ui.settings();assert.equal(ui.summary('trace'),label);assert.equal(ui.query('.account-source img'),null);
 });
});

uiTest('a paginated 100-row connection catalog cannot hide working provider jobs behind a disconnected headline',async()=>{
 const connections=Array.from({length:100},(_,i)=>root({id:'saved-'+i,active:false}));
 await withUI({status:{providers:[provider([group('running','partial')])],connections,connections_page:{total:101,next_cursor:'more-connections'}}},async ui=>{
  await ui.settings();assert.equal(ui.summary('trace'),'Updating in background');
  await ui.click('[data-close="accountModal"]');
  ui.model.status.connections=connections.map(connection=>({...connection,active:true,authorization_state:'expired'}));
  await ui.settings();assert.equal(ui.summary('trace'),'Updating in background');
  assert.equal(ui.calls.filter(call=>call.path==='/api/status').length,2,'Summary uses existing status reads, not a new catalog crawl.');
 });
});
