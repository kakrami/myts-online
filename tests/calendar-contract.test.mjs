import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ReadRepository} from '../src/read-model/repository.js';
import {calendar,dateStrip} from '../web/ui-original/screens.js';

test('calendar DTO and original date controls preserve distinct game and practice dots',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 try {
  sqlite.exec(`CREATE TABLE app_teams(id TEXT,timezone TEXT);
   CREATE TABLE team_lifecycle(team_id TEXT);
   CREATE TABLE team_seasons(id TEXT,app_team_id TEXT,start_day TEXT,end_day TEXT,include_june INTEGER);
   CREATE TABLE team_read_state(app_team_id TEXT,content_revision INTEGER,status_revision INTEGER,pending INTEGER);
   CREATE TABLE team_projection_state(team_season_id TEXT,app_team_id TEXT,pending INTEGER);
   CREATE TABLE team_events(app_team_id TEXT,team_season_id TEXT,local_day TEXT,starts_at TEXT,type TEXT,status TEXT);
   INSERT INTO app_teams VALUES('team','America/Los_Angeles');
   INSERT INTO team_seasons VALUES('season','team','2026-06-01','2027-06-01',0);
   INSERT INTO team_read_state VALUES('team',3,4,0);
   INSERT INTO team_projection_state VALUES('season','team',0);
   INSERT INTO team_events VALUES('team','season','2026-10-12',NULL,'game','SCHEDULED'),('team','season','2026-10-12',NULL,'practice','SCHEDULED'),('team','season','2026-10-12',NULL,'practice','SCHEDULED'),('team','season','2026-10-13',NULL,'event','SCHEDULED'),('other','season','2026-10-12',NULL,'event','SCHEDULED');`);
  const db={prepare:sql=>({bind(...params){return {sql,params};}}),batch:async statements=>statements.map(({sql,params})=>({results:sqlite.prepare(sql).all(...params).map(row=>({...row}))}))};
  const repo=new ReadRepository(db,{owner:true},{now:()=>Date.parse('2026-10-12T12:00:00Z')});
  const result=await repo.calendar({team_id:'team',team_season_id:'season',type:'all',period:'all'},{from:'2026-10-01',to:'2026-11-01'});
  assert.deepEqual(result.data.days,[{day:'2026-10-12',total:3,kinds:['game','practice']},{day:'2026-10-13',total:1,kinds:['event']}]);
  const html=calendar({days:result.data.days});assert.match(html,/calendar-event-dot game/);assert.match(html,/calendar-event-dot practice/);
  assert.match(dateStrip(result.data.days,'2026-10-12'),/calendar-event-dot practice/);
  const games=await repo.calendar({team_id:'team',team_season_id:'season',type:'games',period:'all'},{from:'2026-10-01',to:'2026-11-01'});assert.deepEqual(games.data.days,[{day:'2026-10-12',total:1,kinds:['game']}]);
 } finally {sqlite.close();}
});
