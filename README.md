## v6.20.100 — conservative identity and minutes reconciliation

Unknown Trace jersey tracks no longer inherit names from other games or occupy lineup slots. Only explicit confirmed aliases may cross games within one season. Named game identities remain eligible; dated TeamSnap event/member links provide supporting evidence, never an attendance gate. Historical roster absence is not inferred from today’s roster. Original Trace query labels survive home/away normalization; saved away-game inputs are recollected once. Observed and inferred minutes remain separate. Per-game interval checks enforce format capacity and reject overlapping roles or time outside play windows. Unverified tracks remain in diagnostics, outside named-player totals; no-participation rows are not published as substitutes. Mixed tracks are withheld rather than split speculatively.

No new player- or game-specific exceptions were added. Existing explicit user corrections are retained. App-imposed D1 daily caps remain disabled at owner request; actual provider exhaustion and source rate limits remain handled.

# v6.20.100 — Provider-enforced database limits

App-imposed daily database read/write caps are removed at the owner’s request. Usage accounting remains active. Collection continues until completion or an actual Cloudflare quota error; provider exhaustion retains the next-day automatic retry.

# myTS v6.20.100

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

Budget accounting separates API reservations from the lower background threshold while retaining every reservation against the overall cap. Explicit update requests recheck current capacity; no reservations are erased and no limits increased.

Incremental publication atomically updates only changed match payloads and their dataset cursor. Unchanged games incur no publication writes; concurrent imports and reads remain guarded.

6.20.100 corrects the database reservation estimate for atomic single-row match publications. Unbounded operations retain their conservative allowance; daily limits are unchanged.

6.20.100 adds bounded, admin-requested raw goalkeeper tracking diagnostics for established same-season keeper candidates. It does not assign identities or update analytics caches. Explicit diagnostics use the existing API allowance; background limits remain unchanged.

6.20.100 checks all game-roster goalkeeper candidates in bounded diagnostic pages, prioritizing established keepers. Each page compares one half and retains the existing six-request maximum.
