import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,AT,INPUT,HOME,AWAY} from './fixtures/head-to-head-harness.mjs';
import {PUBLIC_HISTORY_SCHEMA} from '../src/application/public-history-schema.js';
import {PublicHistoryService} from '../src/application/public-history.js';

function setup({viewer=false}={}) {
 const f=fixture();for(const sql of PUBLIC_HISTORY_SCHEMA)f.sqlite.exec(sql);
 const current=f.event('current',{project:true});f.insert('source_event_teams',{source_team_id:HOME,source_event_id:current.source,side:'home'});
 const now=Date.parse(AT);f.insert('security_owner',{id:1,password_salt:'test',password_hash:'test',password_iterations:600000,password_revision:1,last_password_change:AT,created_at:now,updated_at:now});f.insert('security_sessions',{token_hash:'owner-session',password_revision:1,created_at:now,expires_at:now+86400000});
 if(viewer)f.insert('security_viewer_tokens',{token_hash:'viewer-hash',team_id:'team',categories:'["matches"]',created_at:now,expires_at:now+86400000,encrypted_token:'test'});
 const calls=[],sync={jobs:{async enqueuePublicHistory(specs,subscriber,{statements,requestedAt}){calls.push({specs,subscriber});await f.db.batch(statements);const demand=f.sqlite.prepare('SELECT * FROM public_history_demands WHERE id=? AND generation=?').get(subscriber.key.slice(15),subscriber.generation);assert.ok(demand,'request admitted at commit');for(const [index,spec]of specs.entries())f.insert('public_history_jobs',{demand_id:demand.id,generation:demand.generation,job_id:'job-'+index,accepted_scan_id:'actual-scan-'+index,root_source_team_id:'gotsport/public/'+spec.scope,provider:spec.provider,component:spec.component,accepted_at:requestedAt});}},async wake(){}};
 const principal=viewer?{role:'viewer',team_id:'team',categories:['matches']}:{role:'owner',session_id:'owner-session'};
 const service=new PublicHistoryService(f.db,{principal,requesterKey:viewer?'viewer-hash':'owner',sync,now:()=>now});
 return {...f,service,calls,current,now};
}

test('public history admits exactly the provider-proven native pair and keeps a one-shot sanitized status',async()=>{
 const f=setup();try{
  assert.equal((await f.service.status(INPUT,'current')).state,'idle');
  const result=await f.service.request(INPUT,'current');assert.equal(result.state,'active');assert.equal(result.progress.total,4);assert.equal(result.history_complete,false);
  assert.deepEqual(f.calls[0].specs.map(s=>[s.component,s.scope,s.recurring]),[['history','1',false],['catalog','1',false],['history','2',false],['catalog','2',false]]);
  assert.ok(f.calls[0].specs.every(s=>!s.accountId));assert.equal((await f.service.request(INPUT,'current',{force:true})).state,'active');assert.equal(f.calls.length,1,'cooldown does not enqueue duplicate scans');
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM team_source_connections').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_team_links').get().n,0);
  assert.ok(!JSON.stringify(result).includes('viewer-hash'));assert.ok(!JSON.stringify(result).includes('owner-session'));assert.ok(!JSON.stringify(result).includes('actual-scan'));
 }finally{f.close();}
});

test('imported, conditional, conflicted or exchanged native identities cannot authorize collection',async()=>{
 for(const sql of ["UPDATE source_events SET provenance='file_import'","UPDATE source_teams SET provenance='file_import' WHERE id='gotsport/public/2'","UPDATE source_events SET conditional=1","UPDATE team_event_rows SET identity_conflict=1","UPDATE source_events SET home_source_team_id=away_source_team_id"]){
  const f=setup();try{f.sqlite.exec(sql);const result=await f.service.request(INPUT,'current');assert.equal(result.supported,false,sql);assert.equal(f.calls.length,0);}finally{f.close();}
 }
});

test('request generation stays bound to the anchor and viewer revocation; saved public facts survive',async()=>{
 const f=setup({viewer:true});try{
  const requested=await f.service.request(INPUT,'current');assert.equal(requested.state,'active');
  f.sqlite.exec("UPDATE security_viewer_tokens SET revoked_at=1");assert.equal((await f.service.status(INPUT,'current')).supported,false);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM source_events').get().n,1);
  assert.equal((await f.service.request(INPUT,'current',{force:true})).supported,false);assert.equal(f.calls.length,1);
 }finally{f.close();}
 const g=setup();try{await g.service.request(INPUT,'current');g.sqlite.exec('UPDATE team_source_attachments SET generation=generation+1');const id=g.sqlite.prepare('SELECT id FROM public_history_demands').get().id;assert.equal(g.service.model(await g.service.saved(id)).state,'revoked');assert.equal(g.sqlite.prepare('SELECT count(*) n FROM source_events').get().n,1);}finally{g.close();}
});

test('owner admission is checked again inside the native request transaction',async()=>{
 const f=setup();try{f.sqlite.exec('UPDATE security_sessions SET revoked_at=1');await assert.rejects(f.service.request(INPUT,'current'));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM public_history_demands').get().n,0);}finally{f.close();}
});

test('a later visit renews an expired finite scan once, while reopening before expiry reuses it',async()=>{
 const f=setup();try{
  await f.service.request(INPUT,'current');f.sqlite.exec("UPDATE public_history_jobs SET state='complete'; UPDATE public_history_demands SET state='complete'");
  f.service.now=()=>f.now+120000;assert.equal((await f.service.request(INPUT,'current')).state,'complete');assert.equal(f.calls.length,1);
  const later=f.now+86400001;f.service.now=()=>later;f.sqlite.prepare('UPDATE security_sessions SET expires_at=?').run(later+86400000);
  const renewed=await f.service.request(INPUT,'current');assert.equal(renewed.state,'active');assert.equal(f.calls.length,2);assert.equal(f.calls[1].subscriber.generation,2);
  await f.service.request(INPUT,'current');assert.equal(f.calls.length,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM team_source_connections').get().n,0);
 }finally{f.close();}
});
