import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedAnalysisFixture} from './fixtures/published-analysis-fixture.mjs';
import {buildMatchAnalysisPage} from '../src/analysis/projector.js';
import {AnalysisService} from '../src/analysis/service.js';
import {NativeTrackService} from '../src/analysis/tracks.js';
import {CursorCodec} from '../src/read-model/cursor.js';
const input={team_id:'team',team_season_id:'season'},ids={kind:'player_match',eventId:'public-event',playerId:'player-001'};
const at='2026-10-12T12:00:00Z';
function services(f){const options={cursor:new CursorCodec(new Uint8Array(32).fill(9))};return {analysis:new AnalysisService(f.db,{owner:true},options),tracks:new NativeTrackService(f.db,{owner:true},options)};}
test('all constituent build/editor/lineup/track references share the published target and original saved keys',async()=>{
 const f=publishedAnalysisFixture();try{
  const {analysis,tracks}=services(f),editor=await analysis.editor(input,ids);assert.equal(editor.event_id,'event');assert.match(editor.game_scope_revision,/^[a-f0-9]{64}$/);
  const line=await analysis.lineup(input,'public-event'),list=await tracks.list(input,'public-source');assert.equal(line.event_id,'event');assert.equal(list.data.items.length,7);assert.equal(list.data.game_scope_revision,editor.game_scope_revision);
  await analysis.set({...input,game_scope_revision:editor.game_scope_revision},ids,{minutes:0,appearance:false},0);
  assert.deepEqual(f.all('SELECT event_id,fields FROM analysis_overrides').map(v=>[v.event_id,JSON.parse(v.fields)]),[['event',{minutes:0,appearance:0}]]);
  const page=await buildMatchAnalysisPage(f.db,{teamId:'team',seasonId:'season',eventId:'public-source'});f.commit(page);assert.equal(f.all('SELECT event_id FROM match_analysis')[0].event_id,'event');assert.equal(f.all("SELECT minutes FROM effective_player_matches WHERE player_id='player-001'")[0].minutes,0);
  assert.deepEqual(f.all('PRAGMA foreign_key_check'),[]);
 }finally{f.close();}
});
test('normalized missing token and old open editor cannot write after split even while Trace survives',async()=>{
 const f=publishedAnalysisFixture();try{const {analysis}=services(f),editor=await analysis.editor(input,ids);
  await assert.rejects(()=>analysis.set(input,ids,{goals:0},0),e=>e.code==='game_scope_changed');f.publish({id:'split-run',grouped:false});
  await assert.rejects(()=>analysis.set({...input,game_scope_revision:editor.game_scope_revision},ids,{goals:0},0),e=>e.code==='game_scope_changed');assert.equal(f.all('SELECT * FROM analysis_overrides').length,0);
 }finally{f.close();}
});
for(const [name,change]of [
 ['published membership split',f=>f.publish({id:'split-run',grouped:false})],
 ['same members new proof publication',f=>f.publish({id:'proof-run',proofHash:'b'.repeat(64)})],
 ['public root unlink',f=>f.sqlite.exec("UPDATE team_source_connections SET active=0 WHERE id='public-root'")],
 ['Trace own participant substitution',f=>f.sqlite.exec("UPDATE source_event_teams SET side='away' WHERE source_event_id='source-event'")],
 ['exact source evidence changed again',f=>f.sqlite.exec("UPDATE source_events SET content_hash='newer' WHERE id='public-source'")],
 ['new independent owner key',f=>f.insert('analysis_overrides',{app_team_id:'team',team_season_id:'season',kind:'match',event_id:'public-event',player_id:'',fields:'{"format":9}',revision:1,updated_at:at})],
])test('prepared analysis publication atomically rejects '+name,async()=>{
 const f=publishedAnalysisFixture();try{const page=await f.page();change(f);assert.throws(()=>f.commit(page),/CHECK/);assert.equal(f.all('SELECT * FROM match_analysis').length,0);assert.equal(f.all('SELECT * FROM player_match_analysis').length,0);}finally{f.close();}
});
test('saved local analysis stays usable after login pause but cannot fetch source children',async()=>{
 const f=publishedAnalysisFixture();try{f.sqlite.exec('UPDATE provider_accounts SET active=0,generation=generation+1');const {analysis,tracks}=services(f),editor=await analysis.editor(input,ids);await analysis.set({...input,game_scope_revision:editor.game_scope_revision},ids,{goals:0},0);f.commit(await f.page());assert.equal(f.all('SELECT * FROM effective_player_matches').length,7);const c=await tracks.context(input,'public-event');c.member=f.all("SELECT * FROM source_game_members WHERE gid='g1'")[0];assert.equal((await tracks.sourceChildren(c)).length,0);}finally{f.close();}
});
test('multiple original correction/lineup states are explicit conflicts and no key is copied or deleted',async()=>{
 const f=publishedAnalysisFixture();try{f.override('player-001',{minutes:0});f.insert('analysis_lineup_headers',{app_team_id:'team',team_season_id:'season',event_id:'public-event',format:9,revision:1,updated_at:at});const before=f.all('SELECT * FROM analysis_overrides'),line=f.all('SELECT * FROM analysis_lineup_headers'),{analysis}=services(f);await assert.rejects(()=>analysis.editor(input,ids),e=>e.code==='game_owner_state_conflict');const page=await f.page();f.commit(page);assert.equal(f.all('SELECT state FROM match_analysis')[0].state,'human_review');assert.deepEqual(f.all('SELECT * FROM analysis_overrides'),before);assert.deepEqual(f.all('SELECT * FROM analysis_lineup_headers'),line);}finally{f.close();}
});
test('foreign/public contexts cannot borrow private game corrections or tracks',async()=>{
 const f=publishedAnalysisFixture();try{const {analysis}=services(f);await assert.rejects(()=>analysis.editor({...input,team_id:'foreign'},ids),e=>e.code==='not_found');const viewer=new NativeTrackService(f.db,{owner:false,teamId:'team'});await assert.rejects(()=>viewer.list(input,'public-event'),e=>e.code==='owner_required');const foreignViewer=new AnalysisService(f.db,{owner:false,teamId:'foreign'});await assert.rejects(()=>foreignViewer.editor(input,ids),e=>e.code==='team_forbidden');}finally{f.close();}
});
for(const command of ['correction-set','correction-reset','lineup-set','lineup-reset','track-set','track-reset'])test(command+' fences published membership at the actual write',async()=>{
 const f=publishedAnalysisFixture();try{
  const {analysis,tracks}=services(f),editor=await analysis.editor(input,ids),request={...input,game_scope_revision:editor.game_scope_revision};
  if(command==='correction-reset')await analysis.set(request,ids,{goals:0},0);
  if(command==='lineup-reset')await analysis.setLineup(request,'public-event',{format:7,assignments:[],revision:0});
  let list=await tracks.list(input,'public-event'),track=list.data.items.find(v=>v.native_player?.id==='player-001');
  if(command==='track-reset'){await tracks.set({...input,game_scope_revision:list.data.game_scope_revision},'public-event',track.id,{player_id:'player-001',revision:0});list=await tracks.list(input,'public-event');track=list.data.items.find(v=>v.native_player?.id==='player-001');}
  const before=f.all('SELECT * FROM analysis_overrides'),line=f.all('SELECT * FROM analysis_lineup_headers'),assign=f.all('SELECT * FROM analysis_track_assignments'),repo=command.startsWith('track')?tracks.repo:analysis.repo,original=repo.domainBatch.bind(repo);
  repo.domainBatch=(...args)=>{f.publish({id:'race-split',grouped:false});return original(...args);};
  const current={...input,game_scope_revision:(await analysis.editor(input,ids)).game_scope_revision};
  const call=command==='correction-set'?()=>analysis.set(current,ids,{goals:0},0):command==='correction-reset'?()=>analysis.reset(current,ids,1):command==='lineup-set'?()=>analysis.setLineup(current,'public-event',{format:7,assignments:[],revision:0}):command==='lineup-reset'?()=>analysis.resetLineup(current,'public-event',1):command==='track-set'?()=>tracks.set({...input,game_scope_revision:list.data.game_scope_revision},'public-event',track.id,{player_id:'player-001',revision:0}):()=>tracks.reset({...input,game_scope_revision:list.data.game_scope_revision},'public-event',track.id,{revision:1});
  await assert.rejects(call,e=>e.code==='revision_conflict');assert.deepEqual(f.all('SELECT * FROM analysis_overrides'),before);assert.deepEqual(f.all('SELECT * FROM analysis_lineup_headers'),line);assert.deepEqual(f.all('SELECT * FROM analysis_track_assignments'),assign);
 }finally{f.close();}
});
test('same semantic publication reuses accepted facts; changed published proof changes input hash',async()=>{
 const f=publishedAnalysisFixture();try{f.commit(await f.page());const first=f.all('SELECT * FROM match_analysis')[0];f.publish({id:'same-run'});const same=await f.page();assert.equal(same.changed,false);f.commit(same);assert.equal(f.all('SELECT active_run FROM match_analysis')[0].active_run,first.active_run);f.publish({id:'changed-proof-run',proofHash:'c'.repeat(64)});const next=await f.page();assert.notEqual(next.checkpoint.input,first.input_hash);f.commit(next);assert.notEqual(f.all('SELECT active_run FROM match_analysis')[0].active_run,first.active_run);}finally{f.close();}
});
test('published source set does not admit a later globally linked Trace identity',async()=>{
 const f=publishedAnalysisFixture();try{
  const source=f.all("SELECT * FROM source_events WHERE id='source-event'")[0];f.insert('source_events',{...source,id:'new-trace-source',native_id:'21'});f.insert('source_event_teams',{source_team_id:'source-team',source_event_id:'new-trace-source',side:'home'});f.insert('event_source_links',{source_event_id:'new-trace-source',event_id:'event',reason:'owner',evidence:'{}'});
  const {tracks}=services(f),c=await tracks.context(input,'public-event');assert.equal(c.sources.length,1);assert.equal(c.source.id,'source-event');f.commit(await f.page());assert.equal(f.all('SELECT source_event_id FROM match_analysis')[0].source_event_id,'source-event');
 }finally{f.close();}
});
test('source membership and saved original owner rows survive split byte-for-byte',async()=>{
 const f=publishedAnalysisFixture();try{const {analysis,tracks}=services(f),editor=await analysis.editor(input,ids);await analysis.set({...input,game_scope_revision:editor.game_scope_revision},ids,{goals:0},0);const lineup=await analysis.lineup(input,'public-event');await analysis.setLineup({...input,game_scope_revision:lineup.game_scope_revision},'public-event',{format:7,assignments:[{half:1,player_id:'player-001',slot_kind:'field',slot:2,position:'LB'}],revision:0});let list=await tracks.list(input,'public-event');await tracks.set({...input,game_scope_revision:list.data.game_scope_revision},'public-event',list.data.items[1].id,{player_id:'player-001',revision:0});const tables=['analysis_overrides','analysis_lineup_headers','analysis_lineup_assignments','analysis_track_assignments','source_events','event_source_links'],before=tables.map(t=>f.all('SELECT * FROM '+t));f.publish({id:'preserved-split',grouped:false});assert.deepEqual(tables.map(t=>f.all('SELECT * FROM '+t)),before);const publicEditor=await analysis.editor(input,ids);assert.equal(publicEditor.event_id,'public-event');assert.equal(publicEditor.revision,0);assert.deepEqual(publicEditor.override,{});const privateEditor=await analysis.editor(input,{...ids,eventId:'event'});assert.equal(privateEditor.revision,1);assert.equal(privateEditor.override.goals,0);}finally{f.close();}
});
test('ordinary analysis routes require and preserve the editor scope token',async()=>{
 const {analysisRoutes}=await import('../src/analysis/routes.js'),f=publishedAnalysisFixture();try{
  const cursor=new CursorCodec(new Uint8Array(32).fill(9)),options={db:f.db,actor:{owner:true},cursor},url='https://myts.test/api/match-players/public-event/player-001/',query='?team_id=team&team_season_id=season',editor=await(await analysisRoutes(new Request(url+'editor'+query),options)).json();
  const request=body=>new Request(url+'correction'+query,{method:'PUT',headers:{origin:'https://myts.test','content-type':'application/json'},body:JSON.stringify(body)});
  await assert.rejects(()=>analysisRoutes(request({fields:{goals:0},revision:0}),options),e=>e.code==='game_scope_changed');const saved=await(await analysisRoutes(request({fields:{goals:0},revision:0,game_scope_revision:editor.game_scope_revision}),options)).json();assert.equal(saved.revision,1);assert.equal(f.all('SELECT event_id FROM analysis_overrides')[0].event_id,'event');
 }finally{f.close();}
});
test('one sole original owner key differs from display target and remains physical key for edits/build/reset',async()=>{
 const f=publishedAnalysisFixture();try{
  f.insert('analysis_overrides',{app_team_id:'team',team_season_id:'season',kind:'player_match',event_id:'public-event',player_id:'player-001',fields:'{"minutes":0,"appearance":0}',revision:1,updated_at:at});
  const {analysis}=services(f),editor=await analysis.editor(input,{...ids,eventId:'event'});assert.equal(editor.event_id,'event');assert.equal(editor.override.minutes,0);await analysis.set({...input,game_scope_revision:editor.game_scope_revision},{...ids,eventId:'event'},{goals:0},1);assert.deepEqual(f.all('SELECT event_id,revision FROM analysis_overrides'),[{event_id:'public-event',revision:2}]);
  const lineup=await analysis.lineup(input,'event');await analysis.setLineup({...input,game_scope_revision:lineup.game_scope_revision},'event',{format:7,assignments:[{half:1,player_id:'player-001',slot_kind:'field',slot:2,position:'LB'}],revision:0});assert.equal(f.all('SELECT event_id FROM analysis_lineup_headers')[0].event_id,'public-event');f.commit(await f.page());assert.equal(f.all('SELECT event_id FROM match_analysis')[0].event_id,'event');assert.equal(f.all("SELECT minutes FROM effective_player_matches WHERE player_id='player-001'")[0].minutes,0);assert.equal((await analysis.lineup(input,'event')).owner_assignments[0].slot,2);
  const fresh=await analysis.editor(input,ids);await analysis.reset({...input,game_scope_revision:fresh.game_scope_revision},ids,2);assert.equal(f.all('SELECT * FROM analysis_overrides').length,0);await analysis.resetLineup({...input,game_scope_revision:(await analysis.lineup(input,'event')).game_scope_revision},'event',1);assert.equal(f.all('SELECT * FROM analysis_lineup_headers').length,0);
 }finally{f.close();}
});
test('revoked game offers owner-only exact-key saved corrections/lineup with no overlays and denies writes',async()=>{
 const f=publishedAnalysisFixture();try{
  f.override('player-001',{minutes:0});f.insert('analysis_lineup_headers',{app_team_id:'team',team_season_id:'season',event_id:'event',format:7,revision:1,updated_at:at});f.insert('analysis_lineup_assignments',{app_team_id:'team',team_season_id:'season',event_id:'event',half:1,player_id:'player-001',slot_kind:'field',slot:2,position:'LB'});f.commit(await f.page());f.sqlite.exec("UPDATE team_source_connections SET active=0 WHERE id='root'");
  const {analysis}=services(f),ownIds={...ids,eventId:'event'},editor=await analysis.editor(input,ownIds),lineup=await analysis.lineup(input,'event');assert.equal(editor.state_only,true);assert.equal(editor.can_edit,false);assert.equal(editor.override.minutes,0);assert.equal(editor.source,null);assert.equal(lineup.state_only,true);assert.equal(lineup.can_edit,false);assert.deepEqual(lineup.roster,[]);assert.deepEqual(lineup.layouts,{});assert.equal(lineup.owner_assignments[0].name,'Saved player');assert.equal(lineup.owner_assignments[0].available,false);
  await assert.rejects(()=>analysis.set(input,ownIds,{goals:1},1),e=>e.code==='game_scope_changed');await assert.rejects(()=>analysis.setLineup(input,'event',{format:7,revision:1,assignments:[]}),e=>e.code==='game_scope_changed');await assert.rejects(()=>analysis.editor(input,ids),e=>e.code==='game_scope_changed');
  const viewer=new AnalysisService(f.db,{owner:false,teamId:'team'});await assert.rejects(()=>viewer.editor(input,ownIds),e=>e.code==='game_scope_changed');await assert.rejects(()=>viewer.lineup(input,'event'),e=>e.code==='game_scope_changed');
 }finally{f.close();}
});
