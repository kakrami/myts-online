# Pure resolver verification receipt

Original source pin: 6.20.133 `50e1be224806ff7e7c439d26e15fd0421e3f6f01`; worker blob `bd2d055483abae37ddae2680ec62f6282da6680c`. Isolated patch base: `a58fced0b04d4d361176a064874988de62bc2255`.

Executed the actual new JavaScript module bytes through the Functions V8 ESM-to-Function component harness. No mocked allocator/lineup/interval implementation was substituted.

| Suite | Grouped cases passed | Additional seeded checks |
|---|---:|---:|
| Interval/clipping/clock | 6/6 | 1,000 interval partitions |
| Half allocation/roles | 36/36 | 2,000 allocations |
| Lineup/precedence/identity | 8/8 | — |
| Shared resolver/original regressions | 47/47 | 200 sparse events |
| Existing exact original oracle | 13/13 | — |

New resolver total: **97/97 grouped cases**, including **3,200 seeded invariant checks**. The original 7v7/9v9 arithmetic and tactical coordinate vectors match the source oracle. Tests cover independent selective field/GK correction provenance; manual/reported/observed precedence; zero/false/reset; mixed half summaries; DNP/start conflicts; missing windows/format; anonymous keeper and unknown roles; dummy/opponent/unproved/ineligible tracks; duplicate-source interval union; actual fractional windows; overcapacity; deterministic immutable output; malformed/bounded inputs.

These counts describe portable grouped cases, not 97 separately registered Node test records. The committed Node wrapper registers six interval cases and three grouped suites.

Native command for the lifecycle author:

`node --test tests/parity/original-analysis.test.mjs tests/parity/shared-analysis-resolver.test.mjs`

This environment has no connected exec server, Node, native Worker or browser runtime. Those commands and integration/performance/provider/browser receipts have not been claimed here. The pure patch does not wire a production caller, change D1 schema/bindings, modify release config or deploy. It does not close the complete 31-gate acceptance baseline.

Independent draft review identified DNP/start, selective field/GK, role provenance, ignored unsupported facts, out-of-event half evidence and half/whole summary precedence issues. They were corrected and added to the combined regression suite. Final adapter and native integration review remains required.
