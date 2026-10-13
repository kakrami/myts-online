# Fair service for saved match analysis

## Observed failure

The 7.2.12 season pointer published successfully and remained readable. Its
queued, authorized match-analysis jobs nevertheless received no claims while
priority-100 projection cleanup and later structural catch-up kept running.
The scheduler's ordinary publication class also contained catalogs, match
analysis and current Trace-derived collection. Rotation between broad classes
therefore did not prevent starvation within that class. This was queue ordering,
not an absent source result, invalid subscription or incomplete membership gate.

## Narrow correction

The existing durable ordinary-turn mechanism now uses seven positions:

1. Overdue local connection prerequisites.
2. Season publication and cleanup.
3. Analysis catalog discovery.
4. All saved-match analysis, including older priority-20 matches.
5. Current Trace-derived collection, using the existing exact native scope/date
   classification.
6. Ordinary bulk work.
7. Ordinary bulk work again.

Stored job priorities and aging still order jobs within their service class.
Due time, live demand, account/root authority, leases and deletion gates are
unchanged. A missing class falls through to other eligible work in the same
claim. The current published pointer remains available during catch-up.

The turn remains durable before claim. Its odd cycle cannot repeatedly align one
ordinary class with the alternating foreground-Reports preference. Existing
stored positions zero through two remain valid starting positions; invalid
stored positions recover to the first position. No job data, checkpoint,
installation/schema object or provider policy is changed.

New automatic analysis still requires a settled membership publication for its
own season. The readable old pointer alone is insufficient: read scopes permit
changed source evidence, so removing the owner-write pending guard could accept
new structural facts against an older placement. Exactly scoped match jobs are
therefore excluded from both claim and next-wake selection while that season is
pending. They retain their queued work without a failure or backoff and become
eligible automatically when publication settles. Other seasons and Reports keep
running; previously accepted analysis remains readable. Missing or malformed job
scope follows the original validation path. A change after claim is still
rejected by the exact existing commit fence.

This guarantees class-level claim opportunities under the tested continuously
eligible workload. It is not a fixed wall-clock service promise or a guarantee
that every older job outranks unlimited newer high-priority jobs within its own
class. A new structural or authority change still invalidates affected saved
work through its existing guards; unavailable radar data is not retried or
reclassified by this repair.

## Verification

- The fair-service SQLite/pure scheduler, progressive-root and Reports scope
  passed 104/104 with zero failures/skips. Independent focused review passed
  65/65. After the pending-deferral addition, its final six-file compatibility
  scope passed 154/154; the independent new eligibility scope passed 16/16.
  These are overlapping scoped runs, not a whole-repository pass.
- With a fixed clock, continuously eligible Reports and persistent projection
  events/cleanup/catch-up pressure, each rolling fourteen-claim window serves
  Reports seven times, each non-bulk ordinary class once and bulk twice. Runtime
  storage is reconstructed between claims; saved turns, lost replies, missing
  classes, due/lease/authority checks and finite older-match service are tested.
- The unchanged independent competition replay gives catalogs, matches and
  current-derived work zero claims on the prior scheduler; the candidate serves
  all classes under the same synthetic events/cleanup workload.
- Existing actual root catch-up still publishes partial saved analysis while
  source backlog remains. This is SQLite workflow evidence, separate from the
  native production-runtime gate below.
- Initial native setup correctly rejected a test attempt to insert normalized
  membership into already-published runs. The fixture now stages building runs
  first, then restores their original publication states and pointer. The failed
  setup is retained; no application guard changed.

A later native attempt proved the recent match was selected promptly, then
correctly rejected publication while its own season was pending. That red
identified the controlled-deferral requirement above; the pending guard was not
removed. Final native Workerd/D1 verification passed with the full788 installation/epoch,
actual `createApplicationRuntime` recovery and production collectors. The host
respected each persisted 500ms alarm and page delay and recreated the runtime
between invocations; it did not advance a virtual clock. Across 289 invocations
and 186 claims (357.5 seconds including setup/verification), recent priority70
analysis was accepted at claim4 and historical priority20 at claim32 while real
cleanup, another team's rebuild, source collection and Reports remained active.

During the subsequent same-season structural catch-up, 242 checks confirmed both
queued analyses kept their attempts/failures unchanged. The prior pointer still
served 51 events, seven players and two analyzed games. When the new pointer
published, the queued recent analysis ran automatically and acknowledged its
exact new source clock, with 37 source jobs still pending. Eight XLSX exports
reached ready at 40,592 bytes each. This run proves export scheduling/completion;
previous unchanged encoder/parsing receipts remain the file-content evidence.

Pending-after-capture, structural-input and real connection-removal races all
rejected stale transactions atomically. The three recorded raw CHECK errors are
these deliberate negatives. No unexpected native runtime failure occurred in the
final run; earlier fixture/order/socket and pending-guard reds remain retained.
Only the held-page negative checks set their exact authorized job due/ready time
to zero to select the lease; the production-runtime fairness sequence does not.
The 49 schedule-only fixture headers already had real terminal zero-player
analysis attempts and exact clocks before native seeding. The historical match
ran after one finite higher-priority same-match reanalysis.

Actual invocation maximum was43/50 SQL, largest statement32,455 bytes, claimSQL
25,517 bytes and largest transaction19 statements/57,788 parameter bytes.
All184 captured files matched before/after, fingerprint
`f28bf4540f610f932dfc3282aeb5d53be407365585a2473a177fbaef729a547a`.
The companion native-map file binds these exact bytes; only the generated release
manifest changes during packaging. This bounded synthetic native run does not
promise Cloudflare production latency or establish live private-provider success.

Final runtime hashes:

- coordinator: `5a6acc3279089f386d5d414feeca53a7de687b4a265bfb5be5238a4e24ef1daa`
- runtime: `2dc02d9bc2afdc1c085a6dc3f885c2a7bf78feb1d87f53514e07b27a9342470d`

Schema788, its installation plan, source collectors, analysis resolver and
owner-write fences remain byte-identical to 7.2.12.
