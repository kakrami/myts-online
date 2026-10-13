# 7.2.2 connection reconciliation throughput

## Observed production failure boundary

The 7.2.1 TeamSnap paging repair was deployed with tree
`6240b5e41370adc1938d137855d109032bae9523`. One ordinary Update now command
started at 2026-10-12 23:30:30 UTC; the application tab was closed at 23:31:09.
The real provider returned 29 bounded pages and saved 721 source events by
23:34:31. The current run had no new provider error.
These live observations establish that the private events paging request is
working for this account. They do not yet establish attendance completion or
all provider/date-filter behavior.

The subsequent `domain/connection` job has stage `projection`, but it is the
shared season-materialization pass, not a published season projection. Its
events cursor advanced from 72/721 at 23:41:56 to 115/721 at 23:43:51, while all
five seasons remained pending with no projection run. This establishes a
throughput defect in the local reconciliation path. Progress is not completion.

The old path resolves one canonical event per committed page. An ordinary
existing-season event uses six serial collector reads and ten queued writes;
with installation inspection, claim, epoch/lease fencing and next-wake lookup,
the measured native invocation uses 30 SQL statements in 11 awaited D1 calls.
The two main event lookups also repeatedly scan/sort attached observations.
Full exact-schema inspection and the production 500 ms alarm interval apply to
every invocation. A larger SQL LIMIT alone cannot safely fix this structure.

## Bounded repair

The candidate batches a contiguous ordinary-event prefix through shared reads
and set-based fenced writes. Complex game-season moves and owner scope
conflicts keep the established single-event transaction. Existing checkpoints
retain their canonical-ID cursor, root generation, timezone and pass-start
revision. Direct native event IDs use indexed lookups; aliased identity graphs
retain the previous canonical view rather than adding a new traversal bound. A change behind the cursor still requires another complete pass.

Source and transaction byte limits, the 50-statement invocation ceiling,
account/root/installation authority, canonical compare-and-swap assertions,
historical roster evidence, fixed/excluded season intent and atomic publication
remain acceptance requirements. The ordinary prefix is at most 24 canonical
events, 96 linked observations per game, 262,144 serialized source-result bytes,
1,000,000 statement-parameter bytes and 1,024 counted roster-evidence rows. The
last three bounds reduce the batch; they do not lower the existing single-game
acceptance capacity. Oversized single games and alias-affected roots retain the
legacy reader/transaction. The unchanged coordinator still enforces its 2 MB
transaction and 8 KB checkpoint limits. This is not permission to skip records
or raise limits. The schema, upgrade plan and deployment bindings are unchanged.

Stable unpublished projection-row pages may explicitly avoid a redundant
recovery-only alarm. Identity/correspondence work, publication, terminal pages,
provider commits and deferred import obligations retain conservative recovery.
An existing recovery marker or a concurrent owner wake must never be cleared
by this optimization.

## Unaccelerated verification boundary

The dedicated native fixture uses the actual Worker, D1 and Durable Object
runtime with unchanged 500 ms alarm and page delays. Synthetic TeamSnap serves
721 events across five seasons and three attendance participants per event.
Ordinary owner initialization, discovery and yearless connection begin with no
application team or seasons. No browser poll drives the worker and no manual
alarm, fake clock or source-data seeding substitutes for the workflow.

The unchanged 7.2.1 baseline fetched all 721 events in 51.48 seconds, first
resolved an event at 73.92 seconds, and resolved only 34 by 94.26 seconds, with
no published season at that bounded stopping point. The measured prefix rate
was 616 ms/event. Its 444-second single-pass extrapolation excludes catch-up,
attendance, verification and publication; it is not a full-run result or hosted
latency claim. The observed production prefix was slower, about 22 events/min.

The frozen candidate's full native workflow passed with these measured timings:

- First complete source traversal: 51.07 seconds.
- All 721 event resolutions: 98.56 seconds; first root completion: 102.61 seconds.
- First useful/current-2026 publication: 176.28 seconds.
- All five seasons and 721 games published: 186.73 seconds.
- All 2,163 attendance records published: 504.81 seconds.
- Both provider verification traversals complete: 676.78 seconds.
- Full settlement, including final coverage-driven projection refresh: **697.78 seconds**.

The exact 721 source/canonical identities, dates and season assignments, 2,163
attendance tuples, 15 historical roster rows and foreign-key checks passed.
The run used 1,148 invocations, 662 committed pages and 486 recovery invocations.
There were two root passes (fixture revisions 726 and 2889), without a within-pass
restart. Twelve projection runs started and all twelve published: five initial,
five after attendance, and two final coverage refreshes. Temporary obsolete rows
include correctly superseded published snapshots; they are not an abandoned-build
counter. Unchanged page-by-page verification did not restart root reconciliation.

Maximum observed invocation: 36 SQL statements, 182,601 transaction parameter
bytes and 1,805 checkpoint bytes. No failed job, lost lease or bound violation
occurred; the longest observed no-progress interval was 5.67 seconds. The wrapper instrumentation counted 10,419 actual D1 requests; native D1
metadata reports 12,658,939 rows read and 99,626 rows written.
This proves a substantial commit/round-trip reduction for this fixture, not
linear query complexity or a hosted latency/cost guarantee. The provider returned
58 event pages and 174 attendance pages across both verification traversals.
Default bootstrap selection was independently checked through the unchanged
production read model and selected the newest evidenced season, 2026.

## Regression and release evidence

- Final focused SQLite/Node aggregate: **87/87**, zero skips. Includes batch
  prefix/density/UTF-8 limits, aliases, owner-state moves/collisions, root/account/
  timezone/revision fences, behind-cursor catch-up, atomic failed-commit replay,
  safe recovery hints, concurrent wakes, deferred imports and >128-season recovery.
- Independent old/new persisted-data differential: **12/12**. Ordinary 31-event
  traversal falls from 32 to 3 pages; alias-bearing cases deliberately retain the
  prior reader. Seasons, attachments, accepted/source resolutions, historical
  snapshots and owner state match the baseline semantics.
- Complete installation/claim/epoch/coordinator budget proof: 30 SQL statements
  for 24 ordinary events and 480 attendance records, versus 30 per old event.
  Worst tested byte-overflow plus populated owner-state move: **46/50** SQL.
- Existing ordinary native workflow: all **13 scenarios and their parent passed**
  on the same source fingerprint in 109.75 seconds, maximum 45 SQL. This covers
  June boundaries, unknown dates, historical roster preservation, response-loss
  replay, later seasons, correction/Coach/lineup movement, fixed-scope collision,
  reused source demand, in-flight unlink and disconnected saved-history correction.
  The whole-file process was then interrupted because it auto-started separate
  scale/scope groups beyond this requested regression. No whole-file pass is claimed.
- Complete unaccelerated workflow: **1/1** on the native runtime described above.
  Its pre-instrumentation source SHA-256 is
  `abaf0e74646f7104d673515314b784441ca70d87bd7840858992813479990e8f`.
- Release closure and Wrangler 4.149.0 dry-run build pass. Runtime/package/lock
  versions agree at 7.2.2; dependency versions and integrities are unchanged.
- The bounded latency sensitivity checks both completed their predeclared
  prefix endpoint with production 500 ms timers and an artificial 100 ms before
  each actual background D1 request. The unchanged baseline first resolved one
  event at 191.103 seconds and reached 32 at 262.961 seconds. The candidate first
  resolved one at 194.902 seconds and reached 56 at 209.186 seconds, crossing the
  same minimum-32 stopping threshold in a batch. These are different observed
  endpoint counts, not an aligned whole-workflow speed ratio. Both respected the
  600-second hard ceiling and 90-second progress guard, with no failures or
  budget violations. Setup HTTP and read-only observation requests were excluded
  from the injected delay. Each ordinary post-measurement GET `/api/bootstrap`,
  without a preferred season, selected 2026. Both receipts are explicitly
  **PREFIX_ONLY_NOT_COMPLETE**; the full workflow result is the separate
  unaccelerated run above. This is synthetic sensitivity, not hosted latency.

The initial unchanged baseline stopped intentionally after a measured event
prefix. One preliminary candidate native run was stopped before completion to
preserve existing single-large-game acceptance through legacy fallback; no
workflow failure was observed in that preliminary run. Local synthetic success
cannot establish actual private-provider data or hosted latency. The historical
full-suite failures and their scoped closures remain in `integration-checkpoint.md`;
this release does not claim a new clean full-suite aggregate.

## Deployment and live acceptance

This release requires no new schema transition or reconnect. Already queued
connection work must resume from the saved checkpoint on the reviewed code.
Do not reset the source job or repeatedly issue Update now while it progresses.
Verify `/api/health`, retained root/account identities, bounded job progress,
first visible schedule, all historical seasons, attendance and closed-browser
completion on the exact deployed candidate. Preserve the earlier full-suite
failure/targeted-closure ledger; this focused repair is not a new clean full-suite
claim.
