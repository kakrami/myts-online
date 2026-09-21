# myTS 6.20.15

## UI consistency update

Analytics filters reuse the app selectors in one compact row. Unavailable player metrics and developer coverage diagnostics are removed from normal screens and reports; underlying diagnostic data remains intact. Match and season context remain together. Collection states distinguish waiting, active loading, and delayed updates without adding a polling timer.

Competition logos share one component across trophies, competition cards, schedule groups, and match details, with a light badge for dark artwork. Trophy cards have compact spacing and a clear all-season scope. Competitions retain the selected-season scope. Confirmed match stages sit under the score; the stats icon indicates saved player stats, not a promise that every advanced metric is available.

This UI update has not been deployed or visually verified on a mobile device. Automated checks use controlled fixtures.

## Trace PlayerFocus analytics

Match > Stats adds possession and its timeline, both-team comparisons, completed passes and completion percentage, shots, box touches, event maps, and additional pass/turnover totals. Player selection shows native heat maps and player touches. Full/first/second-half filters use Trace's actual FullGameVideo timestamps; unavailable half boundaries are not invented. Match player profiles use the same analytics component, retaining an older imported heat map while native data is pending. Season position inference remains separate: native map intensity is not mislabeled as tracking samples, distance, or minutes.

The queries were taken from Trace's public frontend contract on September 21, 2026. An authenticated Trace match page for game 14030311 showed possession 50–50, completed passes 64–79, shots 25–16, 91 box touches, and 50% pass completion for the selected team. This verifies availability in Trace's UI, not the deployed myTS collector's responses.

Collection uses the existing Trace account session and background runtime. It preserves Trace's ORIGINAL home/away sides and GIDs instead of the engine's normalized home-team representation. New tables are added automatically; no database reset, reconnect, new binding, or paid service is required. Missing analytics are discovered for already-published games as well as new ones. Existing minutes/goals/assists are not recalculated by this feature.

The queue prioritizes team comparisons before player scopes, collects at most two scopes per background pass, and persists each result independently. Pending, restricted, unpublished, and request-error states remain distinct. A failed heat-map request retains successful stats and any previous map. Failed requests retain saved payloads and retry with backoff. Recent ready data is revisited daily; older ready data every 30 days; restricted/unpublished selections daily. Backfill waits until the existing tracking collection is terminal, then continues automatically even when the browser is closed. A large history can take multiple days.

Full query data is retained per selection, including possession, total_possession, box_touches, passes_all, passes_complete, passes_incomplete, shots, turnovers_all/won/lost, player_touches, event timestamps/coordinates/identities, third counts, and the native heat-map matrix. No raw videos or radar streams are saved by this feature. Event maps display Trace coordinates; no unverified attack-direction conversion is applied. The available player list comes from the match roster, so opponent player detail depends on what Trace exposes.

Browser snapshots are scoped to the current access context, family, match, player, and period. The existing entity polling cycle refreshes pending analytics without adding a timer. Superseded requests cannot paint a different selection or team. A valid cached response remains visible during refresh failures.

## Free-plan safeguards and verification

Analytics use the existing D1 and SQLite Durable Object runtime, with no R2 or paid dependencies. A shared 2,000 daily request-reservation budget throttles this workload; profile discovery reserves additional capacity. Cached selection responses above 750 KB are rejected with a diagnostic instead of overwriting saved data. This is an analytics workload guard, not a claim about total Cloudflare account usage. Actual account quotas and storage must be checked in Cloudflare; the existing D1 usage meter remains available.

Diagnostics now include analytics manifest/scope status counts, saved payload bytes, retry deadlines, recent errors, and the daily reservation budget. After deployment, check that ready scope counts rise and compare game 14030311 against Trace before relying on the new analytics. Trace permissions, source availability, and per-player coverage can differ by match.

Automated checks passed for the actual 6.20.13 SQLite schema upgrade, repeat migration, retained saved games, original away-team identity, player/half query scopes, idempotent backfill, failure retention, heat-map failure independence, tenant isolation, daily-budget stopping, null-versus-zero rendering, rapid filter changes, and access/team changes during pending requests. Backend request responses in these tests are controlled contract fixtures, not live authenticated API responses. All embedded scripts and the packaged Worker response were checked.

This release has NOT been deployed to the user's Cloudflare account. The authenticated browser confirmed Trace's displayed values, but a production collector round trip and mobile visual/touch verification remain unverified. The cloud browser rejected the local preview URL. No claim of live end-to-end or mobile visual validation is made.

Cloudflare references: https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/d1/platform/pricing/ ; https://developers.cloudflare.com/durable-objects/platform/pricing/

## Previous release: upgrade recovery fix

The production diagnostics showed stale championship flags and missing verification timestamps after upgrade. Cache migration reset the general retry time but retained api_next_at, so the collector retried HTML publication checks instead of refreshing the JSON schedule. HTTP 302 responses consumed the request budget without recalculating those awards.

This release resets both schedule deadlines during the existing data-revision migration. It preserves saved games and honors the upstream rate-limit pause. No manual reset or reconnect is required. HTML publication errors remain in schedule diagnostics but do not override the independent trophy assessment. Diagnostics now also include the data revision, trophy check timestamp, match count, and verified final IDs.

Regression testing reconstructed the reported saved-cache deadlines and stale flags using downloaded source fixtures. Before the fix, three historical awards remained missing after 25 simulated update passes. After the fix, all nine reached the public API and trophy renderer, independent of selected season, despite continued HTTP 302 publication failures. The ten-request budget and rate-limit pause were checked. This is a reproduction of the upgrade state, not a test against the private production database.

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
5. Confirm version 6.20.14 in Settings. Open Team > Trophies. Historical verification populates through the existing background collector and may require multiple passes under upstream request limits.

## Validation and limits

Checked JavaScript syntax, the real historical schedules and available standings, winner/runner-up and tied-final handling, cached awards during errors, cancellation/conflicting-winner rejection, consolation branch handling, invalid losing-team paths, edition grouping, deduplication, and the packaged Worker HTML response. This release was not deployed to your account and has not received a fresh on-device visual/touch test. GotSport availability and incomplete historical records remain external limitations.

The ZIP contains only the deployment files and this README. Tests and downloaded source fixtures are excluded.
