# 7.2.3 TeamSnap attendance diagnostics

## Established live boundary

The deployed 7.2.1 attendance job failed on its first page with
`contract_violation`, zero saved pages/rows and an empty checkpoint. Its exact
attempt and scan have a successful HTTP 200 observation, 29,445 response bytes
and no transport error. The event history subsequently completed two traversals
and published all 721 games across five seasons. The attendance failure predates
7.2.2; that release did not change the TeamSnap response normalization.

The existing generic status message did not retain the specific internal
predicate. Numeric/string/null/unknown status codes are accepted. Missing
`event_id` or `member_id` yields a different error code. Several unchanged guards
can reproduce this observed signature: invalid or repeated availability item
identity, changed continuation scope, foreign row team, or an invalid item link.
None is yet established as the live cause. No guard is weakened in this release.

## Privacy-safe diagnostic boundary

Only a TeamSnap attendance contract failure during fetched-page processing may
receive additional metadata. Its exact existing static throw message selects
an allowlisted reason. Unknown failure messages remain generic. Counters cover
only bounded item counts, invalid/duplicate identity counts, valid/duplicate
pair counts, foreign-team counts, or next-link comparison booleans. The failure
formatter independently rejects unknown keys, invalid types/ranges and reasons.
It stores no provider error text, body, source value, name, identifier, URL,
credential or arbitrary property. The final status message is below 512 bytes.

Annotation is fail-safe: diagnostic exceptions, oversized field structures or
an immutable error preserve the identical original error. The existing
`contract_violation` code and permanent category remain unchanged. Successful
collection, pagination, coverage, authority and commit behavior are unchanged.

## Supported targeted retry

The signed-in owner opens TeamSnap **Manage** and chooses **Retry attendance**
for the selected connection. The action appears only when that connection has
failed attendance work. It uses the existing browser session and the guarded
POST `/api/connections/{connection_id}/attendance/retry` with only `team_id`
and the current connection `generation`. The server resolves
its own exact existing TeamSnap attendance job. It accepts no caller-supplied
job, provider URL, credential, account, query or checkpoint.

The command requires the same-origin owner session, active connection and team,
current account generation and source entitlement, matching source/root demand,
and a failed unleased attendance job. Transaction-time fences recheck authority
and the failed snapshot. If a session expires between batch statements, earlier
status-only cache revisions may advance, but the final job activation still
rejects the expired session. The command preserves the scan, checkpoint, generation,
coverage, records and all other jobs. It does not refresh completed events.
A validated queued replay preserves rows and repairs an interrupted wake using
the existing coalescing scheduler. Other job states or changed authority are
rejected. This is a recovery action, not a generic administration endpoint.

Manage receives only a read-only boolean eligibility hint for the exact selected
connection, independent of provider summaries or paginated job lists. The server
command remains authoritative. Duplicate pending clicks do not send another
request. Close, navigation, source selection and replacement sheets fence late
responses. Reopening while a retry is pending offers **Reload status**; the old
response cannot overwrite that newer sheet. A confirmed command says only that
the retry is queued, and links the user to the existing import progress view.

## Verification and release boundaries

- Diagnostic, pagination, refresh and catalog regression aggregate: **33/33**,
  zero skips, including 10 diagnostic/redaction cases. Independent diagnostic
  rerun: **10/10**.
- Native Workerd/D1 HTTP, full physical installation schema and epoch guards:
  **12/12**, zero skips, 34.5 seconds on the frozen bytes. Covers owner/same-origin checks, exact
  source/account/root demand, held-commit revocation and natural session expiry,
  changed job state, shared demand, separate-account isolation, concurrent retry,
  and commit-to-wake interruption recovery. The retry route uses at most
  **14/48** HTTP SQL statements, including a conservative two-query reserve;
  connection setup in the complete fixture reaches **40/48**. Unrelated public
  jobs/status remain untouched, and a removed root cannot borrow another
  root's continuing demand for the shared attendance job.
- The native collector-to-coordinator failure case persists a successful HTTP200
  audit and the bounded `attendance_identity` diagnostic while retaining the
  permanent `contract_violation` category. It saves no attendance row and does
  not advance checkpoint, scan, generation, coverage, page/row counters or any
  other job. This synthetic response proves diagnostic plumbing, not the live
  failure cause. That measured invocation uses **13** SQL statements.
- The first native retry run exposed D1's expression-depth limit. Separately
  materializing the command precondition fixed the query shape; no authority
  predicate or limit was removed. Failed receipts are retained separately from
  the terminal pass.
- Adjacent existing unguarded retry compatibility: **3/3 selected native cases**
  pass in 6.78 seconds (audit/checkpoint retention, blocked recovery and bounded
  budget recovery). The other 27 tests in that file were excluded by the exact
  name filter; this is not a whole-file pass. Two manually enumerated native
  fixtures now include the diagnostic module dependency. The Trace fixture was
  syntax-checked only; no new Trace native run is claimed.
- Native Manage availability read: **1/1**, zero skips, 16.05 seconds. Actual
  status and connection-catalog HTTP routes return an exact-root boolean, remain
  read-only and stay within the unchanged 48-statement request limit. Covers
  same native team in separate accounts, all nonfailed states, running leases,
  stale account/demand generations, inactive roots/accounts, imported or
  unowned sources, changed native scope and missing entitlement. This is a
  separate receipt from the earlier 12-case command/diagnostic run.
- Actual-main DOM aggregate: **99/99** (29 new retry workflows and 70 existing
  connection UI cases), zero skips, including the ordinary
  Settings → TeamSnap Manage → Retry attendance path, selected-root visibility,
  duplicate clicks, unconfirmed/error replies, owner expiry, dismissal, newer
  navigation, real browser Back/Forward and Close → reopen → Reload status
  recovery.
- Release closure and pinned Wrangler 4.149.0 dry-run build pass at 7.2.3.
  The exact archive requires an independent byte audit before publication.

All provider responses in these tests are synthetic; no actual provider request
is made by the native fixture. No new whole-suite acceptance is claimed. The
schema, upgrade plan, bindings, CPU budget and dependency versions are unchanged.

After deployment, verify `/api/health` reports 7.2.3, then use the targeted retry
once using **TeamSnap Manage → Retry attendance** in the existing signed-in
owner session. Read only the stored static
reason/counts, audit status and job progress. Do not fetch or export the raw
private response or restart the completed event job. The resulting diagnostic
must identify the next repair; this release is not a claim of successful live
attendance import or full application acceptance. Earlier aggregate limitations
remain in `integration-checkpoint.md`.
