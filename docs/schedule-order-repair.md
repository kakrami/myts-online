# 7.2.5 Schedule ordering

## Confirmed regression and original behavior

Live 7.2.3 Schedule → Season → Past displayed oldest first; the unchanged ordering code persisted into 7.2.4. The browser retained its initial `direction: asc` through period/filter changes; the read repository correctly honored that query. The original 6.20.133 UI's `periodCompare('past')` reverses chronological order, while Day and Upcoming are chronological. `analyzedGameItems()` also uses Past ordering. `effectivePeriod()` treats a historical season as Past while retaining the user's current-season period preference.

Original source: repository commit `50e1be224806ff7e7c439d26e15fd0421e3f6f01`, Worker blob `bd2d055483abae37ddae2680ec62f6282da6680c`; decoded APP_HTML functions `analyzedGameItems`, `scheduleCompare`, `effectivePeriod`, `periodCompare`, and `filteredMatchItems` (lines 1384–1397 in the verified decoded artifact).

## Bounded repair

One pure `web/app/schedule-query.js` policy is used at the browser's Schedule request boundary and by `ReadRepository.schedule`. Day defaults ascending; Season Past and Analyzed default descending; other Season selections default ascending. Analyzed uses the complete analyzed-season selection rather than a hidden Upcoming filter. Historical Season selections use Past based on the team's local day and saved season end. The user's underlying period preference is not overwritten, so returning to the current season restores it.

The browser derives ordering for every request, including restored history, pagination and mode/filter/season transitions. It does not trust a stale `direction` saved by an earlier UI. The server keeps explicit `asc`/`desc` API overrides for existing consumers; omitted direction follows the same Schedule policy. Generic selection normalization, reports, bookmarks and H2H sorting are unchanged.

Schedule now merges three independently limited SQL streams: known instants, date-only TBD rows, and wholly undated rows. Each stream admits at most page-size plus one; the optional historical transition repair repeats that bounded query once, so at most 6×(page-size+1) candidates are fetched per request. No complete season is fetched or sorted to render one page. Ordering uses the team-local day; within that day known kickoffs always precede TBD in both directions; known times and deterministic event-ID ties follow the selected direction. Wholly undated rows are last. The existing bounded IANA timezone helper handles midnight/DST and historical date rollback. Day selection uses exact team-local boundaries.

A versioned five-part keyset cursor records day, time class, instant, ID and the frozen period cutoff. Existing actor/season/filter/direction/timezone/revision binding and late-response fences remain enforced. Old-order tokens are rejected rather than reinterpreted. The current browser discards that continuation and reloads page one once; a stale failure after newer navigation cannot restart the new selection. Reversal/filter/season changes request page one. No timestamps, scores, statuses or inclusion rules are rewritten. Past does not mean a game has a confirmed result: unknown status and null scores remain unknown.

The browser-served helper is an explicit dependency in native test module manifests, as well as automatic production/release module closure. These fixture-only additions do not alter the application.

## Verification

- The first ten direction-policy regressions produce six failures and four passes on frozen 7.2.4, and pass after repair. Expanded final database coverage compares the verbatim original comparator with mixed known/TBD/undated rows in both directions and across limit-one pages; it also covers team-local midnight, DST gaps/folds, skipped dates, midnight rollback, frozen cutoffs, old-token rejection and bounded reads over 615 saved events. Final expanded database suite passes 19/19, zero skips.
- The new actual-main DOM baseline has two failures and one pass on frozen 7.2.4. The repaired regressions cover period/filter/Day transitions, historical/current preference restoration, old history carrying stale ascending direction, historical calendar query consistency, ordered append, pending-page reversal and filter/season resets. The final connection/calendar/transport/navigation aggregate also exercises old-order token restart and stale rejection after a newer filter; passes 77/77, zero skips.
- Initial native Workerd/D1 direction proof passed 1/1 (10.98 seconds), with full owner initialization and eight synthetic saved projections. The final expanded native fixture passes 2/2 (18.25 seconds), adding mixed timed/TBD/undated, team-timezone boundaries and actual-query budget checks: 12 SQL statements for ordinary owner HTTP reads and 13 for historical midnight rollback repair, below the unchanged 48-statement HTTP limit. It agrees with calendar dots using production eventPresentation-generated rows. It deliberately seeds published records to test the real owner HTTP read path; it does not claim source-import coverage or issue provider requests.
- Neighboring H2H, calendar and projection-recovery regressions pass 39/39, zero skips. Independent review also passes 40 mixed-time Intl-oracle cases and the exact UI continuation-recovery test.
- Pinned Wrangler 4.149.0 dry-run build passes with 184 required files; final exact archive extraction is checked independently. The exact final archive is checked against the committed manifest, dependency closure and unchanged schema/plan.
- Logs retained locally: `myts-725-schedule-order-baseline.tap`, `myts-725-ui-baseline.tap`, `myts-725-schedule-order-patched.tap`, `myts-725-schedule-mixed-tests.log`, `myts-725-schedule-neighbor-tests.log`, `myts-725-schedule-ui-v2.tap`, `myts-725-native-schedule-mixed.log`, and `myts-725-build-v2.log`. These are scoped receipts, not a full-suite or hosted acceptance claim.

## Preservation and deployment

Visible version 7.2.5. This is a code-only read/UI patch. Schema remains 731 statements with fingerprint `e1c1b6cf96cd12afce94dc14819e103283aacac2f420329cfaf65938888e4f40`; upgrade plan, installation timestamps, databases, bindings, credentials, source/connection/job state and CPU budget remain unchanged. No Update now, targeted retry, reconnect, import or reset is required for this ordering fix.

After deployment, verify `/api/health` reports 7.2.5. Reopen Schedule, check historical Past newest first and current Upcoming earliest first, load another page, then change filter/mode/season and use Back/Forward. Existing token selections changed by this policy must restart cleanly. Attendance recovery from 7.2.4 continues independently.

## Explicit boundaries

This patch restores direction, effective-period behavior and original known-kickoff-before-TBD ordering in Schedule. It does not change other list ordering or infer completion from elapsed dates. June remains in its June–May calendar container, with separate July–May statistical inclusion. Full original-product acceptance and private-provider completion remain open. No full-suite rerun or physical-device acceptance is claimed.
