import {TeamGameDecisions} from './team-game-decisions.js';
import {assertSameOrigin} from '../security/index.js';
import {readAuthBody} from './auth-routes.js';
import {json} from './http.js';
import {invalid} from '../read-model/selection.js';
export async function teamGameIdentityRoutes(request,context){
 const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/identities/team-games'))return null;
 const service=new TeamGameDecisions(context.db,context),query=Object.fromEntries(url.searchParams);
 if(path==='/api/identities/team-games'&&request.method==='GET')return json(await service.list(query,{after:query.cursor??'',limit:Number(query.limit??25)}));
 if(request.method==='POST'&&['/api/identities/team-games/review','/api/identities/team-games/decision'].includes(path)){assertSameOrigin(request);const body=await readAuthBody(request);return json(path.endsWith('/review')?await service.review(body):await service.decide(body),path.endsWith('/decision')?202:200);}
 throw invalid('That team-local game action is unavailable.','method_not_allowed',405);
}
