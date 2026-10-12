import {publicHistoryBridgeRows} from './public-history-bridge.js';
// One-shot public requests never confer account or continuing connection demand.
const allOf=clauses=>clauses.length===1?`(${clauses[0]})`:`(${allOf(clauses.slice(0,Math.ceil(clauses.length/2)))} AND ${allOf(clauses.slice(Math.ceil(clauses.length/2)))})`;
const field=(row,name)=>typeof row==='string'?`${row}.${name}`:row[name];
const sourceSame=(a,b,division)=>`(${a}=${b} OR EXISTS(SELECT 1 FROM public_history_bridge_memberships bridge WHERE bridge.canonical_division_id=${division} AND((bridge.gs_id=${a} AND bridge.live_id=${b}) OR(bridge.live_id=${a} AND bridge.gs_id=${b}))))`;
export const PUBLIC_HISTORY_PREFIX='public-history:';
export const publicHistoryKey=sql=>`substr(${sql},1,15)='${PUBLIC_HISTORY_PREFIX}'`;
export function publicHistoryJob(job){
 return `(${field(job,'stage')}='source' AND ${field(job,'account_scope')}='public' AND ${field(job,'account_id')} IS NULL AND ${field(job,'authorization_generation')}=0 AND ((${field(job,'provider')}='gotsport' AND ${field(job,'component')} IN('profile','catalog','history','bridge','event','division','standings')) OR(${field(job,'provider')}='live' AND ${field(job,'component')} IN('participant','resolve','upcoming','membership','league','organizer','categories','division','standings','fixture'))))`;
}
/** Exactly one time placeholder is used, even for viewer expiry. Callers use
 * the same predicate for proposed request admission and persisted liveness. */
function publicHistoryParts(alias='d',nowSQL='?'){
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))throw Error('Invalid public history proof alias.');
 const d=alias;
 const from=`(SELECT ${nowSQL} AS now) ph_clock
 JOIN source_events ph_event ON ph_event.id=${d}.source_event_id
 JOIN source_teams ph_home ON ph_home.id=${d}.home_source_team_id
 JOIN source_teams ph_away ON ph_away.id=${d}.away_source_team_id
 JOIN event_source_links ph_event_link ON ph_event_link.source_event_id=ph_event.id
 JOIN canonical_event_ids ph_canonical ON ph_canonical.input_id=ph_event_link.event_id AND ph_canonical.canonical_id=${d}.event_id
 JOIN team_source_attachments ph_anchor ON ph_anchor.id=${d}.anchor_attachment_id AND ph_anchor.app_team_id=${d}.app_team_id AND ph_anchor.team_season_id=${d}.team_season_id AND ph_anchor.generation=${d}.anchor_generation AND ph_anchor.active=1
 JOIN source_teams ph_anchor_source ON ph_anchor_source.id=ph_anchor.source_team_id AND ph_anchor_source.provenance='provider'
 JOIN team_seasons ph_season ON ph_season.id=${d}.team_season_id AND ph_season.app_team_id=${d}.app_team_id
`;
 const where=`${d}.state='active' AND ${d}.expires_at>ph_clock.now
 AND ph_event.provider IN('gotsport','live') AND ph_event.scope='public' AND ph_event.account_id IS NULL AND ph_event.provenance='provider' AND ph_event.type='game' AND ph_event.conditional=0
 AND ph_event.home_source_team_id=${d}.home_source_team_id AND ph_event.away_source_team_id=${d}.away_source_team_id AND ph_home.id<>ph_away.id
 AND ph_home.provider=ph_event.provider AND ph_home.scope='public' AND ph_home.account_id IS NULL AND ph_home.provenance='provider'
 AND ph_away.provider=ph_event.provider AND ph_away.scope='public' AND ph_away.account_id IS NULL AND ph_away.provenance='provider'
 AND NOT EXISTS(SELECT 1 FROM team_lifecycle ph_lifecycle WHERE ph_lifecycle.team_id=${d}.app_team_id)
 AND NOT EXISTS(SELECT 1 FROM source_event_correspondences ph_review WHERE(ph_review.a=ph_event.id OR ph_review.b=ph_event.id) AND ph_review.status='review')
 AND NOT EXISTS(SELECT 1 FROM team_events ph_conflict WHERE ph_conflict.app_team_id=${d}.app_team_id AND ph_conflict.team_season_id=${d}.team_season_id AND ph_conflict.event_id=${d}.event_id AND ph_conflict.identity_conflict<>0)
 AND ((${d}.requester_kind='owner' AND ${d}.requester_key='owner') OR(${d}.requester_kind='viewer' AND EXISTS(SELECT 1 FROM security_viewer_tokens ph_viewer JOIN json_each(ph_viewer.categories) ph_category ON ph_category.value='matches' WHERE ph_viewer.token_hash=${d}.requester_key AND ph_viewer.team_id=${d}.app_team_id AND ph_viewer.revoked_at IS NULL AND(ph_viewer.expires_at IS NULL OR ph_viewer.expires_at>ph_clock.now))))
 AND ((${d}.anchor_kind='own' AND EXISTS(SELECT 1 FROM team_events ph_published JOIN source_event_teams ph_owned ON ph_owned.source_team_id=ph_anchor.source_team_id JOIN source_events ph_owned_event ON ph_owned_event.id=ph_owned.source_event_id AND ph_owned_event.provenance='provider' AND ph_owned_event.account_id IS ph_anchor.account_id JOIN event_source_links ph_owned_link ON ph_owned_link.source_event_id=ph_owned.source_event_id JOIN canonical_event_ids ph_owned_canonical ON ph_owned_canonical.input_id=ph_owned_link.event_id AND ph_owned_canonical.canonical_id=${d}.event_id WHERE ph_published.app_team_id=${d}.app_team_id AND ph_published.team_season_id=${d}.team_season_id AND ph_published.event_id=${d}.event_id AND ph_published.type='game' AND ph_published.conditional=0))
 OR(${d}.anchor_kind='division' AND ((ph_event.starts_at>=ph_season.start_at AND ph_event.starts_at<ph_season.end_at) OR(ph_event.starts_at IS NULL AND(ph_event.local_day IS NULL OR(ph_event.local_day>=ph_season.start_day AND ph_event.local_day<ph_season.end_day)))) AND EXISTS(SELECT 1 FROM source_competition_memberships ph_membership JOIN source_teams ph_member_source ON ph_member_source.id=ph_membership.source_team_id AND ph_member_source.provenance='provider' JOIN division_source_links ph_member_division ON ph_member_division.source_division_id=ph_membership.source_division_id JOIN canonical_division_ids ph_member_canonical ON ph_member_canonical.input_id=ph_member_division.division_id JOIN division_source_links ph_game_division ON ph_game_division.source_division_id=ph_event.division_key JOIN canonical_division_ids ph_game_canonical ON ph_game_canonical.input_id=ph_game_division.division_id WHERE ph_membership.id=${d}.anchor_membership_id AND ph_membership.provenance='provider' AND ${sourceSame('ph_membership.source_team_id','ph_anchor.source_team_id','ph_member_canonical.canonical_id')} AND ph_member_canonical.canonical_id=ph_game_canonical.canonical_id)))`;
 return {from,where:allOf(where.split(/\n AND /)),clauses:where.split(/\n AND /)};
}
export function publicHistoryProof(alias='d',nowSQL='?'){const {from,where}=publicHistoryParts(alias,nowSQL);return `EXISTS(SELECT 1 FROM ${from} WHERE ${where})`;}

// Materialize this invocation's authority once per statement. This keeps the
// recursive canonical views out of deeply nested scheduler guards in native D1.
export function publicHistoryContext(nowSQL,{source='public_history_demands',name='public_history_live'}={}) {
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(source)||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw Error('Invalid proof relation.');
 const {from,clauses}=publicHistoryParts('ph_d',nowSQL),base=clauses.slice(0,-1),fields={
  'ph_anchor.source_team_id':'proof_anchor_source','ph_anchor.account_id':'proof_anchor_account',
  'ph_event.starts_at':'proof_starts_at','ph_event.local_day':'proof_local_day','ph_event.division_key':'proof_division_key',
  'ph_season.start_at':'proof_start_at','ph_season.end_at':'proof_end_at','ph_season.start_day':'proof_start_day','ph_season.end_day':'proof_end_day',
 };
 let access=clauses.at(-1);for(const [field,alias]of Object.entries(fields))access=access.replaceAll(field,'ph_d.'+alias);
 return `${name}_base AS MATERIALIZED(SELECT ph_d.*,${Object.entries(fields).map(([field,alias])=>field+' AS '+alias).join(',')} FROM ${source} ph_d JOIN ${from} WHERE ${allOf(base)}), ${name} AS MATERIALIZED(SELECT ph_d.* FROM ${name}_base ph_d WHERE ${access})`;
}
export function publicHistoryAdmission(alias='d',relation='public_history_live') {
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation))throw Error('Invalid proof relation.');
 const fields=['id','app_team_id','team_season_id','source_event_id','event_id','anchor_attachment_id','anchor_generation','anchor_kind','anchor_membership_id','requester_kind','requester_key','generation'];
 return `EXISTS(SELECT 1 FROM ${relation} verified WHERE ${allOf(fields.map(field=>`verified.${field} IS ${alias}.${field}`))})`;
}

export function publicHistoryLive(job,subscription){
 return `EXISTS(SELECT 1 FROM public_history_receipt_authority verified WHERE ${allOf([`verified.job_id=${field(job,'id')}`,`verified.scan_id=${field(job,'scan_id')}`,...['kind','demand_key','app_team_id','generation'].map(name=>`verified.${name} IS ${field(subscription,name)}`)])})`;
}

export function publicHistoryDemanded(job,predicate='1'){
 return `EXISTS(SELECT 1 FROM public_history_receipt_authority verified JOIN sync_job_subscribers s ON s.job_id=verified.job_id AND s.kind=verified.kind AND s.demand_key=verified.demand_key AND s.app_team_id=verified.app_team_id AND s.generation=verified.generation WHERE verified.job_id=${job}.id AND verified.scan_id=${job}.scan_id AND (${predicate}))`;
}

/** Compile one flat authority graph per SQL statement, never a persistent cache.
 * Time expressions are internal SQL literals; all HTTP values stay bound. */
export function publicHistoryQuery(sql,nowSQL,{live=false,candidateSource=null}={}) {
 const ctes=[];
 const subscriptions=live&&sql.includes('public_history_receipt_authority');
 if(live&&(subscriptions||sql.includes('public_history_live')))ctes.push(publicHistoryContext(nowSQL));
 if(subscriptions)ctes.push(`public_history_receipt_authority AS MATERIALIZED(SELECT j.id AS job_id,j.scan_id,'team' AS kind,'public-history:'||d.id AS demand_key,d.app_team_id,d.generation FROM public_history_live d JOIN public_history_jobs r ON r.demand_id=d.id AND r.generation=d.generation AND r.state='pending' JOIN sync_jobs j ON j.id=r.job_id AND j.scan_id=r.accepted_scan_id WHERE ${publicHistoryJob('j')} AND ${publicHistoryJobAuthority('j','d',{root:'r.root_source_team_id'})})`);
 if(candidateSource&&sql.includes('public_history_candidate'))ctes.push(publicHistoryContext(nowSQL,{source:candidateSource,name:'public_history_candidate'}));
 let body=[...ctes,sql].join(' ');
 if(body.includes('public_history_bridge_memberships'))ctes.unshift(`public_history_bridge_memberships AS MATERIALIZED(SELECT DISTINCT bridge.gs_id,bridge.live_id,canonical.canonical_id AS canonical_division_id FROM public_history_bridges bridge JOIN source_competition_memberships member ON member.source_team_id=bridge.live_id AND member.provenance='provider' JOIN source_divisions division ON division.id=member.source_division_id AND division.provider='live' AND division.provenance='provider' JOIN source_competitions competition ON competition.id=division.competition_id AND competition.provider='live' AND competition.scope='public' AND competition.account_id IS NULL AND competition.provenance='provider' JOIN division_source_links link ON link.source_division_id=division.id JOIN canonical_division_ids canonical ON canonical.input_id=link.division_id WHERE CAST(json_extract(competition.evidence,'$.season_id') AS TEXT)=bridge.season AND CAST(json_extract(competition.evidence,'$.season_name') AS TEXT)=bridge.season_name)`);
 body=[...ctes,sql].join(' ');
 if(body.includes('public_history_bridges'))ctes.unshift(`public_history_bridges AS MATERIALIZED(${publicHistoryBridgeRows(nowSQL)})`);
 body=[...ctes,sql].join(' ');
 const maps=[];
 for(const [view,alias]of [['canonical_event_ids','ph_canonical_events'],['canonical_division_ids','ph_canonical_divisions']])if(body.includes(view)){maps.push(`${alias} AS MATERIALIZED(SELECT input_id,canonical_id FROM ${view})`);sql=sql.replaceAll(view,alias);for(let i=0;i<ctes.length;i++)ctes[i]=ctes[i].replaceAll(view,alias);}
 const context=[...maps,...ctes].join(', ');
 return context?(/^\s*WITH\s/i.test(sql)?sql.replace(/^\s*WITH\s/i,`WITH ${context}, `):`WITH ${context} ${sql}`):sql;
}
export function publicHistoryJobAuthority(job,demand,{discovery=true,root=null,bridgeSource=null}={}) {
 const d=typeof demand==='string'?name=>`${demand}.${name}`:name=>demand[name];
 const args=field(job,'args'),component=field(job,'component');
 const team=`CAST(json_extract(${args},'$.team_id') AS TEXT)`,liveTeam=`CAST(json_extract(${args},'$.proof.live_team_id') AS TEXT)`,gsTeam=`CAST(json_extract(${args},'$.proof.team_id') AS TEXT)`;
 const native=`EXISTS(SELECT 1 FROM source_teams native_root WHERE native_root.id=${root||'NULL'} AND native_root.provenance='provider' AND native_root.provider='gotsport' AND native_root.native_id=${team})`;
 const lineage=root?`${root} IN(${d('home_source_team_id')},${d('away_source_team_id')})`:'1';
 const bridgeRoot=root?`(${root}=bridge.gs_id OR ${root}=bridge.live_id)`:`(bridge.gs_id IN(${d('home_source_team_id')},${d('away_source_team_id')}) OR bridge.live_id IN(${d('home_source_team_id')},${d('away_source_team_id')}))`;
 const bridge=allOf([bridgeRoot,...(bridgeSource?[`${bridgeSource} IN(bridge.gs_id,bridge.live_id)`]:[]),`(${team} IS NULL OR ${team}=CAST(json_extract(bridge.evidence,CASE WHEN ${component}='resolve' THEN '$.team_id' ELSE '$.live_team_id' END) AS TEXT))`,`(${liveTeam} IS NULL OR ${liveTeam}=CAST(json_extract(bridge.evidence,'$.live_team_id') AS TEXT))`,`(${gsTeam} IS NULL OR ${gsTeam}=CAST(json_extract(bridge.evidence,'$.team_id') AS TEXT))`,`CAST(COALESCE(json_extract(${args},'$.proof.season'),json_extract(${args},'$.season')) AS TEXT)=bridge.season`,`CAST(COALESCE(json_extract(${args},'$.proof.season_name'),json_extract(${args},'$.season_name')) AS TEXT)=bridge.season_name`]);
 // Only an explicitly discovered GotSport-native resolve page can establish a
 // missing bridge. Adopted jobs and all downstream pages need exact lineage.
 return `(${lineage} AND (${field(job,'provider')}<>'live' OR ${discovery?`(${component}='resolve' AND ${native}) OR `:''}EXISTS(SELECT 1 FROM public_history_bridges bridge WHERE ${bridge})))`;
}
