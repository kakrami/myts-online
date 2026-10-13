# Bounded accepted-control regression

This test is local synthetic evidence. It runs the production collector and job coordinator on native Workerd/D1, through the full 788-statement installation and installation-epoch wrapper. The host invokes the coordinator and waits for real saved page deadlines. It does not test actual production alarm delivery, live provider authentication, real provider data, or Cloudflare production CPU limits.

## Frozen causal baseline

- Runtime: restored deployed 7.2.14, local baseline `2c03527`, runtime tree `837dd096`.
- Fixture reused from `projection-control-throughput.native.mjs`: 100 relevant jobs, 71,789 bytes of selected raw job fields, 22,763 argument bytes, 3,196 checkpoint bytes, 110 source rows, 100 logical games, 10 genuine mixed-source pairs.
- First publish the complete fixture to establish an accepted pointer. Start a replacement run at season input 1256 and commit a multi-event data page.
- Make the existing GotSport history job due. Use real coordinator claim, production `collectApplicationJob`, a synthetic empty successful provider response, and real coordinator commit.
- Verify source rows, memberships, canonical links, roots and season input are unchanged. Record the changed claim checkpoint, scan ID, saved timestamp and completion timestamp.
- The frozen baseline must obsolete the hidden run on the next projection page and preserve the previous accepted pointer. The test passes only if this causal defect is reproduced.

## Candidate liveness and safety

1. Commit one genuine complete acquisition into the new hidden run. Candidate mode spreads nine synthetic mixed pairs through later canonical-ID pages; baseline mode retains the original public-anchors-first ordering. Source IDs/data, job payloads, and100/110/10 totals are unchanged. Require new accepted mixed-pair publications after the first page while catalog is still running.
2. Keep a GotSport catalog job continuously running across multiple new candidate neighborhoods, while separate real history refreshes complete between projection pages. Publish the original hidden run with 100 events, 110 memberships and 10 pairs while catalog is still running. Then complete that catalog refresh through its real collector and coordinator. Never fabricate terminal jobs between acquisitions.
3. Hold a data-bearing projection page, mutate raw args/checkpoint/coverage, structural scope, relevant-job membership, subscriber generation, account generation/revocation, root authorization, source content/membership, and owner correction. Require atomic commit rejection. For semantic/structural changes also check already-staged authority becomes invalid before attempting commit.
4. Start a new run during an active refresh with only a previous published proof. Require a bounded pending response at the same cursor; the old published run cannot supply proof for this different hidden run. Keep the accepted pointer. Complete the real source collector and require automatic continuation using the persisted scheduling deadline. Subsequent neighborhoods run under overlapping active source jobs.
5. Remove first-scan proof by changing the fixture source generation and coverage while deliberately leaving a completion timestamp. Require incomplete candidate evidence and pending projection, then complete the genuine source collector and resume publication.
6. Stage a real version-2 witness with the frozen 7.2.14 projector, complete a no-op refresh, then require the candidate to retire that hidden legacy run safely and publish a replacement without changing the accepted pointer prematurely.

## Bounds and receipts

Every production invocation has a 50-statement `BudgetDB` and independently counted native SQL. The receipt records native D1 rows read/written, SQL and parameter bytes, result bytes, batch sizes, source refresh transitions, input/source/root hashes, checkpoint bytes, staged collector payload bytes and stored fence bytes. Assertions enforce 50 SQL statements, 2,000,000-byte collector payload, 8,192-byte checkpoint and 16,000-byte fence limits. Runtime SHA-256 maps are checked before and after. Setup and intentional fixture mutations are separate from production invocation counts.

## Commands

Run one native process at a time, only after its slot is approved. From the test worktree:

```
MYTS_TEST_PACKAGE_ROOT=/workspace/scratch/c731cbcbca8e/myts-current \
MYTS_REFRESH_MODE=baseline \
MYTS_REFRESH_OUTPUT=tmp/projection-control-refresh \
node --test tests/projection-control-refresh.native.mjs
```

For the frozen candidate, point `MYTS_TEST_PACKAGE_ROOT` at the reviewed candidate worktree, use `MYTS_REFRESH_MODE=candidate`, and set `MYTS_REFRESH_BASELINE_ROOT=/workspace/scratch/c731cbcbca8e/myts-current` to require native migration. Do not run against a worktree that is still changing.

The only changes in this worktree are this plan and the focused regression. No runtime file is edited here.

## Frozen baseline result

The causal baseline passed on 2026-10-13. Initial publication was 100/110/10. The replacement first page selected 24 canonical IDs and saved 14 logical events after pairing. A real no-op history refresh then made that hidden run obsolete at unchanged input 1256. Maximum native invocation: 44 SQL statements; collector payload 348,471 bytes; checkpoint 259 bytes; stored fence 4,637 bytes. Measured production invocations read 259,262 D1 rows and wrote 1,547 rows. Runtime map SHA-256: `669228ff89e118882ce24a0f90d309fba7db22e394d7f3fb5bf9b828e41ec035`. The complete JSON receipt is retained locally under `tmp/projection-control-refresh/baseline-native-receipt.json`. This is the frozen-baseline defect receipt, separate from the final candidate result below.


## Final candidate result

The final 7.2.15 candidate passed on 2026-10-13 against frozen integrated commit `7b05dff5665cfb0e0291c23d1cc601b102716e05`. The fixture exercised 149 native production invocations, including 26 genuine source refreshes and deliberate rejected writes, in 203.1 seconds. Three first-page mixed pairs became 5, 7, 9, then 10 accepted pairs on later pages while the catalog job stayed continuously running. The original hidden run published 100 events and 110 members with all 10 accepted pairs.

Both a different hidden run starting during refresh and a first-ever incomplete proof preserved the published pointer, deferred, and resumed after genuine source completion and the real saved 60-second deadlines. The deliberately present completion timestamp did not manufacture proof. The frozen version-2 witness was retired safely after actual no-op refresh; its replacement published the same totals while later pairs were again accepted under continuous source activity.

All 12 held transaction negatives rejected atomically: raw args, checkpoint, coverage scan, scope, new job, subscriber generation, account generation/revocation, root revocation, source content/membership, and owner correction. Every tested structural/source/owner mutation also invalidated already-staged authority. Raw checkpoint/coverage freshness races were checked at the held transaction boundary, where exact CAS remains required.

Maximums: 44 counted and actual SQL statements per production invocation; 345,958 bytes of collector statements/checkpoint; 312,086 transaction parameter bytes; 947 checkpoint bytes; 5,499 stored-fence bytes. Measured native D1 totals: 2,631,816 rows read, 7,786 rows written, 3,354 statements. These totals exclude fixture setup and diagnostic read-only checks outside measured production invocations. All foreign-key checks passed and the installation writer permit was cleared.

Runtime source map SHA-256 was identical before and after: `84a0f8064db62613e18ff2e253696d888efcdea9db6202e75907c643d10d80ee`. Final receipt: `tmp/projection-control-refresh/candidate-native-receipt.json`.

Two earlier candidate attempts are retained separately. The first stopped on a null fixture claim; the harness now waits until the actual saved deadline has passed and logs eligibility state if it recurs. The old attempt did not capture enough state to prove the exact null-claim cause. The second verified core liveness and safety, then exposed the exact-active-first-scan classification gap: it staged conservative pending rows, not fabricated accepted proof. The final minimal runtime correction and stricter first-scan receipt diagnostics passed above. No broad native suite or live production alarm test was run here.

## Map encoding qualification

The executed harness decoded all185 files as UTF-8 before hashing. Its184 text-file digests equal their raw-byte hashes. The sole binary font entry instead has decoded digest `b95839a22fae6a21f0ce696837d6f7d72ada8a118f594dce4946cfeb47a7c6b5`; exact baseline and final Git/font bytes independently match raw SHA-256 `ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280`. This projection workflow does not consume the font. The map helper was corrected afterward for future runs; the reported native receipt is retained with its actual hashing rule. No runtime file changed.
