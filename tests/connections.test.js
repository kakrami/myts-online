import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {initializeDomain} from '../src/domain/schema.js';
import {SecurityStore,installSecuritySchema} from '../src/security/index.js';
import {installSyncSchema} from '../src/sync/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {CATALOG_SCHEMA} from '../src/application/team-catalog.js';

// Real native D1 transactions and HTTP routes. Only delivery/commit faults and
// scheduler wake are injected; provider observations are synthetic fixtures.
const PASSWORD='connection-native-owner-password';
let mf,db,repo,security,cookie,maxQueries=0;
test.before(async()=>{
  const root=path.resolve('.'),modules={};
  for(const file of (await readdir('src',{recursive:true})).filter(file=>file.endsWith('.js'))){const name='src/'+file;modules[name]={type:'esm',contents:await readFile(name,'utf8')};}
  modules['connection-test-worker.js']={type:'esm',contents:`
    import {applicationRoutes} from './src/application/routes.js';
    import {errorResponse} from './src/application/http.js';
    import {BudgetDB} from './src/sync/budget.js';
    const wrap=(native,sql)=>({native,sql,bind(...args){return wrap(native.bind(...args),sql);},all(...args){return native.all(...args);},first(...args){return native.first(...args);},run(...args){return native.run(...args);}});
    export default {async fetch(request,env){
      const fault=request.headers.get('x-test-fault')||'',raw=env.DB;
      const adapter={prepare(sql){return wrap(raw.prepare(sql),sql);},async batch(statements){
        const connection=statements.some(s=>/INSERT INTO app_teams/.test(s.sql))&&statements.some(s=>/INSERT INTO team_source_attachments/.test(s.sql));
        if(connection&&fault==='session_revoke')await raw.prepare('UPDATE security_sessions SET revoked_at=1').run();
        if(connection&&fault==='account_revoke')await raw.prepare('UPDATE provider_accounts SET active=0 WHERE id=?').bind(request.headers.get('x-test-account')).run();
        if(fault==='queue_failure'&&statements.some(s=>/INSERT INTO sync_jobs/.test(s.sql)))throw new Error('simulated queue failure');
        const native=statements.map(s=>s.native||s);
        if(connection&&['attachment_rollback','profile_rollback'].includes(fault)){
          const target=fault==='attachment_rollback'?'INSERT INTO team_source_attachments':'INSERT INTO team_profiles';
          const index=statements.findIndex(s=>s.sql.includes(target));
          if(index<0)throw new Error('Test fault did not find its transaction statement');
          native[index]=raw.prepare("INSERT INTO feature_write_fences VALUES('simulated-rollback',0)");
        }
        const result=await raw.batch(native);
        if(connection&&fault==='post_commit')throw new Error('simulated lost commit acknowledgement');
        return result;
      }};
      const budget=new BudgetDB(adapter);budget.reserve(2);
      let response;
      try{response=await applicationRoutes(request,{ADMIN_KEY:'${PASSWORD}'},{db:budget,installation:{inspect:async()=>({state:'ready'})},syncOptions:{wake:async()=>{}}});}
      catch(error){response=errorResponse(error);}
      if(fault==='lost_response'&&response.status===202)response=Response.json({error:{code:'simulated_response_loss'}},{status:503});
      const headers=new Headers(response.headers);headers.set('x-test-queries',String(budget.used));
      return new Response(response.body,{status:response.status,headers});
    }};
  `};
  mf=new Miniflare({telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'connection-test',compatibilityDate:'2026-09-09',manifest:{mainModule:'connection-test-worker.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'connection-test'}},exports:{}}}]});
  await mf.ready;db=await mf.getD1Database('DB','connection-test');
  await initializeDomain(db);await installSecuritySchema(db);await installSyncSchema(db);await db.batch([...TEAM_FEATURE_SCHEMA,...CATALOG_SCHEMA].map(sql=>db.prepare(sql)));
  repo=new DomainRepository(db);security=new SecurityStore(db,{bootstrapPassword:PASSWORD});
  const session=await security.initializeOwner(PASSWORD);cookie='myts_session='+session.token;
});
test.after(async()=>{console.log(JSON.stringify({connection_max_queries:maxQueries,request_budget:48,native_d1:true,browser_used:false}));await mf?.dispose();});
async function request(body,{route='/api/connections',method='POST',fault='',headers={},signed=true}={}){
  const response=await mf.dispatchFetch('http://localhost'+route,{method,headers:{'Content-Type':'application/json',Origin:'http://localhost',...(signed?{Cookie:cookie}:{}),'x-test-fault':fault,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json(),queries:Number(response.headers.get('x-test-queries'))};
}
async function source({provider='gotsport',owned=true,club='Synthetic Club',provenance='provider'}={}){
  const nativeId=crypto.randomUUID(),account=['trace','teamsnap'].includes(provider)?await repo.registerAccount({provider,nativeId:crypto.randomUUID()}):null;
  await repo.ingestSourcePage({accountId:account?.id??null,generation:account?.generation??null,provenance,records:{teams:[{provider,native_id:nativeId,name:'Discovered '+provider,club_id:club,details:account?{account_owned:owned,slug:'synthetic-team'}:{}}]},fixtures:[]});
  return {id:sourceKey(provider,nativeId,account?.id??null),account};
}
function command(candidate,changes={}){return {request_id:crypto.randomUUID(),source_team_id:candidate.id,account_id:candidate.account?.id??null,new_team:{name:'New connected team',timezone:'America/Los_Angeles',season_year:2026,kind:'own'},...changes};}
async function counts(){return db.prepare(`SELECT (SELECT count(*) FROM app_teams) teams,(SELECT count(*) FROM team_seasons) seasons,(SELECT count(*) FROM team_profiles) profiles,(SELECT count(*) FROM app_clubs) clubs,(SELECT count(*) FROM team_source_attachments) attachments,(SELECT count(*) FROM team_read_state) reads,(SELECT count(*) FROM team_projection_state) projections,(SELECT count(*) FROM sync_jobs) jobs`).first();}
const accepted=result=>{maxQueries=Math.max(maxQueries,result.queries);assert.equal(result.status,202,JSON.stringify(result));assert.equal(result.data.queued,true);assert.ok(result.queries<=48);return result.data;};

test('native atomic connection creates one team, season, source-derived profile and durable import demand within the invocation budget',async()=>{
  for(const provider of ['gotsport','teamsnap','trace']){
    const candidate=await source({provider}),body=command(candidate),result=accepted(await request(body));
    assert.equal(result.replayed,false);assert.equal(result.attachment.source_team_id,candidate.id);assert.equal(result.attachment.account_id,candidate.account?.id??null);
    const profile=await db.prepare('SELECT p.kind,c.external_key FROM team_profiles p JOIN app_clubs c ON c.id=p.club_id WHERE p.app_team_id=?').bind(result.team_id).first();
    assert.equal(profile.kind,'own');assert.equal(profile.external_key,provider+'/'+(candidate.account?.id??'public')+'/Synthetic Club');
    assert.equal((await db.prepare("SELECT count(*) n FROM sync_jobs j JOIN sync_job_subscribers s ON s.job_id=j.id WHERE s.app_team_id=? AND j.stage='source'").bind(result.team_id).first()).n,provider==='teamsnap'?5:provider==='trace'?2:1);
    assert.equal((await db.prepare("SELECT count(*) n FROM sync_jobs WHERE provider='domain' AND scope=?").bind(result.team_id).first()).n,1);
  }
});

test('native attachment and profile write failures roll back every new-team row',async()=>{
  for(const fault of ['attachment_rollback','profile_rollback']){
    const body=command(await source({club:crypto.randomUUID()})),before=await counts(),result=await request(body,{fault});
    assert.notEqual(result.status,202);assert.deepEqual(await counts(),before);
    assert.equal(await db.prepare('SELECT id FROM app_teams WHERE request_id=?').bind(body.request_id).first(),null);
    accepted(await request(body));
  }
});

test('concurrent identical requests and conflicting requests preserve one atomic durable winner',async()=>{
  const body=command(await source({provider:'teamsnap'})),before=await counts();
  const results=await Promise.all([request(body),request(body)]),saved=results.map(accepted);
  assert.equal(saved[0].team_id,saved[1].team_id);assert.equal(saved[0].season_id,saved[1].season_id);assert.equal(saved[0].attachment.id,saved[1].attachment.id);
  const after=await counts();for(const key of ['teams','seasons','profiles','attachments','reads','projections'])assert.equal(after[key],before[key]+1,key);
  const first=command(await source()),other={...first,new_team:{...first.new_team,name:'Conflicting concurrent team'}};
  const competing=await Promise.all([request(first),request(other)]);
  assert.deepEqual(competing.map(r=>r.status).sort(),[202,409]);assert.equal(competing.find(r=>r.status===409).data.error.code,'idempotency_conflict');
});

test('durable receipt rejects altered source, account, name, season, timezone and kind even after rename',async()=>{
  const body=command(await source()),saved=accepted(await request(body)),another=await source();
  await db.prepare('UPDATE app_teams SET name=? WHERE id=?').bind('Owner renamed it',saved.team_id).run();
  const variants=[{...body,source_team_id:another.id},...Object.entries({name:'Changed',season_year:2025,timezone:'UTC',kind:'followed'}).map(([key,value])=>({...body,new_team:{...body.new_team,[key]:value}}))];
  for(const changed of variants){const result=await request(changed);assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.data.error.code,'idempotency_conflict');}
  const privateSource=await source({provider:'trace'}),accountMismatch=await request({...body,source_team_id:privateSource.id,account_id:privateSource.account.id});
  assert.equal(accountMismatch.status,409);assert.equal(accountMismatch.data.error.code,'idempotency_conflict');
  const retry=accepted(await request(body));assert.equal(retry.team_id,saved.team_id);assert.equal(retry.replayed,true);
});

test('replay preserves later profile edits and does not restore a removed attachment',async()=>{
  const body=command(await source()),saved=accepted(await request(body));
  await db.prepare("UPDATE team_profiles SET kind='followed',revision=revision+1 WHERE app_team_id=?").bind(saved.team_id).run();
  const replay=accepted(await request(body));assert.equal(replay.team_id,saved.team_id);
  assert.equal((await db.prepare('SELECT kind FROM team_profiles WHERE app_team_id=?').bind(saved.team_id).first()).kind,'followed');
  await repo.unlinkTeam({teamId:saved.team_id,attachmentId:saved.attachment.id});
  const before=await counts(),removed=await request(body);assert.equal(removed.status,409);assert.equal(removed.data.error.code,'connection_unavailable');assert.deepEqual(await counts(),before);
  assert.equal((await db.prepare('SELECT active FROM team_source_attachments WHERE id=?').bind(saved.attachment.id).first()).active,0);
});

test('lost HTTP response retries reuse identity without changing attachment generation',async()=>{
  const body=command(await source()),lost=await request(body,{fault:'lost_response'});assert.equal(lost.status,503);
  const committed=await db.prepare('SELECT t.id,a.id AS attachment_id,a.generation FROM app_teams t JOIN team_source_attachments a ON a.app_team_id=t.id WHERE t.request_id=?').bind(body.request_id).first();
  const before=await counts(),retry=accepted(await request(body));assert.equal(retry.replayed,true);assert.equal(retry.team_id,committed.id);assert.equal(retry.attachment.id,committed.attachment_id);assert.equal(retry.attachment.generation,committed.generation);assert.deepEqual(await counts(),before);
});

test('uncertain D1 commit acknowledgement is recovered and post-commit queue failure is repairable',async()=>{
  const recovered=accepted(await request(command(await source()),{fault:'post_commit'}));assert.equal(recovered.replayed,true);
  const body=command(await source({provider:'teamsnap'})),result=await request(body,{fault:'queue_failure'});assert.equal(result.status,500);assert.equal(result.data.queued,undefined);
  const committed=await db.prepare('SELECT id FROM app_teams WHERE request_id=?').bind(body.request_id).first();assert.ok(committed);
  assert.equal((await db.prepare('SELECT count(*) n FROM sync_job_subscribers WHERE app_team_id=?').bind(committed.id).first()).n,0);
  const before=await counts(),retry=accepted(await request(body));assert.equal(retry.team_id,committed.id);assert.equal(retry.replayed,true);
  assert.equal((await counts()).teams,before.teams);assert.equal((await counts()).attachments,before.attachments);
  assert.equal((await db.prepare('SELECT count(*) n FROM sync_job_subscribers WHERE app_team_id=?').bind(committed.id).first()).n,6);
});

test('source/account/owner/same-origin guards reject unauthorized connections before creation',async()=>{
  const pub=await source(),priv=await source({provider:'trace'}),unowned=await source({provider:'trace',owned:false}),file=await source({provenance:'file_import'});
  const requests=[()=>request(command(pub),{signed:false}),()=>request(command(pub),{headers:{'x-view-key':'read-only'}}),()=>request(command(pub),{headers:{Origin:'https://elsewhere.example'}}),()=>request(command(priv,{account_id:null})),()=>request(command(pub,{account_id:priv.account.id})),()=>request(command(unowned)),()=>request(command(file))];
  const before=await counts();for(const invoke of requests){const result=await invoke();assert.ok([401,403].includes(result.status),JSON.stringify(result));}assert.deepEqual(await counts(),before);
});

test('account and owner-session revocation at the atomic commit leave no orphan team',async()=>{
  const candidate=await source({provider:'trace'}),body=command(candidate),before=await counts();
  const result=await request(body,{fault:'account_revoke',headers:{'x-test-account':candidate.account.id}});assert.notEqual(result.status,202);assert.deepEqual(await counts(),before);
  const ownerBody=command(await source()),sessionResult=await request(ownerBody,{fault:'session_revoke'});assert.notEqual(sessionResult.status,202);assert.deepEqual(await counts(),before);
  const login=await security.login(PASSWORD);cookie='myts_session='+login.token;
});

test('existing-team natural uniqueness and explicit club-conflict decisions remain intact',async()=>{
  const firstSource=await source({club:'First verified club'}),secondSource=await source({club:'Second verified club'}),body=command(firstSource),saved=accepted(await request(body));
  const route='/api/teams/'+saved.team_id+'/attachments',attach={season_id:saved.season_id,source_team_id:secondSource.id,kind:'own'};
  const conflict=await request(attach,{route});assert.equal(conflict.status,409);assert.equal(conflict.data.error.code,'club_choice_required');
  assert.equal((await db.prepare('SELECT count(*) n FROM team_source_attachments WHERE app_team_id=?').bind(saved.team_id).first()).n,1);
  const choice=conflict.data.error.details.club_choice,resolved=await request({...attach,club_choice:{kind:choice.kind,keep:'source',...choice.expected}},{route});assert.equal(resolved.status,202,JSON.stringify(resolved));
  const retry=await request(attach,{route});assert.equal(retry.status,202,JSON.stringify(retry));assert.equal(retry.data.attachment.id,resolved.data.attachment.id);
  assert.equal((await db.prepare('SELECT count(*) n FROM team_source_attachments WHERE app_team_id=?').bind(saved.team_id).first()).n,2);
});

async function readReceipt(requestId,options={}){return request(undefined,{route:'/api/connections?request_id='+encodeURIComponent(requestId),method:'GET',...options});}
async function mutationSnapshot(){
  const tables=['app_teams','team_seasons','team_profiles','app_clubs','team_source_attachments','team_read_state','team_projection_state','provider_accounts','account_source_teams','domain_installation','domain_fences','sync_jobs','sync_job_subscribers','catalog_state','team_catalog_state'];
  const result={};for(const table of tables)result[table]=(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results;return result;
}
test('read-only owner receipt recovers committed identity after entitlement and account revocation without side effects',async()=>{
  const candidate=await source({provider:'trace'}),body=command(candidate),saved=accepted(await request(body));
  const publicBody=command(await source()),publicSaved=accepted(await request(publicBody));
  await db.prepare('DELETE FROM account_source_teams WHERE account_id=? AND source_team_id=?').bind(candidate.account.id,candidate.id).run();
  let receipt=await readReceipt(body.request_id);assert.equal(receipt.status,200);assert.equal(receipt.data.account_active,true);assert.equal(receipt.data.team_id,saved.team_id);
  await repo.disconnectAccount(candidate.account.id);
  const before=await mutationSnapshot();receipt=await readReceipt(body.request_id);
  assert.deepEqual(receipt.data,{found:true,team_id:saved.team_id,season_id:saved.season_id,team_available:true,attachment_id:saved.attachment.id,attachment_active:true,account_active:false});
  const publicReceipt=await readReceipt(publicBody.request_id);assert.deepEqual(publicReceipt.data,{found:true,team_id:publicSaved.team_id,season_id:publicSaved.season_id,team_available:true,attachment_id:publicSaved.attachment.id,attachment_active:true,account_active:null});
  assert.deepEqual(await mutationSnapshot(),before);
  assert.equal(Object.hasOwn(receipt.data,'queued'),false);assert.equal(Object.hasOwn(receipt.data,'source_team_id'),false);assert.equal(Object.hasOwn(receipt.data,'account_id'),false);
});
test('read-only receipt reports the original attachment, unlink and team lifecycle honestly',async()=>{
  const original=await source(),body=command(original),saved=accepted(await request(body)),extra=await source();
  await repo.attachTeam({teamId:saved.team_id,seasonId:saved.season_id,sourceTeamId:extra.id});
  await repo.unlinkTeam({teamId:saved.team_id,attachmentId:saved.attachment.id});
  let receipt=await readReceipt(body.request_id);assert.equal(receipt.data.attachment_id,saved.attachment.id);assert.equal(receipt.data.attachment_active,false);assert.equal(receipt.data.team_available,true);
  await db.prepare("INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES(?,'deleting',?)").bind(saved.team_id,new Date().toISOString()).run();
  const before=await mutationSnapshot();receipt=await readReceipt(body.request_id);assert.equal(receipt.data.team_available,false);assert.equal(receipt.data.attachment_active,false);assert.deepEqual(await mutationSnapshot(),before);
  const unknown=await readReceipt(crypto.randomUUID());assert.equal(unknown.status,200);assert.deepEqual(unknown.data,{found:false});
});
test('receipt reads require owner session and a bounded request key',async()=>{
  const before=await mutationSnapshot();
  for(const options of [{signed:false},{headers:{'x-view-key':'viewer-only'}},{headers:{Cookie:'myts_session=invalid'}}]){const result=await readReceipt(crypto.randomUUID(),options);assert.equal(result.status,401,JSON.stringify(result));}
  for(const value of ['', 'a'.repeat(129), 'invalid/key']){const result=await readReceipt(value);assert.equal(result.status,400,JSON.stringify(result));}
  assert.deepEqual(await mutationSnapshot(),before);
});
