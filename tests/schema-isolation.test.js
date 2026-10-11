import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {FreshInstallation} from '../src/application/fresh-install.js';
import {schemaIdentity, validateRemoteDatabase} from '../scripts/release-check.mjs';
import {DOMAIN_SCHEMA, DOMAIN_SCHEMA_VERSION} from '../src/domain/schema.js';
import {SECURITY_SCHEMA} from '../src/security/schema.js';
import {SYNC_SCHEMA} from '../src/sync/schema.js';
import {COACH_SCHEMA} from '../src/coaching/schema.js';
import {ANALYSIS_SCHEMA} from '../src/analysis/schema.js';
import {REPORT_SCHEMA} from '../src/reporting/schema.js';
import {DATA_FILE_SCHEMA} from '../src/reporting/data-schema.js';
import {TRACKING_CAPTURE_SCHEMA} from '../src/tracking/schema.js';
import {TEAM_FEATURE_SCHEMA} from '../src/application/team-features.js';
import {CATALOG_SCHEMA} from '../src/application/team-catalog.js';
import {AWARDS_SCHEMA} from '../src/read-model/feature-schema.js';

const old = JSON.parse(await readFile(new URL('./fixtures/deployed-7.0.1-schema.json',import.meta.url),'utf8'));
const schema=[...DOMAIN_SCHEMA,...SECURITY_SCHEMA,...SYNC_SCHEMA,...TEAM_FEATURE_SCHEMA,...CATALOG_SCHEMA,...COACH_SCHEMA,...ANALYSIS_SCHEMA,...REPORT_SCHEMA,...DATA_FILE_SCHEMA,...TRACKING_CAPTURE_SCHEMA,...AWARDS_SCHEMA];
const seed=[{sql:`INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,${DOMAIN_SCHEMA_VERSION},strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO NOTHING`,params:[]}];
const password='synthetic-owner-password-for-isolation-test';

async function existingDatabase() {
  const mf=new Miniflare({telemetry:{enabled:false},logRequests:false,workers:[{config:{name:'schema-isolation',compatibilityDate:'2026-09-09',manifest:{mainModule:'fixture.js',modulesRoot:process.cwd(),modules:{'fixture.js':{type:'esm',contents:'export default {fetch(){return new Response("fixture");}};'}}},env:{DB:{type:'d1',id:crypto.randomUUID()}},exports:{}}}]});
  try {
    await mf.ready;
    const db=await mf.getD1Database('DB','schema-isolation');
    await db.batch(old.schema.map(sql=>db.prepare(sql)));
    const at='2026-10-11T00:00:00.000Z';
    await db.batch([
      db.prepare('INSERT INTO installation VALUES(1,1,?)').bind(at),
      db.prepare('INSERT INTO spaces VALUES(?,?,?)').bind('space-1','My team',at),
      db.prepare('INSERT INTO teams(id,provider,native_id,name,observed_at) VALUES(?,?,?,?,?)').bind('trace:team-1','trace','team-1','Synthetic fixture team',at),
      db.prepare('INSERT INTO space_teams VALUES(?,?,?)').bind('space-1','trace:team-1','primary'),
      db.prepare('INSERT INTO players VALUES(?,?,?,?,?,?,?)').bind('trace:player-1','trace','player-1','Synthetic Player','15','{"source":"test"}',at),
      db.prepare('INSERT INTO team_players VALUES(?,?,1,?)').bind('trace:team-1','trace:player-1','scan-1'),
      db.prepare('INSERT INTO connections(id,space_id,provider,team_id,native_id,secret,options,created_at) VALUES(?,?,?,?,?,?,?,?)').bind('connection-1','space-1','trace','trace:team-1','account-1','synthetic-envelope-not-a-real-credential','{"timezone":"America/Los_Angeles"}',at),
      db.prepare('INSERT INTO jobs(id,provider,kind,scope,connection_id,args,cursor,next_at,state,scan_id,interval_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind('trace/game/game-1','trace','game','game-1','connection-1','{"game_id":"game-1"}','{"page":2}',1234,'queued','scan-1',21600000),
      db.prepare('INSERT INTO corrections VALUES(?,?,?,?,?,?,?)').bind('space-1','player_match','trace:player-1/game-1','2026','{"minutes":32,"position":"GK"}',3,at),
      db.prepare('INSERT INTO coach_profiles VALUES(?,?,?,?,?,?)').bind('space-1','trace:player-1','2026','{"endurance":4,"positions":{"GK":5}}',2,at),
      db.prepare('INSERT INTO coach_sessions VALUES(?,?,?,?,?)').bind('space-1','game-1','{"phase":"paused","elapsed_ms":60000,"lineup":["trace:player-1"]}',4,at),
    ]);
    return {db,dispose:()=>mf.dispose()};
  } catch(error) {await mf.dispose();throw error;}
}

async function snapshot(db) {
  const objects=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()).results;
  const tables=objects.filter(row=>row.type==='table').map(row=>row.name);
  const data={};
  for(const name of tables) data[name]=(await db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results;
  return {objects,data};
}

test('fresh 7.1 initialization refuses the exact deployed 34-table schema without changing any schema or saved rows',async()=>{
  const h=await existingDatabase();
  try {
    const before=await snapshot(h.db);
    assert.equal(Object.keys(before.data).length,old.table_count);
    assert.equal(before.data.players[0].name,'Synthetic Player');
    assert.equal(before.data.connections[0].secret,'synthetic-envelope-not-a-real-credential');
    assert.equal(before.data.jobs[0].cursor,'{"page":2}');
    assert.equal(before.data.coach_sessions[0].revision,4);
    const installation=new FreshInstallation(h.db,{schema,seed,bootstrapPassword:password});
    // Catch an accidentally omitted schema group in this assembled fixture.
    assert.equal(await installation.fingerprint,(await schemaIdentity()).fingerprint);
    await assert.rejects(installation.inspect(),error=>error.code==='fresh_database_required');
    await assert.rejects(installation.advance(password),error=>error.code==='fresh_database_required');
    assert.deepEqual(await snapshot(h.db),before);
    assert.equal((await h.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='setup_state'").first()).n,0);
  } finally {await h.dispose();}
});

test('release inspection rejects the real old schema shape even when its database ID is not available',async()=>{
  const h=await existingDatabase();
  try {
    const identity=await schemaIdentity();
    const names=(await h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()).results.map(row=>row.name);
    const before=await snapshot(h.db);
    assert.equal(names.length,34);
    // This validator receives schema metadata only. An anonymized, changed or
    // previously unknown UUID cannot make the old schema acceptable.
    assert.throws(()=>validateRemoteDatabase(names,null,null,identity),/another build|incomplete|schema/i);
    assert.deepEqual(await snapshot(h.db),before);
  } finally {await h.dispose();}
});
