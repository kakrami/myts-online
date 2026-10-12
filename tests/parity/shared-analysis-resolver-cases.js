import { loadOriginalEngine, loadOriginalUi, gameFixture, lineupFixture, spatialFixture } from './original-analysis-fixtures.js';

export function resolverFixture(format = 7) {
 const bands = format === 7 ? [.2,.2,.5,.5,.5,.8] : [.2,.2,.2,.5,.5,.5,.8,.8];
 return {
  context: {teamId:'T',seasonId:'S',eventId:'E',inputRevision:4,sourceRevision:3,commitSignature:'opaque-accepted-signature'},
  format:{reported:format},halves:[{id:1,start:0,end:1500,complete:true},{id:2,start:0,end:1500,complete:true}],
  players:Array.from({length:format},(_,i)=>({id:'P'+(i+1),eligible:true,spatial:{match:i?{...spatialFixture,grid:[...spatialFixture.grid],avg_x:bands[i-1],avg_y:(i-1)%3*.3+.2}:null}})),
  observations:[1,2].flatMap(half=>Array.from({length:format},(_,i)=>({
   id:'O'+half+'-'+(i+1),playerId:'P'+(i+1),half,side:'own',dummy:false,mapping:'verified',role:i?'field':'goalkeeper',
   segments:[[0,1500]],source:{id:'source-'+half}
  })))
 };
}
export function runSharedResolverCases({resolveMatchAnalysis,assert}) {
 const cases = [], check=(name,run)=>{run();cases.push(name);};
 const row=(r,id='P2')=>r.players.find(p=>p.id===id);
 const engine=loadOriginalEngine(), original=f=>engine.calculateGame('1',f.info,f.scans,f.truth,{},new Set());
 for (const format of [7,9]) check('original '+format+'v'+format+' complete capacity and formation',()=>{
  const r=resolveMatchAnalysis(resolverFixture(format)),old=original(gameFixture(format));
  assert.equal(r.format.value,format);assert.equal(r.durationSeconds,old.game_minutes*60);
  assert.equal(r.totals.assignedSeconds,old.resolved_player_minutes*60);assert.equal(r.totals.capacitySeconds,old.target_player_minutes*60);
  assert.equal(r.publishable,true);assert.equal(r.issues.filter(i=>i.severity==='error').length,0);
  assert.equal(r.lineups[1].formation,loadOriginalUi().matchLineupModel({format:format+'v'+format},lineupFixture(format)).formation);
 });
 for(const format of [7,9])check('original '+format+' tactical geometry exactly matches the source oracle',()=>{
  const r=resolveMatchAnalysis(resolverFixture(format)),old=loadOriginalUi().matchLineupModel({format:format+'v'+format},lineupFixture(format));
  const original=[...old.positions.values()].map(p=>({player_id:p.r.player==='GK'?'P1':'P'+(Number(p.r.player.slice(1))+2),...p.spot}));
  assert.deepEqual(r.lineups[1].positions.map(({basis,...p})=>p),original);
 });
 check('original manual pitch anchor survives without heatmap',()=>{
  const x=resolverFixture();x.players[1].manual={match:{position:'ST',slotX:50,slotY:9}};x.players[1].spatial={};
  const r=resolveMatchAnalysis(x),p=r.lineups[1].positions.find(p=>p.player_id==='P2');
  assert.equal(p.x,50);assert.equal(p.y,9);assert.equal(p.label,'ST');assert.equal(p.basis,'manual_pitch_anchor');
 });
 check('selective field correction preserves goalkeeper quantity and provenance',()=>{
  const x={context:{teamId:'T',seasonId:'S',eventId:'E'},format:{reported:7},halves:[{id:1,start:0,end:1500},{id:2,start:0,end:1500}],
   estimateCapacity:false,players:[{id:'P1',eligible:true,manual:{match:{fieldSeconds:1200}}}],
   observations:[1,2].map(half=>({id:'g'+half,playerId:'P1',half,side:'own',dummy:false,mapping:'verified',role:'goalkeeper',segments:[[0,300]],source:{id:'s'}}))};
  const r=resolveMatchAnalysis(x),p=row(r,'P1');assert.equal(p.totalSeconds.value,1800);assert.equal(p.fieldSeconds.value,1200);assert.equal(p.gkSeconds.value,600);
  assert.equal(p.totalSeconds.state,'mixed');assert.equal(p.fieldSeconds.state,'manual');assert.equal(p.gkSeconds.state,'inferred');assert.equal(r.publishable,true);
 });
 check('selective goalkeeper correction preserves field quantity and provenance',()=>{
  const x={context:{teamId:'T',seasonId:'S',eventId:'E'},format:{reported:7},halves:[{id:1,start:0,end:1500},{id:2,start:0,end:1500}],
   estimateCapacity:false,players:[{id:'P1',eligible:true,manual:{match:{gkSeconds:1200}}}],
   observations:[1,2].map(half=>({id:'f'+half,playerId:'P1',half,side:'own',dummy:false,mapping:'verified',role:'field',segments:[[0,300]],source:{id:'s'}}))};
  const r=resolveMatchAnalysis(x),p=row(r,'P1');assert.equal(p.totalSeconds.value,1800);assert.equal(p.fieldSeconds.value,600);assert.equal(p.gkSeconds.value,1200);
  assert.equal(p.fieldSeconds.state,'inferred');assert.equal(p.gkSeconds.state,'manual');assert.equal(r.publishable,true);
 });
 check('explicit zero goalkeeper quantity does not invent whole participation',()=>{
  const x=resolverFixture();x.observations=x.observations.filter(o=>o.playerId!=='P2');x.players[1].manual={match:{gkSeconds:0}};
  const p=row(resolveMatchAnalysis(x));assert.equal(p.totalSeconds.value,null);assert.equal(p.gkSeconds.value,0);assert.equal(p.gkSeconds.state,'manual');assert.equal(p.appearance.value,null);
 });
 check('original half-time goalkeeper swap conserves roles',()=>{
  const x=resolverFixture(); for(const o of x.observations.filter(o=>o.half===2)){
   if(o.playerId==='P1')o.role='field';if(o.playerId==='P2')o.role='goalkeeper';
  }
  const r=resolveMatchAnalysis(x);
  for(const id of ['P1','P2']){assert.equal(row(r,id).minutes.value,50);assert.equal(row(r,id).fieldMinutes.value,25);assert.equal(row(r,id).gkMinutes.value,25);}
  assert.equal(r.publishable,true);
 });
 check('original sparse minutes retain direct and estimated portions',()=>{
  const x=resolverFixture();for(const o of x.observations.filter(o=>o.playerId==='P2'))o.segments=[[0,300]];
  const r=resolveMatchAnalysis(x),p=row(r);assert.equal(p.minutes.value,50);assert.equal(p.observedSeconds,600);assert.equal(p.estimatedSeconds,2400);
  assert.equal(p.minutes.state,'estimated');assert.equal(r.publishable,true);
 });
 check('original explicit full-field halves preserve direct tracking',()=>{
  const x=resolverFixture();for(const o of x.observations.filter(o=>o.playerId==='P2'))o.segments=[[0,300]];
  x.players[1].manual={halves:{1:{fieldSeconds:1500,role:'field'},2:{fieldSeconds:1500,role:'field'}}};
  const p=row(resolveMatchAnalysis(x));assert.equal(p.minutes.value,50);assert.equal(p.observedSeconds,600);assert.equal(p.estimatedSeconds,0);assert.equal(p.minutes.state,'manual');
 });
 check('original unavailable participation differs from DNP zero',()=>{
  const x=resolverFixture();x.observations=x.observations.filter(o=>o.playerId!=='P2');
  let p=row(resolveMatchAnalysis(x));assert.equal(p.minutes.value,null);assert.equal(p.appearance.value,null);
  x.players[1].manual={match:{appearance:false}};p=row(resolveMatchAnalysis(x));assert.equal(p.minutes.value,0);assert.equal(p.appearance.value,false);
 });
 check('original dummy and opponent streams never add named capacity',()=>{
  const x=resolverFixture();for(const half of [1,2])for(const [side,dummy,id] of [['opponent',false,'away'],['own',true,'dummy']])
   x.observations.push({id:id+half,playerId:'P2',half,side,dummy,mapping:'verified',role:'field',segments:[[0,1500]],source:{id:'s'}});
  const r=resolveMatchAnalysis(x);assert.equal(r.totals.assignedSeconds,21000);assert.equal(r.unassigned.length,4);assert.equal(r.players.length,7);
 });
 check('original half-window clipping merges duplicate streams',()=>{
  const x=resolverFixture();for(const h of x.halves){h.start=120;h.end=1620;}for(const o of x.observations)o.segments=[[0,1000],[500,2000]];
  const r=resolveMatchAnalysis(x);assert.equal(row(r).minutes.value,50);assert.equal(row(r).observedSeconds,3000);assert.equal(r.publishable,true);
 });
 check('match position correction wins with or without heatmap',()=>{
  const x=resolverFixture();x.players[1].manual={match:{position:'ST'}};x.players[1].reported={match:{position:'LB'}};
  assert.equal(row(resolveMatchAnalysis(x)).position.value,'ST');x.players[1].spatial={};assert.equal(row(resolveMatchAnalysis(x)).position.value,'ST');
 });
 check('whole match position follows explicit half decisions',()=>{
  const x=resolverFixture();x.players[1].manual={halves:{1:{position:'ST'},2:{position:'ST'}}};
  x.players[1].season={position:'LB'};
  let p=row(resolveMatchAnalysis(x));assert.equal(p.position.value,'ST');assert.equal(p.position.state,'manual');
  x.players[1].manual.halves[2].position='CB';p=row(resolveMatchAnalysis(x));assert.equal(p.position.value,null);assert.equal(p.position.state,'mixed');
 });
 check('season position fallback and blank/null reset are explicit',()=>{
  const x=resolverFixture();x.players[1].spatial={};x.players[1].season={position:'RB'};x.players[1].manual={match:{position:''}};
  let p=row(resolveMatchAnalysis(x));assert.equal(p.position.value,'RB');assert.equal(p.position.state,'season_default');
  x.players[1].manual.match.position=null;assert.equal(row(resolveMatchAnalysis(x)).position.value,'RB');
 });
 check('unusable and unoriented spatial evidence does not invent lanes',()=>{
  const x=resolverFixture();x.players[1].spatial.match={...spatialFixture,samples:29,grid:undefined};assert.equal(row(resolveMatchAnalysis(x)).position.value,null);
  x.players[1].spatial.match={...spatialFixture,tactical_left_is_top:false};assert.equal(row(resolveMatchAnalysis(x)).position.value,'DEF');
  x.players[1].spatial.match={...spatialFixture,display_orientation:'unknown'};assert.equal(row(resolveMatchAnalysis(x)).position.value,null);
 });
 check('original goalkeeper display threshold is five minutes and sixty percent',()=>{
  const x={context:{teamId:'T',seasonId:'S',eventId:'E'},format:{reported:7},halves:[{id:1,start:0,end:1500},{id:2,start:0,end:1500}],
   players:[{id:'P1',eligible:true,reported:{match:{totalSeconds:3000,gkSeconds:1740}}}]};
  assert.equal(row(resolveMatchAnalysis(x),'P1').position.value,null);
  x.players[0].reported.match.gkSeconds=1800;assert.equal(row(resolveMatchAnalysis(x),'P1').position.value,'GK');
  x.players[0].reported.match={totalSeconds:240,gkSeconds:240};assert.equal(row(resolveMatchAnalysis(x),'P1').position.value,null);
 });
 check('scored fact precedence preserves zero and does not invent unavailable counts',()=>{
  const x=resolverFixture();x.players[1].reported={match:{goals:2,assists:2}};x.players[1].manual={match:{goals:0,assists:null}};
  let p=row(resolveMatchAnalysis(x));assert.equal(p.goals.value,0);assert.equal(p.goals.state,'manual');assert.equal(p.assists.value,2);
  assert.equal(row(resolveMatchAnalysis(x),'P3').goals.value,null);
 });
 check('manual zero remains zero and preserves raw observations',()=>{
  const x=resolverFixture();x.players[1].manual={match:{totalSeconds:0}};x.players[1].reported={match:{totalSeconds:3000}};
  const r=resolveMatchAnalysis(x),p=row(r);assert.equal(p.minutes.value,0);assert.equal(p.observedSeconds,3000);assert.equal(p.estimatedSeconds,0);assert.equal(r.publishable,true);
 });
 check('manual match quantity precedes reported half quantities',()=>{
  const x=resolverFixture();x.players[1].manual={match:{totalSeconds:1200}};x.players[1].reported={halves:{1:{totalSeconds:1000},2:{totalSeconds:1000}}};
  const r=resolveMatchAnalysis(x),p=row(r);assert.equal(p.totalSeconds.value,1200);assert.equal(p.halves[1].totalSeconds.value,600);assert.equal(r.publishable,true);
 });
 check('manual half quantities override corresponding reported portions',()=>{
  const x=resolverFixture();x.players[1].reported={match:{totalSeconds:2000}};x.players[1].manual={halves:{1:{totalSeconds:0}}};
  const p=row(resolveMatchAnalysis(x));assert.equal(p.halves[1].totalSeconds.value,0);assert.equal(p.halves[2].totalSeconds.value,1000);assert.equal(p.totalSeconds.value,1000);assert.equal(p.totalSeconds.state,'mixed');
 });
 check('conflicting manual match and pinned halves cannot publish',()=>{
  const x=resolverFixture();x.players[1].manual={match:{totalSeconds:600},halves:{1:{totalSeconds:1000}}};
  const r=resolveMatchAnalysis(x);assert.equal(r.publishable,false);assert.ok(r.issues.some(i=>i.code==='match_half_quantity_conflict'));assert.equal(row(r).halves[1].totalSeconds.value,1000);
 });
 check('hard goalkeeper quantity above total remains visible conflict',()=>{
  const x=resolverFixture();x.players[0].manual={match:{totalSeconds:600,gkSeconds:900}};
  const r=resolveMatchAnalysis(x);assert.equal(r.publishable,false);assert.equal(row(r,'P1').totalSeconds.value,600);assert.equal(row(r,'P1').gkSeconds.value,900);
 });
 check('short-handed game retains unused capacity',()=>{
  const x=resolverFixture();x.players.pop();x.observations=x.observations.filter(o=>o.playerId!=='P7');
  const r=resolveMatchAnalysis(x);assert.equal(r.totals.assignedSeconds,18000);assert.equal(r.totals.unallocatedSeconds,3000);assert.equal(r.publishable,true);
 });
 check('original verified 7-or-9 history population rule preserves declared 9',()=>{
  const x=resolverFixture(9);x.format={};x.formatEvidence={bothSidesVerified:true,historyFormatFamily:'7_or_9',baselineTracks:17.2,declaredFormat:7};
  assert.equal(resolveMatchAnalysis(x).format.value,9);
  x.formatEvidence.baselineTracks=14;x.formatEvidence.declaredFormat=9;assert.equal(resolveMatchAnalysis(x).format.value,9);
  x.formatEvidence.declaredFormat=5;assert.equal(resolveMatchAnalysis(x).format.value,7);
  x.formatEvidence={baselineTracks:18,bothSidesVerified:false};assert.equal(resolveMatchAnalysis(x).format.value,null);
 });
 check('unknown format retains actual evidence without filling or guessed slots',()=>{
  const x=resolverFixture();x.format={};for(const o of x.observations.filter(o=>o.playerId==='P2'))o.segments=[[0,300]];
  const r=resolveMatchAnalysis(x);assert.equal(r.format.value,null);assert.equal(row(r).minutes.value,10);assert.equal(row(r).estimatedSeconds,0);assert.equal(r.totals.capacitySeconds,null);
 });
 check('missing half windows do not invent nominal time',()=>{
  const x=resolverFixture();x.halves=[x.halves[0]];x.players[1].manual={match:{totalSeconds:2700}};x.observations=x.observations.filter(o=>o.half===1);
  const r=resolveMatchAnalysis(x);assert.equal(r.durationSeconds,null);assert.equal(row(r).minutes.value,45);assert.equal(row(r).gkMinutes.value,null);assert.equal(r.totals.capacitySeconds,null);
 });
 check('unknown role observations preserve total and unavailable roles',()=>{
  const x=resolverFixture();for(const o of x.observations.filter(o=>o.playerId==='P2'))o.role='unknown';
  const p=row(resolveMatchAnalysis(x));assert.equal(p.minutes.value,50);assert.equal(p.fieldMinutes.value,null);assert.equal(p.gkMinutes.value,null);
 });
 check('unmapped goalkeeper remains anonymous and cannot prove appearance',()=>{
  const x=resolverFixture();for(const o of x.observations.filter(o=>o.playerId==='P1')){o.playerId=null;o.mapping='unresolved';}
  const r=resolveMatchAnalysis(x);assert.equal(row(r,'P1').minutes.value,null);assert.equal(row(r,'P1').appearance.value,null);assert.equal(r.totals.unassignedGkSeconds,3000);assert.equal(r.totals.assignedSeconds,18000);assert.equal(r.publishable,true);
 });
 check('exact fractional half duration is never display-rounded',()=>{
  const x=resolverFixture();for(const w of x.halves){w.start=100;w.end=1473.25;}
  const r=resolveMatchAnalysis(x);assert.equal(r.durationSeconds,2746.5);assert.equal(r.totals.assignedSeconds,2746.5*7);
 });
 check('unverified own mapping and dated ineligibility do not create facts',()=>{
  const x=resolverFixture();x.players[1].eligible=false;
  const r=resolveMatchAnalysis(x);assert.equal(row(r).minutes.value,null);assert.equal(row(r).appearance.value,null);assert.ok(r.unassigned.some(o=>o.reason==='outside_dated_eligibility'));
 });
 check('same canonical player multiple sources union time rather than sum it',()=>{
  const x=resolverFixture();x.observations.push({...x.observations[1],id:'duplicate-distinct-source',source:{id:'another-source'}});
  const r=resolveMatchAnalysis(x);assert.equal(row(r).observedSeconds,3000);assert.equal(row(r).minutes.value,50);assert.equal(r.publishable,true);
 });
 check('half-two start is independent of match first-half start',()=>{
  const x=resolverFixture();x.players[1].manual={match:{started:false}};
  const p=row(resolveMatchAnalysis(x));assert.equal(p.started.value,false);assert.equal(p.halves[2].started.value,true);
 });
 check('manual DNP suppresses raw inferred starter',()=>{
  const x=resolverFixture();x.players[1].manual={match:{appearance:false}};
  const p=row(resolveMatchAnalysis(x));assert.equal(p.started.value,false);assert.equal(p.halves[2].started.value,false);assert.equal(p.minutes.value,0);
 });
 check('explicit contradictory DNP and starter cannot publish',()=>{
  const x=resolverFixture();x.players[1].manual={match:{appearance:false,started:true}};
  const r=resolveMatchAnalysis(x);assert.equal(r.publishable,false);assert.ok(r.issues.some(i=>i.code==='dnp_started_conflict'));
 });
 check('manual positive quantity corrects reported DNP',()=>{
  const x=resolverFixture();x.players[1].reported={match:{appearance:false}};x.players[1].manual={match:{totalSeconds:1200}};
  const r=resolveMatchAnalysis(x);assert.equal(row(r).appearance.value,true);assert.equal(row(r).minutes.value,20);assert.equal(r.publishable,true);
 });
 check('half-only slots and match-only scored facts reject silent discard',()=>{
  const x=resolverFixture();x.players[1].manual={match:{slot:2}};assert.throws(()=>resolveMatchAnalysis(x));
  const y=resolverFixture();y.players[1].reported={halves:{1:{goals:1}}};assert.throws(()=>resolveMatchAnalysis(y));
 });
 check('half participation decisions override old reported whole appearance',()=>{
  const x=resolverFixture();x.players[1].reported={match:{appearance:true}};x.players[1].manual={halves:{1:{appearance:false},2:{appearance:false}}};
  const r=resolveMatchAnalysis(x);assert.equal(row(r).appearance.value,false);assert.equal(row(r).minutes.value,0);assert.equal(r.publishable,true);
 });
 check('one-half events reject second-half evidence rather than dropping it',()=>{
  const x=resolverFixture();x.expectedHalves=1;x.halves=[x.halves[0]];assert.throws(()=>resolveMatchAnalysis(x));
  x.observations=x.observations.filter(o=>o.half===1);x.players[1].manual={halves:{2:{totalSeconds:600}}};assert.throws(()=>resolveMatchAnalysis(x));
 });
 check('opaque revision fence is echoed and unrelated payload is discarded',()=>{
  const x=resolverFixture();x.context.token='secret';x.players[1].token='secret';
  const r=resolveMatchAnalysis(x);assert.equal(r.context.commitSignature,'opaque-accepted-signature');assert.equal(JSON.stringify(r).includes('secret'),false);
 });
 check('output frozen without freezing or mutating inputs',()=>{
  const x=resolverFixture(),before=JSON.stringify(x),r=resolveMatchAnalysis(x);
  assert.equal(JSON.stringify(x),before);assert.equal(Object.isFrozen(x),false);assert.equal(Object.isFrozen(x.players[1].spatial.match.grid),false);
  assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.players[1].minutes.provenance),true);
 });
 check('input permutations produce deterministic facts and slots',()=>{
  const x=resolverFixture(),r=resolveMatchAnalysis(x);
  x.players.reverse();x.observations.reverse();x.halves.reverse();
  assert.deepEqual(resolveMatchAnalysis(x),r);
 });
 check('malformed or unsupported input rejects before interpretation',()=>{
  const x=resolverFixture();x.players.push({...x.players[1]});assert.throws(()=>resolveMatchAnalysis(x));
  const y=resolverFixture();y.format.manual=5;assert.throws(()=>resolveMatchAnalysis(y));
  const z=resolverFixture();z.players[1].manual={match:{totalSeconds:NaN}};assert.throws(()=>resolveMatchAnalysis(z));
  const a=resolverFixture();a.players[1].reported={halves:{1:{slot:2}}};assert.throws(()=>resolveMatchAnalysis(a));
  const b=resolverFixture();b.players[1].manual={match:{slotX:50}};assert.throws(()=>resolveMatchAnalysis(b));
 });
 check('observed overcapacity preserves facts and prevents publication',()=>{
  const x=resolverFixture();x.players.push({id:'P8',eligible:true});for(const half of [1,2])x.observations.push({id:'over'+half,playerId:'P8',half,side:'own',dummy:false,mapping:'verified',role:'field',segments:[[0,1500]],source:{id:'s'}});
  const r=resolveMatchAnalysis(x);assert.equal(r.publishable,false);assert.equal(row(r,'P8').minutes.value,50);assert.equal(r.totals.overCapacity,true);
 });
 check('seeded windows conserve quantities and deterministic sparse completion',()=>{
  let state=20261012;const random=()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;};
  for(let i=0;i<200;i++){
   const x=resolverFixture(i%2?7:9),start=100+random()*1000,length=500+random()*1500;
   for(const w of x.halves){w.start=start;w.end=start+length;}
   for(const o of x.observations)o.segments=[[start,start+(o.playerId==='P2'?length*.2:length)]];
   const r=resolveMatchAnalysis(x);assert.equal(r.publishable,true);
   assert.ok(Math.abs(r.totals.assignedSeconds+r.totals.unassignedGkSeconds+r.totals.unallocatedSeconds-r.totals.capacitySeconds)<1e-6);
   for(const p of r.players){assert.ok(p.totalSeconds.value<=2*length+1e-6);assert.ok(Math.abs(p.fieldSeconds.value+p.gkSeconds.value-p.totalSeconds.value)<1e-6);}
  }
 });
 return cases;
}
