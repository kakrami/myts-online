import {SourceTeamReads} from '../read-model/source-team.js';
import {json} from './http.js';
import {invalid} from '../read-model/selection.js';
export async function sourceTeamRoutes(request,{db,actor,cursor,now=Date.now}) {
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/source-teams\/([^/]+)$/);if(!match)return null;
  if(request.method!=='GET')throw invalid('This source-team action is unavailable.','method_not_allowed',405);
  let id;try{id=decodeURIComponent(match[1]);}catch{throw invalid('This source team is invalid.');}
  const query=Object.fromEntries(url.searchParams),reads=new SourceTeamReads(db,actor,{cursor,now});
  return json(await reads.detail(query,id,{limit:Number(query.limit||50),cursor:query.cursor||null}));
}
