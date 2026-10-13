// This partial-schema fixture exercises the frozen 731 permit contract. Full current installation is covered separately.
// Feasibility proof only. The production schema/upgrade plan is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {Agent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {V714_OBJECTS} from '../src/application/schema-v714.js';

const names=['data_file_exports','data_file_imports','data_file_entries','data_file_parts','data_file_import_segments'];
const support=['provider_accounts','app_teams','team_seasons','sync_jobs','setup_state'];
const original=V714_OBJECTS.filter(o=>support.includes(o.name)||names.includes(o.name)||['data_file_exports_expiry','data_file_imports_expiry'].includes(o.name));
const replacement=Object.fromEntries(names.slice(0,2).map(name=>{
 const old=V714_OBJECTS.find(row=>row.type==='table'&&row.name===name).sql;
 const sql=old.replace('team_season_id TEXT NOT NULL REFERENCES','team_season_id TEXT REFERENCES').replace("'staging','queued','applying','ready','failed'","'staging','queued','validating','applying','ready','failed'").slice(0,-1)+",scope_kind TEXT NOT NULL DEFAULT 'legacy_season' CHECK(scope_kind IN('legacy_season','connected_history')),CHECK((scope_kind='legacy_season' AND team_season_id IS NOT NULL) OR(scope_kind='connected_history' AND team_season_id IS NULL)))";
 return [name,sql];
}));

async function harness(){
 const root=path.resolve('.'),modules={};
 for(const file of(await readdir(path.join(root,'src'),{recursive:true})).filter(file=>file.endsWith('.js')))modules['src/'+file]={type:'esm',contents:await readFile(path.join(root,'src',file),'utf8')};
 modules['web/app/coach-tactics.js']={type:'esm',contents:await readFile(path.join(root,'web/app/coach-tactics.js'),'utf8')};for(const name of ['web/app/schedule-query.js','web/app/reporting/encoders.js','web/app/reporting/font-metrics.js'])modules[name]={type:'esm',contents:await readFile(path.join(root,name),'utf8')};
 modules['transfer-proof.js']={type:'esm',contents:`
  import {UPGRADE_DDL,JOURNAL_GUARDS,tableGuards,wrapDatabase,INSTALLATION_EPOCH} from './src/application/installation-epoch-v731.js';
  import {BudgetDB} from './src/sync/budget.js';
  import {schemaObjects,equalObjects} from './src/application/schema-upgrade.js';
  const names=${JSON.stringify(names)},support=${JSON.stringify(support)},original=${JSON.stringify(original)},replacement=${JSON.stringify(replacement)};
  const copyName=name=>'installation_transfer_copy_'+name;
  const pageSize=2,order=['data_file_entries','data_file_parts','data_file_import_segments','data_file_exports','data_file_imports'];
  const columns={},copies={};
  const meta="SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name";
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  async function definitions(db){
   for(const name of names){
    const info=(await db.prepare('PRAGMA table_info('+name+')').all()).results.filter(row=>row.name!=='scope_kind');
    columns[name]=info.map(row=>row.name);
    copies[name]='CREATE TABLE '+copyName(name)+'(original_rowid INTEGER PRIMARY KEY,'+info.map(row=>row.name+' '+row.type).join(',')+')';
   }
  }
  async function snapshot(db,staged=false){
   const hashes={},counts={};
   for(const name of [...names,'sync_jobs','setup_state']){
    const table=staged&&names.includes(name)?copyName(name):name;
    const list=columns[name]?.map(column=>column==='bytes'?'hex(bytes) AS bytes':column).join(',')||'*';
    const rows=(await db.prepare('SELECT '+(names.includes(name)?(staged?'original_rowid':'rowid')+' AS retained_rowid,':'')+list+' FROM '+table+' ORDER BY '+(staged&&names.includes(name)?'original_rowid':'rowid')).all()).results;
    counts[name]=rows.length;hashes[name]=await digest(rows);
   }
   return {hashes,counts};
  }
  async function init(raw){
   for(const row of [...original].sort((a,b)=>(a.type==='table'?0:1)-(b.type==='table'?0:1)))await raw.prepare(row.sql).run();
   await raw.batch([
    raw.prepare("INSERT INTO app_teams VALUES('team','Retained team','UTC',2026,NULL,'original-start')"),
    raw.prepare("INSERT INTO team_seasons VALUES('season','team',2026,'2026-01-01','2027-01-01','2026-01-01T00:00:00Z','2027-01-01T00:00:00Z',0)"),
    raw.prepare("INSERT INTO setup_state VALUES(1,'original',270,'ready','original-start','original-complete')"),
   ]);
   for(let i=0;i<5;i++){
    await raw.batch([
     raw.prepare("INSERT INTO data_file_exports(rowid,id,app_team_id,team_season_id,kind,scope,sections,source_revision,capture_signature,capture_fence,state,checkpoint,part_count,byte_length,error_code,created_at,expires_at) VALUES(?,?,'team','season',?,?,?,7,?,NULL,?,? ,3,192000,?,100,9999999999999)").bind(i-2,'export-'+i,i%2?'dataset':'evidence',JSON.stringify({season:'season'}),JSON.stringify(['retained-section']),'signature-'+i,['capturing','ready','failed'][i%3],JSON.stringify({offset:i,retained:'checkpoint'}),i%3===2?'retained_error':null),
     raw.prepare("INSERT INTO data_file_imports(rowid,id,app_team_id,team_season_id,manifest,state,received,applied,created_at,expires_at) VALUES(?,?,'team','season',?,?,3,?,100,9999999999999)").bind(i-2,'import-'+i,JSON.stringify({scope:'legacy-season',signature:'old-'+i,portable:'preserved'}),['staging','queued','applying','ready','failed'][i],i),
     raw.prepare("INSERT INTO sync_jobs(id,provider,account_scope,component,stage,scope,resource_key,args,checkpoint,scan_id,state,ready_since,next_at,interval_ms,lease_token,lease_until,pages_saved) VALUES(?,'internal','public','file_export','export','team',?,? ,?,'retained-scan','running',1,2,900000,'old-lease',9999999999999,11)").bind('job-'+i,'export-'+i,JSON.stringify({export_id:'export-'+i}),JSON.stringify({offset:i,retained:'source-checkpoint'})),
    ]);
    for(let j=0;j<3;j++)await raw.batch([
     raw.prepare("INSERT INTO data_file_entries VALUES(?,?,?,NULL,?,? ,123,64000,?)").bind('export-'+i,j,'segments/'+j+'.json',j+1,'retained-sha-'+i+'-'+j,j*64000),
     raw.prepare("INSERT INTO data_file_parts VALUES(?,?,randomblob(64000))").bind('export-'+i,j),
     raw.prepare("INSERT INTO data_file_import_segments VALUES(?,?,?,?)").bind('import-'+i,j,JSON.stringify({ordinal:j,rows:['retained-'+i,'x'.repeat(j===2?250000:50)]}),j%2),
    ]);
   }
   await definitions(raw);
   const initial=await snapshot(raw),plan=await digest({copies,replacement,original});
   await raw.batch([raw.prepare(UPGRADE_DDL),raw.prepare("INSERT INTO installation_upgrade(id,epoch,from_fingerprint,to_fingerprint,plan_hash,phase,cursor,started_at,original_started_at,original_completed_at,original_cursor) VALUES(1,?,'original','target',?,'expanding',?,'upgrade-start','original-start','original-complete',270)").bind(INSTALLATION_EPOCH,plan,JSON.stringify({step:'prepare',table:0,after:null})),...JOURNAL_GUARDS.map(sql=>raw.prepare(sql))]);
   const guards=tableGuards([...support,...names]);for(let i=0;i<guards.length;i+=24)await raw.batch(guards.slice(i,i+24).map(sql=>raw.prepare(sql)));
   return {initial,plan,copies,replacement};
  }
  function physical(cursor){
   const swapped=['restore','verify_final','cleanup','drop_copies','complete'].includes(cursor.step);
   const hasCopies=!['prepare','complete'].includes(cursor.step);
   return schemaObjects([...original.map(row=>swapped&&replacement[row.name]?replacement[row.name]:row.sql),UPGRADE_DDL,...JOURNAL_GUARDS,...tableGuards([...support,...names]),...(hasCopies?Object.values(copies):[])]);
  }
  async function transact(db,j,statements,next,{fault=false,lost=false}={}){
   const batch=[
    db.prepare("UPDATE installation_upgrade SET writer_mode='upgrade',writer_epoch=?,permit_guard=0 WHERE id=1 AND writer_mode IS NULL").bind(INSTALLATION_EPOCH),
    db.prepare("UPDATE installation_upgrade SET assertion=CASE WHEN phase='expanding' AND cursor=? THEN 1 ELSE 0 END WHERE id=1").bind(j.cursor),
    ...statements,
    ...(fault?[db.prepare('UPDATE installation_upgrade SET assertion=0 WHERE id=1')]:[]),
    db.prepare('UPDATE installation_upgrade SET cursor=? WHERE id=1').bind(JSON.stringify(next)),
    db.prepare('UPDATE installation_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1'),
   ];
   await db.batch(batch);if(lost)throw Error('simulated_lost_acknowledgement');
  }
  async function comparePage(db,name,rows,reverse){
   if(!rows.length)return;
   const source=reverse?name:copyName(name),dest=reverse?copyName(name):name,sourceKey=reverse?'rowid':'original_rowid',destKey=reverse?'original_rowid':'rowid';
   const ids=JSON.stringify(rows.map(row=>row.key));
   const mismatch=await db.prepare('SELECT 1 FROM '+source+' s LEFT JOIN '+dest+' d ON d.'+destKey+'=s.'+sourceKey+' WHERE s.'+sourceKey+' IN(SELECT value FROM json_each(?)) AND (d.'+destKey+' IS NULL OR '+columns[name].map(column=>'s.'+column+' IS NOT d.'+column).join(' OR ')+') LIMIT 1').bind(ids).first();
   if(mismatch)throw Error('copy_value_mismatch');
  }
  async function advance(raw,body){
   const db=new BudgetDB(raw,50);await definitions(db);
   const current=await db.prepare('SELECT * FROM installation_upgrade WHERE id=1').first(),j=body.stale||current,c=JSON.parse(j.cursor);
   if(current.plan_hash!==await digest({copies,replacement,original}))throw Error('plan_mismatch');
   if(!['prepare','copy','verify_stage','drain','swap','restore','verify_final','cleanup','drop_copies','complete'].includes(c.step))throw Error('unknown_phase');
   const objects=(await db.prepare(meta).all()).results;if(!equalObjects(objects,physical(JSON.parse(current.cursor))))throw Error('physical_schema_mismatch');
   if(c.step==='complete')return {complete:true,used:db.used};
   let statements=[],next={...c},rows=[];
   if(c.step==='prepare'){statements=Object.values(copies).map(sql=>db.prepare(sql));next={step:'copy',table:0,after:null};}
   else if(c.step==='swap'){
    for(const name of names.slice(0,2)){
     if(await db.prepare('SELECT 1 FROM '+name+' LIMIT 1').first())throw Error('parent_not_empty');
     statements.push(db.prepare('DROP TABLE '+name),db.prepare(replacement[name]),...original.filter(row=>row.type==='index'&&row.tbl_name===name).map(row=>db.prepare(row.sql)),...tableGuards([name]).map(sql=>db.prepare(sql)));
    }
    next={step:'restore',table:0,after:null};
   }else if(c.step==='drop_copies'){
    if(await db.prepare('SELECT 1 FROM pragma_foreign_key_check LIMIT 1').first())throw Error('foreign_key_failure');
    for(const name of names){if(await db.prepare('SELECT 1 FROM '+copyName(name)+' LIMIT 1').first())throw Error('copy_not_empty');statements.push(db.prepare('DROP TABLE '+copyName(name)));}
    next={step:'complete',table:0,after:null};
   }else{
    const phaseNames=c.step==='drain'?order:names,name=phaseNames[c.table];
    const staged=['verify_stage','restore','verify_final','cleanup'].includes(c.step),reverse=c.reverse===true;
    const table=staged&&!reverse?copyName(name):name,key=staged&&!reverse?'original_rowid':'rowid';
    rows=(await db.prepare('SELECT '+key+' AS key FROM '+table+(c.after===null?'':' WHERE '+key+'>?')+' ORDER BY '+key+' LIMIT '+pageSize).bind(...(c.after===null?[]:[c.after])).all()).results;
    const ids=JSON.stringify(rows.map(row=>row.key)),cols=columns[name].join(',');
    if(rows.length){
     if(c.step==='copy')statements=[db.prepare('INSERT INTO '+copyName(name)+'(original_rowid,'+cols+') SELECT rowid,'+cols+' FROM '+name+' WHERE rowid IN(SELECT value FROM json_each(?))').bind(ids)];
     else if(c.step==='drain'||c.step==='cleanup')statements=[db.prepare('DELETE FROM '+table+' WHERE '+key+' IN(SELECT value FROM json_each(?))').bind(ids)];
     else if(c.step==='restore')statements=[db.prepare('INSERT INTO '+name+'(rowid,'+cols+') SELECT original_rowid,'+cols+' FROM '+copyName(name)+' WHERE original_rowid IN(SELECT value FROM json_each(?))').bind(ids)];
     else await comparePage(db,name,rows,reverse);
     next.after=rows.at(-1).key;
    }else if(['verify_stage','verify_final'].includes(c.step)&&!reverse)next={...c,after:null,reverse:true};
    else if(c.table+1<phaseNames.length)next={step:c.step,table:c.table+1,after:null};
    else next={step:{copy:'verify_stage',verify_stage:'drain',drain:'swap',restore:'verify_final',verify_final:'cleanup',cleanup:'drop_copies'}[c.step],table:0,after:null};
   }
   await transact(db,j,statements,next,body);
   return {cursor:next,rows:rows.length,used:db.used};
  }
  export default {async fetch(request,env){const body=await request.json();try{
   let result;
   if(body.op==='init')result=await init(env.DB);
   else if(body.op==='advance')result=await advance(env.DB,body);
   else if(body.op==='snapshot'){await definitions(env.DB);result=await snapshot(env.DB,body.staged);}
   else if(body.op==='journal')result=await env.DB.prepare('SELECT * FROM installation_upgrade WHERE id=1').first();
   else if(body.op==='raw')result=await env.DB.batch(body.statements.map(row=>env.DB.prepare(row.sql).bind(...(row.params||[]))));
   else if(body.op==='application')result=await wrapDatabase(env.DB).prepare(body.sql).run();
   return Response.json({result});
  }catch(error){return Response.json({error:{name:error.name,message:error.message,code:error.code||null}},{status:409});}}};
 `};
 const previous=getGlobalDispatcher(),dispatcher=new Agent({pipelining:0});setGlobalDispatcher(dispatcher);let mf;
 const dispose=async()=>{try{if(mf)await mf.dispose();}finally{setGlobalDispatcher(previous);await dispatcher.close();}};
 try{
  const options={cf:false,telemetry:{enabled:false},workers:[{config:{name:'transfer-proof',compatibilityDate:'2026-09-09',manifest:{mainModule:'transfer-proof.js',modulesRoot:root,modules},env:{DB:{type:'d1',id:'transfer-proof'}},exports:{}}}]};
  mf=new Miniflare(options);await mf.ready;
  const call=async body=>{const response=await mf.dispatchFetch('https://transfer-proof.test/',{method:'POST',body:JSON.stringify(body)}),value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error.message),value.error);return value.result;};
  return {call,dispose,restart:async()=>{modules['transfer-proof.js'].contents+='\n// restart from durable cursor\n';await mf.setOptions(options);}};
 }catch(error){await dispose();throw error;}
}

test('native feasibility: bounded exact parent reconstruction preserves original transfer graph through rollback and lost acknowledgement',async()=>{
 const h=await harness();try{
  const initial=await h.call({op:'init'}),seen=new Set(),faulted=new Set();let maxUsed=0,pages=0,restarted=false,driftChecked=false,corruptionChecked=false;
  while(true){
   const journal=await h.call({op:'journal'}),cursor=JSON.parse(journal.cursor);
   assert.equal(journal.writer_mode,null);assert.equal(journal.permit_guard,null);
   if(cursor.step==='complete')break;
   seen.add(cursor.step);
   if(cursor.step==='copy'&&!driftChecked){
    await h.call({op:'raw',statements:[{sql:'CREATE INDEX unreviewed_copy_index ON installation_transfer_copy_data_file_exports(id)'}]});
    await assert.rejects(h.call({op:'advance'}),/physical_schema_mismatch/);
    await h.call({op:'raw',statements:[{sql:'DROP INDEX unreviewed_copy_index'}]});driftChecked=true;
   }
   if(cursor.step==='verify_stage'&&cursor.table===3&&cursor.after===null&&!corruptionChecked){
    await h.call({op:'raw',statements:[{sql:'UPDATE installation_transfer_copy_data_file_parts SET bytes=zeroblob(64000) WHERE original_rowid=(SELECT MIN(original_rowid) FROM installation_transfer_copy_data_file_parts)'}]});
    await assert.rejects(h.call({op:'advance'}),/copy_value_mismatch/);
    assert.deepEqual(await h.call({op:'journal'}),journal);
    await h.call({op:'raw',statements:[{sql:'UPDATE installation_transfer_copy_data_file_parts SET bytes=(SELECT bytes FROM data_file_parts WHERE data_file_parts.rowid=installation_transfer_copy_data_file_parts.original_rowid) WHERE original_rowid=(SELECT MIN(original_rowid) FROM installation_transfer_copy_data_file_parts)'}]});corruptionChecked=true;
   }
   if(cursor.step==='restore'&&cursor.table===1&&!restarted){
    const before=await h.call({op:'snapshot'});await h.restart();
    assert.deepEqual(await h.call({op:'journal'}),journal);assert.deepEqual(await h.call({op:'snapshot'}),before);restarted=true;
   }
   if(!faulted.has(cursor.step)&&['copy','drain','swap','restore'].includes(cursor.step)){
    const before=await h.call({op:'snapshot'});
    await assert.rejects(h.call({op:'advance',fault:true}),/CHECK constraint failed/);
    assert.deepEqual(await h.call({op:'journal'}),journal);
    assert.deepEqual(await h.call({op:'snapshot'}),before);
    faulted.add(cursor.step);
   }
   if(cursor.step==='drain'&&cursor.table===0&&cursor.after===null){
    const staged=await h.call({op:'snapshot',staged:true});assert.deepEqual(staged,initial.initial);
    await assert.rejects(h.call({op:'raw',statements:[{sql:"UPDATE data_file_exports SET checkpoint='{}'"}]}),/installation_epoch_required/);
    await assert.rejects(h.call({op:'application',sql:"UPDATE data_file_exports SET checkpoint='{}'"}),/installation_epoch_required|installation.*maintenance|being updated/);
   }
   if(cursor.step==='copy'&&cursor.table===0&&cursor.after===null){
    await assert.rejects(h.call({op:'advance',lost:true}),/simulated_lost_acknowledgement/);
    const committed=await h.call({op:'journal'});assert.notEqual(committed.cursor,journal.cursor);
    await assert.rejects(h.call({op:'advance',stale:journal}),/CHECK constraint failed/);
    assert.deepEqual(await h.call({op:'journal'}),committed);
   }else{
    const page=await h.call({op:'advance'});maxUsed=Math.max(maxUsed,page.used);assert.ok(page.rows<=2);pages++;
   }
  }
  assert.deepEqual([...faulted].sort(),['copy','drain','restore','swap']);assert.ok(restarted&&driftChecked&&corruptionChecked);
  assert.ok(seen.has('verify_stage')&&seen.has('verify_final'));assert.ok(pages>40);assert.ok(maxUsed<=50);
  assert.deepEqual(await h.call({op:'snapshot'}),initial.initial);
  const results=await h.call({op:'raw',statements:[{sql:'PRAGMA foreign_key_check'},{sql:'PRAGMA foreign_key_list(data_file_entries)'},{sql:'PRAGMA foreign_key_list(data_file_parts)'},{sql:'PRAGMA foreign_key_list(data_file_import_segments)'},{sql:'SELECT scope_kind,team_season_id FROM data_file_exports UNION ALL SELECT scope_kind,team_season_id FROM data_file_imports'},{sql:"SELECT name FROM sqlite_master WHERE name LIKE 'installation_transfer_copy_%'"},{sql:'SELECT * FROM setup_state'}]});
  assert.deepEqual(results[0].results,[]);assert.equal(results[1].results[0].table,'data_file_exports');assert.equal(results[2].results[0].table,'data_file_exports');assert.equal(results[3].results[0].table,'data_file_imports');
  assert.ok(results[4].results.every(row=>row.scope_kind==='legacy_season'&&row.team_season_id==='season'));assert.deepEqual(results[5].results,[]);assert.equal(results[6].results[0].schema_fingerprint,'original');
  await assert.rejects(h.call({op:'raw',statements:[{sql:"UPDATE data_file_imports SET state='failed'"}]}),/installation_epoch_required/);
  const permitted=statements=>h.call({op:'raw',statements:[{sql:"UPDATE installation_upgrade SET writer_mode='upgrade',writer_epoch=epoch,permit_guard=0 WHERE id=1"},...statements,{sql:'UPDATE installation_upgrade SET writer_mode=NULL,writer_epoch=NULL,permit_guard=NULL WHERE id=1'}]});
  await assert.rejects(permitted([{sql:"UPDATE data_file_exports SET team_season_id=NULL WHERE id='export-0'"}]),/CHECK constraint failed/);
  await assert.rejects(permitted([{sql:"UPDATE data_file_imports SET scope_kind='connected_history' WHERE id='import-0'"}]),/CHECK constraint failed/);
  await permitted([{sql:"INSERT INTO data_file_imports(id,app_team_id,team_season_id,manifest,state,scope_kind,created_at,expires_at) VALUES('history-proof','team',NULL,'{}','validating','connected_history',1,2)"}]);
  await permitted([{sql:"DELETE FROM data_file_imports WHERE id='history-proof'"}]);
  assert.deepEqual(await h.call({op:'snapshot'}),initial.initial);assert.equal((await h.call({op:'journal'})).writer_mode,null);

  console.log(JSON.stringify({proof:'native-transfer-reconstruction',pages,maxUsed,retained:initial.initial.counts,hashes:initial.initial.hashes}));
 }finally{await h.dispose();}
});
