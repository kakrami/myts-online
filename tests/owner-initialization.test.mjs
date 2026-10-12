import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {ownerHarness,ownerRecord,PASSWORD,ROTATED_PASSWORD} from './owner-initialization-harness.mjs';

function assertVerifier(owner,password){assert.equal(owner.password_iterations,600000);assert.equal(owner.password_hash,pbkdf2Sync(password,Buffer.from(owner.password_salt,'base64url'),600000,32,'sha256').toString('base64url'));}
function failure(response){assert.equal(response.status,503,JSON.stringify(response.data));assert.equal(response.data.error.code,'owner_initialization_failed');assert.equal(response.cookie,null);}

test('ready schema with no owner initializes under a simulated hosted PBKDF2 cap without changing installation identity',async()=>{
  const h=await ownerHarness();try{
    const probe=await h.request('/__cap-probe');assert.deepEqual(probe.data,{rejected:true,error_class:'NotSupportedError'});const callsBefore=(await h.diagnostics()).data;
    const before=await h.snapshot();assert.equal(before.setup.state,'ready');assert.equal(before.setup.next_index,270);assert.equal(before.objects.filter(o=>o.type==='table').length,122);
    assert.deepEqual(await h.counts(),{owner:0,vault:0,sessions:0});
    const pending=await h.request('/api/bootstrap');assert.equal(pending.status,200);assert.equal(pending.data.setup.state,'ready');assert.equal(pending.data.setup.owner_ready,false);
    const initialized=await h.initialize();assert.equal(initialized.status,200,JSON.stringify(initialized.data));assert.ok(initialized.cookie);
    assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:1});assert.deepEqual(await h.snapshot(),before);
    assertVerifier((await h.credentials()).owner,PASSWORD);
    const diagnostic=(await h.diagnostics()).data;assert.equal(diagnostic.deriveCalls,callsBefore.deriveCalls);assert.equal(diagnostic.pbkdfCalls,callsBefore.pbkdfCalls);assert.deepEqual(diagnostic.ownerBatches,[['security_installation','security_owner','security_sessions']]);
    const bootstrap=await h.request('/api/bootstrap');assert.equal(bootstrap.data.setup.owner_ready,true);assert.equal(bootstrap.data.session.role,'owner');
  }finally{await h.dispose();}
});

test('prehash and each statement failure leave no partial owner, vault or session and retry safely',async()=>{
  for(const fault of ['prehash','batch_0','batch_1','batch_2']){
    const h=await ownerHarness();try{
      const before=await h.snapshot(),failed=await h.initialize(PASSWORD,{headers:{'x-test-fault':fault}});failure(failed);
      assert.deepEqual(await h.counts(),{owner:0,vault:0,sessions:0});assert.deepEqual(await h.snapshot(),before);
      const logs=(await h.diagnostics()).data.logs;assert.ok(logs.length>0,'Unexpected failures must have a safe diagnostic.');
      const text=JSON.stringify(logs);assert.ok(!text.includes(PASSWORD));assert.ok(!text.includes('forbidden-private-value'));
      const diagnostic=JSON.parse(logs.at(-1)[0]);assert.deepEqual(Object.keys(diagnostic).sort(),['error_class','event','phase']);assert.equal(diagnostic.event,'owner_initialization_failed');assert.equal(diagnostic.phase,fault==='prehash'?'password-derivation':'owner-batch');
      const resumed=await h.initialize();assert.equal(resumed.status,200,JSON.stringify(resumed.data));assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:1});assert.deepEqual(await h.snapshot(),before);
    }finally{await h.dispose();}
  }
});

test('retry after the committed response is lost preserves the owner verifier and vault',async()=>{
  for(const fault of ['post_commit','lost_response']){
    const h=await ownerHarness();try{
      const before=await h.snapshot(),lost=await h.initialize(PASSWORD,{headers:{'x-test-fault':fault}});assert.equal(lost.status,503);assert.equal(lost.cookie,null);if(fault==='post_commit')failure(lost);
      assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:1});const credentials=await h.credentials();
      const resumed=await h.initialize();assert.equal(resumed.status,200);assert.ok(resumed.cookie);assert.deepEqual(await h.credentials(),credentials);assert.deepEqual(await h.snapshot(),before);
      assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:2});
    }finally{await h.dispose();}
  }
});

test('an existing vault survives owner initialization and a failed atomic batch',async()=>{
  const h=await ownerHarness();try{
    await h.seedVault();const before=await h.snapshot(),vault=(await h.credentials()).vault;
    failure(await h.initialize(PASSWORD,{headers:{'x-test-fault':'batch_2'}}));assert.deepEqual(await h.counts(),{owner:0,vault:1,sessions:0});assert.deepEqual((await h.credentials()).vault,vault);
    const initialized=await h.initialize();assert.equal(initialized.status,200);assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:1});assert.deepEqual((await h.credentials()).vault,vault);assert.deepEqual(await h.snapshot(),before);
  }finally{await h.dispose();}
});

test('existing owner resumes with the stored password and rejects a stale bootstrap password',async()=>{
  const h=await ownerHarness();try{
    await h.seedOwner(ROTATED_PASSWORD,{revision:2});const before=await h.snapshot(),credentials=await h.credentials();
    const stale=await h.initialize(PASSWORD);assert.equal(stale.status,401);assert.equal(stale.cookie,null);assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:0});
    const resumed=await h.initialize(ROTATED_PASSWORD);assert.equal(resumed.status,200);assert.ok(resumed.cookie);assert.deepEqual(await h.credentials(),credentials);assert.deepEqual(await h.snapshot(),before);
    assert.equal((await h.db.prepare('SELECT password_revision FROM security_sessions').first()).password_revision,2);assertVerifier(credentials.owner,ROTATED_PASSWORD);
  }finally{await h.dispose();}
});

test('two concurrent initializers authenticate their winning owner without duplicate records',async()=>{
  const h=await ownerHarness();try{
    const before=await h.snapshot(),results=await Promise.all([h.initialize(),h.initialize()]);for(const result of results){assert.equal(result.status,200,JSON.stringify(result.data));assert.ok(result.cookie);}
    assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:2});assert.deepEqual(await h.snapshot(),before);assertVerifier((await h.credentials()).owner,PASSWORD);
    for(const result of results){const bootstrap=await h.request('/api/bootstrap',{signed:false,headers:{cookie:result.cookie}});assert.equal(bootstrap.data.session.role,'owner');}
  }finally{await h.dispose();}
});

test('a concurrent winning password rotation prevents the stale initializer from receiving a session',async()=>{
  const h=await ownerHarness();try{
    const before=await h.snapshot(),winner={...ownerRecord(ROTATED_PASSWORD,{revision:2}),vaultId:randomUUID(),vaultKey:randomBytes(32).toString('base64url')};
    const stale=await h.initialize(PASSWORD,{headers:{'x-test-winner':JSON.stringify(winner)}});assert.equal(stale.status,401,JSON.stringify(stale.data));assert.equal(stale.cookie,null);
    assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:0});const credentials=await h.credentials();assertVerifier(credentials.owner,ROTATED_PASSWORD);assert.equal(credentials.vault.vault_key_id,winner.vaultId);assert.equal(credentials.vault.vault_key,winner.vaultKey);
    const resumed=await h.initialize(ROTATED_PASSWORD);assert.equal(resumed.status,200);assert.deepEqual(await h.credentials(),credentials);assert.deepEqual(await h.snapshot(),before);
  }finally{await h.dispose();}
});

test('a concurrent winning initialization issues a session only after verifying the winning stored password',async()=>{
  const h=await ownerHarness();try{
    const before=await h.snapshot(),winner={...ownerRecord(PASSWORD),vaultId:randomUUID(),vaultKey:randomBytes(32).toString('base64url')};
    const initialized=await h.initialize(PASSWORD,{headers:{'x-test-winner':JSON.stringify(winner)}});assert.equal(initialized.status,200,JSON.stringify(initialized.data));assert.ok(initialized.cookie);
    assert.deepEqual(await h.counts(),{owner:1,vault:1,sessions:1});const credentials=await h.credentials();assertVerifier(credentials.owner,PASSWORD);assert.equal(credentials.owner.last_password_change,winner.change);assert.equal(credentials.vault.vault_key_id,winner.vaultId);assert.equal(credentials.vault.vault_key,winner.vaultKey);
    assert.deepEqual(await h.snapshot(),before);assert.equal((await h.request('/api/bootstrap')).data.session.role,'owner');
  }finally{await h.dispose();}
});

test('native API login and password rotation retain encrypted credentials and revoke prior sessions under a simulated hosted cap',async()=>{
  const h=await ownerHarness();try{
    const initialized=await h.initialize();assert.equal(initialized.status,200);assert.ok(initialized.cookie);
    await h.db.prepare("INSERT INTO provider_accounts VALUES('credential-account','trace','native-test-owner','Synthetic provider',1,1)").run();
    const plaintext='synthetic-provider-authorization-preserve-across-password-rotation';
    const stored=await h.request('/__credential',{method:'POST',body:{credential:plaintext}});assert.equal(stored.status,200);assert.equal(stored.data.stored,true);
    const before=await h.snapshot(),vault=(await h.credentials()).vault,ciphertext=await h.db.prepare('SELECT * FROM security_account_credentials WHERE account_id=?').bind('credential-account').first();
    assert.ok(!ciphertext.ciphertext.includes(plaintext));assert.equal(JSON.parse(ciphertext.ciphertext).key_id,vault.vault_key_id);
    const logout=await h.request('/api/owner/logout',{method:'POST',body:{}});assert.equal(logout.status,200);
    const login=await h.request('/api/owner/login',{method:'POST',body:{password:PASSWORD}});assert.equal(login.status,200);assert.ok(login.cookie);
    assert.equal((await h.request('/__credential')).data.credential,plaintext);
    const rotated=await h.request('/api/owner/password',{method:'PUT',body:{current_password:PASSWORD,password:ROTATED_PASSWORD}});assert.equal(rotated.status,200,JSON.stringify(rotated.data));assert.ok(rotated.cookie);
    const oldSession=await h.request('/api/owner/session',{signed:false,headers:{cookie:login.cookie}});assert.equal(oldSession.status,200);assert.equal(oldSession.data.authenticated,false);
    const forbidden=await h.request('/api/teams',{signed:false,headers:{cookie:login.cookie}});assert.equal(forbidden.status,401);
    const stale=await h.initialize(PASSWORD);assert.equal(stale.status,401);assert.equal(stale.cookie,null);
    assertVerifier((await h.credentials()).owner,ROTATED_PASSWORD);assert.equal((await h.credentials()).owner.password_revision,2);
    assert.equal((await h.request('/__credential')).data.credential,plaintext);
    await h.request('/api/owner/logout',{method:'POST',body:{}});
    const signedIn=await h.request('/api/owner/login',{method:'POST',body:{password:ROTATED_PASSWORD}});assert.equal(signedIn.status,200);assert.ok(signedIn.cookie);
    assert.equal((await h.request('/__credential')).data.credential,plaintext);
    assert.deepEqual((await h.credentials()).vault,vault);assert.deepEqual(await h.db.prepare('SELECT * FROM security_account_credentials WHERE account_id=?').bind('credential-account').first(),ciphertext);assert.deepEqual(await h.snapshot(),before);
    assert.equal((await h.diagnostics()).data.pbkdfCalls,0);
  }finally{await h.dispose();}
});
