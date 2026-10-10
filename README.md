# myTS 7.0.1 — clean rebuild for review

This is a new application and a new database schema. The visible version is
**7.0.1** in the header, Settings, health response, diagnostics, and exports.
Nothing has been deployed, and no production database has been changed.

The release contains the complete Worker source, browser assets, pinned build
dependencies, and this installation and verification guide. It contains no old
release, imported database, credentials, dependency directories, screenshots,
temporary files, migration scripts, or compatibility layer.

## Review update in 7.0.1

Live public-source testing found that GotSport publishes its verified Live bridge in
`event.live_event_url`, separately from the competition's marketing website. The
shared adapter now consumes that field, validates league and organizer bridge URLs,
and resolves the external team identity through the official club/season records.
An independent native competition-catalog job discovers entries even without past
matches. Relative GotSport logo URLs resolve against the provider origin, and
historical fixture names cannot overwrite a current authoritative team profile.

## Architecture

| Layer                        | Responsibility                                                              |
| ---------------------------- | --------------------------------------------------------------------------- |
| `worker.js`                  | HTTP entry, secure asset delivery, scheduled wake-up, Durable Object alarms |
| `src/api.js`, `src/routes/`  | Authentication and domain-specific API routes                               |
| `src/schema.js`, `src/db.js` | Fresh schema, shared records, bounded writes and query accounting           |
| `src/jobs.js`                | Persistent jobs, leases, atomic page commits, retry and recurrence          |
| `src/providers/`             | Validated TeamSnap, GotSport, GotSport Live and Trace contracts             |
| `src/services/`              | Analytics, Coach state transitions, season boundaries and award assessment  |
| `web/`                       | Compact responsive interface and self-contained Excel export                |

Provider records use their native identities. A team, fixture, competition,
roster membership, attendance response, standings row, or Trace component is
stored individually and shared by every dashboard that references it. There is
no growing JSON snapshot containing an entire team history. Private corrections,
viewer access and Coach sessions are scoped to a dashboard.

Connecting or following a team creates subscriptions to shared jobs. Removing
one subscription does not stop another dashboard's work. Trace credentials are
shared by the connected native team; refreshed account authorization updates
eligible connections and invalidates outdated leases.

Each job has its own cursor, scan identity, due time, lease, progress, coverage,
error and completion checkpoints. Source page records, child jobs and the next
cursor commit in one transaction behind a lease and connection revision fence.
Failed transactions and expired leases cannot advance progress. A changing or
repeated history scan restarts without erasing records already collected.

Alarms process one bounded unit of work at a time. A one-minute scheduled trigger
also wakes the runtime. Neither mechanism needs an open browser. Browser polling
only refreshes saved views. Diagnostic observations have a bounded retention
policy; expired authorization challenges, rate counters and obsolete scan audit
records are cleaned up separately from source data.

Attempt, retrieval, saved page and completed source scan are different timestamps.
A completed past-results scan does not assert that upcoming schedules are complete.
A verification page, expired authorization, rate limit, unavailable analytics
scope or incomplete evidence is reported explicitly. Other independent jobs continue.

## Features

- TeamSnap sign-in, active and archived team discovery, roster, calendar, game and
  practice filters, logistics, arrival times, uniforms and attendance. Attendance
  code `0` means No, `1` Yes, `2` Maybe; other values remain NR.
- July–June seasons, optional June preseason, local time-zone boundaries,
  month navigation and swipe, date selection, past/upcoming views and next season.
- GotSport connection, team search and follows, paginated history, verified
  external team identity resolution, GotSport Live upcoming feeds, whole-category
  schedules, pool standings, competition classification and official source links.
- Confirmed public-game bookmarks with their own background refresh jobs;
  conditional tournament slots remain distinct and cannot be bookmarked.
- Trace email-code sign-in and account reuse, native team selection, game and
  roster discovery, metadata, half clips, independently resumable Halo chunks,
  published radar references, native player/team analytics and heat maps.
- Estimated match minutes, half positions and goal/assist attribution, explicit
  playing-format and half-lineup corrections, player corrections, season default
  positions, and reviewed source-track identity assignments. Unknown tracks and
  opponent identities are not presented as verified roster players.
- Explicit matching of Trace games and players to TeamSnap or public schedule
  entries. A matched game exposes Trace analysis alongside the schedule's
  logistics. Original source records remain separately identifiable.
- Saved head-to-head results, strict completed-round-robin award assessment,
  owner-recorded awards, source-conflict evidence and revision-guarded review.
- Shared club logo overrides and season kits, Light/Dark/Soccer Green themes,
  consistent sheets, sortable tables, player and match views, Excel files,
  print-to-PDF layouts, evidence JSON and diagnostic downloads.
- Private owner-managed 7v7/9v9 Coach plans: attendance-based availability,
  three position ratings, endurance and minute targets, reviewed suggestions,
  tap/drag lineup changes, bench substitutions, timestamp clocks, half-time,
  end-of-match records, clock/minute corrections and late substitution corrections.
  Suggestions prioritize manual position ratings and can use linked Trace heat-map
  hints. Revision checks protect concurrent edits; clock ticks do not write to D1.
- Revocable team-scoped viewer links. Viewers cannot change data or access private
  Coach configuration or sessions.

## Accuracy and source limits

Trace-derived minutes and spatial positions are **estimates**, not certified
match statistics. Equal tracking evidence is balanced instead of arbitrarily
assigning every minute to the first names. Rounded player minutes preserve the
match capacity. Missing evidence, unresolved goalkeeper roles, incomplete tracking
and corrections above capacity are visible. Published native statistics remain
separate from derived estimates.

Names alone do not establish cross-provider identity. GotSport Live team resolution
requires an external identity proof; Trace matching requires owner review. Source
records without a verified correspondence remain separately labelled. Unfinished
pool standings and unverified championship paths do not become automatic trophies.

GotSport can still require human verification. This rebuild does not bypass a
provider's verification requirement. Such responses remain a visible source error,
retain saved records, retry later and do not prevent other providers from updating.

## Fresh installation after approval

The default Worker name is **`myts-v7`** so review deployment can use new resources
without overwriting the existing Worker. Keep the directory structure intact.
Uploading only `worker.js` is insufficient: its modules and `web/` assets are required.

For local review, use Node.js 22 or newer:

```sh
npm ci
npm run build
```

`build` performs a Wrangler deployment dry run; it does not publish the application.
For a local running preview, put a temporary strong `ADMIN_KEY` in an untracked
`.dev.vars` file and run `npm run dev`. Local data is separate from remote D1.

After the release has been reviewed and deployment approved:

1. Create a **new, empty D1 database**, for example `myts-v7-data`, in the intended
   Cloudflare account. Do not bind the previous application's database.
2. In `wrangler.jsonc`, set the `DB` binding's `database_name` and `database_id` to
   the new database's actual name and UUID. No database schema import is needed.
3. Set a strong `ADMIN_KEY` secret for `myts-v7` (minimum 16 characters). Keep it
   out of the source, repository and ZIP.
4. Deploy the complete project using the pinned Wrangler version and `npm run deploy`.
   For a Cloudflare Builds repository, preserve every source and asset path and use
   `npm ci` for installation and `npm run deploy` as the deploy command.
5. Confirm `DB`, `ASSETS`, `SYNC`, the SQLite Durable Object export, and the single
   `* * * * *` scheduled trigger. The declarative `exports` configuration provisions
   the new runtime; there is no ordered migration history.
6. Open the new site's `/admin`, initialize the empty database, and sign in. The
   initializer refuses a database that already contains application tables.
7. Set the time zone and TeamSnap Client ID. Register the new origin's `/oauth`
   redirect URL in the TeamSnap application; reconnect TeamSnap and Trace, select
   their teams, and enter the appropriate GotSport IDs. Old tokens, viewer links,
   settings and data are not imported.
8. Run the production checks below before switching the public domain to this Worker.
   Cutover and removal of previous resources are separate deployment decisions.

Changing `ADMIN_KEY` invalidates owner sessions and the encryption key for provider
credentials. Reconnect providers after changing it.

## Verification performed

Verification uses the real Worker runtime, D1 transaction implementation, Durable
Object storage/alarms and browser application, with a synthetic provider service
implementing the source contracts. Synthetic responses are not proof that current
production providers return those contracts for your account.

Additional live public-source checks on October 10, 2026 used the release's unchanged
job runner, collectors and atomic page commits with real HTTPS responses and a
fresh local D1 database. All **74 GotSport/GotSport Live jobs** completed with zero
errors: **231 GotSport fixtures and 51 Live fixtures** were saved. These include
whole competition schedules and other teams, not 282 matches played by your team.
The canonical team and current-season Live team were linked by the provider's
explicit external identity. This checks the source contracts and local storage
workflow; it does not verify network access or execution in your Cloudflare account.
The local Workerd process could not resolve provider DNS, so this additional check
used the Node HTTPS transport with the same collector/job modules and native D1.
No provider cookies or user credentials were used for these public requests.

| Check                                                                                                | Result                                                    |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Fresh startup, nonempty database refusal, owner login, same-origin write checks                      | Passed                                                    |
| GotSport discovery, upcoming union, full category, standings and profile preservation                | Passed                                                    |
| Twelve-page history, changing totals, durable cursor resume after runtime restart                    | Passed                                                    |
| Verification failure retains saved fixtures and records a source error                               | Passed                                                    |
| Native competition catalog discovers Live schedules without past results; official bridge validation | Passed                                                    |
| Relative provider logos and current-profile precedence over historical fixture names                 | Passed                                                    |
| Independent bookmark updates and conditional-slot rejection                                          | Passed                                                    |
| Failed transaction and lost lease publish no records and advance no cursor                           | Passed                                                    |
| TeamSnap roster, logistics, attendance and omitted-member deactivation                               | Passed                                                    |
| Trace sign-in, collection, tracking, native analytics and heat maps                                  | Passed                                                    |
| Shared Trace job survives another dashboard's disconnect                                             | Passed                                                    |
| Explicit source matching, scoped corrections and stale revision rejection                            | Passed                                                    |
| Conflict review preserves both observations and guards source revisions                              | Passed                                                    |
| Scoped read-only sharing; private Coach endpoints and records excluded                               | Passed                                                    |
| Coach attendance, lineup, clock/reload conservation, substitutions and match completion              | Passed                                                    |
| Long clock interruption can be paused and explicitly corrected                                       | Passed                                                    |
| Large history exceeds 2 MB in total while individual fixture records stay small                      | Passed                                                    |
| Bounded keyset pages, complete status totals and measured query reads                                | Passed                                                    |
| Native alarms publish repeated updates with no browser or manual run request                         | Passed                                                    |
| Full Trace collection after Chromium was closed, with no manual job triggers                         | Passed: 68 jobs completed; 450/450 player-minute capacity |
| Chromium mobile screens, correction/source-link forms, Coach actions, bookmarks and themes           | Passed                                                    |
| Phone, tablet and desktop width checks; Excel and PDF exports                                        | Passed                                                    |
| Complete project production bundle and clean archive extraction                                      | Passed                                                    |

The external QA suite contains 29 workflow tests. Test fixtures, browser automation,
screenshots and development dependencies are excluded from this deployment ZIP.

## Not verified; required before production cutover

- Live TeamSnap OAuth and redirect registration for the new deployment origin.
- Delivery and acceptance of a real Trace email code, account permissions, profile
  discovery, real tracking/radar variants and native analytics availability.
- Live GotSport and GotSport Live retrieval from Cloudflare, including whether the
  public endpoints currently issue a human-verification challenge.
- Your real historical data, source identity correspondences, minutes, goalkeeper
  evidence and championship results. No old data or team-specific corrections were
  embedded to make these appear verified.
- Remote D1 provisioning and bindings, Cloudflare alarm/cron execution, account
  quotas, production CPU/memory behavior and a genuinely fresh remote database.
- Physical Android/iOS browsers and device-native PDF or Excel applications.
- Domain cutover, deployment and deletion of previous infrastructure.

On the review deployment, connect each provider, note its separate retrieval/save/
completion checkpoints, close every browser tab, wait through a due refresh, and
reopen the site. Confirm a new saved observation and changed source data where the
provider has published a change. Exercise viewer access, manual matching, corrections,
branding, exports and Coach on actual team records. Source errors must stay visible;
do not accept a green label as proof that every source has published fresh data.

Platform references: [Worker assets](https://developers.cloudflare.com/workers/static-assets/),
[D1 setup](https://developers.cloudflare.com/d1/get-started/),
[Durable Object exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/),
[alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
