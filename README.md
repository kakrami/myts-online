# myTS 6.20.30

## Readable pitch editing

When position choices are visible, other player markers fade and the selected player stays identifiable. The dragged preview remains fully visible above the pitch. All 22 targets keep their full label contrast; a drop or Cancel restores normal marker styling.

---

# myTS 6.20.28

## Lineup target visibility

All 22 named pitch targets appear above occupied player markers during drag or tap placement, so each choice remains visible and reachable. The positions and compact Lineup Save/Cancel controls introduced in 6.20.27 remain in place.

---

# myTS 6.20.27

## Lineup positions and controls

Match lineup editing uses the supplied position map: GK, SW, LB, LWB, LCB, CB, RCB, RB, RWB, LM, LCM, CDM, CM, CAM, RCM, RM, LW, SS, CF, ST, and RW. The pitch shows 22 placement targets because it has left and right ST spots. Both spots save the standard ST position and their own pitch coordinates. Saved positions work in match player detail and across the lineup. Legacy generic role values remain readable but are not offered as new position choices.

The editor shows Save and Cancel beside the Lineup title, above the pitch. Changes remain drafts until Save; Cancel discards them. Goal and assist edits remain in the match player view.

---

# myTS 6.20.26

## Current baseline

The pitch is the match lineup editor. Tap or drag a player to reveal all 15 named position targets; dropping a player saves the position and placement. Dropping onto an occupied spot swaps the players. The displayed formation is derived from player positions. Match statistics remain editable in the match player view.

The Worker and package both report 6.20.26. The GitHub source version and live Cloudflare deployment must be checked separately.

---

# myTS 6.20.25

## Lineup preview, position targets and substitute consistency

The previous drag preview was appended inside the editing form. The form sits inside an overflow-clipped sheet with backdrop filtering and, on mobile, a will-change transform. A fixed preview there does not share the viewport coordinate system used by pointer clientX/clientY. The preview now mounts directly under document.body. Drop, Escape, pointer cancellation, lost capture, window blur, hidden document and editor removal clean up the preview and capture.

Position targets were deliberately omitted when a starter was within nine percentage points. A complete formation could therefore hide every target. The formation provides one stable set of targets. All of its targets render, including occupied rings, with occupied target labels above their rings. Current player markers remain valid swap destinations without adding overlapping targets. Drops and taps on an occupied ring use the same swap action as drops on a player. Applied formations also drive target generation.

One marker renderer now supplies pitch starters, substitutes and unplaced players in both normal and edit mode: jersey/position, name and the existing goal/assist stacks. Normal markers all retain the existing match-scoped player links. Edit markers share selection styling and drag behavior. The old substitute chip styles and avatar-specific icon offsets were removed.

## Validation status

Passed: full nine-player target DOM, occupied-ring bench swap, shared marker and match identity, body-level preview coordinates, drop/cancel/blur/lost-capture/Escape/navigation cleanup; existing editor save/cancel and capacity checks, competition navigation, native spatial-data regressions, and bundled/minified admin startup.

Browser pixel/layout and physical-device touch validation are outstanding. This is a draft candidate, not a visually verified production fix. No database, provider-sync or configuration changes. The ZIP contains only worker.js, package.json, wrangler.jsonc and README.md.

---

# myTS 6.20.24

## Drag-and-drop lineup editing

Edit on the lineup card now enables editing in place. Drag a player onto a visible position target, another player to swap, or the substitutes area. Mouse, touch and pen use Pointer Events with capture. Tap selection plus target buttons and keyboard arrows offer alternatives. Invalid drops, pointer cancellation and Escape cancel the drag without changing the draft. Starting-player capacity is checked before a move.

Placement, swaps and substitutes share one draft mutation path. Visible locations are stabilized before changing the starting lineup, while untouched player roles keep their automatic evidence priority. Saved placement is a manual match override; match heatmap and manual season positions remain the fallbacks. Background entity refresh waits while the editor is open. Save uses the existing correction endpoint and conflict tokens; Cancel discards the draft. No database or provider-sync changes.

Validation: simulated pointer drag/tap/cancel/invalid-drop interactions, inline mounting, swaps, bench insertion/removal, capacity rejection, draft isolation, correction payload and existing UI/spatial regressions passed. Bundled/minified Worker admin startup passed. Physical-device touch and browser visual verification remain outstanding. Intentional goal/assist stacking is unchanged.

---

# myTS 6.20.23

## Competition and fixture navigation

Fixture team links previously used `display:block` and `flex:1`, placing broad team-history click targets above the game's full-card button. The links now occupy their visible team identity and are underlined; the remaining card area opens that fixture's Overview. Explicit team-name clicks still open team details.

The shared match renderer also dereferenced `g.game_id` while constructing admin player controls for GotSport-only fixtures. That path is now gated on available player statistics. Fixture lookup includes the event identity and uses the displayed competition's canonical items, including linked and unconfirmed fixtures.

Competition names share one logo/name component and delegated navigation across the overview, schedule, match hero, competitions, trophies, team search, season filters and report preview. Navigation opens the existing Competitions page at the matching competition/division. It selects the applicable season and period, opens the section, and preserves the previous view and season for browser Back. Competition references discovered outside the selected team's list can appear in that same page; missing cached schedules remain explicitly empty rather than presenting invented fixtures. Selector options remain selectors.

## Pitch-based lineup editing

The dropdown table has been replaced with the existing pitch visual, substitutes, formation presets for common formats, and a custom formation option. Select a player and tap the pitch to place them, or use the explicit Swap action and select another player. Keyboard arrows move the focused pitch player. Position buttons, minutes, goals and assists are in the selected-player panel.

The editor and lineup view share band-coordinate calculation. Position priority remains manual match, match heatmap, then manual season. Changes use the existing correction endpoint and optimistic update tokens. Save checks numeric limits, starter capacity, and duplicate positions. Cancel discards the draft; Reset edits clears draft overrides and requires Save. A full lineup requires swapping or removing a starter before adding another.

The old table styles and obsolete tournament-open helper were removed. Intentional goal/assist icon stacking is unchanged. Attendance and schedule source labels were removed from the match overview; actual attendance and meaningful availability/error messages remain.

## Validation

Passed:
- Reproduced the prior GotSport-only admin overview exception and verified the new renderer opens Overview.
- DOM interaction checks for repeated fixture binding, competition identity/navigation and browser Back restoring the view/season.
- Pitch editor checks for selection, swaps, substitutes, formation application, draft isolation, reset/cancel, correction payload, save and reopen.
- Bundled and minified admin startup, login handler initialization, and spatial-model initialization.
- Existing native-heatmap, position-priority, SQLite projection, identity isolation, coordinate and aggregation regressions.

DOM checks are not browser layout verification. Browser visual/mobile hit-area verification and live deployment testing remain outstanding; the available browser previously rejected the local fixture URL. No live Worker was changed. Deploy the four files using the existing workflow and preserve database bindings and secrets. No schema or provider-sync changes are included in this release.

---

# myTS 6.20.22

## Admin startup regression fixed

Version 6.20.21 embedded the shared spatial model into the browser using a Worker function's runtime `toString()`. Bundling with function-name preservation adds `__name` helper references inside that function. The helper exists in the Worker bundle but not in the browser. The embedded script consequently threw `ReferenceError: __name is not defined` before `boot()` and before the `/api/public/state` request.

The browser source is now embedded as literal HTML during release packaging. The shared spatial function remains identical in the Worker and browser, with source-parity checks; deployment no longer serializes a transformed function into another execution environment. No routing, authentication, database, or configuration changes are needed.

Validation reproduced the failure on the bundled 6.20.21 artifact and confirmed 6.20.19 passed the same startup harness. Version 6.20.22 passes bundled and minified startup checks: embedded script execution reaches `/api/public/state` and initializes the admin login controls without the helper error. These are DOM-based startup checks, not browser visual verification or a live deployment test.

All 6.20.21 spatial fixes are retained. Deploy the four files in this ZIP through your existing workflow, preserving bindings and secrets.

---

# myTS 6.20.21

## What changed

The lineup previously read legacy `player.spatial`, while the match analytics screen read a separate native PlayerFocus heatmap cache. A player could therefore have a published native heatmap and 54 minutes but no inferred lineup position.

The dataset read boundary now attaches native match heatmaps from the existing cache to the matching player. Match lineups, match profiles, season aggregation, and dataset exports consume this shared spatial model. The Worker embeds the same pure conversion function into the browser; there are no separately maintained server/client coordinate transforms.

Match position priority is:
1. Manually assigned match position.
2. Match spatial evidence, including recorded goalkeeper minutes and the native match heatmap.
3. Manually assigned season position.

A blank match position resumes inference. Roster positions do not outrank match evidence. Inferred positions remain estimates, not confirmation of the player's actual tactical assignment.

## Coordinate and identity handling

- Native heatmaps are validated and converted from row-major intensity grids to a common 24 × 16 grid, preserving mass and using the provider's own-goal-left / attack-right orientation. Intensity is not represented as a tracking sample count.
- Season heatmaps combine valid, consistently oriented maps using match minutes as weights, including older maps with different dimensions. Missing native distance is not displayed as a complete tracked-distance total.
- Identity resolution is scoped to the match and connected team's side: exact game gid, canonicalized away-team gid, unique game user ID, then unique game name. Ambiguous matches do not receive another player's grid. Multiple native gids for one player are not silently added together.
- Box touches and shots use a folded half-pitch with both ends aligned, following Trace's native renderer. Full-pitch defensive/middle/attacking percentages are omitted from these cards.
- Completed-pass endpoints are aligned using half timestamps and directional evidence, including the opposite second-half direction when only one half supplies evidence. Conflicting or missing evidence retains explicitly labeled field coordinates without tactical thirds. Player touches retain the provider's already inverted endpoints.
- Empty and unplottable maps render compact messages. Third percentages are shown only when the counts reconcile with the event total.

Provider rendering reference inspected during this repair: https://go.traceup.com/traceid/assets/FlexPage-CMYGfp83.js (HeatMap, PlayerTouches, TouchesAroundBox, Shots and CompletedPasses renderers).

## Cache and deployment behavior

Existing cached heatmaps become available to lineup inference on the next dataset load. No provider refresh, sync reset, database migration, or reconnect is required. Each dataset load adds two tenant-filtered cache reads; only native heatmap JSON is projected from the larger scope payloads.

New native analytics and an opaque revision are committed in the same database batch. The existing dashboard polling detects that revision and reloads the shared dataset. Timestamp fields retain their original meaning. The browser analytics cache is versioned to discard older response shapes. Existing match payloads are not rewritten during reads, avoiding races with season publication or manual imports.

This release also includes the 6.20.20 changes: separate unplaced starters and substitutes, shared sticky-scroll padding correction, match-only player panels with an explicit season-profile action, compact empty analytics, and removal of the unconditional change-of-ends banner. Intentional goal/assist icon stacking is unchanged.

Deploy the four files to the existing Worker, preserving the actual D1 mapping, secrets, runtime binding and migration identity. This ZIP has not been deployed by this session.

## Validation and remaining verification

Passed local checks:
- Worker and embedded browser-script syntax, including exact shared-factory parity.
- Sawyer's supplied 10 × 16 native grid through cache projection, position inference, and lineup selection. With the supplied Sep 20 roster/position diagnostics, all nine starters are placed and the two explicit substitutes remain substitutes. Sawyer's inferred label in this fixture is RM.
- Manual match / heatmap / manual season precedence, blank overrides, goalkeeper overrides, and invalid or unknown-orientation evidence.
- Away-team gid normalization, changed user IDs with unique names, duplicate identity rejection, game boundaries and tenant isolation.
- Mixed-resolution minute-weighted aggregation, empty maps, malformed grids, mirrored box/shot locations, halftime pass transforms, conflicting direction evidence and unreconciled thirds.
- Actual SQLite execution of the cache projection and native revision invalidation. Projection performs only reads and does not enqueue Trace requests.
- Exact preservation of the intentional contribution-icon rendering function.

The browser security policy rejected opening the local fixture, so mobile/desktop visual behavior is not browser-verified. Production data and the deployed Worker have not been exercised. After deployment, confirm Sep 20's lineup and Sawyer's match profile, the box-touch/shot half-pitches, scrolling tabs, and match-player back navigation. The existing diagnostic export includes spatial source, identity-resolution source, gid, model version and rejected-evidence details.

---

# myTS 6.20.19

## Database reliability and runtime evidence

Deploy the four files in this ZIP to the existing Worker. Preserve the existing D1 database mapping, MYTS_RUNTIME binding, ADMIN_KEY, other secrets, and Durable Object migration identity. Merge the included `version_metadata` binding into the deployment configuration so Cloudflare's version ID is reported. No paid service, database reset, or provider reconnect is required. Deploying does not restore an exhausted daily quota.

### Findings and limits

The supplied 6.20.18 emergency report shows 9,147,935 reads attributed to Trace analytics scopes, missing background sources in the shared ledger, and unversioned background jobs retrying after 60 seconds. It does not prove that the alarm handlers were running 6.20.18, which query caused those historical reads, or why app totals exceeded the account allowance. Counters persisted across releases; their day is the UTC measurement day, not the deployment date. Do not equate these totals with verified Cloudflare billing.

The 6.20.18 source already has a matching partial index and ordered query for full-match analytics. A 3,024-scope SQLite fixture uses that index without a temporary sort; without it the query scans the team's queue and sorts. The query and index are retained. This release captures the actual production query plan once per Trace runtime release after database access resumes. It does not add a duplicate index or replay data migrations to address an unproven cause.

### Changes

- Runtime status reports the running app version, optional Cloudflare deployment metadata, instance ID, and start time. Every completed alarm records its own version and instance, distinguishing current code from persisted historical job results.
- Emergency diagnostics republish each runtime's persisted counters before reading the shared ledger. They show missing sources, version mismatches, reporting errors, and ledger-versus-runtime differences. Diagnostics do not read D1. A report taken during active work is not an atomic account-wide snapshot.
- Usage checkpoints persist only new measurements. Repeated saves, concurrent saves, and retries after reporting failure do not add the same measurement again. Deferred API work checkpoints usage on completion. Per-release totals distinguish 6.20.19 measurements from inherited daily counters; historical counters are preserved.
- Long invocations refresh the shared budget after 32 queries, 20,000 reads, or 250 writes, whichever comes first. A quota/budget pause is retained by the invocation's database wrapper: subsequent queries stop even if provider code catches the original exception. The outer alarm honors that pause and schedules recovery after the UTC reset. Accounting-report errors no longer prevent saving the alarm's outcome and next schedule.
- Trace alarm results expose completed analytics scopes and game progress when returned by the collector. SQL cost samples remain available without parameter values, alongside the saved execution plan and actual schema marker.

Background limits remain 3,000,000 measured reads / 70,000 writes per UTC day, with foreground headroom up to 4,500,000 reads / 95,000 writes. Directory work retains its 15,000-write target. An actual quota error blocks database access until 00:00 UTC; a fresh coordinator waits until the first UTC reset to establish a baseline. Cron wake-ups preserve paused alarms. Queued work, provider connections, and saved stats remain intact.

These application budgets are conservative controls, not hard account-wide reservations. In-flight queries/batches, overlapping invocations, abrupt termination before checkpointing, other apps, and unmeasured historical operations can cause divergence. Cloudflare's account allowance and row metrics remain authoritative. See [D1 pricing and measurement](https://developers.cloudflare.com/d1/platform/pricing/) and [version metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/).

### Production verification still required

1. Deploy, then open `/admin` and download emergency diagnostics using the existing owner key. All runtimes should report 6.20.19; older or unknown `last_run.version` is historical until that job executes. Missing current runtime versions identify a deployment inconsistency rather than proving an old instance from its error text alone.
2. Confirm all five usage sources are present, reporting errors are null, and reconciliation differences are understood. Compare the same UTC window with Cloudflare D1 Metrics > Row Metrics; do not sum repeated cumulative diagnostic snapshots.
3. During exhaustion, background outcomes should become `budget_paused` with next alarms at the UTC reset, not 60-second quota retries. Health and owner emergency export should remain available.
4. After the reset, alarms should resume automatically. Trace's saved query plan should reference `idx_trace_analytics_full_queue`, without a temporary sort. Review statement costs and 6.20.19 release totals over the day.
5. Confirm a newly published match and its player stats arrive without manually triggering sync, and confirm daily account usage remains within the free allowance. Existing provider refresh/retry schedules still apply. A single healthy response or a passing local test is insufficient evidence.

Local validation: Node syntax and embedded UI script parsing; mock Durable Object/D1 tests covering first/run/batch accounting, repeated/concurrent checkpoints, failed-report retries, shared exhaustion, owner-only D1-free diagnostics, source reconciliation, cron pause retention, UTC rollover/alarm recovery, foreground reserve, and mid-invocation budget refresh; SQLite queue selection with 3,024 scopes, deferred jobs, and new-match eligibility. SQLite instruction counts are not Cloudflare row counts. No authenticated production deployment, live billing reconciliation, or real-provider end-to-end collection was performed for this release. The quota problem is not yet verified fixed.

## Match editing and full-match analytics

Admins can open Edit from Match > Lineup or Edit match players from Player stats. Set starters, enter a formation excluding the goalkeeper (for example 3-3-2 for 9v9), and apply it. Slot choices move players within that formation. Positions, minutes, goals, and assists are editable in the same table. Save is one atomic database statement across players with optimistic version checks; a conflict applies no edits. Cancel discards drafts. Restore source values clears match overrides together. Season jersey and preferred position remain in the existing player-profile editor; individual match profiles also support minutes and starting status. Source sync never writes the correction records. Derived rows, lineups, totals, profiles, and reports read corrected values; the original event timeline remains explicitly labeled as source data. Goal-total mismatches are flagged without changing the match score.

Table and pitch position labels now share inferred/match-assigned evidence. Season labels aggregate weighted match evidence when no preferred position is assigned. Unplaced starters are named below the pitch rather than silently disappearing; manual substitute overrides are excluded from the starting lineup. Existing goal/assist marker placement is unchanged. Match profile metrics use four columns in one row.

Analytics always requests full match. The period selector is removed, new half-specific work is no longer scheduled, and the due-work query uses a full-match-only partial index. Previously saved half data is preserved. Deferred notices give the local resume-after date/time; refresh is disabled during a pause or active collection. Existing polling resumes checks after the returned deadline. The database budget protection remains in force; deploying does not reset Cloudflare usage.

Verification: real SQLite atomic save/conflict/reset tests; correction field bounds; inferred goalkeeper consistency; manual position/minutes/start application; restoration; old-schema migration; full-only queue creation; cached-error retention; simulated expired-budget collection through persisted ready response; stale UI-response rejection during team/player changes; script syntax and packaged Worker HTTP response. These use controlled upstream fixtures. Live Cloudflare collection has NOT been verified. Remote browser navigation to the local preview returned ERR_BLOCKED_BY_CLIENT, so mobile/desktop visual verification remains outstanding. No production deployment was performed.

## Analytics queue and compact cards

The supplied 6.20.15 diagnostics recorded 8,490 pending analytics selections, 228 ready, and 2,871,437 rows read by the analytics scope workload. Queue picks previously sorted the due backlog and prioritized team summaries across all history before player detail. The new ordered queue index reads the next due selection directly, with recent game dates first among initial pending work. New match player scopes therefore complete before old-match backfill. Analytics-only sync passes bypass the already-completed tracking/engine pipeline.

Deployment automatically adds game dates to pending queue entries and builds the replacement index. This one-time migration uses database reads/writes; it retains saved stats, accounts, and pending work. No reset or reconnect is needed. Existing retries and the 2,000-request daily collection budget remain. The shared budget described above supersedes the previous analytics-only safeguard. Deployments do not reset Cloudflare usage. See https://developers.cloudflare.com/d1/platform/pricing/.

Competition logos now retain a trophy fallback during loading or a failed image request; failures enter diagnostics. The supplied screenshot does not establish why the upstream logo failed. Additional pass counts appear quietly below completed passes, and turnover counts below possession or player touches. The separate More stats dropdown is removed. Trophy cards use one compact container without stacked header/body padding, retaining 44px edition buttons.

Checks: old-schema upgrade, retained data, original side/player identities, cache/error retention, rapid filter changes, missing-versus-zero rendering, inline secondary-stat retention, and packaged Worker response. An 8,736-scope SQLite fixture reduced queue-pick VM steps from 150,125 to 59 and verified no temporary sort and recent player work before older team work. This is a local query-plan test, not measured Cloudflare billing. Production collector execution, actual post-deployment usage, and mobile visual/touch behavior remain unverified.

## UI consistency update

Analytics filters reuse the app selectors in one compact row. Unavailable player metrics and developer coverage diagnostics are removed from normal screens and reports; underlying diagnostic data remains intact. Match and season context remain together. Collection states distinguish waiting, active loading, and delayed updates without adding a polling timer.

Competition logos share one component across trophies, competition cards, schedule groups, and match details, with a light badge for dark artwork. Trophy cards have compact spacing and a clear all-season scope. Competitions retain the selected-season scope. Confirmed match stages sit under the score; the stats icon indicates saved player stats, not a promise that every advanced metric is available.

This UI update has not been deployed or visually verified on a mobile device. Automated checks use controlled fixtures.

## Trace PlayerFocus analytics

Match > Stats adds possession and its timeline, both-team comparisons, completed passes and completion percentage, shots, box touches, event maps, and additional pass/turnover totals. Player selection shows native heat maps and player touches. Only full-match analytics are exposed; Trace's FullGameVideo timestamps define the interval. Match player profiles use the same analytics component, retaining an older imported heat map while native data is pending. Season position inference remains separate: native map intensity is not mislabeled as tracking samples, distance, or minutes.

The queries were taken from Trace's public frontend contract on September 21, 2026. An authenticated Trace match page for game 14030311 showed possession 50–50, completed passes 64–79, shots 25–16, 91 box touches, and 50% pass completion for the selected team. This verifies availability in Trace's UI, not the deployed myTS collector's responses.

Collection uses the existing Trace account session and background runtime. It preserves Trace's ORIGINAL home/away sides and GIDs instead of the engine's normalized home-team representation. New tables are added automatically; no database reset, reconnect, new binding, or paid service is required. Missing analytics are discovered for already-published games as well as new ones. Existing minutes/goals/assists are not recalculated by this feature.

The queue prioritizes team comparisons before player scopes, collects at most two scopes per background pass, and persists each result independently. Pending, restricted, unpublished, and request-error states remain distinct. A failed heat-map request retains successful stats and any previous map. Failed requests retain saved payloads and retry with backoff. Recent ready data is revisited daily; older ready data every 30 days; restricted/unpublished selections daily. Backfill waits until the existing tracking collection is terminal, then continues automatically even when the browser is closed. A large history can take multiple days.

Full query data is retained per selection, including possession, total_possession, box_touches, passes_all, passes_complete, passes_incomplete, shots, turnovers_all/won/lost, player_touches, event timestamps/coordinates/identities, third counts, and the native heat-map matrix. No raw videos or radar streams are saved by this feature. Event maps display Trace coordinates; no unverified attack-direction conversion is applied. The available player list comes from the match roster, so opponent player detail depends on what Trace exposes.

Browser snapshots are scoped to the current access context, family, match, player, and period. The existing entity polling cycle refreshes pending analytics without adding a timer. Superseded requests cannot paint a different selection or team. A valid cached response remains visible during refresh failures.

## Free-plan safeguards and verification

Analytics use the existing D1 and SQLite Durable Object runtime, with no R2 or paid dependencies. A shared 2,000 daily request-reservation budget throttles this workload; profile discovery reserves additional capacity. Cached selection responses above 750 KB are rejected with a diagnostic instead of overwriting saved data. This is an analytics workload guard, not a claim about total Cloudflare account usage. Actual account quotas and storage must be checked in Cloudflare; the existing D1 usage meter remains available.

Diagnostics now include analytics manifest/scope status counts, saved payload bytes, retry deadlines, recent errors, and the daily reservation budget. After deployment, check that ready scope counts rise and compare game 14030311 against Trace before relying on the new analytics. Trace permissions, source availability, and per-player coverage can differ by match.

Automated checks passed for the actual 6.20.13 SQLite schema upgrade, repeat migration, retained saved games, original away-team identity, player/half query scopes, idempotent backfill, failure retention, heat-map failure independence, tenant isolation, daily-budget stopping, null-versus-zero rendering, rapid filter changes, and access/team changes during pending requests. Backend request responses in these tests are controlled contract fixtures, not live authenticated API responses. All embedded scripts and the packaged Worker response were checked.

This release has NOT been deployed to the user's Cloudflare account. The authenticated browser confirmed Trace's displayed values, but a production collector round trip and mobile visual/touch verification remain unverified. The cloud browser rejected the local preview URL. No claim of live end-to-end or mobile visual validation is made.

Cloudflare references: https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/d1/platform/pricing/ ; https://developers.cloudflare.com/durable-objects/platform/pricing/

## Previous release: upgrade recovery fix

The production diagnostics showed stale championship flags and missing verification timestamps after upgrade. Cache migration reset the general retry time but retained api_next_at, so the collector retried HTML publication checks instead of refreshing the JSON schedule. HTTP 302 responses consumed the request budget without recalculating those awards.

This release resets both schedule deadlines during the existing data-revision migration. It preserves saved games and honors the upstream rate-limit pause. No manual reset or reconnect is required. HTML publication errors remain in schedule diagnostics but do not override the independent trophy assessment. Diagnostics now also include the data revision, trophy check timestamp, match count, and verified final IDs.

Regression testing reconstructed the reported saved-cache deadlines and stale flags using downloaded source fixtures. Before the fix, three historical awards remained missing after 25 simulated update passes. After the fix, all nine reached the public API and trophy renderer, independent of selected season, despite continued HTTP 302 publication failures. The ten-request budget and rate-limit pause were checked. This is a reproduction of the upgrade state, not a test against the private production database.

## Trophies

Team > Trophies now shows all available seasons, independent of the season selector. Competition cards show Winner and Runner-up counts, clickable years, and the youth division. Matching editions are grouped by normalized event name and organizer website; editions with different organizer identities remain separate to avoid merging unrelated events. A year opens its standings and matches using the existing match and team components.

The collector rechecks archived competition records automatically using its existing request limits and retry schedule. It follows championship winner paths, allows unrelated consolation games, and supports seeds beyond second place. A tied final requires a published winner. A completed single-table round robin must reconcile with every scheduled result before a placement is awarded. Group-stage standings alone do not establish a tournament trophy.

Saved verified awards remain visible when updates fail. Pending, unavailable, and unresolved records have separate states, with per-division reasons in Diagnostics. No manual reconnect or database reset is needed.

## Historical audit

Checked the available 175-match history for GotSport team 212707 across 37 events on September 21, 2026. Nine placements verified: four Winner and five Runner-up. These are source results at the time of the audit, not hard-coded app data.

| Competition | Placement | Date |
| --- | --- | --- |
| Las Vegas Invitational FALL CUP 2024 | Runner-up | 2024-10-13 |
| Phoenix Rising Cup 2024 | Winner | 2024-09-01 |
| Las Vegas Invitational FALL CUP 2025 | Runner-up | 2025-10-12 |
| Surf Cup Southwest 2026 | Runner-up | 2026-03-01 |
| Phoenix Rising Cup 2025 | Winner | 2025-08-31 |
| The 32nd Annual Rugrat Tournament | Runner-up | 2025-12-01 |
| Nevada Jr. Cup 2026 | Runner-up | 2026-02-01 |
| Las Vegas Memorial Cup 2026 | Winner | 2026-05-25 |
| 2026 Cactus Kick Off | Winner | 2026-09-20 |

Some older records still lack sufficient evidence. The app does not treat these as confirmed losses or zero trophies:

- Nevada South Youth Soccer League 2022/2023 (division 123517): Final table unavailable or multiple brackets.
- Nevada South Youth Soccer League 2022/2023 (division 120395): Final table unavailable or multiple brackets.
- Nevada South Youth Soccer League 2022/2023 (division 123833): Incomplete schedule results.
- SVS Spring soccer league (division 159616): Incomplete schedule results.
- LAS VEGAS PREMIER LEAGUE (division 209563): Final table unavailable or multiple brackets.
- Nevada South Youth Soccer League Spring 2024 (division 242088): Incomplete schedule results.
- PSL SPRING 2024 (division 247526): Incomplete schedule results.
- PSL SPRING 2024 (division 247528): Final table unavailable or multiple brackets.
- Desert Classic 2025 (division 359766): Championship path not verified.
- Nevada South Youth Soccer League Fall 2024 (division 288685): Incomplete schedule results.
- Nevada South Youth Soccer League Spring 2025 (division 335720): Final table unavailable or multiple brackets.
- 2025 Temecula Holiday Classic (division 351726): Championship path not verified.
- Vegas Cup 2026 (division 453342): Championship path not verified.
- Nevada South Youth Soccer League Fall 2025/2026 (division 429019): Final table unavailable or multiple brackets.
- Nevada South Youth Soccer League Spring 2025/2026 (division 467813): Incomplete schedule results.

## Deployment

1. Extract worker.js, wrangler.jsonc, package.json, and README.md into your existing deployment project.
2. Preserve your existing Worker name, real D1 database ID/binding, ADMIN_KEY secret, and MYTS_RUNTIME Durable Object binding. The supplied configuration contains a database placeholder; use your existing deployment configuration.
3. Run `npm install`, then `npx wrangler deploy` with your existing Cloudflare account/project.
4. Keep the existing Durable Object migration declaration. No new bindings, secrets, or database reset are needed.
5. Confirm version 6.20.14 in Settings. Open Team > Trophies. Historical verification populates through the existing background collector and may require multiple passes under upstream request limits.

## Validation and limits

Checked JavaScript syntax, the real historical schedules and available standings, winner/runner-up and tied-final handling, cached awards during errors, cancellation/conflicting-winner rejection, consolation branch handling, invalid losing-team paths, edition grouping, deduplication, and the packaged Worker HTML response. This release was not deployed to your account and has not received a fresh on-device visual/touch test. GotSport availability and incomplete historical records remain external limitations.

The ZIP contains only the deployment files and this README. Tests and downloaded source fixtures are excluded.
