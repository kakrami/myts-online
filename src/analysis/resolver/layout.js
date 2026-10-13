/** Pure projection onto the original app's tactical drop targets.
 * Evidence and participation are already resolved. This only chooses coordinates.
 * Bounded joint assignment preserves relative lanes and balances each shape.
 */
const TARGETS = [
 ['GK',50,91,'GK'],['SW',50,81,'DEF'],
 ['LB',15,70,'DEF'],['LCB',35,70,'DEF'],['CB',50,70,'DEF'],['RCB',65,70,'DEF'],['RB',85,70,'DEF'],
 ['LWB',9,58,'DEF'],['RWB',91,58,'DEF'],
 ['LM',18,44,'MID'],['LCM',35,44,'MID'],['CDM',50,56,'MID'],['CM',50,44,'MID'],['CAM',50,32,'MID'],['RCM',65,44,'MID'],['RM',82,44,'MID'],
 ['LW',18,19,'FWD'],['RW',82,19,'FWD'],['SS',40,24,'FWD'],['CF',60,24,'FWD'],
 ['ST',35,9,'FWD'],['ST',50,9,'FWD'],['ST',65,9,'FWD']
];
const finite=v=>typeof v==='number'&&Number.isFinite(v),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const validGrid=s=>!!s&&Number.isInteger(s.grid_cols)&&Number.isInteger(s.grid_rows)&&s.grid_cols>0&&s.grid_rows>0&&s.grid_cols<=128&&s.grid_rows<=128&&Array.isArray(s.grid)&&s.grid.length<=4096&&s.grid.length===s.grid_cols*s.grid_rows&&s.grid.every(v=>finite(v)&&v>=0)&&s.grid.some(v=>v>0)&&finite(s.grid.reduce((a,b)=>a+b,0));
const spatial=s=>!!s&&finite(s.avg_x)&&finite(s.avg_y)&&s.avg_x>=0&&s.avg_x<=1&&s.avg_y>=0&&s.avg_y<=1
 &&String(s.display_orientation||'').startsWith('own_goal_left')&&((finite(s.samples)&&s.samples>=30)||validGrid(s));
const lateral=s=>spatial(s)&&s.tactical_left_is_top===true&&validGrid(s);
export function projectLineupPositions(entries) {
 if(!Array.isArray(entries)||entries.length>9)throw new RangeError('layout supports at most nine resolved starters');
 const players=entries.filter(e=>e.evidence).map(e=>({id:e.id,e:e.evidence,s:spatial(e.spatial)?e.spatial:null,point:e.manualPoint}));
 const used=new Set(),placed=new Map();
 const point=p=>p&&finite(p.x)&&finite(p.y)&&p.x>=0&&p.x<=100&&p.y>=0&&p.y<=100;
 for(const p of players.filter(p=>p.point!=null)) {
  if(!point(p.point))throw new RangeError('manual pitch point must be within 0..100');
  const available=TARGETS.map((t,i)=>({t,i})).filter(v=>!used.has(v.i));
  const preferred=available.filter(v=>v.t[0]===p.e.label),band=available.filter(v=>v.t[3]===p.e.group);
  const chosen=(preferred.length?preferred:band).sort((a,b)=>Math.hypot(a.t[1]-p.point.x,a.t[2]-p.point.y)-Math.hypot(b.t[1]-p.point.x,b.t[2]-p.point.y)||a.i-b.i)[0];
  if(chosen){used.add(chosen.i);placed.set(p.id,{x:chosen.t[1],y:chosen.t[2],label:chosen.t[0],basis:'manual_pitch_anchor'});}
 }
 const ys=players.filter(p=>p.e.group!=='GK'&&lateral(p.s)).map(p=>p.s.avg_y).sort((a,b)=>a-b),center=ys.length?ys[Math.floor(ys.length/2)]:.5;
 const ideal=p=>({x:lateral(p.s)?clamp(50+(p.s.avg_y-center)*110,7,93):finite(p.e.side)?p.e.side*100:50,
  y:p.s?90-(finite(p.e.attack)?p.e.attack:p.s.avg_x)*80:{GK:91,DEF:70,MID:44,FWD:19}[p.e.group]});
 for(const group of ['GK','DEF','MID','FWD']) {
  const pending=players.filter(p=>p.e.group===group&&!placed.has(p.id)),fixed=players.filter(p=>p.e.group===group&&placed.has(p.id)).map(p=>placed.get(p.id));
  if(!pending.length)continue;
  let available=TARGETS.map((t,i)=>({t,i})).filter(v=>!used.has(v.i)&&v.t[3]===group);
  if(group==='FWD'&&pending.length===1&&!fixed.length&&pending[0].e.provenance?.kind==='inferred'&&pending[0].e.label==='ST') {
   const mid=available.filter(v=>v.t[0]==='ST'&&v.t[1]===50);if(mid.length)available=mid;
  }
  if(available.length<pending.length) {
   const points=pending.map(ideal),distance=v=>Math.min(...points.map(p=>Math.hypot(v.t[1]-p.x,v.t[2]-p.y)));
   available=TARGETS.map((t,i)=>({t,i})).filter(v=>!used.has(v.i)).sort((a,b)=>distance(a)-distance(b)||a.i-b.i).slice(0,Math.max(12,pending.length));
  }
  const points=pending.map(ideal);let layer=new Map([[0,{cost:0,path:[]}]]);
  for(let pi=0;pi<pending.length;pi++) {
   const next=new Map(),p=pending[pi],q=points[pi];
   for(const [mask,state]of layer)for(let j=0;j<available.length;j++) {
    if(mask&(1<<j))continue;const t=available[j].t;
    const cost=state.cost+.065*(t[1]-q.x)**2+.085*(t[2]-q.y)**2+(t[3]===group?0:250)+(p.e.provenance?.kind==='manual'&&t[0]!==p.e.label?180:0);
    const key=mask|(1<<j),old=next.get(key);if(!old||cost<old.cost)next.set(key,{cost,path:[...state.path,j]});
   }layer=next;
  }
  let best=null;
  for(const state of layer.values()) {
   const xs=[...fixed.map(p=>p.x),...state.path.map(j=>available[j].t[1])],n=xs.length,mean=xs.reduce((a,b)=>a+b,0)/n,span=Math.max(...xs)-Math.min(...xs);
   const balance=n>=2?.22*n*(mean-50)**2+(n>=3?.16*Math.max(0,25-span)**2:0):0;
   const lone=n===1&&group==='FWD'&&pending[0].e.label==='ST'?.3*(mean-50)**2:0;
   const score=state.cost+balance+lone;if(!best||score<best.score)best={score,path:state.path};
  }
  if(best)pending.forEach((p,i)=>{const {t,index}= {t:available[best.path[i]].t,index:available[best.path[i]].i};used.add(index);
   placed.set(p.id,{x:t[1],y:t[2],label:p.e.provenance?.kind==='manual'?p.e.label:t[0],basis:'original_joint_shape_projection'});});
 }
 return players.filter(p=>placed.has(p.id)).map(p=>({player_id:p.id,...placed.get(p.id)}));
}
