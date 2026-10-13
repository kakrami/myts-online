// Synthetic Collection+JSON data. Composite IDs are supported by the official
// TeamSnap Ruby SDK fixture (69-1); these are invented test rows, not live data.
export const EVENT_COUNT = 10;
export const PLAYER_COUNT = 20;
export const TEAM_ID = 999999999999999;
export const ATTENDANCE_COUNT = EVENT_COUNT * PLAYER_COUNT;
export function fixtureEvent(index, recentDay='2026-10-06') {
  return {id:800000000000000+index,team_id:TEAM_ID,is_game:true,name:`Throughput game ${index}`,
    start_date:(index<3?`2024-09-${String(index+1).padStart(2,'0')}`:recentDay)+'T18:00:00Z',
    opponent_name:`Opponent ${index}`,location_name:`Source field ${index}`,game_type:'home',game_type_code:1,
    notes:`Complete Unicode note ${index}: 雪`,uniform:'Blue',points_for_team:index%7,points_for_opponent:index%4,
    is_availability_enabled:true,updated_at:'2026-10-12T22:00:00.000Z'};
}
export function fixtureAvailability(index,{revision=0,statusShift=0}={}) {
  const event_id=800000000000000+Math.floor(index/PLAYER_COUNT),member_id=700000000000000+index%PLAYER_COUNT;
  const statuses=[0,1,2,null,17,'0','1','2','provider-unknown',undefined],status=statuses[(index+statusShift)%statuses.length];
  const row={team_id:TEAM_ID,event_id,member_id,...(status===undefined?{}:{status_code:status}),
    observed_at:`volatile-${revision}`,metadata:{ignored:`arbitrary provider metadata ${revision}`}};
  // Every ID is nonnumeric or absent. Repeated opaque values are intentionally
  // shared by distinct tuples; irrelevant fields change on every reread.
  if(index%4===0)row.id=`${member_id}-${event_id}-revision-${revision}`;
  else if(index%4===1)row.id='same-opaque-id';
  else if(index%4===2)row.id=`opaque:${revision}:${index}`;
  return row;
}
export const normalizedStatus = row => row.status_code==null?'NR':[0,'0'].includes(row.status_code)?'No':[1,'1'].includes(row.status_code)?'Yes':[2,'2'].includes(row.status_code)?'Maybe':'Unknown';
export const collectionBody=(rows,extra={})=>({collection:{items:rows.map(row=>({data:Object.entries(row).map(([name,value])=>({name,value})),links:[]})),links:[],...extra}});
const pathKind={'/v3/events/search':'events','/v3/availabilities/search':'attendance','/v3/members/search':'roster','/v3/teams/search':'catalog','/v3/locations/search':'locations','/v3/opponents/search':'opponents'};
export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/__fixture/config'){await env.STATE.put('config',await request.text());return Response.json({saved:true});}
  if(path==='/__fixture/status')return Response.json({calls:await env.STATE.get('calls','json')||[],held:await env.STATE.get('held','json')||null});
  if(request.headers.get('authorization')!=='Bearer synthetic-attendance-throughput-token')return Response.json({error:'Synthetic credential required'},{status:401});
  const config=await env.STATE.get('config','json')||{},kind=pathKind[path],page=Number(url.searchParams.get('page_number')||1),requestedSize=Number(url.searchParams.get('page_size')||0);
  const calls=await env.STATE.get('calls','json')||[],attempt=calls.filter(call=>call.kind===kind&&call.page===page).length+1;
  let rows;
  if(path==='/v3/me')rows=[{id:123,name:'Synthetic attendance throughput owner'}];
  else if(kind==='catalog')rows=[{id:TEAM_ID,name:'Synthetic throughput history',time_zone:'UTC'}];
  else if(kind==='roster')rows=Array.from({length:PLAYER_COUNT},(_,i)=>({id:700000000000000+i,team_id:TEAM_ID,is_player:true,first_name:'Player',last_name:String(i),jersey_number:String(i+1)}));
  else if(kind==='events')rows=Array.from({length:EVENT_COUNT},(_,i)=>fixtureEvent(i,config.recentDay));
  else if(kind==='attendance'){
    rows=Array.from({length:config.attendanceCount??ATTENDANCE_COUNT},(_,i)=>fixtureAvailability(i,{revision:attempt,statusShift:config.statusShift||0}));
    if(config.statusText!==undefined)rows=rows.map(row=>({...row,status_code:config.statusText}));
    if(config.extraPair)rows.push({...fixtureAvailability(ATTENDANCE_COUNT),event_id:800000000000009,member_id:700000000099999,status_code:1});
  }else if(kind==='locations'||kind==='opponents')rows=[];
  else return Response.json({unsupported:path},{status:404});
  if(['events','attendance'].includes(kind)){
    const start=row=>kind==='events'?row.start_date:fixtureEvent(row.event_id-800000000000000,config.recentDay).start_date;
    if(url.searchParams.has('started_after'))rows=rows.filter(row=>Date.parse(start(row))>=Date.parse(url.searchParams.get('started_after')));
    if(url.searchParams.has('started_before'))rows=rows.filter(row=>Date.parse(start(row))<=Date.parse(url.searchParams.get('started_before')));
    rows.sort((a,b)=>kind==='events'?b.start_date.localeCompare(a.start_date)||b.id-a.id:b.event_id-a.event_id||b.member_id-a.member_id);
  }
  const total=rows.length,paged=requestedSize>0,pageSize=paged?Math.min(requestedSize,kind==='attendance'?(config.providerCap??requestedSize):25):total||1,selected=paged?rows.slice((page-1)*pageSize,page*pageSize):rows;
  if(kind==='attendance'&&page===1&&config.malformedPair)selected[0]={...selected[0],member_id:'not-a-numeric-member'};
  if(kind==='attendance'&&page===1&&config.duplicatePair)selected[selected.length-1]={...selected[0],id:'different-unused-id',status_code:selected[0].status_code===1?0:1};
  const extra=paged?{page_info:{total_items:total,page_size:pageSize,page_number:page},links:page*pageSize<total?[{rel:'next',href:(()=>{const next=new URL(url);next.searchParams.set('page_number',String(page+1));next.searchParams.set('page_size',String(pageSize));return next.href;})()}]:[]}:{};
  const value=collectionBody(selected,extra);
  // A synthetic oversized body exercises the unchanged 2 MB fetch guard.
  if(kind==='attendance'&&config.oversizeAbove&&requestedSize>config.oversizeAbove)value.collection.synthetic_padding='x'.repeat(2000100);
  const body=JSON.stringify(value),shouldFail=!!kind&&config.failOnce?.kind===kind&&config.failOnce.page===page&&!calls.some(call=>call.fault==='transient');
  calls.push({kind,path,search:url.search,page,page_size:requestedSize||null,rows:selected.length,bytes:new TextEncoder().encode(body).length,status:shouldFail?503:200,attempt,ids:selected.map(row=>row.id??null),pairs:kind==='attendance'?selected.map(row=>`${row.event_id}:${row.member_id}`):[],...(shouldFail?{fault:'transient'}:{})});
  await env.STATE.put('calls',JSON.stringify(calls));
  if(shouldFail)return Response.json({error:'Synthetic transient failure'},{status:503});
  if(kind&&config.hold?.kind===kind&&config.hold.page===page){
    await env.STATE.put('held',JSON.stringify({kind,page,rows:selected.length,ids:selected.map(row=>row.id??null),pairs:kind==='attendance'?selected.map(row=>`${row.event_id}:${row.member_id}`):[],attempt}));
    for(let count=0;count<2400;count++){const now=await env.STATE.get('config','json');if(now?.hold?.kind!==kind||now.hold.page!==page)break;await new Promise(resolve=>setTimeout(resolve,25));}
    await env.STATE.delete('held');
  }
  return new Response(body,{headers:{'Content-Type':'application/vnd.collection+json'}});
}};
