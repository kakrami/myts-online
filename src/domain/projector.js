import {assertControlTransactionBounds} from './team-game-control-witness.js';
import {teamGameBatchContextSQL,teamGameBatchFence,startTeamGameBatch,buildTeamGameBatchPage} from './team-game-projection-batch.js';
import {teamGameSemanticChange} from './team-game-projection-semantic.js';
import {sourceConsumerQuery} from './source-consumers.js';
import {buildPublicCorrespondences} from './correspondence.js';
import {prepareTeamGameProjection,stageTeamGameProjection,teamGameBuildFrame,teamGameFrameIdentity,teamGameFrameAssertion,addTeamGamePublicationAssertions,pinTeamGameAccepted,pruneTeamGameHistory} from './team-game-projection.js';
import {nativeCanonicalId} from './identity.js';
import {playerPresentation} from './presentation.js';
const parse=v=>typeof v==='string'?JSON.parse(v||'{}'):v||{};
const stamp=()=>new Date().toISOString();
const roots=`WITH roots AS(SELECT source_team_id AS id FROM team_source_attachments WHERE app_team_id=? AND team_season_id=? AND active=1),sources AS(SELECT id FROM roots UNION SELECT b FROM source_team_links WHERE a IN(SELECT id FROM roots) UNION SELECT a FROM source_team_links WHERE b IN(SELECT id FROM roots))`;
const SELECTED=`e.id IN(SELECT source_event_id FROM source_event_teams WHERE source_team_id IN(SELECT id FROM sources))`;
const nativeWindow=`(e.starts_at>=? AND e.starts_at<? OR e.local_day>=? AND e.local_day<? OR e.starts_at IS NULL AND e.local_day IS NULL)`;
const seasonWindow=s=>[`${new Date(Date.parse(s.start_day+'T00:00:00Z')-86400000).toISOString()}`,`${new Date(Date.parse(s.end_day+'T00:00:00Z')+86400000).toISOString()}`,s.start_day,s.end_day];
const pageSize=24;
const groups=(rows)=>{const m=new Map();for(const r of rows){if(!m.has(r.canonical_id))m.set(r.canonical_id,[]);m.get(r.canonical_id).push(r);}return m;};
function jsonInsert(add,table,rows,{conflict=null}={}) {
  if(!rows.length)return;
  const cols=Object.keys(rows[0]),update=cols.filter(c=>!['run_id','app_team_id','team_season_id','event_id','player_id'].includes(c)).map(c=>`${c}=excluded.${c}`).join(',');
  add(`INSERT INTO ${table}(${cols.join(',')}) SELECT ${cols.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE $FENCE${conflict?` ON CONFLICT(${conflict}) DO UPDATE SET ${update}`:''}`,JSON.stringify(rows));
}
function inputPrecondition(add,seasonId,revision,batch=null) {
  const fence=batch?teamGameBatchFence(batch):null;
  add(`INSERT INTO domain_team_preconditions SELECT 1,?,(SELECT CASE WHEN EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=p.app_team_id AND l.state IN('deleting','deleted'))${fence?' OR NOT('+fence.sql+')':" OR EXISTS(SELECT 1 FROM team_game_publish_batches b WHERE b.app_team_id=p.app_team_id AND b.state IN('preparing','ready') AND p.team_season_id IN(b.from_team_season_id,b.to_team_season_id))"} THEN -1 ELSE p.input_revision END FROM team_projection_state p WHERE p.team_season_id=?) WHERE $FENCE ON CONFLICT(id) DO UPDATE SET expected_input=excluded.expected_input,actual_input=excluded.actual_input`,revision,...(fence?.params??[]),seasonId);
}

/** One independently resumable page. Canonical/source rows are shared; only a
 * final pointer update makes a complete team-season projection visible. */
export async function buildProjectionPage(repo,teamId,seasonId,checkpoint={},options={}) {
  const context=await repo.db.prepare(`SELECT s.*,t.name team_name,t.timezone team_timezone,t.season_year,
    p.input_revision,p.published_input_revision,p.published_run_id,p.pending,p.projection_hash,r.content_revision,${teamGameBatchContextSQL} batch_json,
    EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id AND l.state IN('deleting','deleted')) removed,
    EXISTS(SELECT 1 FROM team_source_connections c WHERE c.app_team_id=t.id) connection_managed
    FROM app_teams t JOIN team_seasons s ON s.app_team_id=t.id AND s.id=COALESCE(?,(SELECT id FROM team_seasons WHERE app_team_id=t.id AND year=t.season_year))
    JOIN team_projection_state p ON p.app_team_id=t.id AND p.team_season_id=s.id JOIN team_read_state r ON r.app_team_id=t.id WHERE t.id=?`).bind(checkpoint.batchId??options.batch?.batch_id??null,seasonId??null,teamId).first();
  if(!context)throw Object.assign(new Error('Season is outside this team.'),{code:'source_scope',status:403});
  if(context.removed)throw Object.assign(new Error('Team removal is in progress.'),{code:'source_scope',status:409});
  const season=context,state=context,team={id:teamId,name:context.team_name,timezone:context.team_timezone,season_year:context.season_year,season_id:context.id};seasonId=context.id;
  if(context.batch_json&&!options.batch&&(checkpoint.batchId||[parse(context.batch_json).from_team_season_id,parse(context.batch_json).to_team_season_id].includes(seasonId)))return buildTeamGameBatchPage(repo,teamId,seasonId,checkpoint,context.batch_json,buildProjectionPage);
  const batch=options.batch??null,connectionManaged=!!season.connection_managed;
  const statements=[],add=(sql,...params)=>statements.push({sql,params}),affectedTeams=[];
  let cp={...checkpoint},revision=state.input_revision;
  const response=(complete=false,extra={})=>{assertControlTransactionBounds(statements,cp);return {statements,checkpoint:cp,complete,changed:false,recoveryRequired:true,revision:state.content_revision,input_revision:revision,affectedTeams,...extra};};
  if(cp.phase==='cleanup') {
    // Old runs may be deleted in bounded slices while a newer source revision is
    // already pending. The published pointer is protected in every delete.
    const obsolete=(await repo.db.prepare("SELECT id FROM team_projection_runs WHERE app_team_id=? AND team_season_id=? AND state='obsolete' AND id IS NOT (SELECT published_run_id FROM team_projection_state WHERE team_season_id=?) ORDER BY id LIMIT 1").bind(teamId,seasonId,seasonId).all()).results;
    if(!obsolete.length){if(await pruneTeamGameHistory(repo.db,add,teamId))return response(false,{recoveryRequired:false});cp={finished:true};return response(true);}
    const old=obsolete[0].id;
    const counts=await repo.db.prepare('SELECT (SELECT COUNT(*) FROM team_game_source_rows WHERE run_id=?) AS members,(SELECT COUNT(*) FROM team_game_publications WHERE run_id=?) AS publications,(SELECT COUNT(*) FROM team_event_rows WHERE run_id=?) AS events,(SELECT COUNT(*) FROM team_player_rows WHERE run_id=?) AS players').bind(old,old,old,old).first();
    if(counts.members)add('DELETE FROM team_game_source_rows WHERE rowid IN(SELECT rowid FROM team_game_source_rows WHERE run_id=? LIMIT 200) AND run_id IS NOT (SELECT published_run_id FROM team_projection_state WHERE team_season_id=?) AND $FENCE',old,seasonId);
    else if(counts.publications)add('DELETE FROM team_game_publications WHERE rowid IN(SELECT rowid FROM team_game_publications WHERE run_id=? LIMIT 100) AND run_id IS NOT (SELECT published_run_id FROM team_projection_state WHERE team_season_id=?) AND $FENCE',old,seasonId);
    else if(counts.events)add('DELETE FROM team_event_rows WHERE rowid IN(SELECT rowid FROM team_event_rows WHERE run_id=? LIMIT 200) AND run_id IS NOT (SELECT published_run_id FROM team_projection_state WHERE team_season_id=?) AND $FENCE',old,seasonId);
    else if(counts.players)add('DELETE FROM team_player_rows WHERE rowid IN(SELECT rowid FROM team_player_rows WHERE run_id=? LIMIT 200) AND run_id IS NOT (SELECT published_run_id FROM team_projection_state WHERE team_season_id=?) AND $FENCE',old,seasonId);
    else {add("UPDATE team_game_publish_batches SET state='obsolete',from_build_run_id=NULL,to_build_run_id=NULL,from_expected_run_id=NULL,to_expected_run_id=NULL WHERE state IN('published','obsolete') AND ? IN(from_build_run_id,to_build_run_id,from_expected_run_id,to_expected_run_id) AND $FENCE",old);add("DELETE FROM team_projection_runs WHERE id=? AND state='obsolete' AND id IS NOT (SELECT published_run_id FROM team_projection_state WHERE team_season_id=?) AND $FENCE",old,seasonId);}
    return response(false,{recoveryRequired:false});
  }
  if(!cp.runId&&state.pending===0&&state.published_input_revision===revision){cp={phase:'cleanup'};return response();}
  let run=cp.runId?await repo.db.prepare('SELECT * FROM team_projection_runs WHERE id=? AND app_team_id=? AND team_season_id=?').bind(cp.runId,teamId,seasonId).first():null;
  if(run?.state==='published'&&state.published_run_id===run.id&&run.input_revision===revision){cp={...cp,phase:'cleanup',published:true};return response(false,{recoveryRequired:false});}
  if(!run||run.team_game_version!==1||run.input_revision!==revision||run.state!=='building') {
    inputPrecondition(add,seasonId,revision,batch);
    if(run?.state==='building')add("UPDATE team_projection_runs SET state='obsolete' WHERE id=? AND $FENCE",run.id);
    cp={runId:crypto.randomUUID(),inputRevision:revision,phase:'identity',cursor:'',...(cp.holdMoves?{holdMoves:cp.holdMoves}:{})};
    add("UPDATE team_projection_runs SET state='obsolete' WHERE app_team_id=? AND team_season_id=? AND state='building' AND $FENCE",teamId,seasonId);
    add("INSERT INTO team_projection_runs(id,app_team_id,team_season_id,input_revision,state,created_at,team_game_version) SELECT ?,?,?,?,'building',?,1 WHERE $FENCE",cp.runId,teamId,seasonId,revision,stamp());
    return response();
  }
  inputPrecondition(add,seasonId,revision,batch);
  if(cp.phase==='move_prepare')return startTeamGameBatch(repo,team,season,state,cp,statements);
  if(cp.phase==='identity') {
    // Include all public fixtures in relevant divisions for stable all-category
    // identities, while private resources stay limited to attached source teams.
    const selected=`${roots},divisions AS(SELECT DISTINCT e.division_key AS id FROM source_events e WHERE ${SELECTED} AND ${nativeWindow} AND e.division_key IS NOT NULL),page AS(SELECT e.*,l.event_id AS canonical_id FROM source_events e LEFT JOIN event_source_links l ON l.source_event_id=e.id WHERE e.id>? AND (${SELECTED} OR e.provider IN('gotsport','live') AND e.division_key IN(SELECT id FROM divisions)) AND ${nativeWindow} ORDER BY e.id LIMIT ${pageSize}),bounded AS(SELECT *,SUM(length(CAST(evidence AS BLOB))) OVER(ORDER BY id) AS byte_count FROM page) SELECT * FROM bounded WHERE byte_count<=1000000`;
    const page=(await repo.db.prepare(selected).bind(teamId,seasonId,...seasonWindow(season),cp.cursor||'',...seasonWindow(season)).all()).results;
    if(!page.length){cp={...cp,phase:'events',cursor:''};return response();}
    const numbers=[...new Set(page.filter(e=>e.provider==='gotsport'||e.provider==='live').map(e=>e.match_number).filter(Boolean))];
    let combined=page;
    if(numbers.length) {
      const compIds=[...new Set(page.filter(e=>e.competition_key).map(e=>e.competition_key))];
      const counterparts=(await repo.db.prepare(`SELECT e.*,l.event_id AS canonical_id FROM source_events e JOIN source_competitions c ON e.competition_key=c.id LEFT JOIN event_source_links l ON l.source_event_id=e.id WHERE e.provider IN('gotsport','live') AND e.match_number IN(SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM source_competitions p WHERE p.id IN(SELECT value FROM json_each(?)) AND p.name=c.name AND p.starts_on=c.starts_on AND p.ends_on=c.ends_on AND p.website_domain=c.website_domain AND p.season_year=c.season_year) ORDER BY e.id LIMIT 97`).bind(JSON.stringify(numbers),JSON.stringify(compIds)).all()).results;
      if(counterparts.length<97)combined=[...new Map([...page,...counterparts].map(e=>[e.id,e])).values()];
    }
    const proof=await buildPublicCorrespondences(repo,combined),assigned=new Map(combined.map(e=>[e.id,e.canonical_id])),aliases=[],pairs=[];
    const otherIds=[...new Set(proof.matches.flatMap(p=>[assigned.get(p.a),assigned.get(p.b)]).filter(Boolean))];
    const conflicts=otherIds.length?(await repo.db.prepare("SELECT DISTINCT entity_id FROM domain_overrides WHERE kind='event' AND entity_id IN(SELECT value FROM json_each(?))").bind(JSON.stringify(otherIds)).all()).results.map(r=>r.entity_id):[];
    for(const match of proof.matches) {
      const canonical=assigned.get(match.a)||assigned.get(match.b)||await nativeCanonicalId('event',match.a),other=assigned.get(match.b);
      if(other&&other!==canonical&&conflicts.includes(other))continue;
      if(other&&other!==canonical)aliases.push({merged_id:other,canonical_id:canonical});
      if(match.changed||assigned.get(match.a)!==assigned.get(match.b))pairs.push({...match,canonical_id:canonical});
      assigned.set(match.a,canonical);assigned.set(match.b,canonical);
    }
    const identities=[];
    for(const e of combined)if(!e.canonical_id&&!pairs.some(p=>[p.a,p.b].includes(e.id)))identities.push({id:await nativeCanonicalId('event',e.id),source_id:e.id});
    for(const pair of pairs)if(!combined.find(e=>e.id===pair.a)?.canonical_id&&!combined.find(e=>e.id===pair.b)?.canonical_id)identities.push({id:pair.canonical_id,source_id:pair.a});
    if(identities.length) {
      add("INSERT OR IGNORE INTO events SELECT json_extract(value,'$.id'),? FROM json_each(?) WHERE $FENCE",stamp(),JSON.stringify(identities));
      add("INSERT OR IGNORE INTO event_source_links(source_event_id,event_id,reason,evidence) SELECT json_extract(value,'$.source_id'),json_extract(value,'$.id'),'source_identity','{}' FROM json_each(?) WHERE $FENCE",JSON.stringify(identities));
    }
    if(aliases.length){add("INSERT INTO event_aliases SELECT json_extract(value,'$.merged_id'),json_extract(value,'$.canonical_id') FROM json_each(?) WHERE $FENCE ON CONFLICT(merged_id) DO UPDATE SET canonical_id=excluded.canonical_id",JSON.stringify(aliases));add("UPDATE event_source_links SET event_id=(SELECT json_extract(value,'$.canonical_id') FROM json_each(?) WHERE json_extract(value,'$.merged_id')=event_source_links.event_id),revision=revision+1 WHERE event_id IN(SELECT json_extract(value,'$.merged_id') FROM json_each(?)) AND $FENCE",JSON.stringify(aliases),JSON.stringify(aliases));}
    if(pairs.length) {
      add("INSERT INTO source_event_correspondences SELECT json_extract(value,'$.a'),json_extract(value,'$.b'),json_extract(value,'$.method'),json_extract(value,'$.proof'),json_extract(value,'$.verified_at'),'verified' FROM json_each(?) WHERE $FENCE ON CONFLICT(a) DO UPDATE SET status='verified',proof=excluded.proof",JSON.stringify(pairs));
      for(const side of ['a','b'])add(`INSERT INTO event_source_links(source_event_id,event_id,reason,evidence) SELECT json_extract(value,'$.${side}'),json_extract(value,'$.canonical_id'),'strict_composite',json_extract(value,'$.proof') FROM json_each(?) WHERE $FENCE ON CONFLICT(source_event_id) DO UPDATE SET event_id=excluded.event_id,reason=excluded.reason,evidence=excluded.evidence,revision=event_source_links.revision+1`,JSON.stringify(pairs));
      const ids=[...new Set(pairs.flatMap(p=>[p.a,p.b]))];
      const demand=sourceConsumerQuery({genericIds:[],playerIds:[],eventFacts:[],eventIds:ids,divisionIds:[],competitionIds:[],links:[]});
      const consumers=(await repo.db.prepare(demand.sql+' ORDER BY (c.team_season_id=?) DESC,c.app_team_id,c.team_season_id LIMIT 128').bind(...demand.params,seasonId).all()).results;
      add(`UPDATE team_projection_state SET input_revision=input_revision+1,pending=1 WHERE team_season_id IN(SELECT team_season_id FROM(${demand.sql})) AND $FENCE`,...demand.params);
      add(`UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id IN(SELECT app_team_id FROM(${demand.sql})) AND $FENCE`,...demand.params);
      if(consumers.some(c=>c.team_season_id===seasonId)){revision++;add('UPDATE team_projection_runs SET input_revision=? WHERE id=? AND $FENCE',revision,cp.runId);}
      affectedTeams.push(...consumers.filter(c=>c.team_season_id!==seasonId));
      const divisions=[...new Set(pairs.flatMap(p=>p.division_refs))];if(divisions.length)add('UPDATE source_division_coverage SET content_revision=content_revision+1 WHERE source_division_id IN(SELECT value FROM json_each(?)) AND $FENCE',JSON.stringify(divisions));
    }
    for(const kind of ['competition','division']) {
      const newly=kind==='competition'?proof.newCompetitions:proof.newDivisions;if(newly.length)add(`INSERT OR IGNORE INTO ${kind==='competition'?'competitions':'divisions'} SELECT value,? FROM json_each(?) WHERE $FENCE`,stamp(),JSON.stringify(newly));
      const links=proof.metadataLinks.filter(l=>l.kind===kind),merged=proof.metadataAliases.filter(l=>l.kind===kind);
      if(merged.length)add(`INSERT INTO ${kind}_aliases SELECT json_extract(value,'$.merged_id'),json_extract(value,'$.canonical_id') FROM json_each(?) WHERE $FENCE ON CONFLICT(merged_id) DO UPDATE SET canonical_id=excluded.canonical_id`,JSON.stringify(merged));
      if(links.length)add(`INSERT INTO ${kind}_source_links SELECT json_extract(value,'$.source_id'),json_extract(value,'$.id'),json_extract(value,'$.reason'),json_extract(value,'$.evidence') FROM json_each(?) WHERE $FENCE ON CONFLICT(source_${kind}_id) DO UPDATE SET ${kind}_id=excluded.${kind}_id,reason=excluded.reason,evidence=excluded.evidence`,JSON.stringify(links));
    }
    if(proof.reviews.length)add("UPDATE source_event_correspondences SET status='review',proof=(SELECT json_extract(value,'$.proof') FROM json_each(?) WHERE json_extract(value,'$.a')=source_event_correspondences.a) WHERE a IN(SELECT json_extract(value,'$.a') FROM json_each(?)) AND $FENCE",JSON.stringify(proof.reviews),JSON.stringify(proof.reviews));
    if(pairs.length||aliases.length||proof.reviews.length){const ids=[...new Set([...pairs.flatMap(p=>[p.a,p.b]),...proof.reviews.flatMap(p=>[p.a,p.b])])];add('UPDATE domain_installation SET mutation_revision=mutation_revision+1,public_revision=public_revision+1 WHERE id=1 AND $FENCE');if(ids.length)add("INSERT INTO source_event_state SELECT value,1 FROM json_each(?) WHERE $FENCE ON CONFLICT(source_event_id) DO UPDATE SET input_revision=source_event_state.input_revision+1",JSON.stringify(ids));const divisions=[...new Set(combined.filter(e=>ids.includes(e.id)&&e.division_key).map(e=>e.division_key))];if(divisions.length)add('UPDATE source_division_coverage SET content_revision=content_revision+1 WHERE source_division_id IN(SELECT value FROM json_each(?)) AND $FENCE',JSON.stringify(divisions));}
    cp={...cp,inputRevision:revision,cursor:page.at(-1).id};return response();
  }
  if(cp.phase==='players') {
    const relation=connectionManaged?`p.id IN(SELECT e.source_player_id FROM connection_roster_evidence e JOIN team_source_connections r ON r.id=e.connection_id JOIN team_connection_seasons m ON m.connection_id=r.id AND m.team_season_id=e.team_season_id WHERE r.app_team_id=? AND r.active=1 AND m.active=1 AND m.excluded=0 AND e.team_season_id=? AND (e.basis<>'dated_roster' OR e.certainty='verified'))`:`p.id IN(SELECT source_player_id FROM source_roster_memberships WHERE source_team_id IN(SELECT id FROM sources) AND active=1) OR p.id IN(SELECT m.source_player_id FROM source_game_members m JOIN source_events e ON e.id=m.source_event_id JOIN source_event_teams t ON t.source_event_id=e.id AND t.source_team_id=m.source_team_id AND t.side=m.side WHERE m.source_team_id IN(SELECT id FROM sources) AND m.dummy=0 AND EXISTS(SELECT 1 FROM team_game_source_rows tr WHERE tr.run_id=? AND tr.source_event_id=e.id))`;
    const evidenceColumn=column=>`(SELECT ${column==='authority'?"CASE WHEN evidence.certainty='verified' THEN 0 WHEN evidence.basis='accepted_projection' THEN 1 WHEN evidence.basis='imported_snapshot' THEN 2 ELSE 3 END":'evidence.'+column} FROM connection_roster_evidence evidence JOIN team_source_connections cr ON cr.id=evidence.connection_id JOIN team_connection_seasons cm ON cm.connection_id=cr.id AND cm.team_season_id=evidence.team_season_id WHERE evidence.source_player_id=p.id AND evidence.team_season_id=? AND cr.app_team_id=? AND cr.active=1 AND cm.active=1 AND cm.excluded=0 AND (evidence.basis<>'dated_roster' OR evidence.certainty='verified') ORDER BY CASE WHEN evidence.certainty='verified' THEN CASE evidence.basis WHEN 'game' THEN 0 WHEN 'dated_roster' THEN 1 ELSE 2 END WHEN evidence.basis='accepted_projection' THEN 3 WHEN evidence.basis='imported_snapshot' THEN 4 ELSE 5 END,evidence.observed_at DESC,evidence.basis_key LIMIT 1)`;
    const playerColumns=connectionManaged?`p.id,p.provider,p.scope,${evidenceColumn('authority')} AS roster_authority,${evidenceColumn('name')} AS name,${evidenceColumn('jersey')} AS jersey,l.player_id AS canonical_id`:'p.id,p.provider,p.scope,p.name,p.jersey,l.player_id AS canonical_id';
    const columnParams=connectionManaged?[seasonId,teamId,seasonId,teamId,seasonId,teamId]:[],relationParams=connectionManaged?[teamId,seasonId]:[cp.runId];
    const page=(await repo.db.prepare(`${roots} SELECT ${playerColumns} FROM source_players p LEFT JOIN player_source_links l ON l.source_player_id=p.id WHERE p.id>? AND (${relation}) ORDER BY p.id LIMIT ${pageSize}`).bind(teamId,seasonId,...columnParams,cp.cursor||'',...relationParams).all()).results;
    if(!page.length){cp={...cp,phase:'publish',cursor:''};return response(false,{recoveryRequired:false});}
    const missing=await Promise.all(page.filter(p=>!p.canonical_id).map(async p=>({source_id:p.id,id:await nativeCanonicalId('player',p.id)})));
    if(missing.length){add("INSERT OR IGNORE INTO players SELECT json_extract(value,'$.id'),? FROM json_each(?) WHERE $FENCE",stamp(),JSON.stringify(missing));add("INSERT OR IGNORE INTO player_source_links(source_player_id,player_id,reason,evidence) SELECT json_extract(value,'$.source_id'),json_extract(value,'$.id'),'source_identity','{}' FROM json_each(?) WHERE $FENCE",JSON.stringify(missing));for(const p of page)if(!p.canonical_id)p.canonical_id=missing.find(m=>m.source_id===p.id).id;}
    const existingIds=page.filter(p=>!missing.some(m=>m.source_id===p.id)).map(p=>p.canonical_id);
    const peers=existingIds.length?(await repo.db.prepare(`${roots} SELECT ${playerColumns} FROM source_players p JOIN player_source_links l ON l.source_player_id=p.id WHERE l.player_id IN(SELECT value FROM json_each(?)) AND (${relation}) ORDER BY p.id`).bind(teamId,seasonId,...columnParams,JSON.stringify(existingIds),...relationParams).all()).results:[];
    const combined=[...new Map([...page,...peers].map(p=>[p.id,p])).values()],canonical=[...new Set(combined.map(p=>p.canonical_id))];
    const corrections=(await repo.db.prepare("SELECT entity_id,fields FROM domain_overrides WHERE app_team_id=? AND kind='player' AND entity_id IN(SELECT value FROM json_each(?))").bind(teamId,JSON.stringify(canonical)).all()).results,overrides=new Map(corrections.map(r=>[r.entity_id,parse(r.fields)]));
    const rows=[...groups(combined)].map(([playerId,sources])=>({run_id:cp.runId,...playerPresentation(teamId,seasonId,playerId,sources,overrides.get(playerId)||{})}));
    jsonInsert(add,'team_player_rows',rows,{conflict:'run_id,app_team_id,team_season_id,player_id'});
    // Existing player identities only update this unpublished run. New
    // identities keep conservative recovery, like correspondence pages.
    cp={...cp,cursor:page.at(-1).id};return response(false,{recoveryRequired:missing.length!==0});
  }
  if(cp.phase==='events') {
    // Re-evaluate old receipt-pressure sizing once, without discarding progress.
    if(cp.gamePagePolicy!==2)cp={...cp,gamePagePolicy:2,gamePageSize:pageSize};
    const retained=`SELECT a.target_event_id AS id FROM team_game_associations a JOIN team_game_decision_revisions d ON d.app_team_id=a.app_team_id AND d.association_id=a.association_id AND d.revision=a.accepted_revision WHERE a.app_team_id=? AND d.team_season_id=? AND a.target_event_id>?`;
    const page=connectionManaged?(await repo.db.prepare(`${roots} SELECT DISTINCT c.canonical_id AS id FROM source_events e JOIN event_source_links l ON l.source_event_id=e.id JOIN canonical_event_ids c ON c.input_id=l.event_id JOIN team_event_season_resolutions resolution ON resolution.event_id=c.canonical_id AND resolution.app_team_id=? AND resolution.team_season_id=? WHERE ${SELECTED} AND c.canonical_id>? UNION ${retained} ORDER BY id LIMIT ${cp.gamePageSize??pageSize}`).bind(teamId,seasonId,teamId,seasonId,cp.cursor||'',teamId,seasonId,cp.cursor||'').all()).results:(await repo.db.prepare(`${roots} SELECT DISTINCT l.event_id AS id FROM source_events e JOIN event_source_links l ON l.source_event_id=e.id WHERE ${SELECTED} AND (${nativeWindow} OR EXISTS(SELECT 1 FROM domain_overrides o WHERE o.app_team_id=? AND o.kind='event' AND o.entity_id=l.event_id)) AND l.event_id>? UNION ${retained} ORDER BY id LIMIT ${cp.gamePageSize??pageSize}`).bind(teamId,seasonId,...seasonWindow(season),teamId,cp.cursor||'',teamId,seasonId,cp.cursor||'').all()).results;

    if(!page.length){cp={...cp,phase:'players',cursor:''};return response(false,{recoveryRequired:false});}
    let frame=await teamGameBuildFrame(repo.db,teamId,seasonId,cp.runId,batch);const frameIdentity=await teamGameFrameIdentity(frame);
    if(frame.saved_valid!==1||cp.gameFrame&&cp.gameFrame!==frameIdentity) {
      add("UPDATE team_projection_runs SET state='obsolete' WHERE id=? AND $FENCE",cp.runId);
      cp={};return response(false,{recoveryRequired:false});
    }
    cp={...cp,gameFrame:frameIdentity};
    // The requested native page bounds output only. The adapter loads every
    // reciprocal neighbor before deciding, even beyond this cursor/page.
    let selected=page,prepared;
    try{prepared=await prepareTeamGameProjection(repo.db,{team,season,runId:cp.runId,ids:selected.map(e=>e.id),batch,holdMoves:cp.holdMoves,frame,acceptedControls:cp.acceptedControls});}
    catch(error){if(error.code==='team_game_projection_changed'){add("UPDATE team_projection_runs SET state='obsolete' WHERE id=? AND $FENCE",cp.runId);cp={};return response(false,{recoveryRequired:false});}if(error.code!=='team_game_native_bound'||selected.length===1)throw error;prepared={smallerPage:true};}
    if(prepared.refreshFrame){frame=await teamGameBuildFrame(repo.db,teamId,seasonId,cp.runId,batch);if(frame.saved_valid!==1||cp.gameFrame!==await teamGameFrameIdentity(frame)){add("UPDATE team_projection_runs SET state='obsolete' WHERE id=? AND $FENCE",cp.runId);cp={};return response(false,{recoveryRequired:false});}prepared.controlSnapshot=frame.controlSnapshot;}
    teamGameFrameAssertion(add,teamId,seasonId,frame);
    if(prepared.deferred){addTeamGamePublicationAssertions(add,teamId,cp.runId,batch,prepared.controlSnapshot??frame.controlSnapshot);return response(false,{recoveryRequired:false,projectionDeferred:'source_evidence'});}
    if(prepared.smallerPage){cp={...cp,gamePageSize:Math.max(1,Math.floor(selected.length/2))};return response(false,{recoveryRequired:false});}
    if(prepared.moves.length){cp={...cp,phase:'move_prepare',move:{...prepared.moves.sort((a,b)=>a.association_id.localeCompare(b.association_id))[0],source_revision:frame.source_revision,mutation_revision:frame.mutation_revision}};return response(false,{recoveryRequired:false});}
    stageTeamGameProjection(add,prepared,teamId,cp.runId,batch);
    cp={...cp,cursor:selected.at(-1).id,deferredMoves:cp.deferredMoves||prepared.deferredMoves,...(prepared.acceptedControls?{acceptedControls:prepared.acceptedControls}:{})};return response(false,{recoveryRequired:false,deferredMoves:cp.deferredMoves});
  }

  if(cp.phase==='publish') {
    const frame=await teamGameBuildFrame(repo.db,teamId,seasonId,cp.runId,batch),frameIdentity=await teamGameFrameIdentity(frame);
    if(frame.saved_valid!==1||cp.gameFrame&&cp.gameFrame!==frameIdentity){add("UPDATE team_projection_runs SET state='obsolete' WHERE id=? AND $FENCE",cp.runId);cp={};return response(false,{recoveryRequired:false});}
    cp={...cp,gameFrame:frameIdentity};
    if(batch)return response(false,{batchReady:true,recoveryRequired:false,deferredMoves:cp.deferredMoves});
    const changed=await teamGameSemanticChange(repo.db,teamId,seasonId,cp.runId,state.published_run_id);
    teamGameFrameAssertion(add,teamId,seasonId,frame);
    addTeamGamePublicationAssertions(add,teamId,cp.runId,null,frame.controlSnapshot);
    add("UPDATE team_projection_runs SET state='obsolete' WHERE app_team_id=? AND team_season_id=? AND state='published' AND id<>? AND $FENCE",teamId,seasonId,cp.runId);
    add("UPDATE team_projection_runs SET state='published' WHERE id=? AND state='building' AND input_revision=? AND $FENCE",cp.runId,revision);
    add('UPDATE team_projection_state SET published_run_id=?,published_input_revision=?,pending=0,projection_hash=? WHERE team_season_id=? AND input_revision=? AND $FENCE',cp.runId,revision,changed?`input:${revision}`:state.projection_hash,seasonId,revision);
    pinTeamGameAccepted(add,teamId,cp.runId);
    add('UPDATE team_read_state SET content_revision=content_revision+?,pending=EXISTS(SELECT 1 FROM team_projection_state WHERE app_team_id=? AND pending=1) OR EXISTS(SELECT 1 FROM team_source_connections WHERE app_team_id=? AND active=1 AND input_revision>reconciled_revision) WHERE app_team_id=? AND $FENCE',changed?1:0,teamId,teamId,teamId);
    cp={...cp,phase:'cleanup',published:true};return response(false,{changed,published:true,revision:state.content_revision+(changed?1:0)});
  }
  throw Object.assign(new Error('Unknown projection checkpoint.'),{code:'invalid_checkpoint',status:400});
}
