import test from 'node:test';import assert from 'node:assert/strict';
import {schemaIdentity,validateRemoteDatabase} from '../scripts/release-check.mjs';
import {V731_OBJECTS,V731_FINGERPRINT,V731_PLAN_HASH} from '../src/application/schema-v731.js';
import {teamGameExpectedObjects} from '../src/application/team-game-schema-upgrade.js';
import {preservedFixture} from './team-game-release-fixture.mjs';

test('release admits only exact731, exact extension prefixes, and preserved complete extension',async()=>{
 const identity=await schemaIdentity(),f=preservedFixture(identity),domain={schema_version:1};
 assert.equal(validateRemoteDatabase(V731_OBJECTS.filter(o=>o.type==='table').map(o=>o.name),f.setup,domain,identity,{objects:V731_OBJECTS,journal:f.journal}).state,'upgrade_required');
 for(const cursor of [0,1,24,identity.expansion.length]){const p=preservedFixture(identity,{phase:'expanding',cursor});assert.equal(validateRemoteDatabase(p.names,p.setup,domain,identity,p).state,'upgrading');}
 assert.equal(validateRemoteDatabase(f.names,f.setup,domain,identity,f).state,'ready');
 for(const change of [{base_journal_hash:'b'.repeat(64)},{plan_hash:'unknown'},{writer_mode:'application',writer_epoch:'team-games-v1',permit_guard:0},{cursor:999},{origin:'fresh'}])assert.throws(()=>validateRemoteDatabase(f.names,f.setup,domain,identity,{...f,extension:{...f.extension,...change}}));
 const altered=f.objects.map(o=>o.name==='team_projection_runs'?{...o,sql:o.sql.replace('DEFAULT 0','DEFAULT 1')}:o);assert.throws(()=>validateRemoteDatabase(f.names,f.setup,domain,identity,{...f,objects:altered}),/physical schema/);
 assert.throws(()=>validateRemoteDatabase(f.names,{...f.setup,schema_fingerprint:identity.fingerprint},domain,identity,f),/fresh-origin/);
 assert.throws(()=>validateRemoteDatabase(f.names,f.setup,domain,identity,{...f,journal:{...f.journal,original_started_at:'wrong'}}),/preserved/);
});

test('release chains only exact714 and reviewed interrupted714 prefixes, never a fresh731 production replacement',async()=>{
 const {V714_OBJECTS,V714_FINGERPRINT}=await import('../src/application/schema-v714.js');
 const {schemaObjects,journalStatements,sealStatements}=await import('../src/application/schema-upgrade-v731.js');
 const identity=await schemaIdentity(),domain={schema_version:1},setup={schema_fingerprint:V714_FINGERPRINT,next_index:270,state:'ready',started_at:'start',completed_at:'complete'};
 const names=objects=>objects.filter(o=>o.type==='table').map(o=>o.name);
 assert.equal(validateRemoteDatabase(names(V714_OBJECTS),setup,domain,identity,{objects:V714_OBJECTS,journal:null}).route,'predecessor731');
 const journal={epoch:'team-connections-v1',from_fingerprint:V714_FINGERPRINT,to_fingerprint:V731_FINGERPRINT,plan_hash:V731_PLAN_HASH,phase:'sealing',cursor:'24',original_started_at:'start',original_completed_at:'complete',original_cursor:270,writer_mode:null,writer_epoch:null,permit_guard:null};
 const objects=schemaObjects([...V714_OBJECTS.map(o=>o.sql),...journalStatements,...sealStatements.slice(0,24)]);
 assert.equal(validateRemoteDatabase(names(objects),setup,domain,identity,{objects,journal}).state,'upgrading');
 for(const changed of [{plan_hash:'other'},{cursor:'25'},{writer_mode:'upgrade',writer_epoch:'team-connections-v1',permit_guard:0}])assert.throws(()=>validateRemoteDatabase(names(objects),setup,domain,identity,{objects,journal:{...journal,...changed}}));
 const f=preservedFixture(identity),fresh={...f.journal,from_fingerprint:null,plan_hash:'fresh',original_cursor:720,original_completed_at:null,started_at:f.setup.started_at};
 assert.throws(()=>validateRemoteDatabase(names(V731_OBJECTS),f.setup,domain,identity,{objects:V731_OBJECTS,journal:fresh}),/preserved/);
});

test('runtime predecessor dispatcher rejects extra objects, false cursors and open permits before writes',async()=>{
 const {TeamGameInstallation}=await import('../src/application/team-game-schema-upgrade.js');
 const {V714_OBJECTS,V714_FINGERPRINT}=await import('../src/application/schema-v714.js');
 const {schemaObjects,journalStatements,sealStatements}=await import('../src/application/schema-upgrade-v731.js');
 const model=new TeamGameInstallation({}),row={schema_fingerprint:V714_FINGERPRINT,next_index:270,state:'ready',started_at:'start',completed_at:'complete',domain_seed_count:1};
 const journal={epoch:'team-connections-v1',from_fingerprint:V714_FINGERPRINT,to_fingerprint:V731_FINGERPRINT,plan_hash:V731_PLAN_HASH,phase:'sealing',cursor:'24',original_started_at:'start',original_completed_at:'complete',original_cursor:270,writer_mode:null,writer_epoch:null,permit_guard:null};
 const objects=schemaObjects([...V714_OBJECTS.map(o=>o.sql),...journalStatements,...sealStatements.slice(0,24)]);
 let snapshot={row,journal,objects,names:objects.filter(o=>o.type==='table').map(o=>o.name),extension:null};model.snapshot=async()=>snapshot;
 assert.equal((await model.inspect()).state,'upgrading');
 for(const change of [{journal:{...journal,cursor:'25'}},{journal:{...journal,plan_hash:'foreign'}},{journal:{...journal,writer_mode:'upgrade',writer_epoch:'team-connections-v1',permit_guard:0}},{objects:[...objects,{type:'table',name:'foreign',sql:'CREATE TABLE foreign(id INTEGER)'}],names:[...snapshot.names,'foreign']}]){
  const saved=snapshot;snapshot={...saved,...change};await assert.rejects(model.inspect(),/does not match/);snapshot=saved;
 }
});
