import {nativeCanonicalId} from './identity.js';
import {invalid} from '../read-model/selection.js';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,label,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw invalid('Enter a valid '+label+'.','invalid_request');return value.trim();};
const stable=value=>Array.isArray(value)?value.map(stable):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const connectionConflict=()=>invalid('This connection request was already used for a different selection. Start a new connection.','idempotency_conflict',409);
export const connectionUnavailable=()=>invalid('This connection is no longer available. Start a new connection.','connection_unavailable',409);
export function connectionRequestKey(value){const key=text(value,'connection request',128);if(!/^[A-Za-z0-9_.-]+$/.test(key))throw invalid('Invalid connection request.','invalid_request');return key;}

/** Normalize the owner's immutable selection, not mutable provider/team labels. */
export async function normalizeConnectionCommand(body,{legacySeasonId=null}={}){
  if(!object(body)||body.season_id!=null||(body.new_team!=null)===(body.team_id!=null)||body.new_team!=null&&!object(body.new_team))throw invalid('Choose a new team or an existing team for this connection.','invalid_request');
  if(legacySeasonId!==null)legacySeasonId=text(legacySeasonId,'season',128);
  const requestId=connectionRequestKey(body.request_id),sourceId=text(body.source_team_id,'source team',512),accountId=body.account_id==null?null:text(body.account_id,'provider account',128);
  const teamId=body.team_id==null?null:text(body.team_id,'team',128),kind=body.new_team?.kind??body.kind??'own';
  if(!['own','followed'].includes(kind))throw invalid('Choose a supported team type.','invalid_request');
  let newTeam=null;
  if(body.new_team){
    const name=text(body.new_team.name,'team name',100),timezone=body.new_team.timezone??'America/Los_Angeles',seasonYear=body.new_team.season_year??null;
    if(typeof timezone!=='string'||timezone.length>100||(seasonYear!==null&&(!Number.isInteger(seasonYear)||seasonYear<2000||seasonYear>2100)))throw invalid('Choose a supported season and timezone.','invalid_request');
    try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format();}catch{throw invalid('Choose a supported timezone.','invalid_request');}
    const timezoneSource=body.new_team.timezone_source;
    if(timezoneSource!=null&&!['device','owner'].includes(timezoneSource))throw invalid('Choose a supported timezone source.','invalid_request');
    newTeam={name,timezone,season_year:seasonYear,kind,...(timezoneSource?{timezone_source:timezoneSource}:{})};
  }
  let scope=null;
  if(body.scope!=null){
    if(!object(body.scope)||!['observed_history','fixed_seasons'].includes(body.scope.mode))throw invalid('Choose a supported connection scope.','invalid_request');
    if(body.scope.mode==='fixed_seasons'){
      if(!Array.isArray(body.scope.season_ids)||body.scope.season_ids.length>100||newTeam)throw invalid('Choose existing seasons for a fixed connection.','invalid_request');
      const seasonIds=[...new Set(body.scope.season_ids.map(value=>text(value,'season',128)))].sort();
      scope={mode:'fixed_seasons',season_ids:seasonIds};
    }else{if(body.scope.season_ids!=null||newTeam?.season_year!=null)throw invalid('A continuing connection cannot also select fixed seasons.','invalid_request');scope={mode:'observed_history'};}
  }
  for(const key of ['revision','connection_generation'])if(body[key]!=null&&(!Number.isSafeInteger(body[key])||body[key]<0))throw invalid('Reload this connection before changing it.','revision_invalid');
  if(body.club_choice!=null&&!object(body.club_choice))throw invalid('Choose a valid club decision.','invalid_request');
  const normalized={source_team_id:sourceId,account_id:accountId,...(newTeam?{new_team:newTeam}:{team_id:teamId,kind}),scope,revision:body.revision??null,connection_generation:body.connection_generation??null,club_choice:body.club_choice??null,...(legacySeasonId?{legacy_season_id:legacySeasonId}:{})};
  const payloadHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(normalized))))),value=>value.toString(16).padStart(2,'0')).join('');
  const legacyTeamId=newTeam?await nativeCanonicalId('connection',JSON.stringify({request_id:requestId,source_team_id:sourceId,account_id:accountId,new_team:newTeam})):null;
  return {requestId,sourceId,accountId,teamId,newTeam,kind,scope,revision:body.revision??null,connectionGeneration:body.connection_generation??null,clubChoice:body.club_choice??null,legacySeasonId,payloadHash,legacyTeamId};
}

/** One guarded D1 transaction: no team, profile, root or receipt may be orphaned. */
export async function commitConnectionCommand(repo,{command,source,team,root,profileBinding=null,createTeam=false,reuse=false,scopeMode,seasonIds=[],scopeChanged=false,precondition}){
  const db=repo.db,rootId=root?.id??await nativeCanonicalId('connection-root',team.id+'|'+source.id),generation=root?root.generation+(!root.active||scopeChanged?1:0):1;
  const outcome=reuse?'already_connected':createTeam?'created':root?.active&&!scopeChanged?'already_connected':'connected';
  const at=new Date().toISOString(),conditions=[`NOT EXISTS(SELECT 1 FROM connection_command_receipts WHERE request_id=?)`,`EXISTS(SELECT 1 FROM source_teams WHERE id=? AND account_id IS ? AND content_hash=? AND provenance='provider')`,`(? IS NULL OR EXISTS(SELECT 1 FROM account_source_teams a JOIN provider_accounts p ON p.id=a.account_id WHERE a.account_id=? AND a.source_team_id=? AND p.active=1 AND p.generation=?))`,`NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=?)`,`(${precondition.sql})`];
  const params=[command.requestId,source.id,source.account_id,source.content_hash,source.account_id,source.account_id,source.id,source.account_generation,team.id,...precondition.params];
  if(createTeam){conditions.push('NOT EXISTS(SELECT 1 FROM app_teams WHERE id=? OR request_id=?)');params.push(team.id,command.requestId);}
  else{conditions.push('EXISTS(SELECT 1 FROM app_teams WHERE id=?)');params.push(team.id);}
  if(root){conditions.push('EXISTS(SELECT 1 FROM team_source_connections WHERE id=? AND app_team_id=? AND source_team_id=? AND active=? AND generation=? AND scope_mode=?)');params.push(root.id,team.id,source.id,root.active,root.generation,root.scope_mode);}
  else{conditions.push('NOT EXISTS(SELECT 1 FROM team_source_connections WHERE app_team_id=? AND source_team_id=?)');params.push(team.id,source.id);}
  // Add-team's exact-source decision must still hold at the commit boundary.
  // Existing-team commands deliberately do not have this cross-team guard.
  if(command.newTeam){
    if(reuse){conditions.push(`(SELECT count(*) FROM team_source_connections c JOIN app_teams t ON t.id=c.app_team_id WHERE c.source_team_id=? AND c.account_id IS ? AND c.active=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=c.app_team_id))=1`);params.push(source.id,source.account_id);}
    else{conditions.push(`NOT EXISTS(SELECT 1 FROM team_source_connections c JOIN app_teams t ON t.id=c.app_team_id WHERE c.source_team_id=? AND c.account_id IS ? AND c.active=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=c.app_team_id))`);params.push(source.id,source.account_id);}
  }
  if(profileBinding&&!(profileBinding.team_id===team.id&&profileBinding.source_team_id===source.id&&typeof profileBinding.condition==='string'&&profileBinding.condition.length<=8000&&Array.isArray(profileBinding.condition_params)&&Array.isArray(profileBinding.statements)&&profileBinding.statements.length<=8&&profileBinding.statements.every(s=>typeof s.sql==='string'&&s.sql.length<=12000&&Array.isArray(s.params))))throw invalid('Invalid prepared team profile binding.');
  const fixedData=JSON.stringify(seasonIds),fixedAttachments=JSON.stringify(await Promise.all(seasonIds.map(async seasonId=>({id:await nativeCanonicalId('connection-season',rootId+':'+seasonId),season_id:seasonId}))));
  await repo.domainBatch((guard,token)=>[
    ...(createTeam?[
      db.prepare(`INSERT INTO app_teams(id,name,timezone,season_year,request_id,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(team.id,team.name,team.timezone,team.season_year,command.requestId,at,token),
      db.prepare(`INSERT INTO team_read_state(app_team_id,pending) SELECT ?,1 WHERE ${guard}`).bind(team.id,token),
      ...(team.season_id?[db.prepare(`INSERT INTO team_seasons(id,app_team_id,year,start_day,end_day,start_at,end_at,include_june) SELECT ?,?,?,?,?,?,?,0 WHERE ${guard}`).bind(team.season_id,team.id,team.season_year,team.start_day,team.end_day,team.start_at,team.end_at,token),db.prepare(`INSERT INTO team_projection_state(team_season_id,app_team_id) SELECT ?,? WHERE ${guard}`).bind(team.season_id,team.id,token)]:[]),
    ]:[]),
    ...(!root?[db.prepare(`INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(rootId,team.id,source.id,source.account_id,scopeMode,at,token)]:!root.active||scopeChanged?[db.prepare(`UPDATE team_source_connections SET active=1,scope_mode=?,scope_origin=CASE WHEN ? THEN 'owner' ELSE scope_origin END,generation=generation+1,input_revision=input_revision+1 WHERE id=? AND ${guard}`).bind(scopeMode,command.scope||command.legacySeasonId?1:0,rootId,token)]:[]),
    ...(scopeMode==='fixed_seasons'&&(!root||!root.active||scopeChanged)?[
      db.prepare(`UPDATE team_source_attachments SET active=0,generation=generation+1 WHERE id IN(SELECT attachment_id FROM team_connection_seasons WHERE connection_id=? AND team_season_id NOT IN(SELECT value FROM json_each(?))) AND active=1 AND ${guard}`).bind(rootId,fixedData,token),
      db.prepare(`UPDATE team_connection_seasons SET active=0,excluded=1,generation=generation+1 WHERE connection_id=? AND team_season_id NOT IN(SELECT value FROM json_each(?)) AND (active=1 OR excluded=0) AND ${guard}`).bind(rootId,fixedData,token),
      db.prepare(`INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id,account_id,active,generation) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.season_id'),?,?,1,? FROM json_each(?) WHERE ${guard} ON CONFLICT(app_team_id,team_season_id,source_team_id) DO UPDATE SET active=1,generation=team_source_attachments.generation+1`).bind(team.id,source.id,source.account_id,generation,fixedAttachments,token),
      db.prepare(`INSERT INTO team_connection_seasons(connection_id,team_season_id,attachment_id,basis,generation) SELECT ?,a.team_season_id,a.id,'fixed',? FROM team_source_attachments a WHERE a.app_team_id=? AND a.source_team_id=? AND a.team_season_id IN(SELECT value FROM json_each(?)) AND ${guard} ON CONFLICT(connection_id,team_season_id) DO UPDATE SET attachment_id=excluded.attachment_id,basis='fixed',active=CASE WHEN team_connection_seasons.excluded=0 THEN 1 ELSE 0 END,generation=team_connection_seasons.generation+1`).bind(rootId,generation,team.id,source.id,fixedData,token),
    ]:[]),
    ...(profileBinding?[
      db.prepare(`INSERT INTO feature_write_fences VALUES(?,CASE WHEN (${profileBinding.condition}) AND ${guard} THEN 1 ELSE 0 END)`).bind(token,...profileBinding.condition_params,token),
      ...profileBinding.statements.map(s=>db.prepare(s.sql).bind(...s.params)),
      db.prepare('DELETE FROM feature_write_fences WHERE token=?').bind(token),
    ]:[]),
    db.prepare(`INSERT INTO connection_command_receipts(request_id,payload_version,payload_hash,team_id,connection_id,connection_generation,outcome,created_at) SELECT ?,2,?,?,?,?,?,? WHERE ${guard}`).bind(command.requestId,command.payloadHash,team.id,rootId,generation,outcome,at,token),
    ...(!reuse?[db.prepare(`UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(team.id,token)]:[]),
    ...(root&&scopeChanged?[db.prepare(`UPDATE team_projection_state SET pending=1,input_revision=input_revision+1 WHERE app_team_id=? AND ${guard}`).bind(team.id,token)]:[]),
  ],{sql:conditions.join(' AND '),params}).catch(error=>{if(String(error.message).includes('feature_revision_current'))throw invalid('The team or source changed; retry the operation.','revision_conflict',409);throw error;});
  return {id:rootId,app_team_id:team.id,source_team_id:source.id,account_id:source.account_id,scope_mode:scopeMode,scope_origin:command.scope||!root?'owner':root.scope_origin,active:1,generation,outcome};
}
