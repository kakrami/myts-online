import test from 'node:test';
import assert from 'node:assert/strict';
import {materializationHarness} from './fixtures/connection-materialization-harness.mjs';
import {VERSION} from '../src/application/version.js';
const accepted=(response,status=200)=>{assert.equal(response.status,status,JSON.stringify(response.data));return response.data;};
const sha=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))).toString('hex');
const rows=async(h,sql,...params)=>(await h.db.prepare(sql).bind(...params).all()).results;
// The file upload and the production alarm/queue/recovery path run normally.
// Only the existing remote-provider fixture and successful alarm clocks are simulated.
test('native staged file import restores missing team history, reconciles closed-browser and reopens completed jobs',async()=>{
 const h=await materializationHarness();try{
  await h.initialize();await h.configure(c=>{c.gotsport[710900]={matches:[]};return c;});
  const resolved=accepted(await h.request('/api/sources/gotsport/resolve',{method:'POST',body:{url:'https://rankings.gotsport.com/teams/710900/upcoming-games'}})).teams[0];
  const root=accepted(await h.request('/api/connections',{method:'POST',body:{request_id:crypto.randomUUID(),source_team_id:resolved.id,new_team:{name:'Portable history target',timezone:'UTC',kind:'own'}}}),202);await h.settle();
  assert.equal((await rows(h,'SELECT id FROM team_seasons WHERE app_team_id=?',root.team_id)).length,0);
  const saved=await h.db.prepare('SELECT * FROM source_teams WHERE id=?').bind(resolved.id).first();delete saved.account_id;delete saved.content_hash;delete saved.content_revision;saved.account_ref=null;
  const event=(native_id,local_day)=>({id:'gotsport/public/'+native_id,provider:'gotsport',native_id,account_ref:null,home_source_team_id:resolved.id,away_source_team_id:null,starts_at:null,local_day,type:'game',status:'FINAL',conditional:0,home_score:2,away_score:1,home_label:'Portable team',away_label:'Opponent',title:'Saved match',venue:'Saved field',evidence:'{}',observed_at:new Date().toISOString()});
  const segments=[{section:'source_teams@public',rows:[saved]},{section:'source_events@public',rows:[event('import-old','2024-08-02'),event('import-new','2026-08-02'),event('import-pending',null)]}];
  const manifest={format:'myts-source-dataset',format_version:'7.2',release:VERSION,scope:{scope_kind:'connected_history',team_name:'Portable history source',source_teams:[{provider:'gotsport',native_id:'710900',account_ref:null}],accounts:[]},segments:await Promise.all(segments.map(async(segment,ordinal)=>({ordinal,name:'segments/'+String(ordinal).padStart(6,'0')+'.json',section:segment.section,row_count:segment.rows.length,sha256:await sha(segment)})))};
  const providerBefore=(await h.provider()).calls.length,created=accepted(await h.request('/api/data/imports',{method:'POST',body:{team_id:root.team_id,manifest}}),201);
  for(const [ordinal,payload]of segments.entries())accepted(await h.request(`/api/data/imports/${created.id}/segments/${ordinal}`,{method:'PUT',body:payload}));
  assert.equal((await rows(h,"SELECT id FROM source_events WHERE native_id LIKE 'import-%'")).length,0,'upload and staging do not write source facts');
  accepted(await h.request('/api/data/imports/'+created.id+'/commit',{method:'POST',body:{}}),202);
  // No client status route, manual source sync or direct materializer call wakes this work.
  await h.settle();
  assert.deepEqual((await rows(h,'SELECT year FROM team_seasons WHERE app_team_id=? ORDER BY year',root.team_id)).map(s=>s.year),[2024,2026]);
  assert.equal((await rows(h,'SELECT * FROM team_events WHERE app_team_id=?',root.team_id)).length,2);
  assert.equal((await rows(h,"SELECT * FROM connection_event_resolutions WHERE connection_id=? AND state='pending'",root.connection_id)).length,1);
  assert.equal((await h.provider()).calls.length,providerBefore,'file import grants no additional provider collection');
  const status=accepted(await h.request('/api/data/imports/'+created.id));assert.equal(status.state,'ready');assert.equal(status.reconciliation_pending,false);
  const recent=accepted(await h.request('/api/data/imports?team_id='+root.team_id));assert.equal(recent.items[0].id,created.id);assert.equal(recent.retention_hours,24);
  const exported=accepted(await h.request('/api/data/exports',{method:'POST',body:{team_id:root.team_id,kind:'dataset'}}),202);await h.settle();
  const file=accepted(await h.request('/api/data/exports/'+exported.id));assert.equal(file.state,'ready');assert.ok(file.byte_length>0);assert.equal(file.scope_kind,'connected_history');assert.equal(file.team_season_id,null);
  const reopened=accepted(await h.request('/api/data/exports?team_id='+root.team_id));assert.ok(reopened.items.some(item=>item.id===file.id&&item.download_url));
  assert.equal((await rows(h,'SELECT * FROM account_source_teams')).length,0);assert.equal((await rows(h,'SELECT * FROM source_team_links')).length,0);
  const budget=await h.budgets();assert.ok(budget.max<=50);assert.deepEqual(budget.violations,[]);console.log(JSON.stringify({portable_history_native:{source_fingerprint:h.sourceFingerprint,import_id:created.id,export_id:exported.id,years:[2024,2026],published_games:2,pending_games:1,provider_calls_added:(await h.provider()).calls.length-providerBefore,budget_max:budget.max,inspection_retries:h.inspectionRetries.length}}));
 }finally{await h.dispose();}
});
