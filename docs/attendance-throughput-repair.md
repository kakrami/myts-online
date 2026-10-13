# 7.2.6 bounded attendance throughput

## Purpose and live boundary

This update improves TeamSnap attendance collection after the 7.2.4 identity
repair. The live scan had saved all 5,455 unique pairs by 2026-10-13 02:07:25 UTC,
using 219 provider pages of at most 25 rows. It continued through the 7.2.5
release without a reset. Its second traversal was still pending while connection
reconciliation and five higher-priority season projections advanced. That is
live first-pass progress, not verified completion or proof of this candidate.

The three changed source modules are `teamsnap-batch.js`,
`teamsnap-pagination.js` and `teamsnap.js`. Scheduler priorities, materialization,
projection policy, identity, freshness cadence, validation limits, schema and
configuration are unchanged. Do not restart or replace the active live scan to
measure this optimization. Its saved page size, offset, digest, traversal proof,
refresh window and job/account/root identities remain valid.

## Page preference and compatibility

The official [TeamSnap iOS schema](https://github.com/teamsnap/teamsnap-SDK-iOS/blob/f91ddd0222767b228c99799955d60c69d825e6cd/TeamSnapSDK/SDK/Resources/schemas.json)
and [recorded Ruby API contract](https://github.com/teamsnap/teamsnap_rb/blob/086121e27a543bc7606112a808adc3811ed847a8/spec/cassettes/teamsnap__collection/supports_relations_with_expected_behaviors/when_a_plural_relation_is_called/responds_with_an_array_of_objects_when_successful.yml)
expose `page_size` and `page_number`. They do **not** establish a numeric maximum,
that the current server accepts 100, or its over-limit behavior. Accordingly,
100 is a client request preference for new attendance scans, not a documented
provider guarantee. Events still request 25.

- Valid active attendance cursors retain 25, 12, 6, 3 or 1 exactly. New cursors
  can additionally use 100 or 50. No identity/protocol version is changed.
- Before choosing a new size, a serialized worst continuation is checked against
  the unchanged 8,192-byte limit. It includes the actual refresh binding, URL,
  frozen date window, full/recent receipts, prior traversal, 100 maximal numeric
  pairs when relevant, eight hashes and maximum-width counters. If needed the
  new preference shrinks through 100/50/25/12/6/3/1 before any fetch.
- Successful preferred pages need matching numeric page metadata. An explicitly
  smaller, internally consistent server page size triggers a no-data restart at
  the largest supported size no greater than that cap. A cap of 40 therefore
  selects 25; further response-size reduction selects 12 and retains it on resume.
- A metadata-free first preferred page cannot certify an unadvertised short
  collection. After validating any supplied continuation link, it restarts at
  25 without accepting records. Missing metadata later in the traversal fails
  visibly. The existing 25-page terminal rules remain unchanged.
- A first request at a preference above 25 can fall back once to 25 following
  HTTP 400 only when the collector receives `source_http` and the exact newly
  appended transport observation identifies that same endpoint, complete query,
  status and error category. It preserves the endpoint, team, filters and frozen
  refresh start. This is a bounded differential compatibility attempt, not an
  inference about why the provider rejected the request. A 25 request cannot
  repeat it. Authentication, permission, rate-limit, server, later-page and
  verification errors retain their existing classification and retry behavior.
- Streamed responses over the unchanged 2 MB cap reduce the partition and restart
  traversal proof while retaining saved rows. A single oversized record still
  fails. Foreign, ambiguous, duplicated or changed continuation parameters do
  not become compatibility fallbacks.

Two matching complete observed traversals, pair-based identity, adjacent overlap
and bounded repeat-ring guards remain required. They demonstrate observed
convergence, not a server snapshot. Changes can require a bounded catch-up pass
and the existing delayed retry. Full-history and recent-window receipts stay
separate; no new provider filters or recurring scan cadence is introduced.

## Compact storage admission

Attendance now estimates the JSON parameters actually persisted by the existing
auxiliary writer: scoped source keys, pair ID, normalized status, source-status
string, observation timestamp, provenance/hash and dirty-event ID copies. It
no longer charges the event DTO's redundant evidence/layout allowance to every
attendance row. Event sizing is unchanged.

The 1,000,000-byte source-parameter allowance still leaves room inside the
2,000,000-byte coordinator transaction cap for checkpoints, coverage, audit,
epoch/fence work and up to 128 generated projection children. Per-record DTOs
remain limited to 64 KB, and a separate accumulated 1.75 MB normalized-page guard
prevents large unused metadata copies from exceeding collector validation.
Selection occurs before the source builder, which runs once per admitted prefix;
there are no trial builds that spend additional database reads. Unconsumed rows
remain at the saved offset and are never truncated or skipped.

Ordinary short-status 25-row pages already fit one commit on 7.2.5. This release
does not claim they were repeatedly fetched due to byte slicing. The measured
ordinary improvement comes from requesting 100 where accepted. Compact sizing
allows that 100-row page to remain one commit; large escaped status values still
use bounded local slices and refetch the current provider page as required by
the existing resumable protocol.

## Verification receipts

- Focused identity, diagnostics, catalog, paging, refresh and byte-bound suite:
  **67/67**, zero skips; independent rerun **64/64 plus catalog 3/3**. It retains the old saved-25 5,001-row/402-fetch traversal
  and adds a genuinely new 100-row/102-fetch traversal, with exact identities.
- New-size tests cover maximum 15-digit tuple keys, long Unicode/escaped account
  IDs, full worst checkpoints, exactly 8,192 versus 8,193 bytes, explicit cap 50,
  non-halving cap 40, reduction/resume, missing metadata and exact first-400
  compatibility admission. Foreign/duplicate links and all disallowed error
  categories remain negative assertions.
- Actual collector/builder/coordinator SQLite tests with 128 generated projection
  children admit an ordinary 100-row page in one commit, with 461,385 measured
  parameter bytes and 32 invocation statements. The large escaped-record case,
  8 KiB checkpoint and 16 maximum audit observations remain bounded at 1,313,572
  total parameter bytes, 634,357 bytes for the largest SQL parameter and 32
  statements. Near-64 KB plain-status DTOs split 27+3 to obey the separate
  normalized-page cap. Existing event byte-bound regressions remain in the suite.
- Native baseline at exact 7.2.5: **1/1**, 200 exact source/canonical pairs,
  16 provider fetches and 16 fenced commits for two traversals, 400 observations;
  maximum 36 SQL statements, 28,276 transaction parameter bytes and 2,441
  checkpoint bytes.
- Final native candidate: **1/1**, zero skips, 77.99 seconds for all scenarios.
  The same 200 exact source/canonical pairs use **4 provider fetches / 4 fenced
  commits**, with 400 observations across two traversals. Maximum initial work is
  36 SQL statements, 82,158 total transaction bytes and 4,592 checkpoint bytes.
  A saved 25-row local cursor at offset 7 commits its remaining 18 rows first,
  retains its exact size/base/digest/window/scan, and completes in 16 fetches.
  A saved second traversal continues in 8 fetches without repeating pass 1.
- Native adaptation accepts a proved cap of 50 by restarting without saving the
  differently partitioned response. A 2,034,183-byte 100-row body is rejected by
  the unchanged transport cap and also restarts at 50. Large escaped Unicode
  status strings of 4,000 UTF-8 bytes require 84/16 first-pass slices on each of
  two provider pages and four no-op verification commits: 8 fetches / 8 commits,
  all 200 pairs retained. Global measured maxima are **40/50 SQL statements**,
  **801,223 source parameter bytes**, **812,885 epoch-wrapped transaction bytes**,
  **799,517 bytes for one SQL parameter**, and **4,655 checkpoint bytes**.
- The native lost-ack wrapper commits the real D1 batch and then throws once.
  Replay preserves exact pairs. Held-response account revocation and last-root
  unlink are tied to their captured job IDs/generations and pre-reconnect stages;
  both reject stale writes, preserve saved rows and admit zero extra pairs.
- Native fixtures use **1 ms alarm/page delays** and synthetic due-time arrivals.
  Fetch/commit counts are comparable; elapsed times are not hosted throughput
  estimates. The final run reports **zero diagnostic-read retries**. Its local
  harness permits at most one retry of a read-only diagnostic GET for the exact
  Undici socket-close error; production provider and mutation requests are not
  retried by that fixture mechanism.
- Pinned Wrangler 4.149.0 deployment dry run and **184-file** required closure
  pass at 7.2.6: **1,754.31 KiB Worker / 387.75 KiB gzip**. No remote deployment
  is performed by this build. Dependencies differ only in the root version.

The frozen pre-instrumentation fingerprint of all 127 loaded production modules
is `31c792df6b54534876436f7c64c5c408177b879f5a3eedfe7b1a45be86009764`.
Initial pure runs failed outdated page-count/slice fixtures after changing the
new-scan preference; compatibility cases were retained explicitly, not replaced
wholesale. A stronger native run encountered an Undici socket closure on a local
read-only diagnostic query; its failed receipt is retained. No provider or
mutation retry is added to production by the fixture's diagnostic handling.

## Release and live acceptance

This is a code-only compatible update from 7.2.5. The exact 731-statement schema
fingerprint is `e1c1b6cf96cd12afce94dc14819e103283aacac2f420329cfaf65938888e4f40`;
the unchanged upgrade plan is
`755a9a58c834e2a469c8d12e91acd9e51e67800efc7cb4c5e315e037c7170cc7`.
Preserve both databases, DB binding, ADMIN_KEY, SYNC, cron, preview settings and
30,000 ms HTTP CPU budget. No schema import, reset, reconnect, Update now or
attendance retry is needed for a running scan. Deploy only after the current
live acceptance and exact independent artifact review permit it.

Verify `/api/health` reports 7.2.6, existing active-25 checkpoints continue, and a
subsequent normally scheduled new attendance scan either uses validated 100-row
pages or the bounded compatible fallback. Verify its exact full/recent coverage
and retained owner/source data. Synthetic responses do not establish the live
provider's acceptance of the larger preference. Full original-product acceptance
remains separate from this narrow collection improvement.
