import test from 'node:test';
import assert from 'node:assert/strict';
import {largeHistoryHarness} from './fixtures/teamsnap-large-history-harness.mjs';
import {EVENT_COUNT,PLAYER_COUNT,TEAM_ID,fixtureEvent,fixtureAvailability,fixtureNotes,collectionBody} from './fixtures/teamsnap-large-history-provider.mjs';
const accepted=(result,status=200)=>{assert.equal(result.status,status,JSON.stringify(result.data));return result.data;};
const rows=async(h,sql,...params)=>(await h.db.prepare(sql).bind(...params).all()).results;
const count=async(h,table,where='',...params)=>(await h.db.prepare(`SELECT COUNT(*) n FROM ${table} ${where}`).bind(...params).first()).n;
const providerCalls=(h,kind)=>h.provider().then(value=>value.calls.filter(call=>call.kind===kind));
async function authorize(h){const flow=accepted(await h.request('/api/accounts/teamsnap/authorize',{method:'POST',body:{client_id:'synthetic-large-history-client'}}));return accepted(await h.request('/api/accounts/teamsnap/callback',{method:'POST',body:{state:flow.state,access_token:'synthetic-large-history-token',token_type:'Bearer'}})).account;}
async function checkPublished(h,root){
  assert.deepEqual((await rows(h,'SELECT year FROM team_seasons WHERE app_team_id=? ORDER BY year',root.team_id)).map(row=>row.year),[2023,2024,2025,2026]);
  const source=await rows(h,"SELECT native_id,evidence,home_score,away_score FROM source_events WHERE provider='teamsnap' ORDER BY CAST(native_id AS INTEGER)");
  assert.deepEqual(source.map(row=>Number(row.native_id)),Array.from({length:EVENT_COUNT},(_,index)=>910000+index),'all native event identities are saved exactly once');
  for(const [index,row]of source.entries()){
    const evidence=JSON.parse(row.evidence),event=fixtureEvent(index);
    assert.equal(evidence.notes,fixtureNotes(index),'Unicode notes survive byte-bounded collection without truncation');
    assert.equal(evidence.title,event.name);assert.equal(evidence.venue,event.location_name);assert.equal(evidence.uniform,event.uniform);
    assert.equal(evidence.reported.points_for_team,index%7);assert.equal(evidence.reported.points_for_opponent,index%4);
    assert.deepEqual(evidence.reported_scores,{home:index%7,away:index%4});
    assert.equal(row.home_score,null);assert.equal(row.away_score,null,'unverified provider scores are retained as evidence, never promoted to final');
  }
  const attendance=await rows(h,'SELECT e.native_id event_id,p.native_id player_id,a.source_status,a.status FROM source_attendance a JOIN source_events e ON e.id=a.source_event_id JOIN source_players p ON p.id=a.source_player_id ORDER BY CAST(e.native_id AS INTEGER),CAST(p.native_id AS INTEGER)');
  assert.equal(attendance.length,EVENT_COUNT*PLAYER_COUNT);
  assert.deepEqual(attendance,Array.from({length:EVENT_COUNT*PLAYER_COUNT},(_,index)=>{const row=fixtureAvailability(index);return {event_id:String(row.event_id),player_id:String(row.member_id),source_status:String(row.status_code),status:['No','Yes','Maybe'][row.status_code]};}));
  assert.equal(await count(h,'team_events','WHERE app_team_id=?',root.team_id),EVENT_COUNT);
  assert.equal(await count(h,'team_players','WHERE app_team_id=?',root.team_id),PLAYER_COUNT*4);
  assert.deepEqual(await rows(h,"SELECT native_id,name,jersey FROM source_players WHERE provider='teamsnap' ORDER BY CAST(native_id AS INTEGER)"),Array.from({length:PLAYER_COUNT},(_,index)=>({native_id:String(510000+index),name:'Player '+index,jersey:String(index+1)})));
  assert.equal(await count(h,'canonical_attendance','WHERE app_team_id=?',root.team_id),EVENT_COUNT*PLAYER_COUNT,'all attendance reaches the published seasons');
  assert.equal(await count(h,'connection_event_resolutions',"WHERE connection_id=? AND state='resolved'",root.connection_id),EVENT_COUNT);
  assert.equal(await count(h,'source_event_logistics'),EVENT_COUNT);
  assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM source_event_logistics l JOIN source_events e ON e.id=l.source_event_id WHERE l.notes IS NOT json_extract(e.evidence,'$.notes') OR l.uniform IS NOT json_extract(e.evidence,'$.uniform')").first()).n,0,'the complete notes and uniform also survive logistics publication');
  assert.equal(await count(h,'team_source_attachments','WHERE app_team_id=? AND active=1',root.team_id),4);
  assert.equal(await count(h,'team_projection_state','WHERE app_team_id=? AND pending=1',root.team_id),0);
}

// The complete path starts on a fresh installation with owner HTTP OAuth and
// discovery, then an ordinary yearless connection. No fixture inserts source
// rows, target seasons, attachments, or projection state. Alarms finish the work
// without application-client polling. Inspection routes are test diagnostics.
// This proves the synthetic contract and native runtime, not live entitlement.
test('native large TeamSnap history paginates, resumes and publishes every event and attendance row within unchanged budgets',async()=>{
  const unpaged={events:Buffer.byteLength(JSON.stringify(collectionBody(Array.from({length:EVENT_COUNT},(_,index)=>fixtureEvent(index))))),attendance:Buffer.byteLength(JSON.stringify(collectionBody(Array.from({length:EVENT_COUNT*PLAYER_COUNT},(_,index)=>fixtureAvailability(index)))))};
  assert.ok(unpaged.events>2_002_944);assert.ok(unpaged.attendance>2_002_944);
  console.log(JSON.stringify({teamsnap_large_unpaged:unpaged,events:EVENT_COUNT,players:PLAYER_COUNT,attendance:EVENT_COUNT*PLAYER_COUNT}));
  const h=await largeHistoryHarness();
  try{
    await h.initialize();await h.configure({failOnce:{kind:'attendance',page:2},updatedAt:new Date().toISOString(),recentDay:new Date(Date.now()-7*86400000).toISOString().slice(0,10)});
    let account=await authorize(h);await h.settle();
    assert.equal(await count(h,'app_teams'),0);assert.equal(await count(h,'team_seasons'),0);assert.equal(await count(h,'team_source_attachments'),0);
    assert.equal(await count(h,'source_events'),0,'discovery does not deep-import an unselected team');
    const source=await h.db.prepare("SELECT id FROM source_teams WHERE provider='teamsnap' AND account_id=? AND native_id=?").bind(account.id,String(TEAM_ID)).first();assert.ok(source);
    const body={request_id:crypto.randomUUID(),source_team_id:source.id,account_id:account.id,new_team:{name:'Complete synthetic history',timezone:'UTC',timezone_source:'device',kind:'own'}};
    const lost=await h.request('/api/connections',{method:'POST',body,headers:{'x-fixture-lose-response':'1'}});assert.equal(lost.status,503);
    const root=accepted(await h.request('/api/connections',{method:'POST',body}),202);assert.equal(root.replayed,true);assert.equal(root.season_id,null);
    assert.equal(await count(h,'app_teams'),1);assert.equal(await count(h,'team_source_connections'),1,'lost HTTP response replays one root');
    let firstPassPublication=null;
    const retry=await h.waitFor(async()=>{
      if(!firstPassPublication){const visible=await h.db.prepare("SELECT (SELECT COUNT(*) FROM team_events WHERE app_team_id=?) published_events,j.coverage,j.checkpoint,c.complete full_complete FROM sync_jobs j JOIN source_component_coverage c ON c.account_id=j.account_id AND c.kind='events' WHERE j.provider='teamsnap' AND j.component='events'").bind(root.team_id).first();if(visible?.published_events>0&&visible.full_complete===0&&visible.coverage!=='complete')firstPassPublication={published_events:visible.published_events,pass:JSON.parse(visible.checkpoint).pass,coverage:visible.coverage};}
      const failed=await rows(h,"SELECT component,state,last_error_code,rows_saved FROM sync_jobs WHERE provider='teamsnap' AND state IN('failed','blocked')");
      if(failed.length)throw Error('TeamSnap collection failed before resume: '+JSON.stringify(failed));
      return h.db.prepare("SELECT checkpoint,rows_saved,pages_saved FROM sync_jobs WHERE provider='teamsnap' AND component='attendance' AND state='retrying'").first();
    },{errors:false});
    assert.ok(firstPassPublication,'useful games publish while the first full-history receipt is still partial');
    console.log(JSON.stringify({teamsnap_first_pass_publication:firstPassPublication}));
    assert.ok(retry.rows_saved>0,'the first page is saved before a later-page transport failure');
    const checkpoint=JSON.parse(retry.checkpoint);assert.equal(new URL(checkpoint.url).searchParams.get('page_number'),'2');
    assert.equal(await count(h,'source_attendance'),retry.rows_saved);
    // Model only arrival of the retry due time. Production scheduled recovery,
    // SourceTransport, persisted checkpoint and alarms perform the actual retry.
    await h.advance('attendance','retrying');
    await h.waitFor(async()=>(await h.db.prepare("SELECT state FROM sync_jobs WHERE provider='teamsnap' AND component='attendance'").first()).state!=='retrying',{errors:false});
    await h.settle({timeout:300000});await checkPublished(h,root);
    const metrics=await h.metrics(),calls=(await h.provider()).calls;
    for(const kind of ['events','attendance']){
      const componentCalls=calls.filter(call=>call.kind===kind),successful=componentCalls.filter(call=>call.status===200),starts=successful.filter(call=>call.page===1);
      assert.ok(starts.length>=2,kind+' must verify two full traversals before completing coverage');
      assert.ok(successful.every(call=>call.page_size>0&&call.bytes<=2_000_000),kind+' uses real bounded HTTP responses');
      assert.ok(successful.some(call=>call.page>1));
      const job=await h.db.prepare("SELECT coverage,checkpoint,rows_saved FROM sync_jobs WHERE provider='teamsnap' AND component=?").bind(kind).first();assert.equal(job.coverage,'complete');assert.equal(JSON.parse(job.checkpoint).finished,true);
      const coverage=await h.db.prepare("SELECT complete,record_count FROM source_component_coverage WHERE provider='teamsnap' AND account_id=? AND kind=?").bind(account.id,kind).first();
      assert.deepEqual(coverage,{complete:1,record_count:kind==='events'?EVENT_COUNT:EVENT_COUNT*PLAYER_COUNT},'terminal component receipt reports distinct traversal rows, not local or double-scan totals');
    }
    assert.equal(calls.filter(call=>call.fault==='transient').length,1);
    assert.ok(calls.filter(call=>call.kind==='attendance'&&call.page===2).length>=3,'failed page resumes and is checked again on the verification traversal');
    assert.ok(metrics.localSlices>0,'long valid notes force local resumable transaction slicing');
    assert.ok(metrics.maxStatements<=50);assert.ok(metrics.maxPayloadBytes<=2_000_000);assert.ok(metrics.maxCheckpointBytes<=8192);assert.deepEqual(metrics.violations,[]);
    assert.ok(metrics.failures.every(failure=>failure.component==='attendance'&&failure.error.code==='source_http'),JSON.stringify(metrics.failures));
    console.log(JSON.stringify({teamsnap_large_publication:{source_fingerprint:h.sourceFingerprint,unpaged,events:EVENT_COUNT,attendance:EVENT_COUNT*PLAYER_COUNT,seasons:4,max_statements:metrics.maxStatements,max_transaction_bytes:metrics.maxPayloadBytes,max_checkpoint_bytes:metrics.maxCheckpointBytes,groups:metrics.groups,source_calls:calls.length,retried_checkpoint:checkpoint}}));

    // An unchanged complete source scan is a replay, not additional identities,
    // roster entries or attendance. Use a normal provider interval and alarms.
    const beforeAdaptive=(await h.provider()).calls.length;await h.configure({largePageMetadata:true});
    await h.advance('events');await h.settle({timeout:300000});await checkPublished(h,root);
    const adaptive=(await h.provider()).calls.slice(beforeAdaptive).filter(call=>call.kind==='events');
    assert.ok(adaptive.some(call=>call.page_size===25&&call.bytes>2_000_000),'a requested provider page may still exceed the unchanged transport bound');
    assert.ok(adaptive.some(call=>call.page_size===12&&call.page>1&&call.bytes<=2_000_000),'the same native query resumes with a smaller supported server page');
    const oversizedAudit=await rows(h,"SELECT status,bytes,error_code FROM sync_observations WHERE endpoint LIKE '%/events/search' AND error_code='record_too_large'");assert.ok(oversizedAudit.some(row=>row.status===200&&row.bytes>2_000_000));
    console.log(JSON.stringify({teamsnap_large_adaptive:{oversized_observations:oversizedAudit,pages:adaptive.length,sizes:[...new Set(adaptive.map(call=>call.page_size))]}}));
    await h.configure({largePageMetadata:false});
    assert.equal(await count(h,'app_teams'),1);assert.equal(await count(h,'team_source_connections'),1);

    // Hold a real successful HTTP page after its old authorization was captured.
    // Revocation must fence the extra in-window event and preserve saved seasons.
    let lostLeases=(await h.metrics()).leaseLost.length;
    await h.configure({hold:{kind:'events',page:1},extraEvent:true});await h.advance('events');
    await h.waitFor(async()=>(await h.provider()).held?.kind==='events',{timeout:10000,errors:false});
    assert.ok((await h.provider()).held.ids.includes(919999),'the held response actually contains the new in-window identity');
    accepted(await h.request('/api/accounts/'+account.id,{method:'DELETE',body:{}}));
    await h.configure({hold:null,extraEvent:false});
    await h.waitFor(async()=>(await h.metrics()).leaseLost.length>lostLeases,{timeout:15000,errors:false});
    assert.equal(await count(h,'source_events',"WHERE native_id='919999'"),0,'stale account authorization cannot commit its captured page');
    assert.equal(await count(h,'team_seasons','WHERE app_team_id=?',root.team_id),4);
    assert.equal((await h.db.prepare('SELECT active FROM provider_accounts WHERE id=?').bind(account.id).first()).active,0);

    account=await authorize(h);await h.settle({timeout:300000});await checkPublished(h,root);
    lostLeases=(await h.metrics()).leaseLost.length;
    await h.configure({hold:{kind:'events',page:1},extraEvent:true});await h.advance('events');
    await h.waitFor(async()=>(await h.provider()).held?.kind==='events',{timeout:10000,errors:false});
    assert.ok((await h.provider()).held.ids.includes(919999),'the held response actually contains the new in-window identity');
    accepted(await h.request('/api/connections/'+root.connection_id,{method:'DELETE',body:{team_id:root.team_id,generation:root.connection.generation}}));
    await h.configure({hold:null,extraEvent:false});
    await h.waitFor(async()=>(await h.metrics()).leaseLost.length>lostLeases,{timeout:15000,errors:false});await h.settle({timeout:300000});
    assert.equal(await count(h,'source_events',"WHERE native_id='919999'"),0,'retired last-root demand cannot commit its captured page');
    assert.equal(await count(h,'team_seasons','WHERE app_team_id=?',root.team_id),4);
    assert.equal(await count(h,'team_source_attachments','WHERE app_team_id=? AND active=1',root.team_id),0);
    assert.equal(await count(h,'team_events','WHERE app_team_id=?',root.team_id),0);
    assert.equal((await h.request('/api/connections',{method:'POST',body})).status,409,'an old request cannot recreate an unlinked root');
    const final=await h.metrics();assert.ok(final.maxStatements<=50);assert.ok(final.maxPayloadBytes<=2_000_000);assert.deepEqual(final.violations,[]);
    assert.deepEqual(await rows(h,'PRAGMA foreign_key_check'),[]);
    console.log(JSON.stringify({teamsnap_large_fences:{authorization:true,last_root:true,lease_lost:final.leaseLost.length,max_statements:final.maxStatements,max_transaction_bytes:final.maxPayloadBytes}}));
  }catch(error){
    console.error(JSON.stringify({teamsnap_large_failure:{message:error.message,observations:await rows(h,"SELECT j.component,o.status,MAX(o.bytes) max_bytes,o.error_code,COUNT(*) observations FROM sync_observations o JOIN sync_jobs j ON j.id=o.job_id WHERE j.provider='teamsnap' GROUP BY j.component,o.status,o.error_code"),jobs:await rows(h,"SELECT component,state,rows_saved,last_error_code FROM sync_jobs WHERE provider='teamsnap'")}}));throw error;
  }finally{await h.dispose();}
});
