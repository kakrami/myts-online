import {nativeCanonicalId} from './identity.js';
const PUBLIC=new Set(['gotsport','live']);
const parse=(v)=>typeof v==='string'?JSON.parse(v||'{}'):v||{};
const error=(message,code='source_contract')=>Object.assign(new Error(message),{code,status:409});
const requireValue=(v,m)=>{if(!v)throw error(m);return v;};
const bounded=(v)=>{const s=JSON.stringify(v);requireValue(new TextEncoder().encode(s).length<=64000,'Native evidence exceeds its record bound.');return s;};
const volatile=new Set(['observed_at','verified_at','scan_id','catalog_scan_id','checked_at','expires_at']);
const stable=(v)=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>!volatile.has(k)).map(k=>[k,k==='observations'&&Array.isArray(v[k])?v[k].map(o=>stable(Object.fromEntries(Object.entries(o).filter(([key])=>!['at','retrieved_at'].includes(key))))):stable(v[k])])):v;
const digest=async(v)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(v))))),n=>n.toString(16).padStart(2,'0')).join('');
const number=(v,fallback=null)=>v==null?fallback:requireValue(Number.isFinite(Number(v)),'Invalid native numeric fact.')&&Number(v);
// Trace optional quantities are not JavaScript-coercible truth values. Blank
// native numeric fields are absent, as in the original Trace reducer; explicit
// zero and finite numeric strings retain their values. Other providers keep
// their existing normalization contract.
const traceNumericString=v=>typeof v==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim());
const traceNumber=v=>v==null||typeof v==='string'&&v.trim()===''?null:
  requireValue((typeof v==='number'||traceNumericString(v))&&Number.isFinite(Number(v)),'Invalid Trace numeric fact.')&&Number(v);
// Membership dates are absolute provider metadata, never match-relative seconds.
// Preserve finite numbers/strict-decimal strings by value; never guess units.
// Zoned date strings project to epoch milliseconds while evidence retains the
// original value (including any sub-millisecond precision).
export function traceMembershipTime(v) {
  if(v==null)return null;
  if(typeof v==='number'||traceNumericString(v))return requireValue(Number.isFinite(Number(v)),'Invalid Trace membership time.')&&Number(v);
  const m=typeof v==='string'&&v.length<=40&&v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
  requireValue(m,'Invalid Trace membership time.');
  const [,year,month,day,hour,minute,second,fraction='',zone]=m;
  const y=Number(year),mo=Number(month),d=Number(day),h=Number(hour),mi=Number(minute),se=Number(second);
  const leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  requireValue(mo>=1&&mo<=12&&d>=1&&d<=days[mo-1]&&h<=23&&mi<=59&&se<=59,'Invalid Trace membership time.');
  const offsetHour=zone==='Z'?0:Number(zone.slice(1,3)),offsetMinute=zone==='Z'?0:Number(zone.slice(4,6));
  requireValue(offsetHour<=23&&offsetMinute<=59&&zone!=='-00:00','Invalid Trace membership time.');
  const local=new Date(0);local.setUTCFullYear(y,mo-1,d);local.setUTCHours(h,mi,se,Number(fraction.padEnd(3,'0').slice(0,3)));
  const offset=(offsetHour*60+offsetMinute)*60000*(zone[0]==='-'?-1:1),value=local.getTime()-offset;
  return requireValue(Number.isFinite(value),'Invalid Trace membership time.')&&value;
}
const instant=()=>new Date().toISOString();
export function auxiliaryKey(value,accountId=null) {
  requireValue(typeof value==='string'&&/^(gotsport|live|teamsnap|trace):[A-Za-z0-9._:-]{1,240}$/.test(value),'Invalid native auxiliary identity.');
  const at=value.indexOf(':'),provider=value.slice(0,at),scope=PUBLIC.has(provider)?'public':requireValue(accountId,'Private native identity needs its account.');
  return `${provider}/${encodeURIComponent(scope)}/${encodeURIComponent(value.slice(at+1))}`;
}
function websiteDomain(value) {try {const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'?u.hostname.toLowerCase().replace(/^www\./,''):null;}catch{return null;}}
function officialURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}

// The collector already validates the refresh protocol and full job binding.
// Only its current, account-fenced TeamSnap page may separate scan progress
// from accepted coverage. Generic/imported coverage cannot inherit this rule.
function teamSnapRefreshCoverage(page,coverage,accountId) {
  const checkpoint=page.checkpoint,refresh=checkpoint?.refresh,binding=refresh?.binding;
  const kind=coverage.kind.replace(/_recent$/,'');
  if((page.provenance??'provider')!=='provider'||page.provider!=='teamsnap'||page.component!==kind||!['events','attendance'].includes(kind)||coverage.provider!=='teamsnap'||
    refresh?.protocol!=='teamsnap-refresh-v1'||!['teamsnap-pages-v1','teamsnap-refresh-v1'].includes(checkpoint.protocol)||
    binding?.kind!==kind||binding.account_id!==accountId||binding.authorization_generation!==page.generation||
    coverage.scope!==`teamsnap:${binding.team_id}`||page.resourceKey!==coverage.scope||!Number.isSafeInteger(page.generation)||page.generation<1||
    coverage.availability!==null||coverage.heatmap_availability!==null||!/^[A-Za-z0-9._-]{1,160}$/.test(binding.team_id)||
    !/^[a-f0-9]{64}$/.test(binding.payload||'')||(kind==='attendance'&&binding.identity_version!=='event-member-v1'))return null;
  try{const source=new URL(binding.source),rel=kind==='events'?'events':'availabilities';
    if(source.origin!=='https://api.teamsnap.com'||source.username||source.password||source.hash||
      ![`/v3/${rel}`,`/v3/${rel}/search`].includes(source.pathname)||source.searchParams.get('team_id')!==binding.team_id||
      [...source.searchParams.keys()].some(key=>key!=='team_id')||source.searchParams.size!==1)return null;
  }catch{return null;}
  const at=Date.now(),timestamp=value=>Number.isSafeInteger(value)&&value>=0&&value<=at+60000;
  const filters=(mode,started)=>mode==='full'?{}:{started_after:new Date(Math.max(0,started-30*86400000)).toISOString(),started_before:new Date(started+90*86400000).toISOString()};
  const validReceipt=(receipt,mode)=>receipt&&receipt.mode===mode&&Number.isSafeInteger(receipt.count)&&receipt.count>=0&&
    Number.isSafeInteger(receipt.pages)&&receipt.pages>0&&/^[a-f0-9]{64}$/.test(receipt.digest||'')&&
    timestamp(receipt.started_at)&&timestamp(receipt.completed_at)&&receipt.completed_at>=receipt.started_at&&
    (receipt.total===null||Number.isSafeInteger(receipt.total)&&receipt.total===receipt.count)&&
    JSON.stringify(receipt.filters)===JSON.stringify(filters(mode,receipt.started_at));
  if(refresh.full!==null&&!validReceipt(refresh.full,'full')||refresh.recent!==null&&
    (!validReceipt(refresh.recent,'recent')||!refresh.full||refresh.recent.started_at<refresh.full.started_at))return null;
  const recent=coverage.kind===kind+'_recent';
  if(recent&&!refresh.full)return null;
  const mode=recent?'recent':'full',active=coverage.complete===0&&checkpoint.finished!==true&&checkpoint.protocol==='teamsnap-pages-v1'&&
    refresh.active?.mode===mode&&timestamp(refresh.active.started_at)&&
    (!refresh.full||refresh.active.started_at>=refresh.full.started_at)&&(!refresh.recent||refresh.active.started_at>=refresh.recent.started_at)&&
    JSON.stringify(refresh.active.filters)===JSON.stringify(filters(mode,refresh.active.started_at));
  const receipt=recent?refresh.recent:refresh.full;
  const terminal=coverage.complete===1&&checkpoint.finished===true&&checkpoint.protocol==='teamsnap-refresh-v1'&&refresh.active===null&&
    validReceipt(receipt,mode)&&receipt.count===coverage.record_count;
  if(!active&&!terminal)return null;
  return {recent,terminal,full:refresh.full};
}

/** Build bounded native writes; the caller combines these with its lease fence,
 * account generation and source input CAS in one transaction. */
export async function buildAuxiliaryPage(repo,page) {
  const {records={},accountId=null,accountProvider=null,replacements=[],sourceCoverage=[],scanId=''}=page;
  const rows={},scope={account_id:accountId},teamIds=new Set(),divisionIds=new Set(),eventIds=new Set(),competitionIds=new Set(),genericTeamIds=new Set();
  const push=(table,row)=>{(rows[table]||=[]).push(row);};
  const ref=(v)=>{const provider=String(v).split(':')[0];requireValue(PUBLIC.has(provider)||provider===accountProvider,'Native auxiliary belongs to another provider account.');return auxiliaryKey(v,accountId);};
  const privateRefs=(r)=>{
    requireValue(accountId&&r.account_id===accountId,'Private auxiliary data crossed its account.');
    const source_team_id=ref(r.team_id),source_event_id=ref(r.fixture_id);
    requireValue(source_team_id.startsWith(`trace/${encodeURIComponent(accountId)}/`)&&source_event_id.startsWith(`trace/${encodeURIComponent(accountId)}/`),'Trace auxiliary scope is invalid.');
    return {...scope,source_team_id,source_event_id,observed_at:r.observed_at||instant()};
  };
  for(const r of records.competitions||[]) {
    const d=parse(r.details),provider=r.provider||r.id?.split(':')[0],id=ref(r.id||`${provider}:${r.native_id}`);
    requireValue(PUBLIC.has(provider),'Public competition has an invalid provider.');
    const season_name=d.season_name||null,season_year=/^\d{4}/.test(d.seasonal_year||'')?Number(d.seasonal_year.slice(0,4)):/^\d{4}\//.test(season_name||'')?Number(season_name.slice(0,4)):null;
    push('source_competitions',{id,provider,scope:'public',account_id:null,native_id:String(r.native_id||r.id.slice(r.id.indexOf(':')+1)),name:String(r.name),kind:r.kind||'unknown',starts_on:r.starts_on||d.starts_on||null,ends_on:r.ends_on||d.ends_on||null,season_year,season_name,website_domain:websiteDomain(d.website||d.website_url),official_url:officialURL(d.source_url),official_status:d.official_status||null,completion_verified_at:d.completion_verified_at||null,evidence:bounded(d),observed_at:r.observed_at||instant()});
  }
  for(const r of records.divisions||[]) {const d=parse(r.details);push('source_divisions',{id:ref(r.id),provider:r.id.split(':')[0],competition_id:ref(r.competition_id),name:String(r.name),official_url:officialURL(d.source_url),evidence:bounded(d),observed_at:r.observed_at||instant()});}
  for(const r of records.memberships||[]) {
    const source_team_id=ref(r.team_id),source_division_id=ref(r.division_id),registration_id=r.registration_id==null?null:String(r.registration_id);
    push('source_competition_memberships',{id:`${source_team_id}|${source_division_id}|${registration_id||''}`,source_team_id,source_division_id,registration_id,evidence:bounded(parse(r.evidence)),observed_at:r.observed_at||instant()});
  }
  for(const r of records.references_data||[]) {
    const source_team_id=ref(r.team_id),d=parse(r.value);
    push('source_references',{id:`${source_team_id}|${r.kind}|${r.id}`,source_team_id,kind:String(r.kind),native_id:String(r.id),name:d.name||null,address:d.address||null,evidence:bounded(d),observed_at:r.observed_at||instant()});
  }
  for(const r of records.standings||[]) {
    const source_division_id=ref(r.division_id),d=parse(r.payload),pool_id=String(r.pool_id),participant_key=/^(gotsport|live):/.test(r.team_id)?ref(r.team_id):String(r.team_id);
    requireValue(/^registration:[A-Za-z0-9._-]+$/.test(participant_key)||/^(gotsport|live)\/public\//.test(participant_key),'Invalid standings participant identity.');
    const id=`${source_division_id}|${pool_id}|${participant_key}`;
    push('source_standings',{id,source_division_id,pool_id,participant_key,name:String(d.name||'Team'),rank:number(r.rank),played:number(d.mp,0),wins:number(d.w,0),draws:number(d.d,0),losses:number(d.l,0),goals_for:number(d.gf,0),goals_against:number(d.ga,0),goal_difference:number(d.gd,0),points:number(d.pts,0),scan_id:String(r.scan_id||scanId),evidence:bounded(d),observed_at:r.observed_at||instant()});
  }
  for(const r of records.attendance||[]) {
    requireValue(accountId&&r.account_id===accountId,'Attendance belongs to another account.');
    const source_team_id=ref(r.team_id),source_event_id=ref(r.fixture_id),source_player_id=ref(r.player_id);
    requireValue([source_team_id,source_event_id,source_player_id].every(k=>k.startsWith(`teamsnap/${encodeURIComponent(accountId)}/`)),'Attendance must use one TeamSnap account.');
    const nativeStatus=r.status_code??r.status??null,normalized=r.normalized_status||({0:'No',1:'Yes',2:'Maybe'}[String(nativeStatus)]||(nativeStatus==null||nativeStatus===''?'NR':'Unknown'));
    push('source_attendance',{id:`${source_team_id}|${source_event_id}|${source_player_id}`,account_id:accountId,source_team_id,source_event_id,source_player_id,status:normalized,source_status:nativeStatus==null?null:String(nativeStatus),observed_at:r.observed_at||instant()});
  }
  for(const r of page.fixtures||[])if(r.provider==='teamsnap') {
    const d=parse(r.payload),source_event_id=ref(r.id||`teamsnap:${r.native_id}`),source_team_id=ref(r.home_id||r.away_id);
    push('source_event_logistics',{id:source_event_id,source_event_id,account_id:accountId,source_team_id,arrival_at:d.arrival_at||null,arrival_minutes:number(d.arrival_minutes),uniform:d.uniform||null,notes:d.notes||null,location_id:d.location_id||null,opponent_id:d.opponent_id||null,address:d.address||null,availability_enabled:d.availability_enabled==null?null:+!!d.availability_enabled,source_url:d.source_url||null,observed_at:r.observed_at||instant()});
  }
  for(const r of records.trace_parts||[]) {
    const base=privateRefs(r),d=parse(r.value),key=String(r.part),id=`${base.source_team_id}|${base.source_event_id}|${key}`,common={id,...base};
    if(/^(header|clip:\d+|radar:\d+)$/.test(key)) push('source_trace_components',{...common,kind:key.split(':')[0],native_key:key,half:traceNumber(d.half),availability:d.availability||null,start_seconds:traceNumber(d.start),end_seconds:traceNumber(d.end),duration_seconds:traceNumber(d.duration),population:traceNumber(d.population),evidence:bounded(d)});
    else if(/^member:\d+$/.test(key)) push('source_game_members',{...common,native_key:key,source_player_id:d.user_id?ref(`trace:${d.user_id}`):null,gid:d.gid||null,side:d.side||null,name:String(d.name||'Unidentified'),jersey:d.jersey||null,dummy:d.dummy?1:0,position:d.position||null,join_time:traceMembershipTime(d.join_time),leave_time:traceMembershipTime(d.leave_time),evidence:bounded(d)});
    else if(/^moment:\d+$/.test(key)) push('source_game_moments',{...common,native_key:key,clip_id:d.game_clip_id||null,half:traceNumber(d.half),time_seconds:traceNumber(d.time),duration_seconds:traceNumber(d.duration),type:String(d.type||''),title:String(d.title||''),side:d.side||null,evidence:bounded(d)});
    else if(key.startsWith('tracking:')) {
      const m=key.match(/^tracking:(\d+):(.+):(\d+):(\d+)$/);requireValue(m&&Array.isArray(d.segments)&&d.segments.length<=1000,'Invalid tracking segment page.');
      requireValue(d.segments.every(s=>Array.isArray(s)&&s.length===2&&s.every(Number.isFinite)&&s[1]>s[0]),'Invalid tracking interval.');
      push('source_tracking_segments',{...common,source_player_id:/^trace:/.test(d.player_id)?ref(d.player_id):null,gid:m[2],half:Number(m[1]),chunk:Number(m[3]),page_offset:Number(m[4]),segments:bounded(d.segments)});
    } else if(key.startsWith('stats:')) {
      const m=key.match(/^stats:(team|trace:[A-Za-z0-9._-]+|track:[A-Za-z0-9%._-]+):(home|away):([^:]+):([^:]+):(\d+)$/);requireValue(m,'Invalid statistic item identity.');
      const track_gid=m[1].startsWith('track:')?decodeURIComponent(m[1].slice(6)):null;if(track_gid)requireValue(track_gid.length<=160&&d.scope_gid===track_gid,'Statistic track scope is invalid.');
      push('source_stat_items',{...common,source_player_id:m[1]==='team'||track_gid?null:ref(m[1]),track_gid,side:m[2],period:m[3],kind:m[4],item_index:Number(m[5]),time_seconds:traceNumber(d.time??d.timestamp??d.t),evidence:bounded(d)});
    } else throw error('Unknown Trace native component.');
  }
  for(const r of records.trace_stats||[]) {
    const base=privateRefs(r),d=parse(r.value),track_gid=r.player_id?.startsWith('track:')?decodeURIComponent(r.player_id.slice(6)):null,source_player_id=r.player_id==='team'||track_gid?null:ref(r.player_id),period=String(r.period),side=r.side,id=`${base.source_team_id}|${base.source_event_id}|${r.player_id}|${side}|${period}`;
    requireValue(['home','away'].includes(side),'Statistic side must be explicit.');if(track_gid)requireValue(track_gid.length<=160&&r.track_gid===track_gid,'Statistic track scope is invalid.');
    push('source_stat_summaries',{id,...base,source_player_id,track_gid,side,period,state:String(r.state),summary:bounded(d.stats)});
    const grid=d.heatmap;requireValue(grid==null||Array.isArray(grid)&&grid.length<=256&&grid.every(a=>Array.isArray(a)&&a.length===grid[0]?.length&&a.length<=256&&a.every(v=>Number.isFinite(v)&&v>=0)),'Invalid heatmap grid.');
    push('source_heatmaps',{id,...base,source_player_id,track_gid,side,period,state:String(d.heatmap_state||'unpublished'),width:grid?.[0]?.length||0,height:grid?.length||0,cells:grid==null?null:bounded(grid)});
  }
  const statements=[],add=(sql,...params)=>statements.push({sql,params});let changed=false;
  // Retain enriched competition/division context when a later native stub omits it.
  for(const [table,list] of Object.entries(rows)) {
    const keyColumn=table==='source_event_logistics'?'source_event_id':'id';
    const old=(await repo.db.prepare(`SELECT *,${keyColumn} AS id FROM ${table} WHERE ${keyColumn} IN(SELECT value FROM json_each(?))`).bind(JSON.stringify(list.map(r=>r.id))).all()).results,byId=new Map(old.map(r=>[r.id,r]));
    for(const row of list) {
      const prior=byId.get(row.id);row.provenance=page.provenance||"provider";
      if(prior&&table==='source_competitions') {
        for(const field of ['starts_on','ends_on','season_year','season_name','website_domain','official_url','official_status','completion_verified_at'])row[field]??=prior[field];
        if(row.kind==='unknown')row.kind=prior.kind;
        row.evidence=bounded({...parse(prior.evidence),...parse(row.evidence)});
      }
      row.content_hash=await digest({...row,...(row.evidence?{evidence:parse(row.evidence)}:{}),...(row.summary?{summary:parse(row.summary)}:{})});
    }
    const updates=list.filter(r=>!byId.has(r.id)||!(r.provenance==="file_import"&&byId.get(r.id).provenance==="provider")&&(byId.get(r.id).provenance==="file_import"&&r.provenance==="provider"||byId.get(r.id).content_hash!==r.content_hash&&r.observed_at>=byId.get(r.id).observed_at));
    if(updates.length) {changed=true;for(const row of updates){
      if(row.source_team_id&&!row.source_event_id&&table!=='source_competition_memberships')genericTeamIds.add(row.source_team_id);
      if(row.source_event_id)eventIds.add(row.source_event_id);
      if(row.source_division_id)divisionIds.add(row.source_division_id);
      if(table==='source_divisions')divisionIds.add(row.id);
      if(table==='source_competitions')competitionIds.add(row.id);
    }const cols=Object.keys(updates[0]).filter(c=>table!=='source_event_logistics'||c!=='id');add(`INSERT INTO ${table}(${cols.join(',')}) SELECT ${cols.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM json_each(?) WHERE $FENCE ON CONFLICT(${keyColumn}) DO UPDATE SET ${cols.filter(c=>c!==keyColumn).map(c=>`${c}=excluded.${c}`).join(',')}`,JSON.stringify(updates));}
  }
  for(const [kind,table,list]of [['competition','competitions',rows.source_competitions||[]],['division','divisions',rows.source_divisions||[]]])if(list.length) {
    const identities=await Promise.all(list.map(async r=>({source_id:r.id,id:await nativeCanonicalId(kind,r.id)})));
    add(`INSERT OR IGNORE INTO ${table} SELECT json_extract(value,'$.id'),? FROM json_each(?) WHERE $FENCE`,instant(),JSON.stringify(identities));
    add(`INSERT OR IGNORE INTO ${kind}_source_links(source_${kind}_id,${kind}_id,reason,evidence) SELECT json_extract(value,'$.source_id'),json_extract(value,'$.id'),'source_identity','{}' FROM json_each(?) WHERE $FENCE`,JSON.stringify(identities));
  }
  // Every page records membership for this scan, even for semantically unchanged
  // rows. Only terminal coverage may remove rows missing from a complete scan.
  const rosterSeen=(records.team_players||[]).filter(r=>r.scan_id).map(r=>({scan_id:r.scan_id,source_team_id:ref(r.team_id),source_player_id:ref(r.player_id)}));
  if(rosterSeen.length)add("INSERT OR IGNORE INTO source_roster_scan_members SELECT json_extract(value,'$.scan_id'),json_extract(value,'$.source_team_id'),json_extract(value,'$.source_player_id') FROM json_each(?) WHERE $FENCE",JSON.stringify(rosterSeen));
  const standingsSeen=(records.standings||[]).filter(r=>r.scan_id||scanId).map(r=>{const division=ref(r.division_id),participant=/^(gotsport|live):/.test(r.team_id)?ref(r.team_id):String(r.team_id);return {scan_id:r.scan_id||scanId,source_division_id:division,standing_id:`${division}|${r.pool_id}|${participant}`};});
  if(standingsSeen.length)add("INSERT OR IGNORE INTO source_standings_scan_members SELECT json_extract(value,'$.scan_id'),json_extract(value,'$.source_division_id'),json_extract(value,'$.standing_id') FROM json_each(?) WHERE $FENCE",JSON.stringify(standingsSeen));
  const catalogSeen=(records.teams||[]).filter(r=>accountId&&parse(r.details).account_owned===true&&parse(r.details).catalog_scan_id).map(r=>({scan_id:parse(r.details).catalog_scan_id,account_id:accountId,source_team_id:ref(r.id||`${r.provider}:${r.native_id}`)}));
  if(catalogSeen.length)add("INSERT OR IGNORE INTO source_catalog_scan_members SELECT json_extract(value,'$.scan_id'),json_extract(value,'$.account_id'),json_extract(value,'$.source_team_id') FROM json_each(?) WHERE $FENCE",JSON.stringify(catalogSeen));
  for(const r of replacements) {
    if(r.kind==='roster') {
      requireValue(accountId&&r.account_id===accountId&&r.scan_id,'Roster replacement scope is incomplete.');
      const team=ref(r.team_id),incoming=(records.team_players||[]).filter(p=>p.team_id===r.team_id).map(p=>ref(p.player_id));teamIds.add(team);
      const stale=await repo.db.prepare('SELECT COUNT(*) AS count FROM source_roster_memberships WHERE source_team_id=? AND active=1 AND source_player_id NOT IN(SELECT source_player_id FROM source_roster_scan_members WHERE scan_id=? AND source_team_id=?) AND source_player_id NOT IN(SELECT value FROM json_each(?))').bind(team,r.scan_id,team,JSON.stringify(incoming)).first();
      if(stale.count){changed=true;genericTeamIds.add(team);}
      add('UPDATE source_roster_memberships SET active=0 WHERE source_team_id=? AND active=1 AND source_player_id NOT IN(SELECT source_player_id FROM source_roster_scan_members WHERE scan_id=? AND source_team_id=?) AND $FENCE',team,r.scan_id,team);
      add('DELETE FROM source_roster_scan_members WHERE source_team_id=? AND scan_id<>? AND $FENCE',team,r.scan_id);
    } else if(r.kind==='standings') {
      const division=ref(r.division_id);
      const stale=await repo.db.prepare('SELECT COUNT(*) AS count FROM source_standings WHERE source_division_id=? AND id NOT IN(SELECT standing_id FROM source_standings_scan_members WHERE scan_id=? AND source_division_id=?) AND id NOT IN(SELECT value FROM json_each(?))').bind(division,r.scan_id,division,JSON.stringify((rows.source_standings||[]).map(s=>s.id))).first();
      if(stale.count){changed=true;divisionIds.add(division);}
      add('DELETE FROM source_standings WHERE source_division_id=? AND id NOT IN(SELECT standing_id FROM source_standings_scan_members WHERE scan_id=? AND source_division_id=?) AND $FENCE',division,r.scan_id,division);
      add('DELETE FROM source_standings_scan_members WHERE source_division_id=? AND scan_id<>? AND $FENCE',division,r.scan_id);
    } else if(r.kind==='catalog') {
      requireValue(accountId&&r.account_id===accountId&&r.scan_id,'Catalog replacement scope is incomplete.');
      add('DELETE FROM account_source_teams WHERE account_id=? AND source_team_id NOT IN(SELECT source_team_id FROM source_catalog_scan_members WHERE account_id=? AND scan_id=?) AND $FENCE',accountId,accountId,r.scan_id);
      add('DELETE FROM source_catalog_scan_members WHERE account_id=? AND scan_id<>? AND $FENCE',accountId,r.scan_id);
    } else if(r.kind.startsWith('trace_')) {
      requireValue(accountId&&r.account_id===accountId,'Trace replacement belongs to another account.');
      const team=ref(r.team_id),event=ref(r.fixture_id),prefix='source_team_id=? AND source_event_id=? AND account_id=?',params=[team,event,accountId];
      const remove=async(table,condition,extra=[])=>{const count=await repo.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${prefix} AND (${condition})`).bind(...params,...extra).first();if(count.count){changed=true;eventIds.add(event);}add(`DELETE FROM ${table} WHERE ${prefix} AND (${condition}) AND $FENCE`,...params,...extra);};
      if(r.kind==='trace_game_parts') {
        requireValue(Number.isInteger(r.member_count)&&Number.isInteger(r.moment_count)&&Array.isArray(r.halves),'Trace game replacement lacks terminal counts.');
        await remove('source_game_members','CAST(substr(native_key,8) AS INTEGER)>=?',[r.member_count]);
        await remove('source_game_moments','CAST(substr(native_key,8) AS INTEGER)>=?',[r.moment_count]);
        await remove('source_trace_components',"kind='clip' AND half NOT IN(SELECT value FROM json_each(?))",[JSON.stringify(r.halves)]);
      } else if(r.kind==='trace_stat_parts') {
        const track=r.player_id?.startsWith('track:')?decodeURIComponent(r.player_id.slice(6)):null,player=r.player_id==='team'||track?null:ref(r.player_id);requireValue(['home','away'].includes(r.side)&&r.period&&r.item_counts&&Object.values(r.item_counts).every(n=>Number.isInteger(n)&&n>=0),'Trace statistic replacement lacks terminal counts.');
        await remove('source_stat_items','source_player_id IS ? AND track_gid IS ? AND side=? AND period=? AND (kind NOT IN(SELECT key FROM json_each(?)) OR item_index>=COALESCE((SELECT value FROM json_each(?) WHERE key=source_stat_items.kind),0))',[player,track,r.side,String(r.period),JSON.stringify(r.item_counts),JSON.stringify(r.item_counts)]);
      } else if(r.kind==='trace_tracking_parts') {
        requireValue(Number.isInteger(r.half)&&r.gid&&r.chunk_pages&&Number.isInteger(r.segment_page_size),'Trace tracking replacement lacks terminal counts.');
        await remove('source_tracking_segments','half=? AND gid=? AND (CAST(chunk AS TEXT) NOT IN(SELECT key FROM json_each(?)) OR page_offset>=COALESCE((SELECT value FROM json_each(?) WHERE CAST(key AS INTEGER)=source_tracking_segments.chunk),0)*?)',[r.half,r.gid,JSON.stringify(r.chunk_pages),JSON.stringify(r.chunk_pages),r.segment_page_size]);
      } else if(r.kind==='trace_radar_parts') {
        requireValue(Array.isArray(r.valid_parts),'Trace radar replacement lacks terminal keys.');
        await remove('source_trace_components',"kind='radar' AND half=? AND native_key NOT IN(SELECT value FROM json_each(?))",[r.half,JSON.stringify(r.valid_parts)]);
      } else throw error('Unknown Trace replacement scope.');
    } else throw error('Unknown source replacement scope.');
  }
  for(const c of sourceCoverage) if(c.kind==='division_schedule') {
    const source_division_id=ref(c.division_id||c.scope),id=`${c.provider}|${source_division_id}`;
    const prior=await repo.db.prepare('SELECT complete,record_count FROM source_division_coverage WHERE id=?').bind(id).first();
    if(prior&&prior.complete===+c.complete&&prior.record_count===Number(c.count||0))continue;
    changed=true;divisionIds.add(source_division_id);
    add('INSERT INTO source_division_coverage(id,provider,source_division_id,complete,record_count,scan_id,observed_at) SELECT ?,?,?,?,?,?,? WHERE $FENCE ON CONFLICT(id) DO UPDATE SET complete=excluded.complete,record_count=excluded.record_count,scan_id=excluded.scan_id,observed_at=excluded.observed_at',id,c.provider,source_division_id,+c.complete,Number(c.count||0),String(scanId),c.observed_at||instant());
  }
  for(const c of sourceCoverage)if(c.kind==='standings') {
    const division=ref(c.division_id||c.scope);requireValue(['pending','published','unpublished'].includes(c.availability),'Standings publication state is missing.');
    // The write predicate preserves the exact row clock for archives without
    // turning a retrieval timestamp into a change to report evidence.
    add('INSERT INTO source_standings_coverage SELECT ?,?,?,?,?,? WHERE $FENCE ON CONFLICT(source_division_id) DO UPDATE SET complete=excluded.complete,record_count=excluded.record_count,availability=excluded.availability,observed_at=excluded.observed_at WHERE source_standings_coverage.complete IS NOT excluded.complete OR source_standings_coverage.record_count IS NOT excluded.record_count OR source_standings_coverage.availability IS NOT excluded.availability',division,c.provider,+c.complete,Number(c.count||0),c.availability,c.observed_at||instant());
  }
  const componentCoverage=sourceCoverage.filter(c=>c.kind!=='division_schedule').map(c=>{
    requireValue(c.provider&&c.kind&&c.scope&&typeof c.complete==='boolean'&&(!c.account_id||c.account_id===accountId),'Component coverage scope is invalid.');
    requireValue(PUBLIC.has(c.provider)||c.provider===accountProvider,'Component coverage belongs to another provider account.');
    return {id:`${c.provider}|${accountId||'public'}|${c.kind}|${c.scope}`,provider:c.provider,scope:String(c.scope),account_id:accountId,kind:c.kind,complete:+c.complete,record_count:Number(c.count||0),availability:c.availability||null,heatmap_availability:c.heatmap_availability||null,scan_id:String(scanId),observed_at:c.observed_at||instant(),...(c.kind==='standings'?{source_division_id:ref(c.division_id||c.scope)}:{})};
  });
  if(componentCoverage.length) {
    const prior=(await repo.db.prepare('SELECT id,complete,record_count,availability,heatmap_availability FROM source_component_coverage WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(componentCoverage.map(c=>c.id))).all()).results;
    const updates=[];
    for(const c of componentCoverage){
      const saved=prior.find(p=>p.id===c.id),refresh=teamSnapRefreshCoverage(page,c,accountId);
      // A recent window is not an all-history receipt. Its count, freshness and
      // current progress are retained by the source job's validated checkpoint.
      if(refresh?.recent)continue;
      if(refresh&&!refresh.terminal){
        if(saved&&saved.availability===c.availability&&saved.heatmap_availability===c.heatmap_availability&&
          (saved.complete===0||refresh.full&&saved.complete===1&&saved.record_count===refresh.full.count))continue;
        c.record_count=0;
      }
      if(saved&&saved.complete===c.complete&&saved.record_count===c.record_count&&saved.availability===c.availability&&saved.heatmap_availability===c.heatmap_availability)continue;
      updates.push(c);changed=true;
      const m=c.scope.match(/^(trace|teamsnap):([A-Za-z0-9._-]+):(trace|teamsnap):([A-Za-z0-9._-]+)/);
      if(m)eventIds.add(ref(`${m[1]}:${m[2]}`));
      else if(c.provider==='teamsnap'&&['events','attendance'].includes(c.kind)&&/^teamsnap:[A-Za-z0-9._-]+$/.test(c.scope))genericTeamIds.add(ref(c.scope));
      else if(c.kind==='standings')divisionIds.add(c.source_division_id);
    }
    if(updates.length)add("INSERT INTO source_component_coverage SELECT json_extract(value,'$.id'),json_extract(value,'$.provider'),json_extract(value,'$.scope'),json_extract(value,'$.account_id'),json_extract(value,'$.kind'),json_extract(value,'$.complete'),json_extract(value,'$.record_count'),json_extract(value,'$.availability'),json_extract(value,'$.heatmap_availability'),json_extract(value,'$.scan_id'),json_extract(value,'$.observed_at') FROM json_each(?) WHERE $FENCE ON CONFLICT(id) DO UPDATE SET complete=excluded.complete,record_count=excluded.record_count,availability=excluded.availability,heatmap_availability=excluded.heatmap_availability,scan_id=excluded.scan_id,observed_at=excluded.observed_at",JSON.stringify(updates));
  }
  // Dirty fan-out consumes typed competition/division/event IDs directly in
  // sourceConsumerQuery; reverse team expansion here had no consumer.
  return {changed,statements,affectedGenericSourceTeamIds:changed?[...genericTeamIds]:[],affectedDivisionIds:changed?[...divisionIds]:[],affectedCompetitionIds:changed?[...competitionIds]:[],affectedEventIds:changed?[...eventIds]:[]};
}
