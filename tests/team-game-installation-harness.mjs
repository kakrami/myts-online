import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {V714_OBJECTS,V714_FINGERPRINT} from '../src/application/schema-v714.js';
import {V731_OBJECTS,V731_FINGERPRINT,V731_PLAN_HASH} from '../src/application/schema-v731.js';
export const START='2026-10-12T05:20:00.000Z',COMPLETE='2026-10-12T05:29:49.040Z';
export async function harness(){
 const root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||'.'),modules={};
 for(const dir of ['src','web'])for(const file of(await readdir(path.join(root,dir),{recursive:true})).filter(file=>file.endsWith('.js')))modules[dir+'/'+file]={type:'esm',contents:await readFile(path.join(root,dir,file),'utf8')};
 modules['tests/mock-provider.js']={type:'esm',contents:await readFile(path.join(root,'tests/mock-provider.js'),'utf8')};
 modules['extension-test.js']={type:'esm',contents:`
 import {InstallationUpgrade} from './src/application/schema-upgrade.js';
 import {InstallationUpgrade as Frozen731Installation} from './src/application/schema-upgrade-v731.js';
 import {V731_SCHEMA,V731_SEED} from './src/application/schema-v731.js';
 import {SCHEMA,SEED} from './src/application/installation-schema.js';
 import {wrapDatabase} from './src/application/installation-epoch.js';
 import {wrapDatabase as oldWrapDatabase} from './src/application/installation-epoch-v731.js';
 import {BudgetDB} from './src/sync/budget.js';
 import {JobCoordinator} from './src/sync/coordinator.js';
 import {collectApplicationJob} from './src/application/sync-service.js';
 import mockProvider from './tests/mock-provider.js';
 export default {async fetch(request,env){const b=await request.json(),db=new BudgetDB(env.DB,b.limit??50),model=new InstallationUpgrade(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:'native-extension-fixture-password',upgradeMode:b.mode??'normal',batchSize:b.batchSize??24});
 try{let result;
 if(b.failBootstrapAt!==undefined){const batch=db.batch.bind(db);db.batch=statements=>{const copy=[...statements];copy.splice(b.failBootstrapAt,0,db.prepare('INSERT INTO domain_team_preconditions VALUES(1,1,0)'));return batch(copy);};}
 if(b.failAt!==undefined){const transact=model.transact.bind(model);model.transact=(journal,statements,next)=>{const copy=[...statements];copy.splice(b.failAt,0,db.prepare('UPDATE installation_team_games_upgrade SET assertion=0 WHERE id=1'));return transact(journal,copy,next);};}
 if(b.op==='inspect')result=await model.inspect();
 else if(b.op==='advance')result=await model.advanceUpgrade();
 else if(b.op==='bootstrap')result=await model.bootstrap();
 else if(b.op==='fresh731')result=await new Frozen731Installation(db,{schema:V731_SCHEMA,seed:V731_SEED,bootstrapPassword:'native-extension-fixture-password'}).advance('native-extension-fixture-password');
 else if(b.op==='fresh')result=await model.advance(b.password??'native-extension-fixture-password');
 else if(b.op==='enqueueLive')result=await new JobCoordinator(wrapDatabase(db),{publicHistory:true}).enqueue({provider:'live',component:'upcoming',scope:'700',resourceKey:'700',args:{team_id:'700',timezone:'America/Los_Angeles',proof:{season:'60',season_name:'2026'}},recurring:false},[{kind:'team',key:'connection:root',teamId:'team',generation:1}]);
 else if(b.op==='collectLive'){
  const readiness=await model.inspect();if(readiness.state!=='ready'||db.used!==2)throw Error('readiness_contract');
  const writer=wrapDatabase(db),coordinator=new JobCoordinator(writer,{publicHistory:true}),lease=await coordinator.claim();
  if(lease?.id!==b.jobId||db.used!==7)throw Error('claim_contract');
  const values=new Map(),providerEnv={COUNTERS:{async get(key,type){const value=values.get(key);return type==='json'&&value?JSON.parse(value):value;},async put(key,value){values.set(key,value);}}};
  const transport={observations:[],async get(url){const response=await mockProvider.fetch(new Request(url),providerEnv),value=await response.json();this.observations.push({endpoint:new URL(url).origin+new URL(url).pathname,status:response.status,at:new Date().toISOString(),hash:'a'.repeat(64),bytes:JSON.stringify(value).length});return {value};}};
  const page=await collectApplicationJob({db:writer,env:{},lease,args:lease.args,checkpoint:lease.checkpoint},{transportFactory:()=>transport}),saved=await coordinator.commit(lease,page);
  result={saved,childCount:page.children.filter(child=>child.subscriberMode==='inherit').length,complete:page.complete};
 }
 else if(b.op==='transact'){await model.transact(b.extension,(b.statements??[]).map(x=>db.prepare(x.sql).bind(...(x.params??[]))),b.next??{});result={ok:true};}
 else{const writer=b.op==='old'?oldWrapDatabase(db):b.op==='current'?wrapDatabase(db):db;result=await writer.batch(b.statements.map(x=>writer.prepare(x.sql).bind(...(x.params??[]))));}
 if(b.loseAck)throw Error('simulated_committed_response_loss');return Response.json({result,used:db.used,rowsRead:db.rowsRead,rowsWritten:db.rowsWritten});
 }catch(e){return Response.json({error:{code:e.code??null,message:e.message},used:db.used},{status:409});}}};`};
 const mf=new Miniflare({cf:false,telemetry:{enabled:false},workers:[{config:{name:'team-game-installation-test',compatibilityDate:'2026-09-09',manifest:{mainModule:'extension-test.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'team-game-installation-test'}}}}]});await mf.ready;
 const call=async body=>{const response=await mf.dispatchFetch('https://extension.test/',{method:'POST',body:JSON.stringify(body)}),value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error.message),{code:value.error.code,used:value.used});return value;};
 const batch=async statements=>(await call({statements})).result;
 const query=async(sql,params=[])=>(await batch([{sql,params}]))[0].results;
 return {call,batch,query,dispose:()=>mf.dispose()};
}
export async function install731(h){
 const order={table:0,index:1,view:2,trigger:3};const all=[...V731_OBJECTS].sort((a,b)=>order[a.type]-order[b.type]||a.name.localeCompare(b.name));
 const tables=all.filter(row=>row.type==='table'),other=all.filter(row=>row.type!=='table');
 for(let i=0;i<tables.length;i+=24)await h.batch(tables.slice(i,i+24).map(row=>({sql:row.sql})));
 await h.batch([
  {sql:'INSERT INTO setup_state VALUES(1,?,731,\'ready\',?,?)',params:[V731_FINGERPRINT,START,COMPLETE]},
  {sql:'INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,1,?)',params:[START]},
  {sql:`INSERT INTO installation_upgrade(id,epoch,from_fingerprint,to_fingerprint,plan_hash,phase,cursor,started_at,completed_at,original_started_at,original_completed_at,original_cursor) VALUES(1,'team-connections-v1','e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003',?,?,'complete','','base-upgrade-start','base-upgrade-complete',?,?,270)`,params:[V731_FINGERPRINT,V731_PLAN_HASH,START,COMPLETE]},
 ]);
 for(let i=0;i<other.length;i+=24)await h.batch(other.slice(i,i+24).map(row=>({sql:row.sql})));
}
export async function snapshot731(h){
 const tables=V731_OBJECTS.filter(row=>row.type==='table').map(row=>row.name),rows={};
 for(let i=0;i<tables.length;i+=20){const selected=tables.slice(i,i+20),result=await h.batch(selected.map(name=>({sql:'SELECT '+(name==='team_projection_runs'?'id,app_team_id,team_season_id,input_revision,state,created_at':'*')+' FROM '+name+' ORDER BY rowid'})));selected.forEach((name,index)=>{rows[name]=result[index].results;});}
 return rows;
}
export async function fixture731(h,{legacy714=false}={}){
 const statements=[
  {sql:`INSERT INTO security_owner VALUES(1,'fixture-salt','fixture-hash',600000,1,?,1,1)`,params:[START]},
  {sql:`INSERT INTO security_installation VALUES(1,'fixture-vault-id','fixture-encrypted-vault',1)`},
  {sql:`INSERT INTO provider_accounts VALUES('account','teamsnap','native-account','Saved account',3,0)`},
  {sql:`INSERT INTO security_account_credentials VALUES('account',3,'fixture-ciphertext',NULL,1)`},
  {sql:`INSERT INTO security_sessions VALUES('fixture-session',1,1,9999999999999,NULL)`},
  {sql:`INSERT INTO app_teams VALUES('team','Saved team','UTC',2026,'old-request',?)`,params:[START]},
  {sql:`INSERT INTO team_read_state(app_team_id) VALUES('team')`},
  {sql:`INSERT INTO team_seasons VALUES('season','team',2026,'2026-06-01','2027-06-01','2026-06-01T00:00:00Z','2027-06-01T00:00:00Z',0)`},
  {sql:`INSERT INTO team_projection_state(team_season_id,app_team_id) VALUES('season','team')`},
  {sql:`INSERT INTO source_teams(id,provider,scope,account_id,native_id,name,name_authority,archived,evidence,content_hash,observed_at) VALUES('source','teamsnap','account','account','native-team','Saved team',1,0,'{"saved":"evidence"}','fixture-source-hash',?)`,params:[START]},
  {sql:`INSERT INTO source_players(id,provider,scope,account_id,native_id,name,jersey,evidence,content_hash,observed_at) VALUES('player-source','teamsnap','account','account','native-player','Saved player','7','{}','player-hash',?)`,params:[START]},
  {sql:`INSERT INTO players VALUES('player',?)`,params:[START]},
  {sql:`INSERT INTO player_source_links VALUES('player-source','player','source_identity','{}',1)`},
  {sql:`INSERT INTO team_source_attachments VALUES('attachment','team','season','source','account',1,2)`},
  {sql:`INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,generation,created_at) VALUES('root','team','source','account','observed_history',2,?)`,params:[START]},
  {sql:`INSERT INTO team_connection_seasons VALUES('root','season','attachment','events',1,0,2)`},
  {sql:`INSERT INTO events VALUES('event',?)`,params:[START]},
  {sql:`INSERT INTO source_events(id,provider,scope,account_id,native_id,starts_at,time_precision,type,status,conditional,home_source_team_id,home_label,away_label,title,venue,evidence,content_hash,observed_at) VALUES('source-event','teamsnap','account','account','native-event','2026-10-10T10:00:00Z','instant','game','SCHEDULED',0,'source','Home','Away','Saved game','Saved venue','{"original":true}','event-hash',?)`,params:[START]},
  {sql:`INSERT INTO source_event_teams VALUES('source','source-event','home')`},
  {sql:`INSERT INTO event_source_links VALUES('source-event','event','source_identity','{}',1)`},
  {sql:`INSERT INTO game_bookmarks VALUES('team','event','{"note":"saved memo"}',?)`,params:[START]},
 ];
 const admitted=legacy714?statements.filter(row=>!/^INSERT INTO team_source_connections|^INSERT INTO team_connection_seasons/.test(row.sql)):statements;
 for(let i=0;i<admitted.length;i+=20)await h.call({op:legacy714?'raw':'old',statements:admitted.slice(i,i+20)});
 await h.call({op:legacy714?'raw':'old',statements:[
  {sql:`INSERT INTO team_projection_runs VALUES('saved-run','team','season',1,'published',?)`,params:[START]},
  {sql:`INSERT INTO team_event_rows(run_id,app_team_id,team_season_id,event_id,starts_at,type,status,conditional,own_side,home_name,away_name,title,venue,source_ids,schedule_source_id,result_source_id) VALUES('saved-run','team','season','event','2026-10-10T10:00:00Z','game','SCHEDULED',0,'home','Home','Away','Saved game','Saved venue','["source-event"]','source-event','source-event')`},
  {sql:`UPDATE team_projection_state SET published_run_id='saved-run' WHERE team_season_id='season'`},
  {sql:`INSERT INTO coach_sessions VALUES('team','season','event',7,60,'paused',1,12345,0,NULL,0,17,?,'saved-session-token')`,params:[START]},
  {sql:`INSERT INTO coach_session_players VALUES('team','season','event','player','Saved player','7',1,'saved_provider',NULL)`},
  {sql:`INSERT INTO coach_lineup VALUES('team','season','event','LF','player')`},
  {sql:`INSERT INTO coach_stints VALUES('saved-stint','team','season','event','player','LF',1,123,NULL)`},
  {sql:`INSERT INTO sync_jobs(id,provider,account_scope,account_id,authorization_generation,component,scope,resource_key,scan_id,ready_since,next_at,interval_ms,state,lease_token,lease_until,checkpoint) VALUES('retained-job','teamsnap','account','account',3,'events','source','source','saved-scan',1,1,900000,'running','old-lease',9999999999999,'{"offset":12}')`},
 ]});
}

export async function install714(h){
 const order={table:0,index:1,view:2,trigger:3},objects=[...V714_OBJECTS].sort((a,b)=>order[a.type]-order[b.type]||a.name.localeCompare(b.name));
 for(let i=0;i<objects.length;i+=24)await h.batch(objects.slice(i,i+24).map(row=>({sql:row.sql})));
 await h.batch([{sql:"INSERT INTO setup_state VALUES(1,?,270,'ready',?,?)",params:[V714_FINGERPRINT,START,COMPLETE]},{sql:'INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,1,?)',params:[START]}]);
}
