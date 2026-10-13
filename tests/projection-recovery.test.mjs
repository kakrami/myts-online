import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {COACH_SCHEMA} from '../src/coaching/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {DATA_FILE_SCHEMA} from '../src/reporting/data-schema.js';
import {SECURITY_SCHEMA} from '../src/security/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {DomainRepository} from '../src/domain/repository.js';
import {collectApplicationJob,ApplicationSyncService} from '../src/application/sync-service.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {UPGRADE_DDL,JOURNAL_GUARDS,tableGuards,tableNames,wrapDatabase} from '../src/application/installation-epoch.js';

const AT='2026-10-12T12:00:00.000Z';
const RECOVERY='connection_recovery_pending',IMPORT='data_import_recovery_pending';
const schemas=[...DOMAIN_SCHEMA,...ANALYSIS_SCHEMA,...COACH_SCHEMA,...TEAM_FEATURE_SCHEMA,...DATA_FILE_SCHEMA,...SYNC_SCHEMA,...SECURITY_SCHEMA];

// Real application projector, SQLite transactions, root-dirty triggers, lease
// fences and installation permits. Only storage/alarm delivery and optional
// recovery consumption are stand-ins. No native worker/provider requests.
function fixture(t,{events=25,players=25,missingPlayers=false,recoveryProjections=false,extraSeasons=0}={}) {
  t.mock.timers.enable({apis:['Date'],now:Date.parse(AT)});
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');for(const sql of schemas)sqlite.exec(sql);
  const prepared=(sql,params=[])=>({sql,params,bind(...values){return prepared(sql,values);},async all(){const results=sqlite.prepare(sql).all(...params).map(row=>({...row}));return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}};},async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;},async run(){return this.all();}});
  let transaction=Promise.resolve();
  const raw={prepare:prepared,batch(statements){const next=transaction.then(async()=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}});transaction=next.catch(()=>{});return next;}};
  const seed=(table,row)=>sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
  seed('domain_installation',{id:1,schema_version:1,created_at:AT});
  seed('app_teams',{id:'team',name:'Team',timezone:'UTC',season_year:2026,created_at:AT});
  seed('team_read_state',{app_team_id:'team',pending:1});
  const season=(id,year)=>{seed('team_seasons',{id,app_team_id:'team',year,start_day:`${year}-06-01`,end_day:`${year+1}-06-01`,start_at:`${year}-06-01T00:00:00.000Z`,end_at:`${year+1}-06-01T00:00:00.000Z`});seed('team_projection_state',{team_season_id:id,app_team_id:'team',input_revision:1});};
  season('season',2026);for(let i=0;i<extraSeasons;i++)season(`extra-${String(i).padStart(3,'0')}`,1800+i);
  seed('provider_accounts',{id:'account',provider:'teamsnap',native_id:'account',name:'Account'});
  seed('source_teams',{id:'root',provider:'teamsnap',scope:'account',account_id:'account',native_id:'root',name:'Root',name_authority:3,archived:0,evidence:'{}',content_hash:'root',observed_at:AT});
  seed('account_source_teams',{account_id:'account',source_team_id:'root'});
  seed('team_source_connections',{id:'connection',app_team_id:'team',source_team_id:'root',account_id:'account',scope_mode:'observed_history',input_revision:1,reconciled_revision:1,created_at:AT});
  seed('team_source_attachments',{id:'attachment',app_team_id:'team',team_season_id:'season',source_team_id:'root',account_id:'account'});
  seed('team_connection_seasons',{connection_id:'connection',team_season_id:'season',attachment_id:'attachment',basis:'events'});
  for(let i=0;i<events;i++){
    const suffix=String(i).padStart(3,'0'),id='source-event-'+suffix,canonical='event-'+suffix;
    seed('source_events',{id,provider:'teamsnap',scope:'account',account_id:'account',native_id:suffix,local_day:'2026-07-03',time_precision:'day',type:'game',status:'FINAL',conditional:0,home_source_team_id:'root',home_label:'Home',away_label:'Away',home_score:2,away_score:1,title:'Game',venue:'Field',evidence:'{}',content_hash:id,observed_at:AT});
    seed('source_event_teams',{source_team_id:'root',source_event_id:id,side:'home'});
    seed('events',{id:canonical,created_at:AT});seed('event_source_links',{source_event_id:id,event_id:canonical,reason:'source_identity',evidence:'{}'});
    seed('team_event_season_resolutions',{app_team_id:'team',event_id:canonical,team_season_id:'season',state:'resolved',effective_day:'2026-07-03',local_day:'2026-07-03',basis:'native',evidence:'{}'});
  }
  for(let i=0;i<players;i++){
    const suffix=String(i).padStart(3,'0'),id='source-player-'+suffix;
    seed('source_players',{id,provider:'teamsnap',scope:'account',account_id:'account',native_id:suffix,name:'Current '+suffix,jersey:'99',evidence:'{}',content_hash:id,observed_at:AT});
    seed('connection_roster_evidence',{connection_id:'connection',team_season_id:'season',source_player_id:id,basis_key:'snapshot',basis:'imported_snapshot',certainty:'preserved_uncertain',name:'Historical '+suffix,jersey:'12',observed_at:AT,source_hash:id});
    if(!missingPlayers){seed('players',{id:'player-'+suffix,created_at:AT});seed('player_source_links',{source_player_id:id,player_id:'player-'+suffix,reason:'source_identity',evidence:'{}'});}
  }
  sqlite.exec('UPDATE team_source_connections SET reconciled_revision=input_revision');
  sqlite.exec("CREATE TABLE setup_state(id INTEGER PRIMARY KEY,state TEXT,schema_fingerprint TEXT);INSERT INTO setup_state VALUES(1,'ready','test')");
  sqlite.exec(UPGRADE_DDL);seed('installation_upgrade',{id:1,epoch:'team-connections-v1',to_fingerprint:'test',plan_hash:'test',phase:'complete',started_at:AT,completed_at:AT,original_started_at:AT,original_cursor:0});
  for(const sql of [...JOURNAL_GUARDS,...tableGuards(tableNames(schemas))])sqlite.exec(sql);
  const db=wrapDatabase(raw),one=(sql,...params)=>({...sqlite.prepare(sql).get(...params)}),rows=(sql,...params)=>sqlite.prepare(sql).all(...params).map(row=>({...row}));
  const values=new Map(),writes=[],pages=[],recoveries=[];let alarm=Date.now(),failPut=null,hook=null,customCollector=null;
  const storage={async get(key){return values.get(key);},async put(key,value){if(failPut?.(key,value)){failPut=null;throw new Error('Interrupted storage write');}writes.push({key,value:structuredClone(value)});values.set(key,structuredClone(value));},async getAlarm(){return alarm;},async setAlarm(at){alarm=at;},async deleteAlarm(){alarm=null;}};
  const options={clock:Date.now,pageDelayMs:10,alarmDelayMs:1,runtimeRetryMs:1000,retryBaseMs:100,leaseMs:45000,wrapDatabase,
    async recoverConnections({db:budgetDb}){
      const dirty=(await budgetDb.prepare('SELECT id,input_revision,reconciled_revision FROM team_source_connections WHERE input_revision>reconciled_revision').all()).results;
      const recovered=recoveryProjections?await new ApplicationSyncService(budgetDb,{}).recoverProjections({limit:5,wake:false}):{more:false};
      recoveries.push({dirty,...recovered});return recovered;
    }};
  const Runtime=createSyncRuntime(async context=>{
    const page=await (customCollector?customCollector(context):collectApplicationJob(context));
    pages.push({jobId:context.lease.id,before:structuredClone(context.checkpoint),page:structuredClone(page)});
    if(hook){const once=hook;hook=null;await once(context,page);}
    return page;
  },options);
  let runtime=new Runtime({storage},{DB:raw});const coordinator=new JobCoordinator(db,options);
  return {db,raw,sqlite,values,writes,pages,recoveries,one,rows,coordinator,
    get runtime(){return runtime;},get alarm(){return alarm;},restart(){runtime=new Runtime({storage},{DB:raw});},
    hook(fn){hook=fn;},collector(fn){customCollector=fn;},failNextPut(fn){failPut=fn;},
    async write(sql,...params){return db.prepare(sql).bind(...params).run();},
    async enqueue({provider='domain',component='projection',stage='projection',resource='season',args={},checkpoint}={}){
      const id=await coordinator.enqueue({provider,component,stage,scope:'team',resourceKey:resource,args:{teamId:'team',seasonId:resource,...args},priority:100,recurring:false},[{kind:'team',key:'projection:team:'+resource,teamId:'team'}]);
      if(checkpoint)await db.prepare('UPDATE sync_jobs SET checkpoint=? WHERE id=?').bind(JSON.stringify(checkpoint),id).run();return id;
    },
    async building(phase='events'){
      await db.prepare("INSERT INTO team_projection_runs VALUES('building','team','season',1,'building',?)").bind(AT).run();
      return this.enqueue({checkpoint:{runId:'building',inputRevision:1,phase,cursor:''}});
    },
    async step(){assert.notEqual(alarm,null,'Outstanding work has a durable alarm');t.mock.timers.setTime(Math.max(Date.now(),alarm));alarm=null;await runtime.alarm();const last=values.get('last_run');assert.ok(last);assert.ok(last.statements<=48,JSON.stringify(last));return last;},
    dirty(){return one('SELECT COUNT(*) n FROM team_source_connections WHERE input_revision>reconciled_revision').n;},
  };
}
async function run(f,state){let result=await f.step();if(state!=='idle'&&result.state==='idle'&&f.alarm!==null)result=await f.step();assert.equal(result.state,state,JSON.stringify(result));return result;}

async function directPage(f,checkpoint){const page=await new DomainRepository(f.db).buildProjectionPage('team','season',checkpoint);return page;}

test('real projection pages opt out only for stable unpublished rows and nonterminal cleanup',async t=>{
  const f=fixture(t),id=await f.enqueue();let published=false,complete=false,safe=0;
  for(let guard=0;guard<40&&!complete;guard++){
    const result=await f.step();if(['recovering_connections','idle'].includes(result.state))continue;
    if(result.provider==='analysis')continue;
    assert.equal(result.jobId,id,JSON.stringify(result));assert.ok(result.committed);
    const {before,page}=f.pages.at(-1),phase=before.phase;
    if(['events','players'].includes(phase)){assert.equal(page.recoveryRequired,false);safe++;assert.equal(!!f.values.get(RECOVERY),false);}
    else assert.equal(page.recoveryRequired,true);
    if(phase==='publish'){published=true;assert.equal(f.values.get(RECOVERY),true);assert.ok(f.one("SELECT id FROM sync_jobs WHERE provider='analysis' AND component='catalog'").id,'Publication still fans out analysis');}
    assert.equal(f.one('SELECT COUNT(*) n FROM team_events').n,published?25:0,'Partial pages cannot leak before pointer publication');
    assert.equal(f.dirty(),0,'Stable projection pages must not dirty root demand');
    complete=result.state==='ready';
  }
  assert.ok(complete);assert.equal(safe,6);assert.equal(f.one('SELECT COUNT(*) n FROM team_players').n,25);
  assert.deepEqual(f.rows('SELECT DISTINCT name LIKE ? historical,jersey FROM team_players','Historical %'),[{historical:1,jersey:'12'}]);
  assert.equal(f.values.get(RECOVERY),true,'Terminal cleanup retains recovery');
  await run(f,'recovering_connections');
});

test('new player identities, new runs and source-revision restarts retain conservative recovery',async t=>{
  const f=fixture(t,{events:0,players:1,missingPlayers:true});await f.building('players');
  await run(f,'queued');assert.equal(f.pages.at(-1).page.recoveryRequired,true);assert.equal(f.values.get(RECOVERY),true);
  assert.equal(f.one('SELECT COUNT(*) n FROM player_source_links').n,1);await run(f,'recovering_connections');
  await f.write('UPDATE team_projection_state SET input_revision=input_revision+1');
  await run(f,'queued');const page=f.pages.at(-1).page;
  assert.equal(page.checkpoint.phase,'identity');assert.equal(page.recoveryRequired,true);assert.equal(f.values.get(RECOVERY),true);
  assert.equal(f.one("SELECT state FROM team_projection_runs WHERE id='building'").state,'obsolete');
});

test('obsolete cleanup deletes are safe while its final completion still requires recovery',async t=>{
  const f=fixture(t,{events:1,players:1});await f.building();
  const events=await directPage(f,{runId:'building',inputRevision:1,phase:'events',cursor:''});
  await f.db.batch(events.statements.map(s=>f.db.prepare(s.sql.replaceAll('$FENCE','1')).bind(...s.params)));
  const players=await directPage(f,{runId:'building',inputRevision:1,phase:'players',cursor:''});
  await f.db.batch(players.statements.map(s=>f.db.prepare(s.sql.replaceAll('$FENCE','1')).bind(...s.params)));
  await f.write("UPDATE team_projection_runs SET state='obsolete' WHERE id='building'");
  await f.write("UPDATE sync_jobs SET checkpoint=?",JSON.stringify({phase:'cleanup'}));
  for(const table of ['team_event_rows','team_player_rows','team_projection_runs']){
    await run(f,'queued');assert.equal(f.pages.at(-1).page.recoveryRequired,false);assert.equal(!!f.values.get(RECOVERY),false);assert.equal(f.one(`SELECT COUNT(*) n FROM ${table}`).n,0);
  }
  await run(f,'ready');assert.equal(f.pages.at(-1).page.recoveryRequired,true);assert.equal(f.values.get(RECOVERY),true);
});

test('an existing durable recovery marker runs before a safe projection page',async t=>{
  const f=fixture(t,{events:1,players:0});await f.building();f.values.set(RECOVERY,true);
  await run(f,'recovering_connections');assert.equal(f.pages.length,0);await run(f,'queued');assert.equal(f.pages.at(-1).page.recoveryRequired,false);
});

test('owner wake during a safe page survives its result and schedules recovery on restart',async t=>{
  const f=fixture(t,{events:1,players:0});await f.building();f.hook(async()=>{await f.write("UPDATE app_teams SET timezone='America/Los_Angeles' WHERE id='team'");await f.runtime.wake();});
  await run(f,'queued');assert.equal(f.pages.at(-1).page.recoveryRequired,false);assert.equal(f.values.get(RECOVERY),true);assert.equal(f.values.get('wake_sequence'),1);assert.equal(f.dirty(),1);
  f.restart();await run(f,'recovering_connections');assert.equal(f.recoveries.at(-1).dirty.length,1);
});

test('source revision mutation rejects the safe-page commit instead of publishing stale rows',async t=>{
  const f=fixture(t,{events:1,players:0}),id=await f.building();f.hook(async()=>{await f.write("UPDATE source_events SET local_day='2026-07-04'");await f.write('UPDATE team_projection_state SET input_revision=input_revision+1');await f.runtime.wake();});
  const result=await f.step();assert.equal(result.committed,undefined);assert.equal(result.state,'retrying');assert.equal(f.pages.at(-1).page.recoveryRequired,false);assert.equal(f.one('SELECT pages_saved FROM sync_jobs WHERE id=?',id).pages_saved,0);assert.equal(f.one('SELECT COUNT(*) n FROM team_event_rows').n,0);
  assert.equal(f.values.get(RECOVERY),true);assert.equal(f.dirty(),1);await run(f,'recovering_connections');await run(f,'queued');assert.equal(f.pages.at(-1).page.checkpoint.phase,'identity');assert.equal(f.pages.at(-1).page.recoveryRequired,true);
});

test('publication interruption cannot suppress terminal recovery on resumed cleanup',async t=>{
  const f=fixture(t,{events:0,players:0});await f.building('publish');
  f.failNextPut((key,value)=>key===RECOVERY&&value===true);
  await run(f,'error');assert.equal(f.one('SELECT published_run_id FROM team_projection_state').published_run_id,'building');assert.equal(f.one("SELECT COUNT(*) n FROM sync_jobs WHERE provider='analysis'").n,1);
  f.restart();await run(f,'ready');assert.equal(f.values.get(RECOVERY),true);await run(f,'recovering_connections');
});

for(const hint of [undefined,null,0,'false',true])test(`missing or unrecognized projection recovery hint ${String(hint)} stays conservative`,async t=>{
  const f=fixture(t,{events:0,players:0});await f.enqueue();f.collector(async()=>({statements:[],complete:false,checkpoint:{},recoveryRequired:hint}));
  await run(f,'queued');assert.equal(f.values.get(RECOVERY),true);
});

test('even literal false cannot suppress recovery on a terminal projection commit',async t=>{
  const f=fixture(t,{events:0,players:0});await f.enqueue();f.collector(async()=>({statements:[],complete:true,recoveryRequired:false}));await run(f,'ready');assert.equal(f.values.get(RECOVERY),true);
});

for(const [provider,component,stage]of [['gotsport','event','source'],['reports','data-import','export']])test(`${provider} cannot use a projection hint to bypass its recovery obligation`,async t=>{
  const f=fixture(t,{events:0,players:0});await f.enqueue({provider,component,stage});f.collector(async()=>({statements:[],complete:true,recoveryRequired:false}));
  await run(f,'ready');assert.equal(f.values.get(RECOVERY),true);assert.equal(!!f.values.get(IMPORT),false);
});

test('safe projection pages retain a deferred import marker until idle promotion',async t=>{
  const f=fixture(t,{events:0,players:0}),id=await f.building();f.values.set(IMPORT,true);
  await run(f,'queued');assert.equal(f.values.get(IMPORT),true);assert.equal(!!f.values.get(RECOVERY),false);
  await f.write("UPDATE sync_jobs SET state='disabled' WHERE id=?",id);await run(f,'idle');assert.equal(f.values.get(RECOVERY),true);assert.equal(f.values.get(IMPORT),false);
});

test('false hint is invocation-local and cannot bypass recovery on the next unrelated projection',async t=>{
  const f=fixture(t,{events:0,players:0}),first=await f.building();await run(f,'queued');assert.equal(!!f.values.get(RECOVERY),false);
  await f.write("UPDATE sync_jobs SET state='disabled' WHERE id=?",first);await f.enqueue({resource:'another'});f.collector(async()=>({statements:[],complete:false}));
  await run(f,'queued');assert.equal(f.values.get(RECOVERY),true);
});

test('terminal cleanup recovers a legacy fan-out larger than 128 seasons through real recovery pagination',async t=>{
  const f=fixture(t,{events:0,players:0,recoveryProjections:true,extraSeasons:130});
  await f.write('UPDATE team_projection_state SET pending=0,published_input_revision=input_revision WHERE team_season_id=?','season');
  await f.enqueue({checkpoint:{phase:'cleanup'}});await run(f,'ready');assert.equal(f.values.get(RECOVERY),true);
  while(f.values.get(RECOVERY))await run(f,'recovering_connections');
  assert.equal(f.one("SELECT COUNT(*) n FROM sync_jobs WHERE provider='domain' AND component='projection' AND resource_key LIKE 'extra-%'").n,130);
  assert.equal(f.one("SELECT COUNT(*) n FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.resource_key LIKE 'extra-%'").n,130);
  assert.ok(f.recoveries.length>26,'Recovery retains bounded continuation pages');assert.notEqual(f.alarm,null);
  assert.deepEqual(f.rows('PRAGMA foreign_key_check'),[]);assert.deepEqual(f.one('SELECT writer_mode,writer_epoch,permit_guard FROM installation_upgrade'),{writer_mode:null,writer_epoch:null,permit_guard:null});
});


test('interruption after a safe commit preserves its checkpoint and a concurrent durable wake',async t=>{
  const f=fixture(t,{events:1,players:0}),id=await f.building();
  f.hook(async()=>{await f.runtime.wake();});f.failNextPut(key=>key==='last_run');
  await run(f,'error');assert.equal(f.one('SELECT pages_saved FROM sync_jobs WHERE id=?',id).pages_saved,1);
  assert.equal(JSON.parse(f.one('SELECT checkpoint FROM sync_jobs WHERE id=?',id).checkpoint).cursor,'event-000');
  assert.equal(f.one('SELECT COUNT(*) n FROM team_event_rows').n,1);assert.equal(f.values.get(RECOVERY),true);
  f.restart();await run(f,'recovering_connections');await run(f,'queued');
  assert.equal(f.pages.at(-1).before.cursor,'event-000');assert.equal(f.pages.at(-1).page.checkpoint.phase,'players');
  assert.equal(f.one('SELECT COUNT(*) n FROM team_event_rows').n,1);
});

test('a superseded lease cannot commit safe projection writes or consume a wake',async t=>{
  const f=fixture(t,{events:1,players:0}),id=await f.building();
  f.hook(async()=>{await f.write('UPDATE sync_jobs SET generation=generation+1 WHERE id=?',id);await f.runtime.wake();});
  const result=await run(f,'lease_lost');assert.equal(result.committed,false);assert.equal(f.one('SELECT COUNT(*) n FROM team_event_rows').n,0);
  assert.equal(f.values.get(RECOVERY),true);f.restart();await run(f,'recovering_connections');
});

test('a projection name on another stage cannot opt out through a false hint',async t=>{
  const f=fixture(t,{events:0,players:0});await f.enqueue({stage:'source'});
  f.collector(async()=>({statements:[],complete:false,recoveryRequired:false}));
  await run(f,'queued');assert.equal(f.values.get(RECOVERY),true);
});

test('cleanup never deletes the published pointer even if its run is marked obsolete',async t=>{
  const f=fixture(t,{events:1,players:0});await f.building();
  const page=await directPage(f,{runId:'building',inputRevision:1,phase:'events',cursor:''});
  await f.db.batch(page.statements.map(s=>f.db.prepare(s.sql.replaceAll('$FENCE','1')).bind(...s.params)));
  await f.write("UPDATE team_projection_runs SET state='obsolete' WHERE id='building'");
  await f.write("UPDATE team_projection_state SET published_run_id='building',published_input_revision=input_revision,pending=0");
  await f.write('UPDATE sync_jobs SET checkpoint=?',JSON.stringify({phase:'cleanup'}));
  await run(f,'ready');assert.equal(f.values.get(RECOVERY),true);assert.equal(f.one('SELECT COUNT(*) n FROM team_events').n,1);assert.equal(f.one('SELECT COUNT(*) n FROM team_projection_runs').n,1);
});
