# Change-driven connection reconciliation

## Observed behavior and reproduced mechanism

Version 7.2.16 restored successful projection commits after the expired-bridge failure. Subsequent live snapshots showed repeated replacement runs while the season input advanced and a TeamSnap root was still reconciling. Successful commits and zero failures distinguish this observation from the prior rolled-back page. A later live bracket showed both season input and source_revision increasing while the same TeamSnap events pass advanced. source_revision also counts derived-only writes, so this mixed activity does not isolate each input increment to reconciliation. The local defect below is separately established and does not assume an endless live loop.

On the exact deployed source, a production coordinator and collector fixture completed two explicitly requested reconciliation passes over 25 events and 50 attendance rows. Both passes held root input and passRevision at 76 and completed normally. Every source row stayed byte-identical. On the unchanged second pass, canonical resolution revisions increased from a sum of 25 to 50, and all five season inputs increased, while source_revision remained zero. Excluding the artificial canonical revision changes, canonical evidence, source receipts, roster evidence, attachments and memberships were identical. An independent 24-event fixture reproduced the same false invalidation.

The ordinary event batch added previous and current seasons to its dirty set unconditionally and rewrote every allowed canonical row with revision+1. The single-event fallback did the same. The dated-roster branch dirtied a season even when its historical snapshot write intentionally retained the existing row. These writes do not dirty the root itself. Thus a finite reconciliation pass can repeatedly invalidate a concurrently queued projection without a new provider fact or an infinite root loop.

## Correction boundary

The intended repair compares complete proposed materialized meaning with existing rows for the bounded page. Relevant meaning includes canonical season, state, day, timestamps, basis and evidence; per-source receipt hash and generation; connection-season and attachment entitlement; roster membership and certainty, name, jersey, position, validity, precedence timestamp, and insertions/removals. Comparing only dates or source-event hashes would miss real roster changes. A SQLite changes() count or a global clock cannot replace these exact comparisons.

Only meaningful canonical changes advance their revision. Only seasons whose materialized result changes receive new projection input. Root, account, timezone, canonical-revision and source/pass fences remain in the committing transaction. Behind-cursor source changes still trigger the ordinary second pass. No schema, provider identity policy, authority relaxation, scheduler workaround, or manual production reset is part of this repair.

## Verification status

The exact deployed baseline's causal probe used Node SQLite with full installation and epoch wrapping plus actual JobCoordinator/collectApplicationJob paths. Projection jobs were parked solely to isolate the root pass. It establishes false invalidation under unchanged data, not spontaneous recurring admission or production latency.

The candidate focused source suite passes 39 cases, including both full unchanged batch/fallback traversals, historical dated-roster suppression, genuine date/season/hash/generation/roster/membership changes, and guarded no-op races. Replaying the original two-pass coordinator probe now keeps canonical revision sum at 25 and every season input unchanged, with identical saved source and materialized rows.

The first draft comparison query had seven compound-select terms. It was factored into the existing five-term limit without dropping old/new season identifiers. Captured-query compilation passes expression depth 100, compound terms 5, parameters 100 and SQL length 100,000: 61 queries, 37 unique shapes, maximum 8,108 SQL bytes and eight parameters. This is a SQLite constrained-compilation proof, not a native runtime receipt.

Two early native fixture setup failures and an interrupted unentitled-fixture run are retained separately, not counted as passes. Source-job admission correctly rejected missing synthetic collection entitlement. The final fixture seeds the legitimate account/team entitlement, admits source demands through the production coordinator with their exact arguments, and seeds only their prior completed source receipts and future due times. Root passes use coordinator refresh; there are no manually forced reconciled markers.

The native gate passed on exact runtime commit `ce9b3c65fd2cec4ab770518fee98158a748f4ad7`, with the exported production SyncRuntime, native D1, full schema 788 and installation inspection plus epoch wrappers sharing the same 50-statement budget. It executed 258 host-invoked alarms and five wakes in 176.4 seconds, with the real 500 ms continuation delay and no virtual clock.

Initial publication produced all 25 events, all 50 source attendance rows, 11 season-player rows, and five usable published pointers. The 24+1 event-page boundary was exercised. The complete unchanged second pass preserved every canonical and season revision, pointer, published row, source row, roster row and saved owner title/bookmark/Coach state. Canonical revision sum remained 25 and root input/reconciled remained 77/77.

A synthetic date edit within the 2022 season and a dated-member edit in 2024, introduced behind the event cursor, advanced root input to 79. The normal finish fence detected the changed pass, replayed the required history, and settled at 79/79. Only those affected seasons, 2022 and 2024, advanced input and republished; canonical revision sum became 26. This native case is not a cross-season game relocation. Other season pointers and rows stayed unchanged. The separate aliased fallback and dated-roster scenario also completed an exact no-op repeat. Production published-game and owner-state helpers remained usable after each stage. Source observations were never truncated.

The maximum runtime invocation was 42 of 50 statements, including installation inspection and epoch overhead. Maximum transaction size was 18 statements and 22,722 parameter bytes; checkpoint 251 bytes. The twelve measured comparison queries read at most 3,962 native rows and returned at most 1,146 bytes per query, with maximum 5,048 SQL bytes and 15,493 parameter bytes. These are bounded synthetic measurements, not a hosted latency or larger-history cost promise. Available native metadata totals are 4,395 statements, 613,639 rows read and 5,512 written, with zero failed-statement metadata gaps, diagnostics, or foreign-key errors.

All 185 raw-byte source paths, including the binary font, match before and after. Candidate map fingerprint is `6d520c07d8905dc69cafe8e15d275673d63767f85d18b07bd94e06f94f30609c`. The full maps, scope and limits are retained in `change-driven-reconciliation-native-map.json`. Regenerating the release manifest changes only that generated map entry; executed runtime bytes stay fixed.

The test uses host-invoked actual alarm methods, not real Cloudflare alarm delivery. Completed source receipts and genuine edited source rows are synthetic fixture setup; the reconciliation collector, coordinator, publication and authority paths execute production code. The fixture does not claim useful Trace quantities or actual provider collection. The previous unchanged analysis receipts remain separately scoped; live published analysis is still required.

The final required-only archive carries the runtime closure and sanitized evidence documents. Tests, local/native logs, dependency directories and private live QA data are excluded. Final verification compares Git, stage, ZIP and a fresh extracted release closure.

## Live acceptance

An unchanged reconciliation pass must stop manufacturing season and canonical revisions. A genuine source or owner change must still invalidate the affected accepted result and publish a coherent replacement. The already published pointer and owner state remain available while normal replacement work completes. Actual useful Trace analysis remains a separate live outcome to verify after publication.
