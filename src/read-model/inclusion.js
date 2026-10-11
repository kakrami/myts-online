/** Shared statistical selection. Calendar presence is deliberately independent. */
const kinds=['event','division','competition','category'];
export function canonicalRuleKeySQL(kind,key) {
  if(!kinds.includes(kind))throw new Error('Invalid inclusion kind.');
  if(kind==='category')return key;
  return `COALESCE((SELECT canonical_id FROM canonical_${kind}_ids WHERE input_id=${key}),${kind==='event'?'':`(SELECT a.canonical_id FROM ${kind}_source_links l JOIN canonical_${kind}_ids a ON a.input_id=l.${kind}_id WHERE l.source_${kind}_id=${key}),`}${key})`;
}
export function inclusionResourceSQL(kind,alias='e') {
  if(!/^[a-z][a-z0-9_]*$/i.test(alias)||!kinds.includes(kind))throw new Error('Invalid SQL alias or inclusion kind.');
  if(kind==='category')return `CASE COALESCE((SELECT kind FROM canonical_competitions WHERE id=${inclusionResourceSQL('competition',alias)}),'other') WHEN 'league' THEN 'league' WHEN 'tournament' THEN 'tournament' ELSE 'other' END`;
  const key=kind==='event'?`${alias}.event_id`:`COALESCE(${alias}.${kind}_id,(SELECT ${kind}_key FROM source_events WHERE id=${alias}.result_source_id),(SELECT ${kind}_key FROM source_events WHERE id=${alias}.schedule_source_id))`;
  return canonicalRuleKeySQL(kind,key);
}
export function inclusionRuleSQL(kind,alias='e') {
  return `(SELECT CASE WHEN COUNT(*)=0 THEN NULL WHEN MIN(r.included)=MAX(r.included) THEN MIN(r.included) ELSE 0 END FROM season_inclusion_rules r WHERE r.team_season_id=${alias}.team_season_id AND r.kind='${kind}' AND ${canonicalRuleKeySQL(kind,'r.resource_key')}=${inclusionResourceSQL(kind,alias)})`;
}
export function inclusionConflictSQL(kind,alias='e') {
  return `(SELECT COALESCE(MIN(r.included)<>MAX(r.included),0) FROM season_inclusion_rules r WHERE r.team_season_id=${alias}.team_season_id AND r.kind='${kind}' AND ${canonicalRuleKeySQL(kind,'r.resource_key')}=${inclusionResourceSQL(kind,alias)})`;
}
export function inclusionSQL(alias='e') {
  return `COALESCE(${inclusionRuleSQL('event',alias)},${inclusionRuleSQL('division',alias)},${inclusionRuleSQL('competition',alias)},${inclusionRuleSQL('category',alias)},1)=1`;
}
export function statisticalSelectionSQL(selection,alias='e') {
  const day=`COALESCE(${alias}.local_day,substr(${alias}.starts_at,1,10),'9999-12-31')`;
  return `${alias}.type='game' AND ${alias}.conditional=0 AND ${alias}.identity_conflict=0 AND ${inclusionSQL(alias)}${selection.include_june?'':` AND substr(${day},6,2)<>'06'`}`;
}
