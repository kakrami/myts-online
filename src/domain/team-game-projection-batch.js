/** Two-season publication coordinator. Its durable generation fences every
 * participant; no participant can independently expose a half-finished move. */
import {hash} from '../sources/common.js';
import {teamGameAssert,teamGameBuildFrame,teamGameFrameIdentity,teamGameFrameAssertion,addTeamGamePublicationAssertions,pinTeamGameAccepted} from './team-game-projection.js';
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const stamp=()=>new Date().toISOString();
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
export const TEAM_GAME_BATCH_CHECKPOINT_BYTES=8192;
const batchColumns='batch_id,app_team_id,association_id,decision_revision,generation,state,from_team_season_id,to_team_season_id,from_expected_run_id,to_expected_run_id,from_expected_input_revision,to_expected_input_revision,from_build_run_id,to_build_run_id,owner_state_hash,semantic_hash,fence_hash';
export const teamGameBatchContextSQL=`(SELECT json_object(${batchColumns.split(',').map(k=>`'${k}',b.${k}`).join(',')},'from_current_input',f.input_revision,'to_current_input',d.input_revision,'from_current_run',f.published_run_id,'to_current_run',d.published_run_id) FROM team_game_publish_batches b JOIN team_projection_state f ON f.team_season_id=b.from_team_season_id JOIN team_projection_state d ON d.team_season_id=b.to_team_season_id WHERE b.app_team_id=t.id AND(b.state IN('preparing','ready') OR b.batch_id=?) ORDER BY b.state IN('preparing','ready') DESC LIMIT 1)`;
export function teamGameBatchFence(batch){return {sql:`EXISTS(SELECT 1 FROM team_game_publish_batches b JOIN team_projection_state f ON f.team_season_id=b.from_team_season_id JOIN team_projection_state d ON d.team_season_id=b.to_team_season_id WHERE b.batch_id=? AND b.generation=? AND b.state IN('preparing','ready') AND f.input_revision=b.from_expected_input_revision AND d.input_revision=b.to_expected_input_revision AND f.published_run_id IS b.from_expected_run_id AND d.published_run_id IS b.to_expected_run_id)`,params:[batch.batch_id,batch.generation]};}
const valid=batch=>batch.from_current_input===batch.from_expected_input_revision&&batch.to_current_input===batch.to_expected_input_revision&&batch.from_current_run===batch.from_expected_run_id&&batch.to_current_run===batch.to_expected_run_id;
const response=(statements,checkpoint,extra={})=>({statements,checkpoint,complete:false,changed:false,published:false,recoveryRequired:false,affectedTeams:[],...extra});
export async function startTeamGameBatch(repo,team,season,state,cp,statements){
 const add=(sql,...params)=>statements.push({sql,params}),move=cp.move;
 const hold=(reason='destination_scope_unavailable')=>{const held=cp.holdMoves===true?true:[...(cp.holdMoves??[]).filter(h=>(typeof h==='string'?h:h.association_id)!==move.association_id),{association_id:move.association_id,reason}];const next={...cp,phase:'events',move:undefined,holdMoves:held};if(bytes(next)>8192)next.holdMoves=true;return response(statements,next);};
 // Legacy attachment IDs are season-specific. The current resolver requires
 // exact retained scope identity; never relabel it as destination authority.
 if(move.scope_refs.some(ref=>ref.connection_id===null))return hold('legacy_attachment_rebind_requires_review');
 const target=await repo.db.prepare(`SELECT s.*,p.input_revision,p.published_run_id FROM team_seasons s JOIN team_projection_state p ON p.team_season_id=s.id WHERE s.app_team_id=? AND ?>=s.start_day AND ?<s.end_day AND s.id<>? AND NOT EXISTS(SELECT 1 FROM json_each(?) member WHERE NOT EXISTS(SELECT 1 FROM team_source_attachments a LEFT JOIN team_source_connections c ON c.app_team_id=a.app_team_id AND c.source_team_id=a.source_team_id LEFT JOIN team_connection_seasons m ON m.connection_id=c.id AND m.team_season_id=a.team_season_id WHERE a.app_team_id=s.app_team_id AND a.team_season_id=s.id AND a.source_team_id=json_extract(member.value,'$.source_team_id') AND a.account_id IS json_extract(member.value,'$.account_id') AND a.active=1 AND(c.id IS NULL OR(c.id IS json_extract(member.value,'$.connection_id') AND c.active=1 AND c.generation=a.generation AND m.active=1 AND m.excluded=0 AND m.generation=c.generation AND m.attachment_id=a.id)))) ORDER BY s.id LIMIT 2`).bind(team.id,move.desired_day,move.desired_day,season.id,JSON.stringify(move.scope_refs)).all();
 if(target.results.length!==1)return hold();
 const destination=target.results[0],frame=await teamGameBuildFrame(repo.db,team.id,season.id,cp.runId);
 if(cp.gameFrame!==await teamGameFrameIdentity(frame)||frame.source_revision!==move.source_revision||frame.mutation_revision!==move.mutation_revision||frame.saved_valid!==1)return response(statements,{});
 teamGameFrameAssertion(add,team.id,season.id,frame);
 teamGameAssert(add,`NOT EXISTS(SELECT 1 FROM team_game_publish_batches WHERE app_team_id=? AND state IN('preparing','ready')) AND EXISTS(SELECT 1 FROM team_projection_state WHERE team_season_id=? AND input_revision=? AND published_run_id IS ?)`,team.id,destination.id,destination.input_revision,destination.published_run_id);
 const batchId=crypto.randomUUID(),fromRun=crypto.randomUUID(),toRun=crypto.randomUUID(),now=stamp();
 add("UPDATE team_projection_runs SET state='obsolete' WHERE app_team_id=? AND team_season_id IN(?,?) AND state='building' AND $FENCE",team.id,season.id,destination.id);
 for(const [id,seasonId,revision]of [[fromRun,season.id,state.input_revision],[toRun,destination.id,destination.input_revision]])add("INSERT INTO team_projection_runs(id,app_team_id,team_season_id,input_revision,state,created_at,team_game_version) SELECT ?,?,?,?,'building',?,1 WHERE $FENCE",id,team.id,seasonId,revision,now);
 add(`INSERT INTO team_game_publish_batches(batch_id,app_team_id,association_id,decision_revision,generation,state,from_team_season_id,to_team_season_id,from_expected_run_id,to_expected_run_id,from_expected_input_revision,to_expected_input_revision,from_build_run_id,to_build_run_id,owner_state_hash,semantic_hash,fence_hash,created_at) SELECT ?,?,?,?,1,'preparing',?,?,?,?,?,?,?,?,?,?,?,? WHERE $FENCE`,batchId,team.id,move.association_id,move.accepted_revision,season.id,destination.id,state.published_run_id,destination.published_run_id,state.input_revision,destination.input_revision,fromRun,toRun,move.owner_state_hash,await hash(move),await hash(frame),now);
 return response(statements,{batchId,side:'from',from:{runId:fromRun,inputRevision:state.input_revision,phase:'identity',cursor:'',holdMoves:cp.holdMoves??[]},to:{runId:toRun,inputRevision:destination.input_revision,phase:'identity',cursor:'',holdMoves:cp.holdMoves??[]}});
}
function obsolete(batch,reason){
 const statements=[],add=(sql,...params)=>statements.push({sql,params});
 teamGameAssert(add,'EXISTS(SELECT 1 FROM team_game_publish_batches WHERE batch_id=? AND generation=? AND state IN(\'preparing\',\'ready\'))',batch.batch_id,batch.generation);
 add("UPDATE team_projection_runs SET state='obsolete' WHERE id IN(?,?) AND state='building' AND $FENCE",batch.from_build_run_id,batch.to_build_run_id);
 add("UPDATE team_game_publish_batches SET state='obsolete',generation=generation+1,from_expected_run_id=NULL,to_expected_run_id=NULL,from_build_run_id=NULL,to_build_run_id=NULL,completed_at=? WHERE batch_id=? AND generation=? AND $FENCE",stamp(),batch.batch_id,batch.generation);
 return response(statements,['batch_checkpoint_bound','move_proof_or_state_unavailable','team_game_batch_changed'].includes(reason)?{holdMoves:[{association_id:batch.association_id,reason:'destination_move_proof_unavailable'}]}:{}, {batchRestart:reason});
}
export async function buildTeamGameBatchPage(repo,teamId,seasonId,checkpoint,batchJSON,buildSingle){
 const batch=parse(batchJSON),cp={...checkpoint};
 if(batch.state==='published'||batch.state==='obsolete'&&cp.batchCleanup)return cleanupPublished(repo,batch,cp,buildSingle);
 if(batch.state==='obsolete')return response([],{});
 // A non-owning season job may finish its own wake, but cannot stage or publish
 // either participant. The old accepted-season job owns the durable batch.
 if(seasonId!==batch.from_team_season_id)return response([],{finished:true},{complete:true});
 if(cp.batchId!==batch.batch_id||!valid(batch))return obsolete(batch,'checkpoint_or_input_changed');
 if(batch.state==='ready'||cp.side==='commit')return publish(repo,batch,cp);
 const side=cp.side==='to'?'to':'from',inner=cp[side];
 if(!inner||inner.runId!==batch[side+'_build_run_id'])return obsolete(batch,'participant_checkpoint_missing');
 let page;try{page=await buildSingle(repo,teamId,batch[side+'_team_season_id'],inner,{batch});}
 catch(error){if(['team_game_batch_changed','team_game_projection_changed'].includes(error.code))return obsolete(batch,error.code);throw error;}
 if(!page.checkpoint.runId||page.checkpoint.runId!==inner.runId)return obsolete(batch,'participant_obsolete');
 const next={...cp,[side]:page.checkpoint,deferredMoves:cp.deferredMoves||page.deferredMoves};
 if(bytes(next)>TEAM_GAME_BATCH_CHECKPOINT_BYTES)return obsolete(batch,'batch_checkpoint_bound');
 if(page.batchReady){if(side==='from')next.side='to';else return ready(repo,batch,{...next,side:'commit'});}
 const statements=[...page.statements],fence=teamGameBatchFence(batch);
 // The single participant's input assertion includes this same generation CAS.
 statements.push({sql:`UPDATE team_game_publish_batches SET generation=generation+1 WHERE batch_id=? AND generation=? AND ${fence.sql} AND $FENCE`,params:[batch.batch_id,batch.generation,...fence.params]});
 return {...page,statements,checkpoint:next,complete:false,published:false};
}
async function ready(repo,batch,cp){
 const publication=await repo.db.prepare(`SELECT p.decision_revision,p.semantic_hash,d.owner_state_hash FROM team_game_publications p JOIN team_game_decision_revisions d ON d.app_team_id=p.app_team_id AND d.association_id=p.association_id AND d.revision=p.decision_revision JOIN team_game_associations a ON a.app_team_id=p.app_team_id AND a.association_id=p.association_id JOIN team_game_decision_revisions old ON old.app_team_id=a.app_team_id AND old.association_id=a.association_id AND old.revision=a.accepted_revision WHERE p.run_id=? AND p.association_id=? AND p.publish_batch_id=? AND p.disposition='accepted' AND p.state_refs_complete=1 AND NOT EXISTS(SELECT 1 FROM json_each(p.state_refs) ref WHERE json_extract(ref.value,'$.seasonId') IS NOT NULL) AND json_extract(d.proof,'$.source_ids')=json_extract(old.proof,'$.source_ids') AND NOT EXISTS(SELECT 1 FROM team_game_source_rows WHERE run_id=? AND association_id=p.association_id)`).bind(batch.to_build_run_id,batch.association_id,batch.batch_id,batch.from_build_run_id).first();
 if(!publication)return obsolete(batch,'move_proof_or_state_unavailable');
 const statements=[],add=(sql,...params)=>statements.push({sql,params}),fence=teamGameBatchFence(batch);
 teamGameAssert(add,fence.sql,...fence.params);
 add("UPDATE team_game_publish_batches SET state='ready',generation=generation+1,decision_revision=?,owner_state_hash=?,semantic_hash=?,fence_hash=? WHERE batch_id=? AND generation=? AND $FENCE",publication.decision_revision,publication.owner_state_hash,publication.semantic_hash,await hash([cp.from.gameFrame,cp.to.gameFrame]),batch.batch_id,batch.generation);
 return response(statements,cp);
}
async function publish(repo,batch,cp){
 if(!cp.from?.gameFrame||!cp.to?.gameFrame||batch.fence_hash!==await hash([cp.from.gameFrame,cp.to.gameFrame]))return obsolete(batch,'ready_checkpoint_missing');
 const frames={};for(const side of ['from','to']){
  frames[side]=await teamGameBuildFrame(repo.db,batch.app_team_id,batch[side+'_team_season_id'],batch[side+'_build_run_id'],batch);
  if(frames[side].saved_valid!==1||cp[side].gameFrame!==await teamGameFrameIdentity(frames[side]))return obsolete(batch,'ready_input_changed');
 }
 const statements=[],add=(sql,...params)=>statements.push({sql,params}),fence=teamGameBatchFence(batch);
 teamGameAssert(add,`${fence.sql} AND(SELECT COUNT(*) FROM team_projection_runs WHERE id IN(?,?) AND state='building' AND team_game_version=1)=2`,...fence.params,batch.from_build_run_id,batch.to_build_run_id);
 for(const side of ['from','to']){teamGameFrameAssertion(add,batch.app_team_id,batch[side+'_team_season_id'],frames[side]);addTeamGamePublicationAssertions(add,batch.app_team_id,batch[side+'_build_run_id'],batch);}
 add("UPDATE team_projection_runs SET state='obsolete' WHERE id IN(?,?) AND state='published' AND $FENCE",batch.from_expected_run_id,batch.to_expected_run_id);
 add("UPDATE team_projection_runs SET state='published' WHERE id IN(?,?) AND state='building' AND $FENCE",batch.from_build_run_id,batch.to_build_run_id);
 for(const side of ['from','to'])add('UPDATE team_projection_state SET published_run_id=?,published_input_revision=?,pending=?,input_revision=input_revision+?,projection_hash=? WHERE team_season_id=? AND $FENCE',batch[side+'_build_run_id'],batch[side+'_expected_input_revision'],cp.deferredMoves?1:0,cp.deferredMoves?1:0,'batch:'+batch.batch_id,batch[side+'_team_season_id']);
 pinTeamGameAccepted(add,batch.app_team_id,batch.to_build_run_id);
 add('UPDATE team_read_state SET content_revision=content_revision+1,pending=EXISTS(SELECT 1 FROM team_projection_state WHERE app_team_id=? AND pending=1) OR EXISTS(SELECT 1 FROM team_source_connections WHERE app_team_id=? AND active=1 AND input_revision>reconciled_revision) WHERE app_team_id=? AND $FENCE',batch.app_team_id,batch.app_team_id,batch.app_team_id);
 add("UPDATE team_game_publish_batches SET state='published',generation=generation+1,from_expected_run_id=NULL,to_expected_run_id=NULL,completed_at=? WHERE batch_id=? AND generation=? AND $FENCE",stamp(),batch.batch_id,batch.generation);
 const seasons=[batch.from_team_season_id,batch.to_team_season_id];
 return response(statements,{batchId:batch.batch_id,batchCleanup:'from'},{complete:false,recoveryRequired:true,changed:true,published:true,publishedSeasons:seasons,revision:frames.from.content_revision+1,affectedTeams:seasons.map(team_season_id=>({app_team_id:batch.app_team_id,team_season_id}))});
}

async function cleanupPublished(repo,batch,cp,buildSingle){
 const published=batch.state==='published'&&batch.from_current_run===batch.from_build_run_id&&batch.to_current_run===batch.to_build_run_id;
 if(!cp.batchCleanup)return response([],{batchId:batch.batch_id,batchCleanup:'from'},{published,publishedSeasons:published?[batch.from_team_season_id,batch.to_team_season_id]:[],recoveryRequired:true});
 const side=cp.batchCleanup==='to'?'to':'from',page=await buildSingle(repo,batch.app_team_id,batch[side+'_team_season_id'],cp.cleanup??{phase:'cleanup'},{batch});
 if(!page.complete)return {...page,checkpoint:{batchId:batch.batch_id,batchCleanup:side,cleanup:page.checkpoint},published:false};
 if(side==='from')return {...page,checkpoint:{batchId:batch.batch_id,batchCleanup:'to'},complete:false,published:false,recoveryRequired:false};
 return {...page,checkpoint:{finished:true},complete:true,published:false,recoveryRequired:true};
}
