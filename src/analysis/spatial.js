const COLS=24,ROWS=16;
const finite=value=>typeof value==='number'&&Number.isFinite(value);

export function summarizeSpatial(grid,extra={}) {
  if(!Array.isArray(grid)||grid.length!==COLS*ROWS||!grid.every(v=>finite(v)&&v>=0))return null;
  const total=grid.reduce((a,b)=>a+b,0);if(!(total>0)||!Number.isFinite(total))return null;
  let x=0,y=0;const thirds=[0,0,0],normalized=grid.map(v=>v/total);
  for(let i=0;i<normalized.length;i++){const mass=normalized[i],col=i%COLS,row=Math.floor(i/COLS);x+=(col+.5)/COLS*mass;y+=(row+.5)/ROWS*mass;thirds[Math.min(2,Math.floor(col/(COLS/3)))]+=mass*100;}
  return {...extra,grid:normalized,grid_cols:COLS,grid_rows:ROWS,width:COLS,height:ROWS,avg_x:x,avg_y:y,left_third_pct:thirds[0],middle_third_pct:thirds[1],right_third_pct:thirds[2],defensive_third_pct:null,attacking_third_pct:null,coordinate_units:'normalized_0_1',display_orientation:'provider_native',tactical_left_is_top:false};
}

/** Resample captured native cell mass; geometry does not identify a position. */
export function nativeSpatial(row) {
  if(row?.state!=='ready'||!Number.isInteger(row.width)||!Number.isInteger(row.height)||row.width<1||row.height<1||row.width>256||row.height>256)return null;
  const cells=typeof row.cells==='string'?JSON.parse(row.cells):row.cells;
  if(!Array.isArray(cells)||cells.length!==row.height||!cells.every(v=>Array.isArray(v)&&v.length===row.width&&v.every(n=>finite(n)&&n>=0)))return null;
  const flat=cells.flat(),sum=flat.reduce((a,b)=>a+b,0);if(!(sum>0)||!Number.isFinite(sum))return null;
  const grid=Array(COLS*ROWS).fill(0),w=row.width,h=row.height;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const mass=flat[y*w+x]/sum;if(!mass)continue;
    const x0=x/w,x1=(x+1)/w,y0=y/h,y1=(y+1)/h;
    for(let r=Math.floor(y0*ROWS);r<Math.min(ROWS,Math.ceil(y1*ROWS));r++)for(let c=Math.floor(x0*COLS);c<Math.min(COLS,Math.ceil(x1*COLS));c++){
      const dx=Math.max(0,Math.min(x1,(c+1)/COLS)-Math.max(x0,c/COLS)),dy=Math.max(0,Math.min(y1,(r+1)/ROWS)-Math.max(y0,r/ROWS));grid[r*COLS+c]+=mass*dx*dy*w*h;
    }
  }
  return summarizeSpatial(grid,{state:row.provenance==='file_import'?'file_import':'published',source:'trace_native_heatmap',provenance:row.provenance||'provider'});
}
