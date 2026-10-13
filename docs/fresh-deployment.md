> Current release: the in-place 7.1.4 transition is governed by [schema-upgrade.md](schema-upgrade.md). Its automatic activation and compatible maintenance recovery supersede the historical fresh-cutover and old-binary rollback instructions below. Do not repeat empty-database preparation.

# Existing myts-v7 Worker: clean rebuild deployment

This release targets the existing **myts-v7** Worker and production branch. It needs no third Worker, new scheduler namespace, new URL or another Cloudflare sign-in. Corrected version: **7.1.2**.

## Owner initialization follow-up on the ready database

Production currently uses commit 8411d36d9a2a6f66df35fdf83c7964d7a13509c8. The user reports setup_state ready at cursor 270, completed 2026-10-12T05:29:49.040Z, with 122 tables, 40 indexes, 98 triggers, 10 views and one domain seed. Owner, vault and session counts are zero after HTTP 500 from invocation 21dc2c94bba9d696646b078b427ff18b. The displayed 88 was stale. This correction reuses that ready database; the original empty-database preparation below is historical and must not be repeated.

After approval, promote the exact tested 7.1.2 review commit to myts-v7. Keep code and wrangler.jsonc DB binding together; keep DB UUID 60f77502-33d4-41d6-80d4-1c5577ebba76, ADMIN_KEY, SYNC, the one-minute cron, preview_urls:false and disabled nonproduction builds. Do not import schema, clear setup_state, reset either database or create another setup. There is no data-loss operation. Read [owner initialization evidence and live checks](owner-initialization.md) before the follow-up deployment. Preserve the current Worker deployment reference for rollback with the same rebuild binding.

The release explicitly configures `limits.cpu_ms: 30000`; the release/build/deploy guard rejects any other or omitted CPU value before remote inspection or publication. Dot should confirm the existing paid Worker supports this budget before deployment, then verify the effective 30,000 ms setting and live invocation CPU afterward. Local Workerd does not enforce the hosted quota. After the successful build, require /api/health version 7.1.2 and bootstrap schema ready / owner_ready:false. Retry through /admin using the existing configured password. Verify the unchanged setup row and schema, one owner and vault, at least one session, no native-PBKDF2 cap or CPU failure, ordinary logout/login and password rotation with the vault preserved. If a failure occurs, capture its invocation and safe phase diagnostic; retry without reset. Real provider sync and processing after all tabs close still require live acceptance.

## Why a fresh database is required

The deployed 7.0.1 source defines 34 tables. The rebuild defines 121 tables plus setup_state, 40 explicit indexes, 10 views and 98 triggers. Six names are incompatible: players, competitions, divisions, team_players, coach_profiles and coach_sessions. team_players changes from a table to a view. Creating the new schema over the old one silently retains wrong definitions and produces missing-column failures. See [schema comparison](schema-comparison.md).

The smallest clean change is one isolated D1 database bound to the same Worker. An in-place conversion requires a designed migration; a reset deletes old data. Neither is part of this release.

## Data consequences

Keep **myts-v7-data**, ID **c3585493-4ad5-44f2-9484-816a615ee633**, unchanged. No DROP, DELETE, truncation or migration runs against it. The new app starts empty. Old teams, connections, collected history, bookmarks, preferences, corrections, Coach state and share links remain in the old database and do not automatically appear in the new app. Public data can be recollected; TeamSnap and Trace require normal reconnection. Provider sync cannot recreate old manual corrections or Coach plans. Current-format dataset import is not an old-database restoration.

Retain the existing runtime **ADMIN_KEY** unchanged. It initializes the new installation, and the old release needs its original value to decrypt old credentials during rollback. Never send the value in chat or put it in Git.

The existing Durable Object namespace stays. Old alarms must wait for valid initialization; old cached status is excluded from the new installation. This release implements and tests both conditions.

## Follow-up: awaited guard and disabled Preview URLs

The initial approved commit b9e69bea028172d13f59e6dcedd8f7d6c329e495 was promoted to myts-v7, and Cloudflare reported build 4e72c129-f005-4c85-a6f6-4dd7b267cf6b successful. This follow-up changes deployment tooling/configuration only; it does not repeat fresh setup or replace either database.

After this follow-up is approved, promote its exact review commit to myts-v7 through the same Git pipeline. Confirm the guard reports the actual empty/initializing/ready state, then confirm successful publication and disabled Preview/Version URLs. Keep the current DB UUID, ADMIN_KEY, SYNC and minute cron intact. Preview URL configuration is separate from disabled nonproduction branch builds. Preserve the current deployment reference for rollback of this follow-up; the older preparation table below describes the original cutover snapshot. Real provider and closed-browser acceptance remain separate.

## Preparation confirmed

The earlier read-only handoff is a historical snapshot. The user's subsequent confirmation establishes the following completed preparation:

| Setting / evidence | Confirmed value |
|---|---|
| Fresh D1 | myts-v7-rebuild-data |
| Fresh D1 UUID | 60f77502-33d4-41d6-80d4-1c5577ebba76 |
| Fresh D1 emptiness | No application tables returned |
| Live old schema | 34 tables and 11 indexes; all 45 SQL definitions match the production fixture |
| Production branch / root | myts-v7 / repository root (dashboard displays /) |
| Build command | npm ci && npm run build |
| Deploy command | npm run deploy |
| Nonproduction builds | Disabled and verified after reload |
| Preview/Version URLs | Explicit preview_urls:false in this follow-up configuration; confirm disabled after approved deployment |
| Selected Builds token | Existing D1 Edit access; no permission expansion needed |
| Pending builds | None visible during preparation; recheck at cutover |
| Old active version | Dashboard short ID e089fe2c, Ready, 100% traffic |
| Last Git build lineage | e5e92dccaecf741a88725b30e3bf068d93d048de; dashboard secret-only versions followed |
| Existing SYNC namespace | f0fb531d97f04f3c9d474d33eb8a0664 (myts-v7_SyncRuntime) |
| Runtime secret / cron | Existing ADMIN_KEY, unchanged / every minute |

Only the UUID in wrangler.jsonc is changed from the tested review runtime. Configured checks and manifests are regenerated. The configured commit remains on myts-review, while myts-v7 production remains unchanged until cutover approval. Source runtime fingerprints do not establish the active dashboard-created version's source hash; the old active full version UUID and semantic health were not exposed by the prior read-only check.

## Exact cutover instructions

1. Review the exact configured commit identified in the accompanying release response. Approval is for publishing that commit to the existing myts-v7 Worker, with the fresh database and the data consequences above.
2. Immediately before promotion, Dot should use the signed-in local Chrome session to confirm no queued/running builds, the existing DB still points to myts-v7-data, and the old version is still available for rollback. Record the old full version UUID from deployment details if exposed; e089fe2c is only the displayed short ID. Keep nonproduction builds disabled and production on myts-v7.
3. After approval, Codex advances the myts-v7 Git branch to the exact configured review commit. That Git push triggers the existing build/deploy commands. Do not change the production branch setting to myts-review, edit the DB binding manually, or rotate ADMIN_KEY. **The Wrangler deployment publishes the new code and DB binding together.** Old code pointed at the empty new database can initialize the wrong schema.
4. Dot should observe this build in Cloudflare. Require the log to report successful remote schema inspection with an explicit state (empty, initializing or ready), then successful deployment, and confirm its Git source is the approved configured commit. If the guard cannot read D1, sees unexpected tables, or deployment fails, stop and report the log; do not bypass it or reset either database. Keep the branch fixed during acceptance so another build cannot overwrite the cutover.
5. Confirm the deployed resources in the dashboard:

| Resource | Required value |
|---|---|
| Worker / branch | myts-v7 / myts-v7 |
| DB | myts-v7-rebuild-data / 60f77502-33d4-41d6-80d4-1c5577ebba76 |
| SYNC | Existing SyncRuntime namespace f0fb531d97f04f3c9d474d33eb8a0664 |
| Cron / runtime secret | Every minute / existing ADMIN_KEY unchanged |
| Website | https://myts-v7.kiadesignenterprise.workers.dev |
| Preserved old database | myts-v7-data / c3585493-4ad5-44f2-9484-816a615ee633 |

6. Open the website's /api/health and require version 7.1.1. Open /admin and initialize with the existing ADMIN_KEY. No schema import is needed. Perform real acceptance below before calling the rebuild complete.

The guard now awaits remote inspection before reporting success or allowing publication. The deploy guard remains intact: it accepts empty storage or this release's matching initialized schema; it rejects the old ID, placeholder, foreign tables, wrong fingerprint, incomplete ready schema and unreadable remote metadata. Its local validator passes with the configured UUID; the actual remote guard runs during the approved Cloudflare build and is not claimed to have run from this environment.

## Real acceptance after deployment

1. Confirm /api/health reports 7.1.1. Open https://myts-v7.kiadesignenterprise.workers.dev/admin and initialize with the existing ADMIN_KEY through the normal form. Setup is bounded and resumable. Confirm the familiar app loads.
2. Add the actual team through normal provider search/link/account flows. Reconnect TeamSnap and Trace using their real authorization screens. TeamSnap Client ID stays inside its connection flow. Confirm the expected owned teams before attaching sources to the same myTS team.
3. Check real GotSport/GotSport Live fixtures/results and authenticated roster, attendance and Trace analysis. Record consent, entitlement, verification or missing-component blockers. A queue admission, HTTP 200 or transport save does not establish complete publication.
4. Verify a correction survives refresh, linked providers produce one game/player, selected totals match evidence, and reports/Coach/viewer permissions work on the actual team.
5. For closed-browser proof, record the read-only summaries below and the close time in UTC while real source work is queued. Close **every myTS tab on every device**. Cloudflare dashboard may remain open. Do not press Sync/Retry or call runner endpoints during this interval. After several cron cycles, query D1 while myTS is still closed. Require successful last_saved_at/last_complete_at values within the closed interval and published source records/revisions or analysis results. Attempts or a shrinking queue alone are insufficient. Reopen afterwards and verify the stored update appears.

```sql
SELECT provider, stage, component, state, coverage,
       COUNT(*) AS jobs, SUM(pages_saved) AS pages_saved,
       SUM(rows_saved) AS rows_saved,
       MAX(last_attempt_at) AS last_attempt_at,
       MAX(last_retrieved_at) AS last_retrieved_at,
       MAX(last_saved_at) AS last_saved_at,
       MAX(last_complete_at) AS last_complete_at
FROM sync_jobs
GROUP BY provider, stage, component, state, coverage
ORDER BY provider, stage, component, state;
```

```sql
SELECT COUNT(*) AS source_events FROM source_events;
SELECT COUNT(*) AS source_players FROM source_players;
SELECT app_team_id, content_revision, status_revision, pending
FROM team_read_state ORDER BY app_team_id;
```

Record before/after snapshots and UTC times, deployed commit, providers, errors and reopened-app observations. Local/simulated tests are separate evidence. The rebuild is not complete until real imports and server background updates pass on the target Worker.

## Rollback

Close myTS tabs and cancel queued/running builds. Pause automatic builds, or revert the production branch/configuration to the recorded old commit before re-enabling them; otherwise a later build can redeploy the rebuild. Restore the recorded old Worker version **with DB pointing to myts-v7-data** and the unchanged ADMIN_KEY. Verify its health and binding before using it. If redeploying old code, its configuration must specify the original database. Never run 7.0.1 against the rebuild database or 7.1.1 against the old database. Keep both databases; no cross-version merge happens automatically.

Cloudflare reference: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/ and https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/ describe Builds-token permissions and D1 Read requirements. Menu labels should be matched to the local signed-in dashboard's actual controls.
