import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {traceNativeGame} from './fixtures/trace-analysis-native.mjs';
const entry=`
import {initializeDomain} from './src/domain/schema.js';
import {installSyncSchema} from './src/sync/schema.js';
import {DomainRepository} from './src/domain/repository.js';
import {JobCoordinator} from './src/sync/coordinator.js';
import {BudgetDB} from './src/sync/budget.js';
import {collectApplicationJob} from './src/application/sync-service.js';
import {collectTrace} from './src/sources/trace.js';
import {SourceTransport} from './src/sources/http.js';
let game,mode,seconds,id,requests=0;const account={provider:'trace',id:'account',native_id:'1',generation:1};
async function provider(url,options){
 requests++;
 if(url.endsWith('/users/self/token'))return Response.json({data:{user_id:1,token:'synthetic',timestamp:1}});
 const q=JSON.parse(options.body);if(q.operationName==='game')return Response.json({data:{game}});
 if(q.operationName!=='getHaloData')throw Error('Unexpected provider operation');
 const s=q.variables.segments[0];
 if(mode==='oversize'&&s.duration===seconds*1000)return new Response(' '.repeat(8000001),{headers:{'Content-Type':'application/json'}});
 const step=mode==='dense_limit'?1:1000,ring=[];for(let at=s.local_start;at<s.local_start+s.duration;at+=step)ring.push([at,'L'],[Math.min(at+step/2,s.local_start+s.duration),'L'],[at+step*.75,'DISCONTINUITY']);
 return Response.json({data:{halo:{ring}},...(mode==='near_limit'?{padding:'x'.repeat(7800000)}:{})});
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/seed'){
  ({game,mode,seconds}=await request.json());await initializeDomain(env.DB);await installSyncSchema(env.DB);
  await env.DB.prepare("INSERT INTO provider_accounts(id,provider,native_id,name) VALUES('account','trace','1','Synthetic')").run();
  const repo=new DomainRepository(env.DB);await repo.ingestSourcePage({accountId:'account',generation:1,records:{teams:[{id:'trace:400',provider:'trace',native_id:'400',account_id:'account',name:'Synthetic',details:JSON.stringify({account_owned:true,catalog_scan_id:'catalog'})}]},scanId:'catalog'});
  await env.DB.batch([env.DB.prepare("INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES('team','Synthetic','UTC',2026,'test')"),env.DB.prepare("INSERT INTO team_read_state(app_team_id) VALUES('team')"),env.DB.prepare("INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,created_at) VALUES('root','team','trace/account/400','account','observed_history','test')")]);
  let cursor={},child;
  for(let i=0;i<10;i++){
   const page=await collectTrace({j:{kind:'game',scan_id:'game'},args:{team_id:'400',game_id:'4001',profile_hash:'synthetic'},cursor,account,credential:'PHPSESSID=synthetic',transport:new SourceTransport({}, {fetch:provider})});
   await repo.ingestSourcePage({...page,accountId:'account',generation:1,scanId:'game'});child=page.children.find(c=>c.kind==='tracking')||child;if(page.complete)break;cursor=page.checkpoint;
  }
  id=await new JobCoordinator(env.DB).enqueue({provider:'trace',component:'tracking',stage:'analysis',scope:child.scope,resourceKey:child.scope,args:child.args,accountId:'account',accountGeneration:1,recurring:false},[{kind:'team',key:'connection:root',teamId:'team'}]);requests=0;return Response.json({id});
 }
 if(url.pathname==='/step'){
  const db=new BudgetDB(env.DB,48),coordinator=new JobCoordinator(db,{pageDelayMs:0});let transport;const start=Date.now(),before=requests;
  const result=await coordinator.runOne(context=>collectApplicationJob({...context,env:{}},{credentialLoader:async()=>'PHPSESSID=synthetic',transportFactory:()=>transport=new SourceTransport({}, {fetch:provider})}));
  return Response.json({...result,statements:db.used,rows_read:db.rowsRead,rows_written:db.rowsWritten,wall_ms:Date.now()-start,requests:requests-before,response_bytes:(transport?.observations||[]).reduce((n,o)=>n+o.bytes,0)});
 }
 if(url.pathname==='/status')return Response.json({job:await env.DB.prepare('SELECT state,coverage,checkpoint,attempts FROM sync_jobs WHERE id=?').bind(id).first(),storage:await env.DB.prepare('SELECT count(*) rows,MAX(length(CAST(segments AS BLOB))) max_bytes,SUM(json_array_length(segments)) intervals FROM source_tracking_segments').first(),coverage:await env.DB.prepare("SELECT complete FROM source_component_coverage WHERE kind='tracking'").first()});
 return new Response('not found',{status:404});
}};
`;
test('Workerd/D1 full-half small, paginated, near-limit and oversized fallback stay within query and storage limits',{timeout:120000},async t=>{
 const modules={};for(const directory of ['src','web'])for(const file of await readdir(directory,{recursive:true}))if(file.endsWith('.js')){const name=directory+'/'+file;modules[name]={type:'esm',contents:await readFile(name,'utf8')};}
 const metrics=[];
 for(const [mode,seconds,expectedPages] of [['normal',120,1],['normal',2500,1],['normal',10000,3],['near_limit',120,1],['dense_limit',120,1],['oversize',120,5]]){
  const name='full-'+mode+'-'+seconds,mf=new Miniflare({cf:false,inspectorPort:0,telemetry:{enabled:false},logRequests:false,workers:[{config:{name,compatibilityDate:'2026-09-09',manifest:{mainModule:'entry.js',modulesRoot:path.resolve('.'),modules:{...modules,'entry.js':{type:'esm',contents:entry}}},env:{DB:{type:'d1',id:name}},exports:{}}}]});
  const request=async(route,body)=>{const r=await mf.dispatchFetch('https://fixture'+route,body?{method:'POST',body:JSON.stringify(body)}:{});assert.equal(r.status,200,await r.clone().text());return r.json();};
  try{
   await mf.ready;const game=traceNativeGame();game.moments.forEach(m=>m.duration=seconds);await request('/seed',{game,mode,seconds});const pages=[];
   for(let i=0;i<expectedPages;i++){const step=await request('/step');assert.ok(['queued','ready'].includes(step.state),JSON.stringify(step));assert.ok(step.statements<=48);pages.push(step);}
   const state=await request('/status');assert.equal(state.job.state,mode==='dense_limit'?'queued':'ready');assert.equal(state.job.coverage,mode==='dense_limit'?'partial':'complete');assert.equal(state.coverage.complete,mode==='dense_limit'?0:1);assert.equal(state.storage.intervals,mode==='dense_limit'?4000:seconds);if(mode==='dense_limit'){const checkpoint=JSON.parse(state.job.checkpoint);assert.equal(checkpoint.protocol,'trace-tracking-full-v1');assert.equal(checkpoint.offset,4000);}assert.ok(state.storage.max_bytes<=60000);
   metrics.push({mode,seconds,pages:pages.length,requests:pages.reduce((n,p)=>n+p.requests,0),max_statements:Math.max(...pages.map(p=>p.statements)),max_page_wall_ms:Math.max(...pages.map(p=>p.wall_ms)),response_bytes:pages.reduce((n,p)=>n+p.response_bytes,0),storage:state.storage});
  }finally{await mf.dispose();}
 }
 t.diagnostic(JSON.stringify({synthetic:true,native_workerd_d1:true,production_cpu_measurement:false,metrics}));
});
