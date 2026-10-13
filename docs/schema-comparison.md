# Existing database versus myTS 7.1.0

The existing `myts-v7` Worker can be retained. Its current database cannot directly run the 7.1.0 schema. The smallest clean solution is to change that Worker's `DB` binding to one fresh D1 database and preserve `myts-v7-data` unchanged.

## Evidence and scope

This comparison uses the actual schema source retrieved from GitHub's production `myts-v7` branch at commit `e5e92dccaecf741a88725b30e3bf068d93d048de` and the verified 7.1.0 release at review commit `37a043b03560b4d1664413930c472a3a853eafd1`. Dot reported 34 application tables in the existing database, including `installation`, `connections` and `jobs`, with no `setup_state`. The production schema source also defines exactly 34 tables. The attached live sqlite_master export was subsequently compared object by object with the normalized production fixture: all 45 SQL definitions match exactly, with no missing, extra or different objects. This verifies live schema metadata, not personal rows, credentials or source-data accuracy.

| Application objects | Production 7.0.1 schema | Release 7.1.0 schema |
|---|---:|---:|
| Tables | 34 | 121 plus installation's `setup_state` = 122 |
| Explicit indexes | 11 | 40 |
| Views | 0 | 10 |
| Triggers | 0 | 98 |

Counts exclude SQLite automatic indexes and tables beginning `sqlite_` or `_cf_`. D1/workerd internal objects are not application schema.

## Six incompatible names

| Name | Existing object | 7.1.0 object |
|---|---|---|
| `players` | Provider player with `provider`, `native_id`, `name`, `jersey`, `details`, `observed_at` | Canonical player: `id`, `created_at`; provider facts move to `source_players` and identity links |
| `competitions` | Provider competition, dates and JSON details | Canonical competition: `id`, `created_at`; facts move to `source_competitions` |
| `divisions` | Provider division, competition ID, name and details | Canonical division: `id`, `created_at`; facts move to `source_divisions` |
| `team_players` | Writable table: `team_id`, `player_id`, `active`, `scan_id` | Published view: `app_team_id`, `team_season_id`, `player_id`, `name`, `jersey`, `source_ids` |
| `coach_profiles` | `space_id`, `player_id`, season string and JSON `value` | Typed team/season/player profile with endurance, target minutes and a write token; positions are separate rows |
| `coach_sessions` | `space_id`, `fixture_id`, JSON `value`, revision and timestamp | Typed team/season/event clock, phase, format and write token; lineup, players, stints and timeline are separate rows |

The remaining structural changes are substantial:

- Provider teams and canonical myTS teams are separate, with explicit seasons, memberships and attachments.
- `fixtures` becomes provider `source_events` linked to canonical `events` and published season projections. Identity links, corrections and read revisions have explicit scopes.
- Old `jobs` use `kind`, `connection_id` and `cursor`. New `sync_jobs` require an account scope, authorization generation, component/stage, resource key, checkpoint and bounded publication state. Old subscriptions, cursors and leases are not usable by the new coordinator.
- Old provider ciphertext in `connections.secret` derives its key from `ADMIN_KEY` and uses an `iv.ciphertext` string. New credentials use an independently generated installation vault, an account-bound authenticated envelope and `security_account_credentials`. Existing encrypted values cannot simply be copied into the new tables.
- Owner sessions, sharing, preferences, bookmarks, reports, Trace facts, correction scope and Coach state are also new relations. The normal connection flows must reauthenticate private providers after a fresh install.

## Why weakening checks breaks the application

A local SQLite reproduction first creates all 34 existing tables, then executes the complete new `CREATE ... IF NOT EXISTS` schema. All DDL statements succeed because the existing names are silently retained. The resulting application still fails:

| Operation | Reproduced failure |
|---|---|
| Insert canonical player/competition/division | Table has no column named `created_at` |
| Read published roster | No such column: `app_team_id` |
| Read typed Coach session | No such column: `app_team_id` |

Creating a fake `setup_state` marker or removing the empty-database requirement would mark this incompatible combination as initialized. The safety check must remain.

The schema-isolation regression tests additionally create the full production schema with synthetic player, encrypted-credential placeholder, job checkpoint, correction and Coach rows. Initialization must reject it without changing any object definition or saved row. Release validation must reject the same old shape independently of its UUID.

## Smallest correct path

| Option | Consequence | Decision |
|---|---|---|
| Existing database directly | Six incompatible objects and incompatible record semantics | Unsafe |
| Reset existing database | Deletes collected data, credentials, corrections and Coach state | Requires explicit reset approval; unnecessary |
| Convert existing data in place | Requires a designed migration for identities, source ownership, corrections, Coach and credential encryption | Larger than a clean rebuild; not part of this release |
| Add a SQL namespace in the same database | Requires rewriting schema, queries, views, triggers and source SQL across the application; old data still needs conversion for use | Larger code change and greater collision risk |
| Fresh D1 bound to the existing Worker | Preserves old database untouched; clean schema with the same Worker, URL, branch, secret, scheduler namespace and cron | Recommended |

No existing rows are deleted by the recommended path. The new app begins empty; existing data remains in the old database for rollback and review rather than appearing in the new app. This distinction must be disclosed before deployment. Reusing the old database later requires reverting both the application code and `DB` binding, while retaining the original `ADMIN_KEY` needed to decrypt its provider records.

The retained Durable Object namespace holds scheduler status/alarm bookkeeping, not the source data or credentials. Existing alarms must check the new installation's readiness before querying its job tables, and old cached scheduler status must not be treated as evidence of new synchronization.

The read-only live schema metadata is confirmed. Before switching, Dot should record the active Worker version, binding and UTC cutover time; the unchanged old database is retained for rollback. After deployment, initialization and real provider imports must be verified through normal screens, followed by server timestamps showing background progress with every myTS browser tab closed. Automated tests alone do not establish completion.
