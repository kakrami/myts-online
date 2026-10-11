import { SyncError, classifyFailure } from './errors.js';

const encoder = new TextEncoder();
const size = value => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const coverages = ['none','partial','complete','unpublished','restricted','unsupported'];
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
const activeAccount = alias => `(${alias}.account_id IS NULL OR EXISTS(SELECT 1 FROM provider_accounts a WHERE a.id=${alias}.account_id AND a.generation=${alias}.authorization_generation AND a.active=1 AND a.provider=${alias}.provider))`;
const demanded = (alias,subscriberPredicate='1') => `EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=${alias}.id AND (${subscriberPredicate}) AND (s.kind='account' OR (${alias}.stage='maintenance' AND EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id AND l.state='deleting')) OR (${alias}.stage<>'maintenance' AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id))))`;
const field=(row,name)=>typeof row==='string'?`${row}.${name}`:row[name];
const admission = (job,subscription) => `(${field(subscription,'kind')}='account' OR EXISTS(SELECT 1 FROM app_teams t WHERE t.id=${field(subscription,'app_team_id')} AND ((${field(job,'stage')}<>'maintenance' AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id)) OR (${field(job,'provider')}='maintenance' AND ${field(job,'component')}='team_delete' AND ${field(job,'stage')}='maintenance' AND ${field(job,'scope')}=t.id AND ${field(job,'resource_key')}=t.id AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id AND l.state='deleted')))))`;
const jsonRow=alias=>Object.fromEntries(['kind','app_team_id','stage','provider','component','scope','resource_key'].map(name=>[name,`json_extract(${alias},'$.${name}')`]));
const jsonAdmission=(job,subscription)=>admission(jsonRow(job),jsonRow(subscription));
const jsonAccount=alias=>`(json_extract(${alias},'$.account_id') IS NULL OR EXISTS(SELECT 1 FROM provider_accounts a WHERE a.id=json_extract(${alias},'$.account_id') AND a.generation=json_extract(${alias},'$.authorization_generation') AND a.active=1 AND a.provider=json_extract(${alias},'$.provider')))`;
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
function insertJobs(guard, refresh=false) {
  const reset = "sync_jobs.state='disabled' OR sync_jobs.args<>excluded.args OR sync_jobs.authorization_generation<>excluded.authorization_generation";
  const refreshable = refresh ? "sync_jobs.state<>'running'" : '0';
  const scanReset = `(${reset}) OR ((${refreshable}) AND sync_jobs.state='ready')`;
  return `INSERT INTO sync_jobs(${columns.join(',')}) SELECT ${columns.map(column=>`json_extract(v.value,'$.${column}')`).join(',')} FROM json_each(?) v WHERE ${guard} ON CONFLICT(provider,account_scope,component,scope,resource_key) DO UPDATE SET args=excluded.args,priority=excluded.priority,authorization_generation=excluded.authorization_generation,generation=sync_jobs.generation+CASE WHEN ${reset} THEN 1 ELSE 0 END,state=CASE WHEN (${reset}) OR (${refreshable}) THEN 'queued' ELSE sync_jobs.state END,lease_token=CASE WHEN ${reset} THEN NULL ELSE sync_jobs.lease_token END,lease_until=CASE WHEN ${reset} THEN 0 ELSE sync_jobs.lease_until END,checkpoint=CASE WHEN ${scanReset} THEN '{}' ELSE sync_jobs.checkpoint END,scan_id=CASE WHEN ${scanReset} THEN excluded.scan_id ELSE sync_jobs.scan_id END,next_at=CASE WHEN (${reset}) OR (${refreshable}) THEN excluded.next_at ELSE sync_jobs.next_at END,ready_since=CASE WHEN (${reset}) OR (${refreshable}) THEN excluded.ready_since ELSE sync_jobs.ready_since END`;
}

export class JobCoordinator {
  constructor(db, options = {}) {
    this.db = db;
    this.clock = options.clock || Date.now;
    this.leaseMs = options.leaseMs ?? 45000;
    this.retryBaseMs = options.retryBaseMs ?? 60000;
    this.retryMaxMs = options.retryMaxMs ?? 21600000;
    this.ageMs = options.ageMs ?? 300000;
    this.pageDelayMs = options.pageDelayMs ?? 500;
  }
  revisions(sqlWhere, params = [], content = false) {
    return this.db.prepare(`UPDATE team_read_state SET status_revision=status_revision+1${content ? ',content_revision=content_revision+1' : ''} WHERE app_team_id IN (${sqlWhere})`).bind(...params);
  }
  accountRevisions(where, params = []) {
    return this.db.prepare(`INSERT INTO sync_account_read_state(account_id,status_revision) SELECT DISTINCT account_id,1 FROM sync_jobs WHERE account_id IS NOT NULL AND (${where}) ON CONFLICT(account_id) DO UPDATE SET status_revision=status_revision+1`).bind(...params);
  }
  auditStatements(lease, observations, guard, at) {
    const rows=observationRows(lease,observations||[],at);if(!rows.length)return [];
    const data=JSON.stringify(rows);if(size(data)>32768)throw new SyncError('contract_violation','Source audit exceeded its byte bound.',{kind:'permanent'});
    const fields=Object.keys(rows[0]);
    return [this.db.prepare(`INSERT OR IGNORE INTO sync_observations(${fields.join(',')}) SELECT ${fields.map(field=>`json_extract(value,'$.${field}')`).join(',')} FROM json_each(?) WHERE ${guard}`).bind(data),
      this.db.prepare(`DELETE FROM sync_observations WHERE id IN(SELECT id FROM sync_observations WHERE at<? ORDER BY at LIMIT 500) AND ${guard}`).bind(at-14*86400000)];
  }
  async enqueue(spec, subscribers) {
    if (!Array.isArray(subscribers) || !subscribers.length || subscribers.length > 128) throw new SyncError('invalid_job', 'Work requires bounded explicit demand.', { kind: 'permanent' });
    const at = this.clock(), row = specRow(spec, at), demand = subscribers.map(subscriberRow);
    if (row.account_id) {
      const account = await this.db.prepare('SELECT provider,generation,active FROM provider_accounts WHERE id=?').bind(row.account_id).first();
      if (!account?.active || account.provider !== row.provider || account.generation !== row.authorization_generation) throw new SyncError('authorization_revoked', 'The authorization generation changed.', { kind: 'blocked' });
      if (demand.some(s => s.kind === 'account' && s.demand_key !== row.account_id)) throw new SyncError('invalid_job', 'Account discovery demand belongs to another account.', { kind: 'permanent' });
    } else if (demand.some(s => s.kind === 'account')) throw new SyncError('invalid_job', 'Public work cannot enumerate an account.', { kind: 'permanent' });
    const key = [row.provider,row.account_scope,row.component,row.scope,row.resource_key],subscriptionData=JSON.stringify(demand);
    await this.db.batch([
      this.db.prepare(insertJobs(`${jsonAccount('v.value')} AND EXISTS(SELECT 1 FROM json_each(?) s WHERE ${jsonAdmission('v.value','s.value')})`)).bind(JSON.stringify([row]),subscriptionData),
      this.db.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT j.id,json_extract(s.value,'$.kind'),json_extract(s.value,'$.demand_key'),json_extract(s.value,'$.app_team_id'),json_extract(s.value,'$.generation') FROM sync_jobs j JOIN json_each(?) s WHERE j.provider=? AND j.account_scope=? AND j.component=? AND j.scope=? AND j.resource_key=? AND ${activeAccount('j')} AND ${admission('j',jsonRow('s.value'))} ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET app_team_id=excluded.app_team_id,generation=excluded.generation`).bind(subscriptionData,...key),
      this.revisions(`SELECT app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.provider=? AND j.account_scope=? AND j.component=? AND j.scope=? AND j.resource_key=?`,key),
      this.accountRevisions('provider=? AND account_scope=? AND component=? AND scope=? AND resource_key=?',key),
    ]);
    const saved=await this.db.prepare(`SELECT j.id FROM sync_jobs j WHERE j.provider=? AND j.account_scope=? AND j.component=? AND j.scope=? AND j.resource_key=? AND ${activeAccount('j')} AND EXISTS(SELECT 1 FROM json_each(?) s WHERE ${admission('j',jsonRow('s.value'))})`).bind(...key,subscriptionData).first();
    if(!saved)throw unavailableDemand();return saved.id;
  }
  async enqueueMany(specs, subscribers, {refresh=false}={}) {
    if (!Array.isArray(specs) || !specs.length || specs.length>32 || !Array.isArray(subscribers) || !subscribers.length || subscribers.length>128) throw new SyncError('invalid_job','Root work requires bounded explicit demand.',{kind:'permanent'});
    const rows=specs.map(spec=>specRow(spec,this.clock())),demand=subscribers.map(subscriberRow);
    const privateRows=rows.filter(row=>row.account_id);
    if(privateRows.length) {
      const accounts=(await this.db.prepare('SELECT id,provider,generation,active FROM provider_accounts WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set(privateRows.map(row=>row.account_id))])).all()).results;
      if(privateRows.some(row=>!accounts.some(account=>account.id===row.account_id&&account.provider===row.provider&&account.generation===row.authorization_generation&&account.active===1))) throw new SyncError('authorization_revoked','Provider authorization changed.',{kind:'blocked'});
    }
    if(demand.some(subscriber=>subscriber.kind==='account'&&rows.some(row=>row.account_id!==subscriber.demand_key))) throw new SyncError('invalid_job','Catalog demand cannot cross account scopes.',{kind:'permanent'});
    const data=JSON.stringify(rows),subscriptionData=JSON.stringify(demand);
    if(size(data)+size(subscriptionData)>262144) throw new SyncError('contract_violation','Root demand exceeded its bound.',{kind:'permanent'});
    await this.db.batch([
      this.db.prepare(insertJobs(`${jsonAccount('v.value')} AND EXISTS(SELECT 1 FROM json_each(?) s WHERE ${jsonAdmission('v.value','s.value')})`,refresh)).bind(data,subscriptionData),
      this.db.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT j.id,json_extract(s.value,'$.kind'),json_extract(s.value,'$.demand_key'),json_extract(s.value,'$.app_team_id'),json_extract(s.value,'$.generation') FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN json_each(?) s WHERE ${activeAccount('j')} AND ${admission('j',jsonRow('s.value'))} ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET app_team_id=excluded.app_team_id,generation=excluded.generation`).bind(data,subscriptionData),
      this.revisions(`SELECT s.app_team_id FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN sync_job_subscribers s ON s.job_id=j.id`,[data]),
      this.accountRevisions(`id IN(SELECT j.id FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')})`,[data]),
    ]);
    const saved=(await this.db.prepare(`SELECT DISTINCT j.id FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} WHERE ${activeAccount('j')} AND EXISTS(SELECT 1 FROM json_each(?) s WHERE ${admission('j',jsonRow('s.value'))}) ORDER BY j.id`).bind(data,subscriptionData).all()).results.map(row=>row.id);
    if(!saved.length)throw unavailableDemand();return saved;
  }
  async claim() {
    const at = this.clock(), token = crypto.randomUUID();
    // Aging lets historical work advance while recent pages receive useful priority.
    const results=await this.db.batch([
      this.db.prepare(`UPDATE sync_jobs SET state='running',lease_token=?,lease_until=?,attempts=attempts+1,last_attempt_at=?,checkpoint=CASE WHEN state='ready' THEN '{}' ELSE checkpoint END,scan_id=CASE WHEN state='ready' THEN ? ELSE scan_id END WHERE id=(SELECT j.id FROM sync_jobs j WHERE j.state IN ('queued','running','ready','retrying') AND NOT(j.state='ready' AND j.recurring=0) AND j.next_at<=? AND j.lease_until<=? AND ${activeAccount('j')} AND ${demanded('j')} ORDER BY (j.priority+CAST((?-j.ready_since)/? AS INTEGER)) DESC,j.next_at,j.id LIMIT 1) AND lease_until<=? RETURNING *`).bind(token,at+this.leaseMs,at,crypto.randomUUID(),at,at,at,this.ageMs,at),
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
    const checkpoint = JSON.stringify(result.checkpoint || {});
    if (size(checkpoint) > 8192) throw new SyncError('contract_violation', 'Checkpoint exceeds its bound.', { kind: 'permanent' });
    const at = this.clock(), commitToken = crypto.randomUUID(), retrievedAt = retrievedTimestamp(result.retrievedAt,this.clock());
    const fence = `EXISTS(SELECT 1 FROM sync_commit_fences WHERE job_id=${quote(lease.id)} AND commit_token=${quote(commitToken)})`;
    const statements = [this.db.prepare(`INSERT INTO sync_commit_fences(job_id,commit_token) SELECT j.id,? FROM sync_jobs j WHERE j.id=? AND j.lease_token=? AND j.generation=? AND j.lease_until>? AND ${activeAccount('j')} AND ${demanded('j')} ON CONFLICT(job_id) DO UPDATE SET commit_token=excluded.commit_token`).bind(commitToken,lease.id,lease.lease_token,lease.generation,at)];
    let payloadBytes = size(checkpoint);
    for (const statement of result.statements || []) {
      if (typeof statement.sql !== 'string' || !statement.sql.includes('$FENCE') || !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(statement.sql) || /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:sync_\w+|provider_accounts)\b/i.test(statement.sql) || /;/.test(statement.sql)) throw new SyncError('contract_violation', 'Source writes require the transaction fence.', { kind: 'permanent' });
      payloadBytes += size(statement.params || []);
      statements.push(this.db.prepare(statement.sql.replaceAll('$FENCE',fence)).bind(...(statement.params || [])));
    }
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
      const projectionDemand = childRows.some(row=>row.subscriber_mode==='projection') ? ` OR (json_extract(v.value,'$.subscriber_mode')='projection' AND EXISTS(SELECT 1 FROM team_projection_state p JOIN team_seasons ts ON ts.id=p.team_season_id WHERE p.app_team_id=json_extract(v.value,'$.scope') AND p.team_season_id=json_extract(v.value,'$.resource_key') AND ts.app_team_id=p.app_team_id AND p.pending=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=p.app_team_id)))` : '';
      const childDemand = `(json_extract(v.value,'$.subscriber_mode')='inherit' OR (json_extract(v.value,'$.subscriber_mode')='explicit' AND EXISTS(SELECT 1 FROM sync_job_subscribers s JOIN json_each(v.value,'$.subscribers') x WHERE s.job_id=${quote(lease.id)} AND (s.kind='account' OR NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=s.app_team_id)) AND json_extract(x.value,'$.kind')=s.kind AND json_extract(x.value,'$.demand_key')=s.demand_key AND json_extract(x.value,'$.app_team_id') IS s.app_team_id AND json_extract(x.value,'$.generation')=s.generation)))${projectionDemand}`;
      if (size(data) > 262144) throw new SyncError('contract_violation', 'Child demand page is too large.', { kind: 'permanent' });
      statements.push(this.db.prepare(insertJobs(`(${fence}) AND (${childDemand})`)).bind(data));
      // Explicit children can narrow the parent's current demand, never grant new visibility.
      statements.push(this.db.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT j.id,s.kind,s.demand_key,s.app_team_id,s.generation FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN sync_job_subscribers s ON s.job_id=? WHERE ${fence} AND ${admission('j','s')} AND (json_extract(v.value,'$.subscriber_mode')='inherit' OR EXISTS(SELECT 1 FROM json_each(v.value,'$.subscribers') x WHERE json_extract(x.value,'$.kind')=s.kind AND json_extract(x.value,'$.demand_key')=s.demand_key AND json_extract(x.value,'$.app_team_id') IS s.app_team_id AND json_extract(x.value,'$.generation')=s.generation)) ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET app_team_id=excluded.app_team_id,generation=excluded.generation`).bind(data,lease.id));
      if (projectionDemand) statements.push(this.db.prepare(`INSERT INTO sync_job_subscribers(job_id,kind,demand_key,app_team_id,generation) SELECT j.id,'team',json_extract(x.value,'$.demand_key'),p.app_team_id,json_extract(x.value,'$.generation') FROM json_each(?) v JOIN sync_jobs j ON ${keyJoin('j','v.value')} JOIN json_each(v.value,'$.subscribers') x JOIN team_projection_state p ON p.app_team_id=j.scope AND p.team_season_id=j.resource_key JOIN team_seasons ts ON ts.id=p.team_season_id AND ts.app_team_id=p.app_team_id WHERE ${fence} AND json_extract(v.value,'$.subscriber_mode')='projection' AND json_extract(x.value,'$.kind')='team' AND json_extract(x.value,'$.app_team_id')=p.app_team_id AND p.pending=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=p.app_team_id) ON CONFLICT(job_id,kind,demand_key) DO UPDATE SET generation=excluded.generation`).bind(data));
    }
    if(result.removeTeamDemand)statements.push(
      this.db.prepare(`UPDATE sync_jobs SET state='disabled',generation=generation+1,lease_token=NULL,lease_until=0 WHERE state<>'disabled' AND id IN(SELECT job_id FROM sync_job_subscribers WHERE rowid IN(SELECT rowid FROM sync_job_subscribers WHERE app_team_id=? AND job_id<>? LIMIT 100)) AND NOT ${demanded('sync_jobs')} AND ${fence}`).bind(lease.scope,lease.id),
      this.db.prepare(`DELETE FROM sync_job_subscribers WHERE rowid IN(SELECT rowid FROM sync_job_subscribers WHERE app_team_id=? AND job_id<>? LIMIT 100) AND ${fence}`).bind(lease.scope,lease.id),
    );
    if (payloadBytes > 2000000) throw new SyncError('contract_violation', 'Page transaction exceeded its byte bound.', { kind: 'permanent' });
    statements.push(...this.auditStatements(lease,result.observations,fence,at));
    statements.push(this.revisions(`SELECT app_team_id FROM sync_job_subscribers WHERE job_id=? AND ${fence}`,[lease.id],!!result.publishContent));
    // Catalog discovery has its own revision and cannot create an app-owned team.
    if(lease.account_id)statements.push(this.db.prepare(`INSERT INTO sync_account_read_state(account_id,catalog_revision,status_revision) SELECT j.account_id,CASE WHEN EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=j.id AND s.kind='account') THEN 1 ELSE 0 END,1 FROM sync_jobs j WHERE j.id=? AND j.account_id IS NOT NULL AND ${fence} ON CONFLICT(account_id) DO UPDATE SET catalog_revision=catalog_revision+excluded.catalog_revision,status_revision=status_revision+1`).bind(lease.id));
    const updateIndex = statements.length;
    statements.push(this.db.prepare(`UPDATE sync_jobs SET state=?,coverage=?,checkpoint=?,next_at=?,ready_since=?,lease_token=NULL,lease_until=0,failures=0,last_error_code=NULL,last_error_message=NULL,failure_kind=NULL,last_retrieved_at=COALESCE(?,last_retrieved_at),last_saved_at=?,last_complete_at=CASE WHEN ? THEN ? ELSE last_complete_at END,pages_saved=pages_saved+1,rows_saved=rows_saved+? WHERE id=? AND lease_token=? AND generation=? AND ${fence}`).bind(result.complete?'ready':'queued',result.coverage || (result.complete?'complete':'partial'),checkpoint,at+(result.complete?lease.interval_ms:this.pageDelayMs),at+(result.complete?lease.interval_ms:this.pageDelayMs),retrievedAt,at,result.complete?1:0,at,Math.max(0,Number(result.rowsSaved)||0),lease.id,lease.lease_token,lease.generation));
    statements.push(this.db.prepare('DELETE FROM sync_commit_fences WHERE job_id=? AND commit_token=?').bind(lease.id,commitToken));
    if (this.db.remaining !== undefined && statements.length > this.db.remaining) throw new SyncError('invocation_budget', 'The page needs another invocation.', { retryAfterMs: 1000 });
    const saved = await this.db.batch(statements);
    if (saved[updateIndex].meta.changes !== 1) return { state:'lease_lost', committed:false };
    return { state:result.complete?'ready':'queued', committed:true, coverage:result.coverage || (result.complete?'complete':'partial') };
  }
  async fail(lease, error) {
    const info = classifyFailure(error), at = this.clock();
    const retrievedAt = retrievedTimestamp(error?.retrievedAt,at);
    const coverage = error?.coverage && coverages.includes(error.coverage) ? error.coverage : null;
    const wait = Math.max(info.retryAfterMs, Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.min(lease.failures,12)));
    const next = info.kind === 'temporary' ? at + wait : at;
    const state = info.kind === 'blocked' ? 'blocked' : info.kind === 'permanent' ? 'failed' : 'retrying';
    const guard = `EXISTS(SELECT 1 FROM sync_jobs j WHERE j.id=${quote(lease.id)} AND j.lease_token=${quote(lease.lease_token)} AND j.generation=${lease.generation} AND j.lease_until>${at} AND ${activeAccount('j')})`;
    const results = await this.db.batch([
      ...this.auditStatements(lease,error?.observations,guard,at),
      this.revisions(`SELECT app_team_id FROM sync_job_subscribers WHERE job_id=? AND ${guard}`,[lease.id]),
      this.accountRevisions(`id=? AND ${guard}`,[lease.id]),
      this.db.prepare(`UPDATE sync_jobs SET state=?,next_at=?,lease_token=NULL,lease_until=0,failures=failures+1,last_error_code=?,last_error_message=?,failure_kind=?,last_retrieved_at=COALESCE(?,last_retrieved_at),coverage=COALESCE(?,coverage) WHERE id=? AND ${guard}`).bind(state,next,info.code,info.message,info.kind,retrievedAt,coverage,lease.id),
    ]);
    return { state:results.at(-1).meta.changes?state:'lease_lost', error:info };
  }
  async retry(id) {
    const at = this.clock();
    const results = await this.db.batch([
      this.revisions('SELECT s.app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.id=? AND j.lease_until<=? AND '+activeAccount('j'),[id,at]),
      this.accountRevisions('id=? AND lease_until<=? AND '+activeAccount('sync_jobs'),[id,at]),
      this.db.prepare(`UPDATE sync_jobs SET state='queued',next_at=?,ready_since=? WHERE id=? AND lease_until<=? AND ${activeAccount('sync_jobs')} AND ${demanded('sync_jobs')}`).bind(at,at,id,at),
    ]);
    return results.at(-1).meta.changes === 1;
  }
  async unsubscribe(kind, key) {
    await this.db.batch([
      this.revisions('SELECT app_team_id FROM sync_job_subscribers WHERE kind=? AND demand_key=?',[kind,key]),
      this.accountRevisions('id IN(SELECT job_id FROM sync_job_subscribers WHERE kind=? AND demand_key=?)',[kind,key]),
      this.db.prepare(`UPDATE sync_jobs SET state='disabled',generation=generation+1,lease_token=NULL,lease_until=0 WHERE id IN(SELECT job_id FROM sync_job_subscribers WHERE kind=? AND demand_key=?) AND NOT ${demanded('sync_jobs','NOT(s.kind=? AND s.demand_key=?)')} AND state<>'disabled'`).bind(kind,key,kind,key),
      this.db.prepare('DELETE FROM sync_job_subscribers WHERE kind=? AND demand_key=?').bind(kind,key),
    ]);
  }
  async deactivateAccount(accountId) {
    await this.db.batch([
      this.revisions('SELECT s.app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.account_id=?',[accountId]),
      this.accountRevisions('account_id=?',[accountId]),
      this.db.prepare("UPDATE sync_jobs SET state='disabled',generation=generation+1,lease_token=NULL,lease_until=0 WHERE account_id=?").bind(accountId),
    ]);
  }
  async restartAccount(accountId) {
    const account = await this.db.prepare('SELECT generation,active FROM provider_accounts WHERE id=?').bind(accountId).first();
    if (!account?.active) throw new SyncError('authentication_required','Reconnect the account.',{kind:'blocked'});
    await this.db.batch([
      this.revisions('SELECT s.app_team_id FROM sync_job_subscribers s JOIN sync_jobs j ON j.id=s.job_id WHERE j.account_id=?',[accountId]),
      this.accountRevisions('account_id=?',[accountId]),
      this.db.prepare(`UPDATE sync_jobs SET authorization_generation=?,generation=generation+1,lease_token=NULL,lease_until=0,checkpoint='{}',scan_id=?,state='queued',next_at=?,ready_since=? WHERE account_id=? AND ${demanded('sync_jobs')}`).bind(account.generation,crypto.randomUUID(),this.clock(),this.clock(),accountId),
    ]);
  }
  async nextWake() {
    const row = await this.db.prepare(`SELECT MIN(CASE WHEN j.lease_until>? THEN j.lease_until ELSE j.next_at END) AS at FROM sync_jobs j WHERE j.state IN ('queued','running','ready','retrying') AND NOT(j.state='ready' AND j.recurring=0) AND ${activeAccount('j')} AND ${demanded('j')}`).bind(this.clock()).first();
    return row?.at ?? null;
  }
  async status(teamId,{includeExports=false}={}) {
    // Full authorized demand is aggregated in SQL. Detail pagination cannot truncate totals or revisions.
    const revision = await this.db.prepare('SELECT content_revision,status_revision,pending FROM team_read_state WHERE app_team_id=?').bind(teamId).first();
    if (!revision) throw new SyncError('invalid_job','Unknown team.',{kind:'permanent'});
    const counts = (await this.db.prepare(`SELECT j.stage,j.state,j.coverage,COUNT(*) AS count,MAX(j.last_saved_at) AS newest_saved_at,MIN(j.last_saved_at) AS oldest_saved_at,MAX(j.last_retrieved_at) AS newest_retrieved_at,MAX(j.last_complete_at) AS newest_complete_at,MIN(CASE WHEN j.state IN ('queued','running','ready','retrying') AND NOT(j.state='ready' AND j.recurring=0) THEN CASE WHEN j.lease_until>? THEN j.lease_until ELSE j.next_at END END) AS next_due_at FROM sync_jobs j WHERE ${includeExports?"j.stage<>'maintenance'":"j.stage NOT IN('export','maintenance')"} AND EXISTS(SELECT 1 FROM sync_job_subscribers s WHERE s.job_id=j.id AND s.app_team_id=?) GROUP BY j.stage,j.state,j.coverage`).bind(this.clock(),teamId).all()).results;
    return { ...revision, total:counts.reduce((n,row)=>n+row.count,0), groups:counts };
  }
  async accountStatus(accountId) {
    const revision = await this.db.prepare('SELECT catalog_revision,status_revision FROM sync_account_read_state WHERE account_id=?').bind(accountId).first() || {catalog_revision:0,status_revision:0};
    const groups = (await this.db.prepare(`SELECT j.stage,j.state,j.coverage,COUNT(*) AS count,MAX(j.last_retrieved_at) AS newest_retrieved_at,MAX(j.last_saved_at) AS newest_saved_at FROM sync_jobs j WHERE j.account_id=? AND ${demanded('j')} GROUP BY j.stage,j.state,j.coverage`).bind(accountId).all()).results;
    return {...revision,total:groups.reduce((n,row)=>n+row.count,0),groups};
  }
  async runOne(collector, context = {}) {
    const lease = await this.claim();
    if (!lease) return {state:'idle'};
    try {
      const result = await collector({ ...context, db:this.db, lease, args:lease.args, checkpoint:lease.checkpoint });
      return {jobId:lease.id,...await this.commit(lease,result)};
    } catch (error) {
      // Budget exhaustion before commit is a retry, not a successful partial page.
      return {jobId:lease.id,...await this.fail(lease,error)};
    }
  }
}
