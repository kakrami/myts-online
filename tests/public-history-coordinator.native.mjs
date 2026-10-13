import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {publicHistoryProof,publicHistoryContext,publicHistoryQuery,publicHistoryAdmission} from '../src/sync/public-history.js';
import {historyBridgeStatements,historyBridgeDivisionStatements,historyBridgeProof} from './fixtures/public-history-bridge-fixture.mjs';
import {fixture,AT,INPUT,HOME} from './fixtures/head-to-head-harness.mjs';

let loadedModules;
async function harness(){
 const root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||'.'),modules={},prior=getGlobalDispatcher(),agent=new Agent({pipelining:0});setGlobalDispatcher(agent);
 if(!loadedModules){loadedModules={};for(const file of(await readdir(path.join(root,'src'),{recursive:true})).filter(file=>file.endsWith('.js')))loadedModules['src/'+file]={type:'esm',contents:await readFile(path.join(root,'src',file),'utf8')};loadedModules['web/app/coach-tactics.js']={type:'esm',contents:await readFile(path.join(root,'web/app/coach-tactics.js'),'utf8')};for(const name of ['web/app/schedule-query.js','web/app/reporting/encoders.js','web/app/reporting/font-metrics.js'])loadedModules[name]={type:'esm',contents:await readFile(path.join(root,name),'utf8')};console.log(JSON.stringify({native_public_history_source:createHash('sha256').update(Object.keys(loadedModules).sort().map(name=>name+'\0'+loadedModules[name].contents).join('\0')).digest('hex')}));}Object.assign(modules,loadedModules);
 modules['public-history-proof.js']={type:'esm',contents:`
  import {FreshInstallation} from './src/application/fresh-install.js';
  import {SCHEMA,SEED} from './src/application/installation-schema.js';
  import {wrapDatabase} from './src/application/installation-epoch.js';
  import {BudgetDB} from './src/sync/budget.js';
  import {JobCoordinator} from './src/sync/coordinator.js';
  import {PublicHistoryService} from './src/application/public-history.js';
  export default {async fetch(request,env){const b=await request.json(),raw=new BudgetDB(env.DB,b.limit??48),db=wrapDatabase(raw);if(b.explain){const originalPrepare=db.prepare.bind(db),originalBatch=db.batch.bind(db),metadata=new WeakMap();db.prepare=sql=>{const track=(stmt,params=[])=>{const bind=stmt.bind.bind(stmt);stmt.bind=(...values)=>track(bind(...values),values);metadata.set(stmt,{sql,params});return stmt;};return track(originalPrepare(sql));};db.batch=async statements=>{for(let i=0;i<statements.length;i++){const info=metadata.get(statements[i]);try{await env.DB.prepare('EXPLAIN '+info.sql).bind(...info.params).all();}catch(error){throw new Error('Statement '+i+' '+info.sql.slice(0,140)+': '+error.message);}}return originalBatch(statements);};}try{let result;const c=new JobCoordinator(db,{publicHistory:b.enabled!==false,clock:()=>b.now,pageDelayMs:0});
   if(b.op==='install')result=await new FreshInstallation(raw,{schema:SCHEMA,seed:SEED,bootstrapPassword:'synthetic-public-history-fixture'}).advance('synthetic-public-history-fixture');
   else if(b.op==='sql')result=await db.batch(b.statements.map(s=>db.prepare(s.sql).bind(...(s.params||[]))));
   else if(b.op==='request'||b.op==='status'){const service=new PublicHistoryService(db,{principal:b.principal??{role:'owner',session_id:'owner-session'},requesterKey:b.requesterKey??'owner',sync:{jobs:c,wake:async()=>{}},now:()=>b.now});result=await service[b.op]({team_id:'team',team_season_id:'season'},'current',b.options);}
   else if(b.op==='enqueue')result=await c.enqueue(b.spec,b.subscribers);
   else if(b.op==='enqueueMany')result=await c.enqueueMany(b.specs,b.subscribers,{...b.options,precondition:b.precondition});
   else if(b.op==='claim')result=await c.claim();
   else if(b.op==='commit'){for(let i=0;i<(b.spend||0);i++)await db.prepare('SELECT 1').first();result=await c.commit(b.lease,b.result);}
   else if(b.op==='fail')result=await c.fail(b.lease,Object.assign(new Error('Synthetic failure'),{code:'fixture',failureKind:b.kind||'permanent',observations:b.observations}));
   else if(b.op==='recover')result=await c.recoverPublicHistory({limit:1});
   else if(b.op==='unsubscribe')result=await c.unsubscribe(b.kind,b.key);
   else if(b.op==='next')result=await c.nextWake();
   return Response.json({result,used:raw.used});
  }catch(error){return Response.json({error:{message:error.message,code:error.code,stack:error.stack},used:raw.used},{status:409});}}};`};
 const mf=new Miniflare({cf:false,telemetry:{enabled:false},workers:[{config:{name:'public-history-proof',compatibilityDate:'2026-09-09',manifest:{mainModule:'public-history-proof.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'public-history-proof'}}}}]});
 const used=[];try{await mf.ready;
 async function call(body){const response=await mf.dispatchFetch('https://history.test/',{method:'POST',body:JSON.stringify({now:Date.parse(AT),...body})}),out=await response.json();used.push(out.used);if(!response.ok)throw Object.assign(new Error(out.error.message),{code:out.error.code,used:out.used,detail:out.error.stack});return out;}
 const sql=async(sql,params=[])=>(await call({op:'sql',statements:[{sql,params}]})).result[0].results;
 let setup,steps=0;do{setup=(await call({op:'install'})).result;assert.ok(++steps<40,'bounded schema setup');}while(setup.setup.state!=='ready');
 const f=fixture(),current=f.event('current',{project:true});f.insert('source_event_teams',{source_team_id:HOME,source_event_id:current.source,side:'home'});
 const now=Date.parse(AT);f.insert('security_owner',{id:1,password_salt:'fixture',password_hash:'fixture',password_iterations:600000,password_revision:1,last_password_change:AT,created_at:now,updated_at:now});f.insert('security_sessions',{token_hash:'owner-session',password_revision:1,created_at:now,expires_at:now+86400000});
 const statements=[];for(const table of ['app_teams','team_read_state','app_clubs','team_profiles','team_seasons','team_projection_runs','team_projection_state','source_teams','team_source_attachments','events','source_events','event_source_links','source_event_state','team_event_rows','source_event_teams','security_owner','security_sessions'])for(const row of f.sqlite.prepare('SELECT * FROM '+table).all())statements.push({sql:`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`,params:Object.values(row)});f.close();
 for(let i=0;i<statements.length;i+=24)await call({op:'sql',statements:statements.slice(i,i+24)});
 return {call,sql,used,async dispose(){try{await mf.dispose();}finally{setGlobalDispatcher(prior);await agent.close();}}};
 }catch(error){try{await mf.dispose();}finally{setGlobalDispatcher(prior);await agent.close();}throw error;}
}

test('native generic and typed public admission, claim and atomic child receipts stay inside D1 depth and 48 statements',async()=>{
 const h=await harness();try{
  const subscribers=[{kind:'team',key:'attached',teamId:'team',generation:1}],spec={provider:'analysis',component:'catalog',stage:'analysis',scope:'team',resourceKey:'season',args:{teamId:'team',seasonId:'season'},recurring:false};
  await h.sql(publicHistoryQuery(`SELECT d.id FROM public_history_demands d WHERE ${publicHistoryProof('d',String(Date.parse(AT)))}`,String(Date.parse(AT))));console.log('standalone proof compiled');
  await h.sql(publicHistoryQuery('SELECT * FROM public_history_live',String(Date.parse(AT)),{live:true}));console.log('context proof compiled');
  await h.call({op:'enqueue',spec,subscribers});console.log('generic enqueue compiled');let lease=(await h.call({op:'claim'})).result;assert.equal(lease.provider,'analysis');assert.equal((await h.call({op:'commit',lease,result:{statements:[],complete:true}})).result.committed,true);
  const request=(await h.call({op:'request'})).result;assert.equal(request.progress.total,4);
  lease=(await h.call({op:'claim'})).result;assert.equal(lease.provider,'gotsport');
  const result={statements:[],complete:true,children:[{provider:'gotsport',component:'event',scope:'fixture-event',resourceKey:'fixture-event',args:{event_id:'fixture-event'},subscriberMode:'inherit',recurring:false},{provider:'domain',component:'projection',stage:'projection',scope:'team',resourceKey:'season',args:{},recurring:false,subscriberMode:'projection',subscribers:[{kind:'team',key:'projection-fixture',teamId:'team',generation:1}]}]};
  await h.sql('UPDATE team_projection_state SET pending=1');
  await assert.rejects(h.call({op:'commit',lease,result,spend:40}),error=>error.code==='invocation_budget'&&error.used===40);
  assert.equal((await h.sql("SELECT COUNT(*) n FROM sync_jobs WHERE provider='domain'"))[0].n,0,'budget rejection cannot partially admit local projections');
  assert.equal((await h.sql('SELECT COUNT(*) n FROM public_history_jobs'))[0].n,4);
  assert.equal((await h.call({op:'commit',lease,result})).result.committed,true);
  assert.equal((await h.sql("SELECT COUNT(*) n FROM sync_jobs WHERE provider='domain' AND component='projection'"))[0].n,1);
  assert.equal((await h.sql("SELECT COUNT(*) n FROM public_history_jobs WHERE provider='domain'"))[0].n,0,'local projections do not consume public receipt authority');
  assert.equal((await h.sql('SELECT COUNT(*) n FROM public_history_jobs'))[0].n,5);
  for(let i=0;i<5;i++){lease=(await h.call({op:'claim'})).result;if(!lease)break;assert.equal((await h.call({op:'commit',lease,result:{statements:[],complete:true}})).result.committed,true);}
  assert.equal((await h.call({op:'status'})).result.state,'complete');assert.equal((await h.call({op:'next'})).result,null);assert.ok(Math.max(...h.used)<=48);console.log(JSON.stringify({native_public_history_depth:true,maxStatements:Math.max(...h.used)}));
 }finally{await h.dispose();}
});

test('native late join, rollback and exact 48-statement admission retain one scan and one atomic receipt graph',async()=>{
 const h=await harness();try{
  const spec={provider:'gotsport',component:'history',scope:'1',resourceKey:'1',args:{team_id:'1',club_name:'Verified native club',timezone:'UTC'},recurring:true};
  const id=(await h.call({op:'enqueue',spec,subscribers:[{kind:'team',key:'attached',teamId:'team',generation:1}]})).result;
  await h.sql('UPDATE sync_jobs SET checkpoint=? WHERE id=?',['{"page":7}',id]);
  const lease=(await h.call({op:'claim'})).result,before=(await h.sql('SELECT * FROM sync_jobs WHERE id=?',[id]))[0];await h.call({op:'request'});const after=(await h.sql('SELECT * FROM sync_jobs WHERE id=?',[id]))[0];
  for(const key of ['args','checkpoint','lease_token','lease_until','generation','scan_id','next_at'])assert.equal(after[key],before[key],key);
  const source={sql:"UPDATE source_events SET venue='Native saved field' WHERE id='gotsport/public/event-current' AND $FENCE",params:[]},children=[{provider:'gotsport',component:'event',scope:'atomic-child',resourceKey:'atomic-child',args:{event_id:'atomic-child'},subscriberMode:'inherit',recurring:false}],result={statements:[source],children,complete:true};
  await assert.rejects(h.call({op:'commit',lease,result:{...result,statements:[source,{sql:'INSERT INTO domain_team_preconditions SELECT 1,1,0 WHERE $FENCE ON CONFLICT(id) DO UPDATE SET actual_input=excluded.actual_input',params:[]}]}}));
  assert.equal((await h.sql('SELECT venue FROM source_events'))[0].venue,'Field');assert.equal((await h.sql('SELECT COUNT(*) n FROM public_history_jobs'))[0].n,4);
  await assert.rejects(h.call({op:'commit',lease,result,spend:36}),error=>error.code==='invocation_budget'&&error.used===36);assert.equal((await h.sql('SELECT pages_saved FROM sync_jobs WHERE id=?',[id]))[0].pages_saved,0);
  const committed=await h.call({op:'commit',lease,result,spend:35});assert.equal(committed.result.committed,true);assert.equal(committed.used,48);
  assert.equal((await h.sql('SELECT COUNT(*) n FROM public_history_jobs'))[0].n,5);assert.equal((await h.sql('SELECT writer_mode FROM installation_upgrade'))[0].writer_mode,null);
 }finally{await h.dispose();}
});

test('native cap, terminal failure and stale authority keep saved facts without granting extra jobs',async()=>{
 const h=await harness();try{
  await h.call({op:'request'});await h.sql('UPDATE public_history_demands SET max_jobs=5');let lease=(await h.call({op:'claim'})).result;
  await h.call({op:'commit',lease,result:{statements:[],children:Array.from({length:8},(_,i)=>({provider:'gotsport',component:'event',scope:'bounded-'+i,resourceKey:'bounded-'+i,args:{event_id:'bounded-'+i},subscriberMode:'inherit',recurring:false})),complete:true}});
  assert.equal((await h.sql('SELECT COUNT(*) n FROM sync_jobs'))[0].n,5);assert.equal((await h.sql('SELECT COUNT(*) n FROM public_history_jobs'))[0].n,5);assert.equal((await h.sql('SELECT capped FROM public_history_demands'))[0].capped,1);
  lease=(await h.call({op:'claim'})).result;const temporary=(await h.call({op:'fail',lease,kind:'temporary',observations:[{endpoint:'https://example.test/native-fixture',status:200,at:Date.parse(AT),bytes:10,hash:'a'.repeat(64),rows_count:1}]})).result;assert.equal(temporary.state,'retrying');assert.equal((await h.sql('SELECT state FROM public_history_jobs WHERE job_id=?',[lease.id]))[0].state,'pending');await h.sql('UPDATE sync_jobs SET next_at=?,priority=100 WHERE id=?',[Date.parse(AT),lease.id]);lease=(await h.call({op:'claim'})).result;const failed=(await h.call({op:'fail',lease,kind:'permanent'})).result;assert.equal(failed.state,'failed');assert.equal((await h.sql('SELECT state FROM public_history_jobs WHERE job_id=?',[lease.id]))[0].state,'failed');
  lease=(await h.call({op:'claim'})).result;await h.sql('UPDATE team_source_attachments SET active=0');assert.equal((await h.call({op:'commit',lease,result:{statements:[],complete:true}})).result.committed,false);assert.equal((await h.call({op:'claim'})).result,null);await h.call({op:'recover'});assert.equal((await h.sql('SELECT state FROM public_history_demands'))[0].state,'revoked');assert.equal((await h.sql('SELECT COUNT(*) n FROM source_events'))[0].n,1);assert.equal((await h.sql('SELECT COUNT(*) n FROM sync_commit_fences'))[0].n,0);await h.call({op:'unsubscribe',kind:'team',key:'attached'});
 }finally{await h.dispose();}
});

test('native bridge receipts require fresh captured season and both division-anchor orientations revalidate the Live counterpart',async()=>{
 const h=await harness(),now=Date.parse(AT);try{
  await h.call({op:'sql',statements:[...historyBridgeStatements(now,{reverse:true}),...historyBridgeDivisionStatements(now)]});
  const id=(await h.call({op:'enqueue',spec:{provider:'live',component:'membership',scope:'1',resourceKey:'1',args:{team_id:'1',proof:{season:'33',season_name:'2026/27'}},recurring:false},subscribers:[{kind:'team',key:'connection:bridge-donor',teamId:'team',generation:1}]})).result;
  await h.sql("UPDATE sync_jobs SET state='ready',checkpoint='{\"saved\":7}',next_at=? WHERE id=?",[now+100000,id]);const original=(await h.sql('SELECT scan_id,args FROM sync_jobs WHERE id=?',[id]))[0];
  for(const component of ['resolve','participant']){
   const rejected=(await h.call({op:'enqueue',spec:{provider:'live',component,scope:'missing-season',resourceKey:'missing-season',args:{team_id:'1'},recurring:false},subscribers:[{kind:'team',key:'connection:bridge-donor',teamId:'team',generation:1}]})).result;
   await h.sql("UPDATE sync_jobs SET state='ready' WHERE id=?",[rejected]);
  }
  assert.equal((await h.call({op:'request'})).result.progress.total,5);assert.equal((await h.sql("SELECT count(*) n FROM sync_jobs WHERE provider='live' AND component IN('resolve','participant') AND state='ready'"))[0].n,2);await h.sql("UPDATE team_source_connections SET active=0 WHERE id='bridge-donor'");const lease=(await h.call({op:'claim'})).result;assert.equal(lease.id,id);assert.notEqual(lease.scan_id,original.scan_id);assert.deepEqual(lease.args,JSON.parse(original.args));
  // The independent typed subscriber claimed this scan. An ordinary owner
  // subscriber may still save it after bridge expiry, without crediting the
  // expired typed request or inheriting its descendants.
  await h.sql("UPDATE team_source_connections SET active=1 WHERE id='bridge-donor'");
  const savedEvidence=(await h.sql('SELECT evidence FROM source_team_links'))[0].evidence;
  await h.sql("UPDATE source_team_links SET evidence=json_set(evidence,'$.expires_at',?)",[new Date(now-1).toISOString()]);
  assert.equal((await h.call({op:'commit',lease,result:{statements:[{sql:"UPDATE source_events SET venue='Ordinary preserved field' WHERE id='gotsport/public/event-current' AND $FENCE",params:[]}],children:[{provider:'live',component:'division',scope:'ordinary-only',resourceKey:'ordinary-only',args:{proof:{season:'33',season_name:'2026/27'}},subscriberMode:'inherit',recurring:false}],complete:true}})).result.committed,true);
  assert.equal((await h.sql('SELECT state FROM public_history_jobs WHERE job_id=?',[id]))[0].state,'superseded');assert.equal((await h.sql('SELECT count(*) n FROM public_history_jobs WHERE parent_job_id=?',[id]))[0].n,0);
  assert.equal((await h.sql('SELECT venue FROM source_events'))[0].venue,'Ordinary preserved field');
  await h.call({op:'recover',now:now+21601000});assert.equal((await h.sql('SELECT state FROM public_history_demands'))[0].state,'active');
  await h.sql('UPDATE source_team_links SET evidence=?',[savedEvidence]);
  const proofSQL=at=>publicHistoryQuery(`SELECT ${publicHistoryAdmission('d')} AS ok FROM public_history_demands d`,String(at),{live:true});
  for(const reverse of [false,true]){
   await h.call({op:'sql',statements:[{sql:"UPDATE team_source_attachments SET source_team_id=? WHERE id='attached'",params:[reverse?'live/public/1':HOME]},{sql:"UPDATE public_history_demands SET anchor_kind='division',anchor_membership_id=?",params:[reverse?'gotsport-bridge-membership':'live-bridge-membership']}]});
   assert.equal((await h.sql(proofSQL(now)))[0].ok,1);
   await h.sql("UPDATE source_competitions SET evidence=? WHERE provider='live'",['{"season_id":"wrong","season_name":"2026/27"}']);assert.equal((await h.sql(proofSQL(now)))[0].ok,0);
   await h.sql("UPDATE source_competitions SET evidence=? WHERE provider='live'",['{"season_id":"33","season_name":"2026/27"}']);assert.equal((await h.sql(proofSQL(now)))[0].ok,1);assert.equal((await h.sql(proofSQL(now+21601000)))[0].ok,0);
  }
 }finally{await h.dispose();}
});

test('native immutable participant lineage cannot borrow the other bridge after donor removal or ancestor completion',async()=>{
 const h=await harness(),now=Date.parse(AT);try{
  await h.call({op:'sql',statements:historyBridgeStatements(now)});
  const other=historyBridgeProof(now);Object.assign(other,{team_id:'2',live_team_id:'2',item_id:'2',external_key:'2',season:'old',season_name:'2025/26'});for(const o of other.observations)o.params.SeasonID='old';
  await h.call({op:'sql',statements:[{sql:"INSERT INTO source_team_links(a,b,kind,evidence) VALUES('gotsport/public/2','live/public/2','provider_external_key',?)",params:[JSON.stringify(other)]},{sql:"UPDATE source_teams SET evidence=? WHERE id='live/public/2'",params:[JSON.stringify({proof:other})]}]});
  const subscribers=[{kind:'team',key:'connection:bridge-donor',teamId:'team',generation:1}],spec=(component,scope,args,priority)=>({provider:'live',component,scope,resourceKey:scope,args,priority,recurring:false});
  const membership=(await h.call({op:'enqueue',spec:spec('membership','valid',{team_id:'1',proof:{season:'33',season_name:'2026/27'}},100),subscribers})).result;
  const organizer=(await h.call({op:'enqueue',spec:spec('organizer','generic',{organizer:'700',proof:{season:'33',season_name:'2026/27'}},90),subscribers})).result;
  const wrong=(await h.call({op:'enqueue',spec:spec('membership','wrong',{team_id:'1',proof:{season:'old',season_name:'2025/26'}},80),subscribers})).result;
  await h.sql("UPDATE sync_jobs SET state='ready' WHERE id=?",[wrong]);assert.equal((await h.call({op:'request'})).result.progress.total,6);assert.equal((await h.sql('SELECT count(*) n FROM public_history_jobs WHERE job_id=?',[wrong]))[0].n,0);
  const lease=(await h.call({op:'claim'})).result;assert.equal(lease.id,membership);
  await h.call({op:'commit',lease,result:{statements:[],children:[{...spec('organizer','grandchild',{organizer:'701',proof:{season:'33',season_name:'2026/27'}},95),subscriberMode:'inherit'}],complete:true}});
  const grandchild=(await h.sql('SELECT job_id,root_source_team_id FROM public_history_jobs WHERE parent_job_id=?',[membership]))[0];assert.equal(grandchild.root_source_team_id,HOME);assert.equal((await h.sql('SELECT state FROM public_history_jobs WHERE job_id=?',[membership]))[0].state,'complete');
  Object.assign(other,{season:'33',season_name:'2026/27'});for(const o of other.observations)o.params.SeasonID='33';
  await h.call({op:'sql',statements:[{sql:"UPDATE source_team_links SET evidence=? WHERE a='gotsport/public/2'",params:[JSON.stringify(other)]},{sql:"UPDATE source_teams SET evidence=? WHERE id='live/public/2'",params:[JSON.stringify({proof:other})]},{sql:"UPDATE team_source_connections SET active=0 WHERE id='bridge-donor'",params:[]},{sql:"UPDATE source_team_links SET evidence=json_set(evidence,'$.expires_at',?) WHERE a=? OR b=?",params:[new Date(now-1).toISOString(),HOME,HOME]}]});
  await h.call({op:'recover'});for(const id of [organizer,grandchild.job_id]){const row=(await h.sql('SELECT state,root_source_team_id FROM public_history_jobs WHERE job_id=?',[id]))[0];assert.equal(row.state,'superseded');assert.equal(row.root_source_team_id,HOME);}
  const next=(await h.call({op:'claim'})).result;assert.equal(next.provider,'gotsport');
 }finally{await h.dispose();}
});
