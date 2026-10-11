import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { installSyncSchema } from '../src/sync/schema.js';
import { JobCoordinator } from '../src/sync/coordinator.js';
import { SyncError } from '../src/sync/errors.js';

const root = path.resolve('.');
async function fixture(nativeAlarms = false, freshDomain = false, runtimeOptions={}) {
  const modules = {};
  for (const name of ['schema','errors','coordinator','budget','runtime']) modules[`src/sync/${name}.js`] = {type:'esm',contents:await readFile(`src/sync/${name}.js`,'utf8')};
  modules['sync-test-worker.js'] = {type:'esm',contents:`
    import {JobCoordinator} from './src/sync/coordinator.js';
    import {createSyncRuntime,wakeSync} from './src/sync/runtime.js';
    import {SyncError} from './src/sync/errors.js';
    async function collector({db,lease,args,checkpoint}) {
      if(args.mode==='blocked')throw new SyncError('human_verification','secret upstream body must not be exposed',{kind:'blocked'});
      if(args.mode==='transient'&&lease.failures===0)throw new SyncError('rate_limited','private header',{retryAfterMs:25});
      const page=checkpoint.page||0;
      const statements=[{sql:'INSERT INTO source_sync_facts(id,value,saved_at) SELECT ?,?,? WHERE $FENCE ON CONFLICT(id) DO UPDATE SET value=excluded.value,saved_at=excluded.saved_at',params:[lease.resource_key+'/p'+page,'page-'+page,Date.now()]}];
      if(args.mode==='full-budget'){
        for(let i=0;i<9;i++)await db.prepare('SELECT 1').first();
        for(let i=1;i<32;i++)statements.push({sql:statements[0].sql,params:[lease.resource_key+'/p'+page+'/'+i,'page-'+page,Date.now()]});
      }
      const children=args.children&&page===0?Array.from({length:args.children},(_,i)=>({provider:'fake',component:'fixture',stage:'source',scope:'team-scope',resourceKey:'child-'+String(i).padStart(3,'0'),priority:i<5?80:20,args:{mode:i===72?'transient':i===73?'blocked':'okay'},subscriberMode:'inherit',intervalMs:3600000})):[];
      return {statements,children,checkpoint:{page:page+1},complete:page===1,coverage:page===1?'complete':'partial',rowsSaved:1,publishContent:lease.stage==='projection'};
    }
    export const SyncRuntime=createSyncRuntime(collector,{alarmDelayMs:2,leaseMs:1000,retryBaseMs:25,pageDelayMs:2,runtimeRetryMs:${runtimeOptions.runtimeRetryMs??50}});
    export default {async fetch(request,env){
      if(new URL(request.url).pathname==='/start'){
        const c=new JobCoordinator(env.DB);await c.enqueue(await request.json(),[{kind:'team',key:'attachment-a',teamId:'team-a'}]);await wakeSync(env);return Response.json({started:true});
      }
      return Response.json({error:'not_found'},{status:404});
    }};
  `};
  const mf = new Miniflare({telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'sync-test',compatibilityDate:'2026-09-09',manifest:{mainModule:'sync-test-worker.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'sync-test'},SYNC:{type:'durable-object',worker:'sync-test',exportName:'SyncRuntime'}},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}}}}]});
  await mf.ready;
  const db = await mf.getD1Database('DB','sync-test');
  if (freshDomain) {
    const {initializeDomain}=await import('../src/domain/schema.js'); await initializeDomain(db);
    await db.prepare('CREATE TABLE source_sync_facts(id TEXT PRIMARY KEY,value TEXT NOT NULL,saved_at INTEGER NOT NULL)').run();
  } else await db.batch([
    db.prepare('CREATE TABLE provider_accounts(id TEXT PRIMARY KEY,provider TEXT NOT NULL,generation INTEGER NOT NULL,active INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE app_teams(id TEXT PRIMARY KEY,name TEXT NOT NULL)'),
    db.prepare('CREATE TABLE team_read_state(app_team_id TEXT PRIMARY KEY REFERENCES app_teams(id),content_revision INTEGER NOT NULL DEFAULT 0,status_revision INTEGER NOT NULL DEFAULT 0,pending INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE TABLE source_sync_facts(id TEXT PRIMARY KEY,value TEXT NOT NULL,saved_at INTEGER NOT NULL)'),
    db.prepare("INSERT INTO app_teams VALUES('team-a','Team A'),('team-b','Team B')"),
    db.prepare("INSERT INTO team_read_state(app_team_id) VALUES('team-a'),('team-b')"),
    db.prepare("INSERT INTO provider_accounts VALUES('account-a','fake',1,1),('account-b','fake',1,1)"),
  ]);
  await installSyncSchema(db);
  return {mf,db,dispose:()=>mf.dispose()};
}
const subscriber = [{kind:'team',key:'attachment-a',teamId:'team-a'}];
const spec = (resourceKey='resource',extra={}) => ({provider:'fake',component:'events',scope:'source-team',resourceKey,intervalMs:3600000,...extra});
const page = (id,complete=false,extra={}) => ({statements:[{sql:'INSERT INTO source_sync_facts(id,value,saved_at) SELECT ?,?,? WHERE $FENCE ON CONFLICT(id) DO UPDATE SET value=excluded.value',params:[id,'saved',1]}],checkpoint:{page:complete?2:1},complete,rowsSaved:1,...extra});

test('a committed full-budget page rearms native alarms without a fictitious runtime failure',async()=>{
  const h=await fixture(true,false,{runtimeRetryMs:60000});try{
    await h.mf.dispatchFetch('https://sync-test/start',{method:'POST',body:JSON.stringify(spec('full-budget',{args:{mode:'full-budget'},recurring:false}))});
    const deadline=Date.now()+3000;let finished=false;
    while(Date.now()<deadline){const job=await h.db.prepare('SELECT state,pages_saved,last_error_code FROM sync_jobs').first();if(job.state==='ready'){finished=true;assert.equal(job.pages_saved,2);assert.equal(job.last_error_code,null);break;}await new Promise(resolve=>setTimeout(resolve,10));}
    assert.ok(finished,'checkpointed work must advance without the 60-second runtime recovery delay');
    const namespace=await h.mf.getDurableObjectNamespace('SYNC','sync-test'),stub=namespace.get(namespace.idFromName('scheduler'));
    const diagnostic=await (await stub.fetch(new Request('https://sync/status'))).json();assert.notEqual(diagnostic.state,'error');assert.ok([4,48].includes(diagnostic.statements),'last observation is the full-budget page or its subsequent idle check');
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM source_sync_facts').first()).n,64);
  }finally{await h.dispose();}
});

test('scoped deduplication and discovery demand do not create visible teams',async()=>{
  const h=await fixture();try{
    const c=new JobCoordinator(h.db);const a=await c.enqueue(spec('same',{accountId:'account-a',accountGeneration:1}),subscriber);
    assert.equal(await c.enqueue(spec('same',{accountId:'account-a',accountGeneration:1}),subscriber),a);
    const b=await c.enqueue(spec('same',{accountId:'account-b',accountGeneration:1}),subscriber);assert.notEqual(a,b);
    const catalog=await c.enqueue(spec('catalog',{accountId:'account-a',accountGeneration:1,component:'catalog',priority:100}),[{kind:'account',key:'account-a'}]);
    const lease=await c.claim();assert.equal(lease.id,catalog);await c.commit(lease,page('catalog',true));
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM app_teams').first()).count,2);
    assert.equal((await h.db.prepare("SELECT catalog_revision FROM sync_account_read_state WHERE account_id='account-a'").first()).catalog_revision,1);
    assert.equal((await c.status('team-a')).total,2);
  }finally{await h.dispose();}
});

test('source diagnostic audit is bounded, metadata-only, fenced and retained for fourteen days',async()=>{
  const h=await fixture();try{
    const now=Date.now(),c=new JobCoordinator(h.db,{clock:()=>now,pageDelayMs:1});
    const id=await c.enqueue(spec('audit'),subscriber),lease=await c.claim();
    const old=Array.from({length:600},(_,index)=>({id:'old-'+index,at:now-15*86400000}));
    await h.db.prepare("INSERT INTO sync_observations(id,job_id,scan_id,attempt,endpoint,status,at,bytes) SELECT json_extract(value,'$.id'),?,'old',1,'https://api.example.com/events',200,json_extract(value,'$.at'),1 FROM json_each(?)").bind(id,JSON.stringify(old)).run();
    const observation={endpoint:'https://api.example.com/events',params:{secret:'must-not-be-saved'},at:new Date(now-20).toISOString(),retrieved_at:new Date(now-10).toISOString(),status:200,bytes:123,hash:'a'.repeat(64),rows_count:1};
    assert.equal((await c.commit(lease,page('audited',false,{observations:[observation],retrievedAt:now-10}))).committed,true);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_observations').first()).count,101,'one page prunes at most 500 old rows');
    const saved=await h.db.prepare('SELECT * FROM sync_observations WHERE scan_id=?').bind(lease.scan_id).first();
    assert.equal(saved.endpoint,observation.endpoint);assert.equal(saved.retrieved_at,now-10);assert.equal(saved.content_hash,observation.hash);assert.equal(saved.attempt,1);assert.equal(JSON.stringify(saved).includes('must-not-be-saved'),false);
    const replay=await c.commit(lease,page('audit-replay',true,{observations:[observation]}));assert.equal(replay.committed,false);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_observations').first()).count,101,'lost lease cannot persist audit or prune retention');
    await c.retry(id);const failed=await c.claim();
    const failure=new SyncError('human_verification','secret body',{kind:'blocked'});failure.observations=[{...observation,status:403,hash:null,retrieved_at:null,rows_count:null,code:'human_verification'}];
    await c.fail(failed,failure);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_observations').first()).count,2);
    assert.equal((await h.db.prepare('SELECT checkpoint FROM sync_jobs WHERE id=?').bind(id).first()).checkpoint,'{"page":1}','failure retains saved checkpoint');
    const failedAudit=await h.db.prepare("SELECT error_code,retrieved_at FROM sync_observations WHERE status=403").first();assert.equal(failedAudit.error_code,'human_verification');assert.equal(failedAudit.retrieved_at,null);
    await c.retry(id);const unsafe=await c.claim();
    await assert.rejects(()=>c.commit(unsafe,page('unsafe',true,{observations:[{...observation,endpoint:'https://api.example.com/events?token=secret'}]})),error=>error.code==='contract_violation');
    assert.equal(await h.db.prepare("SELECT id FROM source_sync_facts WHERE id='unsafe'").first(),null,'unsafe audit aborts source checkpoint transaction');
  }finally{await h.dispose();}
});

test('checkpoint and source page survive crash, expired lease resumes, stale worker cannot commit',async()=>{
  const h=await fixture();try{
    let now=1000;const c=new JobCoordinator(h.db,{clock:()=>now,leaseMs:100,pageDelayMs:1});
    await c.enqueue(spec(),subscriber);const first=await c.claim();await c.commit(first,page('page-0'));
    now=1002;const crashed=await c.claim();assert.equal(crashed.checkpoint.page,1);
    // Simulate process loss after retrieval but before saving a page.
    now=1200;const resumed=await c.claim();assert.equal(resumed.checkpoint.page,1);assert.notEqual(resumed.lease_token,crashed.lease_token);
    assert.deepEqual(await c.commit(crashed,page('stale-page',true)),{state:'lease_lost',committed:false});
    assert.equal(await h.db.prepare("SELECT id FROM source_sync_facts WHERE id='stale-page'").first(),null);
    await c.commit(resumed,page('page-1',true));
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_sync_facts').first()).count,2);
    assert.equal((await c.status('team-a')).content_revision,0,'source writes cannot claim visible canonical content');
    assert.equal((await h.db.prepare('SELECT checkpoint FROM sync_jobs').first()).checkpoint,'{"page":2}');
    assert.equal((await c.commit(resumed,page('double-commit',true))).committed,false,'commit cannot be replayed after lease release');
  }finally{await h.dispose();}
});

test('claim and every affected status revision commit atomically',async()=>{
  const h=await fixture();try{
    const c=new JobCoordinator(h.db),id=await c.enqueue(spec('atomic-claim'),subscriber);
    await h.db.prepare("CREATE TRIGGER reject_claim_revision BEFORE UPDATE ON team_read_state BEGIN SELECT RAISE(ABORT,'status persistence unavailable'); END").run();
    await assert.rejects(()=>c.claim());
    assert.deepEqual(await h.db.prepare('SELECT state,attempts,lease_token,last_attempt_at FROM sync_jobs WHERE id=?').bind(id).first(),{state:'queued',attempts:0,lease_token:null,last_attempt_at:null},'failed revision write cannot leave an invisible running lease');
    await h.db.prepare('DROP TRIGGER reject_claim_revision').run();
    const before=await c.status('team-a'),lease=await c.claim(),after=await c.status('team-a');assert.equal(lease.id,id);assert.equal(after.status_revision,before.status_revision+1);assert.equal(after.groups.find(g=>g.state==='running').next_due_at,lease.lease_until,'running next wake is lease recovery, not a past queue timestamp');
  }finally{await h.dispose();}
});

test('account reconnect generation fences source data, children, and projections atomically',async()=>{
  const h=await fixture();try{
    const c=new JobCoordinator(h.db);await c.enqueue(spec('private',{accountId:'account-a',accountGeneration:1}),subscriber);
    const old=await c.claim();await h.db.prepare("UPDATE provider_accounts SET generation=2 WHERE id='account-a'").run();
    const result=page('old-private',true,{children:[{...spec('old-child'),subscriberMode:'inherit'}]});
    assert.equal((await c.commit(old,result)).committed,false);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_sync_facts').first()).count,0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_jobs').first()).count,1);
    await c.restartAccount('account-a');const fresh=await c.claim();assert.equal(fresh.authorization_generation,2);assert.equal(fresh.generation,2);
    await c.commit(fresh,page('fresh-private',true));
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_sync_facts').first()).count,1);
  }finally{await h.dispose();}
});

test('source transaction rollback retains checkpoint and demand when a page write fails',async()=>{
  const h=await fixture();try{
    const c=new JobCoordinator(h.db);await c.enqueue(spec(),subscriber);const lease=await c.claim();
    await assert.rejects(()=>c.commit(lease,{...page('first-write'),statements:[...page('first-write').statements,{sql:'INSERT INTO source_sync_facts(id,value,saved_at) SELECT ?,NULL,1 WHERE $FENCE',params:['invalid']}],children:[{...spec('child'),subscriberMode:'inherit'}]}));
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_sync_facts').first()).count,0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_jobs').first()).count,1);
    assert.equal((await h.db.prepare('SELECT checkpoint FROM sync_jobs').first()).checkpoint,'{}');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_commit_fences').first()).count,0);
  }finally{await h.dispose();}
});

test('child demand inherits current scope, narrowing cannot grant another team',async()=>{
  const h=await fixture();try{
    const c=new JobCoordinator(h.db);await c.enqueue(spec(),subscriber);const lease=await c.claim();
    await c.commit(lease,page('parent',true,{children:[{...spec('good-child'),subscriberMode:'inherit'},{...spec('foreign-child'),subscriberMode:'explicit',subscribers:[{kind:'team',key:'forbidden',teamId:'team-b'}]}]}));
    assert.equal((await c.status('team-a')).total,2);assert.equal((await c.status('team-b')).total,0);
    assert.equal((await c.claim()).resource_key,'good-child');
  }finally{await h.dispose();}
});

test('blocked source preserves coverage, independent work continues, retry recovery updates revisions',async()=>{
  const h=await fixture();try{
    let now=1000;const c=new JobCoordinator(h.db,{clock:()=>now,leaseMs:100,pageDelayMs:1,retryBaseMs:10});
    const blockedId=await c.enqueue(spec('blocked',{priority:80}),subscriber);await c.enqueue(spec('independent',{priority:20}),subscriber);
    const first=await c.claim();await c.commit(first,page('saved-partial'));
    now=1002;const block=await c.claim();await c.fail(block,new SyncError('human_verification','private response token',{kind:'blocked'}));
    const before=await c.status('team-a');assert.ok(before.groups.some(row=>row.state==='blocked'&&row.coverage==='partial'));
    assert.equal((await c.claim()).resource_key,'independent');
    assert.equal((await h.db.prepare('SELECT last_error_message FROM sync_jobs WHERE id=?').bind(blockedId).first()).last_error_message,'This source requires human verification.');
    await c.retry(blockedId);const after=await c.status('team-a');assert.ok(after.status_revision>before.status_revision);
    const recovered=await c.claim();assert.equal(recovered.id,blockedId);assert.equal(recovered.checkpoint.page,1);await c.commit(recovered,page('recovered',true));
    assert.equal((await h.db.prepare('SELECT failures,last_error_code FROM sync_jobs WHERE id=?').bind(blockedId).first()).failures,0);
  }finally{await h.dispose();}
});

test('truthful full-queue totals and revisions include later jobs, visible publication is separate',async()=>{
  const h=await fixture();try{
    const c=new JobCoordinator(h.db);
    for(let i=0;i<74;i++)await c.enqueue(spec('item-'+i,{priority:i===73?100:0}),subscriber);
    const initial=await c.status('team-a');assert.equal(initial.total,74);
    const last=await c.claim();assert.equal(last.resource_key,'item-73');await c.fail(last,new SyncError('unsupported_response','private data',{kind:'permanent'}));
    const changed=await c.status('team-a');assert.equal(changed.total,74);assert.ok(changed.status_revision>initial.status_revision);assert.ok(changed.groups.some(row=>row.state==='failed'&&row.count===1));
    await c.enqueue(spec('projection',{stage:'projection',priority:100}),subscriber);const projection=await c.claim();await c.commit(projection,{statements:[],checkpoint:{},complete:true,publishContent:true});
    assert.equal((await c.status('team-a')).content_revision,1);
  }finally{await h.dispose();}
});

test('native SQLite DO alarms process source pages and 74 children without browser or manual runner',async()=>{
  const h=await fixture(true);try{
    const started=Date.now();const response=await h.mf.dispatchFetch('http://localhost/start',{method:'POST',body:JSON.stringify(spec('root',{args:{children:74},priority:90}))});assert.equal(response.status,200);
    let complete=false;
    while(Date.now()-started<45000){
      const counts=await h.db.prepare("SELECT COUNT(*) AS total,SUM(state='ready') AS ready,SUM(state='blocked') AS blocked,SUM(state='failed') AS failed FROM sync_jobs").first();
      if(counts.total===75&&counts.ready===74&&counts.blocked===1){complete=true;break;}
      if(counts.failed)throw new Error('Native alarm collector failed.');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(complete,'native alarms reach terminal ready/blocked states');
    const c=new JobCoordinator(h.db),status=await c.status('team-a');assert.equal(status.total,75);assert.equal(status.content_revision,0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_sync_facts').first()).count,148);
    const firstChildren=(await h.db.prepare("SELECT id FROM source_sync_facts WHERE id LIKE 'child-%/p0' ORDER BY saved_at LIMIT 5").all()).results.map(row=>row.id);
    assert.ok(firstChildren.every(id=>Number(id.split('-')[1].split('/')[0])<5),'recent high-priority jobs run before history');
    assert.ok(status.groups.some(row=>row.state==='blocked'&&row.count===1));
    assert.equal((await h.db.prepare("SELECT last_error_code FROM sync_jobs WHERE resource_key='child-072'").first()).last_error_code,null,'temporary failure recovered');
    console.log(JSON.stringify({native_alarms:'PASS',browser_open:false,manual_runner_requests:0,total_jobs:status.total,ready_jobs:74,blocked_jobs:1,source_pages:148,elapsed_ms:Date.now()-started}));
  }finally{await h.dispose();}
});

test('exponential retry respects a longer provider wait and retains the saved checkpoint',async()=>{
  const h=await fixture();try{
    let now=1000;const c=new JobCoordinator(h.db,{clock:()=>now,retryBaseMs:10,retryMaxMs:20});
    const id=await c.enqueue(spec(),subscriber);const first=await c.claim();await c.fail(first,new SyncError('rate_limited','not public',{retryAfterMs:200}));
    assert.equal((await h.db.prepare('SELECT next_at,failures FROM sync_jobs WHERE id=?').bind(id).first()).next_at,1200);
    now=1201;const second=await c.claim();await c.fail(second,new SyncError('collector_timeout','private server'));assert.equal((await h.db.prepare('SELECT next_at FROM sync_jobs WHERE id=?').bind(id).first()).next_at,1221);
    now=1222;const third=await c.claim();await c.fail(third,new SyncError('collector_timeout','private server'));assert.equal((await h.db.prepare('SELECT next_at FROM sync_jobs WHERE id=?').bind(id).first()).next_at,1242);
  }finally{await h.dispose();}
});

test('priority aging prevents indefinite historical starvation',async()=>{
  const h=await fixture();try{
    let now=0;const c=new JobCoordinator(h.db,{clock:()=>now,ageMs:10});
    await c.enqueue(spec('history',{priority:10}),subscriber);now=1000;await c.enqueue(spec('recent',{priority:80}),subscriber);
    assert.equal((await c.claim()).resource_key,'history');
  }finally{await h.dispose();}
});

test('unlink cancels last demand, reattach reactivates work, account disconnect fences a running lease',async()=>{
  const h=await fixture();try{
    const c=new JobCoordinator(h.db);const id=await c.enqueue(spec(),subscriber);const prior=await c.claim();await c.unsubscribe('team','attachment-a');
    assert.equal((await c.commit(prior,page('unlinked',true))).committed,false);assert.equal(await c.nextWake(),null);
    assert.equal(await c.enqueue(spec(),subscriber),id);assert.ok(await c.claim());
    const privateId=await c.enqueue(spec('account',{accountId:'account-a',accountGeneration:1,priority:100}),subscriber);const privateLease=await c.claim();assert.equal(privateLease.id,privateId);
    await h.db.prepare("UPDATE provider_accounts SET active=0 WHERE id='account-a'").run();await c.deactivateAccount('account-a');
    assert.equal((await c.commit(privateLease,page('disconnected',true))).committed,false);
    assert.equal((await h.db.prepare('SELECT state FROM sync_jobs WHERE id=?').bind(privateId).first()).state,'disabled');
  }finally{await h.dispose();}
});

test('two coordinators cannot claim the same live lease',async()=>{
  const h=await fixture();try{
    const a=new JobCoordinator(h.db),b=new JobCoordinator(h.db);await a.enqueue(spec(),subscriber);
    const claims=await Promise.all([a.claim(),b.claim()]);assert.equal(claims.filter(Boolean).length,1);
  }finally{await h.dispose();}
});

test('page budget is checked before source writes and deferred work can recover',async()=>{
  const h=await fixture();try{
    const {BudgetDB}=await import('../src/sync/budget.js');const c=new JobCoordinator(h.db);const id=await c.enqueue(spec(),subscriber);
    const budget=new BudgetDB(h.db,12),bounded=new JobCoordinator(budget,{retryBaseMs:1});
    const result=await bounded.runOne(async()=>({...page('too-wide'),statements:Array.from({length:12},(_,i)=>page('wide-'+i).statements[0])}));
    assert.equal(result.state,'retrying');assert.equal(result.error.code,'invocation_budget');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_sync_facts').first()).count,0);assert.ok(budget.used<=12);
    await c.retry(id);const recovered=await c.claim();await c.commit(recovered,page('bounded',true));assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_sync_facts').first()).count,1);
  }finally{await h.dispose();}
});

test('retrieved, saved, completed timestamps and unavailable analysis coverage remain distinct',async()=>{
  const h=await fixture();try{
    let now=1000;const c=new JobCoordinator(h.db,{clock:()=>now,pageDelayMs:1});
    const id=await c.enqueue(spec('coverage'),subscriber);const first=await c.claim();await c.commit(first,page('retrieved',false,{retrievedAt:900}));
    let row=await h.db.prepare('SELECT last_attempt_at,last_retrieved_at,last_saved_at,last_complete_at FROM sync_jobs WHERE id=?').bind(id).first();
    assert.equal(row.last_attempt_at,1000);assert.equal(row.last_retrieved_at,900);assert.equal(row.last_saved_at,1000);assert.equal(row.last_complete_at,null);
    now=1002;const second=await c.claim();const failure=new SyncError('unsupported_response','private payload',{kind:'permanent'});failure.retrievedAt=1001;failure.coverage='unsupported';await c.fail(second,failure);
    row=await h.db.prepare('SELECT last_retrieved_at,last_saved_at,last_complete_at,coverage FROM sync_jobs WHERE id=?').bind(id).first();assert.equal(row.last_retrieved_at,1001);assert.equal(row.last_saved_at,1000);assert.equal(row.last_complete_at,null);assert.equal(row.coverage,'unsupported');
    const projectionId=await c.enqueue(spec('no-fetch',{stage:'projection',priority:100}),subscriber);await c.commit(await c.claim(),{statements:[],checkpoint:{},complete:true,publishContent:true});
    assert.equal((await h.db.prepare('SELECT last_retrieved_at FROM sync_jobs WHERE id=?').bind(projectionId).first()).last_retrieved_at,null,'local publication does not invent successful upstream retrieval');
    const unavailableId=await c.enqueue(spec('not-published',{stage:'analysis',priority:100}),subscriber);await c.commit(await c.claim(),{statements:[],checkpoint:{},complete:true,coverage:'unpublished',retrievedAt:1002});
    const unavailable=await h.db.prepare('SELECT state,coverage FROM sync_jobs WHERE id=?').bind(unavailableId).first();assert.deepEqual(unavailable,{state:'ready',coverage:'unpublished'});
    assert.ok((await c.status('team-a')).groups.some(group=>group.stage==='analysis'&&group.coverage==='unpublished'));
    const partialId=await c.enqueue(spec('derived-incomplete',{stage:'analysis',priority:100,recurring:false}),subscriber);await c.commit(await c.claim(),{statements:[],checkpoint:{},complete:true,coverage:'partial'});
    assert.deepEqual(await h.db.prepare('SELECT state,coverage,last_complete_at FROM sync_jobs WHERE id=?').bind(partialId).first(),{state:'ready',coverage:'partial',last_complete_at:1002},'finished scan does not claim complete analytical coverage');
  }finally{await h.dispose();}
});

test('fresh typed source save queues a fenced canonical projection and publishes updated totals once',async()=>{
  const h=await fixture(false,true);try{
    const {DomainRepository,sourceKey}=await import('../src/domain/repository.js');const repo=new DomainRepository(h.db),c=new JobCoordinator(h.db,{pageDelayMs:0});
    const team=await repo.createTeam({name:'Canonical U10',seasonYear:2026});const demand=[{kind:'team',key:'selected-gotsport-team',teamId:team.id}];
    const sourceTeam={id:'gotsport:212707',provider:'gotsport',native_id:'212707',name:'U10 White',details:'{}',archived:0,observed_at:'2026-10-10T12:00:00Z'};
    const fixture={id:'gotsport:27791413',provider:'gotsport',native_id:'27791413',home_id:'gotsport:212707',away_id:null,competition_id:null,division_id:null,starts_at:'2026-10-10T20:20:00Z',local_day:null,type:'game',status:'FINAL',conditional:0,home_score:2,away_score:1,payload:JSON.stringify({home_name:'U10 White',away_name:'Opponent'}),observed_at:'2026-10-10T12:00:00Z'};
    const sourceId=await c.enqueue({...spec('212707'),provider:'gotsport'},demand);let lease=await c.claim();
    let built=await repo.buildSourcePage({records:{teams:[sourceTeam]},fixtures:[fixture]});await c.commit(lease,{statements:built.statements,checkpoint:{},complete:true,retrievedAt:Date.now()});
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM team_events').first()).count,0,'a global public fixture identity does not publish or attach an app-team event');
    await repo.attachTeam({teamId:team.id,seasonId:team.season_id,sourceTeamId:sourceKey('gotsport','212707')});await repo.projectTeam(team.id,team.season_id);const before=await c.status(team.id);
    await c.retry(sourceId);lease=await c.claim();built=await repo.buildSourcePage({fixtures:[{...fixture,home_score:3,observed_at:'2026-10-11T12:00:00Z'}]});
    assert.equal(built.affectedTeams.length,1);
    await c.commit(lease,{statements:built.statements,checkpoint:{},complete:true,children:[{provider:'domain',component:'projection',stage:'projection',scope:team.id,resourceKey:team.season_id,args:{teamId:team.id,seasonId:team.season_id},priority:100,subscriberMode:'inherit'}]});
    assert.equal((await c.status(team.id)).content_revision,before.content_revision,'source freshness is not canonical publication');assert.equal((await c.status(team.id)).pending,1);
    let projection=await c.claim();assert.equal(projection.stage,'projection');let projected=await repo.buildProjection(team.id,team.season_id);
    // A second source save after snapshot calculation invalidates canonical publication.
    await repo.ingestSourcePage({fixtures:[{...fixture,home_score:4,observed_at:'2026-10-11T13:00:00Z'}]});
    await assert.rejects(()=>c.commit(projection,{statements:projected.statements,checkpoint:{},complete:true,publishContent:false}));
    assert.equal((await h.db.prepare('SELECT goals_for FROM team_events WHERE app_team_id=?').bind(team.id).first()).goals_for,2);
    assert.equal((await h.db.prepare('SELECT checkpoint FROM sync_jobs WHERE id=?').bind(projection.id).first()).checkpoint,'{}');
    await c.fail(projection,new SyncError('projection_input_changed','Recompute the projection.'));await c.retry(projection.id);projection=await c.claim();projected=await repo.buildProjection(team.id,team.season_id);
    assert.equal((await c.commit(projection,{statements:projected.statements,checkpoint:{},complete:true,publishContent:false})).committed,true);
    const after=await c.status(team.id);assert.ok(after.content_revision>before.content_revision);assert.equal(after.pending,0);
    const rows=(await h.db.prepare('SELECT goals_for,goals_against FROM team_events WHERE app_team_id=?').bind(team.id).all()).results;assert.deepEqual(rows,[{goals_for:4,goals_against:1}]);
  }finally{await h.dispose();}
});

test('projection child fan-out verifies pending team-season and cannot spoof source demand or bypass a lost fence',async()=>{
  const h=await fixture(false,true);try{
    const {DomainRepository}=await import('../src/domain/repository.js');const repo=new DomainRepository(h.db),c=new JobCoordinator(h.db);
    const a=await repo.createTeam({name:'A',seasonYear:2026}),b=await repo.createTeam({name:'B',seasonYear:2026});const demand=[{kind:'team',key:'attachment-a',teamId:a.id}];
    await c.enqueue(spec('fanout'),demand);const lease=await c.claim();
    const child=(team,season,extra={})=>({provider:'domain',component:'projection',stage:'projection',scope:team.id,resourceKey:season,args:{teamId:team.id,seasonId:season},recurring:false,subscriberMode:'projection',subscribers:[{kind:'team',key:'projection-'+team.id,teamId:team.id}],...extra});
    await assert.rejects(()=>c.commit(lease,page('spoof',true,{children:[child(b,b.season_id,{provider:'fake',stage:'source'})]})),error=>error.code==='contract_violation');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_sync_facts').first()).count,0);
    await c.commit(lease,page('fanout',true,{children:[child(b,b.season_id),child(a,b.season_id)]}));
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_jobs').first()).count,2,'mismatched team-season cannot enqueue');
    assert.equal((await c.status(b.id)).total,1,'verified pending projection reaches other attached season scope');
    const next=await c.claim();assert.equal(next.scope,b.id);await c.commit(next,{statements:[],checkpoint:{},complete:true});assert.equal(await c.claim(),null,'completed one-shot projection is not rerun');
    await c.enqueue(spec('stale'),demand);const stale=await c.claim();await c.unsubscribe('team','attachment-a');
    const before=(await h.db.prepare('SELECT COUNT(*) AS count FROM sync_jobs').first()).count;
    assert.equal((await c.commit(stale,page('lost-fence',true,{children:[child(a,a.season_id)]}))).committed,false);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_jobs').first()).count,before,'projection OR cannot bypass source lease fence');
  }finally{await h.dispose();}
});

test('set-based root enqueue fits request budget and export demand is owner-only in status summaries',async()=>{
  const h=await fixture();try{
    const {BudgetDB}=await import('../src/sync/budget.js');const bounded=new BudgetDB(h.db,12),c=new JobCoordinator(bounded);
    const ids=await c.enqueueMany(Array.from({length:5},(_,i)=>spec('root-'+i)),subscriber,{refresh:true});assert.equal(ids.length,5);assert.ok(bounded.used<=6);
    const raw=new JobCoordinator(h.db),exportId=await raw.enqueue({...spec('report'),provider:'reports',stage:'export',recurring:false,priority:100},subscriber);
    assert.equal((await raw.status('team-a')).total,5);assert.equal((await raw.status('team-a',{includeExports:true})).total,6);
    const lease=await raw.claim();assert.equal(lease.id,exportId);await raw.commit(lease,{statements:[],checkpoint:{},complete:true});
    await h.db.prepare("UPDATE sync_jobs SET next_at=0 WHERE id=?").bind(exportId).run();assert.notEqual((await raw.claim()).id,exportId,'completed export cannot become a recurring source job');
  }finally{await h.dispose();}
});

test('atomic demand admission cannot recreate deleting team work or propagate removed demand from a shared source',async()=>{
  const h=await fixture();try{
    const c=new JobCoordinator(h.db),both=[...subscriber,{kind:'team',key:'attachment-b',teamId:'team-b'}];
    await c.enqueue(spec('shared'),both);const lease=await c.claim();
    await h.db.prepare("INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES('team-a','deleting','2026-10-11T00:00:00Z')").run();
    await assert.rejects(c.enqueue(spec('late-report',{provider:'reports',stage:'export'}),subscriber),error=>error.code==='demand_unavailable');
    await assert.rejects(c.enqueueMany([spec('late-roster'),spec('late-events')],subscriber),error=>error.code==='demand_unavailable');
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM sync_jobs').first()).n,1);
    const child={...spec('shared-child'),subscriberMode:'inherit'},denied={...spec('denied-child'),subscriberMode:'explicit',subscribers:subscriber};
    assert.equal((await c.commit(lease,page('shared-page',true,{children:[child,denied]}))).committed,true);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE resource_key='denied-child'").first()).n,0);
    assert.deepEqual((await h.db.prepare("SELECT app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.resource_key='shared-child'").all()).results,[{app_team_id:'team-b'}]);
    const maintenance={provider:'maintenance',component:'team_delete',stage:'maintenance',scope:'team-a',resourceKey:'team-a',recurring:false};
    assert.ok(await c.enqueue(maintenance,[{kind:'team',key:'delete:team-a',teamId:'team-a'}]));
    await h.db.prepare("UPDATE team_lifecycle SET state='deleted' WHERE team_id='team-a'").run();
    await assert.rejects(c.enqueue(maintenance,[{kind:'team',key:'delete:team-a',teamId:'team-a'}]),error=>error.code==='demand_unavailable');
  }finally{await h.dispose();}
});
