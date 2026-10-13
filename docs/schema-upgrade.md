# Preserved 7.1.4 installation upgrade

## Release decision and activation

This release upgrades the existing `myts-v7-rebuild-data` database in place. Production deployment is pinned to database `60f77502-33d4-41d6-80d4-1c5577ebba76`. Keep the existing `myts-v7` Worker, `DB`, `SYNC`, one-minute cron, owner key and provider credentials. The older database `c3585493-4ad5-44f2-9484-816a615ee633` is outside this transition and remains untouched.

**Deploying this candidate in normal mode authorizes and starts the transition.** A surviving scheduler alarm can start it immediately; otherwise the cron wakes the scheduler. This is not a quiesce-only deployment waiting for a second migration command. Each alarm advances one bounded durable phase and schedules the next. An open browser, owner login or repeated setup is not required.

Publication requires review of the exact candidate, target schema fingerprint, plan hash, local test receipts, and this activation/rollback boundary. No live deployment or configuration change is performed by the local tests.

## Exact admission, not generic migration

The one accepted source is the ready 7.1.4 schema:

- Fingerprint `e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003`, cursor `270`, one domain seed.
- 122 tables, 40 explicit indexes, 98 triggers and 10 views, including `setup_state`.
- Every physical SQL definition must match the frozen `src/application/schema-v714.js` manifest, not just the table names or stored fingerprint.
- Existing nonempty setup timestamps are retained. The known production completion timestamp is `2026-10-12T05:29:49.040Z`; each installation's actual original timestamps are recorded and compared throughout the transition.

The deployment guard also admits a partial transition only when its journal, semantic epoch, source/target fingerprints, plan hash, original setup identity, phase/cursor and exact physical prefix match this same candidate. It admits a completed target only with the complete exact physical schema, full cursor and a completed journal proving the preserved 7.1.4 origin, original cursor/timestamps and same plan. Missing physical metadata, a fresh-initializing target, or a completed fresh-origin target is rejected. Unknown/altered objects, another plan, another database UUID or an empty production database fail closed. Fresh local installations remain explicitly supported; they are not a recovery route for this production release.

The target identity is derived from the shared ordered `SCHEMA` and `SEED` in `src/application/installation-schema.js`. Obtain the reviewed values locally, without querying remote data:

```sh
node --input-type=module -e "import {schemaIdentity} from './scripts/release-check.mjs'; const s=await schemaIdentity(); console.log(JSON.stringify({fingerprint:s.fingerprint,planHash:s.planHash,cursor:s.schema.length},null,2));"
```

Record these values against the exact release artifact. Changing any target schema after review changes admission; never edit a live fingerprint to make an unreviewed build pass.

## Durable sequence

1. Inspect the full physical schema and setup metadata. Ordinary candidate HTTP routes, cron collectors and scheduler jobs stay unavailable while an upgrade is required or in progress. Health and safe bootstrap maintenance status remain available.
2. Atomically create the singleton upgrade journal and its own guards. Preserve the original setup state and timestamps. The journal has a separate start/completion time.
3. Install permanent insert/update/delete guards across every original table, at most 24 guards per alarm. Only sealing runs until all old tables are guarded. An old request may still finish against a not-yet-guarded table during sealing; no domain expansion or backfill starts until this phase is complete.
4. Add the reviewed typed connection/evidence and bounded public-history request tables, indexes, relation/dirty triggers and guards in exact order, at most 24 schema statements per alarm. All original objects stay unchanged except the three explicitly reviewed legacy parent definitions described below.
5. Reconstruct the two data-file job parents and the Coach session parent under their original names using ten exact temporary recovery copies. Copy and compare first; drain children before parents; atomically recreate empty parents and their indexes/guards; restore parents before children; compare every original field/byte in both directions; validate foreign keys; then clean the copies in bounded pages.
6. Backfill fixed legacy roots, exact season memberships/exclusions, durable command receipts, historical roster snapshots, and accepted canonical event-season evidence in bounded keyset pages.
7. Reinspect the exact target physical schema and run a native foreign-key check. Atomically compare the source setup identity, change only its schema fingerprint/cursor, complete the journal and clear the writer permit. Only then do application routes and jobs reopen.

Each phase update uses a checked phase/cursor compare-and-swap in the same native D1 transaction as its work. A concurrent loser or failed statement rolls back the complete batch. The next alarm resumes from the last committed cursor. Repeated backfill identifiers are deterministic and insertions are idempotent. No reset or database copy is used.

## Permanent old-writer barrier

Cloudflare deployment propagation is not a write-drain guarantee. A late HTTP request or old Durable Object invocation must not regain write access after maintenance ends. The per-table guards therefore remain permanently after completion.

The candidate wraps all application mutations, including authentication/session writes, prepared statement `run`/`all`/`first`, CTE writes and mutative batches. Each native batch opens an application permit for semantic epoch `team-connections-v1`, performs the supplied operations, then clears the permit. The two permit statements are charged to the real invocation budget **before** admitting the batch. Readiness, claims, provider pages, commit and follow-up reads share the unchanged 50-statement scheduler ceiling; application request budgets are unchanged too. Smaller work pages yield rather than raising limits.

An upgrade permit is distinct and may change journal metadata; an application permit cannot. Schema operations, direct journal writes and `exec` are rejected by the application wrapper. A deferred self-referencing foreign key prevents an open permit from committing. Failure or omitted cleanup rolls back data and permit together; another request cannot see a concurrent transaction's permit. The old binary never acquires the candidate epoch, so its raw writes fail even long after the transition completes. Installer writes have a narrow initializing/no-legacy-origin exception that cannot reopen a ready upgraded installation.

Cloudflare's documented code-update behavior can leave versions briefly mixed; the barrier does not depend on an assumed deployment grace period or lease duration:

- [Durable Object shutdown behavior](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/#shutdown-behavior)
- [Durable Object code updates](https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates)
- [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 foreign-key enforcement and transaction-end validation](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)

D1 documents transaction-wide rollback for a failed batch and transaction-end enforcement of unresolved deferred foreign keys. The specific deferred self-FK permit technique is established by the native local tests; the production transition has not been run by those tests.

## Preservation semantics

- Existing owner/vault/accounts, encrypted credentials, sessions, jobs/checkpoints, settings, saved projections and source records are retained. Existing season toggles remain untouched. The two data-file parent/child families move through durable same-database recovery copies during maintenance and return under their original names with every original value preserved. Final setup fingerprint/cursor change only after validation. Historical-roster backfill advances the derived serialization clock and adds roster version stamps; preexisting source version entries remain intact.
- Old attachment rows establish an exact allowed/excluded set, not proof of continuing intent. Roots use `fixed_seasons` with `scope_origin='legacy_ambiguous'`; old active/inactive memberships and generations are preserved. The UI may resolve future intent explicitly.
- File-import attachments retain their saved-data inclusion. Their provenance does not authorize provider collection; runtime collection checks provenance separately.
- Legacy request IDs become version-1 immutable receipts. Mapping uses the original stable attachment identity, including an inactive attachment. Missing originals receive tombstone-only unresolved identities, never another guessed attachment. Replaying a removed original does not resurrect it.
- Historical roster evidence snapshots the accepted published name/jersey, with `accepted_projection` and `preserved_uncertain`, rather than replacing history with the latest source roster.
- A single accepted canonical membership is preserved, including undated pending evidence. Existing duplicate/conflicting memberships retain every published row and explicit conflict evidence; migration does not arbitrate or silently delete them.

## Exact data-file and Coach parent reconstruction

`data_file_exports`, `data_file_imports` and `coach_sessions` are the only existing tables whose definitions change. The two data-file parents both gain `scope_kind`, defaulting to `legacy_season`; legacy rows require their original non-null season, while new `connected_history` rows require a null season. Imports additionally admit `validating`. Existing captured scope, sections/manifest, signatures, state, checkpoint, received/applied counters, expiry and IDs are never reinterpreted as full history. The three data-file child definitions and their foreign-key targets stay unchanged. Shared sync-job rows and leases are untouched.

`coach_sessions` expands only `half_minutes BETWEEN 5 AND 60` to `BETWEEN 5 AND 90`, restoring the original Coach duration range. The session parent and its four dependent tables (`coach_session_players`, `coach_lineup`, `coach_stints`, `coach_timeline`) are copied and compared byte-for-byte. Lineups, stints and timelines drain before captured players, then sessions; restoration reverses that dependency order. Running/paused/halftime clocks, open stints, availability, minute overrides, revisions, write tokens and timeline details are retained. Legacy position strings remain unchanged; presentation adaptation is outside migration.

The single journal's `transfers` phase explicitly recognizes `prepare`, `copy`, `verify_stage`, `drain`, `swap`, `restore`, `verify_final`, `cleanup` and `drop_copies`, including each exact temporary physical shape. The ten fixed typed copies have no foreign keys. Native keyset pages carry at most 16 rows and 4,000,000 measured stored-value bytes; only keys and sizes cross the Worker boundary. Decimal-string rowids preserve all SQLite integer bits. Original columns and BLOBs are copied and compared in SQLite, including both directions so missing and unexpected rows cannot pass on a count alone.

No drain begins before complete staged comparison. Children drain before parents in bounded pages. The empty-parent drop/create, original indexes, permanent mutation guards and journal cursor commit atomically. No application request can observe an unguarded replacement. Parents restore before children. Full comparison and foreign-key checks precede bounded copy cleanup; exact final schema validation still precedes ready admission.

Renaming a parent would rewrite child foreign-key targets, and deferring foreign keys does not suppress delete cascades. This plan avoids both assumptions and never disables foreign keys. See [SQLite ALTER TABLE behavior](https://www.sqlite.org/lang_altertable.html), [SQLite foreign-key actions and DROP TABLE](https://www.sqlite.org/foreignkeys.html), and [D1 query/row limits](https://developers.cloudflare.com/d1/platform/limits/).

Temporary copies need storage headroom. A copy-phase allocation failure leaves every original intact. Once draining begins, those committed copies are the recovery source: preserve them and resume the exact plan or use a compatible reviewed forward fix. They are not disposable scratch data. No permanent second transfer-table family or generic migration registry is introduced.

## Pause, recovery and rollback boundaries

The same reviewed candidate supports non-secret `MYTS_UPGRADE_MODE` values:

- Absent or `normal`: recognize and automatically advance the exact known transition, or run the completed application.
- `maintenance`: validate the recognized physical state but report maintenance, reject ordinary HTTP work and owner initialization, and suppress cron/DO collection and upgrade advancement. Health and safe bootstrap/status remain available. No schema or data is changed merely by inspecting this mode.
- Any other value fails closed before database work.

Changing this setting is a reviewed deployment/configuration operation, not a local-test action. For a compatible pause, deploy the same reviewed candidate with `MYTS_UPGRADE_MODE='maintenance'`, verify health plus bootstrap maintenance and scheduler status, then investigate the safe diagnostic. Resume by redeploying that same candidate with `normal` or no setting; the committed journal resumes automatically. This is a deployment-local pause: Cloudflare propagation and already-running compatible invocations may still finish. It is not a claim of instantaneous cancellation or a substitute for the permanent old-writer barrier.

Before any journal/guard exists, an independently verified exact 7.1.4 database can still use its previous binary. **Once the journal has been created, rolling back to the 7.1.4 binary is incompatible, even before typed-table expansion.** After that point, recovery is a same-candidate maintenance pause or a separately reviewed compatible forward fix. Do not remove guards, drop the journal/tables, reset setup, clear receipts, change the fingerprint manually, restore the old binary over the expanded database, or switch database bindings.

On a lost response, crash or native batch error, retain the database and retry the same plan. A committed page is recognized by its durable cursor; an uncommitted page leaves neither work nor permit behind. On physical mismatch, unexpected data-integrity failure or a plan mismatch, preserve evidence and pause for review rather than forcing progress. Existing leases/jobs remain available for normal bounded recovery after the installation is ready.

## Required verification before publication

- Native D1 proof of every old table/row preserved, original timestamps retained, bounded phase progress, failed-CAS rollback, failed permit cleanup rollback/recovery, stale old mutations denied, CTE and authentication paths gated, and N+2 budget admission.
- Native fresh initialization remains valid, while ready initialization cannot be reopened; unknown physical source/target changes cause no migration writes.
- Native published membership conflict/undated preservation and uncertain roster snapshots; immutable version-1 receipt/removal behavior.
- Assembled HTTP/cron/DO tests for automatic closed-browser progression, maintenance mode, unknown-mode fail-closed, and normal resumption. Near-limit source workflows pass without raising limits.
- Deployment-entrypoint tests prove the awaited read-only remote guard rejects empty, malformed, foreign and mismatched states before publication. Exact known source/partial/target acceptance uses physical definitions.
- Final artifact identity, aggregate tests and build receipt must refer to the exact candidate. Synthetic local tests do not prove a live provider or hosted deployment; record those separate acceptance checks after any authorized publication.

## Local transition receipt, 2026-10-12

The receipt below covers the frozen 717-statement runtime after four additional source-player/division dirty triggers. The current source has since gained imported-snapshot scope checks, three roster serialization triggers, two bounded public-history request tables and the connected-history transfer-parent reconstruction (730 statements), followed by the staged-section expression index (731 statements). The 730 exact-target native proof is recorded below; the current 731 target requires its own final receipt. The 717 receipt is historical evidence for its exact target, not acceptance of those later schema changes. The earlier 713-statement proof is historical too. Later schema changes still require another exact-target receipt.

The focused native transition suite passed **7/7**, zero failures/skips, in 33.816 seconds. It used actual local Workerd D1/SQLite and Durable Object alarms, with synthetic rows and Cloudflare metadata fetching disabled. The tested target contained 717 ordered schema statements, 129 tables including setup, 47 explicit indexes, 531 triggers and 10 views. Target fingerprint: `f85d5890651c6b614ac76b550314af1d32cae5bae1e1dbd211a795f6c284ccb0`; plan hash: `146335c3d70c740db452b7ff30035630b16d021978f2e36e5f806384d54c5f6f`.

The seven cases cover SQL admission; exact preserved-source upgrade with every old-table row unchanged; guarded fresh setup; unknown physical source rejection; maintenance across production HTTP/cron/native DO entrypoints and same-plan resumption; unknown-mode fail-closed; and normal automatic alarm progression without browser writes. The logged foreign-key failure is the intentional omitted-permit-cleanup case; subsequent assertions verify the rollback and successful recovery.

The separate fake-Wrangler deployment-entrypoint suite passed **12/12**, zero failures/skips, in 46.111 seconds. It tests the actual npm deployment command sequencing against synthetic metadata; it does not run a real remote query or deploy. The focused static release configuration/packaging and preserved-origin admission cases passed 5/5. Owner/authentication, complete near-limit source workflow, UI presentation and final aggregate/build receipts remain separate acceptance evidence. Any later target-schema change requires another exact-schema receipt. No production upgrade has been executed by this verification.

The subsequent frozen-717 combined owner/release run finished **14/16**, with two failures and no skips, in 186.229 seconds. All seven release cases passed. Seven owner cases passed; the other two stopped on local Miniflare/Undici transport errors, one during fixture schema preparation and one during read-only credential inspection after password-rotation assertions. The isolated owner semantic cases have separate passing receipts, but this combined run is not a clean owner aggregate. Test-only connection/cleanup changes did not eliminate all transport failures, and no production authentication behavior or retry policy was changed to chase a passing result.

The separate native transfer-reconstruction feasibility case passed **1/1**, no failures/skips, in 14.169 seconds: 282 bounded two-row pages, peak 25/50 statements, preserved parent/child byte hashes and sync jobs/setup, rollback at copy/drain/swap/restore, lost-ack/stale-cursor replay, Worker restart, and corruption/physical-drift rejection. It used a subset schema and placeholder identity; it is mechanism evidence, not final-target acceptance.

A separate 720-statement fresh-owner regression exposed a real request-budget bug: the final schema page left 45 of 48 statements used, while the gated owner batch needed five. The initialization route now returns a 202 continuation after every schema page, including completion, and performs owner derivation/commit on the next fresh request. Its native regression passed **1/1** in 11.431 seconds, with no owner/vault/session/cookie on schema completion and exactly one of each record on the next request. Budgets and cryptography were unchanged. This issue is distinct from the earlier localhost transport failures.


### Exact 730-statement target

The integrated frozen target passed **7/7 native cases**, zero failures/skips, in **113.511 seconds**. It contains 131 tables including setup, 49 explicit indexes, 540 triggers and 10 views. Fingerprint: `1c332796e7abced063458b963a9930d8e630701e25c54904169878be8316020f`; plan hash: `6f6997a8c1b9958676924e6d84c7273593b5882cc23ba9b549a7c0025c959c63`.

The full original-database preservation case completed 136 pages with a peak of 30/50 statements. It preserved original file scope/signatures/state/checkpoints/expiry, 64 KB BLOB parts, 700 KB staged segments and a rowid above JavaScript's safe-integer range. The 4 MB cap limited a segment page to five rows despite the 16-row ceiling. Native rollback was injected inside copy, drain, parent replacement and restore; lost-response/stale-cursor replay and every intermediate remote release-manifest shape were verified. The only expected source metadata delta was the derived roster serialization clock/stamp described above. Exact fresh installation, maintenance/mode gates and stale writer guards also passed. The normal candidate completed its entire transition through actual native alarms without browser writes in 53.305 seconds.

This receipt proves the frozen schema and transition mechanism locally. It does not claim production migration, final H2H/file service behavior, the final complete-product aggregate or the eventual packaged source artifact has passed those separate gates.


### Intermediate 731-statement target before Coach constraint refinement

This intermediate schema contract contained 731 ordered statements. Its fingerprint is `9c0d7f6e86c81b4889ee33a4ce348f215c4ce0beadb1a311a666946f5c6033e2` and plan hash is `946fb144d504c18c52dd42aa77945e2cd2151e44e2fa571ab218edf749cd0191`. The schema deltas after the 730 receipt are the staged import-section expression index, used to bound portable-history graph validation, and the exact native participant lineage column on the unreleased public-history receipt table. This lineage is captured from the admitted pair and inherited without broadening into descendants. Its exact native transition suite subsequently passed **7/7**, no failures/skips, in **107.077 seconds**. The preservation case completed 136 pages at a peak of 30/50 statements; automatic native alarm progression took 42.558 seconds. The corresponding fake-Wrangler deployment guard passed **12/12**, no failures/skips, in 41.819 seconds. This receipt predates the Coach constraint change and does not accept that newer target.


### Coach-preserving 7.2.0 exact-target receipt

The single Coach duration CHECK refinement retains 731 ordered statements, 131 tables including setup, 50 explicit indexes, 540 triggers and 10 views. Its fingerprint is `e1c1b6cf96cd12afce94dc14819e103283aacac2f420329cfaf65938888e4f40`; plan hash is `755a9a58c834e2a469c8d12e91acd9e51e67800efc7cb4c5e315e037c7170cc7`. The exact plan now records ten recovery-copy definitions and all three reviewed replacement parents. Static SQLite inspection verified every copy column matches its exact original definition. The exact-target native transition suite passed **7/7**, no failures/skips, in **160.416 seconds**. Full preservation took 223 bounded pages at a peak of **33/50 statements**. All original-table values were retained, including five Coach sessions spanning setup/running/paused/halftime/finished, duplicate canonical choices across seasons, legacy LF/RF positions, unavailable captured players, minute overrides, open and closed stints, revisions/write tokens and twenty near-16 KB UTF-8 timeline records. The target accepted a 90-minute duration after comparison. Automatic native alarms completed the transition without browser writes in 61.507 seconds.

A separate native committed-interruption case passed **1/1** in **12.406 seconds**: lost acknowledgements after the final Coach child drain and the atomic parent swap, stale-cursor rejection, continued bounded recovery, exact restoration of all five Coach tables and unchanged child foreign-key targets. It completed 163 pages. A final-target native fresh-owner boundary case passed **1/1** in **6.881 seconds**, preserving the separate schema-completion and owner-derivation requests. The corresponding fake-Wrangler deployment-entrypoint guard passed **12/12** in **25.837 seconds**.

These receipts cover the frozen schema and its recorded runtime dependencies, including the pure shared Coach tactics module. The full product/report artifact can evolve independently and requires its own final aggregate/build and authorized hosted checks. No production transition was executed by these local tests.
