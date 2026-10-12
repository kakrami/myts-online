# Reserved adapter integration handoff

This isolated batch owns NEW `src/analysis/resolver/*`, NEW resolver tests and NEW documentation only. It imports none of the reserved application files and makes no database/config/version/production changes. Apply the resolver base-to-head diff, or the initial resolver commit plus its isolated correction commit, after the first thirteen-path parity handoff. Lifecycle integration need not overwrite its active checkout.

Known sources: original 6.20.133 `50e1be224806ff7e7c439d26e15fd0421e3f6f01`; pinned production `6326162d923aae5c2f2bfe109dfad6dc3b28d687` / deployed tree `e4128fe70f57304643add840921142690bc18741`; this batch base `a58fced0b04d4d361176a064874988de62bc2255`. The active local lifecycle candidate `3fbc36fe...` and later uncommitted bytes are not assumed identical to that base. Reconcile actual frozen interfaces before integration.

## File ownership and concrete changes

| Reserved owner file | Required integration |
|---|---|
| src/analysis/projector.js | Construct one bounded canonical event input, call resolveMatchAnalysis, stage its player facts, publish under the author's accepted season/revision signature and existing lease/input fence. Replace independent per-player minute/position inference. Preserve native stat attribution/availability checks. |
| src/analysis/reads.js and reads adapter | Consume the published resolver facts and one published lineup; expose provenance/coverage and distinguish null, DNP zero and estimates. Keep complete selected-season aggregates independent of the paged table. Do not run a second minute/position engine. |
| src/analysis/service.js, tracks.js, write-scope.js | Map original correction/reset/lineup gestures to the typed manual layers. Preserve dated canonical track assignments and authorization. Revisions invalidate the scoped published input. No new season/year setup. |
| domain/projector and source adapters | Keep team-level connection intent, dated automatic season materialization, accepted effective-source generation and deliberately restricted source scope. Provide proved own/opponent side, dummy exclusion, event-dated membership and role evidence; current roster/name similarity is not historical identity proof. |
| routes/UI integration | Preserve original controls; format nullable values and explicit estimate/manual states. Consume the same interpretation as Overview/roster/player/report/Coach. Slots and provenance come from the server. |
| coaching/service and report readers | Reuse effective published facts, selected-season/statistical-inclusion scope and permission checks. No browser-only inference or separate capacity calculation. |

Root will not edit these reserved files. The lifecycle author owns the adapter patch; an independent reviewer checks the integrated publication/retirement behavior.

## Input mapping

1. Capture the accepted team/season/event/source/account/attachment generation/revision fence before loading. Put its opaque bounded token/digest in `context.commitSignature`; echo does not validate it. Include canonical input/source revisions. Do not pass credentials or entire raw provider payloads.
2. Use actual source half play windows with explicit verified FullGameVideo origins. Do not split match duration into invented 25-minute halves or apply event-display snapping. Missing windows remain missing. Component completeness is separate from format/window evidence.
3. Load the complete bounded match participant/observation snapshot. The pinned projector pages two players; capacity allocation cannot run independently on each two-player page. Collect/stage the complete bounded input under one signature, resolve once, then page/stage the immutable result with the same run/input token. A changed signature restarts/obsoletes that run instead of combining pages.
4. Preserve canonical identity uniqueness and union multiple proved source tracks for a person. Imported observations obey the same own-side, account/event/team, dated roster and track-mapping proof. Rejected/unassigned channels remain diagnostics rather than new identities.
5. Convert existing minutes/field_minutes/gk_minutes to seconds only when present, including zero. Map original slot_x/slot_y together to manual slotX/slotY (0..100); these are pitch anchors, not ordinal formation slots. Keep an explicit ordinal slot only when that is the stored intent, and do not pass both intents together. Map match corrections to `manual.match`; map half assignments to `manual.halves`. Map season position only to `season.position`, never spread season defaults over match evidence. A null/blank reset removes that layer's fact. Map persisted booleans 0/1 explicitly to false/true.
6. Map deliberate half field/GK roles as role evidence; a position label alone is not a timed keeper assignment. Map imported/provider total quantities to `reported` only when supported and availability permits; source event anchors may prove participation but must not fabricate continuous measured intervals. Pass those proved participation facts separately.
7. A native keeper channel with unresolved person may reserve anonymous keeper capacity. Set `playerId:null`; its role must be independently verified. Only a unique explicit full-half keeper decision may explain that channel. Never assign it to a season default or spatially guessed person.
8. Format: explicit owner format first, actual reported format second, verified inference third. The original supplied history is a verified 7-or-9 family; retain its population >=17 →9 / declared9 →9 / otherwise7 rule only with that family and both-sided population proof. Raw named-player count or undocumented small-pitch geometry cannot force format.
9. Preserve full source provenance alongside sanitized source IDs. The resolver's source refs identify supplied evidence; account/generation/attachment authority remains in the adapter's fenced snapshot.

## Output mapping and publication

| Resolver fact/state | Existing published field policy |
|---|---|
| minutes, fieldMinutes, gkMinutes.value | Existing minutes/field_minutes/gk_minutes; null stays null. Round only display/persisted display precision after all accounting. |
| appearance, started.value | Existing nullable integer/boolean fact; true/false map to 1/0 explicitly. |
| position.value | Existing position; mixed positions retain parts/provenance, and unavailable mixed value must not fall back to an unrelated season position. |
| manual | Existing manual state, with independent total/role provenance. |
| reported or supported inferred | Published/source only when required source components are available and the adapter verifies coverage. Pure 'bounded' coverage does not mean licensed components are complete. |
| estimated | Existing estimated state; retain observed and estimated portions in bounded evidence. |
| mixed | Keep underlying per-half states. Any capacity estimate makes minute quality estimated; manual+reported without estimates is mixed evidence, not wholly manual. |
| unknown | Map to pending/incomplete/unsupported based on actual component availability; never use zero. |
| publishable:false | Preserve typed diagnostics as terminal human-review/blocked for the same input revision. Do not make impossible accounting the active published run or retry it forever. |

Correction 1.0.1 distinguishes participation proof from quantity proof. Unknown minutes/roles remain null even when appearance/start is true and actual windows exist. DNP has zero total/field/GK quantities and false start independently of clocks; contradictory same-priority starts/quantities block publication. A whole quantity with missing windows does not establish any half's participation or quantity. Use only independent half decisions/observations for that proof.

A single role scalar can be a partial quantity. Preserve nullable total/other-role facts, the separate lowerBoundSeconds and assignedIsLowerBound. When the flag is true, aggregate assignedSeconds includes supported quantity floors for unresolved named totals; do not store those floors as effective minutes or treat the aggregate as a complete measured sum. unknownRoleSeconds is nullable when its amount is unresolved. The same budget equation is retained, including anonymous keeper quantities. Respect algorithm version 1.0.1 in the publication input hash.

Resolver output is not a database row. Store compact per-player dependencies/portions and capped diagnostics within current evidence-size limits; do not serialize the entire full-event graph into each 16 KB evidence column. Stage all changed rows and atomically switch the active run only after the lifecycle/account/source/season/input fence is checked inside the publication transaction. Bump read content revision only for a real publication. Include resolver algorithm version in the scoped input hash so unchanged provider data is recalculated after algorithm upgrades.

Keep the author's bounded obsolete-job retirement. A relocated event, removed attachment, replaced account generation or rejected season signature ends the stale job as obsolete; it must not publish into the old season or retry unchanged invalid scope indefinitely. A new accepted revision can enqueue/reuse the correct new job. Unknown/incomplete source evidence is different from an obsolete scope or a deterministic correction conflict.

The conservation receipt excludes unnamed keeper quantity from named player totals:

`named assigned + anonymous keeper + unallocated = verified format × actual duration`

Do not replace it with a plain SUM(player.minutes) comparison that loses anonymous/unknown roles. Estimates assert quantity only; never persist fabricated exact presence intervals.

## Required integration acceptance

- Native Worker executes the committed Node pure suites plus existing schema/lifecycle suites. Measure worst bounded input under the actual Worker CPU/memory limits; V8 component receipts do not prove that.
- No-preseed real source input infers supported format/roles/positions and preserves missing components. At least one 7v7 and one 9v9 comparison against original fixture arithmetic/formation; halftime keeper switch; sparse, unknown, DNP, short-handed and overlapping-source cases.
- Original gestures for manual minutes, DNP/start, position, half role/slot and reset survive reload. Independent minute/role provenance and selected-season totals agree across match/player/roster/Overview/Coach/report.
- Import a historical game with dated identity and source proof, rerun idempotently, merge with provider history without duplicated minutes, retain correction precedence, then replace/remove the source generation.
- Relocate a corrected event across the June–May calendar boundary during an in-flight job: old job retires, accepted new season publishes once, saved records/corrections/history survive. Statistical June inclusion remains distinct from calendar materialization.
- Change correction or track mapping midway through staged pages: mixed revision cannot publish. Change an unrelated team: correct scoped job proceeds.
- Repeat a job with unchanged source and identical algorithm: reuse once. Upgrade resolver version with unchanged source: recompute once. Two browser requests reuse shared work.
- Verify real provider sync and server advancement through cron/alarms with all browsers closed, then reopen and inspect records/progress. Verify the original phone workflow physically.
- Complete and record all 31 acceptance gates individually. Pure tests and the 13 native lifecycle scenarios are component receipts; neither closes original full-app parity.
