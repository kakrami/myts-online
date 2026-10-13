import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSyncRuntime} from '../src/sync/runtime.js';

const root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||path.dirname(fileURLToPath(import.meta.url))+'/..');
const password='deployment-test-owner-password-123';
const stale={state:'complete',started_at:'2026-10-10T00:00:00Z',finished_at:'2026-10-10T00:01:00Z',queries:42};

async function harness(){
  const modules={},files=['worker.js','web/app/coach-tactics.js','web/app/schedule-query.js','web/app/reporting/encoders.js','web/app/reporting/font-metrics.js',...(await readdir(path.join(root,'src'),{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>'src/'+f)];
  for(const file of files)modules[file]={type:'esm',contents:await readFile(path.join(root,file),'utf8')};
  // Test instrumentation only: the assembled production Worker/runtime handles
  // every ordinary request, wake and native alarm without a runner endpoint.
  modules['deployment-test-worker.js']={type:'esm',contents:`
    import application,{SyncRuntime as ApplicationRuntime} from './worker.js';
    export class SyncRuntime extends ApplicationRuntime {
      async run(){
        const result=await super.run(),last=await this.ctx.storage.get('last_run');
        if(last?.installation_id){const runs=await this.ctx.storage.get('observed_runs')||[];runs.push({state:last.state,statements:last.statements});await this.ctx.storage.put('observed_runs',runs.slice(-200));}
        return result;
      }
      async fetch(request){
        const path=new URL(request.url).pathname;
        if(path==='/__seed'){
          await this.ctx.storage.put({last_run:await request.json(),maintenance_at:12345});
          await this.ctx.storage.setAlarm(Date.now()+20);return Response.json({seeded:true});
        }
        if(path==='/__storage')return Response.json({alarm:await this.ctx.storage.getAlarm(),last_run:await this.ctx.storage.get('last_run'),maintenance_at:await this.ctx.storage.get('maintenance_at'),runs:await this.ctx.storage.get('observed_runs')||[]});
        return super.fetch(request);
      }
    }
    export default application;
  `};
  const mf=new Miniflare({telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'deployment-test',compatibilityDate:'2026-09-09',manifest:{mainModule:'deployment-test-worker.js',modulesRoot:root,modules},env:{ADMIN_KEY:{type:'text',value:password},DB:{type:'d1',id:'deployment-test'},SYNC:{type:'durable-object',worker:'deployment-test',exportName:'SyncRuntime'},ASSETS:{type:'assets'},PROVIDER_FETCH:{type:'worker',worker:'provider'}},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}},assets:{directory:path.join(root,'web'),hasUserWorker:true,runWorkerFirst:true}}},{config:{name:'provider',compatibilityDate:'2026-09-09',manifest:{mainModule:'tests/mock-provider.js',modulesRoot:root,modules:{'tests/mock-provider.js':{type:'esm',contents:await readFile(path.join(root,'tests/mock-provider.js'),'utf8')}}},env:{COUNTERS:{type:'kv',id:'deployment-provider'}},exports:{}}}]});
  await mf.ready;
  const db=await mf.getD1Database('DB','deployment-test'),namespace=await mf.getDurableObjectNamespace('SYNC','deployment-test'),stub=namespace.get(namespace.idFromName('scheduler'));let cookie='';
  async function request(route,{method='GET',body}={}){
    const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{...(body?{'Content-Type':'application/json',Origin:'http://localhost'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json(),set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,data};
  }
  const storage=async()=>await(await stub.fetch('https://sync/__storage')).json();
  const status=async()=>await(await stub.fetch('https://sync/status')).json();
  const seed=async()=>stub.fetch('https://sync/__seed',{method:'POST',body:JSON.stringify(stale)});
  async function waitFor(check){const deadline=Date.now()+120000;while(Date.now()<deadline){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Native deployment-runtime condition did not complete.');}
  async function initialize(){let result;do{result=await request('/api/owner/initialize',{method:'POST',body:{password}});assert.ok([200,202].includes(result.status),JSON.stringify(result.data));}while(result.data.continue);return result;}
  return {mf,db,stub,request,storage,status,seed,waitFor,initialize,dispose:()=>mf.dispose()};
}

test('an existing scheduler alarm waits for fresh installation, ignores old status, then publishes with native alarms',async()=>{
  const h=await harness();try{
    await h.seed();await h.waitFor(async()=>(await h.storage()).alarm===null);
    assert.deepEqual(await h.status(),{state:'waiting_for_initialization',setup_state:'empty'});
    assert.deepEqual((await h.storage()).last_run,stale);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").first()).n,0);
    const partial=await h.request('/api/owner/initialize',{method:'POST',body:{password}});assert.equal(partial.status,202);
    await h.seed();await h.waitFor(async()=>(await h.storage()).alarm===null);
    assert.deepEqual(await h.status(),{state:'waiting_for_initialization',setup_state:'initializing'});
    assert.equal((await h.db.prepare('SELECT state FROM setup_state WHERE id=1').first()).state,'initializing');
    await h.initialize();assert.deepEqual(await h.status(),{state:'not_started'});
    const team=await h.request('/api/teams',{method:'POST',body:{name:'Deployment workflow team',timezone:'UTC',season_year:2026}});assert.equal(team.status,201);
    const snapshot=await h.request('/api/reports/snapshots',{method:'POST',body:{team_id:team.data.team.id,team_season_id:team.data.season_id,type:'season'}});assert.equal(snapshot.status,202,JSON.stringify(snapshot.data));
    const closedAt=Date.now();
    await h.waitFor(async()=>{const row=await h.db.prepare('SELECT state,error_code FROM report_snapshots WHERE id=?').bind(snapshot.data.data.snapshot_id).first();assert.notEqual(row.state,'failed',JSON.stringify(row));return row.state==='ready';});
    const ready=await h.db.prepare('SELECT content_revision,total,captured,selection FROM report_snapshots WHERE id=?').bind(snapshot.data.data.snapshot_id).first();assert.equal(ready.content_revision,1);assert.equal(ready.total,6);assert.equal(ready.captured,6);assert.equal(JSON.parse(ready.selection).report_initial_publication,undefined);
    const job=await h.db.prepare("SELECT state,last_saved_at,last_complete_at FROM sync_jobs WHERE provider='reports' AND component='capture'").first();
    assert.equal(job.state,'ready');assert.ok(job.last_saved_at>=closedAt&&job.last_complete_at>=closedAt);
    const setup=await h.db.prepare('SELECT schema_fingerprint,started_at FROM setup_state WHERE id=1').first(),status=await h.status();
    assert.equal(status.installation_id,setup.schema_fingerprint+':'+setup.started_at);assert.notEqual(status.state,'error');assert.ok(status.started_at>=closedAt);
    assert.equal((await h.storage()).maintenance_at,12345);
  }finally{await h.dispose();}
});

test('foreign existing database remains unchanged after old alarm, wakes and initialization requests',async()=>{
  const h=await harness();try{
    await h.db.batch([h.db.prepare('CREATE TABLE installation(id INTEGER PRIMARY KEY,schema_version INTEGER,created_at TEXT)'),h.db.prepare("INSERT INTO installation VALUES(1,1,'old-owner-data')"),h.db.prepare('CREATE TABLE connections(id TEXT PRIMARY KEY,secret TEXT)'),h.db.prepare("INSERT INTO connections VALUES('old-account','preserve-ciphertext')")]);
    const before=(await h.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
    await h.seed();await h.waitFor(async()=>(await h.storage()).alarm===null);
    assert.equal((await h.status()).state,'blocked');assert.equal((await h.status()).error.code,'fresh_database_required');
    const wake=await(await h.stub.fetch('https://sync/wake',{method:'POST'})).json();assert.equal(wake.queued,false);assert.equal(wake.state,'blocked');assert.equal((await h.storage()).alarm,null);
    const init=await h.request('/api/owner/initialize',{method:'POST',body:{password}});assert.equal(init.status,409);assert.equal(init.data.error.code,'fresh_database_required');
    assert.deepEqual((await h.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results,before);
    assert.deepEqual((await h.db.prepare('SELECT * FROM installation').all()).results,[{id:1,schema_version:1,created_at:'old-owner-data'}]);
    assert.deepEqual((await h.db.prepare('SELECT * FROM connections').all()).results,[{id:'old-account',secret:'preserve-ciphertext'}]);
    assert.deepEqual((await h.storage()).last_run,stale);
  }finally{await h.dispose();}
});

test('installation inspection and a complete public import share the 50-query invocation ceiling',async()=>{
  const h=await harness();try{
    await h.initialize();
    const team=await h.request('/api/teams',{method:'POST',body:{name:'Budget workflow team',timezone:'America/Los_Angeles',season_year:2026}});assert.equal(team.status,201);
    const source=await h.request('/api/sources/gotsport/resolve',{method:'POST',body:{url:'https://rankings.gotsport.com/teams/212707/upcoming-games'}});assert.equal(source.status,200);
    const attached=await h.request('/api/teams/'+team.data.team.id+'/attachments',{method:'POST',body:{season_id:team.data.season_id,source_team_id:source.data.teams[0].id}});assert.equal(attached.status,202);
    await h.waitFor(async()=>{
      const failures=(await h.db.prepare("SELECT component,state,last_error_code FROM sync_jobs WHERE state IN('failed','blocked','retrying')").all()).results;assert.deepEqual(failures,[]);
      const pending=(await h.db.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE state IN('queued','running')").first()).n;
      return pending===0&&(await h.db.prepare('SELECT COUNT(*) n FROM team_events').first()).n>=2;
    });
    const runs=(await h.storage()).runs;assert.ok(runs.length>0);assert.ok(runs.every(run=>run.statements<=50));
    assert.ok(runs.some(run=>run.statements>=48),'Exercise a source page near the invocation ceiling.');
    assert.ok((await h.db.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE component='upcoming' AND state='ready' AND last_error_code IS NULL").first()).n>0);
  }finally{await h.dispose();}
});

test('temporary installation inspection failure schedules recovery instead of disabling alarms',async()=>{
  const values=new Map(),storage={get:async key=>values.get(key),put:async(key,value)=>values.set(key,value),getAlarm:async()=>storage.alarm??null,setAlarm:async at=>{storage.alarm=at;},deleteAlarm:async()=>{storage.alarm=null;}};
  let collected=false;const Runtime=createSyncRuntime(async()=>{collected=true;},{inspectInstallation:async()=>{throw new Error('temporary D1 outage');},runtimeRetryMs:30});
  const runtime=new Runtime({storage},{DB:{}}),started=Date.now();await runtime.alarm();
  assert.equal(collected,false);assert.ok(storage.alarm>=started+30);assert.equal(values.get('last_run').state,'error');assert.equal(values.get('last_run').error.kind,'temporary');
});
