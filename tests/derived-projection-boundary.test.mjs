import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,until} from './team-game-projection.test.mjs';
import {buildProjectionPage} from '../src/domain/projector.js';
import {resolvePublishedGame} from '../src/domain/team-game-scope.js';

// The real collector-to-repository split is covered in derived-analysis-recovery
// and the native sustained-arrival gate. These isolate the two lifetime fences.
test('staged normalized members survive analysis clock and read-content output changes before publication',async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'publish'),members=f.rows('SELECT * FROM team_game_source_rows');
 assert.equal(members.length,2);
 f.sqlite.exec('INSERT INTO source_event_state SELECT id,1 FROM source_events WHERE 1 ON CONFLICT(source_event_id) DO UPDATE SET input_revision=input_revision+1;UPDATE domain_installation SET source_revision=source_revision+1;UPDATE team_read_state SET content_revision=content_revision+1');
 const page=await buildProjectionPage(f.repo,'team','season',cp);assert.equal(page.published,true);f.execute(page.statements);
 assert.equal(f.rows('SELECT published_run_id FROM team_projection_state')[0].published_run_id,cp.runId);
 assert.equal(f.rows("SELECT COUNT(*) n FROM team_projection_runs WHERE state='obsolete'")[0].n,0);
 assert.deepEqual(f.rows('SELECT * FROM team_game_source_rows'),members,'stored capture clocks remain their original exact observation');
 const scope=await resolvePublishedGame(f.db,'team','season','canonical-ts');assert.equal(scope.available,true);assert.equal(scope.evidence_changed,1,'analysis and owner readers retain the live input clock');
});

test('same-page read-content race still fails the exact atomic frame fence',async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'events'),page=await buildProjectionPage(f.repo,'team','season',cp);
 f.sqlite.exec('UPDATE team_read_state SET content_revision=content_revision+1');
 assert.throws(()=>f.execute(page.statements),/CHECK constraint/);assert.equal(f.rows('SELECT * FROM team_game_source_rows').length,0);
});

test('same-page source-clock race still fails normalized member capture',async t=>{
 const f=await fixture(t);await f.seed();const cp=await until(f,'events'),page=await buildProjectionPage(f.repo,'team','season',cp);
 f.sqlite.exec('INSERT INTO source_event_state SELECT id,1 FROM source_events');
 assert.throws(()=>f.execute(page.statements),/CHECK constraint|team_game/);assert.equal(f.rows('SELECT * FROM team_game_source_rows').length,0);
});
