import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './team-game-installation-harness.mjs';

test('native current epoch keeps actual Live deployment page and terminal continuation inside 50 SQL statements',async()=>{
 const h=await harness();try{
  let setup;for(let i=0;i<50;i++){setup=(await h.call({op:'fresh'})).result;if(!setup.continue)break;}assert.equal(setup.continue,false);
  const now=new Date().toISOString(),rows=[
   ['app_teams',{id:'team',name:'Team',timezone:'America/Los_Angeles',season_year:2026,created_at:now}],
   ['team_read_state',{app_team_id:'team'}],
   ['team_seasons',{id:'season',app_team_id:'team',year:2026,start_day:'2026-06-01',end_day:'2027-06-01',start_at:'2026-06-01T07:00:00Z',end_at:'2027-06-01T07:00:00Z'}],
   ['team_projection_state',{team_season_id:'season',app_team_id:'team',pending:0}],
   ['source_teams',{id:'live/public/700',provider:'live',scope:'public',native_id:'700',name:'Team',name_authority:0,archived:0,evidence:'{}',content_hash:'seed',observed_at:now}],
   ['team_source_connections',{id:'root',app_team_id:'team',source_team_id:'live/public/700',scope_mode:'observed_history',created_at:now}],
   ['team_source_attachments',{id:'attached',app_team_id:'team',team_season_id:'season',source_team_id:'live/public/700'}],
  ];
  await h.call({op:'current',statements:rows.map(([table,row])=>({sql:`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`,params:Object.values(row)}))});
  const jobId=(await h.call({op:'enqueueLive'})).result;
  const collect=async()=>{await h.call({op:'current',statements:[{sql:'UPDATE sync_jobs SET next_at=CASE WHEN id=? THEN 0 ELSE ? END',params:[jobId,Date.now()+86400000]}]});return h.call({op:'collectLive',jobId});};
  const first=await collect();assert.equal(first.used,50);assert.equal(first.result.saved.committed,true);assert.equal(first.result.saved.state,'queued');assert.equal(first.result.childCount,4);
  for(const [table,n]of [['source_events',2],['source_event_teams',3],['source_competitions',1],['source_divisions',1]])assert.deepEqual(await h.query('SELECT count(*) AS n FROM '+table),[{n}]);
  const last=await collect();assert.equal(last.used,25);assert.equal(last.result.saved.committed,true);assert.equal(last.result.saved.state,'ready');assert.equal(last.result.complete,true);
  assert.deepEqual(await h.query('SELECT pages_saved FROM sync_jobs WHERE id=?',[jobId]),[{pages_saved:2}]);assert.deepEqual(await h.query('SELECT count(*) AS n FROM source_events'),[{n:2}]);
  for(const table of ['installation_upgrade','installation_team_games_upgrade'])assert.deepEqual(await h.query('SELECT writer_mode,writer_epoch,permit_guard FROM '+table),[{writer_mode:null,writer_epoch:null,permit_guard:null}]);
  assert.deepEqual(await h.query('PRAGMA foreign_key_check'),[]);
  console.log(JSON.stringify({native_live_upcoming:first.used,native_live_terminal:last.used,first_rows_written:first.rowsWritten,terminal_rows_written:last.rowsWritten}));
 }finally{await h.dispose();}
});
