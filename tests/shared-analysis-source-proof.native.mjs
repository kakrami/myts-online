import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {FreshInstallation} from '../src/application/fresh-install.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {BudgetDB} from '../src/sync/budget.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {ApplicationSyncService} from '../src/application/sync-service.js';
import {NativeTrackService} from '../src/analysis/tracks.js';
import {nativeAnalysisCollectionProof} from '../src/analysis/source-collection-proof.js';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';

test('native owner and legacy track authority compile and commit within the real installation writer',async()=>{
 const name='analysis-proof-native',mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:[{config:{name,compatibilityDate:'2026-09-09',manifest:{mainModule:'entry.js',modulesRoot:process.cwd(),modules:{'entry.js':{type:'esm',contents:'export default {fetch(){return new Response("fixture");}}'}}},env:{DB:{type:'d1',id:name}}}}]});
 try{
  await mf.ready;const raw=await mf.getD1Database('DB',name),password='synthetic-native-proof-password',fresh=new FreshInstallation(raw,{schema:SCHEMA,seed:SEED,bootstrapPassword:password});
  while((await fresh.inspect()).state!=='ready')await fresh.advance(password);
  const db=wrapDatabase(raw),f=analysisFixture();try{
   f.sqlite.exec("INSERT INTO account_source_teams VALUES('account','source-team');UPDATE team_source_connections SET scope_mode='fixed_seasons';INSERT INTO connection_event_resolutions(connection_id,source_event_id,team_season_id,state,effective_day,basis,source_hash,generation) VALUES('root','source-event','season','resolved','2026-09-01','local_date','test',1)");
   const order=['provider_accounts','app_teams','team_read_state','team_seasons','team_projection_runs','team_projection_state','source_teams','account_source_teams','team_source_attachments','team_source_connections','team_connection_seasons','events','source_events','source_event_teams','event_source_links','team_event_season_resolutions','connection_event_resolutions','team_event_rows','players','source_players','player_source_links','team_player_rows','source_trace_components','source_component_coverage','source_game_members','source_tracking_segments'];
   for(const table of order){const rows=f.all('SELECT * FROM '+table);for(let at=0;at<rows.length;at+=24)await db.batch(rows.slice(at,at+24).map(row=>db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row))));}
  }finally{f.close();}
  const tracks=new NativeTrackService(db,{owner:true}),context=await tracks.context({team_id:'team',team_season_id:'season'},'event'),member=await db.prepare("SELECT * FROM source_game_members WHERE gid='g1'").first(),children=await tracks.sourceChildren({...context,member});
  assert.equal(children.length,5);assert.equal(new Set(children.map(c=>c.resourceKey)).size,5);
  // Same admission boundary as application-sync: account for prior route work.
  const budget=new BudgetDB(raw,48);budget.reserve(20);await new ApplicationSyncService(wrapDatabase(budget),{}, {wake:async()=>{}}).enqueueAnalysisRefresh({teamId:'team',seasonId:'season',eventId:'event',sourceChildren:children});assert.ok(budget.used<=48);
  const job=await db.prepare("SELECT * FROM sync_jobs WHERE provider='trace' AND component='tracking' ORDER BY resource_key LIMIT 1").first(),args=JSON.parse(job.args);delete args.analysis_source_proof;
  const proof=nativeAnalysisCollectionProof({args,accountId:'account',accountGeneration:1,jobId:job.id,component:'tracking'}),allowed=async()=>(await db.prepare('SELECT CASE WHEN '+proof.sql+' THEN 1 ELSE 0 END AS ok').bind(...proof.params).first()).ok;
  const commits=[];
  for(const state of ['provider','stale_root','file_only']){
   await db.prepare("UPDATE team_source_connections SET generation=? WHERE id='root'").bind(state==='stale_root'?2:1).run();await db.prepare("UPDATE source_events SET provenance=? WHERE id='source-event'").bind(state==='file_only'?'file_import':'provider').run();
   assert.equal(await allowed(),state==='provider'?1:0);
   const at=Date.now(),lease={...job,args,checkpoint:{},lease_token:'lease-'+state,lease_until:at+60000};await db.prepare("UPDATE sync_jobs SET state='running',lease_token=?,lease_until=? WHERE id=?").bind(lease.lease_token,lease.lease_until,lease.id).run();
   const before=await db.prepare("SELECT page_offset FROM source_tracking_segments WHERE id='segments-1-1'").first(),commitBudget=new BudgetDB(raw,48),coordinator=new JobCoordinator(wrapDatabase(commitBudget),{publicHistory:true});
   const result={statements:[{sql:`INSERT INTO domain_team_preconditions(id,expected_input,actual_input) SELECT 1,1,CASE WHEN ${proof.sql} THEN 1 ELSE 0 END WHERE $FENCE ON CONFLICT(id) DO UPDATE SET expected_input=excluded.expected_input,actual_input=excluded.actual_input`,params:proof.params},{sql:"UPDATE source_tracking_segments SET page_offset=page_offset+1 WHERE id='segments-1-1' AND $FENCE",params:[]}],complete:true,children:[{...children[1],subscriberMode:'inherit'}],observations:[{endpoint:'https://go.traceup.com/synthetic-proof',status:200,at,bytes:10,hash:'a'.repeat(64),rows_count:1}]};
   if(state==='provider'){assert.equal((await coordinator.commit(lease,result)).committed,true);assert.equal((await db.prepare("SELECT page_offset FROM source_tracking_segments WHERE id='segments-1-1'").first()).page_offset,before.page_offset+1);}
   else{await assert.rejects(()=>coordinator.commit(lease,result),/CHECK constraint failed/);assert.deepEqual(await db.prepare("SELECT page_offset FROM source_tracking_segments WHERE id='segments-1-1'").first(),before);}
   assert.ok(commitBudget.used<=48);commits.push({state,statements:commitBudget.used});assert.equal((await db.prepare('SELECT writer_mode FROM installation_upgrade WHERE id=1').first()).writer_mode,null);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM sync_observations').first()).n,1,'denied pages cannot save observations');
  console.log(JSON.stringify({native_track_proof:{synthetic:true,real_installation_writer:true,owner_admission_statements:budget.used,prior_route_reserved:20,children:5,commits}}));
 }finally{await mf.dispose();}
});
