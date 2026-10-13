import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {REPORT_SCHEMA} from '../src/reporting/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {ReportingService} from '../src/reporting/service.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {createSyncRuntime} from '../src/sync/runtime.js';
import {BudgetDB} from '../src/sync/budget.js';
import {CursorCodec} from '../src/read-model/cursor.js';
const AT=Date.parse('2026-10-13T04:00:00Z'),SCOPE={team_id:'team',team_season_id:'season'};

function fixture({rows=137,value=i=>'Field Q'+i+'Z',captureAtAdmission=true}={}){
 const f=analysisFixture();for(const sql of [...REPORT_SCHEMA,...SYNC_SCHEMA,...TEAM_FEATURE_SCHEMA])f.sqlite.exec(sql);
 const original=f.db.prepare.bind(f.db);f.db.prepare=sql=>{const p=original(sql);p.run=p.all;const bind=p.bind.bind(p);p.bind=(...a)=>{const s=bind(...a.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v));s.run=s.all;return s;};return p;};
 f.sqlite.exec('CREATE TABLE report_fixture(id TEXT,location TEXT)');for(let i=0;i<rows;i++)f.insert('report_fixture',{id:String(i).padStart(4,'0'),location:value(i)});
 const queryBuilders={matches:()=>({sql:"SELECT id,'2026-09-01' AS date,'Practice' AS type,'Past event' AS status,'' AS opponent,location,'Trace' AS source,'' AS competition,'' AS score,'' AS result,NULL AS attendance FROM report_fixture ORDER BY id",params:[]})};
 const jobs=new JobCoordinator(f.db,{clock:()=>AT,pageDelayMs:0,retryBaseMs:1}),cursor=new CursorCodec(new Uint8Array(32).fill(5),{now:()=>AT});
 const reports=new ReportingService(f.db,{coordinator:jobs,cursor,now:()=>AT,queryBuilders,captureAtAdmission,fontLoader:()=>readFile(new URL('../web/assets/report-font.ttf',import.meta.url))});
 const create=async(type='matches')=>reports.snapshot((await reports.create(SCOPE,{type})).data.snapshot_id);
 const storage=new Map(),ctx={storage:{async get(key){return storage.get(key);},async put(key,value){storage.set(key,value);},async getAlarm(){return storage.get('alarm')??null;},async setAlarm(at){storage.set('alarm',at);},async deleteAlarm(){storage.delete('alarm');}}};
 let ordinaryPages=0;const seen=[];
 const collect=async context=>{seen.push(context.lease.provider+':'+context.lease.component);if(context.lease.provider==='reports'&&['capture','xlsx','pdf'].includes(context.lease.component))return new ReportingService(context.db,{cursor,now:()=>AT,fontLoader:reports.fontLoader}).collect(context);ordinaryPages++;return {statements:[],checkpoint:{pages:ordinaryPages},complete:ordinaryPages>=1000,coverage:'partial'};};
 const Runtime=createSyncRuntime(collect,{reportFairness:true,clock:()=>AT,pageDelayMs:0});
 const runtime=()=>new Runtime(ctx,{DB:f.db});
 const enqueue=async(provider='trace',component='game',priority=100)=>jobs.enqueue({provider,component,stage:provider==='reports'?'export':'source',scope:'backlog',resourceKey:component,args:{},priority,recurring:false,...provider==='trace'?{accountId:'account',accountGeneration:1}:{}},[{kind:'team',teamId:'team',key:'backlog/'+component}]);
 return {...f,reports,jobs,create,storage,ctx,runtime,seen,enqueue,ordinaryPages:()=>ordinaryPages};
}

for(const rows of [0,6,137,250])test(`default admission atomically captures all ${rows} rows before background service`,async()=>{
 const f=fixture({rows});try{const snapshot=await f.create();assert.equal(snapshot.state,'ready');assert.equal(snapshot.captured,rows);assert.equal(f.all('SELECT * FROM report_rows').length,rows);assert.equal(f.all('SELECT * FROM sync_jobs').length,0);assert.deepEqual((await f.reports.capture(snapshot)).statements,[]);}finally{f.close();}
});

test('default 251-row boundary retains the old bounded, fail-closed paged path',async()=>{
 const f=fixture({rows:251});try{const snapshot=await f.create();assert.equal(snapshot.state,'capturing');assert.equal(snapshot.captured,0);const first=await f.reports.capture(snapshot);f.commit(first);const partial=await f.reports.snapshot(snapshot.id);assert.equal(partial.captured,100);f.sqlite.exec('UPDATE source_serialization_clock SET revision=revision+1');f.commit(await f.reports.capture(partial));assert.equal((await f.reports.snapshot(snapshot.id)).error_code,'report_changed');assert.equal(f.all('SELECT * FROM report_rows').length,100);}finally{f.close();}
});

test('UTF-8 bulk bytes bound admission even when row and character counts fit',async()=>{
 const f=fixture({rows:137,value:()=> '界'.repeat(1300)});try{const snapshot=await f.create();assert.equal(snapshot.state,'capturing');assert.equal(snapshot.captured,0);const row=f.sqlite.prepare(snapshot.query_sql).get(...JSON.parse(snapshot.query_params));assert.ok(Buffer.byteLength(row.row_json)<16000);assert.ok(Buffer.byteLength(row.row_json)*137>512*1024);f.commit(await f.reports.capture(snapshot));assert.equal((await f.reports.snapshot(snapshot.id)).captured,100);}finally{f.close();}
});

test('largest legal row is captured, a larger row uses the existing schema-fenced fallback',async()=>{
 for(const extra of [0,1]){const f=fixture({rows:1});try{const q=await f.reports.query('matches',SCOPE);const {orderedReportQuery}=await import('../src/reporting/order.js'),{REPORT_COLUMNS}=await import('../src/reporting/service.js');const sql=orderedReportQuery(q,REPORT_COLUMNS.matches,{}),base=Buffer.byteLength(f.sqlite.prepare(sql).get().row_json)-'Field Q0Z'.length;f.sqlite.prepare('UPDATE report_fixture SET location=?').run('x'.repeat(16000-base+extra));const snapshot=await f.create();assert.equal(snapshot.state,extra?'capturing':'ready');if(!extra)assert.equal(Buffer.byteLength(f.all('SELECT row_json FROM report_rows')[0].row_json),16000);}finally{f.close();}}
});

for(const mutation of ['source','analysis','owner','lifecycle'])test(`a ${mutation} change between preflight and admission writes no snapshot or rows`,async()=>{
 const f=fixture();try{const batch=f.db.batch.bind(f.db);let raced=false;f.db.batch=async statements=>{if(!raced&&statements[0]?.sql.startsWith('INSERT INTO report_snapshots')){raced=true;if(mutation==='source')f.sqlite.exec('UPDATE source_serialization_clock SET revision=revision+1');else if(mutation==='lifecycle')f.sqlite.exec("INSERT INTO team_lifecycle(team_id,state,requested_at) VALUES('team','deleting','now')");else f.sqlite.exec('UPDATE team_read_state SET content_revision=content_revision+1');}return batch(statements);};await assert.rejects(f.create(),error=>error.code==='report_changed');assert.equal(raced,true);assert.equal(f.all('SELECT * FROM report_snapshots').length,0);assert.equal(f.all('SELECT * FROM report_rows').length,0);}finally{f.close();}
});

test('lost admission response retains one complete immutable snapshot',async()=>{
 const f=fixture();try{const batch=f.db.batch.bind(f.db);let lost=false;f.db.batch=async statements=>{const result=await batch(statements);if(!lost&&statements[0]?.sql.startsWith('INSERT INTO report_snapshots')){lost=true;throw new Error('lost reply');}return result;};await assert.rejects(f.create(),/lost reply/);const snapshot=f.all('SELECT * FROM report_snapshots')[0];assert.equal(snapshot.state,'ready');assert.equal(snapshot.captured,137);f.sqlite.exec("UPDATE report_fixture SET location='Later'; UPDATE source_serialization_clock SET revision=revision+1; UPDATE team_read_state SET content_revision=content_revision+1");assert.deepEqual((await f.reports.capture(snapshot)).statements,[]);assert.equal((await f.reports.preview(snapshot.id)).data.rows.items[0].location,'Field Q0Z');}finally{f.close();}
});

test('bounded admission leaves room for installation and owner HTTP checks within 48 statements',async()=>{
 const f=fixture({rows:250,value:i=>'界'.repeat(500)+i});try{const budget=new BudgetDB(f.db,48);budget.reserve(16);const reports=new ReportingService(budget,{coordinator:f.jobs,cursor:f.reports.cursor,now:()=>AT,queryBuilders:f.reports.queryBuilders});const result=await reports.create(SCOPE,{type:'matches',sort:'location'});assert.equal(result.data.state,'ready');assert.ok(budget.used<=32);console.log(JSON.stringify({report_admission_reserved_budget:{rows:250,used:budget.used,reserved:16}}));}finally{f.close();}
});

test('persisted fair turns finish a 137-row report and parsed XLSX/PDF before a sustained import drains',async()=>{
 const f=fixture();try{
  const snapshot=await f.create();await f.enqueue();const files=[];for(const format of ['xlsx','pdf'])files.push(await f.reports.requestExport(snapshot.id,format));
  // Restart the runtime on every turn, at one fixed claim clock. Real unrelated
  // source writes continue between turns; ready data and exports stay immutable.
  for(let i=0;i<70;i++){f.sqlite.exec('UPDATE source_serialization_clock SET revision=revision+1');await f.runtime().run();const last=f.storage.get('last_run');assert.ok(!['error','failed','blocked','retrying'].includes(last.state),JSON.stringify(last));if(f.all('SELECT state FROM report_exports').every(row=>row.state==='ready'))break;}
  assert.ok(f.ordinaryPages()>0&&f.ordinaryPages()<1000);assert.equal(f.all("SELECT * FROM report_exports WHERE state='ready'").length,2);
  for(let i=1;i<f.seen.length;i++)assert.notEqual(f.seen[i].startsWith('reports:'),f.seen[i-1].startsWith('reports:'),'both runnable classes alternate despite fixed-clock ties');
  const out=new URL('../tmp/report-service-latency/',import.meta.url);await mkdir(out,{recursive:true});for(const file of files){const bytes=new Uint8Array(await (await f.reports.download(file.id)).arrayBuffer());await writeFile(new URL('schedule.'+file.format,out),bytes);}
  const xlsx=JSON.parse(execFileSync('python',['-c',"import json,openpyxl,sys\nw=openpyxl.load_workbook(sys.argv[1],data_only=True)\nprint(json.dumps([r[4] for r in list(w['Report'].values)[1:]]))",new URL('schedule.xlsx',out).pathname],{encoding:'utf8'}));const pdf=execFileSync('pdftotext',['-layout',new URL('schedule.pdf',out).pathname,'-'],{encoding:'utf8'}),expected=Array.from({length:137},(_,i)=>'Field Q'+i+'Z');assert.deepEqual(xlsx,expected);assert.deepEqual([...pdf.matchAll(/Field Q\d+Z/g)].map(m=>m[0]),expected);const beforeDrain=f.ordinaryPages();for(let i=0;i<4;i++)await f.runtime().run();assert.equal(f.ordinaryPages(),beforeDrain+4,'ordinary work continues after foreground files finish');console.log(JSON.stringify({report_busy_service:{turns:f.seen.length,ordinary_pages:f.ordinaryPages(),rows:137,parsed_files:2}}));
 }finally{f.close();}
});

test('fair class admits only valid snapshot/export demand and leaves Data files ordinary',async()=>{
 const f=fixture();try{await f.enqueue('reports','data-export',100);const snapshot=await f.create(),file=await f.reports.requestExport(snapshot.id,'xlsx');let jobs=new JobCoordinator(f.db,{clock:()=>AT,reportTurn:true});let lease=await jobs.claim();assert.equal(lease.component,'xlsx');await jobs.commit(lease,await f.reports.collect({lease,args:lease.args}));f.sqlite.prepare('UPDATE report_snapshots SET expires_at=? WHERE id=?').run(AT,snapshot.id);lease=await jobs.claim();assert.equal(lease.component,'data-export');await jobs.commit(lease,{statements:[],complete:true});f.sqlite.prepare('UPDATE report_snapshots SET expires_at=? WHERE id=?').run(AT+100000,snapshot.id);f.sqlite.prepare("DELETE FROM sync_job_subscribers WHERE demand_key=?").run('report/'+snapshot.id);assert.equal(await jobs.claim(),null);assert.equal((await f.reports.exportStatus(file.id)).state,'building');}finally{f.close();}
});

test('a lost durable-turn write reply and restart do not strand work or its recovery alarm',async()=>{
 const f=fixture();try{const snapshot=await f.create();await f.enqueue();await f.reports.requestExport(snapshot.id,'xlsx');const put=f.ctx.storage.put;let lost=false;f.ctx.storage.put=async(key,value)=>{await put(key,value);if(key==='report_service_turn'&&!lost){lost=true;throw new Error('lost storage reply');}};await f.runtime().run();assert.equal(f.storage.get('last_run').state,'error');assert.ok(f.storage.get('alarm'));assert.equal(f.seen.length,0);await f.runtime().run();await f.runtime().run();assert.equal(f.seen.length,2);assert.ok(f.seen.some(x=>x.startsWith('trace:')));assert.ok(f.seen.some(x=>x.startsWith('reports:')));}finally{f.close();}
});

test('recovery-only invocations do not consume service turns; a wake remains armed',async()=>{
 const f=fixture();try{f.storage.set('connection_recovery_pending',true);const Runtime=createSyncRuntime(async()=>assert.fail('recovery must yield'),{reportFairness:true,recoverConnections:async()=>({more:false})});const runtime=new Runtime(f.ctx,{DB:f.db});await runtime.run();assert.equal(f.storage.has('report_service_turn'),false);assert.equal(f.storage.get('last_run').state,'recovering_connections');await runtime.wake();assert.equal(f.storage.get('connection_recovery_pending'),true);assert.ok(f.storage.get('alarm'));}finally{f.close();}
});

test('no-report and report-only queues never idle to wait for the absent class',async()=>{
 const ordinary=fixture();try{await ordinary.enqueue('trace','analytics',20);for(let i=0;i<8;i++)await ordinary.runtime().run();assert.equal(ordinary.ordinaryPages(),8);}finally{ordinary.close();}
 const reports=fixture({rows:251});try{const snapshot=await reports.create();for(let i=0;i<3;i++)await reports.runtime().run();assert.equal((await reports.reports.snapshot(snapshot.id)).state,'ready');assert.equal(reports.seen.length,3);assert.ok(reports.seen.every(value=>value==='reports:capture'));}finally{reports.close();}
});

test('persisted turns survive completed-job pruning without shifting the next class',async()=>{
 const f=fixture();try{const snapshot=await f.create();await f.enqueue();await f.reports.requestExport(snapshot.id,'xlsx');for(let i=0;i<10;i++){await f.runtime().run();const turn=f.storage.get('report_service_turn');f.sqlite.exec("DELETE FROM sync_jobs WHERE state='ready' AND recurring=0");assert.equal(f.storage.get('report_service_turn'),turn);}for(let i=1;i<f.seen.length;i++)assert.notEqual(f.seen[i].startsWith('reports:'),f.seen[i-1].startsWith('reports:'));}finally{f.close();}
});

test('report retry backoff yields to ordinary work and a due retry keeps its saved progress',async()=>{
 const f=fixture();try{const snapshot=await f.create();await f.enqueue();const file=await f.reports.requestExport(snapshot.id,'xlsx');const jobs=new JobCoordinator(f.db,{clock:()=>AT,reportTurn:true});const lease=await jobs.claim();assert.equal(lease.component,'xlsx');await jobs.fail(lease,Object.assign(new Error('temporary transport'),{code:'rate_limited',failureKind:'temporary',retryAfterMs:1000}));await f.runtime().run();assert.equal(f.seen[0],'trace:game');f.sqlite.prepare("UPDATE sync_jobs SET next_at=? WHERE id=?").run(AT,lease.id);for(let i=0;i<3;i++)await f.runtime().run();assert.equal((await f.reports.exportStatus(file.id)).state,'building');assert.ok(f.all('SELECT * FROM report_export_parts').length>0);}finally{f.close();}
});

test('concurrent alarm calls share one durable turn and a concurrent wake keeps the next alarm',async()=>{
 const f=fixture();try{const snapshot=await f.create();await f.reports.requestExport(snapshot.id,'xlsx');let runtime,calls=0;const Runtime=createSyncRuntime(async context=>{calls++;await runtime.wake();return new ReportingService(context.db,{now:()=>AT,fontLoader:f.reports.fontLoader}).collect(context);},{reportFairness:true,clock:()=>AT,pageDelayMs:0});runtime=new Runtime(f.ctx,{DB:f.db});await Promise.all([runtime.alarm(),runtime.alarm()]);assert.equal(calls,1);assert.equal(f.storage.get('report_service_turn'),false);assert.equal(f.storage.get('wake_sequence'),1);assert.ok(f.storage.get('alarm'));}finally{f.close();}
});


test('low-priority derived work remains live after the high-priority queue drains',async()=>{
 const f=fixture();try{const high=await f.enqueue('trace','game',100),low=await f.enqueue('trace','analytics',20);const lease=await f.jobs.claim();assert.equal(lease.id,high);await f.jobs.commit(lease,{statements:[],complete:true,coverage:'complete'});for(let i=0;i<4;i++)await f.runtime().run();assert.equal(f.ordinaryPages(),4);assert.ok(f.seen.every(value=>value==='trace:analytics'));assert.equal(f.sqlite.prepare('SELECT state FROM sync_jobs WHERE id=?').get(high).state,'ready');assert.equal(f.sqlite.prepare('SELECT state FROM sync_jobs WHERE id=?').get(low).state,'queued');assert.ok(f.storage.get('alarm'));}finally{f.close();}
});
