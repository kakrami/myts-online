# Projection bridge expiry and failure diagnostics

## Observed failure and causal reproduction

After version 7.2.15 deployed, live projection claims advanced attempts but did not save a page or record a failure. The job stayed in its events phase with an empty cursor. Matched alarms completed successfully in approximately six to seven seconds, before their 45-second leases expired. The installed version and alarm routing were verified. Read-only aggregate evidence found one relevant own-team bridge whose expiry preceded those alarms. The existing telemetry did not expose the original rejected statement, so it alone does not establish which live receipt required that bridge.

A synthetic fixture reproduces the exact state through the exported production SyncRuntime, full schema-788 installation inspection, and epoch wrapper. An expired bridge that is not needed by either direct source connection is rejected by the candidate loader, but the receipt constructor still uses its deadline. The first events transaction fails the final publication precondition (`expected_input=actual_input`). The budget has already reserved 47 of 50 statements for the attempted work. The five-statement failure-recording batch cannot fit, leaving the claimed job running with unchanged checkpoint, page count, failure count and error fields. The outer alarm catches that second `invocation_budget` error and resolves normally. The otherwise identical no-expired-link control publishes 24 matched games.

This establishes a specific software defect and a matching live prerequisite. It does not fabricate a captured production SQL error or assume an expired bridge remains valid authority.

## Bounded correction

Receipt expiry follows only bridges admitted by the existing verified own-team alias validator. Those aliases may be needed to acquire candidate observations or to establish the absence of competitors, so every admitted alias remains expiry-fenced. Rejected, expired or otherwise unused raw link rows do not impose a deadline on independently entitled direct-root evidence.

Raw link scope remains part of the exact acquisition and structural checks. Required bridge-backed membership still needs current valid evidence at commit and publication. Native observations, canonical source identities, account/root/owner checks, stored decisions, and the current published pointer are not rewritten by this change.

Failure-only diagnostics preserve the original collection or commit rejection when failure recording itself throws. The emitted fields contain only static allowlisted phase/reason labels and bounded numeric budget, attempt, generation and timing counters. They exclude identifiers, SQL, error messages/stacks, arguments, checkpoints, source payloads, credentials and URLs. Logging failures cannot change execution or replace the original exception. Successful invocations do not emit this diagnostic.

No schema, installation plan, provider collector, scheduler ordering, hard budget or deployment binding changes are required. Existing queued/running work resumes under its existing leases and checkpoints.

## Verification record

The diagnostic scope passed eight focused cases and an 89-case aggregate covering full production projection coordination, cross-season batches and constrained SQLite query compilation. The compilation receipt contains 919 queries, 315 unique shapes, at most 25,517 SQL bytes and 19 bindings. The retained baseline reproduction and no-expired-link control use Node SQLite with the actual exported worker runtime, not a native Cloudflare alarm.

The previous version's control-refresh native fixture used the epoch wrapper and full installed schema but constructed a coordinator directly for each measured call. Its reported per-call maximum did not include the production runtime's two installation-inspection reads. This release's targeted native fixture includes that inspection in the same 50-statement budget; its terminal results are recorded below when available.

The frozen combined candidate passed 13 focused cases with zero skips: the eight diagnostic cases and five expiry cases. Direct-root publication preserves 24 accepted pairs and 48 members despite an unused expired bridge. A genuinely required valid bridge admits its canonical peer; an expired required bridge admits no alias, publishes the two independently entitled games separately, and excludes the Live peer. Normal proof renewal on that same fixture restores the eligible three-member group. Both explicit expiry and the six-hour observation boundary crossing between acquisition and commit reject atomically.

An accidentally started broad default test glob finished unsuccessfully: 2,089 tests, 1,628 passes, 44 failures and 417 skips. Its dependency/fixture errors include unavailable Miniflare and duplicate-table setup; the failed aggregate is retained and is not treated as a pass or as fully diagnosed. No runtime was changed to accommodate it. The exact focused and native scopes remain separately identified.

The first native attempt passed the expired-link baseline reproduction, corrected direct-root publication, required-peer exclusion, normal renewal and final atomic expiry rejection. Its terminal assertion failed because the actual D1 wrapper appends an extended SQLite error code that the diagnostic allowlist did not yet recognize. The safe log said `unknown`; it exposed no raw error. That failed receipt is retained. A narrowly recognized static wrapper form and its paired privacy regression were required before rerunning the gate. The held one-pair transaction reserved 46 statements; the 24-pair baseline reserved 47. Both leave fewer than the five needed to record the failure.

The final native gate passed on runtime commit `effdcb68f75bda1d4f3d18b5de11076694bd3e3f`. It uses native D1 with the actual exported worker SyncRuntime.alarm, full schema 788, and production installation inspection plus epoch writes charged to the same invocation. The fixture has 100 relevant source jobs and the reproduced 71,789-byte control array. Its bounded main dataset is 24 logical matched games and 48 source members, rather than a repeated full-history throughput benchmark.

Across 64 host-invoked alarm calls in 77.6 seconds, the frozen 7.2.15 baseline reproduced the masked CHECK failure at 47 submitted/reserved statements. The candidate then published 24 games, 48 source members and 24 accepted pairs while preserving native rows and owner state. The required-expired-peer case published only the two entitled direct games; normal bridge renewal followed by real connection reconciliation restored one game with three members and one accepted pair. Holding a genuinely admitted bridge across its real wall-clock and SQL-clock expiry rejected atomically at 46 submitted/reserved statements. Logs preserved the original commit/precondition reason through the failure-record invocation_budget and outer runtime catch.

Successful invocations used at most 48 SQL statements, including installation inspection and epoch overhead. Maximum transaction parameter bytes were 807,976; checkpoint 944 bytes; stored fence 8,007 bytes. Existing 50-statement, 2 MB transaction, 8 KiB checkpoint and 16 KiB receipt caps are unchanged. Failed batches expose no D1 row metadata, so their statement counts are submitted/reserved counts, not an independently observed execution count. The separate renewal wake's two inspection reads are labeled outside the alarm count.

The prior published pointer is deliberately fixture-seeded. Replaying the candidate after the baseline uses an explicitly documented test-only lease reset, so that transition is not claimed as a native proof of automatic expired-lease recovery. No such reset is required or proposed for production. The fixture uses actual alarm method calls and real clocks but does not simulate delivery by Cloudflare's alarm service.

Both 185-file raw-byte source maps are identical before and after. Candidate fingerprint is `1c75f310a82318446abcc8a16400080a1816827c10797278364d4e05bde0c336`; the unchanged binary font is included as raw bytes. The maps and measured limits are in `projection-bridge-expiry-native-map.json`. Regenerating the release manifest changes that generated entry only. Final archive verification checks the exact source, staged ZIP and fresh extraction, with no private live records or native logs packaged.

## Remaining live acceptance

The existing job must commit events pages, retain a stable hidden run, publish its replacement pointer, and allow useful saved Trace analysis to become visible. Synthetic native publication and authority checks do not establish hosted latency or full-product completion. Required expired authorization must remain unavailable until the normal source workflow supplies valid proof.
