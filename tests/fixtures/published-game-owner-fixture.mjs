import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../../src/domain/schema.js';
import {SYNC_SCHEMA} from '../../src/sync/schema.js';
import {SECURITY_SCHEMA} from '../../src/security/schema.js';
import {ANALYSIS_SCHEMA} from '../../src/analysis/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../../src/application/team-features.js';
import {FeatureReads} from '../../src/read-model/feature-reads.js';
import {AnalysisReads} from '../../src/analysis/reads.js';
import {CursorCodec} from '../../src/read-model/cursor.js';

import {COACH_SCHEMA} from '../../src/coaching/schema.js';
const AT='2026-10-01T16:00:00Z',NOW=Date.parse('2026-10-13T00:00:00Z'),HASH='f'.repeat(64),INPUT={team_id:'team',team_season_id:'season'};
export function publishedOwnerFixture({target='public-event',normalized=true,trace=false}={}) {
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const ddl of [...DOMAIN_SCHEMA,...SECURITY_SCHEMA,...SYNC_SCHEMA,...ANALYSIS_SCHEMA,...TEAM_FEATURE_SCHEMA,...COACH_SCHEMA])sql.exec(ddl);
 const insert=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
 let hook=null,beforeBatch=null,queries=0,maxBatch=0;
 const db={prepare(query){return {query,params:[],bind(...params){this.params=params;return this;},async all(){queries++;const results=sql.prepare(query).all(...this.params).map(r=>({...r}));if(hook)hook(query);return {results,meta:{changes:sql.prepare('SELECT changes() n').get().n}};},async first(){queries++;const row=sql.prepare(query).get(...this.params);if(hook)hook(query);return row?{...row}:null;}};},async batch(statements){maxBatch=Math.max(maxBatch,statements.length);if(beforeBatch){const f=beforeBatch;beforeBatch=null;f();}sql.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.all());sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 insert('domain_installation',{id:1,schema_version:1,created_at:AT});
 insert('app_clubs',{id:'club',name:'Club'});
 for(const [team,season]of [['team','season'],['foreign','foreign-season']]){
  insert('app_teams',{id:team,name:team,timezone:'UTC',season_year:2026,created_at:AT});
  insert('team_profiles',{app_team_id:team,club_id:'club',kind:'own'});
  insert('team_seasons',{id:season,app_team_id:team,year:2026,start_day:'2026-06-01',end_day:'2027-06-01',start_at:'2026-06-01T00:00:00Z',end_at:'2027-06-01T00:00:00Z'});
  insert('team_read_state',{app_team_id:team,content_revision:3});
  insert('team_projection_runs',{id:'run-'+team,app_team_id:team,team_season_id:season,input_revision:1,state:'building',created_at:AT,team_game_version:team==='team'&&normalized?1:0});
  insert('team_projection_state',{app_team_id:team,team_season_id:season,input_revision:1});
 }
 const providers=[['ts','teamsnap','account'],['public','live',null],...(trace?[['trace','trace','trace-account']]:[])];
 for(const [key,provider,account]of providers){
  if(account)insert('provider_accounts',{id:account,provider,native_id:account,name:account});
  const sourceTeam=key==='public'?'live/public/team/own':key+'-team';
  insert('source_teams',{id:sourceTeam,provider,scope:account??'public',account_id:account,native_id:key,name:'Us',name_authority:3,archived:0,evidence:'{}',content_hash:key,observed_at:AT});
  for(const [team,season]of [['team','season'],['foreign','foreign-season']]){
   if(team==='foreign'&&key!=='ts')continue;
   insert('team_source_attachments',{id:team+'-'+key,app_team_id:team,team_season_id:season,source_team_id:sourceTeam,account_id:account});
   insert('team_source_connections',{id:'root-'+team+'-'+key,app_team_id:team,source_team_id:sourceTeam,account_id:account,scope_mode:'observed_history',created_at:AT});
   insert('team_connection_seasons',{connection_id:'root-'+team+'-'+key,team_season_id:season,attachment_id:team+'-'+key,basis:'events'});
  }
  const canonical=key==='trace'?target:key+'-event';
  if(key!=='trace')insert('events',{id:canonical,created_at:AT});
  insert('source_events',{id:key+'-source',provider,scope:account??'public',account_id:account,native_id:key+'-source',starts_at:AT,local_day:'2026-10-01',time_precision:'instant',type:'game',status:'SCHEDULED',conditional:0,home_source_team_id:sourceTeam,home_label:'Us',away_label:'Them',title:key==='public'?'Public fixture':'Private fixture',venue:'Field',evidence:'{}',content_hash:key,observed_at:AT});
  insert('source_event_teams',{source_team_id:sourceTeam,source_event_id:key+'-source',side:'home'});
  insert('event_source_links',{source_event_id:key+'-source',event_id:canonical,reason:'native',evidence:'{}'});
 }
 insert('source_event_logistics',{source_event_id:'ts-source',source_team_id:'ts-team',account_id:'account',notes:'Private ride details',uniform:'Blue',availability_enabled:1,content_hash:'logistics',observed_at:AT});
 insert('source_component_coverage',{id:'coverage',provider:'teamsnap',scope:'teamsnap:ts',account_id:'account',kind:'attendance',complete:1,record_count:1,scan_id:'scan',observed_at:AT});
 const row=(team,season,eventId,sources)=>insert('team_event_rows',{run_id:'run-'+team,app_team_id:team,team_season_id:season,event_id:eventId,starts_at:AT,local_day:'2026-10-01',type:'game',status:'SCHEDULED',conditional:0,own_side:'home',home_name:'Us',away_name:'Them',title:team==='team'?'Saved private title':'Foreign native',venue:'Field',source_ids:JSON.stringify(sources),schedule_source_id:sources.includes('public-source')?'public-source':'ts-source',result_source_id:sources.includes('public-source')?'public-source':'ts-source'});
 const sources=normalized?providers.map(([key])=>key+'-source'):['ts-source'];if(!normalized)target='ts-event';
 row('team','season',target,sources);row('foreign','foreign-season','ts-event',['ts-source']);
 function player(id='player',status='Yes',{alias=null,account='account'}={}){
  if(!alias)insert('players',{id,created_at:AT});
  insert('source_players',{id:'source-'+id,provider:'teamsnap',scope:account,account_id:account,native_id:id,name:id,evidence:'{}',content_hash:id,observed_at:AT});
  insert('player_source_links',{source_player_id:'source-'+id,player_id:alias??id,reason:'native',evidence:'{}'});
  if(!alias)for(const [team,season]of [['team','season'],['foreign','foreign-season']])insert('team_player_rows',{run_id:'run-'+team,app_team_id:team,team_season_id:season,player_id:id,name:id,source_ids:JSON.stringify(['source-'+id])});
  if(status)insert('source_attendance',{id:'response-'+id,account_id:account,source_team_id:'ts-team',source_event_id:'ts-source',source_player_id:'source-'+id,status,content_hash:status,observed_at:AT});
 }
 player();
 if(normalized){
  insert('team_game_associations',{app_team_id:'team',association_id:'association',private_account_id:'account',private_source_team_id:'ts-team',private_source_event_id:'ts-source',public_anchor_source_event_id:'public-source',origin_team_season_id:'season',target_event_id:target,created_at:AT});
  insert('team_game_decision_revisions',{app_team_id:'team',association_id:'association',revision:1,authority:'matcher',decision:'accepted',team_season_id:'season',effective_day:'2026-10-01',starts_at:AT,algorithm_version:'test',source_snapshot_revision:0,connection_snapshot_hash:HASH,owner_state_hash:HASH,semantic_hash:HASH,proof_hash:HASH,proof:'{}',created_at:AT});
  sql.exec("UPDATE team_game_associations SET head_revision=1");
  insert('team_game_publications',{run_id:'run-team',app_team_id:'team',team_season_id:'season',association_id:'association',decision_revision:1,target_event_id:target,disposition:'accepted',membership_hash:HASH,semantic_hash:HASH,proof_hash:HASH,state_scope_roots:'[]',fence_hash:HASH,fence:'{}',state_refs:'[]'});
  for(const [key,provider,account]of providers){
   const connection=sql.prepare('SELECT * FROM team_source_connections WHERE id=?').get('root-team-'+key),source=sql.prepare('SELECT * FROM source_events WHERE id=?').get(key+'-source'),revision=sql.prepare('SELECT input_revision FROM source_event_state WHERE source_event_id=?').get(source.id)?.input_revision??0;
   insert('team_game_source_rows',{run_id:'run-team',app_team_id:'team',team_season_id:'season',target_event_id:target,source_event_id:source.id,association_id:key==='trace'?null:'association',original_event_id:key==='trace'?target:key+'-event',provider,account_id:account,account_generation:account?1:null,entitlement_kind:'root',connection_id:connection.id,connection_generation:connection.generation,connection_input_revision:connection.input_revision,membership_generation:1,attachment_id:'team-'+key,attachment_generation:1,connected_source_team_id:connection.source_team_id,participant_source_team_id:connection.source_team_id,source_hash:source.content_hash,source_input_revision:revision,event_link_revision:1,own_proof_hash:HASH});
  }
 }
 sql.exec("UPDATE team_projection_runs SET state='published';UPDATE team_projection_state SET published_run_id='run-'||app_team_id,published_input_revision=input_revision,pending=0;UPDATE team_read_state SET pending=0");
 const options={cursor:new CursorCodec(new Uint8Array(32).fill(9)),now:()=>NOW},analysis=new AnalysisReads(db,{owner:true},options),features=new FeatureReads(db,{owner:true},{...options,analysisReads:analysis});
 return {sql,db,insert,player,analysis,features,target,setHook(value){hook=value;},beforeBatch(value){beforeBatch=value;},queries:()=>queries,maxBatch:()=>maxBatch,close:()=>sql.close()};
}

