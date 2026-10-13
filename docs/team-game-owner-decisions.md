# Team-local owner game decisions

This candidate adds a bounded owner review inside Source identities → Matches.
It does not rewrite source events, native IDs, global aliases, saved bookmarks,
manual corrections, analysis records, or Coach sessions. It does not introduce a
schema relation or a global identity manager.

## Original behavior and scoped adaptation

The inspected original UI's `reconcileFixtureSources` (original-ui.html lines
876–882) honored a family-scoped Trace `game_map` only for a uniquely referenced
TeamSnap game; original worker.js lines4158–4164 stored that map. The rebuilt
`DomainRepository.linkEntities` (repository.js455–474 at the reviewed baseline)
provides a separate global owner-confirmed source identity action. Neither is an
original TeamSnap-to-public manual enum policy. This feature is the explicitly
approved, team-local adaptation and keeps the old global action unchanged.

One TeamSnap source plus one complete, established public native group may be
confirmed. The review shows every selected source, exact instants, opponent
labels, venue/field/address, orientation, source-result authority, all bounded
collision alternatives, all comparison reasons, original saved roots, and
publication status. The initial candidate window remains at most60 seconds.

`owner-team-game-v1` with `same_game_for_this_team` can acknowledge only the exact
cross-provider opponent/venue comparison enum and reciprocal collision listed
in `TEAM_GAME_MANUAL_REASONS`. Own identity/account/root entitlement, provenance,
concrete/nonconditional kind, valid instant/date/season, complete scope, public
internal member contradictions, conflicting mappings/accepted partners, and
saved-state conflicts/overflow remain hard gates. Each confirmation is scoped
to the exact acknowledged source set and root/account/attachment references.

Manual identity does not reconcile provider values. Score/status conflicts are
retained in evidence and consumed by the projector's existing field-correction
precedence. Unresolved dimensions receive unknown/null result presentation and
`result_conflict`, without inventing an identity conflict or trusted winner.

## Durable command contract

- Association keys remain team + private account/team/source + public anchor.
- The immutable owner revision includes request ID/hash, predecessor, exact proof
  and state hashes, policy, and explicit confirmation. It advances head and owner
  revision together. It cannot set the accepted publication pin.
- Same team/request ID and identical normalized payload returns its original
  outcome. Changed payload conflicts. Owner request revisions are never pruned.
- Review/commit use the same bounded candidate acquisition and scoped original
  state reader. Commit repeats the exact server-authored read set, including
  source universe, full current receipts, source hashes/rows, scope generations,
  canonical peers, heads, original keys and values, pointer, placement and team
  state. Owner session/password revision and lifecycle also fence the commit.
- Used public bridge expiry and six-hour observations have an explicit SQL
  wall-clock deadline; unchanged rows do not make an expired bridge valid.
- Limits:128 candidates,128 nearby heads,256 original keys/state references,
  128 current publications/affected seasons,28 distinct captured reads,
  90 captured bind values,256KiB serialized capture,
  80KiB compiled read-fence SQL. Selected link evidence is capped in SQL at16KB
  before transfer. Limits are fail-closed sentinels.
- Owner rejection persists across seasons and removes current capabilities
  immediately. Reaccept cannot restore the old publication; a new pointer must
  incorporate the newer owner revision.
- The decision atomically dirties its bounded affected seasons: selected,
  association origin/accepted placement, current native placements, and every
  current association publication. The complete publication envelope uses a
  129-row sentinel and a 256KB SQL byte bound. A late publication/pointer change
  invalidates the commit rather than omitting an affected season.
- Exact public/domain/projection jobs in those seasons are disabled, their
  generation advances, and leases clear under the same command fence. Existing
  subscriber demand is preserved. Old running commits/failures are rejected;
  replay and unrelated seasons, roots, sources, reports and teams are untouched.
- `recoverLocalDemand` and `recoverDemand` recover missing/disabled jobs from the
  durable pending state. `worker.js` invokes recovery on the configured minutely
  cron and the normal alarm path. The command only attempts a wake after commit;
  it does not depend on a successful enqueue, wake or response.
- Saved decisions are cursor-paginated; list pages do not load proof payloads or
  issue per-row reads. Revoked-source review exposes no private source labels.

## Verification receipts

The final focused suite passed295 tests with zero failures or skips.
The SQLite/service/DOM suite covers the full review → confirmation →
publication workflow, rejection/reaccept, stale and atomic races, session
revocation, current/foreign accounts and teams, expired bridge commits, physical
state conflict/overflow, more-than-page neighborhoods and decision history,
manual discrepancy acknowledgment, unresolved values, cross-season rejection,
closed-modal cancellation, and actual production local recovery after injected
wake loss with missing/ready/failed/blocked/running/queued/retrying/disabled jobs.

Each of the 17 manual identity reasons has a pure positive test and wrong-policy,
wrong-confirmation, wrong-source and wrong-scope negatives. Hard gates and
separate score/status conflicts have additional pure tests.

Native production HTTP + Workerd/D1 + actual fresh extension epoch writer passed
with 46 complete alternatives. Review used 28 statements; a new decision used 48
of the unchanged 48 HTTP limit; exact replay used 6. Wrong payload and stale account
scope returned 409. Initial native source fingerprint:
`a7c6aa6af2ae5fb689ed3cae932b7deca53ca0625b5e89d8906cddcc3e2ab609`.
Later changes add explicit field/address/reported-score display, publication-aware
list cursors, exact selected-link proof capture, the same original-alias state
hold used by the projector, and reachable original saved-key locators. The final
command also adds bounded affected-season capture and atomic projection-job
invalidation/recovery. That transaction delta requires the combined integration
native gate; the earlier native receipt does not claim to cover final bytes.

The final full admission SQL compiles under SQLite's D1-equivalent expression
100, compound 5, parameter 100 and SQL 100k limits: 28 unique statements, maximum
28,350 SQL bytes and 67 bind parameters for the 46-alternative case. No quota was
raised. These receipts are synthetic candidate verification, not production
fixture acceptance, deployment, or completion of the separate cross-season
atomic-publication release gate.

## Combined integration command proof

The final transaction ran on the integrated candidate at `5dfbc6a` with the
full fresh installation and epoch wrapper, actual owner HTTP routing, and native
Workerd/D1. The test passed all 24 records (23 imported source-candidate cases
and one native workflow), with no skips. A new decision used 41 of the unchanged
48-statement HTTP allowance; review used 28/29 and exact replay 6. The prior
failed projection's generation was invalidated, and stale account authority
was rejected. The native loaded-module fingerprint was
`dc96e37f8400edd1d9d7beca8c1c24632b967bf2f8b00a253a3f005d4e6dbe5c`
(143 modules); a subsequent byte map reproduced this exact fingerprint before
further source edits. Native duration was 10.6 seconds, not a production latency
measurement. An earlier attempt stopped before runtime boot because the local
Miniflare dependency was not linked; it is retained as a harness failure.

The integrated service/resolver/projector/DOM closure also passed 309/309. The
client-export plus owner-dialog integration passed 111/111 with real JSDOM;
a prior run without JSDOM explicitly skipped 45 DOM records and is not used as
that UI proof. This closes the final command transaction gate, but does not
substitute for the separate cross-season atomic publication proof.
