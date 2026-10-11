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

Production schema definitions were retrieved from the myts-v7 branch at e5e92dccaecf741a88725b30e3bf068d93d048de. Dot reported the matching 34-table live inventory, including installation/jobs/connections and no setup_state. Complete live column/constraint metadata remains pending the handoff query.

Native tests use actual local Workerd/D1/SQLite Durable Objects. Private-provider responses are synthetic. Local closed-browser tests establish native alarm behavior, not real Cloudflare/provider execution. Clean npm ci completed successfully using the committed lock and pinned Wrangler 4.149.0. The final corrected source passed all 59 tests and the build dry run.

## Deployment hold

The D1 UUID remains a placeholder. Deployment is intentionally blocked until Dot creates or identifies the empty isolated database, supplies its UUID, and verifies the account-side build settings and D1 Read permission. The existing production branch/binding remains untouched. Full live acceptance follows deployment using the timestamp protocol in fresh-deployment.md.

## Final local receipts

| Check | Result |
|---|---|
| Clean npm ci | PASS; 40 packages installed, committed lock, Wrangler 4.149.0 |
| npm test | PASS: 59/59, 0 failed, 0 skipped; 155.713 seconds |
| Separate assembled application rerun | PASS: 5/5; fresh setup, four reports, public import/correction/inclusion/share/remove, dataset round trip and Coach |
| Retained-namespace runtime | PASS: 4/4; empty/partial/foreign database protection, old status exclusion, transient retry, public import at <=50 statements/run |
| Schema preservation / release guards | PASS: 12/12; full 34-table production fixture and every saved fixture row unchanged after rejected setup |
| npm run build | PASS; Wrangler dry run, 27 assets, 1070.30 KiB uncompressed bundle, existing myts-v7 target and isolated rebuild DB |
| Deploy placeholder | EXPECTED REJECTION before authentication or remote inspection |
| Frontend preservation | All 24 original web files byte-identical to verified 7.1.0 ZIP |
| Independent review | No blocking code/config defect; build cancellation and rollback CI safeguards added to handoff |
| Remote schema query / deployment / real providers | PENDING; not performed or claimed by these receipts |

The 4 runtime and 12 schema/guard checks are subsets of the 59-test final run, not additional distinct tests. The standalone assembled 5-test run independently repeats the corrected runtime. npm test is reproducible in the review repository; fixtures are synthetic and excluded from required-only packaging.

The readiness regression was caught before publication: installation reads initially reduced the coordinator's allowance and forced a public page into invocation_budget retry. The fix returns started_at in the existing metadata query and preserves the 48-query work allowance plus two installation reads within one 50-query shared budget. The full-import regression records every invocation and verifies the ceiling without skipping readiness.

Runtime fingerprint: a2e818e77ce33f12472927779e449e5a7c600395fff4ef7a4e7c6d4b441914ea. Algorithm: SHA-256 of JSON.stringify of ordered {path,sha256} entries for the 104 required worker.js/src/web files. Fresh schema fingerprint remains e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003. There are 121 schema table definitions, plus setup_state for 122 installed application tables.

The manifest records every required file including final instructions and this ledger. Supplying a new D1 UUID changes configuration and its manifest hash; release/build checks must be repeated before that configured commit is deployed. The placeholder review commit cannot deploy. Production remains unchanged until this handoff is resolved.
