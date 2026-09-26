# myTS 6.20.113

Adds owner-only, bounded raw tracking capture under Trace → Manage → Tracking evidence. Select one saved game, one half, up to four player tracks, and at most 600 seconds. Capture makes at most seven Trace requests and reads at most 12 MiB of provider response data (one radar response at most 8 MiB, each Halo response at most 1 MiB). Forty-second deadline, no automatic retries or guessed radar URLs. One rate-limit record plus normal usage accounting. No stats, source-cache, collection-queue or publication changes.

A partial download explicitly records failure and retains successfully captured data. Token/cookie/profile credentials are never included. Raw radar frames and raw Halo drawing commands are retained for local analysis. Export source evidence continues to export all existing cached data in format 4.

The stats engine and normal collection behavior are unchanged from 6.20.112. Experimental stats changes are not part of this release.

Deployment files: worker.js, package.json, wrangler.jsonc, README.md. Existing Cloudflare bindings and secrets remain required.
