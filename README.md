# myTS v6.20.104

Restores best-effort playing time among eligible, named game players. Direct tracking and confirmed role assignments take priority; remaining lineup slots use same-game and other-half evidence with a balanced allocation. Confirmed absences remain excluded. Anonymous tracking never becomes an extra player or inherits a former player's name through a reused jersey.

Dated TeamSnap game membership supplies players missing from Trace's named roster. An unmatched fixture can use dated membership from another game on the same day and within the same season. These inferred minutes retain their provenance internally without per-player estimation labels in the UI.

For the supplied 7v7/9v9 history, combined tracking population corrects small-pitch 5v5 classifications before minute capacity is calculated. Saved field geometry is retained. Player intervals cannot exceed the game duration or the simultaneous lineup limit.

Removes match collection diagnostics, unidentified-track controls, overview collection counters, diagnostic schedule filters, and `(est.)` minute labels from normal views. Settings diagnostics and source export remain available.

Validation: all 112 exported games replayed without errors or interval constraint violations; assigned minutes reconcile to capacity, confirmed absences and goalkeeper swaps persist, and repeated finalization is stable. East Valley September 19: 11 named players, 487.9 assigned player-minutes of 487.9 available. Allocation consistency does not make inferred individual minutes independently measured.

Engine 1.11.0-worker recalculates saved compact sources through the existing incremental background queue. No raw-source redownload is required for that refresh.

Required deployment files: worker.js, package.json, wrangler.jsonc, README.md.
