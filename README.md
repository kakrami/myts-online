## v6.18.18 — Watched games in Favorites

- Favorites contains a Watched games disclosure alongside existing followed-team groups. Every new group starts collapsed; background rendering preserves the current disclosure state.
- Watch game / Watching game in GotSport match details uses a bookmark, separate from team stars. Cards use a small read-only bookmark. Matches need confirmed GotSport event, match and participating-team IDs; unsupported local-only games and unresolved placeholders do not offer an action that cannot be saved.
- Watch references are persisted by authenticated owner/viewer identity and family. Match IDs are verified against server-held source data; submitted scores/names are never trusted. Duplicate saves are idempotent. There is a 100-game limit per scope.
- Watched games read the same shared history cache as team browsing and following. The existing bounded, visible-Favorites refresh checks watched and followed teams together, including today's results. Watching does not follow either team, schedule a new background job, or write match snapshots repeatedly.
- Updated times, teams, cancellations and scores come from the same match identity. If a later successful history no longer contains it, the retained record is labelled “No longer listed by GotSport”.
- Unwatching retains the visible card for undo until changing view/period or explicitly refreshing. Existing team retention remains unchanged.
- Validation: backend SQLite tests cover persistence, scope separation, identity rejection, duplicate watches, current scores/reschedules, watch-only cache reuse and existing following behavior. Browser tests cover collapsed defaults, shared disclosure state, details-to-watch-to-card navigation, removal/undo and responsive layouts. Worker syntax check passes.
- Schema migration creates watched_games without changing existing team favorites or cache data. Not deployed.

# myTS v6.18.17 — GotSport team colors

The shared GotSport match mapper now retains validated six-digit primary/secondary colors for both team IDs. Existing schedule, competition and shared team-history caches carry these fields without new endpoints, tables, polling or separate writes.

Verified team details show a compact Team colors line with primary/secondary swatches and accessible hex labels. Colors are selected from the most recent dated matching team record in available history; ambiguous side identities, invalid CSS values and unknown teams are rejected. Missing colors say Not provided. The line keeps the same height during initial loading. Team colors are not presented as a match-specific kit assignment, and theme changes do not recolor them. Existing cached matches acquire fields on their normal GotSport refresh; no names, logos, or home/away defaults are used to invent colors. TeamSnap uniform extraction is not changed.

Validation: shared mapping/publication and renderer checks cover home/away identity, missing/invalid colors, ambiguous sides and newer records. Browser checks pass for team-detail swatches across all themes and the existing responsive Favorites/navigation workflow. Not deployed.

---

# myTS v6.18.16 — Stable Settings icon and first-render custom logos

Removed source-status icon substitution from the Settings button. Its sliders icon remains unchanged through loading, failures and recovery; accessible status text and source details still update.

The authenticated bootstrap response now includes the authoritative logo-override metadata. The existing API response handler applies it before bootstrap resolves and before team rendering starts, so uploaded logos take priority on the first render, including a fresh viewing session. Images still download normally, but the GotSport logo is no longer used while waiting for a later status request. Existing versioned image caching, save/reset behavior and background metadata refresh remain. No new polling or database writes.

Validation: actual bootstrap handler returns the saved override; browser tests apply bootstrap before first team render and verify upload/reset flows. Settings geometry tests also assert that the sliders icon remains unchanged for all source transitions, themes and tested widths. Not deployed; archive filename/internal paths retained.

---

# myTS v6.18.15 — Stable source status and uniform management

Settings now presents TeamSnap, GotSport and Trace with the same fixed status line and Manage action, including read-only details for viewers. Removed the appearing/disappearing notification strip, per-source inline progress blocks, and separate inline GotSport/Trace tools. Background status updates update existing nodes instead of rebuilding Settings, preserving its layout, focus and scroll.

All three Manage actions use the existing source detail modal. TeamSnap contains sync/reconnect; GotSport contains team identity, logo, save/disconnect; Trace contains connection/reauthentication, sync and import/export. Existing authentication and logo sheets are reused. Dynamic error/progress/last-update text lives in a consistently sized scrollable detail region, keeping action controls stationary. Admin controls remain unavailable on viewer links. Explicit successful GotSport changes refresh management controls; a completed action does not reopen a dialog the user has closed.

Validation: browser checks compare actual Settings positions/heights across loading/error/success/recovery for all three sources, light/dark/soccer themes and 320/390/768px widths; check repeated Manage opening, stable detail geometry, retained GotSport draft/focus, and viewer-only details. Existing season/filter/navigation and logo-upload workflows pass. Backend unchanged except release version. Not deployed; archive filename/internal paths retained.

---

# myTS v6.18.14 — Owner-uploaded team logos

Settings → GotSport → Manage → Change logo opens the existing detail sheet with preview, Save, Cancel and Use GotSport logo. Only the installation owner can edit a logo, and the backend verifies that the submitted ID is still the connected team for that family. Viewing links have no upload controls or mutation permission.

PNG/JPEG/WebP files up to 5 MB are decoded and resized proportionally to at most 256 px, preserving transparency, then encoded as PNG. The backend validates PNG structure, CRCs, dimensions and size. Each verified GotSport team ID has one override in D1, independent of season; no R2 binding is required. Schema migration creates the table automatically. This does not remove backgrounds embedded in source images.

The shared team identity renderer prefers uploaded logos across cards, search, favorites, team details and H2H. Existing GotSport status responses include override metadata for all viewing links; existing refresh behavior distributes changes without a separate timer. Successful edits update the current page immediately. Versioned image URLs prevent stale browser-image reuse, and restoring removes the override so the normal GotSport resolver applies. Older status requests cannot overwrite a just-saved change. Logo URLs contain a random revision and are served as public image assets, as are GotSport badges.

Only explicit saves/deletes write logo records. Status refreshes read small identity/revision metadata, never image contents. Image delivery reads the selected image and supplies browser cache headers. No directory crawling or source-sync logic changed.

Validation: backend tests use SQLite to exercise actual handlers, admin authorization, changed-team rejection, malformed images, versioned delivery, replacement, removal and read-only retrieval. Browser checks cover Settings entry, preview/cancel, failed-save retention/retry, save/restore, fresh-viewer metadata, proportional resize/transparency and 320/390/768px layouts. Existing profile cache and Favorites/navigation/theme checks pass. Not deployed. ZIP filename and existing internal paths retained.

---

# myTS v6.18.13 — Transparent club badges and own-team glow

Removed the white background and clipping from the shared club badge. Transparent source images retain their silhouette. The own-team indicator now uses a theme-accent drop shadow instead of an outline; the same indicator and accessible label survive missing-logo fallback and team switching. Source image pixels are unchanged, so embedded white backgrounds remain white. Badge dimensions and layout are unchanged.

Validation: existing browser checks cover themes, mobile widths, team switching, fallback and navigation, with shared-style assertions updated for transparent badges and unclipped glows. No backend behavior changes.

---

# myTS v6.18.12 — Verified fixture identity for club badges

A uniquely reconciled fixture now retains verified opponent identity when its source names agree under the existing fixture normalization, including parenthesized US state labels. Previously reconciliation accepted these fixtures but presentation independently rejected the opponent ID because the source strings differed. The shared opponent identity resolver now carries the verified GotSport ID/name/logo into game rows, favorites, team history and H2H navigation. No team-specific aliases or fuzzy identity lookup were added.

Identity proof requires consistent fixture evidence, normalized names, no score conflicts and no same-source identity conflict. Ambiguous groups, distinct squads and invalid/same-side team IDs remain unresolved. Existing diagnostics record whether fixture identity was verified. No backend behavior, database writes or polling changes.

Validation: both diagnosed Next Level name variants, reversed home/away, ambiguous candidates, conflicting scores and different Downtown squads pass shared reconciliation/H2H tests. Result indicators pass. Controlled browser tests verify the card-to-details team ID and badge, plus existing season/filter/theme/layout workflows. Production image delivery has not been rechecked. The older isolated team-navigation VM harness lacks a shared renderer dependency; browser navigation is covered instead. Archive filename/internal paths retained; app version 6.18.12.

---

# myTS v6.18.11 — June selection and compact competition headers

Include June pre-season is now a checkbox above the Included games checklist. Its draft controls which June events are available in that sheet; Apply commits it with the existing per-viewer/team/season selections, and closing discards the draft. Reset restores regular-season defaults (June off, other selections included). The former server preference is read only as a migration default until an explicit local choice is saved. Removed the Settings switch and its separate frontend save path.

Raw seasonal events, Trace matches, and GotSport matches retain June data. The shared stats inclusion predicate now handles June, so records, attendance and player statistics agree while schedules and individual match details remain available. External team-history date ranges remain independent of this own-team stats preference.

Competition headers use a shared grid for title, Schedule action, and metadata. Removed the 40px mobile action height from the title's layout, retaining its expanded touch target, and reduced the old tournament header padding. The chevron aligns with the title rather than the combined header height. This shared structure also serves Favorites group headers.

Validation: browser checks include June draft/cancel/apply/reset, legacy-default override, records/Trace/attendance agreement, raw June match details, removed Settings control, season-menu reuse, and actual competition headers at 320/390/768px with repeated disclosure interactions. Existing season, H2H, result and Favorites checks pass. Browser uses controlled data. App version 6.18.11; archive filename/internal paths retained. No backend behavior changes.

---

# myTS v6.18.10 — Shared layout and unobstructed update status

- Read-only favorite stars now flow with the final word of the shared team name, like the team-details action. Removed the game-name line clamp so long names cannot clip the star. Marks remain read-only outside team details.
- Included games lives inside the existing season menu, restoring header width. A filtered season uses the funnel indicator on that selector. Selection behavior and saved preferences are unchanged. The shared selector distinguishes its listbox options from supplementary actions.
- Disclosure chevrons align with the first title line instead of centering across title and metadata.
- Source status uses the existing Settings button. Full clickable source notices live in Settings, with no floating update notices covering match content. The shared modal opener places the newly opened dialog last, keeping update details above Settings with correct focus ordering.
- Missing-logo identity diagnostics now record absent verified IDs and rejected opponent identities with source name, GotSport name, candidate ID and ambiguity. Existing profile/image-delivery diagnostics remain. The screenshot's missing Next Level logos are not claimed fixed: exact identity matching was not relaxed without evidence.

Validation: native browser checks for season-menu/filter repeat use, saved stats filters, source failure -> Settings -> details -> close, top-dialog ordering, diagnostic capture, inline stars, team links, themes and 320/390/768/1280 px layouts. Existing Favorites, H2H and result tests pass. Controlled API/image fixtures used; production logo delivery remains unverified. No backend behavior changes. App version 6.18.10; ZIP filename/internal paths preserved.

---

# myTS v6.18.9 — Shared season selections and canonical team names

The funnel beside the season selector opens Included games using the existing sheet and native disclosure controls. Select game types, competitions, or individual events; mixed selections use indeterminate checkboxes. Apply commits selections and Reset restores all events. Preferences are local to the device and scoped by viewer path, team family, and season. New games inherit type/competition selections. Individual choices use source IDs so linked Trace, TeamSnap, and GotSport records share one decision.

One inclusion predicate runs after source reconciliation and feeds season records, Trace totals, player statistics/heat maps, attendance, and reports. Raw source collections remain separate for schedule/history, matching, and individual game/player views. Practice and other event attendance can also be selected. Filtered seasonal pages and the funnel indicate active exclusions. Source refreshes retain the open filter's draft and disclosure state.

Matched GotSport event metadata supplies league/tournament classification. Unmatched games are Friendly only within successful discovery coverage; ambiguous games, dates outside verified bounds, empty discovery, and incomplete initial updates remain Unclassified. Successful coverage is retained in the existing sync metadata during later failures, with no additional D1 writes or requests.

Verified GotSport profiles provide the shared display name, followed by the connected GotSport name and then source labels. Removed the own-team TeamSnap override; selector, Overview, H2H and Settings use the shared resolver. Stable family keys and exact-ID matching remain unchanged.

Validation: full frontend browser tests cover selection, persistence, team/season isolation, zero selection, reset, inherited selections, source aliases, player/record/attendance/report agreement, excluded match details, canonical-name hydration, and responsive layouts across all themes. Coverage tests verify date bounds, empty/partial discovery, saved snapshot retention and identity checks. Existing Favorites, H2H, result indicators, profile cache, historical discovery and season controls pass. Controlled API/image fixtures used. ZIP filename/internal paths preserved; app version 6.18.9.

---

# myTS v6.18.8 — Compact title stars and one match outcome

Scoped sheet-header button sizing to header controls so it cannot enlarge the inline team favorite star. The shared star stays with the final name word, uses an 18px visible box and a 32px hit area without inflating title line spacing. The close control remains separate.

Shared match rows now render one W/L/D badge from an explicit team perspective: viewed team in history, connected team in head-to-head, and the followed team in each Favorites group. Both scores remain visible. Neutral division matches have no guessed perspective or duplicate outcome badges.

Validation: browser checks cover header sizing at 320/390/768 px and opposite outcomes for a shared match in two Favorites groups, alongside existing themes, navigation, group expansion, favorite/undo and hydration workflows. Result tests cover exact IDs, missing identities, home/away, draws, missing scores and cancellations; H2H and favorites regressions pass. Browser checks use controlled API/image fixtures. Backend behavior is unchanged; archive filename and internal paths are preserved.

---

# myTS v6.18.7 — Consistent team stars and group taps

Favorites group headings use the shared logo/name display without a team-history link; native summary behavior expands/collapses the group. Game-card team links remain interactive.

Favorite marks now belong to the shared team-name renderer, including hydration. Removed duplicate surface-level stars. Team details use one smaller actionable star immediately after the name, kept with its final word when wrapping, with a 32px target. Other team-name stars are read-only and shown only when favorited. The close control remains separate.

Validation: browser tests cover tapping the group name, header star placement, no duplicate marks, favorite/unfavorite/undo, grouped state retention, shared matches, team switching, search/detail navigation, themes and responsive layouts. Existing favorite and match-result regressions pass. Controlled API/image fixtures were used. No backend behavior changes; filename/internal paths retained, app version 6.18.7.

---

# myTS v6.18.6 — Shared own-team badge and grouped Favorites

- The shared club badge uses a theme-aware outline for the connected team's verified GotSport ID, including its missing-logo fallback. Removed the separate own-team people icons and pills. The badge exposes Your team to assistive technology without adding visible text. Hydration updates the outline when team context changes.
- Favorites groups existing cached game records by followed team, using the existing competition card, native animated disclosure and shared match row. Groups start open and retain their state across updates and full rerenders, scoped to the current family/viewer. A match between two followed teams appears in both groups using one shared record.
- Existing team filter, period controls, sorting, team-details favorite actions and unfavorite retention remain. Loading and empty states render per group. No backend, fetching, caching, D1 or schema changes.

Validation: browser checks at 320/390/768/1280 px; light, dark and soccer themes; two-team grouping, shared matches, collapse/expand persistence, filter, loading/empty states, own-team switching, broken-logo fallback, favorite/unfavorite/undo and search/detail navigation. Fixtures use controlled API and image responses. Existing favorite and result-indicator tests pass. Archive filename and internal paths retained; visible/package version is 6.18.6.

---

# myTS v6.18.5 — Reduce D1 write usage

- Directory division refreshes delete only identities absent from a verified nonempty response. They insert new teams and update changed evidence, preserving unchanged rows. Evidence and the job checkpoint still commit atomically with lease fencing. Empty or invalid responses retain saved teams. Ranking pagination retains its generation bookkeeping for stale-row removal.
- Removed D1 sync heartbeat writes and their legacy diagnostic reader. Background status already lives in Durable Object storage. Fresh profile cache hits now read without issuing an insert.
- Directory discovery pauses until the first midnight UTC after installing this release, because no reliable prior-day usage baseline exists. Existing indexed teams remain searchable. Subsequent days use a 15,000 D1 rows-written target, checked between atomic jobs; a final job may exceed the target. The existing alarm resumes discovery after UTC reset. Cron wakes cannot bypass the pause. TeamSnap, Trace and game refreshes are independent.
- D1 result metadata is collected at the shared runtime boundary, including batches and queries returning one row. Daily totals and per-table workloads are stored in Durable Objects, not D1, and included under each `background_runtime.*.d1_usage` in Settings Diagnostics. API activity is included. Counters reset by UTC day and accumulate concurrent requests. They measure successful queries completed by this deployment; other apps, earlier deployments and abrupt process termination are not covered. This is not an account-wide hard quota guarantee.
- No new D1 schema migration. Existing data, internal paths and UI remain intact. The ZIP filename is preserved; the app and package version are 6.18.5.

Validation: native workerd/D1 fixture (8 teams): initial write 42 rows, unchanged refresh 2 checkpoint rows with zero team-evidence writes, one renamed team 6 rows. Runtime tests verify Worker startup, schema initialization, API forwarding and Diagnostics. Tests also cover budget pause/resume, cron re-entry, UTC reset, concurrent counter persistence, empty-response retention, removals, lease fencing and transaction rollback. Local runtime tests use compatibility date 2026-08-06 supported by the installed Miniflare; deployment configuration remains unchanged. Live account-wide savings require post-deployment metrics.

---

# myTS v6.18.4 — Correct Cloudflare logo transport

The shared club-logo proxy used `redirect: "error"`, which workerd rejects before making an upstream request. This produced HTTP 502 / upstream_transport for every uncached logo. It now uses `manual`; the existing success-status check rejects redirects without following them. Shared profile identity, image validation and seven-day successful-image caching remain in place.

Validation: `tests/club-logo-runtime.mjs` runs native workerd through Miniflare 4.20260730.0 (compatibility date 2026-08-06, the installed runtime's supported date). It reproduces the old 502 with zero upstream calls and checks corrected image delivery, repeated-viewer cache reuse, redirects, HTTP failures, invalid content types and invalid origins using a controlled upstream. This is local runtime verification, not deployed Cloudflare-to-GotSport verification. The application's deployment compatibility date is unchanged.

Run `npm install` then `npm run test:club-logo-runtime`. Existing profile and diagnostic tests remain available. No database migration or reconnection is needed.

---

# myTS v6.18.3 — Preserve logo delivery diagnostics

- Shared W/L/D badges now accompany match scores in Schedule, Overview, Competitions, browsed team histories, head-to-head meetings and match details. Player match logs and report result cells use the same badge renderer. Existing exports retain their textual Result column.
- Badges retain the app’s theme-aware green/red/neutral colors and include full accessible Win/Loss/Draw labels. The result belongs to the team being viewed; division fixtures label both participants independently to avoid an ambiguous single result.
- A compact Your team marker appears beside names whose GotSport team ID matches the connected team, including opposing-team histories, details, division fixtures and team search results. No name-similarity matching is used. Historical games carrying the same stable ID are recognized; unknown alternative identities are not guessed.
- Shared score columns size to content at every breakpoint rather than forcing score-plus-badge into a fixed narrow width. Markers remain inline.
- Cancelled games and missing scores receive no result badge. Zero scores remain valid, including 0–0 draws. Cancelled division details no longer display a final score.

Validation: new indicator tests and existing team browsing, production-default transport, GotSport history, Trace, season and syntax checks passed. Tests cover home/away perspective, all outcomes, zero and missing scores, cancellations, exact identity, team switching, division labels and report rendering. Visual browser verification remains unavailable.

---

# myTS v6.13.2 — Shared GotSport request runtime

- Fixed a calling-context regression introduced by team browsing. Its runtime stored native fetch directly and invoked it as runtime.fetcher(), which passes the runtime object as this. Cloudflare Workers rejects that invocation before the upstream request runs. Existing scheduled collection used a safe global-call wrapper, but the new path did not reuse it.
- Replaced the separate browsing runtime and collector construction with one gsRuntime factory. Its global-call wrapper is now shared by search, team refresh and scheduled collection. Request budgets and timeouts remain unchanged.
- Transport errors no longer promise automatic resumption. Internal calling-context errors are distinguished from network failures and marked non-retryable.
- The latest search outcome for each team family is included in Diagnostics with endpoint, classified failure, sanitized exception, duration and request count. Successful searches replace stale failure diagnostics. No search queries, credentials or raw URLs are recorded.
- Added a regression test that exercises production defaults with a receiver-checking fetch implementation. It reproduced the exact reported error before the fix and passes after it. Existing mocks did not enforce this Workers calling convention.

Validation: `test:gotsport-transport`, `test:team-browse`, `test:gotsport`, `test:trace`, `test:seasons` and Worker syntax checks passed. Tests cover the production-default search and team-refresh paths, repeated requests, diagnostic persistence and recovery. This is a controlled platform-contract reproduction, not a live deployed-Worker verification. No UI or deployment configuration changes.

---

# myTS v6.13.1 — Consistent team search

- Find a team now uses the shared search field, toolbar, app dropdowns, card headers and selectable list rows. The game-range dropdown uses the same component. Recent teams are collapsed and no longer mixed into search results.
- Search explicitly displays results first, including a single match; only choosing a row opens that team’s games. New searches clear previous results. Back navigation restores the last successful results and filters.
- Team/club name is optional. Age group and Boys/Girls remain required by GotSport. Added optional State filtering, using GotSport’s state-association choices (including split associations such as California North/South).
- State choices and validation share one server-owned list. Requests send both team_association and filter_by=state; responses outside the requested state are rejected. A live blank-name Nevada U11 Boys query returned 70 teams, all with NV association. Sending the state alone was verified to return nationwide results instead.
- Shared dropdown menus mount outside scrolling/transformed sheets while open, then return to their owner on close. This prevents clipping without search-specific layering overrides. Keyboard handling, dismissal, focus restoration, resizing and overlay closure use the same lifecycle for header and sheet selectors.
- Existing persistent snapshots, explicit team selection, on-open refreshes and scheduler isolation remain intact. No database migration or new configuration is needed.

Validation: Worker and embedded-script parsing; team browsing SQLite/lifecycle/search/dropdown tests; Trace, GotSport history and season tests passed. Browser workflow selectors were updated for shared menu ownership. Visual browser testing remains unavailable in this environment; no visual pass is claimed.

---

# myTS v6.13.0 — Find a team

- Competitions → Find a team searches GotSport’s USA rankings directory by name, age group and boys/girls. Search filters and the latest result page are remembered on the device; pagination supports additional results.
- Opened teams appear in Recent teams. Their full validated match snapshots are saved in D1, scoped to the selected team family, and retained across reloads. Private-link viewers can browse the same family’s recent teams.
- Opening a team displays saved games and requests a fresh snapshot. No browsing entries are added to connected feeds or scheduled syncs. Back navigation and range changes do not initiate new upstream requests; an explicit refresh is available.
- Ranges: last 6 months, last year, this season, all past games, custom dates and upcoming. This season uses the current calendar season and the existing pre-season setting, independently of the home team’s selected season. Undated fixtures appear under Upcoming/Unconfirmed.
- The full match endpoint is used because the paginated past endpoint omitted older history in verified responses. A validated replacement reflects changed scores, rescheduled games and removals; failed or invalid responses preserve the previous snapshot and last-success timestamp.
- Match rows, details, candidate buttons, disclosure animations and theme styles reuse the app’s components. Match context is attached to the row lifecycle so background rebinding cannot switch a browsed game to the home team. Back navigation restores the existing stack without accumulating duplicate entries.
- Search and refresh require existing owner/viewer access, use explicit GotSport endpoint allowlists and input validation, and are rate limited. A D1 lease prevents concurrent upstream refreshes for the same family/team. Update details are clickable; diagnostics include recent browsing errors.
- D1 schema migration is automatic. No new secrets, scheduled jobs or deployment configuration are needed.

Validation: `npm run test:team-browse` (Node 24), `npm run test:trace`, `npm run test:gotsport`, `npm run test:seasons`, Worker and embedded script syntax checks passed. New tests execute the data layer against SQLite and exercise UI lifecycle functions with controlled DOM/HTTP boundaries. Visual browser verification was unavailable because the Chromium download timed out; these tests are not a visual pass.

---

# myTS v6.12.31 — Season-aware date views

- One shared season rule makes Schedule and Competitions show past data in previous seasons and removes their redundant date controls.
- Overview omits Today & next for previous seasons.
- Uses the existing season calendar, including its June pre-season boundary. Current-season filter preferences are preserved when switching back; filtering is enforced at read time so refreshes, saved preferences, and navigation cannot select Upcoming in a past season.
- No style, attendance terminology, data-fetching, or calculation changes.

---

# myTS v6.12.30 — GotSport history and competition periods

- Removes the upcoming-only filter from verified team match discovery. The live team endpoint returned 174 matches across 37 competition references, compared with 11 upcoming matches; existing identity/schema validation accepted the full response.
- Uses the existing fixture reconciliation, season filtering, publication checks, retry budget, and cached archival flow for history. Past leagues must load their division before being treated as archived. The data revision triggers automatic rediscovery after deployment.
- Adds Upcoming/Past controls to Competitions using the existing segmented controls. Games within an ongoing competition can appear in either period. Past games sort newest first; today remains Upcoming, matching Schedule. Filters respect the selected season and pre-season preference.
- Adds regression coverage for historical discovery, old leagues, repeated sync, failed-request retention, and date boundaries. Script and Trace regression checks also pass. Browser visual verification is unavailable.

---

# myTS v6.12.29 — Attendance terminology correction

- Restores Attendance as the player summary label.
- Uses Yes for counts and percentages in schedule, match, and event summaries.
- No layout, calculation, data, or interaction changes.

---

# myTS v6.12.28 — Consistent detail layout and RSVP wording

- Detail bodies, tab panels, and match sidebar stacks own their spacing through one 12 px gap token. Direct children do not add competing margins. Player panels use the same container as match panels; fixed-height scroll bodies keep content-sized rows.
- Consolidates detail tabs into one rounded, bordered container with 44 px buttons, horizontal overflow, and a consistent sticky position. Removes conflicting desktop/mobile container overrides.
- Schedule rows, match summaries, event summaries, and player response summaries describe Yes RSVPs rather than implying actual attendance. Counts and denominators are unchanged.
- Script and existing regression checks passed; browser visual verification remains unavailable.

---

# myTS v6.12.27 — Shared component corrections

- Goal and assist badges now own their common foreground, background, border, and padding in the shared icon component. Removes redundant assist/timeline rules and lineup color overrides; local rules retain size and placement only.
- Error toasts use the same danger foreground token as destructive buttons; attendance dividers use the shared line token.
- Consolidates keyboard focus across links, buttons, fields, selects, summaries, and table sorting. Removes field outline suppression and search-specific important overrides. Clipped controls retain only their inset outline placement.
- Consolidates loading spinner appearance and animation; reduced motion now covers both spinner sizes.
- Preserves intentional fixed pitch/heatmap colors and responsive layout differences. No data, authentication, or rendering lifecycle changes.
- Validation: script parsing and existing regressions passed. Browser visual verification remains unavailable in this environment.

---

# myTS v6.12.26 — Lineup contribution icons

- Uses the same dark glyphs on white badges in every theme.
- Raises substitute contributions above the avatar and name.
- Anchors goal and assist stacks closer to the player center, retaining the existing overlap.

---

# myTS v6.12.25 — Lineup badge placement

- Moves lineup position badges to the bottom right of player circles.
- Increases goal/assist icon overlap from 8 px to 12 px for starters and substitutes.

---

# myTS v6.12.24 — Visible transitions for tall disclosures

- Device diagnostics show that opening transitions run correctly, including the last nested disclosure. The 24-match content reaches 3,240 px in 240 ms; its visible portion is revealed within the first few frames. The smaller 275 px list takes the same duration, making its expansion much easier to see.
- Updates the shared native disclosure transition to animate opacity alongside intrinsic size. Content fades throughout the transition even when the expanding edge has moved below the viewport. Applies to every disclosure, with no per-list rules, duration timers, or interaction handlers.
- Preserves native open state, keyboard activation, reversal, refresh restoration, and reduced-motion behavior. Diagnostics now include content opacity for device verification.
- Validation: embedded-script parsing and existing Trace regressions passed. Live browser visual validation is unavailable in this environment; verify the tall-list opening on the device.

---

# myTS v6.12.23 — Nested disclosure diagnostics

- Adds bounded, local disclosure transition capture to the existing Diagnostics export: transition events, content heights, parent clipping, scroll movement, browser capabilities, and node replacement.
- Retains at most 24 interactions and 45 animation-frame samples per interaction. No network requests or disclosure/style/scroll mutations are added.
- Animation implementation is unchanged pending evidence of the last-child opening failure.

---

# myTS v6.12.22 — Smooth collapsible sections

- One native 240 ms content-size/visibility transition animates all details elements: competitions, nested division and unconfirmed lists, Data tools, and player editing.
- Native open state, summary links, keyboard interaction, and refresh restoration remain unchanged. No click interception, timers, or fixed content heights.
- Reduced-motion preferences disable disclosure animation. Browsers without native intrinsic-size transition support retain functional instant expansion.

---

# myTS v6.12.21 — Reconnect recovery and Settings scrolling

- One authentication-state check routes expired or missing Trace sessions to the email/code form from the alert, Settings, and retry actions. Existing connections and saved stats are retained.
- Settings updates its Reconnect label and sync availability as authentication changes.
- Account grid rows retain their full content height inside the shared scrollable sheet body, preventing expanded Data tools or connection fields from being clipped.

---

# myTS v6.12.20 — Stable notification placement

- Removed source status indicators from page and card headers. A single floating status area sits above mobile navigation and outside document flow.
- Source notifications retain tap/keyboard access to update details; repeated source errors no longer create duplicate toasts.
- Toasts and source indicators share one fixed stack to prevent overlap. Source indicators hide while a dialog is open.

---

# myTS v6.12.19 — Trace sync recovery and actionable alerts

- Restored the four missing shared Trace endpoint constants from the earlier implementation, fixing catalog refresh, sign-in, GraphQL, and profile requests.
- Source alerts now open a compact details dialog with the actual error, last successful update, recovery guidance, and owner-only diagnostics and Trace retry/reconnect actions.
- Settings uses the same error state as the alert; saved completed data no longer makes a failed refresh appear up to date.
- Background diagnostics record returned Trace failures as failures instead of completed runs.

---

# myTS v6.12.18 — One-button theme cycling

- One compact icon beside Settings cycles Light → Dark → Soccer Green → Light.
- Removed the Appearance row, theme picker, and its styles from Settings.
- Soccer Green replaces Midnight with a field-inspired green palette and subtle pitch stripes; saved Midnight selections open Soccer Green.
- Theme startup, validation, persistence, browser color, and cycling use one shared theme definition. No added dependencies.

---

# myTS v6.12.17 — Collapsible competitions

- Competitions start collapsed with a full-width, keyboard-accessible heading and expansion chevron. Names, dates, divisions, and GotSport schedule links remain visible.
- Reuses native disclosures and the existing render state restoration; competition and nested disclosure identities are scoped by team and season.
- Retains match actions, inner section headings, themes, and division/unconfirmed disclosures.

---

# myTS v6.12.16 — Shared theme system

- Added Dark and Midnight alongside the existing Light theme.
- Consolidated the duplicated color roots into one semantic token system shared by the dashboard, login, settings, dialogs, sheets, tables, inputs, status colors, navigation, and loading states.
- Theme choice is stored on the device and applied before first paint, including the browser theme color, so reloads do not flash the Light theme.
- Settings and appearance are available to both owners and private-link viewers; data-source controls remain owner-only.
- Added theme state to diagnostics and workflow coverage for switching, repeated selection, persistence, reload, and viewer access.

---

# myTS v6.12.15 — Unified mobile sheet chrome

- Unified the backdrop color and blur across detail, modal, team, and season sheets.
- Standardized mobile sheet headers around one surface, blur, height, spacing, typography, and close-control geometry.
- Detail and modal sheets now share the same bottom-sheet top boundary, keeping the app context visible behind the overlay.
- Removed the selector-only app-header override that conflicted with the shared overlay lifecycle.

---

# myTS v6.12.14 — Button-controlled mobile sheets

- Removed swipe-to-dismiss and its entire pointer-capture/drag state machine.
- Mobile sheets now rise automatically when opened and fall automatically when closed through native controls.
- Opening and closing complete through `animationend`/`animationcancel`; there are no gesture delays, click suppressors, or interaction timers.
- The overlay and navigation lock remain active until the closing animation completes, then focus returns to the opening control.
- Account, detail, Trace, team, and season sheets share the same animation lifecycle.

---

# myTS v6.12.13 — Native input lifecycle rebuild

- Removed the global synthetic touch activation system in full. Buttons, links, rows, menus, and dialogs now use their native `click` and keyboard activation paths exclusively.
- Declared `touch-action: manipulation` at the application root so browsers can deliver taps without double-tap gesture delay while preserving panning and pinch zoom.
- Kept Pointer Events only on sheet drag handles, where `touch-action: none` declares the custom vertical gesture before it begins.
- Rebuilt sheet drag state around pointer capture, `pointerup`, `pointercancel`, `lostpointercapture`, `animationend`, and `transitionend`; no interaction timers or duplicate-click filters remain.
- Restored one modal focus-return path for button, keyboard, backdrop, and swipe dismissals.
- Expanded diagnostics to record capture changes, trust, event phase, computed touch policy, inert state, and target connectivity without affecting input behavior.

---

# myTS v6.12.12 — Single-owner touch activation

- The shared touch lifecycle now owns primary touch activation from `pointerdown` through `pointerup`, suppressing the browser compatibility click at its defined source.
- A stationary release invokes the semantic control exactly once; movement beyond 10 pixels cancels it as a gesture.
- Removed the pointer-identity duplicate-click filter and the sheet-specific synthetic-click guard, which were competing legacy activation paths.
- Mouse and keyboard remain on their native activation paths. There are no debounce windows, delayed releases, or menu-specific exceptions.

---

# myTS v6.12.11 — Touch-release activation

- Diagnostics confirmed the failed retap delivered `pointerdown` and `pointerup` but the browser withheld the compatibility `click`; the app never received an activation event.
- Mobile buttons, links, summaries, labels, and keyboard-accessible custom rows now activate directly from a stationary primary-touch `pointerup`.
- Movement beyond 10 pixels cancels activation so scrolling and dragging remain gestures, not taps.
- A pointer-identity guard blocks only a later duplicate native click from the same touch. A new touch has a new pointer identity and remains immediately usable without a timer.
- Mouse and keyboard activation retain their existing native behavior.

---

# myTS v6.12.10 — Diagnostic collector startup fix

- Fixed the interaction collector using a single-element query where a modal collection was required.
- With no modal open, the old collector attempted `.map()` on `null`, interrupting captured clicks before Login or Account handlers could run.
- The collector now always returns an array and is covered for zero, one, and closed-modal states.

---

# myTS v6.12.9 — Mobile interaction diagnostics

- The existing Diagnostics download now includes a bounded 160-entry interaction trace for mobile sheet investigation.
- It records pointer down/up/cancel, click capture and settled state, sheet drag decisions, synthetic-click suppression, sheet open/close requests, focus, coordinates, pointer identity, overlay state, and history state.
- The trace contains no input values and stays in memory only until the page reloads.
- Reproduce the issue, then open Account & Data Sources and select **Diagnostics** without refreshing the page.

---

# myTS v6.12.8 — Immediate post-swipe retaps

- Removed `preventDefault()` from sheet drag completion so mobile browsers do not start a coordinate-based ghost-click suppression window.
- The shared gesture handler now identifies the completed pointer and suppresses only that pointer's synthetic click inside the sheet.
- A new touch receives a new pointer identity and can reopen the same underlying item immediately, with no timeout or debounce.

---

# myTS v6.12.7 — Gesture-aware sheet dismissal

- Swipe dismissal now carries an explicit gesture context through the shared sheet lifecycle.
- Gesture closes clear focus from the hidden sheet without restoring it to the opening item, preventing the first retap of that same item from being consumed.
- Button, keyboard, Back, and accessibility-driven closes still restore focus to the opener normally.
- The behavior is shared by entity sheets and modal sheets; mobile selection sheets retain the same one-tap reopening behavior.

---

# myTS v6.12.6 — Complete mobile sheet lifecycle

- Bottom navigation is removed while a mobile detail, modal, or selection sheet is open, matching its inert interaction state.
- Detail sheets extend through the navigation area while preserving the app header above them.
- Drag dismissal releases pointer capture and closes the overlay synchronously, so an invisible closing backdrop cannot swallow the next touch.
- Lineup assists stack to the left of the player and goals stack to the right, including substitutes.

---

# myTS v6.12.5 — Swipeable mobile sheets

- Mobile detail views, account panels, Trace panels, and team/season pickers now slide up when opened.
- Sheet headers include a standard grab handle and can be dragged down to dismiss.
- Short or upward drags snap the sheet back into place so an accidental touch does not close it.
- Confirmation prompts remain centered and unchanged.

---

# myTS v6.12.4 — Horizontal stacks and substitute contributions

- Contribution icons now overlap horizontally, extending left of the lineup player.
- Substitutes show the same stacked goal and assist icons beside their names.
- Browser regression verifies overlap geometry and mixed contributions at mobile and desktop widths.

---

# myTS v6.12.3 — Refined match icons

- Replaced the rough custom goal and assist artwork with clean, professionally drawn soccer-ball and cleat silhouettes.
- Both symbols now use the app’s neutral monochrome palette instead of the distracting orange assist treatment.
- Tightened the stacked lineup markers so multiple contributions remain compact and legible.

---

# myTS v6.12.2 — Match contribution icons and release-safe taps

- Goals now use soccer-ball icons and assists use boot icons in match timelines and lineup markers.
- Every contribution gets its own marker. Multiple goals and assists stack vertically on the player instead of collapsing into text such as `2G`.
- Stacked markers include an accessible summary such as “2 goals, 1 assist,” while decorative icons stay hidden from screen readers.
- Modal, menu, and detail backdrops now act on click/tap release instead of pointer-down, preventing accidental actions while a touch is still in progress.

Validation includes dedicated browser checks for mixed stacked contributions, timeline icon semantics, and release-safe behavior across all backdrop interaction paths.

---

# myTS v6.12.1 — Mobile roster and in-app navigation

- Jersey values are normalized before display, so source or saved values containing `#` cannot produce doubled symbols.
- Mobile Team is again a compact player list with visible, tappable sortable columns instead of separate player cards.
- Player avatars use the assigned position code. Players without an assigned position show a neutral dash instead of invented initials or roles.
- Competitions explicitly state when no games—or no team games—are confirmed. Unconfirmed placeholders remain available in their disclosure.
- User-facing **Availability** labels are now **Attendance** across Team, schedule context, details, reports, and exports. Provider field names and stored data remain unchanged.
- Player, match, event, opponent, and division details stay inside the application shell. The team/season header and mobile navigation remain visible.
- Browser and phone Back now close an open detail, return from a nested player to its match, and move between previously visited application sections before leaving the URL.

Validation includes the full API, synchronization, import, reconciliation, correction, and responsive browser suites plus new checks for hashed jersey values, position avatars, mobile roster sorting, explicit empty competitions, and browser Back behavior.

---

# myTS v6.12.0 — Structural UI redesign

This release rebuilds the interface hierarchy across the entire application while preserving its data model and workflows. Desktop now uses a persistent application sidebar, mobile keeps a compact contextual header and bottom navigation, and detail views open in focused drawers or full-screen mobile panels.

## What changed

- **Application shell:** team and season context, primary navigation, and account access now have stable, predictable placement. Navigation no longer competes with page content.
- **Overview:** a high-signal season summary leads into upcoming activity, recent results, and player leaders. Desktop uses a balanced two-column workspace; mobile becomes one intentional reading order.
- **Schedule and competitions:** filters, search, date groups, status labels, and fixture actions share one consistent visual system. Routine completed/past pills remain removed; actionable exceptions such as cancellations remain visible.
- **Team:** the desktop roster uses the full content width. On mobile, each player becomes a compact information card with jersey, appearances, minutes, goals, assists, and availability instead of a squeezed table.
- **Reports:** report selection is a compact side rail on desktop and a two-column switcher on mobile. Export actions remain attached to the selected report.
- **Player and match details:** desktop details use a right-side workspace drawer; mobile details remain full screen. Player identity, jersey, Edit control, metrics, heat map, and position profile are placed in a clear hierarchy. Avatars keep a fixed square footprint.
- **Lineups:** the lineup keeps a prominent experimental warning and explicitly states that positions and starters are inferred from Trace heatmap data and may be inaccurate.
- **Editing and data clarity:** saved position, jersey, goal, and assist corrections remain available from player headers. Known roster values are used; heatmap-derived roles stay confined to the experimental lineup.
- **Dialogs and controls:** cards, buttons, segmented controls, tabs, search, tables, modal sheets, spacing, radii, color, and type now use one coherent system with less visual noise and more efficient use of space.

## Verification

- All **25 browser workflow tests passed**, including delayed saves, stale responses, team and season changes, editor preservation, search clearing, mobile selectors, reports, and responsive layouts.
- Primary screens were rendered and visually inspected at **390 and 1280 px**. Automated width checks cover **320, 390, 768, and 1280 px** with no horizontal page overflow.
- Existing SQLite/API, import-publication, source-reconciliation, GotSport retry, correction persistence, jersey, position, G/A, lineup-warning, and browser-exception suites passed.
- Frontend and Worker JavaScript syntax checks passed.

Testing used local fixtures and Chromium; no live provider configuration was changed. Source data, D1 schema, synchronization behavior, and deployment configuration remain unchanged.

## Deploy

Deploy the full ZIP using the existing workflow and refresh open tabs. No database reset, reconnect, or reimport is needed. The regression suite remains at `tests/workflows.mjs`.

---

# myTS v6.10.2 — Workflow and failure-recovery review

This release fixes reproducible failures while changing teams or seasons, saving edits, navigating game/player details, loading source settings, and recovering from failed requests. It includes a reusable Chromium regression suite in `tests/workflows.mjs`. Earlier release notes below describe previous versions.

## Findings and changes

| Workflow | Confirmed problem | Current behavior |
| --- | --- | --- |
| Save, then close or open another player | A delayed success reopened the old profile; a delayed failure wrote into the new editor. | Responses update saved corrections and only refresh their original, still-open editor. |
| Edit while a cached team reloads | A response captured before the save could erase the correction locally. | Successful saves update family caches; older in-flight team reads preserve the saved correction. Correction responses merge by record timestamp. |
| Return to a team while an earlier update is pending | A previous visit's GotSport response could be accepted on returning to the same family. | Requests belong to a particular team visit. A new team's polls can start while the previous team's request finishes. |
| Change season with an open editor | An old-season player dialog remained open under the new season. | Team/season changes close context-specific dialogs. A save already submitted remains attached to its original player and season. |
| Open Account, start typing, then receive status | The background status response rebuilt the GotSport form and discarded the draft. | Status loading preserves an active team-connection form. Closed or superseded Account requests cannot modify another team's status. |
| Close/reopen Trace connection | An earlier sign-in response replaced the newer dialog; returning from team candidates could hide the update button. | Each dialog invocation owns its responses, and connected controls reset when opened. |
| Select an import, then switch team while it reads | The import used whichever team was selected after the file finished reading. | The import destination is captured when the file is selected and retained through a mismatch confirmation. |
| Queue Trace sync, then switch team | Its returned status could overwrite the new team's status. | Completion only updates the originating team visit. GotSport connection changes and viewer-link updates also retain their initiating family. |
| Recover from a mapping outage | A successful Trace map reload left the prior mapping error present, and normal polls did not retry it. | Mapping failures trigger retry during data polling and clear after success. |
| Navigate back from player to match | The Back callback reopened an old source object and showed an outdated score. Saving also added duplicate Back entries. | Back resolves the current fixture and saves preserve the existing navigation stack. |
| Remove an open match or its player data during refresh | A removed game remained visible; missing match-player data silently became a season editor. | The dialog explicitly reports that the data is no longer available. It can recover if the data returns. |

Automatic team-load retry remains active when no cached data is available. Failed corrections retain the draft; Trace data failures retain loaded stats. No database migration, data reset, reconnect, or Trace reimport is required.

## Validation

- 19 browser workflow cases passed with controlled response delays, HTTP errors, fresh browser contexts, two team families and two seasons. The failure cases above were reproduced against v6.10.1 before correction.
- Existing browser checks passed against the 108-game Trace snapshot: correction save/reload/reset, stale poll protection, schedule filters, reports, experimental lineup messaging and 320/390 px layouts.
- Existing reconciliation and SQLite-backed API checks passed: source precedence, ambiguity handling, cancellations, owner/viewer permissions, correction conflicts, import publication races, failed follow-up operations, and GotSport retry/deletion protection.
- Worker and embedded browser JavaScript passed syntax checks. Source data and deployment configuration remain unchanged.

### Run the included workflow tests

From the extracted project directory, using Node.js 20 or newer:

```sh
npm install
npx playwright install chromium
npm run test:workflows
```

The tests load the HTML embedded in `worker.js`, intercept all browser requests and use local fixtures. They require no credentials, deployed Worker, or live provider access. Playwright is a development dependency; it is not imported by the Worker.

For an existing browser/runtime installation, optional `MYTS_CHROMIUM` and `MYTS_PLAYWRIGHT_MODULE` environment variables select the browser executable and Playwright module. `MYTS_TEST_FILTER` runs cases whose names contain the specified text.

## Remaining limits

These checks validate application behavior with simulated provider responses. Live authentication, provider outages, actual rate limits, and the precise cause of the earlier GotSport delay remain unverified. The existing data-identity and backup limitations documented below still apply. This is a focused workflow review, not a security audit or a guarantee against every concurrency issue.

## Deploy

Deploy the updated project through the existing Cloudflare workflow and refresh open tabs. All seven original project paths retain their names; the archive adds only `tests/workflows.mjs`. Frontend, Worker and package versions are 6.10.2.

---

# myTS v6.10.1 — Data lifecycle and reconciliation review

This release reviews the data path through source ingestion, identity matching, display, totals, manual corrections, imports and refreshes. It includes fixes for reproduced failures, rather than a visual redesign. Earlier release notes below are historical; this section describes the current behavior.

## Findings and fixes

| Finding | Reproduced behavior | Fix |
| --- | --- | --- |
| Competing fixture joins | The same inputs paired differently depending on load order. A date-only Trace game could be attached arbitrarily to one of two TeamSnap games. | One source reconciliation function now serves schedule, competition lookups, game details and all-season opponent history. Ambiguous groups do not receive an arbitrary pairing. |
| Scores used as identity | Correcting a score could separate a TeamSnap game from its Trace copy. | A score disagreement no longer defeats strong, unique name/date/time evidence. Conflicting squad colors and birth years block automatic joins. |
| Inconsistent result calculation | A Trace-only scored game appeared on the schedule but was omitted from the team record. A partial TeamSnap score displayed `2–null`. | One complete score-pair resolver supplies score display, result, record and exports. A partial score cannot combine values from different providers. |
| Cancellation did not reach player totals | A matched cancelled game remained in Trace-based season appearances, minutes and G/A. GotSport cancellation could also leave the TeamSnap event in availability history. | Matched cancellations now propagate to record, player statistics and completed availability events. Source data is retained for reference. |
| Player identity used reusable attributes | A real named Trace player was attached to a different named roster player solely because the jersey matched. Saved player mappings were ignored. | Explicit mappings/source member IDs take precedence, then a unique normalized full name. Jersey fallback is limited to placeholder Trace names with unambiguous per-game identity. Named mismatches and duplicate names remain unmatched. |
| Corrections hidden by another scope | A TeamSnap-key season position correction hid a Trace-key game G/A correction. | Correction selection is scoped to season/game and reconciles the known roster/Trace aliases. The newest correction for that scope wins. |
| Old editors could overwrite new corrections | Independent sessions had no version check. Reset removed the version history needed to detect stale writes. | A single conditional SQL write checks the version across verified aliases. Resets retain an empty correction record with a new version. Conflicts preserve the draft and ask the owner to reopen the player. |
| Refresh could discard local editing state | An open editor could be rebuilt after focus moved away from an input. An in-flight team response could replace just-saved corrections. | Open correction editors are protected from automatic entity refresh; stale team responses preserve corrections saved after the request started. |
| Import cleanup could delete active data | A failure after publication entered the same catch block as staging failure and deleted the newly active generation. Cleanup also deleted every other generation, including another request's staged work. | Publication is fenced against the generation read before staging. Cleanup removes only the publisher's own failed generation or the exact superseded generation. Post-publication follow-up failure retains the imported dataset and reports a warning. |
| Reads could observe a removed generation | An old generation could be removed between the dataset-header read and the payload read, returning an apparent empty dataset. | Reads retry when the generation changes, or return an error without replacing displayed data. Incomplete saved datasets report an actionable recovery error. |
| Empty GotSport schedule could never remove old games | An empty division response was always rejected, even when discovery agreed that the games were gone. | An empty flight is accepted only with successful discovery at least as recent as the prior flight and no contradictory known matches. Otherwise data is retained while discovery is checked again. |
| Duplicate player rows inflated imported totals | Import validation checked duplicate game IDs but not duplicate player identities within a game. | Duplicate player identities within one imported game are rejected before publication. |

## Source rules

| Field or behavior | Current rule |
| --- | --- |
| Game identity | Unique explicit TeamSnap event references/manual game mappings first; otherwise unambiguous evidence across all available candidates. Existing source IDs are preserved. |
| Date and venue | TeamSnap first, GotSport second, Trace date fallback. An explicit game link survives a changed date within the loaded season. |
| Opponent display, competition and links | GotSport's named opponent and official competition/link metadata when matched, with TeamSnap/Trace name fallbacks. |
| Team score | First complete pair from TeamSnap, then GotSport, then Trace. Both sides always come from the same source. |
| Team record | Confirmed, dated, scored games that have started; matched cancellations are excluded. The same resolved games feed the season record and report. |
| Ambiguous fixture groups | Source rows remain separate and are identified as possible duplicates. The highest-priority available schedule source in the group supplies the record; lower-priority possible duplicate copies do not inflate it. The ambiguity and source IDs are included in Diagnostics. |
| Player identity | Saved mapping/source member ID, unique normalized full name, then restricted placeholder-name/jersey fallback. Jersey corrections do not silently remap people. |
| Player G/A | Saved per-game correction, then Trace. Corrections update aggregates, not the source score or scoring timeline. Only the corrected event type loses its unmapped heatmap markers. |
| Player position | Saved match role, saved season role, recognized roster role. Heatmap estimates remain confined to the experimental lineup. |
| Unmatched players | Retained in game views. Roster totals exclude them and show a short explanation; Diagnostics includes their identities. |
| Source removal | A successful full source snapshot replaces that source's records. Absence from an upcoming-only list is not proof that a historical recording or another provider's fixture should be deleted. |
| Saved corrections | Stored separately from source imports. Reimporting/syncing Trace does not overwrite them. Owner-only writes and viewer read-only access are preserved. |

## Validation

- Tested with the attached 108-game Trace dataset, local TeamSnap fixtures, a SQLite implementation of the D1 calls and Chromium.
- Browser regressions covered independent schedule filters, all of today's events, cancellation badges, correction save/reload/reset, source jersey aliases and zero, season/match role separation, G/A totals and exports, edit drafts during refresh and a delayed poll arriving after a save.
- Fixture tests covered the ROA naming/date-only pattern, changed scores, all three providers, retained links, explicit date moves, source precedence, conflicting colors/birth years, ambiguous doubleheaders, and cancellation propagation into player/availability totals.
- API tests covered owner/viewer permissions, invalid values, wrong player/season, stale editors, identity aliases, reset tombstones, correction persistence through imports, and duplicate-data protection.
- Failure injection covered generation changes during reads, repeated generation changes, post-publication import failure, concurrent import publication, and another request's staged generation surviving cleanup.
- GotSport tests covered 429 pauses, Retry-After, retired errors, corroborated empty schedules and contradictory deletion evidence.
- Desktop and 320/390 px mobile correction workflows passed without uncaught browser exceptions or horizontal player-dialog overflow. Worker and embedded browser JavaScript syntax checks passed.

## Limits and follow-up evidence

- Live TeamSnap, Trace and GotSport accounts were not authenticated or changed during this review. The previously quoted generic GotSport delay cannot identify its precise upstream cause; the app now exposes that cause and its retry time.
- Automatic cross-source inference is still evidence-based. A game moved to a different date without a stable shared reference cannot safely be identified from opponent names alone. Inferred joins are recomputed; this release does not introduce a new persistent cross-provider identity registry. Ambiguities remain visible and diagnosable instead of being silently guessed.
- Cross-season game moves and team renames that change the existing family key still need real source history to define a safe migration. No historical data is rewritten on that assumption.
- Name-only identities can remain unresolved after roster/Trace naming changes. Their source stats remain accessible, and the diagnostic export identifies them.
- Manual player goal totals can differ from a provider's team score. Saving a player correction does not invent or rewrite a scoring timeline.
- Trace JSON export remains the raw source dataset. Dashboard Excel/PDF reports use corrections; database backup is required to preserve corrections separately from a raw Trace export.

## Deploy

Deploy the entire ZIP through the existing workflow and refresh open browser tabs. Keep the current D1 database, bindings and secrets; no reset, reconnect, or Trace reimport is required. The archive keeps the original seven project paths. Frontend, backend and package versions are 6.10.1.

---

# Earlier releases

# myTS v6.10.0

## This release

- Schedule: independent All / Games / Practices and Upcoming / Past controls. Upcoming is the initial date range and includes all of today, including games completed earlier today. Existing calendar ordering is preserved.
- Removed Completed and Past event pills from event rows. Cancelled, Postponed, Rescheduled and other actionable states remain.
- Lineup has an explicit experimental warning: it uses Trace heatmap data and can misidentify positions and starters.
- Assigned player positions no longer come from heatmap guesses. Standard roster positions or saved owner corrections appear in profiles, player tables and reports. Automatic estimates are confined to the experimental lineup.
- Owner player profiles include Edit player details for season position and jersey. Inside a game, Edit match stats & position changes the match position, goals and assists. Blank goals/assists use Trace; zero is an explicit correction. Reset restores source values. The season role and the match role have separate scopes.
- Corrections are stored in D1 independently of Trace imports and sync generations. They are visible to private viewers, who cannot edit them. Match G/A changes flow through leaders, lineup contributions, player stats, season totals and Excel/PDF reports. Trace scoring timelines remain source evidence and are labeled accordingly when totals are corrected; manually edited G/A are not assigned fabricated heatmap locations.
- Jersey rendering recognizes jersey_no and uniform_no as well as existing fields, preserves zero and normalizes numeric .0 suffixes. Display priority is saved season correction, TeamSnap roster, then Trace. Player avatars and jersey numbers cannot shrink; long match descriptions wrap.
- GotSport optional HTML verification obeys the shared rate-limit pause and Retry-After. Failed verification retries independently of the longer JSON schedule refresh interval. Pending bracket assignments are not treated as upstream failures, and retired competitions cannot indefinitely keep the active sync in an error/pending state. Saved schedules remain available. The actual source error is shown in the toast and Account, with the next automatic check time.

## Deploy

Deploy the complete seven-file package using the existing workflow. Keep existing D1 bindings and secrets. The database migration runs automatically; do not reset the database or reimport Trace data. Frontend, backend and package versions are 6.10.0.

## Verification and limits

JavaScript syntax checks passed. Local SQLite-backed API checks covered migration, authenticated correction writes, viewer reads, invalid-input rejection and reset. Chromium interaction checks used the attached Trace dataset with a local TeamSnap fixture, covering independent schedule filters, today's completed games, cancellation labels, jersey zero, season/match roles, G/A aggregation and report consistency, reload persistence, reset, and mobile widths 320/390 px. No uncaught browser exceptions or player-dialog horizontal overflow occurred. GotSport fixtures covered shared 429 pauses, Retry-After and retired-error recovery.

The quoted GotSport toast contains no upstream diagnostic details, so the exact live failure is not proven resolved. Account now preserves the reason and retry time; the existing Diagnostics export remains available. The local checks do not authenticate against the live providers or deploy this archive.

Trace JSON export preserves the imported/source dataset; corrections are stored separately in D1. Dashboard Excel/PDF reports include corrections.

---

## v6.9.8 — Canonical fixture identity and duplicate suppression

Built from v6.9.7. Fixes duplicate games caused by one real fixture arriving from TeamSnap, GotSport, and Trace with slightly different opponent labels. The reported **ROA Soccer Academy 2016 Blue** / **Neveda ROA soccer academy 2016 blue** case is one fixture: TeamSnap has the authoritative 6:30 PM schedule/location/availability, while Trace carries the same 2–7 result under a misspelled opponent label.

- Fixture linking no longer requires opponent text to be exactly identical. It uses normalized opponent similarity together with same-day evidence, kickoff proximity when known, venue evidence, and matching scores when available.
- Conflicting known scores reject a merge. Different birth-year tokens are penalized, and distinct same-source IDs are never collapsed, so legitimate separate games stay separate.
- Explicit Trace → TeamSnap event IDs now take precedence when they are present, followed by existing saved/manual mappings, then conservative evidence matching.
- The same resolver is used for TeamSnap ↔ GotSport and GotSport ↔ Trace, removing the previous source-specific name rules that could disagree with one another.
- A final canonical-fixture pass merges only complementary source records and preserves TeamSnap schedule time, location, cancellation, and availability while attaching GotSport links and Trace performance to that one game.
- No D1 reset, reconnect, Trace reimport, or source-data deletion is required. The underlying source records remain intact; the UI now identifies them as one fixture.

Validation: frontend JavaScript syntax; reported ROA/Neveda fixture collapses to one item; alias-name + matching score/time case; date-only completed case; conflicting-score case; different birth-year case; same opponent two hours later remains separate; distinct TeamSnap event IDs remain separate.

## v6.9.7 — Match detail click regression fix

Built from v6.9.6. Restores the shared availability and spatial helpers that were accidentally removed during the detail-page UI refactor. That omission caused game taps to enter the match-detail handler and then stop on a JavaScript `ReferenceError` before the drawer could open. Player heat maps used the same removed spatial helpers, so they are restored in the same root-cause fix. No database reset, reconnect, or data reimport is required.

## v6.9.6 — Clearer detail pages and contextual game links

Built from v6.9.5. Same seven project files; no reset, reconnect, or data reimport is required.

- Match details now put date/time, teams, result/status, location, competition/division, and the GotSport action in one compact hero instead of spreading the same context across multiple blocks. Upcoming games show **vs** instead of a score-like dash.
- GotSport game actions no longer disappear when a dedicated match-detail URL is absent. myTS uses an actual supplied game URL when present, otherwise the already-resolved team/division schedule or event URL, labeled generically as **GotSport** so the UI never pretends a schedule URL is a direct game URL. Additional supplied GotSport game URL fields are preserved when present.
- Oversized four-card detail summaries were replaced with a shared compact facts layout for match, event, player availability/season context, opponent history, and division-match details. This keeps labels and values easy to scan without consuming most of a phone screen.
- Empty Player stats tabs and empty Match leaders cards are omitted. Player stats appear only when match performance exists; Availability appears only when that event actually tracks availability. Loading uses a small inline state instead of a large empty section.
- Event and division-match dialogs now use the same information hierarchy and compact status treatment as match details, improving consistency across detail pages without changing the main page/navigation structure.

Validation: frontend JavaScript syntax, Worker JavaScript syntax, embedded-HTML round trip, production seven-file bundle structure, and targeted match/link fallback behavior.

## v6.9.5 — Compact unconfirmed fixtures

Built from v6.9.4. Same seven project files, no reset or reconnect required.

- Main Schedule and Overview include GotSport fixtures with a valid kickoff and field/venue assignment, published fixtures (including venue/time TBD), results, or independent TeamSnap/Trace confirmation. A link or an early kickoff does not determine scheduling status. Existing saved venue/field names support older records; new collection also retains venue_id and pitch_id. Metadata refreshes automatically.
- Remaining fixtures stay in a collapsed Unconfirmed disclosure within their competition, with a count and the shared game rows. Counts include the division's unconfirmed fixtures. These rows show Time unconfirmed instead of presenting possible API placeholder times as commitments. Original source timestamps remain saved.
- Full division schedule contains scheduled fixtures; unconfirmed fixtures are not repeated there. Empty Our games blocks and the long publication notice are omitted. Disclosures retain open state through refreshes and disappear when empty. Newly assigned fixtures move into scheduled lists automatically.
- Schedule is inline with the competition title, with no dedicated link row. Game details show only actual supplied match URLs, never a substituted schedule link. Competition rows omit the redundant competition title already shown in the card header.
- Existing merged identity, availability, cancellations, loading states and background collection are retained. This version does not redesign removal/reschedule reconciliation.

Validation: saved league response yields 1 scheduled team game, 3 scheduled division games and 32 unconfirmed fixtures; first-load collapsed state, expansion persistence, field-assignment promotion, public/TeamSnap exceptions, legitimate early times, and missing game-link behavior. Chrome checks cover 320px, 390px and desktop layout, inline header-link position, deduplication and loading states. Worker startup, authentication, background alarms and API/public-time regression tests passed.

## v6.9.4 — Unified match identity and presentation

Built from v6.9.3; deploy the same seven files. No reset, reconnect, or data reimport is needed.

- TeamSnap/GotSport matching tolerates parenthesized US regional abbreviations such as (AZ), while retaining squad direction, age, color, and other name tokens. Timed fixtures require matching calendar dates and kickoffs within ten minutes; conflicting known venues reject a match. Date-only GotSport fixtures require matching venues. Every automatic link must be unique in both directions. Ambiguity remains separate instead of guessing.
- Existing explicit Trace-to-TeamSnap ID mappings take precedence. Automatic Trace matching now requires unique same-day opponent evidence, respects score/time conflicts where available, and no longer uses permissive multi-day fuzzy-name matching. This deliberately leaves uncertain matches separate.
- Shared merged items retain source IDs and combine TeamSnap availability/cancellation and schedule time, GotSport full opponent/competition/field details, and Trace statistics. A cancelled TeamSnap event is not automatically enriched with Trace performance. Names and field detail use the same precedence throughout the app.
- Overview, Schedule and Competition game lists use one row renderer. Competition own-game rows use the existing merged item rather than rebuilding a GotSport-only copy. All own-game entry points resolve to the same match details. Division/playoff placeholders retain their non-team identity and cannot become team commitments merely by appearing in a competition.
- Competition cards have only Schedule. Per-game links appear in game details: a verified supplied match URL when available, otherwise an accurately labeled GotSport schedule link. No guessed match URLs and no repeated source-link rows in game lists.
- Loading indicators, safe-link checks, cancellation visibility, availability and keyboard/mobile behavior are retained.

Validation: Chrome at desktop, 390px and 320px. The reported regional-name example produces one 9:05 AM entry with Field #17b and 8/12 available, shared by Schedule/Competitions/details. Tests cover three-source merging, cancellation, conflicting day/time/venue/age/color/squad, ambiguous candidates, single competition Schedule link, detail game link, loading states and view navigation. Worker startup, authentication and browser-independent background alarms passed. No production deployment performed.

## v6.9.3 — Shared loading and update states

Built from v6.9.2. Deploy the same seven files; no reset, reimport, or new configuration is needed.

- Shared source states distinguish active requests, current background work, queued/retry work, delayed updates, disconnected sources, and completed loads. Small spinners appear next to headings; first-load placeholders use skeleton rows. Stale activity stops spinning. Reduced-motion preferences are respected.
- Overview, Schedule, Competitions, Team, report previews, match statistics, player history, heat maps and availability use source-aware placeholders. Empty-result copy is shown after relevant sources finish, not while waiting. Search with no matches remains a search result, rather than becoming a loading state.
- Same-team refresh retains GotSport and Trace content. Team switching clears the old team's data and uses the selected team's cache only. Failed reads preserve existing content and show delayed status.
- Match statistics remain accessible before Trace arrives. Open match, event and player dialogs refresh on data changes while retaining their active tabs, scroll and Back history. Status-only updates do not replace dialog contents or page content. TeamSnap response timestamps now include resource updates so newly loaded availability updates an open dialog.
- Trace counts use actual published and total games. Queue/retry states use a clock; failures use a warning. Detailed progress remains in Account. No changes to Trace collection concurrency, GotSport fixture interpretation or source authentication.

Validation: Chromium at 1280, 390 and 320 pixels, including populated refresh states, first-load skeletons, failures, stale/queued/retry work, disconnection, genuine empty results, preserved saved content, match-tab updates, keyboard navigation and mobile overflow. Worker startup, authentication, 5,292-row availability response and browser-independent durable alarm execution passed.

## v6.9.2 — Preserve GotSport kickoff times

Corrects the v6.9.1 regression where public-page verification was required to display an API-supplied kickoff or include a game in Schedule.

- Publication evidence and kickoff availability are independent. A blocked public page, a missing row on a date-filtered page, or an unfamiliar time format no longer converts a supplied kickoff to TBD or hides the game.
- API-listed fixtures appear in Schedule and Our games with their supplied times. The competition says Fixtures listed until all rows have publication evidence; it does not falsely claim the entire schedule is published. GotSport's API still does not distinguish all organizer placeholders from published fixtures, so listed games may include tentative entries.
- Time TBD means no time is available, or the public row explicitly says TBD/TBA. A parsed public date/time takes precedence over the API time, including reschedules. Unchanged saved publication evidence survives failed checks and filtered pages.
- v6.9.1 saved reported_start_at values are restored on read, without a reset or new download. A background metadata revision also schedules refreshes automatically.
- Names, division links, TeamSnap and Trace processing remain unchanged.

Validation: actual workerd tests with saved league API fixtures and controlled public-page responses cover first-run redirects, filtered rows, unrecognized time formats, explicit TBD, missing API time, changed public kickoff, saved-cache repair, request budgets and continuation. Chromium tests verify that listed games retain times in Schedule and Competitions, plus desktop/mobile layouts. Runtime startup, authentication and background alarm checks passed. No production deployment performed.

Earlier release notes below describe the behavior of those versions; v6.9.2 supersedes the v6.9.1 requirement for public proof before showing a time or game.

## v6.9.1 — GotSport fixture verification

Built from v6.9.0. Deploy all seven files with the existing D1 and Durable Object bindings. No data reset or Trace reimport is needed.

- League and tournament divisions both resolve through verified event/bracket IDs. League links open the Rankings event overview, division schedule, and division standings separately.
- Team names are enriched from GotSport's ID-matched team profiles, cached for seven days and shared across games. Public schedule labels take precedence when verified. Club prefixes are not duplicated; display names never establish team identity.
- API match discovery is not evidence of organizer publication. Each division's public HTML schedule is checked within the existing request/time budget. Unique match numbers are matched within that division. A kickoff is shown only when its API timestamp agrees with the public date, clock time, and recognized timezone. Valid early games and games without venues are not rejected based on those attributes.
- Verified fixtures appear in Schedule; unverified fixtures remain visible in Competitions under Awaiting schedule confirmation, with Time TBD. Independently scheduled TeamSnap events remain visible. Completed results remain available. Publication labels no longer follow API synchronization success.
- GotSport can redirect public schedule requests to a verification challenge. myTS does not bypass it or treat it as an empty schedule. Previously verified, unchanged fixtures retain their saved proof; new or changed fixtures remain unverified. Public verification problems are included in source diagnostics. Consequently, a successful API sync alone may leave fixtures awaiting confirmation, including tournaments.
- Saved metadata migrates automatically through background jobs. Club lookups use remaining request capacity and resume in later passes; no per-game profile downloads. Existing Trace collection, eight-lane concurrency, TeamSnap availability, and durable alarm runtime are unchanged.

Validation: live API response shapes checked; fixture-based workerd tests cover publication HTML parsing, one published/nine unverified league games, valid 5 AM kickoff with no venue, identity-based names, division links, migration, ten-request budget, continuation, and saved verification after a public-page redirect. Chromium checks cover all five views and dialogs at desktop/mobile widths, plus unverified fixture exclusion from Schedule and its Competition disclosure. Runtime authentication, large TeamSnap response, and browser-independent alarm execution passed. Production publication verification remains dependent on GotSport allowing the public page request.

## v6.9.0 — Product and workflow refinement

Built directly from v6.8.0. Deploy the complete seven-file project with the existing Durable Object configuration, D1 binding, secrets, and routes. No reset, reimport, or Trace recollection is required. The background alarm runtime, eight-lane full-half collection, calculation engine, and saved data are retained.

### UI and workflow review

- Shared typography, surfaces, spacing, buttons, cards, search/clear controls, external links, event states, and mobile touch targets were reviewed together. Overview has actionable Today & next and compact recent results; Team remains season analysis; Schedule manages events; Competitions covers discovered leagues and tournaments; Reports provides Excel/PDF exports.
- Schedule defaults to Upcoming unless a deliberately selected view was saved. Its four views are Upcoming, Games, Practices, and Past Events. Today's events stay in Upcoming for the entire browser-local calendar day, ordered latest time first; future dates follow chronologically. Past Events excludes today and sorts newest first. Games/Practices include both future and past, with current/future events before history. Cancellation stays visible. Postponed/rescheduled flags are shown when supplied by the provider. Date rollover updates an open page and is checked again after returning to a hidden tab.
- Schedule dates/times and event details use local time consistently. Season grouping remains based on the team's season calendar. June exclusion now also applies to Trace season statistics and positions.
- Long names wrap on mobile. Recent results form a grid instead of a horizontal strip. Team and match tables retain a compact mobile summary with full player details available. Report tables become labeled records on phones, with sorting available through a compact control that reuses desktop sort logic. Reports show all rows instead of silently stopping at 30.
- Report choices use compact shared controls. Team totals are outside the sortable body and reflect search results. Sorting survives search and refresh. Player Overview no longer repeats the match log already present in its Matches tab. Empty match tabs and empty playoff panels are omitted.
- Detail tabs support keyboard arrows, Home/End, and ARIA selected states. Dialogs isolate background controls, preserve Back-tab context, reset detail scroll on opening, and retain focus behavior. Mobile picker focus is contained. Source polling avoids rebuilding a view while its menus/dialogs are open. Account refresh preserves the Data tools disclosure, focus, and scroll.
- All-season opponent history excludes cancelled games from scored totals and cannot overwrite a different detail view after a slow response. Source error toasts use concise user-facing wording; technical failure details remain in diagnostics.

### Position methodology audit and replacement

Previously, `squadProfiles` averaged selected-season spatial data but could fall back to all historical seasons, treated TeamSnap's static position as an override, assigned approximately 30% of otherwise unclassified players to defense and 30% to attack, and then assigned specific left/right labels by roster order. Match positions also fell back to season positions. These rules could yield specific but unsupported labels and couple an individual game's position to the team-level result.

The new model:

1. Uses distinct appearances from the selected season only, respecting pre-season inclusion. A single duplicated game does not increase supporting-match counts.
2. Classifies each appearance independently using confirmed goalkeeper minutes or normalized spatial evidence. Field evidence requires finite in-range average coordinates, at least 30 samples, and a declared own-goal/attacking orientation.
3. Uses depth, attacking/defensive third occupancy, and a bounded correction for the team's average depth in that game. It does not allocate a fixed percentage of the roster to any position. Goals or assists do not force an attacking position.
4. Uses heat-map occupied-zone majorities and average lateral location for left/center/right labels only when tactical lateral orientation is supplied. Otherwise it retains DEF/MID/FWD rather than inventing a side.
5. Aggregates match evidence using playing minutes (capped at 60 per match) and sample quality (saturating at 500 samples). Frame counts cannot give one densely sampled game unlimited influence.
6. Requires at least three supporting appearances, coverage of at least half of played appearances, and consistent positional evidence before using a specific season position. A meaningful repeated secondary position can appear alongside the primary. Players with substantial evidence in different lines and no dominant line are labeled Utility. No evidence yields Position pending.
7. Shows evidence strength and supporting appearances in the season profile. Strength reflects sample adequacy, match count, coverage, and consistency; it is a heuristic, not a calibrated accuracy percentage. Per-match labels use only that game's evidence. Pitch shape is estimated, and missing positions are not filled from the season profile.

Limitations: normalized heat maps are available only where the saved match payload contains them. The existing fresh-game collector retains time-interval summaries for playing time; it does not currently create new normalized per-player heat maps. This release does not fabricate location data or use the historical import as a substitute for a team's live collection. Spatial orientation itself is inferred upstream and can be uncertain. Position estimates need coach validation; this is not a validated position classifier or a claim of known tactical assignments.

### GotSport links

Resource IDs and public links are retained in normalized match data. Existing saved records are enriched when read, without forcing rediscovery. Match details, Schedule rows, and competition headers expose consistent GotSport links for verified event pages, schedules/divisions, standings, team schedules, and supplied match/bracket URLs. League records from existing discovery now appear alongside tournaments. Unsafe URLs are rejected. When no verified individual-game URL exists, the action explicitly identifies the GotSport schedule rather than inventing a game-specific route.

URL formats were checked against GotSport's public event page and its published Schedule, Results/Standings, and team links:
- https://system.gotsport.com/org_event/events/50847
- https://system.gotsport.com/org_event/events/50847/results?group=456213

Some GotSport pages require browser verification. myTS does not bypass that verification.

### Validation

- Real Chromium render and interaction checks at 1280, 390, and 320 px: all five main views plus player/account dialogs; no page or dialog horizontal overflow or uncaught runtime errors. Existing Bootstrap Icons assets were supplied locally only to the isolated test browser; deployment continues using the existing CDN assets.
- Local-calendar ordering, same-day completed events, cancellations, midnight rollover, differing team/browser time zones, search and clear, keyboard detail tabs and mobile pickers, modal background isolation, Back-tab restoration, and mobile report sorting.
- Position fixtures: a one-match role change does not override a stable season role; match labels remain independent; rotating players; one-game and missing/null/unoriented evidence; prior-season and excluded-June isolation; repeated-game deduplication; input-order invariance; increased evidence strength with consistent additional games.
- Provider tests: saved/public link projection, team-registration URL paths, league exposure, unsafe URLs/IDs, and event-state preservation.
- Existing workerd/Miniflare runtime, authenticated 5,292-row D1 reads, alarms without a browser, lifecycle/restart/retry, full-half/fallback/checkpoint/auth/rate handling, request budgets, publication recovery, and 108-game queue-completion tests passed against this build.

No production deployment was performed. Live spatial accuracy and provider-link availability still depend on source data; local tests do not establish production CPU usage or live sync speed.

## v6.8.0 — Background sync on Workers Free

The supplied Cloudflare logs contain `exceededCpu` failures for public reads and scheduled sync. Ordinary Workers Free requests have a 10 ms CPU allowance. Moving network calls around or increasing concurrency does not fix calculation and JSON-processing work that exceeds that allowance.

This release adds the SQLite-backed `MyTSRuntime` Durable Object, supported on Workers Free with a default 30-second CPU allowance per invocation. The public Worker forwards API requests without parsing their bodies or building datasets. A separate object for each provider runs background work through persisted alarms; existing cron triggers wake these objects and provide a recovery path. Dashboard reads no longer launch provider sync. Closing Chrome or switching tabs does not stop the server-side alarm schedule.

Trace retains full-half acquisition, eight task lanes, bounded passes, checkpoints, rate-limit pauses, and the completed-game queue fix from v6.7.12. Each active pass schedules its continuation. Recovery honors existing deployment leases before reclaiming abandoned tasks; saved chunks and completed results remain in D1. Ring extraction now tracks interval bounds without allocating timestamp arrays. New teams still collect their own games from Trace; the included historical file is not a replacement for collection. The compact settings UI is retained.

### Deploy this release

1. Deploy the complete project, including `worker.js` and **`wrangler.jsonc`**. Uploading only the Worker code will leave the required runtime binding missing.
2. Preserve your existing deployment name, `DB` database binding/ID, secrets, and routes. The supplied configuration adds `MYTS_RUNTIME`, the `MyTSRuntime` class, and the `myts-runtime-v1` migration using `new_sqlite_classes`. Do not remove this migration from subsequent releases.
3. Keep the existing cron schedules enabled. After deployment, their next ticks start provider alarms automatically (Trace within two minutes, GotSport within five). Manual Trace refresh can also wake its job.
4. Do not clear or reset D1, reconnect providers, or reimport historical data for this update. Existing connections and published games are retained.

Workers Logs are enabled in the configuration. Download diagnostics includes `background_runtime` with each provider's last run and next alarm. To verify unattended progress, note the current count, close the app for several minutes, then reopen it and download diagnostics. Advancing run timestamps demonstrate background execution; game counts may remain unchanged while a game is still being collected or calculated. Expired provider credentials and upstream rate limits still require their existing recovery paths.

### Validation and limits

Cloudflare's local workerd/Miniflare emulator successfully instantiated the SQLite-backed object, served authenticated data, rejected unauthorized reads, and executed a persisted alarm without browser polling. Lifecycle tests cover restart continuation, old-lease protection, retry scheduling, and durable manual requests. GraphQL/SQLite tests cover eight-lane collection, full-half fallback, checkpoints, rate/auth handling, publication recovery, and collection of 108 new fixture games without repeating completed games.

Local profiling of 108 historical fixtures found median calculation CPU of 15.4 ms, p95 73.3 ms, and maximum 1,486 ms, supporting the need to move calculation out of the 10 ms runtime. These are local Node measurements, not production CPU or throughput guarantees. The emulator does not enforce the production Free CPU budget. Live deployment still needs verification; this release does not promise that an entire archive will finish in seconds. Cloudflare Free storage/request/duration quotas and upstream service limits still apply.

References: https://developers.cloudflare.com/durable-objects/platform/limits/ and https://developers.cloudflare.com/durable-objects/platform/pricing/

## v6.7.12 — Preserve completed games when raw cache is absent

The source queue previously considered a missing raw-source row sufficient reason to download a game again, even when its current-version calculated result was marked ready. This caused imported or retained published games to be re-collected ahead of missing games, replacing published rows while the available-game count stayed unchanged.

A ready game with the current playing-engine version no longer enters source collection solely because raw source data is absent. New games, explicitly invalidated games, older-engine results, outdated existing source versions, and eligible error retries remain collectible. Already-running tasks finish from their checkpoints. No archived files are required for a new team; all its missing games are collected from Trace. Eight lanes and the v6.7.11 settings UI remain unchanged.

The supplied diagnostics show 24 successful full-half requests in 4,098 ms with no fallback/rate block, publication timestamps advancing, and the same 26 published games. This release corrects queue eligibility, not the successful transport path. Deploy without resetting data.

## v6.7.11 — Eight Trace lanes and compact account settings

Trace collection uses eight concurrent task lanes. The existing 24/40 request budgets, 22-second work budget, full-half checkpoints, segment fallback, and shared rate-limit pauses are retained. Existing tracking backlog is drained before preparing another game. The supplied diagnostics showed 24 successful full-half calls in 8,320 ms, followed by preparation of another game while 11 checks remained on the active one. Prioritizing the backlog also selects the existing 40-request pure-collection budget for that pass. Actual throughput depends on Trace response times and throttling.

Account & Data Sources now groups providers into compact rows. TeamSnap progress aggregates repeated resource counts; Trace shows availability, active game, and tracking progress on separate lines. Import, export, and manual Trace refresh remain in Data tools. Pre-season is a single switch row; sharing keeps Copy/Replace actions without displaying the long private URL. Diagnostics and version share a footer. All source actions and drag-and-drop import remain available. No database reset is needed.

## v6.7.10 — Full-half Trace acquisition

New player/half tasks request one complete half and only the ring field, using the request shape verified by the live Chrome comparison. Four existing concurrent task lanes, request budgets and the 22-second work budget remain in place. Completed full halves are checkpointed immediately. Existing partial segment checkpoints continue without being discarded; completed games are not invalidated. No schema or calculation-engine version changes are required.

Request failures, malformed responses and timeouts switch that task to the existing four-segment collector, with the fallback choice persisted across retries. Authentication failures, forbidden responses and rate limits stop/pause through the existing handling instead of triggering more requests. Empty successful rings retain the existing identity-candidate behavior. Silent upstream truncation cannot be detected from the response alone; live validation so far covers one outfield player's half, not every game or goalkeeper.

Transport diagnostics add strategy, full_half_requests, full_half_completed and full_half_fallbacks alongside bytes, requests, completed tasks, elapsed time and stop reason. UI and TeamSnap/GotSport behavior are unchanged. No direct-stat endpoint or historical archive is used as a substitute for fresh collection.

The supplied live comparison measured 898 ms versus 2,112 ms for four sequential requests with exactly matching intervals. Production already batches requests, so production improvement is not yet measured. Deploy normally, allow pending collection to continue, then export sync diagnostics to measure actual throughput. Do not clear saved data for this update.

## v6.7.9 — Remove the measured per-game collection split

Live v6.7.8 diagnostics at 2026-09-16T05:26:10.683Z confirmed batch mode, 24 requests, 92 chunks, 10,594,014 response bytes, 21,273 ms, 23 completed tasks, no fallback and no rate pause. The pending game had 26 player/half tasks. Both the 24-request cap and two-lane throughput made a full game span multiple passes. This measured raw input is megabytes even though calculated statistics are much smaller.

Pure tracking collection now uses four task lanes and a 40-request hard cap. Passes that perform catalog refresh or allow source preparation keep the 24-request cap to reserve room for metadata requests. All passes retain the 22-second work budget, per-chunk checkpoints, fallback and Retry-After handling. Trace cron processes at most one eligible connection per invocation, ordered by update time, so the external request allowance is not multiplied across teams.

Transport diagnostics now include request_limit, concurrency and stop_reason (time_budget, request_budget, task_budget, rate_pause, queue_drained). They continue reporting actual bytes, chunks, tasks and elapsed time. UI, attribution engine, source coverage and saved history are unchanged.

Tests reproduce a 26-task game through a real GraphQL implementation and verify all 26 complete in one pure collection pass. Tests also verify four-request concurrency, 40-call pure/24-call mixed hard caps, checkpoint recovery, rate pauses, unchanged tracking segments, publication recovery, TeamSnap and GotSport regressions. This removes the avoidable pass split; the new live elapsed time and total archive completion time are not yet measured. No claim that all 108 games finish in seconds is made.

## v6.7.8 — Grouped Trace collection

Replaces four separate per-player/half tracking requests with one GraphQL operation containing four named halo fields. Each field retains its original one-segment variables, time range and GID; responses remain separate and feed the unchanged segment extraction and calculation engine. Only the ring field needed by the engine is requested. No sampling reduction, speculative direct-minute substitution or incomplete-result publication is introduced.

Two task lanes share a 24-HTTP-request and 22-second collection budget. A pass can now complete up to 24 tasks / 96 tracking chunks instead of six tasks / 24 chunks. HTTP overhead is reduced by up to 75% for uncached four-chunk tasks; this is not a measured 75% end-to-end speed increase. Failed or missing fields retry individually from existing checkpoints. GraphQL validation/HTTP 400 rejection automatically switches to single requests for 24 hours without discarding saved results. Authorization failures and rate limits do not trigger fallback; shared pauses honor HTTP Retry-After.

The current source data, calculation engine, UI, scheduled cadence and published history remain unchanged. The initial 108-game backfill still has many upstream computations; seconds-level collection of that entire archive has not been verified. The normal new-game path reuses saved historical source data. Required live checks occur naturally during sync, with no manual probe or credential export.

Existing Account > Download diagnostics includes status.progress.transport: mode, request count, chunks received, grouped response bytes, elapsed milliseconds, completed tasks, fallback and rate-pause state. response_bytes counts grouped responses only; single-request fallback bytes are not included. These are last-pass measurements, not total historical progress.

Validation: queries executed through a real GraphQL implementation with deterministic tracking fixtures; 96 chunks in 24 calls, concurrency <=2, unchanged merged segments, partial-field retry, rejection fallback, strict request budget and Retry-After pause. Publication migration, tenant scoping, TeamSnap pagination, GotSport error recovery and embedded JavaScript regressions passed. No authenticated Trace live throughput benchmark was available.

Reference: https://graphql.org/learn/queries/#aliases

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

Validation: eight concurrent lanes, request caps, checkpoint/fallback recovery, auth/rate handling, and backlog-first scheduling tested. Account UI rendered in Chromium at 900px and 390px with no horizontal overflow or runtime errors; Data tools and file picker interactions checked. External icon-font loading was blocked in the isolated preview; production retains the existing Bootstrap Icons stylesheet.

Team history navigation: shared team links open cached GotSport history by verified ID. Names without an ID open a prefilled search for explicit selection. Back restores the preceding sheet and scroll; browsing remains user initiated.

Head-to-head in team history uses verified GotSport participant IDs, our team perspective, shared source reconciliation, and all recorded seasons by default. Upcoming meetings are separate; custom dates and an own-team opponent picker are available.

Shared public GotSport caching (6.14.0): backend history is keyed by GotSport team ID, with a five-minute freshness window on user opens; manual Refresh bypasses freshness but respects active leases and upstream backoff. Private recent-team lists retain their family scope. Existing snapshots migrate automatically, retaining the newest successful copy.

While team history is visible, the existing foreground heartbeat checks today's division results about once per minute for unscored matches. Scored matches are rechecked no more often than five minutes because the API does not reliably distinguish posted scores from final scores. Division responses and leases are shared across viewers. Polling never fetches full history, runs no cron job, and stops on navigation or a hidden tab. Diagnostic exports include shared history and division checks. Saved history is retained on failures. Visual browser verification was unavailable; the release includes database, race, lifecycle and cross-team identity regression coverage.

6.14.1 fixes shared tab enhancement overwriting view-owned IDs, which prevented team history from initializing. Existing IDs are preserved; generated IDs are unique and stable. Regression tests cover the original failure and repeated enhancement.

6.14.2 reuses the existing detail facts, tab panel, match lists and text/icon actions for team history and H2H. Summary content is outside bordered match lists. Cross-season H2H dates include years. No new CSS components were added.

6.14.3 resolves missing team links from unambiguous reconciled matches or explicitly saved choices. Fallback searches clear unrelated filters, infer editable age/gender from the tapped name, and automatically search when both are available. Explicit choices are saved per dashboard in browser storage; public game history remains shared in the backend.

6.14.4 uses the shared load-state renderer for team history and H2H. Empty results require a successful snapshot; refresh keeps saved content visible and uses the existing icon-button style at the end of the filter toolbar. The separate status button was removed. Failed first loads show Retry in the content area; failed refreshes retain saved data and use the existing notification pattern.

6.14.5 removes inferred and remembered name-to-team navigation mappings. Missing or conflicting GotSport identities use the existing history/H2H view with exact-name local games and no remote requests. Local history defaults to all past games. Fixture-derived links require matching full opponent names and unambiguous reconciliation. Standalone team search remains available. The shared tab-ID correction is retained.


## v6.15.0

- The global header opens the existing team search. Theme and Reports are in Settings; Favorites replaces Reports in primary navigation.
- Shared match rows and details expose star actions. Favorites use the existing Upcoming/Past dates and neutral home/away match presentation across all seasons of the selected dashboard.
- Favorites are stored in D1 per dashboard and authenticated identity: owner or shared viewer dataset. Devices using the same viewer link share that watchlist; the app does not have individual viewer accounts. Owner and viewer lists are separate.
- GotSport matches must exist in the server's saved team or competition data with matching event, match, and participant IDs. Local TeamSnap/Trace games retain a minimal snapshot without guessed external IDs.
- While Favorites is visible, the existing foreground heartbeat checks for results. Today's unscored games use the shared 60-second division cache; other active saved games use five minutes. Scored games older than seven days and cancelled games require manual refresh for further corrections. No team-history downloads or background scheduler are added.
- Unavailable, removed, or reassigned games retain saved information and produce an actionable update message. Refresh cannot recreate deleted favorites. At most 100 saved games per watchlist.
- Tests: `npm run test:favorites`, plus existing team navigation, H2H, shared results, tabs, match indicators, and team browsing suites. Visual browser verification was unavailable.

6.15.1 restores the shared centered icon-button layout for favorite stars. Unstarred rows remain available to re-star during the current Favorites visit; automatic result updates retain them. Changing the main tab or Upcoming/Past tab, or explicitly refreshing, clears those temporary rows. Backend removal is immediate; late responses cannot retain rows after a view boundary.

6.15.2 replaces duplicated Upcoming/Past markup with one shared renderer and uses the common filter-toolbar style for Schedule, Competitions, Favorites, Team, team search and history filters. Competition controls now receive the same container, spacing and responsive sizing. Prior-season hiding, local-date filtering, and Favorites retention are preserved.

6.15.3 shares exact match-to-division resolution between Favorites and team result updates. Matches without a bracket can use their exact published division ID; current bracket membership supersedes a saved division. Invalid or absent identity remains an error. Favorites division metadata now expires after five minutes and is refreshed on manual refresh. Regression coverage includes playoff score updates without bracket assignments.


## 6.16.0 — Shared nationwide U7–U9 discovery

The existing global team search now reads a shared D1 directory for U7–U9. A separate `directory` job on the existing MyTSRuntime Durable Object is awakened by the existing GotSport cron; no new binding, cron or client timer is required. Deployment starts collection automatically at the next GotSport cron (within five minutes). The initial nationwide pass fills progressively; no pre-populated national database is bundled. U10–U19 retain existing ranking search.

Discovery enumerates every page of the public `/events/search` results for ages 7, 8 and 9, then reads event details and published divisions for those ages. It includes tournaments and leagues. Six national ranking queries (ages 7–9, boys/girls) also populate the index. Event IDs and team IDs are authoritative. Names do not establish identity. Collection never requests individual team histories, profiles or player rosters. Opening a selected team uses the existing on-demand shared history cache.

The event endpoint was verified on September 18, 2026: it lists ongoing/upcoming events; passing a past month does not enumerate completed events. This implementation therefore cannot claim every U7–U9 team nationwide, historical-only teams, unpublished schedules, or younger teams appearing exclusively in older divisions. Previously discovered identities remain searchable when their events end. Current/past division labels describe observed participation, not verified registered team age. State searches include the event state for competition-derived entries and label it explicitly; they do not infer the team's home state. Coed divisions are clearly labelled and included in either gender search.

D1 stores exact-ID evidence, name variants and resumable task checkpoints. Writes and page continuations commit atomically in batches, with set-based inserts to avoid per-team database requests. Leases fence stale writes; source rate limits pause the collector. Each alarm performs at most three provider requests. Event/ranking enumeration repeats daily; non-empty divisions normally repeat weekly. Completed published divisions stop after the end-date grace period; empty schedules retry daily until 90 days after the event end. Failed requests retain evidence and back off. No team history refresh is added to the scheduler.

Diagnostics include directory counts, catalog page progress, checked/error task counts, and up to 20 classified task failures. The existing results card displays partial-coverage/building status. Search returns a single deterministic paginated list deduplicated by exact team ID, with optional name and State filters.

Validation: `npm run test:team-directory` executes the production collector/search functions against SQLite, with real public responses from three Nevada U8 divisions (21 distinct teams). It tests ranking union, pagination, playing-up labels, interruptions, safe replay, empty/error retention, rate-limit recovery, leases/fencing, bounded bulk writes, terminal events and shared playoff validation. Existing history, Favorites, navigation, H2H, tabs and transport tests pass. Browser visual verification and a deployed nationwide collection were not performed.

Platform references: https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/worker-api/d1-database/ .


## 6.16.1 — Neutral fixture identity

Fixed the shared GotSport side resolver comparing empty participant IDs as if they were a verified team identity. Favorites refresh could produce “GotSport assigned the same team to both sides of a match” for unresolved playoff fixtures. Missing viewing identity now produces a neutral fixture, while valid IDs are normalized before comparison. Genuine duplicate-team and registration conflicts remain rejected.

The new regression reproduced the exact error against 6.16.0 before the fix. Repeated saved-Favorites refreshes now pass, alongside missing/numeric identity, one-known-participant and genuine-conflict tests. Shared results, history, team browsing and directory suites also pass. No UI layout or schema changes.


## 6.17.0 — Follow teams and compact match cards

Stars now follow teams, using exact GotSport IDs. They appear in search/recent results, the team-history header, and beside each identified team in shared game rows. Teams without verified IDs have no star. A full team name remains available in its history header; cards clamp names to two lines with ellipsis and preserve the actual spelling. No name guessing or abbreviation is introduced. Game cards use a left-hand month/day/time block and two team rows with aligned scores, W/D/L indicators and stars. Older years appear beside the month. Secondary details occupy one clipped line and remain in game details. Shared toolbar sizing now prevents segmented controls overlapping adjacent selectors on narrow screens.

Favorites shows the combined games of followed teams with the existing Upcoming/Past controls and an All teams/team selector. Today's games remain Upcoming until the local date changes, regardless of kickoff time. Games shared by two followed teams are deduplicated by event/match ID; fresher cached data wins. Existing individual game favorites remain accessible with remove/restore controls, rather than ambiguous game stars. Unfavoriting retains the current visit's rows for undo; changing tabs/period or manually refreshing clears that retention. Teams without games can be selected in the filter and unfavorited there.

`team_favorites` stores the authenticated owner/viewer identity, team-family scope, verified team ID/name, revision and last check. Schema upgrade preserves existing saved games. Up to 20 teams can be followed per scope. All users reuse the existing shared GotSport history/results caches. Opening Favorites displays cached games and uses the existing foreground heartbeat to refresh up to three due teams per request. Missing histories continue on subsequent heartbeat checks. Ordinary full-history freshness stays five minutes; today's results reuse division checks. A fresh shared history also suppresses redundant result checks for the first minute. Manual Favorites refresh requests current result checks without forcing every team's full history download. No followed-team background jobs, private recent-history pollution, or new client timer is introduced. Unfollowing during a refresh cannot recreate the favorite.

Validation: production SQLite tests cover persistence, scope isolation, exact IDs, 30-second shared-cache reuse, duplicate division requests, new games, source failure retention, unfollow during a refresh, client deduplication, duplicate taps, undo, failed saves and family switching. Existing Favorites, team history, directory, navigation, H2H and match indicator tests pass. Real Chromium checks cover 320/390/768/1280px layouts, two-line names, card overflow, star click isolation, retained rows/undo, full-name headers, header star restoration and all three themes. Browser tests use controlled data/API responses; no live deployment was performed.

Run `npm run test:team-favorites` and `npm run test:team-favorites-browser` after installing development dependencies/Playwright Chromium. An optional `BROWSER_EXECUTABLE` selects an installed Chromium executable.

## 6.17.1 — Favorites UI consistency

- Team dropdown precedes shared Upcoming/Past controls; removed permanent toolbar star and refresh. Failed updates provide Retry update.
- Shared match cards show tiny read-only favorite markers, with no empty star buttons or score columns for unscored games. Team search and team details retain favorite actions.
- Legacy saved-game remove/restore actions are labelled in match details; saved data is preserved.
- Consolidated shared period sizing and shortened unconfirmed times to Time TBD.
- Browser checks cover 320–1280px layouts, shared period styles, favorite retention and undo, and all themes.

## 6.17.2 — Team-only favorites

- Favorite/unfavorite actions are available only in team details; search and game cards have no favorite controls.
- Removed the Favorites-specific retry button. Existing notifications and foreground refresh handle update failures.
- Removed saved-match handlers, refresh logic, client state, and storage. Upgrade drops the obsolete match_favorites table; followed teams and shared histories remain intact.
- Shared match time formatting uses TBD for missing, pending, and all-day kickoff times. Missing dates display TBD; posted dates and genuine midnight times are preserved.
- Verified team persistence, shared-cache reuse, removal migration, API rejection of old match-saving requests, missing date/time cases, and mobile favorite/undo flows.

## 6.18.0 — Club logos

- Preserve ID-associated GotSport logos in shared match, directory, ranking-search and team-history data.
- One badge renderer serves match cards, search results and team details; missing logos retain the existing fallback. Original colors and proportions remain consistent across themes.
- Same-origin public image route accepts only GotSport team/organization logo paths and raster images, with seven-day shared edge/browser caching. Team-history profiles reuse seven-day metadata rather than fetching on every history refresh.
- Verified real-source logo mapping, cache reuse, invalid sources and content types, mobile layouts, failure stability, navigation, and favorite/undo behavior.

## 6.18.1 — Shared team display

- Shared team-profile storage keyed by verified GotSport ID supplies canonical names and logos independently of game histories. Seven-day caching includes missing logos; leases deduplicate concurrent users, with failure backoff and prior-data retention.
- One display resolver uses the connected team’s existing TeamSnap name for its verified ID and GotSport profile names for other teams. No hardcoded team names or guessed abbreviations.
- Cards, search and team headers resolve profiles on demand, including older saved games without logo fields. Fixed-size badges use the same fallback for unavailable or failed images.
- Profile lookup responds to view/collapsible visibility and preserves navigation, highlighting and favorite controls.
- Tests cover stale game snapshots, shared cache reuse, missing logos, wrong-ID responses, concurrent requests, failed refreshes, mobile layouts and generic connected-team name changes.

## 6.18.2 — Search layout and logo diagnostics

- Search results use a content row instead of the obsolete three-column leaderboard layout. Shared row spacing and interaction styling remain consistent.
- Team rows reserve the same badge space for verified and unresolved teams. A neutral shield replaces the people fallback.
- Existing Diagnostics exports distinguish profile requests, missing logos, profile refresh errors, image delivery errors, browser decoding failures and successful image loads. Image failures receive a single bounded diagnostic HTTP check per source per session.
- Verified the actual search form submission and team opening workflow at mobile/tablet widths across all themes, alongside favorites and history tests.
- Live verification: GotSport LVSA image returned HTTP 200/image/jpeg. Deployed app health and logo routes were inaccessible from the verification environment (HTTP 403). The deployed logo failure is not claimed fixed; use Settings > Diagnostics after reproducing it with this version.

## 6.18.3 — Preserve logo delivery diagnostics

- Separate image-load events from HTTP diagnostic results so repeat failures cannot overwrite response evidence.
- Reuse the same diagnostic promise for each image source; exports await in-progress checks with a bounded network timeout.
- Verified repeat errors, response metadata retention, pending exports and timeouts, plus mobile search and favorites workflows.
- This release corrects diagnostics; deployed logo delivery remains unconfirmed.
