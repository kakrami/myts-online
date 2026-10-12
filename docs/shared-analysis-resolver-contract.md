# Pure shared analysis resolver

Implementation entry: `src/analysis/resolver/resolve.js`; TypeScript contract: `contract.d.ts`. It performs synchronous bounded calculation only. No database, DOM, provider retrieval, credentials, clocks, mutable globals or legacy-engine runtime imports.

Original behavior source: myts-online 6.20.133 commit `50e1be224806ff7e7c439d26e15fd0421e3f6f01`, worker blob `bd2d055483abae37ddae2680ec62f6282da6680c`. Original QA oracle comes from the first parity handoff `a58fced0b04d4d361176a064874988de62bc2255`, which is this batch's isolated base. No production or lifecycle files are modified.

## Corrections and precedence

Every quantity is seconds until the final display-minute facts. Absent/null corrections inherit. Position blank also inherits. Explicit zero and false survive. Unsupported position/format, nonfinite/negative quantities, malformed intervals, duplicate canonical identities and input bounds throw; structural failure must not be treated as transient retry.

Within a half: manual half → manual match → reported half → reported match → proved observations/inference → bounded capacity estimates. A match start decision refers to half 1 only. A format slot is half-only. Original pitch anchors use manual slotX/slotY together, within 0..100; format-slot and pitch-point intent are mutually exclusive. Reported layout anchors are rejected rather than relabelled as owner corrections. The original tactical target geometry and balanced joint projection are retained and compared coordinate-for-coordinate. Scored goals/assists are match-only facts, so unsupported half scored facts are rejected rather than silently dropped. Slot placement never changes participation time.

Match-level quantities have unknown timing. They are distributed only when every actual expected half window is known. Same-layer explicit half quantities remain pinned; the residual is apportioned by actual window duration. This apportionment supports effective accounting and asserts no exact presence intervals. Contradictory match/half totals are retained as errors. A half manual correction replaces the corresponding reported portion; it does not force another half to absorb the difference to preserve an old report.

A field-minute correction is a selective quantity, not an instruction to discard unrelated keeper evidence. Explicit field/GK/total combinations must conserve quantity. Per-role provenance records its own selected evidence/dependencies. Manual zero minutes is not independently a DNP statement. Manual appearance false supplies effective zero and suppresses inferred starts; contradictory explicit positive quantities or explicit start remain conflicts. A manual positive quantity can correct a lower-priority reported DNP.

## Evidence, unknowns and estimates

The adapter supplies canonical dated own-team identities, proved track mapping and account/attachment generation scope. The pure resolver cannot authenticate those claims. Opponent, dummy, unresolved or ineligible observations never credit named players. A proved own goalkeeper role channel can consume anonymous capacity; it does not invent a person's identity or appearance. A unique explicit full-half keeper decision can explain that channel. Partial scalar roles have unknown timing.

Intervals are clipped to actual half windows and merged per canonical person. Total union avoids duplicate source-track counting. Field and keeper overlap without a correction is a conflict. Unknown-role intervals retain observed total while unavailable field/GK quantities remain null. No evidence means unknown participation/minutes; explicit DNP means false/zero, including all role and minute quantities and a false start without any video window. Same-priority contradictory positive quantities or explicit start remain errors. Higher-priority DNP suppresses lower-priority reported/observed quantities.

Appearance, start, dated eligibility and an exclusive position/role alone provide no time quantity and cannot seed capacity estimates. A whole-match positive appearance or scalar quantity does not prove participation in each half. Unknown half facts remain unknown without an explicit half decision, a first-half start, or observed half evidence. Whole-match zero total implies zero role quantities by nonnegative conservation, without declaring DNP.

Low-minute evidenced field participants may receive bounded equalizing capacity estimates, separately labelled and counted. Unknown people never fill capacity; short-handed games retain unallocated capacity. Estimates do not fabricate interval timing. Unknown format or absent actual windows cannot create a nominal 7v7 game or a 25-minute half. A known whole-match quantity with missing windows remains available while half/role accounting remains unavailable unless independently stated.

Format is explicit manual/reported/verified inference, verified own slots 7/9, or verified both-sided baseline 14/18. When the adapter verifies the original history's 7-or-9 format family, the original population rule is retained: population at least 17 gives 9; otherwise a declared 9 stays 9, and the family uses 7. This avoids the original small-pitch 5v5 misclassification without guessing a family for unknown events. Player/roster count is not format proof.

Position uses manual → reported → supported keeper/spatial inference → season default. Supported native grid or adequate samples and own-goal orientation are required. Named lanes additionally need verified tactical lane orientation. The five-minute/sixty-percent keeper threshold is a display classification, not keeper identity/participation proof. Default 7v7/9v9 field shapes are 2-3-1 and 3-3-2; fully evidenced alternate bands retain their observed shape. Joint assignment and manual anchors produce distinct deterministic slots.

## Output and accounting

The returned graph is frozen; inputs are neither mutated nor frozen. Results sort canonical identities and refs deterministically. Every effective fact contains nullable value, state and provenance. Half raw observed time and estimated additions remain separate. Whole-match mixed evidence is labelled mixed. The opaque accepted commit signature is echoed unchanged and has no authority inside this component.

For a supported complete event:

`assignedSeconds + unassignedGkSeconds + unallocatedSeconds = capacitySeconds`

Named total minutes conserve field/GK time wherever both roles are resolved. One field/GK scalar, including zero, does not set the unresolved opposite role or exact total to zero. Compatible exclusive role intent, a full actual-window role quantity, independent opposite-role evidence or independently resolved role quantities can close the sum. Known whole-match field plus GK quantities may sum without a clock; the sum asserts no timing.

A partial known role remains a supported quantity floor in lowerBoundSeconds. assignedSeconds uses these floors when exact named totals are unresolved, and assignedIsLowerBound explicitly marks that case. Do not substitute floors for nullable minute facts or claim measured/complete quantities. Existing capacity estimates still retain their estimated classification. Unallocated means budget not assigned, not proof that unknown participants did not play. Unresolved roles retain an explicit unknown quantity. Per-person, field, goalkeeper, aggregate and observed timeline bounds are checked. Conflicting hard corrections remain visible; they are not scaled or silently clamped. Semantic contradictions produce `publishable:false` and typed issues; ordinary incomplete evidence remains usable with explicit unknowns.

Bounds: 128 players, 2 actual half windows, 2,048 observations, 4,096 input intervals, 4,096 spatial-grid cells per spatial record. The interval/allocation/lineup helpers have additional bounded work guards.

## Verification boundary

Run `node --test tests/parity/original-analysis.test.mjs tests/parity/shared-analysis-resolver.test.mjs`. The committed portable suites also execute without Node in the Functions V8 harness using the actual new ESM sources. The legacy source is QA-only.

Pure arithmetic, precedence and invariant receipts do not establish native Worker performance, adapter publication fences, real provider behavior, background processing, browser correction gestures or the full 31-gate release. See the separate adapter handoff for those remaining integration receipts.

## Correction 1.0.1

Exact A–D regressions are in `tests/parity/resolver-quantity-regressions.js`, with independently registered Node tests. They cover no, one and both actual windows, DNP/start and same-priority quantity conflicts, positive appearance/start without time, explicit total zero, independent half proof, lower reported quantities, role-only partial quantities, clock-independent sums and eligibility/role bounds. No nominal window or measured zero is generated from missing proof.

Eligibility, role bounds and conservation are validated independently of video availability. Existing whole/half position decisions also remain usable without a video clock. Missing-window whole quantities do not enable half capacity estimates. The algorithm version is 1.0.1 so adapters that include it in the input signature recalculate unchanged native input after this correction.
