# Connection lifecycle and original UI integration checkpoint

This is an engineering checkpoint, not a release or completion claim. The candidate package
version is 7.2.0 while acceptance is in progress; production remains the reviewed
7.1.4 deployment and its existing configuration.
No remote database change or deployment is part of this checkpoint.

## Product contract

The original 6.20.133 implementation at `50e1be224806ff7e7c439d26e15fd0421e3f6f01`
is the UI/workflow baseline. All 31 gates in `original-to-rebuild-parity.md` remain
the acceptance contract. A source connection belongs to a logical team, can start
without a known season, and continues into evidence-supported seasons. June–May
calendar containers remain; regular statistics are July–May, with June excluded
by default and on Reset. Deliberate saved inclusion choices survive updates.

## Integrated scope

- Durable, idempotent team-level connections and receipts; continuing and fixed
  scope, explicit season exclusions, whole-connection removal and private account
  authorization are distinct.
- Bounded saved-evidence reconciliation creates seasons from team-local dates or
  verified dated native periods. Unknown and conflicting evidence stays visible.
- One accepted calendar membership per logical team/game. Date corrections move
  game-scoped Coach, lineup, tracking and analysis state atomically; collisions
  retain the last accepted game and expose the unresolved correction.
- Historical roster evidence is period/game-qualified. Current roster metadata
  cannot spread across historical seasons. Withdrawn period evidence retains its
  original snapshot for review without continuing to assert verified membership.
- Collection and reconciliation survive closed browsers, crashes and interrupted
  pages. Source-page demand is durable; cursors coalesce changing input and repeat
  full catch-up passes when changes occur behind the cursor. Automatic projections
  wait for accepted evidence without allowing a failed peer root to deadlock
  healthy providers. Unlink and authorization generations fence stale work.
- Exact physical-schema, data-preserving upgrade from the deployed 7.1.4 schema,
  guarded writer epochs and visible maintenance. Deployment activates the upgrade
  through surviving cron/alarms. See `schema-upgrade.md`; rolling back to the old
  binary after transition starts is not a compatible rollback.
- Complete isolated parity batch `a58fced0b04d4d361176a064874988de62bc2255`
  integrated: screens, spatial rendering and detail-controller behavior, plus
  exact original-analysis characterization fixtures. Those fixtures are QA only.
- Original Overview schedule scope, visible Day filters, complete Settings after
  theme changes, calendar event-kind dots and navigation across saved June season
  boundaries restored. Coach asynchronous callbacks are independently fenced.

## Receipts and their boundaries

- Core native ordinary workflow: 13 scenarios / 14 TAP tests passed, no skips,
  137.7 seconds. Synthetic GotSport and TeamSnap contracts, real Worker/D1 and
  Durable Object alarms, no preseeded seasons/attachments or direct materializer
  calls. Maximum 46/50 statements; no inspection retries. Source fingerprint
  `3aae173cf9b6cf25ea23fdcbff92e41625c0aa0e5ba7e64c246d01a8700b13bc`.
  Later dependency, coalescing and UI deltas require their own final receipts.
- First large-history checkpoint: all 101 competition memberships and games are
  reachable, including an undated game assigned by its exact 2022 competition
  dates. Fifty current games published while archive page two was held. Three
  upstream history requests, three root passes and three complete projections;
  peak 48/50 statements. The extended run passed canonical-peer/root unlink.
  Three owner corrections converged through three catch-up passes and five
  projections (three explicit commands plus two affected seasons); the initial
  provisional four-run assertion was too strict and its failure is retained.
  That run exposed stale descendant subscriptions after scope changes. The
  repair now atomically fences old running pages, renews exact-root demand and
  preserves shared cursors. Isolated native scope/roster rerun passes 2 scenarios
  (3 TAP tests), 56.4 seconds, maximum 46/50 statements, zero inspection retries.
  It proves a subsequent unchanged-source poll really fetches, game state moves
  once, and corrected/withdrawn roster evidence preserves historical snapshots.
  Source fingerprint: `5c8a710f3f67ee53c8835f0442e4026b997537c86ff470540eb1096ec68dd3d2`.
  Later exact-source descendant inheritance for a second logical team has its
  own focused lease/donor proof; the final combined workflow remains pending.
- Prior command receipt: 34/34 native cases, maximum 39/48 statements including
  writer-epoch overhead and unsuccessful requests. Six focused coordinator cases
  passed. The later coordinator suite passes 30/30; existing HTTP cases pass
  36/36 plus the corrected second-team ongoing-history case 1/1, maximum 42/48.
  Six application cases passed in the combined run. The 131-season case exceeded
  its old 30-second fixture deadline but completed independently in 52.3 seconds,
  with continuously advancing checkpoints, no job errors/retries, six pages per
  projection and exactly two scheduled recovery ticks. Only that fixture wait
  was raised to 90 seconds, with an exact 786-page assertion; the final assertion
  awaits aggregate rerun. No application timing was changed.
- Prior exact-schema upgrade receipt: 7/7 native cases for the 713-statement
  intermediate schema. The final dependency triggers produce 717 statements;
  its frozen native transition proof now passes 7/7, zero skips (33.82 seconds),
  fingerprint `f85d5890651c6b614ac76b550314af1d32cae5bae1e1dbd211a795f6c284ccb0`.
  The later frozen owner/release aggregate is 14/16, zero skips: release 7/7,
  owner 7/9. One failure is localhost dispatchFetch during schema preparation
  before app assertions; the other is a read-only credentials inspection through
  Miniflare ProxyClientBridge after login/rotation/revocation checks. Those are
  still failed/limited aggregate results, not environment-proven or clean PASS.
  All owner semantics have separate passing isolated receipts. The earlier
  mixed-schema run is invalid evidence and is not counted as a pass.
- Complete Sol parity batch: 36/36 Node TAP tests on the combined source. Original
  source oracle verified byte-for-byte against the original artifact; these are
  component and characterization checks, not native/full-product acceptance.
- Combined deterministic DOM/component/pure suite: 158/158, zero skips, 21.45
  seconds, including 35 real Coach DOM interruption cases. Wrangler production
  dry-run build passed without deploying.
- Owner password Settings: 70 actual-app DOM cases plus 104 connection/Coach
  regressions pass (174/174, zero skips). Fields and FormData are scrubbed,
  confirmation is not transmitted, and late callbacks cannot reopen dismissed
  forms. Native vault/session acceptance remains its separate backend gate.
- Original inline competition cards, keyboard tabs, shared All/Our-team filter,
  per-pool standings sorting and bounded continuation are implemented. Seventeen
  actual-app DOM/pure cases pass, including immediate collapse, late replies,
  background scroll/content retention and a 201-row bounded window. Sorting
  explicitly describes its loaded-row boundary; it never claims unloaded rows
  were sorted. The frozen combined competition/security/connection/Coach/
  original-component UI suite passes 230/230, zero skips, 26.55 seconds.
- Attendance restoration preserves the original saved-inclusion and June rules.
  Past scheduled practices and other non-cancelled events are included; explicit
  NR, missing, unavailable, conflict and untracked states stay distinct. Seven
  production-schema SQLite cases pass, including 127 attendance events, 107
  roster rows and response changes between cursor/report capture pages.
  Native combined integration remains pending.
- Navigation DOM: 3/3 focused cases. Calendar SQL/renderer contract: 1/1. Pure
  season/roster evidence and GotSport membership joins: 9/9.
- Earlier baseline full-suite limits remain visible: the 7.1.3 serial run was
  154/159 with three settle failures and two local Undici transport failures.
  The 7.1.4 transport/auth regression was 33/34 with one local logout transport
  failure. None of those are converted into a clean full-suite pass here.

## Current integration checkpoint: 12 October, 18:49 UTC

The following extends, rather than replaces, the historical receipts above. The
combined working tree is still moving and is not the final packaged identity.

- The last-root unlink defect is repaired in both the shared runtime default and
  the Worker runtime override. Native alarms now recover pending projections even
  when no active connection remains. The focused ordinary unlink/second-team
  continuation run passes 2/2, preserving owner state and admitting no removed
  provider demand. The 131-season test now requires all 786 projection pages by
  alarms without browser runner requests or periodic cron assistance; its final
  aggregate run remains pending. Missed-wake scheduled repair stays a separate test.
- Original inline competition review regressions now pass 23/23 independently;
  late card reads no longer stall behind another modal, collapsed stale cards
  reload, and tab changes retain their shared pending read. Attendance's absent
  tracking flag is now consistently Untracked when there is no response evidence;
  the independent eight-case SQL suite passes, retaining original inclusion rules.
- Shared resolver correction `cc54762af608c9a7a95edfeb3487d50132f69198`
  is integrated byte-for-byte over `ab3c156cbe119173a9bcaaf6c1e2fd39ab99a4ee`.
  The original oracle, resolver, quantity regressions and application adapter
  aggregate passes 66/66 Node records. The original oracle is 13 cases; grouped
  and seeded cases are not misreported as separate Node records. An adjacent
  confirmed-start-without-clock case remains with the pure-module author.
- The application adapter now resolves one bounded full match and publishes its
  player facts, effective halves, lineup, leaders and goal timeline together.
  Accepted facts survive rejected corrections; resetting to the accepted input
  clears the stale rejection without duplicating publication. Imported/disconnected
  saved history is eligible for local catalog-driven analysis. The native
  128-player/4,096-interval proof has not passed: it exposed a real D1 SQL expression
  depth error in scheduler admission before analysis. That is an application
  integration defect under repair, not a transport/environment explanation.
- Interactive and older queued Trace tracking/analytics work now requires current
  provider-backed native evidence before outbound collection and at commit. Local
  file-based assignment/reanalysis does not grant private fetch authority. Typed
  proof, actual admission and reviewer reset cases pass independently; native
  collector/commit race and full-command budget acceptance remain required.
- Production Trace play-window/evidence preservation is being restored from the
  original source. Synthetic resolver inputs do not establish that real provider
  fields support format, goalkeeper or orientation inference.
- Original H2H ranges, whole-selection record, separate upcoming/history paging,
  team-local ordering and bounded midnight rollback repair are implemented. A
  historical public row retains its verified original readable anchor, with no
  fabricated owned season or private detail access. Deterministic read/service
  package passed 20/20 before the expiry extension. Public-request/UI tests now
  pass 20/20 independently, and service expiry tests 5/5. Opening requests one
  finite scan; explicit Refresh is separately bounded; revisiting after expiry
  may request another scan, never a permanent subscription. Saved results survive
  failure, unsupported providers, close/navigation and modal interruptions.
- Connected-history archives use data contract 7.2; producer patch release is
  informational. New imports preserve current fixed/excluded intent, validate the
  entire staged graph before writes, restore missing native history and retain
  owner corrections and stronger provider records. Existing 7.1 legacy-season
  jobs keep their original IDs, bytes and scope. The pure/controller package is
  33/33; an earlier small ordinary native connected-history import/export passed.
  The maximum 4,096-segment / near-64-MiB download and representative 128-segment
  ordinary import proof is pending: its first attempt failed at ordinary
  connection admission before any file operation, at the same scheduler defect.
  Imported roster snapshots remain explicitly uncertain in ordinary player views.
- The exact 730-statement reconstruction upgrade passed 7/7 native cases,
  preserving original parent/child jobs and BLOBs, rollback checkpoints, foreign
  keys, and stale-writer fencing. A later staged-segment expression index makes
  the current target 731 statements; its exact final proof remains pending.
  The schema-step HTTP request now returns a continuation before deriving the
  owner, preventing a real 48-query budget overflow at an exact step boundary.
- The integration production dry-run build passes: 172 required files, 1,631.14
  KiB Worker bundle / 358.51 KiB gzip at this checkpoint. An initial 230-case DOM
  sweep was 229/230 because its previous zero-season fixture expected Data files
  to be hidden. The corrected ordinary pending-team test now opens the actual
  file controller, checks its team-wide list requests and returns to Manage.
  After the lineup editor integration, the full current DOM suite passes 256/256,
  zero skips, in 29.64 seconds. It includes 26 effective-lineup/touched-layer
  cases and preserves the earlier failed receipt separately. Subsequent independent
  review identified three additional lineup cases: preserved owner assignments
  outside the current roster, roster choices beyond 100 and visual format after
  Cancel. Those fixes need their own next aggregate receipt; 256/256 predates them.

## Local integration closeout: 12 October, 19:16 UTC

These receipts supersede the listed open component defects only. They are not a
final aggregate, packaged-artifact or live-provider acceptance result.

- Resolver `de50e2e8f91a3cfdaca189b4c9d4e50c71b28cb6` is integrated exactly
  (algorithm 1.0.2). The independent 98-record resolver/adapter/original-oracle
  aggregate passes, including clockless starters, explicit DNP, partial windows,
  unknown quantities and format-decision precedence. The final saved-lineup
  display/adapter/Overview aggregate passes 70/70 independently; an explicit saved
  lineup without a match clock is visible and labeled, without invented minutes.
- Native catalog-driven analysis passes with 128 players, 4,096 intervals and a
  6,718,906-byte source payload. The full match job uses 38/50 statements; catalog
  admission uses 12. Profiled local wall time is about 1.48 seconds. Maximum sampled
  heap is 27.73 MB, not a proved peak or production CPU-quota measurement. The
  earlier fixture-bound failure and real scheduler/coverage-state failures are
  retained with their repairs in `shared-analysis-adapter-integration.md`.
- Trace's exact 8,000,000-byte, 60,000-frame, 600,000-observation native collector
  passes. It preserves the original play windows and source-bound role evidence;
  explicit frame/observation limits fail permanently while retaining accepted
  facts. Collector wall time is 1.01 seconds and maximum sampled heap is 40.05 MB.
  Actual peak memory, production quota and real private actor shapes remain
  unverified. See `trace-analysis-evidence.md` for exact source identity and limits.
- The original nested public-history admission exceeded native SQLite expression
  depth. The corrected typed admission, claim and commit run passes with four
  root scans and one child, maximum 38/48 statements and no next wake after
  completion. Fresh cross-provider bridge authority and both native traversal
  directions have passing deterministic checks; their expanded native receipt
  and exact final schema transition remain in progress.
- A complete valid 66,502,609-byte ZIP with 4,112 stored parts downloads and parses
  through the owner HTTP route in 21 SQL statements. The capacity fixture also
  checks 4,096 segments. Its sampled graph-validation page exposed repeated scans
  that would make a maximum import too slow. The optimized section-level immutable
  validation now passes a separate seeded native maximum boundary: the complete
  40,950-event graph predicate takes 2.68 seconds, exact native-key duplicate check
  7.52 seconds, and 20,480 foreign event rows are rejected in 1.02 seconds. These
  are bounded native query measurements, not production CPU quotas. The ordinary
  128-segment alarm-driven import remains pending; the large download and section
  predicate are not claimed as a completed maximum-size import.
- The final frontend/analysis checkpoint passes 547/547 Node records with zero
  skips across 35 deterministic, actual-DOM and SQLite test files. All frontend
  and analysis hashes stayed unchanged during the run. Dataset code changed during
  this aggregate, so its component subset is not a final frozen-file receipt.
- A later ordinary connection fixture exposes native claim expression depth
  104/100 after the full bridge and installation guard are included. The earlier
  maximum 92 measurement covered commit statements only. This is an application
  defect under repair; the capacity test did not reach file operations. Review
  also requires typed participant lineage on each public-history receipt so a
  donor cannot borrow the other participant's season proof. This is a justified
  refinement of an unreleased table and changes the final target fingerprint.
  The exact failure and the separate seeded resource proof remain distinct.
- Version 7.2.0 release checks currently pass for 175 required files. The seven
  release regression cases pass. The final build, source freeze, full serial
  aggregate and extracted-package validation have not yet run against this
  combined identity.

## Original Coach/Reports oracle comparison: 12 October, 19:39 UTC

The exact five-file QA-only commit `b0bcb1c23abaa25bf668ff431c9036ec67ea7ee0`
is integrated with verified Git blob identities. All 52 baseline oracle tests pass.
That does not establish rebuilt-service parity: paired review identifies missing
Coach pregame configuration, original slot vocabulary, original half-length range,
starter scoring and live substitution recommendations. A dedicated restoration
is in progress. Reports also have reproduced differences in canceled-row output
and an added column; their original-output contract is being reconciled with
truthful unavailable-data presentation. These remain open product gates.

The 128-segment/1,271-row ordinary import completed through native alarms in
205.7 seconds, with one root pass, one published projection, no abandoned projection
and no provider request/retry. The final fixture now additionally asserts that all
1,270 distinct events are reachable in the derived 2024 season; that assertion was
added after the captured pass and requires its own final run.

## Integrated restoration freeze: 12 October, 19:58 UTC

The following supersedes the earlier open component defects. Historical failures
remain above to identify what each repair and receipt actually covered.

- Public-history native integration now passes 5/5, including both fresh bridge
  orientations, immutable participant lineage on adopted/generated descendants,
  exact invocation budgets, temporary/permanent errors and transaction rollback.
  The former 104/100 and 109/100 expression-depth failures are repaired. A sweep
  of 302 generated writer-wrapped statements reports no preparation failures;
  the deepest public projection statement is 98, claim 92, private file commit 84.
- The ordinary 128-segment import passes with one root reconciliation pass and one
  publication, no abandoned projection, provider fetch or retry. Its strengthened
  final 1,270-event reachability assertion remains assigned to the final aggregate.
  The separate maximum ZIP and optimized whole-graph native resource checks are
  scoped boundary receipts, not a completed 4,096-segment import.
- Coach original-workflow restoration passes 95/95 source/service/DOM checks.
  The assembled Worker component passes 1/1: 20 successful HTTP requests, maximum
  23/48 SQL statements, configuration up to 90-minute halves, three distinct
  striker slots, original suggestions/recommendations, halftime interval repairs,
  second-half continuation, 450-minute capacity, revisions and foreign keys.
  Profile pair/duplicate validation was added after native capture and covered by
  the final DOM aggregate; Worker Coach dependencies were unchanged. See
  `coach-original-workflow-handoff.md` for exact identities and safety differences.
- The exact Coach-aware target remains 731 installation statements, with fingerprint
  `e1c1b6cf96cd12afce94dc14819e103283aacac2f420329cfaf65938888e4f40`
  and upgrade plan
  `755a9a58c834e2a469c8d12e91acd9e51e67800efc7cb4c5e315e037c7170cc7`.
  Native transition passes 7/7, committed child-drain/parent-swap recovery 1/1,
  and fresh-owner exact boundary 1/1. The transition uses at most 33/50 statements
  and preserves Coach rows alongside legacy file jobs through ten temporary
  recovery copies. Deployment guards pass 12/12. These are separate scoped runs.
- Reports original output, selection-wide natural order, decimal precision and
  PDF orientation are restored while unknown facts retain honest scope notes.
  Twelve source/SQLite/encoding checks and four DOM checks pass. Regression
  coverage preserves all 137 rows when an old unversioned XLSX/PDF checkpoint
  resumes under the new encoder. The report stream's high-part-count query budget
  is bounded independently of the connected-history download implementation.
  The populated actual-Worker Reports component passes 1/1: six alarm-driven
  snapshots, all 137 sorted schedule rows, four parsed XLSX/PDF files, full-text
  fallback for 1,024-character alternating keys and stale precommit rejection.
  A real capture-contract failure from semicolons in SQL text was repaired.
  The extra Summary SELECT profiler exposed SQLite planner expansion; explicitly
  materializing its reused player rows fixes it (six rows, 1,603 rows read, 33 ms).
  These red receipts remain separate from the final green component.

## Final frozen aggregate: 12 October, 20:10 UTC

Source checkpoint `a8844b4f82c7dfadbf695b17bfd316c73ca572ad`, tree
`362626d1299ca833f8ef96ed2022db5769ca6ae0`, freezes the combined runtime and tests.
The final deterministic/actual-DOM/SQLite run passes **653/653 Node records** across
42 files, with zero failures, skips or cancellations, in 164.63 seconds. All 253
captured runtime, test, configuration and script hashes match before/after. This
is one actual aggregate count; component/oracle receipts are not added to it.

The final dry-run build passes: 178 required default files, 33 web assets,
1,681.58 KiB Worker / 370.25 KiB gzip, pinned Wrangler 4.149.0. The release archive
also explicitly includes all 33 review/contract documents, producing 191 listed
files before the self-excluded manifest. Archive creation and exact extraction
verification follow the terminal native ledger.

Independent narrow contract review additionally passes 3/3 without candidate edits:
actual persisted halftime availability retains field/minutes and starts half two;
profiles carry across a missing intervening season while explicit current edits
preserve the old profile; projector-to-report keeps confirmed appearance distinct
from unknown quantities, explicit DNP/zero and unknown appearance. These checks
resolve the recovered original UI/backend/README inconsistencies described in
the Coach handoff, rather than copying the old backend's conflicting limitations.

The 21-file serial native aggregate finished against this same frozen source: **169
records, 155 passed, 11 failed, three skipped**, zero cancellations, in 1,325.59
seconds. All 253 captured hashes remained unchanged. The exact-schema, public-history,
Coach and maximum Trace/file component receipts remain separately scoped as above.

## Native aggregate findings under repair: 12 October, 20:32 UTC

The frozen serial run is not a clean pass. It has identified these distinct roots;
its exact terminal count and targeted repair receipts will be recorded separately.

- Public source commit accounting: a terminal history page requires 51 statements
  against 50, and a Live upcoming page can require 54. Equivalent source-read/write
  compaction is being prepared in isolation without raising limits, omitting data
  or removing public-history receipts or authorization fences. The failed large
  lifecycle parent also skips three dependent scenarios; all three need an actual
  repaired rerun, not credit from the earlier component receipts.
- Immediate new-team Reports: the initial empty projection advances content from
  revision 0 to 1 after snapshot admission, so the old snapshot correctly rejects
  its changed revision but the ordinary startup workflow never becomes ready.
  The isolated repair waits for the first unchanged publication and pins once
  before capturing any rows. Real mutations and partial/legacy snapshots retain
  the normal invalidation rules.
- Three stale positive fixtures: manually fabricated private track children lack
  provider-backed proof; fresh setup assumes fewer than 15 steps despite the
  731-statement schema; the old Data ZIP fixture creates a seasonal attachment
  without a typed connected-history root. Test-only corrections use the real
  generator/HTTP connection and a schema-derived bound. Runtime permission and
  scope checks are not relaxed.
- The 131-season fan-out case failed on a read-only Miniflare D1 proxy transport
  exception, before its 786-page assertion. Its unchanged isolated retry is
  pending. This is neither an application-budget assertion nor proof that the
  environment alone caused the failure.

The same frozen aggregate has passed all 12 auth, 9 owner/vault/rotation and 4
password-verifier cases. Its 128-segment import proves all 1,270 events reachable
in 2024 with one root pass, one publication, zero abandoned projections and no
inspection retry. The separate saved-history export/recovery/reopen case passes
with no added provider calls. These successes do not erase the failures above.

## Consolidated repair checkpoint: 12 October, 20:38 UTC

The failed aggregate receipt is preserved. Its 11 failed TAP records represent ten
failed scenarios, including one duplicate lifecycle parent. Seven cause groups are
tracked: source history/upcoming budget, initial-publication Reports race, track
proof fixture, setup-step fixture, typed Data ZIP connection fixture, hand-assembled
schema-isolation fixture, and the isolated D1 inspection transport exception.
The latter passes unchanged on its one isolated retry: 131 seasons × six pages =
786 projection pages, zero failures, five alarm-admitted remainder jobs, no cron or
browser/manual runner calls, max 28 statements; 1/1 in 69.91 seconds. This scoped
success does not rewrite the original aggregate or prove its environment cause.

The consolidated runtime delta is confined to source-page read/write compaction
(`src/domain/repository.js`, `auxiliary.js`) and the one-time initial-publication
Reports pin (`src/reporting/service.js`). Reviewed test-only fixtures restore
production-generated authority, ordinary HTTP connection intent, and exact schema
identity/step bounds. The source compaction keeps limits, facts, receipt settlement,
conflict ordering and transaction fences. The startup pin cannot rebase partial or
legacy snapshots and rejects actual input/evidence changes. Pure focused tests and
native affected-workflow receipts are recorded separately; the full four-case
lifecycle subgroup must run, including all three previously skipped children.

## Repaired-checkpoint native closure: 12 October, 20:50 UTC

Checkpoint `a1ab482ae2414984b4cc5e1d1681379c38d402f5`, tree
`146fb3f7a9091420283f651fe4e2f07f4ed561db`, has unchanged before/after hashes
for all 255 captured files. Its six-stage serial native closure ran 643.86 seconds:
**18 records: 11 passed, four failed, three skipped**, zero cancellations. The
lifecycle parent duplicates its failed child; this is not a clean aggregate pass.
New pure source/startup regressions pass 12/12. Refreshed dry-run build passes with
178 default required files, 33 assets, 1,685.66 KiB Worker / 371.17 KiB gzip.

- Complete `deployment-runtime.test.mjs`: **4/4**. Immediate new-team Reports and
  the complete public source import now finish at unchanged native query limits.
- Complete `fresh-application.test.js`: **4/5**. Schema-bounded initialization,
  four Reports plus real XLSX/PDF, the public connect/publication/correction/CAS/
  inclusion/bookmark/share/rotation/rename/removal flow, and Coach pass. The ZIP
  fixture times out waiting for initial connection settlement before export;
  exact queue/root diagnosis remains required rather than assuming a file defect.
- Complete `schema-isolation.test.js`: **2/2**, preserving the foreign database
  and its saved rows while comparing the actual target identity.
- Populated `reporting-parity.native.mjs`: **1/1**, six alarm-driven captures,
  all 137 rows, four opened binary files, full-text fallback and stale commit
  rejection. This closes the Reports runtime repair at empty and populated scopes.
- The corrected owner-track positive reveals a real D1 expression-depth failure
  previously hidden behind the obsolete missing-proof fixture. A helper-local
  equivalent query-shape repair is being reviewed; provider authority and limits
  must remain intact and both interactive and legacy native paths must pass.
- The large-history case now reaches successful source work (max 45 statements),
  but its early assertion unnecessarily waits for the page-two request to begin
  behind 200 higher-priority child jobs. The reviewed test correction directly
  proves all 50 current games visible while exactly one history page is saved and
  page two is still queued/running with its hold configured. The same deadlines
  and all 101-history, cursor, fetch-count and later correction assertions remain.
  All three skipped children still require execution.

## Final focused repair boundary: 12 October, 20:57 UTC

The track fetch proof now balances unchanged conjunctions and computes the exact
captured game's fixed-season memberships in a statement-local CTE. Interactive
expression depth falls 101→73; legacy/default proof 130→90. All 230 profiled
statements compile within depth 100; all 728 old/new authority matrix cases agree.
The eight focused authority tests pass, including preflight, before-fetch and
atomic-save rejection. This evidence does not replace the pending native positive
and legacy audited-commit test. No permission, query limit or schema was relaxed.

The Data ZIP diagnostic preserves the failed receipt: after 120 seconds all provider
jobs were ready and the root reconciled 29/29; the final projection was still
advancing after 22 committed pages, with all 17 old published observations retained.
The revised archive gate stages its fixture: ordinary discovery first, then the
same 17 saved observations and an identical connection-command replay to wake local
reconciliation. Each phase retains the 120-second deadline, and one team/root/receipt
is asserted. This tests the full archive round trip and recovery, not simultaneous
provider discovery plus seeded-history settlement within a single 120-second phase.
The separate large-history lifecycle gate retains concurrent source/publication proof.

The final runtime build passes: 178 default required files, 33 assets, 1,686.33 KiB
Worker / 371.35 KiB gzip. Four focused native stages now remain: owner track admission,
legacy/interactive native proof, all four lifecycle scenarios (including prior skips),
and the staged Data ZIP round trip. Earlier Reports, public import, schema, security,
analysis and maximum-resource receipts retain their exact checkpoint boundaries.

## Final runtime-repair receipts: 12 October, 21:08 UTC

Checkpoint `3766155b2da797ade730780cefaeca3e9c036f9b`, tree
`358b0a7c1171bb7d668fcbf51299f82c237678c9`, remained unchanged across all 256
captured files. Native runtime fingerprint (Worker/src plus the shared tactics
module) is `804c419e8cc493c2b4be6448de6b159df1fb5219809f251da9564b85a5a8e144`.
The four focused stages yield **eight records: three passed, two failed (one
lifecycle child plus its parent), three skipped**. This remains a failed run.

- Ordinary owner track admission: **1/1**, 15.96 seconds.
- Native installed proof and atomic commit: **1/1**, 15.76 seconds. Admission is
  43/48 statements including reserve 20 and produces five real generated children.
  Provider, stale-root and file-only commit cases each use 13 statements; denied
  pages retain source/audit/permit state. This closes the depth defect at native D1.
- Complete staged Data ZIP round trip: **1/1**, 193.68 seconds. All 21 exported,
  source and canonical records and 20 published records are retained; all 17 seeded
  observations keep their scores; 11 segments validate, no source writes occur
  before commit, and the completed import reopens correctly.
- Large history: the early publication assertion passes with 50 visible games.
  All 407 provider jobs, including three history pages and each of 101 event,
  division, bridge and standings jobs, finish successfully. Max 46 statements and
  zero violations/inspection retries are recorded. Complete local season publication
  is still pending when the 240-second total cutoff occurs during the advancing
  period cursor. The test is not passed; its three later scenarios still skip.

The reviewed next harness boundary explicitly increases the scale test allowance
from 240 seconds total to a hard maximum of 240 seconds for the complete provider
graph plus 120 seconds for local reconciliation/projection, with progress and stall
checks. Later scope/correction scenarios receive an independent initialized harness,
so a scale failure cannot hide them. No application deadline, priority or limit changes.

## Final local closure: 12 October, 21:22 UTC

Test-only checkpoint `a55c474e707b19d499787734de7888baec0532d4`, tree
`b65c5c16b68a61d5d807df17d35665b0e11c49da`, passes the two final native lifecycle
groups: **6/6 records, zero failures, skips or cancellations**. All 258 captured
runtime/test/configuration files remain unchanged through the run. Runtime bytes
remain identical to the preceding `3766155` track and Data ZIP proof.

- Independent scope/history group: 4/4 in 120.12 seconds. Canonical-peer/root unlink
  preserves and rehomes the saved lineup without provider recollection; fixed-scope
  correction applies after explicit widening; qualified historical roster correction
  and withdrawal preserve uncertainty rather than leaking current metadata.
- Scale group: 2/2 in 380.05 seconds, including its later race checks. Initial full
  collection is 236.908 seconds and local drain 36.233 seconds (273.141 total),
  within the explicit 240+120 phase bounds and 60-second committed-progress stall
  rule. All 407 expected provider jobs, three history pages and 101 membership
  cursors complete; all 101 games are reachable across 2022 and 2026. Initial
  materialization takes 394 pages/three passes and three published projections.
- Two later behind-cursor edits converge in three catch-up passes/957 pages, with
  three owner-command and two automatic publications, none superseded. The final
  accepted correction persists. Max native statements is 46, with no budget
  violations or read-only inspection retries.

Every one of the original 11 failed and three skipped TAP records now maps to a
passing scoped receipt: 13 repair closures plus the separately labeled unchanged
131-season retry. The original **155 pass / 11 fail / three skip** aggregate and
intermediate failures remain valid historical results. The repaired source was
not rerun through an unrelated full aggregate; this ledger does not relabel those
runs as a single clean full-suite pass. The 653/653 deterministic/DOM/SQLite run,
new source/startup 12/12, tracking authority 8/8, progress 6/6, and independently
reviewed component/native receipts retain their distinct source boundaries.

Required-only packaging includes 191 files and the self-excluded manifest: all 33
review/contract documents, the Worker, 153 required runtime/assets files, exact lock
and release tooling. The runtime/assets fingerprint is
`ee58b05e8e537d9f1b0d822ae8047dc54db163e937b08468c9d701362e5464e3`.
Clean extraction passes every manifest byte/hash and ZIP CRC. A fresh locked
registry `npm ci` and dry-run build pass (178 default closure files, 33 assets,
1,686.33 KiB / 371.35 KiB gzip); offline-only install initially lacked one cached
package, so that attempt is not described as a successful offline install. Final
archive/tree hashes and independent extracted native acceptance are recorded in
the external release receipt, avoiding a self-referential archive hash.

## Still required before release/completion

All known local runtime regressions and skipped lifecycle scenarios are closed by
the explicit receipts above. Final exact archive audit and its extracted native
public-import check precede publication. Exact unchanged resource and schema
component receipts remain scoped rather than repeated blindly.

All 31 original gates remain separately tracked. Local synthetic and historical
receipts cannot establish fresh private-provider authorization, production egress,
actual closed-all-tabs scheduled changes, physical touch/orientation, or live Coach
phone-lock behavior. Reviewed deployment must explicitly include the data-preserving
schema transition; no old-binary rollback or database reset is authorized here.
