import {FreshInstallation,InstallationError,installationSchema} from './fresh-install.js';
import {InstallationUpgrade as PredecessorInstallation,schemaObjects,equalObjects,metadataQuery,V714_FINGERPRINT} from './schema-upgrade-v731.js';
import {V731_FINGERPRINT,V731_PLAN_HASH,V731_CURSOR,V731_OBJECTS,V731_SCHEMA,V731_SEED} from './schema-v731.js';
import {SCHEMA,SEED,TEAM_GAME_EXPANSION_SCHEMA} from './installation-schema.js';
import {TEAM_GAME_EPOCH,TEAM_GAME_BOOTSTRAP_SCHEMA,TEAM_GAME_UPGRADE_DDL,TEAM_GAME_RUN_ALTER,TEAM_GAME_RUN_TARGET_DDL,teamGameInstallationIdentity} from './team-game-installation-epoch.js';
import {digest} from '../security/crypto.js';

const fail=(code,message,status=409)=>{throw new InstallationError(code,message,status);};
const foreign=()=>fail('installation_schema_mismatch','This database does not match the reviewed installation. No database changes were made.');
const maintenance=()=>fail('installation_maintenance','The installation is being updated. Existing data is preserved. Please try again shortly.',503);
const baseJournalFields=['epoch','from_fingerprint','to_fingerprint','plan_hash','phase','cursor','started_at','completed_at','original_started_at','original_completed_at','original_cursor','writer_mode','writer_epoch','permit_guard'];
const singleton=result=>result?.results?.length===1&&result.results[0].id===1;
const baseReceipt=journal=>Object.fromEntries(baseJournalFields.map(key=>[key,journal?.[key]??null]));
const plain=value=>JSON.stringify(value);
// Frozen predecessor FreshInstallation used 30 CREATE statements per batch; its
// journal seed ran before the final setup cursor update (720, not731).
const FRESH_731_FINAL_BATCH_CURSOR=Math.floor((V731_SCHEMA.length-1)/30)*30;

export function teamGameExpectedObjects(expansion,cursor){return schemaObjects([...V731_OBJECTS.map(row=>cursor>0&&row.name==='team_projection_runs'?TEAM_GAME_RUN_TARGET_DDL:row.sql),...TEAM_GAME_BOOTSTRAP_SCHEMA,...expansion.slice(0,cursor).filter(sql=>sql!==TEAM_GAME_RUN_ALTER)]);}

/** One exact additive extension of completed731. The predecessor receipt and
 * all original rows remain unchanged. Only the projection-run table gains
 * the immutable format column; its original columns are preserved. Fresh is a separate origin. */
export class TeamGameInstallation {
 constructor(db,{schema=SCHEMA,seed=SEED,bootstrapPassword,now=Date.now,batchSize=24,upgradeMode='normal'}={}){
  if(!['normal','maintenance'].includes(upgradeMode))fail('installation_mode_invalid','The installation maintenance setting is invalid. Application work is paused.',503);
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>24)throw new Error('Invalid upgrade batch size.');
  this.db=db;this.now=now;this.batchSize=batchSize;this.upgradeMode=upgradeMode;
  this.base=new PredecessorInstallation(db,{schema:V731_SCHEMA,seed:V731_SEED,bootstrapPassword,now,batchSize,upgradeMode});
  this.fresh=new FreshInstallation(db,{schema,seed,bootstrapPassword,now});this.schema=this.fresh.schema;this.fingerprint=this.fresh.fingerprint;
  this.planHash=teamGameInstallationIdentity().then(identity=>identity.planHash);
  this.bootstrapSchema=installationSchema([TEAM_GAME_BOOTSTRAP_SCHEMA]);this.expansion=TEAM_GAME_EXPANSION_SCHEMA.map(sql=>sql===TEAM_GAME_RUN_ALTER?sql:installationSchema([sql])[0]);
  this.targetObjects=teamGameExpectedObjects(this.expansion,this.expansion.length);
 }
 async identity(){const identity=await teamGameInstallationIdentity();if(identity.fingerprint!==await this.fingerprint)foreign();return identity;}
 async snapshot(){
  // Preserve the existing two-statement readiness budget. The full731 metadata
  // read and one setup/receipt read also capture the extension; no third query.
  const objects=(await this.db.prepare(metadataQuery).all()).results,names=objects.filter(row=>row.type==='table').map(row=>row.name);
  if(!names.includes('setup_state'))return {objects,names,row:null,journal:null,extension:null};
  const hasExtension=names.includes('installation_team_games_upgrade');
  if(hasExtension&&!equalObjects(objects.filter(row=>row.type==='table'&&row.name==='installation_team_games_upgrade'),schemaObjects([TEAM_GAME_UPGRADE_DDL])))foreign();
  const extensionFields=['id','epoch','record_version','origin','base_fingerprint','base_plan_hash','target_fingerprint','plan_hash','base_setup_started_at','base_setup_completed_at','base_cursor','base_journal_hash','phase','cursor','started_at','completed_at','assertion','writer_mode','writer_epoch','permit_guard'];
  const jsonObject=fields=>fields.flatMap(field=>["'"+field+"'",field]).join(',');
  const domain=names.includes('domain_installation')?',(SELECT count(*) FROM domain_installation WHERE id=1 AND schema_version=1) AS domain_seed_count':'';
  const legacy=names.includes('installation_upgrade')?`,(SELECT json_object(${jsonObject(baseJournalFields)}) FROM installation_upgrade WHERE id=1) AS upgrade_journal`:'';
  const extension=hasExtension?`,(SELECT json_object(${jsonObject(extensionFields)}) FROM installation_team_games_upgrade WHERE id=1) AS extension_journal`:'';
  const row=await this.db.prepare('SELECT schema_fingerprint,next_index,state,started_at,completed_at'+domain+legacy+extension+' FROM setup_state WHERE id=1').first();
  const journal=row?.upgrade_journal?JSON.parse(row.upgrade_journal):null,receipt=row?.extension_journal?JSON.parse(row.extension_journal):null;if(row){delete row.upgrade_journal;delete row.extension_journal;}
  return {objects,names,row,journal,extension:receipt};
 }
 assertBase(snapshot){
  const {row,journal}=snapshot;
  if(!row||row.schema_fingerprint!==V731_FINGERPRINT||row.next_index!==V731_CURSOR||row.state!=='ready'||row.domain_seed_count!==1||!row.started_at||!row.completed_at)foreign();
  if(!journal||journal.epoch!=='team-connections-v1'||journal.to_fingerprint!==V731_FINGERPRINT||journal.phase!=='complete'||journal.cursor!==''||!journal.started_at||!journal.completed_at||journal.original_started_at!==row.started_at||journal.writer_mode!==null||journal.writer_epoch!==null||journal.permit_guard!==null)foreign();
  if(journal.from_fingerprint===V714_FINGERPRINT&&journal.plan_hash===V731_PLAN_HASH&&journal.original_cursor===270&&journal.original_completed_at===row.completed_at)return 'migrated714';
  if(journal.from_fingerprint===null&&journal.plan_hash==='fresh'&&journal.original_cursor===FRESH_731_FINAL_BATCH_CURSOR&&journal.original_completed_at===null&&journal.started_at===row.started_at)return 'fresh731';
  foreign();
 }
 expectedObjects(extension){
  const cursor=extension.phase==='expanding'?extension.cursor:this.expansion.length;
  return teamGameExpectedObjects(this.expansion,cursor);
 }
 predecessorFrom(snapshot){
  // Reuse only the already captured read snapshot for the first old-engine
  // inspection. Later inspections still read D1; its SQL CAS is unchanged.
  const predecessor=Object.create(this.base);let initial=snapshot;
  predecessor.snapshot=async()=>{if(initial){const value=initial;initial=null;return value;}return this.base.snapshot();};
  return predecessor;
 }
 async inspectRecognized(){
  const identity=await this.identity(),snapshot=await this.snapshot(),{objects,names,row,journal,extension}=snapshot;
  if(!names.includes('setup_state'))return this.fresh.inspect({names,row});
  if(!row)foreign();
  if(row.schema_fingerprint===V714_FINGERPRINT){
   if(extension||names.includes('installation_team_games_upgrade'))foreign();
   if(journal&&(!['sealing','expanding','transfers','roots','memberships','receipts','rosters','events','validating'].includes(journal.phase)||journal.writer_epoch!==null))foreign();
   const state=await this.predecessorFrom(snapshot).inspectRecognized();
   this.predecessorSnapshot=snapshot;
   return {...state,route:'predecessor731',predecessor_origin:'migrated714',base_fingerprint:V714_FINGERPRINT,effective_fingerprint:V714_FINGERPRINT,target_fingerprint:identity.fingerprint};
  }
  if(row.schema_fingerprint===V731_FINGERPRINT&&row.state==='initializing'){
   // Only the real default30 owner-driven prefix is an admitted old fresh
   // origin. Never seed a new receipt or relax the frozen physical validator.
   if(extension||names.includes('installation_team_games_upgrade')||journal||!row.started_at||row.completed_at!==null||!Number.isInteger(row.next_index)||row.next_index<0||row.next_index>FRESH_731_FINAL_BATCH_CURSOR||row.next_index%30!==0)foreign();
   const state=await this.predecessorFrom(snapshot).inspectRecognized();
   this.predecessorSnapshot=snapshot;
   return {...state,route:'fresh731',predecessor_origin:'fresh731',base_fingerprint:V731_FINGERPRINT,effective_fingerprint:V731_FINGERPRINT,target_fingerprint:identity.fingerprint};
  }
  if(row.schema_fingerprint===identity.fingerprint){
   const fresh=await this.fresh.inspect({names,row});
   if(fresh.state==='initializing'){
    if(!Number.isInteger(row.next_index)||row.next_index<0||row.next_index>this.schema.length||!equalObjects(objects,schemaObjects([V731_OBJECTS.find(o=>o.name==='setup_state').sql,...this.schema.slice(0,row.next_index)])))foreign();
   }else{
    if(row.next_index!==this.schema.length||!equalObjects(objects,this.targetObjects)||!journal||journal.epoch!=='team-connections-v1'||journal.from_fingerprint!==null||journal.to_fingerprint!==identity.fingerprint||journal.plan_hash!=='fresh'||journal.phase!=='complete'||journal.writer_mode!==null||journal.writer_epoch!==null||journal.permit_guard!==null)foreign();
    if(!extension||extension.origin!=='fresh'||extension.epoch!==TEAM_GAME_EPOCH||extension.target_fingerprint!==identity.fingerprint||extension.plan_hash!=='fresh'||extension.base_fingerprint!==V731_FINGERPRINT||extension.base_plan_hash!==V731_PLAN_HASH||extension.base_journal_hash!==null||extension.base_setup_started_at!==row.started_at||extension.base_setup_completed_at!==null||extension.base_cursor!==V731_CURSOR||extension.phase!=='complete'||extension.cursor!==this.expansion.length||!extension.completed_at||extension.writer_mode!==null||extension.writer_epoch!==null||extension.permit_guard!==null)foreign();
   }
   return {...fresh,origin:'fresh',base_fingerprint:V731_FINGERPRINT,effective_fingerprint:identity.fingerprint,identity:identity.fingerprint+':'+row.started_at};
  }
  const predecessorOrigin=this.assertBase(snapshot);
  if(!extension){if(names.includes('installation_team_games_upgrade')||!equalObjects(objects,V731_OBJECTS))foreign();return {state:'upgrade_required',phase:'expanding',progress:0,predecessor_origin:predecessorOrigin,base_fingerprint:V731_FINGERPRINT,effective_fingerprint:V731_FINGERPRINT,target_fingerprint:identity.fingerprint};}
  if(extension.origin!=='preserved731'||extension.epoch!==TEAM_GAME_EPOCH||extension.record_version!==1||extension.base_fingerprint!==V731_FINGERPRINT||extension.base_plan_hash!==journal.plan_hash||extension.target_fingerprint!==identity.fingerprint||extension.plan_hash!==identity.planHash||extension.base_setup_started_at!==row.started_at||extension.base_setup_completed_at!==row.completed_at||extension.base_cursor!==V731_CURSOR||extension.base_journal_hash!==await digest(plain(baseReceipt(journal)))||extension.writer_mode!==null||extension.writer_epoch!==null||extension.permit_guard!==null)foreign();
  if(!['expanding','validating','complete'].includes(extension.phase)||!Number.isInteger(extension.cursor)||extension.cursor<0||extension.cursor>this.expansion.length||(extension.phase!=='expanding'&&extension.cursor!==this.expansion.length)||(extension.phase==='complete')!==!!extension.completed_at||!equalObjects(objects,this.expectedObjects(extension)))foreign();
  const ready=extension.phase==='complete';
  return {state:ready?'ready':'upgrading',phase:extension.phase,cursor:extension.cursor,progress:ready?100:extension.phase==='validating'?99:Math.floor(extension.cursor/this.expansion.length*95),origin:'preserved731',predecessor_origin:predecessorOrigin,base_fingerprint:V731_FINGERPRINT,effective_fingerprint:ready?identity.fingerprint:V731_FINGERPRINT,target_fingerprint:identity.fingerprint,identity:identity.fingerprint+':'+row.started_at,started_at:row.started_at,extension};
 }
 async inspect(){const state=await this.inspectRecognized();return this.upgradeMode==='maintenance'?{state:'maintenance',phase:state.phase,progress:state.progress,base_fingerprint:state.base_fingerprint,effective_fingerprint:state.effective_fingerprint}:state;}
 async advance(password){
  const state=await this.inspect();if(state.state==='maintenance')maintenance();
  if(state.route==='fresh731'){
   const saved=await this.predecessorFrom(this.predecessorSnapshot).advance(password);
   return saved.continue?saved:{setup:{state:'upgrading',progress:0},continue:true};
  }
  if(['upgrade_required','upgrading'].includes(state.state)){
   if(state.predecessor_origin!=='fresh731')maintenance();
   await this.fresh.verifyBootstrap(password);
   const saved=await this.advanceUpgrade();return {setup:{state:saved.state,progress:saved.progress??0},continue:saved.state!=='ready'};
  }
  if(state.state==='ready'){await this.fresh.verifyBootstrap(password);return {setup:{state:'ready',progress:100},continue:false};}
  return this.fresh.advance(password);
 }
 async bootstrap(){
  if(this.upgradeMode==='maintenance')maintenance();
  const state=await this.inspectRecognized();if(state.state!=='upgrade_required')return state;
  if(state.route==='predecessor731'){const saved=await this.predecessorFrom(this.predecessorSnapshot).bootstrap();return {...saved,state:'upgrading',route:'predecessor731',target_fingerprint:state.target_fingerprint};}
  const {fingerprint,planHash}=await this.identity(),snapshot=await this.snapshot(),{objects,row,journal}=snapshot;this.assertBase(snapshot);if(snapshot.extension||!equalObjects(objects,V731_OBJECTS))foreign();
  const actual=`SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' AND name<>'installation_team_games_upgrade'`;
  const physical=`(SELECT count(*) FROM actual)=(SELECT count(*) FROM expected) AND NOT EXISTS(SELECT 1 FROM actual a LEFT JOIN expected e ON json_extract(e.value,'$.type')=a.type AND json_extract(e.value,'$.name')=a.name WHERE e.value IS NULL OR json_extract(e.value,'$.sql') IS NOT a.sql)`;
  const setup=`EXISTS(SELECT 1 FROM setup_state s WHERE s.id=1 AND s.schema_fingerprint=? AND s.next_index=? AND s.state='ready' AND s.started_at=? AND s.completed_at IS ?) AND EXISTS(SELECT 1 FROM domain_installation WHERE id=1 AND schema_version=1)`;
  const saved=`EXISTS(SELECT 1 FROM installation_upgrade u WHERE u.id=1 AND ${baseJournalFields.map(key=>`u.${key} IS ?`).join(' AND ')})`;
  const insert=`WITH expected AS(SELECT value FROM json_each(?)),actual AS(${actual}) INSERT INTO installation_team_games_upgrade(id,epoch,origin,base_fingerprint,base_plan_hash,target_fingerprint,plan_hash,base_setup_started_at,base_setup_completed_at,base_cursor,base_journal_hash,phase,cursor,started_at,assertion) SELECT 1,?,'preserved731',?,?,?,?,?,?,?,?, 'expanding',0,?,CASE WHEN ${physical} AND ${setup} AND ${saved} THEN 1 ELSE 0 END`;
  // Creating this one table and its checked receipt is one native transaction.
  // No base permit opens, no original row changes, and failed assertions roll
  // the CREATE back. The bridge appears only after the closed receipt exists.
  await this.db.batch([
   this.db.prepare(this.bootstrapSchema[0]),
   this.db.prepare(insert).bind(plain(objects),TEAM_GAME_EPOCH,V731_FINGERPRINT,journal.plan_hash,fingerprint,planHash,row.started_at,row.completed_at,V731_CURSOR,await digest(plain(baseReceipt(journal))),new Date(this.now()).toISOString(),V731_FINGERPRINT,V731_CURSOR,row.started_at,row.completed_at,...baseJournalFields.map(key=>journal[key]??null)),
   ...this.bootstrapSchema.slice(1).map(sql=>this.db.prepare(sql)),
  ]);
  return this.inspectRecognized();
 }
 async transact(extension,statements,{phase=extension.phase,cursor=extension.cursor,finish=false}={}){
  if(this.upgradeMode==='maintenance')maintenance();
  const {fingerprint,planHash}=await this.identity();
  const result=await this.db.batch([
   this.db.prepare(`UPDATE installation_team_games_upgrade SET writer_mode='upgrade',writer_epoch=?,permit_guard=0 WHERE id=1 AND epoch=? AND origin='preserved731' AND target_fingerprint=? AND plan_hash=? AND writer_mode IS NULL RETURNING id`).bind(TEAM_GAME_EPOCH,TEAM_GAME_EPOCH,fingerprint,planHash),
   this.db.prepare(`UPDATE installation_team_games_upgrade SET assertion=CASE WHEN writer_mode='upgrade' AND writer_epoch=? AND phase=? AND cursor=? THEN 1 ELSE 0 END WHERE id=1`).bind(TEAM_GAME_EPOCH,extension.phase,extension.cursor),
   ...statements,
   this.db.prepare('UPDATE installation_team_games_upgrade SET phase=?,cursor=?,completed_at=? WHERE id=1').bind(phase,cursor,finish?new Date(this.now()).toISOString():null),
   this.db.prepare(`UPDATE installation_team_games_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1 AND writer_mode='upgrade' AND writer_epoch=? RETURNING id`).bind(TEAM_GAME_EPOCH),
  ]);
  if(!singleton(result[0])||!singleton(result.at(-1)))foreign();
 }
 async advanceUpgrade(){
  const state=await this.inspect();if(state.state==='maintenance')maintenance();
  if(state.route==='predecessor731'){const saved=await this.predecessorFrom(this.predecessorSnapshot).advanceUpgrade();return {...saved,state:'upgrading',route:'predecessor731',target_fingerprint:state.target_fingerprint};}
  if(state.state==='upgrade_required'){await this.bootstrap();return {state:'upgrading',phase:'expanding',progress:0};}
  if(state.state!=='upgrading')return state;
  const extension=state.extension;
  if(extension.phase==='expanding'){
   const start=extension.cursor,end=Math.min(this.expansion.length,start+this.batchSize);
   await this.transact(extension,this.expansion.slice(start,end).map(sql=>this.db.prepare(sql)),{phase:end===this.expansion.length?'validating':'expanding',cursor:end});
  }else{
   if(await this.db.prepare('SELECT 1 FROM pragma_foreign_key_check LIMIT 1').first())fail('installation_integrity','The installation needs a data-integrity review before updates can resume.');
   await this.transact(extension,[],{phase:'complete',cursor:this.expansion.length,finish:true});
  }
  return this.inspectRecognized();
 }
}
