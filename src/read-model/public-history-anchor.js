import {publicHistoryProof,publicHistoryQuery,publicHistoryAdmission} from '../sync/public-history.js';
const DAY=86400000,COOLDOWN=60000,MAX_JOBS=512;
const same=(a,b)=>`(${a}=${b} OR EXISTS(SELECT 1 FROM source_team_links l WHERE(l.a=${a} AND l.b=${b}) OR(l.b=${a} AND l.a=${b})))`;
/** One provider-proven, still-readable anchor. Shared by public scan admission
 * and read-only historical detail; no team/source connection is created. */
export async function findPublicHistoryAnchor(db,context,current,{now=Date.now(),requester='owner',key='owner',provider=null}={}) {
 if(current.type!=='game'||current.conditional||current.identity_conflict)return null;
    const sql=`WITH anchors AS(
      SELECT a.id,a.generation,'own' AS kind,NULL AS membership_id FROM team_source_attachments a WHERE a.app_team_id=? AND a.team_season_id=? AND a.active=1
      UNION ALL SELECT a.id,a.generation,'division',m.id FROM team_source_attachments a JOIN source_competition_memberships m ON ${same('m.source_team_id','a.source_team_id')} WHERE a.app_team_id=? AND a.team_season_id=? AND a.active=1
    ),d AS(SELECT 'candidate' AS id,? AS app_team_id,? AS team_season_id,? AS event_id,s.id AS source_event_id,s.home_source_team_id,s.away_source_team_id,min(s.home_source_team_id,s.away_source_team_id) AS pair_a,max(s.home_source_team_id,s.away_source_team_id) AS pair_b,a.id AS anchor_attachment_id,a.generation AS anchor_generation,a.kind AS anchor_kind,a.membership_id AS anchor_membership_id,? AS requester_kind,? AS requester_key,1 AS generation,'active' AS state,? AS requested_at,? AS expires_at,? AS cooldown_until,${MAX_JOBS} AS max_jobs,0 AS capped FROM source_events s JOIN event_source_links el ON el.source_event_id=s.id JOIN canonical_event_ids ci ON ci.input_id=el.event_id JOIN anchors a WHERE ci.canonical_id=? AND s.provider IN('gotsport','live')${provider?" AND s.provider=?":''}) SELECT d.*,h.native_id AS home_native_id,w.native_id AS away_native_id,h.evidence AS home_evidence,w.evidence AS away_evidence FROM d JOIN source_teams h ON h.id=d.home_source_team_id JOIN source_teams w ON w.id=d.away_source_team_id WHERE ${publicHistoryAdmission('d','public_history_candidate')} ORDER BY CASE d.anchor_kind WHEN 'own' THEN 0 ELSE 1 END,d.source_event_id,d.anchor_attachment_id,d.anchor_membership_id LIMIT 1`;
    const row=await db.prepare(publicHistoryQuery(sql,String(now),{candidateSource:'d'})).bind(context.selection.team_id,context.selection.team_season_id,context.selection.team_id,context.selection.team_season_id,context.selection.team_id,context.selection.team_season_id,current.id,requester,key,now,now+DAY,now+COOLDOWN,current.id,...(provider?[provider]:[])).first();
 return row;
}
