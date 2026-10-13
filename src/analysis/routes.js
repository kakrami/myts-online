import { AnalysisService } from './service.js';
import { AnalysisReads } from './reads.js';
import { NativeTrackService } from './tracks.js';
import { invalid } from '../read-model/selection.js';
const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const decode=value=>{try{return decodeURIComponent(value);}catch{throw invalid('The resource address is invalid.','invalid_input',400);}};
async function boundedBody(request,maxBytes=8000){if(!request.headers.get('content-type')?.startsWith('application/json'))throw invalid('Send JSON for this action.','invalid_body',415);const reader=request.body?.getReader();if(!reader)throw invalid('Supply correction fields.');let size=0,raw='';const decoder=new TextDecoder();for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>maxBytes){await reader.cancel();throw invalid('This correction is too large.','invalid_body',413);}raw+=decoder.decode(p.value,{stream:true});}try{return JSON.parse(raw+decoder.decode());}catch{throw invalid('Send valid JSON.','invalid_body');}}
export async function analysisRoutes(request,{db,actor,cursor,enqueueRefresh,now}={}) {
  const url=new URL(request.url),path=url.pathname,query=Object.fromEntries(url.searchParams),options={cursor,enqueueRefresh,now};
  const tracks=path.match(/^\/api\/analysis\/matches\/([^/]+)\/tracks(?:\/([^/]+))?$/);
  if(tracks){const eventId=decode(tracks[1]),service=new NativeTrackService(db,actor,options);service.owner();if(request.method==='GET'&&!tracks[2])return json(await service.list(query,eventId,{limit:Number(query.limit||50),cursor:query.cursor||null}));if(tracks[2]&&['PUT','DELETE'].includes(request.method)){if(request.headers.get('origin')!==url.origin)throw invalid('Open this action in the app.','origin_invalid',403);const body=await boundedBody(request),input={...query,...body};return json(request.method==='PUT'?await service.set(input,eventId,decode(tracks[2]),body):await service.reset(input,eventId,decode(tracks[2]),body));}throw invalid('That method is unavailable.','method_not_allowed',405);}
  const native=path.match(/^\/api\/analysis\/matches\/([^/]+)\/native$/);
  if(native&&request.method!=='GET')throw invalid('That method is unavailable.','method_not_allowed',405);
  if(native&&request.method==='GET')return json(await new AnalysisReads(db,actor,options).nativeMaps(query,decode(native[1]),{playerId:query.player_id||null,team:query.team||'own',period:query.period||'full',kind:query.kind||'passes_all',limit:Number(query.limit||100),cursor:query.cursor||null}));
  const lineup=path.match(/^\/api\/matches\/([^/]+)\/lineup$/);
  if(lineup){const eventId=decode(lineup[1]),service=new AnalysisService(db,actor,options);if(request.method==='GET')return json(await service.lineup(query,eventId,{half:Number(query.half||1),limit:Number(query.limit||100),cursor:query.cursor||null}));if(['PUT','DELETE'].includes(request.method)){service.owner();if(request.headers.get('origin')!==url.origin)throw invalid('Open this action in the app.','origin_invalid',403);const body=await boundedBody(request,32000),input={...query,...body};return json(request.method==='PUT'?await service.setLineup(input,eventId,body):await service.resetLineup(input,eventId,body.revision));}throw invalid('That method is unavailable.','method_not_allowed',405);}
  const player=path.match(/^\/api\/players\/([^/]+)\/(editor|correction)$/),matchPlayer=path.match(/^\/api\/match-players\/([^/]+)\/([^/]+)\/(editor|correction)$/),match=path.match(/^\/api\/analysis\/matches\/([^/]+)$/);
  if(!player&&!matchPlayer&&!match)return null;
  if(match&&request.method!=='GET')throw invalid('That method is unavailable.','method_not_allowed',405);
  if(match&&request.method==='GET')return json(await new AnalysisReads(db,actor,options).match(query,decode(match[1]),{limit:Number(query.limit||50),cursor:query.cursor||null,sort:query.players_sort||query.sort||'name',direction:query.players_direction||query.direction||'asc'}));
  const ids=player?{kind:'player_season',playerId:decode(player[1])}:{kind:'player_match',eventId:decode(matchPlayer[1]),playerId:decode(matchPlayer[2])},action=(player||matchPlayer).at(-1),service=new AnalysisService(db,actor,options);
  if(action==='editor'&&request.method==='GET')return json(await service.editor(query,ids));
  if(action==='correction'&&['PUT','DELETE'].includes(request.method)){
    service.owner();if(request.headers.get('origin')!==url.origin)throw invalid('Open this action in the app.','origin_invalid',403);
    const body=await boundedBody(request),input={...query,...body};return json(request.method==='PUT'?await service.set(input,ids,body.fields||body.value,body.revision):await service.reset(input,ids,body.revision,{fields:body.fields||null}));
  }
  throw invalid('That method is unavailable.','method_not_allowed',405);
}
