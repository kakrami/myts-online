# myTS

Current app version: **2.12.0**

TeamSnap manager console with optional automatic Trace integration.

[![Deploy myTS to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kakrami/myts)

## Install from your phone

1. Tap **Deploy myTS to Cloudflare** above.
2. Sign in to Cloudflare and GitHub if asked.
3. Keep the defaults and tap **Deploy**.
4. When deployment finishes, tap the new `workers.dev` address.
5. In myTS, connect **TeamSnap** and then tap **Connect Trace**.

**Done.**

There is no terminal setup, database setup, Worker URL, API key, Trace team ID, or Trace team URL to enter.

## What Cloudflare sets up automatically

The deploy button creates the myTS Worker and its D1 database binding. myTS creates its own database tables on first use. The included hourly schedule checks connected Trace teams for updates automatically.

Cloudflare also creates a copy of this repository in your GitHub account and connects it to Workers Builds, so later repository updates redeploy automatically.

## Trace connection

Users never need to know Trace's internal team ID. myTS discovers and stores the connection for the current TeamSnap team. After the first connection, the user does not set Trace up again after a refresh.

Playing-time data is cached on the device in IndexedDB and also stored in Cloudflare D1. myTS shows the saved device copy immediately, checks Cloudflare quietly in the background, and only downloads the cloud data again when its data timestamp changed. While the site is open it checks status periodically; the included Cloudflare schedule also checks Trace hourly when the site is closed.

The first Trace collection is progressive: the Playing Time view shows team match, player discovery, game discovery, and playing-time collection status while existing/available data remains usable.

## Trace resolver safety

myTS verifies Trace teams with completed TeamSnap fixtures (date, opponent, and score) before saving a match. A same-name Trace result is not enough. Existing connections that have no players or game data are automatically re-verified and repaired in the background.

## Updating myTS

Cloudflare watches the deployed GitHub repository. When the repository is updated, Cloudflare automatically publishes the new version while the D1 data remains in the Cloudflare account.

## Files

The complete application intentionally contains only four files:

```text
worker.js
wrangler.jsonc
package.json
README.md
```

`worker.js` contains both the myTS website and its small API backend.
