import {analysisFixture} from './shared-analysis-fixture.mjs';
const AT='2026-10-12T12:00:00Z',H='a'.repeat(64);
// Real normalized storage constraints; grouping proof itself is supplied by the
// independently tested publisher. Trace is already linked to the private native
// target, never newly inferred by this fixture or the analysis consumer.
export function publishedAnalysisFixture({target='event'}={}){
 const f=analysisFixture(),{sqlite,insert}=f;
 insert('provider_accounts',{id:'ts-account',provider:'teamsnap',native_id:'2',name:'TeamSnap'});
 for(const [prefix,provider,account,event]of [['private','teamsnap','ts-account','event'],['public','live',null,'public-event']]){
  insert('source_teams',{id:prefix+'-team',provider,scope:account||'public',account_id:account,native_id:prefix,name:'Us',name_authority:3,archived:0,evidence:'{}',content_hash:'team',observed_at:AT});
  insert('team_source_attachments',{id:prefix+'-attachment',app_team_id:'team',team_season_id:'season',source_team_id:prefix+'-team',account_id:account});
  insert('team_source_connections',{id:prefix+'-root',app_team_id:'team',source_team_id:prefix+'-team',account_id:account,scope_mode:'observed_history',created_at:AT});
  insert('team_connection_seasons',{connection_id:prefix+'-root',team_season_id:'season',attachment_id:prefix+'-attachment',basis:'events'});
  if(event!=='event')insert('events',{id:event,created_at:AT});
  insert('source_events',{id:prefix+'-source',provider,scope:account||'public',account_id:account,native_id:prefix,local_day:'2026-09-01',time_precision:'day',type:'game',status:'FINAL',conditional:0,home_source_team_id:prefix+'-team',home_label:'Us',away_label:'Them',home_score:0,away_score:0,title:'Game',venue:'Field',evidence:'{}',content_hash:'event',observed_at:AT});
  insert('source_event_teams',{source_team_id:prefix+'-team',source_event_id:prefix+'-source',side:'home'});
  insert('event_source_links',{source_event_id:prefix+'-source',event_id:event,reason:'native',evidence:'{}'});
 }
 insert('team_game_associations',{app_team_id:'team',association_id:'association',private_account_id:'ts-account',private_source_team_id:'private-team',private_source_event_id:'private-source',public_anchor_source_event_id:'public-source',origin_team_season_id:'season',target_event_id:target,created_at:AT});
 insert('team_game_decision_revisions',{app_team_id:'team',association_id:'association',revision:1,authority:'matcher',decision:'accepted',team_season_id:'season',effective_day:'2026-09-01',starts_at:'2026-09-01T12:00:00Z',algorithm_version:'fixture',source_snapshot_revision:0,connection_snapshot_hash:H,owner_state_hash:H,semantic_hash:H,proof_hash:H,proof:'{}',created_at:AT});
 sqlite.exec("UPDATE team_game_associations SET head_revision=1");
 const publish=({id='grouped-run',grouped=true,proofHash=H}={})=>{
  insert('team_projection_runs',{id,app_team_id:'team',team_season_id:'season',input_revision:1,state:'building',created_at:AT,team_game_version:1});
  const old=sqlite.prepare("SELECT * FROM team_event_rows WHERE run_id='team-run'").get(),sources=grouped?['source-event','private-source','public-source']:['source-event','private-source'];
  insert('team_event_rows',{...old,run_id:id,event_id:grouped?target:old.event_id,source_ids:JSON.stringify(sources)});
  if(!grouped)insert('team_event_rows',{...old,run_id:id,event_id:'public-event',source_ids:'["public-source"]',schedule_source_id:'public-source',result_source_id:'public-source'});
  for(const row of sqlite.prepare("SELECT * FROM team_player_rows WHERE run_id='team-run'").all())insert('team_player_rows',{...row,run_id:id});
  if(grouped)insert('team_game_publications',{run_id:id,app_team_id:'team',team_season_id:'season',association_id:'association',decision_revision:1,target_event_id:target,disposition:'accepted',membership_hash:H,semantic_hash:H,proof_hash:proofHash,state_scope_roots:'[]',fence_hash:H,fence:'{}',state_refs:'[]'});
  for(const [source,team,root,attachment,original] of [['source-event','source-team','root','attachment','event'],['private-source','private-team','private-root','private-attachment','event'],['public-source','public-team','public-root','public-attachment','public-event']]){
   const s=sqlite.prepare('SELECT * FROM source_events WHERE id=?').get(source),r=sqlite.prepare('SELECT * FROM team_source_connections WHERE id=?').get(root),m=sqlite.prepare('SELECT * FROM team_connection_seasons WHERE connection_id=?').get(root),a=sqlite.prepare('SELECT * FROM team_source_attachments WHERE id=?').get(attachment),link=sqlite.prepare('SELECT * FROM event_source_links WHERE source_event_id=?').get(source),state=sqlite.prepare('SELECT * FROM source_event_state WHERE source_event_id=?').get(source),account=s.account_id?sqlite.prepare('SELECT * FROM provider_accounts WHERE id=?').get(s.account_id):null;
   insert('team_game_source_rows',{run_id:id,app_team_id:'team',team_season_id:'season',target_event_id:grouped?target:source==='public-source'?'public-event':'event',source_event_id:source,association_id:grouped&&source!=='source-event'?'association':null,original_event_id:original,provider:s.provider,account_id:s.account_id,account_generation:account?.generation??null,entitlement_kind:'root',connection_id:root,connection_generation:r.generation,connection_input_revision:r.input_revision,membership_generation:m.generation,attachment_id:attachment,attachment_generation:a.generation,connected_source_team_id:team,participant_source_team_id:team,source_hash:s.content_hash,source_input_revision:state?.input_revision??0,event_link_revision:link.revision,own_proof_hash:H});
  }
  sqlite.prepare("UPDATE team_projection_runs SET state='published' WHERE id=?").run(id);
  sqlite.prepare('UPDATE team_projection_state SET published_run_id=?,pending=0,published_input_revision=input_revision').run(id);
  sqlite.exec('UPDATE team_read_state SET pending=0');
 };
 publish();
 return {...f,publish};
}
