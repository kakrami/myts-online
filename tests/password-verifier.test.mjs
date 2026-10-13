import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Miniflare} from 'miniflare';

const qaRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url))+'/..');
const root=path.resolve(process.env.MYTS_TEST_PACKAGE_ROOT||qaRoot);
const {passwordVerifier,base64url}=await import(pathToFileURL(path.join(root,'src/security/crypto.js')));
const salt=Uint8Array.from({length:32},(_,i)=>i);
const vectors=[
  {password:'password',salt:new TextEncoder().encode('salt'),iterations:1},
  {password:'iteration-limit-comparison',salt,iterations:100_000},
  {password:'portable-owner-password-600k',salt,iterations:600_000},
  {password:'Mañana 東京 ⚽\u0000a\ud800',salt:new Uint8Array([0,255,128,3,0,9,11]),iterations:600_000},
  {password:'long-password-over-one-HMAC-block-🔐'.repeat(9),salt,iterations:600_000},
];
const expected=vector=>base64url(pbkdf2Sync(new TextEncoder().encode(vector.password),vector.salt,vector.iterations,32,'sha256'));

test('portable PBKDF2 matches independent Node SHA-256 vectors at 100k and 600k, Unicode and long inputs',async t=>{
  for(const vector of vectors){
    const started=performance.now(),cpu=process.cpuUsage();
    const result=await passwordVerifier(vector.password,base64url(vector.salt),vector.iterations);
    const wall=performance.now()-started,used=process.cpuUsage(cpu);
    assert.ok(result instanceof Uint8Array);assert.equal(result.length,32);
    assert.equal(base64url(result),expected(vector));
    if(vector.iterations===600_000)t.diagnostic(`Node 600,000 iterations: ${Math.round(wall)} ms wall, ${Math.round((used.user+used.system)/1000)} ms process CPU; password UTF-8 length ${new TextEncoder().encode(vector.password).length}.`);
  }
});

test('portable verifier rejects invalid work factors and malformed salts',async()=>{
  for(const iterations of [0,-1,1.5,NaN,Infinity,'600000'])
    await assert.rejects(passwordVerifier('test',base64url(salt),iterations));
  for(const invalid of ['','+bad','s a l t',null])
    await assert.rejects(passwordVerifier('test',invalid,600_000),TypeError);
});

test('vendored noble module digests match the pinned source manifest',async()=>{
  const vendor=path.join(root,'src/security/vendor/noble-hashes-1.7.1');
  const source=JSON.parse(await readFile(path.join(vendor,'SOURCE.json'),'utf8'));
  assert.equal(source.package,'@noble/hashes');assert.equal(source.version,'1.7.1');
  for(const [name,hashes] of Object.entries(source.files)){
    const content=await readFile(path.join(vendor,name));
    assert.equal(createHash('sha256').update(content).digest('hex'),hashes.vendored_sha256,name);
    const upstream=name==='utils.js'?Buffer.from(content.toString().replace("from './crypto.js'","from '@noble/hashes/crypto'")):content;
    assert.equal(createHash('sha256').update(upstream).digest('hex'),hashes.upstream_sha256,name+' upstream');
  }
  assert.match(await readFile(path.join(vendor,'LICENSE'),'utf8'),/MIT License/);
});

test('native workerd derives exact 600k hashes with native PBKDF2 forbidden and a verified 100k cap',async t=>{
  const modules={};
  for(const file of (await readdir(path.join(root,'src/security'),{recursive:true})).filter(f=>f.endsWith('.js'))){
    const module='src/security/'+file;
    modules[module]={type:'esm',contents:await readFile(path.join(root,module),'utf8')};
  }
  const entry='tests/fixtures/password-verifier-worker.js';
  modules[entry]={type:'esm',contents:await readFile(path.join(qaRoot,entry),'utf8')};
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'portable-verifier',compatibilityDate:'2026-09-09',manifest:{mainModule:entry,modulesRoot:root,modules},env:{},exports:{}}}]});
  try{
    await mf.ready;
    const probe=await(await mf.dispatchFetch('http://localhost',{method:'POST',body:JSON.stringify({probe_native_limit:true})})).json();
    assert.equal(probe.rejected,true);assert.equal(probe.name,'NotSupportedError');assert.match(probe.message,/100,000/);
    for(const vector of vectors.slice(1)){
      const started=performance.now();
      const response=await mf.dispatchFetch('http://localhost',{method:'POST',body:JSON.stringify({vectors:[{...vector,salt:base64url(vector.salt)}]})});
      assert.equal(response.status,200);const data=await response.json();const wall=performance.now()-started;
      assert.ok(wall<30_000,'Local derivation must fit the 30-second request budget.');
      assert.equal(data.native_pbkdf2_calls,0);assert.deepEqual(data.results,[{hash:expected(vector),length:32}]);
      if(vector.iterations===600_000)t.diagnostic(`Local workerd 600,000 iterations: ${Math.round(wall)} ms request wall, UTF-8 password length ${new TextEncoder().encode(vector.password).length}; hosted CPU/runtime remains unverified.`);
    }
  }finally{await mf.dispose();}
});
