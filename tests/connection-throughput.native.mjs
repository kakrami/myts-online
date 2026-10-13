import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {connectionThroughputHarness} from './fixtures/connection-throughput-harness.mjs';
import {EVENT_COUNT,PLAYER_COUNT,TEAM_ID,YEARS,fixtureEvent,fixtureAvailability} from './fixtures/connection-throughput-provider.mjs';

// Run separately from npm test, with one native runner. Both 500 ms production
// delays are unchanged. There are no manual runner requests, arrival-time edits,
// fake alarms, precreated app seasons, or direct source/projection seed writes.
// Optional MYTS_THROUGHPUT_D1_LATENCY_MS is explicitly synthetic sensitivity,
// never evidence of hosted Cloudflare latency. Baseline mode stops at a bounded
// event prefix; it is not a full-run pass and reports extrapolation separately.
const BASELINE=process.env.MYTS_THROUGHPUT_BASELINE==='1';
const PREFIX_ONLY=BASELINE||process.env.MYTS_THROUGHPUT_PREFIX_ONLY==='1';
const PREFIX=Number(process.env.MYTS_THROUGHPUT_PREFIX||64);
const DEADLINE=Number(process.env.MYTS_THROUGHPUT_DEADLINE_MS||(PREFIX_ONLY?360000:900000));
const STALL=90000;
const accepted=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const rows=async(h,sql,...params)=>(await h.db.prepare(sql).bind(...params).all()).results;
const count=async(h,table)=>(await h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const expectedSeasonCounts=YEARS.map(year=>({year,events:Array.from({length:EVENT_COUNT},(_,i)=>fixtureEvent(i)).filter(e=>Number(e.start_date.slice(0,4))-(Number(e.start_date.slice(5,7))<6?1:0)===year).length}));

async function snapshot(h){
  const state=await h.db.prepare(`SELECT
    (SELECT COUNT(*) FROM source_events) sourceEvents,
    (SELECT COUNT(*) FROM source_attendance) sourceAttendance,
    (SELECT COUNT(*) FROM team_events) publishedEvents,
    (SELECT COUNT(*) FROM canonical_attendance) publishedAttendance,
    (SELECT COUNT(*) FROM connection_event_resolutions WHERE state='resolved') resolvedEvents,
    (SELECT COUNT(*) FROM team_seasons) seasons,
    (SELECT COUNT(*) FROM team_source_connections WHERE active=1 AND input_revision>reconciled_revision) dirtyRoots,
    (SELECT COUNT(*) FROM team_projection_state WHERE pending=1) pendingSeasons,
    (SELECT COUNT(*) FROM team_read_state WHERE pending=1) pendingTeams,
    (SELECT COUNT(*) FROM sync_jobs WHERE state IN('queued','running','retrying')) pendingJobs,
    (SELECT COUNT(*) FROM team_projection_runs WHERE state='obsolete') abandonedProjections,
    (SELECT COUNT(*) FROM team_projection_runs WHERE state='published') publishedProjectionRuns,
    (SELECT COUNT(*) FROM source_component_coverage WHERE kind IN('events','attendance') AND complete=1) verifiedComponents`).first();
  const jobs=await rows(h,'SELECT provider,component,state,priority,pages_saved,rows_saved,checkpoint,last_error_code,last_error_message FROM sync_jobs ORDER BY provider,component');
  const seasons=await rows(h,'SELECT s.id,s.year,p.pending,p.published_input_revision,(SELECT COUNT(*) FROM team_events e WHERE e.team_season_id=s.id) events,(SELECT COUNT(*) FROM canonical_attendance a WHERE a.team_season_id=s.id) attendance FROM team_seasons s JOIN team_projection_state p ON p.team_season_id=s.id ORDER BY s.year');
  return {...state,jobs,seasonsDetail:seasons};
}

test(PREFIX_ONLY?'bounded '+(BASELINE?'baseline':'candidate')+' prefix at unchanged production alarm and page delays':'721-event ordinary connection completes five seasons at unchanged production alarm and page delays',{timeout:DEADLINE+120000},async()=>{
  const h=await connectionThroughputHarness(),receipt={mode:PREFIX_ONLY?(BASELINE?'bounded_baseline_prefix':'bounded_candidate_prefix'):'complete_candidate',runtime:'native Workerd, D1 and Durable Object alarms',provider:'synthetic TeamSnap only',productionAlarmDelayMs:500,productionPageDelayMs:500,syntheticD1LatencyMs:h.d1LatencyMs,sourceFingerprint:h.sourceFingerprint,packageVersion:h.packageVersion,sourceHashes:h.sourceHashes,events:EVENT_COUNT,playersWithAttendance:PLAYER_COUNT,currentRosterOnlyPlayers:1,attendance:EVENT_COUNT*PLAYER_COUNT,expectedSeasonCounts,manualRunnerRequests:0,manualScheduledRecovery:0,milestones:{},samples:[]};
  let began=0,latest=null;
  const save=async()=>{const file=process.env.MYTS_THROUGHPUT_RECEIPT;if(file){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(receipt,null,2)+'\n');}};
  try{
    await h.initialize();
    const flow=accepted(await h.request('/api/accounts/teamsnap/authorize',{method:'POST',body:{client_id:'synthetic-throughput-client'}}));
    const account=accepted(await h.request('/api/accounts/teamsnap/callback',{method:'POST',body:{state:flow.state,access_token:'synthetic-connection-throughput-token',token_type:'Bearer'}})).account;
    await h.settle({timeout:60000});
    for(const table of ['app_teams','team_seasons','team_source_attachments','source_events'])assert.equal(await count(h,table),0,table+' starts empty after discovery');
    const source=await h.db.prepare("SELECT id FROM source_teams WHERE provider='teamsnap' AND account_id=? AND native_id=?").bind(account.id,String(TEAM_ID)).first();assert.ok(source);
    const command={request_id:crypto.randomUUID(),source_team_id:source.id,account_id:account.id,new_team:{name:'Unaccelerated five-season acceptance',timezone:'UTC',timezone_source:'device',kind:'own'}};
    began=Date.now();receipt.startedAt=new Date(began).toISOString();
    // Replaying an ordinary connection after HTTP response loss cannot mint a
    // second root or season. No database setup bypasses the real route.
    assert.equal((await h.request('/api/connections',{method:'POST',body:command,headers:{'x-fixture-lose-response':'1'}})).status,503);
    const root=accepted(await h.request('/api/connections',{method:'POST',body:command}),202);assert.equal(root.replayed,true);assert.equal(root.season_id,null);
    assert.equal(await count(h,'app_teams'),1);assert.equal(await count(h,'team_source_connections'),1);assert.equal(await count(h,'team_seasons'),0);
    receipt.root={teamId:root.team_id,connectionId:root.connection_id};
    let signature='',advancedAt=began,lastLog=0,firstResolved=null,lastResolved=null;
    for(;;){
      latest=await snapshot(h);const elapsed=Date.now()-began;receipt.elapsedMs=elapsed;receipt.latest=latest;
      const progress=JSON.stringify([latest.sourceEvents,latest.sourceAttendance,latest.publishedEvents,latest.publishedAttendance,latest.resolvedEvents,latest.dirtyRoots,latest.pendingSeasons,latest.jobs.map(j=>[j.provider,j.component,j.checkpoint])]);
      receipt.maxObservedStallMs=Math.max(receipt.maxObservedStallMs||0,Date.now()-advancedAt);
      if(progress!==signature){signature=progress;advancedAt=Date.now();}
      receipt.maxObservedStallMs=Math.max(receipt.maxObservedStallMs||0,Date.now()-advancedAt);
      const mark=(name,condition)=>{if(condition&&receipt.milestones[name]===undefined){receipt.milestones[name]=elapsed;console.log(JSON.stringify({connection_throughput_milestone:name,elapsedMs:elapsed,sourceEvents:latest.sourceEvents,resolvedEvents:latest.resolvedEvents,publishedEvents:latest.publishedEvents,publishedAttendance:latest.publishedAttendance}));}};
      mark('firstSourceEvent',latest.sourceEvents>0);mark('allSourceEvents',latest.sourceEvents===EVENT_COUNT);
      mark('firstResolvedEvent',latest.resolvedEvents>0);mark('allResolvedEvents',latest.resolvedEvents===EVENT_COUNT);
      mark('firstUsefulPublishedSeason',latest.seasonsDetail.some(s=>s.events>0&&s.published_input_revision>=0));
      for(const season of latest.seasonsDetail)mark('publishedSeason'+season.year,season.events>0&&season.published_input_revision>=0);
      mark('firstCompletePublishedSeason',latest.seasonsDetail.some(s=>s.events===expectedSeasonCounts.find(e=>e.year===s.year)?.events));
      mark('firstCompleteRoot',latest.dirtyRoots===0&&latest.resolvedEvents===EVENT_COUNT);
      mark('allPublishedEvents',latest.publishedEvents===EVENT_COUNT&&latest.seasons===YEARS.length);
      mark('allSourceAttendance',latest.sourceAttendance===EVENT_COUNT*PLAYER_COUNT);
      mark('allPublishedAttendance',latest.publishedAttendance===EVENT_COUNT*PLAYER_COUNT);
      mark('allProviderVerification',latest.verifiedComponents===2);
      if(latest.resolvedEvents>0&&!firstResolved)firstResolved={elapsedMs:elapsed,count:latest.resolvedEvents};
      if(latest.resolvedEvents>0)lastResolved={elapsedMs:elapsed,count:latest.resolvedEvents};
      const errors=latest.jobs.filter(j=>['failed','blocked','retrying'].includes(j.state));assert.deepEqual(errors,[],'no source/materializer job fails or enters retry');
      if(elapsed-lastLog>=15000||!lastLog){lastLog=elapsed;const sample={elapsedMs:elapsed,...Object.fromEntries(Object.entries(latest).filter(([k])=>!['jobs','seasonsDetail'].includes(k))),jobs:latest.jobs.map(j=>({component:j.component,state:j.state,pages:j.pages_saved,rows:j.rows_saved,phase:JSON.parse(j.checkpoint||'{}').phase}))};receipt.samples.push(sample);console.log(JSON.stringify({connection_throughput_progress:sample}));await save();}
      assert.ok(Date.now()-advancedAt<STALL,`No committed data/checkpoint progress for ${STALL} ms: ${JSON.stringify(latest)}`);
      assert.ok(elapsed<DEADLINE,`Hard ${DEADLINE} ms acceptance deadline exceeded`);
      if(PREFIX_ONLY&&latest.resolvedEvents>=PREFIX){
        receipt.result='PREFIX_ONLY_NOT_COMPLETE';receipt.prefix={first:firstResolved,last:lastResolved};const events=lastResolved.count-firstResolved.count,ms=lastResolved.elapsedMs-firstResolved.elapsedMs;
        receipt.extrapolation=events>0?{basis:'observed initial materializer prefix; excludes later catch-up passes, attendance, projection and provider verification',millisecondsPerResolvedEvent:ms/events,single721EventPassMs:ms/events*EVENT_COUNT}:null;
        break;
      }
      if(!PREFIX_ONLY&&latest.publishedEvents===EVENT_COUNT&&latest.publishedAttendance===EVENT_COUNT*PLAYER_COUNT&&latest.verifiedComponents===2&&latest.dirtyRoots===0&&latest.pendingSeasons===0&&latest.pendingTeams===0&&latest.pendingJobs===0){receipt.result='PASS';receipt.milestones.allComplete=elapsed;break;}
      await delay(2000);
    }
    await delay(700);receipt.metrics=await h.metrics();receipt.provider=await h.provider();
    // This ordinary read happens only after the timing/stopping milestone, so
    // it cannot help the closed-browser run make progress.
    const bootstrap=accepted(await h.request('/api/bootstrap'));
    receipt.postMeasurementBootstrap={method:'GET /api/bootstrap, no preferred arguments, after measurement stopped',selectedSeason:bootstrap.selected_season,firstTeamSeasons:bootstrap.teams[0]?.seasons,selection:bootstrap.selection,storedNavigation:await h.db.prepare('SELECT season_year,timezone FROM app_teams WHERE id=?').bind(root.team_id).first()};
    assert.equal(bootstrap.selection.team_id,root.team_id);
    assert.equal(bootstrap.selected_season.year,Math.max(...bootstrap.selected_team.seasons.map(s=>s.year)));
    assert.ok(receipt.metrics.maxStatements<=50);assert.ok(receipt.metrics.maxPayloadBytes<=2000000);assert.ok(receipt.metrics.maxCheckpointBytes<=8192);assert.deepEqual(receipt.metrics.violations,[]);assert.deepEqual(receipt.metrics.failures,[]);assert.deepEqual(receipt.metrics.leaseLost,[]);
    if(!PREFIX_ONLY){
      assert.deepEqual(latest.seasonsDetail.map(s=>({year:s.year,events:s.events})),expectedSeasonCounts);
      assert.equal(await count(h,'team_players'),PLAYER_COUNT*YEARS.length,'attendance provides historical season participation; current-roster-only player has no invented historical season');
      assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM source_players').first()).n,PLAYER_COUNT+1);
      assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM team_seasons WHERE include_june<>0').first()).n,0,'June remains excluded from regular statistics by default');
      const native=await rows(h,'SELECT native_id,home_score,away_score,evidence FROM source_events ORDER BY CAST(native_id AS INTEGER)');
      assert.deepEqual(native.map(r=>Number(r.native_id)),Array.from({length:EVENT_COUNT},(_,i)=>910000+i));
      for(const [i,event]of native.entries()){assert.equal(event.home_score,null);assert.equal(event.away_score,null);assert.equal(JSON.parse(event.evidence).notes,fixtureEvent(i).notes);}
      const attendance=await rows(h,'SELECT e.native_id event,p.native_id player,a.status,a.source_status FROM source_attendance a JOIN source_events e ON e.id=a.source_event_id JOIN source_players p ON p.id=a.source_player_id ORDER BY CAST(e.native_id AS INTEGER),CAST(p.native_id AS INTEGER)');
      assert.deepEqual(attendance,Array.from({length:EVENT_COUNT*PLAYER_COUNT},(_,i)=>{const a=fixtureAvailability(i);return {event:String(a.event_id),player:String(a.member_id),status:['No','Yes','Maybe'][a.status_code],source_status:String(a.status_code)};}));
      const canonicalAttendance=await rows(h,'SELECT e.native_id event,p.native_id player,a.status FROM canonical_attendance a JOIN source_events e ON e.id=a.source_event_id JOIN source_players p ON p.id=a.source_player_id ORDER BY CAST(e.native_id AS INTEGER),CAST(p.native_id AS INTEGER)');
      assert.deepEqual(canonicalAttendance,attendance.map(({source_status,...row})=>row),'published attendance retains every exact event/player/status tuple');
      const canonicalEvents=await rows(h,'SELECT source.native_id,s.year,e.local_day FROM team_events e JOIN source_events source ON source.id=e.schedule_source_id JOIN team_seasons s ON s.id=e.team_season_id ORDER BY CAST(source.native_id AS INTEGER)');
      assert.deepEqual(canonicalEvents,Array.from({length:EVENT_COUNT},(_,i)=>({native_id:String(910000+i),year:YEARS[i%YEARS.length],local_day:fixtureEvent(i).start_date.slice(0,10)})),'every published event retains its exact native identity and evidenced season/day');
      const roster=await rows(h,'SELECT s.year,p.name,p.jersey FROM team_players p JOIN team_seasons s ON s.id=p.team_season_id ORDER BY s.year,p.name');
      assert.deepEqual(roster,YEARS.flatMap(year=>Array.from({length:PLAYER_COUNT},(_,i)=>({year,name:'Player '+i,jersey:null}))),'historical participation does not invent historical jersey numbers');
      for(const kind of ['events','attendance']){
        const calls=receipt.provider.calls.filter(c=>c.kind===kind);assert.ok(calls.filter(c=>c.page===1).length>=2,kind+' has two stable full traversals');assert.ok(calls.some(c=>c.page>1));assert.ok(calls.every(c=>c.status===200&&c.bytes<=2000000));
        const coverage=await h.db.prepare('SELECT complete,record_count FROM source_component_coverage WHERE kind=? AND account_id=?').bind(kind,account.id).first();assert.deepEqual(coverage,{complete:1,record_count:kind==='events'?EVENT_COUNT:EVENT_COUNT*PLAYER_COUNT});
      }
      assert.deepEqual(await rows(h,'PRAGMA foreign_key_check'),[]);
    }
    receipt.seasonIds=latest.seasonsDetail.map(s=>({id:s.id,year:s.year,events:s.events,attendance:s.attendance}));receipt.completedAt=new Date().toISOString();await save();console.log(JSON.stringify({connection_throughput_receipt:{...receipt,samples:undefined,provider:{calls:receipt.provider.calls.length},latest:undefined}}));
  }catch(error){receipt.result='FAIL';receipt.error={message:error.message,stack:error.stack};receipt.elapsedMs=began?Date.now()-began:0;try{receipt.latest=await snapshot(h);receipt.metrics=await h.metrics();receipt.provider=await h.provider();}catch(diagnostic){receipt.diagnosticError=String(diagnostic);}await save();console.error(JSON.stringify({connection_throughput_failure:receipt}));throw error;}
  finally{await h.dispose();}
});
