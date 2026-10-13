import test from 'node:test';
import assert from 'node:assert/strict';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {collectApplicationJob} from '../src/application/sync-service.js';
import {buildConnectionPage} from '../src/domain/connection-materializer.js';
import {ReportingService} from '../src/reporting/service.js';
import {progressiveFixture as fixture,AT} from './fixtures/progressive-root-service-fixture.mjs';

const match={provider:'analysis',component:'match',stage:'analysis',scope:'team',resourceKey:'season:event',args:{teamId:'team',seasonId:'season',eventId:'event'},priority:70};
const publication={provider:'domain',component:'projection',stage:'projection',scope:'team',resourceKey:'season',args:{teamId:'team',seasonId:'season'},priority:100};
const options={dependencyFairness:true,publicHistory:true,clock:()=>AT,pageDelayMs:0};
const pending=f=>f.sqlite.exec("UPDATE team_projection_state SET pending=1,input_revision=input_revision+1 WHERE app_team_id='team' AND team_season_id='season'");
const accepted=f=>({match:f.rows('SELECT * FROM match_analysis'),players:f.rows('SELECT * FROM player_match_analysis ORDER BY run_id,player_id')});

test('pending saved match keeps its queue receipt and accepted output without claims or hot alarms',async t=>{
 const f=fixture(t);f.commit(await f.page());const id=await f.enqueue(match),before=accepted(f);pending(f);
 const queued=f.one('SELECT * FROM sync_jobs WHERE id=?',id),jobs=new JobCoordinator(f.db,{...options,ordinaryTurn:3});
 assert.equal(await jobs.claim(),null);assert.equal(await jobs.nextWake(),null);assert.deepEqual(f.one('SELECT * FROM sync_jobs WHERE id=?',id),queued);
 const Runtime=createSyncRuntime(()=>assert.fail('pending match must not collect'),{...options,reportFairness:true});
 await new Runtime(f.ctx,{DB:f.db}).run();assert.equal(f.values.get('last_run').state,'idle');assert.equal(f.values.has('alarm'),false);
 assert.deepEqual(f.one('SELECT * FROM sync_jobs WHERE id=?',id),queued);assert.deepEqual(accepted(f),before);assert.equal(f.one('SELECT published_run_id FROM team_projection_state').published_run_id,'team-run');
});

test('pending saved match does not mask the actual next publication wake',async t=>{
 const f=fixture(t),id=await f.enqueue(match);pending(f);const projection=await f.enqueue({...publication,nextAt:AT+2500});
 const jobs=new JobCoordinator(f.db,options);assert.equal(await jobs.claim(),null);assert.equal(await jobs.nextWake(),AT+2500);
 assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',id).attempts,0);assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',projection).attempts,0);
});

test('same-team settled season can receive analysis service while another season is pending',async t=>{
 const f=fixture(t),waiting=await f.enqueue(match);pending(f);
 f.insert('team_seasons',{...f.one("SELECT * FROM team_seasons WHERE id='season'"),id:'other-season',year:2027});
 f.insert('team_projection_state',{app_team_id:'team',team_season_id:'other-season',pending:0});
 const other=await f.enqueue({...match,resourceKey:'other-season:event',args:{...match.args,seasonId:'other-season'}}),jobs=new JobCoordinator(f.db,{...options,ordinaryTurn:3});
 assert.equal(await jobs.nextWake(),AT);assert.equal((await jobs.claim()).id,other);assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',waiting).attempts,0);
});

test('pending saved matches do not consume Reports or ordinary bulk service',async t=>{
 const f=fixture(t),waiting=await f.enqueue(match);pending(f);const bulk=await f.enqueue({resourceKey:'bulk'});
 const reports=new ReportingService(f.db,{coordinator:f.jobs,now:()=>AT,captureAtAdmission:false,queryBuilders:{matches:()=>({sql:"SELECT id,'2026-09-01' AS date,'Game' AS type,'Final' AS status,'Them' AS opponent,venue AS location,'Saved' AS source,'' AS competition,'2-1' AS score,'Win' AS result,NULL AS attendance FROM source_events ORDER BY id",params:[]})}});
 const report=(await reports.create({team_id:'team',team_season_id:'season'},{type:'matches'})).data,reportId=f.one("SELECT id FROM sync_jobs WHERE provider='reports' AND resource_key=?",report.snapshot_id).id;
 assert.equal((await new JobCoordinator(f.db,{...options,reportTurn:true,ordinaryTurn:3}).claim()).id,reportId);
 assert.equal((await new JobCoordinator(f.db,{...options,reportTurn:false,ordinaryTurn:3}).claim()).id,bulk);
 assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',waiting).attempts,0);
});

for(const [name,change]of [
 ['missing season',job=>({...job,args:{teamId:'team',eventId:'event'}})],
 ['nontext season',job=>({...job,args:{...job.args,seasonId:42}})],
 ['missing projection',job=>({...job,resourceKey:'absent:event',args:{...job.args,seasonId:'absent'}})],
 ['wrong resource',job=>({...job,resourceKey:'wrong'})],
 ['wrong team',job=>({...job,args:{...job.args,teamId:'other'}})],
 ['empty event',job=>({...job,resourceKey:'season:',args:{...job.args,eventId:''}})],
])test('pending eligibility leaves '+name+' to normal validation',async t=>{
 const f=fixture(t),id=await f.enqueue(change(match));pending(f);const jobs=new JobCoordinator(f.db,{...options,ordinaryTurn:3});assert.equal(await jobs.nextWake(),AT);assert.equal((await jobs.claim()).id,id);
});

test('generic coordinator without application fairness does not query projection state',async t=>{
 const f=fixture(t),id=await f.enqueue(match);pending(f);const prepare=f.db.prepare;f.db.prepare=sql=>{assert.ok(!sql.includes('team_projection_state'));return prepare(sql);};
 const jobs=new JobCoordinator(f.db,{clock:()=>AT});assert.equal(await jobs.nextWake(),AT);assert.equal((await jobs.claim()).id,id);
});

test('real projection publication automatically releases original queued analysis on durable continuation',async t=>{
 const f=fixture(t);f.commit(await f.page());const before=accepted(f),id=await f.enqueue(match);pending(f);const queued=f.one('SELECT * FROM sync_jobs WHERE id=?',id);
 // Materialize the existing synthetic root using its real bounded collector.
 // The actual projection and analysis below use ordinary durable job commits.
 let checkpoint={};for(let i=0;i<40;i++){const page=await buildConnectionPage(f.db,{connectionId:'root',teamId:'team',generation:1,checkpoint});f.commit(page);checkpoint=page.checkpoint;if(page.complete)break;assert.ok(i<39);}
 const projection=await f.enqueue(publication),seen=[];
 const Runtime=createSyncRuntime(async context=>{seen.push(context.lease.id);return collectApplicationJob(context);},{...options,dependencyFairness:true,reportFairness:true,statementLimit:50});
 let published=false;for(let i=0;i<80;i++){
  if(i)assert.ok(f.values.has('alarm'),'publication retains its durable continuation');
  await new Runtime(f.ctx,{DB:f.db}).run();const result=f.values.get('last_run');assert.ok(!['error','failed','retrying','blocked'].includes(result.state),JSON.stringify(result));assert.ok(result.statements<=50);
  if(f.one('SELECT pending FROM team_projection_state').pending){assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',id).attempts,0);assert.deepEqual(accepted(f),before);}else published=true;
  if(f.one('SELECT state FROM sync_jobs WHERE id=?',id).state==='ready')break;assert.ok(i<79,'original match must complete');
 }
 assert.ok(published);assert.notEqual(f.one('SELECT published_run_id FROM team_projection_state').published_run_id,'team-run');assert.equal(f.one('SELECT attempts FROM sync_jobs WHERE id=?',id).attempts,1);
 assert.equal(f.one('SELECT generation FROM sync_jobs WHERE id=?',id).generation,queued.generation);assert.equal(f.one('SELECT last_error_code FROM sync_jobs WHERE id=?',id).last_error_code,null);
 assert.ok(seen.indexOf(id)>seen.indexOf(projection));assert.ok(f.one('SELECT player_count FROM match_analysis').player_count>0);assert.deepEqual(f.rows('PRAGMA foreign_key_check'),[]);
});

for(const [name,mutation]of [
 ['pending transition',f=>pending(f)],
 ['pointer switch',f=>{f.insert('team_projection_runs',{id:'replacement',app_team_id:'team',team_season_id:'season',input_revision:1,state:'published',created_at:new Date(AT).toISOString()});f.sqlite.exec("UPDATE team_projection_state SET published_run_id='replacement'");}],
 ['account generation',f=>f.sqlite.exec('UPDATE provider_accounts SET generation=generation+1')],
 ['account revocation',f=>f.sqlite.exec('UPDATE provider_accounts SET active=0')],
])test('held claimed analysis still atomically rejects '+name,async t=>{
 const f=fixture(t),id=await f.enqueue(match),jobs=new JobCoordinator(f.db,{...options,ordinaryTurn:3}),lease=await jobs.claim();assert.equal(lease.id,id);
 const page=await collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});mutation(f);
 try{assert.equal((await jobs.commit(lease,page)).committed,false);}catch(error){assert.match(String(error),/CHECK/);}
 assert.equal(f.one('SELECT pages_saved FROM sync_jobs WHERE id=?',id).pages_saved,0);assert.equal(f.one('SELECT COUNT(*) n FROM match_analysis').n,0);assert.equal(f.one('SELECT COUNT(*) n FROM player_match_analysis').n,0);
});
