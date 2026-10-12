import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {collectGotSport} from '../src/sources/gotsport.js';
import {membershipPeriodJoins} from '../src/domain/connection-periods.js';

test('GotSport history keeps verified schedule identity and bounded shared event arguments',async()=>{
  const matches=Array.from({length:50},(_,i)=>({id:100+i,event_id:10,event_name:'Cup',schedule_id:20,bracket_id:30,home_team_reg_id:40,away_team_reg_id:41,homeTeam:{team_id:1,full_name:'Our team'},awayTeam:{team_id:2,full_name:'Opponent'},match_date:'2026-07-01',matchTime:null,home_score:null,away_score:null}));
  const page=await collectGotSport({j:{provider:'gotsport',kind:'history',scope:'1'},args:{team_id:'1'},transport:{get:async()=>({value:{matches,pagination:{current_page:1,total_pages:1,total_entries:50}}})}});
  assert.equal(page.records.memberships.length,1);
  assert.equal(page.records.memberships[0].division_id,'gotsport:20');
  assert.deepEqual(JSON.parse(page.records.memberships[0].evidence),{event_id:'10',schedule_id:'20',bracket_id:'30'});
  const child=page.children.find(row=>row.kind==='event');assert.deepEqual(child.args.bracket_ids,['30']);assert.equal(child.args.memberships,undefined);assert.ok(JSON.stringify(child.args).length<300);
});

test('period joins require exact provider, account, competition and an unambiguous legacy bracket',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE source_teams(id TEXT PRIMARY KEY,provider TEXT,account_id TEXT);
      CREATE TABLE source_divisions(id TEXT PRIMARY KEY,provider TEXT,competition_id TEXT,evidence TEXT);
      CREATE TABLE source_competitions(id TEXT PRIMARY KEY,provider TEXT,account_id TEXT,starts_on TEXT);
      CREATE TABLE source_competition_memberships(id TEXT PRIMARY KEY,source_team_id TEXT,source_division_id TEXT,evidence TEXT);
      INSERT INTO source_teams VALUES('gotsport/public/1','gotsport',NULL);
      INSERT INTO source_competitions VALUES('gotsport/public/10','gotsport',NULL,'2026-07-01'),('gotsport/public/99','gotsport',NULL,'2023-07-01');
      INSERT INTO source_divisions VALUES('gotsport/public/20','gotsport','gotsport/public/10','{"brackets":[{"id":"30"}]}'),('gotsport/public/98','gotsport','gotsport/public/99','{"brackets":[{"id":"30"}]}');`);
    const insert=db.prepare('INSERT INTO source_competition_memberships VALUES(?,?,?,?)');
    insert.run('native','gotsport/public/1','gotsport/public/20',JSON.stringify({event_id:'10',schedule_id:'20'}));
    insert.run('legacy','gotsport/public/1','gotsport/public/bracket%3A30',JSON.stringify({event_id:'10',schedule_id:'20'}));
    insert.run('wrong-event','gotsport/public/1','gotsport/public/20',JSON.stringify({event_id:'99',schedule_id:'20'}));
    insert.run('wrong-schedule','gotsport/public/1','gotsport/public/bracket%3A30',JSON.stringify({event_id:'10',schedule_id:'999'}));
    const read=()=>db.prepare(`SELECT m.id,c.starts_on FROM source_competition_memberships m ${membershipPeriodJoins()} ORDER BY m.id`).all().map(row=>({...row}));
    assert.deepEqual(read(),[{id:'legacy',starts_on:'2026-07-01'},{id:'native',starts_on:'2026-07-01'}]);
    insert.run('ambiguous','gotsport/public/1','gotsport/public/bracket%3A30',JSON.stringify({event_id:'10'}));
    db.exec(`INSERT INTO source_divisions VALUES('gotsport/public/21','gotsport','gotsport/public/10','{"brackets":[{"id":"30"}]}');`);
    assert.deepEqual(read().map(row=>row.id),['legacy','native']);
    db.exec("UPDATE source_competitions SET account_id='private' WHERE id='gotsport/public/10'");assert.deepEqual(read(),[]);
    db.exec("UPDATE source_competitions SET account_id=NULL; UPDATE source_divisions SET provider='live'");assert.deepEqual(read(),[]);
  } finally {db.close();}
});
