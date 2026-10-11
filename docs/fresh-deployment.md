# Existing myts-v7 Worker: clean rebuild deployment

This release targets the existing **myts-v7** Worker and production branch. It needs no third Worker, new scheduler namespace, new URL or another Cloudflare sign-in. Corrected version: **7.1.1**.

## Why a fresh database is required

The deployed 7.0.1 source defines 34 tables. The rebuild defines 121 tables plus setup_state, 40 explicit indexes, 10 views and 98 triggers. Six names are incompatible: players, competitions, divisions, team_players, coach_profiles and coach_sessions. team_players changes from a table to a view. Creating the new schema over the old one silently retains wrong definitions and produces missing-column failures. See [schema comparison](schema-comparison.md).

The smallest clean change is one isolated D1 database bound to the same Worker. An in-place conversion requires a designed migration; a reset deletes old data. Neither is part of this release.

## Data consequences

Keep **myts-v7-data**, ID **c3585493-4ad5-44f2-9484-816a615ee633**, unchanged. No DROP, DELETE, truncation or migration runs against it. The new app starts empty. Old teams, connections, collected history, bookmarks, preferences, corrections, Coach state and share links remain in the old database and do not automatically appear in the new app. Public data can be recollected; TeamSnap and Trace require normal reconnection. Provider sync cannot recreate old manual corrections or Coach plans. Current-format dataset import is not an old-database restoration.

Retain the existing runtime **ADMIN_KEY** unchanged. It initializes the new installation, and the old release needs its original value to decrypt old credentials during rollback. Never send the value in chat or put it in Git.

The existing Durable Object namespace stays. Old alarms must wait for valid initialization; old cached status is excluded from the new installation. This release implements and tests both conditions.

## Dot: signed-in local Chrome actions before deployment

1. Record the active **myts-v7** deployment/version, Git commit, DB binding and SYNC namespace. GitHub production currently points to e5e92dccaecf741a88725b30e3bf068d93d048de; verify the actual active dashboard version rather than assuming it matches.
2. Open **Storage & databases → D1 SQL database → myts-v7-data → Console**. Run the read-only schema query below and return the result. This reads definitions, not credentials or personal rows.
3. In the D1 list, select **Create database**. Name it **myts-v7-rebuild-data**, in the same account as myts-v7. Copy and return its database UUID. If that name already exists, inspect it instead of creating a duplicate. A populated database is not automatically approved.
4. Run the emptiness query below on the new database's Console. It must return no application tables. Do not import schema SQL; /admin initializes it.
5. Cancel any queued/running builds for myts-v7 before cutover. Open **myts-v7 → Settings → Builds**. Confirm repository kakrami/myts-online; production branch myts-v7; root directory empty; build command `npm ci && npm run build`; deploy command `npm run deploy`. Keep nonproduction/review deployment disabled during cutover. Do not change production to myts-review.
6. Inspect the selected Builds API token. Retain deployment permissions and, if absent, add **Account → D1 → Read**, scoped to the intended account. The guard queries D1 before deployment; the default generated Builds token omits D1. A permission failure must stop deployment. Do not share token values.

Existing schema metadata:

```sql
SELECT type, name, tbl_name, sql
FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
ORDER BY type, name;
```

New database emptiness:

```sql
SELECT name FROM sqlite_master
WHERE type='table'
  AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE '_cf_%'
  AND name <> 'd1_migrations';
```

**Do not manually change DB while 7.0.1 is running.** Its cron or a request can initialize the old schema in the fresh database. Code and binding must change together through the tested Wrangler deployment.

## Final configuration and deployment

Codex will insert the returned UUID in wrangler.jsonc, repeat release/build checks, and identify the final configured commit before promoting it to myts-v7. The current placeholder intentionally cannot deploy.

| Resource | Required value after cutover |
|---|---|
| Worker / production branch | myts-v7 / myts-v7 |
| DB | myts-v7-rebuild-data, returned new UUID |
| SYNC | Existing myts-v7_SyncRuntime; class SyncRuntime |
| Cron | Every minute: * * * * * |
| Runtime secret | Existing ADMIN_KEY, unchanged |
| Website | https://myts-v7.kiadesignenterprise.workers.dev |

The Git-triggered deploy first inspects remote D1 metadata. It accepts empty storage or this release's matching initialized schema. It rejects the old database ID, placeholder, foreign tables, wrong setup fingerprint, incomplete ready schema and unreadable remote metadata. No destructive SQL or migration runs. Dot must confirm the successful guard, exact approved commit and resulting bindings. Keep the production branch fixed during acceptance so a pending or unrelated build cannot overwrite the cutover.

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
