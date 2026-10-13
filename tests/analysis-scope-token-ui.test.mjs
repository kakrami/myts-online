import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {playerEditor} from '../web/ui-original/forms.js';
import {createDetailFeatures} from '../web/app/detail-features.js';
import {createLineupFeatures} from '../web/app/lineup-features.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.MYTS_JSDOM_MODULE||'jsdom'));}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const ui=(name,run)=>test(name,{concurrency:false,skip:JSDOM?false:'JSDOM required'},run),TOKEN='a'.repeat(64),NEW='b'.repeat(64);
function fixture(html=''){
 const dom=new JSDOM('<div id="entityBody"><div class="entity-panel">'+html+'</div></div><div id="accountBody"></div>'),calls=[];
 const api={host:dom.window.document,state:{active:true,routeEpoch:1,team:'team',season:'season',details:[{kind:'match',id:'match',tab:'overview'}],bootstrap:{session:{role:'owner'}},editorDirty:true,modal:null},requireOwner(){},pathFor:p=>p,transport:{read:async()=>({data:{revision:2,game_scope_revision:NEW,effective:{minutes:12}}}),command:async(path,body,options)=>{calls.push({path,body,options});return {discarded:true};}},notice(){},openModal(value){api.state.modal=value;api.host.querySelector('#accountBody').innerHTML=value.html;},closeModal(){api.state.modal=null;}};
 return {dom,api,calls,close:()=>dom.window.close()};
}
ui('rendered player correction and reset retain the exact opaque published-game token',async()=>{
 const f=fixture(playerEditor({event_id:'match',player_id:'player',revision:1,game_scope_revision:TOKEN,override:{minutes:0}}));try{
  const controller=createDetailFeatures({coach:{},lineup:{}}),form=f.api.host.querySelector('form');assert.equal(form.dataset.gameScopeRevision,TOKEN);
  await controller.forms['player-correction'](new f.dom.window.FormData(form),form.dataset,f.api);assert.equal(f.calls[0].body.game_scope_revision,TOKEN);assert.equal(f.calls[0].body.fields.minutes,0);
  const reset=form.querySelector('[data-action=correction-reset]');assert.equal(reset.dataset.gameScopeRevision,TOKEN);await controller.actions['correction-reset'](reset.dataset,f.api);const confirm=f.api.host.querySelector('#accountBody form');assert.equal(confirm.dataset.gameScopeRevision,TOKEN);await controller.forms['correction-reset'](null,confirm.dataset,f.api);assert.equal(f.calls[1].body.game_scope_revision,TOKEN);
 }finally{f.close();}
});
ui('reviewed correction revision adopts its matching scope token and keeps the draft values',async()=>{
 const f=fixture(playerEditor({event_id:'match',player_id:'player',revision:1,game_scope_revision:TOKEN,override:{minutes:0}}));try{
  const controller=createDetailFeatures({coach:{},lineup:{}}),form=f.api.host.querySelector('form');await controller.actions['editor-conflict-review']({},f.api);const adopt=form.querySelector('[data-action=editor-adopt-revision]');assert.equal(adopt.dataset.gameScopeRevision,NEW);assert.equal(form.dataset.gameScopeRevision,TOKEN);
  controller.actions['editor-adopt-revision'](adopt.dataset,f.api);assert.equal(form.dataset.revision,'2');assert.equal(form.dataset.gameScopeRevision,NEW);assert.equal(form.querySelector('[name=minutes]').value,'0');assert.equal(form.querySelector('[data-action=correction-reset]').dataset.gameScopeRevision,NEW);
 }finally{f.close();}
});
ui('event edit and reset submit the same published scope token',async()=>{
 const f=fixture();try{const controller=createDetailFeatures({coach:{},lineup:{}});await controller.actions['match-edit']({id:'match'},f.api);const form=f.api.host.querySelector('form');assert.equal(form.dataset.gameScopeRevision,NEW);await controller.forms['match-correction'](new f.dom.window.FormData(form),form.dataset,f.api);assert.equal(f.calls[0].body.game_scope_revision,NEW);await controller.actions['correction-reset'](form.querySelector('[data-action=correction-reset]').dataset,f.api);await controller.forms['correction-reset'](null,f.api.host.querySelector('form').dataset,f.api);assert.equal(f.calls[1].body.game_scope_revision,NEW);}finally{f.close();}
});
ui('lineup save and reset retain original token and reject changed-scope roster paging',async()=>{
 const f=fixture(),prior=globalThis.AbortController;globalThis.AbortController=f.dom.window.AbortController;const controller=createLineupFeatures();try{
  const model={revision:1,read_revision:1,game_scope_revision:TOKEN,format:7,owner_format:7,roster:[{id:'p',name:'Player'}],owner_assignments:[],layouts:{},roster_page:{next_cursor:'next'}};f.api.transport.read=async()=>({data:model});await controller.actions['lineup-edit']({id:'match'},f.api);
  controller.actions['lineup-player']({id:'p',slot:'bench'},f.api);controller.actions['lineup-player']({id:'',slot:'1'},f.api);await controller.actions['lineup-save']({},f.api);assert.equal(f.calls[0].body.game_scope_revision,TOKEN);
  f.api.transport.read=async()=>({data:{...model,game_scope_revision:NEW}});await assert.rejects(()=>controller.actions['lineup-roster-page']({cursor:'next'},f.api),/lineup changed/);assert.equal(f.api.state.editorDirty,true);
  controller.actions['lineup-reset']({},f.api);await controller.forms['lineup-reset'](null,f.api.host.querySelector('#accountBody form').dataset,f.api);assert.equal(f.calls[1].body.game_scope_revision,TOKEN);
 }finally{controller.cleanup(f.api);globalThis.AbortController=prior;f.close();}
});
ui('saved-only correction and lineup views expose no edit or save controls',async()=>{
 const f=fixture(playerEditor({event_id:'match',player_id:'player',state_only:true,can_edit:false,override:{minutes:0},reason:'Saved corrections preserved.'})),prior=globalThis.AbortController;globalThis.AbortController=f.dom.window.AbortController;const controller=createLineupFeatures();try{
  assert.equal(f.api.host.querySelector('form'),null);assert.match(f.api.host.querySelector('#playerEditor').textContent,/minutes0/);
  f.api.transport.read=async()=>({data:{can_edit:false,state_only:true,format:7,reason:'Saved lineup preserved.',owner_assignments:[{half:1,slot_kind:'field',slot:2,name:'Saved player',position:'LB'}]}});await controller.actions['lineup-edit']({id:'match'},f.api);assert.equal(f.api.state.modal.kind,'lineup-saved');assert.match(f.api.state.modal.html,/Saved player/);assert.doesNotMatch(f.api.state.modal.html,/lineup-save|lineup-reset|lineup-player/);assert.equal(f.calls.length,0);
 }finally{controller.cleanup(f.api);globalThis.AbortController=prior;f.close();}
});
