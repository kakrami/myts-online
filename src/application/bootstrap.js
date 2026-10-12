import {SecurityError,requestSession} from '../security/index.js';
import {VERSION} from './version.js';
import {TeamCatalog} from './team-catalog.js';
import {CursorCodec} from '../read-model/cursor.js';
import {actor} from './http.js';
const maintenancePhases=new Set(['sealing','expanding','transfers','roots','memberships','receipts','rosters','events','validating']);
const invalidSession=error=>error instanceof SecurityError&&['sign_in_required','share_invalid'].includes(error.code);
export async function bootstrapModel(request,{db,installation,security}) {
  const setup=await installation.inspect();
  if(setup.state!=='ready')return {version:VERSION,setup:{state:setup.state,progress:setup.progress,...(maintenancePhases.has(setup.phase)?{phase:setup.phase}:{})},session:{role:'anonymous'},teams:[],preferences:{theme:'light',revision:0}};
  const configured=await security.ownerConfigured();
  if(!configured)return {version:VERSION,setup:{state:'ready',progress:100,owner_ready:false},session:{role:'anonymous'},teams:[],preferences:{theme:'light',revision:0}};
  let principal=null;
  const ownerToken=requestSession(request),viewerToken=request.headers.get('x-view-key');
  if(request.headers.has('x-view-key'))principal=await security.viewerPrincipal(viewerToken);
  else if(ownerToken)try{principal=await security.requireOwnerSession(ownerToken);}catch(error){if(!invalidSession(error))throw error;}
  if(!principal)return {version:VERSION,setup:{state:'ready',progress:100,owner_ready:true},session:{role:'anonymous'},teams:[],preferences:{theme:'light',revision:0}};
  const owner=principal.role==='owner',url=new URL(request.url),catalog=new TeamCatalog(db,actor(principal),{cursor:new CursorCodec(await security.getCursorSigningKey())});
  const teams=await catalog.teams({preferred_team_id:url.searchParams.get('preferred_team_id')});
  const selectedTeam=teams.preferred_team??teams.items[0]??null;
  const seasons=selectedTeam?await catalog.seasons(selectedTeam.id,{preferred_season_id:url.searchParams.get('preferred_season_id')}):null;
  const selectedSeason=seasons?.preferred_season??seasons?.items[0]??null;
  const preferences=await db.prepare('SELECT theme,revision FROM owner_preferences WHERE id=1').first();
  return {version:VERSION,setup:{state:'ready',progress:100,owner_ready:true},session:{role:principal.role,categories:owner?undefined:principal.categories},preferences:preferences??{theme:'light',revision:0},
    teams:teams.items.map(team=>({...team,seasons:team.id===selectedTeam?.id?seasons.items:[]})),
    team_catalog:{total:teams.total,revision:teams.revision,branding_revision:teams.branding_revision,next_cursor:teams.next_cursor},
    season_catalog:seasons?{team_id:selectedTeam.id,total:seasons.total,revision:seasons.revision,next_cursor:seasons.next_cursor}:null,
    selected_team:selectedTeam?{...selectedTeam,seasons:seasons.items}:null,selected_season:selectedSeason,
    selection:{team_id:selectedTeam?.id??null,team_season_id:selectedSeason?.id??null}};
}
