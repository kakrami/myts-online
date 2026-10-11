# myTS 7.1.0 verification ledger

This ledger distinguishes the rebuilt implementation, local component tests, tests of the extracted required-only package, and real-provider/production acceptance. It does **not** declare all 31 gates fully accepted. All 25 final automated checks passed. Real-provider and production acceptance remain unverified. The delivered archive contains the same tested application, assets, configuration and tooling; only this finalized ledger, the clarified deployment guide and the manifest differ from the tested candidate.

## Artifact and test environment

| Field | Recorded value |
| --- | --- |
| Visible/package version | 7.1.0 |
| Delivered files | 125 required files plus one release manifest: 126 total; tests, fixture accounts, node_modules, historical runtime and migrations excluded |
| Frozen runtime SHA-256 | `875993732131b47d35532adfea27a6b99075de6ab1ac720ab7b58de4fc710500` |
| Fresh schema fingerprint | `e52ac3c69e4cdf8d5b30a8c4587b9080a6220436b3b6d421d72a45781420b003` |
| Fresh schema | 121 tables; domain version 1 |
| Candidate ZIP SHA-256 | `5a7885dc8b49d13ce1db2e3461934ecadea742719073ea75a458604050e12658` — pre-final-ledger candidate, not the final delivered ZIP |
| Candidate manifest SHA-256 | `b82c961203989f2542239e5c6b065109b5d108d903e8c44a0ce3c4bf108c51ec` |
| Final ZIP / manifest SHA-256 | Recorded in the external final release receipt; the included manifest records every required file hash. An archive cannot contain its own hash. |
| Local tools | Node 24.19.0; npm 11.9.0; pinned Wrangler 4.149.0 |
| Clean extracted install/build | PASS: `npm ci --offline --no-audit --no-fund`, then `npm run build` (dry-run only); 27 assets, 1067.97 KiB Worker bundle |
| Production deployment | Not deployed, initialized or inspected by this review |

The candidate was staged and extracted into a clean directory. Application HTTP tests load the Worker, modules and assets from that extracted package using `MYTS_TEST_PACKAGE_ROOT`. QA tests and deterministic fixtures remain outside the deliverable. The final archive differs from this candidate only in the finalized verification document, clarified deployment guide and manifest. Its runtime fingerprint is unchanged. Final test receipts were recorded at 2026-10-11 06:47:09 UTC.

Native local evidence uses actual Workerd, native D1 and SQLite Durable Objects. Provider responses and private accounts in these tests are synthetic. Chromium tests use real HTTP against the native Worker without browser network interception; synthetic provider transport is bound inside the test Worker. These facts establish local runtime behavior, not successful real TeamSnap/Trace authorization or production provider access. Historical real-source checks of an earlier release are not fresh 7.1.0 acceptance evidence.

## Exact-package receipts

Run QA commands from the QA repository with `MYTS_TEST_PACKAGE_ROOT=<extracted-package>`; run install/build inside the extracted package.

| Group | Command / receipt | Completed result |
| --- | --- | --- |
| Assembled API | `node --test tests/fresh-application.test.js tests/tracking-http.test.js`; `tmp/exact-api-7.1.0-b.tap` | **8/8 PASS**, 0 failed |
| Native Chromium UI | `node --test tests/frontend-native.test.js tests/frontend-private-native.test.js`; `tmp/exact-ui-7.1.0-b.tap` | **7/7 PASS**, 0 failed: five public/setup/report/boundary tests and two populated-private/capture tests |
| Release / detailed-analysis guards | `node --test tests/release-check.test.js tests/analysis-detail-reads.test.js`; `tmp/exact-guards-7.1.0-b.tap` | **10/10 PASS**, 0 failed |

The guard group combines frozen-repository component/tooling tests with native extracted-Worker HTTP and schema assertions. Its component imports are not all redirected into the extraction. Do not describe all ten as extracted-module tests. The assembled API and browser workflows exercise the extracted runtime; the runtime fingerprint ties it to the frozen source under review.

API checks cover bounded first-run setup, all four reports and actual XLSX/PDF bytes, public attachment/publication and changed-source recurring refresh, corrections/inclusion/bookmarks/viewer rotation/team removal, dataset ZIP export and staged import, Coach accounting/privacy, and selective tracking capture/security. Browser checks cover ordinary forms, navigation, downloads and the restored mobile interface. The long public browser workflow records 59 assertions at 320/390 px. These are desktop Chromium emulated viewports, not physical phones or a complete desktop/manual traversal.

The private browser suite passed populated canonical Attendance and match log, stable Trace comparison and selective Tracking evidence workflows. The tests assert Yes 1 / No 1 across a paged two-event selection; actual opponent/player detail; own/opponent comparison 60/40 possession, 15/8 completed passes and 2/0 box touches; changing the map side does not reverse the comparison. The capture test selects a named game, half, 60-second window and one opaque track, then downloads raw metadata/radar/Halo without publishing statistics. **Final candidate-b results: 2/2 PASS.** The UI capture downloaded three captured records (metadata, radar and Halo); the separate browser-closed HTTP capture selected two tracks and downloaded four records.

## All 31 acceptance gates

Every row has implementation and local evidence. Evidence references below are QA filenames under `tests/` without their `.test.js` suffix; paths are relative to `src/` unless prefixed `web/` or named as root files. A component PASS does not complete a real-provider or physical-device requirement. All seven packaged browser tests passed; the boundaries in each row still apply.

| # / gate | Rebuilt code and local component evidence | Extracted-package integration / remaining boundary |
| --- | --- | --- |
| 1. Shell and navigation | `web/app/main.js`; `web/ui-original/{shell,screens,interactions}.js`; selection-request and presentation/controller QA | Public Chromium traverses five tabs/details at 320/390 px. Physical phone, full desktop traversal and manual original-layout comparison unverified. |
| 2. Team contexts | domain/repository; application/sync-service and team-catalog; domain-workflow, application-sync, team-catalog | API/public UI use one logical team with source attachments and bounded catalogs. Real private connection order and entitlements unverified. |
| 3. Owner setup / TeamSnap login | security; application/auth-routes and fresh-install; security, application-auth, fresh-install | Empty-DB ordinary UI setup/sign-in passes. Client ID stays in one-time TeamSnap connection, not deployment Settings. Real OAuth registration/consent unverified. |
| 4. Account / source management | application/routes, sync-service, team-lifecycle; web/app/features; application-auth, application-sync, team-lifecycle | Native/API/UI cover named Manage flows, rename, removal and scoped lifecycle fences. Real provider reconnect/cancel outcomes unverified. |
| 5. TeamSnap / attendance | sources/teamsnap; domain/auxiliary; analysis/reads; source-contract, domain-workflow, analysis-contract, analysis-detail-reads | Detailed native reads cover Yes/No/Maybe/NR, missing/conflicting responses and full-selection paging; populated browser Attendance passes. Real active/archived account retrieval unverified. |
| 6. GotSport connect / discovery | sources/discovery and gotsport; application/routes; web/app/features; source-contract | API/public UI paste a public link, choose a named result and follow another team. Fresh live GotSport collection on this build unverified. |
| 7. GotSport Live / competitions | sources/gotsport; domain/identity; read-model/feature-reads; source-contract, domain-workflow, feature-reads | Synthetic native publication and changed-upstream scheduled refresh pass. Fresh real external-ID resolution, public memberships and published standings unverified. |
| 8. Trace login / selection | sources/trace; security; application/auth-routes; web/app/main; application-auth, source-contract, application-sync | Native ordinary email/code/selection contracts and recovery are fixture-tested. Real Trace login, access scope and account reuse unverified. |
| 9. Overview | read-model/repository and feature-reads; analysis/reads; read-model, feature-reads, analysis-contract | Public browser renders record/leaders/latest/upcoming from shared queries. Complete SQL totals beyond one page are component-tested; live provider totals unverified. |
| 10. Seasons / inclusion | application/inclusion and team-features; read-model/inclusion; web/app/main; team-features, feature-reads, analysis-contract | API/UI atomic inclusion draft passes. Browser boundary test resolves adjacent seasons through a 27-season paged catalog. Real identity/inclusion comparisons unverified. |
| 11. Schedule / filters | read-model/repository and feature-reads; web/app/main; web/ui-original/screens; read-model, selection-request | Native UI covers day/season filters, date-strip/calendar swipes and Previous/Next season boundaries. Physical touch/platform/date recovery unverified. |
| 12. Match / logistics | read-model/feature-reads; web/app/detail-features; web/ui-original/screens; feature-reads, analysis-contract | Actual public details/bookmarks/score-status edits pass; populated private player entry passes. Real private logistics/attendance unverified. |
| 13. Match identity | domain/identity and repository; application/identity-routes; web/app/identity-features; domain-workflow, feature-reads | Fixture proof, contradiction, time-change and doubleheader cases preserve explicit owner decisions. No names/time-only merge; fresh real correspondence unverified. |
| 14. Competitions | read-model/feature-reads; sources/gotsport; web/app/features; feature-reads, source-contract | Browser cards/details/standings pass; whole-category pagination and terminal coverage are component-tested. Current real published competition results unverified. |
| 15. Roster / season table | analysis/reads; read-model/feature-reads; web/ui-original/screens; analysis-contract, feature-reads | Shared complete-selection totals, sorting and one canonical linked row are native-tested. Populated private browser rendering passes; live native stats unverified. |
| 16. Trophies | read-model/feature-reads and feature-schema; web/app/features; feature-reads | Public browser owner trophy create/delete passes; all-season/terminal-only calculations native-tested. Real provider award qualification unverified. |
| 17. Player details / navigation | analysis/reads; web/app/detail-features; web/ui-original/screens and interactions; analysis-contract, analysis-detail-reads | Full paged match/Attendance DTOs pass. Populated tabs and match-player UI pass; complete physical swipe/Back/scroll matrix unverified. |
| 18. Trace analysis | sources/trace; domain/auxiliary; analysis; source-contract, analysis-contract, analysis-detail-reads | Native guards pass full/half, null/zero, own/opponent and player scope. Populated comparison/map-side browser passes; real components/license availability unverified. |
| 19. Corrections / lineup | analysis/service; application/event-editor; web/app/detail-features and lineup-features; analysis-contract, feature-reads | API/UI score-status corrections, CAS and inherited/explicit values pass; capacity/source-refresh and lifecycle fences component-tested. Physical two-device drag/edit matrix unverified. |
| 20. Player links | domain/identity; application/identity-routes; web/app/identity-features; domain-workflow, analysis-contract, coaching | Explicit canonical link/unlink/conflict cases native-tested; private UI fixture uses a linked person. Real identity comparison and every manual link gesture unverified. |
| 21. Coach | coaching; web/app/coach-features; web/ui-original/forms; coaching | API proves 450 player minutes for 9v9/50 minutes through explicit owner clock corrections, read-only ticks and viewer denial. Full live timer/gesture/phone-lock workflow unverified. |
| 22. Bookmarks / follows | application/team-features; read-model/source-team; web/app/features and detail-features; team-features, source-team-reads | Browser save/reopen/remove and source-team follow chooser pass; all-season persistence and conditional-slot exclusion native-tested. Fresh live source omissions unverified. |
| 23. Reports | reporting/service, encoders and routes; web/app/reports; reporting | API prepares all four reports with native alarms; browser downloads genuine XLSX/PDF after readiness. Component 237-row ordering/full snapshot proof; production CPU/quotas unverified. |
| 24. Dataset / evidence / capture | reporting/data-files and data-routes; domain/dataset and serialization; tracking; web/app/data-files and tracking-capture | API actual ZIP export/upload/validate/commit and complete/partial raw capture pass with native background execution. Scoped file guards: 17 native cases; capture component/controller security tests. Capture browser workflow passes; real fresh private capture and production import unverified. |
| 25. Branding / themes | read-model/branding; application/team-features, club-kits and team-catalog; web/app/features; branding-contract, team-features, team-catalog | Browser shared protected logo and named/color season kits pass; local shared-theme/reset contracts covered. Full physical legibility matrix in all themes unverified. |
| 26. Viewer links | security; application/bootstrap and routes; web/app/main; security, application-auth, shared-metadata, reporting | Signed-out and owner-cookie explicit viewer mode stay read-only; rotation and category-limited schedule/reports common metadata pass. Wrong-team/private/Coach/export guards local; production sharing unverified. |
| 27. Status / diagnostics | sync/coordinator and runtime; application/routes and sync-service; web/app/features; sync-workflow, application-sync, team-catalog | Native totals exceed 40 jobs; attempt/retrieval/save/complete clocks and sanitized diagnostics covered. Source health excludes artifact jobs. Production D1/plan ceilings unverified. |
| 28. Browser-closed updates | sync/runtime and coordinator; worker scheduled handler; sync-workflow, application-sync | Exact-package API proves initial work, changed upstream scheduled refresh, reports, data files and capture without app runner requests. Due clock is accelerated; real production cron/provider updates unverified. |
| 29. Security lifecycle | security; application/auth-routes; domain/repository; security, application-auth, shared-metadata, reporting, data-files, tracking, release-check | Independent vault/password rotation, hashed/revocable sessions, single-use bound OAuth, viewer exclusions and atomic deletion/account fences native-tested. Production configuration/trust boundary not inspected. |
| 30. Async / mobile recovery | web/app/transport, feature-requests, main and tracking-capture; web/ui-original/interactions; selection-request, data-files-controller, tracking-capture-controller | Local stale-response, context cleanup and harmless discarded-read retries covered; native mobile UI passes public workflows. Orientation, keyboard/focus, reduced motion and full physical drag cleanup matrix unverified. |
| 31. Fresh install / ZIP | worker; application/fresh-install; scripts/release-check; wrangler.jsonc; fresh-install, release-check | Required-only 126-file extraction clean install/build and 8 API / 7 UI / 10 guard tests pass. Final archive CRC, per-file hashes and runtime identity checked against the tested candidate. No compatibility readers/migrations; no deployment. |

Gate 24 preserves actual original workflows: unified dataset import/export, saved source-evidence export and the bound selective Tracking evidence capture. The historical `downloadPlayerDiagnostics` definition had no caller/button and used an undeclared cursor; it was not a working UI flow. Saved evidence and raw capture JSON are export-only. Current-release dataset imports are validated source observations, never imported identity approvals, ownership proofs, credentials or canonical corrections. The exact-package round trip re-imported into its already connected and observed scope; it proves validated idempotent staging and native completion, not restoration into an unrelated empty database. Scoped serialization clocks and atomic captured-token fences protect immutable exports while unrelated teams' source/projection writes continue; attachment/account/season/lifecycle changes invalidate the affected capture.

## Browser-closed native receipts

All times below are 2026-10-11 UTC, from the exact candidate-b API receipt. Tests poll native D1 while closed; they do not call collectors, manual job runners or retry application routes. Native Durable Object alarms perform the work. Synthetic provider responses remain the upstream boundary.

| Workflow | Closed / admitted | Persisted background completion | Evidence |
| --- | --- | --- | --- |
| Four report snapshots | 06:43:13.535 | 06:43:15.558 | Four snapshot captures; zero manual runner requests. Actual XLSX/PDF exports and downloads were separately verified after readiness. |
| Public source initial and changed recurring update | Closed 06:43:20.105; changed upstream / scheduled dispatch 06:45:03.404 | Last saved and complete 06:45:09.605; reopened 06:45:09.654 | Accelerated due clock; one actual native Worker scheduled event; changed published score before reopen |
| Dataset ZIP export | 06:45:38.052 | Saved and complete 06:45:45.887 | Exact current-release artifact; 17 rows / three validated segments in round trip |
| Dataset staged import | Commit 06:45:46.022 | Saved and complete 06:45:47.563 | Zero source writes before commit; native alarms apply after commit |
| Selective raw tracking capture | 06:45:54.493 | Saved and complete 06:45:56.554; reopened 06:45:56.622 | Four raw records, zero app requests while closed, no source/statistics publication |

These receipts demonstrate independent resumable background processing in the local native runtime. They do not measure wall-clock production cron, production egress/CPU/D1 limits or changed real provider data.

## Remaining acceptance boundaries

Fresh real TeamSnap consent/registration and Trace email/code/account/team entitlement flows have not been verified. Fresh live GotSport/Live collection on the final build, production Cloudflare plan/bindings/egress/CPU/D1 behavior, production scheduled advancement with every app tab closed, physical-phone behavior and complete desktop/manual traversal remain unverified. Full Coach phone-lock/gesture behavior and the complete orientation/focus/keyboard/reduced-motion/two-device interaction matrix also remain unverified. Repository upload and account sign-in from a physical phone have not been verified. No historical release receipt substitutes for these checks.

The local package has not been deployed or connected to the old database. Review uses a fresh schema; deployment guards reject the old resource identity, placeholders and foreign/incomplete schema shapes. A real remote database/plan must be inspected at deployment time; that inspection was not performed here.

The external final release receipt records the delivered ZIP and manifest hashes and confirms equality with the tested runtime/schema identities above. This review package is ready for review; the remaining real-provider, production and device acceptance boundaries require separate verification before declaring production readiness.
