import test from 'node:test';
import assert from 'node:assert/strict';
import {freshHarness,TEST_PASSWORD} from './fresh-harness.js';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {InstallationUpgrade} from '../src/application/schema-upgrade.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {ReportingService} from '../src/reporting/service.js';
import {BudgetDB} from '../src/sync/budget.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {CursorCodec} from '../src/read-model/cursor.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('native owner HTTP captures 250 byte-bounded rows and epoch-wrapped fair claims stay bounded',async()=>{
 const h=await freshHarness();try{
  await h.initialize();const created=await h.request('/api/teams',{method:'POST',body:{name:'Report admission bound',timezone:'UTC',season_year:2026}});assert.equal(created.status,201,JSON.stringify(created.data));const team=created.data.team.id,season=created.data.season_id,scope={team_id:team,team_season_id:season},at=new Date().toISOString(),run='admission-native-run',sourceTeam=sourceKey('trace','report','report-account'),otherSourceTeam=sourceKey('trace','other','report-account');
  const statement=(table,row)=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row));
  await h.db.batch([
   statement('provider_accounts',{id:'report-account',provider:'trace',native_id:'report',name:'Synthetic account'}),
   statement('source_teams',{id:sourceTeam,provider:'trace',scope:'report-account',account_id:'report-account',native_id:'report',name:'Synthetic team',name_authority:3,archived:0,evidence:'{}',content_hash:'test',observed_at:at}),
   statement('source_teams',{id:otherSourceTeam,provider:'trace',scope:'report-account',account_id:'report-account',native_id:'other',name:'Unattached team',name_authority:3,archived:0,evidence:'{}',content_hash:'other',observed_at:at}),
   statement('team_source_attachments',{id:'report-attachment',app_team_id:team,team_season_id:season,source_team_id:sourceTeam,account_id:'report-account'}),
   statement('team_projection_runs',{id:run,app_team_id:team,team_season_id:season,input_revision:1,state:'published',created_at:at}),
   h.db.prepare('UPDATE team_projection_state SET published_run_id=?,pending=0 WHERE team_season_id=?').bind(run,season),h.db.prepare('UPDATE team_read_state SET pending=0,content_revision=content_revision+1 WHERE app_team_id=?').bind(team),
  ]);
  for(let first=0;first<250;first+=10){const statements=[];for(let i=first;i<first+10;i++){const id='report-event-'+i,source=sourceKey('trace',String(i),'report-account'),venue='é'.repeat(750)+'Q'+i+'Z';statements.push(statement('events',{id,created_at:at}),statement('source_events',{id:source,provider:'trace',scope:'report-account',account_id:'report-account',native_id:String(i),local_day:'2026-09-01',time_precision:'day',type:'game',status:'FINAL',conditional:0,home_source_team_id:sourceTeam,home_label:'Us',away_label:'Them',home_score:3,away_score:1,title:'Game',venue,evidence:'{}',content_hash:'event-'+i,observed_at:at}),statement('team_event_rows',{run_id:run,app_team_id:team,team_season_id:season,event_id:id,local_day:'2026-09-01',type:'game',status:'FINAL',conditional:0,own_side:'home',home_name:'Us',away_name:'Them',home_score:3,away_score:1,goals_for:3,goals_against:1,title:'Game',venue,source_ids:JSON.stringify([source]),schedule_source_id:source,result_source_id:source}));}await h.db.batch(statements);}
  const start=performance.now(),response=await h.request('/api/reports/snapshots',{method:'POST',body:{...scope,type:'matches',sort:'location'}});assert.equal(response.status,202,JSON.stringify(response.data));assert.equal(response.data.data.state,'ready');assert.equal(response.data.data.captured,250);const id=response.data.data.snapshot_id,httpMs=performance.now()-start;
  const row=await h.db.prepare('SELECT total,captured,state,(SELECT SUM(length(CAST(row_json AS BLOB))) FROM report_rows WHERE snapshot_id=s.id) row_bytes,length(CAST(query_sql AS BLOB)) sql_bytes FROM report_snapshots s WHERE id=?').bind(id).first();assert.equal(row.state,'ready');assert.ok(row.row_bytes<512*1024);assert.ok(row.sql_bytes<48000);
  // Count every actual epoch wrapper statement, reserving owner/installation
  // overhead separately. The real HTTP path above independently enforces48.
  const budget=new BudgetDB(h.rawDb,48),db=wrapDatabase(budget),cursor=new CursorCodec(new Uint8Array(32).fill(5));budget.reserve(16);const reports=new ReportingService(db,{cursor,coordinator:new JobCoordinator(db)});assert.equal((await reports.create(scope,{type:'matches',sort:'location'})).data.state,'ready');assert.ok(budget.used<=48);
  console.log(JSON.stringify({native_admission_bound:{...row,http_ms:Math.round(httpMs),epoch_statements_with_16_reserved:budget.used}}));
  // Largest accepted admission fields are a separate work bound from an
  // ordinary short-field PDF. Preserve that immutable large snapshot.
  await h.db.batch([h.db.prepare("UPDATE team_event_rows SET venue='Field Q'||CAST(substr(event_id,14) AS INTEGER)||'Z' WHERE run_id=?").bind(run),h.db.prepare("DELETE FROM team_event_rows WHERE run_id=? AND CAST(substr(event_id,14) AS INTEGER)>=137").bind(run),h.db.prepare('UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=?').bind(team)]);
  const small=await h.request('/api/reports/snapshots',{method:'POST',body:{...scope,type:'matches',sort:'location'}});assert.equal(small.status,202,JSON.stringify(small.data));assert.equal(small.data.data.captured,137);const exportSnapshot=small.data.data.snapshot_id;
  const files=[];for(const format of ['xlsx','pdf']){const requested=await h.request('/api/reports/'+exportSnapshot+'/exports',{method:'POST',body:{format}});assert.equal(requested.status,202,JSON.stringify(requested.data));files.push(requested.data);}
  await h.waitFor(async()=>{const rows=(await h.db.prepare('SELECT state,error_code FROM report_exports WHERE snapshot_id=?').bind(exportSnapshot).all()).results;const bad=(await h.db.prepare("SELECT provider,component,state,last_error_code,last_error_message FROM sync_jobs WHERE state IN('failed','blocked','retrying')").all()).results;assert.deepEqual(bad,[]);return rows.length===2&&rows.every(r=>r.state==='ready');},{timeout:120000});
  for(const file of files){const response=await h.request('/api/reports/exports/'+file.id+'/download',{binary:true});assert.equal(response.status,200);assert.ok(response.data.length>1000);}
  // A real native coordinator services both classes while synthetic import
  // pages advance native source clocks and canonical content. No provider HTTP
  // or external account is involved. Every mutation uses the production fence.
  const now=Date.now()+3600000,jobs=new JobCoordinator(h.db,{clock:()=>now,publicHistory:true,pageDelayMs:0}),localReports=new ReportingService(h.db,{coordinator:jobs,cursor,now:()=>now,fontLoader:()=>readFile(new URL('../web/assets/report-font.ttf',import.meta.url))});
  const ordinary=await jobs.enqueue({provider:'trace',component:'game',stage:'source',scope:'synthetic-busy-source',resourceKey:'busy-source',accountId:'report-account',accountGeneration:1,priority:100,recurring:false},[{kind:'team',teamId:team,key:'busy-source'}]);
  const saved=new Map(),ctx={storage:{async get(k){return saved.get(k);},async put(k,v){saved.set(k,v);},async getAlarm(){return saved.get('alarm')??null;},async setAlarm(at){saved.set('alarm',at);},async deleteAlarm(){saved.delete('alarm');}}},turns=[],statementCounts=[];
  const Runtime=createSyncRuntime(async context=>{
    if(context.lease.provider==='reports'){turns.push('report');return new ReportingService(context.db,{now:()=>now,fontLoader:localReports.fontLoader}).collect(context);}
    turns.push('ordinary');const page=context.checkpoint.page||0,relevant=page%2===1,changed='Imported page '+page,target=relevant?'0':'249';
    const built=await new DomainRepository(context.db).buildSourcePage({accountId:'report-account',generation:1,fixtures:[{provider:'trace',native_id:target,home_id:relevant?'trace:report':'trace:other',away_id:null,local_day:'2026-09-01',type:'game',status:'FINAL',conditional:0,home_score:3,away_score:1,payload:JSON.stringify({home_name:'Us',away_name:'Them',title:'Game',venue:changed}),observed_at:new Date().toISOString()}]});assert.equal(built.changed,true);
    // Simulated publication is explicit here: this gate exercises production
    // source writes and encoders, not a complete provider/projector traversal.
    return {statements:[...built.statements,...(relevant?[{sql:'UPDATE team_event_rows SET venue=? WHERE run_id=? AND event_id=? AND $FENCE',params:[changed,run,'report-event-0']},{sql:'UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=? AND $FENCE',params:[team]}]:[])],checkpoint:{page:page+1},complete:page>=999,coverage:'partial'};
  },{clock:()=>now,pageDelayMs:0,publicHistory:true,reportFairness:true,statementLimit:50,wrapDatabase:raw=>wrapDatabase(raw),inspectInstallation:async({db})=>{const state=await new InstallationUpgrade(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:TEST_PASSWORD}).inspect();return state.state==='ready'?{...state,identity:state.schema_fingerprint+':'+state.started_at}:state;}});
  const step=async()=>{await new Runtime(ctx,{DB:h.rawDb}).run();const result=saved.get('last_run');assert.ok(!['error','failed','blocked','retrying'].includes(result.state),JSON.stringify(result));statementCounts.push(result.statements);assert.ok(result.statements<=50);};
  await step();assert.deepEqual(turns,['ordinary']);const before=await h.db.prepare('SELECT revision FROM source_serialization_clock WHERE id=1').first();
  const busy=(await localReports.create(scope,{type:'matches',sort:'location'})).data;assert.equal(busy.state,'ready');assert.equal(busy.captured,137);const busyFiles=[];for(const format of ['xlsx','pdf'])busyFiles.push(await localReports.requestExport(busy.snapshot_id,format));
  for(let i=0;i<80;i++){await step();if((await h.db.prepare('SELECT state FROM report_exports WHERE snapshot_id=?').bind(busy.snapshot_id).all()).results.every(row=>row.state==='ready'))break;}
  const remaining=await h.db.prepare('SELECT state,checkpoint FROM sync_jobs WHERE id=?').bind(ordinary).first();assert.equal(remaining.state,'queued');const ordinaryPages=JSON.parse(remaining.checkpoint).page;assert.ok(ordinaryPages>1&&ordinaryPages<1000);assert.ok((await h.db.prepare('SELECT revision FROM source_serialization_clock WHERE id=1').first()).revision>before.revision);assert.match((await h.db.prepare('SELECT venue FROM team_event_rows WHERE run_id=? AND event_id=?').bind(run,'report-event-0').first()).venue,/Imported page/);
  const out=new URL('../tmp/report-service-latency-native/',import.meta.url);await mkdir(out,{recursive:true});const expected=Array.from({length:137},(_,i)=>'Field Q'+i+'Z');
  for(const file of busyFiles){const status=await localReports.exportStatus(file.id);assert.equal(status.state,'ready');const filePath=new URL('busy.'+file.format,out);await writeFile(filePath,new Uint8Array(await (await localReports.download(file.id)).arrayBuffer()));if(file.format==='xlsx'){const rows=JSON.parse(execFileSync('python',['-c',"import json,openpyxl,sys\nw=openpyxl.load_workbook(sys.argv[1],data_only=True)\nprint(json.dumps([r[4] for r in list(w['Report'].values)[1:]]))",filePath.pathname],{encoding:'utf8'}));assert.deepEqual(rows,expected);}else{const text=execFileSync('pdftotext',['-layout',filePath.pathname,'-'],{encoding:'utf8'});assert.deepEqual([...text.matchAll(/Field Q\d+Z/g)].map(m=>m[0]),expected);}}
  console.log(JSON.stringify({native_report_service:{admission_rows:row.captured,admission_bytes:row.row_bytes,http_ms:Math.round(httpMs),epoch_statements_with_16_reserved:budget.used,actual_http_budget:48,busy_rows:137,parsed_files:2,ordinary_pages:ordinaryPages,ordinary_state:remaining.state,turns:turns.length,max_statements:Math.max(...statementCounts),installation_inspected:true,production_source_pages:true,simulated_publication:true,persisted_turn_restart:true}}));
 }catch(error){console.error(JSON.stringify({native_report_failure:{message:error.message,jobs:(await h.db.prepare('SELECT provider,component,state,last_error_code,last_error_message FROM sync_jobs').all()).results}}));throw error;}finally{await h.dispose();}
});
