/** Resolve native membership evidence without confusing a GotSport bracket
 * with its schedule group. Older saved rows retain bracket keys; only one
 * matching group in the exact public competition may supply their period. */
export function membershipPeriodJoins(m='m',d='d',c='c') {
  const nativeDivision=`CASE WHEN ${m}.source_division_id LIKE 'gotsport/public/bracket%3A%' THEN (
    SELECT CASE WHEN COUNT(*)=1 THEN MIN(candidate.id) END FROM source_divisions candidate
    WHERE candidate.provider='gotsport'
      AND candidate.competition_id='gotsport/public/'||json_extract(${m}.evidence,'$.event_id')
      AND (json_extract(${m}.evidence,'$.schedule_id') IS NULL OR candidate.id='gotsport/public/'||json_extract(${m}.evidence,'$.schedule_id'))
      AND EXISTS(SELECT 1 FROM json_each(candidate.evidence,'$.brackets') bracket
        WHERE 'gotsport/public/bracket%3A'||json_extract(bracket.value,'$.id')=${m}.source_division_id)
  ) ELSE ${m}.source_division_id END`;
  return `JOIN source_divisions ${d} ON ${d}.id=${nativeDivision}
    JOIN source_competitions ${c} ON ${c}.id=${d}.competition_id
      AND EXISTS(SELECT 1 FROM source_teams member_source WHERE member_source.id=${m}.source_team_id
        AND member_source.provider=${d}.provider AND member_source.provider=${c}.provider
        AND member_source.account_id IS ${c}.account_id)
      AND (${c}.provider<>'gotsport' OR (${c}.account_id IS NULL
        AND ${c}.id='gotsport/public/'||json_extract(${m}.evidence,'$.event_id')
        AND (json_extract(${m}.evidence,'$.schedule_id') IS NULL OR ${d}.id='gotsport/public/'||json_extract(${m}.evidence,'$.schedule_id'))))`;
}
