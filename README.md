# myTS

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

Users never need to know Trace's internal team ID. myTS uses the currently selected TeamSnap team's name and game history to discover the corresponding Trace team. If more than one team is plausible, myTS shows normal team names for the user to choose from.

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
