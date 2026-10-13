import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {APPLICATION_SCHEMA} from '../src/application/installation-schema.js';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {ApplicationSyncService,collectApplicationJob} from '../src/application/sync-service.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {ReportingService} from '../src/reporting/service.js';
import {attendanceStateQuery} from '../src/read-model/attendance.js';
import {TEAMSNAP_FULL_REFRESH_MS} from '../src/sources/teamsnap-refresh.js';

const TEAM='321',EVENT='501',PLAYER='701';
const clone=value=>JSON.parse(JSON.stringify(value));

// Production repository, collector, scheduler, projection, capture and encoders;
// only the provider HTTP response and D1-shaped in-memory SQLite adapter are fake.
async function fixture({seedAttendance=true}={}) {
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const sql of APPLICATION_SCHEMA)sqlite.exec(sql);
 sqlite.prepare('INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,1,?)').run(new Date().toISOString());
 const values=params=>params.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value);
 const prepare=(sql,params=[])=>({sql,params,bind(...next){return prepare(sql,next);},async all(){const results=sqlite.prepare(sql).all(...values(params)).map(row=>({...row}));return {results,meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return (await this.all()).results[0]??null;},async run(){return this.all();}});
 const db={prepare,async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.all());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 let now=Date.now(),providerRows=[{event_id:EVENT,member_id:PLAYER,team_id:TEAM,status_code:1}];
 const clock=()=>now,repo=new DomainRepository(db),jobs=new JobCoordinator(db,{clock}),sync=new ApplicationSyncService(db,{}, {coordinatorOptions:{clock}});
 const reports=new ReportingService(db,{coordinator:jobs,now:clock,fontLoader:()=>readFile(new URL('../web/assets/report-font.ttf',import.meta.url))});
 const account=await repo.registerAccount({provider:'teamsnap',nativeId:'123',name:'Report refresh account'});
 const team=await repo.createTeam({name:'Report refresh team',timezone:'UTC',seasonYear:2026}),scope={team_id:team.id,team_season_id:team.season_id};
 const sourceTeam=sourceKey('teamsnap',TEAM,account.id),sourceEvent=sourceKey('teamsnap',EVENT,account.id),observed=new Date().toISOString();
 await repo.ingestSourcePage({accountId:account.id,generation:account.generation,records:{
  teams:[{provider:'teamsnap',native_id:TEAM,name:team.name,archived:0,details:JSON.stringify({account_owned:true}),observed_at:observed}],
  players:[{provider:'teamsnap',native_id:PLAYER,name:'Ada Player',jersey:'7',details:'{}',observed_at:observed}],
  team_players:[{team_id:'teamsnap:'+TEAM,player_id:'teamsnap:'+PLAYER,active:1,scan_id:'roster-seed'}],
 },fixtures:[{provider:'teamsnap',native_id:EVENT,home_id:'teamsnap:'+TEAM,away_id:null,starts_at:'2026-09-01T18:00:00.000Z',type:'practice',status:'SCHEDULED',conditional:0,payload:JSON.stringify({home_name:team.name,away_name:'Practice',title:'Training',venue:'Field',availability_enabled:true}),observed_at:observed}]});
 const requests=[];
 const options={reportCollector:context=>reports.collect(context),credentialLoader:async()=> 'synthetic-test-credential',transportFactory:()=>({observations:[],async get(value){
  const url=new URL(value);requests.push(url.href);assert.equal(url.pathname,'/v3/availabilities/search');assert.equal(url.searchParams.get('team_id'),TEAM);
  const size=Number(url.searchParams.get('page_size')),number=Number(url.searchParams.get('page_number')),rows=providerRows.slice((number-1)*size,number*size),at=new Date().toISOString();
  this.observations.push({endpoint:url.origin+url.pathname,status:200,at,retrieved_at:at,hash:'a'.repeat(64),bytes:1000,rows_count:rows.length});
  return {value:{collection:{items:rows.map(row=>({data:Object.entries(row).map(([name,value])=>({name,value}))})),page_info:{total_items:providerRows.length,page_size:size,page_number:number},links:[]}}};
 }})};
 const collect=context=>collectApplicationJob(context,options);
 const step=async()=>{now+=2000;return jobs.runOne(collect,{env:{}});};
 const claim=async()=>{now+=2000;return jobs.claim();};
 const all=(sql,...params)=>sqlite.prepare(sql).all(...params).map(row=>({...row}));
 async function drain(){for(let i=0;i<160;i++){const result=await step();assert.ok(!['failed','blocked','retrying'].includes(result.state),JSON.stringify(result));if(result.state==='idle')return;}assert.fail('Bounded fixture work did not settle.');}
 let jobId;
 async function enqueueAttendance(){jobId=await jobs.enqueue({provider:'teamsnap',component:'attendance',stage:'source',scope:'teamsnap:'+TEAM,resourceKey:'teamsnap:'+TEAM,accountId:account.id,accountGeneration:account.generation,args:{team_id:TEAM},priority:100,recurring:false,intervalMs:900000},[{kind:'account',key:account.id}]);}
 if(seedAttendance){await enqueueAttendance();await drain();}
 await repo.attachTeam({teamId:team.id,seasonId:team.season_id,sourceTeamId:sourceTeam,accountId:account.id});
 await sync.recoverLocalDemand({wake:false});await drain();
 assert.equal(all('SELECT pending FROM team_projection_state')[0].pending,0);
 assert.equal(all('SELECT * FROM team_players').length,1);assert.equal(all('SELECT * FROM team_events').length,1);
 if(!seedAttendance)await enqueueAttendance();
 const sourceJob=()=>all('SELECT * FROM sync_jobs WHERE id=?',jobId)[0];
 const coverage=()=>all("SELECT * FROM source_component_coverage WHERE account_id=? AND kind='attendance' AND scope=?",account.id,'teamsnap:'+TEAM)[0];
 const state=()=>attendanceStateQuery(db,scope).first();
 async function startRefresh({full=false}={}){
  const checkpoint=JSON.parse(sourceJob().checkpoint);
  assert.equal(checkpoint.finished,true);
  if(full){checkpoint.refresh.full.started_at=Date.now()-TEAMSNAP_FULL_REFRESH_MS-60000;checkpoint.refresh.full.completed_at=checkpoint.refresh.full.started_at+1000;checkpoint.refresh.recent=null;}
  // Make the ordinary recurring job due; claim must preserve its full receipt.
  sqlite.prepare('UPDATE sync_jobs SET recurring=1,next_at=0,checkpoint=? WHERE id=?').run(JSON.stringify(checkpoint),jobId);
 }
 const create=async(type='availability')=>reports.snapshot((await reports.create(scope,{type})).data.snapshot_id);
 return {sqlite,db,repo,sync,jobs,reports,scope,account,sourceTeam,sourceEvent,requests,collect,claim,step,drain,all,sourceJob,coverage,state,startRefresh,create,setRows:rows=>{providerRows=rows;},close:()=>sqlite.close()};
}

for(const full of [false,true])test(`queued reports survive unchanged TeamSnap ${full?'full reconciliation':'recent refresh'} and produce real Excel/PDF files`,async()=>{
 const f=await fixture();try{
  const snapshots=[];for(const type of ['season','matches','players','availability'])snapshots.push(await f.create(type));
  const before=await f.state(),accepted=clone(f.coverage()),eventState=f.all('SELECT * FROM source_event_state');
  await f.startRefresh({full});assert.equal((await f.step()).provider,'teamsnap');
  assert.equal(f.sourceJob().state,'queued');assert.equal(f.sourceJob().coverage,'partial');
  assert.equal(JSON.parse(f.sourceJob().checkpoint).refresh.active.mode,full?'full':'recent');
  assert.deepEqual(f.coverage(),accepted,'an in-progress refresh keeps the accepted full-history receipt');
  assert.equal((await f.state()).attendance_source_revision,before.attendance_source_revision,'scan progress is not a source-content edit');
  assert.deepEqual(f.all('SELECT * FROM source_event_state'),eventState,'unchanged responses do not dirty event inputs');
  await f.drain();
  assert.equal((await f.state()).content_revision,before.content_revision,'unchanged auxiliary rows do not republish the team');
  assert.equal((await f.state()).attendance_source_revision,before.attendance_source_revision);
  assert.deepEqual(f.coverage(),accepted,'scan IDs and observation timestamps do not rewrite semantic coverage');
  const exports=[];
  for(const admitted of snapshots){
   const snapshot=await f.reports.snapshot(admitted.id),preview=(await f.reports.preview(admitted.id)).data;
   assert.equal(snapshot.state,'ready',admitted.type+' must really capture, not just finish its scheduler job');assert.equal(snapshot.error_code,null);assert.equal(snapshot.captured,snapshot.total);assert.ok(snapshot.captured>0);assert.equal(preview.state,'ready');
   if(admitted.type==='matches'||admitted.type==='players')assert.equal(preview.rows.items[0].attendance,'100%');
   if(admitted.type==='availability')assert.equal(preview.rows.items[0].yes_pct,100);
   for(const format of ['xlsx','pdf'])exports.push(await f.reports.requestExport(admitted.id,format));
  }
  await f.drain();
  for(const exported of exports){
   const status=await f.reports.exportStatus(exported.id);assert.equal(status.state,'ready');assert.equal(status.error_code,null);
   const response=await f.reports.download(exported.id),bytes=Buffer.from(await response.arrayBuffer());
   assert.equal(bytes.length,status.byte_length);assert.ok(bytes.length>1000);assert.equal(bytes.subarray(0,exported.format==='pdf'?5:2).toString(),exported.format==='pdf'?'%PDF-':'PK');
   assert.match(response.headers.get('content-disposition'),new RegExp('\\.'+exported.format+'"$'));
  }
 }finally{f.close();}
});

test('a genuine attendance response change invalidates an admitted report before capture',async()=>{
 const f=await fixture();try{
  const snapshot=await f.create(),before=await f.state();
  f.setRows([{event_id:EVENT,member_id:PLAYER,team_id:TEAM,status_code:0}]);
  await f.startRefresh();assert.equal((await f.step()).provider,'teamsnap');
  assert.ok((await f.state()).attendance_source_revision>before.attendance_source_revision);
  assert.equal(f.all('SELECT status FROM source_attendance')[0].status,'No');
  await f.drain();
  const saved=await f.reports.snapshot(snapshot.id);assert.equal(saved.state,'failed');assert.equal(saved.error_code,'report_changed');assert.equal(saved.captured,0);
  assert.equal((await f.reports.preview(snapshot.id)).data.state,'failed');
  await assert.rejects(f.reports.requestExport(snapshot.id,'xlsx'),error=>error.code==='report_not_ready');
 }finally{f.close();}
});

for(const change of [{complete:false,count:1},{complete:true,count:2},{complete:true,count:1,availability:'restricted'}])test(`genuine untyped coverage changes invalidate reports: ${JSON.stringify(change)}`,async()=>{
 const f=await fixture();try{
  const snapshot=await f.create(),before=await f.state();
  const built=await f.repo.ingestSourcePage({accountId:f.account.id,generation:f.account.generation,scanId:'external-coverage-change',sourceCoverage:[{provider:'teamsnap',account_id:f.account.id,kind:'attendance',scope:'teamsnap:'+TEAM,...change,observed_at:new Date().toISOString()}]});
  assert.equal(built.changed,true);assert.ok((await f.state()).attendance_source_revision>before.attendance_source_revision);
  assert.equal(f.coverage().complete,+change.complete);assert.equal(f.coverage().record_count,change.count);
  await f.drain();const saved=await f.reports.snapshot(snapshot.id);assert.equal(saved.state,'failed');assert.equal(saved.error_code,'report_changed');assert.equal(saved.captured,0);
 }finally{f.close();}
});

test('partial first scan and terminal page revoked before commit cannot grant complete coverage',async()=>{
 const f=await fixture({seedAttendance:false});try{
  assert.equal(f.coverage(),undefined);assert.equal((await f.step()).provider,'teamsnap');
  assert.equal(f.coverage().complete,0);assert.equal(JSON.parse(f.sourceJob().checkpoint).refresh.full,null);
  // First-page changes can enqueue projection; let those run before claiming the
  // terminal source page, then revoke precisely between collection and commit.
  let lease;for(let i=0;i<20;i++){lease=await f.claim();assert.ok(lease);if(lease.provider==='teamsnap')break;await f.jobs.commit(lease,await f.collect({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint}));lease=null;}
  assert.ok(lease);const terminal=await f.collect({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});assert.equal(terminal.complete,true);
  const prior=clone(f.coverage());await f.repo.disconnectAccount(f.account.id);
  const result=await f.jobs.commit(lease,terminal);assert.equal(result.committed,false);assert.deepEqual(f.coverage(),prior);assert.equal(f.coverage().complete,0);
  assert.equal(JSON.parse(f.sourceJob().checkpoint).refresh.full,null,'uncommitted terminal receipt grants no authority');
 }finally{f.close();}
});

test('meaningful unrelated provider changes still invalidate the conservative global attendance fence',async()=>{
 const f=await fixture();try{
  const snapshot=await f.create(),before=await f.state();
  const page=await f.repo.ingestSourcePage({records:{teams:[{provider:'gotsport',native_id:'900',name:'Unrelated public team',archived:0,details:'{}',observed_at:new Date().toISOString()}]}});
  assert.equal(page.changed,true);assert.deepEqual(page.affectedTeams,[]);
  const after=await f.state();assert.equal(after.content_revision,before.content_revision);assert.ok(after.attendance_source_revision>before.attendance_source_revision);
  await f.drain();const saved=await f.reports.snapshot(snapshot.id);assert.equal(saved.state,'failed');assert.equal(saved.error_code,'report_changed');assert.equal(saved.captured,0);
 }finally{f.close();}
});

test('an unchanged attendance replay does not fan out when another auxiliary fact changes',async()=>{
 const f=await fixture();try{
  const snapshot=await f.create(),before=await f.state(),eventState=f.all('SELECT * FROM source_event_state'),projection=f.all('SELECT * FROM team_projection_state');
  const page=await f.repo.ingestSourcePage({accountId:f.account.id,generation:f.account.generation,records:{
   teams:[{provider:'gotsport',native_id:'902',name:'Another public team',archived:0,details:'{}',observed_at:new Date().toISOString()}],
   references_data:[{team_id:'gotsport:902',id:'venue',kind:'locations',value:JSON.stringify({name:'New public venue'}),observed_at:new Date().toISOString()}],
   attendance:[{fixture_id:'teamsnap:'+EVENT,player_id:'teamsnap:'+PLAYER,team_id:'teamsnap:'+TEAM,account_id:f.account.id,status:'1',normalized_status:'Yes',observed_at:new Date().toISOString()}],
  }});
  assert.equal(page.changed,true);assert.deepEqual(page.affectedTeams,[],'only changed auxiliary rows may contribute affected event IDs');
  assert.deepEqual(f.all('SELECT * FROM source_event_state'),eventState);assert.deepEqual(f.all('SELECT * FROM team_projection_state'),projection);
  assert.ok((await f.state()).attendance_source_revision>before.attendance_source_revision,'the unrelated real fact still advances the conservative global fence');
  await f.drain();assert.equal((await f.reports.snapshot(snapshot.id)).error_code,'report_changed');
 }finally{f.close();}
});

const invalidRefreshes=[
 ['legacy checkpoint',page=>{delete page.checkpoint.refresh;}],
 ['malformed full receipt',page=>{page.checkpoint.refresh.full.digest='not-a-digest';}],
 ['foreign account',page=>{page.checkpoint.refresh.binding.account_id='another-account';}],
 ['stale authorization',page=>{page.checkpoint.refresh.binding.authorization_generation++;}],
 ['foreign team',page=>{page.checkpoint.refresh.binding.team_id='999';}],
 ['wrong component',page=>{page.component='events';}],
 ['foreign resource key',page=>{page.resourceKey='teamsnap:999';}],
 ['malformed active window',page=>{page.checkpoint.refresh.active.filters={started_after:'2026-09-01'};}],
 ['inconsistent full total',page=>{page.checkpoint.refresh.full.total=99;}],
];
for(const [name,invalidate] of invalidRefreshes)test(`${name} cannot disguise genuine false coverage as routine progress`,async()=>{
 const f=await fixture();try{
  const snapshot=await f.create(),before=await f.state();await f.startRefresh({full:true});
  const lease=await f.claim();assert.equal(lease.provider,'teamsnap');
  const collected=await f.collect({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});
  assert.equal(collected.complete,false);
  const page={provider:'teamsnap',component:'attendance',resourceKey:'teamsnap:'+TEAM,accountId:f.account.id,generation:f.account.generation,scanId:lease.scan_id,checkpoint:clone(collected.checkpoint),sourceCoverage:[{provider:'teamsnap',account_id:f.account.id,kind:'attendance',scope:'teamsnap:'+TEAM,complete:false,count:1,observed_at:new Date().toISOString()}]};
  invalidate(page);const built=await f.repo.ingestSourcePage(page);
  assert.equal(built.changed,true);assert.equal(f.coverage().complete,0);assert.ok((await f.state()).attendance_source_revision>before.attendance_source_revision);
  await f.drain();const saved=await f.reports.snapshot(snapshot.id);assert.equal(saved.state,'failed');assert.equal(saved.error_code,'report_changed');
 }finally{f.close();}
});

test('file imports cannot use refresh metadata to grant or retain provider coverage authority',async()=>{
 const f=await fixture();try{
  const snapshot=await f.create(),before=await f.state(),accepted=clone(f.coverage());await f.startRefresh({full:true});
  const lease=await f.claim(),collected=await f.collect({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});
  await assert.rejects(f.repo.ingestSourcePage({provenance:'file_import',provider:'teamsnap',component:'attendance',resourceKey:'teamsnap:'+TEAM,accountId:f.account.id,generation:f.account.generation,checkpoint:collected.checkpoint,sourceCoverage:[{provider:'teamsnap',account_id:f.account.id,kind:'attendance',scope:'teamsnap:'+TEAM,complete:true,count:99}]}),error=>error.code==='import_authority');
  assert.deepEqual(f.coverage(),accepted);assert.equal((await f.state()).attendance_source_revision,before.attendance_source_revision);
  await f.drain();assert.equal((await f.reports.snapshot(snapshot.id)).state,'ready');
 }finally{f.close();}
});

for(const reconnect of [false,true])test(`${reconnect?'reconnected authorization':'legacy checkpoint reset'} cannot carry complete coverage into a fresh full scan`,async()=>{
 const f=await fixture();try{
  const accepted=clone(f.coverage());assert.equal(accepted.complete,1);
  const current=reconnect?await f.repo.registerAccount({provider:'teamsnap',nativeId:'123',name:'Report refresh account'}):f.account;
  await f.jobs.restartAccount(current.id);assert.deepEqual(JSON.parse(f.sourceJob().checkpoint),{});
  const snapshot=await f.create(),before=await f.state();assert.equal((await f.step()).provider,'teamsnap');
  const refresh=JSON.parse(f.sourceJob().checkpoint).refresh;
  assert.equal(refresh.binding.authorization_generation,current.generation);assert.equal(refresh.full,null);assert.equal(refresh.active.mode,'full');
  assert.equal(f.coverage().complete,0,'previous generation or reset proof cannot grant complete authority');
  assert.ok((await f.state()).attendance_source_revision>before.attendance_source_revision,'losing accepted authority is still a genuine evidence change');
  await f.drain();const saved=await f.reports.snapshot(snapshot.id);assert.equal(saved.state,'failed');assert.equal(saved.error_code,'report_changed');
 }finally{f.close();}
});

for(const diagnostics of [{availability:'restricted'},{heatmap_availability:'unpublished'}])test(`typed recent coverage diagnostics remain real evidence changes: ${JSON.stringify(diagnostics)}`,async()=>{
 const f=await fixture();try{
  const snapshot=await f.create(),before=await f.state(),accepted=clone(f.coverage());await f.startRefresh();
  const lease=await f.claim(),collected=await f.collect({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});
  assert.equal(collected.checkpoint.refresh.active.mode,'recent');
  const built=await f.repo.ingestSourcePage({provider:'teamsnap',component:'attendance',resourceKey:'teamsnap:'+TEAM,accountId:f.account.id,generation:f.account.generation,scanId:lease.scan_id,checkpoint:collected.checkpoint,sourceCoverage:[{provider:'teamsnap',account_id:f.account.id,kind:'attendance_recent',scope:'teamsnap:'+TEAM,complete:false,count:1,...diagnostics,observed_at:new Date().toISOString()}]});
  assert.equal(built.changed,true);assert.deepEqual(f.coverage(),accepted,'a diagnostic does not rewrite the full-history receipt');
  const recent=f.all("SELECT * FROM source_component_coverage WHERE kind='attendance_recent'")[0];for(const [key,value] of Object.entries(diagnostics))assert.equal(recent[key],value);
  assert.ok((await f.state()).attendance_source_revision>before.attendance_source_revision);
  await f.drain();const saved=await f.reports.snapshot(snapshot.id);assert.equal(saved.state,'failed');assert.equal(saved.error_code,'report_changed');
 }finally{f.close();}
});

const publicStanding=(division,participant,rank,scanId)=>({division_id:'gotsport:'+division,pool_id:'all',team_id:participant,rank,scan_id:scanId,payload:JSON.stringify({name:'Public team '+participant,mp:1,w:1,d:0,l:0,gf:2,ga:0,gd:2,pts:3}),observed_at:new Date().toISOString()});
async function seedPublicDivisions(f,{attach=false}={}){
 const coverage=['902','905'].flatMap(division=>[
  {provider:'gotsport',kind:'division_schedule',scope:'gotsport:'+division,complete:true,count:1},
  {provider:'gotsport',kind:'standings',scope:'gotsport:'+division,complete:true,count:division==='902'?2:1,availability:'published'},
 ]);
 await f.repo.ingestSourcePage({scanId:'public-seed',records:{
  teams:['900','904'].map(native_id=>({provider:'gotsport',native_id,name:'Public team '+native_id,archived:0,details:'{}'})),
  competitions:[{provider:'gotsport',native_id:'901',name:'Public league',kind:'league',details:'{}'}],
  divisions:['902','905'].map(id=>({id:'gotsport:'+id,competition_id:'gotsport:901',name:'Division '+id,details:'{}'})),
  standings:[publicStanding('902','gotsport:900',1,'public-seed'),publicStanding('902','registration:spare',2,'public-seed'),publicStanding('905','gotsport:904',1,'public-seed')],
 },fixtures:[['903','902','900'],['906','905','904']].map(([native_id,division,team])=>({provider:'gotsport',native_id,competition_id:'gotsport:901',division_id:'gotsport:'+division,home_id:'gotsport:'+team,away_id:null,starts_at:'2026-09-02T18:00:00.000Z',type:'game',status:'SCHEDULED',conditional:0,payload:JSON.stringify({home_name:'Public team '+team,away_name:'Opponent',title:'League game',venue:'Public field'})})),sourceCoverage:coverage});
 let other=null;
 if(attach){
  await f.repo.attachTeam({teamId:f.scope.team_id,seasonId:f.scope.team_season_id,sourceTeamId:sourceKey('gotsport','900')});
  other=await f.repo.createTeam({name:'Unaffected division team',timezone:'UTC',seasonYear:2026});
  await f.repo.attachTeam({teamId:other.id,seasonId:other.season_id,sourceTeamId:sourceKey('gotsport','904')});
  await f.sync.recoverProjections({limit:5,wake:false});await f.drain();
 }
 return {coverage,other};
}

test('unchanged public division and standings coverage timestamps preserve exact evidence clocks and report capture',async()=>{
 const f=await fixture();try{
  const {coverage}=await seedPublicDivisions(f),snapshot=await f.create(),before=await f.state();
  const tables=['source_division_coverage','source_standings_coverage','source_component_coverage'],saved=Object.fromEntries(tables.map(table=>[table,f.all('SELECT * FROM '+table+' ORDER BY 1')]));
  const page=await f.repo.ingestSourcePage({scanId:'later-public-scan',sourceCoverage:coverage.map(row=>({...row,observed_at:'2026-10-13T10:00:00.000Z'}))});
  assert.equal(page.changed,false);assert.deepEqual(page.affectedTeams,[]);
  for(const table of tables)assert.deepEqual(f.all('SELECT * FROM '+table+' ORDER BY 1'),saved[table],table+' must ignore retrieval-only refreshes');
  assert.equal((await f.state()).attendance_source_revision,before.attendance_source_revision);
  await f.drain();const captured=await f.reports.snapshot(snapshot.id);assert.equal(captured.state,'ready');assert.equal(captured.error_code,null);assert.equal(captured.captured,1);
 }finally{f.close();}
});

test('a genuine standings replacement removal dirties its division and rejects an admitted report',async()=>{
 const f=await fixture();try{
  const {other}=await seedPublicDivisions(f,{attach:true}),snapshot=await f.create(),before=await f.state(),divisions=f.all('SELECT id,content_revision FROM source_divisions ORDER BY id');
  const page=await f.repo.ingestSourcePage({scanId:'replacement-scan',records:{standings:[publicStanding('902','gotsport:900',1,'replacement-scan')]},replacements:[{kind:'standings',division_id:'gotsport:902',scan_id:'replacement-scan'}]});
  assert.equal(page.changed,true);assert.deepEqual(page.affectedTeams,[{app_team_id:f.scope.team_id,team_season_id:f.scope.team_season_id}]);
  assert.deepEqual(f.all("SELECT participant_key FROM source_standings WHERE source_division_id='gotsport/public/902'"),[{participant_key:'gotsport/public/900'}]);
  const after=f.all('SELECT id,content_revision FROM source_divisions ORDER BY id');
  assert.equal(after[0].content_revision,divisions[0].content_revision+1);assert.equal(after[1].content_revision,divisions[1].content_revision);
  assert.equal(f.all('SELECT pending FROM team_projection_state WHERE team_season_id=?',f.scope.team_season_id)[0].pending,1);
  assert.equal(f.all('SELECT pending FROM team_projection_state WHERE team_season_id=?',other.season_id)[0].pending,0);
  assert.ok((await f.state()).attendance_source_revision>before.attendance_source_revision);
  await f.sync.recoverProjections({limit:5,wake:false});await f.drain();
  const rejected=await f.reports.snapshot(snapshot.id);assert.equal(rejected.state,'failed');assert.equal(rejected.error_code,'report_changed');assert.equal(rejected.captured,0);
 }finally{f.close();}
});
