import test from 'node:test';
import assert from 'node:assert/strict';
import {beginTeamSnapRefresh} from '../src/sources/teamsnap-refresh.js';
import {teamSnapPageRequest,advanceTeamSnapPage} from '../src/sources/teamsnap-pagination.js';
import {hash} from '../src/sources/common.js';
import {attendanceThroughputHarness} from './fixtures/teamsnap-attendance-throughput-harness.mjs';
import {ATTENDANCE_COUNT,EVENT_COUNT,PLAYER_COUNT,TEAM_ID,fixtureAvailability,normalizedStatus} from './fixtures/teamsnap-attendance-throughput-provider.mjs';
const accepted=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const rows=async(h,sql,...params)=>(await h.db.prepare(sql).bind(...params).all()).results;
const count=async(h,table)=>(await h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n;
const job=h=>h.db.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap' AND component='attendance'").first();
async function authorize(h){const flow=accepted(await h.request('/api/accounts/teamsnap/authorize',{method:'POST',body:{client_id:'synthetic-attendance-throughput-client'}}));return accepted(await h.request('/api/accounts/teamsnap/callback',{method:'POST',body:{state:flow.state,access_token:'synthetic-attendance-throughput-token',token_type:'Bearer'}})).account;}
async function published(h,root,{statusText,statusShift=0}={}){
  const expected=Array.from({length:ATTENDANCE_COUNT},(_,i)=>{const r=fixtureAvailability(i,{statusShift});if(statusText!==undefined)r.status_code=statusText;return {event_id:String(r.event_id),player_id:String(r.member_id),source_status:r.status_code==null?'':String(r.status_code),status:normalizedStatus(r)};});
  assert.deepEqual(await rows(h,'SELECT e.native_id event_id,p.native_id player_id,a.source_status,a.status FROM source_attendance a JOIN source_events e ON e.id=a.source_event_id JOIN source_players p ON p.id=a.source_player_id ORDER BY e.native_id,p.native_id'),expected);
  assert.deepEqual(await rows(h,'SELECT e.native_id event_id,p.native_id player_id,a.status FROM canonical_attendance a JOIN source_events e ON e.id=a.source_event_id JOIN source_players p ON p.id=a.source_player_id WHERE a.app_team_id=? ORDER BY e.native_id,p.native_id',root.team_id),expected.map(({source_status,...r})=>r));
  assert.equal(await count(h,'source_attendance'),ATTENDANCE_COUNT);assert.equal(await count(h,'source_events'),EVENT_COUNT);assert.equal(await count(h,'source_players'),PLAYER_COUNT);
}
async function fullRefresh(h,config={}){await h.configure(config);await h.db.prepare("UPDATE sync_jobs SET checkpoint='{}',state='queued',next_at=0,lease_until=0,lease_token=NULL WHERE provider='teamsnap' AND component='attendance'").run();await h.advance('attendance','queued');await h.settle();}
async function legacyCheckpoint(saved,account,{pass2=false}={}){
  const args=JSON.parse(saved.args),prepared=await beginTeamSnapRefresh({kind:'attendance',teamId:String(TEAM_ID),accountId:account.id,authorizationGeneration:saved.authorization_generation,endpoint:args.url||'https://api.teamsnap.com/v3/availabilities/search?team_id='+TEAM_ID,args,cursor:{}});
  let state=teamSnapPageRequest('attendance',String(TEAM_ID),prepared.endpoint,{protocol:'teamsnap-pages-v1',size:25},{refresh:prepared.refresh});
  const all=Array.from({length:ATTENDANCE_COUNT},(_,i)=>fixtureAvailability(i)).sort((a,b)=>b.event_id-a.event_id||b.member_id-a.member_id);
  for(let index=0;index<ATTENDANCE_COUNT/25;index++){
    const selected=all.slice(index*25,(index+1)*25),semantic=selected.map(row=>({fixture_id:'teamsnap:'+row.event_id,player_id:'teamsnap:'+row.member_id,team_id:'teamsnap:'+TEAM_ID,account_id:account.id,status:row.status_code==null?'':String(row.status_code),normalized_status:normalizedStatus(row)})),pageDigest=await hash(JSON.stringify(semantic));
    if(!pass2)return {...state,offset:7,digest:pageDigest,refresh:prepared.refresh};
    const next=new URL(state.url);next.searchParams.set('page_number',String(index+2));next.searchParams.sort();
    const ids=selected.map(row=>row.event_id+':'+row.member_id),idDigest=await hash(JSON.stringify([...ids].sort()));
    const out=await advanceTeamSnapPage(state,{number:index+1,total:ATTENDANCE_COUNT,next:index===ATTENDANCE_COUNT/25-1?null:next.href,terminal:index===ATTENDANCE_COUNT/25-1},pageDigest,25,0,25,ids,idDigest);state=out.checkpoint;
  }
  return {...state,refresh:prepared.refresh};
}
function safeBudgets(metrics,wire){assert.ok(metrics.maxStatements<=50);assert.ok(metrics.maxPayloadBytes<=2000000);assert.ok(metrics.maxCheckpointBytes<=8192);assert.ok(metrics.maxAttendanceSourceParameterBytes<=1000000);assert.deepEqual(metrics.violations,[]);for(const batch of wire.batches){assert.ok(batch.epochWrapped);assert.ok(batch.count<=50);assert.ok(batch.totalBytes<=2000000);assert.ok(batch.maxParameterBytes<=1000000);}}

// Production Worker -> SourceTransport -> collector -> repository -> coordinator
// -> native D1, including the installation epoch permit. Provider bytes, due
// arrivals, and deliberately lost replies are isolated synthetic fixtures.
test('native attendance throughput preserves exact two-pass rows, bounded bytes, resumes and authority fences',async()=>{
  const baseline=process.env.MYTS_TEST_ATTENDANCE_BASELINE==='1',size=baseline?25:100,h=await attendanceThroughputHarness();
  try{
    await h.initialize();await h.configure({recentDay:new Date(Date.now()-7*86400000).toISOString().slice(0,10)});
    let account=await authorize(h);await h.settle();
    const source=await h.db.prepare("SELECT id FROM source_teams WHERE provider='teamsnap' AND account_id=? AND native_id=?").bind(account.id,String(TEAM_ID)).first();assert.ok(source);
    const body={request_id:crypto.randomUUID(),source_team_id:source.id,account_id:account.id,new_team:{name:'Attendance throughput native proof',timezone:'UTC',timezone_source:'device',kind:'own'}};
    const root=accepted(await h.request('/api/connections',{method:'POST',body}),202);await h.settle();await published(h,root);
    const initialCalls=(await h.provider()).calls.filter(c=>c.kind==='attendance'),initialMetrics=await h.metrics(),initialWire=await h.wire();
    const pageCount=Math.ceil(ATTENDANCE_COUNT/size),pages=Array.from({length:pageCount},(_,i)=>i+1);
    assert.deepEqual(initialCalls.map(c=>c.page),[...pages,...pages]);assert.ok(initialCalls.every(c=>c.page_size===size));
    assert.equal(initialMetrics.groups['teamsnap/attendance'].count,pageCount*2);
    assert.equal(initialWire.batches.length,pageCount*2);assert.deepEqual(initialWire.batches.map(b=>b.attendanceRows),[...Array(pageCount).fill(size),...Array(pageCount).fill(0)]);
    const completed=await job(h),receipt=JSON.parse(completed.checkpoint).refresh.full;
    assert.equal(receipt.count,ATTENDANCE_COUNT);assert.equal(receipt.pages,pageCount);assert.equal(completed.coverage,'complete');assert.equal(completed.rows_saved,ATTENDANCE_COUNT*2);
    assert.deepEqual(await h.db.prepare("SELECT complete,record_count FROM source_component_coverage WHERE account_id=? AND kind='attendance'").bind(account.id).first(),{complete:1,record_count:ATTENDANCE_COUNT});
    assert.ok((await h.provider()).calls.filter(c=>c.kind==='events').every(c=>c.page_size===25),'event request size is unchanged');
    safeBudgets(initialMetrics,initialWire);
    console.log(JSON.stringify({attendance_throughput_native_initial:{baseline,source_fingerprint:h.sourceFingerprint,timing:{alarm_delay_ms:1,page_delay_ms:1,due_time_arrivals:'synthetic'},records:ATTENDANCE_COUNT,requested_size:size,provider_fetches:initialCalls.length,source_commits:initialWire.batches.length,rows_saved:completed.rows_saved,max_statements:initialMetrics.maxStatements,max_transaction_bytes:Math.max(...initialWire.batches.map(b=>b.totalBytes)),max_parameter_bytes:Math.max(...initialWire.batches.map(b=>b.maxParameterBytes)),max_source_parameter_bytes:initialMetrics.maxAttendanceSourceParameterBytes,max_checkpoint_bytes:initialMetrics.maxCheckpointBytes}}));
    if(baseline)return;
    const eventBefore=await h.db.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap' AND component='events'").first(),eventRows=await rows(h,'SELECT * FROM source_events ORDER BY id');
    const unchangedEvents=async()=>{assert.deepEqual(await h.db.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap' AND component='events'").first(),eventBefore);assert.deepEqual(await rows(h,'SELECT * FROM source_events ORDER BY id'),eventRows);};
    const scenarios=[];
    // Emulate persisted 7.2.5 bytes, including a locally sliced first page and
    // a completed first traversal. Native claim/collect must keep the legacy
    // partition, refresh window, digest, scan and saved offset intact.
    for(const pass2 of [false,true]){
      const saved=await job(h),cursor=await legacyCheckpoint(saved,account,{pass2}),beforeCalls=(await h.provider()).calls.length,beforeCommits=(await h.metrics()).commits.length;
      assert.equal(cursor.size,25);assert.equal(cursor.pass,pass2?2:1);await h.capture(true);
      await h.db.prepare("UPDATE sync_jobs SET checkpoint=?,state='queued',next_at=0,lease_until=0,lease_token=NULL WHERE id=?").bind(JSON.stringify(cursor),saved.id).run();
      await h.advance('attendance','queued');await h.settle();await published(h,root);await unchangedEvents();
      const calls=(await h.provider()).calls.slice(beforeCalls).filter(c=>c.kind==='attendance'),commits=(await h.metrics()).commits.slice(beforeCommits).filter(c=>c.component==='attendance');
      assert.ok(calls.every(c=>c.page_size===25));assert.equal(calls.length,pass2?8:16);const captured=await h.capture();assert.deepEqual(captured.inputCheckpoint,cursor);
      assert.equal(commits[0].rowsSaved,pass2?25:18);assert.equal(commits[0].checkpoint.size,25);assert.equal(captured.checkpoint.base,cursor.base);assert.deepEqual(captured.checkpoint.refresh,cursor.refresh);
      const finished=await job(h);assert.equal(finished.scan_id,saved.scan_id);assert.equal(JSON.parse(finished.checkpoint).refresh.full.count,ATTENDANCE_COUNT);assert.equal(JSON.parse(finished.checkpoint).refresh.full.pages,8);
      scenarios.push({name:pass2?'legacy25_pass2':'legacy25_partial_page',provider_fetches:calls.length,source_commits:commits.length,first_rows_saved:commits[0].rowsSaved,preserved_size_base_digest_offset_window_scan:true});console.log(JSON.stringify({attendance_throughput_native_stage:scenarios.at(-1)}));
    }

    for(const [name,config,expectedSize]of [['explicit_provider_cap',{providerCap:50},50],['oversized_response_fallback',{providerCap:null,oversizeAbove:50},50]]){
      const before=(await h.provider()).calls.length,commitBefore=(await h.wire()).batches.length;
      await fullRefresh(h,config);await published(h,root);await unchangedEvents();
      const calls=(await h.provider()).calls.slice(before).filter(c=>c.kind==='attendance');
      assert.equal(calls[0].page_size,100);assert.ok(calls.some(c=>c.page_size===expectedSize));
      const full=JSON.parse((await job(h)).checkpoint).refresh.full;assert.equal(full.count,ATTENDANCE_COUNT);assert.equal(full.pages,ATTENDANCE_COUNT/expectedSize);
      if(name==='oversized_response_fallback'){assert.ok(calls[0].bytes>2000000);assert.ok(calls.slice(1).every(c=>c.bytes<=2000000));}
      scenarios.push({name,requests:calls.map(c=>({page:c.page,size:c.page_size,rows:c.rows,bytes:c.bytes})),commits:(await h.wire()).batches.length-commitBefore});console.log(JSON.stringify({attendance_throughput_native_stage:scenarios.at(-1)}));
    }
    // A valid large status stays byte-for-byte intact through local slices;
    // opaque metadata changes on every provider reread do not affect digests.
    const statusText='雪😀"\\\u0001'.repeat(400),beforeHuge=(await h.provider()).calls.length,wireHuge=(await h.wire()).batches.length;
    await fullRefresh(h,{oversizeAbove:null,statusText});await published(h,root,{statusText});await unchangedEvents();
    const hugeCalls=(await h.provider()).calls.slice(beforeHuge).filter(c=>c.kind==='attendance'),hugeWire=(await h.wire()).batches.slice(wireHuge);
    assert.ok(hugeCalls.every(c=>c.bytes<=2000000));assert.ok(hugeWire.some(b=>b.attendanceRows>0&&b.attendanceRows<100),'large valid statuses require local byte slices');assert.ok(hugeWire.every(b=>b.attendanceRows<=100));
    scenarios.push({name:'escaped_unicode_status',status_bytes:Buffer.byteLength(statusText),provider_fetches:hugeCalls.length,source_commits:hugeWire.length,rows_per_commit:hugeWire.map(b=>b.attendanceRows),max_transaction_bytes:Math.max(...hugeWire.map(b=>b.totalBytes)),max_parameter_bytes:Math.max(...hugeWire.map(b=>b.maxParameterBytes))});console.log(JSON.stringify({attendance_throughput_native_stage:scenarios.at(-1)}));
    // Restore mixed statuses by removing the explicit status option.
    await h.configure(c=>{delete c.statusText;return c;});await fullRefresh(h);await published(h,root);
    // One real D1 source transaction commits before its acknowledgement is
    // lost. Reclaiming the persisted continuation never duplicates identity.
    const lossBefore=(await h.commitLoss()).count,lossMetrics=await h.metrics(),lossJob=await job(h);await h.commitLoss(true);await fullRefresh(h,{statusShift:1});await published(h,root,{statusShift:1});assert.equal((await h.commitLoss()).count,lossBefore+1);await unchangedEvents();
    assert.deepEqual((await h.metrics()).failures.slice(lossMetrics.failures.length).map(f=>({job_id:f.jobId,provider:f.provider,component:f.component,state:f.state,code:f.error.code})),[{job_id:lossJob.id,provider:'teamsnap',component:'attendance',state:'lease_lost',code:'fixture_lost_commit'}]);
    assert.deepEqual((await h.metrics()).leaseLost.slice(lossMetrics.leaseLost.length),[{jobId:lossJob.id,provider:'teamsnap',component:'attendance'}]);
    // A lost route reply replays the already-created connection, not demand.
    assert.equal((await h.request('/api/connections',{method:'POST',body,headers:{'x-fixture-lose-response':'1'}})).status,503);
    assert.equal(accepted(await h.request('/api/connections',{method:'POST',body}),202).replayed,true);assert.equal(await count(h,'team_source_connections'),1);
    // Held successful responses must lose commit authority on either account
    // revocation or last-root revocation, with saved source rows unchanged.
    await fullRefresh(h,{statusShift:0});await published(h,root);
    const fences=[];
    for(const stage of ['account','last_root']){
      const saved=await rows(h,'SELECT * FROM source_attendance ORDER BY id'),beforeMetrics=await h.metrics(),lost=beforeMetrics.leaseLost.length;
      await h.configure({hold:{kind:'attendance',page:1},extraPair:true});await h.advance('attendance');
      await h.waitFor(async()=>(await h.provider()).held?.kind==='attendance',{errors:false,timeout:30000});
      const captured=await job(h),accountAuthority=await h.db.prepare('SELECT id,generation,active FROM provider_accounts WHERE id=?').bind(account.id).first(),rootAuthority=await h.db.prepare('SELECT generation,active FROM team_source_connections WHERE id=?').bind(root.connection_id).first();assert.equal(captured.state,'running');assert.equal(captured.account_id,account.id);assert.equal(captured.authorization_generation,accountAuthority.generation);assert.ok((await h.provider()).held.pairs.includes('800000000000009:700000000099999'));
      const attribution={stage,job_id:captured.id,job_generation:captured.generation,authorization_generation:captured.authorization_generation,account_id:account.id,account_generation:accountAuthority.generation,root_generation:rootAuthority.generation,failure_index:beforeMetrics.failures.length,lease_index:beforeMetrics.leaseLost.length};
      if(stage==='account')accepted(await h.request('/api/accounts/'+account.id,{method:'DELETE',body:{}}));
      else{const active=await h.db.prepare('SELECT generation FROM team_source_connections WHERE id=?').bind(root.connection_id).first();accepted(await h.request('/api/connections/'+root.connection_id,{method:'DELETE',body:{team_id:root.team_id,generation:active.generation}}));}
      await h.configure({hold:null,extraPair:false});await h.waitFor(async()=>(await h.metrics()).leaseLost.length>lost,{errors:false,timeout:30000});
      const observed=await h.metrics(),failures=observed.failures.slice(beforeMetrics.failures.length);
      assert.deepEqual(observed.leaseLost.slice(lost),[{jobId:captured.id,provider:'teamsnap',component:'attendance'}]);
      assert.deepEqual(failures.map(f=>({job_id:f.jobId,provider:f.provider,component:f.component,state:f.state,code:f.error.code})),stage==='account'?[{job_id:captured.id,provider:'teamsnap',component:'attendance',state:'lease_lost',code:'stale_generation'}]:[]);
      const revoked=await h.db.prepare(stage==='account'?'SELECT generation,active FROM provider_accounts WHERE id=?':'SELECT generation,active FROM team_source_connections WHERE id=?').bind(stage==='account'?account.id:root.connection_id).first();assert.equal(revoked.active,0);assert.equal(revoked.generation,(stage==='account'?accountAuthority:rootAuthority).generation+1);
      assert.deepEqual(await rows(h,'SELECT * FROM source_attendance ORDER BY id'),saved);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM source_attendance WHERE source_player_id LIKE '%/700000000099999'").first()).n,0);
      fences.push({...attribution,revoked_generation:revoked.generation,expected_failures:stage==='account'?1:0,observed_failures:failures.length,lease_lost:1,rows_unchanged:true,extra_pair_rows:0});
      if(stage==='account'){account=await authorize(h);await h.settle();await published(h,root);}else await h.settle();
    }
    assert.deepEqual(await rows(h,'PRAGMA foreign_key_check'),[]);assert.deepEqual(await h.db.prepare('SELECT phase,writer_mode,writer_epoch,permit_guard FROM installation_upgrade WHERE id=1').first(),{phase:'complete',writer_mode:null,writer_epoch:null,permit_guard:null});const metrics=await h.metrics(),wire=await h.wire();safeBudgets(metrics,wire);
    assert.deepEqual(metrics.failures.map(f=>({job_id:f.jobId,provider:f.provider,component:f.component,state:f.state,code:f.error.code})),[{job_id:lossJob.id,provider:'teamsnap',component:'attendance',state:'lease_lost',code:'fixture_lost_commit'},{job_id:fences[0].job_id,provider:'teamsnap',component:'attendance',state:'lease_lost',code:'stale_generation'}]);
    console.log(JSON.stringify({attendance_throughput_native_complete:{source_fingerprint:h.sourceFingerprint,timing:{alarm_delay_ms:1,page_delay_ms:1,due_time_arrivals:'synthetic'},scenarios,lost_commit_acknowledgements:(await h.commitLoss()).count,fences,max_statements:metrics.maxStatements,max_source_parameter_bytes:metrics.maxAttendanceSourceParameterBytes,max_checkpoint_bytes:metrics.maxCheckpointBytes,max_transaction_bytes:Math.max(...wire.batches.map(b=>b.totalBytes)),max_parameter_bytes:Math.max(...wire.batches.map(b=>b.maxParameterBytes)),diagnostics:h.diagnostics(),synthetic:true}}));
  }catch(error){console.error(JSON.stringify({attendance_throughput_native_failure:{message:error.message,jobs:await rows(h,'SELECT provider,component,state,checkpoint,rows_saved,last_error_code,last_error_message FROM sync_jobs'),metrics:await h.metrics(),wire:await h.wire()}}));throw error;}finally{await h.dispose();}
});
