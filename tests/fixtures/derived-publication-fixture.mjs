import {traceNativeGame,traceRadar,traceProvider,gamePages,traceStorage} from './trace-analysis-native.mjs';
import {ANALYSIS_SCHEMA} from '../../src/analysis/schema.js';
import {SYNC_SCHEMA} from '../../src/sync/schema.js';
import {SourceTransport} from '../../src/sources/http.js';

export const DERIVED_AT=Date.parse('2026-10-13T05:20:00Z');
export const DERIVED_SCOPE={teamId:'team',seasonId:'season',connectionId:'root',accountId:'account',sourceTeamId:'trace/account/400',sourceEventId:'trace/account/4001'};
// All native rows are produced by the production Trace collector and repository.
// This finite, synthetic response stream never contacts a provider.
export async function derivedPublicationFixture({historyCount=25}={}){
 const f=traceStorage();for(const sql of [...ANALYSIS_SCHEMA,...SYNC_SCHEMA])f.sqlite.exec(sql);
 const game=traceNativeGame(),provider=traceProvider(game),pages=await gamePages(provider);
 for(const page of pages)await f.save(page);
 await f.repo.ingestSourcePage({accountId:'account',generation:1,records:{teams:[{id:'trace:400',provider:'trace',native_id:'400',account_id:'account',name:'Us',details:JSON.stringify({account_owned:true,catalog_scan_id:'catalog'})}]},scanId:'catalog'});
 const header=pages[0].fixtures[0];
 for(let offset=0;offset<historyCount;offset+=24)await f.repo.ingestSourcePage({accountId:'account',generation:1,records:{},fixtures:Array.from({length:Math.min(24,historyCount-offset)},(_,n)=>({...header,id:'trace:'+(5000+offset+n),native_id:String(5000+offset+n),starts_at:'2026-09-02T17:00:00Z'})),scanId:'history'});
 await f.repo.createTeam({teamId:'team',seasonId:'season',name:'Synthetic publication team',timezone:'UTC',seasonYear:2026});
 const attachment=await f.repo.attachTeam({...DERIVED_SCOPE});
 f.sqlite.prepare("INSERT INTO team_source_connections(id,app_team_id,source_team_id,account_id,scope_mode,created_at,input_revision,reconciled_revision) VALUES('root','team','trace/account/400','account','observed_history','2026-10-13T05:00:00Z',1,0)").run();
 f.sqlite.prepare("INSERT INTO team_connection_seasons(connection_id,team_season_id,attachment_id,basis) VALUES('root','season',?,'events')").run(attachment.id);
 const children=pages.flatMap(page=>page.children).map(child=>({provider:child.provider,component:child.kind,scope:child.scope,resourceKey:child.scope,args:child.args,stage:'analysis',priority:20,accountId:'account',accountGeneration:1,recurring:false})),radar=traceRadar(game),calls=[];
 let responseRevision=0;
 const fetch=async(url,options)=>{
  calls.push({url,operation:options?.body?JSON.parse(options.body).operationName:null,revision:responseRevision});
  if(url.endsWith('/users/self/token'))return Response.json({data:{user_id:1,token:'synthetic-token',timestamp:1}});
  if(url.includes('/test-assets/radar2'))return new Response('Optional synthetic radar forbidden',{status:403});
  if(url.includes('/test-assets/radar'))return Response.json(radar);
  const request=JSON.parse(options.body);
  if(request.operationName==='game')return Response.json({data:{game}});
  if(request.operationName==='getHaloData'){const s=request.variables.segments[0];return Response.json({data:{halo:{ring:[[s.local_start,'L'],[s.local_start+s.duration-100*responseRevision,'L']]}}});}
  if(request.operationName==='gameStats')return Response.json({data:{gameStats:{available:'ready',possession:50+responseRevision,total_possession:120,shots:{total:1,made:0,items:[{start:1700002012500,x:200+responseRevision,y:300,side:request.variables.side,made:false}]}}}});
  if(request.operationName==='gameStatsHeatmap')return Response.json({data:{playerGameHeatMap:{map:[[0,1+responseRevision],[2,0]]}}});
  throw Error('Unexpected synthetic provider operation '+request.operationName);
 };
 return {...f,game,children,calls,attachment,rows:(sql,...params)=>f.sqlite.prepare(sql).all(...params).map(row=>({...row})),transportFactory:()=>new SourceTransport({}, {fetch}),advanceDerivedResponse(){responseRevision++;radar.frm.at(-1).t+=100;},correctGameDate(value){game.full_date=value;},historyCount};
}

export const DERIVED_SEED_TABLES=['provider_accounts','app_teams','team_seasons','team_read_state','source_teams','account_source_teams','source_players','players','events','team_projection_runs','team_projection_state','team_source_attachments','source_events','source_event_teams','source_event_state','player_source_links','event_source_links','team_player_rows','team_event_rows','source_trace_components','source_game_members','source_game_moments','source_tracking_segments','source_stat_summaries','source_stat_items','source_heatmaps','source_component_coverage','team_source_connections','team_connection_seasons','team_event_season_resolutions'];
