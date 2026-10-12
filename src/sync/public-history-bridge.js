// New collection authority uses a fresh, exact provider bridge. Durable saved
// identity remains useful after this short-lived fetch proof expires.
const all=parts=>parts.length===1?`(${parts[0]})`:`(${all(parts.slice(0,Math.ceil(parts.length/2)))} AND ${all(parts.slice(Math.ceil(parts.length/2)))})`;
export function publicHistoryBridgeRows(nowSQL){
 const proof="CASE WHEN json_valid(link.evidence) THEN link.evidence ELSE '{}' END";
 const current="CASE WHEN json_valid(lv.evidence) THEN lv.evidence ELSE '{}' END";
 const p=key=>`json_extract(${proof},'$.${key}')`,live=key=>`json_extract(${current},'$.proof.${key}')`;
 const time=value=>`((julianday(${value})-2440587.5)*86400000.0)`;
 const object="CASE WHEN observation.type='object' THEN observation.value ELSE '{}' END";
 const o=key=>`json_extract(${object},'$.${key}')`;
 const params=`CASE WHEN json_valid(${o('params')}) THEN ${o('params')} ELSE '{}' END`;
 const endpoint=(name,season=false)=>`EXISTS(SELECT 1 FROM json_each(${proof},'$.observations') observation WHERE ${o('endpoint')}='https://gotsportlive-api.azurewebsites.net/api/clubapi/${name}' AND CAST(json_extract(${params},'$.ClubID') AS TEXT)=CAST(${p('club')} AS TEXT)${season?` AND CAST(json_extract(${params},'$.SeasonID') AS TEXT)=CAST(${p('season')} AS TEXT)`:''})`;
 const clauses=[
  "link.kind='provider_external_key'","gs.provider='gotsport'","lv.provider='live'","gs.scope='public'","lv.scope='public'","gs.account_id IS NULL","lv.account_id IS NULL","gs.provenance='provider'","lv.provenance='provider'",
  `CAST(${p('team_id')} AS TEXT)=gs.native_id`,`CAST(${p('live_team_id')} AS TEXT)=lv.native_id`,`CAST(${p('item_id')} AS TEXT)=lv.native_id`,`CAST(${p('external_key')} AS TEXT)=gs.native_id`,
  `${p('external_source_name')}='GotSport'`,`(${p('external_source_id')}=6 OR ${p('external_source_id')}='6')`,`json_type(${proof},'$.default_season')='true'`,
  `length(CAST(${p('club')} AS TEXT))>0`,`length(CAST(${p('season')} AS TEXT))>0`,`length(CAST(${p('season_name')} AS TEXT))>0`,
  `${time(p('expires_at'))}>bridge_clock.now`,`${time(p('verified_at'))}<=bridge_clock.now+60000`,
  `json_type(${proof},'$.observations')='array'`,`json_array_length(${proof},'$.observations') BETWEEN 2 AND 64`,
  endpoint('initclubteams'),endpoint('getteams',true),
  `NOT EXISTS(SELECT 1 FROM json_each(${proof},'$.observations') observation WHERE observation.type<>'object' OR COALESCE(${o('status')}=200,0)=0 OR json_type(${object},'$.hash') IS NOT 'text' OR length(${o('hash')})<>64 OR lower(${o('hash')}) GLOB '*[^0-9a-f]*' OR ${time(o('at'))} IS NULL OR ${time(o('at'))}<bridge_clock.now-21600000 OR ${time(o('at'))}>bridge_clock.now+60000)`,
  ...['team_id','live_team_id','club','season','season_name'].map(key=>`CAST(${live(key)} AS TEXT)=CAST(${p(key)} AS TEXT)`),
 ];
 return `SELECT link.a,link.b,gs.id AS gs_id,lv.id AS live_id,CAST(${p('club')} AS TEXT) AS club,CAST(${p('season')} AS TEXT) AS season,CAST(${p('season_name')} AS TEXT) AS season_name,link.evidence FROM source_team_links link JOIN source_teams gs ON (gs.id=link.a OR gs.id=link.b) AND gs.provider='gotsport' JOIN source_teams lv ON (lv.id=link.a OR lv.id=link.b) AND lv.provider='live' CROSS JOIN(SELECT ${nowSQL} AS now) bridge_clock WHERE ${all(clauses)}`;
}
