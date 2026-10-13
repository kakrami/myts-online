import test from 'node:test';
import assert from 'node:assert/strict';
import {derivedPublicationFixture,DERIVED_AT,DERIVED_SCOPE} from './fixtures/derived-publication-fixture.mjs';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {publishedAnalysisFixture} from './fixtures/published-analysis-fixture.mjs';
import {APPLICATION_SCHEMA} from '../src/application/installation-schema.js';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {ApplicationSyncService,collectApplicationJob} from '../src/application/sync-service.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {buildConnectionPage} from '../src/domain/connection-materializer.js';
import {collectTrace} from '../src/sources/trace.js';
import {createSyncRuntime} from '../src/sync/runtime.js';

// Current application DDL, real SQLite transactions, production collectors,
// projection and analysis. Only finite provider responses and D1 transport are fake.
function completeFixture(f,{sync=false}={}) {
 const existing=new Set([...DOMAIN_SCHEMA,...ANALYSIS_SCHEMA,...(sync?SYNC_SCHEMA:[])]);
 for(const sql of APPLICATION_SCHEMA)if(!existing.has(sql))f.sqlite.exec(sql);
 const prepare=(sql,params=[])=>({sql,params,bind(...values){return prepare(sql,values);},async all(){const results=f.sqlite.prepare(sql).all(...params).map(r=>({...r}));return {results,meta:{changes:f.sqlite.prepare('SELECT changes() n').get().n}};},async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;},async run(){return this.all();}});
 f.db.prepare=prepare;f.db.batch=async statements=>{f.sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.all());f.sqlite.exec('COMMIT');return result;}catch(error){f.sqlite.exec('ROLLBACK');throw error;}};
 f.rows=(sql,...params)=>f.sqlite.prepare(sql).all(...params).map(r=>({...r}));f.one=(sql,...params)=>f.rows(sql,...params)[0]??null;
 f.commitPage=page=>f.db.batch(page.statements.map(s=>f.db.prepare(s.sql.replaceAll('$FENCE','1')).bind(...s.params)));
 f.service=new ApplicationSyncService(f.db,{}, {wake:async()=>{}});f.jobs=f.service.jobs;
 return f;
}
async function settle(build,commit){let checkpoint={};for(let i=0;i<80;i++){const page=await build(checkpoint);await commit(page);if(page.complete)return page;checkpoint=page.checkpoint;}assert.fail('Bounded fixture publication did not settle');}
async function derived(t){
 t.mock.timers.enable({apis:['Date'],now:DERIVED_AT});const f=completeFixture(await derivedPublicationFixture({historyCount:0}),{sync:true});t.after(()=>f.close());
 await settle(checkpoint=>buildConnectionPage(f.db,{connectionId:'root',teamId:'team',generation:1,checkpoint}),f.commitPage);
 await settle(checkpoint=>f.repo.buildProjectionPage('team','season',checkpoint),f.commitPage);
 assert.equal(f.one('SELECT COUNT(*) n FROM team_events').n,1);
 f.collect=async(component,args)=>{const pages=[];let cursor={};for(let i=0;i<30;i++){const page=await collectTrace({j:{kind:component,scan_id:'derived-test'},args,cursor,transport:f.transportFactory(),account:{provider:'trace',id:'account',native_id:'1'},credential:'synthetic'});await f.save(page);pages.push(page);if(page.complete)return pages;cursor=page.checkpoint;}assert.fail('Synthetic collector did not terminate');};
 f.clocks=()=>({projection:f.one('SELECT * FROM team_projection_state'),read:f.one('SELECT * FROM team_read_state'),root:f.one("SELECT input_revision,reconciled_revision FROM team_source_connections WHERE id='root'"),event:f.one('SELECT input_revision FROM source_event_state WHERE source_event_id=?',DERIVED_SCOPE.sourceEventId).input_revision});
 return f;
}
function assertDerived(before,after,label){
 assert.ok(after.event>before.event,label+' advances the exact game clock');
 assert.ok(after.projection.source_revision>before.projection.source_revision,label+' retains the analysis source epoch');
 for(const key of ['input_revision','published_input_revision','published_run_id','pending','projection_hash'])assert.equal(after.projection[key],before.projection[key],label+' keeps projection '+key);
 assert.deepEqual(after.read,before.read,label+' does not dirty team reads');assert.deepEqual(after.root,before.root,label+' does not dirty root reconciliation');
}
function readyFixture(t,{grouped=false,target='event'}={}){const f=completeFixture(grouped?publishedAnalysisFixture({target}):analysisFixture());t.after(()=>f.close());return f;}
const job=f=>f.one("SELECT * FROM sync_jobs WHERE provider='analysis' AND component='match'");
const bump=(f,id='source-event')=>f.sqlite.prepare('INSERT INTO source_event_state(source_event_id,input_revision) VALUES(?,1) ON CONFLICT(source_event_id) DO UPDATE SET input_revision=input_revision+1').run(id);
const recover=f=>f.service.recoverMatchAnalyses({wake:false});
const analysisPage=(f,lease)=>collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint??{}});

test('tracking, radar, statistics and heatmaps advance analysis inputs without republishing a settled season',async t=>{
 const f=await derived(t);
 for(const component of ['tracking','radar','analytics']){
  const child=f.children.find(c=>c.component===component);assert.ok(child,component+' has a real collector demand');
  let before=f.clocks();await f.collect(component,child.args);assertDerived(before,f.clocks(),component+' first page');
  before=f.clocks();f.advanceDerivedResponse();await f.collect(component,child.args);assertDerived(before,f.clocks(),component+' refreshed payload');
 }
 for(const table of ['source_tracking_segments','source_stat_items','source_stat_summaries','source_heatmaps'])assert.ok(f.one(`SELECT COUNT(*) n FROM ${table}`).n>0,table);
 assert.equal(f.one("SELECT COUNT(*) n FROM source_trace_components WHERE kind='radar'").n,1);
});

test('derived terminal removals and coverage-only changes keep the published projection intact',async t=>{
 const f=await derived(t),base={account_id:'account',team_id:'trace:400',fixture_id:'trace:4001'};
 for(const component of ['tracking','radar','analytics'])await f.collect(component,f.children.find(c=>c.component===component).args);
 for(const [label,replacement,table]of [
  ['tracking',{kind:'trace_tracking_parts',half:1,gid:'home-goalkeeper',chunk_pages:{},segment_page_size:1000},'source_tracking_segments'],
  ['statistics',{kind:'trace_stat_parts',player_id:'team',side:'home',period:'full',item_counts:{}},'source_stat_items'],
  ['radar',{kind:'trace_radar_parts',half:1,valid_parts:[]},'source_trace_components'],
 ]){const before=f.clocks(),count=f.one(`SELECT COUNT(*) n FROM ${table}`).n;await f.repo.ingestSourcePage({accountId:'account',generation:1,records:{},replacements:[{...base,...replacement}],scanId:'replacement'});assert.ok(f.one(`SELECT COUNT(*) n FROM ${table}`).n<count,label+' really removes saved rows');assertDerived(before,f.clocks(),label+' removal');}
 for(const kind of ['tracking','analytics','radar']){const before=f.clocks();await f.repo.ingestSourcePage({accountId:'account',generation:1,records:{},sourceCoverage:[{provider:'trace',kind,scope:'trace:4001:trace:400:coverage-only',complete:true,count:7}],scanId:'coverage'});assertDerived(before,f.clocks(),kind+' coverage');}
 const before=f.clocks();await f.repo.ingestSourcePage({accountId:'account',generation:1,records:{},sourceCoverage:[{provider:'trace',kind:'radar',scope:'trace:4001:trace:400:coverage-only',complete:true,count:7}],scanId:'repeat'});assert.deepEqual(f.clocks(),before,'an identical coverage receipt is a semantic no-op');
});

for(const kind of ['date','member','roster','attendance'])test(kind+' remains a structural projection input',async t=>{
 const f=await derived(t);
 if(kind==='attendance'){
  f.sqlite.exec("INSERT INTO provider_accounts(id,provider,native_id,name) VALUES('ts-account','teamsnap','1','Attendance');");
  await f.repo.ingestSourcePage({accountId:'ts-account',generation:1,records:{teams:[{provider:'teamsnap',native_id:'10',name:'Us',details:'{"account_owned":true}'}],players:[{provider:'teamsnap',native_id:'99',name:'Player',details:'{}'}]},fixtures:[{provider:'teamsnap',native_id:'20',home_id:'teamsnap:10',starts_at:'2026-09-01T17:00:00Z',type:'game',status:'FINAL',conditional:0,payload:'{}'}]});
  await f.repo.attachTeam({teamId:'team',seasonId:'season',sourceTeamId:'teamsnap/ts-account/10',accountId:'ts-account'});
  f.sqlite.exec('UPDATE team_projection_state SET pending=0,published_input_revision=input_revision;UPDATE team_read_state SET pending=0');
 }
 const before=f.clocks(),playersBefore=JSON.stringify(f.rows('SELECT * FROM source_players ORDER BY id'));
 if(kind==='date'){f.correctGameDate('2026-09-03T17:00:00Z');await f.collect('game',{team_id:'400',game_id:'4001',profile_hash:'synthetic-profile'});}
 if(kind==='member'){f.game.team_members[0].join_time=1700000012345;await f.collect('game',{team_id:'400',game_id:'4001',profile_hash:'synthetic-profile'});}
 if(kind==='roster')await f.repo.ingestSourcePage({accountId:'account',generation:1,records:{team_players:[{team_id:'trace:400',player_id:'trace:1000',active:0,scan_id:'roster'}]}});
 if(kind==='attendance')await f.repo.ingestSourcePage({accountId:'ts-account',generation:1,records:{attendance:[{account_id:'ts-account',team_id:'teamsnap:10',fixture_id:'teamsnap:20',player_id:'teamsnap:99',status_code:1}]}});
 if(kind==='member')assert.equal(JSON.stringify(f.rows('SELECT * FROM source_players ORDER BY id')),playersBefore,'membership timing alone changes, without a player or roster edit');
 const after=f.clocks();assert.equal(after.projection.pending,1);assert.ok(after.projection.input_revision>before.projection.input_revision);assert.equal(after.read.pending,1);assert.equal(after.projection.published_run_id,before.projection.published_run_id,'existing published pointer is retained until a replacement is built');
});

test('the durable alarm recovery helper recreates a missing or lost match child without a browser request',async t=>{
 const f=readyFixture(t),values=new Map([['connection_recovery_pending',true]]),ctx={storage:{async get(k){return values.get(k);},async put(k,v){values.set(k,structuredClone(v));},async getAlarm(){return values.get('alarm')??null;},async setAlarm(at){values.set('alarm',at);},async deleteAlarm(){values.delete('alarm');}}};
 const Runtime=createSyncRuntime(()=>assert.fail('Recovery yields before collecting'),{recoverConnections:({db,env})=>new ApplicationSyncService(db,env).recoverLocalDemand({wake:false})});
 await new Runtime(ctx,{DB:f.db}).alarm();assert.equal(values.get('last_run').state,'recovering_connections');assert.equal(values.get('last_run').analysesQueued,1);assert.equal(job(f).state,'queued');assert.ok(values.get('alarm'));
 f.sqlite.exec("DELETE FROM sync_job_subscribers WHERE job_id IN(SELECT id FROM sync_jobs WHERE provider='analysis');DELETE FROM sync_jobs WHERE provider='analysis';");
 values.set('connection_recovery_pending',true);await new Runtime(ctx,{DB:f.db}).alarm();assert.equal(values.get('last_run').analysesQueued,1);assert.equal(job(f).state,'queued');assert.equal(f.one("SELECT COUNT(*) n FROM sync_job_subscribers WHERE job_id=?",job(f).id).n,1);
});

for(const state of ['queued','running','retrying'])test('recovery preserves '+state+' generation, checkpoint, attempt watermark and lease',async t=>{
 const f=readyFixture(t);assert.equal((await recover(f)).queued,1);const id=job(f).id;
 f.sqlite.prepare("UPDATE sync_jobs SET state=?,checkpoint=?,lease_token='current-lease',lease_until=9999999999999,pages_saved=3 WHERE id=?").run(state,JSON.stringify({cursor:'keep',sourceClock:'older'}),id);const before=job(f);bump(f);assert.equal((await recover(f)).queued,0);assert.deepEqual(job(f),before);
});

for(const state of ['failed','blocked'])test('unchanged '+state+' attempts wait for a new exact source revision',async t=>{
 const f=readyFixture(t);await recover(f);const before=job(f),attempt=JSON.parse(before.args).sourceClock;
 f.sqlite.prepare('UPDATE sync_jobs SET state=?,checkpoint=? WHERE id=?').run(state,JSON.stringify({sourceClock:'old successful clock',cursor:'failure'}),before.id);
 assert.equal((await recover(f)).queued,0);assert.equal(job(f).state,state);assert.equal(JSON.parse(job(f).args).sourceClock,attempt);
 bump(f);assert.equal((await recover(f)).queued,1);assert.equal(job(f).state,'queued');assert.equal(job(f).generation,before.generation+1);assert.notEqual(JSON.parse(job(f).args).sourceClock,attempt);assert.equal(job(f).checkpoint,'{}');
});

test('terminal-to-running race between recovery query and admission does not reset the new attempt',async t=>{
 const f=readyFixture(t);await recover(f);f.sqlite.exec("UPDATE sync_jobs SET state='ready',checkpoint='{}'");const enqueue=f.jobs.enqueueMany.bind(f.jobs);let raced;
 f.jobs.enqueueMany=(...args)=>{f.sqlite.exec("UPDATE sync_jobs SET state='running',lease_token='raced-lease',lease_until=9999999999999,checkpoint='{\"cursor\":\"raced\"}'");raced=job(f);return enqueue(...args);};
 assert.equal((await recover(f)).queued,0);assert.deepEqual(job(f),raced);
});

for(const state of ['queued','running','retrying'])test('public-history catalog fan-out preserves '+state+' recovery attempt and explicit refresh still restarts',async t=>{
 const f=readyFixture(t);f.jobs=new JobCoordinator(f.db,{publicHistory:true});f.service.jobs=f.jobs;await recover(f);const original=job(f);
 const catalogId=await f.jobs.enqueue({provider:'analysis',component:'catalog',stage:'analysis',scope:'team',resourceKey:'season',args:{teamId:'team',seasonId:'season',requestId:'late-catalog'},priority:100,recurring:false},[{kind:'team',key:'analysis:team:season',teamId:'team'}]);
 const catalogLease=await f.jobs.claim();assert.equal(catalogLease.id,catalogId);
 f.sqlite.prepare("UPDATE sync_jobs SET state=?,checkpoint=?,pages_saved=2,lease_token='existing-match-lease',lease_until=9999999999999 WHERE id=?").run(state,'{"cursor":"keep","sourceClock":"old-complete"}',original.id);const before=job(f);
 const page=await collectApplicationJob({db:f.db,env:{},lease:catalogLease,args:catalogLease.args,checkpoint:catalogLease.checkpoint});
 assert.equal(page.children.length,1);assert.equal(page.children[0].args.automatic,true);assert.equal((await f.jobs.commit(catalogLease,page)).committed,true);
 const after=job(f);for(const key of ['state','generation','checkpoint','args','lease_token','lease_until','scan_id','pages_saved'])assert.equal(after[key],before[key],key+' survives automatic catalog commit');
 f.sqlite.prepare("UPDATE sync_jobs SET state='failed' WHERE id=?").run(original.id);assert.equal((await recover(f)).queued,0,'a subsequent failed attempt still has its original source watermark');
 await f.service.enqueueAnalysisRefresh({teamId:'team',seasonId:'season',eventId:'event'},{wake:false});
 assert.equal(job(f).generation,before.generation+1);assert.equal(job(f).checkpoint,'{}');assert.equal(job(f).lease_token,null);
});

test('grouped display target recovers from normalized Trace membership even when its native canonical key differs',async t=>{
 const f=readyFixture(t,{grouped:true,target:'public-event'});assert.equal(f.one("SELECT event_id FROM event_source_links WHERE source_event_id='source-event'").event_id,'event');
 assert.equal((await recover(f)).queued,1);assert.equal(job(f).resource_key,'season:public-event');
 const clock=JSON.parse(JSON.parse(job(f).args).sourceClock);assert.equal(clock[0],'grouped-run');assert.equal(clock[1].length,3);
 const lease=await f.jobs.claim(),page=await analysisPage(f,lease);assert.equal(page.checkpoint.sourceClock,JSON.parse(job(f).args).sourceClock);assert.equal((await f.jobs.commit(lease,page)).committed,true);assert.equal((await recover(f)).queued,0);
 assert.equal(f.one('SELECT event_id FROM match_analysis').event_id,'public-event');
});

test('prepared analysis rejects a same-match source change and acknowledges only a successful input CAS',async t=>{
 const f=readyFixture(t,{grouped:true});await recover(f);const lease=await f.jobs.claim(),page=await analysisPage(f,lease),before=job(f);bump(f);
 await assert.rejects(()=>f.jobs.commit(lease,page),/CHECK constraint/);assert.equal(job(f).checkpoint,before.checkpoint);assert.equal(f.one('SELECT COUNT(*) n FROM match_analysis').n,0);
 const fresh=await analysisPage(f,lease);assert.notEqual(fresh.checkpoint.sourceClock,page.checkpoint.sourceClock);assert.equal((await f.jobs.commit(lease,fresh)).committed,true);assert.equal((await recover(f)).queued,0);
});

test('unrelated-game source changes do not reject prepared analysis or requeue the serviced match',async t=>{
 const f=readyFixture(t,{grouped:true});const native=f.one("SELECT * FROM source_events WHERE id='source-event'");f.insert('source_events',{...native,id:'unrelated-source',native_id:'other',content_hash:'unrelated'});
 await recover(f);const lease=await f.jobs.claim(),page=await analysisPage(f,lease);bump(f,'unrelated-source');f.sqlite.exec('UPDATE team_projection_state SET source_revision=source_revision+1;UPDATE domain_installation SET source_revision=source_revision+1');
 assert.equal((await f.jobs.commit(lease,page)).committed,true);assert.equal(JSON.parse(job(f).checkpoint).sourceClock,page.checkpoint.sourceClock);assert.equal((await recover(f)).queued,0);
});

test('64 maximum-length source identities produce a compact exact ordered clock and bounded checkpoint',async t=>{
 const f=readyFixture(t,{grouped:true}),run=f.one("SELECT * FROM team_projection_runs WHERE id='grouped-run'"),old=f.one("SELECT * FROM team_event_rows WHERE run_id='grouped-run'"),member=f.one("SELECT * FROM team_game_source_rows WHERE run_id='grouped-run' AND source_event_id='source-event'"),source=f.one("SELECT * FROM source_events WHERE id='source-event'");
 const runId='wide-run';f.insert('team_projection_runs',{...run,id:runId,state:'building'});f.insert('team_event_rows',{...old,run_id:runId});
 for(const table of ['team_game_publications','team_game_source_rows','team_player_rows'])for(const row of f.rows(`SELECT * FROM ${table} WHERE run_id='grouped-run'`))f.insert(table,{...row,run_id:runId});
 const sourceIds=JSON.parse(old.source_ids);for(let i=0;i<61;i++){const nativeId=String(i).padStart(3,'0')+'x'.repeat(237),id='trace/account/'+nativeId;sourceIds.push(id);f.insert('source_events',{...source,id,native_id:nativeId});f.insert('source_event_teams',{source_event_id:id,source_team_id:'source-team',side:'home'});f.insert('event_source_links',{source_event_id:id,event_id:'event',reason:'native',evidence:'{}'});f.insert('source_event_state',{source_event_id:id,input_revision:i+100});f.insert('team_game_source_rows',{...member,run_id:runId,source_event_id:id,source_input_revision:i+100,connection_input_revision:f.one("SELECT input_revision FROM team_source_connections WHERE id='root'").input_revision});}
 f.sqlite.prepare('UPDATE team_event_rows SET source_ids=? WHERE run_id=?').run(JSON.stringify(sourceIds),runId);f.sqlite.prepare("UPDATE team_projection_runs SET state='published' WHERE id=?").run(runId);f.sqlite.prepare('UPDATE team_projection_state SET published_run_id=?,pending=0').run(runId);
 assert.equal(sourceIds.length,64);assert.equal((await recover(f)).queued,1);const clock=JSON.parse(job(f).args).sourceClock,parsed=JSON.parse(clock);assert.equal(parsed[0],runId);assert.equal(parsed[1].length,64);assert.ok(Buffer.byteLength(clock)<512);assert.ok(!clock.includes('x'.repeat(20)));
 const expected=f.rows('SELECT COALESCE(v.input_revision,0) n FROM team_game_source_rows m LEFT JOIN source_event_state v ON v.source_event_id=m.source_event_id WHERE m.run_id=? ORDER BY m.source_event_id',runId).map(r=>r.n);assert.deepEqual(parsed[1],expected);
 const lease=await f.jobs.claim(),page=await analysisPage(f,lease);assert.equal(page.checkpoint.sourceClock,clock);assert.ok(Buffer.byteLength(JSON.stringify(page.checkpoint))<1024);assert.equal((await f.jobs.commit(lease,page)).committed,true);assert.equal((await recover(f)).queued,0);
});


test('owner season-wide Refresh preserves active recovery and its successful page acknowledges newer source input',async t=>{
 const f=readyFixture(t);f.jobs=new JobCoordinator(f.db,{publicHistory:true});f.service.jobs=f.jobs;await recover(f);const lease=await f.jobs.claim(),attempt=job(f);assert.equal(lease.component,'match');
 bump(f);const requested=await f.service.enqueueAnalysisRefresh({teamId:'team',seasonId:'season'},{wake:false});assert.equal(requested.queued,true);const catalog=await f.jobs.claim();assert.equal(catalog.id,requested.jobId);assert.equal(catalog.component,'catalog');
 const catalogPage=await collectApplicationJob({db:f.db,env:{},lease:catalog,args:catalog.args,checkpoint:catalog.checkpoint});assert.equal((await f.jobs.commit(catalog,catalogPage)).committed,true);
 const preserved=job(f);for(const key of ['state','generation','checkpoint','args','lease_token','lease_until','scan_id'])assert.equal(preserved[key],attempt[key],key);
 const page=await analysisPage(f,lease);assert.notEqual(page.checkpoint.sourceClock,JSON.parse(attempt.args).sourceClock);assert.equal((await f.jobs.commit(lease,page)).committed,true);assert.equal(JSON.parse(job(f).checkpoint).sourceClock,page.checkpoint.sourceClock);assert.equal((await recover(f)).queued,0);
});

test('invalid or unsafe source revisions cannot be admitted as a compact recovery clock',async t=>{
 const f=readyFixture(t);
 for(const revision of [-1,1.5,9007199254740992]){f.sqlite.prepare('INSERT INTO source_event_state(source_event_id,input_revision) VALUES(?,?) ON CONFLICT(source_event_id) DO UPDATE SET input_revision=excluded.input_revision').run('source-event',revision);assert.equal((await recover(f)).queued,0,String(revision));assert.equal(job(f),null);}
 f.sqlite.prepare('UPDATE source_event_state SET input_revision=9007199254740991').run();assert.equal((await recover(f)).queued,1,'the maximum safe exact integer is admitted');
});

for(const destination of ['other-season',null])test('obsolete '+String(destination)+' placement does not endlessly recover against a retained published pointer',async t=>{
 const f=readyFixture(t);f.override('player-000',{minutes:40,started:true});const ownerBytes=JSON.stringify(f.rows('SELECT * FROM analysis_overrides'));
 f.insert('team_seasons',{...f.one("SELECT * FROM team_seasons WHERE id='season'"),id:'other-season',year:2027,start_day:'2027-06-01',end_day:'2028-06-01',start_at:'2027-06-01T00:00:00Z',end_at:'2028-06-01T00:00:00Z'});
 await recover(f);const lease=await f.jobs.claim();f.sqlite.prepare('UPDATE team_event_season_resolutions SET team_season_id=?,state=? WHERE event_id=?').run(destination,destination?'resolved':'pending','event');
 assert.equal(f.one('SELECT published_run_id FROM team_projection_state').published_run_id,'team-run');assert.equal(f.one('SELECT COUNT(*) n FROM team_events').n,1,'old display pointer remains visible');
 const page=await analysisPage(f,lease);assert.equal(page.checkpoint.obsolete,true);assert.equal((await f.jobs.commit(lease,page)).committed,true);assert.equal(job(f).state,'ready');assert.deepEqual(JSON.parse(job(f).checkpoint),{obsolete:true});
 for(let pass=0;pass<3;pass++)assert.equal((await recover(f)).queued,0,'terminal obsolete receipt does not loop');assert.equal(JSON.stringify(f.rows('SELECT * FROM analysis_overrides')),ownerBytes);
 f.sqlite.exec("UPDATE team_event_season_resolutions SET team_season_id='season',state='resolved' WHERE event_id='event'");assert.equal((await recover(f)).queued,1,'restored current placement makes the retained target eligible again');assert.equal(JSON.stringify(f.rows('SELECT * FROM analysis_overrides')),ownerBytes);
});
