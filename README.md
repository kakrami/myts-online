# myTS 6.0.4

Cloudflare Worker + D1 team dashboard rebuilt around one integrated TeamSnap + Trace experience.

## Product flow

- **Overview** combines TeamSnap schedule/availability with current-season Trace performance leaders and recent matches.
- **Matches** is the single timeline for games, practices, and other team events. Opening a game gives a FotMob-style match center with score context, player stats, goal events, and TeamSnap availability.
- **Player profiles** combine match/season performance, corrected Trace heat maps, position profile, tracked distance, attacking-third share, field coverage, match history, and TeamSnap availability. Trace-tagged shots/touch involvement remain available in the underlying dataset but are not presented as complete event counts. A player opened from a match starts in match context and can move naturally to the season profile.
- **Team** combines roster, availability, appearances, starts, minutes, goals, assists, and rate stats in one table.
- **Reports** provides Excel and PDF exports without duplicating the normal dashboard workflow.
- Opponent H2H is opened contextually from a match/opponent instead of living in a separate History section.

Trace is a data source, not a separate product area. Owner controls for connecting Trace, checking for new games, exporting the unified dataset, or manually importing `myts_trace_data.json` live under **Account & Data Sources**. The separate **Settings** control contains only the pre-season inclusion toggle.

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

Keep the existing D1 binding named `DB` and the existing `ADMIN_KEY` secret, replace the repository files with this bundle, and deploy with Wrangler. TeamSnap OAuth continues to redirect to `/admin`.

## Version

`v6.0.4` is shown beside the myTS logo on both the login screen and loaded dashboard, so the deployed version is visible immediately.
## 6.0.2 season history fix

- Season choices now come from the union of TeamSnap seasons, saved TeamSnap event dates, and the unified Trace dataset.
- Historical TeamSnap team records already saved in D1 are preserved during refresh instead of being dropped when TeamSnap only returns the current team.
- Trace-only historical seasons remain selectable even if TeamSnap no longer exposes an old team record.


## 6.0.4 goal attribution safety

- Goal occurrence/timing still reconciles against the official Trace score.
- Player scorer/assist attribution now requires explicit role evidence from Trace.
- Generic GID order, AOS/superfollow presence, and nearby touches are not treated as scorer/assist proof.
- Ambiguous historical role attributions in the bundled seed are cleared instead of being published as player stats.
- Trace engine 1.7.1-browser forces existing stored source games through the corrected event model without re-downloading raw game data.
