# myTS 7.2.6 attendance throughput

See [the bounded page preference, compact storage sizing and verification](attendance-throughput-repair.md). This code-only update keeps valid active scan cursors unchanged and uses a larger preference only for new attendance traversals. All response/transaction/checkpoint limits, schema, provider identity, refresh cadence and deployment configuration remain unchanged. Do not reset or restart the live import. Earlier sections retain their historical receipts.

# myTS 7.2.5 Schedule order repair

See [the shared query policy and acceptance](schedule-order-repair.md). This read/UI-only update restores the original Past/Upcoming/Day ordering, known-kickoff-before-TBD local-day ordering and historical-season behavior. It preserves the schema, source jobs, attendance recovery and all saved data. No source refresh or account reconnection is needed. Existing cursors whose effective selection changes are rejected and the browser reloads the first page. Earlier sections are historical receipts.

# myTS 7.2.4 TeamSnap attendance identity repair

See [the evidence-directed repair and acceptance](attendance-identity-repair.md). This code-only update preserves the schema, bindings, CPU budget, credentials, connection/job identities and all saved records. Attendance changes its pagination identity to the validated event/member pair; old attendance identity checkpoints safely begin one full revalidation. Events and their retained full-history/recent receipts are unchanged. After health reports 7.2.4, use TeamSnap Manage → Retry attendance once for the failed job. Earlier sections are historical receipts.

# myTS 7.2.3 attendance diagnostics

See [the diagnostic scope and targeted retry](attendance-diagnostics.md). This code-only update preserves the 731-statement schema, upgrade plan, source validation, existing records, account/root identities and deployment configuration. The live attendance failure predicate is still unidentified. Deployment adds privacy-safe static failure diagnostics and a narrowly scoped owner retry in TeamSnap Manage; it does not automatically retry or reset completed event history. Earlier version sections retain their historical receipts.

# myTS 7.2.2 connection throughput repair

See [the bounded repair and measured acceptance](connection-throughput-repair.md). This is a code-only update of the existing 7.2.1 installation. The 731-statement schema, upgrade plan, original setup timestamps, data, credentials, root identities and deployment configuration are unchanged. Queued connection reconciliation resumes from its current canonical cursor; do not reset or restart the provider scan. Final native and artifact receipts are required before deployment. The following 7.2.1 and 7.2.0 sections preserve earlier receipts and recovery instructions; they are not new acceptance claims for 7.2.2.

# myTS 7.2.1 TeamSnap collection repair

See [the repair, exact scope and live recovery](teamsnap-pagination-repair.md). This code-only patch preserves the completed 7.2.0 schema, original setup timestamps, database and account/connection identities. Deployment alone does not retry permanent failed jobs; use the existing TeamSnap Manage → Update now after verifying version 7.2.1. The following 7.2.0 transition ledger is historical and remains applicable only when starting from the exact older 7.1.4 installation.

# myTS 7.2.0 integrated release verification

This candidate restores the original 6.20.133 product workflows on the rebuilt
backend. The following earlier 7.1.x sections are historical receipts, not claims
about this candidate's files or schema. Final source, aggregate and package evidence
is recorded in `integration-checkpoint.md` and the 31-gate parity ledger.

## Deployment boundary

Deploying this candidate starts the explicit preserved-data transition through the
existing scheduler alarms or cron. It is not a quiesce-only deployment. The target
is the existing `myts-v7` Worker and `myts-v7-rebuild-data` database
`60f77502-33d4-41d6-80d4-1c5577ebba76`. Preserve the other database
`c3585493-4ad5-44f2-9484-816a615ee633`, ADMIN_KEY, SYNC binding/namespace, cron,
preview setting and the 30,000 ms HTTP CPU budget. No schema import or reset is used.

Only the exact reviewed 7.1.4 physical schema, its ready setup receipt, or a valid
checkpoint of this exact transition is accepted. The target has 731 installation
statements and fingerprint
`e1c1b6cf96cd12afce94dc14819e103283aacac2f420329cfaf65938888e4f40`;
plan hash is
`755a9a58c834e2a469c8d12e91acd9e51e67800efc7cb4c5e315e037c7170cc7`.
Unknown or inconsistent schema/journal states fail closed. Original setup timestamps
and data survive; the completed target cursor reflects the new schema rather than
pretending the old 270-statement cursor is its full progress.

The transition durably fences old writers and drains/reconstructs three existing
parent tables using ten bounded recovery copies. This preserves file-job IDs,
checkpoints, entries and binary parts, and Coach sessions, players, timeline and
intervals while restoring the 90-minute half limit. The native exact-schema proof
passes 7/7; committed drain/swap interruption recovery and fresh-owner boundary
pass separately 1/1 each. See `schema-upgrade.md` for the exact activation, pause,
recovery and compatible rollback sequence. Once the transition starts, reverting
blindly to a 7.1.4 binary is not a compatible rollback.

## Remaining release acceptance

The frozen deterministic/DOM/SQLite aggregate passes 653/653. The broad native
aggregate originally finished 155 pass / 11 fail / three skip; every failed/skipped
record now has a scoped passing rerun after reviewed repairs. The final isolated
lifecycle groups pass 6/6 with zero skips. These are distinct receipts, not a claim
that an unchanged full aggregate was rerun. See the exact chronology and source
identities in `integration-checkpoint.md`.

The required-only package contains 191 files plus its manifest. Clean locked install
and dry-run build pass (1,686.33 KiB Worker, 371.35 KiB gzip). Its runtime/assets
fingerprint is `ee58b05e8e537d9f1b0d822ae8047dc54db163e937b08468c9d701362e5464e3`.
Final archive/tree identity and independent extracted native acceptance travel in
the release receipt. The exact schema/transition proofs above remain unchanged.
No remote publication, deployment or database transition was performed by this
local engineering checkpoint.

After reviewed publication/deployment, verify health version 7.2.0 and actual ready
state, preserved timestamps/rows/authentication, then complete the original
provider-to-team-to-history workflow, correction persistence, shared views,
reports, Coach and closed-all-tabs scheduled changes. Synthetic Workerd tests do
not establish live private-provider entitlement, production quota or physical
mobile behavior. Those gates remain explicit in `parity-gates.json`.

---

# myTS 7.1.1 deployment correction verification

This correction starts from the exact required-only ZIP at GitHub review commit 37a043b03560b4d1664413930c472a3a853eafd1. Its manifest and all 125 listed files were byte-verified before editing. Original ZIP SHA-256: 9c933f6d4c9baf91ee49c680fdbc6de2499172ab09b1421509c33e666a7c7ae8.

The previous 7.1.0 verification ledger remains historical evidence. This document records the corrected deployment target and retained-namespace runtime checks. It does not claim production deployment, real-provider acceptance or a physical-phone check.

## Scope

- Reuse Worker myts-v7, class SyncRuntime, existing scheduler object/namespace, one-minute cron and existing ADMIN_KEY.
- Isolate the fresh application schema in myts-v7-rebuild-data. Preserve the previous database ID and all its data; no migration, reset or compatibility readers.
- Retain remote metadata, schema fingerprint, foreign-table and placeholder deployment guards; correct the target identity/messages and permission failure guidance.
- Inspect initialization before alarms run, postpone old alarms until ready, exclude old status by installation identity and retain transient failure recovery.
- Maintain the existing source-page query allowance while accounting for installation metadata within the native invocation limit.
- Publish corrected instructions explaining atomic code/binding cutover, empty new app, provider reconnect and rollback.
- Visible version and pinned lock updated consistently to 7.1.1. Existing frontend assets and feature modules are unchanged.

## Evidence boundaries

Production schema definitions were retrieved from the myts-v7 branch at e5e92dccaecf741a88725b30e3bf068d93d048de. The attached live sqlite_master export confirms 34 tables and 11 indexes, including installation/jobs/connections and no setup_state. All 45 definitions match the exact production fixture. No application rows or credential values were read.

Native tests use actual local Workerd/D1/SQLite Durable Objects. Private-provider responses are synthetic. Local closed-browser tests establish native alarm behavior, not real Cloudflare/provider execution. Clean npm ci completed successfully using the committed lock and pinned Wrangler 4.149.0. The final corrected source passed all 59 tests and the build dry run.

## Configured release and deployment hold

The fresh database UUID is configured as 60f77502-33d4-41d6-80d4-1c5577ebba76, for myts-v7-rebuild-data. The user confirms its emptiness query returned no application tables, nonproduction builds are disabled after reload, the selected token has existing D1 access, and production/bindings/secret/cron remain unchanged. Earlier read-only handoff observations that the new database did not exist and nonproduction builds were enabled are superseded by this confirmation.

Publishing is held for cutover review. The configured commit will be saved only on myts-review. The real remote database guard, Cloudflare execution and provider acceptance remain pending approved deployment; no Cloudflare login or publishing command was run here.

## Final local receipts

| Check | Result |
|---|---|
| Clean npm ci | PASS; 40 packages installed, committed lock, Wrangler 4.149.0 |
| npm test | PASS: 59/59, 0 failed, 0 skipped; 156.729 seconds |
| Separate assembled application rerun | PASS: 5/5; fresh setup, four reports, public import/correction/inclusion/share/remove, dataset round trip and Coach |
| Retained-namespace runtime | PASS: 4/4; empty/partial/foreign database protection, old status exclusion, transient retry, public import at <=50 statements/run |
| Schema preservation / release guards | PASS: 12/12; full 34-table production fixture and every saved fixture row unchanged after rejected setup |
| npm run build | PASS; Wrangler dry run, 27 assets, 1070.30 KiB uncompressed bundle, existing myts-v7 target and isolated rebuild DB |
| Deployment configuration validator | PASS with the new UUID; explicit old-ID/placeholder cases still rejected |
| Frontend preservation | All 24 original web files byte-identical to verified 7.1.0 ZIP |
| Independent review | No blocking code/config defect; build cancellation and rollback CI safeguards added to handoff |
| Live schema comparison | PASS: all 45 definitions match the production fixture |
| Cloudflare deploy guard / deployment / real providers | PENDING; no remote inspection or publishing run here |

The 4 runtime and 12 schema/guard checks are subsets of the 59-test final run, not additional distinct tests. The standalone assembled 5-test run independently repeats the corrected runtime. npm test is reproducible in the review repository; fixtures are synthetic and excluded from required-only packaging.

The readiness regression was caught before publication: installation reads initially reduced the coordinator's allowance and forced a public page into invocation_budget retry. The fix returns started_at in the existing metadata query and preserves the 48-query work allowance plus two installation reads within one 50-query shared budget. The full-import regression records every invocation and verifies the ceiling without skipping readiness.

Runtime fingerprint: a2e818e77ce33f12472927779e449e5a7c600395fff4ef7a4e7c6d4b441914ea. Algorithm: SHA-256 of JSON.stringify of ordered {path,sha256} entries for the 104 required worker.js/src/web files. Fresh schema fingerprint remains e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003. There are 121 schema table definitions, plus setup_state for 122 installed application tables.

The regenerated manifest records the configured UUID and every required file, including final instructions and this ledger. The deployment-blocking placeholder is replaced; foreign/old-schema and remote inspection guards remain. Production stays unchanged until the configured commit is approved and promoted.

## Configured UUID rerun

Configuration finalized on 2026-10-12 UTC: DB points to myts-v7-rebuild-data, UUID 60f77502-33d4-41d6-80d4-1c5577ebba76. npm test passed 59/59 again (0 failures, 0 skips; 156.729 seconds). npm run build passed against that configuration (27 assets, 1070.30 KiB Worker). The deploy-mode configuration validator passed locally; it did not perform a remote D1 query or deployment. The runtime and all frontend files remain byte-identical to the previous tested 7.1.1 review; only configuration, its test and evidence/instructions/manifest were finalized.

All 45 attached live schema definitions match the production fixture. The user's latest preparation confirmation supplies the empty fresh database, disabled nonproduction builds and retained existing D1 token access. Approval is still required before advancing production. Exact code/DB cutover, resource verification, rollback and real-provider/background acceptance are in fresh-deployment.md.

## Deployment-guard follow-up

The production build reported Remote rebuild database inspected: undefined. The cause was main() reading the Promise returned by async inspectRemote(identity), rather than awaiting its result. The success line could therefore precede error handling. The entry now awaits the inspection before reading state, reporting success or letting npm's && pipeline proceed to Wrangler deployment. It still queries and validates the same remote schema metadata. The query envelope must now be nonempty, each result must report success:true, and each must contain a results array; missing completion evidence is rejected instead of being mistaken for an empty database.

wrangler.jsonc explicitly sets preview_urls:false. This setting controls Preview/Version URLs separately from whether Cloudflare Builds runs nonproduction branches. The production workers.dev URL remains enabled. The release configuration validator rejects omitted or enabled Preview URLs.

The follow-up affects deployment tooling and configuration only. Worker modules, frontend, DB target/UUID, ADMIN_KEY lifecycle, SYNC class/export and cron are unchanged. Production retains commit b9e69bea028172d13f59e6dcedd8f7d6c329e495 until this follow-up is approved.

Regression tests execute the actual npm run deploy pipeline in an isolated copy of the required release. A local Wrangler stub supplies metadata/errors and records whether the publish step was reached; no credentials, Cloudflare login, remote queries or real deployment are used. Tests cover correct status reporting and inspection failures, including warning-mode unhandled-rejection policy so failing closed does not depend on Node's default crash behavior. Follow-up receipts: 14/14 targeted tests passed (7 actual deploy-pipeline cases and 7 native release/schema cases), with no failures or skips; npm run build passed using pinned Wrangler 4.149.0, 27 assets and the unchanged 1070.30 KiB Worker. The earlier 59-test runtime baseline remains applicable to the byte-identical Worker/frontend; this follow-up does not claim a new full 66-test run. An isolated control using the original unawaited call plus warning-mode rejections did reach the fake deployment step after a failed query, proving the regression catches the reported defect. No shared source was changed for that control.


## Owner initialization follow-up: 7.1.2

This section supersedes the earlier publication holds and verification boundaries for 7.1.1. Production reached commit 8411d36d9a2a6f66df35fdf83c7964d7a13509c8; this correction is prepared for myts-review only. The user reports setup ready at cursor 270 with the complete 122-table schema and one domain seed, and owner/vault/session counts 0/0/0 after initialization returned HTTP 500. No live query, reset, credential read or publication was performed during this correction.

Both a native PBKDF2 cap rejection and an aborted owner batch reproduce the zero counts. These native reproductions do not identify the original live exception. Local Workerd accepting 600,000 rounds does not establish hosted support. The shared verifier now computes exact standard PBKDF2-HMAC-SHA256 through pinned Noble 1.7.1, retaining the 600,000 work factor and existing hash compatibility. License and provenance ship with the release.

Owner, vault and first session commit atomically. A unique nonce guards concurrent session issuance, and retries verify the stored password without replacing the vault. Bootstrap and the form distinguish schema ready / owner pending and reread persisted state after an error. Diagnostic logs expose only the event, bounded phase and known error class.

| Current check | Result |
|---|---|
| npm test | PASS: 79/79, 0 failures, 0 skips; 168.493 seconds |
| Focused owner suite | PASS: 9/9; native D1 prehash/each-statement rollback, post-commit/lost-response retries, existing vault, concurrency, stored password authority and actual API login/rotation |
| Independent PBKDF2 vectors/provenance | PASS: 4/4; Node reference at 100k/600k, Unicode/NUL/long UTF-8, vendor digests, native PBKDF2 forbidden with a simulated 100k cap |
| npm run test:browser | PASS: 3/3, 0 skips; mobile Chromium form/controllers, owner-pending selection, stale 88% recovery and lost response followed by login |
| Deployment npm pipeline regressions | PASS: 7/7; awaited success reporting and failed/malformed/foreign inspection prevent publishing |
| npm run build | PASS; Wrangler 4.149.0 dry run, 27 assets, 1084.43 KiB uncompressed Worker, 255.42 KiB gzip |
| Independent code review | No blocking authentication, race or data-preservation defect found |
| Schema and configuration | Schema fingerprint unchanged; wrangler.jsonc byte-identical to 8411d36, including DB UUID and preview_urls:false |
| Production CPU, owner retry, real providers and closed-browser processing | PENDING live verification by dot after approved deployment |

The focused owner/verifier/guard checks are subsets of the 79 native tests. The three browser tests run separately and require Playwright/Chromium; they are outside the default native command. Local Workerd measured about 1.7–2.0 seconds wall per 600,000-round derivation. This is not production CPU evidence. Dot must inspect the actual Worker CPU setting before promotion and record live initialization, login and rotation outcomes afterward.

The required-only runtime graph contains 114 worker/src/web files, including the vendor modules and provenance. Runtime fingerprint: f1ab6c94561e5095b83622ee403b6099e68ba8531f28fc5c9bcf1b23c4129e76, using the same ordered {path,sha256} JSON algorithm. Schema fingerprint remains e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003: 121 table definitions plus setup_state. Version 7.1.2 is consistent in source/package/lock. No schema statement or seed changed.

Exact promotion and no-reset live retry instructions are in owner-initialization.md and fresh-deployment.md. Preserve both databases, ADMIN_KEY, SYNC and the minute cron. This patch performs no data-loss operation. Full rebuild acceptance remains open until real provider sync and background persistence after all tabs close are observed.

The required-only staged package independently passed owner initialization under the simulated native cap and the actual API login/password-rotation/credential-retention lifecycle (two selected tests, each passing). All 114 runtime files in the final package are byte-identical to that tested stage; only the final evidence documents were completed afterward.

## Explicit owner CPU budget follow-up

This follow-up starts from the exact myts-review commit 37b85063e6d1417abd71c0268800e8b00f085bd4. All 158 repository blobs and its Git tree (5aaa406fc002fa3f6796803a558a2f1265c92e0a) were hash-verified before editing. The source runtime, frontend, cryptographic implementation, package versions and lock remain byte-identical. The 114-file runtime fingerprint is still f1ab6c94561e5095b83622ee403b6099e68ba8531f28fc5c9bcf1b23c4129e76, and schema fingerprint remains e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003.

wrangler.jsonc now explicitly sets limits.cpu_ms to the reviewed value 30000. The release validator rejects an omitted, lower, higher or nonnumeric budget before remote inspection or publication. Unit tests exercise both ordinary and deployment validation; isolated actual npm-deploy pipeline regressions assert that missing, insufficient and unreviewed larger budgets cannot even reach the Wrangler remote-query stub. The larger-budget rejection deliberately prevents an unreviewed quota change, not a claim that larger values are technically invalid.

The only resource-configuration change is that explicit HTTP CPU budget. DB remains myts-v7-rebuild-data / 60f77502-33d4-41d6-80d4-1c5577ebba76. ADMIN_KEY, SYNC, minute cron and preview_urls:false are preserved, and no production query, write, deployment, schema replay or database reset was performed during this follow-up.

Cloudflare documents that local development does not enforce this CPU limit. The existing account must support the setting, and the effective hosted budget plus actual initialization/login/rotation CPU must still be verified. An explicit configuration and local tests do not establish production acceptance. See [Wrangler limits](https://developers.cloudflare.com/workers/wrangler/configuration/#limits) and [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

### Current cloud verification, 2026-10-12 UTC

The earlier 79/79 native and 3/3 browser receipts above belong to the preceding owner-fix run. They are historical evidence, not the outcome of this follow-up rerun. In particular, the earlier configuration byte-identity statement is superseded by the explicit CPU setting described here; only Worker/src/web runtime byte identity is retained.

| Current check | Result |
|---|---|
| Clean pinned npm ci | PASS; 40 packages, unchanged lock and Wrangler 4.149.0; writable temporary npm cache used |
| CPU budget and actual npm-deploy pipeline | PASS; exact-budget unit test and all 10 deployment-pipeline cases, including rejection before remote queries or publishing |
| Complete native suite, one test file at a time | FAIL: 74/83 passed, 9 failed, 0 skipped, 0 cancelled; 923.400 seconds; Node 24.19.0 |
| Password verifier/reference/provenance tests | PASS: all four verifier tests in the complete run |
| Independent additional password reference comparisons | PASS: eight Node reference vectors, including 600,000 rounds, 64/65-byte HMAC boundaries, Unicode/NUL/lone surrogate and a 300-character password |
| Source npm run build | PASS; Wrangler dry run, 27 assets, 1084.43 KiB Worker / 255.42 KiB gzip |
| Extracted required-only ZIP | PASS: all 138 listed files match manifest byte counts and SHA-256 values; ready-schema owner initialization passed |
| Extracted package lifecycle checks | FAIL: initial two-case run passed initialization and failed lifecycle on a local socket close; one later isolated lifecycle rerun failed after 36.093 seconds on a direct D1 credential read following successful initialization/login/rotation and stale-password rejection |
| Browser rerun | BLOCKED before application execution; installed cloud Chromium aborts with local IPC socket EPERM, including the approved elevated launch; no browser rerun pass is claimed |
| Independent CPU patch review | No blocking configuration, guard or regression-test defect found |

The complete run used `node --test --test-concurrency=1 --test-reporter=tap tests/*.test.js tests/*.test.mjs`. The initial concurrent npm test run was stopped after failures; application and test timeouts were not changed to obtain a pass.

Seven failures are local Miniflare/Undici `fetch failed` transport exceptions: the owner HTTP lifecycle, assembled reports, owner batch-fault/retry, committed-response retry, concurrent rotation loser, concurrent initialization winner and native login/rotation lifecycle. The failing operations vary between runs and include logout and direct D1 bridge reads, not only password derivation. Two further failures are bounded background-settlement timeouts: the greater-than-128-season fan-out and assembled public-connection workflow. These remain unresolved baseline/local verification failures; they are not a clean full-suite pass or proof of an application defect. Both affected native harnesses construct Miniflare inline and do not consume wrangler.jsonc, and this follow-up does not change their runtime code.

The same complete run passed ready-database owner initialization, existing-vault preservation, stored-password authority, concurrent initialization, schema isolation, native alarm processing, and the full public-import 50-query ceiling. Those passes do not erase the failures above. Hosted owner/CPU and real-provider/background acceptance remain pending; no production promotion is claimed by this ledger.

## 7.1.3 provider connection simplification candidate

This candidate starts from deployed/review commit
f66c594cd48dba7f663a657ba34e4b45a6c302e3 (tree
de444e9c790d9dd721afd4d392dd2e3d9a0bde59). Earlier 7.1.1/7.1.2 receipts above
remain historical, not a claim about this candidate. Runtime files now intentionally
differ for provider flows; wrangler.jsonc and the 30,000 ms CPU release guard are
unchanged. Package/lock version markers and health are aligned at 7.1.3, with the
same pinned Wrangler 4.149.0 and no dependency changes.

The patch is bounded to the connection controller/presentation, account recovery,
public search filters and metadata, and atomic new-team connection/recovery.
TeamSnap still requires a real registered Client ID and exact callback; app setup
and repair remain owner-managed in the existing config table. Trace still needs
its actual email code and entitlements. No provider credentials, grants, account
permissions, production rows, schema imports or deployment changes were made in
this engineering pass.

Schema fingerprint remains
e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003:
122 installed tables (121 application definitions plus setup_state), 40 indexes,
98 triggers and 10 views. Preserve ready cursor 270, its existing completion
timestamp, both databases, DB binding, ADMIN_KEY, SYNC and cron. No reset is part
of deployment. The coordinating hosted 7.1.2 owner check succeeded with HTTP 200,
1,478 ms CPU and 1,637 ms elapsed; owner/vault/session counts were 1/1/1 and the
ready setup identity remained unchanged. That is prior-release live evidence,
not provider or closed-browser acceptance for 7.1.3.

### Final local receipts, 2026-10-12 UTC

| Check | Result |
|---|---|
| Full serial suite | FAIL: 154/159 passed, 5 failed, 0 skipped/cancelled; 933.487 seconds |
| Final real-DOM connection suite | PASS: 40/40, zero skips; actual createApp/features with stub HTTP and jsdom 26.1.0 |
| Atomic connection and read-only receipt native suite | PASS: 13/13; actual D1 transactions/HTTP, maximum 38/48 statements |
| Deterministic controller/discovery/provider recovery subset | PASS: 22/22; also independently repeated |
| Added native provider recovery cases | PASS: 2/2; also included in full suite |
| Source build | PASS: 140 required files, 28 web assets; Wrangler dry-run bundle 1099.96 KiB / 258.41 KiB gzip |
| Required-only ZIP byte verification | PASS: 140 manifest entries, exact byte counts/SHA-256, no mismatches |
| Extracted required-only package build | PASS: release check and Wrangler dry run; no publishing or native/browser acceptance implied |
| Independent code review | No blocking finding through runtime checkpoint 52f44146f56c7e8e9feca5d8c0ea473918728cbe; final artifact audit recorded separately |
| Actual Chromium/mobile/live providers/closed-browser hosted import | PENDING; cloud Chromium execution blocked before app startup by IPC restriction |

Full command: `MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom/lib/api.js node --test --test-concurrency=1 --test-reporter=tap tests/*.test.js tests/*.test.mjs`.
The full run contains the original 39 DOM cases. Its only later runtime delta was
two pending-intent guards for alternate account/search entry points; the complete
final 40-case DOM suite separately passed those guards and a new direct-entry
assertion. Do not add overlapping focused counts to the full-suite total.
No production timing or test timeout was increased to obtain a pass.

Five full-suite failures remain visible:

1. The existing greater-than-128-season fan-out did not settle within its bound.
2. The installation/public-import 50-query workflow did not settle. It did not
   report a query-ceiling assertion or a failed/blocked/retrying job before timeout.
3. The assembled public connection/corrections/inclusion/share/removal workflow
   did not finish its background wait.
4. The assembled data ZIP export/staged-import test hit an Undici `fetch failed`
   on its initial application HTTP request, before export/import acceptance.
5. Native owner login/rotation hit an Undici `fetch failed` in a direct D1
   credential read through ProxyClientBridge after the lifecycle operations.

These are a failed complete run, not a clean acceptance pass and not proof of an
environment-only cause. The changed atomic connection and provider recovery tests
passed within this same run. All ready-owner initialization/atomic retry/rotation
race checks preceding the direct-read failure also passed; prior hosted owner
success is separate evidence and does not erase the local failure.

An earlier focused application-sync regression passed 6/7. Its same fan-out test
then passed alone without code/timing changes: 131 seasons, 126 inline projections
and two scheduled recovery events, 41.4 seconds. The earlier timeout had no job
error codes and already saved all 126 projections plus 100 analysis catalogs, with
27 catalogs and one history job queued. This supports load-sensitive settling,
without proving its sole cause. An earlier schema-isolation run passed one test
and failed the second on a Miniflare/Undici socket closure; both schema tests
subsequently passed in the full run. No further broad rerun was performed.

Runtime fingerprint: `71af88f73363ab08f88a2d52d116ad82f703289f72956f50f8dcb830a10db00f`.
Algorithm: SHA-256 of JSON.stringify of ordered `{path,sha256}` entries for the
116 required worker.js/src/web files. Final packaging must match this fingerprint
and the unchanged schema/config identities. Tests and local data are excluded
from the required-only ZIP; they remain in the review repository.

Release gates still required after approved deployment: health version 7.1.3,
unchanged ready setup/database counts and identities, the simpler flow in the
user's actual browser, real TeamSnap registration/consent and Trace code access,
public GotSport discovery, and server import completion with every tab closed.
Neither synthetic provider fixtures nor DOM tests establish those live gates.

## 7.1.4 native provider fetch correction candidate

Baseline is deployed commit bc02c4954cf895c90108dd1c14143c70aad27783, tree
8b328b6808c5f092faa3cce8d64c3b9694cc4a16. After the cloud checkout disappeared,
all 165 tracked baseline files were recovered and their Git blob hashes verified;
the exact tree and original commit were reconstructed before editing.

The live 7.1.3 TeamSnap callback returned handled HTTP 502 at 14:12:59.214,
14:13:24.093 and 14:13:27.060 UTC on 2026-10-12. The last observed invocation used
10 ms CPU and 161 ms elapsed. Those logs alone did not expose an underlying stack
or prove whether an outbound request occurred. The visible message came from the
server SourceTransport catch; config/authorize make no provider request and the
callback reaches /v3/me only after validating its session-bound OAuth state.
The evidence does not identify bad user credentials or missing registration.

A native Workerd reproduction of the unmodified source then produced the exact
sanitized source_network / “Provider network request failed.” response. The raw
synthetic reproduction was TypeError Illegal invocation, observation status null
and zero bytes, with zero intercepted outbound calls. The cause is storing
unbound global fetch and invoking it as a transport instance method. This matches
[Cloudflare's receiver guidance](https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors)
and the [specific Workerd receiver report](https://github.com/cloudflare/workerd/issues/6904).

### Bounded change

- Bind only the native global-fetch fallback to globalThis in SourceTransport and
  CaptureTransport. Preserve custom/inherited fetch and bound service precedence.
- Normalize aborted native requests before accepting application string error
  codes. Native DOMException code 20 no longer bypasses collector_timeout.
- Keep sanitized unexpected failures, allowlists, redirect limits, request/byte
  budgets, headers and credentials unchanged.
- Align health/package/lock/documentation at 7.1.4. No dependency, schema,
  configuration, CPU guard, owner/auth flow, browser/UI or production-data change.

The new native regression intercepts HTTPS at Workerd's outbound service boundary;
it does not replace global fetch with a JavaScript mock. Baseline: 1/8 passes
(the injected/service paths), 7 failures. Final transport code: 8/8 passes,
zero skips, 27.723 seconds. It covers TeamSnap/GotSport/Trace, native /v3/me,
standalone and inherited capture, injected/service precedence, 401/403/429,
challenge/redirect/format rejection, native aborts, endpoint restrictions and
credential-free observations. An independent reviewer reproduced the baseline
Illegal invocation and zero outbound calls separately.

These tests use synthetic local responses and no actual provider account.
Earlier private-provider tests injected bound fetch functions and therefore
missed this production-only fallback. The prior complete suite's 154/159 result
(three background settling limits and two local Undici failures) remains
historical evidence; this correction has not been shown to resolve those five
failures. No new clean complete-suite or live-provider acceptance is claimed.

### Current correction receipts

| Check | Result |
|---|---|
| Native transport baseline | FAIL: 1/8; only injected/service cases passed; production global fallback failed before outbound dispatch |
| Native transport correction | PASS: 8/8, zero skips; 27.723 seconds |
| Existing auth/recovery/controller/discovery regression | FAIL: 33/34 passed, one local Undici HTTP fetch failure in the unchanged owner login/logout case; 383.311 seconds |
| Source build | PASS: 140 required files, 28 assets, 1100.04 KiB bundle / 258.42 KiB gzip, pinned Wrangler 4.149.0 |
| Exact required-only package | 140 source/asset/documentation entries plus manifest; byte/hash validation and independent extracted-native review reported with the artifact |
| Independent source review | No blocking finding in the two-transport correction or native regression assertions |
| Complete suite | Not rerun for this correction; prior 154/159 limitations remain explicit above |
| Hosted acceptance | Pending reviewed deployment and fresh provider sign-in; no provider account or consent used in these tests |

All 11 provider-related HTTP cases after the unchanged owner case passed, including
verified TeamSnap identity/credential commit and Trace cancellation/recovery.
The pure controller/discovery/provider-recovery checks passed 22/22 in the same
run. The local owner failure was an Undici `fetch failed`, not a returned provider
HTTP error and not the reproduced Workerd Illegal invocation. No app/test timeout
was increased and no failed test was hidden or skipped.

The runtime fingerprint for 116 required worker.js/src/web files is
`a25a73c6d80ea4c5814e47d971b5c32dc340a95ace7d2aeaa5ef401618286ae0`,
using the ordered `{path,sha256}` JSON SHA-256 algorithm described above.
Schema fingerprint, wrangler.jsonc and release guard are byte-identical to 7.1.3.
Both databases, ready cursor/timestamp, owner vault, sessions, provider records,
ADMIN_KEY, SYNC and cron are preserved.

After reviewed deployment, require health 7.1.4 and the unchanged setup/database
identity, then start a fresh TeamSnap sign-in and verify real discovery/import.
The failed callback consumed its single-use state; never replay it or store its
token in browser state. Hosted provider and browser-closed completion remain
separate required acceptance checks.
