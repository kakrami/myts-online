import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {REPORT_SCHEMA} from '../src/reporting/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {ReportingService,REPORT_COLUMNS} from '../src/reporting/service.js';
import {CursorCodec} from '../src/read-model/cursor.js';
import {reportingRoutes} from '../src/reporting/routes.js';
import {reports as reportScreen} from '../web/ui-original/screens.js';
import {createOriginalReportsOracle,createReportDom,reportFixtureInput} from './parity/original-reports-fixtures.mjs';
const AT=Date.parse('2026-10-12T12:00:00Z'),INPUT={team_id:'team',team_season_id:'season'};
const out=new URL('../tmp/report-parity/',import.meta.url);
const visible=(row,type)=>Object.fromEntries(REPORT_COLUMNS[type].map(c=>[c.label,row[c.key]]));
function fixture(queryBuilders={}){
 const f=analysisFixture();for(const s of [...REPORT_SCHEMA,...SYNC_SCHEMA,...TEAM_FEATURE_SCHEMA])f.sqlite.exec(s);
 const old=f.db.prepare.bind(f.db);f.db.prepare=sql=>{const p=old(sql);p.run=p.all;const bind=p.bind.bind(p);p.bind=(...a)=>{const b=bind(...a);b.run=b.all;return b;};return p;};
 const cursor=new CursorCodec(new Uint8Array(32).fill(5),{now:()=>AT}),service=new ReportingService(f.db,{now:()=>AT,cursor,coordinator:{enqueue:async()=> 'job'},queryBuilders,fontLoader:()=>readFile(new URL('../web/assets/report-font.ttf',import.meta.url))});
 const apply=page=>{f.sqlite.exec('BEGIN');try{for(const s of page.statements)f.sqlite.prepare(s.sql.replaceAll('$FENCE','1')).run(...s.params.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));f.sqlite.exec('COMMIT');}catch(error){f.sqlite.exec('ROLLBACK');throw error;}};
 async function capture(type,options={}){const created=await service.create(INPUT,{type,...options});let snap=await service.snapshot(created.data.snapshot_id),pages=0;while(snap.state==='capturing'){apply(await service.capture(snap));snap=await service.snapshot(snap.id);assert.ok(++pages<100,'capture must make progress');}assert.equal(snap.state,'ready');return snap;}
 async function rows(snapshot,limit=37){let page=await service.preview(snapshot.id,{limit}),all=[];do{all.push(...page.data.rows.items);page=page.data.rows.next_cursor?await service.preview(snapshot.id,{limit,cursor:page.data.rows.next_cursor}):null;}while(page);return all;}
 async function file(snapshot,format){const status=await service.requestExport(snapshot.id,format);let pages=0;for(;;){const page=await service.encode(snapshot,status.id,format);apply(page);if(page.complete)break;assert.ok(++pages<100,'export must make progress');}const download=await service.download(status.id);return {data:new Uint8Array(await download.arrayBuffer()),headers:download.headers};}
 return {...f,service,apply,capture,rows,file};
}
function synthetic(f,type,rows){const columns=REPORT_COLUMNS[type];f.sqlite.exec(`CREATE TABLE synthetic_report(id TEXT,${columns.map(c=>c.key+' '+(c.numeric?'REAL':'TEXT')).join(',')})`);for(const [i,row]of rows.entries())f.insert('synthetic_report',{id:String(i),...Object.fromEntries(columns.map(c=>[c.key,row[c.label]??null]))});}
const query=()=>({sql:'SELECT * FROM synthetic_report ORDER BY rowid',params:[]});
function originalSorted(rows,index,direction='asc'){const dom=createReportDom(rows),o=createOriginalReportsOracle({},dom);o.enableSortableTables(dom.host);dom.headers[index].querySelector('button').onclick();if(direction==='desc')dom.headers[index].querySelector('button').onclick();return dom.orderedIndices().map(i=>rows[i]);}

test('all report column contracts match original with exact six default metrics',async()=>{
 const o=createOriginalReportsOracle(reportFixtureInput()),f=fixture();try{
  for(const type of Object.keys(REPORT_COLUMNS))assert.deepEqual(REPORT_COLUMNS[type].map(c=>c.label),Object.keys(o.reportRows(type)[0]));
  const snapshot=await f.capture('season'),rows=await f.rows(snapshot);
  assert.deepEqual(rows.map(r=>r.metric),o.reportRows('season').map(r=>r.Metric));assert.equal(rows.length,6);assert.equal(snapshot.sort_key,'');
 }finally{f.close();}
});

test('actual Schedule query renders original cancellation blanks and familiar labels',async()=>{
 const f=fixture();try{f.sqlite.exec("UPDATE team_event_rows SET status='CANCELLED'");const q=await f.service.query('matches',{...INPUT,mode:'season',period:'all',type:'all',search:'',include_june:false,timezone:'UTC',from:'2026-06-01',to:'2027-06-01'}),row=f.sqlite.prepare(q.sql).get(...q.params),original=createOriginalReportsOracle(reportFixtureInput()).reportRows('matches').find(r=>r.Status==='Cancelled');for(const key of ['Score','Result','Attendance'])assert.equal(row[key.toLowerCase()],original[key]);assert.equal(row.status,'Cancelled');assert.equal(row.type,'Game');assert.equal(row.source,'Trace');f.sqlite.exec("UPDATE source_events SET provider='live',scope='public',account_id=NULL");const live=f.sqlite.prepare(q.sql).get(...q.params);assert.equal(live.source,'GotSport');}finally{f.close();}
});

test('complete 137-row Schedule sorting, captured cursors and actual XLSX/PDF contents match the original',async()=>{
 const items=Array.from({length:137},(_,i)=>({id:String(i),kind:'event',date:'2026-07-01T12:00:00Z',event:{id:String(i),_type:'Practice',_location:'Field Q'+(136-i)+'Z'}})),o=createOriginalReportsOracle({items,seasonYear:2026}),source=o.reportRows('matches'),expected=originalSorted(source,4),f=fixture({matches:query});
 try{synthetic(f,'matches',source);const snapshot=await f.capture('matches',{sort:'location'}),rows=await f.rows(snapshot);assert.equal(rows.length,137);assert.deepEqual(rows.map(row=>visible(row,'matches')),expected);
  const a=await f.service.preview(snapshot.id,{limit:100}),b=await f.service.preview(snapshot.id,{limit:100,cursor:a.data.rows.next_cursor});assert.equal(a.data.rows.items.length,100);assert.equal(b.data.rows.items.length,37);assert.equal(b.data.rows.next_cursor,null);
  // Mutating the source after ready cannot change a preview or download.
  f.sqlite.exec("UPDATE synthetic_report SET location='Changed later'");assert.deepEqual((await f.rows(snapshot)).map(row=>visible(row,'matches')),expected);
  await mkdir(out,{recursive:true});const xlsx=await f.file(snapshot,'xlsx'),pdf=await f.file(snapshot,'pdf');await writeFile(new URL('schedule.xlsx',out),xlsx.data);await writeFile(new URL('schedule.pdf',out),pdf.data);assert.match(xlsx.headers.get('content-disposition'),/schedule_2026-27.xlsx/);assert.match(pdf.headers.get('content-disposition'),/schedule_2026-27.pdf/);
  const workbook=JSON.parse(execFileSync('python',['-c',`import json,openpyxl,sys\nw=openpyxl.load_workbook(sys.argv[1],data_only=True)\nprint(json.dumps({'sheets':w.sheetnames,'rows':list(w['Report'].values)}))`,new URL('schedule.xlsx',out).pathname],{encoding:'utf8'}));assert.deepEqual(workbook.sheets,['Report','Notes']);assert.deepEqual(workbook.rows[0],Object.keys(expected[0]));assert.deepEqual(workbook.rows.slice(1).map(row=>row.map(v=>v??'')),expected.map(Object.values));
  const text=execFileSync('pdftotext',['-layout',new URL('schedule.pdf',out).pathname,'-'],{encoding:'utf8'});const locations=[...text.matchAll(/Field Q\d+Z/g)].map(m=>m[0]);assert.deepEqual(locations,expected.map(row=>row.Location));assert.match(new TextDecoder().decode(pdf.data),/MediaBox \[0 0 842 595\]/);
 }finally{f.close();}
});

test('natural sort includes multiple digit runs, empty values last in either direction and stable ties',async()=>{
 const values=['Field Q10Z2','Field Q2Z10','Field Q2Z2','field q2z2',null,'','—','Field Q002Z2'];
 for(const direction of ['asc','desc']){const source=values.map(Location=>({Location})),expected=originalSorted(source,0,direction).map(row=>row.Location),f=fixture({matches:query});try{synthetic(f,'matches',source);const snapshot=await f.capture('matches',{sort:'location',direction}),rows=await f.rows(snapshot,2);assert.deepEqual(rows.map(r=>r.location),expected);}finally{f.close();}}
});

test('numeric decimal, signed, percentage, jersey and date orders follow the original visible sorter',async()=>{
 for(const [type,key,label,values]of [['players','minutes','Minutes',[45.12,45.3,-2,0,null,2]],['players','jersey','Jersey',['10','2','02','0',null]],['players','attendance','Attendance',['100%','9%','12%',null,'']],['matches','date','Date',['2026-12-01','2026-02-01','2025-12-31','']]])for(const direction of ['asc','desc']){
  const source=values.map(value=>({[label]:value})),expected=originalSorted(source,0,direction).map(row=>row[label]),f=fixture({[type]:query});try{synthetic(f,type,source);assert.deepEqual((await f.rows(await f.capture(type,{sort:key,direction}))).map(row=>row[key]),expected);}finally{f.close();}
 }
});

test('original display precision, unavailable cells and notes survive real workbook and portrait summary PDF',async()=>{
 const f=fixture({players:()=>({sql:"SELECT 'p' AS id,'Sample' AS player,'0' AS jersey,NULL AS position,1 AS apps,NULL AS starts,45.3 AS minutes,NULL AS goals,1 AS assists,NULL AS ga,NULL AS ga_per_60,NULL AS attendance,'Minutes estimated; goals unavailable.' AS _report_note",params:[],note:true})});
 try{const snapshot=await f.capture('players'),rows=await f.rows(snapshot),html=reportScreen({type:'players',columns:REPORT_COLUMNS.players,rows:{items:rows,total:1}});assert.match(html,/data-label="Minutes">45\.3<\/td>/);assert.match(html,/data-label="Goals">—<\/td>/);assert.match(html,/data-label="G\+A\/60"><\/td>/);assert.match(html,/Minutes estimated; goals unavailable/);
  const attendance=reportScreen({type:'availability',columns:REPORT_COLUMNS.availability,rows:{items:[{player:'A',yes_pct:33.3},{player:'B',yes_pct:null}],total:2}});assert.match(attendance,/data-label="Yes %">33%<\/td>/);assert.match(attendance,/data-label="Yes %"><\/td>/);
  await mkdir(out,{recursive:true});await writeFile(new URL('players.xlsx',out),(await f.file(snapshot,'xlsx')).data);const workbook=JSON.parse(execFileSync('python',['-c',`import json,openpyxl,sys\nw=openpyxl.load_workbook(sys.argv[1],data_only=True)\nprint(json.dumps({'report':list(w['Report'].values),'notes':list(w['Notes'].values)}))`,new URL('players.xlsx',out).pathname],{encoding:'utf8'}));assert.equal(workbook.report[1][5],'45.3');assert.equal(workbook.report[1][6],'—');assert.equal(workbook.report[1][9]??'','');assert.equal(workbook.notes[4][2],'Minutes estimated; goals unavailable.');
  const summary=await f.capture('season'),pdf=await f.file(summary,'pdf');await writeFile(new URL('summary.pdf',out),pdf.data);assert.match(new TextDecoder().decode(pdf.data),/MediaBox \[0 0 595 842\]/);const text=execFileSync('pdftotext',['-layout',new URL('summary.pdf',out).pathname,'-'],{encoding:'utf8'});for(const label of ['Record','Goals','Matches analyzed','Trace players','Minutes leader','G+A leader'])assert.ok(text.includes(label),label);
 }finally{f.close();}
});

test('report route checks team scope before exposing a viewer snapshot and its download',async()=>{
 const f=fixture();try{const snapshot=await f.capture('season'),file=await f.service.requestExport(snapshot.id,'xlsx');const security={requireOwnerSession:async()=>{throw Object.assign(new Error('No owner'),{status:401});},authorizeViewer:async(key,team,category)=>{assert.equal(category,'reports');assert.equal(key,'viewer');if(team!=='other')throw Object.assign(new Error('Wrong team'),{status:403});}};
 for(const path of [`/api/reports?snapshot_id=${snapshot.id}`,`/api/reports/exports/${file.id}`,`/api/reports/exports/${file.id}/download`])await assert.rejects(reportingRoutes(new Request('https://myts.test'+path,{headers:{'x-view-key':'viewer'}}),{security,reports:f.service}),error=>error.status===403);
 }finally{f.close();}
});

 test('1001 long-name rows remain complete across bounded capture and oversized values retain all rows with an explicit full-text fallback',async()=>{const source=Array.from({length:1001},(_,i)=>({Location:'Training facility '+('west '.repeat(90))+'Q'+(1000-i)+'Z'})),f=fixture({matches:query});try{synthetic(f,'matches',source);const started=performance.now(),snapshot=await f.capture('matches',{sort:'location'}),duration=performance.now()-started,rows=await f.rows(snapshot,100);assert.equal(rows.length,1001);assert.deepEqual(rows.map(r=>r.location),source.toReversed().map(r=>r.Location));assert.equal(snapshot.captured,1001);assert.ok(duration<15000,'SQLite capture exceeds measured15second envelope');console.log(JSON.stringify({reports_long_sort:{rows:1001,characters_per_name:source[0].Location.length,capture_pages:11,sqlite_duration_ms:Math.round(duration)}}));f.sqlite.prepare('UPDATE synthetic_report SET location=? WHERE id=?').run('x'.repeat(1025),'0');const fallback=await f.capture('matches',{sort:'location'});assert.equal(fallback.total,1001);assert.match((await f.service.preview(fallback.id)).data.scope_note,/Long or complex values use complete case-insensitive text ordering/);assert.equal((await f.rows(fallback,100)).find(row=>row._report_id==='0').location.length,1025);}finally{f.close();}});

test('alternating digit/text keys take the explicit whole-column fallback without dropping rows',async()=>{const source=Array.from({length:137},(_,i)=>({Location:'Q1'.repeat(40)+'End'+i})),f=fixture({matches:query});try{synthetic(f,'matches',source);const started=performance.now(),snapshot=await f.capture('matches',{sort:'location'}),rows=await f.rows(snapshot);assert.equal(rows.length,137);assert.match((await f.service.preview(snapshot.id)).data.scope_note,/complex values/);assert.deepEqual(rows.map(row=>row.location),source.map(r=>r.Location).sort());console.log(JSON.stringify({reports_complex_sort:{rows:137,characters_per_name:source[0].Location.length,sqlite_duration_ms:Math.round(performance.now()-started),whole_column_fallback:true}}));}finally{f.close();}});

import * as legacyEncoder from './fixtures/report-encoders-939cbc5.mjs';
import {BudgetDB} from '../src/sync/budget.js';
test('unversioned XLSX resumes an original 100-row checkpoint without overwriting or adding incompatible Notes',async()=>{
 const source=Array.from({length:137},(_,i)=>({Metric:'Record-'+String(i).padStart(3,'0'),Value:String(i)})),f=fixture({season:query});try{synthetic(f,'season',source);const snapshot=await f.capture('season'),rows=await f.rows(snapshot),start=legacyEncoder.xlsxStart(snapshot,REPORT_COLUMNS.season),first=legacyEncoder.xlsxPage(start.state,REPORT_COLUMNS.season,rows.slice(0,100)),status=await f.service.requestExport(snapshot.id,'xlsx'),prefix=legacyEncoder.concat([start.data,first.data]);
  f.insert('report_export_parts',{export_id:status.id,ordinal:0,bytes:prefix});f.sqlite.prepare("UPDATE report_exports SET state='building',checkpoint=?,part_count=1,byte_length=? WHERE id=?").run(JSON.stringify({...first.state,phase:'rows'}),prefix.length,status.id);
  const file=await f.file(snapshot,'xlsx');await mkdir(out,{recursive:true});await writeFile(new URL('legacy-resumed.xlsx',out),file.data);const result=JSON.parse(execFileSync('python',['-c',`import json,openpyxl,sys\nw=openpyxl.load_workbook(sys.argv[1],data_only=True)\nprint(json.dumps({'sheets':w.sheetnames,'rows':list(w.active.values)}))`,new URL('legacy-resumed.xlsx',out).pathname],{encoding:'utf8'}));assert.deepEqual(result.sheets,['myTS Report']);assert.deepEqual(result.rows.slice(4).map(row=>row.slice(0,2)),source.map(Object.values));assert.equal(result.rows.length,141);
 }finally{f.close();}
});

test('unversioned PDF resumes its old landscape pages and preserves every row/page index',async()=>{
 const source=Array.from({length:137},(_,i)=>({Metric:'Record-'+String(i).padStart(3,'0'),Value:String(i)})),f=fixture({season:query});try{synthetic(f,'season',source);const snapshot=await f.capture('season'),rows=await f.rows(snapshot),font=legacyEncoder.pdfFont(await readFile(new URL('../web/assets/report-font.ttf',import.meta.url))),start=legacyEncoder.pdfStart(font),first=legacyEncoder.pdfPage(start.state,snapshot,REPORT_COLUMNS.season,rows.slice(0,50),font),prefix=legacyEncoder.concat([start.data,first.data]),status=await f.service.requestExport(snapshot.id,'pdf');
  for(const [ordinal,bytes]of legacyEncoder.splitParts(prefix).entries())f.insert('report_export_parts',{export_id:status.id,ordinal,bytes});for(const o of [...start.objects,...first.objects])f.insert('report_pdf_objects',{export_id:status.id,object_id:o.id,byte_offset:o.offset});f.sqlite.prepare("UPDATE report_exports SET state='building',checkpoint=?,part_count=?,byte_length=? WHERE id=?").run(JSON.stringify(first.state),legacyEncoder.splitParts(prefix).length,prefix.length,status.id);
  const file=await f.file(snapshot,'pdf');await writeFile(new URL('legacy-resumed.pdf',out),file.data);const text=execFileSync('pdftotext',['-layout',new URL('legacy-resumed.pdf',out).pathname,'-'],{encoding:'utf8'});assert.deepEqual([...text.matchAll(/Record-\d{3}/g)].map(m=>m[0]),source.map(r=>r.Metric));const boxes=[...new TextDecoder().decode(file.data).matchAll(/MediaBox \[0 0 (\d+) (\d+)\]/g)];assert.ok(boxes.length>1);assert.ok(boxes.every(m=>m[1]==='842'&&m[2]==='595'));
 }finally{f.close();}
});

test('high-part report download stays inside the shared 48-statement budget and4MiB byte windows',async()=>{
 const f=fixture();try{const snapshot=await f.capture('season'),id=crypto.randomUUID(),parts=16384;f.insert('report_exports',{id,snapshot_id:snapshot.id,format:'xlsx',state:'ready',part_count:parts,byte_length:parts,created_at:AT});const insert=f.sqlite.prepare('INSERT INTO report_export_parts(export_id,ordinal,bytes) VALUES(?,?,?)');for(let i=0;i<parts;i++)insert.run(id,i,Uint8Array.of(i%251));const budget=new BudgetDB(f.db,48);budget.reserve(8);const service=new ReportingService(budget,{now:()=>AT}),response=await service.download(id);assert.equal((await response.arrayBuffer()).byteLength,parts);assert.ok(budget.used<=15);console.log(JSON.stringify({reports_part_download:{parts,statements_including_reserved:budget.used,maximum_batch_bytes:4194304,maximum_candidate_parts:8192}}));}finally{f.close();}
});

test('every production report capture satisfies the coordinator single-statement fence contract',async()=>{const f=fixture();f.service.captureAtAdmission=false;try{for(const type of Object.keys(REPORT_COLUMNS)){const created=await f.service.create(INPUT,{type,sort:REPORT_COLUMNS[type][0].key}),snapshot=await f.service.snapshot(created.data.snapshot_id),page=await f.service.capture(snapshot);for(const statement of page.statements){assert.match(statement.sql,/^\s*(INSERT|UPDATE|DELETE)\b/i);assert.ok(statement.sql.includes('$FENCE'));assert.ok(!statement.sql.includes(';'),type+' embeds a forbidden statement separator');}}}finally{f.close();}});

test('natural recursion has a hard64step bound and a stale pre-commit page fails closed',async()=>{const f=fixture({matches:query});f.service.captureAtAdmission=false;try{synthetic(f,'matches',Array.from({length:137},(_,i)=>({Location:'Field Q'+i+'Z'})));const created=await f.service.create(INPUT,{type:'matches',sort:'location'}),snapshot=await f.service.snapshot(created.data.snapshot_id),page=await f.service.capture(snapshot);f.sqlite.prepare('UPDATE synthetic_report SET location=?').run('Q1'.repeat(512));const replay=f.sqlite.prepare(snapshot.query_sql).all(...JSON.parse(snapshot.query_params));assert.equal(replay.length,137,'bounded recursion preserves all rows even under adversarial changed input');f.sqlite.exec('UPDATE team_read_state SET content_revision=content_revision+1');f.apply(page);assert.equal((await f.service.snapshot(snapshot.id)).state,'failed');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM report_rows WHERE snapshot_id=?').get(snapshot.id).n,0);}finally{f.close();}});

test('small export phase counts expose scheduler latency separately from local encoding work',async()=>{
 for(const [type,total] of [['season',6],['players',11]]){const f=fixture({[type]:query});try{synthetic(f,type,Array.from({length:total},(_,i)=>type==='season'?{Metric:'Metric '+i,Value:i}:{Player:'Player '+i,Minutes:45.3}));const snapshot=await f.capture(type);for(const format of ['xlsx','pdf']){const encode=f.service.encode.bind(f.service),phases=[];f.service.encode=async(...args)=>{const started=performance.now(),page=await encode(...args);phases.push({phase:page.checkpoint.phase,complete:page.complete,statements:page.statements.length,local_ms:Number((performance.now()-started).toFixed(2))});return page;};await f.file(snapshot,format);f.service.encode=encode;assert.equal(phases.length,format==='pdf'?4:5);console.log(JSON.stringify({small_report_encoding:{type,rows:total,format,phases}}));}}finally{f.close();}}
});

test('original defaults retain fixed summary and unsorted derived-roster Players/Attendance order',async()=>{
 const source=reportFixtureInput(),names=['Zulu','Alpha','Mike'];source.players=source.players.slice(0,3).map((p,i)=>({...p,name:names[i],first_name:names[i],last_name:''}));
 const original=createOriginalReportsOracle(source),f=fixture();try{for(const type of ['players','availability']){const order=original.reportRows(type).map(row=>row.Player);assert.deepEqual(order,names);const q=await f.service.query(type,{...INPUT,mode:'season',period:'all',type:'all',timezone:'UTC',include_june:false});assert.equal(q.orderBy,undefined,'the report does not add an alphabetical/statistical default');const snapshot=await f.capture(type);assert.equal(snapshot.sort_key,'');}assert.deepEqual((await f.rows(await f.capture('season'))).map(row=>row.metric),original.reportRows('season').map(row=>row.Metric));}finally{f.close();}
});

test('Schedule default is full parsed chronology, team-local date-only noon and stable ID over137immutable rows',async()=>{
 const f=fixture();try{
  f.sqlite.exec("UPDATE app_teams SET timezone='America/Los_Angeles'; DELETE FROM team_event_rows");
  const edge=[
   {id:'unknown-z',starts_at:null,local_day:null},{id:'unknown-a',starts_at:'invalid',local_day:null},
   {id:'fall-before',starts_at:'2026-11-01T19:59:59.999Z',local_day:'2026-11-01'},
   {id:'fall-noon',starts_at:null,local_day:'2026-11-01'},
   {id:'fall-after',starts_at:'2026-11-01T20:00:00.001Z',local_day:'2026-11-01'},
   {id:'summer-before',starts_at:'2026-07-01T18:59:59.999Z',local_day:'2026-07-01'},
   {id:'summer-noon',starts_at:null,local_day:'2026-07-01'},
   {id:'summer-after',starts_at:'2026-07-01T19:00:00.001Z',local_day:'2026-07-01'},
   {id:'spring-before',starts_at:'2027-03-14T18:59:59.999Z',local_day:'2027-03-14'},
   {id:'spring-noon',starts_at:null,local_day:'2027-03-14'},
   {id:'spring-after',starts_at:'2027-03-14T19:00:00.001Z',local_day:'2027-03-14'},
   {id:'equal-z',starts_at:'2026-08-01T11:00:00-07:00',local_day:'2026-08-01'},
   {id:'equal-a',starts_at:'2026-08-01T18:00:00Z',local_day:'2026-08-01'},
  ],input=[...edge,...Array.from({length:124},(_,i)=>({id:'extra-'+String(i).padStart(3,'0'),starts_at:new Date(Date.parse('2026-09-01T00:00:00Z')+(123-i)*3600000).toISOString(),local_day:'2026-09-01'}))];
  for(const [index,row]of input.entries()){f.insert('events',{id:row.id,created_at:new Date(AT).toISOString()});f.insert('team_event_rows',{run_id:'team-run',app_team_id:'team',team_season_id:'season',event_id:row.id,starts_at:row.starts_at,local_day:row.local_day,type:'practice',status:'SCHEDULED',conditional:0,own_side:'home',home_name:'Us',away_name:'Them',title:'Practice',venue:'Entry-'+String(index).padStart(3,'0'),source_ids:'["source-event"]',schedule_source_id:'source-event',result_source_id:'source-event'});}
  // Execute the original parseDate/comparator with the browser's zone set to
  // the selected team's zone. Report scope is now stable across other viewers.
  const expected=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`const rows=${JSON.stringify(input)};function parseDate(v){const raw=String(v??'').trim(),day=raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);const d=day?new Date(+day[1],+day[2]-1,+day[3],12):new Date(raw);return Number.isNaN(d.getTime())?null:d;}console.log(JSON.stringify(rows.sort((a,b)=>(parseDate(a.starts_at||a.local_day)?.getTime()||0)-(parseDate(b.starts_at||b.local_day)?.getTime()||0)||a.id.localeCompare(b.id)).map(r=>r.id)));`],{env:{...process.env,TZ:'America/Los_Angeles'},encoding:'utf8'}));
  const before=f.queries(),started=performance.now(),snapshot=await f.capture('matches'),queryMs=performance.now()-started,rows=await f.rows(snapshot);assert.equal(rows.length,137);assert.deepEqual(rows.map(r=>r._report_id),expected);assert.equal(snapshot.sort_key,'');const params=JSON.parse(snapshot.query_params),noons=JSON.parse(params[4]);assert.equal(noons.length,365);assert.ok(Buffer.byteLength(params[4])<=6000);assert.ok(Buffer.byteLength(snapshot.query_params)<8000);assert.ok(Buffer.byteLength(snapshot.query_sql)<48000);assert.ok(f.queries()-before<40,'no per-row SQL reads');
  for(const direction of ['asc','desc']){const tied=await f.capture('matches',{sort:'type',direction});assert.deepEqual((await f.rows(tied)).map(r=>r._report_id),expected,'equal explicit values preserve default chronological base');}
  const reverse=await f.capture('matches',{sort:'location',direction:'desc'}),descending=await f.rows(reverse);assert.deepEqual(descending.map(r=>r.location),input.map((_,i)=>'Entry-'+String(i).padStart(3,'0')).reverse());
  f.sqlite.exec("UPDATE team_event_rows SET starts_at='2030-01-01T00:00:00Z',local_day='2030-01-01',venue='Changed'; UPDATE app_teams SET timezone='UTC'");assert.deepEqual((await f.rows(snapshot)).map(r=>r._report_id),expected);
  await mkdir(out,{recursive:true});for(const current of [snapshot,reverse]){const expectedRows=await f.rows(current),stem=current===snapshot?'schedule-default':'schedule-reverse';for(const format of ['xlsx','pdf'])await writeFile(new URL(stem+'.'+format,out),(await f.file(current,format)).data);const workbook=JSON.parse(execFileSync('python',['-c',"import json,openpyxl,sys\nprint(json.dumps([r[4] for r in list(openpyxl.load_workbook(sys.argv[1],data_only=True)['Report'].values)[1:]]))",new URL(stem+'.xlsx',out).pathname],{encoding:'utf8'}));assert.deepEqual(workbook,expectedRows.map(r=>r.location));const pdf=execFileSync('pdftotext',['-layout',new URL(stem+'.pdf',out).pathname,'-'],{encoding:'utf8'});assert.deepEqual([...pdf.matchAll(/Entry-\d{3}/g)].map(m=>m[0]),expectedRows.map(r=>r.location));}
  console.log(JSON.stringify({report_default_order:{rows:137,calendar_days:noons.length,calendar_bytes:Buffer.byteLength(params[4]),query_parameter_bytes:Buffer.byteLength(snapshot.query_params),capture_local_ms:Math.round(queryMs)}}));
 }finally{f.close();}
});

import {localMidnight} from '../src/domain/calendar.js';
test('optional local hour leaves midnight callers unchanged and resolves noon across DST and missing midnight',()=>{
 assert.equal(localMidnight('2026-11-01','America/Los_Angeles'),'2026-11-01T07:00:00.000Z');assert.equal(localMidnight('2026-11-01','America/Los_Angeles',12),'2026-11-01T20:00:00.000Z');assert.equal(localMidnight('2027-03-14','America/Los_Angeles',12),'2027-03-14T19:00:00.000Z');assert.equal(localMidnight('2026-09-06','America/Santiago',12),'2026-09-06T15:00:00.000Z');for(const hour of [-1,24,1.5])assert.throws(()=>localMidnight('2026-11-01','UTC',hour),error=>error.code==='invalid_request');
});

test('report default calendar stays within366days/6000bytes and rejects a broader scope',async()=>{
 const f=fixture(),scope={...INPUT,mode:'season',period:'all',type:'all',timezone:'America/Santiago',from:'2027-06-01',to:'2028-06-01'};try{const started=performance.now(),q=await f.service.query('matches',scope);assert.equal(JSON.parse(q.params[4]).length,366);assert.ok(Buffer.byteLength(q.params[4])<=6000);assert.ok(Buffer.byteLength(JSON.stringify(q.params))<8000);console.log(JSON.stringify({report_calendar_build:{days:366,local_ms:Math.round(performance.now()-started),parameter_bytes:Buffer.byteLength(JSON.stringify(q.params))}}));await assert.rejects(f.service.query('matches',{...scope,to:'2029-06-01'}),error=>error.code==='report_scope_unavailable');}finally{f.close();}
});

import {DomainRepository} from '../src/domain/repository.js';
test('report timestamps inherit source-ingress millisecond canonicalization before SQLite ordering',async()=>{
 const f=fixture();try{const raw=['2026-09-01T12:00:00.1234Z','2026-09-01T05:00:00.1239-07:00'],domain=new DomainRepository(f.db),page=await domain.buildSourcePage({accountId:'account',generation:1,fixtures:raw.map((starts_at,i)=>({provider:'trace',native_id:'fraction-'+i,starts_at,type:'practice',status:'SCHEDULED',payload:'{}'}))}),saved=JSON.parse(page.statements.find(s=>s.sql.startsWith('INSERT INTO source_events(')).params[0]);assert.deepEqual(saved.map(r=>r.starts_at),raw.map(value=>new Date(value).toISOString()));assert.equal(saved[0].starts_at,saved[1].starts_at);assert.equal(saved[0].starts_at,'2026-09-01T12:00:00.123Z');const q=await f.service.query('matches',{...INPUT,mode:'season',period:'all',type:'all',timezone:'UTC',from:'2026-06-01',to:'2027-06-01'});for(const row of saved){f.sqlite.prepare('UPDATE team_event_rows SET starts_at=?').run(row.starts_at);assert.equal(f.sqlite.prepare(q.sql).get(...q.params)._report_order_date,Date.parse(raw[0]));}
 }finally{f.close();}
});

test('a skipped Apia day cannot fail a season and date-only noon uses the original forward-gap order',async()=>{
 const f=fixture();try{const original=JSON.parse(execFileSync(process.execPath,['-e',"console.log(JSON.stringify([new Date(2011,11,30,12).toISOString(),new Date(2011,11,31,12).toISOString()]))"],{env:{...process.env,TZ:'Pacific/Apia'},encoding:'utf8'}));assert.throws(()=>localMidnight('2011-12-30','Pacific/Apia',12),error=>error.calendar_gap_forward===original[0]);assert.equal(localMidnight('2011-12-31','Pacific/Apia',12),original[1]);assert.throws(()=>localMidnight('2011-12-30','Pacific/Apia'),error=>error.code==='invalid_request');f.sqlite.exec("UPDATE app_teams SET timezone='Pacific/Apia'; UPDATE team_seasons SET year=2011,start_day='2011-06-01',end_day='2012-06-01',start_at='2011-06-01T11:00:00.000Z',end_at='2012-05-31T11:00:00.000Z'; UPDATE team_event_rows SET starts_at='2011-12-29T22:00:00.000Z',local_day='2011-12-29'");f.insert('events',{id:'apia31',created_at:new Date(AT).toISOString()});f.sqlite.exec("INSERT INTO team_event_rows(run_id,app_team_id,team_season_id,event_id,starts_at,local_day,type,status,conditional,own_side,home_name,away_name,title,venue,source_ids,schedule_source_id,result_source_id) SELECT run_id,app_team_id,team_season_id,'apia31','2011-12-30T22:00:00.000Z','2011-12-31',type,status,conditional,own_side,home_name,away_name,title,venue,source_ids,schedule_source_id,result_source_id FROM team_event_rows");const ordinary=await f.capture('matches');assert.deepEqual((await f.rows(ordinary)).map(r=>r.date),['2011-12-29','2011-12-31']);assert.equal(ordinary.state,'ready','an unused nonexistent day must not fail the map');f.sqlite.exec("UPDATE team_event_rows SET starts_at=NULL,local_day='2011-12-30' WHERE event_id='event'");const skipped=await f.capture('matches');assert.equal(skipped.state,'ready');assert.deepEqual((await f.rows(skipped)).map(r=>r._report_id),['apia31','event'],'skipped-day noon and following-day noon tie by ID');const query=await f.service.query('matches',{...INPUT,mode:'season',period:'all',type:'all',timezone:'Pacific/Apia',from:'2011-06-01',to:'2012-06-01'});assert.equal(f.sqlite.prepare(query.sql).get(...query.params)._report_order_date,Date.parse(original[0]));assert.equal(JSON.parse(query.params[4]).length,366);
 }finally{f.close();}
});
