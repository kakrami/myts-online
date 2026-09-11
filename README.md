# myTS 4.0.0

A finished TeamSnap team dashboard with server-side publishing and private viewer links.

## Product flow

1. The owner opens `/admin` and connects TeamSnap normally with the TeamSnap OAuth Client ID.
2. TeamSnap schedule, roster, opponents, locations, availability, seasons, results, and history are synchronized into Cloudflare D1.
3. The owner creates the performance export with `tools/trace_player_processor.html` and **Export myts data**.
4. In myTS, open **Stats** and drag/drop `myts_trace_data.json`.
5. myTS validates the `myts.trace` v1.0 contract and publishes the processed match/player stats to D1 for the selected team.
6. Copy the team's **private viewer link** from Account. Viewers can see the dashboard and published stats without TeamSnap or owner access.

The upload controls and stats mutation API are owner-only. The viewer link is read-only. Replacing an import switches the active stats dataset only after the complete replacement has been stored, so viewers do not see a half-imported dataset.

## What is included

```text
worker.js
wrangler.jsonc
package.json
README.md
.gitignore
tools/
  trace_player_processor.html
  trace_raw_compact.zip
  trace_halo_all_games.zip
  trace_analytics.zip
```

`worker.js` contains the website and API backend. Database tables are created/upgraded automatically on first use.

## Existing myTS deployment

This build upgrades the current server-backed myTS installation in place.

1. Replace the repository files with this bundle.
2. Keep the existing D1 binding named `DB` and the existing `ADMIN_KEY` Worker secret.
3. Commit/push. Cloudflare Workers Builds deploys the update.
4. Open `/admin`.

Existing TeamSnap data, owner configuration, and private viewer links stay in D1. Old Trace/R2 tables are ignored by the new stats publishing flow. An R2 binding is **not required** for myTS 4.0.

## Fresh Cloudflare setup

The Worker needs:

- a Cloudflare D1 database bound as **`DB`**
- a Worker secret named **`ADMIN_KEY`**

With Wrangler:

```bash
npm install
npx wrangler d1 create myts
# Bind the created database as DB in wrangler.jsonc / the Cloudflare dashboard.
npx wrangler secret put ADMIN_KEY
npx wrangler deploy
```

You can also create the D1 binding and `ADMIN_KEY` in the Cloudflare dashboard and let GitHub/Workers Builds deploy the repository.

The included schedule refreshes the saved TeamSnap data every 15 minutes. Stats are intentionally updated only when the owner publishes a new stats file.

## TeamSnap OAuth

Create or use a TeamSnap OAuth application. Its redirect URI must be your deployed myTS origin plus `/admin`, for example:

```text
https://myts.example.com/admin
```

On the first visit to `/admin`, enter the owner key and TeamSnap Client ID. myTS sends you through the normal TeamSnap OAuth read-only connection flow.

## Publishing stats

The included Trace processor remains a local/admin tool; viewers never use it.

1. Open `tools/trace_player_processor.html`.
2. Load/process the Trace data as usual.
3. Choose **Export myts data**. This creates `myts_trace_data.json`.
4. Open the matching team in myTS `/admin`.
5. Open **Stats** → **Import stats**.
6. Drop the JSON file into the upload area and review the team/match/player preview.
7. Choose **Publish stats**.

The server stores the normalized match payloads by team. The original upload is not exposed through the viewer API. The private viewer endpoint returns only the performance data needed by the dashboard.

### Replacement behavior

Publishing another file for the same TeamSnap team creates a new server-side import first, switches the team to it when complete, and removes the previous match payloads afterward. TeamSnap schedule/availability data is never modified by a stats import.

### Matching

myTS correlates imported games to TeamSnap fixtures using date, opponent, and score evidence. Player matching uses the existing TeamSnap roster plus imported identity/name/jersey evidence. Owner corrections from the Stats **Review** view are stored server-side and shared with all viewers.

## Viewer experience

Each TeamSnap team has its own private link under **Account**. The owner can copy or rotate it.

Viewers can see:

- Overview and season context
- Events and availability
- Fixtures/results
- Team/roster
- Stats
- Match-specific player performance
- Player season performance
- Goal events from the imported match reconstruction
- History/H2H
- Reports

Viewers cannot connect TeamSnap, upload/replace/remove stats, change mappings/settings, rotate links, or use owner APIs.

## Data-quality presentation

Trace is an inconsistent source, so myTS treats the imported output as best-effort performance data. The normal UI does not repeat warning messages. A small `% data` indicator is shown in the relevant stats context where a confidence/coverage value exists.

## Security notes

- `ADMIN_KEY` is never embedded in the Worker source.
- TeamSnap access is stored encrypted server-side using a key derived from `ADMIN_KEY`.
- Viewer links are random bearer links and can be rotated immediately by the owner.
- Stats import/delete routes require the owner key.
- Viewer APIs enforce the team represented by the viewer link.
- The stats source snapshot metadata remains server-side; viewers receive only normalized display data.

## Version

- myTS: **4.0.0**
- Stats contract: **`myts.trace` 1.0**
