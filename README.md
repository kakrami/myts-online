# myTS v6.20.107

Restores best-effort playing time among eligible, named game players. Direct tracking and confirmed role assignments take priority; remaining lineup slots use same-game and other-half evidence with a balanced allocation. Confirmed absences remain excluded. Anonymous tracking never becomes an extra player or inherits a former player's name through a reused jersey.

Dated TeamSnap game membership supplies players missing from Trace's named roster. An unmatched fixture can use dated membership from another game on the same day and within the same season. These inferred minutes retain their provenance internally without per-player estimation labels in the UI.

For the supplied 7v7/9v9 history, combined tracking population corrects small-pitch 5v5 classifications before minute capacity is calculated. Saved field geometry is retained. Player intervals cannot exceed the game duration or the simultaneous lineup limit.

Removes match collection diagnostics, unidentified-track controls, overview collection counters, diagnostic schedule filters, and `(est.)` minute labels from normal views. Settings diagnostics and source export remain available.

Validation: all 112 exported games replayed without errors or interval constraint violations; assigned minutes reconcile to capacity, confirmed absences and goalkeeper swaps persist, and repeated finalization is stable. East Valley September 19: 11 named players, 487.9 assigned player-minutes of 487.9 available. Allocation consistency does not make inferred individual minutes independently measured.

Engine 1.11.0-worker recalculates saved compact sources through the existing incremental background queue. No raw-source redownload is required for that refresh.

Required deployment files: worker.js, package.json, wrangler.jsonc, README.md.

## 6.20.105 — saved-game processing efficiency

Background calculations omit unused live-status reports, read published matches only for the relevant season, and avoid recounting totals already maintained by publication. Queue candidates load IDs instead of raw tracking payloads. Refresh checks preserve games completed by the current engine. Engine and source versions remain unchanged; this release does not request a full recalculation or source download.

Validated locally against the downloaded 112-game evidence and mocked database paths; production resource savings are not yet measured.

## 6.20.106 — complete cached heatmap evidence

Source evidence export v2 includes cached analytics manifests and every saved scope for each exported game: both sides, unidentified tracks, goalkeeper streams, empty/error scopes, heatmap grids and identity-plan provenance. Two bounded database reads per nonempty export page use the existing team/game keys. Export does not contact Trace, enqueue work, recalculate, or publish. Engine/source versions remain unchanged. Includes 6.20.105 efficiency changes.

## 6.20.107 — shared identity and goalkeeper allocation

The minutes engine resolves an unnamed jersey only when multiple named games in the same season agree and that player has a dated roster link in the target game. Direct named conflicts remain protected. Each half reserves exactly one keeper slot; confirmed roles take precedence, followed by unique elimination and best-effort role history, heatmap and field-tracking evidence. Lineups use the starting keeper and at most format-minus-one outfield players. Resolved jersey identities also select their existing native heatmaps.

Engine 1.12.0-worker does not invalidate completed 1.11.0-worker games at deployment. Historical corrections can be calculated offline and applied through the existing Trace import using cached_replay metadata: source timestamps guard against stale evidence, unchanged reimports skip writes, only supplied changed games are updated, and no Trace collection or engine queue is started. Normal future-game calculation uses the shared logic with saved heatmaps.

Local validation used the 112-game source export, including actual cached grids. Thirty games changed; every half/bin has one goalkeeper and bounded outfield slots, all capacity checks passed, goals/assists were preserved, and the corrected lineup models contain exactly one goalkeeper. August 11 resolves Hunter to the keeper stream (47.3 minutes) and Sawyer to #16 (36.6 minutes). These are best-effort assignments, not independently confirmed match observations. SQL import tests cover stale input rejection and zero-write repeat import. Live changes require applying the accompanying prepared data file after deployment.
