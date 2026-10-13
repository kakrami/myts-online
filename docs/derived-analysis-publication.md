# Publish saved analysis during ongoing derived collection

## Reproduced dependency error

Tracking segments, native statistics, heatmaps, radar observations, their
replacements and their coverage changes all entered the same affected-event set
as event dates, participants and membership. Every genuine derived save therefore
advanced both the per-match source input and the season projection input. A long
season build repeatedly became obsolete before it could publish, even after its
connection roots reconciled. This is a content dependency error, not a scheduler
status counter or a reason to ignore source authority.

## Bounded correction

The auxiliary builder separates explicitly typed derived-only event IDs from
structural event IDs. Both advance the existing per-event analysis clock and
source serialization clock. Derived changes also retain the season source
evidence revision, but do not dirty its membership/presentation input. Game
headers, members, moments, event/player/roster/attendance facts, date/team changes,
authority, owner state and placement still use the structural path.

The unpublished normalized projection retains exact source hashes, native links,
participants, roots, account generations, owner revisions and coverage proofs.
Its cross-page frame no longer includes the output content counter advanced by
independent match analysis. A member's captured analysis clock may advance before
publication; its structural facts must still match. Same-page raw-frame and
normalized insertion checks remain atomic. Current analysis/owner read and write
fences retain the changing per-match clock.

Existing local recovery discovers a missing or terminal stale match from its
immutable published-run ID and ordered native-revision vector. A successful
analysis acknowledges that exact compact clock under its existing input CAS.
Failed/blocked work acknowledges its attempted clock, avoiding unchanged-failure
loops. Obsolete accepted placement is excluded. Recovery is bounded and does not
keep returning a no-claim loop merely because more analyses exist. Saved input
remains the durable obligation after a wake or reply is lost.

Automatic publication/catalog/recovery admissions preserve an active match's
arguments, lease and checkpoint. A season-wide owner refresh still scans every
selected match and catches up to newer source clocks. Direct owner match refresh
retains its explicit restart behavior. Before the first season publication, the
normal publication catalog covers all latest saved inputs. No new table,
installation transition, provider retry or radar-access bypass is introduced.

## Verification

- Runtime: `df3432863a2b81a670e41ea5853a70db50fed934`; seven changed files.
- Focused recovery: 24/24, zero skips, including source changes after first
  publication, catalog races, obsolete/null placement, failed/blocked/active work,
  wake loss and owner refresh. A 64-member long-ID fixture keeps the clock below
  512 bytes and its complete checkpoint below 1 KiB.
- Independent frozen boundary/recovery review: 94/94, zero skips, unchanged
  before/after hashes. Actual changed collector rows, deletes and coverage are
  distinguished from structural join_time/date/roster/attendance edits.
- SQL limit closure: 27/27. All 887 captured queries (303 unique) compile with
  expression depth100, compound5,100 parameters and100k SQL limits. Maximum SQL
  is24,839 bytes with19 parameters; real SQLite coordinator uses at most48/50
  statements. Limits are unchanged.
- An earlier explicit set accidentally included sync-workflow.test.js without
  its Miniflare dependency. It failed at import before execution and is not
  counted as a pass. Other completed pure records remain separately recorded.

The final native sustained-input fixture passed with actual collector/transport,
coordinator/recovery, full installation-epoch and D1 saves. Its causal baseline
reproduced 29 derived commits advancing season input despite an unchanged
structural hash, two obsolete runs and no publication with 27 jobs pending at
turn 79. The repaired runtime published all 26 membership rows at turn 111 and
accepted incomplete analysis for seven players at turn 152, with 16 derived jobs
still runnable. Actual read services returned Overview Analyzed=1, the linked
Analyzed Schedule=1 and Team=7 players. Thirteen genuine derived writes
interleaved the two event-building pages.

Another 44 changed same-match commits were observed afterward. At turn 344 the
analysis acknowledged exact source clock 88 and the matching current input hash;
unchanged recovery was idle. The fixture observed 45 analysis publications,
not a no-duplicate-work or hosted throughput claim. A real connection-removal
command then caused a held stale analysis write to fail atomically and removed
the revoked game from Analyzed. The independent synthetic radar 403 remained
blocked while usable partial facts published.

Maximum actual invocation cost was 43/50 SQL statements. Largest statement was
32,455 bytes; largest transaction used 19 statements and 67,115 parameter bytes.
All 184 captured files were identical before and after, fingerprint
`66ba796024a5a2d405e6be667aa274051bbe2857d6f621594280421facb942cf`.
The runtime was recreated each turn. Its clock advances 5 seconds per turn with
a 20-second page delay; this is deterministic native workflow evidence, not a
production latency measurement. Earlier fixture-clock failures and interrupted
timing prefixes remain separately retained and are not counted as passes.
