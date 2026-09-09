# myTS

Current app version: **2.13.2**

TeamSnap manager console with authenticated Trace playing-time integration.

## Existing installation update

Replace `worker.js` in the deployed repository and commit the change. Cloudflare Workers Builds publishes the new version automatically. Existing D1 data is migrated in place on first use.

## First Trace connection

1. Connect TeamSnap and open the team you want.
2. Open **Playing Time** and choose **Connect Trace**.
3. Enter the email used by your Trace account.
4. Enter the one-time code Trace emails you.
5. myTS reads the teams available to that authenticated Trace account and verifies the TeamSnap/Trace match with completed fixtures.
6. Roster, game catalog, and playing-time data are cached automatically.

The Trace email and one-time code are not stored. The resulting Trace web session stays server-side and is never returned to the browser. Internal Trace team IDs are not shown in normal UI.

## Automatic updates

The included hourly Cloudflare schedule refreshes authenticated Trace connections. While myTS is open it also performs quiet status checks and incremental updates. If Trace expires the sign-in session, saved data remains available and myTS asks the user to reconnect.

## Files

```text
worker.js
wrangler.jsonc
package.json
README.md
```

`worker.js` contains both the website and its API backend. No terminal setup or manual D1 migration is required for an existing deployment.

## 2.13.2 Trace sign-in fix

Trace's successful browser request sends the account email in both `email` and `email_type`. myTS now follows that observed request directly instead of trying to reverse-engineer a value from Trace's minified frontend bundle.


## 2.13.2
Trace magic-code login now uses the exact `email_type=magic-code` value observed in the Firefox authentication diagnostic capture.
