import {InstallationError} from './fresh-install.js';

// One installation boundary, not a registry of historical application versions.
export const INSTALLATION_EPOCH='team-connections-v1';
export const UPGRADE_TABLE='installation_upgrade';
export const UPGRADE_DDL=`CREATE TABLE installation_upgrade(
 id INTEGER PRIMARY KEY CHECK(id=1),
 epoch TEXT NOT NULL,
 from_fingerprint TEXT,
 to_fingerprint TEXT NOT NULL,
 plan_hash TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN('sealing','expanding','transfers','roots','memberships','receipts','rosters','events','validating','complete')),
 cursor TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL,
 completed_at TEXT,
 original_started_at TEXT NOT NULL,
 original_completed_at TEXT,
 original_cursor INTEGER NOT NULL,
 assertion INTEGER NOT NULL DEFAULT 1 CHECK(assertion=1),
 writer_mode TEXT CHECK(writer_mode IS NULL OR writer_mode IN('application','upgrade')),
 writer_epoch TEXT,
 permit_guard INTEGER CHECK(permit_guard IS NULL OR permit_guard=0),
 CHECK((writer_mode IS NULL)=(writer_epoch IS NULL) AND (writer_mode IS NULL)=(permit_guard IS NULL)),
 FOREIGN KEY(permit_guard) REFERENCES installation_upgrade(id) DEFERRABLE INITIALLY DEFERRED
)`;
const JOURNAL_FIELDS=['epoch','from_fingerprint','to_fingerprint','plan_hash','phase','cursor','started_at','completed_at','original_started_at','original_completed_at','original_cursor','assertion'];
export const JOURNAL_GUARDS=[
 `CREATE TRIGGER installation_upgrade_no_delete BEFORE DELETE ON installation_upgrade BEGIN SELECT RAISE(ABORT,'installation_journal_immutable'); END`,
 `CREATE TRIGGER installation_upgrade_no_replace BEFORE INSERT ON installation_upgrade WHEN EXISTS(SELECT 1 FROM installation_upgrade WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'installation_journal_immutable'); END`,
 `CREATE TRIGGER installation_upgrade_metadata_guard BEFORE UPDATE ON installation_upgrade WHEN (${JOURNAL_FIELDS.map(name=>`OLD.${name} IS NOT NEW.${name}`).join(' OR ')}) AND NOT COALESCE(OLD.writer_mode='upgrade' AND OLD.writer_epoch=OLD.epoch AND OLD.permit_guard=0,0) BEGIN SELECT RAISE(ABORT,'installation_upgrade_permit_required'); END`,
 `CREATE TRIGGER installation_upgrade_permit_guard BEFORE UPDATE ON installation_upgrade WHEN OLD.writer_mode IS NOT NULL AND (OLD.writer_mode IS NOT NEW.writer_mode OR OLD.writer_epoch IS NOT NEW.writer_epoch OR OLD.permit_guard IS NOT NEW.permit_guard) AND NOT(NEW.writer_mode IS NULL AND NEW.writer_epoch IS NULL AND NEW.permit_guard IS NULL) BEGIN SELECT RAISE(ABORT,'installation_permit_mode_immutable'); END`,
];
export function tableNames(schema){return [...new Set(['setup_state',...schema.filter(sql=>/^CREATE\s+TABLE\s/i.test(sql)).map(sql=>sql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1])])].filter(Boolean).filter(name=>name!==UPGRADE_TABLE).sort();}
export function tableGuards(names){return names.flatMap(name=>{
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw new Error('Invalid installation table.');
 return ['INSERT','UPDATE','DELETE'].map(operation=>`CREATE TRIGGER installation_epoch_${name}_${operation.toLowerCase()} BEFORE ${operation} ON ${name}
 WHEN NOT EXISTS(SELECT 1 FROM installation_upgrade u WHERE u.id=1 AND u.epoch='${INSTALLATION_EPOCH}' AND u.writer_epoch=u.epoch AND u.permit_guard=0 AND (u.writer_mode='upgrade' OR(u.writer_mode='application' AND u.phase='complete' AND EXISTS(SELECT 1 FROM setup_state s WHERE s.id=1 AND s.state='ready' AND s.schema_fingerprint=u.to_fingerprint))))
 AND NOT EXISTS(SELECT 1 FROM setup_state s WHERE s.id=1 AND s.state='initializing' AND NOT EXISTS(SELECT 1 FROM installation_upgrade u WHERE u.id=1 AND u.from_fingerprint IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'installation_epoch_required'); END`);
 });}
export function installationGateSchema(schema){return [UPGRADE_DDL,...JOURNAL_GUARDS,...tableGuards(tableNames(schema))];}
export const freshJournalSeed={sql:`INSERT INTO installation_upgrade(id,epoch,from_fingerprint,to_fingerprint,plan_hash,phase,started_at,completed_at,original_started_at,original_completed_at,original_cursor) SELECT 1,'${INSTALLATION_EPOCH}',NULL,schema_fingerprint,'fresh','complete',started_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),started_at,NULL,next_index FROM setup_state WHERE id=1 AND state='initializing' AND NOT EXISTS(SELECT 1 FROM installation_upgrade WHERE id=1)`,params:[]};

const unavailable=()=>new InstallationError('installation_maintenance','The installation is being updated. Please try again shortly.',503);
const unsafe=()=>new InstallationError('installation_write_contract','This database operation is not permitted by the application writer.',500);
const prepared=Symbol('installationPrepared');

// Lex only enough SQL to identify the top-level operation. Quoted strings,
// comments and nested CTEs cannot turn a write into a supposed read.
function tokens(sql){
 const out=[];let depth=0;
 for(let i=0;i<sql.length;){const c=sql[i],n=sql[i+1];
  if(/\s/.test(c)){i++;continue;}
  if(c==='-'&&n==='-'){i=sql.indexOf('\n',i+2);if(i<0)break;continue;}
  if(c==='/'&&n==='*'){const end=sql.indexOf('*/',i+2);if(end<0)throw unsafe();i=end+2;continue;}
  if(c==="'"||c==='"'||c==='`'||c==='['){const end=c==='['?']':c;let value='';i++;for(;i<sql.length;i++){if(sql[i]===end){if(sql[i+1]===end){value+=end;i++;continue;}i++;break;}value+=sql[i];}out.push({value:value.toUpperCase(),depth,quoted:true});continue;}
  if(c==='('){depth++;i++;continue;}if(c===')'){depth--;if(depth<0)throw unsafe();i++;continue;}
  if(/[A-Za-z_]/.test(c)){const word=sql.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];out.push({value:word.toUpperCase(),depth});i+=word.length;continue;}
  if(c===';'){if(sql.slice(i+1).trim())throw unsafe();i++;continue;}
  out.push({value:c,depth});i++;
 }if(depth!==0)throw unsafe();return out;
}
export function sqlOperation(sql){
 if(typeof sql!=='string'||!sql.trim())throw unsafe();
 const words=tokens(sql),top=words.filter(token=>token.depth===0&&!token.quoted),first=top[0]?.value;
 const operation=first==='WITH'?top.find((token,index)=>index>0&&['SELECT','INSERT','UPDATE','DELETE','REPLACE'].includes(token.value))?.value:first;
 if(operation==='SELECT'||operation==='EXPLAIN')return 'read';
 if(operation==='PRAGMA'){
  const pragma=top[1]?.value;
  if(!['TABLE_INFO','TABLE_XINFO','FOREIGN_KEY_LIST','FOREIGN_KEY_CHECK','INDEX_LIST','INDEX_INFO','INDEX_XINFO','QUICK_CHECK','INTEGRITY_CHECK'].includes(pragma)||top.some(token=>token.value==='='))throw unsafe();
  return 'read';
 }
 if(!['INSERT','UPDATE','DELETE','REPLACE'].includes(operation))throw unsafe();
 if(words.some(token=>token.value===UPGRADE_TABLE.toUpperCase()))throw unsafe();
 return 'write';
}

/** Charge and submit the permit and every mutation as one native transaction.
 * The deferred self-FK makes a leaked permit uncommittable. No old transaction
 * can observe it, and a stale binary never acquires the new installation epoch.
 */
export function wrapDatabase(db,{epoch=INSTALLATION_EPOCH}={}){
 const owner={
  get remaining(){return db.remaining;},get used(){return db.used;},get limit(){return db.limit;},get rowsRead(){return db.rowsRead;},get rowsWritten(){return db.rowsWritten;},
  writeOverhead:2,
  prepare(sql){const operation=sqlOperation(sql);const build=statement=>({
   [prepared]:{owner,statement,operation},
   bind(...params){return build(statement.bind(...params));},
   async all(){return (await owner.batch([this]))[0];},
   async run(){return (await owner.batch([this]))[0];},
   async first(column){const result=await this.all(),row=result.results[0]??null;return column&&row?row[column]:row;},
  });return build(db.prepare(sql));},
  async batch(statements){
   if(!Array.isArray(statements)||!statements.length)throw unsafe();
   const entries=statements.map(statement=>{const entry=statement?.[prepared];if(!entry||entry.owner!==owner)throw unsafe();return entry;});
   if(entries.every(entry=>entry.operation==='read'))return db.batch(entries.map(entry=>entry.statement));
   const open=db.prepare(`UPDATE installation_upgrade SET writer_mode='application',writer_epoch=?,permit_guard=0 WHERE id=1 AND phase='complete' AND epoch=? AND writer_mode IS NULL AND EXISTS(SELECT 1 FROM setup_state s WHERE s.id=1 AND s.state='ready' AND s.schema_fingerprint=installation_upgrade.to_fingerprint)`).bind(epoch,epoch);
   const close=db.prepare(`UPDATE installation_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1 AND writer_mode='application' AND writer_epoch=?`).bind(epoch);
   // BudgetDB.batch reserves the complete N+2 before dispatching any statement.
   const result=await db.batch([open,...entries.map(entry=>entry.statement),close]);
   if(result[0].meta.changes!==1||result.at(-1).meta.changes!==1)throw unavailable();
   return result.slice(1,-1);
  },
  async exec(){throw unsafe();},
 };
 return owner;
}
