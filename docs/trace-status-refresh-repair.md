# Trace typed-header status authority repair

## Recreated defect and production corroboration

`TEAM_GAMES_QUERY` requests `status`; `RICH_GAME_QUERY` does not. Both collectors
pass their response through `traceFixture`, which previously wrote an empty
`provider_status` for the rich header and derived its event status from that
absence. Alternating byte-stable discovery and detailed-header responses thus
changed the same `source_events` row in both directions.

Actual collector → repository execution with the complete production domain
schema and triggers reproduced exactly one root increment per event write:
`provider_status: completed` → empty → `completed`. The only changed persisted
columns were event evidence, its content hash and observed timestamp. This is
two root increments per game cycle. The 29-game regression recreates the
58-increment pattern without player/member/team/roster changes.

The parent's live observations corroborate this mechanism:

- Between 06:09:14 and 06:31:56 UTC, 29 Trace event rows were observed while
  player/member/team/roster updates were absent; the root advanced by 58.
- A later sample had 20 empty and 96 nonempty provider statuses. All 20 empty
  values were observed within two seconds of a detailed-game save, and each
  corresponding job was at the `members` checkpoint. None of the 96 nonempty
  values matched a latest detail save; 25 clustered around discovery.

This is contract-level reproduction plus live correlation. Historical
before/after row-byte snapshots were unavailable. No production database was
read or modified by this workstream, and no current publication success is
claimed here.

## Field-authority audit

Every native input used by `traceFixture` was checked against both GraphQL
contracts. Both select game ID, date, half duration, and home/away team ID, name,
title and score. `status` is the only used input selected by discovery and
omitted by the rich query. Rich-only header/member/clip information is stored in
separate typed rows and is not part of this preservation rule. No GraphQL field
was added or guessed.

## Minimal runtime change

The repository's existing bounded prior-row snapshot preserves only the saved
native `provider_status` when all of these hold:

- Incoming and saved rows are provider-backed Trace observations of the same
  account/native event.
- The current provider page is a `game` header under
  `trace-game-semantics-v1`, whose next checkpoint is `members`, offset zero.
- The incoming normalized provider status is empty and the saved value is a
  string.

Explicit cancellation/postponement meaning is retained with that native status.
For ordinary statuses, normalization continues to use the fresh header date.
Discovery can still change or explicitly clear status. Detailed headers still
update dates, participants, labels, reported scores and half duration. Stale
observations, file-import precedence and first-ever headers retain their
existing behavior. An unexpected explicit nonempty incoming status is not
hidden by the rule.

The change is 16 added lines in `src/domain/repository.js`, after the separately
proved GotSport commit `49e7abd`. There are no new database queries, schema or
trigger changes, publication-gate bypasses, player/jersey authority changes,
matcher edits or version/manifest changes.

## Validation

- Five new actual-collector SQLite tests pass. On exact `49e7abd`, three fail:
  repeated 29-game status churn, cancellation/postponement retention, and
  preservation of cancellation while accepting fresh header facts.
- Explicit inspected SQLite-only tests pass 45/45: Trace status, continuation,
  member timestamp/provenance, GotSport root refresh and source page budget.
  No wildcard aggregate is claimed.
- The earlier 494-turn installed native root/publication proof applies to the
  GotSport source snapshot recorded in its own receipt. It is not relabeled as
  a full-run proof of this later Trace change.
- The separate bounded fresh-install native integration proof passed against
  the final Trace source; its exact result is recorded below.

### Native proof boundaries

The bounded test uses real Workerd/D1, fresh complete installation and production
installation/epoch fences. Actual collector and repository code is host-driven
against that native database. Each save includes real installation inspection
and a fresh 50-statement budget; this is not an unattended alarm, coordinator
fairness or hosted wall-clock throughput claim.

The test repeats discovery/header responses for three games, verifies zero root
increments, then verifies explicit cancellation, postponement and clear changes
plus fresh header date/participant/name/score/duration changes. It also checks
stale and imported observations, foreign keys and cleared writer guards. Full
runtime/configuration file maps must match before and after.


### Native terminal result

PASS: 28 actual source saves. The maximum inspected save used 21 statements,
2,472 SQL bytes and 3,293 parameter bytes. Repeated discovery/header saves were
stable; all explicit status/fresh-fact changes and stale/file precedence
assertions passed. Foreign keys were valid and writer guards were cleared.

The 164-file runtime/configuration source map matched before and after:
`aead6211dc7dcb649be2dc7a420e93d788fce8feccd013592e7df25b939e94d7`.

Repository SHA-256:
`097b0ef58f09b5b12ed16d66893dfde434ac88fbd4681c8d1611d7553fd92730`.

Receipt: `docs/trace-status-refresh-native-receipt.json`.
Total local test duration was about 16.5 seconds, not a production timing claim.
