# Progressive root service proof

Verified on the combined 7.2.9 candidate on 2026-10-13. This is a synthetic saved-data and scheduler proof, not a claim about live provider authorization or production completion.

## Results

- Pure SQLite suite: 39/39 passed with the real coordinator and runtime.
- Native Workerd/D1 suite: 1/1 passed in 111.95 seconds with full fresh installation inspection, writer-epoch wrapping, and a restarted runtime on every invocation.
- Native completion: 370 invocations, including 146 real `ApplicationSyncService.recoverLocalDemand` passes.
- Trace and GotSport roots each completed 30 actual materializer pages. Trace reconciled at invocation 155 and GotSport at 305.
- Actual projection and match analysis published seven saved player facts in `incomplete` state while 442 priority-97 jobs remained queued. The missing player's minutes stayed null.
- 137 ordinary Trace pages progressed. A real XLSX export became ready before the source backlog drained.
- One behind-cursor correction forced a full catch-up pass and appeared in the published event.
- A radar job marked blocked with HTTP 403 never reached collection or got retried.

The roots begin with the live-shaped revision gaps GotSport 346/9 with pass revision 337, and Trace 401/136 with pass revision 401. The season begins pending at input 443 / published 162. Initial backfill contains 128 priority-97 jobs plus one multi-page job; another priority-97 job arrives before every invocation. Inputs remain stable except for the single intentional behind-cursor correction. This does not promise publication under endless relevant input changes.

## Native bounds and source identity

Maximum complete invocation: 44 of 50 SQL statements. Component maxima: connection 29, projection 29, match analysis 44, XLSX 19. Maximum captured SQL was 23,200 bytes; maximum captured parameter payload was 21,983 bytes. Native SQL actually executed, including installation guards, lease predicates, public-history CTE expansion, and commit fences.

The before/after runtime map covered 164 files and stayed identical:

`820844d33c9bf838dabcfa9abc9cfe1cf25edb486ab6c19119ac7a05b5680fe4`

Scheduler source SHA-256:

- coordinator: `dd43f0cc66f88d38bda4cb173f4afb88841ced1166d65b391389b8e404262b09`
- runtime: `a7251c1b3be6b7954949c5c4179d89dbe5554e44cf8d3c5c51df5716b11449e3`
- application sync service: `475661728a506058945a9cdf59d66cb3943ca67b212213871fd4de3bf8ef23ba`

The successful native receipt is `tmp/progressive-root-service/native-receipt.json`, SHA-256 `5fc833eb721baea72e8ad5dfc3da1c730f4db19420fc8d5c51457161fc25bf6a`. It contains the complete source map and every invocation receipt. The native run's claim-specific diagnostic was null because its matcher expected `WITH eligible` before public-history prefix expansion. A post-run, test-only matcher correction recognizes `eligible AS MATERIALIZED`; a separate pure assertion captures the actual 23,200-byte expanded claim. The successful native behavioral/budget receipt was preserved unchanged, and the diagnostic-only native rerun was canceled.

## Coverage boundaries

The native fixture retains previously saved radar observations. Its blocked radar case proves that a denied future job does not prevent saved-data scheduling. A separate pure application-runtime test removes every saved radar observation, retains a reported summary, and publishes shots 4 / shots made 2 while format, duration, field minutes, goalkeeper minutes, and total minutes remain unknown. It does not invent a clock from video metadata.

Additional pure cases cover clean/young roots, exact current-child provider/account/native IDs/date/scope/resource key/provenance, misleading reported dates, root argument mismatches, account revocation, root generation/unlink/lifecycle authority, commit-time root fences, due times, leases, absent service classes, durable-turn lost replies, restarts, and real recovery-only turn preservation. A finite priority-97 arrival test additionally drains the high-priority queue and completes priority-20 historical work.

Provider network collection and durable storage/alarm delivery are synthetic. Root reconciliation, projection, analysis, report encoding, recovery demand, SQL transactions, lease fences, installation inspection, and epoch guards use the production implementations. No production schema, gate, or trigger was changed by these test files.

## Reproduce

- `node --test tests/progressive-root-service.test.mjs`
- With the native test slot exclusively available: `node --test --test-concurrency=1 tests/progressive-root-service.native.mjs`
