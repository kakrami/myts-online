import test from 'node:test';
import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {publishedAnalysisFixture} from './fixtures/published-analysis-fixture.mjs';
import {priorSourceCollectionProof,priorPlayerSeasonQuery} from './fixtures/consumer-authority-before-shape.mjs';
import {analysisSourceCollectionProof} from '../src/analysis/source-collection-proof.js';
import {AnalysisReads,playerSeasonQuery} from '../src/analysis/reads.js';
import {NativeTrackService} from '../src/analysis/tracks.js';
import {ReadRepository} from '../src/read-model/repository.js';
import {ReportingService,REPORT_COLUMNS} from '../src/reporting/service.js';
import {orderedReportQuery} from '../src/reporting/order.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {REPORT_SCHEMA} from '../src/reporting/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
const INPUT={team_id:'team',team_season_id:'season',timezone:'UTC',mode:'season',period:'all',type:'all',search:'',include_june:false},NOW=Date.parse('2026-10-13T00:00:00Z');
async function fixture(normalized){const f=normalized?publishedAnalysisFixture({target:'public-event'}):analysisFixture();for(const sql of [...TEAM_FEATURE_SCHEMA,...REPORT_SCHEMA,...SYNC_SCHEMA])f.sqlite.exec(sql);f.commit(await f.page());return f;}
for(const normalized of [false,true])test('SQL factoring preserves prior native authority and player selection matrix, version '+Number(normalized),async()=>{
 const f=await fixture(normalized);try{const tracks=new NativeTrackService(f.db,{owner:true}),context=await tracks.context(INPUT,normalized?'public-event':'event'),member=f.all("SELECT * FROM source_game_members WHERE gid='g1'")[0],children=await tracks.sourceChildren({...context,member}),child=children[0],args={args:child.args,accountId:child.accountId,accountGeneration:child.accountGeneration,teamId:'team',seasonId:'season'},old=priorSourceCollectionProof(child.args.analysis_source_proof,args),next=analysisSourceCollectionProof(child.args.analysis_source_proof,args),allowed=q=>f.sqlite.prepare('SELECT '+q.sql+' AS ok').get(...q.params).ok;
  const mutations=[null,"UPDATE source_events SET native_id='wrong' WHERE id='source-event'","UPDATE source_events SET provenance='file_import' WHERE id='source-event'","UPDATE source_events SET content_hash='changed' WHERE id='source-event'","UPDATE source_event_state SET input_revision=input_revision+1 WHERE source_event_id='source-event'","UPDATE source_game_members SET content_hash='changed' WHERE gid='g1'","UPDATE source_game_members SET side='away' WHERE gid='g1'","UPDATE source_trace_components SET provenance='file_import' WHERE kind='clip'","UPDATE provider_accounts SET active=0 WHERE id='account'","UPDATE provider_accounts SET generation=2 WHERE id='account'","UPDATE team_source_attachments SET active=0 WHERE id='attachment'","UPDATE team_source_connections SET generation=2 WHERE id='root'","UPDATE team_connection_seasons SET excluded=1 WHERE connection_id='root'","UPDATE team_event_season_resolutions SET team_season_id=NULL,state='pending'",...(normalized?["UPDATE team_source_connections SET active=0 WHERE id='public-root'","UPDATE team_projection_state SET published_run_id='team-run'","INSERT INTO team_game_decision_revisions(app_team_id,association_id,revision,authority,decision,team_season_id,effective_day,starts_at,algorithm_version,source_snapshot_revision,connection_snapshot_hash,owner_state_hash,semantic_hash,proof_hash,proof,created_at,request_id,request_hash,predecessor_revision) SELECT app_team_id,association_id,2,'owner','rejected',team_season_id,effective_day,starts_at,algorithm_version,source_snapshot_revision,connection_snapshot_hash,owner_state_hash,semantic_hash,proof_hash,proof,created_at,'reject',proof_hash,1 FROM team_game_decision_revisions WHERE revision=1;UPDATE team_game_associations SET head_revision=2,owner_revision=2"]:[])];
  for(const mutation of mutations){f.sqlite.exec('SAVEPOINT parity');if(mutation)f.sqlite.exec(mutation);assert.equal(allowed(next),allowed(old),mutation??'unchanged');for(const input of [INPUT,{...INPUT,type:'analyzed'},{...INPUT,period:'upcoming'},{...INPUT,mode:'day',date:'2026-09-01'},{...INPUT,search:'missing'}]){const before=priorPlayerSeasonQuery(input,{now:NOW}),after=playerSeasonQuery(input,{now:NOW});assert.deepEqual(f.sqlite.prepare(after.sql).all(...after.params),f.sqlite.prepare(before.sql).all(...before.params),JSON.stringify({mutation,input}));}f.sqlite.exec('ROLLBACK TO parity;RELEASE parity');}
 }finally{f.close();}
});
for(const normalized of [false,true])test('actual player/detail/report/source statements compile under native D1 limits, version '+Number(normalized),async t=>{
 const f=await fixture(normalized),queries=[];t.after(()=>f.close());const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{const wrap=statement=>({...statement,bind(...params){return wrap(statement.bind(...params));},async all(){queries.push({sql,params:this.params});return statement.all();},async first(){queries.push({sql,params:this.params});return statement.first();}});return wrap(prepare(sql));};
 const reads=new AnalysisReads(f.db,{owner:true},{now:()=>NOW});assert.equal((await reads.summary(INPUT,'player-001')).data.minutes,50);assert.equal((await reads.player(INPUT,'player-001')).data.matches.total,1);assert.equal((await reads.players(INPUT)).data.total,7);
 const reports=new ReportingService(f.db,{now:()=>NOW}),{selection}=await new ReadRepository(f.db,{owner:true},{now:()=>NOW}).context(INPUT);for(const type of ['season','players','availability','matches']){const q=await reports.query(type,selection),ordered=orderedReportQuery(q,REPORT_COLUMNS[type],{key:null,direction:'asc'});assert.ok(Buffer.byteLength(ordered)<=48000,type+' ordered snapshot SQL exceeds schema bound');queries.push({sql:'SELECT ordinal,row_json FROM('+ordered+') LIMIT ?',params:[...q.params,101]});const report=await reports.create(INPUT,{type});assert.equal(report.data.state,'ready');}
 const tracks=new NativeTrackService(f.db,{owner:true}),context=await tracks.context(INPUT,normalized?'public-event':'event'),member=f.all("SELECT * FROM source_game_members WHERE gid='g1'")[0];for(const child of await tracks.sourceChildren({...context,member})){const proof=analysisSourceCollectionProof(child.args.analysis_source_proof,{args:child.args,accountId:child.accountId,accountGeneration:child.accountGeneration,teamId:'team',seasonId:'season'});queries.push({sql:'SELECT CASE WHEN '+proof.sql+' THEN 1 ELSE 0 END AS ok',params:proof.params});}
 const directory=await mkdtemp(path.join(tmpdir(),'myts-consumer-depth-'));t.after(()=>rm(directory,{recursive:true,force:true}));const db=path.join(directory,'fixture.db'),file=path.join(directory,'queries.json');await backup(f.sqlite,db);await writeFile(file,JSON.stringify(queries));const result=spawnSync('python3',['-c',`
import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1],cached_statements=0)
for name,value in [('SQLITE_LIMIT_EXPR_DEPTH',100),('SQLITE_LIMIT_COMPOUND_SELECT',5),('SQLITE_LIMIT_VARIABLE_NUMBER',100),('SQLITE_LIMIT_SQL_LENGTH',100000)]:c.setlimit(getattr(sqlite3,name),value)
queries=json.load(open(sys.argv[2]));seen=set()
for i,q in enumerate(queries):
 if q['sql'] in seen:continue
 seen.add(q['sql'])
 try:c.execute('EXPLAIN '+q['sql'],q['params']).fetchall()
 except Exception as error:raise RuntimeError('Query '+str(i)+': '+str(error)+'; SQL '+q['sql'][:180]) from error
print(json.dumps({'queries':len(queries),'unique':len(seen),'maxSqlBytes':max(len(q['sql'].encode()) for q in queries),'maxParams':max(len(q['params']) for q in queries)}))
`,db,file],{encoding:'utf8',maxBuffer:1_000_000});assert.equal(result.status,0,result.stderr);t.diagnostic(result.stdout.trim());
});
