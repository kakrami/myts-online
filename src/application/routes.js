import {SecurityStore,assertSameOrigin,ownerCookie,requestSession} from '../security/index.js';
import {DomainRepository,sourceKey} from '../domain/repository.js';
import {ReadRepository} from '../read-model/repository.js';
import {FeatureReads} from '../read-model/feature-reads.js';
import {CursorCodec} from '../read-model/cursor.js';
import {invalid} from '../read-model/selection.js';
import {ApplicationSyncService} from './sync-service.js';
import {ConnectionService} from './connections.js';
import {applicationAuthRoutes,readAuthBody} from './auth-routes.js';
import {TeamFeatures} from './team-features.js';
import {TeamCatalog} from './team-catalog.js';
import {sourceTeamRoutes} from './source-team-routes.js';
import {bootstrapModel} from './bootstrap.js';
import {searchGotSport,resolveGotSportPage} from '../sources/discovery.js';
import {SourceTransport} from '../sources/http.js';
import {JobCoordinator} from '../sync/coordinator.js';
import {EventEditor} from './event-editor.js';
import {AnalysisReads} from '../analysis/reads.js';
import {analysisRoutes} from '../analysis/routes.js';
import {reportingRoutes} from '../reporting/routes.js';
import {dataFileRoutes} from '../reporting/data-routes.js';
import {trackingRoutes} from '../tracking/routes.js';
import {trackingCaptureService} from './tracking.js';
import {reportService,dataFileService} from './reports.js';
import {identityRoutes} from './identity-routes.js';
import {TeamLifecycleService} from './team-lifecycle.js';
import {json,input,actor} from './http.js';
import {PublicHistoryService} from './public-history.js';
import {digest} from '../security/crypto.js';

const OWNER_ONLY=new Set(['/api/connections','/api/preferences','/api/inclusion','/api/inclusion/june','/api/inclusion/batch','/api/inclusion/choices','/api/sources/gotsport/search','/api/sources/gotsport/resolve','/api/attachments']);
const SHARED_METADATA=new Set(['/api/revisions','/api/status','/api/branding']);
const decode=value=>{try{return decodeURIComponent(value);}catch{throw invalid('The resource is invalid.');}};
const integer=(value,fallback,min=1,max=100)=>{const n=value==null?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw invalid('Invalid page size.');return n;};
const category=path=>path.startsWith('/api/match')||path.startsWith('/api/analysis/matches')?'matches':path.startsWith('/api/players')?'players':path==='/api/team'?'team':path.startsWith('/api/competition')?'competitions':path.startsWith('/api/bookmarks')?'bookmarks':path==='/api/schedule'||path==='/api/calendar'?'schedule':'overview';

export async function applicationRoutes(request,env,{db,installation,extraRoutes=[],syncOptions={}}) {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const security=new SecurityStore(db,{bootstrapPassword:env.ADMIN_KEY});
  if(path==='/api/bootstrap'&&method==='GET')return json(await bootstrapModel(request,{db,installation,security}));
  if(path==='/api/owner/initialize'&&method==='POST'){
    assertSameOrigin(request);if(request.headers.has('x-view-key'))throw invalid('Open owner sign-in at /admin.','owner_required',401);const body=await readAuthBody(request.clone());const state=await installation.inspect();
    if(state.state!=='ready'){
      // A schema page and its checks use their own invocation budget. Even the
      // final page yields before password derivation and the atomic owner batch.
      const result=await installation.advance(body.password);return json({...result,continue:true},202);
    }
    const session=await security.initializeOwner(body.password,{clientKey:request.headers.get('cf-connecting-ip')??'local'});
    return json({ok:true,role:'owner',expires_at:session.expires_at,setup:{state:'ready',progress:100,owner_ready:true},continue:false},200,{'Set-Cookie':ownerCookie(session.token)});
  }
  const state=await installation.inspect();if(['maintenance','upgrade_required','upgrading'].includes(state.state))throw invalid('myTS is being updated. Your saved data is preserved; please try again shortly.','installation_maintenance',503);if(state.state!=='ready')throw invalid('Initialize this new installation first.','installation_uninitialized',503);
  const domain=new DomainRepository(db),sync=new ApplicationSyncService(db,env,syncOptions);
  const auth=await applicationAuthRoutes(request,{security,domain,transportFactory:()=>new SourceTransport(env),enqueueDiscovery:account=>sync.enqueueDiscovery(account.id)});if(auth)return auth;
  if(path.startsWith('/api/reports'))return await reportingRoutes(request,{security,reports:reportService(db,env,{cursor:new CursorCodec(await security.getCursorSigningKey()),wake:()=>sync.wake()})})??json({error:{code:'not_found',message:'This report route is unavailable.'}},404);
  if(path.startsWith('/api/data/'))return await dataFileRoutes(request,{security,dataFiles:dataFileService(db,env,{wake:()=>sync.wake()})})??json({error:{code:'not_found',message:'This data file route is unavailable.'}},404);
  if(path.startsWith('/api/tracking/'))return await trackingRoutes(request,{security,serviceFactory:async()=>trackingCaptureService(db,env,{actor:{owner:true},cursor:new CursorCodec(await security.getCursorSigningKey()),wake:()=>sync.wake()})})??json({error:{code:'not_found',message:'This tracking capture route is unavailable.'}},404);
  const publicHistory=path.match(/^\/api\/matches\/([^/]+)\/h2h\/(history|refresh)$/);
  if(publicHistory){
    if(!((publicHistory[2]==='history'&&method==='GET')||(publicHistory[2]==='refresh'&&method==='POST')))return json({error:{code:'method_not_allowed',message:'Use the history read or refresh action.'}},405);
    // This is the sole narrow viewer write: bounded, credential-free public
    // collection anchored to a match the same viewer can already read.
    if(method==='POST')assertSameOrigin(request);
    const selection=input(url),principal=await security.authenticateRequest(new Request(request.url,{method:'GET',headers:request.headers}),{projection:{teamId:selection.team_id,category:'matches'}});
    const requesterKey=principal.role==='viewer'?await digest(request.headers.get('x-view-key')):'owner';
    const history=new PublicHistoryService(db,{principal,requesterKey,sync});
    return json(method==='POST'?await history.request(selection,decode(publicHistory[1]),await readAuthBody(request)):await history.status(selection,decode(publicHistory[1])),method==='POST'?202:200);
  }
  const seasonCatalog=path.match(/^\/api\/teams\/([^/]+)\/seasons$/);
  const teamLogo=path.match(/^\/api\/teams\/([^/]+)\/logo$/);
  const ownerRoute=OWNER_ONLY.has(path)||path.startsWith('/api/accounts/')||path.startsWith('/api/teams')&&!((seasonCatalog||teamLogo)&&method==='GET')||path.startsWith('/api/attachments/')||path.startsWith('/api/connections/')||path.startsWith('/api/identities');
  const principal=await security.authenticateRequest(request,ownerRoute?{}:{projection:{teamId:seasonCatalog||teamLogo?decode((seasonCatalog??teamLogo)[1]):url.searchParams.get('team_id'),category:method==='GET'&&(seasonCatalog||teamLogo||SHARED_METADATA.has(path)||path.startsWith('/api/source-teams/'))?'shared_metadata':category(path)}}),access=actor(principal);
  const cursor=new CursorCodec(await security.getCursorSigningKey()),features=new TeamFeatures(db,access,{cursor}),catalog=new TeamCatalog(db,access,{cursor}),analysis=new AnalysisReads(db,access,{cursor}),reads=new FeatureReads(db,access,{cursor,analysisReads:analysis}),jobs=new JobCoordinator(db);
  const selection=input(url);
  const identityResponse=await identityRoutes(request,{db,actor:access,cursor,sync});if(identityResponse)return identityResponse;
  const sourceTeamResponse=await sourceTeamRoutes(request,{db,actor:access,cursor});if(sourceTeamResponse)return sourceTeamResponse;
  if(path==='/api/overview'&&method==='GET')return json(await reads.overview(selection));
  if(path==='/api/schedule'&&method==='GET')return json(await reads.schedule(selection,{limit:integer(url.searchParams.get('limit'),50),cursor:url.searchParams.get('cursor')}));
  if(path==='/api/calendar'&&method==='GET')return json(await reads.calendar(selection,{from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
  if(path==='/api/team'&&method==='GET')return json(selection.section==='trophies'?await reads.trophies(selection,{limit:integer(selection.limit,50),cursor:selection.cursor??null}):await analysis.team(selection,{query:selection.query??'',sort:selection.sort??'name',direction:selection.direction??'asc',limit:integer(selection.limit,50),cursor:selection.cursor??null}));
  if(path==='/api/competitions'&&method==='GET')return json(await reads.competitions(selection,{limit:integer(selection.limit,25),cursor:selection.cursor??null}));
  const competition=path.match(/^\/api\/competitions\/([^/]+)$/);if(competition&&method==='GET')return json(await reads.competition(selection,decode(competition[1]),{division_id:selection.division_id??null,view:selection.team_filter==='own'||selection.view==='own'?'own':'all',limit:integer(selection.limit,50),cursor:selection.cursor??null,standings_limit:integer(selection.standings_limit,100),standings_cursor:selection.standings_cursor??null,pool_counts_cursor:selection.pool_counts_cursor??null}));
  const matchDetail=path.match(/^\/api\/matches\/([^/]+)$/);if(matchDetail&&method==='GET')return json(await reads.match(selection,decode(matchDetail[1]),{tab:selection.tab??'overview',limit:integer(selection.limit,50),cursor:selection.cursor??null,players_sort:selection.players_sort??selection.sort??'name',players_direction:selection.players_direction??selection.direction??'asc',attendance_limit:integer(selection.attendance_limit,50),attendance_cursor:selection.attendance_cursor??null,h2h_limit:integer(selection.h2h_limit,50),h2h_cursor:selection.h2h_cursor??null,h2h_range:selection.h2h_range??'all',h2h_upcoming_limit:integer(selection.h2h_upcoming_limit,50),h2h_upcoming_cursor:selection.h2h_upcoming_cursor??null,h2h_anchor:selection.h2h_anchor??null}));
  const award=path.match(/^\/api\/awards(?:\/([^/]+))?$/);if(award){const body=await readAuthBody(request);if(method==='POST'&&!award[1]||method==='PUT'&&award[1])return json(await reads.setAward(selection,{...body,...(award[1]?{id:decode(award[1])}:{})},body.revision??0),award[1]?200:201);if(method==='DELETE'&&award[1])return json(await reads.deleteAward(selection,decode(award[1]),body.revision));}
  const playerDetail=path.match(/^\/api\/players\/([^/]+)$/);if(playerDetail&&method==='GET')return json(await new AnalysisReads(db,access,{cursor}).player(selection,decode(playerDetail[1]),{limit:integer(selection.limit,50),cursor:selection.cursor??null}));
  const matchPlayerDetail=path.match(/^\/api\/match-players\/([^/]+)\/([^/]+)$/);if(matchPlayerDetail&&method==='GET')return json(await new AnalysisReads(db,access,{cursor}).matchPlayer(selection,decode(matchPlayerDetail[1]),decode(matchPlayerDetail[2])));
  const eventEdit=path.match(/^\/api\/matches\/([^/]+)\/(editor|correction)$/);if(eventEdit){const editor=new EventEditor(db,access,{reads,sync}),id=decode(eventEdit[1]);if(method==='GET'&&eventEdit[2]==='editor')return json(await editor.read(selection,id));if(['PUT','DELETE'].includes(method)&&eventEdit[2]==='correction'){const body=await readAuthBody(request);return json(method==='PUT'?await editor.save(selection,id,body.fields,body.revision):await editor.reset(selection,id,body.revision),202);}}
  const analysisResponse=await analysisRoutes(request,{db,actor:access,cursor,enqueueRefresh:args=>sync.enqueueAnalysisRefresh(args)});if(analysisResponse)return analysisResponse;
  if(path==='/api/revisions'&&method==='GET'){
    const context=await metadataContext(reads,catalog,selection),state=await reads.stateQuery(context.selection).first();
    const catalogs=await db.prepare('SELECT COALESCE(t.seasons_revision,0) seasons,COALESCE(t.attachments_revision,0) connections,COALESCE(c.teams_revision,0) teams,COALESCE(c.branding_revision,0) branding FROM app_teams a LEFT JOIN team_catalog_state t ON t.app_team_id=a.id LEFT JOIN catalog_state c ON c.id=1 WHERE a.id=?').bind(selection.team_id).first();
    return json({revision:{content:state?.content_revision??0,status:state?.status_revision??0,seasons:catalogs.seasons,...(access.owner?{connections:catalogs.connections,teams:catalogs.teams,branding:catalogs.branding}:{})},projection_pending:!!state?.pending});
  }
  if(path==='/api/preferences'){
    if(method==='GET')return json(await features.preferences());
    if(method==='PATCH'){const body=await readAuthBody(request);return json(await features.saveTheme(body.theme,body.revision));}
  }
  if(path==='/api/teams'&&method==='GET')return json(await catalog.teams({limit:integer(selection.limit,50),cursor:selection.cursor??null,preferred_team_id:selection.preferred_team_id??null}));
  if(seasonCatalog&&method==='GET')return json(await catalog.seasons(decode(seasonCatalog[1]),{limit:integer(selection.limit,25),cursor:selection.cursor??null,preferred_season_id:selection.preferred_season_id??null}));
  if(teamLogo&&method==='GET')return json(await catalog.logo(decode(teamLogo[1])));
  if(path==='/api/connections'&&method==='GET')return json(await new ConnectionService(db,{features,sync,owner:principal}).readReceipt(url.searchParams.get('request_id')));
  if(path==='/api/connections'&&method==='POST')return json(await new ConnectionService(db,{features,sync,owner:principal,now:()=>security.now()}).create(await readAuthBody(request)),202);
  const connectionCatalog=path.match(/^\/api\/teams\/([^/]+)\/connections$/);
  if(connectionCatalog&&method==='GET')return json(await catalog.connections(decode(connectionCatalog[1]),{limit:integer(selection.limit,100),cursor:selection.cursor??null}));
  const connectionCommand=path.match(/^\/api\/connections\/([^/]+)(?:\/(sync))?$/);
  if(connectionCommand){
    const connectionId=decode(connectionCommand[1]),commands=new ConnectionService(db,{features,sync,owner:principal,now:()=>security.now()});
    if(method==='POST'&&connectionCommand[2]==='sync'){await commands.assertSession();return json(await sync.syncConnection(connectionId,{refresh:true}),202);}
    if(method==='DELETE'&&!connectionCommand[2]){const body=await readAuthBody(request);if(typeof body.team_id!=='string'||!Number.isSafeInteger(body.generation)||body.generation<1)throw invalid('Reload this connection before removing it.','revision_invalid');return json(await sync.detachConnection({teamId:body.team_id,connectionId,generation:body.generation,precondition:commands.sessionCondition()}));}
  }
  if(path==='/api/teams'&&method==='POST'){
    const body=await readAuthBody(request),team=await domain.createTeam({name:body.name,timezone:body.timezone,seasonYear:body.season_year,requestId:body.request_id});
    return json({team:{...team,seasons:[{id:team.season_id}]},season_id:team.season_id},201);
  }
  const teamCommand=path.match(/^\/api\/teams\/([^/]+)$/);if(teamCommand){const id=decode(teamCommand[1]);if(method==='PUT'){const body=await readAuthBody(request);return json(await features.renameTeam(id,body.name,body.revision));}if(method==='DELETE'){const body=await readAuthBody(request);if(!Number.isSafeInteger(body.revision)||body.revision<0)throw invalid('Reload the team before removing it.','revision_invalid');return json(await new TeamLifecycleService(db,env,{wake:()=>sync.wake()}).beginDelete(id,{revision:body.revision}),202);}}
  const attachments=path.match(/^\/api\/teams\/([^/]+)\/attachments(?:\/([^/]+))?$/);
  if(attachments){const teamId=decode(attachments[1]);await features.team(teamId);
    if(method==='GET'&&!attachments[2])return json(await catalog.attachments(teamId,{limit:integer(selection.limit,100),cursor:selection.cursor??null}));
    if(method==='POST'&&!attachments[2])return json(await new ConnectionService(db,{features,sync,owner:principal,now:()=>security.now()}).createLegacyAttachment(teamId,await readAuthBody(request)),202);
    if(method==='DELETE'&&attachments[2])return json(await sync.detach({teamId,attachmentId:decode(attachments[2]),precondition:new ConnectionService(db,{features,sync,owner:principal,now:()=>security.now()}).sessionCondition()}));
  }
  const syncMatch=path.match(/^\/api\/attachments\/([^/]+)\/sync$/);
  if(syncMatch&&method==='POST')return json(await sync.syncAttachment(decode(syncMatch[1])),202);
  const candidateMatch=path.match(/^\/api\/accounts\/([^/]+)\/(teams|revisions)$/);
  if(candidateMatch&&method==='GET'){
    const accountId=decode(candidateMatch[1]),account=await db.prepare('SELECT id,active FROM provider_accounts WHERE id=?').bind(accountId).first();if(!account?.active)throw invalid('Reconnect this provider account.','account_unavailable',409);
    const status=await jobs.accountStatus(accountId);
    if(candidateMatch[2]==='revisions')return json({revision:{catalog:status.catalog_revision,status:status.status_revision}});
    const limit=integer(url.searchParams.get('limit'),50),sel={account_id:accountId},scope='owner/account/'+accountId,token=url.searchParams.get('cursor'),position=token?await cursor.verify(token,{selection:sel,revision:status.catalog_revision,scope}):[''];
    if(!Array.isArray(position)||position.length!==1||typeof position[0]!=='string')throw invalid('Invalid team continuation.');
    const where="a.account_id=? AND t.account_id=? AND json_extract(t.evidence,'$.account_owned')=1";
    const result=await db.batch([db.prepare(`SELECT COUNT(*) total FROM source_teams t JOIN account_source_teams a ON a.source_team_id=t.id WHERE ${where}`).bind(accountId,accountId),db.prepare(`SELECT t.id,t.provider,t.name,t.season_label,t.archived FROM source_teams t JOIN account_source_teams a ON a.source_team_id=t.id WHERE ${where} AND t.id>? ORDER BY t.id LIMIT ?`).bind(accountId,accountId,position[0],limit+1)]);
    const rows=result[1].results,items=rows.slice(0,limit),pending=status.groups.some(g=>['queued','running','retrying'].includes(g.state));
    return json({teams:items,items,total:result[0].results[0].total,next_cursor:rows.length>limit?await cursor.issue({selection:sel,revision:status.catalog_revision,scope,position:[items.at(-1).id]}):null,discovery:{state:pending?'queued':status.groups.some(g=>g.state==='blocked')?'blocked':status.groups.some(g=>g.state==='failed')?'failed':'ready',groups:status.groups}});
  }
  if(path==='/api/sources/gotsport/search'&&method==='GET'){
    const result=await searchGotSport(new SourceTransport(env),{...selection,page:selection.page||1});
    await domain.ingestSourcePage({records:result.records,fixtures:[]});
    return json({teams:result.teams.map(t=>({id:sourceKey('gotsport',t.native_id),name:t.name,club:t.club,age:t.age,gender:t.gender,region:t.region,season_label:t.season,official_url:(typeof t.details==='string'?JSON.parse(t.details):t.details)?.source_url,provider:'gotsport'})),total:result.total,page:result.page,pages:result.pages,next_page:result.nextPage});
  }
  if(path==='/api/sources/gotsport/resolve'&&method==='POST'){
    const body=await readAuthBody(request),result=await resolveGotSportPage(new SourceTransport(env),body.url);
    await domain.ingestSourcePage(result);
    return json({teams:result.records.teams.map(t=>({id:sourceKey('gotsport',t.native_id),name:t.name,season_label:t.season,provider:'gotsport'}))});
  }
  if(path==='/api/inclusion'){
    if(method==='GET')return json(await features.inclusion(selection.team_id,selection.team_season_id,{limit:integer(selection.limit,50),cursor:selection.cursor??null}));
    if(method==='DELETE')return json(await features.resetInclusion(selection.team_id,selection.team_season_id,await readAuthBody(request)));
  }
  if(path==='/api/inclusion/choices'&&method==='GET')return json(await features.inclusion(selection.team_id,selection.team_season_id,{limit:integer(selection.limit,50),cursor:selection.cursor??null}));
  if(path==='/api/inclusion/batch'&&method==='POST')return json(await features.saveInclusionBatch(selection.team_id,selection.team_season_id,await readAuthBody(request,40000)));
  if(path==='/api/inclusion/june'&&method==='PATCH'){const body=await readAuthBody(request);return json(await features.saveJune(selection.team_id,selection.team_season_id,body.included,body.revision));}
  if(path==='/api/branding'&&method==='GET')return json(await features.branding(selection.team_id,selection.team_season_id));
  if(path==='/api/branding/logo'&&method==='PUT'){const body=await readAuthBody(request,132096);return json(await features.saveLogo(selection.team_id,body.logo,body.revision));}
  if(path==='/api/branding/kits'&&method==='PUT'){const body=await readAuthBody(request);return json(await features.saveKits(selection.team_id,selection.team_season_id,body,body.revision));}
  if(path==='/api/bookmarks'&&method==='GET')return json({data:await features.bookmarks(selection.team_id,{team_filter:selection.team_filter??selection.team_id,period:selection.period??'upcoming',cursor:selection.cursor??null,limit:integer(selection.limit,50),teams_cursor:selection.teams_cursor??null,teams_limit:integer(selection.teams_limit,50)})});
  const bookmark=path.match(/^\/api\/bookmarks\/([^/]+)$/);if(bookmark&&method==='PUT'){const body=await readAuthBody(request);return json(await features.bookmark(selection.team_id,decode(bookmark[1]),body.saved));}
  if(path==='/api/status'&&method==='GET')return json(await statusModel(db,jobs,reads,selection,access,cursor,catalog));
  if(path==='/api/usage'&&method==='GET'){
    if(!access.owner)throw invalid('Sign in as the owner to view database usage.','owner_required',403);
    const result=await db.prepare('SELECT (SELECT COUNT(*) FROM source_events) source_events,(SELECT COUNT(*) FROM source_players) source_players,(SELECT COUNT(*) FROM sync_jobs) jobs,(SELECT COUNT(*) FROM app_teams) app_teams').all();
    return json({data:{database_bytes:result.meta.size_after??null,counts:result.results[0],request_queries:db.used,request_rows_read:db.rowsRead,request_rows_written:db.rowsWritten}});
  }
  for(const route of extraRoutes){const response=await route(request,{actor:access,principal,db,domain,security,sync,reads,features,cursor});if(response)return response;}
  throw invalid('This route is unavailable.','not_found',404);
}
async function metadataContext(reads,catalog,selection){
  if(selection.team_season_id)return reads.context(selection);
  const team=await catalog.activeTeam(selection.team_id);
  return {team,season:null,selection:{team_id:team.id,team_season_id:null,timezone:team.timezone}};
}
async function statusModel(db,jobs,reads,selection,access,cursor,catalog){
  const context=await metadataContext(reads,catalog,selection),summary=await jobs.status(selection.team_id),scope="EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=j.id AND s.app_team_id=?) AND j.stage NOT IN('export','maintenance')";
  const providers=(await db.prepare(`SELECT j.provider,j.stage,j.state,j.coverage,COUNT(*) count,MAX(j.last_attempt_at) last_attempt_at,MAX(j.last_retrieved_at) last_retrieved_at,MAX(j.last_saved_at) last_saved_at,MAX(j.last_complete_at) last_complete_at FROM sync_jobs j WHERE ${scope} GROUP BY j.provider,j.stage,j.state,j.coverage`).bind(selection.team_id).all()).results;
  const counts={total:summary.total,ready:0,queued:0,running:0,retrying:0,blocked:0,failed:0,disabled:0};summary.groups.forEach(g=>counts[g.state]+=g.count);
  const model={selection:context.selection,revision:{content:summary.content_revision,status:summary.status_revision},data:{summary:counts,providers:[...new Set(providers.map(p=>p.provider))].map(provider=>({provider,total:providers.filter(p=>p.provider===provider).reduce((n,p)=>n+p.count,0),groups:providers.filter(p=>p.provider===provider)})),projection_pending:!!summary.pending}};
  const resolution=await db.prepare('SELECT (SELECT COUNT(*) FROM team_seasons WHERE app_team_id=?) total,EXISTS(SELECT 1 FROM team_source_connections WHERE app_team_id=? AND active=1) connected').bind(selection.team_id,selection.team_id).first();
  model.data.season_resolution={state:resolution.total?'available':resolution.connected?'pending':'unavailable',total:resolution.total};
  if(access.owner)Object.assign(model.data,await catalog.pendingEvidence(selection.team_id));
  if(access.owner){const connections=await catalog.connections(selection.team_id,{limit:integer(selection.connections_limit??selection.attachments_limit,100),cursor:selection.connections_cursor??null});model.data.connections=connections.items;model.data.connections_page={total:connections.total,revision:connections.revision,next_cursor:connections.next_cursor};}
  if(access.owner){const limit=integer(selection.limit,50),sel={team_id:selection.team_id,kind:'jobs'},sc='owner/jobs/'+selection.team_id,pos=selection.cursor?await cursor.verify(selection.cursor,{selection:sel,revision:summary.status_revision,scope:sc}):[''];if(!Array.isArray(pos)||pos.length!==1||typeof pos[0]!=='string')throw invalid('Invalid job continuation.');
    const rows=(await db.prepare(`SELECT j.id,j.provider,j.component,j.stage,j.state,j.coverage,j.pages_saved,j.rows_saved,j.last_attempt_at,j.last_retrieved_at,j.last_saved_at,j.last_complete_at,CASE WHEN j.provider='teamsnap' AND j.component IN('events','attendance') THEN json_extract(j.checkpoint,'$.refresh.full.completed_at') END last_full_completed_at,CASE WHEN j.provider='teamsnap' AND j.component IN('events','attendance') THEN COALESCE(json_extract(j.checkpoint,'$.refresh.active.mode'),json_extract(j.checkpoint,'$.refresh.recent.mode'),json_extract(j.checkpoint,'$.refresh.full.mode')) END refresh_mode,j.last_error_code,j.last_error_message FROM sync_jobs j WHERE ${scope} AND j.id>? ORDER BY j.id LIMIT ?`).bind(selection.team_id,pos[0],limit+1).all()).results,items=rows.slice(0,limit);
    model.data.jobs={items,total:summary.total,next_cursor:rows.length>limit?await cursor.issue({selection:sel,revision:summary.status_revision,scope:sc,position:[items.at(-1).id]}):null};const attachments=await catalog.attachments(selection.team_id,{limit:integer(selection.attachments_limit,100),cursor:selection.attachments_cursor??null});model.data.attachments=attachments.items;model.data.attachments_page={total:attachments.total,revision:attachments.revision,next_cursor:attachments.next_cursor};
  }return model;
}
