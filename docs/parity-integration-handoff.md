# Isolated original-parity integration handoff

This is a review branch, not a release or deployment. It is based on GitHub commit `6326162d923aae5c2f2bfe109dfad6dc3b28d687`, tree `e4128fe70f57304643add840921142690bc18741` (deployed 7.1.4 source). The author's local base `3fbc36fe43a23b119ddf968d23f1dab26f046fc9` is reported to have that same tree; its uncommitted lifecycle candidate is not included here.

Original product source: `50e1be224806ff7e7c439d26e15fd0421e3f6f01` (6.20.133). All 31 gates in acceptance-baseline.md remain the completion contract.

## Exact ownership

Changed application files in this branch:
- `web/ui-original/screens.js`
- `web/ui-original/spatial.js`
- `web/app/detail-features.js`

New QA files:
- `tests/parity/screens-cases.js` and `screens.test.mjs`
- `tests/parity/spatial-cases.js` and `spatial.test.mjs`
- `tests/parity/detail-controller-cases.js` and `detail-controller.test.mjs`
- `tests/parity/original-analysis-fixtures.js` and `original-analysis.test.mjs`

New design/receipt documents:
- `docs/parity-analysis-design.md`
- this handoff

`src/analysis/projector.js` and `src/analysis/reads.js` are assigned to the next parity batch, but remain byte-identical to the deployed base in this branch. Their typed integration depends on the author's frozen lifecycle/fact contracts. No tables.js or competition-renderer file is added in this batch.

All author-reserved files stay byte-identical to the base. In particular, this branch does not modify domain modules/schema, connection materialization, application services/routes/installation/upgrade, analysis mutation services/tracks/write-scope, coaching/service, sources/teamsnap, sync coordinator/runtime, main/features/connection-flow/transport, shell, Worker or release guards.

The author remains sole writer of those reserved files. Use cherry-pick or an isolated merge into the frozen lifecycle candidate after reviewing overlap; do not advance myts-v7 or myts-review from this branch.

## Implemented independent behavior

Coach requests the existing overview match envelope, then uses the separate owner-private Coach panel API. UI-only tab state no longer enters the match-read validator. Owner authorization runs before changing the tab/history. Detail requests carry independent request identity and team/season/epoch/role context; stale hydration, private-panel callbacks and cleanup cannot overwrite a newer detail.

Renderers restore DTO-backed search highlighting, conflict warnings, full H2H record/coverage summary, player metrics and match-player starter/provenance presentation. No unavailable timeline, native statistic or H2H range is synthesized. Native `box_touches` uses the same half-pitch geometry as its existing box alias; pass maps retain the full pitch.

The original-analysis fixtures characterize exact original source slices using synthetic records. They are QA oracles, not runtime inference, legacy readers or provider fixtures. See parity-analysis-design.md for the target shared component and intentional safeguards.

## Precise reserved-file integration requirements

| Owner/interface | Required integration and acceptance |
| --- | --- |
| Author: main/transport | Preserve detail API fields `state.active`, `routeEpoch`, `team`, `season`, `bootstrap.session.role`, `requireOwner`, `hydrateModel` and `setDetail`. Cleanup must run when details close/context changes. Re-run the detail cases against the frozen APIs and actual native HTTP. |
| Author: main/features | Overview Full schedule/All results/Analyzed must install original Season selections. Normalize invisible Day/Analyzed filters. Restore original date/calendar transitions and cross-season navigation. Render three connection providers regardless of job presence; show internal stages in update details. Preserve Settings controls after theme changes. |
| Author: domain/inclusion/features | Preserve deliberate saved inclusion choices; default new seasons and Reset to June excluded. Materialize June–May calendar seasons separately from the engine's June preseason statistical key. |
| Author: routes; next parity read-model allocation | Original H2H ranges need a normalized range/cutoff forwarded to the read service, included in selection/cursor identity and aggregate queries before pagination. Current code supports record/events/coverage but not the original range selector. Do not add a nonfunctional range control. |
| Author: routes; parity projector/reads | Provide sanitized goal timeline, leaders and source-detail DTOs for original match composition. Expose existing analytics facts/thirds/timeline where observed. Preserve canonical identity and permitted viewer scope; no raw account IDs, credentials or unproved participant attribution. |
| Author: analysis service/tracks/write-scope; parity projector/reads | Provide stable typed effective-source, half/window, track/person mapping and correction adapters, plus final input/generation/lifecycle fences. Share one published minute/role/lineup interpretation. Source inference and match/half/season defaults must work without forced manual lineup creation. |
| Author: routes/security UI allocation | Wire an ordinary owner password-change control through the existing independent vault/password API. Verify session revocation and continued provider decryption, not just API existence. |
| Author: main/features/file workflows | Restore original Trace Manage import/export/evidence entry points and saved file-job/result reopening. Full team-history current-format export/import must restore missing history without requiring it to be preseeded; preserve existing corrections and authority guards. |
| Unallocated presentation/read-model interfaces | Restore bookmark marker positioning, original inline competition/disclosure behavior, trophy season-aware navigation, all calendar event-kind DTOs and D1 comparison. Allocate these explicitly before code changes outside the current file list. |
| Author: build/release tooling | After combining candidates, align final visible/package version and regenerate the required-only manifest/import graph. Preserve DB binding, ADMIN_KEY, SYNC, cron, old DB and ready data; validate the supported exact schema transition and maintenance pause. |

## Validation and release boundary

Run these from the combined QA checkout:

```sh
node --test tests/parity/*.test.mjs
npm test
npm run test:browser
npm run build
```

Node, native D1/Worker, DOM/browser and packaged build receipts are required after integration. This review environment exposes Functions V8 and GitHub, with no connected Node/Worker/browser checkout; it has not run those commands.

Current available receipts will be appended after the combined component checks. Component tests use actual source exports in V8 through an import adapter; private Coach callbacks and the minimal host are explicit fixtures. Original characterization tests execute exact old pure functions with synthetic records. No real provider requests, production queries, authentication or deployment occur.

This branch deliberately retains the deployed version/configuration and existing release manifest. It is not a deployable packaged release: author-owned tooling must regenerate the final manifest/version after integration. The source oracle and QA files must remain outside the required-only runtime archive.

All 31 gates still require final-artifact receipts. Real provider updates and server-persisted progress while every browser is closed remain required after approved deployment.

## Recorded isolated component receipts

| Group | Available result | Boundary |
| --- | --- | --- |
| Actual screen renderer/imports | 5/5 cases passed in Functions V8 | Synthetic DTOs; no DOM or visual rendering |
| Actual detail controller/guarded reads/render imports | 13/13 cases passed in Functions V8 | Private Coach fixture and minimal host; no actual Coach service/HTTP/browser |
| Actual spatial renderer/imports | 8/8 cases passed in Functions V8 | Native-kind synthetic coordinates; no browser image rendering |
| Combined three changed modules | 26/26 runtime component cases passed | Same assembled source imports, not a native/application acceptance suite |
| Exact original analysis source oracle | 13/13 characterization cases passed | Original source with synthetic records; target inference remains unimplemented |
| Regression controls | All 9 detail cases, first spatial box-touch case and first screen highlighting case reject unchanged 7.1.4 | Independent controls; no production observation claimed |
| Node wrappers/full suite/native Worker/browser/build | Not run in this disconnected review environment | Must run on the combined candidate |

The V8 checks used an ESM import adapter and Node-compatible assertion adapter. All unchanged web dependencies were loaded from the pinned base. Standard Node test wrappers are checked in for reproducible execution; their Node/TAP execution has not been claimed. These counts are component cases, not a count of accepted product gates.

## Independent-review correction and remaining Coach integration risk

The first review commit `4738a3a3c9c09c87e69a2214649d648a3e533198` passed its then-available 22 cases, but independent review found that its detail-open epoch incorrectly invalidated all later operations after a modal opened. It is superseded by the branch head. The correction separates stable detail identity/team/season/role from each operation's current epoch. Pool counts now page Next/Previous across modal epochs and detail paging resumes after modal close, while pending reads/hydration/private-panel work remain fenced.

Four additional controller cases model the real main.openModal/closeModal epoch changes. Two fail against the first review commit and pass after correction; the two in-flight modal rejection cases also pass. The corrected combined runtime cases are 26/26 (screen 5, spatial 8, detail 13). Original-oracle characterization remains 13/13 separately.

Actual `web/app/coach-features.js` command/reload callbacks have their own state and direct DOM writes. They are not exercised by the private Coach fixture in these controller cases. Its cleanup currently stops timer/interaction bindings without invalidating all pending commands, so combined-candidate testing must cover command/reload completion after another detail opens, logout or scope changes. Allocate that frontend file before changing it, and pair its generation fence with author-owned coaching/service validation. This isolated controller patch does not claim to fix those separate callbacks.
