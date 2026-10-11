# Original frontend → fresh API contract

Status: implementation design, not a verification result. This document complements `acceptance-baseline.md` and `domain-contract.md`; it does not change production code or authorize a new visual design. Resource names below define response/action contracts, not a mandatory URL scheme or a second compatibility API.

## 1. Preserve appearance; replace data ownership

Use the original 6.20.133 HTML/CSS and render functions as the UI reference. Extract the shell, relevant markup, style tokens, and interaction patterns; reconnect them to canonical server projections. Do not import the embedded application's client snapshots, IndexedDB/localStorage data cache, provider polling/scheduling, identity resolvers, correction engine, migrations, or old dataset readers. Small local preferences and navigation state are permitted; provider payloads and derived season data are server-owned.

| Original reference in `release-inspection/source/worker.js` | Preserve as UI reference | Replace behind it |
| --- | --- | --- |
| Primary-nav markup, `setSelectors`, `pageHead` | Five tabs, grouped My team/Followed teams pickers, season picker, search/Settings icons, compact headings | Bootstrap/context models and typed navigation state |
| `renderOverview`, `overviewStandingHtml` | Season-summary card, next event, latest result, standing, performance leaders | Server aggregates and canonical event/player IDs |
| `renderMatches`, `bindScheduleDates`, `scheduleCalendarCarousel`, `matchRowHtml` | Day/Season switch, calendar/date navigation, filters, swipe animation, compact shared rows | Bounded schedule/day/month models; no client-wide season array |
| `renderTournaments`, `competitionIdentityHtml` | Competition cards, Matches/Standings tabs, own/all-team controls, period controls | Competition/category models with completeness and stable source links |
| `renderTeam`, `teamRowsHtml`, `teamTotalsHtml`, `teamTrophiesHtml` | Searchable sortable statistics table, totals, Roster/Trophies switch, trophy cards | Canonical roster statistics and trophy models |
| `openMatch`, `matchHero`, `detailFacts` | Existing match header and Overview/Coach/Players/H2H/Attendance tabs; bookmark in header | Match capabilities and separately loaded tab models |
| `openPlayerPanel`, `playerHeroHtml`, `playerOverview`, `openMatchPlayers` | Overview/Matches/Attendance tabs, profile metrics, match-player swipe carousel | Player profile, season aggregates, match log, selection-bound navigation |
| `lineupPitchMarkings`, `lineupPlayerMarker`, `openMatchEditor` | Pitch geometry, player discs, contribution icons, inline edit, tap/drag and bench interaction | Server effective lineup plus a bounded local draft and CAS command |
| `analyticsStatsHtml`, `playerAnalyticsHtml`, `analyticsPitch`, `heatmapCard` | Comparison bars, heat/spatial maps, native statistic cards, unavailable states | Validated server analytics and explicit readiness/provenance |
| `mountCoachPanel`, `mountCoachPlayer` | Coach tab, profile location, pitch/bench and existing clock/correction controls | Owner-only session/profile models and command revisions |
| `renderReports`, `renderReportDetail`, `reportPreview` | Settings entry, four report choices, preview table, Excel/PDF buttons | Full-selection report/export snapshot and server sort |
| `renderAccountBody`, `openSourceDetails`, Trace/login forms | Compact preferences/source Manage rows, one-time connection flow, diagnostics/footer | Account/discovery/lifecycle models, typed recovery actions |

Retain original CSS variables and class families: `.primary-nav`, `.compact-page-head`, `.table`/`.team-table`, `.entity`/`.entity-tabs`, `.player-carousel-body`, `.squad-pitch`, `.schedule-day-surface`, `.match-hero`, `.profile-metrics`, `.account-sources`, `.report-grid`. Consolidate obsolete/conflicting rules while preserving rendered geometry and breakpoints. No new framework, dashboard layout, navigation vocabulary, or giant generic Settings form is required.

## 2. Common read contract

Every team read carries an authorized, normalized selection and server revisions. The client constructs requests from captured context, never from mutable globals after an `await`.

```ts
type Selection = {
  team_id: string;
  team_season_id?: string;
  timezone: string;
  include_rules_revision?: number;
  // Route-specific validated date/type/period/search/sort fields follow.
};
type ReadEnvelope<T> = {
  selection: Selection;
  selection_key: string;
  revision: { content: number; status: number; config: number };
  generated_at: string;
  coverage: Array<{
    provider: string; component: string;
    state: "uncollected" | "partial" | "complete" | "unsupported";
    last_saved_at: string | null; last_complete_at: string | null;
    warning?: string;
  }>;
  data: T;
};
type Page<T> = {
  items: T[];
  next_cursor: string | null;
  total: number;
};
```

`selection_key` is derived server-side from normalized filters/sort/scope. Revisions are monotonic opaque values; they are not timestamps or a signature of one job page. `content` covers projections, links, corrections, favorites, branding, and published analysis; `status` covers all affected jobs/errors/blocked states; `config` covers context/season/preferences. Bootstrap separately carries account-discovery/team-list revisions.

Canonical IDs are opaque app IDs. A native provider ID appears only in a source reference or owner evidence view; UI navigation never derives app identity by splitting that ID. A linked source row is not an additional roster/event item.

Numbers remain numeric; presentation formats them. `null` means unavailable or unresolved and is never converted to a false zero. A source-confirmed zero is `0`. A date-only event uses `local_day` with `starts_at:null` and `time_pending:true`; it never receives invented midnight kickoff. Text/URLs/images are validated server-side and escaped at render boundaries.

The server returns permitted capabilities such as `can_edit`, `has_attendance`, `has_players`, `has_h2h`, `can_bookmark`, and `can_coach`. These choose existing controls/tabs; they do not replace route authorization. Viewer envelopes omit private Coach/account/auth data, not merely hide its controls.

## 3. Screen → server reads/actions

| Screen/workflow | Required read model | Actions and boundaries |
| --- | --- | --- |
| Bootstrap/header | Version; session role/state; authorized team contexts grouped My team/Followed teams; each context's name/logo/seasons/timezone; safe preferences; selected valid context; read/discovery revisions | Select context locally, then fetch its read model. Empty installation can discover accounts before a team exists. Owner config is not returned to shared viewers. |
| Owner/provider connection | Owner setup state; provider account name/auth state; one-time TeamSnap application field when needed; authenticated source-team candidates with source season, logo, entitlement, attachment state, discovery progress | Owner session; start/complete single-use TeamSnap OAuth through established `/admin` return path; Trace send/verify code; reuse/reconnect account. Create-and-attach or attach-existing requires explicit selected candidate, app team/season, idempotency key. Do not create visible teams merely by discovering them. |
| Settings/Manage | Theme preference; Reports entry; three provider rows and safe status; selected team attachment/name; account-wide attachment summary for owner; branding/share/diagnostic affordances | Distinct rename/remove team, attach/unlink source team, reconnect/disconnect account, preferences, branding, revoke/replace share. Each destructive command previews exact scope in the familiar confirmation pattern and validates revision. No generic raw-ID creation form. |
| Overview | Complete selected-season record/goals/analyzed count; next event; latest result; current standing with provenance; four performance leaders; coverage and source state | Existing links open Schedule, Team, Competition, Match, or Player with captured context. Counts are independent of list paging. |
| Included Games/season picker | Explicit season boundaries; June/preseason default and saved override; category/competition groups and bounded individual-event choices; selection counts; include rule revision | Save/reset typed per-season inclusion rules. Server applies identical rules to Overview, Team, player summaries, applicable reports, and exports; event visibility in Schedule remains an explicit separate selector. |
| Schedule Day/Season/calendar | Selection mode/date/type/period/analyzed filter; canonical event page; full visible calendar/date-slide counts; adjacent navigable dates/seasons; context-bound cursor and total | Select day/mode/filter locally; fetch normalized selection. Load adjacent carousel panels with separate guarded requests. Date counts cover the complete visible range, including adjacent-month days. Filters execute before pagination. |
| Competitions | Paged competition cards with date/location/logo/official links/classification; category/pool identities; own/all-team/period selection; coverage | Fetch a selected card's Matches or Standings tab separately. Preserve the original controls. Unknown format/classification remains visible; incomplete standings do not become trophies. |
| Competition Matches/Standings | Canonical/public fixtures with verified participants and conditional-slot flag; page/total; ordered published standing rows, pool IDs, explicit standing coverage | Team/match/official-source navigation; eligible bookmark action. A category's fixture list is not restricted to own-team matches unless selected. |
| Team Roster | Paged canonical players with jersey/position, effective season stats and attendance; full filtered totals; column sort/search and selection revision | Search/sort on server across all selected players; open canonical profile. Footer totals cover the complete filtered collection, not only rendered rows. |
| Team Trophies | All-season trophy groups, verified qualification/source facts, owner-recorded distinction, coverage | Open competition/season using returned identities. No trophy inferred from current first place alone. |
| Match header/Overview | Canonical event identity; perspective team/opponent and score/status; season/date/time, venue/field/address, competition; TeamSnap arrival/uniform/notes; source observations/conflicts; effective summary/lineup; tab capabilities | Header bookmark; team/competition navigation; inline lineup/correction; owner conflict decision. Keep public facts separate from team-private logistics in authorization. |
| Match Players/Trace detail | Linked canonical player rows, bounded unresolved evidence count, effective minutes/GK/goals/assists/start/half positions, contribution timeline, coverage/warnings; published team/opponent statistics and analytics navigation | Open player match view, choose existing team/period controls, load bounded native scope. Owner identity review/corrections are typed commands, not direct edits to source payloads. |
| Match H2H/Attendance | H2H canonical games with orientation/full aggregate/coverage; attendance player rows and Yes/No/Maybe/NR totals for this event | Read-only navigation; owner attendance corrections only if a supported original action exists. Do not treat source failure as all NR or zero attendance. |
| Player Overview/Matches/Attendance | Stable canonical person and team-season membership; effective jersey/position; complete season statistics/spatial summary; canonical match log page; completed-event attendance page/totals | Existing tabs; edit season fields; open match player; selection-bound previous/next IDs. One linked person has one profile. |
| Match-player carousel | One canonical player in one match; summary/manual/native stats and spatial maps; period availability; ordered canonical roster IDs plus previous/next within the originating selection | Swipe/previous/next locally; load neighboring bounded models. Keep tab/scroll per player; no rebuild of the whole season to move one slide. |
| Inline corrections/lineup | Current effective values, original/default values, value provenance, correction revision, legal format/slots, typed reset options; roster and half membership | Save match/half/player/season overrides with expected revision; explicit reset/delete override. Restore source does not delete source observations. Save response returns canonical target ID and fresh revisions. |
| Coach/profile | Owner-only canonical roster; current profile or eligible carry-forward default; availability; format/half length; field/bench; session phase/clock timestamps; targets/minutes; suggestions/reasons; timeline; CAS revision | Create, lineup change, substitute, start/pause/resume/halftime/end, reviewed suggestion, clock/minute/late-substitution correction. Clock rendering is local from saved timestamps; no tick writes. Nothing from this model appears in viewer bootstrap/reads/files. |
| Bookmarks/search/follows | Bookmarked canonical/public game pages across seasons; followed source teams; selected team/period; source coverage; public search candidates | Save/remove confirmed game; follow/unfollow public team; browse followed context. Preserve compact row marker/header toggle. Saved-data retention and background subscriptions are server responsibilities. |
| Reports | Report type/columns; complete-selection summary; row page; report scope and fixed revision; selection/sort | Select Season summary/Schedule/Players/Attendance; sort; create/download complete Excel/PDF snapshot. Preview and export share projection, filters, corrections, and order. |
| Trace data/evidence files | Owner-only current file contract/schema/build version; export/import manifest, team scope, segment counts/hashes, progress and validation errors | Export/import current-release dataset/evidence through bounded resumable commands. Verify all segments before publishing a dataset. No 6.x file readers; evidence import does not silently replace reviewed identities/overrides. |
| Branding/share/diagnostics | Shared club logo override/default; season kits; viewer link capability/revocation state; bounded redacted job/source/query-usage diagnostics | Save/reset logo/kits; copy/replace link; download diagnostics. Do not return raw provider secrets or account config to viewers. |
| Sync/recovery | Full scope summary, complete per-provider component coverage, required action, safe reason, last attempt/retrieved/saved/complete, next due; optionally paged job details | Retry eligible work, reconnect auth, or show verification/unsupported scope. Browser refresh only reads revisions/data. Source execution continues independently with the browser closed. |

## 4. Shared effective data shapes

**EventRow** supplies every Schedule/Competition/Bookmark/H2H row: canonical `id`, `kind`, `status`, perspective/participant IDs and names/logos, oriented score or null, start instant/local day/time pending, venue/round/competition reference, bookmark/stats availability, conditional/unresolved/conflict flags, safe source labels. `record_eligible` and the reason for exclusion are explicit. Row height and action gutter follow the original markup.

**PlayerSeasonRow** supplies Team, player summary, leader cards, and Players report: canonical player ID, membership ID, display name, jersey, effective position; `apps`, `starts`, `minutes`, `goals`, `assists`, `ga`, `ga_per_60`; attendance `{yes,no,maybe,no_response,total,yes_pct}`; analysis coverage. A filtered footer sums the full selected row set and recomputes G+A/60 from total contributions/minutes, rather than averaging player ratios. Unavailable attendance has null percentage, not zero.

**MatchLineup** contains effective format/halves, roster memberships, per-half starting/bench/position/slot assignments, player identity, jersey, contribution icons, manual/inferred/source provenance, and revision. Accepted priority is manual match/half override, then valid match heat/spatial evidence, then season fallback, then explicit unresolved state. Coach manual position ratings serve Coach suggestions; they do not secretly rewrite historical analytics. Format uncertainty is shown rather than silently selecting 5v5/11v11.

**TraceScope** contains canonical event/player/team IDs and native source references, period (`full`, first/second half or supported native scope), readiness (`pending`, `ready`, `restricted`, `unpublished`, `failed`, `unresolved_identity`), input revision, warnings, and separated `published` versus `estimated` metrics. Heat data gives normalized grid dimensions/values, pitch orientation, average position, thirds, tracked distance, units, and availability. Event maps give normalized points and optional pass destinations plus source total/plotted/missing-location counts. Preserve full/half pitch geometry for heat/passes/touches versus shots/box touches. A displayed missing map does not negate an available numeric statistic.

**Field provenance** is bounded to effective fields and expanded only on owner review: `{source_ref, observed_at, rule, override_revision?, conflict_id?}`. Minutes/capacity/identity warnings and unresolved tracks are preserved in analysis. Raw tracking chunks, complete source histories, and private credentials never ride along in a roster or Overview response.

**Reports** use the original columns and semantic scope:

| Report | Server values |
| --- | --- |
| Season summary | Record, goals for/against, matches analyzed, verified Trace players, minutes leader, G+A leader over the full included selection |
| Schedule | Date, Type, Status, Opponent, Location, Source, Competition, Score, Result, Attendance across scheduled events in the selected season; cancelled values handled explicitly |
| Players | Player, Jersey, Position, Apps, Starts, Minutes, Goals, Assists, G+A, G+A/60, Attendance from the same PlayerSeasonRow projection |
| Attendance | Player, Yes, No, Maybe, No Response, Total, Yes % across the declared completed-event attendance scope |

An original rule or formatting reference is not permission to preserve a defect. Explicitly unresolved identities/scores remain absent from authoritative totals; source-confirmed zeroes are retained; exports state the same inclusion/coverage limits as the preview.

## 5. Dates and seasons: original contract correction

The actual original `seasonYearForDate` uses month **>= June**; `scheduleDaysForSeason` spans June 1 through the next May 31. `seasonIncludesJune`/`openSeasonFilter` decide whether June preseason games contribute to season statistics. The 7.0.1 `src/services/season.js` July–June range is a behavioral deviation.

Preserve June–May as the default season identity/calendar interval: `[YYYY-06-01, nextYYYY-06-01)`. Preserve optional June inclusion as a separate statistical selection. Store explicit boundaries in `team_seasons` so provider labels do not silently redefine them. Any intentional alternative season policy requires a documented user-facing reason before implementation. Apply team timezone to instants and local calendar boundaries; keep date-only values unchanged. Calendar range, source attachment season, statistics, Coach profile season, filters, reports, and exports use this one policy.

## 6. Navigation, revision, and request ownership

- **Navigation state owns** selected app/followed context, season, top-level view, view filters/sort, detail route/tab, carousel selection, scroll/focus return point. Back stack stores typed route/selection state, not HTML snapshots. Team/season changes atomically invalidate dependent routes and unsaved edits receive the existing confirmation pattern.
- **Context state owns** current authorized team/season metadata and revision envelope. Bootstrap/discovery revisions refresh available teams even when one team already exists. Source IDs never become the selected context identity.
- **Request coordinator owns** an incrementing context generation and request keys derived from captured selection, route/tab/entity, permissions and dataset revision. Each request captures generation; abort old work on navigation and discard any late response whose generation/selection/route no longer matches. Guard data mutation, loading/error state, and final DOM commit, not only rendering. An aborted request is not an error toast.
- **View state owns** bounded visible rows/nearby panels, local sort/filter controls, expansion/tab choice, loading/error and local drafts. Cache keys include authorization scope, team, season, entity, selection, and content revision. Keep a bounded transient cache; invalidate by revision and clear on session/scope changes.
- **Editor state owns** unsaved form/pitch draft and expected server revision. Background reads update freshness without overwriting the draft. A 409 conflict offers reload/review and retains the draft for comparison; it never retries a mutation blindly.
- **Refresh coordinator owns** presentation refresh. Read full-scope content/status/config revisions and account-discovery revision, then refetch affected visible models, including an open status/detail sheet. Keep background source execution outside the browser. Loss of session/network is visible and recoverable; no swallowed `catch {}` retaining a falsely current screen.
- **Server owns** authorization, identity resolution, source precedence, inclusion, date/season semantics, aggregate math, correction validation, projection revisions, job scheduling and persistence. Client helpers only format and render these results.

Writes capture context/entity/revision and use idempotency for creation/import/connection commands. A command finishing after navigation may update the relevant cache/revision, but may not change the currently selected team or open an unrelated detail. Private Coach has its own session revision and input timestamp clock; it participates in guarded reads without exposing its content to other scopes.

## 7. Bounded pagination, previews, and exports

1. Authorize and resolve canonical entities, then apply season/date/type/inclusion/search/sort before aggregates and paging. Every page reports total and stable `next_cursor`; append a continuation to the existing view rather than replacing it invisibly.
2. Overview and footer/report summary read full-selection server aggregates. No statistic is calculated from the first 100 events, players, competitions, or the first 40 jobs.
3. Keyset order includes a unique canonical ID tie-breaker. The cursor is selection/scope/sort/revision-bound and opaque. A changed dataset returns a typed restart response, never a continuation over a different selection. Restart preserves route/filter/scroll intent and visibly reloads the collection.
4. Calendar reads return bounded day counts for the entire visible grid/slide range plus paged rows for the selected day/season filter. Swiping does not download every season or create one server read per clock tick.
5. Detail tabs load independently; prefetch only neighboring carousel entries. Native analytics and evidence paginate by component/period/segment rather than sending a team-wide JSON blob. Missing/partial sections retain independently valid sections.
6. A report/export creates a fixed projection snapshot or reads versioned rows. The export freezes selection, sort, permissions, correction/input revision, columns, and complete row set. Paging mutable live tables with a revision label is not a snapshot. Generate large files through resumable bounded export work with progress/download status in the existing Reports view.
7. Small complete files can be generated directly. Excel and downloadable PDF must use the same frozen rows/order as preview; browser print is not an unexplained replacement for the original PDF export. Dataset/evidence manifests enumerate every segment/hash and reject missing/mismatched segments.
8. A legitimate response too large for the contract is segmented or reported explicitly; there is no silent truncation, fixed client loop limit pretending completeness, or "100+" aggregate substituted for complete totals.

## 8. Plain module boundaries

Use native ES modules and the existing DOM/template approach. These boundaries define responsibilities; filenames can follow repository conventions and do not mandate an excessive one-file-per-function split.

| Boundary | Responsibility |
| --- | --- |
| Bootstrap/auth | Session and provider return validation, empty-install connection flow, shell startup; no provider secrets stored as browser app data |
| API/request coordinator | Transport, captured selection/generation, cancellation, typed errors, cursor validation/restart, safe downloads |
| Context/navigation | Authorized teams/seasons, typed Back routes, tabs/filters, focus/scroll restore, discovery and scope revisions |
| Read cache/refresh | Bounded revision-keyed models, visible-view refresh, auth/network recovery; no scheduling source jobs |
| Shared presentation | Original row/header/cards/pickers/tables/bookmark controls, escaping, timezone/number formatting and style tokens |
| Overview/Schedule/Competitions | Preserve respective original render composition and guarded model subscriptions; shared EventRow rendering |
| Team/Player/Reports | Shared PlayerSeasonRow/statistic definitions, profile and report tabs, sorting/search/export scope |
| Match/analytics | Existing detail tab composition, bounded TraceScope reads, spatial rendering and player carousel; no client identity or minute engine |
| Editors/Coach | Inline drafts, pitch input/cleanup, typed correction and Coach commands, revisions/timestamp display; no direct source writes |
| Settings/connections/files | Familiar source Manage sheets, selection/lifecycle actions, branding/share/diagnostics/current-format import/export |

Validation pairs the original screenshots/markup reference with acceptance checks from `acceptance-baseline.md`. All 31 gates map to these reads/actions: frontend similarity alone cannot pass missing reports, inaccurate totals, broken attachment, or production background work. Live provider/private authentication and Cloudflare browser-closed results must be recorded separately from this design contract and from mocked/local checks.
