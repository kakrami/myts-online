# myTS 6.20.121

This release adds a private Coach workflow to the existing match and player detail views. Upload the four files in this ZIP together. Existing Cloudflare bindings and secrets remain the same. The first request after deployment creates the coach tables and advances the schema version to `schema-analytics-directory-v8`.

## Use

- Open a player from Team, then edit **Coach attributes**: up to three rated positions, endurance, and an optional target minutes. Ratings carry forward for the same TeamSnap member ID until edited in a new season.
- Open one of your team's games from Schedule and select **Coach**. Confirm 7v7 or 9v9, half length, and available players. TeamSnap `No` responses start excluded; the coach can change the list before kickoff.
- Drag or tap players onto the field, or use **Suggest starting lineup**. Start the clock when the field has the right number of players. Use the existing match sheet and phone back behavior.
- Tap an on-field player and a bench player to substitute. Position moves, halftime, pause, resume, and end are recorded. The clock and player minutes derive from saved timestamps, including after a phone locks or the page reloads.
- Suggestions consider coach-rated position strength, current playing time and targets, and a light signal from past Trace roles and minutes. They explain their reasons and never apply automatically.
- Paused and finished games allow clock, player-minute, and late-substitution corrections. The postgame view shows coach-recorded minutes and a match timeline, separate from Trace estimates.

Only the owner can read or write Coach data. Shared viewer links and public dashboard snapshots do not contain coach ratings or match sessions. A revision check rejects stale writes from another device. Active Coach views check for remote changes every 30 seconds while visible. No database write occurs on a clock tick.

Actions require connectivity. The clock continues to calculate elapsed time across a reload, but offline substitution actions are not queued.
