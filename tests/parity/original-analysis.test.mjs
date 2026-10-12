import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOriginalEngine,loadOriginalUi,gameFixture,lineupFixture,spatialFixture} from './original-analysis-fixtures.js';
const engine=loadOriginalEngine();
const run=f=>engine.calculateGame('1',f.info,f.scans,f.truth,{},new Set());
const player=(r,name)=>r.players.find(p=>p.player===name);
for(const format of [7,9])test('original '+format+'v'+format+' full match retains capacity and formation',()=>{
 const r=run(gameFixture(format));assert.equal(r.format,format+'v'+format);assert.equal(r.game_minutes,50);assert.equal(r.target_player_minutes,format*50);assert.equal(r.resolved_player_minutes,format*50);assert.equal(r.constraints.max_concurrent,format);assert.deepEqual(r.constraints.violations,[]);
 const m=loadOriginalUi().matchLineupModel({format:format+'v'+format},lineupFixture(format));assert.equal(m.formation,format===7?'2-3-1':'3-3-2');assert.equal(m.starters.length,format);assert.equal(m.positions.size,format);
});
test('original separates field and goalkeeper time for a half-time role swap',()=>{
 const f=gameFixture();f.truth.goalkeeper['2']={player:'Player 2'};f.scans[2]['home-1']=[[0,1500]];delete f.scans[2]['home-2'];const r=run(f);
 for(const name of ['Player 1','Player 2']){const p=player(r,name);assert.equal(p.minutes,50);assert.equal(p.field_minutes,25);assert.equal(p.goalkeeper_minutes,25);}assert.deepEqual(r.constraints.violations,[]);
});
test('original missing participation stays unknown while confirmed DNP is zero',()=>{
 const f=gameFixture();delete f.scans[1]['home-2'];delete f.scans[2]['home-2'];const missing=player(run(f),'Player 2');assert.equal(missing.minutes,null);assert.equal(missing.appearance,null);assert.equal(missing.status,'unresolved_participation');
 f.truth.dnp={'Player 2':{reason:'owner confirmed',source:'owner'}};const dnp=player(run(f),'Player 2');assert.equal(dnp.minutes,0);assert.equal(dnp.appearance,false);assert.equal(dnp.status,'dnp_confirmed');
});
test('original capacity completion remains explicitly estimated',()=>{
 const f=gameFixture();for(const h of [1,2])f.scans[h]['home-2']=[[0,300]];const r=run(f),p=player(r,'Player 2');assert.equal(p.minutes,50);assert.equal(p.validated_minutes,10);assert.equal(p.provisional_minutes,40);assert.equal(p.inferred_field_minutes,40);assert.equal(r.quality,'Estimated');
});
test('original confirmed field halves override sparse evidence without relabeling raw tracking',()=>{
 const f=gameFixture();for(const h of [1,2])f.scans[h]['home-2']=[[0,300]];f.truth.full_field_half={'1':[{player:'Player 2'}],'2':[{player:'Player 2'}]};const p=player(run(f),'Player 2');assert.equal(p.minutes,50);assert.equal(p.validated_minutes,50);assert.equal(p.provisional_minutes,0);assert.equal(p.direct_halo_minutes,10);assert.equal(p.has_user_role_override,true);
});
test('original opponent and dummy streams cannot add named player capacity',()=>{
 const f=gameFixture();f.info.metadata.team_members.push({gid:'away-99',side:'away',team_id:2,is_player:true,user_id:99,user:{first_name:'Opponent',last_name:'Track'}},{gid:'home-98',side:'home',team_id:1,is_player:true,user_id:98,jersey_number:'98',user:{first_name:'Tracer',is_dummy:true}});
 for(const h of [1,2]){f.scans[h]['away-99']=[[0,1500]];f.scans[h]['home-98']=[[0,1500]];}const r=run(f);assert.equal(r.resolved_player_minutes,350);assert.equal(r.players.some(p=>p.player==='Opponent Track'),false);assert.equal(r.players.some(p=>p.player==='Tracer'),false);assert.ok(r.unassigned_tracks.some(p=>p.gid==='home-98'));assert.equal(r.constraints.max_concurrent,7);
});
test('original clips to half-local play windows and coalesces duplicate intervals',()=>{
 const f=gameFixture();for(const h of [1,2]){f.info.summary.half_windows[h]={start:120,end:1620,duration:1500,baseline_tracks:14};for(const gid of Object.keys(f.scans[h]))f.scans[h][gid]=[[0,1000],[500,2000]];}
 const r=run(f),p=player(r,'Player 2');assert.equal(p.minutes,50);assert.equal(p.direct_halo_minutes,50);assert.deepEqual(p.half_details['1'].selected_intervals,[[120,1620]]);assert.deepEqual(r.constraints.violations,[]);assert.deepEqual(engine.mergeSegments([[0,10],[5,15],[20,25]],0),[[0,15],[20,25]]);
});
test('original dated identity scopes distinguish June preseason and July regular season',()=>{
 assert.equal(engine.seasonKey('2026-05-31'),'2025/26');assert.equal(engine.seasonKey('2026-06-01'),'preseason:2026');assert.equal(engine.seasonKey('2026-07-01'),'2026/27');
});
test('original rejects unusable heatmaps and requires tactical orientation for named lanes',()=>{
 const ui=loadOriginalUi(),base={player:'A',minutes:50};assert.equal(ui.matchHeatPosition({...base,spatial:null}),null);assert.equal(ui.matchHeatPosition({...base,spatial:{...spatialFixture,display_orientation:'unknown'}}),null);assert.equal(ui.matchHeatPosition({...base,spatial:{...spatialFixture,samples:29}}),null);assert.equal(ui.matchHeatPosition({...base,spatial:{...spatialFixture,tactical_left_is_top:false}}).label,'—');assert.equal(ui.matchHeatPosition({...base,spatial:spatialFixture}).label,'LB');
});
test('original match position correction overrides heatmap and works without a heatmap',()=>{
 const ui=loadOriginalUi({A:{position:'ST'}}),base={player:'A',minutes:50};assert.equal(ui.positionEvidence({...base,spatial:spatialFixture}).label,'ST');assert.equal(ui.positionEvidence({...base,spatial:null}).source,'match_manual');
});
test('original goalkeeper label has the documented five-minute and sixty-percent thresholds',()=>{
 const ui=loadOriginalUi();assert.equal(ui.rowIsGoalkeeper({minutes:50,goalkeeper_minutes:29}),false);assert.equal(ui.rowIsGoalkeeper({minutes:50,goalkeeper_minutes:30}),true);assert.equal(ui.rowIsGoalkeeper({minutes:4,goalkeeper_minutes:4}),false);
});
test('original half clocks prefer absolute timestamps and preserve unavailable clocks',()=>{
 const g={moments:[{type:'FullGameVideo',camera:{type:'Trace'},half:1,start_time:100000,time:10},{type:'FullGameVideo',camera:{type:'Trace'},half:2,start_time:200000,time:20}]};
 assert.deepEqual(engine.momentClock(g,{half:2,start_time:230000,time:999}),{half:2,seconds:30,basis:'absolute_timestamp'});assert.deepEqual(engine.momentClock(g,{half:1,time:25}),{half:1,seconds:15,basis:'legacy_reported_clock'});assert.deepEqual(engine.momentClock({moments:[]},{half:1,time:0}),{half:1,seconds:null,basis:'missing_clock'});
});
