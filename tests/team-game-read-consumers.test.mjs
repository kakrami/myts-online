import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {SECURITY_SCHEMA} from '../src/security/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {FeatureReads} from '../src/read-model/feature-reads.js';
import {AnalysisReads} from '../src/analysis/reads.js';
import {CursorCodec} from '../src/read-model/cursor.js';

const AT='2026-10-01T16:00:00Z',NOW=Date.parse('2026-10-13T00:00:00Z'),HASH='f'.repeat(64),INPUT={team_id:'team',team_season_id:'season'};
function fixture({target='public-event',normalized=true,trace=false}={}) {
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const ddl of [...DOMAIN_SCHEMA,...SECURITY_SCHEMA,...SYNC_SCHEMA,...ANALYSIS_SCHEMA,...TEAM_FEATURE_SCHEMA])sql.exec(ddl);
 const insert=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
 let hook=null;
 const db={prepare(query){return {query,params:[],bind(...params){this.params=params;return this;},async all(){const results=sql.prepare(query).all(...this.params).map(r=>({...r}));if(hook)hook(query);return {results};},async first(){const row=sql.prepare(query).get(...this.params);if(hook)hook(query);return row?{...row}:null;}};},async batch(statements){const rows=[];for(const s of statements)rows.push(await s.all());return rows;}};
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
 return {sql,db,insert,player,analysis,features,target,setHook(value){hook=value;},close:()=>sql.close()};
}

for(const target of ['public-event','ts-event'])test('each saved constituent opens the same detail and contributes attendance once: '+target,async()=>{
 const f=fixture({target});try{
  f.insert('game_bookmarks',{app_team_id:'team',event_id:target==='public-event'?'ts-event':'public-event',snapshot:'{}',saved_at:AT});
  for(const ref of ['public-event','ts-event','public-source','ts-source']){
   const match=(await f.features.match(INPUT,ref)).data;
   assert.equal(match.event.id,target);assert.equal(match.event.notes,'Private ride details');assert.equal(match.event.bookmarked,true);
   assert.equal(match.attendance.totals.yes,1);assert.equal(match.attendance.players.total,1);
   assert.doesNotMatch(JSON.stringify(match),/source_members|own_proof_hash|account_generation/);
   assert.equal((await f.analysis.matchPlayer(INPUT,ref,'player')).data.event_id,target);
  }
  const summary=(await f.analysis.summary(INPUT,'player')).data;assert.equal(summary.attendance_events,1);assert.equal(summary.yes,1);assert.equal(summary.attendance_pct,100);
  const foreign=(await f.features.match({team_id:'foreign',team_season_id:'foreign-season'},'ts-event')).data;assert.equal(foreign.event.id,'ts-event');assert.equal(foreign.attendance.totals.yes,1);
  await assert.rejects(f.features.match({team_id:'foreign',team_season_id:'foreign-season'},'public-event'),e=>e.code==='not_found');
 }finally{f.close();}
});
test('duplicate aliases conflict once; missing and unknown remain distinct, with original denominator',async()=>{
 const f=fixture();try{f.player('alias','No',{alias:'player'});f.player('missing',null);f.player('unknown','Unknown');f.player('nr','NR');f.sql.exec("UPDATE source_component_coverage SET complete=0");
 const context=await f.features.featureContext(INPUT),a=await f.features.attendance(context,'ts-event');assert.equal(a.totals.conflicts,1);assert.equal(a.totals.missing,1);assert.equal(a.totals.unknown,1);assert.equal(a.totals.no_response,1);assert.equal(a.totals.total,4);
 const row=(await f.analysis.summary(INPUT,'player')).data;assert.equal(row.attendance_events,1);assert.equal(row.attendance_conflicts,1);assert.equal(row.attendance_pct,0);
 }finally{f.close();}
});
for(const mutation of ["UPDATE team_source_connections SET active=0 WHERE id='root-team-ts'","UPDATE team_connection_seasons SET excluded=1 WHERE connection_id='root-team-ts'"])test('unlink immediately hides saved private context before projection: '+mutation,async()=>{
 const f=fixture();try{f.sql.exec(mutation);await assert.rejects(f.features.match(INPUT,'public-event'),e=>e.code==='game_scope_changed');await assert.rejects(f.analysis.matchPlayer(INPUT,'ts-event','player'),e=>e.code==='game_scope_changed');assert.equal((await f.analysis.summary(INPUT,'player')).data.attendance_events,0);assert.equal((await f.analysis.player(INPUT,'player',{tab:'attendance'})).data.attendance.events.total,0);}finally{f.close();}
});
test('ordinary account disconnect keeps exact saved attendance and detail',async()=>{const f=fixture();try{f.sql.exec("UPDATE provider_accounts SET active=0,generation=generation+1 WHERE id='account'");assert.equal((await f.features.match(INPUT,'ts-source')).data.event.notes,'Private ride details');assert.equal((await f.analysis.summary(INPUT,'player')).data.attendance_pct,100);}finally{f.close();}});
test('pre-extension native run compatibility retains attendance without adding globally linked sources',async()=>{const f=fixture({normalized:false});try{assert.equal((await f.features.match(INPUT,'ts-event')).data.attendance.totals.yes,1);assert.equal((await f.analysis.summary(INPUT,'player')).data.attendance_events,1);await assert.rejects(f.features.match(INPUT,'public-event'),e=>e.code==='not_found');}finally{f.close();}});
test('read rejects an intervening published pointer change even without a content revision change',async()=>{const f=fixture();try{let changed=false;f.setHook(query=>{if(!changed&&query.includes('SELECT l.arrival_at')){changed=true;f.sql.exec("UPDATE team_projection_state SET published_run_id=NULL WHERE app_team_id='team'");}});await assert.rejects(f.features.match(INPUT,'ts-event'),e=>['game_scope_changed','cursor_restart'].includes(e.code));assert.equal(changed,true);}finally{f.close();}});
test('read rejects source removal after logistics have been read',async()=>{const f=fixture();try{let changed=false;f.setHook(query=>{if(!changed&&query.includes('SELECT l.arrival_at')){changed=true;f.sql.exec("UPDATE team_source_connections SET active=0 WHERE id='root-team-ts'");}});await assert.rejects(f.features.match(INPUT,'public-event'),e=>['game_scope_changed','cursor_restart'].includes(e.code));assert.equal(changed,true);}finally{f.close();}});
test('only pre-established published Trace membership is eligible for native reads',async()=>{const f=fixture({trace:true});try{const maps=await f.analysis.nativeMaps(INPUT,'ts-event');assert.equal(maps.data.state,'pending');assert.equal(maps.data.team_choices.length,2);const original=(await f.analysis.matchPlayer(INPUT,'public-event','player')).data;assert.equal(original.event_id,'public-event');f.sql.exec("UPDATE team_source_connections SET active=0 WHERE id='root-team-trace'");await assert.rejects(f.analysis.nativeMaps(INPUT,'public-event'),e=>e.code==='game_scope_changed');}finally{f.close();}});
function publicCompetition(f) {
 f.insert('competitions',{id:'competition',created_at:AT});f.insert('divisions',{id:'division',created_at:AT});
 f.insert('source_competitions',{id:'public-competition',provider:'live',scope:'public',native_id:'competition',name:'Public competition',kind:'league',season_year:2026,evidence:'{}',content_hash:'competition',observed_at:AT});
 f.insert('source_divisions',{id:'public-division',provider:'live',competition_id:'public-competition',name:'Division',evidence:'{}',content_hash:'division',observed_at:AT});
 f.insert('competition_source_links',{source_competition_id:'public-competition',competition_id:'competition',reason:'native',evidence:'{}'});
 f.insert('division_source_links',{source_division_id:'public-division',division_id:'division',reason:'native',evidence:'{}'});
 f.insert('source_competition_memberships',{id:'public-membership',source_team_id:'live/public/team/own',source_division_id:'public-division',evidence:'{}',content_hash:'membership',observed_at:AT});
 f.sql.exec("UPDATE source_events SET competition_key='public-competition',division_key='public-division' WHERE id='public-source';UPDATE team_event_rows SET competition_id='competition',division_id='division' WHERE app_team_id='team'");
}
test('followed and all-team competition contexts remain public and contain no private overlay',async()=>{const f=fixture();try{publicCompetition(f);f.sql.exec("UPDATE team_profiles SET kind='followed' WHERE app_team_id='team'");const dto=(await f.features.match(INPUT,'public-event')).data;assert.equal(dto.event.id,'public-event');assert.equal(dto.event.title,'Public fixture');assert.equal(dto.event.own_match,false);assert.equal(dto.event.notes,null);assert.equal(dto.attendance,null);assert.doesNotMatch(JSON.stringify(dto),/Saved private title|Private ride details/);const comp=(await f.features.competition(INPUT,'competition')).data;assert.equal(comp.events.items.length,1);assert.equal(comp.events.items[0].title,'Public fixture');const own=(await f.features.competition(INPUT,'competition',{view:'own'})).data;assert.equal(own.events.items.length,1);assert.equal(own.events.items[0].title,'Public fixture');}finally{f.close();}});
test('a globally linked Trace source absent from the pinned publication is never admitted',async()=>{const f=fixture();try{f.insert('provider_accounts',{id:'trace-account',provider:'trace',native_id:'trace-account',name:'Trace'});f.insert('source_teams',{id:'trace-team',provider:'trace',scope:'trace-account',account_id:'trace-account',native_id:'trace',name:'Us',name_authority:3,archived:0,evidence:'{}',content_hash:'trace',observed_at:AT});f.insert('team_source_attachments',{id:'trace-attachment',app_team_id:'team',team_season_id:'season',source_team_id:'trace-team',account_id:'trace-account'});f.insert('source_events',{id:'unpublished-trace',provider:'trace',scope:'trace-account',account_id:'trace-account',native_id:'trace',starts_at:AT,time_precision:'instant',type:'game',status:'FINAL',conditional:0,home_source_team_id:'trace-team',home_label:'Us',away_label:'Them',title:'Trace',venue:'Field',evidence:'{}',content_hash:'trace',observed_at:AT});f.insert('source_event_teams',{source_team_id:'trace-team',source_event_id:'unpublished-trace',side:'home'});f.insert('event_source_links',{source_event_id:'unpublished-trace',event_id:'public-event',reason:'owner',evidence:'{}'});const dto=(await f.analysis.nativeMaps(INPUT,'ts-event')).data;assert.equal(dto.state,'unsupported');assert.equal(dto.maps.length,0);assert.equal((await f.features.match(INPUT,'ts-event')).data.attendance.totals.yes,1);}finally{f.close();}});
function savedAnalysis(f,{source='retired-trace',minutes=75}={}) {
 f.sql.exec("UPDATE team_event_rows SET status='FINAL' WHERE app_team_id='team'");
 f.insert('match_analysis',{app_team_id:'team',team_season_id:'season',event_id:f.target,active_run:'analysis-run',state:'ready',source_event_id:source,source_team_id:source?'retired-team':null,source_revision:1,mutation_revision:1,projected_at:AT,player_count:1,unresolved_goals:0,unresolved_assists:0,tracking_complete:0,over_capacity:0,evidence:'{}',input_hash:'old'});
 f.insert('player_match_analysis',{run_id:'analysis-run',app_team_id:'team',team_season_id:'season',event_id:f.target,player_id:'player',appearance:minutes?1:0,minutes,minutes_state:source?'published':'manual',goals_state:'pending',assists_state:'pending',position_state:'pending',native_state:'ready',tracking_state:'pending',source_ids:JSON.stringify(source?[source]:[]),evidence:'{}'});
}
test('retired native analysis is hidden while source-null manual zero and saved owner lineups remain valid',async()=>{
 for(const source of ['retired-trace',null]){const f=fixture();try{savedAnalysis(f,{source,minutes:source?75:0});const match=(await f.analysis.match(INPUT,'ts-event')).data,player=(await f.analysis.matchPlayer(INPUT,'ts-event','player')).data,summary=(await f.analysis.summary(INPUT,'player')).data;if(source){assert.equal(match.state,'pending');assert.deepEqual(match.players,[]);assert.equal(player.stats,null);assert.equal(summary.analyzed_matches,0);}else{assert.equal(match.players[0].minutes,0);assert.equal(player.stats.minutes,0);assert.equal(summary.minutes,0);}}finally{f.close();}}
});
test('cross-account player response cannot enter the grouped attendance cell',async()=>{const f=fixture();try{f.insert('provider_accounts',{id:'other-account',provider:'teamsnap',native_id:'other-account',name:'Other'});f.player('wrong-player','No',{alias:'player',account:'other-account'});const a=await f.features.attendance(await f.features.featureContext(INPUT),'public-event');assert.equal(a.totals.yes,1);assert.equal(a.totals.conflicts,0);}finally{f.close();}});
test('analysis read rechecks pointer after native context selection',async()=>{const f=fixture({trace:true});try{let changed=false;f.setHook(query=>{if(!changed&&query.includes("m.provider='trace'")){changed=true;f.sql.exec("UPDATE team_projection_state SET published_run_id=NULL WHERE app_team_id='team'");}});await assert.rejects(f.analysis.nativeMaps(INPUT,'ts-event'),e=>e.code==='cursor_restart');assert.equal(changed,true);}finally{f.close();}});

for(const target of ['public-event','ts-event'])test('historical public detail uses a published public anchor without gaining private state: '+target,async()=>{const f=fixture({target});try{publicCompetition(f);f.insert('source_teams',{id:'live/public/team/opponent',provider:'live',scope:'public',native_id:'opponent',name:'Them',name_authority:3,archived:0,evidence:'{}',content_hash:'opponent',observed_at:AT});f.sql.exec("UPDATE source_events SET away_source_team_id='live/public/team/opponent' WHERE id='public-source'");f.insert('source_event_teams',{source_team_id:'live/public/team/opponent',source_event_id:'public-source',side:'away'});const dto=(await f.features.match(INPUT,'public-event',{h2h_anchor:target})).data;assert.equal(dto.event.id,'public-event');assert.equal(dto.event.title,'Public fixture');assert.equal(dto.event.own_match,false);assert.equal(dto.event.notes,null);assert.equal(dto.attendance,null);assert.equal(dto.event.historical_context.anchor_event_id,target);assert.doesNotMatch(JSON.stringify(dto),/Private ride details|Saved private title/);}finally{f.close();}});
test('derived native analysis must match the published participant, not merely the same source event',async()=>{const f=fixture({trace:true});try{f.insert('source_teams',{id:'trace-opponent',provider:'trace',scope:'trace-account',account_id:'trace-account',native_id:'trace-opponent',name:'Them',name_authority:3,archived:0,evidence:'{}',content_hash:'opponent',observed_at:AT});f.insert('source_event_teams',{source_team_id:'trace-opponent',source_event_id:'trace-source',side:'away'});savedAnalysis(f,{source:'trace-source'});f.sql.exec("UPDATE match_analysis SET source_team_id='trace-opponent'");assert.equal((await f.analysis.matchPlayer(INPUT,'ts-event','player')).data.stats,null);f.sql.exec("UPDATE match_analysis SET source_team_id='trace-team'");assert.equal((await f.analysis.matchPlayer(INPUT,'ts-event','player')).data.stats.minutes,75);}finally{f.close();}});
test('attendance paging refuses responses changed between aggregate and page rows',async()=>{const f=fixture();try{const context=await f.features.featureContext(INPUT);let changed=false;f.setHook(query=>{if(!changed&&query.includes("count(*) AS total,sum(response_label='Yes')")){changed=true;f.sql.exec("UPDATE source_attendance SET status='No'");}});await assert.rejects(f.features.attendance(context,'ts-event'),e=>e.code==='cursor_restart');assert.equal(changed,true);}finally{f.close();}});
