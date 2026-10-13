# Original analysis characterization and shared projection design

Status: characterization/design only. This branch does not change the target analysis projector, reads, D1 schema, provider retrieval or deployment. It is one part of the complete 31-gate parity scope.

## Provenance and reproduction

Original: kakrami/myts-online commit `50e1be224806ff7e7c439d26e15fd0421e3f6f01`, tree `30b40dd7ff3026c054d3794234b87fc300256445`, worker.js Git blob `bd2d055483abae37ddae2680ec62f6282da6680c`. Rebuild base: `6326162d923aae5c2f2bfe109dfad6dc3b28d687` (7.1.4).

The fixture embeds the exact original TraceEngine IIFE, physical worker lines 194–770. APP_HTML is the JSON string in physical line 1; decoded frontend slices are recorded in the fixture's provenance. The UI harness substitutes only player/correction/identity global lookups. Spatial, position, formation and layout algorithms are untouched. All fixture records are synthetic; no account data or credentials are included.

Run `node --test tests/parity/original-analysis.test.mjs`. The existing tests/*.test.mjs glob does not recurse into this directory, so include `tests/parity/*.test.mjs` explicitly in QA.

These are original-implementation characterization tests. They do not establish target-analysis, browser, native Worker, real-provider or production acceptance. The old source oracle belongs only to QA; it must never be imported into the application or required-only release.

## Recovered behavior

A 50-minute 7v7 game has 350 player-minutes of capacity; 9v9 has 450. Field and goalkeeper intervals remain distinct and can switch at halftime without double-counting. Half-local intervals are clipped and merged. Concurrent capacity and overlapping-role violations are checked. Absolute FullGameVideo timestamps take precedence over legacy reported clocks; missing clock remains null. Unknown participation differs from confirmed DNP zero. Dummy/opponent streams do not create named player capacity.

The original produces useful best-effort capacity estimates from sparse evidence and labels unsupported portions as estimated. Explicit field-half decisions change effective support without rewriting direct tracking minutes. Preserve the distinction among source, supported inference, provisional estimates and manual corrections.

Usable heatmaps require supported own-goal orientation and a validated native grid or adequate samples. Broad DEF/MID/FWD evidence can exist without verified tactical lane orientation; named LB/CM/RW inference needs the additional orientation. Manual match position wins and works without a heatmap. Positive 7v7/9v9 layouts retain evidenced starters in distinct slots. The original goalkeeper display threshold is at least five minutes and sixty percent of total minutes.

The source also contains aggressive best-effort rules: `inferGoalkeeperAssignments` may choose `auto_primary_keeper` (worker 479–508), and `calculateGame` fills available field slots among eligible candidates (559–580). Characterize the ambiguous and short-handed cases before translating these rules into the shared target component. Preserve useful estimates with their evidence and bounds; do not let spatial inference establish a person's identity or turn unknown participation into a confirmed appearance.

Original match `positionEvidence` uses match correction then heatmap (decoded 2163–2166); separate `assignedPosition` supports season fallback (722). The agreed shared interpretation therefore needs explicit target tests for match/half correction, usable inference, season default and reset. This oracle does not pretend every old caller already implements that complete precedence.

Original `traceEngineNominalHalfMinutes` (physical 782) snaps video duration to five-minute steps for event-display clocks. `calculateGame` uses actual half windows. Do not repurpose display snapping as authoritative participation time.

The engine's June `preseason:YYYY` statistical key differs from the frontend's June–May calendar container. Calendar materialization must continue to use the logical team's calendar definition, while statistical June exclusion and saved inclusion remain separate.

## Target component and adapters

After the frozen lifecycle interfaces arrive, implement a pure `resolveMatchAnalysis(input)` with no database, transport, DOM, credentials, clock or mutable global state.

Inputs:

- Context: canonical team/season/event identities, timezone, input revision, algorithm version, evidenced format (7 or 9), half-local windows and duration/clock provenance.
- People: canonical identity, dated own-team eligibility, proved source-player/track mapping and explicit unavailable states. No current-roster backfill into history.
- Observations: source/account/generation identity, own/opponent side, dummy status, half, bounded intervals/event anchors, native statistics, spatial grid/orientation, availability and revision.
- Corrections: typed match/half decisions and season defaults, presence/reset distinction, field/GK roles, minutes, starts and position/slot. Preserve explicit zero; never convert unavailable null to zero.

Output one immutable interpretation: effective player facts and totals, per-half roles/intervals, supported/estimated/unknown quantities, formation/slots, provenance, coverage, constraints, input revision and algorithm version. Unknown format/window/identity remains explicit. Capacity bounds estimates; it is not proof that absent participants played.

The target projector adapts typed records into this component and publishes through its existing lifecycle/account/input fence. Analysis reads, match/player pages, Overview, roster, reports and Coach consume that published interpretation. The browser formats values; it does not maintain another inference engine. Do not alter stored facts or D1 query shapes before checking the author's frozen schema and effective-source contracts.

## Required target cases and receipts

Translate the thirteen oracle cases into target tests, then add ambiguous keeper, short-handed capacity, distinct half role changes, missing licensed components, date-only/rescheduled boundaries, historical roster/jersey, manual zero/blank/reset/season fallback, stale-generation publication, unchanged-source recovery and shared-job reuse. Compare complete selected-season roster/Overview/report totals independently.

Verify ordinary correction and lineup gestures, real provider observations and refresh, physical phone behavior, and server advancement while every browser is closed. Record all 31 gates separately. This isolated branch does not close them.
