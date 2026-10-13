# Team-game projector: bounded local publication

This is a separately reviewed candidate, not a deployment receipt or complete
cross-season matcher release. No provider-native identity, global alias, source
payload, bookmark, Coach session, analysis state, or manual correction is merged,
renamed, copied, or deleted by this adapter.

## Implemented

- New runs explicitly name `team_game_version=1`. Building version-zero runs
  restart. Published version-zero data is not reinterpreted or edited.
- Every emitted native singleton/native group has normalized exact source rows,
  including unchanged native Trace members. Inferred TeamSnap/public groups use
  those same rows. The sorted `source_ids` cache is checked against the complete
  normalized set inside every staging/publication transaction.
- Candidate acquisition remains the separate bounded loader: exact root/legacy
  authority, complete native/public peers, independent full/recent receipts, and
  reciprocal numeric-minute neighborhoods before label or venue filtering.
  This adapter limits closure to two expansion queries. Failure to close is
  explicit incomplete evidence and cannot produce accepted inference.
- Disconnected time neighborhoods are resolved independently after complete
  acquisition. A 24-game page is not made into a 24-by-24 irrelevant Cartesian
  proof. Output remains cursor-bounded, and source membership prevents duplicate
  targets when a matched counterpart appears on a later native page.
- Current owner heads and accepted historical heads are loaded by exact native
  targets and possible numeric-minute neighbors across seasons. SQL bounds the
  returned JSON before transfer. A local decision/owner-state/fence overflow
  reduces the requested page on the next invocation, rather than repeatedly
  spending the same invocation's SQL budget. A lifetime-wide association cap is
  not imposed.
- Associations use stable team-local pair identity. Semantic decisions are reused
  when only complete receipt clocks renew. Owner heads are never changed by
  matcher work. The last accepted revision is pinned only after the matching
  pointer publishes in the same transaction.
- Material reciprocal review/pending assessments are persisted without grouping
  their native rows. Rejection and source revocation preserve state-only holds.
  Original owner-state keys and revisions are references, not copied owner data.
  Coach/lineup child references use their parent write revision plus exact child
  keys; ordinary writers are responsible for advancing the parent revision.
- State overflow produces an explicit `state_refs_complete=0` hold with no partial
  detailed reference list and a bounded complete original-event-root locator.
  Native singleton rows and original saved rows remain intact.
- One-sided reschedules retain a durably accepted target, its accepted day and
  its accepted season together, with review/pending proof. Accepted heads are in
  the event cursor even when native season resolution no longer selects them.
- Fresh per-page atomic fences include current source/mutation counters.
  Multi-page continuation instead pins team input, timezone/season boundaries,
  pointer/content revision, and exact local root/member/account clocks, avoiding
  unrelated global and scheduler status churn. Final assertions additionally
  check all member hashes/link/input versions, owner heads, state keys/revisions,
  complete receipt sets, exact candidate universes/windows and canonical peers.
  A behind-cursor change restarts the unpublished run, including a newly added
  legacy competitor without a global clock change.
- Publication is one transaction. Lost staging/publication acknowledgments reuse
  existing staged membership or the already-published pointer. Cleanup deletes
  normalized members and publications before event rows. History pruning retains
  current heads, owner/accepted pins, all publication/batch references, latest
  accepted/review evidence and 32 additional unpinned revisions.
- Legacy player participation now uses the exact normalized source membership of
  the current building run, preserving public/native roster contributions after
  a local target differs from an original global canonical event.

## Bounds and receipts

- Requested native page: at most 24 canonical references, lowered durably on
  native byte, decision, state, or fence pressure.
- Native/source acquisition: 128 rows, 1,000,000 UTF-8 bytes, SQL sentinel before
  byte filtering. Oversized individual native groups fail closed explicitly.
- Nearby durable heads: 128 rows / 256,000 bytes, bounded before transfer.
- Owner references: 256 keys and 16,000 bytes. Evidence/fences retain the typed
  schema's 16,000-byte ceiling; no payload or query limit is raised.
- Combined head CAS and publication assertions keep write statements constant
  with the number of new decisions on a page.
- `tests/team-game-projection.test.mjs`: focused actual SQLite projection,
  rejection, retention, revocation, overflow, pruning, Trace, stale acquisition,
  late competitor, lost acknowledgment and cross-season-denial tests.
- `tests/team-game-projection-coordinator.test.mjs`: exact fresh installation,
  production `SyncRuntime`, actual root-reconciliation receipts, paired epochs,
  normal claim/commit/recovery and 24/48-group pagination. Verified maximum is
  exactly 50 SQL statements, with the limit unchanged.
- `tests/team-game-projection.native.mjs`: prepared native Workerd/D1 test using
  the real production alarm runner, unchanged delays and 48 synthetic pairs.
  The corrected native test passes as recorded below.

The generic aggregate was interrupted after discovering that some `*.test.*`
suites launch native runners. It is not an aggregate pass. Earlier frozen
projection-recovery fixtures intentionally seeded version-zero *building* runs and used the old cleanup phase count. The final test-only correction explicitly covers legacy restart, uses version-one runs for safe-page checks and follows normalized child-first cleanup. It passes 24/24; the former 10 fixture failures remain retained. Timezone changes are now correctly tested as rejected stale frames with zero writes and a durable recovery wake.

## Remaining release gates

1. Typed-root cross-season movement now uses the durable two-run coordinator
   described below. Legacy attachment rebinding and season-qualified Coach/manual
   analysis state remain explicit review holds, not successful moves. The isolated native three-phase proof is complete; combined main-tree
   integration and the user-source acceptance fixtures remain separate gates.
2. Root materialization must retain accepted original placement before derived
   membership retirement, with explicit exclusion still authoritative.
3. The shared paginated saved-state route, all read/write consumers, owner command
   API/idempotency and export/import decision policy require integration by their
   respective owners. A stored hold alone does not establish those surfaces.
4. Final combined-source native, aggregate, browser, actual-source candidate,
   release-manifest and build checks remain separate gates. Synthetic source
   receipts do not prove the user's three production fixtures.

## Native query-limit correction

Initial native alarm execution exposed D1 limits not enforced by the default
Node SQLite engine: five terms per compound SELECT and expression depth100.
Owner-state branches are now materialized in groups of at most three, with a
four-term outer union. Independent publication assertions are materialized once,
and long receipt conjunctions are balanced. No SQL or platform limit is raised.
The added pure D1-limits test compiles all421 captured SQL calls (153 distinct
statements) from a real48-pair coordinator run with those limits,100 parameters
and100k SQL bytes; the observed maxima are21,440 SQL bytes and13 parameters.
Final post-correction native test passed:48 groups,96 exact members,48 accepted publications, ordinary production alarms, no manual runner and maximum50 SQL. Runtime source fingerprint `1fb66c277e4ed5ca0a072ad60419a3bba73e0d6ab33876f4bea7df48f5648cde` was unchanged before/after. Receipt: `/tmp/myts-team-game-projection-native.json`; log: `/tmp/myts-team-game-projection-native.log`. Original compound-limit and expression-depth failures remain separate red receipts, not overwritten claims. The70-case pure suite and the all-query D1-limits compilation test also pass.

Owner-authority and request-bearing decision revisions are never pruned: they
carry durable replay/collision identity. Matcher history remains bounded per
cleanup pass with its existing32 unpinned-history policy.

Equivalent forced replacements now compare both complete run sets inside SQLite and return one boolean, without materializing an unbounded JavaScript snapshot. Event/player presentation, semantic source membership and publication meaning must match in both directions. The fresh pointer and exact authority fences still publish, while projection_hash and team content_revision stay unchanged. Credential/account generation clocks are excluded from semantic assessment identity, but remain required current publication fences. Combined downstream report-fingerprint behavior across forced replacement remains a separate integration check.

## Physical-read follow-up

The initial native pass exposed repeated validation of the same full acquisition
receipt on each association in a page. Native per-statement profiling confirmed
that check consumed over97% of48-group reads. Validation now deduplicates by
(app_team_id, complete raw fence JSON, fence_hash), retaining per-association
owner-head checks. A modified single publication cannot hide behind a peer with
the same hash. Owner-state materialization is restricted to the current team and
canonical roots before each subgroup is materialized.

Both before and after24/48-group native alarm runs passed. Total rows read fell
from365,466 to63,234 at24 groups, and from4,346,283 to322,719 at48 groups. At48,
publication validation fell from4,227,693 to204,129 reads. Maximum statements
remain50. Beyond48-group physical scaling is not established by these receipts.

Receipts: `/tmp/myts-projection-profile-{before,after}-{24,48}.json`, with matching
`.log` files. Final full source map: `/tmp/myts-projection-profile-after-source-map.json`.
The final fingerprint is `e72cca1b3ea2df973c798518aba0b3d4e452a019ef3cd21f696a11a09e84d89f`.
All77 focused pure cases plus all421 captured queries under actual D1 preparation
limits pass, including late legacy competitors, renewed receipts and one changed
raw publication fence or owner revision sharing an unchanged fence hash.

Owner-confirmed identity now carries the exact manual policy and scoped proof to
the resolver. Conflicting provider finals/status remain unresolved presentation
values until explicit normal event corrections resolve them; identity stays
accepted. Focused integration covers public/public final disagreement and
cancelled-versus-final/scheduled status without changing native membership.


## Semantic and native-singleton follow-up

Equivalent forced refresh and account-generation-only saved-data revalidation
preserve target, semantic decision revision, projection_hash and team content
revision. Material presentation changes still advance content. The production
coordinator replacement proof uses at most46 SQL; initial creation still has the
prior50 ceiling. All933 captured SQL calls across creation and replacement
(302 distinct statements) compile at the native D1 limits, with at most19
parameters and21,440 SQL bytes. This delta has not yet had a new native receipt.

Ordinary native practice/event/game rows no longer inherit identity_conflict
from unavailable cross-provider inference. A genuine season-resolution conflict
still applies. The existing actual collector-to-report refresh suite passes25/25,
including recent/full TeamSnap refresh and Players attendance in Excel/PDF.

The native-singleton exception is deliberately narrow: multi-member review or
pending groups retain identity_conflict, and a canonical target with a hidden
unentitled member remains conflicted without copying the hidden evidence.
Conditional flags remain unchanged. Held equivalent-publication tests mutate
input, the old pointer or a source after collection; all three atomic commits
roll back. A combined initial team/season/state read saves two queries, giving
48 initial and44 equivalent-replacement SQL in the actual SQLite coordinator.
These follow-up bytes still require a new native receipt.


## Two-season coordinator

The old accepted-season job owns one durable active batch. Every participant page
CASes batch generation, both inputs and both old pointers. A destination job
cannot publish or obsolete the coordinator's runs. Independent ordinary writes
collected before batch creation also fail their input assertion once it is active.
Both complete version-one runs become visible in one atomic two-pointer commit,
and only then is the accepted decision pinned. The result reports exactly two
publishedSeasons for the application's two-catalog scheduling hook.

Simultaneous same-direction and opposite moves serialize. A batch moves only its
owned association; later moves retain old placement and are durably queued for
fresh-pointer reconsideration. Lost ready/publication replies recover the already
published pointers. Lost coordinator checkpoints invalidate only unpublished
participants. Either entitlement loss or held source/owner/input/pointer changes
rejects publication without an intermediate single-pointer result.

Every publication queues both projection cleanup/recovery obligations alongside
both catalog jobs. Cleanup drains members, publications, event and player rows in
bounded existing pages. Superseded completed batches no longer pin obsolete runs;
obsolete internal batch receipts are pruned only after no publication references
them. All owner/request-bearing decision history remains protected.

Long-lived frame fields are persisted as a semantic SHA-256 digest; newly acquired
full raw frames remain exact SQL commit predicates. Serialized combined checkpoints
stay729 bytes with32 long-ID typed roots or mixed root/legacy attachment scopes,
within the unchanged8192-byte ceiling. No authority evidence is truncated.

A coherent move requires unchanged typed-root identity in both seasons, complete
state acquisition and no season-qualified Coach/manual-analysis state. A legacy
attachment ID is season-specific, so its move is held at its accepted old placement
with stable reason legacy_attachment_rebind_requires_review. This is an explicit
release limitation; old acceptance is never relabeled as destination authority.
Missing destination season/entitlement also holds the old placement.

The actual48-group coordinator proof, with all changed source hashes and a move,
uses at most49 SQL including epochs, claim/commit, both catalog scheduling and
cleanup. A second production-coordinator proof starts two simultaneous moves,
loses the recovery wake after the first publication, and converges at49 SQL with
no obsolete run rows left. The latest native three-phase proof passes, as recorded below.

For ordinary inferred games, the displayed timestamp now follows the selected
public schedule source rather than the native membership's date. Explicit owner
start/day corrections retain precedence, and one-sided reschedules retain the
complete accepted placement. A date-only owner correction never invents a kickoff;
it remains a review placement until a complete instant is available.


## Final native two-season receipt

Frozen runtime commit d9f35d2, with test-only epoch-wrapper fix775eca0, passes the
full creation, equivalent replacement and cross-season/cleanup alarm sequence.
The139-module fingerprint is
`316bfd1066ec461c415d7a2880cb5f9969a6f633f4739d0cf043a297054a4b92`,
unchanged before and after. All105 production alarms fit49 SQL under the unchanged
50 limit. The three phases use22,26 and57 alarms respectively. The no-op phase
changes the current proof pointer while preserving content revision and projection
hash. The move phase exposes48 total games/96 exact current members, exactly one
new-season game, both switched pointers and both analysis catalog jobs. Native
source identities and installation writer modes remain intact.

Receipt: `/tmp/myts-projection-batch-native.json`; log:
`/tmp/myts-projection-batch-native.log`; full source map:
`/tmp/myts-projection-batch-native-source-map.json`. The earlier test-harness
attempt incorrectly used an unwrapped setup write and was rejected by the installed
epoch trigger before replacement collection. Its separate red receipt remains at
`/tmp/myts-projection-batch-native-harness-epoch-failure.log`; no runtime fence was
weakened to correct it.

The final pure combined run passes147 tests. After two narrow final hold/manual
presentation corrections,32 focused batch/manual/schedule tests pass on the exact
frozen runtime. Independent review additionally passes120 batch/coordinator cases.
Legacy attachment rebinding and season-qualified owner-state moves remain review
holds; this native result does not claim those unsupported moves are implemented.
