import {InstallationError} from './fresh-install.js';
import {V714_OBJECTS} from './schema-v714.js';
import {tableGuards} from './installation-epoch.js';

// The only reconstructed legacy tables in this exact release. These fixed
// copies are temporary recovery data for the three reviewed parent definitions.
// Data-file scope and Coach half duration are the only old constraints changed.
const definitions=[
 ['data_file_exports','id TEXT,app_team_id TEXT,team_season_id TEXT,kind TEXT,scope TEXT,sections TEXT,source_revision INTEGER,capture_signature TEXT,capture_fence TEXT,state TEXT,checkpoint TEXT,part_count INTEGER,byte_length INTEGER,error_code TEXT,created_at INTEGER,expires_at INTEGER'],
 ['data_file_imports','id TEXT,app_team_id TEXT,team_season_id TEXT,manifest TEXT,state TEXT,received INTEGER,applied INTEGER,created_at INTEGER,expires_at INTEGER'],
 ['data_file_entries','export_id TEXT,ordinal INTEGER,name TEXT,section TEXT,row_count INTEGER,sha256 TEXT,crc INTEGER,byte_length INTEGER,zip_offset INTEGER'],
 ['data_file_parts','export_id TEXT,ordinal INTEGER,bytes BLOB'],
 ['data_file_import_segments','import_id TEXT,ordinal INTEGER,payload TEXT,validated INTEGER'],
 ['coach_sessions','app_team_id TEXT,team_season_id TEXT,event_id TEXT,format INTEGER,half_minutes INTEGER,phase TEXT,period INTEGER,elapsed_ms INTEGER,period_start_ms INTEGER,running_since TEXT,clock_review INTEGER,revision INTEGER,updated_at TEXT,write_token TEXT'],
 ['coach_session_players','app_team_id TEXT,team_season_id TEXT,event_id TEXT,player_id TEXT,name TEXT,jersey TEXT,available INTEGER,availability_source TEXT,minutes_override_ms INTEGER'],
 ['coach_lineup','app_team_id TEXT,team_season_id TEXT,event_id TEXT,position TEXT,player_id TEXT'],
 ['coach_stints','id TEXT,app_team_id TEXT,team_season_id TEXT,event_id TEXT,player_id TEXT,position TEXT,period INTEGER,start_ms INTEGER,end_ms INTEGER'],
 ['coach_timeline','id TEXT,app_team_id TEXT,team_season_id TEXT,event_id TEXT,sequence INTEGER,kind TEXT,period INTEGER,match_ms INTEGER,recorded_at TEXT,player_out TEXT,player_in TEXT,position TEXT,range_start_ms INTEGER,range_end_ms INTEGER,detail TEXT'],
];
export const TRANSFER_TABLES=definitions.map(([name,fields])=>({name,copy:'installation_transfer_copy_'+name,columns:fields.split(',').map(field=>field.split(' ')[0]),ddl:'CREATE TABLE installation_transfer_copy_'+name+'(original_rowid INTEGER PRIMARY KEY,'+fields+')'}));
export const TRANSFER_COPY_DDL=TRANSFER_TABLES.map(table=>table.ddl);
const tables=new Map(TRANSFER_TABLES.map(table=>[table.name,table]));
const dataFileParents=['data_file_exports','data_file_imports'];
export const TRANSFER_PARENT_NAMES=[...dataFileParents,'coach_sessions'];
export const TRANSFER_TARGET_DDL=Object.fromEntries(TRANSFER_PARENT_NAMES.map(name=>{
 const old=V714_OBJECTS.find(row=>row.type==='table'&&row.name===name).sql;
 if(name==='coach_sessions')return [name,old.replace('half_minutes BETWEEN 5 AND 60','half_minutes BETWEEN 5 AND 90')];
 return [name,old.replace('team_season_id TEXT NOT NULL REFERENCES','team_season_id TEXT REFERENCES').replace("'staging','queued','applying','ready','failed'","'staging','queued','validating','applying','ready','failed'").slice(0,-1)+",scope_kind TEXT NOT NULL DEFAULT 'legacy_season' CHECK(scope_kind IN('legacy_season','connected_history')),CHECK((scope_kind='legacy_season' AND team_season_id IS NOT NULL) OR(scope_kind='connected_history' AND team_season_id IS NULL)))"];
}));
export const TRANSFER_PLAN={version:'exact-data-file-scope-and-coach-duration-reconstruction-v1',copies:TRANSFER_COPY_DDL,parents:TRANSFER_TARGET_DDL,maxRows:16,maxBytes:4000000};
export const TRANSFER_INITIAL_CURSOR=JSON.stringify({step:'prepare',table:0,after:null});
const drainOrder=['data_file_entries','data_file_parts','data_file_import_segments',...dataFileParents,'coach_lineup','coach_stints','coach_timeline','coach_session_players','coach_sessions'];
const steps=['prepare','copy','verify_stage','drain','swap','restore','verify_final','cleanup','drop_copies'];
const phasesWithRows=new Set(['copy','verify_stage','drain','restore','verify_final','cleanup']);
const fail=(code,message)=>{throw new InstallationError(code,message,409);};
const invalid=()=>fail('installation_transfer_cursor','The saved data and Coach update needs a reviewed continuation.');

export function transferCursor(value){
 let cursor;try{cursor=JSON.parse(value);}catch{invalid();}
 if(!cursor||Array.isArray(cursor)||!steps.includes(cursor.step)||!Number.isInteger(cursor.table)||cursor.table<0||cursor.table>=TRANSFER_TABLES.length||Object.keys(cursor).some(key=>!['step','table','after','reverse'].includes(key)))invalid();
 if(cursor.after!==null){
  if(typeof cursor.after!=='string'||cursor.after.length>20||! /^-?(?:0|[1-9][0-9]*)$/.test(cursor.after))invalid();
  const integer=BigInt(cursor.after);if(integer<-(1n<<63n)||integer>(1n<<63n)-1n)invalid();
 }
 if(cursor.reverse!==undefined&&cursor.reverse!==true)invalid();
 if(cursor.reverse&&!['verify_stage','verify_final'].includes(cursor.step))invalid();
 if(!phasesWithRows.has(cursor.step)&&(cursor.table!==0||cursor.after!==null||cursor.reverse))invalid();
 return cursor;
}

export function transferObjects(targetObjects,value){
 const cursor=transferCursor(value),swapped=['restore','verify_final','cleanup','drop_copies'].includes(cursor.step);
 const objects=targetObjects.map(row=>!swapped&&row.type==='table'&&TRANSFER_PARENT_NAMES.includes(row.name)?{...row,sql:V714_OBJECTS.find(old=>old.type==='table'&&old.name===row.name).sql}:row);
 if(cursor.step!=='prepare')for(const table of TRANSFER_TABLES)objects.push({type:'table',name:table.copy,sql:table.ddl});
 return objects;
}

async function page(db,table,{staged,after}){
 const source=staged?table.copy:table.name,key=staged?'original_rowid':'rowid';
 // Only keys and byte counts cross the Worker boundary. Decimal rowid strings
 // retain all 64 bits; values/BLOBs move and compare exclusively inside SQLite.
 const bytes=table.columns.map(column=>'COALESCE(length(CAST('+column+' AS BLOB)),0)').join('+')+'+64';
 const rows=(await db.prepare('SELECT CAST('+key+' AS TEXT) AS key,'+bytes+' AS bytes FROM '+source+(after===null?'':' WHERE '+key+'>?')+' ORDER BY '+key+' LIMIT '+TRANSFER_PLAN.maxRows).bind(...(after===null?[]:[after])).all()).results;
 let size=0;const chosen=[];
 for(const row of rows){if(!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>TRANSFER_PLAN.maxBytes)fail('installation_transfer_row_size','A saved data and Coach row needs a size review before its update can continue.');if(size+row.bytes>TRANSFER_PLAN.maxBytes)break;size+=row.bytes;chosen.push(row);}
 return chosen;
}
async function compare(db,table,rows,reverse,{target=false}={}){
 const source=reverse?table.name:table.copy,destination=reverse?table.copy:table.name,sourceKey=reverse?'rowid':'original_rowid',destinationKey=reverse?'original_rowid':'rowid';
 const clauses=['d.'+destinationKey+' IS NULL',...table.columns.map(column=>'s.'+column+' IS NOT d.'+column)];
 if(target&&dataFileParents.includes(table.name))clauses.push((reverse?'s':'d')+".scope_kind<>'legacy_season'");
 const bad=await db.prepare('SELECT 1 FROM '+source+' s LEFT JOIN '+destination+' d ON d.'+destinationKey+'=s.'+sourceKey+' WHERE s.'+sourceKey+' IN(SELECT value FROM json_each(?)) AND ('+clauses.join(' OR ')+') LIMIT 1').bind(JSON.stringify(rows.map(row=>row.key))).first();
 if(bad)fail('installation_transfer_integrity','The saved data and Coach copy differs from its preserved records. Existing recovery data has been retained.');
}
async function checkForeignKeys(db){if(await db.prepare('SELECT 1 FROM pragma_foreign_key_check LIMIT 1').first())fail('installation_integrity','The installation needs a data-integrity review before updates can resume.');}

export async function advanceTransfers(upgrade,journal){
 const db=upgrade.db,cursor=transferCursor(journal.cursor);let statements=[],next={...cursor};
 if(cursor.step==='prepare'){
  statements=TRANSFER_COPY_DDL.map(sql=>db.prepare(sql));next={step:'copy',table:0,after:null};
 }else if(cursor.step==='swap'){
  for(const table of TRANSFER_TABLES)if(await db.prepare('SELECT 1 FROM '+table.name+' LIMIT 1').first())fail('installation_transfer_integrity','A saved data and Coach table has not finished its guarded copy.');
  for(const name of TRANSFER_PARENT_NAMES)statements.push(db.prepare('DROP TABLE '+name),db.prepare(TRANSFER_TARGET_DDL[name]),...V714_OBJECTS.filter(row=>row.type==='index'&&row.tbl_name===name).map(row=>db.prepare(row.sql)),...tableGuards([name]).map(sql=>db.prepare(sql)));
  next={step:'restore',table:0,after:null};
 }else if(cursor.step==='drop_copies'){
  await checkForeignKeys(db);
  for(const table of TRANSFER_TABLES){if(await db.prepare('SELECT 1 FROM '+table.copy+' LIMIT 1').first())fail('installation_transfer_integrity','The verified saved-data copy has not finished its bounded cleanup.');statements.push(db.prepare('DROP TABLE '+table.copy));}
  await upgrade.transact(journal,statements,{phase:'roots',cursor:''});return;
 }else{
  const names=cursor.step==='drain'?drainOrder:TRANSFER_TABLES.map(table=>table.name),table=tables.get(names[cursor.table]);
  const staged=['verify_stage','restore','verify_final','cleanup'].includes(cursor.step)&&!cursor.reverse;
  const rows=await page(db,table,{staged,after:cursor.after}),ids=JSON.stringify(rows.map(row=>row.key)),columns=table.columns.join(',');
  if(rows.length){
   if(cursor.step==='copy')statements=[db.prepare('INSERT INTO '+table.copy+'(original_rowid,'+columns+') SELECT rowid,'+columns+' FROM '+table.name+' WHERE rowid IN(SELECT value FROM json_each(?))').bind(ids)];
   else if(cursor.step==='restore')statements=[db.prepare('INSERT INTO '+table.name+'(rowid,'+columns+') SELECT original_rowid,'+columns+' FROM '+table.copy+' WHERE original_rowid IN(SELECT value FROM json_each(?))').bind(ids)];
   else if(cursor.step==='drain'||cursor.step==='cleanup')statements=[db.prepare('DELETE FROM '+(staged?table.copy:table.name)+' WHERE '+(staged?'original_rowid':'rowid')+' IN(SELECT value FROM json_each(?))').bind(ids)];
   else await compare(db,table,rows,cursor.reverse===true,{target:cursor.step==='verify_final'});
   next.after=rows.at(-1).key;
  }else if(['verify_stage','verify_final'].includes(cursor.step)&&!cursor.reverse)next={...cursor,after:null,reverse:true};
  else if(cursor.table+1<names.length)next={step:cursor.step,table:cursor.table+1,after:null};
  else{
   if(cursor.step==='verify_final')await checkForeignKeys(db);
   next={step:{copy:'verify_stage',verify_stage:'drain',drain:'swap',restore:'verify_final',verify_final:'cleanup',cleanup:'drop_copies'}[cursor.step],table:0,after:null};
  }
 }
 await upgrade.transact(journal,statements,{phase:'transfers',cursor:JSON.stringify(next)});
}
