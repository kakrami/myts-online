import test from 'node:test';
import assert from 'node:assert/strict';
import {traceNativeGame,traceProvider,traceStorage} from './fixtures/trace-analysis-native.mjs';

const args={team_id:'400',game_id:'4001',profile_hash:'synthetic-profile'};
async function run({change=()=>{},game=traceNativeGame(),limit=20,save=false,cursor={}}={}){
 const provider=traceProvider(game),store=save?traceStorage():null,seen=[];
 try{for(let i=0;i<limit;i++){
  change(game,i);const page=await provider.collect('game',args,cursor);if(store)await store.save(page);
  seen.push(page);cursor=page.checkpoint;if(page.complete)return {seen,cursor,provider,rows:store?.all('SELECT native_key,evidence FROM source_game_members ORDER BY native_key'),moments:store?.all('SELECT native_key,evidence FROM source_game_moments ORDER BY native_key')};
 }return {seen,cursor,provider};}finally{store?.close();}
}
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;

test('unused rich response decoration cannot restart a game at derived',async()=>{
 const result=await run({change:(game,i)=>{game.is_favorite=i%2===0;game.churned=i;game.locked=i%2===0;game.team_members.forEach(m=>{m.invite_status_update_time=String(i);m.resources={default_webp:'https://example.invalid/'+i};m.user.image_url='https://example.invalid/'+i;});}});
 assert.equal(result.seen.length,4);assert.equal(result.seen.at(-1).complete,true);
 assert.deepEqual(result.seen.slice(0,3).map(p=>p.checkpoint.stage),['members','moments','derived']);
 assert.equal(new Set(result.seen.slice(0,3).map(p=>p.checkpoint.digest)).size,1);
});
test('member/moment and object key reordering retain exact ordinal rows and child work',async()=>{
 const base=await run({save:true}),game=traceNativeGame();
 const changed=await run({game,save:true,change:(g,i)=>{if(i%2===0){g.team_members.reverse();g.moments.reverse();}for(const m of g.team_members)m.user=Object.fromEntries(Object.entries(m.user).reverse());g.home_team=Object.fromEntries(Object.entries(g.home_team).reverse());}});
 assert.equal(changed.seen.length,4);assert.deepEqual(changed.rows,base.rows);assert.deepEqual(changed.moments,base.moments);
 assert.deepEqual(stable(changed.seen.at(-1).children),stable(base.seen.at(-1).children));
});
test('old full-response checkpoint restarts exactly once and replaces all saved ordinals safely',async()=>{
 const old={profile_hash:args.profile_hash,digest:'a'.repeat(64),stage:'derived',offset:100};
 const r=await run({cursor:old,save:true});assert.equal(r.seen.length,4);assert.equal(r.seen[0].checkpoint.protocol,'trace-game-semantics-v1');assert.equal(r.seen[0].checkpoint.stage,'members');assert.equal(r.seen[0].checkpoint.changes,0);assert.equal(r.rows.length,7);assert.equal(r.moments.length,2);
});
test('genuine saved member and child-scope changes restart before terminal replacement',async t=>{
 const cases={member:g=>{g.team_members[0].join_time='2025-08-01T00:00:00Z';},player:g=>{g.team_members[0].is_active=false;},moment:g=>{g.moments[0].title='Changed title';},clip:g=>{g.moments[0].duration=121;},radar:g=>{g.moments[0].dynamic_jfile='https://go.traceup.com/test-assets/changed.json';},opponent_role:g=>{g.team_members.at(-1).gid='away-99';},access:g=>{g.access={allowed:false};},permissions:g=>{g.permissions={view:false};}};
 for(const [name,mutate]of Object.entries(cases))await t.test(name,async()=>{
  const r=await run({change:(g,i)=>{if(i===3)mutate(g);}});assert.equal(r.seen[3].checkpoint.stage,'members');assert.equal(r.seen[3].checkpoint.changes,1);assert.equal(r.seen[3].complete,false);assert.equal(r.seen.length,7);assert.equal(r.seen.at(-1).complete,true);
 });
});
test('continuous genuine change commits a bounded pause and never claims complete',async()=>{
 const r=await run({limit:4,change:(g,i)=>{g.moments[0].title='revision '+i;}});
 assert.equal(r.seen.length,4);assert.ok(r.seen.every(p=>!p.complete));assert.equal(r.cursor.stage,'header');assert.equal(r.cursor.changes,0);assert.ok(r.cursor.retry_at>Date.now()+14*60_000);
 const paused=r.seen.at(-1);assert.deepEqual(paused.records,{});assert.deepEqual(paused.children,[]);assert.deepEqual(paused.replacements,[]);assert.deepEqual(paused.coverage,[]);
 const calls=r.provider.calls.length;await assert.rejects(()=>r.provider.collect('game',args,r.cursor),e=>e.code==='source_changing'&&e.retryAfterMs>0);assert.equal(r.provider.calls.length,calls,'pause must not fetch even the account token');
 const resume={...r.cursor,retry_at:Date.now()-1};const p=await r.provider.collect('game',args,resume);assert.equal(p.checkpoint.stage,'members');assert.equal(p.checkpoint.changes,0);
});
test('semantic plan remains stable through lost commit replay and local member slicing',async()=>{
 const game=traceNativeGame({format:60}),p=traceProvider(game);let first=await p.collect('game',args,{});let cursor=first.checkpoint;
 const a=await p.collect('game',args,cursor);game.team_members.reverse();const b=await p.collect('game',args,cursor);
 assert.deepEqual(a.checkpoint,b.checkpoint);assert.deepEqual(a.records.trace_parts.map(v=>v.value),b.records.trace_parts.map(v=>v.value));assert.equal(a.records.trace_parts.length,60);
 const dense=traceNativeGame({format:120}),q=traceProvider(dense),header=await q.collect('game',args,{}),members=await q.collect('game',args,header.checkpoint);assert.equal(members.checkpoint.stage,'members');assert.equal(members.checkpoint.offset,100);dense.team_members.reverse();const last=await q.collect('game',args,members.checkpoint);assert.equal(last.records.trace_parts.length,20);assert.equal(last.checkpoint.stage,'moments');assert.equal(last.checkpoint.changes,0);
});

test('complete semantic tie keys stabilize duplicate GID/player and clip selectors without dropping multiplicity',async()=>{
 const make=()=>{const g=traceNativeGame();g.team_members.push({...g.team_members[0],position:'ALT',user:{...g.team_members[0].user,first_name:'Alternate'}});g.team_members.push({...g.team_members[1],gid:'home-duplicate'});g.moments.push({...g.moments[0],duration:122,dynamic_jfile:'https://go.traceup.com/test-assets/alternative.json'});return g;};
 const a=await run({game:make(),save:true}),b=await run({game:make(),save:true,change:g=>{g.team_members.reverse();g.moments.reverse();}});
 assert.equal(a.seen.length,4);assert.equal(b.seen.length,4);assert.equal(a.rows.length,9);assert.equal(b.rows.length,9);assert.equal(a.moments.length,3);assert.deepEqual(a.rows,b.rows);assert.deepEqual(a.moments,b.moments);assert.deepEqual(stable(a.seen.at(-1).children),stable(b.seen.at(-1).children));
});
test('foreign identity introduced in an already-passed moment rejects continuation before child admission',async()=>{
 const game=traceNativeGame(),p=traceProvider(game);let cp={};for(let i=0;i<3;i++)cp=(await p.collect('game',args,cp)).checkpoint;assert.equal(cp.stage,'derived');game.moments[0].game_id=9999;await assert.rejects(()=>p.collect('game',args,cp),e=>e.code==='contract_violation');
});
test('signed asset URL changes are retained as child semantics and force safe restart',async()=>{
 const r=await run({change:(g,i)=>{if(i===3)g.moments[0].dynamic_jfile+='?signature=new-value';}});assert.equal(r.seen[3].checkpoint.stage,'members');assert.equal(r.seen[3].checkpoint.changes,1);assert.ok(r.seen.at(-1).children.some(c=>c.kind==='radar'&&c.args.url.includes('signature=new-value')));
});

test('restricted game keeps saved metadata without validating or fetching child-only asset URLs',async()=>{
 const game=traceNativeGame();game.access={allowed:false};game.moments[0].dynamic_jfile='https://unsupported.invalid/private/radar.json';
 const r=await run({game,save:true});assert.equal(r.seen.length,4);assert.equal(r.seen.at(-1).complete,true);assert.deepEqual(r.seen.at(-1).children,[]);assert.equal(r.seen.at(-1).coverage[0].availability,'restricted');assert.equal(JSON.parse(r.moments.find(m=>JSON.parse(m.evidence).half===1).evidence).dynamic_jfile,game.moments[0].dynamic_jfile);
});
test('legacy migration rewrites actual prior-order rows and deletes stale ordinal tails only at completion',async()=>{
 const game=traceNativeGame(),base=await run({game:structuredClone(game),save:true}),provider=traceProvider(game),store=traceStorage();
 try{
  let cp={};for(let i=0;i<4;i++){const p=await provider.collect('game',args,cp);await store.save(p);cp=p.checkpoint;}
  const member=JSON.parse(base.rows.at(-1).evidence),moment=JSON.parse(base.moments.at(-1).evidence);
  const part=(name,value)=>({fixture_id:'trace:4001',team_id:'trace:400',account_id:'account',part:name,value:JSON.stringify(value),observed_at:new Date().toISOString()});
  await store.save({records:{trace_parts:[part('member:00000',member),part('member:00017',member),part('moment:0000000',moment),part('moment:0000050',moment)]},fixtures:[],coverage:[],replacements:[]});
  assert.equal(store.all('SELECT * FROM source_game_members').length,8);assert.equal(store.all('SELECT * FROM source_game_moments').length,3);
  cp={stage:'derived',offset:100,profile_hash:args.profile_hash,digest:'f'.repeat(64)};
  for(let i=0;i<4;i++){game.team_members.reverse();game.moments.reverse();const page=await provider.collect('game',args,cp);await store.save(page);cp=page.checkpoint;if(i<3){assert.equal(page.complete,false);assert.equal(store.all("SELECT * FROM source_game_members WHERE native_key='member:00017'").length,1);}else assert.equal(page.complete,true);}
  assert.deepEqual(store.all('SELECT native_key,evidence FROM source_game_members ORDER BY native_key'),base.rows);assert.deepEqual(store.all('SELECT native_key,evidence FROM source_game_moments ORDER BY native_key'),base.moments);
 }finally{store.close();}
});
test('a semantic change after one derived child page restarts without falsely completing the stale plan',async()=>{
 const game=traceNativeGame({format:25}),provider=traceProvider(game);let cp={};for(let i=0;i<4;i++){const page=await provider.collect('game',args,cp);cp=page.checkpoint;}assert.equal(cp.stage,'derived');assert.equal(cp.offset,100);
 game.team_members[0].jersey_number='99';const changed=await provider.collect('game',args,cp);assert.equal(changed.complete,false);assert.equal(changed.checkpoint.stage,'members');assert.equal(changed.checkpoint.changes,1);assert.deepEqual(changed.children,[]);assert.deepEqual(changed.replacements,[]);
 cp=changed.checkpoint;const childKeys=[];for(let i=0;i<10;i++){const p=await provider.collect('game',args,cp);childKeys.push(...p.children.map(c=>c.scope));if(p.complete){assert.equal(new Set(childKeys).size,childKeys.length);assert.equal(childKeys.length,133);return;}cp=p.checkpoint;}assert.fail('updated child plan did not complete');
});
