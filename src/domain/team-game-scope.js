/** Published, app-team-local membership. This is a read adapter, never a matcher.
 * A current permission check may subtract a saved member; it cannot add sources
 * to a published game or turn an upstream login pause into loss of saved data.
 */
const identifier=value=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw new TypeError('Invalid game scope relation.');return value;};
const error=(message,code='game_scope_changed',status=409)=>Object.assign(new Error(message),{code,status});
const MAX_SCOPE_BYTES=262144,MAX_STATE_KEYS=256,MAX_OWNER_BYTES=64000;
const bytes=value=>new TextEncoder().encode(value).length;
const memberFields='run_id app_team_id team_season_id target_event_id source_event_id association_id original_event_id provider account_id account_generation entitlement_kind connection_id connection_generation connection_input_revision membership_generation attachment_id attachment_generation connected_source_team_id participant_source_team_id source_hash source_input_revision event_link_revision own_proof_hash legacy_run'.split(' ');
const aggregate=(expression,from,order,limit=257)=>`(SELECT json_group_array(json(item)) FROM(SELECT ${expression} AS item FROM ${from} ORDER BY ${order} LIMIT ${limit}))`;


/** The caller supplies a relation containing app_team_id and team_season_id.
 * All resulting rows are pinned to its current published run. Old runs created
 * before the extension (immutable version0) may use their exact saved source_ids
 * cache. Every new version1 run must have complete normalized membership.
 */
export function publishedGameScopeCTE(selection='game_selection',prefix='game') {
  selection=identifier(selection);prefix=identifier(prefix);
  const n=s=>prefix+'_'+s;
  return `${n('runs')} AS(
    SELECT p.app_team_id,p.team_season_id,p.published_run_id AS run_id,p.input_revision,p.published_input_revision,p.pending,r.content_revision,pr.team_game_version
    FROM team_projection_state p JOIN ${selection} q ON q.app_team_id=p.app_team_id AND q.team_season_id=p.team_season_id
    JOIN team_read_state r ON r.app_team_id=p.app_team_id
    JOIN team_projection_runs pr ON pr.id=p.published_run_id AND pr.app_team_id=p.app_team_id AND pr.team_season_id=p.team_season_id AND pr.state='published'
    WHERE p.published_run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=p.app_team_id)),
  ${n('stored')} AS(
    SELECT m.*,0 AS legacy_run FROM team_game_source_rows m JOIN ${n('runs')} r
      ON r.run_id=m.run_id AND r.app_team_id=m.app_team_id AND r.team_season_id=m.team_season_id),
  ${n('old_candidates')} AS(
    SELECT e.run_id,e.app_team_id,e.team_season_id,e.event_id AS target_event_id,s.id AS source_event_id,NULL AS association_id,
      ci.canonical_id AS original_event_id,s.provider,s.account_id,pa.generation AS account_generation,
      CASE WHEN c.id IS NULL THEN 'legacy_attachment' ELSE 'root' END AS entitlement_kind,
      c.id AS connection_id,c.generation AS connection_generation,c.input_revision AS connection_input_revision,cm.generation AS membership_generation,
      a.id AS attachment_id,a.generation AS attachment_generation,a.source_team_id AS connected_source_team_id,et.source_team_id AS participant_source_team_id,
      s.content_hash AS source_hash,COALESCE(es.input_revision,0) AS source_input_revision,el.revision AS event_link_revision,NULL AS own_proof_hash,1 AS legacy_run,
      ROW_NUMBER() OVER(PARTITION BY e.run_id,e.app_team_id,e.team_season_id,s.id ORDER BY CASE WHEN c.id IS NULL THEN 1 ELSE 0 END,a.id,et.source_team_id) AS ordinal
    FROM ${n('runs')} r JOIN team_event_rows e ON e.run_id=r.run_id AND e.app_team_id=r.app_team_id AND e.team_season_id=r.team_season_id
    JOIN json_each(e.source_ids) j JOIN source_events s ON s.id=j.value
    JOIN event_source_links el ON el.source_event_id=s.id JOIN canonical_event_ids ci ON ci.input_id=el.event_id
    JOIN source_event_teams et ON et.source_event_id=s.id
    JOIN team_source_attachments a ON a.app_team_id=e.app_team_id AND a.team_season_id=e.team_season_id AND a.account_id IS s.account_id AND a.active=1
      AND(a.source_team_id=et.source_team_id OR(s.provider IN('gotsport','live') AND EXISTS(SELECT 1 FROM source_team_links b WHERE b.kind='provider_external_key' AND((b.a=a.source_team_id AND b.b=et.source_team_id)OR(b.b=a.source_team_id AND b.a=et.source_team_id)))))
    LEFT JOIN team_source_connections c ON c.app_team_id=a.app_team_id AND c.source_team_id=a.source_team_id
    LEFT JOIN team_connection_seasons cm ON cm.connection_id=c.id AND cm.team_season_id=a.team_season_id
    LEFT JOIN provider_accounts pa ON pa.id=s.account_id LEFT JOIN source_event_state es ON es.source_event_id=s.id
    WHERE r.team_game_version=0 AND NOT EXISTS(SELECT 1 FROM ${n('stored')} m WHERE m.run_id=r.run_id)
      AND ci.canonical_id=e.event_id AND(c.id IS NULL OR(c.active=1 AND cm.active=1 AND cm.excluded=0))),
  ${n('members')} AS(
    SELECT * FROM ${n('stored')} UNION ALL SELECT run_id,app_team_id,team_season_id,target_event_id,source_event_id,association_id,
      original_event_id,provider,account_id,account_generation,entitlement_kind,connection_id,connection_generation,connection_input_revision,membership_generation,
      attachment_id,attachment_generation,connected_source_team_id,participant_source_team_id,source_hash,source_input_revision,event_link_revision,own_proof_hash,legacy_run
      FROM ${n('old_candidates')} WHERE ordinal=1),
  ${n('checked')} AS(
    SELECT m.*,s.content_hash AS current_source_hash,COALESCE(es.input_revision,0) AS current_source_input_revision,el.revision AS current_event_link_revision,c.input_revision AS current_connection_input_revision,pa.generation AS current_account_generation,
      json_array(${memberFields.map(k=>'m.'+k).join(',')},s.content_hash,s.provider,s.account_id,s.provenance,(SELECT revision FROM source_row_versions WHERE table_name='source_events' AND row_key=json_array(s.id)),(SELECT revision FROM source_row_versions WHERE table_name='source_teams' AND row_key=json_array(connected.id)),COALESCE(es.input_revision,0),el.event_id,el.revision,el.reason,el.evidence,
        (SELECT canonical_id FROM canonical_event_ids WHERE input_id=el.event_id),connected.content_hash,connected.provenance,connected.provider,connected.account_id,
        pa.generation,pa.active,c.app_team_id,c.source_team_id,c.account_id,c.active,c.generation,c.input_revision,cm.active,cm.excluded,cm.generation,cm.attachment_id,
        a.app_team_id,a.team_season_id,a.source_team_id,a.account_id,a.active,a.generation,
        ${aggregate("json_array(et.source_team_id,et.side)","source_event_teams et WHERE et.source_event_id=m.source_event_id","et.source_team_id")},
        ${aggregate("json_array(b.a,b.b,b.kind,b.evidence)","source_team_links b WHERE(b.a=m.connected_source_team_id AND b.b=m.participant_source_team_id)OR(b.b=m.connected_source_team_id AND b.a=m.participant_source_team_id)","b.a,b.b")}) AS member_snapshot,
      CASE WHEN s.id IS NOT NULL AND s.provider=m.provider AND s.account_id IS m.account_id
        AND connected.id IS NOT NULL AND connected.account_id IS m.account_id
        AND(m.association_id IS NULL OR EXISTS(SELECT 1 FROM team_game_publications gp JOIN team_game_associations ga ON ga.app_team_id=gp.app_team_id AND ga.association_id=gp.association_id
          WHERE gp.run_id=m.run_id AND gp.app_team_id=m.app_team_id AND gp.team_season_id=m.team_season_id AND gp.association_id=m.association_id AND gp.target_event_id=m.target_event_id AND gp.disposition IN('accepted','review','pending')
          AND (ga.owner_revision IS NULL OR ga.owner_revision<=gp.decision_revision)
          AND NOT EXISTS(SELECT 1 FROM team_game_decision_revisions od WHERE od.app_team_id=ga.app_team_id AND od.association_id=ga.association_id AND od.revision=ga.owner_revision AND od.decision='rejected')))
        AND(s.account_id IS NULL OR(pa.id IS NOT NULL AND pa.provider=s.provider))
        AND EXISTS(SELECT 1 FROM source_event_teams et WHERE et.source_event_id=m.source_event_id AND et.source_team_id=m.participant_source_team_id)
        AND(m.participant_source_team_id=m.connected_source_team_id OR(s.provider IN('gotsport','live') AND connected.provider IN('gotsport','live') AND EXISTS(SELECT 1 FROM source_team_links b WHERE b.kind='provider_external_key' AND((b.a=m.connected_source_team_id AND b.b=m.participant_source_team_id)OR(b.b=m.connected_source_team_id AND b.a=m.participant_source_team_id)))))
        AND((m.entitlement_kind='root' AND c.app_team_id=m.app_team_id AND c.source_team_id=m.connected_source_team_id AND c.account_id IS m.account_id AND c.active=1 AND c.generation=m.connection_generation AND cm.active=1 AND cm.excluded=0 AND cm.generation=m.membership_generation)
          OR(m.entitlement_kind='legacy_attachment' AND a.app_team_id=m.app_team_id AND a.team_season_id=m.team_season_id AND a.source_team_id=m.connected_source_team_id AND a.account_id IS m.account_id AND a.active=1 AND a.generation=m.attachment_generation
            AND NOT EXISTS(SELECT 1 FROM team_source_connections cr WHERE cr.app_team_id=m.app_team_id AND cr.source_team_id=m.connected_source_team_id)))
        THEN 1 ELSE 0 END AS entitled,
      CASE WHEN s.content_hash IS NOT m.source_hash OR COALESCE(es.input_revision,0)<>m.source_input_revision OR el.revision IS NOT m.event_link_revision
        OR(m.account_id IS NOT NULL AND pa.generation IS NOT m.account_generation)
        OR(m.connection_id IS NOT NULL AND c.input_revision IS NOT m.connection_input_revision)
        THEN 1 ELSE 0 END AS evidence_changed
    FROM ${n('members')} m LEFT JOIN source_events s ON s.id=m.source_event_id
    LEFT JOIN source_teams connected ON connected.id=m.connected_source_team_id
    LEFT JOIN provider_accounts pa ON pa.id=m.account_id LEFT JOIN source_event_state es ON es.source_event_id=m.source_event_id
    LEFT JOIN event_source_links el ON el.source_event_id=m.source_event_id
    LEFT JOIN team_source_connections c ON c.id=m.connection_id
    LEFT JOIN team_connection_seasons cm ON cm.connection_id=m.connection_id AND cm.team_season_id=m.team_season_id
    LEFT JOIN team_source_attachments a ON a.id=m.attachment_id),
  ${n('targets')} AS(
    SELECT e.*,r.input_revision,r.published_input_revision,r.pending,r.content_revision,r.team_game_version,
      COUNT(m.source_event_id) AS member_count,COALESCE(SUM(m.entitled),0) AS entitled_count,COALESCE(MAX(m.evidence_changed),0) AS evidence_changed,
      CASE WHEN COUNT(m.source_event_id)=json_array_length(e.source_ids) AND json_array_length(e.source_ids)=(SELECT COUNT(DISTINCT value) FROM json_each(e.source_ids)) AND COUNT(m.source_event_id)>0 AND MIN(m.entitled)=1
        AND NOT EXISTS(SELECT 1 FROM json_each(e.source_ids) j WHERE NOT EXISTS(SELECT 1 FROM ${n('checked')} z WHERE z.run_id=e.run_id AND z.app_team_id=e.app_team_id AND z.team_season_id=e.team_season_id AND z.target_event_id=e.event_id AND z.source_event_id=j.value))
        THEN 1 ELSE 0 END AS locally_available
    FROM ${n('runs')} r JOIN team_event_rows e ON e.run_id=r.run_id AND e.app_team_id=r.app_team_id AND e.team_season_id=r.team_season_id
    LEFT JOIN ${n('checked')} m ON m.run_id=e.run_id AND m.app_team_id=e.app_team_id AND m.team_season_id=e.team_season_id AND m.target_event_id=e.event_id
    GROUP BY e.run_id,e.app_team_id,e.team_season_id,e.event_id)`;
}

// The very same expression is read and compared by the committing statement.
// A boolean stale flag is deliberately insufficient: observed stale evidence may
// change again without a new published pointer or content revision.
function scopeSnapshotSQL() {
  const publications=aggregate(`json_array(p.association_id,p.decision_revision,p.target_event_id,p.disposition,p.membership_hash,p.semantic_hash,p.proof_hash,p.state_refs_complete,p.state_scope_roots,p.fence_hash,p.fence,p.state_refs,p.publish_batch_id,
    d.authority,d.decision,d.proof_hash,d.semantic_hash,d.owner_state_hash,a.head_revision,a.owner_revision,a.accepted_revision,a.target_event_id,hd.authority,hd.decision,hd.proof_hash)`,
    `team_game_publications p JOIN team_game_associations a ON a.app_team_id=p.app_team_id AND a.association_id=p.association_id
    JOIN team_game_decision_revisions d ON d.app_team_id=p.app_team_id AND d.association_id=p.association_id AND d.revision=p.decision_revision
    LEFT JOIN team_game_decision_revisions hd ON hd.app_team_id=a.app_team_id AND hd.association_id=a.association_id AND hd.revision=a.head_revision
    WHERE p.run_id=t.run_id AND p.app_team_id=t.app_team_id AND p.team_season_id=t.team_season_id AND p.target_event_id=t.event_id`, 'p.association_id');
  return `json_array(t.run_id,t.event_id,t.source_ids,t.starts_at,t.local_day,t.type,t.status,t.conditional,t.identity_conflict,t.own_side,t.schedule_source_id,t.result_source_id,
    (SELECT timezone FROM app_teams WHERE id=t.app_team_id),
    ${aggregate('m.member_snapshot', 'game_checked m WHERE m.run_id=t.run_id AND m.app_team_id=t.app_team_id AND m.team_season_id=t.team_season_id AND m.target_event_id=t.event_id','m.source_event_id')},${publications},${stateKeysSQL()},
    ${aggregate('json_array(r.event_id,r.team_season_id,r.state,r.effective_day,r.basis,r.evidence)', 'team_event_season_resolutions r WHERE r.app_team_id=t.app_team_id AND r.event_id IN(SELECT value FROM json_each('+stateKeysSQL()+'))','r.event_id')})`;
}
function stateKeysSQL() {
  return `(SELECT json_group_array(id) FROM(SELECT DISTINCT c.input_id AS id FROM canonical_event_ids c WHERE c.canonical_id IN(
    SELECT canonical_id FROM canonical_event_ids WHERE input_id=t.event_id
    UNION SELECT ci.canonical_id FROM game_checked m JOIN canonical_event_ids ci ON ci.input_id=m.original_event_id WHERE m.run_id=t.run_id AND m.app_team_id=t.app_team_id AND m.team_season_id=t.team_season_id AND m.target_event_id=t.event_id
    UNION SELECT ci.canonical_id FROM team_game_publications p,json_each(p.state_refs) ref JOIN canonical_event_ids ci ON ci.input_id=json_extract(ref.value,'$.event_id')
      WHERE p.run_id=t.run_id AND p.app_team_id=t.app_team_id AND p.team_season_id=t.team_season_id AND p.target_event_id=t.event_id AND p.state_refs_complete=1
        AND COALESCE(json_extract(ref.value,'$.teamId'),json_extract(ref.value,'$.app_team_id'),t.app_team_id)=t.app_team_id)
    ORDER BY id LIMIT ${MAX_STATE_KEYS+1}))`;
}

/** One SQL snapshot resolves a contextual native/canonical/target reference.
 * Native/public global identity is deliberately unchanged. A collision never
 * chooses the first target. Callers pin this run through subsequent reads and
 * compare it again (or use gameScopeFenceSQL in a committing transaction).
 */
export async function resolvePublishedGame(db,teamId,seasonId,eventReference,{maxMembers=128}={}) {
  if(!Number.isInteger(maxMembers)||maxMembers<1||maxMembers>256)throw new TypeError('Invalid game member limit.');
  const rows=(await db.prepare(`WITH game_selection AS(SELECT ? AS app_team_id,? AS team_season_id),${publishedGameScopeCTE()},
    reference AS(SELECT ? AS id,COALESCE((SELECT canonical_id FROM canonical_event_ids WHERE input_id=?),?) AS canonical_id),
    matches AS(SELECT t.* FROM game_targets t,reference ref WHERE t.event_id=ref.id OR t.event_id=ref.canonical_id OR EXISTS(SELECT 1 FROM game_checked m WHERE m.run_id=t.run_id AND m.app_team_id=t.app_team_id AND m.team_season_id=t.team_season_id AND m.target_event_id=t.event_id AND(m.source_event_id=ref.id OR m.original_event_id=ref.id OR m.original_event_id=ref.canonical_id)))
    SELECT t.*,(SELECT count(*) FROM team_game_publications p WHERE p.run_id=t.run_id AND p.app_team_id=t.app_team_id AND p.team_season_id=t.team_season_id AND p.target_event_id=t.event_id)>256 OR EXISTS(SELECT 1 FROM game_checked m WHERE m.run_id=t.run_id AND m.app_team_id=t.app_team_id AND m.team_season_id=t.team_season_id AND m.target_event_id=t.event_id AND(SELECT count(*) FROM source_event_teams et WHERE et.source_event_id=m.source_event_id)>256) AS snapshot_overflow,NOT EXISTS(SELECT 1 FROM team_game_publications p WHERE p.run_id=t.run_id AND p.app_team_id=t.app_team_id AND p.team_season_id=t.team_season_id AND p.target_event_id=t.event_id AND p.state_refs_complete=0) AS owner_state_complete,${`CASE WHEN length(CAST(${scopeSnapshotSQL()} AS BLOB))<=${MAX_SCOPE_BYTES} THEN ${scopeSnapshotSQL()} END`} AS scope_fence_snapshot,${stateKeysSQL()} AS original_state_event_ids,CASE WHEN t.member_count<=? THEN(SELECT json_group_array(json_object('source_id',m.source_event_id,'original_event_id',m.original_event_id,'provider',m.provider,'account_id',m.account_id,'source_team_id',m.participant_source_team_id,'association_id',m.association_id,'entitled',m.entitled,'evidence_changed',m.evidence_changed,'current_source_hash',m.current_source_hash,'current_source_input_revision',m.current_source_input_revision,'current_event_link_revision',m.current_event_link_revision,'current_connection_input_revision',m.current_connection_input_revision,'current_account_generation',m.current_account_generation)) FROM game_checked m WHERE m.run_id=t.run_id AND m.app_team_id=t.app_team_id AND m.team_season_id=t.team_season_id AND m.target_event_id=t.event_id) END AS members
    FROM matches t ORDER BY t.event_id LIMIT 2`).bind(teamId,seasonId,eventReference,eventReference,eventReference,maxMembers).all()).results;
  if(!rows.length)return null;
  if(rows.length!==1)throw error('This game reference has more than one saved target.','game_scope_ambiguous');
  const row=rows[0];
  if(!row.locally_available)return {app_team_id:teamId,team_season_id:seasonId,event_id:row.event_id,run_id:row.run_id,available:false,pending:true,reason:'local_source_unavailable'};
  if(row.member_count>maxMembers)return {app_team_id:teamId,team_season_id:seasonId,event_id:row.event_id,run_id:row.run_id,available:false,pending:true,reason:'source_scope_bound'};
  if(row.snapshot_overflow||!row.scope_fence_snapshot||bytes(row.scope_fence_snapshot)>MAX_SCOPE_BYTES||JSON.parse(row.original_state_event_ids).length>MAX_STATE_KEYS)return {app_team_id:teamId,team_season_id:seasonId,event_id:row.event_id,run_id:row.run_id,available:false,pending:true,reason:'owner_scope_bound'};
  const members=JSON.parse(row.members).sort((a,b)=>a.source_id.localeCompare(b.source_id)),{members:ignored,...event}=row;
  return {...event,original_state_event_ids:JSON.parse(row.original_state_event_ids),available:true,pending:!!row.pending,source_members:members,source_ids:members.map(m=>m.source_id).sort(),original_event_ids:[...new Set(members.map(m=>m.original_event_id))].sort()};
}

export async function gameScopeRevision(scope) {
  if(!scope?.run_id||!scope.app_team_id||!scope.team_season_id||!scope.event_id)throw error('The saved game scope is unavailable.');
  const sources=typeof scope.source_ids==='string'?JSON.parse(scope.source_ids):scope.source_ids;
  if(!Array.isArray(sources))throw error('The saved game scope is unavailable.');
  const value=JSON.stringify([scope.app_team_id,scope.team_season_id,scope.run_id,scope.event_id,[...sources].sort()]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
}

export function gameScopeFenceSQL(scope,{forWrite=true}={}) {
  if(!scope?.available||!scope.run_id||!scope.app_team_id||!scope.team_season_id||!scope.scope_fence_snapshot)throw error('The saved game scope is unavailable.');
  return {sql:`EXISTS(WITH game_selection AS(SELECT ? AS app_team_id,? AS team_season_id),${publishedGameScopeCTE()}
    SELECT 1 FROM game_targets t WHERE t.event_id=? AND t.run_id=? AND t.content_revision=? AND t.locally_available=1
    ${forWrite?'AND t.input_revision=? AND t.pending=0':''} AND ${scopeSnapshotSQL()}=?)`,
    params:[scope.app_team_id,scope.team_season_id,scope.event_id,scope.run_id,scope.content_revision,...(forWrite?[scope.input_revision]:[]),scope.scope_fence_snapshot]};
}

// All key sets are complete or rejected. Row limits are sentinels, never a
// truncation contract. No owner record is copied, renamed, or consolidated.
const OWNER_KINDS={
  domain_overrides:{fields:'entity_id,revision,fields',key:'entity_id',extra:" AND kind='event'",season:false},
  game_bookmarks:{fields:'event_id,saved_at,snapshot',key:'event_id',season:false},
  coach_sessions:{fields:'event_id,revision,write_token',key:'event_id'},
  analysis_overrides:{fields:'event_id,kind,player_id,revision,fields',key:'event_id',extra:" AND kind IN('match','player_match')"},
  analysis_lineup_headers:{fields:'event_id,revision,format',key:'event_id'},
  analysis_track_assignments:{fields:'source_event_id,source_team_id,gid,player_id,revision',key:'source_event_id',source:true},
};
function ownerSnapshotSQL(kinds) {
  return `WITH owner_scope AS(SELECT ? AS team_id,? AS season_id,? AS keys,? AS sources) SELECT json_array(${kinds.map(kind=>{
    const spec=OWNER_KINDS[kind],fields=spec.fields.split(',').map(k=>'o.'+k).join(','),filter=`o.app_team_id=q.team_id${spec.season===false?'':' AND o.team_season_id=q.season_id'} AND o.${spec.key} IN(SELECT value FROM json_each(q.${spec.source?'sources':'keys'}))${spec.extra??''}`;
    return aggregate(`json_array(${fields})`,`${kind} o,owner_scope q WHERE ${filter}`,fields);
  }).join(',')}) AS snapshot`;
}
export async function captureGameOwnerState(db,scope,{kinds=['domain_overrides','game_bookmarks','coach_sessions','analysis_overrides','analysis_lineup_headers','analysis_track_assignments']}={}) {
  if(!scope?.available||!Array.isArray(scope.original_state_event_ids))throw error('The saved game scope is unavailable.');
  if(!scope.owner_state_complete)throw error('This game has a paginated saved-state hold. Open its original saved records.','game_owner_state_bound');
  if(!Array.isArray(kinds)||!kinds.length||new Set(kinds).size!==kinds.length||kinds.some(k=>!Object.hasOwn(OWNER_KINDS,k)))throw new TypeError('Invalid owner state kind.');
  const params=[scope.app_team_id,scope.team_season_id,JSON.stringify(scope.original_state_event_ids),JSON.stringify(scope.source_ids)],sql=ownerSnapshotSQL(kinds),row=await db.prepare(`SELECT CASE WHEN length(CAST(snapshot AS BLOB))<=${MAX_OWNER_BYTES} THEN snapshot END AS snapshot FROM(${sql})`).bind(...params).first(),snapshot=row.snapshot;
  if(snapshot==null)throw error('This game has too much saved state for one edit. Open its original saved records.','game_owner_state_bound');
  const lists=JSON.parse(snapshot);
  if(bytes(snapshot)>MAX_OWNER_BYTES||lists.some(rows=>rows.length>MAX_STATE_KEYS))throw error('This game has too much saved state for one edit. Open its original saved records.','game_owner_state_bound');
  const records=Object.fromEntries(kinds.map((kind,i)=>[kind,lists[i].map(values=>Object.fromEntries(OWNER_KINDS[kind].fields.split(',').map((field,n)=>[field,values[n]])))]));
  const event_ids=[...new Set(Object.entries(records).flatMap(([kind,rows])=>OWNER_KINDS[kind].source?[]:rows.map(row=>row[OWNER_KINDS[kind].key])))].sort();
  return {sql,params,snapshot,records,rows:Object.entries(records).flatMap(([kind,rows])=>rows.map(row=>({kind,...row}))),event_ids,conflict:event_ids.length>1};
}
export function gameOwnerStateFenceSQL(captured) {
  if(!captured?.sql||typeof captured.snapshot!=='string')throw error('The saved owner state is unavailable.');
  return {sql:`(${captured.sql})=?`,params:[...captured.params,captured.snapshot]};
}

/** Recheck the exact pinned membership and observed evidence after a multi-query
 * read. A root unlink can precede content publication, so pointer-only checks
 * are insufficient. This never discovers/adds a new constituent source. */
export async function assertPublishedGameCurrent(db,scope) {
  if(!scope?.available)throw error('The saved game scope is unavailable.');
  const current=await resolvePublishedGame(db,scope.app_team_id,scope.team_season_id,scope.event_id);
  if(!current?.available||current.run_id!==scope.run_id||current.content_revision!==scope.content_revision
    ||current.input_revision!==scope.input_revision||current.pending!==scope.pending
    ||current.scope_fence_snapshot!==scope.scope_fence_snapshot)
    throw error('This game changed. Reload it.','cursor_restart');
  return current;
}
