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
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {teamSnapBatchLength,TEAMSNAP_SOURCE_PARAMETER_BUDGET} from '../src/sources/teamsnap-batch.js';

const AT='2026-10-12T12:00:00.000Z',TEAM='999999999999999',ACCOUNT='ffffffff-ffff-4fff-afff-ffffffffffff';
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value));
const paramsBytes=statements=>statements.reduce((sum,s)=>sum+bytes(s.params||[]),0);
function event(i,notes='n'.repeat(2000),extra={}) {
  const native=String(800000000000000+i);
  const reported=Object.fromEntries(['points_for_team','points_for_opponent','team_score','opponent_score','results','formatted_results','results_url','shootout_points_for_team','shootout_points_for_opponent','is_overtime','is_shootout','status','is_tbd','doesnt_count_towards_record'].map(key=>[key,null]));
  return {id:'teamsnap:'+native,provider:'teamsnap',native_id:native,account_id:ACCOUNT,competition_id:null,division_id:null,home_id:'teamsnap:'+TEAM,away_id:null,starts_at:'2026-09-01T18:00:00.000Z',local_day:null,type:'game',status:'UNKNOWN',conditional:0,home_score:null,away_score:null,payload:JSON.stringify({home_name:'Our team',away_name:'Opponent',title:'Game',venue:'Field',address:'Address',notes,uniform:'Blue',arrival_at:null,arrival_minutes:null,availability_enabled:true,source_url:'https://api.teamsnap.com/v3/events/'+native,opponent_id:'999999999999998',location_id:'999999999999997',game_type:'home',game_type_code:1,orientation_verified:true,time_pending:false,reported,reported_scores:{home:null,away:null},result_state:'unpublished',record_eligible:false,...extra}),observed_at:AT};
}
function attendance(i,status='1',account=ACCOUNT) {
  return {fixture_id:'teamsnap:'+String(800000000000000+i),player_id:'teamsnap:'+String(700000000000000+i),team_id:'teamsnap:'+TEAM,account_id:account,status,native_status:status,normalized_status:status==='1'?'Yes':'Unknown',evidence:{contract:'teamsnap-javascript-sdk/AVAILABILITIES',status_code:status},observed_at:AT};
}
function projection(team,season) {return {provider:'domain',component:'projection',stage:'projection',scope:team,resourceKey:season,args:{teamId:team,seasonId:season,requestId:crypto.randomUUID()},priority:100,intervalMs:3600000,recurring:false,subscriberMode:'projection',subscribers:[{kind:'team',key:`projection:${team}:${season}`,teamId:team}]};}

// The same Node SQLite + production installation/epoch/BudgetDB pattern as
// source-page-budget.test.mjs. No Miniflare, Workerd or provider network runs.
async function fixture({kind='events',account=ACCOUNT,consumers=0}={}) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  let capture=false,batches=[],reads=[];
  const prepare=(sql,params=[])=>({sql,params,bind(...values){return prepare(sql,values);},async all(){if(capture)reads.push(sql);const result=sqlite.prepare(sql).all(...params);return {results:result.map(row=>({...row})),meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return (await this.all()).results[0]??null;},async run(){return this.all();}});
  const raw={prepare,async batch(statements){if(capture)batches.push({bytes:paramsBytes(statements),count:statements.length,sql:statements.map(s=>s.sql)});sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const fresh=new FreshInstallation(raw,{schema:SCHEMA,seed:SEED,bootstrapPassword:'synthetic-teamsnap-byte-password'});
  while((await fresh.inspect()).state!=='ready')await fresh.advance('synthetic-teamsnap-byte-password');
  const db=wrapDatabase(raw),insert=(table,row)=>db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row)).run();
  await insert('provider_accounts',{id:account,provider:'teamsnap',native_id:TEAM,name:'Account',active:1,generation:1});
  const source=sourceKey('teamsnap',TEAM,account);
  await insert('source_teams',{id:source,provider:'teamsnap',scope:account,account_id:account,native_id:TEAM,name:'Team',name_authority:1,archived:0,evidence:'{}',content_hash:'seed',observed_at:AT});
  await insert('account_source_teams',{account_id:account,source_team_id:source});
  for(let i=0;i<consumers;i++) {
    const team=crypto.randomUUID(),season=crypto.randomUUID();
    await insert('app_teams',{id:team,name:'Team',timezone:'UTC',season_year:2026,created_at:AT});
    await insert('team_read_state',{app_team_id:team});
    await insert('team_seasons',{id:season,app_team_id:team,year:2026,start_day:'2026-06-01',end_day:'2027-06-01',start_at:'2026-06-01T00:00:00.000Z',end_at:'2027-06-01T00:00:00.000Z'});
    await insert('team_projection_state',{team_season_id:season,app_team_id:team,pending:0});
    await insert('team_source_attachments',{id:crypto.randomUUID(),app_team_id:team,team_season_id:season,source_team_id:source,account_id:account});
  }
  const spec={provider:'teamsnap',component:kind,scope:'teamsnap:'+TEAM,resourceKey:'teamsnap:'+TEAM,accountId:account,accountGeneration:1,args:{team_id:TEAM},recurring:false};
  const jobId=await new JobCoordinator(db).enqueue(spec,[{kind:'account',key:account}]);
  const pageFor=(items,complete=true,scanId='scan')=>({accountId:account,generation:1,records:kind==='attendance'?{attendance:items}:{},fixtures:kind==='events'?items:[],scanId,sourceCoverage:[{provider:'teamsnap',account_id:account,kind,scope:'teamsnap:'+TEAM,complete,count:items.length,observed_at:AT}]});
  async function commit(items,{complete=true,offset=items.length,checkpoint=null,observations=null,providerRows=null}={}) {
    await db.prepare('UPDATE sync_jobs SET next_at=CASE WHEN id=? THEN 0 ELSE ? END,state=CASE WHEN id=? THEN \'queued\' ELSE state END').bind(jobId,Date.now()+86400000,jobId).run();
    capture=true;batches=[];reads=[];
    const budget=new BudgetDB(raw,50),wrapped=wrapDatabase(budget),coordinator=new JobCoordinator(wrapped);
    await new InstallationUpgrade(budget,{schema:SCHEMA,seed:SEED}).inspect();
    const lease=await coordinator.claim();assert.equal(lease.id,jobId);
    let page,result;
    if(providerRows) {
      const transport={observations:[],async get(url){const u=new URL(url);this.observations.push({endpoint:u.origin+u.pathname,status:200,at:AT,retrieved_at:AT,hash:'a'.repeat(64),bytes:1000000,rows_count:providerRows.length});return {value:{collection:{items:providerRows.map(row=>({data:Object.entries(row).map(([name,value])=>({name,value}))})),page_info:{total_items:providerRows.length,page_size:Number(u.searchParams.get('page_size')),page_number:Number(u.searchParams.get('page_number'))},links:[]}}};}};
      result=await collectApplicationJob({db:wrapped,env:{},lease,args:lease.args,checkpoint:lease.checkpoint},{transportFactory:()=>transport,credentialLoader:async()=> 'synthetic'});
      page={statements:result.statements};
      if(checkpoint)result.checkpoint=checkpoint;if(observations)result.observations=observations;
    }else {
      page=await new DomainRepository(wrapped).buildSourcePage(pageFor(items,complete,lease.scan_id));
      const children=page.affectedTeams.map(row=>projection(row.app_team_id,row.team_season_id));
      result={statements:page.statements,checkpoint:checkpoint||(complete?{finished:true}:{url:'https://api.teamsnap.com/v3/events/search?team_id='+TEAM,offset,digest:'a'.repeat(64),visited:[]}),children,complete,coverage:complete?'complete':'partial',rowsSaved:items.length,observations:observations||[{endpoint:'https://api.teamsnap.com/v3/'+kind+'/search',status:200,at:AT,retrieved_at:AT,hash:'a'.repeat(64),bytes:1000000,rows_count:items.length}]};
    }
    const saved=await coordinator.commit(lease,result);capture=false;
    assert.equal(saved.committed,true);assert.ok(budget.used<=50);
    const transaction=batches.find(batch=>batch.sql.some(sql=>sql.startsWith('INSERT INTO sync_commit_fences')));
    assert.ok(transaction);assert.ok(transaction.bytes<=2000000,`actual native parameters: ${transaction.bytes}`);
    assert.equal(sqlite.prepare('SELECT writer_mode FROM installation_upgrade').get().writer_mode,null);
    assert.ok(reads.filter(sql=>sql.includes(' AS source_table')).length<=1,'Only one previous-source snapshot; no trial builder retries');
    return {page,result,used:budget.used,actualBytes:transaction.bytes};
  }
  return {sqlite,db,account,pageFor,commit,close:()=>sqlite.close()};
}

test('150 valid 2k-note events are a resumable prefix before repeated SQL params exceed 2 MB',async()=>{
  const f=await fixture();try {
    const rows=Array.from({length:150},(_,i)=>event(i));
    const unsliced=await new DomainRepository(f.db).buildSourcePage(f.pageFor(rows));
    assert.ok(bytes(rows)<1750000);assert.ok(paramsBytes(unsliced.statements)>2000000);
    let offset=0,pages=0,max=0;
    while(offset<rows.length) {
      const count=teamSnapBatchLength('events',rows.slice(offset),{accountId:f.account,scanId:'scan'});
      assert.ok(count>0);assert.ok(count<150);
      const next=offset+count,saved=await f.commit(rows.slice(offset,next),{complete:next===rows.length,offset:next});
      assert.ok(paramsBytes(saved.page.statements)<=TEAMSNAP_SOURCE_PARAMETER_BUDGET);
      max=Math.max(max,saved.actualBytes);offset=next;pages++;
    }
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_events').get().n,150);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_event_logistics').get().n,150);
    assert.deepEqual(JSON.parse(f.sqlite.prepare("SELECT checkpoint FROM sync_jobs WHERE provider='teamsnap'").get().checkpoint),{finished:true});
    console.log(JSON.stringify({teamsnap_events:150,pages,max_actual_parameter_bytes:max}));
  }finally{f.close();}
});

test('maximum notes, escaped large fields and Unicode stay bounded on new and changed rows with all 128 projection children',async()=>{
  const f=await fixture({consumers:128});try {
    const patterns=['雪'.repeat(8000),'😀'.repeat(4000),'\u0001'.repeat(8000),'"\\\n'.repeat(2600)];
    let native=0,max=0;
    for(const notes of patterns) {
      const rows=Array.from({length:25},()=>event(native++,notes,notes.includes('\u0001')?{}:{home_name:'😀'.repeat(500),away_name:'雪'.repeat(1000),title:'"\\'.repeat(500),venue:'雪'.repeat(1000),address:'😀'.repeat(500),uniform:'"'.repeat(1000)}));
      // Use the largest allowed normalized records, not JavaScript character
      // length; control-character evidence can legitimately exceed 64 KB.
      const legal=rows.filter(row=>bytes(row)<=64000);
      assert.ok(legal.length>0);
      const count=teamSnapBatchLength('events',legal,{accountId:f.account,scanId:'scan'}),selected=legal.slice(0,count);
      assert.ok(count>=1&&count<25);
      const checkpoint={finished:true,padding:'\\\"'.repeat(1800)};checkpoint.padding+='x'.repeat(8192-bytes(checkpoint));assert.equal(bytes(checkpoint),8192);
      const observations=Array.from({length:16},(_,i)=>({endpoint:'https://api.teamsnap.com/v3/'+String(i)+'/'+('x'.repeat(930)),status:200,at:AT,retrieved_at:AT,hash:'a'.repeat(64),bytes:1999999,rows_count:150}));
      let saved=await f.commit(selected,{checkpoint,observations});assert.equal(saved.result.children.length,128);max=Math.max(max,saved.actualBytes);
      const changed=selected.map(row=>({...row,observed_at:'2026-10-12T13:00:00.000Z',payload:JSON.stringify({...JSON.parse(row.payload),game_type:'away'})}));
      saved=await f.commit(changed);assert.equal(saved.result.children.length,128);max=Math.max(max,saved.actualBytes);
      assert.ok(paramsBytes(saved.page.statements)<=TEAMSNAP_SOURCE_PARAMETER_BUDGET);
      for(const row of selected)assert.equal(f.sqlite.prepare('SELECT notes FROM source_event_logistics WHERE source_event_id=?').get(sourceKey('teamsnap',row.native_id,f.account)).notes,notes);
    }
    console.log(JSON.stringify({teamsnap_projection_children:128,max_actual_parameter_bytes:max}));
  }finally{f.close();}
});

test('attendance and long encoded account identities preserve every input and unknown status',async()=>{
  const account='雪/"\\'.repeat(100),f=await fixture({kind:'attendance',account});try {
    const rows=Array.from({length:175},(_,i)=>attendance(i,i%2?'1':'😀"\\'.repeat(1000),account));
    let offset=0,max=0;
    while(offset<rows.length) {
      const count=teamSnapBatchLength('attendance',rows.slice(offset),{accountId:account,scanId:'scan'});assert.ok(count>0);
      const next=offset+count,saved=await f.commit(rows.slice(offset,next),{complete:next===rows.length,offset:next});
      assert.ok(paramsBytes(saved.page.statements)<=TEAMSNAP_SOURCE_PARAMETER_BUDGET);max=Math.max(max,saved.actualBytes);offset=next;
    }
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_attendance').get().n,175);
    assert.equal(f.sqlite.prepare("SELECT source_status FROM source_attendance WHERE status='Unknown' LIMIT 1").get().source_status,'😀"\\'.repeat(1000));
    console.log(JSON.stringify({teamsnap_attendance:175,max_actual_parameter_bytes:max}));
  }finally{f.close();}
});

test('new and prior event identities include URI-expanded accounts and the repository native-ID bound',async()=>{
  const account='雪/"\\'.repeat(100),f=await fixture({account,consumers:2});try {
    const rows=Array.from({length:25},(_,i)=>({...event(i,'雪'.repeat(8000)),account_id:account}));
    const count=teamSnapBatchLength('events',rows,{accountId:account,scanId:'scan'}),selected=rows.slice(0,count);
    assert.ok(count>=1);let saved=await f.commit(selected);assert.equal(saved.result.children.length,2);
    // A saved-file observation can have a longer native participant identity
    // than the numeric TeamSnap HTTP IDs. Only its bounded old dirty facts are
    // carried into the subsequent provider update, never its old evidence.
    const previous=sourceKey('teamsnap','p'.repeat(160),account);
    await f.db.prepare('INSERT INTO source_teams(id,provider,scope,account_id,native_id,name,name_authority,archived,evidence,content_hash,observed_at) VALUES(?,?,?,?,?,?,1,0,?,?,?)').bind(previous,'teamsnap',account,account,'p'.repeat(160),'Previous participant','{}','old',AT).run();
    await f.db.prepare('UPDATE source_events SET away_source_team_id=?,starts_at=NULL,local_day=NULL,evidence=?,content_hash=?').bind(previous,JSON.stringify({old:'雪'.repeat(20000)}),'old').run();
    saved=await f.commit(selected);
    assert.ok(paramsBytes(saved.page.statements)<=TEAMSNAP_SOURCE_PARAMETER_BUDGET);
    assert.equal(saved.result.children.length,2);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_events').get().n,count);
  }finally{f.close();}
});

test('actual application collector bounds SQL parameters and advances by its admitted input rows',async()=>{
  const f=await fixture({consumers:128});try {
    const providerRows=Array.from({length:25},(_,i)=>({id:String(800000000000000+i),team_id:TEAM,is_game:true,start_date:'2026-09-01T18:00:00Z',name:'題'.repeat(1000),opponent_name:'敵'.repeat(1000),location_name:'場'.repeat(1000),notes:'雪'.repeat(8000),uniform:'衣'.repeat(1000)}));
    const saved=await f.commit([],{providerRows});
    assert.ok(saved.result.rowsSaved>0&&saved.result.rowsSaved<25);
    assert.equal(saved.result.children.length,128);
    assert.equal(saved.result.checkpoint.offset,saved.result.rowsSaved);
    assert.equal(saved.result.complete,false);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_events').get().n,saved.result.rowsSaved);
    assert.equal(f.sqlite.prepare('SELECT notes FROM source_event_logistics LIMIT 1').get().notes,'雪'.repeat(8000));
    console.log(JSON.stringify({teamsnap_application_rows:saved.result.rowsSaved,actual_parameter_bytes:saved.actualBytes,invocation_statements:saved.used}));
  }finally{f.close();}
});

test('one legal near-64 KB record progresses; oversized first or deferred next item fails visibly without mutation',()=>{
  const legal=event(1,'n'.repeat(8000),{reported:{formatted_results:'雪'.repeat(17000)}});
  assert.ok(bytes(legal)>59000&&bytes(legal)<=64000);
  assert.equal(teamSnapBatchLength('events',[legal],{accountId:ACCOUNT}),1);
  const oversized=event(2,'😀'.repeat(40000)),before=JSON.stringify(oversized);
  assert.throws(()=>teamSnapBatchLength('events',[oversized],{accountId:ACCOUNT}),error=>error.code==='record_too_large');
  assert.equal(teamSnapBatchLength('events',[event(1),oversized],{accountId:ACCOUNT}),1);
  assert.equal(JSON.stringify(oversized),before);
  assert.equal(teamSnapBatchLength('events',[],{accountId:ACCOUNT}),0);
  assert.throws(()=>teamSnapBatchLength('catalog',[],{accountId:ACCOUNT}),error=>error.code==='contract_violation');
});
