/** Read-only, bounded acquisition for team-game-resolver. This adapter never
 * supplies a UI page as uniqueness evidence and never changes native identity.
 * acceptedAssociations are explicit typed durable heads supplied by storage.
 * Publish only after rechecking fence (including jobs, not just source clocks).
 */
import {hash} from '../sources/common.js';
import {SUBSCRIBER_FIELDS} from './team-game-control-witness.js';
export const TEAM_GAME_CANDIDATE_LIMITS = Object.freeze({page:24, closureQueries:16, events:128, scopes:32, links:64, jobs:512, eventBytes:1_000_000, controlBytes:512_000, inputBytes:256_000, coverageRows:1024, coverageBytes:256_000});
const PUBLIC = new Set(['gotsport','live']);
const parse = value => {try{return typeof value==='string'?JSON.parse(value):value??{};}catch{return {};}};
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const unique = values => [...new Set(values)].sort();
const volatile = new Set(['observed_at','verified_at','catalog_scan_id','scan_id','checked_at','expires_at','retrieved_at','fetched_at']);
function semantic(value) {return Array.isArray(value)?value.map(semantic):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>!volatile.has(k)).map(k=>[k,k==='observations'&&Array.isArray(value[k])?value[k].map(o=>semantic(Object.fromEntries(Object.entries(o).filter(([key])=>key!=='at')))):semantic(value[k])])):value;}
const iso = n => new Date(n).toISOString();
const validInt = n => Number.isSafeInteger(n)&&n>=0;
const positive = n => Number.isSafeInteger(n)&&n>0;
const side = n => n==='home'||n==='away';
// Date.parse accepts rolled-over calendar dates. Never use those as collisions.
export function teamGameInstant(value) {
  if(typeof value!=='string')return null;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if(!m)return null;
  const [,y,mo,d,h,mi,s,z]=m,year=Number(y),month=Number(mo),day=Number(d),leap=year%4===0&&(year%100!==0||year%400===0);
  if(month<1||month>12||day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1]||+h>23||+mi>59||+s>59||z==='-00:00'||z.toUpperCase()!=='Z'&&(+z.slice(1,3)>23||+z.slice(4)>59))return null;
  const n=Date.parse(value);return Number.isFinite(n)?n:null;
}
function mergeWindows(rows) {
  const windows=rows.map(row=>teamGameInstant(row.starts_at)).filter(n=>n!==null).sort((a,b)=>a-b).map(n=>({from:n-60_000,to:n+60_000})),out=[];
  for(const w of windows){const prior=out.at(-1);if(prior&&w.from<=prior.to)prior.to=Math.max(prior.to,w.to);else out.push({...w});}return out;
}
const objectSQL = (alias,columns) => `json_object(${columns.map(c=>`'${c}',${alias}.${c}`).join(',')})`;
/** SQL returns one bounded JSON envelope, even if its first evidence row is too
 * large. The sentinel is counted before byte filtering; prefixes never prove
 * completeness. SQL ordering is supplied by each fixed internal query. */
async function bounded(db,sql,params,maxRows,maxBytes) {
  const result=await db.prepare(`WITH candidate AS MATERIALIZED(${sql} LIMIT ${maxRows+1}),sized AS(SELECT row_json,length(CAST(row_json AS BLOB)) n,ROW_NUMBER() OVER() rn FROM candidate),counted AS(SELECT *,SUM(n) OVER(ORDER BY rn) total_bytes FROM sized) SELECT (SELECT COUNT(*) FROM candidate) count,COALESCE((SELECT SUM(n) FROM sized),0) bytes,COALESCE((SELECT json_group_array(json(row_json)) FROM counted WHERE rn<=${maxRows} AND total_bytes<=${maxBytes}),'[]') rows`).bind(...params).first();
  return {rows:parse(result.rows),overflow:result.count>maxRows||result.bytes>maxBytes,bytes:result.bytes};
}
const ROOT_COLUMNS=['id','app_team_id','source_team_id','account_id','scope_mode','scope_origin','active','generation','input_revision','reconciled_revision'];
async function readScope(db,teamId,seasonId,limits,now) {
  const context=await db.prepare(`SELECT t.id,t.timezone,s.id season_id,s.start_day,s.end_day,p.input_revision,p.published_run_id,d.source_revision,d.mutation_revision,EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id AND l.state IN('deleting','deleted')) removed FROM app_teams t JOIN team_seasons s ON s.app_team_id=t.id AND s.id=? JOIN team_projection_state p ON p.app_team_id=t.id AND p.team_season_id=s.id CROSS JOIN domain_installation d WHERE t.id=? AND d.id=1`).bind(seasonId,teamId).first();
  if(!context||context.removed)throw Object.assign(new Error('Team season is unavailable.'),{code:'source_scope',status:403});
  const roots=await bounded(db,`SELECT json_patch(${objectSQL('r',ROOT_COLUMNS)},json_object('basis','root','provider',st.provider,'native_id',st.native_id,'provenance',st.provenance,'source_scope',st.scope,'source_account_id',st.account_id,'team_season_id',m.team_season_id,'membership_active',m.active,'excluded',m.excluded,'membership_generation',m.generation,'attachment_id',a.id,'attachment_generation',a.generation,'attachment_active',a.active,'attachment_source_team_id',a.source_team_id,'attachment_account_id',a.account_id,'account_generation',pa.generation,'account_active',pa.active)) row_json FROM team_source_connections r JOIN source_teams st ON st.id=r.source_team_id LEFT JOIN team_connection_seasons m ON m.connection_id=r.id AND m.team_season_id=? LEFT JOIN team_source_attachments a ON a.id=m.attachment_id LEFT JOIN provider_accounts pa ON pa.id=r.account_id WHERE r.app_team_id=? AND st.provider IN('teamsnap','gotsport','live') ORDER BY r.id`,[seasonId,teamId],limits.scopes,limits.controlBytes);
  const legacy=await bounded(db,`SELECT json_object('id',a.id,'basis','legacy_attachment','app_team_id',a.app_team_id,'team_season_id',a.team_season_id,'source_team_id',a.source_team_id,'account_id',a.account_id,'active',a.active,'attachment_id',a.id,'attachment_generation',a.generation,'attachment_active',a.active,'membership_generation',NULL,'excluded',0,'provider',st.provider,'native_id',st.native_id,'provenance',st.provenance,'source_scope',st.scope,'source_account_id',st.account_id,'account_generation',pa.generation,'account_active',pa.active) row_json FROM team_source_attachments a JOIN source_teams st ON st.id=a.source_team_id LEFT JOIN provider_accounts pa ON pa.id=a.account_id WHERE a.app_team_id=? AND a.team_season_id=? AND st.provider IN('teamsnap','gotsport','live') AND NOT EXISTS(SELECT 1 FROM team_source_connections r WHERE r.app_team_id=a.app_team_id AND r.source_team_id=a.source_team_id) AND NOT EXISTS(SELECT 1 FROM team_connection_seasons m WHERE m.attachment_id=a.id) ORDER BY a.id`,[teamId,seasonId],limits.scopes,limits.controlBytes);
  const all=[...roots.rows,...legacy.rows],connections=all.filter(r=>r.active===1&&r.attachment_active===1&&r.excluded!==1&&(r.source_account_id??null)===r.account_id&&((r.provider==='teamsnap'&&r.source_scope===r.account_id&&positive(r.account_generation))||(PUBLIC.has(r.provider)&&r.source_scope==='public'&&r.account_id===null))&&(r.basis==='legacy_attachment'||r.membership_active===1&&r.membership_generation===r.generation&&r.attachment_generation===r.generation&&r.attachment_source_team_id===r.source_team_id&&(r.attachment_account_id??null)===r.account_id)).map(r=>({...r,active:true,excluded:false}));
  const links=await bounded(db,`SELECT json_object('a',l.a,'b',l.b,'kind',l.kind,'evidence',l.evidence,'a_native',a.native_id,'b_native',b.native_id,'a_provenance',a.provenance,'b_provenance',b.provenance) row_json FROM source_team_links l JOIN source_teams a ON a.id=l.a AND a.provider='gotsport' AND a.scope='public' AND a.account_id IS NULL JOIN source_teams b ON b.id=l.b AND b.provider='live' AND b.scope='public' AND b.account_id IS NULL WHERE l.a IN(SELECT value FROM json_each(?)) OR l.b IN(SELECT value FROM json_each(?)) ORDER BY l.a,l.b`,[JSON.stringify(connections.map(r=>r.source_team_id)),JSON.stringify(connections.map(r=>r.source_team_id))],limits.links,limits.controlBytes);
  const aliases=[];
  for(const l of links.rows) {
    if(!checkedBridge(l,now))continue;
    for(const c of connections.filter(c=>c.source_team_id===l.a||c.source_team_id===l.b))aliases.push({...entitlement(c),generation:generation(c),root_provider:c.provider,root_source_team_id:c.source_team_id,provider:c.source_team_id===l.a?'live':'gotsport',source_team_id:c.source_team_id===l.a?l.b:l.a,native_id:c.source_team_id===l.a?l.b_native:l.a_native,method:'provider_external_key',valid:true,proof_id:await hash(semantic({...l,evidence:parse(l.evidence)}))});
  }
  return {context,connections,aliases,raw:{roots:roots.rows,legacy:legacy.rows,links:links.rows},overflow:roots.overflow||legacy.overflow||links.overflow||all.length>limits.scopes};
}
// Same current-proof contract as strict public correspondence, in both directions.
function checkedBridge(l,now) {
  const p=parse(l.evidence),observations=p.observations??[];
  const endpoint=(path,season=false)=>observations.some(o=>o.endpoint===`https://gotsportlive-api.azurewebsites.net/api/clubapi/${path}`&&String(parse(o.params).ClubID)===String(p.club)&&(!season||String(parse(o.params).SeasonID)===String(p.season)));
  return l.kind==='provider_external_key'&&l.a_provenance==='provider'&&l.b_provenance==='provider'&&String(p.team_id)===l.a_native&&String(p.live_team_id)===l.b_native&&p.external_source_name==='GotSport'&&Number(p.external_source_id)===6&&p.default_season===true&&String(p.item_id)===String(p.live_team_id)&&String(p.external_key)===String(p.team_id)&&p.club&&p.season&&p.season_name&&teamGameInstant(p.expires_at)>now&&teamGameInstant(p.verified_at)!==null&&teamGameInstant(p.verified_at)<=now+60_000&&endpoint('initclubteams')&&endpoint('getteams',true)&&observations.every(o=>o.status===200&&/^[a-f0-9]{64}$/i.test(o.hash??'')&&teamGameInstant(o.at)!==null&&now-teamGameInstant(o.at)<=6*3600000&&teamGameInstant(o.at)<=now+60000);
}
const generation = c => c.basis==='legacy_attachment'?c.attachment_generation:c.generation;
const entitlement = c => c.basis==='legacy_attachment'?{connection_id:null,attachment_id:c.attachment_id,attachment_generation:c.attachment_generation}:{connection_id:c.id,attachment_id:null,attachment_generation:null};
function sourceScopes(scope) {return scope.connections.flatMap(c=>[{...entitlement(c),provider:c.provider,source_team_id:c.source_team_id,native_id:c.native_id,account_id:c.account_id,connection:c},...scope.aliases.filter(a=>a.connection_id===(c.basis==='root'?c.id:null)&&a.attachment_id===(c.basis==='legacy_attachment'?c.id:null)).map(a=>({...a,account_id:null,connection:c}))]);}
const EVENT_COLUMNS=['id','provider','scope','account_id','native_id','competition_key','division_key','match_number','starts_at','local_day','time_precision','type','status','conditional','home_source_team_id','away_source_team_id','home_label','away_label','home_score','away_score','title','venue','evidence','provenance','content_hash','observed_at'];
const permitted=`EXISTS(SELECT 1 FROM json_each(?) scope JOIN source_event_teams own ON own.source_event_id=e.id AND own.source_team_id=json_extract(scope.value,'$.source_team_id') WHERE e.provider=json_extract(scope.value,'$.provider') AND e.account_id IS json_extract(scope.value,'$.account_id') AND ((e.provider='teamsnap' AND e.scope=e.account_id) OR(e.provider IN('gotsport','live') AND e.scope='public' AND e.account_id IS NULL)))`;
async function eventRows(db,scopes,predicate,params,limits,publicPeers=[]) {
  const scopeJSON=JSON.stringify(scopes.map(s=>({provider:s.provider,source_team_id:s.source_team_id,account_id:s.account_id})));
  return bounded(db,`SELECT json_patch(${objectSQL('e',EVENT_COLUMNS)},json_object('canonical_id',ce.canonical_id,'native_event_id',l.event_id,'canonical_revision',l.revision,'home_real',CASE WHEN ht.id IS NOT NULL AND ht.provider=e.provider AND ht.scope=e.scope AND ht.account_id IS e.account_id THEN 1 ELSE 0 END,'away_real',CASE WHEN at.id IS NOT NULL AND at.provider=e.provider AND at.scope=e.scope AND at.account_id IS e.account_id THEN 1 ELSE 0 END,'participants',(SELECT json_group_array(json_object('source_team_id',p.source_team_id,'side',p.side)) FROM source_event_teams p WHERE p.source_event_id=e.id))) row_json FROM source_events e LEFT JOIN event_source_links l ON l.source_event_id=e.id LEFT JOIN canonical_event_ids ce ON ce.input_id=l.event_id LEFT JOIN source_teams ht ON ht.id=e.home_source_team_id LEFT JOIN source_teams at ON at.id=e.away_source_team_id WHERE (${permitted} OR e.provider IN('gotsport','live') AND e.scope='public' AND e.account_id IS NULL AND ce.canonical_id IN(SELECT value FROM json_each(?))) AND (${predicate}) ORDER BY e.id`,[scopeJSON,JSON.stringify(publicPeers),...params],limits.events,limits.eventBytes);
}
function eventDTO(row,scopes) {
  const p=parse(row.evidence),participants=parse(row.participants),matching=scopes.filter(s=>s.provider===row.provider&&s.account_id===row.account_id&&participants.some(p=>p.source_team_id===s.source_team_id));
  // Prefer a direct connected identity, then stable root/attachment IDs. One
  // source observation stays one observation even when two roots prove it.
  matching.sort((a,b)=>(a.connection.provider===row.provider?0:1)-(b.connection.provider===row.provider?0:1)||a.connection.id.localeCompare(b.connection.id));
  const s=matching[0]??scopes.find(s=>PUBLIC.has(s.provider)),c=s?.connection??{id:null,basis:'root',generation:null,account_generation:null,membership_generation:null},own=participants.filter(p=>matching.some(s=>s.source_team_id===p.source_team_id)),ownSide=own.length===1&&side(own[0].side)?own[0].side:null,other=ownSide==='home'?'away':ownSide==='away'?'home':null;
  const real=which=>row[which+'_real']===1&&(row.provider!=='live'||p[which+'_real']===true)&&row.conditional===0;
  const reported=p.reported_scores??{},numeric=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
  return {source_id:row.id,provider:row.provider,...entitlement(c),connection_generation:c.basis==='root'?c.generation:null,account_generation:c.account_generation??null,membership_generation:c.membership_generation??null,account_id:row.account_id,source_team_id:matching[0]?.source_team_id??null,provenance:row.provenance,content_hash:row.content_hash,native_id:row.native_id,participants:participants.map(v=>({...v,real:PUBLIC.has(row.provider)?v.source_team_id===row[v.side+'_source_team_id']&&real(v.side):true})),starts_at:row.starts_at,local_day:row.local_day,time_precision:row.time_precision,type:row.type,status:row.status,conditional:row.conditional!==0,all_day:p.all_day===true,time_pending:p.time_pending===true||row.time_precision!=='instant',orientation_verified:row.provider==='teamsnap'?p.orientation_verified===true:true,own_side:row.provider==='teamsnap'&&p.orientation_verified!==true?null:ownSide,opponent:other?row[other+'_label']:null,opponent_id:PUBLIC.has(row.provider)?other?row[other+'_source_team_id']:null:typeof p.opponent_id==='string'?p.opponent_id:null,opponent_source_team_id:PUBLIC.has(row.provider)&&other?row[other+'_source_team_id']:null,opponent_real:!!other&&real(other),venue:row.venue,field:typeof p.field==='string'?p.field:null,venue_address:typeof p.address==='string'&&p.address?p.address:null,home_score:row.provider==='teamsnap'?numeric(reported.home):numeric(row.home_score),away_score:row.provider==='teamsnap'?numeric(reported.away):numeric(row.away_score),result_authority:PUBLIC.has(row.provider)?'official':'reported',result_verified:PUBLIC.has(row.provider)&&row.provenance==='provider'&&row.status==='FINAL',result_final:PUBLIC.has(row.provider)&&row.provenance==='provider'&&row.status==='FINAL'};
}
const JOB_COLUMNS=['id','provider','account_scope','account_id','authorization_generation','component','stage','scope','resource_key','args','checkpoint','scan_id','generation','state','coverage','last_complete_at','last_saved_at'];
const scheduleComponents=new Set(['profile','catalog','history','event','division','bridge','resolve','upcoming','membership','league','organizer','categories','fixture','participant','events']);
async function controls(db,scope,scopes,limits) {
  const demands=scope.connections.map(c=>({key:c.basis==='root'?'connection:'+c.id:c.id,generation:generation(c)}));
  const jobs=await bounded(db,`SELECT json_patch(${objectSQL('j',JOB_COLUMNS)},json_object('subscribers',json((SELECT json_group_array(json_object('job_id',job_id,'kind',kind,'app_team_id',app_team_id,'demand_key',demand_key,'generation',generation)) FROM(SELECT sub.* FROM sync_job_subscribers sub WHERE sub.job_id=j.id AND sub.kind='team' AND sub.app_team_id=? ORDER BY sub.job_id,sub.kind,sub.app_team_id,sub.demand_key,sub.generation))))) row_json FROM sync_jobs j WHERE j.stage='source' AND j.provider IN('teamsnap','gotsport','live') AND EXISTS(SELECT 1 FROM sync_job_subscribers sub JOIN json_each(?) demand ON sub.demand_key=json_extract(demand.value,'$.key') AND sub.generation=json_extract(demand.value,'$.generation') WHERE sub.job_id=j.id AND sub.kind='team' AND sub.app_team_id=?) ORDER BY j.id`,[scope.context.id,JSON.stringify(demands),scope.context.id],limits.jobs,limits.controlBytes);
  const coverage=await bounded(db,`SELECT json_object('id',v.id,'provider',v.provider,'scope',v.scope,'account_id',v.account_id,'kind',v.kind,'complete',v.complete,'record_count',v.record_count,'scan_id',v.scan_id,'observed_at',v.observed_at) row_json FROM source_component_coverage v WHERE EXISTS(SELECT 1 FROM json_each(?) s WHERE v.provider=json_extract(s.value,'$.provider') AND v.account_id IS json_extract(s.value,'$.account_id') AND v.scope=CASE WHEN v.provider='teamsnap' THEN 'teamsnap:'||json_extract(s.value,'$.native_id') ELSE json_extract(s.value,'$.native_id') END) AND v.kind IN('events','events_recent','history','catalog','profile','upcoming','membership') ORDER BY v.id`,[JSON.stringify(scopes.map(({provider,account_id,native_id})=>({provider,account_id,native_id})))],limits.jobs,limits.controlBytes);
  const relevant=jobs.rows.filter(j=>scheduleComponents.has(j.component));
  return {jobs:relevant.map(j=>({...j,demands:JSON.stringify(j.subscribers.map(s=>s.demand_key))})),subscribers:relevant.flatMap(j=>j.subscribers.map(s=>Object.fromEntries(SUBSCRIBER_FIELDS.map(k=>[k,s[k]])))),coverage:coverage.rows,overflow:jobs.overflow||coverage.overflow};
}
const validReceipt=(r,mode)=>r&&r.mode===mode&&validInt(r.started_at)&&validInt(r.completed_at)&&r.completed_at>=r.started_at&&validInt(r.count)&&positive(r.pages)&&/^[a-f0-9]{64}$/.test(r.digest??'')&&(r.total===null||r.total===r.count)&&r.filters&&JSON.stringify(r.filters)===JSON.stringify(mode==='full'?{}:{started_after:iso(Math.max(0,r.started_at-30*86400000)),started_before:iso(r.started_at+90*86400000)});
function overlaps(a,b) {return a.from<=b.to&&b.from<=a.to;}
async function coverageRows(scopes,control,windows,revision,now) {
  const out=[];
  for(const s of scopes)for(const window of windows) {
    const {connection:c}=s,scope=s.provider==='teamsnap'?'teamsnap:'+s.native_id:s.native_id,rows=control.coverage.filter(v=>v.provider===s.provider&&v.account_id===s.account_id&&v.scope===scope),related=control.jobs.filter(j=>j.provider===s.provider&&j.account_id===s.account_id&&parse(j.demands).includes(c.basis==='root'?'connection:'+c.id:c.id)),direct=related.filter(j=>String(parse(j.args).team_id)===s.native_id&&j.scope===scope&&j.resource_key===scope),reasons=[],receipts=[],pending=[];
    let scopeComplete=true,waitable=true;
    if(s.provider==='teamsnap') {
      const jobs=direct.filter(j=>j.component==='events');if(jobs.length!==1)reasons.push('events_job_unproven');
      for(const j of jobs){const cp=parse(j.checkpoint),r=cp.refresh,b=r?.binding,args=parse(j.args),full=rows.find(v=>v.kind==='events');
        const endpoint=(()=>{try{const u=new URL(b?.source);return u.origin==='https://api.teamsnap.com'&&!u.username&&!u.password&&!u.hash&&['/v3/events','/v3/events/search'].includes(u.pathname)&&u.searchParams.size===1&&u.searchParams.get('team_id')===s.native_id;}catch{return false;}})();
        const bound=r?.protocol==='teamsnap-refresh-v1'&&['teamsnap-refresh-v1','teamsnap-pages-v1'].includes(cp.protocol)&&b?.kind==='events'&&b.team_id===s.native_id&&b.account_id===s.account_id&&b.authorization_generation===j.authorization_generation&&b.args_url===(typeof args.url==='string'?args.url:null)&&b.payload===await hash(args)&&endpoint&&j.account_scope===s.account_id;
        if(!bound||!validReceipt(r?.full,'full')||r.full.completed_at>now+60000||!full||full.complete!==1||full.record_count!==r.full.count)reasons.push('full_receipt_unproven');
        if(r?.recent!==null&&r?.recent!==undefined&&(!validReceipt(r.recent,'recent')||!r.full||r.recent.started_at<r.full.started_at||r.recent.completed_at>now+60000))reasons.push('recent_receipt_unproven');
        // A completed recent scan is deliberately partial for the whole job.
        // The typed checkpoint alone owns recent freshness/count; ordinary
        // ingestion intentionally does not persist *_recent coverage rows.
        // Its separately retained full receipt still proves older scope.
        const terminal=cp.finished===true&&cp.protocol==='teamsnap-refresh-v1'&&r?.active===null&&['ready','disabled'].includes(j.state)&&j.coverage===(r?.recent?'partial':'complete')&&validInt(j.last_complete_at)&&j.last_complete_at>=Math.max(r?.full?.completed_at??0,r?.recent?.completed_at??0);
        scopeComplete&&=terminal;
        if(!terminal){const active=r?.active,range=active?.mode==='recent'?{from:teamGameInstant(active.filters?.started_after),to:teamGameInstant(active.filters?.started_before)}:null;
          // An absent/unvalidated checkpoint cannot delimit unfinished work.
          const validActive=bound&&cp.protocol==='teamsnap-pages-v1'&&cp.finished!==true&&active?.mode==='recent'&&validInt(active.started_at)&&JSON.stringify(active.filters)===JSON.stringify({started_after:iso(Math.max(0,active.started_at-30*86400000)),started_before:iso(active.started_at+90*86400000)});
          if(!validActive||overlaps(window,range))reasons.push('source_work_unresolved');
        }
        // Only a well-bound active traversal (or a claimed retained terminal
        // receipt) has a dependency that can release an evidence wait. Corrupt
        // bindings and unsupported/terminal outcomes are not refresh waits.
        const active=r?.active,activeScan=bound&&cp.protocol==='teamsnap-pages-v1'&&cp.finished!==true&&validInt(active?.started_at)&&(['full','recent'].includes(active?.mode))&&JSON.stringify(active.filters)===JSON.stringify(active.mode==='full'?{}:{started_after:iso(Math.max(0,active.started_at-30*86400000)),started_before:iso(active.started_at+90*86400000)});
        const claimed=bound&&cp.finished===true&&cp.protocol==='teamsnap-refresh-v1'&&r?.active===null&&validReceipt(r?.full,'full');
        if(['queued','running','retrying'].includes(j.state)&&(activeScan||claimed))pending.push(j.id);else if(!terminal)waitable=false;
        if(c.account_active===1&&j.authorization_generation!==c.account_generation)reasons.push('account_receipt_generation_changed');
        receipts.push({job_id:j.id,scan_id:j.scan_id,authorization_generation:j.authorization_generation,full:r?.full??null,recent:r?.recent??null,active:r?.active??null});
      }
    } else {
      // A complete own-team discovery traversal and all its subscribed schedule
      // children must settle. Division coverage alone cannot prove no unseen
      // competing fixture exists in another division. Broad unresolved children
      // conservatively block rather than pretending their scope is irrelevant.
      const required=s.provider==='gotsport'?['profile','catalog','history']:['upcoming','membership'];
      for(const component of required){const jobs=direct.filter(j=>j.component===component);if(jobs.length!==1||jobs.some(j=>!terminalJob(j)))reasons.push('public_discovery_unproven:'+component);}
      if(related.some(j=>!terminalJob(j)))reasons.push('public_source_work_unresolved');
      // GotSport history is explicitly past-only. Future neighborhoods require
      // complete competition discovery and every child; both are required above.
      for(const component of required)if(!rows.some(v=>v.kind===component&&v.complete===1))reasons.push('public_coverage_unproven:'+component);
      scopeComplete=related.every(terminalJob);
      waitable=required.every(component=>direct.filter(j=>j.component===component).length===1)&&related.filter(j=>!terminalJob(j)).every(j=>['queued','running','retrying'].includes(j.state));
      pending.push(...related.filter(j=>!terminalJob(j)&&['queued','running','retrying'].includes(j.state)).map(j=>j.id));
      receipts.push(...related.map(j=>({job_id:j.id,scan_id:j.scan_id,generation:j.generation,last_complete_at:j.last_complete_at,checkpoint:parse(j.checkpoint)})));
    }
    const ref={...entitlement(c),generation:generation(c),provider:s.provider,source_team_id:s.source_team_id,source_revision:revision,complete:reasons.length===0,from:iso(window.from),to:iso(window.to)};
    // Missing initial coverage is waitable only when its own uniquely bound
    // component job is active. An unrelated refresh cannot supply that proof.
    const refreshReasons=s.provider==='teamsnap'?reasons.every(r=>['full_receipt_unproven','source_work_unresolved'].includes(r)):reasons.every(r=>{
      if(r==='public_source_work_unresolved'||r.startsWith('public_discovery_unproven:'))return true;
      if(!r.startsWith('public_coverage_unproven:'))return false;
      const jobs=direct.filter(j=>j.component===r.slice('public_coverage_unproven:'.length));
      return jobs.length===1&&['queued','running','retrying'].includes(jobs[0].state);
    });
    out.push({...ref,scope_complete:ref.complete&&scopeComplete,pending_jobs:!ref.complete&&waitable&&refreshReasons?unique(pending):[],id:await hash({ref,receipts}),reasons:unique(reasons),receipt_ids:unique(receipts.map(r=>r.job_id)),receipt_hash:await hash(receipts)});
  }return out;
}
function terminalJob(j) {return j.state==='ready'&&j.coverage==='complete'&&parse(j.checkpoint).finished===true&&validInt(j.last_complete_at);}

/** Input canonicalEventIds is the requested projector page, not a candidate
 * cap. Every added native/canonical/durable member expands the collision search.
 * Overflow retains bounded diagnostic rows but makes the ENTIRE scope pending.
 */
export async function loadTeamGameCandidates(db,{teamId,seasonId,canonicalEventIds=[],acceptedAssociations=[],limits:overrides={},now=Date.now()}={}) {
  const limits={...TEAM_GAME_CANDIDATE_LIMITS};for(const [k,v]of Object.entries(overrides))if(k in limits&&positive(v))limits[k]=Math.min(v,limits[k]);
  if(!validInt(now)||typeof teamId!=='string'||typeof seasonId!=='string'||!Array.isArray(canonicalEventIds)||canonicalEventIds.some(v=>typeof v!=='string')||!Array.isArray(acceptedAssociations))throw new TypeError('Invalid candidate scope.');
  const reasons=[],requested=unique(canonicalEventIds),inputOverflow=requested.length>limits.page||bytes(acceptedAssociations)>limits.inputBytes;
  const scope=await readScope(db,teamId,seasonId,limits,now),scopes=sourceScopes(scope),initialControl=await controls(db,scope,scopes,limits),byId=new Map();
  let overflow=inputOverflow||scope.overflow||initialControl.overflow;
  const heads=inputOverflow?[]:acceptedAssociations.filter(a=>a.type==='team_game_association'&&a.teamId===teamId&&a.decision==='accepted'&&positive(a.revision)&&typeof a.association_id==='string'&&Array.isArray(a.source_ids)&&a.source_ids.every(id=>typeof id==='string'));
  const absorb=result=>{overflow ||= result.overflow;for(const row of result.rows)if(!byId.has(row.id)){if(byId.size>=limits.events||bytes([...byId.values(),row])>limits.eventBytes){overflow=true;break;}byId.set(row.id,row);}};
  if(!overflow)absorb(await eventRows(db,scopes,'ce.canonical_id IN(SELECT value FROM json_each(?)) OR l.event_id IN(SELECT value FROM json_each(?))',[JSON.stringify(requested),JSON.stringify(requested)],limits));
  let changed=true,iterations=0;
  while(changed&&!overflow) {
    if(iterations>=limits.closureQueries){overflow=true;reasons.push('candidate_query_bound_exceeded');break;}
    const rows=[...byId.values()],before=byId.size,windows=mergeWindows(rows),native=unique(rows.map(r=>r.canonical_id).filter(Boolean));
    const saved=unique(heads.filter(h=>requested.includes(h.event_id)||native.includes(h.event_id)||h.source_ids.some(id=>byId.has(id))).flatMap(h=>h.source_ids));
    const queryWindows=JSON.stringify(windows),ids=JSON.stringify([...byId.keys()]);
    absorb(await eventRows(db,scopes,`e.id NOT IN(SELECT value FROM json_each(?)) AND (e.id IN(SELECT value FROM json_each(?)) OR ce.canonical_id IN(SELECT value FROM json_each(?)) OR e.type='game' AND EXISTS(SELECT 1 FROM json_each(?) w WHERE (julianday(e.starts_at)-2440587.5)*86400000 BETWEEN json_extract(w.value,'$.from')-1 AND json_extract(w.value,'$.to')+1 OR (julianday(e.starts_at) IS NULL AND (e.local_day IS NULL OR e.local_day BETWEEN date(json_extract(w.value,'$.from')/1000,'unixepoch','-1 day') AND date(json_extract(w.value,'$.to')/1000,'unixepoch','+1 day')))))`,[ids,JSON.stringify(saved),JSON.stringify(native),queryWindows],limits,native));
    changed=byId.size!==before;iterations++;
  }
  const rows=[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id)),windows=mergeWindows(rows),events=rows.map(row=>eventDTO(row,scopes)),canonicalGroups=unique(rows.map(r=>r.canonical_id).filter(Boolean)).map(event_id=>({event_id,source_ids:rows.filter(r=>r.canonical_id===event_id).map(r=>r.id),established:true}));
  const missingCanonical=(await db.prepare(`SELECT ce.canonical_id FROM event_source_links l JOIN canonical_event_ids ce ON ce.input_id=l.event_id WHERE ce.canonical_id IN(SELECT value FROM json_each(?)) AND l.source_event_id NOT IN(SELECT value FROM json_each(?)) GROUP BY ce.canonical_id LIMIT ${limits.events+1}`).bind(JSON.stringify(canonicalGroups.map(g=>g.event_id)),JSON.stringify(rows.map(r=>r.id))).all()).results;
  if(missingCanonical.length){reasons.push('canonical_member_scope_unproven');for(const g of canonicalGroups)if(missingCanonical.some(r=>r.canonical_id===g.event_id))g.established=false;}
  if(rows.some(row=>parse(row.participants).some(p=>!side(p.side)||p.source_team_id!==row[p.side+'_source_team_id'])))reasons.push('candidate_participant_mismatch');
  if(events.some(e=>e.source_team_id===null))reasons.push('canonical_member_scope_unproven');
  if(events.some(e=>e.type==='game'&&teamGameInstant(e.starts_at)===null))reasons.push('candidate_instant_unproven');
  if(rows.some(r=>!r.canonical_id))reasons.push('candidate_canonical_unproven');
  if(requested.some(id=>!rows.some(r=>r.canonical_id===id||r.native_event_id===id)&&!heads.some(h=>h.event_id===id&&h.source_ids.some(s=>byId.has(s)))))reasons.push('requested_member_unavailable');
  for(const h of heads.filter(h=>requested.includes(h.event_id)||h.source_ids.some(id=>byId.has(id))))if(h.source_ids.some(id=>!byId.has(id)))reasons.push('accepted_member_unavailable');
  const after=await readScope(db,teamId,seasonId,limits,now),control=await controls(db,after,sourceScopes(after),limits);
  if(JSON.stringify(scope)!==JSON.stringify(after)||JSON.stringify(initialControl)!==JSON.stringify(control))reasons.push('acquisition_fence_changed');
  overflow ||= after.overflow||control.overflow;
  const connectionRevision=await hash({connections:scope.connections,aliases:scope.aliases}),sourceRevision=scope.context.source_revision;
  let coverage=[];
  if(windows.length*scopes.length>limits.coverageRows)overflow=true;
  else coverage=await coverageRows(scopes,initialControl,windows,sourceRevision,now);
  if(bytes(coverage)>limits.coverageBytes){overflow=true;coverage=[];}
  if(rows.some(row=>unique(scopes.filter(s=>s.provider===row.provider&&s.account_id===row.account_id&&parse(row.participants).some(p=>p.source_team_id===s.source_team_id)).map(s=>s.source_team_id)).length>1))reasons.push('own_identity_ambiguous');
  if(coverage.some(c=>!c.complete))reasons.push('source_neighborhood_incomplete');
  if(overflow)reasons.push('candidate_bound_exceeded');
  const connectionSnapshot={teamId,seasonId,revision:connectionRevision,connections:scope.connections,aliases:scope.aliases};
  const sourceSnapshot={teamId,seasonId,revision:sourceRevision,connection_revision:connectionRevision,complete:!overflow&&!reasons.length,overflow,windows:windows.map(w=>({from:iso(w.from),to:iso(w.to)})),coverage,events};
  const fence={teamId,seasonId,context:scope.context,scope:scope.raw,source_rows:rows.map(r=>({id:r.id,content_hash:r.content_hash,canonical_id:r.canonical_id,native_event_id:r.native_event_id,canonical_revision:r.canonical_revision})),jobs:initialControl.jobs,coverage:initialControl.coverage,subscribers:initialControl.subscribers,accepted_associations_hash:await hash(acceptedAssociations)};
  const semanticScope=s=>({...s,context:Object.fromEntries(Object.entries(s.context).filter(([k])=>!['source_revision','mutation_revision'].includes(k)))});
  return {connectionSnapshot,sourceSnapshot,canonicalGroups,rawRows:rows,requested_event_ids:requested,complete:sourceSnapshot.complete,overflow,reasons:unique(reasons),fence,fence_hash:await hash(fence),acquisitionControl:control,acquisitionScopeChanged:JSON.stringify(semanticScope(scope))!==JSON.stringify(semanticScope(after)),acquisitionClocksChanged:scope.context.source_revision!==after.context.source_revision||scope.context.mutation_revision!==after.context.mutation_revision,metrics:{rows:rows.length,bytes:bytes(rows),iterations}};
}
