import {DomainRepository} from '../domain/repository.js';
import {nativeCanonicalId} from '../domain/identity.js';
import {invalid} from '../read-model/selection.js';

const SESSION_CONDITION=`EXISTS(SELECT 1 FROM security_sessions s JOIN security_owner o ON o.id=1 WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.password_revision=o.password_revision)`;
const text=(value,label,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw invalid('Enter a valid '+label+'.','invalid_request');return value.trim();};
const mismatch=()=>invalid('This connection request was already used for a different selection. Start a new connection.','idempotency_conflict',409);
const requestKey=value=>{const key=text(value,'connection request',128);if(!/^[A-Za-z0-9_.-]+$/.test(key))throw invalid('Invalid connection request.','invalid_request');return key;};

/** Owner-only, bounded create-and-connect command. No provider network work runs here. */
export class ConnectionService {
  constructor(db,{features,sync,owner,now=Date.now}){this.db=db;this.features=features;this.sync=sync;this.owner=owner;this.now=now;this.repo=new DomainRepository(db);}
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
  async receipt(requestId,expectedTeamId){
    const team=await this.db.prepare(`SELECT t.id,s.id AS season_id,l.state AS lifecycle FROM app_teams t LEFT JOIN team_seasons s ON s.app_team_id=t.id AND s.year=t.season_year LEFT JOIN team_lifecycle l ON l.team_id=t.id WHERE t.request_id=?`).bind(requestId).first();
    if(team&&team.id!==expectedTeamId)throw mismatch();
    if(team&&(team.lifecycle||!team.season_id))throw invalid('This connection team is no longer available. Start a new connection.','connection_unavailable',409);
    return team;
  }
  async readReceipt(value){
    if(this.owner?.role!=='owner'||!this.owner.session_id)throw invalid('Sign in as the owner to check a connection.','owner_required',403);
    const requestId=requestKey(value),team=await this.db.prepare(`SELECT t.id,s.id AS season_id,l.state AS lifecycle FROM app_teams t LEFT JOIN team_seasons s ON s.app_team_id=t.id AND s.year=t.season_year LEFT JOIN team_lifecycle l ON l.team_id=t.id WHERE t.request_id=?`).bind(requestId).first();
    if(!team)return {found:false};
    // The original command attachment has a stable ID, so later attachments
    // cannot be mistaken for its receipt. Reading never restores or queues it.
    const attachmentId=await nativeCanonicalId('connection-attachment',team.id);
    const attachment=await this.db.prepare('SELECT a.id,a.active,a.account_id,p.active AS account_active FROM team_source_attachments a LEFT JOIN provider_accounts p ON p.id=a.account_id WHERE a.id=? AND a.app_team_id=?').bind(attachmentId,team.id).first();
    return {found:true,team_id:team.id,season_id:team.season_id??null,team_available:!team.lifecycle&&!!team.season_id,attachment_id:attachment?.id??null,attachment_active:attachment?.active===1,account_active:attachment?.account_id?attachment.account_active===1:null};
  }
  async create(body){
    if(this.owner?.role!=='owner'||!this.owner.session_id)throw invalid('Sign in as the owner to connect a team.','owner_required',403);
    if(!body||typeof body!=='object'||Array.isArray(body)||body.team_id!=null||body.season_id!=null||!body.new_team||typeof body.new_team!=='object'||Array.isArray(body.new_team))throw invalid('Choose a new team for this connection.','invalid_request');
    const requestId=requestKey(body.request_id);
    const sourceId=text(body.source_team_id,'source team',512),accountId=body.account_id==null?null:text(body.account_id,'provider account',128);
    const name=text(body.new_team.name,'team name',100),timezone=body.new_team.timezone??'America/Los_Angeles',seasonYear=body.new_team.season_year??null,kind=body.new_team.kind??'own';
    if(typeof timezone!=='string'||timezone.length>100||!['own','followed'].includes(kind)||(seasonYear!==null&&(!Number.isInteger(seasonYear)||seasonYear<2000||seasonYear>2100)))throw invalid('Choose a supported team type, season and timezone.','invalid_request');
    // The existing UNIQUE request_id is the durable key. The immutable team ID
    // binds its original normalized command, even after the team is renamed or
    // its profile changes; no new table or mutable profile field is a receipt.
    const teamId=await nativeCanonicalId('connection',JSON.stringify({request_id:requestId,source_team_id:sourceId,account_id:accountId,new_team:{name,timezone,season_year:seasonYear,kind}}));
    const prepared=this.repo.prepareTeam({name,timezone,seasonYear,requestId,teamId});
    const source=await this.source(sourceId,accountId);
    let saved=await this.receipt(requestId,teamId),attachment,replayed=!!saved;
    if(!saved){
      const profileBinding=await this.features.ensureProfile(teamId,{sourceTeamId:sourceId,kind,prepare:true},prepared);
      try{
        attachment=await this.repo.createConnectedTeam({team:prepared,source,accountGeneration:source.account_generation,profileBinding,precondition:this.sessionCondition()});
        saved={id:teamId,season_id:prepared.season_id};
      }catch(error){
        // This also handles an uncertain D1 acknowledgement: only a committed,
        // matching receipt can turn an error into a replay. Never recreate it.
        saved=await this.receipt(requestId,teamId);
        if(!saved)throw error;
        replayed=true;
      }
    }
    if(!attachment){
      attachment=await this.db.prepare('SELECT * FROM team_source_attachments WHERE app_team_id=? AND team_season_id=? AND source_team_id=? AND account_id IS ? AND active=1').bind(saved.id,saved.season_id,sourceId,accountId).first();
      if(!attachment)throw invalid('This connection was removed. Start a new connection.','connection_unavailable',409);
      attachment={...attachment,affectedTeams:[{app_team_id:saved.id,team_season_id:saved.season_id}]};
    }
    await this.assertSession();
    // A retry always repairs missing queue demand after a committed connection.
    // Queued means durably accepted for background import, not imported data.
    await this.sync.syncAttachment(attachment.id,{wake:false});
    await this.sync.enqueueProjection(saved.id,saved.season_id,{wake:false});
    await this.sync.wake();
    return {team_id:saved.id,season_id:saved.season_id,attachment,queued:true,replayed};
  }
}
