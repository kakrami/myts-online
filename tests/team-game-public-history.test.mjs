import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,AT,INPUT,HOME} from './fixtures/head-to-head-harness.mjs';
import {PUBLIC_HISTORY_SCHEMA} from '../src/application/public-history-schema.js';
import {PublicHistoryService} from '../src/application/public-history.js';

const H='a'.repeat(64),TS='teamsnap/account/101';
function grouped(target='private'){
 const f=fixture();for(const ddl of PUBLIC_HISTORY_SCHEMA)f.sqlite.exec(ddl);
 const publicEvent=f.event('public');f.insert('source_event_teams',{source_event_id:publicEvent.source,source_team_id:HOME,side:'home'});
 f.insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'11',name:'Synthetic'});
 f.insert('source_teams',{id:TS,provider:'teamsnap',scope:'account',account_id:'account',native_id:'101',name:'Us',name_authority:3,archived:0,evidence:'{}',content_hash:H,observed_at:AT});
 f.insert('events',{id:'private',created_at:AT});
 f.insert('source_events',{id:'private-source',provider:'teamsnap',scope:'account',account_id:'account',native_id:'10',local_day:'2026-09-01',time_precision:'day',type:'game',status:'FINAL',conditional:0,home_source_team_id:TS,home_label:'Us',away_label:'Them',title:'Private fixture',venue:'Field',evidence:'{}',content_hash:H,observed_at:AT});
 f.insert('source_event_teams',{source_event_id:'private-source',source_team_id:TS,side:'home'});f.insert('event_source_links',{source_event_id:'private-source',event_id:'private',reason:'native',evidence:'{}'});
 f.insert('team_source_attachments',{id:'private-attachment',app_team_id:'team',team_season_id:'season',source_team_id:TS,account_id:'account'});
 f.insert('team_projection_runs',{id:'group-run',app_team_id:'team',team_season_id:'season',input_revision:1,state:'building',created_at:AT,team_game_version:1});
 f.insert('team_event_rows',{run_id:'group-run',app_team_id:'team',team_season_id:'season',event_id:target,local_day:'2026-09-01',type:'game',status:'FINAL',conditional:0,own_side:'home',home_name:'Us',away_name:'Them',title:'Grouped game',venue:'Field',source_ids:JSON.stringify(['private-source',publicEvent.source].sort()),schedule_source_id:publicEvent.source,result_source_id:publicEvent.source});
 f.insert('team_game_associations',{app_team_id:'team',association_id:'association',private_account_id:'account',private_source_team_id:TS,private_source_event_id:'private-source',public_anchor_source_event_id:publicEvent.source,origin_team_season_id:'season',target_event_id:target,created_at:AT});
 f.insert('team_game_decision_revisions',{app_team_id:'team',association_id:'association',revision:1,authority:'matcher',decision:'accepted',team_season_id:'season',effective_day:'2026-09-01',starts_at:'2026-09-01T12:00:00Z',algorithm_version:'test',source_snapshot_revision:0,connection_snapshot_hash:H,owner_state_hash:H,semantic_hash:H,proof_hash:H,proof:'{}',created_at:AT});
 f.sqlite.exec("UPDATE team_game_associations SET head_revision=1");
 f.insert('team_game_publications',{run_id:'group-run',app_team_id:'team',team_season_id:'season',association_id:'association',decision_revision:1,target_event_id:target,disposition:'accepted',membership_hash:H,semantic_hash:H,proof_hash:H,state_scope_roots:'[]',fence_hash:H,fence:'{}',state_refs:'[]'});
 for(const [source,original,provider,account,team,attachment]of[['private-source','private','teamsnap','account',TS,'private-attachment'],[publicEvent.source,'public','gotsport',null,HOME,'attached']]){
  const row=f.sqlite.prepare('SELECT content_hash FROM source_events WHERE id=?').get(source),state=f.sqlite.prepare('SELECT input_revision FROM source_event_state WHERE source_event_id=?').get(source);
  f.insert('team_game_source_rows',{run_id:'group-run',app_team_id:'team',team_season_id:'season',target_event_id:target,source_event_id:source,association_id:'association',original_event_id:original,provider,account_id:account,account_generation:account?1:null,entitlement_kind:'legacy_attachment',attachment_id:attachment,attachment_generation:1,connected_source_team_id:team,participant_source_team_id:team,source_hash:row.content_hash,source_input_revision:state?.input_revision??0,event_link_revision:1,own_proof_hash:H});
 }
 f.sqlite.exec("UPDATE team_projection_runs SET state='published' WHERE id='group-run';UPDATE team_projection_state SET published_run_id='group-run',input_revision=1,published_input_revision=1,pending=0 WHERE team_season_id='season'");
 const now=Date.parse(AT);f.insert('security_owner',{id:1,password_salt:'test',password_hash:'test',password_iterations:600000,password_revision:1,last_password_change:AT,created_at:now,updated_at:now});f.insert('security_sessions',{token_hash:'session',password_revision:1,created_at:now,expires_at:now+86400000});
 const calls=[],sync={jobs:{async enqueuePublicHistory(specs,subscriber,{statements}){calls.push({specs,subscriber});await f.db.batch(statements);}},async wake(){}};
 const service=new PublicHistoryService(f.db,{principal:{role:'owner',session_id:'session'},requesterKey:'owner',sync,now:()=>now});
 return {...f,service,calls,target,publicEvent};
}
for(const target of ['private','public'])test('H2H request from either group constituent uses the same exact public pair: '+target,async()=>{
 const f=grouped(target);try{
  for(const ref of ['private','public','private-source',f.publicEvent.source]){
   assert.equal((await f.service.status(INPUT,ref)).supported,true);
   assert.equal((await f.service.request(INPUT,ref)).state,'active');
  }
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].specs.map(s=>[s.provider,s.component,s.scope]),[['gotsport','history','1'],['gotsport','catalog','1'],['gotsport','history','2'],['gotsport','catalog','2']]);
  const demand=f.sqlite.prepare('SELECT * FROM public_history_demands').get();assert.equal(demand.event_id,'public');assert.equal(demand.source_event_id,f.publicEvent.source);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM event_aliases').get().n,0);
  f.sqlite.exec("UPDATE team_projection_state SET published_run_id='run-season' WHERE team_season_id='season'");assert.equal(f.service.model(await f.service.saved(demand.id)).state,'revoked','an old member cannot authorize after its published group disappears');
 }finally{f.close();}
});
test('unlinked public attachment and imported public member cannot create grouped public history demand',async()=>{
 for(const change of ["UPDATE team_source_attachments SET active=0 WHERE id='attached'","UPDATE source_events SET provenance='file_import' WHERE provider='gotsport'"]){const f=grouped();try{f.sqlite.exec(change);let result;try{result=await f.service.request(INPUT,'private');}catch(error){assert.equal(error.code,'game_scope_changed');}if(result)assert.equal(result.supported,false);assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM public_history_demands').get().n,0);}finally{f.close();}}
});
