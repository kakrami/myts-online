import {invalid} from '../read-model/selection.js';
import {sourceBranding,sourceBrandingJSONSQL,sourceBrandingQuery} from '../read-model/branding.js';

// Counters follow catalog structure and labels, never background statistics.
const teamBump=`INSERT INTO catalog_state(id,teams_revision) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET teams_revision=teams_revision+1;`;
const brandingBump=`INSERT INTO catalog_state(id,branding_revision) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET branding_revision=branding_revision+1;`;
const localBump=(column,team)=>`INSERT INTO team_catalog_state(app_team_id,${column}) SELECT ${team},1 WHERE EXISTS(SELECT 1 FROM app_teams WHERE id=${team}) ON CONFLICT(app_team_id) DO UPDATE SET ${column}=${column}+1;`;
export const CATALOG_SCHEMA=[
  `CREATE TABLE catalog_state(id INTEGER PRIMARY KEY CHECK(id=1),teams_revision INTEGER NOT NULL DEFAULT 0,branding_revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE team_catalog_state(app_team_id TEXT PRIMARY KEY REFERENCES app_teams(id) ON DELETE CASCADE,seasons_revision INTEGER NOT NULL DEFAULT 0,attachments_revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TRIGGER catalog_team_insert AFTER INSERT ON app_teams BEGIN ${teamBump} INSERT INTO team_catalog_state(app_team_id) VALUES(NEW.id) ON CONFLICT DO NOTHING; END`,
  `CREATE TRIGGER catalog_team_delete AFTER DELETE ON app_teams BEGIN ${teamBump} END`,
  `CREATE TRIGGER catalog_team_update AFTER UPDATE OF name,timezone,season_year ON app_teams BEGIN ${teamBump} END`,
  ...['INSERT','DELETE','UPDATE'].map(operation=>`CREATE TRIGGER catalog_profile_${operation.toLowerCase()} AFTER ${operation}${operation==='UPDATE'?' OF club_id,kind,active,revision':''} ON team_profiles BEGIN ${teamBump} ${brandingBump} END`),
  ...['INSERT','UPDATE'].map(operation=>`CREATE TRIGGER catalog_lifecycle_${operation.toLowerCase()} AFTER ${operation} ON team_lifecycle BEGIN ${teamBump} END`),
  ...['INSERT','DELETE','UPDATE'].map(operation=>`CREATE TRIGGER catalog_season_${operation.toLowerCase()} AFTER ${operation}${operation==='UPDATE'?' OF year,start_day,end_day,include_june':''} ON team_seasons BEGIN ${localBump('seasons_revision',operation==='DELETE'?'OLD.app_team_id':'NEW.app_team_id')} END`),
  ...['INSERT','DELETE','UPDATE'].map(operation=>`CREATE TRIGGER catalog_attachment_${operation.toLowerCase()} AFTER ${operation} ON team_source_attachments BEGIN ${localBump('attachments_revision',operation==='DELETE'?'OLD.app_team_id':'NEW.app_team_id')} ${brandingBump} END`),
  `CREATE TRIGGER catalog_source_label AFTER UPDATE OF name,season_label,archived ON source_teams WHEN OLD.name<>NEW.name OR OLD.season_label IS NOT NEW.season_label OR OLD.archived<>NEW.archived BEGIN INSERT INTO team_catalog_state(app_team_id,attachments_revision) SELECT DISTINCT app_team_id,1 FROM team_source_attachments WHERE source_team_id=NEW.id ON CONFLICT(app_team_id) DO UPDATE SET attachments_revision=attachments_revision+1; END`,
  `CREATE TRIGGER catalog_account_authorization AFTER UPDATE OF active,generation ON provider_accounts BEGIN INSERT INTO team_catalog_state(app_team_id,attachments_revision) SELECT DISTINCT app_team_id,1 FROM team_source_attachments WHERE account_id=NEW.id ON CONFLICT(app_team_id) DO UPDATE SET attachments_revision=attachments_revision+1; END`,
  ...['INSERT','DELETE','UPDATE'].map(operation=>`CREATE TRIGGER catalog_credential_${operation.toLowerCase()} AFTER ${operation} ON security_account_credentials BEGIN INSERT INTO team_catalog_state(app_team_id,attachments_revision) SELECT DISTINCT app_team_id,1 FROM team_source_attachments WHERE account_id=${operation==='DELETE'?'OLD':'NEW'}.account_id ON CONFLICT(app_team_id) DO UPDATE SET attachments_revision=attachments_revision+1; END`),
  ...['INSERT','DELETE','UPDATE'].map(operation=>`CREATE TRIGGER catalog_club_branding_${operation.toLowerCase()} AFTER ${operation} ON club_branding BEGIN ${brandingBump} END`),
  `CREATE TRIGGER catalog_source_branding AFTER UPDATE OF evidence,club_key ON source_teams WHEN json_extract(OLD.evidence,'$.logo') IS NOT json_extract(NEW.evidence,'$.logo') OR OLD.club_key IS NOT NEW.club_key BEGIN ${brandingBump} END`,
  ...['INSERT','DELETE','UPDATE'].map(operation=>`CREATE TRIGGER catalog_source_bridge_${operation.toLowerCase()} AFTER ${operation} ON source_team_links BEGIN ${brandingBump} END`),
];

const visible=`COALESCE(p.active,1)=1 AND NOT EXISTS(SELECT 1 FROM team_lifecycle life WHERE life.team_id=t.id)`;
const teamColumns=`t.id,t.name,t.timezone,COALESCE(p.kind,'own') AS kind,COALESCE(p.revision,0) AS profile_revision,p.club_id,COALESCE(b.revision,0) AS logo_revision,CASE WHEN b.logo IS NOT NULL THEN 1 ELSE 0 END AS owner_logo_available`;
const teamsFrom=`FROM app_teams t LEFT JOIN team_profiles p ON p.app_team_id=t.id LEFT JOIN club_branding b ON b.club_id=p.club_id`;
const teamDTO=row=>{const {source_branding,...team}=row,defaults=sourceBranding(source_branding);return {...team,owner_logo_available:!!team.owner_logo_available,logo_url:team.owner_logo_available?null:defaults.logo,logo_state:team.owner_logo_available?'owner':defaults.logo_state,group:team.kind==='followed'?'Followed teams':'My team'};};
const seasonDTO=row=>({...row,label:`${row.year}–${row.year+1}`,include_june:!!row.include_june});
const limitValue=(value,max)=>{if(!Number.isInteger(value)||value<1||value>max)throw invalid('Invalid catalog page size.');return value;};
const continuation=(value,count)=>{if(!Array.isArray(value)||value.length!==count||value.some(v=>typeof v!=='string'))throw invalid('Invalid catalog continuation.','cursor_invalid');return value;};

const PENDING_ROSTER_LIMIT=20;
const pendingRosterWhere=root=>`m.source_team_id=${root}.source_team_id AND m.active=1 AND ${root}.active=1 AND p.account_id IS ${root}.account_id AND NOT EXISTS(SELECT 1 FROM connection_roster_evidence evidence WHERE evidence.connection_id=${root}.id AND evidence.source_player_id=p.id AND evidence.certainty='verified' AND evidence.basis IN('game','attendance','dated_roster'))`;
const pendingRosterFrom=root=>`FROM source_roster_memberships m JOIN source_players p ON p.id=m.source_player_id WHERE ${pendingRosterWhere(root)}`;
const rosterReviewFrom=root=>`FROM connection_roster_evidence evidence WHERE evidence.connection_id=${root}.id AND ${root}.active=1 AND evidence.basis='dated_roster' AND evidence.certainty='preserved_uncertain'`;
const excludedReason=root=>`CASE WHEN e.basis='season_scope_conflict' THEN 'season_scope_conflict' WHEN ${root}.scope_mode='fixed_seasons' THEN 'outside_saved_seasons_or_excluded' ELSE 'season_excluded' END`;
const rosterModel=(total,items)=>({total,items,limit:PENDING_ROSTER_LIMIT,truncated:total>items.length});
// Only validated saved civil dates yield a desired season. June belongs to
// the following July–May season; no current-year inference is used here.
const civilSeasonYearSQL=`CAST(substr(e.effective_day,1,4) AS INTEGER)-CASE WHEN substr(e.effective_day,6,2)<'06' THEN 1 ELSE 0 END`;
const desiredYearSQL=`CASE WHEN e.state='excluded' AND e.basis='season_scope_conflict' AND length(e.effective_day)=10 AND date(e.effective_day,'+0 days')=e.effective_day AND (${civilSeasonYearSQL}) BETWEEN 2000 AND 2100 THEN ${civilSeasonYearSQL} ELSE NULL END`;
const evidenceModel=groups=>{
  const sum=predicate=>groups.filter(predicate).reduce((total,row)=>total+row.count,0),reasons=new Map();
  for(const {state,reason,count,desired_year} of groups){if(state!=='excluded')continue;const row=reasons.get(reason)??{reason,count:0,years:new Set()};row.count+=count;if(Number.isInteger(desired_year)&&desired_year>=2000&&desired_year<=2100)row.years.add(desired_year);reasons.set(reason,row);}
  return {pending_events:sum(row=>row.state==='pending'),conflicting_events:sum(row=>row.state==='conflict'),excluded_events:sum(row=>row.state==='excluded'),needs_review_events:sum(row=>row.state==='excluded'&&row.reason==='season_scope_conflict'),excluded_reasons:[...reasons.values()].map(({reason,count,years})=>({reason,count,...(reason==='season_scope_conflict'?{desired_years:[...years].sort((a,b)=>b-a).slice(0,20),desired_years_total:years.size,desired_years_truncated:years.size>20}:{})}))};
};

export class TeamCatalog {
  constructor(db,actor,{cursor,now=Date.now}={}){this.db=db;this.actor=actor;this.cursor=cursor;this.now=now;}
  scope(resource,teamId=''){return this.actor.owner?`owner/catalog/${resource}/${teamId}`:`viewer/${this.actor.teamId}/catalog/${resource}/${teamId}`;}
  brandingColumns(){return `${teamColumns},CASE WHEN b.logo IS NOT NULL THEN '[]' ELSE ${sourceBrandingJSONSQL('t.id',null,String(this.now()))} END AS source_branding`;}
  async activeTeam(teamId){
    if(!this.actor.owner&&this.actor.teamId!==teamId)throw invalid('This team is unavailable.','team_forbidden',403);
    const row=await this.db.prepare(`SELECT ${teamColumns} ${teamsFrom} WHERE t.id=? AND ${visible}`).bind(teamId).first();
    if(!row)throw invalid('This team is unavailable.','not_found',404);return teamDTO(row);
  }
  async teams({limit=50,cursor=null,preferred_team_id=null}={}){
    limitValue(limit,100);const selection={catalog:'teams',team_id:this.actor.owner?null:this.actor.teamId},scope=this.scope('teams'),filter=this.actor.owner?'1':'t.id=?',params=this.actor.owner?[]:[this.actor.teamId];
    const revision=(await this.db.prepare('SELECT teams_revision AS revision FROM catalog_state WHERE id=1').first())?.revision??0;
    const position=cursor?continuation(await this.cursor.verify(cursor,{selection,revision,scope}),3):null;
    const page=position?` AND (COALESCE(p.kind,'own')>? OR(COALESCE(p.kind,'own')=? AND(t.name COLLATE NOCASE>? OR(t.name COLLATE NOCASE=? AND t.id>?))))`:'';
    const columns=this.brandingColumns(),requests=[this.db.prepare('SELECT teams_revision AS revision,branding_revision FROM catalog_state WHERE id=1'),this.db.prepare(`SELECT COUNT(*) total ${teamsFrom} WHERE ${visible} AND ${filter}`).bind(...params),this.db.prepare(`SELECT ${columns} ${teamsFrom} WHERE ${visible} AND ${filter}${page} ORDER BY COALESCE(p.kind,'own'),t.name COLLATE NOCASE,t.id LIMIT ?`).bind(...params,...(position?[position[0],position[0],position[1],position[1],position[2]]:[]),limit+1)];
    if(preferred_team_id)requests.push(this.db.prepare(`SELECT ${columns} ${teamsFrom} WHERE ${visible} AND ${filter} AND t.id=?`).bind(...params,preferred_team_id));
    const results=await this.db.batch(requests);if((results[0].results[0]?.revision??0)!==revision)throw invalid('The team catalog changed. Reload it.','cursor_restart',409);
    const rows=results[2].results,items=rows.slice(0,limit).map(teamDTO),last=items.at(-1),preferred=results[3]?.results[0];
    return {items,total:results[1].results[0].total,revision,branding_revision:results[0].results[0]?.branding_revision??0,next_cursor:rows.length>limit?await this.cursor.issue({selection,revision,scope,position:[last.kind,last.name,last.id]}):null,preferred_team:preferred?teamDTO(preferred):null};
  }
  async logo(teamId){
    if(!this.actor.owner&&this.actor.teamId!==teamId)throw invalid('This team is unavailable.','team_forbidden',403);
    const row=await this.db.prepare(`SELECT t.id AS team_id,p.club_id,b.logo,COALESCE(b.revision,0) AS revision ${teamsFrom} WHERE t.id=? AND ${visible}`).bind(teamId).first();
    if(!row)throw invalid('This team is unavailable.','not_found',404);
    if(row.logo!==null&&row.logo!==undefined){
      if(typeof row.logo!=='string'||row.logo.length>128000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(row.logo))throw invalid('This club image is unavailable.','image_invalid',422);
      return {...row,source:'owner'};
    }
    const query=sourceBrandingQuery({teamId,now:this.now()}),defaults=sourceBranding((await this.db.prepare(query.sql).bind(...query.params).all()).results);
    return {...row,logo:defaults.logo,source:defaults.logo?'provider':null};
  }
  async seasons(teamId,{limit=25,cursor=null,preferred_season_id=null}={}){
    await this.activeTeam(teamId);limitValue(limit,100);const selection={catalog:'seasons',team_id:teamId},scope=this.scope('seasons',teamId),revision=(await this.db.prepare('SELECT seasons_revision AS revision FROM team_catalog_state WHERE app_team_id=?').bind(teamId).first())?.revision??0;
    const position=cursor?continuation(await this.cursor.verify(cursor,{selection,revision,scope}),2):null;if(position&&!/^\d{4}$/.test(position[0]))throw invalid('Invalid season continuation.','cursor_invalid');
    const page=position?' AND (year<? OR(year=? AND id>?))':'',requests=[this.db.prepare(`SELECT COALESCE(c.seasons_revision,0) AS revision ${teamsFrom} LEFT JOIN team_catalog_state c ON c.app_team_id=t.id WHERE t.id=? AND ${visible}`).bind(teamId),this.db.prepare('SELECT COUNT(*) total FROM team_seasons WHERE app_team_id=?').bind(teamId),this.db.prepare(`SELECT id,year,start_day,end_day,include_june FROM team_seasons WHERE app_team_id=?${page} ORDER BY year DESC,id LIMIT ?`).bind(teamId,...(position?[Number(position[0]),Number(position[0]),position[1]]:[]),limit+1)];
    if(preferred_season_id)requests.push(this.db.prepare('SELECT id,year,start_day,end_day,include_june FROM team_seasons WHERE app_team_id=? AND id=?').bind(teamId,preferred_season_id));
    const results=await this.db.batch(requests);if(!results[0].results[0])throw invalid('This team is unavailable.','not_found',404);if(results[0].results[0].revision!==revision)throw invalid('The season catalog changed. Reload it.','cursor_restart',409);
    const rows=results[2].results,items=rows.slice(0,limit).map(seasonDTO),last=items.at(-1),preferred=results[3]?.results[0];
    return {team_id:teamId,items,total:results[1].results[0].total,revision,next_cursor:rows.length>limit?await this.cursor.issue({selection,revision,scope,position:[String(last.year),last.id]}):null,preferred_season:preferred?seasonDTO(preferred):null};
  }
  async connections(teamId,{limit=100,cursor=null}={}){
    if(!this.actor.owner)throw invalid('Sign in as the owner to view source connections.','owner_required',403);
    await this.activeTeam(teamId);limitValue(limit,100);const selection={catalog:'connections',team_id:teamId},scope=this.scope('connections',teamId),revision=(await this.db.prepare('SELECT attachments_revision AS revision FROM team_catalog_state WHERE app_team_id=?').bind(teamId).first())?.revision??0,position=cursor?continuation(await this.cursor.verify(cursor,{selection,revision,scope}),1):[''];
    const rows=await this.db.batch([
      this.db.prepare(`SELECT COALESCE(c.attachments_revision,0) AS revision ${teamsFrom} LEFT JOIN team_catalog_state c ON c.app_team_id=t.id WHERE t.id=? AND ${visible}`).bind(teamId),
      this.db.prepare('SELECT COUNT(*) total FROM team_source_connections WHERE app_team_id=?').bind(teamId),
      this.db.prepare(`SELECT r.id,r.id AS connection_id,r.app_team_id,r.source_team_id,r.account_id,r.scope_mode,r.scope_origin,r.active,r.generation,r.input_revision,r.reconciled_revision,r.last_reconciled_at,t.provider,t.name,(SELECT COUNT(*) FROM connection_roster_evidence imported WHERE imported.connection_id=r.id AND imported.basis='imported_snapshot') AS imported_roster_total,(SELECT COUNT(*) ${pendingRosterFrom('r')}) AS pending_roster_total,(SELECT json_group_array(json_object('source_player_id',source_player_id,'name',name)) FROM(SELECT p.id AS source_player_id,substr(p.name,1,100) AS name ${pendingRosterFrom('r')} ORDER BY p.name COLLATE NOCASE,p.id LIMIT ${PENDING_ROSTER_LIMIT})) AS pending_roster_json,(SELECT COUNT(DISTINCT evidence.source_player_id) ${rosterReviewFrom('r')}) AS roster_review_total,(SELECT json_group_array(json_object('source_player_id',source_player_id,'name',name)) FROM(SELECT evidence.source_player_id,substr(MIN(evidence.name),1,100) AS name ${rosterReviewFrom('r')} GROUP BY evidence.source_player_id ORDER BY name COLLATE NOCASE,evidence.source_player_id LIMIT ${PENDING_ROSTER_LIMIT})) AS roster_review_json,(SELECT json_group_array(json_object('state',state,'reason',reason,'count',count,'desired_year',desired_year)) FROM(SELECT e.state,CASE WHEN e.state='excluded' THEN ${excludedReason('r')} ELSE e.state END AS reason,${desiredYearSQL} AS desired_year,COUNT(*) AS count FROM connection_event_resolutions e WHERE e.connection_id=r.id AND e.generation=r.generation AND e.state IN('pending','conflict','excluded') GROUP BY e.state,reason,desired_year)) AS evidence_json,CASE WHEN r.account_id IS NULL THEN 'public' WHEN a.active<>1 THEN 'disconnected' WHEN a.generation<>c.account_generation OR c.account_id IS NULL THEN 'reconnect_required' WHEN c.expires_at IS NOT NULL AND c.expires_at<=? THEN 'expired' ELSE 'connected' END AS authorization_state,(SELECT json_group_array(json_object('id',s.id,'year',s.year,'active',m.active,'excluded',m.excluded,'basis',m.basis,'attachment_id',m.attachment_id)) FROM team_connection_seasons m JOIN team_seasons s ON s.id=m.team_season_id WHERE m.connection_id=r.id) AS seasons_json FROM team_source_connections r JOIN source_teams t ON t.id=r.source_team_id LEFT JOIN provider_accounts a ON a.id=r.account_id LEFT JOIN security_account_credentials c ON c.account_id=a.id WHERE r.app_team_id=? AND r.id>? ORDER BY r.id LIMIT ?`).bind(this.now(),teamId,position[0],limit+1),
    ]);
    if(!rows[0].results[0])throw invalid('This team is unavailable.','not_found',404);if(rows[0].results[0].revision!==revision)throw invalid('The connection catalog changed. Reload it.','cursor_restart',409);
    const results=rows[2].results,items=results.slice(0,limit).map(({seasons_json,pending_roster_json,pending_roster_total,roster_review_json,roster_review_total,evidence_json,...row})=>{
      const seasons=JSON.parse(seasons_json||'[]').map(season=>({...season,active:!!season.active,excluded:!!season.excluded})).sort((a,b)=>b.year-a.year||a.id.localeCompare(b.id)),pending_roster=rosterModel(pending_roster_total,JSON.parse(pending_roster_json||'[]')),roster_review=rosterModel(roster_review_total,JSON.parse(roster_review_json||'[]')),evidence=evidenceModel(JSON.parse(evidence_json||'[]')),reconciliation_pending=row.active===1&&row.input_revision>row.reconciled_revision;
      const state=!row.active?'inactive':evidence.needs_review_events||roster_review.total?'needs_review':evidence.pending_events||evidence.conflicting_events||pending_roster.total?'needs_evidence':reconciliation_pending?'discovering':seasons.some(season=>season.active&&!season.excluded)?(row.imported_roster_total?'imported_history':'resolved'):evidence.excluded_events?'restricted':'awaiting_dates';
      return {...row,active:!!row.active,seasons,reconciliation_pending,pending_roster,roster_review,season_resolution:{state,...evidence}};
    }),last=items.at(-1);
    return {team_id:teamId,items,total:rows[1].results[0].total,revision,next_cursor:results.length>limit?await this.cursor.issue({selection,revision,scope,position:[last.id]}):null};
  }
  async pendingEvidence(teamId){
    if(!this.actor.owner)throw invalid('Sign in as the owner to view source evidence.','owner_required',403);
    await this.activeTeam(teamId);
    const roster=`FROM team_source_connections r JOIN source_roster_memberships m ON m.source_team_id=r.source_team_id JOIN source_players p ON p.id=m.source_player_id WHERE r.app_team_id=? AND ${pendingRosterWhere('r')}`;
    const review=`FROM team_source_connections r JOIN connection_roster_evidence evidence ON evidence.connection_id=r.id WHERE r.app_team_id=? AND r.active=1 AND evidence.basis='dated_roster' AND evidence.certainty='preserved_uncertain'`;
    const result=await this.db.batch([
      this.db.prepare(`SELECT COUNT(*) AS total,(SELECT COUNT(*) FROM connection_roster_evidence evidence JOIN team_source_connections root ON root.id=evidence.connection_id WHERE root.app_team_id=? AND root.active=1 AND evidence.basis='imported_snapshot') AS imported_roster_total ${roster}`).bind(teamId,teamId),
      this.db.prepare(`SELECT r.id AS connection_id,t.provider,substr(t.name,1,100) AS source_name,p.id AS source_player_id,substr(p.name,1,100) AS name FROM team_source_connections r JOIN source_teams t ON t.id=r.source_team_id JOIN source_roster_memberships m ON m.source_team_id=r.source_team_id JOIN source_players p ON p.id=m.source_player_id WHERE r.app_team_id=? AND ${pendingRosterWhere('r')} ORDER BY p.name COLLATE NOCASE,p.id,r.id LIMIT ${PENDING_ROSTER_LIMIT}`).bind(teamId),
      this.db.prepare(`SELECT e.state,CASE WHEN e.state='excluded' THEN ${excludedReason('r')} ELSE e.state END AS reason,${desiredYearSQL} AS desired_year,COUNT(*) AS count FROM team_source_connections r JOIN connection_event_resolutions e ON e.connection_id=r.id AND e.generation=r.generation WHERE r.app_team_id=? AND r.active=1 AND e.state IN('pending','conflict','excluded') GROUP BY e.state,reason,desired_year`).bind(teamId),
      this.db.prepare(`SELECT COUNT(*) AS total FROM(SELECT r.id,evidence.source_player_id ${review} GROUP BY r.id,evidence.source_player_id)`).bind(teamId),
      this.db.prepare(`SELECT r.id AS connection_id,(SELECT t.provider FROM source_teams t WHERE t.id=r.source_team_id) AS provider,(SELECT substr(t.name,1,100) FROM source_teams t WHERE t.id=r.source_team_id) AS source_name,evidence.source_player_id,substr(MIN(evidence.name),1,100) AS name ${review} GROUP BY r.id,evidence.source_player_id ORDER BY name COLLATE NOCASE,evidence.source_player_id,r.id LIMIT ${PENDING_ROSTER_LIMIT}`).bind(teamId),
    ]);
    return {imported_roster_total:result[0].results[0].imported_roster_total,pending_roster:rosterModel(result[0].results[0].total,result[1].results),evidence:evidenceModel(result[2].results),roster_review:rosterModel(result[3].results[0].total,result[4].results)};
  }
  async attachments(teamId,{limit=100,cursor=null}={}){
    if(!this.actor.owner)throw invalid('Sign in as the owner to view source attachments.','owner_required',403);
    await this.activeTeam(teamId);limitValue(limit,100);const selection={catalog:'attachments',team_id:teamId},scope=this.scope('attachments',teamId),revision=(await this.db.prepare('SELECT attachments_revision AS revision FROM team_catalog_state WHERE app_team_id=?').bind(teamId).first())?.revision??0,position=cursor?continuation(await this.cursor.verify(cursor,{selection,revision,scope}),1):[''];
    const rows=await this.db.batch([this.db.prepare(`SELECT COALESCE(c.attachments_revision,0) AS revision ${teamsFrom} LEFT JOIN team_catalog_state c ON c.app_team_id=t.id WHERE t.id=? AND ${visible}`).bind(teamId),this.db.prepare('SELECT COUNT(*) total FROM team_source_attachments WHERE app_team_id=?').bind(teamId),this.db.prepare(`SELECT a.id,a.source_team_id,a.account_id,a.team_season_id,a.active,t.provider,t.name,CASE WHEN a.account_id IS NULL THEN 'public' WHEN c.active<>1 THEN 'disconnected' WHEN c.generation<>s.account_generation OR s.account_id IS NULL THEN 'reconnect_required' WHEN s.expires_at IS NOT NULL AND s.expires_at<=? THEN 'expired' ELSE 'connected' END authorization_state FROM team_source_attachments a JOIN source_teams t ON t.id=a.source_team_id LEFT JOIN provider_accounts c ON c.id=a.account_id LEFT JOIN security_account_credentials s ON s.account_id=c.id WHERE a.app_team_id=? AND a.id>? ORDER BY a.id LIMIT ?`).bind(this.now(),teamId,position[0],limit+1)]);
    if(!rows[0].results[0])throw invalid('This team is unavailable.','not_found',404);if(rows[0].results[0].revision!==revision)throw invalid('The attachment catalog changed. Reload it.','cursor_restart',409);
    const results=rows[2].results,items=results.slice(0,limit),last=items.at(-1);return {team_id:teamId,items,total:rows[1].results[0].total,revision,next_cursor:results.length>limit?await this.cursor.issue({selection,revision,scope,position:[last.id]}):null};
  }
}
