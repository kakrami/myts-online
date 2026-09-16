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
