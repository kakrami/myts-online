import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {engineSource} from './parity/original-analysis-fixtures.js';
import {resolveSnapshot} from '../src/analysis/resolver-adapter.js';
import {traceNativeGame,traceRadar,traceProvider,gamePages,traceStorage} from './fixtures/trace-analysis-native.mjs';
const original=vm.runInNewContext(engineSource+';TraceEngine');
const data=part=>JSON.parse(part.value);
async function radarResult(game,radar,{teamId='400',legacy=false}={}){
 const p=traceProvider(game,radar),pages=await gamePages(p,{teamId}),job=pages.flatMap(v=>v.children).find(v=>v.kind==='radar');
 if(legacy)delete job.args.native_role_scope;
 const result=await p.collect('radar',job.args);return {p,pages,job,result,value:data(result.records.trace_parts[0])};
}
test('collector restores original sustained-population play window, not raw video/radar bounds',async()=>{
 const game=traceNativeGame(),radar=traceRadar(game,{trim:true}),r=await radarResult(game,radar),expected=original.detectPlayWindow(radar);
 assert.deepEqual(r.value.analysis.play_window,{...expected,complete:true});assert.ok(expected.start>0);assert.ok(expected.end<120);
 assert.equal(r.value.start,0);assert.equal(r.value.end,120);assert.equal(r.value.analysis.both_sides_verified,true);
 assert.equal(r.result.coverage[0].complete,true);assert.equal(r.value.analysis.track_roles.length,14);
 assert.equal(r.value.analysis.history_format_family,undefined);assert.equal(r.value.analysis.declared_format,undefined);assert.equal(r.value.analysis.display_orientation,undefined);
 assert.ok(Buffer.byteLength(JSON.stringify(r.job.args))<=8192);assert.ok(Buffer.byteLength(r.result.records.trace_parts[0].value)<=60000);
});
test('legacy jobs, numeric actors and invented analysis labels preserve unknown verification',async()=>{
 const game=traceNativeGame();
 for(const option of [{legacy:true},{numeric:true}]){
  const radar=traceRadar(game,option);radar.analysis={both_sides_verified:true,history_format_family:'7_or_9',display_orientation:'own_goal_left'};
  const r=await radarResult(game,radar,option);assert.equal(r.value.analysis.both_sides_verified,null);assert.ok(r.value.analysis.play_window);
  assert.equal(r.value.analysis.history_format_family,undefined);assert.equal(r.value.analysis.display_orientation,undefined);
  if(option.legacy)assert.deepEqual(r.value.analysis.track_roles,[]);
 }
 const spoof=traceNativeGame();spoof.team_members.forEach(m=>{delete m.team_id;m.position='goalkeeper';});
 const result=await radarResult(spoof,traceRadar(spoof));assert.equal(result.value.analysis.both_sides_verified,null);assert.deepEqual(result.value.analysis.track_roles,[]);
});
test('one unrecognized actor or missing opposing proof prevents both-sided population verification',async()=>{
 const game=traceNativeGame(),radar=traceRadar(game);radar.frm[50].a.ball={side:'away',role:'field'};
 assert.equal((await radarResult(game,radar)).value.analysis.both_sides_verified,null);
 game.team_members.find(m=>m.gid==='away-2').is_player=false;
 assert.equal((await radarResult(game,traceRadar(game))).value.analysis.both_sides_verified,null);
});
test('anonymous native keeper is collected without a person ID; opponent tracking is not fetched',async()=>{
 for(const teamId of ['400','401']){
  const game=traceNativeGame({anonymousKeeper:true}),p=traceProvider(game),pages=await gamePages(p,{teamId}),children=pages.flatMap(v=>v.children),side=teamId==='400'?'home':'away',tracks=children.filter(v=>v.kind==='tracking');
  assert.equal(tracks.length,14);assert.ok(tracks.every(v=>v.args.gid.startsWith(side+'-')));
  const keeper=tracks.find(v=>v.args.gid===side+'-goalkeeper');assert.ok(keeper.args.player_id.startsWith('track:'));
  const stored=await p.collect('tracking',keeper.args);assert.ok(data(stored.records.trace_parts[0]).player_id.startsWith('track:'));
  assert.equal(children.filter(v=>v.kind==='analytics'&&v.args.player_id==='team').length,6);
 }
});
test('full-half clocks select original Trace camera, preserve milliseconds, and reject missing or foreign clocks',async()=>{
 const game=traceNativeGame();game.moments.unshift({...game.moments[0],game_clip_id:999,camera:{name:'other'},start_time:5});
 const pages=await gamePages(traceProvider(game)),clip=data(pages[0].records.trace_parts.find(v=>v.part==='clip:1'));
 assert.equal(clip.game_clip_id,40011);assert.equal(clip.start,1_700_002_000_000);assert.equal(clip.duration,120);
 for(const change of [{start_time:null},{game_id:9000}]){const broken=traceNativeGame();Object.assign(broken.moments[0],change);await assert.rejects(()=>gamePages(traceProvider(broken)),/timing|another game/);}
});
test('malformed, reversed and zero-population radar never become complete analysis windows',async()=>{
 const game=traceNativeGame();
 for(const change of [r=>{r.frm[30].t=null;},r=>{r.frm[30].t=-1;},r=>{r.frm[30].t=1;},r=>{r.frm[30].a=[];}]){const radar=traceRadar(game);change(radar);await assert.rejects(()=>radarResult(game,radar),/radar frame/);}
 const radar=traceRadar(game);radar.frm.forEach(f=>f.a={});const r=await radarResult(game,radar);assert.equal(r.value.analysis.play_window,null);assert.equal(r.value.analysis.both_sides_verified,null);
});
test('oversized native role proof stays unknown and does not break child pagination or 8 KiB arguments',async()=>{
 const game=traceNativeGame();game.team_members.push(...Array.from({length:140},(_,i)=>({...game.team_members[1],gid:'home-'+(i+50),user_id:5000+i,user:{user_id:5000+i,first_name:'Synthetic',last_name:String(i)}})));
 const pages=await gamePages(traceProvider(game)),children=pages.flatMap(p=>p.children);
 assert.ok(pages.filter(p=>p.children.length).length>1);assert.ok(pages.every(p=>p.children.length<=100));assert.ok(children.every(c=>Buffer.byteLength(JSON.stringify(c.args))<=8192));
 assert.equal(children.find(c=>c.kind==='radar').args.native_role_scope,undefined);
});
test('production collector → saved native observations → shared resolver infers 7/9 for home and away',async()=>{
 for(const format of [7,9])for(const teamId of ['400','401']){
  const game=traceNativeGame({format,anonymousKeeper:true}),provider=traceProvider(game),store=traceStorage();
  try{
   const pages=await gamePages(provider,{teamId});for(const page of pages)await store.save(page);
   for(const child of pages.flatMap(p=>p.children).filter(c=>['radar','tracking'].includes(c.kind))){let cursor={};for(let i=0;i<20;i++){const page=await provider.collect(child.kind,child.args,cursor);await store.save(page);if(page.complete)break;cursor=page.checkpoint;}}
   const components=store.all('SELECT * FROM source_trace_components'),members=store.all('SELECT * FROM source_game_members').map(m=>({...m,player_id:m.dummy?null:m.source_player_id})),source={...store.all('SELECT * FROM source_events')[0],side:teamId==='400'?'home':'away'};
   assert.ok(components.every(r=>r.provenance==='provider'));assert.equal(components.filter(r=>r.kind==='radar').length,2);
   const c={teamId:'app-team',seasonId:'season',eventId:'event',source,components,header:components.find(r=>r.kind==='header'),members,tracking:store.all('SELECT * FROM source_tracking_segments'),coverage:store.all('SELECT * FROM source_component_coverage'),scope:`trace:4001:trace:${teamId}`,summaries:[],heatmaps:[],credited:[],overrides:[],lineup:[],matchOverride:{},momentsComplete:true,revision:{source_revision:1},input:'test'};
   const resolved=resolveSnapshot(c);assert.equal(resolved.result.format.value,format);assert.equal(resolved.facts.length,format-1);assert.ok(resolved.facts.every(f=>f.minutes===4&&f.field_minutes===4&&f.gk_minutes===0));
   assert.equal(resolved.result.totals.unassignedGkSeconds,240);assert.equal(resolved.result.totals.assignedSeconds,(format-1)*240);assert.equal(resolved.result.totals.unallocatedSeconds,0);
  }finally{store.close();}
 }
});
test('foreign account/game role scopes, trimmed GIDs and unbalanced populations remain unverified',async()=>{
 const game=traceNativeGame(),p=traceProvider(game),pages=await gamePages(p),job=pages.flatMap(p=>p.children).find(c=>c.kind==='radar');
 for(const edit of [{account_id:'other-account'},{game_id:'9000'}]){
  const result=await p.collect('radar',{...job.args,native_role_scope:{...job.args.native_role_scope,...edit}}),analysis=data(result.records.trace_parts[0]).analysis;
  assert.deepEqual(analysis.track_roles,[]);assert.equal(analysis.both_sides_verified,null);
 }
 const unbalanced=traceNativeGame();for(let i=0;i<6;i++)unbalanced.team_members.push({...unbalanced.team_members[1],gid:'home-'+(i+30)});
 const radar=traceRadar(unbalanced);radar.frm.forEach(f=>{for(let i=2;i<=7;i++)delete f.a['away-'+i];});
 assert.equal((await radarResult(unbalanced,radar)).value.analysis.both_sides_verified,null);
 const trimmed=traceNativeGame();trimmed.team_members[1].gid+=' ';
 assert.ok(!(await radarResult(trimmed,traceRadar(trimmed))).value.analysis.track_roles.some(r=>r.gid==='home-2'));
});
test('rolling reductions match original algorithm across irregular native populations',async()=>{
 let seed=712341;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
 for(let n=0;n<12;n++){
  const game=traceNativeGame(),radar=traceRadar(game);radar.frm=Array.from({length:30+n*31},(_,i)=>({t:i*125,a:Object.fromEntries(Array.from({length:3+Math.floor(random()*18)},(_,j)=>[String(j),{}]))}));
  const r=await radarResult(game,radar),expected=original.detectPlayWindow(radar);assert.deepEqual(r.value.analysis.play_window,{...expected,complete:true});
 }
});
test('largest accepted radar is bounded and over-bound assets fail instead of saving a prefix',async()=>{
 const game=traceNativeGame(),actors=Object.fromEntries(Array.from({length:10},(_,i)=>[String(i),{}])),radar={frm:Array.from({length:60000},(_,i)=>({t:i*10,a:actors}))};
 radar.padding='';radar.padding='x'.repeat(8_000_000-Buffer.byteLength(JSON.stringify(radar)));
 const bytes=Buffer.byteLength(JSON.stringify(radar));assert.equal(bytes,8_000_000);
 const started=performance.now(),r=await radarResult(game,radar);const elapsed=performance.now()-started;
 assert.equal(r.value.samples,60000);assert.equal(r.value.analysis.play_window.end,5999.9);assert.equal(r.value.analysis.play_window.baseline_tracks,10);assert.equal(r.value.analysis.both_sides_verified,null);
 console.log(JSON.stringify({trace_radar_maximum:{runtime:'node',frames:60000,actor_observations:600000,response_bytes:bytes,typed_reduction_bytes:60000*12,collector_wall_ms:Math.round(elapsed)}}));
 for(const oversized of [
  {frm:[...radar.frm,{t:600000,a:{}}]},
  {frm:[{t:0,a:Object.fromEntries(Array.from({length:129},(_,i)=>[String(i),{}]))},{t:100,a:{}}]},
  {frm:radar.frm.map((f,i)=>i===59999?{...f,a:{...f.a,extra:{}}}:f)},
 ])await assert.rejects(()=>radarResult(game,oversized),e=>e.code==='record_too_large');
});
test('oversize collector failure becomes terminal and retains saved native facts',async()=>{
 const game=traceNativeGame(),provider=traceProvider(game),store=traceStorage();
 try{
  const pages=await gamePages(provider);for(const page of pages)await store.save(page);
  const child=pages.flatMap(p=>p.children).find(c=>c.kind==='radar'),valid=await provider.collect('radar',child.args);await store.save(valid);
  const before=store.all('SELECT * FROM source_trace_components');for(const sql of SYNC_SCHEMA)store.sqlite.exec(sql);
  store.sqlite.exec("INSERT INTO sync_jobs(id,provider,account_scope,account_id,authorization_generation,component,scope,resource_key,scan_id,state,ready_since,next_at,interval_ms,lease_token,lease_until) VALUES('radar-job','trace','account','account',1,'radar','trace:4001:trace:400:1','radar','scan','running',0,0,3600000,'lease',100000);INSERT INTO sync_job_subscribers(job_id,kind,demand_key) VALUES('radar-job','account','account');");
  const oversized=traceProvider(game,{frm:Array.from({length:60001},(_,i)=>({t:i,a:{}}))});let failure;
  try{await oversized.collect('radar',child.args);}catch(error){failure=error;}
  assert.equal(failure?.code,'record_too_large');const coordinator=new JobCoordinator(store.db,{clock:()=>1000}),lease=store.all('SELECT * FROM sync_jobs')[0],result=await coordinator.fail(lease,failure);
  assert.equal(result.state,'failed');assert.equal(result.error.kind,'permanent');assert.equal(await coordinator.nextWake(),null);assert.deepEqual(store.all('SELECT * FROM source_trace_components'),before);
 }finally{store.close();}
});
