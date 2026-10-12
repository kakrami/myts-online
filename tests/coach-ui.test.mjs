import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createCoachFeatures} from '../web/app/coach-features.js';
import {createDetailFeatures} from '../web/app/detail-features.js';
const require=createRequire(import.meta.url);
let domModule;
try{domModule=require(process.env.MYTS_JSDOM_MODULE||'jsdom');}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const uiTest=(name,run)=>test(name,{concurrency:false,skip:domModule?false:'Set MYTS_JSDOM_MODULE to run the real Coach DOM controller.'},run);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const session=(name='Original player',revision=1,phase='paused')=>({revision,phase,format:7,clock:{elapsed_ms:1000},roster:[{id:'p1',name,minutes:0}],active:['p1'],field:{GK:'p1'},minutes_total_ms:0,minutes_capacity_ms:0,minutes_recorded_total_ms:0});
const envelope=(name='Original player',revision=1,phase='paused')=>({data:{owner:true,event_id:'match-a',session:session(name,revision,phase)}});
async function withCoach(run){
 const dom=new domModule.JSDOM('<!doctype html><div id="entity"><div id="entityBody"><div class="entity-panel"></div></div></div>');
 const saved=new Map(),timers=new Map();let timerId=0;
 const install=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
 for(const key of ['window','document','AbortController'])install(key,key==='window'?dom.window:dom.window[key]);
 install('setInterval',callback=>{const id=++timerId;timers.set(id,callback);return id;});install('clearInterval',id=>timers.delete(id));
 const detail={kind:'match',id:'match-a',tab:'coach'},calls={reads:[],commands:[],notices:[],actions:[],closed:0},coach=createCoachFeatures();
 const f={dom,coach,calls,timers,read:async()=>envelope(),command:async()=>({session:session('Saved player',2)})};
 const api=f.api={state:{active:true,routeEpoch:1,team:'team-a',season:'season-a',details:[detail],modal:null,editorDirty:false,bootstrap:{session:{role:'owner'},teams:[{id:'team-a',seasons:[{id:'season-a',label:'2026–2027'}]}]}},host:dom.window.document,
  requireOwner(){if(api.state.bootstrap.session.role!=='owner')throw new Error('Owner required');},
  context(){return {team_id:api.state.team,team_season_id:api.state.season};},pathFor(path,params={}){return path+'?'+new URLSearchParams({...api.context(),...params});},
  transport:{async read(key,path){calls.reads.push({key,path});return {discarded:false,data:await f.read(key,path)};},async command(path,body,options){calls.commands.push({path,body,options});return {discarded:false,data:await f.command(path,body,options)};}},
  notice(message){calls.notices.push(message);},async action(name,data){calls.actions.push({name,data});},openModal(model){api.state.routeEpoch++;api.state.modal=model;},closeModal(){api.state.routeEpoch++;api.state.modal=null;calls.closed++;},
 };
 f.body=()=>api.host.querySelector('.entity-panel');f.form=entries=>{const form=new dom.window.FormData();for(const [key,value] of Object.entries(entries))form.set(key,value);return form;};
 f.load=async(name='match-a')=>{const html=await coach.panel(name,api);if(html!==null){f.body().innerHTML=html;coach.bind(api);}return html;};
 f.interrupt=kind=>{if(kind==='detail')api.state.details=[{kind:'match',id:'match-b',tab:'coach'}];else if(kind==='same-id-detail')api.state.details=[{...detail}];else if(kind==='cleanup')coach.cleanup(api);else if(kind==='logout')api.state.bootstrap.session.role='anonymous';else if(kind==='team')api.state.team='team-b';else if(kind==='season')api.state.season='season-b';else if(kind==='inactive')api.state.active=false;else if(kind==='modal')api.openModal({kind:'new-editor'});api.state.editorDirty=true;};
 try{await run(f);}finally{coach.cleanup(api);dom.window.close();for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];}
}

for(const change of ['detail','same-id-detail','cleanup','logout','team','season','inactive','modal'])uiTest(`late Coach command cannot repaint or clear a newer draft after ${change}`,async()=>withCoach(async f=>{
 await f.load();const gate=deferred();f.command=()=>gate.promise;f.api.state.editorDirty=true;
 const pending=f.coach.forms['coach-availability'](f.form({players:'p1'}),{revision:'1'},f.api);assert.equal(f.calls.commands.length,1);
 f.interrupt(change);f.body().innerHTML='<p>New screen content</p>';gate.resolve({session:session('STALE PRIVATE PLAYER',2)});await pending;
 assert.equal(f.body().textContent,'New screen content');assert.equal(f.api.state.editorDirty,true);assert.deepEqual(f.calls.notices,[]);
}));

for(const change of ['detail','cleanup','logout','team','season'])uiTest(`late Coach reload cannot replace another context after ${change}`,async()=>withCoach(async f=>{
 await f.load();const gate=deferred();f.read=()=>gate.promise;const pending=f.coach.actions['coach-reload']({},f.api);
 f.interrupt(change);f.body().innerHTML='<p>Current detail</p>';gate.resolve(envelope('STALE RELOAD PLAYER'));await pending;
 assert.equal(f.body().textContent,'Current detail');assert.equal(f.api.state.editorDirty,true);
}));

uiTest('a newer Coach request owns busy state when an older command settles',async()=>withCoach(async f=>{
 await f.load();const old=deferred(),next=deferred();f.command=()=>old.promise;const first=f.coach.actions['coach-command']({value:'pause'},f.api);
 f.coach.cleanup(f.api);f.api.state.details=[{kind:'match',id:'match-b',tab:'coach'}];f.read=async()=>envelope('Second detail');await f.load('match-b');
 f.command=()=>next.promise;const second=f.coach.actions['coach-command']({value:'resume'},f.api);old.resolve({session:session('OLD COMMAND')});await first;
 await f.coach.actions['coach-command']({value:'pause'},f.api);assert.equal(f.calls.commands.length,2);
 next.resolve({session:session('Current command')});await second;assert.match(f.body().textContent,/Current command/);assert.doesNotMatch(f.body().textContent,/OLD COMMAND/);
}));

uiTest('same-detail modal epochs preserve player selection and allow new Coach operations',async()=>withCoach(async f=>{
 await f.load();await f.coach.actions['coach-player']({id:'p1'},f.api);
 f.api.openModal({kind:'help'});f.api.closeModal();
 await f.coach.actions['coach-player']({slot:'CB'},f.api);assert.deepEqual(f.calls.commands[0].body.action,{type:'move',player:'p1',position:'CB'});
 assert.match(f.body().textContent,/Saved player/);
 f.api.openModal({kind:'help'});f.api.closeModal();f.read=async()=>envelope('Reload after modal',3);await f.coach.actions['coach-reload']({},f.api);assert.match(f.body().textContent,/Reload after modal/);
}));

uiTest('late substitution completion cannot close a replacement modal or clear its draft',async()=>withCoach(async f=>{
 await f.load();f.coach.actions['coach-late-correction']({},f.api);const gate=deferred();f.command=()=>gate.promise;
 const pending=f.coach.forms['coach-late-correction'](f.form({out:'p1',in:'p2',at_minutes:'1',duration:'2'}),{revision:'1'},f.api);
 f.api.openModal({kind:'replacement'});f.api.state.editorDirty=true;gate.resolve({session:session('STALE INTERVAL')});await pending;
 assert.equal(f.api.state.modal.kind,'replacement');assert.equal(f.api.state.editorDirty,true);assert.equal(f.calls.closed,0);
}));

uiTest('late substitution started in its current modal succeeds after the modal epoch change',async()=>withCoach(async f=>{
 await f.load();f.coach.actions['coach-late-correction']({},f.api);f.api.state.editorDirty=true;
 await f.coach.forms['coach-late-correction'](f.form({out:'p1',in:'p2',at_minutes:'1',duration:'2'}),{revision:'1'},f.api);
 assert.equal(f.calls.closed,1);assert.equal(f.api.state.editorDirty,false);assert.match(f.body().textContent,/Saved player/);
}));

for(const change of ['detail','cleanup','logout','team','season','inactive'])uiTest(`retained Coach timer callback cannot write after ${change}`,async()=>withCoach(async f=>{
 f.read=async()=>envelope('Clock player',1,'running');await f.load();const tick=[...f.timers.values()][0];assert.ok(tick);const clock=f.api.host.querySelector('[data-coach-clock]');
 f.interrupt(change);clock.textContent='Do not change';tick();assert.equal(clock.textContent,'Do not change');
}));

uiTest('Coach timer survives same-detail modal epochs but cannot write a replaced clock node',async()=>withCoach(async f=>{
 f.read=async()=>envelope('Clock player',1,'running');await f.load();const tick=[...f.timers.values()][0];f.api.openModal({kind:'help'});f.api.closeModal();
 f.api.host.querySelector('[data-coach-clock]').textContent='Refresh clock';tick();assert.equal(f.api.host.querySelector('[data-coach-clock]').textContent,'0:01');
 f.body().innerHTML='<strong data-coach-clock>New clock</strong>';tick();assert.equal(f.body().textContent,'New clock');
}));

for(const change of ['detail','cleanup','logout','team','season','modal'])uiTest(`late Coach profile save has no navigation or draft effects after ${change}`,async()=>withCoach(async f=>{
 f.api.state.details=[{kind:'player',id:'p1',tab:'overview'}];f.read=async()=>({data:{profiles:{p1:{revision:1,value:{}}}}});await f.coach.profile('p1',f.api);
 const gate=deferred();f.command=()=>gate.promise;f.api.state.editorDirty=true;const pending=f.coach.forms['coach-profile'](f.form({endurance:'3'}),{player:'p1',revision:'1'},f.api);
 f.interrupt(change);gate.resolve({ok:true});await pending;assert.equal(f.api.state.editorDirty,true);assert.deepEqual(f.calls.notices,[]);assert.deepEqual(f.calls.actions,[]);
}));

uiTest('late Coach profile lookup cannot install attributes in a newer player detail',async()=>withCoach(async f=>{
 f.api.state.details=[{kind:'player',id:'p1',tab:'overview'}];const old=deferred();f.read=()=>old.promise;const first=f.coach.profile('p1',f.api);
 f.api.state.details=[{kind:'player',id:'p2',tab:'overview'}];f.read=async()=>({data:{profiles:{p2:{revision:2,value:{}}}}});await f.coach.profile('p2',f.api);
 old.resolve({data:{profiles:{p1:{revision:1,value:{endurance:5}}}}});assert.equal(await first,null);
 await f.coach.forms['coach-profile'](f.form({endurance:'1'}),{player:'p1',revision:'1'},f.api);assert.equal(f.calls.commands.length,0);
 await f.coach.forms['coach-profile'](f.form({endurance:'2'}),{player:'p2',revision:'2'},f.api);assert.equal(f.calls.commands[0].body.player_id,'p2');
}));

uiTest('stale Coach failures are discarded while current failures still report normally',async()=>withCoach(async f=>{
 await f.load();const gate=deferred();f.command=()=>gate.promise;const pending=f.coach.actions['coach-command']({value:'pause'},f.api);f.coach.cleanup(f.api);gate.reject(new Error('Stale failure'));await assert.doesNotReject(pending);
 f.read=async()=>envelope();await f.load();f.command=async()=>{throw new Error('Current failure');};await assert.rejects(f.coach.actions['coach-command']({value:'pause'},f.api),/Current failure/);
}));

uiTest('late Coach profile conflict resolution cannot navigate a newer private detail',async()=>withCoach(async f=>{
 f.api.state.details=[{kind:'player',id:'p1',tab:'overview'}];f.read=async()=>({data:{profiles:{p1:{conflict:true,choices:[{source_player_id:'source-p1',source_revision:2,value:{}}]}}}});await f.coach.profile('p1',f.api);
 const gate=deferred();f.command=()=>gate.promise;f.api.state.editorDirty=true;const pending=f.coach.forms['coach-profile-resolve'](f.form({discard:'on',keep:'source-p1'}),{player:'p1'},f.api);
 f.coach.cleanup(f.api);f.api.state.details=[{kind:'player',id:'p2',tab:'overview'}];gate.resolve({ok:true});await pending;
 assert.equal(f.api.state.editorDirty,true);assert.deepEqual(f.calls.actions,[]);assert.deepEqual(f.calls.notices,[]);
}));

uiTest('late Coach reload failure cannot surface over a newer detail',async()=>withCoach(async f=>{
 await f.load();const gate=deferred();f.read=()=>gate.promise;const pending=f.coach.actions['coach-reload']({},f.api);f.interrupt('same-id-detail');f.body().innerHTML='<p>Current detail</p>';gate.reject(new Error('Old reload failed'));
 await assert.doesNotReject(pending);assert.equal(f.body().textContent,'Current detail');assert.deepEqual(f.calls.notices,[]);
}));


uiTest('the assembled detail controller invalidates the real Coach command before opening another match',async()=>withCoach(async f=>{
 f.api.hydrateModel=async model=>model;
 f.api.setDetail=model=>{f.api.host.querySelector('#entityBody').innerHTML=model.bodyHTML;};
 f.read=async(key,path)=>key==='coach'?envelope():{data:{event:{id:path.includes('match-b')?'match-b':'match-a',title:path.includes('match-b')?'Second match':'First match',status:'SCHEDULED',home:{id:'home',name:'Home'},away:{id:'away',name:'Away'}},capabilities:{can_coach:true}}};
 const detail=createDetailFeatures({coach:f.coach,lineup:{cleanup(){}}});await detail.openDetail(f.api.state.details[0],f.api);assert.match(f.body().textContent,/Original player/);
 const gate=deferred();f.command=()=>gate.promise;const pending=f.coach.actions['coach-command']({value:'pause'},f.api);
 const second={kind:'match',id:'match-b',tab:'overview'};f.api.state.details=[second];await detail.openDetail(second,f.api);const current=f.api.host.querySelector('#entityBody').innerHTML;
 gate.resolve({session:session('PRIVATE STALE COMMAND')});await pending;assert.equal(f.api.host.querySelector('#entityBody').innerHTML,current);assert.doesNotMatch(current,/PRIVATE STALE COMMAND/);
 detail.cleanup(f.api);
}));
