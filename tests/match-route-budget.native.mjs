import test from 'node:test';
import assert from 'node:assert/strict';
import {materializationHarness} from './fixtures/connection-materialization-harness.mjs';
import {digest} from '../src/security/crypto.js';
const AT='2026-10-12T12:00:00Z';
test('assembled owner match route fits HTTP budget with analysis, roster, attendance, competition and H2H pages',async()=>{
 const h=await materializationHarness();
 const add=async(table,row)=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row)).run();
 try{
  await h.initialize();
  await add('app_teams',{id:'budget-team',name:'Budget team',timezone:'UTC',season_year:2026,created_at:AT});
  await add('team_read_state',{app_team_id:'budget-team',content_revision:1,status_revision:1});
  await add('team_seasons',{id:'budget-season',app_team_id:'budget-team',year:2026,start_day:'2026-06-01',end_day:'2027-06-01',start_at:'2026-06-01T00:00:00Z',end_at:'2027-06-01T00:00:00Z',include_june:0});
  await add('team_projection_runs',{id:'budget-run',app_team_id:'budget-team',team_season_id:'budget-season',input_revision:1,state:'published',created_at:AT});
  await add('team_projection_state',{team_season_id:'budget-season',app_team_id:'budget-team',published_run_id:'budget-run',published_input_revision:1,input_revision:1,pending:0});
  await add('app_clubs',{id:'budget-club',name:'Club'});await add('team_profiles',{app_team_id:'budget-team',club_id:'budget-club',kind:'own'});
  for(const id of ['1','2'])await add('source_teams',{id:'gotsport/public/'+id,provider:'gotsport',scope:'public',native_id:id,name:id==='1'?'Home':'Away',name_authority:1,archived:0,evidence:'{}',content_hash:'team',observed_at:AT});
  await add('team_source_attachments',{id:'budget-attached',app_team_id:'budget-team',team_season_id:'budget-season',source_team_id:'gotsport/public/1'});
  await add('source_competitions',{id:'budget-native-cup',provider:'gotsport',scope:'public',native_id:'cup',name:'Cup',kind:'tournament',evidence:'{}',content_hash:'cup',observed_at:AT});
  await add('competitions',{id:'budget-cup',created_at:AT});await add('competition_source_links',{source_competition_id:'budget-native-cup',competition_id:'budget-cup',reason:'native',evidence:'{}'});
  for(const [id,day,status] of [['match','2026-08-01','FINAL'],['past2','2026-07-01','FINAL'],['past3','2025-07-01','FINAL'],['next1','2027-01-01','SCHEDULED'],['next2','2027-02-01','SCHEDULED']]){
   const source='gotsport/public/'+id;await add('events',{id,created_at:AT});
   await add('source_events',{id:source,provider:'gotsport',scope:'public',native_id:id,competition_key:'budget-native-cup',local_day:day,time_precision:'day',type:'game',status,conditional:0,home_source_team_id:'gotsport/public/1',away_source_team_id:'gotsport/public/2',home_label:'Home',away_label:'Away',home_score:status==='FINAL'?2:null,away_score:status==='FINAL'?1:null,title:id,venue:'Field',evidence:'{}',content_hash:id,observed_at:AT});
   await add('source_event_teams',{source_team_id:'gotsport/public/1',source_event_id:source,side:'home'});await add('event_source_links',{source_event_id:source,event_id:id,reason:'native',evidence:'{}',revision:1});
   if(id==='match')await add('team_event_rows',{run_id:'budget-run',app_team_id:'budget-team',team_season_id:'budget-season',event_id:id,competition_id:'budget-cup',local_day:day,type:'game',status,conditional:0,own_side:'home',home_name:'Home',away_name:'Away',home_score:2,away_score:1,goals_for:2,goals_against:1,title:id,venue:'Field',source_ids:JSON.stringify([source]),schedule_source_id:source,result_source_id:source});
  }
  await add('players',{id:'budget-player',created_at:AT});await add('team_player_rows',{run_id:'budget-run',app_team_id:'budget-team',team_season_id:'budget-season',player_id:'budget-player',name:'Player',jersey:'7',source_ids:'[]'});
  await add('match_analysis',{app_team_id:'budget-team',team_season_id:'budget-season',event_id:'match',active_run:'budget-analysis',state:'ready',source_revision:1,mutation_revision:1,projected_at:AT,player_count:1,unresolved_goals:0,unresolved_assists:0,tracking_complete:1,duration_minutes:50,format:7,assigned_minutes:50,capacity_minutes:350,over_capacity:0,evidence:'{}',input_hash:'budget'});
  await add('player_match_analysis',{run_id:'budget-analysis',app_team_id:'budget-team',team_season_id:'budget-season',event_id:'match',player_id:'budget-player',appearance:1,started:1,minutes:50,field_minutes:50,gk_minutes:0,goals:2,assists:0,minutes_state:'published',goals_state:'published',assists_state:'published',position_state:'published',native_state:'ready',tracking_state:'complete',source_ids:'[]',evidence:'{}'});
  const query=new URLSearchParams({team_id:'budget-team',team_season_id:'budget-season',tab:'h2h',limit:'1',h2h_upcoming_limit:'1'}),first=await h.request('/api/matches/match?'+query);
  assert.equal(first.status,200,JSON.stringify(first.data));assert.ok(first.statements<=48);assert.ok(first.data.data.lineup);assert.ok(first.data.data.attendance);assert.equal(first.data.data.event.competition_name,'Cup');assert.equal(first.data.data.players.total,1);
  assert.equal(first.data.data.h2h.events.total,3);assert.equal(first.data.data.h2h.upcoming.total,2);const initial=first.data.data.h2h.events.items[0].id;
  query.set('h2h_cursor',first.data.data.h2h.events.next_cursor);const second=await h.request('/api/matches/match?'+query);assert.equal(second.status,200,JSON.stringify(second.data));assert.notEqual(second.data.data.h2h.events.items[0].id,initial);assert.ok(second.statements<=48);
  query.delete('h2h_cursor');query.set('h2h_upcoming_cursor',first.data.data.h2h.upcoming.next_cursor);const upcoming=await h.request('/api/matches/match?'+query);assert.equal(upcoming.status,200,JSON.stringify(upcoming.data));assert.notEqual(upcoming.data.data.h2h.upcoming.items[0].id,first.data.data.h2h.upcoming.items[0].id);assert.ok(upcoming.statements<=48);
  const token='v'.repeat(43),tokenHash=await digest(token),now=Date.now();
  await add('security_viewer_tokens',{token_hash:tokenHash,team_id:'budget-team',categories:'["matches"]',created_at:now,expires_at:now+3600000,encrypted_token:'synthetic-unused'});
  const scope='?team_id=budget-team&team_season_id=budget-season',headers={'x-view-key':token};
  const denied=await h.request('/api/matches/match/h2h/refresh'+scope,{method:'POST',body:{force:false},headers:{...headers,Origin:'https://unrelated.invalid'}});assert.equal(denied.status,403);
  const requested=await h.request('/api/matches/match/h2h/refresh'+scope,{method:'POST',body:{force:false},headers});assert.equal(requested.status,202,JSON.stringify(requested.data));assert.equal(requested.data.supported,true);assert.equal(requested.data.history_complete,false);assert.ok(requested.statements<=48);
  const status=await h.request('/api/matches/match/h2h/history'+scope,{headers});assert.equal(status.status,200,JSON.stringify(status.data));assert.ok(status.statements<=48);
  await h.db.prepare('UPDATE security_viewer_tokens SET revoked_at=? WHERE token_hash=?').bind(now,tokenHash).run();
  const revoked=await h.request('/api/matches/match/h2h/history'+scope,{headers});assert.equal(revoked.status,401);
  console.log(JSON.stringify({viewer_public_history_http_statement_counts:[requested.statements,status.statements],revoked_status:revoked.status,cross_origin_status:denied.status}));
  console.log(JSON.stringify({match_http_statement_counts:[first.statements,second.statements,upcoming.statements],read_only_inspection_retries:h.inspectionRetries}));
 }finally{await h.dispose();}
});
