# myTS 6.20.112

Completes the existing **Export source evidence** download. The filename remains `myts_source_evidence.json`; **Export data** keeps exporting calculated results.

Evidence format 4 contains all saved native analytics payloads, including timestamped shots, touches and passes; every cached side, player and period; compact metadata, identities, tracking intervals, summaries and staged results; published match snapshots; raw TeamSnap roster/event/availability/opponent/location resources; player identities, player/game mappings, manual corrections, and saved engine settings or applicable legacy correction inputs.

A one-time inventory includes games present only in the catalog, source store, analytics manifest, analytics scopes or active published history. Four-game batches use existing team/game indexes. Shared resources and corrections are read once. Missing records, missing scope data, empty payloads, pending/error states and malformed stored JSON remain identifiable. Exports contain saved timestamps and are not transactional database backups. Video files and original radar frames are not stored in this cache.

The export reads existing D1 records only. It does not call Trace, queue collection, recalculate matches or publish results. Native scope payloads were already read by the old exporter but largely discarded; this release retains them. The initial inventory and shared corrections/mappings add bounded-purpose reads; the payload/download is larger. No live usage reduction or quota percentage is claimed.

If the active stats generation changes or any page fails, the download fails rather than saving an incomplete file. Refresh older open app tabs before using the updated export.

This release is isolated from the unvalidated 6.20.110/111 stats work. Calculation code, engine/source versions, background queues and unrelated UI are identical to the committed 6.20.109 baseline. It does not claim to fix inaccurate historical stats.

Validation: Worker and inline browser syntax; local SQLite using production schemas; complete source/catalog/analytics/published/scope-only inventory; all native event fields retained; tenant isolation; manual zero/false corrections; both sides and all periods; missing/invalid/retained-error evidence; generation guard; complete multi-page browser-function download and failure cancellation; exact code parity outside export/version changes. No live database calls were made for these tests.

Deployment ZIP contains exactly `worker.js`, `package.json`, `wrangler.jsonc`, and `README.md`.
