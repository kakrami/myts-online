import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisFixture} from './fixtures/shared-analysis-fixture.mjs';
import {traceNativeGame,traceProvider,gamePages,traceStorage} from './fixtures/trace-analysis-native.mjs';

for(const missing of ['both','second'])test(`complete tracking with ${missing} radar windows missing preserves unknown match minutes`,async()=>{
 const f=analysisFixture();
 try{
  f.sqlite.exec("DELETE FROM source_trace_components WHERE kind='radar'"+(missing==='second'?' AND half=2':''));
  f.commit(await f.page());
  const match=f.all('SELECT * FROM match_analysis')[0],players=f.all('SELECT * FROM effective_player_matches');
  assert.equal(match.state,'incomplete');
  assert.equal(match.tracking_complete,1);
  for(const field of ['duration_minutes','assigned_minutes','capacity_minutes'])assert.equal(match[field],null);
  assert.ok(players.every(p=>p.tracking_state==='complete'&&p.minutes===null));
  assert.ok(players.every(p=>JSON.parse(p.evidence).tracking_complete===true));
  assert.equal((await f.page()).changed,false);
 }finally{f.close();}
});

for(const gap of ['coverage','clip','restricted'])test(`tracking completeness still requires ${gap} authority`,async()=>{
 const f=analysisFixture();
 try{
  f.sqlite.exec("DELETE FROM source_trace_components WHERE kind='radar'");
  if(gap==='coverage')f.sqlite.exec("UPDATE source_component_coverage SET complete=0 WHERE scope='trace:20:trace:10:g1:2'");
  if(gap==='clip')f.sqlite.exec("DELETE FROM source_trace_components WHERE kind='clip' AND half=2");
  if(gap==='restricted')f.sqlite.exec("UPDATE source_trace_components SET availability='restricted' WHERE kind='header'");
  f.commit(await f.page());
  assert.equal(f.all('SELECT tracking_complete FROM match_analysis')[0].tracking_complete,0);
  assert.notEqual(f.all("SELECT tracking_state FROM effective_player_matches WHERE player_id='player-001'")[0].tracking_state,'complete');
  assert.ok(f.all('SELECT minutes FROM effective_player_matches').every(p=>p.minutes===null));
 }finally{f.close();}
});

test('three saved tracking chunks resume at chunk 3 and require the fourth before complete coverage',async()=>{
 const provider=traceProvider(traceNativeGame()),store=traceStorage();
 try{
  const pages=await gamePages(provider);for(const page of pages)await store.save(page);
  const child=pages.flatMap(p=>p.children).find(j=>j.kind==='tracking');let cursor={};
  for(let i=0;i<3;i++){
   const page=await provider.collect('tracking',child.args,cursor);await store.save(page);cursor=page.checkpoint;
   assert.equal(page.complete,false);assert.equal(cursor.chunk,i+1);
  }
  assert.deepEqual(cursor,{chunk:3,chunk_pages:{0:1,1:1,2:1}});
  assert.equal(store.all('SELECT id FROM source_tracking_segments').length,3);
  const final=await provider.collect('tracking',child.args,cursor);await store.save(final);
  assert.equal(final.complete,true);assert.deepEqual(final.checkpoint,{finished:true});
  assert.equal(final.coverage[0].complete,true);
  assert.equal(store.all('SELECT id FROM source_tracking_segments').length,4);
 }finally{store.close();}
});
