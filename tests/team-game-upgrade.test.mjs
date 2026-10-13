import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,install731,fixture731,snapshot731} from './team-game-installation-harness.mjs';
import {V731_FINGERPRINT,V731_PLAN_HASH} from '../src/application/schema-v731.js';
import {teamGameInstallationIdentity} from '../src/application/team-game-installation-epoch.js';
const metadata="SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY type,name";
const mutation={sql:'UPDATE domain_installation SET mutation_revision=mutation_revision+1 WHERE id=1'};
test('exact731 additive bootstrap/resume is atomic, fenced and preserves all existing rows',async()=>{
 const h=await harness();try{
  await install731(h);await fixture731(h);const before=await snapshot731(h),objects=await h.query(metadata);
  assert.equal((await h.call({op:'inspect'})).result.state,'upgrade_required');
  for(let failBootstrapAt=0;failBootstrapAt<=9;failBootstrapAt++){
   await assert.rejects(h.call({op:'bootstrap',failBootstrapAt}));assert.deepEqual(await h.query(metadata),objects);
  }
  await assert.rejects(h.call({op:'bootstrap',loseAck:true}),/simulated_committed_response_loss/);
  let state=(await h.call({op:'inspect'})).result;assert.equal(state.state,'upgrading');assert.equal(state.cursor,0);
  await assert.rejects(h.call({op:'old',statements:[mutation]}),/extension_permit_required/);
  await assert.rejects(h.call({op:'current',statements:[mutation]}));
  await assert.rejects(h.call({op:'advance',mode:'maintenance'}),/being updated/);
  let maxUsed=0;
  while(state.state==='upgrading'){
   const saved=await h.query(metadata),prior=state;
   const count=state.phase==='expanding'?Math.min(24,50-state.cursor):0;
   for(let failAt=0;failAt<=count;failAt++){await assert.rejects(h.call({op:'advance',failAt}));assert.deepEqual(await h.query(metadata),saved);assert.equal((await h.call({op:'inspect'})).result.cursor,state.cursor);}
   const next=await h.call({op:'advance'});maxUsed=Math.max(maxUsed,next.used);state=next.result;
   await assert.rejects(h.call({op:'transact',extension:prior.extension,statements:[{sql:'CREATE TABLE stale_replay_should_not_exist(id INTEGER)'}]}));assert.deepEqual(await h.query("SELECT name FROM sqlite_master WHERE name='stale_replay_should_not_exist'"),[]);
  }
  assert.equal(state.state,'ready');assert.equal(state.base_fingerprint,V731_FINGERPRINT);assert.equal(state.effective_fingerprint,(await teamGameInstallationIdentity()).fingerprint);assert.ok(maxUsed<=50);
  assert.deepEqual(await snapshot731(h),before);assert.deepEqual(await h.query('SELECT DISTINCT team_game_version FROM team_projection_runs'),[{team_game_version:0}]);assert.deepEqual(await h.query('PRAGMA foreign_key_check'),[]);
  const base=(await h.query('SELECT * FROM installation_upgrade'))[0];assert.equal(base.plan_hash,V731_PLAN_HASH);assert.equal(base.to_fingerprint,V731_FINGERPRINT);
  const write=await h.call({op:'current',statements:[mutation]});assert.equal(write.used,3);assert.equal(write.result.length,1);
 }finally{await h.dispose();}
});
test('exact fresh target uses separate fresh origin and current writer with N+2 budget',async()=>{
 const h=await harness();try{
  assert.equal((await h.call({op:'inspect'})).result.state,'empty');let setup;
  for(let i=0;i<50;i++){setup=(await h.call({op:'fresh'})).result;if(!setup.continue)break;assert.equal((await h.call({op:'inspect'})).result.state,'initializing');}
  assert.equal(setup.continue,false);const state=(await h.call({op:'inspect'})).result;assert.equal(state.state,'ready');assert.equal(state.origin,'fresh');
  assert.equal((await h.query('SELECT plan_hash FROM installation_team_games_upgrade'))[0].plan_hash,'fresh');
  const write=await h.call({op:'current',statements:Array.from({length:48},()=>mutation)});assert.equal(write.used,50);assert.equal(write.result.length,48);assert.equal(write.rowsWritten,52);
  await assert.rejects(h.call({op:'old',statements:[mutation]}),/extension_permit_required/);
  const open={sql:`UPDATE installation_team_games_upgrade SET writer_mode='application',writer_epoch='team-games-v1',permit_guard=0 WHERE id=1 AND phase='complete' AND writer_mode IS NULL RETURNING id`},close={sql:`UPDATE installation_team_games_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1 AND writer_mode='application' RETURNING id`};
  const measured=await h.batch([open,mutation,close]);for(const row of [measured[0],measured[2]]){assert.equal(row.meta.changes,2);assert.deepEqual(row.results,[{id:1}]);}
  const before=await h.query('SELECT mutation_revision FROM domain_installation');
  await assert.rejects(h.batch([open,mutation]));
  await assert.rejects(h.batch([open,mutation,{sql:'INSERT INTO domain_team_preconditions VALUES(1,1,0)'},close]));
  await assert.rejects(h.batch([{sql:open.sql.replace('WHERE id=1',"WHERE epoch='wrong-epoch' AND id=1")},mutation,close]));
  assert.deepEqual(await h.query('SELECT mutation_revision FROM domain_installation'),before);
  for(const table of ['installation_upgrade','installation_team_games_upgrade'])assert.deepEqual(await h.query('SELECT writer_mode,writer_epoch,permit_guard FROM '+table),[{writer_mode:null,writer_epoch:null,permit_guard:null}]);
  assert.deepEqual(await h.query('PRAGMA foreign_key_check'),[]);
 }finally{await h.dispose();}
});

test('real fresh731 predecessor keeps its exact fresh journal and all saved data through the extension',async()=>{
 const h=await harness();try{
  let setup;for(let i=0;i<40;i++){setup=(await h.call({op:'fresh731'})).result;if(!setup.continue)break;}assert.equal(setup.continue,false);
  await fixture731(h);const before=await snapshot731(h),base=before.installation_upgrade[0];
  assert.equal(base.from_fingerprint,null);assert.equal(base.plan_hash,'fresh');assert.equal(base.original_cursor,720);assert.equal(base.original_completed_at,null);
  let state=(await h.call({op:'inspect'})).result;assert.equal(state.state,'upgrade_required');assert.equal(state.predecessor_origin,'fresh731');
  await assert.rejects(h.call({op:'bootstrap',loseAck:true}),/simulated_committed_response_loss/);
  await assert.rejects(h.call({op:'old',statements:[mutation]}),/extension_permit_required/);
  for(let i=0;i<10;i++){state=(await h.call({op:'advance'})).result;if(state.state==='ready')break;}
  assert.equal(state.state,'ready');assert.equal(state.origin,'preserved731');assert.equal(state.predecessor_origin,'fresh731');
  assert.equal(state.extension.base_plan_hash,'fresh');assert.equal(state.extension.base_fingerprint,V731_FINGERPRINT);
  assert.deepEqual(await snapshot731(h),before);assert.deepEqual(await h.query('SELECT DISTINCT team_game_version FROM team_projection_runs'),[{team_game_version:0}]);
  assert.deepEqual(await h.query('PRAGMA foreign_key_check'),[]);assert.equal((await h.call({op:'current',statements:[mutation]})).used,3);
 }finally{await h.dispose();}
});

test('exact714 and interrupted predecessor phases chain through frozen731 without an intermediate ready state',async()=>{
 const {install714}=await import('./team-game-installation-harness.mjs');
 const h=await harness();try{
  await install714(h);await fixture731(h,{legacy714:true});
  const tables=['provider_accounts','security_owner','security_installation','security_account_credentials','security_sessions','app_teams','team_seasons','source_teams','source_players','source_events','source_event_teams','event_source_links','team_source_attachments','game_bookmarks','coach_sessions','coach_session_players','coach_lineup','coach_stints','sync_jobs'];
  const capture=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>[name,await h.query('SELECT * FROM '+name+' ORDER BY rowid')])));
  const before=await capture();let state=(await h.call({op:'inspect'})).result;assert.equal(state.state,'upgrade_required');assert.equal(state.route,'predecessor731');
  await assert.rejects(h.call({op:'advance',mode:'maintenance'}),/being updated/);
  await assert.rejects(h.call({op:'advance',loseAck:true}),/simulated_committed_response_loss/);
  state=(await h.call({op:'inspect'})).result;assert.equal(state.state,'upgrading');assert.equal(state.phase,'sealing');
  const phases=new Set();let reached731=false,maxUsed=0;
  for(let i=0;i<160;i++){
   state=(await h.call({op:'inspect'})).result;
   if(state.state==='ready')break;
   phases.add(state.phase);
   if(state.base_fingerprint===V731_FINGERPRINT){reached731=true;assert.notEqual(state.state,'ready');}
   const step=await h.call({op:'advance'});maxUsed=Math.max(maxUsed,step.used);
   if(step.result.route==='predecessor731')assert.notEqual(step.result.state,'ready');
  }
  assert.equal(state.state,'ready');assert.equal(state.predecessor_origin,'migrated714');assert.ok(reached731);assert.ok(maxUsed<=50);
  for(const phase of ['sealing','expanding','transfers','roots','memberships','receipts','rosters','events','validating'])assert.ok(phases.has(phase),phase);
  assert.deepEqual(await capture(),before);assert.deepEqual(await h.query('PRAGMA foreign_key_check'),[]);
  assert.equal((await h.query('SELECT plan_hash FROM installation_upgrade'))[0].plan_hash,V731_PLAN_HASH);
  assert.equal((await h.call({op:'current',statements:[mutation]})).used,3);
  console.log(JSON.stringify({exact714_chain_max_sql:maxUsed,predecessor_phases:[...phases]}));
 }finally{await h.dispose();}
});

test('interrupted default fresh731 resumes exact prefixes with owner password through extension completion',async()=>{
 const h=await harness();try{
  const started=await h.call({op:'fresh731'});assert.equal(started.result.continue,true);
  let state=(await h.call({op:'inspect'})).result;assert.equal(state.state,'initializing');assert.equal(state.route,'fresh731');assert.equal(state.next_index,30);
  const before=await h.query(metadata),receipt=await h.query('SELECT * FROM setup_state');
  await assert.rejects(h.call({op:'fresh',password:'wrong-password'}),/Incorrect password/);assert.deepEqual(await h.query(metadata),before);assert.deepEqual(await h.query('SELECT * FROM setup_state'),receipt);
  await h.batch([{sql:'CREATE TABLE foreign_extra(id INTEGER)'}]);await assert.rejects(h.call({op:'fresh'}),error=>['fresh_database_required','installation_schema_mismatch'].includes(error.code));await h.batch([{sql:'DROP TABLE foreign_extra'}]);
  await assert.rejects(h.call({op:'fresh',loseAck:true}),/simulated_committed_response_loss/);assert.equal((await h.call({op:'inspect'})).result.next_index,60);
  let result,maxUsed=0,sawExtension=false;
  for(let i=0;i<40;i++){
   state=(await h.call({op:'inspect'})).result;
   if(state.state==='ready')break;
   if(state.state==='upgrade_required'||state.state==='upgrading'){sawExtension=true;assert.equal(state.predecessor_origin,'fresh731');}
   result=await h.call({op:'fresh'});maxUsed=Math.max(maxUsed,result.used);
   if(!sawExtension)assert.notEqual(result.result.setup.state,'ready');
  }
  assert.equal(state.state,'ready');assert.ok(sawExtension);assert.ok(maxUsed<=50);
  const saved=(await h.query('SELECT * FROM setup_state'))[0],journal=(await h.query('SELECT * FROM installation_upgrade'))[0];
  assert.equal(saved.started_at,receipt[0].started_at);assert.equal(saved.schema_fingerprint,V731_FINGERPRINT);assert.equal(journal.plan_hash,'fresh');assert.equal(journal.original_cursor,720);assert.equal(journal.original_started_at,saved.started_at);assert.equal(journal.original_completed_at,null);
  assert.deepEqual(await h.query('PRAGMA foreign_key_check'),[]);console.log(JSON.stringify({interrupted_fresh731_max_sql:maxUsed}));
 }finally{await h.dispose();}
});
