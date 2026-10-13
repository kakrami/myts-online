/** Bounded team-local projection adapter. Native/global identities and owner rows
 * are inputs only. An unpublished decision is never retention authority. */
import {hash} from '../sources/common.js';
import {JOB_FIELDS,controlWitness,gameReceiptsSQL,controlSnapshotSQL,decodeControlSnapshot,mergeControlSnapshot,controlSnapshotAssertion} from './team-game-control-witness.js';
import {loadTeamGameCandidates} from './team-game-candidates.js';
import {resolveUserGameGroups,TEAM_GAME_ALGORITHM} from './team-game-resolver.js';
import {eventPresentation,localEventDay} from './presentation.js';
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const unique=v=>[...new Set(v)].sort();
const bytes=v=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length;
const fail=(message,code='team_game_projection_bound')=>Object.assign(new Error(message),{code,status:409,...(code==='team_game_control_bound'?{failureKind:'permanent'}:{})});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>hash(canonical(v));
const PUBLIC=new Set(['gotsport','live']);
export const TEAM_GAME_PROJECTION_LIMITS=Object.freeze({nativeRows:128,nativeBytes:1_000_000,heads:128,headBytes:256_000,stateRefs:256,proofBytes:16_000,page:24});
export function teamGameAssert(add,sql,...params){add(`INSERT INTO domain_team_preconditions(id,expected_input,actual_input) SELECT 1,1,CASE WHEN (${sql}) THEN 1 ELSE 0 END WHERE $FENCE ON CONFLICT(id) DO UPDATE SET expected_input=excluded.expected_input,actual_input=excluded.actual_input`,...params);}
function insert(add,table,rows){if(!rows.length)return;const cols=Object.keys(rows[0]);add(`INSERT INTO ${table}(${cols}) SELECT ${cols.map(c=>`json_extract(value,'$.${c}')`)} FROM json_each(?) WHERE $FENCE`,JSON.stringify(rows));}
const frameSQL=`SELECT d.source_revision,d.mutation_revision,t.timezone,s.start_day,s.end_day,p.input_revision,p.published_run_id,r.content_revision,
 (SELECT json_group_array(json_array(id,active,generation,input_revision,account_generation,member_active,excluded,member_generation,attachment_id,attachment_active,attachment_generation)) FROM(SELECT c.id,c.active,c.generation,c.input_revision,a.generation account_generation,m.active member_active,m.excluded,m.generation member_generation,x.id attachment_id,x.active attachment_active,x.generation attachment_generation FROM team_source_connections c LEFT JOIN provider_accounts a ON a.id=c.account_id LEFT JOIN team_connection_seasons m ON m.connection_id=c.id AND m.team_season_id=s.id LEFT JOIN team_source_attachments x ON x.id=m.attachment_id WHERE c.app_team_id=t.id ORDER BY c.id LIMIT 33)) roots,
 (SELECT json_group_array(json_array(id,source_team_id,account_id,active,generation,account_generation)) FROM(SELECT x.*,a.generation account_generation FROM team_source_attachments x LEFT JOIN provider_accounts a ON a.id=x.account_id WHERE x.app_team_id=t.id AND x.team_season_id=s.id AND NOT EXISTS(SELECT 1 FROM team_source_connections c WHERE c.app_team_id=t.id AND c.source_team_id=x.source_team_id) ORDER BY x.id LIMIT 33)) attachments
 FROM domain_installation d JOIN app_teams t ON t.id=? JOIN team_seasons s ON s.app_team_id=t.id AND s.id=? JOIN team_projection_state p ON p.app_team_id=t.id AND p.team_season_id=s.id JOIN team_read_state r ON r.app_team_id=t.id WHERE d.id=1`;
export async function teamGameBuildFrame(db,teamId,seasonId,runId=null,batch=null){
 if(!runId)return db.prepare(frameSQL).bind(teamId,seasonId).first();
 const check=publicationChecks(teamId,runId,batch,null,true),frame=await db.prepare(`SELECT frame.*,(${check.sql}) saved_valid,(WITH game_receipts AS MATERIALIZED(${gameReceiptsSQL}) ${controlSnapshotSQL}) control_snapshot FROM(${frameSQL}) frame`).bind(...check.params,runId,teamId,seasonId).first();
 const snapshot=await decodeControlSnapshot(frame.control_snapshot,teamId,runId);delete frame.control_snapshot;
 if(snapshot.overflow)throw fail('Saved game controls exceed the bounded publication envelope.','team_game_control_bound');
 Object.defineProperty(frame,'controlSnapshot',{value:snapshot});frame.saved_valid=frame.saved_valid===1&&snapshot.valid?1:0;return frame;
}
export function teamGameFrameAssertion(add,teamId,seasonId,frame){const keys=Object.keys(frame).filter(k=>k!=='saved_valid');teamGameAssert(add,`EXISTS(SELECT 1 FROM(${frameSQL}) actual WHERE ${keys.map(k=>`actual.${k} IS ?`).join(' AND ')})`,teamId,seasonId,...keys.map(k=>frame[k]));}
// Global counters fence each atomic acquisition, not the multi-page lifetime.
// Typed root input clocks include behind-cursor native/canonical/bridge changes.
// content_revision also includes independent match-analysis publications. Exact
// owner-state assertions and structural input_revision still fence owner edits.
const frameKeys=['timezone','start_day','end_day','input_revision','published_run_id','roots','attachments'];
export const sameTeamGameFrame=(a,b)=>frameKeys.every(k=>a[k]===b[k]);
// Checkpoints carry the semantic frame digest, never two copies of32 roots.
// Every commit still checks the exact newly acquired raw frame in SQL.
export const teamGameFrameIdentity=frame=>digest({version:1,...Object.fromEntries(frameKeys.map(k=>[k,frame[k]]))});

async function heads(db,teamId,ids){
  const columns=["app_team_id", "association_id", "identity_version", "private_account_id", "private_source_team_id", "private_source_event_id", "public_anchor_source_event_id", "origin_team_season_id", "target_event_id", "head_revision", "owner_revision", "accepted_revision", "created_at", "accepted_season_id", "starts_at", "local_day", "effective_day", "accepted_proof", "owner_decision", "owner_proof", "head_decision", "head_semantic_hash", "head_algorithm_version", "head_proof_hash"];
  const envelope=await db.prepare(`WITH candidates AS MATERIALIZED(SELECT a.*,d.team_season_id accepted_season_id,d.starts_at,d.local_day,d.effective_day,d.proof accepted_proof,o.decision owner_decision,o.proof owner_proof,h.decision head_decision,h.semantic_hash head_semantic_hash,h.algorithm_version head_algorithm_version,h.proof_hash head_proof_hash FROM team_game_associations a LEFT JOIN team_game_decision_revisions d ON d.app_team_id=a.app_team_id AND d.association_id=a.association_id AND d.revision=a.accepted_revision LEFT JOIN team_game_decision_revisions o ON o.app_team_id=a.app_team_id AND o.association_id=a.association_id AND o.revision=a.owner_revision LEFT JOIN team_game_decision_revisions h ON h.app_team_id=a.app_team_id AND h.association_id=a.association_id AND h.revision=a.head_revision WHERE a.app_team_id=? AND (a.target_event_id IN(SELECT value FROM json_each(?)) OR EXISTS(SELECT 1 FROM source_events member JOIN event_source_links ml ON ml.source_event_id=member.id JOIN canonical_event_ids mc ON mc.input_id=ml.event_id WHERE member.id IN(a.private_source_event_id,a.public_anchor_source_event_id) AND (mc.canonical_id IN(SELECT value FROM json_each(?)) OR EXISTS(SELECT 1 FROM source_events seed JOIN event_source_links sl ON sl.source_event_id=seed.id JOIN canonical_event_ids sc ON sc.input_id=sl.event_id WHERE sc.canonical_id IN(SELECT value FROM json_each(?)) AND ABS((julianday(seed.starts_at)-julianday(member.starts_at))*86400000)<=60001)))) ORDER BY a.association_id LIMIT 129),encoded AS(SELECT json_object(${columns.map(k=>`'${k}',${k}`).join(',')}) row_json FROM candidates),sized AS(SELECT row_json,SUM(length(CAST(row_json AS BLOB))) OVER(ORDER BY row_json) n FROM encoded) SELECT (SELECT COUNT(*) FROM candidates) count,COALESCE((SELECT json_group_array(json(row_json)) FROM sized WHERE n<=256000),'[]') rows`).bind(teamId,JSON.stringify(ids),JSON.stringify(ids),JSON.stringify(ids)).first();
  const rows=parse(envelope.rows);
  if(envelope.count!==rows.length)return {rows:[],accepted:[],owner:[],overflow:true};
  if(rows.length>128||bytes(rows)>256000)return {rows:[],accepted:[],owner:[],overflow:true};
  return {rows,accepted:rows.filter(r=>r.accepted_revision).map(r=>({type:'team_game_association',teamId,association_id:r.association_id,revision:r.accepted_revision,decision:'accepted',event_id:r.target_event_id,accepted_season_id:r.accepted_season_id,starts_at:r.starts_at,local_day:r.local_day,effective_day:r.effective_day,source_ids:parse(r.accepted_proof).source_ids,scope_refs:parse(r.accepted_proof).scope_refs})),owner:rows.filter(r=>r.owner_revision).map(r=>{const proof=parse(r.owner_proof);return {type:'pair',teamId,association_id:r.association_id,revision:r.owner_revision,decision:r.owner_decision,source_ids:proof.source_ids??[r.private_source_event_id,r.public_anchor_source_event_id],manual_policy:proof.manual_policy,owner_confirmation:proof.owner_confirmation,scope_refs:proof.scope_refs};})};
}

// Keys are exact original storage keys. Header revisions fence normal child
// writes; child keys additionally fence insertions/deletions. No owner payload
// is copied into a reference or a matcher proof.
const ownerStateBranches=`SELECT app_team_id,entity_id event_id,NULL season_id,'manual' kind,json_array(app_team_id,kind,entity_id) state_id,CAST(revision AS TEXT) revision FROM domain_overrides WHERE kind='event'
 UNION ALL SELECT app_team_id,event_id,team_season_id,'coach_session',json_array(app_team_id,team_season_id,event_id),CAST(revision AS TEXT) FROM coach_sessions
 UNION ALL SELECT c.app_team_id,c.event_id,c.team_season_id,'coach_player',json_array(c.app_team_id,c.team_season_id,c.event_id,c.player_id),CAST(h.revision AS TEXT) FROM coach_session_players c JOIN coach_sessions h USING(app_team_id,team_season_id,event_id)
 UNION ALL SELECT c.app_team_id,c.event_id,c.team_season_id,'coach_lineup',json_array(c.app_team_id,c.team_season_id,c.event_id,c.position),CAST(h.revision AS TEXT) FROM coach_lineup c JOIN coach_sessions h USING(app_team_id,team_season_id,event_id)
 UNION ALL SELECT c.app_team_id,c.event_id,c.team_season_id,'coach_stint',c.id,CAST(h.revision AS TEXT) FROM coach_stints c JOIN coach_sessions h USING(app_team_id,team_season_id,event_id)
 UNION ALL SELECT c.app_team_id,c.event_id,c.team_season_id,'coach_timeline',c.id,CAST(h.revision AS TEXT) FROM coach_timeline c JOIN coach_sessions h USING(app_team_id,team_season_id,event_id)
 UNION ALL SELECT app_team_id,event_id,team_season_id,'analysis_manual',json_array(app_team_id,team_season_id,kind,event_id,player_id),CAST(revision AS TEXT) FROM analysis_overrides WHERE event_id<>''
 UNION ALL SELECT app_team_id,event_id,team_season_id,'analysis_lineup',json_array(app_team_id,team_season_id,event_id),CAST(revision AS TEXT) FROM analysis_lineup_headers
 UNION ALL SELECT c.app_team_id,c.event_id,c.team_season_id,'analysis_position',json_array(c.app_team_id,c.team_season_id,c.event_id,c.half,c.player_id),CAST(h.revision AS TEXT) FROM analysis_lineup_assignments c JOIN analysis_lineup_headers h USING(app_team_id,team_season_id,event_id)
 UNION ALL SELECT a.app_team_id,l.event_id,a.team_season_id,'analysis_track',json_array(a.app_team_id,a.team_season_id,a.source_event_id,a.source_team_id,a.gid),CAST(a.revision AS TEXT) FROM analysis_track_assignments a JOIN event_source_links l ON l.source_event_id=a.source_event_id
 UNION ALL SELECT app_team_id,event_id,NULL,'bookmark',json_array(app_team_id,event_id),saved_at FROM game_bookmarks`.split('\n UNION ALL ');
// Workerd/D1 permits at most five terms per compound SELECT. Keep each
// materialized group and the outer union below that limit without extra reads.
const stateColumns='app_team_id,event_id,season_id,kind,state_id,revision';
export function teamGameOwnerStateSQL(scope){
  const filter=`EXISTS(SELECT 1 FROM owner_state_scope scope JOIN canonical_event_ids c ON c.canonical_id=scope.canonical_id WHERE scope.app_team_id=owned.app_team_id AND c.input_id=owned.event_id)`;
  return `WITH owner_state_scope AS MATERIALIZED(${scope}),${[0,1,2,3].map(i=>`owner_state_${i}(${stateColumns}) AS MATERIALIZED(SELECT * FROM(${ownerStateBranches.slice(i*3,i*3+3).join(' UNION ALL ')}) owned WHERE ${filter})`).join(',')} ${[0,1,2,3].map(i=>`SELECT * FROM owner_state_${i}`).join(' UNION ALL ')}`;
}
async function ownerState(db,teamId,roots){
  const envelope=await db.prepare(`WITH state AS(${teamGameOwnerStateSQL('SELECT ? app_team_id,value canonical_id FROM json_each(?)')}),candidate AS MATERIALIZED(SELECT state.*,c.canonical_id FROM state JOIN canonical_event_ids c ON c.input_id=state.event_id ORDER BY kind,state_id LIMIT 257),sized AS(SELECT *,SUM(length(CAST(state_id||revision AS BLOB))+200) OVER(ORDER BY kind,state_id) n FROM candidate) SELECT (SELECT COUNT(*) FROM candidate) count,COALESCE((SELECT json_group_array(json_object('app_team_id',app_team_id,'event_id',event_id,'canonical_id',canonical_id,'season_id',season_id,'kind',kind,'state_id',state_id,'revision',revision)) FROM sized WHERE n<=16000),'[]') rows`).bind(teamId,JSON.stringify(roots)).first();
  const rows=parse(envelope.rows),count={n:envelope.count};
  const refs=rows.map(r=>({teamId,seasonId:r.season_id,event_id:r.event_id,canonical_event_id:r.canonical_id,state_id:r.state_id,kind:r.kind,revision:r.revision}));
  const complete=rows.length===count.n&&rows.length<=256&&bytes(refs)<=16000;
  // Ambiguous original aliases never silently select a new state-bearing key.
  const manual=rows.map(r=>({...refs[rows.indexOf(r)],event_id:r.canonical_id,incompatible:r.event_id!==r.canonical_id}));
  return {refs:complete?refs:[],manual:complete?manual:[...manual,{teamId,event_id:roots[0],state_id:'overflow',kind:'state_limit',incompatible:true}],complete,roots,hash:await digest({complete,refs:complete?refs:[],roots})};
}

/** Exact native singleton authority, including Trace. Alias evidence may only
 * come from the candidate loader's current verified public bridge contract. */
async function nativeRows(db,teamId,seasonId,ids,aliases){
  const columns=["id", "provider", "scope", "account_id", "native_id", "competition_key", "division_key", "match_number", "starts_at", "local_day", "time_precision", "type", "status", "conditional", "home_source_team_id", "away_source_team_id", "home_label", "away_label", "home_score", "away_score", "title", "venue", "evidence", "provenance", "content_hash", "observed_at", "canonical_id", "native_event_id", "event_link_revision", "source_input_revision", "own_side", "participant_source_team_id", "connected_source_team_id", "attachment_id", "attachment_generation", "connection_id", "connection_generation", "connection_input_revision", "membership_generation", "account_generation", "entitlement_kind"];
  const envelope=await db.prepare(`WITH entitled AS(SELECT e.*,c.canonical_id,l.event_id native_event_id,l.revision event_link_revision,COALESCE(es.input_revision,0) source_input_revision,t.side own_side,t.source_team_id participant_source_team_id,a.source_team_id connected_source_team_id,a.id attachment_id,a.generation attachment_generation,r.id connection_id,r.generation connection_generation,r.input_revision connection_input_revision,m.generation membership_generation,pa.generation account_generation,CASE WHEN r.id IS NULL THEN 'legacy_attachment' ELSE 'root' END entitlement_kind,
  ROW_NUMBER() OVER(PARTITION BY e.id ORDER BY (a.source_team_id<>t.source_team_id),COALESCE(r.id,a.id),t.source_team_id) ordinal
  FROM source_events e JOIN event_source_links l ON l.source_event_id=e.id JOIN canonical_event_ids c ON c.input_id=l.event_id JOIN source_event_teams t ON t.source_event_id=e.id
  JOIN team_source_attachments a ON a.app_team_id=? AND a.team_season_id=? AND a.active=1 AND a.account_id IS e.account_id
  LEFT JOIN team_source_connections r ON r.app_team_id=a.app_team_id AND r.source_team_id=a.source_team_id LEFT JOIN team_connection_seasons m ON m.connection_id=r.id AND m.team_season_id=a.team_season_id
  LEFT JOIN provider_accounts pa ON pa.id=e.account_id LEFT JOIN source_event_state es ON es.source_event_id=e.id
  WHERE c.canonical_id IN(SELECT value FROM json_each(?)) AND ((e.provider IN('teamsnap','trace') AND e.scope=e.account_id AND pa.provider=e.provider) OR(e.provider IN('gotsport','live') AND e.scope='public' AND e.account_id IS NULL))
  AND(a.source_team_id=t.source_team_id OR(e.provider IN('gotsport','live') AND EXISTS(SELECT 1 FROM json_each(?) alias WHERE json_extract(alias.value,'$.source_team_id')=t.source_team_id AND json_extract(alias.value,'$.root_source_team_id')=a.source_team_id AND json_extract(alias.value,'$.connection_id') IS r.id AND (r.id IS NOT NULL OR json_extract(alias.value,'$.attachment_id')=a.id))))
  AND(r.id IS NULL OR(r.account_id IS e.account_id AND r.active=1 AND r.generation=a.generation AND m.active=1 AND m.excluded=0 AND m.generation=r.generation AND m.attachment_id=a.id))),
 candidate AS MATERIALIZED(SELECT * FROM entitled WHERE ordinal=1 ORDER BY id LIMIT 129),encoded AS(SELECT id,json_object(${columns.map(k=>`'${k}',${k}`).join(',')}) row_json FROM candidate),sized AS(SELECT *,SUM(length(CAST(row_json AS BLOB))) OVER(ORDER BY id) n FROM encoded) SELECT (SELECT COUNT(*) FROM candidate) count,COALESCE((SELECT json_group_array(json(row_json)) FROM sized WHERE n<=1000000),'[]') rows`).bind(teamId,seasonId,JSON.stringify(ids),JSON.stringify(aliases)).first();
  const rows=parse(envelope.rows);
  if(envelope.count>128||envelope.count!==rows.length)throw fail('A native game page exceeds the bounded source envelope.','team_game_native_bound');
  return rows;
}

const conjunction=parts=>parts.length===1?parts[0]:`(${conjunction(parts.slice(0,Math.ceil(parts.length/2)))}) AND (${conjunction(parts.slice(Math.ceil(parts.length/2)))})`;
function receiptPredicate(p='p'){
  const value=`json_extract(p.fence,'$.version') IN(1,2)
 AND NOT EXISTS(SELECT 1 FROM json_each(p.fence,'$.source_universe') captured WHERE NOT EXISTS(SELECT 1 FROM source_events e JOIN event_source_links l ON l.source_event_id=e.id JOIN canonical_event_ids c ON c.input_id=l.event_id WHERE e.id=json_extract(captured.value,'$.id') AND e.content_hash=json_extract(captured.value,'$.hash') AND l.revision=json_extract(captured.value,'$.link_revision') AND c.canonical_id=json_extract(captured.value,'$.canonical_id')))
 AND NOT EXISTS(SELECT 1 FROM source_events e JOIN source_event_teams own ON own.source_event_id=e.id JOIN json_each(p.fence,'$.source_scopes') scope ON e.provider=json_extract(scope.value,'$.provider') AND e.account_id IS json_extract(scope.value,'$.account_id') AND own.source_team_id=json_extract(scope.value,'$.source_team_id') WHERE e.type='game' AND NOT EXISTS(SELECT 1 FROM json_each(p.fence,'$.source_universe') captured WHERE e.id=json_extract(captured.value,'$.id')) AND EXISTS(SELECT 1 FROM json_each(p.fence,'$.windows') w WHERE julianday(e.starts_at) BETWEEN julianday(json_extract(w.value,'$.from'))-0.000000012 AND julianday(json_extract(w.value,'$.to'))+0.000000012 OR(julianday(e.starts_at) IS NULL AND(e.local_day IS NULL OR e.local_day BETWEEN date(json_extract(w.value,'$.from'),'-1 day') AND date(json_extract(w.value,'$.to'),'+1 day')))))
 AND NOT EXISTS(SELECT 1 FROM event_source_links l JOIN canonical_event_ids c ON c.input_id=l.event_id WHERE c.canonical_id IN(SELECT json_extract(value,'$.canonical_id') FROM json_each(p.fence,'$.source_universe')) AND NOT EXISTS(SELECT 1 FROM json_each(p.fence,'$.source_universe') captured WHERE l.source_event_id=json_extract(captured.value,'$.id')))
 AND (json_extract(p.fence,'$.valid_until') IS NULL OR julianday('now')*86400000-2440587.5*86400000<json_extract(p.fence,'$.valid_until'))`;
  const typed=(field,types)=>`json_type(member.value,'$.${field}') IN(${types.map(t=>`'${t}'`).join(',')})`;
  const arrayShape=(key,fields,extra=[])=>`json_type(p.fence,'$.${key}')='array' AND NOT EXISTS(SELECT 1 FROM json_each(p.fence,'$.${key}') member WHERE (CASE WHEN member.type='object' THEN ${conjunction([...Object.entries(fields).map(([k,v])=>typed(k,v)),...extra])} ELSE 0 END) IS NOT 1)`;
  const shape=conjunction([
   `length(CAST(p.fence AS BLOB))<=16000`, `json_type(p.fence,'$.version')='integer'`, `json_type(p.fence,'$.state_only') IS NULL`,
   ...['source_revision','mutation_revision'].map(k=>`json_type(p.fence,'$.${k}')='integer' AND json_extract(p.fence,'$.${k}') BETWEEN 0 AND 9007199254740991`),
   `json_type(p.fence,'$.owner_revision')='null' OR(json_type(p.fence,'$.owner_revision')='integer' AND json_extract(p.fence,'$.owner_revision') BETWEEN 1 AND 9007199254740991)`,
   `json_type(p.fence,'$.valid_until')='null' OR(json_type(p.fence,'$.valid_until') IN('integer','real') AND json_extract(p.fence,'$.valid_until') BETWEEN 0 AND 9007199254740991)`,
   `json_extract(p.fence,'$.version')<>2 OR(json_type(p.fence,'$.jobs') IS NULL AND json_type(p.fence,'$.coverage') IS NULL)`,
   arrayShape('source_universe',{id:['text'],hash:['text'],link_revision:['integer'],canonical_id:['text']},["json_extract(member.value,'$.link_revision')>0"]),
   arrayShape('source_scopes',{provider:['text'],account_id:['text','null'],source_team_id:['text']}),
   arrayShape('windows',{from:['text'],to:['text']},["julianday(json_extract(member.value,'$.from'))<=julianday(json_extract(member.value,'$.to'))"]),
   arrayShape('demands',{key:['text'],generation:['integer']},["json_extract(member.value,'$.generation')>0"]),
   arrayShape('coverage_scopes',{provider:['text'],account_id:['text','null'],scope:['text']})
  ].map(v=>`(${v})`));
  const balanced=`CASE WHEN ${shape} THEN ${conjunction(value.split('\n AND '))} ELSE 0 END`;
  return p==='p'?balanced:balanced.replaceAll('p.fence',`${p}.fence`).replaceAll('p.app_team_id',`${p}.app_team_id`);
}
async function receipt(candidate){
  const {fence,connectionSnapshot}=candidate;
  const scopes=connectionSnapshot.connections.flatMap(c=>[{provider:c.provider,account_id:c.account_id,scope:c.provider==='teamsnap'?'teamsnap:'+c.native_id:c.native_id},...connectionSnapshot.aliases.filter(a=>a.connection_id===(c.basis==='root'?c.id:null)&&a.attachment_id===(c.basis==='legacy_attachment'?c.id:null)).map(a=>({provider:a.provider,account_id:null,scope:a.native_id}))]);
  const expiration=fence.scope.links.map(l=>parse(l.evidence)).flatMap(p=>[Date.parse(p.expires_at),...(p.observations??[]).map(o=>Date.parse(o.at)+6*3600000)]).filter(Number.isFinite);
  return {version:2,control_witness:await controlWitness({jobs:fence.jobs.map(j=>Object.fromEntries(JOB_FIELDS.map(k=>[k,j[k]]))),coverage:fence.coverage,subscribers:fence.subscribers}),source_revision:fence.context.source_revision,mutation_revision:fence.context.mutation_revision,source_universe:candidate.rawRows.map(e=>({id:e.id,hash:e.content_hash,link_revision:e.canonical_revision,canonical_id:e.canonical_id})),source_scopes:connectionSnapshot.connections.flatMap(c=>[{provider:c.provider,account_id:c.account_id,source_team_id:c.source_team_id},...connectionSnapshot.aliases.filter(a=>a.connection_id===(c.basis==='root'?c.id:null)&&a.attachment_id===(c.basis==='legacy_attachment'?c.id:null)).map(a=>({provider:a.provider,account_id:null,source_team_id:a.source_team_id}))]),windows:candidate.sourceSnapshot.windows,demands:connectionSnapshot.connections.map(c=>({key:c.basis==='root'?'connection:'+c.id:c.id,generation:c.basis==='root'?c.generation:c.attachment_generation})),coverage_scopes:scopes,valid_until:expiration.length?Math.min(...expiration):null};
}
function semanticAssessment(p){const e=p.evidence??{};const {coverage,source_revision,connection_revision,source_content,...rest}=e;return {...p,own_sides:p.own_sides?.map(({account_generation,...side})=>side),evidence:{...rest,source_content:source_content?.map(({content_hash,...source})=>source),coverage:unique((coverage??[]).map(c=>JSON.stringify({connection_id:c.connection_id??null,attachment_id:c.attachment_id??null,attachment_generation:c.attachment_generation??null,provider:c.provider,source_team_id:c.source_team_id,generation:c.generation,complete:c.complete,from:c.from,to:c.to}))).map(parse)}};}

// Explicit owner identity confirmation does not choose which contradictory
// provider score/status is true. Normal event corrections resolve those values.
export function applyTeamGameOwnerValueConflicts(value,fields,assessments=[]){
  if(!value)return value;
  const conflicts=new Set(assessments.flatMap(p=>p.evidence?.owner_confirmation?.value_conflicts??[]));
  const scoreConflict=conflicts.has('authoritative_final_score_conflict'),statusConflict=conflicts.has('initial_game_status_conflict');
  if(!scoreConflict&&!statusConflict)return value;
  const scoresCorrected=Object.hasOwn(fields,'home_score')&&Object.hasOwn(fields,'away_score'),statusCorrected=Object.hasOwn(fields,'status');
  const unresolved=scoreConflict&&!scoresCorrected||statusConflict&&!statusCorrected;
  return {...value,result_conflict:unresolved?1:0,status:statusCorrected?fields.status:unresolved?'UNKNOWN':value.status,
    ...(!scoresCorrected?{home_score:null,away_score:null,goals_for:null,goals_against:null}:{})};
}

async function resolveNeighborhoods(input){
  const events=input.sourceSnapshot.events,byId=new Map(events.map(e=>[e.source_id,e])),parent=new Map(events.map(e=>[e.source_id,e.source_id]));
  const root=id=>{while(parent.get(id)!==id)id=parent.get(id);return id;};
  const join=(a,b)=>{if(parent.has(a)&&parent.has(b))parent.set(root(a),root(b));};
  for(const group of [...input.canonicalGroups,...input.acceptedAssociations])for(const id of group.source_ids)join(group.source_ids[0],id);
  for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++){const a=Date.parse(events[i].starts_at),b=Date.parse(events[j].starts_at);if(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=60000)join(events[i].source_id,events[j].source_id);}
  const components=new Map();for(const e of events){const key=root(e.source_id);if(!components.has(key))components.set(key,[]);components.get(key).push(e);}
  // A revoked durable group can have zero current sources; retain its state hold.
  if(!components.size)components.set('empty',[]);
  const results=[];
  for(const component of components.values()){
    const ids=new Set(component.map(e=>e.source_id)),windows=component.map(e=>Date.parse(e.starts_at)).filter(Number.isFinite).map(n=>({from:new Date(n-60000).toISOString(),to:new Date(n+60000).toISOString()}));
    results.push(await resolveUserGameGroups({...input,sourceSnapshot:{...input.sourceSnapshot,events:component,windows},canonicalGroups:input.canonicalGroups.filter(g=>g.source_ids.some(id=>ids.has(id))),acceptedAssociations:input.acceptedAssociations.filter(a=>a.source_ids.some(id=>ids.has(id))||!a.source_ids.some(id=>byId.has(id))),ownerDecisions:input.ownerDecisions.filter(a=>a.source_ids.some(id=>ids.has(id)))}));
  }
  return {...results[0],groups:results.flatMap(r=>r.groups),assessments:results.flatMap(r=>r.assessments),state_holds:[...new Map(results.flatMap(r=>r.state_holds).map(h=>[h.event_id,h])).values()],reasons:unique(results.flatMap(r=>r.reasons))};
}

export async function prepareTeamGameProjection(db,{team,season,runId,ids,maps,batch=null,holdMoves=false,frame=null}){
  frame??=await teamGameBuildFrame(db,team.id,season.id,runId,batch);
  const saved=await heads(db,team.id,ids),candidate=await loadTeamGameCandidates(db,{teamId:team.id,seasonId:season.id,canonicalEventIds:ids,acceptedAssociations:saved.accepted,limits:{closureQueries:2}});
  const allIds=unique([...ids,...candidate.canonicalGroups.map(g=>g.event_id)]),native=await nativeRows(db,team.id,season.id,allIds,candidate.connectionSnapshot.aliases),bySource=new Map(native.map(e=>[e.id,e]));
  const state=await ownerState(db,team.id,allIds),currentReceipt=await receipt(candidate);
  if(saved.overflow||!state.complete||!currentReceipt.control_witness||bytes(currentReceipt)>16000){candidate.sourceSnapshot.complete=false;candidate.sourceSnapshot.overflow=true;}
  if(ids.length>1&&(saved.overflow||!state.complete||!currentReceipt.control_witness||bytes(currentReceipt)>15000))return {smallerPage:true};
  const result=await resolveNeighborhoods({teamId:team.id,seasonId:season.id,timezone:team.timezone,...candidate,ownerDecisions:saved.owner,acceptedAssociations:saved.accepted,manualState:state.manual});
  if(!state.complete||!currentReceipt.control_witness||bytes(currentReceipt)>15000){
    for(const group of result.groups.filter(g=>g.inferred!==false))result.state_holds.push({teamId:team.id,seasonId:season.id,event_id:group.event_id,historical_source_ids:group.source_ids,decision:'review',reason:!state.complete?'owner_state_bound_exceeded':'publication_fence_bound_exceeded'});
    result.groups=result.groups.filter(g=>g.inferred===false);
  }
  for(const group of [...result.groups])if(group.inferred!==false&&native.some(e=>group.native_event_ids?.includes(e.canonical_id)&&!group.source_ids.includes(e.id))){result.groups.splice(result.groups.indexOf(group),1);result.state_holds.push({teamId:team.id,seasonId:season.id,event_id:group.event_id,historical_source_ids:group.source_ids,decision:'review',reason:'native_group_membership_changed'});}
  for(const group of result.groups.filter(g=>g.inferred===false))group.source_ids=unique(native.filter(e=>e.canonical_id===group.event_id).map(e=>e.id));
  const requestedSources=new Set(native.filter(e=>ids.includes(e.canonical_id)).map(e=>e.id));
  for(const a of saved.accepted.filter(a=>a.accepted_season_id===season.id&&ids.includes(a.event_id)))a.source_ids.forEach(id=>requestedSources.add(id));
  let groups=result.groups.filter(g=>g.source_ids.some(id=>requestedSources.has(id)));
  // Native singleton and native Trace sets are still projected when inference is
  // incomplete. Source membership always comes from exact current entitlement.
  const represented=new Set(groups.flatMap(g=>g.source_ids));
  for(const id of ids){const sourceIds=native.filter(e=>e.canonical_id===id&&!represented.has(e.id)).map(e=>e.id);if(sourceIds.length)groups.push({event_id:id,source_ids:sourceIds,decision:'pending',inferred:false,assessments:[]});}
  const support=await db.prepare(`SELECT
    (SELECT json_group_array(json_object('entity_id',entity_id,'fields',fields)) FROM domain_overrides WHERE app_team_id=? AND kind='event' AND entity_id IN(SELECT value FROM json_each(?))) corrections,
    (SELECT json_group_array(json_object('event_id',event_id,'starts_at',starts_at,'effective_day',effective_day,'state',state)) FROM team_event_season_resolutions WHERE app_team_id=? AND team_season_id=? AND event_id IN(SELECT value FROM json_each(?))) memberships,
    (SELECT json_group_array(json_object('source_event_id',source_event_id,'target_event_id',target_event_id)) FROM team_game_source_rows WHERE run_id=? AND source_event_id IN(SELECT value FROM json_each(?))) existing,
    (SELECT json_group_array(association_id) FROM team_game_publications WHERE run_id=?) publications,
    (SELECT json_group_array(json_array(source_competition_id,competition_id)) FROM competition_source_links WHERE source_competition_id IN(SELECT value FROM json_each(?))) competitions,
    (SELECT json_group_array(json_array(source_division_id,division_id)) FROM division_source_links WHERE source_division_id IN(SELECT value FROM json_each(?))) divisions`).bind(team.id,JSON.stringify(unique(groups.map(g=>g.event_id))),team.id,season.id,JSON.stringify(allIds),runId,JSON.stringify(unique(groups.flatMap(g=>g.source_ids))),runId,JSON.stringify(unique(native.map(e=>e.competition_key).filter(Boolean))),JSON.stringify(unique(native.map(e=>e.division_key).filter(Boolean)))).first();
  const corrections=parse(support.corrections),memberships=parse(support.memberships),existing=parse(support.existing),existingPublications=new Set(parse(support.publications));
  maps??={competitionIds:new Map(parse(support.competitions)),divisionIds:new Map(parse(support.divisions))};
  const output={rows:[],members:[],associations:[],revisions:[],headUpdates:[],publications:[],state,receipt:currentReceipt,saved,diagnostics:unique([...candidate.reasons,...result.reasons]),moves:[],deferredMoves:false};
  for(const group of groups){
    const sources=group.source_ids.map(id=>bySource.get(id)).filter(Boolean);if(!sources.length)continue;
    const matches=existing.filter(e=>group.source_ids.includes(e.source_event_id));
    if(matches.length){if(matches.length!==group.source_ids.length||matches.some(e=>e.target_event_id!==group.event_id))throw fail('Game membership changed behind the projection cursor.','team_game_projection_changed');continue;}
    if(sources.length!==group.source_ids.length&&group.inferred!==false)throw fail('An inferred group lost a native source.','team_game_projection_changed');
    const durable=saved.accepted.find(a=>a.event_id===group.event_id&&a.source_ids.some(id=>group.source_ids.includes(id)));
    // Cross-season moves require the typed two-run coordinator. No independent
    // pointer is allowed to silently publish an accepted member in two seasons.
    const ownedMove=durable&&batch?.association_id===durable.association_id;
    if(ownedMove&&season.id===batch.from_team_season_id)continue;
    if(ownedMove&&(!state.complete||state.refs.some(r=>sources.some(e=>e.canonical_id===(r.canonical_event_id??r.event_id))&&r.seasonId!==null)))throw fail('Season-qualified owner state requires explicit resolution before moving.','team_game_batch_changed');
    if(durable&&durable.accepted_season_id!==season.id&&!ownedMove){output.deferredMoves=true;continue;}
    const publicSources=sources.filter(e=>PUBLIC.has(e.provider)),privateSources=sources.filter(e=>e.provider==='teamsnap');
    const inferred=group.inferred!==false&&privateSources.length===1&&publicSources.length>0;
    const membership=memberships.find(m=>m.event_id===group.event_id),ownerFields=parse(corrections.find(r=>r.entity_id===group.event_id)?.fields??'{}');
    const fields={...(membership&&!inferred?{starts_at:membership.starts_at,local_day:membership.effective_day}:{}),...(group.placement?{starts_at:group.placement.starts_at,local_day:group.placement.effective_day}:{}),...ownerFields};
    // Native membership chooses season; it cannot silently replace an inferred
    // group's selected public schedule. Explicit owner dates keep precedence.
    if('local_day'in ownerFields&&!('starts_at'in ownerFields))delete fields.starts_at;
    const nativeBase=candidate.canonicalGroups.find(base=>base.event_id===group.event_id);
    // Inference completeness is not native singleton identity. Keep actual
    // multi-member and hidden canonical scope ambiguity under review.
    const ordinarySingleton=group.inferred===false&&sources.length===1&&(!nativeBase||nativeBase.source_ids.length===1&&nativeBase.established!==false);
    const identityConflict=!ordinarySingleton&&(group.decision==='review'||group.decision==='pending')||nativeBase?.established===false||membership?.state==='conflict';
    let value=eventPresentation(team,season,group.event_id,sources,fields,maps.competitionIds,maps.divisionIds,identityConflict);
    value=applyTeamGameOwnerValueConflicts(value,fields,group.assessments);
    if(!value&&durable){
      const primary=sources.find(e=>PUBLIC.has(e.provider))??sources[0],desiredDay=localEventDay(team,fields.starts_at??primary.starts_at,fields.local_day??primary.local_day);
      const roots=unique(sources.map(e=>e.canonical_id)),refs=state.refs.filter(r=>roots.includes(r.canonical_event_id??r.event_id));
      const heldRecord=Array.isArray(holdMoves)?holdMoves.find(h=>(typeof h==='string'?h:h.association_id)===durable.association_id):null,heldMove=holdMoves===true||!!heldRecord;
      const mayMove=group.decision==='accepted'&&state.complete&&!refs.some(r=>r.seasonId!==null)&&JSON.stringify(unique(group.source_ids))===JSON.stringify(unique(durable.source_ids));
      if(mayMove&&!heldMove&&!batch){output.moves.push({association_id:durable.association_id,accepted_revision:durable.revision,target_event_id:durable.event_id,source_ids:group.source_ids,scope_refs:sources.map(e=>({source_id:e.id,source_team_id:e.connected_source_team_id,account_id:e.account_id,connection_id:e.connection_id})),desired_day:desiredDay,owner_state_hash:state.hash});continue;}
      if(ownedMove)throw fail('The moving game no longer has accepted destination evidence.','team_game_batch_changed');
      output.deferredMoves ||= mayMove&&!heldMove;group.decision='review';group.placement_review=!state.complete?'owner_state_bound_exceeded':refs.some(r=>r.seasonId!==null)?'season_owner_state_requires_review':heldRecord?.reason??'two_season_publication_required';
      Object.assign(fields,{starts_at:durable.starts_at,local_day:durable.effective_day});
      value=applyTeamGameOwnerValueConflicts(eventPresentation(team,season,group.event_id,sources,fields,maps.competitionIds,maps.divisionIds,true),fields,group.assessments);
    }
    if(!value)continue;
    // A date-only owner correction has no invented kickoff. Keep the inferred
    // identity visible, but do not pin an accepted durable placement without it.
    if(inferred&&group.decision==='accepted'&&value.starts_at===null)group.decision='review';
    let association=null;
    if(inferred){
      if(!state.complete||bytes(currentReceipt)>16000)throw fail('A retained group needs a complete bounded state and publication fence.');
      const ts=privateSources[0],publicAnchor=publicSources.map(e=>e.id).sort()[0];
      association=saved.rows.find(a=>a.private_source_event_id===ts.id&&group.source_ids.includes(a.public_anchor_source_event_id));
      const associationId=association?.association_id??'tg:'+await digest([team.id,ts.account_id,ts.connected_source_team_id,ts.id,publicAnchor]);
      if(association?.target_event_id&&association.target_event_id!==group.event_id)throw fail('A saved association cannot change its state target.','team_game_target_changed');
      const scopeRefs=sources.map(e=>({source_id:e.id,connection_id:e.connection_id,account_id:e.account_id,source_team_id:e.connected_source_team_id,entitlement_kind:e.entitlement_kind,attachment_id:e.entitlement_kind==='legacy_attachment'?e.attachment_id:null,attachment_generation:e.entitlement_kind==='legacy_attachment'?e.attachment_generation:null})).sort((a,b)=>a.source_id.localeCompare(b.source_id));
      const roots=unique(sources.map(e=>e.canonical_id)),refs=state.refs.filter(r=>roots.includes(r.canonical_event_id??r.event_id)),assessment=group.assessments.filter(p=>p.source_ids.every(id=>group.source_ids.includes(id)));
      const proof={version:1,algorithm:TEAM_GAME_ALGORITHM,...(group.placement_review?{placement_review:group.placement_review}:value.starts_at===null?{placement_review:'owner_date_without_instant'}:{}),source_ids:group.source_ids,scope_refs:scopeRefs,reasons:unique([...assessment.flatMap(p=>p.reasons),...(group.placement_review?[group.placement_review]:[])]),assessments:assessment,state_refs:refs};
      if(bytes(proof)>16000)throw fail('A game proof exceeds its bounded representation.');
      const semanticHash=await digest({...proof,assessments:assessment.map(semanticAssessment),placement:{starts_at:value.starts_at,local_day:value.local_day},decision:group.decision});
      const reuse=association?.head_decision===group.decision&&association.head_semantic_hash===semanticHash&&association.head_algorithm_version===TEAM_GAME_ALGORITHM;
      const revision=reuse?association.head_revision:(association?.head_revision??0)+1,proofHash=reuse?association.head_proof_hash:await digest(proof);
      if(!association)output.associations.push({app_team_id:team.id,association_id:associationId,identity_version:1,private_account_id:ts.account_id,private_source_team_id:ts.connected_source_team_id,private_source_event_id:ts.id,public_anchor_source_event_id:publicAnchor,origin_team_season_id:season.id,target_event_id:group.event_id,head_revision:0,owner_revision:null,accepted_revision:null,created_at:new Date().toISOString()});
      if(!reuse){output.revisions.push({app_team_id:team.id,association_id:associationId,revision,record_version:1,authority:'matcher',decision:group.decision,team_season_id:season.id,effective_day:value.local_day,starts_at:value.starts_at,local_day:value.local_day,algorithm_version:TEAM_GAME_ALGORITHM,request_id:null,request_hash:null,predecessor_revision:association?.head_revision||null,source_snapshot_revision:candidate.sourceSnapshot.revision,connection_snapshot_hash:result.fence.connection_snapshot_hash,owner_state_hash:await digest({complete:state.complete,refs,roots}),semantic_hash:semanticHash,proof_hash:proofHash,proof:JSON.stringify(proof),created_at:new Date().toISOString()});output.headUpdates.push({association_id:associationId,before:association?.head_revision??0,after:revision,owner_revision:association?.owner_revision??null,accepted_revision:association?.accepted_revision??null,target_event_id:group.event_id});}
      output.publications.push({run_id:runId,app_team_id:team.id,team_season_id:season.id,association_id:associationId,decision_revision:revision,target_event_id:group.event_id,publication_version:1,disposition:group.decision,membership_hash:await digest(group.source_ids),semantic_hash:semanticHash,proof_hash:proofHash,state_refs_complete:1,state_scope_roots:JSON.stringify(roots),fence_hash:await digest({...currentReceipt,owner_revision:association?.owner_revision??null}),fence:JSON.stringify({...currentReceipt,owner_revision:association?.owner_revision??null}),state_refs:JSON.stringify(refs),publish_batch_id:ownedMove?batch.batch_id:null});
      association={association_id:associationId};
    }
    output.rows.push({run_id:runId,...value,source_ids:JSON.stringify(sources.map(e=>e.id).sort())});
    for(const e of sources)output.members.push({run_id:runId,app_team_id:team.id,team_season_id:season.id,target_event_id:group.event_id,source_event_id:e.id,association_id:association?.association_id??null,original_event_id:e.native_event_id,provider:e.provider,account_id:e.account_id,account_generation:e.account_generation,entitlement_kind:e.entitlement_kind,connection_id:e.connection_id,connection_generation:e.connection_generation,connection_input_revision:e.connection_input_revision,membership_generation:e.membership_generation,attachment_id:e.attachment_id,attachment_generation:e.attachment_generation,connected_source_team_id:e.connected_source_team_id,participant_source_team_id:e.participant_source_team_id,source_hash:e.content_hash,source_input_revision:e.source_input_revision,event_link_revision:e.event_link_revision,own_proof_hash:await digest({source_id:e.id,connection_id:e.connection_id,attachment_id:e.attachment_id,participant:e.participant_source_team_id,alias:candidate.connectionSnapshot.aliases.filter(a=>a.source_team_id===e.participant_source_team_id)})});
  }
  // Persist only a material reciprocal 1:1 assessment, never all Cartesian
  // misses. The native rows remain separate until accepted authority publishes.
  for(const assessment of result.assessments.filter(p=>['review','pending'].includes(p.decision)&&p.evidence?.reciprocal_candidate_counts?.teamsnap===1&&p.evidence?.reciprocal_candidate_counts?.public===1&&p.source_ids.some(id=>requestedSources.has(id)))){
    const sources=assessment.source_ids.map(id=>bySource.get(id)).filter(Boolean),ts=sources.find(e=>e.provider==='teamsnap'),pubs=sources.filter(e=>PUBLIC.has(e.provider));
    if(!ts||!pubs.length||sources.length!==assessment.source_ids.length)continue;
    const a=saved.rows.find(a=>a.private_source_event_id===ts.id&&assessment.source_ids.includes(a.public_anchor_source_event_id));
    if(a?.accepted_revision||a&&existingPublications.has(a.association_id)||output.publications.some(p=>p.association_id===a?.association_id))continue;
    const associationId=a?.association_id??'tg:'+await digest([team.id,ts.account_id,ts.connected_source_team_id,ts.id,pubs.map(e=>e.id).sort()[0]]),roots=unique(sources.map(e=>e.canonical_id));
    const refs=state.complete?state.refs.filter(r=>roots.includes(r.canonical_event_id??r.event_id)):[],scopeRefs=sources.map(e=>({source_id:e.id,connection_id:e.connection_id,account_id:e.account_id,source_team_id:e.connected_source_team_id,entitlement_kind:e.entitlement_kind,attachment_id:e.entitlement_kind==='legacy_attachment'?e.attachment_id:null,attachment_generation:e.entitlement_kind==='legacy_attachment'?e.attachment_generation:null}));
    let proof={version:1,algorithm:TEAM_GAME_ALGORITHM,source_ids:assessment.source_ids,scope_refs:scopeRefs,assessments:[assessment],state_refs:refs,state_refs_complete:state.complete};
    if(bytes(proof)>16000)proof={version:1,algorithm:TEAM_GAME_ALGORITHM,source_ids:assessment.source_ids,scope_refs:scopeRefs,reasons:['proof_bound_exceeded'],state_refs_complete:state.complete};
    const semanticHash=await digest({...proof,...(proof.assessments?{assessments:[semanticAssessment(assessment)]}:{})}),reuse=a?.head_decision===assessment.decision&&a.head_semantic_hash===semanticHash&&a.head_algorithm_version===TEAM_GAME_ALGORITHM,revision=reuse?a.head_revision:(a?.head_revision??0)+1,proofHash=reuse?a.head_proof_hash:await digest(proof);
    if(!a)output.associations.push({app_team_id:team.id,association_id:associationId,identity_version:1,private_account_id:ts.account_id,private_source_team_id:ts.connected_source_team_id,private_source_event_id:ts.id,public_anchor_source_event_id:pubs.map(e=>e.id).sort()[0],origin_team_season_id:season.id,target_event_id:null,head_revision:0,owner_revision:null,accepted_revision:null,created_at:new Date().toISOString()});
    if(!reuse){output.revisions.push({app_team_id:team.id,association_id:associationId,revision,record_version:1,authority:'matcher',decision:assessment.decision,team_season_id:season.id,effective_day:null,starts_at:null,local_day:null,algorithm_version:TEAM_GAME_ALGORITHM,request_id:null,request_hash:null,predecessor_revision:a?.head_revision||null,source_snapshot_revision:candidate.sourceSnapshot.revision,connection_snapshot_hash:result.fence.connection_snapshot_hash,owner_state_hash:await digest({complete:state.complete,refs,roots}),semantic_hash:semanticHash,proof_hash:proofHash,proof:JSON.stringify(proof),created_at:new Date().toISOString()});output.headUpdates.push({association_id:associationId,before:a?.head_revision??0,after:revision,owner_revision:a?.owner_revision??null,accepted_revision:a?.accepted_revision??null,target_event_id:null});}
    const hold=!state.complete||!currentReceipt.control_witness||bytes(currentReceipt)>15000||!output.rows.some(r=>r.event_id===ts.canonical_id),fence=hold?{version:1,state_only:true,owner_revision:a?.owner_revision??null}:{...currentReceipt,owner_revision:a?.owner_revision??null};
    output.publications.push({run_id:runId,app_team_id:team.id,team_season_id:season.id,association_id:associationId,decision_revision:revision,target_event_id:ts.canonical_id,publication_version:1,disposition:hold?'state_hold':assessment.decision,membership_hash:await digest([]),semantic_hash:semanticHash,proof_hash:proofHash,state_refs_complete:state.complete?1:0,state_scope_roots:JSON.stringify(roots),fence_hash:await digest(fence),fence:JSON.stringify(fence),state_refs:JSON.stringify(refs),publish_batch_id:null});
  }
  for(const hold of result.state_holds){
    const a=saved.rows.find(a=>a.target_event_id===hold.event_id&&a.accepted_revision);
    if(!a||batch?.association_id===a.association_id||a.accepted_season_id!==season.id||!ids.includes(a.target_event_id)&&!hold.historical_source_ids.some(id=>requestedSources.has(id))||existingPublications.has(a.association_id)||output.publications.some(p=>p.association_id===a.association_id))continue;
    const roots=unique([a.target_event_id,...candidate.canonicalGroups.filter(g=>g.source_ids.some(id=>hold.historical_source_ids.includes(id))).map(g=>g.event_id)]);
    const refs=state.complete?state.refs.filter(r=>roots.includes(r.canonical_event_id??r.event_id)):[];
    const proof={version:1,algorithm:TEAM_GAME_ALGORITHM,source_ids:hold.historical_source_ids,scope_refs:parse(a.accepted_proof).scope_refs,reasons:[hold.reason],state_refs:refs,state_refs_complete:state.complete};
    const semanticHash=await digest(proof),reuse=a.head_decision==='review'&&a.head_semantic_hash===semanticHash&&a.head_algorithm_version===TEAM_GAME_ALGORITHM;
    const revision=reuse?a.head_revision:a.head_revision+1,proofHash=reuse?a.head_proof_hash:await digest(proof);
    if(!reuse){output.revisions.push({app_team_id:team.id,association_id:a.association_id,revision,record_version:1,authority:'matcher',decision:'review',team_season_id:season.id,effective_day:a.effective_day,starts_at:a.starts_at,local_day:a.local_day,algorithm_version:TEAM_GAME_ALGORITHM,request_id:null,request_hash:null,predecessor_revision:a.head_revision,source_snapshot_revision:candidate.sourceSnapshot.revision,connection_snapshot_hash:result.fence.connection_snapshot_hash,owner_state_hash:await digest({complete:state.complete,refs,roots}),semantic_hash:semanticHash,proof_hash:proofHash,proof:JSON.stringify(proof),created_at:new Date().toISOString()});output.headUpdates.push({association_id:a.association_id,before:a.head_revision,after:revision,owner_revision:a.owner_revision,accepted_revision:a.accepted_revision,target_event_id:a.target_event_id});}
    // A state-only hold grants no source access, so it needs no provider receipt.
    const fence={version:1,state_only:true,owner_revision:a.owner_revision};
    output.publications.push({run_id:runId,app_team_id:team.id,team_season_id:season.id,association_id:a.association_id,decision_revision:revision,target_event_id:a.target_event_id,publication_version:1,disposition:'state_hold',membership_hash:await digest([]),semantic_hash:semanticHash,proof_hash:proofHash,state_refs_complete:state.complete?1:0,state_scope_roots:JSON.stringify(roots),fence_hash:await digest(fence),fence:JSON.stringify(fence),state_refs:JSON.stringify(refs),publish_batch_id:null});
  }
  output.controlSnapshot=await mergeControlSnapshot(frame.controlSnapshot,output.publications,{jobs:candidate.fence.jobs,coverage:candidate.fence.coverage,subscribers:candidate.fence.subscribers},team.id,runId);
  if(output.controlSnapshot.overflow)throw fail('Saved game controls exceed the bounded publication envelope.','team_game_control_bound');
  if(!output.controlSnapshot.valid)throw fail('Game controls changed during projection acquisition.','team_game_projection_changed');
  return output;
}

export function stageTeamGameProjection(add,page,teamId,runId,batch=null){
  insert(add,'team_game_associations',page.associations);
  if(page.headUpdates.length)teamGameAssert(add,`NOT EXISTS(SELECT 1 FROM json_each(?) h WHERE NOT EXISTS(SELECT 1 FROM team_game_associations a WHERE a.app_team_id=? AND a.association_id=json_extract(h.value,'$.association_id') AND a.head_revision=json_extract(h.value,'$.before') AND a.owner_revision IS json_extract(h.value,'$.owner_revision') AND a.accepted_revision IS json_extract(h.value,'$.accepted_revision')))`,JSON.stringify(page.headUpdates),teamId);
  insert(add,'team_game_decision_revisions',page.revisions);
  if(page.headUpdates.length)add(`UPDATE team_game_associations SET head_revision=(SELECT json_extract(value,'$.after') FROM json_each(?) WHERE json_extract(value,'$.association_id')=association_id),target_event_id=COALESCE(target_event_id,(SELECT json_extract(value,'$.target_event_id') FROM json_each(?) WHERE json_extract(value,'$.association_id')=association_id)) WHERE app_team_id=? AND association_id IN(SELECT json_extract(value,'$.association_id') FROM json_each(?)) AND $FENCE`,JSON.stringify(page.headUpdates),JSON.stringify(page.headUpdates),teamId,JSON.stringify(page.headUpdates));
  insert(add,'team_event_rows',page.rows);insert(add,'team_game_publications',page.publications);insert(add,'team_game_source_rows',page.members);
  // New Coach/manual state or a receipt change between acquisition and stage
  // rolls the whole page back, including allocated decision heads.
  addTeamGamePublicationAssertions(add,teamId,runId,batch,page.controlSnapshot);
}

function publicationChecks(teamId,runId,batch=null,snapshot=null,acquire=false){
  const checks=[],assert=(ignored,sql,...params)=>checks.push({sql,params});
  assert(null,`NOT EXISTS(SELECT 1 FROM team_event_rows e WHERE e.run_id=? AND (json_array_length(e.source_ids)=0 OR e.source_ids IS NOT(SELECT json_group_array(source_event_id) FROM(SELECT source_event_id FROM team_game_source_rows m WHERE m.run_id=e.run_id AND m.app_team_id=e.app_team_id AND m.team_season_id=e.team_season_id AND m.target_event_id=e.event_id ORDER BY source_event_id))))`,runId);
  assert(null,`NOT EXISTS(SELECT 1 FROM team_game_source_rows m LEFT JOIN source_events e ON e.id=m.source_event_id LEFT JOIN event_source_links l ON l.source_event_id=m.source_event_id LEFT JOIN team_source_connections c ON c.id=m.connection_id LEFT JOIN team_connection_seasons cm ON cm.connection_id=c.id AND cm.team_season_id=m.team_season_id LEFT JOIN team_source_attachments a ON a.id=m.attachment_id LEFT JOIN provider_accounts pa ON pa.id=m.account_id WHERE m.run_id=? AND (e.id IS NULL OR e.content_hash IS NOT m.source_hash OR e.account_id IS NOT m.account_id OR l.revision IS NOT m.event_link_revision OR(m.account_id IS NOT NULL AND pa.generation IS NOT m.account_generation) OR NOT EXISTS(SELECT 1 FROM source_event_teams own WHERE own.source_event_id=m.source_event_id AND own.source_team_id=m.participant_source_team_id) OR(m.participant_source_team_id<>m.connected_source_team_id AND NOT EXISTS(SELECT 1 FROM source_team_links b WHERE b.kind='provider_external_key' AND ((b.a=m.connected_source_team_id AND b.b=m.participant_source_team_id) OR(b.b=m.connected_source_team_id AND b.a=m.participant_source_team_id)) AND julianday(json_extract(b.evidence,'$.expires_at'))>julianday('now') AND NOT EXISTS(SELECT 1 FROM json_each(json_extract(b.evidence,'$.observations')) observation WHERE julianday(json_extract(observation.value,'$.at'))<julianday('now','-6 hours')))) OR a.active IS NOT 1 OR a.generation IS NOT m.attachment_generation OR(m.entitlement_kind='root' AND(c.active IS NOT 1 OR c.generation IS NOT m.connection_generation OR c.input_revision IS NOT m.connection_input_revision OR cm.active IS NOT 1 OR cm.excluded IS NOT 0 OR cm.generation IS NOT m.membership_generation)) OR(m.entitlement_kind='legacy_attachment' AND EXISTS(SELECT 1 FROM team_source_connections c WHERE c.app_team_id=m.app_team_id AND c.source_team_id=m.connected_source_team_id))))`,runId);
  // A page records one exact acquisition on each association. Validate that
  // receipt once, but retain per-association owner CAS. Raw JSON joins its hash
  // in the dedup key, so a changed receipt cannot hide behind a peer. Only the
  // distinct control projection crosses into JS; the full stored hash is not
  // authority and every non-control field is checked directly here in SQL.
  assert(null,`NOT EXISTS(SELECT 1 FROM team_game_publications p JOIN team_game_associations a ON a.app_team_id=p.app_team_id AND a.association_id=p.association_id WHERE p.run_id=? AND a.owner_revision IS NOT json_extract(p.fence,'$.owner_revision')) AND NOT EXISTS(SELECT 1 FROM game_receipts p WHERE (${receiptPredicate()}) IS NOT 1)`,runId);
  assert(null,`NOT EXISTS(WITH current_state AS MATERIALIZED(${teamGameOwnerStateSQL("SELECT p.app_team_id,roots.value canonical_id FROM team_game_publications p JOIN json_each(p.state_scope_roots) roots WHERE p.run_id=? AND p.state_refs_complete=1")}) SELECT 1 FROM team_game_publications p WHERE p.run_id=? AND p.state_refs_complete=1 AND ((SELECT COUNT(*) FROM current_state s JOIN canonical_event_ids c ON c.input_id=s.event_id WHERE s.app_team_id=p.app_team_id AND c.canonical_id IN(SELECT value FROM json_each(p.state_scope_roots)))<>json_array_length(p.state_refs) OR EXISTS(SELECT 1 FROM json_each(p.state_refs) saved WHERE NOT EXISTS(SELECT 1 FROM current_state s WHERE s.app_team_id=p.app_team_id AND s.event_id=json_extract(saved.value,'$.event_id') AND s.season_id IS json_extract(saved.value,'$.seasonId') AND s.kind=json_extract(saved.value,'$.kind') AND s.state_id=json_extract(saved.value,'$.state_id') AND s.revision IS json_extract(saved.value,'$.revision')))))`,runId,runId);
  assert(null,`NOT EXISTS(SELECT 1 FROM team_game_publications p JOIN team_game_publications other ON other.app_team_id=p.app_team_id AND other.association_id=p.association_id AND other.team_season_id<>p.team_season_id JOIN team_projection_state s ON s.published_run_id=other.run_id WHERE p.run_id=? AND p.disposition='accepted' AND other.disposition IN('accepted','review','pending')${batch?' AND NOT(p.publish_batch_id=? AND p.association_id=? AND other.run_id IS ?)':''}) AND NOT EXISTS(SELECT 1 FROM team_game_publish_batches b WHERE b.app_team_id=? AND b.state IN('preparing','ready') AND EXISTS(SELECT 1 FROM team_projection_runs r WHERE r.id=? AND r.team_season_id IN(b.from_team_season_id,b.to_team_season_id))${batch?' AND NOT(b.batch_id=? AND b.generation=? AND ? IN(b.from_build_run_id,b.to_build_run_id))':''})`,runId,...(batch?[batch.batch_id,batch.association_id,batch.from_expected_run_id]:[]),teamId,runId,...(batch?[batch.batch_id,batch.generation,runId]:[]));
  if(!acquire){const controls=controlSnapshotAssertion(snapshot,teamId,runId);assert(null,controls.sql,...controls.params);}
  return {sql:`(WITH game_receipts AS MATERIALIZED(${gameReceiptsSQL}),${checks.map((c,i)=>`game_check_${i} AS MATERIALIZED(SELECT (${c.sql}) valid)`).join(',')} SELECT ${checks.map((_,i)=>`game_check_${i}.valid`).join(' AND ')} FROM ${checks.map((_,i)=>`game_check_${i}`).join(' CROSS JOIN ')})`,params:[runId,...checks.flatMap(c=>c.params)]};
}
export function addTeamGamePublicationAssertions(add,teamId,runId,batch=null,snapshot=null){const check=publicationChecks(teamId,runId,batch,snapshot);teamGameAssert(add,check.sql,...check.params);}
export async function teamGamePublicationCurrent(db,teamId,runId){const check=publicationChecks(teamId,runId,null,null,true),row=await db.prepare(`SELECT ${check.sql} AS current,(WITH game_receipts AS MATERIALIZED(${gameReceiptsSQL}) ${controlSnapshotSQL}) control_snapshot`).bind(...check.params,runId).first();return row.current===1&&(await decodeControlSnapshot(row.control_snapshot,teamId,runId)).valid;}
export function pinTeamGameAccepted(add,teamId,runId){add(`UPDATE team_game_associations SET accepted_revision=(SELECT p.decision_revision FROM team_game_publications p WHERE p.run_id=? AND p.app_team_id=team_game_associations.app_team_id AND p.association_id=team_game_associations.association_id AND p.disposition='accepted') WHERE app_team_id=? AND EXISTS(SELECT 1 FROM team_game_publications p WHERE p.run_id=? AND p.app_team_id=team_game_associations.app_team_id AND p.association_id=team_game_associations.association_id AND p.disposition='accepted' AND p.decision_revision>COALESCE(team_game_associations.accepted_revision,0)) AND $FENCE`,runId,teamId,runId);}

const unpinned=`d.authority<>'owner' AND d.request_id IS NULL AND d.request_hash IS NULL AND d.revision<>a.head_revision AND d.revision IS NOT a.owner_revision AND d.revision IS NOT a.accepted_revision
 AND NOT EXISTS(SELECT 1 FROM team_game_publications p WHERE p.app_team_id=d.app_team_id AND p.association_id=d.association_id AND p.decision_revision=d.revision)
 AND NOT EXISTS(SELECT 1 FROM team_game_publish_batches b WHERE b.app_team_id=d.app_team_id AND b.association_id=d.association_id AND b.decision_revision=d.revision)
 AND d.revision IS NOT(SELECT MAX(x.revision) FROM team_game_decision_revisions x WHERE x.app_team_id=d.app_team_id AND x.association_id=d.association_id AND x.decision='accepted')
 AND d.revision IS NOT(SELECT MAX(x.revision) FROM team_game_decision_revisions x WHERE x.app_team_id=d.app_team_id AND x.association_id=d.association_id AND x.decision IN('review','pending'))`;
const pruningSQL=`SELECT rowid FROM(SELECT d.rowid,ROW_NUMBER() OVER(PARTITION BY d.association_id ORDER BY d.revision DESC) ordinal FROM team_game_decision_revisions d JOIN team_game_associations a ON a.app_team_id=d.app_team_id AND a.association_id=d.association_id WHERE d.app_team_id=? AND ${unpinned}) WHERE ordinal>32 LIMIT 200`;
export async function pruneTeamGameHistory(db,add,teamId){
  // Batch IDs are internal checkpoint identities, not owner request IDs. Once
  // all participant publications are gone, an obsolete receipt can be pruned.
  const batches=(await db.prepare("SELECT batch_id FROM team_game_publish_batches b WHERE b.app_team_id=? AND b.state='obsolete' AND b.from_build_run_id IS NULL AND b.to_build_run_id IS NULL AND NOT EXISTS(SELECT 1 FROM team_game_publications p WHERE p.publish_batch_id=b.batch_id) ORDER BY batch_id LIMIT 50").bind(teamId).all()).results;
  if(batches.length){add("DELETE FROM team_game_publish_batches WHERE batch_id IN(SELECT value FROM json_each(?)) AND state='obsolete' AND NOT EXISTS(SELECT 1 FROM team_game_publications p WHERE p.publish_batch_id=team_game_publish_batches.batch_id) AND $FENCE",JSON.stringify(batches.map(b=>b.batch_id)));return true;}
  const rows=(await db.prepare(pruningSQL).bind(teamId).all()).results;
  if(rows.length)add(`DELETE FROM team_game_decision_revisions WHERE rowid IN(SELECT value FROM json_each(?)) AND rowid IN(${pruningSQL}) AND $FENCE`,JSON.stringify(rows.map(r=>r.rowid)),teamId);
  return rows.length>0;
}
