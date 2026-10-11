import {invalid} from '../read-model/selection.js';
import {canonicalRuleKeySQL,inclusionResourceSQL,inclusionRuleSQL,inclusionConflictSQL,inclusionSQL} from '../read-model/inclusion.js';

const kinds=['category','competition','division','event'];
const revision=value=>{if(!Number.isSafeInteger(value)||value<0)throw invalid('Reload Included games before saving.','revision_invalid');return value;};
const requestedSQL=kind=>canonicalRuleKeySQL(kind,"json_extract(j.value,'$.resource_key')");
const resolvedSQL=`CASE json_extract(j.value,'$.kind') ${kinds.map(kind=>`WHEN '${kind}' THEN ${requestedSQL(kind)}`).join(' ')} END`;
const orderTime="COALESCE(e.starts_at,e.local_day,'9999-12-31')";

/** Choices and writes share canonical identities; a save covers every dirty checkbox. */
export async function inclusionChoices(features,teamId,seasonId,{limit=50,cursor:token=null}={}) {
  const season=await features.season(teamId,seasonId);
  if(!Number.isInteger(limit)||limit<1||limit>100)throw invalid('Invalid page size.');
  const state=await features.db.prepare('SELECT content_revision FROM team_read_state WHERE app_team_id=?').bind(teamId).first();
  const selection={team_id:teamId,team_season_id:seasonId,kind:'inclusion'},scope=`owner/inclusion/${teamId}`;
  const position=token?await features.cursor.verify(token,{selection,scope,revision:state.content_revision}):null;
  if(position&&(!Array.isArray(position)||position.length!==3||position.some(v=>typeof v!=='string')))throw invalid('Invalid game continuation.');
  const comp=inclusionResourceSQL('competition'),division=inclusionResourceSQL('division');
  const selected=`WITH selected AS(SELECT e.*,COALESCE(${comp},'') competition_key,${division} division_key,${orderTime} order_time,COUNT(*) OVER(PARTITION BY ${comp}) competition_total,COUNT(*) OVER() selection_total FROM team_events e WHERE e.app_team_id=? AND e.team_season_id=? AND e.type='game' AND e.conditional=0) `;
  const rows=await features.db.batch([
    features.db.prepare('SELECT s.include_june,COALESCE(c.revision,0) revision,r.content_revision FROM team_seasons s JOIN team_read_state r ON r.app_team_id=s.app_team_id LEFT JOIN season_controls c ON c.team_season_id=s.id WHERE s.id=? AND s.app_team_id=?').bind(seasonId,teamId),
    features.db.prepare('SELECT COUNT(*) total FROM team_events WHERE app_team_id=? AND team_season_id=? AND type=\'game\' AND conditional=0').bind(teamId,seasonId),
    features.db.prepare(selected+`SELECT e.event_id id,e.competition_key,e.division_key,e.starts_at,e.local_day,e.home_name,e.away_name,e.own_side,e.title,e.status,e.identity_conflict,e.competition_total,e.order_time,COALESCE((SELECT name FROM canonical_competitions WHERE id=e.competition_key),'Other games') competition_name,${inclusionResourceSQL('category')} competition_kind,COALESCE((SELECT name FROM canonical_divisions WHERE id=e.division_key),'') division_name,${inclusionRuleSQL('category')} category_rule,${inclusionRuleSQL('competition')} competition_rule,${inclusionRuleSQL('division')} division_rule,${inclusionRuleSQL('event')} event_rule,${inclusionConflictSQL('competition')} competition_conflict,${inclusionConflictSQL('division')} division_conflict,${inclusionConflictSQL('event')} event_conflict,(${inclusionSQL()}) included FROM selected e ${position?'WHERE e.competition_key>? OR(e.competition_key=? AND (e.order_time>? OR(e.order_time=? AND e.event_id>?)))':''} ORDER BY e.competition_key,e.order_time,e.event_id LIMIT ?`).bind(teamId,seasonId,...(position?[position[0],position[0],position[1],position[1],position[2]]:[]),limit+1),
    features.db.prepare('SELECT kind,resource_key,included,revision FROM season_inclusion_rules WHERE team_season_id=? ORDER BY kind,resource_key LIMIT 100').bind(seasonId),
    features.db.prepare('SELECT COUNT(*) total FROM season_inclusion_rules WHERE team_season_id=?').bind(seasonId),
    features.db.prepare(`SELECT ${inclusionResourceSQL('category')} category_key,COUNT(*) total,${inclusionRuleSQL('category')} category_rule FROM team_events e WHERE e.app_team_id=? AND e.team_season_id=? AND e.type='game' AND e.conditional=0 GROUP BY category_key ORDER BY category_key`).bind(teamId,seasonId),
  ]);
  const current=rows[0].results[0];
  if(current.content_revision!==state.content_revision)throw invalid('Game choices changed. Reload this selection.','cursor_restart',409);
  const items=rows[2].results.slice(0,limit),groups=new Map();
  for(const row of rows[5].results){const label=row.category_key==='tournament'?'Tournaments':row.category_key==='league'?'Leagues':'Other games';groups.set(label,{id:row.category_key,kind:'category',label,total:row.total,included:row.category_rule==null?true:!!row.category_rule,override:row.category_rule!==null,competitions:[]});}
  for(const row of items){
    const label=row.competition_kind==='tournament'?'Tournaments':row.competition_kind==='league'?'Leagues':'Other games';
    const group=groups.get(label);
    let competition=group.competitions.find(c=>c.id===row.competition_key);
    if(!competition){competition={id:row.competition_key,name:row.competition_name,total:row.competition_total,included:row.competition_rule==null?group.included:!!row.competition_rule,override:row.competition_rule!==null,conflict:!!row.competition_conflict,selectable:!!row.competition_key,events:[]};group.competitions.push(competition);}
    const opponent=row.own_side==='home'?row.away_name:row.own_side==='away'?row.home_name:null;
    competition.events.push({id:row.id,label:[row.local_day||row.starts_at?.slice(0,10),opponent||row.title||'Game'].filter(Boolean).join(' · '),included:!!row.included,override:row.event_rule!==null,division_id:row.division_key,division_name:row.division_name,division_included:row.division_rule==null?competition.included:!!row.division_rule,conflict:!!(row.event_conflict||row.division_conflict||row.competition_conflict),note:row.identity_conflict?'Identity needs review':row.event_conflict||row.division_conflict||row.competition_conflict?'Merged choices need review':''});
  }
  const last=items.at(-1),next=rows[2].results.length>limit?await features.cursor.issue({selection,scope,revision:current.content_revision,position:[last.competition_key,last.order_time,last.id]}):null;
  return {team_id:teamId,team_season_id:seasonId,include_june:!!current.include_june,revision:current.revision,content_revision:current.content_revision,groups:[...groups.values()],total:rows[1].results[0].total,next_cursor:next,rules:rows[3].results.map(r=>({...r,included:!!r.included})),rules_total:rows[4].results[0].total};
}

export async function saveInclusionBatch(features,teamId,seasonId,command) {
  features.owner();await features.season(teamId,seasonId);
  const expected=revision(command?.revision),content=revision(command?.content_revision);
  if(command.include_june!==undefined&&typeof command.include_june!=='boolean')throw invalid('Choose whether to include June.');
  const rules=command.rules??[];
  if(!Array.isArray(rules)||rules.length>100)throw invalid('Save at most 100 changed choices at a time.','selection_limit');
  const seen=new Set();
  for(const row of rules){
    if(!row||!kinds.includes(row.kind)||typeof row.resource_key!=='string'||!row.resource_key.trim()||row.resource_key.length>240||!(typeof row.included==='boolean'||row.included===null))throw invalid('Choose a valid game selection.');
    if(row.kind==='category'&&!['league','tournament','other'].includes(row.resource_key))throw invalid('Choose a valid game category.');
    const key=row.kind+'/'+row.resource_key;if(seen.has(key))throw invalid('A choice was repeated.');seen.add(key);
  }
  if(!rules.length&&command.include_june===undefined)return {ok:true,revision:expected,content_revision:content};
  const encoded=JSON.stringify(rules.map(r=>({kind:r.kind,resource_key:r.resource_key,included:r.included==null?null:Number(r.included)})));
  const normalized=(await features.db.prepare(`SELECT json_extract(j.value,'$.kind') kind,${resolvedSQL} resource_key,json_extract(j.value,'$.included') included FROM json_each(?) j`).bind(encoded).all()).results;
  const canonicalSeen=new Set();for(const row of normalized){const key=row.kind+'/'+row.resource_key;if(canonicalSeen.has(key))throw invalid('Merged choices need one decision before saving.','inclusion_conflict');canonicalSeen.add(key);}
  const normalizedJSON=JSON.stringify(normalized);
  const inSeason=kind=>`EXISTS(SELECT 1 FROM team_events e WHERE e.app_team_id=? AND e.team_season_id=? AND e.type='game' AND e.conditional=0 AND ${inclusionResourceSQL(kind)}=json_extract(j.value,'$.resource_key'))`;
  const allowed=`NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT(CASE json_extract(j.value,'$.kind') ${kinds.map(k=>`WHEN '${k}' THEN ${inSeason(k)}`).join(' ')} ELSE 0 END))`;
  const condition=`COALESCE((SELECT revision FROM season_controls WHERE team_season_id=?),0)=? AND (SELECT content_revision FROM team_read_state WHERE app_team_id=?)=? AND ${allowed}`;
  const params=[seasonId,expected,teamId,content,normalizedJSON,...kinds.flatMap(()=>[teamId,seasonId])];
  const matching=`EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.kind')=season_inclusion_rules.kind AND CASE season_inclusion_rules.kind ${kinds.map(k=>`WHEN '${k}' THEN ${canonicalRuleKeySQL(k,'season_inclusion_rules.resource_key')}`).join(' ')} END=json_extract(j.value,'$.resource_key'))`;
  const statements=[
    features.db.prepare(`DELETE FROM season_inclusion_rules WHERE team_season_id=? AND ${matching}`).bind(seasonId,normalizedJSON),
    features.db.prepare(`INSERT INTO season_inclusion_rules(team_season_id,kind,resource_key,included,revision) SELECT ?,json_extract(j.value,'$.kind'),json_extract(j.value,'$.resource_key'),json_extract(j.value,'$.included'),? FROM json_each(?) j WHERE json_extract(j.value,'$.included') IS NOT NULL`).bind(seasonId,expected+1,normalizedJSON),
    features.db.prepare('INSERT INTO season_controls VALUES(?,1) ON CONFLICT(team_season_id) DO UPDATE SET revision=revision+1 RETURNING revision').bind(seasonId),
  ];
  if(command.include_june!==undefined)statements.push(features.db.prepare('UPDATE team_seasons SET include_june=? WHERE id=?').bind(Number(command.include_june),seasonId));
  statements.push(features.db.prepare('UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=? RETURNING content_revision').bind(teamId));
  const result=await features.writeTeam(teamId,condition,params,statements);
  return {ok:true,revision:result[2].results[0].revision,content_revision:result.at(-1).results[0].content_revision};
}

export async function resetInclusion(features,teamId,seasonId,command) {
  features.owner();await features.season(teamId,seasonId);
  const expected=revision(command?.revision),content=revision(command?.content_revision);
  const result=await features.writeTeam(teamId,'COALESCE((SELECT revision FROM season_controls WHERE team_season_id=?),0)=? AND (SELECT content_revision FROM team_read_state WHERE app_team_id=?)=?',[seasonId,expected,teamId,content],[
    features.db.prepare('DELETE FROM season_inclusion_rules WHERE team_season_id=?').bind(seasonId),
    features.db.prepare('UPDATE team_seasons SET include_june=1 WHERE id=?').bind(seasonId),
    features.db.prepare('INSERT INTO season_controls VALUES(?,1) ON CONFLICT(team_season_id) DO UPDATE SET revision=revision+1 RETURNING revision').bind(seasonId),
    features.db.prepare('UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=? RETURNING content_revision').bind(teamId),
  ]);
  return {ok:true,include_june:true,revision:result[2].results[0].revision,content_revision:result[3].results[0].content_revision};
}
