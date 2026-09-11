# myTS 4.1.0

TeamSnap team dashboard with private viewer links and owner-only Trace performance publishing.

## Normal flow

1. Open `/admin` and connect TeamSnap normally.
2. Select the TeamSnap team/season you want.
3. Open **Stats → Import stats**.
4. Drag/drop the same Trace files used by the Trace processor:
   - `trace_raw_compact.zip`
   - `trace_halo_all_games.zip`
   - `trace_analytics.zip`
5. myTS processes those files locally in the owner browser using the baked-in Trace processor/engine, shows a preview, then **Publish stats** stores the finished performance data in D1.
6. Copy the team's private viewer link from **Account**. Viewers see the published stats but never see the import controls or source files.

A `trace_player_processor_bundle.zip` containing those source ZIPs is also accepted. The older `myts_trace_data.json` export remains supported as a fallback.

## Important data behavior

- Trace source ZIPs are processed **in the browser**. They are not uploaded to the Worker.
- Only the normalized finished stats snapshot is sent to the owner-only publish API and stored server-side.
- Publishing a replacement is atomic: viewers continue seeing the previous complete dataset until the new one is fully stored.
- TeamSnap schedule, roster, availability, and other TeamSnap data are never modified by a stats import.
- Match → player shows stats for that match. Player profile shows season-level performance.
- Best-effort Trace confidence is represented by the small `% data` indicator rather than repeated warnings.

## Production files

```text
worker.js
wrangler.jsonc
package.json
README.md
.gitignore
.dev.vars.example
```

There is no `index.html` and no `tools/` folder. The frontend and the baked-in Trace processing harness are served by `worker.js`.

## Existing deployment

1. Replace the repository files with this bundle.
2. Keep the existing D1 binding named `DB`.
3. Keep the existing Worker secret named `ADMIN_KEY`.
4. Commit/push and let Cloudflare Workers Builds deploy it.
5. Open `/admin`.

Existing TeamSnap data, configuration, private viewer links, and previously published stats remain in D1. Database changes are created automatically on first use.

## Fresh Cloudflare setup

The Worker requires:

- Cloudflare D1 database bound as `DB`
- Worker secret `ADMIN_KEY`

```bash
npm install
npx wrangler d1 create myts
# Add the returned D1 binding to wrangler.jsonc / Cloudflare dashboard.
npx wrangler secret put ADMIN_KEY
npx wrangler deploy
```

The included cron refreshes saved TeamSnap data every 15 minutes. Trace performance changes only when the owner publishes a new import.

## TeamSnap OAuth

Create/use a TeamSnap OAuth application. Its redirect URI must be your deployed myTS origin plus `/admin`, for example:

```text
https://myts.example.com/admin
```

The TeamSnap connection is read-only.

## Private viewers

Each TeamSnap team has a private viewer link under **Account**. The owner can copy or rotate it.

Viewers can see the team dashboard, availability, fixtures/results, roster, published performance stats, match-specific player stats, player season stats, goal events, H2H/history, and reports. They cannot upload/remove stats, change mappings/settings, rotate links, reconnect TeamSnap, or call owner APIs.

## Security

- `ADMIN_KEY` is a Worker secret and is not embedded in the source.
- TeamSnap credentials are stored server-side and encrypted using the owner secret.
- Stats publish/delete endpoints require owner authentication.
- Viewer links are random bearer links and can be rotated.
- Trace ZIP source files never leave the owner browser during processing.
- Viewer APIs expose normalized dashboard data, not the original imported source files.

## Version

- myTS: **4.1.0**
- Trace processor baked into import flow: **5.2.0**
- Stats contract: **`myts.trace` 1.0**
