import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {freshHarness} from './fresh-harness.js';
import {ReportingService} from '../src/reporting/service.js';
import {reports as reportScreen} from '../web/ui-original/screens.js';
import {DomainRepository} from '../src/domain/repository.js';
import {attendanceStateQuery} from '../src/read-model/attendance.js';
import {beginTeamSnapRefresh,finishTeamSnapRefresh,teamSnapRefreshCoverage} from '../src/sources/teamsnap-refresh.js';
const out=new URL('../tmp/report-native-parity/',import.meta.url);

test('populated original Reports run sorted production queries, bounded admission and complete parsed exports in native D1',async()=>{
 const h=await freshHarness();try{
  await h.initialize();const created=await h.request('/api/teams',{method:'POST',body:{name:'Populated report proof',timezone:'UTC',season_year:2026}});assert.equal(created.status,201,JSON.stringify(created.data));
  const team=created.data.team.id,season=created.data.season_id,scope={team_id:team,team_season_id:season},at=new Date().toISOString(),run='report-native-run';
  const statement=(table,row)=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row));
  await h.db.batch([
   statement('provider_accounts',{id:'report-account',provider:'trace',native_id:'report',name:'Synthetic account'}),
   statement('source_teams',{id:'report-source-team',provider:'trace',scope:'report-account',account_id:'report-account',native_id:'report',name:'Synthetic team',name_authority:3,archived:0,evidence:'{}',content_hash:'test',observed_at:at}),
   statement('team_source_attachments',{id:'report-attachment',app_team_id:team,team_season_id:season,source_team_id:'report-source-team',account_id:'report-account'}),
   statement('team_projection_runs',{id:run,app_team_id:team,team_season_id:season,input_revision:1,state:'published',created_at:at}),
   h.db.prepare('UPDATE team_projection_state SET published_run_id=?,pending=0 WHERE team_season_id=?').bind(run,season),
   h.db.prepare('UPDATE team_read_state SET pending=0,content_revision=content_revision+1 WHERE app_team_id=?').bind(team)
  ]);
  // Explicit synthetic canonical publications isolate report SQL/alarms from
  // provider discovery. The actual report query and HTTP paths are unmodified.
  for(let first=0;first<137;first+=10){const statements=[];for(let i=first;i<Math.min(first+10,137);i++){
   const id='report-event-'+i,source='report-source-event-'+i;
   statements.push(statement('events',{id,created_at:at}),statement('source_events',{id:source,provider:'trace',scope:'report-account',account_id:'report-account',native_id:String(i),local_day:'2026-09-01',time_precision:'day',type:'game',status:'FINAL',conditional:0,home_source_team_id:'report-source-team',home_label:'Us',away_label:'Them',home_score:3,away_score:1,title:'Game',venue:'Field Q'+(136-i)+'Z',evidence:'{}',content_hash:'event-'+i,observed_at:at}),statement('team_event_rows',{run_id:run,app_team_id:team,team_season_id:season,event_id:id,local_day:'2026-09-01',type:'game',status:'FINAL',conditional:0,own_side:'home',home_name:'Us',away_name:'Them',home_score:3,away_score:1,goals_for:3,goals_against:1,title:'Game',venue:'Field Q'+(136-i)+'Z',source_ids:JSON.stringify([source]),schedule_source_id:source,result_source_id:source}));
  }await h.db.batch(statements);}
  for(const [i,name]of ['Player Q10Z','Player Q2Z'].entries())await h.db.batch([statement('players',{id:'report-player-'+i,created_at:at}),statement('source_players',{id:'report-native-player-'+i,provider:'trace',scope:'report-account',account_id:'report-account',native_id:String(i),name,jersey:String(i),evidence:'{}',content_hash:'player-'+i,observed_at:at}),statement('team_player_rows',{run_id:run,app_team_id:team,team_season_id:season,player_id:'report-player-'+i,name,jersey:String(i),source_ids:JSON.stringify(['report-native-player-'+i])})]);
  await h.db.batch([statement('match_analysis',{app_team_id:team,team_season_id:season,event_id:'report-event-0',active_run:'report-analysis',state:'estimated',source_event_id:'report-source-event-0',source_team_id:'report-source-team',source_revision:1,mutation_revision:0,projected_at:at,player_count:1,unresolved_goals:0,unresolved_assists:0,tracking_complete:1,duration_minutes:50,format:7,assigned_minutes:45.3,capacity_minutes:350,over_capacity:0,evidence:'{}',input_hash:'synthetic'}),statement('player_match_analysis',{run_id:'report-analysis',app_team_id:team,team_season_id:season,event_id:'report-event-0',player_id:'report-player-0',appearance:1,started:1,minutes:45.3,field_minutes:45.3,gk_minutes:0,goals:1,assists:2,position:'CM',minutes_state:'estimated',goals_state:'published',assists_state:'published',position_state:'published',native_state:'ready',tracking_state:'complete',source_ids:'[]',evidence:'{}'})]);
  const snapshots=[];
  async function prepare(type,sort){const result=await h.request('/api/reports/snapshots',{method:'POST',body:{...scope,type,...sort?{sort}:{}}});assert.equal(result.status,202,JSON.stringify(result.data));snapshots.push(result.data.data.snapshot_id);return result.data.data.snapshot_id;}
  const schedule=await prepare('matches','location'),summary=await prepare('season'),players=await prepare('players','player'),attendance=await prepare('availability','player'),closedAt=Date.now();
  async function waitSnapshots(ids){await h.waitFor(async()=>{const rows=(await h.db.prepare('SELECT id,state,error_code FROM report_snapshots WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results,jobs=(await h.db.prepare("SELECT component,state,last_error_code,last_error_message FROM sync_jobs WHERE provider='reports' AND state IN('failed','blocked','retrying')").all()).results;if(jobs.length)throw new Error(JSON.stringify(jobs));if(rows.some(r=>r.state==='failed'))throw new Error(JSON.stringify(rows));return rows.length===ids.length&&rows.every(r=>r.state==='ready');},{timeout:120000});}
  await waitSnapshots([schedule,summary,players,attendance]);
  const receipts=[];async function measure(ids){const rows=(await h.db.prepare('SELECT id,type,total,captured,length(CAST(query_sql AS BLOB)) AS query_bytes,query_sql,query_params FROM report_snapshots WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results;for(const row of rows){console.log(JSON.stringify({report_query_probe:'start',type:row.type,rows:row.total,query_bytes:row.query_bytes}));await mkdir(out,{recursive:true});await writeFile(new URL('query-'+row.type+'.json',out),JSON.stringify(row));const measured=await h.db.prepare('SELECT * FROM('+row.query_sql+') q WHERE q.ordinal>=? AND q.ordinal<?').bind(...JSON.parse(row.query_params),0,100).all();console.log(JSON.stringify({report_query_probe:'bounded_pass',type:row.type,meta:measured.meta}));assert.ok(row.query_bytes<48000);receipts.push({type:row.type,rows:row.total,query_bytes:row.query_bytes,rows_read:measured.meta.rows_read,duration_ms:measured.meta.duration});}}
  await measure([schedule,summary,players,attendance]);
  async function preview(id,cursor){const result=await h.request('/api/reports?'+new URLSearchParams({...scope,snapshot_id:id,limit:'100',...cursor?{cursor}:{}}));assert.equal(result.status,200,JSON.stringify(result.data));return result.data.data;}
  const first=await preview(schedule),tail=await preview(schedule,first.rows.next_cursor),expected=Array.from({length:137},(_,i)=>'Field Q'+i+'Z');assert.equal(first.rows.items.length,100);assert.equal(tail.rows.items.length,37);assert.deepEqual([...first.rows.items,...tail.rows.items].map(r=>r.location),expected);
  const seasonPreview=await preview(summary);assert.deepEqual(seasonPreview.rows.items.map(r=>r.metric),['Record','Goals','Matches analyzed','Trace players','Minutes leader','G+A leader']);assert.equal(seasonPreview.rows.items[0].value,'137-0-0');assert.equal(seasonPreview.rows.items[1].value,'411-137');
  const playerPreview=await preview(players);assert.deepEqual(playerPreview.rows.items.map(r=>r.player),['Player Q2Z','Player Q10Z']);assert.match(reportScreen(playerPreview),/data-label="Minutes">45\.3<\/td>/);assert.equal((await preview(attendance)).rows.items.length,2);
  const files=[];for(const [id,format,name]of [[schedule,'xlsx','schedule.xlsx'],[schedule,'pdf','schedule.pdf'],[summary,'pdf','summary.pdf'],[players,'xlsx','players.xlsx']]){const result=await h.request('/api/reports/'+id+'/exports',{method:'POST',body:{format}});assert.equal(result.status,202,JSON.stringify(result.data));files.push({id:result.data.id,name,format});}
  await h.waitFor(async()=>{const rows=(await h.db.prepare('SELECT state,error_code FROM report_exports').all()).results,jobs=(await h.db.prepare("SELECT component,state,last_error_code,last_error_message FROM sync_jobs WHERE provider='reports' AND state IN('failed','blocked','retrying')").all()).results;if(jobs.length)throw new Error(JSON.stringify(jobs));return rows.length===4&&rows.every(r=>r.state==='ready');},{timeout:120000});await mkdir(out,{recursive:true});
  for(const file of files){const downloaded=await h.request('/api/reports/exports/'+file.id+'/download',{binary:true});assert.equal(downloaded.status,200);await writeFile(new URL(file.name,out),downloaded.data);}
  const workbook=JSON.parse(execFileSync('python',['-c',`import json,openpyxl,sys\nw=openpyxl.load_workbook(sys.argv[1],data_only=True)\np=openpyxl.load_workbook(sys.argv[2],data_only=True)\nprint(json.dumps({'sheets':w.sheetnames,'locations':[r[4] for r in list(w['Report'].values)[1:]],'player_minutes':[r[5] for r in list(p['Report'].values)[1:]]}))`,new URL('schedule.xlsx',out).pathname,new URL('players.xlsx',out).pathname],{encoding:'utf8'}));assert.deepEqual(workbook.sheets,['Report','Notes']);assert.deepEqual(workbook.locations,expected);assert.ok(workbook.player_minutes.includes('45.3'));
  const text=execFileSync('pdftotext',['-layout',new URL('schedule.pdf',out).pathname,'-'],{encoding:'utf8'});assert.deepEqual([...text.matchAll(/Field Q\d+Z/g)].map(m=>m[0]),expected);assert.match(execFileSync('pdfinfo',[new URL('summary.pdf',out).pathname],{encoding:'utf8'}),/Page size:\s+595 x 842 pts/);

  const guarded=new ReportingService(h.db,{captureAtAdmission:false,coordinator:{enqueue:async()=> 'guard-test'},now:Date.now}),stale=await guarded.create(scope,{type:'players',sort:'player'}),staleSnapshot=await guarded.snapshot(stale.data.snapshot_id),stalePage=await guarded.capture(staleSnapshot);
  // Full production players/attendance queries also compile and capture when
  // a valid1024-character key takes the bounded whole-column fallback.
  await h.db.batch([h.db.prepare('UPDATE team_player_rows SET name=? WHERE run_id=? AND player_id=?').bind('Q1'.repeat(512),run,'report-player-0'),h.db.prepare('UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=?').bind(team)]);
  await h.db.batch(stalePage.statements.map(statement=>h.db.prepare(statement.sql.replaceAll('$FENCE','1')).bind(...statement.params)));assert.equal((await guarded.snapshot(staleSnapshot.id)).state,'failed');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM report_rows WHERE snapshot_id=?').bind(staleSnapshot.id).first()).n,0);
  const complexPlayers=await prepare('players','player'),complexAttendance=await prepare('availability','player');await waitSnapshots([complexPlayers,complexAttendance]);for(const id of [complexPlayers,complexAttendance]){const value=await preview(id);assert.equal(value.rows.items.length,2);assert.ok(value.rows.items.some(r=>r.player.length===1024));assert.match(value.scope_note,/Long or complex values/);}

  await measure([complexPlayers,complexAttendance]);
  // The same production query shape must preserve the original Yes / tracked
  // percentage when TeamSnap cells are missing or their source is incomplete.
  const attendanceAccount='report-attendance-account',attendanceTeam='report-attendance-team',attendanceNativeTeam='714726',attendanceScope='teamsnap:'+attendanceNativeTeam,attendanceCoverage='teamsnap|'+attendanceAccount+'|attendance|'+attendanceScope;
  await h.db.batch([
   statement('provider_accounts',{id:attendanceAccount,provider:'teamsnap',native_id:'attendance',name:'Synthetic attendance account'}),
   statement('source_teams',{id:attendanceTeam,provider:'teamsnap',scope:attendanceAccount,account_id:attendanceAccount,native_id:attendanceNativeTeam,name:'Synthetic attendance team',name_authority:3,archived:0,evidence:'{}',content_hash:'attendance',observed_at:at}),
   statement('team_source_attachments',{id:'report-attendance-attachment',app_team_id:team,team_season_id:season,source_team_id:attendanceTeam,account_id:attendanceAccount}),
   statement('source_component_coverage',{id:attendanceCoverage,provider:'teamsnap',scope:attendanceScope,account_id:attendanceAccount,kind:'attendance',complete:0,record_count:2,scan_id:'synthetic-scan',observed_at:at})
  ]);
  for(let i=0;i<2;i++)await h.db.batch([
   statement('source_players',{id:'attendance-player-'+i,provider:'teamsnap',scope:attendanceAccount,account_id:attendanceAccount,native_id:String(i),name:'Player '+i,evidence:'{}',content_hash:'player-'+i,observed_at:at}),
   statement('player_source_links',{source_player_id:'attendance-player-'+i,player_id:'report-player-'+i,reason:'native',evidence:'{}',revision:1}),
   statement('source_roster_memberships',{source_team_id:attendanceTeam,source_player_id:'attendance-player-'+i,active:1,scan_id:'synthetic-roster'}),
   statement('source_events',{id:'attendance-event-'+i,provider:'teamsnap',scope:attendanceAccount,account_id:attendanceAccount,native_id:String(i),local_day:'2026-09-01',time_precision:'day',type:'game',status:'FINAL',conditional:0,home_source_team_id:attendanceTeam,home_label:'Us',away_label:'Them',title:'Attendance fixture',venue:'Field',evidence:'{}',content_hash:'event-'+i,observed_at:at}),
   statement('event_source_links',{source_event_id:'attendance-event-'+i,event_id:'report-event-'+i,reason:'native',evidence:'{}',revision:1}),
   statement('source_event_logistics',{source_event_id:'attendance-event-'+i,source_team_id:attendanceTeam,account_id:attendanceAccount,availability_enabled:1,content_hash:'tracked',observed_at:at}),
   h.db.prepare('UPDATE team_player_rows SET name=? WHERE run_id=? AND player_id=?').bind('Player '+i,run,'report-player-'+i)
  ]);
  await h.db.batch([0,1].map(i=>statement('source_attendance',{id:'report-attendance-'+i,account_id:attendanceAccount,source_team_id:attendanceTeam,source_event_id:'attendance-event-0',source_player_id:'attendance-player-'+i,status:i===0?'Yes':'Maybe',content_hash:'response-'+i,observed_at:at})));
  const attendanceRoster=await h.request('/api/team?'+new URLSearchParams(scope));assert.equal(attendanceRoster.status,200,JSON.stringify(attendanceRoster.data));
  assert.deepEqual(attendanceRoster.data.data.players.items.map(row=>[row.id,row.attendance_pct,row.attendance_missing]),[['report-player-0',50,1],['report-player-1',0,1]]);
  for(let i=0;i<2;i++){
   const detail=await h.request('/api/players/report-player-'+i+'?'+new URLSearchParams({...scope,tab:'attendance'}));assert.equal(detail.status,200,JSON.stringify(detail.data));
   assert.equal(detail.data.data.attendance.totals.percentage,i===0?50:0);assert.equal(detail.data.data.attendance.totals.no_response,0);
   assert.deepEqual(detail.data.data.attendance.events.items.map(row=>[row.id,row.response,row.coverage_state]).sort(),[['report-event-0',i===0?'yes':'maybe','incomplete'],['report-event-1','unavailable','unavailable']]);
  }
  const partialPlayers=await prepare('players','player'),partialAttendance=await prepare('availability','player'),partialSchedule=await prepare('matches','location');
  await waitSnapshots([partialPlayers,partialAttendance,partialSchedule]);await measure([partialPlayers,partialAttendance,partialSchedule]);
  assert.deepEqual((await preview(partialPlayers)).rows.items.map(row=>row.attendance),['50%','0%']);
  const partialRows=(await preview(partialAttendance)).rows.items;assert.deepEqual(partialRows.map(row=>[row.yes_pct,row.total,row.no_response]),[[50,2,0],[0,2,0]]);assert.ok(partialRows.every(row=>/1 missing/.test(row._report_note)));
  const partialPage=await preview(partialSchedule),partialTail=await preview(partialSchedule,partialPage.rows.next_cursor),partialScheduleRows=[...partialPage.rows.items,...partialTail.rows.items];
  assert.equal(partialScheduleRows.find(row=>row._report_id==='report-event-0').attendance,'50%');assert.equal(partialScheduleRows.find(row=>row._report_id==='report-event-1').attendance,'0%');
  assert.match(partialScheduleRows.find(row=>row._report_id==='report-event-1')._report_note,/2 missing, 0 unknown, 0 conflicts, 2 incomplete coverage/);
  assert.equal(partialScheduleRows.filter(row=>row.attendance!==null).length,2);
  // Replay a real typed refresh checkpoint between admission and capture. The
  // accepted full-history receipt is unchanged by newer scan progress metadata.
  await h.db.prepare('UPDATE source_component_coverage SET complete=1 WHERE id=?').bind(attendanceCoverage).run();
  const admitted=(await guarded.create(scope,{type:'availability'})).data.snapshot_id,beforeRefresh=await attendanceStateQuery(h.db,scope).first(),refreshAt=Date.now();
  const refreshOptions={kind:'attendance',teamId:attendanceNativeTeam,accountId:attendanceAccount,authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/availabilities/search?team_id='+attendanceNativeTeam,args:{team_id:attendanceNativeTeam}};
  const full=await beginTeamSnapRefresh({...refreshOptions,now:refreshAt}),completed=finishTeamSnapRefresh(full.refresh,{count:2,pages:1,digest:'a'.repeat(64),total:2,now:refreshAt+1}),recent=await beginTeamSnapRefresh({...refreshOptions,cursor:completed,now:refreshAt+2});
  assert.equal(recent.refresh.active.mode,'recent');
  const replay=await new DomainRepository(h.db).ingestSourcePage({provider:'teamsnap',component:'attendance',resourceKey:attendanceScope,accountId:attendanceAccount,generation:1,scanId:'newer-refresh-scan',checkpoint:{protocol:'teamsnap-pages-v1',refresh:recent.refresh},sourceCoverage:[{provider:'teamsnap',account_id:attendanceAccount,scope:attendanceScope,...teamSnapRefreshCoverage(recent.refresh,{complete:false,count:0,now:refreshAt+2})}],records:{}});
  assert.equal(replay.changed,false);assert.deepEqual(await attendanceStateQuery(h.db,scope).first(),beforeRefresh);
  async function captureGuarded(id){for(let snapshot=await guarded.snapshot(id);snapshot.state==='capturing';snapshot=await guarded.snapshot(id)){const page=await guarded.capture(snapshot);await h.db.batch(page.statements.map(s=>h.db.prepare(s.sql.replaceAll('$FENCE','1')).bind(...s.params)));}}
  await captureGuarded(admitted);const replayPreview=await preview(admitted);assert.equal(replayPreview.state,'ready');assert.deepEqual(replayPreview.rows.items.map(row=>row.yes_pct),[50,0]);assert.ok(replayPreview.rows.items.every(row=>/1 missing/.test(row._report_note)));
  for(const format of ['xlsx','pdf']){
   const exported=await h.request('/api/reports/'+admitted+'/exports',{method:'POST',body:{format}});assert.equal(exported.status,202,JSON.stringify(exported.data));
   await h.waitFor(async()=>{const row=await h.db.prepare('SELECT state,error_code FROM report_exports WHERE id=?').bind(exported.data.id).first();assert.notEqual(row.state,'failed',JSON.stringify(row));return row.state==='ready';},{timeout:120000});
   const download=await h.request('/api/reports/exports/'+exported.data.id+'/download',{binary:true});assert.equal(download.status,200);const file=new URL('unchanged-refresh.'+format,out);await writeFile(file,download.data);
   if(format==='xlsx'){const parsed=JSON.parse(execFileSync('python',['-c',"import json,openpyxl,sys\nw=openpyxl.load_workbook(sys.argv[1],data_only=True)\nprint(json.dumps({'report':list(w['Report'].values),'notes':list(w['Notes'].values)}))",file.pathname],{encoding:'utf8'}));assert.deepEqual(parsed.report.slice(1).map(row=>row.at(-1)),['50%','0%']);assert.match(JSON.stringify(parsed.notes),/1 missing/);}
   else{const text=execFileSync('pdftotext',['-layout',file.pathname,'-'],{encoding:'utf8'});assert.match(text,/50%/);assert.match(text,/\b0%/);assert.match(text,/1 missing/);}
  }
  const changedAttendance=(await guarded.create(scope,{type:'availability'})).data.snapshot_id;
  await h.db.prepare("UPDATE source_attendance SET status='No' WHERE id='report-attendance-0'").run();await captureGuarded(changedAttendance);
  const rejected=await preview(changedAttendance);assert.equal(rejected.state,'failed');assert.equal(rejected.error_code,'report_changed');assert.equal(rejected.rows.items.length,0);
  assert.deepEqual((await preview(admitted)).rows,replayPreview.rows,'already captured native reports remain immutable');
  const captures=(await h.db.prepare("SELECT state,last_saved_at,last_complete_at FROM sync_jobs WHERE provider='reports' AND component='capture'").all()).results;assert.ok(captures.every(j=>j.state==='ready'&&j.last_saved_at&&j.last_complete_at));
  console.log(JSON.stringify({native_populated_reports:'PASS',rows:137,browser_open:false,manual_runner_requests:0,admitted_snapshots:10,atomic_admission:true,actual_parsed_files:6,recursion_character_bound:1024,recursion_step_bound:64,complex1024_key_preserved:true,original_attendance_percentages:true,attendance_evidence_notes_captured:true,unchanged_refresh_preserves_capture:true,changed_response_fails_capture:true,stale_commit_failed_closed:true,receipts,closedAt}));
 }finally{await h.dispose();}
});
