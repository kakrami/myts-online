# myTS

Current app version: **5.0.1**

## Initial setup

1. Deploy `worker.js` with the existing `wrangler.jsonc` and D1 binding.
2. Open `/admin` and connect TeamSnap normally.
3. Open **Stats**.
4. Drag `myts_trace_data.json` onto **Load existing Trace data**. This seeds the 108 already-processed historical matches.
5. Connect Trace. myTS reconciles the Trace catalog against the imported game IDs, marks those historical games complete, and only collects new or changed games.

The unified JSON replaces the old three-ZIP workflow. It is a compact processed `myts.trace` 1.0 dataset; raw radar/Halo responses are not stored. R2 is not required.

## Manual data path

Admins can drag/drop or choose `myts_trace_data.json` directly from **Stats** at any time. Importing while Trace is already connected immediately reconciles matching game IDs and cancels temporary collection data for those matches. Share-link users only see the published stats.

## Automatic Trace path

After Trace is connected, scheduled sync checks the Trace game catalog and processes only games that are not already represented by the active unified dataset, or games whose catalog result changed.

## Files

```text
worker.js
wrangler.jsonc
package.json
README.md
.gitignore
.dev.vars.example
myts_trace_data.json   # one-time historical seed / manual backup
```
