# myTS 6.20.117

Restores saved historical player rows to season totals when a game-scoped record has a unique matching identity. Explicit mappings and dated TeamSnap member IDs take precedence; game-scoped placeholder rows never acquire a player through jersey alone. Reconnects legacy name-keyed corrections only when same-season identity is unambiguous. Newer resets retain precedence.

This is a display/aggregation repair. It does not change stored minutes, goals, event attribution, allocation, engine/source versions, queues or database records. It does not certify the original inferred stats. Existing source export and bounded tracking capture are preserved. No provider calls or recalculation are introduced.

Deploy worker.js, package.json, wrangler.jsonc and README.md using existing bindings/secrets.
