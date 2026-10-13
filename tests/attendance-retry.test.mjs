import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {SecurityStore} from '../src/security/index.js';
import {FreshInstallation} from '../src/application/fresh-install.js';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {BudgetDB} from '../src/sync/budget.js';
import {collectApplicationJob} from '../src/application/sync-service.js';
import {SourceTransport} from '../src/sources/http.js';

// Native HTTP + D1. Provider data and faults are synthetic; no provider request,
// scheduler execution, credential, or production identifier is used.
const PASSWORD='attendance-retry-native-owner';
let mf,db,nativeDb,repo,security,cookie,maxQueries=0,maxRetryQueries=0,nextNative=880001;
test.before(async()=>{
  const root=path.resolve('.'),modules={};
  for(const file of (await readdir('src',{recursive:true})).filter(file=>file.endsWith('.js'))){const name='src/'+file;modules[name]={type:'esm',contents:await readFile(name,'utf8')};}
  modules['web/app/coach-tactics.js']={type:'esm',contents:await readFile('web/app/coach-tactics.js','utf8')};for(const name of ['web/app/schedule-query.js','web/app/reporting/encoders.js','web/app/reporting/font-metrics.js'])modules[name]={type:'esm',contents:await readFile(name,'utf8')};
  modules['attendance-retry-worker.js']={type:'esm',contents:`
    import {applicationRoutes} from './src/application/routes.js';
    import {errorResponse} from './src/application/http.js';
    import {BudgetDB} from './src/sync/budget.js';
    import {wrapDatabase} from './src/application/installation-epoch.js';
    import {InstallationUpgrade} from './src/application/schema-upgrade.js';
    import {SCHEMA,SEED} from './src/application/installation-schema.js';
    let wakes=0;
    const wrap=(native,sql)=>({native,sql,bind(...args){return wrap(native.bind(...args),sql);},all(...args){return native.all(...args);},first(...args){return native.first(...args);},run(...args){return native.run(...args);}});
    export default {async fetch(request,env){
      const raw=env.DB,faultDb=wrapDatabase(raw),fault=request.headers.get('x-test-fault')||'',connection=request.headers.get('x-test-connection'),job=request.headers.get('x-test-job');
      const adapter={prepare(sql){return wrap(raw.prepare(sql),sql);},async batch(statements){
        if(statements.some(s=>s.sql.includes('retry_eligible AS MATERIALIZED'))){
          if(fault==='natural_expiry'){const expiry=await raw.prepare('SELECT MAX(expires_at) at FROM security_sessions WHERE revoked_at IS NULL').first();await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry.at-Date.now()+30)));}
          if(fault==='session_revoke')await faultDb.prepare('UPDATE security_sessions SET revoked_at=1').run();
          if(fault==='session_expire')await faultDb.prepare('UPDATE security_sessions SET expires_at=1').run();
          if(fault==='password_rotate')await faultDb.prepare('UPDATE security_owner SET password_revision=password_revision+1').run();
          if(fault==='account_revoke')await faultDb.prepare('UPDATE provider_accounts SET active=0 WHERE id=(SELECT account_id FROM team_source_connections WHERE id=?)').bind(connection).run();
          if(fault==='account_generation')await faultDb.prepare('UPDATE provider_accounts SET generation=generation+1 WHERE id=(SELECT account_id FROM team_source_connections WHERE id=?)').bind(connection).run();
          if(fault==='unlink')await faultDb.prepare('UPDATE team_source_connections SET active=0,generation=generation+1 WHERE id=?').bind(connection).run();
          if(fault==='root_generation')await faultDb.prepare('UPDATE team_source_connections SET generation=generation+1 WHERE id=?').bind(connection).run();
          if(fault==='demand_removed')await faultDb.prepare('DELETE FROM sync_job_subscribers WHERE job_id=? AND demand_key=?').bind(job,'connection:'+connection).run();
          if(fault==='entitlement_removed')await faultDb.prepare('DELETE FROM account_source_teams WHERE source_team_id=(SELECT source_team_id FROM team_source_connections WHERE id=?)').bind(connection).run();
          if(fault==='team_deleting')await faultDb.prepare("INSERT INTO team_lifecycle(team_id,state,requested_at) SELECT app_team_id,'deleting','fixture' FROM team_source_connections WHERE id=?").bind(connection).run();
          if(fault==='job_running')await faultDb.prepare("UPDATE sync_jobs SET state='running',lease_token='fixture-lease',lease_until=?,attempts=attempts+1 WHERE id=?").bind(Date.now()+60000,job).run();
          if(fault==='job_ready')await faultDb.prepare("UPDATE sync_jobs SET state='ready' WHERE id=?").bind(job).run();
          if(fault==='new_failure')await faultDb.prepare('UPDATE sync_jobs SET attempts=attempts+1,failures=failures+1 WHERE id=?').bind(job).run();
          if(fault==='job_generation')await faultDb.prepare('UPDATE sync_jobs SET generation=generation+1 WHERE id=?').bind(job).run();
          if(fault==='job_scan')await faultDb.prepare("UPDATE sync_jobs SET scan_id='replacement-scan' WHERE id=?").bind(job).run();
        }
        return raw.batch(statements.map(s=>s.native||s));
      }};
      const budget=new BudgetDB(adapter);budget.reserve(2);
      let response;try{response=await applicationRoutes(request,{ADMIN_KEY:'${PASSWORD}'},{db:wrapDatabase(budget),installation:new InstallationUpgrade(budget,{schema:SCHEMA,seed:SEED,bootstrapPassword:'${PASSWORD}'}),syncOptions:{wake:async()=>{wakes++;if(fault==='wake_failure')throw new Error('Synthetic interrupted wake');}}});}catch(error){if(!error.status)console.error('attendance retry fixture failure',error.message);response=errorResponse(error);}
      const headers=new Headers(response.headers);headers.set('x-test-queries',String(budget.used));headers.set('x-test-wakes',String(wakes));
      return new Response(response.body,{status:response.status,headers});
    }};
  `};
  mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'attendance-retry',compatibilityDate:'2026-09-09',manifest:{mainModule:'attendance-retry-worker.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'attendance-retry'}},exports:{}}}]});
  await mf.ready;const raw=await mf.getD1Database('DB','attendance-retry'),installation=new FreshInstallation(raw,{schema:SCHEMA,seed:SEED,bootstrapPassword:PASSWORD});
  while((await installation.advance(PASSWORD)).continue){}
  nativeDb=raw;db=wrapDatabase(raw);
  repo=new DomainRepository(db);security=new SecurityStore(db,{bootstrapPassword:PASSWORD});
  const session=await security.initializeOwner(PASSWORD);cookie='myts_session='+session.token;
});
test.after(async()=>{console.log(JSON.stringify({attendance_retry_max_queries:maxRetryQueries,all_http_max_queries:maxQueries,budget_reserve:2,request_budget:48,native_d1:true,provider_requests:0}));await mf?.dispose();});
async function request(route,body,{method='POST',signed=true,headers={}}={}){
  const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{'Content-Type':'application/json',Origin:'http://localhost',...(signed?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result={status:response.status,data:await response.json(),queries:Number(response.headers.get('x-test-queries')),wakes:Number(response.headers.get('x-test-wakes'))};maxQueries=Math.max(maxQueries,result.queries);if(route.endsWith('/attendance/retry'))maxRetryQueries=Math.max(maxRetryQueries,result.queries);assert.ok(result.queries<=48,JSON.stringify(result));return result;
}
async function fixture({provider='teamsnap',account=null,nativeId=String(nextNative++)}={}){
  account??=await repo.registerAccount({provider,nativeId:String(nextNative++)});
  await repo.ingestSourcePage({accountId:account.id,generation:account.generation,records:{teams:[{provider,native_id:nativeId,name:'Synthetic retry team',details:{account_owned:true,slug:'fixture'}}]},fixtures:[]});
  const source=sourceKey(provider,nativeId,account.id),connected=await request('/api/connections',{request_id:crypto.randomUUID(),source_team_id:source,account_id:account.id,new_team:{name:'Retry fixture',timezone:'UTC',kind:'own'}});
  assert.equal(connected.status,202,JSON.stringify(connected));
  const saved=connected.data,jobs=(await db.prepare('SELECT j.* FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.demand_key=? ORDER BY j.id').bind('connection:'+saved.connection_id).all()).results;
  const attendance=jobs.find(j=>j.component==='attendance');
  if(attendance)await db.prepare("UPDATE sync_jobs SET state='failed',coverage='partial',checkpoint=?,generation=3,scan_id=?,attempts=7,failures=2,pages_saved=4,rows_saved=123,last_error_code='malformed_response',last_error_message='Synthetic failure',failure_kind='permanent',next_at=10,ready_since=11 WHERE id=?").bind(JSON.stringify({offset:8,refresh:{protocol:'teamsnap-refresh-v1',active:{position:8}}}),'saved-'+attendance.id,attendance.id).run();
  const events=jobs.find(j=>j.component==='events');
  if(events)await db.prepare("UPDATE sync_jobs SET state='ready',coverage='complete',checkpoint=?,scan_id=?,pages_saved=12,rows_saved=450,last_complete_at=123,next_at=? WHERE id=?").bind(JSON.stringify({protocol:'teamsnap-refresh-v1',finished:true,refresh:{protocol:'teamsnap-refresh-v1',active:null,full:{saved:true}}}),'complete-'+events.id,Date.now()+900000,events.id).run();
  return {saved,account,source,nativeId,attendance,route:'/api/connections/'+saved.connection_id+'/attendance/retry',body:{team_id:saved.team_id,generation:saved.connection.generation},wakes:connected.wakes};
}
const row=id=>db.prepare('SELECT * FROM sync_jobs WHERE id=?').bind(id).first();
async function revisions(h){return {team:await db.prepare('SELECT * FROM team_read_state WHERE app_team_id=?').bind(h.saved.team_id).first(),account:await db.prepare('SELECT * FROM sync_account_read_state WHERE account_id=?').bind(h.account.id).first()};}
async function jobs(){return (await db.prepare('SELECT * FROM sync_jobs ORDER BY id').all()).results;}
async function savedRows(){const tables=['team_source_connections','team_source_attachments','team_connection_seasons','team_projection_state','source_events','source_event_teams','source_players','source_roster_memberships','source_attendance','source_component_coverage','team_events','team_seasons'];return Object.fromEntries(await Promise.all(tables.map(async name=>[name,(await db.prepare('SELECT * FROM '+name+' ORDER BY 1').all()).results])));}
async function rejected(h,options={}){const before=await jobs(),status=await revisions(h),response=await request(h.route,h.body,options);assert.equal(response.status,409,JSON.stringify(response));assert.equal(response.wakes,h.wakes);assert.deepEqual(await jobs(),before);assert.deepEqual(await revisions(h),status);return response;}

test('owner retries only failed attendance and preserves completed events, scan, checkpoint, coverage, counters and saved rows',async()=>{
  const h=await fixture(),publicNative=String(nextNative++);
  await repo.ingestSourcePage({records:{teams:[{provider:'gotsport',native_id:publicNative,name:'Unrelated public source',details:{}}]}});
  const unrelated=await request('/api/connections',{request_id:crypto.randomUUID(),source_team_id:sourceKey('gotsport',publicNative),new_team:{name:'Unrelated public team',timezone:'UTC',kind:'followed'}});assert.equal(unrelated.status,202);h.wakes=unrelated.wakes;
  const publicRevision=await db.prepare('SELECT * FROM team_read_state WHERE app_team_id=?').bind(unrelated.data.team_id).first();
  await repo.ingestSourcePage({accountId:h.account.id,generation:h.account.generation,records:{attendance:[{team_id:'teamsnap:'+h.nativeId,fixture_id:'teamsnap:999001',player_id:'teamsnap:999002',account_id:h.account.id,status:'1',normalized_status:'Yes'}]}});
  const before=await jobs(),rows=await savedRows(),revision=await revisions(h),result=await request(h.route,h.body);
  assert.equal(result.status,202,JSON.stringify(result));assert.deepEqual(result.data,{connection_id:h.saved.connection_id,job_id:h.attendance.id,component:'attendance',queued:true,already_queued:false});assert.equal(result.wakes,h.wakes+1);
  const after=await jobs(),target=after.find(j=>j.id===h.attendance.id),original=before.find(j=>j.id===target.id);
  assert.equal(target.state,'queued');assert.ok(target.next_at>original.next_at);assert.equal(target.ready_since,target.next_at);
  assert.deepEqual({...target,state:original.state,next_at:original.next_at,ready_since:original.ready_since},original);
  assert.deepEqual(after.filter(j=>j.id!==target.id),before.filter(j=>j.id!==target.id));assert.deepEqual(await savedRows(),rows);assert.deepEqual(await db.prepare('SELECT * FROM team_read_state WHERE app_team_id=?').bind(unrelated.data.team_id).first(),publicRevision);
  const changed=await revisions(h);assert.equal(changed.team.status_revision,revision.team.status_revision+1);assert.equal(changed.team.content_revision,revision.team.content_revision);assert.equal(changed.account.status_revision,revision.account.status_revision+1);
  const replay=await request(h.route,h.body);assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.data.already_queued,true);assert.equal(replay.wakes,result.wakes+1);assert.deepEqual(await jobs(),after);assert.deepEqual(await revisions(h),changed);
});

test('same-origin owner authorization and strict command body are required',async()=>{
  const h=await fixture(),before=await jobs();
  for(const options of [{signed:false},{headers:{'x-view-key':'synthetic-viewer'}}])assert.equal((await request(h.route,h.body,options)).status,401);
  for(const headers of [{Origin:'https://unrelated.example'},{Origin:''},{'sec-fetch-site':'cross-site'}])assert.equal((await request(h.route,h.body,{headers})).status,403);
  for(const body of [{},{...h.body,generation:0},{...h.body,generation:'1'},{...h.body,team_id:17},...['job_id','account_id','component','checkpoint','url','reset'].map(key=>({...h.body,[key]:'untrusted'}))])assert.equal((await request(h.route,body)).status,400,JSON.stringify(body));
  assert.notEqual((await request(h.route,undefined,{method:'GET'})).status,202);assert.deepEqual(await jobs(),before);
});

test('nonfailed states and active or stale running leases cannot be reset',async()=>{
  const h=await fixture();
  for(const state of ['ready','running','blocked','retrying','disabled']){await db.prepare('UPDATE sync_jobs SET state=? WHERE id=?').bind(state,h.attendance.id).run();await rejected(h);}
  await db.prepare("UPDATE sync_jobs SET state='failed',lease_until=? WHERE id=?").bind(Date.now()+60000,h.attendance.id).run();await rejected(h);
});

test('wrong team, stale root, foreign account and mismatched job source cannot supply attendance authority',async()=>{
  const h=await fixture(),other=await fixture();
  await rejected({...h,body:{...h.body,team_id:other.saved.team_id},wakes:other.wakes});
  await rejected({...h,body:{...h.body,generation:h.body.generation+1},wakes:other.wakes});
  await db.prepare('UPDATE sync_jobs SET account_id=?,account_scope=? WHERE id=?').bind(other.account.id,other.account.id,h.attendance.id).run();await rejected({...h,wakes:other.wakes});
  await db.prepare('UPDATE sync_jobs SET account_id=?,account_scope=?,args=? WHERE id=?').bind(h.account.id,h.account.id,JSON.stringify({team_id:'foreign-native-team'}),h.attendance.id).run();await rejected({...h,wakes:other.wakes});
  await db.prepare('UPDATE sync_jobs SET args=?,scope=? WHERE id=?').bind(JSON.stringify({team_id:h.nativeId}),'teamsnap:foreign-native-team',h.attendance.id).run();await rejected({...h,wakes:other.wakes});
});

test('inactive, stale, unentitled, imported and absent root demand is denied before writes',async()=>{
  const changes=["UPDATE team_source_connections SET active=0 WHERE id=?","UPDATE sync_job_subscribers SET generation=generation+1 WHERE demand_key='connection:'||?","DELETE FROM sync_job_subscribers WHERE demand_key='connection:'||?","UPDATE provider_accounts SET active=0 WHERE id=(SELECT account_id FROM team_source_connections WHERE id=?)","UPDATE provider_accounts SET generation=generation+1 WHERE id=(SELECT account_id FROM team_source_connections WHERE id=?)","DELETE FROM account_source_teams WHERE source_team_id=(SELECT source_team_id FROM team_source_connections WHERE id=?)","UPDATE source_teams SET provenance='file_import' WHERE id=(SELECT source_team_id FROM team_source_connections WHERE id=?)","UPDATE source_teams SET evidence='{}' WHERE id=(SELECT source_team_id FROM team_source_connections WHERE id=?)"];
  for(const sql of changes){const h=await fixture();await db.prepare(sql).bind(h.saved.connection_id).run();await rejected(h);}
  const trace=await fixture({provider:'trace'});await rejected(trace);
});

test('transaction-time revocation, unlink, demand loss and state changes deny mutation and wake',async()=>{
  for(const fault of ['account_revoke','account_generation','unlink','root_generation','demand_removed','entitlement_removed','team_deleting','job_running','job_ready','new_failure','job_generation','job_scan','session_revoke','session_expire','password_rotate']){
    const h=await fixture(),before=await row(h.attendance.id),revision=await revisions(h),result=await request(h.route,h.body,{headers:{'x-test-fault':fault,'x-test-connection':h.saved.connection_id,'x-test-job':h.attendance.id}});
    assert.equal(result.status,409,fault+': '+JSON.stringify(result));assert.equal(result.wakes,h.wakes,fault);assert.deepEqual(await revisions(h),revision,fault);
    const after=await row(h.attendance.id);assert.equal(after.checkpoint,before.checkpoint,fault);assert.equal(after.next_at,before.next_at,fault);assert.equal(after.ready_since,before.ready_since,fault);
    if(!['job_running','job_ready'].includes(fault))assert.equal(after.state,'failed',fault);
    if(fault.startsWith('session_')||fault==='password_rotate'){await db.prepare('UPDATE security_sessions SET revoked_at=NULL,expires_at=?,password_revision=(SELECT password_revision FROM security_owner WHERE id=1)').bind(Date.now()+3600000).run();}
  }
});

test('concurrent retries produce one queued transition and one revision change with replay-safe wakes',async()=>{
  const h=await fixture(),before=await row(h.attendance.id),revision=await revisions(h),results=await Promise.all([request(h.route,h.body),request(h.route,h.body)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,202],JSON.stringify(results));assert.equal(results.filter(r=>r.data.already_queued===false).length,1);assert.equal(Math.max(...results.map(r=>r.wakes)),h.wakes+2);
  const after=await row(h.attendance.id);assert.equal(after.state,'queued');assert.equal(after.checkpoint,before.checkpoint);assert.equal(after.scan_id,before.scan_id);assert.equal(after.generation,before.generation);
  const changed=await revisions(h);assert.equal(changed.team.status_revision,revision.team.status_revision+1);assert.equal(changed.account.status_revision,revision.account.status_revision+1);
});


test('queued replay repairs a commit followed by an interrupted wake without writing job or status rows',async()=>{
  const h=await fixture(),original=await row(h.attendance.id),result=await request(h.route,h.body,{headers:{'x-test-fault':'wake_failure'}});
  assert.equal(result.status,500);assert.equal((await row(h.attendance.id)).state,'queued');
  const before=await jobs(),revision=await revisions(h),replay=await request(h.route,h.body);
  assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.data.already_queued,true);assert.equal(replay.wakes,result.wakes+1);assert.deepEqual(await jobs(),before);assert.deepEqual(await revisions(h),revision);assert.equal((await row(h.attendance.id)).checkpoint,original.checkpoint);
});

test('shared native demand retries one job and publishes status to both authorized teams',async()=>{
  const h=await fixture(),second=await repo.createTeam({name:'Second subscriber',seasonYear:2026});
  const connected=await request('/api/connections',{request_id:crypto.randomUUID(),team_id:second.id,source_team_id:h.source,account_id:h.account.id});
  assert.equal(connected.status,202,JSON.stringify(connected));
  const before=await jobs(),firstRevision=await revisions(h),secondRevision=await db.prepare('SELECT status_revision FROM team_read_state WHERE app_team_id=?').bind(second.id).first();
  const result=await request(h.route,h.body);assert.equal(result.status,202,JSON.stringify(result));assert.equal(result.data.job_id,h.attendance.id);
  assert.deepEqual((await jobs()).filter(j=>j.id!==h.attendance.id),before.filter(j=>j.id!==h.attendance.id));
  assert.equal((await revisions(h)).team.status_revision,firstRevision.team.status_revision+1);assert.equal((await db.prepare('SELECT status_revision FROM team_read_state WHERE app_team_id=?').bind(second.id).first()).status_revision,secondRevision.status_revision+1);
  const replay=await request('/api/connections/'+connected.data.connection_id+'/attendance/retry',{team_id:second.id,generation:connected.data.connection.generation});assert.equal(replay.status,200);assert.equal(replay.data.job_id,h.attendance.id);
  await db.prepare('UPDATE team_source_connections SET active=0,generation=generation+1 WHERE id=?').bind(h.saved.connection_id).run();await rejected({...h,wakes:replay.wakes});
});

test('identical native team IDs in separate accounts never cross-retry jobs',async()=>{
  const first=await fixture(),second=await fixture({nativeId:first.nativeId}),other=await row(second.attendance.id);
  const result=await request(first.route,first.body);assert.equal(result.status,202,JSON.stringify(result));assert.equal(result.data.job_id,first.attendance.id);assert.deepEqual(await row(second.attendance.id),other);
});


test('a session naturally expiring while the selected retry is held cannot commit',async()=>{
  const h=await fixture(),before=await jobs(),revision=await revisions(h);
  await db.prepare('UPDATE security_sessions SET expires_at=?').bind(Date.now()+300).run();
  try{
    const result=await request(h.route,h.body,{headers:{'x-test-fault':'natural_expiry','x-test-connection':h.saved.connection_id,'x-test-job':h.attendance.id}});
    assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.wakes,h.wakes);assert.deepEqual(await jobs(),before);assert.deepEqual(await revisions(h),revision);
  }finally{await db.prepare('UPDATE security_sessions SET expires_at=?').bind(Date.now()+3600000).run();}
});


test('native collector failure persists only the bounded attendance diagnostic and HTTP 200 audit without advancing saved work',async()=>{
  const h=await fixture();
  await db.prepare("UPDATE sync_jobs SET state='queued',checkpoint='{}',priority=100,ready_since=0,next_at=0 WHERE id=?").bind(h.attendance.id).run();
  const before=await jobs(),original=await row(h.attendance.id),rows=await savedRows(),budget=new BudgetDB(nativeDb),runtimeDb=wrapDatabase(budget),coordinator=new JobCoordinator(runtimeDb,{publicHistory:true});
  const secret='opaque-private-availability-value',payload={collection:{items:[0,1].map(status_code=>({data:Object.entries({id:secret+'-'+status_code,team_id:Number(h.nativeId),event_id:990001,member_id:990002,status_code}).map(([name,value])=>({name,value}))})),links:[]}};
  let calls=0;
  const result=await coordinator.runOne(context=>{
    assert.equal(context.lease.id,h.attendance.id);
    return collectApplicationJob({...context,env:{}},{credentialLoader:async()=> 'synthetic-fixture-credential',transportFactory:()=>new SourceTransport({},{fetch:async endpoint=>{calls++;const url=new URL(endpoint);assert.equal(url.origin,'https://api.teamsnap.com');assert.equal(url.pathname,'/v3/availabilities/search');assert.equal(url.searchParams.get('team_id'),h.nativeId);return Response.json(payload);}})});
  });
  assert.equal(calls,1);assert.equal(result.state,'failed');assert.equal(result.error.kind,'permanent');assert.equal(result.error.code,'contract_violation');
  const after=await row(h.attendance.id);
  assert.equal(after.state,'failed');assert.equal(after.failure_kind,'permanent');assert.equal(after.last_error_code,'contract_violation');
  assert.equal(after.last_error_message,'The collector result did not satisfy its storage contract. Diagnostic: attendance_duplicate_pair; items=2; valid_pairs=2; duplicate_pairs=1.');
  for(const key of ['checkpoint','scan_id','generation','coverage','pages_saved','rows_saved','last_saved_at','last_complete_at'])assert.equal(after[key],original[key],key);
  assert.equal(after.attempts,original.attempts+1);assert.equal(after.failures,original.failures+1);assert.ok(after.last_retrieved_at>0);
  const audit=(await db.prepare('SELECT * FROM sync_observations WHERE job_id=?').bind(h.attendance.id).all()).results;assert.equal(audit.length,1);assert.equal(audit[0].status,200);assert.equal(audit[0].error_code,null);assert.equal(audit[0].endpoint,'https://api.teamsnap.com/v3/availabilities/search');assert.match(audit[0].content_hash,/^[a-f0-9]{64}$/);assert.equal(audit[0].scan_id,original.scan_id);assert.equal(audit[0].attempt,after.attempts);
  assert.ok(!JSON.stringify({after,audit}).includes(secret));assert.ok(!JSON.stringify({after,audit}).includes('synthetic-fixture-credential'));
  assert.deepEqual(await savedRows(),rows);assert.deepEqual((await jobs()).filter(j=>j.id!==h.attendance.id),before.filter(j=>j.id!==h.attendance.id));assert.ok(budget.used<=48);
  console.log(JSON.stringify({attendance_diagnostic_persistence_queries:budget.used,synthetic_fetches:calls,actual_provider_requests:0}));
});

test('Manage attendance retry availability is a read-only exact-root boolean through native status and connection catalogs',async()=>{
  const h=await fixture(),other=await fixture({nativeId:h.nativeId});
  const read=async(root,expected)=>{
    for(const [url,select] of [[`/api/status?team_id=${encodeURIComponent(root.saved.team_id)}`,data=>data.data.connections],[`/api/teams/${encodeURIComponent(root.saved.team_id)}/connections`,data=>data.items]]){
      const before=await jobs(),result=await request(url,undefined,{method:'GET'});
      assert.equal(result.status,200,JSON.stringify(result));
      const selected=select(result.data).find(connection=>connection.id===root.saved.connection_id);
      assert.ok(selected);assert.equal(selected.attendance_retry_available,expected,url);
      assert.equal(typeof selected.attendance_retry_available,'boolean');
      assert.deepEqual(await jobs(),before,'The Manage availability read must not change jobs.');
    }
  };
  await read(h,true);await read(other,true);
  for(const state of ['ready','queued','running','blocked','retrying','disabled']){await db.prepare('UPDATE sync_jobs SET state=? WHERE id=?').bind(state,h.attendance.id).run();await read(h,false);}
  await db.prepare("UPDATE sync_jobs SET state='failed' WHERE id=?").bind(h.attendance.id).run();await read(h,true);
  const mutations=[
    ["UPDATE sync_jobs SET lease_until=? WHERE id=?",[Date.now()+60000,h.attendance.id],"UPDATE sync_jobs SET lease_until=0 WHERE id=?",[h.attendance.id]],
    ["UPDATE sync_jobs SET lease_token='held' WHERE id=?",[h.attendance.id],"UPDATE sync_jobs SET lease_token=NULL WHERE id=?",[h.attendance.id]],
    ["UPDATE sync_jobs SET authorization_generation=authorization_generation+1 WHERE id=?",[h.attendance.id],"UPDATE sync_jobs SET authorization_generation=authorization_generation-1 WHERE id=?",[h.attendance.id]],
    ["UPDATE sync_job_subscribers SET generation=generation+1 WHERE job_id=? AND demand_key=?",[h.attendance.id,'connection:'+h.saved.connection_id],"UPDATE sync_job_subscribers SET generation=generation-1 WHERE job_id=? AND demand_key=?",[h.attendance.id,'connection:'+h.saved.connection_id]],
    ["UPDATE provider_accounts SET active=0 WHERE id=?",[h.account.id],"UPDATE provider_accounts SET active=1 WHERE id=?",[h.account.id]],
    ["UPDATE team_source_connections SET active=0 WHERE id=?",[h.saved.connection_id],"UPDATE team_source_connections SET active=1 WHERE id=?",[h.saved.connection_id]],
    ["UPDATE source_teams SET provenance='file_import' WHERE id=?",[h.source],"UPDATE source_teams SET provenance='provider' WHERE id=?",[h.source]],
    ["UPDATE source_teams SET evidence=json_set(evidence,'$.account_owned',0) WHERE id=?",[h.source],"UPDATE source_teams SET evidence=json_set(evidence,'$.account_owned',json('true')) WHERE id=?",[h.source]],
    ["UPDATE sync_jobs SET args=json_set(args,'$.team_id','wrong-native') WHERE id=?",[h.attendance.id],"UPDATE sync_jobs SET args=json_set(args,'$.team_id',?) WHERE id=?",[h.nativeId,h.attendance.id]],
    ["UPDATE sync_jobs SET args=json_set(args,'$.url','https://api.teamsnap.com/v3/availabilities/search') WHERE id=?",[h.attendance.id],"UPDATE sync_jobs SET args=json_remove(args,'$.url') WHERE id=?",[h.attendance.id]],
  ];
  for(const [sql,params,restore,restoreParams] of mutations){await db.prepare(sql).bind(...params).run();await read(h,false);await read(other,true);await db.prepare(restore).bind(...restoreParams).run();await read(h,true);}
  await db.prepare('DELETE FROM account_source_teams WHERE account_id=? AND source_team_id=?').bind(h.account.id,h.source).run();await read(h,false);await read(other,true);
  const trace=await fixture({provider:'trace'});await read(trace,false);
  const denied=await request(`/api/teams/${h.saved.team_id}/connections`,undefined,{method:'GET',signed:false});assert.equal(denied.status,401);
  console.log(JSON.stringify({attendance_retry_manage_read:true,exact_account_root:true,read_only:true,max_http_queries:maxQueries}));
});
