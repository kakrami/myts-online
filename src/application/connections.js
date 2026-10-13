import {DomainRepository} from '../domain/repository.js';
import {nativeCanonicalId} from '../domain/identity.js';
import {normalizeConnectionCommand,connectionRequestKey,connectionConflict,connectionUnavailable,commitConnectionCommand} from '../domain/connection-commands.js';
import {invalid} from '../read-model/selection.js';

const SESSION_CONDITION=`EXISTS(SELECT 1 FROM security_sessions s JOIN security_owner o ON o.id=1 WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.password_revision=o.password_revision)`;
const RECEIPT=`SELECT r.*,t.id AS available_team_id,c.id AS available_connection_id,c.active,c.generation,c.scope_mode,c.scope_origin,c.account_id,p.active AS account_active,l.state AS lifecycle,(SELECT id FROM team_seasons WHERE app_team_id=r.team_id ORDER BY year DESC,id LIMIT 1) AS season_id,(SELECT m.attachment_id FROM team_connection_seasons m WHERE m.connection_id=r.connection_id AND m.attachment_id IS NOT NULL ORDER BY m.team_season_id LIMIT 1) AS attachment_id,(SELECT a.active FROM team_connection_seasons m JOIN team_source_attachments a ON a.id=m.attachment_id WHERE m.connection_id=r.connection_id ORDER BY m.team_season_id LIMIT 1) AS attachment_current_active FROM connection_command_receipts r LEFT JOIN app_teams t ON t.id=r.team_id LEFT JOIN team_source_connections c ON c.id=r.connection_id AND c.app_team_id=r.team_id LEFT JOIN provider_accounts p ON p.id=c.account_id LEFT JOIN team_lifecycle l ON l.team_id=r.team_id WHERE r.request_id=?`;

/** Owner-only, bounded team/source selection. Provider requests run in jobs. */
export class ConnectionService {
  constructor(db,{features,sync,owner,now=Date.now}){this.db=db;this.features=features;this.sync=sync;this.owner=owner;this.now=now;this.repo=new DomainRepository(db);}
  ownerOnly(){if(this.owner?.role!=='owner'||!this.owner.session_id)throw invalid('Sign in as the owner to connect a team.','owner_required',403);}
  sessionCondition(){return {sql:SESSION_CONDITION,params:[this.owner.session_id,this.now()]};}
  async assertSession(){const condition=this.sessionCondition();if(!await this.db.prepare('SELECT 1 WHERE '+condition.sql).bind(...condition.params).first())throw invalid('Sign in to continue.','sign_in_required',401);}
  async source(sourceId,accountId){
    const source=await this.db.prepare(`SELECT t.*,p.active AS account_active,p.generation AS account_generation,EXISTS(SELECT 1 FROM account_source_teams a WHERE a.account_id=t.account_id AND a.source_team_id=t.id) AS entitled FROM source_teams t LEFT JOIN provider_accounts p ON p.id=t.account_id WHERE t.id=?`).bind(sourceId).first();
    if(!source||source.provenance!=='provider'||source.account_id!==accountId)throw invalid('Select a discovered team from this provider account.','source_scope',403);
    const evidence=JSON.parse(source.evidence||'{}');
    if(accountId&&(source.account_active!==1||source.entitled!==1||evidence.account_owned!==true))throw invalid('Select a discovered team owned by this provider account.','source_scope',403);
    if(source.provider==='trace'&&!evidence.slug)throw invalid('The discovered Trace profile is unavailable.','source_unavailable',409);
    if(source.provider==='live'&&!(evidence.proof?.season||evidence.season))throw invalid('The selected Live team needs published season evidence.','source_unavailable',409);
    return source;
  }
  async originalAttachment(receipt){
    if(receipt?.payload_version!==1)return receipt;
    const id=await nativeCanonicalId('connection-attachment',receipt.team_id),attachment=await this.db.prepare('SELECT id,active FROM team_source_attachments WHERE id=? AND app_team_id=?').bind(id,receipt.team_id).first();
    return {...receipt,attachment_id:attachment?.id??null,attachment_current_active:attachment?.active??0,legacy_attachment_active:attachment?.active===1};
  }
  async receipt(command){
    const receipt=await this.originalAttachment(await this.db.prepare(RECEIPT).bind(command.requestId).first());
    if(!receipt)return null;
    const matches=receipt.payload_version===1?command.newTeam&&command.legacyTeamId===receipt.team_id&&!command.scope&&command.revision==null&&command.connectionGeneration==null&&!command.clubChoice:receipt.payload_hash===command.payloadHash;
    if(!matches)throw connectionConflict();
    if(!receipt.available_team_id||receipt.lifecycle||!receipt.available_connection_id||receipt.active!==1||receipt.generation!==receipt.connection_generation||receipt.legacy_attachment_active===false)throw connectionUnavailable();
    return receipt;
  }
  async readReceipt(value){
    this.ownerOnly();const row=await this.originalAttachment(await this.db.prepare(RECEIPT).bind(connectionRequestKey(value)).first());
    if(!row)return {found:false};
    const active=row.active===1&&row.generation===row.connection_generation&&row.legacy_attachment_active!==false;
    return {found:true,team_id:row.team_id,season_id:row.season_id??null,team_available:!!row.available_team_id&&!row.lifecycle,connection_id:row.connection_id,connection_active:active,connection_generation:row.connection_generation,scope_mode:row.scope_mode??null,scope_origin:row.scope_origin??null,attachment_id:row.attachment_id??null,attachment_active:active&&row.attachment_current_active===1,account_active:row.account_id?row.account_active===1:null,outcome:row.outcome};
  }
  async prepare(command,source){
    let root=null,team=null,createTeam=false,reuse=false;
    if(command.newTeam){
      const rows=(await this.db.prepare(`SELECT c.*,t.name,t.timezone,t.season_year FROM team_source_connections c JOIN app_teams t ON t.id=c.app_team_id WHERE c.source_team_id=? AND c.account_id IS ? AND c.active=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=c.app_team_id) ORDER BY c.app_team_id LIMIT 2`).bind(source.id,source.account_id).all()).results;
      if(rows.length>1)throw invalid('This source is connected to more than one team. Choose the destination team explicitly.','connection_destination_required',409);
      if(rows.length){root=rows[0];team={id:root.app_team_id,name:root.name,timezone:root.timezone,season_year:root.season_year};reuse=true;}
      else{createTeam=true;let timezone=command.newTeam.timezone;
        const nativeTimezone=JSON.parse(source.evidence||'{}').timezone;
        if(command.newTeam.timezone_source==='device'&&typeof nativeTimezone==='string'&&nativeTimezone.length<=100){try{new Intl.DateTimeFormat('en-US',{timeZone:nativeTimezone}).format();timezone=nativeTimezone;}catch{/* Unusable provider hints cannot replace a valid device hint. */}}
        team=command.newTeam.season_year===null?{id:command.legacyTeamId,name:command.newTeam.name,timezone,season_year:0,request_id:command.requestId,season_id:null}:this.repo.prepareTeam({name:command.newTeam.name,timezone,seasonYear:command.newTeam.season_year,requestId:command.requestId,teamId:command.legacyTeamId});}
    }else{
      team=await this.repo.team(command.teamId);
      root=await this.db.prepare('SELECT * FROM team_source_connections WHERE app_team_id=? AND source_team_id=?').bind(team.id,source.id).first();
    }
    if(command.connectionGeneration!==null&&(!root||root.generation!==command.connectionGeneration))throw invalid('This connection changed. Reload it before changing its scope.','stale_revision',409);
    let scopeMode=root?.scope_mode??(command.newTeam?.season_year!=null||command.legacySeasonId?'fixed_seasons':'observed_history'),seasonIds=[];
    if(root?.scope_mode==='fixed_seasons')seasonIds=(await this.db.prepare('SELECT team_season_id FROM team_connection_seasons WHERE connection_id=? AND excluded=0 ORDER BY team_season_id').bind(root.id).all()).results.map(row=>row.team_season_id);
    if(createTeam&&team.season_id)seasonIds=[team.season_id];
    if(!root&&command.legacySeasonId)seasonIds=[command.legacySeasonId];
    let scopeChanged=false;
    // Add-team exact reuse is an open-existing action. It never widens a saved
    // restriction, renames that team, or changes its profile on another request.
    if(command.scope&&!reuse){
      const selected=command.scope.season_ids??[];
      scopeChanged=!!root&&(root.scope_origin!=='owner'||scopeMode!==command.scope.mode||command.scope.mode==='fixed_seasons'&&JSON.stringify(seasonIds)!==JSON.stringify(selected));
      if(scopeChanged&&command.connectionGeneration===null)throw invalid('Confirm the current connection before changing its scope.','connection_scope_confirmation_required',409);
      if(root&&selected.length&&(await this.db.prepare('SELECT 1 FROM team_connection_seasons WHERE connection_id=? AND excluded=1 AND team_season_id IN(SELECT value FROM json_each(?)) LIMIT 1').bind(root.id,JSON.stringify(selected)).first()))throw invalid('Restore the excluded season explicitly before changing this connection scope.','connection_season_excluded',409);
      scopeMode=command.scope.mode;seasonIds=selected;
    }
    if(command.legacySeasonId){
      if(!await this.db.prepare('SELECT 1 FROM team_seasons WHERE id=? AND app_team_id=?').bind(command.legacySeasonId,team.id).first())throw invalid('The selected season belongs to another team.','source_scope',403);
      if(root?.scope_mode==='fixed_seasons'&&!seasonIds.includes(command.legacySeasonId)){
        if(command.connectionGeneration===null)throw invalid('Confirm the current connection before adding another fixed season.','connection_scope_confirmation_required',409);
        if(await this.db.prepare('SELECT 1 FROM team_connection_seasons WHERE connection_id=? AND team_season_id=? AND excluded=1').bind(root.id,command.legacySeasonId).first())throw invalid('Restore this explicitly excluded season first.','connection_season_excluded',409);
        seasonIds=[...seasonIds,command.legacySeasonId].sort();scopeChanged=true;
      }
    }
    if(scopeMode==='fixed_seasons'&&!createTeam){
      if(!seasonIds.length&&!root)throw invalid('Choose the seasons allowed for this connection.','connection_scope_required',409);
      const count=await this.db.prepare('SELECT count(*) AS n FROM team_seasons WHERE app_team_id=? AND id IN(SELECT value FROM json_each(?))').bind(team.id,JSON.stringify(seasonIds)).first();
      if(count.n!==seasonIds.length)throw invalid('A selected season belongs to another team.','source_scope',403);
    }
    const profileBinding=reuse||root?.active&&!scopeChanged?null:await this.features.ensureProfile(team.id,{sourceTeamId:source.id,kind:command.kind,club_choice:command.clubChoice,revision:command.revision,prepare:true},createTeam?team:null);
    return {team,root,createTeam,reuse,scopeMode,seasonIds,scopeChanged,profileBinding};
  }
  async createLegacyAttachment(teamId,body){
    if(!body||typeof body.season_id!=='string'||!body.season_id.trim()||body.season_id.length>128)throw invalid('Choose an existing season for this saved connection request.','invalid_request');
    const result=await this.create({request_id:body.request_id??crypto.randomUUID(),team_id:teamId,source_team_id:body.source_team_id,account_id:body.account_id??null,kind:body.kind??'own',revision:body.revision,club_choice:body.club_choice,connection_generation:body.connection_generation},{legacySeasonId:body.season_id});
    const attachment=await this.db.prepare('SELECT a.* FROM team_connection_seasons m JOIN team_source_attachments a ON a.id=m.attachment_id WHERE m.connection_id=? AND m.team_season_id=? AND m.active=1 AND m.excluded=0').bind(result.connection_id,body.season_id).first();
    return {...result,attachment};
  }
  async create(body,options={}){
    this.ownerOnly();const command=await normalizeConnectionCommand(body,options);
    let saved=await this.receipt(command),replayed=!!saved;
    const source=await this.source(command.sourceId,command.accountId);
    if(!saved){
      let prepared=await this.prepare(command,source);
      try{await commitConnectionCommand(this.repo,{command,source,...prepared,precondition:this.sessionCondition()});}
      catch(error){
        // An uncertain commit is only a replay if the immutable receipt exists.
        saved=await this.receipt(command);
        if(saved)replayed=true;
        else if(error.code==='revision_conflict'&&command.newTeam){
          // Two first-click request IDs may have selected the same source. The
          // loser records an open-existing receipt, never a second empty team.
          prepared=await this.prepare(command,source);
          if(!prepared.reuse)throw error;
          await commitConnectionCommand(this.repo,{command,source,...prepared,precondition:this.sessionCondition()});
        }else throw error;
      }
      if(!saved)saved=await this.receipt(command);
      if(!saved)throw invalid('The connection did not commit. Retry this request.','revision_conflict',409);
    }
    await this.assertSession();
    // A persisted root remains recoverable if queue delivery fails here. A
    // replay can repair demand only while this exact receipt generation is live.
    const queued=await this.sync.syncConnection(saved.connection_id,{wake:false,generation:saved.connection_generation});
    await this.sync.wake();
    const connection={id:saved.connection_id,app_team_id:saved.team_id,source_team_id:source.id,account_id:source.account_id,scope_mode:saved.scope_mode,scope_origin:saved.scope_origin,active:1,generation:saved.connection_generation};
    return {team_id:saved.team_id,season_id:saved.season_id??null,connection,connection_id:connection.id,queued:true,replayed,outcome:saved.outcome,...(queued?.source_collection_blocked?{source_collection_blocked:queued.source_collection_blocked}:{}),...(queued?.jobIds?{job_ids:queued.jobIds}:{})};
  }
}
