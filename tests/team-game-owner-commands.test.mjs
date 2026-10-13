import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedOwnerFixture} from './fixtures/published-game-owner-fixture.mjs';
import {resolvePublishedGame,gameScopeFenceSQL,gameScopeRevision,captureGameOwnerState,gameOwnerStateFenceSQL,assertPublishedGameCurrent} from '../src/domain/team-game-scope.js';
import {TeamFeatures} from '../src/application/team-features.js';
import {CoachingService} from '../src/coaching/service.js';
import {CursorCodec} from '../src/read-model/cursor.js';
const INPUT={team_id:'team',team_season_id:'season',event_id:'ts-source'},AT='2026-10-01T16:00:00Z';
const game=f=>resolvePublishedGame(f.db,'team','season','ts-source');
const ok=(f,fence)=>f.sql.prepare('SELECT '+fence.sql+' AS ok').get(...fence.params).ok;
const features=f=>new TeamFeatures(f.db,{owner:true},{cursor:new CursorCodec(new Uint8Array(32).fill(9))});
const coach=f=>new CoachingService(f.db,{owner:true},{now:()=>Date.parse(AT),resolveRoleHints:async()=>({})});
const save=(f,event,team='team')=>f.insert('game_bookmarks',{app_team_id:team,event_id:event,snapshot:JSON.stringify({id:event,type:'game',team_season_id:'season',starts_at:AT,title:event}),saved_at:AT});
const session=(f,event)=>f.insert('coach_sessions',{app_team_id:'team',team_season_id:'season',event_id:event,format:7,half_minutes:25,phase:'setup',period:1,elapsed_ms:0,period_start_ms:0,revision:1,updated_at:AT,write_token:event});

for(const mutation of [
 "UPDATE source_events SET content_hash='changed' WHERE id='ts-source'",
 "UPDATE source_events SET title='changed-without-hash' WHERE id='ts-source'",
 "UPDATE provider_accounts SET active=0,generation=generation+1 WHERE id='account'",
 "UPDATE team_source_connections SET input_revision=input_revision+1 WHERE id='root-team-ts'",
 "UPDATE team_source_connections SET active=0 WHERE id='root-team-ts'",
 "UPDATE team_connection_seasons SET excluded=1 WHERE connection_id='root-team-ts'",
 "UPDATE team_connection_seasons SET generation=generation+1 WHERE connection_id='root-team-ts'",
 "UPDATE team_source_attachments SET generation=generation+1 WHERE id='team-ts'",
 "UPDATE source_event_teams SET side='away' WHERE source_event_id='ts-source'",
 "UPDATE event_source_links SET evidence='{\"changed\":true}' WHERE source_event_id='ts-source'",
 "UPDATE app_teams SET timezone='America/New_York' WHERE id='team'",
 "INSERT INTO event_aliases VALUES('ts-event','public-event')",
])test('committing scope CAS rejects exact source or authority changes: '+mutation,async()=>{
 const f=publishedOwnerFixture();try{const before=await game(f),fence=gameScopeFenceSQL(before);assert.equal(ok(f,fence),1);f.sql.exec(mutation);assert.equal(ok(f,fence),0);await assert.rejects(assertPublishedGameCurrent(f.db,before),e=>e.code==='cursor_restart'||e.code==='game_scope_ambiguous');assert.ok(fence.params.length<=10);assert.ok(fence.sql.length<100000);}finally{f.close();}
});
test('an already stale source changing again is detected without pointer or content changes',async()=>{
 const f=publishedOwnerFixture();try{f.sql.exec("UPDATE source_events SET content_hash='first' WHERE id='ts-source';UPDATE team_projection_state SET pending=0");const a=await game(f);assert.equal(a.evidence_changed,1);const fence=gameScopeFenceSQL(a,{forWrite:false});assert.equal(ok(f,fence),1);f.sql.exec("UPDATE source_events SET content_hash='second' WHERE id='ts-source'");assert.equal(ok(f,fence),0);}finally{f.close();}
});
test('new owner decision invalidates a published group immediately without moving or deleting keys',async()=>{
 const f=publishedOwnerFixture();try{save(f,'ts-event');const before=await game(f),fence=gameScopeFenceSQL(before),d={...f.sql.prepare('SELECT * FROM team_game_decision_revisions').get(),revision:2,authority:'owner',decision:'rejected',request_id:'reject',request_hash:'1'.repeat(64),predecessor_revision:1};f.insert('team_game_decision_revisions',d);f.sql.exec('UPDATE team_game_associations SET head_revision=2,owner_revision=2');assert.equal(ok(f,fence),0);assert.equal((await game(f)).available,false);assert.equal(f.sql.prepare('SELECT count(*) n FROM game_bookmarks').get().n,1);}finally{f.close();}
});
test('owner snapshots detect insertion/deletion/revision of all original keys and expose complete physical keys',async()=>{
 const f=publishedOwnerFixture();try{const g=await game(f);const empty=await captureGameOwnerState(f.db,g);assert.equal(ok(f,gameOwnerStateFenceSQL(empty)),1);save(f,'ts-event');assert.equal(ok(f,gameOwnerStateFenceSQL(empty)),0);const saved=await captureGameOwnerState(f.db,g,{kinds:['game_bookmarks']});assert.deepEqual(saved.event_ids,['ts-event']);assert.equal(saved.rows[0].kind,'game_bookmarks');f.sql.exec("UPDATE game_bookmarks SET snapshot='{\"changed\":true}'");assert.equal(ok(f,gameOwnerStateFenceSQL(saved)),0);}finally{f.close();}
});
test('owner overflow is explicit and bookmarks retain complete paginated original-key reachability',async()=>{
 const f=publishedOwnerFixture();try{for(let i=0;i<257;i++){const id='alias-'+String(i).padStart(3,'0');f.insert('events',{id,created_at:AT});f.insert('event_aliases',{merged_id:id,canonical_id:'ts-event'});save(f,id);}const g=await game(f);assert.equal(g.available,false);assert.equal(g.reason,'owner_scope_bound');const service=features(f);let cursor=null,ids=[];do{const page=await service.bookmarks('team',{period:'all',limit:100,cursor});ids.push(...page.events.items.map(i=>i.id));cursor=page.events.next_cursor;}while(cursor);assert.equal(new Set(ids).size,257);assert.equal(ids.length,257);await service.bookmark('team',ids[200],false);assert.equal(f.sql.prepare('SELECT count(*) n FROM game_bookmarks').get().n,256);}finally{f.close();}
});
for(const target of ['public-event','ts-event'])test('bookmarks preserve original keys, group once and remove only selected team references: '+target,async()=>{
 const f=publishedOwnerFixture({target});try{const service=features(f),g=await game(f),token=await gameScopeRevision(g);await service.bookmark('team','ts-source',true,{game_scope_revision:token});await service.bookmark('team','public-event',true,{game_scope_revision:token});save(f,'ts-event','foreign');assert.deepEqual(f.sql.prepare("SELECT event_id FROM game_bookmarks WHERE app_team_id='team' ORDER BY event_id").all().map(r=>r.event_id),['public-event','ts-event']);const list=await service.bookmarks('team',{period:'all'});assert.equal(list.events.total,1);assert.equal(list.events.items[0].id,target);assert.deepEqual(list.events.items[0].saved_event_ids,['public-event','ts-event']);await service.bookmark('team',target,false,{game_scope_revision:token});assert.deepEqual(f.sql.prepare('SELECT app_team_id,event_id FROM game_bookmarks').all().map(r=>({...r})),[{app_team_id:'foreign',event_id:'ts-event'}]);assert.ok(f.maxBatch()<=48);}finally{f.close();}
});
test('bookmark unlinked originals stay listable and individually removable without group authority',async()=>{
 const f=publishedOwnerFixture();try{save(f,'ts-event');save(f,'public-event');const service=features(f);f.sql.exec("UPDATE team_source_connections SET active=0 WHERE id='root-team-ts'");const list=await service.bookmarks('team',{period:'all'});assert.equal(list.events.total,2);await service.bookmark('team','ts-event',false);assert.deepEqual(f.sql.prepare('SELECT event_id FROM game_bookmarks').all().map(r=>r.event_id),['public-event']);}finally{f.close();}
});
test('bookmark group removal and add roll back on precommit owner key or membership changes',async t=>{
 for(const mutate of [f=>f.sql.exec("UPDATE provider_accounts SET generation=2 WHERE id='account'"),f=>save(f,'public-event')])await t.test(String(mutate),async()=>{const f=publishedOwnerFixture();try{const service=features(f),g=await game(f);save(f,'ts-event');f.beforeBatch(()=>mutate(f));await assert.rejects(service.bookmark('team','ts-source',false,{game_scope_revision:await gameScopeRevision(g)}),e=>e.code==='stale_revision');assert.equal(f.sql.prepare("SELECT count(*) n FROM game_bookmarks WHERE event_id='ts-event'").get().n,1);}finally{f.close();}});
});
test('Coach constituent references share grouped attendance and retain a sole original session key',async()=>{
 const f=publishedOwnerFixture();try{session(f,'ts-event');const c=coach(f);for(const event_id of ['ts-source','public-source','ts-event','public-event']){const r=await c.read({...INPUT,event_id});assert.equal(r.event_id,'public-event');assert.equal(r.session.revision,1);assert.equal(r.roster[0].availability_source,'attendance:yes');}const r=await c.read(INPUT);await c.command({...INPUT,game_scope_revision:r.game_scope_revision},{type:'configure',format:9,half_minutes:90},1);assert.deepEqual(f.sql.prepare('SELECT event_id,revision,format,half_minutes FROM coach_sessions').all().map(r=>({...r})),[{event_id:'ts-event',revision:2,format:9,half_minutes:90}]);assert.ok(f.maxBatch()<=48);}finally{f.close();}
});
test('independent grouped Coach sessions stay conflicting and cannot use canonical deletion resolution',async()=>{
 const f=publishedOwnerFixture();try{session(f,'ts-event');session(f,'public-event');const c=coach(f),r=await c.read(INPUT);assert.equal(r.identity_conflict.kind,'game_sessions');assert.equal(r.session,null);const before=f.sql.prepare('SELECT * FROM coach_sessions ORDER BY event_id').all();await assert.rejects(c.command({...INPUT,game_scope_revision:r.game_scope_revision},{type:'resolve_session_identity',discard:true,keep_event_id:'ts-event',expected:[{event_id:'ts-event',revision:1},{event_id:'public-event',revision:1}]},1),e=>e.code==='private_identity_conflict');assert.deepEqual(f.sql.prepare('SELECT * FROM coach_sessions ORDER BY event_id').all(),before);}finally{f.close();}
});
test('Coach creation rejects missing/old group tokens and concurrent original session creation atomically',async()=>{
 const f=publishedOwnerFixture();try{const c=coach(f),r=await c.read(INPUT);await assert.rejects(c.command(INPUT,{type:'create'},0),e=>e.code==='game_scope_changed');await assert.rejects(c.command({...INPUT,game_scope_revision:'old'},{type:'create'},0),e=>e.code==='game_scope_changed');f.beforeBatch(()=>session(f,'ts-event'));await assert.rejects(c.command({...INPUT,game_scope_revision:r.game_scope_revision},{type:'create'},0),e=>e.code==='revision_conflict');assert.deepEqual(f.sql.prepare('SELECT event_id FROM coach_sessions').all().map(r=>r.event_id),['ts-event']);}finally{f.close();}
});
test('legacy ordinary Coach create keeps existing command behavior and budget',async()=>{
 const f=publishedOwnerFixture({normalized:false});try{const c=coach(f);const r=await c.command({...INPUT,event_id:'ts-event'},{type:'create'},0);assert.equal(r.session.revision,1);assert.ok(f.queries()<=48);assert.ok(f.maxBatch()<=48);}finally{f.close();}
});
test('revoked Coach original opens only saved roster and minutes read-only, with foreign/viewer denial',async()=>{
 const f=publishedOwnerFixture();try{session(f,'ts-event');f.insert('coach_session_players',{app_team_id:'team',team_season_id:'season',event_id:'ts-event',player_id:'player',name:'Saved name',jersey:'42',available:1,availability_source:'coach',minutes_override_ms:900000});f.sql.exec("UPDATE coach_sessions SET phase='finished',elapsed_ms=1800000 WHERE event_id='ts-event';UPDATE team_source_connections SET active=0 WHERE id='root-team-ts';UPDATE team_player_rows SET name='New source name'");const c=new CoachingService(f.db,{owner:true},{resolveAvailability:()=>{throw Error('No live attendance permitted');},resolveRoleHints:()=>{throw Error('No live role hints permitted');}}),r=await c.read({...INPUT,event_id:'ts-event'});assert.equal(r.state_only,true);assert.equal(r.can_edit,false);assert.equal(r.session.roster[0].name,'Saved name');assert.equal(r.session.roster[0].jersey,'42');assert.equal(r.session.minutes_ms.player,900000);assert.deepEqual(r.profiles,{});assert.deepEqual(r.role_hints,{});await assert.rejects(c.command({...INPUT,event_id:'ts-event'},{type:'configure',format:9,half_minutes:25},1),e=>e.code==='game_scope_changed');await assert.rejects(c.read({...INPUT,event_id:'ts-source'}),e=>e.code==='game_scope_changed');await assert.rejects(c.read({team_id:'foreign',team_season_id:'foreign-season',event_id:'public-event'}),e=>e.code==='game_scope_changed');await assert.rejects(new CoachingService(f.db,{teamId:'team'}).read({...INPUT,event_id:'ts-event'}),e=>e.code==='owner_required');assert.equal(f.sql.prepare("SELECT revision FROM coach_sessions WHERE event_id='ts-event'").get().revision,1);}finally{f.close();}
});
test('a split preserves independent bookmarks and sessions and rejects the previous open group token',async()=>{
 const f=publishedOwnerFixture();try{save(f,'ts-event');save(f,'public-event');session(f,'ts-event');session(f,'public-event');const c=coach(f),old=await c.read(INPUT),oldRows=f.sql.prepare("SELECT * FROM team_game_source_rows WHERE app_team_id='team'").all(),oldEvent=f.sql.prepare("SELECT * FROM team_event_rows WHERE app_team_id='team'").get();f.insert('team_projection_runs',{id:'split-run',app_team_id:'team',team_season_id:'season',input_revision:1,state:'building',created_at:AT,team_game_version:1});for(const m of oldRows){f.insert('team_event_rows',{...oldEvent,run_id:'split-run',event_id:m.original_event_id,source_ids:JSON.stringify([m.source_event_id]),schedule_source_id:m.source_event_id,result_source_id:m.source_event_id});f.insert('team_game_source_rows',{...m,run_id:'split-run',target_event_id:m.original_event_id,association_id:null});}f.sql.exec("UPDATE team_projection_runs SET state='published' WHERE id='split-run';UPDATE team_projection_state SET published_run_id='split-run',pending=0 WHERE app_team_id='team'");assert.equal((await features(f).bookmarks('team',{period:'all'})).events.total,2);await assert.rejects(c.command({...INPUT,game_scope_revision:old.game_scope_revision},{type:'configure',format:9,half_minutes:30},1),e=>e.code==='game_scope_changed');for(const event_id of ['ts-event','public-event']){const r=await c.read({...INPUT,event_id});assert.equal(r.event_id,event_id);assert.equal(r.session.revision,1);}assert.deepEqual(f.sql.prepare('SELECT event_id,revision FROM coach_sessions ORDER BY event_id').all().map(r=>({...r})),[{event_id:'public-event',revision:1},{event_id:'ts-event',revision:1}]);}finally{f.close();}
});
test('freshly read locally saved account-disconnected games remain editable without refetch',async()=>{
 const f=publishedOwnerFixture();try{f.sql.exec("UPDATE provider_accounts SET active=0,generation=2 WHERE id='account'");const c=coach(f),r=await c.read(INPUT);assert.equal(r.available,true);assert.equal((await c.command({...INPUT,game_scope_revision:r.game_scope_revision},{type:'create'},0)).session.revision,1);}finally{f.close();}
});


test('owner reject then reaccept waits for a publication containing that owner revision',async()=>{
 const f=publishedOwnerFixture();try{save(f,'ts-event');const original={...f.sql.prepare('SELECT * FROM team_game_decision_revisions').get()};
 for(const [revision,decision]of [[2,'rejected'],[3,'accepted']]){f.insert('team_game_decision_revisions',{...original,revision,authority:'owner',decision,request_id:'decision-'+revision,request_hash:String(revision).repeat(64),predecessor_revision:revision-1});f.sql.prepare('UPDATE team_game_associations SET head_revision=?,owner_revision=?').run(revision,revision);assert.equal((await game(f)).available,false,decision+' cannot use publication1');}
 const oldRun={...f.sql.prepare("SELECT * FROM team_projection_runs WHERE id='run-team'").get()};f.insert('team_projection_runs',{...oldRun,id:'run-next',state:'building'});
 for(const table of ['team_event_rows','team_player_rows','team_game_publications','team_game_source_rows'])for(const row of f.sql.prepare('SELECT * FROM '+table+' WHERE run_id=?').all('run-team'))f.insert(table,{...row,run_id:'run-next',...(table==='team_game_publications'?{decision_revision:3}: {})});
 f.sql.exec("UPDATE team_projection_runs SET state='published' WHERE id='run-next';UPDATE team_projection_state SET published_run_id='run-next' WHERE app_team_id='team';");assert.equal((await game(f)).available,true);assert.equal(f.sql.prepare('SELECT count(*) n FROM game_bookmarks').get().n,1);
 f.insert('team_game_decision_revisions',{...original,revision:4,authority:'matcher',decision:'review',predecessor_revision:3});f.sql.exec('UPDATE team_game_associations SET head_revision=4');assert.equal((await game(f)).available,true,'new matcher review alone retains published accepted owner decision');
 }finally{f.close();}
});
