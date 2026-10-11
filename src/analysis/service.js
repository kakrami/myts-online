import { DomainRepository } from '../domain/repository.js';
import { AnalysisReads, publicPlayerFact } from './reads.js';
import { invalid } from '../read-model/selection.js';
import { activeAnalysisWrite } from './write-scope.js';
const parse=v=>JSON.parse(v||'{}');
const POSITION=new Set(['GK','DEF','MID','FWD','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','LF','RF','ST','CF']);
export class AnalysisService {
  constructor(db,actor,options={}){this.db=db;this.actor=actor;this.reads=new AnalysisReads(db,actor,options);this.repo=new DomainRepository(db);this.enqueueRefresh=options.enqueueRefresh||null;}
  owner(){if(!this.actor?.owner)throw invalid('Only the owner can edit analysis.','owner_required',403);}
  async scope(input,{kind,eventId='',playerId=''}) {
    const {selection}=await this.reads.base.context(input);
    if(eventId&&!await this.db.prepare('SELECT 1 AS ok FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(selection.team_id,selection.team_season_id,eventId).first())throw invalid('This match is unavailable.','not_found',404);
    if(playerId&&!await this.db.prepare('SELECT 1 AS ok FROM team_players WHERE app_team_id=? AND team_season_id=? AND player_id=?').bind(selection.team_id,selection.team_season_id,playerId).first())throw invalid('This player is unavailable.','not_found',404);
    return {selection,kind,eventId,playerId,params:[selection.team_id,selection.team_season_id,kind,eventId,playerId]};
  }
  async override(scope){const row=await this.db.prepare('SELECT * FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=?').bind(...scope.params).first();return row?{revision:row.revision,fields:parse(row.fields)}:{revision:0,fields:{}};}
  async editor(input,ids) {
    const scope=await this.scope(input,ids),correction=await this.override(scope);
    const source=ids.kind==='player_season'?(await this.reads.summary(input,ids.playerId)).data:publicPlayerFact(await this.db.prepare('SELECT * FROM effective_player_matches WHERE app_team_id=? AND team_season_id=? AND event_id=? AND player_id=?').bind(scope.selection.team_id,scope.selection.team_season_id,ids.eventId,ids.playerId).first());
    return {selection:scope.selection,...correction,override:correction.fields,source:source||null,effective:source||null,player_id:ids.playerId||null,event_id:ids.eventId||null,team_id:scope.selection.team_id,team_season_id:scope.selection.team_season_id,kind:ids.kind,can_edit:!!this.actor.owner,pending:!source};
  }
  validate(kind,fields) {
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||!Object.keys(fields).length)throw invalid('Choose correction fields.');
    const allowed=kind==='match'?new Set(['duration_minutes','format']):kind==='player_season'?new Set(['position','jersey']):new Set(['minutes','field_minutes','gk_minutes','appearance','started','goals','assists','position']);
    if(Object.keys(fields).some(k=>!allowed.has(k)))throw invalid('Unsupported correction field.');
    const value={...fields};
    for(const [k,v]of Object.entries(value)){
      if(v===null)continue;
      if(k==='position'){if(typeof v!=='string'||!POSITION.has(v.toUpperCase()))throw invalid('Choose a supported position.');value[k]=v.toUpperCase();}
      else if(k==='jersey'){if(typeof v!=='string'||v.length>12)throw invalid('Enter a jersey number of at most 12 characters.');value[k]=v.trim();}
      else if(k==='format'){if(![7,9,11].includes(v))throw invalid('Choose 7, 9 or 11 players.');}
      else if(['appearance','started'].includes(k)){if(![0,1,true,false].includes(v))throw invalid('Choose Yes or No.');value[k]=Number(v);}
      else if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>(['goals','assists'].includes(k)?100:240)||(['goals','assists'].includes(k)&&!Number.isInteger(v)))throw invalid('Enter a valid nonnegative correction.');
    }
    return value;
  }
  async set(input,ids,fields,revision) {
    this.owner();const scope=await this.scope(input,ids),old=await this.override(scope);
    if(!Number.isSafeInteger(revision)||revision<0||old.revision!==revision)throw invalid('The correction changed. Reload.','revision_conflict',409);
    // Partial forms preserve every field already corrected; source refreshes never touch this table.
    const value={...old.fields,...this.validate(ids.kind,fields)};for(const k of Object.keys(value))if(value[k]===null)delete value[k];
    if(Object.hasOwn(value,'field_minutes')!==Object.hasOwn(value,'gk_minutes'))throw invalid('Set or reset field and goalkeeper minutes together.');
    if(value.field_minutes!==undefined&&value.minutes!==undefined&&Math.abs(value.field_minutes+value.gk_minutes-value.minutes)>.01)throw invalid('Field and goalkeeper minutes must add up to total minutes.');
    if(!Object.keys(value).length&&revision)return this.reset(input,ids,revision);
    if(!Object.keys(value).length)return {revision:0,fields:{},queued:false};
    const encoded=JSON.stringify(value),at=new Date().toISOString();
    await this.repo.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO analysis_overrides SELECT ?,?,?,?,?,?,1,? WHERE ?=0 AND ${guard} ON CONFLICT(app_team_id,team_season_id,kind,event_id,player_id) DO NOTHING`).bind(...scope.params,encoded,at,revision,token),
      this.db.prepare(`UPDATE analysis_overrides SET fields=?,revision=revision+1,updated_at=? WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=? AND ?>0 AND ${guard}`).bind(encoded,at,...scope.params,revision,revision,token),
      this.db.prepare(`UPDATE team_read_state SET status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(scope.selection.team_id,token),
    ],activeAnalysisWrite(scope.selection,{sql:revision===0?'NOT EXISTS(SELECT 1 FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=?)':'EXISTS(SELECT 1 FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=?)',params:[...scope.params,...(revision===0?[]:[revision])]},{eventId:scope.eventId,playerId:scope.playerId}));
    if(this.enqueueRefresh)await this.enqueueRefresh({teamId:scope.selection.team_id,seasonId:scope.selection.team_season_id,eventId:ids.eventId||null,playerId:ids.playerId||null});
    return {revision:revision+1,fields:value,queued:!!this.enqueueRefresh};
  }
  async reset(input,ids,revision,{fields=null}={}) {
    this.owner();const scope=await this.scope(input,ids),old=await this.override(scope);if(old.revision!==revision||!revision)throw invalid('The correction changed. Reload.','revision_conflict',409);
    let remaining={};if(fields!==null){if(!Array.isArray(fields)||!fields.length||fields.some(k=>typeof k!=='string'||!Object.hasOwn(old.fields,k)))throw invalid('Choose existing correction fields to reset.');remaining={...old.fields};for(const k of fields)delete remaining[k];}
    await this.repo.domainBatch((guard,token)=>[
      Object.keys(remaining).length?this.db.prepare(`UPDATE analysis_overrides SET fields=?,revision=revision+1,updated_at=? WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=? AND ${guard}`).bind(JSON.stringify(remaining),new Date().toISOString(),...scope.params,revision,token):this.db.prepare(`DELETE FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=? AND ${guard}`).bind(...scope.params,revision,token),
      this.db.prepare(`UPDATE team_read_state SET status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(scope.selection.team_id,token),
    ],activeAnalysisWrite(scope.selection,{sql:'EXISTS(SELECT 1 FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=?)',params:[...scope.params,revision]},{eventId:scope.eventId,playerId:scope.playerId}));
    if(this.enqueueRefresh)await this.enqueueRefresh({teamId:scope.selection.team_id,seasonId:scope.selection.team_season_id,eventId:ids.eventId||null,playerId:ids.playerId||null});
    return {revision:Object.keys(remaining).length?revision+1:0,fields:remaining,queued:!!this.enqueueRefresh};
  }
  async lineup(input,eventId,options={}) {return this.reads.lineup(input,eventId,options);}
  async setLineup(input,eventId,{format,assignments,revision}) {
    this.owner();const scope=await this.scope(input,{kind:'match',eventId}),s=scope.selection;
    if(![7,9].includes(format)||!Number.isSafeInteger(revision)||revision<0||!Array.isArray(assignments)||assignments.length>200)throw invalid('Choose a valid format and lineup.');
    const seenPlayers=new Set(),seenSlots=new Set(),goalkeepers=new Set(),fields={1:0,2:0};
    const rows=assignments.map(value=>{
      const {half,player_id,slot_kind,slot}=value,position=value.position||'';
      if(![1,2].includes(half)||typeof player_id!=='string'||!['field','bench'].includes(slot_kind)||!Number.isInteger(slot)||slot<1||slot>(slot_kind==='field'?format:100)||(position&&!POSITION.has(position)))throw invalid('A lineup assignment is invalid.');
      const playerKey=half+':'+player_id,slotKey=half+':'+slot_kind+':'+slot;if(seenPlayers.has(playerKey)||seenSlots.has(slotKey))throw invalid('Assign each player and slot once per half.');seenPlayers.add(playerKey);seenSlots.add(slotKey);
      if(slot_kind==='field'){fields[half]++;if(position==='GK'){if(goalkeepers.has(half))throw invalid('Choose one goalkeeper per half.');goalkeepers.add(half);}}
      return {half,player_id,slot_kind,slot,position};
    });
    if(fields[1]>format||fields[2]>format)throw invalid('The lineup exceeds its playing format.');
    const owned=(await this.db.prepare(`SELECT value AS player_id FROM json_each(?) WHERE value NOT IN(SELECT player_id FROM team_players WHERE app_team_id=? AND team_season_id=?) OR EXISTS(SELECT 1 FROM canonical_player_ids c WHERE c.input_id=value AND c.canonical_id<>value) LIMIT 1`).bind(JSON.stringify([...new Set(rows.map(v=>v.player_id))]),s.team_id,s.team_season_id).first());if(owned)throw invalid('A lineup identity changed. Reload and choose the canonical player.','identity_conflict',409);
    const old=await this.db.prepare('SELECT revision FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(s.team_id,s.team_season_id,eventId).first();if((old?.revision||0)!==revision)throw invalid('The lineup changed. Reload.','revision_conflict',409);
    await this.repo.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO analysis_lineup_headers SELECT ?,?,?,?,1,? WHERE ?=0 AND ${guard} ON CONFLICT(app_team_id,team_season_id,event_id) DO NOTHING`).bind(s.team_id,s.team_season_id,eventId,format,new Date().toISOString(),revision,token),
      this.db.prepare(`UPDATE analysis_lineup_headers SET format=?,revision=revision+1,updated_at=? WHERE app_team_id=? AND team_season_id=? AND event_id=? AND revision=? AND ?>0 AND ${guard}`).bind(format,new Date().toISOString(),s.team_id,s.team_season_id,eventId,revision,revision,token),
      this.db.prepare(`DELETE FROM analysis_lineup_assignments WHERE app_team_id=? AND team_season_id=? AND event_id=? AND ${guard}`).bind(s.team_id,s.team_season_id,eventId,token),
      this.db.prepare(`INSERT INTO analysis_lineup_assignments SELECT ?,?,?,json_extract(value,'$.half'),json_extract(value,'$.player_id'),json_extract(value,'$.slot_kind'),json_extract(value,'$.slot'),json_extract(value,'$.position') FROM json_each(?) WHERE ${guard}`).bind(s.team_id,s.team_season_id,eventId,JSON.stringify(rows),token),
      this.db.prepare(`UPDATE team_read_state SET content_revision=content_revision+1,status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(s.team_id,token),
    ],activeAnalysisWrite(s,{sql:'COALESCE((SELECT revision FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=?),0)=?',params:[s.team_id,s.team_season_id,eventId,revision]},{eventId,playerIds:rows.map(v=>v.player_id)}));
    if(this.enqueueRefresh)await this.enqueueRefresh({teamId:s.team_id,seasonId:s.team_season_id,eventId});return {revision:revision+1,format,assignments:rows,queued:!!this.enqueueRefresh};
  }
  async resetLineup(input,eventId,revision) {
    this.owner();const scope=await this.scope(input,{kind:'match',eventId}),s=scope.selection;if(!Number.isSafeInteger(revision)||revision<1)throw invalid('Reload the lineup before resetting.','revision_conflict',409);
    await this.repo.domainBatch((guard,token)=>[this.db.prepare(`DELETE FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=? AND revision=? AND ${guard}`).bind(s.team_id,s.team_season_id,eventId,revision,token),this.db.prepare(`UPDATE team_read_state SET content_revision=content_revision+1,status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(s.team_id,token)],activeAnalysisWrite(s,{sql:'EXISTS(SELECT 1 FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=? AND revision=?)',params:[s.team_id,s.team_season_id,eventId,revision]},{eventId}));
    if(this.enqueueRefresh)await this.enqueueRefresh({teamId:s.team_id,seasonId:s.team_season_id,eventId});return {revision:0,format:null,assignments:[],queued:!!this.enqueueRefresh};
  }
}
