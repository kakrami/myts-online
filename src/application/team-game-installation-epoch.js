export const TEAM_GAME_EPOCH='team-games-v1';
export const TEAM_GAME_UPGRADE_TABLE='installation_team_games_upgrade';
export const TEAM_GAME_UPGRADE_DDL=`CREATE TABLE installation_team_games_upgrade(id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL CHECK(epoch='team-games-v1'),record_version INTEGER NOT NULL DEFAULT 1 CHECK(record_version=1),origin TEXT NOT NULL CHECK(origin IN('preserved731','fresh')),base_fingerprint TEXT NOT NULL,base_plan_hash TEXT NOT NULL,target_fingerprint TEXT NOT NULL,plan_hash TEXT NOT NULL,base_setup_started_at TEXT NOT NULL,base_setup_completed_at TEXT,base_cursor INTEGER NOT NULL,base_journal_hash TEXT,phase TEXT NOT NULL CHECK(phase IN('expanding','validating','complete')),cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0),started_at TEXT NOT NULL,completed_at TEXT,assertion INTEGER NOT NULL DEFAULT 1 CHECK(assertion=1),writer_mode TEXT CHECK(writer_mode IS NULL OR writer_mode IN('application','upgrade')),writer_epoch TEXT,permit_guard INTEGER CHECK(permit_guard IS NULL OR permit_guard=0),CHECK((writer_mode IS NULL)=(writer_epoch IS NULL) AND (writer_mode IS NULL)=(permit_guard IS NULL)),CHECK((origin='preserved731' AND base_journal_hash IS NOT NULL AND length(base_journal_hash)=64) OR(origin='fresh' AND base_journal_hash IS NULL)),FOREIGN KEY(permit_guard) REFERENCES installation_team_games_upgrade(id) DEFERRABLE INITIALLY DEFERRED)`;
const fields=['epoch','record_version','origin','base_fingerprint','base_plan_hash','target_fingerprint','plan_hash','base_setup_started_at','base_setup_completed_at','base_cursor','base_journal_hash','phase','cursor','started_at','completed_at','assertion'];
export const TEAM_GAME_JOURNAL_GUARDS=[
 `CREATE TRIGGER team_games_journal_no_delete BEFORE DELETE ON installation_team_games_upgrade BEGIN SELECT RAISE(ABORT,'team_game_installation_immutable'); END`,
 `CREATE TRIGGER team_games_journal_no_replace BEFORE INSERT ON installation_team_games_upgrade WHEN EXISTS(SELECT 1 FROM installation_team_games_upgrade WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'team_game_installation_immutable'); END`,
 `CREATE TRIGGER team_games_journal_metadata BEFORE UPDATE ON installation_team_games_upgrade WHEN (${fields.map(k=>`OLD.${k} IS NOT NEW.${k}`).join(' OR ')}) AND NOT COALESCE(OLD.writer_mode='upgrade' AND OLD.writer_epoch=OLD.epoch AND OLD.permit_guard=0,0) BEGIN SELECT RAISE(ABORT,'team_game_upgrade_permit_required'); END`,
 `CREATE TRIGGER team_games_journal_permit_mode BEFORE UPDATE ON installation_team_games_upgrade WHEN OLD.writer_mode IS NOT NULL AND(OLD.writer_mode IS NOT NEW.writer_mode OR OLD.writer_epoch IS NOT NEW.writer_epoch OR OLD.permit_guard IS NOT NEW.permit_guard) AND NOT(NEW.writer_mode IS NULL AND NEW.writer_epoch IS NULL AND NEW.permit_guard IS NULL) BEGIN SELECT RAISE(ABORT,'team_game_permit_mode_immutable'); END`,
 `CREATE TRIGGER team_games_legacy_bridge BEFORE UPDATE ON installation_upgrade WHEN OLD.writer_mode IS NULL AND NEW.writer_mode IS NOT NULL AND NOT EXISTS(SELECT 1 FROM installation_team_games_upgrade x WHERE x.id=1 AND x.epoch='team-games-v1' AND x.writer_epoch=x.epoch AND x.permit_guard=0 AND x.writer_mode=NEW.writer_mode AND(NEW.writer_mode='upgrade' OR x.phase='complete')) BEGIN SELECT RAISE(ABORT,'team_game_extension_permit_required'); END`,
 `CREATE TRIGGER team_games_open_legacy AFTER UPDATE ON installation_team_games_upgrade WHEN OLD.writer_mode IS NULL AND NEW.writer_mode IS NOT NULL BEGIN UPDATE installation_upgrade SET writer_mode=NEW.writer_mode,writer_epoch=epoch,permit_guard=0 WHERE id=1 AND epoch='team-connections-v1' AND phase='complete' AND writer_mode IS NULL AND EXISTS(SELECT 1 FROM setup_state s WHERE s.id=1 AND s.state='ready' AND s.schema_fingerprint=installation_upgrade.to_fingerprint); SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'team_game_legacy_open_failed') END; END`,
 `CREATE TRIGGER team_games_close_legacy BEFORE UPDATE ON installation_team_games_upgrade WHEN OLD.writer_mode IS NOT NULL AND NEW.writer_mode IS NULL BEGIN UPDATE installation_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1 AND epoch='team-connections-v1' AND writer_mode=OLD.writer_mode AND writer_epoch=epoch AND permit_guard=0; SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'team_game_legacy_close_failed') END; END`,
];
export const TEAM_GAME_BOOTSTRAP_SCHEMA=[TEAM_GAME_UPGRADE_DDL,...TEAM_GAME_JOURNAL_GUARDS];

import {InstallationError,installationSchema} from './fresh-install.js';
import {sqlOperation as baseOperation} from './installation-epoch-v731.js';
import {digest} from '../security/crypto.js';
import {V731_FINGERPRINT,V731_PLAN_HASH,V731_OBJECTS} from './schema-v731.js';
export const TEAM_GAME_RUN_BASE_DDL=V731_OBJECTS.find(row=>row.type==='table'&&row.name==='team_projection_runs').sql;
export const TEAM_GAME_RUN_ALTER='ALTER TABLE team_projection_runs ADD COLUMN team_game_version INTEGER NOT NULL DEFAULT 0 CHECK(team_game_version IN(0,1))';
export const TEAM_GAME_RUN_TARGET_DDL=TEAM_GAME_RUN_BASE_DDL.replace(/\)$/,'\, team_game_version INTEGER NOT NULL DEFAULT 0 CHECK(team_game_version IN(0,1)))');
let identityPromise;
export function teamGameInstallationIdentity(){
 return identityPromise??=(async()=>{
  const {SCHEMA,SEED,TEAM_GAME_EXPANSION_SCHEMA}=await import('./installation-schema.js');
  const schema=installationSchema([SCHEMA]),fingerprint=await digest(JSON.stringify({schema,seed:SEED}));
  const planHash=await digest(JSON.stringify({from:V731_FINGERPRINT,basePlans:[V731_PLAN_HASH,'fresh731-default30-cursor720'],predecessorChain:['exact714-to-frozen731','exact-fresh731-prefix30-owner-password'],to:fingerprint,epoch:TEAM_GAME_EPOCH,bootstrap:TEAM_GAME_BOOTSTRAP_SCHEMA,expansion:TEAM_GAME_EXPANSION_SCHEMA,backfill:'empty-scoped-game-relations-v1'}));
  return {fingerprint,planHash,schema};
 })();
}
const unsafe=()=>new InstallationError('installation_write_contract','This database operation is not permitted by the application writer.',500);
const unavailable=()=>new InstallationError('installation_maintenance','The installation is being updated. Please try again shortly.',503);
const prepared=Symbol('teamGameInstallationPrepared');
export function sqlOperation(sql){
 const operation=baseOperation(sql);
 if(operation!=='read'&&/installation_team_games_upgrade/i.test(sql))throw unsafe();
 return operation;
}
const returnedSingleton=result=>Array.isArray(result?.results)&&result.results.length===1&&result.results[0].id===1;
export function wrapDatabase(db){
 const owner={
  get remaining(){return db.remaining;},get used(){return db.used;},get limit(){return db.limit;},get rowsRead(){return db.rowsRead;},get rowsWritten(){return db.rowsWritten;},writeOverhead:2,
  prepare(sql){const operation=sqlOperation(sql);const build=statement=>({
   [prepared]:{owner,statement,operation},bind(...params){return build(statement.bind(...params));},async all(){return(await owner.batch([this]))[0];},async run(){return(await owner.batch([this]))[0];},async first(column){const row=(await this.all()).results[0]??null;return column&&row?row[column]:row;},
  });return build(db.prepare(sql));},
  async batch(statements){
   if(!Array.isArray(statements)||!statements.length)throw unsafe();
   const entries=statements.map(statement=>{const entry=statement?.[prepared];if(!entry||entry.owner!==owner)throw unsafe();return entry;});
   if(entries.every(entry=>entry.operation==='read'))return db.batch(entries.map(entry=>entry.statement));
   const {fingerprint,planHash}=await teamGameInstallationIdentity();
   const open=db.prepare(`UPDATE installation_team_games_upgrade SET writer_mode='application',writer_epoch=?,permit_guard=0 WHERE id=1 AND epoch=? AND phase='complete' AND target_fingerprint=? AND ((origin='preserved731' AND plan_hash=?) OR(origin='fresh' AND plan_hash='fresh')) AND writer_mode IS NULL RETURNING id`).bind(TEAM_GAME_EPOCH,TEAM_GAME_EPOCH,fingerprint,planHash);
   const close=db.prepare(`UPDATE installation_team_games_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1 AND writer_mode='application' AND writer_epoch=? RETURNING id`).bind(TEAM_GAME_EPOCH);
   const result=await db.batch([open,...entries.map(entry=>entry.statement),close]);
   // D1 meta.changes includes the nested legacy update and is deliberately 2.
   // The SQL triggers/deferred FKs provide atomicity; RETURNING checks identity.
   if(!returnedSingleton(result[0])||!returnedSingleton(result.at(-1)))throw unavailable();
   return result.slice(1,-1);
  },async exec(){throw unsafe();},
 };return owner;
}
