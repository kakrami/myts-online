import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DOMAIN_SCHEMA} from '../src/domain/schema.js';
import {DomainRepository} from '../src/domain/repository.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {beginTeamSnapRefresh,finishTeamSnapRefresh} from '../src/sources/teamsnap-refresh.js';
import {loadTeamGameCandidates,teamGameInstant} from '../src/domain/team-game-candidates.js';
const NOW=Date.parse('2026-10-13T00:00:00Z'),AT=new Date(NOW).toISOString(),KICK='2026-10-12T18:00:00.000Z';
const TS='teamsnap/account/101',GS='gotsport/public/201',LV='live/public/301';
export async function fixture({legacy=false,publicProvider='gotsport'}={}) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const sql of [...DOMAIN_SCHEMA,...SYNC_SCHEMA])sqlite.exec(sql);
  const reads=[],prepare=(sql,params=[])=>({bind(...p){return prepare(sql,p);},async all(){const results=sqlite.prepare(sql).all(...params).map(r=>({...r}));reads.push({sql,params,rows:results.length,bytes:Buffer.byteLength(JSON.stringify(results))});return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}};},async first(){return (await this.all()).results[0]??null;},async run(){return sqlite.prepare(sql).run(...params);}}),db={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const insert=(table,row)=>sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
  insert('domain_installation',{id:1,schema_version:1,created_at:AT});
  insert('provider_accounts',{id:'account',provider:'teamsnap',native_id:'11',name:'Owner'});
  insert('app_teams',{id:'team',name:'Us',timezone:'America/Los_Angeles',season_year:2026,created_at:AT});
  insert('team_seasons',{id:'season',app_team_id:'team',year:2026,start_day:'2026-06-01',end_day:'2027-06-01',start_at:'2026-06-01T07:00:00Z',end_at:'2027-06-01T07:00:00Z'});
  insert('team_projection_state',{team_season_id:'season',app_team_id:'team'});insert('team_read_state',{app_team_id:'team'});
  function source(id,provider,account=null){insert('source_teams',{id,provider,scope:account??'public',account_id:account,native_id:id.split('/').at(-1),name:'Team',name_authority:1,archived:0,evidence:'{}',provenance:'provider',content_hash:id,observed_at:AT});}
  source(TS,'teamsnap','account');source(GS,'gotsport');source(LV,'live');source('gotsport/public/202','gotsport');source('live/public/302','live');
  function connect(id,sourceId,account=null,{typed=!legacy}={}){insert('team_source_attachments',{id:'attachment-'+id,app_team_id:'team',team_season_id:'season',source_team_id:sourceId,account_id:account});if(typed){insert('team_source_connections',{id,app_team_id:'team',source_team_id:sourceId,account_id:account,scope_mode:'fixed_seasons',created_at:AT});insert('team_connection_seasons',{connection_id:id,team_season_id:'season',attachment_id:'attachment-'+id,basis:'fixed'});}}
  connect('ts',TS,'account');connect('pub',publicProvider==='live'?LV:GS);
  function event(id,{provider='teamsnap',start=KICK,own=provider==='teamsnap'?TS:provider==='gotsport'?GS:LV,account=provider==='teamsnap'?'account':null,canonical='canonical-'+id,opponent='Fresno Heat FC U11 Central',venue='Kellogg Zaher Sports Complex',evidence={},extra={}}={}) {
    const home=own,away=provider==='gotsport'?'gotsport/public/202':provider==='live'?'live/public/302':null;
    insert('source_events',{id,provider,scope:account??'public',account_id:account,native_id:id,starts_at:start,time_precision:start?'instant':'pending',type:'game',status:'SCHEDULED',conditional:0,home_source_team_id:home,away_source_team_id:away,home_label:'Us',away_label:opponent,title:'Game',venue,evidence:JSON.stringify({orientation_verified:true,opponent_id:'41',home_real:true,away_real:true,...evidence}),provenance:'provider',content_hash:'hash-'+id,observed_at:AT,...extra});
    insert('source_event_teams',{source_team_id:home,source_event_id:id,side:'home'});if(away)insert('source_event_teams',{source_team_id:away,source_event_id:id,side:'away'});
    if(canonical){if(!sqlite.prepare('SELECT 1 FROM events WHERE id=?').get(canonical))insert('events',{id:canonical,created_at:AT});insert('event_source_links',{source_event_id:id,event_id:canonical,reason:'source_identity',evidence:'{}'});}return canonical;
  }
  async function complete({recent=false}={}) {
    sqlite.exec('DELETE FROM sync_job_subscribers;DELETE FROM sync_jobs;DELETE FROM source_component_coverage');
    const n=sqlite.prepare("SELECT count(*) n FROM source_events WHERE provider='teamsnap' AND account_id='account'").get().n;
    for(const [root,provider,own] of [['ts','teamsnap',TS],['pub',publicProvider,publicProvider==='live'?LV:GS]]){
      const native=own.split('/').at(-1),account=provider==='teamsnap'?'account':null,args={team_id:native},components=provider==='teamsnap'?['events']:provider==='gotsport'?['profile','catalog','history']:['upcoming','membership'];
      for(const component of components){const id=provider+'-'+component,scope=provider==='teamsnap'?'teamsnap:'+native:native;let checkpoint={finished:true};
        if(provider==='teamsnap'){let refresh=(await beginTeamSnapRefresh({kind:'events',teamId:native,accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args,now:NOW-3600000})).refresh;checkpoint=finishTeamSnapRefresh(refresh,{count:n,pages:1,digest:'a'.repeat(64),total:n,now:NOW-3500000});if(recent){refresh=(await beginTeamSnapRefresh({kind:'events',teamId:native,accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args,cursor:checkpoint,now:NOW-1000})).refresh;checkpoint=finishTeamSnapRefresh(refresh,{count:n,pages:1,digest:'b'.repeat(64),total:n,now:NOW});}}
        insert('sync_jobs',{id,provider,account_scope:account??'public',account_id:account,authorization_generation:account?1:0,component,scope,resource_key:scope,args:JSON.stringify(args),checkpoint:JSON.stringify(checkpoint),scan_id:'scan-'+id,state:'ready',coverage:provider==='teamsnap'&&recent?'partial':'complete',ready_since:NOW,next_at:NOW+3600000,interval_ms:3600000,last_complete_at:NOW});
        insert('sync_job_subscribers',{job_id:id,kind:'team',demand_key:legacy?'attachment-'+root:'connection:'+root,app_team_id:'team',generation:1});
        insert('source_component_coverage',{id:'coverage-'+id,provider,scope,account_id:account,kind:component,complete:1,record_count:provider==='teamsnap'?n:0,scan_id:'older-semantic-equivalent-scan',observed_at:AT});
      }
    }
  }
  function bridge(){const endpoint=p=>'https://gotsportlive-api.azurewebsites.net/api/clubapi/'+p;const evidence={team_id:'201',live_team_id:'301',external_key:'201',external_source_name:'GotSport',external_source_id:6,default_season:true,item_id:'301',club:'51',season:'61',season_name:'2026',verified_at:AT,expires_at:new Date(NOW+3600000).toISOString(),observations:[{endpoint:endpoint('initclubteams'),params:{ClubID:'51'},status:200,hash:'a'.repeat(64),at:AT},{endpoint:endpoint('getteams'),params:{ClubID:'51',SeasonID:'61'},status:200,hash:'b'.repeat(64),at:AT}]};insert('source_team_links',{a:GS,b:LV,kind:'provider_external_key',evidence:JSON.stringify(evidence)});}
  const load=(options={})=>loadTeamGameCandidates(db,{teamId:'team',seasonId:'season',canonicalEventIds:['canonical-ts'],now:NOW,...options});
  return {sqlite,db,reads,insert,source,connect,event,complete,bridge,load,close:()=>sqlite.close()};
}

test('one-minute neighborhoods cross the 24-row projector boundary before label/venue filters',async()=>{
  const f=await fixture();try{const requested=[];for(let i=0;i<24;i++)requested.push(f.event('ts'+i,{start:new Date(Date.parse(KICK)+i*86400000).toISOString()}));f.event('rival',{provider:'gotsport',start:KICK,opponent:'Different Club',venue:'Other Venue'});f.event('rival2',{provider:'gotsport',start:new Date(Date.parse(KICK)+60000).toISOString(),opponent:'Still Different'});await f.complete();const result=await f.load({canonicalEventIds:requested});assert.equal(result.complete,true);assert.equal(result.metrics.rows,26);assert.ok(result.sourceSnapshot.events.some(e=>e.source_id==='rival2'));assert.ok(f.reads.every(r=>r.bytes<1_100_000));assert.ok(result.metrics.iterations<=3);}finally{f.close();}
});

test('reciprocal boundary is closed transitively, not just plus/minus one minute of seed',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport',start:'2026-10-12T18:00:59.999Z'});f.event('other-ts',{start:'2026-10-12T18:01:59.999Z',opponent:'Wrong Rival'});await f.complete();const result=await f.load();assert.equal(result.complete,true);assert.deepEqual(result.sourceSnapshot.events.map(e=>e.source_id),['other-ts','pub','ts']);assert.equal(result.sourceSnapshot.windows[0].to,'2026-10-12T18:02:59.999Z');}finally{f.close();}
});

test('private foreign account/team rows never enter entitled evidence',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});f.insert('provider_accounts',{id:'foreign',provider:'teamsnap',native_id:'22',name:'Foreign'});f.source('teamsnap/foreign/101','teamsnap','foreign');f.source('teamsnap/account/999','teamsnap','account');f.event('foreign-account',{own:'teamsnap/foreign/101',account:'foreign',opponent:'PRIVATE'});f.event('foreign-team',{own:'teamsnap/account/999',opponent:'PRIVATE'});await f.complete();const r=await f.load();assert.deepEqual(r.rawRows.map(e=>e.id),['pub','ts']);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}finally{f.close();}
});

test('legacy fixed attachment is explicit and a disabled typed root cannot fall back to it',async()=>{
  const f=await fixture({legacy:true});try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();let r=await f.load();assert.equal(r.complete,true);const ts=r.sourceSnapshot.events.find(e=>e.provider==='teamsnap');assert.equal(ts.connection_id,null);assert.equal(ts.attachment_id,'attachment-ts');assert.equal(ts.membership_generation,null);f.insert('team_source_connections',{id:'inactive',app_team_id:'team',source_team_id:TS,account_id:'account',scope_mode:'fixed_seasons',active:0,created_at:AT});r=await f.load();assert.equal(r.sourceSnapshot.events.some(e=>e.provider==='teamsnap'),false);assert.equal(r.complete,false);}finally{f.close();}
});

test('account login disconnect keeps saved rows readable and does not invent current fetch authority',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();f.sqlite.exec("UPDATE provider_accounts SET active=0,generation=2 WHERE id='account';UPDATE sync_jobs SET state='disabled' WHERE provider='teamsnap'");const r=await f.load();assert.equal(r.rawRows.length,2);assert.equal(r.sourceSnapshot.events.find(e=>e.provider==='teamsnap').account_generation,2);assert.equal(r.complete,true);}finally{f.close();}
});

test('verified public own-team bridge is bidirectional; unverified/expired bridge cannot grant scope',async()=>{
  for(const publicProvider of ['gotsport','live']){const f=await fixture({publicProvider});try{f.event('ts');f.event('pub',{provider:publicProvider==='gotsport'?'live':'gotsport'});await f.complete();f.bridge();let r=await f.load();assert.equal(r.rawRows.length,2);assert.equal(r.connectionSnapshot.aliases.length,1);assert.equal(r.connectionSnapshot.aliases[0].root_provider,publicProvider);assert.equal(r.sourceSnapshot.events.find(e=>e.source_id==='pub').source_team_id,publicProvider==='gotsport'?LV:GS);f.sqlite.exec("UPDATE source_team_links SET evidence=json_set(evidence,'$.expires_at','2026-10-12T00:00:00Z')");r=await f.load();assert.equal(r.connectionSnapshot.aliases.length,0);assert.equal(r.rawRows.length,1);}finally{f.close();}}
});

test('established public canonical peers and durable accepted off-window members are loaded',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport',start:'2025-08-01T17:00:00Z',canonical:'public-target'});f.event('peer',{provider:'live',start:'2025-08-01T17:00:31Z',canonical:'public-target'});f.bridge();await f.complete();const accepted={type:'team_game_association',teamId:'team',seasonId:'older-season',accepted_season_id:'season',association_id:'accepted-1',revision:1,decision:'accepted',event_id:'canonical-ts',source_ids:['ts','pub'],scope_refs:[]};const r=await f.load({acceptedAssociations:[accepted]});assert.deepEqual(r.rawRows.map(e=>e.id),['peer','pub','ts']);assert.deepEqual(r.canonicalGroups.find(g=>g.event_id==='public-target').source_ids,['peer','pub']);assert.equal(r.sourceSnapshot.windows.length,2);}finally{f.close();}
});

test('full coverage bit alone, incomplete recent work and changed receipt binding cannot prove uniqueness',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();assert.equal((await f.load()).complete,true);f.sqlite.exec("UPDATE sync_jobs SET checkpoint='{}' WHERE provider='teamsnap'");assert.equal((await f.load()).complete,false);await f.complete();const j=f.sqlite.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap'").get(),cp=JSON.parse(j.checkpoint),started=NOW-1000;const refresh=(await beginTeamSnapRefresh({kind:'events',teamId:'101',accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args:JSON.parse(j.args),cursor:cp,now:started})).refresh;f.sqlite.prepare("UPDATE sync_jobs SET state='running',checkpoint=? WHERE provider='teamsnap'").run(JSON.stringify({protocol:'teamsnap-pages-v1',refresh}));let r=await f.load();assert.equal(r.complete,false);assert.ok(r.sourceSnapshot.coverage.find(c=>c.provider==='teamsnap').reasons.includes('source_work_unresolved'));await f.complete({recent:true});r=await f.load();assert.equal(r.complete,true);f.sqlite.exec("UPDATE sync_jobs SET args=json_set(args,'$.team_id','999') WHERE provider='teamsnap'");assert.equal((await f.load()).complete,false);}finally{f.close();}
});

test('unresolved recent window does not invalidate a proven distant historical neighborhood',async()=>{
  const f=await fixture();try{f.event('ts',{start:'2024-08-01T12:00:00Z'});f.event('pub',{provider:'gotsport',start:'2024-08-01T12:00:00Z'});await f.complete();const j=f.sqlite.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap'").get(),refresh=(await beginTeamSnapRefresh({kind:'events',teamId:'101',accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args:JSON.parse(j.args),cursor:JSON.parse(j.checkpoint),now:NOW})).refresh;f.sqlite.prepare("UPDATE sync_jobs SET state='running',checkpoint=? WHERE provider='teamsnap'").run(JSON.stringify({protocol:'teamsnap-pages-v1',refresh}));assert.equal((await f.load()).complete,true);}finally{f.close();}
});

test('row/byte overflow is explicit and a bounded prefix never claims complete',async()=>{
  const f=await fixture();try{f.event('ts');for(let i=0;i<25;i++)f.event('pub-'+i,{provider:'gotsport'});await f.complete();let r=await f.load({limits:{events:24}});assert.equal(r.overflow,true);assert.equal(r.complete,false);assert.ok(r.metrics.rows<=24);f.sqlite.exec("UPDATE source_events SET evidence=json_object('notes',hex(randomblob(12000))) WHERE id='ts'");r=await f.load({limits:{eventBytes:1000}});assert.equal(r.overflow,true);assert.equal(r.complete,false);assert.equal(r.rawRows.length,0);}finally{f.close();}
});

test('receipt scan renewals change exact fence without changing normalized source facts',async()=>{
  const f=await fixture();try{f.event('ts',{evidence:{orientation_verified:false,reported_scores:{home:0,away:'2'},notes:'saved'}});f.event('pub',{provider:'gotsport'});await f.complete();const before=await f.load();f.sqlite.exec("UPDATE source_events SET observed_at='2026-10-13T00:00:01Z';UPDATE sync_jobs SET scan_id='new-scan',last_complete_at=last_complete_at+1");const after=await f.load();assert.notEqual(before.fence_hash,after.fence_hash);assert.deepEqual(before.sourceSnapshot.events,after.sourceSnapshot.events);const ts=after.sourceSnapshot.events.find(e=>e.provider==='teamsnap');assert.equal(ts.own_side,null);assert.equal(ts.home_score,0);assert.equal(ts.away_score,null);assert.equal(ts.result_final,false);}finally{f.close();}
});

test('timestamps and identity side mapping remain strict',async()=>{
  for(const value of [null,42,'2026-10-12T18:00:00','2026-02-30T18:00:00Z','2026-10-12T24:00:00Z','2026-10-12T18:00:00-00:00'])assert.equal(teamGameInstant(value),null);
  assert.equal(teamGameInstant('2026-10-12T11:00:00-07:00'),Date.parse(KICK));
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();f.sqlite.exec("UPDATE source_events SET starts_at='2026-02-30T18:00:00Z' WHERE id='ts'");const r=await f.load();assert.equal(r.complete,false);assert.ok(r.reasons.includes('candidate_instant_unproven'));}finally{f.close();}
});

test('public canonical peers cannot disappear when their current own-team bridge proof expires',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport',canonical:'public-group'});f.event('peer',{provider:'live',canonical:'public-group',extra:{status:'FINAL',home_score:9,away_score:0}});await f.complete();const r=await f.load();assert.deepEqual(r.rawRows.map(e=>e.id),['peer','pub','ts']);assert.equal(r.complete,false);assert.ok(r.reasons.includes('canonical_member_scope_unproven'));assert.equal(r.sourceSnapshot.events.find(e=>e.source_id==='peer').home_score,9);}finally{f.close();}
});

test('two valid roots choose one deterministic public scope without duplicating observations',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'live'});f.connect('live-root',LV);f.bridge();await f.complete();const r=await f.load();assert.equal(r.rawRows.filter(e=>e.id==='pub').length,1);assert.equal(r.sourceSnapshot.events.find(e=>e.source_id==='pub').connection_id,'live-root');assert.equal(r.connectionSnapshot.aliases.length,2);}finally{f.close();}
});

test('conflicting own identities and participant side rows cannot become a proved candidate',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});f.connect('other-own','gotsport/public/202');await f.complete();let r=await f.load();assert.equal(r.complete,false);assert.ok(r.reasons.includes('own_identity_ambiguous'));f.sqlite.exec("UPDATE team_source_connections SET active=0 WHERE id='other-own';UPDATE source_event_teams SET side='away' WHERE source_event_id='ts'");r=await f.load();assert.equal(r.complete,false);assert.ok(r.reasons.includes('candidate_participant_mismatch'));}finally{f.close();}
});

test('source/connection and current job receipt changes during acquisition invalidate the full result',async()=>{
  for(const mutate of ["UPDATE team_projection_state SET input_revision=input_revision+1","UPDATE sync_jobs SET scan_id='concurrent-receipt' WHERE provider='teamsnap'"]){const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();let contexts=0;const db={prepare(sql){const statement=f.db.prepare(sql);return {bind(...args){const bound=statement.bind(...args);return {async first(){if(sql.startsWith('SELECT t.id,t.timezone')&&++contexts===2)f.sqlite.exec(mutate);return bound.first();},all:()=>bound.all()};}};}};const r=await loadTeamGameCandidates(db,{teamId:'team',seasonId:'season',canonicalEventIds:['canonical-ts'],now:NOW});assert.equal(r.complete,false);assert.ok(r.reasons.includes('acquisition_fence_changed'));}finally{f.close();}}
});

test('public incomplete discovery is fenced even while saved component coverage remains complete',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();f.sqlite.exec("UPDATE sync_jobs SET state='running',checkpoint='{}' WHERE provider='gotsport' AND component='catalog'");const r=await f.load();assert.equal(r.complete,false);assert.ok(r.sourceSnapshot.coverage.find(c=>c.provider==='gotsport').reasons.includes('public_source_work_unresolved'));}finally{f.close();}
});

test('renewed public bridge observation clocks stay out of alias semantic identity',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});f.bridge();await f.complete();const before=await f.load();const p=JSON.parse(f.sqlite.prepare('SELECT evidence FROM source_team_links').get().evidence);p.verified_at='2026-10-13T00:00:01Z';p.expires_at='2026-10-13T02:00:00Z';p.observations.forEach(o=>o.at='2026-10-13T00:00:01Z');f.sqlite.prepare('UPDATE source_team_links SET evidence=?').run(JSON.stringify(p));const after=await f.load();assert.equal(before.connectionSnapshot.aliases[0].proof_id,after.connectionSnapshot.aliases[0].proof_id);assert.notEqual(before.fence_hash,after.fence_hash);}finally{f.close();}
});

test('foreign private member of a canonical target blocks inference without exposing its evidence',async()=>{
  const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport',canonical:'public-group'});f.insert('provider_accounts',{id:'foreign',provider:'teamsnap',native_id:'22',name:'Foreign'});f.source('teamsnap/foreign/101','teamsnap','foreign');f.event('private-member',{own:'teamsnap/foreign/101',account:'foreign',canonical:'public-group',opponent:'SECRET PRIVATE'});await f.complete();const r=await f.load();assert.equal(r.complete,false);assert.equal(r.canonicalGroups.find(g=>g.event_id==='public-group').established,false);assert.equal(JSON.stringify(r).includes('SECRET PRIVATE'),false);assert.equal(r.rawRows.some(e=>e.id==='private-member'),false);}finally{f.close();}
});

test('real full then recent refresh remains complete with job partial and no persisted recent coverage',async()=>{
 const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete({recent:true});
 const job=f.sqlite.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap'").get(),cp=JSON.parse(job.checkpoint);assert.equal(job.coverage,'partial');assert.equal(cp.refresh.active,null);assert.ok(cp.refresh.full);assert.ok(cp.refresh.recent);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM source_component_coverage WHERE kind='events_recent'").get().n,0);assert.equal((await f.load()).complete,true);
 for(const mutation of ["UPDATE sync_jobs SET checkpoint=json_set(checkpoint,'$.refresh.recent.digest','invalid') WHERE provider='teamsnap'","UPDATE sync_jobs SET checkpoint=json_set(checkpoint,'$.refresh.recent.total',999) WHERE provider='teamsnap'","UPDATE sync_jobs SET checkpoint=json_set(checkpoint,'$.refresh.recent.filters.started_after','2020-01-01T00:00:00Z') WHERE provider='teamsnap'","UPDATE sync_jobs SET coverage='complete' WHERE provider='teamsnap'"]){await f.complete({recent:true});f.sqlite.exec(mutation);assert.equal((await f.load()).complete,false,mutation);}
 }finally{f.close();}
});
test('partial whole-job coverage cannot invent a recent receipt after only a full traversal',async()=>{
 const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();f.sqlite.exec("UPDATE sync_jobs SET coverage='partial' WHERE provider='teamsnap'");assert.equal((await f.load()).complete,false);}finally{f.close();}
});

test('actual auxiliary and coordinator commit recent freshness without a component coverage row',async()=>{
 const f=await fixture();try{f.event('ts');f.event('pub',{provider:'gotsport'});await f.complete();
 const before=f.sqlite.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap'").get(),full=JSON.parse(before.checkpoint),args=JSON.parse(before.args),refresh=(await beginTeamSnapRefresh({kind:'events',teamId:'101',accountId:'account',authorizationGeneration:1,endpoint:'https://api.teamsnap.com/v3/events/search',args,cursor:full,now:NOW-1000})).refresh,completed=finishTeamSnapRefresh(refresh,{count:1,pages:1,digest:'b'.repeat(64),total:1,now:NOW});
 f.insert('account_source_teams',{account_id:'account',source_team_id:TS});
 f.sqlite.exec("UPDATE sync_jobs SET state='queued',next_at=0,lease_until=0 WHERE provider='teamsnap'");
 const repo=new DomainRepository(f.db),jobs=new JobCoordinator(f.db,{clock:()=>NOW,pageDelayMs:0});
 const result=await jobs.runOne(async({lease})=>({...await repo.buildSourcePage({accountId:'account',generation:1,provider:'teamsnap',component:'events',resourceKey:'teamsnap:101',scanId:lease.scan_id,checkpoint:completed,coverage:[{provider:'teamsnap',account_id:'account',scope:'teamsnap:101',kind:'events_recent',complete:true,count:1,observed_at:AT}]}),complete:true,checkpoint:completed,coverage:'partial'}));
 assert.equal(result.state,'ready',JSON.stringify(result));const saved=f.sqlite.prepare("SELECT * FROM sync_jobs WHERE provider='teamsnap'").get();assert.equal(saved.coverage,'partial');assert.deepEqual(JSON.parse(saved.checkpoint).refresh.full,full.refresh.full);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM source_component_coverage WHERE kind='events_recent'").get().n,0);assert.equal((await f.load()).complete,true);
 }finally{f.close();}
});


test('caller closure query ceiling fails closed on a transitive minute chain',async()=>{
 const f=await fixture();try{f.event('ts');for(let i=1;i<=8;i++)f.event('pub-'+i,{provider:'gotsport',start:new Date(Date.parse(KICK)+i*59000).toISOString()});await f.complete();
 const bounded=await f.load({limits:{closureQueries:2}});assert.equal(bounded.complete,false);assert.equal(bounded.overflow,true);assert.equal(bounded.metrics.iterations,2);assert.ok(bounded.reasons.includes('candidate_query_bound_exceeded'));assert.ok(bounded.rawRows.length<9);
 const full=await f.load();assert.equal(full.complete,true);assert.equal(full.rawRows.length,9);assert.ok(full.metrics.iterations>2);
 }finally{f.close();}
});
