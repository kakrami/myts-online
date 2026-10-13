# Bookmarks native read repair — 7.2.19 review

Parent production release: `600384cdbd06d390fe482f66f73b1d978a5889b7` (7.2.18).
The Bookmarks alert was observed on active Worker version
`808513c6-c286-4369-8f78-39d65f172736`. Its exact production exception has not
been retrieved, but the ordinary Bookmarks read independently reproduces
`Expression tree is too large (maximum depth 100)` in native Workerd/D1, even
with an empty saved team. This is a confirmed implementation defect consistent
with the live symptom, not a claim that the production exception was captured.

## Change

Construct each available own-game JSON snapshot in a materialized CTE before
looking it up from a bookmark. Previously the correlated snapshot expression
nested all its field references directly over the published-game scope graph.
That combined expression exceeded D1 depth100. The individual scope and public
source queries compiled; the combined current-bookmark projection did not.

All published membership, local availability, original-key preservation,
canonical mapping, season ordering, saved snapshot fallback, revision fences,
pagination and owner/viewer rules remain. This adds no SQL statement, schema,
provider request or mutation. The repaired grouped list used 19/48 statements
including eight reserved for preceding route work. Runtime change is confined
to `TeamFeatures.bookmarks`; release metadata identifies the candidate as7.2.19.
Production remains7.2.18 until a separate promotion.

## Regression coverage

- Native empty-team owner HTTP read returns200 and an empty list.
- Saved-only originals paginate without gaining edit authority or changing rows.
- Normalized own-game list maps the saved original to the published target,
  preserves original IDs and returns the same opaque scope revision.
- Existing stale-token, unlink, split and concurrent-scope tests retain authority.
- Actual DOM Schedule date-button click requests the new day, moves the pressed
  state and renders its practice; no Schedule runtime change is justified.
- The existing native Schedule Analyzed fixture lacked source membership and
  event links. These are now seeded, without jobs or provider calls. The original
  ordering/pagination/selection assertions are unchanged. Both native Schedule
  cases pass, including timezone rollback/calendar agreement.

Final targeted runs:38 native/owner-scope cases and4 DOM cases pass, zero skips.
Release check and Wrangler build dry run pass. The production-visible failure
still requires reopening Bookmarks against a promoted repair; local success
alone is not live acceptance.

## Current live evidence and remaining check

The delegate observed Schedule requests for2026-10-14 on the released version;
one inspected request was canceled. That is not proof of a Schedule defect.
Reports eventually loaded matching saved totals. Two closed-app alarms were
successful, with CPU50ms and23ms; dashboard percentiles included UI traffic and
were not scoped throughput measurements. D1 invocation counters were unavailable.

After an authorized7.2.19 promotion, verify its exact build/full active version,
then open Bookmarks through the original navigation and confirm empty or saved
rows load, filters work, and details retain their original saved context. Do not
create/delete bookmarks solely to manufacture acceptance evidence. Recheck a
settled Schedule date transition. Continue the existing pinned closed-app Trace
cohort separately; this repair neither changes its scheduler nor retries denied
radar jobs. No secrets, bindings, cron, data or configuration changes are needed.
