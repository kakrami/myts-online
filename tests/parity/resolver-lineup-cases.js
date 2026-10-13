const spatial=(x,y,extra={})=>({avg_x:x,avg_y:y,samples:500,display_orientation:'own_goal_left',grid_cols:2,grid_rows:2,grid:[1,2,3,4],tactical_left_is_top:true,...extra});
const player=(id,extra={})=>({id,eligible:true,appearance:true,started:true,minutes:25,gkMinutes:0,...extra});
export function runLineupCases({api:m,assert}) {
 const names=[],check=(name,run)=>{run();names.push(name);};
 check('original seven/nine formations retain distinct deterministic starters',()=>{for(const format of [7,9]){
 const bands=format===7?[.2,.2,.5,.5,.5,.8]:[.2,.2,.2,.5,.5,.5,.8,.8],ps=[player('keeper',{gkMinutes:25}),...bands.map((x,i)=>player('p'+i,{spatial:spatial(x,.2+i%3*.3)}))];
 const r=m.resolveLineup({format,half:1,players:ps});assert.equal(r.formation,format===7?'2-3-1':'3-3-2');assert.equal(r.slots.length,format);assert.equal(new Set(r.slots.map(s=>s.player_id)).size,format);
 assert.deepEqual(m.resolveLineup({format,half:1,players:[...ps].reverse()}),r);
 }});
 check('manual reported spatial season precedence keeps provenance',()=>{
 const r=m.resolveLineup({format:7,half:1,players:[player('manual',{manualPosition:'ST',reportedPosition:'GK',spatial:spatial(.2,.2),seasonPosition:'LB'}),player('reported',{reportedPosition:'LB',spatial:spatial(.8,.8),seasonPosition:'ST'}),player('inferred',{spatial:spatial(.5,.5),seasonPosition:'ST'}),player('season',{spatial:spatial(.2,.2,{display_orientation:'unknown'}),seasonPosition:'RM'})]});
 assert.deepEqual(Object.fromEntries(r.slots.filter(s=>s.player_id).map(s=>[s.player_id,s.provenance.kind])),{reported:'reported',inferred:'inferred',season:'season_default',manual:'manual'});
 });
 check('orientation samples grid validation retain broad uncertainty',()=>{
 assert.equal(m.inferSpatialPosition(spatial(.2,.2,{display_orientation:'unknown'})),null);assert.equal(m.inferSpatialPosition(spatial(.2,.2,{samples:29,grid:[0,0,0,0]})),null);
 const b=m.inferSpatialPosition(spatial(.2,.2,{tactical_left_is_top:false}));assert.deepEqual([b.label,b.side],['DEF',null]);assert.equal(m.inferSpatialPosition(spatial(.2,.2,{samples:null})).label,'LB');
 });
 check('keeper threshold does not create participation; empty slots stay null',()=>{
 assert.equal(m.isGoalkeeper(player('a',{minutes:10,gkMinutes:4.99})),false);assert.equal(m.isGoalkeeper(player('a',{minutes:10,gkMinutes:6})),true);
 const r=m.resolveLineup({format:7,half:1,players:[player('unknown',{appearance:null,gkMinutes:25}),player('no-start',{started:null,manualPosition:'GK'}),player('bench',{started:false,manualPosition:'GK'}),player('field',{manualPosition:'LB'})]});
 assert.equal(r.slots[0].player_id,null);assert.deepEqual(r.unknown,['no-start','unknown']);assert.deepEqual(r.bench,['bench']);assert.equal(r.slots.filter(s=>s.player_id!==null).length,1);
 });
 check('manual slots anchor; duplicate/keeper intent surfaces',()=>{
 const r=m.resolveLineup({format:7,half:1,players:[player('a',{manualPosition:'LB',manualSlot:2}),player('b',{manualPosition:'LB',manualSlot:2}),player('c',{manualPosition:'GK',manualSlot:3}),player('d',{manualSlot:4})]});
 assert.equal(r.slots[1].player_id,'a');assert.equal(r.slots[3].player_id,'d');assert.deepEqual(r.unknown,['b','c']);assert.deepEqual(r.warnings.map(w=>w.code),['invalid_manual_slot','duplicate_manual_slot']);
 const k=m.resolveLineup({format:7,half:1,players:[player('a',{manualPosition:'GK'}),player('b',{manualPosition:'GK'})]});assert.equal(k.slots.filter(s=>s.player_id!==null).length,1);assert.ok(k.warnings.some(w=>w.code==='multiple_starting_goalkeepers'));
 });
 check('complete adaptive shape and incomplete defaults',()=>{
 const ps=[player('gk',{manualPosition:'GK'}),...['LB','CB','RB','LM','RM','ST'].map((position,i)=>player('p'+i,{reportedPosition:position}))];
 assert.equal(m.resolveLineup({format:7,half:2,players:ps}).formation,'3-2-1');assert.equal(m.resolveLineup({format:7,half:2,players:ps.slice(0,-1)}).formation,'2-3-1');
 });
 check('unknown format invalid identities and purity',()=>{
 const ps=[player('a',{spatial:spatial(.2,.2)}),player('b',{started:false}),player('c',{eligible:null})],before=JSON.stringify(ps),r=m.resolveLineup({format:null,half:1,players:ps});
 assert.deepEqual(r.slots,[]);assert.deepEqual(r.unknown,['a','c']);assert.deepEqual(r.bench,['b']);assert.equal(JSON.stringify(ps),before);assert.throws(()=>m.resolveLineup({format:7,players:[player('a'),player('a')]}));
 });
 check('crowded lineup is bounded and oversubscription explicit',()=>{
 const r=m.resolveLineup({format:7,half:1,players:Array.from({length:9},(_,i)=>player('p'+i,{manualPosition:'CM'}))});
 assert.equal(r.slots.filter(s=>s.player_id!==null).length,6);assert.deepEqual(r.unknown,['p6','p7','p8']);assert.ok(r.warnings.some(w=>w.code==='too_many_evidenced_starters'));
 });
 return names;
}
