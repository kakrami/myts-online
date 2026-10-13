import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
const PASSWORD='native-throughput-owner-password';

// Native production HTTP, source transport, repository, epoch fencing, D1 and
// Durable Object alarms. Only the remote provider data is
// synthetic. Instrumentation observes the unchanged 50-SQL / 2-MB guards.
export async function connectionThroughputHarness(){
  const d1LatencyMs=Number(process.env.MYTS_THROUGHPUT_D1_LATENCY_MS||0);
  if(!Number.isFinite(d1LatencyMs)||d1LatencyMs<0||d1LatencyMs>1000)throw Error('Invalid synthetic D1 latency.');
  const qaRoot=path.resolve('.'),root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||qaRoot),modules={};
  for(const file of ['worker.js','web/app/coach-tactics.js','web/app/schedule-query.js','web/app/reporting/encoders.js','web/app/reporting/font-metrics.js',...(await readdir(path.join(root,'src'),{recursive:true})).filter(file=>file.endsWith('.js')).map(file=>'src/'+file)])modules[file]={type:'esm',contents:await readFile(path.join(root,file),'utf8')};
  const packageVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
  const sourceHashes=Object.fromEntries(['worker.js','src/domain/connection-materializer.js','src/domain/connection-event-batch.js','src/domain/projector.js','src/application/sync-service.js','src/sync/coordinator.js','src/sync/runtime.js'].filter(file=>modules[file]).map(file=>[file,createHash('sha256').update(modules[file].contents).digest('hex')]));
  const sourceFingerprint=createHash('sha256').update(Object.keys(modules).sort().map(name=>name+'\0'+modules[name].contents).join('\0')).digest('hex');
  const replace=(file,before,after)=>{if(modules[file].contents.split(before).length!==2)throw Error('Native diagnostic marker unavailable: '+file+' '+before);modules[file].contents=modules[file].contents.replace(before,after);};
  if(/alarmDelayMs|pageDelayMs/.test(modules['worker.js'].contents))throw Error('The Worker overrides production timer defaults; review acceptance contract.');
  // Do not replace production alarmDelayMs or pageDelayMs: both remain 500 ms.
  if(!modules['src/sync/runtime.js'].contents.includes('options.alarmDelayMs ?? 500')||!modules['src/sync/coordinator.js'].contents.includes('options.pageDelayMs ?? 500'))throw Error('Production timer contract changed; review this acceptance harness.');
  replace('src/sync/coordinator.js',"return { state:result.complete?'ready':'queued', committed:true, coverage:","return { state:result.complete?'ready':'queued', committed:true, fixturePayloadBytes:payloadBytes, fixtureCheckpointBytes:size(checkpoint), coverage:");
  replace('src/sync/coordinator.js','stage:lease.stage,...await this.commit(lease,result)','stage:lease.stage,fixtureInputCheckpoint:lease.checkpoint,fixtureCheckpoint:result.checkpoint,...await this.commit(lease,result)');
  modules['connection-throughput-entry.js']={type:'esm',contents:`
    import app,{SyncRuntime as ProductionRuntime} from './worker.js';
    import {wrapDatabase} from './src/application/installation-epoch.js';
    const latencyMs=${d1LatencyMs};
    function measuredDatabase(raw,measure){
      const capture=result=>{for(const value of Array.isArray(result)?result:[result]){measure.rowsRead+=value?.meta?.rows_read||0;measure.rowsWritten+=value?.meta?.rows_written||0;}return result;};
      const before=async()=>{measure.calls++;if(latencyMs)await new Promise(resolve=>setTimeout(resolve,latencyMs));};
      const statement=rawStatement=>({_fixtureRaw:rawStatement,bind(...params){return statement(rawStatement.bind(...params));},async all(){await before();return capture(await rawStatement.all());},async first(...args){await before();return rawStatement.first(...args);},async run(){await before();return capture(await rawStatement.run());}});
      return {prepare:sql=>statement(raw.prepare(sql)),async batch(statements){await before();measure.batches++;return capture(await raw.batch(statements.map(value=>value._fixtureRaw||value)));}};
    }
    export class SyncRuntime extends ProductionRuntime {
      constructor(ctx,env){const measure={calls:0,batches:0,rowsRead:0,rowsWritten:0};super(ctx,{...env,DB:measuredDatabase(env.DB,measure)});this.fixtureMeasure=measure;}
      async run(){
        const before={...this.fixtureMeasure};
        try{return await super.run();}
        finally{
          const last=await this.ctx.storage.get('last_run');
          if(Number.isFinite(last?.statements)){
            const metrics=await this.ctx.storage.get('fixture_metrics')||{runs:0,commitCount:0,recoveryCount:0,maxStatements:0,maxPayloadBytes:0,maxCheckpointBytes:0,maxD1Calls:0,totalD1Calls:0,totalRowsRead:0,totalRowsWritten:0,groups:{},phases:{},connectionPassRevisions:[],leaseLost:[],failures:[],violations:[]};
            const calls=this.fixtureMeasure.calls-before.calls,batches=this.fixtureMeasure.batches-before.batches,duration=last.finished_at-last.started_at,rowsRead=this.fixtureMeasure.rowsRead-before.rowsRead,rowsWritten=this.fixtureMeasure.rowsWritten-before.rowsWritten;
            metrics.runs++;metrics.commitCount+=last.committed?1:0;metrics.recoveryCount+=last.state==='recovering_connections'?1:0;metrics.maxStatements=Math.max(metrics.maxStatements,last.statements);metrics.maxPayloadBytes=Math.max(metrics.maxPayloadBytes,last.fixturePayloadBytes||0);metrics.maxCheckpointBytes=Math.max(metrics.maxCheckpointBytes,last.fixtureCheckpointBytes||0);metrics.maxD1Calls=Math.max(metrics.maxD1Calls,calls);metrics.totalD1Calls+=calls;metrics.totalRowsRead+=rowsRead;metrics.totalRowsWritten+=rowsWritten;
            const key=(last.provider||'runtime')+'/'+(last.component||last.state),group=metrics.groups[key]||{count:0,commits:0,maxStatements:0,maxPayloadBytes:0,totalD1Calls:0,maxD1Calls:0,batches:0,totalDurationMs:0,maxDurationMs:0,totalRowsRead:0,totalRowsWritten:0};
            group.count++;group.commits+=last.committed?1:0;group.maxStatements=Math.max(group.maxStatements,last.statements);group.maxPayloadBytes=Math.max(group.maxPayloadBytes,last.fixturePayloadBytes||0);group.totalD1Calls+=calls;group.maxD1Calls=Math.max(group.maxD1Calls,calls);group.batches+=batches;group.totalDurationMs+=duration;group.maxDurationMs=Math.max(group.maxDurationMs,duration);group.totalRowsRead+=rowsRead;group.totalRowsWritten+=rowsWritten;metrics.groups[key]=group;
            const phase=key+'/'+(last.fixtureInputCheckpoint?.phase||'initial'),phaseGroup=metrics.phases[phase]||{runs:0,commits:0,d1Calls:0,statements:0,rowsRead:0,rowsWritten:0,durationMs:0};phaseGroup.runs++;phaseGroup.commits+=last.committed?1:0;phaseGroup.d1Calls+=calls;phaseGroup.statements+=last.statements;phaseGroup.rowsRead+=rowsRead;phaseGroup.rowsWritten+=rowsWritten;phaseGroup.durationMs+=duration;metrics.phases[phase]=phaseGroup;
            if(last.provider==='domain'&&last.component==='connection'&&Number.isInteger(last.fixtureCheckpoint?.passRevision)&&!metrics.connectionPassRevisions.includes(last.fixtureCheckpoint.passRevision))metrics.connectionPassRevisions.push(last.fixtureCheckpoint.passRevision);
            metrics.last={provider:last.provider,component:last.component,state:last.state,checkpoint:last.fixtureCheckpoint,statements:last.statements,d1Calls:calls,started_at:last.started_at,finished_at:last.finished_at};
            if(last.state==='lease_lost')metrics.leaseLost.push({provider:last.provider,component:last.component});
            if(last.error)metrics.failures.push({provider:last.provider,component:last.component,state:last.state,error:last.error});
            if(last.statements>50||(last.fixturePayloadBytes||0)>2000000||last.state==='error')metrics.violations.push(last);
            await this.ctx.storage.put('fixture_metrics',metrics);
          }
        }
      }
      async fetch(request){if(new URL(request.url).pathname==='/fixture-metrics')return Response.json(await this.ctx.storage.get('fixture_metrics')||{});return super.fetch(request);}
    }
    export default {async fetch(request,env,ctx){const pathname=new URL(request.url).pathname;
      if(pathname==='/__fixture/sql'){try{const body=await request.json();if(!['all','first'].includes(body.method)||!/^\\s*(SELECT|PRAGMA)\\b/i.test(body.sql))throw Error('Read-only diagnostic SQL required.');const db=wrapDatabase(env.DB),statement=db.prepare(body.sql).bind(...body.params);return Response.json({value:await statement[body.method]()});}catch(error){return Response.json({error:String(error)});}}
      if(pathname.startsWith('/__fixture/provider/'))return env.PROVIDER_FETCH.fetch(new Request('https://mock-provider/__fixture/'+pathname.split('/').at(-1),request));
      if(pathname==='/__fixture/metrics')return env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/fixture-metrics');
      if(pathname==='/__fixture/runtime')return env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/status');
      const response=await app.fetch(request,env,ctx);if(request.headers.get('x-fixture-lose-response')==='1'&&response.status===202)return Response.json({error:{code:'simulated_response_loss'}},{status:503});return response;
    }};`};
  const provider=(await readFile(path.join(qaRoot,'tests/fixtures/connection-throughput-provider.mjs'),'utf8')).replaceAll('export const ','const ').replaceAll('export function ','function ');
  const previousDispatcher=getGlobalDispatcher(),dispatcher=new Agent({pipelining:0});setGlobalDispatcher(dispatcher);
  let mf;
  const dispose=async()=>{try{if(mf)await mf.dispose();}finally{setGlobalDispatcher(previousDispatcher);await dispatcher.close();}};
  try{
    mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:[
      {config:{name:'connection-throughput',compatibilityDate:'2026-09-09',manifest:{mainModule:'connection-throughput-entry.js',modulesRoot:root,modules},env:{ADMIN_KEY:{type:'text',value:PASSWORD},DB:{type:'d1',id:'connection-throughput'},SYNC:{type:'durable-object',worker:'connection-throughput',exportName:'SyncRuntime'},ASSETS:{type:'assets'},PROVIDER_FETCH:{type:'worker',worker:'connection-throughput-provider'}},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}},assets:{directory:path.join(root,'web'),hasUserWorker:true,runWorkerFirst:true}}},
      {config:{name:'connection-throughput-provider',compatibilityDate:'2026-09-09',manifest:{mainModule:'provider.mjs',modulesRoot:qaRoot,modules:{'provider.mjs':{type:'esm',contents:provider}}},env:{STATE:{type:'kv',id:'connection-throughput-provider-state'}},exports:{}}}
    ]});await mf.ready;
    let cookie='';
    async function request(route,{method='GET',body,headers={}}={}){const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json',Origin:'http://localhost'}:{}),...(cookie?{cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,data};}
    const statement=(sql,params=[])=>({bind(...values){return statement(sql,values);},async execute(method){const result=await request('/__fixture/sql',{method:'POST',body:{sql,params,method}});if(result.data.error)throw Error(result.data.error);return result.data.value;},first(){return this.execute('first');},all(){return this.execute('all');}}),db={prepare:sql=>statement(sql)};
    async function initialize(){for(let step=0;step<50;step++){const result=await request('/api/owner/initialize',{method:'POST',body:{password:PASSWORD}});if(![200,202].includes(result.status))throw Error(JSON.stringify(result));if(!result.data.continue)return;}throw Error('Initialization did not finish.');}
    async function waitFor(check,{timeout=180000,errors=true}={}){const deadline=Date.now()+timeout;while(Date.now()<deadline){const result=await check();if(result)return result;if(errors){const failed=(await db.prepare("SELECT component,state,last_error_code,last_error_message,checkpoint,rows_saved FROM sync_jobs WHERE state IN('failed','blocked','retrying')").all()).results;if(failed.length)throw Error('Native job failed: '+JSON.stringify(failed));const runtime=(await request('/__fixture/runtime')).data;if(runtime.state==='error')throw Error('Native runtime failed: '+JSON.stringify(runtime));}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Native connection throughput did not settle: '+JSON.stringify((await db.prepare('SELECT provider,component,state,checkpoint,last_error_code FROM sync_jobs').all()).results));}
    async function settle(options={}){return waitFor(async()=>{const state=await db.prepare("SELECT (SELECT COUNT(*) FROM sync_jobs WHERE state IN('queued','running','retrying') OR (state='ready' AND recurring=1 AND next_at<=strftime('%s','now')*1000+999)) jobs,(SELECT COUNT(*) FROM team_read_state WHERE pending=1) pending,(SELECT COUNT(*) FROM team_source_connections WHERE active=1 AND input_revision>reconciled_revision) roots").first();return state.jobs===0&&state.pending===0&&state.roots===0;},options);}
    console.log(JSON.stringify({native_connection_throughput_loaded:sourceFingerprint}));
    return {packageVersion,sourceHashes,d1LatencyMs,db,request,initialize,waitFor,settle,sourceFingerprint,provider:async()=>(await request('/__fixture/provider/status')).data,metrics:async()=>(await request('/__fixture/metrics')).data,dispose};
  }catch(error){await dispose();throw error;}
}
