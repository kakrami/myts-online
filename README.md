# myTS

Current app version: **5.1.0**

myTS combines TeamSnap team management with Trace performance data. Trace is a data source for the normal team experience, not a separate analytics product.

## Where Trace data appears

- **Overview** — season performance leaders and recent-match contributors.
- **Fixtures** — match cards include score, format, data confidence, and contributors.
- **Match Center** — Overview, Player stats, Events, and Availability live together in each game.
- **Team** — roster rows combine TeamSnap availability with appearances, starts, minutes, and G+A.
- **Player profiles** — Overview, Matches, Heat map, and Availability are combined in one profile.

There is no separate Stats tab in the main navigation.

## Trace data management

Admins can use **Team → Import Trace data** to drag/drop or choose the included `myts_trace_data.json`. **Trace settings** on the Team page manages the direct Trace connection.

The included unified dataset contains the 108 already-processed historical games in one `myts.trace` dataset, including the available player position/heat-map aggregates. It replaces the old three-ZIP workflow.

After Trace is connected, myTS can continue checking for new or changed Trace games. Existing published games are reused rather than rebuilding the historical set from scratch.

Private share-link users receive the same integrated read-only match and player experience, without Trace connection/import controls.

## Deployment

1. Keep the existing Cloudflare D1 binding named `DB` and existing `ADMIN_KEY` secret.
2. Replace the production files with this bundle and deploy `worker.js` normally.
3. Open `/admin` and connect TeamSnap if it is not already connected.
4. On **Team**, import `myts_trace_data.json` to seed/replace historical Trace performance data.
5. Use **Trace settings** if you want automatic collection of future Trace games.

R2 is **not required**.

## Production files

```text
worker.js
wrangler.jsonc
package.json
README.md
.gitignore
.dev.vars.example
myts_trace_data.json
```
