import test from 'node:test';
import assert from 'node:assert/strict';
import {freshHarness,TEST_PASSWORD} from './fresh-harness.js';
import {DomainRepository,sourceKey} from '../src/domain/repository.js';
import {readSourceArchive} from '../web/app/data-files.js';
import {VERSION} from '../src/application/version.js';
import {SCHEMA,SEED} from '../src/application/installation-schema.js';
import {FreshInstallation} from '../src/application/fresh-install.js';
test('fresh Worker initializes through bounded resumable HTTP steps and signs in once',async()=>{
  const h=await freshHarness();
  try{
    for(const path of ['/','/admin','/view/'+'A'.repeat(43)]){const shell=await h.request(path);assert.equal(shell.status,200,JSON.stringify(shell.data));assert.equal(shell.headers.get('location'),null);assert.equal(shell.headers.get('cache-control'),'no-store');assert.ok(shell.data.includes('/app/entry.js'));}
    const bootstrap=await h.request('/api/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.data.version,VERSION);assert.equal(bootstrap.data.setup.state,'empty');
    const wrong=await h.request('/api/owner/initialize',{method:'POST',body:{password:'incorrect'}});assert.equal(wrong.status,401);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='setup_state'").first()).n,0);
    const schemaPages=Math.ceil(SCHEMA.length/new FreshInstallation(null,{schema:SCHEMA,seed:SEED}).batchSize);
    let result,steps=0;
    do{result=await h.request('/api/owner/initialize',{method:'POST',body:{password:TEST_PASSWORD}});assert.ok([200,202].includes(result.status),JSON.stringify(result.data));steps++;assert.ok(steps<=schemaPages+1,'Schema pages plus one separate owner-commit request must finish setup.');}while(result.data.continue);
    assert.ok(steps>1);assert.ok(result.headers.get('set-cookie').includes('HttpOnly'));
    assert.equal((await h.request('/api/bootstrap')).data.session.role,'owner');
    const created=await h.request('/api/teams',{method:'POST',body:{name:'Fresh review team',timezone:'America/Los_Angeles',season_year:2026,request_id:crypto.randomUUID()}});assert.equal(created.status,201,JSON.stringify(created.data));
    const teams=(await h.request('/api/bootstrap')).data.teams;assert.equal(teams.length,1);assert.equal(teams[0].seasons[0].start_day,'2026-06-01');
    const q=new URLSearchParams({team_id:teams[0].id,team_season_id:teams[0].seasons[0].id});
    const overview=await h.request('/api/overview?'+q);assert.equal(overview.status,200,JSON.stringify(overview.data));assert.equal(overview.data.data.record.games,0);
    await h.request('/api/owner/logout',{method:'POST',body:{}});assert.equal((await h.request('/api/bootstrap')).data.session.role,'anonymous');
    const signedOut=await h.request('/api/overview?'+q);assert.equal(signedOut.status,401);
    const login=await h.request('/api/owner/login',{method:'POST',body:{password:TEST_PASSWORD}});assert.equal(login.status,200);assert.equal((await h.request('/api/bootstrap')).data.teams.length,1);
  }finally{await h.dispose();}
});
test('assembled reports prepare all four types and real binary exports through native alarms',async()=>{
  const h=await freshHarness();try{
    await h.initialize();
    const created=await h.request('/api/teams',{method:'POST',body:{name:'Report review team',timezone:'America/Los_Angeles',season_year:2026}});assert.equal(created.status,201);
    const selection={team_id:created.data.team.id,team_season_id:created.data.season_id};
    const ids=[];
    for(const type of ['season','matches','players','availability']){
      const result=await h.request('/api/reports/snapshots',{method:'POST',body:{...selection,type}});assert.equal(result.status,202,JSON.stringify(result.data));ids.push(result.data.data.snapshot_id);
    }
    const closedAt=Date.now();
    // No application or browser request drives capture during this interval.
    await h.waitFor(async()=>{const rows=(await h.db.prepare("SELECT type,state,error_code FROM report_snapshots").all()).results;assert.ok(rows.every(r=>r.state!=='failed'),JSON.stringify(rows));return rows.length===4&&rows.every(r=>r.state==='ready');});
    const ready=(await h.db.prepare("SELECT type,total,captured,selection FROM report_snapshots").all()).results;for(const row of ready){assert.equal(row.total,row.type==='season'?6:0);assert.equal(row.captured,row.total);assert.equal(JSON.parse(row.selection).report_initial_publication,undefined);}
    const captures=(await h.db.prepare("SELECT state,last_saved_at,last_complete_at FROM sync_jobs WHERE provider='reports' AND component='capture'").all()).results;
    assert.equal(captures.length,4);assert.ok(captures.every(j=>j.state==='ready'&&j.last_saved_at>=closedAt&&j.last_complete_at>=closedAt));
    const q=new URLSearchParams(selection);for(const id of ids){const preview=await h.request('/api/reports?'+q+'&snapshot_id='+id);assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.data.state,'ready');}
    const exports=[];for(const format of ['xlsx','pdf']){const result=await h.request('/api/reports/'+ids[0]+'/exports',{method:'POST',body:{format}});assert.equal(result.status,202,JSON.stringify(result.data));exports.push({id:result.data.id,format});}
    await h.waitFor(async()=>{const rows=(await h.db.prepare("SELECT state,error_code FROM report_exports").all()).results;if(rows.some(r=>r.state==='failed'))throw new Error(JSON.stringify(rows));return rows.length===2&&rows.every(r=>r.state==='ready');});
    for(const file of exports){const download=await h.request('/api/reports/exports/'+file.id+'/download');assert.equal(download.status,200,JSON.stringify(download.data));assert.ok(download.data.startsWith(file.format==='pdf'?'%PDF-':'PK'));assert.ok(download.headers.get('content-disposition').includes('.'+file.format));}
    const usage=await h.request('/api/usage?'+q);assert.equal(usage.status,200,JSON.stringify(usage.data));assert.ok(usage.data.data.database_bytes>0);
    console.log(JSON.stringify({assembled_reports:'PASS',browser_open:false,manual_runner_requests:0,report_types:4,binary_formats:2}));
  }finally{await h.dispose();}
});
test('public connection, shared publication, corrections, inclusion, viewer scope and removal work through the assembled API',async()=>{
  const h=await freshHarness();try{
    await h.initialize();
    const create=await h.request('/api/teams',{method:'POST',body:{name:'Public workflow team',timezone:'America/Los_Angeles',season_year:2026}});assert.equal(create.status,201,JSON.stringify(create.data));
    const team=create.data.team.id,season=create.data.season_id,selection={team_id:team,team_season_id:season},q=new URLSearchParams({...selection,mode:'season',period:'all'});
    const resolved=await h.request('/api/sources/gotsport/resolve',{method:'POST',body:{url:'https://rankings.gotsport.com/teams/212707/upcoming-games'}});assert.equal(resolved.status,200,JSON.stringify(resolved.data));assert.equal(resolved.data.teams.length,1);
    const attached=await h.request('/api/teams/'+team+'/attachments',{method:'POST',body:{season_id:season,source_team_id:resolved.data.teams[0].id}});assert.equal(attached.status,202,JSON.stringify(attached.data));
    const closedAt=Date.now();
    // Native alarms continue after the attach request returns. Reads here only
    // inspect D1, and never call an application runner, retry or refresh route.
    await h.waitFor(async()=>{
      const rows=(await h.db.prepare("SELECT component,state,last_error_code,last_error_message FROM sync_jobs WHERE state IN('failed','blocked','retrying')").all()).results;
      if(rows.length)throw new Error(JSON.stringify(rows));
      const state=await h.db.prepare('SELECT pending FROM team_read_state WHERE app_team_id=?').bind(team).first(),count=await h.db.prepare('SELECT COUNT(*) n FROM team_events WHERE app_team_id=?').bind(team).first(),pending=await h.db.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE state IN('queued','running')").first();return state.pending===0&&count.n>=2&&pending.n===0;
    },{timeout:120000});
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM app_teams').first()).n,1);
    assert.ok((await h.db.prepare('SELECT COUNT(*) n FROM sync_jobs WHERE last_saved_at>=?').bind(closedAt).first()).n>0);
    const schedule=await h.request('/api/schedule?'+q);assert.equal(schedule.status,200,JSON.stringify(schedule.data));const event=schedule.data.data.items.find(e=>e.status==='FINAL');assert.ok(event);
    const detail=await h.request('/api/matches/'+event.id+'?'+q);assert.equal(detail.status,200,JSON.stringify(detail.data));assert.equal(detail.data.data.event.id,event.id);
    const competitions=await h.request('/api/competitions?'+q);assert.equal(competitions.status,200,JSON.stringify(competitions.data));assert.ok(competitions.data.data.competitions.total>0);
    assert.ok(event.competition_id);const category=await h.request('/api/competitions/'+event.competition_id+'?'+q);assert.equal(category.status,200,JSON.stringify(category.data));assert.ok(category.data.data.events.total>0);
    const editor=await h.request('/api/matches/'+event.id+'/editor?'+q);assert.equal(editor.status,200);
    const corrected=await h.request('/api/matches/'+event.id+'/correction?'+q,{method:'PUT',body:{revision:editor.data.revision,fields:{home_score:5,away_score:0,status:'FINAL'}}});assert.equal(corrected.status,202,JSON.stringify(corrected.data));
    await h.waitFor(async()=>{const row=await h.db.prepare('SELECT home_score FROM team_events WHERE app_team_id=? AND event_id=?').bind(team,event.id).first();return row?.home_score===5;});
    const stale=await h.request('/api/matches/'+event.id+'/correction?'+q,{method:'PUT',body:{revision:0,fields:{home_score:1}}});assert.equal(stale.status,409,JSON.stringify(stale.data));
    const inclusion=await h.request('/api/inclusion?'+q);assert.equal(inclusion.status,200);
    const saved=await h.request('/api/inclusion/batch?'+q,{method:'POST',body:{revision:inclusion.data.revision,content_revision:inclusion.data.content_revision,rules:[{kind:'event',resource_key:event.id,included:false}]}});assert.equal(saved.status,200,JSON.stringify(saved.data));
    const overview=await h.request('/api/overview?'+q);assert.equal(overview.status,200,JSON.stringify(overview.data));assert.equal(overview.data.data.record.games,0);assert.equal((await h.request('/api/schedule?'+q)).data.data.total,schedule.data.data.total);
    await h.request('/api/bookmarks/'+event.id+'?'+q,{method:'PUT',body:{saved:true}});const bookmarks=await h.request('/api/bookmarks?'+q+'&period=all');assert.equal(bookmarks.status,200);assert.equal(bookmarks.data.data.events.items[0].home_score,5);
    const shared=await h.request('/api/teams/'+team+'/share',{method:'POST',body:{}});assert.equal(shared.status,200,JSON.stringify(shared.data));const key=new URL(shared.data.viewer_url).pathname.split('/').at(-1),headers={'x-view-key':key};
    assert.equal((await h.request('/api/teams/'+team+'/share')).data.viewer_url,shared.data.viewer_url);
    assert.equal((await h.request('/api/overview?'+q,{signed:false,headers})).status,200);
    const forbidden=await h.request('/api/coach?'+q+'&event_id='+event.id,{signed:false,headers});assert.equal(forbidden.status,403,JSON.stringify(forbidden.data));
    const write=await h.request('/api/bookmarks/'+event.id+'?'+q,{method:'PUT',body:{saved:false},signed:false,headers});assert.equal(write.status,401);
    const replacement=await h.request('/api/teams/'+team+'/share',{method:'POST',body:{}});assert.equal(replacement.status,200);assert.equal((await h.request('/api/overview?'+q,{signed:false,headers})).status,401);
    const rename=await h.request('/api/teams/'+team,{method:'PUT',body:{name:'Renamed public team',revision:1}});assert.equal(rename.status,200,JSON.stringify(rename.data));assert.equal((await h.request('/api/bootstrap')).data.teams[0].name,'Renamed public team');
    const follow=await h.request('/api/teams',{method:'POST',body:{name:'Temporary followed team',timezone:'UTC',season_year:2026}});const removed=await h.request('/api/teams/'+follow.data.team.id,{method:'DELETE',body:{revision:0}});assert.equal(removed.status,202,JSON.stringify(removed.data));assert.equal((await h.request('/api/bootstrap')).data.teams.length,1);
    await h.waitFor(async()=>!(await h.db.prepare('SELECT id FROM app_teams WHERE id=?').bind(follow.data.team.id).first()));assert.ok(await h.db.prepare('SELECT id FROM app_teams WHERE id=?').bind(team).first());assert.ok((await h.db.prepare('SELECT COUNT(*) n FROM source_events').first()).n>0);
    console.log(JSON.stringify({assembled_public_workflow:'PASS',browser_open:false,manual_runner_requests:0,app_teams:1,public_events:schedule.data.data.total,verified_steps:['connect','native-publication','detail','competition','correction','CAS','inclusion','bookmark','share','rotation','rename','bounded-remove']}));
  }finally{await h.dispose();}
});
test('assembled current-release data ZIP exports and staged imports resume on native alarms',async()=>{
  const h=await freshHarness();try{
    await h.initialize();const created=await h.request('/api/teams',{method:'POST',body:{name:'Dataset workflow',timezone:'UTC',season_year:2026}});assert.equal(created.status,201);
    const selection={team_id:created.data.team.id},domain=new DomainRepository(h.db);
    const resolved=await h.request('/api/sources/gotsport/resolve',{method:'POST',body:{url:'https://rankings.gotsport.com/teams/212707/upcoming-games'}});assert.equal(resolved.status,200,JSON.stringify(resolved.data));
    const source=resolved.data.teams.find(team=>team.id===sourceKey('gotsport','212707'));assert.ok(source,'ordinary discovery must supply the authorized native team');
    const observed='2026-10-10T12:00:00Z',fixtures=Array.from({length:17},(_,i)=>({provider:'gotsport',id:'gotsport:'+String(31000+i),native_id:String(31000+i),home_id:'gotsport:212707',away_id:null,competition_id:null,division_id:null,starts_at:'2026-09-01T17:00:00Z',local_day:null,type:'game',status:'FINAL',conditional:0,home_score:2,away_score:1,payload:JSON.stringify({home_name:'Dataset team',away_name:'Opponent '+i}),observed_at:observed}));
    const connectionCommand={request_id:crypto.randomUUID(),team_id:selection.team_id,source_team_id:source.id};
    const connected=await h.request('/api/connections',{method:'POST',body:connectionCommand});assert.equal(connected.status,202,JSON.stringify(connected.data));assert.equal(connected.data.connection.scope_mode,'observed_history');
    const settled=async()=>{
      const failed=(await h.db.prepare("SELECT component,last_error_code,last_error_message FROM sync_jobs WHERE state IN('failed','blocked','retrying')").all()).results;if(failed.length)throw new Error(JSON.stringify(failed));
      const state=await h.db.prepare('SELECT pending FROM team_read_state WHERE app_team_id=?').bind(selection.team_id).first(),roots=await h.db.prepare('SELECT COUNT(*) n FROM team_source_connections WHERE app_team_id=? AND active=1 AND input_revision>reconciled_revision').bind(selection.team_id).first(),jobs=await h.db.prepare("SELECT COUNT(*) n FROM sync_jobs WHERE state IN('queued','running')").first();return state.pending===0&&roots.n===0&&jobs.n===0;
    };
    // Let ordinary provider discovery finish before adding the explicit saved
    // history fixture, so its baseline is not interleaved with continuing discovery.
    await h.waitFor(settled,{timeout:120000});
    await domain.ingestSourcePage({fixtures});
    // An ordinary retry reuses the typed root and wakes the newly saved history.
    // It neither fabricates authority nor refreshes unchanged provider jobs.
    const replayed=await h.request('/api/connections',{method:'POST',body:connectionCommand});assert.equal(replayed.status,202,JSON.stringify(replayed.data));assert.equal(replayed.data.connection_id,connected.data.connection_id);
    const identity=await h.db.prepare('SELECT (SELECT COUNT(*) FROM app_teams) teams,(SELECT COUNT(*) FROM team_source_connections WHERE app_team_id=?) roots,(SELECT COUNT(*) FROM connection_command_receipts WHERE request_id=?) receipts').bind(selection.team_id,connectionCommand.request_id).first();assert.deepEqual(identity,{teams:1,roots:1,receipts:1},'the same owner request must reuse one team, root and receipt');
    await h.waitFor(settled,{timeout:120000});
    const ids=async(sql,...params)=>(await h.db.prepare(sql).bind(...params).all()).results.map(row=>row.id),seedIds=fixtures.map(row=>sourceKey('gotsport',row.native_id));
    const baseline={source:await ids('SELECT id FROM source_events ORDER BY id'),canonical:await ids('SELECT id FROM events ORDER BY id'),published:await ids('SELECT event_id AS id FROM team_events WHERE app_team_id=? ORDER BY event_id',selection.team_id),owned:await ids('SELECT source_event_id AS id FROM source_event_teams WHERE source_team_id=? ORDER BY source_event_id',source.id)};
    const retained=(before,after,label)=>{assert.ok(after.length>=before.length,label+' count must not shrink');const found=new Set(after);for(const id of before)assert.ok(found.has(id),label+' lost '+id);};
    retained(seedIds,baseline.source,'seeded source graph');assert.ok(baseline.published.length>=17);
    const exported=await h.request('/api/data/exports',{method:'POST',body:{...selection,kind:'dataset'}});assert.equal(exported.status,202,JSON.stringify(exported.data));assert.equal(exported.data.scope_kind,'connected_history');assert.equal(exported.data.team_season_id,null);
    const closedAt=Date.now();await h.waitFor(async()=>{const row=await h.db.prepare('SELECT state,error_code FROM data_file_exports WHERE id=?').bind(exported.data.id).first();if(row.state==='failed')throw new Error(JSON.stringify(row));return row.state==='ready';});
    const job=await h.db.prepare("SELECT state,last_saved_at,last_complete_at FROM sync_jobs WHERE component='data-export'").first();assert.equal(job.state,'ready');assert.ok(job.last_saved_at>=closedAt&&job.last_complete_at>=closedAt);
    const download=await h.request('/api/data/exports/'+exported.data.id+'/download',{binary:true});assert.equal(download.status,200);const archive=await readSourceArchive(new Blob([download.data]));assert.equal(archive.manifest.format_version,'7.2');assert.equal(archive.manifest.scope.scope_kind,'connected_history');
    const archiveEvents=[];for(const segment of archive.manifest.segments)if(segment.section.startsWith('source_events@'))archiveEvents.push(...(await archive.segment(segment)).rows.map(row=>row.id));assert.equal(new Set(archiveEvents).size,archiveEvents.length);retained(seedIds,archiveEvents,'exported seeds');retained(baseline.owned,archiveEvents,'exported connected history');
    const imported=await h.request('/api/data/imports',{method:'POST',body:{...selection,manifest:archive.manifest}});assert.equal(imported.status,201,JSON.stringify(imported.data));const before=(await domain.state()).source_revision;
    for(const segment of archive.manifest.segments){const uploaded=await h.request('/api/data/imports/'+imported.data.id+'/segments/'+segment.ordinal,{method:'PUT',body:await archive.segment(segment)});assert.equal(uploaded.status,200,JSON.stringify(uploaded.data));}
    assert.equal((await domain.state()).source_revision,before);const committed=await h.request('/api/data/imports/'+imported.data.id+'/commit',{method:'POST',body:{}});assert.equal(committed.status,202,JSON.stringify(committed.data));
    await h.waitFor(async()=>{const row=await h.db.prepare('SELECT state FROM data_file_imports WHERE id=?').bind(imported.data.id).first();return await settled()&&row.state==='ready';},{timeout:120000});
    const after={source:await ids('SELECT id FROM source_events ORDER BY id'),canonical:await ids('SELECT id FROM events ORDER BY id'),published:await ids('SELECT event_id AS id FROM team_events WHERE app_team_id=? ORDER BY event_id',selection.team_id)};for(const kind of ['source','canonical','published'])retained(baseline[kind],after[kind],kind+' baseline');
    const savedSeeds=await h.db.prepare("SELECT COUNT(DISTINCT e.id) n FROM source_events e JOIN event_source_links l ON l.source_event_id=e.id JOIN team_events t ON t.event_id=l.event_id AND t.app_team_id=? WHERE e.id IN(SELECT value FROM json_each(?)) AND e.home_score=2 AND e.away_score=1").bind(selection.team_id,JSON.stringify(seedIds)).first();assert.equal(savedSeeds.n,17,'all seventeen original observations remain published with their scores');
    const reopened=await h.request('/api/data/imports?team_id='+selection.team_id);assert.equal(reopened.status,200);const complete=reopened.data.items.find(item=>item.id===imported.data.id);assert.equal(complete?.state,'ready');assert.equal(complete.validated,archive.manifest.segments.length);assert.equal(complete.applied,archive.manifest.segments.length);
    console.log(JSON.stringify({assembled_data_files:'PASS',scope_kind:'connected_history',browser_open:false,manual_runner_requests:0,seeded_rows:17,exported_rows:archiveEvents.length,baseline_source:baseline.source.length,baseline_canonical:baseline.canonical.length,baseline_published:baseline.published.length,after_source:after.source.length,after_canonical:after.canonical.length,after_published:after.published.length,validated_segments:archive.manifest.segments.length,source_writes_before_commit:0}));
  }finally{await h.dispose();}
});
test('assembled owner Coach conserves minutes through explicit clock corrections and rejects viewer access',async()=>{
  const h=await freshHarness();try{
    await h.initialize();const created=await h.request('/api/teams',{method:'POST',body:{name:'Coach workflow',timezone:'UTC',season_year:2026}}),team=created.data.team.id,season=created.data.season_id,domain=new DomainRepository(h.db,{inlineProjection:true}),observed=new Date().toISOString();
    await domain.ingestSourcePage({records:{teams:[{provider:'gotsport',id:'gotsport:212707',native_id:'212707',name:'Coach team',details:'{}',observed_at:observed}]},fixtures:[{provider:'gotsport',id:'gotsport:32000',native_id:'32000',home_id:'gotsport:212707',away_id:null,starts_at:'2026-10-11T17:00:00Z',local_day:null,type:'game',status:'SCHEDULED',conditional:0,home_score:null,away_score:null,payload:JSON.stringify({home_name:'Coach team',away_name:'Opponent'}),observed_at:observed}]});
    await domain.attachTeam({teamId:team,seasonId:season,sourceTeamId:sourceKey('gotsport','212707')});
    const run=(await h.db.prepare('SELECT published_run_id FROM team_projection_state WHERE team_season_id=?').bind(season).first()).published_run_id,event=(await h.db.prepare('SELECT event_id FROM team_events WHERE app_team_id=?').bind(team).first()).event_id,players=Array.from({length:11},()=>crypto.randomUUID());
    // Explicit synthetic roster for this owner-workflow test, separate from
    // provider roster/discovery acceptance checks.
    await h.db.batch(players.flatMap((id,i)=>[h.db.prepare('INSERT INTO players VALUES(?,?)').bind(id,observed),h.db.prepare('INSERT INTO team_player_rows VALUES(?,?,?,?,?,?,?)').bind(run,team,season,id,'Player '+i,String(i+1),'[]')]));
    const scope={team_id:team,team_season_id:season,event_id:event},q=new URLSearchParams(scope);let session;
    async function command(action,revision=session?.revision??0){const response=await h.request('/api/coach',{method:'POST',body:{...scope,revision,action}});assert.equal(response.status,200,JSON.stringify(response.data));session=response.data.session;return response.data;}
    const profile=await h.request('/api/coach/profiles',{method:'PUT',body:{...scope,player_id:players[0],revision:0,value:{positions:{GK:5},endurance:4,target_minutes:45}}});assert.equal(profile.status,200,JSON.stringify(profile.data));
    await command({type:'create',format:9,half_minutes:25});await command({type:'lineup',field:Object.fromEntries(['GK','LB','CB','RB','LM','CM','RM','LF','RF'].map((position,i)=>[position,players[i]]))});await command({type:'start'});
    const revision=session.revision;for(let i=0;i<3;i++){const read=await h.request('/api/coach?'+q);assert.equal(read.status,200,JSON.stringify(read.data));assert.equal(read.data.session.revision,revision);}assert.equal((await h.db.prepare('SELECT revision FROM coach_sessions').first()).revision,revision);
    await command({type:'pause'});await command({type:'correct',elapsed_ms:25*60000});await command({type:'halftime'});await command({type:'resume'});await command({type:'pause'});await command({type:'correct',elapsed_ms:50*60000});await command({type:'end'});assert.equal(session.minutes_total_ms,450*60000);
    await command({type:'late_substitute',out:players[1],in:players[9],at_minutes:5,duration:5});assert.equal(session.minutes_total_ms,450*60000);assert.equal(session.minutes_ms[players[9]],5*60000);
    const stale=await h.request('/api/coach',{method:'POST',body:{...scope,revision:0,action:{type:'correct',minutes:{[players[0]]:49}}}});assert.equal(stale.status,409,JSON.stringify(stale.data));
    const shared=await h.request('/api/teams/'+team+'/share',{method:'POST',body:{}});assert.equal(shared.status,200,JSON.stringify(shared.data));const headers={'x-view-key':new URL(shared.data.viewer_url).pathname.split('/').at(-1)};
    assert.equal((await h.request('/api/coach?'+q,{signed:false,headers})).status,403);assert.equal((await h.request('/api/coach/profiles?'+q,{signed:false,headers})).status,403);
    console.log(JSON.stringify({assembled_coach:'PASS',roster:'synthetic',format:9,total_minutes:450,elapsed_clock:'explicit-owner-corrections',read_clock_writes:0,viewer_private:true}));
  }finally{await h.dispose();}
});
