# myTS 6.3.0

Cloudflare Worker + D1 team dashboard rebuilt around one integrated TeamSnap + Trace experience.

## Product flow

- **Overview** combines TeamSnap schedule/availability with current-season Trace performance leaders and recent matches.
- **Schedule** is the single timeline for games, practices, and other team events. Opening a game gives a FotMob-style match center with score context, a game-specific reconstructed lineup/formation, player stats, goal events, and TeamSnap availability.
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

Keep the existing D1 binding named `DB` and the existing `ADMIN_KEY` secret, replace the repository files with this bundle, and deploy with Wrangler. TeamSnap OAuth continues to redirect to `/admin`. The included `wrangler.jsonc` also declares a Cloudflare Browser Run binding named `BROWSER`; it is used only when GotSport serves its public tournament schedule behind JavaScript verification.

## Version

The current version is populated from the application version constant beside the myTS logo on both the login screen and loaded dashboard.


## 6.3.0 GotSport tournament-path schedules

- GotSport discovery now follows the **public event/division schedule**, not only the team Rankings upcoming-games list. The Rankings team page remains the automatic tournament detector and supplies confirmed fixtures.
- For each detected tournament, myTS resolves the GotSport event ID and the team's division/group, then reads the public division schedule for knockout placeholders such as quarterfinals, semifinals, finals, consolation, and placement matches.
- Published knockout times are shown in Schedule as **Possible** / **If qualified** until GotSport assigns the team to that match. These conditional slots never affect W-D-L, scores, availability totals, or Trace matching.
- When GotSport's public schedule responds normally, the Worker uses ordinary HTTP. If GotSport returns its JavaScript verification page, the Worker falls back to the included Cloudflare Browser Run `BROWSER` binding to render the same public page; it does not solve interactive CAPTCHAs.
- Public schedule lookups are cached with the normal six-hour GotSport refresh cadence. Account & Data Sources reports confirmed games, possible playoff slots, and the first enrichment warning when an event/division cannot yet be resolved.
- The parser accepts structured JSON/Next.js data and HTML schedule tables, preserves local tournament dates/times, and uses the confirmed tournament year when GotSport prints dates without a year.
- No D1 reset is required. Existing GotSport team ID `212707` connections upgrade in place.

## 6.2.0 GotSport Rankings discovery

- Replaced the iCal-based GotSport setup with the public **GotSport Rankings team page**. Connect once with a URL such as `https://rankings.gotsport.com/teams/212707/upcoming-games` or just the numeric team ID.
- The Worker stores the public GotSport Rankings team ID against the cross-season TeamSnap family and refreshes it automatically every six hours, with manual sync/disconnect controls under **Account & Data Sources**.
- Upcoming GotSport games are normalized into the existing fixture model and merged into the normal Schedule. Date/opponent evidence deduplicates them against TeamSnap; unmatched GotSport fixtures remain visible and can still pair with Trace.
- Tournament/competition names, opponent, kickoff, venue, status, and source URL are retained when the public page exposes them. The parser accepts structured SportsEvent JSON, Next.js page data, and common nested game payloads instead of depending on one brittle markup layout.
- The Account panel shows the connected Rankings team ID, detected upcoming games, and tournament/competition names. Match detail identifies the public GotSport Rankings page as the source.
- This source detects an event **after GotSport publishes an upcoming game for the team**. A registration with no published schedule/game is not exposed by `/upcoming-games`, so myTS does not label that state as a confirmed registration.
- Existing 6.1.0 iCal rows are left intact in D1 but treated as needing reconnect; the new migration adds Rankings fields without requiring a database reset.

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
