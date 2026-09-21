# myTS 6.20.5

## Viewing followed teams

The top team selector groups connected teams under My team and favorites under Followed teams. Choose a followed team to view its Overview, Schedule, and Competitions (including division standings). Seasons use that team's available games. TeamSnap attendance and Trace/player data are not available for public teams; the Team page explains this instead of carrying over private data.

Favorites and watched games remain associated with your connected team's access scope. Following a team does not grant ownership. Settings provides My team settings, which explicitly returns to your connected team before showing connection, logo, kit, and report controls. Your team badge remains attached to your connected team.

Public team competition data uses the existing collector and shared team history cache. Opening a team updates it on demand; refreshes while viewing reuse the existing page polling lifecycle. Switching away stops context polling. There is no new scheduled subscription or database binding. Another viewer opening the same team reuses its saved context until due. Cached data remains usable during refresh failures.

## Release changes

### 6.20.5 — Shared match layout and competition context

- Shared match lists place club badges and team identifiers on either side of a centered score or kickoff time. Team names use quieter typography; result/status/bookmark behavior remains available.
- A chart icon appears only when a game has usable player stats and opens Player stats directly. Linked Trace games without stats and cancelled games do not advertise stats.
- Opening a team from competition matches or standings retains the exact event/division context. Its relevant standings and all published team matches appear together, without a past/upcoming cutoff. Potential division playoff fixtures remain chronological and explicitly labeled; qualification is not inferred.
- The competition dropdown offers All competitions to return to the existing team history controls. Nested match views preserve the team sheet and the underlying competition selection/scroll. Competition data already loaded is reused; no extra history request is required for the scoped view.
- Uses existing refresh lifecycle, identity/profile rules and theme components. No backend collector, database/schema or binding changes.
- Chromium checks cover competition scoping, mixed past/future fixtures, potential playoffs, standings, all-history switching, nested return, stats navigation, cancelled/no-data states, touch/date navigation and widths 320–768 across themes. Packaged Worker startup is checked. Physical-device and live-provider verification are not included.

### 6.20.4 — Consolidated controls

- Schedule title, Day/Season and month/calendar share one header above the date strip. Competition title and Current/Past share one header.
- Matches/Standings and the existing team dropdown share one competition control row; team filtering is hidden on Standings. Removed the old separate filter row and reduced competition gaps.
- Match round and status share a wrapping secondary line; bookmark remains aligned at the end.
- Browser checks cover widths 320–768, themes, dropdown filtering, calendar/swipes, reduced motion, match details and packaged startup. Physical-phone testing remains unverified.

### 6.20.3 — Schedule gestures and calendar

- Schedule Day supports left/right swipes on the match list and date navigation, advancing one day. Vertical pan/pinch and screen-edge gestures remain native. Recognized horizontal gestures suppress their associated click; subsequent taps remain enabled.
- Date taps, arrows, Today, swipes and calendar selection share one date-change function. Content uses a cancellable 150ms slide/fade and temporarily retains its prior height; reduced motion skips animation. Refreshes preserve Schedule containers and defer during active gestures.
- Replaced the browser date input with the existing app sheet: month navigation, selected/today states, event dots and season bounds. Existing close/back behavior is retained.
- Verified Chromium touch emulation, direction changes, vertical movement, cancellation, reduced motion, calendar selection, mobile layouts and packaged page startup. Physical-phone behavior has not been verified. No backend/schema changes.

### 6.20.2 — Playoffs in Matches

- Removed Bracket tab. Potential playoff slots appear chronologically in Matches, including under Our team, with original placeholder names and round labels. They remain unconfirmed until the source resolves them; no qualification is inferred. Other unconfirmed fixtures retain their existing disclosure.
- Saved Bracket selection falls back to Matches. Browser checks cover both team filters, visibility without expanding Unconfirmed, tab keyboard/navigation and mobile layouts.

### 6.20.1 — Compact shared navigation

- Shared segmented controls and detail tabs use flat text with an active underline. Filter toolbars no longer have raised card containers. Page headings omit repeated selected-season text.
- Mobile header gives more room to the team selector, hides the separate TS tile, and uses borderless search/settings actions. Bottom navigation is shorter while retaining 44px button height.
- Schedule Day view removes the permanent search/type toolbar. A compact weekday/day strip shows the month once; the heading calendar opens the date picker. Today appears only when another date is selected. No duplicate selected-date heading above matches.
- Season view uses a heading filter icon with an active dot. The existing sheet pattern provides search, available event types, Clear and Apply. Day mode always shows all events on the chosen date regardless of saved Season filters. Followed-team views ignore private practice filters and omit those controls.
- Browser checks cover dates, search/type filters, clear/apply, switching Day/Season, followed-team filtering, 320–768px widths, themes, competition navigation, standings and match/H2H regressions. Packaged page startup verified. No backend schema or polling changes.


### 6.20.0 — Match and competition navigation

- Schedule defaults to Day view with five dates, previous/next controls, Today and a calendar. Results and pending games share the selected day in kickoff order. Season view retains Upcoming/Past and all event-type/search filters. Dates are scoped to the selected team and season; choose another season using the existing season selector.
- Shared grouped match rows show kickoff time, both teams and aligned scores. Date and competition headings avoid repeated metadata. Overview keeps its contextual next-event/latest-result rows.
- Each competition retains its disclosure header and has Matches, Standings and, when source fixtures support it, Bracket tabs. The bracket tab lists published knockout fixtures/placeholders; it does not infer tournament advancement. Team filtering and unconfirmed fixtures remain available in Matches. Keyboard arrow navigation is supported.
- Overview links to the selected team's exact published position and points in a current competition when available. Existing match-detail tabs, attendance, kits, H2H and disabled unavailable stats are retained.
- Shared status distinguishes Scheduled, Result pending, Completed, Postponed, Rescheduled and Cancelled. Kickoff alone never produces Live or Completed. Scored division fixtures are recognized as completed.
- Date selections and competition tabs persist through the existing browser UI preferences. Competition disclosures and per-view scroll positions survive navigation in the current session. Existing authenticated dashboard caching and loading behavior remain intact.
- Verified phone/tablet widths, themes, dates, empty days, filters, chronological order, tab keyboard/restoration, standings, bookmarks, H2H, cached reload/security and rapid team switching. No database migration or added upstream polling.


### 6.19.13 — Team name action order

- Team overview places the copy button immediately before the favorite star. Existing styles and actions are unchanged.

### 6.19.12 — Compact standings

- Standings use the competition card width, with rank, club logo/team, P, W, D, L, combined GF–GA, GD and bold points visible together. Long team identifiers wrap in their own column. Selected team receives the existing subtle surface highlight.
- Header sorting remains available without repeated inactive arrows. GF–GA sorts by goals scored; official positions and points remain supplied by GotSport. Missing numbers display a dash.
- Checked widths 320, 360, 390, 430 and 768px across three themes, long names, logos, large/missing values and sorting. Match layout/bookmark regression checks pass. No database changes.

### 6.19.11 — Logo-backed compact team identities

- Shared team rendering only removes the club prefix when a supported logo is available. Missing or failed images fall back to the full club/team name; changed logo URLs can recover normally. Uploaded club logos retain precedence.
- Team selector selected value and options, plus bookmark team filtering, now use the same logo/name renderer as matches and standings. The selector no longer overwrites that markup during identity refreshes. Non-team selectors keep their existing behavior.
- Text-only page subtitles and H2H explanatory text use full names, avoiding ambiguous bare identifiers. Search and team overview retain their full-name display.
- Browser checks cover selector rendering/hydration, image failure and recovery, full-name fallback, mobile widths, saved reloads and rapid team switching. Existing match and H2H checks pass. No database or deployment configuration changes.


### 6.19.10 — Copy team name

- Team overview header adds a compact copy icon beside the full name/favorite star. Other team labels and game cards stay unchanged.
- Copies the complete club/team name, including after profile updates; locally known teams copy their original name.
- Uses existing icon-button styling, a 44px transparent tap target, accessible labels and a brief fixed-size checkmark after success. Clipboard denial uses the existing error notification.
- Browser checks cover full/local names, hydration, repeated copying, denied clipboard access, stable confirmation geometry and mobile header widths. No schema or configuration changes.


### 6.19.9 — Match head-to-head and compact bookmark

- Moved Head-to-head out of team overview into match details. Compares the match's exact two team identities using the existing shared history cache and request deduplication, including matches between other teams. Unknown bracket participants keep H2H disabled.
- H2H reuses the range selector, refresh button, record facts and match list; loading and failures appear within its content. Known meetings remain available after refresh failures. Results identify the perspective team and include completed games today.
- Player stats remains visible on every match, disabled when unavailable and marked loading while the connected team's stats are pending. The existing detail-tab keyboard handling skips disabled tabs. Attendance remains available for tracked TeamSnap events.
- The bookmark stays top-left beside the date, with an 18px icon, compact 22px layout slot, transparent 44px touch target and reduced spacing before the score.
- Removed the former team-level H2H controls and their state. Repaired the match refresh callback so incoming stats can enable the tab through the existing entity refresh lifecycle.
- Browser checks cover two external teams, reversed fixtures, duplicate suppression, today's results, loading/failure retention, stats loading/availability, unresolved participants, keyboard navigation and bookmark geometry. Existing team-switch/cache and three-theme mobile match tests pass. No database or deployment configuration changes.


### 6.19.8 — Team-switch loading lifecycle

- Followed-team switches now restore saved browser snapshots as well as in-memory data. Without a usable dashboard, the existing content loading placeholder appears before cache/network work begins.
- Pending synthetic team state is explicitly not loaded. Empty results appear only after dashboard data is available; first-load failures show the existing delayed state, and refresh failures retain saved content.
- Connected-team switches also display loading during asynchronous cache reads. Team selectors remain current and usable while loading.
- Unavailable private data sources do not masquerade as pending sources in public-team empty states.
- Browser tests cover held requests, genuine empty results, persistent cache restoration, failures with/without cache, retries, rapid switches with out-of-order responses, and authenticated page reloads. Existing match/bookmark checks also pass.
- No new timers, API endpoints, database migration, or deployment configuration changes.


### 6.19.7 — Club logos and seasonal club kits

- Existing Settings controls now save logos per verified GotSport club and kits per club/season. Teams sharing that identity inherit them through the shared renderer, including followed teams. TeamSnap game-specific uniform instructions remain unchanged.
- Uses organization IDs in source profile metadata; team-logo IDs and similar club names do not establish membership. If a verified club identity is unavailable, club edits explain why they cannot be saved. Existing unmatched team settings remain intact.
- Schema migration promotes compatible existing logo and kit settings for known clubs. Conflicting legacy settings are retained until explicitly replaced. Save/reset clears superseded settings for that club atomically, preventing old overrides from reappearing.
- Club settings are included in authenticated bootstrap, profiles, dashboard/context responses and browser snapshots. No new polling timers or scheduled team fetches.
- Deployment automatically creates the two club override tables on first request. No new bindings or manual migration commands.
- Verified the prior-schema upgrade with SQLite, migration and reset behavior, season separation, shared browser rendering and persistent reloads. Existing match/bookmark mobile checks remain passing.


### 6.19.6 — Consistent team identifiers

- Shared team labels show the team identifier without the club prefix when verified source club metadata is available. Unknown names retain their original text.
- Team overview and search results show full club/team names, including after profile hydration and cached reloads.
- Removed abbreviation generation, settings, and API writes. Existing unused abbreviation records are left untouched; no destructive migration or new database operations.
- Browser verification covers source-prefix boundaries, squad-only source names, unknown names, repeated profile hydration, cached reloads, bookmarks and match layouts across three themes/mobile widths.
- Deployment files only; existing configuration and saved data are preserved.


### 6.19.5 — Bookmarks and shared match details

- Renamed the saved-game tab and page to Bookmarks, with a bookmark navigation icon. Existing storage keys and saved records remain unchanged. Team stars still manage followed teams.
- The existing game bookmark action is now an icon at the summary card's top-left, beside the date, with a 44px touch target, outline/filled state, and accessible action labels. Removed the large Watch game button.
- Both team labels align consistently beside their logos. A result indicator is associated with the relevant score instead of appearing beside the date.
- Venue, field, and linked address are grouped in the shared summary. GotSport remains a source link; the redundant GotSport source fact is removed. TeamSnap attendance source remains identified when applicable.
- Live recheck of Next Level Soccer's team profile found a club name and state, but no separate club ID. Abbreviation coverage was not expanded with unverified associations; existing verified abbreviations and corrections remain intact.
- Browser checks cover bookmark toggling/labels, result placement, grouped location, TBD participants, navigation naming, three themes at 320/390/768px, and persistent reload/access behavior. No database migration is required for this release.



### 6.19.4 — Restore the dashboard on refresh

- IndexedDB retains complete dashboard snapshots across browser reloads, scoped to a hash of validated owner/viewer access, connected team, and season. The first successful load populates the cache; later loads restore it after the existing access/bootstrap checks, while current backend data loads in the background.
- The selected connected/followed team and season are restored. Followed-team data remains public; connected-team snapshots and favorite/bookmark state stay in their existing access scope. Follow/bookmark edits are saved separately so editing them while viewing another team does not restore an older list.
- An unchanged dashboard response does not rebuild the page. Trace's saved data cursor is retained to avoid unnecessarily reloading its dataset.
- Access changes or rejected credentials clear the cache. Storage errors fall back to normal backend loading and appear in Diagnostics. Credentials are not stored in snapshot records.
- No new backend tables, bindings, or polling timers. The existing schema upgrade correction remains intact.
- Validation used actual browser reloads and IndexedDB with the dashboard HTTP response held open: saved content appeared before the response; an unchanged response preserved the DOM; followed-team selection survived reload; changed/revoked access could not restore old private data; unavailable storage fell back to normal loading. The existing-database upgrade regression check also passes.



### 6.19.3 — Repair upgrade initialization

Version 6.19.2 added club_display_names without advancing APP_SCHEMA_VERSION. Existing installations skipped table creation, and the new dashboard snapshot failed during profile enrichment. This release advances the schema revision through the existing migration lifecycle. No database reset or reconnection is needed.

Browser diagnostics now include source request errors, source errors, and dashboard loading state so startup failures are visible in exports.

Validation reproduced the failure by initializing the actual v6.19.1 schema in SQLite, loading v6.19.2, and running profile enrichment. The corrected release upgrades the same database, successfully reads the club abbreviation, and performs no repeated schema writes in the same runtime. Browser loading, late-response, editor, theme, and width checks pass. Unrelated older GotSport directory/identity validation errors are not represented as fixed by this release.



### 6.19.2 — Shared club abbreviations and initial loading

- Compact team labels use a shared club abbreviation while preserving the entire squad suffix. Team overview titles keep the official full name.
- Verified organization references from GotSport organization-logo paths identify clubs. Team-logo references and missing organization references are not treated as club IDs; these teams keep their full names. There is no fuzzy club matching or hard-coded team alias.
- Abbreviations are stored in D1 once per organization. Repeated reads do not rewrite them. Owner Settings > Club abbreviations allows corrections for loaded, verified clubs; corrections apply across users and teams in this installation. Viewer links cannot edit them.
- The initial connected-team dashboard reads saved TeamSnap, GotSport, Trace, mappings, favorites, profiles, and logo overrides together. It does not wait for new upstream collection. Shared source failures are reported independently; existing data is retained on refresh failure.
- Loaded empty sections no longer switch to loading placeholders during background refresh. Unloaded Trace counts display a dash instead of zero. Sequence and edit guards protect team changes and newer logo, kit, correction, and bookmark edits.
- Followed-team history/context responses include cached profile metadata before rendering.
- Validation: real SQLite abbreviation persistence/write-count checks; delayed and partially failing saved-source coordinator; mobile browser first-load, refresh-failure, late-response, editor, theme and width checks; existing followed-team, bookmark and collector checks. Live deployment was not performed.

The new club_display_names table is created automatically by the existing schema initialization. No new bindings or scheduled jobs are required.

### Earlier changes

- Favorites now lists only bookmarked games, directly, without followed-team groups. Its team filter uses the participants in bookmarked games.
- Followed teams remain saved and accessible in the top selector. Refreshing Favorites updates watched divisions only, not every followed team’s history.
- Removed bookmarks remain visible until you leave Favorites or explicitly refresh; switching Upcoming/Past does not discard them.


- Shared viewing context for followed teams across the existing dashboard tabs.
- Grouped team selector; background refreshes preserve an open selector. Mobile sheet scroll-lock events no longer dismiss the selector; desktop dropdowns retain scroll dismissal.
- Request sequencing prevents late responses from replacing the newly selected team.
- Connected-team ownership and Favorites scope remain separate from viewing context.


- One-time standings source migration is eligible on the next background pass even when the old feed has a future retry date. Existing request pauses and leases remain respected.
- Obsolete HTML errors no longer appear as current JSON standings failures. Schedule errors cannot override a successful standings status in API or UI.

- Standings now use GotSport's division-registration JSON feed, including published group placement, points, W/L/D, and goals.
- Event, division, bracket, registration, and team IDs are validated before replacing saved standings. No similar-name matching or locally calculated rankings.
- Standings updates use the existing background collector, request limits, cache, and retry backoff. A public schedule verification failure no longer marks standings unavailable.
- Archived competitions can load standings once; successful archived data is then retained without recurring standings requests.
- Existing competition layout and disclosure behavior are preserved. Missing placements display without an invented rank.

## Deploy an existing installation

1. Extract this ZIP. Keep worker.js, wrangler.jsonc, and package.json together at the existing project's deployment root.
2. Use your existing deployment pipeline. Preserve the existing Worker name, D1 database binding/ID, ADMIN_KEY secret, and MYTS_RUNTIME Durable Object binding. The supplied config contains a DB binding placeholder; retain your deployment's actual D1 database configuration.
3. For a Wrangler deployment, install dependencies with `npm install`, then deploy with `npx wrangler deploy` using your existing account and project configuration.
4. Do not delete or recreate the database or Durable Objects. No new secrets, bindings, or schema migrations are required for this release. Retain the existing Durable Object migration declaration.
5. Reload the app and confirm version 6.19.1 in Settings. Existing background updates will populate standings; no reconnect or manual tournament IDs are needed.

## Verify after deployment

Open Competitions, expand a competition, and check its Standings section. Standings opens by default; subsequent updates preserve your open/closed choice. Cactus Kick Off and LV Club Soccer League were confirmed to provide this data during investigation. Placements and scores can change after this release.

If an update fails, saved standings remain visible. Export Diagnostics from Settings for the exact division's standings error and last attempt. Schedule/publication verification is a separate status and may still encounter GotSport's CAPTCHA.

## Validation and limits

Bookmarks-only checks confirm no followed-team groups, saved games displayed directly, removal retention until tab exit, empty state, and followed teams preserved in the selector.


Browser checks covered grouped selector clicks, rapid/out-of-order switching, every tab, return to the connected team, settings guards, and private-data isolation. Competition standings were rendered at 320, 390, and 768 pixels across all three themes. Collector tests used a followed team’s real Cactus match fixtures and checked shared cache reuse after 30 seconds. These are local tests; production deployment and verification are still required.


Tested upgrade from the exported production 302 error with a future retry deadline; the scheduler SQL against SQLite (legacy/current/locked feeds); migration idempotence and current-source backoff preservation; API error isolation; the real Cactus response; exact membership checks; malformed/duplicate records; multiple brackets; missing placements; HTTP/rate-limit failures; cached-table retention; independent schedule status; archived backfill; and repeated active/archived collector passes. Official API availability remains controlled by GotSport. No production deployment is performed by supplying this ZIP.

Contents: worker.js (includes the UI), wrangler.jsonc, package.json, README.md. Tests and development artifacts are excluded.
