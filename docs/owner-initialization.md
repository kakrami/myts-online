# Owner initialization correction, myTS 7.1.2

This correction starts from production/review commit 8411d36d9a2a6f66df35fdf83c7964d7a13509c8. Production has the existing rebuild DB binding. The user reports setup_state ready at cursor 270, completed 2026-10-12T05:29:49.040Z, 122 tables, 40 indexes, 98 triggers, 10 views and one domain seed. Owner, vault and session counts were zero after /api/owner/initialize returned HTTP 500 at 05:29:49.370Z, invocation 21dc2c94bba9d696646b078b427ff18b. Displayed progress 88 was stale.

## Failure findings

Native fault reproductions show both a hosted-style PBKDF2 rejection and a constraint failure inside the owner batch leave owner/vault/session counts 0/0/0 with the schema ready. A later session insertion failure in the previous implementation instead leaves 1/1/0. The zero counts narrow the failure to before the owner batch or a rollback of that batch; they do not prove which one occurred live. The previous HTTP error handler discarded the underlying exception without logging it, so the original invocation might have no useful exception record.

Local Workerd accepting 600,000 native PBKDF2 iterations does not prove hosted support. Workerd checks a host-configured cap; Cloudflare maintainers explicitly distinguished removing the local default from raising production limits. See [maintainer explanation](https://github.com/cloudflare/workerd/issues/1346#issuecomment-1874827249) and [current limit enforcer](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/crypto/impl.c%2B%2B). The actual current cap of myts-v7 has not been measured here.

## Correction

- A pinned portable @noble/hashes 1.7.1 dependency closure computes exactly standard PBKDF2-HMAC-SHA256 with the stored count, 600,000 for new hashes, and a 32-byte output. Initialization, login and rotation use one implementation. Existing hashes remain compatible. License, tarball integrity and source/vendored digests ship with the release. The documented independent audit applies to the library's 1.0.0 ancestor, not a separate audit of 1.7.1.
- All cryptographic material is prepared before one native D1 transaction commits the vault, owner and initial session. The session statement selects only the owner with this request's unique initialization nonce and revision. An insert failure rolls back all three. A concurrent loser verifies the actual winning password before creating its session.
- Retrying a committed request verifies the stored owner password, including subsequent rotation. It does not restore the bootstrap password or replace the owner, verifier, vault or ready setup row. An existing vault is preserved even if no owner has committed.
- Bootstrap separately reports schema ready and owner_ready:false. Failed form submission refreshes persisted state so the next attempt initializes or logs in as appropriate and clears old progress. Unexpected owner initialization failures return HTTP 503 with owner_initialization_failed and log only a safe phase/error class, never raw exception messages or secret values.

No schema definition, setup fingerprint, D1 UUID, ADMIN_KEY, SYNC export, cron, provider credential model or old database is changed. Expected schema fingerprint remains e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003.

## Local validation

Final test/build receipts are recorded in deployment-verification.md. Independent Node reference vectors include 100,000 and 600,000 rounds, Unicode, embedded NUL and long UTF-8 passwords. Native Workerd verifies a simulated 100,000 cap then performs portable derivation with native PBKDF2 forbidden. Local per-derivation request wall time was about 1.7–2.0 seconds, and Node process CPU about 0.7–0.8 seconds. Neither is hosted CPU evidence.

## Deployment and live acceptance

1. Before approved promotion, dot confirms the existing myts-v7 Worker has a suitable HTTP CPU budget. Normal paid Workers default to 30,000 ms, but the actual Worker setting must be inspected; free/legacy short budgets are insufficient for this implementation. Reference: [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/).
2. Promote the exact tested review commit to production branch myts-v7. Deploy source and wrangler.jsonc together. Require the awaited guard to report remote ready before publication. Keep DB → myts-v7-rebuild-data / 60f77502-33d4-41d6-80d4-1c5577ebba76, ADMIN_KEY, SYNC, minute cron, disabled nonproduction builds and preview_urls:false. Save the build/deployment reference. No reset, manual schema import or second setup is needed.
3. Confirm /api/health reports 7.1.2. Bootstrap should report schema ready, progress 100 and owner_ready:false before the first successful owner request. Reload /admin and submit the existing configured owner password through the normal form. Do not send the password in chat.
4. Require HTTP 200, an HttpOnly owner session cookie and the app loading. Inspect counts only: owner=1, vault=1, sessions>=1, domain seed=1. Require the exact setup completion timestamp/cursor/fingerprint and schema object counts to remain unchanged. Check invocation CPU/outcome and safe logs. A failure must be captured by invocation and stage, then retried without reset.
5. Verify logout/login and password rotation under the actual Worker CPU quota; verify the vault identity/count remains unchanged. Password rotation changes ordinary login authority and never replaces the vault. Do not use ADMIN_KEY as a bypass after rotation.
6. Connect actual TeamSnap/Trace through normal authorized flows and import a real public provider team. Record provider verification, successful persisted sync/job evidence and read models. Close all myTS tabs, wait for the existing Durable Object/cron processing, then reopen and verify persisted completion timestamps and data. Synthetic tests cannot satisfy this check. The rebuild remains incomplete until these real checks pass.

Data-loss consequence: none. Both databases are retained. Roll back this follow-up to the saved preceding Worker version with the same rebuild DB binding if necessary; never pair either release with the old incompatible database.
