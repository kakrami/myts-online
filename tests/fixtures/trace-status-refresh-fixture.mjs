import {collectSource} from '../../src/sources/index.js';
import {DomainRepository} from '../../src/domain/repository.js';
import {traceNativeGame} from './trace-analysis-native.mjs';
import {createHash} from 'node:crypto';
export function traceStatusScenario(db,{count=1}={}){
 const repo=new DomainRepository(db),account={provider:'trace',id:'account',native_id:'1',generation:1},credential='PHPSESSID=synthetic-status';
 const games=Array.from({length:count},(_,i)=>{const game=traceNativeGame();game.game_id=4001+i;game.home_team.score=2;game.away_team.score=1;game.approx_half_duration=25;for(const moment of game.moments){moment.game_id=game.game_id;moment.game_clip_id=game.game_id*10+moment.half;}return game;});
 let status='completed';
 const calls=[];
 const transport=()=>({observations:[],async get(url,options={}){
  let value;if(url.endsWith('/users/self/token'))value={data:{user_id:1,token:'synthetic-token',timestamp:1}};
  else{const request=JSON.parse(options.body);calls.push(request);
   if(request.operationName==='teamGames')value={data:{teamGames:games.map(game=>({game_id:game.game_id,full_date:game.full_date,approx_half_duration:game.approx_half_duration,sport_type:'soccer',status,home_team:game.home_team,away_team:game.away_team}))}};
   else if(request.operationName==='game'){const game=structuredClone(games.find(game=>game.game_id===request.variables.game_id));delete game.status;value={data:{game}};}
   else throw Error('Unexpected status fixture operation '+request.operationName);
  }
  const raw=JSON.stringify(value),observation={endpoint:new URL(url).origin+new URL(url).pathname,params:{},status:200,at:new Date().toISOString(),retrieved_at:new Date().toISOString(),hash:createHash('sha256').update(raw).digest('hex'),bytes:Buffer.byteLength(raw)};this.observations.push(observation);return {value,observation};
 }});
 async function collect(component,gameId=4001,cursor={}){const scope=component==='games'?'trace:400':`trace:${gameId}:trace:400`,args={team_id:'400',game_id:String(gameId),profile_hash:'synthetic-profile'},scanId=crypto.randomUUID();return {...await collectSource({provider:'trace',kind:component,scope,args,cursor,transport:transport(),account,credential,scanId}),provider:'trace',component,resourceKey:scope,accountId:'account',generation:1,scanId};}
 const save=page=>repo.ingestSourcePage(page),run=async(component,gameId,cursor)=>save(await collect(component,gameId,cursor));
 return {repo,account,games,calls,collect,save,run,setStatus:value=>{status=value;}};
}
