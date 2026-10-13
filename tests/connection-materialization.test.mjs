import test from 'node:test';
import assert from 'node:assert/strict';
import {materializationHarness,rankingGame,teamSnapGame} from './fixtures/connection-materialization-harness.mjs';

const accepted=(result,status=202)=>{assert.equal(result.status,status,JSON.stringify(result.data));return result.data;};
const q=(team,season,extra={})=>new URLSearchParams({team_id:team,team_season_id:season,mode:'season',period:'all',...extra});
const rows=async(h,sql,...params)=>(await h.db.prepare(sql).bind(...params).all()).results;
const seasons=(h,team)=>rows(h,'SELECT * FROM team_seasons WHERE app_team_id=? ORDER BY year',team);
const events=(h,team)=>rows(h,'SELECT e.*,s.year FROM team_events e JOIN team_seasons s ON s.id=e.team_season_id WHERE e.app_team_id=? ORDER BY year,e.event_id',team);
async function resolve(h,id){return accepted(await h.request('/api/sources/gotsport/resolve',{method:'POST',body:{url:`https://rankings.gotsport.com/teams/${id}/upcoming-games`}}),200).teams[0].id;}
const newBody=(source,name)=>({request_id:crypto.randomUUID(),source_team_id:source,new_team:{name,timezone:'America/Los_Angeles',kind:'own'}});
const historyCalls=async(h,id)=>(await h.provider()).calls.filter(c=>c.path===`/api/v1/teams/${id}/matches`).length;

async function savedHistoryReuse(h,pub,publicBody){
      const originalGames=await events(h,pub.team_id),ownerGame=originalGames.find(game=>game.local_day)||originalGames[0];assert.ok(ownerGame);
      accepted(await h.request('/api/matches/'+ownerGame.event_id+'/lineup?'+q(pub.team_id,ownerGame.team_season_id),{method:'PUT',body:{revision:0,format:9,assignments:[]}}),200);await h.settle();
      const ownerState=await rows(h,'SELECT * FROM analysis_lineup_headers WHERE app_team_id=?',pub.team_id);assert.equal(ownerState.length,1);
      await h.configure(c=>{c.gotsport[710002]={matches:[]};return c;});
      const target=accepted(await h.request('/api/connections',{method:'POST',body:newBody(await resolve(h,710002),'Saved history destination')}));await h.settle();assert.equal((await seasons(h,target.team_id)).length,0);
      const before=await historyCalls(h,710001);
      const added=accepted(await h.request('/api/connections',{method:'POST',body:{request_id:crypto.randomUUID(),source_team_id:publicBody.source_team_id,team_id:target.team_id}}));assert.equal(added.team_id,target.team_id);await h.settle();
      assert.equal(await historyCalls(h,710001),before);assert.deepEqual((await seasons(h,target.team_id)).map(s=>s.year),(await seasons(h,pub.team_id)).map(s=>s.year));
      assert.equal((await events(h,target.team_id)).length,(await events(h,pub.team_id)).length);
      // Saved-source reuse also carries ongoing demand. Once the old root is
      // removed, the new root must continue polling without refetching profile
      // history merely to reconstruct its already-proven descendant graph.
      const providerCallsBeforeUnlink=(await h.provider()).calls.length;
      accepted(await h.request('/api/connections/'+pub.connection_id,{method:'DELETE',body:{team_id:pub.team_id,generation:pub.connection.generation}}),200);await h.settle();
      assert.deepEqual(await events(h,pub.team_id),[]);
      // This public fixture has no roster; this only rejects invented players.
      // Nonempty historical roster removal is covered by the private scenarios.
      assert.deepEqual(await rows(h,'SELECT * FROM team_players WHERE app_team_id=?',pub.team_id),[]);
      assert.deepEqual(await rows(h,'SELECT * FROM analysis_lineup_headers WHERE app_team_id=?',pub.team_id),ownerState,'unlink removes published provider evidence while preserving saved owner state');
      assert.equal((await h.provider()).calls.length,providerCallsBeforeUnlink,'last-root cleanup uses saved state and does not refetch providers');
      const inherited=await rows(h,"SELECT j.component,s.generation,c.generation current_generation FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id JOIN team_source_connections c ON s.demand_key='connection:'||c.id WHERE c.id=? AND j.provider='gotsport' ORDER BY j.component",added.connection_id);assert.ok(inherited.some(row=>row.component==='history'),'a new root inherits the already-proven saved source graph');assert.ok(inherited.every(row=>row.generation===row.current_generation));
      await h.configure(c=>{c.gotsport[710001].matches.push(rankingGame(810088,710001,'2028-07-01T18:00:00Z',{event:188}));return c;});await h.poll('gotsport','history',{scope:'710001'});await h.settle();assert.equal(await historyCalls(h,710001),before+1);assert.ok((await seasons(h,target.team_id)).some(s=>s.year===2028),'the reused root admits a later season after the old root is gone');
      const budget=await h.budgets();assert.ok(budget.max<=50);assert.deepEqual(budget.violations,[]);
}

// This suite is intentionally one native runtime, with no pre-created seasons,
// seasonal attachments, inline projection or direct materializer invocation.
// Provider contracts and interval advancement are simulated. It does not prove
// real provider authorization, current external contracts or production status.
test('native connection import derives and maintains seasons without an open browser',async t=>{
  const h=await materializationHarness();let pub,publicBody,privateRoot,privateTeam,accountId;
  let sharedRuntimeFailure=null;
  const nativeTest=(name,run)=>t.test(name,async context=>{if(sharedRuntimeFailure){context.skip('Shared native runtime already failed: '+sharedRuntimeFailure);return;}try{return await run();}catch(error){console.error(JSON.stringify({native_scenario_failure:name,message:error.message,stack:error.stack}));if(/^Native (materialization did not settle|job failed|runtime failed)/.test(error.message))sharedRuntimeFailure=name;throw error;}});
  try{
    await h.initialize();
    if(process.env.MYTS_MATERIALIZATION_REUSE_ONLY==='1'){
      await h.configure(c=>{c.gotsport[710001]={matches:[rankingGame(810201,710001,'2024-07-01T18:00:00Z',{event:201}),rankingGame(810202,710001,'2026-07-01T18:00:00Z',{event:202})]};return c;});
      publicBody=newBody(await resolve(h,710001),'Original saved-history root');pub=accepted(await h.request('/api/connections',{method:'POST',body:publicBody}));await h.settle();
      await nativeTest('a new root reuses saved provider history without refetching it',()=>savedHistoryReuse(h,pub,publicBody));return;
    }
    await nativeTest('yearless HTTP selection starts at zero seasons and empty history never invents a year',async()=>{
      await h.configure(c=>({...c,gotsport:{710001:{matches:[]}}}));
      const source=await resolve(h,710001);publicBody=newBody(source,'Automatic public team');
      pub=accepted(await h.request('/api/connections',{method:'POST',body:publicBody}));
      assert.equal(pub.season_id,null);assert.equal(pub.connection.scope_mode,'observed_history');
      assert.equal((await seasons(h,pub.team_id)).length,0);
      assert.equal((await rows(h,'SELECT * FROM team_source_attachments WHERE app_team_id=?',pub.team_id)).length,0);
      await h.settle();
      assert.equal((await seasons(h,pub.team_id)).length,0);
      assert.equal((await h.db.prepare('SELECT season_year FROM app_teams WHERE id=?').bind(pub.team_id).first()).season_year,0);
      assert.equal((await h.db.prepare('SELECT active FROM team_source_connections WHERE id=?').bind(pub.connection_id).first()).active,1);
      assert.ok(await historyCalls(h,710001)>0,'actual provider history collector ran');
    });

    await nativeTest('an undated source game stays pending without using today, labels or collection time',async()=>{
      await h.configure(c=>{c.gotsport[710001].matches=[rankingGame(810001,710001)];return c;});
      await h.poll('gotsport','history',{scope:'710001'});await h.settle();
      const pending=await h.db.prepare('SELECT state,team_season_id,effective_day,basis FROM connection_event_resolutions WHERE connection_id=?').bind(pub.connection_id).first();
      assert.deepEqual(pending,{state:'pending',team_season_id:null,effective_day:null,basis:'date_unknown'});
      assert.equal((await seasons(h,pub.team_id)).length,0);assert.equal((await events(h,pub.team_id)).length,0);
      const status=accepted(await h.request('/api/status?team_id='+pub.team_id),200);assert.equal(status.data.season_resolution.state,'pending');assert.equal(status.data.evidence.pending_events,1);
    });

    await nativeTest('multi-year native imports use actual local May 31/June 1 and keep June visible but excluded',async()=>{
      await h.configure(c=>{c.gotsport[710001].matches.push(
        rankingGame(810002,710001,'2024-07-01T18:00:00Z'),
        rankingGame(810003,710001,'2026-06-01T06:30:00Z'),
        rankingGame(810004,710001,'2026-06-01T07:30:00Z'),
        rankingGame(810005,710001,'2026-07-01T18:00:00Z'),
        rankingGame(810006,710001,null,{event:111})
      );return c;});
      await h.poll('gotsport','history',{scope:'710001'});await h.settle();
      const years=await seasons(h,pub.team_id);assert.deepEqual(years.map(s=>s.year),[2024,2025,2026]);
      for(const s of years){assert.equal(s.start_day,`${s.year}-06-01`);assert.equal(s.end_day,`${s.year+1}-06-01`);assert.equal(s.start_at,`${s.year}-06-01T07:00:00.000Z`);assert.equal(s.include_june,0);}
      const assigned=await rows(h,'SELECT e.native_id,r.effective_day,s.year FROM connection_event_resolutions r JOIN source_events e ON e.id=r.source_event_id LEFT JOIN team_seasons s ON s.id=r.team_season_id WHERE r.connection_id=? ORDER BY e.native_id',pub.connection_id);
      assert.deepEqual(assigned.filter(r=>['810003','810004'].includes(r.native_id)),[{native_id:'810003',effective_day:'2026-05-31',year:2025},{native_id:'810004',effective_day:'2026-06-01',year:2026}]);
      const season=years.find(s=>s.year===2026).id,query=q(pub.team_id,season),schedule=accepted(await h.request('/api/schedule?'+query),200);
      assert.equal(schedule.data.total,2);assert.ok(schedule.data.items.some(e=>e.local_day==='2026-06-01'));
      assert.equal(accepted(await h.request('/api/overview?'+query),200).data.record.games,1,'July is regular season; June remains visible preseason');
    });

    await nativeTest('late exact dated metadata assigns an undated game without inventing a kickoff',async()=>{
      // Same already-saved game; only competition metadata is newly published.
      await h.configure(c=>{c.gotsport[710001].events={110:{start:'2023-10-01',end:'2023-10-03'}};return c;});
      await h.poll('gotsport','event');await h.settle();
      const resolved=await h.db.prepare("SELECT r.state,r.effective_day,r.basis,s.year FROM connection_event_resolutions r JOIN source_events e ON e.id=r.source_event_id LEFT JOIN team_seasons s ON s.id=r.team_season_id WHERE r.connection_id=? AND e.native_id='810001'").bind(pub.connection_id).first();
      assert.deepEqual(resolved,{state:'resolved',effective_day:null,basis:'dated_metadata',year:2023});
      const projected=(await events(h,pub.team_id)).find(e=>e.year===2023);assert.ok(projected);assert.equal(projected.starts_at,null);assert.equal(projected.local_day,null);
      const unrelated=await h.db.prepare("SELECT r.state,r.team_season_id FROM connection_event_resolutions r JOIN source_events e ON e.id=r.source_event_id WHERE r.connection_id=? AND e.native_id='810006'").bind(pub.connection_id).first();assert.deepEqual(unrelated,{state:'pending',team_season_id:null},'another competition’s dates cannot assign this undated game');
    });

    await nativeTest('lost HTTP response replays one immutable root and never adds another team or season',async()=>{
      const body={...publicBody,request_id:crypto.randomUUID()},before=await h.db.prepare('SELECT (SELECT count(*) FROM app_teams) teams,(SELECT count(*) FROM team_seasons) seasons,(SELECT count(*) FROM team_source_connections) roots').first();
      const lost=await h.request('/api/connections',{method:'POST',body,headers:{'x-fixture-lose-response':'1'}});assert.equal(lost.status,503);
      const recovered=accepted(await h.request('/api/connections',{method:'POST',body}));assert.equal(recovered.replayed,true);assert.equal(recovered.team_id,pub.team_id);assert.equal(recovered.connection_id,pub.connection_id);
      assert.deepEqual(await h.db.prepare('SELECT (SELECT count(*) FROM app_teams) teams,(SELECT count(*) FROM team_seasons) seasons,(SELECT count(*) FROM team_source_connections) roots').first(),before);
      await h.settle();
    });

    await nativeTest('native account discovery plus yearless private connection does not leak current roster into history',async()=>{
      await h.configure(c=>{c.teamsnap={teams:[{id:321,name:'Synthetic private team',season_name:'2031 (unverified label)',time_zone:'America/Los_Angeles'}],members:[{id:501,team_id:321,is_player:true,first_name:'Historical',last_name:'Participant',jersey_number:'11'},{id:502,team_id:321,is_player:true,first_name:'Current',last_name:'Only',jersey_number:'99'}],events:[teamSnapGame(910001,'2025-06-01T06:30:00Z'),teamSnapGame(910002,'2026-09-01T18:00:00Z')],attendance:[{id:601,event_id:910001,member_id:501,team_id:321,status_code:1}]};return c;});
      const auth=accepted(await h.request('/api/accounts/teamsnap/authorize',{method:'POST',body:{client_id:'synthetic-materialization-client'}}),200);
      accountId=accepted(await h.request('/api/accounts/teamsnap/callback',{method:'POST',body:{state:auth.state,access_token:'synthetic-materialization-token',token_type:'Bearer'}}),200).account.id;
      await h.settle();const source=await h.db.prepare("SELECT id FROM source_teams WHERE provider='teamsnap' AND account_id=? AND native_id='321'").bind(accountId).first();assert.ok(source);
      privateRoot=accepted(await h.request('/api/connections',{method:'POST',body:{...newBody(source.id,'Automatic private team'),new_team:{name:'Automatic private team',timezone:'UTC',timezone_source:'device',kind:'own'},account_id:accountId}}));privateTeam=privateRoot.team_id;
      assert.equal((await h.db.prepare('SELECT timezone FROM app_teams WHERE id=?').bind(privateTeam).first()).timezone,'America/Los_Angeles','verified native team timezone supersedes a UTC device hint');
      assert.equal(privateRoot.season_id,null);assert.equal((await seasons(h,privateTeam)).length,0);await h.settle();
      assert.deepEqual((await seasons(h,privateTeam)).map(s=>s.year),[2024,2026]);
      const roster=await rows(h,'SELECT p.name,p.jersey,s.year FROM team_players p JOIN team_seasons s ON s.id=p.team_season_id WHERE p.app_team_id=?',privateTeam);
      assert.deepEqual(roster,[{name:'Historical Participant',jersey:null,year:2024}]);
      assert.equal((await rows(h,"SELECT * FROM connection_roster_evidence WHERE connection_id=? AND basis='attendance'",privateRoot.connection_id)).length,1);
      const status=accepted(await h.request('/api/status?team_id='+privateTeam),200);assert.equal(status.data.pending_roster.total,1);assert.equal(status.data.pending_roster.items[0].name,'Current Only');
    });

    await nativeTest('a later current-roster edit does not rewrite historical name, jersey or participation',async()=>{
      const before=await rows(h,'SELECT team_season_id,player_id,name,jersey FROM team_players WHERE app_team_id=? ORDER BY team_season_id,player_id',privateTeam);
      await h.configure(c=>{c.teamsnap.members[0].first_name='Renamed current';c.teamsnap.members[0].jersey_number='88';return c;});
      await h.poll('teamsnap','roster');await h.settle();
      assert.deepEqual(await rows(h,'SELECT team_season_id,player_id,name,jersey FROM team_players WHERE app_team_id=? ORDER BY team_season_id,player_id',privateTeam),before);
    });

    await nativeTest('a later source poll creates a new season and projection without an application request',async()=>{
      const lastAppRequestAt=Date.now();
      await h.configure(c=>{c.teamsnap.events.push(teamSnapGame(910003,'2027-07-01T18:00:00Z'));return c;});
      await h.poll('teamsnap','events');await h.settle();
      assert.deepEqual((await seasons(h,privateTeam)).map(s=>s.year),[2024,2026,2027]);
      const added=(await events(h,privateTeam)).find(e=>e.year===2027);assert.ok(added);
      const completed=await h.db.prepare("SELECT last_complete_at FROM sync_jobs WHERE provider='domain' AND component='projection' AND resource_key=?").bind(added.team_season_id).first();assert.ok(completed.last_complete_at>=lastAppRequestAt);
      assert.equal((await rows(h,'SELECT * FROM team_source_connections WHERE app_team_id=?',privateTeam)).length,1);
    });

    await nativeTest('provider kickoff correction across June 1 moves existing Coach and lineup state once',async()=>{
      const old=(await events(h,privateTeam)).find(e=>e.year===2024),player=(await rows(h,'SELECT player_id FROM team_players WHERE app_team_id=? AND team_season_id=?',privateTeam,old.team_season_id))[0].player_id;
      const scope={team_id:privateTeam,team_season_id:old.team_season_id,event_id:old.event_id},query=q(privateTeam,old.team_season_id);
      const created=accepted(await h.request('/api/coach',{method:'POST',body:{...scope,revision:0,action:{type:'create',format:9,half_minutes:25}}}),200);
      accepted(await h.request('/api/matches/'+old.event_id+'/lineup?'+query,{method:'PUT',body:{revision:0,format:9,assignments:[{half:1,player_id:player,slot_kind:'field',slot:1,position:'GK'}]}}),200);
      accepted(await h.request('/api/bookmarks/'+old.event_id+'?'+query,{method:'PUT',body:{saved:true}}),200);
      const beforeCoach=await h.db.prepare('SELECT * FROM coach_sessions WHERE app_team_id=? AND event_id=?').bind(privateTeam,old.event_id).first(),beforeLineup=await rows(h,'SELECT * FROM analysis_lineup_assignments WHERE app_team_id=? AND event_id=?',privateTeam,old.event_id),beforeBookmark=await rows(h,'SELECT * FROM game_bookmarks WHERE app_team_id=?',privateTeam);
      const beforeRoster=await rows(h,'SELECT player_id,name,jersey FROM team_players WHERE app_team_id=? AND team_season_id=?',privateTeam,old.team_season_id);
      assert.equal(created.session.revision,beforeCoach.revision);
      await h.clearBudgetWindow();
      await h.configure(c=>{c.teamsnap.events[0].start_date='2025-06-01T07:30:00Z';return c;});await h.poll('teamsnap','events');await h.settle();
      const budget=await h.budgets();assert.ok(budget.window['domain/connection']?.count>0);assert.ok(budget.window['domain/connection'].max<=50);assert.deepEqual(budget.violations,[]);
      const moved=(await events(h,privateTeam)).find(e=>e.event_id===old.event_id);assert.equal(moved.year,2025);assert.equal(moved.local_day,'2025-06-01');
      const afterCoach=await rows(h,'SELECT * FROM coach_sessions WHERE app_team_id=? AND event_id=?',privateTeam,old.event_id);assert.deepEqual(afterCoach,[{...beforeCoach,team_season_id:moved.team_season_id,revision:beforeCoach.revision+1}]);
      assert.deepEqual(await rows(h,'SELECT * FROM analysis_lineup_assignments WHERE app_team_id=? AND event_id=?',privateTeam,old.event_id),beforeLineup.map(r=>({...r,team_season_id:moved.team_season_id})));
      assert.deepEqual(await rows(h,'SELECT * FROM game_bookmarks WHERE app_team_id=?',privateTeam),beforeBookmark);
      assert.deepEqual(await rows(h,'SELECT player_id,name,jersey FROM team_players WHERE app_team_id=? AND team_season_id=?',privateTeam,moved.team_season_id),beforeRoster,'a date move preserves historical participation names instead of replacing them with current roster labels');
      const stale=await h.request('/api/coach',{method:'POST',body:{...scope,revision:beforeCoach.revision,action:{type:'create'}}});assert.equal(stale.status,404);
      await h.poll('teamsnap','events');await h.settle();assert.deepEqual(await rows(h,'SELECT * FROM coach_sessions WHERE app_team_id=? AND event_id=?',privateTeam,old.event_id),afterCoach,'unchanged poll cannot relocate twice');
    });

    await nativeTest('a new root reuses saved provider history without refetching it',()=>savedHistoryReuse(h,pub,publicBody));

    await nativeTest('unlink while a real source request is held fences its stale result and cannot recreate seasons',async()=>{
      await h.configure(c=>{c.gotsport[710003]={matches:[]};return c;});
      const body=newBody(await resolve(h,710003),'Removed in-flight connection'),connected=accepted(await h.request('/api/connections',{method:'POST',body}));await h.settle();
      await h.configure(c=>{c.gotsport[710003]={matches:[rankingGame(810099,710003,'2029-07-01T18:00:00Z',{event:199})],holdHistory:true};return c;});await h.poll('gotsport','history',{scope:'710003'});
      await h.waitFor(async()=>((await h.provider()).held?.team==='710003'),{timeout:10000});
      accepted(await h.request('/api/connections/'+connected.connection_id,{method:'DELETE',body:{team_id:connected.team_id,generation:connected.connection.generation}}),200);
      await h.configure(c=>{c.gotsport[710003].holdHistory=false;return c;});
      await h.waitFor(async()=>!((await h.provider()).held),{errors:false});
      await h.waitFor(async()=>!(await h.db.prepare("SELECT 1 FROM sync_jobs WHERE provider='gotsport' AND scope='710003' AND state='running'").first()),{errors:false});
      assert.equal((await seasons(h,connected.team_id)).length,0);
      assert.equal(await h.db.prepare("SELECT 1 FROM source_events WHERE provider='gotsport' AND native_id='810099'").first(),null,'the retired source lease cannot commit its captured page');
      assert.equal((await rows(h,'SELECT * FROM team_source_attachments WHERE app_team_id=? AND active=1',connected.team_id)).length,0);
      assert.equal((await h.request('/api/connections',{method:'POST',body})).status,409);
      assert.equal((await h.db.prepare('SELECT active FROM team_source_connections WHERE id=?').bind(connected.connection_id).first()).active,0);
      assert.deepEqual((await h.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    });
    await nativeTest('a fixed root cannot inherit an excluded old season when an owner-state collision blocks a move',async()=>{
      const shared=rankingGame(820001,710004,'2026-06-01T06:30:00Z',{event:210,awayTeam:{team_id:710005,full_name:'Other native source'},away_team_reg_id:711005});
      await h.configure(c=>{c.gotsport[710004]={matches:[shared,rankingGame(820002,710004,'2026-07-01T18:00:00Z',{event:211})]};c.gotsport[710005]={matches:[shared]};return c;});
      const ownerRoot=accepted(await h.request('/api/connections',{method:'POST',body:newBody(await resolve(h,710004),'Collision review team')}));await h.settle();
      const available=await seasons(h,ownerRoot.team_id),oldSeason=available.find(s=>s.year===2025).id,newSeason=available.find(s=>s.year===2026).id;
      const fixedRoot=accepted(await h.request('/api/connections',{method:'POST',body:{request_id:crypto.randomUUID(),source_team_id:await resolve(h,710005),team_id:ownerRoot.team_id,scope:{mode:'fixed_seasons',season_ids:[newSeason]}}}));await h.settle();
      const old=await h.db.prepare("SELECT e.event_id FROM team_events e JOIN source_events s ON s.id=e.schedule_source_id WHERE e.app_team_id=? AND s.native_id='820001'").bind(ownerRoot.team_id).first();assert.ok(old);
      accepted(await h.request('/api/matches/'+old.event_id+'/lineup?'+q(ownerRoot.team_id,oldSeason),{method:'PUT',body:{revision:0,format:9,assignments:[]}}),200);
      // Deliberate legacy-collision fault only: seasons, roots, games and the
      // original lineup state all came through ordinary source/API workflows.
      const collision={...await h.db.prepare('SELECT * FROM analysis_lineup_headers WHERE app_team_id=? AND event_id=?').bind(ownerRoot.team_id,old.event_id).first(),team_season_id:newSeason};
      await h.db.prepare('INSERT INTO analysis_lineup_headers('+Object.keys(collision).join(',')+') VALUES('+Object.keys(collision).map(()=>'?').join(',')+')').bind(...Object.values(collision)).run();
      const before=await rows(h,'SELECT * FROM analysis_lineup_headers WHERE app_team_id=? ORDER BY team_season_id',ownerRoot.team_id);
      await h.configure(c=>{c.gotsport[710004].matches[0].matchTime='2026-06-01T07:30:00Z';c.gotsport[710005].matches[0].matchTime='2026-06-01T07:30:00Z';return c;});await h.poll('gotsport','history',{scope:'710004'});await h.settle();
      assert.deepEqual(await rows(h,'SELECT * FROM analysis_lineup_headers WHERE app_team_id=? ORDER BY team_season_id',ownerRoot.team_id),before);
      const canonical=await h.db.prepare('SELECT team_season_id,state,effective_day FROM team_event_season_resolutions WHERE app_team_id=? AND event_id=?').bind(ownerRoot.team_id,old.event_id).first();assert.deepEqual(canonical,{team_season_id:oldSeason,state:'conflict',effective_day:'2026-05-31'});
      const restricted=await h.db.prepare("SELECT r.team_season_id,r.state FROM connection_event_resolutions r JOIN source_events s ON s.id=r.source_event_id WHERE r.connection_id=? AND s.native_id='820001'").bind(fixedRoot.connection_id).first();assert.ok(restricted);assert.equal(restricted.team_season_id,null);assert.ok(['conflict','excluded'].includes(restricted.state));
      assert.equal(await h.db.prepare('SELECT 1 FROM team_connection_seasons WHERE connection_id=? AND team_season_id=? AND active=1 AND excluded=0').bind(fixedRoot.connection_id,oldSeason).first(),null);
      assert.equal((await h.db.prepare('SELECT scope_mode FROM team_source_connections WHERE id=?').bind(fixedRoot.connection_id).first()).scope_mode,'fixed_seasons');
    });

    await nativeTest('disconnect blocks provider collection while owner date corrections still reconcile saved history',async()=>{
      const old=(await events(h,privateTeam)).find(e=>e.local_day==='2025-06-01');assert.ok(old);
      const beforeCoach=await h.db.prepare('SELECT * FROM coach_sessions WHERE app_team_id=? AND event_id=?').bind(privateTeam,old.event_id).first();assert.ok(beforeCoach);
      accepted(await h.request('/api/accounts/'+accountId,{method:'DELETE',body:{}}),200);
      const callsBefore=(await h.provider()).calls.filter(c=>c.path.startsWith('/v3/')).length;
      const query=q(privateTeam,old.team_season_id),editor=accepted(await h.request('/api/matches/'+old.event_id+'/editor?'+query),200);
      accepted(await h.request('/api/matches/'+old.event_id+'/correction?'+query,{method:'PUT',body:{revision:editor.revision,fields:{local_day:'2025-05-31'}}}));
      await h.waitFor(async()=>{const state=await h.db.prepare('SELECT pending FROM team_read_state WHERE app_team_id=?').bind(privateTeam).first(),root=await h.db.prepare('SELECT input_revision,reconciled_revision FROM team_source_connections WHERE id=?').bind(privateRoot.connection_id).first();return state.pending===0&&root.input_revision===root.reconciled_revision;},{errors:false});
      const corrected=(await events(h,privateTeam)).find(e=>e.event_id===old.event_id);assert.equal(corrected.year,2024);assert.equal(corrected.local_day,'2025-05-31');assert.equal(corrected.starts_at,null);
      assert.equal((await h.provider()).calls.filter(c=>c.path.startsWith('/v3/')).length,callsBefore,'no private source request is admitted after account disconnect');
      assert.deepEqual(await rows(h,'SELECT * FROM coach_sessions WHERE app_team_id=? AND event_id=?',privateTeam,old.event_id),[{...beforeCoach,team_season_id:corrected.team_season_id,revision:beforeCoach.revision+1}]);
      assert.equal((await h.db.prepare('SELECT active FROM provider_accounts WHERE id=?').bind(accountId).first()).active,0);
    });
    const budget=await h.budgets();assert.ok(budget.count>0);assert.ok(budget.max<=50);assert.deepEqual(budget.violations,[]);
    console.log(JSON.stringify({native_connection_materialization:true,max_native_statements:budget.max,connection_page_max:budget.groups['domain/connection']?.max,native_alarms:true,browser_open:false,direct_materializer_calls:0,seeded_seasons:0,seeded_attachments:0,providers:'simulated GotSport and TeamSnap',test_clock:'1ms successful alarm/page delays; due intervals plus production scheduled event'}));
  } finally {try{console.log(JSON.stringify({production_source_fingerprint:h.sourceFingerprint,native_budget_receipt:await h.budgets(),read_only_inspection_retries:h.inspectionRetries}));}finally{await h.dispose();}}
});

// The focused lifecycle delta is separately selectable during integration.
import {lifecycleScenarios} from './fixtures/connection-materialization-lifecycle.mjs';
test('native lifecycle scale acceptance',t=>lifecycleScenarios(t,{group:'scale'}));
test('native lifecycle scope and historical evidence acceptance',t=>lifecycleScenarios(t,{group:'scope'}));
