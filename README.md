# myTS 6.18.31

## Release changes

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
5. Reload the app and confirm version 6.18.31 in Settings. Existing background updates will populate standings; no reconnect or manual tournament IDs are needed.

## Verify after deployment

Open Competitions, expand a competition, and check its Standings section. Standings opens by default; subsequent updates preserve your open/closed choice. Cactus Kick Off and LV Club Soccer League were confirmed to provide this data during investigation. Placements and scores can change after this release.

If an update fails, saved standings remain visible. Export Diagnostics from Settings for the exact division's standings error and last attempt. Schedule/publication verification is a separate status and may still encounter GotSport's CAPTCHA.

## Validation and limits

Tested upgrade from the exported production 302 error with a future retry deadline; the scheduler SQL against SQLite (legacy/current/locked feeds); migration idempotence and current-source backoff preservation; API error isolation; the real Cactus response; exact membership checks; malformed/duplicate records; multiple brackets; missing placements; HTTP/rate-limit failures; cached-table retention; independent schedule status; archived backfill; and repeated active/archived collector passes. Official API availability remains controlled by GotSport. No production deployment is performed by supplying this ZIP.

Contents: worker.js (includes the UI), wrangler.jsonc, package.json, README.md. Tests and development artifacts are excluded.
