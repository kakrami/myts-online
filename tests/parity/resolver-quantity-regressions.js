export const inputA = {"context":{"teamId":"T","seasonId":"S","eventId":"E"},"format":{"reported":7},"players":[{"id":"p","eligible":true,"manual":{"match":{"appearance":false}}}],"observations":[],"halves":[]};
export const inputC = {"context":{"teamId":"T","seasonId":"S","eventId":"E"},"format":{"reported":7},"players":[{"id":"p","eligible":true,"reported":{"match":{"totalSeconds":600}}}],"observations":[],"halves":[{"id":1,"start":0,"end":1500,"complete":true}]};
export const inputD = {"context":{"teamId":"T","seasonId":"S","eventId":"E"},"format":{"reported":7},"players":[{"id":"p","eligible":true,"manual":{"match":{"appearance":true}}}],"observations":[],"halves":[{"id":1,"start":0,"end":1500},{"id":2,"start":0,"end":1500}]};
const copy=v=>JSON.parse(JSON.stringify(v));
const windows=[{id:1,start:0,end:1500,complete:true},{id:2,start:0,end:1500,complete:true}];
export function quantityCases({resolveMatchAnalysis:resolve,allocateHalf}) {
 const cases=[],add=(name,run)=>cases.push({name,run});
 const zeros=(assert,p)=>{for(const key of ['totalSeconds','fieldSeconds','gkSeconds','minutes','fieldMinutes','gkMinutes'])assert.equal(p[key].value,0,key);assert.equal(p.started.value,false);};
 const unknown=(assert,p)=>{for(const key of ['totalSeconds','fieldSeconds','gkSeconds'])assert.equal(p[key].value,null,key);};
 const only=p=>p.players[0],valid=(assert,r)=>{assert.equal(r.publishable,true);assert.equal(r.issues.filter(i=>i.severity==='error').length,0);};
 for(const [name,halves] of [['no windows',[]],['only half 1',[windows[0]]],['only half 2',[windows[1]]],['both windows',windows]])add('A DNP zero without quantity clock: '+name,assert=>{
  const input=copy(inputA);input.halves=copy(halves);const r=resolve(input),p=only(r);zeros(assert,p);assert.equal(p.appearance.value,false);assert.equal(p.minutes.state,'manual');valid(assert,r);
  if(halves.length<2){assert.equal(r.durationSeconds,null);assert.equal(r.totals.capacitySeconds,null);}
  for(const h of Object.values(p.halves)){assert.equal(h.totalSeconds.value,0);assert.equal(h.fieldSeconds.value,0);assert.equal(h.gkSeconds.value,0);assert.equal(h.started.value,false);}
 });
 for(const [name,halves] of [['no windows',[]],['only half 1',[windows[0]]],['both windows',windows]])add('B DNP/start conflict: '+name,assert=>{
  const input=copy(inputA);input.halves=copy(halves);input.players[0].manual.match.started=true;
  const r=resolve(input);assert.equal(r.publishable,false);assert.equal(only(r).started.value,true);assert.equal(only(r).minutes.value,0);
  assert.ok(r.issues.some(i=>i.code==='match_dnp_started_conflict'||i.code==='dnp_started_conflict'));
  assert.deepEqual(resolve(input),r);
 });
 add('C exact reported whole quantity does not prove half participation or quantity',assert=>{
  const r=resolve(copy(inputC)),p=only(r),h=p.halves[1];valid(assert,r);
  assert.equal(p.totalSeconds.value,600);assert.equal(p.minutes.value,10);assert.equal(p.minutes.state,'reported');
  assert.equal(p.appearance.value,true);assert.equal(h.appearance.value,null);assert.equal(h.started.value,null);unknown(assert,h);
  assert.equal(h.estimatedSeconds,0);assert.equal(h.unknownRoleSeconds,null);assert.equal(r.durationSeconds,null);assert.equal(r.totals.capacitySeconds,null);
  assert.equal(h.appearance.provenance.basis,'no_half_participation_proof');
 });
 add('C independent half observation supplies only the observed half proof',assert=>{
  const input=copy(inputC);input.observations=[{id:'obs',playerId:'p',half:1,side:'own',dummy:false,mapping:'verified',role:'field',segments:[[0,300]],source:{id:'s'}}];
  const r=resolve(input),p=only(r),h=p.halves[1];valid(assert,r);assert.equal(p.minutes.value,10);assert.equal(h.appearance.value,true);assert.equal(h.totalSeconds.value,300);assert.equal(h.estimatedSeconds,0);assert.equal(p.halves[2],undefined);
 });
 add('C explicit half quantity supplies quantity and participation without guessed timing',assert=>{
  const input=copy(inputC);input.players[0].reported.halves={1:{totalSeconds:300}};
  const r=resolve(input),p=only(r),h=p.halves[1];valid(assert,r);assert.equal(p.minutes.value,10);assert.equal(h.totalSeconds.value,300);assert.equal(h.appearance.value,true);assert.equal(h.started.value,null);assert.equal(h.fieldSeconds.value,null);assert.equal(h.gkSeconds.value,null);
 });
 add('D appearance alone with both actual windows leaves time unknown',assert=>{
  const r=resolve(copy(inputD)),p=only(r);valid(assert,r);assert.equal(p.appearance.value,true);unknown(assert,p);assert.equal(p.minutes.value,null);assert.equal(p.fieldMinutes.value,null);assert.equal(p.gkMinutes.value,null);
  for(const h of Object.values(p.halves)){unknown(assert,h);assert.equal(h.estimatedSeconds,0);assert.equal(h.appearance.value,null);}
  assert.equal(r.totals.assignedIsLowerBound,true);
 });
 add('D explicit total zero remains zero and preserves positive appearance',assert=>{
  for(const halves of [[],[windows[0]],windows]){const input=copy(inputD);input.halves=copy(halves);input.players[0].manual.match.totalSeconds=0;
   const r=resolve(input),p=only(r);valid(assert,r);assert.equal(p.appearance.value,true);for(const key of ['totalSeconds','fieldSeconds','gkSeconds','minutes'])assert.equal(p[key].value,0);assert.equal(p.minutes.state,'manual');}
 });
 add('start proof alone does not prove seconds or trigger estimates',assert=>{
  const input=copy(inputD);input.players[0].manual.match={started:true};
  const r=resolve(input),p=only(r);valid(assert,r);assert.equal(p.started.value,true);assert.equal(p.appearance.value,true);unknown(assert,p);
  assert.equal(p.halves[1].appearance.value,true);assert.equal(p.halves[2].appearance.value,null);assert.equal(p.estimatedSeconds,0);
 });
 add('explicit field role and appearance still cannot invent time',assert=>{
  const input=copy(inputD);input.players[0].manual.match.role='field';
  const r=resolve(input);valid(assert,r);unknown(assert,only(r));assert.equal(only(r).estimatedSeconds,0);
 });
 add('manual DNP suppresses lower reported field/GK/total quantities',assert=>{
  for(const halves of [[],[windows[0]],windows]){const input=copy(inputA);input.halves=copy(halves);input.players[0].reported={match:{totalSeconds:1200,fieldSeconds:600,gkSeconds:600}};
   const r=resolve(input);valid(assert,r);zeros(assert,only(r));}
 });
 add('manual DNP retains conflicting same-priority positive quantity',assert=>{
  for(const halves of [[],[windows[0]],windows]){const input=copy(inputA);input.halves=copy(halves);input.players[0].manual.match.totalSeconds=600;
   const r=resolve(input);assert.equal(r.publishable,false);assert.equal(only(r).totalSeconds.value,600);assert.ok(r.issues.some(i=>i.code==='match_dnp_positive_seconds'||i.code==='confirmed_dnp_positive_seconds'));}
 });
 add('positive manual quantity supersedes lower reported DNP before start inference',assert=>{
  const input=copy(inputC);input.halves=copy(windows);input.players[0]={id:'p',eligible:true,manual:{match:{totalSeconds:600}},reported:{match:{appearance:false}}};
  input.observations=[{id:'obs',playerId:'p',half:1,side:'own',dummy:false,mapping:'verified',role:'field',segments:[[0,300]],source:{id:'s'}}];
  const r=resolve(input);valid(assert,r);assert.equal(only(r).appearance.value,true);assert.equal(only(r).halves[1].started.value,true);assert.equal(only(r).halves[2].appearance.value,null);
 });
 add('half DNP decisions remain meaningful without video windows',assert=>{
  const input=copy(inputD);input.halves=[];input.players[0]={id:'p',eligible:true,reported:{match:{appearance:true}},manual:{halves:{1:{appearance:false},2:{appearance:false}}}};
  const r=resolve(input);valid(assert,r);zeros(assert,only(r));assert.equal(only(r).appearance.value,false);
 });
 add('known field plus goalkeeper quantities sum without a clock',assert=>{
  const input=copy(inputD);input.halves=[];input.players[0]={id:'p',eligible:true,manual:{match:{fieldSeconds:600}},reported:{match:{gkSeconds:900}}};
  const r=resolve(input),p=only(r);valid(assert,r);assert.equal(p.totalSeconds.value,1500);assert.equal(p.minutes.value,25);assert.equal(p.totalSeconds.state,'mixed');assert.equal(p.fieldSeconds.state,'manual');assert.equal(p.gkSeconds.state,'reported');assert.equal(r.totals.capacitySeconds,null);
 });
 add('explicit half quantities sum without fabricating half windows',assert=>{
  const input=copy(inputD);input.halves=[];input.players[0].manual={halves:{1:{totalSeconds:300},2:{totalSeconds:600}}};
  const r=resolve(input);valid(assert,r);assert.equal(only(r).totalSeconds.value,900);assert.equal(only(r).minutes.value,15);assert.equal(r.durationSeconds,null);assert.deepEqual(only(r).halves,{});
 });
 add('field greater than total remains a conflict without a clock',assert=>{
  const input=copy(inputD);input.halves=[];input.players[0].manual.match={totalSeconds:600,fieldSeconds:900};
  const r=resolve(input);assert.equal(r.publishable,false);assert.equal(only(r).totalSeconds.value,600);assert.equal(only(r).fieldSeconds.value,900);assert.ok(r.issues.some(i=>i.code==='match_field_exceeds_total'));
 });
 add('eligibility constrains positive quantity or participation without a clock',assert=>{
  for(const match of [{totalSeconds:600},{appearance:true},{gkSeconds:600}]){const input=copy(inputD);input.halves=[];input.players[0].eligible=false;input.players[0].manual.match=match;
   const r=resolve(input);assert.equal(r.publishable,false);assert.ok(r.issues.some(i=>i.code==='participation_outside_eligibility'));}
 });
 add('missing video window cannot downgrade identical explicit whole/half position',assert=>{
  const input=copy(inputD);input.halves=[windows[0]];input.players[0].manual={match:{position:'ST'},halves:{1:{position:'ST'}}};
  const r=resolve(input);valid(assert,r);assert.equal(only(r).position.value,'ST');assert.equal(only(r).position.state,'manual');
 });
 add('single role zero preserves unknown total and other role',assert=>{
  for(const field of ['fieldSeconds','gkSeconds']){const input=copy(inputD);input.players[0].manual.match[field]=0;const r=resolve(input),p=only(r);valid(assert,r);
   assert.equal(p[field].value,0);assert.equal(p.totalSeconds.value,null);assert.equal(p[field==='fieldSeconds'?'gkSeconds':'fieldSeconds'].value,null);}
 });
 add('single positive hard role is an accounted lower bound, not opposite-role zero',assert=>{
  const r=allocateHalf({format:7,window:windows[0],players:[{id:'p',eligible:true,appearance:true,manualGkSeconds:600}],keeperSegments:[[0,1500]]}),p=r.players[0];
  assert.equal(r.publishable,true);assert.equal(p.totalSeconds,null);assert.equal(p.gkSeconds,600);assert.equal(p.fieldSeconds,null);assert.equal(p.lowerBoundSeconds,600);
  assert.equal(r.assignedSeconds,600);assert.equal(r.unassignedGkSeconds,900);assert.equal(r.assignedIsLowerBound,true);
  assert.equal(r.assignedSeconds+r.unassignedGkSeconds+r.unallocatedSeconds,r.capacitySeconds);
 });
 add('full actual-window role closes opposite zero with raw evidence preserved',assert=>{
  for(const role of ['Field','Gk']){const r=allocateHalf({format:7,window:windows[0],players:[{id:'p',eligible:true,appearance:true,['manual'+role+'Seconds']:1500,segments:role==='Gk'?[[0,300]]:[],goalkeeperSegments:role==='Field'?[[0,300]]:[]}]});
   assert.equal(r.publishable,true);assert.equal(r.players[0].totalSeconds,1500);assert.equal(r.players[0][role==='Field'?'gkSeconds':'fieldSeconds'],0);assert.equal(r.players[0].observedSeconds,300);}
 });
 add('quantities and precedence preserve immutable deterministic output',assert=>{
  const input=copy(inputC),before=JSON.stringify(input),r=resolve(input);assert.equal(JSON.stringify(input),before);assert.equal(Object.isFrozen(input),false);assert.equal(Object.isFrozen(r),true);assert.equal(r.version,'1.0.1');assert.equal(Object.isFrozen(r.players[0].halves[1].totalSeconds.provenance),true);assert.deepEqual(resolve(input),r);
 });
 add('1000 seeded unknown/zero/role facts preserve bounds and conservation',assert=>{
  let seed=9231781;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<1000;i++){const duration=100+random()*1400,kind=i%5,player={id:'p',eligible:true,appearance:true};
   if(kind===1)player.manualSeconds=0;if(kind===2)player.manualGkSeconds=duration*.25;if(kind===3)player.manualFieldSeconds=duration*.4;if(kind===4){player.manualFieldSeconds=duration*.4;player.manualGkSeconds=duration*.2;}
   const r=allocateHalf({format:7,window:{id:1,start:0,end:duration},players:[player]});assert.equal(r.publishable,true);assert.ok(Math.abs(r.assignedSeconds+r.unassignedGkSeconds+r.unallocatedSeconds-r.capacitySeconds)<1e-6);
   const p=r.players[0];assert.ok(p.lowerBoundSeconds>=0&&p.lowerBoundSeconds<=duration+1e-6);
   if(kind===0){assert.equal(p.totalSeconds,null);assert.equal(p.estimatedSeconds,0);}
   if(kind===1){assert.equal(p.totalSeconds,0);assert.equal(p.gkSeconds,0);assert.equal(p.fieldSeconds,0);}
   if(kind===2||kind===3)assert.equal(p.totalSeconds,null);
   if(p.totalSeconds!=null&&p.fieldSeconds!=null&&p.gkSeconds!=null)assert.ok(Math.abs(p.fieldSeconds+p.gkSeconds-p.totalSeconds)<1e-6);
  }
 });
 return cases;
}
