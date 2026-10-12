import {invalid} from '../read-model/selection.js';
import {DomainRepository} from '../domain/repository.js';

export class EventEditor {
  constructor(db,actor,{reads,sync}={}){this.db=db;this.actor=actor;this.reads=reads;this.sync=sync;this.domain=new DomainRepository(db);}
  owner(){if(!this.actor.owner)throw invalid('Sign in as the owner to edit this match.','owner_required',403);}
  async scope(input,eventId){this.owner();const {selection}=await this.reads.context(input),canonical=(await this.db.prepare('SELECT canonical_id FROM canonical_event_ids WHERE input_id=?').bind(eventId).first())?.canonical_id??eventId;const event=await this.db.prepare('SELECT * FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(selection.team_id,selection.team_season_id,canonical).first();if(!event)throw invalid('This match is unavailable.','not_found',404);return {selection,event,entityId:canonical};}
  async read(input,eventId){const {selection,event,entityId}=await this.scope(input,eventId),override=await this.domain.getOverride({teamId:selection.team_id,kind:'event',entityId});return {revision:override.revision,override:override.fields,effective:{home_score:event.home_score,away_score:event.away_score,venue:event.venue,status:event.status,starts_at:event.starts_at,local_day:event.local_day},team_id:selection.team_id,team_season_id:selection.team_season_id,id:entityId,timezone:selection.timezone};}
  async save(input,eventId,fields,revision){const {selection,entityId}=await this.scope(input,eventId);
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(k=>!['home_score','away_score','venue','status','starts_at','local_day'].includes(k)))throw invalid('Choose supported match correction fields.');
    if(!Number.isSafeInteger(revision)||revision<0)throw invalid('Reload this match before editing.','revision_invalid');
    if(fields.status!=null&&!['SCHEDULED','FINAL','COMPLETED','CANCELLED','UNKNOWN'].includes(fields.status))throw invalid('Choose a supported match status.');
    if(fields.venue!=null&&(typeof fields.venue!=='string'||fields.venue.length>1000))throw invalid('Enter a location below 1,000 characters.');
    const values=Object.fromEntries(Object.entries(fields).filter(([,value])=>value!==null&&value!==''));
    const result=Object.keys(values).length?await this.domain.setOverride({teamId:selection.team_id,kind:'event',entityId,fields:values,revision}):revision>0?await this.domain.resetOverride({teamId:selection.team_id,kind:'event',entityId,revision}):{revision:0,affectedTeams:[]};
    return this.publish(result);
  }
  async reset(input,eventId,revision){const {selection,entityId}=await this.scope(input,eventId);if(!Number.isSafeInteger(revision)||revision<0)throw invalid('Reload this match before editing.','revision_invalid');const current=await this.domain.getOverride({teamId:selection.team_id,kind:'event',entityId});if(current.revision!==revision)throw invalid('This match changed. Reload it before saving.','revision_conflict',409);return this.publish(revision?await this.domain.resetOverride({teamId:selection.team_id,kind:'event',entityId,revision}):{revision:0,affectedTeams:[]});}
  async publish(result){if(!this.sync)throw invalid('Background publication is unavailable.','sync_unavailable',503);for(const affected of result.affectedTeams??[])await this.sync.enqueueProjection(affected.app_team_id,affected.team_season_id,{wake:false});if(result.affectedTeams?.length)await this.sync.wake();return {...result,queued:!!result.affectedTeams?.length};}
}
