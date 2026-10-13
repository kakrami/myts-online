import { SyncError, classifyFailure, logSyncFailure } from './errors.js';
import {publicHistoryKey,publicHistoryJob,publicHistoryProof,publicHistoryLive,publicHistoryContext,publicHistoryDemanded,publicHistoryQuery,publicHistoryJobAuthority} from './public-history.js';

const encoder = new TextEncoder();
// Only real immutable Reports jobs receive interactive service. The provider
// also owns Data files, which retain ordinary background scheduling.
const reportServiceJob=at=>`j.provider='reports' AND j.stage='export' AND j.component IN('capture','xlsx','pdf') AND EXISTS(SELECT 1 FROM report_snapshots rs LEFT JOIN report_exports re ON re.id=j.resource_key AND re.snapshot_id=rs.id AND re.format=j.component WHERE rs.id=json_extract(j.args,'$.snapshot_id') AND rs.app_team_id=j.scope AND rs.expires_at>${at} AND ((j.component='capture' AND j.resource_key=rs.id AND rs.state='capturing') OR(j.component IN('xlsx','pdf') AND re.id=json_extract(j.args,'$.export_id') AND re.state IN('queued','building') AND rs.state='ready')) AND EXISTS(SELECT 1 FROM sync_job_subscribers demand WHERE demand.job_id=j.id AND demand.kind='team' AND demand.app_team_id=rs.app_team_id AND demand.demand_key='report/'||rs.id))`;

const size = value => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const coverages = ['none','partial','complete','unpublished','restricted','unsupported'];
// Only this server-authored terminal receipt survives a routine interval. All
// args/generation/manual restarts still clear checkpoints. The collector checks
// its complete payload hash again before issuing any provider request.
const teamSnapReadyReceipt = `provider='teamsnap' AND stage='source' AND component IN('events','attendance') AND account_id IS NOT NULL AND json_extract(checkpoint,'$.protocol')='teamsnap-refresh-v1' AND json_extract(checkpoint,'$.finished')=1 AND json_extract(checkpoint,'$.refresh.protocol')='teamsnap-refresh-v1' AND json_type(checkpoint,'$.refresh.active')='null' AND json_type(checkpoint,'$.refresh.full')='object' AND json_extract(checkpoint,'$.refresh.binding.account_id')=account_id AND json_extract(checkpoint,'$.refresh.binding.authorization_generation')=authorization_generation AND json_extract(checkpoint,'$.refresh.binding.kind')=component AND json_extract(checkpoint,'$.refresh.binding.team_id')=CAST(json_extract(args,'$.team_id') AS TEXT) AND json_extract(checkpoint,'$.refresh.binding.args_url') IS json_extract(args,'$.url') AND length(json_extract(checkpoint,'$.refresh.binding.payload'))=64 AND json_extract(checkpoint,'$.refresh.binding.payload') NOT GLOB '*[^a-f0-9]*'`;
function retrievedTimestamp(value, now) {
  if (value === undefined || value === null) return null;
  const at = typeof value === 'string' ? Date.parse(value) : value;
  if (!Number.isSafeInteger(at) || at < 0 || at > now + 60000) throw new SyncError('contract_violation','Invalid retrieval timestamp.',{kind:'permanent'});
  return at;
}
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function observationRows(lease,observations,now) {
  if(!Array.isArray(observations)||observations.length>16) throw new SyncError('contract_violation','Source audit exceeded its page bound.',{kind:'permanent'});
  return observations.map((observation,index)=>{
    let endpoint;try{endpoint=new URL(observation.endpoint);}catch{throw new SyncError('contract_violation','Invalid audit endpoint.',{kind:'permanent'});}
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||observation.endpoint.length>1000) throw new SyncError('contract_violation','Unsafe audit endpoint.',{kind:'permanent'});
    const at=retrievedTimestamp(observation.at,now),retrievedAt=retrievedTimestamp(observation.retrieved_at,now);
    if(at===null||!Number.isInteger(observation.bytes)||observation.bytes<0||observation.bytes>8000000||(observation.status!==null&&(!Number.isInteger(observation.status)||observation.status<100||observation.status>599))) throw new SyncError('contract_violation','Invalid source audit metadata.',{kind:'permanent'});
    return {id:`${lease.id}:${lease.lease_token}:${index}`,job_id:lease.id,scan_id:lease.scan_id,attempt:lease.attempts,endpoint:endpoint.href,status:observation.status,at,retrieved_at:retrievedAt,bytes:observation.bytes,content_hash:/^[a-f0-9]{64}$/.test(observation.hash||'')?observation.hash:null,rows_count:Number.isInteger(observation.rows_count)&&observation.rows_count>=0?observation.rows_count:null,error_code:/^[a-z0-9_]{1,64}$/.test(observation.code||'')?observation.code:null};
  });
}
// A retained publication remains readable during its replacement, but automatic
// analysis still requires a settled projection at commit. Defer only a valid,
// exact saved-match demand; malformed/missing scopes keep normal failure handling.
const analysisPublicationReady = alias => `NOT EXISTS(SELECT 1 FROM team_projection_state p WHERE ${alias}.provider='analysis' AND ${alias}.stage='analysis' AND ${alias}.component='match' AND json_type(${alias}.args,'$.teamId')='text' AND json_type(${alias}.args,'$.seasonId')='text' AND json_type(${alias}.args,'$.eventId')='text' AND length(json_extract(${alias}.args,'$.teamId'))>0 AND length(json_extract(${alias}.args,'$.seasonId'))>0 AND length(json_extract(${alias}.args,'$.eventId'))>0 AND json_extract(${alias}.args,'$.teamId')=${alias}.scope AND ${alias}.resource_key=json_extract(${alias}.args,'$.seasonId')||':'||json_extract(${alias}.args,'$.eventId') AND p.app_team_id=${alias}.scope AND p.team_season_id=json_extract(${alias}.args,'$.seasonId') AND p.pending=1)`;
const activeAccount = alias => `(${alias}.account_id IS NULL OR EXISTS(SELECT 1 FROM provider_accounts a WHERE a.id=${alias}.account_id AND a.generation=${alias}.authorization_generation AND a.active=1 AND a.provider=${alias}.provider))`;
const field=(row,name)=>typeof row==='string'?`${row}.${name}`:row[name];
// Typed root demand carries continuing intent. A stale generation cannot admit,
// claim, fan out, or commit work after unlink, exclusion or account revocation.
const subscriberLive=(job,subscription,publicHistory=false,now=Date.now())=>{
  const key=field(subscription,'demand_key'),team=field(subscription,'app_team_id'),generation=field(subscription,'generation');
  // Keep authorization joins flat: these predicates also appear inside failure
  // and revision guards, where nested EXISTS chains exceed native D1 depth.
  const local=`${field(job,'provider')} IN('domain','analysis','reports','maintenance')`;
  return `(CASE WHEN ${publicHistoryKey(key)} THEN ${publicHistory?publicHistoryLive(job,subscription,String(Math.trunc(now))):'0'} WHEN substr(${key},1,11)='connection:' THEN EXISTS(SELECT 1 FROM team_source_connections c JOIN source_teams st ON st.id=c.source_team_id LEFT JOIN provider_accounts pa ON pa.id=c.account_id LEFT JOIN account_source_teams ast ON ast.account_id=c.account_id AND ast.source_team_id=c.source_team_id WHERE c.id=substr(${key},12) AND c.app_team_id=${team} AND c.active=1 AND c.generation=${generation} AND CASE WHEN ${field(job,'provider')}='domain' AND ${field(job,'component')}='connection' THEN st.provenance='provider' OR c.scope_mode='fixed_seasons' ELSE st.provenance='provider' AND (c.account_id IS NULL OR (pa.active=1 AND ast.source_team_id IS NOT NULL)) END) ELSE (NOT EXISTS(SELECT 1 FROM team_source_attachments a WHERE a.id=${key}) OR EXISTS(SELECT 1 FROM team_source_attachments a LEFT JOIN source_teams st ON st.id=a.source_team_id LEFT JOIN provider_accounts pa ON pa.id=a.account_id LEFT JOIN account_source_teams ast ON ast.account_id=a.account_id AND ast.source_team_id=a.source_team_id WHERE a.id=${key} AND a.app_team_id=${team} AND a.active=1 AND a.generation=${generation} AND (${local} OR (st.provenance='provider' AND (a.account_id IS NULL OR (pa.active=1 AND ast.source_team_id IS NOT NULL)))))) END)`;
};
const demanded = (alias,subscriberPredicate='1',publicHistory=false,now=Date.now()) => `EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=${alias}.id AND (${subscriberPredicate}) AND ((s.kind='account' AND NOT (${publicHistoryKey('s.demand_key')})) OR (${alias}.stage='maintenance' AND NOT (${publicHistoryKey('s.demand_key')}) AND EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id AND l.state='deleting')) OR (${alias}.stage<>'maintenance' AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id) AND ${subscriberLive(alias,'s',publicHistory,now)})))`;
const admission = (job,subscription,publicHistory=false,now=Date.now()) => `((${field(subscription,'kind')}='account' AND NOT (${publicHistoryKey(field(subscription,'demand_key'))})) OR EXISTS(SELECT 1 FROM app_teams t WHERE t.id=${field(subscription,'app_team_id')} AND ((${field(job,'stage')}<>'maintenance' AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id) AND ${subscriberLive(job,subscription,publicHistory,now)}) OR (NOT (${publicHistoryKey(field(subscription,'demand_key'))}) AND ${field(job,'provider')}='maintenance' AND ${field(job,'component')}='team_delete' AND ${field(job,'stage')}='maintenance' AND ${field(job,'scope')}=t.id AND ${field(job,'resource_key')}=t.id AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id AND l.state='deleted')))))`;
const jsonRow=alias=>Object.fromEntries(['kind','app_team_id','demand_key','generation','stage','provider','component','scope','resource_key','id','scan_id','account_id','account_scope','authorization_generation','args'].map(name=>[name,`json_extract(${alias},'$.${name}')`]));
const jsonAdmission=(job,subscription)=>admission(jsonRow(job),jsonRow(subscription));
const jsonAccount=alias=>`(json_extract(${alias},'$.account_id') IS NULL OR EXISTS(SELECT 1 FROM provider_accounts a WHERE a.id=json_extract(${alias},'$.account_id') AND a.generation=json_extract(${alias},'$.authorization_generation') AND a.active=1 AND a.provider=json_extract(${alias},'$.provider')))`;
// Coalesce active reconciliation, but a failed or backoff-delayed root cannot
// starve another source's already accepted publication. Missing/stale admission
// still blocks; explicit owner projection commands retain their separate path.
export const connectionEvidenceReady=(team,now=Date.now())=>`NOT EXISTS(SELECT 1 FROM team_source_connections c LEFT JOIN sync_jobs root_job ON root_job.provider='domain' AND root_job.component='connection' AND root_job.account_scope='public' AND root_job.scope=c.app_team_id AND root_job.resource_key=c.id WHERE c.app_team_id=${team} AND c.active=1 AND c.input_revision>c.reconciled_revision AND NOT COALESCE(json_extract(root_job.args,'$.generation')=c.generation AND json_extract(root_job.args,'$.inputRevision')=c.input_revision AND (root_job.state IN('failed','blocked') OR (root_job.state='retrying' AND root_job.next_at>${Math.max(0,Math.trunc(now))})),0))`;
const unavailableDemand=()=>Object.assign(new SyncError('demand_unavailable','This work no longer has an available team or account.',{kind:'permanent'}),{status:404});
const bounded = (value, name, max = 512) => {
  if (typeof value !== 'string' || !value || value.length > max) throw new SyncError('invalid_job', `Invalid ${name}.`, { kind: 'permanent' });
  return value;
};
function specRow(spec, at) {
  const accountId = spec.accountId || null;
  if (['teamsnap','trace'].includes(spec.provider) && !accountId) throw new SyncError('invalid_job','Private work requires an account scope.',{kind:'permanent'});
  const row = {
    id: crypto.randomUUID(), provider: bounded(spec.provider, 'provider', 32),
    account_scope: accountId || 'public', account_id: accountId,
    authorization_generation: accountId ? Number(spec.accountGeneration) : 0,
    component: bounded(spec.component, 'component', 64), stage: spec.stage || 'source', recurring:spec.recurring===false?0:1,
    scope: bounded(spec.scope, 'scope'), resource_key: bounded(spec.resourceKey, 'resource key'),
    args: JSON.stringify(spec.args || {}), checkpoint: '{}', scan_id: crypto.randomUUID(),
    priority: spec.priority ?? 50, ready_since: at, next_at: spec.nextAt ?? at,
    interval_ms: spec.intervalMs ?? 3600000,
  };
  if (!['source', 'projection', 'analysis','export','maintenance'].includes(row.stage) || !Number.isInteger(row.priority) || row.priority < 0 || row.priority > 100 || !Number.isSafeInteger(row.interval_ms) || row.interval_ms < 1 || !Number.isSafeInteger(row.next_at) || row.next_at<0 || (accountId && (!Number.isSafeInteger(row.authorization_generation) || row.authorization_generation < 1))) {
    throw new SyncError('invalid_job', 'Invalid execution scope.', { kind: 'permanent' });
  }
  if (size(row.args) > 8192) throw new SyncError('contract_violation', 'Job arguments exceed their bound.', { kind: 'permanent' });
  return row;
}
function subscriberRow(subscriber) {
  const kind = subscriber.kind;
  if (!['team', 'account'].includes(kind) || (kind === 'team' && !subscriber.teamId) || (kind === 'account' && subscriber.teamId)) throw new SyncError('invalid_job', 'Invalid subscriber scope.', { kind: 'permanent' });
  return { kind, demand_key: bounded(subscriber.key, 'demand key'), app_team_id: subscriber.teamId || null, generation: subscriber.generation || 1 };
}
const columns = ['id','provider','account_scope','account_id','authorization_generation','component','stage','scope','resource_key','args','checkpoint','scan_id','priority','ready_since','next_at','interval_ms','recurring'];
const keyJoin = (job, value) => `${job}.provider=json_extract(${value},'$.provider') AND ${job}.account_scope=json_extract(${value},'$.account_scope') AND ${job}.component=json_extract(${value},'$.component') AND ${job}.scope=json_extract(${value},'$.scope') AND ${job}.resource_key=json_extract(${value},'$.resource_key')`;
function insertJobs(guard, refresh=false, publicParents=false, choices='') {
  // A source page only advances the reconciliation input. Keep an in-progress
  // root's cursor and lease when that is the sole argument change; the root
  // materializer fences every page and performs its own final catch-up pass.
  // Identity/generation changes, completed scans, and all provider jobs retain
  // the ordinary reset behavior.
  const continuingConnection = "sync_jobs.provider='domain' AND sync_jobs.component='connection' AND sync_jobs.state IN('queued','running','retrying') AND json_remove(sync_jobs.args,'$.inputRevision')=json_remove(excluded.args,'$.inputRevision')";
  // Automatic publication/recovery may discover the same match while its
  // current input is already being served. Preserve that attempt's watermark,
  // cursor and lease. Explicit owner refreshes retain normal restart semantics.
  const continuingAnalysis = "sync_jobs.provider='analysis' AND sync_jobs.component='match' AND sync_jobs.state IN('queued','running','retrying') AND COALESCE(json_extract(excluded.args,'$.automatic'),0)=1";
  // New provider metadata is not authorization to repeat a denied request.
  // Explicit refresh and changed account authorization retain their own paths.
  const deniedSource = "sync_jobs.state='blocked' AND sync_jobs.last_error_code='source_access_denied'";
  const ordinaryReset = `sync_jobs.state='disabled' OR (sync_jobs.args<>excluded.args AND NOT ((${continuingConnection}) OR (${continuingAnalysis}) OR (${deniedSource}))) OR sync_jobs.authorization_generation<>excluded.authorization_generation`;
  const preserve=publicParents?`EXISTS(SELECT 1 FROM ph_existing WHERE id=sync_jobs.id)`:'0';
  const freshPublic=publicParents?`(SELECT restart FROM ph_existing WHERE id=sync_jobs.id)`:'0';
  const reset=publicParents?`(CASE WHEN ${preserve} THEN ${freshPublic} ELSE (${ordinaryReset}) END)`:ordinaryReset;
  const refreshable = refresh ? "sync_jobs.state<>'running'" : '0';
  const scanReset = `(${reset}) OR ((${refreshable}) AND sync_jobs.state='ready')`;
  const admitted=publicParents?`, ph_incoming AS MATERIALIZED(SELECT value,key FROM json_each(?))${choices}, ph_admitted AS MATERIALIZED(SELECT v.value,v.key FROM ph_incoming v WHERE ${guard}), ph_existing AS MATERIALIZED(SELECT j.id,MAX(CASE WHEN j.state IN('ready','failed','blocked','disabled') AND ${publicHistoryJobAuthority('j','ph',{root:'ph.root_source_team_id'})} AND NOT EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=ph.id AND r.generation=ph.generation AND r.job_id=j.id) THEN 1 ELSE 0 END) restart FROM sync_jobs j JOIN ph_admitted v ON ${keyJoin('j','v.value')} JOIN ph_permitted permitted ON permitted.child_key=v.key JOIN ph ON ph.id=permitted.demand_id WHERE ${publicHistoryJob('j')} GROUP BY j.id) `:'';
  return admitted+`INSERT INTO sync_jobs(${columns.join(',')}) SELECT ${columns.map(column=>`json_extract(v.value,'$.${column}')`).join(',')} FROM ${publicParents?'ph_admitted':'json_each(?)'} v WHERE ${publicParents?'1':guard} ON CONFLICT(provider,account_scope,component,scope,resource_key) DO UPDATE SET args=${publicParents?`CASE WHEN (${preserve}) OR (${continuingAnalysis}) THEN sync_jobs.args ELSE excluded.args END`:`CASE WHEN ${continuingAnalysis} THEN sync_jobs.args ELSE excluded.args END`},priority=${publicParents?`CASE WHEN ${preserve} THEN sync_jobs.priority ELSE excluded.priority END`:'excluded.priority'},authorization_generation=excluded.authorization_generation,generation=sync_jobs.generation+CASE WHEN ${reset} THEN 1 ELSE 0 END,state=CASE WHEN (${reset}) OR (${refreshable}) THEN 'queued' ELSE sync_jobs.state END,lease_token=CASE WHEN ${reset} THEN NULL ELSE sync_jobs.lease_token END,lease_until=CASE WHEN ${reset} THEN 0 ELSE sync_jobs.lease_until END,checkpoint=CASE WHEN ${scanReset} THEN '{}' ELSE sync_jobs.checkpoint END,scan_id=CASE WHEN ${scanReset} THEN excluded.scan_id ELSE sync_jobs.scan_id END,next_at=CASE WHEN (${reset}) OR (${refreshable}) THEN excluded.next_at ELSE sync_jobs.next_at END,ready_since=CASE WHEN (${reset}) OR (${refreshable}) THEN excluded.ready_since ELSE sync_jobs.ready_since END`;
}

// An explicit public refresh adopts in-flight scans unchanged. Existing native
// arguments remain authoritative even when a new requester has sparse metadata.
function insertPublicJobs(guard) {
 const terminal="sync_jobs.state IN('ready','failed','blocked','disabled')";
 return `INSERT INTO sync_jobs(${columns.join(',')}) SELECT ${columns.map(column=>`json_extract(v.value,'$.${column}')`).join(',')} FROM json_each(?) v WHERE ${guard} ON CONFLICT(provider,account_scope,component,scope,resource_key) DO UPDATE SET generation=sync_jobs.generation+CASE WHEN ${terminal} THEN 1 ELSE 0 END,state=CASE WHEN ${terminal} THEN 'queued' ELSE sync_jobs.state END,checkpoint=CASE WHEN ${terminal} THEN '{}' ELSE sync_jobs.checkpoint END,scan_id=CASE WHEN ${terminal} THEN excluded.scan_id ELSE sync_jobs.scan_id END,lease_token=CASE WHEN ${terminal} THEN NULL ELSE sync_jobs.lease_token END,lease_until=CASE WHEN ${terminal} THEN 0 ELSE sync_jobs.lease_until END,next_at=CASE WHEN ${terminal} THEN excluded.next_at ELSE sync_jobs.next_at END,ready_since=CASE WHEN ${terminal} THEN excluded.ready_since ELSE sync_jobs.ready_since END`;
}

// Seven durable positions keep every class reachable alongside the alternating
// Reports preference. Bulk retains two positions; all other classes get one.
// Keep the original root/publication/bulk class IDs for direct claim callers.
export const ORDINARY_SERVICE_CYCLE = Object.freeze([0,1,5,3,4,2,2]);

// A service preference never grants demand or changes saved priority. The
// surrounding eligible CTE still enforces account, root, lifecycle and leases.
// Root age is durable across its pages, so a due prerequisite retains its turn
// until reconciliation completes instead of losing to each fresh source page.
// Inputs for the current publication retain the input turn even for older games.
// Otherwise historical match analysis gets a turn while its prerequisites do not.
const ordinaryServiceClass = at => `CASE
 WHEN j.provider='domain' AND j.component='connection' AND j.stage='projection' AND EXISTS(
  SELECT 1 FROM team_source_connections root WHERE root.id=j.resource_key AND root.id=json_extract(j.args,'$.connectionId') AND root.app_team_id=j.scope AND root.app_team_id=json_extract(j.args,'$.teamId') AND root.generation=json_extract(j.args,'$.generation') AND root.active=1 AND root.input_revision>root.reconciled_revision AND (julianday(COALESCE(root.last_reconciled_at,root.created_at))-2440587.5)*86400000<=${at-60_000}
 ) THEN 0
 WHEN j.provider='domain' AND j.component='projection' AND j.stage='projection' THEN 1
 WHEN j.provider='analysis' AND j.stage='analysis' AND j.component='catalog' THEN 5
 WHEN j.provider='analysis' AND j.stage='analysis' AND j.component='match' THEN 3
 WHEN (j.provider='trace' AND j.stage='analysis' AND j.component IN('analytics','tracking','radar') AND EXISTS(
  SELECT 1 FROM source_events event JOIN source_event_teams member ON member.source_event_id=event.id JOIN source_teams own ON own.id=member.source_team_id
  WHERE event.provider='trace' AND event.provenance='provider' AND own.provenance='provider' AND j.resource_key=j.scope AND substr(j.scope,1,length('trace:'||event.native_id||':trace:'||own.native_id||':'))='trace:'||event.native_id||':trace:'||own.native_id||':' AND event.scope=j.account_id AND event.account_id=j.account_id AND event.native_id=CAST(json_extract(j.args,'$.game_id') AS TEXT)
  AND own.provider='trace' AND own.scope=j.account_id AND own.account_id=j.account_id AND own.native_id=CAST(json_extract(j.args,'$.team_id') AS TEXT)
  AND ((julianday(COALESCE(event.starts_at,event.local_day))-2440587.5)*86400000 BETWEEN ${at-60*86400000} AND ${at+30*86400000}
   OR EXISTS(SELECT 1 FROM sync_job_subscribers demand JOIN team_projection_state published ON published.app_team_id=demand.app_team_id
    JOIN team_game_source_rows saved ON saved.run_id=published.published_run_id AND saved.app_team_id=published.app_team_id AND saved.team_season_id=published.team_season_id
    WHERE demand.job_id=j.id AND demand.kind='team' AND saved.provider='trace' AND saved.account_id=j.account_id
    AND saved.source_event_id=event.id AND saved.connected_source_team_id=own.id))
 )) THEN 4 ELSE 2 END`;

export class JobCoordinator {
  constructor(db, options = {}) {
    this.db = db;
    this.clock = options.clock || Date.now;
    this.leaseMs = options.leaseMs ?? 45000;
    this.retryBaseMs = options.retryBaseMs ?? 60000;
    this.retryMaxMs = options.retryMaxMs ?? 21600000;
    this.ageMs = options.ageMs ?? 300000;
    this.pageDelayMs = options.pageDelayMs ?? 500;
    this.publicHistory = options.publicHistory === true;
    this.dependencyFairness = options.dependencyFairness === true;
    this.reportTurn = typeof options.reportTurn==='boolean'?options.reportTurn:null;
    this.ordinaryTurn = ORDINARY_SERVICE_CYCLE.includes(options.ordinaryTurn)?options.ordinaryTurn:null;
  }
  prepare(sql) { return this.db.prepare(publicHistoryQuery(sql,String(Math.trunc(this.clock())),{live:this.publicHistory})); }
  subscriberLive(job,subscription) { return this.publicHistory?`(${subscriberLive(job,subscription)} OR ${publicHistoryLive(job,subscription)})`:subscriberLive(job,subscription); }
  demanded(alias,predicate='1') { return this.publicHistory?`(${demanded(alias,predicate)} OR ${publicHistoryDemanded(alias,predicate)})`:demanded(alias,predicate); }
  admission(job,subscription) { return this.publicHistory?`(${admission(job,subscription)} OR ${publicHistoryLive(job,subscription)})`:admission(job,subscription); }
  jsonAdmission(job,subscription) { return this.admission(jsonRow(job),jsonRow(subscription)); }
  revisions(sqlWhere, params = [], content = false, prepare=sql=>this.prepare(sql)) {
    return prepare(`UPDATE team_read_state SET status_revision=status_revision+1${content ? ',content_revision=content_revision+1' : ''} WHERE app_team_id IN (${sqlWhere})`).bind(...params);
  }
  accountRevisions(where, params = [], prepare=sql=>this.prepare(sql)) {
    return prepare(`INSERT INTO sync_account_read_state(account_id,status_revision) SELECT DISTINCT account_id,1 FROM sync_jobs WHERE account_id IS NOT NULL AND (${where}) ON CONFLICT(account_id) DO UPDATE SET status_revision=status_revision+1`).bind(...params);
  }
  auditStatements(lease, observations, guard, at, prepare=sql=>this.prepare(sql)) {
    const rows=observationRows(lease,observations||[],at);if(!rows.length)return [];
    const data=JSON.stringify(rows);if(size(data)>32768)throw new SyncError('contract_violation','Source audit exceeded its byte bound.',{kind:'permanent'});
    const fields=Object.keys(rows[0]);
    return [prepare(`INSERT OR IGNORE INTO sync_observations(${fields.join(',')}) SELECT ${fields.map(field=>`json_extract(value,'$.${field}')`).join(',')} FROM json_each(?) WHERE ${guard}`).bind(data),
      prepare(`DELETE FROM sync_observations WHERE id IN(SELECT id FROM sync_observations WHERE at<? ORDER BY at LIMIT 500) AND ${guard}`).bind(at-14*86400000)];
  }
  async enqueue(spec, subscribers) {
    if (!Array.isArray(subscribers) || !subscribers.length || subscribers.length > 128) throw new SyncError('invalid_job', 'Work requires bounded explicit demand.', { kind: 'permanent' });
    const at = this.clock(), row = specRow(spec, at), demand = subscribers.map(subscriberRow);
    if (row.account_id) {
      const account = await this.prepare('SELECT provider,generation,active FROM provider_accounts WHERE id=?').bind(row.account_id).first();
      if (!account?.active || account.provider !== row.provider || account.generation !== row.authorization_generation) throw new SyncError('authorization_revoked', 'The authorization generation changed.', { kind: 'blocked' });
      if (demand.some(s => s.kind === 'account' && s.demand_key !== row.account_id)) throw new SyncError('invalid_job', 'Account discovery demand belongs to another account.', { kind: 'permanent' });
    } else if (demand.some(s => s.kind === 'account')) throw new SyncError('invalid_job', 'Public work cannot enumerate an account.', { kind: 'permanent' });
    const key = [row.provider,row.account_scope,row.component,row.scope,row.resource_key],subscriptionData=JSON.stringify(demand);
    await this.db.batch([
      this.prepare(insertJobs(`${jsonAccount('v.value')} AND EXISTS(SELECT 1 FROM json_each(?) s WHERE ${jsonAdmission('v.value','s.value')})`)).bind(JSON.stringify([row]),subscriptionData),
      this.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT j.id,json_extract(s.value,'$.kind'),json_extract(s.value,'$.demand_key'),json_extract(s.value,'$.app_team_id'),json_extract(s.value,'$.generation') FROM sync_jobs j JOIN json_each(?) s WHERE j.provider=? AND j.account_scope=? AND j.component=? AND j.scope=? AND j.resource_key=? AND ${activeAccount('j')} AND ${admission('j',jsonRow('s.value'))} ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET app_team_id=excluded.app_team_id,generation=excluded.generation`).bind(subscriptionData,...key),
      this.revisions(`SELECT app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.provider=? AND j.account_scope=? AND j.component=? AND j.scope=? AND j.resource_key=?`,key),
      this.accountRevisions('provider=? AND account_scope=? AND component=? AND scope=? AND resource_key=?',key),
    ]);
    const saved=await this.prepare(`SELECT j.id FROM sync_jobs j WHERE j.provider=? AND j.account_scope=? AND j.component=? AND j.scope=? AND j.resource_key=? AND ${activeAccount('j')} AND EXISTS(SELECT 1 FROM json_each(?) s WHERE ${admission('j',jsonRow('s.value'))})`).bind(...key,subscriptionData).first();
    if(!saved)throw unavailableDemand();return saved.id;
  }
  async enqueueMany(specs, subscribers, {refresh=false,precondition=null}={}) {
    if (!Array.isArray(specs) || !specs.length || specs.length>32 || !Array.isArray(subscribers) || !subscribers.length || subscribers.length>128) throw new SyncError('invalid_job','Root work requires bounded explicit demand.',{kind:'permanent'});
    const rows=specs.map(spec=>specRow(spec,this.clock())),demand=subscribers.map(subscriberRow);
    const privateRows=rows.filter(row=>row.account_id);
    if(privateRows.length) {
      const accounts=(await this.prepare('SELECT id,provider,generation,active FROM provider_accounts WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set(privateRows.map(row=>row.account_id))])).all()).results;
      if(privateRows.some(row=>!accounts.some(account=>account.id===row.account_id&&account.provider===row.provider&&account.generation===row.authorization_generation&&account.active===1))) throw new SyncError('authorization_revoked','Provider authorization changed.',{kind:'blocked'});
    }
    if(demand.some(subscriber=>subscriber.kind==='account'&&rows.some(row=>row.account_id!==subscriber.demand_key))) throw new SyncError('invalid_job','Catalog demand cannot cross account scopes.',{kind:'permanent'});
    if(precondition && (typeof precondition.sql!=='string'||!Array.isArray(precondition.params)||/;/.test(precondition.sql)))throw new SyncError('contract_violation','Invalid internal admission precondition.',{kind:'permanent'});
    const data=JSON.stringify(rows),subscriptionData=JSON.stringify(demand);
    if(size(data)+size(subscriptionData)>262144) throw new SyncError('contract_violation','Root demand exceeded its bound.',{kind:'permanent'});
    await this.db.batch([
      ...(precondition?[this.prepare(`INSERT INTO domain_team_preconditions(id,expected_input,actual_input) SELECT 1,1,CASE WHEN ${precondition.sql} THEN 1 ELSE 0 END ON CONFLICT(id) DO UPDATE SET expected_input=excluded.expected_input,actual_input=excluded.actual_input`).bind(...precondition.params)]:[]),
      // Fence an in-flight page before renewing its root subscriber. Shared
      // consumers retain their demand and the saved cursor; only that page is
      // requeued, so the old lease cannot regain authority through rebinding.
      ...(demand.some(s=>s.kind==='team'&&s.demand_key.startsWith('connection:'))?[this.prepare(`UPDATE sync_jobs AS renewed SET generation=generation+1,state='queued',lease_token=NULL,lease_until=0,next_at=?,ready_since=? WHERE renewed.state='running' AND renewed.stage IN('source','analysis') AND renewed.provider NOT IN('domain','analysis','reports','maintenance') AND ${activeAccount('renewed')} AND EXISTS(SELECT 1 FROM sync_job_subscribers s JOIN json_each(?) current WHERE s.job_id=renewed.id AND s.kind='team' AND substr(s.demand_key,1,11)='connection:' AND json_extract(current.value,'$.kind')='team' AND json_extract(current.value,'$.demand_key')=s.demand_key AND json_extract(current.value,'$.app_team_id')=s.app_team_id AND json_extract(current.value,'$.generation')>s.generation AND ${admission('renewed',jsonRow('current.value'))})`).bind(this.clock(),this.clock(),subscriptionData)]:[]),
      this.prepare(insertJobs(`${jsonAccount('v.value')} AND EXISTS(SELECT 1 FROM json_each(?) s WHERE ${jsonAdmission('v.value','s.value')})`,refresh)).bind(data,subscriptionData),
      this.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT j.id,json_extract(s.value,'$.kind'),json_extract(s.value,'$.demand_key'),json_extract(s.value,'$.app_team_id'),json_extract(s.value,'$.generation') FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN json_each(?) s WHERE ${activeAccount('j')} AND ${admission('j',jsonRow('s.value'))} ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET app_team_id=excluded.app_team_id,generation=excluded.generation`).bind(data,subscriptionData),
      // Scope changes renew the root's already proven provider graph without
      // rerunning a completed discovery/profile page. Only existing demand is
      // rebound; inactive roots, revoked accounts and removed keys cannot gain
      // jobs, and no provider cursor, scan identity or arguments are reset.
      ...(demand.some(s=>s.kind==='team'&&s.demand_key.startsWith('connection:'))?[this.prepare(`UPDATE sync_job_subscribers AS renewed SET generation=(SELECT generation FROM team_source_connections c WHERE c.id=substr(renewed.demand_key,12) AND c.app_team_id=renewed.app_team_id) WHERE renewed.kind='team' AND substr(renewed.demand_key,1,11)='connection:' AND EXISTS(SELECT 1 FROM sync_jobs j JOIN json_each(?) current WHERE j.id=renewed.job_id AND j.stage IN('source','analysis') AND j.provider NOT IN('domain','analysis','reports','maintenance') AND json_extract(current.value,'$.kind')='team' AND json_extract(current.value,'$.demand_key')=renewed.demand_key AND json_extract(current.value,'$.app_team_id')=renewed.app_team_id AND json_extract(current.value,'$.generation')>renewed.generation AND ${activeAccount('j')} AND ${admission('j',jsonRow('current.value'))})`).bind(subscriptionData)]:[]),
      // An explicitly selected second root may share an already proven graph
      // even when its profile is ready. Only a live exact-source/account donor
      // confers demand; no provider job, cursor or identity is reconstructed.
      ...(demand.some(s=>s.kind==='team'&&s.demand_key.startsWith('connection:'))?[this.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT DISTINCT j.id,'team',json_extract(current.value,'$.demand_key'),target.app_team_id,target.generation FROM json_each(?) current JOIN team_source_connections target ON json_extract(current.value,'$.kind')='team' AND json_extract(current.value,'$.demand_key')='connection:'||target.id AND json_extract(current.value,'$.app_team_id')=target.app_team_id AND json_extract(current.value,'$.generation')=target.generation JOIN team_source_connections donor ON donor.source_team_id=target.source_team_id AND donor.account_id IS target.account_id AND donor.id<>target.id JOIN sync_job_subscribers proven ON proven.kind='team' AND proven.demand_key='connection:'||donor.id AND proven.app_team_id=donor.app_team_id AND proven.generation=donor.generation JOIN sync_jobs j ON j.id=proven.job_id WHERE j.stage IN('source','analysis') AND j.provider NOT IN('domain','analysis','reports','maintenance') AND ${activeAccount('j')} AND ${admission('j','proven')} AND ${admission('j',jsonRow('current.value'))} ON CONFLICT(job_id,kind,demand_key) DO NOTHING`).bind(subscriptionData)]:[]),
      this.revisions(`SELECT s.app_team_id FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN sync_job_subscribers s ON s.job_id=j.id`,[data]),
      this.accountRevisions(`id IN(SELECT j.id FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')})`,[data]),
    ]);
    const saved=(await this.prepare(`SELECT DISTINCT j.id FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} WHERE ${activeAccount('j')} AND EXISTS(SELECT 1 FROM json_each(?) s WHERE ${admission('j',jsonRow('s.value'))}) ORDER BY j.id`).bind(data,subscriptionData).all()).results.map(row=>row.id);
    if(!saved.length)throw unavailableDemand();return saved;
  }
  /** Accept one explicitly proved native pair; joining a shared scan never resets it. */
  async enqueuePublicHistory(specs, subscriber, {statements:before=[],requestedAt}={}) {
    if(!this.publicHistory||!Array.isArray(specs)||specs.length!==4||!Array.isArray(before)||before.length>4||!Number.isSafeInteger(requestedAt))throw new SyncError('invalid_job','Invalid public history request.',{kind:'permanent'});
    const sub=subscriberRow(subscriber),at=this.clock(),rows=specs.map(spec=>specRow({...spec,recurring:false},at));
    if(sub.kind!=='team'||!sub.demand_key.startsWith('public-history:')||rows.some(row=>row.provider!=='gotsport'||!['history','catalog'].includes(row.component)||row.stage!=='source'||row.account_id||row.scope!==row.resource_key)||new Set(rows.map(row=>row.component+'|'+row.scope)).size!==4)throw new SyncError('invalid_job','History roots require an exact public native pair.',{kind:'permanent'});
    const id=sub.demand_key.slice(15),data=JSON.stringify(rows),request=`d.id=${quote(id)} AND d.app_team_id=${quote(sub.app_team_id)} AND d.generation=${Number(sub.generation)} AND d.requested_at=${requestedAt}`;
    const nativeRoot=`EXISTS(SELECT 1 FROM public_history_live d JOIN source_teams st ON st.id IN(d.home_source_team_id,d.away_source_team_id) WHERE ${request} AND st.provider='gotsport' AND st.scope='public' AND st.account_id IS NULL AND st.provenance='provider' AND st.native_id=json_extract(v.value,'$.scope'))`;
    const donorSource=`(st.id=native_root.id OR EXISTS(SELECT 1 FROM public_history_bridges bridge WHERE ((bridge.gs_id=st.id AND bridge.live_id=native_root.id) OR(bridge.live_id=st.id AND bridge.gs_id=native_root.id))))`;
    const donor=`EXISTS(SELECT 1 FROM sync_job_subscribers proven LEFT JOIN team_source_connections c ON proven.demand_key='connection:'||c.id AND proven.app_team_id=c.app_team_id AND proven.generation=c.generation AND c.active=1 AND c.account_id IS NULL LEFT JOIN team_source_attachments a ON proven.demand_key=a.id AND proven.app_team_id=a.app_team_id AND proven.generation=a.generation AND a.active=1 AND a.account_id IS NULL JOIN source_teams st ON st.id=COALESCE(c.source_team_id,a.source_team_id) AND st.scope='public' AND st.account_id IS NULL AND st.provenance='provider' WHERE proven.job_id=j.id AND proven.kind='team' AND ${donorSource} AND ${publicHistoryJobAuthority('j','d',{discovery:false,root:'native_root.id',bridgeSource:'st.id'})} AND ${admission('j','proven',false,at)})`;
    const candidates=`SELECT j.id,MIN(native_root.id) AS root_source_team_id FROM sync_jobs j JOIN public_history_live d ON ${request} JOIN source_teams native_root ON native_root.id IN(d.home_source_team_id,d.away_source_team_id) WHERE ${publicHistoryJob('j')} AND ${donor} AND NOT EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation AND r.job_id=j.id) GROUP BY j.id ORDER BY j.id`;
    const capacity=`MAX(0,(SELECT d.max_jobs-(SELECT COUNT(*) FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation) FROM public_history_live d WHERE ${request}))`;
    const batch=[...before,
      this.prepare(`INSERT INTO domain_team_preconditions(id,expected_input,actual_input) SELECT 1,4,count(*) FROM json_each(?) v JOIN public_history_live d ON ${request} JOIN source_teams st ON st.id IN(d.home_source_team_id,d.away_source_team_id) AND st.native_id=json_extract(v.value,'$.scope') WHERE st.provider='gotsport' AND st.scope='public' AND st.account_id IS NULL AND st.provenance='provider' ON CONFLICT(id) DO UPDATE SET expected_input=excluded.expected_input,actual_input=excluded.actual_input`).bind(data),
      this.prepare(insertPublicJobs(nativeRoot)).bind(data),
      this.prepare(`INSERT INTO public_history_jobs(demand_id,generation,job_id,accepted_scan_id,root_source_team_id,provider,component,accepted_at) SELECT d.id,d.generation,j.id,j.scan_id,native_root.id,j.provider,j.component,${at} FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN public_history_live d ON ${request} JOIN source_teams native_root ON native_root.id IN(d.home_source_team_id,d.away_source_team_id) AND native_root.provider='gotsport' AND native_root.native_id=j.scope WHERE ${publicHistoryJob('j')} ON CONFLICT(demand_id,generation,job_id) DO NOTHING`).bind(data),
      this.prepare(`UPDATE public_history_demands AS d SET capped=1 WHERE ${request} AND d.id IN(SELECT id FROM public_history_live) AND (SELECT COUNT(*) FROM(${candidates} LIMIT 513))>${capacity}`),
      this.prepare(`UPDATE sync_jobs SET state='queued',generation=generation+1,scan_id=lower(hex(randomblob(16))),checkpoint='{}',lease_token=NULL,lease_until=0,next_at=${at},ready_since=${at} WHERE state IN('ready','failed','blocked','disabled') AND id IN(SELECT id FROM(${candidates}) LIMIT ${capacity})`),
      this.prepare(`INSERT INTO public_history_jobs(demand_id,generation,job_id,accepted_scan_id,root_source_team_id,provider,component,accepted_at) SELECT d.id,d.generation,j.id,j.scan_id,accepted.root_source_team_id,j.provider,j.component,${at} FROM public_history_live d JOIN(${candidates} LIMIT ${capacity}) accepted JOIN sync_jobs j ON j.id=accepted.id WHERE ${request} ON CONFLICT(demand_id,generation,job_id) DO NOTHING`),
      this.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT r.job_id,'team','public-history:'||d.id,d.app_team_id,d.generation FROM public_history_live d JOIN public_history_jobs r ON r.demand_id=d.id AND r.generation=d.generation WHERE ${request} AND r.state='pending' ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET app_team_id=excluded.app_team_id,generation=excluded.generation`),
      this.revisions(`SELECT app_team_id FROM public_history_live d WHERE ${request}`),
    ];
    if(this.db.remaining!==undefined&&batch.length+(this.db.writeOverhead||0)>this.db.remaining)throw new SyncError('invocation_budget','The history request needs another invocation.',{retryAfterMs:1000});
    await this.db.batch(batch);
    return (await this.prepare(`SELECT r.job_id FROM public_history_jobs r WHERE r.demand_id=? AND r.generation=? ORDER BY r.job_id LIMIT 512`).bind(id,sub.generation).all()).results.map(row=>row.job_id);
  }
  publicParents(lease,at,{pending=true}={}) {
    return `SELECT d.*,parent_receipt.root_source_team_id FROM public_history_live d JOIN public_history_jobs parent_receipt ON parent_receipt.demand_id=d.id AND parent_receipt.generation=d.generation JOIN sync_job_subscribers parent_sub ON parent_sub.job_id=parent_receipt.job_id AND parent_sub.kind='team' AND parent_sub.demand_key='public-history:'||d.id AND parent_sub.app_team_id=d.app_team_id AND parent_sub.generation=d.generation JOIN sync_jobs parent_job ON parent_job.id=parent_receipt.job_id WHERE ${pending?publicHistoryJobAuthority('parent_job','d',{root:'parent_receipt.root_source_team_id'}):'1'} AND parent_receipt.job_id=${quote(lease.id)} AND parent_receipt.accepted_scan_id=${quote(lease.scan_id)} ${pending?"AND parent_receipt.state='pending'":''}`;
  }
  publicTerminal(lease,fence,at,state) {
    return this.prepare(`WITH ph_terminal_authority AS MATERIALIZED(SELECT d.id,d.generation FROM public_history_live d JOIN public_history_jobs r ON r.demand_id=d.id AND r.generation=d.generation JOIN sync_jobs j ON j.id=r.job_id AND j.id=${quote(lease.id)} AND j.scan_id=${quote(lease.scan_id)} WHERE ${publicHistoryJob('j')} AND ${publicHistoryJobAuthority('j','d',{root:'r.root_source_team_id'})}) UPDATE public_history_jobs AS r SET state=CASE WHEN EXISTS(SELECT 1 FROM ph_terminal_authority authority WHERE authority.id=r.demand_id AND authority.generation=r.generation) THEN ${quote(state)} ELSE 'superseded' END,completed_at=${at} WHERE r.job_id=${quote(lease.id)} AND r.accepted_scan_id=${quote(lease.scan_id)} AND r.state='pending' AND ${fence} AND EXISTS(SELECT 1 FROM public_history_demands d WHERE d.id=r.demand_id AND d.generation=r.generation AND EXISTS(SELECT 1 FROM public_history_live authority WHERE authority.id=d.id AND authority.generation=d.generation))`);
  }
  publicSettlement(lease,fence,at) {
    return this.prepare(`UPDATE public_history_demands AS d SET state=CASE WHEN EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation AND r.state='pending') THEN 'active' WHEN d.capped=1 OR EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation AND r.state IN('failed','superseded')) THEN 'partial' ELSE 'complete' END WHERE ${fence} AND d.id IN(SELECT id FROM(${this.publicParents(lease,at,{pending:false})})) AND EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation)`);
  }
  async recoverPublicHistory({limit=1}={}) {
    if(!this.publicHistory)return {processed:0};
    if(!Number.isInteger(limit)||limit<1||limit>8)throw new SyncError('invalid_job','Invalid public history recovery bound.',{kind:'permanent'});
    if(this.db.remaining!==undefined&&this.db.remaining<3+(this.db.writeOverhead||0))return {processed:0};
    const at=this.clock(),changed=`(d.expires_at<=${at} OR NOT (EXISTS(SELECT 1 FROM public_history_live authority WHERE authority.id=d.id AND authority.generation=d.generation)) OR NOT EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation AND r.state='pending') OR EXISTS(SELECT 1 FROM public_history_jobs r LEFT JOIN sync_jobs j ON j.id=r.job_id WHERE r.demand_id=d.id AND r.generation=d.generation AND r.state='pending' AND(j.id IS NULL OR j.scan_id<>r.accepted_scan_id OR j.state IN('ready','failed','blocked','disabled') OR NOT (${publicHistoryJobAuthority('j','d',{root:'r.root_source_team_id'})}))))`;
    const ids=(await this.prepare(`SELECT d.id FROM public_history_demands d WHERE d.state='active' AND ${changed} ORDER BY d.requested_at,d.id LIMIT ?`).bind(limit).all()).results.map(row=>row.id);
    if(!ids.length)return {processed:0};
    const data=JSON.stringify(ids);
    await this.db.batch([
      this.prepare(`UPDATE public_history_jobs AS r SET state=CASE WHEN EXISTS(SELECT 1 FROM sync_jobs j WHERE j.id=r.job_id AND j.scan_id=r.accepted_scan_id AND j.state IN('failed','blocked')) THEN 'failed' ELSE 'superseded' END,completed_at=? WHERE r.demand_id IN(SELECT value FROM json_each(?)) AND r.state='pending' AND EXISTS(SELECT 1 FROM public_history_demands d WHERE d.id=r.demand_id AND d.generation=r.generation AND d.state='active') AND NOT EXISTS(SELECT 1 FROM sync_jobs j JOIN public_history_demands d ON d.id=r.demand_id AND d.generation=r.generation WHERE j.id=r.job_id AND j.scan_id=r.accepted_scan_id AND j.state IN('queued','running','retrying') AND ${publicHistoryJob('j')} AND ${publicHistoryJobAuthority('j','d',{root:'r.root_source_team_id'})})`).bind(at,data),
      this.prepare(`UPDATE public_history_demands AS d SET state=CASE WHEN d.expires_at<=${at} THEN 'expired' WHEN NOT (EXISTS(SELECT 1 FROM public_history_live authority WHERE authority.id=d.id AND authority.generation=d.generation)) THEN 'revoked' WHEN EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation AND r.state='pending') THEN 'active' WHEN d.capped=1 OR NOT EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation) OR EXISTS(SELECT 1 FROM public_history_jobs r WHERE r.demand_id=d.id AND r.generation=d.generation AND r.state<>'complete') THEN 'partial' ELSE 'complete' END WHERE d.id IN(SELECT value FROM json_each(?)) AND d.state='active'`).bind(data),
    ]);
    return {processed:ids.length};
  }
  async claim() {
    const at = this.clock(), token = crypto.randomUUID();
    // A saved first full TeamSnap traversal yields to local reconciliation and
    // publication before its verification traversal. Persisted priority, recent
    // windows, aging and every authority/lease predicate remain unchanged.
    // Aging lets historical work advance while recent pages receive useful priority.
    const reportClass=this.reportTurn===null?'':`,CASE WHEN ${reportServiceJob(at)} THEN 1 ELSE 0 END AS report_service`,reportOrder=this.reportTurn===null?'':`CASE WHEN report_service=${Number(this.reportTurn)} THEN 0 ELSE 1 END,`;
    const ordinaryClass=this.ordinaryTurn===null?'':`,${ordinaryServiceClass(at)} AS ordinary_service`,ordinaryOrder=this.ordinaryTurn===null?'':`CASE WHEN ordinary_service=${this.ordinaryTurn} THEN 0 ELSE 1 END,`;
    const results=await this.db.batch([
      this.prepare(`WITH eligible AS MATERIALIZED(SELECT j.id${reportClass}${ordinaryClass},CASE WHEN j.provider='teamsnap' AND j.stage='source' AND j.component IN('events','attendance') AND json_extract(j.checkpoint,'$.protocol')='teamsnap-pages-v1' AND json_extract(j.checkpoint,'$.refresh.protocol')='teamsnap-refresh-v1' AND json_extract(j.checkpoint,'$.refresh.active.mode')='full' AND json_extract(j.checkpoint,'$.refresh.binding.account_id')=j.account_id AND json_extract(j.checkpoint,'$.refresh.binding.authorization_generation')=j.authorization_generation AND json_extract(j.checkpoint,'$.refresh.binding.kind')=j.component AND json_extract(j.checkpoint,'$.refresh.binding.team_id')=CAST(json_extract(j.args,'$.team_id') AS TEXT) AND json_extract(j.checkpoint,'$.pass') IN(2,3) AND json_type(j.checkpoint,'$.previous')='object' AND length(json_extract(j.checkpoint,'$.previous.digest'))=64 AND json_extract(j.checkpoint,'$.previous.digest') NOT GLOB '*[^a-f0-9]*' AND json_type(j.checkpoint,'$.previous.pages')='integer' AND json_extract(j.checkpoint,'$.previous.pages')>0 AND json_type(j.checkpoint,'$.previous.count')='integer' AND json_extract(j.checkpoint,'$.previous.count')>=0 THEN MIN(j.priority,10) ELSE j.priority END AS priority,j.ready_since,j.next_at FROM sync_jobs j WHERE j.state IN ('queued','running','ready','retrying') AND NOT(j.state='ready' AND j.recurring=0) AND j.next_at<=? AND j.lease_until<=? AND ${activeAccount('j')} AND ${this.demanded('j')} AND ${this.dependencyFairness?analysisPublicationReady('j'):'1'}) UPDATE sync_jobs SET state='running',lease_token=?,lease_until=?,attempts=attempts+1,last_attempt_at=?,checkpoint=CASE WHEN state='ready' THEN CASE WHEN ${teamSnapReadyReceipt} THEN checkpoint ELSE '{}' END ELSE checkpoint END,scan_id=CASE WHEN state='ready' THEN ? ELSE scan_id END WHERE id=(SELECT id FROM eligible ORDER BY ${reportOrder}${ordinaryOrder}(priority+CAST((?-ready_since)/? AS INTEGER)) DESC,next_at,id LIMIT 1) AND lease_until<=? RETURNING *`).bind(at,at,token,at+this.leaseMs,at,crypto.randomUUID(),at,this.ageMs,at),
      this.revisions('SELECT s.app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.lease_token=?',[token]),
      this.accountRevisions('lease_token=?',[token]),
    ]);
    const job=results[0].results[0];
    if (!job) return null;
    return { ...job, args: JSON.parse(job.args), checkpoint: JSON.parse(job.checkpoint) };
  }
  async commit(lease, result) {
    if (!result || !Array.isArray(result.statements || []) || (result.statements || []).length > 32 || !coverages.includes(result.coverage || (result.complete ? 'complete' : 'partial'))) throw new SyncError('contract_violation', 'Invalid collector result.', { kind: 'permanent' });
    if (result.complete && result.coverage==='none') throw new SyncError('contract_violation', 'A finished scan must report observed coverage.', { kind: 'permanent' });
    if (result.publishContent && lease.stage !== 'projection') throw new SyncError('contract_violation', 'Only projection publication advances visible content.', { kind: 'permanent' });
    if(result.removeTeamDemand&&(lease.provider!=='maintenance'||lease.stage!=='maintenance'||lease.component!=='team_delete'||lease.scope!==lease.resource_key||lease.args?.teamId!==lease.scope))throw new SyncError('contract_violation','Only team deletion may remove its own demand.',{kind:'permanent'});
    if(result.projectionDeferred!==undefined&&(result.projectionDeferred!=='source_evidence'||lease.provider!=='domain'||lease.stage!=='projection'||lease.component!=='projection'||result.complete))throw new SyncError('contract_violation','Only an unfinished projection may await source evidence.',{kind:'permanent'});
    const checkpoint = JSON.stringify(result.checkpoint || {});
    if (size(checkpoint) > 8192) throw new SyncError('contract_violation', 'Checkpoint exceeds its bound.', { kind: 'permanent' });
    const at = this.clock(), commitToken = crypto.randomUUID(), retrievedAt = retrievedTimestamp(result.retrievedAt,this.clock());
    const nextDelay=result.complete?lease.interval_ms:result.projectionDeferred==='source_evidence'?60000:this.pageDelayMs;
    const fence = `EXISTS(SELECT 1 FROM sync_commit_fences WHERE job_id=${quote(lease.id)} AND commit_token=${quote(commitToken)})`;
    const statements = [this.prepare(`INSERT INTO sync_commit_fences(job_id,commit_token) SELECT j.id,? FROM sync_jobs j WHERE j.id=? AND j.lease_token=? AND j.generation=? AND j.lease_until>? AND ${activeAccount('j')} AND ${this.demanded('j')} ON CONFLICT(job_id) DO UPDATE SET commit_token=excluded.commit_token`).bind(commitToken,lease.id,lease.lease_token,lease.generation,at)];
    let payloadBytes = size(checkpoint);
    for (const statement of result.statements || []) {
      if (typeof statement.sql !== 'string' || !statement.sql.includes('$FENCE') || !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(statement.sql) || /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:sync_\w+|provider_accounts)\b/i.test(statement.sql) || /;/.test(statement.sql)) throw new SyncError('contract_violation', 'Source writes require the transaction fence.', { kind: 'permanent' });
      payloadBytes += size(statement.params || []);
      statements.push(this.prepare(statement.sql.replaceAll('$FENCE',fence)).bind(...(statement.params || [])));
    }
    const publicPage=this.publicHistory && lease.stage==='source' && !lease.account_id && ((lease.provider==='gotsport'&&['profile','catalog','history','bridge','event','division','standings'].includes(lease.component))||(lease.provider==='live'&&['participant','resolve','upcoming','membership','league','organizer','categories','division','standings','fixture'].includes(lease.component)));
    const children = result.children || [];
    if (!Array.isArray(children) || children.length > 128) throw new SyncError('contract_violation', 'Child demand exceeds its page bound.', { kind: 'permanent' });
    if (children.length) {
      const childRows = children.map(child => {
        if (!['inherit','explicit','projection'].includes(child.subscriberMode)) throw new SyncError('contract_violation', 'Children must declare subscriber scope.', { kind: 'permanent' });
        const row = specRow(child,at);
        if (child.subscriberMode === 'projection' && (row.provider !== 'domain' || row.component!=='projection' || row.stage !== 'projection' || row.account_id || !Array.isArray(child.subscribers) || child.subscribers.length !== 1 || child.subscribers[0].kind !== 'team' || child.subscribers[0].teamId !== row.scope)) throw new SyncError('contract_violation','Projection demand cannot grant source or account access.',{kind:'permanent'});
        if (row.account_id && (row.account_id !== lease.account_id || row.authorization_generation !== lease.authorization_generation)) throw new SyncError('contract_violation', 'A child crossed private account authorization.', { kind: 'permanent' });
        return { ...row, subscriber_mode: child.subscriberMode, subscribers: ['explicit','projection'].includes(child.subscriberMode) ? (child.subscribers || []).map(subscriberRow) : [] };
      });
      const data = JSON.stringify(childRows); payloadBytes += size(data);
      const projectionDemand = childRows.some(row=>row.subscriber_mode==='projection') ? ` OR (json_extract(v.value,'$.subscriber_mode')='projection' AND EXISTS(SELECT 1 FROM team_projection_state p JOIN team_seasons ts ON ts.id=p.team_season_id WHERE p.app_team_id=json_extract(v.value,'$.scope') AND p.team_season_id=json_extract(v.value,'$.resource_key') AND ts.app_team_id=p.app_team_id AND p.pending=1 AND ${connectionEvidenceReady('p.app_team_id',at)} AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=p.app_team_id)))` : '';
      const childDemand = `(json_extract(v.value,'$.subscriber_mode')='inherit' OR (json_extract(v.value,'$.subscriber_mode')='explicit' AND EXISTS(SELECT 1 FROM sync_job_subscribers s JOIN json_each(v.value,'$.subscribers') x WHERE s.job_id=${quote(lease.id)} AND (s.kind='account' OR (NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id) AND ${subscriberLive(Object.fromEntries(['id','scan_id','stage','provider','component','account_scope','account_id','authorization_generation'].map(key=>[key,lease[key]===null?'NULL':quote(key==='args'?JSON.stringify(lease[key]):lease[key])])),'s')})) AND json_extract(x.value,'$.kind')=s.kind AND json_extract(x.value,'$.demand_key')=s.demand_key AND json_extract(x.value,'$.app_team_id') IS s.app_team_id AND json_extract(x.value,'$.generation')=s.generation)))${projectionDemand}`;
      if (size(data) > 262144) throw new SyncError('contract_violation', 'Child demand page is too large.', { kind: 'permanent' });
      const ph=publicPage?`WITH ph AS(${this.publicParents(lease,at)}), ph_parents AS MATERIALIZED(SELECT s.* FROM sync_job_subscribers s JOIN sync_jobs parent ON parent.id=s.job_id WHERE parent.id=${quote(lease.id)} AND ${admission('parent','s')} UNION ALL SELECT s.* FROM ph JOIN sync_job_subscribers s ON s.job_id=${quote(lease.id)} AND s.kind='team' AND s.demand_key='public-history:'||ph.id AND s.app_team_id=ph.app_team_id AND s.generation=ph.generation) `:'';
      const allowedPublicChild=`(json_extract(v.value,'$.subscriber_mode')='inherit' OR(json_extract(v.value,'$.subscriber_mode')='explicit' AND EXISTS(SELECT 1 FROM json_each(v.value,'$.subscribers') child_sub WHERE json_extract(child_sub.value,'$.kind')='team' AND json_extract(child_sub.value,'$.demand_key')='public-history:'||ph.id AND json_extract(child_sub.value,'$.app_team_id')=ph.app_team_id AND json_extract(child_sub.value,'$.generation')=ph.generation)))`;
      const nonPublicParent=`EXISTS(SELECT 1 FROM ph_parents ordinary WHERE NOT (${publicHistoryKey('ordinary.demand_key')}))`;
      const flatChildDemand=publicPage?`(json_extract(v.value,'$.subscriber_mode')='inherit' OR (json_extract(v.value,'$.subscriber_mode')='explicit' AND EXISTS(SELECT 1 FROM ph_parents s JOIN json_each(v.value,'$.subscribers') x WHERE json_extract(x.value,'$.kind')=s.kind AND json_extract(x.value,'$.demand_key')=s.demand_key AND json_extract(x.value,'$.app_team_id') IS s.app_team_id AND json_extract(x.value,'$.generation')=s.generation)))${projectionDemand}`:childDemand;
      const choices=publicPage?`, ph_choices AS MATERIALIZED(SELECT ph.id AS demand_id,MIN(CAST(v.key AS INTEGER)) AS child_key,ph.max_jobs-(SELECT COUNT(*) FROM public_history_jobs used WHERE used.demand_id=ph.id AND used.generation=ph.generation) AS available,ROW_NUMBER() OVER(PARTITION BY ph.id ORDER BY MIN(CAST(v.key AS INTEGER))) AS ordinal FROM ph JOIN ph_incoming v WHERE ${publicHistoryJob(jsonRow('v.value'))} AND ${allowedPublicChild} AND NOT EXISTS(SELECT 1 FROM public_history_jobs old JOIN sync_jobs known ON known.id=old.job_id WHERE old.demand_id=ph.id AND old.generation=ph.generation AND ${keyJoin('known','v.value')}) GROUP BY ph.id,json_extract(v.value,'$.provider'),json_extract(v.value,'$.component'),json_extract(v.value,'$.scope'),json_extract(v.value,'$.resource_key')), ph_permitted AS MATERIALIZED(SELECT demand_id,child_key FROM ph_choices WHERE ordinal<=available UNION ALL SELECT ph.id,v.key FROM ph JOIN ph_incoming v JOIN sync_jobs known ON ${keyJoin('known','v.value')} JOIN public_history_jobs old ON old.demand_id=ph.id AND old.generation=ph.generation AND old.job_id=known.id WHERE ${publicHistoryJob('known')} AND ${allowedPublicChild})`:'';
      const publicChildCapacity=`EXISTS(SELECT 1 FROM ph_permitted WHERE child_key=v.key)`;
      statements.push(this.prepare(ph+insertJobs(`(${fence}) AND (${flatChildDemand})${publicPage?` AND (${nonPublicParent} OR (${publicHistoryJob(jsonRow('v.value'))} AND ${publicChildCapacity})${projectionDemand})`:''}`,false,publicPage,choices)).bind(data));
      if(publicPage) {
        const receiptChoices=ph.trimEnd()+`, ph_incoming AS MATERIALIZED(SELECT value,key FROM json_each(?))${choices} `;
        statements.push(this.prepare(receiptChoices+`INSERT INTO public_history_jobs(demand_id,generation,job_id,accepted_scan_id,parent_job_id,root_source_team_id,provider,component,accepted_at,state,completed_at) SELECT DISTINCT ph.id,ph.generation,j.id,j.scan_id,${quote(lease.id)},ph.root_source_team_id,j.provider,j.component,${at},CASE WHEN ${publicHistoryJobAuthority('j','ph',{root:'ph.root_source_team_id'})} THEN 'pending' ELSE 'superseded' END,CASE WHEN ${publicHistoryJobAuthority('j','ph',{root:'ph.root_source_team_id'})} THEN NULL ELSE ${at} END FROM ph_permitted permitted JOIN ph ON ph.id=permitted.demand_id JOIN ph_incoming v ON v.key=permitted.child_key JOIN sync_jobs j ON ${keyJoin('j','v.value')} WHERE ${fence} ON CONFLICT(demand_id,generation,job_id) DO NOTHING`).bind(data));
        // Any eligible edge that could not receive a receipt is an explicit cap,
        // never a falsely successful complete history result.
        statements.push(this.prepare(ph+`UPDATE public_history_demands AS d SET capped=1 WHERE d.id IN(SELECT ph.id FROM ph JOIN json_each(?) v LEFT JOIN sync_jobs j ON ${keyJoin('j','v.value')} WHERE ${publicHistoryJob(jsonRow('v.value'))} AND ${allowedPublicChild} AND NOT EXISTS(SELECT 1 FROM public_history_jobs admitted WHERE admitted.demand_id=ph.id AND admitted.generation=ph.generation AND admitted.job_id=j.id)) AND ${fence}`).bind(data));
      }
      // Explicit children can narrow the parent's current demand, never grant new visibility.
      statements.push(this.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT j.id,s.kind,s.demand_key,s.app_team_id,s.generation FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN sync_job_subscribers s ON s.job_id=? WHERE ${fence} AND ${publicPage?this.admission('j','s'):admission('j','s')} AND (json_extract(v.value,'$.subscriber_mode')='inherit' OR EXISTS(SELECT 1 FROM json_each(v.value,'$.subscribers') x WHERE json_extract(x.value,'$.kind')=s.kind AND json_extract(x.value,'$.demand_key')=s.demand_key AND json_extract(x.value,'$.app_team_id') IS s.app_team_id AND json_extract(x.value,'$.generation')=s.generation)) ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET app_team_id=excluded.app_team_id,generation=excluded.generation`).bind(data,lease.id));
      if (projectionDemand) statements.push(this.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT j.id,'team',json_extract(x.value,'$.demand_key'),p.app_team_id,json_extract(x.value,'$.generation') FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN json_each(v.value,'$.subscribers') x JOIN team_projection_state p ON p.app_team_id=j.scope AND p.team_season_id=j.resource_key JOIN team_seasons ts ON ts.id=p.team_season_id AND ts.app_team_id=p.app_team_id WHERE ${fence} AND json_extract(v.value,'$.subscriber_mode')='projection' AND json_extract(x.value,'$.kind')='team' AND json_extract(x.value,'$.app_team_id')=p.app_team_id AND p.pending=1 AND ${connectionEvidenceReady('p.app_team_id',at)} AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=p.app_team_id) ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET generation=excluded.generation`).bind(data));
    }
    if(result.removeTeamDemand)statements.push(
      this.prepare(`UPDATE sync_jobs SET state='disabled',generation=generation+1,lease_token=NULL,lease_until=0 WHERE state<>'disabled' AND id IN(SELECT job_id FROM sync_job_subscribers WHERE rowid IN(SELECT rowid FROM sync_job_subscribers WHERE app_team_id=? AND job_id<>? LIMIT 100)) AND NOT ${this.demanded('sync_jobs')} AND ${fence}`).bind(lease.scope,lease.id),
      this.prepare(`DELETE FROM sync_job_subscribers WHERE rowid IN(SELECT rowid FROM sync_job_subscribers WHERE app_team_id=? AND job_id<>? LIMIT 100) AND ${fence}`).bind(lease.scope,lease.id),
    );
    if (payloadBytes > 2000000) throw new SyncError('contract_violation', 'Page transaction exceeded its byte bound.', { kind: 'permanent' });
    if(publicPage && result.complete)statements.push(this.publicTerminal(lease,fence,at,'complete'),this.publicSettlement(lease,fence,at));
    statements.push(...this.auditStatements(lease,result.observations,fence,at));
    statements.push(this.revisions(`SELECT app_team_id FROM sync_job_subscribers WHERE job_id=? AND ${fence}`,[lease.id],!!result.publishContent));
    // Catalog discovery has its own revision and cannot create an app-owned team.
    if(lease.account_id)statements.push(this.prepare(`INSERT INTO sync_account_read_state(account_id,catalog_revision,status_revision) SELECT j.account_id,CASE WHEN EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=j.id AND s.kind='account') THEN 1 ELSE 0 END,1 FROM sync_jobs j WHERE j.id=? AND j.account_id IS NOT NULL AND ${fence} ON CONFLICT(account_id) DO UPDATE SET catalog_revision=catalog_revision+excluded.catalog_revision,status_revision=status_revision+1`).bind(lease.id));
    const updateIndex = statements.length;
    statements.push(this.prepare(`UPDATE sync_jobs SET state=?,coverage=?,checkpoint=?,next_at=?,ready_since=?,lease_token=NULL,lease_until=0,failures=0,last_error_code=NULL,last_error_message=NULL,failure_kind=NULL,last_retrieved_at=COALESCE(?,last_retrieved_at),last_saved_at=?,last_complete_at=CASE WHEN ? THEN ? ELSE last_complete_at END,pages_saved=pages_saved+1,rows_saved=rows_saved+? WHERE id=? AND lease_token=? AND generation=? AND ${fence}`).bind(result.complete?'ready':'queued',result.coverage || (result.complete?'complete':'partial'),checkpoint,at+nextDelay,at+nextDelay,retrievedAt,at,result.complete?1:0,at,Math.max(0,Number(result.rowsSaved)||0),lease.id,lease.lease_token,lease.generation));
    statements.push(this.prepare('DELETE FROM sync_commit_fences WHERE job_id=? AND commit_token=?').bind(lease.id,commitToken));
    if (this.db.remaining !== undefined && statements.length+(this.db.writeOverhead||0) > this.db.remaining) throw new SyncError('invocation_budget', 'The page needs another invocation.', { retryAfterMs: 1000 });
    const saved = await this.db.batch(statements);
    if (saved[updateIndex].meta.changes !== 1) {
      logSyncFailure('commit',null,{db:this.db,lease,leaseLost:true});
      return { state:'lease_lost', committed:false };
    }
    return { state:result.complete?'ready':'queued', committed:true, coverage:result.coverage || (result.complete?'complete':'partial') };
  }
  async fail(lease, error) {
    const info = classifyFailure(error), at = this.clock();
    const retrievedAt = retrievedTimestamp(error?.retrievedAt,at);
    const coverage = error?.coverage && coverages.includes(error.coverage) ? error.coverage : null;
    const wait = Math.max(info.retryAfterMs, Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.min(lease.failures,12)));
    const next = info.kind === 'temporary' ? at + wait : at;
    const state = info.kind === 'blocked' ? 'blocked' : info.kind === 'permanent' ? 'failed' : 'retrying';
    const eligible = `SELECT j.id FROM sync_jobs j WHERE j.id=${quote(lease.id)} AND j.lease_token=${quote(lease.lease_token)} AND j.generation=${lease.generation} AND j.lease_until>${at} AND ${activeAccount('j')} AND ${this.demanded('j')}`;
    const receiptFailure=this.publicHistory&&lease.stage==='source'&&!lease.account_id&&['gotsport','live'].includes(lease.provider)&&state!=='retrying',failureToken=crypto.randomUUID();
    const guard=receiptFailure?`EXISTS(SELECT 1 FROM sync_commit_fences WHERE job_id=${quote(lease.id)} AND commit_token=${quote(failureToken)})`:'EXISTS(SELECT 1 FROM failure_eligible)';
    const prepare=sql=>this.prepare(receiptFailure?sql:`WITH failure_eligible AS MATERIALIZED(${eligible}) ${sql}`);
    const results = await this.db.batch([
      ...(receiptFailure?[this.prepare(`INSERT INTO sync_commit_fences(job_id,commit_token) SELECT eligible.id,? FROM(${eligible}) eligible WHERE 1 ON CONFLICT(job_id) DO UPDATE SET commit_token=excluded.commit_token`).bind(failureToken)]:[]),
      ...(receiptFailure?[this.publicTerminal(lease,guard,at,'failed'),this.publicSettlement(lease,guard,at)]:[]),
      ...this.auditStatements(lease,error?.observations,guard,at,prepare),
      this.revisions(`SELECT app_team_id FROM sync_job_subscribers WHERE job_id=? AND ${guard}`,[lease.id],false,prepare),
      this.accountRevisions(`id=? AND ${guard}`,[lease.id],prepare),
      prepare(`UPDATE sync_jobs SET state=?,next_at=?,lease_token=NULL,lease_until=0,failures=failures+1,last_error_code=?,last_error_message=?,failure_kind=?,last_retrieved_at=COALESCE(?,last_retrieved_at),coverage=COALESCE(?,coverage) WHERE id=? AND ${guard}`).bind(state,next,info.code,info.message,info.kind,retrievedAt,coverage,lease.id),
      ...(receiptFailure?[this.prepare('DELETE FROM sync_commit_fences WHERE job_id=? AND commit_token=?').bind(lease.id,failureToken)]:[]),
    ]);
    const outcome = { state:results.at(receiptFailure?-2:-1).meta.changes?state:'lease_lost', error:info };
    if(outcome.state==='lease_lost')logSyncFailure('fail',null,{db:this.db,lease,leaseLost:true});
    return outcome;
  }
  async retry(id,{precondition=null}={}) {
    if(precondition&&(typeof precondition.sql!=='string'||!Array.isArray(precondition.params)||/;/.test(precondition.sql)))throw new SyncError('contract_violation','Invalid internal retry precondition.',{kind:'permanent'});
    const at = this.clock();
    // The command's authority and failed snapshot must fence status revisions
    // as well as the state change. D1 executes all three in one transaction.
    // Keep the bounded command guard outside the ordinary demand expression;
    // combining both inline exceeds native D1's expression-depth limit.
    const command=precondition?`retry_command AS MATERIALIZED(SELECT 1 WHERE ${precondition.sql}), `:'';
    const eligible=`SELECT j.id FROM sync_jobs j WHERE j.id=? AND j.lease_until<=? AND ${activeAccount('j')} AND ${this.demanded('j')}${precondition?' AND EXISTS(SELECT 1 FROM retry_command)':''}`;
    const params=[...(precondition?.params||[]),id,at],prepare=sql=>this.prepare(`WITH ${command}retry_eligible AS MATERIALIZED(${eligible}) ${sql}`);
    const results = await this.db.batch([
      this.revisions('SELECT app_team_id FROM sync_job_subscribers WHERE job_id IN(SELECT id FROM retry_eligible)',params,false,prepare),
      this.accountRevisions('id IN(SELECT id FROM retry_eligible)',params,prepare),
      prepare("UPDATE sync_jobs SET state='queued',next_at=?,ready_since=? WHERE id IN(SELECT id FROM retry_eligible)").bind(...params,at,at),
    ]);
    return results.at(-1).meta.changes === 1;
  }
  async unsubscribe(kind, key) {
    await this.db.batch([
      this.revisions('SELECT app_team_id FROM sync_job_subscribers WHERE kind=? AND demand_key=?',[kind,key]),
      this.accountRevisions('id IN(SELECT job_id FROM sync_job_subscribers WHERE kind=? AND demand_key=?)',[kind,key]),
      this.prepare(`UPDATE sync_jobs SET state='disabled',generation=generation+1,lease_token=NULL,lease_until=0 WHERE id IN(SELECT job_id FROM sync_job_subscribers WHERE kind=? AND demand_key=?) AND NOT ${this.demanded('sync_jobs',`NOT(s.kind=${quote(kind)} AND s.demand_key=${quote(key)})`)} AND state<>'disabled'`).bind(kind,key),
      this.prepare('DELETE FROM sync_job_subscribers WHERE kind=? AND demand_key=?').bind(kind,key),
    ]);
  }
  async deactivateAccount(accountId) {
    await this.db.batch([
      this.revisions('SELECT s.app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.account_id=?',[accountId]),
      this.accountRevisions('account_id=?',[accountId]),
      this.prepare("UPDATE sync_jobs SET state='disabled',generation=generation+1,lease_token=NULL,lease_until=0 WHERE account_id=?").bind(accountId),
    ]);
  }
  async restartAccount(accountId) {
    const account = await this.prepare('SELECT generation,active FROM provider_accounts WHERE id=?').bind(accountId).first();
    if (!account?.active) throw new SyncError('authentication_required','Reconnect the account.',{kind:'blocked'});
    await this.db.batch([
      this.revisions('SELECT s.app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.account_id=?',[accountId]),
      this.accountRevisions('account_id=?',[accountId]),
      this.prepare(`UPDATE sync_jobs SET authorization_generation=?,generation=generation+1,lease_token=NULL,lease_until=0,checkpoint='{}',scan_id=?,state='queued',next_at=?,ready_since=? WHERE account_id=? AND ${this.demanded('sync_jobs')}`).bind(account.generation,crypto.randomUUID(),this.clock(),this.clock(),accountId),
    ]);
  }
  async nextWake() {
    const row = await this.prepare(`SELECT MIN(CASE WHEN j.lease_until>? THEN j.lease_until ELSE j.next_at END) AS at FROM sync_jobs j WHERE j.state IN ('queued','running','ready','retrying') AND NOT(j.state='ready' AND j.recurring=0) AND ${activeAccount('j')} AND ${this.demanded('j')} AND ${this.dependencyFairness?analysisPublicationReady('j'):'1'}`).bind(this.clock()).first();
    return row?.at ?? null;
  }
  async status(teamId,{includeExports=false}={}) {
    // Full authorized demand is aggregated in SQL. Detail pagination cannot truncate totals or revisions.
    const revision = await this.prepare('SELECT content_revision,status_revision,pending FROM team_read_state WHERE app_team_id=?').bind(teamId).first();
    if (!revision) throw new SyncError('invalid_job','Unknown team.',{kind:'permanent'});
    const counts = (await this.prepare(`SELECT j.stage,j.state,j.coverage,COUNT(*) AS count,MAX(j.last_saved_at) AS newest_saved_at,MIN(j.last_saved_at) AS oldest_saved_at,MAX(j.last_retrieved_at) AS newest_retrieved_at,MAX(j.last_complete_at) AS newest_complete_at,MIN(CASE WHEN j.state IN ('queued','running','ready','retrying') AND NOT(j.state='ready' AND j.recurring=0) THEN CASE WHEN j.lease_until>? THEN j.lease_until ELSE j.next_at END END) AS next_due_at FROM sync_jobs j WHERE ${includeExports?"j.stage<>'maintenance'":"j.stage NOT IN('export','maintenance')"} AND EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=j.id AND s.app_team_id=?) GROUP BY j.stage,j.state,j.coverage`).bind(this.clock(),teamId).all()).results;
    return { ...revision, total:counts.reduce((n,row)=>n+row.count,0), groups:counts };
  }
  async accountStatus(accountId) {
    const revision = await this.prepare('SELECT catalog_revision,status_revision FROM sync_account_read_state WHERE account_id=?').bind(accountId).first() || {catalog_revision:0,status_revision:0};
    const groups = (await this.prepare(`SELECT j.stage,j.state,j.coverage,COUNT(*) AS count,MAX(j.last_retrieved_at) AS newest_retrieved_at,MAX(j.last_saved_at) AS newest_saved_at FROM sync_jobs j WHERE j.account_id=? AND ${this.demanded('j')} GROUP BY j.stage,j.state,j.coverage`).bind(accountId).all()).results;
    return {...revision,total:groups.reduce((n,row)=>n+row.count,0),groups};
  }
  async runOne(collector, context = {}) {
    const lease = await this.claim();
    if (!lease) return {state:'idle'};
    let phase='collect';
    try {
      const result = await collector({ ...context, db:this.db, lease, args:lease.args, checkpoint:lease.checkpoint });
      phase='commit';
      return {jobId:lease.id,provider:lease.provider,component:lease.component,stage:lease.stage,...await this.commit(lease,result)};
    } catch (error) {
      logSyncFailure(phase,error,{db:this.db,lease});
      // Budget exhaustion before commit is a retry, not a successful partial page.
      try {
        return {jobId:lease.id,provider:lease.provider,component:lease.component,stage:lease.stage,...await this.fail(lease,error)};
      } catch (failureError) {
        logSyncFailure('fail',failureError,{db:this.db,lease,originalError:error,originalPhase:phase});
        throw failureError;
      }
    }
  }
}
