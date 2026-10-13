# myTS 7.2.7

This is the fresh architecture rebuild prepared for review. It targets the existing `myts-v7` Worker and one isolated rebuild database, preserving `myts-v7-data`. The visible version is **7.2.7**. This package is not a production deployment.

The 7.2.7 workflow repair restores original attendance percentages, per-view page scrolling and explicit sign-in cancellation, while separating unchanged refresh observations from report-content changes. See [the scope and verification](docs/live-workflow-parity-repair.md). Trace member date normalization and deterministic source-contract failures are also corrected; see [the Trace contract repair](docs/trace-member-contract-repair.md) for the exact evidence and remaining live acceptance.

The 7.2.6 attendance update uses compact storage sizing and a validated 100-row request preference for new scans, with bounded compatibility fallback. Existing scans retain their saved page size and continuation. See [the throughput contract and verification](docs/attendance-throughput-repair.md).

The 7.2.5 Schedule repair restores newest-first Past and Analyzed lists, chronological Upcoming and Day lists, known kickoffs before TBD within each local day, and historical-season selection without losing the current-season period preference. See [the query policy and verification](docs/schedule-order-repair.md). This update does not restart provider collection.

The 7.2.4 attendance repair uses validated event/member identities within the connected TeamSnap account and team. It corrects the numeric availability-ID assumption confirmed by live diagnostics and official provider fixtures. See [the identity contract, migration and recovery](docs/attendance-identity-repair.md). Real attendance completion with all app tabs closed was verified on 2026-10-13; the latest workflow ledger records that receipt.

The 7.2.2 connection throughput repair batches shared season reconciliation under the existing transaction limits and removes redundant recovery alarms from safe projection-only pages. See [the diagnosis and verification boundary](docs/connection-throughput-repair.md). Existing saved cursors and the deployed schema remain compatible.

The prior 7.2.1 TeamSnap collection repair adds bounded provider pages and database commits, resumable stable-traversal checks, and separate recent-window/full-history freshness. See [the exact repair and verification boundary](docs/teamsnap-pagination-repair.md). The deployed 7.2.0 schema and preserved data are unchanged.

The original compact mobile interface, team and season navigation, schedule, competitions, player and match details, bookmarks, source management, branding, corrections, matching, awards, four reports and private Coach workflows are retained. Their server records and background processing use the new architecture. Exact behavior and verification boundaries are documented in the included contracts and final review evidence.

| Layer | Responsibility |
| --- | --- |
| `worker.js` | Local fresh installation, exact in-place upgrade, HTTP/assets, scheduled recovery and alarms |
| `src/security/` | One owner password, opaque sessions, independent credential vault, provider sign-in and scoped viewer links |
| `src/domain/` | Shared native observations, canonical identities, explicit attachments, corrections and bounded published projections |
| `src/sources/` | TeamSnap, GotSport, GotSport Live and Trace transport contracts |
| `src/sync/` | Independent persistent jobs, leases, fencing, coverage, retry and resumable checkpoints |
| `src/read-model/`, `src/analysis/` | Shared selection, inclusion, paginated reads and source-grounded analysis |
| `src/coaching/` | Private revision-guarded Coach plans, lineups and session records |
| `src/reporting/` | Immutable complete report snapshots, genuine Excel/PDF files, staged current-format source ZIPs |
| `src/tracking/` | Owner-only selective fresh tracking captures, independent jobs and explicit partial/complete JSON artifacts |
| `web/app/`, `web/ui-original/` | Fresh controllers using the preserved mobile interface |

Provider records are shared individually. Logical teams retain continuing or deliberately fixed source connections; dated evidence materializes their seasonal memberships without a setup-year prompt. June is optional preseason, excluded from regular July–May statistics by default. Unknown evidence stays visible without creating a guessed season. App teams reference shared records through these scoped memberships; private account authorization stays separate. Source collection, canonical projection, analysis and export jobs have their own durable progress. Browser polling reads saved status and does not run updates. Attempt, retrieval, save and complete are different states. Missing or blocked evidence remains explicit.

Trace Manage includes full saved-history dataset import/export, source-evidence export and Tracking evidence: select a saved eligible game and observed tracks, then request a bounded fresh capture. It resumes on the server after the browser closes, and recent captures provide protected JSON downloads with explicit complete, partial or unavailable results. These diagnostic artifacts do not publish source statistics or replace approved identities.

An owner password change revokes owner sessions and pending sign-ins while preserving provider credentials and active share links. Connected TeamSnap and Trace accounts are reused by name before sign-in is offered. TeamSnap requires a real registered app: the owner supplies its Client ID once inside app setup, with an explicit repair path. Its callback is this site's `/admin`; a saved ID is not proof that registration works. Trace uses independent email-code attempts. GotSport uses one public team name/link entry and asks for the age/category only when a name search needs them. Provider access may still require consent, an active entitlement or human verification; the app reports these conditions and preserves saved records.

Viewer links use `/view/<token>` and one explicit team/category scope. Coach, credentials, accounts, diagnostics, raw observations and source data files remain owner-only. Viewers with the Reports category can export only that team's safe report projections.

Local build requires Node.js 22 or newer:

```sh
npm ci
npm run build
```

Run native application/D1/Workers tests with `npm test`. The deterministic connection DOM suite also runs with a separately installed pinned jsdom 26.1.0; `tests/connection-ui.test.mjs` documents the temporary-install command and `MYTS_JSDOM_MODULE`. Without that module these DOM checks explicitly skip, so a native-only result must not be described as a DOM pass. The separate `npm run test:browser` suite requires Playwright and Chromium; its header documents `MYTS_PLAYWRIGHT_MODULE` and `MYTS_TEST_CHROMIUM` for existing installations. Browser dependencies are not production dependencies or part of the default native suite.

The committed npm lock pins Wrangler **4.149.0**. `build` validates the release files and performs a deployment **dry run** using `wrangler.jsonc`; it does not publish. Use `npm run dev` for a local preview with a local bootstrap password configured for Wrangler. Local D1 is separate from remote D1.

Follow the [preserved installation upgrade instructions](docs/schema-upgrade.md) after review approval. The configuration is pinned to the existing `myts-v7-rebuild-data`, UUID `60f77502-33d4-41d6-80d4-1c5577ebba76`, on Worker `myts-v7`. Normal-mode deployment automatically starts the exact data-preserving transition through retained alarms/cron. The guard admits only the exact ready 7.1.4 source, this same plan’s partial transition, or its completed target, with physical SQL definitions and journal evidence checked. Empty databases, fresh-origin targets, unknown schemas, other UUIDs and unexpected bindings are rejected. Existing data, keys and setup timestamps are preserved. The same candidate supports `MYTS_UPGRADE_MODE=maintenance` as a compatible pause; the old binary cannot be restored after the journal exists. There is one explicit reviewed transition, not a generic migration registry.

Native Workerd/D1 and frontend checks against the required-only package are local evidence; the verification document records the tested artifact and checks. Synthetic private-provider authentication does not prove real TeamSnap consent or Trace entitlements. Production credentials, Cloudflare plan/CPU behavior and closed-browser execution in the target account must be verified separately and identified in the release review. The final verification document is the authority for which gates passed. During integration, docs/integration-checkpoint.md and the 31-gate parity ledger retain component failures and remaining acceptance explicitly; this working candidate is not yet a release receipt.

Maintainer packaging, after the release gates pass:

```sh
node scripts/release-check.mjs --stage tmp/release-stage --zip tmp/myTS-7.2.0.zip
```

The staging recipe follows the actual fresh Worker/browser import graph and copies required source, assets, pinned configuration, documentation and a SHA-256 manifest. It excludes old modules, dependency directories, provider credentials, local databases, tests, screenshots and temporary work. The verification ledger is required automatically; finalize it with the exact-package results before the release is packaged. Do not substitute a ZIP of the entire workspace.

The schema comparison and corrected deployment verification are included in `docs/schema-comparison.md` and `docs/deployment-verification.md`. Installation readiness gates retained scheduler alarms, and old status is excluded from the new installation. The current upgrade guide defines automatic activation, permanent old-writer fencing, compatible maintenance recovery and separate live acceptance; earlier cutover documents remain historical.
