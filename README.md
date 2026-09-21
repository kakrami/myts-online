# myTS 6.20.12

## Trophies

Team > Trophies now shows all available seasons, independent of the season selector. Competition cards show Winner and Runner-up counts, clickable years, and the youth division. Matching editions are grouped by normalized event name and organizer website; editions with different organizer identities remain separate to avoid merging unrelated events. A year opens its standings and matches using the existing match and team components.

The collector rechecks archived competition records automatically using its existing request limits and retry schedule. It follows championship winner paths, allows unrelated consolation games, and supports seeds beyond second place. A tied final requires a published winner. A completed single-table round robin must reconcile with every scheduled result before a placement is awarded. Group-stage standings alone do not establish a tournament trophy.

Saved verified awards remain visible when updates fail. Pending, unavailable, and unresolved records have separate states, with per-division reasons in Diagnostics. No manual reconnect or database reset is needed.

## Historical audit

Checked the available 175-match history for GotSport team 212707 across 37 events on September 21, 2026. Nine placements verified: four Winner and five Runner-up. These are source results at the time of the audit, not hard-coded app data.

| Competition | Placement | Date |
| --- | --- | --- |
| Las Vegas Invitational FALL CUP 2024 | Runner-up | 2024-10-13 |
| Phoenix Rising Cup 2024 | Winner | 2024-09-01 |
| Las Vegas Invitational FALL CUP 2025 | Runner-up | 2025-10-12 |
| Surf Cup Southwest 2026 | Runner-up | 2026-03-01 |
| Phoenix Rising Cup 2025 | Winner | 2025-08-31 |
| The 32nd Annual Rugrat Tournament | Runner-up | 2025-12-01 |
| Nevada Jr. Cup 2026 | Runner-up | 2026-02-01 |
| Las Vegas Memorial Cup 2026 | Winner | 2026-05-25 |
| 2026 Cactus Kick Off | Winner | 2026-09-20 |

Some older records still lack sufficient evidence. The app does not treat these as confirmed losses or zero trophies:

- Nevada South Youth Soccer League 2022/2023 (division 123517): Final table unavailable or multiple brackets.
- Nevada South Youth Soccer League 2022/2023 (division 120395): Final table unavailable or multiple brackets.
- Nevada South Youth Soccer League 2022/2023 (division 123833): Incomplete schedule results.
- SVS Spring soccer league (division 159616): Incomplete schedule results.
- LAS VEGAS PREMIER LEAGUE (division 209563): Final table unavailable or multiple brackets.
- Nevada South Youth Soccer League Spring 2024 (division 242088): Incomplete schedule results.
- PSL SPRING 2024 (division 247526): Incomplete schedule results.
- PSL SPRING 2024 (division 247528): Final table unavailable or multiple brackets.
- Desert Classic 2025 (division 359766): Championship path not verified.
- Nevada South Youth Soccer League Fall 2024 (division 288685): Incomplete schedule results.
- Nevada South Youth Soccer League Spring 2025 (division 335720): Final table unavailable or multiple brackets.
- 2025 Temecula Holiday Classic (division 351726): Championship path not verified.
- Vegas Cup 2026 (division 453342): Championship path not verified.
- Nevada South Youth Soccer League Fall 2025/2026 (division 429019): Final table unavailable or multiple brackets.
- Nevada South Youth Soccer League Spring 2025/2026 (division 467813): Incomplete schedule results.

## Deployment

1. Extract worker.js, wrangler.jsonc, package.json, and README.md into your existing deployment project.
2. Preserve your existing Worker name, real D1 database ID/binding, ADMIN_KEY secret, and MYTS_RUNTIME Durable Object binding. The supplied configuration contains a database placeholder; use your existing deployment configuration.
3. Run `npm install`, then `npx wrangler deploy` with your existing Cloudflare account/project.
4. Keep the existing Durable Object migration declaration. No new bindings, secrets, or database reset are needed.
5. Confirm version 6.20.12 in Settings. Open Team > Trophies. Historical verification populates through the existing background collector and may require multiple passes under upstream request limits.

## Validation and limits

Checked JavaScript syntax, the real historical schedules and available standings, winner/runner-up and tied-final handling, cached awards during errors, cancellation/conflicting-winner rejection, consolation branch handling, invalid losing-team paths, edition grouping, deduplication, and the packaged Worker HTML response. This release was not deployed to your account and has not received a fresh on-device visual/touch test. GotSport availability and incomplete historical records remain external limitations.

The ZIP contains only the deployment files and this README. Tests and downloaded source fixtures are excluded.
