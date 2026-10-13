import {FORMAT_CHOICE_TIME,formatChoiceTime,publicCorrectionFields,ownerFormat} from './manual-format.js';
import { DomainRepository } from '../domain/repository.js';
import { AnalysisReads, publicPlayerFact, savedMatchAnalysis } from './reads.js';
import { invalid } from '../read-model/selection.js';
import { activeAnalysisWrite,analysisOwnerState,analysisScopeRevision } from './write-scope.js';
import {resolvePublishedGame,assertPublishedGameCurrent} from '../domain/team-game-scope.js';
import {acceptedGameSeason} from '../domain/game-season-state.js';
const parse=v=>JSON.parse(v||'{}');
const POSITION=new Set(['GK','DEF','MID','FWD','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','LF','RF','ST','CF']);
export class AnalysisService {
  constructor(db,actor,options={}){this.db=db;this.actor=actor;this.reads=new AnalysisReads(db,actor,options);this.repo=new DomainRepository(db);this.enqueueRefresh=options.enqueueRefresh||null;}
  owner(){if(!this.actor?.owner)throw invalid('Only the owner can edit analysis.','owner_required',403);}
  async scope(input,{kind,eventId='',playerId=''}) {
    const {selection}=await this.reads.base.context(input);
    let game=null,ownerState=null;
    if(eventId){game=await resolvePublishedGame(this.db,selection.team_id,selection.team_season_id,eventId);if(!game)throw invalid('This match is unavailable.','not_found',404);if(!game.available)throw invalid('This saved game changed. Reload.','game_scope_changed',409);eventId=game.event_id;ownerState=await analysisOwnerState(this.db,game);const accepted=acceptedGameSeason(selection.team_id,selection.team_season_id,eventId);if(!await this.db.prepare(`SELECT 1 AS ok FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=? AND (${accepted.sql})`).bind(selection.team_id,selection.team_season_id,eventId,...accepted.params).first())throw invalid('This match is unavailable.','not_found',404);}
    if(playerId&&!await this.db.prepare('SELECT 1 AS ok FROM team_players WHERE app_team_id=? AND team_season_id=? AND player_id=?').bind(selection.team_id,selection.team_season_id,playerId).first())throw invalid('This player is unavailable.','not_found',404);
    return {selection,kind,eventId,playerId,game,ownerState,stateEventId:ownerState?.state_event_id||eventId,params:[selection.team_id,selection.team_season_id,kind,ownerState?.state_event_id||eventId,playerId]};
  }
  async override(scope,{internal=false}={}){const row=await this.db.prepare('SELECT * FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=?').bind(...scope.params).first();return row?{revision:row.revision,fields:internal?parse(row.fields):publicCorrectionFields(parse(row.fields)),...(internal?{updated_at:row.updated_at}:{})}:{revision:0,fields:{}};}
  async editor(input,ids) {
    let scope;try{scope=await this.scope(input,ids);}catch(error){if(this.actor?.owner&&ids.eventId&&['game_scope_changed','not_found'].includes(error.code)){const saved=await this.savedEditor(input,ids);if(saved)return saved;}throw error;}const correction=await this.override(scope);
    const source=ids.kind==='player_season'?(await this.reads.summary(input,ids.playerId)).data:ids.kind==='match'?await this.db.prepare(`SELECT duration_minutes,format FROM ${savedMatchAnalysis} WHERE app_team_id=? AND team_season_id=? AND event_id=?`).bind(scope.selection.team_id,scope.selection.team_season_id,scope.eventId).first():publicPlayerFact(await this.db.prepare(`SELECT p.* FROM effective_player_matches p JOIN ${savedMatchAnalysis} a ON a.app_team_id=p.app_team_id AND a.team_season_id=p.team_season_id AND a.event_id=p.event_id AND a.active_run=p.run_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.event_id=? AND p.player_id=?`).bind(scope.selection.team_id,scope.selection.team_season_id,scope.eventId,scope.playerId).first());
    if(scope.game)await assertPublishedGameCurrent(this.db,scope.game);
    return {selection:scope.selection,...(scope.game?{game_scope_revision:await analysisScopeRevision(scope.game)}:{}),...correction,override:correction.fields,source:source||null,effective:source||null,player_id:ids.playerId||null,event_id:scope.eventId||null,team_id:scope.selection.team_id,team_season_id:scope.selection.team_season_id,kind:ids.kind,can_edit:!!this.actor.owner,pending:!source};
  }
  async savedEditor(input,{kind,eventId,playerId=''}) {
    this.owner();const {selection}=await this.reads.base.context(input);
    const row=await this.db.prepare('SELECT revision,fields FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=?').bind(selection.team_id,selection.team_season_id,kind,eventId,playerId).first();
    if(!row)return null;const fields=publicCorrectionFields(parse(row.fields));
    return {selection,kind,event_id:eventId,player_id:playerId||null,team_id:selection.team_id,team_season_id:selection.team_season_id,revision:row.revision,fields,override:fields,source:null,effective:fields,state_only:true,can_edit:false,pending:false,reason:'The source is unavailable. These original saved corrections are preserved.'};
  }
  async savedLineup(input,eventId,{half=1}={}) {
    this.owner();if(![1,2].includes(half))throw invalid('Choose a supported lineup half.');const {selection}=await this.reads.base.context(input),params=[selection.team_id,selection.team_season_id,eventId];
    const rows=await this.db.batch([this.db.prepare('SELECT format,revision,updated_at FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(...params),this.db.prepare('SELECT half,player_id,slot_kind,slot,position FROM analysis_lineup_assignments WHERE app_team_id=? AND team_season_id=? AND event_id=? ORDER BY half,slot_kind,slot LIMIT 201').bind(...params),this.db.prepare("SELECT fields,updated_at FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND event_id=? AND kind='match' AND player_id=''").bind(...params)]);
    const header=rows[0].results[0],correction=rows[2].results[0];if(!header&&!correction)return null;if(rows[1].results.length>200)throw invalid('The saved lineup exceeded its bound.','analysis_contract',409);
    const assignments=rows[1].results.map(row=>({...row,name:'Saved player',available:false})),format=ownerFormat(correction,header);
    return {event_id:eventId,revision:header?.revision||0,format,owner_format:format,published_format:null,state:'saved',state_only:true,can_edit:false,reason:'The source is unavailable. This original saved lineup is preserved.',halves:[1,2],half,roster:[],assignments,owner_assignments:assignments,slots:[],field:{},bench:[],layouts:{},analysis:null,review:null,roster_page:{items:[],total:0,next_cursor:null}};
  }
  validate(kind,fields) {
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||!Object.keys(fields).length)throw invalid('Choose correction fields.');
    const allowed=kind==='match'?new Set(['duration_minutes','format']):kind==='player_season'?new Set(['position','jersey']):new Set(['minutes','field_minutes','gk_minutes','appearance','started','goals','assists','position','slot_x','slot_y']);
    if(Object.keys(fields).some(k=>!allowed.has(k)))throw invalid('Unsupported correction field.');
    const value={...fields};
    for(const [k,v]of Object.entries(value)){
      if(v===null)continue;
      if(k==='position'){if(typeof v==='string'&&!v.trim()){value[k]=null;continue;}if(typeof v!=='string'||!POSITION.has(v.toUpperCase()))throw invalid('Choose a supported position.');value[k]=v.toUpperCase();}
      else if(k==='jersey'){if(typeof v!=='string'||v.length>12)throw invalid('Enter a jersey number of at most 12 characters.');value[k]=v.trim();}
      else if(k==='format'){if(![7,9].includes(v))throw invalid('Choose 7 or 9 players.');}
      else if(['slot_x','slot_y'].includes(k)){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100)throw invalid('Choose pitch coordinates from 0 to 100.');}
      else if(['appearance','started'].includes(k)){if(![0,1,true,false].includes(v))throw invalid('Choose Yes or No.');value[k]=Number(v);}
      else if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>(['goals','assists'].includes(k)?100:240)||(['goals','assists'].includes(k)&&!Number.isInteger(v)))throw invalid('Enter a valid nonnegative correction.');
    }
    return value;
  }
  async set(input,ids,fields,revision) {
    this.owner();const scope=await this.scope(input,ids);if(scope.game)await analysisScopeRevision(scope.game,input);const old=await this.override(scope,{internal:true});
    if(!Number.isSafeInteger(revision)||revision<0||old.revision!==revision)throw invalid('The correction changed. Reload.','revision_conflict',409);
    // Partial forms preserve every field already corrected; source refreshes never touch this table.
    const value={...old.fields,...this.validate(ids.kind,fields)};for(const k of Object.keys(value))if(value[k]===null)delete value[k];
    const at=new Date().toISOString();if(ids.kind==='match'){if(value.format!=null)value[FORMAT_CHOICE_TIME]=Object.hasOwn(fields,'format')?at:formatChoiceTime(old.fields,old.updated_at)||at;else delete value[FORMAT_CHOICE_TIME];}
    if(Object.hasOwn(value,'slot_x')!==Object.hasOwn(value,'slot_y'))throw invalid('Set or reset both pitch coordinates together.');
    if(value.field_minutes!==undefined&&value.gk_minutes!==undefined&&value.minutes!==undefined&&Math.abs(value.field_minutes+value.gk_minutes-value.minutes)>.01)throw invalid('Field and goalkeeper minutes must add up to total minutes.');
    if(!Object.keys(value).length&&revision)return this.reset(input,ids,revision);
    if(!Object.keys(value).length)return {revision:0,fields:{},queued:false};
    const encoded=JSON.stringify(value);
    await this.repo.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO analysis_overrides SELECT ?,?,?,?,?,?,1,? WHERE ?=0 AND ${guard} ON CONFLICT(app_team_id,team_season_id,kind,event_id,player_id) DO NOTHING`).bind(...scope.params,encoded,at,revision,token),
      this.db.prepare(`UPDATE analysis_overrides SET fields=?,revision=revision+1,updated_at=? WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=? AND ?>0 AND ${guard}`).bind(encoded,at,...scope.params,revision,revision,token),
      this.db.prepare(`UPDATE team_read_state SET status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(scope.selection.team_id,token),
    ],activeAnalysisWrite(scope.selection,{sql:revision===0?'NOT EXISTS(SELECT 1 FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=?)':'EXISTS(SELECT 1 FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=?)',params:[...scope.params,...(revision===0?[]:[revision])]},{eventId:scope.eventId,playerId:scope.playerId,game:scope.game,ownerState:scope.ownerState}));
    if(this.enqueueRefresh)await this.enqueueRefresh({teamId:scope.selection.team_id,seasonId:scope.selection.team_season_id,eventId:scope.eventId||null,playerId:ids.playerId||null});
    return {revision:revision+1,fields:publicCorrectionFields(value),queued:!!this.enqueueRefresh};
  }
  async reset(input,ids,revision,{fields=null}={}) {
    this.owner();const scope=await this.scope(input,ids);if(scope.game)await analysisScopeRevision(scope.game,input);const old=await this.override(scope,{internal:true});if(old.revision!==revision||!revision)throw invalid('The correction changed. Reload.','revision_conflict',409);
    let remaining={};if(fields!==null){if(!Array.isArray(fields)||!fields.length||fields.some(k=>typeof k!=='string'||k===FORMAT_CHOICE_TIME||!Object.hasOwn(old.fields,k)))throw invalid('Choose existing correction fields to reset.');remaining={...old.fields};for(const k of fields)delete remaining[k];if(fields.includes('slot_x')||fields.includes('slot_y')){delete remaining.slot_x;delete remaining.slot_y;}}
    if(ids.kind==='match'){if(remaining.format!=null)remaining[FORMAT_CHOICE_TIME]=formatChoiceTime(old.fields,old.updated_at);else delete remaining[FORMAT_CHOICE_TIME];}
    await this.repo.domainBatch((guard,token)=>[
      Object.keys(remaining).length?this.db.prepare(`UPDATE analysis_overrides SET fields=?,revision=revision+1,updated_at=? WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=? AND ${guard}`).bind(JSON.stringify(remaining),new Date().toISOString(),...scope.params,revision,token):this.db.prepare(`DELETE FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=? AND ${guard}`).bind(...scope.params,revision,token),
      this.db.prepare(`UPDATE team_read_state SET status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(scope.selection.team_id,token),
    ],activeAnalysisWrite(scope.selection,{sql:'EXISTS(SELECT 1 FROM analysis_overrides WHERE app_team_id=? AND team_season_id=? AND kind=? AND event_id=? AND player_id=? AND revision=?)',params:[...scope.params,revision]},{eventId:scope.eventId,playerId:scope.playerId,game:scope.game,ownerState:scope.ownerState}));
    if(this.enqueueRefresh)await this.enqueueRefresh({teamId:scope.selection.team_id,seasonId:scope.selection.team_season_id,eventId:scope.eventId||null,playerId:ids.playerId||null});
    return {revision:Object.keys(remaining).length?revision+1:0,fields:publicCorrectionFields(remaining),queued:!!this.enqueueRefresh};
  }
  async lineup(input,eventId,options={}) {
    try{return await this.reads.lineup(input,eventId,options);}catch(error){if(this.actor?.owner&&['game_scope_changed','not_found'].includes(error.code)){const saved=await this.savedLineup(input,eventId,options);if(saved)return saved;}throw error;}
  }
  async setLineup(input,eventId,{format,assignments,revision}) {
    this.owner();const scope=await this.scope(input,{kind:'match',eventId}),s=scope.selection;await analysisScopeRevision(scope.game,input);eventId=scope.stateEventId;
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
    // Unlink can hide an existing owner row from the current roster. Preserve
    // that exact saved intent, but never grant a new/changed unavailable identity.
    const rowScope={sql:`NOT EXISTS(SELECT 1 FROM json_each(?) chosen WHERE NOT EXISTS(SELECT 1 FROM team_players p JOIN canonical_player_ids c ON c.input_id=p.player_id AND c.canonical_id=p.player_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.player_id=json_extract(chosen.value,'$.player_id')) AND NOT EXISTS(SELECT 1 FROM analysis_lineup_assignments saved WHERE saved.app_team_id=? AND saved.team_season_id=? AND saved.event_id=? AND saved.player_id=json_extract(chosen.value,'$.player_id') AND saved.half=json_extract(chosen.value,'$.half') AND saved.slot_kind=json_extract(chosen.value,'$.slot_kind') AND saved.slot=json_extract(chosen.value,'$.slot') AND saved.position=json_extract(chosen.value,'$.position')))`,params:[JSON.stringify(rows),s.team_id,s.team_season_id,s.team_id,s.team_season_id,eventId]};
    if(!(await this.db.prepare(`SELECT ${rowScope.sql} AS allowed`).bind(...rowScope.params).first()).allowed)throw invalid('A lineup identity changed. Reload and choose an available canonical player.','identity_conflict',409);
    const old=await this.db.prepare('SELECT revision FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(s.team_id,s.team_season_id,eventId).first();if((old?.revision||0)!==revision)throw invalid('The lineup changed. Reload.','revision_conflict',409);
    await this.repo.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO analysis_lineup_headers SELECT ?,?,?,?,1,? WHERE ?=0 AND ${guard} ON CONFLICT(app_team_id,team_season_id,event_id) DO NOTHING`).bind(s.team_id,s.team_season_id,eventId,format,new Date().toISOString(),revision,token),
      this.db.prepare(`UPDATE analysis_lineup_headers SET format=?,revision=revision+1,updated_at=? WHERE app_team_id=? AND team_season_id=? AND event_id=? AND revision=? AND ?>0 AND ${guard}`).bind(format,new Date().toISOString(),s.team_id,s.team_season_id,eventId,revision,revision,token),
      this.db.prepare(`DELETE FROM analysis_lineup_assignments WHERE app_team_id=? AND team_season_id=? AND event_id=? AND ${guard}`).bind(s.team_id,s.team_season_id,eventId,token),
      this.db.prepare(`INSERT INTO analysis_lineup_assignments SELECT ?,?,?,json_extract(value,'$.half'),json_extract(value,'$.player_id'),json_extract(value,'$.slot_kind'),json_extract(value,'$.slot'),json_extract(value,'$.position') FROM json_each(?) WHERE ${guard}`).bind(s.team_id,s.team_season_id,eventId,JSON.stringify(rows),token),
      this.db.prepare(`UPDATE team_read_state SET content_revision=content_revision+1,status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(s.team_id,token),
    ],activeAnalysisWrite(s,{sql:`COALESCE((SELECT revision FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=?),0)=? AND (${rowScope.sql})`,params:[s.team_id,s.team_season_id,eventId,revision,...rowScope.params]},{eventId:scope.eventId,game:scope.game,ownerState:scope.ownerState}));
    if(this.enqueueRefresh)await this.enqueueRefresh({teamId:s.team_id,seasonId:s.team_season_id,eventId:scope.eventId});return {revision:revision+1,format,assignments:rows,queued:!!this.enqueueRefresh};
  }
  async resetLineup(input,eventId,revision) {
    this.owner();const scope=await this.scope(input,{kind:'match',eventId}),s=scope.selection;await analysisScopeRevision(scope.game,input);eventId=scope.stateEventId;if(!Number.isSafeInteger(revision)||revision<1)throw invalid('Reload the lineup before resetting.','revision_conflict',409);
    await this.repo.domainBatch((guard,token)=>[this.db.prepare(`DELETE FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=? AND revision=? AND ${guard}`).bind(s.team_id,s.team_season_id,eventId,revision,token),this.db.prepare(`UPDATE team_read_state SET content_revision=content_revision+1,status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(s.team_id,token)],activeAnalysisWrite(s,{sql:'EXISTS(SELECT 1 FROM analysis_lineup_headers WHERE app_team_id=? AND team_season_id=? AND event_id=? AND revision=?)',params:[s.team_id,s.team_season_id,eventId,revision]},{eventId:scope.eventId,game:scope.game,ownerState:scope.ownerState}));
    if(this.enqueueRefresh)await this.enqueueRefresh({teamId:s.team_id,seasonId:s.team_season_id,eventId:scope.eventId});return {revision:0,format:null,assignments:[],queued:!!this.enqueueRefresh};
  }
}
