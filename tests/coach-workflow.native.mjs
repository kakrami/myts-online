import test from 'node:test';
import assert from 'node:assert/strict';
import {materializationHarness} from './fixtures/connection-materialization-harness.mjs';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
const scope={team_id:'team',team_season_id:'season',event_id:'event'};
test('native actual Coach routes restore original configuration, slots, tactics and halftime corrections within HTTP budgets',async()=>{
 const h=await materializationHarness(),f=analysisFixture({players:11});
 try{await h.initialize();
  // Synthetic canonical published team/roster, not a provider-collection claim.
  const order=['provider_accounts','app_teams','team_read_state','team_seasons','team_projection_runs','team_projection_state','source_teams','team_source_attachments','team_source_connections','team_connection_seasons','events','source_events','source_event_teams','event_source_links','team_event_season_resolutions','team_event_rows','players','source_players','player_source_links','team_player_rows','source_trace_components','source_component_coverage','source_game_members','source_tracking_segments'];
  for(const table of order){const rows=f.all('SELECT * FROM '+table);for(let start=0;start<rows.length;start+=24)await h.db.batch(rows.slice(start,start+24).map(row=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row))));}
  const budgets=[];let s;const request=async(path,options)=>{const r=await h.request(path,options);assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.statements<=48,JSON.stringify(r));budgets.push({path,statements:r.statements});return r.data;};
  const command=async action=>{const r=await request('/api/coach',{method:'POST',body:{...scope,revision:s?.revision??0,action}});if(r.session)s=r.session;return r;};
  await command({type:'create',format:9,half_minutes:25});const ids=s.roster.map(p=>p.id);
  await command({type:'lineup',field:Object.fromEntries(['GK','LCB','RCB','LCM','RCM','ST:L','ST','ST:R','SS'].map((position,i)=>[position,ids[i]]))});await command({type:'configure',format:9,half_minutes:90});assert.equal(s.half_minutes,90);assert.equal(new Set(['ST:L','ST','ST:R'].map(k=>s.field[k])).size,3);
  const query='/api/coach?'+new URLSearchParams(scope),saved=(await request(query)).session;assert.deepEqual(saved.field,s.field);assert.equal(saved.half_minutes,90);
  const proposal=(await command({type:'suggest'})).suggestion;assert.deepEqual(Object.keys(proposal.field).sort(),['GK','LB','CB','RB','LCM','CM','RCM','RW','ST'].sort());await command({type:'lineup',field:proposal.field});
  const bench=ids.filter(p=>!Object.values(s.field).includes(p));await request('/api/coach/profiles',{method:'PUT',body:{...scope,player_id:bench[0],revision:0,value:{positions:{GK:5,LCB:4,SS:3},endurance:4,target_minutes:0}}});
  await command({type:'start'});let read=await request(query);assert.ok(read.recommendations.length>0&&read.recommendations.length<=3);assert.equal(read.recommendations[0].in.id,bench[0]);const revision=s.revision;read=await request(query);assert.equal(read.session.revision,revision);assert.equal((await h.db.prepare('SELECT revision FROM coach_sessions').first()).revision,revision);
  await command({type:'substitute',out:read.recommendations[0].out.id,in:read.recommendations[0].in.id});assert.equal(s.field.GK,bench[0]);await command({type:'pause'});await command({type:'correct',elapsed_ms:10*60000});await command({type:'halftime'});const oldCapacity=s.minutes_total_ms;
  await command({type:'correct_sub',out:bench[0],in:bench[1],delta:2*60000});assert.equal(s.field.GK,bench[1]);assert.equal(s.minutes_ms[bench[1]],2*60000);assert.equal(s.minutes_total_ms,oldCapacity);assert.equal(s.minutes_recorded_total_ms,oldCapacity);
  await command({type:'next_half'});assert.equal(s.period,2);assert.ok(s.period_elapsed_ms<1000);await command({type:'pause'});await command({type:'correct',elapsed_ms:50*60000});await command({type:'finish'});assert.equal(s.minutes_total_ms,450*60000);assert.equal(s.minutes_recorded_total_ms,450*60000);assert.deepEqual((await request(query)).session.field,s.field);
  const stale=await h.request('/api/coach',{method:'POST',body:{...scope,revision:0,action:{type:'configure',format:7,half_minutes:25}}});assert.equal(stale.status,409);assert.equal((await h.db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
  console.log(JSON.stringify({coach_native_original_workflow:{source_fingerprint:h.sourceFingerprint,synthetic_canonical_roster:true,source_oracle_suite:'tests/coach-original-parity.test.mjs',browser_suite:'tests/coach-workflow-ui.test.mjs',max_http_statements:Math.max(...budgets.map(r=>r.statements)),request_budgets:budgets,half_limit:90,distinct_striker_slots:3,format:9,final_player_minutes:450,clock_elapsed:'explicit owner corrections',read_clock_writes:0,late_substitution_interval_preserved:true}}));
 }finally{f.close();await h.dispose();}
});
