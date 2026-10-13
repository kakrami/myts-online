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
 const configured={...config,d1_databases:[{...config.d1_databases[0],database_id:'60f77502-33d4-41d6-80d4-1c5577ebba76'}]};assert.doesNotThrow(()=>validateConfiguration(configured,{deployment:true}));assert.throws(()=>validateConfiguration({...configured,d1_databases:[{...configured.d1_databases[0],database_id:'11111111-1111-4111-8111-111111111111'}]},{deployment:true}),/must preserve database/);
 assert.throws(()=>validateConfiguration({...configured,d1_databases:[{...configured.d1_databases[0],database_id:'c3585493-4ad5-44f2-9484-816a615ee633'}]},{deployment:true}),/previous application/);
 for(const mode of ['normal','maintenance'])assert.doesNotThrow(()=>validateConfiguration({...configured,vars:{MYTS_UPGRADE_MODE:mode}},{deployment:true}));
 assert.throws(()=>validateConfiguration({...configured,vars:{MYTS_UPGRADE_MODE:'resume-anything'}},{deployment:true}),/MYTS_UPGRADE_MODE/);
 assert.throws(()=>validateConfiguration({...configured,preview_urls:undefined}),/Preview URLs/);assert.throws(()=>validateConfiguration({...configured,preview_urls:true}),/Preview URLs/);
 assert.throws(()=>validateConfiguration({...configured,migrations:[]}),/without migrations/);assert.throws(()=>validateConfiguration({...configured,exports:{}}),/SQLite/);assert.throws(()=>validateConfiguration({...configured,name:'myts-review'}),/myts-v7/);
});
test('JSONC parsing preserves quoted URLs and ignores only comments/trailing commas',()=>{assert.deepEqual(parseJSONC('{"url":"https://example.test/a//b",// comment\n"x":[1,2,],/* ignored */}'),{url:'https://example.test/a//b',x:[1,2]});});
test('release validation requires the explicit reviewed 30000 ms owner verifier CPU budget',()=>{
 assert.equal(config.limits.cpu_ms,30000);
 for(const limits of [undefined,null,{}, {cpu_ms:10},{cpu_ms:29999},{cpu_ms:30001},{cpu_ms:300000},{cpu_ms:'30000'},{cpu_ms:NaN}]){
  for(const deployment of [false,true])assert.throws(()=>validateConfiguration({...config,limits},{deployment}),/limits\.cpu_ms to 30000 explicitly/);
 }
 assert.doesNotThrow(()=>validateConfiguration({...config,limits:{cpu_ms:30000}},{deployment:true}));
});
test('required-only graph excludes the old application and credentials are rejected without printing values',async()=>{
 const files=await requiredFiles();assert.ok(files.includes('worker.js'));assert.ok(files.includes('src/security/index.js'));assert.ok(files.includes('web/app/data-files.js'));assert.ok(files.includes('web/assets/report-font.ttf'));assert.ok(files.includes('web/ui-original/shell-template.html') === false);assert.ok(files.includes('docs/team-features-contract.md'));assert.ok(!files.includes('web/ui-original/index.html'));
 for(const old of ['worker.review.js','src/auth.js','src/jobs.js','src/providers/trace.js','web/index.html','node_modules','tests/harness.js'])assert.ok(!files.includes(old));
 assert.throws(()=>scanSecretText('sample.json','{"ADMIN_KEY":"'+'x'.repeat(40)+'"}'),/Potential embedded credential/);assert.doesNotThrow(()=>scanSecretText('safe.json','{"ADMIN_KEY":""}'));
});
test('deployment fingerprint matches native initialization but production rejects fresh-origin and foreign state',async()=>{
 const h=await freshHarness();try{
  await h.initialize();const identity=await schemaIdentity(),setup=await h.db.prepare('SELECT * FROM setup_state WHERE id=1').first(),domain=await h.db.prepare('SELECT schema_version FROM domain_installation WHERE id=1').first(),objects=(await h.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results,names=objects.filter(row=>row.type==='table').map(row=>row.name),journal=await h.db.prepare('SELECT * FROM installation_upgrade WHERE id=1').first(),details={objects,journal};
  assert.ok(identity.tables.has('catalog_state'));assert.ok(identity.tables.has('team_catalog_state'));assert.equal(setup.schema_fingerprint,identity.fingerprint);
  assert.throws(()=>validateRemoteDatabase(names,setup,domain,identity),/Physical schema metadata/);
  assert.throws(()=>validateRemoteDatabase(names,setup,domain,identity,details),/preserved 7.1.4 transition/);
  assert.equal(validateRemoteDatabase([],null,null,identity,{objects:[]}).state,'empty');
  assert.throws(()=>validateRemoteDatabase([...names,'old_application'],setup,domain,identity,details),/another build/);
  assert.throws(()=>validateRemoteDatabase(names,{...setup,schema_fingerprint:'different'},domain,identity,details),/another build/);
  assert.throws(()=>validateRemoteDatabase(names,setup,null,identity,details),/incomplete/);
  assert.throws(()=>validateRemoteDatabase(names.filter(name=>name!=='security_owner'),setup,domain,identity,details),/incomplete/);
  assert.throws(()=>validateRemoteDatabase(['setup_state'],{...setup,state:'initializing'},null,identity,details),/fully ready/);
 }finally{await h.dispose();}
});
test('required-only staging includes pinned npm install inputs and a full SHA-256 manifest',async()=>{
 const stage='tmp/install-check-'+crypto.randomUUID(),files=await requiredFiles(),manifest=await stageRelease(stage,files);assert.equal(manifest.files.length,files.length);assert.ok(manifest.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)));assert.ok(manifest.files.some(file=>file.path==='package-lock.json'));assert.equal(JSON.parse(await readFile(stage+'/package-lock.json','utf8')).packages['node_modules/wrangler'].version,'4.149.0');
});


test('production target admission requires completed preserved-origin extension, not fresh initialization',async()=>{
 const {preservedFixture}=await import('./team-game-release-fixture.mjs');const identity=await schemaIdentity(),fixture=preservedFixture(identity);
 assert.equal(validateRemoteDatabase(fixture.names,fixture.setup,{schema_version:1},identity,fixture).state,'ready');
 assert.throws(()=>validateRemoteDatabase(fixture.names,fixture.setup,{schema_version:1},identity,{...fixture,journal:{...fixture.journal,from_fingerprint:null,plan_hash:'fresh'}}),/preserved 7.1.4 transition/);
 assert.throws(()=>validateRemoteDatabase(fixture.names,{...fixture.setup,state:'initializing'},{schema_version:1},identity,fixture),/fully ready/);
});
