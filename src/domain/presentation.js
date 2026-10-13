const PUBLIC=new Set(['gotsport','live']);
const rank={gotsport:0,live:1,teamsnap:2,trace:3};
export function localEventDay(team,start,local) {return start?new Intl.DateTimeFormat('en-CA',{timeZone:team.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start)):local;}
export function playerPresentation(teamId,seasonId,playerId,sources,fields={}) {
  sources=[...sources].sort((a,b)=>(a.roster_authority??0)-(b.roster_authority??0)||(a.provider==='teamsnap'?0:1)-(b.provider==='teamsnap'?0:1)||a.id.localeCompare(b.id));
  return {app_team_id:teamId,team_season_id:seasonId,player_id:playerId,name:'name'in fields?fields.name:sources[0].name,jersey:'jersey'in fields?fields.jersey:sources[0].jersey,source_ids:JSON.stringify(sources.map(r=>r.id).sort())};
}
export function eventPresentation(team,season,eventId,sources,fields={},competitionIds=new Map(),divisionIds=new Map(),identityConflict=false) {
  sources=[...sources].sort((a,b)=>rank[a.provider]-rank[b.provider]||a.id.localeCompare(b.id));
  const schedule=sources.find(r=>PUBLIC.has(r.provider))||sources[0],result=sources.find(r=>PUBLIC.has(r.provider)&&r.status==='FINAL'&&r.home_score!==null&&r.away_score!==null)||sources.find(r=>r.status==='FINAL'&&r.home_score!==null&&r.away_score!==null)||schedule;
  const starts_at='starts_at'in fields?fields.starts_at:('local_day'in fields?null:schedule.starts_at),local='local_day'in fields?fields.local_day:schedule.local_day,local_day=localEventDay(team,starts_at,local);
  if(local_day&&(local_day<season.start_day||local_day>=season.end_day))return null;
  const own_side=schedule.own_side,oriented=r=>r.own_side===own_side?[r.home_score,r.away_score]:[r.away_score,r.home_score],[nativeHome,nativeAway]=oriented(result),home_score='home_score'in fields?fields.home_score:nativeHome,away_score='away_score'in fields?fields.away_score:nativeAway;
  const disagreement=sources.filter(r=>r.status==='FINAL'&&r.home_score!==null&&r.away_score!==null&&(oriented(r)[0]!==nativeHome||oriented(r)[1]!==nativeAway)).map(r=>({source_id:r.id,provider:r.provider,home_score:oriented(r)[0],away_score:oriented(r)[1]}));
  const officialConflict=PUBLIC.has(result.provider)&&disagreement.some(r=>PUBLIC.has(r.provider));
  return {app_team_id:team.id,team_season_id:season.id,event_id:eventId,competition_id:schedule.competition_key?competitionIds.get(schedule.competition_key)||null:null,division_id:schedule.division_key?divisionIds.get(schedule.division_key)||null:null,starts_at,local_day,type:fields.type??schedule.type,status:fields.status??result.status,conditional:schedule.conditional,own_side,home_name:fields.home_name??schedule.home_label,away_name:fields.away_name??schedule.away_label,home_score,away_score,goals_for:own_side==='home'?home_score:away_score,goals_against:own_side==='home'?away_score:home_score,title:fields.title??schedule.title,venue:fields.venue??schedule.venue,source_ids:JSON.stringify(sources.map(r=>r.id).sort()),schedule_source_id:schedule.id,result_source_id:result.id,result_conflict:officialConflict&&!('home_score'in fields&&'away_score'in fields)?1:0,identity_conflict:identityConflict?1:0,conflict:disagreement.length?JSON.stringify(disagreement):null};
}
