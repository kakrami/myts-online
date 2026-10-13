import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceIdentityHarness} from './fixtures/teamsnap-attendance-identity-harness.mjs';
import {ATTENDANCE_COUNT,EVENT_COUNT,PLAYER_COUNT,TEAM_ID,fixtureEvent,fixtureAvailability,normalizedStatus} from './fixtures/teamsnap-attendance-identity-provider.mjs';
const accepted=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const rows=async(h,sql,...params)=>(await h.db.prepare(sql).bind(...params).all()).results;
const count=async(h,table,where='',...params)=>(await h.db.prepare(`SELECT COUNT(*) n FROM ${table} ${where}`).bind(...params).first()).n;
const job=(h,component)=>h.db.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap' AND component=?").bind(component).first();
async function authorize(h){const flow=accepted(await h.request('/api/accounts/teamsnap/authorize',{method:'POST',body:{client_id:'synthetic-attendance-identity-client'}}));return accepted(await h.request('/api/accounts/teamsnap/callback',{method:'POST',body:{state:flow.state,access_token:'synthetic-attendance-identity-token',token_type:'Bearer'}})).account;}
const oldBinding=checkpoint=>{const old=structuredClone(checkpoint);old.refresh.binding=Object.fromEntries(['kind','team_id','account_id','authorization_generation','args_url','payload','source'].map(k=>[k,old.refresh.binding[k]]));return old;};
async function savedAttendance(h){return rows(h,'SELECT * FROM source_attendance ORDER BY id');}
async function checkPublished(h,root,{statusShift=0}={}){
  const expected=Array.from({length:ATTENDANCE_COUNT},(_,i)=>{const r=fixtureAvailability(i,{statusShift});return {event_id:String(r.event_id),player_id:String(r.member_id),source_status:r.status_code==null?'':String(r.status_code),status:normalizedStatus(r)};});
  const source=await rows(h,'SELECT e.native_id event_id,p.native_id player_id,a.source_status,a.status FROM source_attendance a JOIN source_events e ON e.id=a.source_event_id JOIN source_players p ON p.id=a.source_player_id ORDER BY CAST(e.native_id AS INTEGER),CAST(p.native_id AS INTEGER)');
  assert.deepEqual(source,expected,'all distinct event/member tuples and status/null/unknown semantics survive source storage');
  const canonical=await rows(h,'SELECT e.native_id event_id,p.native_id player_id,a.status FROM canonical_attendance a JOIN source_events e ON e.id=a.source_event_id JOIN source_players p ON p.id=a.source_player_id WHERE a.app_team_id=? ORDER BY CAST(e.native_id AS INTEGER),CAST(p.native_id AS INTEGER)',root.team_id);
  assert.deepEqual(canonical,expected.map(({source_status,...r})=>r),'exact attendance reaches ordinary canonical publication');
  assert.equal(await count(h,'source_attendance'),ATTENDANCE_COUNT);assert.equal(await count(h,'source_events'),EVENT_COUNT);assert.equal(await count(h,'source_players'),PLAYER_COUNT);
  assert.equal(await count(h,'team_events','WHERE app_team_id=?',root.team_id),EVENT_COUNT);
  assert.equal(await count(h,'connection_event_resolutions',"WHERE connection_id=? AND state='resolved'",root.connection_id),EVENT_COUNT);
  assert.equal(await count(h,'team_projection_state','WHERE app_team_id=? AND pending=1',root.team_id),0);
  assert.equal(await count(h,'source_events','WHERE home_score IS NOT NULL OR away_score IS NOT NULL'),0,'unverified provider score evidence is not promoted');
  for(const r of await rows(h,'SELECT native_id,evidence FROM source_events ORDER BY CAST(native_id AS INTEGER)')){const i=Number(r.native_id)-910000,e=JSON.parse(r.evidence);assert.equal(e.notes,fixtureEvent(i).notes);assert.equal(e.reported.points_for_team,i%7);}
}

// Actual production Worker -> SourceTransport -> collector -> coordinator ->
// native D1 + installation epoch -> connection materializer -> projector.
// Provider rows, due-time arrivals, response loss and the one-shot post-batch
// acknowledgement loss are synthetic. No live account, credential or data.
test('native attendance tuple identity repairs opaque IDs, converges, retries and fences without changing events or budgets',async()=>{
  const baseline=process.env.MYTS_TEST_EXPECT_723_RED==='1',h=await attendanceIdentityHarness();
  try{
    await h.initialize();await h.configure({recentDay:new Date(Date.now()-7*86400000).toISOString().slice(0,10),...(baseline?{}:{failOnce:{kind:'attendance',page:2}})});
    let account=await authorize(h);await h.settle();
    assert.equal(await count(h,'source_events'),0);assert.equal(await count(h,'source_attendance'),0);assert.equal(await count(h,'team_seasons'),0,'catalog does not deep-import an unselected team');
    const source=await h.db.prepare("SELECT id FROM source_teams WHERE provider='teamsnap' AND account_id=? AND native_id=?").bind(account.id,String(TEAM_ID)).first();assert.ok(source);
    const body={request_id:crypto.randomUUID(),source_team_id:source.id,account_id:account.id,new_team:{name:'Attendance identity native proof',timezone:'UTC',timezone_source:'device',kind:'own'}};
    if(!baseline)await h.commitLoss(true);
    assert.equal((await h.request('/api/connections',{method:'POST',body,headers:{'x-fixture-lose-response':'1'}})).status,503);
    const root=accepted(await h.request('/api/connections',{method:'POST',body}),202);assert.equal(root.replayed,true);assert.equal(root.season_id,null);
    assert.equal(await count(h,'app_teams'),1);assert.equal(await count(h,'team_source_connections'),1);
    const retryRoute='/api/connections/'+root.connection_id+'/attendance/retry',retryBody={team_id:root.team_id,generation:root.connection.generation};
    if(baseline){
      for(let attempt=1;attempt<=3;attempt++){
        const failure=await h.waitFor(async()=>{const j=await job(h,'attendance');return j.state==='failed'&&j.attempts>=attempt?j:null;},{errors:false});
        assert.equal(failure.last_error_code,'contract_violation');assert.equal(failure.rows_saved,0);
        assert.equal(failure.last_error_message,'The collector result did not satisfy its storage contract. Diagnostic: attendance_identity; items=25; invalid_ids=25; duplicate_ids=0; valid_pairs=25; duplicate_pairs=0.');
        if(attempt<3)accepted(await h.request(retryRoute,{method:'POST',body:retryBody}),202);
      }
      const failure=await job(h,'attendance'),audit=await rows(h,'SELECT attempt,status,bytes,error_code FROM sync_observations WHERE job_id=? ORDER BY attempt',failure.id);
      assert.deepEqual(audit.map(a=>({attempt:a.attempt,status:a.status,bytes:a.bytes,error_code:a.error_code})),[1,2,3].map(attempt=>({attempt,status:200,bytes:29445,error_code:null})));
      assert.equal(await count(h,'source_attendance'),0);
      console.log(JSON.stringify({attendance_identity_baseline_red:{source_fingerprint:h.sourceFingerprint,diagnostic:failure.last_error_message,audit,synthetic:true}}));return;
    }
    const retry=await h.waitFor(async()=>{const j=await job(h,'attendance');if(['failed','blocked'].includes(j.state))throw Error(JSON.stringify(j));return j.state==='retrying'?j:null;},{errors:false});
    const interrupted=JSON.parse(retry.checkpoint);
    assert.equal(new URL(interrupted.url).searchParams.get('page_number'),'2');assert.equal(retry.rows_saved,25);assert.equal(await count(h,'source_attendance'),25);
    assert.equal((await h.commitLoss()).count,1,'one real source transaction commits before its acknowledgement is lost');
    await h.advance('attendance','retrying');await h.settle({timeout:180000});await checkPublished(h,root);
    const initialCalls=(await h.provider()).calls.filter(c=>c.kind==='attendance');
    assert.deepEqual(initialCalls.filter(c=>c.status===200).map(c=>c.page),[1,2,3,4,1,2,3,4],'changed/omitted/duplicate unused IDs and volatile timestamps do not prevent two-pass semantic convergence');
    assert.equal(initialCalls.filter(c=>c.fault==='transient').length,1);assert.ok(initialCalls.every(c=>c.page_size===25));assert.equal(initialCalls[0].bytes,29445);
    const fullJob=await job(h,'attendance'),full=JSON.parse(fullJob.checkpoint).refresh.full;
    assert.equal(full.count,ATTENDANCE_COUNT);assert.equal(full.pages,4);assert.equal(fullJob.coverage,'complete');
    assert.deepEqual(await h.db.prepare("SELECT complete,record_count FROM source_component_coverage WHERE account_id=? AND kind='attendance'").bind(account.id).first(),{complete:1,record_count:ATTENDANCE_COUNT});
    const originalEvents=await job(h,'events'),sourceEvents=await rows(h,'SELECT * FROM source_events ORDER BY id');
    assert.equal(originalEvents.coverage,'complete');assert.equal(JSON.parse(originalEvents.checkpoint).refresh.full.count,EVENT_COUNT);
    // Install an ordinary owner correction through its HTTP route, then retain
    // it through attendance failure, retry, migration and authorization changes.
    const corrected=await h.db.prepare('SELECT event_id,team_season_id FROM team_events WHERE app_team_id=? ORDER BY event_id LIMIT 1').bind(root.team_id).first();
    const query=new URLSearchParams({team_id:root.team_id,team_season_id:corrected.team_season_id});
    accepted(await h.request('/api/matches/'+encodeURIComponent(corrected.event_id)+'/correction?'+query,{method:'PUT',body:{revision:0,fields:{venue:'Owner corrected field',status:'FINAL',home_score:4,away_score:2}}}),202);
    await h.settle();const correction=await rows(h,'SELECT * FROM domain_overrides ORDER BY app_team_id,kind,entity_id');assert.equal(correction.length,1);
    const assertPreserved=async()=>{assert.deepEqual(await job(h,'events'),originalEvents,'attendance-only repair leaves completed event job, scan, counters and full receipt untouched');assert.deepEqual(await rows(h,'SELECT * FROM source_events ORDER BY id'),sourceEvents);assert.deepEqual(await rows(h,'SELECT * FROM domain_overrides ORDER BY app_team_id,kind,entity_id'),correction);};
    await assertPreserved();
    // A conflicting duplicate is late in the first page. No earlier valid rows
    // or changed statuses from that page may be partially committed.
    const beforeInvalid=await savedAttendance(h);
    await h.configure({duplicatePair:true,statusShift:1});await h.advance('attendance');
    const failed=await h.waitFor(async()=>{const j=await job(h,'attendance');return j.state==='failed'?j:null;},{errors:false});
    assert.equal(failed.last_error_code,'contract_violation');assert.match(failed.last_error_message,/duplicate_pairs=1/);
    assert.deepEqual(await savedAttendance(h),beforeInvalid);assert.equal(failed.rows_saved,fullJob.rows_saved);await assertPreserved();
    await h.configure({duplicatePair:false,statusShift:0,hold:{kind:'attendance',page:1}});
    assert.equal((await h.request(retryRoute,{method:'POST',body:retryBody,headers:{'x-fixture-lose-response':'1'}})).status,503);
    await h.waitFor(async()=>(await h.provider()).held?.kind==='attendance',{timeout:30000,errors:false});
    const heldJob=await job(h,'attendance'),heldWake=accepted(await h.request('/__fixture/wake'));
    assert.equal((await h.request(retryRoute,{method:'POST',body:retryBody})).status,409,'a replay cannot replace the already-running attendance lease');
    assert.deepEqual(await job(h,'attendance'),heldJob);assert.deepEqual(accepted(await h.request('/__fixture/wake')),heldWake,'rejected running replay does not wake or reset the job');await assertPreserved();
    await h.configure({hold:null});await h.settle({timeout:180000});await checkPublished(h,root);await assertPreserved();
    assert.deepEqual(JSON.parse((await job(h,'attendance')).checkpoint).refresh.full,full,'successful recent retry cannot replace full-history evidence');
    // A second malformed tuple is rejected before writes, also exercising the
    // existing targeted owner action after a genuinely failed source request.
    await h.configure({malformedPair:true,statusShift:2});await h.advance('attendance');
    const malformed=await h.waitFor(async()=>{const j=await job(h,'attendance');return j.state==='failed'?j:null;},{errors:false});
    assert.equal(malformed.last_error_code,'unsupported_response');assert.deepEqual(await savedAttendance(h),beforeInvalid);await assertPreserved();
    await h.configure({malformedPair:false,statusShift:0});accepted(await h.request(retryRoute,{method:'POST',body:retryBody}),202);await h.settle();await checkPublished(h,root);
    // Simulate persisted pre-upgrade binding bytes only. Keep source rows and
    // authoritative account/root identities; native claim/collect decides how
    // to invalidate either terminal or interrupted numeric-ID checkpoints.
    const migration=[];
    for(const [mode,cursor]of [['completed',oldBinding(JSON.parse((await job(h,'attendance')).checkpoint))],['active',oldBinding(interrupted)]]){
      if(mode==='active')cursor.previous_ids=['610001','610002'];
      const before=(await h.provider()).calls.length,saved=await savedAttendance(h);
      await h.db.prepare("UPDATE sync_jobs SET checkpoint=?,state=?,next_at=0,lease_until=0,lease_token=NULL WHERE provider='teamsnap' AND component='attendance'").bind(JSON.stringify(cursor),mode==='completed'?'ready':'retrying').run();
      await h.configure({hold:{kind:'attendance',page:1}});await h.advance('attendance',mode==='completed'?'ready':'retrying');
      await h.waitFor(async()=>(await h.provider()).held?.kind==='attendance',{timeout:30000,errors:false});
      assert.deepEqual(await savedAttendance(h),saved,'migration preserves saved data while a full page-one revalidation is held');
      const start=(await h.provider()).calls.slice(before).find(c=>c.kind==='attendance');assert.equal(start.page,1);assert.equal(new URL('https://synthetic'+start.search).searchParams.has('started_after'),false,'legacy attendance receipt cannot narrow the migration to a recent scan');
      await h.configure({hold:null});await h.settle({timeout:180000});await checkPublished(h,root);await assertPreserved();
      const calls=(await h.provider()).calls.slice(before).filter(c=>c.kind==='attendance');assert.deepEqual(calls.map(c=>c.page),[1,2,3,4,1,2,3,4]);
      migration.push({mode,pages:calls.map(c=>c.page),saved_before:saved.length,saved_after:await count(h,'source_attendance')});
    }
    console.log(JSON.stringify({attendance_identity_native:{source_fingerprint:h.sourceFingerprint,events:EVENT_COUNT,players:PLAYER_COUNT,source_attendance:ATTENDANCE_COUNT,canonical_attendance:ATTENDANCE_COUNT,initial_pages:initialCalls.map(c=>({page:c.page,status:c.status,bytes:c.bytes})),lost_commit_acknowledgements:(await h.commitLoss()).count,failed_duplicate_before_writes:true,failed_malformed_before_writes:true,targeted_retry_event_receipt_unchanged:true,owner_correction_preserved:true,migration}}));
    // Hold an actual successful attendance response under captured authority.
    // Extra pair is deliberately outside the saved roster to make any stale
    // source commit observable without relying on later canonical publication.
    const revocationStages=[];let lostLeases=(await h.metrics()).leaseLost.length;
    await h.configure({hold:{kind:'attendance',page:1},extraPair:true});await h.advance('attendance');
    await h.waitFor(async()=>(await h.provider()).held?.kind==='attendance',{timeout:30000,errors:false});assert.ok((await h.provider()).held.pairs.includes('910006:519999'));
    const heldAccountJob=await job(h,'attendance'),accountAuthority=await h.db.prepare('SELECT id,generation,active FROM provider_accounts WHERE id=?').bind(account.id).first(),accountRoot=await h.db.prepare('SELECT generation FROM team_source_connections WHERE id=?').bind(root.connection_id).first(),beforeAccountMetrics=await h.metrics(),beforeAccountRows=await savedAttendance(h);
    assert.equal(heldAccountJob.state,'running');assert.equal(heldAccountJob.account_id,account.id);assert.equal(heldAccountJob.authorization_generation,accountAuthority.generation);
    const accountStage={stage:'account_revocation',job_id:heldAccountJob.id,job_generation:heldAccountJob.generation,authorization_generation:heldAccountJob.authorization_generation,account_id:account.id,account_generation:accountAuthority.generation,root_generation:accountRoot.generation,failure_index:beforeAccountMetrics.failures.length,lease_index:beforeAccountMetrics.leaseLost.length};
    accepted(await h.request('/api/accounts/'+account.id,{method:'DELETE',body:{}}));await h.configure({hold:null,extraPair:false});
    await h.waitFor(async()=>(await h.metrics()).leaseLost.length>lostLeases,{timeout:30000,errors:false});
    const accountMetrics=await h.metrics(),accountFailures=accountMetrics.failures.slice(accountStage.failure_index);
    assert.deepEqual(accountFailures.map(f=>({job_id:f.jobId,provider:f.provider,component:f.component,state:f.state,code:f.error.code})),[{job_id:heldAccountJob.id,provider:'teamsnap',component:'attendance',state:'lease_lost',code:'stale_generation'}],'only the captured held account job emits stale_generation in the account revocation stage');
    assert.deepEqual(accountMetrics.leaseLost.slice(accountStage.lease_index),[{jobId:heldAccountJob.id,provider:'teamsnap',component:'attendance'}]);
    const revokedAccount=await h.db.prepare('SELECT generation,active FROM provider_accounts WHERE id=?').bind(account.id).first();assert.equal(revokedAccount.active,0);assert.equal(revokedAccount.generation,accountAuthority.generation+1);
    assert.deepEqual(await savedAttendance(h),beforeAccountRows);assert.equal(await count(h,'source_attendance',"WHERE source_player_id LIKE '%/519999'"),0);assert.equal(await count(h,'source_attendance'),ATTENDANCE_COUNT);assert.deepEqual(await rows(h,'SELECT * FROM domain_overrides ORDER BY app_team_id,kind,entity_id'),correction);
    revocationStages.push({...accountStage,revoked_generation:revokedAccount.generation,expected_failures:1,observed_failures:accountFailures.length,code:'stale_generation',rows_unchanged:true,extra_pair_rows:0});
    account=await authorize(h);await h.settle({timeout:180000});await checkPublished(h,root);
    lostLeases=(await h.metrics()).leaseLost.length;
    await h.configure({hold:{kind:'attendance',page:1},extraPair:true});await h.advance('attendance');
    await h.waitFor(async()=>(await h.provider()).held?.kind==='attendance',{timeout:30000,errors:false});assert.ok((await h.provider()).held.pairs.includes('910006:519999'));
    const heldRootJob=await job(h,'attendance'),rootAuthority=await h.db.prepare('SELECT generation,active FROM team_source_connections WHERE id=?').bind(root.connection_id).first(),rootAccount=await h.db.prepare('SELECT generation FROM provider_accounts WHERE id=?').bind(account.id).first(),beforeRootMetrics=await h.metrics(),beforeRootRows=await savedAttendance(h),generation=rootAuthority.generation;
    assert.equal(heldRootJob.state,'running');assert.equal(heldRootJob.account_id,account.id);assert.equal(heldRootJob.authorization_generation,rootAccount.generation);
    const rootStage={stage:'last_root_revocation',job_id:heldRootJob.id,job_generation:heldRootJob.generation,authorization_generation:heldRootJob.authorization_generation,account_id:account.id,account_generation:rootAccount.generation,root_generation:generation,failure_index:beforeRootMetrics.failures.length,lease_index:beforeRootMetrics.leaseLost.length};
    accepted(await h.request('/api/connections/'+root.connection_id,{method:'DELETE',body:{team_id:root.team_id,generation}}));await h.configure({hold:null,extraPair:false});
    await h.waitFor(async()=>(await h.metrics()).leaseLost.length>lostLeases,{timeout:30000,errors:false});await h.settle({timeout:180000});
    const rootMetrics=await h.metrics();assert.deepEqual(rootMetrics.failures.slice(rootStage.failure_index),[],'last-root revocation is rejected by the commit fence without another collector failure');assert.deepEqual(rootMetrics.leaseLost.slice(rootStage.lease_index),[{jobId:heldRootJob.id,provider:'teamsnap',component:'attendance'}]);
    const revokedRoot=await h.db.prepare('SELECT generation,active FROM team_source_connections WHERE id=?').bind(root.connection_id).first();assert.equal(revokedRoot.active,0);assert.equal(revokedRoot.generation,generation+1);
    assert.deepEqual(await savedAttendance(h),beforeRootRows);assert.equal(await count(h,'source_attendance',"WHERE source_player_id LIKE '%/519999'"),0);assert.equal(await count(h,'source_attendance'),ATTENDANCE_COUNT);assert.equal(await count(h,'canonical_attendance','WHERE app_team_id=?',root.team_id),0);
    revocationStages.push({...rootStage,revoked_generation:revokedRoot.generation,expected_failures:0,observed_failures:0,lease_lost:1,rows_unchanged:true,extra_pair_rows:0});
    assert.equal(await count(h,'team_source_attachments','WHERE app_team_id=? AND active=1',root.team_id),0);assert.deepEqual(await rows(h,'SELECT * FROM domain_overrides ORDER BY app_team_id,kind,entity_id'),correction);
    assert.equal((await h.request('/api/connections',{method:'POST',body})).status,409);assert.deepEqual(await rows(h,'PRAGMA foreign_key_check'),[]);
    const metrics=await h.metrics();assert.ok(metrics.maxStatements<=50);assert.ok(metrics.maxPayloadBytes<=2_000_000);assert.ok(metrics.maxCheckpointBytes<=8192);assert.deepEqual(metrics.violations,[]);
    assert.ok(metrics.failures.every(f=>f.jobId===fullJob.id),'every injected failure is bound to the one selected attendance job');
    assert.deepEqual(metrics.failures.map(f=>[f.provider,f.component,f.state,f.error.code]),[['teamsnap','attendance','lease_lost','fixture_lost_commit'],['teamsnap','attendance','retrying','source_http'],['teamsnap','attendance','failed','contract_violation'],['teamsnap','attendance','failed','unsupported_response'],['teamsnap','attendance','lease_lost','stale_generation']],'only the explicitly injected failures and stale-account fence are observed');
    console.log(JSON.stringify({attendance_identity_fences_and_budgets:{source_fingerprint:h.sourceFingerprint,account_fence:true,last_root_fence:true,revocation_stages:revocationStages,lease_lost:metrics.leaseLost.length,max_statements:metrics.maxStatements,max_transaction_bytes:metrics.maxPayloadBytes,max_checkpoint_bytes:metrics.maxCheckpointBytes,groups:metrics.groups,timing:{alarm_delay_ms:1,page_delay_ms:1,due_time_arrivals:'synthetic'},failure_codes:metrics.failures.map(f=>({state:f.state,code:f.error.code}))}}));
  }catch(error){console.error(JSON.stringify({attendance_identity_failure:{message:error.message,jobs:await rows(h,'SELECT provider,component,state,checkpoint,rows_saved,last_error_code,last_error_message FROM sync_jobs'),metrics:await h.metrics().then(({commits,...metrics})=>metrics)}}));throw error;
  }finally{await h.dispose();}
});
