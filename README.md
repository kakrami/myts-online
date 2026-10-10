# myTS 6.20.133 candidate

## Complete followed-team competition views and bounded saved snapshots

This update addresses the .132 whole-row storage failure and the incomplete GotSport Live competition views. It preserves the automatic followed-team resolver and adds independent membership discovery, event metadata, complete category schedules, published standings, and official source links. Preparing this candidate does not deploy it.

### Automatic discovery and collection

- Start with each followed canonical GotSport team, its profile and verified public historical Live links. Resolve clubs and current-season teams dynamically using exact provider external keys. The Live resolver has no shipped team, club, season, organizer or event seed IDs, saved source seeds, or new manual connection steps.
- Combine returned team memberships with verified upcoming-game contexts. A competition can be discovered before games are published; a tournament present only in the upcoming feed remains included when the membership list omits it.
- Fetch event dates, location, website, category and pool membership, official links, published standings and the whole category's upcoming fixtures. Each component has its own completion, freshness and error state. The existing shared ten-request collection budget and resumable pagination remain enforced.
- Preserve an exact-own-team conditional slot without treating it as a confirmed game, score, result or bookmark. Explicit participant resolution promotes the same native source identity. Source omission never fabricates cancellation.
- Native league format describes a pool or playoff format, not necessarily the entire event. An exact verified canonical event-to-Live organizer chain can carry an authoritative event classification; names and pool formats cannot. Unknown event classification remains visible rather than silently disappearing. Standings show only returned rows; terminal pagination is not a claim that every participant has a published standing.
- Keep kickoff instants and display-local date behavior. Retain source-native namespaced IDs and existing bookmark identities. Category and team feeds cannot silently replace conflicting final scores or change verified participants.

### Coherent presentation without destructive merging

Existing fixture correspondence requires independently verified event context, exact participants, official match number, season, compatible kickoff and unique one-to-one evidence. It does not equate IDs or pair names and times alone.

A fresh, fully paginated native category can become the preferred competition view only when existing fixture proofs establish reciprocal one-to-one category correspondence. The original canonical fixtures, completed results, standings, trophies and routes remain accessible in an expandable retained-source section. Ambiguous, stale, partial or contradictory evidence restores separate views. A scored native final remains visible even when the corresponding canonical final has no scores.

Calendar/GotSport Live/Trace source information is visible in schedule details. Weak shared-name/time matches cannot mask a different official opponent. When a genuine correspondence exists, official fixture fields can be shown while preserving calendar arrival, uniform and notes. Conflicting or unproven records remain separate and identifiable.

### Bounded database work and resumable updates

GotSport collection enforces a 45-statement database budget, counting each batch member and reserving capacity to publish progress, release the lease and report a failure. This leaves headroom below the documented [50-query Free-plan limit](https://developers.cloudflare.com/d1/platform/limits/). It does not require a paid-plan assumption or an account change.

The scheduler processes one collection job per invocation. Upcoming pagination records verified page progress separately from retries. Its 45-minute inactivity window covers two rotations of twenty followed teams, and an eight-hour absolute ceiling bounds the full twenty-page scan. Errors and empty budget deferrals do not renew progress. Content-bound cursor records are cleaned up by progress age; legacy cursor references retain their original expiry behavior. Individual page observation timestamps are preserved throughout long scans. Profile enrichment yields before using publication capacity; verified pages and accumulated metadata continue on later updates. The existing ten-source-request ceiling stays unchanged. Native competition work may use eight of those requests while leaving room for other source work. Cleanup, progress messages and decorative display lookups run only when there is enough remaining budget. Unrelated providers retain their existing behavior. Combined Favorites reads also use the shared query ceiling, stream saved-source proofs and reuse bounded projections. Large team projections can be deferred as whole entries; their identities and saved data remain available through the independent team context. Saved bookmarks take response priority. If an exceptionally large aggregate needs compact bookmark cards, their exact identities, participant proof, status, scores and official links remain visible with a details-deferred warning. No stored snapshot or fixture array is truncated.

### Lossless bounded storage

The .132 dictionary codec and legacy plain snapshots remain readable. Large authoritative snapshots now use identity- and field-bound, SHA-256-verified immutable records in the existing app_meta table. The existing parent rows contain small manifests; small snapshots stay inline. No canonical history is truncated, and D1's row ceiling is unchanged.

Metadata and event references are generation-bound. Chunk reads/writes, row sizes and total admitted storage are bounded. A parent snapshot is published only after all content is staged and verified. Lease ownership, expiry and prior-row comparisons guard publication. Failed staging, corrupt data, an interrupted commit or a lost lease retains the previous committed snapshot. Component byte counts are recorded for diagnostics so another size failure is measurable.

Bounded cleanup protects both the current snapshot and the recoverable previous snapshot. Unreferenced content must pass a settling grace period and current-reference revalidation before deletion. Storage pressure rejects a new write safely rather than pruning saved fixtures.

### Validation and remaining limits

The captured public-source inventory covers three followed teams, including the U10 team omitted by earlier acceptance tests. Tests exercise their automatic follow-to-games path, membership-plus-fixture union, Fall and Mayor category schedules, other-team games, conditional slots, partial standings, existing bookmarks, repeat updates and interrupted pagination. Large-state tests use captured field shapes with explicitly synthetic accumulated history, including the final independent full-request case with 3,804,076 metadata bytes and 1,590 retained historical rows. An earlier acceptance snapshot separately exercised 4.44 MB and 1,793 rows; those are not the counts of the final replay. Additional tests exercise near-16 MiB metadata and event fields, failed publication and retry, thirteen large followed snapshots under an enforced query limit, and a 100-bookmark response bound. This is not a capture of the current production database bytes. The bookmark stress case uses 100 snapshots of approximately 250 KB each. The existing bookmark query materializes saved rows before response summarization; 100 bookmarks each near the database row ceiling and universal peak-memory safety are not verified.

Automated validation uses actual Worker execution, HTTP handlers, Miniflare D1 and UI-function/render tests with captured upstream responses. Adversarial mutations are explicitly synthetic. Production egress, live visible recovery, mobile layout and current upstream changes require post-deployment verification. The cloud test browser could not launch, so these checks are not a claimed visual-browser pass.

A followed team with no usable public Live entry link or exact current-season identity remains explicitly unresolved. Public challenge, authentication, malformed and incomplete responses retain saved data with a truthful warning. No credentials, CAPTCHA bypass, broad nationwide scan or paid infrastructure is introduced.

### Deployment and operational recovery

Use all four runtime files together only after deployment approval. Existing bindings, secrets and database tables are unchanged. No database restore is required for the normal upgrade. Existing .132 saved state is read automatically, and the revision wakes affected followed teams for a new bounded collection pass.

After deployment, verify all three followed teams in Schedule and Competitions, White's official Mayor fixtures, U10's confirmed games and conditional slot, whole-category games, standings coverage, existing bookmarks, diagnostic component bytes and a second update. Check the deployed version and absence of saved-row errors.

A separately named **6.20.133 recovery** build is the operational fallback. It keeps compatible storage readers and writers, visibly pauses GotSport retrieval and preserves saved schedules and bookmarks while other features remain available. Do not upload the recovery ZIP when intending to deploy the normal update. Do not roll back directly to .132, its recovery build, or older Workers after .133 manifest snapshots have been saved: those versions do not understand the new references.

Recovery mode is not a backup and cannot reverse every possible data-loss event. Earlier Worker invocations already running may finish; allow existing leases to settle and inspect the resulting state. Resume collection by deploying a reviewed compatible normal build. A database restore, if ever needed, is a separate explicitly authorized operation affecting the whole database. A verified backup/recovery point is useful additional protection, but obtaining Cloudflare login is not a prerequisite for preparing or using the compatible operational fallback.

QA scripts, captured evidence and test reports are separate from the four runtime files.

## Historical changes retained below

The following entries describe earlier release scopes. The .133 behavior and recovery instructions above supersede earlier candidate status and limitations.

## 6.20.127 whole-row bookmark anchor candidate

The passive saved marker is now anchored to the whole shared match row, including its optional date: 10 px below the top and 12 px inside the right edge. The date reserves the existing action gutter so it cannot run under the marker. The stats indicator occupies the bottom of the existing fixture gutter, leaving at least 4 px below the bookmark in an undated 48 px fixture. Saving a game adds no flow content or height. Successful removals disappear from the Bookmarks list; failures retain the saved game, and the open detail sheet still allows re-saving. Passive indicators use bookmark terminology and empty-state guidance identifies GotSport eligibility. Cached player-stats availability is tied to the verified owning team, source revision, access scope and fixture identity; an explicit action opens the correct source team and season before showing its players. Existing dates, competition metadata and source data are retained. Candidate only, not published; browser geometry and overlap checks remain required before release.

## 6.20.126 compact list bookmark candidate

Saved-game markers in the shared Competitions, Schedule, and Bookmarks match rows now occupy the existing rightmost fixture column at its top edge. Saving a game adds no metadata line or row height. Genuine metadata remains below the teams, and the indicator retains its passive click-through behavior. The 6.20.125 detail-sheet improvement is retained. Backend logic and deployment configuration are unchanged. Candidate only, not published.

## 6.20.125 compact bookmark candidate

The match bookmark toggle now sits in the existing sheet header immediately left of Close. It uses a 44×44 px target and a 19 px outline/filled icon; date and time stay in the match overview. No additional row, toolbar, or sheet layer is added. The existing bookmark handler, labels, pressed state, pending-state disabling, and Bookmarks destination are retained.

Candidate only: not published. Worker and embedded JavaScript syntax, bookmark state and placement checks pass; actual mobile browser rendering must be verified separately. The 6.20.124 backend and deployment configuration are unchanged except for the application version label.

## Retained 6.20.124 fixes

Bookmark recovery: verified server-saved upcoming fixtures can be watched before GotSport publishes results. Missing result rows retain the saved watched game instead of marking it unavailable. Client-supplied snapshots are never trusted.

GotSport sync recovery:
- Read the public paginated team-history contract with `past=true`.
- Apply verified division results while retaining fixtures omitted by Rankings; an empty result list cannot prove cancellation.
- Accept named standings placeholders with valid registration/bracket IDs and no team ID. Reject malformed IDs, duplicates, and foreign division rows.
- Detect CAPTCHA redirects without requesting the challenge page; follow only bounded redirects within the exact public division schedule.
- Reset obsolete retry deadlines on upgrade and prioritize active competitions. Expose coverage and retained fixture counts in diagnostics.
- Prevent incomplete history coverage from automatically classifying unmatched TeamSnap games as friendlies.

Upload all four files together. Existing bindings and secrets remain unchanged. This update does not bypass GotSport CAPTCHA or supply newly published future fixtures hidden by GotSport. Saved fixtures remain available.

Validation: captured live GotSport contracts; pagination, membership and identity rejection tests; missing/empty fixture retention; placeholder standings; redirect tests; recovery from the previous saved state; Worker and embedded UI syntax checks. Production deployment was not performed.

## Existing Coach workflow

This release adds a private Coach workflow to the existing match and player detail views. Upload the four files in this ZIP together. Existing Cloudflare bindings and secrets remain the same. The first request after deployment creates the coach tables and advances the schema version to `schema-analytics-directory-v8`.

## Use

- Open a player from Team, then edit **Coach attributes**: up to three rated positions, endurance, and an optional target minutes. Ratings carry forward for the same TeamSnap member ID until edited in a new season.
- Open one of your team's games from Schedule and select **Coach**. Confirm 7v7 or 9v9, half length, and available players. TeamSnap `No` responses start excluded; the coach can change the list before kickoff.
- Drag or tap players onto the field, or use **Suggest starting lineup**. Start the clock when the field has the right number of players. Use the existing match sheet and phone back behavior.
- Tap an on-field player and a bench player to substitute. Position moves, halftime, pause, resume, and end are recorded. The clock and player minutes derive from saved timestamps, including after a phone locks or the page reloads.
- Suggestions consider coach-rated position strength, current playing time and targets, and a light signal from past Trace roles and minutes. They explain their reasons and never apply automatically.
- Paused and finished games allow clock, player-minute, and late-substitution corrections. The postgame view shows coach-recorded minutes and a match timeline, separate from Trace estimates.

Only the owner can read or write Coach data. Shared viewer links and public dashboard snapshots do not contain coach ratings or match sessions. A revision check rejects stale writes from another device. Active Coach views check for remote changes through the shared 15-second detail-view refresh while visible. No database write occurs on a clock tick.

Actions require connectivity. The clock continues to calculate elapsed time across a reload, but offline substitution actions are not queued.

## 6.20.122 integration rebuild

Coach now reuses the existing lineup pitch markings, player markers, position targets, pointer/keyboard drag cleanup, player detail navigation, form styles, and entity polling. The desktop field/bench layout stacks on mobile. Game availability is a collapsible game-plan override of Attendance; private ratings remain in the existing player sheet. Clock and late-substitution corrections are collapsed until needed. Fixed the match analytics mount flag regression.

Validation: reducer constraints and timing tests, embedded JavaScript syntax checks, generated Coach view and action integration checks. A real-browser visual check was unavailable in the build environment; verify phone and desktop rendering after deployment.
