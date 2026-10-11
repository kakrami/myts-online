import { DomainRepository } from '../domain/repository.js';
import { SecurityStore } from '../security/index.js';
import { collectSource, SourceTransport } from '../sources/index.js';
import { JobCoordinator } from '../sync/coordinator.js';
import { createSyncRuntime, wakeSync } from '../sync/runtime.js';
import { SyncError } from '../sync/errors.js';
import { buildMatchAnalysisPage } from '../analysis/projector.js';
import {collectTeamDeletion} from './team-lifecycle.js';

const PRIVATE = new Set(['teamsnap','trace']);
const CREDENTIAL_AUTH_ERRORS=new Set(['credential_invalid','credential_unreadable','account_changed','provider_authorization_expired']);
const ANALYSIS = new Set(['analytics','tracking','radar']);
const INTERVAL = {catalog:900000,profile:604800000,history:43200000,resolve:21600000,upcoming:900000,membership:10800000,event:43200000,division:3600000,standings:3600000,roster:21600000,events:900000,attendance:900000,games:900000,game:21600000,analytics:43200000,tracking:86400000,radar:86400000,locations:21600000,opponents:21600000,projection:3600000};
const parse = value => typeof value === 'string' ? JSON.parse(value || '{}') : value || {};
function requireValue(value, message, code='invalid_job') { if (!value) throw new SyncError(code,message,{kind:'permanent'}); return value; }
function successfulRetrieval(observations) {
  return (observations || []).filter(observation=>observation.status>=200&&observation.status<300&&observation.hash&&!observation.code)
    .map(observation=>Date.parse(observation.retrieved_at || observation.at)).filter(Number.isFinite).sort((a,b)=>a-b).at(-1);
}
function unavailableCoverage(value) {
  const rows = Array.isArray(value) ? value : [value];
  for (const state of ['unsupported','restricted','unpublished']) if (rows.some(row=>row===state || row?.availability===state || row?.state===state)) return state;
  return null;
}
function projectionSpec(teamId,seasonId, requestId=crypto.randomUUID()) {
  return {provider:'domain',component:'projection',stage:'projection',scope:teamId,resourceKey:seasonId,
    args:{teamId,seasonId,requestId},priority:100,intervalMs:INTERVAL.projection,recurring:false,
    subscriberMode:'projection',subscribers:[{kind:'team',key:`projection:${teamId}:${seasonId}`,teamId}]};
}
function analysisCatalogSpec(teamId,seasonId,requestId=crypto.randomUUID()) {
  return {provider:'analysis',component:'catalog',stage:'analysis',scope:teamId,resourceKey:seasonId,args:{teamId,seasonId,requestId},priority:75,recurring:false,subscriberMode:'inherit'};
}
const analysisPriority=(value,now)=>{const at=Date.parse(value||'');return !Number.isFinite(at)||at<now-60*86400000?20:at>now+30*86400000?40:70;};
async function collectAnalysisCatalog(db,lease,args,checkpoint) {
  requireValue(args.teamId===lease.scope&&args.seasonId===lease.resource_key,'Invalid analysis catalog demand.');
  const state=await db.prepare('SELECT projection_hash FROM team_projection_state WHERE app_team_id=? AND team_season_id=?').bind(args.teamId,args.seasonId).first();requireValue(state,'This team season is unavailable.');
  const fresh=checkpoint.projectionHash!==state.projection_hash,now=fresh?Date.now():checkpoint.now;
  const after=fresh?null:checkpoint.after;
  const rows=(await db.prepare(`WITH eligible AS(SELECT e.event_id,COALESCE(e.starts_at,'') AS starts_at,CASE WHEN e.starts_at IS NULL OR e.starts_at<? THEN 20 WHEN e.starts_at>? THEN 40 ELSE 70 END AS priority FROM team_events e WHERE e.app_team_id=? AND e.team_season_id=? AND (EXISTS(SELECT 1 FROM source_events s JOIN event_source_links l ON l.source_event_id=s.id JOIN canonical_event_ids c ON c.input_id=l.event_id JOIN team_source_attachments a ON a.app_team_id=e.app_team_id AND a.team_season_id=e.team_season_id AND a.account_id=s.account_id AND a.active=1 JOIN provider_accounts p ON p.id=a.account_id AND p.active=1 JOIN source_event_teams st ON st.source_event_id=s.id AND st.source_team_id=a.source_team_id WHERE s.provider='trace' AND c.canonical_id=e.event_id) OR EXISTS(SELECT 1 FROM analysis_overrides o WHERE o.app_team_id=e.app_team_id AND o.team_season_id=e.team_season_id AND (o.event_id=e.event_id OR o.kind='player_season')) OR EXISTS(SELECT 1 FROM analysis_track_assignments t JOIN event_source_links l ON l.source_event_id=t.source_event_id JOIN canonical_event_ids c ON c.input_id=l.event_id WHERE t.app_team_id=e.app_team_id AND t.team_season_id=e.team_season_id AND c.canonical_id=e.event_id))) SELECT * FROM eligible WHERE ? IS NULL OR priority<? OR (priority=? AND starts_at<?) OR (priority=? AND starts_at=? AND event_id>?) ORDER BY priority DESC,starts_at DESC,event_id LIMIT 33`).bind(new Date(now-60*86400000).toISOString(),new Date(now+30*86400000).toISOString(),args.teamId,args.seasonId,after?.eventId||null,after?.priority||0,after?.priority||0,after?.startsAt||'',after?.priority||0,after?.startsAt||'',after?.eventId||'').all()).results;
  const selected=rows.slice(0,32),last=selected.at(-1);
  return {statements:[],children:selected.map(event=>({provider:'analysis',component:'match',stage:'analysis',scope:args.teamId,resourceKey:`${args.seasonId}:${event.event_id}`,args:{teamId:args.teamId,seasonId:args.seasonId,eventId:event.event_id,requestId:args.requestId},priority:event.priority,recurring:false,subscriberMode:'inherit'})),checkpoint:{projectionHash:state.projection_hash,now,after:last?{priority:last.priority,startsAt:last.starts_at,eventId:last.event_id}:after},complete:rows.length<=32,coverage:rows.length<=32?'complete':'partial',publishContent:false};
}
function childPriority(child, page, now) {
  if (ANALYSIS.has(child.component)) return 20;
  if (child.component==='history') return 30;
  if (Number.isInteger(child.priority)) return child.priority;
  if (child.component==='game' || child.component==='fixture') {
    const native = String(child.args?.game_id || child.args?.fixture_id || '');
    const fixture = (page.fixtures || []).find(row=>String(row.native_id)===native);
    const at = Date.parse(fixture?.starts_at || fixture?.local_day || '');
    if (Number.isFinite(at)) return at<now-60*86400000?20:at>now+30*86400000?40:80;
  }
  return child.priority ?? 60;
}

/** Source and projection dispatcher. It never authenticates a user or creates an app team. */
export async function collectApplicationJob({db,env,lease,args,checkpoint}, options = {}) {
  if(lease.provider==='maintenance')return collectTeamDeletion({db,env,lease,args,checkpoint});
  if(lease.provider==='trace'&&lease.component==='tracking-capture'){
    requireValue(lease.stage==='export'&&typeof options.trackingCollector==='function','The tracking evidence collector is unavailable.','unsupported_component');
    return options.trackingCollector({db,env,lease,args,checkpoint},options);
  }
  const repo = new DomainRepository(db);
  if(lease.provider==='reports') {
    requireValue(lease.stage==='export'&&typeof options.reportCollector==='function','The report collector is unavailable.','unsupported_component');
    return options.reportCollector({db,env,lease,args,checkpoint});
  }
  if(lease.provider==='analysis') {
    if(lease.component==='catalog') {requireValue(lease.stage==='analysis','Invalid analysis catalog stage.');return collectAnalysisCatalog(db,lease,args,checkpoint);}
    requireValue(lease.stage==='analysis'&&lease.component==='match'&&args.teamId===lease.scope&&lease.resource_key===`${args.seasonId}:${args.eventId}`,'Invalid match analysis demand.');
    const page=await buildMatchAnalysisPage(db,{teamId:args.teamId,seasonId:args.seasonId,eventId:args.eventId,cursor:checkpoint});
    return {...page,coverage:['ready','estimated'].includes(page.coverage)?'complete':['pending','incomplete','human_review'].includes(page.coverage)?'partial':page.coverage,publishContent:false};
  }
  if (lease.provider==='domain') {
    requireValue(lease.stage==='projection' && lease.component==='projection' && args.teamId===lease.scope && args.seasonId===lease.resource_key,'Invalid projection demand.');
    const projection = await repo.buildProjectionPage(args.teamId,args.seasonId,checkpoint);
    const children=(projection.affectedTeams||[]).slice(0,127).map(affected=>projectionSpec(affected.app_team_id,affected.team_season_id));
    if(projection.published)children.push(analysisCatalogSpec(args.teamId,args.seasonId,args.requestId));
    return {statements:projection.statements,checkpoint:projection.checkpoint,children,complete:projection.complete,coverage:projection.complete?'complete':'partial',publishContent:false,rowsSaved:projection.rowsSaved||0};
  }
  const transport = options.transportFactory ? options.transportFactory(env) : new SourceTransport(env);
  try {
    let account=null,credential=null;
    if (PRIVATE.has(lease.provider)) {
      account = await db.prepare('SELECT * FROM provider_accounts WHERE id=? AND provider=? AND active=1 AND generation=?').bind(lease.account_id,lease.provider,lease.authorization_generation).first();
      if (!account) throw new SyncError('authorization_revoked','Provider authorization changed.',{kind:'blocked'});
      try {
        const loaded = options.credentialLoader ? await options.credentialLoader({db,env,account}) : await new SecurityStore(db).loadAccountCredential(account.id,{generation:account.generation});
        credential = typeof loaded==='string' ? loaded : loaded?.credential;
      } catch(error) {
        if(CREDENTIAL_AUTH_ERRORS.has(error.code))throw new SyncError('authentication_required','Reconnect the provider.',{kind:'blocked'});
        throw error;
      }
      if (!credential) throw new SyncError('authentication_required','Reconnect the provider.',{kind:'blocked'});
    }
    const page = await collectSource({provider:lease.provider,kind:lease.component,scope:lease.scope,args,cursor:checkpoint,transport,credential,account,scanId:lease.scan_id});
    const built = await repo.buildSourcePage({...page,coverage:page.sourceCoverage||page.coverage,accountId:account?.id || null,generation:account?.generation || null,provider:lease.provider,component:lease.component,resourceKey:lease.resource_key,scanId:lease.scan_id});
    // Discovery populates selectable native records only. Deep imports begin after explicit attach.
    const children = (lease.component==='catalog' && account ? [] : page.children).map(child=>({...child,
      stage:ANALYSIS.has(child.component)?'analysis':'source',priority:childPriority(child,page,Date.now()),intervalMs:INTERVAL[child.component] || 3600000}));
    // Every season is durably dirty already. Excess demand is recovered by the
    // bounded scheduled scan; a popular public resource cannot block ingestion.
    for (const affected of (built.affectedTeams || []).slice(0,Math.max(0,128-children.length))) children.push(projectionSpec(affected.app_team_id,affected.team_season_id));
    return {statements:built.statements,checkpoint:page.checkpoint,children,complete:page.complete,
      coverage:lease.stage==='analysis' ? unavailableCoverage(page.coverage) || (page.complete?'complete':'partial') : page.complete?'complete':'partial',
      retrievedAt:successfulRetrieval(page.observations),observations:page.observations,rowsSaved:Object.values(page.records).reduce((count,rows)=>count+rows.length,0)+page.fixtures.length,publishContent:false};
  } catch (error) {
    const at = successfulRetrieval(transport.observations);
    if (at !== undefined) error.retrievedAt=at;
    error.observations=transport.observations;
    throw error;
  }
}

/** Trusted owner-command helpers; API routes must authorize before invoking them. */
export class ApplicationSyncService {
  constructor(db,env,options={}) { this.db=db; this.env=env; this.options=options; this.repo=new DomainRepository(db); this.jobs=new JobCoordinator(db,options.coordinatorOptions); }
  async wake() { if (this.options.wake) return this.options.wake(this.env); return wakeSync(this.env); }
  async enqueueDiscovery(accountId,{wake=true}={}) {
    const account=await this.db.prepare('SELECT * FROM provider_accounts WHERE id=? AND active=1').bind(accountId).first();
    requireValue(account&&PRIVATE.has(account.provider),'Connect this provider account first.');
    const stale=await this.db.prepare('SELECT 1 FROM sync_jobs WHERE account_id=? AND authorization_generation<>? LIMIT 1').bind(account.id,account.generation).first();
    if(stale)await this.jobs.restartAccount(account.id);
    const id=await this.jobs.enqueue({provider:account.provider,accountId:account.id,accountGeneration:account.generation,component:'catalog',stage:'source',scope:account.id,resourceKey:account.id,args:{},priority:90,intervalMs:INTERVAL.catalog},[{kind:'account',key:account.id}]);
    if(wake)await this.wake();return {jobId:id,accountId:account.id};
  }
  async recoverDiscovery({afterAccountId=null,limit=2,wake=true}={}) {
    requireValue(Number.isInteger(limit)&&limit>=1&&limit<=3,'Recovery account page must be between one and three.');
    const accounts=(await this.db.prepare(`SELECT a.id FROM provider_accounts a JOIN security_account_credentials c ON c.account_id=a.id AND c.account_generation=a.generation LEFT JOIN sync_jobs j ON j.provider=a.provider AND j.account_scope=a.id AND j.component='catalog' AND j.scope=a.id AND j.resource_key=a.id WHERE a.active=1 AND (c.expires_at IS NULL OR c.expires_at>?) AND (? IS NULL OR a.id>?) AND (j.id IS NULL OR j.authorization_generation<>a.generation OR NOT EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=j.id AND s.kind='account' AND s.demand_key=a.id)) ORDER BY a.id LIMIT ?`).bind(Date.now(),afterAccountId,afterAccountId,limit).all()).results;
    for(const account of accounts)await this.enqueueDiscovery(account.id,{wake:false});
    if(wake&&accounts.length)await this.wake();return {queued:accounts.length,nextCursor:accounts.length===limit?accounts.at(-1).id:null};
  }
  async recoverProjections({limit=3,wake=true,reserveStatements=3}={}) {
    requireValue(Number.isInteger(limit)&&limit>=1&&limit<=5,'Recovery projection page must be between one and five.');
    requireValue(Number.isInteger(reserveStatements)&&reserveStatements>=0&&reserveStatements<=12,'Invalid recovery budget reserve.');
    const capacity=this.db.remaining===undefined?limit:Math.min(limit,Math.max(0,Math.floor((this.db.remaining-1-reserveStatements)/6)));
    if(!capacity)return {queued:0,deferred:true};
    const pending=(await this.db.prepare(`SELECT p.app_team_id,p.team_season_id FROM team_projection_state p LEFT JOIN sync_jobs j ON j.provider='domain' AND j.account_scope='public' AND j.component='projection' AND j.scope=p.app_team_id AND j.resource_key=p.team_season_id WHERE p.pending=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=p.app_team_id) AND (j.id IS NULL OR j.state IN('ready','disabled')) ORDER BY p.app_team_id,p.team_season_id LIMIT ?`).bind(capacity).all()).results;
    let queued=0;for(const team of pending)if((await this.enqueueProjection(team.app_team_id,team.team_season_id,{wake:false})).queued)queued++;
    if(wake&&queued)await this.wake();return {queued,more:pending.length===capacity};
  }
  async recoverDemand({wake=true}={}) {
    const capacity=this.db.remaining===undefined?2:Math.min(2,Math.max(0,Math.floor((this.db.remaining-12)/12)));
    const accounts=capacity?await this.recoverDiscovery({limit:capacity,wake:false}):{queued:0,nextCursor:null};
    const projections=await this.recoverProjections({limit:3,wake:false});
    if(wake&&(accounts.queued||projections.queued))await this.wake();return {accountsQueued:accounts.queued,projectionsQueued:projections.queued,more:!!accounts.nextCursor||!!projections.more||!!projections.deferred};
  }
  async candidates(accountId) {
    const account=await this.db.prepare('SELECT id FROM provider_accounts WHERE id=? AND active=1').bind(accountId).first();requireValue(account,'This account is unavailable.');
    return (await this.db.prepare(`SELECT t.id,t.provider,t.native_id,t.name,t.season_label,t.archived FROM source_teams t JOIN account_source_teams a ON a.source_team_id=t.id WHERE a.account_id=? AND t.account_id=? AND json_extract(t.evidence,'$.account_owned')=1 ORDER BY t.archived,t.name COLLATE NOCASE,t.id`).bind(accountId,accountId).all()).results;
  }
  async attachSelected({teamId,seasonId,sourceTeamId,accountId=null,profileBinding}) {
    const source=await this.db.prepare('SELECT * FROM source_teams WHERE id=?').bind(sourceTeamId).first();requireValue(source,'Select a discovered source team.');
    if(PRIVATE.has(source.provider)) {
      requireValue(accountId===source.account_id,'This source belongs to another account.');
      requireValue(await this.db.prepare("SELECT 1 FROM account_source_teams WHERE account_id=? AND source_team_id=?").bind(accountId,sourceTeamId).first(),'This account did not discover the selected team.');
      requireValue(parse(source.evidence).account_owned===true,'Select a team owned by this account.');
    } else requireValue(!accountId,'Public teams do not use a private account.');
    const attachment=await this.repo.attachTeam({teamId,seasonId,sourceTeamId,accountId,profileBinding});
    await this.syncAttachment(attachment.id,{wake:false});await this.enqueueProjection(teamId,seasonId,{wake:false});await this.wake();return attachment;
  }
  async syncAttachment(attachmentId,{wake=true}={}) {
    const attachment=await this.db.prepare('SELECT a.*,t.provider,t.native_id,t.name,t.evidence,t.scope,tm.timezone FROM team_source_attachments a JOIN source_teams t ON t.id=a.source_team_id JOIN app_teams tm ON tm.id=a.app_team_id WHERE a.id=? AND a.active=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=a.app_team_id)').bind(attachmentId).first();requireValue(attachment,'This source attachment is unavailable.');
    const evidence=parse(attachment.evidence),account=attachment.account_id ? await this.db.prepare('SELECT * FROM provider_accounts WHERE id=? AND active=1').bind(attachment.account_id).first() : null;
    if(PRIVATE.has(attachment.provider))requireValue(account&&account.provider===attachment.provider,'Reconnect this source account.');
    const base={provider:attachment.provider,stage:'source',scope:PRIVATE.has(attachment.provider)?`${attachment.provider}:${attachment.native_id}`:attachment.native_id,resourceKey:PRIVATE.has(attachment.provider)?`${attachment.provider}:${attachment.native_id}`:attachment.native_id,args:{team_id:attachment.native_id,team_name:attachment.name,timezone:evidence.timezone||'America/Los_Angeles'},...(account?{accountId:account.id,accountGeneration:account.generation}:{} )};
    const subscriber=[{kind:'team',key:attachment.id,teamId:attachment.app_team_id,generation:attachment.generation}];
    let components;
    if(attachment.provider==='gotsport')components=['profile'];
    else if(attachment.provider==='live') {requireValue(evidence.proof?.season||evidence.season,'The selected Live team needs published season evidence.');components=['upcoming','membership'];base.args.proof=evidence.proof || {season:evidence.season,season_name:evidence.season_name};}
    else if(attachment.provider==='teamsnap')components=['roster','events','attendance','locations','opponents'];
    else {requireValue(evidence.slug,'The discovered Trace profile is unavailable.');components=['games','roster'];base.args.slug=evidence.slug;}
    const specs=components.map(component=>({...base,component,priority:component==='events'||component==='roster'||component==='upcoming'||component==='games'?85:60,intervalMs:INTERVAL[component] || 3600000}));
    const ids=await this.jobs.enqueueMany(specs,subscriber,{refresh:true});
    if(wake)await this.wake();return {attachmentId,jobIds:ids};
  }
  async enqueueProjection(teamId,seasonId,{wake=true}={}) {
    const pending=await this.db.prepare('SELECT p.app_team_id FROM team_projection_state p JOIN team_seasons s ON s.id=p.team_season_id WHERE p.app_team_id=? AND p.team_season_id=? AND s.app_team_id=? AND p.pending=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=p.app_team_id)').bind(teamId,seasonId,teamId).first();
    if(!pending)return {queued:false};const spec=projectionSpec(teamId,seasonId);const id=await this.jobs.enqueue(spec,spec.subscribers);if(wake)await this.wake();return {queued:true,jobId:id};
  }
  async enqueueMatchAnalysis(teamId,seasonId,eventId,{wake=true}={}) {
    const event=await this.db.prepare('SELECT starts_at FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=?').bind(teamId,seasonId,eventId).first();requireValue(event,'This canonical match is unavailable.');
    const id=await this.jobs.enqueue({provider:'analysis',component:'match',stage:'analysis',scope:teamId,resourceKey:`${seasonId}:${eventId}`,args:{teamId,seasonId,eventId,requestId:crypto.randomUUID()},priority:analysisPriority(event.starts_at,Date.now()),recurring:false},[{kind:'team',key:`analysis:${teamId}:${seasonId}:${eventId}`,teamId}]);
    if(wake)await this.wake();return {queued:true,jobId:id};
  }
  async enqueueTrackSource({teamId,seasonId,eventId,sourceChildren},{wake=true}={}) {
    requireValue(eventId&&Array.isArray(sourceChildren)&&sourceChildren.length>0&&sourceChildren.length<=16,'Track source refresh requires a bounded match scope.');
    const first=sourceChildren[0];
    for(const child of sourceChildren)requireValue(child.provider==='trace'&&['tracking','analytics'].includes(child.component)&&child.accountId===first.accountId&&child.accountGeneration===first.accountGeneration&&child.args?.team_id===first.args?.team_id&&child.args?.game_id===first.args?.game_id&&child.args?.side===first.args?.side&&['home','away'].includes(child.args?.side)&&child.scope===child.resourceKey,'Track source refresh crossed its match or account.');
    const attachment=await this.db.prepare(`SELECT a.id,a.generation FROM team_source_attachments a JOIN source_teams t ON t.id=a.source_team_id JOIN provider_accounts p ON p.id=a.account_id AND p.active=1 JOIN source_event_teams st ON st.source_team_id=t.id JOIN source_events s ON s.id=st.source_event_id AND s.account_id=p.id JOIN event_source_links l ON l.source_event_id=s.id JOIN canonical_event_ids c ON c.input_id=l.event_id JOIN team_events e ON e.app_team_id=a.app_team_id AND e.team_season_id=a.team_season_id AND e.event_id=c.canonical_id WHERE a.active=1 AND a.app_team_id=? AND a.team_season_id=? AND a.account_id=? AND p.generation=? AND t.provider='trace' AND t.native_id=? AND s.provider='trace' AND s.native_id=? AND st.side=? AND c.canonical_id=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle life WHERE life.team_id=a.app_team_id) LIMIT 1`).bind(teamId,seasonId,first.accountId,first.accountGeneration,String(first.args.team_id),String(first.args.game_id),first.args.side,eventId).first();
    requireValue(attachment,'This attached account did not provide the selected match track.');
    const specs=sourceChildren.map(child=>({...child,stage:'analysis',priority:80,intervalMs:INTERVAL[child.component]||43200000}));
    const jobIds=await this.jobs.enqueueMany(specs,[{kind:'team',key:attachment.id,teamId,generation:attachment.generation}],{refresh:true});
    if(wake)await this.wake();return {queued:true,jobIds};
  }
  async enqueueAnalysisRefresh({teamId,seasonId,eventId=null,sourceChildren},{wake=true}={}) {
    if(sourceChildren?.length)await this.enqueueTrackSource({teamId,seasonId,eventId,sourceChildren},{wake:false});
    if(eventId)return this.enqueueMatchAnalysis(teamId,seasonId,eventId,{wake});
    const season=await this.db.prepare('SELECT 1 FROM team_seasons s WHERE id=? AND app_team_id=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id)').bind(seasonId,teamId).first();requireValue(season,'This team season is unavailable.');
    const id=await this.jobs.enqueue(analysisCatalogSpec(teamId,seasonId),[{kind:'team',key:`analysis:${teamId}:${seasonId}`,teamId}]);
    if(wake)await this.wake();return {queued:true,jobId:id};
  }
  async detach({teamId,attachmentId}) {
    const attachment=await this.db.prepare('SELECT * FROM team_source_attachments WHERE id=? AND app_team_id=?').bind(attachmentId,teamId).first();requireValue(attachment,'This source belongs to another team.');
    await this.repo.unlinkTeam({teamId,attachmentId});await this.jobs.unsubscribe('team',attachmentId);await this.enqueueProjection(teamId,attachment.team_season_id,{wake:false});await this.wake();return {detached:true};
  }
}
export function createApplicationRuntime(options={}) {
  return createSyncRuntime(context=>collectApplicationJob(context,options),options.runtimeOptions);
}
