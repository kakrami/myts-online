# Progressive publication during source backfill

## Observed failure

On 2026-10-13 at 05:19–05:25 UTC, production 7.2.8 had two due, unleased, error-free connection reconciliation jobs at stored priority 20. GotSport's root input/reconciled revisions were 346/9 (saved pass 337, boundaries); Trace's were 401/136 (saved pass 401, boundaries). TeamSnap was settled at 6188/6188. Those two inputs remained unchanged for over six minutes while ordinary source work advanced. The current season's published revision remained 162 while input advanced to 443, with no match analysis published.

The existing evidence gate correctly withheld season projection while these prerequisite roots were dirty. Their jobs competed with older bulk source jobs at the same priority. Projection priority 100 could not help a job that could not yet be admitted. Recent Trace parent games had useful priority, but their already-admitted radar/tracking/analytics children were stored at 20 behind history. Two radar HTTP 403 failures were independently legitimate access denials; they are not bypassed or retried by this change.

## Bounded scheduling change

The existing foreground Reports/ordinary alternation remains first in claim ordering. Ordinary preferences rotate durably through three classes:

1. Due dirty connection prerequisites, once 60 seconds have elapsed since their durable last reconciliation (or creation for a new root).
2. Local season publication, analysis catalogs and current match analysis; existing Trace derived jobs whose exact provider/account/native event/team scope and saved provider event date establish the current window (60 days past through 30 days future).
3. All other ordinary work, including history and recurring source discovery.

All classes use the same eligible claim query and retain account authorization, active demand, lifecycle, generation, next-at and lease checks. The selected class is a preference, never new permission. If it has no eligible work, the same claim falls back to ordinary priority/aging order without idling. Saved priorities, checkpoints and job IDs do not change. Current Trace classification uses stored provider evidence, not a reported-date argument hint; imported-only evidence cannot claim the provider-derived preference.

The Durable Object stores the next modulo-three preference before claiming, like its existing report turn. A lost reply can lose one opportunity while preserving the recovery alarm; restart resumes the persisted sequence. Recovery-only invocations do not consume a turn. Combining the report alternation and modulo-three rotation visits all ordinary classes even with continuously available reports. Per-job due times and failures still apply.

A root stays in the prerequisite class throughout its overdue pass because its age is based on the root's durable last reconciliation, not the page's ready timestamp. Finishing reconciliation immediately removes the dirty-root preference. The 60-second preference interval coalesces repeated source changes; it does not prohibit normal existing service of a younger root when no preferred work outranks it.

## Consistency boundary

No source write, trigger, root input revision, materializer cursor, season evidence gate, projection commit fence or analysis quantity policy is relaxed. Tracking/stat/radar writes already dirty the affected season rather than the connection root; member/event/identity changes still require root reconciliation. Behind-cursor edits still require the existing catch-up pass. The repair guarantees service opportunities, not a stable snapshot from a source that continuously changes relevant identity/date evidence. It does not wait for all source children to complete before publishing saved partial analysis.

## Evidence

The scoped fixture reproduces both live root revision/checkpoint shapes, runs the actual application dispatcher/materializer/projector/analysis, adds sustained high-priority source arrivals, introduces a behind-cursor correction, and requires partial seven-player analysis plus report and bulk progress before the backlog drains. Exact terminal counts, runtime fingerprints, native statement/depth proof and retained initial fixture failures are recorded in the final release receipt. Fixture clock advancement is not a production wall-time benchmark.

Existing Reports foreground-service compatibility remains covered separately. This release is schema-unchanged and contains no part of the separately developed team-local game association migration.

Bulk ordering within its class retains existing priority and aging. A finite-high-priority-drain test covers old history continuation; the sustained priority97 stress case is not a strict priority20-history latency guarantee.
