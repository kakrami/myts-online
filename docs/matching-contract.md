# Match and player correspondence contract

Reference: original 6.20.133 implementation and targeted real public responses
checked October 10, 2026, America/Los_Angeles. No production code was changed.
No private TeamSnap or Trace endpoint was requested for this review.

## Actual Oct 10 correspondence evidence

| Official number | GotSport fixture | GotSport participants | Live fixture | Live participants | Exact kickoff |
| --- | --- | --- | --- | --- | --- |
| 187 | 27791413 | Home 212707, away 640333 | 7680417 | Home 199135, away 1351105 | 2026-10-10 20:20 UTC |
| 182 | 27791408 | Home 404654, away 212707 | 7680662 | Home 5199, away 199135 | 2026-10-10 15:00 UTC |

Fresh provider-owned club/season records explicitly assert:

| Live native team | Live club | Season | External provider/key |
| --- | --- | --- | --- |
| 199135 | 8548 | 7 / 2026/2027 | GotSport / 212707 |
| 1351105 | 24988 | 7 / 2026/2027 | GotSport / 640333 |
| 5199 | 12919 | 7 / 2026/2027 | GotSport / 404654 |

The canonical context is event **50598**, schedule **97933**, division **552093**,
bracket **767115**. Live context is organizer **28562**, category **378264**,
league **609382**, season **7**. Both providers give the exact event title
“Las Vegas Invitational FALL CUP 2026”, October 10–11 dates, the official website
domain `lasvegasheatsurf.com`, and season 2026/2027. The website paths differ;
the original contract compares the official domain, not complete URL equality.

The relevant canonical division returned nine fixtures. Live returned thirteen
category fixtures after paging both upcoming and past schedules to terminal
empty responses. Numbers 182 and 187 each identify exactly one fixture in each
complete relevant scope. Both participant identities and home/away orientation
agree through the explicit external keys. Kickoffs agree exactly. Results also
agree, but scores are corroboration and never the identity key.

There is **no direct cross-provider fixture key** in the schedule/game-header
responses inspected. GotSport's `live_game_url` and this event's `live_event_url`
are null. Live game headers have `GameNumber` and native IDs but no
`ExternalDataSourceKey`. The external key found in club team records proves a
team, not a game. The source's explicit team identity must not be stretched into
an assertion that any two games involving it correspond.

This evidence supports the original strict **composite correspondence** for
these two fixtures. It does not establish a provider-supplied game-ID mapping.
Store that distinction in the link method and evidence.

## What the original app actually did

There are two separate reconciliation paths in 6.20.133:

1. `gsFixtureEventContexts` → `gsFixtureCorrespondence` →
   `gsLiveCorrespondences` → `gsLivePresentation` establishes GotSport/Live
   presentation correspondence. It requires a unique event context, fresh
   explicit external identities for both participants, official match number,
   complete native source references, same orientation, and initially compatible
   exact kickoffs. Duplicate refs/numbers, ambiguous contexts, missing participant
   proofs, and unsupported orientation changes are rejected. Previous evidence
   may preserve an already established correspondence after a reschedule.
2. `canonicalMatchItems` → `reconcileFixtureSources` → `collapseFixtureItems`
   combines TeamSnap, Trace, and the public schedule for the frontend. It honors
   explicit game mappings first, but also uses `fixtureEvidence` name/date/venue
   similarity and unique-time candidates. It contains guards for squad conflicts,
   score conflicts, same-source identity conflicts, and ambiguous groups. Those
   guards do not turn name/time inference into provider-asserted identity.

The strict GotSport/Live helper is integrated, despite an older “standalone
candidate” comment in the source. A test extracted that unchanged pure helper
and supplied the actual fields from this review. It returned **two groups with
zero rejections and zero result conflicts**. Evidence is
`tests/evidence/original-matching-contract.json`.

Preserve the original frontend's unified presentation and review controls.
Reimplement correspondence in the shared domain service, rather than letting
each screen create its own inferred identities.

## Automatic links that are supportable

| Case | Link treatment |
| --- | --- |
| Same provider, same native fixture resource | Upsert the same source record; validate event/participants and flag contradictory observations. Do not create another app match because the feed changed. |
| Provider explicitly supplies another provider's fixture resource/key | Automatic provider-explicit link after validating namespace, target identity, context and participants. No such fixture key was found for the inspected examples. |
| GotSport ↔ Live with full strict composite evidence | Automatic composite correspondence: unique context, unique official number, both fresh explicit participant keys, orientation, resolved participants and initial exact-time compatibility. Persist the proof and its distinct method. The inspected Oct 10 examples satisfy this contract. |
| Source event/game explicitly stores a cross-provider reference | Validate the referenced account/team/resource before linking. An owner-created reference is an owner decision, not provider evidence. Current real TeamSnap/Trace payload support was not checked here. |
| Name, time, venue, score, jersey, or heatmap similarity | Generate a candidate for review. Do not use these alone to permanently assign a match or player identity. |
| Owner confirms correspondence | Persist a reversible owner decision, source references, scope, revision and audit time. Use it consistently across every view and export. |

One-to-one uniqueness is mandatory. A connected team can play multiple games on
the same day, including against the same opponent. A matching score or time is
not a substitute for source identity. A published TBD/playoff placeholder must
remain a schedule slot until its participants resolve; it cannot be linked as a
completed match or counted in played-game statistics.

## Required evidence and raw identity fields

Retain bounded identity/logistics fields per source record; keep response hashes
and observation metadata. This does not require a whole-team JSON snapshot or
copying unrelated public account/player information.

| Record | Fields to retain |
| --- | --- |
| GotSport fixture | Native `id`, `event_id`, `schedule_id`, group and bracket IDs, `match_number`, both native team IDs, both registration IDs, exact `matchTime`, local `match_date`, all-day/time-pending flags, status/score fields, venue/pitch IDs and links, `live_game_url` when present |
| Canonical event | Native event ID, exact official name, official start/end dates, `seasonal_year`, website URL/domain, `live_event_url`, schedule groups/brackets and each verified relationship |
| Live fixture | `GameID`, organizer/category/league IDs, `GameNumber`, both team and club IDs, sports-platform/resolved-participant flags, `GameTime`, `TimeNotSet`, cancellation/postponement/result-publication flags, native scores, arena ID and source link |
| Live event/category | Organizer ID, exact official name, start/end dates, website URL/domain, season ID/name, category→league relationships and format/type |
| Participant crosswalk | Club ID, selected season ID/name/default flag, native `TeamID`/`ItemID`, `ExternalDataSourceID`, name and exact key; validated response endpoint/query, status, hash, observed/checked times and freshness policy |
| Correspondence | Both native refs, event/context proof, official number, ordered participant proofs, scope IDs, method, initial kickoff evidence, checked time, conflicts, and owner revision if manually decided |

The candidate parser already retains official numbers and some registration/scope
fields, but drops important evidence:

- Live fixture home/away club IDs and arena ID.
- Canonical event `seasonal_year` and its original bridge field in the persisted
  event projection.
- GotSport fixture `live_game_url`, venue/pitch IDs and all-day evidence.
- Crosswalks for opponents; currently the resolver establishes the connected
  team's identity and does not collect the fresh keys for both match participants.
- A shared fixture correspondence record and proof-backed projection.

Those omissions explain why native GotSport and Live rows still appear separately
even when a strict correspondence can be established from current public data.

## Ambiguities, changes and conflicts

- Reject automatic correspondence if either participant is unresolved, proof is
  missing/stale/conflicting, context has multiple candidates, match number is
  absent/reused, or either fixture already has another verified counterpart.
- Keep explicit owner decisions ahead of inferred candidates. A conflicting
  refresh creates a review issue; it cannot silently replace the decision.
- After a verified match is rescheduled, preserve its app identity and previous
  source correspondence while revalidating native references and participants.
  A new date alone is not a new game; a changed participant is not merely a time
  edit.
- Require an explicit orientation policy for swapped home/away data. Never
  silently reverse scores or source identities.
- Retain conflicting results as separate observations of one linked match.
  Show a conflict and resolve source authority/owner correction; do not double
  count the match or silently sum/choose results based on fetch order.
- A missing record in a later feed is not cancellation. Preserve it with accurate
  coverage and source status until an explicit update establishes its state.

## Player identity

The public checks here establish team and fixture correspondence, not player
identity. No actual cross-provider player external key was verified.

The original `matchPlayer` prioritizes explicit `player_map` decisions and
`teamsnap_member_id` associations. It then considers unique normalized names,
with per-game duplicate guards, and limited placeholder/jersey fallbacks.
`tracePlayerIdentity` prefers an assigned canonical key/user ID but can fall back
to name plus jersey. Preserve its familiar correction controls; do not preserve
the fallback as a durable canonical identity rule.

The rebuild needs stable app player identities with separate provider resources
and season/team memberships. Keep Trace native user ID, game-scoped GID/track,
roster side, dummy flag and jersey observations separate. A jersey change,
unidentified tracer, opposing goalkeeper, or same name cannot create a verified
player association. Owner-confirmed mappings must project one player across
roster, attendance, analysis, Coach, reports and exports. Match-specific identity
corrections take precedence over season defaults, which precede inference.

Real TeamSnap/Trace roster and game payloads must be checked before claiming
provider-explicit player/event associations are available. Existing field names
in the old app alone do not prove they were supplied by a provider rather than
created by the app's matching/manual-correction layer.

## Season boundaries

The original `seasonYearForDate` uses **June through May** (`month >= 6` starts
the new app season). Candidate July–June behavior is a regression. Preserve the
app's existing boundary and preseason rules. Provider season IDs/names and
GotSport's `seasonal_year` remain source context; they must not silently replace
the app's calendar rules.

## Evidence and limits

- `tests/evidence/matching-public.json`: canonical history/event context and
  current Live membership metadata.
- `tests/evidence/matching-target.json`: 15 targeted real public GETs, terminal
  relevant schedule coverage, unique official numbers, game-header fields and
  explicit participant external keys.
- `tests/evidence/original-matching-contract.json`: unchanged original strict
  helper accepts the two observed correspondences.
- Reproducers: `tests/matching-public-check.mjs`,
  `tests/matching-target-check.mjs`, `tests/original-matching-proof.mjs`.

This proves the two reviewed public correspondences under the stated composite
contract. It does not prove every competition, private provider payload, or
production correspondence workflow. The app still needs a shared canonical
match/player model and complete end-to-end acceptance tests.

