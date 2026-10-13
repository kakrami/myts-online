# Published-game consumer integration

Prepared on 2026-10-13 in the isolated consumer worktree. No deployment, production data change, or frozen 7.2.8 release modification.

## Behavior

- Event correction editors resolve the exact app-team/season published game. The displayed target and the sole existing physical correction key remain distinct. Independent originals are a conflict, never silently merged or deleted.
- Event writes and resets compare the current membership/evidence snapshot and complete correction-key snapshot in the same domain CAS batch. Empty resets have the same fence.
- Normalized games require the opaque published-scope token. Legacy games permit a missing token; supplied wrong, empty, and null tokens are rejected. Event and bookmark HTTP bodies carry the token unchanged.
- After local source removal, owners can read an exact saved correction key with no current provider overlays and no edit controls. Writes and viewer access remain denied.
- Schedule/overview derive token metadata from their bounded current-published queries. Match detail exposes its already-resolved scope token; the ordinary bookmark control carries it through the feature handler and real HTTP route without changing event IDs. Current command errors render visibly; stale route completions remain ignored.
- Interactive Trace source admission uses the exact current published member, even when its native canonical ID differs from the display target. Provider/account/native event/member/clip/provenance and generation proofs remain required. The membership snapshot also fences real job admission.

## Verified

Pure SQLite/service/HTTP tests: 136 passed, zero skipped or failed.

Command:

```
node --test tests/team-game-event-consumers.test.mjs tests/team-game-track-admission.test.mjs tests/team-game-owner-commands.test.mjs tests/team-game-read-consumers.test.mjs tests/published-analysis-scope.test.mjs tests/shared-analysis-source-proof.test.mjs tests/schedule-period-order.test.mjs
```

DOM tests with pinned jsdom: 8 passed, zero skipped or failed. The bookmark tests mount actual main.js, navigate Schedule to match detail, use the real applicationRoutes/database, save and remove the bookmark, and preserve original saved rows after a stale-token failure.

```
MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom/lib/api.js node --test tests/team-game-bookmark-ui.test.mjs tests/analysis-scope-token-ui.test.mjs
```

The pre-existing read-consumer fixture redundantly appended the extension schema after DOMAIN_SCHEMA. Its fixture now uses DOMAIN_SCHEMA once; all 19 assertions are retained and passing.

## Initial native gate (superseded below)

The native slot was not used. The new `tests/team-game-consumers.native.mjs` is syntax-checked but not run. It exercises the normalized public-target/private-original correction and exact Trace source-admission statements against native D1 and the real installation epoch writer, including atomic stale admission rollback and a 48-statement budget with 20 prior route statements reserved.

Run it in the serialized native slot, and rerun `tests/shared-analysis-source-proof.native.mjs` to preserve legacy provider-proof coverage. Pure SQLite cannot certify D1 depth100, native writer composition, or native statement budgets. No native pass is claimed here.


## Native closure and SQL factoring, 2026-10-13

The initial native run reproduced real D1 failures, retained in `published-game-consumer-native-red.log`:

- Exact error: `D1_ERROR: Expression tree is too large (maximum depth 100): SQLITE_ERROR`
- Both normalized and legacy source-proof preflight failed.
- Ordinary player season statistics, player detail, and the Summary report query failed.
- The unfactored Summary query was 51,546 bytes, above the unchanged 48,000-byte snapshot SQL limit.
- Red source-map fingerprint: `4a57889a92041a1b3e160ccc2a15ba6ad69a0bc76481c0d11480805dc923b3bf`.

The fix changes only SQL composition in three runtime files:

- `src/analysis/source-collection-proof.js`: materialize the unchanged provider/native authority predicates, then join the exact published member at a shallow level.
- `src/analysis/reads.js`: bind the selection once; keep filtered statistics candidates and attendance candidates independent; reuse one published-membership CTE and one source-qualified active-analysis relation.
- `src/read-model/attendance.js`: optionally consume an already-declared, validated published-membership CTE instead of repeating its expansion.

`team-game-scope.js`, its full snapshot construction, entitlement predicates, owner-state fences, database schemas, and all SQL size/depth limits are unchanged. No authority condition was dropped.

### Final receipts

- Pure/service/HTTP/report suite: 135/135 passed, zero skips. This includes the new old/new authority and selection matrix and actual-query compile checks.
- Frozen pre-factoring oracle: `tests/fixtures/consumer-authority-before-shape.mjs`, copied from consumer commit `24d3f93`.
- Old/new matrix: 14 legacy states and 17 normalized states, each with five independent selection variants. Native authority and complete player rows remain identical, including account/root/clip/member changes, rejected groups, publication changes, date/type/period/search filtering, and retained collection-output revisions.
- D1-shape compile test: 100 captured actual statements per version, 36 distinct SQL statements, maximum 40,612 bytes and 24 bound parameters. All compile with depth100, compound-select5, parameters100, and SQL100,000 limits. Every ordered report query remains within the unchanged 48,000-byte persisted-query limit.
- Native: 6/6 passed, zero skips, under the real full installation and epoch writer. Complete output is in `published-game-consumer-native-green.log`.
- Green source-map fingerprint: `e8e57a8c7e5fb575f076b82015f9631fad89fc4c3802ca77cd21c4f8a5e3fcd2`.
- Native player summary: 13 statements; player detail: 26; Summary query plus snapshot capture: 26; bookmark save/stale/remove: 35. Each includes eight prior-route statements reserved.
- Native event editor read: 5 statements; write preserving the original correction key: 16.
- Native normalized and legacy Trace admission: 44/48 statements, including 20 prior-route statements reserved. Five native source children retain their exact provider arguments.
- Native stale normalized admission: 15 statements; atomic rollback leaves no jobs. Legacy provider/stale-root/file-only commit checks each use 13 statements.
- Native Summary query: 40,262 bytes; real immutable snapshot admission and complete six-row preview succeed.

The normalized fixture deliberately keeps the original correction/native Trace identity as `event` while the displayed group target is `public-event`. Saved-only owner reading after unlink and complete transaction cleanup are verified.

Final focused commands:

```
node --test tests/team-game-consumer-shape.test.mjs tests/team-game-event-consumers.test.mjs tests/team-game-track-admission.test.mjs tests/team-game-owner-commands.test.mjs tests/team-game-read-consumers.test.mjs tests/published-analysis-scope.test.mjs tests/shared-analysis-source-proof.test.mjs tests/reporting-parity.test.mjs
node --test --test-concurrency=1 tests/team-game-consumers.native.mjs tests/shared-analysis-source-proof.native.mjs
```
