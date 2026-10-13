import {nativeCanonicalId} from './identity.js';
import {buildConnectionEventBatch,readConnectionEventChanges} from './connection-event-batch.js';
import {localMidnight} from './calendar.js';
import {resolveEventDate,datedPeriodYears,qualifiedRosterPeriod,observedDay} from './connection-evidence.js';
import {prepareGameSeasonMove} from './game-season-state.js';
import {membershipPeriodJoins} from './connection-periods.js';

const parse=value=>typeof value==='string'?JSON.parse(value||'{}'):value||{};
const now=()=>new Date().toISOString();
const fail=(message,code='stale_generation')=>Object.assign(new Error(message),{code,status:409});
const sources=`WITH sources AS(SELECT source_team_id AS id FROM team_source_connections WHERE id=? UNION SELECT l.b FROM source_team_links l JOIN team_source_connections r ON r.source_team_id=l.a WHERE r.id=? UNION SELECT l.a FROM source_team_links l JOIN team_source_connections r ON r.source_team_id=l.b WHERE r.id=?)`;
const rootParams=id=>[id,id,id];
const teamSources=`WITH roots AS(SELECT source_team_id FROM team_source_connections WHERE app_team_id=? AND active=1),sources AS(SELECT source_team_id AS id FROM roots UNION SELECT b FROM source_team_links WHERE a IN(SELECT source_team_id FROM roots) UNION SELECT a FROM source_team_links WHERE b IN(SELECT source_team_id FROM roots))`;
function jsonWrite(add,table,rows,keys){
  if(!rows.length)return;const columns=Object.keys(rows[0]);
  add(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map(column=>`json_extract(value,'$.${column}')`).join(',')} FROM json_each(?) WHERE $FENCE ON CONFLICT(${keys.join(',')}) DO UPDATE SET ${columns.filter(column=>!keys.includes(column)).map(column=>`${column}=excluded.${column}`).join(',')}`,JSON.stringify(rows));
}
function rootCondition(root){return {sql:`EXISTS(SELECT 1 FROM team_source_connections r JOIN app_teams t ON t.id=r.app_team_id WHERE r.id=? AND r.app_team_id=? AND r.active=1 AND r.generation=? AND r.input_revision=? AND t.timezone=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id) AND ((r.scope_mode='fixed_seasons' AND EXISTS(SELECT 1 FROM source_teams source WHERE source.id=r.source_team_id AND source.provenance='file_import')) OR r.account_id IS NULL OR EXISTS(SELECT 1 FROM provider_accounts a WHERE a.id=r.account_id AND a.generation=?)))`,params:[root.id,root.app_team_id,root.generation,root.input_revision,root.timezone,root.account_generation]};}
function assertion(add,condition){add(`INSERT INTO domain_team_preconditions(id,expected_input,actual_input) SELECT 1,1,CASE WHEN ${condition.sql} THEN 1 ELSE 0 END WHERE $FENCE ON CONFLICT(id) DO UPDATE SET expected_input=excluded.expected_input,actual_input=excluded.actual_input`,...condition.params);}
async function seasonPlan(db,root,year,add,cached){
  const saved=cached!==undefined?cached:await db.prepare('SELECT * FROM team_seasons WHERE app_team_id=? AND year=?').bind(root.app_team_id,year).first();if(saved)return saved;
  const id=await nativeCanonicalId('team-season',`${root.app_team_id}:${year}`),start=`${year}-06-01`,end=`${year+1}-06-01`;
  add('INSERT OR IGNORE INTO team_seasons(id,app_team_id,year,start_day,end_day,start_at,end_at,include_june) SELECT ?,?,?,?,?,?,?,0 WHERE $FENCE',id,root.app_team_id,year,start,end,localMidnight(start,root.timezone),localMidnight(end,root.timezone));
  add('INSERT OR IGNORE INTO team_projection_state(team_season_id,app_team_id) SELECT ?,? WHERE $FENCE',id,root.app_team_id);
  // season_year=0 is an explicitly unset navigation preference, not a season.
  add('UPDATE app_teams SET season_year=? WHERE id=? AND season_year=0 AND $FENCE',year,root.app_team_id);
  return null;
}
async function membershipPlan(db,root,season,basis,add,cached){
  const member=cached!==undefined?cached:await db.prepare('SELECT m.*,a.active AS attachment_active,a.generation AS attachment_generation FROM team_connection_seasons m LEFT JOIN team_source_attachments a ON a.id=m.attachment_id WHERE m.connection_id=? AND m.team_season_id=?').bind(root.id,season.id).first();
  if(member?.excluded||root.scope_mode==='fixed_seasons'&&(!member||!member.active))return false;
  if(member?.active===1&&member.generation===root.generation&&member.attachment_active===1&&member.attachment_generation===root.generation)return true;
  const attachmentId=member?.attachment_id||await nativeCanonicalId('connection-season',`${root.id}:${season.id}`);
  add('INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id,account_id,active,generation) SELECT ?,?,?,?,?,1,? WHERE $FENCE ON CONFLICT(app_team_id,team_season_id,source_team_id) DO UPDATE SET active=1,generation=excluded.generation',attachmentId,root.app_team_id,season.id,root.source_team_id,root.account_id,root.generation);
  add(`INSERT INTO team_connection_seasons(connection_id,team_season_id,attachment_id,basis,active,excluded,generation) SELECT ?,?,(SELECT id FROM team_source_attachments WHERE app_team_id=? AND team_season_id=? AND source_team_id=?),?,1,0,? WHERE $FENCE ON CONFLICT(connection_id,team_season_id) DO UPDATE SET attachment_id=excluded.attachment_id,active=1,generation=excluded.generation`,root.id,season.id,root.app_team_id,season.id,root.source_team_id,basis,root.generation);
  return true;
}
function dirtySeasons(add,teamId,ids){
  ids=[...new Set(ids.filter(Boolean))];if(!ids.length)return;
  add('UPDATE team_projection_state SET input_revision=input_revision+1,pending=1 WHERE app_team_id=? AND team_season_id IN(SELECT value FROM json_each(?)) AND $FENCE',teamId,JSON.stringify(ids));
  add('UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id=? AND $FENCE',teamId);
}

/** One root page; observation history is never fetched again merely to derive
 * seasons. Every page carries root/account/input fences in the same transaction
 * as canonical membership, roster evidence and downstream projection dirtiness. */
export async function buildConnectionPage(db,{connectionId,teamId,generation,checkpoint={}}){
  const root=await db.prepare(`SELECT r.*,${checkpoint.phase==='events'?`EXISTS(SELECT 1 FROM event_aliases alias CROSS JOIN event_source_links link ON link.event_id=alias.merged_id JOIN source_event_teams owned ON owned.source_event_id=link.source_event_id WHERE owned.source_team_id=r.source_team_id OR EXISTS(SELECT 1 FROM source_team_links peer WHERE (peer.a=r.source_team_id AND peer.b=owned.source_team_id) OR(peer.b=r.source_team_id AND peer.a=owned.source_team_id)))`:'0'} AS has_event_aliases,t.timezone,s.evidence,s.provenance,a.generation AS account_generation,a.active AS account_active FROM team_source_connections r JOIN app_teams t ON t.id=r.app_team_id JOIN source_teams s ON s.id=r.source_team_id LEFT JOIN provider_accounts a ON a.id=r.account_id WHERE r.id=? AND r.app_team_id=? AND r.active=1 AND r.generation=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id)`).bind(connectionId,teamId,generation).first();
  if(!root)throw fail('This connection or its authorization has changed.');
  const newPass=()=>({phase:'boundaries',after:'',inputRevision:root.input_revision,passRevision:root.input_revision,generation:root.generation,timezone:root.timezone});
  let cp=checkpoint.generation===root.generation&&checkpoint.timezone===root.timezone&&checkpoint.phase?{...checkpoint}:newPass();
  cp.passRevision??=cp.inputRevision;cp.inputRevision=root.input_revision;
  const statements=[],add=(sql,...params)=>statements.push({sql,params}),affectedTeams=[];
  const response=(complete=false)=>({statements,checkpoint:cp,complete,coverage:complete?'complete':'partial',publishContent:false,affectedTeams});
  assertion(add,rootCondition(root));
  if(cp.phase==='boundaries'){
    const rows=(await db.prepare('SELECT * FROM team_seasons WHERE app_team_id=? AND id>? ORDER BY id LIMIT 24').bind(teamId,cp.after).all()).results;
    const changed=rows.map(season=>({...season,start_at:localMidnight(season.start_day,root.timezone),end_at:localMidnight(season.end_day,root.timezone)})).filter((season,index)=>season.start_at!==rows[index].start_at||season.end_at!==rows[index].end_at);
    if(changed.length){add("UPDATE team_seasons SET start_at=(SELECT json_extract(value,'$.start_at') FROM json_each(?) WHERE json_extract(value,'$.id')=team_seasons.id),end_at=(SELECT json_extract(value,'$.end_at') FROM json_each(?) WHERE json_extract(value,'$.id')=team_seasons.id) WHERE app_team_id=? AND id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND $FENCE",JSON.stringify(changed),JSON.stringify(changed),teamId,JSON.stringify(changed));dirtySeasons(add,teamId,changed.map(season=>season.id));}
    cp=rows.length?{...cp,after:rows.at(-1).id}:{...cp,phase:'identity',after:''};return response();
  }
  if(cp.phase==='identity'){
    const events=(await db.prepare(`${sources} SELECT DISTINCT e.id,l.event_id FROM source_events e JOIN source_event_teams st ON st.source_event_id=e.id LEFT JOIN event_source_links l ON l.source_event_id=e.id WHERE st.source_team_id IN(SELECT id FROM sources) AND e.id>? ORDER BY e.id LIMIT 24`).bind(...rootParams(connectionId),cp.after).all()).results;
    const missing=await Promise.all(events.filter(event=>!event.event_id).map(async event=>({source_id:event.id,id:await nativeCanonicalId('event',event.id)})));
    if(missing.length){add("INSERT OR IGNORE INTO events SELECT json_extract(value,'$.id'),? FROM json_each(?) WHERE $FENCE",now(),JSON.stringify(missing));add("INSERT OR IGNORE INTO event_source_links(source_event_id,event_id,reason,evidence) SELECT json_extract(value,'$.source_id'),json_extract(value,'$.id'),'source_identity','{}' FROM json_each(?) WHERE $FENCE",JSON.stringify(missing));}
    cp=events.length?{...cp,after:events.at(-1).id}:{...cp,phase:'native_period',after:0};return response();
  }
  if(cp.phase==='native_period'){
    const native=parse(root.evidence),years=datedPeriodYears(native.season_start_date,native.season_end_date);
    if(root.scope_mode==='observed_history'&&cp.after<years.length){
      const year=years[cp.after],season=await seasonPlan(db,root,year,add);if(!season)return response();
      const beforeMembership=statements.length;if(await membershipPlan(db,root,season,'dated_metadata',add)&&statements.length>beforeMembership){dirtySeasons(add,teamId,[season.id]);affectedTeams.push({app_team_id:teamId,team_season_id:season.id});}
      cp={...cp,after:cp.after+1};return response();
    }
    cp={...cp,phase:'periods',after:''};return response();
  }
  if(cp.phase==='periods'){
    // Competition memberships are independently cursorable; a team may have
    // hundreds of registrations. A large history is not silently discarded.
    if(!cp.period){
      const period=await db.prepare(`${sources} SELECT m.id,c.starts_on,c.ends_on FROM source_competition_memberships m ${membershipPeriodJoins()} WHERE m.source_team_id IN(SELECT id FROM sources) AND m.id>? ORDER BY m.id LIMIT 1`).bind(...rootParams(connectionId),typeof cp.after==='string'?cp.after:'').first();
      if(!period){cp={...cp,phase:'events',after:''};return response();}
      cp={...cp,period:period.id,years:datedPeriodYears(period.starts_on,period.ends_on),yearIndex:0};
    }
    if(root.scope_mode==='observed_history'&&cp.yearIndex<cp.years.length){
      const year=cp.years[cp.yearIndex],season=await seasonPlan(db,root,year,add);if(!season)return response();
      const beforeMembership=statements.length;if(await membershipPlan(db,root,season,'dated_metadata',add)&&statements.length>beforeMembership){dirtySeasons(add,teamId,[season.id]);affectedTeams.push({app_team_id:teamId,team_season_id:season.id});}
      cp={...cp,yearIndex:cp.yearIndex+1};return response();
    }
    cp={...cp,after:cp.period};delete cp.period;delete cp.years;delete cp.yearIndex;return response();
  }
  if(cp.phase==='events'){
    const batch=root.has_event_aliases?{legacy:{}}:await buildConnectionEventBatch(db,root,cp.after);
    if(batch.empty){cp={...cp,phase:'roster',after:'',yearIndex:0};return response();}
    if(!batch.fallback&&!batch.legacy){statements.push(...batch.statements);affectedTeams.push(...batch.affectedTeams);cp={...cp,after:batch.after};return response();}
    if(batch.legacy){
    const next=batch.legacy.id?{id:batch.legacy.id}:await db.prepare(`${sources} SELECT DISTINCT c.canonical_id AS id FROM source_event_teams st JOIN event_source_links l ON l.source_event_id=st.source_event_id JOIN canonical_event_ids c ON c.input_id=l.event_id WHERE st.source_team_id IN(SELECT id FROM sources) AND c.canonical_id>? ORDER BY c.canonical_id LIMIT 1`).bind(...rootParams(connectionId),cp.after).first();
    if(!next){cp={...cp,phase:'roster',after:'',yearIndex:0};return response();}
    const sourceRows=(await db.prepare(`${teamSources} SELECT DISTINCT e.*,competition.starts_on AS competition_start,competition.ends_on AS competition_end,(SELECT json_group_array(json_object('start',json_extract(native.evidence,'$.season_start_date'),'end',json_extract(native.evidence,'$.season_end_date'))) FROM source_event_teams member JOIN source_teams native ON native.id=member.source_team_id WHERE member.source_event_id=e.id AND native.id IN(SELECT id FROM sources)) AS native_periods,EXISTS(SELECT 1 FROM source_event_teams owned WHERE owned.source_event_id=e.id AND (owned.source_team_id=? OR EXISTS(SELECT 1 FROM source_team_links link WHERE (link.a=? AND link.b=owned.source_team_id) OR (link.b=? AND link.a=owned.source_team_id)))) AS own_connection FROM source_events e LEFT JOIN source_competitions competition ON competition.id=e.competition_key AND competition.account_id IS e.account_id JOIN event_source_links l ON l.source_event_id=e.id JOIN canonical_event_ids c ON c.input_id=l.event_id JOIN source_event_teams st ON st.source_event_id=e.id WHERE c.canonical_id=? AND st.source_team_id IN(SELECT id FROM sources) ORDER BY e.id LIMIT 97`).bind(teamId,root.source_team_id,root.source_team_id,root.source_team_id,next.id).all()).results;
    if(sourceRows.length>96)throw fail('This game has too many linked observations to resolve safely.','record_size');
    const accepted=await db.prepare("SELECT (SELECT json_object('app_team_id',r.app_team_id,'event_id',r.event_id,'team_season_id',r.team_season_id,'state',r.state,'effective_day',r.effective_day,'starts_at',r.starts_at,'local_day',r.local_day,'basis',r.basis,'evidence',r.evidence,'revision',r.revision,'year',s.year) FROM team_event_season_resolutions r LEFT JOIN team_seasons s ON s.id=r.team_season_id WHERE r.app_team_id=? AND r.event_id=?) AS previous,(SELECT fields FROM domain_overrides WHERE app_team_id=? AND kind='event' AND entity_id=?) AS fields").bind(teamId,next.id,teamId,next.id).first();
    const previous=accepted.previous?parse(accepted.previous):null,override={fields:accepted.fields};
    let choice=resolveEventDate({timezone:root.timezone,sources:sourceRows,fields:parse(override?.fields),previous,verifiedYears:sourceRows.flatMap(source=>datedPeriodYears(source.competition_start,source.competition_end).concat((parse(source.native_periods)||[]).flatMap(period=>datedPeriodYears(period.start,period.end))))});
    if(choice.year!==null&&(choice.year<2000||choice.year>2100))choice={...choice,state:'pending',year:null,day:null,starts_at:null,local_day:null,basis:'date_outside_supported_range'};
      batch.fallback={id:next.id,sourceRows,previous,choice};
    }
    const next={id:batch.fallback.id},sourceRows=batch.fallback.sourceRows,previous=batch.fallback.previous;
    let choice=batch.fallback.choice;
    let season=null,allowed=false,recordConflict=false;const membershipOffset=statements.length;
    if(choice.year!==null){
      if(root.scope_mode==='fixed_seasons')season=batch.legacy?await db.prepare('SELECT s.* FROM team_seasons s JOIN team_connection_seasons m ON m.team_season_id=s.id WHERE m.connection_id=? AND m.active=1 AND m.excluded=0 AND s.year=?').bind(connectionId,choice.year).first():batch.fallback.member?.active&&!batch.fallback.member.excluded?batch.fallback.season:null;
      else {season=await seasonPlan(db,root,choice.year,add,batch.fallback.season);if(!season)return response();}
      if(season)allowed=await membershipPlan(db,root,season,choice.basis==='dated_metadata'?'dated_metadata':'events',add,batch.fallback.member);
    }
    const requestedChoice={...choice};let scopeConflict=false;
    if(!allowed&&choice.basis==='owner'&&choice.year!==null&&previous?.team_season_id&&previous.year!==choice.year){
      const applicable=await db.prepare(`SELECT 1 FROM team_source_connections candidate WHERE candidate.app_team_id=? AND candidate.active=1 AND EXISTS(SELECT 1 FROM source_event_teams st WHERE st.source_event_id IN(SELECT value FROM json_each(?)) AND (st.source_team_id=candidate.source_team_id OR EXISTS(SELECT 1 FROM source_team_links link WHERE (link.a=candidate.source_team_id AND link.b=st.source_team_id) OR(link.b=candidate.source_team_id AND link.a=st.source_team_id)))) AND ((candidate.scope_mode='observed_history' AND NOT EXISTS(SELECT 1 FROM team_connection_seasons excluded JOIN team_seasons s ON s.id=excluded.team_season_id WHERE excluded.connection_id=candidate.id AND excluded.excluded=1 AND s.year=?)) OR EXISTS(SELECT 1 FROM team_connection_seasons allowed JOIN team_seasons s ON s.id=allowed.team_season_id WHERE allowed.connection_id=candidate.id AND allowed.active=1 AND allowed.excluded=0 AND s.year=?)) LIMIT 1`).bind(teamId,JSON.stringify(sourceRows.map(source=>source.id)),choice.year,choice.year).first();
      if(!applicable){scopeConflict=true;recordConflict=true;choice={...choice,state:'conflict',year:previous.year,day:previous.effective_day,starts_at:previous.starts_at,local_day:previous.local_day,basis:'accepted_conflict',evidence:[...choice.evidence,{reason:'season_scope_conflict',requested_day:requestedChoice.day,requested_year:requestedChoice.year}]};}
    }
    let move=null;
    if(allowed&&previous?.team_season_id&&previous.team_season_id!==season.id){
      move=await prepareGameSeasonMove(db,{teamId,eventId:next.id,fromSeasonId:previous.team_season_id,toSeasonId:season.id});
      if(!move.ok){statements.splice(membershipOffset);recordConflict=true;choice={...choice,state:'conflict',year:previous.year,day:previous.effective_day,starts_at:previous.starts_at,local_day:previous.local_day,basis:'accepted_conflict',evidence:[...choice.evidence,{conflicts:move.conflicts}]};season=await db.prepare('SELECT * FROM team_seasons WHERE id=?').bind(previous.team_season_id).first();allowed=!!season&&await membershipPlan(db,root,season,'events',add);move=null;}
    }
    // Never let a second root overwrite an already accepted game with an
    // out-of-scope observation. Canonical membership is one row per logical team.
    const canonicalSeason=allowed?season?.id:previous?.team_season_id??null;
    const membershipChanged=statements.length>membershipOffset,canonical=[];
    if(!previous||allowed||recordConflict||!previous.team_season_id){
      assertion(add,{sql:`COALESCE((SELECT revision FROM team_event_season_resolutions WHERE app_team_id=? AND event_id=?),0)=?`,params:[teamId,next.id,previous?.revision??0]});
      if(move){assertion(add,move.precondition);statements.push(...move.statements);}
      canonical.push({app_team_id:teamId,event_id:next.id,team_season_id:canonicalSeason,state:canonicalSeason?choice.state:'pending',effective_day:choice.day,starts_at:choice.starts_at,local_day:choice.local_day,basis:choice.basis,evidence:JSON.stringify(choice.evidence),revision:(previous?.revision??0)+1});
    }
    const own=sourceRows.filter(row=>row.own_connection);
    const receipts=own.map(event=>({connection_id:connectionId,source_event_id:event.id,team_season_id:allowed?season.id:null,state:allowed?choice.state:choice.year!==null?'excluded':choice.state,effective_day:scopeConflict?requestedChoice.day:choice.day,basis:scopeConflict?'season_scope_conflict':choice.basis,source_hash:event.content_hash,generation:root.generation}));
    const changes=await readConnectionEventChanges(db,root,{canonical,receipts,targets:own.map(event=>({id:event.id,season_id:allowed?season.id:null}))});
    if(membershipChanged&&allowed)changes.dirty.add(season.id);
    jsonWrite(add,'team_event_season_resolutions',canonical.filter(row=>changes.canonicalIds.has(row.event_id)),['app_team_id','event_id']);
    jsonWrite(add,'connection_event_resolutions',receipts,['connection_id','source_event_id']);
    // Participation is evidence for these games only. It is not a claim that a
    // current roster member or jersey belonged to an entire historical season.

    if(allowed){
      add(`INSERT INTO connection_roster_evidence(connection_id,team_season_id,source_player_id,basis_key,basis,source_event_id,valid_from,valid_until,certainty,name,jersey,position,observed_at,source_hash) SELECT ?,?,m.source_player_id,'game:'||m.id,'game',m.source_event_id,NULL,NULL,CASE WHEN m.provenance='file_import' THEN 'preserved_uncertain' ELSE 'verified' END,m.name,m.jersey,m.position,m.observed_at,m.content_hash FROM source_game_members m JOIN source_players p ON p.id=m.source_player_id JOIN source_event_teams st ON st.source_event_id=m.source_event_id AND st.source_team_id=m.source_team_id AND st.side=m.side WHERE m.source_team_id=? AND m.account_id IS ? AND m.dummy=0 AND m.source_event_id IN(SELECT value FROM json_each(?)) AND $FENCE ON CONFLICT(connection_id,team_season_id,source_player_id,basis_key) DO UPDATE SET certainty=excluded.certainty,name=excluded.name,jersey=excluded.jersey,position=excluded.position,observed_at=excluded.observed_at,source_hash=excluded.source_hash`,connectionId,season.id,root.source_team_id,root.account_id,JSON.stringify(own.map(event=>event.id)));
      add(`INSERT INTO connection_roster_evidence(connection_id,team_season_id,source_player_id,basis_key,basis,source_event_id,valid_from,valid_until,certainty,name,jersey,position,observed_at,source_hash) SELECT ?,?,a.source_player_id,'attendance:'||a.id,'attendance',a.source_event_id,NULL,NULL,CASE WHEN a.provenance='file_import' THEN 'preserved_uncertain' ELSE 'verified' END,COALESCE((SELECT old.name FROM connection_roster_evidence old WHERE old.connection_id=? AND old.source_player_id=a.source_player_id AND old.basis_key='attendance:'||a.id ORDER BY old.observed_at LIMIT 1),p.name),NULL,NULL,a.observed_at,a.content_hash FROM source_attendance a JOIN source_players p ON p.id=a.source_player_id WHERE a.source_team_id=? AND a.account_id IS ? AND a.source_event_id IN(SELECT value FROM json_each(?)) AND $FENCE ON CONFLICT(connection_id,team_season_id,source_player_id,basis_key) DO UPDATE SET certainty=excluded.certainty,observed_at=excluded.observed_at,source_hash=excluded.source_hash`,connectionId,season.id,connectionId,root.source_team_id,root.account_id,JSON.stringify(own.map(event=>event.id)));
    }
    add(`DELETE FROM connection_roster_evidence WHERE connection_id=? AND basis<>'imported_snapshot' AND source_event_id IN(SELECT value FROM json_each(?)) AND team_season_id IS NOT ? AND $FENCE`,connectionId,JSON.stringify(own.map(event=>event.id)),allowed?season.id:null);
    add(`DELETE FROM connection_roster_evidence WHERE connection_id=? AND source_event_id IN(SELECT value FROM json_each(?)) AND ((basis='game' AND NOT EXISTS(SELECT 1 FROM source_game_members m WHERE basis_key='game:'||m.id AND m.source_player_id=connection_roster_evidence.source_player_id AND m.source_team_id=? AND m.dummy=0)) OR (basis='attendance' AND NOT EXISTS(SELECT 1 FROM source_attendance a WHERE basis_key='attendance:'||a.id AND a.source_player_id=connection_roster_evidence.source_player_id AND a.source_team_id=?))) AND $FENCE`,connectionId,JSON.stringify(own.map(event=>event.id)),root.source_team_id,root.source_team_id);
    dirtySeasons(add,teamId,[...changes.dirty]);for(const id of changes.dirty)affectedTeams.push({app_team_id:teamId,team_season_id:id});
    cp={...cp,after:next.id};return response();
  }
  if(cp.phase==='roster'){
    const player=await db.prepare('SELECT p.* FROM source_roster_memberships membership JOIN source_players p ON p.id=membership.source_player_id WHERE membership.source_team_id=? AND membership.active=1 AND p.id>? ORDER BY p.id LIMIT 1').bind(root.source_team_id,cp.after).first();
    if(!player){cp={...cp,phase:'roster_review',after:''};return response();}
    const detail=parse(player.evidence),{years,start,end}=player.provenance==='file_import'?{years:[],start:null,end:null}:qualifiedRosterPeriod(detail,parse(root.evidence));
    // A persistent profile spanning several seasons does not turn today's
    // roster into a historical roster. Only a member's explicit period or a
    // single verified native team-season can qualify a roster-only member.
    if(cp.yearIndex>=years.length){cp={...cp,after:player.id,yearIndex:0};return response();}
    const year=years[cp.yearIndex];let season;
    if(root.scope_mode==='fixed_seasons')season=await db.prepare('SELECT s.* FROM team_seasons s JOIN team_connection_seasons m ON m.team_season_id=s.id WHERE m.connection_id=? AND m.active=1 AND m.excluded=0 AND s.year=?').bind(connectionId,year).first();
    else {season=await seasonPlan(db,root,year,add);if(!season)return response();}
    const membershipOffset=statements.length;
    if(season&&await membershipPlan(db,root,season,'dated_metadata',add)){
      const membershipChanged=statements.length>membershipOffset;
      const observed=observedDay({starts_at:player.observed_at},root.timezone),updateSnapshot=observed&&observed>=start&&observed<=end;
      // A later read of today's profile cannot rewrite an already captured
      // historical name/jersey. Metadata changes observed within the native
      // validity period can still update that period's roster snapshot.
      add(`INSERT INTO connection_roster_evidence(connection_id,team_season_id,source_player_id,basis_key,basis,source_event_id,valid_from,valid_until,certainty,name,jersey,position,observed_at,source_hash) SELECT ?,?,?,?,'dated_roster',NULL,?,?,'verified',?,?,?,?,? WHERE $FENCE ON CONFLICT(connection_id,team_season_id,source_player_id,basis_key) DO UPDATE SET certainty='verified'${updateSnapshot?',name=excluded.name,jersey=excluded.jersey,position=excluded.position,observed_at=excluded.observed_at,source_hash=excluded.source_hash':''}`,connectionId,season.id,player.id,'roster:'+root.source_team_id+':'+start+':'+end,start,end,player.name,player.jersey,detail.position||null,player.observed_at,player.content_hash);
      const saved=await db.prepare('SELECT certainty,name,jersey,position,observed_at,source_hash FROM connection_roster_evidence WHERE connection_id=? AND team_season_id=? AND source_player_id=? AND basis_key=?').bind(connectionId,season.id,player.id,'roster:'+root.source_team_id+':'+start+':'+end).first();
      const snapshot={name:player.name,jersey:player.jersey,position:detail.position||null,observed_at:player.observed_at,source_hash:player.content_hash};
      const changed=membershipChanged||!saved||saved.certainty!=='verified'||updateSnapshot&&Object.entries(snapshot).some(([key,value])=>saved[key]!==value);
      if(changed){dirtySeasons(add,teamId,[season.id]);affectedTeams.push({app_team_id:teamId,team_season_id:season.id});}
    }
    cp={...cp,yearIndex:cp.yearIndex+1};return response();
  }
  if(cp.phase==='roster_review'){
    const rows=(await db.prepare("SELECT e.*,p.evidence AS player_evidence,p.provenance AS player_provenance,e.source_player_id||'|'||e.team_season_id||'|'||e.basis_key AS cursor FROM connection_roster_evidence e JOIN source_players p ON p.id=e.source_player_id WHERE e.connection_id=? AND e.basis='dated_roster' AND e.source_player_id||'|'||e.team_season_id||'|'||e.basis_key>? ORDER BY cursor LIMIT 24").bind(connectionId,cp.after).all()).results;
    const changed=rows.flatMap(row=>{const period=qualifiedRosterPeriod(parse(row.player_evidence),parse(root.evidence)),certainty=row.player_provenance!=='file_import'&&period.start===row.valid_from&&period.end===row.valid_until?'verified':'preserved_uncertain';return certainty===row.certainty?[]:[{source_player_id:row.source_player_id,team_season_id:row.team_season_id,basis_key:row.basis_key,certainty}];});
    if(changed.length){add("UPDATE connection_roster_evidence SET certainty=(SELECT json_extract(value,'$.certainty') FROM json_each(?) WHERE json_extract(value,'$.source_player_id')=connection_roster_evidence.source_player_id AND json_extract(value,'$.team_season_id')=connection_roster_evidence.team_season_id AND json_extract(value,'$.basis_key')=connection_roster_evidence.basis_key) WHERE connection_id=? AND EXISTS(SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.source_player_id')=connection_roster_evidence.source_player_id AND json_extract(value,'$.team_season_id')=connection_roster_evidence.team_season_id AND json_extract(value,'$.basis_key')=connection_roster_evidence.basis_key) AND $FENCE",JSON.stringify(changed),connectionId,JSON.stringify(changed));dirtySeasons(add,teamId,changed.map(row=>row.team_season_id));}
    cp=rows.length?{...cp,after:rows.at(-1).cursor}:{...cp,phase:'cleanup',after:''};return response();
  }
  if(cp.phase==='cleanup'){
    const stale=(await db.prepare(`${sources} SELECT r.source_event_id,r.team_season_id FROM connection_event_resolutions r WHERE r.connection_id=? AND r.source_event_id>? AND NOT EXISTS(SELECT 1 FROM source_event_teams st WHERE st.source_event_id=r.source_event_id AND st.source_team_id IN(SELECT id FROM sources)) ORDER BY r.source_event_id LIMIT 24`).bind(...rootParams(connectionId),connectionId,cp.after).all()).results;
    if(stale.length){
      const ids=JSON.stringify(stale.map(row=>row.source_event_id));
      add(`DELETE FROM connection_roster_evidence WHERE connection_id=? AND basis<>'imported_snapshot' AND source_event_id IN(SELECT value FROM json_each(?)) AND $FENCE`,connectionId,ids);
      add('DELETE FROM connection_event_resolutions WHERE connection_id=? AND source_event_id IN(SELECT value FROM json_each(?)) AND $FENCE',connectionId,ids);
      dirtySeasons(add,teamId,stale.map(row=>row.team_season_id));
      cp={...cp,after:stale.at(-1).source_event_id};return response();
    }
    cp={...cp,phase:'members',after:''};return response();
  }
  if(cp.phase==='members'){
    const stale=await db.prepare(`${sources} SELECT m.team_season_id,m.attachment_id FROM team_connection_seasons m JOIN team_seasons season ON season.id=m.team_season_id WHERE m.connection_id=? AND m.active=1 AND m.basis<>'fixed' AND m.team_season_id>? AND NOT EXISTS(SELECT 1 FROM connection_event_resolutions r WHERE r.connection_id=m.connection_id AND r.team_season_id=m.team_season_id AND r.state IN('resolved','conflict')) AND NOT EXISTS(SELECT 1 FROM connection_roster_evidence roster WHERE roster.connection_id=m.connection_id AND roster.team_season_id=m.team_season_id AND roster.basis IN('dated_roster','imported_snapshot','accepted_projection')) AND NOT COALESCE((json_extract(?,'$.season_start_date')<season.end_day AND COALESCE(json_extract(?,'$.season_end_date'),json_extract(?,'$.season_start_date'))>=season.start_day),0) AND NOT EXISTS(SELECT 1 FROM source_competition_memberships membership ${membershipPeriodJoins('membership','division','competition')} WHERE membership.source_team_id IN(SELECT id FROM sources) AND competition.starts_on IS NOT NULL AND competition.starts_on<season.end_day AND COALESCE(competition.ends_on,competition.starts_on)>=season.start_day) ORDER BY m.team_season_id LIMIT 1`).bind(...rootParams(connectionId),connectionId,cp.after,root.evidence,root.evidence,root.evidence).first();
    if(stale){
      add('UPDATE team_connection_seasons SET active=0 WHERE connection_id=? AND team_season_id=? AND $FENCE',connectionId,stale.team_season_id);
      add('UPDATE team_source_attachments SET active=0,generation=generation+1 WHERE id=? AND $FENCE',stale.attachment_id);
      dirtySeasons(add,teamId,[stale.team_season_id]);affectedTeams.push({app_team_id:teamId,team_season_id:stale.team_season_id});
      cp={...cp,after:stale.team_season_id};return response();
    }
    cp={...cp,phase:'finish'};return response();
  }
  if(cp.phase==='finish'){
    if(cp.passRevision!==root.input_revision){cp=newPass();return response();}
    const pending=(await db.prepare('SELECT app_team_id,team_season_id FROM team_projection_state WHERE app_team_id=? AND pending=1 ORDER BY team_season_id LIMIT 128').bind(teamId).all()).results;affectedTeams.push(...pending);
    add('UPDATE team_source_connections SET reconciled_revision=?,last_reconciled_at=? WHERE id=? AND $FENCE',root.input_revision,now(),connectionId);
    add('UPDATE team_read_state SET pending=EXISTS(SELECT 1 FROM team_projection_state WHERE app_team_id=? AND pending=1) OR EXISTS(SELECT 1 FROM team_source_connections WHERE app_team_id=? AND active=1 AND input_revision>reconciled_revision),status_revision=status_revision+1 WHERE app_team_id=? AND $FENCE',teamId,teamId,teamId);
    cp={...cp,finished:true};return response(true);
  }
  throw fail('Invalid connection reconciliation checkpoint.','invalid_checkpoint');
}
