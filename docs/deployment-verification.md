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
