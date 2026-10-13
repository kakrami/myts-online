// Synthetic TeamSnap Collection+JSON contract. No live provider or credential.
export const EVENT_COUNT = 160;
export const PLAYER_COUNT = 11;
export const TEAM_ID = 321;
export const fixtureNotes = index => `Complete note ${index}: ` + '雪'.repeat(7870);
export function fixtureEvent(index, revision = 0) {
  return {id:910000+index,team_id:TEAM_ID,is_game:true,
    name:`Synthetic game ${index} `+'題'.repeat(900),
    start_date:`${2023+Math.floor(index/40)}-09-${String(index%28+1).padStart(2,'0')}T18:00:00Z`,
    opponent_name:'Synthetic opponent '+'敵'.repeat(900),location_name:'Synthetic field '+'場'.repeat(900),
    game_type:'home',game_type_code:1,notes:fixtureNotes(index),uniform:'衣'.repeat(900),
    points_for_team:index%7,points_for_opponent:index%4,is_availability_enabled:true,updated_at:'2026-10-12T22:00:00.000Z',
    metadata:{description:'unused provider metadata '.repeat(380),revision}};
}
export function fixtureAvailability(index, statusShift = 0) {
  return {id:610000+index,team_id:TEAM_ID,event_id:910000+Math.floor(index/PLAYER_COUNT),member_id:510000+index%PLAYER_COUNT,
    status_code:(index+statusShift)%3,metadata:{description:'availability metadata '.repeat(72)}};
}
export const collectionBody = (rows, extra = {}) => ({collection:{items:rows.map(row=>({data:Object.entries(row).map(([name,value])=>({name,value})),links:[]})),links:[],...extra}});
const pathKind = {'/v3/events/search':'events','/v3/availabilities/search':'attendance','/v3/members/search':'roster','/v3/teams/search':'catalog','/v3/locations/search':'locations','/v3/opponents/search':'opponents'};
export default {async fetch(request, env) {
  const url=new URL(request.url),path=url.pathname;
  if(path==='/__fixture/config'){await env.STATE.put('config',await request.text());return Response.json({saved:true});}
  if(path==='/__fixture/status')return Response.json({calls:await env.STATE.get('calls','json')||[],held:await env.STATE.get('held','json')||null});
  if(request.headers.get('authorization')!=='Bearer synthetic-large-history-token')return Response.json({error:'Synthetic credential required'},{status:401});
  const config=await env.STATE.get('config','json')||{},kind=pathKind[path],page=Number(url.searchParams.get('page_number')||1),requestedSize=Number(url.searchParams.get('page_size')||0);
  let rows;
  if(path==='/v3/me')rows=[{id:123,name:'Synthetic large-history owner'}];
  else if(kind==='catalog')rows=[{id:TEAM_ID,name:'Synthetic complete history',time_zone:'America/Los_Angeles',season_name:'2031 unverified label'}];
  else if(kind==='roster')rows=Array.from({length:PLAYER_COUNT},(_,index)=>({id:510000+index,team_id:TEAM_ID,is_player:true,first_name:'Player',last_name:String(index),jersey_number:String(index+1)}));
  else if(kind==='events'){
    rows=Array.from({length:EVENT_COUNT},(_,index)=>fixtureEvent(index,config.eventRevision||0));
    if(config.largePageMetadata)for(const row of rows)row.metadata.description+='P'.repeat(50000);
    // One stable recent day is configured before the initial import, so ordinary
    // date-window replays cover40 unchanged games without wall-clock drift.
    if(config.recentDay)for(const row of rows)if(row.id>=910120)row.start_date=config.recentDay+'T18:00:00Z';
    if(config.extraEvent)rows.unshift({...fixtureEvent(EVENT_COUNT),id:919999,start_date:(config.recentDay||'2026-09-20')+'T18:00:00Z'});
    for(const row of rows)row.updated_at=config.updatedAt||row.updated_at;
    if(url.searchParams.has('updated_since'))rows=rows.filter(row=>Date.parse(row.updated_at)>=Date.parse(url.searchParams.get('updated_since')));
    if(url.searchParams.has('started_after'))rows=rows.filter(row=>Date.parse(row.start_date)>=Date.parse(url.searchParams.get('started_after')));
    if(url.searchParams.has('started_before'))rows=rows.filter(row=>Date.parse(row.start_date)<=Date.parse(url.searchParams.get('started_before')));
    // Server ordering follows the supported query; synthetic IDs break equal dates.
    rows.sort((a,b)=>b.start_date.localeCompare(a.start_date)||b.id-a.id);
  }else if(kind==='attendance'){
    rows=Array.from({length:EVENT_COUNT*PLAYER_COUNT},(_,index)=>fixtureAvailability(index,config.statusShift||0));
    if(url.searchParams.has('started_after'))rows=rows.filter(row=>Date.parse(config.recentDay&&row.event_id>=910120?config.recentDay+'T18:00:00Z':fixtureEvent(row.event_id-910000).start_date)>=Date.parse(url.searchParams.get('started_after')));
    if(url.searchParams.has('started_before'))rows=rows.filter(row=>Date.parse(config.recentDay&&row.event_id>=910120?config.recentDay+'T18:00:00Z':fixtureEvent(row.event_id-910000).start_date)<=Date.parse(url.searchParams.get('started_before')));
    rows.sort((a,b)=>b.event_id-a.event_id||b.id-a.id);
  }
  else if(kind==='locations'||kind==='opponents')rows=[];
  else return Response.json({unsupported:path},{status:404});
  const total=rows.length,paged=requestedSize>0,pageSize=paged?Math.min(requestedSize,50):total||1,selected=paged?rows.slice((page-1)*pageSize,page*pageSize):rows;
  const extra=paged?{page_info:{total_items:total,page_size:pageSize,page_number:page},links:page*pageSize<total?[{rel:'next',href:(()=>{const next=new URL(url);next.searchParams.set('page_number',String(page+1));return next.href;})()}]:[]}:{};
  const body=JSON.stringify(collectionBody(selected,extra)),calls=await env.STATE.get('calls','json')||[];
  const attempt=calls.filter(call=>call.kind===kind&&call.page===page).length+1;
  const shouldFail=!!kind&&config.failOnce?.kind===kind&&config.failOnce.page===page&&!calls.some(call=>call.fault==='transient');
  calls.push({kind,path,search:url.search,page,page_size:requestedSize||null,rows:selected.length,bytes:new TextEncoder().encode(body).length,status:shouldFail?503:200,attempt,...(shouldFail?{fault:'transient'}:{})});await env.STATE.put('calls',JSON.stringify(calls));
  if(shouldFail)return Response.json({error:'Synthetic transient failure'},{status:503});
  if(kind&&config.hold?.kind===kind&&config.hold.page===page){
    await env.STATE.put('held',JSON.stringify({kind,page,rows:selected.length,ids:selected.map(row=>row.id),attempt}));
    for(let count=0;count<300;count++){const now=await env.STATE.get('config','json');if(now?.hold?.kind!==kind||now.hold.page!==page)break;await new Promise(resolve=>setTimeout(resolve,25));}
    await env.STATE.delete('held');
  }
  return new Response(body,{headers:{'Content-Type':'application/vnd.collection+json'}});
}};
