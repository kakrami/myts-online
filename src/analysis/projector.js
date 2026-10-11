import { PLAYER_MAP,mapParams,nativeFactQuery } from './native-facts.js';
import { nativeSpatial } from './spatial.js';
const parse=v=>typeof v==='string'?JSON.parse(v||'{}'):v||{};
const problem=(message,code='analysis_contract',status=409)=>Object.assign(new Error(message),{code,status});
const need=(v,m,c)=>{if(!v)throw problem(m,c);return v;};
const round=v=>Math.round(v*1000)/1000;
const stamp=()=>new Date().toISOString();
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const sumNative=v=>v&&['offensive','middle','defensive'].every(k=>finite(v[k])!==null)?v.offensive+v.middle+v.defensive:null;
const safeJson=v=>{const s=JSON.stringify(v);need(new TextEncoder().encode(s).length<=16000,'Analysis evidence exceeded its bound.');return s;};
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');
// This exact signature is evaluated again inside the lease transaction. Its
// inputs belong to this match; activity in other teams or matches cannot abort it.
const SCOPED_INPUT_SQL=`WITH scope(team,season,event) AS(VALUES(?,?,?)),
 native AS(SELECT e.id,e.content_hash,e.provenance,l.revision,s.input_revision FROM source_events e JOIN event_source_links l ON l.source_event_id=e.id JOIN canonical_event_ids c ON c.input_id=l.event_id LEFT JOIN source_event_state s ON s.source_event_id=e.id WHERE c.canonical_id=(SELECT event FROM scope)),
 attached AS(SELECT e.id,a.source_team_id,a.account_id,p.generation,t.side FROM source_events e JOIN native n ON n.id=e.id JOIN source_event_teams t ON t.source_event_id=e.id JOIN team_source_attachments a ON a.source_team_id=t.source_team_id AND a.account_id=e.account_id AND a.active=1 JOIN provider_accounts p ON p.id=a.account_id AND p.active=1 WHERE e.provider='trace' AND a.app_team_id=(SELECT team FROM scope) AND a.team_season_id=(SELECT season FROM scope))
 SELECT json_object(
 'event',(SELECT json_object('event_id',event_id,'starts_at',starts_at,'local_day',local_day,'type',type,'status',status,'conditional',conditional,'own_side',own_side,'goals_for',goals_for,'goals_against',goals_against,'source_ids',source_ids,'schedule_source_id',schedule_source_id,'result_source_id',result_source_id,'identity_conflict',identity_conflict,'result_conflict',result_conflict) FROM team_events WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) AND event_id=(SELECT event FROM scope)),
 'native',(SELECT json_group_array(json_object('id',id,'hash',content_hash,'provenance',provenance,'link_revision',revision,'input_revision',input_revision)) FROM(SELECT * FROM native ORDER BY id)),
 'attached',(SELECT json_group_array(json_object('id',id,'team',source_team_id,'account',account_id,'generation',generation,'side',side)) FROM(SELECT * FROM attached ORDER BY id,source_team_id)),
 'identities',(SELECT json_group_array(json_object('source_player',source_player_id,'canonical',canonical_id,'revision',revision,'gid',gid,'assigned',assigned_player,'assignment_revision',assignment_revision)) FROM(SELECT DISTINCT m.source_player_id,c.canonical_id,l.revision,t.gid,t.player_id AS assigned_player,t.revision AS assignment_revision FROM source_game_members m JOIN attached a ON a.id=m.source_event_id AND a.source_team_id=m.source_team_id AND a.account_id=m.account_id LEFT JOIN player_source_links l ON l.source_player_id=m.source_player_id LEFT JOIN canonical_player_ids c ON c.input_id=l.player_id LEFT JOIN analysis_track_assignments t ON t.source_event_id=m.source_event_id AND t.source_team_id=m.source_team_id AND t.gid=m.gid AND t.app_team_id=(SELECT team FROM scope) AND t.team_season_id=(SELECT season FROM scope) ORDER BY m.source_player_id,t.gid)),
 'roster',(SELECT json_group_array(player_id) FROM(SELECT player_id FROM team_players WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) ORDER BY player_id)),
 'overrides',(SELECT json_group_array(json_object('kind',kind,'event',event_id,'player',player_id,'revision',revision,'fields',fields)) FROM(SELECT kind,event_id,player_id,revision,fields FROM analysis_overrides WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) AND ((kind='match' AND event_id=(SELECT event FROM scope)) OR kind='player_season' OR(kind='player_match' AND event_id=(SELECT event FROM scope))) ORDER BY kind,player_id)),
 'lineup',(SELECT json_object('format',format,'revision',revision) FROM analysis_lineup_headers WHERE app_team_id=(SELECT team FROM scope) AND team_season_id=(SELECT season FROM scope) AND event_id=(SELECT event FROM scope))) AS signature`;

function nativeFacts(c,playerId,table){const q=nativeFactQuery(c,playerId,table);return c.db.prepare(q.sql).bind(...q.params);}
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
  const rows=await db.batch([
    db.prepare(`SELECT p.source_revision,d.mutation_revision,r.status_revision FROM team_projection_state p JOIN domain_installation d ON d.id=1 JOIN team_read_state r ON r.app_team_id=p.app_team_id WHERE p.app_team_id=? AND p.team_season_id=?`).bind(teamId,seasonId),
    db.prepare('SELECT * FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(teamId,seasonId,eventId),
    db.prepare(`SELECT e.*,a.source_team_id,s.native_id AS native_team_id,t.side FROM source_events e JOIN event_source_links l ON l.source_event_id=e.id JOIN canonical_event_ids c ON c.input_id=l.event_id JOIN team_source_attachments a ON a.app_team_id=? AND a.team_season_id=? AND a.active=1 AND a.account_id=e.account_id JOIN provider_accounts p ON p.id=a.account_id AND p.active=1 JOIN source_teams s ON s.id=a.source_team_id JOIN source_event_teams t ON t.source_team_id=a.source_team_id AND t.source_event_id=e.id WHERE e.provider='trace' AND c.canonical_id=? ORDER BY e.id,a.source_team_id LIMIT 3`).bind(teamId,seasonId,eventId),
    db.prepare(`SELECT * FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND ((kind='match' AND event_id=?) OR kind='player_season' OR (kind='player_match' AND event_id=?)) ORDER BY kind,player_id`).bind(teamId,seasonId,eventId,eventId),
    db.prepare('SELECT input_hash,state FROM match_analysis WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(teamId,seasonId,eventId),
    db.prepare(SCOPED_INPUT_SQL).bind(teamId,seasonId,eventId),
  ]);
  const revision=rows[0].results[0],event=rows[1].results[0];need(revision&&event,'The canonical match is unavailable.','not_found');
  const sources=rows[2].results,source=sources.length===1?sources[0]:null;
  const c={db,teamId,seasonId,eventId,event,revision,source,overrides:rows[3].results,sourceCount:sources.length,published:rows[4].results[0]||null};
  const lineup=await db.batch([db.prepare('SELECT format,revision FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(teamId,seasonId,eventId),db.prepare('SELECT half,player_id,slot_kind,slot,position FROM analysis_lineup_assignments WHERE app_team_id=? AND team_season_id=? AND event_id=? ORDER BY half,player_id LIMIT 201').bind(teamId,seasonId,eventId)]);
  c.lineupHeader=lineup[0].results[0]||null;c.lineup=lineup[1].results;need(c.lineup.length<=200,'Lineup exceeded its declared bound.');
  c.matchOverride=parse(c.overrides.find(v=>v.kind==='match')?.fields);c.duration=finite(c.matchOverride.duration_minutes);
  const nativeInputs=(await db.prepare(`SELECT l.source_event_id,l.revision,s.input_revision FROM event_source_links l JOIN canonical_event_ids c ON c.input_id=l.event_id LEFT JOIN source_event_state s ON s.source_event_id=l.source_event_id WHERE c.canonical_id=? ORDER BY l.source_event_id LIMIT 65`).bind(eventId).all()).results;
  need(nativeInputs.length<=64,'A match has too many provider identities.');
  const identities=source?(await db.prepare(`SELECT DISTINCT m.source_player_id,c.canonical_id,l.revision,t.gid,t.player_id AS assigned_player,t.revision AS assignment_revision FROM source_game_members m LEFT JOIN player_source_links l ON l.source_player_id=m.source_player_id LEFT JOIN canonical_player_ids c ON c.input_id=l.player_id LEFT JOIN analysis_track_assignments t ON t.source_event_id=m.source_event_id AND t.source_team_id=m.source_team_id AND t.gid=m.gid AND t.app_team_id=? AND t.team_season_id=? WHERE m.source_event_id=? AND m.source_team_id=? AND m.account_id=? ORDER BY m.source_player_id,t.gid LIMIT 1501`).bind(teamId,seasonId,source.id,source.source_team_id,source.account_id).all()).results:[];
  need(identities.length<=1500,'A match has too many native player identities.');
  c.signature=rows[5].results[0].signature;
  need(new TextEncoder().encode(c.signature).length<=1_000_000,'A match input signature exceeded its bound.');
  c.input=await digest(c.signature);
  if(!source)return c;
  const scope=`trace:${source.native_id}:trace:${source.native_team_id}`;
  const facts=await db.batch([
    db.prepare(`SELECT * FROM source_trace_components WHERE source_event_id=? AND source_team_id=? AND account_id=? AND kind IN('header','clip') ORDER BY kind,half LIMIT 4`).bind(source.id,source.source_team_id,source.account_id),
    db.prepare(`SELECT * FROM source_component_coverage WHERE provider='trace' AND account_id=? AND kind='game' AND scope=? LIMIT 1`).bind(source.account_id,scope),
    db.prepare('SELECT COUNT(*) AS count,SUM(provenance=\'file_import\') AS imported FROM source_game_moments WHERE source_event_id=? AND source_team_id=? AND account_id=?').bind(source.id,source.source_team_id,source.account_id),
  ]);
  c.header=facts[0].results.find(v=>v.kind==='header');c.clips=facts[0].results.filter(v=>v.kind==='clip');c.gameCoverage=facts[1].results[0];c.momentsImported=facts[2].results[0].imported>0;c.momentsComplete=!!c.gameCoverage?.complete&&!!c.header&&facts[2].results[0].count===parse(c.header.evidence).moment_count;
  c.duration=finite(c.matchOverride.duration_minutes)??(c.clips.length===2?round(c.clips.reduce((n,v)=>n+(v.duration_seconds||0)/60,0)):null);
  return c;
}

function manualFact(c,playerId){
  const season=parse(c.overrides.find(v=>v.kind==='player_season'&&v.player_id===playerId)?.fields),manual=parse(c.overrides.find(v=>v.kind==='player_match'&&v.player_id===playerId)?.fields),value={...season,...manual};
  const fact={app_team_id:c.teamId,team_season_id:c.seasonId,event_id:c.eventId,player_id:playerId,appearance:null,started:null,minutes:null,field_minutes:null,gk_minutes:null,goals:null,assists:null,position:null,minutes_state:'unsupported',goals_state:'unsupported',assists_state:'unsupported',position_state:'unsupported',native_state:'unsupported',tracking_state:'unsupported',passes_all:null,passes_complete:null,shots:null,shots_made:null,turnovers_won:null,turnovers_lost:null,box_touches:null,player_touches:null,possession:null,spatial:null,source_ids:'[]',evidence:safeJson({manual_only:true,source_provenance:{corrections:'manual'},override_revisions:c.overrides.filter(v=>v.player_id===playerId).map(v=>({kind:v.kind,revision:v.revision}))})};
  for(const name of ['minutes','field_minutes','gk_minutes','goals','assists','appearance','started','position'])if(Object.hasOwn(value,name)){fact[name]=value[name];fact[name==='position'?'position_state':['goals','assists'].includes(name)?name+'_state':'minutes_state']='manual';}
  applyLineup(c,fact,manual);
  if(fact.field_minutes!==null&&fact.gk_minutes!==null){fact.minutes=round(fact.field_minutes+fact.gk_minutes);fact.minutes_state='manual';}
  if(fact.minutes>0&&fact.appearance===null)fact.appearance=1;
  return fact;
}
function applyLineup(c,fact,manual={}){
  const rows=c.lineup.filter(v=>v.player_id===fact.player_id),first=rows.find(v=>v.half===1);
  if(first&&!Object.hasOwn(manual,'started')){fact.started=first.slot_kind==='field'?1:0;}
  if(rows.length&&!Object.hasOwn(manual,'position')){const positions=[...new Set(rows.map(v=>v.position).filter(Boolean))];if(positions.length){fact.position=positions.length===1?positions[0]:'Mixed';fact.position_state='manual';}}
}

async function playerFact(c,playerId) {
  const a=attribution(c),params=mapParams(c);
  const results=await c.db.batch([
    c.db.prepare(`WITH player_map AS(${PLAYER_MAP}) SELECT source_player_id,gid,position FROM player_map WHERE player_id=? ORDER BY source_player_id,gid LIMIT 65`).bind(...params,playerId),
    c.db.prepare(`${a.sql} SELECT COALESCE(SUM(kind='goal'),0) AS goals,COALESCE(SUM(kind='assist'),0) AS assists FROM credited WHERE player_id=?`).bind(...a.params,playerId),
    nativeFacts(c,playerId,'source_stat_summaries'),
    c.db.prepare(`WITH player_map AS(${PLAYER_MAP}), intervals AS(SELECT DISTINCT s.half,s.provenance,CAST(json_extract(j.value,'$[0]') AS REAL) AS lo,CAST(json_extract(j.value,'$[1]') AS REAL) AS hi FROM source_tracking_segments s JOIN json_each(s.segments) j WHERE s.source_event_id=? AND s.source_team_id=? AND s.account_id=? AND s.gid IN(SELECT gid FROM player_map WHERE player_id=?)),
      ordered AS(SELECT *,MAX(hi) OVER(PARTITION BY half ORDER BY lo,hi ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end FROM intervals),
      islands AS(SELECT *,SUM(CASE WHEN previous_end IS NULL OR lo>previous_end THEN 1 ELSE 0 END) OVER(PARTITION BY half ORDER BY lo,hi) AS island FROM ordered),
      merged AS(SELECT half,island,MIN(lo) AS lo,MAX(hi) AS hi,MIN(provenance) AS provenance FROM islands GROUP BY half,island)
      SELECT half,SUM(hi-lo)/60 AS minutes,MIN(lo) AS first_seen,MIN(provenance) AS provenance FROM merged GROUP BY half ORDER BY half`).bind(...params,c.source.id,c.source.source_team_id,c.source.account_id,playerId),
    c.db.prepare(`WITH player_map AS(${PLAYER_MAP}) SELECT v.scope,v.complete FROM source_component_coverage v WHERE v.provider='trace' AND v.account_id=? AND v.kind='tracking' AND EXISTS(SELECT 1 FROM player_map m WHERE m.player_id=? AND v.scope=?||':'||m.gid||':1' OR m.player_id=? AND v.scope=?||':'||m.gid||':2') LIMIT 130`).bind(...params,c.source.account_id,playerId,`trace:${c.source.native_id}:trace:${c.source.native_team_id}`,playerId,`trace:${c.source.native_id}:trace:${c.source.native_team_id}`),
    nativeFacts(c,playerId,'source_heatmaps'),
  ]);
  const members=results[0].results;need(members.length<=64,'One player has too many native tracking identities.');if(!members.length)return manualFact(c,playerId);
  const ids=[...new Set(members.map(v=>v.source_player_id).filter(Boolean))],gids=[...new Set(members.map(v=>v.gid).filter(Boolean))];
  const expected=gids.flatMap(g=>c.clips.map(clip=>`trace:${c.source.native_id}:trace:${c.source.native_team_id}:${g}:${clip.half}`));
  const trackingComplete=c.clips.length===2&&expected.length>0&&expected.every(scope=>results[4].results.some(v=>v.scope===scope&&v.complete));
  const tracked=results[3].results.length?round(results[3].results.reduce((n,v)=>n+v.minutes,0)):null;
  const full=results[2].results;need(full.length<=64,'One player has too many native stat identities.');
  const scopeGids=full.flatMap(v=>[...new Set((v.track_gid?[v.track_gid]:members.filter(m=>m.source_player_id===v.source_player_id).map(m=>m.gid)).filter(Boolean))]),covered=new Set(scopeGids),overlappingScopes=scopeGids.length!==covered.size,allCovered=gids.length>0&&gids.every(v=>covered.has(v));
  const nativeState=overlappingScopes?'human_review':full.some(v=>v.state==='restricted')?'restricted':full.length&&full.every(v=>v.state==='unpublished')?'unpublished':!allCovered?'pending':full.every(v=>v.state==='ready')?'ready':'incomplete',summaries=nativeState==='ready'?full.map(v=>parse(v.summary)):[];
  const nativeTotal=fn=>summaries.length&&summaries.every(v=>fn(v)!==null)?summaries.reduce((n,v)=>n+fn(v),0):null;
  const positions=[...new Set(members.map(v=>v.position).filter(Boolean))],position=positions.length===1?positions[0]:null;
  const season=parse(c.overrides.find(v=>v.kind==='player_season'&&v.player_id===playerId)?.fields),manual=parse(c.overrides.find(v=>v.kind==='player_match'&&v.player_id===playerId)?.fields),override={...season,...manual};
  const fact={app_team_id:c.teamId,team_season_id:c.seasonId,event_id:c.eventId,player_id:playerId,appearance:tracked!==null&&tracked>0?1:null,started:null,
    minutes:tracked,field_minutes:null,gk_minutes:null,goals:c.momentsComplete?results[1].results[0].goals:null,assists:c.momentsComplete?results[1].results[0].assists:null,position,
    minutes_state:tracked===null?'pending':trackingComplete?'estimated':'incomplete',goals_state:c.momentsComplete?'published':'incomplete',assists_state:c.momentsComplete?'published':'incomplete',position_state:position?'published':positions.length>1?'human_review':'unsupported',
    native_state:nativeState,tracking_state:trackingComplete?'complete':tracked!==null?'incomplete':'pending',passes_all:nativeTotal(v=>sumNative(v.passes_all)),passes_complete:nativeTotal(v=>sumNative(v.passes_complete)),shots:nativeTotal(v=>finite(v.shots?.total)??sumNative(v.shots)),shots_made:nativeTotal(v=>finite(v.shots?.made)),turnovers_won:nativeTotal(v=>sumNative(v.turnovers_won)),turnovers_lost:nativeTotal(v=>sumNative(v.turnovers_lost)),box_touches:nativeTotal(v=>sumNative(v.box_touches)),player_touches:nativeTotal(v=>sumNative(v.player_touches)),possession:summaries.length===1?finite(summaries[0].possession):null,spatial:results[5].results.length===1?(()=>{const spatial=nativeSpatial(results[5].results[0]);return spatial?safeJson(spatial):null;})():null,source_ids:safeJson(ids),
    evidence:safeJson({native_summary_ids:full.map(v=>v.id),native_scope:'full',native_complete:allCovered,native_track_count:gids.length,source_provenance:{event:c.source.provenance,native:full.some(v=>v.provenance==='file_import')?'file_import':full.length?'provider':null,tracking:results[3].results.some(v=>v.provenance==='file_import')?'file_import':results[3].results.length?'provider':null,moments:c.momentsImported?'file_import':'provider'},tracking_interpretation:'visible_tracking_duration_estimate',tracking_complete:trackingComplete,goal_attribution:'explicit_goal_or_assist_and_unique_own_gid',moments_complete:c.momentsComplete,positions,override_revisions:c.overrides.filter(v=>v.player_id===playerId).map(v=>({kind:v.kind,revision:v.revision}))})};
  for(const name of ['minutes','field_minutes','gk_minutes','goals','assists','appearance','started','position'])if(Object.hasOwn(override,name)){fact[name]=override[name];const state=name==='position'?'position_state':['goals','assists'].includes(name)?name+'_state':'minutes_state';fact[state]='manual';}
  applyLineup(c,fact,manual);
  if(fact.field_minutes!==null||fact.gk_minutes!==null){need(fact.field_minutes!==null&&fact.gk_minutes!==null,'Correct both field and goalkeeper minutes together.');const combined=round(fact.field_minutes+fact.gk_minutes);need(!Object.hasOwn(override,'minutes')||Math.abs(combined-fact.minutes)<0.01,'Total, field and goalkeeper minutes conflict.');fact.minutes=combined;fact.minutes_state='manual';}
  if(fact.minutes!==null&&c.duration!==null&&fact.minutes>c.duration+0.1){fact.minutes_state='human_review';}
  return fact;
}

function precondition(c) {
  return {sql:`INSERT INTO analysis_input_preconditions SELECT 1,?,signature FROM(${SCOPED_INPUT_SQL}) WHERE $FENCE ON CONFLICT(id) DO UPDATE SET expected_input=excluded.expected_input,actual_input=excluded.actual_input`,params:[c.signature,c.teamId,c.seasonId,c.eventId]};
}

/** Build one native D1 page, guarded by the sync engine's lease fence. */
export async function buildMatchAnalysisPage(db,{teamId,seasonId,eventId,cursor={},pageSize=2}) {
  need(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=2,'Invalid analysis page size.');
  const c=await context(db,teamId,seasonId,eventId),current={source:c.revision.source_revision,mutation:c.revision.mutation_revision};
  if(c.published?.input_hash===c.input)return {statements:[precondition(c)],checkpoint:{finished:true,input:c.input},complete:true,coverage:c.published.state,rowsSaved:0,publishContent:false,changed:false};
  const fresh=!cursor.run_id||cursor.input!==c.input;
  const run=fresh?crypto.randomUUID():cursor.run_id,after=fresh?'':cursor.after||'',statements=[precondition(c)];
  let players=[];
  const nativeReady=c.source&&c.header&&c.header.availability!=='restricted';
  const manualPlayers=`SELECT o.player_id FROM analysis_overrides o JOIN team_players p ON p.player_id=o.player_id AND p.app_team_id=o.app_team_id AND p.team_season_id=o.team_season_id WHERE o.app_team_id=? AND o.team_season_id=? AND o.event_id=? AND o.kind='player_match' UNION SELECT player_id FROM analysis_lineup_assignments WHERE app_team_id=? AND team_season_id=? AND event_id=?`;
  players=(await db.prepare(`${nativeReady?`WITH player_map AS(${PLAYER_MAP})`:''} SELECT DISTINCT player_id FROM(${nativeReady?'SELECT player_id FROM player_map UNION ':''}${manualPlayers}) WHERE player_id>? ORDER BY player_id LIMIT ?`).bind(...(nativeReady?mapParams(c):[]),teamId,seasonId,eventId,teamId,seasonId,eventId,after,pageSize+1).all()).results;
  const more=players.length>pageSize,selected=players.slice(0,pageSize),facts=[];
  for(const p of selected){const fact=nativeReady?await playerFact(c,p.player_id):manualFact(c,p.player_id);fact.run_id=run;facts.push(fact);}
  if(facts.length){const cols=Object.keys(facts[0]);statements.push({sql:`INSERT INTO player_match_analysis(${cols.join(',')}) SELECT ${cols.map(k=>`json_extract(value,'$.${k}')`).join(',')} FROM json_each(?) WHERE $FENCE ON CONFLICT(run_id,player_id) DO UPDATE SET ${cols.filter(k=>!['run_id','player_id'].includes(k)).map(k=>`${k}=excluded.${k}`).join(',')}`,params:[JSON.stringify(facts)]});}
  const checkpoint={run_id:run,input:c.input,after:selected.at(-1)?.player_id||after};
  if(more)return {statements,checkpoint,complete:false,coverage:'partial',rowsSaved:facts.length,publishContent:false};
  const attributed=c.source?attribution(c):null;
  let counts={goals:0,assists:0,credited_goals:0,credited_assists:0};
  if(attributed){const totals=await db.prepare(`${attributed.sql} SELECT (SELECT COUNT(DISTINCT COALESCE(clip_id,id)) FROM source_game_moments WHERE source_event_id=? AND source_team_id=? AND account_id=? AND lower(trim(type))='goal' AND (side=? OR(side IS NULL AND json_extract(evidence,'$.team_id')=?))) AS goals,(SELECT COUNT(DISTINCT COALESCE(clip_id,id)) FROM source_game_moments WHERE source_event_id=? AND source_team_id=? AND account_id=? AND lower(trim(type))='assist' AND (side=? OR(side IS NULL AND json_extract(evidence,'$.team_id')=?))) AS assists,COALESCE(SUM(kind='goal'),0) AS credited_goals,COALESCE(SUM(kind='assist'),0) AS credited_assists FROM credited`).bind(...attributed.params,...[0,1].flatMap(()=>[c.source.id,c.source.source_team_id,c.source.account_id,c.source.side,c.source.native_team_id])).first();counts=totals;}
  const format=c.lineupHeader?.format??([7,9,11].includes(c.matchOverride?.format)?c.matchOverride.format:null),capacity=format!==null&&c.duration!==null?format*c.duration:null;
  const manualStats=c.lineup.length>0||c.overrides.some(v=>v.kind==='player_match'&&Object.keys(parse(v.fields)).some(k=>['minutes','goals','assists','started'].includes(k)));
  const baseState=!c.source?c.sourceCount?'human_review':manualStats?'ready':'unsupported':!c.header?'pending':c.header.availability==='restricted'?'restricted':c.header.availability==='unpublished'?'unpublished':!c.momentsComplete?'incomplete':counts.goals!==counts.credited_goals||counts.assists!==counts.credited_assists?'human_review':'ready';
  const goalExcess=c.event.goals_for!==null&&counts.credited_goals>c.event.goals_for;
  const evidence=safeJson({source_contexts:c.sourceCount,source_provenance:{event:c.source?.provenance||null,header:c.header?.provenance||null,moments:c.momentsImported?'file_import':c.source?'provider':null},goal_attribution:'explicit_provider_moment_unique_native_own_player',moments_complete:!!c.momentsComplete,native_goals:counts.goals,native_assists:counts.assists,goal_total_conflict:goalExcess,tracking_interpretation:'estimated_visible_tracking_duration',format_authority:format?'manual':'unsupported'});
  statements.push({sql:`INSERT INTO match_analysis SELECT ?,?,?,?,CASE WHEN ?='ready' THEN CASE WHEN EXISTS(SELECT 1 FROM player_match_analysis WHERE run_id=? AND (minutes_state='human_review' OR native_state='human_review' OR position_state='human_review')) OR ? THEN 'human_review' WHEN EXISTS(SELECT 1 FROM player_match_analysis WHERE run_id=? AND tracking_state IN('incomplete','pending')) THEN 'incomplete' WHEN EXISTS(SELECT 1 FROM player_match_analysis WHERE run_id=? AND minutes_state='estimated') THEN 'estimated' ELSE 'ready' END ELSE ? END,?,?,?,?,?,(SELECT COUNT(*) FROM player_match_analysis WHERE run_id=?),?,?,CASE WHEN (SELECT COUNT(*) FROM player_match_analysis WHERE run_id=?)>0 THEN NOT EXISTS(SELECT 1 FROM player_match_analysis WHERE run_id=? AND tracking_state<>'complete') ELSE 0 END,?,?,(SELECT SUM(minutes) FROM player_match_analysis WHERE run_id=?),?,COALESCE((SELECT SUM(minutes)>?+0.1 FROM player_match_analysis WHERE run_id=?),0),?,? WHERE $FENCE ON CONFLICT(app_team_id,team_season_id,event_id) DO UPDATE SET active_run=excluded.active_run,state=excluded.state,source_event_id=excluded.source_event_id,source_team_id=excluded.source_team_id,source_revision=excluded.source_revision,mutation_revision=excluded.mutation_revision,projected_at=excluded.projected_at,player_count=excluded.player_count,unresolved_goals=excluded.unresolved_goals,unresolved_assists=excluded.unresolved_assists,tracking_complete=excluded.tracking_complete,duration_minutes=excluded.duration_minutes,format=excluded.format,assigned_minutes=excluded.assigned_minutes,capacity_minutes=excluded.capacity_minutes,over_capacity=excluded.over_capacity,evidence=excluded.evidence,input_hash=excluded.input_hash`,params:[teamId,seasonId,eventId,run,baseState,run,+goalExcess,run,run,baseState,c.source?.id||null,c.source?.source_team_id||null,current.source,current.mutation,stamp(),run,Math.max(0,counts.goals-counts.credited_goals),Math.max(0,counts.assists-counts.credited_assists),run,run,c.duration??null,format,run,capacity,capacity,run,evidence,c.input]});
  statements.push({sql:'UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=? AND $FENCE',params:[teamId]});
  // Bounded garbage collection makes superseded immutable runs reclaimable.
  statements.push({sql:`DELETE FROM player_match_analysis WHERE rowid IN(SELECT p.rowid FROM player_match_analysis p LEFT JOIN match_analysis a ON a.active_run=p.run_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.event_id=? AND a.active_run IS NULL AND p.run_id<>? LIMIT 100) AND $FENCE`,params:[teamId,seasonId,eventId,run]});
  return {statements,checkpoint:{...checkpoint,finished:true},complete:true,coverage:baseState,rowsSaved:facts.length,publishContent:false};
}
