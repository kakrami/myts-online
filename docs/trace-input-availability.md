# Trace input availability: read-only handoff and bounded correction

Baseline: `9175ec549e6840ff49aa359a5e92300352e4aac2`, release 7.2.17.
Original behavior reference: `50e1be224806ff7e7c439d26e15fd0421e3f6f01`.

## Provider availability versus implementation

The supplied 2026-10-13 16:01 UTC production evidence reports 24 radar jobs
blocked with `source_access_denied` over 12 matches and two unattempted jobs for
one match. This is evidence of unsuccessful provider access, not proof that the
underlying data does not exist or that the account lacks an entitlement. Existing
request diagnostics are needed to investigate the reason. Denied jobs remain
untouched; this work makes no provider requests.

Tracking had 336 queued jobs, 310 attempted, and 663 saved rows. Three recent
jobs had three pages/rows and checkpoint keys `chunk/chunk_pages`. Those keys and
aggregate counters cannot establish advancing or repeated chunks. The production
collector splits each player/half into four chunks, with additional local pages
when necessary. A synthetic collector/storage reproduction saves chunks 0–2,
leaves `chunk:3`, and completes on the fourth page. Saved rows count stored pages,
not individual observations or useful playing minutes.

Original `calculateGame` uses actual half playing windows, supplied from an
accepted summary or detected from radar. Original `saveTraceSource` requires both
radars. Nominal video duration is not a substitute for measured playing time.
The current resolver likewise cannot produce match minutes from tracking alone
without those windows. A missing window is not a presentation defect.

There is a separate implementation defect: the adapter requires radar-derived
windows before marking fully collected tracking complete. Two new regressions
fail on the unchanged baseline (both radars missing; second radar missing).
The correction derives tracking completeness from usable native header authority,
both saved clip halves, mapped GIDs and complete tracking coverage. It does not
relax the playing-window, format, role or quantity calculation. Missing radar still
publishes incomplete analysis with null match duration/assigned/capacity minutes.
The adapter algorithm identity advances to `adapter-3`; no manual invalidation is
required or performed. Actual background recomputation remains a live check.

## Read-only evidence for dot/browser delegate

Execute the four standalone SELECTs in
`scripts/diagnostics/trace-input-evidence.sql` against the existing database
`myts-v7-rebuild-data` / `60f77502-33d4-41d6-80d4-1c5577ebba76`.
No schema, job or checkpoint writes, wake, refresh, or retry accompanies them.

1. Q1: run twice at least two minutes apart while the app stays closed. Return
   both results for the three specified job IDs. Compare scan/generation first,
   then chunk, local offset, per-chunk page counts, counters and timestamps.
   A completed job is a valid outcome. Do not force new work to obtain a sample.
2. Q2: confirm the anchored publication still exists and the scope contains 13
   Trace match/team pairs. If the scope differs or is empty, return that result;
   do not broaden the query to account-wide private history. It also supplies
   current component/state/coverage/error aggregates.
3. Q3: return saved radar windows/provenance and aggregate tracking coverage per
   anonymous match number and half. Current-scan and previously saved complete
   coverage are distinct. Tracking counts are job coverage counts, not players.
4. Q4: return up to four existing observations per radar job, including status,
   static error code, timestamp, attempt and endpoint class. Host classification
   and query-presence flags expose no raw asset path or signed query.

Do not add raw arguments/checkpoints, URLs, response bodies, headers, error
messages, native IDs, GIDs, player rows, credentials or secret values to the
results. The SQL whitelists numeric checkpoint fields and opaque job/scan IDs.
HTTP status, endpoint category and chronology may narrow the access failure;
they cannot by themselves prove a provider licensing restriction.

All four SELECTs compile and execute against the current full domain, sync and
analysis schemas in local SQLite. This verifies SQL shape, not production data.

### Correction after the 16:36 UTC production query results

The original diagnostic job CTE incorrectly filtered `stage='source'`.
`src/application/sync-service.js` assigns Trace tracking, analytics and radar
children to `stage='analysis'`. The corrected SELECTs use that exact stage;
the published run/account/game/team scope is unchanged. Empty-table compilation
did not catch this semantic query error. A populated regression now verifies all
three component classes, per-half coverage, denied radar observations, output
sanitization, and exclusion of other accounts/games/teams/stages/runs (2 tests pass).

The valid production component results at 16:36:12 UTC show one saved clip in
each of 26 halves, no saved radar components/windows, and tracking rows in 24
halves. The zero job-derived counts from the incorrect SELECTs are discarded.
The 16:35:58 UTC checkpoint sample places the three specified jobs at chunk 3,
three attempts/pages/rows, no failures, unchanged scan IDs and saved timestamps
around 16:00–16:01 UTC. They await the fourth chunk. This proves a substantial
wait for those jobs, not its scheduler/eligibility cause or repeated collection.
The second timed sample and corrected scoped totals remain pending. No runtime
scheduling change, provider request, denied retry, or push accompanies this fix.

### Completed 16:40 UTC read-only bracket

The corrected results confirm all 13 source matches and the same active
publication. Tracking totals advanced from 663 saved rows at 16:01 to 709 at
16:40, with a latest save at 16:39:37. There are 310 partially collected jobs
across 12 matches, 26 unattempted jobs for the remaining match, and no complete
tracking coverage. Analytics has 433 complete jobs, 71 partial jobs and 39
unattempted jobs. The three sampled tracking jobs remain identical across
158 seconds (16:35:58–16:38:36); this is waiting, not observed repeated chunks.

Each of the 24 blocked radar jobs has exactly one attempted asset HTTP 403 after
a successful token HTTP 200. There are no saved radars; the last match's two
radar jobs are unattempted. This does not prove nonexistent data, expired
credentials, licensing restrictions, or a correct/incorrect asset URL. No denied
request is retried.

The coordinator resets ready_since to the next eligible page time after every
successful page and orders eligible work by service class, priority plus aging,
then next_at and job ID. This can spread progress across a large queue, but does
not establish why those three production jobs waited. Its existing 43 focused
fairness regressions pass locally. No scheduler modification is justified yet.

`scripts/diagnostics/trace-wait-eligibility.sql` tests due time, lease expiry,
account generation and the coordinator's generated private-job demand predicate
for only those three jobs within the same published run. It returns status
booleans and scheduling numbers only, and compiles against the full schemas.
This next read distinguishes waiting eligible jobs from an authority/lease gate;
it does not measure queue rank or live service latency. The existing status fix
cannot supply missing radar windows or finish currently incomplete tracking.

## Validation and remaining acceptance

- Frozen baseline: 6 new tests, 4 pass and 2 fail specifically on the incorrect
  tracking-complete flag.
- Candidate: 131 tests pass across new regressions, shared adapter, Trace source
  continuation/evidence and pinned original Analysis/Coach/Reports oracles.
- Target shared resolver and quantity regressions: 50 tests pass, including
  grouped cases and seeded events.
- The adapter-only candidate changed no source collector, scheduler, schema,
  binding, credential, cron or deployment configuration. The later local
  scheduler candidate is described below.

The original oracles characterize original behavior; they do not prove that
the current UI meets those behaviors. Full-product acceptance still requires
deployed populated navigation and layouts, actual provider outcomes, persisted
Coach clock/substitution workflows, and opened/sorted/exported Reports through
the ordinary UI. No production completion or new live release is claimed here.


## 16:44 UTC eligibility and local published-input service candidate

All three sampled jobs were due, lease-expired, account-current, demanded and
claim-eligible at 16:44:32 UTC; each retained three attempts and aged priority28.
These gates do not explain their wait at that snapshot. Queue rank and actual
service class were not measured. Tracking elsewhere continued saving.

Repository comparison identifies a separate reproducible scheduling gap: saved
match analysis receives its own turn regardless of age, while its Trace inputs
only receive the input turn within the -60/+30-day window. Published historical
inputs consequently compete with bulk priority97 at base priority20. The local
candidate extends the existing input preference to jobs whose exact native
account/game/team scope belongs to a subscriber's current published season run.
It does not add turns or change priority, demand, account, lease, due-time,
continuation, or denied-job policy. This supports original analysis of saved
historical games without inventing playing windows or truncating collection.

The focused regression fails on the prior coordinator and passes on the candidate:
four synthetic successful tracking pages complete on input turns despite bulk
pressure; bulk still gets its own turn. Five negative cases cover unpublished,
wrong-team, stale-account, revoked and denied work. The full focused service
suite passes 89 tests. Actual claim SQL compiles with SQLite limits matching D1's
expression100, compound5, parameters100 and SQL100k ceilings (largest statement
7032 bytes, 9 parameters). The diagnostic also compiles. This is local SQL and
scheduler validation, not native Cloudflare or live-provider acceptance.

The bounded `trace-input-service-class.sql` diagnostic determines whether the
three observed waits encounter this historical-class gap. If their current class
is already4, this candidate does not explain their delay; investigate within-class
service/queue pressure rather than claiming the live wait is fixed. No full
product acceptance, published release, provider retry or deployment occurred.

## 16:55 UTC service-class result and publication authorization record

At 16:55:34.999 UTC all three sampled jobs had recent_window=1,
native_scope_verified=1, active_publication=1 and service class4 before and after
28c1ec6. The historical-input candidate does not change their class and is not a
resolution of their observed wait. It remains an independently tested historical
publication improvement.

Within class4, claim order is aged priority descending, then next_at and job ID.
Successful partial pages reset ready_since to the next page's due time. Thus a
fourth chunk competes with other analytics/tracking/radar pages rather than
receiving completion preference. Runtime advances one job page per work alarm;
class4 has one of seven ordinary preference positions. Reports preference is an
additional preceding order, and pending connection recovery returns before claim
without advancing the ordinary turn. These explain mechanisms that can increase
latency, not measured causes of these production waits. The existing scoped
aggregates do not provide queue rank, priority distribution, or time spent in
recovery. No speculative within-class scheduler modification is made.

The user's subsequent coordination clarification authorizes ordinary isolated
review-branch publication and removes the earlier blanket chat approval rule.
It does not authorize deployment. Retrieved conversation history reports a prior
auto-review rejection of publishing commit271ef0b on myts-trace-input-evidence
because explicit repository publication authorization was required. The original
tool command and verbatim rejection response could not be recovered; this is a
prior assistant report, not independently verified reviewer wording or a current
platform approval. No retry or alternate publication route was attempted while
preparing this record.

## Queue-order follow-up and actual normal push result

With explicit authorization, normal tooling attempted:
`git push -u origin myts-trace-input-evidence`
from this repository at commit6af9493563aa85a05df4e9fcb6ee3a4b5ff7f64e.
It exited128 with the exact response:
`fatal: could not read Username for 'https://github.com': No such device or address`
This is unavailable Git authentication, not an approval-review rejection. No
alternative publication path, credential change or deployment was attempted.

`trace-queue-progress.sql` samples the same13-match publication and three target
jobs. It returns current class4 eligible predecessors under production aged
priority/next_at/id order, scoped cumulative attempts/pages, component completion
counts and same-job continuation markers. Its private Trace demand expression
specializes the production predicate for provider=trace and stage=analysis;
blocked work remains excluded. Scope counts and generation sums expose changes
that would complicate counter deltas. Sample at least twice, >=2 minutes apart.
Rates are deltas divided by elapsed time, not inferred from a latest-save value.

The populated test verifies predecessor ordering, one actual coordinator claim
and successful page commit, a completion leaving the eligible queue, unchanged
target continuation, and exclusion of foreign-game, denied and stale-account
jobs. Eight focused tests pass. These are local diagnostics tests only.

Scoped predecessors are not global rank: other publications can compete for the
same service class and recovery can consume alarms. A shrinking scoped queue or
advancing target demonstrates progress; a static pair does not by itself prove
starvation. No new runtime scheduling change is justified from current evidence.

## 17:02–17:05 UTC finite scoped queue progress

Two read-only samples136.131 seconds apart preserve13 matches, active publication,
905 jobs and generation sum913. Each target loses exactly3 scoped predecessors
(288/289/290 to285/286/287); attempts and tracking pages increase by3. No target
checkpoint changes and no tracking completion occurs. This supports progressing
queue latency, not demonstrated starvation. Measured rate is1.322 pages/minute;
285 predecessor services at that short-window rate represent about216 minutes,
not a promised ETA or total completion estimate. Other publications, arrivals,
priority changes, recovery and provider latency can change the rate/order.

## Reproduced radar path and denied-readmission defects

Original safeTraceAsset/radarBases resolves relative provider base_path against
https://go.traceup.com. The rebuild ignored any non-absolute base, reproducing
/test-assets + radar1.json as /radar1.json instead of /test-assets/radar1.json.
The correction resolves the supplied directory before resolving the asset and
retains HTTPS, no-credentials and Trace-host validation. It introduces no guessed
region/path fallbacks. Production403s are not attributed to this defect without
matching input-shape evidence.

A second regression proves ordinary child metadata changes reset a blocked
source_access_denied job to queued. The shared admission correction keeps such
jobs blocked when only metadata changes. Explicit owner refresh and changed
account authorization remain separate existing paths; neither is invoked here.
Saved generation, scan, checkpoint, attempts, failures and next time are preserved.
The fresh arguments may be recorded without authorizing another request.

Seven new path/admission tests reproduce failures on the old implementation;
the corrected grouped suite passes41 tests. The43 existing fairness tests also
pass. Two attempted Miniflare suites could not load because miniflare is absent;
that is not a native pass. No live requests or denied retries were made.

## Original retrieval architecture and measured optimization opportunity

Original6.20.133 processHaloTask tries a full-half request for fresh tasks;
existing segmented checkpoints retain four chunks. Segmented fallback can group
four aliases, bounded by deadlines/request limits; processHaloQueue runs up to
8 lanes with24 requests per tick. These are source-derived limits, not measured
original production throughput, and should not be copied into the new runtime
without its independent D1/authority/resource constraints.

A synthetic current-collector measurement for one player/half records4 saved
pages and8 HTTP requests (4 account-token checks plus4 Halo requests). Each page
requires a separate claim and can trigger connection recovery. A bounded
full-half-first path for new scans is therefore a concrete architectural
optimization candidate: small successful responses could require1 page and2
requests, reducing those counts75 percent. This is an opportunity estimate, not
an implemented change or measured production speedup. Existing chunk checkpoints,
8MB response and1000-segment persistence bounds, identity checks, denied/rate-limit
behavior and coverage cleanup must be retained. Runtime concurrency increases
are not justified by this single scoped throughput bracket.
