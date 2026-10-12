import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
const PASSWORD='native-large-history-owner-password';

// Native production HTTP, source transport, repository, epoch fencing, D1 and
// Durable Object alarms. Only the remote provider and due-time arrivals are
// synthetic. Instrumentation observes the unchanged 50-SQL / 2-MB guards.
export async function largeHistoryHarness(){
  const qaRoot=path.resolve('.'),root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||qaRoot),modules={};
  for(const file of ['worker.js','web/app/coach-tactics.js',...(await readdir(path.join(root,'src'),{recursive:true})).filter(file=>file.endsWith('.js')).map(file=>'src/'+file)])modules[file]={type:'esm',contents:await readFile(path.join(root,file),'utf8')};
  const sourceFingerprint=createHash('sha256').update(Object.keys(modules).sort().map(name=>name+'\0'+modules[name].contents).join('\0')).digest('hex');
  const replace=(file,before,after)=>{if(modules[file].contents.split(before).length!==2)throw Error('Native diagnostic marker unavailable: '+file+' '+before);modules[file].contents=modules[file].contents.replace(before,after);};
  replace('worker.js','runtimeOptions:{','runtimeOptions:{alarmDelayMs:1,pageDelayMs:1,');
  replace('src/sync/coordinator.js',"return { state:result.complete?'ready':'queued', committed:true, coverage:","return { state:result.complete?'ready':'queued', committed:true, fixturePayloadBytes:payloadBytes, fixtureCheckpointBytes:size(checkpoint), coverage:");
  replace('src/sync/coordinator.js','stage:lease.stage,...await this.commit(lease,result)','stage:lease.stage,fixtureCheckpoint:result.checkpoint,...await this.commit(lease,result)');
  modules['large-history-entry.js']={type:'esm',contents:`
    import app,{SyncRuntime as ProductionRuntime} from './worker.js';
    import {wrapDatabase} from './src/application/installation-epoch.js';
    export class SyncRuntime extends ProductionRuntime {
      async run(){try{return await super.run();}finally{const last=await this.ctx.storage.get('last_run');if(Number.isFinite(last?.statements)){const metrics=await this.ctx.storage.get('fixture_metrics')||{maxStatements:0,maxPayloadBytes:0,maxCheckpointBytes:0,localSlices:0,groups:{},commits:[],leaseLost:[],failures:[],violations:[]};metrics.maxStatements=Math.max(metrics.maxStatements,last.statements);metrics.maxPayloadBytes=Math.max(metrics.maxPayloadBytes,last.fixturePayloadBytes||0);metrics.maxCheckpointBytes=Math.max(metrics.maxCheckpointBytes,last.fixtureCheckpointBytes||0);const key=(last.provider||'runtime')+'/'+(last.component||last.state),group=metrics.groups[key]||{count:0,maxStatements:0,maxPayloadBytes:0};group.count++;group.maxStatements=Math.max(group.maxStatements,last.statements);group.maxPayloadBytes=Math.max(group.maxPayloadBytes,last.fixturePayloadBytes||0);metrics.groups[key]=group;if(last.provider==='teamsnap'&&last.component==='events'&&last.fixtureCheckpoint?.offset>0)metrics.localSlices++;if(last.committed&&metrics.commits.length<16)metrics.commits.push({jobId:last.jobId,provider:last.provider,component:last.component,state:last.state,statements:last.statements,bytes:last.fixturePayloadBytes,checkpoint:last.fixtureCheckpoint});if(last.state==='lease_lost')metrics.leaseLost.push({provider:last.provider,component:last.component});if(last.error)metrics.failures.push({provider:last.provider,component:last.component,state:last.state,error:last.error});if(last.statements>50||(last.fixturePayloadBytes||0)>2000000||last.state==='error')metrics.violations.push(last);await this.ctx.storage.put('fixture_metrics',metrics);}}}
      async fetch(request){if(new URL(request.url).pathname==='/fixture-metrics')return Response.json(await this.ctx.storage.get('fixture_metrics')||{});return super.fetch(request);}
    }
    export default {async fetch(request,env,ctx){const pathname=new URL(request.url).pathname;
      if(pathname==='/__fixture/sql'){try{const body=await request.json(),db=wrapDatabase(env.DB),statement=db.prepare(body.sql).bind(...body.params);return Response.json({value:await statement[body.method]()});}catch(error){return Response.json({error:String(error)});}}
      if(pathname.startsWith('/__fixture/provider/'))return env.PROVIDER_FETCH.fetch(new Request('https://mock-provider/__fixture/'+pathname.split('/').at(-1),request));
      if(pathname==='/__fixture/metrics')return env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/fixture-metrics');
      if(pathname==='/__fixture/runtime')return env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/status');
      if(pathname==='/__fixture/cron'){const pending=[];await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,{waitUntil:promise=>pending.push(promise)});await Promise.all(pending);return Response.json({scheduled:true});}
      const response=await app.fetch(request,env,ctx);if(request.headers.get('x-fixture-lose-response')==='1'&&response.status===202)return Response.json({error:{code:'simulated_response_loss'}},{status:503});return response;
    }};`};
  const provider=(await readFile(path.join(qaRoot,'tests/fixtures/teamsnap-large-history-provider.mjs'),'utf8')).replaceAll('export const ','const ').replaceAll('export function ','function ');
  const previousDispatcher=getGlobalDispatcher(),dispatcher=new Agent({pipelining:0});setGlobalDispatcher(dispatcher);
  let mf;
  const dispose=async()=>{try{if(mf)await mf.dispose();}finally{setGlobalDispatcher(previousDispatcher);await dispatcher.close();}};
  try{
    mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:[
      {config:{name:'large-history',compatibilityDate:'2026-09-09',manifest:{mainModule:'large-history-entry.js',modulesRoot:root,modules},env:{ADMIN_KEY:{type:'text',value:PASSWORD},DB:{type:'d1',id:'large-history'},SYNC:{type:'durable-object',worker:'large-history',exportName:'SyncRuntime'},ASSETS:{type:'assets'},PROVIDER_FETCH:{type:'worker',worker:'large-history-provider'}},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}},assets:{directory:path.join(root,'web'),hasUserWorker:true,runWorkerFirst:true}}},
      {config:{name:'large-history-provider',compatibilityDate:'2026-09-09',manifest:{mainModule:'provider.mjs',modulesRoot:qaRoot,modules:{'provider.mjs':{type:'esm',contents:provider}}},env:{STATE:{type:'kv',id:'large-history-provider-state'}},exports:{}}}
    ]});await mf.ready;
    let cookie='',config={};
    async function request(route,{method='GET',body,headers={}}={}){const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json',Origin:'http://localhost'}:{}),...(cookie?{cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,data};}
    const statement=(sql,params=[])=>({bind(...values){return statement(sql,values);},async execute(method){const result=await request('/__fixture/sql',{method:'POST',body:{sql,params,method}});if(result.data.error)throw Error(result.data.error);return result.data.value;},first(){return this.execute('first');},all(){return this.execute('all');},run(){return this.execute('run');}}),db={prepare:sql=>statement(sql)};
    async function configure(change){config=typeof change==='function'?change(structuredClone(config)):{...config,...change};const result=await request('/__fixture/provider/config',{method:'PUT',body:config});if(result.status!==200)throw Error(JSON.stringify(result));}
    async function initialize(){for(let step=0;step<50;step++){const result=await request('/api/owner/initialize',{method:'POST',body:{password:PASSWORD}});if(![200,202].includes(result.status))throw Error(JSON.stringify(result));if(!result.data.continue)return;}throw Error('Initialization did not finish.');}
    async function waitFor(check,{timeout=180000,errors=true}={}){const deadline=Date.now()+timeout;while(Date.now()<deadline){const result=await check();if(result)return result;if(errors){const failed=(await db.prepare("SELECT component,state,last_error_code,last_error_message,checkpoint,rows_saved FROM sync_jobs WHERE state IN('failed','blocked','retrying')").all()).results;if(failed.length)throw Error('Native job failed: '+JSON.stringify(failed));const runtime=(await request('/__fixture/runtime')).data;if(runtime.state==='error')throw Error('Native runtime failed: '+JSON.stringify(runtime));}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Native large history did not settle: '+JSON.stringify((await db.prepare('SELECT provider,component,state,checkpoint,last_error_code FROM sync_jobs').all()).results));}
    async function settle(options={}){return waitFor(async()=>{const state=await db.prepare("SELECT (SELECT COUNT(*) FROM sync_jobs WHERE state IN('queued','running','retrying') OR (state='ready' AND recurring=1 AND next_at<=strftime('%s','now')*1000+999)) jobs,(SELECT COUNT(*) FROM team_read_state WHERE pending=1) pending,(SELECT COUNT(*) FROM team_source_connections WHERE active=1 AND input_revision>reconciled_revision) roots").first();return state.jobs===0&&state.pending===0&&state.roots===0;},options);}
    async function advance(component,state='ready'){await db.prepare('UPDATE sync_jobs SET next_at=? WHERE provider=? AND component=? AND state=?').bind(Date.now()-1,'teamsnap',component,state).run();const result=await request('/__fixture/cron',{method:'POST',body:{}});if(result.status!==200)throw Error(JSON.stringify(result));}
    console.log(JSON.stringify({native_large_history_loaded:sourceFingerprint}));
    return {db,request,configure,initialize,waitFor,settle,advance,sourceFingerprint,provider:async()=>(await request('/__fixture/provider/status')).data,metrics:async()=>(await request('/__fixture/metrics')).data,dispose};
  }catch(error){await dispose();throw error;}
}
