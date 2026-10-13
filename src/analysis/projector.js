import {publishedGameScopeCTE,resolvePublishedGame,gameScopeFenceSQL,gameOwnerStateFenceSQL,captureGameOwnerState} from '../domain/team-game-scope.js';
import {savedAnalysisContextsQuery} from './source-scope.js';
import {ownerFormat} from './manual-format.js';
import {matchHighlights} from './match-highlights.js';
import { PLAYER_MAP,mapParams } from './native-facts.js';
import {resolveSnapshot,ANALYSIS_ALGORITHM_VERSION} from './resolver-adapter.js';
const parse=v=>typeof v==='string'?JSON.parse(v||'{}'):v||{};
const problem=(message,code='analysis_contract',status=409)=>Object.assign(new Error(message),{code,status});
const need=(v,m,c)=>{if(!v)throw problem(m,c);return v;};
const round=v=>Math.round(v*1000)/1000;
const stamp=()=>new Date().toISOString();
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const safeJson=v=>{const s=JSON.stringify(v);need(new TextEncoder().encode(s).length<=16000,'Analysis evidence exceeded its bound.');return s;};
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');
// This semantic signature is evaluated again inside the lease transaction.
// The separate published-game fence also binds the run and current authority.
const SCOPED_INPUT_SQL=`WITH scope(team,season,event,state_event) AS(VALUES(?,?,?,?)),
 analysis_selection AS(SELECT team AS app_team_id,season AS team_season_id FROM scope),${publishedGameScopeCTE('analysis_selection','analysis_game')},
 native AS(SELECT e.id,e.content_hash,e.provenance,l.revision,s.input_revision,m.original_event_id,m.association_id,m.own_proof_hash,m.source_hash,m.source_input_revision,m.event_link_revision FROM analysis_game_checked m JOIN source_events e ON e.id=m.source_event_id JOIN event_source_links l ON l.source_event_id=e.id LEFT JOIN source_event_state s ON s.source_event_id=e.id WHERE m.target_event_id=(SELECT event FROM scope)),
 attached AS(SELECT e.id,m.participant_source_team_id AS source_team_id,m.account_id,p.generation,t.side FROM analysis_game_checked m JOIN source_events e ON e.id=m.source_event_id JOIN source_event_teams t ON t.source_event_id=e.id AND t.source_team_id=m.participant_source_team_id JOIN provider_accounts p ON p.id=m.account_id WHERE m.target_event_id=(SELECT event FROM scope) AND m.provider='trace' AND m.entitled=1)
 SELECT json_object(
 'accepted_membership',(SELECT json_object('season',team_season_id,'state',state,'revision',revision) FROM team_event_season_resolutions WHERE app_team_id=(SELECT team FROM scope) AND event_id=(SELECT event FROM scope)),
 'event',(SELECT json_object('event_id',event_id,'starts_at',starts_at,'local_day',local_day,'type',type,'status',status,'conditional',conditional,'own_side',own_side,'goals_for',goals_for,'goals_against',goals_against,'source_ids',source_ids,'schedule_source_id',schedule_source_id,'result_source_id',result_source_id,'identity_conflict',identity_conflict,'result_conflict',result_conflict) FROM team_events WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) AND event_id=(SELECT event FROM scope)),
 'native',(SELECT json_group_array(json_object('id',id,'hash',content_hash,'provenance',provenance,'link_revision',revision,'input_revision',input_revision,'original_event_id',original_event_id,'association_id',association_id,'own_proof_hash',own_proof_hash,'published_source_hash',source_hash,'published_source_input_revision',source_input_revision,'published_event_link_revision',event_link_revision)) FROM(SELECT * FROM native ORDER BY id)),
 'publications',(SELECT json_group_array(json_object('association',association_id,'decision_revision',decision_revision,'target',target_event_id,'disposition',disposition,'membership_hash',membership_hash,'semantic_hash',semantic_hash,'proof_hash',proof_hash)) FROM(SELECT p.* FROM team_game_publications p JOIN analysis_game_runs r ON r.run_id=p.run_id AND r.app_team_id=p.app_team_id AND r.team_season_id=p.team_season_id WHERE p.target_event_id=(SELECT event FROM scope) ORDER BY p.association_id)),
 'attached',(SELECT json_group_array(json_object('id',id,'team',source_team_id,'account',account_id,'generation',generation,'side',side)) FROM(SELECT * FROM attached ORDER BY id,source_team_id)),
 'identities',(SELECT json_group_array(json_object('source_player',source_player_id,'canonical',canonical_id,'revision',revision,'gid',gid,'assigned',assigned_player,'assigned_canonical',assigned_canonical,'assignment_revision',assignment_revision)) FROM(SELECT DISTINCT m.source_player_id,c.canonical_id,l.revision,t.gid,t.player_id AS assigned_player,tc.canonical_id AS assigned_canonical,t.revision AS assignment_revision FROM source_game_members m JOIN attached a ON a.id=m.source_event_id AND a.source_team_id=m.source_team_id AND a.account_id=m.account_id LEFT JOIN player_source_links l ON l.source_player_id=m.source_player_id LEFT JOIN canonical_player_ids c ON c.input_id=l.player_id LEFT JOIN analysis_track_assignments t ON t.source_event_id=m.source_event_id AND t.source_team_id=m.source_team_id AND t.gid=m.gid AND t.app_team_id=(SELECT team FROM scope) AND t.team_season_id=(SELECT season FROM scope) LEFT JOIN canonical_player_ids tc ON tc.input_id=t.player_id ORDER BY m.source_player_id,t.gid)),
 'roster',(SELECT json_group_array(json_object('id',player_id,'name',name,'jersey',jersey)) FROM(SELECT player_id,name,jersey FROM team_players WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) ORDER BY player_id)),
 'overrides',(SELECT json_group_array(json_object('kind',kind,'event',event_id,'player',player_id,'revision',revision,'fields',fields,'updated_at',updated_at)) FROM(SELECT kind,event_id,player_id,revision,fields,updated_at FROM analysis_overrides WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) AND ((kind='match' AND event_id=(SELECT state_event FROM scope)) OR kind='player_season' OR(kind='player_match' AND event_id=(SELECT state_event FROM scope))) ORDER BY kind,player_id)),
 'connections',(SELECT json_group_array(json_object('id',id,'active',active,'generation',generation,'account',account_id,'source',source_team_id,'mode',scope_mode)) FROM(SELECT * FROM team_source_connections WHERE app_team_id=(SELECT team FROM scope) AND source_team_id IN(SELECT source_team_id FROM attached) ORDER BY id)),
 'attachments',(SELECT json_group_array(json_object('id',id,'active',active,'generation',generation)) FROM(SELECT * FROM team_source_attachments WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) AND source_team_id IN(SELECT source_team_id FROM attached) ORDER BY id)),
 'connection_seasons',(SELECT json_group_array(json_object('root',connection_id,'active',active,'excluded',excluded,'generation',generation)) FROM(SELECT * FROM team_connection_seasons WHERE team_season_id=(SELECT season FROM scope) AND connection_id IN(SELECT id FROM team_source_connections WHERE app_team_id=(SELECT team FROM scope) AND source_team_id IN(SELECT source_team_id FROM attached)) ORDER BY connection_id)),
 'lineup_rows',(SELECT json_group_array(json_object('half',half,'player',player_id,'kind',slot_kind,'slot',slot,'position',position)) FROM(SELECT * FROM analysis_lineup_assignments WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) AND event_id=(SELECT state_event FROM scope) ORDER BY half,player_id)),
 'lineup',(SELECT json_object('format',format,'revision',revision,'updated_at',updated_at) FROM analysis_lineup_headers WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) AND event_id=(SELECT state_event FROM scope))) AS signature`;


function attribution(c) {
  const sql=`WITH player_map AS(${PLAYER_MAP}), unique_tracks AS(SELECT gid,MIN(player_id) AS player_id FROM player_map WHERE gid IS NOT NULL GROUP BY gid HAVING COUNT(DISTINCT player_id)=1),
  candidates AS(SELECT m.id,m.clip_id,lower(trim(m.type)) AS kind,t.player_id
   FROM source_game_moments m JOIN json_each(m.evidence,'$.gids') g JOIN unique_tracks t ON t.gid=g.value
   WHERE m.source_event_id=? AND m.source_team_id=? AND m.account_id=? AND lower(trim(m.type)) IN('goal','assist')
   AND (m.side=? OR (m.side IS NULL AND json_extract(m.evidence,'$.team_id')=?))
   AND (json_extract(m.evidence,'$.team_id') IS NULL OR json_extract(m.evidence,'$.team_id')=?)),
  exact_moments AS(SELECT id,clip_id,kind,MIN(player_id) AS player_id FROM candidates GROUP BY id,clip_id,kind HAVING COUNT(DISTINCT player_id)=1),
  credited AS(SELECT COALESCE(clip_id,id) AS native_key,kind,MIN(player_id) AS player_id FROM exact_moments GROUP BY COALESCE(clip_id,id),kind HAVING COUNT(DISTINCT player_id)=1)`;
  return {sql,params:[...mapParams(c),c.source.id,c.source.source_team_id,c.source.account_id,c.source.side,c.source.native_team_id,c.source.native_team_id]};
}

async function context(db,teamId,seasonId,eventId) {
  const game=await resolvePublishedGame(db,teamId,seasonId,eventId,{maxMembers:64});
  if(game&&!game.available)throw problem('The saved game scope changed. Rebuild its team projection.','game_scope_changed');
  if(game)eventId=game.event_id;
  const ownerState=game?await captureGameOwnerState(db,game,{kinds:['analysis_overrides','analysis_lineup_headers','analysis_track_assignments']}):null,stateEventId=ownerState?.event_ids.length===1?ownerState.event_ids[0]:eventId;
  const rows=await db.batch([
    db.prepare(`SELECT p.source_revision,d.mutation_revision,r.status_revision,p.pending,(SELECT team_season_id FROM team_event_season_resolutions accepted WHERE accepted.app_team_id=p.app_team_id AND accepted.event_id=?) AS accepted_season,(SELECT COUNT(*) FROM team_event_season_resolutions accepted WHERE accepted.app_team_id=p.app_team_id AND accepted.event_id=?) AS accepted_exists FROM team_projection_state p JOIN domain_installation d ON d.id=1 JOIN team_read_state r ON r.app_team_id=p.app_team_id WHERE p.app_team_id=? AND p.team_season_id=?`).bind(eventId,eventId,teamId,seasonId),
    db.prepare('SELECT * FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(teamId,seasonId,eventId),
    game?savedAnalysisContextsQuery(db,game):db.prepare('SELECT 1 WHERE 0'),
    db.prepare(`SELECT * FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND ((kind='match' AND event_id=?) OR kind='player_season' OR (kind='player_match' AND event_id=?)) ORDER BY kind,player_id`).bind(teamId,seasonId,stateEventId,stateEventId),
    db.prepare('SELECT * FROM match_analysis WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(teamId,seasonId,eventId),
    db.prepare(SCOPED_INPUT_SQL).bind(teamId,seasonId,eventId,stateEventId),
  ]);
  const revision=rows[0].results[0],event=rows[1].results[0];if(revision&&(revision.accepted_exists&&revision.accepted_season!==seasonId||!event&&!revision.pending))return {obsolete:true,revision};need(revision&&event&&game,'The published match is unavailable.','not_found');
  const sources=rows[2].results,source=sources.length===1?sources[0]:null;
  const c={db,teamId,seasonId,eventId,stateEventId,event,game,ownerState,revision,source,overrides:rows[3].results,sourceCount:sources.length,published:rows[4].results[0]||null};
  const lineup=await db.batch([db.prepare('SELECT format,revision,updated_at FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(teamId,seasonId,stateEventId),db.prepare('SELECT a.half,a.player_id,a.slot_kind,a.slot,a.position,t.name,t.jersey,t.player_id IS NOT NULL AS available FROM analysis_lineup_assignments a LEFT JOIN team_players t ON t.app_team_id=a.app_team_id AND t.team_season_id=a.team_season_id AND t.player_id=a.player_id WHERE a.app_team_id=? AND a.team_season_id=? AND a.event_id=? ORDER BY a.half,a.player_id LIMIT 201').bind(teamId,seasonId,stateEventId)]);
  c.lineupHeader=lineup[0].results[0]||null;c.lineup=lineup[1].results;if(c.lineup.length>200)c.boundFailure='Lineup exceeded its declared bound.';
  if(c.ownerState.conflict)c.boundFailure='Analysis exists on independent original game keys. Resolve the saved state before rebuilding.';
  c.matchOverride=parse(c.overrides.find(v=>v.kind==='match')?.fields);c.duration=finite(c.matchOverride.duration_minutes);

  c.signature=rows[5].results[0].signature;
  if(parse(c.signature).identities.length>1500)c.boundFailure='A match has too many native player identities.';
  if(new TextEncoder().encode(c.signature).length>1_000_000)c.boundFailure='A match input signature exceeded its bound.';
  c.input=await digest([ANALYSIS_ALGORITHM_VERSION,c.signature,c.ownerState.snapshot]);
  if(!source)return c;
  const scope=`trace:${source.native_id}:trace:${source.native_team_id}`;
  const facts=await db.batch([
    db.prepare(`SELECT * FROM source_trace_components WHERE source_event_id=? AND source_team_id=? AND account_id=? AND kind IN('header','clip','radar') ORDER BY kind,half LIMIT 6`).bind(source.id,source.source_team_id,source.account_id),
    db.prepare(`SELECT * FROM source_component_coverage WHERE provider='trace' AND account_id=? AND kind='game' AND scope=? LIMIT 1`).bind(source.account_id,scope),
    db.prepare('SELECT COUNT(*) AS count,SUM(provenance=\'file_import\') AS imported FROM source_game_moments WHERE source_event_id=? AND source_team_id=? AND account_id=?').bind(source.id,source.source_team_id,source.account_id),
  ]);
  c.components=facts[0].results;if(c.components.length>5)c.boundFailure='A match has conflicting native components.';c.header=facts[0].results.find(v=>v.kind==='header');c.clips=facts[0].results.filter(v=>v.kind==='clip');c.gameCoverage=facts[1].results[0];c.momentsImported=facts[2].results[0].imported>0;c.momentsComplete=!!c.gameCoverage?.complete&&!!c.header&&facts[2].results[0].count===parse(c.header.evidence).moment_count;
  // Video clip lengths are clock metadata, not inferred playing windows.
  c.duration=finite(c.matchOverride.duration_minutes);
  return c;
}

async function snapshot(c){
 c.components ||= [];c.members=[];c.tracking=[];c.summaries=[];c.heatmaps=[];c.coverage=[];c.credited=[];c.creditedMoments=[];c.goalMoments=[];c.rosterLabels=[];
 if(!c.source)return;
 const s=c.source,params=[s.id,s.source_team_id,s.account_id];c.scope=`trace:${s.native_id}:trace:${s.native_team_id}`;
 // Inspect row/byte budgets in SQLite before materializing provider payloads.
 // A cap failure is a terminal review receipt, never a truncated calculation.
 const tables=[['source_game_members','evidence',1500],['source_tracking_segments','segments',2048],['source_stat_summaries','summary',1536],['source_heatmaps','cells',384]],budget=await c.db.prepare(`SELECT ${tables.map(([table,col,cap],i)=>`(SELECT json_object('count',COUNT(*),'bytes',COALESCE(SUM(length(CAST(${col} AS BLOB))),0)) FROM(SELECT ${col} FROM ${table} WHERE source_event_id=? AND source_team_id=? AND account_id=? LIMIT ${cap+1})) AS budget${i}`).join(',')}`).bind(...tables.flatMap(()=>params)).first();
 let bytes=0;for(let i=0;i<tables.length;i++){const b=parse(budget['budget'+i]);need(b.count<=tables[i][2],'Complete match snapshot exceeds '+tables[i][0]+' row bound.','analysis_bound');bytes+=b.bytes;}need(bytes<=7_000_000,'Complete match payload exceeds the 7 MB materialization budget.','analysis_bound');
 const a=attribution(c),rows=await c.db.batch([
  c.db.prepare(`WITH player_map AS(${PLAYER_MAP}) SELECT m.*,p.player_id,tc.canonical_id AS assigned_player_id FROM source_game_members m LEFT JOIN player_map p ON p.gid IS m.gid AND p.source_player_id IS m.source_player_id LEFT JOIN analysis_track_assignments t ON t.app_team_id=? AND t.team_season_id=? AND t.source_event_id=m.source_event_id AND t.source_team_id=m.source_team_id AND t.gid=m.gid LEFT JOIN canonical_player_ids tc ON tc.input_id=t.player_id WHERE m.source_event_id=? AND m.source_team_id=? AND m.account_id=? ORDER BY m.id,p.player_id LIMIT 1501`).bind(...mapParams(c),c.teamId,c.seasonId,...params),
  c.db.prepare('SELECT * FROM source_tracking_segments WHERE source_event_id=? AND source_team_id=? AND account_id=? ORDER BY half,gid,chunk,page_offset LIMIT 2049').bind(...params),
  c.db.prepare("SELECT * FROM source_stat_summaries WHERE source_event_id=? AND source_team_id=? AND account_id=? AND side=? AND period IN('full','1','2') ORDER BY id LIMIT 1537").bind(...params,s.side),
  c.db.prepare("SELECT * FROM source_heatmaps WHERE source_event_id=? AND source_team_id=? AND account_id=? AND side=? AND period IN('full','1','2') ORDER BY id LIMIT 385").bind(...params,s.side),
  c.db.prepare("SELECT scope,kind,complete,availability FROM source_component_coverage WHERE provider='trace' AND account_id=? AND scope>=? AND scope<? ORDER BY kind,scope LIMIT 2049").bind(s.account_id,c.scope,c.scope+';'),
  c.db.prepare(`${a.sql} SELECT player_id,SUM(kind='goal') AS goals,SUM(kind='assist') AS assists FROM credited GROUP BY player_id ORDER BY player_id LIMIT 129`).bind(...a.params),
  c.db.prepare(`SELECT lower(trim(type)) AS kind,COUNT(DISTINCT COALESCE(clip_id,id)) AS count FROM source_game_moments WHERE source_event_id=? AND source_team_id=? AND account_id=? AND lower(trim(type)) IN('goal','assist') AND(side=? OR(side IS NULL AND json_extract(evidence,'$.team_id')=?)) GROUP BY lower(trim(type))`).bind(...params,s.side,s.native_team_id),
  c.db.prepare(`${a.sql} SELECT native_key,kind,player_id FROM credited ORDER BY native_key,kind LIMIT 257`).bind(...a.params),
  c.db.prepare("SELECT id,clip_id,half,time_seconds,side,evidence,provenance FROM source_game_moments WHERE source_event_id=? AND source_team_id=? AND account_id=? AND lower(trim(type))='goal' ORDER BY half,time_seconds,id LIMIT 257").bind(...params),
  c.db.prepare(`WITH player_map AS(${PLAYER_MAP}) SELECT player_id,name,jersey FROM team_players WHERE app_team_id=? AND team_season_id=? AND(player_id IN(SELECT player_id FROM player_map) OR player_id IN(SELECT player_id FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND event_id=? AND kind='player_match') OR player_id IN(SELECT player_id FROM analysis_lineup_assignments WHERE app_team_id=? AND team_season_id=? AND event_id=?)) ORDER BY player_id LIMIT 129`).bind(...mapParams(c),c.teamId,c.seasonId,c.teamId,c.seasonId,c.stateEventId,c.teamId,c.seasonId,c.stateEventId),
 ]);
 const names=['members','tracking','summaries','heatmaps','coverage','credited'],bounds=[1500,2048,1536,384,2048,128];for(let i=0;i<names.length;i++){need(rows[i].results.length<=bounds[i],'Match '+names[i]+' exceeds the complete snapshot bound.','analysis_bound');c[names[i]]=rows[i].results;}
 need(new TextEncoder().encode(JSON.stringify(rows.slice(0,6))).length<=8_000_000,'The complete match snapshot exceeds 8 MB.','analysis_bound');
 need(c.tracking.reduce((n,v)=>n+parse(v.segments).length,0)<=4096,'The complete match exceeds 4096 tracking intervals.','analysis_bound');
 c.creditedMoments=rows[7].results.slice(0,256);c.goalMoments=rows[8].results.slice(0,256);c.timelineTruncated=rows[7].results.length>256||rows[8].results.length>256;c.rosterLabels=rows[9].results;need(c.rosterLabels.length<=128,'Match labels exceed the canonical participant bound.','analysis_bound');
 c.counts={goals:rows[6].results.find(v=>v.kind==='goal')?.count||0,assists:rows[6].results.find(v=>v.kind==='assist')?.count||0,credited_goals:c.credited.reduce((n,v)=>n+v.goals,0),credited_assists:c.credited.reduce((n,v)=>n+v.assists,0)};
}
function precondition(c) {
 const gameFence=gameScopeFenceSQL(c.game),ownerFence=gameOwnerStateFenceSQL(c.ownerState);
 // A failed scope check must abort the whole lease transaction. A WHERE that
 // merely skips this row would still let the following output writes publish.
 return {sql:`INSERT INTO analysis_input_preconditions SELECT 1,?,CASE WHEN (${gameFence.sql}) AND (${ownerFence.sql}) THEN signature ELSE char(0) END FROM(${SCOPED_INPUT_SQL}) WHERE $FENCE ON CONFLICT(id) DO UPDATE SET expected_input=excluded.expected_input,actual_input=excluded.actual_input`,params:[c.signature,...gameFence.params,...ownerFence.params,c.teamId,c.seasonId,c.eventId,c.stateEventId]};
}
function insertRow(table,row){const cols=Object.keys(row);return {sql:`INSERT INTO ${table}(${cols.join(',')}) SELECT ${cols.map(()=>'?').join(',')} WHERE $FENCE ON CONFLICT(app_team_id,team_season_id,event_id) DO UPDATE SET ${cols.filter(k=>!['app_team_id','team_season_id','event_id'].includes(k)).map(k=>`${k}=excluded.${k}`).join(',')}`,params:Object.values(row)};}
/** A complete bounded snapshot resolves once, then immutable facts and pointer publish atomically. */
export async function buildMatchAnalysisPage(db,{teamId,seasonId,eventId,cursor={},pageSize=2}) {
 need(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=2,'Invalid analysis page size.');
 const c=await context(db,teamId,seasonId,eventId);
 if(c.obsolete){
  const condition=`(EXISTS(SELECT 1 FROM team_event_season_resolutions r WHERE r.app_team_id=? AND r.event_id=? AND r.team_season_id IS NOT ?) OR(NOT EXISTS(SELECT 1 FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=?) AND EXISTS(SELECT 1 FROM team_projection_state WHERE app_team_id=? AND team_season_id=? AND pending=0)))`,guardParams=[teamId,eventId,seasonId,teamId,seasonId,eventId,teamId,seasonId];
  const count=(await db.prepare('SELECT COUNT(*) AS count FROM(SELECT 1 FROM player_match_analysis WHERE app_team_id=? AND team_season_id=? AND event_id=? LIMIT 101)').bind(teamId,seasonId,eventId).first()).count;
  return {statements:[{sql:`DELETE FROM player_match_analysis WHERE rowid IN(SELECT rowid FROM player_match_analysis WHERE app_team_id=? AND team_season_id=? AND event_id=? LIMIT 100) AND ${condition} AND $FENCE`,params:[teamId,seasonId,eventId,...guardParams]},{sql:`DELETE FROM match_analysis WHERE app_team_id=? AND team_season_id=? AND event_id=? AND ${condition} AND $FENCE`,params:[teamId,seasonId,eventId,...guardParams]}],checkpoint:{obsolete:true},complete:count<=100,coverage:'unsupported',rowsSaved:0,publishContent:false};
 }
 eventId=c.eventId;
 // This durable recovery receipt is pinned by the same exact input CAS as the
 // published analysis, including normalized members and their current clocks.
 const sourceRevisions=parse(c.signature).native.map(v=>v.input_revision??0);
 need(sourceRevisions.length<=64&&sourceRevisions.every(v=>Number.isSafeInteger(v)&&v>=0),'Match source clock exceeded its bound.');
 const sourceClock=JSON.stringify([c.game.run_id,sourceRevisions]);
 const priorEvidence=parse(c.published?.evidence);
 if(c.published?.input_hash===c.input||priorEvidence.rejected_input_hash===c.input){
  const statements=[precondition(c)];let changed=false,state=c.published.state;
  if(c.published.input_hash===c.input&&priorEvidence.rejected_input_hash&&priorEvidence.rejected_input_hash!==c.input){state=priorEvidence.accepted_state||'incomplete';delete priorEvidence.rejected_input_hash;delete priorEvidence.rejected_analysis;delete priorEvidence.accepted_state;statements.push({sql:'UPDATE match_analysis SET state=?,evidence=? WHERE app_team_id=? AND team_season_id=? AND event_id=? AND $FENCE',params:[state,safeJson(priorEvidence),teamId,seasonId,eventId]},{sql:'UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=? AND $FENCE',params:[teamId]});changed=true;}
  const orphanCount=(await db.prepare('SELECT COUNT(*) AS count FROM(SELECT 1 FROM player_match_analysis p LEFT JOIN match_analysis a ON a.active_run=p.run_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.event_id=? AND a.active_run IS NULL LIMIT 129)').bind(teamId,seasonId,eventId).first()).count;
  if(orphanCount)statements.push({sql:'DELETE FROM player_match_analysis WHERE rowid IN(SELECT p.rowid FROM player_match_analysis p LEFT JOIN match_analysis a ON a.active_run=p.run_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.event_id=? AND a.active_run IS NULL LIMIT 128) AND $FENCE',params:[teamId,seasonId,eventId]});
  return {statements,checkpoint:{sourceClock,finished:orphanCount<=128,input:c.input,cleanup:orphanCount>128},complete:orphanCount<=128,coverage:state,rowsSaved:0,publishContent:false,changed};
 }
 const statements=[precondition(c)],run=crypto.randomUUID();let resolved,failure,publishedState,highlights={};
 try{if(c.boundFailure)throw Object.assign(new RangeError(c.boundFailure),{code:'analysis_bound'});await snapshot(c);const explicitFormat=ownerFormat(c.overrides.find(v=>v.kind==='match'),c.lineupHeader);if(explicitFormat!=null&&![7,9].includes(explicitFormat))throw new RangeError('Only supported 7v7 or 9v9 formats can be analyzed.');resolved=resolveSnapshot(c);highlights=matchHighlights(c,resolved);for(const f of resolved.facts){safeJson(parse(f.evidence));if(f.spatial)safeJson(parse(f.spatial));}need(new TextEncoder().encode(JSON.stringify(resolved.facts)).length<=1_880_000,'Published match facts exceed their complete transaction bound.','analysis_bound');need(new TextEncoder().encode(JSON.stringify({lineups:resolved.lineups,...highlights})).length<=10500,'Published match summary exceeds its bounded evidence.','analysis_bound');}catch(error){if(['analysis_bound','analysis_contract'].includes(error.code)||error instanceof RangeError||error instanceof TypeError)failure={code:error.code||'invalid_analysis_input',severity:'error',message:error.message};else throw error;}
 const counts=c.counts||{goals:0,assists:0,credited_goals:0,credited_assists:0},goalExcess=c.event.goals_for!==null&&counts.credited_goals>c.event.goals_for,result=resolved?.result;
 const analysis={version:ANALYSIS_ALGORITHM_VERSION,coverage:result?.coverage||'partial',publishable:!failure&&result?.publishable===true,format:result?{value:result.format.value,state:result.format.state,basis:result.format.provenance.basis}:null,accounting:result?{capacity_seconds:result.totals.capacitySeconds,assigned_seconds:result.totals.assignedSeconds,assigned_is_lower_bound:result.totals.assignedIsLowerBound,anonymous_gk_seconds:result.totals.unassignedGkSeconds,unallocated_seconds:result.totals.unallocatedSeconds}:null,issues:(failure?[failure]:result.issues).slice(0,8).map(v=>Object.fromEntries(Object.entries(v).filter(([k])=>['code','severity','message','half','playerId','player_id','field','value','expected','actual'].includes(k)))),issue_count:failure?1:result.issues.length};
 const rejected=failure||!result.publishable;
 if(rejected&&c.published){
  const evidence=safeJson({...parse(c.published.evidence),accepted_state:parse(c.published.evidence).accepted_state||c.published.state,rejected_input_hash:c.input,rejected_analysis:analysis});statements.push({sql:"UPDATE match_analysis SET state='human_review',evidence=? WHERE app_team_id=? AND team_season_id=? AND event_id=? AND $FENCE",params:[evidence,teamId,seasonId,eventId]});
 }else{
  const facts=rejected?[]:resolved.facts.map(f=>({...f,run_id:run}));for(const f of facts){safeJson(parse(f.evidence));if(f.spatial)safeJson(parse(f.spatial));}
  if(facts.length){const cols=Object.keys(facts[0]),encoded=JSON.stringify(facts);need(new TextEncoder().encode(encoded).length<=1_900_000,'Published match facts exceed their complete transaction bound.','analysis_bound');statements.push({sql:`INSERT INTO player_match_analysis(${cols.join(',')}) SELECT ${cols.map(k=>`json_extract(value,'$.${k}')`).join(',')} FROM json_each(?) WHERE $FENCE ON CONFLICT(run_id,player_id) DO NOTHING`,params:[encoded]});}
  const manual=facts.some(f=>['manual','estimated','published'].includes(f.minutes_state)||f.goals_state==='manual'||f.assists_state==='manual'),state=rejected?'human_review':c.sourceCount>1?'human_review':!c.source?manual?'ready':'unsupported':!c.header?'pending':['restricted','unpublished'].includes(c.header.availability)?c.header.availability:goalExcess||counts.goals!==counts.credited_goals||counts.assists!==counts.credited_assists||facts.some(f=>f.native_state==='human_review')?'human_review':!c.momentsComplete||facts.some(f=>f.minutes_state==='incomplete'||f.minutes===null)?'incomplete':facts.some(f=>f.minutes_state==='estimated')?'estimated':'ready';
  publishedState=state;const evidence=safeJson({analysis,lineups:rejected?{}:resolved?.lineups||{},...(!rejected?highlights:{}),source_contexts:c.sourceCount,source_provenance:{event:c.source?.provenance||null,header:c.header?.provenance||null,moments:c.momentsImported?'file_import':c.source?'provider':null},moments_complete:!!c.momentsComplete,goal_attribution:'explicit_provider_moment_unique_native_own_player',goal_total_conflict:goalExcess,...(rejected?{rejected_input_hash:c.input}:{})});
  statements.push(insertRow('match_analysis',{app_team_id:teamId,team_season_id:seasonId,event_id:eventId,active_run:run,state,source_event_id:c.source?.id||null,source_team_id:c.source?.source_team_id||null,source_revision:c.revision.source_revision,mutation_revision:c.revision.mutation_revision,projected_at:stamp(),player_count:facts.length,unresolved_goals:Math.max(0,counts.goals-counts.credited_goals),unresolved_assists:Math.max(0,counts.assists-counts.credited_assists),tracking_complete:Number(facts.length>0&&facts.every(f=>f.tracking_state==='complete')),duration_minutes:result?.durationSeconds===null||!result?c.duration??null:result.durationSeconds/60,format:result?.format.value??null,assigned_minutes:rejected?null:result.totals.assignedSeconds===null?null:result.totals.assignedSeconds/60,capacity_minutes:result?.totals.capacitySeconds===null||!result?null:result.totals.capacitySeconds/60,over_capacity:Number(!!result?.totals.overCapacity),evidence,input_hash:c.input}));
 }
 statements.push({sql:'UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=? AND $FENCE',params:[teamId]});
 statements.push({sql:`DELETE FROM player_match_analysis WHERE rowid IN(SELECT p.rowid FROM player_match_analysis p LEFT JOIN match_analysis a ON a.active_run=p.run_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.event_id=? AND a.active_run IS NULL AND p.run_id<>? LIMIT 128) AND $FENCE`,params:[teamId,seasonId,eventId,run]});
 const oldCount=(await db.prepare('SELECT COUNT(*) AS count FROM(SELECT 1 FROM player_match_analysis WHERE app_team_id=? AND team_season_id=? AND event_id=? AND run_id<>? LIMIT 129)').bind(teamId,seasonId,eventId,rejected?c.published?.active_run||run:run).first()).count;
 return {statements,checkpoint:{sourceClock,run_id:run,input:c.input,finished:oldCount<=128,cleanup:oldCount>128,rejected:!!rejected},complete:oldCount<=128,coverage:rejected?'human_review':publishedState,rowsSaved:rejected?0:resolved.facts.length,publishContent:false};
}
