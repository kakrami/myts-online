import {invalid,normalizeSelection,calendarDay,stableSelectionKey,localDay} from './selection.js';
import {statisticalSelectionSQL} from './inclusion.js';
const parse=(value)=>{try{return JSON.parse(value);}catch{return null;}};
const STATE='SELECT r.content_revision,r.status_revision,COALESCE((SELECT p.pending FROM team_projection_state p WHERE p.team_season_id=? AND p.app_team_id=r.app_team_id),r.pending) AS pending FROM team_read_state r WHERE r.app_team_id=?';
const COLUMNS='e.event_id AS id,e.competition_id,e.division_id,e.starts_at,e.local_day,e.type,e.status,e.conditional,e.own_side,e.home_name,e.away_name,e.home_score,e.away_score,e.goals_for,e.goals_against,e.title,e.venue,e.result_conflict,e.identity_conflict,e.conflict,EXISTS(SELECT 1 FROM game_bookmarks b JOIN canonical_event_ids ci ON ci.input_id=b.event_id WHERE b.app_team_id=e.app_team_id AND ci.canonical_id=e.event_id) AS bookmarked';
const ORDER_DAY="COALESCE(e.local_day,substr(e.starts_at,1,10),'9999-12-31')";
const ORDER_TIME="COALESCE(e.starts_at,e.local_day,'9999-12-31')";
export class ReadRepository {
  constructor(db,actor,{cursor,now=Date.now}={}) { this.db=db;this.actor=actor;this.cursor=cursor;this.now=now; }
  authorize(teamId) { if(this.actor?.owner!==true && !(this.actor?.owner===false&&this.actor.teamId===teamId)) throw invalid('This team is unavailable.','team_forbidden',403); }
  scope(teamId) { return this.actor.owner?'owner/'+teamId:'viewer/'+teamId; }
  stateQuery(selection){return this.db.prepare(STATE).bind(selection.team_season_id,selection.team_id);}
  async context(input) {
    this.authorize(input.team_id);
    const [teams,seasons]=await this.db.batch([
      this.db.prepare('SELECT * FROM app_teams WHERE id=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=app_teams.id)').bind(input.team_id),
      this.db.prepare('SELECT * FROM team_seasons WHERE app_team_id=? AND id=?').bind(input.team_id,input.team_season_id),
    ]);
    const team=teams.results?.[0] || teams[0]?.results?.[0];
    const season=seasons.results?.[0] || seasons[0]?.results?.[0];
    if(!team||!season) throw invalid('The selected team or season is unavailable.','not_found',404);
    return {team,season,selection:normalizeSelection(input,team,{...season,start_date:season.start_day,end_date:season.end_day},this.now())};
  }
  envelope(selection,state,data) {
    return {selection,selection_key:stableSelectionKey(selection),revision:{content:state.content_revision,status:state.status_revision},generated_at:new Date(this.now()).toISOString(),projection_pending:!!state.pending,data};
  }
  filters(selection,{calendar=false,statistics=false,record=true,now=this.now()}={}) {
    const clauses=['e.app_team_id=?','e.team_season_id=?'];const params=[selection.team_id,selection.team_season_id];
    if(!calendar&&selection.mode==='day') { clauses.push(`${ORDER_DAY}=?`);params.push(selection.date); }
    if(selection.type==='games'||selection.type==='analyzed') clauses.push("e.type='game'");
    if(selection.type==='practices') clauses.push("e.type='practice'");
    // Analysis filter is enabled after a published canonical analysis exists; never approximate it from a provider attachment.
    if(selection.type==='analyzed') clauses.push('EXISTS(SELECT 1 FROM match_analysis a WHERE a.app_team_id=e.app_team_id AND a.team_season_id=e.team_season_id AND a.event_id=e.event_id AND a.state IN(\'ready\',\'estimated\'))');
    if(selection.search) { clauses.push("(e.home_name LIKE ? ESCAPE '\\' OR e.away_name LIKE ? ESCAPE '\\' OR e.title LIKE ? ESCAPE '\\')");const q='%'+selection.search.replace(/[\\%_]/g,v=>'\\'+v)+'%';params.push(q,q,q); }
    if(selection.period!=='all') {
      const past="COALESCE((e.status IN('FINAL','COMPLETED','CANCELLED') OR (e.starts_at IS NOT NULL AND e.starts_at<?) OR (e.starts_at IS NULL AND e.local_day<?)),0)";
      clauses.push(selection.period==='past'?past:`NOT ${past}`);params.push(new Date(now).toISOString(),localDay(new Date(now).toISOString(),selection.timezone));
    }
    if(statistics) {
      clauses.push(statisticalSelectionSQL(selection));
      if(record)clauses.push("e.status IN('FINAL','COMPLETED') AND e.result_conflict=0 AND e.goals_for IS NOT NULL AND e.goals_against IS NOT NULL");
    }
    return {where:clauses.join(' AND '),params};
  }
  event(row) { return {...row,conflict:parse(row.conflict),can_edit:!!this.actor.owner}; }
  async schedule(input,{limit=50,cursor=null}={}) {
    const {selection}=await this.context(input);if(!Number.isInteger(limit)||limit<1||limit>100) throw invalid('Invalid page size.');
    if(selection.sort!=='date') throw invalid('Invalid schedule sort.');
    const before=await this.stateQuery(selection).first();
    let position=cursor?await this.cursor.verify(cursor,{selection,revision:before.content_revision,scope:this.scope(selection.team_id)}):null;
    const filter=this.filters(selection),compare=selection.direction==='desc'?'<':'>',direction=selection.direction==='desc'?'DESC':'ASC';
    if(position&&(!Array.isArray(position)||position.length!==2||position.some(v=>typeof v!=='string'))) throw invalid('The list cursor is invalid.','cursor_invalid');
    const pageClause=position?` AND (${ORDER_TIME}${compare}? OR (${ORDER_TIME}=? AND e.event_id${compare}?))`:'';
    const queries=await this.db.batch([
      this.stateQuery(selection),
      this.db.prepare(`SELECT COUNT(*) AS total FROM team_events e WHERE ${filter.where}`).bind(...filter.params),
      this.db.prepare(`SELECT ${COLUMNS},${ORDER_TIME} AS order_value FROM team_events e WHERE ${filter.where}${pageClause} ORDER BY ${ORDER_TIME} ${direction},e.event_id ${direction} LIMIT ?`).bind(...filter.params,...(position?[position[0],position[0],position[1]]:[]),limit+1),
    ]);
    const state=queries[0].results[0];if(state.content_revision!==before.content_revision) throw invalid('The list changed. Reload this selection.','cursor_restart',409);
    const rows=queries[2].results,hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
    return this.envelope(selection,state,{items:items.map(({order_value,...row})=>this.event(row)),total:queries[1].results[0].total,next_cursor:hasMore?await this.cursor.issue({selection,revision:state.content_revision,scope:this.scope(selection.team_id),position:[last.order_value,last.id]}):null});
  }
  async calendar(input,{from,to}) {
    const {selection}=await this.context(input);calendarDay(from);calendarDay(to);
    if(from>=to||(Date.parse(to)-Date.parse(from))/86400000>62) throw invalid('Choose a calendar range of at most 62 days.');
    const filter=this.filters(selection,{calendar:true});
    const queries=await this.db.batch([
      this.stateQuery(selection),
      this.db.prepare(`SELECT ${ORDER_DAY} AS day,COUNT(*) AS total,json_group_array(DISTINCT e.type) AS kinds FROM team_events e WHERE ${filter.where} AND ${ORDER_DAY}>=? AND ${ORDER_DAY}<? GROUP BY ${ORDER_DAY} ORDER BY day`).bind(...filter.params,from,to),
    ]);
    return this.envelope(selection,queries[0].results[0],{from,to,days:queries[1].results.map(row=>({...row,kinds:(parse(row.kinds)||[]).filter(kind=>['game','practice','event'].includes(kind)).sort()}))});
  }
  async overview(input) {
    const {selection}=await this.context({...input,mode:'season',type:'all',period:'all',search:''});
    const filter=this.filters(selection,{statistics:true}),base=this.filters(selection),now=new Date(this.now()).toISOString();
    const queries=await this.db.batch([
      this.stateQuery(selection),
      this.db.prepare(`SELECT COUNT(*) AS games,COALESCE(SUM(e.goals_for>e.goals_against),0) AS wins,COALESCE(SUM(e.goals_for=e.goals_against),0) AS draws,COALESCE(SUM(e.goals_for<e.goals_against),0) AS losses,COALESCE(SUM(e.goals_for),0) AS goals_for,COALESCE(SUM(e.goals_against),0) AS goals_against FROM team_events e WHERE ${filter.where}`).bind(...filter.params),
      this.db.prepare(`SELECT ${COLUMNS} FROM team_events e WHERE ${base.where} AND e.status NOT IN('FINAL','COMPLETED','CANCELLED') AND ((e.starts_at IS NOT NULL AND e.starts_at>=?) OR (e.starts_at IS NULL AND e.local_day>=?)) ORDER BY ${ORDER_TIME},e.event_id LIMIT 1`).bind(...base.params,now,localDay(now,selection.timezone)),
      this.db.prepare(`SELECT ${COLUMNS} FROM team_events e WHERE ${filter.where} ORDER BY ${ORDER_TIME} DESC,e.event_id DESC LIMIT 1`).bind(...filter.params),
      this.db.prepare(`SELECT COUNT(*) AS unresolved_results FROM team_events e WHERE ${base.where} AND ${statisticalSelectionSQL(selection)} AND e.status IN('FINAL','COMPLETED') AND (e.result_conflict=1 OR e.goals_for IS NULL OR e.goals_against IS NULL)`).bind(...base.params),
    ]);
    return this.envelope(selection,queries[0].results[0],{record:{...queries[1].results[0],...queries[4].results[0]},next_event:queries[2].results[0]?this.event(queries[2].results[0]):null,latest_result:queries[3].results[0]?this.event(queries[3].results[0]):null});
  }
}
