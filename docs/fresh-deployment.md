# Fresh review deployment

Review the complete package and verification document before deployment. Use a new Worker and database; no old resource is upgraded or imported. The default identity is `myts-review`, and the version is `7.1.0`.

## Prepare the resources

1. Keep the complete extracted directory structure. `worker.js`, its `src/` modules, `web/` assets, `package.json`, `package-lock.json`, `scripts/` and `wrangler.jsonc` are required.
2. Sign into the intended Cloudflare account. On a laptop, run `npm ci`, then `npx wrangler login --config wrangler.jsonc` and complete the browser sign-in. Create a **new D1 database named `myts-review-data`** and copy its database UUID. The laptop command is `npx wrangler d1 create myts-review-data --config wrangler.jsonc`. Confirm the account before creating resources.
3. Open `wrangler.jsonc`. Replace only the `database_id` placeholder `00000000-0000-0000-0000-000000000000` with that new UUID. Keep the Worker name `myts-review`, database name `myts-review-data` and binding `DB`.
4. Choose an initial owner password of 16–300 characters. Once the new `myts-review` Worker exists, configure that password as its runtime secret `ADMIN_KEY` before opening `/admin`. Do not put its value in source, Git or this ZIP. On a laptop, the secret command below prompts for it after the initial deployment. In the dashboard, add a **Secret**, not a plain variable, under the new Worker's runtime Variables & Secrets controls.

The configuration declares `SyncRuntime` with `exports` and SQLite storage and binds it as `SYNC`. This is the current declarative fresh namespace configuration. It needs no migration history. The one-minute scheduled trigger recovers pending demand independently of browser visits.

## Build and deploy after approval

On a laptop:

```sh
npm ci
npm run build
npm run deploy
npx wrangler secret put ADMIN_KEY --config wrangler.jsonc
```

`npm run deploy` is the publishing action. Its guard reads remote D1 metadata before publishing. It accepts an empty D1 database or a review installation with this artifact's exact fresh schema fingerprint. An old database ID/name, placeholder, foreign application table or different initialization fingerprint or incomplete ready schema stops deployment. Failed Cloudflare authentication or unreadable remote metadata also stops deployment; no remote check is claimed successful in that case.

For Cloudflare Workers Builds connected to a repository, first commit all extracted package files together to a reviewed branch in the connected repository. Preserve the committed lockfile and complete paths. The ZIP is a source package; uploading it does not itself create a deployed Worker. Repository upload and account sign-in from a physical phone have not been verified. Use these settings:

| Field | Value |
| --- | --- |
| Worker name | `myts-review` |
| Root directory | The directory containing `package.json` and `wrangler.jsonc` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npm run deploy` |
| Branch/commit | The reviewed fresh release commit |

The build requires the pinned lockfile. The deploy command explicitly selects the review configuration and performs its guard. Do not use an unqualified `npx wrangler deploy` against another configuration. Runtime `ADMIN_KEY` belongs to the Worker, not only to a build environment variable.

## Open and initialize on mobile

These steps begin after the complete package has been deployed and `ADMIN_KEY` has been configured. They initialize that new Worker; they do not upload the ZIP or create a repository.

1. Open the deployed **`myts-review` Worker** in the Cloudflare dashboard.
2. Open its **Domains** tab. Find its `workers.dev` domain. The configuration enables this domain with `workers_dev: true`; if the dashboard shows it disabled, enable it there.
3. Tap/copy that exact domain. For an account whose subdomain is `kiadesignenterprise`, the address is `https://myts-review.kiadesignenterprise.workers.dev`. Use the actual value shown in your account.
4. Open that address in your phone browser and append `/admin`: `https://myts-review.kiadesignenterprise.workers.dev/admin` for that example.
5. Enter the same password configured as the Worker's `ADMIN_KEY`. Tap **Initialize & sign in**. The browser sends bounded initialization requests until the new schema is ready, then signs in. If initialization is interrupted, reopen `/admin` and use the same password; setup resumes. No SQL import or migrations command is needed.
6. Confirm the header/Settings version **7.1.0**. Opening `/api/health` on the same domain also returns that version.

## Connect and verify complete workflows

1. On the empty first-run screen, tap **Connect TeamSnap**, **Connect Trace** or **Find a GotSport team**. Once a team exists, open **Settings** and the provider's **Manage** flow.
2. For TeamSnap, enter the Client ID when the first connection asks for it, then tap **Connect TeamSnap** and complete TeamSnap's consent. Register this exact new site's `/admin` callback in the TeamSnap registration. The app reuses the Client ID later. Real registration/consent remains an external acceptance check.
3. For Trace, enter your account email, tap **Send sign-in code**, enter the emailed code and tap **Verify code**. The connection checks that account's identity and access.
4. Choose a named discovered team. In **Connect team**, select **Create this team** for your first team; review **New team name** and **New season starts**, then tap **Connect team**. For another provider covering the same team, select that existing team and season under **Destination** before connecting. This creates an explicit attachment; it does not guess that differently named teams are the same.
5. For GotSport, search by team name or paste a public team page, select the named result and use the same destination chooser. An unexplained numeric ID is not a prerequisite to normal setup.

Check roster, past and upcoming schedule, practices, attendance, competitions and standings; match/player details and corrections; approved cross-provider matching; bookmarks; branding/kits; viewer team/category restrictions; private Coach workflows; and all four report previews with full Excel and PDF downloads. Source datasets accept this exact release's current ZIP format and preserve canonical approvals/corrections. Evidence ZIPs cannot be imported.

In Trace Manage, open **Tracking evidence**. Choose an eligible game, a half, a start time and duration, and one to four observed tracks. Start the fresh capture, then reopen this sheet to find its saved status and JSON download. Check both complete and partial results; capture files are diagnostic evidence and cannot be imported as datasets.

Queue a source update, close every browser tab, then reopen later. Diagnostics must show server retrieval/save/complete progress that occurred while the browser was closed. Repeat for projection/analysis, report exports and a source import after every segment has uploaded and the import is committed. Upload requires the page open until staging finishes; committed processing does not. Check that a blocked source leaves saved data accessible and does not block independent sources.

Record any provider verification wall, missing consent/entitlement, production CPU/quota issue or unverified external result in the review evidence. Do not switch the existing public domain or remove previous resources until the reviewed new installation passes the production checks. This guide does not perform that cutover.

Current primary references: [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [Workers Builds settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Wrangler bundling/dry run](https://developers.cloudflare.com/workers/wrangler/bundling/) and [declarative Durable Object exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/). Configuration syntax was also checked against pinned Wrangler 4.149.0's installed schema.
