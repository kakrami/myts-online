import {calendarDay,localDay} from '../read-model/selection.js';

const authority={gotsport:0,live:1,teamsnap:2,trace:3};
export function seasonYearForDay(day){
  const valid=calendarDay(day);return Number(valid.slice(0,4))-(Number(valid.slice(5,7))<6?1:0);
}
export function observedDay(record,timezone){
  try{return record.starts_at?localDay(record.starts_at,timezone):record.local_day?calendarDay(record.local_day):null;}catch{return null;}
}

/** Only actual date fields qualify. Display labels, archive flags, collection
 * timestamps and today's year do not establish historical membership. */
export function datedPeriodYears(start,end=start){
  try{
    start=calendarDay(start);end=calendarDay(end||start);
    if(end<start)return [];
    const first=seasonYearForDay(start),last=seasonYearForDay(end);
    if(first<2000||last>2100||last-first>100)return [];
    return Array.from({length:last-first+1},(_,index)=>first+index);
  }catch{return [];}
}

export function qualifiedRosterPeriod(member={},team={}){
  const explicit=datedPeriodYears(member.roster_start_date,member.roster_end_date);
  const native=datedPeriodYears(team.season_start_date,team.season_end_date);
  if(explicit.length)return {years:explicit,start:member.roster_start_date,end:member.roster_end_date||member.roster_start_date};
  if(native.length===1)return {years:native,start:team.season_start_date,end:team.season_end_date||team.season_start_date};
  return {years:[],start:null,end:null};
}

/** One effective calendar choice, shared by reconciliation and projections.
 * A contradiction never separates an accepted date from its accepted season.
 * Source correspondence itself is established elsewhere, never by this helper. */
export function resolveEventDate({timezone,sources=[],fields={},previous=null,verifiedYears=[]}){
  sources=[...sources].sort((a,b)=>(authority[a.provider]??9)-(authority[b.provider]??9)||a.id.localeCompare(b.id));
  const dated=sources.map(source=>({id:source.id,provider:source.provider,day:observedDay(source,timezone),starts_at:source.starts_at??null,local_day:source.local_day??null}));
  const evidence=dated.map(({id,provider,day})=>({source_id:id,provider,day}));
  const ownerDate=Object.hasOwn(fields,'starts_at')||Object.hasOwn(fields,'local_day');
  if(ownerDate){
    const base=sources[0]??{};
    // A date-only owner correction must not be overridden by an old timestamp.
    const starts_at=Object.hasOwn(fields,'starts_at')?fields.starts_at:(Object.hasOwn(fields,'local_day')?null:base.starts_at??null);
    const local_day=Object.hasOwn(fields,'local_day')?fields.local_day:base.local_day??null;
    const day=observedDay({starts_at,local_day},timezone);
    return {state:day?'resolved':'pending',day,year:day?seasonYearForDay(day):null,starts_at,local_day,basis:'owner',evidence};
  }
  const days=dated.filter(item=>item.day),years=new Set(days.map(item=>seasonYearForDay(item.day)));
  if(years.size>1){
    return {state:'conflict',day:previous?.effective_day??null,year:previous?.year??null,starts_at:previous?.starts_at??null,local_day:previous?.local_day??null,basis:previous?.team_season_id?'accepted_conflict':'source_date_conflict',evidence};
  }
  if(days.length){
    const chosen=days[0];
    return {state:'resolved',day:chosen.day,year:seasonYearForDay(chosen.day),starts_at:chosen.starts_at,local_day:chosen.local_day,basis:'event',evidence};
  }
  const periodYears=[...new Set(verifiedYears)].filter(year=>Number.isInteger(year)&&year>=2000&&year<=2100);
  if(periodYears.length>1)return {state:'conflict',day:previous?.effective_day??null,year:previous?.year??null,starts_at:previous?.starts_at??null,local_day:previous?.local_day??null,basis:previous?.team_season_id?'accepted_conflict':'season_evidence_conflict',evidence:[...evidence,{season_years:periodYears}]};
  if(periodYears.length===1)return {state:'resolved',day:null,year:periodYears[0],starts_at:null,local_day:null,basis:'dated_metadata',evidence};
  return {state:'pending',day:null,year:null,starts_at:null,local_day:null,basis:'date_unknown',evidence};
}
