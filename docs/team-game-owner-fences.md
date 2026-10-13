# Published game owner-command contract

This isolated candidate changes contextual owner commands only. It does not
change global aliases, source rows, the typed schema, projection inference,
installation epochs, release version, or deployment.

## Shared boundary

`resolvePublishedGame` resolves a team, season and constituent against the current
published run. Its source set remains the exact normalized membership (or exact
saved legacy cache). It additionally returns:

- `team_game_version`: immutable format marker
- `original_state_event_ids`: complete original/canonical alias keys and same-team
  published saved-state references
- `scope_fence_snapshot`: internal bounded exact snapshot
- `owner_state_complete`: whether the publication has complete saved-state refs

`gameScopeFenceSQL(scope)` is one committing predicate, not a read-before-write
check. It compares the pointer, content/input revision and exact target/member
snapshot, including publication/decision/current association heads; observed
source hash and source row version; event-link key, revision and evidence;
current account/root/member/attachment authority; participant/provider-link
proof; canonical key mapping; timezone; and accepted season resolution.

An already stale source changing a second time invalidates the snapshot. A login
pause or refreshed account generation does not erase local entitlement. The
change invalidates the old observation; a freshly read saved local scope remains
available. Revocation/exclusion and current owner rejection remove current-source
capability immediately.

The committing predicate has seven parameters and adds no SQL statements.
Default membership is bounded at128 (explicit maximum256), original keys and
publication rows at256. Scope snapshots cannot exceed262144 UTF-8 bytes. An
oversized response is suppressed in SQL rather than downloaded and truncated.

`captureGameOwnerState(db, scope, {kinds})` separately captures complete physical
owner keys and revisions/content for the requested owner tables. It returns
`records`, flattened `rows`, `event_ids`, `conflict`, and an internal SQL snapshot.
`gameOwnerStateFenceSQL(capture)` compares that snapshot in the same transaction.
It detects a newly inserted competing original key as well as update/deletion.
Each table is bounded at256 rows and the combined owner snapshot at64000 bytes;
limits fail explicitly, never return a partial complete set.

`gameScopeRevision` is the opaque client editor token. It hashes the ordered tuple
team, season, run, target and sorted published source IDs, so list rows can produce
it without per-card SQL. The exact server CAS remains stronger. A supplied wrong
token always rejects. New normalized owner edits require the token; legacy
callers can retain their original missing-token behavior.

## Bookmarks

Constituent references resolve to the same published local target, while writes
retain their original physical event key. Display groups expose `saved_event_ids`.
A token-authorized group removal deletes only this team's scoped original keys.
An explicit original-key removal without a token never expands a normalized
inferred group and remains usable after revoke/split/overflow. Legacy native
canonical aliases retain their existing grouped removal behavior.

When more than256 saved references would share a display group, the normal
bookmark pagination exposes every original key individually. Snapshot-backed
saved bookmarks remain listable when current local authority is revoked.

## Coach

Event context, availability and committing writes use the same published scope.
Availability comes from the grouped attendance CTE. A sole existing session stays
on its original event key; clock, revision, stint and correction semantics remain
unchanged. Two independent native-session keys remain a conflict. A derived
association never invokes canonical-session consolidation/deletion.

When current source scope is unavailable, the existing owner-only Coach GET can
open an exact original saved session key. It returns `state_only:true`,
`available:false`, `can_edit:false`, the saved captured roster and its clock,
minutes and timeline. It does not load live attendance, profiles or role hints.
The normal UI disables mutation controls, and the server denies writes. A native
source ID cannot substitute for the exact saved key in this fallback. The parent
consumer integration is responsible for making the saved-key entry discoverable
from unavailable detail/identity holds.

## Verification

The exact typed-schema tests cover membership and authority CAS, repeated stale
changes, owner rejection, original-key races, split/revocation/account pause,
257-key paginated bookmark overflow, independent Coach conflicts, saved-only
access and foreign/viewer denial. The focused combined SQLite/JSDOM run passes
101 tests, zero failures or skips, including original Coach clock/correction and
actual DOM-to-route workflows. The shared analysis fixture's separately owned
exact-schema correction was used for the inherited Coach tests.

The focused native Workerd/D1 proof also passes against the real fresh typed
extension and epoch wrapper: normalized grouped GET/create/configure, an explicit
prepared-scope CAS rollback after account generation change, stale editor token,
account-pause edit and revoked saved-plan GET. The inherited native original
Coach clock/halftime/correction workflow passes on the same frozen source.
Both peak at24 HTTP statements of48. Native source fingerprint:
`d32a122f078e562934079035e7ee926d8e7659ac32e25cfe8425fb8d2f61d649`.

That native run found and repaired an existing query-shape interaction: Coach's
nested full player-season/attendance summary exceeded D1 expression depth100.
Coach now selects only its equivalent position aggregation and recent Trace
minutes with the same accepted game/source predicates, avoiding the unused
nested summary. No limit was raised and no source guard was removed. These focused tests do not establish full-project acceptance,
production fixture acceptance, or deployment authorization.


## Publication-policy edge for integration review

Current authority subtracts a current owner rejection from a retained published
member set immediately. Reject followed by a newer owner acceptance while the
old pointer is still active can restore those same old published members. If
acceptance must always await new pointer publication, the projector/authority
integration must explicitly gate this transition by the publication decision
revision. This candidate has not silently chosen that additional publication
policy; the integration owner and independent reviewer have been notified.
