// Synthetic contracts only. No real provider account or external data is used.
const col=rows=>({collection:{items:rows.map(r=>({data:Object.entries(r).map(([name,value])=>({name,value})),links:[]})),links:[]}});
export default {async fetch(request,env){
  const u=new URL(request.url),p=u.pathname,s=u.searchParams;
  if(p==='/__fixture/config'){await env.STATE.put('config',await request.text());return Response.json({saved:true});}
  if(p==='/__fixture/status'){const config=await env.STATE.get('config','json')||{};return Response.json({calls:await env.STATE.get('calls','json')||[],held:await env.STATE.get('held','json')||null,history_holds:Object.entries(config.gotsport||{}).filter(([,team])=>team.holdHistoryPage!=null).map(([team,value])=>({team,page:value.holdHistoryPage}))});}
  if(p.startsWith('/v3/')&&request.headers.get('authorization')!=='Bearer synthetic-materialization-token')return Response.json({error:'Synthetic account credential required'},{status:401});
  const config=await env.STATE.get('config','json')||{},calls=await env.STATE.get('calls','json')||[];
  calls.push({path:p,search:u.search,at:Date.now()});await env.STATE.put('calls',JSON.stringify(calls));
  const teamId=s.get('team_id')||p.match(/\/teams\/(\d+)\/matches$/)?.[1],team=config.gotsport?.[teamId]||{},eventId=s.get('event_id');let value;
  if(p==='/api/v1/team_ranking_data/team_details')value={id:Number(teamId),team_name:'Simulated Team '+teamId,club_name:'Fixture Club',club_id:10};
  else if(p==='/api/v1/team_ranking_data')value={team_ranking_data:{team_id:Number(teamId)},events:[]};
  else if(/\/api\/v1\/teams\/\d+\/matches$/.test(p)){
    // Capture the old page before holding it: unlink must fence this response,
    // even after a source request began with an active connection.
    const allRows=team.matches||[],page=Number(s.get('page')||1),pageSize=team.pageSize||50,rows=allRows.slice((page-1)*pageSize,page*pageSize);
    if(team.holdHistory||team.holdHistoryPage===page){await env.STATE.put('held',JSON.stringify({team:teamId,page,count:rows.length}));for(let i=0;i<200;i++){const current=(await env.STATE.get('config','json'))?.gotsport?.[teamId];if(!current?.holdHistory&&current?.holdHistoryPage!==page)break;await new Promise(r=>setTimeout(r,25));}await env.STATE.delete('held');}
    value={matches:rows,pagination:{current_page:page,total_pages:Math.ceil(allRows.length/pageSize),total_entries:allRows.length}};
  }
  else if(p==='/api/v1/event_ranking_data/event_details'){
    const metadata=Object.values(config.gotsport||{}).map(t=>t.events?.[eventId]).find(Boolean)||{};
    value={event:{id:Number(eventId),name:'Simulated '+eventId,tournament:true,league:false,schedule_groups:metadata.group?[{id:metadata.group,division:'Fixture division',brackets:[{id:metadata.bracket,schedule_group_id:metadata.group,name:'Fixture pool'}]}]:[],...(metadata.start?{start_date_formatted:{dashed:metadata.start}}:{}),...(metadata.end?{end_date_formatted:{dashed:metadata.end}}:{})}};
  }
  else if(p==='/api/v1/event_ranking_data/flight_matches')value=[...new Map(Object.values(config.gotsport||{}).flatMap(t=>t.matches||[]).filter(g=>String(g.event_id)===eventId&&String(g.schedule_id)===s.get('flight_id')).map(g=>[g.id,g])).values()];
  else if(p==='/api/v1/event_ranking_data/flight_registrations')value=[];
  else if(p==='/v3/me')value=col([{id:123,name:'Synthetic owner'}]);
  else if(p==='/v3/teams/search')value=col(config.teamsnap?.teams||[]);
  else if(p==='/v3/members/search')value=col((config.teamsnap?.members||[]).filter(r=>!teamId||String(r.team_id)===teamId));
  else if(p==='/v3/events/search')value=col((config.teamsnap?.events||[]).filter(r=>!teamId||String(r.team_id)===teamId));
  else if(p==='/v3/availabilities/search')value=col((config.teamsnap?.attendance||[]).filter(r=>!teamId||String(r.team_id)===teamId));
  else if(['/v3/locations/search','/v3/opponents/search'].includes(p))value=col([]);
  if(value===undefined)return Response.json({unsupported:p},{status:404});
  return Response.json(value);
}};
