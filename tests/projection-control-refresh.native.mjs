import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {freshHarness} from './fresh-harness.js';
import {projectionControlScaleFixture,JOB_FIELDS,bytes} from './fixtures/projection-control-scale-fixture.mjs';

// Host-driven real collector/coordinator invocations against native D1. This is
// deliberately not a claim about production Durable Object alarm delivery.
const root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||'.');
const mode=process.env.MYTS_REFRESH_MODE||'candidate';
const module=file=>import(pathToFileURL(path.join(root,file)).href);
const [{wrapDatabase},{JobCoordinator},{BudgetDB},{collectApplicationJob,ApplicationSyncService},{SCHEMA},{loadTeamGameCandidates},{teamGamePublicationCurrent}]=await Promise.all([
  'src/application/installation-epoch.js','src/sync/coordinator.js','src/sync/budget.js',
  'src/application/sync-service.js','src/application/installation-schema.js','src/domain/team-game-candidates.js','src/domain/team-game-projection.js',
].map(module));
const sum=(a,k)=>a.reduce((n,v)=>n+(v[k]??0),0);
const max=(a,k)=>Math.max(0,...a.map(v=>v[k]??0));
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
async function runtimeMap(packageRoot=root){
  const files=['worker.js','package.json','release-manifest.json','wrangler.jsonc'];
  for(const dir of ['src','web'])for(const file of await readdir(path.join(packageRoot,dir),{recursive:true,withFileTypes:true}))if(file.isFile())files.push(path.relative(packageRoot,path.join(file.parentPath,file.name)));
  files.sort();return Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(path.join(packageRoot,file))).digest('hex')])));
}
function tracedDatabase(raw,queries,transactions,invocation){
  const measure=(sql,params,result,error)=>queries.push({invocation,sql,sql_bytes:bytes(sql),parameter_bytes:bytes(params),result_bytes:bytes(result?.results??[]),rows_read:result?.meta?.rows_read??0,rows_written:result?.meta?.rows_written??0,...(error?{error:String(error)}:{})});
  const decorate=(statement,sql,params=[])=>({_raw:statement,sql,params,bind(...p){return decorate(statement.bind(...p),sql,p);},async all(){try{const r=await statement.all();measure(sql,params,r);return r;}catch(e){measure(sql,params,null,e);throw e;}},async run(){return this.all();},async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;}});
  return {prepare(sql){return decorate(raw.prepare(sql),sql);},async batch(statements){const receipt={invocation,statements:statements.length,sql_bytes:sum(statements.map(s=>({n:bytes(s.sql)})),'n'),parameter_bytes:sum(statements.map(s=>({n:bytes(s.params)})),'n')};transactions.push(receipt);try{const result=await raw.batch(statements.map(s=>s._raw));result.forEach((r,i)=>measure(statements[i].sql,statements[i].params,r));return result;}catch(e){receipt.error=String(e);statements.forEach(s=>measure(s.sql,s.params,null,e));throw e;}}};
}
function syntheticEmptyHistory(){
  return {observations:[],async get(value){
    const url=new URL(value);assert.equal(url.origin,'https://system.gotsport.com');assert.ok(['/api/v1/teams/201/matches','/api/v1/team_ranking_data'].includes(url.pathname));
    if(url.pathname.endsWith('/matches'))assert.equal(url.searchParams.get('page'),'1');else assert.equal(url.searchParams.get('team_id'),'201');
    const payload=url.pathname.endsWith('/matches')?{matches:[],pagination:{current_page:1,total_pages:0,total_entries:0}}:{team_ranking_data:{team_id:'201'},events:[]},at=new Date().toISOString();
    const observation={endpoint:url.origin+url.pathname,params:Object.fromEntries(url.searchParams),status:200,at,retrieved_at:at,hash:digest(payload),bytes:bytes(payload),rows_count:0};
    this.observations.push(observation);return {value:payload,observation};
  }};
}

test('native stable accepted controls survive real no-op source refresh while exact held races reject',{timeout:600000},async()=>{
  const source=await projectionControlScaleFixture(),h=await freshHarness(),before=await runtimeMap();
  const queries=[],transactions=[],invocations=[],refreshes=[],negative={},evidence={},seedRetries=[];
  const options={publicHistory:true,reportFairness:true,dependencyFairness:true,statementLimit:50};
  const rows=async(sql,...p)=>(await h.db.prepare(sql).bind(...p).all()).results;
  const one=async(sql,...p)=>(await rows(sql,...p))[0]??null;
  const jobs=()=>new JobCoordinator(h.db,options);
  const insert=(table,row)=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row)).run();
  const candidate=()=>loadTeamGameCandidates(h.db,{teamId:'team',seasonId:'season',canonicalEventIds:['canonical-a-public-000']});
  let sequence=0,projectionId,stage='installation',scenario='setup',oldPointer,initialSources,initialOwners,complete;
  const started=Date.now();
  async function pointer(){return one("SELECT * FROM team_projection_state WHERE team_season_id='season'");}
  async function shape(runId){runId??=(await pointer()).published_run_id;return {run_id:runId,events:(await one('SELECT count(*) n FROM team_event_rows WHERE run_id=?',runId)).n,members:(await one('SELECT count(*) n FROM team_game_source_rows WHERE run_id=?',runId)).n,pairs:(await one("SELECT count(*) n FROM team_game_publications WHERE run_id=? AND disposition='accepted'",runId)).n};}
  async function content(){return {sources:digest(await rows('SELECT * FROM source_events ORDER BY id')),memberships:digest(await rows('SELECT * FROM source_event_teams ORDER BY source_event_id,source_team_id')),links:digest(await rows('SELECT * FROM event_source_links ORDER BY source_event_id')),roots:digest(await rows('SELECT * FROM team_source_connections ORDER BY id')),input:(await pointer()).input_revision};}
  function startInvocation(kind){const traceId=++sequence,traced=tracedDatabase(h.rawDb,queries,transactions,traceId),budget=new BudgetDB(traced,50),db=wrapDatabase(budget);return {traceId,kind,budget,db,coordinator:new JobCoordinator(db,options)};}
  function finishInvocation(call,extra={}){
    const sql=queries.filter(q=>q.invocation===call.traceId),receipt={scenario,kind:call.kind,statements:call.budget.used,actual_sql:sql.length,rows_read:sum(sql,'rows_read'),rows_written:sum(sql,'rows_written'),sql_bytes:sum(sql,'sql_bytes'),parameter_bytes:sum(sql,'parameter_bytes'),...extra};
    invocations.push(receipt);assert.ok(receipt.actual_sql<=50&&receipt.statements<=50,JSON.stringify(receipt));assert.ok((receipt.checkpoint_bytes??0)<=8192);assert.ok((receipt.collector_transaction_bytes??0)<=2000000);
    console.log(JSON.stringify({control_refresh_turn:receipt}));return receipt;
  }
  async function waitDue(id){const job=await one('SELECT * FROM sync_jobs WHERE id=?',id);while(Date.now()<=job.next_at)await new Promise(r=>setTimeout(r,Math.max(1,job.next_at-Date.now()+2)));return job;}
  async function turn(collector=collectApplicationJob){
    await waitDue(projectionId);const call=startInvocation('projection');let observed;
    const result=await call.coordinator.runOne(async c=>{
      assert.equal(c.lease.id,projectionId,'fixture admits the intended production job');
      const page=await collector({...c,env:{}});observed={phase_before:c.checkpoint.phase??null,checkpoint_before:c.checkpoint,checkpoint_after:page.checkpoint,checkpoint_bytes:bytes(page.checkpoint),collector_transaction_bytes:bytes(page.statements)+bytes(page.checkpoint),rows_saved:(page.statements??[]).filter(s=>s.sql.startsWith('INSERT INTO team_event_rows')).reduce((n,s)=>n+JSON.parse(s.params[0]).length,0),deferred:page.projectionDeferred??null};return page;
    },{env:{}});
    assert.ok(!['error','failed','blocked','retrying','lease_lost'].includes(result.state),JSON.stringify(result));
    return finishInvocation(call,{...result,...observed});
  }
  async function beginRefresh(jobId='gotsport-history'){
    const before=await one('SELECT * FROM sync_jobs WHERE id=?',jobId),snapshot=await content();
    // Only make this recurring fixture job due; claim, collector, and commit are
    // production implementations. No source row/checkpoint is fabricated here.
    await h.db.prepare("UPDATE sync_jobs SET next_at=0,ready_since=?,priority=100 WHERE id=?").bind(Date.now()-86400000,jobId).run();
    const call=startInvocation('source_refresh'),lease=await call.coordinator.claim();assert.equal(lease.id,jobId);
    const claimed=await one('SELECT * FROM sync_jobs WHERE id=?',jobId);
    return {before,snapshot,call,lease,claimed};
  }
  async function finishRefresh(held,{unchanged=true}={}){
    const {before,snapshot,call,lease,claimed}=held;
    const page=await collectApplicationJob({db:call.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint},{transportFactory:syntheticEmptyHistory});
    assert.equal(page.complete,true);assert.equal(page.observations.length,1);assert.equal(page.rowsSaved,0);
    const outcome=await call.coordinator.commit(lease,page);assert.equal(outcome.committed,true);
    const after=await one('SELECT * FROM sync_jobs WHERE id=?',lease.id),afterContent=await content();
    if(unchanged)assert.deepEqual(afterContent,snapshot,'completed no-op refresh preserves source/root/input hashes');
    assert.equal(after.generation,before.generation);assert.equal(after.args,before.args);if(before.state==='ready')assert.notEqual(after.scan_id,before.scan_id);assert.notEqual(after.last_saved_at,before.last_saved_at);assert.equal(claimed.state,'running');
    const receipt={job_id:lease.id,before:pick(before),claimed:pick(claimed),after:pick(after),content_before:snapshot,content_after:afterContent,production_collector:true,production_claim_commit:true,unchanged,observation_hash:page.observations[0].hash};
    refreshes.push(receipt);finishInvocation(call,{...outcome,checkpoint_bytes:bytes(page.checkpoint),collector_transaction_bytes:bytes(page.statements)+bytes(page.checkpoint)});return receipt;
  }
  function pick(row){return Object.fromEntries(['state','coverage','args','checkpoint','scan_id','generation','last_complete_at','last_saved_at'].map(k=>[k,row[k]]));}
  async function refresh(){return finishRefresh(await beginRefresh());}
  async function dirty(input){await h.db.prepare("UPDATE team_projection_state SET input_revision=?,pending=1 WHERE team_season_id='season'").bind(input).run();await new ApplicationSyncService(h.db,{}, {coordinatorOptions:options}).enqueueProjection('team','season',{wake:false});}
  async function publish({churn=false,keepSourceActive=false,limit=100}={}){
    const old=(await pointer()).published_run_id;let staged=JSON.parse((await one('SELECT checkpoint FROM sync_jobs WHERE id=?',projectionId)).checkpoint).runId??null;
    let heldCatalog=keepSourceActive&&staged?await beginRefresh('gotsport-catalog'):null;const laterMixed=[];
    for(let i=0;i<limit;i++){
      const priorAccepted=staged?(await shape(staged)).pairs:0,catalogState=heldCatalog?(await one('SELECT state FROM sync_jobs WHERE id=?',heldCatalog.lease.id)).state:null;
      const saved=await turn();
      if(saved.rows_saved>0&&heldCatalog){const accepted=(await shape(saved.checkpoint_after.runId)).pairs;if(accepted>priorAccepted){assert.equal(catalogState,'running');laterMixed.push({phase:saved.phase_before,cursor_before:saved.checkpoint_before.cursor,cursor_after:saved.checkpoint_after.cursor,accepted_before:priorAccepted,accepted_after:accepted,active_source:heldCatalog.lease.id,active_state:catalogState});}}
      if(saved.rows_saved>0){staged??=saved.checkpoint_after.runId;if(keepSourceActive&&!heldCatalog)heldCatalog=await beginRefresh('gotsport-catalog');}
      const current=await pointer();
      if(current.published_run_id!==old&&current.published_run_id){const result=await shape();assert.deepEqual(result,{run_id:current.published_run_id,events:100,members:110,pairs:10});let activeSourceAtPublication=null;if(heldCatalog){activeSourceAtPublication=(await one('SELECT state FROM sync_jobs WHERE id=?',heldCatalog.lease.id)).state;assert.equal(activeSourceAtPublication,'running','publication occurs while source refresh remains continuously active');await finishRefresh(heldCatalog);}if(keepSourceActive)assert.ok(laterMixed.length>0,'a later new mixed pair must acquire accepted authority while source refresh is active');return {pointer:current,shape:result,staged,turn:invocations.length,active_source_at_publication:activeSourceAtPublication,later_mixed_acceptances:laterMixed};}
      assert.equal(current.published_run_id,old,'accepted pointer remains unchanged until atomic publication');
      if(churn&&staged)await refresh();
    }
    assert.fail('bounded projection did not publish while source refreshes continued');
  }
  async function settle(){for(let i=0;i<40;i++){const job=await one('SELECT state FROM sync_jobs WHERE id=?',projectionId);if(job.state==='ready')break;await turn();}await h.db.prepare("UPDATE sync_jobs SET next_at=? WHERE id<>? AND stage<>'source'").bind(Date.now()+86400000,projectionId).run();}
  async function heldRaces(){
    const target='gotsport-division-000',savedJob=await one('SELECT * FROM sync_jobs WHERE id=?',target),savedCoverage=await one("SELECT * FROM source_component_coverage WHERE kind='history' AND provider='gotsport'");
    const sourceEvent=await one("SELECT * FROM source_events WHERE id='a-public-000'"),membership=await one("SELECT * FROM source_event_teams WHERE source_event_id='a-public-000' AND source_team_id='gotsport/public/201'");
    const cases=[
      {name:'raw_args_whitespace',mutate:()=>h.db.prepare('UPDATE sync_jobs SET args=args||? WHERE id=?').bind(' ',target).run(),restore:()=>h.db.prepare('UPDATE sync_jobs SET args=? WHERE id=?').bind(savedJob.args,target).run()},
      {name:'raw_checkpoint_whitespace',mutate:()=>h.db.prepare('UPDATE sync_jobs SET checkpoint=checkpoint||? WHERE id=?').bind(' ',target).run(),restore:()=>h.db.prepare('UPDATE sync_jobs SET checkpoint=? WHERE id=?').bind(savedJob.checkpoint,target).run()},
      {name:'raw_coverage_scan',mutate:()=>h.db.prepare('UPDATE source_component_coverage SET scan_id=scan_id||? WHERE id=?').bind('held-race',savedCoverage.id).run(),restore:()=>h.db.prepare('UPDATE source_component_coverage SET scan_id=? WHERE id=?').bind(savedCoverage.scan_id,savedCoverage.id).run()},
      {name:'scope_identity',mutate:()=>h.db.prepare('UPDATE sync_jobs SET scope=? WHERE id=?').bind('different-scope',target).run(),restore:()=>h.db.prepare('UPDATE sync_jobs SET scope=? WHERE id=?').bind(savedJob.scope,target).run()},
      {name:'new_relevant_job',mutate:async()=>{await insert('sync_jobs',{...savedJob,id:'refresh-new-job',scope:'refresh-new-scope',resource_key:'refresh-new-scope'});await insert('sync_job_subscribers',{job_id:'refresh-new-job',kind:'team',demand_key:'connection:pub',app_team_id:'team',generation:1});},restore:async()=>{await h.db.prepare("DELETE FROM sync_job_subscribers WHERE job_id='refresh-new-job'").run();await h.db.prepare("DELETE FROM sync_jobs WHERE id='refresh-new-job'").run();}},
      {name:'subscriber_generation',mutate:()=>h.db.prepare("UPDATE sync_job_subscribers SET generation=2 WHERE job_id=? AND demand_key='connection:pub'").bind(target).run(),restore:()=>h.db.prepare("UPDATE sync_job_subscribers SET generation=1 WHERE job_id=? AND demand_key='connection:pub'").bind(target).run()},
      {name:'account_generation',mutate:()=>h.db.prepare("UPDATE provider_accounts SET generation=2 WHERE id='account'").run(),restore:()=>h.db.prepare("UPDATE provider_accounts SET generation=1 WHERE id='account'").run()},
      {name:'account_revocation',mutate:()=>h.db.prepare("UPDATE provider_accounts SET active=0,generation=2 WHERE id='account'").run(),restore:()=>h.db.prepare("UPDATE provider_accounts SET active=1,generation=1 WHERE id='account'").run()},
      {name:'root_revocation',mutate:()=>h.db.prepare("UPDATE team_source_connections SET active=0 WHERE id='ts'").run(),restore:()=>h.db.prepare("UPDATE team_source_connections SET active=1 WHERE id='ts'").run()},
      {name:'source_content',mutate:()=>h.db.prepare("UPDATE source_events SET venue='Genuine correction',content_hash='genuine-correction' WHERE id='a-public-000'").run(),restore:()=>h.db.prepare('UPDATE source_events SET venue=?,content_hash=? WHERE id=?').bind(sourceEvent.venue,sourceEvent.content_hash,sourceEvent.id).run()},
      {name:'source_membership',mutate:()=>h.db.prepare("DELETE FROM source_event_teams WHERE source_event_id='a-public-000' AND source_team_id='gotsport/public/201'").run(),restore:()=>insert('source_event_teams',membership)},
      {name:'owner_correction',mutate:()=>insert('domain_overrides',{app_team_id:'team',kind:'event',entity_id:'canonical-a-public-000',fields:'{"venue":"Owner correction"}',revision:1}),restore:()=>h.db.prepare("DELETE FROM domain_overrides WHERE entity_id='canonical-a-public-000'").run()},
    ];
    for(const c of cases){
      const original=await waitDue(projectionId),call=startInvocation('held_'+c.name),lease=await call.coordinator.claim();assert.ok(lease,JSON.stringify({case:c.name,now:Date.now(),job:await one('SELECT * FROM sync_jobs WHERE id=?',projectionId),roots:await rows('SELECT * FROM team_source_connections')}));assert.equal(lease.id,projectionId);
      const page=await collectApplicationJob({db:call.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});assert.ok(page.statements.some(s=>s.sql.startsWith('INSERT INTO team_event_rows')),'held race uses a data-bearing page');
      const tables=['team_event_rows','team_game_source_rows','team_game_publications','team_game_associations','team_game_decision_revisions'];
      const staged=Object.fromEntries(await Promise.all(tables.map(async t=>[t,await rows('SELECT * FROM '+t+' ORDER BY rowid')]))),published=await pointer();
      const controls=await rows('SELECT * FROM team_source_connections ORDER BY id'),installation=await one('SELECT source_revision,mutation_revision FROM domain_installation WHERE id=1');
      await c.mutate();let retainedRejected=null;
      if(!['raw_checkpoint_whitespace','raw_coverage_scan'].includes(c.name)){retainedRejected=!(await teamGamePublicationCurrent(h.db,'team',lease.checkpoint.runId));assert.equal(retainedRejected,true,c.name+' invalidates retained semantic authority too');}
      let outcome;
      try{outcome=await call.coordinator.commit(lease,page);assert.equal(outcome.committed,false,'stale held page cannot commit');}catch(e){assert.match(String(e),/CHECK constraint|precondition|lease/i);outcome={rejected:true,error:String(e)};}
      for(const t of tables)assert.deepEqual(await rows('SELECT * FROM '+t+' ORDER BY rowid'),staged[t],c.name+' rejected atomically');
      assert.equal((await pointer()).published_run_id,published.published_run_id);await c.restore();
      // Restore only synthetic fixture counters after each intentional mutation;
      // this is not a production retry or a weakening of the held transaction.
      await h.db.prepare('UPDATE team_projection_state SET input_revision=?,pending=? WHERE team_season_id=?').bind(published.input_revision,published.pending,'season').run();
      for(const r of controls)await h.db.prepare('UPDATE team_source_connections SET input_revision=?,reconciled_revision=? WHERE id=?').bind(r.input_revision,r.reconciled_revision,r.id).run();
      await h.db.prepare('UPDATE domain_installation SET source_revision=?,mutation_revision=? WHERE id=1').bind(installation.source_revision,installation.mutation_revision).run();
      await h.db.prepare("UPDATE sync_jobs SET state='queued',lease_token=NULL,lease_until=0,checkpoint=?,next_at=?,ready_since=? WHERE id=?").bind(original.checkpoint,Date.now()+500,Date.now()+500,projectionId).run();
      negative[c.name]=finishInvocation(call,{outcome,atomic_rejection:true,retained_authority_rejected:retainedRejected,checkpoint_bytes:bytes(page.checkpoint),collector_transaction_bytes:bytes(page.statements)+bytes(page.checkpoint)});
    }
  }
  async function save(status,error=null){
    const after=await runtimeMap();assert.deepEqual(after,before,'runtime source changed during proof');
    const fenceBytes=(await one('SELECT coalesce(max(length(cast(fence AS BLOB))),0) n FROM team_game_publications'))?.n??0;
    assert.ok(fenceBytes<=16000,'stored fence stays inside 16 KB');
    const receipt={status,error,mode,stage,elapsed_ms:Date.now()-started,synthetic:true,installation_statements:SCHEMA.length,clock:{virtual:false,host_driven_runOne:true,production_alarm_delivery:false,page_delay_ms:500},fixture:{source_jobs:100,job_bytes:71789,args_bytes:22763,checkpoint_bytes:3196,source_rows:110,logical_events:100,genuine_pairs:10,canonical_ordering:mode==='candidate'?'nine mixed pairs interleaved after private10/20/.../90; source IDs and data unchanged':'original mixed public anchors first'},baseline_source_root:process.env.MYTS_REFRESH_BASELINE_ROOT??null,seed_transport_retries:seedRetries,evidence,negative,refreshes,complete,final_pointer:await pointer(),final_shape:await shape(),limits:{sql_per_invocation:50,transaction_payload_bytes:2000000,checkpoint_bytes:8192,fence_bytes:16000},maximums:{actual_sql:max(invocations,'actual_sql'),counted_sql:max(invocations,'statements'),checkpoint_bytes:max(invocations,'checkpoint_bytes'),collector_transaction_bytes:max(invocations,'collector_transaction_bytes'),transaction_parameter_bytes:max(transactions,'parameter_bytes'),stored_fence_bytes:fenceBytes},actual_d1:{rows_read:sum(queries,'rows_read'),rows_written:sum(queries,'rows_written'),statements:queries.length},source_map_sha256:digest(before),source_map_before:before,source_map_after:after,invocations,transactions,queries};
    const out=process.env.MYTS_REFRESH_OUTPUT||'tmp/projection-control-refresh';await mkdir(out,{recursive:true});await writeFile(path.join(out,mode+'-native-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify({control_refresh_native:{...receipt,source_map_before:undefined,source_map_after:undefined,invocations:undefined,queries:undefined,transactions:undefined}}));
  }
  try{
    await h.initialize();assert.equal(SCHEMA.length,788);stage='seed';
    // Candidate-only synthetic ordering spreads real mixed pairs across later
    // pages. Baseline keeps the original fixture order; counts and job bytes
    // are identical. Only canonical IDs for pairs1..9 are renamed.
    if(mode==='candidate')for(let i=1;i<10;i++){const n=String(i).padStart(3,'0'),at=String(i*10).padStart(3,'0');for(const [oldId,newId]of [['canonical-z-private-'+n,'canonical-z-private-'+at+'-mixed'],['canonical-a-public-'+n,'canonical-z-private-'+at+'-mixed-public']]){const event=source.sqlite.prepare('SELECT * FROM events WHERE id=?').get(oldId);source.insert('events',{...event,id:newId});source.sqlite.prepare('UPDATE event_source_links SET event_id=? WHERE event_id=?').run(newId,oldId);source.sqlite.prepare('UPDATE team_event_season_resolutions SET event_id=? WHERE event_id=?').run(newId,oldId);source.sqlite.prepare('DELETE FROM events WHERE id=?').run(oldId);}}
    // Match production coverage identity so the actual empty refresh is a no-op.
    for(const kind of ['history','catalog'])source.sqlite.prepare('UPDATE source_component_coverage SET id=? WHERE id=?').run('gotsport|public|'+kind+'|201','coverage-gotsport-'+kind);
    for(const table of source.seedTables){const records=source.sqlite.prepare('SELECT * FROM '+table).all().map(r=>({...r}));for(let offset=0;offset<records.length;offset+=24){const part=records.slice(offset,offset+24),keys=Object.keys(part[0]),statement=h.db.prepare(`INSERT INTO ${table}(${keys}) SELECT ${keys.map(k=>"json_extract(value,'$."+k+"')")} FROM json_each(?) WHERE 1 ON CONFLICT DO UPDATE SET ${keys.map(k=>k+'=excluded.'+k)}`).bind(JSON.stringify(part));try{await statement.run();}catch(e){if(e.cause?.code!=='UND_ERR_SOCKET'&&!String(e).includes('fetch failed'))throw e;seedRetries.push({table,offset,error:String(e)});await statement.run();}}}
    assert.equal(bytes(await rows(`SELECT ${JOB_FIELDS} FROM sync_jobs WHERE stage='source' ORDER BY id`)),71789);
    await h.db.prepare("UPDATE sync_jobs SET next_at=? WHERE stage='source'").bind(Date.now()+86400000).run();
    for(const r of await rows('SELECT * FROM team_source_connections')){const id=await jobs().enqueue({provider:'domain',component:'connection',stage:'projection',scope:'team',resourceKey:r.id,args:{connectionId:r.id,teamId:'team',generation:r.generation,inputRevision:r.input_revision},priority:90,recurring:false},[{kind:'team',key:'connection:'+r.id,teamId:'team',generation:r.generation}]);await h.db.prepare("UPDATE sync_jobs SET state='ready',coverage='complete',checkpoint='{\"finished\":true}',last_complete_at=? WHERE id=?").bind(Date.now(),id).run();}
    await h.db.prepare('UPDATE team_source_connections SET reconciled_revision=input_revision').run();
    await h.db.prepare("INSERT INTO domain_overrides(app_team_id,kind,entity_id,fields,revision) VALUES('team','event','canonical-z-private-050','{\"venue\":\"Owner saved court\"}',1)").run();
    await h.db.prepare("UPDATE team_projection_state SET input_revision=1255,pending=1 WHERE team_season_id='season'").run();
    initialSources=await rows('SELECT * FROM event_source_links ORDER BY source_event_id');initialOwners=await rows('SELECT * FROM domain_overrides ORDER BY app_team_id,kind,entity_id');
    const initialCandidate=await candidate();assert.equal(initialCandidate.complete,true,JSON.stringify(initialCandidate.reasons));assert.equal(initialCandidate.fence.jobs.length,100);
    projectionId=await jobs().enqueue({provider:'domain',component:'projection',stage:'projection',scope:'team',resourceKey:'season',args:{teamId:'team',seasonId:'season'},priority:100,recurring:false},[{kind:'team',key:'projection:team:season',teamId:'team'}]);
    stage='accepted pointer';scenario='accepted_pointer';evidence.initial=await publish();oldPointer=evidence.initial.pointer.published_run_id;await settle();
    stage='source refresh lifetime';scenario='churn';await dirty(1256);
    let firstPage;for(let i=0;i<16;i++){const r=await turn();if(r.rows_saved>0){firstPage=r;break;}}
    assert.ok(firstPage);assert.ok(firstPage.rows_saved>1);evidence.first_staged_page=firstPage;
    const hidden=firstPage.checkpoint_after.runId;
    const firstReceipts=(await rows('SELECT fence FROM team_game_publications WHERE run_id=?',hidden)).map(r=>JSON.parse(r.fence));
    if(mode==='candidate'){assert.ok(firstReceipts.length>0);assert.ok(firstReceipts.every(r=>r.version===3&&r.accepted_evidence?.complete===true&&r.accepted_evidence?.full_scope===true&&r.control_witness?.version===2),'newly committed same-hidden-run evidence must honestly prove full scope before source activity');evidence.first_genuine_full_scope={run_id:hidden,receipts:firstReceipts.length,marker:firstReceipts[0].accepted_evidence,all_jobs_terminal:(await rows("SELECT id FROM sync_jobs WHERE stage='source' AND state<>'ready'")).length===0};assert.equal(evidence.first_genuine_full_scope.all_jobs_terminal,true);}
    const refreshReceipt=await refresh();assert.equal(refreshReceipt.content_before.input,1256);
    const next=mode==='baseline'?await turn():null;
    if(mode==='baseline'){
      assert.equal((await one('SELECT state FROM team_projection_runs WHERE id=?',hidden)).state,'obsolete');assert.deepEqual(next.checkpoint_after,{});assert.equal((await pointer()).published_run_id,oldPointer);
      evidence.causal_red={staged_rows:firstPage.rows_saved,unchanged_input:1256,unchanged_sources_and_roots:true,obsolete_run:hidden,prior_accepted_pointer:oldPointer,checkpoint_changed_on_claim:refreshReceipt.before.checkpoint!==refreshReceipt.claimed.checkpoint,scan_changed:true,last_save_changed:true};stage='complete';await save('passed');return;
    }
    assert.notEqual((await one('SELECT state FROM team_projection_runs WHERE id=?',hidden)).state,'obsolete','no-op refresh cannot obsolete the staged run');
    await heldRaces();complete=await publish({churn:true,keepSourceActive:true});assert.equal(complete.pointer.published_run_id,hidden);assert.ok(refreshes.length>=2);evidence.published_while_refreshes_active={refreshes:refreshes.length,run_id:hidden};await settle();
    assert.deepEqual(await rows('SELECT * FROM event_source_links ORDER BY source_event_id'),initialSources);assert.deepEqual(await rows('SELECT * FROM domain_overrides ORDER BY app_team_id,kind,entity_id'),initialOwners);assert.equal((await one("SELECT venue FROM team_events WHERE event_id='canonical-z-private-050'")).venue,'Owner saved court');
    stage='new build during active refresh';scenario='prior_proof_pending';await dirty(1257);const held=await beginRefresh();
    let pending;for(let i=0;i<16;i++){const r=await turn();if(r.deferred||r.rows_saved>0){pending=r;break;}}
    assert.ok(pending,'active refresh must either reuse applicable accepted proof or explicitly defer');assert.equal((await pointer()).published_run_id,hidden);assert.equal(pending.deferred,'source_evidence','a different hidden run cannot borrow old published proof');assert.equal(pending.rows_saved,0);evidence.prior_proof_pending={outcome:'deferred',checkpoint:pending.checkpoint_after,old_pointer: hidden,source_state:'running'};
    await finishRefresh(held);const acquiredAfterComplete=await turn();assert.ok(acquiredAfterComplete.rows_saved>0,'genuine completion automatically resumes the same pending cursor');evidence.prior_proof_continuation=await publish({churn:true,keepSourceActive:true});await settle();
    stage='first scan remains unproved';scenario='first_scan';
    await h.db.prepare("UPDATE sync_jobs SET generation=generation+1,state='queued',checkpoint='{}',coverage='partial',last_complete_at=?,next_at=? WHERE id='gotsport-history'").bind(Date.now(),Date.now()+86400000).run();
    await h.db.prepare("UPDATE source_component_coverage SET complete=0 WHERE id='gotsport|public|history|201'").run();
    await dirty(1258);const missing=await candidate();assert.equal(missing.complete,false,'timestamp alone cannot confer completed proof');
    const firstScanPointer=(await pointer()).published_run_id;evidence.first_scan={fake_last_complete_timestamp_present:true,candidate_complete:missing.complete,reasons:missing.reasons,preserved_pointer:firstScanPointer};let deferred;for(let i=0;i<16;i++){const r=await turn();if(r.deferred){deferred=r;break;}if(r.rows_saved){const heldProofs=(await rows('SELECT disposition,fence FROM team_game_publications WHERE run_id=?',r.checkpoint_after.runId)).map(p=>({disposition:p.disposition,version:JSON.parse(p.fence).version,accepted_evidence:JSON.parse(p.fence).accepted_evidence??null}));evidence.first_scan.fallback={native_rows:r.rows_saved,proofs:heldProofs};assert.ok(heldProofs.every(p=>p.disposition!=='accepted'&&p.accepted_evidence===null),'first-scan fallback must never fabricate accepted proof');assert.fail('the exact active first-scan dependency must defer this cursor rather than stage conservative fallback');}}
    assert.ok(deferred,'first-ever incomplete proof remains pending');assert.equal((await pointer()).published_run_id,firstScanPointer);
    evidence.first_scan.checkpoint=deferred.checkpoint_after;
    const first=await beginRefresh();await finishRefresh(first,{unchanged:false});
    evidence.first_scan_continuation=await publish();await settle();
    if(process.env.MYTS_REFRESH_BASELINE_ROOT){
      stage='old raw witness migration';scenario='old_witness';const baselineRoot=path.resolve(process.env.MYTS_REFRESH_BASELINE_ROOT),baselineMap=await runtimeMap(baselineRoot),oldBuild=(await import(pathToFileURL(path.join(baselineRoot,'src/domain/projector.js')).href)).buildProjectionPage;
      const legacyCollector=c=>oldBuild({db:c.db},'team','season',c.checkpoint);await dirty(1259);let legacy;
      for(let i=0;i<16;i++){const r=await turn(legacyCollector);if(r.rows_saved>0){legacy=r;break;}}
      assert.ok(legacy);const legacyRun=legacy.checkpoint_after.runId,previous=(await pointer()).published_run_id;assert.ok((await rows('SELECT fence FROM team_game_publications WHERE run_id=?',legacyRun)).every(r=>JSON.parse(r.fence).version===2));
      await refresh();const migrated=await turn();assert.equal((await pointer()).published_run_id,previous);assert.equal((await one('SELECT state FROM team_projection_runs WHERE id=?',legacyRun)).state,'obsolete');
      evidence.migration={legacy_run:legacyRun,legacy_checkpoint:legacy.checkpoint_after,restart:migrated.checkpoint_after,replacement:await publish({churn:true,keepSourceActive:true}),baseline_source_map_sha256:digest(baselineMap)};assert.deepEqual(await runtimeMap(baselineRoot),baselineMap);await settle();
    }
    assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);assert.deepEqual(await one('SELECT writer_mode,writer_epoch,permit_guard FROM installation_upgrade'),{writer_mode:null,writer_epoch:null,permit_guard:null});stage='complete';await save('passed');
  }catch(e){await save('failed',String(e));throw e;}finally{source.close();await h.dispose();}
});
