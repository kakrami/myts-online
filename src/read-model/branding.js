import {invalid} from './selection.js';

// Verified GotSport native profile image/team_logo_url_full values and the
// original public asset route. This is an asset URL, never a provider API URL.
export function safeSourceLogo(value) {
  if(typeof value!=='string'||!value.trim()||value.length>2048)return null;
  try {
    const u=new URL(value,'https://system.gotsport.com');
    if(u.protocol!=='https:'||u.hostname!=='system.gotsport.com'||u.port||u.username||u.password||u.hash||!/^\/system\/(?:organizations|teams|events)\/logos\/(?:[0-9]+\/)+(?:icon|full|original)\/[^/]+$/.test(u.pathname))return null;
    if(u.pathname.split('/').at(-1).includes('/')||/%(?:2f|5c|00)/i.test(u.pathname))return null;
    // The observed query is an optional bare numeric cache timestamp. Tokens,
    // account identifiers and arbitrary request parameters are not image data.
    if(u.search&&!/^\?[0-9]{1,16}$/.test(u.search))return null;
    return u.href;
  }catch{return null;}
}

/** Bounded semantic rows; arguments are trusted SQL expressions, never input. */
export function sourceBrandingCandidatesSQL(teamExpression,seasonExpression=null,nowExpression=String(Date.now())) {
  return `WITH branding_roots AS(
    SELECT st.id,st.provider,st.evidence FROM team_source_attachments a JOIN source_teams st ON st.id=a.source_team_id
    LEFT JOIN provider_accounts pa ON pa.id=a.account_id LEFT JOIN security_account_credentials credential ON credential.account_id=pa.id
    WHERE a.app_team_id=${teamExpression} ${seasonExpression?`AND a.team_season_id=${seasonExpression}`:''} AND a.active=1 AND st.provenance='provider'
    AND NOT EXISTS(SELECT 1 FROM team_lifecycle life WHERE life.team_id=a.app_team_id)
    AND ((a.account_id IS NULL AND st.account_id IS NULL AND st.scope='public' AND st.provider IN('gotsport','live'))
      OR(a.account_id=st.account_id AND pa.provider=st.provider AND pa.active=1 AND credential.account_generation=pa.generation
      AND(credential.expires_at IS NULL OR credential.expires_at>${nowExpression}) AND json_extract(st.evidence,'$.account_owned')=1
      AND EXISTS(SELECT 1 FROM account_source_teams entitled WHERE entitled.account_id=st.account_id AND entitled.source_team_id=st.id)))
  ), branding_sources AS(
    SELECT * FROM branding_roots UNION
    SELECT st.id,st.provider,st.evidence FROM branding_roots root JOIN source_team_links bridge ON(bridge.a=root.id OR bridge.b=root.id) AND bridge.kind='provider_external_key'
    JOIN source_teams st ON st.id=CASE WHEN bridge.a=root.id THEN bridge.b ELSE bridge.a END
    WHERE root.provider IN('gotsport','live') AND st.provider IN('gotsport','live') AND st.account_id IS NULL AND st.scope='public' AND st.provenance='provider'
  ), branding_semantics AS(
    SELECT DISTINCT CASE WHEN provider IN('gotsport','live') AND json_type(evidence,'$.logo')='text' AND length(json_extract(evidence,'$.logo'))<=2048 THEN json_extract(evidence,'$.logo') END AS logo,
    CASE WHEN json_type(evidence,'$.club_name')='text' AND length(json_extract(evidence,'$.club_name'))<=100 THEN trim(json_extract(evidence,'$.club_name')) END AS club_name
    FROM branding_sources
  ) SELECT logo,club_name,COUNT(*) OVER() AS candidate_count FROM branding_semantics WHERE COALESCE(logo,'')<>'' OR COALESCE(club_name,'')<>'' ORDER BY COALESCE(logo,''),COALESCE(club_name,'') LIMIT 2`;
}

/** Public fixture participants; caller must first authorize the event scope. */
export function publicSourceBrandingJSONSQL(sourceExpression) {
  const query=`WITH branding_sources AS(
    SELECT st.id,st.provider,st.evidence FROM source_teams st WHERE st.id=${sourceExpression} AND st.provider IN('gotsport','live') AND st.scope='public' AND st.account_id IS NULL AND st.provenance='provider'
    UNION SELECT other.id,other.provider,other.evidence FROM source_teams st JOIN source_team_links bridge ON(bridge.a=st.id OR bridge.b=st.id) AND bridge.kind='provider_external_key'
    JOIN source_teams other ON other.id=CASE WHEN bridge.a=st.id THEN bridge.b ELSE bridge.a END
    WHERE st.id=${sourceExpression} AND st.provider IN('gotsport','live') AND st.scope='public' AND st.account_id IS NULL AND st.provenance='provider'
    AND other.provider IN('gotsport','live') AND other.scope='public' AND other.account_id IS NULL AND other.provenance='provider'
  ), branding_semantics AS(
    SELECT DISTINCT CASE WHEN json_type(evidence,'$.logo')='text' AND length(json_extract(evidence,'$.logo'))<=2048 THEN json_extract(evidence,'$.logo') END AS logo,
    CASE WHEN json_type(evidence,'$.club_name')='text' AND length(json_extract(evidence,'$.club_name'))<=100 THEN trim(json_extract(evidence,'$.club_name')) END AS club_name FROM branding_sources
  ) SELECT logo,club_name,COUNT(*) OVER() AS candidate_count FROM branding_semantics WHERE COALESCE(logo,'')<>'' OR COALESCE(club_name,'')<>'' ORDER BY COALESCE(logo,''),COALESCE(club_name,'') LIMIT 2`;
  return `(SELECT json_group_array(json_object('logo',logo,'club_name',club_name,'candidate_count',candidate_count)) FROM(${query}))`;
}

export function sourceBrandingJSONSQL(teamExpression,seasonExpression=null,nowExpression=String(Date.now())) {
  return `(SELECT json_group_array(json_object('logo',logo,'club_name',club_name,'candidate_count',candidate_count)) FROM(${sourceBrandingCandidatesSQL(teamExpression,seasonExpression,nowExpression)}))`;
}

export function sourceBrandingQuery({teamId,seasonId=null,now=Date.now()}) {
  return {sql:sourceBrandingCandidatesSQL('?',seasonId?'?':null,'?'),params:[teamId,...(seasonId?[seasonId]:[]),now]};
}

/** Consensus only. Source club text is presentation, never club authorization. */
export function sourceBranding(value) {
  let rows=value;try{if(typeof rows==='string')rows=JSON.parse(rows);}catch{rows=[];}
  if(!Array.isArray(rows))rows=[];
  const overflow=rows.some(r=>Number(r.candidate_count)>2)||rows.length>2,logos=[...new Set(rows.map(r=>safeSourceLogo(r.logo)).filter(Boolean))],clubs=[...new Set(rows.map(r=>typeof r.club_name==='string'&&r.club_name.trim().length<=100?r.club_name.trim():null).filter(Boolean))];
  return {logo:!overflow&&logos.length===1?logos[0]:null,logo_state:overflow||logos.length>1?'human_review':logos.length?'published':'unavailable',club_name:!overflow&&clubs.length===1?clubs[0]:null,club_name_state:overflow||clubs.length>1?'human_review':clubs.length?'published':'unavailable',kits:[],kits_state:'unsupported',conflict:overflow||logos.length>1||clubs.length>1};
}

export async function readSourceBranding(db,actor,{team_id,team_season_id=null},{now=Date.now()}={}) {
  if(actor?.owner!==true&&!(actor?.owner===false&&actor.teamId===team_id))throw invalid('This team is unavailable.','team_forbidden',403);
  const visible=await db.prepare(`SELECT 1 AS ok FROM app_teams t WHERE t.id=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle life WHERE life.team_id=t.id)${team_season_id?' AND EXISTS(SELECT 1 FROM team_seasons s WHERE s.app_team_id=t.id AND s.id=?)':''}`).bind(team_id,...(team_season_id?[team_season_id]:[])).first();
  if(!visible)throw invalid('This team is unavailable.','not_found',404);
  const q=sourceBrandingQuery({teamId:team_id,seasonId:team_season_id,now});return sourceBranding((await db.prepare(q.sql).bind(...q.params).all()).results);
}
