/** Compare meaning entirely inside SQLite. Output is one boolean; freshness,
 * source input clocks and account credentials are not publication content. */
const relations=[
 ['team_event_rows','event_id,competition_id,division_id,starts_at,local_day,type,status,conditional,own_side,home_name,away_name,home_score,away_score,goals_for,goals_against,title,venue,source_ids,schedule_source_id,result_source_id,result_conflict,identity_conflict,conflict'],
 ['team_player_rows','player_id,name,jersey,source_ids'],
 ['team_game_source_rows','target_event_id,source_event_id,association_id,original_event_id,provider,account_id,entitlement_kind,connection_id,connected_source_team_id,participant_source_team_id,source_hash,own_proof_hash'],
 ['team_game_publications','association_id,decision_revision,target_event_id,publication_version,disposition,membership_hash,semantic_hash,state_refs_complete,state_scope_roots,state_refs'],
];
export async function teamGameSemanticChange(db,teamId,seasonId,runId,priorRunId){
 if(!priorRunId)return true;
 const params=[priorRunId,teamId,seasonId],checks=["EXISTS(SELECT 1 FROM team_projection_runs WHERE id=? AND app_team_id=? AND team_season_id=? AND team_game_version=1 AND state='published')"];
 for(const [table,columns]of relations)for(const [left,right]of [[runId,priorRunId],[priorRunId,runId]]){
  checks.push(`NOT EXISTS(SELECT ${columns} FROM ${table} WHERE run_id=? EXCEPT SELECT ${columns} FROM ${table} WHERE run_id=?)`);params.push(left,right);
 }
 const row=await db.prepare(`SELECT ${checks.map(check=>'('+check+')').join(' AND ')} same`).bind(...params).first();
 return row.same!==1;
}
