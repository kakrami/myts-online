/** Original Schedule query policy, shared by the browser and schedule reads.
 * Keep the user's period preference outside this effective query so visiting a
 * historical season does not replace the current season's Upcoming selection.
 * Other lists (reports, H2H, bookmarks) have their own sort contracts.
 */
export function scheduleQuery(input, {seasonEnd = null, today = null, allowDirection = false} = {}) {
  const mode = input.mode || 'season', type = input.type || 'all';
  const period = type === 'analyzed' && mode === 'season' ? 'all'
    : mode === 'season' && seasonEnd && today && seasonEnd <= today ? 'past'
    : input.period || 'all';
  const direction = allowDirection && ['asc', 'desc'].includes(input.direction) ? input.direction
    : mode === 'day' ? 'asc' : type === 'analyzed' || period === 'past' ? 'desc' : 'asc';
  return {...input, mode, type, period, direction};
}
