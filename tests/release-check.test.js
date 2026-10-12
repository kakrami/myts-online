import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshHarness} from './fresh-harness.js';
import {parseJSONC,validateConfiguration,validateRemoteDatabase,schemaIdentity,requiredFiles,scanSecretText,stageRelease} from '../scripts/release-check.mjs';
let config;
test.before(async()=>{config=parseJSONC(await readFile('wrangler.jsonc','utf8'));});
test('configured release permits its fresh target but deployment rejects placeholders, old resources and incomplete bindings',()=>{
 assert.doesNotThrow(()=>validateConfiguration(config));assert.doesNotThrow(()=>validateConfiguration(config,{deployment:true}));
 const placeholder={...config,d1_databases:[{...config.d1_databases[0],database_id:'00000000-0000-0000-0000-000000000000'}]};assert.doesNotThrow(()=>validateConfiguration(placeholder));assert.throws(()=>validateConfiguration(placeholder,{deployment:true}),/placeholder/);
 const configured={...config,d1_databases:[{...config.d1_databases[0],database_id:'11111111-1111-4111-8111-111111111111'}]};assert.doesNotThrow(()=>validateConfiguration(configured,{deployment:true}));
 assert.throws(()=>validateConfiguration({...configured,d1_databases:[{...configured.d1_databases[0],database_id:'c3585493-4ad5-44f2-9484-816a615ee633'}]},{deployment:true}),/previous application/);
 assert.throws(()=>validateConfiguration({...configured,migrations:[]}),/without migrations/);assert.throws(()=>validateConfiguration({...configured,exports:{}}),/SQLite/);assert.throws(()=>validateConfiguration({...configured,name:'myts-review'}),/myts-v7/);
});
test('JSONC parsing preserves quoted URLs and ignores only comments/trailing commas',()=>{assert.deepEqual(parseJSONC('{"url":"https://example.test/a//b",// comment\n"x":[1,2,],/* ignored */}'),{url:'https://example.test/a//b',x:[1,2]});});
test('required-only graph excludes the old application and credentials are rejected without printing values',async()=>{
 const files=await requiredFiles();assert.ok(files.includes('worker.js'));assert.ok(files.includes('src/security/index.js'));assert.ok(files.includes('web/app/data-files.js'));assert.ok(files.includes('web/assets/report-font.ttf'));assert.ok(files.includes('web/ui-original/shell-template.html') === false);assert.ok(files.includes('docs/team-features-contract.md'));assert.ok(!files.includes('web/ui-original/index.html'));
 for(const old of ['worker.review.js','src/auth.js','src/jobs.js','src/providers/trace.js','web/index.html','node_modules','tests/harness.js'])assert.ok(!files.includes(old));
 assert.throws(()=>scanSecretText('sample.json','{"ADMIN_KEY":"'+'x'.repeat(40)+'"}'),/Potential embedded credential/);assert.doesNotThrow(()=>scanSecretText('safe.json','{"ADMIN_KEY":""}'));
});
test('deployment fingerprint matches actual native initialization and rejects foreign remote database shape',async()=>{
 const h=await freshHarness();try{await h.initialize();const identity=await schemaIdentity(),setup=await h.db.prepare('SELECT schema_fingerprint,state FROM setup_state WHERE id=1').first(),domain=await h.db.prepare('SELECT schema_version FROM domain_installation WHERE id=1').first(),names=(await h.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row=>row.name);assert.ok(identity.tables.has('catalog_state'));assert.ok(identity.tables.has('team_catalog_state'));assert.equal(setup.schema_fingerprint,identity.fingerprint);assert.equal(validateRemoteDatabase(names,setup,domain,identity).state,'ready');assert.equal(validateRemoteDatabase([],null,null,identity).state,'empty');assert.throws(()=>validateRemoteDatabase([...names,'old_application'],setup,domain,identity),/another build/);assert.throws(()=>validateRemoteDatabase(names,{...setup,schema_fingerprint:'different'},domain,identity),/another build/);assert.throws(()=>validateRemoteDatabase(names,setup,null,identity),/incomplete/);assert.throws(()=>validateRemoteDatabase(names.filter(name=>name!=='security_owner'),setup,domain,identity),/incomplete/);assert.equal(validateRemoteDatabase(['setup_state'],{...setup,state:'initializing'},null,identity).state,'initializing');}finally{await h.dispose();}
});
test('required-only staging includes pinned npm install inputs and a full SHA-256 manifest',async()=>{
 const stage='tmp/install-check-'+crypto.randomUUID(),files=await requiredFiles(),manifest=await stageRelease(stage,files);assert.equal(manifest.files.length,files.length);assert.ok(manifest.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)));assert.ok(manifest.files.some(file=>file.path==='package-lock.json'));assert.equal(JSON.parse(await readFile(stage+'/package-lock.json','utf8')).packages['node_modules/wrangler'].version,'4.149.0');
});
