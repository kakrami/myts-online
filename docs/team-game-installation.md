# Team-local game identity installation

This candidate extends the preserved 731 installation to 788 schema statements.
The original source observations, owner/session/account records, sync jobs,
bookmarks, corrections and Coach records remain in place. It does not import,
reset or replace the database.

## Exact identity

- Base fingerprint: `e1c1b6cf96cd12afce94dc14819e103283aacac2f420329cfaf65938888e4f40`
- Base plan: `755a9a58c834e2a469c8d12e91acd9e51e67800efc7cb4c5e315e037c7170cc7`
- Effective fingerprint: `88b190aecc5028a52c8bd68b1b3c8390d287d0ffe3d56e360898909da4fa8698`
- Extension plan: `e6acb018ccc89d5d1ede46f2171787021f96e841c7c14a7da6fb22568d793ae1`

The five relations have separate required lifetimes:

1. `team_game_associations`: stable team-local pair and target identity.
2. `team_game_decision_revisions`: immutable matcher evidence and explicit owner
   acceptance/rejection, including replay identity and provenance.
3. `team_game_publications`: the decision actually accepted by one published run.
4. `team_game_source_rows`: exact entitled native membership consumed by every
   grouped read/write surface; an explicit run-format marker separates legacy
   runs from newly normalized runs.
5. `team_game_publish_batches`: durable all-or-neither coordination of a move
   between two season pointers, including crash/retry recovery.

The only predecessor-table alteration is the immutable run-format column. Old
rows receive format zero and remain readable as legacy publication. Old building
runs restart in the new format. New format-one runs cannot infer missing member
rows through the legacy fallback.

## Preservation and release guard

The exact migrated 731 predecessor, real fresh-origin 731 receipt, exact 714 and
reviewed interrupted 714/fresh initialization prefixes are supported. The frozen
predecessor completes before the additive extension, without exposing an
intermediate ready state. Unrecognized objects, altered receipts, foreign plans,
open writer permits and wrong initialization passwords fail closed.

The extension-aware writer retains the predecessor permit and adds its own
permit. A batch of N application statements uses N+2 statements. Native D1 reports
meta.changes=2 for permit operations; exact RETURNING rows plus aborting SQL and
deferred foreign-key assertions establish atomicity. Existing 50-statement
invocation and 48-statement owner request limits are retained.

After extension bootstrap, deploying an old binary is not a supported rollback:
its writer is deliberately rejected. Recovery must use an extension-aware build
and the existing maintenance/roll-forward path. No reverse DDL, schema reset or
source reimport is supplied. Deployment must retain the existing DB, secrets,
cron, Durable Object binding and CPU configuration.

## Retained verification

The isolated storage foundation completed native preservation/failpoint tests
for exact 731→788 and fresh installation, all four supported predecessor origins,
and interrupted fresh initialization. Exact native permit rollback and actual
Live terminal collection remained within the 50-statement limit. Chained legacy
installation used at most 33 statements; interrupted fresh completion used at
most 37. These receipts predate consumer/projector integration and establish the
installation boundary only.

The final projector component separately completed creation, equivalent
replacement and atomic two-season movement with cleanup through 105 production
alarm invocations: 48 groups, 96 native members, both analysis catalogs and at
most 49 statements. Owner commands, source proofs, shared consumers and joined
workflow have their own scoped receipts. A schema pass alone is not full-product
or private-provider acceptance.
