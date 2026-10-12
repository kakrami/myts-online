# Trace analysis evidence contract and local receipt

Recorded 2026-10-12. Production change is confined to `src/sources/trace.js`; the saved native schema, projector and resolver remain separate owners. This receipt does not authorize deployment.

## Collector contract

The authenticated native game collector creates bounded radar child arguments containing only the originating account, native game/team IDs and exact provider member GIDs. A verified role requires the same account/game scope, `is_player === true`, an explicit native member team ID agreeing with its explicit home/away side, and the original native `home|away` numbered or goalkeeper channel. A string pattern, display name, position label, import summary, or radar's own proposed `analysis` object cannot create proof. Whitespace/truncation changes to GIDs are not accepted as exact evidence. Oversized role scope is omitted, leaving proof unknown, while ordinary collection continues within the existing job/page limits.

`radar:<half>` retains its prior raw start/end, population, geometry and sample count. It additionally saves `analysis`:

- `play_window`: half-local seconds, duration, baseline/threshold track counts, and `complete: true` only after the full accepted asset has valid nondecreasing native centisecond timestamps, positive measured population and a positive window
- `both_sides_verified`: `true` only when every counted actor matches that same game's native member proof and at least 80% of central frames have the measured baseline split equally between native sides with both goalkeeper channels; otherwise `null`
- `track_roles`: exact native GID, source side, field/goalkeeper role and `verified: true`; these describe source channels, not guessed people
- explicit calculation, role and population basis strings

The play-window calculation preserves original 6.20.133 TraceSourceTools semantics: centered moving median with five neighboring frames each side, central 20–80% baseline, baseline minus the larger of three tracks or 22%, and a centered ten-neighbor sustained-presence test at 80%. Rolling bounded reductions replace large intermediate arrays. Twelve irregular-population cases compare the result with the preserved original engine. A complete accepted asset is not an independent match-clock or attendance verification.

No global 7/9 history family, declared format, heat-map orientation or tactical-left orientation is fabricated. Native numeric or unknown radar actor keys cannot verify both sides. Recognized but insufficient population still supplies a measured window while format stays unknown. Existing owner format decisions remain the shared resolver's responsibility.

Full-game clip selection prefers the original Trace camera and preserves clip ID, start in milliseconds and duration in seconds. Missing/null clocks and foreign-game clips are rejected before being saved. No first-moment clock fallback is introduced.

Own-team anonymous/dummy native tracking channels are collected under non-player identities. This allows a separately verified anonymous keeper channel to reserve capacity; it never assigns that channel to a guessed person. Opponent tracking is not requested. Existing account authorization, source provenance, private asset host checks, record/page bounds and checkpoints remain in force.

## Explicit no-truncation resource limits

- Transport body: 8,000,000 bytes
- Radar frames: 60,000
- Actors in a frame: 128
- Actor observations across all frames: 600,000
- Typed reduction storage at the frame limit: 720,000 bytes, excluding the parsed response and bounded median scratch space
- Native role scope: at most 128 IDs and 5,000 bytes, additionally omitted if the complete child arguments would exceed 8,192 bytes
- Persisted component: existing 60,000-byte bound

An over-bound asset throws `record_too_large` before returning a source page. The production coordinator regression verifies terminal `failed` / `permanent`, no automatic next wake, and byte-for-byte preservation of previously saved components. No prefix is saved as complete evidence.

## Verification

Upstream payloads are explicitly synthetic, using original queried native fields. These are production-path tests, not live private-provider receipts.

`node --test tests/trace-analysis-evidence.test.mjs tests/shared-analysis-adapter.test.mjs tests/shared-analysis-source-proof.test.mjs`

Result: 36 passed, zero failures/skips. The Trace suite contributes 12 tests covering source collection, real DomainRepository/SQLite persistence, shared-resolver inference for 7v7 and 9v9 on either source side, anonymous keeper conservation, missing/spoofed/foreign proof, camera timing, malformed radar, pagination, exact bounds, original-window differential behavior and permanent failure preservation.

`node --test tests/trace-analysis-evidence.native.mjs`

Final result: one passed, zero failures/skips; Workerd instance disposed. The maximum accepted response is serialized to exactly 8,000,000 bytes and traverses production SourceTransport and collectTrace, with 60,000 frames, 600,000 actor observations and two upstream reads. Frame+1 and transport-byte+1 are both permanently rejected.

Native observations:

- Collector round-trip wall time: 1,013.217 ms
- Worker heap before: 819,756 used bytes
- Worker heap after / maximum sampled used heap: 40,045,468 bytes
- Worker allocated heap after: 67,506,176 bytes
- Heap after forced GC: unavailable because the inspector command timed out; not a retained-memory claim
- Only two heap samples were captured. The actual instantaneous peak is not established.
- Inspector attributed samples: radarAnalysis 49,958 microseconds; movingMedian 9,969 microseconds. These are sampled execution attribution, not an exact request CPU counter. Wall time, CPU time and sampled attribution must not be equated.

The functional smoke first passed without profiling; a telemetry attempt using the inspector root was corrected to discover the exact Worker target. One unbounded forced-GC telemetry attempt was interrupted. The final test bounds inspector operations and reports the forced-GC timeout explicitly.

No Cloudflare-account plan/CPU limit, production private entitlement, actual radar actor shape or remote deployment was verified. Local memory/functional acceptance does not establish compatibility with any particular production CPU quota.

## Frozen identities

Production Trace Git blob: `1385cf5d5f31351540fc772caca417060fcd6b5a`.

SHA-256:

| File | SHA-256 |
| --- | --- |
| src/sources/trace.js | 0e0a797005019152771bf19d8c44d2306d0c7b872b016f70b8d0cd0ed2a0f961 |
| tests/trace-analysis-evidence.test.mjs | 0178c9e6cd3c68861fedfcd62635daf7f482cef6edd245cdff838fa3ad7af635 |
| tests/trace-analysis-evidence.native.mjs | f35ab2e2b3e7b093e6a1fc17311889e6eaf6e44d30b618e4afc869c8a2db4a3f |
| tests/fixtures/trace-analysis-native.mjs | 228b43205e73fa008a9cf9d82daaa512f62652bc31d22c9b8395e917dfe248ca |
| tmp/trace-analysis-evidence-tests.tap | 2e3e62609d763d93daf2512de26ae710e04e0b2a8d3869b6c57c58c4cafadfe5 |
| tmp/trace-analysis-evidence-native.tap | c285eee54b0bb35b3e8a97e1c2af91ef3b72a9a550b466c14ba242c4647a0985 |

Native production-module fingerprint: `804461ce96b55e40e82829dfd44f611b2ed2b7a73b753c02957cada7d140e6ee`. The native fixture defines its exact module/fingerprint recipe. Temporary TAP receipts are local QA evidence, not production release contents.
