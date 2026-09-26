# myTS v6.20.101

Cloudflare Worker + D1. Deploy the four included files with the existing workflow and existing bindings/secrets.

## Identity and participation

- Unknown jersey tracks do not inherit names from another game or take lineup slots.
- Explicit confirmed aliases apply only within their recorded season. Existing user corrections are retained; no new player/game-specific exceptions were added.
- Game-specific named Trace records establish candidates. Dated TeamSnap event/member links provide supporting evidence within the matching season. Attendance responses do not create appearances or prove absence.
- Original Trace home/away query labels survive normalization. Previously normalized away inputs are scheduled for recollection.
- Field/goalkeeper intervals are combined without double-counting. Format, concurrent-player and total-minute limits are enforced using the detected play window.
- Unsupported gaps are not forced onto players. Supported and estimated minutes are recorded separately; reconstructed minutes are labeled “est.” in the game statistics.
- Unverified and mixed tracks remain accessible in collection diagnostics, outside the roster and named-player totals. Players without participation are not published as substitutes.
- The collection audit does not demand player heat maps for excluded roster records without tracking evidence. Active players still require their analytics fields.

## Reliability

Expired synchronization alarms are rearmed. Incremental publication preserves saved results during recalculation. Valid saved heat maps are retained when subsequent source responses contain no replacement positions. Existing role-specific analytics and diagnostic request bounds remain in place.

App-imposed daily database caps remain disabled at the owner's request. Usage accounting, actual provider quota handling, and source rate-limit handling remain active.

## Verification and limits

The accompanying verification report records the final 112-game dataset checks and the September 19 regression result. Regression coverage includes duplicate roster records, cross-season isolation, native away query labels, attendance-independent participation, capacity rejection, minute reconciliation, absent-player audit handling, and overdue alarm recovery.

Passing these checks establishes internal consistency, not video-level accuracy. Source identity conflicts and unresolved tracking remain visible. The app does not automatically prove that an ambiguous track belongs to an opponent, split mixed tracks into named players, or claim complete historical roster membership from today's TeamSnap roster.
