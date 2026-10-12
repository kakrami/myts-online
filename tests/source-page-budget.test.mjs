import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {FreshInstallation} from '../src/application/fresh-install.js';
import {InstallationUpgrade} from '../src/application/schema-upgrade.js';
import {wrapDatabase} from '../src/application/installation-epoch.js';
import {BudgetDB} from '../src/sync/budget.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {collectApplicationJob} from '../src/application/sync-service.js';
import mockProvider from './mock-provider.js';
import {DomainRepository} from '../src/domain/repository.js';

// Real SQLite transactions and all production schema/source/coordinator/writer
// code. Only the remote response is synthetic. Native D1 has a separate gate.
async function fixture({provider='gotsport',native='720001',seasonal=false,component='history',args={}}={}) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');let onRows=null;
  const prepare=(sql,params=[])=>({sql,params,bind(...values){return prepare(sql,values);},async all(){const rows=sqlite.prepare(sql).all(...params);if(onRows)onRows(sql,rows);return {results:rows.map(row=>({...row})),meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return (await this.all()).results[0]??null;},async run(){return this.all();}});
  const raw={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const fresh=new FreshInstallation(raw,{schema:SCHEMA,seed:SEED,bootstrapPassword:'synthetic-page-budget-password'});
  while((await fresh.inspect()).state!=='ready')await fresh.advance('synthetic-page-budget-password');
  const db=wrapDatabase(raw),insert=(table,row)=>db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row)).run();
  await insert('app_teams',{id:'team',name:'Team',timezone:'America/Los_Angeles',season_year:2026,created_at:new Date().toISOString()});
  await insert('team_read_state',{app_team_id:'team'});
  await insert('team_seasons',{id:'season',app_team_id:'team',year:2026,start_day:'2026-06-01',end_day:'2027-06-01',start_at:'2026-06-01T07:00:00Z',end_at:'2027-06-01T07:00:00Z'});
  await insert('team_projection_state',{team_season_id:'season',app_team_id:'team',pending:0});
  await insert('source_teams',{id:`${provider}/public/${native}`,provider,scope:'public',native_id:native,name:'Team',name_authority:0,archived:0,evidence:'{}',content_hash:'seed',observed_at:new Date().toISOString()});
  await insert('team_source_connections',{id:'root',app_team_id:'team',source_team_id:`${provider}/public/${native}`,scope_mode:'observed_history',created_at:new Date().toISOString()});
  const attach=()=>insert('team_source_attachments',{id:'attached',app_team_id:'team',team_season_id:'season',source_team_id:`${provider}/public/${native}`});if(seasonal)await attach();
  const jobId=await new JobCoordinator(db,{publicHistory:true}).enqueue({provider,component,scope:native,resourceKey:native,args:{team_id:native,timezone:'America/Los_Angeles',...args},recurring:false},[{kind:'team',key:'connection:root',teamId:'team',generation:1}]);
  async function collect(transport){
    // Select this source continuation while retaining all actual saved children.
    await db.prepare('UPDATE sync_jobs SET next_at=CASE WHEN id=? THEN 0 ELSE ? END').bind(jobId,Date.now()+86400000).run();
    const budget=new BudgetDB(raw,50),wrapped=wrapDatabase(budget),coordinator=new JobCoordinator(wrapped,{publicHistory:true});
    await new InstallationUpgrade(budget,{schema:SCHEMA,seed:SEED}).inspect();assert.equal(budget.used,2);
    const lease=await coordinator.claim();assert.equal(lease.id,jobId);assert.equal(budget.used,7);
    const page=await collectApplicationJob({db:wrapped,env:{},lease,args:lease.args,checkpoint:lease.checkpoint},{transportFactory:()=>transport});
    const result=await coordinator.commit(lease,page);assert.equal(result.committed,true);assert.ok(budget.used<=50);
    assert.equal(sqlite.prepare('SELECT writer_mode FROM installation_upgrade').get().writer_mode,null);
    return {page,result,used:budget.used};
  }
  return {sqlite,db,insert,attach,jobId,collect,observeRows:callback=>{onRows=callback;},close:()=>sqlite.close()};
}
function historyGame(i,{newOpponent=false}={}){return {id:830000+i,event_id:30000+i,event_name:'Simulated '+(30000+i),schedule_id:40000+i,bracket_id:50000+i,match_number:830000+i,match_date:null,matchTime:i===100?null:'2026-09-01T18:00:00Z',home_team_reg_id:721001,away_team_reg_id:999000,homeTeam:{team_id:720001,full_name:'Simulated Team 720001'},awayTeam:{team_id:newOpponent?999002:999001,full_name:newOpponent?'New opponent':'Simulated opponent'},home_score:2,away_score:1};}
function transportFor(value,endpoint='https://system.gotsport.com/api/v1/teams/720001/matches') {return {observations:[],async get(){this.observations.push({endpoint,status:200,at:new Date().toISOString(),retrieved_at:new Date().toISOString(),hash:'a'.repeat(64),bytes:JSON.stringify(value).length});return {value};}};}

test('101 real history memberships commit all three pages including terminal receipts inside 50 statements',async()=>{
  for(const newOpponent of [false,true]){
    const f=await fixture();try{
      const matches=Array.from({length:101},(_,i)=>historyGame(i,{newOpponent:newOpponent&&i===100})),counts=[];
      for(let page=1;page<=3;page++){
        if(page===2)await f.attach();
        const saved=await f.collect(transportFor({matches:matches.slice((page-1)*50,page*50),pagination:{current_page:page,total_pages:3,total_entries:101}}));counts.push(saved.used);
        assert.equal(saved.result.state,page===3?'ready':'queued');
        assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_events').get().n,Math.min(page*50,101));
      }
      assert.deepEqual(counts,newOpponent?[45,44,48]:[45,44,46]);
      assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_competition_memberships').get().n,101);
      assert.equal(f.sqlite.prepare("SELECT count(*) n FROM sync_jobs WHERE component IN('event','bridge')").get().n,202);
      assert.equal(f.sqlite.prepare('SELECT pages_saved FROM sync_jobs WHERE id=?').get(f.jobId).pages_saved,3);
      assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT checkpoint FROM sync_jobs WHERE id=?').get(f.jobId).checkpoint),{finished:true});
      assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sync_observations').get().n,3);
      assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
      console.log(JSON.stringify({history_memberships:101,new_terminal_opponent:newOpponent,invocation_statements:counts}));
    }finally{f.close();}
  }
});

test('actual deployment mock Live upcoming page keeps all facts and children at the unchanged 50-statement limit',async()=>{
  const f=await fixture({provider:'live',native:'700',seasonal:true,component:'upcoming',args:{proof:{season:'60',season_name:'2026'}}});
  try{
    const values=new Map(),env={COUNTERS:{async get(key,type){const value=values.get(key);return type==='json'&&value?JSON.parse(value):value;},async put(key,value){values.set(key,value);}}};
    const transport={observations:[],async get(url){const response=await mockProvider.fetch(new Request(url),env),value=await response.json();this.observations.push({endpoint:new URL(url).origin+new URL(url).pathname,status:response.status,at:new Date().toISOString(),hash:'a'.repeat(64),bytes:JSON.stringify(value).length});return {value};}};
    const first=await f.collect(transport);assert.equal(first.used,50);assert.equal(first.result.state,'queued');
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_events').get().n,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_event_teams').get().n,3);
    assert.equal(first.page.children.filter(child=>child.subscriberMode==='inherit').length,4);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_competitions').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_divisions').get().n,1);
    const last=await f.collect({...transport,observations:[]});assert.equal(last.result.state,'ready');assert.equal(f.sqlite.prepare('SELECT pages_saved FROM sync_jobs WHERE id=?').get(f.jobId).pages_saved,2);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_events').get().n,2);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
    console.log(JSON.stringify({deployment_upcoming_statements:first.used,terminal_statements:last.used}));
  }finally{f.close();}
});

test('one side expansion preserves former home-before-away insert, retained sides, nulls, false fence and rollback',async()=>{
  const f=await fixture();let insertion,deletion;
  try{const {page}=await f.collect(transportFor({matches:[historyGame(0)],pagination:{current_page:1,total_pages:1,total_entries:1}}));insertion=page.statements.find(statement=>statement.sql.startsWith('INSERT OR IGNORE INTO source_event_teams')).sql;deletion=page.statements.find(statement=>statement.sql.startsWith('DELETE FROM source_event_teams')).sql;assert.equal(page.statements.filter(statement=>statement.sql.startsWith('INSERT OR IGNORE INTO source_event_teams')).length,1);}finally{f.close();}
  const cases=[{name:'ordinary',home:'a',away:'b',old:[]},{name:'new self',home:'a',away:'a',old:[]},{name:'retained away self',home:'a',away:'a',old:[['a','away']]},{name:'swap',home:'b',away:'a',old:[['a','home'],['b','away']]},{name:'remove home',home:null,away:'b',old:[['a','home'],['b','away']]},{name:'remove all',home:null,away:null,old:[['a','home'],['b','away']]}];
  for(const scenario of cases)for(const fence of [0,1])for(const rollback of [false,true]){
    const outcomes=[];
    for(const merged of [false,true]){
      const db=new DatabaseSync(':memory:');try{
        db.exec('CREATE TABLE source_events(id TEXT PRIMARY KEY,home_source_team_id TEXT,away_source_team_id TEXT);CREATE TABLE source_event_teams(source_team_id TEXT,source_event_id TEXT,side TEXT,PRIMARY KEY(source_team_id,source_event_id));');
        db.prepare('INSERT INTO source_events VALUES(?,?,?)').run('event',scenario.home,scenario.away);
        for(const [id,side]of scenario.old)db.prepare('INSERT INTO source_event_teams VALUES(?,?,?)').run(id,'event',side);
        db.exec('BEGIN');const data=JSON.stringify([{id:'event'}]);db.prepare(deletion.replaceAll('$FENCE',String(fence))).run(data);
        if(merged)db.prepare(insertion.replaceAll('$FENCE',String(fence))).run(data);
        else for(const side of ['home','away'])db.prepare(`INSERT OR IGNORE INTO source_event_teams SELECT ${side}_source_team_id,id,'${side}' FROM source_events WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${side}_source_team_id IS NOT NULL AND ${fence}`).run(data);
        db.exec(rollback?'ROLLBACK':'COMMIT');outcomes.push(db.prepare('SELECT * FROM source_event_teams ORDER BY source_team_id,side').all().map(row=>({...row})));
      }finally{db.close();}
    }
    assert.deepEqual(outcomes[1],outcomes[0],`${scenario.name}; fence=${fence}; rollback=${rollback}`);
  }
});


test('aligned prior-row snapshot preserves SQLite scalar types, Unicode/JSON evidence, provenance and unchanged revisions',async()=>{
  const f=await fixture();try{
    await f.insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'account-native',name:'Account',active:1,generation:1});
    const repo=new DomainRepository(f.db),observed='2026-10-12T00:00:00.000Z',details={label:'雪 \" quoted \\ text',nullable:null,number:17.25,nested:{string:'001',flag:false}},page={provider:'teamsnap',accountId:'account',generation:1,records:{teams:[{provider:'teamsnap',native_id:'private-team',name:'雪 team',club_id:null,observed_at:observed,details:JSON.stringify(details)}],players:[{provider:'teamsnap',native_id:'player',name:'Player\n雪',jersey:'007',observed_at:observed,details:JSON.stringify(details)}]},fixtures:[{provider:'teamsnap',native_id:'game',home_id:'teamsnap:private-team',away_id:null,type:'game',starts_at:null,local_day:'2026-09-01',home_score:0,away_score:null,payload:JSON.stringify(details),observed_at:observed}]};
    await repo.ingestSourcePage(page);
    let inspected=0;
    f.observeRows((sql,rows)=>{if(!sql.startsWith("SELECT 'source_teams' AS source_table"))return;for(const row of rows){const original=f.sqlite.prepare('SELECT * FROM '+row.source_table+' WHERE id=?').get(row.id);for(const [column,value]of Object.entries(original))assert.strictEqual(row[column],value,column);inspected++;}});
    const before={...f.sqlite.prepare('SELECT * FROM domain_installation').get()},unchanged=await repo.ingestSourcePage(page);
    assert.equal(unchanged.changed,false);assert.equal(inspected,3);assert.deepEqual({...f.sqlite.prepare('SELECT * FROM domain_installation').get()},before);
    const saved={...f.sqlite.prepare("SELECT * FROM source_players WHERE native_id='player'").get()};assert.equal(saved.jersey,'007');assert.equal(typeof saved.jersey,'string');assert.equal(JSON.parse(saved.evidence).number,17.25);
    await repo.ingestSourcePage({...page,provenance:'file_import',records:{...page.records,players:[{...page.records.players[0],name:'Untrusted replacement',jersey:null,observed_at:'2026-10-12T01:00:00.000Z'}]}});
    assert.deepEqual({...f.sqlite.prepare("SELECT * FROM source_players WHERE native_id='player'").get()},saved);
    const privateBefore={...f.sqlite.prepare('SELECT * FROM domain_installation').get()};
    await repo.ingestSourcePage({...page,records:{...page.records,players:[{...page.records.players[0],name:'Provider correction',observed_at:'2026-10-12T02:00:00.000Z'}]}});
    const after=f.sqlite.prepare('SELECT * FROM domain_installation').get();assert.equal(after.source_revision,privateBefore.source_revision+1);assert.equal(after.public_revision,privateBefore.public_revision);
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.close();}
});

test('combined prior-row read is bounded to 500 admitted IDs without duplicating encoded evidence',async()=>{
  const f=await fixture();try{
    await f.insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'account-native',name:'Account',active:1,generation:1});
    await f.insert('source_teams',{id:'teamsnap/account/private-team',provider:'teamsnap',scope:'account',account_id:'account',native_id:'private-team',name:'Private',name_authority:1,archived:0,evidence:'{}',content_hash:'team',observed_at:'2025-01-01T00:00:00.000Z'});
    const evidence=JSON.stringify({text:'x'.repeat(63000)}),records={players:[]},fixtures=[];
    for(let i=0;i<250;i++){
      await f.insert('source_players',{id:'teamsnap/account/p'+i,provider:'teamsnap',scope:'account',account_id:'account',native_id:'p'+i,name:'Player '+i,jersey:null,evidence,content_hash:'old',observed_at:'2025-01-01T00:00:00.000Z'});
      await f.insert('source_events',{id:'teamsnap/account/e'+i,provider:'teamsnap',scope:'account',account_id:'account',native_id:'e'+i,starts_at:null,local_day:'2026-09-01',time_precision:'day',type:'game',status:'FINAL',conditional:0,home_source_team_id:'teamsnap/account/private-team',away_source_team_id:null,home_label:'Home',away_label:'Away',title:'Game',venue:'',evidence,content_hash:'old',observed_at:'2025-01-01T00:00:00.000Z'});
      records.players.push({provider:'teamsnap',native_id:'p'+i,name:'Player '+i,jersey:null,details:'{}',observed_at:'2026-10-12T00:00:00.000Z'});
      fixtures.push({provider:'teamsnap',native_id:'e'+i,home_id:'teamsnap:private-team',away_id:null,type:'game',starts_at:null,local_day:'2026-09-01',payload:'{}',observed_at:'2026-10-12T00:00:00.000Z'});
    }
    global.gc?.();const baseline=process.memoryUsage().heapUsed;let maxHeap=baseline,readRows=0,priorBytes=0;
    f.observeRows((sql,rows)=>{maxHeap=Math.max(maxHeap,process.memoryUsage().heapUsed);if(sql.includes(' AS source_table')){readRows+=rows.length;priorBytes+=rows.reduce((sum,row)=>sum+Buffer.byteLength(row.evidence),0);assert.ok(!rows.some(row=>'source_row' in row),'No second JSON encoding of saved evidence');}});
    const built=await new DomainRepository(f.db).buildSourcePage({provider:'teamsnap',accountId:'account',generation:1,records,fixtures});
    maxHeap=Math.max(maxHeap,process.memoryUsage().heapUsed);assert.equal(readRows,500);assert.equal(priorBytes,Buffer.byteLength(evidence)*500);assert.equal(built.changed,true);
    assert.ok(maxHeap-baseline<64*1024*1024,'Scalar union must not duplicate a 31.5MB prior evidence snapshot');
    console.log(JSON.stringify({sqlite_prior_read_rows:readRows,prior_evidence_bytes:priorBytes,sampled_heap_delta:maxHeap-baseline,native_worker_memory_proof:false}));
  }finally{f.close();}
});
