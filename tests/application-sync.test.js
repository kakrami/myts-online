import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Response as MfResponse} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {initializeDomain} from '../src/domain/schema.js';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {SecurityStore,installSecuritySchema} from '../src/security/index.js';
import {installSyncSchema} from '../src/sync/schema.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {ApplicationSyncService,collectApplicationJob} from '../src/application/sync-service.js';
import {BudgetDB} from '../src/sync/budget.js';
import {SyncError} from '../src/sync/errors.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';

const collection=rows=>({collection:{items:rows.map(row=>({data:Object.entries(row).map(([name,value])=>({name,value}))})),links:[]}});
async function applicationFixture() {
  const root=path.resolve('.'),modules={},calls=[];let updated=false;
  for(const directory of ['domain','security','sync','sources','analysis','application'])for(const file of await readdir(`src/${directory}`,{recursive:true}))if(file.endsWith('.js')) {
    const name=`src/${directory}/${file}`;modules[name]={type:'esm',contents:await readFile(name,'utf8')};
  }
  modules['application-test-worker.js']={type:'esm',contents:`
    import {ApplicationSyncService,createApplicationRuntime} from './src/application/sync-service.js';
    import {BudgetDB} from './src/sync/budget.js';
    export const SyncRuntime=createApplicationRuntime({runtimeOptions:{alarmDelayMs:2,pageDelayMs:2,leaseMs:3000,retryBaseMs:10,runtimeRetryMs:20}});
    export default {scheduled(controller,env,ctx){const db=new BudgetDB(env.DB,48);db.reserve(6);ctx.waitUntil(new ApplicationSyncService(db,env).recoverDemand());},async fetch(request,env){
      const db=new BudgetDB(env.DB,48);db.reserve(6);const service=new ApplicationSyncService(db,env),path=new URL(request.url).pathname;
      try {
        if(path==='/recover')return Response.json(await service.recoverDemand());
        if(path==='/discovery')return Response.json(await service.enqueueDiscovery((await request.json()).accountId));
        if(path==='/attach')return Response.json(await service.attachSelected(await request.json()));
        if(path==='/refresh')return Response.json(await service.syncAttachment((await request.json()).attachmentId));
        return Response.json({error:'not_found'},{status:404});
      }catch(error){return Response.json({error:error.code||'failure',message:error.message},{status:500});}
    }};
  `};
  const mf=new Miniflare({telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'application-test',compatibilityDate:'2026-09-09',manifest:{mainModule:'application-test-worker.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'application-sync-test'},SYNC:{type:'durable-object',worker:'application-test',exportName:'SyncRuntime'},PROVIDER_FETCH:{type:'fetcher',handler:async request=>{
    const url=new URL(request.url);calls.push(url.pathname+url.search);
    if(url.hostname==='system.gotsport.com') {
      let value;
      if(url.pathname==='/api/v1/team_ranking_data/team_details')value={id:'212707',team_name:'Updated public team',club_name:''};
      else if(url.pathname==='/api/v1/team_ranking_data')value={team_ranking_data:{team_id:'212707'},events:[]};
      else if(url.pathname==='/api/v1/teams/212707/matches')value={matches:[],pagination:{current_page:1,total_pages:0,total_entries:0}};
      else throw new Error('Unexpected public endpoint '+url.pathname);
      return new MfResponse(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
    }
    assert.equal(url.hostname,'api.teamsnap.com');
    let rows;
    if(url.pathname==='/v3/me')rows=[{id:'99'}];
    else if(url.pathname==='/v3/teams/search')rows=Array.from({length:21},(_,i)=>({id:String(321+i),name:i===0?'U10 White':'Other owned '+i}));
    else if(url.pathname==='/v3/members/search')rows=[{id:'10',team_id:'321',first_name:'Test',last_name:'Player',jersey_number:'15',is_player:true}];
    else if(url.pathname==='/v3/events/search')rows=Array.from({length:151},(_,i)=>({id:String(4000+i),team_id:'321',name:updated&&i===150?'Updated game':'Game '+i,start_date:new Date(Date.UTC(2026,8,1)+i*3600000+(updated&&i===150?3600000:0)).toISOString(),is_game:true,home_or_away:'home',opponent_name:'Opponent '+i,points_for_team:updated&&i===150?4:2,points_for_opponent:1}));
    else if(['/v3/availabilities/search','/v3/locations/search','/v3/opponents/search'].includes(url.pathname))rows=[];
    else throw new Error('Unexpected source endpoint '+url.pathname);
    return new MfResponse(JSON.stringify(collection(rows)),{status:200,headers:{'Content-Type':'application/json'}});
  }}},exports:{SyncRuntime:{type:'durable-object',storage:'sqlite'}}}}]});
  await mf.ready;const db=await mf.getD1Database('DB','application-test');await initializeDomain(db);await installSecuritySchema(db);await installSyncSchema(db);await db.batch(ANALYSIS_SCHEMA.map(sql=>db.prepare(sql)));
  const repo=new DomainRepository(db),security=new SecurityStore(db,{bootstrapPassword:'isolated-native-test-password'});await security.initializeOwner('isolated-native-test-password');
  const account=await repo.registerAccount({provider:'teamsnap',nativeId:'99',name:'Native fixture account'});await security.storeAccountCredential(account.id,'synthetic-teamsnap-token',{generation:account.generation});
  async function action(path,body) {const response=await mf.dispatchFetch('http://localhost'+path,{method:'POST',body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
  async function waitFor(check,timeoutMs=10000) {const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(await check())return;const errors=(await db.prepare("SELECT component,scope,state,last_error_code,last_error_message FROM sync_jobs WHERE state IN ('failed','blocked','retrying')").all()).results;if(errors.length)throw new Error(JSON.stringify(errors));await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Native application alarms did not settle: '+JSON.stringify({jobs:(await db.prepare('SELECT component,state,generation,checkpoint,args,last_error_code FROM sync_jobs').all()).results,source:(await db.prepare("SELECT home_score FROM source_events WHERE native_id='4150'").all()).results,canonical:(await db.prepare("SELECT goals_for FROM team_events WHERE event_id IN(SELECT event_id FROM event_source_links WHERE source_event_id IN(SELECT id FROM source_events WHERE native_id='4150'))").all()).results}));}
  return {mf,db,repo,security,account,calls,action,waitFor,update:()=>{updated=true;},dispose:()=>mf.dispose()};
}

test('native source discovery, explicit attachment, canonical publication and later updates run without a browser',async()=>{
  const h=await applicationFixture();try{
    const started=Date.now();await h.action('/discovery',{accountId:h.account.id});
    await h.waitFor(async()=>!!await h.db.prepare("SELECT id FROM sync_jobs WHERE component='catalog' AND state='ready'").first());
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM app_teams').first()).count,0,'source discovery does not create app teams');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_events').first()).count,0,'discovery does not deeply import every owned team');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_jobs').first()).count,1);
    assert.ok((await h.db.prepare('SELECT pages_saved FROM sync_jobs').first()).pages_saved>=3,'native catalog checkpoint spans me and two team slices');
    const service=new ApplicationSyncService(h.db,{}),candidates=await service.candidates(h.account.id);assert.equal(candidates.length,21);
    const selected=candidates.find(row=>row.native_id==='321'),team=await h.repo.createTeam({name:'Canonical U10',seasonYear:2026});
    const attached=await h.action('/attach',{teamId:team.id,seasonId:team.season_id,sourceTeamId:selected.id,accountId:h.account.id});
    await h.waitFor(async()=>{
      const state=await h.db.prepare('SELECT pending FROM team_read_state WHERE app_team_id=?').bind(team.id).first();
      const jobs=await h.db.prepare("SELECT COUNT(*) AS count FROM sync_jobs WHERE state NOT IN ('ready','disabled')").first();
      const count=await h.db.prepare('SELECT COUNT(*) AS count FROM team_events WHERE app_team_id=?').bind(team.id).first();return state.pending===0&&jobs.count===0&&count.count===151;
    });
    const coordinator=new JobCoordinator(h.db),before=await coordinator.status(team.id);assert.ok(before.content_revision>0);assert.ok(before.total>=6);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM app_teams').first()).count,1);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM team_players WHERE app_team_id=?').bind(team.id).first()).count,1);
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS count FROM sync_jobs WHERE provider='analysis' AND component='match'").first()).count,0,'a TeamSnap-only season does not enqueue unsupported match analyses');
    const native=await h.db.prepare("SELECT last_retrieved_at,last_saved_at,last_complete_at,pages_saved FROM sync_jobs WHERE component='events'").first();assert.ok(native.pages_saved>=2);assert.ok(native.last_retrieved_at&&native.last_saved_at&&native.last_complete_at);
    const published=await h.db.prepare("SELECT pages_saved,checkpoint FROM sync_jobs WHERE provider='domain' AND component='projection'").first();assert.ok(published.pages_saved>10,'151-event canonical projection resumes across bounded identity/event/player pages');assert.equal(JSON.parse(published.checkpoint).finished,true);
    h.update();await h.action('/refresh',{attachmentId:attached.id});
    await h.waitFor(async()=>{const row=await h.db.prepare("SELECT e.title,e.starts_at FROM team_events e JOIN event_source_links l ON l.event_id=e.event_id JOIN source_events s ON s.id=l.source_event_id WHERE e.app_team_id=? AND s.native_id='4150'").bind(team.id).first();return row?.title==='Updated game'&&row.starts_at===new Date(Date.UTC(2026,8,1)+151*3600000).toISOString();});
    await h.waitFor(async()=>{const state=await h.db.prepare('SELECT pending FROM team_read_state WHERE app_team_id=?').bind(team.id).first(),jobs=await h.db.prepare("SELECT COUNT(*) count FROM sync_jobs WHERE state NOT IN('ready','disabled')").first();return state.pending===0&&jobs.count===0;});
    const after=await coordinator.status(team.id);assert.ok(after.content_revision>before.content_revision);assert.ok(after.status_revision>before.status_revision);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM team_events WHERE app_team_id=?').bind(team.id).first()).count,151,'refresh does not duplicate canonical events');
    console.log(JSON.stringify({application_sync:'PASS',browser_open:false,manual_runner_requests:0,provider:'synthetic-TeamSnap',discovered_native_teams:21,visible_app_teams:1,canonical_events:151,updated_native_schedule:true,teamsnap_final_scores_not_verified:true,source_requests:h.calls.length,source_audit_rows:(await h.db.prepare('SELECT COUNT(*) AS count FROM sync_observations').first()).count,api_statement_overhead_reserved:6,elapsed_ms:Date.now()-started}));
  }finally{await h.dispose();}
});

test('bounded recovery closes account authorization and projection enqueue crash windows',async()=>{
  const h=await applicationFixture();try{
    const team=await h.repo.createTeam({name:'Recovery team',seasonYear:2026});
    // Authorization and a domain mutation committed, then the request died before enqueue.
    await h.db.batch([
      h.db.prepare('UPDATE team_projection_state SET pending=1 WHERE team_season_id=?').bind(team.season_id),
      h.db.prepare('UPDATE team_read_state SET pending=1 WHERE app_team_id=?').bind(team.id),
    ]);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_jobs').first()).count,0);
    const recovered=await h.action('/recover',{});assert.equal(recovered.accountsQueued,1);assert.equal(recovered.projectionsQueued,1);
    await h.waitFor(async()=>{
      const state=await h.db.prepare('SELECT pending FROM team_read_state WHERE app_team_id=?').bind(team.id).first();
      const jobs=await h.db.prepare("SELECT COUNT(*) AS count FROM sync_jobs WHERE state NOT IN ('ready','disabled')").first();
      return state.pending===0&&jobs.count===0;
    });
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_teams').first()).count,21);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM source_events').first()).count,0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM app_teams').first()).count,1,'recovery discovery cannot make visible teams');
    const again=await h.action('/recover',{});assert.equal(again.accountsQueued,0);assert.equal(again.projectionsQueued,0);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_jobs').first()).count,3,'recovery is idempotent, including one bounded analysis catalog');
  }finally{await h.dispose();}
});

test('analysis catalog is scoped, resumable, bounded and prioritizes recent explicitly corrected matches',async()=>{
  const h=await applicationFixture();try{
    const team=await h.repo.createTeam({name:'Explicit analysis',seasonYear:2026});
    const fixtures=Array.from({length:50},(_,i)=>({provider:'gotsport',native_id:String(6000+i),home_id:'gotsport:212707',away_id:null,starts_at:i===0?'2026-08-01T20:00:00Z':i===1?'2027-02-01T20:00:00Z':new Date(Date.UTC(2026,9,1)+i*3600000).toISOString(),type:'game',status:'FINAL',conditional:0,home_score:2,away_score:1,payload:JSON.stringify({home_name:'Explicit analysis',away_name:'Opponent '+i}),observed_at:'2026-10-10T12:00:00Z'}));
    await h.repo.ingestSourcePage({records:{teams:[{provider:'gotsport',native_id:'212707',name:'Explicit analysis',details:'{}',archived:0,observed_at:'2026-10-10T12:00:00Z'}]},fixtures});
    const source=await h.db.prepare("SELECT id FROM source_teams WHERE provider='gotsport' AND native_id='212707'").first();
    await h.repo.attachTeam({teamId:team.id,seasonId:team.season_id,sourceTeamId:source.id});await h.repo.projectTeam(team.id,team.season_id);
    await h.db.prepare("INSERT INTO analysis_overrides(app_team_id,team_season_id,kind,event_id,player_id,fields,revision,updated_at) SELECT app_team_id,team_season_id,'match',event_id,'','{}',1,'2026-10-11T00:00:00Z' FROM team_events WHERE app_team_id=?").bind(team.id).run();
    const raw=new JobCoordinator(h.db);await raw.enqueue({provider:'analysis',component:'catalog',stage:'analysis',scope:team.id,resourceKey:team.season_id,args:{teamId:team.id,seasonId:team.season_id,requestId:'explicit-test'},priority:100,recurring:false},[{kind:'team',key:'analysis-test',teamId:team.id}]);
    for(let i=0;i<2;i++) {
      const db=new BudgetDB(h.db,48),jobs=new JobCoordinator(db,{pageDelayMs:0}),lease=await jobs.claim();assert.equal(lease.component,'catalog');
      const result=await collectApplicationJob({db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});assert.ok(result.children.length<=32);assert.equal(result.complete,i===1);
      assert.equal((await jobs.commit(lease,result)).committed,true);assert.ok(db.used<48);
    }
    const matches=(await h.db.prepare("SELECT j.priority,e.starts_at FROM sync_jobs j JOIN team_events e ON e.event_id=json_extract(j.args,'$.eventId') AND e.app_team_id=j.scope WHERE j.provider='analysis' AND j.component='match'").all()).results;
    assert.equal(matches.length,50);assert.equal(matches.find(v=>Date.parse(v.starts_at)===Date.parse(fixtures[0].starts_at)).priority,20);assert.equal(matches.find(v=>Date.parse(v.starts_at)===Date.parse(fixtures[1].starts_at)).priority,40);assert.ok(matches.filter(v=>v.priority===70).length===48);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS count FROM sync_job_subscribers WHERE app_team_id<>?').bind(team.id).first()).count,0);
    assert.equal((await h.db.prepare("SELECT pages_saved FROM sync_jobs WHERE provider='analysis' AND component='catalog'").first()).pages_saved,2);
  }finally{await h.dispose();}
});

test('credential backend failure is a retry, not a false sign-in rejection',async()=>{
  const h=await applicationFixture();try{
    const c=new JobCoordinator(h.db),id=await c.enqueue({provider:'teamsnap',accountId:h.account.id,accountGeneration:h.account.generation,component:'catalog',scope:h.account.id,resourceKey:h.account.id},[{kind:'account',key:h.account.id}]);
    const result=await c.runOne(context=>collectApplicationJob({...context,env:{}},{credentialLoader:async()=>{throw new SyncError('invocation_budget','Database request budget exhausted.');}}));
    assert.equal(result.state,'retrying');assert.equal(result.error.code,'invocation_budget');
    assert.equal((await h.db.prepare('SELECT state FROM sync_jobs WHERE id=?').bind(id).first()).state,'retrying');assert.equal(h.calls.length,0);
  }finally{await h.dispose();}
});

test('owner track refresh queues only the selected attached private match and account generation',async()=>{
  const h=await applicationFixture();try{
    const account=await h.repo.registerAccount({provider:'trace',nativeId:'own-user'}),team=await h.repo.createTeam({name:'Own Trace',seasonYear:2026});
    await h.repo.ingestSourcePage({accountId:account.id,generation:account.generation,records:{teams:[{provider:'trace',native_id:'400',name:'Own Trace',details:JSON.stringify({account_owned:true,slug:'own-trace'}),archived:0,observed_at:'2026-10-10T12:00:00Z'}]},fixtures:[{provider:'trace',native_id:'4001',home_id:'trace:400',away_id:null,starts_at:'2026-10-09T20:00:00Z',type:'game',status:'FINAL',conditional:0,home_score:2,away_score:1,payload:JSON.stringify({home_name:'Own Trace',away_name:'Other',approx_half_duration:25}),observed_at:'2026-10-10T12:00:00Z'}]});
    const source=await h.db.prepare("SELECT id FROM source_teams WHERE provider='trace' AND native_id='400' AND account_id=?").bind(account.id).first(),attachment=await h.repo.attachTeam({teamId:team.id,seasonId:team.season_id,sourceTeamId:source.id,accountId:account.id});await h.repo.projectTeam(team.id,team.season_id);
    const event=await h.db.prepare('SELECT event_id FROM team_events WHERE app_team_id=?').bind(team.id).first();
    const children=Array.from({length:5},(_,i)=>({provider:'trace',component:i<2?'tracking':'analytics',scope:`trace:4001:400:home:track1:${i}`,resourceKey:`trace:4001:400:home:track1:${i}`,args:{team_id:'400',game_id:'4001',side:'home',gid:'track1',player_id:'track:track1',gids:['track1']},accountId:account.id,accountGeneration:account.generation}));
    const db=new BudgetDB(h.db,48);db.reserve(20);const service=new ApplicationSyncService(db,{}, {wake:async()=>{}});
    await service.enqueueAnalysisRefresh({teamId:team.id,seasonId:team.season_id,eventId:event.event_id,sourceChildren:children});assert.ok(db.used<=48);
    const jobs=(await h.db.prepare("SELECT account_id,authorization_generation,priority,stage FROM sync_jobs WHERE provider='trace'").all()).results;assert.equal(jobs.length,5);assert.ok(jobs.every(j=>j.account_id===account.id&&j.authorization_generation===account.generation&&j.priority===80&&j.stage==='analysis'));
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM sync_job_subscribers WHERE demand_key=? AND app_team_id=?').bind(attachment.id,team.id).first()).n,5);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE provider='analysis' AND component='match'").first()).n,1);
    const rawService=new ApplicationSyncService(h.db,{}, {wake:async()=>{}}),request={teamId:team.id,seasonId:team.season_id,eventId:event.event_id};
    await assert.rejects(()=>rawService.enqueueTrackSource({...request,sourceChildren:children.map(c=>({...c,accountGeneration:account.generation+1}))}),error=>error.code==='invalid_job');
    await assert.rejects(()=>rawService.enqueueTrackSource({...request,sourceChildren:children.map(c=>({...c,args:{...c.args,side:'away'}}))}),error=>error.code==='invalid_job');
    const other=await h.repo.createTeam({name:'Unattached other',seasonYear:2026});await assert.rejects(()=>rawService.enqueueTrackSource({...request,teamId:other.id,seasonId:other.season_id,sourceChildren:children}),error=>error.code==='invalid_job');
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM sync_jobs').first()).n,6,'rejected scopes cannot grant private job demand');
  }finally{await h.dispose();}
});

test('recovery reduces projection fan-out to the remaining request budget after reconnecting accounts',async()=>{
  const h=await applicationFixture();try{
    const second=await h.repo.registerAccount({provider:'teamsnap',nativeId:'100'}),raw=new JobCoordinator(h.db);
    for(const account of [h.account,second]) {
      await raw.enqueue({provider:'teamsnap',accountId:account.id,accountGeneration:account.generation,component:'catalog',scope:account.id,resourceKey:account.id},[{kind:'account',key:account.id}]);
      const refreshed=await h.repo.registerAccount({provider:'teamsnap',nativeId:account.native_id});await h.security.storeAccountCredential(refreshed.id,'synthetic-token',{generation:refreshed.generation});
    }
    for(let i=0;i<4;i++)await h.repo.createTeam({name:'Pending '+i,seasonYear:2026});
    const db=new BudgetDB(h.db,48);db.reserve(6);
    const service=new ApplicationSyncService(db,{}, {wake:async()=>{}}),result=await service.recoverDemand();
    assert.equal(result.accountsQueued,2);assert.equal(result.projectionsQueued,2);assert.equal(result.more,true);assert.ok(db.used<=48);
    const nextDb=new BudgetDB(h.db,48);nextDb.reserve(6);const next=await new ApplicationSyncService(nextDb,{}, {wake:async()=>{}}).recoverDemand();
    assert.equal(next.accountsQueued,0);assert.equal(next.projectionsQueued,2);assert.ok(nextDb.used<=48);
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS count FROM sync_jobs WHERE provider='domain' AND component='projection'").first()).count,4);
  }finally{await h.dispose();}
});

test('more than 128 shared seasons commit source data and remaining fan-out recovers through native scheduled events',async()=>{
  const h=await applicationFixture();try{
    await h.repo.ingestSourcePage({records:{teams:[{provider:'gotsport',native_id:'212707',name:'Old public team',details:JSON.stringify({profile:true,club_name:'',logo:''}),archived:0,observed_at:'2026-10-10T12:00:00Z'}]},fixtures:[]});
    const teams=Array.from({length:131},(_,i)=>({id:crypto.randomUUID(),season:crypto.randomUUID(),attachment:crypto.randomUUID(),name:'Shared '+i})),data=JSON.stringify(teams),sourceId=sourceKey('gotsport','212707');
    await h.db.batch([
      h.db.prepare("INSERT INTO app_teams SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),'America/Los_Angeles',2026,NULL,'2026-10-11T00:00:00Z' FROM json_each(?)").bind(data),
      h.db.prepare("INSERT INTO team_seasons SELECT json_extract(value,'$.season'),json_extract(value,'$.id'),2026,'2026-06-01','2027-06-01','2026-06-01T07:00:00.000Z','2027-06-01T07:00:00.000Z',1 FROM json_each(?)").bind(data),
      h.db.prepare("INSERT INTO team_read_state(app_team_id,pending) SELECT json_extract(value,'$.id'),0 FROM json_each(?)").bind(data),
      h.db.prepare("INSERT INTO team_projection_state(team_season_id,app_team_id,pending,published_input_revision) SELECT json_extract(value,'$.season'),json_extract(value,'$.id'),0,0 FROM json_each(?)").bind(data),
      h.db.prepare("INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id) SELECT json_extract(value,'$.attachment'),json_extract(value,'$.id'),json_extract(value,'$.season'),? FROM json_each(?)").bind(sourceId,data),
    ]);
    await h.action('/refresh',{attachmentId:teams[0].attachment});
    await h.waitFor(async()=>{const row=await h.db.prepare("SELECT state FROM sync_jobs WHERE provider='gotsport' AND component='profile'").first(),pending=await h.db.prepare("SELECT COUNT(*) count FROM sync_jobs WHERE state NOT IN('ready','disabled')").first();return row?.state==='ready'&&pending.count===0;},30000);
    assert.equal((await h.db.prepare('SELECT name FROM source_teams WHERE id=?').bind(sourceId).first()).name,'Updated public team');
    assert.equal((await h.db.prepare('SELECT COUNT(*) count FROM team_projection_state WHERE pending=1').first()).count,5,'126 inline projections plus two native children fit the 128 child bound');
    const worker=await h.mf.getWorker('application-test');let ticks=0;
    for(;ticks<3;ticks++) {
      const pending=await h.db.prepare('SELECT COUNT(*) count FROM team_projection_state WHERE pending=1').first();if(!pending.count)break;
      assert.equal((await worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()})).outcome,'ok');
      await h.waitFor(async()=>!(await h.db.prepare("SELECT COUNT(*) count FROM sync_jobs WHERE state NOT IN('ready','disabled')").first()).count);
    }
    assert.equal((await h.db.prepare('SELECT COUNT(*) count FROM team_projection_state WHERE pending=1').first()).count,0);assert.equal(ticks,2);
    assert.equal((await h.db.prepare('SELECT COUNT(*) count FROM app_teams').first()).count,131,'account discovery in the scheduled fallback never adds app teams');
    console.log(JSON.stringify({large_projection_fanout:'PASS',affected_seasons:131,inline_projection_children:126,native_scheduled_events:ticks,browser_open:false,manual_runner_requests:0,production_cron_timing_not_verified:true}));
  }finally{await h.dispose();}
});
