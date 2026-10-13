import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {REPORT_SCHEMA} from '../src/reporting/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {TEAM_GAME_SCHEMA} from '../src/domain/team-game-schema.js';
import {TEAM_GAME_RUN_BASE_DDL,TEAM_GAME_RUN_TARGET_DDL} from '../src/application/team-game-installation-epoch.js';
import {SECURITY_SCHEMA} from '../src/security/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {AWARDS_SCHEMA} from '../src/read-model/feature-schema.js';
import {AnalysisReads,playerSeasonQuery} from '../src/analysis/reads.js';
import {FeatureReads} from '../src/read-model/feature-reads.js';
import {ReportingService} from '../src/reporting/service.js';
import {CursorCodec} from '../src/read-model/cursor.js';
import {createOriginalReportsOracle} from './parity/original-reports-fixtures.mjs';
import {roster,playerDetail,reports as reportScreen} from '../web/ui-original/screens.js';

const AT='2026-10-12T12:00:00.000Z',INPUT={team_id:'team',team_season_id:'season'};
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
 for(const sql of [...DOMAIN_SCHEMA.map(sql=>sql===TEAM_GAME_RUN_BASE_DDL?TEAM_GAME_RUN_TARGET_DDL:sql),...TEAM_GAME_SCHEMA,...SECURITY_SCHEMA,...ANALYSIS_SCHEMA,...TEAM_FEATURE_SCHEMA,...AWARDS_SCHEMA,...REPORT_SCHEMA,...SYNC_SCHEMA])sqlite.exec(sql);
 const insert=(table,row)=>sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
 let now=Date.parse(AT);
 const db={prepare(sql){const statement={sql,params:[],bind(...params){return {...statement,params};},async first(){const row=sqlite.prepare(sql).get(...this.params);return row?{...row}:null;},async run(){const result=sqlite.prepare(sql).run(...this.params);return {meta:{changes:Number(result.changes)}};},async all(){return {results:sqlite.prepare(sql).all(...this.params).map(row=>({...row}))};}};return statement;},async batch(statements){return Promise.all(statements.map(s=>s.all()));}};
 insert('domain_installation',{id:1,schema_version:1,created_at:AT});
 insert('provider_accounts',{id:'account-a',provider:'teamsnap',native_id:'a',name:'Private account A'});
 insert('provider_accounts',{id:'account-b',provider:'teamsnap',native_id:'b',name:'Private account B'});
 for(const [id,year] of [['season',2026],['history',2025]]){
  if(id==='season'){insert('app_teams',{id:'team',name:'Us',timezone:'UTC',season_year:2026,created_at:AT});insert('team_read_state',{app_team_id:'team',content_revision:1,status_revision:1});}
  insert('team_seasons',{id,app_team_id:'team',year,start_day:`${year}-06-01`,end_day:`${year+1}-06-01`,start_at:`${year}-06-01T00:00:00Z`,end_at:`${year+1}-06-01T00:00:00Z`,include_june:0});
  insert('team_projection_runs',{id:'run-'+id,app_team_id:'team',team_season_id:id,input_revision:1,state:'published',created_at:AT});
  insert('team_projection_state',{team_season_id:id,app_team_id:'team',published_run_id:'run-'+id,pending:0});
 }
 insert('app_clubs',{id:'club',name:'Club'});insert('team_profiles',{app_team_id:'team',club_id:'club',kind:'own'});
 for(const [id,account] of [['source-a','account-a'],['source-b','account-b']]){
  insert('source_teams',{id,provider:'teamsnap',scope:account,account_id:account,native_id:id,name:id,name_authority:3,archived:0,evidence:'{}',content_hash:'team',observed_at:AT});
  for(const season of ['season','history'])insert('team_source_attachments',{id:id+'-'+season,app_team_id:'team',team_season_id:season,source_team_id:id,account_id:account});
  insert('source_component_coverage',{id:'coverage-'+id,provider:'teamsnap',scope:'teamsnap:'+id,account_id:account,kind:'attendance',complete:1,record_count:0,scan_id:'scan',observed_at:AT});
 }
 function player(id,{season='season',alias=null,account='account-a',rosterActive=1}={}){
  const source='native-'+id,canonical=alias||id,sourceTeam=account==='account-a'?'source-a':'source-b';
  if(!alias)insert('players',{id:canonical,created_at:AT});
  insert('source_players',{id:source,provider:'teamsnap',scope:account,account_id:account,native_id:id,name:id,jersey:'9',evidence:'{}',content_hash:'player',observed_at:AT});
  insert('player_source_links',{source_player_id:source,player_id:canonical,reason:'native',evidence:'{}',revision:1});
  insert('source_roster_memberships',{source_team_id:sourceTeam,source_player_id:source,active:rosterActive,scan_id:'roster'});
  if(!alias)insert('team_player_rows',{run_id:'run-'+season,app_team_id:'team',team_season_id:season,player_id:canonical,name:id,jersey:'9',source_ids:JSON.stringify([source])});
  return {id:canonical,source};
 }
 function event(id,{season='season',type='game',status='FINAL',day='2026-09-01',starts=null,enabled=1,sourceTeam='source-a',account='account-a',alias=null,project=true}={}){
  const source='native-'+id,canonical=alias||id;
  if(!alias)insert('events',{id:canonical,created_at:AT});
  insert('source_events',{id:source,provider:'teamsnap',scope:account,account_id:account,native_id:id,starts_at:starts,local_day:day,time_precision:starts?'instant':day?'day':'pending',type,status,conditional:0,home_source_team_id:sourceTeam,home_label:'Us',away_label:'Them',title:id,venue:'Field',evidence:'{}',content_hash:'event',observed_at:AT});
  insert('source_event_teams',{source_team_id:sourceTeam,source_event_id:source,side:'home'});
  insert('event_source_links',{source_event_id:source,event_id:canonical,reason:'native',evidence:'{}',revision:1});
  if(project)insert('team_event_rows',{run_id:'run-'+season,app_team_id:'team',team_season_id:season,event_id:canonical,starts_at:starts,local_day:day,type,status,conditional:0,own_side:'home',home_name:'Us',away_name:'Them',title:id,venue:'Field',source_ids:JSON.stringify([source]),schedule_source_id:source,result_source_id:source});
  if(enabled!==undefined)insert('source_event_logistics',{source_event_id:source,source_team_id:sourceTeam,account_id:account,availability_enabled:enabled,content_hash:'logistics',observed_at:AT});
  return {id:canonical,source,account,sourceTeam};
 }
 function response(e,p,status){insert('source_attendance',{id:e.source+'|'+p.source,account_id:e.account,source_team_id:e.sourceTeam,source_event_id:e.source,source_player_id:p.source,status,content_hash:'response',observed_at:AT});}
 const cursor=new CursorCodec(new Uint8Array(32).fill(9),{now:()=>now}),options={cursor,now:()=>now},analysis=new AnalysisReads(db,{owner:true},options),features=new FeatureReads(db,{owner:true},{...options,analysisReads:analysis}),reports=new ReportingService(db,{...options,coordinator:{enqueue:async()=> 'test-job'},fontLoader:()=>readFile(new URL('../web/assets/report-font.ttf',import.meta.url))});
 const commit=page=>{sqlite.exec('BEGIN');try{for(const s of page.statements)sqlite.prepare(s.sql.replaceAll('$FENCE','1')).run(...s.params.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value));sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 const query=q=>sqlite.prepare(q.sql).all(...q.params).map(row=>({...row}));
 return {sqlite,db,insert,player,event,response,analysis,features,reports,query,commit,options,setNow:value=>{now=Date.parse(value);},close:()=>sqlite.close()};
}

async function assertPercentageSurfaces(f,p,expected){
 const summary=(await f.analysis.summary(INPUT,p.id)).data;
 assert.equal(summary.attendance_pct,expected,'shared season percentage matches the original');
 const team=await f.analysis.team(INPUT),row=team.data.players.items.find(row=>row.id===p.id);
 assert.equal(row.attendance_pct,expected,'roster uses the shared percentage');
 const detail=await f.analysis.player(INPUT,p.id,{tab:'attendance'});
 assert.equal(detail.data.stats.attendance_pct,expected);assert.equal(detail.data.attendance.totals.percentage,expected);
 if(expected!==null){
  assert.match(roster(team),new RegExp('data-label="Attend\\.">'+expected+'%<'));
  assert.match(playerDetail(detail),new RegExp('<span>Attendance</span><b>'+expected+'%</b>'));
  assert.match(playerDetail(detail,{tab:'attendance'}),new RegExp('<span>Attendance</span><b>'+expected+'%</b>'));
 }
 const selection=(await f.analysis.base.context(INPUT)).selection;
 for(const type of ['players','availability']){
  const key=type==='players'?'attendance':'yes_pct',value=expected===null?null:type==='players'?expected+'%':expected;
  const rows=f.query(await f.reports.query(type,selection));assert.equal(rows.find(row=>row.id===p.id)[key],value,type+' report query');
  const created=await f.reports.create(INPUT,{type}),id=created.data.snapshot_id;
  for(let snapshot=await f.reports.snapshot(id);snapshot.state==='capturing';snapshot=await f.reports.snapshot(id))f.commit(await f.reports.capture(snapshot));
  const preview=(await f.reports.preview(id)).data;
  assert.equal(preview.state,'ready');assert.equal(preview.rows.items.find(row=>row._report_id===p.id)[key],value,type+' captured report');
  if(type==='players')assert.match(preview.scope_note,/attendance uses all past included tracked events, including practices/);
  if(summary.attendance_unknown>0||summary.attendance_conflicts>0){
   const note=preview.rows.items.find(row=>row._report_id===p.id)._report_note;
   assert.ok(note.includes(summary.attendance_missing+' missing, '+(summary.attendance_unknown-summary.attendance_missing)+' unknown, '+summary.attendance_conflicts+' conflicting'),type+' captures distinct attendance diagnostics');
   assert.match(note,/Yes % uses all selected tracked events/);
  }
  const label=type==='players'?'Attendance':'Yes %';
  assert.match(reportScreen(preview),new RegExp('data-label="'+label+'">'+(expected===null?'':expected+'%')+'</td>'));
 }
 return {summary,detail:detail.data};
}

test('original attendance percentages include missing responses across roster, player and captured reports',async t=>{
 for(const [status,code,expected] of [['Yes',1,50],['Maybe',2,0],['NR',null,0],['Unknown',99,0],['missing',undefined,0]])await t.test(status+' plus missing',async()=>{
  const f=fixture();try{
   const p=f.player('player'),a=f.event('first',{type:'practice',status:'SCHEDULED'});f.event('missing',{type:'event',status:'SCHEDULED'});
   if(status!=='missing')f.response(a,p,status);
   const original=createOriginalReportsOracle({now:AT,players:[{id:p.id,name:'player'}],events:['first','missing'].map(id=>({id,_date:'2026-09-01',is_availability_enabled:true})),availability:status==='missing'?[]:[{event_id:a.id,member_id:p.id,status_code:code}]});
   assert.equal(original.playerAvailability({id:p.id}).pct,expected);
   assert.equal(original.reportRows('players')[0].Attendance,expected+'%');assert.equal(original.reportRows('availability')[0]['Yes %'],expected+'%');
   const {summary,detail}=await assertPercentageSurfaces(f,p,expected);
   assert.equal(summary.attendance_events,2);assert.equal(summary.attendance_missing,status==='missing'?2:1);
   assert.equal(summary.nr,status==='NR'?1:0,'missing is never reclassified as provider NR');
   assert.equal(summary.attendance_unknown,status==='missing'||status==='Unknown'?2:1);
   assert.equal(detail.attendance.events.items.find(row=>row.id==='missing').response,'unavailable');
  }finally{f.close();}
 });
});

test('original attendance rounds once in original arithmetic order',async t=>{
 for(const [yes,total,expected]of [[47,95,49],[29,200,14]])await t.test(yes+' of '+total,async()=>{
 const f=fixture();try{
  const p=f.player('player'),events=[],availability=[];
  for(let i=0;i<total;i++){const e=f.event('event-'+i,{type:'practice',status:'SCHEDULED'});f.response(e,p,i<yes?'Yes':'No');events.push({id:e.id,_date:'2026-09-01',is_availability_enabled:true});availability.push({event_id:e.id,member_id:p.id,status_code:i<yes?1:0});}
  const original=createOriginalReportsOracle({now:AT,players:[{id:p.id,name:'player'}],events,availability});
  assert.equal(original.playerAvailability({id:p.id}).pct,expected);
  await assertPercentageSurfaces(f,p,original.playerAvailability({id:p.id}).pct);
 }finally{f.close();}
 });
});

test('original denominator survives incomplete coverage and conflicts without altering response evidence',async()=>{
 const f=fixture();try{
  const p=f.player('player'),yes=f.event('yes'),conflict=f.event('conflict');f.response(yes,p,'Yes');f.response(conflict,p,'Yes');f.response(conflict,f.player('alias',{alias:p.id}),'No');
  f.sqlite.prepare("UPDATE source_component_coverage SET complete=0 WHERE id='coverage-source-a'").run();
  const {summary,detail}=await assertPercentageSurfaces(f,p,50);
  assert.equal(summary.attendance_events,2);assert.equal(summary.yes,1);assert.equal(summary.attendance_conflicts,1);assert.equal(summary.nr,0);
  assert.deepEqual(detail.attendance.events.items.map(row=>[row.id,row.response,row.coverage_state]).sort(),[['conflict','conflict','human_review'],['yes','yes','incomplete']]);
  const viewer=new AnalysisReads(f.db,{owner:false,teamId:'team'},f.options),view=(await viewer.player(INPUT,p.id,{tab:'attendance'})).data;
  assert.equal(view.attendance.totals.percentage,50);assert.equal(view.capabilities.can_edit,false);assert.equal(view.capabilities.can_coach,false);
  await assert.rejects(viewer.summary({...INPUT,team_id:'other'},p.id),error=>error.code==='team_forbidden');
 }finally{f.close();}
});

test('original Schedule report keeps percentage with missing evidence and captures separate diagnostics',async()=>{
 const f=fixture();try{
  const p=f.player('yes-player'),missing=f.player('missing-player'),events=[];
  for(const [id,props] of [['past',{}],['future',{day:'2026-10-13'}],['cancelled',{status:'CANCELLED'}],['untracked',{enabled:0}]]){
   const e=f.event(id,props);f.response(e,p,'Yes');events.push({id,_date:props.day||'2026-09-01',_cancelled:props.status==='CANCELLED',is_availability_enabled:props.enabled!==0});
  }
  f.sqlite.prepare("UPDATE source_component_coverage SET complete=0 WHERE id='coverage-source-a'").run();
  const original=createOriginalReportsOracle({now:AT,players:[{id:p.id},{id:missing.id}],events,items:events.map(event=>({id:event.id,kind:'event',date:event._date,event})),availability:events.map(e=>({event_id:e.id,member_id:p.id,status_code:1}))});
  const selection=(await f.analysis.base.context(INPUT)).selection,rows=f.query(await f.reports.query('matches',selection));
  for(const id of ['past','future']){const row=rows.find(row=>row.id===id);assert.equal(row.attendance,original.reportRows('matches').find(row=>row.Date===(id==='past'?'2026-09-01':'2026-10-13')).Attendance);assert.equal(row.attendance,'50%');assert.match(row._report_note,/1 missing, 0 unknown, 0 conflicts/);assert.match(row._report_note,/2 incomplete coverage/);}
  assert.equal(rows.find(row=>row.id==='cancelled').attendance,'');assert.equal(rows.find(row=>row.id==='untracked').attendance,null);
  const created=await f.reports.create(INPUT,{type:'matches'}),id=created.data.snapshot_id;
  for(let snapshot=await f.reports.snapshot(id);snapshot.state==='capturing';snapshot=await f.reports.snapshot(id))f.commit(await f.reports.capture(snapshot));
  const preview=(await f.reports.preview(id)).data,past=preview.rows.items.find(row=>row._report_id==='past');
  assert.equal(past.attendance,'50%');assert.match(past._report_note,/1 missing/);assert.match(reportScreen(preview),/Evidence notes/);
  f.sqlite.prepare("UPDATE source_attendance SET status='No'").run();
  assert.deepEqual((await f.reports.preview(id)).data.rows,preview.rows,'a ready snapshot remains immutable after source changes');
  const snapshot=await f.reports.snapshot(id),out=new URL('../tmp/attendance-percentage-parity/',import.meta.url);await mkdir(out,{recursive:true});
  for(const format of ['xlsx','pdf']){
   const status=await f.reports.requestExport(id,format);
   for(let step=0;;step++){assert.ok(step<20,'small report encoding must finish');const page=await f.reports.encode(snapshot,status.id,format);f.commit(page);if(page.complete)break;}
   const download=await f.reports.download(status.id),file=new URL('schedule.'+format,out);await writeFile(file,new Uint8Array(await download.arrayBuffer()));
   if(format==='xlsx'){
    const workbook=JSON.parse(execFileSync('python',['-c',"import json,openpyxl,sys\nw=openpyxl.load_workbook(sys.argv[1],data_only=True)\nprint(json.dumps({'report':list(w['Report'].values),'notes':list(w['Notes'].values)}))",file.pathname],{encoding:'utf8'}));
    assert.deepEqual(workbook.report.slice(1).map(row=>row.at(-1)??''),preview.rows.items.map(row=>row.attendance??''));
    assert.match(JSON.stringify(workbook.notes),/1 missing, 0 unknown, 0 conflicts, 2 incomplete coverage/);
   }else{
    const text=execFileSync('pdftotext',['-layout',file.pathname,'-'],{encoding:'utf8'});assert.equal((text.match(/50%/g)||[]).length,2);assert.match(text,/1 missing/);assert.match(text,/2 incomplete coverage/);
   }
  }
 }finally{f.close();}
});

test('zero eligible tracked events remains blank across attendance surfaces',async()=>{
 const f=fixture();try{
  const p=f.player('player');
  for(const [id,props] of [['untracked',{enabled:0}],['future',{day:'2026-10-13'}],['cancelled',{status:'CANCELLED'}],['june',{day:'2026-06-15'}],['excluded',{}]]){const e=f.event(id,props);f.response(e,p,'Yes');}
  f.insert('season_inclusion_rules',{team_season_id:'season',kind:'event',resource_key:'excluded',included:0});
  const {summary}=await assertPercentageSurfaces(f,p,null);assert.equal(summary.attendance_events,0);
  const original=createOriginalReportsOracle({players:[{id:p.id,name:'player'}]});assert.equal(original.reportRows('players')[0].Attendance,'');assert.equal(original.reportRows('availability')[0]['Yes %'],'');
 }finally{f.close();}
});

test('attendance counts past scheduled practices and other events, while preserving June and saved exclusion',async()=>{
 const f=fixture();try{
  const p=f.player('player');
  for(const [id,props,response] of [['game',{},'Yes'],['practice',{type:'practice',status:'SCHEDULED'},'No'],['meeting',{type:'event',status:'SCHEDULED'},'Maybe'],['june',{day:'2026-06-15'},'Yes'],['excluded',{},'Yes'],['cancelled',{status:'CANCELLED'},'Yes'],['future',{status:'SCHEDULED',day:'2026-10-13'},'Yes'],['undated',{day:null},'Yes'],['untracked',{enabled:0},'Yes']]){const e=f.event(id,props);if(response)f.response(e,p,response);}
  f.insert('season_inclusion_rules',{team_season_id:'season',kind:'event',resource_key:'excluded',included:0});
  const summary=(await f.analysis.summary(INPUT,p.id)).data;
  assert.equal(summary.selected_matches,3,'statistical final-game selection is unchanged, including undated final source data');
  assert.equal((await f.features.attendance(await f.features.featureContext(INPUT),'untracked')).coverage,'untracked','explicitly disabled tracking wins over retained historical responses');
  assert.equal(summary.attendance_events,3);assert.equal(summary.yes,1);assert.equal(summary.no,1);assert.equal(summary.maybe,1);assert.equal(summary.attendance_pct,33);
  const detail=(await f.analysis.player({...INPUT,type:'games',mode:'day',date:'2026-10-12'},p.id,{tab:'attendance'})).data;
  assert.deepEqual(detail.attendance.events.items.map(e=>e.id).sort(),['game','meeting','practice']);
  assert.equal(detail.matches.total,0,'attendance must not inherit the match log day or game-only filter');
  const report=f.query(await f.reports.query('availability',(await f.analysis.base.context(INPUT)).selection))[0];
  assert.equal(report.total,3);assert.equal(report.yes_pct,33);
  f.sqlite.prepare('UPDATE team_seasons SET include_june=1 WHERE id=?').run('season');
  assert.equal((await f.analysis.summary(INPUT,p.id)).data.attendance_events,4);
 }finally{f.close();}
});

test('event, player and report views distinguish explicit NR, missing, unknown and conflicts',async()=>{
 const f=fixture();try{
  const e=f.event('practice',{type:'practice',status:'SCHEDULED'}),players={};
  for(const status of ['Yes','No','Maybe','NR','Unknown','missing','Conflict']){const p=f.player('p-'+status);players[status]=p;if(!['missing','Conflict'].includes(status))f.response(e,p,status);}
  f.response(e,players.Conflict,'Yes');const alias=f.player('alias',{alias:players.Conflict.id});f.response(e,alias,'No');
  const context=await f.features.featureContext(INPUT),event=await f.features.attendance(context,e.id,{limit:3});
  assert.deepEqual(Object.fromEntries(['yes','no','maybe','no_response','missing','unknown','conflicts'].map(k=>[k,event.totals[k]])),{yes:1,no:1,maybe:1,no_response:1,missing:1,unknown:1,conflicts:1});
  assert.equal(event.coverage,'partial');assert.equal(event.players.total,7);
  const statuses=[];let page=event;
  do{statuses.push(...page.players.items.map(p=>p.response));page=page.players.next_cursor?await f.features.attendance(context,e.id,{limit:3,cursor:page.players.next_cursor}):null;}while(page);
  assert.deepEqual(statuses.sort(),['yes','no','maybe','no_response','unavailable','unknown','conflict'].sort());
  for(const [label,response] of [['NR','no_response'],['missing','unavailable'],['Unknown','unknown'],['Conflict','conflict']]){
   const detail=(await f.analysis.player(INPUT,players[label].id,{tab:'attendance'})).data;
   assert.equal(detail.attendance.events.items[0].response,response);assert.equal(detail.attendance.totals.no_response,label==='NR'?1:0);
   assert.equal(detail.attendance.totals.percentage,0);
  }
  const rows=f.query(await f.reports.query('matches',(await f.analysis.base.context(INPUT)).selection));
  assert.equal(rows[0].attendance,'14%');assert.match(rows[0]._report_note,/1 NR, 1 missing, 1 unknown, 1 conflicts/);
  const availability=f.query(await f.reports.query('availability',(await f.analysis.base.context(INPUT)).selection));
  assert.equal(availability.find(r=>r.id===players.missing.id).missing,1);assert.equal(availability.find(r=>r.id===players.missing.id).unknown,0);
  assert.equal(availability.find(r=>r.id===players.Unknown.id).missing,0);assert.equal(availability.find(r=>r.id===players.Unknown.id).unknown,1);
  f.sqlite.prepare("UPDATE source_attendance SET status='Maybe' WHERE source_player_id='native-p-Yes'").run();
  await assert.rejects(f.features.attendance(context,e.id,{limit:3,cursor:event.players.next_cursor}),error=>error.code==='cursor_restart');
 }finally{f.close();}
});

test('event coverage is exact-source qualified and never manufactures historical NR from another complete team',async()=>{
 const f=fixture();try{
  const p=f.player('former-player',{season:'history',rosterActive:0}),e=f.event('historical-practice',{season:'history',type:'practice',status:'SCHEDULED',day:'2025-09-01'});
  f.sqlite.prepare("UPDATE source_component_coverage SET complete=0 WHERE id='coverage-source-a'").run();
  const input={...INPUT,team_season_id:'history'},context=await f.features.featureContext(input),missing=await f.features.attendance(context,e.id);
  assert.equal(missing.players.items[0].response,'unavailable');assert.equal(missing.totals.no_response,0);
  f.response(e,p,'Yes');const detail=await f.features.attendance(context,e.id);
  assert.equal(detail.players.items[0].response,'yes');assert.equal(detail.players.items[0].coverage_state,'incomplete');assert.equal(detail.coverage,'partial');
  const summary=(await f.analysis.summary(input,p.id)).data;
  assert.equal(summary.yes,1);assert.equal(summary.attendance_pct,100,'coverage remains incomplete without suppressing the recorded Yes percentage');
  assert.equal((await f.analysis.player(input,p.id,{tab:'attendance'})).data.attendance.events.total,1,'inactive current roster membership does not erase projected historical evidence');
 }finally{f.close();}
});

test('full-season attendance pages have stable totals and do not reuse match-log cursors',async()=>{
 const f=fixture();try{
  const p=f.player('player');
  for(let i=0;i<127;i++){const e=f.event('event-'+String(i).padStart(3,'0'),{type:i%2?'practice':'game',status:i%2?'SCHEDULED':'FINAL'});f.response(e,p,'Yes');}
  const future=f.event('soon',{status:'SCHEDULED',starts:'2026-10-12T12:05:00.000Z',day:'2026-10-12'});f.response(future,p,'No');
  let page=(await f.analysis.player(INPUT,p.id,{tab:'attendance',limit:37})).data,ids=[],firstCursor=page.attendance.events.next_cursor;
  assert.equal(page.matches.total,64);assert.equal(page.attendance.events.total,127);
  f.setNow('2026-10-12T12:10:00.000Z');
  do{assert.equal(page.attendance.totals.selected_events,127);assert.equal(page.attendance.totals.yes,127);ids.push(...page.attendance.events.items.map(e=>e.id));page=page.attendance.events.next_cursor?(await f.analysis.player(INPUT,p.id,{tab:'attendance',limit:37,cursor:page.attendance.events.next_cursor})).data:null;}while(page);
  assert.equal(ids.length,127);assert.equal(new Set(ids).size,127);assert.ok(!ids.includes('soon'));
  await assert.rejects(f.analysis.player(INPUT,p.id,{tab:'matches',cursor:firstCursor}),error=>error.code==='cursor_selection');
  assert.equal((await f.analysis.player(INPUT,p.id,{tab:'attendance'})).data.attendance.events.total,128,'a fresh read uses its new time boundary');
  f.sqlite.prepare('UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=?').run('team');
  await assert.rejects(f.analysis.player(INPUT,p.id,{tab:'attendance',cursor:firstCursor}),error=>error.code==='cursor_restart');
 }finally{f.close();}
});

test('attendance follows accepted corrected season membership and viewer scope without private IDs',async()=>{
 const f=fixture();try{
  const p=f.player('player'),e=f.event('moved',{day:'2026-09-01'});f.response(e,p,'Yes');
  f.insert('team_player_rows',{run_id:'run-history',app_team_id:'team',team_season_id:'history',player_id:p.id,name:'player',jersey:'9',source_ids:JSON.stringify([p.source])});
  f.sqlite.prepare("UPDATE team_event_rows SET run_id='run-history',team_season_id='history',local_day='2026-05-31' WHERE event_id='moved'").run();
  const historical={...INPUT,team_season_id:'history'},viewer=new AnalysisReads(f.db,{owner:false,teamId:'team'},f.options);
  assert.equal((await viewer.player(INPUT,p.id,{tab:'attendance'})).data.attendance.events.total,0);
  const result=(await viewer.player(historical,p.id,{tab:'attendance'})).data;
  assert.equal(result.attendance.events.total,1);assert.equal(result.attendance.events.items[0].local_day,'2026-05-31');assert.equal(result.capabilities.can_edit,false);
  assert.doesNotMatch(JSON.stringify(result),/account-a|native-|source-a|Private account/);
  await assert.rejects(viewer.player({...INPUT,team_id:'other'},p.id),error=>error.code==='team_forbidden');
 }finally{f.close();}
});


test('roster attendance sorting freezes its time cutoff and invalidates when evidence changes',async()=>{
 const f=fixture();try{
  const past=f.event('past',{type:'practice',status:'SCHEDULED'}),future=f.event('soon',{type:'practice',status:'SCHEDULED',starts:'2026-10-12T12:05:00.000Z',day:'2026-10-12'});
  for(let i=0;i<107;i++){const p=f.player('player-'+String(i).padStart(3,'0'));f.response(past,p,'Yes');f.response(future,p,'No');}
  let page=(await f.analysis.players(INPUT,{sort:'attendance',limit:23})).data,ids=[],firstCursor=page.next_cursor;
  f.setNow('2026-10-12T12:10:00.000Z');
  do{assert.equal(page.total,107);assert.ok(page.items.every(p=>p.attendance_pct===100&&p.attendance_events===1));ids.push(...page.items.map(p=>p.id));page=page.next_cursor?(await f.analysis.players(INPUT,{sort:'attendance',limit:23,cursor:page.next_cursor})).data:null;}while(page);
  assert.equal(ids.length,107);assert.equal(new Set(ids).size,107);
  f.sqlite.prepare("UPDATE source_attendance SET status='No' WHERE source_event_id='native-past' AND source_player_id='native-player-000'").run();
  assert.equal(f.sqlite.prepare("SELECT content_revision FROM team_read_state WHERE app_team_id='team'").get().content_revision,1);
  await assert.rejects(f.analysis.players(INPUT,{sort:'attendance',cursor:firstCursor}),error=>error.code==='cursor_restart');
 }finally{f.close();}
});

test('immutable attendance capture fails on between-chunk and pre-commit evidence updates',async()=>{
 const f=fixture();try{
  const e=f.event('practice',{type:'practice',status:'SCHEDULED'});
  for(let i=0;i<107;i++)f.response(e,f.player('player-'+String(i).padStart(3,'0')),'Yes');
  const created=await f.reports.create(INPUT,{type:'availability'}),id=created.data.snapshot_id;
  assert.equal(created.data.state,'capturing');assert.ok(!Object.hasOwn(created.selection,'attendance_evidence_revision'));
  f.commit(await f.reports.capture(await f.reports.snapshot(id)));
  assert.equal((await f.reports.snapshot(id)).captured,100);
  f.sqlite.prepare("UPDATE source_attendance SET status='No' WHERE source_player_id='native-player-106'").run();
  f.commit(await f.reports.capture(await f.reports.snapshot(id)));
  assert.equal((await f.reports.snapshot(id)).state,'failed');assert.equal((await f.reports.preview(id)).data.rows.items.length,0);
  const second=await f.reports.create(INPUT,{type:'availability'}),secondId=second.data.snapshot_id,page=await f.reports.capture(await f.reports.snapshot(secondId));
  f.sqlite.prepare("UPDATE source_attendance SET status='Maybe' WHERE source_player_id='native-player-105'").run();
  f.commit(page);
  assert.equal((await f.reports.snapshot(secondId)).state,'failed');assert.equal((await f.reports.snapshot(secondId)).captured,0);
  const third=await f.reports.create(INPUT,{type:'availability'}),thirdId=third.data.snapshot_id;
  for(let snapshot=await f.reports.snapshot(thirdId);snapshot.state==='capturing';snapshot=await f.reports.snapshot(thirdId))f.commit(await f.reports.capture(snapshot));
  const ready=await f.reports.preview(thirdId,{limit:100});assert.equal(ready.data.state,'ready');assert.equal(ready.data.rows.total,107);assert.equal(ready.data.rows.items.length,100);
  const tail=await f.reports.preview(thirdId,{limit:100,cursor:ready.data.rows.next_cursor});assert.equal(tail.data.rows.items.length,7);assert.ok(tail.data.rows.items.some(p=>p.no===1));assert.ok(tail.data.rows.items.some(p=>p.maybe===1));
 }finally{f.close();}
});

test('reviewer absence of tracking evidence stays untracked across event and report views',async()=>{const f=fixture();try{const p=f.player('p');const e=f.event('no-tracking-evidence',{enabled:null});const event=await f.features.attendance(await f.features.featureContext(INPUT),e.id);assert.equal(event.coverage,'untracked');assert.equal(event.totals.missing,0);assert.equal((await f.analysis.summary(INPUT,p.id)).data.attendance_events,0);const report=f.query(await f.reports.query('matches',(await f.analysis.base.context(INPUT)).selection));assert.equal(report[0].attendance,null);}finally{f.close();}});

test('no roster and no tracked evidence is untracked rather than complete',async()=>{const f=fixture();try{const e=f.event('empty',{enabled:null});const event=await f.features.attendance(await f.features.featureContext(INPUT),e.id);assert.equal(event.coverage,'untracked');assert.equal(event.totals.total,0);assert.equal(event.totals.missing,0);}finally{f.close();}});
