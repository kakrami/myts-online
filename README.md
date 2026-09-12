# myTS

Current app version: **5.0.0**

myTS is a Cloudflare Worker + D1 team dashboard. TeamSnap remains the schedule, roster, availability, and season source. Trace is an owner-only connected performance source.

## Production files

```text
worker.js
wrangler.jsonc
package.json
README.md
.gitignore
.dev.vars.example
```

There is no `index.html`, tools folder, or R2 bucket requirement. The Worker serves the UI and API.

## Setup

1. Deploy the repository to Cloudflare Workers.
2. Bind a D1 database as `DB`.
3. Set the `ADMIN_KEY` Worker secret.
4. Open `/admin` and connect TeamSnap normally.
5. Open **Stats** or **Account → Connect Trace**.
6. Enter the email used by your Trace account, then the one-time code Trace emails you.
7. myTS matches the selected TeamSnap team to the authenticated Trace team and begins processing games newest-first.

## Trace storage model

myTS downloads detailed Trace metadata and radar only while processing a game. Those bulky source responses are not retained. The Worker stores one compact normalized `myts.trace` **1.0** dataset in D1 containing match identity, scores, events, player minutes, goals, assists, shots, touches, role/start status, Trace identities, and data confidence. Raw radar responses and raw Halo rings are never retained; only reduced metadata and compact tracking segments are kept while needed for processing/recalculation.

New/changed games are queued incrementally. Unchanged game evidence is reused; only a new or changed game needs a fresh base calculation. Trace Engine 1.7 runs inside the Worker, so processing and publication continue from the scheduled job even when the admin browser is closed. The included every-minute cron advances the queue and periodically refreshes the Trace catalog. TeamSnap is refreshed on a 15-minute cadence.

The Trace email and one-time code are not stored. The authenticated Trace session is encrypted server-side. Share-link viewers never receive Trace credentials or owner controls.

## Unified dataset backup

The normal workflow is automatic Trace sync. As an emergency backup/restore path, **Account → Advanced** can export or restore one `myts_trace_data.json` file. The old three-ZIP workflow is not part of production.

## Existing installations

Deploying 5.0.0 creates the new unified Trace tables automatically. Existing TeamSnap data and private viewer links remain in D1. If a 4.x admin-import dataset exists, myTS migrates it once into the unified dataset on startup. Existing direct Trace connections are reprocessed with the unified engine contract so the compact match payloads are created.
