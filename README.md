# myTS 6.20.123

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
