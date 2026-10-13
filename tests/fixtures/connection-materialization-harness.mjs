import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
const PASSWORD='native-materialization-owner-password';
let loadedSourceFingerprint=null;

// The only substitutes are the remote provider and test clock/delivery faults.
// The production Worker, fresh installation, collectors, coordinator, native D1
// transactions and Durable Object alarms run normally. Only successful alarm
// and checkpoint continuations are accelerated; provider retry/lease timing and
// every production statement/collector remain unchanged.
export async function materializationHarness(){
  const root=path.resolve('.'),modules={};
  for(const file of ['worker.js','web/app/coach-tactics.js','web/app/schedule-query.js','web/app/reporting/encoders.js','web/app/reporting/font-metrics.js',...(await readdir('src',{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>'src/'+f)])modules[file]={type:'esm',contents:await readFile(file,'utf8')};
  const sourceFingerprint=createHash('sha256').update(Object.keys(modules).sort().map(name=>name+'\0'+modules[name].contents).join('\0')).digest('hex');
  if(loadedSourceFingerprint&&loadedSourceFingerprint!==sourceFingerprint)throw Error('Production source changed between native fixtures; rerun one frozen candidate.');
  loadedSourceFingerprint=sourceFingerprint;
  // Keep production auth error redaction intact. A test-only classifier emits
  // fixed category labels, never exception text, SQL values or credentials.
  const ownerErrorMarker="console.error(JSON.stringify({ event: 'owner_initialization_failed', phase, error_class: errorClass }));";
  if(modules['src/security/index.js'].contents.split(ownerErrorMarker).length!==2)throw Error('Owner diagnostic marker unavailable.');
  modules['src/security/index.js'].contents=modules['src/security/index.js'].contents.replace(ownerErrorMarker,ownerErrorMarker+`const diagnosticText=String(error?.message||'')+' '+String(error?.cause?.message||'');console.error(JSON.stringify({test_only_owner_failure:{phase,category:[[/network|fetch|socket|connection (?:closed|lost)/i,'transport'],[/no such (?:table|column)/i,'missing_schema'],[/foreign key/i,'foreign_key'],[/constraint/i,'constraint'],[/installation|epoch|writer.*fence/i,'installation_fence'],[/too many SQL|query limit|subrequest/i,'budget'],[/initial session was not committed/i,'session_batch_return_shape'],[/column.*values|has [0-9]+ columns/i,'column_count'],[/database.*locked/i,'locked']].find(([pattern])=>pattern.test(diagnosticText))?.[1]||'unclassified',cause_code:/^[A-Z_0-9]{1,80}$/.test(String(error?.cause?.code||''))?error.cause.code:null}}));`);
  const httpMarker='return await applicationRoutes(request,env,{db,installation,extraRoutes:[coachingRoutes]});';
  if(modules['worker.js'].contents.split(httpMarker).length!==2)throw Error('Production HTTP budget marker unavailable.');
  modules['worker.js'].contents='export const fixtureStreamBudgets=[];\n'+modules['worker.js'].contents;
  modules['worker.js'].contents=modules['worker.js'].contents.replace(httpMarker,`const fixtureResponse=await applicationRoutes(request,env,{db,installation,extraRoutes:[coachingRoutes]});const fixtureHeaders=new Headers(fixtureResponse.headers);fixtureHeaders.set('x-fixture-http-statements',String(budget.used));let fixtureBody=fixtureResponse.body;if(fixtureBody&&fixtureHeaders.get('content-type')==='application/zip'){const reader=fixtureBody.getReader(),started=Date.now();let recorded=false;const record=completed=>{if(!recorded){recorded=true;fixtureStreamBudgets.push({path:url.pathname,statements:budget.used,completed,elapsed_ms:Date.now()-started});}};fixtureBody=new ReadableStream({async pull(controller){try{const value=await reader.read();if(value.done){record(true);controller.close();}else controller.enqueue(value.value);}catch(error){record(false);controller.error(error);}},async cancel(reason){record(false);await reader.cancel(reason);}});}return new Response(fixtureBody,{status:fixtureResponse.status,headers:fixtureHeaders});`);
  if(process.env.MYTS_TEST_HTTP_ERRORS==='1')modules['worker.js'].contents=modules['worker.js'].contents.replace('}catch(error){return errorResponse(error);}',` }catch(error){if(url.pathname.startsWith('/api/matches/')||url.pathname.startsWith('/api/data/')||url.pathname==='/api/connections')console.error(JSON.stringify({test_only_http_failure:{code:error.code,message:error.message,cause:error.cause?.message,stack:error.stack}}));return errorResponse(error);}`);
  if(process.env.MYTS_TEST_HTTP_ERRORS==='1')modules['src/sync/runtime.js'].contents=modules['src/sync/runtime.js'].contents.replace('const failure = classifyFailure(error);',"console.error(JSON.stringify({test_only_runtime_failure:{message:error.message,cause:error.cause?.message,stack:error.stack}}));const failure = classifyFailure(error);");
  if(process.env.MYTS_TEST_HTTP_ERRORS==='1')modules['src/sync/coordinator.js'].contents=modules['src/sync/coordinator.js'].contents.replace('// Budget exhaustion before commit is a retry, not a successful partial page.',"console.error(JSON.stringify({test_only_collector_failure:{provider:lease.provider,component:lease.component,code:error.code,message:error.message,cause:error.cause?.message,stack:error.stack}}));\n      // Budget exhaustion before commit is a retry, not a successful partial page.");
  const runtimeMarker='runtimeOptions:{';
  if(modules['worker.js'].contents.split(runtimeMarker).length!==2)throw Error('Production runtime options could not be found for the test clock.');
  modules['worker.js'].contents=modules['worker.js'].contents.replace(runtimeMarker,runtimeMarker+'alarmDelayMs:1,pageDelayMs:1,');
  // Attach only diagnostic return metadata after the unchanged collector. No
  // SQL, commit result, lease, source retry or collection decision is replaced.
  const resultMarker='stage:lease.stage,...await this.commit(lease,result)';
  if(modules['src/sync/coordinator.js'].contents.split(resultMarker).length!==2)throw Error('Native result marker unavailable for pass/run counters.');
  modules['src/sync/coordinator.js'].contents=modules['src/sync/coordinator.js'].contents.replace(resultMarker,'stage:lease.stage,fixturePassRevision:result.checkpoint?.passRevision,fixturePeriod:result.checkpoint?.phase==="periods"?(result.checkpoint.period||result.checkpoint.after):null,fixtureRunId:result.checkpoint?.runId,fixturePublished:result.checkpoint?.published,fixtureRequestId:(typeof lease.args==="string"?JSON.parse(lease.args):lease.args)?.requestId,fixtureTeam:lease.scope,fixtureSeason:lease.resource_key,...await this.commit(lease,result)');
  modules['materialization-entry.js']={type:'esm',contents:`
    import app,{SyncRuntime as ProductionRuntime,fixtureStreamBudgets} from './worker.js';
    import {wrapDatabase} from './src/application/installation-epoch.js';
    export class SyncRuntime extends ProductionRuntime {
      async run(){const fixtureStarted=Date.now();try{return await super.run();}finally{const fixtureElapsed=Date.now()-fixtureStarted;
        const last=await this.ctx.storage.get('last_run');
        if(Number.isFinite(last?.statements)){
          const budget=await this.ctx.storage.get('fixture_budget')||{count:0,max:0,groups:{},window:{},violations:[]},key=(last.provider||'runtime')+'/'+(last.component||last.state||'unknown');
          budget.count++;budget.max=Math.max(budget.max,last.statements);
          budget.root_passes||={};budget.root_periods||={};budget.projection_runs||={};
          if(last.provider==='domain'&&last.component==='connection'&&Number.isFinite(last.fixturePassRevision)){const passes=budget.root_passes[last.jobId]||[];if(!passes.includes(last.fixturePassRevision))passes.push(last.fixturePassRevision);budget.root_passes[last.jobId]=passes;}
          if(last.provider==='domain'&&last.component==='connection'&&last.fixturePeriod){const periods=budget.root_periods[last.jobId]||[];if(!periods.includes(last.fixturePeriod))periods.push(last.fixturePeriod);budget.root_periods[last.jobId]=periods;}
          if(last.provider==='domain'&&last.component==='projection'&&last.fixtureRunId){const run=budget.projection_runs[last.fixtureRunId]||{job_id:last.jobId,team_id:last.fixtureTeam,season_id:last.fixtureSeason,request_id:last.fixtureRequestId,published:false};run.published ||= !!last.fixturePublished;budget.projection_runs[last.fixtureRunId]=run;}

          for(const groups of [budget.groups,budget.window]){const group=groups[key]||{count:0,max:0};group.count++;group.max=Math.max(group.max,last.statements);group.max_elapsed_ms=Math.max(group.max_elapsed_ms||0,fixtureElapsed);group.total_elapsed_ms=(group.total_elapsed_ms||0)+fixtureElapsed;groups[key]=group;}
          if(last.statements>50||last.state==='error')budget.violations.push({provider:last.provider,component:last.component,statements:last.statements,error:last.error});
          await this.ctx.storage.put('fixture_budget',budget);
        }
      }}
      async fetch(request){const path=new URL(request.url).pathname;
        if(path==='/fixture-scheduler')return Response.json({next_alarm:await this.ctx.storage.getAlarm(),connection_recovery_pending:await this.ctx.storage.get('connection_recovery_pending')||false,running:!!this.running});
        if(path==='/fixture-budget'){const budget=await this.ctx.storage.get('fixture_budget')||{count:0,max:0,groups:{},window:{},violations:[]};if(request.method==='DELETE'){budget.window={};await this.ctx.storage.put('fixture_budget',budget);}return Response.json(budget);}
        return super.fetch(request);
      }
    }
    export default {async fetch(request,env,ctx){
      const path=new URL(request.url).pathname;
      if(path==='/__fixture/stream-budgets')return Response.json(fixtureStreamBudgets);
      if(path==='/__fixture/sql'){
        try{const input=await request.json(),db=wrapDatabase(env.DB),statements=input.statements.map(s=>db.prepare(s.sql).bind(...s.params));
          return Response.json({value:input.method==='batch'?await db.batch(statements):await statements[0][input.method]()});
        }catch(error){return Response.json({error:String(error)});}
      }
      if(path.startsWith('/__fixture/provider'))return env.PROVIDER_FETCH.fetch(new Request('https://mock-provider/__fixture/'+path.split('/').at(-1),request));
      if(path==='/__fixture/cron'){const pending=[];await app.scheduled({scheduledTime:Date.now(),cron:'*/15 * * * *'},env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);return Response.json({scheduled:true});}
      if(path==='/__fixture/budget')return env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/fixture-budget',{method:request.method});
      if(path==='/__fixture/scheduler')return env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/fixture-scheduler');
      if(path==='/__fixture/runtime')return env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/status');
      const response=await app.fetch(request,env,ctx);
      if(request.headers.get('x-fixture-lose-response')==='1'&&response.status===202)return Response.json({error:{code:'simulated_response_loss'}},{status:503});
      return response;
    }};`};
  const provider=await readFile('tests/fixtures/connection-materialization-provider.mjs','utf8');
  const previousDispatcher=getGlobalDispatcher(),dispatcher=new Agent({pipelining:0});setGlobalDispatcher(dispatcher);
  const mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:[
    {config:{name:'materialization',compatibilityDate:'2026-09-09',manifest:{mainModule:'materialization-entry.js',modulesRoot:root,modules},env:{ADMIN_KEY:{type:'text',value:PASSWORD},DB:{type:'d1',id:'materialization'},SYNC:{type:'durable-object',worker:'materialization',exportName:'SyncRuntime'},ASSETS:{type:'assets'},PROVIDER_FETCH:{type:'worker',worker:'materialization-provider'}},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}},assets:{directory:path.join(root,'web'),hasUserWorker:true,runWorkerFirst:true}}},
    {config:{name:'materialization-provider',compatibilityDate:'2026-09-09',manifest:{mainModule:'provider.mjs',modulesRoot:root,modules:{'provider.mjs':{type:'esm',contents:provider}}},env:{STATE:{type:'kv',id:'materialization-provider-state'}},exports:{}}}
  ]});
  try{await mf.ready;console.log(JSON.stringify({native_materialization_loaded:sourceFingerprint,at:new Date().toISOString()}));}catch(error){await mf.dispose().catch(()=>{});setGlobalDispatcher(previousDispatcher);await dispatcher.close();throw error;}let cookie='',config={gotsport:{},teamsnap:{teams:[],members:[],events:[],attendance:[]}};
  async function request(route,{method='GET',body,headers={},binary=false}={}){
    const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json',Origin:'http://localhost'}:{}),...(cookie?{cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    let data;if(binary)data=new Uint8Array(await response.arrayBuffer());else{const raw=await response.text();try{data=JSON.parse(raw);}catch{data=raw;}}const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,data,statements:Number(response.headers.get('x-fixture-http-statements'))};
  }
  const inspectionRetries=[];
  async function invoke(body){
    let result;try{result=await request('/__fixture/sql',{method:'POST',body});}catch(error){
      // Miniflare can close its localhost inspection socket. A single retry is
      // permitted ONLY for read-only test observation, never an app request,
      // source action, clock change, fixture mutation, or native transaction.
      const readOnly=body.statements.every(s=>/^\s*(SELECT\b|PRAGMA\s+foreign_key_check\b)/i.test(s.sql));
      if(!readOnly||error?.name!=='TypeError'||error?.message!=='fetch failed')throw error;
      inspectionRetries.push({at:Date.now(),code:error.cause?.code||null,message:error.cause?.message||error.message});
      result=await request('/__fixture/sql',{method:'POST',body});
    }
    if(result.data.error)throw Error(result.data.error);return result.data.value;
  }
  const statement=(sql,params=[])=>({sql,params,bind(...values){return statement(sql,values);},first(){return invoke({method:'first',statements:[{sql,params}]});},all(){return invoke({method:'all',statements:[{sql,params}]});},run(){return invoke({method:'run',statements:[{sql,params}]});}});
  const db={prepare:sql=>statement(sql),batch:statements=>invoke({method:'batch',statements:statements.map(({sql,params})=>({sql,params}))})};
  async function configure(change){config=typeof change==='function'?change(structuredClone(config)):{...config,...change};const result=await request('/__fixture/provider/config',{method:'PUT',body:config});if(result.status!==200)throw Error(JSON.stringify(result));}
  async function initialize(){for(let step=0;step<50;step++){const r=await request('/api/owner/initialize',{method:'POST',body:{password:PASSWORD}});if(![200,202].includes(r.status)){if(r.data?.error?.code==='owner_initialization_failed')console.error(JSON.stringify({test_only_owner_commit_counts:await db.prepare('SELECT (SELECT count(*) FROM security_owner) owners,(SELECT count(*) FROM security_sessions) sessions,(SELECT count(*) FROM security_installation) installations').first()}));throw Error(JSON.stringify(r));}if(!r.data.continue)return;}throw Error('Initialization did not finish.');}
  async function diagnostics(){return {
    runtime:(await request('/__fixture/runtime')).data,scheduler:(await request('/__fixture/scheduler')).data,
    jobs:(await db.prepare("SELECT id,provider,component,scope,state,generation,authorization_generation,recurring,next_at,checkpoint,args,last_error_code,last_error_message FROM sync_jobs WHERE provider='domain' OR state NOT IN('ready','disabled') OR(recurring=1 AND state='ready' AND next_at<=strftime('%s','now')*1000+999) ORDER BY provider,component").all()).results,
    job_counts:(await db.prepare('SELECT provider,component,state,count(*) total FROM sync_jobs GROUP BY provider,component,state').all()).results,
    subscribers:(await db.prepare("SELECT s.*,j.provider,j.component,j.scope,j.state,c.generation current_root_generation,c.active root_active FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id LEFT JOIN team_source_connections c ON s.demand_key='connection:'||c.id WHERE j.provider='domain' OR j.state NOT IN('ready','disabled') OR(j.recurring=1 AND j.state='ready' AND j.next_at<=strftime('%s','now')*1000+999)").all()).results,
    roots:(await db.prepare('SELECT id,app_team_id,source_team_id,scope_mode,input_revision,reconciled_revision,generation,active FROM team_source_connections').all()).results,
    reads:(await db.prepare('SELECT * FROM team_read_state').all()).results,
    pending_projections:(await db.prepare('SELECT * FROM team_projection_state WHERE pending=1').all()).results
  };}
  async function waitFor(check,{timeout=120000,errors=true}={}){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){const value=await check();if(value)return value;if(errors){const failed=(await db.prepare("SELECT provider,component,state,last_error_code,last_error_message FROM sync_jobs WHERE state IN('failed','blocked','retrying')").all()).results;if(failed.length)throw Error('Native job failed: '+JSON.stringify(failed));const runtime=(await request('/__fixture/runtime')).data;if(runtime.state==='error')throw Error('Native runtime failed: '+JSON.stringify(runtime));}await new Promise(r=>setTimeout(r,100));}
    const detail=await diagnostics();console.error(JSON.stringify({native_materialization_diagnostics:detail}));
    throw Error('Native materialization did not settle: '+JSON.stringify(detail));
  }
  async function settle(options={}){return waitFor(async()=>{const state=await db.prepare("SELECT (SELECT count(*) FROM sync_jobs WHERE state IN('queued','running','retrying') OR (state='ready' AND recurring=1 AND next_at<=strftime('%s','now')*1000+999)) AS jobs,(SELECT count(*) FROM team_read_state WHERE pending=1) AS pending,(SELECT count(*) FROM team_source_connections WHERE active=1 AND input_revision>reconciled_revision) AS roots").first();return state.jobs===0&&state.pending===0&&state.roots===0;},options);}
  // Simulate the arrival of a provider poll interval, then call the production
  // scheduled event. Do not call a collector, materializer, or runner directly.
  async function poll(provider,component,{scope=null}={}){
    await db.prepare("UPDATE sync_jobs SET next_at=? WHERE provider=? AND component=? AND state='ready' AND (? IS NULL OR scope=?)").bind(Date.now()-1,provider,component,scope,scope).run();
    const result=await request('/__fixture/cron',{method:'POST',body:{}});if(result.status!==200)throw Error(JSON.stringify(result));
  }
  return {mf,db,sourceFingerprint,inspectionRetries,request,streamBudgets:async()=>(await request('/__fixture/stream-budgets')).data,configure,initialize,waitFor,settle,poll,diagnostics,provider:async()=>(await request('/__fixture/provider/status')).data,budgets:async()=>(await request('/__fixture/budget')).data,clearBudgetWindow:()=>request('/__fixture/budget',{method:'DELETE'}),dispose:async()=>{await mf.dispose();setGlobalDispatcher(previousDispatcher);await dispatcher.close();}};
}

export function rankingGame(id,team,instant=null,{event=110,day=null,...extra}={}){
  return {id,event_id:event,event_name:'Simulated '+event,schedule_id:event+100,match_number:id,match_date:day,matchTime:instant,home_team_reg_id:team+1000,away_team_reg_id:999000,homeTeam:{team_id:team,full_name:'Simulated Team '+team},awayTeam:{team_id:999001,full_name:'Simulated opponent'},home_score:2,away_score:1,...extra};
}
export function teamSnapGame(id,instant){return {id,team_id:321,is_game:true,name:'Simulated game '+id,start_date:instant,opponent_name:'Simulated opponent',game_type:'home',game_type_code:1};}
