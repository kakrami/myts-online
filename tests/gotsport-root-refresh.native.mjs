import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {freshHarness,TEST_PASSWORD} from './fresh-harness.js';
import {progressiveFixture,addSecondRootAndHistory,AT} from './fixtures/progressive-root-service-fixture.mjs';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {InstallationUpgrade} from '../src/application/schema-upgrade.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {collectApplicationJob,ApplicationSyncService} from '../src/application/sync-service.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {ReportingService} from '../src/reporting/service.js';
import {refreshScenario,jobSpec,publicRows} from './fixtures/gotsport-refresh-fixture.mjs';
import {CursorCodec} from '../src/read-model/cursor.js';

async function runtimeMap(){const paths=['worker.js','package.json','release-manifest.json','wrangler.jsonc'];for(const directory of ['src','web'])for(const name of await readdir(new URL('../'+directory+'/',import.meta.url),{recursive:true,withFileTypes:true}))if(name.isFile())paths.push(name.parentPath.replace(new URL('../',import.meta.url).pathname,'')+'/'+name.name);paths.sort();return Object.fromEntries(await Promise.all(paths.map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])));}
const seededTables=['provider_accounts','app_teams','team_seasons','team_read_state','source_teams','account_source_teams','source_players','players','events','team_projection_runs','team_projection_state','team_source_attachments','source_events','source_event_teams','player_source_links','event_source_links','team_player_rows','team_event_rows','source_trace_components','source_game_members','source_tracking_segments','source_component_coverage','team_source_connections','team_connection_seasons','team_event_season_resolutions'];

test('native mixed repeated GotSport scans and finite truthful bridge renewals let dirty roots finish and publish partial analysis',async()=>{
 const beforeMap=await runtimeMap();console.log(JSON.stringify({native_gotsport_refresh_started:{files:Object.keys(beforeMap).length,map_sha256:createHash('sha256').update(JSON.stringify(beforeMap)).digest('hex')}}));const h=await freshHarness();const source=progressiveFixture();addSecondRootAndHistory(source);
 let turns=0;const receipts=[],seen=[],rootsCompleted={},rootPages={},sql=[];
 try{
  await h.initialize();console.log('native_gotsport_refresh: full installation ready');
  for(const table of seededTables){const records=source.rows('SELECT * FROM '+table).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value==='gotsport-team'?'gotsport/public/212707':value])));for(let offset=0;offset<records.length;offset+=24)await h.db.batch(records.slice(offset,offset+24).map(row=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row))));}
  const refresh=refreshScenario(h.db,{rootId:'gotsport-root'}),sourceReceipts=[],mutate=publicRows(101);
  await refresh.profile();const savedHistory=await refresh.history(),eventJob=savedHistory.page.children.find(child=>child.component==='event');
  const detail=await refresh.run(jobSpec(eventJob)),divisionJob=detail.page.children.find(child=>child.component==='division'),standingsJob=detail.page.children.find(child=>child.component==='standings');
  for(const job of [divisionJob,standingsJob]){let cursor={},scanId=crypto.randomUUID();do{const saved=await refresh.run(jobSpec(job,{cursor,scanId,mutate}));cursor=saved.page.checkpoint;}while(!cursor.finished);}
  const participant={provider:'live',component:'participant',scope:'700:50:60',args:{team_id:'700',club_id:'50',season:'60',season_name:'2026'}};
  await refresh.run(participant);
  const refreshSpecs=[{component:'history',scope:'212707',args:{team_id:'212707'}},jobSpec(eventJob),jobSpec(divisionJob,{mutate}),jobSpec(divisionJob,{mutate}),jobSpec(standingsJob,{mutate}),jobSpec(standingsJob,{mutate})];
  let refreshIndex=0,refreshCursor={},refreshScan='recurring-0';
  await h.db.batch([
   h.db.prepare("UPDATE team_source_connections SET input_revision=CASE id WHEN 'root' THEN 401 ELSE 346 END,reconciled_revision=CASE id WHEN 'root' THEN 136 ELSE 9 END,last_reconciled_at=CASE id WHEN 'root' THEN '2026-10-13T05:07:00Z' ELSE '2026-10-13T04:58:00Z' END"),
   h.db.prepare('UPDATE team_projection_state SET input_revision=443,published_input_revision=162,pending=1'),
  ]);
  console.log('native_gotsport_refresh: saved source fixture installed');
  const rows=async(statement,...params)=>(await h.db.prepare(statement).bind(...params).all()).results,one=async(statement,...params)=>(await rows(statement,...params))[0]??null;
  const jobs=new JobCoordinator(h.db,{publicHistory:true,clock:()=>AT,pageDelayMs:0}),subscribers=[{kind:'team',teamId:'team',key:'connection:root',generation:1}];
  for(const [id,inputRevision,passRevision]of [['root',401,401],['gotsport-root',346,337]]){
   const job=await jobs.enqueue({provider:'domain',component:'connection',stage:'projection',scope:'team',resourceKey:id,args:{connectionId:id,teamId:'team',generation:1,inputRevision},priority:20,recurring:false},[{kind:'team',teamId:'team',key:'connection:'+id,generation:1}]);
   await h.db.prepare('UPDATE sync_jobs SET checkpoint=? WHERE id=?').bind(JSON.stringify({phase:'boundaries',after:'',inputRevision:passRevision,passRevision,generation:1,timezone:'UTC'}),job).run();
  }
  const specs=resourceKey=>({provider:'trace',accountId:'account',accountGeneration:1,component:'games',stage:'source',scope:'trace:10',resourceKey,args:{},priority:97,recurring:false});
  for(let batch=0;batch<8;batch++)await jobs.enqueueMany(Array.from({length:16},(_,n)=>specs('saved-backfill-'+(batch*16+n))),subscribers);
  const backlog=await jobs.enqueue(specs('backlog'),subscribers),radar=await jobs.enqueue({...specs('trace:20:trace:10:1'),component:'radar',stage:'analysis',scope:'trace:20:trace:10:1',args:{game_id:'20',team_id:'10',half:1},priority:20},subscribers);
  await h.db.prepare("UPDATE sync_jobs SET state='blocked',last_error_code='provider_forbidden',last_error_message='HTTP 403' WHERE id=?").bind(radar).run();
  assert.equal((await new ApplicationSyncService(h.db,{}).recoverProjections({wake:false})).queued,0);
  const reports=new ReportingService(h.db,{coordinator:jobs,now:()=>AT,cursor:new CursorCodec(new Uint8Array(32).fill(7)),queryBuilders:{matches:()=>({sql:"SELECT id,'2026-09-01' AS date,'Game' AS type,'Final' AS status,'Them' AS opponent,venue AS location,'Saved' AS source,'' AS competition,'2-1' AS score,'Win' AS result,NULL AS attendance FROM source_events ORDER BY id",params:[]})}});
  const report=(await reports.create({team_id:'team',team_season_id:'season'},{type:'matches'})).data,exportFile=await reports.requestExport(report.snapshot_id,'xlsx');
  const saved=new Map(),ctx={storage:{async get(k){return saved.get(k);},async put(k,v){saved.set(k,structuredClone(v));},async getAlarm(){return saved.get('alarm')??null;},async setAlarm(at){saved.set('alarm',at);},async deleteAlarm(){saved.delete('alarm');}}};
  const traced={prepare(statement){const p=h.rawDb.prepare(statement);const decorate=(bound,params=[])=>({_raw:bound,bind(...values){return decorate(p.bind(...values),values);},async all(){sql.push({bytes:Buffer.byteLength(statement),parameter_bytes:Buffer.byteLength(JSON.stringify(params)),claim:statement.includes('eligible AS MATERIALIZED')});return bound.all();},async run(){sql.push({bytes:Buffer.byteLength(statement),parameter_bytes:Buffer.byteLength(JSON.stringify(params)),claim:statement.includes('eligible AS MATERIALIZED')});return bound.run();},async first(column){const data=await this.all(),row=data.results[0]??null;return column?row?.[column]??null:row;},statement,params});return decorate(p);},async batch(statements){for(const s of statements)sql.push({bytes:Buffer.byteLength(s.statement||''),parameter_bytes:Buffer.byteLength(JSON.stringify(s.params||[])),claim:(s.statement||'').includes('eligible AS MATERIALIZED')});return h.rawDb.batch(statements.map(s=>s._raw||s));}};
  let corrected=false,correctAfter=false,catchup=false;
  const Runtime=createSyncRuntime(async context=>{
   const {lease,checkpoint}=context;seen.push(lease.provider+':'+lease.component);
   if(lease.provider==='reports')return new ReportingService(context.db,{now:()=>AT}).collect(context);
   if(['trace','gotsport'].includes(lease.provider)){assert.notEqual(lease.component,'radar','blocked403radar must never reach collection');return {statements:[],checkpoint:{pages:(checkpoint.pages||0)+1},complete:lease.resource_key!=='backlog',coverage:'partial'};}
   const page=await collectApplicationJob(context);
   if(lease.component==='connection'){
    rootPages[lease.resource_key]=(rootPages[lease.resource_key]||0)+1;
    if(lease.resource_key==='root'&&checkpoint.phase==='events'&&page.checkpoint.after&&!corrected)correctAfter=true;
    if(lease.resource_key==='root'&&corrected&&page.checkpoint.phase==='boundaries')catchup=true;
    if(page.complete)rootsCompleted[lease.resource_key]=turns;
   }
   return page;
  },{publicHistory:true,reportFairness:true,dependencyFairness:true,clock:()=>AT,pageDelayMs:0,statementLimit:50,wrapDatabase,recoverConnections:({db,env})=>new ApplicationSyncService(db,env).recoverLocalDemand({wake:false}),inspectInstallation:async({db})=>{const state=await new InstallationUpgrade(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:TEST_PASSWORD}).inspect();return state.state==='ready'?{...state,identity:state.schema_fingerprint+':'+state.started_at}:state;}});
  let published=null;
  for(turns=1;turns<=2000;turns++){
   await jobs.enqueue(specs('arrival-'+turns),subscribers);
   await new Runtime(ctx,{DB:traced}).run();
   // Keep unchanged full-response scans active while both roots reconcile.
   // Fresh bridge authority is renewed three times; each renewal may dirty the
   // root, and the test must still finish after those finite real changes.
   if(turns%5===0){
    const index=refreshIndex++%refreshSpecs.length,spec=refreshSpecs[index];
    if(index===2||index===4){refreshCursor={};refreshScan='recurring-'+refreshIndex;}
    const page=await refresh.collect({...spec,...[2,3,4,5].includes(index)?{cursor:refreshCursor,scanId:refreshScan}:{}});
    const collected=await refresh.save(page);refreshCursor=page.checkpoint;
    assert.equal(collected.changed,false,'same source response remains semantically unchanged: '+spec.component);assert.equal(collected.rootDelta,0,'same source response cannot restart root: '+spec.component);
    sourceReceipts.push({turn:turns,component:spec.component,complete:page.complete,root_delta:collected.rootDelta,changed:collected.changed,response_hashes:page.observations.map(o=>o.hash)});
   }
   if([30,80,130].includes(turns)){
    const previous=await one('SELECT evidence FROM source_team_links'),collected=await refresh.run(participant),current=await one('SELECT evidence FROM source_team_links');
    assert.equal(collected.changed,false);assert.equal(collected.rootDelta,1,'advancing proof renewal remains a real root invalidation');assert.ok(Date.parse(JSON.parse(current.evidence).expires_at)>Date.parse(JSON.parse(previous.evidence).expires_at));
    sourceReceipts.push({turn:turns,component:'participant',root_delta:1,expiry:JSON.parse(current.evidence).expires_at});
   }
   const result=saved.get('last_run');receipts.push(result);assert.ok(!['error','failed','blocked','retrying','lease_lost'].includes(result.state),JSON.stringify(result));assert.ok(result.statements<=50);
   if(correctAfter){await h.db.prepare("UPDATE source_events SET venue='Corrected behind cursor',content_hash='corrected' WHERE id='source-event'").run();correctAfter=false;corrected=true;}
   if(turns%50===0)console.log(JSON.stringify({native_gotsport_refresh_checkpoint:{turns,state:result.state,root_pages:rootPages,roots_completed:rootsCompleted}}));
   published=await one("SELECT * FROM match_analysis WHERE event_id='event'");if(turns>130&&published&&(await reports.exportStatus(exportFile.id)).state==='ready'&&(await rows('SELECT input_revision,reconciled_revision FROM team_source_connections')).every(r=>r.input_revision===r.reconciled_revision))break;
  }
  assert.ok(published,'actual native analysis must publish');assert.equal(published.state,'incomplete');assert.equal(published.player_count,7);assert.equal((await one("SELECT minutes FROM effective_player_matches WHERE player_id='player-006'")).minutes,null);
  assert.ok((await rows('SELECT input_revision,reconciled_revision FROM team_source_connections')).every(r=>r.input_revision===r.reconciled_revision));assert.equal(Object.keys(rootsCompleted).length,2);assert.ok(corrected&&catchup);assert.equal((await one("SELECT venue FROM team_events WHERE event_id='event'")).venue,'Corrected behind cursor');
  assert.equal((await one('SELECT state FROM sync_jobs WHERE id=?',backlog)).state,'queued');const pending=(await one("SELECT COUNT(*) n FROM sync_jobs WHERE provider='trace' AND state='queued'")).n;assert.ok(pending>100);assert.equal((await one('SELECT state FROM sync_jobs WHERE id=?',radar)).state,'blocked');assert.equal((await reports.exportStatus(exportFile.id)).state,'ready');assert.ok((await (await reports.download(exportFile.id)).arrayBuffer()).byteLength>1000);
  assert.deepEqual(await rows('PRAGMA foreign_key_check'),[]);assert.deepEqual(await one('SELECT writer_mode,writer_epoch,permit_guard FROM installation_upgrade'),{writer_mode:null,writer_epoch:null,permit_guard:null});
  const hashes=Object.fromEntries(await Promise.all(['src/sync/coordinator.js','src/sync/runtime.js','src/application/sync-service.js'].map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])));
  assert.ok(sql.some(s=>s.claim),'actual claim SQL must be captured by native instrumentation');
  const afterMap=await runtimeMap();assert.deepEqual(afterMap,beforeMap,'runtime source must remain frozen during native proof');
  assert.equal(sourceReceipts.filter(r=>r.component==='participant').length,3);assert.ok(sourceReceipts.filter(r=>r.component!=='participant').length>=26);
  const result={turns,source_receipts:sourceReceipts,root_pages:rootPages,root_finish_turns:rootsCompleted,bulk_pages:seen.filter(v=>v==='trace:games').length,pending_backlog:pending,analysis_state:published.state,players:published.player_count,report_export:'ready',radar:'blocked403',behind_cursor_catchup:true,max_invocation_statements:Math.max(...receipts.map(r=>r.statements)),max_sql_bytes:Math.max(...sql.map(s=>s.bytes)),max_parameter_bytes:Math.max(...sql.map(s=>s.parameter_bytes)),claim_sql_bytes:Math.max(...sql.filter(s=>s.claim).map(s=>s.bytes)),claim_parameter_bytes:Math.max(...sql.filter(s=>s.claim).map(s=>s.parameter_bytes)),installation_inspected:true,actual_epoch_wrapped_native_sql:true,source_files:Object.keys(beforeMap).length,source_map_sha256:createHash('sha256').update(JSON.stringify(beforeMap)).digest('hex'),runtime_restarted_each_turn:true,real_recovery_invocations:receipts.filter(r=>r.state==='recovering_connections').length,hashes};
  await mkdir(new URL('../tmp/gotsport-root-refresh/',import.meta.url),{recursive:true});await writeFile(new URL('../tmp/gotsport-root-refresh/native-receipt.json',import.meta.url),JSON.stringify({result,source_map:beforeMap,receipts},null,2));console.log(JSON.stringify({native_gotsport_refresh_service:result}));
 }catch(error){console.error(JSON.stringify({native_gotsport_refresh_failure:{message:error.message,turns,jobs:(await h.db.prepare('SELECT provider,component,resource_key,state,last_error_code,last_error_message FROM sync_jobs WHERE state IN(\'failed\',\'blocked\',\'retrying\')').all()).results}}));throw error;}finally{source.close();await h.dispose();}
});
