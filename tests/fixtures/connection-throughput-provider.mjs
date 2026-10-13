// Synthetic provider data only. Production Worker, source mapping, transport,
// native D1 and Durable Object execution remain in the acceptance path.
export const EVENT_COUNT=721;
export const PLAYER_COUNT=3;
export const TEAM_ID=321;
export const YEARS=[2022,2023,2024,2025,2026];
export function fixtureEvent(index){
  const year=YEARS[index%YEARS.length],ordinal=Math.floor(index/YEARS.length);
  const start=new Date(Date.UTC(year,5,1,18)+Math.floor(ordinal*364/144)*86400000).toISOString();
  return {id:910000+index,team_id:TEAM_ID,is_game:true,name:`History game ${index}`,start_date:start,
    opponent_name:`Opponent ${index%17}`,location_name:`Field ${index%6}`,game_type:'home',game_type_code:1,
    notes:`Bring both uniforms. Match ${index}. Meet 30 minutes before kickoff. 雨天決行.`,uniform:index%2?'Blue':'White',
    points_for_team:index%7,points_for_opponent:index%4,is_availability_enabled:true,updated_at:'2026-10-12T22:00:00.000Z'};
}
export function fixtureAvailability(index){return {id:610000+index,team_id:TEAM_ID,event_id:910000+Math.floor(index/PLAYER_COUNT),member_id:510000+index%PLAYER_COUNT,status_code:index%3};}
const collection=(rows,extra={})=>({collection:{items:rows.map(row=>({data:Object.entries(row).map(([name,value])=>({name,value})),links:[]})),links:[],...extra}});
const kinds={'/v3/events/search':'events','/v3/availabilities/search':'attendance','/v3/members/search':'roster','/v3/teams/search':'catalog','/v3/locations/search':'locations','/v3/opponents/search':'opponents'};
export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/__fixture/config'){await env.STATE.put('config',await request.text());return Response.json({saved:true});}
  if(path==='/__fixture/status')return Response.json({calls:await env.STATE.get('calls','json')||[]});
  if(request.headers.get('authorization')!=='Bearer synthetic-connection-throughput-token')return Response.json({error:'Synthetic credential required'},{status:401});
  const kind=kinds[path],page=Number(url.searchParams.get('page_number')||1),requestedSize=Number(url.searchParams.get('page_size')||0);let rows;
  if(path==='/v3/me')rows=[{id:123,name:'Synthetic throughput owner'}];
  else if(kind==='catalog')rows=[{id:TEAM_ID,name:'Five seasons of history',time_zone:'UTC',season_name:'2031 unverified marketing label'}];
  else if(kind==='roster')rows=Array.from({length:PLAYER_COUNT+1},(_,i)=>({id:510000+i,team_id:TEAM_ID,is_player:true,first_name:'Player',last_name:String(i),jersey_number:String(i+1)}));
  else if(kind==='events')rows=Array.from({length:EVENT_COUNT},(_,i)=>fixtureEvent(i));
  else if(kind==='attendance')rows=Array.from({length:EVENT_COUNT*PLAYER_COUNT},(_,i)=>fixtureAvailability(i));
  else if(kind==='locations'||kind==='opponents')rows=[];
  else return Response.json({unsupported:path},{status:404});
  if(kind==='events'||kind==='attendance'){
    const event=row=>kind==='events'?row:fixtureEvent(row.event_id-910000);
    if(url.searchParams.has('updated_since'))rows=rows.filter(row=>Date.parse(event(row).updated_at)>=Date.parse(url.searchParams.get('updated_since')));
    if(url.searchParams.has('started_after'))rows=rows.filter(row=>Date.parse(event(row).start_date)>=Date.parse(url.searchParams.get('started_after')));
    if(url.searchParams.has('started_before'))rows=rows.filter(row=>Date.parse(event(row).start_date)<=Date.parse(url.searchParams.get('started_before')));
    rows.sort((a,b)=>event(b).start_date.localeCompare(event(a).start_date)||b.id-a.id);
  }
  const total=rows.length,size=requestedSize?Math.min(requestedSize,50):total||1,selected=requestedSize?rows.slice((page-1)*size,page*size):rows;
  const extra=requestedSize?{page_info:{total_items:total,page_size:size,page_number:page},links:page*size<total?[{rel:'next',href:(()=>{const next=new URL(url);next.searchParams.set('page_number',String(page+1));return next.href;})()}]:[]}:{};
  const body=JSON.stringify(collection(selected,extra)),calls=await env.STATE.get('calls','json')||[];
  calls.push({kind:kind||'me',path,search:url.search,page,page_size:requestedSize||null,rows:selected.length,bytes:new TextEncoder().encode(body).length,status:200,at:Date.now()});await env.STATE.put('calls',JSON.stringify(calls));
  return new Response(body,{headers:{'Content-Type':'application/vnd.collection+json'}});
}};
