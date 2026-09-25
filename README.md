# myTS 6.20.85

## Shared analytics identity resolution

Player analytics, native heat maps, collection completeness and diagnostic matching now use one server-side resolver. Published game identities remain the starting evidence. Contradictory stable IDs or named identities remain unresolved. A placeholder may inherit a jersey association only from unambiguous named entries in other games of the same season and the same connected team. Generic goalkeeper tracking remains a separate role unless the published game already assigns that identity to a player.

When one mapped identity contains positions and its aliases are empty, the populated identity supplies the player's analytics and heat map. Multiple populated identities are flagged for overlap rather than summed or silently selected. Unassigned tracking retains a readable jersey label and its source data. Each chosen identity includes its matching method and supporting game IDs.

Elimination requires independently supported participation for every published player, one unresolved tracking entry with positions, one remaining player without positions, and no conflicting candidates for that entry. Estimated participation or multiple unknown identities do not qualify. No inferred assignment is fed back as named season evidence.

Existing saved rosters work without a re-download. The read path resolves aliases without rewriting player records, computed statistics or cached Trace responses. The client consumes the selected server identity instead of running a competing name-matching rule. The data cursor changes for this release; newly collected manifests invalidate identity-derived output through the existing revision mechanism.

## Season feedback

The existing Sync diagnostics export's collection audit includes identity_feedback: named entries checked, supported comparisons, conflicts, entries lacking another game's evidence, and per-game exceptions. Each entry is compared against other games with its own game withheld. The comparison measures consistency with Trace's named rosters, not independent identification accuracy. Player diagnostics includes the selected game's resolved identities and season feedback too.

Replay of the two supplied real-game exports: September 5 issues reduced from five to one, preserving unassigned tracking #15; September 20 issues reduced from one to zero. The two-game consistency check supports 20 of 22 named entries with no contradictions; two jersey entries lack another-game support. Broader season results depend on the full saved roster history at runtime and may conservatively reject aliases where additional conflicting evidence exists.

Verification: both supplied diagnostic fixtures, synthetic populated-map attachment, repeated attachment stability, away-team normalization, conflicting IDs and jersey history, named guests, season isolation, overlapping populated aliases, confirmed-only elimination and multiple unknowns. Actual SQLite collection and diagnostic projections, tenant boundaries, zero/missing distinctions, bounded fresh diagnostics and credential exclusion passed. Chromium at 390px and 1280px verified alias selection, ambiguous selection refusal, admin export/viewer exclusion, and Overview/Schedule/game refresh flows. Packaged Worker startup and embedded scripts passed syntax checks.

Not deployed. Full live-season feedback has not yet been collected. Install this version and export Settings > Diagnostics to review the full saved-season results. No collector retry changes, database reset, schema migration or new binding is required. The original archive filename and four root paths are preserved.

# myTS 6.20.84

## Targeted player diagnostics

Administrators can open a game, expand Trace collection, and select Player diagnostics. The downloaded JSON includes that game's saved source roster and placeholder flags, published identities, matching method and candidates, field counts, heat-map state, task attempts, last update, and next scheduled check.

The export compares the original Trace roster and up to two affected own-team full-game scopes with fresh Trace responses. Mapped players with missing positions are prioritized; omitted scopes are listed. Each invocation makes at most six application-level Trace requests (token, roster, two stats and two heat-map requests), with a shared 22-second upstream deadline, one live-check allowance per connected team per minute, and the existing database budget gates. No polling or automatic retry is added. Fresh checks stop on request failure. Authentication, access, budget, rate and timeout failures retain the saved diagnostic evidence in the export.

Reports distinguish an absent heat-map field, null, an empty array, an all-zero grid, invalid data, and recorded positions. Newly available positions establish a difference from the saved response, not the cause of that historical difference. Original source identities are exported without emails, access tokens, cookies, profile hashes or event coordinates. Current task counters are included; historical responses were not recorded and cannot be reconstructed.

This is a diagnostic release, not a claim that the reported player identities or heat maps have been repaired. Player mappings, completeness rules, analytics caches, task schedules and statistics remain unchanged. Live checks use the existing Trace session and cached profile access. No broad re-download, migration or data reset is required.

Verification: actual Worker startup and embedded-script syntax; real SQLite query projection and tenant isolation; dummy flags, matching evidence, heat-map states, six-request cap, omitted scopes, budget/rate denial, stopped requests after authentication failure, and credential exclusion. Chromium at 390px and 1280px verified admin diagnostic download, viewer control absence, and existing Overview/Schedule/game navigation and refresh. Controlled services were used; live authenticated Trace results remain unverified. Not deployed.

The latest uploaded package was used as the baseline. Original archive filename, four root files, and deployment configuration are preserved.

# myTS 6.20.83

## Trace collection visibility

- Overview replaces the ambiguous Analyzed/player counts with clickable collection counts that open Schedule.
- Schedule's Season filters include All Trace games, Complete stats, and Incomplete stats. Catalog games without published match data remain visible.
- Game overviews list missing player/team fields, identity problems, and recorded collection errors. Explicit zero values and empty event arrays are accepted. A player with recorded minutes but an empty heat map is flagged for verification.
- Checks cover published player records, the native roster, both team full-game scopes, and connected-team player full-game scopes. Complete means these field checks passed, not that source statistics are independently verified.
- Results are reused for five minutes and can be refreshed. Refresh reads saved data; it does not trigger recollection. Sync diagnostics includes an audit across all detected seasons, including undated catalog games.

This release adds read-only diagnostics and navigation. The historical export establishes missing usable spatial data but cannot establish the underlying source/collection cause. No speculative collector retry changes, database reset, or broad re-download are included. Install this release and export Sync diagnostics for the next investigation step.

Verification: field-level fixtures and real SQLite projection queries; missing versus zero, identity precedence, restricted/missing scopes, refresh counts, tenant/season boundaries, and all-season/undated coverage. Chromium at phone and desktop widths verified counts, filters, unpublished-game access, field details, refresh, and delayed initial loading without runtime errors. Worker and embedded-script syntax and module startup passed. Tests use controlled services; live Trace and physical-device behavior remain unverified.

Earlier UI fixes are retained. Configuration and the four root archive paths are preserved. No new bindings, migrations, secrets, or deployment are included. Use your existing deployment configuration. App version: 6.20.83.

# myTS 6.20.82

## Match player to Season profile

- Player name and avatar form one keyboard-accessible Season profile link, with a subtle underline and focus indicator. Removes the separate Season profile button.
- Match-player slides have no Edit button or hidden editing forms. Removes their unused editing guards. Season profiles retain existing administrator-only editing. Game overview match editing is unchanged.
- The player carousel saves its slide scroll positions before cleanup and restores them on resume. Back from Season profile preserves the selected teammate and vertical position.

Verification: Chromium at 390px and 1280px with controlled analytics responses. Avatar/name activation, keyboard activation without URL hash changes, administrator Season editing, viewer restrictions, restored teammate/180px scroll position, and touch swiping across the linked area passed. No browser runtime errors. Worker and embedded-script syntax and ZIP integrity checked. Backend unchanged except version, configuration unchanged. Not deployed.

# myTS 6.20.81

## Schedule layout and indicators

- Season list fills its available container width for populated and empty results. No Season legend.
- Date strip and Calendar share the same day classification, dot markup, colors, and accessible descriptions. Game and Practice can both appear on the same day; Other event retains the existing calendar rule. Indicators refresh when schedule data changes without replacing date buttons.
- Calendar legend sits opposite Today on one footer row. The Date-view legend stays at the bottom-right of the viewport, above phone navigation and safe areas, with bottom content spacing. It is hidden while an overview or calendar covers the Schedule.
- Shared legend markup avoids separate definitions in the two views. Existing carousel and navigation behavior remains in use.

Verification: Chromium at 320, 390, 768, 1280, and 1600px widths; populated/empty Season widths, matching mixed/single/other/no-event dots, Calendar footer alignment, Date legend positioning while scrolling, and repeated view switching passed. Live indicator refresh, touch swiping, and resizing were also checked. Embedded scripts and Worker syntax, packaged version, and ZIP integrity checked. Backend unchanged except version; configuration unchanged. Controlled local tests; not deployed.

# myTS 6.20.80

## Stable match-player analytics

- Match-player analytics use consistent heat-map, completed-pass, box-touch, shot, and player-touch sections while loading, unavailable, empty, and ready. Map space and metric rows stay in place; local heat-map data remains available while detailed results load.
- Adjacent slides prepare available cached analytics. Only the selected player starts network requests, beginning at selection rather than waiting for the swipe to settle. Existing request deduplication and ready-result caches remain shared. No speculative adjacent-player API reads.
- Asynchronous player content updates wait for horizontal movement, vertical scrolling, pointer interaction, and editing to finish. Completion uses carousel and browser events, without delay timers. Independent slide scroll positions remain intact.
- Removes slide content-visibility skipping and the old player analytics layout replacement. The team analytics output is unchanged. Earlier Settings invalidation fix is retained.

Verification: Chromium with controlled responses and real chart rendering (350 events per map), 100 games and 16 players. Delayed responses during swiping at 390px, 768px, and 1280px widths with 4x CPU throttling retained section geometry and scroll positions. Repeated navigation, vertical touch scrolling, cached neighboring content, loading/error/deferred/empty results, editing, Back/resume, reduced motion, and replacement cleanup passed. Team analytics HTML matched the previous renderer exactly. Initial cold loading requested only the manifest and selected player's analytics. Worker and embedded scripts passed syntax checks; archive integrity and unchanged backend/configuration checks passed.

Tests use controlled services; physical-device and live-service behavior are not verified. Not deployed. Archive filename and four root-level paths are preserved.

# myTS 6.20.79

## Settings and overview close responsiveness

Settings now compares GotSport dashboard content before invalidating the view cache. Identical responses and status-only updates no longer trigger a synchronous dashboard rebuild when an overview closes. Changes to events, competitions, or team identity still invalidate the cache. Status indicators and polling remain active. Uses the existing dashboard content signature; no navigation or animation changes.

Verification: Chromium with controlled API responses, 100 games and 16 players, phone (390px) and desktop (1280px) widths, and 6x CPU throttling. All eight scenarios passed: no Settings, identical response, status-only update, and changed content at both widths. After Settings finished its closing animation, a single click closed the overview. Unchanged/status-only cases performed no dashboard render; changed content performed one and retained updated data. On phone, Settings was opened through the app function because the full-screen overview covers the sidebar. Worker and embedded scripts pass syntax checks. Backend unchanged except version; configuration unchanged.

This removes a verified unnecessary rebuild. The reported multi-second delay has not been reproduced against live services or on a physical device. Not deployed.

The archive retains the supplied filename and four root-level files.

# myTS 6.20.78

Based on the supplied myts_v6.20.77.zip. All 6.20.77 backend, database write-efficiency, accounting, and configuration changes are preserved. The only backend difference is APP_VERSION.

## Match-player navigation

- Replaces the custom pointer-release/reopen handler with the existing bundled Embla carousel used by Schedule.
- Stable drawer and slides follow the finger. Previous/next controls use the same carousel. Each player retains an independent vertical scroll position, and Back returns to the original match or season view.
- Nearby player summaries are prepared from local match data; only the settled player starts detailed analytics. Shared analytics caching and request deduplication remain in use. Offscreen slide rendering uses content visibility.
- Match views no longer calculate hidden season match logs or attendance histories. Background refresh retains unchanged player DOM and only rebuilds changed player content. Roster additions/removals are handled while idle.
- Editing is scoped to the selected player, with one form owner. Swipes and arrows cannot switch players during editing. Reduced motion and viewport resizing are supported.

## Head-to-head

- Shows available meetings immediately while histories refresh. Each completed team request can update the display without waiting for the other team.
- Reuses fresh history according to returned refresh timing; explicit Refresh remains available. Partial history and request errors remain visible.
- Removes a duplicate range-change animation.

## Overlay responsiveness

- Overview data refresh waits while a pointer, select menu, modal, editor, or player gesture owns interaction.
- Shared sheet animations use an owned Web Animation completion/cancellation lifecycle. Replacing a view synchronously completes any closing select before its owner is removed, preventing leftover portal layers.
- Queued focus work checks the current view and top dialog and uses preventScroll.
- Expensive pointer diagnostics run only with ?diagnostics=1. That mode also records bounded browser long-task and input-delay timing in the existing diagnostics export, for investigating any remaining device-specific lag.

## Verification

Worker and embedded scripts pass syntax checks. Chromium tests used the actual player/analytics renderers with controlled data and API responses: 100 matches, 16 players, populated heatmaps and event charts, and four-times CPU throttling. Checks cover phone/tablet/desktop widths, touch movement before release, retained DOM and scroll positions, editing, Back/resume, repeated settings overlays, interrupted menu teardown, immediate H2H display, cached reopening, rapid navigation, reduced motion, background refresh, and resizing. Packaged backend comparison and ZIP integrity checks passed.

These are local browser tests; physical-device and live-service behavior have not been verified. Not deployed.

# myTS 6.20.77

Database write efficiency and shared daily budgets. Based on the supplied 6.20.76 package; its player navigation, spacing, team search, and sidebar changes are preserved.

## Changes

- TeamSnap has one sync owner, the existing Durable Object. Connect waits for that owner’s initial pass; cron and refresh requests enqueue work. An old deployment’s lease is respected while it expires.
- Each bounded TeamSnap tick publishes completed resources and its latest cursor in one atomic D1 batch. Intermediate pages no longer rewrite the staged job. Repeated updates to the same resource merge against the staged result and publish only the final result. Failures retain the prior committed checkpoint. A transaction precondition prevents an in-flight old credential from publishing after reconnect.
- Successful retry-control records and unchanged progress statuses no longer rewrite identical data.
- Rankings scans record observed team IDs in their page checkpoint instead of touching every team’s generation. Stale teams are removed only after the complete scan succeeds. An older partially complete scan restarts at page one once to build a complete identity set. Team identity, aliases, changed data, and discovery coverage remain supported.
- Directory jobs use their persisted due time as an optimistic commit condition, rather than writing a separate claim/lease for every fetch. The single owner serializes execution, batches evidence with the continuation, and rejects stale replay. Existing outstanding leases are respected. Public directory freshness uses catalog check timestamps, so unchanged team rows do not need timestamp writes.
- Shared daily accounting now enforces reservations across runtimes. Normal completion releases unused reservations; interrupted work conservatively retains its reservation until the UTC day changes. Deployments/restarts do not reset allowances. Cron wakes do not bring quota-paused jobs forward.
- Diagnostic budget reads do not rewrite the ledger. Empty usage checkpoints do not rewrite Durable Object usage records. No per-page D1 workload was moved to Durable Object storage.

## Budget settings and limitations

| Work | Reads/day | Writes/day |
|---|---:|---:|
| All measured app use: background admission ceiling | 3,000,000 | 70,000 |
| All measured app use: foreground admission ceiling | 4,500,000 | 90,000 |
| Directory workload’s own write ceiling | Shared above | 20,000 |

The directory allowance is contained within the shared allowance, not added to it. Read-only API operations can continue at the app write ceiling while read capacity remains. Existing data is retained; delayed work resumes automatically after midnight UTC. On installation during a day already over the background allowance, background writes pause for the remainder of that UTC day. Pauses are capacity protection, not counted as efficiency savings.

Reservations use conservative operation estimates and actual D1 metadata reconciliation, including the index/trigger cost reported by D1. Unexpectedly larger operations trip a circuit breaker for subsequent work. This is not a Cloudflare account spending cap or an absolute guarantee: a single unexpectedly expensive query, other applications, earlier unmeasured activity, and Durable Object quotas are outside a strict D1-only guarantee. Keep Workers Free to retain the provider-enforced no-overage boundary.

## Validation

Local SQLite/Node tests compared the same fixtures against 6.20.76:

| Fixture | Before | After | Reduction |
|---|---:|---:|---:|
| Unchanged TeamSnap sync: 12 resources, two ticks | 24 logical row changes | 4 | 83.3% |
| Unchanged rankings evidence: 100 teams | 100 logical row changes | 0 | 100% |

These are fixture logical changes, not Cloudflare billable row counts or production-wide savings. Genuine new directory entries still require writes; the previously discussed 23–35% daily usage target remains unverified.

Passed checks: checkpoint rollback and retry, staged resource merges, reconnect during I/O, changed rankings, multi-page deletion reconciliation, interrupted legacy scan restart, stale job replay, concurrent reservations, preserved reservations across restart, UTC rollover, read-only access at the write ceiling, overrun circuit breaker, quota-paused cron wake-ups, fresh schema initialization, Worker module/embedded-script syntax, and packaged app/health handler startup. No schema migration or destructive rebuild is required. A Cloudflare-runtime deployment and physical-device test were not performed in this environment.

## Production comparison

After deployment, confirm every runtime reports 6.20.77 and save the usage diagnostic. Compare the next complete UTC day with the September 24 baseline of 75,572 writes at 20:36 UTC only with matching time windows and activity. Use hourly/release/workload counters and Cloudflare D1 totals together. Report directory growth, completed scans, data freshness, and paused time alongside write savings. The full-day live comparison remains outstanding.

---

# myTS 6.20.76

- Match player views support left/right swipes and previous/next buttons within the same match, ordered by minutes. Navigation preserves the original Back destination, respects reduced motion, and does not switch players while the editor is open.
- Every overview uses a shared bottom spacer: 40px including the grid gap, plus the device safe area.
- Team search shows team identity and rankings without competition entries. Competition logos no longer fall back to a generic team logo.
- Overview drawers keep the sidebar usable. Navigation closes the full overview stack before switching views; confirmation and other modal dialogs still block background interaction.

Validation: Worker and embedded scripts pass syntax checks. Chromium fixture checks passed at 390px, 768px, and 1280px, including touch input, swipe direction, vertical gesture rejection, player boundaries, preserved Back destination, bottom spacing, team results, logo isolation, sidebar navigation, and modal isolation. Live data and physical-device testing were not performed.

# myTS 6.20.75

Date navigation animation policy: nearby day selections and five-day arrows slide with Embla; distant calendar/Today selections use a short opacity transition instead of scrolling through empty months. The fixed date highlight never animates. Calendar month labels, season changes, Day/Season switches, schedule period/type filters, competition and bookmark periods, and team custom-date/range results use the same non-blocking replacement transition. Reduced motion skips effects. Rapid actions cancel/restart only the affected visual animation; no input locks, gesture timers, extra data requests, or cloned interactive overlays are introduced. Background refreshes do not start these transitions.

# myTS 6.20.74

Schedule dates and game panels now share a single navigation index including previous/next season actions. A swipe previews its date during motion and loads game content on settle; direct date taps update immediately. Five-day arrows animate using the same carousel. Both the date strip and calendar season actions enter the adjacent season at its boundary day. No timer-based gesture handling or server requests were added.

# myTS 6.20.73

Schedule day swipes now update the game list when the carousel settles, while direct date taps update immediately. Date and day controls update only around the previous and next selections; only nearby game panels remain mounted, and game data is grouped once per data revision. Long date jumps land directly. Calendar month changes update only the departing and entering months. The centered date highlight and date text remain visually aligned during motion.

# myTS 6.20.72

- Competition headers have one native expand/collapse action, including their name and logo. Competition references elsewhere still navigate to that competition; explicit controls retain their actions.
- Shared game cards open game overview from team names, logos, scores, dates, and empty card space. Team navigation remains available inside game overview. Native keyboard activation and explicit controls remain separate.
- Schedule's selected-date background stays centered outside the moving Embla track. Taps and swipes retain the same carousel lifecycle.
- Scope team-name/logo hydration to affected DOM subtrees. Reuse cached profiles and batch missing/stale profiles without scanning the entire page on every disclosure. No new polling or database writes.
- Per-frame disclosure measurements are disabled during normal use; opt in with the diagnostics=1 query parameter when collecting interaction diagnostics.

# myTS 6.20.71

- Resolve matches through one canonical source model across Schedule, Overview, Bookmarks, Competitions, team browsing, head-to-head, and detail opening. Keep foreign-team perspectives, ambiguous identities, stale kickoff/participant records, and permissions isolated.
- Share effective score precedence, player identity aggregation, team timezone formatting, selected-season ranges, and season transition loading. Operational Schedule reports include all scheduled events; analytical reports retain included-game filters.
- Preserve parent navigation, active tab, and scroll for attendance-to-player and event detail routes. Refresh restored parents when their data changed; refresh match details regardless of originating tab.
- Initialize sortable tables and detail tabs through the shared mounting path. Export report rows in their displayed order. Standings use an explicit component option instead of rewriting rendered HTML.
- Use bundled Embla 8.6.0 for Schedule day and date-strip navigation as well as the calendar. Stable slides, interruptible navigation, scoped drag-click handling; remove the old document pointer handlers, timed click suppression, and custom gesture animation code. Lineup dragging is unchanged.
- Avoid deriving and repainting unchanged dashboard payloads. Deduplicate ready analytics for up to a minute, invalidate on source revision/access changes, and retain retry behavior for pending/error results. No additional database schema, polling jobs, or writes.
- Remove 64 overridden base-style declarations and obsolete gesture styles while retaining responsive rules and component variants.
- Validation: packaged Worker/client compilation; identity safety, cross-view data, nested navigation, sorting/export, season/timezone, and simulated carousel interaction tests. Physical Android validation and production resource savings remain unmeasured.

# myTS 6.20.70

- Replace custom calendar gesture handling with bundled Embla Carousel 8.6.0 (MIT). No runtime CDN dependency.
- Stable six-row month slides and season boundary pages remain mounted while gestures and animations run. Remove calendar input lock and timed click suppression.
- Previous/next, Today, dates, and season buttons retain their existing actions. Destroy the carousel when closing or replacing the sheet.
- Embla supports interrupting movement with the next gesture; its click suppression belongs to the drag rather than a timed lockout. Other schedule and lineup gestures are unchanged.

# myTS 6.20.69

- Competitions uses the shared verified fixture instead of requiring identical opponent spelling. Stale participant/time mismatches remain unlinked.
- Unique connected-team/date/kickoff matches can link TeamSnap and GotSport with squad, venue, score, and duplicate checks.
- Shared season-scoped team aliases are rebuilt from synced verified fixtures and stable GotSport team IDs, reused in fixture matching, team links, and local team history. Ambiguous names stay unresolved. No alias API calls or database writes. Existing snapshots supply evidence after reload.

# myTS 6.20.68

- Clear the calendar swipe click-suppression flag on a fresh pointerdown anywhere within the calendar, so immediate taps on dates, arrows, Today, and season buttons work. The completed swipe still suppresses its own accidental click. Swipe detection and animations are unchanged.

# myTS 6.20.67

- Keep calendar months at six date rows to prevent sheet jumps.
- Swiping beyond season boundaries shows a standard centered Previous season or Next season button in the same area. Arrows and reverse swipes use the same navigation. Unavailable seasons are disabled; tapping an available season uses the existing season selection flow.

# myTS 6.20.66

- Calendar month swipes ignore bubbled capture-loss events from date buttons when touch capture transfers to the calendar. Actual calendar capture loss still cancels the gesture.

# myTS 6.20.65

- Nested match/player navigation restores the existing view, selected tab, controls, and scroll position instead of rebuilding the parent and remounting its analytics. Covers lineup, player table, match log, and season-profile navigation.

# myTS 6.20.64

- Correct TeamSnap availability codes: 0 = No, 1 = Yes, 2 = Maybe; missing or null = No response. Shared mapping fixes practice/game attendance lists and player summaries, including cached records.

# myTS 6.20.63

- Owner login uses a signed, Secure, HttpOnly, same-site cookie, renewed on opening the app for 30 days. Existing tab keys migrate automatically; keys are no longer kept in browser storage. Signing out clears this browser session. Changing ADMIN_KEY invalidates all sessions. Session validation uses no D1 reads or writes.
- Temporary startup errors retain saved dashboards and use a retry screen instead of asking for the owner key. Partial dashboard snapshots are preserved; cached bootstrap data supports service outages after access validation.
- Match-player analytics reuse the verified game-local spatial identity before user ID/name matching. Unmatched detail responses preserve existing heatmaps.

# myTS 6.20.62

Uses one green SVG heat-map renderer for live analytics, saved fallback data, and season profiles. Retains average-position and available goal/assist markers; removes the legacy red/yellow canvas renderer. Database and stats calculations are unchanged.

# myTS 6.20.61

Removes unnecessary Trace analytics collection and write amplification from 6.20.60.

- The queue collects the connected team's individual player stats/heatmaps and both team summaries. Opponent-player and legacy half-game caches are retained but excluded from processing and progress counts.
- The existing per-team lease protects the analytics run. Each task saves its result directly; the extra D1 `loading` update is removed. A crash before saving leaves the task available for retry.
- Unchanged responses update scheduling metadata only. They do not rewrite cached stats or heatmaps, change the content timestamp, or update coverage/spatial revisions.
- Pending tasks do not announce spatial changes. Only changes to required heatmaps invalidate the page's map data.
- Settings and diagnostics count required full-game tasks. Diagnostic cached counts/bytes include retained historical data.
- Source correction intervals, authentication, retry handling, both-team comparisons and player-stat calculations are preserved. No usage pauses or caps are added.

Upgrade from 6.20.60 uses schema v7: adds a constant-default required flag, marks used scopes, replaces the queue index and adjusts triggers/counts. It does not rebuild directory tables or copy/delete cached payloads. This migration still consumes D1 reads/writes once; subsequent starts use the schema-version check.

Validation: actual Worker request/save-path tests, 112-game synthetic migration with both home/away identities, indexed empty-queue checks, 200 database mutations, counter parity, rollback, cached-data preservation and unchanged stat/spatial algorithms. Synthetic migration changed 1,570 table rows and indexed 1,568 required scopes; these are local SQLite measurements, not production D1 usage. Production savings require a deployed workload measurement.

# myTS 6.20.60

Retains the incremental reads, summaries and accurate analytics status from 6.20.59 while preserving the existing page polling cadence. The live measurement of 6.20.59 identified unnecessary extra API requests from faster analytics polling; that cadence change is removed.

# myTS 6.20.59

- Trace spatial changes have a per-game revision journal. Both dashboard and Trace data paths merge only changed games; generation changes and reconnects still require a full snapshot. Unchanged heatmaps do not invalidate the dataset. Player-stat and spatial calculations are unchanged.
- Transactional summaries retain analytics coverage and directory counts. Indexed lookups replace broad error scans. Initial schema v6 migration builds these summaries once; subsequent source writes maintain them.
- Trace status separates game publication from pending/error analytics. Background analytics progress remains visible between individual job runs.
- Trace catalogs skip unchanged game/player data; TeamSnap resource and team records write only when their content changes. TeamSnap/GotSport GET requests support ETag/Last-Modified validation when supplied by the provider, with an evictable memory cache and normal full-fetch fallback. Trace's existing GraphQL catalog has no verified incremental cursor; historical corrections are still checked.
- No app-imposed daily pauses or new usage caps. Existing retries, leases and provider-error handling remain.

Validation: randomized SQL lifecycle tests compare summaries to source tables through inserts, updates, deletes, repeated migration and rollback. Client/server tests cover delta merges, stale cursors, generation fallback and conditional-response credential isolation. Production hourly usage comparison follows deployment; migration costs are reported separately.

# myTS 6.20.58

Includes removal of all app-imposed daily usage pauses. Corrects manifest queue triggers to use explicit ON CONFLICT DO NOTHING so repeated catalog upserts preserve existing manifests without duplicate-key errors. Schema v5 replaces both triggers transactionally.

# myTS 6.20.57

Removes app-imposed D1 read/write pauses, the Trace daily request cap, and the directory daily write cap. Existing midnight pause alarms resume on the next scheduled wake. Usage diagnostics, hourly accounting, normal job scheduling, leases, and service-error retries remain. No player-stat calculation changes.

# myTS 6.20.56

Owner Settings includes Compare D1 queries, an on-demand read-only comparison of the previous Trace manifest scan and current indexed queue. It exports each statement's actual D1 metadata and selected game, using one batch and retry timestamp. The baseline treats newly introduced pending rows as absent, matching their earlier representation. Authentication and connection lookup use the existing owner checks; query costs remain in normal D1 metering. Normal D1 usage export still performs no D1 queries. No scheduled comparison or quota override is introduced.

---

# myTS 6.20.55 (prepared for review)

Trace manifest discovery uses an indexed pending/error queue in the existing analytics table. Catalog inserts and status changes enqueue missing manifests transactionally through SQLite triggers. Migration seeds existing eligible games once and preserves existing manifests and retry timestamps. The scheduler and processor share the same due query, retaining newest-game priority and eligibility rules. Completed manifests leave the partial index.

Tradeoff: one pending manifest row per newly eligible game plus queue index maintenance. Saved player stats and calculation code are unchanged. Budget thresholds and the existing pause are unchanged. This package has not been deployed; production read/write savings require an active workload measurement after approval.

---

# myTS 6.20.54

Trace's stale game recovery now uses a partial index over preparing games. This keeps the same recovery rule while avoiding a scan of every game for the team on each recovery check. The index adds a small write cost when a game's preparation status changes. Existing statistics and the background budget are unchanged. Background savings need measurement after background jobs resume.

---

# myTS 6.20.53

The combined dashboard endpoint now accepts the already loaded Trace data cursor and returns fresh status without reading the saved matches and heatmaps when the cursor matches. First loads and changed data still fetch full rows, and a concurrent cache change triggers a full Trace read. This extends the 6.20.52 cache invalidation to normal dashboard navigation.

---

# myTS 6.20.52

Trace refreshes now invalidate the data cursor when a game manifest is saved, a Trace connection is reset, or a new import generation is published. This keeps cached player positions current while avoiding unchanged full dataset reads. D1 usage export and all 6.20.51 behavior remain.

---

# myTS 6.20.51

Trace data refreshes reuse the already loaded player and game rows while the existing data revision is unchanged. A changed revision or first load fetches the full saved data. Settings now offers a D1 usage download backed by the existing D1-free owner diagnostics; the full sync diagnostics remains available. No player stats or calculation rules change.

---

# myTS 6.20.50

Owner diagnostics now include the last 24 hourly D1 usage buckets by runtime, table and app version, together with the shared app budget. They reuse query metadata and Durable Object checkpoints, without running additional D1 queries. Hourly buckets survive the UTC daily usage reset. This release changes monitoring only; app behavior, player stats, database SQL and quota thresholds are unchanged.

---

# myTS 6.20.49

The schedule date highlight follows a drag and uses a more visible color in all three themes. Calendar month arrows and swipes share one horizontal transition. The lineup editor keeps position targets faintly dashed until the actual drop target is highlighted. The fixture stats indicator allows the existing full-card click target to open the game. Player statistics and D1 logic are unchanged.

---

# myTS 6.20.48

This release reports 6.20.48 in `package.json`, the Worker version, and the embedded page version. Trace checks the next analytics job against its remaining daily request budget before choosing a fast background interval. A job that cannot run until the budget resets no longer causes two-second polling. Recovery uses the existing stale-job checks. Player stats and calculations are unchanged. The sections below retain earlier release notes.

---

# myTS 6.20.36

## Lineup and analytics updates

The lineup editor keeps Edit, Save, Cancel, and Reset inside the pitch corner. A player's disc and its position target share one pitch coordinate, independent of the name label beneath the disc. Press and hold a player, drag to any of the 22 position targets or another player to swap, then release. Dragging to the substitutes area moves a player there. Keyboard users can select a player and activate a target or use arrow keys.

Changing the team in match analytics keeps the existing stats visible while the new team's stats load. The selector and stats remain mounted, avoiding a collapse of the page during the request.

At this release, the Worker and package reported 6.20.36. Startup, position validation, and simulated pointer interactions were checked locally; authenticated browser layout and physical touch behavior still required a live check.

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
