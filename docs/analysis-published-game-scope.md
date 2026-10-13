# Published-game analysis scope

Analysis is a consumer of the team's published membership. It does not infer
Trace correspondence, create aliases, or transfer owner records between games.

## Admission and storage

- Native event IDs, original canonical IDs, and published target IDs resolve
  through `resolvePublishedGame` for the authorized team and season.
- Native Trace context is chosen only from the exact captured run's entitled
  source/member/team rows. A new global alias cannot append a source.
- Corrections and half-lineups stay on their original stored event key; native
  track assignments stay on their exact source-event/source-team/gid key.
- A sole original analysis key remains the physical storage key even when the
  displayed published target differs. Builds consume its owner layers and publish
  derived facts under the logical target. Multiple independent original keys
  produce `game_owner_state_conflict` for editing and a human-review build receipt.
  No owner state is copied, consolidated, or deleted.
- If source scope becomes unavailable, owner-only editor/lineup GETs can show the
  exact requested original saved key as read-only. No current roster, provider
  facts, or native overlays are admitted by this fallback; all writes still fail.
- Login pause keeps locally entitled saved evidence usable. Source collection
  retains the existing independent provider-proof and authorization path.

## Write and build fences

Normalized run editors receive `game_scope_revision`. Corrections, half-lineup
save/reset, and native-track assignment/reset submit the opaque value unchanged.
Missing or changed tokens reject before writing. Immutable legacy version0 runs
retain token-optional compatibility; a transition to a normalized run requires
an editor reload. A reviewed revision adopts both the owner revision and matching
scope token while preserving draft form values.

The token identifies the published team/season/target/run/member IDs. It is not
an authorization credential. The committing transaction separately compares the
shared exact published scope snapshot, current source/team authority, and the
complete bounded original analysis owner-state snapshot. Row revision, roster
membership, accepted season, and lifecycle checks remain in force.

Build input hashes include the target and exact member IDs, native source/link
revisions and hashes, association decision revision, publication membership,
semantic/proof hashes, source/team identities, owner corrections, and half-lineup
state. Clock-only publication run changes can reuse the same accepted analysis;
semantic membership or proof changes cannot. A failed commit fence deliberately
violates the input-precondition CHECK, rolling back the whole output transaction.
It cannot merely skip a precondition row while later output writes succeed.

Manual match/half/season precedence, reset behavior, unknown quantities, and
explicit false/zero values are unchanged. Accepted facts remain immutable during
a rejected rebuild. Editor source previews use the same saved-analysis member
filter as read consumers.

## Verification map

- `published-analysis-scope.test.mjs`: real normalized schema; constituent
  routing; normalized token admission; old-editor split rejection; exact
  prepare/commit split, proof, unlink, side, source-evidence and owner-key fences;
  all six owner commands' committing CAS; source expansion denial; no-op reuse;
  foreign/viewer denial; local login pause; original state preservation.
- `analysis-scope-token-ui.test.mjs`: actual rendered player/event datasets,
  submit/reset, explicit reviewed-revision adoption, and lineup save/reset/page
  behavior through DOM-backed controllers.
- Existing shared-analysis adapter/source-proof, lineup UI, and match overview
  suites retain all precedence, nullable quantity, imported-evidence, original
  owner lineup, source proof, and interrupted browser interaction checks.

Native runtime and final aggregate/release gates are recorded separately; these
focused tests do not imply production matcher acceptance or deployment approval.

## Frozen local receipt (2026-10-13)

The six focused SQLite/DOM files listed above passed 106 tests with no skips.
The additional Trace evidence suite passed 12 tests. Two native tests then ran
serially against one frozen source map:

- `published-analysis-scope.native.mjs`: real normalized three-member group;
  original correction remains physically on `public-event`, derived facts publish
  under `event`, explicit zero/false survive, and unlink between prepare and commit
  aborts all output atomically. Restored local intent recovers normally. Prepare
  uses 25 SQL reads and publication uses five statements; foreign keys are clean.
- `shared-analysis-adapter.native.mjs`: catalog/alarm execution with 128 players,
  4096 intervals, and 6,718,906 payload bytes of saved imported evidence while the
  account is disconnected. Catalog uses 12 statements; match build/commit uses
  38 statements, 25,808 rows read, and 398 rows written. Match wall time is 1.705s;
  sampled peak JS heap is 25.7 MB.

Both report loaded source fingerprint
`05843f85c314e2faeccfeef1bee9a63b93510db4087b04c306dda6519576726b`;
before/after module manifests were identical. The native map includes separately
owned in-progress shared-scope/projector dependencies; it is not a final
aggregate-candidate receipt. The exact legacy game-season fixture was also
repaired to contain a real saved source cache and fixed-season attachment; its
native rerun remains an integration gate. Aggregate/release/production gates and
native all-consumer read coverage remain the coordinating task's responsibility.
