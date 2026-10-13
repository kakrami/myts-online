# 7.2.7 live workflow parity and report stability

## Evidence and scope

Live 7.2.5 completed the real TeamSnap attendance history with the app closed:
5,455 unique attendance pairs, 721 retained events, 11 current-season players and
no collection error; the completion receipt is 2026-10-13 02:46:29.917 UTC.
After the 7.2.6 promotion, this release addresses attendance-display, navigation, cancellation
and report-preparation findings. It does not repeat or reset that import.

The original baseline remains myTS 6.20.133 at commit
`50e1be224806ff7e7c439d26e15fd0421e3f6f01`, worker blob
`bd2d055483abae37ddae2680ec62f6282da6680c`. The included original Reports oracle
pins the attendance denominator. The decoded original UI lines 655–658 and
2470–2471 pin attendance calculation and per-view page position respectively.

## Attendance percentages

The original percentage is Yes responses divided by every selected, tracked,
past eligible event. Missing, unknown, Maybe and NR observations contribute no
Yes to the numerator but remain in that denominator. A Yes plus a missing cell
therefore displays 50%; a Maybe plus a missing cell displays 0%. No eligible
events remains a blank percentage. Existing July–May/June, saved inclusion,
future-event and cancellation rules remain in force.

The shared read query now restores that calculation, rounded once to an integer
using the original divide-then-multiply order. The tests retain exact original
edge behavior: 47/95 displays 49%, and the original floating calculation of
29/200 displays 14%. Team roster, player views, Attendance and Players reports
use the same result. Schedule report applies the equivalent event-level rule.

This does not relabel a missing response as a provider-supplied NR. Missing,
unknown, conflict, unavailable coverage and explicit NR remain separate in the
saved/read model. Reports keep their existing diagnostic breakdown in notes
rather than replacing the restored percentage with that breakdown. Immutable
captured rows and already-generated files do not change when later source data
changes.

## Page and detail scroll ownership

The original interface scrolls the window/document, while detail sheets scroll
their own body. The rebuilt route code had saved root.scrollTop, which was not
the page's actual position; navigating from a long Schedule list could carry the
window position into Team.

The app now remembers outgoing window offsets by viewer/role, logical team,
season and primary view, then restores a destination's remembered position or
zero. Configured Overview shortcuts start at zero. Browser Back/Forward uses the
position captured in that history entry. More and background repaint preserve
the user's position at repaint time, including scrolling during an outstanding
request. Entity detail positions remain independent, including nested Back and
return from another season to the originating page.

History writes from scrolling are coalesced, with explicit flushes at navigation
and shutdown. The app temporarily owns browser scroll restoration and restores
the prior browser setting on stop. History restoration is guarded during both
unsaved-change confirmation and delayed context loading; stale responses cannot
move a newer view. Restoration uses immediate scrolling so the existing smooth
CSS policy cannot race history capture.

## Explicit connection dismissal

The live sequence Settings → Trace Manage → Cancel → Reports → reload reopened
Trace authentication. The exact actual-main test reproduced it: dismissal kept a
persisted pre-command connection intent, and startup resumed every saved intent.

Explicit dismissal now clears a connection that has not submitted an attachment
command. It still cancels any outstanding Trace challenge. An immutable pending
attachment command is retained for lost-response recovery. Page shutdown and
maintenance interruption continue to preserve genuinely interrupted sign-in.
Late send/verify/callback replies cannot reopen a cancelled flow.

Old 7.2.6 snapshots do not distinguish an earlier Cancel from a genuine
interruption. They are not all erased on upgrade. If an already-stale prompt
appears once, Cancel under this release clears it and later reload stays closed.

## Accessible event titles and bookmark investigation

An empty provider title bypassed nullish fallbacks, leaving some Live game cards
and detail dialogs unnamed. One shared presentation helper now uses a nonempty
title, otherwise the actual home/away names, otherwise a generic Match/Practice/
Event label. All providers use it; HTML escaping, unknown statuses and underlying
canonical IDs remain unchanged.

The separate live observation of two additional Bookmarks was checked against
storage. Each had its own persisted event row and save timestamp, while the
parent's single test bookmark was removed correctly. No client list-contamination
or title-based identity defect was demonstrated. No bookmark record or mutation
logic is changed by this release.

## Report preparation and semantic source changes

Live reports requested around 03:27 initially waited behind active season
projection work, then explicitly failed report_changed around 03:31. A new
GotSport connection was also started around 03:31, so those final failures cannot
be attributed solely to a periodic TeamSnap refresh. Scheduler-ready is not a
successful report: snapshot state, captured rows and export result are checked.

A deterministic local reproduction nevertheless established redundant work:
identical attendance observations plus complete→partial→complete refresh coverage
rewrote observation-only coverage rows, advanced the source serialization clock,
and dirtied season projections on the completeness boundaries. Attendance report
preparation consequently saw its conservative evidence clock change even though
its accepted data had not changed. This was periodic redundant work, not proof
of a self-sustaining projection loop.

The auxiliary writer now separates a validated TeamSnap refresh's current scan
progress from accepted full-history coverage. Source jobs/checkpoints retain
current partial state, traversal counts, recent/full freshness and failures.
Previously accepted full coverage remains available while a recheck is partial;
a first incomplete scan cannot claim that coverage. Semantically unchanged
coverage does not rewrite its storage row solely for a new retrieval timestamp
or scan ID. Real auxiliary updates and removals identify their actual dirty
source dependencies instead of including every unchanged incoming record.

True response/status/count/completeness/availability changes, first partial
coverage, revoked commits, scope changes and cross-provider content still
invalidate the relevant evidence and report. No scheduler priority, schema,
serialization trigger or immutable report-capture fence is weakened. Generic,
legacy and imported pages cannot claim the typed provider-refresh exception.

## Verification ledger

- Original attendance API/view/report paired regressions and neighboring report
  tests: **61/61**; adjacent source/retry/page checks: **36/36**, zero skips.
  Original Yes+missing suppression and double-rounding reds are retained.
- Independent frozen refresh/source/domain/identity/page/budget aggregate:
  **108/108**, zero skips, including 25 focused unchanged/changed/partial/revoked/
  cross-provider/reconnect/legacy/imported/public-coverage cases. The real
  scheduler/collector/coordinator SQLite fixture captures all four report types
  and downloads 16 actual Excel/PDF files across recent/full refresh scenarios.
  Unchanged middle source pages now use 43 rather than 44 statements; terminal
  46/48 statements and the existing 50-statement ceiling remain unchanged.
- Native populated Reports query/capture/export proof: **1/1**, 137 rows,
  **10** actual alarm-captured snapshots, **6** parsed Excel/PDF files, plus real
  roster/player HTTP percentage checks. Nine profiled report queries use
  9,204–28,973 SQL bytes (below the 48 KB bound), measured at 15–56 ms. Typed
  refresh replay in this fixture is through the repository, not the source
  collector; its genuine changed-response rejection and immutable ready snapshot
  assertions remain useful but distinct from the separate collector gate.
  The first extension attempt had a missing required title in its synthetic
  source-event seed, corrected only in the fixture; the failed receipt is retained.
- Native real source collector/coordinator compatibility: **1/1**, zero skips,
  6 synthetic provider requests and 40 production coordinator commits with the
  full installation/epoch wrapper. An admitted Attendance snapshot survives the
  unchanged refresh and exports Excel/PDF; evidence revision 12, content revision
  1, event input revision 2 and accepted coverage/projection rows stay unchanged.
  A genuine changed attendance response fails a newly admitted snapshot with
  report_changed and zero captured rows. This fixture manually advances due time
  and calls runOne; it is transaction/query compatibility evidence, not an
  alarm-only closed-browser or per-invocation 50-query measurement.
- Actual-main Trace cancellation was red before the fix and green afterward.
  Independent cancellation/interruption/pending/maintenance subset: 27/27.
- Scroll desktop/mobile-width DOM baseline reproduces the erroneous carried
  1,200-pixel position. Refined actual-main scroll tests: 12/12, including More,
  response-time movement, team/season keys, nested/cross-season details, history,
  coalescing and both discard-confirmation outcomes.
- Final integrated actual-main/title/connection/scroll/owner-security/Reports DOM
  aggregate: **204/204**, zero skips, 10.24 seconds. This includes the final
  null-record title case and the guarded history-confirmation behavior. The
  independent title helper and exact blank-provider-title/bookmark-ID cases also
  pass; no bookmark identity or mutation is changed.
- An earlier combined main/connection/report/competition DOM run passed 126/126;
  it predates the final confirmation guard and is not the final aggregate.
- The optional actual Chromium test did not establish browser acceptance. The
  sandboxed launch failed at a required Unix socket with EPERM; the supported
  escalation attempt returned TurnAborted before execution. The interrupted
  attempt is retained, and no live owner tab was used. JSDOM width cases are not
  physical-device or real-browser scrolling proof.
- A Trace worker accidentally started the broad npm test aggregate, then stopped
  it on detecting conflict with serialized native ownership (exit 130). That
  aggregate is incomplete and is not reported as a full-suite pass.

## Exact source and build boundary

The populated native Reports run retained equal before/after maps of 164 runtime,
asset and package files, fingerprint
`986ecbaba771dab8da9d5ed98ff2f4e6e1ab7803e9a522c732376bf19870fdfc`.
The frozen parity checkpoint eeedfbb3 differs from that capture only in the independently reviewed
`web/app/detail-features.js` and `web/ui-original/presentation.js` title fallback;
those bytes are covered by the 204-case DOM run. All backend inputs and the
scroll/Trace-dismissal code in that parity checkpoint match the captured source.
The separately reviewed Trace contract follow-up is described in
[Trace member contract repair](trace-member-contract-repair.md); its three-file
backend delta has its own collector/coordinator and native receipt.

The collector-refresh native test did not retain a full contemporaneous file map.
Its author did retain equal before/after auxiliary-writer hashes around execution,
plus an after-only test-file hash. This is not conflated with the separate
populated Reports 164-file map or presented as a reconstructed prior capture.

The final release check passes **184 required files**. Wrangler 4.149.0 dry-run
build passes with a 1,762.38 KiB Worker (389.75 KiB gzip) and 34 web asset files.
A follow-up dry run initially lacked the cloud shell’s Wrangler configuration
directory; the same build passed with an explicit writable temporary local
configuration directory, without authentication or deployment. The failed local
launch receipt is retained. The dependency lock changes only the root release
version to 7.2.7. No database,
configuration, schema, collector protocol or scheduler change is included.

## Deployment and remaining acceptance

No schema import/reset, source retry, account reconnect or credential operation
is required. Preserve the exact 731-statement schema and upgrade plan, both
existing databases, DB/ADMIN_KEY/SYNC bindings, cron and 30,000 ms CPU budget.
The source identity/pagination contract and the completed live history remain
unchanged. Deploy only the independently reviewed exact artifact through normal
approval. Verify health 7.2.7 before the ordinary UI checks.

Recheck current Team attendance values against the saved report, navigate a long
Schedule list to Team and back, cancel a new Trace sign-in then navigate/reload,
and prepare/download a real report after its data is stable. A genuine concurrent
provider/owner change can still require a fresh report request; stale snapshots
must never be published. Physical scrolling and full original-product acceptance
remain open until actually exercised. The separately observed TeamSnap/Live
Upcoming duplicate-game issue is under scoped identity review and is not claimed
fixed by this release.
