// Diagnostic metadata is deliberately separate from source evidence. Only the
// existing internal throw site selects a reason; provider values never become
// a stored message, identifier or URL. This module changes no admission guard.
const REASONS = new Map([
  ['Source contains missing or duplicate native identities.', 'attendance_identity'],
  ['TeamSnap continuation changed its source scope.', 'attendance_next_scope'],
  ['TeamSnap returned a record for another team.', 'attendance_team_scope'],
  ['Unsupported TeamSnap link.', 'attendance_link_scope'],
  ['TeamSnap link exceeds its bound.', 'attendance_link_bound'],
  ['Invalid TeamSnap page offset.', 'attendance_offset'],
]);
const COUNT_KEYS = Object.freeze({
  attendance_identity: ['items','invalid_ids','duplicate_ids','valid_pairs','duplicate_pairs'],
  attendance_next_scope: ['next_count','same_origin','same_path','same_query','next_number','unique_query','safe_url'],
  attendance_team_scope: ['items','foreign_teams'],
  attendance_link_scope: [], attendance_link_bound: [], attendance_offset: ['items'],
});
const native = value => {try {const text=String(value??'');return /^[1-9]\d{0,14}$/.test(text)?text:'';} catch {return '';}};
const fields = item => {
  const data=item?.data;if(!Array.isArray(data))return {};
  if(data.length>128)throw new Error('Diagnostic field shape exceeds its bound.');
  const result={};for(const field of data)if(field&&['id','event_id','member_id','team_id'].includes(field.name))result[field.name]=field.value;return result;
};
const identity = value => {const u=new URL(value);u.searchParams.delete('page_number');u.searchParams.sort();return u.href;};

export function annotateTeamSnapAttendance(error, context) {
  try {return annotate(error,context);} catch {return error;}
}
function annotate(error, {kind,raw,state,teamId}) {
  if(kind!=='attendance'||error?.code!=='contract_violation')return error;
  const reason=REASONS.get(error.message);if(!reason)return error;
  const counts={};
  // Unexpected larger structures get the static reason only. Diagnostics do
  // not allocate an unbounded copy or turn malformed input into an accepted page.
  const items=raw?.collection?.items;
  if(Array.isArray(items)&&items.length<=500) {
    counts.items=items.length;
    if(reason==='attendance_identity') {
      const rows=items.map(fields),ids=rows.map(r=>native(r.id)),valid=ids.filter(Boolean);
      const pairs=rows.filter(r=>native(r.event_id)&&native(r.member_id)).map(r=>native(r.event_id)+':'+native(r.member_id));
      counts.invalid_ids=ids.length-valid.length;counts.duplicate_ids=valid.length-new Set(valid).size;
      counts.valid_pairs=pairs.length;counts.duplicate_pairs=pairs.length-new Set(pairs).size;
    } else if(reason==='attendance_team_scope') counts.foreign_teams=items.map(fields).filter(r=>r.team_id!=null&&native(r.team_id)!==teamId).length;
  }
  if(reason==='attendance_next_scope') {
    const links=raw?.collection?.links;
    if(Array.isArray(links)&&links.length<=500) {
      const next=links.filter(link=>link?.rel==='next');counts.next_count=next.length;
      if(next.length===1)try {
        const u=new URL(next[0].href,state.url),base=new URL(state.base),keys=[...u.searchParams.keys()];
        counts.same_origin=+(u.origin===base.origin);counts.same_path=+(u.pathname===base.pathname);
        counts.same_query=+(identity(u)===identity(base));counts.next_number=+(u.searchParams.get('page_number')===String(state.pages+2));
        counts.unique_query=+(new Set(keys).size===keys.length);counts.safe_url=+(!u.username&&!u.password&&!u.hash);
      } catch { /* The original failure remains authoritative. */ }
    }
  }
  error.teamsnapDiagnostic={reason,counts:Object.fromEntries(COUNT_KEYS[reason].filter(key=>Object.hasOwn(counts,key)).map(key=>[key,counts[key]]))};return error;
}

// A second allowlist at the persistence boundary refuses arbitrary properties,
// text, non-integers and oversized numbers even if a caller forges this object.
export function teamSnapDiagnosticSuffix(error) {
  try {return suffix(error);} catch {return '';}
}
function suffix(error) {
  if(error?.code!=='contract_violation')return '';
  const diagnostic=error.teamsnapDiagnostic;
  if(!diagnostic||typeof diagnostic.reason!=='string'||!Object.hasOwn(COUNT_KEYS,diagnostic.reason))return '';
  const keys=COUNT_KEYS[diagnostic.reason];
  const counts=diagnostic.counts;
  if(!counts||typeof counts!=='object'||Array.isArray(counts)||Object.keys(counts).some(key=>!keys.includes(key)))return '';
  const values=[];
  for(const key of keys)if(Object.hasOwn(counts,key)) {
    const value=counts[key];if(!Number.isSafeInteger(value)||value<0||value>500)return '';
    if(['same_origin','same_path','same_query','next_number','unique_query','safe_url'].includes(key)&&value>1)return '';
    values.push(key+'='+value);
  }
  const suffix=' Diagnostic: '+diagnostic.reason+(values.length?'; '+values.join('; '):'')+'.';
  return suffix.length<=400?suffix:'';
}
