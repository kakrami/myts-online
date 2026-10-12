import test from 'node:test';
import assert from 'node:assert/strict';
import {overview,trophies} from '../../web/ui-original/screens.js';
test('original Overview standing opens its exact competition standings',()=>{
 const html=overview({data:{standing:{competition_id:'cup-id',competition_name:'Saved Cup',position:2,points:12,played:6}}});
 assert.match(html,/data-action="competition"[^>]+data-id="cup-id"[^>]+data-tab="standings"/);
 assert.match(html,/Open competition standings/);
});
test('all-season trophy links retain the recorded season destination',()=>{
 const html=trophies({data:{items:[{id:'award',competition_id:'historic-cup',title:'Historical Cup',team_season_id:'historical-season',season_year:2023,place:1}]}});
 assert.match(html,/data-id="historic-cup"[^>]+data-team_season_id="historical-season"[^>]+data-tab="standings"/);
});
