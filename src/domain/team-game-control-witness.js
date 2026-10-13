/** Compact persisted witnesses, exact transient transaction authority.
 * SHA-256 is checked in JS; SQL still seals the complete just-read raw sets.
 * No control payload (especially raw args/checkpoint strings) is normalized. */
import {hash} from '../sources/common.js';
export const JOB_FIELDS=['id','provider','account_scope','account_id','authorization_generation','component','stage','scope','resource_key','args','checkpoint','scan_id','generation','state','coverage','last_complete_at','last_saved_at'];
export const COVERAGE_FIELDS=['id','provider','scope','account_id','kind','complete','record_count','scan_id','observed_at'];
export const SUBSCRIBER_FIELDS=['job_id','kind','app_team_id','demand_key','generation'];
export const CONTROL_COMPONENTS=['profile','catalog','history','event','division','bridge','resolve','upcoming','membership','league','organizer','categories','fixture','participant','events'];
export const COVERAGE_KINDS=['events','events_recent','history','catalog','profile','upcoming','membership'];
export const CONTROL_LIMITS=Object.freeze({rows:512,bytes:512000,receiptBytes:256000,receipts:512,subscribers:16384,parameterBytes:1000000,transactionBytes:2000000});
const fields={jobs:JOB_FIELDS,coverage:COVERAGE_FIELDS,subscribers:SUBSCRIBER_FIELDS};
const bytes=v=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length;
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const scalar=v=>v===null||typeof v==='string'||typeof v==='number'&&Number.isFinite(v);
const ordered=(rows,cols)=>rows.map(r=>cols.map(k=>r[k])).sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const balanced=parts=>parts.length===1?parts[0]:`(${balanced(parts.slice(0,Math.ceil(parts.length/2)))}) AND (${balanced(parts.slice(Math.ceil(parts.length/2)))})`;
const objectSQL=(alias,cols)=>`json_object(${cols.map(k=>`'${k}',${alias}.${k}`).join(',')})`;
const list=values=>values.map(v=>`'${v}'`).join(',');
export const jobEligible=`j.stage='source' AND j.provider IN('teamsnap','gotsport','live') AND j.component IN(${list(CONTROL_COMPONENTS)})`;
// Scope identity is deduplicated before joining team-wide controls. Page-local
// source universes and owner revisions never multiply job/subscriber scans.
const controlFields=['version','demands','coverage_scopes','control_witness','jobs','coverage'];
const controlProjection=r=>Object.fromEntries(controlFields.map(k=>[k,r[k]??null]));
const controlScopeCTEs=`control_receipts AS MATERIALIZED(SELECT DISTINCT app_team_id,json_object(${controlFields.map(k=>`'${k}',json_extract(fence,'$.${k}')`).join(',')}) fence FROM game_receipts),control_demands AS MATERIALIZED(SELECT DISTINCT p.app_team_id,json_extract(CASE WHEN demand.type='object' THEN demand.value ELSE '{}' END,'$.key') demand_key,json_extract(CASE WHEN demand.type='object' THEN demand.value ELSE '{}' END,'$.generation') generation FROM control_receipts p JOIN json_each(p.fence,'$.demands') demand),control_coverage_scopes AS MATERIALIZED(SELECT DISTINCT json_extract(CASE WHEN scope.type='object' THEN scope.value ELSE '{}' END,'$.provider') provider,json_extract(CASE WHEN scope.type='object' THEN scope.value ELSE '{}' END,'$.account_id') account_id,json_extract(CASE WHEN scope.type='object' THEN scope.value ELSE '{}' END,'$.scope') scope FROM control_receipts p JOIN json_each(p.fence,'$.coverage_scopes') scope),control_job_teams AS MATERIALIZED(SELECT DISTINCT j.id job_id,d.app_team_id FROM sync_jobs j JOIN sync_job_subscribers sub ON sub.job_id=j.id AND sub.kind='team' JOIN control_demands d ON d.app_team_id=sub.app_team_id AND d.demand_key=sub.demand_key AND d.generation=sub.generation WHERE ${jobEligible})`;
const currentJobScope=`j.id IN(SELECT job_id FROM control_job_teams)`;
const coverageScope=`v.kind IN(${list(COVERAGE_KINDS)}) AND EXISTS(SELECT 1 FROM control_coverage_scopes scope WHERE v.provider=scope.provider AND v.account_id IS scope.account_id AND v.scope=scope.scope)`;
const subscriberScope=`sub.kind='team' AND EXISTS(SELECT 1 FROM control_job_teams j WHERE sub.job_id=j.job_id AND sub.app_team_id=j.app_team_id)`;
export const gameReceiptsSQL=`SELECT DISTINCT app_team_id,fence_hash,fence FROM team_game_publications WHERE run_id=? AND disposition<>'state_hold'`;
function boundedEnvelope(sql,maxRows,maxBytes){return `(WITH candidate AS MATERIALIZED(${sql} LIMIT ${maxRows+1}),sized AS(SELECT row_json,length(CAST(row_json AS BLOB)) n,ROW_NUMBER() OVER() rn FROM candidate),counted AS(SELECT *,SUM(n) OVER(ORDER BY rn) total_bytes FROM sized) SELECT json_object('count',(SELECT COUNT(*) FROM candidate),'bytes',COALESCE((SELECT SUM(n) FROM sized),0),'rows',json(COALESCE((SELECT json_group_array(json(row_json)) FROM counted WHERE rn<=${maxRows} AND total_bytes<=${maxBytes}),'[]'))))`;}
// The caller supplies game_receipts. Every union is bounded before returning it.
export const controlSnapshotSQL=`,${controlScopeCTEs} SELECT json_object('receipts',json(${boundedEnvelope(`SELECT ${objectSQL('p',['app_team_id','fence'])} row_json FROM control_receipts p ORDER BY app_team_id,fence`,CONTROL_LIMITS.receipts,CONTROL_LIMITS.receiptBytes)}),'jobs',json(${boundedEnvelope(`SELECT ${objectSQL('j',JOB_FIELDS)} row_json FROM sync_jobs j WHERE ${currentJobScope} ORDER BY j.id`,CONTROL_LIMITS.rows,CONTROL_LIMITS.bytes)}),'coverage',json(${boundedEnvelope(`SELECT ${objectSQL('v',COVERAGE_FIELDS)} row_json FROM source_component_coverage v WHERE ${coverageScope} ORDER BY v.id`,CONTROL_LIMITS.rows,CONTROL_LIMITS.bytes)}),'subscribers',json(${boundedEnvelope(`SELECT ${objectSQL('sub',SUBSCRIBER_FIELDS)} row_json FROM sync_job_subscribers sub WHERE ${subscriberScope} ORDER BY sub.job_id,sub.kind,sub.app_team_id,sub.demand_key,sub.generation`,CONTROL_LIMITS.subscribers,CONTROL_LIMITS.bytes)}))`;
export function boundedControlRows(control){return Object.entries(fields).every(([kind,cols])=>Array.isArray(control[kind])&&control[kind].length<=(kind==='subscribers'?CONTROL_LIMITS.subscribers:CONTROL_LIMITS.rows)&&bytes(control[kind])<=CONTROL_LIMITS.bytes&&control[kind].every(r=>r&&cols.every(k=>Object.hasOwn(r,k)&&scalar(r[k])))&&new Set(ordered(control[kind],cols).map(JSON.stringify)).size===control[kind].length);}
export async function controlWitness(control){if(!boundedControlRows(control))return null;return {version:1,algorithm:'sha256',...Object.fromEntries(await Promise.all(Object.entries(fields).map(async([kind,cols])=>[kind,{count:control[kind].length,digest:await hash({version:1,kind,fields:cols,rows:ordered(control[kind],cols)})}])))};}
const validWitness=w=>w&&w.version===1&&w.algorithm==='sha256'&&Object.keys(fields).every(kind=>w[kind]&&Number.isSafeInteger(w[kind].count)&&w[kind].count>=0&&w[kind].count<=(kind==='subscribers'?CONTROL_LIMITS.subscribers:CONTROL_LIMITS.rows)&&typeof w[kind].digest==='string'&&/^[a-f0-9]{64}$/.test(w[kind].digest));
const arrayOf=(v,required)=>Array.isArray(v)&&v.every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&required.every(k=>Object.hasOwn(r,k)&&scalar(r[k])));
export function validReceiptShape(r){
 if(!r||![1,2].includes(r.version)||r.state_only!==undefined||!Number.isSafeInteger(r.source_revision)||!Number.isSafeInteger(r.mutation_revision)||!Object.hasOwn(r,'valid_until')||!(r.valid_until===null||Number.isFinite(r.valid_until))||!Object.hasOwn(r,'owner_revision')||!(r.owner_revision===null||Number.isSafeInteger(r.owner_revision)))return false;
 if(!arrayOf(r.source_universe,['id','hash','link_revision','canonical_id'])||!arrayOf(r.source_scopes,['provider','account_id','source_team_id'])||!arrayOf(r.windows,['from','to'])||!arrayOf(r.demands,['key','generation'])||!arrayOf(r.coverage_scopes,['provider','account_id','scope']))return false;
 return validControlReceiptShape(controlProjection(r));
}
function validControlReceiptShape(r){
 if(!r||![1,2].includes(r.version)||!arrayOf(r.demands,['key','generation'])||!arrayOf(r.coverage_scopes,['provider','account_id','scope']))return false;
 if(r.version===1)return arrayOf(r.jobs,JOB_FIELDS)&&arrayOf(r.coverage,COVERAGE_FIELDS)&&r.jobs.length<=512&&r.coverage.length<=512;
 return validWitness(r.control_witness)&&r.jobs===null&&r.coverage===null;
}
function scopedControls(control,p){
 const r=parse(p.fence),edges=control.subscribers.filter(e=>e.kind==='team'&&e.app_team_id===p.app_team_id),ids=new Set(edges.filter(e=>r.demands.some(d=>d.key===e.demand_key&&d.generation===e.generation)).map(e=>e.job_id));
 const jobs=control.jobs.filter(j=>ids.has(j.id)&&j.stage==='source'&&['teamsnap','gotsport','live'].includes(j.provider)&&CONTROL_COMPONENTS.includes(j.component)),jobIds=new Set(jobs.map(j=>j.id));
 return {jobs,coverage:control.coverage.filter(v=>COVERAGE_KINDS.includes(v.kind)&&r.coverage_scopes.some(s=>s.provider===v.provider&&s.account_id===v.account_id&&s.scope===v.scope)),subscribers:edges.filter(e=>jobIds.has(e.job_id))};
}
const snapshotPayload=s=>({receipts:s.receipts,jobs:s.jobs,coverage:s.coverage,subscribers:s.subscribers});
const capacityError=()=>Object.assign(new Error('Game controls exceed the bounded publication envelope.'),{code:'team_game_control_bound',status:409,failureKind:'permanent'});
export function assertControlTransactionBounds(statements,checkpoint){
 let total=bytes(JSON.stringify(checkpoint));
 for(const {params=[]}of statements){if(params.some(p=>typeof p==='string'&&bytes(p)>CONTROL_LIMITS.parameterBytes))throw capacityError();total+=bytes(params);}
 if(total>CONTROL_LIMITS.transactionBytes)throw capacityError();
}
export async function validateControlSnapshot(snapshot,teamId,runId){
 snapshot={...snapshot,teamId,runId,valid:false};
 if(!Array.isArray(snapshot.receipts)||snapshot.receipts.length>CONTROL_LIMITS.receipts||bytes(snapshot.receipts)>CONTROL_LIMITS.receiptBytes||!boundedControlRows(snapshot)||bytes(snapshotPayload(snapshot))>CONTROL_LIMITS.parameterBytes)return {...snapshot,overflow:true};
 for(const p of snapshot.receipts){let r;try{r=parse(p.fence);}catch{return snapshot;}
  if(p.app_team_id!==teamId||bytes(p.fence)>16000||!validControlReceiptShape(r))return snapshot;
  const control=scopedControls(snapshot,p);
  if(r.version===2){if(JSON.stringify(canonical(r.control_witness))!==JSON.stringify(canonical(await controlWitness(control))))return snapshot;}
  else if(JSON.stringify(ordered(r.jobs,JOB_FIELDS))!==JSON.stringify(ordered(control.jobs,JOB_FIELDS))||JSON.stringify(ordered(r.coverage,COVERAGE_FIELDS))!==JSON.stringify(ordered(control.coverage,COVERAGE_FIELDS)))return snapshot;
 }
 snapshot.valid=true;return snapshot;
}
export async function decodeControlSnapshot(raw,teamId,runId){
 let envelopes;try{envelopes=parse(raw);}catch{return {valid:false,teamId,runId};}
 const snapshot={};for(const kind of ['receipts',...Object.keys(fields)]){const e=envelopes?.[kind],maxRows=kind==='receipts'?CONTROL_LIMITS.receipts:kind==='subscribers'?CONTROL_LIMITS.subscribers:CONTROL_LIMITS.rows,maxBytes=kind==='receipts'?CONTROL_LIMITS.receiptBytes:CONTROL_LIMITS.bytes;if(!e||!Array.isArray(e.rows))return {valid:false,teamId,runId};if(e.count!==e.rows.length||e.count>maxRows||e.bytes>maxBytes)return {valid:false,overflow:true,teamId,runId};snapshot[kind]=e.rows;}
 return validateControlSnapshot(snapshot,teamId,runId);
}
export async function mergeControlSnapshot(before,publications,control,teamId,runId){
 if(!before?.valid||before.teamId!==teamId||before.runId!==runId)return {valid:false,teamId,runId};
 const receipts=[...before.receipts,...publications.filter(p=>p.disposition!=='state_hold').map(({app_team_id,fence})=>({app_team_id,fence:JSON.stringify(controlProjection(parse(fence)))}))];
 const next={receipts:[...new Map(receipts.map(p=>[JSON.stringify(p),p])).values()]};
 for(const [kind,cols]of Object.entries(fields)){const rows=publications.some(p=>p.disposition!=='state_hold')?[...before[kind],...control[kind]]:before[kind];next[kind]=[...new Map(rows.map(r=>[JSON.stringify(cols.map(k=>r[k])),Object.fromEntries(cols.map(k=>[k,r[k]]))])).values()];if(kind!=='subscribers'&&new Set(next[kind].map(r=>r.id)).size!==next[kind].length)return {valid:false,teamId,runId};}
 return validateControlSnapshot(next,teamId,runId);
}
const equalFields=(alias,ref,cols)=>balanced(cols.map(k=>`${alias}.${k} IS json_extract(${ref},'$.${k}')`));
export function controlSnapshotAssertion(snapshot,teamId,runId){
 if(!snapshot?.valid||snapshot.teamId!==teamId||snapshot.runId!==runId)return {sql:'0',params:[]};
 const raw=JSON.stringify(snapshotPayload(snapshot));
 if(bytes(raw)>CONTROL_LIMITS.parameterBytes)throw capacityError();
 const checks=[`(SELECT COUNT(*) FROM control_receipts)=json_array_length(json_extract(control_raw.value,'$.receipts'))`,`NOT EXISTS(SELECT 1 FROM control_receipts p WHERE NOT EXISTS(SELECT 1 FROM json_each(json_extract(control_raw.value,'$.receipts')) saved WHERE ${equalFields('p','saved.value',['app_team_id','fence'])}))`];
 for(const [kind,table,alias,scope]of [['jobs','sync_jobs','j',currentJobScope],['coverage','source_component_coverage','v',coverageScope],['subscribers','sync_job_subscribers','sub',subscriberScope]]){
  checks.push(`(SELECT COUNT(*) FROM ${table} ${alias} WHERE ${scope})=json_array_length(json_extract(control_raw.value,'$.${kind}'))`);
  checks.push(`NOT EXISTS(SELECT 1 FROM json_each(json_extract(control_raw.value,'$.${kind}')) saved WHERE NOT EXISTS(SELECT 1 FROM ${table} ${alias} WHERE ${equalFields(alias,'saved.value',fields[kind])} AND ${scope}))`);
 }
 return {sql:`(WITH ${controlScopeCTEs} SELECT ${balanced(checks)} FROM(SELECT ? value) control_raw)`,params:[raw]};
}
