import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,AT,INPUT,HOME} from './fixtures/head-to-head-harness.mjs';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {JobCoordinator} from '../src/sync/coordinator.js';
import {PublicHistoryService} from '../src/application/public-history.js';
import {SyncError} from '../src/sync/errors.js';
function setup(){
 const f=fixture();for(const sql of SYNC_SCHEMA)f.sqlite.exec(sql);let now=Date.parse(AT),used=0;
 const prepared=(sql,params=[])=>({sql,params,bind(...p){return prepared(sql,p);},async all(){used++;const rows=f.sqlite.prepare(sql).all(...params);return {results:rows.map(r=>({...r})),meta:{changes:f.sqlite.prepare('SELECT changes() n').get().n}};},async first(){return(await this.all()).results[0]??null;},async run(){return this.all();}});
 const db={prepare:prepared,async batch(statements){f.sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.all());f.sqlite.exec('COMMIT');return out;}catch(e){f.sqlite.exec('ROLLBACK');throw e;}}};
 const event=f.event('current',{project:true});f.insert('source_event_teams',{source_team_id:HOME,source_event_id:event.source,side:'home'});
 f.insert('security_owner',{id:1,password_salt:'fixture',password_hash:'fixture',password_iterations:600000,password_revision:1,last_password_change:AT,created_at:now,updated_at:now});f.insert('security_sessions',{token_hash:'owner-session',password_revision:1,created_at:now,expires_at:now+86400000});
 const coordinator=new JobCoordinator(db,{publicHistory:true,clock:()=>now,pageDelayMs:0}),service=new PublicHistoryService(db,{principal:{role:'owner',session_id:'owner-session'},requesterKey:'owner',sync:{jobs:coordinator,wake:async()=>{}},now:()=>now});
 return {...f,db,event,coordinator,service,at:()=>now,setNow:v=>{now=v;},one:(sql,...p)=>({...f.sqlite.prepare(sql).get(...p)}),all:(sql,...p)=>f.sqlite.prepare(sql).all(...p).map(r=>({...r})),request:()=>service.request(INPUT,'current'),used:()=>used};
}
const child=(id='child')=>({provider:'gotsport',component:'event',scope:id,resourceKey:id,args:{event_id:id},subscriberMode:'inherit',recurring:false});
async function drain(f){for(let i=0;i<600;i++){const lease=await f.coordinator.claim();if(!lease)return;await f.coordinator.commit(lease,{statements:[],complete:true});}throw Error('bounded drain exceeded');}

test('a request joining an already claimed shared scan preserves native args, lease and checkpoint and owns actual child scans',async()=>{
 const f=setup();try{
  const spec={provider:'gotsport',component:'history',scope:'1',resourceKey:'1',args:{team_id:'1',club_name:'Native club',timezone:'UTC'},recurring:true};
  const id=await f.coordinator.enqueue(spec,[{kind:'team',key:'attached',teamId:'team'}]);f.sqlite.prepare("UPDATE sync_jobs SET checkpoint=? WHERE id=?").run('{"page":7}',id);
  const lease=await f.coordinator.claim(),before=f.one('SELECT * FROM sync_jobs WHERE id=?',id);await f.request();const after=f.one('SELECT * FROM sync_jobs WHERE id=?',id);
  for(const key of ['id','args','checkpoint','lease_token','lease_until','generation','scan_id','next_at'])assert.equal(after[key],before[key],key);
  const receipt=f.one('SELECT * FROM public_history_jobs WHERE job_id=?',id);assert.equal(receipt.accepted_scan_id,lease.scan_id);
  await f.coordinator.commit(lease,{statements:[],children:[child()],complete:true});assert.equal(f.one('SELECT state FROM public_history_jobs WHERE job_id=?',id).state,'complete');assert.equal(f.one("SELECT COUNT(*) n FROM public_history_jobs WHERE parent_job_id=?",id).n,1);
 }finally{f.close();}
});

test('failed atomic page rolls back facts, child jobs and receipts; same lease retry commits them together',async()=>{
 const f=setup();try{
  await f.request();const lease=await f.coordinator.claim(),source={sql:'UPDATE source_events SET venue=? WHERE id=? AND $FENCE',params:['Saved field',f.event.source]};
  await assert.rejects(f.coordinator.commit(lease,{statements:[source,{sql:'INSERT INTO domain_team_preconditions SELECT 1,1,0 WHERE $FENCE ON CONFLICT(id) DO UPDATE SET actual_input=excluded.actual_input',params:[]}],children:[child()],complete:true}));
  assert.equal(f.one('SELECT venue FROM source_events WHERE id=?',f.event.source).venue,'Field');assert.equal(f.one('SELECT COUNT(*) n FROM public_history_jobs').n,4);assert.equal(f.one('SELECT COUNT(*) n FROM sync_jobs').n,4);
  assert.equal((await f.coordinator.commit(lease,{statements:[source],children:[child()],complete:true})).committed,true);assert.equal(f.one('SELECT venue FROM source_events WHERE id=?',f.event.source).venue,'Saved field');assert.equal(f.one('SELECT COUNT(*) n FROM public_history_jobs').n,5);
 }finally{f.close();}
});

test('terminal failure is fenced atomically; completed receipts do not follow later shared recurrence',async()=>{
 const f=setup();try{
  await f.request();const lease=await f.coordinator.claim();const result=await f.coordinator.fail(lease,new SyncError('not_found','No fixture',{kind:'permanent'}));assert.equal(result.state,'failed');assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',lease.id).state,'failed');assert.equal(f.one('SELECT state FROM public_history_jobs WHERE job_id=?',lease.id).state,'failed');
  await drain(f);assert.equal((await f.service.status(INPUT,'current')).state,'partial');assert.equal(f.one('SELECT COUNT(*) n FROM sync_commit_fences').n,0);
 }finally{f.close();}
 const g=setup();try{await g.request();await drain(g);const saved=g.all('SELECT * FROM public_history_jobs ORDER BY job_id');g.sqlite.exec("UPDATE sync_jobs SET state='queued',scan_id='later-scan',recurring=1");assert.equal(await g.coordinator.claim(),null);await g.coordinator.recoverPublicHistory();assert.deepEqual(g.all('SELECT * FROM public_history_jobs ORDER BY job_id'),saved);}finally{g.close();}
});

test('missing or replaced scans settle as partial and expired or revoked anchors never claim or commit',async()=>{
 const f=setup();try{await f.request();const lease=await f.coordinator.claim();f.sqlite.prepare("UPDATE sync_jobs SET scan_id='replacement' WHERE id=?").run(lease.id);await f.coordinator.recoverPublicHistory();assert.equal(f.one('SELECT state FROM public_history_jobs WHERE job_id=?',lease.id).state,'superseded');await drain(f);assert.equal((await f.service.status(INPUT,'current')).state,'partial');}finally{f.close();}
 for(const change of ["UPDATE team_source_attachments SET active=0","UPDATE source_events SET conditional=1","UPDATE source_events SET provenance='file_import'"]){const g=setup();try{await g.request();const lease=await g.coordinator.claim();g.sqlite.exec(change);assert.equal((await g.coordinator.commit(lease,{statements:[],children:[child()],complete:true})).committed,false);assert.equal(await g.coordinator.claim(),null);await g.coordinator.recoverPublicHistory();assert.equal(g.one('SELECT state FROM public_history_demands').state,'revoked');}finally{g.close();}}
});

test('receipt caps preserve admitted work and never report a complete graph',async()=>{
 const f=setup();try{await f.request();f.sqlite.exec('UPDATE public_history_demands SET max_jobs=5');const lease=await f.coordinator.claim();await f.coordinator.commit(lease,{statements:[],children:Array.from({length:8},(_,i)=>child('child-'+i)),complete:true});assert.equal(f.one('SELECT COUNT(*) n FROM public_history_jobs').n,5);assert.equal(f.one('SELECT capped FROM public_history_demands').capped,1);assert.equal(f.one('SELECT COUNT(*) n FROM sync_jobs').n,5,'unadmitted edges cannot create or refresh jobs');await drain(f);assert.equal((await f.service.status(INPUT,'current')).state,'partial');assert.equal(f.one("SELECT COUNT(*) n FROM sync_jobs WHERE state='running'").n,0);}finally{f.close();}
});

test('default coordinator denies typed keys and enqueueMany internal preconditions are atomic',async()=>{
 const f=setup();try{await f.request();const d=f.one('SELECT * FROM public_history_demands'),c=new JobCoordinator(f.db,{clock:f.at});assert.equal(await c.claim(),null);await assert.rejects(c.enqueue(child('forged'),[{kind:'team',key:'public-history:'+d.id,teamId:'team',generation:1}]));const before=f.one('SELECT COUNT(*) n FROM sync_jobs').n;await assert.rejects(f.coordinator.enqueueMany([child('guarded')],[{kind:'team',key:'attached',teamId:'team'}],{precondition:{sql:'0',params:[]}}));assert.equal(f.one('SELECT COUNT(*) n FROM sync_jobs').n,before);}finally{f.close();}
});

test('fresh same-season bridge adopts proven Live scans independently; expired or wrong captured season cannot confer demand',async()=>{
 const {historyBridgeStatements}=await import('./fixtures/public-history-bridge-fixture.mjs');
 for(const [label,{reverse=false,wrong=false,expired=false}]of Object.entries({forward:{},reverse:{reverse:true},wrong:{wrong:true},expired:{expired:true}})){
  const f=setup();try{
   await f.db.batch(historyBridgeStatements(f.at(),{reverse}).map(s=>f.db.prepare(s.sql).bind(...s.params)));
   const spec={provider:'live',component:'membership',scope:'1',resourceKey:'1',args:{team_id:'1',proof:{season:wrong?'old':'33',season_name:'2026/27'}},recurring:false};
   const id=await f.coordinator.enqueue(spec,[{kind:'team',key:'connection:bridge-donor',teamId:'team',generation:1}]);f.sqlite.prepare("UPDATE sync_jobs SET state='ready',checkpoint='{"+'"saved":7'+"}',next_at=? WHERE id=?").run(f.at()+100000,id);
   const before=f.one('SELECT * FROM sync_jobs WHERE id=?',id);if(expired)f.setNow(f.at()+21601000);const request=await f.request();
   assert.equal(request.progress.total,wrong||expired?4:5,label);
   if(wrong||expired){assert.equal(f.one('SELECT state FROM sync_jobs WHERE id=?',id).state,'ready');assert.equal(f.one('SELECT scan_id FROM sync_jobs WHERE id=?',id).scan_id,before.scan_id);continue;}
   f.sqlite.exec("UPDATE team_source_connections SET active=0 WHERE id='bridge-donor'");const lease=await f.coordinator.claim();assert.equal(lease.id,id);assert.equal(lease.args.proof.season,'33');assert.notEqual(lease.scan_id,before.scan_id);
   f.setNow(f.at()+21601000);await f.coordinator.recoverPublicHistory();assert.equal(f.one('SELECT state FROM public_history_jobs WHERE job_id=?',id).state,'superseded');assert.equal(f.one('SELECT state FROM public_history_demands').state,'active');
   const next=await f.coordinator.claim();assert.notEqual(next?.id,id);assert.equal((await f.coordinator.commit(lease,{statements:[],complete:true})).committed,false);
  }finally{f.close();}
 }
});

test('division bridge admission needs the matching Live canonical counterpart season in both traversal orientations',async()=>{
 const {historyBridgeStatements,historyBridgeDivisionStatements}=await import('./fixtures/public-history-bridge-fixture.mjs');
 for(const reverse of [false,true]){
  const f=setup();try{
   await f.db.batch([...historyBridgeStatements(f.at(),{reverse}),...historyBridgeDivisionStatements(f.at())].map(s=>f.db.prepare(s.sql).bind(...s.params)));await f.request();const id=f.one('SELECT id FROM public_history_demands').id;
   f.sqlite.prepare('UPDATE team_source_attachments SET source_team_id=? WHERE id=\'attached\'').run(reverse?'live/public/1':HOME);
   f.sqlite.prepare("UPDATE public_history_demands SET anchor_kind='division',anchor_membership_id=?").run(reverse?'gotsport-bridge-membership':'live-bridge-membership');
   assert.equal((await f.service.saved(id)).proof_live,1);
   f.sqlite.prepare('UPDATE source_competitions SET evidence=? WHERE provider=\'live\'').run('{"season_id":"wrong","season_name":"2026/27"}');assert.equal((await f.service.saved(id)).proof_live,0,'membership provider does not bypass counterpart season');
   f.sqlite.prepare('UPDATE source_competitions SET evidence=? WHERE provider=\'live\'').run('{"season_id":"33","season_name":"wrong"}');assert.equal((await f.service.saved(id)).proof_live,0);
   f.sqlite.prepare('UPDATE source_competitions SET evidence=? WHERE provider=\'live\'').run('{"season_id":"33","season_name":"2026/27"}');assert.equal((await f.service.saved(id)).proof_live,1);
   f.sqlite.exec("UPDATE source_events SET local_day='2025-01-01'");assert.equal((await f.service.saved(id)).proof_live,0,'date move removes seasonal peer access');f.sqlite.exec("UPDATE source_events SET local_day='2026-09-01'");f.setNow(f.at()+21601000);assert.equal((await f.service.saved(id)).proof_live,0,'durable canonical division does not revive expired bridge');
  }finally{f.close();}
 }
});

test('adoption requires captured Live season even for proof-discovery jobs',async()=>{
 const {historyBridgeStatements}=await import('./fixtures/public-history-bridge-fixture.mjs');
 const f=setup();try{
  await f.db.batch(historyBridgeStatements(f.at()).map(s=>f.db.prepare(s.sql).bind(...s.params)));
  for(const component of ['resolve','participant'])for(const season of [null,'wrong']){
   const id=await f.coordinator.enqueue({provider:'live',component,scope:component+season,resourceKey:component+season,args:{team_id:'1',...(season?{proof:{season,season_name:'2026/27'}}:{})},recurring:false},[{kind:'team',key:'connection:bridge-donor',teamId:'team',generation:1}]);
   f.sqlite.prepare("UPDATE sync_jobs SET state='ready' WHERE id=?").run(id);
  }
  assert.equal((await f.request()).progress.total,4);assert.equal(f.one("SELECT count(*) n FROM sync_jobs WHERE provider='live' AND state='ready'").n,4);
 }finally{f.close();}
});

test('ordinary shared source save survives expired bridge while typed receipt becomes superseded',async()=>{
 const {historyBridgeStatements}=await import('./fixtures/public-history-bridge-fixture.mjs');
 const f=setup();try{
  await f.db.batch(historyBridgeStatements(f.at()).map(s=>f.db.prepare(s.sql).bind(...s.params)));
  const id=await f.coordinator.enqueue({provider:'live',component:'membership',scope:'1',resourceKey:'1',args:{team_id:'1',proof:{season:'33',season_name:'2026/27'}},recurring:false},[{kind:'team',key:'connection:bridge-donor',teamId:'team',generation:1}]);
  await f.request();const lease=await f.coordinator.claim();assert.equal(lease.id,id);
  f.sqlite.prepare("UPDATE source_team_links SET evidence=json_set(evidence,'$.expires_at',?)").run(new Date(f.at()-1).toISOString());
  assert.equal((await f.coordinator.commit(lease,{statements:[{sql:"UPDATE source_events SET venue='Ordinary saved field' WHERE id=? AND $FENCE",params:[f.event.source]}],children:[child('ordinary-only')],complete:true})).committed,true);
  assert.equal(f.one('SELECT venue FROM source_events').venue,'Ordinary saved field');assert.equal(f.one('SELECT state FROM public_history_jobs WHERE job_id=?',id).state,'superseded');assert.equal(f.one('SELECT count(*) n FROM public_history_jobs WHERE parent_job_id=?',id).n,0);
  await drain(f);assert.equal(f.one('SELECT state FROM public_history_demands').state,'partial');
 }finally{f.close();}
});

test('review: donor season cannot borrow the other participant bridge',async()=>{
 const {historyBridgeStatements,historyBridgeProof}=await import('./fixtures/public-history-bridge-fixture.mjs');
 const f=setup();try{
  await f.db.batch(historyBridgeStatements(f.at()).map(s=>f.db.prepare(s.sql).bind(...s.params)));
  const proof=historyBridgeProof(f.at()); Object.assign(proof,{team_id:'2',live_team_id:'2',item_id:'2',external_key:'2',club:'23',season:'old',season_name:'2025/26'});
  for(const o of proof.observations)o.params={ClubID:'23',SeasonID:'old'};
  f.sqlite.prepare("INSERT INTO source_team_links(a,b,kind,evidence) VALUES('gotsport/public/2','live/public/2','provider_external_key',?)").run(JSON.stringify(proof));
  f.sqlite.prepare("UPDATE source_teams SET evidence=? WHERE id='live/public/2'").run(JSON.stringify({proof}));
  const id=await f.coordinator.enqueue({provider:'live',component:'membership',scope:'1',resourceKey:'1',args:{team_id:'1',proof:{season:'old',season_name:'2025/26'}},recurring:false},[{kind:'team',key:'connection:bridge-donor',teamId:'team',generation:1}]);
  f.sqlite.prepare("UPDATE sync_jobs SET state='ready' WHERE id=?").run(id);
  const request=await f.request();
  assert.equal(request.progress.total,4,'Live1 donor must match Live1 fresh season33; Live2 old-season proof cannot authorize it');
  assert.equal(f.one('SELECT count(*) n FROM public_history_jobs WHERE job_id=?',id).n,0);
 }finally{f.close();}
});

test('generic adopted and generated Live descendants retain one participant after donor removal and parent completion',async()=>{
 const {historyBridgeStatements,historyBridgeProof}=await import('./fixtures/public-history-bridge-fixture.mjs');
 for(const generated of [false,true]){
  const f=setup();try{
   await f.db.batch(historyBridgeStatements(f.at()).map(s=>f.db.prepare(s.sql).bind(...s.params)));
   const other=historyBridgeProof(f.at());Object.assign(other,{team_id:'2',live_team_id:'2',item_id:'2',external_key:'2'});
   f.sqlite.prepare("INSERT INTO source_team_links(a,b,kind,evidence) VALUES('gotsport/public/2','live/public/2','provider_external_key',?)").run(JSON.stringify(other));f.sqlite.prepare("UPDATE source_teams SET evidence=? WHERE id='live/public/2'").run(JSON.stringify({proof:other}));
   const base={provider:'live',component:generated?'membership':'organizer',scope:'lineage',resourceKey:'lineage',args:{...(generated?{team_id:'1'}:{organizer:'700'}),proof:{season:'33',season_name:'2026/27'}},recurring:false};
   let id=await f.coordinator.enqueue(base,[{kind:'team',key:'connection:bridge-donor',teamId:'team',generation:1}]);await f.request();f.sqlite.exec("UPDATE team_source_connections SET active=0 WHERE id='bridge-donor'");
   assert.equal(f.one('SELECT root_source_team_id FROM public_history_jobs WHERE job_id=?',id).root_source_team_id,HOME);
   if(generated){const lease=await f.coordinator.claim();assert.equal(lease.id,id);await f.coordinator.commit(lease,{statements:[],children:[{...base,component:'organizer',scope:'grandchild',resourceKey:'grandchild',args:{organizer:'700',proof:{season:'33',season_name:'2026/27'}},subscriberMode:'inherit'}],complete:true});const child=f.one('SELECT job_id,root_source_team_id FROM public_history_jobs WHERE parent_job_id=?',id);assert.equal(child.root_source_team_id,HOME);assert.equal(f.one('SELECT state FROM public_history_jobs WHERE job_id=?',id).state,'complete');id=child.job_id;}
   f.sqlite.prepare("UPDATE source_team_links SET evidence=json_set(evidence,'$.expires_at',?) WHERE a=? OR b=?").run(new Date(f.at()-1).toISOString(),HOME,HOME);
   await f.coordinator.recoverPublicHistory();assert.equal(f.one('SELECT state FROM public_history_jobs WHERE job_id=?',id).state,'superseded');assert.notEqual((await f.coordinator.claim())?.id,id,'the other participant fresh same-season bridge cannot authorize this job');
  }finally{f.close();}
 }
});
