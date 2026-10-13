const fail=(message,code='identity_scope',status=403)=>Object.assign(new Error(message),{code,status});
const need=(v,m,c,s)=>{if(!v)throw fail(m,c,s);return v;};
const roots=`WITH roots AS(SELECT source_team_id AS id FROM team_source_attachments WHERE app_team_id=? AND team_season_id=? AND active=1),sources AS(SELECT id FROM roots UNION SELECT a FROM source_team_links WHERE b IN(SELECT id FROM roots) UNION SELECT b FROM source_team_links WHERE a IN(SELECT id FROM roots))`;

export async function identityQuery(repo,teamId,seasonId,kind,{sourceIds=null,entityId=null,after='',limit=50}={}) {
  need(kind==='player'||kind==='event','Choose player or event identity.','invalid_request',400);
  need(Number.isSafeInteger(limit)&&limit>=1&&limit<=101,'Invalid identity page size.','invalid_request',400);
  const team=await repo.team(teamId);seasonId||=team.season_id;
  need(await repo.db.prepare('SELECT id FROM team_seasons WHERE id=? AND app_team_id=?').bind(seasonId,teamId).first(),'The season is outside this team.');
  need(!await repo.db.prepare("SELECT 1 FROM team_lifecycle WHERE team_id=? AND state IN('deleting','deleted')").bind(teamId).first(),'The team is being removed.');
  const player=kind==='player',alias=player?'p':'e',table=player?'source_players':'source_events',column=player?'player_id':'event_id',sourceColumn=player?'source_player_id':'source_event_id';
  const visible=player?`p.id IN(SELECT source_player_id FROM source_roster_memberships WHERE source_team_id IN(SELECT id FROM sources) AND active=1) OR p.id IN(SELECT m.source_player_id FROM source_game_members m JOIN source_event_teams t ON t.source_event_id=m.source_event_id AND t.source_team_id=m.source_team_id AND t.side=m.side JOIN event_source_links el ON el.source_event_id=m.source_event_id JOIN canonical_event_ids ec ON ec.input_id=el.event_id JOIN team_events te ON te.event_id=ec.canonical_id AND te.app_team_id=? AND te.team_season_id=? WHERE m.source_team_id IN(SELECT id FROM sources) AND m.dummy=0)`:`e.id IN(SELECT t.source_event_id FROM source_event_teams t JOIN event_source_links el ON el.source_event_id=t.source_event_id JOIN canonical_event_ids ec ON ec.input_id=el.event_id JOIN team_events te ON te.event_id=ec.canonical_id AND te.app_team_id=? AND te.team_season_id=? WHERE t.source_team_id IN(SELECT id FROM sources))`;
  const filters=[`(${visible})`,"NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=? AND state IN('deleting','deleted'))"],params=[teamId,seasonId,teamId,seasonId,teamId];
  if(sourceIds){need(Array.isArray(sourceIds)&&sourceIds.length<=4&&sourceIds.every(s=>typeof s==='string'&&s.length<=400),'Invalid selected identity records.','invalid_request',400);filters.push(`${alias}.id IN(SELECT value FROM json_each(?))`);params.push(JSON.stringify(sourceIds));}
  if(entityId){filters.push('c.canonical_id=?');params.push(entityId);}
  const fields=player?'p.name,p.jersey':'e.starts_at,e.local_day,e.type,e.status,e.conditional,e.home_label,e.away_label,e.home_score,e.away_score';
  const from=`FROM ${table} ${alias} LEFT JOIN ${kind}_source_links l ON l.${sourceColumn}=${alias}.id LEFT JOIN canonical_${kind}_ids c ON c.input_id=l.${column} WHERE ${filters.join(' AND ')}`;
  return {seasonId,count:{sql:`${roots} SELECT COUNT(*) AS total ${from}`,params},page:{sql:`${roots} SELECT ${alias}.id,${alias}.provider,${alias}.scope,${alias}.native_id,${alias}.provenance,${fields},c.canonical_id,l.reason,l.revision AS link_revision,(SELECT COUNT(*) FROM ${kind}_source_links x JOIN canonical_${kind}_ids y ON y.input_id=x.${column} WHERE y.canonical_id=c.canonical_id) AS linked_total ${from} AND ${alias}.id>? ORDER BY ${alias}.id LIMIT ?`,params:[...params,after,limit]}};
}

export async function selectedIdentitySources(repo,teamId,seasonId,kind,sourceIds) {
  const query=await identityQuery(repo,teamId,seasonId,kind,{sourceIds,limit:4});
  const rows=(await repo.db.prepare(query.page.sql).bind(...query.page.params).all()).results;
  need(rows.length===sourceIds.length,'A selected source record is outside this team.');
  return sourceIds.map(id=>rows.find(r=>r.id===id));
}

export async function identityPage(repo,{teamId,seasonId=null,kind,entityId=null,after='',limit=50}) {
  need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'Invalid identity page size.','invalid_request',400);const query=await identityQuery(repo,teamId,seasonId,kind,{entityId,after,limit:limit+1});
  const result=await repo.db.batch([repo.db.prepare('SELECT mutation_revision FROM domain_installation WHERE id=1'),repo.db.prepare(query.count.sql).bind(...query.count.params),repo.db.prepare(query.page.sql).bind(...query.page.params)]);
  const rows=result[2].results,items=rows.slice(0,limit);
  return {team_id:teamId,team_season_id:query.seasonId,kind,revision:result[0].results[0].mutation_revision,total:result[1].results[0].total,items,after:rows.length>limit?items.at(-1).id:null};
}
