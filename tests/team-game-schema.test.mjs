import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {FreshInstallation} from '../src/application/fresh-install.js';
import {SCHEMA,SEED,APPLICATION_SCHEMA} from '../src/application/installation-schema.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {schemaObjects} from '../src/application/schema-upgrade.js';
import {V731_SCHEMA,V731_SEED,V731_FINGERPRINT} from '../src/application/schema-v731.js';
import {digest} from '../src/security/crypto.js';
import {installationSchema} from '../src/application/fresh-install.js';
const H='a'.repeat(64),NOW='2026-10-13T00:00:00Z';
async function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 const prepare=(sql,params=[])=>({bind(...p){return prepare(sql,p);},async all(){return {results:sqlite.prepare(sql).all(...params).map(row=>({...row})),meta:{changes:sqlite.prepare('SELECT changes() n').get().n}};},async first(){return(await this.all()).results[0]??null;},async run(){return this.all();}});
 const raw={prepare,async batch(statements){sqlite.exec('BEGIN');try{const rows=[];for(const q of statements)rows.push(await q.all());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const fresh=new FreshInstallation(raw,{schema:SCHEMA,seed:SEED,bootstrapPassword:'team-game-sqlite-fixture-password'});while((await fresh.inspect()).state!=='ready')await fresh.advance('team-game-sqlite-fixture-password');
 const db=wrapDatabase(raw),insert=(table,row)=>db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)).run();
 for(const id of ['team','foreign'])await insert('app_teams',{id,name:id,timezone:'UTC',season_year:2026,created_at:NOW});
 for(const [id,team,year]of [['season','team',2026],['next','team',2027],['foreign-season','foreign',2026]]){await insert('team_seasons',{id,app_team_id:team,year,start_day:`${year}-06-01`,end_day:`${year+1}-06-01`,start_at:`${year}-06-01T00:00:00Z`,end_at:`${year+1}-06-01T00:00:00Z`});await insert('team_projection_state',{team_season_id:id,app_team_id:team});}
 await insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'account-native',name:'Saved disconnected account',generation:3,active:0});
 for(const [id,provider,account]of [['ts-team','teamsnap','account'],['live-team','live',null]]){await insert('source_teams',{id,provider,scope:account??'public',account_id:account,native_id:id,name:id,name_authority:1,archived:0,evidence:'{}',content_hash:H,observed_at:NOW});await insert('team_source_attachments',{id:id+'-attachment',app_team_id:'team',team_season_id:'season',source_team_id:id,account_id:account,generation:2});}
 for(const [id,provider,account,team,event]of [['ts-event','teamsnap','account','ts-team','ts-target'],['live-event','live',null,'live-team','live-target']]){await insert('events',{id:event,created_at:NOW});await insert('source_events',{id,provider,scope:account??'public',account_id:account,native_id:id,starts_at:NOW,time_precision:'instant',type:'game',status:'SCHEDULED',conditional:0,home_source_team_id:team,home_label:'Own team',away_label:'Opponent',title:'Game',venue:'Venue',evidence:'{}',content_hash:H,observed_at:NOW});await insert('source_event_teams',{source_team_id:team,source_event_id:id,side:'home'});await insert('event_source_links',{source_event_id:id,event_id:event,reason:'source_identity',evidence:'{}',revision:1});}
 await insert('events',{id:'unrelated',created_at:NOW});
 const association={app_team_id:'team',association_id:'pair',private_account_id:'account',private_source_team_id:'ts-team',private_source_event_id:'ts-event',public_anchor_source_event_id:'live-event',origin_team_season_id:'season',target_event_id:'ts-target',created_at:NOW};
 const decision=(revision,extra={})=>({app_team_id:'team',association_id:'pair',revision,authority:'matcher',decision:'accepted',team_season_id:'season',effective_day:'2026-10-13',starts_at:NOW,local_day:'2026-10-13',algorithm_version:'test-v1',source_snapshot_revision:1,connection_snapshot_hash:H,owner_state_hash:H,semantic_hash:H,proof_hash:H,proof:'{}',created_at:NOW,...extra});
 const run=async id=>insert('team_projection_runs',{id,app_team_id:'team',team_season_id:'season',input_revision:1,state:'building',created_at:NOW,team_game_version:1});
 const event=async run_id=>insert('team_event_rows',{run_id,app_team_id:'team',team_season_id:'season',event_id:'ts-target',starts_at:NOW,type:'game',status:'SCHEDULED',conditional:0,own_side:'home',home_name:'Own',away_name:'Opponent',title:'Game',venue:'Venue',source_ids:'["live-event","ts-event"]',schedule_source_id:'live-event',result_source_id:'live-event'});
 const publication=(run_id,extra={})=>({run_id,app_team_id:'team',team_season_id:'season',association_id:'pair',decision_revision:1,target_event_id:'ts-target',disposition:'accepted',membership_hash:H,semantic_hash:H,proof_hash:H,state_scope_roots:'["ts-target","live-target"]',fence_hash:H,fence:'{}',state_refs:'[]',...extra});
 const member=(run_id,provider='teamsnap',extra={})=>{const p=provider==='teamsnap',source=p?'ts-event':'live-event',team=p?'ts-team':'live-team';return {run_id,app_team_id:'team',team_season_id:'season',target_event_id:'ts-target',source_event_id:source,association_id:'pair',original_event_id:p?'ts-target':'live-target',provider,account_id:p?'account':null,account_generation:p?3:null,entitlement_kind:'legacy_attachment',attachment_id:team+'-attachment',attachment_generation:2,connected_source_team_id:team,participant_source_team_id:team,source_hash:H,source_input_revision:sqlite.prepare('SELECT input_revision FROM source_event_state WHERE source_event_id=?').get(source)?.input_revision??0,event_link_revision:1,own_proof_hash:H,...extra};};
 return {sqlite,db,raw,insert,association,decision,run,event,publication,member,close:()=>sqlite.close()};
}
test('typed pair/decision provenance fences owner heads, admitted targets and publication before acceptance',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.insert('team_game_associations',{...f.association,target_event_id:'unrelated'}),/scope/);
  await assert.rejects(f.insert('team_game_associations',{...f.association,origin_team_season_id:'foreign-season'}),/scope/);
  await f.insert('team_game_associations',{...f.association,target_event_id:null});await assert.rejects(f.db.prepare("UPDATE team_game_associations SET target_event_id='unrelated' WHERE association_id='pair'").run(),/target_scope/);
  await f.db.prepare("UPDATE team_game_associations SET target_event_id='ts-target' WHERE association_id='pair'").run();
  await f.insert('team_game_decision_revisions',f.decision(1));await f.db.prepare("UPDATE team_game_associations SET head_revision=1 WHERE association_id='pair'").run();
  await assert.rejects(f.db.prepare("UPDATE team_game_associations SET accepted_revision=1 WHERE association_id='pair'").run(),/published_acceptance_required/);
  await f.run('new');await f.event('new');await f.insert('team_game_publications',f.publication('new'));
  await assert.rejects(f.db.prepare("UPDATE team_game_associations SET accepted_revision=1 WHERE association_id='pair'").run(),/published_acceptance_required/);
  await f.insert('team_game_source_rows',f.member('new'));await f.insert('team_game_source_rows',f.member('new','live'));
  await f.db.batch([f.db.prepare("UPDATE team_projection_runs SET state='published' WHERE id='new'"),f.db.prepare("UPDATE team_projection_state SET published_run_id='new' WHERE team_season_id='season'"),f.db.prepare("UPDATE team_game_associations SET accepted_revision=1 WHERE association_id='pair'")]);
  await f.insert('team_projection_runs',{id:'legacy',app_team_id:'team',team_season_id:'season',input_revision:0,state:'building',created_at:NOW});await assert.rejects(f.db.prepare("UPDATE team_projection_runs SET team_game_version=1 WHERE id='legacy'").run(),/run_format_immutable/);await f.run('other');await assert.rejects(f.db.prepare("UPDATE team_projection_runs SET team_game_version=0 WHERE id='other'").run(),/run_format_immutable/);await f.event('other');await f.insert('team_game_publications',f.publication('other'));
  for(const table of ['team_game_source_rows','team_game_publications']){
   await assert.rejects(f.db.prepare(`UPDATE ${table} SET run_id='other' WHERE run_id='new'`).run(),/published_immutable/);
   await assert.rejects(f.db.prepare(`DELETE FROM ${table} WHERE run_id='new'`).run(),/published_immutable/);
  }
  await f.insert('team_game_decision_revisions',f.decision(2,{authority:'owner',decision:'rejected',request_id:'owner-command',request_hash:H}));
  await f.db.prepare("UPDATE team_game_associations SET head_revision=2,owner_revision=2 WHERE association_id='pair'").run();
  await assert.rejects(f.db.prepare("UPDATE team_game_associations SET owner_revision=NULL WHERE association_id='pair'").run(),/owner_decision_required/);
  await assert.rejects(f.db.prepare("UPDATE team_game_associations SET owner_revision=1 WHERE association_id='pair'").run(),/owner_decision_required|revision_mismatch/);
  await assert.rejects(f.db.prepare("UPDATE team_game_associations SET accepted_revision=NULL WHERE association_id='pair'").run(),/published_acceptance_required/);
  await assert.rejects(f.insert('team_game_decision_revisions',f.decision(3,{authority:'owner',decision:'accepted',request_id:'owner-command',request_hash:H})),/UNIQUE/);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.close();}
});
test('legacy entitlement and account disconnect remain valid; typed roots prevent stale attachment fallback',async()=>{
 const f=await fixture();try{
  await f.insert('team_game_associations',f.association);await f.insert('team_game_decision_revisions',f.decision(1));await f.db.prepare("UPDATE team_game_associations SET head_revision=1 WHERE association_id='pair'").run();await f.run('new');await f.event('new');await f.insert('team_game_publications',f.publication('new'));
  await assert.rejects(f.insert('team_game_source_rows',f.member('new','teamsnap',{account_generation:null})),/CHECK|scope/);
  await assert.rejects(f.insert('team_game_source_rows',f.member('new','teamsnap',{attachment_generation:1})),/scope/);
  await f.insert('team_game_source_rows',f.member('new'));assert.equal(f.sqlite.prepare("SELECT active FROM provider_accounts WHERE id='account'").get().active,0);
  await f.db.prepare("DELETE FROM team_game_source_rows WHERE run_id='new'").run();
  await f.insert('team_source_connections',{id:'root',app_team_id:'team',source_team_id:'ts-team',account_id:'account',scope_mode:'observed_history',generation:2,active:0,created_at:NOW});
  await assert.rejects(f.insert('team_game_source_rows',f.member('new')),/scope/);
  await f.db.prepare("UPDATE team_source_connections SET active=1 WHERE id='root'").run();await f.insert('team_connection_seasons',{connection_id:'root',team_season_id:'season',attachment_id:'ts-team-attachment',basis:'events',active:1,excluded:0,generation:2});
  const r=f.sqlite.prepare("SELECT * FROM team_source_connections WHERE id='root'").get();await f.insert('team_game_source_rows',f.member('new','teamsnap',{entitlement_kind:'root',connection_id:'root',connection_generation:2,connection_input_revision:r.input_revision,membership_generation:2}));
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.close();}
});
test('bounded hold never stores truncated authority and cross-season active work serializes by team',async()=>{
 const f=await fixture();try{
  await f.insert('team_game_associations',f.association);await f.insert('team_game_decision_revisions',f.decision(1));await f.db.prepare("UPDATE team_game_associations SET head_revision=1 WHERE association_id='pair'").run();await f.run('hold');
  await assert.rejects(f.insert('team_game_publications',f.publication('hold',{disposition:'state_hold',state_refs_complete:0,state_refs:'["partial"]'})),/CHECK/);
  await f.insert('team_game_publications',f.publication('hold',{disposition:'state_hold',state_refs_complete:0,state_refs:'[]'}));
  const batch={batch_id:'move-a',app_team_id:'team',association_id:'pair',decision_revision:1,generation:1,state:'preparing',from_team_season_id:'season',to_team_season_id:'next',from_expected_input_revision:0,to_expected_input_revision:0,owner_state_hash:H,semantic_hash:H,fence_hash:H,created_at:NOW};
  await f.insert('team_game_publish_batches',batch);await assert.rejects(f.insert('team_game_publish_batches',{...batch,batch_id:'move-b',from_team_season_id:'next',to_team_season_id:'season'}),/UNIQUE/);
  await f.db.prepare("UPDATE team_game_publish_batches SET state='obsolete' WHERE batch_id='move-a'").run();await f.insert('team_game_publish_batches',{...batch,batch_id:'move-b',from_team_season_id:'next',to_team_season_id:'season'});
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.close();}
});

test('current raw domain/application fixtures match the exact fresh target while the 731 snapshot stays immutable',async()=>{
 const full=new Map(schemaObjects(SCHEMA).map(row=>[row.type+':'+row.name,row]));
 for(const row of schemaObjects(APPLICATION_SCHEMA))assert.deepEqual(row,full.get(row.type+':'+row.name),row.name);
 assert.equal(await digest(JSON.stringify({schema:installationSchema([V731_SCHEMA]),seed:V731_SEED})),V731_FINGERPRINT);
 const sqlite=new DatabaseSync(':memory:');try{for(const sql of APPLICATION_SCHEMA)sqlite.exec(sql);assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN('team_game_associations','team_game_decision_revisions','team_game_publications','team_game_source_rows','team_game_publish_batches')").get().n,5);assert.equal(sqlite.prepare("SELECT count(*) AS n FROM pragma_table_info('team_projection_runs') WHERE name='team_game_version' AND dflt_value='0'").get().n,1);}finally{sqlite.close();}
});

test('runtime fresh731 predecessor receipt is a separate exact default-batch origin',async()=>{
 const {TeamGameInstallation}=await import('../src/application/team-game-schema-upgrade.js');
 const {preservedFixture}=await import('./team-game-release-fixture.mjs');
 const {schemaIdentity}=await import('../scripts/release-check.mjs');
 const model=new TeamGameInstallation({}),f=preservedFixture(await schemaIdentity());f.row={...f.setup,domain_seed_count:1};
 assert.equal(model.assertBase(f),'migrated714');
 const fresh={...f,journal:{...f.journal,from_fingerprint:null,plan_hash:'fresh',original_cursor:720,original_completed_at:null,started_at:f.setup.started_at}};
 assert.equal(model.assertBase(fresh),'fresh731');
 for(const changed of [{original_cursor:731},{original_cursor:719},{original_completed_at:f.setup.completed_at},{plan_hash:'arbitrary'},{started_at:'not-original'},{writer_epoch:'team-connections-v1'}])assert.throws(()=>model.assertBase({...fresh,journal:{...fresh.journal,...changed}}),/does not match/);
});
