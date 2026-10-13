import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {NativeTrackService} from '../src/analysis/tracks.js';
import {analysisSourceCollectionProof} from '../src/analysis/source-collection-proof.js';
test('interactive source proof binds provider event, member, clips and current connection while tolerating own collected output',async()=>{
 const f=analysisFixture();try{
  const service=new NativeTrackService(f.db,{owner:true}),source={...f.all('SELECT * FROM source_events')[0],source_team_id:'source-team',native_team_id:'10',side:'home',generation:1,account_active:1,input_revision:0,attachment_id:'attachment',attachment_generation:1,connection_generation:1,membership_generation:1},member=f.all("SELECT * FROM source_game_members WHERE gid='g1'")[0],context={source,member,selection:{team_id:'team',team_season_id:'season'}};
  const children=await service.sourceChildren(context);assert.equal(children.length,5);const child=children[0],proof=analysisSourceCollectionProof(child.args.analysis_source_proof,{args:child.args,accountId:child.accountId,accountGeneration:child.accountGeneration,teamId:'team',seasonId:'season'}),allowed=()=>f.sqlite.prepare('SELECT '+proof.sql+' AS allowed').get(...proof.params).allowed;
  assert.equal(allowed(),1);f.sqlite.exec("INSERT INTO source_event_state VALUES('source-event',10) ON CONFLICT(source_event_id) DO UPDATE SET input_revision=input_revision+10");assert.equal(allowed(),1);
  for(const mutation of ["UPDATE source_events SET provenance='file_import'","UPDATE source_game_members SET provenance='file_import' WHERE gid='g1'","UPDATE source_trace_components SET provenance='file_import' WHERE kind='clip'","UPDATE provider_accounts SET active=0","UPDATE team_source_connections SET generation=2","UPDATE team_connection_seasons SET generation=2"]){f.sqlite.exec('SAVEPOINT proof');f.sqlite.exec(mutation);assert.equal(allowed(),0,mutation);f.sqlite.exec('ROLLBACK TO proof;RELEASE proof');}
  assert.equal((await service.sourceChildren({...context,source:{...source,provenance:'file_import'}})).length,0);assert.equal((await service.sourceChildren({...context,member:{...member,provenance:'file_import'}})).length,0);assert.throws(()=>analysisSourceCollectionProof(child.args.analysis_source_proof,{args:{...child.args,game_id:'other'},accountId:'account',accountGeneration:1,teamId:'foreign'}),/scope changed/);
 }finally{f.close();}
});
test('actual source-refresh service rejects imported track demand before enqueueing any upstream job',async()=>{
 const {ApplicationSyncService}=await import('../src/application/sync-service.js'),f=analysisFixture();try{
  const source={...f.all('SELECT * FROM source_events')[0],source_team_id:'source-team',native_team_id:'10',side:'home',generation:1,account_active:1,input_revision:0,attachment_id:'attachment',attachment_generation:1,connection_generation:1,membership_generation:1},member=f.all("SELECT * FROM source_game_members WHERE gid='g1'")[0],tracks=new NativeTrackService(f.db,{owner:true}),children=await tracks.sourceChildren({source,member,selection:{team_id:'team',team_season_id:'season'}});
  f.sqlite.exec("UPDATE source_events SET provenance='file_import'");const service=new ApplicationSyncService(f.db,{});let enqueued=false;service.jobs.enqueueMany=async()=>{enqueued=true;throw Error('unexpected upstream admission');};await assert.rejects(()=>service.enqueueTrackSource({teamId:'team',seasonId:'season',eventId:'event',sourceChildren:children},{wake:false}),e=>e.code==='analysis_source_scope');assert.equal(enqueued,false);
 }finally{f.close();}
});
test('legacy queued native job needs current provider evidence and actual live team subscriber',async()=>{
 const {nativeAnalysisCollectionProof}=await import('../src/analysis/source-collection-proof.js'),{SYNC_SCHEMA}=await import('../src/sync/schema.js'),f=analysisFixture();try{
  for(const sql of SYNC_SCHEMA)f.sqlite.exec(sql);f.sqlite.exec("INSERT INTO sync_jobs(id,provider,account_scope,account_id,authorization_generation,component,stage,scope,resource_key,args,checkpoint,scan_id,priority,ready_since,next_at,interval_ms) VALUES('job','trace','account','account',1,'tracking','analysis','scope','resource','{}','{}','scan',1,0,0,1000);INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) VALUES('job','team','attachment','team',1)");
  const proof=nativeAnalysisCollectionProof({jobId:'job',accountId:'account',accountGeneration:1,component:'tracking',args:{game_id:'20',team_id:'10',gid:'g1',half:1,clip:{half:1,game_clip_id:1,start:1000000,duration:1500}}}),allowed=()=>f.sqlite.prepare('SELECT '+proof.sql+' AS allowed').get(...proof.params).allowed;assert.equal(allowed(),1);
  for(const mutation of ["UPDATE source_events SET provenance='file_import'","UPDATE source_game_members SET provenance='file_import' WHERE gid='g1'","UPDATE source_trace_components SET provenance='file_import' WHERE kind='clip'","UPDATE team_source_connections SET active=0","DELETE FROM sync_job_subscribers"]){f.sqlite.exec('SAVEPOINT proof');f.sqlite.exec(mutation);assert.equal(allowed(),0,mutation);f.sqlite.exec('ROLLBACK TO proof;RELEASE proof');}
 }finally{f.close();}
});
test('fixed-root native fetch follows accepted local and owner-corrected season evidence, not UTC date substrings',async()=>{
 const {nativeAnalysisCollectionProof}=await import('../src/analysis/source-collection-proof.js'),{SYNC_SCHEMA}=await import('../src/sync/schema.js'),f=analysisFixture();try{
  for(const sql of SYNC_SCHEMA)f.sqlite.exec(sql);f.sqlite.exec("UPDATE app_teams SET timezone='America/Los_Angeles';UPDATE team_seasons SET year=2025,start_day='2025-06-01',end_day='2026-06-01';UPDATE source_events SET starts_at='2026-06-01T00:30:00Z',local_day=NULL;UPDATE team_event_season_resolutions SET effective_day='2026-05-31';UPDATE team_source_connections SET scope_mode='fixed_seasons';INSERT INTO connection_event_resolutions(connection_id,source_event_id,team_season_id,state,effective_day,basis,source_hash,generation) VALUES('root','source-event','season','resolved','2026-05-31','local_date','test',1);INSERT INTO sync_jobs(id,provider,account_scope,account_id,authorization_generation,component,stage,scope,resource_key,args,checkpoint,scan_id,priority,ready_since,next_at,interval_ms) VALUES('job','trace','account','account',1,'tracking','analysis','scope','resource','{}','{}','scan',1,0,0,1000);INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) VALUES('job','team','connection:root','team',1)");
  const proof=nativeAnalysisCollectionProof({jobId:'job',accountId:'account',accountGeneration:1,component:'tracking',args:{game_id:'20',team_id:'10',gid:'g1',half:1,clip:{half:1,game_clip_id:1,start:1000000,duration:1500}}}),allowed=()=>f.sqlite.prepare('SELECT '+proof.sql+' AS allowed').get(...proof.params).allowed;
  for(const key of ['connection:root','attachment']){f.sqlite.prepare('UPDATE sync_job_subscribers SET demand_key=?').run(key);assert.equal(allowed(),1,'accepted May31 local membership survives UTC June1');for(const mutation of ["UPDATE connection_event_resolutions SET state='pending'","UPDATE connection_event_resolutions SET state='conflict'","UPDATE connection_event_resolutions SET generation=2","UPDATE team_connection_seasons SET excluded=1","UPDATE team_event_season_resolutions SET team_season_id=NULL,state='pending'"]){f.sqlite.exec('SAVEPOINT proof');f.sqlite.exec(mutation);assert.equal(allowed(),0,mutation);f.sqlite.exec('ROLLBACK TO proof;RELEASE proof');}}
 }finally{f.close();}
});
test('team native analytics accepts either verified participant side but never opponent player tracks',async()=>{
 const {nativeAnalysisCollectionProof}=await import('../src/analysis/source-collection-proof.js'),{SYNC_SCHEMA}=await import('../src/sync/schema.js'),f=analysisFixture();try{for(const sql of SYNC_SCHEMA)f.sqlite.exec(sql);f.sqlite.exec("UPDATE source_trace_components SET evidence='{\"moment_count\":0,\"home\":{\"team_id\":\"10\"},\"away\":{\"team_id\":\"11\"}}' WHERE kind='header';INSERT INTO sync_jobs(id,provider,account_scope,account_id,authorization_generation,component,stage,scope,resource_key,args,checkpoint,scan_id,priority,ready_since,next_at,interval_ms) VALUES('job','trace','account','account',1,'analytics','analysis','scope','resource','{}','{}','scan',1,0,0,1000);INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) VALUES('job','team','attachment','team',1)");
  const allowed=args=>{const p=nativeAnalysisCollectionProof({jobId:'job',accountId:'account',accountGeneration:1,component:'analytics',args:{game_id:'20',team_id:'10',period:{id:'full',start:null,end:null},...args}});return f.sqlite.prepare('SELECT '+p.sql+' AS allowed').get(...p.params).allowed;};assert.equal(allowed({side:'home',player_id:'team',gids:[]}),1);assert.equal(allowed({side:'away',player_id:'team',gids:[]}),1);assert.equal(allowed({side:'away',player_id:'trace:1',gids:['g1']}),0);f.sqlite.exec("UPDATE source_trace_components SET provenance='file_import' WHERE kind='header'");assert.equal(allowed({side:'away',player_id:'team',gids:[]}),0);
 }finally{f.close();}
});

test('balanced owner proof retains all five native scopes and every persisted authority fence',async()=>{
 const f=analysisFixture();try{
  const tracks=new NativeTrackService(f.db,{owner:true}),context=await tracks.context({team_id:'team',team_season_id:'season'},'event'),member=f.all("SELECT * FROM source_game_members WHERE gid='g1'")[0];
  const children=await tracks.sourceChildren({...context,member}),proofs=children.map(c=>analysisSourceCollectionProof(c.args.analysis_source_proof,{args:c.args,accountId:c.accountId,accountGeneration:c.accountGeneration,teamId:'team',seasonId:'season'}));
  assert.equal(proofs.length,5);const allowed=()=>proofs.map(p=>f.sqlite.prepare('SELECT '+p.sql+' AS allowed').get(...p.params).allowed);assert.deepEqual(allowed(),[1,1,1,1,1]);
  const denied=[
   "UPDATE source_events SET provenance='file_import'","UPDATE source_events SET content_hash='changed'","UPDATE source_events SET native_id='other'",
   "UPDATE source_game_members SET provenance='file_import' WHERE gid='g1'","UPDATE source_game_members SET content_hash='changed' WHERE gid='g1'","UPDATE source_game_members SET side='away' WHERE gid='g1'",
   "UPDATE source_trace_components SET provenance='file_import' WHERE kind='clip'","UPDATE source_trace_components SET content_hash='changed' WHERE kind='clip'",
   "UPDATE provider_accounts SET active=0","UPDATE provider_accounts SET generation=2",
   "UPDATE team_source_attachments SET active=0","UPDATE team_source_attachments SET generation=2",
   "UPDATE team_source_connections SET active=0","UPDATE team_source_connections SET generation=2",
   "UPDATE team_connection_seasons SET active=0","UPDATE team_connection_seasons SET excluded=1","UPDATE team_connection_seasons SET generation=2",
   "UPDATE team_event_season_resolutions SET team_season_id=NULL,state='pending'",
   "INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES('team','deleting','test')",
  ];
  for(const mutation of denied){f.sqlite.exec('SAVEPOINT scope');f.sqlite.exec(mutation);assert.deepEqual(allowed(),[0,0,0,0,0],mutation);f.sqlite.exec('ROLLBACK TO scope;RELEASE scope');}
 }finally{f.close();}
});

test('balanced proof prevents authority changes between preflight and atomic native job admission',async()=>{
 const {ApplicationSyncService}=await import('../src/application/sync-service.js'),{SYNC_SCHEMA}=await import('../src/sync/schema.js');
 for(const mutation of ["UPDATE source_events SET provenance='file_import'","UPDATE source_game_members SET content_hash='changed' WHERE gid='g1'","UPDATE source_trace_components SET provenance='file_import' WHERE kind='clip'","UPDATE team_source_connections SET generation=2"]){
  const f=analysisFixture();try{
   for(const sql of SYNC_SCHEMA)f.sqlite.exec(sql);f.sqlite.exec("INSERT INTO account_source_teams VALUES('account','source-team')");
   const tracks=new NativeTrackService(f.db,{owner:true}),context=await tracks.context({team_id:'team',team_season_id:'season'},'event'),member=f.all("SELECT * FROM source_game_members WHERE gid='g1'")[0],children=await tracks.sourceChildren({...context,member}),service=new ApplicationSyncService(f.db,{}, {wake:async()=>{}}),admit=service.jobs.enqueueMany.bind(service.jobs);
   service.jobs.enqueueMany=(...args)=>{f.sqlite.exec(mutation);return admit(...args);};
   await assert.rejects(()=>service.enqueueTrackSource({teamId:'team',seasonId:'season',eventId:'event',sourceChildren:children}),/CHECK constraint failed/);
   assert.equal(f.all('SELECT * FROM sync_jobs').length,0);assert.equal(f.all('SELECT * FROM sync_job_subscribers').length,0);
  }finally{f.close();}
 }
});

test('balanced proof blocks outbound fetch and atomically rejects saved source pages after authority changes',async()=>{
 const {ApplicationSyncService,collectApplicationJob}=await import('../src/application/sync-service.js'),{SYNC_SCHEMA}=await import('../src/sync/schema.js'),{traceProvider,traceNativeGame}=await import('./fixtures/trace-analysis-native.mjs'),{SECURITY_SCHEMA}=await import('../src/security/schema.js');
 for(const mutation of [null,"UPDATE source_events SET provenance='file_import'","UPDATE source_game_members SET content_hash='changed' WHERE gid='g1'","UPDATE source_trace_components SET provenance='file_import' WHERE kind='clip'","UPDATE team_source_connections SET generation=2"]){
  const f=analysisFixture();try{
   for(const sql of [...SYNC_SCHEMA,...SECURITY_SCHEMA])f.sqlite.exec(sql);f.sqlite.exec("INSERT INTO account_source_teams VALUES('account','source-team')");
   const tracks=new NativeTrackService(f.db,{owner:true}),context=await tracks.context({team_id:'team',team_season_id:'season'},'event'),member=f.all("SELECT * FROM source_game_members WHERE gid='g1'")[0],children=await tracks.sourceChildren({...context,member}),service=new ApplicationSyncService(f.db,{}, {wake:async()=>{}});
   const admitted=await service.enqueueTrackSource({teamId:'team',seasonId:'season',eventId:'event',sourceChildren:children});
   const id=admitted.jobIds.find(id=>f.sqlite.prepare('SELECT component FROM sync_jobs WHERE id=?').get(id).component==='tracking');
   f.sqlite.prepare("UPDATE sync_jobs SET state='running',lease_token='lease',lease_until=? WHERE id=?").run(Date.now()+60000,id);
   const saved=f.sqlite.prepare('SELECT * FROM sync_jobs WHERE id=?').get(id),lease={...saved,args:JSON.parse(saved.args),checkpoint:JSON.parse(saved.checkpoint)},provider=traceProvider(traceNativeGame()),options={transportFactory:()=>provider.transport,credentialLoader:async()=>({credential:'synthetic-cookie'})};
   const page=await collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:{}},options);
   assert.ok(page.observations.length>0);
   // The compact analysis fixture uses opaque IDs, not mapper-native IDs. Keep
   // the production collector's authority write, then fence a source sentinel.
   page.statements=[page.statements[0],{sql:"UPDATE source_tracking_segments SET page_offset=page_offset+1 WHERE id='segments-1-1' AND $FENCE",params:[]}];page.children.push({...children[1],subscriberMode:'inherit'});
   const before=f.all('SELECT * FROM source_tracking_segments');
   if(mutation){
    f.sqlite.exec(mutation);const calls=provider.calls.length;
    await assert.rejects(()=>collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:{}},options),e=>e.code==='analysis_source_scope');assert.equal(provider.calls.length,calls,'denied proof makes no outbound call');
    await assert.rejects(()=>service.jobs.commit(lease,page),/CHECK constraint failed/);assert.deepEqual(f.all('SELECT * FROM source_tracking_segments'),before);assert.equal(f.all('SELECT * FROM sync_observations').length,0);assert.equal(f.sqlite.prepare('SELECT pages_saved FROM sync_jobs WHERE id=?').get(id).pages_saved,0);
   }else{const result=await service.jobs.commit(lease,page);assert.equal(result.committed,true);assert.ok(f.all('SELECT * FROM sync_observations').length>0);}
  }finally{f.close();}
 }
});
