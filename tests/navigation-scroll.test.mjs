import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApp} from '../web/app/main.js';
const require=createRequire(import.meta.url);let domModule;
try{domModule=require(process.env.MYTS_JSDOM_MODULE||'jsdom');}catch(error){if(process.env.MYTS_JSDOM_MODULE)throw error;}
const uiTest=(name,run)=>test(name,{concurrency:false,skip:domModule?false:'Set MYTS_JSDOM_MODULE for actual-main scroll ownership checks.'},run);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail('UI did not settle');};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{resolve,promise};};
const team=id=>({id,name:id,timezone:'UTC',seasons:[2026,2025].map(year=>({id:id+'-'+year,year,label:String(year),start_day:year+'-06-01',end_day:(year+1)+'-06-01'}))});
async function withUI(run,{width=1280}={}){
 const {JSDOM,VirtualConsole}=domModule,errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error));
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://myts.example/admin',pretendToBeVisual:true,virtualConsole:vc}),saved=new Map();
 for(const key of ['window','document','location','history','FormData','AbortController','AbortSignal','HTMLElement','Element','Node','Event','MouseEvent','CustomEvent']){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true});}
 let y=0;const scrolls=[],calls=[],teams=[team('a'),team('b')];let hold=null;
 Object.defineProperty(dom.window,'scrollY',{get:()=>y,configurable:true});Object.defineProperty(dom.window,'innerWidth',{value:width,configurable:true});
 dom.window.scrollTo=(x,next)=>{y=Number(typeof x==='object'?x.top:next)||0;scrolls.push(y);};dom.window.history.scrollRestoration='auto';dom.window.matchMedia=()=>({matches:width<700,addEventListener(){},removeEventListener(){}});
 const scroll=next=>{dom.window.scrollTo(0,next);dom.window.dispatchEvent(new dom.window.Event('scroll'));};
 const fetcher=async path=>{const url=new URL(path,dom.window.location.origin);calls.push(url);const gate=hold?.(url);if(gate)await gate;
 let data;if(url.pathname==='/api/bootstrap')data={setup:{state:'ready',owner_ready:true},session:{role:'owner'},teams,preferences:{theme:'light'}};
 else if(url.pathname==='/api/teams'){const selected=teams.find(t=>t.id===url.searchParams.get('preferred_team_id'));data={items:teams,total:2,revision:1,preferred_team:selected};}
 else if(/^\/api\/teams\/.+\/seasons$/.test(url.pathname)){const row=teams.find(t=>t.id===url.pathname.split('/')[3]);data={items:row.seasons,total:2,revision:1,preferred_season:row.seasons.find(s=>s.id===url.searchParams.get('preferred_season_id'))};}
 else if(url.pathname==='/api/revisions')data={revision:1};else if(url.pathname==='/api/calendar')data={data:{days:[]}};else data={data:{items:[{id:url.searchParams.get('cursor')?'second':'first'}],total:2,next_cursor:'next'}};
 return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 };
 const app=createApp({fetcher,routes:{team:'/api/team',reports:'/api/reports'},handlers:{present:{team:()=>'<p>Team</p>',reports:()=>'<p>Reports</p>',schedule:()=>'<p>Schedule</p>'},openDetail:async(detail,api)=>api.setDetail({title:detail.id,bodyHTML:'<p>Detail '+detail.id+'</p>',can_back:api.state.details.length>1})}});
 const detailScroll=next=>{const body=dom.window.document.querySelector('#entityBody');body.scrollTop=next;body.dispatchEvent(new dom.window.Event('scroll'));};
 try{await app.start();await run({app,dom,calls,scrolls,scroll,detailScroll,get y(){return y;},get body(){return dom.window.document.querySelector('#entityBody');},hold:fn=>hold=fn,async pop(route){dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route}}));await wait(()=>app.state.team===route.team&&app.state.season===route.season&&app.state.view===route.view&&dom.window.document.querySelector('#root').getAttribute('aria-busy')===null);await tick();}});}
 finally{app.stop();assert.equal(dom.window.history.scrollRestoration,'auto');dom.window.close();for(const [key,value]of saved)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];assert.deepEqual(errors,[]);}
}
for(const width of [390,1280])uiTest(`primary views own window scroll on ${width}px layout, not root.scrollTop`,()=>withUI(async ui=>{
 await ui.app.action('nav',{view:'schedule'});ui.scroll(1200);ui.dom.window.document.querySelector('#root').scrollTop=9;
 await ui.app.action('more',{cursor:'next'});assert.equal(ui.y,1200);
 await ui.app.action('nav',{view:'team'});assert.equal(ui.y,0);ui.scroll(240);
 await ui.app.action('nav',{view:'schedule'});assert.equal(ui.y,1200);await ui.app.action('nav',{view:'team'});assert.equal(ui.y,240);
 await ui.app.action('nav',{view:'schedule',period:'past'});assert.equal(ui.y,0);assert.equal(ui.dom.window.history.state.route.scroll,0);
},{width}));
uiTest('team and season destinations have independent remembered positions',()=>withUI(async ui=>{
 await ui.app.action('nav',{view:'team'});ui.scroll(410);await ui.app.action('season-select',{value:'a-2025'});assert.equal(ui.y,0);ui.scroll(205);
 await ui.app.action('season-select',{value:'a-2026'});assert.equal(ui.y,410);await ui.app.action('team-select',{value:'b'});assert.equal(ui.y,0);ui.scroll(90);
 await ui.app.action('team-select',{value:'a'});assert.equal(ui.y,410);await ui.app.action('season-select',{value:'a-2025'});assert.equal(ui.y,205);
}));
uiTest('More and background repaint preserve scroll at response time, not request time',()=>withUI(async ui=>{
 await ui.app.action('nav',{view:'schedule'});ui.scroll(500);let gate=deferred();ui.hold(url=>url.pathname==='/api/schedule'?gate.promise:null);
 const more=ui.app.action('more',{cursor:'next'});await tick();ui.scroll(850);gate.resolve();await more;assert.equal(ui.y,850);
 gate=deferred();const refresh=ui.app.renderView();await tick();ui.scroll(940);gate.resolve();await refresh;assert.equal(ui.y,940);
}));
uiTest('late old route response cannot restore old scroll over a new navigation',()=>withUI(async ui=>{
 await ui.app.action('nav',{view:'schedule'});ui.scroll(500);const gate=deferred();ui.hold(url=>url.pathname==='/api/schedule'?gate.promise:null);
 const more=ui.app.action('more',{cursor:'next'});await tick();await ui.app.action('nav',{view:'team'});ui.scroll(80);gate.resolve();await more;
 assert.equal(ui.app.state.view,'team');assert.equal(ui.y,80);assert.equal(ui.dom.window.history.state.route.view,'team');
}));
uiTest('history entries store outgoing window offsets and Back/Forward restores exact entries',()=>withUI(async ui=>{
 await ui.app.action('nav',{view:'schedule'});ui.scroll(700);await new Promise(resolve=>setTimeout(resolve,150));const schedule=structuredClone(ui.dom.window.history.state.route);
 await ui.app.action('nav',{view:'team'});ui.scroll(140);await new Promise(resolve=>setTimeout(resolve,150));const roster=structuredClone(ui.dom.window.history.state.route);
 assert.equal(schedule.scroll,700);assert.equal(roster.scroll,140);assert.equal(ui.dom.window.history.scrollRestoration,'manual');
 await ui.pop(schedule);assert.equal(ui.y,700);await ui.pop(roster);assert.equal(ui.y,140);
}));
uiTest('nested detail scroll is independent and closing restores the page origin',()=>withUI(async ui=>{
 await ui.app.action('nav',{view:'schedule'});ui.scroll(600);await ui.app.action('match',{id:'one'});assert.equal(ui.body.scrollTop,0);assert.equal(ui.y,600);ui.detailScroll(270);
 await ui.app.action('player',{id:'two'});assert.equal(ui.body.scrollTop,0);ui.detailScroll(100);await ui.app.action('back');assert.equal(ui.body.scrollTop,270);assert.equal(ui.y,600);
 await ui.app.action('close-detail');assert.equal(ui.y,600);assert.equal(ui.app.state.details.length,0);
}));
uiTest('cross-season detail close and history retain their original page scope and offset',()=>withUI(async ui=>{
 await ui.app.action('nav',{view:'schedule'});ui.scroll(620);await ui.app.action('match',{id:'old',team_season_id:'a-2025'});assert.equal(ui.app.state.season,'a-2025');ui.detailScroll(160);
 await new Promise(resolve=>setTimeout(resolve,150));const detail=structuredClone(ui.dom.window.history.state.route);await ui.app.action('close-detail');assert.equal(ui.app.state.season,'a-2026');assert.equal(ui.y,620);
 await ui.pop(detail);assert.equal(ui.app.state.season,'a-2025');assert.equal(ui.body.scrollTop,160);await ui.app.action('close-detail');assert.equal(ui.app.state.season,'a-2026');assert.equal(ui.y,620);
}));

uiTest('continuous scroll coalesces history writes and navigation flushes the final offset',()=>withUI(async ui=>{
 let writes=0;const replace=ui.dom.window.history.replaceState.bind(ui.dom.window.history);ui.dom.window.history.replaceState=(...args)=>{writes++;return replace(...args);};
 for(let i=0;i<200;i++)ui.scroll(i);assert.equal(writes,0);await new Promise(resolve=>setTimeout(resolve,150));assert.equal(writes,1);assert.equal(ui.dom.window.history.state.route.scroll,199);
 ui.scroll(321);await ui.app.action('nav',{view:'team'});await ui.app.action('nav',{view:'overview'});assert.equal(ui.y,321);
}));
uiTest('scroll during delayed Back context read cannot overwrite the selected history entry',()=>withUI(async ui=>{
 ui.scroll(450);const target={team:'b',season:'b-2025',view:'team',filters:{...ui.app.state.filters},scroll:88,details:[]};
 ui.app.state.bootstrap.teams.find(team=>team.id==='b').seasons=[];const gate=deferred();ui.hold(url=>url.pathname==='/api/teams/b/seasons'?gate.promise:null);
 ui.dom.window.history.replaceState({mytsUi:true,route:target},'');ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route:target}}));await tick();ui.scroll(999);await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(ui.dom.window.history.state.route.team,'b');assert.equal(ui.dom.window.history.state.route.scroll,88);gate.resolve();await wait(()=>ui.app.state.team==='b'&&ui.app.state.season==='b-2025'&&ui.y===88);
}));

for(const accept of [false,true])uiTest(`Back confirmation fences scroll and pending history flush before ${accept?'discard':'keep'} editing`,()=>withUI(async ui=>{
 await ui.app.action('nav',{view:'team'});ui.scroll(480);ui.app.state.editorDirty=true;
 const target={team:'a',season:'a-2026',view:'overview',filters:{...ui.app.state.filters},scroll:75,details:[]};
 ui.dom.window.history.replaceState({mytsUi:true,route:target},'');ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent('popstate',{state:{mytsUi:true,route:target}}));
 await wait(()=>!ui.dom.window.document.querySelector('#confirmModal').classList.contains('hidden'));ui.scroll(550);await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(ui.dom.window.history.state.route.view,'overview');assert.equal(ui.dom.window.history.state.route.scroll,75);
 await ui.app.action(accept?'discard-confirm':'discard-cancel');await tick();if(accept){await wait(()=>ui.app.state.view==='overview'&&ui.y===75);}else{assert.equal(ui.app.state.view,'team');assert.equal(ui.y,550);assert.equal(ui.dom.window.history.state.route.view,'team');}
}));
