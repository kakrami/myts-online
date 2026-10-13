import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAuxiliaryPage} from '../src/domain/auxiliary.js';
import {classifyFailure} from '../src/sync/errors.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {SourceTransport} from '../src/sources/http.js';
import {collectApplicationJob} from '../src/application/sync-service.js';
import {buildImportedPage} from '../src/domain/dataset.js';
import {traceNativeGame,traceRadar,traceProvider,gamePages,traceStorage} from './fixtures/trace-analysis-native.mjs';

// Original 6.20.133 reduceTraceMember preserves join_time/leave_time, and
// buildRoster uses Date.parse(leave_time). Those are membership dates, not
// half-relative seconds. This fixture is synthetic, not a private live receipt.
const memberPage = (values, part='member:00000') => ({accountId:'account',accountProvider:'trace',records:{trace_parts:[{
  fixture_id:'trace:4001',team_id:'trace:400',account_id:'account',part,
  value:{user_id:'1000',gid:'home-goalkeeper',side:'home',name:'Synthetic',...values},
}]}});
const emptyRepository = {db:{prepare(){return {bind(){return this;},async all(){return {results:[]};},async first(){return {count:0};}};}}};
async function mapped(values,part) {
  const result=await buildAuxiliaryPage(emptyRepository,memberPage(values,part));
  return JSON.parse(result.statements.find(s=>s.sql.startsWith('INSERT INTO source_')).params[0])[0];
}

test('Trace membership dates use strict absolute ISO timestamps and preserve exact native evidence',async()=>{
  const cases=[
    ['2025-08-01T12:00:00Z',Date.UTC(2025,7,1,12)],
    ['2025-08-01T12:00:00.1Z',Date.UTC(2025,7,1,12,0,0,100)],
    ['2025-08-01T12:00:00.123456789Z',Date.UTC(2025,7,1,12,0,0,123)],
    ['2025-08-01T05:00:00-07:00',Date.UTC(2025,7,1,12)],
    ['2025-01-01T00:15:00+05:30',Date.UTC(2024,11,31,18,45)],
    ['2024-02-29T23:59:59.999-02:00',Date.UTC(2024,2,1,1,59,59,999)],
    ['2026-12-31T23:45:00-00:30',Date.UTC(2027,0,1,0,15)],
  ];
  for(const field of ['join_time','leave_time'])for(const [value,expected] of cases){
    const row=await mapped({[field]:value});
    assert.equal(row[field],expected,`${field}: ${value}`);
    assert.equal(JSON.parse(row.evidence)[field],value,'native spelling, zone and precision survive');
  }
});

test('null dates stay null and legacy finite decimal values remain exact without rescaling',async()=>{
  for(const field of ['join_time','leave_time'])for(const value of [undefined,null,0,1_700_000_000_000,1_700_000_000,123.5,-123.5,'0','123.5','1e3','1700000000000',' 123.5 ']){
    const row=await mapped({[field]:value});assert.equal(row[field],value==null?null:Number(value));
    assert.equal(JSON.parse(row.evidence)[field],value,'legacy numeric unit is not guessed');
  }
});

test('ambiguous, impossible or unrecognized membership timestamps reject the entire page',async()=>{
  const invalid=[
    '', ' ', '0x10', 'NaN', 'Infinity', '1e999', true, false, [], [1], {}, {time:1}, NaN, Infinity, -Infinity,
    'yesterday','2025-08-01','2025-08-01T12:00:00','2025-08-01 12:00:00Z',
    '2025-08-01T12:00:00+0000','2025-08-01T12:00:00+24:00','2025-08-01T12:00:00+00:60',
    '2025-08-01T12:00:00-00:00',
    '2025-08-01T24:00:00Z','2025-08-01T12:60:00Z','2025-08-01T12:00:60Z',
    '2025-02-29T12:00:00Z','2024-02-30T12:00:00Z','2025-04-31T12:00:00Z',
    '2025-13-01T12:00:00Z','2025-00-01T12:00:00Z','2025-08-00T12:00:00Z',
    '2025-08-01T12:00:00.1234567890Z','2025-08-01T12:00:00Z trailing',
  ];
  for(const field of ['join_time','leave_time'])for(const value of invalid){
    await assert.rejects(()=>mapped({[field]:value}),error=>{
      assert.equal(error.code,'source_contract');
      assert.equal(classifyFailure(error).kind,'permanent');return true;
    },`${field} must reject ${JSON.stringify(value)}`);
  }
});

test('Trace numeric component fields preserve the original null, blank, zero and fractional distinctions',async()=>{
  for(const [input,expected] of [[undefined,null],[null,null],['',null],['   ',null],[0,0],['0',0],[12.5,12.5],['12.5',12.5]]){
    const row=await mapped({half:input,time:input,duration:input},'moment:0000000');
    assert.equal(row.half,expected);assert.equal(row.time_seconds,expected);assert.equal(row.duration_seconds,expected);
    assert.equal(JSON.parse(row.evidence).time,input);
  }
  for(const field of ['half','time','duration'])for(const value of [true,false,[],[1],{},'not-a-number',Infinity,NaN]){
    await assert.rejects(()=>mapped({[field]:value},'moment:0000000'),error=>error.code==='source_contract');
  }
  const header=await mapped({half:null,start:0,end:'120.5',duration:' ',population:0},'radar:1');
  assert.equal(header.half,null);assert.equal(header.start_seconds,0);assert.equal(header.end_seconds,120.5);
  assert.equal(header.duration_seconds,null);assert.equal(header.population,0);
});

test('supported dates persist through the real Trace collector and repository, including raw evidence',async()=>{
  const game=traceNativeGame();game.team_members[0].join_time='2025-08-01T05:00:00-07:00';
  game.team_members[0].leave_time='2026-08-31T23:59:59.123456Z';
  const pages=await gamePages(traceProvider(game)),store=traceStorage();
  try{
    for(const page of pages)await store.save(page);
    const row=store.all("SELECT * FROM source_game_members WHERE native_key='member:00000'")[0];
    assert.equal(row.join_time,Date.UTC(2025,7,1,12));assert.equal(row.leave_time,Date.UTC(2026,7,31,23,59,59,123));
    assert.equal(JSON.parse(row.evidence).join_time,game.team_members[0].join_time);
    assert.equal(JSON.parse(row.evidence).leave_time,game.team_members[0].leave_time);
    assert.equal(store.all('SELECT * FROM source_game_moments').length,2);
    assert.equal(store.all("SELECT complete FROM source_component_coverage WHERE kind='game'")[0].complete,1);
  }finally{store.close();}
});

function providerFetch(game,radar,calls){return async(url,options)=>{
  if(url.endsWith('/users/self/token'))return Response.json({data:{user_id:1,token:'synthetic-token',timestamp:1}});
  if(url.includes('/test-assets/radar')){calls.push('radar');return Response.json(radar);}
  const request=JSON.parse(options.body);calls.push(request.operationName);
  if(request.operationName==='game')return Response.json({data:{game}});
  if(request.operationName==='getHaloData'){
    const s=request.variables.segments[0];return Response.json({data:{halo:{ring:[[s.local_start,'L'],[s.local_start+s.duration,'L']]}}});
  }
  if(request.operationName==='gameStats')return Response.json({data:{gameStats:{available:'ready',possession:50,total_possession:120,
    shots:{total:1,made:0,offensive:1,middle:0,defensive:0,items:[{start:1_700_002_012_500,x:0.2,y:0.3,side:request.variables.side,made:false}]}}}});
  if(request.operationName==='gameStatsHeatmap')return Response.json({data:{playerGameHeatMap:{map:[[0,1],[2,0]]}}});
  throw new Error('Unexpected synthetic provider operation '+request.operationName);
};}

async function workflow(game){
  const store=traceStorage();for(const sql of SYNC_SCHEMA)store.sqlite.exec(sql);
  // The compact source-only fixture's batch adapter has no RETURNING rows.
  // Preserve actual SQLite transactions while exposing D1's result shape to
  // the unchanged coordinator claim/commit implementation.
  store.db.batch=async statements=>{
    store.sqlite.exec('BEGIN');
    try{
      const results=statements.map(s=>{
        const statement=store.sqlite.prepare(s.sql);
        if(statement.columns().length){const rows=statement.all(...s.params);return {results:rows.map(r=>({...r})),meta:{changes:store.sqlite.prepare('SELECT changes() AS n').get().n}};}
        const result=statement.run(...s.params);return {results:[],meta:{changes:Number(result.changes)}};
      });store.sqlite.exec('COMMIT');return results;
    }catch(error){store.sqlite.exec('ROLLBACK');throw error;}
  };
  await store.repo.ingestSourcePage({accountId:'account',generation:1,records:{teams:[{id:'trace:400',provider:'trace',native_id:'400',account_id:'account',name:'Synthetic',details:JSON.stringify({account_owned:true,catalog_scan_id:'catalog'})}]},scanId:'catalog'});
  store.sqlite.exec("INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES('team','Synthetic','UTC',2026,'test');INSERT INTO team_read_state(app_team_id) VALUES('team');INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,created_at) VALUES('root','team','trace/account/400','account','observed_history','test');");
  let now=Date.now();const coordinator=new JobCoordinator(store.db,{clock:()=>now,pageDelayMs:0});
  const jobId=await coordinator.enqueue({provider:'trace',component:'game',stage:'source',scope:'trace:4001:trace:400',resourceKey:'trace:4001:trace:400',accountId:'account',accountGeneration:1,recurring:false,priority:80,args:{team_id:'400',game_id:'4001',profile_hash:'synthetic-profile'}},[{kind:'team',key:'connection:root',teamId:'team'}]);
  const calls=[],radar=traceRadar(game),options={credentialLoader:async()=>'PHPSESSID=synthetic',transportFactory:()=>new SourceTransport({}, {fetch:providerFetch(game,radar,calls)})};
  const step=async()=>{now=Math.max(now+2,Date.now());return coordinator.runOne(context=>collectApplicationJob({...context,env:{}},options));};
  return {...store,coordinator,jobId,calls,step};
}

test('dated game completes header, members, moments, derived, both radars and all native tracking/analytics jobs',async()=>{
  const game=traceNativeGame();
  game.team_members.forEach((m,i)=>{m.join_time=i%2?'2024-02-29T23:45:00-00:30':'2025-08-01T12:00:00Z';m.leave_time=null;});
  game.moments[0].half='1';game.moments[0].time='12.5';game.moments[0].duration='120';
  game.moments[1].time=null;
  game.moments.push({game_id:4001,game_clip_id:40013,type:'Highlight',half:null,time:' ',duration:'',start_time:null,title:'Synthetic moment'});
  const h=await workflow(game),stages=[];
  try{
    for(let i=0;i<200;i++){
      const result=await h.step();if(result.state==='idle')break;
      assert.ok(!['failed','blocked','retrying','lease_lost'].includes(result.state),JSON.stringify(result));
      if(result.jobId===h.jobId)stages.push(JSON.parse(h.all(`SELECT checkpoint FROM sync_jobs WHERE id='${h.jobId}'`)[0].checkpoint).stage||'finished');
      if(i===199)assert.fail('native game workflow did not drain');
    }
    assert.deepEqual(stages,['members','moments','derived','finished']);
    const jobs=h.all('SELECT component,state,failures FROM sync_jobs');
    assert.ok(jobs.every(j=>j.state==='ready'&&j.failures===0));
    assert.equal(jobs.filter(j=>j.component==='radar').length,2);
    assert.equal(jobs.filter(j=>j.component==='tracking').length,14);
    assert.equal(jobs.filter(j=>j.component==='analytics').length,27);
    assert.equal(h.all('SELECT * FROM source_game_members').length,7);
    assert.equal(h.all('SELECT * FROM source_game_moments').length,3);
    assert.equal(h.all("SELECT * FROM source_trace_components WHERE kind='header'").length,1);
    assert.equal(h.all("SELECT * FROM source_trace_components WHERE kind='clip'").length,2);
    assert.equal(h.all("SELECT * FROM source_trace_components WHERE kind='radar'").length,2);
    assert.equal(h.all('SELECT * FROM source_tracking_segments').length,56);
    assert.equal(h.all('SELECT * FROM source_stat_summaries').length,27);
    assert.equal(h.all('SELECT * FROM source_stat_items').length,27);
    assert.equal(h.all('SELECT * FROM source_heatmaps').length,27);
    const blank=h.all("SELECT * FROM source_game_moments WHERE type='Highlight'")[0];
    assert.equal(blank.half,null);assert.equal(blank.time_seconds,null);assert.equal(blank.duration_seconds,null);
    assert.ok(h.all('SELECT evidence FROM source_stat_items').every(r=>JSON.parse(r.evidence).start===1_700_002_012_500));
    assert.ok(h.calls.includes('getHaloData'));assert.ok(h.calls.includes('gameStatsHeatmap'));
  }finally{h.close();}
});

test('deterministic membership failure terminates without losing the saved header or checkpoint',async()=>{
  const game=traceNativeGame();game.team_members[0].join_time='2025-02-29T12:00:00Z';
  const h=await workflow(game);
  try{
    assert.equal((await h.step()).state,'queued');
    const before=h.all('SELECT * FROM source_trace_components');
    const checkpoint=h.all(`SELECT checkpoint FROM sync_jobs WHERE id='${h.jobId}'`)[0].checkpoint;
    const result=await h.step();assert.equal(result.state,'failed');
    assert.equal(result.error.code,'source_contract');assert.equal(result.error.kind,'permanent');
    assert.ok(!result.error.message.includes(game.team_members[0].join_time));
    const job=h.all(`SELECT * FROM sync_jobs WHERE id='${h.jobId}'`)[0];
    assert.equal(job.checkpoint,checkpoint);assert.equal(job.pages_saved,1);assert.equal(job.failures,1);
    assert.deepEqual(h.all('SELECT * FROM source_trace_components'),before);
    assert.equal(h.all('SELECT * FROM source_game_members').length,0);assert.equal(h.all('SELECT * FROM source_game_moments').length,0);
    assert.equal((await h.step()).state,'idle');assert.equal(await h.coordinator.nextWake(),null);
  }finally{h.close();}
});

test('source_contract classification is terminal and never exposes raw exception contents',()=>{
  const failure=classifyFailure(Object.assign(new Error('private raw date, name, URL and cookie'),{code:'source_contract'}));
  assert.equal(failure.code,'source_contract');assert.equal(failure.kind,'permanent');
  assert.ok(!failure.message.includes('private'));assert.ok(!failure.message.includes('cookie'));
});

test('portable member import preserves agreeing ISO and decimal evidence and falls back for legacy coercions',async()=>{
  const cases=[
    {raw:'2025-08-01T05:00:00.123456-07:00',numeric:Date.UTC(2025,7,1,12,0,0,123)},
    {raw:'123.5',numeric:123.5},{raw:'1e3',numeric:1000},{raw:null,numeric:null},
    {raw:'',numeric:0,expected:0},{raw:true,numeric:1,expected:1},
    {raw:'2025-08-01T12:00:00Z',numeric:0,expected:0},
    {numeric:123.5,expected:123.5},
  ];
  const store=traceStorage();
  try{
    for(const page of await gamePages(traceProvider(traceNativeGame())))await store.save(page);
    store.sqlite.exec("INSERT INTO app_teams(id,name,timezone,season_year,created_at) VALUES('team','Synthetic','UTC',2026,'test');INSERT INTO team_read_state(app_team_id) VALUES('team');INSERT INTO team_seasons(id,app_team_id,year,start_day,end_day,start_at,end_at) VALUES('season','team',2026,'2026-06-01','2027-06-01','2026-06-01T00:00:00.000Z','2027-06-01T00:00:00.000Z');INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id,account_id) VALUES('attachment','team','season','trace/account/400','account');");
    const scope={teamId:'team',seasonId:'season',accountMap:{account1:{id:'account',provider:'trace',native_id:'1',generation:1}},sourceTeams:[{id:'trace/account/400'}]};
    const original=store.all("SELECT * FROM source_game_members WHERE native_key='member:00000'")[0];
    for(const c of cases){
      const evidence=JSON.parse(original.evidence);if(Object.hasOwn(c,'raw'))evidence.join_time=c.raw;else delete evidence.join_time;
      const row={...original,join_time:c.numeric,leave_time:null,evidence:JSON.stringify(evidence),account_ref:'account1'};
      delete row.account_id;for(const key of ['source_team_id','source_event_id','source_player_id'])if(row[key])row[key]=row[key].replace('/account/','/account1/');
      store.sqlite.prepare("UPDATE source_game_members SET provenance='file_import',content_hash='legacy' WHERE id=?").run(original.id);
      const built=await buildImportedPage(store.repo,scope,'source_game_members@account1',[row]);
      store.sqlite.exec('BEGIN');try{for(const s of built.statements)store.sqlite.prepare(s.sql.replaceAll('$FENCE','1')).run(...s.params);store.sqlite.exec('COMMIT');}catch(error){store.sqlite.exec('ROLLBACK');throw error;}
      const saved=store.all("SELECT * FROM source_game_members WHERE native_key='member:00000'")[0];
      assert.equal(saved.join_time,c.numeric);assert.equal(saved.provenance,'file_import');
      assert.equal(JSON.parse(saved.evidence).join_time,Object.hasOwn(c,'expected')?c.expected:c.raw);
    }
  }finally{store.close();}
});
