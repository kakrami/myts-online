# Full-half-first Trace retrieval review

Parent review: 6fe7f523af9e448c426a9442431215075cef13db.
Original reference: 50e1be224806ff7e7c439d26e15fd0421e3f6f01, processHaloTask and
traceHaloFull. The original tries full-half retrieval for fresh tasks and preserves
segmented continuations. The candidate follows that behavior without adopting
its eight concurrent lanes, automatic denied retries or guessed radar paths.

## Implementation

Only an empty tracking checkpoint starts full-half retrieval. A saved full-half
checkpoint uses protocol trace-tracking-full-v1, a content digest and an offset.
Existing chunk/chunk_pages/offset checkpoints continue unchanged, including the
three production jobs at chunk3. No existing checkpoints or job rows are migrated.

A response remains limited to8,000,000 bytes and the existing transport request,
timeout and invocation limits. Each commit saves at most4 records, each containing
at most1,000 intervals and still subject to the60,000-byte record guard. Additional
intervals use durable digest/offset paging. A changed response restarts paging;
only terminal replacement removes old rows for that exact account/team/game/GID/half.
A fresh smaller/full response removes obsolete chunk rows only at completion.

Oversized or unsupported full responses save a segmented checkpoint before another
request is attempted on a later claim. Denial, authentication, rate-limit, server,
network and invocation-budget errors do not trigger this fallback. Existing account,
demand, source-proof and lease fences remain in the dispatcher/coordinator.

Native fallback testing reproduced an audit bug: the stream reader counted bytes
beyond its limit, exceeding the audit's own8MB bound and preventing a fallback
checkpoint from committing. Audit byte counts now cap at the bytes inspected under
the read bound; record_too_large still rejects and cancels the response. Successful
response counts are unchanged. The audit bound is not relaxed.

## Measured local results

The locked README installation route, npm ci, supplied Miniflare through Wrangler
4.149.0. No package, lockfile or deployed configuration changed.

| Synthetic intervals | Previous requests / commits | Candidate requests / commits |
| --- | --- | --- |
| 120 | 8 / 4 | 2 / 1 |
| 2,500 | 8 / 4 | 2 / 1 |
| 10,000 | 24 / 12 | 6 / 3 |
| Oversized full response, then120 intervals segmented | 8 / 4 | 10 / 5 |

Request savings are75% in the three successful comparisons. Oversized fallback
costs one extra2-request probe/commit. These are synthetic counts, not production
throughput, wall latency or an ETA for the existing queue.

The focused tests exercise actual Workerd/D1, application collector, coordinator,
source proof and persistence. Maximum25 submitted statements fits the48-statement
BudgetDB fixture; its deployment-installation checks are not included. Current
configuration remains30,000ms CPU. Native near-limit JSON (7.8MB) completes, and a
6.39MB fragmented ring with120,000 intervals saves only4,000 in four bounded rows
and remains partial at offset4,000. Observed maximum page wall time233ms is local
fixture wall time, NOT a measurement of production Worker CPU. Node CPU comparisons
and native per-case counters are in trace-full-half-local-receipt.json.

Validation commands/results:

- Combined focused full-half, native full-half, native game continuation, native
  source authority, tracking availability and radar-path suite:30 pass,0 fail.
- Extended native dense-response case:1 pass,0 fail (the same native test expanded,
  not an additional independent total).
- npm run build: release check and Wrangler deployment dry run pass. Nothing deployed.
- Previously blocked tests/sync-workflow.test.js and tests/application-sync.test.js
  now run:37 tests,31 pass,6 fail, reproduced on a second run. Three failures report
  `table team_projection_runs has 7 columns but 6 values were supplied`; three are
  workflow timeouts. Direct failing analysis-catalog and typed-source-projection
  cases also fail on unchanged baseline9175ec5 with the identical SQL error.
  The remaining failures are unresolved, not claimed to be caused or fixed here.

## Required before production acceptance

Review/triage the six broader-suite failures and authorize an exact release separately.
No schema import, reset, credential change, cron change, denied retry or deployment
is part of this review. Preserve current configuration, namespace and data.

After authorized deployment, observe ordinary eligible work with the app closed:
new empty-checkpoint scans should finish or preserve bounded full-half/fallback
continuations; old chunk scans must continue without restart. Compare actual
requests, bytes, saved intervals, completion rate, D1 reads/writes and Worker CPU.
Confirm denied job attempts remain unchanged and the current publication survives.
Do not infer real full-half availability from synthetic responses. Missing radar
windows still mean unknown minutes. Original UI/Coach/Reports live acceptance and
full provider completion remain separate unfinished gates.
