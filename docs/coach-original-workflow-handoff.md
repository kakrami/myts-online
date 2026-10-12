# Original Coach workflow restoration

Baseline: original myTS 6.20.133, commit `50e1be224806ff7e7c439d26e15fd0421e3f6f01`. The independent executable source oracle and its source locations are in `tests/parity/original-coach-fixtures.mjs` and `docs/original-coach-reports-oracles.md`.

## Scope and preserved boundaries

Runtime changes are confined to `src/coaching/service.js`, the one target constraint in `src/coaching/schema.js`, `web/app/coach-features.js`, and new Coach-only `coach-tactics.js` / `coach-presentation.js` modules. The tactics module is pure and shared by Worker and browser; it has no DOM imports or separate scoring implementation. Existing generic forms/screens and analysis code are untouched by this change. The read adapter reuses the selected-season player query and inclusion contract.

The only persisted schema change is `coach_sessions.half_minutes BETWEEN 5 AND 90` instead of 60. The schema owner separately supplies the exact-version preserved-data reconstruction of this table and its dependent child tables. Do not deploy the target constraint alone against an existing database. No Coach rows are reset. Existing team-lifecycle, accepted-game-season, identity, owner-only and revision fences remain intact.

## Restored original behavior

- Pregame create defaults to seven players when source format is unknown and 25-minute halves. Source format 7/9 is shown when known. Reconfigure an existing pregame plan between 7/9 and integer 5–90-minute halves without losing players or timeline. Reducing below the occupied field count is rejected.
- All 23 original geometric slots are available. Original SW, LCB, RCB, LCM, RCM and SS position ratings are restored. Left/center/right striker identities are `ST:L`, `ST`, `ST:R`, all using the ST rating. Saved named-position plans, including LF/RF, remain readable and editable. No ordinal slots are shared with the analysis resolver.
- Starter suggestions use the exact original preferred slots, exact-position/group/natural-role weighting and stable roster tie order. The suggestion is previewed before explicit application; an incomplete roster produces the original partial suggestion and still cannot start a short field.
- Live running/paused recommendations use the original score, full-roster default target, explicit target zero, stable slot/roster ties and descending top three. Explicit Coach ratings remain separate from resolved and assigned source roles. The last five positive included selected-season Trace minute rows affect explanation only. Unknown values are not fabricated as zero source evidence. Both initial read and local timer use the same pure scorer.
- Halftime retains first-half period until the second half starts. Second-half start resets the period clock, retaining total and per-player time. Pause/resume excludes stopped time; half length never automatically ends the clock. A full lineup can start at any valid original slot configuration, as in the source.
- Missed-substitution correction works paused, at halftime and after finish. It transfers proven recorded intervals and updates the current field. Previous explicit player-minute overrides remain distinct from interval provenance. Earlier arbitrary interval repairs preserve the current field; correction at the current clock end updates it. Negative/over-capacity or overlapping repairs are rejected. Scalar clock and player-minute adjustment controls are restored, alongside the rebuilt absolute correction tools.
- Coach attributes first show a private summary with Edit/Cancel; all original position choices and explicit zero versus blank inputs are preserved. End game opens a confirmation; cancellation leaves the match running.
- Original stylesheet classes, pitch geometry, desktop/mobile grid, drag targets, bench selection and recommendation controls are reused. Clock and minutes update locally without network writes. New form drafts receive dirty-state protection without editing the shared shell controller.

## Safety and compatibility decisions

The rebuilt interval and bounded-capacity contract remains stronger than legacy aggregate arithmetic: a missed substitution must be supported by non-overlapping recorded intervals; no invented time is added. All clock correction totals stay within recorded game and field capacity. The original backend's halftime-availability rejection is not copied: the original UI exposes that workflow, so the rebuilt service consistently supports availability while stopped at halftime.

The existing skipped-season profile carry-forward is preserved. The original source's previous-season-only query is a characterized limitation, not a reason to remove the README's carry-forward promise. Target minutes are whole numbers 0–180 as in the original validator; old stored profiles are not rewritten.

Interrupted clocks over 12 hours require review. A server-reviewed snapshot retains previously recorded minutes. A locally crossed threshold subtracts the previously sampled live gap exactly once, and never invents unaccounted time. The broader retained callback, modal epoch, detail identity, team/season, role and busy-ownership fences remain. Profile saves additionally have draft identity and single-flight protection.

## Scoped verification

- `tests/coach-original-parity.test.mjs`: 15 cases against actual CoachingService + SQLite, original pure functions and clock presentation. Includes 7v7/9v9 paired source workflows, 450-minute capacity, configure90 persistence/reload, old/new slots, exact scoring, source null/zero, owner denial, CAS, pause/halftime/finished missed substitutions, corrected-minute provenance and interrupted-clock regression.
- `tests/coach-workflow-ui.test.mjs`: 11 actual DOM → production route → SQLite workflows, including profile Edit/Cancel, repeated save, delayed callbacks, configure drafts, recommendations/timers, tap/drag, end-game confirmation and halftime corrections. Incomplete rating pairs and duplicate positions are rejected before any request; drafts remain intact.
- `tests/coach-ui.test.mjs`: existing 35 controller interruption/navigation/modal/callback cases retained.
- `tests/parity/original-coach-oracles.test.mjs`: existing 34 original-source characterization cases retained. Passing these alone is not rebuilt parity.
- `tests/coach-workflow.native.mjs`: passed 1/1 on the single native runner and disposed; actual assembled Worker/D1 route fixture covers configure90, three simultaneous striker slots, starter and live suggestions, explicit substitution, halftime missed-sub correction, second-half resume, 450-minute total, unchanged read revisions and foreign keys. It records each HTTP statement count and asserts the 48-statement ceiling. The canonical roster is synthetic, and elapsed time uses explicit owner corrections. The terminal native receipt reports 20 successful Coach HTTP requests, maximum 23 statements (limit 48), with all interval, revision and foreign-key assertions passing.

The final pure/DOM/source aggregate passes 95/95, zero skips. The native component additionally passes 1/1.

Run the pure/DOM/source suites with:

`MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom node --test tests/coach-original-parity.test.mjs tests/coach-workflow-ui.test.mjs tests/coach-ui.test.mjs tests/parity/original-coach-oracles.test.mjs`

Release source/dependency/schema validation passes with `node scripts/release-check.mjs` (178 required files at the scoped check). Full integrated checks, independent review, native frozen-candidate receipts and real-device lock/reopen/visual comparison remain separate release requirements. No remote publication, deployment, auth changes or data reset was performed.

## Native evidence identity

Command: `node --test tests/coach-workflow.native.mjs`, run from frozen `/tmp/myts-coach-native-20261012T1955`. Log: `/tmp/coach-workflow-native-20261012T1955.tap`. All 250 snapshot file hashes are in its `snapshot.json`; snapshot manifest SHA-256 is `f7f361abe5da2c4a291fba67510372d6b9edf2d275913fa924c5fac9d48d22e0`. Before/copy/after content hashes matched at capture.

The materialization harness loaded Worker source fingerprint is `75da1cf2c6b8f68998e31f3ec8d27d9e4a1b78d9bb920f42e340c621e7a39e64`. The source dependency fingerprint uses sorted module filenames plus NUL plus exact module contents, joined by NUL and SHA-256, before harness diagnostic transforms. Runtime elapsed: approximately 8.1 seconds including startup/disposal.

After native capture, the independent reviewer requested a frontend-only correction rejecting incomplete or duplicate profile position/rating rows. That change affects `coach-features.js` and its three new DOM regressions; the native Coach service, schema, pure tactics, route and native test remain unchanged. The final 95-case browser/source aggregate covers the post-capture UI change. Do not use this scoped native receipt as an unchanged whole-repository fingerprint after other owners edit unrelated modules.
