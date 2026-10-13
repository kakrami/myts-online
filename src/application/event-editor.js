import {invalid} from '../read-model/selection.js';
import {DomainRepository} from '../domain/repository.js';
import {resolvePublishedGame,captureGameOwnerState,gameScopeRevision,gameScopeFenceSQL,gameOwnerStateFenceSQL,assertPublishedGameCurrent} from '../domain/team-game-scope.js';

export class EventEditor {
  constructor(db,actor,{reads,sync}={}){this.db=db;this.actor=actor;this.reads=reads;this.sync=sync;this.domain=new DomainRepository(db);}
  owner(){if(!this.actor.owner)throw invalid('Sign in as the owner to edit this match.','owner_required',403);}
  async scope(input,eventId,{saved=false}={}){
    this.owner();const {selection}=await this.reads.context(input);
    let game,ownerState;
    try{
      game=await resolvePublishedGame(this.db,selection.team_id,selection.team_season_id,eventId);
      if(!game?.available)throw invalid('This match changed. Reload its saved game.','game_scope_changed',409);
      ownerState=await captureGameOwnerState(this.db,game,{kinds:['domain_overrides']});
    }catch(error){
      if(saved&&['game_scope_changed','game_scope_ambiguous','game_owner_state_bound'].includes(error.code)){
        // Only the exact requested original key is readable without live scope.
        // Do not remap it or attach current provider fields to saved owner data.
        const override=await this.domain.getOverride({teamId:selection.team_id,kind:'event',entityId:eventId});
        if(override.revision)return {selection,entityId:eventId,override,stateOnly:true,reason:game?.reason??error.code};
      }
      throw error;
    }
    const revision=await gameScopeRevision(game);
    return {selection,event:game,game,ownerState,entityId:ownerState.event_ids[0]??game.event_id,game_scope_revision:revision};
  }
  async read(input,eventId){
    const scope=await this.scope(input,eventId,{saved:true}),{selection,event,entityId,ownerState}=scope;
    if(scope.stateOnly)return {revision:scope.override.revision,override:scope.override.fields,effective:null,team_id:selection.team_id,team_season_id:selection.team_season_id,id:entityId,timezone:selection.timezone,game_scope_revision:null,state_only:true,available:false,can_edit:false,reason:scope.reason};
    const conflict=ownerState.conflict,row=conflict?null:ownerState.records.domain_overrides[0];
    await assertPublishedGameCurrent(this.db,scope.game);
    return {revision:row?.revision??0,override:row?JSON.parse(row.fields):{},effective:{home_score:event.home_score,away_score:event.away_score,venue:event.venue,status:event.status,starts_at:event.starts_at,local_day:event.local_day},team_id:selection.team_id,team_season_id:selection.team_season_id,id:event.event_id,timezone:selection.timezone,game_scope_revision:scope.game_scope_revision,available:true,state_only:false,can_edit:!conflict&&!event.pending,...(conflict?{identity_conflict:{kind:'game_corrections',event_ids:ownerState.event_ids},reason:'Saved corrections exist on independent original matches.'}:{})};
  }
  writeScope(scope,input){
    if((input.game_scope_revision!==undefined||scope.game.team_game_version===1)&&input.game_scope_revision!==scope.game_scope_revision)throw invalid('This game changed since the editor was opened. Reload its saved values.','game_scope_changed',409);
    if(scope.ownerState.conflict)throw invalid('This game has corrections on independent original matches. Resolve its saved state before editing.','game_owner_state_conflict',409);
    const membership=gameScopeFenceSQL(scope.game),owners=gameOwnerStateFenceSQL(scope.ownerState);
    return {teamId:scope.selection.team_id,kind:'event',entityId:scope.entityId,scopeEntityId:scope.game.event_id,seasonId:scope.selection.team_season_id,precondition:{sql:`(${membership.sql}) AND (${owners.sql})`,params:[...membership.params,...owners.params]}};
  }
  async save(input,eventId,fields,revision){const scope=await this.scope(input,eventId),write=this.writeScope(scope,input);
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(k=>!['home_score','away_score','venue','status','starts_at','local_day'].includes(k)))throw invalid('Choose supported match correction fields.');
    if(!Number.isSafeInteger(revision)||revision<0)throw invalid('Reload this match before editing.','revision_invalid');
    if(fields.status!=null&&!['SCHEDULED','FINAL','COMPLETED','CANCELLED','UNKNOWN'].includes(fields.status))throw invalid('Choose a supported match status.');
    if(fields.venue!=null&&(typeof fields.venue!=='string'||fields.venue.length>1000))throw invalid('Enter a location below 1,000 characters.');
    const values=Object.fromEntries(Object.entries(fields).filter(([,value])=>value!==null&&value!==''));
    const result=Object.keys(values).length?await this.domain.setOverride({...write,fields:values,revision}):await this.clear(scope,write,revision);
    return this.publish(result);
  }
  async clear(scope,write,revision){
    const current=scope.ownerState.records.domain_overrides[0];
    if((current?.revision??0)!==revision)throw invalid('This match changed. Reload it before saving.','revision_conflict',409);
    if(revision)return this.domain.resetOverride({...write,revision});
    // Empty resets still compare the exact membership and absence of owner rows
    // at commit, so an intervening original correction cannot become a no-op.
    await this.domain.domainBatch(()=>[],write.precondition);return {revision:0,affectedTeams:[]};
  }
  async reset(input,eventId,revision){const scope=await this.scope(input,eventId),write=this.writeScope(scope,input);if(!Number.isSafeInteger(revision)||revision<0)throw invalid('Reload this match before editing.','revision_invalid');return this.publish(await this.clear(scope,write,revision));}
  async publish(result){if(!this.sync)throw invalid('Background publication is unavailable.','sync_unavailable',503);for(const affected of result.affectedTeams??[])await this.sync.enqueueProjection(affected.app_team_id,affected.team_season_id,{wake:false});if(result.affectedTeams?.length)await this.sync.wake();return {...result,queued:!!result.affectedTeams?.length};}
}
