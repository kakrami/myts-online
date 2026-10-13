# Native acceptance suite repairs — 2026-10-13

Review follows published candidate `0369054cf760cbb407dbaea2619a8349d6be67a9`
(tree `60cfec72dbf72705eca8643726d7045ca656ce94`). No deployment or production
mutation was performed. The existing installed, lockfile-pinned dependencies
from the README's npm install route were used; package files are unchanged.

## Six original failures, individually resolved

| Original failure | Demonstrated cause | Repair and retained acceptance |
| --- | --- | --- |
| Application discovery/attachment/publication timeout | Stale fixture: configured Reports scheduling queried missing `report_snapshots`; after that repair, publication queried missing `game_bookmarks` | Install canonical Reports, Team Features and Coach schemas in the fixture. Original 151-event traversal, publication, later updates, progress and elapsed-time assertions pass. |
| Scheduled crash-window recovery timeout | Same incomplete application schema; the real scheduler failed during claim, then publication | Same fixture repair. Native missed-wake account and projection recovery assertions pass. |
| Analysis catalog SQL failure | Baseline runtime defect: `buildProjection` inserted six positional values into the current seven-column `team_projection_runs` table | Explicit six-column insert; existing `team_game_version` default remains authoritative. Scope, continuation and recent-match assertions pass. |
| Owner track refresh SQL failure | Same runtime insert defect; once repaired, fixture ingested native inputs after publication and attempted a write while projection was pending | Same insert fix. Fixture now explicitly proves pending writes reject atomically with zero jobs, republishes inputs, then passes all original private source proof/account/generation/budget and rejection assertions. |
| 131 shared-season timeout | Incomplete fixture initially masked a baseline runtime defect: combined public receipt/restart and local projection admission exceeded native D1 expression depth 100 | Separate guarded local projection insert inside the same fenced batch. Exactly 131 jobs, six pages each, 786 pages total, zero failures; exactly five remaining projections admitted by alarm recovery; maximum 28 statements against unchanged limit 48. |
| Fresh typed source projection SQL failure | Same six-value runtime insert defect | Explicit-column insert. Fenced publication and updated-total assertions pass. |

The unchanged baseline `9175ec549e6840ff49aa359a5e92300352e4aac2` reproduces
the catalog and typed-source SQL errors. Its scheduler also reproduces the
fan-out expression-depth failure after supplying the missing fixture schemas.
These are baseline defects, not full-half retrieval regressions. No test
assertions or timeouts were relaxed.

## Authority and SQL depth

Local projection children already have a distinct validated subscriber mode.
Their existing team, season, pending-input, root-evidence and lifecycle predicate
now runs outside the public receipt/restart CTE graph, under the same lease
fence and atomic D1 batch. This costs one additional statement only on a public
page with projection children. The existing budget check counts it before
submission. Public receipt caps, lineage and restart checks are unchanged.

The targeted native public-history suite had a separate stale asset loader:
a comma expression registered three module paths under only the final key.
It now loads each actual module. This exposed an additional expression-depth
failure in the standalone public proof. Balancing the existing published-member
AND predicates fixes compilation without changing any predicate or SQL truth
value. Native coverage explicitly admits a pending local projection, verifies
it creates no public receipt, and verifies insufficient budget creates neither
projection jobs nor child receipts. Its projection fixture now specifies
`recurring:false`, matching production `projectionSpec`.

## Exact final validation

| Command | Result |
| --- | --- |
| `node --test tests/application-sync.test.js tests/sync-workflow.test.js` | 38 passed, 0 failed, 0 skipped; 50.364 s |
| `node --test tests/public-history-coordinator.native.mjs tests/public-history-coordinator.test.mjs tests/team-game-scope.test.mjs` | 26 passed, 0 failed, 0 skipped; 5.773 s |
| `node --test tests/trace-full-half.test.mjs tests/trace-full-half.native.mjs tests/trace-game-continuation.native.mjs tests/shared-analysis-source-proof.native.mjs tests/trace-input-availability.test.mjs tests/trace-asset-path.test.mjs` | 30 passed, 0 failed, 0 skipped; 4.783 s |
| `npm run build` | Release check and Wrangler dry run passed; nothing deployed |

Total: 94 passing tests across these three non-overlapping runs. This is not a
claim that every repository test or original-product live workflow was run.
The 38-case run includes both formerly dependency-blocked suites. The added
fixture claim-compilation test accounts for the increase from 37 to 38.

## Remaining live acceptance

An exact deployment requires separate authorization. Preserve the current D1
binding/data, SYNC namespace, secrets, cron and configuration. No denied provider
job may be retried as part of acceptance.

After authorized deployment, dot/browser coordination must verify:

- Current publication and original UI, Manage Trace, Coach and Reports behavior
  survive actual navigation, reads and authorized user workflows.
- Ordinary eligible new scans demonstrate actual full-half availability, bounded
  persistence and continuation; existing chunk continuations keep their progress.
- Provider request counts/bytes, D1 reads/writes, Worker CPU and completion
  throughput are measured under real payloads and queue load. The synthetic 75%
  request reduction is not a measured production speedup or CPU acceptance.
- Denied radar attempts remain unchanged. Absent radar windows/minutes stay
  unknown; successful tracking retrieval must not invent them.

No further production SELECT is needed to validate these local repairs.
