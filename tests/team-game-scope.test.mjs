import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedOwnerFixture} from './fixtures/published-game-owner-fixture.mjs';
import {publishedGameScopeCTE,resolvePublishedGame,gameScopeFenceSQL,assertPublishedGameCurrent,gameScopeRevision} from '../src/domain/team-game-scope.js';
const resolve=(f,ref='ts-event',opts)=>resolvePublishedGame(f.db,'team','season',ref,opts);

test('exact typed published scope maps every constituent to the same local target without global identity changes',async()=>{
 const f=publishedOwnerFixture();try{for(const ref of ['ts-event','public-event','ts-source','public-source']){const g=await resolve(f,ref);assert.equal(g.event_id,'public-event');assert.deepEqual(g.source_ids,['public-source','ts-source']);assert.equal(g.team_game_version,1);}assert.equal(await resolvePublishedGame(f.db,'foreign','foreign-season','public-event'),null);assert.equal(f.sql.prepare("SELECT canonical_id FROM canonical_event_ids WHERE input_id='ts-event'").get().canonical_id,'ts-event');}finally{f.close();}
});
test('account pause preserves local retained membership while each freshness change invalidates an observed fence',async()=>{
 const f=publishedOwnerFixture();try{const a=await resolve(f);f.sql.exec("UPDATE provider_accounts SET active=0,generation=2 WHERE id='account'");const b=await resolve(f);assert.equal(b.available,true);assert.equal(b.evidence_changed,1);await assert.rejects(assertPublishedGameCurrent(f.db,a),e=>e.code==='cursor_restart');f.sql.exec("UPDATE provider_accounts SET generation=3 WHERE id='account'");await assert.rejects(assertPublishedGameCurrent(f.db,b),e=>e.code==='cursor_restart');}finally{f.close();}
});
test('immutable normalized published rows cannot be replaced under an unchanged pointer',()=>{
 const f=publishedOwnerFixture();try{assert.throws(()=>f.sql.exec("DELETE FROM team_game_source_rows WHERE source_event_id='ts-source'"),/team_game_published_immutable/);assert.throws(()=>f.sql.exec("UPDATE team_game_publications SET proof_hash='bad'"),/team_game_published_immutable/);assert.throws(()=>f.sql.exec("UPDATE team_projection_runs SET team_game_version=0 WHERE id='run-team'"),/team_game_run_format_immutable/);}finally{f.close();}
});
test('legacy run uses exact cached native sources and typed roots prohibit attachment fallback',async()=>{
 const f=publishedOwnerFixture({normalized:false});try{assert.deepEqual((await resolve(f)).source_ids,['ts-source']);assert.equal(await resolve(f,'public-event'),null);f.sql.exec("UPDATE team_source_connections SET active=0 WHERE id='root-team-ts'");assert.equal((await resolve(f)).available,false);}finally{f.close();}
});
test('read fence permits pending projection only when exact observed membership and authority still agree',async()=>{
 const f=publishedOwnerFixture();try{const a=await resolve(f),read=gameScopeFenceSQL(a,{forWrite:false}),write=gameScopeFenceSQL(a);f.sql.exec("UPDATE team_projection_state SET input_revision=input_revision+1,pending=1 WHERE app_team_id='team'");assert.equal(f.sql.prepare('SELECT '+read.sql+' ok').get(...read.params).ok,1);assert.equal(f.sql.prepare('SELECT '+write.sql+' ok').get(...write.params).ok,0);f.sql.exec("UPDATE source_events SET content_hash='changed' WHERE id='ts-source'");assert.equal(f.sql.prepare('SELECT '+read.sql+' ok').get(...read.params).ok,0);}finally{f.close();}
});
test('bounded member overflow returns no partial source or private display scope',async()=>{
 const f=publishedOwnerFixture();try{const g=await resolve(f,'ts-event',{maxMembers:1});assert.equal(g.available,false);assert.equal(g.reason,'source_scope_bound');assert.equal(g.source_members,undefined);assert.equal(g.title,undefined);}finally{f.close();}
});
test('scope token can be computed directly from the same published list row and changes on split',async()=>{
 const f=publishedOwnerFixture();try{const g=await resolve(f),row=f.sql.prepare("SELECT * FROM team_event_rows WHERE run_id='run-team'").get();assert.equal(await gameScopeRevision(row),await gameScopeRevision(g));assert.notEqual(await gameScopeRevision({...row,source_ids:'["public-source"]'}),await gameScopeRevision(g));}finally{f.close();}
});
test('relation compiler rejects untrusted SQL identifiers',()=>{assert.throws(()=>publishedGameScopeCTE('events;DROP TABLE x'));assert.throws(()=>publishedGameScopeCTE('selection','a)'));});
test('legacy fixed attachment is explicit and a newly introduced inactive root invalidates its observed fence',async()=>{
 const f=publishedOwnerFixture({normalized:false});try{f.sql.exec("DELETE FROM team_connection_seasons WHERE connection_id='root-team-ts';DELETE FROM team_source_connections WHERE id='root-team-ts'");const before=await resolve(f);assert.equal(before.available,true);const fence=gameScopeFenceSQL(before,{forWrite:false});f.insert('team_source_connections',{id:'replacement-root',app_team_id:'team',source_team_id:'ts-team',account_id:'account',scope_mode:'fixed_seasons',active:0,created_at:'2026-10-01T16:00:00Z'});assert.equal(f.sql.prepare('SELECT '+fence.sql+' ok').get(...fence.params).ok,0);assert.equal((await resolve(f)).available,false);}finally{f.close();}
});
