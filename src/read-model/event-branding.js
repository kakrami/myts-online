import {invalid} from './selection.js';
import {publicSourceBrandingJSONSQL,sourceBrandingJSONSQL,sourceBranding} from './branding.js';

/** Add only presentation metadata to an already authorized bounded event page. */
export async function brandEventRows(db,actor,rows,{teamId=null,seasonId=null,now=Date.now()}={}){
  if(!Number.isFinite(now)||!Array.isArray(rows)||rows.length>100)throw invalid('Invalid event presentation page.');
  if(!rows.length)return rows;
  const requested=rows.map(row=>({id:row.id,app_team_id:row.app_team_id??teamId,team_season_id:row.team_season_id??seasonId,home_id:row.home_id??null,away_id:row.away_id??null,own_side:row.own_side??null}));
  if(requested.some(r=>!r.app_team_id||actor?.owner!==true&&!(actor?.owner===false&&actor.teamId===r.app_team_id)))throw invalid('This team is unavailable.','team_forbidden',403);
  const nativeId=expression=>`CASE WHEN ${expression} GLOB 'gotsport/public/*' OR ${expression} GLOB 'live/public/*' THEN ${expression} END`;
  const home=`COALESCE(r.home_id,s.home_source_team_id)`,away=`COALESCE(r.away_id,s.away_source_team_id)`;
  const sql=`WITH requested AS(SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.app_team_id') AS app_team_id,json_extract(value,'$.team_season_id') AS team_season_id,json_extract(value,'$.home_id') AS home_id,json_extract(value,'$.away_id') AS away_id,json_extract(value,'$.own_side') AS own_side FROM json_each(?)),contexts AS MATERIALIZED(SELECT DISTINCT app_team_id,team_season_id FROM requested),owned AS MATERIALIZED(SELECT c.app_team_id,c.team_season_id,p.club_id,COALESCE(b.revision,0) AS logo_revision,b.logo IS NOT NULL AS owner_logo_available,${sourceBrandingJSONSQL('c.app_team_id','c.team_season_id',String(now))} AS own_branding FROM contexts c LEFT JOIN team_profiles p ON p.app_team_id=c.app_team_id AND p.active=1 LEFT JOIN club_branding b ON b.club_id=p.club_id) SELECT r.id,r.app_team_id,r.team_season_id,s.provider,COALESCE(r.own_side,t.own_side) AS own_side,${nativeId(home)} AS public_home_id,${nativeId(away)} AS public_away_id,${home} IS NOT NULL AS home_known,${away} IS NOT NULL AS away_known,${publicSourceBrandingJSONSQL(home)} AS home_branding,${publicSourceBrandingJSONSQL(away)} AS away_branding,o.club_id,o.logo_revision,o.owner_logo_available,o.own_branding FROM requested r LEFT JOIN team_events t ON t.app_team_id=r.app_team_id AND t.team_season_id=r.team_season_id AND t.event_id=r.id LEFT JOIN source_events s ON s.id=t.schedule_source_id JOIN owned o ON o.app_team_id=r.app_team_id AND o.team_season_id IS r.team_season_id`;
  const details=(await db.prepare(sql).bind(JSON.stringify(requested)).all()).results;
  const key=r=>JSON.stringify([r.id,r.app_team_id,r.team_season_id]),map=new Map(details.map(row=>[key(row),row]));
  return rows.map((row,index)=>{
    const detail=map.get(key(requested[index]));if(!detail)return row;
    const native=sourceBranding(detail.own_branding),own={logo:detail.owner_logo_available?null:native.logo,logo_ref:detail.owner_logo_available?{team_id:detail.app_team_id,club_id:detail.club_id,revision:detail.logo_revision}:null};
    const homeOwn=detail.own_side==='home',awayOwn=detail.own_side==='away';
    const {home_branding,away_branding,...safe}=row;
    return {...safe,source_label:({gotsport:'GotSport',live:'GotSport Live',teamsnap:'TeamSnap',trace:'Trace'})[row.provider??detail.provider]??row.source_label??null,home:{...row.home,id:homeOwn?detail.app_team_id:detail.public_home_id,name:row.home?.name??row.home_name,confirmed:!row.conditional&&(homeOwn||!!detail.home_known),...(homeOwn?own:{logo:sourceBranding(detail.home_branding).logo,logo_ref:null})},away:{...row.away,id:awayOwn?detail.app_team_id:detail.public_away_id,name:row.away?.name??row.away_name,confirmed:!row.conditional&&(awayOwn||!!detail.away_known),...(awayOwn?own:{logo:sourceBranding(detail.away_branding).logo,logo_ref:null})}};
  });
}
