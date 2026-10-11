import { native, requireValue, teamRecord, text } from './common.js';
import { ranking } from './gotsport.js';
import { unique } from './http.js';
import { collectSource } from './index.js';

/** Provider-hosted public discovery. Selection and attachment belong to the app. */
export async function searchGotSport(transport,{q='',state='',age=10,gender='m',page=1}={}) {
  q=text(q,100);state=text(state,8).toUpperCase();age=Number(age);page=Number(page);
  requireValue(Number.isInteger(age)&&age>=7&&age<=19&&['m','f'].includes(gender)&&Number.isInteger(page)&&page>=1&&page<=1000&&(!state||/^[A-Z]{2,3}$/.test(state)),'Invalid search filters.','invalid_input');
  const raw=await ranking(transport,'/team_ranking_data',{
    'search[team_or_club_name]':q,'search[team_country]':'USA','search[age]':age,'search[gender]':gender,'search[page]':page,
    ...(state?{'search[team_association]':state,'search[filter_by]':'state'}:{}),
  });
  requireValue(Array.isArray(raw.team_ranking_data)&&raw.team_ranking_data.length<=500&&raw.pagination,'Invalid GotSport search response.','unsupported_response');
  const pages=Number(raw.pagination.total_pages),total=Number(raw.pagination.total_count);
  requireValue(Number.isSafeInteger(pages)&&pages>=0&&Number.isSafeInteger(total)&&total>=0&&(!total||pages>=page),'Invalid GotSport search pagination.','unsupported_response');
  const teams=unique(raw.team_ranking_data,(r)=>native(r.team_id)).map((r)=>{
    const id=native(r.team_id);requireValue(id&&text(r.team_name),'GotSport search returned an incomplete team.','unsupported_response');
    const club=text(r.club_name),name=text(r.team_name),full=name.toLowerCase().startsWith(club.toLowerCase())?name:[club,name].filter(Boolean).join(' ');
    return {...teamRecord('gotsport',id,full,{catalog_verified:true,club_name:club,age:r.age??null,gender:r.gender??null,region:r.team_association??null,source_url:`https://rankings.gotsport.com/teams/${id}/upcoming-games`}),club,age:r.age??null,gender:r.gender??null,region:r.team_association??null};
  });
  return {records:{teams},teams,page,pages,total,nextPage:page<pages?page+1:null};
}

/** Accept an exact provider team page or an explicitly pasted native ID. */
export async function resolveGotSportPage(transport,value) {
  let id=native(typeof value==='string'?value.trim():'');
  if(!id){
    let u;try{u=new URL(String(value));}catch{}
    requireValue(u&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&['rankings.gotsport.com','system.gotsport.com'].includes(u.hostname),'Paste a public GotSport team page.','invalid_input');
    const match=u.pathname.match(/^\/teams\/([1-9]\d{0,14})(?:\/(?:upcoming-games|past-games|details))?\/?$/);
    id=match?.[1]||'';
    requireValue(id&&!u.search,'Paste a public GotSport team page.','invalid_input');
  }
  const result=await collectSource({provider:'gotsport',kind:'profile',scope:id,args:{team_id:id},transport});
  return {...result,team:result.records.teams[0],teamId:id};
}
