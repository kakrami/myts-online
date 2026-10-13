// Settings and Manage share a short headline. Detailed job counts and coverage
// remain in Update details and Diagnostics, rather than becoming a progress %.
const active=row=>row?.active===true||row?.active===1;
const disconnected=row=>row?.active===false||row?.active===0||row?.authorization_state==='disconnected';
const needsReconnect=row=>['expired','reconnect_required'].includes(row?.authorization_state);
const savedGroup=group=>['partial','complete'].includes(group.coverage)||!!group.last_saved_at;
const rawHeadline=/^\d+ (?:queued|running|retrying|ready|blocked|failed|disabled)\s*·\s*(?:none|partial|complete|unpublished|restricted|unsupported)(?:\s*·\s*\d+ (?:queued|running|retrying|ready|blocked|failed|disabled)\s*·\s*(?:none|partial|complete|unpublished|restricted|unsupported))*$/;

export function sourceSummary(row={}, {connections,connectionsComplete=true}={}) {
  const headline=typeof row?.status_label==='string'?row.status_label.trim():'';
  if(headline&&!rawHeadline.test(headline))return headline;
  const groups=Array.isArray(row?.groups)?row.groups.filter(group=>group&&group.count!==0):[];
  const sources=Array.isArray(connections)?connections.filter(source=>source?.provider===row?.provider):[];
  // Authorization comes only from typed connection/account state, never from a
  // generic failed job, an error message or incomplete provider coverage.
  if(row?.authorization_state)sources.push(row);
  const attached=sources.filter(source=>!disconnected(source));
  const saved=groups.some(savedGroup)||sources.some(source=>source.imported_roster_total>0||source.pending_roster?.total>0||source.roster_review?.total>0);
  const savedLabel=saved?' · Saved data available':'';
  if(connectionsComplete&&attached.length&&attached.every(needsReconnect))return 'Reconnect required'+savedLabel;
  if(connectionsComplete&&sources.length&&sources.every(disconnected))return saved?'Disconnected'+savedLabel:'Not connected';

  const attention=groups.some(group=>['blocked','failed'].includes(group.state));
  const unavailable=groups.some(group=>['restricted','unsupported'].includes(group.coverage));
  const suffix=attention?' · Some data needs attention':unavailable?' · Some data is unavailable':'';
  if(groups.some(group=>group.state==='running'))return 'Updating in background'+suffix;
  if(groups.some(group=>group.state==='retrying'))return 'Retry scheduled'+suffix;
  if(groups.some(group=>group.state==='queued'))return 'Update queued'+suffix;
  if(attention)return 'Some data needs attention';
  if(unavailable)return saved?'Saved data available · Some data is unavailable':'Some data is unavailable';
  // All reported work must be accounted for. A count alone, a partial page or
  // ready jobs with partial/unknown coverage cannot establish completion.
  // Provider work does not establish canonical publication or analyzed games.
  if(Number.isSafeInteger(row?.total)&&row.total>0&&groups.length&&groups.every(group=>group.state==='ready'&&group.coverage==='complete'&&Number.isSafeInteger(group.count)&&group.count>0)&&groups.reduce((total,group)=>total+group.count,0)===row.total)return 'Source update complete';
  if(groups.some(group=>group.coverage==='unpublished'))return saved?'Saved data available · Some data is not published':'Some data is not published';
  if(saved)return 'Saved data available';
  if(groups.length||row?.total>0)return 'Update status unavailable';
  if(sources.some(source=>active(source)&&!needsReconnect(source)))return 'Connected · Waiting for background work';
  return 'No background work recorded';
}
