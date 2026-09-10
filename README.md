# myTS

Current app version: **2.13.5**

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

## 2.13.5 Trace sign-in fix

Trace's successful browser request sends the account email in both `email` and `email_type`. myTS now follows that observed request directly instead of trying to reverse-engineer a value from Trace's minified frontend bundle.


## 2.13.5
Trace magic-code login now uses the exact `email_type=magic-code` value observed in the Firefox authentication diagnostic capture.


## 2.13.5
Trace sign-in now follows the observed production sequence: resolve the Trace user ID from `/tracebot-prod/42/users/search?email=...`, then request the magic code, then submit `user_id + code` to `/users/login/by-code`. The email-send response is no longer expected to contain a user ID because Trace returns `{success:true,data:null}` there.

## 2.13.5
Playing-time synchronization is now progressive. The game catalog is returned immediately, the first player is processed as a fast-start batch, subsequent batches continue normally, and the Playing Time page shows the newest games first while their player-minute rows are arriving. Current TeamSnap roster players are prioritized ahead of historical Trace members.


## 2.13.5
Playing-time sync now uses the proven Trace radar reconstruction path when direct player_game_stats contains no usable minute rows. Sync is game-centric and newest-first: detailed game metadata and radar halves are fetched, the generic Trace minutes engine calculates one game, D1 saves it immediately, and the UI pulls that game before continuing to older games. Game processing state survives catalog refreshes and automatic hourly runs continue pending games.


## 2.14.2 — server-owned Trace synchronization
- The browser no longer calculates or drives the Trace backlog.
- D1 `trace_games.playing_status` is the persistent central queue shared by every device.
- Successful games remain cached across app releases; an app-version change does not invalidate historical radar calculations.
- The Worker starts a background batch immediately after Trace connection and cron continues the backlog every minute.
- Cron processes up to 3 pending games per tick, newest first.
- Completed game rows are saved after every game and are immediately available to any device.
- Trace catalog refreshes are change-aware; unchanged games keep their original update timestamp and are not re-downloaded/recalculated.
- `/api/trace/data` supports incremental `since=` reads so clients receive only changed games/player rows after the first full load.
- Manual "Check for updates" only queues a Worker-side refresh/retry; the page never owns the computation.

## 2.14.2
- Removed the visible 30-second polling state flip that caused the Playing Time page to flash between "Showing saved Trace data" and "Updating Trace".
- The page now re-renders only when Trace progress or saved data actually changes.
- Background backfill increased from 3 to 8 games per cron tick.
- Up to 4 games are calculated concurrently per wave.
- One Trace token/profile lookup is reused across each batch instead of repeating it for every game.
- Existing D1 game rows remain authoritative; completed games are not recalculated.
- Client data pulls remain incremental after a device has its initial saved snapshot.

## 2.14.2
- Fixed false `insufficient detailed metadata` failures caused by using the signed-in account profile as the rich-game context.
- Resolves authenticated Trace relations and connected-team player profiles, prioritizing relation users who are players on the connected team and current TeamSnap-roster matches.
- Verifies the chosen athlete profile against a real pending game before using it for the batch.
- Caches the verified team-access profile centrally in D1 for future Worker runs and devices.
- Automatically requeues only older metadata/profile failures. Successfully calculated games and rows remain untouched.
