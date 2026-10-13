import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {traceNativeGame,traceRadar} from './fixtures/trace-analysis-native.mjs';

// Synthetic provider responses only. Production collectors, dispatcher,
// coordinator, authorization proof, SQL and D1 transactions are unchanged.
const entry=`
import {initializeDomain} from './src/domain/schema.js';
import {installSyncSchema} from './src/sync/schema.js';
import {DomainRepository} from './src/domain/repository.js';
import {JobCoordinator} from './src/sync/coordinator.js';
import {BudgetDB} from './src/sync/budget.js';
import {SourceTransport} from './src/sources/http.js';
import {collectApplicationJob} from './src/application/sync-service.js';
const wallNow=Date.now;let elapsed=0;Date.now=()=>wallNow()+elapsed;
let game,radar,jobId,mode,fetches=0;
async function provider(url,options){
 if(url.endsWith('/users/self/token'))return Response.json({data:{user_id:1,token:'synthetic-token',timestamp:1}});
 if(url.includes('/test-assets/radar'))return Response.json(radar);
 const request=JSON.parse(options.body);
 if(request.operationName==='game'){fetches++;if(mode==='churn'||mode==='legacy'){game.is_favorite=fetches%2===0;game.team_members.reverse();game.moments.reverse();}if(mode==='changing')game.moments[0].title='revision '+fetches;return Response.json({data:{game}});}
 if(request.operationName==='getHaloData'){const s=request.variables.segments[0];return Response.json({data:{halo:{ring:[[s.local_start,'L'],[s.local_start+s.duration,'L']]}}});}
 if(request.operationName==='gameStats')return Response.json({data:{gameStats:{available:'ready',possession:50,total_possession:120,shots:{total:1,made:0,items:[{start:1700002012500,x:200,y:300,side:request.variables.side,made:false}]}}}});
 if(request.operationName==='gameStatsHeatmap')return Response.json({data:{playerGameHeatMap:{map:[[0,1],[2,0]]}}});
 throw new Error('Unexpected synthetic provider operation');
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/seed'){
  ({game,radar,mode}=await request.json());fetches=0;elapsed=0;await initializeDomain(env.DB);await installSyncSchema(env.DB);
  await env.DB.prepare("INSERT INTO provider_accounts(id,provider,native_id,name) VALUES('account','trace','1','Synthetic')").run();
  const repo=new DomainRepository(env.DB);
  await repo.ingestSourcePage({accountId:'account',generation:1,records:{teams:[{id:'trace:400',provider:'trace',native_id:'400',account_id:'account',name:'Synthetic',details:JSON.stringify({account_owned:true,catalog_scan_id:'catalog'})}]},scanId:'catalog'});
  await env.DB.batch([
   env.DB.prepare("INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES('team','Synthetic','UTC',2026,'test')"),
   env.DB.prepare("INSERT INTO team_read_state(app_team_id) VALUES('team')"),
   env.DB.prepare("INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,created_at) VALUES('root','team','trace/account/400','account','observed_history','test')")
  ]);
  jobId=await new JobCoordinator(env.DB).enqueue({provider:'trace',component:'game',stage:'source',scope:'trace:4001:trace:400',resourceKey:'trace:4001:trace:400',accountId:'account',accountGeneration:1,recurring:false,priority:80,args:{team_id:'400',game_id:'4001',profile_hash:'synthetic-profile'}},[{kind:'team',key:'connection:root',teamId:'team'}]);
  if(mode==='legacy')await env.DB.prepare("UPDATE sync_jobs SET checkpoint=? WHERE id=?").bind(JSON.stringify({stage:'derived',offset:100,digest:'a'.repeat(64),profile_hash:'synthetic-profile'}),jobId).run();
  return Response.json({jobId});
 }
 if(url.pathname==='/advance'){
  const due=await env.DB.prepare('SELECT next_at FROM sync_jobs WHERE id=?').bind(jobId).first('next_at');
  elapsed=Math.max(0,due-wallNow()+1);mode='stable';game.team_members[0].join_time='2025-09-01T12:34:56Z';
  return Response.json({now:Date.now(),due});
 }
 if(url.pathname==='/step'){
  const db=new BudgetDB(env.DB,48),coordinator=new JobCoordinator(db,{pageDelayMs:0});let transport;
  const result=await coordinator.runOne(context=>collectApplicationJob({...context,env:{}},{credentialLoader:async()=>'PHPSESSID=synthetic',transportFactory:()=>transport=new SourceTransport({}, {fetch:provider})}));
  return Response.json({...result,statements:db.used,rows_read:db.rowsRead,rows_written:db.rowsWritten,response_bytes:(transport?.observations||[]).reduce((n,o)=>n+(o.bytes||0),0)});
 }
 if(url.pathname==='/status'){
  const result={job:await env.DB.prepare('SELECT * FROM sync_jobs WHERE id=?').bind(jobId).first(),jobs:(await env.DB.prepare('SELECT component,state,failures,COUNT(*) AS count FROM sync_jobs GROUP BY component,state,failures').all()).results};
  for(const table of ['source_game_members','source_game_moments','source_tracking_segments','source_stat_summaries','source_stat_items','source_heatmaps'])result[table]=await env.DB.prepare('SELECT COUNT(*) AS count FROM '+table).first('count');
  result.components=(await env.DB.prepare('SELECT kind,COUNT(*) AS count FROM source_trace_components GROUP BY kind').all()).results;
  result.members=(await env.DB.prepare('SELECT join_time,leave_time,evidence FROM source_game_members ORDER BY native_key').all()).results;
  result.moments=(await env.DB.prepare('SELECT half,time_seconds,duration_seconds FROM source_game_moments ORDER BY native_key').all()).results;
  result.fetches=fetches;result.next_wake=await new JobCoordinator(env.DB).nextWake();return Response.json(result);
 }
 return new Response('not found',{status:404});
}};
`;

async function sourceModules(){
 const modules={};for(const directory of ['src','web'])for(const file of await readdir(directory,{recursive:true}))if(file.endsWith('.js')){
  const name=directory+'/'+file;modules[name]={type:'esm',contents:await readFile(name,'utf8')};
 }
 return modules;
}
const fingerprint=modules=>createHash('sha256').update(Object.keys(modules).sort().map(name=>name+'\0'+modules[name].contents).join('\0')).digest('hex');

test('Workerd/D1 completes Trace semantic continuations and legacy resume; genuine change pauses and resumes automatically',{timeout:120000},async()=>{
 const modules=await sourceModules(),before=fingerprint(modules),metrics=[];
 for(const mode of ['churn','legacy','changing']){
  const game=traceNativeGame();game.team_members.forEach((m,i)=>{m.join_time=i%2?'123.5':'2025-08-01T05:00:00.123456-07:00';m.leave_time=null;});
  game.moments[0].half='1';game.moments[0].duration='120';game.moments[0].time='12.5';
  game.moments.push({game_id:4001,type:'Highlight',half:null,time:' ',duration:'',start_time:null});
  
  const mf=new Miniflare({cf:false,inspectorPort:0,telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'trace-member-'+mode,compatibilityDate:'2026-09-09',manifest:{mainModule:'trace-member-entry.js',modulesRoot:path.resolve('.'),modules:{...modules,'trace-member-entry.js':{type:'esm',contents:entry}}},env:{DB:{type:'d1',id:'trace-member-'+mode}},exports:{}}}]});
  const request=async(route,body)=>{const response=await mf.dispatchFetch('https://fixture'+route,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return response.json();};
  try{
   await mf.ready;const seeded=await request('/seed',{game,radar:traceRadar(game),mode}),first=await request('/step');
   assert.equal(first.state,'queued');assert.equal(first.jobId,seeded.jobId);
   const saved=await request('/status');assert.equal(JSON.parse(saved.job.checkpoint).stage,'members');
   assert.deepEqual(saved.components,[{kind:'clip',count:2},{kind:'header',count:1}]);
   let steps=[first];
   if(mode!=='changing'){
    for(let i=0;i<150;i++){const step=await request('/step');steps.push(step);if(step.state==='idle')break;assert.ok(['queued','ready'].includes(step.state),JSON.stringify(step));if(i===149)assert.fail('workflow did not drain');}
    const state=await request('/status');
    assert.equal(state.job.state,'ready');assert.equal(state.job.pages_saved,4);assert.equal(state.job.failures,0);
    assert.ok(state.jobs.every(j=>j.state==='ready'&&j.failures===0));
    assert.equal(state.jobs.reduce((n,j)=>n+j.count,0),44);
    for(const [table,count] of Object.entries({source_game_members:7,source_game_moments:3,source_tracking_segments:56,source_stat_summaries:27,source_stat_items:27,source_heatmaps:27}))assert.equal(state[table],count,table);
    assert.deepEqual(state.components,[{kind:'clip',count:2},{kind:'header',count:1},{kind:'radar',count:2}]);
    assert.equal(state.members[0].join_time,Date.UTC(2025,7,1,12,0,0,123));
    assert.equal(JSON.parse(state.members[0].evidence).join_time,'2025-08-01T05:00:00.123456-07:00');
    assert.equal(state.members[1].join_time,123.5);assert.equal(JSON.parse(state.members[1].evidence).join_time,'123.5');
    assert.deepEqual(state.moments.find(m=>m.half===null),{half:null,time_seconds:null,duration_seconds:null});
   }else{
    for(let i=0;i<3;i++){const step=await request('/step');steps.push(step);assert.equal(step.state,'queued');}
    const paused=await request('/status'),cp=JSON.parse(paused.job.checkpoint);assert.equal(cp.stage,'header');assert.ok(cp.retry_at>Date.now()+14*60_000);assert.equal(paused.job.pages_saved,4);assert.equal(paused.job.coverage,'partial');assert.equal(paused.job.last_complete_at,null);assert.equal(paused.source_game_members,0);assert.equal(paused.source_game_moments,0);
    const failure=await request('/step');steps.push(failure);assert.equal(failure.state,'retrying');assert.equal(failure.error.code,'source_changing');const waiting=await request('/status');assert.equal(waiting.fetches,paused.fetches);assert.equal(waiting.job.checkpoint,paused.job.checkpoint);assert.equal(waiting.job.pages_saved,4);assert.ok(waiting.job.next_at>Date.now()+14*60_000);assert.equal(waiting.job.last_complete_at,null);assert.equal((await request('/step')).state,'idle');
    assert.deepEqual(waiting.components,saved.components,'saved header and clips survive the automatic pause');
    const advanced=await request('/advance');assert.ok(advanced.now>=waiting.job.next_at);
    // Only the fixture clock/provider change. No retry command, job UPDATE,
    // checkpoint reset or owner wake is used to resume the persisted job.
    for(let i=0;i<4;i++){const step=await request('/step');steps.push(step);assert.equal(step.jobId,seeded.jobId);assert.equal(step.state,i===3?'ready':'queued');}
    const resumed=await request('/status');assert.equal(resumed.job.state,'ready');assert.equal(resumed.job.coverage,'complete');assert.ok(resumed.job.last_complete_at);assert.equal(resumed.job.last_error_code,null);assert.equal(resumed.job.failures,0);assert.equal(resumed.job.pages_saved,8);assert.equal(resumed.source_game_members,7);assert.equal(resumed.source_game_moments,3);assert.ok(resumed.members.some(m=>m.join_time===Date.UTC(2025,8,1,12,34,56)&&JSON.parse(m.evidence).join_time==='2025-09-01T12:34:56Z'),'genuine source change during pause is saved after automatic due-time resumption');
   }
   metrics.push({mode,invocations:steps.length,maximum_statements:Math.max(...steps.map(s=>s.statements)),total_rows_read:steps.reduce((n,s)=>n+s.rows_read,0),total_rows_written:steps.reduce((n,s)=>n+s.rows_written,0),total_provider_response_bytes:steps.reduce((n,s)=>n+s.response_bytes,0)});
  }finally{await mf.dispose();}
 }
 const after=fingerprint(await sourceModules());assert.equal(after,before,'production modules stayed frozen during native proof');
 console.log(JSON.stringify({trace_continuation_native:{source_fingerprint:before,metrics,private_provider_receipt:false}}));
});
