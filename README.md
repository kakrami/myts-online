# myTS 7.1.1

This is the fresh architecture rebuild prepared for review. It targets the existing `myts-v7` Worker and one isolated rebuild database, preserving `myts-v7-data`. The visible version is **7.1.1**. This package is not a production deployment.

The original compact mobile interface, team and season navigation, schedule, competitions, player and match details, bookmarks, source management, branding, corrections, matching, awards, four reports and private Coach workflows are retained. Their server records and background processing use the new architecture. Exact behavior and verification boundaries are documented in the included contracts and final review evidence.

| Layer | Responsibility |
| --- | --- |
| `worker.js` | Fresh installation, HTTP/asset delivery, scheduled recovery and alarm runtime |
| `src/security/` | One owner password, opaque sessions, independent credential vault, provider sign-in and scoped viewer links |
| `src/domain/` | Shared native observations, canonical identities, explicit attachments, corrections and bounded published projections |
| `src/sources/` | TeamSnap, GotSport, GotSport Live and Trace transport contracts |
| `src/sync/` | Independent persistent jobs, leases, fencing, coverage, retry and resumable checkpoints |
| `src/read-model/`, `src/analysis/` | Shared selection, inclusion, paginated reads and source-grounded analysis |
| `src/coaching/` | Private revision-guarded Coach plans, lineups and session records |
| `src/reporting/` | Immutable complete report snapshots, genuine Excel/PDF files, staged current-format source ZIPs |
| `src/tracking/` | Owner-only selective fresh tracking captures, independent jobs and explicit partial/complete JSON artifacts |
| `web/app/`, `web/ui-original/` | Fresh controllers using the preserved mobile interface |

Provider records are shared individually. App teams reference them through explicit attachments; private account authorization stays separate. Source collection, canonical projection, analysis and export jobs have their own durable progress. Browser polling reads saved status and does not run updates. Attempt, retrieval, save and complete are different states. Missing or blocked evidence remains explicit.

Trace Manage retains Tracking evidence: select a saved eligible game and observed tracks, then request a bounded fresh capture. It resumes on the server after the browser closes, and recent captures provide protected JSON downloads with explicit complete, partial or unavailable results. These diagnostic artifacts do not publish source statistics or replace approved identities.

An owner password change revokes owner sessions and pending sign-ins while preserving provider credentials and active share links. TeamSnap Client ID is entered once inside its connection flow. Its callback is this site's `/admin`. Trace uses independent email-code attempts. Provider access may still require consent, an active entitlement or human verification; the app reports these conditions and preserves saved records.

Viewer links use `/view/<token>` and one explicit team/category scope. Coach, credentials, accounts, diagnostics, raw observations and source data files remain owner-only. Viewers with the Reports category can export only that team's safe report projections.

Local build requires Node.js 22 or newer:

```sh
npm ci
npm run build
```

The committed npm lock pins Wrangler **4.149.0**. `build` validates the release files and performs a deployment **dry run** using `wrangler.jsonc`; it does not publish. Use `npm run dev` for a local preview with a local bootstrap password configured for Wrangler. Local D1 is separate from remote D1.

Follow [fresh deployment instructions](docs/fresh-deployment.md) after review approval. The configuration now selects `myts-v7-rebuild-data`, UUID `60f77502-33d4-41d6-80d4-1c5577ebba76`, for the existing `myts-v7` Worker. Cutover remains held for review. The deploy guard rejects that placeholder, the preserved previous database, unexpected bindings and a remote database whose initialization fingerprint belongs to another build. It permits an empty rebuild database or a matching initialized rebuild installation. No ordered migrations or compatibility readers are included.

Native Workerd/D1 and frontend checks against the required-only package are local evidence; the verification document records the tested artifact and checks. Synthetic private-provider authentication does not prove real TeamSnap consent or Trace entitlements. Production credentials, Cloudflare plan/CPU behavior and closed-browser execution in the target account must be verified separately and identified in the release review. The final verification document is the authority for which gates passed.

Maintainer packaging, after the release gates pass:

```sh
node scripts/release-check.mjs --stage tmp/release-stage --zip tmp/myTS-7.1.1.zip
```

The staging recipe follows the actual fresh Worker/browser import graph and copies required source, assets, pinned configuration, documentation and a SHA-256 manifest. It excludes old modules, dependency directories, provider credentials, local databases, tests, screenshots and temporary work. The verification ledger is required automatically; finalize it with the exact-package results before the release is packaged. Do not substitute a ZIP of the entire workspace.

The schema comparison and corrected deployment verification are included in `docs/schema-comparison.md` and `docs/deployment-verification.md`. Installation readiness gates retained scheduler alarms, and old status is excluded from the new installation. The deployment guide explains the atomic code/binding switch, data consequences, rollback and real-provider acceptance.
