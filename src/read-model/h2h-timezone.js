import {calendarDay,invalid,localDay} from './selection.js';
const DAY=86400000,HOUR=3600000,iso=at=>new Date(at).toISOString();
const fail=()=>{throw invalid('This historical timezone transition could not be ordered safely. Try a narrower history range.','history_timezone_complex',409);};
/** Bounded IANA offset adapter. The supported tzdb transition model has constant
 * offsets between transitions, separated by at least an hour. We inspect only
 * six-day boundary windows, never the number of historical games. */
export function headToHeadTimezone(zone) {
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),windows=new Map(),comparisons=new Map();
 function offset(at){const p=Object.fromEntries(formatter.formatToParts(new Date(at)).map(part=>[part.type,part.value])),date=new Date(0);date.setUTCFullYear(Number(p.year),Number(p.month)-1,Number(p.day));date.setUTCHours(Number(p.hour),Number(p.minute),Number(p.second),0);const value=date.getTime()-Math.floor(at/1000)*1000;if(!Number.isFinite(value)||Math.abs(value)>DAY)fail();return value;}
 function window(at){const center=Math.floor(at/DAY)*DAY;if(windows.has(center))return windows.get(center);const start=center-3*DAY,end=center+3*DAY,segments=[];let beginning=start,last=offset(start),changes=0;
  for(let right=start+HOUR;right<=end;right+=HOUR){const value=offset(right);if(value===last)continue;if(++changes>4)fail();let lo=right-HOUR,hi=right;while(hi-lo>1){const middle=Math.floor((lo+hi)/2);if(offset(middle)===last)lo=middle;else hi=middle;}segments.push({from:beginning,to:hi,offset:last});beginning=hi;last=value;}
  segments.push({from:beginning,to:end,offset:last});const result={start,end,segments};windows.set(center,result);return result;
 }
 function intervals(day,operator){calendarDay(day);const key=day+operator;if(comparisons.has(key))return comparisons.get(key);const target=Date.parse(day+'T00:00:00Z'),w=window(target),parts=[];
  if(operator==='<')parts.push({from:null,to:w.start});else if(operator==='>=')parts.push({from:w.end,to:null});else throw Error('Invalid calendar comparison.');
  for(const segment of w.segments){const boundary=target-segment.offset,from=operator==='<'?segment.from:Math.max(segment.from,boundary),to=operator==='<'?Math.min(segment.to,boundary):segment.to;if(from<to)parts.push({from,to});}
  parts.sort((a,b)=>(a.from??-Infinity)-(b.from??-Infinity));const merged=[];for(const part of parts){const previous=merged.at(-1);if(previous&&previous.to===part.from)previous.to=part.to;else merged.push({...part});}if(merged.length>6)fail();comparisons.set(key,merged);return merged;
 }
 function compare(day,operator,column='e.starts_at'){const parts=intervals(day,operator),params=[];return {sql:'('+parts.map(part=>{const where=[];if(part.from!==null){where.push(column+'>=?');params.push(iso(part.from));}if(part.to!==null){where.push(column+'<?');params.push(iso(part.to));}return where.join(' AND ')||'1';}).join(' OR ')+')',params};}
 function repairs(instants){const result=new Map();for(const value of instants.filter(Boolean)){const w=window(Date.parse(value));for(let i=0;i<w.segments.length-1;i++){const before=w.segments[i],after=w.segments[i+1],transition=before.to;if(after.offset>=before.offset)continue;const firstDay=localDay(iso(transition),zone),lastDay=localDay(iso(transition-1),zone);if(firstDay>=lastDay)continue;
    for(let dayAt=Date.parse(firstDay+'T00:00:00Z')+DAY;dayAt<=Date.parse(lastDay+'T00:00:00Z');dayAt+=DAY){const day=iso(dayAt).slice(0,10),from=Math.max(before.from,dayAt-before.offset),to=Math.min(transition,dayAt+DAY-before.offset);if(from>=to)continue;const stable=intervals(day,'>=').at(-1)?.from;if(!Number.isFinite(stable)||stable<to||stable-transition>2*DAY)fail();result.set(from+':'+to,{from:iso(from),to:iso(to),bucket:iso(stable)});}
   }}if(result.size>8)fail();return [...result.values()];}
 return {compare,repairs,order(repairs,column='e.starts_at'){const params=[];return {sql:repairs.length?'CASE '+repairs.map(repair=>{params.push(repair.from,repair.to,repair.bucket);return `WHEN ${column}>=? AND ${column}<? THEN ?`;}).join(' ')+` ELSE ${column} END`:column,params};}};
}
