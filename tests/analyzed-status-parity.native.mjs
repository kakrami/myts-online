import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {createHash} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {SECURITY_SCHEMA} from '../src/security/schema.js';
import {REPORT_SCHEMA} from '../src/reporting/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {publishedAnalysisFixture} from './fixtures/published-analysis-fixture.mjs';
import {AnalysisReads} from '../src/analysis/reads.js';
import {FeatureReads} from '../src/read-model/feature-reads.js';
import {ReportingService} from '../src/reporting/service.js';
import {CoachingService} from '../src/coaching/service.js';
import {BudgetDB} from '../src/sync/budget.js';
const AT=Date.parse('2026-10-12T12:00:00Z'),INPUT={team_id:'team',team_season_id:'season',mode:'season',period:'all'};
const files=['src/analysis/eligibility.js','src/analysis/reads.js','src/read-model/feature-reads.js','src/read-model/repository.js','src/reporting/service.js','src/coaching/service.js','web/ui-original/screens.js'];
// Run only in the serialized native slot. All input is synthetic and local.
test('native legacy and normalized UNKNOWN partial publications reach shared readers and actual report capture',async t=>{
 const runtimeFiles=[];for(const dir of ['src','web/app','web/ui-original'])for(const file of (await readdir(dir,{recursive:true})).filter(f=>f.endsWith('.js')))runtimeFiles.push(dir+'/'+file);runtimeFiles.sort();
 const sourceMap=async()=>Object.fromEntries(await Promise.all(runtimeFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')]))),beforeMap=await sourceMap(),fingerprint=createHash('sha256').update(JSON.stringify(beforeMap)).digest('hex');
 const previous=getGlobalDispatcher(),dispatcher=new Agent({pipelining:0});setGlobalDispatcher(dispatcher);
 const modes=['legacy','normalized'],mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:modes.map(mode=>({config:{name:'analyzed-'+mode,compatibilityDate:'2026-09-09',manifest:{mainModule:'entry.js',modulesRoot:process.cwd(),modules:{'entry.js':{type:'esm',contents:'export default {fetch(){return new Response("synthetic analyzed parity");}}'}}},env:{DB:{type:'d1',id:'analyzed-'+mode}}}}))});
 const receipts=[];let stage='startup';
 try{await mf.ready;for(const mode of modes)await t.test(mode,async()=>{
  const db=await mf.getD1Database('DB','analyzed-'+mode);stage=mode+':schema';for(const schema of [DOMAIN_SCHEMA,ANALYSIS_SCHEMA,TEAM_FEATURE_SCHEMA,SECURITY_SCHEMA,REPORT_SCHEMA,SYNC_SCHEMA])for(let i=0;i<schema.length;i+=24)await db.batch(schema.slice(i,i+24).map(sql=>db.prepare(sql)));
  const f=mode==='legacy'?analysisFixture({players:1}):publishedAnalysisFixture({target:'public-event'});
  try{
   f.sqlite.exec("UPDATE source_events SET status='UNKNOWN',home_score=NULL,away_score=NULL;UPDATE team_event_rows SET status='UNKNOWN',home_score=NULL,away_score=NULL,goals_for=NULL,goals_against=NULL WHERE run_id='team-run';UPDATE source_component_coverage SET complete=0 WHERE kind='game'");
   f.override('player-000',{minutes:40,started:true});if(mode==='normalized')f.publish({id:'unknown-run'});f.commit(await f.page());
   const order=['domain_installation','provider_accounts','app_teams','team_read_state','team_seasons','team_projection_runs','team_projection_state','source_teams','team_source_attachments','team_source_connections','team_connection_seasons','events','source_events','source_event_teams','event_source_links','team_event_season_resolutions','team_event_rows','players','source_players','player_source_links','team_player_rows','source_trace_components','source_component_coverage','source_game_members','source_tracking_segments','analysis_overrides','match_analysis','player_match_analysis','team_game_associations','team_game_decision_revisions'];
   for(const table of order){stage=mode+':seed:'+table;const rows=f.all('SELECT * FROM '+table).map(row=>table==='team_projection_runs'&&row.team_game_version===1?{...row,state:'building'}:table==='team_projection_state'?{...row,published_run_id:'team-run'}:table==='team_game_associations'?{...row,head_revision:0}:row);for(let i=0;i<rows.length;i+=24)await db.batch(rows.slice(i,i+24).map(row=>db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row))));}
   if(mode==='normalized'){
    await db.prepare('UPDATE team_game_associations SET head_revision=1').run();
    for(const table of ['team_game_publications','team_game_source_rows'])for(const original of f.all('SELECT * FROM '+table)){
     const row={...original};if(table==='team_game_source_rows'){row.connection_input_revision=(await db.prepare('SELECT input_revision FROM team_source_connections WHERE id=?').bind(row.connection_id).first()).input_revision;row.source_input_revision=(await db.prepare('SELECT input_revision FROM source_event_state WHERE source_event_id=?').bind(row.source_event_id).first())?.input_revision??0;}
     await db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row)).run();
    }
    await db.prepare("UPDATE team_projection_runs SET state='published' WHERE team_game_version=1").run();
   }
   await db.batch([db.prepare('UPDATE team_projection_state SET published_run_id=?,pending=0,published_input_revision=input_revision').bind(mode==='legacy'?'team-run':'unknown-run'),db.prepare('UPDATE team_read_state SET pending=0')]);
  }finally{f.close();}
  const now=()=>AT,receiptsFor=[];
  async function action(name,fn){stage=mode+':'+name;const budget=new BudgetDB(db,48);budget.reserve(8);const result=await fn(budget);assert.ok(budget.used<=48);receiptsFor.push({action:name,statements:budget.used});return result;}
  const team=await action('team',b=>new AnalysisReads(b,{owner:true},{now}).team(INPUT));assert.equal(team.data.players.items.find(p=>p.id==='player-000').minutes,40);
  const player=await action('player',b=>new AnalysisReads(b,{owner:true},{now}).player(INPUT,'player-000'));assert.equal(player.data.stats.apps,1);assert.equal(player.data.stats.minutes,40);assert.equal(player.data.stats.goals,null);assert.equal(player.data.matches.total,1);
  const coach=await action('coach-hints',b=>new CoachingService(b,{owner:true},{now}).roleHints(INPUT));assert.deepEqual(coach['player-000'].recent_trace_minutes,[40]);
  const overview=await action('overview',b=>new FeatureReads(b,{owner:true},{now}).overview(INPUT));assert.equal(overview.data.analyzed_count,1);assert.equal(overview.data.record.games,0);
  const schedule=await action('analyzed-schedule',b=>new FeatureReads(b,{owner:true},{now}).schedule({...INPUT,type:'analyzed',period:'upcoming'}));assert.equal(schedule.data.total,1);assert.equal(schedule.data.items[0].status,'UNKNOWN');assert.equal(schedule.data.items[0].home_score,null);
  const report=new ReportingService(db,{now,coordinator:{enqueue:async()=> 'synthetic-capture'},captureAtAdmission:false});
  const created=await action('summary-create',b=>new ReportingService(b,{now,coordinator:{enqueue:async()=> 'synthetic-capture'},captureAtAdmission:false}).create(INPUT,{type:'season'}));
  let snapshot=await report.snapshot(created.data.snapshot_id);assert.equal(snapshot.state,'capturing');assert.ok(Buffer.byteLength(snapshot.query_sql)<48000);
  const page=await action('summary-capture',b=>new ReportingService(b,{now}).capture(snapshot));assert.ok(page.statements.every(s=>!s.sql.includes(';')));await db.batch(page.statements.map(s=>db.prepare(s.sql.replaceAll('$FENCE','1')).bind(...s.params)));
  const preview=await report.preview(snapshot.id);assert.equal(preview.data.state,'ready');assert.equal(preview.data.rows.items.find(r=>r.metric==='Matches analyzed').value,1);assert.equal(preview.data.rows.items.find(r=>r.metric==='Record').value,'—');assert.match(preview.data.rows.items.find(r=>r.metric==='Matches analyzed')._report_note,/incomplete or unavailable/);
  await db.prepare("UPDATE team_source_connections SET active=0 WHERE id='root'").run();assert.equal((await new FeatureReads(db,{owner:true},{now}).overview(INPUT)).data.analyzed_count,0);assert.equal((await new FeatureReads(db,{owner:true},{now}).schedule({...INPUT,type:'analyzed'})).data.total,0);
  receipts.push({mode,query_bytes:Buffer.byteLength(snapshot.query_sql),budgets:receiptsFor});
 });const afterMap=await sourceMap();assert.deepEqual(afterMap,beforeMap,'the full relevant runtime map must stay fixed during native proof');await mkdir('tmp',{recursive:true});await writeFile('tmp/analyzed-status-native-source-map.json',JSON.stringify({fingerprint,before:beforeMap,after:afterMap},null,2));console.log(JSON.stringify({analyzed_status_native:{source_fingerprint:fingerprint,after_hash_verified:true,runtime_files:runtimeFiles.length,focus_files:files,scope:'Native D1 host-service queries and capture; stub enqueue; $FENCE=1; no HTTP/epoch/coordinator proof',receipts,unknown_result_preserved:true,partial_publication_counted:true,current_entitlement_fenced:true}}));
 }catch(error){console.error(JSON.stringify({stage,error:String(error),cause:String(error.cause||'')}));throw error;}finally{await mf.dispose();setGlobalDispatcher(previous);await dispatcher.close();}
});
