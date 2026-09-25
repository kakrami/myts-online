# myTS v6.20.91

Cloudflare Worker + D1. Deploy the same four files using the existing workflow.

## Trace reliability

- Engine 1.9.0 removes season-weighted allocation of missing/unidentified minutes. Game-specific evidence establishes participation; unsupported gaps stay unresolved. Unknown tracked players remain game-only and are excluded from season player summaries.
- Removes the named-player goalkeeper heuristic and unconfirmed reciprocal role-switch inference. Existing recorded game corrections are retained as correction data and reused by the analytics resolver. No new player names, game IDs or dates are added to production rules.
- Confirmed goalkeeper/field switches use non-overlapping half queries through the existing full-game queue, with merged event counts and heat grids. No full-game goalkeeper stream is assigned to both players. Unestablished identities remain separate.
- Preserves valid heat maps across empty or failed subsequent responses; records absent/null/empty/invalid/failed outcomes. A failed half cannot replace a complete saved result.
- Applies engine upgrades before the sync completed fast path. Retained raw games are recalculated; source-less older imports are recollected incrementally under existing budgets. Published results remain available during recovery. No increase to batch concurrency or quota thresholds.
- Imports retain raw source and in-flight tracking rather than deleting replay evidence.
- Admin player diagnostics include stored replay inputs, overlapping identities, bounded half checks, and continuation for remaining scopes. Existing six-request and one-minute limits remain.

## Verification

Reviewed all 112 published games / 1,384 player rows; checked numeric integrity and minute reconciliation. Replayed four saved live diagnostic fixtures, prior identity regressions, actual SQLite audits/collector/recovery queries, half aggregation, interruption/cache preservation, tenant isolation and idempotence. Packaged startup and frontend script syntax checked.

This release does not claim every historical raw game is verified. 69 published rows lack independent participation evidence. Historical source recovery must complete before those rows can be confirmed or corrected. Trace can return genuinely empty data; missing identity evidence remains visible rather than being guessed or labelled complete.

Recovery follow-up: uniquely infer an established same-season goalkeeper only when all other named players have field evidence; retain ambiguity instead of claiming absence. Unassigned goalkeeper tracking blocks collection completeness. Display processed game counts during recovery.

Admin diagnostics now include cached heat grids and database reservation owners plus active request meters. Database limits and player calculation rules are unchanged.
