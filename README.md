# myTS v6.20.103

Game roster resolution uses season-scoped, dated TeamSnap evidence and game-specific Trace records. Current roster absence and Trace account creation dates do not exclude historical players. Explicit departure conflicts remain unidentified unless supported by a dated game link. Game-only records do not become season roster members by jersey matching.

Duplicate accounts on one named track have a deterministic identity. Different named identities on one track are quarantined. Multiple jerseys sharing a stable player identity are combined only when their tracking intervals do not overlap. Untracked records remain unresolved rather than being labeled absent.

Admin source export supports replay of all saved inputs without changing published data. Engine 1.10.1 refreshes roster metadata from saved source inputs. All 112 games were replayed with zero positive-minute changes. Prior pitch-derived format assignments remain unverified: this release does not claim historical minutes or formats have been corrected.

Required deployment files: worker.js, package.json, wrangler.jsonc, README.md.
