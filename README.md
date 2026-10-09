# myTS 6.20.129

## 6.20.129 public schedule ingestion candidate

Scope: parser and truthful coverage fixes only. Automated schedule acquisition and future-competition discovery remain unresolved.

Unpublished candidate based on main commit `78fe27c00b91cd09c3114cf23979617df65b36be` (6.20.127). The separate, paused 6.20.128 work is not included.

- Parse canonical GotSport match IDs from exact event/division Results links. Display match numbers are never used as canonical identities.
- Resolve event registration links only against verified division standings or existing structured match identities. No fuzzy team-name/opponent matching or invented schedule IDs.
- Add previously unseen fixtures and update existing fixtures by canonical ID, using the same collection path for the connected team and followed-team dashboard contexts.
- Preserve bracket-seed participants as conditional slots. A linked registration whose canonical team ID is unavailable remains a registration-identified fixture; it is not automatically a contingent playoff slot.
- Deduplicate identical rows. Reject conflicting duplicates, foreign event/division/team identities, unresolved identity regressions and malformed/empty/challenged responses without deleting saved data.
- Keep omitted fixtures; absence from history, results or a public page never fabricates a cancellation.
- Keep structured results independent from public kickoff verification. A later schedule check cannot erase newer scores, and lagging public timing/participants cannot move or unresolve a completed result.
- Distinguish verified full-division schedules, filtered views, retained fixtures and results checks. A full page requires its exact division links and active All-dates evidence.
- Report history-only discovery as incomplete even when all known division schedules verify. Legacy ready metadata and partial schedules no longer produce an Up to date claim. Results and schedule timestamps are exposed separately.
- Clear obsolete venue/address metadata when a verified public location changes, rather than pairing new fixture text with old directions.

### Evidence and limits

The parser contract was checked against genuine public DOM subtrees captured from Fall event 50598, division 552093, on October 9, 2026. The full page contains 13 fixtures, its date-filtered page contains 5, and White's registration-filtered page contains 3. Canonical match and registration links are recorded in the separate QA evidence bundle. Captures are browser DOM, not raw Worker HTTP responses. Synthetic API-shaped metadata and adversarial variants used by automated tests are explicitly identified as such.

Cloudflare's actual HTMLRewriter was exercised locally through workerd. No live production database, deployment or write-back was used. Browser rendering of the candidate has not been verified. Production Worker access to GotSport remains unverified; another exact division (56019/542958) still returned a human-verification challenge. This patch does not bypass that challenge, authenticate to clubLive, or discover future competitions absent from GotSport's history-only discovery source. Unknown markup and unsupported playoff descriptions fail closed and retain saved data.

Use the four files together for a separately authorized deployment. Existing Cloudflare bindings, secrets, deployment configuration and database schema are unchanged. QA scripts, captured source evidence and test reports are supplied separately, outside the four-file runtime package.

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
