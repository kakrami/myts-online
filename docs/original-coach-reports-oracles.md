# Original Coach and Reports oracle contract (gates 21/23)

Baseline: myTS **6.20.133**, commit [50e1be224806ff7e7c439d26e15fd0421e3f6f01](https://github.com/kakrami/myts-online/commit/50e1be224806ff7e7c439d26e15fd0421e3f6f01), worker blob `bd2d055483abae37ddae2680ec62f6282da6680c`, README blob `89fa0a347e2d0202b1eed1a0de814037eca11129`. The fixtures embed verified original function text; all people, events, profiles, timestamps and database/DOM/export-library doubles are synthetic. These tests exercise the original functions, not the rebuild.

Native oracle rerun:

```sh
node --test tests/parity/original-coach-oracles.test.mjs tests/parity/original-reports-oracles.test.mjs
```

## Coach bridge

Fixture API: import createOriginalCoachOracle, coachState and originalProfilesFixture from original-coach-fixtures.mjs. createOriginalCoachOracle({nowMs, players, history, includedGames}) returns the original functions plus setNow(epochMs); players is keyed by player ID with explicit assigned_position/resolved_position, history is keyed by player ID with ordered {game_id, minutes} rows, and includedGames is null or an ID whitelist. coachApply(session, action, epochMs) mutates/returns the session. Clone and persist atomically: a rejected original assign can mutate temporary state before its capacity error.

Supply explicit string player IDs, an ordered roster, active IDs, numeric slot-to-ID field map, format 7/9, half_minutes, phase, period, elapsed_ms, period_elapsed_ms, running_since, minutes_ms and history. Supply a fixed epoch-millisecond now/stamp. IDs in the bridge must already resolve to one dated canonical player; it must not infer identities or source authority. Compare action outcomes, errors, field, timestamps, per-player minutes and timeline. Original Coach field indices are 0–22 from lineupDropTargets, distinct from resolver one-based format slots; map by declared geometry/position rather than sharing numeric indices. Profile lookup uses team scope, season and the same player identity.

| Original rule | Required adapter comparison |
| --- | --- |
| Pregame reconfiguration | configure only while planning; format 7/9 and integer 5–90 minutes per half; reject reducing below occupied field count; keep assignments and accumulated plan history. Availability and field assignment remain separate. |
| Attributes | At most three supported positions rated integer 1–5; optional endurance 1–5 and target_minutes 0–180. Null clears optional values; an explicit current-season profile replaces the inherited profile, including intentional blank attributes. |
| Clock and substitution | Read clock/minutes from timestamps without writes; account running time before pause, halftime, substitution or finish. Paused time adds nothing. Second-half start resets period clock, keeps total and player time, and requires a full field. No automatic halftime/finish at configured duration. Initial UI default is 25-minute halves; only Attendance No is initially excluded. |
| Corrections | Late substitution in paused/halftime/finished transfers a valid positive amount from current outgoing to available bench player and changes the field. Clock correction changes both clocks and current field minutes; individual minute correction is separately recorded. Preserve original bounds and timeline. |
| Suggestions | Suggested starters use the original 7/9 preferred slots and greedy stable roster order. Live suggestions exist only running/paused, use explicit position/group, target/time/endurance inputs, retain reason text, and return top three; applying one remains an explicit action. |

Actions are configure{format,half_minutes}, availability{player,available}, assign{player,slot,swap_slot?}, bench{player}, start/pause/resume/halftime/next_half/finish, sub{out,in}, correct_sub{out,in,delta}, move{from,to}, adjust_minutes{player,delta}, adjust_clock{delta}. delta is integer milliseconds (late sub positive <=3600000, minute correction +/-3600000, clock correction +/-900000, plus nonnegative/accounted-time checks). History entries preserve type/at/period/elapsed_ms/player/out/in/slot/delta. The UI exposes halftime availability, while the backend permits availability only in planning; that inconsistency needs explicit rebuild treatment.

For suggestions, provide canonical-player role/position decisions and chronologically ordered selected-season Trace minute rows through the documented fixture dependencies. Original history takes the last five positive included rows; the recent average appears in the explanation, **not** the recommendation score. The default target divides full roster size, not available-player count.

Original coachProfiles queries **only previous and current season**, with the current row overriding the previous whole profile. README says ratings carry forward until edited. The source oracle pins that actual query; skipped-season carry-forward needs a separate rebuild acceptance case against the README promise, rather than copying the query limitation. coachAccount caps a single accounted gap at 12 hours; the display clock is uncapped. Do not treat that historical edge as proof of long-lock correctness.

## Reports bridge

Fixture API: createOriginalReportsOracle(input, dom), createReportDom(rows, {id,summary,sortValues}) and reportFixtureInput() from original-reports-fixtures.mjs. input accepts now (ISO), seasonYear, teamId, timeZone, reportType, players, rowsByMember, items, events, availability[{event_id,member_id,status_code}], availabilityEventIds, excludedItemIds/excludedEventIds/excludedTraceIds, traceGames/traceRows, corrections, positions, profiles and savedSort. Capture receipts.excel/pdf/toasts; after renderReportDetail, invoke actual sort header/mobile callbacks and export buttons supplied by createReportDom.

Supply complete, reconciled selected-team/season data: merged scheduled events in display order; player rows with corrected season statistics and attendance counts; included-game record, analyzed games, Trace identity groups and leaders. Apply canonical identity, cancellation, timezone, season and included-game decisions upstream. Schedule covers all season events. Season Summary and Players game statistics use the included-game scope. Attendance and the Players attendance column count completed tracked games **and practices** under selected-season event inclusion rules; their denominator is not game-only. The fixture's game-plus-practice total of two pins this parity requirement. Any existing rebuilt game-only attendance contract needs reconciliation in its reserved adapter. No page-sized adapter input is acceptable.

| Type key / label | Original ordered columns |
| --- | --- |
| season / Season Summary | Metric, Value; rows Record, Goals, Matches analyzed, Trace players, Minutes leader, G+A leader |
| matches / Schedule | Date, Type, Status, Opponent, Location, Source, Competition, Score, Result, Attendance |
| players / Players | Player, Jersey, Position, Apps, Starts, Minutes, Goals, Assists, G+A, G+A/60, Attendance |
| availability / Attendance | Player, Yes, No, Maybe, No Response, Total, Yes % |

Preserve one-decimal player minutes, two-decimal G+A/60 when minutes are nonzero, and blank attendance percentages when total is zero. Cancellation blanks score/result/attendance; possible duplicates retain their explicit status. Attendance excludes cancelled/future/untracked events, retains Yes/No/Maybe/NR, and includes completed practices where selected. Original statsForRows derives Apps from positive minutes and folds missing production quantities to zero; that helper is historical characterization, not authority to undo the rebuilt resolver’s confirmed-appearance/unknown-quantity contract. Compare known synthetic quantities here and preserve rebuild unknowns upstream.

Sorting executes the original table sorter: numeric/percentage/date/natural text, empty values last in either direction, stable ties, saved column/direction. Its permissive Date.parse can classify digit-bearing names as dates; fixtures label this legacy limitation and use unambiguous names for ordering assertions. Schedule initially follows merged-event order; Players/Attendance initially follow roster order. Export callbacks resolve the **current DOM row-index order** after sorting. Excel receives those objects unchanged, sheet Report; PDF receives matching ordered keys/values, landscape above six columns and portrait otherwise. Names use the lowercased underscore report label and season slash replaced with a hyphen.

## Frozen-candidate receipts still required

Run these oracles and then compare the rebuild through its reserved adapters. Gate 21 still requires original match/player placement, availability, drag/tap, real persistence and reload, stale revision rejection, owner/viewer privacy, no writes per clock tick, actual phone lock/reopen and 9v9/50-minute accounting (450 player minutes before deliberate corrections). Gate 23 still requires the complete selected-season dataset beyond 100 events, included-game changes, visible sorting, actual Excel/PDF files opened with matching content/order and permitted sharing scope. These source fixtures establish neither mobile behavior nor real-provider/background processing. Both gates remain part of the full 31-gate release acceptance.
