import test from 'node:test';
import assert from 'node:assert/strict';
import {traceNativeGame,traceProvider,gamePages} from './fixtures/trace-analysis-native.mjs';
import {progressiveFixture} from './fixtures/progressive-root-service-fixture.mjs';

for(const base of ['/test-assets','test-assets','https://go.traceup.com/test-assets'])test(`provider radar base ${base} preserves original path resolution`,async()=>{
 const game=traceNativeGame();
 for(const clip of game.moments){clip.base_path=base;clip.dynamic_jfile=`radar${clip.half}.json`;}
 const pages=await gamePages(traceProvider(game));
 const jobs=pages.flatMap(p=>p.children).filter(c=>c.kind==='radar');
 assert.equal(jobs.length,2);
 for(const job of jobs)assert.equal(job.args.url,`https://go.traceup.com/test-assets/radar${job.args.half}.json`);
});
for(const base of ['https://outside.invalid/assets','http://go.traceup.com/assets','https://user:pass@go.traceup.com/assets'])test(`relative radar rejects unsafe base ${base}`,async()=>{
 const game=traceNativeGame();for(const clip of game.moments){clip.base_path=base;clip.dynamic_jfile='radar.json';}
 await assert.rejects(()=>gamePages(traceProvider(game)),e=>e.code==='contract_violation');
});
test('ordinary metadata changes preserve denied jobs and their saved checkpoint',async t=>{
 const f=progressiveFixture(t);
 const spec={component:'radar',stage:'analysis',scope:'trace:20:trace:10:1',resourceKey:'trace:20:trace:10:1',args:{game_id:'20',team_id:'10',half:1,url:'https://go.traceup.com/radar1.json'}};
 const id=await f.enqueue(spec);
 f.sqlite.prepare("UPDATE sync_jobs SET state='blocked',last_error_code='source_access_denied',failure_kind='blocked',attempts=1,failures=1 WHERE id=?").run(id);
 const saved=()=>f.one('SELECT state,generation,scan_id,checkpoint,attempts,failures,last_error_code,next_at FROM sync_jobs WHERE id=?',id),before=saved();
 await f.enqueue({...spec,args:{...spec.args,url:'https://go.traceup.com/test-assets/radar1.json'}});
 assert.deepEqual(saved(),before);
 assert.equal((await f.jobs.claim()),null);
 assert.deepEqual(saved(),before);
});
