# Fresh private Coach contract

Coach lives in the original match tab and Coach attributes in the original player detail. The service and routes use only this build's canonical app team, team season, event and player IDs. Provider IDs, space IDs, compatibility readers and migrations are absent.

## Storage and permission boundary

`COACH_SCHEMA` exports nine fresh DDL statements. Typed profile rows and position ratings are separate from session clocks, captured roster availability, lineup slots, player/position/half stints, and append-only audit timeline rows. No account/team snapshot is stored in one JSON field. Timeline detail contains only one bounded action, not the session history. Profile ratings and sessions are owner-private and must never enter dashboard/viewer snapshots, statistics projections, general data exports or public caches.

All Coach service entry points and routes verify the owner before reading data. Writes require the application's exact origin. Team/season and canonical player/event membership are checked before commands; Coach requires a confirmed game, not a conditional slot or practice. Root authentication supplies a verified actor (`{owner:true}` or `{role:'owner'}`), never a client-provided actor.

`CoachingService(db,actor,{now?,resolveAvailability?,resolveRoleHints?})` exposes `read(scope)`, `profiles(scope)`, `setProfile(scope,value,revision)`, `command(scope,action,revision)`, and `resolveProfileIdentity(scope,choice)`. Injected time is for tests; request actions cannot set the server timestamp. The default attendance resolver reads the scoped canonical attendance view. An optional replacement attendance callback and past-role callback receive canonical scope. Exclude only an explicit `no`; `yes`, `maybe`, `nr`, unknown, and unresolved attendance remain included with their source label. The source layer normalizes the official TeamSnap status mapping before the Coach boundary. Root may supply separately labelled past-role hints from the analysis service.

## HTTP and presentation

Scope fields are `team_id`, `team_season_id`, `event_id`, and, for attributes, `player_id`.

- `GET /api/coach?team_id=...&team_season_id=...&event_id=...` returns `{owner:true,event_id,session,roster,profiles,identity_conflict?}`.
- `POST /api/coach` takes scope plus `{revision,action:{type,...}}` and returns `{session}` or `{revision,suggestion}`.
- `GET /api/coach/profiles?team_id=...&team_season_id=...` returns `{profiles}`.
- `PUT /api/coach/profiles` takes scope plus `{revision,value:{positions:{GK:5,CB:3},endurance:1..5|null,target_minutes:0..180|null}}` and returns `{profile}`. At most three rated positions are allowed. A previous-season profile carries forward with `inherited:true` and current-season `revision:0` until explicitly edited in the selected season.
- `POST /api/coach/profiles/resolve` takes scope plus `{choice}` below.

Responses are `no-store`. Unrecognized routes return null to the root router. Safe errors have `status` and `code`; the root error handler emits the message without exception internals.

A session includes `revision`, `format`, `half_minutes`, `phase`, `period`, `elapsed_ms` (saved clock), `live_elapsed_ms` (timestamp-derived clock), `period_elapsed_ms`, `running_since`, `clock:{elapsed_ms,running_since}`, `clock_review`, `unaccounted_ms`, `field:{position:canonicalPlayerID}`, `active:[canonicalPlayerID]`, `roster:[{id,name,jersey,available,availability_source,minutes,minutes_overridden}]`, `minutes_ms`, `recorded_minutes_ms`, the recorded/overridden/capacity totals, and `history`/`timeline` with labels and clock labels. The browser computes display ticks from the saved clock anchor. Ticks send no mutation requests.

Actions:

| Type | Fields and behavior |
| --- | --- |
| `create` | `format:7|9`, `half_minutes:5..60`; captures up to 100 current canonical roster players and initial attendance availability. Revision must be zero. |
| `availability` | `players:[IDs]`; setup, pause or halftime only. Remove a player from the field before excluding them. |
| `lineup` | `field:{position:ID}`; distinct available players, valid positions, at most the selected format; setup/pause/halftime. |
| `start`, `resume` | No timestamp field. A full lineup including GK is required. Start is setup-only; resume accepts pause/halftime. |
| `pause`, `halftime`, `end` | Server timestamp closes open stints and commits elapsed time. Halftime advances to half two without counting the break. |
| `substitute` | `out`, `in`; outgoing player is on field, incoming player is available and on bench. |
| `move` | `player`, `position`; repositions or swaps current field slots and splits affected position stints. |
| `correct` | Paused/finished only. `elapsed_ms` repairs the clock; `minutes:{ID:number|null}` stores or restores an explicit player-minute override. Minutes cannot exceed the match clock or total playing capacity. Backward clock corrections cannot cross the current half's start. |
| `late_substitute` | Paused/finished only. `out`, `in`, `at_minutes`, `duration`; outgoing player must actually cover the entire interval and incoming player must not overlap another stint. Splits/reassigns those ledger intervals, preserving total recorded minutes. Restore affected manual overrides first. Very long corrections (>250 intervals) are split into smaller sections. |
| `suggest` | Read-only recommendation. Full distinct available lineup; considers coach position ratings, current/target minutes, endurance, and optional separately labelled past-role hints. Reasons are returned. Never applies the suggestion automatically. |

Running gaps above 12 hours are exposed as `clock_review` instead of awarding implausible minutes. Pause freezes the last known clock; the owner explicitly repairs it before resuming. Lineup edits cannot silently rewrite past stints. Manual minute overrides remain separate from the recorded timeline.

## Concurrency and identity resolution

Every normal mutation begins a transaction with an insert/update at the expected revision and a unique write token. Each dependent lineup/availability/stint/timeline statement checks that token. A failed CAS writes nothing else. Commands use at most nine batch statements; no per-roster-player statement fan-out is used. Profile edits similarly guard the position rows. Session history is bounded to 1,000 audit actions.

The new domain's `canonical_player_ids` and `canonical_event_ids` views resolve aliases created when records in this build are explicitly linked. One aliased private record remains usable and editable using its existing storage row and revision. No identity is inferred by name. Two private records are not silently combined or chosen by time:

- Match conflict: GET returns `session:null` and `identity_conflict:{kind:'session',choices:[{event_id,revision,phase,format,elapsed_ms,updated_at}]}`. Owner action `resolve_session_identity` supplies `{keep_event_id,expected:[{event_id,revision}],discard:true}`. A transaction checks the complete current record set and **every** supplied revision before discarding the other plan and its roster/stints/timeline. A changed record rejects the entire choice. The retained plan's revision advances.
- Profile conflict: `profiles[canonicalPlayerID]` returns `{player_id,conflict:true,revision:null,choices:[{source_player_id,team_season_id,revision,value,...}]}` for competing attributes in the same latest season. `POST /api/coach/profiles/resolve` supplies scope and `choice:{keep_player_id:source_player_id,expected:[{player_id:source_player_id,revision:source_revision}],discard:true}`. The source revision is checked even when the profile is inherited with current-season revision zero; the chooser identifies the affected source season. Both revisions and the complete conflict set are checked before discarding the other attributes. Earlier season history remains separate.
- Duplicate session member: GET returns `identity_conflict:{kind:'session_player',event_id,revision,choices:[{player_id:canonicalID,source_player_id:storedID,name}]}`. Owner action `resolve_player_identity` supplies `{keep_player_id:source_player_id,discard:true}` with the current session revision. It explicitly removes the duplicate entry, its lineup slot, and recorded intervals. A running clock is paused as part of the same transaction. Unallocated minutes remain visible rather than invented.

The interface must show the affected private record and the discard scope before submitting these deliberate choices. Domain unlinking does not copy owner Coach history into a new source-only player. Viewer routes cannot observe any conflict data.

## Verification and remaining gates

`node --test tests/coaching.test.js` passes 15 tests on native Miniflare D1. They exercise profile validation/inheritance/privacy, attendance initial state, lineup/availability constraints, read/reload clocks without writes, pauses/halftime, 450 player minutes for 9v9/50 minutes, exact late intervals and overlap rejection, override capacity, two-device CAS, non-mutating suggestions, origin and context guards, 7v7, interrupted-clock review, clock correction, linked profile and match conflicts with stale choices, and explicit duplicate-roster resolution.

These are backend checks, not final browser or deployment acceptance. Still required: root runtime route registration; past-role callback wiring; original pitch tap/drag and chooser integration; two browser/device edits; locked-phone clock rendering; signed-out viewer export checks on the final package; and final Cloudflare execution. The existing .133 and 7.0.1 modules were inspected only for feature behavior and mathematics and are not imported.

Every Coach profile, session, and explicit identity-resolution mutation now begins with a native `coach_write_fences` CHECK requiring an existing app team and no deletion lifecycle marker in the same transaction. Deletion after context loading cannot create a profile, timeline, or session after cleanup has passed that table. The fence is removed before commit; failed lifecycle checks roll back every mutation. A native injected-deletion regression checks unchanged profile/session revisions.
