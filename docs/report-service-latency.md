# Bounded report admission and fair background service

## Scope

Explicit Reports could remain at zero captured rows behind continuing Trace and
projection work. Their admission evidence clock can change before the first
capture; the live bracket established queue delay with the content revision still
current, while pre-capture invalidation is a separately reproduced risk. This repair changes the four existing Reports workflows only. Data-file
import/export remains ordinary background work. It does not change schema,
provider protocols, source deduplication, report layout or the original user flow.

## Atomic small-report admission

For an already-published selection, the default service preflights the complete
ordered rowset when its count is at most 250. Every serialized row must fit the
existing 16,000-byte UTF-8 schema limit, and the actual JSON bulk parameter must
fit 512 KiB. Natural-sort character/recursion limits and existing query SQL/parameter
limits remain unchanged. The preflight does not silently rebase the snapshot.

The existing content revision, source/domain evidence and team lifecycle guards
admit the snapshot and its captured JSON in one D1 batch. A ready transition is
possible only when the complete row count matches. The small Season Summary path
also fences its preflight with the source/domain clock. Relevant changes between
preflight and admission write neither a snapshot nor rows. A lost response may
leave one complete ready snapshot, never a partially ready result.

Reports over either bound, and first-publication reports, retain their existing
paged capture behavior and conservative immutable evidence fences. In particular,
a larger in-flight report can still fail report_changed after an unrelated global
source change. This repair does not introduce dependency-scoped clocks or rebase
old, partially captured, failed or ready snapshots. Already-ready rows and files
remain immutable when any later source or owner change occurs.

## Fair scheduling

Capture, XLSX and PDF jobs use priority 100, within the existing range. The
application scheduler persists the next report/ordinary service preference in
Durable Object storage immediately before its atomic SQL claim. The SQL report
class requires a current snapshot, correct team/resource/arguments, matching
report demand, and a live capturing snapshot or queued/building export. Data
files are explicitly excluded. Authority, account, lifecycle, lease and commit
fences are unchanged. Ordinary priority/aging and within-class ordering remain.

Both runnable classes alternate claim opportunities. This does not alter fairness
between different ordinary priority levels or establish the cause of a separate
live queue/alarm stall. If either class is absent,
the other advances immediately. Recovery-only invocations do not consume a turn.
A crash or lost storage reply after the durable preference flip can lose one
service opportunity for that interrupted invocation; this is not a guarantee of
strictly alternating successful commits. A recovery alarm is already durable
before the flip. Restart, fixed-clock ties and completed-job pruning do not reset
or infer the preference from job history. No retained-job aggregate scan or schema
change is introduced.

## Verification

- Focused Node/SQLite suite: 22/22, including default 0/6/137/250-row admission,
  251-row and UTF-8 byte overflow fallback, exact 16,000-byte rows, source/analysis/
  owner/lifecycle precommit rejection, lost replies, immutable replay, fair
  restarts, absent classes, Data-file exclusion, expiration/revocation, retry
  backoff, completed-job pruning, concurrent alarms/wakes, recovery turns and
  priority-20 derived-work liveness after high-priority work drains.
- Adjacent original parity, semantic refresh and first-publication suites:
  46/46. Queued/pre-upgrade safety cases explicitly retain the old admission path
  and old persisted priority; default production behavior is tested separately.
- Native owner HTTP admits 250 sorted rows / 431,280 stored UTF-8 row bytes with
  the actual 48-statement request guard. Epoch-wrapped admission plus 16 reserved
  statements uses 31/48. The saved query is 9,204 bytes.
- The focused native busy-source fixture uses public-history-aware real claims,
  installation inspection, epoch wrappers, real report capture and encoders,
  and production DomainRepository source-page writes. Relevant canonical
  publication edits are explicitly simulated; this is not a full provider and
  projector acceptance test. It parses the exact pre-mutation 137 ordered rows
  from both XLSX and PDF while unrelated and relevant source pages continue and
  the ordinary job remains queued. Its persisted scheduler is restarted each
  turn: 33 turns, 17 ordinary pages, maximum 33/50 statements, with installation
  inspection included. Final native owner admission measured 204 ms.

The initial native fixture incorrectly waited for a publication that team creation
alone does not request. A subsequent large-text export probe used unsupported CJK
glyphs and failed with the existing PDF font error. The corrected Latin probe
admitted all 250 rows and finished XLSX, but its 750-character-per-row PDF remained
queued at the 120-second deadline without a job error. That is retained as a
limited/failed export-performance receipt. Large-field admission cost and ordinary
short-field parsed file completion are separate gates; this repair does not claim
that pathological long-text PDF generation now completes promptly.
