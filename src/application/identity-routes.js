import {DomainRepository} from '../domain/repository.js';
import {assertSameOrigin} from '../security/index.js';
import {readAuthBody} from './auth-routes.js';
import {json} from './http.js';
import {invalid} from '../read-model/selection.js';

export async function identityRoutes(request,{db,actor,cursor,sync}) {
  const url=new URL(request.url),path=url.pathname;
  if(!['/api/identities','/api/identities/link','/api/identities/unlink'].includes(path))return null;
  if(actor?.owner!==true)throw invalid('Sign in as the owner to manage linked records.','owner_required',403);
  const repository=new DomainRepository(db),query=Object.fromEntries(url.searchParams);
  if(path==='/api/identities'&&request.method==='GET') {
    const kind=query.kind,team=await repository.team(query.team_id),seasonId=query.team_season_id||team.season_id,selection={team_id:team.id,team_season_id:seasonId,kind,entity_id:query.entity_id||null},scope=`owner/identities/${team.id}/${seasonId}/${kind}`,revision=(await repository.state()).mutation_revision;
    let after='';
    if(query.cursor){const position=await cursor.verify(query.cursor,{selection,scope,revision});if(!Array.isArray(position)||position.length!==1||typeof position[0]!=='string')throw invalid('The linked-record cursor is invalid.','cursor_invalid');after=position[0];}
    const page=await repository.readIdentityPage({teamId:team.id,seasonId,kind,entityId:selection.entity_id,after,limit:Number(query.limit||50)});
    if(page.revision!==revision)throw invalid('Linked records changed. Reload this list.','cursor_restart',409);
    const next_cursor=page.after?await cursor.issue({selection,scope,revision,position:[page.after]}):null;
    return json({...page,next_cursor,after:undefined});
  }
  if(request.method!=='POST'||path==='/api/identities')throw invalid('That linked-record action is unavailable.','method_not_allowed',405);
  assertSameOrigin(request);
  const body=await readAuthBody(request),kind=body.kind,teamId=body.team_id,team=await repository.team(teamId),seasonId=body.team_season_id||team.season_id;
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw invalid('Reload linked records before saving.','revision_invalid');
  if(kind!=='player'&&kind!=='event')throw invalid('Choose player or event identity.');
  const options={teamId,seasonId,expectedMutation:body.revision};
  let result;
  if(path.endsWith('/link')) {
    const confirmation=kind==='player'?'same_person':'same_game';
    if(body.confirmation!==confirmation)throw invalid('Confirm these records describe the same person or game.','identity_confirmation');
    result=await repository.linkEntities(kind,{...options,sourceIds:body.source_ids,evidence:{kind:'owner_confirmed',confirmation,confirmed_at:new Date().toISOString()}});
  } else result=await repository.unlinkEntity(kind,{...options,sourceId:body.source_id});
  if(result.affectedTeams.length){await sync.enqueueProjection(teamId,seasonId,{wake:false});await sync.wake();}
  return json({...result,queued:result.affectedTeams.length>0},202);
}
