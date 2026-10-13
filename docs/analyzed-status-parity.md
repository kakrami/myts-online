# Accepted analyzed games and unknown results

## Verified original behavior

The reference is myTS 6.20.133, commit `50e1be224806ff7e7c439d26e15fd0421e3f6f01`, worker blob `bd2d055483abae37ddae2680ec62f6282da6680c`.

- UI lines 660,674–685,729–731: Trace rows use the selected season, cancellation, and Included Games/June rules. They do not require FINAL/COMPLETED or a past date. Apps count positive known minutes; starts count explicit true; minutes sum positive known values.
- UI lines 1329,1384–1387,2180 and 2723–2737: Team, player season stats, performance leaders and analyzed-game links consume those rows/games. A retained confirmed row under UNKNOWN, POSTPONED or a future SCHEDULED date is still usable. Cancellation/exclusion suppresses it.
- Backend lines 1215 and 1231–1234: `state.trace.games` is built from the active generation's published `trace_match_payloads`, not discovery `trace_games`. `statsCatalogMatch` at 1029 has no quality, score or player-count threshold. Frontend Reports uses `traceSeasonGames().length`.
- Backend lines 4373–4374,4860–4861,4947,5010–5031: normal automatic publication follows rich-source collection and accepted processing. A header by itself is insufficient. Best-effort/partial evidence can still publish. The engine permits zero-player accepted payloads; import validation also permits them. Failed refresh can leave prior accepted payloads retained.
- Original `coachHistoryMinutes` uses included saved rows with positive known minutes and takes the most recent five. It has no completed-result predicate.

Exact copied frontend selectors are in `tests/parity/original-analyzed-eligibility-fixtures.mjs`; report reducers remain the existing pinned original Reports oracle.

## Reproduced regression

One already-published past UNKNOWN game with a ready accepted row, appearance 1, start 1 and 40 manual minutes was absent from Team/player quantities and Reports. Its scores were null. Overview could show 1 analyzed game while its leaders and Report count showed none. Changing only the synthetic schedule status to FINAL exposed the existing 40 minutes without rerunning projection, proving this was status filtering rather than publication lag.

## Bounded correction

`src/analysis/eligibility.js` keeps three concepts separate:

1. Saved analysis must belong to the exact currently published native source/team membership. Existing local entitlement/identity/conditional/Included Games guards remain active.
2. Quantity coverage preserves previously selected FINAL/COMPLETED games and additionally admits noncancelled games with accepted active player-analysis rows. Partial rows qualify. Missing quantities remain null. No future date becomes a missing-analysis denominator merely because it appears on the schedule. Original `stats.games` counts retained Trace rows and is not the newer `selected_matches` coverage denominator.
3. Analyzed-game catalog membership preserves ready/estimated/manual compatibility and accepts partial/review publications with `analysis.publishable=true` and retained accepted header provenance. Prior accepted_state is honored after rejected rebuilds. First rejection, pending/header-only/discovery-only records are excluded. Zero-player accepted publications count. Current header deletion does not erase retained accepted proof. The same catalog supplies Overview, Summary and the linked Schedule Analyzed filter/calendar.

The two Coach read-only position/recent-minute selectors reuse the accepted quantity scope. No Coach lineup, plan or result behavior changes.

Results retain their independent FINAL/COMPLETED and verified-score predicates. Source status and scores are never rewritten. UNKNOWN with 40 known minutes still has no W/D/L or score. Report notes and the analyzed-game UI state that saved analyses may contain incomplete or unavailable quantities.

Reports normalize mode/type/period/search at the query boundary to their existing all-season public creation contract. Transient Schedule filters cannot produce a mislabeled filtered report. Season Summary shares one published scope with its player totals, retaining the existing 48 KB query snapshot cap.

## Controls and proof scope

Pure tests cover actual Team/player/Overview/Reports/Schedule/calendar/Coach readers with UNKNOWN, FINAL without scores, verified results, CANCELLED, POSTPONED, future confirmed facts, future without analysis, June inclusion, explicit exclusion, missing and partial quantities, zero-player partial acceptance, first rejection, retained acceptance after rejection, missing current header, manual compatibility, source revocation and retired source IDs. A not-yet-published projection remains separately unavailable. Existing Schedule sorting fixtures now contain their actual entitled source-event membership in both seasons.

`tests/analyzed-status-parity.native.mjs` is an explicit serialized native D1 gate for legacy and normalized published scopes. It exercises host-side service queries and real Summary snapshot/capture SQL, with stub enqueue and `$FENCE=1`. It is not an HTTP authentication, installation-epoch or real coordinator proof. It checks the 48-statement action budget, 48 KB stored SQL cap, unknown result preservation, partial catalog count and immediate entitlement revocation. A full relevant runtime map is hashed before and after and saved to `tmp/analyzed-status-native-source-map.json`.

## Final validation receipt

Runtime implementation: `e59f32d7cfd72f3eb1e815b26c986ce7d329a658`, rebased onto `e8299e0` before the final native run.

- Pure aggregate: 195 tests, **187 passed, 8 skipped, 0 failed**. The eight skipped tests are the optional actual-main Reports JSDOM tests in `reporting-refresh-window.test.mjs`; this command did not set `MYTS_JSDOM_MODULE`. They are not counted as passes.
- Final native gate: **3 passed, 0 skipped, 0 failed** in 38.443 seconds. Both legacy and normalized publications produced a 41,616-byte stored ordered Summary query, below the unchanged 48,000-byte bound.
- Native statement totals include eight reserved upstream statements: Team 19, player 26, Coach hints 11, Overview 28, analyzed Schedule 16, Summary creation 17, Summary capture 9. All remain below 48.
- The before/after runtime map verifies equality for 171 files. Fingerprint: `137e4a43365ad1b4954ae6719fda7b141f57267a7c9ad00afed2bab2236769ad`.

The final native receipt supersedes the preliminary run on the older baseline. Documentation changes after this receipt do not change the tested runtime map.

Integration closure: the eight previously skipped Reports window tests subsequently passed 8/8 with real JSDOM on the integrated candidate. The final changed selection/Overview/Schedule/joined-workflow scope passed 54/54, zero skips. These receipts supplement rather than relabel the original 187-pass/8-skip command.
