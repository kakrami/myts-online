import {addDays,calendarDay,invalid,localDay} from './selection.js';
import {headToHeadTimezone} from './h2h-timezone.js';

export const HEAD_TO_HEAD_RANGES=Object.freeze([
  {value:'all',label:'All seasons'},
  {value:'season',label:'This season'},
  {value:'year',label:'Last year'},
  {value:'6months',label:'Last 6 months'},
]);

/** Original teamBrowseRange semantics, with UTC arithmetic on team-local days. */
export function headToHeadRange(range,{today,year,includeJune=true}) {
  calendarDay(today);
  if(!HEAD_TO_HEAD_RANGES.some(option=>option.value===range))throw invalid('Choose a valid head-to-head range.');
  if(range==='all')return {from:null,to:null};
  if(range==='season') {
    if(!Number.isInteger(year)||year<1||year>9998)throw invalid('Choose a valid season.');
    return {from:`${String(year).padStart(4,'0')}-${includeJune?'06':'07'}-01`,to:[`${String(year+1).padStart(4,'0')}-05-31`,today].sort()[0]};
  }
  const start=new Date(today+'T12:00:00Z'),day=start.getUTCDate();
  start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-(range==='year'?12:6));
  const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  start.setUTCDate(Math.min(day,end.getUTCDate()));
  return {from:start.toISOString().slice(0,10),to:today};
}

/** Match history uses calendar days, not whether today's kickoff has elapsed. */
export function headToHeadFilter({range,section,selection,year,asOf,timezone=headToHeadTimezone(selection.timezone)}) {
  if(!['past','upcoming'].includes(section))throw invalid('Choose a valid head-to-head section.');
  const today=localDay(asOf,selection.timezone),bounds=headToHeadRange(range,{today,year,includeJune:selection.include_june}),clauses=["e.type='game'","e.conditional=0","(e.starts_at IS NOT NULL OR e.local_day IS NOT NULL)"],params=[];
  if(bounds.from){const p=timezone.compare(bounds.from,'>=');clauses.push(`(${p.sql} OR(e.starts_at IS NULL AND e.local_day>=?))`);params.push(...p.params,bounds.from);}
  if(bounds.to){const end=addDays(bounds.to,1),p=timezone.compare(end,'<');clauses.push(`(${p.sql} OR(e.starts_at IS NULL AND e.local_day<?))`);params.push(...p.params,end);}
  const completed="e.status IN('FINAL','COMPLETED')",p=timezone.compare(today,section==='past'?'<':'>=');
  clauses.push(section==='past'?`(${completed} OR ${p.sql} OR(e.starts_at IS NULL AND e.local_day<?))`:`(NOT ${completed} AND(${p.sql} OR(e.starts_at IS NULL AND e.local_day>=?)))`);
  params.push(...p.params,today);
  return {where:clauses.join(' AND '),params,bounds};
}

/** One snapshot and one cutoff cover both independently paged sections. */
export async function readHeadToHead(reads,context,current,{range='all',limit=50,cursor=null,upcoming_limit=50,upcoming_cursor=null},{cte,params,first,second,columns,order,dayBoundary}) {
  for(const value of [limit,upcoming_limit])if(!Number.isInteger(value)||value<1||value>100)throw invalid('Invalid page size.');
  headToHeadRange(range,{today:localDay(new Date(reads.now()).toISOString(),context.selection.timezone),year:context.season.year,includeJune:context.selection.include_june});
  const versionOptions={publicPair:[first,second]},before=await reads.snapshot(context,versionOptions),base={...context.selection,date:null,search:'',period:'all',resource:'h2h',order_policy:'local-day-known-before-tbd-offset-v2',event_id:current.id,first,second,range},specs=[{section:'past',limit,token:cursor,direction:'desc'},{section:'upcoming',limit:upcoming_limit,token:upcoming_cursor,direction:'asc'}];
  for(const spec of specs) {
    spec.selection={...base,section:spec.section,direction:spec.direction};spec.scope=reads.scope(base.team_id)+'/h2h/'+current.id+'/'+spec.section;
    spec.position=spec.token?await reads.cursor.verify(spec.token,{selection:spec.selection,revision:before.revision,scope:spec.scope}):null;
    if(spec.position&&(!Array.isArray(spec.position)||spec.position.length!==5||spec.position.some(v=>typeof v!=='string')||!['0','1'].includes(spec.position[1])||!Number.isFinite(Date.parse(spec.position[4]))||spec.position[1]==='0'&&!Number.isFinite(Date.parse(spec.position[2]))))throw invalid('The head-to-head cursor is invalid.','cursor_invalid');
    if(spec.position)calendarDay(spec.position[0]);
  }
  const asOf=specs.find(spec=>spec.position)?.position[4]??new Date(reads.now()).toISOString();
  if(specs.some(spec=>spec.position&&spec.position[4]!==asOf))throw invalid('These history pages belong to different snapshots. Reload this range.','cursor_selection');
  const queries=[],timezone=headToHeadTimezone(base.timezone);
  for(const spec of specs) {
    const filter=headToHeadFilter({range,section:spec.section,selection:base,year:context.season.year,asOf,timezone});spec.bounds=filter.bounds;
    const compare=spec.direction==='desc'?'<':'>',direction=spec.direction.toUpperCase(),position=spec.position;
    let timedSeek='',undatedSeek='',timedParams=[],undatedParams=[];
    if(position) {
      const [day,pending,instant,id]=position;
      if(pending==='0') {
        const other=timezone.compare(spec.direction==='desc'?day:addDays(day,1),spec.direction==='desc'?'<':'>='),sameFrom=timezone.compare(day,'>='),sameTo=timezone.compare(addDays(day,1),'<');
        timedSeek=` AND(${other.sql} OR(${sameFrom.sql} AND ${sameTo.sql} AND(e.starts_at${compare}? OR(e.starts_at=? AND e.id${compare}?))))`;timedParams=[...other.params,...sameFrom.params,...sameTo.params,instant,instant,id];
        undatedSeek=` AND e.local_day${compare}=?`;undatedParams=[day];
      }else {
        const p=timezone.compare(spec.direction==='desc'?day:addDays(day,1),spec.direction==='desc'?'<':'>=');timedSeek=' AND '+p.sql;timedParams=p.params;
        undatedSeek=` AND(e.local_day${compare}? OR(e.local_day=? AND e.id${compare}?))`;undatedParams=[day,day,id];
      }
    }
    const totals=spec.section==='past'?"count(*) AS total,count(gf) AS games,COALESCE(sum(gf>ga),0) AS wins,COALESCE(sum(gf=ga),0) AS draws,COALESCE(sum(gf<ga),0) AS losses,COALESCE(sum(gf),0) AS goals_for,COALESCE(sum(ga),0) AS goals_against":"count(*) AS total";
    // Each stream is independently limited before the bounded merge. Never
    // retrieve or sort the complete history merely to render one page.
    spec.pageQuery=repairs=>{const order=timezone.order(repairs),timed=`SELECT ${columns} FROM e WHERE ${filter.where} AND e.starts_at IS NOT NULL${timedSeek} ORDER BY ${order.sql} ${direction},e.starts_at ${direction},e.id ${direction} LIMIT ?`,dateOnly=`SELECT ${columns} FROM e WHERE ${filter.where} AND e.starts_at IS NULL${undatedSeek} ORDER BY e.local_day ${direction},e.id ${direction} LIMIT ?`;return reads.db.prepare(cte+` SELECT * FROM(${timed}) UNION ALL SELECT * FROM(${dateOnly})`).bind(...params,...filter.params,...timedParams,...order.params,spec.limit+1,...filter.params,...undatedParams,spec.limit+1);};
    queries.push(reads.db.prepare(cte+` SELECT ${totals} FROM e WHERE ${filter.where}`).bind(...params,...filter.params),spec.pageQuery([]));
  }
  const result=await reads.db.batch(queries);
  for(let index=0;index<specs.length;index++){
    const spec=specs[index],timed=result[index*2+1].results.filter(row=>row.starts_at),repairs=timezone.repairs([timed[0]?.starts_at,timed.at(-1)?.starts_at,spec.position?.[2]]);
    if(repairs.length)result[index*2+1]=await spec.pageQuery(repairs).all();
  }
  const after=await reads.snapshot(context,versionOptions);
  if(after.revision!==before.revision)throw invalid('This head-to-head history changed. Reload this range.','cursor_restart',409);
  const pages=[];
  for(let index=0;index<specs.length;index++) {
    const spec=specs[index],direction=spec.direction==='desc'?-1:1,rows=result[index*2+1].results.map(row=>({row,day:row.starts_at?localDay(row.starts_at,base.timezone):row.local_day}));
    rows.sort((a,b)=>a.day!==b.day?(a.day<b.day?-1:1)*direction:!!a.row.starts_at!==!!b.row.starts_at?a.row.starts_at?-1:1:a.row.starts_at!==b.row.starts_at?(a.row.starts_at<b.row.starts_at?-1:1)*direction:(a.row.id<b.row.id?-1:a.row.id>b.row.id?1:0)*direction);
    const selected=rows.slice(0,spec.limit),last=selected.at(-1);
    pages.push({items:selected.map(({row})=>({...reads.eventRow(row,base,context.branding),...(!row.own_match&&!row.conditional&&!row.identity_conflict?{historical_context:current.historical_context??{anchor_event_id:current.id,team_id:base.team_id,team_season_id:base.team_season_id}}:{})})),total:result[index*2].results[0].total,next_cursor:rows.length>spec.limit?await reads.cursor.issue({selection:spec.selection,revision:before.revision,scope:spec.scope,position:[last.day,last.row.starts_at?'0':'1',last.row.starts_at??'',last.row.id,asOf]}):null});
  }
  const {total,...record}=result[0].results[0];
  return {events:pages[0],upcoming:pages[1],record,range,range_options:HEAD_TO_HEAD_RANGES,range_bounds:specs[0].bounds,as_of:asOf,coverage:'saved_history',history_complete:false,perspective:first,opponent:second,note:'Recorded meetings may not include all historical games.'};
}
