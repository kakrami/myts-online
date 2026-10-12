import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDetailFeatures} from '../web/app/detail-features.js';
const require=createRequire(import.meta.url);
let JSDOM;try{({JSDOM}=require(process.env.MYTS_JSDOM_MODULE||'jsdom'));}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const ui=(name,run)=>test(name,{concurrency:false,skip:JSDOM?false:'JSDOM required'},run);
const event=(id,season='history')=>({id,type:'game',status:'FINAL',local_day:'2024-07-20',home_name:'Home',away_name:'Away',app_team_id:'team',team_season_id:season});
const model=(extra={})=>({revision:{content:1},data:{event:event('current','season'),capabilities:{has_h2h:true},h2h:{range:'all',events:{items:[event('past')],next_cursor:'past2'},upcoming:{items:[event('next','season')],next_cursor:'next2'},record:{games:22,wins:10,draws:2,losses:10,goals_for:40,goals_against:41},history_complete:false,...extra}}});
async function fixture(run){
 const dom=new JSDOM('<div id="entityBody"></div>'),calls=[];let read=async()=>model();
 const detail={kind:'match',id:'current',tab:'h2h'},api={host:dom.window.document,state:{active:true,routeEpoch:1,team:'team',season:'season',details:[detail],bootstrap:{session:{role:'owner'},teams:[]}},pathFor:(p,q)=>p+'?'+new URLSearchParams(Object.entries(q).filter(([,v])=>v!=null)),hydrateModel:async v=>v,setDetail:v=>{api.host.querySelector('#entityBody').innerHTML=v.bodyHTML;},transport:{read:async(key,path)=>{calls.push({key,path});return {discarded:false,data:await read(key,path)};}},notice(){},requireOwner(){}};
 const controller=createDetailFeatures({coach:{cleanup(){}},lineup:{cleanup(){}}});
 try{await controller.openDetail(detail,api);await run({api,controller,calls,setRead:fn=>{read=fn;},body:()=>api.host.querySelector('#entityBody')});}finally{controller.cleanup(api);dom.window.close();}
}
ui('H2H shows original range controls, whole-range record and separate owned history/upcoming links',()=>fixture(async f=>{
 assert.match(f.body().textContent,/All seasons/);assert.match(f.body().textContent,/Upcoming meetings/);assert.match(f.body().textContent,/Past meetings/);assert.match(f.body().textContent,/22/);
 assert.equal(f.body().querySelector('[data-id="past"]').dataset.team_season_id,'history');
 assert.equal(f.body().querySelector('[data-id="next"]').dataset.team_season_id,'season');
 assert.ok(f.body().querySelector('[data-part="upcoming"]'));assert.match(f.body().textContent,/may not include all historical games/);
}));
ui('H2H range changes clear both page cursors and retain selected range',()=>fixture(async f=>{
 f.api.state.details[0].filters={h2h_cursor:'old',h2h_upcoming_cursor:'old-next'};f.setRead(async()=>model({range:'year'}));
 await f.controller.actions['h2h-range']({value:'year'},f.api);const url=new URL(f.calls.at(-1).path,'https://fixture.invalid');
 assert.equal(url.searchParams.get('h2h_range'),'year');assert.equal(url.searchParams.has('h2h_cursor'),false);assert.equal(url.searchParams.has('h2h_upcoming_cursor'),false);assert.match(f.body().textContent,/Last year/);
}));
for(const part of ['past','upcoming'])ui(`H2H ${part} pagination keeps the independent other section`,()=>fixture(async f=>{
 f.setRead(async()=>model({events:{items:[event('past-new')]},upcoming:{items:[event('next-new','season')]}}));
 await f.controller.more({tab:'h2h',part,cursor:'page-two'},f.api);const url=new URL(f.calls.at(-1).path,'https://fixture.invalid');
 assert.equal(url.searchParams.get(part==='past'?'h2h_cursor':'h2h_upcoming_cursor'),'page-two');
 assert.ok(f.body().querySelector('[data-id="past"]'));assert.ok(f.body().querySelector('[data-id="next"]'));
 assert.ok(f.body().querySelector(`[data-id="${part==='past'?'past-new':'next-new'}"]`));assert.equal(f.body().querySelector(`[data-id="${part==='past'?'next-new':'past-new'}"]`),null);
}));
for(const change of ['team','season','role','close','navigation'])ui(`late H2H page cannot replace ${change}`,()=>fixture(async f=>{
 let resolve;f.setRead(()=>new Promise(r=>{resolve=r;}));const pending=f.controller.more({tab:'h2h',part:'past',cursor:'next'},f.api);
 if(change==='close')f.controller.cleanup(f.api);else if(change==='role')f.api.state.bootstrap.session.role='anonymous';else if(change==='navigation')f.api.state.routeEpoch++;else f.api.state[change]='other';
 f.body().textContent='Current screen';resolve(model());await pending;assert.equal(f.body().textContent,'Current screen');
}));
ui('H2H changed content revision restarts instead of merging stale pages',()=>fixture(async f=>{
 let reads=0;f.setRead(async()=>{reads++;const result=model({events:{items:[event('fresh')],next_cursor:null}});result.revision.content=2;return result;});
 await f.controller.more({tab:'h2h',part:'past',cursor:'old'},f.api);assert.equal(reads,2);assert.equal(f.body().querySelector('[data-id="past"]'),null);assert.ok(f.body().querySelector('[data-id="fresh"]'));
}));
ui('public historical rows retain the verified original anchor without inventing a historical season',()=>fixture(async f=>{
 const publicEvent={...event('public-history'),team_season_id:undefined,app_team_id:undefined,historical_context:{anchor_event_id:'current',team_id:'team',team_season_id:'season'}};
 f.setRead(async()=>model({events:{items:[publicEvent],next_cursor:null}}));await f.controller.openDetail(f.api.state.details[0],f.api);
 const button=f.body().querySelector('[data-id="public-history"]');assert.equal(button.dataset.h2h_anchor,'current');assert.equal(button.dataset.team_season_id,'season');assert.equal(button.dataset.team_id,'team');
 const detail={kind:'match',id:'public-history',tab:'h2h',h2h_anchor:'current'};f.api.state.details=[detail];await f.controller.openDetail(detail,f.api);
 assert.equal(new URL(f.calls.at(-1).path,'https://fixture.invalid').searchParams.get('h2h_anchor'),'current');
 await f.controller.more({tab:'h2h',part:'past',cursor:'later'},f.api);assert.equal(new URL(f.calls.at(-1).path,'https://fixture.invalid').searchParams.get('h2h_anchor'),'current');
}));
