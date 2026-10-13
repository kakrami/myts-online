import {analyzedEventsCTE} from '../analysis/eligibility.js';
import {gameScopeRevision,publishedGameScopeCTE} from '../domain/team-game-scope.js';
import {invalid,normalizeSelection,calendarDay,stableSelectionKey,localDay,addDays} from './selection.js';
import {statisticalSelectionSQL} from './inclusion.js';
import {scheduleQuery} from '../../web/app/schedule-query.js';
import {headToHeadTimezone} from './h2h-timezone.js';
const parse=(value)=>{try{return JSON.parse(value);}catch{return null;}};
const STATE='SELECT r.content_revision,r.status_revision,COALESCE((SELECT p.pending FROM team_projection_state p WHERE p.team_season_id=? AND p.app_team_id=r.app_team_id),r.pending) AS pending FROM team_read_state r WHERE r.app_team_id=?';
const COLUMNS='game_state.published_run_id AS game_run_id,e.source_ids AS game_source_ids,e.app_team_id AS game_app_team_id,e.team_season_id AS game_team_season_id,e.event_id AS id,e.competition_id,e.division_id,e.starts_at,e.local_day,e.type,e.status,e.conditional,e.own_side,e.home_name,e.away_name,e.home_score,e.away_score,e.goals_for,e.goals_against,e.title,e.venue,e.result_conflict,e.identity_conflict,e.conflict,EXISTS(SELECT 1 FROM game_bookmarks b JOIN canonical_event_ids ci ON ci.input_id=b.event_id WHERE b.app_team_id=e.app_team_id AND ci.canonical_id=e.event_id) AS bookmarked';
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
    // Same accepted-publication population as the Overview and Reports count.
    if(selection.type==='analyzed')clauses.push(statisticalSelectionSQL(selection),'EXISTS(SELECT 1 FROM catalog_events a WHERE a.app_team_id=e.app_team_id AND a.team_season_id=e.team_season_id AND a.event_id=e.event_id)');
    if(selection.search) { clauses.push("(e.home_name LIKE ? ESCAPE '\\' OR e.away_name LIKE ? ESCAPE '\\' OR e.title LIKE ? ESCAPE '\\')");const q='%'+selection.search.replace(/[\\%_]/g,v=>'\\'+v)+'%';params.push(q,q,q); }
    if(selection.period!=='all') {
      const past="COALESCE((e.status IN('FINAL','COMPLETED','CANCELLED') OR (e.starts_at IS NOT NULL AND e.starts_at<?) OR (e.starts_at IS NULL AND e.local_day<?)),0)";
      clauses.push(selection.period==='past'?past:`NOT ${past}`);params.push(new Date(now).toISOString(),localDay(new Date(now).toISOString(),selection.timezone));
    }
    if(statistics) {
      clauses.push(statisticalSelectionSQL(selection));
      if(record)clauses.push("e.status IN('FINAL','COMPLETED') AND e.result_conflict=0 AND e.goals_for IS NOT NULL AND e.goals_against IS NOT NULL");
    }
    const cte=selection.type==='analyzed'?`catalog_selection AS(SELECT ? AS app_team_id,? AS team_season_id),${publishedGameScopeCTE('catalog_selection','catalog_game')},${analyzedEventsCTE('catalog_selection','catalog_game')}`:'',cteParams=cte?[selection.team_id,selection.team_season_id]:[];
    return {where:clauses.join(' AND '),params,cte,cteParams};
  }
  async event(row) { const {game_run_id,game_source_ids,game_app_team_id,game_team_season_id,...event}=row;return {...event,conflict:parse(row.conflict),can_edit:!!this.actor.owner,game_scope_revision:await gameScopeRevision({run_id:game_run_id,source_ids:game_source_ids,app_team_id:game_app_team_id,team_season_id:game_team_season_id,event_id:row.id})}; }
  async schedule(input,{limit=50,cursor=null}={}) {
    const context=await this.context(input),selection=scheduleQuery({...context.selection,direction:input.direction},{seasonEnd:context.season.end_day,today:localDay(new Date(this.now()).toISOString(),context.selection.timezone),allowDirection:true});if(!Number.isInteger(limit)||limit<1||limit>100) throw invalid('Invalid page size.');
    if(selection.sort!=='date') throw invalid('Invalid schedule sort.');
    const before=await this.stateQuery(selection).first(),cursorSelection={...selection,resource:'schedule',order_policy:'local-day-known-before-tbd-offset-v1'},scope=this.scope(selection.team_id);
    const position=cursor?await this.cursor.verify(cursor,{selection:cursorSelection,revision:before.content_revision,scope}):null;
    if(position) {
      if(!Array.isArray(position)||position.length!==5||position.some(v=>typeof v!=='string')||!['0','1','2'].includes(position[1])||!position[3]||!Number.isFinite(Date.parse(position[4]))||position[1]==='0'&&!Number.isFinite(Date.parse(position[2]))||position[1]!=='0'&&position[2]!==''||position[1]==='2'&&position[0]!=='')throw invalid('The list cursor is invalid.','cursor_invalid');
      if(position[1]!=='2')calendarDay(position[0]);
    }
    const asOf=position?.[4]??new Date(this.now()).toISOString(),timezone=headToHeadTimezone(selection.timezone),filter=this.filters(selection,{calendar:true,now:Date.parse(asOf)}),compare=selection.direction==='desc'?'<':'>',direction=selection.direction.toUpperCase();
    // Only Schedule's Day selection uses this exact local-day predicate. Keep
    // other read-model filters and the published season membership unchanged.
    if(selection.mode==='day') {
      const from=timezone.compare(selection.date,'>='),to=timezone.compare(addDays(selection.date,1),'<');
      filter.where+=` AND ((${from.sql} AND ${to.sql}) OR(e.starts_at IS NULL AND e.local_day=?))`;filter.params.push(...from.params,...to.params,selection.date);
    }
    let timedSeek='',datedSeek='',undatedSeek='',timedParams=[],datedParams=[],undatedParams=[];
    if(position) {
      const [day,kind,instant,id]=position;
      if(kind==='2') {
        timedSeek=datedSeek=' AND 0';undatedSeek=` AND e.event_id${compare}?`;undatedParams=[id];
      }else if(kind==='0') {
        const other=timezone.compare(direction==='DESC'?day:addDays(day,1),direction==='DESC'?'<':'>='),from=timezone.compare(day,'>='),to=timezone.compare(addDays(day,1),'<');
        timedSeek=` AND(${other.sql} OR(${from.sql} AND ${to.sql} AND(e.starts_at${compare}? OR(e.starts_at=? AND e.event_id${compare}?))))`;timedParams=[...other.params,...from.params,...to.params,instant,instant,id];
        datedSeek=` AND e.local_day${compare}=?`;datedParams=[day];
      }else {
        const other=timezone.compare(direction==='DESC'?day:addDays(day,1),direction==='DESC'?'<':'>=');timedSeek=' AND '+other.sql;timedParams=other.params;
        datedSeek=` AND(e.local_day${compare}? OR(e.local_day=? AND e.event_id${compare}?))`;datedParams=[day,day,id];
      }
    }
    // Three separately bounded streams preserve original known-before-TBD
    // ordering without fetching or sorting a complete season. Wholly undated
    // events form the final stream in either direction.
    const pageQuery=repairs=>{
      const order=timezone.order(repairs),timed=`SELECT ${COLUMNS} FROM team_events e JOIN team_projection_state game_state ON game_state.app_team_id=e.app_team_id AND game_state.team_season_id=e.team_season_id WHERE ${filter.where} AND e.starts_at IS NOT NULL${timedSeek} ORDER BY ${order.sql} ${direction},e.starts_at ${direction},e.event_id ${direction} LIMIT ?`,dated=`SELECT ${COLUMNS} FROM team_events e JOIN team_projection_state game_state ON game_state.app_team_id=e.app_team_id AND game_state.team_season_id=e.team_season_id WHERE ${filter.where} AND e.starts_at IS NULL AND e.local_day IS NOT NULL${datedSeek} ORDER BY e.local_day ${direction},e.event_id ${direction} LIMIT ?`,undated=`SELECT ${COLUMNS} FROM team_events e JOIN team_projection_state game_state ON game_state.app_team_id=e.app_team_id AND game_state.team_season_id=e.team_season_id WHERE ${filter.where} AND e.starts_at IS NULL AND e.local_day IS NULL${undatedSeek} ORDER BY e.event_id ${direction} LIMIT ?`;
      return this.db.prepare(`${filter.cte?`WITH ${filter.cte} `:''}SELECT * FROM(${timed}) UNION ALL SELECT * FROM(${dated}) UNION ALL SELECT * FROM(${undated})`).bind(...filter.cteParams,...filter.params,...timedParams,...order.params,limit+1,...filter.params,...datedParams,limit+1,...filter.params,...undatedParams,limit+1);
    };
    const queries=await this.db.batch([
      this.db.prepare(`${filter.cte?`WITH ${filter.cte} `:''}SELECT COUNT(*) AS total FROM team_events e WHERE ${filter.where}`).bind(...filter.cteParams,...filter.params),pageQuery([]),
    ]);
    let page=queries[1];const timed=page.results.filter(row=>row.starts_at),repairs=timezone.repairs([timed[0]?.starts_at,timed.at(-1)?.starts_at,position?.[2]]);
    if(repairs.length)page=await pageQuery(repairs).all();
    const state=await this.stateQuery(selection).first();if(state.content_revision!==before.content_revision)throw invalid('The list changed. Reload this selection.','cursor_restart',409);
    const sign=direction==='DESC'?-1:1,rows=page.results.map(row=>({row,day:row.starts_at?localDay(row.starts_at,selection.timezone):row.local_day}));
    rows.sort((a,b)=>!a.day||!b.day?a.day?-1:b.day?1:(a.row.id<b.row.id?-1:a.row.id>b.row.id?1:0)*sign:a.day!==b.day?(a.day<b.day?-1:1)*sign:!!a.row.starts_at!==!!b.row.starts_at?a.row.starts_at?-1:1:a.row.starts_at!==b.row.starts_at?(a.row.starts_at<b.row.starts_at?-1:1)*sign:(a.row.id<b.row.id?-1:a.row.id>b.row.id?1:0)*sign);
    const items=rows.slice(0,limit),last=items.at(-1);
    return this.envelope(selection,state,{items:await Promise.all(items.map(({row})=>this.event(row))),total:queries[0].results[0].total,next_cursor:rows.length>limit?await this.cursor.issue({selection:cursorSelection,revision:state.content_revision,scope,position:[last.day??'',last.row.starts_at?'0':last.day?'1':'2',last.row.starts_at??'',last.row.id,asOf]}):null});
  }
  async calendar(input,{from,to}) {
    const {selection}=await this.context(input);calendarDay(from);calendarDay(to);
    if(from>=to||(Date.parse(to)-Date.parse(from))/86400000>62) throw invalid('Choose a calendar range of at most 62 days.');
    const filter=this.filters(selection,{calendar:true});
    const queries=await this.db.batch([
      this.stateQuery(selection),
      this.db.prepare(`${filter.cte?`WITH ${filter.cte} `:''}SELECT ${ORDER_DAY} AS day,COUNT(*) AS total,json_group_array(DISTINCT e.type) AS kinds FROM team_events e WHERE ${filter.where} AND ${ORDER_DAY}>=? AND ${ORDER_DAY}<? GROUP BY ${ORDER_DAY} ORDER BY day`).bind(...filter.cteParams,...filter.params,from,to),
    ]);
    return this.envelope(selection,queries[0].results[0],{from,to,days:queries[1].results.map(row=>({...row,kinds:(parse(row.kinds)||[]).filter(kind=>['game','practice','event'].includes(kind)).sort()}))});
  }
  async overview(input) {
    const {selection}=await this.context({...input,mode:'season',type:'all',period:'all',search:''});
    const filter=this.filters(selection,{statistics:true}),base=this.filters(selection),now=new Date(this.now()).toISOString();
    const queries=await this.db.batch([
      this.stateQuery(selection),
      this.db.prepare(`SELECT COUNT(*) AS games,COALESCE(SUM(e.goals_for>e.goals_against),0) AS wins,COALESCE(SUM(e.goals_for=e.goals_against),0) AS draws,COALESCE(SUM(e.goals_for<e.goals_against),0) AS losses,COALESCE(SUM(e.goals_for),0) AS goals_for,COALESCE(SUM(e.goals_against),0) AS goals_against FROM team_events e WHERE ${filter.where}`).bind(...filter.params),
      this.db.prepare(`SELECT ${COLUMNS} FROM team_events e JOIN team_projection_state game_state ON game_state.app_team_id=e.app_team_id AND game_state.team_season_id=e.team_season_id WHERE ${base.where} AND e.status NOT IN('FINAL','COMPLETED','CANCELLED') AND ((e.starts_at IS NOT NULL AND e.starts_at>=?) OR (e.starts_at IS NULL AND e.local_day>=?)) ORDER BY ${ORDER_TIME},e.event_id LIMIT 1`).bind(...base.params,now,localDay(now,selection.timezone)),
      this.db.prepare(`SELECT ${COLUMNS} FROM team_events e JOIN team_projection_state game_state ON game_state.app_team_id=e.app_team_id AND game_state.team_season_id=e.team_season_id WHERE ${filter.where} ORDER BY ${ORDER_TIME} DESC,e.event_id DESC LIMIT 1`).bind(...filter.params),
      this.db.prepare(`SELECT COUNT(*) AS unresolved_results FROM team_events e WHERE ${base.where} AND ${statisticalSelectionSQL(selection)} AND e.status IN('FINAL','COMPLETED') AND (e.result_conflict=1 OR e.goals_for IS NULL OR e.goals_against IS NULL)`).bind(...base.params),
    ]);
    return this.envelope(selection,queries[0].results[0],{record:{...queries[1].results[0],...queries[4].results[0]},next_event:queries[2].results[0]?await this.event(queries[2].results[0]):null,latest_result:queries[3].results[0]?await this.event(queries[3].results[0]):null});
  }
}
