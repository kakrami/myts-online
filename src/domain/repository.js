import {localMidnight} from './calendar.js';
import {sourceConsumerQuery} from './source-consumers.js';
import {identityQuery,selectedIdentitySources,identityPage} from './identity-commands.js';
import {buildAuxiliaryPage} from './auxiliary.js';
import {auxiliaryKey} from './auxiliary.js';
import {buildPublicCorrespondences} from './correspondence.js';
import {nativeCanonicalId} from './identity.js';
import {eventPresentation,playerPresentation,localEventDay} from './presentation.js';
import {buildProjectionPage} from './projector.js';
const PUBLIC = new Set(["gotsport", "live"]);
const PRIVATE = new Set(["teamsnap", "trace"]);
const stamp = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const fail = (message, code = "invalid_request", status = 400) => Object.assign(new Error(message), { code, status });
const requireValue = (value, message, code, status) => { if (!value) throw fail(message, code, status); return value; };
const parse = (value) => typeof value === "string" ? JSON.parse(value || "{}") : value || {};
const byteSize = (value) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length;
const bounded = (value, max = 64000) => { requireValue(byteSize(value) <= max, "A source record exceeds its bound.", "record_size", 413); return JSON.stringify(value); };
const VOLATILE = new Set(["observed_at", "verified_at", "catalog_scan_id", "scan_id","checked_at","expires_at"]);
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter((key) => !VOLATILE.has(key)).map((key) => [key, key==='observations'&&Array.isArray(value[key])?value[key].map(o=>stable(Object.fromEntries(Object.entries(o).filter(([k])=>!['at','retrieved_at'].includes(k))))):stable(value[key])]));
  return value;
}
async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(stable(value))))), (v) => v.toString(16).padStart(2,"0")).join("");
}
function native(value) { return requireValue(/^[A-Za-z0-9._-]{1,160}$/.test(String(value || "")), "Invalid native identity.") && String(value); }
export function sourceKey(provider, nativeId, accountId = null) {
  requireValue(PUBLIC.has(provider) || PRIVATE.has(provider), "Unsupported provider.");
  requireValue(PUBLIC.has(provider) ? !accountId : !!accountId, "Wrong source authorization scope.", "source_scope", 403);
  return `${provider}/${encodeURIComponent(accountId || "public")}/${encodeURIComponent(native(nativeId))}`;
}
function reference(value, accountId) {
  if (!value) return null;
  const at = String(value).indexOf(":");
  requireValue(at > 0, "Invalid adapter source reference.");
  const provider = value.slice(0,at);
  return sourceKey(provider,value.slice(at+1),PUBLIC.has(provider) ? null : accountId);
}
function contextReference(value,provider,accountId) {
  if(!value)return null;
  requireValue(String(value).startsWith(provider+':'),"Competition and division references must belong to the fixture provider.","source_scope",403);
  return auxiliaryKey(value,accountId);
}
function kickoff(value) {
  if (!value) return null;
  requireValue(/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), "Kickoff needs an explicit timezone.");
  return new Date(value).toISOString();
}
function day(value) {
  if (!value) return null;
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value,"Invalid local date.");
  return value;
}
function score(value) {
  if (value === null || value === undefined || value === "") return null;
  requireValue(Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=1000,"Invalid score.");
  return Number(value);
}
const ROOTS = `WITH roots AS (SELECT source_team_id AS id FROM team_source_attachments WHERE app_team_id=? AND team_season_id=? AND active=1), sources AS (SELECT id FROM roots UNION SELECT b FROM source_team_links WHERE a IN (SELECT id FROM roots) UNION SELECT a FROM source_team_links WHERE b IN (SELECT id FROM roots))`;
const SOURCE_COLUMNS = {
  source_teams: ["id","provider","scope","account_id","native_id","name","name_authority","club_key","season_label","archived","evidence","provenance","content_hash","observed_at"],
  source_players: ["id","provider","scope","account_id","native_id","name","jersey","evidence","provenance","content_hash","observed_at"],
  source_events: ["id","provider","scope","account_id","native_id","competition_key","division_key","match_number","starts_at","local_day","time_precision","type","status","conditional","home_source_team_id","away_source_team_id","home_label","away_label","home_score","away_score","title","venue","evidence","provenance","content_hash","observed_at"],
};

export class DomainRepository {
  constructor(db,{inlineProjection=false}={}) { this.db=db;this.inlineProjection=inlineProjection; }
  async state() { return this.db.prepare("SELECT * FROM domain_installation WHERE id=1").first(); }
  async team(teamId) {
    return requireValue(await this.db.prepare("SELECT t.*,s.id AS season_id,s.start_day,s.end_day,s.include_june FROM app_teams t JOIN team_seasons s ON s.app_team_id=t.id AND s.year=t.season_year WHERE t.id=?").bind(teamId).first(),"Team was not found.","not_found",404);
  }
  async domainBatch(build,precondition={sql:"1",params:[]}) {
    const before=await this.state(), token=id(), guard="EXISTS(SELECT 1 FROM domain_fences WHERE id='domain' AND token=?)";
    const result=await this.db.batch([
      this.db.prepare(`INSERT INTO domain_fences SELECT 'domain',? WHERE EXISTS(SELECT 1 FROM domain_installation WHERE id=1 AND mutation_revision=?) AND (${precondition.sql}) ON CONFLICT(id) DO UPDATE SET token=excluded.token`).bind(token,before.mutation_revision,...precondition.params),
      ...build(guard,token,before),
      this.db.prepare(`UPDATE domain_installation SET mutation_revision=mutation_revision+1 WHERE id=1 AND ${guard}`).bind(token),
    ]);
    requireValue(result.at(-1).meta.changes===1,"The domain changed; retry the operation.","revision_conflict",409);
    return result;
  }
  async registerAccount({provider,nativeId,name="Account",accountId:suppliedAccountId=null,additionalStatements=()=>[],precondition={sql:"1",params:[]}}) {
    requireValue(PRIVATE.has(provider),"This provider has no private account.");
    nativeId=native(nativeId);
    const old=await this.db.prepare("SELECT * FROM provider_accounts WHERE provider=? AND native_id=?").bind(provider,nativeId).first();
    if(suppliedAccountId) {
      requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedAccountId),"Invalid server account identity.");
      requireValue(!old||old.id===suppliedAccountId,"Account identity changed before credential encryption.","account_identity_conflict",409);
    }
    const accountId=old?.id||suppliedAccountId||id();
    await this.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO provider_accounts(id,provider,native_id,name) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(provider,native_id) DO UPDATE SET name=excluded.name,generation=provider_accounts.generation+1,active=1`).bind(accountId,provider,nativeId,String(name),token),
      ...additionalStatements(guard,token,accountId),
    ],precondition);
    return this.db.prepare("SELECT * FROM provider_accounts WHERE provider=? AND native_id=?").bind(provider,nativeId).first();
  }
  async disconnectAccount(accountId,{additionalStatements=()=>[],precondition={sql:"1",params:[]}}={}) {
    requireValue(await this.db.prepare("SELECT id FROM provider_accounts WHERE id=?").bind(accountId).first(),"Account was not found.","not_found",404);
    await this.domainBatch((guard,token)=>[
      this.db.prepare(`UPDATE provider_accounts SET active=0,generation=generation+1 WHERE id=? AND ${guard}`).bind(accountId,token),
      ...additionalStatements(guard,token,accountId),
      this.db.prepare(`UPDATE team_read_state SET status_revision=status_revision+1 WHERE app_team_id IN(SELECT app_team_id FROM team_source_attachments WHERE account_id=? AND active=1) AND ${guard}`).bind(accountId,token),
    ],precondition);
    return this.db.prepare("SELECT * FROM provider_accounts WHERE id=?").bind(accountId).first();
  }
  async createTeam({name,timezone="America/Los_Angeles",seasonYear,requestId=null}) {
    name=String(name||"").trim();
    requireValue(name && name.length<=100,"Enter a team name.");
    try { new Intl.DateTimeFormat("en-US",{timeZone:timezone}).format(); } catch { throw fail("Invalid team timezone."); }
    const now=new Date();
    seasonYear=Number(seasonYear??(now.getUTCFullYear()-(now.getUTCMonth()<5?1:0)));
    requireValue(Number.isInteger(seasonYear)&&seasonYear>=2000&&seasonYear<=2100,"Invalid season.");
    if (requestId) {
      const previous=await this.db.prepare("SELECT id FROM app_teams WHERE request_id=?").bind(requestId).first();
      if (previous) return this.team(previous.id);
    }
    const teamId=id(),seasonId=id();
    await this.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO app_teams SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(teamId,name,timezone,seasonYear,requestId,stamp(),token),
      this.db.prepare(`INSERT INTO team_seasons SELECT ?,?,?,?,?,?,?,1 WHERE ${guard}`).bind(seasonId,teamId,seasonYear,`${seasonYear}-06-01`,`${seasonYear+1}-06-01`,localMidnight(`${seasonYear}-06-01`,timezone),localMidnight(`${seasonYear+1}-06-01`,timezone),token),
      this.db.prepare(`INSERT INTO team_read_state(app_team_id,pending) SELECT ?,1 WHERE ${guard}`).bind(teamId,token),
      this.db.prepare(`INSERT INTO team_projection_state(team_season_id,app_team_id) SELECT ?,? WHERE ${guard}`).bind(seasonId,teamId,token),
    ]);
    return this.team(teamId);
  }
  async ensureSeason(teamId,year) {
    const team=await this.team(teamId);year=Number(year);
    requireValue(Number.isInteger(year)&&year>=2000&&year<=2100,"Invalid season.");
    const previous=await this.db.prepare("SELECT * FROM team_seasons WHERE app_team_id=? AND year=?").bind(teamId,year).first();
    if(previous) return previous;
    const seasonId=id();
    await this.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO team_seasons SELECT ?,?,?,?,?,?,?,1 WHERE ${guard}`).bind(seasonId,teamId,year,`${year}-06-01`,`${year+1}-06-01`,localMidnight(`${year}-06-01`,team.timezone),localMidnight(`${year+1}-06-01`,team.timezone),token),
      this.db.prepare(`INSERT INTO team_projection_state(team_season_id,app_team_id) SELECT ?,? WHERE ${guard}`).bind(seasonId,teamId,token),
    ],{sql:"EXISTS(SELECT 1 FROM app_teams WHERE id=?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=?)",params:[teamId,teamId]});
    return this.db.prepare("SELECT * FROM team_seasons WHERE id=?").bind(seasonId).first();
  }
  async buildSourcePage(page) {
    const {accountId=null,generation=null,records={},fixtures=[],provenance="provider"}=page;
    requireValue(["provider","file_import"].includes(provenance),"Invalid observation provenance.");
    if(provenance==="file_import")requireValue(!(records.identity_links||[]).length&&!(page.sourceCoverage||[]).length&&!(page.replacements||[]).length,"File observations cannot assert provider verification or terminal scope.","import_authority",403);
    const before=await this.state();
    const account=accountId?await this.db.prepare("SELECT * FROM provider_accounts WHERE id=?").bind(accountId).first():null;
    if (accountId) requireValue(account?.active===1&&account.generation===generation,"Authorization changed before source save.","stale_generation",409);
    const scopeFor=(provider)=>{
      if (PUBLIC.has(provider)) return {scope:"public",account_id:null};
      requireValue(account&&account.provider===provider,"Private source belongs to another account.","source_scope",403);
      return {scope:accountId,account_id:accountId};
    };
    const rows={source_teams:[],source_players:[],source_events:[]},previousEvents=[];
    for (const r of records.teams||[]) {
      const scoped=scopeFor(r.provider),evidence=parse(r.details);
      const authority=evidence.profile?0:evidence.account_owned||evidence.catalog_verified?1:evidence.proof||evidence.external_identity_name?2:3;
      rows.source_teams.push({id:sourceKey(r.provider,r.native_id,scoped.account_id),provider:r.provider,...scoped,native_id:native(r.native_id),name:String(r.name||"Team"),name_authority:authority,club_key:r.club_id||null,season_label:r.season||null,archived:r.archived?1:0,evidence:bounded(evidence),observed_at:r.observed_at||stamp()});
    }
    for (const r of records.players||[]) {
      const scoped=scopeFor(r.provider),evidence=parse(r.details);
      rows.source_players.push({id:sourceKey(r.provider,r.native_id,scoped.account_id),provider:r.provider,...scoped,native_id:native(r.native_id),name:String(r.name||"Player"),jersey:r.jersey==null?null:String(r.jersey),evidence:bounded(evidence),observed_at:r.observed_at||stamp()});
    }
    for (const r of fixtures) {
      const scoped=scopeFor(r.provider),evidence=parse(r.payload),starts=kickoff(r.starts_at),local=day(r.local_day);
      requireValue(["game","practice","event"].includes(r.type),"Unsupported event type.");
      requireValue([r.home_id,r.away_id].filter(Boolean).every(v=>String(v).startsWith(r.provider+":")),"Fixture participants must belong to the fixture provider.","source_scope",403);
      rows.source_events.push({id:sourceKey(r.provider,r.native_id,scoped.account_id),provider:r.provider,...scoped,native_id:native(r.native_id),competition_key:contextReference(r.competition_id||evidence.competition_id,r.provider,scoped.account_id),division_key:contextReference(r.division_id||evidence.division_id,r.provider,scoped.account_id),match_number:evidence.match_number==null?null:String(evidence.match_number),starts_at:starts,local_day:local,time_precision:starts?"instant":local?"day":"pending",type:r.type,status:String(r.status||"SCHEDULED"),conditional:r.conditional?1:0,home_source_team_id:reference(r.home_id,accountId),away_source_team_id:reference(r.away_id,accountId),home_label:String(evidence.home_name||"Home"),away_label:String(evidence.away_name||"Away"),home_score:score(r.home_score),away_score:score(r.away_score),title:String(evidence.title||""),venue:String(evidence.venue||""),evidence:bounded(evidence),observed_at:r.observed_at||stamp()});
    }
    let roster=(records.team_players||[]).map((r)=>({source_team_id:reference(r.team_id,accountId),source_player_id:reference(r.player_id,accountId),active:r.active?1:0,scan_id:String(r.scan_id||""),provenance}));
    let links=(records.identity_links||[]).map((r)=>{
      const proof=parse(r.evidence),a=reference(r.a,null),b=reference(r.b,null);
      requireValue(r.kind==="provider_external_key"&&a.startsWith("gotsport/public/")&&b.startsWith("live/public/")&&String(proof.team_id)===r.a.split(":")[1]&&String(proof.live_team_id)===r.b.split(":")[1]&&String(proof.external_key)===proof.team_id&&proof.club&&proof.season&&Number.isFinite(Date.parse(proof.verified_at)),"Team identity evidence is not verified.","identity_evidence",409);
      return {a,b,kind:r.kind,evidence:bounded(proof,16000)};
    });
    const total=Object.values(rows).reduce((n,list)=>n+list.length,0)+roster.length+links.length;
    requireValue(total<=500&&byteSize(rows)<=1750000,"Source page needs a smaller slice.","page_size",413);
    for (const [table,list] of Object.entries(rows)) if(list.length) {
      const old=(await this.db.prepare(`SELECT * FROM ${table} WHERE id IN(SELECT value FROM json_each(?))`).bind(JSON.stringify(list.map((r)=>r.id))).all()).results;
      const byId=new Map(old.map((r)=>[r.id,r]));
      for(const row of list) {
        const previous=byId.get(row.id);row.provenance=provenance;
        if(table==="source_teams"&&previous) {
          const incoming=parse(row.evidence),saved=parse(previous.evidence);
          if(row.name_authority>previous.name_authority) {
            row.name=previous.name;row.name_authority=previous.name_authority;row.archived=previous.archived;
            row.evidence=bounded({...incoming,...saved,...(incoming.proof?{proof:incoming.proof}:{}),...(incoming.external_identity_name?{external_identity_name:incoming.external_identity_name}:{})});
          } else {
            const merged={...saved,...incoming};
            if(saved.account_owned===true||incoming.account_owned===true) merged.account_owned=true;
            row.evidence=bounded(merged);
          }
          row.club_key=row.club_key||previous.club_key;
          row.season_label=row.season_label||previous.season_label;
        }
        row.content_hash=await hash({...row,evidence:parse(row.evidence),content_hash:undefined});
      }
      rows[table]=list.filter(r=>!byId.has(r.id)||!(provenance==="file_import"&&byId.get(r.id).provenance==="provider")&&(byId.get(r.id).provenance==="file_import"&&provenance==="provider"||byId.get(r.id).content_hash!==r.content_hash&&r.observed_at>=byId.get(r.id).observed_at));
      if(table==='source_events')previousEvents.push(...old.filter(r=>rows[table].some(update=>update.id===r.id)));
    }
    if(roster.length) {
      const old=(await this.db.prepare("SELECT * FROM source_roster_memberships WHERE source_team_id IN(SELECT value FROM json_each(?))").bind(JSON.stringify([...new Set(roster.map((r)=>r.source_team_id))])).all()).results;
      const existing=new Map(old.map((r)=>[r.source_team_id+"|"+r.source_player_id,r]));
      roster=roster.filter(r=>{const previous=existing.get(r.source_team_id+"|"+r.source_player_id);return !previous||!(provenance==="file_import"&&previous.provenance==="provider")&&(previous.active!==r.active||previous.provenance!==provenance);});
    }
    const allLinks=links;
    if(links.length) {
      const old=(await this.db.prepare("SELECT * FROM source_team_links WHERE a IN(SELECT value FROM json_each(?))").bind(JSON.stringify(links.map((r)=>r.a))).all()).results;
      const checked=await Promise.all(links.map(async r=>{const previous=old.find(p=>p.a===r.a&&p.b===r.b);if(!previous)return r;const fresh=p=>Date.parse(parse(p.evidence).expires_at)>Date.now();return await hash(parse(previous.evidence))!==await hash(parse(r.evidence))||fresh(previous)!==fresh(r)?r:null;}));links=checked.filter(Boolean);
    }
    const ownedKeys=account&&provenance==='provider'?(records.teams||[]).filter(r=>parse(r.details).account_owned===true).map(r=>sourceKey(r.provider,r.native_id,accountId)):[];
    const knownOwned=ownedKeys.length?(await this.db.prepare('SELECT source_team_id FROM account_source_teams WHERE account_id=? AND source_team_id IN(SELECT value FROM json_each(?))').bind(accountId,JSON.stringify(ownedKeys)).all()).results.map(r=>r.source_team_id):[];
    const entitlementAdds=ownedKeys.filter(key=>!knownOwned.includes(key));
    const auxiliary=await buildAuxiliaryPage(this,{...page,accountProvider:account?.provider||null});
    const changed=Object.values(rows).some((list)=>list.length)||roster.length>0||links.length>0||entitlementAdds.length>0||auxiliary.changed;
    const genericIds=[...new Set([...rows.source_teams.map(r=>r.id),...roster.map(r=>r.source_team_id),...links.flatMap(r=>[r.a,r.b]),...auxiliary.affectedGenericSourceTeamIds])];
    const consumerQuery=sourceConsumerQuery({genericIds,playerIds:rows.source_players.map(r=>r.id),eventFacts:[...rows.source_events,...previousEvents],eventIds:auxiliary.affectedEventIds,divisionIds:auxiliary.affectedDivisionIds,competitionIds:auxiliary.affectedCompetitionIds,links:allLinks});
    const affected=changed?(await this.db.prepare(consumerQuery.sql+' ORDER BY c.app_team_id,c.team_season_id LIMIT 128').bind(...consumerQuery.params).all()).results:[];
    const statements=[],add=(sql,...params)=>statements.push({sql,params});
    if(!changed&&!auxiliary.statements.length&&!allLinks.length) return {changed:false,statements,affectedTeams:[],ignored_app_records:["spaces","space_teams"].filter((key)=>records[key]?.length)};
    // An optimistic precondition fails the entire enclosing source/job transaction.
    add(`INSERT INTO domain_source_preconditions SELECT 1,?,CASE WHEN ${account?"EXISTS(SELECT 1 FROM provider_accounts WHERE id=? AND generation=? AND active=1)":"1"} THEN (SELECT source_revision FROM domain_installation WHERE id=1) ELSE -1 END WHERE $FENCE ON CONFLICT(id) DO UPDATE SET expected_revision=excluded.expected_revision,actual_revision=excluded.actual_revision`,before.source_revision,...(account?[accountId,generation]:[]));
    for (const [table,list] of Object.entries(rows)) if (list.length) {
      const cols=SOURCE_COLUMNS[table],data=JSON.stringify(list),updates=cols.filter((c)=>c!=="id").map((c)=>`${c}=excluded.${c}`).join(",");
      add(`INSERT INTO ${table}(${cols.join(",")}) SELECT ${cols.map((c)=>`json_extract(value,'$.${c}')`).join(",")} FROM json_each(?) WHERE $FENCE ON CONFLICT(id) DO UPDATE SET ${updates}`,data);
    }
    if(entitlementAdds.length)add("INSERT OR IGNORE INTO account_source_teams SELECT ?,value FROM json_each(?) WHERE $FENCE",accountId,JSON.stringify(entitlementAdds));
    if (roster.length) add(`INSERT INTO source_roster_memberships SELECT json_extract(value,'$.source_team_id'),json_extract(value,'$.source_player_id'),json_extract(value,'$.active'),json_extract(value,'$.scan_id'),json_extract(value,'$.provenance') FROM json_each(?) WHERE $FENCE ON CONFLICT(source_team_id,source_player_id) DO UPDATE SET active=excluded.active,scan_id=excluded.scan_id,provenance=excluded.provenance`,JSON.stringify(roster));
    if (allLinks.length) add(`INSERT INTO source_team_links SELECT json_extract(value,'$.a'),json_extract(value,'$.b'),json_extract(value,'$.kind'),json_extract(value,'$.evidence') FROM json_each(?) WHERE $FENCE ON CONFLICT(a,b) DO UPDATE SET evidence=excluded.evidence`,JSON.stringify(allLinks));
    if (rows.source_events.length) {
      const data=JSON.stringify(rows.source_events);
      const canonical=await Promise.all(rows.source_events.filter(r=>PUBLIC.has(r.provider)).map(async r=>({source_id:r.id,id:await nativeCanonicalId('event',r.id)})));
      if(canonical.length){add("INSERT OR IGNORE INTO events SELECT json_extract(value,'$.id'),? FROM json_each(?) WHERE $FENCE",stamp(),JSON.stringify(canonical));add("INSERT OR IGNORE INTO event_source_links(source_event_id,event_id,reason,evidence) SELECT json_extract(value,'$.source_id'),json_extract(value,'$.id'),'source_identity','{}' FROM json_each(?) WHERE $FENCE",JSON.stringify(canonical));}
      add(`DELETE FROM source_event_teams WHERE source_event_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND EXISTS(SELECT 1 FROM source_events e WHERE e.id=source_event_teams.source_event_id AND source_event_teams.source_team_id IS NOT CASE source_event_teams.side WHEN 'home' THEN e.home_source_team_id ELSE e.away_source_team_id END) AND $FENCE`,data);
      for (const side of ["home","away"]) add(`INSERT OR IGNORE INTO source_event_teams SELECT ${side}_source_team_id,id,'${side}' FROM source_events WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${side}_source_team_id IS NOT NULL AND $FENCE`,data);
    }
    statements.push(...auxiliary.statements);
    if(changed) {
      if(rows.source_events.some(r=>PUBLIC.has(r.provider))||rows.source_teams.some(r=>PUBLIC.has(r.provider))||links.length||auxiliary.affectedDivisionIds.length||auxiliary.affectedCompetitionIds.length)add("UPDATE domain_installation SET public_revision=public_revision+1 WHERE id=1 AND $FENCE");
      if(rows.source_teams.length)add("INSERT INTO source_team_state SELECT value,1 FROM json_each(?) WHERE $FENCE ON CONFLICT(source_team_id) DO UPDATE SET content_revision=source_team_state.content_revision+1",JSON.stringify(rows.source_teams.map(r=>r.id)));
      const eventIds=[...new Set([...rows.source_events.map(r=>r.id),...auxiliary.affectedEventIds])];
      if(eventIds.length)add("INSERT INTO source_event_state SELECT value,1 FROM json_each(?) WHERE $FENCE ON CONFLICT(source_event_id) DO UPDATE SET input_revision=source_event_state.input_revision+1",JSON.stringify(eventIds));
      const divisionIds=[...new Set([...[...rows.source_events,...previousEvents].map(r=>r.division_key).filter(Boolean),...auxiliary.affectedDivisionIds])].filter(r=>/^(gotsport|live)\/public\//.test(r));
      if(divisionIds.length){const scopes=divisionIds.map(source_division_id=>({id:`${source_division_id.split('/')[0]}|${source_division_id}`,provider:source_division_id.split('/')[0],source_division_id}));add("INSERT INTO source_division_coverage(id,provider,source_division_id,complete,record_count,scan_id,observed_at,content_revision) SELECT json_extract(value,'$.id'),json_extract(value,'$.provider'),json_extract(value,'$.source_division_id'),0,0,'',?,1 FROM json_each(?) WHERE $FENCE ON CONFLICT(id) DO UPDATE SET content_revision=source_division_coverage.content_revision+1",stamp(),JSON.stringify(scopes));add("UPDATE source_divisions SET content_revision=content_revision+1 WHERE id IN(SELECT value FROM json_each(?)) AND $FENCE",JSON.stringify(divisionIds));}
      const competitionIds=[...new Set([...[...rows.source_events,...previousEvents].map(r=>r.competition_key).filter(Boolean),...auxiliary.affectedCompetitionIds])];
      if(competitionIds.length)add("UPDATE source_competitions SET content_revision=content_revision+1 WHERE id IN(SELECT value FROM json_each(?)) AND $FENCE",JSON.stringify(competitionIds));
      add(`UPDATE team_projection_state SET pending=1,source_revision=source_revision+1,input_revision=input_revision+1 WHERE team_season_id IN(SELECT team_season_id FROM(${consumerQuery.sql})) AND $FENCE`,...consumerQuery.params);
      add(`UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id IN(SELECT app_team_id FROM(${consumerQuery.sql})) AND $FENCE`,...consumerQuery.params);
    }
    add("UPDATE domain_installation SET source_revision=source_revision+? WHERE id=1 AND $FENCE",changed?1:0);
    return {changed,statements,affectedTeams:changed?affected:[],ignored_app_records:["spaces","space_teams"].filter((key)=>records[key]?.length)};
  }
  async ingestSourcePage(page) {
    const built=await this.buildSourcePage(page);
    if(!built.statements.length) return built;
    const token=id(),guard="EXISTS(SELECT 1 FROM domain_fences WHERE id='source' AND token=?)";
    const result=await this.db.batch([
      this.db.prepare("INSERT INTO domain_fences VALUES('source',?) ON CONFLICT(id) DO UPDATE SET token=excluded.token").bind(token),
      ...built.statements.map(({sql,params})=>this.db.prepare(sql.replaceAll("$FENCE",guard)).bind(...params,token)),
    ]);
    requireValue(result.at(-1).meta.changes===1,"Source generation changed before save.","stale_generation",409);
    return built;
  }
  async attachTeam({teamId,seasonId,sourceTeamId,accountId=null,profileBinding=null}) {
    const team=await this.team(teamId); seasonId=seasonId||team.season_id;
    requireValue(await this.db.prepare("SELECT id FROM team_seasons WHERE id=? AND app_team_id=?").bind(seasonId,teamId).first(),"Season is outside this team.","source_scope",403);
    const source=requireValue(await this.db.prepare("SELECT * FROM source_teams WHERE id=?").bind(sourceTeamId).first(),"Source team was not discovered.","not_found",404);
    requireValue(source.account_id===accountId,"Select the account that discovered this team.","source_scope",403);
    if (accountId) requireValue(await this.db.prepare("SELECT 1 AS ok FROM account_source_teams WHERE account_id=? AND source_team_id=?").bind(accountId,sourceTeamId).first(),"Account has no access to that team.","source_scope",403);
    const previous=await this.db.prepare("SELECT * FROM team_source_attachments WHERE app_team_id=? AND team_season_id=? AND source_team_id=?").bind(teamId,seasonId,sourceTeamId).first(),attachmentId=previous?.id||id();
    if(profileBinding)requireValue(profileBinding.team_id===teamId&&profileBinding.source_team_id===sourceTeamId&&typeof profileBinding.condition==='string'&&profileBinding.condition.length<=8000&&Array.isArray(profileBinding.condition_params)&&Array.isArray(profileBinding.statements)&&profileBinding.statements.length<=8&&profileBinding.statements.every(s=>typeof s.sql==='string'&&s.sql.length<=12000&&Array.isArray(s.params)),"Invalid prepared team profile binding.");
    if (!previous?.active||profileBinding) await this.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO team_source_attachments(id,app_team_id,team_season_id,source_team_id,account_id) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(app_team_id,team_season_id,source_team_id) DO UPDATE SET active=1,generation=team_source_attachments.generation+1`).bind(attachmentId,teamId,seasonId,sourceTeamId,accountId,token),
      ...(profileBinding?[this.db.prepare(`INSERT INTO feature_write_fences VALUES(?,CASE WHEN (${profileBinding.condition}) AND ${guard} THEN 1 ELSE 0 END)`).bind(token,...profileBinding.condition_params,token),...profileBinding.statements.map(s=>this.db.prepare(s.sql).bind(...s.params)),this.db.prepare('DELETE FROM feature_write_fences WHERE token=?').bind(token)]:[]),
      this.db.prepare(`UPDATE team_projection_state SET pending=1,input_revision=input_revision+1 WHERE team_season_id=? AND ${guard}`).bind(seasonId,token),
      this.db.prepare(`UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(teamId,token),
    ],{sql:`EXISTS(SELECT 1 FROM team_seasons WHERE id=? AND app_team_id=?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=?) AND EXISTS(SELECT 1 FROM source_teams WHERE id=? AND account_id IS ?) AND (? IS NULL OR EXISTS(SELECT 1 FROM account_source_teams a JOIN provider_accounts p ON p.id=a.account_id WHERE a.account_id=? AND a.source_team_id=? AND p.active=1)) AND (${profileBinding?.condition||'1'})`,params:[seasonId,teamId,teamId,sourceTeamId,accountId,accountId,accountId,sourceTeamId,...(profileBinding?.condition_params||[])]}).catch(error=>{if(String(error.message).includes('feature_revision_current'))throw fail('The team profile changed; reload it.','revision_conflict',409);throw error;});
    if(this.inlineProjection) await this.projectTeam(teamId,seasonId);
    return {...await this.db.prepare("SELECT * FROM team_source_attachments WHERE id=?").bind(attachmentId).first(),affectedTeams:[{app_team_id:teamId,team_season_id:seasonId}]};
  }
  async unlinkTeam({teamId,attachmentId}) {
    await this.team(teamId);
    const attachment=requireValue(await this.db.prepare("SELECT * FROM team_source_attachments WHERE id=? AND app_team_id=?").bind(attachmentId,teamId).first(),"Attachment is outside this team.","source_scope",403);
    await this.domainBatch((guard,token)=>[
      this.db.prepare(`UPDATE team_source_attachments SET active=0,generation=generation+1 WHERE id=? AND app_team_id=? AND active=1 AND ${guard}`).bind(attachmentId,teamId,token),
      this.db.prepare(`UPDATE team_projection_state SET pending=1,input_revision=input_revision+1 WHERE team_season_id=? AND ${guard}`).bind(attachment.team_season_id,token),
      this.db.prepare(`UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id=? AND ${guard}`).bind(teamId,token),
    ],{sql:"EXISTS(SELECT 1 FROM app_teams WHERE id=?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=?) AND EXISTS(SELECT 1 FROM team_source_attachments WHERE id=? AND app_team_id=?)",params:[teamId,teamId,attachmentId,teamId]});
    const affectedTeams=[{app_team_id:teamId,team_season_id:attachment.team_season_id}];
    if(this.inlineProjection) await this.projectConsumers(affectedTeams);
    return {affectedTeams};
  }
  async visibleRows(teamId,kind,seasonId=null) {
    const team=await this.team(teamId);seasonId=seasonId||team.season_id;
    const season=requireValue(await this.db.prepare("SELECT * FROM team_seasons WHERE id=? AND app_team_id=?").bind(seasonId,teamId).first(),"Season is outside this team.","source_scope",403);
    if (kind==="player") {
      const roster=(await this.db.prepare(`${ROOTS} SELECT DISTINCT p.*,l.player_id AS canonical_id FROM source_players p JOIN source_roster_memberships r ON r.source_player_id=p.id LEFT JOIN player_source_links l ON l.source_player_id=p.id WHERE r.source_team_id IN(SELECT id FROM sources) AND r.active=1 ORDER BY CASE p.provider WHEN 'teamsnap' THEN 0 ELSE 1 END,p.id`).bind(teamId,seasonId).all()).results;
      const appearances=(await this.db.prepare(`${ROOTS} SELECT DISTINCT p.*,l.player_id AS canonical_id,e.starts_at AS event_start,e.local_day AS event_day FROM source_game_members m JOIN source_players p ON p.id=m.source_player_id AND p.account_id=m.account_id JOIN source_events e ON e.id=m.source_event_id AND e.account_id=m.account_id JOIN source_event_teams t ON t.source_event_id=e.id AND t.source_team_id=m.source_team_id AND t.side=m.side LEFT JOIN player_source_links l ON l.source_player_id=p.id WHERE m.source_team_id IN(SELECT id FROM sources) AND m.dummy=0`).bind(teamId,seasonId).all()).results;
      const ids=new Map(roster.map(p=>[p.id,p]));
      for(const p of appearances) {const local=p.event_start?new Intl.DateTimeFormat('en-CA',{timeZone:team.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.event_start)):p.event_day;if(local&&local>=season.start_day&&local<season.end_day){const {event_start,event_day,...player}=p;if(!ids.has(p.id))ids.set(p.id,player);}}
      return [...ids.values()].sort((a,b)=>(a.provider==='teamsnap'?0:1)-(b.provider==='teamsnap'?0:1)||a.id.localeCompare(b.id));
    }
    return (await this.db.prepare(`${ROOTS} SELECT DISTINCT e.*,l.event_id AS canonical_id,t.side AS own_side FROM source_events e JOIN source_event_teams t ON t.source_event_id=e.id LEFT JOIN event_source_links l ON l.source_event_id=e.id WHERE t.source_team_id IN(SELECT id FROM sources) ORDER BY CASE e.provider WHEN 'gotsport' THEN 0 WHEN 'live' THEN 1 WHEN 'teamsnap' THEN 2 ELSE 3 END,e.id`).bind(teamId,seasonId).all()).results;
  }
  async buildProjection(teamId,seasonId=null) {
    const team=await this.team(teamId);seasonId=seasonId||team.season_id;
    const season=requireValue(await this.db.prepare("SELECT * FROM team_seasons WHERE id=? AND app_team_id=?").bind(seasonId,teamId).first(),"Season is outside this team.","source_scope",403);
    const before=await this.state(),readState=await this.db.prepare("SELECT * FROM team_read_state WHERE app_team_id=?").bind(teamId).first(),[players,events,corrections]=await Promise.all([this.visibleRows(teamId,"player",seasonId),this.visibleRows(teamId,"event",seasonId),this.db.prepare("SELECT * FROM domain_overrides WHERE app_team_id=?").bind(teamId).all()]);
    const override=new Map(corrections.results.map((r)=>[`${r.kind}:${r.entity_id}`,parse(r.fields)])),newPlayers=[],newEvents=[];
    const correspondence=await buildPublicCorrespondences(this,events),autoEvents=[],eventAliases=[];
    for(const pair of correspondence.matches) {
      const a=events.find(e=>e.id===pair.a),b=events.find(e=>e.id===pair.b),canonical=a.canonical_id||b.canonical_id||id();
      const previousIds=[a.canonical_id,b.canonical_id].filter(Boolean);
      const conflicting=previousIds.some(v=>v!==canonical&&override.has(`event:${v}`));
      if(conflicting)continue; // An existing correction requires deliberate owner resolution.
      for(const old of previousIds)if(old!==canonical)eventAliases.push({merged_id:old,canonical_id:canonical});
      if(!previousIds.length)newEvents.push({id:canonical,source_id:a.id});
      for(const row of events)if([pair.a,pair.b].includes(row.id)||previousIds.includes(row.canonical_id))row.canonical_id=canonical;
      autoEvents.push({...pair,canonical_id:canonical});
    }
    const grouped=(list,kind)=>{
      const groups=new Map();
      for (const row of list) {
        const entityId=row.canonical_id||id();
        if (!row.canonical_id) (kind==="player"?newPlayers:newEvents).push({source_id:row.id,id:entityId});
        if (!groups.has(entityId)) groups.set(entityId,[]);
        groups.get(entityId).push(row);
      }
      return groups;
    };
    const roster=[];
    for(const [playerId,sources]of grouped(players,'player'))roster.push(playerPresentation(teamId,seasonId,playerId,sources,override.get(`player:${playerId}`)||{}));
    const fixtures=[];
    for(const [eventId,sources]of grouped(events,'event')) {
      const review=correspondence.reviews.some(p=>sources.some(s=>[p.a,p.b].includes(s.id)));
      const row=eventPresentation(team,season,eventId,sources,override.get(`event:${eventId}`)||{},correspondence.canonicalCompetitions,correspondence.canonicalDivisions,review);
      if(row)fixtures.push(row);
    }
    roster.sort((a,b)=>a.player_id.localeCompare(b.player_id));fixtures.sort((a,b)=>a.event_id.localeCompare(b.event_id));
    const previous=await this.db.prepare("SELECT * FROM team_projection_state WHERE team_season_id=?").bind(seasonId).first(),digest=await hash({roster,fixtures,source_revision:previous.source_revision});
    const statements=[],add=(sql,...params)=>statements.push({sql,params});
    add("INSERT INTO domain_projection_preconditions SELECT 1,?,(SELECT mutation_revision FROM domain_installation WHERE id=1),?,(SELECT status_revision FROM team_read_state WHERE app_team_id=?) WHERE $FENCE ON CONFLICT(id) DO UPDATE SET expected_mutation=excluded.expected_mutation,actual_mutation=excluded.actual_mutation,expected_status=excluded.expected_status,actual_status=excluded.actual_status",before.mutation_revision,readState.status_revision,teamId);
    for (const [kind,list] of [["player",newPlayers],["event",newEvents]]) if (list.length) {
      const plural=kind==="player"?"players":"events",sourceColumn=kind==="player"?"source_player_id":"source_event_id",canonicalColumn=kind==="player"?"player_id":"event_id",data=JSON.stringify(list);
      add(`INSERT INTO ${plural} SELECT json_extract(value,'$.id'),? FROM json_each(?) WHERE $FENCE`,stamp(),data);
      add(`INSERT INTO ${kind}_source_links(${sourceColumn},${canonicalColumn},reason,evidence) SELECT json_extract(value,'$.source_id'),json_extract(value,'$.id'),'source_identity','{}' FROM json_each(?) WHERE $FENCE`,data);
    }
    for(const [kind,created]of [['competition',correspondence.newCompetitions],['division',correspondence.newDivisions]])if(created.length)add(`INSERT INTO ${kind==='competition'?'competitions':'divisions'} SELECT value,? FROM json_each(?) WHERE $FENCE`,stamp(),JSON.stringify([...new Set(created)]));
    for(const kind of ['competition','division']) {
      const links=correspondence.metadataLinks.filter(l=>l.kind===kind);if(!links.length)continue;
      add(`INSERT INTO ${kind}_source_links SELECT json_extract(value,'$.source_id'),json_extract(value,'$.id'),json_extract(value,'$.reason'),json_extract(value,'$.evidence') FROM json_each(?) WHERE $FENCE ON CONFLICT(source_${kind}_id) DO UPDATE SET ${kind}_id=excluded.${kind}_id,reason=excluded.reason,evidence=excluded.evidence`,JSON.stringify(links));
    }
    for(const kind of ['competition','division']) {
      const aliases=correspondence.metadataAliases.filter(a=>a.kind===kind);if(aliases.length)add(`INSERT INTO ${kind}_aliases SELECT json_extract(value,'$.merged_id'),json_extract(value,'$.canonical_id') FROM json_each(?) WHERE $FENCE ON CONFLICT(merged_id) DO UPDATE SET canonical_id=excluded.canonical_id`,JSON.stringify(aliases));
    }
    if(eventAliases.length) {
      add("INSERT INTO event_aliases SELECT json_extract(value,'$.merged_id'),json_extract(value,'$.canonical_id') FROM json_each(?) WHERE $FENCE ON CONFLICT(merged_id) DO UPDATE SET canonical_id=excluded.canonical_id",JSON.stringify(eventAliases));
      add("UPDATE event_source_links SET event_id=(SELECT json_extract(value,'$.canonical_id') FROM json_each(?) WHERE json_extract(value,'$.merged_id')=event_source_links.event_id) WHERE event_id IN(SELECT json_extract(value,'$.merged_id') FROM json_each(?)) AND $FENCE",JSON.stringify(eventAliases),JSON.stringify(eventAliases));
    }
    if(autoEvents.length) {
      add("INSERT INTO source_event_correspondences SELECT json_extract(value,'$.a'),json_extract(value,'$.b'),json_extract(value,'$.method'),json_extract(value,'$.proof'),json_extract(value,'$.verified_at'),json_extract(value,'$.status') FROM json_each(?) WHERE $FENCE ON CONFLICT(a) DO UPDATE SET proof=excluded.proof,status=excluded.status",JSON.stringify(autoEvents));
      for(const side of ['a','b'])add(`INSERT INTO event_source_links(source_event_id,event_id,reason,evidence) SELECT json_extract(value,'$.${side}'),json_extract(value,'$.canonical_id'),'strict_composite',json_extract(value,'$.proof') FROM json_each(?) WHERE $FENCE ON CONFLICT(source_event_id) DO UPDATE SET event_id=excluded.event_id,reason=excluded.reason,evidence=excluded.evidence`,JSON.stringify(autoEvents));
    }
    if(correspondence.reviews.length)add("UPDATE source_event_correspondences SET status='review',proof=(SELECT json_extract(value,'$.proof') FROM json_each(?) WHERE json_extract(value,'$.a')=source_event_correspondences.a) WHERE a IN(SELECT json_extract(value,'$.a') FROM json_each(?)) AND $FENCE",JSON.stringify(correspondence.reviews),JSON.stringify(correspondence.reviews));
    if (digest!==previous.projection_hash) {
      const runId=id();
      add("INSERT INTO team_projection_runs SELECT ?,?,?,?,'published',? WHERE $FENCE",runId,teamId,seasonId,previous.input_revision,stamp());
      for (const [table,list] of [["team_player_rows",roster],["team_event_rows",fixtures]]) if(list.length) {
        const data=list.map(r=>({run_id:runId,...r})),columns=Object.keys(data[0]);
        add(`INSERT INTO ${table}(${columns.join(",")}) SELECT ${columns.map((c)=>`json_extract(value,'$.${c}')`).join(",")} FROM json_each(?) WHERE $FENCE`,JSON.stringify(data));
      }
      add("UPDATE team_projection_runs SET state='obsolete' WHERE team_season_id=? AND id<>? AND state='published' AND $FENCE",seasonId,runId);
      add("UPDATE team_projection_state SET published_run_id=? WHERE team_season_id=? AND $FENCE",runId,seasonId);
    }
    add(`UPDATE team_projection_state SET pending=0,projection_hash=?,published_input_revision=input_revision WHERE team_season_id=? AND $FENCE`,digest,seasonId);
    add(`UPDATE team_read_state SET content_revision=content_revision+?,pending=EXISTS(SELECT 1 FROM team_projection_state WHERE app_team_id=? AND pending=1) WHERE app_team_id=? AND $FENCE`,digest!==previous.projection_hash?1:0,teamId,teamId);
    add(`UPDATE domain_installation SET mutation_revision=mutation_revision+1 WHERE id=1 AND $FENCE`);
    return {statements,changed:digest!==previous.projection_hash,revision:readState.content_revision+(digest!==previous.projection_hash?1:0),season_id:seasonId};
  }
  async buildProjectionPage(teamId,seasonId=null,checkpoint={}) {return buildProjectionPage(this,teamId,seasonId,checkpoint);}
  async projectTeam(teamId,seasonId=null) {
    const built=await this.buildProjection(teamId,seasonId),token=id(),guard="EXISTS(SELECT 1 FROM domain_fences WHERE id='domain' AND token=?)";
    const result=await this.db.batch([
      this.db.prepare("INSERT INTO domain_fences VALUES('domain',?) ON CONFLICT(id) DO UPDATE SET token=excluded.token").bind(token),
      ...built.statements.map(({sql,params})=>this.db.prepare(sql.replaceAll("$FENCE",guard)).bind(...params,token)),
    ]);
    requireValue(result.at(-1).meta.changes===1,"Projection inputs changed; retry.","revision_conflict",409);
    return built;
  }
  async readIdentityPage(options){return identityPage(this,options);}
  async linkPlayers(options) { return this.linkEntities("player",options); }
  async linkEvents(options) { return this.linkEntities("event",options); }
  async resolvePlayerId(value) {return (await this.db.prepare('SELECT canonical_id FROM canonical_player_ids WHERE input_id=?').bind(value).first())?.canonical_id||null;}
  async resolveEventId(value) {return (await this.db.prepare('SELECT canonical_id FROM canonical_event_ids WHERE input_id=?').bind(value).first())?.canonical_id||null;}
  async resolveCompetitionId(value) {return (await this.db.prepare('SELECT canonical_id FROM canonical_competition_ids WHERE input_id=?').bind(value).first())?.canonical_id||null;}
  async resolveDivisionId(value) {return (await this.db.prepare('SELECT canonical_id FROM canonical_division_ids WHERE input_id=?').bind(value).first())?.canonical_id||null;}
  async consumersFor(kind,sourceIds,canonicalIds=[]) {
    const sourceColumn=kind==='player'?'source_player_id':'source_event_id',canonicalColumn=kind==='player'?'player_id':'event_id',relation=kind==='player'?'source_roster_memberships':'source_event_teams';
    const extra=kind==='player'?` UNION SELECT DISTINCT m.source_team_id FROM source_game_members m JOIN source_event_teams t ON t.source_event_id=m.source_event_id AND t.source_team_id=m.source_team_id AND t.side=m.side WHERE m.source_player_id IN(SELECT id FROM selected) AND m.dummy=0`:'';
    const query={sql:`WITH selected AS(SELECT ${sourceColumn} AS id FROM ${kind}_source_links WHERE ${canonicalColumn} IN(SELECT value FROM json_each(?)) OR ${sourceColumn} IN(SELECT value FROM json_each(?)) UNION SELECT value FROM json_each(?)),roots AS(SELECT DISTINCT source_team_id AS id FROM ${relation} WHERE ${sourceColumn} IN(SELECT id FROM selected)${extra}),sources AS(SELECT id FROM roots UNION SELECT a FROM source_team_links WHERE b IN(SELECT id FROM roots) UNION SELECT b FROM source_team_links WHERE a IN(SELECT id FROM roots)) SELECT DISTINCT app_team_id,team_season_id FROM team_source_attachments WHERE active=1 AND source_team_id IN(SELECT id FROM sources) AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=app_team_id)`,params:[JSON.stringify(canonicalIds),JSON.stringify(sourceIds),JSON.stringify(sourceIds)]};
    const consumers=(await this.db.prepare(query.sql+' ORDER BY app_team_id,team_season_id LIMIT 128').bind(...query.params).all()).results;
    Object.defineProperty(consumers,'demand',{value:query});return consumers;
  }
  dirtyStatements(guard,token,consumers) {
    const query=consumers.demand,data=JSON.stringify(consumers);
    return query?[
      this.db.prepare(`UPDATE team_projection_state SET pending=1,input_revision=input_revision+1 WHERE team_season_id IN(SELECT team_season_id FROM(${query.sql})) AND ${guard}`).bind(...query.params,token),
      this.db.prepare(`UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id IN(SELECT app_team_id FROM(${query.sql})) AND ${guard}`).bind(...query.params,token),
    ]:[
      this.db.prepare(`UPDATE team_projection_state SET pending=1,input_revision=input_revision+1 WHERE team_season_id IN(SELECT json_extract(value,'$.team_season_id') FROM json_each(?)) AND ${guard}`).bind(data,token),
      this.db.prepare(`UPDATE team_read_state SET pending=1,status_revision=status_revision+1 WHERE app_team_id IN(SELECT json_extract(value,'$.app_team_id') FROM json_each(?)) AND ${guard}`).bind(data,token),
    ];
  }
  eventIdentityStatements(guard,token,sourceIds,canonicalIds=[]) {
    const where="id IN(SELECT source_event_id FROM event_source_links WHERE source_event_id IN(SELECT value FROM json_each(?)) OR event_id IN(SELECT value FROM json_each(?)))",params=[JSON.stringify(sourceIds),JSON.stringify(canonicalIds)];
    return [
      this.db.prepare(`INSERT INTO source_event_state SELECT id,1 FROM source_events WHERE ${where} AND ${guard} ON CONFLICT(source_event_id) DO UPDATE SET input_revision=source_event_state.input_revision+1`).bind(...params,token),
      this.db.prepare(`UPDATE source_division_coverage SET content_revision=content_revision+1 WHERE source_division_id IN(SELECT e.division_key FROM source_events e WHERE e.provider IN('gotsport','live') AND ${where} AND e.division_key IS NOT NULL) AND ${guard}`).bind(...params,token),
      this.db.prepare(`UPDATE domain_installation SET public_revision=public_revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM source_events WHERE provider IN('gotsport','live') AND ${where}) AND ${guard}`).bind(...params,token),
    ];
  }
  async projectConsumers(consumers) {
    if(!this.inlineProjection) return;
    for(const row of consumers) await this.projectTeam(row.app_team_id,row.team_season_id);
  }
  async linkEntities(kind,{teamId,sourceIds,evidence,seasonId=null,expectedMutation=null}) {
    const before=await this.state();if(expectedMutation!==null)requireValue(Number.isSafeInteger(expectedMutation)&&expectedMutation===before.mutation_revision,"Identity decisions changed; reload them.","revision_conflict",409);
    requireValue(Array.isArray(sourceIds)&&new Set(sourceIds).size===sourceIds.length&&sourceIds.length>=2&&sourceIds.length<=4,"Select distinct source records.");
    requireValue(evidence?.kind==="owner_confirmed","A link requires verified owner evidence.","identity_evidence",409);
    const selected=await selectedIdentitySources(this,teamId,seasonId,kind,sourceIds),query=await identityQuery(this,teamId,seasonId,kind,{sourceIds,limit:4});
    const canonicalIds=[...new Set(selected.map((r)=>r.canonical_id).filter(Boolean))],entityId=canonicalIds[0]||id();
    const groups=await this.db.prepare(`SELECT COUNT(*) AS total,COUNT(DISTINCT s.provider||':'||s.scope) AS providers FROM source_${kind==='player'?'players':'events'} s LEFT JOIN ${kind}_source_links l ON l.source_${kind}_id=s.id LEFT JOIN canonical_${kind}_ids c ON c.input_id=l.${kind}_id WHERE s.id IN(SELECT value FROM json_each(?)) OR c.canonical_id IN(SELECT value FROM json_each(?))`).bind(JSON.stringify(sourceIds),JSON.stringify(canonicalIds)).first();
    requireValue(groups.total===groups.providers,"Another record from this provider is already linked.","identity_conflict",409);
    if (kind==="event") requireValue(new Set(selected.map((r)=>r.type)).size===1&&selected.every((r)=>!r.conditional),"Only corresponding confirmed event types can be linked.","identity_conflict",409);
    for (const other of canonicalIds.filter((v)=>v!==entityId)) requireValue(!(await this.db.prepare("SELECT 1 AS found FROM domain_overrides WHERE kind=? AND entity_id=? LIMIT 1").bind(kind,other).first()),"Resolve the other record's corrections before linking.","correction_conflict",409);
    const sourceColumn=kind==="player"?"source_player_id":"source_event_id",canonicalColumn=kind==="player"?"player_id":"event_id",table=`${kind}_source_links`,data=JSON.stringify(sourceIds),consumers=await this.consumersFor(kind,sourceIds,canonicalIds);
    await this.domainBatch((guard,token)=>[
      ...(!canonicalIds.length?[this.db.prepare(`INSERT INTO ${kind==="player"?"players":"events"} SELECT ?,? WHERE ${guard}`).bind(entityId,stamp(),token)]:[]),
      this.db.prepare(`INSERT INTO ${kind}_aliases SELECT value,? FROM json_each(?) WHERE value<>? AND ${guard} ON CONFLICT(merged_id) DO UPDATE SET canonical_id=excluded.canonical_id`).bind(entityId,JSON.stringify(canonicalIds),entityId,token),
      this.db.prepare(`UPDATE ${table} SET ${canonicalColumn}=?,reason='owner_confirmed',evidence=?,revision=revision+1 WHERE ${canonicalColumn} IN(SELECT value FROM json_each(?)) AND ${guard}`).bind(entityId,bounded(evidence,16000),JSON.stringify(canonicalIds),token),
      this.db.prepare(`INSERT INTO ${table}(${sourceColumn},${canonicalColumn},reason,evidence) SELECT value,?,'owner_confirmed',? FROM json_each(?) WHERE ${guard} ON CONFLICT(${sourceColumn}) DO UPDATE SET ${canonicalColumn}=excluded.${canonicalColumn},reason=excluded.reason,evidence=excluded.evidence,revision=${table}.revision+1`).bind(entityId,bounded(evidence,16000),data,token),
      ...(kind==="event"?this.eventIdentityStatements(guard,token,sourceIds,canonicalIds):[]),
      ...this.dirtyStatements(guard,token,consumers),
    ],{sql:`EXISTS(SELECT 1 FROM domain_installation WHERE id=1 AND mutation_revision=?) AND (SELECT total FROM(${query.count.sql}))=?${kind==="event"?" AND NOT EXISTS(SELECT 1 FROM source_events WHERE id IN(SELECT value FROM json_each(?)) AND (type<>? OR conditional=1))":""}`,params:[before.mutation_revision,...query.count.params,sourceIds.length,...(kind==="event"?[JSON.stringify(sourceIds),selected[0].type]:[])]});
    await this.projectConsumers(consumers); return {id:entityId,affectedTeams:consumers,revision:(await this.state()).mutation_revision};
  }
  async unlinkPlayer(options) { return this.unlinkEntity("player",options); }
  async unlinkEvent(options) { return this.unlinkEntity("event",options); }
  async unlinkEntity(kind,{teamId,sourceId,seasonId=null,expectedMutation=null}) {
    const before=await this.state();if(expectedMutation!==null)requireValue(Number.isSafeInteger(expectedMutation)&&expectedMutation===before.mutation_revision,"Identity decisions changed; reload them.","revision_conflict",409);
    const [source]=await selectedIdentitySources(this,teamId,seasonId,kind,[sourceId]),query=await identityQuery(this,teamId,seasonId,kind,{sourceIds:[sourceId],limit:1});
    const entityId=id(),column=kind==="player"?"source_player_id":"source_event_id",canonical=kind==="player"?"player_id":"event_id";
    const count=await this.db.prepare(`SELECT COUNT(*) AS count FROM ${kind}_source_links WHERE ${canonical}=?`).bind(source.canonical_id).first();
    if(count.count<=1) return {id:source.canonical_id,affectedTeams:[],revision:before.mutation_revision};
    const consumers=await this.consumersFor(kind,[sourceId],[source.canonical_id]);
    await this.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO ${kind==="player"?"players":"events"} SELECT ?,? WHERE ${guard}`).bind(entityId,stamp(),token),
      this.db.prepare(`UPDATE ${kind}_source_links SET ${canonical}=?,reason='owner_unlinked',evidence='{}',revision=revision+1 WHERE ${column}=? AND ${guard}`).bind(entityId,sourceId,token),
      ...(kind==="event"?this.eventIdentityStatements(guard,token,[sourceId],[source.canonical_id,entityId]):[]),
      ...this.dirtyStatements(guard,token,consumers),
    ],{sql:`EXISTS(SELECT 1 FROM domain_installation WHERE id=1 AND mutation_revision=?) AND (SELECT total FROM(${query.count.sql}))=1`,params:[before.mutation_revision,...query.count.params]});
    await this.projectConsumers(consumers);return {id:entityId,affectedTeams:consumers,revision:(await this.state()).mutation_revision};
  }
  async getOverride({teamId,kind,entityId}) {
    const row=await this.db.prepare("SELECT * FROM domain_overrides WHERE app_team_id=? AND kind=? AND entity_id=?").bind(teamId,kind,entityId).first();
    return row?{revision:row.revision,fields:parse(row.fields)}:{revision:0,fields:{}};
  }
  async setOverride({teamId,kind,entityId,fields,revision=0}) {
    requireValue(kind==="player"||kind==="event","Unsupported correction type.");
    const table=kind==="player"?"team_players":"team_events",column=kind==="player"?"player_id":"event_id";
    requireValue(await this.db.prepare(`SELECT 1 AS ok FROM ${table} WHERE app_team_id=? AND ${column}=?`).bind(teamId,entityId).first(),"Correction is outside this team.","source_scope",403);
    const allowed=new Set(kind==="player"?["name","jersey"]:["home_score","away_score","starts_at","local_day","status","type","home_name","away_name","title","venue"]);
    requireValue(fields&&Object.keys(fields).length&&Object.keys(fields).every((key)=>allowed.has(key)),"Unsupported correction fields.");
    const value={...fields};
    if("name"in value) requireValue(typeof value.name==="string"&&value.name.trim()&&value.name.length<=100,"Enter a valid player name.");
    if ("home_score"in value) value.home_score=score(value.home_score);
    if ("away_score"in value) value.away_score=score(value.away_score);
    if ("starts_at"in value) value.starts_at=kickoff(value.starts_at);
    if ("local_day"in value) value.local_day=day(value.local_day);
    if ("type"in value) requireValue(["game","practice","event"].includes(value.type),"Invalid event type.");
    const old=await this.getOverride({teamId,kind,entityId});
    requireValue(old.revision===revision,"Correction changed; reload it.","revision_conflict",409);
    const consumers=(await this.db.prepare(`SELECT DISTINCT app_team_id,team_season_id FROM ${table} WHERE app_team_id=? AND ${column}=?`).bind(teamId,entityId).all()).results;
    const result=await this.domainBatch((guard,token)=>[
      this.db.prepare(`INSERT INTO domain_overrides SELECT ?,?,?,?,1 WHERE ?=0 AND ${guard} ON CONFLICT(app_team_id,kind,entity_id) DO NOTHING`).bind(teamId,kind,entityId,bounded(value,16000),revision,token),
      this.db.prepare(`UPDATE domain_overrides SET fields=?,revision=revision+1 WHERE app_team_id=? AND kind=? AND entity_id=? AND revision=? AND ?>0 AND ${guard}`).bind(bounded(value,16000),teamId,kind,entityId,revision,revision,token),
      ...this.dirtyStatements(guard,token,consumers),
    ],{sql:`EXISTS(SELECT 1 FROM app_teams WHERE id=?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=?) AND EXISTS(SELECT 1 FROM ${table} WHERE app_team_id=? AND ${column}=?) AND (${revision===0?"NOT EXISTS(SELECT 1 FROM domain_overrides WHERE app_team_id=? AND kind=? AND entity_id=?)":"EXISTS(SELECT 1 FROM domain_overrides WHERE app_team_id=? AND kind=? AND entity_id=? AND revision=?)"})`,params:[teamId,teamId,teamId,entityId,teamId,kind,entityId,...(revision===0?[]:[revision])]});
    requireValue(result[1].meta.changes+result[2].meta.changes===1,"Correction changed; reload it.","revision_conflict",409);
    await this.projectConsumers(consumers);return {revision:revision+1,affectedTeams:consumers};
  }
  async resetOverride({teamId,kind,entityId,revision}) {
    requireValue(kind==="player"||kind==="event","Unsupported correction type.");
    const table=kind==="player"?"team_players":"team_events",column=kind==="player"?"player_id":"event_id",consumers=(await this.db.prepare(`SELECT DISTINCT app_team_id,team_season_id FROM ${table} WHERE app_team_id=? AND ${column}=?`).bind(teamId,entityId).all()).results;
    requireValue(consumers.length,"Correction is outside this team.","source_scope",403);
    await this.domainBatch((guard,token)=>[
      this.db.prepare(`DELETE FROM domain_overrides WHERE app_team_id=? AND kind=? AND entity_id=? AND revision=? AND ${guard}`).bind(teamId,kind,entityId,revision,token),
      ...this.dirtyStatements(guard,token,consumers),
    ],{sql:`EXISTS(SELECT 1 FROM app_teams WHERE id=?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=?) AND EXISTS(SELECT 1 FROM ${table} WHERE app_team_id=? AND ${column}=?) AND EXISTS(SELECT 1 FROM domain_overrides WHERE app_team_id=? AND kind=? AND entity_id=? AND revision=?)`,params:[teamId,teamId,teamId,entityId,teamId,kind,entityId,revision]});
    await this.projectConsumers(consumers);return {revision:0,affectedTeams:consumers};
  }
  authorize(teamId,actor) { requireValue(actor?.owner===true||actor?.owner===false&&actor.teamId===teamId,"Team is outside this viewer link.","team_forbidden",403); }
  async readTeam(teamId,actor,options={}) {
    this.authorize(teamId,actor);
    const team=await this.team(teamId),seasonId=options.seasonId||actor.seasonId||team.season_id,[state,players,events,totals]=await Promise.all([
      this.db.prepare("SELECT * FROM team_read_state WHERE app_team_id=?").bind(teamId).first(),
      this.db.prepare("SELECT player_id AS id,name,jersey,source_ids FROM team_players WHERE app_team_id=? AND team_season_id=? ORDER BY name,id").bind(teamId,seasonId).all(),
      this.db.prepare("SELECT event_id AS id,starts_at,local_day,type,status,conditional,own_side,home_name,away_name,home_score,away_score,goals_for,goals_against,title,venue,source_ids,result_conflict,identity_conflict,conflict FROM team_events WHERE app_team_id=? AND team_season_id=? ORDER BY COALESCE(starts_at,local_day,'9999'),event_id").bind(teamId,seasonId).all(),
      this.db.prepare("SELECT COUNT(*) AS games,COALESCE(SUM(goals_for>goals_against),0) AS wins,COALESCE(SUM(goals_for=goals_against),0) AS draws,COALESCE(SUM(goals_for<goals_against),0) AS losses,COALESCE(SUM(goals_for),0) AS goals_for,COALESCE(SUM(goals_against),0) AS goals_against FROM team_events WHERE app_team_id=? AND team_season_id=? AND type='game' AND status='FINAL' AND conditional=0 AND result_conflict=0 AND identity_conflict=0 AND goals_for IS NOT NULL AND goals_against IS NOT NULL").bind(teamId,seasonId).first(),
    ]);
    const inflate=(row)=>({...row,source_ids:parse(row.source_ids),...(row.conflict?{conflict:parse(row.conflict)}:{})});
    const unresolved=await this.db.prepare("SELECT COUNT(*) AS count FROM team_events WHERE app_team_id=? AND team_season_id=? AND result_conflict=1").bind(teamId,seasonId).first();
    return {team,season_id:seasonId,revision:state.content_revision,status_revision:state.status_revision,pending:!!state.pending,players:players.results.map(inflate),events:events.results.map(inflate),totals:{...totals,unresolved_results:unresolved.count}};
  }
  async readSourceEvent(sourceId,actor) {
    const row=requireValue(await this.db.prepare("SELECT * FROM source_events WHERE id=?").bind(sourceId).first(),"Source event was not found.","not_found",404);
    if (actor?.owner!==true) {
      requireValue(actor?.owner===false&&actor.teamId,"A team viewer is required.","team_forbidden",403);
      const visible=await this.visibleRows(actor.teamId,"event");
      requireValue(visible.some((r)=>r.id===sourceId),"Source event is outside this viewer link.","source_forbidden",403);
    }
    if(actor?.owner===true) return row;
    return {id:row.id,provider:row.provider,starts_at:row.starts_at,local_day:row.local_day,type:row.type,status:row.status,home_label:row.home_label,away_label:row.away_label,home_score:row.home_score,away_score:row.away_score};
  }
}
