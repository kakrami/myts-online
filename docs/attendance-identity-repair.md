# 7.2.4 TeamSnap attendance identity repair

## Confirmed failure and primary evidence

The normal owner **Manage → Retry attendance** action on 7.2.3 began attempt 3
at 2026-10-13 01:12:36 UTC. Its matching scan/attempt observation returned HTTP
200 and 29,445 bytes at 01:12:38. Normalization then reported:

`attendance_identity; items=25; invalid_ids=25; duplicate_ids=0; valid_pairs=25; duplicate_pairs=0`.

No page or attendance row was committed. All 25 availability item IDs failed
the positive-decimal native-ID assumption, while all 25 event/member pairs were
valid and distinct. The private raw IDs were not collected or exposed.

The assumption is disproved by an [official TeamSnap Ruby SDK recorded API
fixture](https://github.com/teamsnap/teamsnap_rb/blob/086121e27a543bc7606112a808adc3811ed847a8/spec/cassettes/teamsnap__collection/supports_relations_with_expected_behaviors/when_a_plural_relation_is_called/responds_with_an_array_of_objects_when_successful.yml):
it contains availability ID `69-1`, member ID `69`, and event ID `1`. This proves
that a composite string is supported, not that the current account uses that
particular format. The verified original myTS 6.20.133 backend accepted opaque
nonnull IDs via `String(id)`; its attendance UI indexed observations by event
and member. The rebuilt persisted attendance model already uses that scoped
logical pair, not the unused availability item ID.

The [official iOS availability implementation](https://github.com/teamsnap/teamsnap-SDK-iOS/blob/f91ddd0222767b228c99799955d60c69d825e6cd/TeamSnapSDK/SDK/DataTypes/TSDKAvailability.m#L39-L80)
looks up an availability by member, event and team before copying its provider
ID/href for an update. That is lookup behavior, not an explicit server uniqueness
guarantee. The [official JS ID helper](https://github.com/teamsnap/teamsnap-javascript-sdk/blob/6a2b6c2c198e6798dd0ad131b0c4cc01a5e47f71/src/sdk.coffee#L145-L150)
accepts strings or numbers. The [exact original myTS source](https://github.com/kakrami/myts-online/blob/50e1be224806ff7e7c439d26e15fd0421e3f6f01/worker.js#L1277-L1342)
was verified against blob `bd2d055483abae37ddae2680ec62f6282da6680c`.
Neither source establishes a duplicate-free provider snapshot or permits copying
the original UI's last-wins duplicate policy into the durable collector.

## Narrow normalization and continuation contract

Attendance alone uses a canonical pair of independently validated numeric
`event_id` and `member_id`. The existing account/team refresh binding, current
account authorization and connection demand provide scope. A returned foreign
team remains rejected. A current roster/event row is not required before a
valid historical attendance observation can be saved. No global numeric-ID
helper or other provider component is relaxed.

The top-level availability ID is not a persisted semantic field. Opaque,
missing or changing values cannot change the logical pair. Accepting a valid
pair without that unused field is an explicit read-model choice, not a claim
that TeamSnap guarantees missing IDs. Duplicate pairs within a page are rejected,
including conflicting statuses; they are never silently counted or overwritten.

Page uniqueness, adjacent overlap checks and the bounded page-digest ring all
use the same pair identity. Attendance traversal digests include the persisted
source-status string, normalized status and scoped event/player identities,
preserve row order, and exclude the locally generated observation timestamp
and unused item metadata. Representation-only differences such as numeric `1`
versus string `"1"` have identical stored meaning and do not force catch-up. Existing
response, checkpoint, SQL-statement and transaction-byte limits remain in force.
Two matching traversals remain convergence evidence, not a provider snapshot.

Attendance's refresh binding records the identity algorithm version. A legacy
active cursor or completed numeric-ID receipt begins one full revalidation at
page 1 rather than mixing old offsets/digests/counts with pair-based evidence.
Saved records and the existing job, scan and connection identities are retained;
normal page commits advance new continuation state. New-version retries retain
their exact active refresh window. Events' binding and paging behavior are
unchanged.

## Events history and freshness

The live read-only check after the attendance failure confirmed `events`
coverage complete with 721 records and completion 2026-10-13 00:29:57.753 UTC.
`events_recent` was separately complete with 36 records at 01:02:42.175 UTC.
The job's retained full receipt had the same 721 count, original completion
and digest. Its ready/partial label describes the recent window; it does not
mean full history was lost. This repair does not change that coverage policy.

## Verification boundary

- Focused identity, privacy diagnostics, pagination, refresh, byte-bound and
  catalog regressions: **53/53**, zero skips. Independent final rerun: **53/53**.
  Cases include malformed/foreign keys, duplicate conflicts, changing page slices,
  lost replies, semantic versus metadata changes, bounded overlap/ring checks,
  account/team rebinding, legacy migration and unchanged event receipts/digests.
- Frozen 7.2.3 native baseline reproduction: **1/1**, 18.65 seconds. Three actual
  scheduled attendance attempts each persist the exact 25-invalid-ID/25-valid-pair
  diagnostic after HTTP 200 and commit zero attendance rows. The synthetic first
  page is padded to the observed 29,445-byte size; it is not the private body.
- Pinned Wrangler 4.149.0 dry-run build and 183-file required closure pass at
  7.2.4 (1,743.38 KiB Worker, 385.48 KiB gzip). The schema, upgrade plan,
  configuration and dependency graph remain unchanged.

- Final native Worker → source transport → collector → coordinator → D1 →
  connection reconciliation → projection: **1/1**, zero skips, 60.17 seconds.
  Seven events and eleven members produce exactly **77** source and published
  attendance pairs across provider pages 1–4 twice. The fixture proves a page-2
  transport retry, one real committed D1 batch whose acknowledgement is lost,
  response replay, malformed/duplicate rejection before writes, preservation of
  the entire completed event job/full receipt and a saved owner correction, and
  both legacy active/completed attendance checkpoint migrations.
- Held-response authority checks capture the exact job and account/root
  generations before revocation. Account revocation produces exactly one
  expected `stale_generation` lease loss for that job before reconnect; last-root
  unlink has its separate exact-job lease loss. Neither admits the held extra
  pair, and saved attendance rows remain byte-identical. Maximum measured work:
  **40/50 SQL statements**, **51,088 transaction parameter bytes**, and
  **2,263 checkpoint bytes**, within unchanged limits.
- The native fixture uses **1 ms alarm/page delays** and synthetic due-time
  arrivals. These are correctness and bounded-work receipts, not hosted latency
  measurements. The pre-instrumentation fingerprint of all 126 loaded production
  modules is `cf9ea550c2a22fe9b0b090459a94131b3cb337cabc4467a31d0d3b0be7b9da91`.
  Test-only metric instrumentation observes existing commit sizes; the lost-ack
  wrapper delegates the unchanged production D1 batch before throwing once.
- The first candidate run completed the workflow but failed its final test
  allowlist because the deliberate account revocation's expected stale-generation
  rejection was omitted. That red receipt is retained. A subsequent run passed;
  the final run additionally attributes that rejection to its exact held job and
  phase. No production authority guard was changed to resolve that fixture issue.
- Existing persisted-diagnostic native regression: **1/1 selected case**, zero
  skips, 14.97 seconds. Its obsolete opaque-ID failure input was replaced by two
  conflicting observations of the same pair. Permanent classification, exact
  static counts, matching HTTP200 audit, redaction, zero attendance writes and
  unchanged checkpoint/generation/counters remain asserted. The measured
  collector invocation uses **13** SQL statements. Other tests in that file were
  not rerun for this receipt.

Provider responses in all local tests are synthetic. No new full-suite or real
provider completion is claimed. The confirmed live failure identifies the faulty
assumption; deployed attendance recovery remains the next acceptance gate.

## Deployment and recovery

No schema migration, import, reset, reconnect or credential change is needed.
Preserve both databases, the existing DB binding, ADMIN_KEY, SYNC, cron,
preview setting and 30,000 ms HTTP CPU budget. After `/api/health` reports 7.2.4,
use the ordinary **TeamSnap Manage → Retry attendance** action once. Do not use
Update now to restart completed events. Verify the new attempt saves attendance,
then reaches verified coverage and the published attendance views while all
721 source events and existing owner edits remain intact.

Full original-product acceptance remains open. A separately observed historical
Schedule ordering discrepancy is outside this bounded attendance release.
