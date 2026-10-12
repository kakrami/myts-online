import assert from 'node:assert/strict';
import {committedProgress,completeScaleProviderGraph} from './lifecycle-progress.mjs';
import {materializationHarness,rankingGame} from './connection-materialization-harness.mjs';
const accepted=(r,status=202)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const query=(team,season,extra={})=>new URLSearchParams({team_id:team,team_season_id:season,...extra});
const rows=async(h,sql,...params)=>(await h.db.prepare(sql).bind(...params).all()).results;
const seasons=(h,team)=>rows(h,'SELECT * FROM team_seasons WHERE app_team_id=? ORDER BY year',team);
const events=(h,team)=>rows(h,'SELECT e.*,s.year FROM team_events e JOIN team_seasons s ON s.id=e.team_season_id WHERE e.app_team_id=? ORDER BY year,e.event_id',team);
async function resolve(h,id){return accepted(await h.request('/api/sources/gotsport/resolve',{method:'POST',body:{url:`https://rankings.gotsport.com/teams/${id}/upcoming-games`}}),200).teams[0].id;}
async function connect(h,id,name,teamId=null){const source=await resolve(h,id);return accepted(await h.request('/api/connections',{method:'POST',body:{request_id:crypto.randomUUID(),source_team_id:source,...(teamId?{team_id:teamId}:{new_team:{name,timezone:'America/Los_Angeles',kind:'own'}})}}));}
async function setScope(h,root,scope){const current=await h.db.prepare('SELECT generation,source_team_id FROM team_source_connections WHERE id=?').bind(root.connection_id).first();return accepted(await h.request('/api/connections',{method:'POST',body:{request_id:crypto.randomUUID(),source_team_id:current.source_team_id,team_id:root.team_id,connection_generation:current.generation,scope}}));}
async function emptyLineup(h,team,season,event){return accepted(await h.request('/api/matches/'+event+'/lineup?'+query(team,season),{method:'PUT',body:{revision:0,format:9,assignments:[]}}),200);}
const headers=(h,team)=>rows(h,'SELECT * FROM analysis_lineup_headers WHERE app_team_id=? ORDER BY team_season_id,event_id',team);
async function identityRevision(h,team,season){return accepted(await h.request('/api/identities?'+query(team,season,{kind:'event'})),200).revision;}
async function correction(h,team,season,event,day){const editor=accepted(await h.request('/api/matches/'+event+'/editor?'+query(team,season)),200);return accepted(await h.request('/api/matches/'+event+'/correction?'+query(team,season),{method:'PUT',body:{revision:editor.revision,fields:{local_day:day}}}));}

// Separate from the original core group so only new acceptance deltas need to
// run during diagnosis. All roots/seasons/attachments still originate in HTTP.
export async function lifecycleScenarios(t,{group='all'}={}){
  assert.ok(['all','scale','scope'].includes(group),'Unknown lifecycle test group');
  let h,account;
  // A failed scale run must never suppress scope/unlink/roster verification.
  // Every registered child owns a fresh installation and native scheduler.
  const nativeTest=(name,run)=>{
    if(group!=='all'&&(name.startsWith('more than 100')?'scale':'scope')!==group)return;
    return t.test(name,async()=>{
    h=await materializationHarness();account=null;
    try{await h.initialize();return await run();}
    catch(error){console.error(JSON.stringify({native_scenario_failure:name,message:error.message,stack:error.stack}));throw error;}
    finally{try{console.log(JSON.stringify({lifecycle_scenario:name,lifecycle_source_fingerprint:h.sourceFingerprint,native_budget_receipt:await h.budgets(),read_only_inspection_retries:h.inspectionRetries}));}finally{await h.dispose();}}
  });};
  async function discoverPrivate(){
    if(!account){const auth=accepted(await h.request('/api/accounts/teamsnap/authorize',{method:'POST',body:{client_id:'synthetic-materialization-client'}}),200);account=accepted(await h.request('/api/accounts/teamsnap/callback',{method:'POST',body:{state:auth.state,access_token:'synthetic-materialization-token',token_type:'Bearer'}}),200).account.id;}
    else await h.poll('teamsnap','catalog');
    await h.settle();
  }
  async function privateConnection(native,name){await discoverPrivate();const source=await h.db.prepare("SELECT id FROM source_teams WHERE provider='teamsnap' AND account_id=? AND native_id=?").bind(account,String(native)).first();return accepted(await h.request('/api/connections',{method:'POST',body:{request_id:crypto.randomUUID(),source_team_id:source.id,account_id:account,new_team:{name,timezone:'America/Los_Angeles',kind:'own'}}}));}
  const privateGame=(id,team)=>({id,team_id:team,is_game:true,name:'Simulated linked game',start_date:'2026-06-01T06:30:00Z',opponent_name:'Simulated opponent',game_type:'home',game_type_code:1});
  await nativeTest('more than 100 dated native memberships remain cursorable and publish before archive completion',async()=>{
      const team=720001,n=101,matches=Array.from({length:n},(_,i)=>rankingGame(830000+i,team,i===100?null:'2026-09-01T18:00:00Z',{event:30000+i,schedule_id:40000+i,bracket_id:50000+i}));
      const metadata=Object.fromEntries(matches.map((game,i)=>[game.event_id,{group:game.schedule_id,bracket:game.bracket_id,start:i===100?'2022-10-01':'2026-09-01',end:i===100?'2022-10-03':'2026-09-03'}]));
      await h.configure(c=>{c.gotsport[team]={matches,events:metadata,holdHistoryPage:2};return c;});
      const connected=await connect(h,team,'Large automatic history');assert.equal(connected.season_id,null);assert.deepEqual(await seasons(h,connected.team_id),[]);
      try{
        // Current-page descendants legitimately outrank the archive continuation.
        // Assert the useful publication boundary itself, without requiring those
        // 200 child jobs to finish before the held page-2 request can begin.
        const firstUseful=await h.waitFor(async()=>{
          const current=(await events(h,connected.team_id)).filter(event=>event.year===2026);
          const history=await h.db.prepare("SELECT state,checkpoint,coverage,pages_saved FROM sync_jobs WHERE provider='gotsport' AND component='history' AND scope=?").bind(String(team)).first(),checkpoint=JSON.parse(history?.checkpoint||'{}');
          if(!(current.length>0&&['queued','running'].includes(history?.state)&&history.pages_saved===1&&checkpoint.page===2&&checkpoint.count===50&&checkpoint.total===n))return null;
          const provider=await h.provider();assert.ok(provider.history_holds.some(hold=>hold.team===String(team)&&hold.page===2),'the configured page-2 hold remains active until publication is proved');
          return {current,history,checkpoint};
        },{timeout:120000});
        assert.equal(firstUseful.history.coverage,'partial');
        assert.equal(firstUseful.current.length,50,'the first complete current page is visible before later history commits');
        console.log(JSON.stringify({first_useful_before_archive_complete:true,visible_games:firstUseful.current.length,history_state:firstUseful.history.state,history_pages_saved:firstUseful.history.pages_saved,history_checkpoint:firstUseful.checkpoint}));
      }finally{await h.configure(c=>{c.gotsport[team].holdHistoryPage=null;return c;});}
      // The previous single 240s cutoff caught an advancing final root cursor
      // after all 407 provider jobs had completed. Keep that collection bound,
      // then allow the normal 120s local drain, never more than 360s total.
      const phaseStarted=Date.now(),hardDeadline=phaseStarted+360000,progress=committedProgress();
      const progressRows=()=>rows(h,'SELECT id,provider,component,scope,state,coverage,pages_saved,generation,checkpoint,last_error_code FROM sync_jobs ORDER BY id');
      let lastProgress;
      await h.waitFor(async()=>{const jobs=await progressRows();lastProgress=progress.observe(jobs);return completeScaleProviderGraph(jobs,{team,count:n});},{timeout:240000});
      const collectedAt=Date.now();assert.ok(collectedAt-phaseStarted<=240000,'Expected provider collection exceeded its 240-second phase bound');
      console.log(JSON.stringify({scale_collection_complete:true,expected_provider_jobs:3+4*n,collection_elapsed_ms:collectedAt-phaseStarted,...lastProgress}));
      await h.waitFor(async()=>{
        const jobs=await progressRows();lastProgress=progress.observe(jobs);
        assert.ok(completeScaleProviderGraph(jobs,{team,count:n}),'The completed provider graph must remain complete during local drain');
        const state=await h.db.prepare("SELECT (SELECT count(*) FROM sync_jobs WHERE state IN('queued','running','retrying') OR (state='ready' AND recurring=1 AND next_at<=strftime('%s','now')*1000+999)) AS jobs,(SELECT count(*) FROM team_read_state WHERE pending=1) AS pending,(SELECT count(*) FROM team_source_connections WHERE active=1 AND input_revision>reconciled_revision) AS roots").first();
        return state.jobs===0&&state.pending===0&&state.roots===0;
      },{timeout:Math.min(120000,hardDeadline-Date.now())});
      assert.ok(Date.now()<=hardDeadline,'Scale collection plus local drain exceeded its 360-second hard bound');
      console.log(JSON.stringify({scale_local_drain_complete:true,collection_elapsed_ms:collectedAt-phaseStarted,drain_elapsed_ms:Date.now()-collectedAt,total_elapsed_ms:Date.now()-phaseStarted,...lastProgress}));
      const linked=await h.db.prepare("SELECT count(*) n FROM source_competition_memberships m JOIN source_divisions d ON d.id=m.source_division_id JOIN source_competitions c ON c.id=d.competition_id WHERE m.source_team_id=? AND c.starts_on IS NOT NULL").bind('gotsport/public/'+team).first();assert.equal(linked.n,n);
      assert.equal((await events(h,connected.team_id)).length,n);
      const oldest=(await events(h,connected.team_id)).find(e=>e.year===2022);assert.ok(oldest,'the 101st competition metadata assigns its own undated game');assert.equal(oldest.starts_at,null);assert.equal(oldest.local_day,null);
      assert.deepEqual((await seasons(h,connected.team_id)).map(s=>s.year),[2022,2026]);
      const sourceCalls=(await h.provider()).calls.filter(c=>c.path===`/api/v1/teams/${team}/matches`);assert.deepEqual(sourceCalls.map(c=>new URLSearchParams(c.search).get('page')),['1','2','3']);
      const jobs=await rows(h,"SELECT provider,component,pages_saved,id FROM sync_jobs"),rootJob=jobs.find(j=>j.provider==='domain'&&j.component==='connection');
      const budget=await h.budgets(),passes=budget.root_passes[rootJob.id]||[],projectionRuns=Object.values(budget.projection_runs),receipt={scale_memberships:n,history_fetches:sourceCalls.length,source_pages:jobs.filter(j=>j.provider==='gotsport').reduce((n,j)=>n+j.pages_saved,0),connection_pages:rootJob.pages_saved,root_passes:passes.length,projection_runs:projectionRuns.length,published_projection_runs:projectionRuns.filter(r=>r.published).length,max_native_statements:budget.max};
      const membershipIds=(await rows(h,'SELECT id FROM source_competition_memberships WHERE source_team_id=? ORDER BY id','gotsport/public/'+team)).map(row=>row.id);assert.deepEqual([...(budget.root_periods[rootJob.id]||[])].sort(),membershipIds,'the native period cursor must actually visit all 101 membership IDs');receipt.visited_period_cursors=membershipIds.length;
      console.log(JSON.stringify(receipt));assert.ok(passes.length>0);assert.ok(rootJob.pages_saved<12*n+100,'coalesced reconciliation stays linear for 101 memberships');assert.ok(projectionRuns.length<=24,'source pages cannot trigger an entire projection per imported game');assert.ok(budget.max<=50);assert.deepEqual(budget.violations,[]);

      // Twice edit a game after its canonical ID has already passed the active
      // reconciliation cursor. The saved pass must finish and catch up again,
      // rather than restarting on every input revision or losing that edit.
      const early=(await events(h,connected.team_id)).filter(e=>e.year===2026).sort((a,b)=>a.event_id.localeCompare(b.event_id))[0];
      const manualRequests=[];
      async function correctBehindCursor(day){await correction(h,connected.team_id,early.team_season_id,early.event_id,day);const job=await h.db.prepare("SELECT args FROM sync_jobs WHERE provider='domain' AND component='projection' AND scope=? AND resource_key=?").bind(connected.team_id,early.team_season_id).first();manualRequests.push(JSON.parse(job.args).requestId);}
      await correctBehindCursor('2026-09-02');
      let lastPass=-1;
      for(const day of ['2026-09-03','2026-09-04']){
        const observed=await h.waitFor(async()=>{const job=await h.db.prepare('SELECT checkpoint FROM sync_jobs WHERE id=?').bind(rootJob.id).first(),cp=JSON.parse(job.checkpoint);return cp.phase==='events'&&cp.after>early.event_id&&cp.passRevision!==lastPass?cp:null;});lastPass=observed.passRevision;
        await correctBehindCursor(day);
      }
      await h.settle({timeout:240000});
      const changed=(await events(h,connected.team_id)).find(e=>e.event_id===early.event_id);assert.equal(changed.local_day,'2026-09-04');
      const finalBudget=await h.budgets(),finalJob=await h.db.prepare('SELECT pages_saved FROM sync_jobs WHERE id=?').bind(rootJob.id).first(),catchupPages=finalJob.pages_saved-rootJob.pages_saved,catchupPasses=(finalBudget.root_passes[rootJob.id]||[]).length-passes.length,catchupRuns=Object.keys(finalBudget.projection_runs).length-projectionRuns.length;
      const newRuns=Object.entries(finalBudget.projection_runs).filter(([id])=>!budget.projection_runs[id]).map(([,run])=>run),manualRuns=newRuns.filter(run=>manualRequests.includes(run.request_id)),automaticRuns=newRuns.filter(run=>!manualRequests.includes(run.request_id)),affectedSeasons=(await seasons(h,connected.team_id)).length;
      console.log(JSON.stringify({behind_cursor_changes:2,owner_corrections:manualRequests.length,catchup_pages:catchupPages,catchup_passes:catchupPasses,catchup_projection_runs:catchupRuns,published_runs:newRuns.filter(r=>r.published).length,superseded_runs:newRuns.filter(r=>!r.published).length,manual_request_runs:manualRuns.length,automatic_final_runs:automaticRuns.length,affected_seasons:affectedSeasons}));assert.ok(catchupPasses>=3&&catchupPasses<=4,'two behind-cursor writes require bounded catch-up passes');assert.ok(catchupPages<=12*n+100);
      // One explicit publication per owner command plus one final automatic
      // publication per affected season. This is independent of row/page count.
      assert.ok(catchupRuns<=manualRequests.length+affectedSeasons);assert.ok(manualRuns.length<=manualRequests.length);assert.ok(automaticRuns.length<=affectedSeasons);

    });

    await nativeTest('unlinking a date-supplying canonical peer reconciles both the new and old event groups',async()=>{
      await h.configure(c=>{c.teamsnap.teams.push({id:321,name:'Private canonical peer',time_zone:'America/Los_Angeles'});c.teamsnap.events.push(privateGame(840001,321));c.gotsport[720003]={matches:[rankingGame(840002,720003,'2026-06-01T06:30:00Z',{event:60002})]};return c;});
      const first=await privateConnection(321,'Canonical date peers');await h.settle();await connect(h,720003,null,first.team_id);await h.settle();
      const oldSeason=(await seasons(h,first.team_id))[0].id,sources=(await rows(h,"SELECT id,native_id FROM source_events WHERE native_id IN('840001','840002') ORDER BY native_id"));assert.equal(sources.length,2);
      const linked=accepted(await h.request('/api/identities/link',{method:'POST',body:{team_id:first.team_id,team_season_id:oldSeason,kind:'event',source_ids:sources.map(s=>s.id),revision:await identityRevision(h,first.team_id,oldSeason),confirmation:'same_game'}}));await h.settle();
      const canonical=(await events(h,first.team_id))[0].event_id;assert.equal((await events(h,first.team_id)).length,1);await emptyLineup(h,first.team_id,oldSeason,canonical);const before=(await headers(h,first.team_id))[0];
      await h.configure(c=>{c.gotsport[720003].matches[0].matchTime='2026-06-01T07:30:00Z';return c;});await h.poll('gotsport','history',{scope:'720003'});await h.settle();
      const conflict=await h.db.prepare('SELECT state,effective_day FROM team_event_season_resolutions WHERE app_team_id=? AND event_id=?').bind(first.team_id,canonical).first();assert.deepEqual(conflict,{state:'conflict',effective_day:'2026-05-31'});
      const callsBefore=(await h.provider()).calls.length;
      accepted(await h.request('/api/identities/unlink',{method:'POST',body:{team_id:first.team_id,team_season_id:oldSeason,kind:'event',source_id:sources[0].id,revision:await identityRevision(h,first.team_id,oldSeason)}}));await h.settle();
      const projected=await events(h,first.team_id),moved=projected.find(e=>e.event_id===canonical),split=projected.find(e=>e.event_id!==canonical);assert.equal(projected.length,2);assert.equal(moved.year,2026);assert.equal(moved.local_day,'2026-06-01');assert.equal(split.year,2025);assert.equal(split.local_day,'2026-05-31');
      assert.deepEqual(await headers(h,first.team_id),[{...before,team_season_id:moved.team_season_id,revision:before.revision+1}]);assert.equal((await h.provider()).calls.length,callsBefore,'identity reconciliation reuses saved observations without collection');
      assert.ok(linked.queued);

      // Repeat the authority removal through the connection lifecycle itself:
      // retiring root A must dirty root B's existing canonical resolution.
      await h.configure(c=>{c.teamsnap.teams.push({id:323,name:'Private root unlink peer',time_zone:'America/Los_Angeles'});c.teamsnap.events.push(privateGame(840005,323));c.gotsport[720006]={matches:[rankingGame(840006,720006,'2026-06-01T06:30:00Z',{event:60006})]};return c;});
      const rootA=await privateConnection(323,'Root unlink date peers');await h.settle();await connect(h,720006,null,rootA.team_id);await h.settle();const old=(await events(h,rootA.team_id))[0],pair=await rows(h,"SELECT id FROM source_events WHERE native_id IN('840005','840006') ORDER BY native_id");
      accepted(await h.request('/api/identities/link',{method:'POST',body:{team_id:rootA.team_id,team_season_id:old.team_season_id,kind:'event',source_ids:pair.map(s=>s.id),revision:await identityRevision(h,rootA.team_id,old.team_season_id),confirmation:'same_game'}}));await h.settle();const shared=(await events(h,rootA.team_id))[0];await emptyLineup(h,rootA.team_id,shared.team_season_id,shared.event_id);const kept=(await headers(h,rootA.team_id))[0];
      await h.configure(c=>{c.gotsport[720006].matches[0].matchTime='2026-06-01T07:30:00Z';return c;});await h.poll('gotsport','history',{scope:'720006'});await h.settle();assert.equal((await h.db.prepare('SELECT state FROM team_event_season_resolutions WHERE app_team_id=? AND event_id=?').bind(rootA.team_id,shared.event_id).first()).state,'conflict');
      const beforeUnlinkCalls=(await h.provider()).calls.length;accepted(await h.request('/api/connections/'+rootA.connection_id,{method:'DELETE',body:{team_id:rootA.team_id,generation:rootA.connection.generation}}),200);await h.settle();const remaining=(await events(h,rootA.team_id))[0];assert.equal((await events(h,rootA.team_id)).length,1);assert.equal(remaining.event_id,shared.event_id);assert.equal(remaining.year,2026);assert.equal(remaining.local_day,'2026-06-01');assert.equal((await h.db.prepare('SELECT state FROM team_event_season_resolutions WHERE app_team_id=? AND event_id=?').bind(rootA.team_id,shared.event_id).first()).state,'resolved');assert.deepEqual(await headers(h,rootA.team_id),[{...kept,team_season_id:remaining.team_season_id,revision:kept.revision+1}]);assert.equal((await h.provider()).calls.length,beforeUnlinkCalls);
    });

    await nativeTest('a fixed-only owner date conflict remains visible until explicit scope widening applies it once',async()=>{
      await h.configure(c=>{c.gotsport[720004]={matches:[rankingGame(850001,720004,'2026-06-01T06:30:00Z',{event:61001})]};return c;});const root=await connect(h,720004,'Fixed scope correction');await h.settle();
      const old=(await events(h,root.team_id))[0];await setScope(h,root,{mode:'fixed_seasons',season_ids:[old.team_season_id]});await h.settle();await emptyLineup(h,root.team_id,old.team_season_id,old.event_id);const before=(await headers(h,root.team_id))[0];
      await correction(h,root.team_id,old.team_season_id,old.event_id,'2026-06-01');await h.settle();assert.equal((await seasons(h,root.team_id)).length,1);
      const conflict=await h.db.prepare('SELECT team_season_id,state,effective_day,evidence FROM team_event_season_resolutions WHERE app_team_id=? AND event_id=?').bind(root.team_id,old.event_id).first();assert.equal(conflict.team_season_id,old.team_season_id);assert.equal(conflict.state,'conflict');assert.equal(conflict.effective_day,'2026-05-31');assert.ok(JSON.parse(conflict.evidence).some(e=>e.reason==='season_scope_conflict'));assert.deepEqual(await headers(h,root.team_id),[before]);
      await setScope(h,root,{mode:'observed_history'});await h.settle();const moved=(await events(h,root.team_id)).find(e=>e.event_id===old.event_id);assert.equal(moved.year,2026);assert.equal(moved.local_day,'2026-06-01');const after=[{...before,team_season_id:moved.team_season_id,revision:before.revision+1}];assert.deepEqual(await headers(h,root.team_id),after);
      const rebound=await rows(h,"SELECT j.component,s.generation,c.generation current_generation FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id JOIN team_source_connections c ON s.demand_key='connection:'||c.id WHERE c.id=? AND j.provider='gotsport' ORDER BY j.component",root.connection_id);assert.ok(rebound.some(row=>row.component==='history'));assert.ok(rebound.every(row=>row.generation===row.current_generation),'scope widening must rebind saved descendant demand: '+JSON.stringify(rebound));
      const beforePoll=(await h.provider()).calls.filter(c=>c.path==='/api/v1/teams/720004/matches').length;await h.poll('gotsport','history',{scope:'720004'});await h.settle();assert.equal((await h.provider()).calls.filter(c=>c.path==='/api/v1/teams/720004/matches').length,beforePoll+1);assert.deepEqual(await headers(h,root.team_id),after);
    });
    await nativeTest('corrected qualified roster periods retain uncertain history without projecting stale membership',async()=>{
      await h.configure(c=>{c.teamsnap.teams.push({id:322,name:'Qualified historical roster',time_zone:'America/Los_Angeles'});c.teamsnap.members.push({id:501,team_id:322,is_player:true,first_name:'Original',last_name:'Snapshot',jersey_number:'11',roster_start_date:'2024-07-01',roster_end_date:'2025-05-31'});return c;});
      const root=await privateConnection(322,'Qualified roster team');assert.equal(root.season_id,null);await h.settle();
      const original=await h.db.prepare("SELECT r.*,s.year FROM connection_roster_evidence r JOIN team_seasons s ON s.id=r.team_season_id WHERE r.connection_id=? AND r.basis='dated_roster'").bind(root.connection_id).first();assert.equal(original.year,2024);assert.equal(original.certainty,'verified');assert.equal(original.name,'Original Snapshot');assert.equal(original.jersey,'11');assert.equal((await rows(h,'SELECT * FROM team_players WHERE app_team_id=?',root.team_id)).length,1);
      await h.configure(c=>{c.teamsnap.members[0].roster_start_date='2025-07-01';c.teamsnap.members[0].roster_end_date='2026-05-31';c.teamsnap.members[0].first_name='New current';c.teamsnap.members[0].jersey_number='99';return c;});await h.poll('teamsnap','roster');await h.settle();
      const saved=await rows(h,"SELECT r.*,s.year FROM connection_roster_evidence r JOIN team_seasons s ON s.id=r.team_season_id WHERE r.connection_id=? AND r.basis='dated_roster' ORDER BY s.year",root.connection_id);assert.equal(saved.length,2);assert.deepEqual(saved[0],{...original,certainty:'preserved_uncertain'});assert.equal(saved[1].year,2025);assert.equal(saved[1].certainty,'verified');assert.equal(saved[1].name,'New current Snapshot');assert.equal(saved[1].jersey,'99');
      assert.deepEqual(await rows(h,'SELECT p.name,p.jersey,s.year FROM team_players p JOIN team_seasons s ON s.id=p.team_season_id WHERE p.app_team_id=? ORDER BY s.year',root.team_id),[{name:'New current Snapshot',jersey:'99',year:2025}]);
      let review=accepted(await h.request('/api/status?team_id='+root.team_id),200).data.roster_review;assert.equal(review.total,1);assert.equal(review.items[0].name,'Original Snapshot');assert.equal(Object.hasOwn(review.items[0],'jersey'),false);
      // Inactive today does not disprove an unchanged qualified past period.
      await h.configure(c=>{c.teamsnap.members[0].is_active=false;return c;});await h.poll('teamsnap','roster');await h.settle();assert.equal((await rows(h,"SELECT * FROM connection_roster_evidence WHERE connection_id=? AND certainty='verified'",root.connection_id)).length,1);
      // An evidence-only period withdrawal must dirty the root even while the
      // current source roster membership remains unchanged and inactive.
      await h.configure(c=>{delete c.teamsnap.members[0].roster_start_date;delete c.teamsnap.members[0].roster_end_date;c.teamsnap.members[0].first_name='Unqualified current';c.teamsnap.members[0].jersey_number='88';return c;});await h.poll('teamsnap','roster');await h.settle();
      const withdrawn=await rows(h,"SELECT r.*,s.year FROM connection_roster_evidence r JOIN team_seasons s ON s.id=r.team_season_id WHERE r.connection_id=? AND r.basis='dated_roster' ORDER BY s.year",root.connection_id);assert.deepEqual(withdrawn,saved.map(row=>({...row,certainty:'preserved_uncertain'})));assert.deepEqual(await rows(h,'SELECT * FROM team_players WHERE app_team_id=?',root.team_id),[]);
      review=accepted(await h.request('/api/status?team_id='+root.team_id),200).data.roster_review;assert.equal(review.total,1);assert.ok(['Original Snapshot','New current Snapshot'].includes(review.items[0].name));
    });
}
