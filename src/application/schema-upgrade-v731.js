import {FreshInstallation,InstallationError,installationSchema} from './fresh-install.js';
import {digest} from '../security/crypto.js';
import {nativeCanonicalId} from '../domain/identity.js';
import {observedDay} from '../domain/connection-evidence.js';
import {V714_FINGERPRINT,V714_CURSOR,V714_OBJECTS} from './schema-v714.js';
import {INSTALLATION_EPOCH,UPGRADE_DDL,JOURNAL_GUARDS,tableGuards} from './installation-epoch-v731.js';
import {TRANSFER_PARENT_NAMES,TRANSFER_TARGET_DDL,TRANSFER_PLAN,TRANSFER_INITIAL_CURSOR,transferObjects,advanceTransfers} from './transfer-schema-upgrade.js';

const fail=(code,message,status=409)=>{throw new InstallationError(code,message,status);};
const foreign=()=>fail('installation_schema_mismatch','This database does not match the reviewed installation. No database changes were made.');
const maintenance=()=>fail('installation_maintenance','The installation is being updated. Existing data is preserved. Please try again shortly.',503);
const metadataQuery="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY type,name";
const journalColumns=['epoch','from_fingerprint','to_fingerprint','plan_hash','phase','cursor','started_at','completed_at','original_started_at','original_completed_at','original_cursor','writer_mode','writer_epoch','permit_guard'];
const normalized=sql=>sql.replace(/^(CREATE\s+(?:TABLE|VIEW|TRIGGER|(?:UNIQUE\s+)?INDEX))\s+IF\s+NOT\s+EXISTS\s+/i,'$1 ').trim();
export function schemaObjects(schema){
 const objects=new Map();for(const input of schema){const sql=normalized(input),match=sql.match(/^CREATE\s+(TABLE|VIEW|TRIGGER|(?:UNIQUE\s+)?INDEX)\s+(\w+)/i);if(!match)throw new Error('Invalid reviewed schema statement.');const type=match[1].toLowerCase().replace('unique ',''),name=match[2];objects.set(type+':'+name,{type,name,sql});}return [...objects.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name));
}
const equalObjects=(actual,expected)=>{const known=new Map(expected.map(row=>[row.type+':'+row.name,row.sql]));return actual.length===expected.length&&actual.every(row=>known.get(row.type+':'+row.name)===normalized(row.sql));};
const baseObjects=V714_OBJECTS.map(({type,name,sql})=>({type,name,sql:normalized(sql)})).sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name));
const baseTables=baseObjects.filter(row=>row.type==='table').map(row=>row.name).sort();
const sealStatements=installationSchema([tableGuards(baseTables)]);
const journalStatements=installationSchema([[UPGRADE_DDL,...JOURNAL_GUARDS]]);
const baseKeys=new Set(baseObjects.map(row=>row.type+':'+row.name));
const journalKeys=new Set(schemaObjects(journalStatements).map(row=>row.type+':'+row.name));
const sealKeys=new Set(schemaObjects(sealStatements).map(row=>row.type+':'+row.name));
const tuple=value=>value?JSON.parse(value):[];
const encode=value=>JSON.stringify(value);

/** One exact transition from the preserved 7.1.4 installation only.
 * It never resets setup, decrypts credentials, accepts arbitrary SQL, or runs a
 * registry/chain of historical migrations. Each phase is bounded and durable.
 */
export class InstallationUpgrade {
 constructor(db,{schema,seed=[],bootstrapPassword,now=Date.now,batchSize=24,upgradeMode='normal'}={}){
  if(!['normal','maintenance'].includes(upgradeMode))fail('installation_mode_invalid','The installation maintenance setting is invalid. Application work is paused.',503);
  this.upgradeMode=upgradeMode;
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>24)throw new Error('Invalid upgrade batch size.');
  this.db=db;this.now=now;this.batchSize=batchSize;this.fresh=new FreshInstallation(db,{schema,seed,bootstrapPassword,now});this.schema=this.fresh.schema;this.fingerprint=this.fresh.fingerprint;
  this.targetObjects=schemaObjects([...this.schema,V714_OBJECTS.find(row=>row.name==='setup_state').sql]);
  // Every old object stays exact except the two explicitly reconstructed file
  // parents. Their only permitted replacement is fixed by the reviewed plan.
  for(const old of baseObjects){const target=this.targetObjects.find(row=>row.type===old.type&&row.name===old.name),expected=old.type==='table'&&TRANSFER_PARENT_NAMES.includes(old.name)?TRANSFER_TARGET_DDL[old.name]:old.sql;if(!target||target.sql!==expected)throw new Error('This transition differs from the exact preserved plan: '+old.name);}
  this.expansion=this.schema.filter(sql=>{const row=schemaObjects([sql])[0],key=row.type+':'+row.name;return !baseKeys.has(key)&&!journalKeys.has(key)&&!sealKeys.has(key);});
  this.planHash=Promise.all([this.fingerprint]).then(([target])=>digest(JSON.stringify({from:V714_FINGERPRINT,to:target,epoch:INSTALLATION_EPOCH,journal:journalStatements,seals:sealStatements,expansion:this.expansion,transfers:TRANSFER_PLAN,backfill:'fixed-legacy-roots-receipts-published-evidence-v1'})));
 }
 async snapshot(){
  const objects=(await this.db.prepare(metadataQuery).all()).results,names=objects.filter(row=>row.type==='table').map(row=>row.name);
  if(!names.includes('setup_state'))return {objects,names,row:null,journal:null};
  const journal=names.includes('installation_upgrade')?`,(SELECT json_object(${journalColumns.flatMap(name=>["'"+name+"'",name]).join(',')}) FROM installation_upgrade WHERE id=1) AS upgrade_journal`:'';
  const domain=names.includes('domain_installation')?',(SELECT count(*) FROM domain_installation WHERE id=1 AND schema_version=1) AS domain_seed_count':'';
  const row=await this.db.prepare('SELECT schema_fingerprint,next_index,state,started_at,completed_at'+domain+journal+' FROM setup_state WHERE id=1').first();
  const value=row?.upgrade_journal?JSON.parse(row.upgrade_journal):null;if(row)delete row.upgrade_journal;return {objects,names,row,journal:value};
 }
 expectedObjects(journal){
  if(journal.phase==='sealing')return schemaObjects([...baseObjects.map(row=>row.sql),...journalStatements,...sealStatements.slice(0,Number(journal.cursor))]);
  if(journal.phase==='expanding')return schemaObjects([...baseObjects.map(row=>row.sql),...journalStatements,...sealStatements,...this.expansion.slice(0,Number(journal.cursor))]);
  if(journal.phase==='transfers')return transferObjects(this.targetObjects,journal.cursor);
  return this.targetObjects;
 }
 async inspect(){
  const state=await this.inspectRecognized();
  return this.upgradeMode==='maintenance'?{state:'maintenance',phase:state.phase,progress:state.progress}:state;
 }
 async inspectRecognized(){
  const snapshot=await this.snapshot(),{objects,names,row,journal}=snapshot,target=await this.fingerprint;
  if(!names.includes('setup_state'))return this.fresh.inspect({names,row});
  if(!row)foreign();
  if(row.schema_fingerprint===target){
   const fresh=await this.fresh.inspect({names,row});
   if(fresh.state==='initializing'&&(!Number.isInteger(row.next_index)||row.next_index<0||row.next_index>this.schema.length||!equalObjects(objects,schemaObjects([V714_OBJECTS.find(object=>object.name==='setup_state').sql,...this.schema.slice(0,row.next_index)]))))foreign();
   if(fresh.state==='ready'){
    if(row.next_index!==this.schema.length||!equalObjects(objects,this.targetObjects)||!journal||journal.epoch!==INSTALLATION_EPOCH||journal.to_fingerprint!==target||journal.phase!=='complete'||journal.writer_mode!==null||journal.permit_guard!==null)foreign();
    if(journal.from_fingerprint!==null&&(journal.from_fingerprint!==V714_FINGERPRINT||journal.plan_hash!==await this.planHash||row.started_at!==journal.original_started_at||row.completed_at!==journal.original_completed_at))foreign();
   }
   return {...fresh,identity:target+':'+row.started_at};
  }
  if(row.schema_fingerprint!==V714_FINGERPRINT||row.state!=='ready'||row.next_index!==V714_CURSOR||row.domain_seed_count!==1||!row.started_at||!row.completed_at)foreign();
  if(!journal){if(!equalObjects(objects,baseObjects))foreign();return {state:'upgrade_required',progress:0,phase:'sealing',schema_fingerprint:row.schema_fingerprint,started_at:row.started_at};}
  if(journal.epoch!==INSTALLATION_EPOCH||journal.from_fingerprint!==V714_FINGERPRINT||journal.to_fingerprint!==target||journal.plan_hash!==await this.planHash||journal.original_started_at!==row.started_at||journal.original_completed_at!==row.completed_at||journal.original_cursor!==row.next_index||journal.phase==='complete'||journal.writer_mode!==null||journal.permit_guard!==null)foreign();
  if(['sealing','expanding'].includes(journal.phase)&&(!/^\d+$/.test(journal.cursor)||Number(journal.cursor)>(journal.phase==='sealing'?sealStatements.length:this.expansion.length)))foreign();
  if(!equalObjects(objects,this.expectedObjects(journal)))foreign();
  return {state:'upgrading',phase:journal.phase,cursor:journal.cursor,progress:this.progress(journal),schema_fingerprint:row.schema_fingerprint,started_at:row.started_at,journal};
 }
 progress(journal){const phases=['sealing','expanding','transfers','roots','memberships','receipts','rosters','events','validating'];return Math.min(99,Math.floor(phases.indexOf(journal.phase)*100/phases.length));}
 async advance(password){const state=await this.inspect();if(['upgrade_required','upgrading','maintenance'].includes(state.state))maintenance();return this.fresh.advance(password);}
 async bootstrap(){
  const state=await this.inspect();if(state.state!=='upgrade_required')return state;
  const target=await this.fingerprint,plan=await this.planHash;
  await this.db.batch([
   this.db.prepare(journalStatements[0]),
   this.db.prepare(`INSERT INTO installation_upgrade(id,epoch,from_fingerprint,to_fingerprint,plan_hash,phase,cursor,started_at,original_started_at,original_completed_at,original_cursor) SELECT 1,?,?,?,?, 'sealing','0',?,started_at,completed_at,next_index FROM setup_state WHERE id=1 AND state='ready' AND schema_fingerprint=? AND next_index=? AND NOT EXISTS(SELECT 1 FROM installation_upgrade WHERE id=1)`).bind(INSTALLATION_EPOCH,V714_FINGERPRINT,target,plan,new Date(this.now()).toISOString(),V714_FINGERPRINT,V714_CURSOR),
   ...journalStatements.slice(1).map(sql=>this.db.prepare(sql)),
  ]);
  return this.inspect();
 }
 async transact(journal,statements,{phase=journal.phase,cursor=journal.cursor,finish=false}={}){
  if(this.upgradeMode==='maintenance')maintenance();
  const target=await this.fingerprint,plan=await this.planHash;
  const batch=[
   this.db.prepare(`UPDATE installation_upgrade SET writer_mode='upgrade',writer_epoch=?,permit_guard=0 WHERE id=1 AND epoch=? AND from_fingerprint=? AND to_fingerprint=? AND plan_hash=? AND writer_mode IS NULL`).bind(INSTALLATION_EPOCH,INSTALLATION_EPOCH,V714_FINGERPRINT,target,plan),
   this.db.prepare(`UPDATE installation_upgrade SET assertion=CASE WHEN writer_mode='upgrade' AND phase=? AND cursor=? THEN 1 ELSE 0 END WHERE id=1`).bind(journal.phase,journal.cursor),
   ...statements,
   ...(finish?[
    this.db.prepare(`UPDATE setup_state SET schema_fingerprint=?,next_index=? WHERE id=1 AND schema_fingerprint=? AND state='ready' AND next_index=? AND started_at=? AND completed_at IS ?`).bind(target,this.schema.length,V714_FINGERPRINT,V714_CURSOR,journal.original_started_at,journal.original_completed_at),
    this.db.prepare('UPDATE installation_upgrade SET assertion=CASE WHEN changes()=1 THEN 1 ELSE 0 END WHERE id=1'),
   ]:[]),
   this.db.prepare('UPDATE installation_upgrade SET phase=?,cursor=?,completed_at=? WHERE id=1').bind(phase,cursor,finish?new Date(this.now()).toISOString():null),
   this.db.prepare("UPDATE installation_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1 AND writer_mode='upgrade' AND writer_epoch=?").bind(INSTALLATION_EPOCH),
  ];
  const results=await this.db.batch(batch);if(results[0].meta.changes!==1||results.at(-1).meta.changes!==1)foreign();
 }
 async advanceUpgrade(){
  let state=await this.inspect();if(state.state==='upgrade_required'){await this.bootstrap();return {state:'upgrading',phase:'sealing',progress:0};}
  if(state.state!=='upgrading')return state;
  const j=state.journal;
  if(j.phase==='sealing'||j.phase==='expanding'){
   const sql=j.phase==='sealing'?sealStatements:this.expansion,start=Number(j.cursor),end=Math.min(sql.length,start+this.batchSize),done=end===sql.length;
   await this.transact(j,sql.slice(start,end).map(statement=>this.db.prepare(statement)),{phase:done?(j.phase==='sealing'?'expanding':'transfers'):j.phase,cursor:done?(j.phase==='sealing'?'0':TRANSFER_INITIAL_CURSOR):String(end)});
  }else if(j.phase==='transfers')await advanceTransfers(this,j);
  else if(j.phase==='roots')await this.backfillRoots(j);
  else if(j.phase==='memberships')await this.backfillMemberships(j);
  else if(j.phase==='receipts')await this.backfillReceipts(j);
  else if(j.phase==='rosters')await this.backfillRosters(j);
  else if(j.phase==='events')await this.backfillEvents(j);
  else if(j.phase==='validating'){
   const invalid=await this.db.prepare('SELECT 1 FROM pragma_foreign_key_check LIMIT 1').first();if(invalid)fail('installation_integrity','The installation needs a data-integrity review before updates can resume.');
   await this.transact(j,[],{phase:'complete',cursor:'',finish:true});
  }
  return {state:j.phase==='validating'?'ready':'upgrading',phase:j.phase,progress:j.phase==='validating'?100:this.progress(j)};
 }
 async backfillRoots(j){
  const [team='',source='']=tuple(j.cursor),rows=(await this.db.prepare(`SELECT a.app_team_id,a.source_team_id,s.account_id,MAX(a.active) active,MAX(a.generation) generation,t.created_at,COUNT(DISTINCT COALESCE(a.account_id,'')) accounts,MAX(a.account_id IS NOT s.account_id) invalid_account FROM team_source_attachments a JOIN source_teams s ON s.id=a.source_team_id JOIN app_teams t ON t.id=a.app_team_id WHERE a.app_team_id>? OR(a.app_team_id=? AND a.source_team_id>?) GROUP BY a.app_team_id,a.source_team_id ORDER BY a.app_team_id,a.source_team_id LIMIT 24`).bind(team,team,source).all()).results;
  for(const row of rows){if(row.accounts!==1||row.invalid_account)fail('installation_attachment_scope','An existing source attachment needs a scope review before the update can continue.');row.id=await nativeCanonicalId('connection-root',row.app_team_id+'|'+row.source_team_id);}
  const data=encode(rows),last=rows.at(-1);
  await this.transact(j,rows.length?[this.db.prepare(`INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,scope_origin,active,generation,input_revision,reconciled_revision,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.app_team_id'),json_extract(value,'$.source_team_id'),json_extract(value,'$.account_id'),'fixed_seasons','legacy_ambiguous',json_extract(value,'$.active'),json_extract(value,'$.generation'),1,0,json_extract(value,'$.created_at') FROM json_each(?) WHERE 1 ON CONFLICT(app_team_id,source_team_id) DO NOTHING`).bind(data)]:[],{phase:rows.length?'roots':'memberships',cursor:last?encode([last.app_team_id,last.source_team_id]):''});
 }
 async backfillMemberships(j){
  const rows=(await this.db.prepare('SELECT id FROM team_source_attachments WHERE id>? ORDER BY id LIMIT 48').bind(j.cursor).all()).results;
  await this.transact(j,rows.length?[this.db.prepare(`INSERT INTO team_connection_seasons(connection_id,team_season_id,attachment_id,basis,active,excluded,generation) SELECT c.id,a.team_season_id,a.id,'fixed',a.active,CASE WHEN a.active=0 THEN 1 ELSE 0 END,a.generation FROM team_source_attachments a JOIN team_source_connections c ON c.app_team_id=a.app_team_id AND c.source_team_id=a.source_team_id WHERE a.id IN(SELECT value FROM json_each(?)) ON CONFLICT(connection_id,team_season_id) DO NOTHING`).bind(encode(rows.map(row=>row.id)))]:[],{phase:rows.length?'memberships':'receipts',cursor:rows.at(-1)?.id??''});
 }
 async backfillReceipts(j){
  const rows=(await this.db.prepare('SELECT id,request_id,created_at FROM app_teams WHERE request_id IS NOT NULL AND id>? ORDER BY id LIMIT 24').bind(j.cursor).all()).results;
  for(const row of rows){row.attachment_id=await nativeCanonicalId('connection-attachment',row.id);row.tombstone_id=await nativeCanonicalId('legacy-unresolved-connection',row.id);}
  await this.transact(j,rows.length?[this.db.prepare(`INSERT INTO connection_command_receipts(request_id,payload_version,payload_hash,team_id,connection_id,connection_generation,outcome,created_at) SELECT json_extract(v.value,'$.request_id'),1,NULL,json_extract(v.value,'$.id'),COALESCE(c.id,json_extract(v.value,'$.tombstone_id')),COALESCE(c.generation,1),'created',json_extract(v.value,'$.created_at') FROM json_each(?) v LEFT JOIN team_source_attachments a ON a.id=json_extract(v.value,'$.attachment_id') AND a.app_team_id=json_extract(v.value,'$.id') LEFT JOIN team_source_connections c ON c.app_team_id=a.app_team_id AND c.source_team_id=a.source_team_id WHERE 1 ON CONFLICT(request_id) DO NOTHING`).bind(encode(rows))]:[],{phase:rows.length?'receipts':'rosters',cursor:rows.at(-1)?.id??''});
 }
 async backfillRosters(j){
  const [rowid=0,player='',connection='']=tuple(j.cursor),rows=(await this.db.prepare(`SELECT r.rowid source_rowid,c.id connection_id,r.team_season_id,sp.id source_player_id,r.run_id,r.player_id,r.name,r.jersey,p.created_at observed_at FROM team_player_rows r JOIN team_projection_state published ON published.app_team_id=r.app_team_id AND published.team_season_id=r.team_season_id AND published.published_run_id=r.run_id JOIN team_projection_runs p ON p.id=r.run_id JOIN json_each(r.source_ids) ids JOIN source_players sp ON sp.id=ids.value JOIN source_roster_memberships rm ON rm.source_player_id=sp.id JOIN team_source_connections c ON c.app_team_id=r.app_team_id AND c.source_team_id=rm.source_team_id AND c.account_id=sp.account_id JOIN team_connection_seasons cs ON cs.connection_id=c.id AND cs.team_season_id=r.team_season_id WHERE r.rowid>? OR(r.rowid=? AND(sp.id>? OR(sp.id=? AND c.id>?))) ORDER BY r.rowid,sp.id,c.id LIMIT 48`).bind(rowid,rowid,player,player,connection).all()).results;
  for(const row of rows){row.basis_key='accepted_projection:'+row.run_id+':'+row.player_id;row.source_hash=await digest(encode({name:row.name,jersey:row.jersey,source_player_id:row.source_player_id,basis_key:row.basis_key}));}
  const last=rows.at(-1);
  await this.transact(j,rows.length?[this.db.prepare(`INSERT INTO connection_roster_evidence(connection_id,team_season_id,source_player_id,basis_key,basis,certainty,name,jersey,position,observed_at,source_hash) SELECT json_extract(value,'$.connection_id'),json_extract(value,'$.team_season_id'),json_extract(value,'$.source_player_id'),json_extract(value,'$.basis_key'),'accepted_projection','preserved_uncertain',json_extract(value,'$.name'),json_extract(value,'$.jersey'),NULL,json_extract(value,'$.observed_at'),json_extract(value,'$.source_hash') FROM json_each(?) WHERE 1 ON CONFLICT(connection_id,team_season_id,source_player_id,basis_key) DO NOTHING`).bind(encode(rows))]:[],{phase:rows.length?'rosters':'events',cursor:last?encode([last.source_rowid,last.source_player_id,last.connection_id]):''});
 }
 async backfillEvents(j){
  const [team='',event='']=tuple(j.cursor),groups=(await this.db.prepare(`SELECT r.app_team_id,r.event_id,COUNT(*) memberships FROM team_event_rows r JOIN team_projection_state p ON p.app_team_id=r.app_team_id AND p.team_season_id=r.team_season_id AND p.published_run_id=r.run_id WHERE r.app_team_id>? OR(r.app_team_id=? AND r.event_id>?) GROUP BY r.app_team_id,r.event_id ORDER BY r.app_team_id,r.event_id LIMIT 10`).bind(team,team,event).all()).results;
  const rows=[];for(const group of groups){
   const memberships=(await this.db.prepare(`SELECT r.team_season_id,r.starts_at,r.local_day,s.start_day,s.end_day,t.timezone FROM team_event_rows r JOIN team_projection_state p ON p.app_team_id=r.app_team_id AND p.team_season_id=r.team_season_id AND p.published_run_id=r.run_id JOIN team_seasons s ON s.id=r.team_season_id JOIN app_teams t ON t.id=r.app_team_id WHERE r.app_team_id=? AND r.event_id=? ORDER BY r.team_season_id LIMIT 25`).bind(group.app_team_id,group.event_id).all()).results;
   const only=memberships.length===1&&group.memberships===1?memberships[0]:null,day=only?observedDay(only,only.timezone):null,dated=only&&day&&day>=only.start_day&&day<only.end_day;
   rows.push({...group,team_season_id:only?only.team_season_id:null,state:dated?'resolved':group.memberships>1||day?'conflict':'pending',effective_day:only?day:null,starts_at:only?only.starts_at:null,local_day:only?only.local_day:null,basis:'accepted_projection',evidence:encode({basis:'accepted_projection',uncertain:true,membership_count:group.memberships,truncated:group.memberships>25,memberships:memberships.map(({team_season_id,starts_at,local_day})=>({team_season_id,starts_at,local_day}))})});
  }
  const last=groups.at(-1);
  await this.transact(j,rows.length?[this.db.prepare(`INSERT INTO team_event_season_resolutions(app_team_id,event_id,team_season_id,state,effective_day,starts_at,local_day,basis,evidence) SELECT json_extract(value,'$.app_team_id'),json_extract(value,'$.event_id'),json_extract(value,'$.team_season_id'),json_extract(value,'$.state'),json_extract(value,'$.effective_day'),json_extract(value,'$.starts_at'),json_extract(value,'$.local_day'),json_extract(value,'$.basis'),json_extract(value,'$.evidence') FROM json_each(?) WHERE 1 ON CONFLICT(app_team_id,event_id) DO NOTHING`).bind(encode(rows))]:[],{phase:groups.length?'events':'validating',cursor:last?encode([last.app_team_id,last.event_id]):''});
 }
}

export {V714_FINGERPRINT,V714_CURSOR,V714_OBJECTS,metadataQuery,sealStatements,journalStatements,equalObjects};
