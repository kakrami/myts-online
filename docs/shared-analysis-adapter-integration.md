# Shared analysis adapter integration receipt

Scope: local candidate integration only. No deployment or real-provider acceptance is claimed by this receipt. The original 6.20.133 engine remains a QA oracle; production reads one published shared interpretation.

## Implemented boundary

- One bounded event snapshot and one resolver call, followed by immutable player facts and an atomic accepted-run pointer. No two-player allocation engine remains.
- Scoped publication signature includes accepted season, canonical event/source revisions, account generation, attachment/root/membership generations, identities/track assignments, correction and lineup layers, labels, and `shared-match/1.0.2/adapter-2`. Changes to another team do not invalidate this event.
- Complete-input caps are checked rather than publishing a truncated calculation: 128 canonical participants, 4,096 intervals, 1,500 native members, 2,048 tracking rows, 1,536 summary rows, 384 heatmaps, 7 MB source-payload materialization, and 8 MB serialized snapshot. Resolver sweep endpoints have their own bound.
- Per-player evidence/spatial fields remain within 16 KB, facts within a bounded single JSON insert, and combined lineup/highlight summary within 10.5 KB. Summary evidence leaves room for rejected-input diagnostics.
- Rejected deterministic input is terminal for the same signature. Prior accepted facts, signature, version and evidence remain separate from the current rejection. Reset to the accepted signature clears obsolete review state once. First rejection publishes no effective players.
- Relocation, missing accepted membership and lifecycle removal fence or retire old work. Bounded cleanup drains abandoned rows on continuation/reuse without recalculating accepted facts.
- `null`, explicit zero, reported/manual/inferred/estimated quantities, anonymous keeper reservations and lower-bound role accounting are preserved. Native goals can prove participation without inventing minutes. Restricted payloads cannot become published facts.
- Saved local Trace evidence is analyzable while login is disconnected, under active local connection intent. Imported facts do not grant upstream fetch authority. Interactive and legacy tracking/analytics jobs have provider-backed native scope checks before fetch and at commit; fixed roots use current resolved/accepted season evidence, not UTC date substrings.
- Leaders, source-only goal timeline and both half layouts derive from this snapshot. Unknown scorer/time/order/running-score values stay unknown; timeline truncation is explicit.

## Owner placement and correction behavior

The editor displays published geometry and complete published player labels independently of the paged roster. It persists only saved owner assignments plus touched/swapped players. No-op Save sends no mutation. Unassigned eligible roster players can be selected through bounded pages, with revision/context/role/close/reply fences.

Unavailable saved owner rows remain visible and locked. The real service permits exact unchanged saved rows while rejecting new or changed unavailable identities, and repeats that check in its replacement transaction. Format changes preserve substitutes and cannot bypass protected unavailable field placements.

When actual half clocks are unavailable, published presentation may show only explicit saved owner slots, labeled `Saved lineup · Match clock unavailable`. It does not choose additional roster players or change resolver duration, role quantities or capacity. Missing current identities are marked unavailable; previously accepted saved labels are preserved. Read DTOs carry embedded assigned-player labels so Overview does not depend on the first roster page.

An explicit half slot supersedes a saved original whole-match pitch anchor only for that half. Resetting the lineup reveals the underlying original anchors.

Explicit owner format precedence is shared by resolver and DTO: newest format choice wins; equal timestamps prefer the lineup control. Neither saved layer is erased. Match corrections store internal `_format_chosen_at` metadata in existing fields JSON. Partial duration edits/reset preserve that clock while ordinary `updated_at` advances. Legacy rows fall back to their old `updated_at`, captured before the first unrelated mutation. Clients cannot set/reset the metadata, and public correction responses omit it. A full lineup Save explicitly reconfirms its visible effective format. Reset reveals the other saved layer.

## Local test receipts

- `/tmp/myts-analysis-final-handoff.tap`: 75 tests, zero failures/skips, covering adapter, collection proof, real JSDOM lineup controller and assembled Overview rendering. This includes explicit clock-free manual layouts and assigned labels beyond the roster page.
- `/tmp/myts-analysis-scoped-final.tap`: earlier 67-test component receipt, before the final presentation fallback additions.
- `/tmp/myts-analysis-format-metadata.tap`: 27 tests, zero failures/skips, including the independent reviewer's two actual-service partial-format-decision regressions.
- `/tmp/myts-analysis-proof-resolver.tap`: 42 tests, zero failures/skips, resolver/regressions plus collection proof at that recorded snapshot.
- `/tmp/myts-analysis-source-current.tap`: 11 production Trace collector tests, zero failures/skips, including synthetic native-shape collector → saved observations → resolver cases. This is not a real account/provider receipt.

## Native progression, including failures

These logs are intentionally separate:

1. `/tmp/myts-analysis-native-capacity.tap`: failed fixture. The 4,096 submitted intervals plus separate window endpoints exceeded the resolver sweep-endpoint cap. Analysis correctly terminated in human review. The fixture was corrected to share the final endpoint with the real window end.
2. `/tmp/myts-analysis-native-capacity-after.tap`: real integration defect. Resolver coverage `bounded` leaked into the sync collector contract, which rejected it. The projector now returns the persisted analysis state at that boundary; pure resolver coverage remains inside evidence. Adapter tests assert the boundary value.
3. `/tmp/myts-analysis-native-capacity-final.tap`: corrected unprofiled native PASS 1/1, backend fingerprint `2d0611400accbe94c6b2bdee8a3f5d2df2f351dc7f18e96b0f452929ec3cf98a`.
4. `/tmp/myts-analysis-native-profiled.tap`: profiled native PASS 1/1, backend fingerprint `b7b0ab58e1ef1ea91929d246edfae6d07ad2aaabe2314f6c07f84481c8bffdfa`.

The last fixture uses production collection/runtime modules in a test entry, with native D1, durable-object alarms, a disconnected account, imported saved facts, and no manual override/browser runner. It invokes ordinary analysis catalog admission, then waits for alarms. It is synthetic: 128 players, 4,096 intervals, 6,718,906 source-payload bytes. All 128 facts publish, and no upstream Trace jobs are created.

Observed profiled values:

| Measure | Receipt |
| --- | ---: |
| Catalog admission statements | 6 |
| Catalog alarm statements / wall | 12 / 19 ms |
| Match alarm statements / wall | 38 of 50 / 1,334 ms |
| Match rows read / written | 25,136 / 398 |
| End-to-end post-seed wall | 1,478 ms |
| Published match evidence | 3,617 bytes |
| Worker heap before | 3,567,748 bytes used |
| Worker heap after / maximum sampled | 27,730,548 bytes used |
| Allocated heap at maximum sample | 45,826,048 bytes |
| V8 profile span | 1,519,777 microseconds |
| Idle profile samples | 96,931 microseconds |

Heap polling requested 20 ms but obtained only three samples because Worker work is synchronous. This is a sampled maximum, not a rigorous peak-memory measurement. CPU profile samples include runtime work and garbage collection, not just resolver code; wall time is not billed CPU. This component receipt does not prove deployment limits, actual provider availability, physical phone gestures, or complete original-app parity.

## Final scoped freeze

Owned runtime paths were frozen after the 75-test handoff at 2026-10-12 19:16 UTC. Their exact SHA-256 list is `/tmp/myts-analysis-handoff-sha256.txt`. The clock-free manual presentation fallback and embedded read labels landed after the native profile capture; the recorded native fingerprint is retained rather than represented as the final assembled tree. Parent integration owns the final assembled regression/native receipt.
