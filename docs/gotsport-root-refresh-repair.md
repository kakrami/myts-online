# GotSport recurring refresh no-op repair

## Scope and attribution

This is a narrow, schema-free repository/auxiliary correction based on the exact
7.2.9 production source (`db07341`), with the 7.2.10 pagination-dispatch baseline
cherry-picked as `7bd8414`. It does not weaken connection evidence readiness,
change any connection trigger, roll back revisions, change the matcher, or
publish a season against dirty roots.

Actual `collectSource` → `DomainRepository.ingestSourcePage` execution against
SQLite with the complete production domain schema recreated three defects:

1. After a division supplies a game's group/context, the team-history endpoint
   omits those fields. Alternating unchanged history/division response bytes
   overwrote `source_events.division_key`, group/context and the qualified
   source URL. Each page added three root revisions: the event write and the
   consequent division/competition content revision writes.
2. A complete 101-row division or standings response requires two bounded
   collector pages. Repeating the same response changed accepted coverage
   complete → partial → complete, adding one root revision per page solely
   through `source_divisions.content_revision`.
3. Replaying the exact same saved provider identity-link evidence still executed
   `source_team_links` UPDATE and dirtied the root even when the page returned
   `changed: false`.

These are reproduced mechanisms, not complete attribution of the sampled live
hourly root changes. The live samples described to this task had single-page
11-row division attempts and single-page 12-row standings attempts; history had
last saved earlier. Their stable HTTP hashes do not reveal which local write
changed. No live provider response body or production database was accessed by
this workstream.

A later production observation supplied by the parent confirmed GotSport
`381/381` complete and stable from 06:28:57 to 06:30:11 UTC. No simultaneous
clean snapshot of all roots was established; Trace was dirty again by 06:31. The own-team profile had authority 0 and had not changed since
03:57; the latest own-event/division data was from 05:03; the one relevant bridge
had been renewed at 05:53:48 and expires at 11:53:48. The live root was delayed /
restarted and then completed naturally. Its earlier revision increments remain
unattributed; this patch is not presented as the proven cause or necessary fix
for that already-completed production root.

A separate test alternates two distinct single-page divisions with historical
participant names/logos. A saved authoritative profile makes those repetitions
stable. Equal-authority contradictory labels still dirty source input; this
patch does not invent a winner or hide an identity conflict. Overlapping game
IDs with contradictory non-null flight context are likewise not suppressed.

## Runtime changes

- Preserve only omitted, division-derived enrichment on provider-backed
  GotSport history pages when the existing row is also provider-backed and
  native event, competition, bracket and schedule identities match exactly.
  Contradictory identities and non-null division changes remain new input.
  Date, venue, participant, score and other native facts are still accepted.
- During a matching public GotSport division/standings collector's partial
  refresh, preserve the prior complete accepted coverage receipt. Current
  progress and retrieval observations remain in the source job checkpoint and
  observations. Terminal count/publication changes, genuine source changes and
  terminal standings removals still invalidate the relevant evidence. Generic,
  imported, wrong-provider, wrong-scope and wrong-completeness pages cannot use
  this exception.
- Avoid the link upsert only when its persisted evidence bytes are exactly
  unchanged. Preserve all actual freshness and semantic proof writes.

## Bridge freshness is an explicit remaining invalidation

A successful participant re-verification advances `verified_at`, observation
clocks and `expires_at`. It still updates the stored proof and the existing
unconditional link trigger still adds one root revision. That renewal is
separate from an exact-byte replay. Tests preserve expiry, recovery after
expiry, changed proof identity, and deletion/revocation behavior. Avoiding this
renewal-only root invalidation would need a separately reviewed freshness /
semantic trigger boundary and exact installation migration; it is not silently
included here.

## Validation

- On exact `db07341`, the initial five new tests fail in the three recreated
  mechanisms (history enrichment, partial coverage, exact link replay).
- Six final targeted actual-collector SQLite tests pass, including genuine
  corrections, stale/provenance negatives, terminal removals, bridge expiry and
  recovery, and distinct single-page division interleaving.
- The initial focused regression group passed 55/55, including public bridge,
  source page budgets, prior-row scalar/provenance behavior and reporting
  freshness/removal checks.
- Native mixed-source proof passed. A later wildcard `npm test` attempt was
  interrupted with exit 130 after the parent identified unrelated native runners
  in that wildcard. It is not an aggregate pass and contributes no acceptance
  claim. Only the explicit focused checks listed above are claimed.

### Native proof qualification

The native test uses fresh full installation, real Workerd/D1, production epoch
wrapping, real coordinator/recovery/admission and repeated newly constructed
runtime invocations with a synthetic coordinator clock and zero page delay.
It is not an unattended real-time alarm or production wall-clock throughput
claim. Source refresh calls use the actual collector and repository with native
D1/epoch transactions between runtime turns; their independent statements are
not charged against the runtime invocation's 50-statement counter. Existing
source-page budget regressions are a separate check.

The saved mixed-provider fixture remains under a sustained synthetic Trace
backlog and a blocked radar job. Actual 101-row GotSport division/standings
responses continue to refresh throughout reconciliation; history/event pages
also recur. Advancing participant proof renewals occur at turns 30, 80 and 130,
and each must add exactly one root revision. A real date/venue-relevant
behind-cursor correction is also retained. The stopping condition requires
both roots clean, partial analysis published and the report export ready after
all three renewals, while unrelated backlog remains queued.

Runtime source map at start:
`6b71bc8b2bfb259269cbfc651daff52b63faa84a91504219c097f7b32f419676`
(164 runtime/configuration files). The native test requires the same map at
completion. No runtime source was edited during this run.


### Native terminal result

- PASS after 494 runtime turns, 198 of them real recovery invocations.
- 98 recurring unchanged collector pages each had `changed: false` and root
  revision delta 0, including both pages of repeated 101-row responses.
- Advancing participant proof renewals at turns 30, 80 and 130 each added
  exactly one root revision and persisted later expiry times.
- GotSport root finished at turn 251 (48 pages), 121 turns after the final
  renewal; Trace root finished at turn 402 (30 pages).
- Both roots were clean; partial analysis published seven players, with the
  unsupported player's minutes still null; the report export was ready.
- 587 unrelated Trace jobs remained queued, while the unavailable radar job
  remained blocked with HTTP 403. The genuine behind-cursor correction reached
  the published team event.
- Maximum runtime invocation: 44 statements, within the unchanged limit of 50.
- Maximum captured SQL: 23,200 bytes; maximum parameter payload: 21,983 bytes.
  Claim SQL was 23,200 bytes with 170 parameter bytes.
- Foreign-key check was empty; installation writer mode/epoch/guard were clear.
- The final 164-file source map matched the start map exactly.

Native receipt: `docs/gotsport-root-refresh-native-receipt.json`.
The test used about 208 seconds wall time; that is local test duration, not a
hosted production throughput measurement.
