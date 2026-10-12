# myTS original-to-rebuild parity review

Read-only evidence review, 12 October 2026. This expands the existing 31 acceptance gates into concrete original behavior, rebuilt source evidence and remaining checks. It is not a release acceptance receipt. Current author changes are still in progress, so new lifecycle code must be re-reviewed at freeze.

## Baseline provenance

- Original accepted UI/runtime baseline: myTS **6.20.133**, repository commit **50e1be224806ff7e7c439d26e15fd0421e3f6f01**, tree **30b40dd7ff3026c054d3794234b87fc300256445**. The GitHub branch/tree was read directly; the four local baseline files were checked against exact Git blob IDs and byte lengths. No reconstructed mockup was used as baseline.
- [Pinned original source](https://github.com/kakrami/myts-online/blob/50e1be224806ff7e7c439d26e15fd0421e3f6f01/worker.js). Original frontend is the embedded APP_HTML string; named functions and extracted HTML line numbers below identify its behavior. Backend engine line numbers refer to worker.js itself.
- Original worker.js: 1,421,481 bytes, Git blob bd2d055483abae37ddae2680ec62f6282da6680c, SHA-256 d6caed6b5f5fb7083a5f8af1c7474f72df52a1c4df315888833993ce4b2fdd1b.
- Deployed rebuild baseline: **7.1.4**, public source/deploy commit **6326162d923aae5c2f2bfe109dfad6dc3b28d687**, exact tree **e4128fe70f57304643add840921142690bc18741**. Active repair worktree is not yet a frozen release.
- Existing docs/acceptance-baseline.md compares original against unfinished 7.0.1. Its old gap column must not be mistaken for current 7.1.4 behavior. docs/verification.md is historical 7.1.0 evidence; deployment-verification.md records later limited results. This review explicitly rechecked the differences highlighted below.

## Verified decisions and source messages

- User’s rebuild direction (private project consultation; original-source anchors below): preserve features, coherent shared records, resumable jobs, accurate status, compact mobile interface, complete flows and one reviewed package.
- User’s frontend constraint (private project consultation; original-source anchors below): do not deviate much from the existing frontend unless necessary.
- Full agreed feature/architecture plan (private project consultation; original-source anchors below): complete frontend workflows, identity, reconciliation, jobs, complete queries, participation and privacy.
- Direct original Astra review (private project consultation; original-source anchors below): continuing connection across observed/future seasons, explicit scope, genuine zero-season, durable collection admission, native-key guard, preserved corrections, bounded reconciliation and safe exact upgrade. This is consultation evidence, not separate user authorization. It also says the original season algorithm had not been specified down to all implementation details.
- User: July–May regular season, June preseason (private project consultation; original-source anchors below); user: preseason toggle includes June (private project consultation; original-source anchors below).

## Prioritized confirmed discrepancies

1. **Connection/season lifecycle:** 7.1.4 requires an onboarding season year and only creates one season through the ordinary flow. Multi-year fetched history cannot automatically produce other selectable seasons. The active repair must solve root intent, collection admission, evidence routing and recurring work together.
2. **Participation analysis changed:** the original active Trace engine allocates evidence-backed estimated participation using playing windows/capacity and goalkeeper evidence. The rebuild currently reports visible tracked duration and leaves starts/role minutes mostly unset. This affects roster/player/leader/report numbers throughout the product. Preserve useful inference with explicit provenance and corrected identity safeguards, rather than reinstate unsafe assumptions.
3. **Match content omitted:** original goal timeline, match leaders and parts of the Players table are absent. H2H lost range controls, refresh, summary and upcoming presentation.
4. **Competition workflow differs:** original inline card Matches/Standings interactions became detail-sheet navigation. Standings sorting was explicitly disabled.
5. **Other visible differences:** Overview standing no longer opens competition; Trophy history groups by season instead of competition collection; Player Overview drops the original attendance summary and moves distance/attacking summary lower into the profile.
6. **Season defaults:** July–May statistics and June preseason must be restored for newly created seasons; existing saved inclusion choices must be preserved.
7. **Acceptance remains incomplete:** passing historical component tests never established actual private-provider coverage, exact original-interface parity, real production browser-closed updates or complete physical-device/Coach behavior.

These are source-backed differences, not proposals for unrelated features. Some backend deviations intentionally improve truthfulness/security and need parity decisions at the behavior level; original code is not authority to reproduce false certainty, unsafe name merges or credential handling.

## Review method and limits

Static call-path and source comparison, verified original artifact identity, direct conversation reads, and review of recorded test receipts. No new live provider import, production write, deployment, complete browser traversal or physical-phone test was performed by this reviewer. Code presence is not a passing workflow. Where no concrete gap is established, the status says represented/unverified rather than failed. Work-in-progress code may change after this review.

For acceptance, record the final build/tree/ZIP hash, data fixture or real account scope, environment, exact steps, independent expected result, actual result and receipt. Use separate labels: code reviewed, local synthetic pass, local real-source pass, production pass, failed, blocked/unverified. Rerun after final integration.

## Reconciliation with original-chat full-scope audit

Full original Sol/Ultra 31-gate audit (private project consultation; original-source anchors below) was read completely (no omitted content). Baseline commit/tree/blob agree exactly. Its additional source findings have been incorporated below; independently checked additions are marked accordingly, and remaining browser/source checks retain their limits.

The most consequential additions to the first review are: ordinary Coach tab rejected by API; incorrect/incomplete Settings Manage rows and theme rerender; June Reset mismatch; one-season/prepopulated-graph file flow instead of portable full history; attendance limited to completed games, omitting practices and past scheduled events; missing password-rotation control; Overview shortcuts retaining Day mode; calendar event-kind mismatch; and historical trophy navigation losing its season. These are still within the original product contract.

The coordinated sequence is: (1) finish lifecycle and preserve installation, (2) original screen/navigation behavior, (3) effective history/analysis/attendance/lineup, (4) complete Coach and portable history/files, (5) one frozen 31-gate candidate and package, (6) separately reviewed production/provider/physical-device closure. The current lifecycle author retains file ownership. No additional writer should touch overlapping controllers/routes/domain/schema until the exact candidate and ownership map are handed over. Consultation is advice and does not authorize deployment or credential actions.

## Concrete 31-gate map


### 1. Shell and navigation

**Original evidence:** 6.20.133 APP_HTML: navigation shell; initializeUiHistory:2456, openEntity:2461, navigateView:2471, bindCommon:2475. Original views are Overview, Schedule, Competitions, Team and Bookmarks; reports are reached through Settings.

**Rebuilt evidence:** web/ui-original/shell.js; web/ui-original/interactions.js; web/app/main.js. Original primary CSS block (114,632 characters) is present verbatim inside original.css, but reconstructed markup and controllers are not identical.

**Current review:** Code present; visual and interaction parity not accepted merely by copied CSS.

**Acceptance checks:**

- Compare original and rebuilt populated desktop and 320/390px layouts side by side, including all themes, navigation placement, density and sheets.

- Traverse all five sections, open nested details, dismiss, Back/Forward, restore origin and scroll; confirm keyboard and focus behavior.


### 2. Team contexts

**Original evidence:** groupTeams:597, selectTeamContext:623, teamForYear:649 and setSelectors:957; original user explicitly requested preserving the established frontend. Astra final clarifies native source identity and verified continuity, rather than unsafe original name-family grouping.

**Rebuilt evidence:** application/connections.js, domain/repository.js, application/team-catalog.js, web/app/connection-flow.js. Deployed 7.1.4 created one season at team creation; only ensureSeason definition existed, with no runtime caller. New connection roots/materializer are work in progress.

**Current review:** Confirmed deployed lifecycle gap; repair in progress. Original name-based merging is not a security/identity requirement.

**Acceptance checks:**

- Ordinary Add team → provider → sign-in/search → select team creates/reuses one logical team without season prompt or preseeded seasons.

- Additional-provider Manage attaches to current logical team. Same-name unrelated teams remain separate; exact native identity can reuse only an unambiguous destination.

- A source spanning several seasons yields selectable seasons; an unknown source can remain a real zero-season team with usable status and Settings.


### 3. Owner setup and TeamSnap sign-in

**Original evidence:** showLogin:2925, beginOAuth and one-time TeamSnap Client ID; original chat corrected the proposal to move Client ID into deployment configuration.

**Rebuilt evidence:** application/fresh-install.js, security, application/auth-routes.js, web/app/main.js. One-time Client ID/auth recovery code exists; final live account flow not established by synthetic tests.

**Current review:** Code present; real TeamSnap OAuth and empty-install traversal remain live acceptance gates.

**Acceptance checks:**

- Use empty database and ordinary UI only: owner setup, required Client ID once, OAuth, selection, cancel, retry and expired session.

- Returning owner login must not require reentering Client ID; credentials remain protected and URLs cannot select a different team accidentally.


### 4. Account and source management

**Original evidence:** sourceState:976, sourceHelp:1001, renderSourceDetails:1016, openSourceDetails:1024, renderAccountBody:2812, openAccount:2814; compact provider rows with Manage.

**Rebuilt evidence:** web/app/features.js and main.js; application/routes.js, sync-service.js and team-lifecycle.js. New root lifecycle and pending UI are being integrated.

**Current review:** Basic flow present; root-wide versus one-season unlink is a new explicit acceptance dependency.

**Full-scope audit reconciliation:** Independently confirmed additional gaps: feature bridge settings() maps model.providers (job providers) into Manage rows, so unavailable providers can disappear and Analysis/Projection/Live may get inappropriate Manage actions. main.js theme-cycle calls reduced settings() rather than feature settings, dropping the complete sheet controls.

**Acceptance checks:**

- Compare familiar named provider Manage sheets and statuses; distinguish account sign-in, team connection, seasonal exclusion, root unlink, account disconnect and team removal.

- Cancel or lose the connection response and retry without duplicate/orphan teams; reconnect must preserve fixed scope and existing data.

- Remove one source while another continues; stale in-flight work cannot recreate removed demand.

- Open Settings before any jobs and after mixed source/projection/analysis work; all three real providers remain available and internal jobs never get provider sign-in actions. Cycle theme while Settings is open and verify every original control remains.


### 5. TeamSnap and attendance

**Original evidence:** Active/archived team selection; eventAvailability, availabilityStatus, playerAvailability:658. Original recordForItems:659 and resultForItem:940 consumed reported scores.

**Rebuilt evidence:** sources/teamsnap.js, domain/auxiliary.js, analysis/reads.js. Current TeamSnap collector deliberately emits unknown past result/status and retains reported scores as evidence, rather than asserting a result; this is a behavior difference requiring source-backed validation.

**Current review:** Attendance code present; active/archived real collection unverified. Score semantics differ and should not be blindly reverted.

**Acceptance checks:**

- Connect current and archived native teams to one intended logical team; verify full events, roster and historical scope.

- Yes, No, Maybe, NR, missing and conflicting attendance retain distinct meaning in event/player/report views, including practices.

- Compare real completed TeamSnap score/status evidence with displayed season record; establish accepted authority and visible uncertainty.


### 6. GotSport connect and discovery

**Original evidence:** connectGotSport/disconnectGotSport, openTeamSearch:1796, openBrowsedTeam:1877; public ID or public page accepted, named search/follow selection.

**Rebuilt evidence:** sources/discovery.js, sources/gotsport.js; web/app/main.js and features.js; application/routes.js.

**Current review:** Code present; final-build real discovery and recovery unverified.

**Acceptance checks:**

- Paste supported public team link or use search; choose named result and correct destination with no unexplained ID requirement.

- Invalid/ambiguous input has a usable correction; following another team does not import it into the owner’s team.

- Verify source names, links and native identity with the actual public pages.


### 7. GotSport Live identity and competitions

**Original evidence:** 6.20.133 release specifically completed Live competitions and bounded snapshot storage; original rebuild contract requires exact external identity, memberships and complete published contexts.

**Rebuilt evidence:** sources/gotsport.js, domain/identity.js, read-model/feature-reads.js; new collection admission must precede seasonal attachment but still respect required provider-native season keys.

**Current review:** Code present; collection-key/pending distinction and real current coverage unverified.

**Acceptance checks:**

- Resolve Live only by verified native/external identity. Account or catalog discovery must not connect unrelated teams.

- Discover memberships before games publish, complete categories/standings, metadata and official links; show partial coverage accurately.

- Missing native season key remains a visible collection prerequisite, never a guessed current-year key.


### 8. Trace sign-in and team selection

**Original evidence:** openTraceConnect:2849, renderTraceCandidates:2850, traceEmailForm/traceAction; reuse authenticated account, code if needed, select candidate, reconnect and Check for updates.

**Rebuilt evidence:** sources/trace.js, security, application/auth-routes.js, web/app/main.js. Candidate selection is integrated with ongoing command/zero-season repair.

**Current review:** Ordinary flow represented; real code delivery, entitlements and full multi-year retrieval unverified.

**Acceptance checks:**

- Real existing-account reuse and email-code flow; invalid/expired code, no eligible teams, cancellation and retry.

- Select a persistent multi-year Trace identity and connect additional provider to the same logical team without duplicate contexts.

- Reconnect resumes saved checkpoints; account discovery alone cannot attach every candidate.


### 9. Overview

**Original evidence:** renderOverview:1386, recordForItems:659, overviewStandingHtml:1330, topPlayers. Original standing card opens its competition standings.

**Rebuilt evidence:** web/ui-original/screens.js:12–20; read-model/repository.js and feature-reads.js. Record, latest result, next event and leaders exist. Current standing card only prints competition name/position/points/played, with no competition action.

**Current review:** Confirmed missing standing navigation; full totals and visual placement need parity proof.

**Full-scope audit reconciliation:** Independently confirmed: main.js nav action applies filter/period but does not set schedule mode. Overview Full schedule, All results and Analyzed shortcuts can retain Day mode and silently show only one date.

**Acceptance checks:**

- Use >100 completed games and independently compute record, goals, latest result and leaders for the exact inclusion set.

- Open standing directly to the original competition/Standings context; all-results/full-schedule/leader links retain scope.

- Unknown scores or statistics stay distinguishable from zero.

- From Day mode, use every Overview schedule shortcut; verify correct season-wide scope and visible filter, plus standing/bracket navigation.


### 10. Seasons and included games

**Original evidence:** openSeasonFilter:687, seasonStatItems:680, setSelectors:957. Direct user: regular season July–May, June preseason; inclusion switch includes June.

**Rebuilt evidence:** application/inclusion.js and team-features.js; read-model/inclusion.js; new connection-materializer.js. 7.1.4 lacked reachable automatic new seasons and helpers defaulted include_june=1; new materializer currently inserts 0.

**Current review:** Confirmed deployed gap and default mismatch; active repair requires complete lifecycle tests.

**Full-scope audit reconciliation:** Independently confirmed Reset regression: application/inclusion.js:82 sets include_june=1 and returns true; features.js Reset copy explicitly says include June. Original Reset excludes June. New-season default repair alone does not fix Reset.

**Acceptance checks:**

- Preserve saved June choices; default a newly evidenced season to July–May statistics while displaying June as preseason in its June–May container.

- Toggle June, competition/category and individual game; all overview/player/roster/report calculations share saved inclusion.

- Import historical/future dates, timezone May31/June1 boundaries and owner date corrections; do not invent dates or copy undated events to every season.

- Reset inclusion and verify June returns excluded, ordinary competition/game inheritance is restored, and cancelling Reset preserves the current draft.


### 11. Schedule and filters

**Original evidence:** schedule content:1643, bindScheduleSeasonButtons:1723, bindScheduleDates:1724, renderMatches:1734, openScheduleCalendar:1744; Day/Season, Today/calendar, All/Games/Practices/Analyzed and Past/Upcoming.

**Rebuilt evidence:** web/ui-original/screens.js:21–31, web/app/main.js; read-model/repository.js and feature-reads.js.

**Current review:** Controls largely represented; exact touch, timezone, boundary and recovery behavior unverified.

**Full-scope audit reconciliation:** Independently confirmed calendar contract mismatch: ReadRepository.calendar returns day,total only while dateStrip eventDots expects kinds for distinct game/practice dots. main.js schedule-mode changes only mode, retaining hidden type/period filters; source consultation additionally identifies season-crossing clamp and missing transitions, pending independent browser verification.

**Acceptance checks:**

- Compare original Day and Season controls and animations; traverse date strip/calendar, Today, adjacent month and available season boundaries.

- Filters operate over complete selected data rather than current page; pending/no-season state has an honest empty/progress view.

- Open row, Back to same date/filter/scroll; verified cross-provider duplicates display once.

- Switch Season-filtered view to Day and ensure hidden filters cannot suppress events; calendar/date strip distinguishes games and practices. Cross June boundary through calendar and use adjacent-season controls without clamping to the previous season.


### 12. Match detail and logistics

**Original evidence:** openMatch:2660; contributors:2679, playerRows:2680, goalRows:2681, Overview composition:2684. Original tabs depend on capabilities and include Overview/Coach/Players/H2H/Attendance.

**Rebuilt evidence:** web/ui-original/screens.js matchDetail/statsTable (about 62–74); web/app/detail-features.js. Main tabs/logistics exist. Original goals timeline and match leaders are absent; Players table lacks Start and Attacking% and replaces original richer identity/edited indicators. H2H has separate gaps below.

**Current review:** Confirmed omitted content and changed Players table, not just unverified styling.

**Full-scope audit reconciliation:** Independently confirmed hard failure: detail-features.openDetail requests tab=coach before rendering; FeatureReads.match:232 only accepts overview/players/attendance/h2h. Thus the visible Coach tab is unreachable. Match header/rendering also omits row-level identity/result conflict banners.

**Acceptance checks:**

- Restore source-backed goal minute/scorer/assist/running-score and leader presentation where data exists, with explicit incomplete evidence.

- Compare original Players columns, jersey/position/edited markers and sort/navigation behavior.

- Verify score/status, uniform, arrival, venue, notes, source links and bookmark placement for connected/public games; conditional slots are not confirmed games.

- Open Coach through its ordinary match tab and finish a real complete workflow; opening a conflicted schedule row must retain the conflict warning and source context in the detail sheet.


### 13. Unified match identity

**Original evidence:** canonicalMatchItems, resolveMatchItem; original rebuild requires one coherent game when proof exists, while contradictions and doubleheaders remain distinct.

**Rebuilt evidence:** domain/identity.js, domain/repository.js, application/identity-routes.js; new team_event_season_resolutions and connection_event_resolutions.

**Current review:** Identity model represented; new unique season membership adds merge/unmerge and stale-resolution review requirements.

**Full-scope audit reconciliation:** Independent renderer check: presentation.matchRow shows Possible duplicate/Conflicting results; screens.matchDetail/matchHeader do not show equivalent warnings.

**Acceptance checks:**

- Proven TS/Trace/public counterpart, doubleheader, reschedule, timezone boundary and conflicting opponent/score.

- Never merge by names/time alone; source corrections do not erase explicit owner decisions.

- Canonical merge/unlink/relink and date reassignment leave one accepted effective date/season, no orphaned manual state or duplicate calendar game.

- Open each conflicting row, navigate tabs and return; uncertainty survives throughout details, corrections and reporting.


### 14. Competitions and H2H

**Original evidence:** renderTournaments:2062–2077 uses inline expandable cards, tabs preserving other cards and scroll; enableSortableTables:580–590 is bound after tab updates:2075. teamHeadToHeadHtml:1846 and mountMatchHeadToHead:1852–1874 provide All seasons/This season/Last year/Last 6 months, refresh, WDL/goals and upcoming meetings.

**Rebuilt evidence:** screens.js competitions/standings/detail; detail-features.js competition-tab actions replace with detail sheets. standings columns set sortable:false. H2H screen only renders game list/more although feature-reads.headToHead returns record and coverage note; original range/refresh/summary/upcoming presentation missing.

**Current review:** Confirmed interaction regressions: inline card tabs, standings sorting and H2H controls/summary.

**Full-scope audit reconciliation:** Original Sol review also identifies incomplete-schedule warning/category-division control losses. Inline-card and sorting gaps are independently confirmed; extra warning/control coverage remains to be exercised against populated original/rebuilt views.

**Acceptance checks:**

- Restore original card interaction and scroll/open-card state, own/all-team and period controls; sort every standings column.

- Exercise >1 page and multiple seasons, all-category schedules, classifications, pool/conditional slots and official links.

- H2H matches original ranges/refresh/record/goals/upcoming sections and explains incomplete history; backend pagination cannot masquerade as complete record.

- Verify category/division selection and incomplete/unpublished/stale schedule/standings explanations, not only a populated happy-path card.


### 15. Roster and season table

**Original evidence:** teamRowsHtml:2182, teamTotals:2183, renderTeam:2199; searchable/sortable Player/Apps/Starts/Min/G/A/G+A/G+A60/Attend. and total footer.

**Rebuilt evidence:** screens.js:32–40; analysis/reads.js. Table and search/totals exist, but original participation inference is not reproduced by current analysis projector. New historical roster snapshots are being integrated.

**Current review:** UI core present; numeric and historical parity not established.

**Full-scope audit reconciliation:** Independently confirmed keyword highlighting regression: rosterColumns name uses a custom render that escapeHTMLs name/jersey/position and ignores its query argument, bypassing tableHTML’s normal highlight helper.

**Acceptance checks:**

- Sort every column, search name/number/position, paginate, open players and verify full-selection totals.

- Linked TS/Trace identities make one person row; ambiguous names/numbers remain distinct.

- Historical roster/jersey/position comes from dated game or verified roster-period evidence; a current source roster must not populate every old season.

- Search name, jersey and position and confirm visible highlighting and full-result totals; clear search restores original ordering/state.


### 16. Trophies

**Original evidence:** teamTrophies:2185, trophyCollections:2194, teamTrophiesHtml:2197, bindTrophies:2198; original groups awards by competition collection, with Winner/Runner-up counts and edition/year links.

**Rebuilt evidence:** screens.js:42–46 groups awards by season and renders individual awards; feature-reads.js and feature-schema.js provide all-season owner/computed awards.

**Current review:** Confirmed presentation/grouping difference; qualification needs real-source acceptance.

**Full-scope audit reconciliation:** Independently confirmed navigation risk: historical award button supplies competition ID only, while detail path is built from current selected team/season. Trophy’s season is not carried into navigation.

**Acceptance checks:**

- Keep Team → Trophies entry and original competition-history grouping/navigation across seasons.

- Only terminal verified competition outcomes qualify; owner-recorded award is labeled.

- Upcoming/incomplete standings cannot award a trophy, and empty seasons with saved awards cannot be deleted by reconciliation.

- View old trophy while a different season is selected, open its competition and return to trophy history without wrong-season filtering.


### 17. Player detail and navigation

**Original evidence:** playerOverview:2713–2720, openPlayerPanel:2728, openMatchPlayers:2742. Overview summary includes Apps/Starts/Minutes/Goals/Assists/GA60, Tracked distance, Attacking third and Attendance; tabs and match-player carousel.

**Rebuilt evidence:** screens.js:81–86 renders six basic summary metrics. Distance/attacking exist lower in spatial.js:49–51 positionProfile, so these are moved, not wholly absent. Overview attendance metric is omitted; separate Attendance tab exists. detail-features.js binds navigation/swipes.

**Current review:** Confirmed summary placement/attendance difference; navigation code present but complete Back/scroll/touch matrix unverified.

**Full-scope audit reconciliation (corrected 2026-10-12):** AnalysisReads.player uses the statistical game selection for Attendance, omitting practices and past SCHEDULED events. Original decoded lines 657–658 and 674–682 prove that original playerAvailability also applies June and saved individual/competition/category exclusions through completedEvents → seasonStatEventIncluded; those exclusions must remain. Player log returns every selected game via left joins, and the screen labels any non-started row Appearance even with unknown participation. Sol also reports carousel ordering/animation/scroll differences pending browser proof.

**Acceptance checks:**

- Match original overview composition, including available distance/attacking/attendance summaries and truthful missing data.

- Open player from roster/match, switch tabs, browse match players, swipe previous/next and Back without losing origin.

- Stats/matches/attendance use full selected season; date moves and linked identity changes preserve profile and manual state.

- Attendance must include past, non-cancelled games/practices/other events, including past SCHEDULED events, while preserving original June and saved inclusion rules. Missing responses require event-level availability proof. Player match log must not invent an appearance from missing analysis; preserve DNP/unknown/appearance distinctions.


### 18. Trace analysis and participation inference

**Original evidence:** worker.js TraceEngine.calculateGame:511 onward, finalizeGameParticipation:707, active traceEnginePrepareWork invocation:848; original detects playing windows/format, uses bounded field capacity, GK evidence, tracked/event evidence and manual truth to estimate participation. UI mountTraceAnalytics, playerAnalyticsHtml:2543.

**Rebuilt evidence:** analysis/projector.js:90–121 sums visible tracking intervals; started, field_minutes and gk_minutes remain null unless manual; one native position accepted, otherwise unknown; format comes from lineup/manual override around :148. No equivalent original capacity-allocation/inferred-lineup engine. Native maps/comparison and scope labels exist.

**Current review:** Confirmed substantive algorithm change. Restoring useful inference must preserve uncertainty and correct original unsafe identity assumptions, not blindly copy bugs.

**Full-scope audit reconciliation:** Independently confirmed map-kind mismatch: API emits box_touches while eventMapSVG’s half-pitch branch recognizes box or shots, so box touches render using full-pitch geometry. Sol adds missing analytics cards/facts and possession timeline; compare against original source before declaring parity.

**Acceptance checks:**

- Run the same representative raw Trace inputs through original and rebuilt evidence models and explain every intended difference in minutes, starts, field/GK role and format.

- Preserve agreed capacity/playing-window estimates with explicit inferred provenance; unresolved GK/opponent/dummy identities cannot be assigned by convenience.

- Verify full/half and own/opponent stats, incomplete components, native zero vs unavailable, heatmaps, moments and correction precedence.

- Verify every map kind and native coordinate frame against a known source example, including box-touch half-pitch layout; compare analytics cards and possession timeline and visibly label estimated/imported/partial evidence.


### 19. Corrections and lineup

**Original evidence:** bindLineupDrag:2347, openMatchEditor:2388, playerEditHtml:726 and bindPlayerEdit:727; inline tap/drag starter/substitute layout, match corrections versus season defaults, restore source.

**Rebuilt evidence:** analysis/service.js, application/event-editor.js, web/app/lineup-features.js and detail-features.js. New domain/game-season-state.js moves event-scoped state under review.

**Current review:** Core correction code present; cross-season state relocation and original gesture placement require integrated acceptance.

**Full-scope audit reconciliation:** Source consultation’s missing automatic lineup agrees with independent projector review: source-derived format/starts/field-GK estimates are absent, and read-only pitch relies on manual lineup header/assignments. Heatmap-position editor promise needs full wiring verification.

**Acceptance checks:**

- Compare original edit locations and fields, tap/drag interactions, blank/inherited/explicit-null values and restore-source behavior.

- Save, refresh provider, reopen and verify precedence and totals; stale concurrent writes fail visibly.

- Move a corrected game across season with match analysis overrides, track assignments, lineup, Coach and bookmarks intact; retain true player-season defaults/kits/inclusion where intended; collisions retain data and require review.

- Before any manual edits, open a well-evidenced analyzed match and verify original effective formation/lineup with uncertainty labels. Exercise Use match heatmap and Restore source through actual API/UI.


### 20. Cross-provider player links

**Original evidence:** traceIdentityIndex, matchPlayer, teamIdentityNote; original goal is one person with source observations, not duplicates.

**Rebuilt evidence:** domain/identity.js, application/identity-routes.js, web/app/identity-features.js; new historical roster evidence and canonical projection.

**Current review:** Explicit link model present; actual identities and every UI gesture unverified.

**Acceptance checks:**

- Link known person and confirm one roster/profile/Coach identity with both sources and season-qualified data.

- Unlink/relink, duplicate jersey/name and cross-team/account rejection; no implicit name merge.

- Changing canonical identity dirties every affected connection and season without losing dated evidence or corrections.


### 21. Coach

**Original evidence:** mountCoachPlayer:2614–2616, coachClock:2619, coachRecommendations:2623, coachSuggestedField:2626, Coach workspace:2638; match tab, player attributes, 7v7/9v9, availability, suggestions, substitution timeline and timestamp clock.

**Rebuilt evidence:** coaching/service.js and runtime; web/app/coach-features.js; forms.js. Earlier-season profile inheritance exists in service.js:273–288. Current form presentation differs from original summary/Edit workflow; not yet fully compared.

**Current review:** Feature mechanics represented; full original workflow and phone-lock real-time behavior remain unverified.

**Full-scope audit reconciliation:** Independently confirmed Coach reachability failure via tab validation, as gate12. Mechanics tests bypassing the ordinary detail route cannot establish the UI workflow. Sol additionally identifies pregame reconfiguration and live recommendation/presentation differences.

**Acceptance checks:**

- Attributes inherit appropriately into later season without history leakage; compare original profile Edit/Cancel and match-plan entry.

- Confirm availability, place/drag players, start/pause/resume, substitute, halftime/end and correct late substitution; validate 9×50=450 applicable minutes.

- Lock/reopen phone, navigate away/back, concurrent edits; clock ticks cause no DB writes. Viewer cannot access any Coach/private profile data.

- Run the complete Coach path from Schedule → match → Coach, including absent existing plan, reconfigure before start, live recommendations, substitutions and locked-phone resume.


### 22. Bookmarks and follows

**Original evidence:** gameWatchButton, renderFavorites:2045, paintFavorites, openSourcePlayerStats:1469; compact row marker, all-season games and team/period filters.

**Rebuilt evidence:** screens.js bookmarks; application/team-features.js, read-model/source-team.js; web/app/features.js/detail-features.js.

**Current review:** Code present; real source omission and exact marker/nav behavior unverified.

**Full-scope audit reconciliation:** Independently confirmed markup difference: rebuilt favorite-mark lacks the original CSS-positioning attribute; actual overlap/row-height effect still needs rendered viewport proof.

**Acceptance checks:**

- Save/remove/resave confirmed completed and upcoming games from Schedule, Competitions and detail header, preserving marker density.

- Browse all seasons and team/period filters, reload, navigate followed team context and return to owned team.

- Conditional slots cannot be saved as confirmed games; source omission or season reassignment does not silently erase saved bookmark or expose wrong team.

- Measure passive bookmark marker at phone/desktop widths with and without statistics indicator and long names; ensure no score/date overlap or extra row height.


### 23. Reports and exports

**Original evidence:** renderReportDetail:2447, renderReports:2448, reportRows:2450, exportExcel:2451, exportPdf:2452; Settings → Reports, four types, sortable preview and exports matching displayed order.

**Rebuilt evidence:** reporting/service.js and encoders; web/app/reports.js; screens.js reports. Four reports and real server XLSX/PDF exist. Explicit coverage columns and immutable snapshot are intentional backend safety improvements; no missing report identified.

**Current review:** Code present; production complete-data/order/content proof remains required, not a claim that original reports are absent.

**Acceptance checks:**

- Use >one page with linked players, inclusion, June and attendance edge cases; compare independent full-season totals.

- Sort preview and export XLSX/PDF; open files and verify full row order, columns, scope, readable rendering and no silent truncation.

- While source changes, keep snapshot coherent or explicitly recapture; viewer export excludes private data.


### 24. Dataset, evidence export and tracking capture

**Original evidence:** exportTraceSourceEvidence:2818, exportUnifiedTrace:2828, openTrackingCapture:1371, bound importTrace; selective game/half/start/1–600s/1–4 observed tracks. Historical downloadPlayerDiagnostics is unbound and not a required workflow.

**Rebuilt evidence:** reporting/data-files.js, data-routes.js; domain/dataset.js/serialization.js; tracking; web/app/data-files.js/tracking-capture.js.

**Current review:** Current-release file/capture workflows represented; real private capture and pending-root import require integrated proof.

**Full-scope audit reconciliation:** Confirmed substantive scope mismatch: original exportUnifiedTrace uses familyKey and full team/family snapshot. Rebuild sourceDatasetSections requires one persisted season and exports only that season’s attached-source/event graph. validateDatasetImportScope requires the same existing season and attachments, while importedGraphQuery validates rows against an already observed graph. Thus its idempotent same-graph round trip does not prove portable missing-history restoration. Reopening artifact jobs and original Trace Manage entry points also need parity restoration.

**Acceptance checks:**

- Export/import exact supported dataset contract and prove round trip; reject old/foreign/corrupt/unauthorized input without partial source writes.

- File observations may reconcile already authorized connection scope, but import cannot grant credentials, ownership or new provider collection admission.

- Saved source evidence and raw capture are export-only; select bounded raw capture, finish with browser closed, expose partial/failed/unavailable components, and never mutate saved statistics.

- Export complete authorized team history across seasons and import current-format missing history into an explicitly selected target without fetching those records first. Preserve owner decisions and source authority; file observations do not grant credentials, account ownership, identity approval or provider collection. Resume/find completed export/import jobs through ordinary UI.


### 25. Branding and themes

**Original evidence:** cycleTheme:483, openSeasonKitsEditor:1220, clubSeasonKits, openTeamLogoEditor:2833; shared club logo, season kits, Light/Dark/Soccer Green, familiar source Manage entry.

**Rebuilt evidence:** read-model/branding.js, application/team-features.js and club-kits.js; web/app/features.js; original.css.

**Current review:** Code present; exact original entry points and full theme/device legibility unverified.

**Full-scope audit reconciliation:** Independently confirmed theme-cycle Settings loss, detailed in gate4.

**Acceptance checks:**

- Cycle all themes from familiar control, compare compact pages/sheets, focus/contrast and persistence.

- Save/reset shared club logo and named/color kits; switch team/season, reload and view shared link.

- New season derivation must not copy owner kits or season choices into unrelated historical season.

- Cycle Light/Dark/Soccer Green from full Settings and verify Manage, reports, files, identity, rename/remove, sharing and branding controls remain available as appropriate.


### 26. Viewer links and permissions

**Original evidence:** currentViewerUrl, rotateViewer, renderAccountBody:2812; read-only dashboard, copy/replace link and Coach privacy.

**Rebuilt evidence:** security; application/bootstrap.js/routes.js; web/app/main.js; pending zero-season viewer UI is in progress.

**Current review:** Security separation represented; final production and zero-season viewer behavior unverified.

**Acceptance checks:**

- Separate signed-out browser views only allowed team data; no owner controls, credentials, Coach, private fields or writes through direct APIs/exports/errors.

- Rotate link and prove old invalid/new valid. Owner cookie in explicit viewer mode remains read-only.

- Zero-season/pending team shows safe status/empty state without internal identifiers or setup demands.


### 27. Status and diagnostics

**Original evidence:** sourceState:976/sourceHelp:1001/renderSourceDetails:1016 and account actions; provider timestamps/progress, reconnect, partial/delayed reasons, sync and D1 diagnostics.

**Rebuilt evidence:** sync/coordinator.js/runtime.js; application/routes.js/sync-service.js; web/app/features.js. New root backlog, unresolved evidence and collection prerequisites must not be collapsed into one resolved flag.

**Current review:** Code present; lifecycle repair introduces additional status dimensions needing end-to-end proof.

**Full-scope audit reconciliation:** Sol review adds provider help/error DTO-renderer mismatch and missing D1 comparison. Existing usage action fetches /api/usage and prints JSON, not the original comparison workflow; exact status field mismatch needs fixture confirmation.

**Acceptance checks:**

- >40 jobs and >128 affected memberships: all relevant work and eventual progress visible; no first-page-only refresh signature.

- Separate attempted/fetched/saved/completed, collection vs projection, auth vs missing native key, uncertainty vs backlog.

- Fail/rate-limit one provider and show correct recovery while others proceed; diagnostics bounded and secret-free.

- Use expired/restricted/rate-limited/internal-error providers and compare actual renderer fields/actions; restore intended D1 comparison rather than label raw usage output equivalent.


### 28. Browser-closed processing

**Original evidence:** Original sourceHelp explicitly permits closing the window; scheduled handler and original rebuild directive require resumable independent server jobs.

**Rebuilt evidence:** sync/runtime.js/coordinator.js; Worker scheduled handler; new root reconciliation and durable pre-season collection admission. Prior fixture-native completion exists; real final deployment remains unverified.

**Current review:** Live acceptance gate still open; no health response or UI polling substitutes for proof.

**Acceptance checks:**

- Close every app tab; provider collection, new-season discovery, reconciliation and projection must advance via persisted alarms/cron/checkpoints.

- Reopen and verify changed provider data and server timestamps without browser runner/retry requests.

- Crash after commit before admission, expire lease, disconnect/unlink/delete during pages, restart and prove fencing/idempotent recovery and independent providers.


### 29. Security and lifecycle

**Original evidence:** Original owner/private/viewer responsibilities; previous implementation is not the security design authority. New backend must preserve intent while separating session/credential lifetimes.

**Rebuilt evidence:** security; auth-routes; domain/repository; exact-version installation write epoch and root/account generations under active review.

**Current review:** Core tests exist; new write gate and all runtime paths require fresh verification.

**Full-scope audit reconciliation:** Independently confirmed: owner password API exists, but frontend JS references only login/initialization password entry; no ordinary password-rotation control is wired.

**Acceptance checks:**

- Rotate owner authorization without losing encrypted provider credentials; expire/sign-out/renew sessions and safely disconnect accounts.

- Stale auth/root/team generations cannot commit source, reconciliation or projection writes.

- No token leakage in API, files, logs or package; every old-runtime writable table and mutation entry is fenced after upgrade.

- Rotate password through ordinary owner UI, prove old sessions revoked and provider jobs still decrypt credentials; sensitive credential entry/confirmation remains user-controlled in live testing.


### 30. Asynchronous and mobile recovery

**Original evidence:** currentOperation/currentDialog, selectTeamContext, captureEntityView, browser history, tab/key handlers; original competition inline state and swipe/detail contexts are relevant.

**Rebuilt evidence:** web/app/transport.js, feature-requests.js and main.js; interactions.js; controller tests. New source selection/zero-season states must fit same context epochs.

**Current review:** Selected controller/native fixture checks exist; complete physical/mobile parity remains unverified.

**Full-scope audit reconciliation:** Sol identifies absent modal focus trap/return, picker Escape and orientation cleanup. These are additional concrete review targets; not independently exercised in a browser in this pass.

**Acceptance checks:**

- Delay A response, switch to B, finish A; B remains correct across auth, source selection, details, reports and reconciliation status.

- Cancel/dismiss midflight, double-click, lose network, retry exact command, Back/Forward; preserve drafts and history without duplicate commits.

- Physical touch, orientation, keyboard/focus, reduced motion and drag cleanup; no routine year/team setup demanded at each step.

- Compare original modal/picker focus cycle, Escape, return focus and orientation interrupted drag/swipe; record physical and desktop keyboard receipts.


### 31. Fresh install, exact upgrade and package

**Original evidence:** Original user demanded clean rebuilt architecture and one complete required-files ZIP. Later current user explicitly required preserving already deployed data. Direct Astra recommends one small exact-version additive transition rather than reset or generic legacy architecture.

**Rebuilt evidence:** application/installation-schema.js, fresh-install.js, schema-upgrade.js, installation-epoch.js; release scripts. Exact 7.1.4 base; permanent write-epoch guards; bounded backfill; compatibility/maintenance rollback must be reviewed.

**Current review:** Active implementation; final artifact, schema transition and full regression gate not complete.

**Full-scope audit reconciliation:** Coordination: original Sol response a86d6f62 owns baseline/parity sequencing and requests exact lifecycle candidate plus changed-file ownership before additional writers. Current candidate auto-upgrades through alarms/cron, so deploying it is a schema action; operational activation/approval boundary must be reconciled before publication. Upgrade-pending UI currently masquerades as fresh Initialize myTS and must be corrected.

**Acceptance checks:**

- Extract exact final archive, install pinned dependencies, build and initialize brand-new DB; verify visible version/bindings/assets/cron/alarm.

- Upgrade exact deployed physical schema and fingerprint preserving setup timestamps/data; interrupted every phase resumes; unknown/partial schema fails closed; old writers remain denied.

- Review resulting exact package and hash, rerun changed/native/full suites, report every failure/not-run gate, and use only a compatible post-expansion rollback/roll-forward build.

- Freeze lifecycle candidate/file map first, reconcile remaining six work packages, then freeze one integrated artifact. Do not deploy an auto-upgrade candidate under a maintenance-only description; show truthful upgrade-pending UI and review data-preserving activation/rollback.
