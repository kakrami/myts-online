import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {AnalysisReads,playerSeasonQuery} from '../src/analysis/reads.js';
import {CoachingService} from '../src/coaching/service.js';
import {FeatureReads} from '../src/read-model/feature-reads.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {SECURITY_SCHEMA} from '../src/security/schema.js';
import {ReportingService} from '../src/reporting/service.js';
import {traceFixture} from '../src/sources/trace.js';
import {analysisCoverageSQL,acceptedAnalysisPublicationSQL} from '../src/analysis/eligibility.js';
import {overview as overviewScreen,schedule as scheduleScreen} from '../web/ui-original/screens.js';
import {createOriginalAnalyzedOracle as original,originalAnalyzedProvenance,originalAnalyzedSource} from './parity/original-analyzed-eligibility-fixtures.mjs';
const AT=Date.parse('2026-10-12T12:00:00Z');
const selection={team_id:'team',team_season_id:'season',from:'2026-06-01',to:'2027-06-01',timezone:'UTC',mode:'season',type:'all',period:'all',search:'',include_june:false};
async function current(options={}){
 const {status='UNKNOWN',date='2026-09-01',includeJune=false,excluded=false,missing=false,partial=false,unpublished=false,verifiedScore=false,players=1,firstRejected=false,rejectedAfter=false,removeHeader=false,noHeader=false,manualOnly=false,revoke=false,detachedAnalysis=false}=options;
 const f=analysisFixture({players,proof:true});
 try{
  for(const sql of [...TEAM_FEATURE_SCHEMA,...SECURITY_SCHEMA])f.sqlite.exec(sql);
  f.sqlite.prepare('UPDATE source_events SET status=?,local_day=?,home_score=NULL,away_score=NULL').run(status,date);
  f.sqlite.prepare('UPDATE team_event_rows SET status=?,local_day=?,goals_for=NULL,goals_against=NULL,home_score=NULL,away_score=NULL').run(status,date);
  f.sqlite.prepare('UPDATE team_event_season_resolutions SET effective_day=?').run(date);
  f.sqlite.exec('UPDATE team_projection_state SET input_revision=1,published_input_revision=1,pending=0');
  f.sqlite.prepare('UPDATE team_seasons SET include_june=?').run(includeJune?1:0);
  if(verifiedScore)f.sqlite.exec('UPDATE team_event_rows SET home_score=2,away_score=1,goals_for=2,goals_against=1');
  if(players)f.override('player-000',{minutes:firstRejected?80:40,started:true});
  if(noHeader)f.sqlite.exec("DELETE FROM source_trace_components WHERE kind='header'");
  if(partial)f.sqlite.exec("UPDATE source_component_coverage SET complete=0 WHERE kind='game'");
  if(!missing)f.commit(await f.page());
  if(rejectedAfter){f.sqlite.exec("UPDATE analysis_overrides SET fields='{\"minutes\":80,\"started\":true}'");f.commit(await f.page());}
  if(removeHeader)f.sqlite.exec("DELETE FROM source_trace_components WHERE kind='header'");
  if(manualOnly)f.sqlite.exec("UPDATE match_analysis SET source_event_id=NULL,source_team_id=NULL,state='ready',evidence='{}'");
  if(revoke)f.sqlite.exec("UPDATE team_source_connections SET active=0");
  if(detachedAnalysis)f.sqlite.exec("UPDATE match_analysis SET source_event_id='retired-source'");
  if(excluded)f.insert('season_inclusion_rules',{team_season_id:'season',kind:'event',resource_key:'event',included:0});
  if(unpublished)f.sqlite.exec("UPDATE team_projection_state SET published_run_id=NULL,published_input_revision=-1,pending=1");
  const input={...selection,include_june:includeJune};
  const reads=new AnalysisReads(f.db,{owner:true},{now:()=>AT});
  const feature=new FeatureReads(f.db,{owner:true},{analysisReads:reads,now:()=>AT});
  const reports=new ReportingService(f.db,{now:()=>AT});
  const q=playerSeasonQuery(input,{now:AT});
  const rows=f.sqlite.prepare(q.sql).all(...q.params);
  const overview=await feature.overview(input);
  const team=await reads.team(input);
  const coach=await new CoachingService(f.db,{owner:true},{now:()=>AT}).roleHints(input);
  const schedule=await feature.schedule({...input,type:'analyzed',period:'upcoming'});
  const calendar=await feature.calendar({...input,type:'analyzed'},{from:date,to:date.slice(0,8)+(Number(date.slice(8))+1).toString().padStart(2,'0')});
  let player=null;if(!unpublished&&players)player=await reads.player(input,'player-000');
  const reportRows={};for(const type of ['season','players','matches']){const query=await reports.query(type,input);reportRows[type]=f.sqlite.prepare(query.sql).all(...query.params);}
  const analyzedMatches=await reports.query('matches',{...input,type:'analyzed'});const analyzedReport=f.sqlite.prepare(analyzedMatches.sql).all(...analyzedMatches.params);
  return {coach,analyzed_report_count:analyzedReport.length,schedule:{total:schedule.data.total,ids:schedule.data.items.map(e=>e.id),period:schedule.selection.period},calendar:calendar.data.days,source:f.all('SELECT status,home_score,away_score FROM source_events')[0],published_event:f.all('SELECT status,home_score,away_score FROM team_event_rows')[0],publication:f.all('SELECT published_run_id,published_input_revision,pending FROM team_projection_state')[0],analysis:f.all('SELECT state,player_count,evidence FROM match_analysis'),facts:f.all('SELECT appearance,started,minutes,goals,assists,minutes_state,goals_state,assists_state FROM effective_player_matches'),season:rows.map(({apps,starts,minutes,goals,assists,selected_matches,analyzed_matches})=>({apps,starts,minutes,goals,assists,selected_matches,analyzed_matches})),team_totals:team.data.totals,overview:{analyzed_count:overview.data.analyzed_count,analyzed_note:overview.data.analyzed_note,leaders:overview.data.leaders,record:overview.data.record},player:player?{stats:player.data.stats,matches:player.data.matches.total}:null,reports:reportRows};
 }finally{f.close();}
}
const metric=(r,label)=>r.reports.season.find(row=>row.metric===label);
test('analysis status selector has no result, time or readiness predicate; original source is pinned',()=>{
 assert.equal(originalAnalyzedProvenance.version,'6.20.133');assert.equal(originalAnalyzedProvenance.commit,'50e1be224806ff7e7c439d26e15fd0421e3f6f01');
 for(const [name,source]of Object.entries(originalAnalyzedSource))assert.equal(source.length,originalAnalyzedProvenance.functions[name].length);
 assert.match(analysisCoverageSQL(),/status IN\('FINAL','COMPLETED'\) OR EXISTS/);assert.doesNotMatch(analysisCoverageSQL(),/ready|estimated|starts_at|local_day/);assert.throws(()=>analysisCoverageSQL('e;DROP'));assert.throws(()=>acceptedAnalysisPublicationSQL('a;DROP'));
 const fixture=traceFixture({game_id:'20',full_date:'2026-09-01T12:00:00Z',home_team:{team_id:'10',score:null},away_team:{team_id:'11',score:null}},'10','account');
 assert.equal(fixture.status,'UNKNOWN');assert.equal(fixture.home_score,null);assert.equal(fixture.away_score,null);
});

test('published UNKNOWN facts reach Team, player, Overview and Reports without a fabricated result',async()=>{
 const o=original(),c=await current();
 assert.equal(c.publication.pending,0);assert.equal(c.publication.published_run_id,'team-run');assert.equal(c.analysis[0].state,'ready');
 assert.equal(c.facts[0].appearance,1);assert.equal(c.facts[0].started,1);assert.equal(c.facts[0].minutes,40);assert.deepEqual(c.coach['player-000'].recent_trace_minutes,[40]);assert.equal(c.coach['player-000'].resolved_position,'GK');
 assert.equal(o.team.apps,1);assert.equal(o.team.starts,1);assert.equal(o.team.minutes,40);
 for(const row of [c.season[0],c.team_totals,c.player.stats,c.reports.players[0]]){assert.equal(row.apps,o.team.apps);assert.equal(row.starts,o.team.starts);assert.equal(row.minutes,o.team.minutes);}
 assert.equal(c.schedule.total,1);assert.equal(c.schedule.period,'all');assert.deepEqual(c.schedule.ids,['event']);assert.equal(c.calendar[0].total,1);assert.equal(c.player.matches,o.upstream_rows);assert.equal(c.overview.analyzed_count,o.analyzed_count);assert.equal(c.overview.leaders[0].minutes,40);
 assert.equal(metric(c,'Matches analyzed').value,1);assert.equal(metric(c,'Minutes leader').value,'player-000');
 assert.equal(c.overview.record.games,0);assert.equal(metric(c,'Record').value,'—');assert.equal(metric(c,'Goals').value,'—');assert.equal(metric(c,'Record')._report_note,null);
 assert.equal(c.reports.matches[0].status,'Result pending');assert.equal(c.reports.matches[0].score,null);assert.equal(c.reports.matches[0].result,null);
 assert.deepEqual(c.source,{status:'UNKNOWN',home_score:null,away_score:null});assert.deepEqual(c.published_event,c.source);
});

test('original cancellation and Included Games exclusions survive, without a new future/postponed cutoff',async t=>{
 const cases={cancelled:{status:'CANCELLED',count:0},postponed:{status:'POSTPONED',count:1},future_confirmed:{status:'SCHEDULED',date:'2026-12-01',count:1},june_excluded:{date:'2026-06-15',count:0},june_included:{date:'2026-06-15',includeJune:true,count:1},individual_excluded:{excluded:true,count:0}};
 for(const [name,{count,...options}]of Object.entries(cases))await t.test(name,async()=>{
  const o=original(options),c=await current(options);assert.equal(o.team.apps,count);assert.equal(o.analyzed_count,count);
  assert.deepEqual(c.coach['player-000'].recent_trace_minutes,count?[40]:[]);assert.equal(c.coach['player-000'].resolved_position,count?'GK':null);assert.equal(c.season[0].selected_matches,count);assert.equal(c.season[0].apps,count?1:null);assert.equal(c.season[0].minutes,count?40:null);assert.equal(c.player.matches,count);
  assert.equal(c.schedule.total,count);assert.equal(c.analyzed_report_count,c.reports.matches.length,'Schedule Report preserves all-season scope regardless of an incoming analyzed filter');assert.equal(c.calendar.reduce((n,d)=>n+d.total,0),count);assert.equal(c.overview.analyzed_count,count);assert.equal(metric(c,'Matches analyzed').value,count);assert.equal(c.reports.players[0].minutes,count?40:null);
  assert.equal(c.overview.record.games,0);assert.equal(metric(c,'Record').value,'—');assert.equal(metric(c,'Record')._report_note,null);
  assert.equal(c.source.status,options.status||'UNKNOWN');assert.equal(c.source.home_score,null);assert.equal(c.source.away_score,null);
 });
});

test('coverage population includes missing/partial games without manufacturing their quantities or readiness',async t=>{
 for(const [name,options]of Object.entries({unknown_missing:{missing:true},future_missing:{missing:true,status:'SCHEDULED',date:'2026-12-01'},final_missing:{missing:true,status:'FINAL'},unknown_partial:{partial:true},final_partial:{partial:true,status:'FINAL'}}))await t.test(name,async()=>{
  const o=original(options),c=await current(options),row=c.season[0];
  assert.equal(row.selected_matches,options.missing&&options.status!=='FINAL'?0:1,'completed coverage is preserved; other games require an accepted player row');
  assert.equal(row.apps,options.missing?null:1);assert.equal(row.minutes,options.missing?null:40);assert.equal(row.goals,null);assert.equal(row.assists,null);
  assert.equal(c.overview.analyzed_count,options.partial?1:0);assert.equal(c.schedule.total,c.overview.analyzed_count);assert.equal(metric(c,'Matches analyzed').value,c.overview.analyzed_count);assert.match(metric(c,'Matches analyzed')._report_note,/incomplete or unavailable/);
  assert.equal(c.reports.players[0].minutes,options.missing?null:40);assert.equal(c.reports.players[0].goals,null);assert.equal(c.reports.players[0].assists,null);
  assert.equal(c.overview.record.games,0);assert.equal(metric(c,'Record').value,'—');
  if(options.partial){assert.equal(o.team.minutes,40);assert.equal(c.analysis[0].state,'incomplete');assert.equal(metric(c,'Minutes leader').value,'player-000');}
  else {assert.equal(o.team.games,0,'original games counts retained Trace rows; it is not the newer coverage denominator');assert.equal(row.analyzed_matches,0);}
 });
});

test('FINAL status alone never supplies scores; independently verified result still counts',async()=>{
 const c=await current({status:'FINAL'});assert.equal(c.season[0].apps,1);assert.equal(c.season[0].minutes,40);assert.equal(c.overview.record.games,0);assert.equal(metric(c,'Record').value,'—');assert.equal(c.reports.matches[0].result,null);
 const scored=await current({status:'FINAL',verifiedScore:true});assert.equal(scored.overview.record.games,1);assert.equal(scored.overview.record.wins,1);assert.equal(metric(scored,'Record').value,'1-0-0');assert.equal(metric(scored,'Goals').value,'2-1');assert.equal(scored.reports.matches[0].result,'W');
});

test('not-yet-published projection remains distinct from a published UNKNOWN game',async()=>{
 const c=await current({unpublished:true});assert.equal(c.publication.pending,1);assert.equal(c.publication.published_run_id,null);assert.equal(c.analysis[0].state,'ready');assert.equal(c.facts[0].minutes,40);assert.equal(c.season.length,0);assert.equal(c.overview.analyzed_count,0);assert.equal(metric(c,'Matches analyzed').value,0);
});

test('count and linked Analyzed list follow accepted publication, not header discovery or player count',async t=>{
 const cases={header_only:{missing:true,count:0},no_header_pending:{noHeader:true,count:0},first_rejected:{firstRejected:true,count:0},accepted_partial:{partial:true,count:1},zero_player_partial:{players:0,partial:true,count:1},retained_partial_rejected:{partial:true,rejectedAfter:true,count:1},accepted_header_removed:{partial:true,removeHeader:true,count:1},existing_manual:{manualOnly:true,count:1},revoked_membership:{revoke:true,count:0},retired_analysis_source:{detachedAnalysis:true,count:0}};
 for(const [name,{count,...options}]of Object.entries(cases))await t.test(name,async()=>{
  const c=await current(options);assert.equal(c.overview.analyzed_count,count);assert.equal(c.schedule.total,count);assert.equal(c.analyzed_report_count,c.reports.matches.length,'Schedule Report preserves all-season scope regardless of an incoming analyzed filter');assert.equal(metric(c,'Matches analyzed').value,count);assert.equal(c.calendar.reduce((n,d)=>n+d.total,0),count);
  if(options.firstRejected){assert.equal(c.analysis[0].state,'human_review');assert.equal(JSON.parse(c.analysis[0].evidence).analysis.publishable,false);assert.equal(c.facts.length,0);}
  if(options.noHeader){assert.equal(c.analysis[0].state,'pending');assert.equal(JSON.parse(c.analysis[0].evidence).source_provenance.header,null);}
  if(options.rejectedAfter){assert.equal(c.analysis[0].state,'human_review');assert.equal(JSON.parse(c.analysis[0].evidence).accepted_state,'incomplete');assert.equal(c.season[0].minutes,40);}
  if(options.players===0){assert.equal(c.analysis[0].player_count,0);assert.equal(c.analysis[0].state,'incomplete');assert.equal(c.facts.length,0);}
  assert.equal(c.overview.record.games,0);assert.equal(metric(c,'Record').value,'—');
 });
});

test('Overview and Analyzed Schedule qualify the count as saved, possibly incomplete data',()=>{
 assert.match(overviewScreen({analyzed_count:1,analyzed_note:'Saved analyzed games; some quantities may be incomplete or unavailable.'}),/Saved analyzed games; some quantities may be incomplete or unavailable/);
 assert.match(scheduleScreen({mode:'season',filter:'analyzed',season_label:'2026/27',events:{items:[]}}),/Saved analyses; some data may be incomplete/);
});

// The public create path already enforces this scope. Enforce it at the query
// boundary as well so no internal caller can retain misleading UI filters.
test('all four report queries normalize transient Schedule filters to the all-season report contract',async()=>{
 const service=new ReportingService({}, {now:()=>AT}),filtered={...selection,mode:'day',date:'2026-12-01',type:'analyzed',period:'upcoming',search:'missing',sort:'minutes',direction:'desc'};
 for(const type of ['season','matches','players','availability'])assert.deepEqual(await service.query(type,filtered),await service.query(type,selection));
 assert.equal(filtered.type,'analyzed','normalizing the report must not mutate the caller selection');
});
