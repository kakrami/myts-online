import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createPublicHistoryController} from '../web/app/public-history.js';
const require=createRequire(import.meta.url);
let JSDOM;try{({JSDOM}=require(process.env.MYTS_JSDOM_MODULE||'jsdom'));}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const tick=()=>new Promise(r=>setImmediate(r));
const active={supported:true,state:'active',progress:{complete:0,total:4},next_check_ms:1500,can_refresh:false,note:'Checking public team history. Saved meetings remain available.'};
const complete={...active,state:'complete',can_refresh:true,progress:{complete:4,total:4},note:'The requested scans finished. Providers may not publish every historical meeting.'};
async function fixture(run){
 const dom=new JSDOM('<div id="entityBody"><div data-public-history></div><p data-saved>Saved meetings</p></div>'),calls=[],timers=new Map();let serial=0,current=true,command=async()=>active,read=async()=>complete,reloads=0,now=1000;
 const api={host:dom.window.document,state:{routeEpoch:1,modal:null,editorDirty:false,bootstrap:{session:{role:'viewer'}}},pathFor:p=>p+'?team_id=T&team_season_id=S',transport:{command:async(path,body)=>{calls.push({path,body});return {data:await command(),discarded:false};},read:async(key,path)=>{calls.push({key,path});return {data:await read(),discarded:false};}}};
 const controller=createPublicHistoryController({schedule:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id),now:()=>now});
 const f={api,controller,calls,timers,dom,start:()=>controller.start(api,{eventId:'anchor',current:()=>current,reload:async()=>{reloads++;return true;}}),setCommand:fn=>command=fn,setRead:fn=>read=fn,invalidate:()=>{current=false;},reloads:()=>reloads,advance:n=>{now+=n;},poll:async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();await tick();},text:()=>api.host.body.textContent};
 try{await run(f);}finally{controller.cleanup(api);dom.window.close();}
}
const ui=(name,run)=>test(name,{skip:JSDOM?false:'JSDOM required'},()=>fixture(run));
ui('viewer opens one finite exact-anchor request automatically and receives completed results',async f=>{
 f.start();await tick();assert.deepEqual(f.calls[0].body,{force:false});assert.match(f.calls[0].path,/matches\/anchor\/h2h\/refresh/);assert.equal(f.timers.size,1);assert.match(f.text(),/Saved meetings/);
 await f.poll();assert.equal(f.reloads(),1);assert.equal(f.timers.size,0);assert.match(f.text(),/may not publish every/);assert.doesNotMatch(f.text(),/History complete/);
 await f.controller.refresh(f.api);assert.deepEqual(f.calls.at(-1).body,{force:true});
});
ui('unsupported provider keeps saved results and exposes no dead Refresh action',async f=>{
 f.setCommand(async()=>({supported:false,state:'unsupported',note:'Verified public history is unavailable.'}));f.start();await tick();assert.equal(f.api.host.querySelector('[data-action=h2h-refresh]'),null);assert.equal(f.timers.size,0);assert.match(f.text(),/Saved meetings/);
});
for(const reason of ['close','newer detail','team change','session change'])ui(`late history reply cannot update after ${reason}`,async f=>{
 let resolve;f.setCommand(()=>new Promise(r=>{resolve=r;}));f.start();if(reason==='close')f.controller.cleanup(f.api);else f.invalidate();f.api.host.querySelector('[data-public-history]').textContent='New screen';resolve(active);await tick();assert.match(f.text(),/New screen/);assert.equal(f.timers.size,0);assert.equal(f.reloads(),0);
});
ui('failed poll keeps saved meetings and allows an explicit retry without an automatic retry loop',async f=>{
 f.start();await tick();f.setRead(async()=>{throw new Error('private internal URL');});await f.poll();assert.match(f.text(),/could not finish/);assert.doesNotMatch(f.text(),/private internal/);assert.equal(f.timers.size,0);assert.equal(f.api.host.querySelector('[data-action=h2h-refresh]').disabled,false);assert.match(f.text(),/Saved meetings/);
});
ui('completion behind a modal keeps focus and waits for explicit updated-results action',async f=>{
 f.start();await tick();const input=f.api.host.createElement('input');f.api.host.body.append(input);input.focus();f.api.state.modal={kind:'status'};await f.poll();assert.equal(f.reloads(),0);assert.equal(f.api.host.activeElement,input);assert.ok(f.api.host.querySelector('[data-action=h2h-show-updates]'));f.api.state.modal=null;await f.controller.showUpdates(f.api);assert.equal(f.reloads(),1);
});
ui('terminal cooldown becomes refreshable without starting another public scan',async f=>{
 f.setCommand(async()=>({...complete,can_refresh:false,cooldown_until:2000}));f.start();await tick();assert.equal(f.api.host.querySelector('[data-action=h2h-refresh]').disabled,true);assert.equal(f.calls.length,1);f.advance(1001);await f.poll();assert.equal(f.api.host.querySelector('[data-action=h2h-refresh]').disabled,false);assert.equal(f.calls.length,1);
});
