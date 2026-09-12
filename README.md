# myTS 6.0.0

Cloudflare Worker + D1 team dashboard rebuilt around one integrated TeamSnap + Trace experience.

## Product flow

- **Overview** combines TeamSnap schedule/availability with current-season Trace performance leaders and recent matches.
- **Matches** is the single timeline for games, practices, and other team events. Opening a game gives a FotMob-style match center with score context, player stats, goal events, and TeamSnap availability.
- **Player profiles** combine match/season performance, corrected Trace heat maps, position profile, shots/touches/box involvement, match history, and TeamSnap availability. A player opened from a match starts in match context and can move naturally to the season profile.
- **Team** combines roster, availability, appearances, starts, minutes, goals, assists, and rate stats in one table.
- **Reports** provides Excel and PDF exports without duplicating the normal dashboard workflow.
- Opponent H2H is opened contextually from a match/opponent instead of living in a separate History section.

Trace is a data source, not a separate product area. Owner controls for connecting Trace, checking for new games, exporting the unified dataset, or manually importing `myts_trace_data.json` live under **Account & Data Sources**.

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

`v6.0.0` is shown beside the myTS logo on both the login screen and loaded dashboard, so the deployed version is visible immediately.
