# Pure resolver verification receipt

Original source pin: 6.20.133 `50e1be224806ff7e7c439d26e15fd0421e3f6f01`; worker blob `bd2d055483abae37ddae2680ec62f6282da6680c`. Initial isolated resolver: `ab3c156cbe119173a9bcaaf6c1e2fd39ab99a4ee`, based on `a58fced0b04d4d361176a064874988de62bc2255`. This correction updates algorithm version to **1.0.1**.

Executed the actual corrected JavaScript module bytes through the Functions V8 ESM-to-Function component harness. No mocked allocator/lineup/interval implementation was substituted.

| Suite | Grouped cases passed | Seeded checks included |
|---|---:|---:|
| Interval/clipping/clock | 6/6 | 1,000 interval partitions |
| Half allocation/roles | 36/36 | 2,000 allocations |
| Lineup/precedence/identity | 8/8 | — |
| Shared resolver/original regressions | 47/47 | 200 sparse events |
| Quantity correction regressions | 28/28 | 1,000 unknown/zero/partial-role inputs |
| Existing exact original oracle | 13/13 | — |

Corrected resolver total: **125/125 grouped cases**, including **4,200 seeded invariant checks**; original oracle **13/13** separately. Original 7v7/9v9 arithmetic and tactical coordinate vectors remain unchanged and match the source oracle.

The correction suite includes the user's exact A/C/D inputs and B derived by adding started:true to A. It independently registers each case for Node: clock-independent DNP at zero/one/two windows; deterministic DNP/start and same-priority quantity conflicts; whole reported quantity without half proof; positive appearance/start without quantity; explicit total zero; independent half observations/quantities; lower-priority report suppression; known role sums without timing; eligibility/role bounds; partial-role lower bounds and anonymous keeper capacity; immutability/determinism. There are no reserved adapter/schema/UI/release changes and no deployment.

Reported by the integration author: native Node **22/22 passed for the initial ab3c156c artifact** before independent review reproduced A–D. That receipt does not establish a native pass for this correction.

Correction native command:

`node --test tests/parity/original-analysis.test.mjs tests/parity/shared-analysis-resolver.test.mjs tests/parity/resolver-quantity-regressions.test.mjs`

This registers **50 Node test records**: the prior 22 plus 28 exact/adjacent correction regressions. Counts of grouped internal cases and Node test records are intentionally distinct.

This environment has no connected exec server, Node, native Worker or browser runtime. Native execution of the correction remains for integration; it is not claimed here. Pure component passes do not prove adapter publication fencing, real providers, browser/phone behavior or the full 31-gate acceptance baseline.

Independent review provided the quantity-proof rules and additional clock-independent eligibility/role constraints. They are implemented and reproduced in these exact regressions. Native and integrated publication review remain required.
