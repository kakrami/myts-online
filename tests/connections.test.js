import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {nativeCanonicalId} from '../src/domain/identity.js';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {initializeDomain} from '../src/domain/schema.js';
import {SecurityStore,installSecuritySchema} from '../src/security/index.js';
import {installSyncSchema} from '../src/sync/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {ApplicationSyncService,collectApplicationJob} from '../src/application/sync-service.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {UPGRADE_DDL,JOURNAL_GUARDS} from '../src/application/installation-epoch.js';
import {CATALOG_SCHEMA} from '../src/application/team-catalog.js';

// Real native D1 transactions and HTTP routes. Only delivery/commit faults and
// scheduler wake are injected; provider observations are synthetic fixtures.
const PASSWORD='connection-native-owner-password';
let mf,db,repo,security,cookie,maxQueries=0,maxRequestQueries=0;
test.before(async()=>{
  const root=path.resolve('.'),modules={};
  for(const file of (await readdir('src',{recursive:true})).filter(file=>file.endsWith('.js'))){const name='src/'+file;modules[name]={type:'esm',contents:await readFile(name,'utf8')};}
  modules['web/app/coach-tactics.js']={type:'esm',contents:await readFile(path.join(root,'web/app/coach-tactics.js'),'utf8')};
  modules['connection-test-worker.js']={type:'esm',contents:`
    import {applicationRoutes} from './src/application/routes.js';
    import {errorResponse} from './src/application/http.js';
    import {BudgetDB} from './src/sync/budget.js';
    import {wrapDatabase} from './src/application/installation-epoch.js';
    const wrap=(native,sql)=>({native,sql,bind(...args){return wrap(native.bind(...args),sql);},all(...args){return native.all(...args);},first(...args){return native.first(...args);},run(...args){return native.run(...args);}});
    export default {async fetch(request,env){
      const fault=request.headers.get('x-test-fault')||'',raw=env.DB;
      const adapter={prepare(sql){return wrap(raw.prepare(sql),sql);},async batch(statements){
        const connection=statements.some(s=>/INSERT INTO connection_command_receipts/.test(s.sql));
        if(connection&&fault==='session_revoke')await raw.prepare('UPDATE security_sessions SET revoked_at=1').run();
        if(connection&&fault==='delete_destination')await raw.prepare("INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES(?,'deleting','test')").bind(request.headers.get('x-test-team')).run();
        if(connection&&fault==='account_revoke')await raw.prepare('UPDATE provider_accounts SET active=0 WHERE id=?').bind(request.headers.get('x-test-account')).run();
        if(fault==='queue_failure'&&statements.some(s=>/INSERT INTO sync_jobs/.test(s.sql)))throw new Error('simulated queue failure');
        const native=statements.map(s=>s.native||s);
        if(connection&&['root_rollback','profile_rollback'].includes(fault)){
          const target=fault==='root_rollback'?'INSERT INTO team_source_connections':'INSERT INTO team_profiles';
          const index=statements.findIndex(s=>s.sql.includes(target));
          if(index<0)throw new Error('Test fault did not find its transaction statement');
          native[index]=raw.prepare("INSERT INTO feature_write_fences VALUES('simulated-rollback',0)");
        }
        const result=await raw.batch(native);
        if(connection&&fault==='post_commit_session_revoke')await raw.prepare('UPDATE security_sessions SET revoked_at=1').run();
        if(connection&&fault==='post_commit')throw new Error('simulated lost commit acknowledgement');
        return result;
      }};
      const budget=new BudgetDB(adapter);budget.reserve(2);
      let response;
      try{response=await applicationRoutes(request,{ADMIN_KEY:'${PASSWORD}'},{db:request.headers.get('x-test-epoch')==='1'?wrapDatabase(budget):budget,installation:{inspect:async()=>({state:'ready'})},syncOptions:{wake:async()=>{}}});}
      catch(error){response=errorResponse(error);}
      if(fault==='lost_response'&&response.status===202)response=Response.json({error:{code:'simulated_response_loss'}},{status:503});
      const headers=new Headers(response.headers);headers.set('x-test-queries',String(budget.used));
      return new Response(response.body,{status:response.status,headers});
    }};
  `};
  mf=new Miniflare({cf:false,telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'connection-test',compatibilityDate:'2026-09-09',manifest:{mainModule:'connection-test-worker.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'connection-test'}},exports:{}}}]});
  await mf.ready;db=await mf.getD1Database('DB','connection-test');
  await initializeDomain(db);await installSecuritySchema(db);await installSyncSchema(db);await db.batch([...TEAM_FEATURE_SCHEMA,...CATALOG_SCHEMA].map(sql=>db.prepare(sql)));
  await db.batch([db.prepare("CREATE TABLE setup_state(id INTEGER PRIMARY KEY,state TEXT NOT NULL,schema_fingerprint TEXT NOT NULL)"),db.prepare("INSERT INTO setup_state VALUES(1,'ready','connection-fixture')"),db.prepare(UPGRADE_DDL),...JOURNAL_GUARDS.map(sql=>db.prepare(sql)),db.prepare("INSERT INTO installation_upgrade(id,epoch,to_fingerprint,plan_hash,phase,started_at,completed_at,original_started_at,original_completed_at,original_cursor) VALUES(1,'team-connections-v1','connection-fixture','fixture','complete','fixture','fixture','fixture','fixture',0)")]);
  repo=new DomainRepository(db);security=new SecurityStore(db,{bootstrapPassword:PASSWORD});
  const session=await security.initializeOwner(PASSWORD);cookie='myts_session='+session.token;
});
test.after(async()=>{console.log(JSON.stringify({connection_max_queries:maxQueries,all_request_max_queries:maxRequestQueries,request_budget:48,native_d1:true,browser_used:false}));await mf?.dispose();});
async function request(body,{route='/api/connections',method='POST',fault='',headers={},signed=true}={}){
  const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{'Content-Type':'application/json',Origin:'http://localhost',...(signed?{Cookie:cookie}:{}),'x-test-fault':fault,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result={status:response.status,data:await response.json(),queries:Number(response.headers.get('x-test-queries'))};
  maxRequestQueries=Math.max(maxRequestQueries,result.queries);
  assert.notEqual(result.data.error?.code,'invocation_budget','No command, replay, guard failure or metadata read may exhaust its bounded invocation.');
  return result;
}
async function source({provider='gotsport',owned=true,club='Synthetic Club',provenance='provider',timezone=null}={}){
  const nativeId=crypto.randomUUID(),account=['trace','teamsnap'].includes(provider)?await repo.registerAccount({provider,nativeId:crypto.randomUUID()}):null;
  await repo.ingestSourcePage({accountId:account?.id??null,generation:account?.generation??null,provenance,records:{teams:[{provider,native_id:nativeId,name:'Discovered '+provider,club_id:club,details:{...(account?{account_owned:owned,slug:'synthetic-team'}:{}),...(timezone?{timezone}:{})}}]},fixtures:[]});
  return {id:sourceKey(provider,nativeId,account?.id??null),account};
}
function command(candidate,changes={}){return {request_id:crypto.randomUUID(),source_team_id:candidate.id,account_id:candidate.account?.id??null,new_team:{name:'New connected team',timezone:'America/Los_Angeles',kind:'own'},...changes};}
async function counts(){return db.prepare(`SELECT (SELECT count(*) FROM app_teams) teams,(SELECT count(*) FROM team_seasons) seasons,(SELECT count(*) FROM team_profiles) profiles,(SELECT count(*) FROM app_clubs) clubs,(SELECT count(*) FROM team_source_attachments) attachments,(SELECT count(*) FROM team_source_connections) connections,(SELECT count(*) FROM connection_command_receipts) receipts,(SELECT count(*) FROM team_read_state) reads,(SELECT count(*) FROM team_projection_state) projections,(SELECT count(*) FROM sync_jobs) jobs`).first();}
const accepted=result=>{maxQueries=Math.max(maxQueries,result.queries);assert.equal(result.status,202,JSON.stringify(result));assert.equal(result.data.queued,true);assert.ok(result.queries<=48);return result.data;};
const rootFor=id=>db.prepare('SELECT * FROM team_source_connections WHERE id=?').bind(id).first();
const receiptFor=id=>db.prepare('SELECT * FROM connection_command_receipts WHERE request_id=?').bind(id).first();
async function readReceipt(requestId,options={}){return request(undefined,{route:'/api/connections?request_id='+encodeURIComponent(requestId),method:'GET',...options});}
async function unlink(saved){return request({team_id:saved.team_id,generation:saved.connection.generation},{route:'/api/connections/'+saved.connection_id,method:'DELETE'});}

test('native HTTP onboarding begins with zero seasons and creates a team/root/profile/receipt plus import demand without a year',async()=>{
  assert.equal((await counts()).seasons,0);
  for(const provider of ['gotsport','teamsnap','trace']){
    const candidate=await source({provider}),body=command(candidate),result=accepted(await request(body));
    assert.equal(result.replayed,false);assert.equal(result.outcome,'created');assert.equal(result.season_id,null);
    assert.equal(result.connection.source_team_id,candidate.id);assert.equal(result.connection.account_id,candidate.account?.id??null);assert.equal(result.connection.scope_mode,'observed_history');
    const profile=await db.prepare('SELECT p.kind,c.external_key FROM team_profiles p JOIN app_clubs c ON c.id=p.club_id WHERE p.app_team_id=?').bind(result.team_id).first();
    assert.equal(profile.kind,'own');assert.equal(profile.external_key,provider+'/'+(candidate.account?.id??'public')+'/Synthetic Club');
    assert.equal((await db.prepare('SELECT season_year FROM app_teams WHERE id=?').bind(result.team_id).first()).season_year,0);
    assert.equal((await db.prepare("SELECT count(*) n FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.app_team_id=? AND j.stage='source'").bind(result.team_id).first()).n,provider==='teamsnap'?5:provider==='trace'?2:1);
    const receipt=await receiptFor(body.request_id);assert.equal(receipt.payload_version,2);assert.equal(receipt.payload_hash.length,64);assert.equal(receipt.connection_id,result.connection_id);
  }
  assert.equal((await counts()).seasons,0);assert.equal((await counts()).attachments,0);
});

test('root and profile failure roll back every new-team row and immutable receipt',async()=>{
  for(const fault of ['root_rollback','profile_rollback']){
    const body=command(await source({club:crypto.randomUUID()})),before=await counts(),result=await request(body,{fault});
    assert.notEqual(result.status,202);assert.deepEqual(await counts(),before);assert.equal(await receiptFor(body.request_id),null);
    accepted(await request(body));
  }
});

test('identical request races commit one logical team and receipt with no placeholder season',async()=>{
  const body=command(await source({provider:'teamsnap'})),before=await counts(),results=(await Promise.all([request(body),request(body)])).map(accepted);
  assert.equal(results[0].team_id,results[1].team_id);assert.equal(results[0].connection_id,results[1].connection_id);
  const after=await counts();for(const key of ['teams','profiles','connections','reads','receipts'])assert.equal(after[key],before[key]+1,key);
  for(const key of ['seasons','attachments','projections'])assert.equal(after[key],before[key],key);
});

test('two new request IDs racing the same exact source open one durable winner',async()=>{
  const candidate=await source(),first=command(candidate),second=command(candidate,{new_team:{name:'A different display name',timezone:'UTC',kind:'followed'}}),before=await counts();
  const results=(await Promise.all([request(first),request(second)])).map(accepted);
  assert.equal(results[0].team_id,results[1].team_id);assert.equal(results[0].connection_id,results[1].connection_id);
  assert.deepEqual(results.map(r=>r.outcome).sort(),['already_connected','created']);
  const after=await counts();assert.equal(after.teams,before.teams+1);assert.equal(after.connections,before.connections+1);assert.equal(after.receipts,before.receipts+2);assert.equal(after.seasons,before.seasons);
});

test('same request ID with different payload has one durable winner',async()=>{
  const first=command(await source()),other={...first,new_team:{...first.new_team,name:'Conflicting team'}};
  const results=await Promise.all([request(first),request(other)]);assert.deepEqual(results.map(r=>r.status).sort(),[202,409]);assert.equal(results.find(r=>r.status===409).data.error.code,'idempotency_conflict');
});

test('immutable receipt rejects changed source, account, destination, year, timezone or kind after a rename',async()=>{
  const body=command(await source()),saved=accepted(await request(body)),another=await source();
  await db.prepare('UPDATE app_teams SET name=? WHERE id=?').bind('Owner renamed it',saved.team_id).run();
  const variants=[{...body,source_team_id:another.id},{request_id:body.request_id,source_team_id:body.source_team_id,team_id:saved.team_id},...Object.entries({name:'Changed',season_year:2025,timezone:'UTC',kind:'followed'}).map(([key,value])=>({...body,new_team:{...body.new_team,[key]:value}}))];
  for(const changed of variants){const result=await request(changed);assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.data.error.code,'idempotency_conflict');}
  const privateSource=await source({provider:'trace'}),changed=await request({...body,source_team_id:privateSource.id,account_id:privateSource.account.id});assert.equal(changed.data.error.code,'idempotency_conflict');
  assert.equal(accepted(await request(body)).team_id,saved.team_id);
});

test('names never merge teams and explicit existing destination always wins over an exact match elsewhere',async()=>{
  const firstSource=await source(),secondSource=await source(),a=accepted(await request(command(firstSource))),b=accepted(await request(command(secondSource)));
  assert.notEqual(a.team_id,b.team_id);
  const existing={request_id:crypto.randomUUID(),source_team_id:firstSource.id,team_id:b.team_id};
  const connected=accepted(await request(existing));assert.equal(connected.team_id,b.team_id);assert.notEqual(connected.connection_id,a.connection_id);
  const ambiguous=await request(command(firstSource));assert.equal(ambiguous.status,409);assert.equal(ambiguous.data.error.code,'connection_destination_required');
});

test('exact source Add team reuse never changes the saved name or profile',async()=>{
  const candidate=await source(),saved=accepted(await request(command(candidate))),body=command(candidate,{new_team:{name:'Different name',timezone:'UTC',kind:'followed'}});
  const replay=accepted(await request(body));assert.equal(replay.outcome,'already_connected');assert.equal(replay.team_id,saved.team_id);
  const actual=await db.prepare('SELECT t.name,t.timezone,p.kind FROM app_teams t JOIN team_profiles p ON p.app_team_id=t.id WHERE t.id=?').bind(saved.team_id).first();
  assert.deepEqual(actual,{name:'New connected team',timezone:'America/Los_Angeles',kind:'own'});
});

test('removed roots reject an old receipt and fresh reconnect cannot revive the old generation',async()=>{
  const candidate=await source(),body=command(candidate),saved=accepted(await request(body));
  const removed=await unlink(saved);assert.equal(removed.status,200,JSON.stringify(removed));assert.equal((await db.prepare('SELECT pending FROM team_read_state WHERE app_team_id=?').bind(saved.team_id).first()).pending,0);
  const before=await counts(),retry=await request(body);assert.equal(retry.status,409);assert.equal(retry.data.error.code,'connection_unavailable');assert.deepEqual(await counts(),before);
  const fresh=accepted(await request({request_id:crypto.randomUUID(),source_team_id:candidate.id,team_id:saved.team_id}));assert.equal(fresh.connection_id,saved.connection_id);assert.ok(fresh.connection.generation>saved.connection.generation);
  const old=await request(body);assert.equal(old.status,409);assert.equal(old.data.error.code,'connection_unavailable');
  assert.equal((await readReceipt(body.request_id)).data.connection_active,false);
});

test('unlink atomically dirties remaining team roots so saved date authority converges without provider refresh',async()=>{
  const first=await source(),second=await source(),a=accepted(await request(command(first))),b=accepted(await request({request_id:crypto.randomUUID(),team_id:a.team_id,source_team_id:second.id}));
  await db.prepare('UPDATE team_source_connections SET reconciled_revision=input_revision WHERE app_team_id=?').bind(a.team_id).run();
  const before=await db.prepare('SELECT input_revision,reconciled_revision,generation FROM team_source_connections WHERE id=?').bind(b.connection_id).first();
  const jobs=(await db.prepare("SELECT j.id,j.generation,j.checkpoint FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.demand_key=? AND j.stage='source' ORDER BY j.id").bind('connection:'+b.connection_id).all()).results;
  assert.equal((await unlink(a)).status,200);
  const survivor=await db.prepare('SELECT input_revision,reconciled_revision,generation,active FROM team_source_connections WHERE id=?').bind(b.connection_id).first();
  assert.deepEqual(survivor,{...before,input_revision:before.input_revision+1,active:1});
  assert.deepEqual((await db.prepare("SELECT j.id,j.generation,j.checkpoint FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.demand_key=? AND j.stage='source' ORDER BY j.id").bind('connection:'+b.connection_id).all()).results,jobs);
  assert.equal((await db.prepare('SELECT pending FROM team_read_state WHERE app_team_id=?').bind(a.team_id).first()).pending,1);
});

test('lost HTTP response and uncertain D1 commit acknowledgements recover immutable zero-season identity',async()=>{
  const body=command(await source()),lost=await request(body,{fault:'lost_response'});assert.equal(lost.status,503);
  const committed=await receiptFor(body.request_id),before=await counts(),retry=accepted(await request(body));assert.equal(retry.replayed,true);assert.equal(retry.team_id,committed.team_id);assert.equal(retry.connection_id,committed.connection_id);assert.deepEqual(await counts(),before);
  const recovered=accepted(await request(command(await source()),{fault:'post_commit'}));assert.equal(recovered.replayed,true);
});

test('committed root with a post-commit queue failure is repaired by the original receipt',async()=>{
  const body=command(await source({provider:'teamsnap'})),failed=await request(body,{fault:'queue_failure'});assert.equal(failed.status,500);assert.equal(failed.data.queued,undefined);
  const committed=await receiptFor(body.request_id);assert.ok(committed);const before=await counts();
  const retry=accepted(await request(body));assert.equal(retry.team_id,committed.team_id);assert.equal(retry.replayed,true);assert.equal((await counts()).connections,before.connections);assert.equal((await counts()).seasons,before.seasons);
  assert.equal((await db.prepare("SELECT count(*) n FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE s.app_team_id=? AND j.stage='source'").bind(committed.team_id).first()).n,5);
});

test('source/account/owner/same-origin guards reject unauthorized commands before creation',async()=>{
  const pub=await source(),priv=await source({provider:'trace'}),unowned=await source({provider:'trace',owned:false}),file=await source({provenance:'file_import'});
  const requests=[()=>request(command(pub),{signed:false}),()=>request(command(pub),{headers:{'x-view-key':'read-only'}}),()=>request(command(pub),{headers:{Origin:'https://elsewhere.example'}}),()=>request(command(priv,{account_id:null})),()=>request(command(pub,{account_id:priv.account.id})),()=>request(command(unowned)),()=>request(command(file))];
  const before=await counts();for(const invoke of requests){const result=await invoke();assert.ok([401,403].includes(result.status),JSON.stringify(result));}assert.deepEqual(await counts(),before);
});

test('account and owner-session revocation at atomic commit cannot create an orphan',async()=>{
  const candidate=await source({provider:'trace'}),body=command(candidate),before=await counts();
  const result=await request(body,{fault:'account_revoke',headers:{'x-test-account':candidate.account.id}});assert.notEqual(result.status,202);assert.deepEqual(await counts(),before);
  const ownerBody=command(await source()),sessionResult=await request(ownerBody,{fault:'session_revoke'});assert.notEqual(sessionResult.status,202);assert.deepEqual(await counts(),before);
  const login=await security.login(PASSWORD);cookie='myts_session='+login.token;
});

test('session revoked after commit leaves saved identity but cannot queue work until sign-in',async()=>{
  const body=command(await source()),result=await request(body,{fault:'post_commit_session_revoke'});assert.equal(result.status,401,JSON.stringify(result));assert.ok(await receiptFor(body.request_id));
  const login=await security.login(PASSWORD);cookie='myts_session='+login.token;assert.equal(accepted(await request(body)).replayed,true);
});

test('deletion started between selection and commit prevents existing-team attachment',async()=>{
  const saved=accepted(await request(command(await source()))),candidate=await source(),body={request_id:crypto.randomUUID(),source_team_id:candidate.id,team_id:saved.team_id},before=await counts();
  const result=await request(body,{fault:'delete_destination',headers:{'x-test-team':saved.team_id}});assert.notEqual(result.status,202);assert.equal(await receiptFor(body.request_id),null);assert.deepEqual(await counts(),before);
});

test('existing-team verified club conflicts require the saved explicit choice',async()=>{
  const first=await source({club:'First verified club'}),second=await source({club:'Second verified club'}),saved=accepted(await request(command(first))),body={request_id:crypto.randomUUID(),team_id:saved.team_id,source_team_id:second.id};
  const conflict=await request(body);assert.equal(conflict.status,409);assert.equal(conflict.data.error.code,'club_choice_required');assert.equal(await receiptFor(body.request_id),null);
  const choice=conflict.data.error.details.club_choice,resolved=accepted(await request({...body,club_choice:{kind:choice.kind,keep:'source',...choice.expected}}));assert.equal(resolved.team_id,saved.team_id);
});

test('legacy explicit year retains fixed intent and scope widening requires a new explicit guarded command',async()=>{
  const candidate=await source(),body=command(candidate);body.new_team.season_year=2023;
  const saved=accepted(await request(body));assert.ok(saved.season_id);assert.equal(saved.connection.scope_mode,'fixed_seasons');
  const season=await db.prepare('SELECT year,include_june FROM team_seasons WHERE id=?').bind(saved.season_id).first();assert.equal(season.year,2023);assert.equal(season.include_june,0);
  const existing={request_id:crypto.randomUUID(),team_id:saved.team_id,source_team_id:candidate.id};assert.equal(accepted(await request(existing)).connection.scope_mode,'fixed_seasons');
  const addAgain=accepted(await request(command(candidate)));assert.equal(addAgain.team_id,saved.team_id);assert.equal(addAgain.connection.scope_mode,'fixed_seasons');
  const widening={...existing,request_id:crypto.randomUUID(),scope:{mode:'observed_history'}},missing=await request(widening);assert.equal(missing.status,409);assert.equal(missing.data.error.code,'connection_scope_confirmation_required');
  const expanded=accepted(await request({...widening,connection_generation:saved.connection.generation}));assert.equal(expanded.connection.scope_mode,'observed_history');assert.ok(expanded.connection.generation>saved.connection.generation);
  const old=await request(body);assert.equal(old.data.error.code,'connection_unavailable');
});

test('fixed scope rejects another teams season and same request scope changes conflict',async()=>{
  const a=accepted(await request(command(await source()))),b=await repo.createTeam({name:'Explicit fixed destination',timezone:'UTC',seasonYear:2022}),candidate=await source();
  const bad=await request({request_id:crypto.randomUUID(),team_id:a.team_id,source_team_id:candidate.id,scope:{mode:'fixed_seasons',season_ids:[b.season_id]}});assert.equal(bad.status,403);
  const body={request_id:crypto.randomUUID(),team_id:b.id,source_team_id:candidate.id,scope:{mode:'fixed_seasons',season_ids:[b.season_id]}},saved=accepted(await request(body));assert.equal(saved.connection.scope_mode,'fixed_seasons');
  const conflict=await request({...body,scope:{mode:'observed_history'}});assert.equal(conflict.data.error.code,'idempotency_conflict');
});

async function mutationSnapshot(){
  const tables=['app_teams','team_seasons','team_profiles','app_clubs','team_source_connections','connection_command_receipts','team_connection_seasons','team_source_attachments','team_read_state','team_projection_state','provider_accounts','account_source_teams','domain_installation','domain_fences','sync_jobs','sync_job_subscribers','catalog_state','team_catalog_state'];
  const result={};for(const table of tables)result[table]=(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results;return result;
}
test('read-only receipts remain truthful for zero seasons, revoked entitlements, disconnected accounts and inactive roots',async()=>{
  const candidate=await source({provider:'trace'}),body=command(candidate),saved=accepted(await request(body));
  await db.prepare('DELETE FROM account_source_teams WHERE account_id=? AND source_team_id=?').bind(candidate.account.id,candidate.id).run();
  let receipt=await readReceipt(body.request_id);assert.equal(receipt.data.team_available,true);assert.equal(receipt.data.season_id,null);assert.equal(receipt.data.connection_active,true);assert.equal(receipt.data.account_active,true);
  await repo.disconnectAccount(candidate.account.id);const before=await mutationSnapshot();receipt=await readReceipt(body.request_id);assert.equal(receipt.data.account_active,false);assert.equal(receipt.data.team_id,saved.team_id);assert.deepEqual(await mutationSnapshot(),before);
  assert.equal(Object.hasOwn(receipt.data,'queued'),false);assert.equal(Object.hasOwn(receipt.data,'source_team_id'),false);assert.equal(Object.hasOwn(receipt.data,'account_id'),false);
});
test('team deletion and physical root removal leave an immutable read-only receipt without resurrection',async()=>{
  const body=command(await source()),saved=accepted(await request(body));
  await db.prepare("INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES(?,'deleting','test')").bind(saved.team_id).run();
  let receipt=await readReceipt(body.request_id);assert.equal(receipt.data.team_available,false);
  await db.prepare('DELETE FROM team_source_connections WHERE id=?').bind(saved.connection_id).run();
  const before=await mutationSnapshot();receipt=await readReceipt(body.request_id);assert.equal(receipt.data.found,true);assert.equal(receipt.data.connection_id,saved.connection_id);assert.equal(receipt.data.connection_active,false);
  const retry=await request(body);assert.equal(retry.data.error.code,'connection_unavailable');assert.deepEqual(await mutationSnapshot(),before);
});
test('connection catalog includes a real zero-season team and uses typed root identity',async()=>{
  const saved=accepted(await request(command(await source()))),result=await request(undefined,{route:'/api/teams/'+saved.team_id+'/connections',method:'GET'});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.total,1);
  const row=result.data.items[0];assert.equal(row.connection_id,saved.connection_id);assert.equal(row.active,true);assert.equal(row.scope_mode,'observed_history');assert.deepEqual(row.seasons,[]);
});
test('zero-season metadata HTTP reads expose pending roots without requiring a selected season',async()=>{
  const saved=accepted(await request(command(await source())));
  for(const path of ['status','revisions','branding']){
    const result=await request(undefined,{route:'/api/'+path+'?team_id='+saved.team_id,method:'GET'});assert.equal(result.status,200,JSON.stringify({path,...result}));
    if(path==='status'){assert.equal(result.data.selection.team_season_id,null);assert.equal(result.data.data.season_resolution.state,'pending');assert.equal(result.data.data.connections[0].id,saved.connection_id);assert.deepEqual(result.data.data.attachments,[]);}
  }
});
test('receipt reads require an owner session and bounded request ID without mutations',async()=>{
  const before=await mutationSnapshot();
  for(const options of [{signed:false},{headers:{'x-view-key':'viewer-only'}},{headers:{Cookie:'myts_session=invalid'}}]){const result=await readReceipt(crypto.randomUUID(),options);assert.equal(result.status,401,JSON.stringify(result));}
  for(const value of ['', 'a'.repeat(129), 'invalid/key'])assert.equal((await readReceipt(value)).status,400);
  assert.deepEqual((await readReceipt(crypto.randomUUID())).data,{found:false});assert.deepEqual(await mutationSnapshot(),before);
});


test('migrated v1 receipts validate the original command identity and original attachment activity',async()=>{
  const candidate=await source(),body=command(candidate);body.new_team.season_year=2021;
  const saved=accepted(await request(body)),attachmentId=await nativeCanonicalId('connection-attachment',saved.team_id);
  await db.prepare('DELETE FROM team_source_attachments WHERE app_team_id=? AND team_season_id=?').bind(saved.team_id,saved.season_id).run();
  await db.prepare('INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id,account_id) VALUES(?,?,?,?,NULL)').bind(attachmentId,saved.team_id,saved.season_id,candidate.id).run();
  await db.prepare('UPDATE connection_command_receipts SET payload_version=1,payload_hash=NULL WHERE request_id=?').bind(body.request_id).run();
  await db.prepare('UPDATE app_teams SET name=? WHERE id=?').bind('Later owner name',saved.team_id).run();
  assert.equal(accepted(await request(body)).replayed,true);
  const changed=await request({...body,new_team:{...body.new_team,name:'Different original name'}});assert.equal(changed.data.error.code,'idempotency_conflict');
  let receipt=(await readReceipt(body.request_id)).data;assert.equal(receipt.attachment_id,attachmentId);assert.equal(receipt.connection_active,true);
  await db.prepare('UPDATE team_source_attachments SET active=0,generation=generation+1 WHERE id=?').bind(attachmentId).run();
  assert.equal((await rootFor(saved.connection_id)).active,1);
  receipt=(await readReceipt(body.request_id)).data;assert.equal(receipt.connection_active,false);assert.equal(receipt.attachment_active,false);
  assert.equal((await request(body)).data.error.code,'connection_unavailable');
});

test('explicit season exclusion survives scope widening, unlink and a new connection request',async()=>{
  const candidate=await source(),body=command(candidate);body.new_team.season_year=2020;
  const saved=accepted(await request(body));
  await db.prepare('UPDATE team_connection_seasons SET excluded=1,active=0 WHERE connection_id=? AND team_season_id=?').bind(saved.connection_id,saved.season_id).run();
  const widened=accepted(await request({request_id:crypto.randomUUID(),source_team_id:candidate.id,team_id:saved.team_id,scope:{mode:'observed_history'},connection_generation:saved.connection.generation}));
  const removed=await unlink(widened);assert.equal(removed.status,200,JSON.stringify(removed));
  const restored=accepted(await request({request_id:crypto.randomUUID(),source_team_id:candidate.id,team_id:saved.team_id}));assert.equal(restored.connection.scope_mode,'observed_history');
  const excluded=await db.prepare('SELECT excluded,active FROM team_connection_seasons WHERE connection_id=? AND team_season_id=?').bind(saved.connection_id,saved.season_id).first();assert.deepEqual(excluded,{excluded:1,active:0});
});


test('legacy pending attachment HTTP commands have durable fixed-root receipts and exact lost-response recovery',async()=>{
  const team=await repo.createTeam({name:'Legacy destination',timezone:'UTC',seasonYear:2024}),candidate=await source(),route='/api/teams/'+team.id+'/attachments';
  const body={request_id:crypto.randomUUID(),source_team_id:candidate.id,season_id:team.season_id,kind:'own'};
  const first=await request(body,{route,fault:'lost_response'});assert.equal(first.status,503);
  const receipt=await receiptFor(body.request_id);assert.ok(receipt);
  const retry=accepted(await request(body,{route}));assert.equal(retry.replayed,true);assert.equal(retry.team_id,team.id);assert.equal(retry.connection.scope_mode,'fixed_seasons');assert.equal(retry.attachment.team_season_id,team.season_id);
  const next=await repo.ensureSeason(team.id,2025),additional={...body,request_id:crypto.randomUUID(),season_id:next.id};
  const missing=await request(additional,{route});assert.equal(missing.status,409);assert.equal(missing.data.error.code,'connection_scope_confirmation_required');
  const extended=accepted(await request({...additional,connection_generation:retry.connection.generation},{route}));assert.equal(extended.attachment.team_season_id,next.id);
  const rows=(await db.prepare('SELECT team_season_id FROM team_connection_seasons WHERE connection_id=? AND active=1 ORDER BY team_season_id').bind(retry.connection_id).all()).results;assert.deepEqual(rows.map(row=>row.team_season_id).sort(),[team.season_id,next.id].sort());
});

test('fixed file-import roots reconcile saved evidence without gaining provider collection jobs',async()=>{
  for(const provider of ['gotsport','trace']){
    const candidate=await source({provider,provenance:'file_import',owned:false}),team=await repo.createTeam({name:'Imported fixed history',seasonYear:2022}),rootId=crypto.randomUUID(),attachmentId=crypto.randomUUID();
    await db.prepare("INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,scope_origin,created_at) VALUES(?,?,?,?,'fixed_seasons','legacy_ambiguous','fixture')").bind(rootId,team.id,candidate.id,candidate.account?.id??null).run();
    await db.prepare('INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id,account_id) VALUES(?,?,?,?,?)').bind(attachmentId,team.id,team.season_id,candidate.id,candidate.account?.id??null).run();
    const unmappedRefresh=await request({}, {route:'/api/attachments/'+attachmentId+'/sync'});assert.notEqual(unmappedRefresh.status,202);assert.equal(unmappedRefresh.data.error.code,'source_scope');
    await db.prepare("INSERT INTO team_connection_seasons(connection_id,team_season_id,attachment_id,basis) VALUES(?,?,?,'fixed')").bind(rootId,team.season_id,attachmentId).run();
    const sync=new ApplicationSyncService(db,{}, {wake:async()=>{}}),result=await sync.syncConnection(rootId,{wake:false});assert.equal(result.jobIds.length,1);
    const jobs=(await db.prepare('SELECT j.provider,j.component FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.app_team_id=?').bind(team.id).all()).results;assert.deepEqual(jobs,[{provider:'domain',component:'connection'}]);
    await sync.recoverConnections({limit:3,wake:false});
    assert.equal((await db.prepare("SELECT count(*) n FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.app_team_id=? AND j.provider<>'domain'").bind(team.id).first()).n,0);
    const legacyRefresh=await request({}, {route:'/api/attachments/'+attachmentId+'/sync'});assert.equal(legacyRefresh.status,202,JSON.stringify(legacyRefresh));assert.equal(legacyRefresh.data.source_collection_blocked,'file_import');
    assert.equal((await db.prepare("SELECT count(*) n FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.app_team_id=? AND j.provider<>'domain'").bind(team.id).first()).n,0,'legacy attachment refresh cannot grant collection authority either');
  }
});

test('scheduled root recovery repairs interrupted queue admission without changing provider checkpoints',async()=>{
  const candidate=await source({provider:'teamsnap'}),body=command(candidate),failed=await request(body,{fault:'queue_failure'});assert.equal(failed.status,500);
  const receipt=await receiptFor(body.request_id),sync=new ApplicationSyncService(db,{}, {wake:async()=>{}});
  for(let i=0;i<4&&!await db.prepare("SELECT 1 FROM sync_job_subscribers WHERE demand_key=?").bind('connection:'+receipt.connection_id).first();i++)await sync.recoverConnections({limit:3,wake:false});
  const rows=(await db.prepare("SELECT j.id,j.provider,j.checkpoint FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.demand_key=?").bind('connection:'+receipt.connection_id).all()).results;assert.equal(rows.length,6);
  await db.prepare(`UPDATE sync_jobs SET state='ready',checkpoint='{"finished":true}',scan_id='preserved-import' WHERE id IN(SELECT job_id FROM sync_job_subscribers WHERE demand_key=?) AND stage='source'`).bind('connection:'+receipt.connection_id).run();
  accepted(await request(body));
  const sources=(await db.prepare("SELECT j.checkpoint,j.scan_id,j.state FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.demand_key=? AND j.stage='source'").bind('connection:'+receipt.connection_id).all()).results;
  assert.equal(sources.length,5);for(const row of sources)assert.deepEqual(row,{checkpoint:'{"finished":true}',scan_id:'preserved-import',state:'ready'});
});

test('initial reconciliation stays ahead of history until a real seasonal view is published',async()=>{
  const candidate=await source(),saved=accepted(await request(command(candidate))),sync=new ApplicationSyncService(db,{}, {wake:async()=>{}});
  const priorities=async()=>Object.fromEntries((await db.prepare("SELECT j.component,j.priority FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.demand_key=?").bind('connection:'+saved.connection_id).all()).results.map(row=>[row.component,row.priority]));
  assert.deepEqual(await priorities(),{profile:97,connection:90});
  await db.prepare('UPDATE team_source_connections SET reconciled_revision=input_revision WHERE id=?').bind(saved.connection_id).run();
  await sync.syncConnection(saved.connection_id,{wake:false});assert.equal((await priorities()).connection,90,'a finished empty scan is not useful publication');
  const season=await repo.ensureSeason(saved.team_id,2025);
  await db.prepare("INSERT INTO team_connection_seasons(connection_id,team_season_id,basis) VALUES(?,?,'dated_metadata')").bind(saved.connection_id,season.id).run();
  await sync.syncConnection(saved.connection_id,{wake:false});assert.equal((await priorities()).connection,90,'an unfinished seasonal projection must keep its first-pass priority');
  await db.prepare('UPDATE team_projection_state SET published_input_revision=input_revision WHERE team_season_id=?').bind(season.id).run();
  await sync.syncConnection(saved.connection_id,{wake:false});assert.equal((await priorities()).connection,20,'later bulk archive pages coalesce behind saved history work');
});


test('device timezone is only a hint: verified team timezone controls new-team June boundary',async()=>{
  const candidate=await source({timezone:'America/Los_Angeles'}),body=command(candidate,{new_team:{name:'Pacific team',timezone:'UTC',timezone_source:'device',kind:'own'}}),saved=accepted(await request(body));
  const team=await repo.team(saved.team_id);assert.equal(team.timezone,'America/Los_Angeles');assert.equal(saved.season_id,null);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:team.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date('2026-06-01T04:00:00Z')).map(part=>[part.type,part.value]));assert.equal(parts.month+'-'+parts.day,'05-31');
  const explicit=await source({timezone:'America/Los_Angeles'}),owner=accepted(await request(command(explicit,{new_team:{name:'Owner timezone',timezone:'UTC',timezone_source:'owner',kind:'own'}})));assert.equal((await repo.team(owner.team_id)).timezone,'UTC');
  assert.equal(accepted(await request(body)).team_id,saved.team_id);
});

test('disconnected or unentitled private roots retain local reconciliation without new provider admission',async()=>{
  for(const mode of ['disconnected','unentitled']){
    const candidate=await source({provider:'trace'}),saved=accepted(await request(command(candidate))),sync=new ApplicationSyncService(db,{}, {wake:async()=>{}});
    if(mode==='disconnected')await repo.disconnectAccount(candidate.account.id);else await db.prepare('DELETE FROM account_source_teams WHERE account_id=? AND source_team_id=?').bind(candidate.account.id,candidate.id).run();
    assert.deepEqual(await db.prepare('SELECT active,generation FROM team_source_connections WHERE id=?').bind(saved.connection_id).first(),{active:1,generation:saved.connection.generation},'account collection authority is separate from saved root evidence authority');
    const before=(await db.prepare("SELECT id,generation,authorization_generation,checkpoint FROM sync_jobs WHERE account_id=? ORDER BY id").bind(candidate.account.id).all()).results;
    const result=await sync.syncConnection(saved.connection_id,{wake:false,generation:saved.connection.generation});assert.equal(result.jobIds.length,1);assert.equal(result.source_collection_blocked,mode==='disconnected'?'account_unavailable':'source_scope');
    assert.deepEqual((await db.prepare("SELECT id,generation,authorization_generation,checkpoint FROM sync_jobs WHERE account_id=? ORDER BY id").bind(candidate.account.id).all()).results,before);
    const local=await db.prepare('SELECT provider,component FROM sync_jobs WHERE id=?').bind(result.jobIds[0]).first();assert.deepEqual(local,{provider:'domain',component:'connection'});
  }
});

test('pending roster metadata is bounded, evidence-qualified and hidden from viewers',async()=>{
  const candidate=await source({provider:'teamsnap'}),nativeTeam=candidate.id.split('/').at(-1),players=Array.from({length:25},(_,index)=>({provider:'teamsnap',native_id:'pending-'+index,name:'Pending player '+index,jersey:String(index+1),details:{}}));
  await repo.ingestSourcePage({accountId:candidate.account.id,generation:candidate.account.generation,records:{players,team_players:players.map(player=>({team_id:'teamsnap:'+nativeTeam,player_id:'teamsnap:'+player.native_id,active:true}))},fixtures:[]});
  const saved=accepted(await request(command(candidate))),route='/api/teams/'+saved.team_id+'/connections';
  let catalog=await request(undefined,{route,method:'GET'});assert.equal(catalog.status,200,JSON.stringify(catalog));let pending=catalog.data.items[0].pending_roster;
  assert.equal(pending.total,25);assert.equal(pending.items.length,20);assert.equal(pending.truncated,true);for(const item of pending.items)assert.deepEqual(Object.keys(item).sort(),['name','source_player_id']);
  const season=await repo.ensureSeason(saved.team_id,2023),playerId=sourceKey('teamsnap','pending-0',candidate.account.id);
  await db.prepare("INSERT INTO connection_roster_evidence(connection_id,team_season_id,source_player_id,basis_key,basis,valid_from,valid_until,name,observed_at,source_hash) VALUES(?,?,?,'native-dated-roster','dated_roster','2023-07-01','2024-05-31','Historical name','fixture','fixture')").bind(saved.connection_id,season.id,playerId).run();
  catalog=await request(undefined,{route,method:'GET'});pending=catalog.data.items[0].pending_roster;assert.equal(pending.total,24);assert.equal(pending.items.some(item=>item.source_player_id===playerId),false);
  const ownerStatus=await request(undefined,{route:'/api/status?team_id='+saved.team_id,method:'GET'});assert.equal(ownerStatus.status,200,JSON.stringify(ownerStatus));assert.equal(ownerStatus.data.data.pending_roster.total,24);assert.ok(ownerStatus.data.data.evidence);
  const viewer=await security.createViewerToken(cookie.slice('myts_session='.length),saved.team_id,{categories:['overview']});
  const publicStatus=await request(undefined,{route:'/api/status?team_id='+saved.team_id,method:'GET',signed:false,headers:{'x-view-key':viewer.token}});assert.equal(publicStatus.status,200,JSON.stringify(publicStatus));
  for(const key of ['pending_roster','roster_review','evidence','connections','attachments','jobs'])assert.equal(Object.hasOwn(publicStatus.data.data,key),false,key);
});

test('scope conflicts expose bounded validated desired years and keep pending roots reviewable',async()=>{
  const candidate=await source(),nativeTeam=candidate.id.split('/').at(-1),saved=accepted(await request(command(candidate)));
  const dates=['2027-05-31','2027-06-01','bad-date','2027-99-99','1999-06-01','2102-06-01',...Array.from({length:21},(_,i)=>`${2000+i}-07-01`)];
  const fixtures=dates.map(()=>({provider:'gotsport',native_id:crypto.randomUUID(),home_id:'gotsport:'+nativeTeam,away_id:null,starts_at:null,local_day:null,type:'game',status:'SCHEDULED',payload:'{}'}));
  await repo.ingestSourcePage({records:{},fixtures});
  const evidence=dates.map((day,index)=>({source_event_id:sourceKey('gotsport',fixtures[index].native_id),day}));
  await db.prepare("INSERT INTO connection_event_resolutions(connection_id,source_event_id,state,effective_day,basis,source_hash,generation) SELECT ?,json_extract(value,'$.source_event_id'),'excluded',json_extract(value,'$.day'),'season_scope_conflict','fixture',? FROM json_each(?)").bind(saved.connection_id,saved.connection.generation,JSON.stringify(evidence)).run();
  const catalog=await request(undefined,{route:'/api/teams/'+saved.team_id+'/connections',method:'GET'});assert.equal(catalog.status,200,JSON.stringify(catalog));
  const resolution=catalog.data.items[0].season_resolution;assert.equal(resolution.state,'needs_review');assert.equal(resolution.needs_review_events,dates.length);
  const expected={reason:'season_scope_conflict',count:dates.length,desired_years:[2027,2026,...Array.from({length:18},(_,i)=>2020-i)],desired_years_total:23,desired_years_truncated:true};
  assert.deepEqual(resolution.excluded_reasons,[expected]);
  const ownerStatus=await request(undefined,{route:'/api/status?team_id='+saved.team_id,method:'GET'});assert.equal(ownerStatus.status,200,JSON.stringify(ownerStatus));
  assert.equal(ownerStatus.data.data.evidence.needs_review_events,dates.length);assert.deepEqual(ownerStatus.data.data.evidence.excluded_reasons,[expected]);
});

test('withdrawn dated roster evidence stays reviewable without current membership and is owner-only and bounded',async()=>{
  const candidate=await source({provider:'teamsnap'}),nativeTeam=candidate.id.split('/').at(-1),players=Array.from({length:26},(_,i)=>({provider:'teamsnap',native_id:'withdrawn-'+i,name:'Current name '+i,jersey:String(100+i),details:{}}));
  await repo.ingestSourcePage({accountId:candidate.account.id,generation:candidate.account.generation,records:{players,team_players:players.slice(0,10).map(player=>({team_id:'teamsnap:'+nativeTeam,player_id:'teamsnap:'+player.native_id,active:false}))},fixtures:[]});
  const saved=accepted(await request(command(candidate))),season=await repo.ensureSeason(saved.team_id,2023),snapshots=players.map((player,index)=>({id:sourceKey('teamsnap',player.native_id,candidate.account.id),name:'Saved historical name '+index,basis:index===25?'accepted_projection':'dated_roster'}));
  await db.prepare("INSERT INTO connection_roster_evidence(connection_id,team_season_id,source_player_id,basis_key,basis,valid_from,valid_until,certainty,name,observed_at,source_hash) SELECT ?,?,json_extract(value,'$.id'),'withdrawn-native-period',json_extract(value,'$.basis'),'2023-07-01','2024-05-31','preserved_uncertain',json_extract(value,'$.name'),'fixture','fixture' FROM json_each(?)").bind(saved.connection_id,season.id,JSON.stringify(snapshots)).run();
  await db.prepare("INSERT INTO connection_roster_evidence(connection_id,team_season_id,source_player_id,basis_key,basis,valid_from,valid_until,certainty,name,observed_at,source_hash) VALUES(?,?,?,'another-native-period','dated_roster','2023-07-01','2024-05-31','preserved_uncertain','Saved historical name 0','fixture','fixture')").bind(saved.connection_id,season.id,snapshots[0].id).run();
  const catalog=await request(undefined,{route:'/api/teams/'+saved.team_id+'/connections',method:'GET'});assert.equal(catalog.status,200,JSON.stringify(catalog));
  const root=catalog.data.items[0];assert.equal(root.season_resolution.state,'needs_review');assert.equal(root.pending_roster.total,0);
  assert.equal(root.roster_review.total,25);assert.equal(root.roster_review.items.length,20);assert.equal(root.roster_review.limit,20);assert.equal(root.roster_review.truncated,true);
  for(const item of root.roster_review.items){assert.deepEqual(Object.keys(item).sort(),['name','source_player_id']);assert.match(item.name,/^Saved historical name /);assert.notEqual(item.source_player_id,snapshots[25].id);}
  const status=await request(undefined,{route:'/api/status?team_id='+saved.team_id,method:'GET'});assert.equal(status.status,200,JSON.stringify(status));assert.equal(status.data.data.roster_review.total,25);
  for(const item of status.data.data.roster_review.items){assert.equal(item.connection_id,saved.connection_id);assert.equal(item.provider,'teamsnap');assert.ok(item.source_name);assert.equal(Object.hasOwn(item,'jersey'),false);}
  const viewer=await security.createViewerToken(cookie.slice('myts_session='.length),saved.team_id,{categories:['overview']}),publicStatus=await request(undefined,{route:'/api/status?team_id='+saved.team_id,method:'GET',signed:false,headers:{'x-view-key':viewer.token}});assert.equal(publicStatus.status,200,JSON.stringify(publicStatus));
  for(const key of ['pending_roster','roster_review','evidence','connections','attachments','jobs'])assert.equal(Object.hasOwn(publicStatus.data.data,key),false,key);
});


test('connection commands remain within 48 native statements with actual installation writer overhead',async()=>{
  const candidate=await source({provider:'teamsnap'}),first=command(candidate),other=command(candidate),headers={'x-test-epoch':'1'};
  const results=(await Promise.all([request(first,{headers}),request(other,{headers})])).map(accepted);assert.equal(results[0].team_id,results[1].team_id);
  assert.equal(accepted(await request(first,{headers})).team_id,results[0].team_id);
  const permit=await db.prepare('SELECT writer_mode,writer_epoch,permit_guard FROM installation_upgrade WHERE id=1').first();assert.deepEqual(permit,{writer_mode:null,writer_epoch:null,permit_guard:null});
});


test('ordinary second-team source connection inherits ready descendants and keeps polling after the first root unlinks',async()=>{
  const nativeId='720009',candidate={id:sourceKey('gotsport',nativeId),account:null};
  await repo.ingestSourcePage({records:{teams:[{provider:'gotsport',native_id:nativeId,name:'Synthetic Club Shared native team',club_id:'Synthetic Club',details:{}}]},fixtures:[]});
  const first=accepted(await request(command(candidate))),jobs=new JobCoordinator(db),calls=[];
  const transport={observations:[],async get(value){const url=new URL(value);calls.push(url.pathname);if(url.pathname.endsWith('/team_details'))return {value:{id:nativeId,team_name:'Shared native team',club_name:'Synthetic Club'}};assert.equal(url.pathname,`/api/v1/teams/${nativeId}/matches`);return {value:{matches:[],pagination:{current_page:1,total_pages:0,total_entries:0}}};}};
  const collect=context=>collectApplicationJob({...context,env:{}},{transportFactory:()=>transport});
  const profile=await db.prepare("SELECT id FROM sync_jobs WHERE provider='gotsport' AND component='profile' AND scope=?").bind(nativeId).first();
  await db.prepare('UPDATE sync_jobs SET ready_since=0 WHERE id=?').bind(profile.id).run();
  assert.equal((await jobs.runOne(collect)).committed,true);
  const history=await db.prepare("SELECT id FROM sync_jobs WHERE provider='gotsport' AND component='history' AND scope=?").bind(nativeId).first();assert.ok(history);
  await db.prepare('UPDATE sync_jobs SET ready_since=0 WHERE id=?').bind(history.id).run();assert.equal((await jobs.runOne(collect)).committed,true);
  const savedGraph=(await db.prepare("SELECT id,state,generation,checkpoint,scan_id,args FROM sync_jobs WHERE provider='gotsport' AND scope=? ORDER BY id").bind(nativeId).all()).results;
  const other=accepted(await request(command(await source()))),second=accepted(await request({request_id:crypto.randomUUID(),team_id:other.team_id,source_team_id:candidate.id}));
  assert.notEqual(first.team_id,second.team_id);assert.equal(second.team_id,other.team_id);
  assert.deepEqual((await db.prepare("SELECT id,state,generation,checkpoint,scan_id,args FROM sync_jobs WHERE provider='gotsport' AND scope=? ORDER BY id").bind(nativeId).all()).results,savedGraph,'new logical-team admission leaves saved native cursors and ready parent intact');
  assert.deepEqual((await db.prepare('SELECT app_team_id,generation FROM sync_job_subscribers WHERE job_id=? ORDER BY app_team_id').bind(history.id).all()).results,[{app_team_id:first.team_id,generation:first.connection.generation},{app_team_id:second.team_id,generation:second.connection.generation}].sort((a,b)=>a.app_team_id.localeCompare(b.app_team_id)));
  assert.equal((await unlink(first)).status,200);const beforePoll=calls.length;
  await db.prepare('UPDATE sync_jobs SET next_at=0,ready_since=0 WHERE id=?').bind(history.id).run();const poll=await jobs.runOne(collect);assert.equal(poll.jobId,history.id);assert.equal(poll.committed,true);
  assert.equal(calls.length,beforePoll+1);assert.equal(calls.at(-1),`/api/v1/teams/${nativeId}/matches`,'surviving root causes an actual production collector history request');
  assert.equal(calls.filter(value=>value.endsWith('/team_details')).length,1,'sharing a ready parent never requires a duplicate profile fetch');
});
