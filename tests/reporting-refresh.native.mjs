import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshHarness} from './fresh-harness.js';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {ApplicationSyncService,collectApplicationJob} from '../src/application/sync-service.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {ReportingService} from '../src/reporting/service.js';
import {attendanceStateQuery} from '../src/read-model/attendance.js';

const TEAM='7321',EVENT='7501',PLAYER='7701';
const clone=value=>JSON.parse(JSON.stringify(value));

// Native D1 with the complete initialized installation and its real epoch
// wrappers. Only provider HTTP bytes and arrival of due times are synthetic.
// Direct owner-domain commands and no-op wakes prevent an alarm/manual race;
// every source, projection, capture and export uses the production coordinator.
test('native source collector refresh preserves admitted reports and real response edits reject them',async()=>{
 const h=await freshHarness();let jobs;
 try{
  await h.initialize();const db=h.db,rows=async(sql,...params)=>(await db.prepare(sql).bind(...params).all()).results;
  assert.equal((await rows('SELECT * FROM sync_jobs')).length,0);
  let now=Date.now(),status=1;const clock=()=>now,repo=new DomainRepository(db),requests=[],commits=[];
  jobs=new JobCoordinator(db,{clock});
  const sync=new ApplicationSyncService(db,{}, {coordinatorOptions:{clock},wake:async()=>{}});
  // Exercise pre-upgrade queued capture, independently of the default fast path.
  const reports=new ReportingService(db,{captureAtAdmission:false,coordinator:{enqueue:(spec,subscribers)=>jobs.enqueue({...spec,priority:20},subscribers)},now:clock,wake:async()=>{},fontLoader:()=>readFile(new URL('../web/assets/report-font.ttf',import.meta.url))});
  const account=await repo.registerAccount({provider:'teamsnap',nativeId:'7123',name:'Native refresh account'});
  const team=await repo.createTeam({name:'Native refresh reports',timezone:'UTC',seasonYear:2026}),scope={team_id:team.id,team_season_id:team.season_id},observed=new Date().toISOString();
  await repo.ingestSourcePage({accountId:account.id,generation:account.generation,records:{
   teams:[{provider:'teamsnap',native_id:TEAM,name:team.name,archived:0,details:JSON.stringify({account_owned:true}),observed_at:observed}],
   players:[{provider:'teamsnap',native_id:PLAYER,name:'Native Ada',jersey:'7',details:'{}',observed_at:observed}],
   team_players:[{team_id:'teamsnap:'+TEAM,player_id:'teamsnap:'+PLAYER,active:1,scan_id:'native-roster'}],
  },fixtures:[{provider:'teamsnap',native_id:EVENT,home_id:'teamsnap:'+TEAM,away_id:null,starts_at:'2026-09-01T18:00:00.000Z',type:'practice',status:'SCHEDULED',conditional:0,payload:JSON.stringify({home_name:team.name,away_name:'Practice',title:'Native training',venue:'Native field',availability_enabled:true}),observed_at:observed}]});
  const options={reportCollector:context=>reports.collect(context),credentialLoader:async()=> 'synthetic-native-credential',transportFactory:()=>({observations:[],async get(value){
   const url=new URL(value);assert.equal(url.pathname,'/v3/availabilities/search');assert.equal(url.searchParams.get('team_id'),TEAM);requests.push(url.href);
   const size=Number(url.searchParams.get('page_size')),number=Number(url.searchParams.get('page_number')),all=[{event_id:EVENT,member_id:PLAYER,team_id:TEAM,status_code:status}],items=all.slice((number-1)*size,number*size),at=new Date().toISOString();
   this.observations.push({endpoint:url.origin+url.pathname,status:200,at,retrieved_at:at,hash:'a'.repeat(64),bytes:1000,rows_count:items.length});
   return {value:{collection:{items:items.map(item=>({data:Object.entries(item).map(([name,value])=>({name,value}))})),page_info:{total_items:all.length,page_size:size,page_number:number},links:[]}}};
  }})};
  const step=async()=>{now+=2000;const result=await jobs.runOne(context=>collectApplicationJob(context,options),{env:{}});if(result.state!=='idle'){commits.push(result);assert.equal(result.committed,true,JSON.stringify({result,jobs:await rows('SELECT provider,component,state,last_error_code,last_error_message FROM sync_jobs')}));}return result;};
  async function drain(){for(let i=0;i<80;i++){const result=await step();assert.ok(!['failed','blocked','retrying'].includes(result.state),JSON.stringify(result));if(result.state==='idle')return;}assert.fail('Native refresh workflow did not settle within bounded manual work.');}
  const jobId=await jobs.enqueue({provider:'teamsnap',component:'attendance',stage:'source',scope:'teamsnap:'+TEAM,resourceKey:'teamsnap:'+TEAM,accountId:account.id,accountGeneration:account.generation,args:{team_id:TEAM},priority:100,recurring:false,intervalMs:900000},[{kind:'account',key:account.id}]);
  await drain();
  const sourceJob=()=>db.prepare('SELECT * FROM sync_jobs WHERE id=?').bind(jobId).first();
  const coverage=()=>db.prepare("SELECT * FROM source_component_coverage WHERE provider='teamsnap' AND account_id=? AND kind='attendance'").bind(account.id).first();
  assert.equal((await coverage()).complete,1);assert.equal((await coverage()).record_count,1);
  await repo.attachTeam({teamId:team.id,seasonId:team.season_id,sourceTeamId:sourceKey('teamsnap',TEAM,account.id),accountId:account.id});
  await sync.recoverLocalDemand({wake:false});await drain();
  assert.equal((await rows('SELECT * FROM team_players')).length,1);assert.equal((await rows('SELECT * FROM team_events')).length,1);
  const create=async()=>reports.snapshot((await reports.create(scope,{type:'availability'})).data.snapshot_id);
  const admitted=await create(),before=await attendanceStateQuery(db,scope).first(),accepted=clone(await coverage()),projection=await rows('SELECT * FROM team_projection_state'),eventState=await rows('SELECT * FROM source_event_state');
  await db.prepare('UPDATE sync_jobs SET recurring=1,next_at=0 WHERE id=?').bind(jobId).run();
  const firstRefresh=await step();assert.equal(firstRefresh.provider,'teamsnap');assert.equal(firstRefresh.state,'queued');
  const pending=await sourceJob();assert.equal(pending.coverage,'partial');assert.equal(JSON.parse(pending.checkpoint).refresh.active.mode,'recent');
  assert.deepEqual(await coverage(),accepted);assert.deepEqual(await rows('SELECT * FROM team_projection_state'),projection);assert.deepEqual(await rows('SELECT * FROM source_event_state'),eventState);
  assert.equal((await attendanceStateQuery(db,scope).first()).attendance_source_revision,before.attendance_source_revision);
  await drain();
  const ready=await reports.snapshot(admitted.id),preview=(await reports.preview(admitted.id)).data;
  assert.equal(ready.state,'ready');assert.equal(ready.error_code,null);assert.equal(ready.captured,1);assert.equal(preview.state,'ready');assert.equal(preview.rows.items[0].yes_pct,100);
  assert.deepEqual(await coverage(),accepted);const after=await attendanceStateQuery(db,scope).first();assert.equal(after.content_revision,before.content_revision);assert.equal(after.attendance_source_revision,before.attendance_source_revision);
  console.log(JSON.stringify({native_report_refresh_source:{state:(await sourceJob()).state,job_coverage:(await sourceJob()).coverage,accepted_coverage:accepted,after_coverage:await coverage(),before_state:before,after_state:after,event_inputs_before:eventState,event_inputs_after:await rows('SELECT * FROM source_event_state'),projection_before:projection,projection_after:await rows('SELECT * FROM team_projection_state')}}));
  console.log(JSON.stringify({native_report_refresh_capture:{snapshot_state:ready.state,snapshot_error:ready.error_code,captured:ready.captured,total:ready.total,preview_state:preview.state,percentage:preview.rows.items[0].yes_pct,job:await db.prepare("SELECT state,last_error_code FROM sync_jobs WHERE provider='reports' AND component='capture' AND resource_key=?").bind(admitted.id).first()}}));
  const exports=[];for(const format of ['xlsx','pdf'])exports.push(await reports.requestExport(admitted.id,format));await drain();
  const downloaded=[];
  for(const exported of exports){const receipt=await reports.exportStatus(exported.id);assert.equal(receipt.state,'ready');assert.equal(receipt.error_code,null);const response=await reports.download(exported.id),bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,receipt.byte_length);assert.ok(bytes.length>1000);assert.equal(bytes.subarray(0,exported.format==='pdf'?5:2).toString(),exported.format==='pdf'?'%PDF-':'PK');downloaded.push({format:exported.format,bytes:bytes.length});}
  const changed=await create(),oldEvidence=(await attendanceStateQuery(db,scope).first()).attendance_source_revision;
  status=0;await db.prepare('UPDATE sync_jobs SET next_at=0 WHERE id=?').bind(jobId).run();assert.equal((await step()).provider,'teamsnap');
  assert.equal((await db.prepare('SELECT status FROM source_attendance').first()).status,'No');assert.ok((await attendanceStateQuery(db,scope).first()).attendance_source_revision>oldEvidence);
  await drain();
  const rejected=await reports.snapshot(changed.id);assert.equal(rejected.state,'failed');assert.equal(rejected.error_code,'report_changed');assert.equal(rejected.captured,0);assert.equal((await reports.preview(changed.id)).data.state,'failed');
  await assert.rejects(reports.requestExport(changed.id,'xlsx'),error=>error.code==='report_not_ready');
  console.log(JSON.stringify({native_report_refresh_changed_capture:{source_status:(await db.prepare('SELECT status FROM source_attendance').first()).status,snapshot_state:rejected.state,snapshot_error:rejected.error_code,captured:rejected.captured,job:await db.prepare("SELECT state,last_error_code FROM sync_jobs WHERE provider='reports' AND component='capture' AND resource_key=?").bind(changed.id).first()}}));
  assert.equal((await reports.preview(admitted.id)).data.rows.items[0].yes_pct,100,'the already captured report stays immutable after later source changes');
  assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);
  assert.equal(requests.length,6,'initial, unchanged and changed scans each use two real collector traversals');
  console.log(JSON.stringify({native_report_refresh:{source_requests:requests.length,commits:commits.length,accepted_evidence:before.attendance_source_revision,unchanged_evidence:after.attendance_source_revision,unchanged_content:after.content_revision,captured:ready.captured,exports:downloaded,changed_snapshot:rejected.error_code,production_collector:true,native_epoch_commits:true,synthetic_provider:true}}));
 }catch(error){console.error(JSON.stringify({native_report_refresh_failure:{message:error.message,jobs:await h.db.prepare('SELECT provider,component,state,last_error_code,last_error_message FROM sync_jobs').all().then(result=>result.results).catch(()=>[])}}));throw error;}
 finally{await h.dispose();}
});
