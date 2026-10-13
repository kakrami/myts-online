import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {COACH_SCHEMA} from '../src/coaching/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {FreshInstallation} from '../src/application/fresh-install.js';
import {InstallationUpgrade} from '../src/application/schema-upgrade.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {BudgetDB} from '../src/sync/budget.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {collectApplicationJob} from '../src/application/sync-service.js';
import {buildConnectionPage} from '../src/domain/connection-materializer.js';
import {readConnectionEventBatch,CONNECTION_EVENT_BATCH_LIMITS} from '../src/domain/connection-event-batch.js';

const AT='2026-10-12T00:00:00Z',ROOT='teamsnap/account/team';
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
async function fixture({full=false,seasons=[2022,2023,2024,2025,2026],events=0,players=0,evidence='{}'}={}){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');const reads=[];
  const prepare=(sql,params=[])=>({sql,params,bind(...values){return prepare(sql,values);},async all(){const results=sqlite.prepare(sql).all(...params).map(row=>({...row}));if(/^\s*(SELECT|WITH|EXPLAIN)/.test(sql))reads.push({sql,params,rows:results.length,bytes:bytes(results)});return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}};},async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;},async run(){return this.all();}});
  const raw={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  if(full){const fresh=new FreshInstallation(raw,{schema:SCHEMA,seed:SEED,bootstrapPassword:'batch-fixture-password'});while((await fresh.inspect()).state!=='ready')await fresh.advance('batch-fixture-password');}else for(const sql of [...DOMAIN_SCHEMA,...ANALYSIS_SCHEMA,...COACH_SCHEMA,...TEAM_FEATURE_SCHEMA])sqlite.exec(sql);
  const db=full?wrapDatabase(raw):raw,insert=(table,row)=>db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row)).run();
  if(!full)await insert('domain_installation',{id:1,schema_version:1,created_at:AT});
  await insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'account-native',name:'Owner'});
  await insert('source_teams',{id:ROOT,provider:'teamsnap',scope:'account',account_id:'account',native_id:'team',name:'Team',name_authority:1,archived:0,evidence:'{}',content_hash:'root',observed_at:AT});
  await insert('app_teams',{id:'team',name:'Team',timezone:'America/Los_Angeles',season_year:0,created_at:AT});await insert('team_read_state',{app_team_id:'team'});
  await insert('team_source_connections',{id:'root',app_team_id:'team',source_team_id:ROOT,account_id:'account',scope_mode:'observed_history',created_at:AT});
  for(const year of seasons){await insert('team_seasons',{id:'season-'+year,app_team_id:'team',year,start_day:`${year}-06-01`,end_day:`${year+1}-06-01`,start_at:`${year}-06-01T07:00:00Z`,end_at:`${year+1}-06-01T07:00:00Z`,include_june:0});await insert('team_projection_state',{team_season_id:'season-'+year,app_team_id:'team',pending:0});}
  for(let i=0;i<players;i++)await insert('source_players',{id:'player-'+i,provider:'teamsnap',scope:'account',account_id:'account',native_id:'player-'+i,name:'Historical 雪 '+i,jersey:String(i),evidence:'{}',content_hash:'player',observed_at:AT});
  async function event(index,{year=2022+index%5,day=`${year}-08-04`,id='event-'+String(index).padStart(5,'0'),source='source-'+String(index).padStart(5,'0'),team=ROOT,provider='teamsnap',account='account',canonical=true,override={}}={}){
    await insert('source_events',{id:source,provider,scope:account??'public',account_id:account,native_id:source,local_day:day,time_precision:day?'day':'pending',type:'game',status:'FINAL',conditional:0,home_source_team_id:team,home_label:'Us',away_label:'Them',title:'Game',venue:'',evidence,content_hash:'hash-'+source,observed_at:AT,...override});
    await insert('source_event_teams',{source_team_id:team,source_event_id:source,side:'home'});if(canonical)await insert('events',{id,created_at:AT});await insert('event_source_links',{source_event_id:source,event_id:id,reason:'native',evidence:'{}'});
    for(let i=0;i<players&&account;i++)await insert('source_attendance',{id:source+'-attendance-'+i,account_id:account,source_team_id:team,source_event_id:source,source_player_id:'player-'+i,status:'yes',content_hash:'attendance',observed_at:AT});return {id,source};
  }
  for(let i=0;i<events;i++)await event(i);
  const root=()=>({...sqlite.prepare("SELECT r.*,t.timezone,a.generation AS account_generation FROM team_source_connections r JOIN app_teams t ON t.id=r.app_team_id LEFT JOIN provider_accounts a ON a.id=r.account_id WHERE r.id='root'").get()});
  const cp=after=>({phase:'events',after:after??'',generation:1,timezone:'America/Los_Angeles',inputRevision:root().input_revision,passRevision:root().input_revision});
  const page=(checkpoint=cp(),database=db)=>buildConnectionPage(database,{connectionId:'root',teamId:'team',generation:1,checkpoint});
  const commit=(page,{fence='1',fail=false}={})=>db.batch([...page.statements.map(s=>db.prepare(s.sql.replaceAll('$FENCE',fence)).bind(...s.params)),...(fail?[db.prepare('INSERT INTO domain_import_preconditions VALUES(1,1,0)')]:[])]);
  const snapshot=()=>Object.fromEntries(['team_event_season_resolutions','connection_event_resolutions','connection_roster_evidence','team_connection_seasons','team_source_attachments','team_projection_state'].map(table=>[table,sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
  return {sqlite,raw,db,insert,event,root,cp,page,commit,snapshot,reads,close:()=>sqlite.close()};
}

test('24 common events share six reads, 12 writes, all five seasons and dense attendance',async()=>{
  const f=await fixture({events:25,players:30,evidence:JSON.stringify({text:'雪'.repeat(21000)})});try{f.reads.length=0;const before=f.root().input_revision,page=await f.page();assert.equal(page.checkpoint.after,'event-00023');assert.equal(f.reads.length,6);assert.equal(page.statements.length,12);assert.ok(f.reads.reduce((n,r)=>n+r.bytes,0)<50000,'64 KB provider evidence does not cross the binding');assert.ok(bytes(page.statements.map(s=>s.params))<1000000);await f.commit(page);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_event_resolutions').get().n,24);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_roster_evidence').get().n,720);assert.deepEqual(f.sqlite.prepare('SELECT input_revision FROM team_projection_state').all().map(r=>r.input_revision),[1,1,1,1,1]);assert.equal(f.root().input_revision,before,'batch outputs do not make the root catch itself up forever');assert.equal(page.affectedTeams.length,5);const next=await f.page(page.checkpoint);assert.equal(next.checkpoint.after,'event-00024');await f.commit(next);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_event_resolutions').get().n,25);}finally{f.close();}
});

test('interrupted and false-fenced batches leave all prefix writes absent; one changed accepted revision rolls back all',async()=>{
  const f=await fixture({events:24,players:2});try{const page=await f.page(),before=f.snapshot();await assert.rejects(f.commit(page,{fail:true}));assert.deepEqual(f.snapshot(),before);await f.commit(page,{fence:'0'});assert.deepEqual(f.snapshot(),before);const replay=await f.page();assert.deepEqual(replay,page);await f.commit(page);const saved=f.snapshot();await assert.rejects(f.commit(replay));assert.deepEqual(f.snapshot(),saved);assert.equal(page.checkpoint.after,'event-00023');}finally{f.close();}
});

test('root generation, input revision, timezone, account generation and lifecycle fence the whole prepared batch',async()=>{
  for(const mutation of ["UPDATE team_source_connections SET active=0","UPDATE team_source_connections SET generation=generation+1","UPDATE team_source_connections SET input_revision=input_revision+1","UPDATE app_teams SET timezone='UTC'","UPDATE provider_accounts SET generation=generation+1","INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES('team','deleting','now')"]){const f=await fixture({events:3});try{const page=await f.page();f.sqlite.exec(mutation);await assert.rejects(f.commit(page));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_event_resolutions').get().n,0);}finally{f.close();}}
});

test('missing season and later exceptional move admit only the preceding prefix',async()=>{
  const f=await fixture({seasons:[2022],events:0});try{await f.event(0,{year:2022});await f.event(1,{year:2023});await f.event(2,{year:2022});let page=await f.page();assert.equal(page.checkpoint.after,'event-00000');await f.commit(page);const after=page.checkpoint;page=await f.page(after);assert.equal(page.checkpoint.after,after.after,'creation is committed without advancing the missing event');assert.equal(page.statements.length,4);await f.commit(page);page=await f.page(page.checkpoint);assert.equal(page.checkpoint.after,'event-00002');await f.commit(page);
    f.sqlite.exec("UPDATE source_events SET local_day='2023-08-04' WHERE id='source-00001';UPDATE source_events SET local_day='2023-08-04' WHERE id='source-00002'");
    page=await f.page(f.cp());assert.equal(page.checkpoint.after,'event-00001','prefix stops before cross-season accepted membership');await f.commit(page);page=await f.page(page.checkpoint);assert.equal(page.checkpoint.after,'event-00002');await f.commit(page);assert.equal(f.sqlite.prepare("SELECT team_season_id FROM team_event_season_resolutions WHERE event_id='event-00002'").get().team_season_id,f.sqlite.prepare('SELECT id FROM team_seasons WHERE year=2023').get().id);
  }finally{f.close();}
});

test('fixed scope, explicit exclusions, undated dates and imported participation retain authority',async()=>{
  const f=await fixture({events:0,players:1});try{await f.event(0,{year:2022});await f.event(1,{year:2023});await f.event(2,{day:null});await f.insert('team_connection_seasons',{connection_id:'root',team_season_id:'season-2022',basis:'fixed',active:1});await f.insert('team_connection_seasons',{connection_id:'root',team_season_id:'season-2023',basis:'fixed',active:1,excluded:1});f.sqlite.exec("UPDATE team_source_connections SET scope_mode='fixed_seasons';UPDATE source_attendance SET provenance='file_import'");const page=await f.page();await f.commit(page);assert.deepEqual(f.sqlite.prepare('SELECT source_event_id,state,team_season_id FROM connection_event_resolutions ORDER BY source_event_id').all().map(r=>({...r})),[{source_event_id:'source-00000',state:'resolved',team_season_id:'season-2022'},{source_event_id:'source-00001',state:'excluded',team_season_id:null},{source_event_id:'source-00002',state:'pending',team_season_id:null}]);const old=f.sqlite.prepare('SELECT * FROM connection_roster_evidence').get();assert.equal(old.certainty,'preserved_uncertain');assert.equal(old.jersey,null);f.sqlite.exec("UPDATE source_players SET name='Current name',jersey='99'");await f.commit(await f.page(f.cp()));assert.equal(f.sqlite.prepare('SELECT name FROM connection_roster_evidence').get().name,old.name);
  }finally{f.close();}
});

test('canonical terminal selection equals the previous view for linked roots and aliases in strict after order',async()=>{
  const f=await fixture({events:12});try{await f.insert('source_teams',{id:'linked',provider:'teamsnap',scope:'account',account_id:'account',native_id:'linked',name:'Linked',name_authority:1,archived:0,evidence:'{}',content_hash:'linked',observed_at:AT});await f.insert('source_team_links',{a:ROOT,b:'linked',kind:'provider_external_key',evidence:'{}'});await f.event(20,{team:'linked'});await f.insert('event_aliases',{merged_id:'event-00001',canonical_id:'event-00002'});await f.insert('event_aliases',{merged_id:'event-00002',canonical_id:'event-00003'});for(const after of ['', 'event-00003','event-00010']){const reference=f.sqlite.prepare("WITH sources AS(SELECT source_team_id AS id FROM team_source_connections WHERE id='root' UNION SELECT b FROM source_team_links WHERE a=? UNION SELECT a FROM source_team_links WHERE b=?) SELECT DISTINCT c.canonical_id AS id FROM source_event_teams st JOIN event_source_links l ON l.source_event_id=st.source_event_id JOIN canonical_event_ids c ON c.input_id=l.event_id WHERE st.source_team_id IN(SELECT id FROM sources) AND c.canonical_id>? ORDER BY c.canonical_id LIMIT 24").all(ROOT,ROOT,after).map(row=>row.id);const actual=[];let checkpoint=f.cp(after);for(let i=0;i<reference.length;i++){const page=await f.page(checkpoint);assert.equal(page.checkpoint.phase,'events');actual.push(page.checkpoint.after);await f.commit(page);checkpoint=page.checkpoint;}assert.deepEqual(actual,reference);if(!after)assert.equal(JSON.parse(f.sqlite.prepare("SELECT evidence FROM team_event_season_resolutions WHERE event_id='event-00003'").get().evidence).length,3);}}finally{f.close();}
});

test('a behind-cursor source edit retains passRevision and starts a complete catch-up pass',async()=>{
  const f=await fixture({events:25});try{const cp=f.cp(),first=await f.page(cp);await f.commit(first);f.sqlite.exec("UPDATE source_events SET local_day='2024-09-12' WHERE id='source-00000'");let checkpoint=first.checkpoint,sawRestart=false;for(let i=0;i<30;i++){const page=await f.page(checkpoint);await f.commit(page);checkpoint=page.checkpoint;if(checkpoint.phase==='boundaries'){sawRestart=true;assert.notEqual(checkpoint.passRevision,cp.passRevision);break;}}assert.equal(sawRestart,true);for(let i=0;i<80;i++){const page=await f.page(checkpoint);await f.commit(page);checkpoint=page.checkpoint;if(page.complete)break;}assert.equal(checkpoint.finished,true);assert.equal(f.sqlite.prepare("SELECT effective_day FROM team_event_season_resolutions WHERE event_id='event-00000'").get().effective_day,'2024-09-12');}finally{f.close();}
});

test('full installation, claim, writer epoch, projection children and commit stay within 50 SQL statements',async()=>{
  const f=await fixture({full:true,events:24,players:20});try{const coordinator=new JobCoordinator(f.db,{publicHistory:true}),jobId=await coordinator.enqueue({provider:'domain',stage:'projection',component:'connection',scope:'team',resourceKey:'root',args:{connectionId:'root',teamId:'team',generation:1},recurring:false},[{kind:'team',key:'connection:root',teamId:'team',generation:1}]);await f.db.prepare('UPDATE sync_jobs SET checkpoint=? WHERE id=?').bind(JSON.stringify(f.cp()),jobId).run();f.reads.length=0;const budget=new BudgetDB(f.raw,50),wrapped=wrapDatabase(budget),jobs=new JobCoordinator(wrapped,{publicHistory:true});await new InstallationUpgrade(budget,{schema:SCHEMA,seed:SEED}).inspect();assert.equal(budget.used,2);const lease=await jobs.claim();assert.equal(budget.used,7);const page=await collectApplicationJob({db:wrapped,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});assert.equal(page.checkpoint.after,'event-00023');assert.equal(page.children.length,0);const saved=await jobs.commit(lease,page);assert.equal(saved.committed,true);assert.ok(budget.used<=50);assert.equal(f.sqlite.prepare('SELECT writer_mode FROM installation_upgrade').get().writer_mode,null);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);console.log(JSON.stringify({connection_batch_events:24,attendance:480,reads:f.reads.map(r=>({rows:r.rows,bytes:r.bytes})),parameter_bytes:page.statements.reduce((n,s)=>n+bytes(s.params),0),invocation_statements:budget.used}));}finally{f.close();}
});

test('roster density shrinks only the admitted prefix and a single dense game retains legacy acceptance',async()=>{
  const f=await fixture({events:24,players:60});try{const first=await f.page();assert.equal(first.checkpoint.after,'event-00016');await f.commit(first);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_roster_evidence').get().n,1020);const next=await f.page(first.checkpoint);assert.equal(next.checkpoint.after,'event-00023');await f.commit(next);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_event_resolutions').get().n,24);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_roster_evidence').get().n,1440);}finally{f.close();}
  const dense=await fixture({events:2,players:1025});try{const first=await dense.page();assert.equal(first.checkpoint.after,'event-00000');await dense.commit(first);const second=await dense.page(first.checkpoint);assert.equal(second.checkpoint.after,'event-00001');await dense.commit(second);assert.equal(dense.sqlite.prepare('SELECT count(*) n FROM connection_roster_evidence').get().n,2050);}finally{dense.close();}
});

test('aggregate UTF-8 source bytes stop at a complete event and keep the unadmitted tail for the next page',async()=>{
  const f=await fixture({events:0});try{for(let i=0;i<24;i++){const id='event-'+String(i).padStart(5,'0');for(let observation=0;observation<16;observation++)await f.event(i,{id,source:'source-'+String(i).padStart(5,'0')+'-'+observation+'-'+ '雪'.repeat(150),canonical:observation===0});}f.reads.length=0;const page=await f.page();const count=Number(page.checkpoint.after.slice(-5))+1;assert.ok(count>1&&count<24);const sourceRead=f.reads.find(read=>read.sql.includes('AS data FROM bounded'));assert.ok(sourceRead.bytes<=CONNECTION_EVENT_BATCH_LIMITS.sourceBytes,JSON.stringify(sourceRead));assert.ok(page.statements.reduce((n,s)=>n+bytes(s.params),0)<=CONNECTION_EVENT_BATCH_LIMITS.parameterBytes);await f.commit(page);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM team_event_season_resolutions').get().n,count);let checkpoint=page.checkpoint;for(let n=0;n<24;n++){const next=await f.page(checkpoint);await f.commit(next);checkpoint=next.checkpoint;if(checkpoint.phase!=='events')break;}assert.equal(f.sqlite.prepare('SELECT count(*) n FROM team_event_season_resolutions').get().n,24);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_event_resolutions').get().n,384);console.log(JSON.stringify({utf8_prefix_events:count,source_result_bytes:sourceRead.bytes,parameter_bytes:page.statements.reduce((n,s)=>n+bytes(s.params),0)}));}finally{f.close();}
});

test('97-observation sentinel never skips a preceding valid prefix or the oversized canonical event',async()=>{
  const f=await fixture({events:1});try{for(let i=0;i<97;i++)await f.event(1,{source:'many-'+i,canonical:i===0});const first=await f.page();assert.equal(first.checkpoint.after,'event-00000');await f.commit(first);await assert.rejects(()=>f.page(first.checkpoint),error=>error.code==='record_size');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM team_event_season_resolutions').get().n,1);}finally{f.close();}
});

test('unrelated aliases leave the common prefix enabled and both main reads use indexed event ranges',async()=>{
  const f=await fixture({events:24});try{for(let i=0;i<1200;i++){await f.insert('events',{id:'unrelated-'+String(i).padStart(5,'0'),created_at:AT});if(i%2)await f.insert('event_aliases',{merged_id:'unrelated-'+String(i-1).padStart(5,'0'),canonical_id:'unrelated-'+String(i).padStart(5,'0')});}f.reads.length=0;const page=await f.page();assert.equal(page.checkpoint.after,'event-00023');const candidate=f.reads.find(row=>row.sql.includes('SELECT e.id FROM events e')),source=f.reads.find(row=>row.sql.includes('AS data FROM bounded'));const plans=[candidate,source].map(row=>f.sqlite.prepare('EXPLAIN QUERY PLAN '+row.sql).all(...row.params).map(row=>row.detail));assert.ok(plans[0].some(row=>/SEARCH e USING COVERING INDEX.*\(id>\?\)/.test(row)),JSON.stringify(plans[0]));assert.ok(plans[0].some(row=>/event_links_canonical.*event_id=\?/.test(row)),JSON.stringify(plans[0]));assert.ok(plans[1].some(row=>/event_links_canonical.*event_id=\?/.test(row)),JSON.stringify(plans[1]));assert.ok(!source.sql.includes('canonical_event_ids'));console.log(JSON.stringify({unrelated_aliases:600,candidate_plan:plans[0],source_plan:plans[1]}));}finally{f.close();}
});

test('one valid event beyond the batch byte cap uses the original reader without losing its cursor',async()=>{
  const f=await fixture({events:0});try{for(let i=0;i<10;i++)await f.event(0,{source:'large-period-'+i,canonical:i===0});await f.event(1);f.sqlite.prepare('UPDATE source_teams SET evidence=?').run(JSON.stringify({season_start_date:'雪'.repeat(10000)}));f.reads.length=0;const page=await f.page();assert.equal(page.checkpoint.after,'event-00000');assert.ok(f.reads.some(row=>row.sql.includes('SELECT DISTINCT e.*')),'the first oversized compact read retains legacy single-game acceptance');await f.commit(page);const next=await f.page(page.checkpoint);assert.equal(next.checkpoint.after,'event-00001');await f.commit(next);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_event_resolutions').get().n,11);}finally{f.close();}
});

async function invocation(f,checkpoint){
  const coordinator=new JobCoordinator(f.db,{publicHistory:true}),jobId=await coordinator.enqueue({provider:'domain',stage:'projection',component:'connection',scope:'team',resourceKey:'root',args:{connectionId:'root',teamId:'team',generation:1},recurring:false},[{kind:'team',key:'connection:root',teamId:'team',generation:1}]);
  await f.db.prepare('UPDATE sync_jobs SET checkpoint=?,next_at=0 WHERE id=?').bind(JSON.stringify(checkpoint),jobId).run();
  const budget=new BudgetDB(f.raw,50),wrapped=wrapDatabase(budget),jobs=new JobCoordinator(wrapped,{publicHistory:true});await new InstallationUpgrade(budget,{schema:SCHEMA,seed:SEED}).inspect();const lease=await jobs.claim();assert.equal(lease.id,jobId);assert.equal(budget.used,7);const page=await collectApplicationJob({db:wrapped,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});const readStatements=budget.used-7;assert.equal((await jobs.commit(lease,page)).committed,true);return {page,used:budget.used,readStatements};
}

test('move, destination collision, owner-scope conflict and terminal children include all runtime SQL overhead',async()=>{
  const measured=[];
  for(const scenario of ['move','collision','owner_scope','overflow_move','overflow_collision']){const f=await fixture({full:true,events:0,players:1});try{await f.event(0,{year:scenario==='owner_scope'?2022:2023});await f.insert('team_source_attachments',{id:'attachment-old',app_team_id:'team',team_season_id:'season-2022',source_team_id:ROOT,account_id:'account'});await f.insert('team_connection_seasons',{connection_id:'root',team_season_id:'season-2022',attachment_id:'attachment-old',basis:'events'});await f.insert('team_event_season_resolutions',{app_team_id:'team',event_id:'event-00000',team_season_id:'season-2022',state:'resolved',effective_day:'2022-08-04',local_day:'2022-08-04',basis:'event',evidence:'[]',revision:7});await f.insert('analysis_lineup_headers',{app_team_id:'team',team_season_id:'season-2022',event_id:'event-00000',format:9,revision:4,updated_at:AT});await f.insert('coach_sessions',{app_team_id:'team',team_season_id:'season-2022',event_id:'event-00000',format:9,half_minutes:25,phase:'running',period:2,elapsed_ms:60000,period_start_ms:50000,running_since:AT,clock_review:0,revision:12,updated_at:AT,write_token:'saved-token'});if(scenario.includes('collision'))await f.insert('analysis_lineup_headers',{app_team_id:'team',team_season_id:'season-2023',event_id:'event-00000',format:7,revision:5,updated_at:AT});if(scenario==='owner_scope'){await f.db.prepare("UPDATE team_source_connections SET scope_mode='fixed_seasons'").run();await f.insert('domain_overrides',{app_team_id:'team',kind:'event',entity_id:'event-00000',fields:'{"local_day":"2023-08-04"}',revision:1});}
    if(scenario.startsWith('overflow_')){for(let i=0;i<9;i++)await f.event(0,{year:2023,source:'overflow-'+i,canonical:false});await f.db.prepare('UPDATE source_teams SET evidence=?').bind(JSON.stringify({season_start_date:'雪'.repeat(10000)})).run();}
    const result=await invocation(f,f.cp());assert.equal(result.page.checkpoint.after,'event-00000');assert.ok(result.used<=50);const resolution=f.sqlite.prepare('SELECT * FROM team_event_season_resolutions').get(),coach=f.sqlite.prepare('SELECT * FROM coach_sessions').get();if(scenario.endsWith('move')){assert.equal(resolution.team_season_id,'season-2023');assert.equal(coach.team_season_id,'season-2023');assert.equal(coach.revision,13);}else {assert.equal(resolution.state,'conflict');assert.equal(resolution.team_season_id,'season-2022');assert.equal(coach.team_season_id,'season-2022');assert.equal(coach.revision,12);}assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);measured.push({scenario,statements:result.used,materializer_reads:result.readStatements});
    const unchanged=f.snapshot();await f.commit(await f.page(f.cp()));assert.deepEqual(f.snapshot(),unchanged,'a second accepted move/conflict pass preserves its exact materialized meaning');
    // The actual terminal page, rather than ordinary event pages, sends children.
    const terminal=await invocation(f,{...f.cp(),phase:'finish'});assert.equal(terminal.page.complete,true);assert.ok(terminal.page.children.length>0);assert.ok(terminal.used<=50);measured.push({scenario:scenario+'_terminal',children:terminal.page.children.length,statements:terminal.used});
  }finally{f.close();}}
  console.log(JSON.stringify({connection_fallback_full_invocations:measured}));
});

test('coordinator commits the cursor only with the whole batch and safely replays an interrupted transaction',async()=>{
  const f=await fixture({full:true,events:24,players:2});try{const jobs=new JobCoordinator(f.db,{publicHistory:true}),jobId=await jobs.enqueue({provider:'domain',stage:'projection',component:'connection',scope:'team',resourceKey:'root',args:{connectionId:'root',teamId:'team',generation:1},recurring:false},[{kind:'team',key:'connection:root',teamId:'team',generation:1}]),checkpoint=f.cp();await f.db.prepare('UPDATE sync_jobs SET checkpoint=? WHERE id=?').bind(JSON.stringify(checkpoint),jobId).run();const lease=await jobs.claim(),page=await collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});const interrupted={...page,statements:[...page.statements,{sql:'INSERT INTO domain_import_preconditions(id,expected_value,actual_value) SELECT 1,1,0 WHERE $FENCE',params:[]}]};await assert.rejects(()=>jobs.commit(lease,interrupted));const saved=f.sqlite.prepare('SELECT checkpoint,pages_saved FROM sync_jobs WHERE id=?').get(jobId);assert.deepEqual(JSON.parse(saved.checkpoint),checkpoint);assert.equal(saved.pages_saved,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_event_resolutions').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM team_source_attachments').get().n,0);assert.equal(f.sqlite.prepare('SELECT writer_mode FROM installation_upgrade').get().writer_mode,null);assert.equal((await jobs.commit(lease,page)).committed,true);const committed=f.sqlite.prepare('SELECT checkpoint,pages_saved FROM sync_jobs WHERE id=?').get(jobId);assert.equal(JSON.parse(committed.checkpoint).after,'event-00023');assert.equal(committed.pages_saved,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM connection_event_resolutions').get().n,24);}finally{f.close();}
});

const seasonInputs=f=>Object.fromEntries(f.sqlite.prepare('SELECT team_season_id,input_revision FROM team_projection_state ORDER BY team_season_id').all().map(row=>[row.team_season_id,row.input_revision]));
const canonicalRevisions=f=>Object.fromEntries(f.sqlite.prepare('SELECT event_id,revision FROM team_event_season_resolutions ORDER BY event_id').all().map(row=>[row.event_id,row.revision]));
function assertDirty(f,before,ids){const dirty=new Set(ids);for(const [id,input] of Object.entries(seasonInputs(f)))assert.equal(input-before[id],dirty.has(id)?1:0,id);}
async function completePass(f){let checkpoint={};for(let i=0;i<300;i++){const page=await f.page(checkpoint);await f.commit(page);checkpoint=page.checkpoint;if(page.complete)return checkpoint;}assert.fail('connection pass did not finish');}
async function coordinatedPass(f,{refresh=false}={}){
  let at=Date.now();const jobs=new JobCoordinator(f.db,{publicHistory:true,clock:()=>at,pageDelayMs:0});
  await f.db.prepare("UPDATE sync_jobs SET next_at=? WHERE component='projection'").bind(at+86400000).run();
  const [jobId]=await jobs.enqueueMany([{provider:'domain',stage:'projection',component:'connection',scope:'team',resourceKey:'root',args:{connectionId:'root',teamId:'team',generation:1,inputRevision:f.root().input_revision},priority:100,recurring:false}],[{kind:'team',key:'connection:root',teamId:'team',generation:1}],{refresh});
  for(let i=0;i<300;i++){at+=1000;const lease=await jobs.claim();assert.equal(lease?.id,jobId);const page=await collectApplicationJob({db:f.db,env:{},lease,args:lease.args,checkpoint:lease.checkpoint});assert.equal((await jobs.commit(lease,page)).committed,true);if(page.complete)return;}
  assert.fail('coordinator pass did not finish');
}

test('complete coordinated batched and aliased passes do not dirty identical materialized state',async()=>{
  for(const aliased of [false,true]){const f=await fixture({full:true,events:25,players:2});try{
    if(aliased){await f.db.prepare("UPDATE source_events SET local_day='2022-08-04' WHERE id='source-00001'").run();await f.insert('event_aliases',{merged_id:'event-00000',canonical_id:'event-00001'});}
    await coordinatedPass(f);const before=f.snapshot(),root=f.root(),sources=f.sqlite.prepare('SELECT * FROM source_attendance ORDER BY id').all();
    await coordinatedPass(f,{refresh:true});assert.deepEqual(f.snapshot(),before);assert.equal(f.root().input_revision,root.input_revision);assert.equal(f.root().reconciled_revision,root.input_revision);assert.deepEqual(f.sqlite.prepare('SELECT * FROM source_attendance ORDER BY id').all(),sources);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.close();}}
});

test('dense single-game fallback and no-op canonical CAS keep revisions stable',async()=>{
  const f=await fixture({events:1,players:1025});try{await completePass(f);const before=f.snapshot(),replay=await f.page();assert.deepEqual(replay.affectedTeams,[]);await f.commit(replay);assert.deepEqual(f.snapshot(),before);
    const stale=await f.page();f.sqlite.exec('UPDATE team_event_season_resolutions SET revision=revision+1');const concurrent=f.snapshot();await assert.rejects(f.commit(stale));assert.deepEqual(f.snapshot(),concurrent);
  }finally{f.close();}
});

test('canonical date, season and evidence changes dirty only their old and new seasons',async()=>{
  const f=await fixture({events:2,players:1});try{await completePass(f);
    let before=seasonInputs(f),revisions=canonicalRevisions(f);f.sqlite.exec("UPDATE source_events SET local_day='2022-09-04' WHERE id='source-00000'");let page=await f.page();await f.commit(page);assertDirty(f,before,['season-2022']);assert.deepEqual(canonicalRevisions(f),{...revisions,'event-00000':revisions['event-00000']+1});
    before=seasonInputs(f);f.sqlite.exec("UPDATE source_events SET local_day='2024-09-04' WHERE id='source-00000'");page=await f.page();await f.commit(page);assertDirty(f,before,['season-2022','season-2024']);assert.equal(f.sqlite.prepare("SELECT team_season_id FROM connection_roster_evidence WHERE source_event_id='source-00000'").get().team_season_id,'season-2024');
    before=seasonInputs(f);revisions=canonicalRevisions(f);await f.event(1,{source:'extra-evidence',canonical:false});page=await f.page();await f.commit(page);assertDirty(f,before,['season-2023']);assert.deepEqual(canonicalRevisions(f),{...revisions,'event-00001':revisions['event-00001']+1});
    before=seasonInputs(f);revisions=canonicalRevisions(f);f.sqlite.exec("UPDATE source_events SET content_hash='new content, same date' WHERE id='source-00001'");await f.commit(await f.page());assertDirty(f,before,['season-2023']);assert.deepEqual(canonicalRevisions(f),revisions,'receipt hash changes do not invent a canonical calendar revision');
    before=seasonInputs(f);f.sqlite.exec("UPDATE connection_event_resolutions SET generation=2 WHERE source_event_id='source-00001'");await f.commit(await f.page());assertDirty(f,before,['season-2023']);
  }finally{f.close();}
});

test('game roster fields, certainty, precedence timestamps, inserts and removals are material changes',async()=>{
  for(const aliased of [false,true]){const f=await fixture({events:2,players:1});try{
    if(aliased){await f.insert('events',{id:'event-alias',created_at:AT});await f.insert('event_aliases',{merged_id:'event-alias',canonical_id:'event-00000'});}
    await f.insert('source_game_members',{id:'member',account_id:'account',source_team_id:ROOT,source_event_id:'source-00000',native_key:'member',source_player_id:'player-0',side:'home',name:'First name',jersey:'8',dummy:0,position:'GK',evidence:'{}',content_hash:'member hash',observed_at:AT});await completePass(f);
    const revisions=canonicalRevisions(f);
    for(const mutation of ["UPDATE source_game_members SET name='New name'","UPDATE source_game_members SET jersey='12'","UPDATE source_game_members SET position='MF'","UPDATE source_game_members SET provenance='file_import'","UPDATE source_game_members SET observed_at='2026-10-13T01:00:00Z'","UPDATE source_game_members SET content_hash='new hash'","DELETE FROM source_game_members","UPDATE source_attendance SET provenance='file_import' WHERE source_event_id='source-00000'","UPDATE source_attendance SET observed_at='2026-10-13T01:00:00Z' WHERE source_event_id='source-00000'","DELETE FROM source_attendance WHERE source_event_id='source-00000'"]){const before=seasonInputs(f);f.sqlite.exec(mutation);const page=await f.page();await f.commit(page);assertDirty(f,before,['season-2022']);assert.deepEqual(canonicalRevisions(f),revisions);}
    let before=seasonInputs(f);await f.insert('source_attendance',{id:'new attendance',account_id:'account',source_team_id:ROOT,source_event_id:'source-00000',source_player_id:'player-0',status:'yes',content_hash:'new attendance',observed_at:AT});await f.commit(await f.page());assertDirty(f,before,['season-2022']);
    before=seasonInputs(f);f.sqlite.exec("UPDATE source_players SET name='Current profile name',jersey='99'");await f.commit(await f.page());assertDirty(f,before,[]);assert.equal(f.sqlite.prepare("SELECT name FROM connection_roster_evidence WHERE source_event_id='source-00000'").get().name,'Historical 雪 0');
  }finally{f.close();}}
});

test('membership and attachment entitlement repairs dirty only their season',async()=>{
  const f=await fixture({events:2});try{await completePass(f);const revisions=canonicalRevisions(f);
    for(const mutation of ["UPDATE team_source_attachments SET active=0 WHERE team_season_id='season-2022'","UPDATE team_source_attachments SET generation=2 WHERE team_season_id='season-2022'","UPDATE team_connection_seasons SET active=0 WHERE team_season_id='season-2022'","UPDATE team_connection_seasons SET generation=2 WHERE team_season_id='season-2022'"]){const before=seasonInputs(f);f.sqlite.exec(mutation);await f.commit(await f.page());assertDirty(f,before,['season-2022']);assert.deepEqual(canonicalRevisions(f),revisions);}
    let before=seasonInputs(f);f.sqlite.exec("UPDATE team_connection_seasons SET excluded=1 WHERE team_season_id='season-2022'");await f.commit(await f.page());assertDirty(f,before,['season-2022']);before=seasonInputs(f);await f.commit(await f.page());assertDirty(f,before,[]);
  }finally{f.close();}
});

test('dated roster suppression is a no-op while actual snapshots, certainty and validity still dirty',async()=>{
  const f=await fixture({players:1});try{
    await f.insert('source_roster_memberships',{source_team_id:ROOT,source_player_id:'player-0',active:1,scan_id:'roster'});f.sqlite.prepare('UPDATE source_players SET evidence=?,observed_at=?').run(JSON.stringify({roster_start_date:'2022-06-01',roster_end_date:'2023-05-31',position:'GK'}),'2022-08-01T12:00:00Z');await completePass(f);
    const rosterPage=()=>f.page({...f.cp(),phase:'roster',after:'',yearIndex:0});let before=seasonInputs(f),saved=f.snapshot().connection_roster_evidence;await f.commit(await rosterPage());assertDirty(f,before,[]);
    f.sqlite.exec("UPDATE source_players SET name='Today',jersey='99',observed_at='2026-10-13T12:00:00Z',content_hash='today'");await f.commit(await rosterPage());assertDirty(f,before,[]);assert.deepEqual(f.snapshot().connection_roster_evidence,saved);
    f.sqlite.exec("UPDATE connection_roster_evidence SET certainty='preserved_uncertain'");await f.commit(await rosterPage());assertDirty(f,before,['season-2022']);assert.equal(f.snapshot().connection_roster_evidence[0].certainty,'verified');
    before=seasonInputs(f);f.sqlite.exec("UPDATE source_players SET name='In period',jersey='12',observed_at='2022-09-01T12:00:00Z',content_hash='in period'");await f.commit(await rosterPage());assertDirty(f,before,['season-2022']);assert.equal(f.snapshot().connection_roster_evidence[0].name,'In period');
    before=seasonInputs(f);f.sqlite.prepare('UPDATE source_players SET evidence=?').run(JSON.stringify({roster_start_date:'2023-06-01',roster_end_date:'2024-05-31'}));await completePass(f);assertDirty(f,before,['season-2022','season-2023']);assert.equal(f.snapshot().connection_roster_evidence.find(row=>row.team_season_id==='season-2022').certainty,'preserved_uncertain');
  }finally{f.close();}
});

test('unchanged prepared pages still reject root, account, timezone and owner races atomically',async()=>{
  for(const aliased of [false,true])for(const mutation of ["UPDATE team_source_connections SET input_revision=input_revision+1","UPDATE team_source_connections SET generation=generation+1","UPDATE provider_accounts SET generation=generation+1","UPDATE app_teams SET timezone='UTC'","INSERT INTO domain_overrides(app_team_id,kind,entity_id,fields,revision) VALUES('team','event','event-00000','{\"local_day\":\"2023-08-04\"}',1)","UPDATE team_event_season_resolutions SET revision=revision+1 WHERE event_id='event-00000'"]){const f=await fixture({events:1,players:1});try{
    if(aliased){await f.insert('events',{id:'event-alias',created_at:AT});await f.insert('event_aliases',{merged_id:'event-alias',canonical_id:'event-00000'});}
    await completePass(f);const page=await f.page();assert.deepEqual(page.affectedTeams,[]);f.sqlite.exec(mutation);const before=f.snapshot();await assert.rejects(f.commit(page));assert.deepEqual(f.snapshot(),before);
  }finally{f.close();}}
});

test('deleted source membership removes its receipt, roster and entitlement without dirtying other seasons',async()=>{
  const f=await fixture({events:2,players:1});try{await completePass(f);f.sqlite.prepare("DELETE FROM source_event_teams WHERE source_event_id='source-00000'").run();
    let before=seasonInputs(f),page=await f.page({...f.cp(),phase:'cleanup'});await f.commit(page);assertDirty(f,before,['season-2022']);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM connection_event_resolutions WHERE source_event_id='source-00000'").get().n,0);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM connection_roster_evidence WHERE source_event_id='source-00000'").get().n,0);
    before=seasonInputs(f);page=await f.page({...f.cp(),phase:'members'});await f.commit(page);assertDirty(f,before,['season-2022']);assert.equal(f.sqlite.prepare("SELECT active FROM team_connection_seasons WHERE team_season_id='season-2022'").get().active,0);assert.equal(f.sqlite.prepare("SELECT active FROM team_source_attachments WHERE team_season_id='season-2022'").get().active,0);
    before=seasonInputs(f);await completePass(f);assertDirty(f,before,[]);
  }finally{f.close();}
});

test('same-day kickoff, authority basis and conflict state are included in canonical equality',async()=>{
  const f=await fixture({events:1});try{await completePass(f);
    for(const change of [async()=>f.sqlite.exec("UPDATE source_events SET starts_at='2022-08-04T18:00:00Z'"),async()=>f.insert('domain_overrides',{app_team_id:'team',kind:'event',entity_id:'event-00000',fields:JSON.stringify({starts_at:'2022-08-04T18:00:00Z'}),revision:1}),async()=>{f.sqlite.exec('DELETE FROM domain_overrides');await f.event(0,{year:2023,source:'contradiction',canonical:false});}]){const before=seasonInputs(f),revisions=canonicalRevisions(f);await change();await f.commit(await f.page());assertDirty(f,before,['season-2022']);assert.equal(canonicalRevisions(f)['event-00000'],revisions['event-00000']+1);const saved=f.snapshot();await f.commit(await f.page());assert.deepEqual(f.snapshot(),saved);}
    assert.equal(f.sqlite.prepare('SELECT state FROM team_event_season_resolutions').get().state,'conflict');
  }finally{f.close();}
});

test('captured change-detection pages compile within native D1 expression100 compound5 parameters100 SQL100k',async t=>{
  const f=await fixture({events:24,players:2});t.after(()=>f.close());const writes=[];
  for(const mutation of [null,null,"UPDATE source_events SET local_day='2024-08-04' WHERE id='source-00000'"]){if(mutation)f.sqlite.exec(mutation);const page=await f.page();writes.push(...page.statements.map(row=>({...row,sql:row.sql.replaceAll('$FENCE','1')})));await f.commit(page);}
  const directory=await mkdtemp(path.join(tmpdir(),'myts-connection-sql-limits-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const database=path.join(directory,'fixture.db'),queries=path.join(directory,'queries.json');await backup(f.sqlite,database);await writeFile(queries,JSON.stringify([...f.reads,...writes]));
  const proof=spawnSync('python3',['-c',`
import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1])
for key,value in [('SQLITE_LIMIT_EXPR_DEPTH',100),('SQLITE_LIMIT_COMPOUND_SELECT',5),('SQLITE_LIMIT_VARIABLE_NUMBER',100),('SQLITE_LIMIT_SQL_LENGTH',100000)]: c.setlimit(getattr(sqlite3,key),value)
queries=json.load(open(sys.argv[2]));seen=set()
for i,q in enumerate(queries):
 if q['sql'] in seen: continue
 seen.add(q['sql'])
 try: c.execute('EXPLAIN '+q['sql'],q['params']).fetchall()
 except Exception as e: raise RuntimeError('query '+str(i)+' failed: '+str(e)+'; SQL='+q['sql'][:500]) from e
print(json.dumps({'queries':len(queries),'uniqueStatements':len(seen),'maxSqlBytes':max(len(q['sql'].encode()) for q in queries),'maxParameters':max(len(q['params']) for q in queries)}))
`,database,queries],{encoding:'utf8',maxBuffer:1_000_000});assert.equal(proof.status,0,proof.stderr);t.diagnostic(proof.stdout.trim());
});
