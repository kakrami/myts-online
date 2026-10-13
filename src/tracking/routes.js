import {readAuthBody} from '../application/auth-routes.js';
import {invalid} from '../read-model/selection.js';

const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const pageSize=(value,fallback,maximum)=>{const n=value==null?fallback:Number(value);if(!Number.isInteger(n)||n<1||n>maximum)throw invalid('Choose a supported capture page size.','capture_page_invalid');return n;};
const scope=value=>({team_id:value.team_id,team_season_id:value.team_season_id,attachment_id:value.attachment_id});
const ownerCondition=(owner,security)=>({sql:'EXISTS(SELECT 1 FROM security_sessions s JOIN security_owner o ON o.id=1 WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.password_revision=o.password_revision)',params:[owner.session_id,security.now()]});

/** Selective raw tracking is private evidence; it never uses viewer projections. */
export async function trackingRoutes(request,{security,captures,serviceFactory}={}){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!path.startsWith('/api/tracking/'))return null;
 const owner=await security.authenticateRequest(request);
 const service=captures??await serviceFactory(owner);
 const query=Object.fromEntries(url.searchParams);
 if(path==='/api/tracking/games'&&method==='GET')return json(await service.games(scope(query),{limit:pageSize(query.limit,50,50),cursor:query.cursor??null}));
 if(path==='/api/tracking/plans'&&method==='POST'){
  const body=await readAuthBody(request,8192);
  return json(await service.plan({...scope(body),event_id:body.event_id,plan_id:body.plan_id},{limit:pageSize(body.limit,50,50),cursor:body.cursor??null,precondition:ownerCondition(owner,security)}));
 }
 if(path==='/api/tracking/captures'){
  if(method==='GET')return json(await service.list(scope(query),{limit:pageSize(query.limit,20,20),cursor:query.cursor??null}));
  if(method==='POST'){
   const body=await readAuthBody(request);
   return json(await service.create({plan_id:body.plan_id,half:body.half,start_seconds:body.start_seconds,duration_seconds:body.duration_seconds,track_ids:body.track_ids},{precondition:ownerCondition(owner,security)}),202);
  }
 }
 const match=path.match(/^\/api\/tracking\/captures\/([0-9a-f-]{36})(\/download)?$/);
 if(match&&method==='GET')return match[2]?service.download(match[1]):json(await service.status(match[1]));
 return null;
}
