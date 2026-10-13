import { ReadRepository } from "./repository.js";
import { publishedGameScopeCTE, resolvePublishedGame, assertPublishedGameCurrent, gameScopeRevision } from "../domain/team-game-scope.js";
import {readHeadToHead} from "./h2h.js";
import {findPublicHistoryAnchor} from "./public-history-anchor.js";
import { invalid, localDay, calendarDay } from "./selection.js";
import { statisticalSelectionSQL } from "./inclusion.js";
import {analyzedEventsCTE} from '../analysis/eligibility.js';
import { playerSeasonQuery, savedMatchAnalysis } from "../analysis/reads.js";
import { attendanceCTE,ATTENDANCE_EVIDENCE_CLOCK_SQL } from "./attendance.js";
import { AWARDS_SCHEMA } from "./feature-schema.js";
import {clubKitsQuery,clubKitsModel,uniformKit} from "../application/club-kits.js";
import {sourceBrandingJSONSQL,publicSourceBrandingJSONSQL,sourceBranding} from "./branding.js";
import {brandEventRows} from "./event-branding.js";
const own = (actor) => {
  if (actor?.owner !== true) throw invalid("Owner access required.", "owner_required", 403);
};
const validId = (value) => {
  if (typeof value !== "string" || !value || value.length > 200) throw invalid("Choose a valid resource.");
  return value;
};
const pageLimit = (value) => {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw invalid("Invalid page size.");
  return value;
};
const parse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const hash = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (n) => n.toString(16).padStart(2, "0")).join("");
const safeURL = (value) => {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !Array.from(u.searchParams.keys()).some((k) => /(password|token|secret|session|auth|account)/i.test(k)) ? u.href : null;
  } catch {
    return null;
  }
};
const dateLabel = (start, end) => start ? start === end || !end ? start : start + " \u2013 " + end : "Dates not published";
const SAME = (a, b) => `(${a}=${b} OR EXISTS(SELECT 1 FROM source_team_links bridge WHERE (bridge.a=${a} AND bridge.b=${b}) OR(bridge.b=${a} AND bridge.a=${b})))`;
const bookmarked = (team, event) => `EXISTS(SELECT 1 FROM game_bookmarks b JOIN canonical_event_ids bi ON bi.input_id=b.event_id WHERE b.app_team_id=${team} AND bi.canonical_id=${event})`;
const scopedBookmarked = (team,event,season) => `EXISTS(SELECT 1 FROM game_bookmarks b LEFT JOIN canonical_event_ids bi ON bi.input_id=b.event_id WHERE b.app_team_id=${team} AND(b.event_id=${event} OR bi.canonical_id=${event} OR EXISTS(SELECT 1 FROM detail_game_checked m WHERE m.app_team_id=${team} AND m.team_season_id=${season} AND m.target_event_id=${event} AND m.entitled=1 AND(m.original_event_id=b.event_id OR m.original_event_id=bi.canonical_id))))`;
const detailGameCTE = () => `WITH detail_selection AS(SELECT ? AS app_team_id,? AS team_season_id),${publishedGameScopeCTE('detail_selection','detail_game')}`;
const TIME = "COALESCE(e.starts_at,e.local_day,'9999-12-31')";
const EVENT_COLUMNS = `e.id,e.starts_at,e.local_day,e.type,e.status,e.conditional,e.home_id,e.away_id,e.home_name,e.away_name,e.home_score,e.away_score,e.title,e.venue,e.competition_id,e.division_id,e.result_conflict,e.identity_conflict,e.own_side,e.own_match,e.bookmarked,e.home_branding,e.away_branding,e.provider`;
function dayBoundary(day, zone) {
  calendarDay(day);
  const target = Date.parse(day + "T00:00:00Z");
  let lower = target - 2 * 864e5, upper = target + 2 * 864e5;
  for (let n = 0; n < 30 && upper - lower > 1; n++) {
    const middle = Math.floor((lower + upper) / 2);
    if (localDay(new Date(middle).toISOString(), zone) < day) lower = middle;
    else upper = middle;
  }
  return new Date(upper).toISOString();
}
function attachedCTE() {
  return `WITH attached AS(SELECT source_team_id FROM team_source_attachments WHERE app_team_id=? AND team_season_id=? AND active=1),
  selected_sources AS(SELECT source_team_id AS id FROM attached UNION SELECT CASE WHEN l.a=a.source_team_id THEN l.b ELSE l.a END FROM source_team_links l JOIN attached a ON l.a=a.source_team_id OR l.b=a.source_team_id),
  own_events AS(SELECT e.* FROM team_events e WHERE e.app_team_id=? AND e.team_season_id=?),memberships AS(SELECT DISTINCT dl.division_id,cl.competition_id,m.source_division_id FROM selected_sources a JOIN source_competition_memberships m ON m.source_team_id=a.id JOIN source_divisions d ON d.id=m.source_division_id JOIN division_source_links dl ON dl.source_division_id=d.id JOIN competition_source_links cl ON cl.source_competition_id=d.competition_id UNION SELECT DISTINCT e.division_id,e.competition_id,dl.source_division_id FROM own_events e JOIN division_source_links dl ON dl.division_id=e.division_id WHERE e.competition_id IS NOT NULL)`;
}
function eligibility() {
  return `(c.season_year=? OR(c.starts_on IS NOT NULL AND c.starts_on<? AND COALESCE(c.ends_on,c.starts_on)>=?) OR EXISTS(SELECT 1 FROM source_events s JOIN division_source_links dl ON dl.source_division_id=s.division_key JOIN memberships m ON m.division_id=dl.division_id WHERE m.competition_id=c.id AND s.provider IN('gotsport','live') AND ((s.starts_at>=? AND s.starts_at<?) OR(s.starts_at IS NULL AND s.local_day>=? AND s.local_day<?))) OR(c.season_year IS NULL AND c.starts_on IS NULL AND c.ends_on IS NULL AND ?=? AND NOT EXISTS(SELECT 1 FROM source_events s JOIN division_source_links dl ON dl.source_division_id=s.division_key JOIN memberships m ON m.division_id=dl.division_id WHERE m.competition_id=c.id AND (s.starts_at IS NOT NULL OR s.local_day IS NOT NULL))))`;
}
function publicEventsCTE(where = "1", { allSeasons = false } = {}) {
  const sameHome = SAME("n.home_source_team_id", "r.home_source_team_id"), sameAway = SAME("n.away_source_team_id", "r.away_source_team_id"), reverseHome = SAME("n.home_source_team_id", "r.away_source_team_id"), reverseAway = SAME("n.away_source_team_id", "r.home_source_team_id");
  return `native AS(SELECT s.*,ci.canonical_id AS event_id,dl.division_id,cl.competition_id FROM source_events s JOIN event_source_links l ON l.source_event_id=s.id JOIN canonical_event_ids ci ON ci.input_id=l.event_id LEFT JOIN division_source_links dl ON dl.source_division_id=s.division_key LEFT JOIN competition_source_links cl ON cl.source_competition_id=s.competition_key WHERE s.provider IN('gotsport','live') AND s.scope='public' AND (${where})),
  schedules AS(SELECT n.*,row_number() OVER(PARTITION BY n.event_id ORDER BY CASE n.provider WHEN 'gotsport' THEN 0 ELSE 1 END,n.id) AS rank FROM native n),
  results AS(SELECT n.*,row_number() OVER(PARTITION BY n.event_id ORDER BY CASE n.provider WHEN 'gotsport' THEN 0 ELSE 1 END,n.id) AS rank FROM native n WHERE n.status IN('FINAL','COMPLETED') AND n.home_score IS NOT NULL AND n.away_score IS NOT NULL),
  bookmark_context AS(SELECT ? AS app_team_id,? AS team_season_id),
  e AS(SELECT p.event_id AS id,CASE WHEN t.event_id IS NOT NULL THEN t.starts_at ELSE p.starts_at END AS starts_at,CASE WHEN t.event_id IS NOT NULL THEN t.local_day ELSE p.local_day END AS local_day,COALESCE(t.type,p.type) AS type,COALESCE(t.status,r.status,p.status) AS status,COALESCE(t.conditional,p.conditional) AS conditional,p.home_source_team_id AS home_id,p.away_source_team_id AS away_id,COALESCE(t.home_name,p.home_label) AS home_name,COALESCE(t.away_name,p.away_label) AS away_name,CASE WHEN t.event_id IS NOT NULL THEN t.home_score WHEN r.event_id IS NOT NULL THEN CASE WHEN ${SAME("p.home_source_team_id", "r.home_source_team_id")} THEN r.home_score ELSE r.away_score END ELSE p.home_score END AS home_score,CASE WHEN t.event_id IS NOT NULL THEN t.away_score WHEN r.event_id IS NOT NULL THEN CASE WHEN ${SAME("p.home_source_team_id", "r.home_source_team_id")} THEN r.away_score ELSE r.home_score END ELSE p.away_score END AS away_score,COALESCE(t.title,p.title) AS title,COALESCE(t.venue,p.venue) AS venue,p.competition_id,p.division_id,COALESCE(t.result_conflict,CASE WHEN EXISTS(SELECT 1 FROM native n WHERE n.event_id=p.event_id AND n.id<>r.id AND n.status IN('FINAL','COMPLETED') AND n.home_score IS NOT NULL AND n.away_score IS NOT NULL AND NOT((${sameHome} AND ${sameAway} AND n.home_score=r.home_score AND n.away_score=r.away_score) OR(${reverseHome} AND ${reverseAway} AND n.home_score=r.away_score AND n.away_score=r.home_score))) THEN 1 ELSE 0 END) AS result_conflict,COALESCE(t.identity_conflict,EXISTS(SELECT 1 FROM source_event_correspondences ec WHERE(ec.a=p.id OR ec.b=p.id) AND ec.status='review')) AS identity_conflict,t.app_team_id,t.team_season_id,t.own_side,CASE WHEN t.event_id IS NULL THEN 0 ELSE 1 END AS own_match,${bookmarked("bc.app_team_id", "p.event_id")} AS bookmarked,${publicSourceBrandingJSONSQL("p.home_source_team_id")} AS home_branding,${publicSourceBrandingJSONSQL("p.away_source_team_id")} AS away_branding,p.id AS source_event_id,p.provider FROM schedules p JOIN bookmark_context bc LEFT JOIN results r ON r.event_id=p.event_id AND r.rank=1 LEFT JOIN ${allSeasons ? `(SELECT x.*,row_number() OVER(PARTITION BY x.app_team_id,x.event_id ORDER BY y.year DESC,x.team_season_id) AS latest FROM team_events x JOIN team_seasons y ON y.id=x.team_season_id)` : "team_events"} t ON t.app_team_id=bc.app_team_id AND ${allSeasons ? "t.latest=1 AND bc.team_season_id IS NOT NULL" : "t.team_season_id=bc.team_season_id"} AND t.event_id=p.event_id AND NOT EXISTS(SELECT 1 FROM json_each(t.source_ids) j LEFT JOIN source_events private ON private.id=j.value WHERE private.id IS NULL OR private.provider NOT IN('gotsport','live') OR private.scope<>'public') WHERE p.rank=1)`;
}
function eventFilters(selection, { season = false } = {}) {
  const clauses = ["1"], params = [];
  if (season) {
    clauses.push("((e.starts_at>=? AND e.starts_at<?) OR(e.starts_at IS NULL AND e.local_day>=? AND e.local_day<?) OR(e.starts_at IS NULL AND e.local_day IS NULL))");
    params.push(dayBoundary(selection.from, selection.timezone), dayBoundary(selection.to, selection.timezone), selection.from, selection.to);
  }
  if (selection.period !== "all") {
    const past = "(e.status IN('FINAL','COMPLETED','CANCELLED') OR e.starts_at<? OR(e.starts_at IS NULL AND e.local_day<?))";
    clauses.push(selection.period === "past" ? past : `NOT COALESCE(${past},0)`);
    params.push(new Date(selection.now).toISOString(), localDay(new Date(selection.now).toISOString(), selection.timezone));
  }
  if (selection.search) {
    clauses.push("(e.home_name LIKE ? ESCAPE '\\' OR e.away_name LIKE ? ESCAPE '\\' OR e.title LIKE ? ESCAPE '\\')");
    const q = "%" + selection.search.replace(/[\\%_]/g, (v) => "\\" + v) + "%";
    params.push(q, q, q);
  }
  return { where: clauses.join(" AND "), params };
}
function publicPairVersion(publicPair) {
  const [a, b] = publicPair, pair = `((${SAME("s.home_source_team_id", "?")} AND ${SAME("s.away_source_team_id", "?")}) OR(${SAME("s.home_source_team_id", "?")} AND ${SAME("s.away_source_team_id", "?")}))`;
  return {sql:`SELECT count(*) AS event_count,COALESCE(sum(es.input_revision),0) AS event_revision,count(DISTINCT ce.canonical_id) AS canonical_count,(SELECT public_revision FROM domain_installation WHERE id=1) AS public_revision FROM source_events s LEFT JOIN source_event_state es ON es.source_event_id=s.id LEFT JOIN event_source_links l ON l.source_event_id=s.id LEFT JOIN canonical_event_ids ce ON ce.input_id=l.event_id WHERE s.provider IN('gotsport','live') AND s.scope='public' AND ${pair}`,params:[a,a,a,b,b,b,b,b,b,a,a,a]};
}
class FeatureReads extends ReadRepository {
  constructor(db, actor, { analysisReads, ...options } = {}) {
    super(db, actor, options);
    this.analysisReads = analysisReads;
  }
  category(name) {
    if (!this.actor?.owner && this.actor?.categories && !this.actor.categories.includes(name)) throw invalid("This link does not include that view.", "scope_forbidden", 403);
  }
  async featureContext(input) {
    const context = await this.context({ ...input, mode: "season", type: "games" }), { selection, team, season } = context;
    const params = [selection.team_id, selection.team_season_id, selection.team_id, selection.team_season_id, season.year, selection.to, selection.from, dayBoundary(selection.from, selection.timezone), dayBoundary(selection.to, selection.timezone), selection.from, selection.to, season.year, team.season_year];
    const cte = attachedCTE() + `,eligible AS(SELECT c.id,c.name,c.kind,c.starts_on,c.ends_on,c.season_year,c.season_name,c.official_url,c.official_status,c.completion_verified_at FROM canonical_competitions c WHERE (c.id IN(SELECT competition_id FROM memberships) AND ${eligibility()}) OR EXISTS(SELECT 1 FROM own_events e WHERE e.competition_id=c.id))`;
    const profile = await this.db.prepare(`SELECT p.kind,p.club_id,COALESCE(b.revision,0) AS logo_revision,b.logo IS NOT NULL AS owner_logo_available,${sourceBrandingJSONSQL("p.app_team_id","?","?")} AS source_branding FROM team_profiles p LEFT JOIN club_branding b ON b.club_id=p.club_id WHERE p.app_team_id=?`).bind(selection.team_season_id,this.now(),selection.team_id).first();
    const native = sourceBranding(profile?.source_branding), branding = {logo:profile?.owner_logo_available?null:native.logo,logo_ref:profile?.owner_logo_available?{team_id:selection.team_id,club_id:profile.club_id,revision:profile.logo_revision}:null};
    return { ...context, followed: profile?.kind === "followed", branding, cte, params, past_season: selection.to <= localDay(new Date(this.now()).toISOString(), selection.timezone) };
  }
  versionQuery(context, { competitionId = null, divisions = null, aliases = false, publicPair = null } = {}) {
    if(publicPair){const query=publicPairVersion(publicPair);return this.db.prepare(query.sql).bind(...query.params);}
    const { cte, params } = context, extra = competitionId ? " AND m.competition_id=?" : "", values = competitionId ? [competitionId] : [];
    const narrowed = divisions ? " AND m.division_id IN(SELECT value FROM json_each(?))" : "", divValues = divisions ? [JSON.stringify(divisions)] : [];
    return this.db.prepare(cte + ` SELECT DISTINCT m.competition_id,m.division_id,d.id AS source_division_id,d.content_revision AS division_revision,c.id AS source_competition_id,c.content_revision AS competition_revision,COALESCE(v.content_revision,0) AS fixtures_revision,COALESCE(v.complete,0) AS fixtures_complete,s.complete AS standings_complete,s.record_count AS standings_count,s.availability AS standings_availability${aliases ? `,(SELECT count(*) FROM source_events x LEFT JOIN event_source_links el ON el.source_event_id=x.id LEFT JOIN canonical_event_ids ci ON ci.input_id=el.event_id WHERE x.division_key=d.id AND x.provider IN('gotsport','live') AND ci.canonical_id IS NULL) AS missing_identities` : ""} FROM memberships m JOIN eligible q ON q.id=m.competition_id JOIN division_source_links dl ON dl.division_id=m.division_id JOIN source_divisions d ON d.id=dl.source_division_id JOIN source_competitions c ON c.id=d.competition_id LEFT JOIN source_division_coverage v ON v.source_division_id=d.id LEFT JOIN source_standings_coverage s ON s.source_division_id=d.id WHERE 1${extra}${narrowed} ORDER BY m.competition_id,m.division_id,d.id`).bind(...params, ...values, ...divValues);
  }
  privateVersionQuery(context, eventId) {
    return this.db.prepare(detailGameCTE()+` SELECT ${ATTENDANCE_EVIDENCE_CLOCK_SQL} AS attendance_source_revision,
      (SELECT run_id FROM detail_game_runs) AS published_run_id,
      (SELECT COUNT(*) FROM detail_game_targets WHERE event_id=? AND locally_available=1) AS target_available,
      COUNT(m.source_event_id) AS event_count,COALESCE(SUM(es.input_revision),0) AS event_revision,COUNT(DISTINCT v.id) AS coverage_count,COALESCE(SUM(v.complete),0) AS coverage_complete
      FROM detail_game_checked m JOIN detail_game_targets g ON g.run_id=m.run_id AND g.app_team_id=m.app_team_id AND g.team_season_id=m.team_season_id AND g.event_id=m.target_event_id AND g.locally_available=1
      JOIN source_teams st ON st.id=m.participant_source_team_id AND st.account_id IS m.account_id
      LEFT JOIN source_event_state es ON es.source_event_id=m.source_event_id
      LEFT JOIN source_component_coverage v ON v.provider='teamsnap' AND v.account_id=m.account_id AND v.kind='attendance' AND v.scope='teamsnap:'||st.native_id
      WHERE m.target_event_id=? AND m.entitled=1`).bind(context.selection.team_id,context.selection.team_season_id,eventId,eventId);
  }
  versionQueries(context, options = {}) {
    return [this.versionQuery(context, options), ...options.matchEvent ? [this.privateVersionQuery(context, options.matchEvent)] : []];
  }
  async snapshot(context, options = {}) {
    if(options.publicPair&&!options.matchEvent){
      const q=publicPairVersion(options.publicPair),row=await this.db.prepare(`WITH version AS(${q.sql}) SELECT r.content_revision,r.status_revision,COALESCE((SELECT p.pending FROM team_projection_state p WHERE p.team_season_id=? AND p.app_team_id=r.app_team_id),r.pending) AS pending,v.event_count,v.event_revision,v.canonical_count,v.public_revision FROM team_read_state r CROSS JOIN version v WHERE r.app_team_id=?`).bind(...q.params,context.selection.team_season_id,context.selection.team_id).first();
      if(!row)throw invalid('This team projection is unavailable.','projection_pending',409);
      const {event_count,event_revision,canonical_count,public_revision,...state}=row,versions=[{event_count,event_revision,canonical_count,public_revision}];
      return {state,versions,revision:await hash([state.content_revision,versions])};
    }
    const rows = await this.db.batch([this.stateQuery(context.selection), ...this.versionQueries(context, options)]), state = rows[0].results[0];
    if (!state) throw invalid("This team projection is unavailable.", "projection_pending", 409);
    return { state, revision: await hash([state.content_revision, ...rows.slice(1).map((r) => r.results)]), versions: rows[1].results };
  }
  async page(context, { selection, cte, params, where = "1", whereParams = [], filterFactory = null, totalColumns = "count(*) AS total", columns, order, resource, limit = 50, cursor = null, versionOptions = {}, map = (v) => v }) {
    pageLimit(limit);
    const before = await this.snapshot(context, versionOptions), scope = this.scope(selection.team_id) + "/" + resource;
    const position = cursor ? await this.cursor.verify(cursor, { selection, revision: before.revision, scope }) : null;
    if (position && (!Array.isArray(position) || position.length !== 3 || position.some((v) => typeof v !== "string"))) throw invalid("The list cursor is invalid.", "cursor_invalid");
    const cutoff = position?.[2] ?? new Date(this.now()).toISOString();
    if (!Number.isFinite(Date.parse(cutoff))) throw invalid("The list cursor is invalid.", "cursor_invalid");
    if (filterFactory) {
      const filtered = filterFactory(cutoff);
      where = filtered.where;
      whereParams = filtered.params;
    }
    const desc = selection.direction === "desc", sign = desc ? "<" : ">", dir = desc ? "DESC" : "ASC", page = position ? ` AND (${order}${sign}? OR(${order}=? AND e.id${sign}?))` : "";
    const results = await this.db.batch([this.stateQuery(context.selection), ...this.versionQueries(context, versionOptions), this.db.prepare(cte + ` SELECT ${totalColumns} FROM e WHERE ${where}`).bind(...params, ...whereParams), this.db.prepare(cte + ` SELECT ${columns},${order} AS order_value FROM e WHERE ${where}${page} ORDER BY ${order} ${dir},e.id ${dir} LIMIT ?`).bind(...params, ...whereParams, ...position ? [position[0], position[0], position[1]] : [], limit + 1)]);
    const state = results[0].results[0], versionCount = this.versionQueries(context, versionOptions).length, revision = await hash([state.content_revision, ...results.slice(1, versionCount + 1).map((r) => r.results)]);
    if (revision !== before.revision || (await this.snapshot(context,versionOptions)).revision !== before.revision) throw invalid("This selection changed. Reload it.", "cursor_restart", 409);
    const rows = results[versionCount + 2].results, items = rows.slice(0, limit), last = items.at(-1), next_cursor = rows.length > limit ? await this.cursor.issue({ selection, revision, scope, position: [last.order_value, last.id, cutoff] }) : null;
    return { state, revision, aggregate: results[versionCount + 1].results[0], as_of: cutoff, versions: results[1].results, page: { items: items.map(({ order_value, ...row }) => map(row)), total: results[versionCount + 1].results[0].total, next_cursor } };
  }
  eventRow(row, selection, branding = null) {
    const publicSide = (id) => typeof id === "string" && /^(gotsport|live)\/public\//.test(id) ? id : null;
    const day = row.starts_at ? localDay(row.starts_at, selection.timezone) : row.local_day, homeId = row.own_match && row.own_side === "home" ? selection.team_id : publicSide(row.home_id), awayId = row.own_match && row.own_side === "away" ? selection.team_id : publicSide(row.away_id);
    const {home_branding,away_branding,_game_scope,...safe}=row,homeLogo=row.own_match&&row.own_side==="home"&&branding?branding:{logo:sourceBranding(home_branding).logo},awayLogo=row.own_match&&row.own_side==="away"&&branding?branding:{logo:sourceBranding(away_branding).logo};
    return { ...safe, source_label:({gotsport:"GotSport",live:"GotSport Live",teamsnap:"TeamSnap",trace:"Trace"})[row.provider]??null, id: row.id, home_id: homeId, away_id: awayId, home: { id: homeId, name: row.home_name, ...homeLogo, confirmed: !!row.home_id && !row.conditional }, away: { id: awayId, name: row.away_name, ...awayLogo, confirmed: !!row.away_id && !row.conditional }, local_day: day, time_pending: !row.starts_at, conditional: !!row.conditional, result_conflict: !!row.result_conflict, identity_conflict: !!row.identity_conflict, own_match: !!row.own_match, bookmarked: !!row.bookmarked, can_edit: !!this.actor.owner && !!row.own_match, can_bookmark: !!this.actor.owner && row.type === "game" && !row.conditional && !row.identity_conflict, record_eligible: ["FINAL", "COMPLETED"].includes(row.status) && !row.conditional && !row.result_conflict && !row.identity_conflict && row.home_score != null && row.away_score != null };
  }
  async competitions(input, { limit = 25, cursor = null } = {}) {
    this.category("competitions");
    const context = await this.featureContext(input), period = context.past_season ? "all" : context.selection.period, selection = { ...context.selection, period, resource: "competitions" }, clauses = ["1"], whereParams = [];
    if (period !== "all") {
      clauses.push(period === "past" ? "e.ends_on<?" : "(e.ends_on IS NULL OR e.ends_on>=?)");
      whereParams.push(localDay(new Date(this.now()).toISOString(), selection.timezone));
    }
    if (selection.search) {
      clauses.push("e.name LIKE ? ESCAPE '\\'");
      whereParams.push("%" + selection.search.replace(/[\\%_]/g, (v) => "\\" + v) + "%");
    }
    const cte = context.cte + `,e AS(SELECT c.*,COALESCE(c.starts_on,'9999-12-31') AS order_day,(SELECT group_concat(name,' \xB7 ') FROM(SELECT DISTINCT d.name FROM memberships m JOIN canonical_divisions d ON d.id=m.division_id WHERE m.competition_id=c.id ORDER BY d.name)) AS division_name FROM eligible c)`;
    const result = await this.page(context, { selection, cte, params: context.params, filterFactory: (cutoff) => {
      const listClauses = ["1"], listParams = [];
      if (period !== "all") {
        listClauses.push(period === "past" ? "e.ends_on<?" : "(e.ends_on IS NULL OR e.ends_on>=?)");
        listParams.push(localDay(cutoff, selection.timezone));
      }
      if (selection.search) {
        listClauses.push("e.name LIKE ? ESCAPE '\\'");
        listParams.push("%" + selection.search.replace(/[\\%_]/g, (v) => "\\" + v) + "%");
      }
      return { where: listClauses.join(" AND "), params: listParams };
    }, columns: "e.id,e.name,e.kind,e.starts_on,e.ends_on,e.season_year,e.season_name,e.official_url,e.official_status,e.completion_verified_at,e.division_name", order: "e.order_day", resource: "competitions", limit, cursor, map: (c) => ({ ...c, official_url: safeURL(c.official_url), date_label: dateLabel(c.starts_on, c.ends_on), loaded: false, events: { items: [], total: null, next_cursor: null }, standings: { pools: [], coverage: "pending", note: "Standings have not been loaded." }, note: !c.starts_on && c.season_year == null ? "Season and dates have not been confirmed by the provider." : null }) });
    return this.envelope(selection, result.state, { season_label: `${context.season.year}\u2013${context.season.year + 1}`, past_season: context.past_season, period, team_filter: "all", followed: context.followed, competitions: result.page });
  }
  async competition(input, competitionId, { division_id = null, view = "all", limit = 50, cursor = null, standings_limit = 100, standings_cursor = null, pool_counts_cursor = null } = {}) {
    this.category("competitions");
    validId(competitionId);
    if (!["all", "own"].includes(view)) throw invalid("Choose our team or all teams.");
    const context = await this.featureContext(input), before = await this.snapshot(context, { competitionId, aliases: true }), metadata = (await this.db.prepare(context.cte + " SELECT * FROM eligible WHERE id=?").bind(...context.params, competitionId).all()).results[0];
    if (!metadata) throw invalid("This competition is unavailable for this team season.", "not_found", 404);
    const divisionRows = (await this.db.prepare(context.cte + " SELECT DISTINCT d.id,d.name,d.official_url FROM memberships m JOIN canonical_divisions d ON d.id=m.division_id WHERE m.competition_id=? ORDER BY d.name,d.id").bind(...context.params, competitionId).all()).results;
    const divisions = divisionRows.map((d) => d.id);
    if (division_id != null && !divisions.includes(validId(division_id))) throw invalid("This category is unavailable for this team.", "not_found", 404);
    const selected = division_id ? [division_id] : divisions, selection = { ...context.selection, period: context.past_season ? "all" : context.selection.period, now: this.now(), resource: "competition", competition_id: competitionId, division_id, view }, filters = eventFilters(selection, { season: true });
    const localView=view==="own"&&!context.followed;
    const publicWhere="dl.division_id IN(SELECT value FROM json_each(?))"+(view==="own"?` AND EXISTS(SELECT 1 FROM source_event_teams et JOIN team_source_attachments a ON ${SAME("a.source_team_id","et.source_team_id")} AND a.account_id IS NULL AND a.active=1 WHERE et.source_event_id=s.id AND a.app_team_id=? AND a.team_season_id=?)`:"");
    const cte = localView ? detailGameCTE()+`,e AS(SELECT t.event_id AS id,t.starts_at,t.local_day,t.type,t.status,t.conditional,s.home_source_team_id AS home_id,s.away_source_team_id AS away_id,t.home_name,t.away_name,t.home_score,t.away_score,t.title,t.venue,t.competition_id,t.division_id,t.result_conflict,t.identity_conflict,t.own_side,1 AS own_match,${scopedBookmarked("t.app_team_id", "t.event_id", "t.team_season_id")} AS bookmarked,${publicSourceBrandingJSONSQL("s.home_source_team_id")} AS home_branding,${publicSourceBrandingJSONSQL("s.away_source_team_id")} AS away_branding,s.provider FROM detail_game_targets t JOIN source_events s ON s.id=t.schedule_source_id WHERE t.locally_available=1 AND t.division_id IN(SELECT value FROM json_each(?)))` : `WITH ${publicEventsCTE(publicWhere)}`;
    const params = localView ? [selection.team_id, selection.team_season_id, JSON.stringify(selected)] : [JSON.stringify(selected), ...(view==="own"?[selection.team_id,selection.team_season_id]:[]), selection.team_id, selection.team_season_id];
    const cursorSelection = { ...selection };
    delete cursorSelection.now;
    const result = await this.page(context, { selection: cursorSelection, cte, params, filterFactory: (cutoff) => eventFilters({ ...selection, now: Date.parse(cutoff) }, { season: true }), columns: EVENT_COLUMNS, order: TIME, resource: "competition/" + competitionId, limit, cursor, versionOptions: { competitionId, divisions: selected, aliases: true }, map: (r) => this.eventRow(r, selection, context.branding) }), standings = await this.standings(context, selected, { limit: standings_limit, cursor: standings_cursor, pool_counts_cursor }), coverage = this.coverage(result.versions), after = await this.snapshot(context, { competitionId, aliases: true });
    if (after.revision !== before.revision) throw invalid("This competition changed. Reload it.", "cursor_restart", 409);
    return this.envelope(cursorSelection, result.state, { competition: { ...metadata, official_url: safeURL(metadata.official_url), date_label: dateLabel(metadata.starts_on, metadata.ends_on), division_name: divisionRows.filter((d) => selected.includes(d.id)).map((d) => d.name).join(" \xB7 "), loaded: true }, divisions: divisionRows.map((d) => ({ ...d, official_url: safeURL(d.official_url) })), events: result.page, standings, coverage, as_of: result.as_of, team_filter: view === "own" ? "ours" : "all", followed: context.followed, period: selection.period });
  }
  coverage(versions) {
    const native = versions.filter((v) => v.source_division_id), complete = native.length > 0 && native.every((v) => v.fixtures_complete === 1), unmapped = native.some((v) => v.missing_identities > 0);
    return { schedule: unmapped ? "projection_pending" : complete ? "complete" : "partial", native_categories: native.length, identity_pending: unmapped, history: "saved_observations" };
  }
  async standings(context, divisions, { limit = 100, cursor = null, pool_counts_cursor = null } = {}) {
    pageLimit(limit);
    const selectedDivisions = [...divisions].sort(), options = { divisions: selectedDivisions }, before = await this.snapshot(context, options), selection = { ...context.selection, resource: "standings", division_ids: selectedDivisions }, scope = this.scope(context.selection.team_id) + "/standings", position = cursor ? await this.cursor.verify(cursor, { selection, revision: before.revision, scope }) : null;
    if (position && (!Array.isArray(position) || position.length !== 6 || typeof position[0] !== "string" || typeof position[1] !== "string" || ![0, 1].includes(position[2]) || !Number.isFinite(position[3]) || typeof position[4] !== "string" || typeof position[5] !== "string")) throw invalid("The standings cursor is invalid.", "cursor_invalid");
    const coverage = (await this.db.prepare(`SELECT d.id,dl.division_id,d.provider,c.complete,c.record_count,c.availability,EXISTS(SELECT 1 FROM source_standings s WHERE s.source_division_id=d.id) AS has_rows FROM source_divisions d JOIN division_source_links dl ON dl.source_division_id=d.id LEFT JOIN source_standings_coverage c ON c.source_division_id=d.id WHERE dl.division_id IN(SELECT value FROM json_each(?)) ORDER BY CASE d.provider WHEN 'gotsport' THEN 0 ELSE 1 END,d.id`).bind(JSON.stringify(selectedDivisions)).all()).results, selected = [];
    for (const division of selectedDivisions) {
      const available = coverage.filter((c) => c.division_id === division && c.availability === "published"), nonempty = available.filter((c) => c.has_rows), candidates = nonempty.length ? nonempty : available, chosen = candidates.find((c) => c.provider === "gotsport") ?? candidates.find((c) => c.provider === "live");
      if (chosen) selected.push(chosen.id);
    }
    const ids = JSON.stringify(selected), name = `COALESCE((SELECT json_extract(pool.value,'$.name') FROM source_divisions d JOIN json_each(d.evidence,'$.pools') pool WHERE d.id=s.source_division_id AND CAST(json_extract(pool.value,'$.id') AS TEXT)=s.pool_id AND json_type(pool.value,'$.name')='text' LIMIT 1),'Pool '||s.pool_id)`, base = `WITH bounded AS(SELECT s.*,${name} AS pool_name FROM source_standings s WHERE s.source_division_id IN(SELECT value FROM json_each(?)))`, rowSQL = base + ` SELECT s.source_division_id,s.pool_id,s.pool_name,s.participant_key,s.name,s.rank,s.played,s.wins,s.draws,s.losses,s.goals_for,s.goals_against,s.goal_difference,s.points,(SELECT count(*) FROM bounded p WHERE p.source_division_id=s.source_division_id AND p.pool_id=s.pool_id) AS pool_total FROM bounded s${position ? " WHERE(s.source_division_id,s.pool_id,s.rank IS NULL,COALESCE(s.rank,0),s.name,s.participant_key)>(?,?,?,?,?,?)" : ""} ORDER BY s.source_division_id,s.pool_id,s.rank IS NULL,COALESCE(s.rank,0),s.name,s.participant_key LIMIT ?`, poolSelection = { ...selection, resource: "standing-pool-counts" }, poolScope = scope + "/pool-counts", poolPosition = pool_counts_cursor ? await this.cursor.verify(pool_counts_cursor, { selection: poolSelection, revision: before.revision, scope: poolScope }) : null;
    if (poolPosition && (!Array.isArray(poolPosition) || poolPosition.length !== 2 || poolPosition.some((v) => typeof v !== "string"))) throw invalid("The pool continuation is invalid.", "cursor_invalid");
    const result = await this.db.batch([this.stateQuery(context.selection), ...this.versionQueries(context, options), this.db.prepare(base + ` SELECT count(*) total,(SELECT count(*) FROM(SELECT DISTINCT source_division_id,pool_id FROM bounded)) AS pool_count FROM bounded`).bind(ids), this.db.prepare(rowSQL).bind(ids, ...position ?? [], limit + 1), this.db.prepare(base + ` SELECT s.source_division_id,s.pool_id,max(pool_name) name,count(*) total FROM bounded s${poolPosition ? " WHERE(s.source_division_id,s.pool_id)>(?,?)" : ""} GROUP BY s.source_division_id,s.pool_id ORDER BY s.source_division_id,s.pool_id LIMIT 101`).bind(ids, ...poolPosition ?? [])]), versionCount = this.versionQueries(context, options).length, revision = await hash([result[0].results[0].content_revision, ...result.slice(1, versionCount + 1).map((r) => r.results)]);
    if (revision !== before.revision) throw invalid("Standings changed. Reload this category.", "cursor_restart", 409);
    const counts = result[versionCount + 1].results[0], rows = result[versionCount + 2].results, visible = rows.slice(0, limit), poolRows = result[versionCount + 3].results, poolItems = poolRows.slice(0, 100), pools = /* @__PURE__ */ new Map();
    for (const row of visible) {
      const key = row.source_division_id + "|" + row.pool_id;
      if (!pools.has(key)) pools.set(key, { id: key, name: row.pool_name, rows: [], total: row.pool_total, complete: false });
      const { source_division_id, pool_id, pool_name, pool_total, participant_key, ...value } = row;
      pools.get(key).rows.push({ ...value, id: participant_key });
    }
    for (const pool of pools.values()) pool.complete = pool.rows.length === pool.total;
    const selectedCoverage = coverage.filter((c) => selected.includes(c.id)), state = selectedCoverage.length ? selectedCoverage.every((c) => c.complete === 1) ? "published" : "partial" : coverage.length && coverage.every((c) => c.complete === 1 && c.availability === "unpublished") ? "unpublished" : "pending", last = visible.at(-1), poolLast = poolItems.at(-1);
    return { pools: [...pools.values()], total: counts.total, pool_count: counts.pool_count, limit, next_cursor: rows.length > limit ? await this.cursor.issue({ selection, revision, scope, position: [last.source_division_id, last.pool_id, last.rank == null ? 1 : 0, last.rank ?? 0, last.name, last.participant_key] }) : null, pool_counts: { items: poolItems.map((p) => ({ id: p.source_division_id + "|" + p.pool_id, name: p.name, total: p.total })), total: counts.pool_count, next_cursor: poolRows.length > 100 ? await this.cursor.issue({ selection: poolSelection, revision, scope: poolScope, position: [poolLast.source_division_id, poolLast.pool_id] }) : null }, state, coverage: state === "published" ? "complete" : state, official_completion: false, published: state === "published" || state === "partial", complete: state === "published", note: state === "unpublished" ? "Standings have not been published." : state === "pending" ? "Standings are still being retrieved." : state === "partial" ? "Saved standings are incomplete; background updates will continue." : null };
  }
  async matchTarget(context, eventId) {
    validId(eventId);
    const game = context.followed ? null : await resolvePublishedGame(this.db,context.selection.team_id,context.selection.team_season_id,eventId);
    if(game&&!game.available)throw invalid("This saved game is being updated. Reload it.","game_scope_changed",409);
    if(game){
      const ownRow=await this.db.prepare(detailGameCTE()+` SELECT t.event_id AS id,t.starts_at,t.local_day,t.type,t.status,t.conditional,s.home_source_team_id AS home_id,s.away_source_team_id AS away_id,t.home_name,t.away_name,t.home_score,t.away_score,t.title,t.venue,t.competition_id,t.division_id,t.result_conflict,t.identity_conflict,t.own_side,1 AS own_match,${scopedBookmarked("t.app_team_id","t.event_id","t.team_season_id")} AS bookmarked,${publicSourceBrandingJSONSQL("s.home_source_team_id")} AS home_branding,${publicSourceBrandingJSONSQL("s.away_source_team_id")} AS away_branding,s.provider FROM detail_game_targets t JOIN source_events s ON s.id=t.schedule_source_id WHERE t.run_id=? AND t.event_id=? AND t.locally_available=1`).bind(context.selection.team_id,context.selection.team_season_id,game.run_id,game.event_id).first();
      if(!ownRow)throw invalid("This saved game changed. Reload it.","game_scope_changed",409);
      await assertPublishedGameCurrent(this.db,game);
      return {...ownRow,_game_scope:game};
    }
    const canonical = await this.db.prepare("SELECT canonical_id FROM canonical_event_ids WHERE input_id=?").bind(eventId).first();
    eventId=canonical?.canonical_id??eventId;
    const cte = context.cte + "," + publicEventsCTE("dl.division_id IN(SELECT division_id FROM memberships)");
    const row = await this.db.prepare(cte + ` SELECT ${EVENT_COLUMNS} FROM e WHERE e.id=?`).bind(...context.params, context.selection.team_id, context.selection.team_season_id, eventId).first();
    if (!row) throw invalid("This match is unavailable for this team season.", "not_found", 404);
    const day = row.starts_at ? localDay(row.starts_at, context.selection.timezone) : row.local_day;
    if (day && (day < context.selection.from || day >= context.selection.to)) throw invalid("This match belongs to another season.", "not_found", 404);
    return context.followed?{...row,own_match:0}:row;
  }
  async historicalMatchTarget(context,eventId,anchorId) {
    const anchor=await this.matchTarget(context,validId(anchorId)),publicMember=anchor._game_scope?.source_members.find(m=>['gotsport','live'].includes(m.provider)),publicAnchor=publicMember?{...anchor,id:publicMember.original_event_id}:anchor,proof=await findPublicHistoryAnchor(this.db,context,publicAnchor,{now:this.now()});
    if(!proof)throw invalid('This historical match anchor is unavailable.','not_found',404);
    const first=anchor.own_side==='away'?anchor.away_id:anchor.home_id,second=anchor.own_side==='away'?anchor.home_id:anchor.away_id;
    const pair=`((${SAME('s.home_source_team_id','?')} AND ${SAME('s.away_source_team_id','?')}) OR(${SAME('s.home_source_team_id','?')} AND ${SAME('s.away_source_team_id','?')})) AND s.type='game' AND s.conditional=0 AND s.provenance='provider'`,refs=[first,first,first,second,second,second,second,second,second,first,first,first];
    const row=await this.db.prepare(`WITH ${publicEventsCTE(pair,{allSeasons:true})} SELECT ${EVENT_COLUMNS},CASE WHEN ${SAME('e.home_id','?')} THEN 'home' ELSE 'away' END AS historical_side FROM e WHERE e.id=COALESCE((SELECT canonical_id FROM canonical_event_ids WHERE input_id=?),?) AND e.type='game' AND e.conditional=0 AND e.identity_conflict=0`).bind(...refs,context.selection.team_id,context.selection.team_season_id,first,first,first,validId(eventId),eventId).first();
    if(!row)throw invalid('This match is not a verified public meeting of the anchored teams.','not_found',404);
    return {...row,own_match:0,own_side:row.historical_side,historical_context:{anchor_event_id:anchor.id,team_id:context.selection.team_id,team_season_id:context.selection.team_season_id}};
  }
  async match(input, eventId, { tab = null, limit = 50, cursor = null, players_limit = 50, players_cursor = null, players_sort = "name", players_direction = "asc", attendance_limit = 50, attendance_cursor = null, h2h_limit = 50, h2h_cursor = null, h2h_range = "all", h2h_upcoming_limit = 50, h2h_upcoming_cursor = null, h2h_anchor = null } = {}) {
    if (tab != null && !["overview", "players", "attendance", "h2h"].includes(tab)) throw invalid("Choose a valid match tab.");
    if (tab === "players") {
      players_limit = limit;
      players_cursor = cursor;
    }
    if (tab === "attendance") {
      attendance_limit = limit;
      attendance_cursor = cursor;
    }
    if (tab === "h2h") {
      h2h_limit = limit;
      h2h_cursor = cursor ?? h2h_cursor;
    }
    pageLimit(players_limit);
    pageLimit(attendance_limit);
    pageLimit(h2h_limit);
    pageLimit(h2h_upcoming_limit);
    this.category("matches");
    const context = await this.featureContext(input), row = h2h_anchor?await this.historicalMatchTarget(context,eventId,h2h_anchor):await this.matchTarget(context, eventId), before = await this.snapshot(context, { aliases: true, matchEvent: row.id }), selection = { ...context.selection, resource: "match", event_id: row.id };
    const queries = await this.db.batch([
      this.db.prepare(detailGameCTE()+` SELECT l.arrival_at,l.arrival_minutes,l.uniform,l.notes,COALESCE(NULLIF(l.address,''),r.address) AS address,r.name AS location_name,l.availability_enabled
        FROM detail_game_checked m JOIN detail_game_targets g ON g.run_id=m.run_id AND g.app_team_id=m.app_team_id AND g.team_season_id=m.team_season_id AND g.event_id=m.target_event_id AND g.locally_available=1
        JOIN source_event_logistics l ON l.source_event_id=m.source_event_id AND l.source_team_id=m.participant_source_team_id AND l.account_id=m.account_id
        LEFT JOIN source_references r ON r.source_team_id=l.source_team_id AND r.kind='locations' AND r.native_id=l.location_id
        WHERE m.target_event_id=? AND m.run_id=? AND m.entitled=1 ORDER BY l.observed_at DESC,l.source_event_id`).bind(selection.team_id,selection.team_season_id,row.id,row._game_scope?.run_id??''),
      this.db.prepare("SELECT kind FROM team_profiles WHERE app_team_id=?").bind(selection.team_id),
      this.db.prepare("SELECT count(*) AS total FROM team_players WHERE app_team_id=? AND team_season_id=?").bind(selection.team_id, selection.team_season_id),
      this.db.prepare("SELECT fields,revision FROM domain_overrides WHERE app_team_id=? AND kind='event' AND entity_id=?").bind(selection.team_id, row.id),
      clubKitsQuery(this.db, selection.team_id, selection.team_season_id)
    ]);
    const logistics = queries[0].results, uniformValues = new Set(logistics.map((r) => r.uniform).filter((v) => v != null && v !== "")), notesValues = new Set(logistics.map((r) => r.notes).filter((v) => v != null && v !== "")), addressValues = new Set(logistics.map((r) => r.address).filter((v) => v != null && v !== "")), arrivalValues = new Set(logistics.map((r) => r.arrival_at || (r.arrival_minutes != null && row.starts_at ? new Date(Date.parse(row.starts_at) - r.arrival_minutes * 6e4).toISOString() : null)).filter(Boolean));
    const single = (set) => set.size === 1 ? [...set][0] : null, arrival = single(arrivalValues), event = { ...this.eventRow(row, selection, context.branding), uniform: single(uniformValues), notes: single(notesValues), address: single(addressValues), arrival_at: arrival, arrival_label: arrival ? new Intl.DateTimeFormat("en-US", { timeZone: selection.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(arrival)) : null, logistics_conflicts: [...uniformValues.size > 1 ? ["uniform"] : [], ...notesValues.size > 1 ? ["notes"] : [], ...arrivalValues.size > 1 ? ["arrival"] : [], ...addressValues.size > 1 ? ["address"] : []] };
    event.uniform_kit = uniformKit(event.uniform, clubKitsModel(queries[4].results[0]));
    event.map_url = event.address ? "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(event.address) : null;
    const competition = row.competition_id ? await this.db.prepare("SELECT id,name,official_url FROM canonical_competitions WHERE id=?").bind(row.competition_id).first() : null;
    if (competition) {
      event.competition_name = competition.name;
      event.official_url = safeURL(competition.official_url);
    }
    const rosterCount = queries[2].results[0].total, followed = queries[1].results[0]?.kind === "followed", attendance = row.own_match ? await this.attendance(context, row.id, { limit: attendance_limit, cursor: attendance_cursor }) : null;
    const analysis = row.own_match && this.analysisReads ? await this.analysisReads.match(context.selection, row.id, { context, limit: players_limit, cursor: players_cursor, sort: players_sort, direction: players_direction }) : null, details = analysis?.data ?? analysis;
    if (details) {
      event.format = details.format ?? null;
    }
    const h2h = row.home_id && row.away_id && /^(gotsport|live)\/public\//.test(row.home_id) && /^(gotsport|live)\/public\//.test(row.away_id) && !row.conditional ? await this.headToHead(context, row, { limit: h2h_limit, cursor: h2h_cursor, range: h2h_range, upcoming_limit: h2h_upcoming_limit, upcoming_cursor: h2h_upcoming_cursor }) : null;
    const ownConfirmed = !!row.own_match && !followed && !row.conditional && !row.identity_conflict && row.type === "game", override = queries[3].results[0], editor = this.actor.owner && row.own_match ? { revision: override?.revision ?? 0, override: parse(override?.fields) ?? {}, effective: { home_score: row.home_score, away_score: row.away_score, venue: row.venue }, can_reset: !!override } : null;
    const after = await this.snapshot(context, { aliases: true, matchEvent: row.id });
    if (after.revision !== before.revision) throw invalid("This match changed. Reload it.", "cursor_restart", 409);
    if(row._game_scope){await assertPublishedGameCurrent(this.db,row._game_scope);event.game_scope_revision=await gameScopeRevision(row._game_scope);}
    return this.envelope(selection, after.state, { event, capabilities: { can_edit: !!this.actor.owner && !!row.own_match && !followed, can_bookmark: !!this.actor.owner && row.type === "game" && !row.conditional && !row.identity_conflict, can_coach: !!this.actor.owner && ownConfirmed && rosterCount > 0, has_players: !!details && details.player_count > 0, has_h2h: !!h2h, has_attendance: !!attendance && attendance.coverage !== "untracked" }, players: details?.players_page ?? { items: [], total: null, next_cursor: null }, player_count: details?.player_count ?? null, lineup: details?.lineup ?? null, leaders: details?.leaders ?? null, goal_timeline: details?.goal_timeline ?? null, analysis: details?.analysis ?? null, analysis_review: details?.review ?? null, analytics: details?.analytics ?? null, analysis_state: details?.state ?? "unavailable", attendance, h2h, attendance_summary: attendance?.totals.total ? `${attendance.totals.yes} Yes \xB7 ${attendance.totals.no} No \xB7 ${attendance.totals.maybe} Maybe` : null, ...editor ? { editor } : {} });
  }
  async attendance(context, eventId, { limit = 50, cursor = null } = {}) {
    const game=await resolvePublishedGame(this.db,context.selection.team_id,context.selection.team_season_id,eventId);
    if(!game?.available||context.followed)throw invalid("This saved game is unavailable.","game_scope_changed",409);
    eventId=game.event_id;
    const key = [context.selection.team_id, context.selection.team_season_id, eventId], selection = { ...context.selection, search: "", period: "all", resource: "match-attendance", event_id: eventId, direction: "asc" };
    const cte = `WITH attendance_events AS(SELECT * FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=?),${attendanceCTE()},e AS(SELECT player_id AS id,name,jersey,status AS response_label,scope_complete,tracking_conflict FROM attendance_native)`;
    const result = await this.page(context, { selection, cte, params:key, columns: "e.id,e.name,e.jersey,e.response_label,e.scope_complete,e.tracking_conflict", order: "e.id", resource: "match-attendance/" + eventId, limit, cursor, versionOptions: { matchEvent: eventId }, totalColumns: "count(*) AS total,sum(response_label='Yes') AS yes,sum(response_label='No') AS no,sum(response_label='Maybe') AS maybe,sum(response_label='NR') AS no_response,sum(response_label='Conflict') AS conflicts,sum(response_label IN('Unavailable','Unknown')) AS unavailable,sum(response_label='Unavailable') AS missing,sum(response_label='Unknown') AS unknown,sum(response_label='Untracked') AS untracked,sum(response_label<>'Untracked' AND scope_complete=0) AS incomplete", map: ({scope_complete,tracking_conflict,...r}) => ({ ...r, response: { Yes: "yes", No: "no", Maybe: "maybe", NR: "no_response", Conflict: "conflict", Unknown: "unknown", Unavailable: "unavailable", Untracked: "untracked" }[r.response_label] ?? "unknown", coverage_state: r.response_label==='Conflict'||tracking_conflict ? 'human_review' : ['Unavailable','Unknown'].includes(r.response_label) ? 'unavailable' : r.response_label==='Untracked' ? 'untracked' : scope_complete ? 'complete' : 'incomplete' }) });
    await assertPublishedGameCurrent(this.db,game);
    const totals = result.aggregate;
    const coverage = totals.total === 0 || totals.total === totals.untracked ? "untracked" : totals.unavailable > 0 || totals.conflicts > 0 || totals.incomplete > 0 ? "partial" : "complete";
    return { totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v ?? 0])), players: result.page, coverage };
  }

  async headToHead(context, current, options = {}) {
    const first = current.own_side === "away" ? current.away_id : current.home_id, second = current.own_side === "away" ? current.home_id : current.away_id, pair = `((${SAME("s.home_source_team_id", "?")} AND ${SAME("s.away_source_team_id", "?")}) OR(${SAME("s.home_source_team_id", "?")} AND ${SAME("s.away_source_team_id", "?")})) AND s.type='game' AND s.conditional=0`;
    const refs = [first, first, first, second, second, second, second, second, second, first, first, first], historical = publicEventsCTE(pair, { allSeasons: true }).replace("  e AS(", "  historical AS("), orientation = SAME("h.home_id", "?"), scored = "h.conditional=0 AND h.result_conflict=0 AND h.identity_conflict=0 AND h.status IN('FINAL','COMPLETED') AND h.home_score IS NOT NULL AND h.away_score IS NOT NULL", cte = `WITH ${historical},e AS(SELECT h.*,CASE WHEN ${scored} THEN CASE WHEN ${orientation} THEN h.home_score ELSE h.away_score END END AS gf,CASE WHEN ${scored} THEN CASE WHEN ${orientation} THEN h.away_score ELSE h.home_score END END AS ga FROM historical h)`, params = [...refs, context.selection.team_id, context.selection.team_season_id, first, first, first, first, first, first];
    return readHeadToHead(this,context,current,options,{cte,params,first,second,columns:EVENT_COLUMNS+",e.app_team_id,e.team_season_id",order:TIME,dayBoundary});
  }
  async schedule(input,options={}) {
    const result=await super.schedule(input,options);
    result.data.items=await brandEventRows(this.db,this.actor,result.data.items,{teamId:result.selection.team_id,seasonId:result.selection.team_season_id,now:this.now()});
    if((await this.stateQuery(result.selection).first()).content_revision!==result.revision.content)throw invalid("This schedule changed. Reload it.","cursor_restart",409);
    return result;
  }
  async overview(input) {
    this.category("overview");
    const base = await super.overview(input), context = await this.featureContext({ ...input, period: "all", search: "" }), before = await this.snapshot(context), q = playerSeasonQuery(base.selection), rows = await this.db.batch([
      this.stateQuery(base.selection),
      this.db.prepare(`SELECT id,name,apps,minutes,g_plus_a AS ga,g_plus_a_per_60 AS ga_per_60 FROM(${q.sql}) WHERE g_plus_a IS NOT NULL ORDER BY g_plus_a DESC,minutes DESC,id LIMIT 4`).bind(...q.params),
      this.db.prepare("SELECT count(*) AS total FROM team_players WHERE app_team_id=? AND team_season_id=?").bind(base.selection.team_id, base.selection.team_season_id),
      this.db.prepare(detailGameCTE()+`,${analyzedEventsCTE('detail_selection','detail_game')} SELECT count(*) AS total FROM catalog_events e WHERE ${statisticalSelectionSQL(base.selection)}`).bind(base.selection.team_id, base.selection.team_season_id),
      this.db.prepare(context.cte + ` SELECT c.id AS competition_id,c.name AS competition_name,d.name AS division_name,s.rank AS position,s.points,s.played,cv.complete,cv.availability FROM memberships m JOIN eligible c ON c.id=m.competition_id JOIN canonical_divisions d ON d.id=m.division_id JOIN division_source_links dl ON dl.division_id=d.id JOIN source_standings s ON s.source_division_id=dl.source_division_id JOIN source_standings_coverage cv ON cv.source_division_id=dl.source_division_id WHERE s.participant_key IN(SELECT id FROM selected_sources) AND cv.availability='published' ORDER BY c.ends_on IS NULL DESC,c.ends_on DESC,CASE WHEN s.source_division_id LIKE 'gotsport/%' THEN 0 ELSE 1 END,s.rank IS NULL,s.rank LIMIT 1`).bind(...context.params),
      this.db.prepare("SELECT kind FROM team_profiles WHERE app_team_id=?").bind(base.selection.team_id)
    ]);
    if (rows[0].results[0].content_revision !== base.revision.content) throw invalid("This overview changed. Reload it.", "cursor_restart", 409);
    const eventKeys=["next_event","latest_result"].filter(key=>base.data[key]),branded=await brandEventRows(this.db,this.actor,eventKeys.map(key=>base.data[key]),{teamId:base.selection.team_id,seasonId:base.selection.team_season_id,now:this.now()});
    eventKeys.forEach((key,index)=>base.data[key]=branded[index]);
    const after = await this.snapshot(context);
    if (after.revision !== before.revision) throw invalid("This overview changed. Reload it.", "cursor_restart", 409);
    const standing = rows[4].results[0];
    return { ...base, data: { ...base.data, team_name: context.team.name, season_label: `${context.season.year}\u2013${context.season.year + 1}`, past_season: context.past_season, followed: rows[5].results[0]?.kind === "followed", roster_count: rows[2].results[0].total, analyzed_count: rows[3].results[0].total, analyzed_note: 'Saved analyzed games; some quantities may be incomplete or unavailable.', leaders: rows[1].results, standing: standing ? { ...standing, coverage: standing.complete ? "complete" : "partial" } : null } };
  }
  async writeAward(input,statements) {
    const fence=crypto.randomUUID();
    try {return (await this.db.batch([this.db.prepare("INSERT INTO feature_write_fences VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM app_teams WHERE id=?) AND EXISTS(SELECT 1 FROM team_seasons WHERE id=? AND app_team_id=?) AND NOT EXISTS(SELECT 1 FROM team_lifecycle WHERE team_id=?) THEN 1 ELSE 0 END)").bind(fence,input.team_id,input.team_season_id,input.team_id,input.team_id),...statements,this.db.prepare("DELETE FROM feature_write_fences WHERE token=?").bind(fence)])).slice(1,-1);}catch(error){if(String(error.message).includes("feature_revision_current"))throw invalid("This team is being removed. The award was not changed.","team_removed",409);throw error;}
  }
  async setAward(input, value, revision = 0) {
    own(this.actor);
    const context = await this.context(input);
    if (!Number.isInteger(revision) || revision < 0) throw invalid("Choose a valid award revision.");
    if (!value || typeof value !== "object" || typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 300 || typeof (value.note ?? "") !== "string" || (value.note ?? "").length > 2e3 || value.place != null && (!Number.isInteger(value.place) || value.place < 1 || value.place > 64)) throw invalid("Choose a valid award title, place and note.");
    const title = value.title.trim(), note = value.note ?? "", place = value.place ?? null, competitionId = value.competition_id ?? null, requestId = validId(value.request_id), id = value.id ? validId(value.id) : crypto.randomUUID(), stamp = new Date(this.now()).toISOString(), token = crypto.randomUUID();
    if (competitionId) {
      const reachable = await this.featureContext(input);
      if (!await this.db.prepare(reachable.cte + " SELECT id FROM eligible WHERE id=?").bind(...reachable.params, validId(competitionId)).first()) throw invalid("This award competition is unavailable for this season.", "not_found", 404);
    }
    const sql = revision === 0 ? `INSERT INTO owner_awards(id,app_team_id,team_season_id,competition_id,title,place,note,revision,request_id,created_at,updated_at,write_token) VALUES(?,?,?,?,?,?,?,1,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id` : `UPDATE owner_awards SET competition_id=?,title=?,place=?,note=?,revision=revision+1,updated_at=?,write_token=? WHERE id=? AND app_team_id=? AND team_season_id=? AND revision=? RETURNING id`;
    const params = revision === 0 ? [id, input.team_id, input.team_season_id, competitionId, title, place, note, requestId, stamp, stamp, token] : [competitionId, title, place, note, stamp, token, id, input.team_id, input.team_season_id, revision];
    const writes = await this.writeAward(input,[this.db.prepare(sql).bind(...params), this.db.prepare("UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=? AND EXISTS(SELECT 1 FROM owner_awards WHERE write_token=?)").bind(input.team_id, token)]);
    if (!writes[0].results.length) {
      if (revision === 0) {
        const prior = await this.db.prepare("SELECT * FROM owner_awards WHERE request_id=?").bind(requestId).first();
        if (prior && prior.app_team_id === input.team_id && prior.team_season_id === input.team_season_id && prior.title === title && prior.note === note && prior.place === place && prior.competition_id === competitionId) return { award: this.awardRow(prior), idempotent: true };
      }
      throw invalid("This award changed. Reload it.", "revision_conflict", 409);
    }
    const saved = await this.db.prepare("SELECT * FROM owner_awards WHERE id=?").bind(id).first();
    return { award: this.awardRow(saved), idempotent: false };
  }
  awardRow(row) {
    return { id: row.id, team_season_id: row.team_season_id, competition_id: row.competition_id, title: row.title, place: row.place, note: row.note, revision: row.revision, origin: "owner", owner_recorded: true, verified: false, created_at: row.created_at, updated_at: row.updated_at };
  }
  async deleteAward(input, id, revision) {
    own(this.actor);
    await this.context(input);
    validId(id);
    if (!Number.isInteger(revision) || revision < 1) throw invalid("Choose a valid award revision.");
    const token = crypto.randomUUID();
    const result = await this.writeAward(input,[this.db.prepare("INSERT INTO award_write_fences(id,token) SELECT ?,? WHERE EXISTS(SELECT 1 FROM owner_awards WHERE id=? AND app_team_id=? AND team_season_id=? AND revision=?) RETURNING id").bind(token, token, id, input.team_id, input.team_season_id, revision), this.db.prepare("DELETE FROM owner_awards WHERE id=? AND app_team_id=? AND team_season_id=? AND revision=? AND EXISTS(SELECT 1 FROM award_write_fences WHERE token=?)").bind(id, input.team_id, input.team_season_id, revision, token), this.db.prepare("UPDATE team_read_state SET content_revision=content_revision+1 WHERE app_team_id=? AND EXISTS(SELECT 1 FROM award_write_fences WHERE token=?)").bind(input.team_id, token), this.db.prepare("DELETE FROM award_write_fences WHERE token=?").bind(token)]);
    if (!result[0].results.length) throw invalid("This award changed. Reload it.", "revision_conflict", 409);
    return { deleted: true, id };
  }
  awardsCTE(teamId) {
    return { cte: `WITH attached AS(SELECT team_season_id,source_team_id FROM team_source_attachments WHERE app_team_id=? AND active=1),selected_sources AS(SELECT team_season_id,source_team_id AS id FROM attached UNION SELECT a.team_season_id,CASE WHEN l.a=a.source_team_id THEN l.b ELSE l.a END FROM source_team_links l JOIN attached a ON l.a=a.source_team_id OR l.b=a.source_team_id),memberships AS(SELECT DISTINCT a.team_season_id,a.id AS participant_key,dl.division_id,cl.competition_id FROM selected_sources a JOIN source_competition_memberships m ON m.source_team_id=a.id JOIN division_source_links dl ON dl.source_division_id=m.source_division_id JOIN source_divisions d ON d.id=m.source_division_id JOIN competition_source_links cl ON cl.source_competition_id=d.competition_id)`, params: [teamId] };
  }
  async trophies(input, { limit = 50, cursor = null } = {}) {
    this.category("team");
    const context = await this.featureContext(input), all = this.awardsCTE(input.team_id), selection = { ...context.selection, resource: "trophies-all-seasons", search: "", period: "all", direction: "desc" };
    const versionQuery = () => this.db.prepare(all.cte + ` SELECT DISTINCT m.team_season_id,m.competition_id,m.division_id,d.id,d.content_revision AS division_revision,c.content_revision AS competition_revision,v.content_revision AS fixtures_revision,v.complete AS fixture_complete,sv.complete AS standing_complete,sv.availability,(SELECT revision FROM award_source_state WHERE source_division_id=d.id) AS qualification_revision FROM memberships m JOIN division_source_links dl ON dl.division_id=m.division_id JOIN source_divisions d ON d.id=dl.source_division_id JOIN source_competitions c ON c.id=d.competition_id LEFT JOIN source_division_coverage v ON v.source_division_id=d.id LEFT JOIN source_standings_coverage sv ON sv.source_division_id=d.id ORDER BY m.team_season_id,m.division_id,d.id`).bind(...all.params);
    const snapshot = async () => {
      const rows2 = await this.db.batch([this.stateQuery(context.selection), versionQuery()]);
      return { state: rows2[0].results[0], revision: await hash([rows2[0].results[0].content_revision, rows2[1].results]) };
    };
    pageLimit(limit);
    const before = await snapshot(), scope = this.scope(input.team_id) + "/trophies", position = cursor ? await this.cursor.verify(cursor, { selection, revision: before.revision, scope }) : null;
    if (position && (!Array.isArray(position) || position.length !== 2 || typeof position[0] !== "number" || typeof position[1] !== "string")) throw invalid("The award cursor is invalid.", "cursor_invalid");
    const contradictory = `EXISTS(SELECT 1 FROM source_events other JOIN event_source_links ol ON ol.source_event_id=other.id JOIN canonical_event_ids oc ON oc.input_id=ol.event_id WHERE oc.canonical_id=ce.canonical_id AND other.id<>x.id AND other.provider IN('gotsport','live') AND other.scope='public' AND other.status IN('FINAL','COMPLETED') AND other.home_score IS NOT NULL AND other.away_score IS NOT NULL AND NOT((${SAME("x.home_source_team_id", "other.home_source_team_id")} AND ${SAME("x.away_source_team_id", "other.away_source_team_id")} AND x.home_score=other.home_score AND x.away_score=other.away_score) OR(${SAME("x.home_source_team_id", "other.away_source_team_id")} AND ${SAME("x.away_source_team_id", "other.home_source_team_id")} AND x.home_score=other.away_score AND x.away_score=other.home_score)))`;
    const cte = all.cte + `,verified AS(SELECT DISTINCT 'verified:'||q.id||':'||m.team_season_id AS id,m.team_season_id,m.competition_id,q.title,q.place,'Verified provider qualification' AS note,0 AS revision,'provider' AS origin,0 AS owner_recorded,1 AS verified,NULL AS created_at,NULL AS updated_at,q.verified_at,s.year AS season_year,c.name AS competition_name FROM memberships m JOIN team_seasons s ON s.id=m.team_season_id JOIN canonical_competitions c ON c.id=m.competition_id JOIN division_source_links dl ON dl.division_id=m.division_id JOIN source_competition_qualifications q ON q.source_division_id=dl.source_division_id AND q.participant_key=m.participant_key JOIN source_standings_coverage sv ON sv.source_division_id=q.source_division_id WHERE c.official_status IN('COMPLETED','FINAL') AND c.completion_verified_at IS NOT NULL AND (c.season_year=s.year OR(c.starts_on IS NOT NULL AND c.starts_on<s.end_day AND COALESCE(c.ends_on,c.starts_on)>=s.start_day) OR EXISTS(SELECT 1 FROM team_events season_event WHERE season_event.app_team_id=s.app_team_id AND season_event.team_season_id=m.team_season_id AND season_event.competition_id=c.id)) AND sv.complete=1 AND sv.availability='published' AND NOT EXISTS(SELECT 1 FROM division_source_links dl2 LEFT JOIN source_division_coverage cv ON cv.source_division_id=dl2.source_division_id WHERE dl2.division_id=m.division_id AND COALESCE(cv.complete,0)<>1) AND EXISTS(SELECT 1 FROM source_events x JOIN division_source_links dl2 ON dl2.source_division_id=x.division_key WHERE dl2.division_id=m.division_id AND x.provider IN('gotsport','live') AND x.scope='public' AND x.conditional=0 AND x.status IN('FINAL','COMPLETED')) AND NOT EXISTS(SELECT 1 FROM source_events x JOIN division_source_links dl2 ON dl2.source_division_id=x.division_key LEFT JOIN event_source_links el ON el.source_event_id=x.id LEFT JOIN canonical_event_ids ce ON ce.input_id=el.event_id LEFT JOIN team_events te ON te.app_team_id=? AND te.team_season_id=m.team_season_id AND te.event_id=ce.canonical_id WHERE dl2.division_id=m.division_id AND x.provider IN('gotsport','live') AND x.scope='public' AND (ce.canonical_id IS NULL OR(x.conditional=0 AND (x.home_source_team_id IS NULL OR x.away_source_team_id IS NULL OR x.status NOT IN('FINAL','COMPLETED','CANCELLED') OR(x.status IN('FINAL','COMPLETED') AND (x.home_score IS NULL OR x.away_score IS NULL)) OR ${contradictory} OR te.result_conflict=1 OR te.identity_conflict=1 OR EXISTS(SELECT 1 FROM source_event_correspondences ec WHERE(ec.a=x.id OR ec.b=x.id) AND ec.status='review')))))),e AS(SELECT a.id,a.team_season_id,a.competition_id,a.title,a.place,a.note,a.revision,'owner' AS origin,1 AS owner_recorded,0 AS verified,a.created_at,a.updated_at,NULL AS verified_at,s.year AS season_year,c.name AS competition_name FROM owner_awards a JOIN team_seasons s ON s.id=a.team_season_id LEFT JOIN canonical_competitions c ON c.id=a.competition_id WHERE a.app_team_id=? UNION ALL SELECT * FROM verified)`;
    const params = [...all.params, input.team_id, input.team_id], pageWhere = position ? "WHERE (e.season_year<? OR(e.season_year=? AND e.id>?))" : "", rows = await this.db.batch([this.stateQuery(context.selection), versionQuery(), this.db.prepare(cte + " SELECT count(*) AS total FROM e").bind(...params), this.db.prepare(cte + ` SELECT * FROM e ${pageWhere} ORDER BY e.season_year DESC,e.id ASC LIMIT ?`).bind(...params, ...position ? [position[0], position[0], position[1]] : [], limit + 1)]), revision = await hash([rows[0].results[0].content_revision, rows[1].results]);
    if (revision !== before.revision) throw invalid("These awards changed. Reload them.", "cursor_restart", 409);
    const records = rows[3].results, items = records.slice(0, limit).map((r) => ({ ...r, owner_recorded: !!r.owner_recorded, verified: !!r.verified })), last = items.at(-1);
    return this.envelope(selection, rows[0].results[0], { items, total: rows[2].results[0].total, next_cursor: records.length > limit ? await this.cursor.issue({ selection, revision, scope, position: [last.season_year, last.id] }) : null, all_seasons: true, followed: context.followed, official_completion_required: true, note: "Owner-recorded awards are labeled separately from verified provider qualifications." });
  }
}
export {
  AWARDS_SCHEMA,
  EVENT_COLUMNS,
  FeatureReads,
  dayBoundary,
  publicEventsCTE
};
