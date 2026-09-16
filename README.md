## v6.7.7 — Quiet background updates and resumable tracking requests

Removed the main-screen sync panel and its CSS. Live details are plain source notes within the existing Account & Data Sources cards. Background updates leave the dashboard usable and account controls intact.

Trace delay was caused by four serial tracking requests per player/half, six tasks per batch, five-minute scheduled gaps, and no checkpoint inside a task. At roughly 2,100 queued tasks this represents thousands of requests, regardless of individual response size.

Tracking now runs at most two requests concurrently and checkpoints each completed pair, including successes when the other request fails. Retries fetch only missing chunks. The schema migration adds chunks_json with an empty default and preserves existing completed tasks, source data and published results. Empty successful chunks are also cached. New roster preparation is deferred while two or more games are already collecting, allowing existing work to finish. Requests have an eight-second timeout and tracking work yields within the invocation's 22-second working budget.

The Trace cron changes from every five minutes to every two minutes in wrangler.jsonc. The old expression remains recognized during propagation. Provider invocation isolation, six-task request cap, shared rate-limit pauses and publication checks remain in force. Deploy the included configuration with worker.js for the new cadence. Upstream limits still apply; a complete historical import is not instant.

Validation: SQLite-backed checkpoint/retry/concurrency/deadline/rate-pause tests, existing publication recovery and tenant scoping, TeamSnap pagination and GotSport regression checks, new cron routing, embedded JavaScript syntax and exact restoration of original app CSS. Authenticated live throughput has not been measured. Cloudflare lifecycle reference: https://developers.cloudflare.com/workers/platform/limits/

## v6.7.6 — Trace progress counter correction

Overall progress now measures published games against discovered games. Engine refresh statuses are no longer labeled as a cumulative calculated total: the publication migration legitimately requeues calculated games without deleting their saved calculations. Tracking detail identifies the current or next game and its completed checks, instead of presenting the changing multi-game queue as an overall completion fraction. Completed task deletion and new game discovery can therefore no longer make that fraction appear to reverse.

Existing source collection, saved calculations, publication recovery and retry behavior are unchanged. Validation covers migration retention, publishing with an unfinished season, game-specific tracking counts and browser status rendering.

## v6.7.5 — Live sync progress and incremental Trace publication

Trace previously calculated games but withheld publication until every source game in the season finished downloading. This release publishes the calculated subset after each engine commit, recalculating season attribution as further games arrive. It retains existing published games, validates all calculated game identities, and switches generations atomically. A one-time migration requeues previously completed calculations so unpublished results recover without reconnecting or deleting data.

A persistent panel above each dashboard view shows TeamSnap resource rows/pages, GotSport request stages, and Trace calculation/publication counts plus current tracking task counts. Timestamps and errors distinguish queued, active and delayed work. Active TeamSnap/Trace work polls every five seconds; GotSport polls independently. Trace tracking task counts describe the current collection, not the whole historical catalog.

Trace cron, manual and polling triggers share an expiring database lease. Tracking requests now retain game priority across batches so completed games become available sooner. Already calculated games are processed before preparing another download. Existing authentication, request budgets and retry delays remain in force.

Validation: SQLite-backed publication, recovery, tenant scoping and lease tests; browser-function progress and loading tests; TeamSnap pagination and GotSport retry regression tests. Live authenticated provider verification requires deployment to the user's Worker.

## v6.7.4 — Trace dataset loading fix

Reproduced browser regression: Account status refresh and Check new games could update state.trace.status.data_updated_at without loading the associated rows/games. The polling loop compared the next status timestamp to that status timestamp, considered it unchanged and did not fetch the dataset. An empty browser dataset could therefore remain empty indefinitely while the server advertised published games.

Correction: successful /api/trace/data responses alone set dataLoaded, dataCursor and loadedAt. Polling compares the server's publication timestamp with dataCursor, never with status-only metadata; it also detects a missing initial load or missing published games. Dataset shape is validated before replacing loaded stats. Malformed responses retain prior data and cursor for recovery.

The existing Account > Download diagnostics now includes the Trace diagnostic endpoint's connection/authentication indicators, published dataset summary, game processing errors, plus browser Trace row/game counts, loaded cursor and current status. It does not include owner credentials, cookies, authentication tokens or raw player records. This distinguishes a client loading failure from an unpublished or unavailable server dataset without changing the Trace processing engine.

Validation: actual old and new browser functions executed in a VM with the same API fixtures. v6.7.3 issues zero data requests and remains empty after a status-only timestamp update; v6.7.5 loads the dataset, does not re-download unchanged data, loads later publications despite Account refreshing status first, retains data on malformed responses and recovers afterward. Embedded JavaScript compiles; HTML/CSS is unchanged; the entire server-side implementation is byte-identical except its version string.

Live Trace storage has not been inspected. If Trace remains empty after deployment, send Account > Download diagnostics; that report now contains the Trace state needed to identify the remaining issue. Do not reset data or reconnect solely to apply this update.

## v6.7.3 — Live-report root causes corrected

Continues from the user's attached v6.6.0 base through 6.7.2; original file structure and bundled Trace data remain intact.

### Findings from the supplied live diagnostic

- Worker and browser were both 6.7.2.
- TeamSnap had 697 saved events and 15 saved members but no availability resource. Its pre-upgrade discovery checkpoint had already found one team but remained on /v3/teams. A global retry record had accumulated 13 HTTP-200 parsing failures. That old retry gate prevented the new per-resource recovery code from running.
- GotSport failed on its very first request with TypeError and no HTTP status. In the Cloudflare workerd runtime, the existing `runtime.fetcher = fetch; runtime.fetcher(...)` pattern reproduces exactly this result: `Illegal invocation: function called with incorrect this reference`. Earlier Node mocks did not enforce native Workers invocation semantics.
- No scheduled-tick records were present. This does not prove whether cron was configured, but no 6.7.2 scheduled invocation was recorded in this database.

### Corrections

- The default GotSport fetch adapter now calls native fetch as a global function, preserving its runtime invocation context. This is verified using the actual Cloudflare runtime and a local mock upstream service.
- A versioned recovery attempt rechecks pre-fix TypeError failures once, retaining upstream rate-limit pauses.
- Exclude unfiltered /v3/teams catalog links from team discovery. Actual filtered listing/search links remain allowed.
- Remove that catalog task from existing checkpoints and resume the team already discovered. Clear only the demonstrated legacy HTTP-200 parsing retry gate; do not bypass 429 pauses or expired authorization.
- Retain redacted exception messages and distinguish illegal invocation from network failures in diagnostics.

### Verification

Cloudflare workerd 1.20260916.1, compatibility date 2026-09-09: the previous full GotSport collector fails at request 1 with the same diagnostic fields as production; the corrected full collector succeeds through a local mock upstream. This verifies runtime behavior, not a live GotSport response.

SQLite recovery test seeded with the report's discovery/retry state and synthetic data matching its 697-event / 15-member size: the future global retry no longer blocks migration, neither /me nor the invalid catalog is re-requested, 10,455 synthetic availability records publish and match events/members, and scheduled checkpoints resume successfully. Those availability records are test fixtures, not downloaded user data.

Existing regression tests also pass for pagination/resumption, retries, leases, cancellation reconciliation, rate limits, source isolation, diagnostics authentication and embedded script syntax.

### Deployment

Deploy all ZIP contents, including wrangler.jsonc, with the current DB binding and secrets. No database reset, reconnect or reimport. The dashboard also advances eligible TeamSnap work while open. An initial large availability collection takes multiple bounded batches; it becomes visible when its complete snapshot is saved.

Cloudflare reference: https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors

## v6.7.2 — Independent resource recovery and live diagnostics

Continues the v6.7.1 rebuild from the user's attached v6.6.0 archive.

Confirmed regressions addressed:
- A persisted pre-6.7 GotSport network error could be displayed unchanged for 12 hours without making a new request. Legacy unclassified network failures now receive one bounded transport-recovery attempt. A recorded rate-limit pause is never bypassed. New results retain their typed error details and normal backoff.
- TeamSnap waited for all discovery collections before publishing any team resources. Successfully discovered teams now proceed independently. Unsupported optional discovery endpoints cannot block known teams.
- A failed TeamSnap resource previously put the entire sync into backoff. Each resource now retains its own cursor, failure and retry timestamp while other resources proceed. Availability is queued after events and members, ahead of ancillary lookup resources.
- Visible-team polling can resume eligible work independently of cron triggers; provider execution remains isolated and budgeted.

Account > Download diagnostics produces myts_sync_diagnostics.json. It includes the browser/backend version, selected team, saved resource counts/timestamps, availability event/member match counts, pending cursors/retries, GotSport error provenance, and last scheduled invocation per provider. It excludes authentication tokens, owner keys, player names, and raw resource records. The endpoint requires owner authentication. Diagnostics is read-only and does not force a sync or reset data.

Validation: legacy 12-hour backoff reproduced with zero HTTP requests before the change; one-time fresh recovery and fresh error preservation; rate-limit pause preserved; denied archive discovery plus a persistent roster 503 with successful independent availability publication; per-task retry enforcement; diagnostic accuracy and authentication; existing 65-page/6,500-record restart/resume, complete publication, cancellation, lease, pagination, provider isolation and script checks.

Live cause remains unconfirmed until the diagnostic report is collected from the deployed Worker. Deploy all ZIP contents, including wrangler.jsonc, preserving the existing DB binding and secrets. No data reset or reimport is required.

## v6.7.1 — Rebuilt from the supplied v6.6.0 ZIP

Authoritative starting file: `myts (1).zip` attached on September 16, 2026.
SHA-256: `ebedad7b7fc9c62a414c58bffdcf2e2b9dc1aa29055fe76373dc162fc50ba75e`.
The starting worker and package both identify as 6.6.0. This release starts from that attachment, not the prior 6.6.2/6.7.0 archive. Original HTML/CSS, the five primary view renderers, Account renderer, Trace calculations, GotSport data contracts and bundled Trace data are preserved.

### Root-cause work

The attached version couples TeamSnap resource reads and dataset initialization to GotSport, waits for Trace before rendering the page, and runs all three provider syncs in one scheduled invocation. Its TeamSnap collection downloads have no persistent pagination cursor and can issue hundreds of requests before finishing. A failure discards completed pages and retries the full collection. These are code-level defects; live production exception logs were not available.

Changes:
- Decouple TeamSnap reads and dataset setup from GotSport. Load Trace and GotSport independently after TeamSnap renders.
- Persist TeamSnap pages and cursors in the existing database; resume failed pages across Worker restarts. Each invocation makes at most six sequential upstream requests within a bounded work window.
- Atomically publish completed resources with checkpoint advancement. Never replace saved complete data with a partial collection.
- Include event overview/cancellation details in the same request budget.
- Use a database lease for duplicate sync exclusion, persistent backoff/Retry-After, and separate authorization-expiry handling.
- Run TeamSnap, GotSport and Trace in independent cron invocations. TeamSnap checks each minute but fetches only when due or resuming; GotSport and Trace retain five-minute cadence at offsets 1 and 2.
- Distinguish Worker-limit, timeout, redirect, HTTP and transport failures. Close rejected GotSport response bodies.
- Share schema initialization and reuse the persisted schema version, avoiding repeated migrations on fresh Worker instances.
- Restore the attached Account buttons' missing sync handlers and automatically refresh data using the existing UI controls and toast style.

### Validation

- Regression against the actual attachment: a GotSport dependency failure breaks the old TeamSnap read; the rebuilt read succeeds.
- Actual loading functions render TeamSnap while Trace and GotSport promises remain pending.
- Exact comparison of attached HTML/CSS and primary page/account render functions.
- SQLite integration: 65 availability pages / 6,500 records; 13 invocations; fresh-module restarts; failure and retry at page 9 without replaying earlier successful pages; complete snapshot retention; duplicate leases; cancellation reconciliation.
- Pagination origin/loop protection, GotSport 302/429/503 and transport handling, provider cron isolation, expired authorization, admin HTML and embedded JavaScript syntax.
- Live authenticated provider calls and deployment were not tested.

### Deployment

Deploy all seven original paths in this ZIP, including `wrangler.jsonc` so the three cron expressions are installed. Preserve the existing DB binding and secrets. No database reset, reconnect or Trace reimport is required. A large initial refresh can span several minute ticks while saved data remains available.

# myTS 6.6.0

Cloudflare Worker + D1 team dashboard integrating TeamSnap operations, GotSport tournament intelligence, and Trace performance data.

## Product flow

- **Overview** combines TeamSnap schedule/availability with current-season Trace performance leaders and recent matches.
- **Schedule** is the single timeline for games, practices, and other team events. Opening a game gives a FotMob-style match center with score context, a game-specific reconstructed lineup/formation, player stats, goal events, and TeamSnap availability.
- **Tournaments** is the tournament-specific view: Our games, published Playoffs & finals, and an expandable full division schedule. The normal Schedule remains limited to real team commitments.
- **Player profiles** combine match/season performance, corrected Trace heat maps, position profile, tracked distance, attacking-third share, field coverage, match history, and TeamSnap availability. Trace-tagged shots/touch involvement remain available in the underlying dataset but are not presented as complete event counts. A player opened from a match starts in match context and can move naturally to the season profile.
- **Team** is the season roster/performance area. Match formations are not shown here; lineup reconstruction belongs to each individual game and uses that game’s starter, goalkeeper, minutes, and spatial evidence.
- **Reports** provides Excel and PDF exports without duplicating the normal dashboard workflow.
- Opponent H2H is opened contextually from a match/opponent instead of living in a separate History section.

Trace is a data source, not a separate product area. Owner controls for connecting Trace, checking for new games, exporting the unified dataset, manually importing `myts_trace_data.json`, and the pre-season inclusion setting live under **Account & Data Sources**.

## UI / table behavior

- Every data table is sortable by tapping/clicking a column header.
- Match player stats are compacted to fit mobile width without horizontal scrolling; larger multi-column report/team tables retain overflow only where necessary.
- Match detail uses a compact sticky title; team names remain in the score hero instead of repeating in the top bar.

## Trace data

- The included `myts_trace_data.json` is the unified historical seed/fallback dataset.
- It contains 108 processed matches and spatial player-game data, including 24×16 heat-map grids and normalized event/stat data.
- Manual import seeds existing history so a connected Trace account only needs to collect new or changed games.
- Automatic Trace processing is incremental and stores the compact normalized result in D1.
- R2 is not required.

## Files

- `worker.js` — deploy this Worker; the complete frontend is embedded.
- `wrangler.jsonc` — Worker, D1, and scheduler configuration.
- `package.json` — Wrangler package metadata.
- `myts_trace_data.json` — unified Trace seed/fallback dataset.
- `.dev.vars.example` — local `ADMIN_KEY` example.
- `.gitignore`

There is intentionally no `index.html` or `tools/` folder in the production bundle.

## Deploy

Keep the existing D1 binding named `DB` and the existing `ADMIN_KEY` secret. Replace the main myTS repository files with this bundle and deploy through the existing deployment workflow. This is the myTS application, not the standalone diagnostic probe. TeamSnap OAuth continues to redirect to `/admin`.

The existing database upgrades automatically: GotSport adds an indexed next-check timestamp and a fenced per-team sync lease. Do not reset D1. No new secrets, service bindings, or manual tournament setup are required. The obsolete `BROWSER` binding is removed from `wrangler.jsonc`. The existing five-minute scheduler remains enabled.

## Version

The current version is populated from the application version constant beside the myTS logo on both the login screen and loaded dashboard.


## 6.6.0 Verified public JSON tournament schedules

The old Rankings HTML parser, guessed event/division lookup, and Browser Run fallback have been removed. Production only uses these three read-only JSON contracts:

1. `GET /api/v1/teams/{team_id}/matches?upcoming=true` — verifies the canonical team ID on the home or away side and reads that side's event registration ID, plus the event and bracket IDs.
2. `GET /api/v1/event_ranking_data/event_details?event_id={event_id}` — finds the unique schedule group containing the exact bracket ID. The explicit `tournament` and `league` booleans classify the event. `event_ranking_data: null` does not suppress the event.
3. `GET /api/v1/event_ranking_data/flight_matches?event_id={event_id}&flight_id={group_id}` — reads the entire published division response. Playoff rows with null team objects or a null bracket ID are retained. All matches use GotSport's actual match ID for identity.

The single saved team identity is enough. Existing connections are reused. The user's already-established LVSA family is linked to team `212707` by its exact known family aliases only; there is no general name-scoring team selection. Event, registration, bracket, and group IDs are never hardcoded. No event URLs, group IDs, iCal feeds, browser sessions, logins, or routine sync clicks are required.

### Presentation

- **Tournaments:** Our games; Playoffs & finals with the organizer's round and qualification labels; and the complete division schedule behind a standard expandable section. Other teams' games open in read-only division details.
- **Schedule / Overview / match exports:** only confirmed own-team fixtures enter the operational fixture collection. An unassigned final is not a potential team fixture. When the API assigns the team, that same match ID enters Schedule; reassignment removes it again.
- **TeamSnap and Trace:** existing roster, availability, performance, and historical seed data remain separate. Cross-source schedule matching uses a unique normalized opponent/date pair, with exact kickoff evidence to disambiguate doubleheaders. Ambiguous pairs are not silently combined.
- UTC `matchTime` timestamps retain their offsets. Tournament display explicitly names the selected team/browser time zone. Date-only matches show Time TBD rather than an invented kickoff.

### Automatic lifecycle and resource use

- New-event discovery runs every twelve hours. Validated event/group relationships and full flight snapshots are saved in D1.
- Known tournament schedules refresh approximately every twelve hours when distant, every three hours during tournament week, and hourly around tournament days. The five-minute cron services due work, including while the app is closed.
- An authenticated dashboard/status read can also queue a due update. The UI reads saved results quietly and does not reload TeamSnap or Trace to refresh GotSport.
- A cached tournament continues updating after its team matches leave the upcoming feed. After the event ends, one final refresh outside a three-day settling window archives the schedule and stops flight polling. An archived event rediscovered with future matches reopens automatically.
- Each run has a request/time budget. Remaining work is queued for a later automatic pass. Per-family database leases prevent overlapping refreshes and fence late results after disconnection or a team change.
- Failed, invalid, HTML, empty-known-flight, or inconsistent responses do not replace the last validated flight snapshot. Source status records partial/delayed updates instead of reporting a false successful zero-game result. HTTP 429 pauses honor Retry-After. Disconnection persists and is not undone by default-team setup.

### Validation performed for this release

52 automated tests passed against the user's captured upcoming-match, event-details, and flight-matches responses, plus explicit synthetic failure and lifecycle cases. SQLite-backed D1-adapter tests cover migration, persistence, due indexing, leases, authorization, and automatic status-triggered updates. Another 34 Chromium desktop/mobile UI checks passed using mocked API responses, including schedule separation, local kickoff display, export exclusion, playoff promotion, and no horizontal page overflow. Full Worker and embedded frontend syntax checks passed.

These are local replay and regression tests, not a claim that this release was deployed or tested live against GotSport from the development session. Test files, diagnostic collectors, temporary HTML, and captured responses are not included in the production ZIP.

Discovery begins when GotSport publishes a team match. This integration does not expose private registrations before any team games are published.

## 6.0.15 finished UI polish

- Consolidated the accumulated responsive CSS into one coherent mobile breakpoint system instead of overlapping duplicate rules.
- Standardized surfaces, borders, corner radii, shadows, spacing, buttons, selectors, tables, cards, overlays, and account/data-source controls around one design system.
- Simplified typography hierarchy and reduced unnecessary all-caps micro-labels while keeping soccer/stat abbreviations where they are conventional.
- Refined the sticky desktop header and mobile bottom navigation so active state, spacing, and touch behavior match the rest of the app.
- Reworked table headers, rows, search/filter controls, match rows, report cards, player/profile surfaces, and modal/entity chrome for consistent density and hover/focus behavior.
- Cleaned several user-facing labels: Overview now calls the match-count metric **Trace matches**, Schedule copy is shorter, match player spatial share is labeled **Attacking**, and match lineup/contributor wording is more natural.
- Removed presentation-only inline styles where values are not data-driven; the remaining inline styles are dynamic widths/coordinates used by availability bars, lineups, and spatial charts.
- Preserved app-native Team/Season pickers, switches, confirmation dialogs, body-only modal scrolling, cancellation handling, game-specific lineup reconstruction, date fixes, Trace attribution, and performance caches.
- `myts_trace_data.json` is unchanged.

## 6.0.8 tab-switch performance

- Tab changes no longer rescan the full Trace dataset or rebuild timezone formatters.
- Trace game/date lookup, season rows, row-to-player matching, per-game rows, TeamSnap-to-Trace match pairing, merged timelines, availability summaries, and player/team aggregates are indexed and reused between renders.
- View caches are invalidated only when the underlying team/Trace data, season, mapping context, or pre-season setting changes.
- Date correctness from 6.0.7 is retained; timezone and calendar formatting now use cached formatters/results rather than constructing them repeatedly.

## 6.0.7 calendar-date consistency

- Calendar dates and timestamps now use separate handling throughout the dashboard. A `YYYY-MM-DD` value is never timezone-shifted.
- Trace `played_at` UTC timestamps are converted to the team calendar timezone before selecting a match day.
- Trace catalog refreshes reconcile dates against current TeamSnap fixtures and the saved connection evidence, so older Trace connections self-correct without a reset.
- Calendar-only corrections reuse the existing saved Trace source/Halo data and only queue a lightweight engine republish; historical raw tracking is not downloaded again.
- The stats API now exposes `played_at`, allowing every Trace view to resolve the same canonical calendar day.
- Overview, Fixtures, match details, Stats, player profiles, recent matches, History/H2H, reports, season filtering, and import/catalog views all use the same date helpers.
- The bundled 108-match historical seed was migrated using `America/Los_Angeles`; 28 UTC-evening records that were one calendar day late were corrected.

## 6.0.6 interface polish

- Rebuilt the visual type scale so normal interface text is readable instead of relying on 6–10px labels and very heavy 900/950 weights.
- Uses the native variable/system UI font stack for sharper rendering without adding another external font dependency.
- Increased hierarchy and line-height across page titles, cards, tables, match rows, player profiles, reports, settings, and source controls.
- Standardized buttons, inputs, selectors, cards, modal geometry, hover states, keyboard focus, and mobile touch targets.
- Added tabular numerals for scores and stats so columns and scorelines align cleanly.
- Simplified user-facing stats wording and removed the asterisk-style assist label while keeping the best-effort explanation in context.
- Added accessible labels to icon-only controls and reduced-motion behavior.
- Corrected the visible frontend version badge/runtime version so the UI now matches the deployed bundle version.
## 6.0.2 season history fix

- Season choices now come from the union of TeamSnap seasons, saved TeamSnap event dates, and the unified Trace dataset.
- Historical TeamSnap team records already saved in D1 are preserved during refresh instead of being dropped when TeamSnap only returns the current team.
- Trace-only historical seasons remain selectable even if TeamSnap no longer exposes an old team record.


## 6.0.5 date and goal/assist consistency

- Date-only fixture values remain calendar dates instead of being parsed as UTC midnight. This fixes Pacific-time display drift such as the Sep 5, 2026 ALBION match appearing as Sep 4.
- Goal occurrence/timing is capped to the official Trace score.
- Scorer attribution uses explicit Trace roles first, then an evidence-weighted best-effort model using superfollow/AOS involvement, Halo on-field evidence, season attacking profile, and unique Trace/GID evidence. Generic GID order is never treated as scorer order.
- Assist attribution uses explicit roles first, then Trace sequence/predecessor evidence, superfollow/AOS, Halo presence, and season creation profile. Weak assist guesses remain unresolved.
- Player G/A totals, match events, season totals, and heat-map G/A markers now come from the same canonical event model. Map markers are retained only when a stored tracked location matches the canonical player/event.
- The bundled 108-match historical seed has been rebuilt with the same attribution policy.
- Trace engine 1.8.0-browser reprocesses existing stored source games without re-downloading raw game/radar/Halo data; the background continuation also includes engine-only refresh work.




## 6.0.17 cancellation reconciliation

- Fixed cancellation detection at the TeamSnap ingestion layer rather than only in the renderer.
- TeamSnap schedule sync now merges the standard `events/search` collection with `events/overview` when available.
- The nearest recent/current schedule records are then reconciled against their individual TeamSnap event endpoint; the individual event record wins for `is_canceled` and other current event state.
- Recently stored event IDs participate in that reconciliation so an item that disappears from the list after cancellation can still be verified and retained as Cancelled instead of silently losing its state.
- Event sanitization now retains cancellation-adjacent event metadata (`status`, notes, title/label, updated timestamp) and cancellation parsing accepts the common boolean/string encodings returned by TeamSnap clients.
- Existing UI behavior remains: canceled items stay visible in Schedule but are excluded from Up next, W-D-L, availability totals, completed-match history, and Trace fixture matching.

## 6.0.14 cancelled event state

- Preserves TeamSnap `is_canceled` event data during server-side sanitization so cancellation status reaches the dashboard.
- Shows a clear **Cancelled** indicator for canceled games, practices, and other schedule events, including event/match detail.
- Canceled events remain visible in Schedule for reference but are excluded from **Up next**, recent played matches, season W-D-L, player availability percentages, and completed attendance history.
- Canceled games do not display a score/result as if they were played and are excluded from TeamSnap-to-Trace fixture matching/fingerprints.
- Schedule reports include an explicit **Status** column and suppress result/Trace/availability values for canceled items.
- Existing RSVP responses remain visible inside the canceled event detail for reference without affecting aggregate availability.

## 6.0.13 mobile support pass

- Team and Season use app-native bottom selection sheets on phones instead of desktop-style anchored popovers. This removes viewport overflow, right-edge clipping, and bottom-navigation stacking conflicts.
- Mobile picker sheets have their own scrim, sticky title/close row, scrollable options, larger touch targets, safe-area spacing, and close automatically on rotation/viewport-width changes. Desktop keeps the compact popover behavior.
- Fixed mobile header grid placement so Account stays pinned to the right and Team/Season always occupy the intended context row.
- Removed mobile `backdrop-filter` from the sticky header so the fixed bottom navigation and fixed picker sheets use the viewport consistently across browsers. Landscape phones collapse Team/Season into the main header row to preserve vertical space.
- Account and Trace dialogs become full-screen mobile app surfaces with fixed safe-area-aware headers/footers and body-only scrolling. Confirm dialogs remain compact centered sheets.
- Match/player entity drawers use the same safe-area-aware full-screen structure and larger Back/Close targets. Background page scrolling is locked consistently while any modal, entity drawer, or mobile selection sheet is open.
- Schedule filters become a four-column mobile segmented control, search fields and buttons use touch-sized heights, and toasts sit above the fixed bottom navigation.
- Team table widths were rebalanced for 320–360px screens; match Player stats reduces to Player / Min / G / A on narrow phones while retaining the full table on larger screens.
- The match lineup pitch scales by viewport size and gets a compact landscape-phone treatment rather than forcing the portrait layout into a short viewport.

## 6.0.12 match lineup + scroll structure

- Removed the season-wide Squad pitch. The primary roster area is **Team** again.
- Added a FotMob-style **Lineup** card inside each match Overview. It reconstructs that game independently from the game format, Trace starter flags, goalkeeper usage/role, player minutes, and match-specific normalized spatial movement.
- When Trace start flags are incomplete, the lineup fills only the missing starting spots using the strongest match participation evidence and labels the result as best-effort.
- Formation is inferred per game from the attacking-depth gaps of the reconstructed starting field players; left/right roles use that match’s tactical movement.
- Match position labels are reused in the match player table, top contributors, and match-scoped player profile so the same game has one position model across views.
- Substitutes and other appearances are kept off the pitch and shown directly under the reconstructed starting lineup.
- Fixed modal scrolling structurally: modal shells no longer scroll. Header and footer are fixed regions; only `.modal-body` owns vertical overflow, so the scrollbar starts below the header and ends above the footer.
- Applied the same structure to match/player entity drawers: the title bar stays outside the scroll region and only the content body scrolls.

## 6.0.10 native UI pass

- Replaced the visible Team and Season browser `<select>` controls with app-native popover pickers.
- Replaced the pre-season browser checkbox with an app-native switch.
- Replaced browser confirmation dialogs with an in-app confirmation modal.
- Standardized scrollbars across page, tables, drawers, modals, and picker menus with thin rounded app styling. Horizontal chip/tab scrollers remain scrollbar-free and touch-scrollable.
- Added keyboard navigation for Team/Season pickers (arrows, Home/End, Enter, Escape) and retained dialog focus behavior.
- Kept the OS file chooser behind the existing custom import drop zone; it is not exposed as a browser-styled control.

## 6.0.9 UI/UX pass

- Team and Match search update results in place instead of remounting the full view.
- Report switching preserves interaction behavior and sortable tables.
- Mobile uses a bottom primary navigation and a compact five-column Team table.
- Refresh and pre-season controls are consolidated into Account & Data Sources.
- Match detail removes the duplicate Events subtab; goal timeline remains in Overview.
- Soccer results use W-D-L terminology consistently.
- Trace quality wording is standardized as Trace coverage.
- Dialogs support Escape, focus containment/restoration, backdrop dismissal, and labeled controls.
- Working typography and mobile touch/readability were tightened without changing the data model.


## D1 read-efficiency changes in 6.0.17

- Scheduled maintenance runs every 5 minutes instead of every minute.
- Fully synchronized Trace connections are skipped until their catalog refresh is due.
- Read-only Trace status/data responses reuse the stored progress snapshot instead of rescanning the game catalog.
- Unified dataset counts are recalculated only when a catalog refresh or newly published match can change them.
- Composite indexes cover dataset lookup and the hot Trace game/source/Halo predicates.
- Trace performance data and TeamSnap data contracts are unchanged.
