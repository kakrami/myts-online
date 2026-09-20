# myTS 6.19.1

## Viewing followed teams

The top team selector groups connected teams under My team and favorites under Followed teams. Choose a followed team to view its Overview, Schedule, and Competitions (including division standings). Seasons use that team's available games. TeamSnap attendance and Trace/player data are not available for public teams; the Team page explains this instead of carrying over private data.

Favorites and watched games remain associated with your connected team's access scope. Following a team does not grant ownership. Settings provides My team settings, which explicitly returns to your connected team before showing connection, logo, kit, and report controls. Your team badge remains attached to your connected team.

Public team competition data uses the existing collector and shared team history cache. Opening a team updates it on demand; refreshes while viewing reuse the existing page polling lifecycle. Switching away stops context polling. There is no new scheduled subscription or database binding. Another viewer opening the same team reuses its saved context until due. Cached data remains usable during refresh failures.

## Release changes

- Favorites now lists only bookmarked games, directly, without followed-team groups. Its team filter uses the participants in bookmarked games.
- Followed teams remain saved and accessible in the top selector. Refreshing Favorites updates watched divisions only, not every followed team’s history.
- Removed bookmarks remain visible until you leave Favorites or explicitly refresh; switching Upcoming/Past does not discard them.


- Shared viewing context for followed teams across the existing dashboard tabs.
- Grouped team selector; background refreshes preserve an open selector. Mobile sheet scroll-lock events no longer dismiss the selector; desktop dropdowns retain scroll dismissal.
- Request sequencing prevents late responses from replacing the newly selected team.
- Connected-team ownership and Favorites scope remain separate from viewing context.


- One-time standings source migration is eligible on the next background pass even when the old feed has a future retry date. Existing request pauses and leases remain respected.
- Obsolete HTML errors no longer appear as current JSON standings failures. Schedule errors cannot override a successful standings status in API or UI.

- Standings now use GotSport's division-registration JSON feed, including published group placement, points, W/L/D, and goals.
- Event, division, bracket, registration, and team IDs are validated before replacing saved standings. No similar-name matching or locally calculated rankings.
- Standings updates use the existing background collector, request limits, cache, and retry backoff. A public schedule verification failure no longer marks standings unavailable.
- Archived competitions can load standings once; successful archived data is then retained without recurring standings requests.
- Existing competition layout and disclosure behavior are preserved. Missing placements display without an invented rank.

## Deploy an existing installation

1. Extract this ZIP. Keep worker.js, wrangler.jsonc, and package.json together at the existing project's deployment root.
2. Use your existing deployment pipeline. Preserve the existing Worker name, D1 database binding/ID, ADMIN_KEY secret, and MYTS_RUNTIME Durable Object binding. The supplied config contains a DB binding placeholder; retain your deployment's actual D1 database configuration.
3. For a Wrangler deployment, install dependencies with `npm install`, then deploy with `npx wrangler deploy` using your existing account and project configuration.
4. Do not delete or recreate the database or Durable Objects. No new secrets, bindings, or schema migrations are required for this release. Retain the existing Durable Object migration declaration.
5. Reload the app and confirm version 6.19.1 in Settings. Existing background updates will populate standings; no reconnect or manual tournament IDs are needed.

## Verify after deployment

Open Competitions, expand a competition, and check its Standings section. Standings opens by default; subsequent updates preserve your open/closed choice. Cactus Kick Off and LV Club Soccer League were confirmed to provide this data during investigation. Placements and scores can change after this release.

If an update fails, saved standings remain visible. Export Diagnostics from Settings for the exact division's standings error and last attempt. Schedule/publication verification is a separate status and may still encounter GotSport's CAPTCHA.

## Validation and limits

Bookmarks-only checks confirm no followed-team groups, saved games displayed directly, removal retention until tab exit, empty state, and followed teams preserved in the selector.


Browser checks covered grouped selector clicks, rapid/out-of-order switching, every tab, return to the connected team, settings guards, and private-data isolation. Competition standings were rendered at 320, 390, and 768 pixels across all three themes. Collector tests used a followed team’s real Cactus match fixtures and checked shared cache reuse after 30 seconds. These are local tests; production deployment and verification are still required.


Tested upgrade from the exported production 302 error with a future retry deadline; the scheduler SQL against SQLite (legacy/current/locked feeds); migration idempotence and current-source backoff preservation; API error isolation; the real Cactus response; exact membership checks; malformed/duplicate records; multiple brackets; missing placements; HTTP/rate-limit failures; cached-table retention; independent schedule status; archived backfill; and repeated active/archived collector passes. Official API availability remains controlled by GotSport. No production deployment is performed by supplying this ZIP.

Contents: worker.js (includes the UI), wrangler.jsonc, package.json, README.md. Tests and development artifacts are excluded.
