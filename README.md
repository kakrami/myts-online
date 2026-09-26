# myTS 6.20.119

Browser performance release. Existing stats calculations, API routes, background collection and database behavior are unchanged.

- Unchanged navigation skips dashboard serialization/cloning/storage writes using source references and edit revisions. Actual corrections, mapping changes, profile/logo/kit updates and data replacements still persist; failed writes can retry.
- No eager season heatmap aggregation in the roster. Player-detail aggregates are reused until source grids or minutes change. Match-player views use their existing native analytics path.
- Schedule's date and event carousels share a bounded 31-day window. Recenter after settling; calendar jumps, today, arrows, swipes, reduced motion and real season boundaries use the same date state.
- Equal dashboard refreshes preserve derived/view caches and detail stamps; same-season back navigation retains calculations.
- Background content comparisons reuse serialized immutable Trace rows/games. Removed duplicate main-view control mounting.

Package: worker.js, package.json, wrangler.jsonc, README.md. Existing bindings and secrets apply. No recollection or database migration.

Local validation is retained in performance-release/test.cjs in the separate audit archive. Server code is byte-identical to 6.20.118 apart from version. Local timing is not a device-specific responsiveness guarantee.
