# Analysis detail reads

All detail reads require the selected canonical team and season. Owners may select an active team; viewers are restricted to their shared team. Coach records are never queried. Returned records expose canonical event/player IDs and a whitelist of scalar statistics, not provider accounts, native keys, tracking identities, or raw evidence.

## Player detail

`GET /api/players/:player_id` returns the shared complete-selection season statistics plus `matches`, `attendance`, and `spatial`. Completed games obey the same inclusion and identity-conflict rules as roster statistics. Totals are computed before pagination.

`matches` is a page `{items,total,next_cursor}`. Each row contains canonical `id`, `event_id`, `opponent_name`, kickoff/day, appearance, `started`, minutes, goals, assists, and `ga`. Unknown goals or assists keep `ga` null; unresolved native goal totals do not become confirmed production. Statistics retain their availability/state fields.

`attendance` has this model:

```js
{
  totals: {yes, no, maybe, no_response, unknown, conflicts,
           selected_events, responses, percentage},
  events: {items, total, next_cursor}
}
```

Attendance event rows contain canonical `id`/`event_id`, `title`, `opponent_name`, `starts_at`, `local_day`, `response`, `response_label`, and `coverage_state`. Response tokens are `yes`, `no`, `maybe`, `no_response`, `unknown`, or `conflict`. A saved native NR is “No response”; a missing or unsupported observation is “Unavailable.” Contradictory authorized observations stay “Conflicting responses.” Identical duplicate observations collapse to one response. Private observations from unattached teams/accounts are excluded.

Continuation uses `?tab=matches|attendance&limit=1..100&cursor=...`. Each list has a distinct signed cursor bound to team, season, player, statistical selection, and content revision. Attendance percentage is available only when every selected event has a supported, conflict-free response within complete captured attendance coverage.

## Native Trace comparison

`GET /api/analysis/matches/:event_id/native` retains its existing map options: `team=own|opponent`, `period=full|1|2`, `kind`, `limit=1..100`, and signed `cursor`. Native periods are validated separately from schedule periods (`all|past|upcoming`); canonical authorization uses the full schedule context while the native period remains in the source query and signed cursor. Map points remain bounded and use the fixed provider coordinate scale. Team comparisons always retain own/opponent ordering, even when the displayed map is for the opponent.

The team carrier returns `comparison` with four rows: Possession %, Completed passes, Shots, and Box touches. Each row contains `key`, `label`, nullable `own`/`opponent`, per-side state/provenance, and nullable `share_pct`. `comparison_state` separately describes own/opponent captured coverage.

Possession uses only the provider’s finite `total_possession` fraction in `[0,1]`, rounded to percent independently for each side. It does not reinterpret a possession timeline or infer a complementary opponent percentage. Other comparison metrics count the complete captured typed native item collection, not the current map page, thirds totals, or a shots-made field. Counts require an explicitly present native group, a unique ready provider summary, and complete analytics coverage. Missing groups/periods, restricted or incomplete scopes, identity ambiguity, and imported evidence remain explicit states with null comparison values. A complete empty native group can show zero. Relative bars require both values; known zero/zero uses a neutral bar.

Both sides must belong to the same exact authorized native event, private account, attached own native team, and requested period. No other team, account, player track, or full-match fallback supplies a missing value. Native summaries returned to either team or player screens whitelist queried scalar/group fields and omit raw possession timelines and unexpected evidence fields.

Native regression coverage: `tests/analysis-detail-reads.test.js` verifies 130 completed canonical games, aliases, attendance conflicts/missing observations, tab-specific signed continuation, native pagination with 130 own points, same-account unrelated team and foreign-account exclusion, known zero, unsupported fields, and restricted/incomplete halves. Its HTTP regression initializes the complete fresh application and exercises `full|1|2` native periods for team and player scopes, including signed cursor rejection across periods. It supports the extracted-package harness root. `tests/analysis-contract.test.js` continues to verify the shared projection, correction, lineup, track-assignment, and privacy workflows. Actual authenticated private-provider retrieval remains a separate production verification requirement.
