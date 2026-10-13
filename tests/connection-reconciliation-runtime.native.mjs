import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {freshHarness,TEST_PASSWORD} from './fresh-harness.js';

// One native runner, real production delays, no collector replacement, no
// direct reconciled markers, and no production mutation. Fixture source rows
// and a completed source receipt are synthetic; every reconciliation and
// publication thereafter uses the exported worker runtime and actual collector.
const root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||'.');
const baseline=path.resolve(process.env.MYTS_RECONCILIATION_BASELINE_ROOT||'../myts-projection-expiry-release');
const load=p=>import(pathToFileURL(path.join(root,p)).href);
const [{SyncRuntime},{ApplicationSyncService},{JobCoordinator},{SCHEMA},{beginTeamSnapRefresh,finishTeamSnapRefresh},{resolvePublishedGame,captureGameOwnerState}]=await Promise.all([
  load('worker.js'),load('src/application/sync-service.js'),load('src/sync/coordinator.js'),load('src/application/installation-schema.js'),load('src/sources/teamsnap-refresh.js'),load('src/domain/team-game-scope.js'),
]);
const AT='2026-10-12T00:00:00.000Z',ROOT='teamsnap/account/team';
const bytes=v=>Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v));
const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const sum=(a,k)=>a.reduce((n,r)=>n+(r[k]??0),0),max=(a,k)=>Math.max(0,...a.map(r=>r[k]??0));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sourceTables=['account_source_teams','source_teams','source_events','source_players','source_event_teams','source_attendance','source_game_members','source_roster_memberships','event_source_links','event_aliases'];
const semanticTables=['team_event_season_resolutions','connection_event_resolutions','connection_roster_evidence','team_connection_seasons','team_source_attachments'];
const ownerTables=['domain_overrides','game_bookmarks','coach_sessions','coach_timeline'];
async function rawMap(dir){const files=['worker.js','package.json','release-manifest.json','wrangler.jsonc'];for(const sub of ['src','web'])for(const f of await readdir(path.join(dir,sub),{recursive:true,withFileTypes:true}))if(f.isFile())files.push(path.relative(dir,path.join(f.parentPath,f.name)));files.sort();return Object.fromEntries(await Promise.all(files.map(async p=>[p,hash(await readFile(path.join(dir,p)))])));}

test('exported native runtime reconciles only changed semantics and republishes normal behind-cursor catch-up under 50 SQL',{timeout:300000},async()=>{
  const before=await rawMap(root),baseBefore=await rawMap(baseline),queries=[],batches=[],alarms=[],wakes=[],diagnostics=[],contexts=[],results={};
  assert.ok(Object.keys(before).some(p=>/\.woff2?$|\.ttf$|\.otf$/.test(p)),'raw-byte map includes binary font');
  let sequence=0,stage='setup',started=Date.now();
  function traced(raw,ctx){
    const record=(sql,params,result,error)=>queries.push({context:ctx.name,invocation:ctx.current,sql,params,sql_bytes:bytes(sql),parameter_bytes:bytes(params),result_bytes:result?bytes(result.results??[]):null,rows_read:result?.meta?.rows_read??null,rows_written:result?.meta?.rows_written??null,...(error?{error:String(error)}:{})});
    const statement=(s,sql,params=[])=>({_raw:s,sql,params,bind(...p){return statement(s.bind(...p),sql,p);},async all(){try{const r=await s.all();record(sql,params,r);return r;}catch(e){record(sql,params,null,e);throw e;}},async run(){return this.all();},async first(column){const row=(await this.all()).results[0]??null;return column?row?.[column]??null:row;}});
    return {prepare(sql){return statement(raw.prepare(sql),sql);},async batch(statements){const receipt={context:ctx.name,invocation:ctx.current,statements:statements.length,sql_bytes:statements.reduce((n,s)=>n+bytes(s.sql),0),parameter_bytes:statements.reduce((n,s)=>n+bytes(s.params),0)};batches.push(receipt);try{const out=await raw.batch(statements.map(s=>s._raw));out.forEach((r,i)=>record(statements[i].sql,statements[i].params,r));return out;}catch(e){receipt.error=String(e);statements.forEach(s=>record(s.sql,s.params,null,e));throw e;}}};
  }
  async function context(name,{alias=false}={}){
    const h=await freshHarness(),disposable={h};contexts.push(disposable);await h.initialize();assert.equal(SCHEMA.length,788);
    const rows=async(sql,...p)=>(await h.db.prepare(sql).bind(...p).all()).results,one=async(sql,...p)=>(await rows(sql,...p))[0]??null;
    const insert=(table,row)=>h.db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).bind(...Object.values(row)).run();
    const snapshot=async tables=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,await rows('SELECT * FROM '+table+' ORDER BY rowid')])));
    const years=alias?[2024]:[2022,2023,2024,2025,2026],events=alias?2:25,ownerId=alias?'event-00001':'event-00000',ownerYear=alias?2024:2022;
    await insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'account-native',name:'Fixture owner'});
    // Synthetic entitlement makes source and local demands genuinely live.
    await insert('source_teams',{id:ROOT,provider:'teamsnap',scope:'account',account_id:'account',native_id:'101',name:'Team',name_authority:1,archived:0,evidence:'{}',content_hash:'root',observed_at:AT});
    await insert('account_source_teams',{account_id:'account',source_team_id:ROOT});
    await insert('app_teams',{id:'team',name:'Team',timezone:'America/Los_Angeles',season_year:2024,created_at:AT});
    await insert('team_read_state',{app_team_id:'team'});
    await insert('team_source_connections',{id:'root',app_team_id:'team',source_team_id:ROOT,account_id:'account',scope_mode:'observed_history',created_at:AT});
    for(const year of years){await insert('team_seasons',{id:'season-'+year,app_team_id:'team',year,start_day:`${year}-06-01`,end_day:`${year+1}-06-01`,start_at:`${year}-06-01T07:00:00Z`,end_at:`${year+1}-06-01T07:00:00Z`,include_june:0});await insert('team_projection_state',{team_season_id:'season-'+year,app_team_id:'team',pending:0});}
    for(let i=0;i<2;i++)await insert('source_players',{id:'player-'+i,provider:'teamsnap',scope:'account',account_id:'account',native_id:'player-'+i,name:'Historical 雪 '+i,jersey:String(10+i),evidence:JSON.stringify({native_tail:'player-tail-'+i}),content_hash:'player-'+i,observed_at:AT});
    await insert('source_players',{id:'player-roster',provider:'teamsnap',scope:'account',account_id:'account',native_id:'player-roster',name:'Dated 雪 member',jersey:'17',evidence:JSON.stringify({roster_start_date:'2024-07-01',roster_end_date:'2024-12-31',position:'GK',native_tail:'roster-tail'}),content_hash:'dated-v1',observed_at:'2024-08-05T12:00:00.000Z'});
    await insert('source_roster_memberships',{source_team_id:ROOT,source_player_id:'player-roster',active:1,scan_id:'roster-fixture'});
    for(let i=0;i<events;i++){
      const suffix=String(i).padStart(5,'0'),source='source-'+suffix,id='event-'+suffix,year=alias?2024:2022+i%5,day=`${year}-08-${String(4+(alias?0:Math.floor(i/5))).padStart(2,'0')}`;
      await insert('source_events',{id:source,provider:'teamsnap',scope:'account',account_id:'account',native_id:source,local_day:day,time_precision:'day',type:'game',status:'FINAL',conditional:0,home_source_team_id:ROOT,home_label:'Us',away_label:'Them '+i,title:'Native game '+i,venue:'Native venue 雪 '+i,evidence:JSON.stringify({native_order:i,notes:'雪'.repeat(257),native_tail:'event-tail-'+i}),content_hash:'hash-'+source,observed_at:AT});
      await insert('source_event_teams',{source_team_id:ROOT,source_event_id:source,side:'home'});await insert('events',{id,created_at:AT});await insert('event_source_links',{source_event_id:source,event_id:id,reason:'native',evidence:'{}'});
      for(let j=0;j<2;j++)await insert('source_attendance',{id:source+'-attendance-'+j,account_id:'account',source_team_id:ROOT,source_event_id:source,source_player_id:'player-'+j,status:j?'Maybe':'Yes',source_status:String(j),content_hash:'attendance-'+i+'-'+j,observed_at:AT});
    }
    if(alias)await insert('event_aliases',{merged_id:'event-00000',canonical_id:'event-00001'});
    await insert('domain_overrides',{app_team_id:'team',kind:'event',entity_id:ownerId,fields:'{"title":"Owner saved title 雪"}',revision:7});
    await insert('game_bookmarks',{app_team_id:'team',event_id:ownerId,snapshot:'{"title":"Owner bookmark 雪","memo":"Keep native detail"}',saved_at:AT});
    await insert('coach_sessions',{app_team_id:'team',team_season_id:'season-'+ownerYear,event_id:ownerId,format:9,half_minutes:30,phase:'paused',period:1,elapsed_ms:12345,period_start_ms:0,revision:3,updated_at:AT,write_token:'owner-session'});
    await insert('coach_timeline',{id:'owner-timeline',app_team_id:'team',team_season_id:'season-'+ownerYear,event_id:ownerId,sequence:1,kind:'note',period:1,match_ms:12345,recorded_at:AT,detail:'{"note":"Owner note 雪"}'});
    const now=Date.now();
    await new ApplicationSyncService(h.db,{}).syncConnection('root',{wake:false});
    const sourceJobs=await rows("SELECT * FROM sync_jobs WHERE stage='source' ORDER BY component");
    assert.equal(sourceJobs.length,5,'all original source demands were coordinator-admitted');
    for(const job of sourceJobs){
      const args=JSON.parse(job.args),kind=job.component;let checkpoint={finished:true};
      if(['events','attendance'].includes(kind)){
        const refresh=(await beginTeamSnapRefresh({kind,teamId:'101',accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/'+(kind==='events'?'events':'availabilities')+'/search',args,now:now-1000})).refresh;
        checkpoint=finishTeamSnapRefresh(refresh,{count:kind==='events'?events:events*2,pages:2,digest:'a'.repeat(64),total:kind==='events'?events:events*2,now:now-500});
      }
      // Only provider receipt setup is synthetic. No connection checkpoint or
      // reconciled marker is written here or during the proof.
      await h.db.prepare("UPDATE sync_jobs SET state='ready',coverage='complete',checkpoint=?,last_complete_at=?,next_at=? WHERE id=?").bind(JSON.stringify(checkpoint),now-500,now+86400000,job.id).run();
      await insert('source_component_coverage',{id:kind+'-coverage',provider:'teamsnap',scope:'teamsnap:101',account_id:'account',kind,complete:1,record_count:kind==='events'?events:kind==='attendance'?events*2:kind==='roster'?1:0,scan_id:'fixture-full-pass',observed_at:AT});
    }
    const values=new Map(),ctx={name,h,rows,one,insert,snapshot,alias,years,events,ownerId,values,current:null,alarm:Date.now()};
    const storage={async get(k){return values.get(k);},async put(k,v){values.set(k,structuredClone(v));},async getAlarm(){return ctx.alarm;},async setAlarm(at){ctx.alarm=at;},async deleteAlarm(){ctx.alarm=null;}};
    ctx.runtime=new SyncRuntime({storage},{DB:traced(h.rawDb,ctx),ADMIN_KEY:TEST_PASSWORD,PROVIDER_FETCH:{fetch(){throw Error('Saved-input proof must not fetch providers');}}});
    ctx.clocks=async()=>({root:await one("SELECT input_revision,reconciled_revision FROM team_source_connections WHERE id='root'"),seasons:await rows('SELECT team_season_id,input_revision,source_revision,published_input_revision,published_run_id,pending,projection_hash FROM team_projection_state ORDER BY team_season_id'),canonical:await rows('SELECT event_id,revision,team_season_id,effective_day FROM team_event_season_resolutions ORDER BY event_id')});
    ctx.published=async()=>({events:await rows('SELECT * FROM team_events ORDER BY team_season_id,local_day,event_id'),players:await rows('SELECT * FROM team_players ORDER BY team_season_id,player_id'),attendance:await rows('SELECT * FROM canonical_attendance ORDER BY team_season_id,event_id,player_id')});
    ctx.job=()=>one("SELECT id,state,checkpoint,pages_saved,failures,last_error_code FROM sync_jobs WHERE provider='domain' AND component='connection'");
    contexts[contexts.indexOf(disposable)]=ctx;return ctx;
  }
  async function wake(ctx){ctx.current='wake-'+(++sequence);const start=queries.length,result=await ctx.runtime.wake(),sql=queries.slice(start);assert.ok(sql.length<=50);wakes.push({context:ctx.name,result,submitted_sql:sql.length});}
  async function beginPass(ctx){const r=await ctx.one("SELECT * FROM team_source_connections WHERE id='root'");await new JobCoordinator(ctx.h.db,{publicHistory:true}).enqueueMany([{provider:'domain',component:'connection',stage:'projection',scope:'team',resourceKey:'root',args:{connectionId:'root',teamId:'team',generation:r.generation,inputRevision:r.input_revision},priority:90,recurring:false}],[{kind:'team',key:'connection:root',teamId:'team',generation:r.generation}],{refresh:true});await wake(ctx);}
  async function alarm(ctx){
    assert.notEqual(ctx.alarm,null,'unfinished runtime retains alarm');assert.ok(ctx.alarm-Date.now()<5000,'normal proof must not wait a lease/retry window');while(Date.now()<=ctx.alarm)await sleep(Math.max(1,ctx.alarm-Date.now()+2));
    const previous=await ctx.job();ctx.current=++sequence;const start=queries.length,oldWarn=console.warn;
    console.warn=(value,...args)=>{if(value?.event==='sync_failure_diagnostic')diagnostics.push({context:ctx.name,invocation:ctx.current,...structuredClone(value)});else oldWarn(value,...args);};
    try{await ctx.runtime.alarm();}finally{console.warn=oldWarn;}
    const result=ctx.values.get('last_run'),sql=queries.slice(start),job=await ctx.job(),claimed_job=result?.jobId?await ctx.one('SELECT id,component,state,checkpoint,pages_saved,failures,last_error_code FROM sync_jobs WHERE id=?',result.jobId):null,receipt={context:ctx.name,invocation:ctx.current,stage,previous,result,job,claimed_job,submitted_sql:sql.length,rows_read:sum(sql,'rows_read'),rows_written:sum(sql,'rows_written'),parameter_bytes:sum(sql,'parameter_bytes')};alarms.push(receipt);
    assert.ok(result&&result.statements<=50&&sql.length<=50,JSON.stringify(receipt));assert.equal(result.statements,sql.length,'installation inspection and epoch are counted in the same invocation');assert.ok(sql.some(q=>q.sql.includes('sqlite_master')||q.sql.includes('installation_upgrade')));assert.ok(!['error','failed','blocked','retrying','lease_lost'].includes(result.state),JSON.stringify(receipt));
    assert.deepEqual(await ctx.rows("SELECT id,state,last_error_code FROM sync_jobs WHERE state IN('failed','blocked','retrying')"),[]);
    console.log(JSON.stringify({reconciliation_runtime_alarm:{context:ctx.name,invocation:ctx.current,stage,component:result.component,state:result.state,phase:job?JSON.parse(job.checkpoint).phase:null,submitted_sql:sql.length}}));return receipt;
  }
  async function settled(ctx){return (await ctx.one("SELECT (SELECT count(*) FROM team_source_connections WHERE active=1 AND input_revision>reconciled_revision)+(SELECT count(*) FROM team_projection_state WHERE pending=1)+(SELECT count(*) FROM team_read_state WHERE pending=1)+(SELECT count(*) FROM sync_jobs WHERE state IN('queued','running','retrying')) n")).n===0;}
  async function drain(ctx,maxAlarms=140){for(let i=0;i<maxAlarms;i++){if(await settled(ctx))return;await alarm(ctx);}assert.fail('bounded full-runtime drain did not settle');}
  async function verifyPublished(ctx){const pub=await ctx.published(),clocks=await ctx.clocks();assert.equal(pub.events.length,ctx.alias?1:25);assert.equal(pub.attendance.length,ctx.alias?4:50);assert.equal(pub.players.length,ctx.alias?3:11);assert.ok(clocks.seasons.every(s=>s.published_run_id&&s.published_input_revision===s.input_revision&&s.pending===0));assert.equal(clocks.root.input_revision,clocks.root.reconciled_revision);assert.equal(pub.events.find(e=>e.event_id===ctx.ownerId).title,'Owner saved title 雪');assert.ok(pub.players.filter(p=>p.name.startsWith('Historical')).every(p=>p.jersey===null));assert.deepEqual(await ctx.rows('PRAGMA foreign_key_check'),[]);const ownerScope=await resolvePublishedGame(ctx.h.db,'team',ctx.alias?'season-2024':'season-2022',ctx.ownerId);assert.equal(ownerScope.available,true);const ownerState=await captureGameOwnerState(ctx.h.db,ownerScope);return {pub,clocks,ownerState};}
  async function finish(status,error=null){const after=await rawMap(root),baseAfter=await rawMap(baseline);assert.deepEqual(after,before);assert.deepEqual(baseAfter,baseBefore);const receipt={status,error,stage,elapsed_ms:Date.now()-started,scope:{synthetic:true,native_d1:true,exported_worker_runtime:true,actual_component_collector:true,installation_statements:SCHEMA.length,inspection_and_epoch_same_50_statement_budget:true,host_invoked_alarm_method:true,actual_alarm_delivery:false,virtual_clock:false,production_delay_ms:500,no_manual_reconciled_markers:true,source_rows_never_truncated:true,source_receipt_fixture_seeded:true,observer_reads_outside_runtime_budget:true},results,maximums:{submitted_sql:max(alarms,'submitted_sql'),transaction_statements:max(batches,'statements'),transaction_parameter_bytes:max(batches,'parameter_bytes'),statement_parameter_bytes:max(queries,'parameter_bytes'),checkpoint_bytes:Math.max(0,...alarms.flatMap(a=>[bytes(a.job?.checkpoint??''),bytes(a.claimed_job?.checkpoint??'')])),result_bytes:max(queries,'result_bytes')},measured_native_d1:{statements:queries.length,rows_read:sum(queries,'rows_read'),rows_written:sum(queries,'rows_written'),failed_statement_metadata_missing:queries.filter(q=>q.rows_read===null).length},candidate_map_sha256:hash(before),candidate_map_before:before,candidate_map_after:after,baseline_map_sha256:hash(baseBefore),baseline_map_before:baseBefore,baseline_map_after:baseAfter,alarms,wakes,batches,queries,diagnostics};const out=process.env.MYTS_RECONCILIATION_OUTPUT||'tmp/reconciliation-runtime';await mkdir(out,{recursive:true});await writeFile(path.join(out,'native-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({reconciliation_runtime_native:{...receipt,candidate_map_before:undefined,candidate_map_after:undefined,baseline_map_before:undefined,baseline_map_after:undefined,alarms:undefined,wakes:undefined,batches:undefined,queries:undefined,results:undefined,diagnostics:undefined}}));}
  try{
    const main=await context('batched-25');stage='initial 25-event materialization and publication';const sourceBefore=await main.snapshot(sourceTables),ownerBefore=await main.snapshot(ownerTables);await beginPass(main);await drain(main);const initial=await verifyPublished(main);assert.deepEqual(await main.snapshot(sourceTables),sourceBefore);assert.deepEqual(await main.snapshot(ownerTables),ownerBefore);
    const eventPages=alarms.filter(a=>a.context===main.name&&a.result.component==='connection'&&JSON.parse(a.job.checkpoint).phase==='events'&&JSON.parse(a.previous.checkpoint).phase==='events').map(a=>JSON.parse(a.job.checkpoint).after);assert.deepEqual(eventPages.slice(0,2),['event-00023','event-00024'],'native common prefix is 24+1');
    const semantics=await main.snapshot(semanticTables);results.initial={...initial,source_rows:sourceBefore,owner_rows:ownerBefore,event_page_cursors:eventPages};
    stage='unchanged complete second pass';const start=alarms.length;await beginPass(main);await drain(main,60);const unchanged=await verifyPublished(main);assert.deepEqual(unchanged,initial,'unchanged pass preserves canonical clocks, all season clocks, pointers and full published rows');assert.deepEqual(await main.snapshot(semanticTables),semantics);assert.deepEqual(await main.snapshot(sourceTables),sourceBefore);assert.deepEqual(await main.snapshot(ownerTables),ownerBefore);assert.ok(alarms.slice(start).some(a=>a.result.component==='connection'&&a.result.state==='ready'),'second connection pass actually completes');results.unchanged={alarm_count:alarms.length-start,clocks:unchanged.clocks,source_rows_unchanged:true,owner_rows_unchanged:true,semantic_rows_unchanged:true,published_rows_unchanged:true};
    stage='genuine changed input behind event cursor';await beginPass(main);let cursor;
    for(let i=0;i<35;i++){const a=await alarm(main),cp=JSON.parse(a.job.checkpoint);if(a.result.component==='connection'&&cp.phase==='events'&&cp.after==='event-00023'){cursor=cp;break;}}assert.ok(cursor,'third pass advances first 24 events');
    await main.h.db.prepare("UPDATE source_events SET local_day='2022-09-12',content_hash='changed-date-v2' WHERE id='source-00000'").run();
    await main.h.db.prepare("UPDATE source_players SET name='Updated dated 雪 member',jersey='23',content_hash='dated-v2',observed_at='2024-08-06T12:00:00.000Z' WHERE id='player-roster'").run();
    const changedSources=await main.snapshot(sourceTables),sourceClocks=await main.clocks();assert.ok(sourceClocks.root.input_revision>cursor.passRevision);assert.deepEqual(await main.published(),initial.pub,'old publication remains usable immediately after source changes');
    let restarted=false;for(let i=0;i<60;i++){const a=await alarm(main),cp=JSON.parse(a.job.checkpoint);if(a.result.component==='connection'&&cp.phase==='boundaries'&&cp.passRevision===sourceClocks.root.input_revision){restarted=true;break;}}assert.equal(restarted,true,'normal finish fence starts full behind-cursor catch-up pass');
    await drain(main);const changed=await verifyPublished(main);assert.deepEqual(await main.snapshot(sourceTables),changedSources);assert.deepEqual(await main.snapshot(ownerTables),ownerBefore);
    const changedSeasonIds=changed.clocks.seasons.filter((s,i)=>s.input_revision!==initial.clocks.seasons[i].input_revision).map(s=>s.team_season_id);assert.deepEqual(changedSeasonIds,['season-2022','season-2024']);
    for(const s of changed.clocks.seasons){const old=initial.clocks.seasons.find(r=>r.team_season_id===s.team_season_id);if(changedSeasonIds.includes(s.team_season_id))assert.notEqual(s.published_run_id,old.published_run_id);else assert.deepEqual(s,old);}
    assert.deepEqual(changed.clocks.canonical.map((r,i)=>r.revision-initial.clocks.canonical[i].revision),[1,...Array(24).fill(0)]);assert.equal(changed.pub.events.find(e=>e.event_id==='event-00000').local_day,'2022-09-12');assert.ok(changed.pub.players.some(p=>p.team_season_id==='season-2024'&&p.name==='Updated dated 雪 member'&&p.jersey==='23'));assert.deepEqual(changed.pub.attendance,initial.pub.attendance);results.changed={clocks:changed.clocks,changed_seasons:changedSeasonIds,catch_up_restarted:true,source_rows:changedSources,published:changed.pub,owner_rows_unchanged:true};
    stage='aliased fallback and dated-roster repeated pass';const alias=await context('aliased-fallback',{alias:true}),aliasSources=await alias.snapshot(sourceTables),aliasOwner=await alias.snapshot(ownerTables);await beginPass(alias);await drain(alias,100);const aliasInitial=await verifyPublished(alias),aliasSemantics=await alias.snapshot(semanticTables);await beginPass(alias);await drain(alias,60);const aliasUnchanged=await verifyPublished(alias);assert.deepEqual(aliasUnchanged,aliasInitial);assert.deepEqual(await alias.snapshot(semanticTables),aliasSemantics);assert.deepEqual(await alias.snapshot(sourceTables),aliasSources);assert.deepEqual(await alias.snapshot(ownerTables),aliasOwner);assert.equal(aliasSemantics.team_event_season_resolutions.length,1);assert.equal(JSON.parse(aliasSemantics.team_event_season_resolutions[0].evidence).length,2);assert.equal(aliasSemantics.connection_roster_evidence.length,5);results.alias={initial:aliasInitial,unchanged:aliasUnchanged,source_rows:aliasSources,owner_rows:aliasOwner,canonical_observations:2,roster_evidence_rows:5};
    for(const ctx of contexts){assert.equal((await ctx.one('SELECT writer_mode FROM installation_team_games_upgrade')).writer_mode,null);assert.deepEqual(await ctx.rows('PRAGMA foreign_key_check'),[]);}
    assert.equal(diagnostics.length,0);assert.ok(max(batches,'parameter_bytes')<=2000000);assert.ok(Math.max(...alarms.flatMap(a=>[bytes(a.job?.checkpoint??''),bytes(a.claimed_job?.checkpoint??'')]))<=8192);stage='complete';await finish('passed');
  }catch(error){await finish('failed',String(error));throw error;}finally{for(const ctx of contexts.reverse())await ctx.h.dispose();}
});
