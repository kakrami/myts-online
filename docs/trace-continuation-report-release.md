# 7.2.8: Trace continuation and foreground Reports

## Observed problem and bounded repair

The deployed 7.2.7 Trace member-time correction allowed all 12 original recent
game jobs to complete by 2026-10-13 04:51:46 UTC. Before completion, one game
was observed moving from `derived/0` back to `members/0` with the same sampled
profile and digest. Its generation, account generation, scan and arguments were
unchanged in the later bracket. The exact intervening private response field is
unknown. A retained frozen-production reproduction changes an unused queried
`is_favorite` field and restores it: whole-response hashing restarts the game
while both sampled endpoint digests agree. This demonstrates a continuation
weakness, not proof of the specific live field or a permanently stuck job.

The live derived-job counts match distinct scope/resource keys and completed-game
counts. This release does not infer duplicate children from those counts and does
not delete saved jobs. Explicit Reports were independently observed queued with
zero attempts while high-priority import work ran. See
[the Reports contract](report-service-latency.md) for atomic bounded admission and
fair report/ordinary claim opportunities.

## Trace continuation contract

`trace-game-semantics-v1` hashes the exact stored and derived semantic inputs.
It excludes unused GraphQL decoration and locally generated observation time.
Canonical object keys and complete semantic array tie keys drive both the digest
and emitted rows/child inputs. Duplicate multiplicity is preserved. Source
identities, raw persisted evidence, member/player values, all-member native role
scope, clip selection, signed/dynamic asset URLs, permissions and access remain
relevant. Every moment's game identity is checked before continuing, including
rows before the saved cursor. Restricted games retain their previous metadata-only
path without validating an inaccessible child-only radar URL.

Legacy unversioned game checkpoints perform one header restart under the new
ordering. Saved source rows remain visible until ordinary scoped terminal
replacement; the regression includes old ordinal rows and a stale tail. New
continuations resume their exact stage and local slice. A relevant change restarts
within the same job and source authority. Three changes before the traversal completes persist a
15-minute retry deadline without another header write or false complete coverage.
Before the deadline, the existing temporary `source_changing` classification
records `retrying` and the ordinary next-wake path schedules resumption. At the
deadline, collection resumes automatically with a fresh bounded change counter.
No owner retry, reset, reconnect or manually altered live checkpoint is required.
Continually changing data can need further automatic retries; it is never falsely
reported as a stable completed scan.

## Verification and retained limits

- Focused Trace pure suite: 20/20, including unused decoration/order changes,
  complete duplicate tie keys, lost response, local slicing, old stored ordinals,
  signed URL changes, foreign identity on a passed page, restricted URL behavior,
  and a relevant change during a 133-child derived prefix. Independent rerun:
  `/tmp/myts-review-trace-continuation-final.tap`.
- Native Workerd/D1 receipt:
  `/tmp/myts-trace-continuation-native-resume.log`, 1/1, zero skips. Churn and
  legacy modes each complete the 44-job synthetic workflow in 90 manually driven
  invocations, maximum 31 statements: four game pages, two radar jobs, 14 tracking
  jobs / 56 segments, 27 analytics summaries/items/heatmaps. The genuine-change
  case preserves header/clips, performs no early fetch, then completes through
  four ordinary coordinator calls after advancing only the fixture clock to the
  persisted deadline. A genuine member-time change made during the pause is saved.
  This case uses nine measured invocations, maximum 29 statements.
- Native source fingerprint before/after:
  `ef2ef3daf9237a2a92b0635068285eb8f7b7add3c024acc8348e88e224bc8490`.
  The 151-file map is retained in `/tmp/myts-728-trace-native-source-map.json`.
  This fixture installs DOMAIN + SYNC and uses BudgetDB(48); it does not include
  the full installation epoch, owner HTTP, alarm scheduling or real private Trace
  responses. The Reports native proof separately includes installation inspection
  and epoch accounting. Final combined source differences are recorded in the
  release reconciliation map.
- The first native attempt failed an old ordinal-specific Highlight assertion.
  Canonical ordering legitimately changed that ordinal; the final test locates
  the null-half Highlight and retains its exact count and null-quantity checks.
  The initial red log remains `/tmp/myts-trace-continuation-native-first-red.log`.
- Reports evidence and its retained large-text PDF limitation are documented in
  `report-service-latency.md`. The release does not change PDF layout, source
  contracts, schema, credentials or synchronization permissions.

The separate team-local cross-provider matcher, additive schema design and its
unfinished consumer integration are excluded. Full live Trace-derived analysis,
real opened Reports exports, persisted Coach clock/substitutions and the remaining
physical-device/security acceptance gates remain open until separately observed.

## Final combined 7.2.8 checkpoint

Trace and Reports were integrated before the final serial native run. The combined
pure regression is 97/97, zero skips (`/tmp/myts-728-combined-pure.log`). Both
native files pass 1/1 with zero skips (`/tmp/myts-728-trace-native.log` and
`/tmp/myts-728-reports-native.log`). Reports admits the same 250 rows / 431,280
UTF-8 stored bytes in 579 ms in this rerun; the epoch service count including 16
reserved statements remains 31/48. Its 137-row two-file proof takes 33 turns,
17 actual source pages, maximum 33/50 statements, and leaves the ordinary job
queued. Relevant canonical publication changes in that fixture are simulated.

All 151 runtime module bytes were captured immediately before and after these
combined tests and match exactly. Fingerprint:
`d8ee2bb829fd23c3589e7418116b9a795d126b41706b8ac498aa38c50fa514d0`.
Maps: `/tmp/myts-728-native-before.json` and `/tmp/myts-728-native-after.json`.
This supersedes the Reports component run's lack of a contemporaneous full map;
its four-file reviewed freeze was separately checked before integration.

The exact dependency-locked dry-run build passes, with 184 required files and
1,769.08 KiB Worker upload / 391.33 KiB gzip (`/tmp/myts-728-build-final.log`).
The first build attempt found that a cleaned worker dependency symlink no longer
existed; it did not reach a Wrangler build or deployment. The final command uses
the already-installed reviewed dependency tree and a writable dry-run config.
Schema/upgrade identity remains the unchanged 731-statement target and there are
no matcher, installation, provider-credential, web UI or configuration changes.

At 04:54 UTC the parent was separately investigating a live queue containing
unattempted ordinary work after the recent games completed. This candidate proves
eligible ordinary work advances when the report class is absent and after
high-priority jobs drain in the bounded fixtures. It does not establish the cause
of an unrelated live wake, eligibility or within-ordinary scheduling delay.
