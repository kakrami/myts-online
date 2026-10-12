import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../web/app/main.js';
import {createFeatureBridge} from '../web/app/features.js';

// Actual shell, feature bridge, form events and transport, with synthetic HTTP
// responses only. No provider, password, listener or Miniflare process is used.
// MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom/lib/api.js node --test tests/owner-security-ui.test.mjs
const require=createRequire(import.meta.url);
let domModule;
try{domModule=require(process.env.MYTS_JSDOM_MODULE||'jsdom');}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const uiTest=(name,run)=>test(name,{concurrency:false,skip:domModule?false:'Set MYTS_JSDOM_MODULE to run the owner security DOM controller.'},run);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async(predicate,label)=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail('Timed out: '+label);};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const failure=(code,status=400,message='Synthetic server error')=>response({error:{code,message}},status);
const rotated=()=>response({ok:true,role:'owner',expires_at:Date.now()+60000});
const original='synthetic old owner password';
const next='  synthetic new owner password  ';
const team=(id='team-a')=>({id,name:'Synthetic '+id,timezone:'UTC',seasons:[{id:id+'-2026',year:2026,label:'2026–2027',start_day:'2026-06-01',end_day:'2027-06-01'},{id:id+'-2025',year:2025,label:'2025–2026',start_day:'2025-06-01',end_day:'2026-06-01'}]});
async function withUI({teams=[team(),team('team-b')],role='owner',resolve=()=>{}}={},run){
 const {JSDOM,VirtualConsole}=domModule,errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error));
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:role==='viewer'?'https://myts.example/view/synthetic-viewer':'https://myts.example/admin',pretendToBeVisual:true,virtualConsole});
 const saved=new Map();for(const key of ['window','document','history','location','FormData','AbortController','AbortSignal','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','CustomEvent']){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true});}
 dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 const calls=[],unexpected=[],model={teams,role,theme:'light'},fetcher=async(path,options={})=>{
  const url=new URL(path,dom.window.location.origin),call={path:url.pathname,method:options.method??'GET',url,body:options.body?JSON.parse(options.body):null,credentials:options.credentials,headers:options.headers};calls.push(call);
  const override=await resolve(call,model);if(override!==undefined)return override instanceof Response?override:response(override);
  if(call.path==='/api/bootstrap')return response({version:'owner-security-synthetic',setup:{state:'ready',owner_ready:true},session:{role:model.role,categories:['overview','team']},teams:structuredClone(model.teams),preferences:{theme:model.theme}});
  if(call.path==='/api/accounts')return response({accounts:[]});
  if(call.path==='/api/status')return response({data:{providers:[],connections:[]}});
  if(call.path==='/api/overview')return response({data:{}});
  if(call.path==='/api/revisions')return response({revision:1});
  if(call.path==='/api/preferences'){if(call.method==='PATCH')model.theme=call.body.theme;return response({theme:model.theme,revision:1});}
  if(call.path==='/api/owner/logout'){model.role='anonymous';return response({ok:true});}
  if(call.path==='/api/owner/password')return rotated();
  unexpected.push(call);return failure('unexpected_fixture_route',500);
 };
 const bridge=createFeatureBridge(),app=createApp({...bridge,host:dom.window.document.body,fetcher});
 const query=selector=>dom.window.document.querySelector(selector);
 const click=async selector=>{const node=query(selector);assert.ok(node,'Missing '+selector);assert.notEqual(node.disabled,true);node.click();await tick();};
 const fill=(name,value)=>{const node=query(`[name="${name}"]`);assert.ok(node,'Missing '+name);node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 const fields=()=>[...dom.window.document.querySelectorAll('form[data-form="owner-password"] input')];
 const ui={app,bridge,dom,model,calls,query,click,fill,fields,
  async open(){await app.action('settings');await click('[data-action="owner-password"]');assert.equal(app.state.modal?.kind,'owner-password');},
  fillAll(values={}){for(const [key,value] of Object.entries({current_password:original,password:next,confirm_password:next,...values}))fill(key,value);},
  async submit(){query('form[data-form="owner-password"]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();},
  commands:()=>calls.filter(call=>call.path==='/api/owner/password'),
  storage:()=>JSON.stringify({local:{...dom.window.localStorage},session:{...dom.window.sessionStorage}}),
 };
 try{await app.start();await run(ui);}finally{app.stop();dom.window.close();for(const [key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);}
}
const assertEmpty=nodes=>{for(const node of nodes){assert.equal(node.value,'');assert.equal(node.defaultValue,'');assert.equal(node.hasAttribute('value'),false);}};

for(const scope of ['populated','zero-season','no-team'])uiTest(`ordinary owner Settings exposes password change in ${scope} scope`,()=>withUI({teams:scope==='no-team'?[]:scope==='zero-season'?[{...team(),seasons:[]}]:[team()]},async ui=>{
 await ui.open();const fields=ui.fields();assert.deepEqual(fields.map(node=>node.name),['current_password','password','confirm_password']);
 for(const node of fields){assert.equal(node.type,'password');assert.equal(node.required,true);assert.equal(node.maxLength,300);assert.ok(ui.query(`label[for="${node.id}"]`));assert.match(node.getAttribute('aria-describedby'),/owner-password-help/);}
 assert.equal(fields[0].autocomplete,'current-password');assert.equal(fields[1].autocomplete,'new-password');assert.equal(fields[2].autocomplete,'new-password');assert.equal(fields[1].minLength,16);assert.equal(ui.dom.window.document.activeElement,fields[0]);assertEmpty(fields);
 await ui.click('[data-action="owner-password-cancel"]');assert.equal(ui.app.state.modal,null);assertEmpty(fields);assert.equal(ui.query('form[data-form="owner-password"]'),null);
}));

for(const role of ['viewer','anonymous'])uiTest(`${role} cannot open or submit owner password controls`,()=>withUI({role},async ui=>{
 await ui.app.action('settings');assert.equal(ui.query('[data-action="owner-password"]'),null);
 await ui.app.action('owner-password');assert.notEqual(ui.app.state.modal?.kind,'owner-password');
 const data=new ui.dom.window.FormData();data.set('current_password',original);data.set('password',next);data.set('confirm_password',next);
 await ui.bridge.handlers.forms['owner-password'](data,{},ui.app);assert.equal([...data].length,0);assert.equal(ui.commands().length,0);
}));

uiTest('password success sends one same-origin PUT, preserves exact spaces and never serializes confirmation or application secrets',()=>withUI({},async ui=>{
 await ui.open();ui.fillAll();const nodes=ui.fields();await ui.submit();await until(()=>ui.app.state.modal===null,'password success');
 assert.equal(ui.commands().length,1);const command=ui.commands()[0];assert.equal(command.method,'PUT');assert.equal(command.credentials,'same-origin');assert.deepEqual(command.body,{current_password:original,password:next});assert.equal(command.url.search,'');
 assertEmpty(nodes);assert.equal(ui.query('form[data-form="owner-password"]'),null);assert.equal(ui.app.state.bootstrap.session.role,'owner');assert.equal(ui.app.state.team,'team-a');assert.match(ui.query('#toast').textContent,/Owner password changed/);assert.match(ui.query('#toast').textContent,/other owner sessions/);
 const visible=ui.dom.window.document.body.innerHTML+JSON.stringify(ui.app.state)+JSON.stringify(ui.dom.window.history.state)+ui.storage();assert.equal(visible.includes(original),false);assert.equal(visible.includes(next),false);
 assert.equal(ui.calls.some(call=>/accounts\/.+\/(disconnect|authorize)|owner\/(initialize|login|logout)/.test(call.path)),false);
}));

for(const [label,values,pattern] of [
 ['missing current',{current_password:''},/Enter your current password/],['short new',{password:'too short',confirm_password:'too short'},/16 and 300/],['long new',{password:'x'.repeat(301),confirm_password:'x'.repeat(301)},/16 and 300/],['mismatch',{confirm_password:'different synthetic password'},/do not match/],['missing confirmation',{confirm_password:''},/do not match/],
])uiTest(`${label} is rejected accessibly without HTTP or retained password fields`,()=>withUI({},async ui=>{
 await ui.open();ui.fillAll(values);const nodes=ui.fields();await ui.submit();assert.equal(ui.commands().length,0);const error=ui.query('#owner-password-error');assert.match(error.textContent,pattern);assert.equal(error.getAttribute('role'),'alert');assert.equal(ui.dom.window.document.activeElement,error);assert.ok(nodes.some(node=>node.getAttribute('aria-invalid')==='true'));assertEmpty(nodes);assert.equal(ui.app.state.editorDirty,false);
}));

uiTest('a failed current password stays in the form and supports a clean retry',()=>withUI({resolve:call=>call.path==='/api/owner/password'&&call.body.current_password===original?failure('password_incorrect',401,original+next):undefined},async ui=>{
 await ui.open();ui.fillAll();await ui.submit();await until(()=>ui.query('#owner-password-error')?.textContent,'incorrect password');assert.match(ui.query('#owner-password-error').textContent,/current password is incorrect/);assert.equal(ui.app.state.bootstrap.session.role,'owner');assertEmpty(ui.fields());assert.equal(ui.query('button[type="submit"]').disabled,false);
 ui.fillAll({current_password:'synthetic corrected current password'});await ui.submit();await until(()=>ui.app.state.modal===null,'retry success');assert.equal(ui.commands().length,2);assert.match(ui.query('#toast').textContent,/Owner password changed/);
}));

for(const [code,status,pattern] of [['rate_limited',429,/Too many password attempts/],['password_invalid',400,/16 and 300/],['installation_maintenance',503,/being updated/],['unknown',500,/could not be confirmed.*may have completed/i]])uiTest(`${code} has a safe local recovery message without echoing server text`,()=>withUI({resolve:call=>call.path==='/api/owner/password'?failure(code,status,original+next):undefined},async ui=>{
 await ui.open();ui.fillAll();await ui.submit();await until(()=>ui.query('#owner-password-error')?.textContent,'server failure');assert.match(ui.query('#owner-password-error').textContent,pattern);assert.equal(ui.dom.window.document.body.textContent.includes(original),false);assert.equal(ui.dom.window.document.body.textContent.includes(next),false);assert.equal(ui.app.state.bootstrap.session.role,'owner');assertEmpty(ui.fields());
}));

for(const code of ['sign_in_required','password_changed'])uiTest(`${code} uses ordinary sign-in recovery and removes the form`,()=>withUI({resolve:call=>call.path==='/api/owner/password'?failure(code,code==='password_changed'?409:401,original+next):undefined},async ui=>{
 await ui.open();ui.fillAll();const nodes=ui.fields();await ui.submit();await until(()=>ui.app.state.bootstrap.session.role==='anonymous','expired owner session');assertEmpty(nodes);assert.equal(ui.query('form[data-form="owner-password"]'),null);assert.equal(ui.app.state.modal,null);assert.equal(ui.query('#loginScreen').classList.contains('hidden'),false);assert.doesNotMatch(ui.query('#loginText').textContent,/synthetic/);
}));

const dismiss={
 Cancel:ui=>ui.click('[data-action="owner-password-cancel"]'),
 Close:ui=>ui.click('[data-close="accountModal"]'),
 Escape:async ui=>{ui.query('[name="current_password"]').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();},
 Back:ui=>ui.app.action('back'),
 detail:ui=>ui.app.action('close-detail'),
 team:ui=>ui.app.action('team-select',{value:'team-b'}),
 season:ui=>ui.app.action('season-select',{value:'team-a-2025'}),
 replacement:ui=>ui.app.action('settings'),
 navigation:ui=>ui.app.action('nav',{view:'overview'}),
 history:async ui=>{const route=structuredClone(ui.dom.window.history.state.route);ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route}}));await tick();},
 logout:ui=>ui.app.action('sign-out'),
 pagehide:async ui=>{ui.dom.window.dispatchEvent(new ui.dom.window.PageTransitionEvent('pagehide',{persisted:true}));await tick();},
 stop:async ui=>{ui.app.stop();},
};
for(const [name,leave] of Object.entries(dismiss))uiTest(`${name} scrubs both live and detached password fields through the real app lifecycle`,()=>withUI({},async ui=>{
 await ui.open();ui.fillAll();const nodes=ui.fields();await leave(ui);assertEmpty(nodes);assert.equal(ui.query('form[data-form="owner-password"]'),null);assert.equal(ui.commands().length,0);assert.equal(ui.storage().includes(original),false);assert.equal(ui.storage().includes(next),false);
}));

for(const [name,leave] of Object.entries(dismiss))for(const result of ['success','failure'])uiTest(`late ${result} after ${name} cannot reopen, navigate, log out or overwrite another draft`,async()=>{
 const gate=deferred();await withUI({resolve:call=>call.path==='/api/owner/password'?gate.promise:undefined},async ui=>{
  await ui.open();ui.fillAll();const nodes=ui.fields();await ui.submit();await until(()=>ui.commands().length===1,'pending password request');assertEmpty(nodes);assert.equal(ui.query('form[data-form="owner-password"]').getAttribute('aria-busy'),'true');
  await leave(ui);ui.app.state.editorDirty=true;const before={modal:ui.app.state.modal,team:ui.app.state.team,season:ui.app.state.season,role:ui.app.state.bootstrap.session.role,html:ui.query('#accountBody').innerHTML,toast:ui.query('#toast').textContent};
  gate.resolve(result==='success'?rotated():failure('sign_in_required',401,'STALE SECRET FAILURE'));await tick();await tick();
  assert.equal(ui.app.state.modal,before.modal);assert.equal(ui.app.state.team,before.team);assert.equal(ui.app.state.season,before.season);assert.equal(ui.app.state.bootstrap.session.role,before.role);assert.equal(ui.query('#accountBody').innerHTML,before.html);assert.equal(ui.query('#toast').textContent,before.toast);assert.equal(ui.app.state.editorDirty,true);assertEmpty(nodes);
 });
});

uiTest('repeated submit cannot issue two rotations or re-enable the form while the first is running',async()=>{
 const gate=deferred();await withUI({resolve:call=>call.path==='/api/owner/password'?gate.promise:undefined},async ui=>{
  await ui.open();ui.fillAll();await ui.submit();const form=ui.query('form[data-form="owner-password"]');assert.equal(form.querySelector('button[type="submit"]').disabled,true);await ui.submit();assert.equal(ui.commands().length,1);assert.equal(form.querySelector('button[type="submit"]').disabled,true);
  gate.resolve(rotated());await until(()=>ui.app.state.modal===null,'single rotation');assert.equal(ui.commands().length,1);
 });
});

uiTest('a stale rotation cannot settle or clear a newly reopened password form',async()=>{
 const gate=deferred();await withUI({resolve:call=>call.path==='/api/owner/password'?gate.promise:undefined},async ui=>{
  await ui.open();ui.fillAll();await ui.submit();await ui.click('[data-action="owner-password-cancel"]');await ui.open();ui.fillAll({password:'new synthetic draft password',confirm_password:'new synthetic draft password'});const form=ui.query('form[data-form="owner-password"]');
  gate.resolve(rotated());await tick();await tick();assert.equal(ui.query('form[data-form="owner-password"]'),form);assert.equal(form.querySelector('[name="password"]').value,'new synthetic draft password');assert.equal(form.getAttribute('aria-busy'),null);assert.equal(form.querySelector('button[type="submit"]').disabled,false);assert.doesNotMatch(ui.query('#toast').textContent,/password changed/);
 });
});

uiTest('all theme rerenders keep one owner password entry',()=>withUI({},async ui=>{
 await ui.app.action('settings');for(const theme of ['dark','soccer','light']){await ui.app.action('theme-cycle');assert.equal(ui.app.state.theme,theme);assert.equal(ui.dom.window.document.querySelectorAll('[data-action="owner-password"]').length,1);}
}));

uiTest('late no-team Settings cannot append a password entry to a replacement modal',async()=>{
 const gate=deferred();await withUI({teams:[],resolve:call=>call.path==='/api/accounts'?gate.promise:undefined},async ui=>{
  const pending=ui.app.action('settings');await tick();ui.app.openModal({title:'New screen',kind:'replacement',html:'<p>Current content</p>'});gate.resolve(response({accounts:[]}));await pending;assert.equal(ui.app.state.modal.kind,'replacement');assert.equal(ui.query('#accountBody').textContent,'Current content');assert.equal(ui.query('[data-owner-security]'),null);
 });
});

uiTest('no-team repeated Settings responses keep only the winning security entry',async()=>{
 const old=deferred(),fresh=deferred();let calls=0;await withUI({teams:[],resolve:call=>call.path==='/api/accounts'?(++calls===1?old.promise:fresh.promise):undefined},async ui=>{
  const first=ui.app.action('settings');await tick();const second=ui.app.action('settings');await tick();fresh.resolve(response({accounts:[]}));await second;old.resolve(response({accounts:[]}));await first;assert.equal(ui.app.state.modal.kind,'settings');assert.equal(ui.dom.window.document.querySelectorAll('[data-owner-security]').length,1);
 });
});

uiTest('closing and browser history restoration never restore typed password values',()=>withUI({},async ui=>{
 await ui.open();ui.fillAll();await ui.app.action('back');const route=structuredClone(ui.dom.window.history.state.route);ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route}}));await tick();assert.equal(ui.query('form[data-form="owner-password"]'),null);await ui.open();assertEmpty(ui.fields());assert.equal(JSON.stringify(ui.dom.window.history.state).includes(next),false);
}));

for(const kind of ['network','invalid-json','unexpected-success'])uiTest(`${kind} never claims success when rotation cannot be confirmed`,()=>withUI({resolve:call=>{if(call.path!=='/api/owner/password')return;if(kind==='network')throw new Error(original+next);if(kind==='invalid-json')return new Response('not JSON',{status:200});return {ok:false};}},async ui=>{
 await ui.open();ui.fillAll();await ui.submit();await until(()=>ui.query('#owner-password-error')?.textContent,'uncertain result');assert.match(ui.query('#owner-password-error').textContent,/could not be confirmed.*may have completed/i);assertEmpty(ui.fields());assert.equal(ui.app.state.modal.kind,'owner-password');assert.doesNotMatch(ui.query('#toast').textContent,/password changed/);assert.equal(ui.dom.window.document.body.textContent.includes(next),false);assert.equal(ui.commands().length,1);
}));

uiTest('a same-context background repaint does not strand a submitted password form',async()=>{
 const gate=deferred();await withUI({resolve:call=>call.path==='/api/owner/password'?gate.promise:undefined},async ui=>{
  await ui.open();ui.fillAll();await ui.submit();await ui.app.renderView();assert.equal(ui.app.state.modal.kind,'owner-password');gate.resolve(rotated());await until(()=>ui.app.state.modal===null,'rotation after background repaint');assert.match(ui.query('#toast').textContent,/password changed/);
 });
});

uiTest('submitted FormData is scrubbed immediately, including a failed client-side validation',()=>withUI({},async ui=>{
 await ui.open();ui.fillAll({confirm_password:'mismatched synthetic password'});let data;const handler=ui.bridge.handlers.forms['owner-password'];ui.bridge.handlers.forms['owner-password']=(submitted,...args)=>{data=submitted;return handler(submitted,...args);};await ui.submit();assert.equal([...data].length,0);assertEmpty(ui.fields());assert.equal(ui.commands().length,0);
}));

uiTest('no-team theme changes retain exactly one reachable password entry',()=>withUI({teams:[]},async ui=>{
 await ui.app.action('settings');for(const theme of ['dark','soccer','light']){await ui.app.action('theme-cycle');assert.equal(ui.app.state.theme,theme);assert.equal(ui.dom.window.document.querySelectorAll('[data-action="owner-password"]').length,1);}
 await ui.click('[data-action="owner-password"]');assert.equal(ui.app.state.modal.kind,'owner-password');
}));

uiTest('a declined existing-draft discard does not open password change or discard that draft',()=>withUI({},async ui=>{
 ui.app.openModal({title:'Existing draft',kind:'editor',html:'<p>Existing content</p>'});ui.app.state.editorDirty=true;const pending=ui.app.action('owner-password');await tick();assert.equal(ui.query('#confirmModal').classList.contains('hidden'),false);await ui.app.action('discard-cancel');await pending;assert.equal(ui.app.state.modal.kind,'editor');assert.equal(ui.query('#accountBody').textContent,'Existing content');assert.equal(ui.app.state.editorDirty,true);assert.equal(ui.query('form[data-form="owner-password"]'),null);
}));
