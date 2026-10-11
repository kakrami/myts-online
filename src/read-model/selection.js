const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(['all', 'games', 'practices', 'analyzed']);
export function invalid(message, code = 'invalid_selection', status = 400) {
  return Object.assign(new Error(message), { code, status });
}
export function calendarDay(value) {
  if (typeof value !== 'string' || !DATE.test(value)) throw invalid('Choose a valid calendar date.');
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw invalid('Choose a valid calendar date.');
  return value;
}
export function timezone(value = 'America/Los_Angeles') {
  try { new Intl.DateTimeFormat('en-US', {timeZone:value}).format(0); }
  catch { throw invalid('Choose a supported team timezone.'); }
  return value;
}
export function localDay(instant, zone) {
  timezone(zone);
  const date = new Date(instant);
  if (!Number.isFinite(date.valueOf())) throw invalid('The event has an invalid time.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function eventDay(event, zone) {
  return event.starts_at ? localDay(event.starts_at, zone) : calendarDay(event.local_day);
}
export function seasonForDay(value) {
  const day = calendarDay(value), year = Number(day.slice(0,4)) - (Number(day.slice(5,7)) < 6 ? 1 : 0);
  return {label:`${year}/${year+1}`, start_date:`${year}-06-01`, end_date:`${year+1}-06-01`};
}
export function addDays(value, count) {
  const date = new Date(calendarDay(value) + 'T12:00:00Z');
  if (!Number.isInteger(count) || Math.abs(count) > 4000) throw invalid('Invalid date step.');
  date.setUTCDate(date.getUTCDate()+count);
  return date.toISOString().slice(0,10);
}
export function calendarRange(value, weekStartsOn = 0) {
  const day = calendarDay(value), first = day.slice(0,7)+'-01';
  const weekday = new Date(first+'T12:00:00Z').getUTCDay();
  if (![0,1].includes(weekStartsOn)) throw invalid('Invalid calendar week start.');
  const from = addDays(first,-((weekday-weekStartsOn+7)%7));
  return {from, to:addDays(from,42)};
}
export function normalizeSelection(input, team, season, now = Date.now()) {
  if (!team || input.team_id !== team.id) throw invalid('The selected team is unavailable.', 'team_scope', 403);
  if (season && (season.app_team_id !== team.id || input.team_season_id !== season.id)) throw invalid('The selected season is unavailable.');
  const zone = timezone(team.timezone), mode = input.mode || 'season', type = input.type || 'all', period = input.period || 'all';
  if (!['day','season'].includes(mode) || !TYPES.has(type) || !['all','past','upcoming'].includes(period)) throw invalid('Invalid schedule filter.');
  const selection = {team_id:team.id, team_season_id:season?.id || null, timezone:zone, mode, type, period,
    date:calendarDay(input.date || localDay(new Date(now).toISOString(),zone)),
    from:season?.start_date || null, to:season?.end_date || null,
    include_june:season?.include_june !== 0 && season?.include_june !== false,
    search:String(input.search || '').trim().slice(0,100), sort:input.sort || 'date', direction:input.direction === 'desc' ? 'desc' : 'asc'};
  if (mode==='season' && !season) throw invalid('Choose a season.');
  if (season) { calendarDay(season.start_date); calendarDay(season.end_date); if (season.start_date>=season.end_date) throw invalid('Invalid season boundaries.'); }
  return selection;
}
export function statisticsEligible(event, selection, inclusion = {}) {
  if (event.type !== 'game' || event.conditional || !['FINAL','COMPLETED'].includes(event.status)) return false;
  const date = eventDay(event,selection.timezone);
  if (date < selection.from || date >= selection.to) return false;
  const explicit = inclusion.events?.[event.id];
  if (explicit === false || explicit === true) return explicit;
  const category = inclusion.categories?.[event.division_id], competition = inclusion.competitions?.[event.competition_id];
  if (category === false || category === true) return category;
  if (competition === false || competition === true) return competition;
  return selection.include_june || date.slice(5,7)!=='06';
}
export function eventPeriod(event, now, zone) {
  if (['FINAL','COMPLETED','CANCELLED'].includes(event.status)) return 'past';
  if (event.starts_at) return Date.parse(event.starts_at) < now ? 'past' : 'upcoming';
  return calendarDay(event.local_day) < localDay(new Date(now).toISOString(),zone) ? 'past' : 'upcoming';
}
export function stableSelectionKey(selection) {
  return JSON.stringify(Object.fromEntries(Object.keys(selection).sort().map(k=>[k,selection[k]])));
}
