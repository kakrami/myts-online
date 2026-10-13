import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../web/app/main.js';
import {createFeatureBridge} from '../web/app/features.js';
import {createReportsController} from '../web/app/reports.js';
import {REPORT_COLUMNS} from '../src/reporting/service.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.MYTS_JSDOM_MODULE||'jsdom'));}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const uiTest=(name,run)=>test(name,{skip:JSDOM?false:'Set MYTS_JSDOM_MODULE to run the actual-main report suite.'},run),tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let i=0;i<60&&!check();i++)await tick();assert.ok(check(),'UI did not reach expected state');}
async function fixture(total,run){
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://myts.example/admin',pretendToBeVisual:true}),saved=new Map();
 for(const key of ['window','document','location','history','FormData','AbortController','AbortSignal','HTMLElement','Element','Node','Event','MouseEvent','CustomEvent']){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true});}
 dom.window.scrollTo=()=>{};dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 const teams=['t','other'].map(id=>({id,name:id,timezone:'UTC',seasons:[{id:id+'-s',year:2026,label:'2026',start_day:'2026-06-01',end_day:'2027-06-01'},{id:id+'-old',year:2025,label:'2025',start_day:'2025-06-01',end_day:'2026-06-01'}]})),calls=[],snapshots=new Map(),held=[];let holdNext=false;
 const source=Array.from({length:total},(_,i)=>({date:'2026-07-01',type:'Practice',location:'Field Q'+(total-1-i)+'Z',player:'Player '+i,_report_id:String(i)}));
 const report=(id,cursor)=>{const snapshot=snapshots.get(id),offset=Number(cursor||0);return {data:{type:snapshot.type,state:'ready',snapshot_id:id,scope_label:'Test '+snapshot.team_id+'/'+snapshot.team_season_id,scope_note:'All immutable rows',season_label:'2026',columns:REPORT_COLUMNS[snapshot.type],sort:{key:snapshot.sort||null,direction:snapshot.direction},rows:{items:snapshot.rows.slice(offset,offset+50),total,next_cursor:offset+50<total?String(offset+50):null}}};};
 const fetcher=async(path,options={})=>{const url=new URL(path,dom.window.location.origin);calls.push(url.pathname+url.search);let data;
  if(url.pathname==='/api/bootstrap')data={setup:{state:'ready',owner_ready:true},session:{role:'owner'},teams,preferences:{theme:'light'}};
  else if(url.pathname==='/api/teams')data={items:teams,total:teams.length,revision:1,preferred_team:teams.find(t=>t.id===url.searchParams.get('preferred_team_id'))||teams[0]};
  else if(url.pathname.endsWith('/seasons')){const team=teams.find(t=>url.pathname.includes('/'+t.id+'/'));data={items:team.seasons,total:2,revision:1,preferred_season:team.seasons.find(s=>s.id===url.searchParams.get('preferred_season_id'))||team.seasons[0]};}
  else if(url.pathname==='/api/revisions')data={revision:{content:1,status:1}};
  else if(url.pathname==='/api/reports/snapshots'){const body=JSON.parse(options.body),id='snapshot-'+snapshots.size,rows=body.sort?[...source].sort((a,b)=>String(a[body.sort]).localeCompare(String(b[body.sort]),undefined,{numeric:true})*(body.direction==='desc'?-1:1)):[...source];snapshots.set(id,{...body,rows});data=report(id,null);}
  else if(url.pathname==='/api/reports'){data=url.searchParams.get('snapshot_id')?report(url.searchParams.get('snapshot_id'),url.searchParams.get('cursor')):{data:{needs_snapshot:true,rows:{items:[],total:0}}};if(holdNext&&url.searchParams.get('cursor')){holdNext=false;await new Promise(resolve=>held.push(resolve));}}
  else data={data:{items:[],total:0}};
  return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 };
 const controller=createReportsController(),app=createApp({...createFeatureBridge({reports:controller}),fetcher});
 const count=()=>document.querySelectorAll('#reportDetail tbody tr').length,locations=()=>[...document.querySelectorAll('#reportDetail tbody [data-label="Location"]')].map(n=>n.textContent),more=()=>document.querySelector('[data-action="more"]');
 try{const api=await app.start();await app.action('nav',{view:'reports'});await app.action('report-type',{value:'matches'});await until(()=>controller.state.snapshot&&count()===50);await run({app,api,controller,calls,snapshots,count,locations,more,hold:()=>{holdNext=true;},held});}
 finally{for(const release of held)release();app.stop();dom.window.close();for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];}
}

uiTest('actual main preserves all137loaded rows, cursor and sorted immutable window through status/content refresh',async()=>fixture(137,async({api,app,controller,count,locations,more,snapshots})=>{
 more().click();await until(()=>count()===100);const id=controller.state.snapshot;
 await api.refreshSavedState({revision:{content:2,status:2}});assert.equal(count(),100);assert.equal(api.state.model.data.rows.loaded,100);assert.equal(more().dataset.cursor,'100');assert.equal(controller.state.snapshot,id);
 more().click();await until(()=>count()===137);assert.equal(more(),null);await api.refreshSavedState({revision:{content:3,status:3}});assert.equal(count(),137);assert.equal(more(),null);assert.deepEqual(locations(),snapshots.get(id).rows.map(r=>r.location));
 await app.action('report-sort-column',{value:'location'});await until(()=>controller.state.snapshot!==id&&count()===50);const sorted=controller.state.snapshot;assert.equal(locations()[0],'Field Q0Z');more().click();await until(()=>count()===100);await api.refreshSavedState({revision:{content:4,status:4}});more().click();await until(()=>count()===137);assert.deepEqual(locations(),snapshots.get(sorted).rows.map(r=>r.location));
 await app.action('report-sort-reverse',{key:'location'});await until(()=>controller.state.snapshot!==sorted&&count()===50);assert.equal(locations()[0],'Field Q136Z');assert.equal(controller.state.window.envelope.data.rows.items.length,50);
}));

uiTest('actual main caps a237row report window honestly and retains its end after refresh',async()=>fixture(237,async({api,controller,count,locations,more})=>{
 for(const expected of [100,150,200]){more().click();await until(()=>count()===expected);}
 more().click();await until(()=>api.state.model.data.rows.loaded===237);assert.equal(count(),200);assert.equal(locations()[0],'Field Q199Z');assert.equal(more(),null);assert.match(document.querySelector('#root').textContent,/Showing rows 38–237; downloads include all rows/);
 await api.refreshSavedState({revision:{content:20,status:20}});assert.equal(count(),200);assert.equal(api.state.model.data.rows.loaded,237);assert.equal(controller.state.window.envelope.data.rows.items.length,200);assert.equal(more(),null);assert.equal(locations()[0],'Field Q199Z');
 const id=controller.state.snapshot;document.querySelector('[data-action="report-first-page"]').click();await until(()=>count()===50);assert.equal(controller.state.snapshot,id);assert.equal(locations()[0],'Field Q236Z');assert.equal(document.querySelector('[data-action="report-first-page"]'),null);
 const visited=new Set(locations());while(more()){const loaded=api.state.model.data.rows.loaded??50;more().click();await until(()=>(api.state.model.data.rows.loaded??50)>loaded);for(const location of locations())visited.add(location);}assert.equal(visited.size,237);assert.equal(controller.state.snapshot,id);
}));

for(const action of ['sort','type','season','team','refresh'])uiTest(`actual main fences a late More after ${action}`,async()=>fixture(137,async({api,app,controller,count,locations,more,hold,held})=>{
 const before=controller.state.snapshot;hold();more().click();await until(()=>held.length===1);
 if(action==='sort')await app.action('report-sort-column',{value:'location'});
 if(action==='type')await app.action('report-type',{value:'players'});
 if(action==='season')await app.action('season-select',{value:'t-old'});
 if(action==='team')await app.action('team-select',{value:'other'});
 if(action==='refresh')await api.refreshSavedState({revision:{content:7,status:7}});
 await until(()=>count()===50&&(action==='refresh'||controller.state.snapshot!==before));const accepted=controller.state.snapshot,first=locations()[0];held.shift()();if(action==='refresh')await until(()=>count()===100);else for(let i=0;i<10;i++)await tick();assert.equal(count(),action==='refresh'?100:50);assert.equal(controller.state.snapshot,accepted);assert.equal(locations()[0],first);assert.equal(api.state.model.data.snapshot_id,accepted);
 if(action!=='refresh'){more().click();await until(()=>count()===100);}await api.refreshSavedState({revision:{content:8,status:8}});assert.equal(count(),100);
}));

uiTest('duplicate More clicks share one cursor and first-page restart fences a pending older window',async()=>fixture(337,async({api,controller,count,more,hold,held,calls,locations})=>{
 hold();more().click();more().click();await until(()=>held.length===1);assert.equal(calls.filter(path=>path.includes('cursor=50')).length,1);held.shift()();await until(()=>count()===100);assert.equal(api.state.model.data.rows.loaded,100);
 for(const loaded of [150,200,250]){more().click();await until(()=>api.state.model.data.rows.loaded===loaded);}
 const id=controller.state.snapshot;hold();more().click();await until(()=>held.length===1);document.querySelector('[data-action="report-first-page"]').click();await until(()=>count()===50);held.shift()();for(let i=0;i<10;i++)await tick();assert.equal(count(),50);assert.equal(controller.state.snapshot,id);assert.equal(locations()[0],'Field Q336Z');more().click();await until(()=>count()===100);assert.equal(api.state.model.data.rows.loaded,100);
}));
