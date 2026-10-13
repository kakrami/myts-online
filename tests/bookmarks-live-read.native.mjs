import test from 'node:test';
import assert from 'node:assert/strict';
import {freshHarness} from './fresh-harness.js';
import {DomainRepository} from '../src/domain/repository.js';
import {TeamFeatures} from '../src/application/team-features.js';
import {BudgetDB} from '../src/sync/budget.js';

test('native Bookmarks reads empty and saved-only teams through the owner route without changing originals',async()=>{
 const h=await freshHarness();try{
  await h.initialize();
  const team=await new DomainRepository(h.db).createTeam({name:'Synthetic bookmarks',seasonYear:2026});
  const budget=new BudgetDB(h.db,48),features=new TeamFeatures(budget,{owner:true});
  const page=await features.bookmarks(team.id);
  assert.equal(page.events.total,0);assert.deepEqual(page.events.items,[]);assert.ok(budget.used<=48);
  const response=await h.request('/api/bookmarks?'+new URLSearchParams({team_id:team.id,team_season_id:team.season_id}));
  assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.data.events.total,0);
  const saved=[['past','2026-01-01T18:00:00Z'],['future','2027-01-01T18:00:00Z']];
  for(const [id,starts_at] of saved)await h.db.batch([
   h.db.prepare('INSERT INTO events(id,created_at) VALUES(?,?)').bind(id,'2026-10-13T00:00:00Z'),
   h.db.prepare('INSERT INTO game_bookmarks(app_team_id,event_id,snapshot,saved_at) VALUES(?,?,?,?)').bind(team.id,id,JSON.stringify({id,app_team_id:team.id,team_season_id:team.season_id,type:'game',status:'SCHEDULED',starts_at,title:id}), '2026-10-13T00:00:00Z')
  ]);
  const before=(await h.db.prepare('SELECT * FROM game_bookmarks ORDER BY event_id').all()).results;
  let cursor=null;const ids=[];
  do{
   const r=await h.request('/api/bookmarks?'+new URLSearchParams({team_id:team.id,team_season_id:team.season_id,period:'all',limit:'1',...(cursor?{cursor}:{})}));
   assert.equal(r.status,200,JSON.stringify(r.data));const events=r.data.data.events;
   assert.equal(events.total,2);assert.equal(events.items.length,1);assert.equal(events.items[0].can_edit,false,'saved-only records do not gain live write authority');
   ids.push(events.items[0].id);cursor=events.next_cursor;assert.ok(ids.length<=2,'cursor must advance');
  }while(cursor);
  assert.deepEqual(ids,['past','future']);
  assert.deepEqual((await h.db.prepare('SELECT * FROM game_bookmarks ORDER BY event_id').all()).results,before,'reads preserve saved originals');

 }finally{await h.dispose();}
});
