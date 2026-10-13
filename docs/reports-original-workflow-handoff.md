# Original Reports presentation on the rebuilt reporting pipeline

Baseline: original 6.20.133 (`50e1be224806ff7e7c439d26e15fd0421e3f6f01`); original fixture contract and source provenance are in `docs/original-coach-reports-oracles.md`. This patch restores the familiar report presentation without replacing the rebuilt canonical identities, attendance evidence, immutable snapshots, background exports, lifecycle guards or viewer authorization.

## Restored behavior

- Season Summary has the original six rows in original default order: Record, Goals, Matches analyzed, Trace players, Minutes leader, G+A leader. It no longer alphabetizes its metrics by default.
- All four report types use the original ordered visible/export columns. Players no longer adds an Analysis coverage column; Attendance no longer adds missing/unknown/conflicts columns.
- Cancelled Schedule score, result and attendance are blank. Familiar Game/Practice, Completed/Cancelled/Live and TeamSnap/GotSport/Trace labels are used. The current `live` provider enum is explicitly covered.
- Minutes use one decimal, G+A/60 uses two, known attendance percentages use original integer-percent presentation, and zero-denominator percentages stay blank. Unknown quantities remain unavailable, rather than becoming zero or fabricated NR.
- Evidence notes remain attached to immutable rows. The preview has an Evidence notes disclosure; new Excel files have the original `Report` sheet with its header first, plus a separate `Notes` sheet; PDF includes applicable row/scope notes. These distinguish unavailable/conflicting attendance and partial/estimated statistics without adding misleading columns.
- Header sorting, mobile column/reverse controls and per-report saved sorting use the server's complete ordered snapshot. A preview can show a bounded window while its downloads retain every row. New filenames follow `schedule_2026-27.xlsx`, `players_2026-27.pdf`, etc.
- PDF is portrait at six or fewer columns and landscape above six.

## Ordering and capacity

`src/reporting/order.js` orders the complete query before the 100-row capture page is selected. Digit runs are natural-sorted (`Q2Z` before `Q10Z`), numeric and percentage columns retain decimal/signed ordering, ISO dates retain chronological order, empty/null/em-dash values are last in either direction, and ties retain reconciled query input order. Each capture re-evaluates under the unchanged content/attendance revision fences; a changed source fails capture rather than mixing versions.

The natural-token path consumes whole nondigit spans. It is bounded to 1024 characters and a conservative 64-token-step upper bound per sort value. If any value exceeds either bound, the entire selected column uses complete case-insensitive text ordering; the preview scope, Excel Notes and PDF disclose that natural numeric ordering is unavailable. The fallback preserves every full value and row. It never silently truncates a key or sorts only the loaded page. Historical roster labels already admit 1000 characters; longer schema-valid labels therefore remain exportable.

The native SQLite collation is deterministic and is not a universal reproduction of every browser locale's ICU linguistic collation. The unsafe legacy Date.parse interpretation of arbitrary digit-bearing names is not reproduced. Paired proofs cover unambiguous text, multi-digit runs, stable ties, empty values, quantities, percentages and ISO dates.

Unchanged persistent bounds include 48 KB saved query SQL, 8 KB saved parameters, 16 KB immutable row JSON, 64 KB stored binary parts and 64 MiB export bytes. Download streaming reads at most 8192 part metadata candidates and 4 MiB payload bytes per statement. The 16,384-part synthetic budget proof used 13 statements including 8 reserved request statements. This is a stream/budget proof, separate from actual workbook/PDF validation.

## Existing unfinished exports

New encoder checkpoints explicitly set `encoder_version: 2`. An unmarked 939cbc5 export continues its old format:

- XLSX retains its original single `myTS Report` sheet, rows 1–4 metadata/header and data offset 5. It does not append a Notes sheet that its already-written workbook relationships cannot describe.
- PDF retains landscape orientation and legacy cell formatting while continuing the saved row/page/object offsets.

Ready exports, export IDs, snapshots and job IDs are unchanged. Tests open a legacy 100-row XLSX checkpoint completed by the new encoder and verify all 137 rows, including the previously overwritten 97–99 records. The analogous legacy PDF continuation is parsed and verifies all 137 records, landscape pages and continuity. The frozen 939cbc5 encoder test fixture only changes its font import path.

ZIP, CRC, split-part and generic archive helper functions are byte-identical to the source checkpoint. No data-file, dataset, report schema or shared schema edits are part of this patch.

## Verification

- `node --test tests/reporting-parity.test.mjs`: 14/14, zero skips. Actual SQLite service capture,137-row original paired sorting/cursors, real files opened by openpyxl/pdftotext/pdfinfo, unknown/provenance presentation, scope authorization, legacy continuation, long/complex-key fallback and high-part download budgets.
- `MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom/lib/api.js node --test tests/reporting-ui.test.mjs`: 4/4, zero skips. Actual report renderer/controller and delegated shell events: header/mobile sorting, type-return saved sort, duplicate/stale preparation, disabled unfinished exports, failure retry and complete-row download messaging.
- Independent reviewer production regression selection: 7/7, zero skips, including its high-part download reproduction.
- Existing attendance-history suite: 9/9, zero skips, retaining game/practice inclusion, source-qualified NR/missing/unknown/conflict distinctions, and capture revision fences.
- Long-input SQLite measurement: 1001 rows, 474 characters per location, 11 capture pages, complete ordered output. Observed capture 540–1388 ms on the local executor; these timings are not a production Cloudflare CPU guarantee. Alternating-digit/text fallback proof retained 137 rows and all full values.
- Native populated Worker/D1 test: `tests/reporting-parity.native.mjs`: 1/1, zero skips, against the frozen source below. Six actual alarm-driven capture snapshots, 137 Schedule rows, four parsed downloads and native stale pre-commit rejection passed. No browser or manual job runner drove those background captures/exports.

The original oracle suite alone does not prove rebuilt behavior. Real provider account access, remote Cloudflare runtime limits and physical mobile-device behavior remain outside these synthetic/local receipts.

## Final native identity and retained investigation

- Captured source: `/tmp/myts-reports-native-20261012-2005`. Source/test/config SHA-256 manifest: `00039a9a7009646a2995c2a507398c240f3b0f8c0534b361882dcc3e7d8c9031`. Runtime and tests were frozen after this run.
- Command: `MYTS_TEST_PACKAGE_ROOT=/tmp/myts-reports-native-20261012-2005 node --test /tmp/myts-reports-native-20261012-2005/tests/reporting-parity.native.mjs`.
- Terminal receipt: `tmp/report-native-parity-materialized.tap`, 1 passed, 0 failed, 0 skipped; about 35 seconds including startup, initialization, captured synthetic publications, background capture/encoding, file parsing and disposal.
- Actual native queries, each with the production ordinal window: Schedule 8,865 SQL bytes / 5,488 rows read / 20 ms; Players 21,300 bytes / 1,998 rows read / 38 ms; Attendance 21,306 bytes / 896 rows read / 34 ms; Summary 29,104 bytes / 1,603 rows read / 33 ms. Complex-key fallback Players/Attendance queries measured 19,350/19,356 bytes, 1,970/868 rows read, 31/28 ms. These are local D1 measurements, not production CPU promises.
- The native stale-commit case collects a valid natural-sort page, then changes the source to a 1,024-character alternating key and advances its content revision. Committing the previously collected page writes zero rows and marks its snapshot failed. The SQL itself also has a hard 64-step recursive stop and retains incomplete keys for one whole-column fallback.

Red receipts remain available rather than being replaced by the final green result:

1. `tmp/report-native-parity.tap`: the real capture pipeline rejected SQL literal semicolons under the coordinator's single-statement fence contract. Schedule already contained `tracked; `; new evidence notes had additional semicolons. Report messages now use commas/periods, and a regression checks all four production capture statements against that contract. The coordinator was not weakened.
2. `tmp/report-native-parity-retry.tap`: a diagnostic standalone replay after a source mutation raised D1 `SQLITE_NOMEM`. Actual captures and four parsed exports had completed. An initial stale-key hypothesis did not fully explain the failure.
3. `tmp/report-native-parity-final.tap`: the same diagnostic failed before mutation, ruling out a stale-key-only diagnosis.
4. `tmp/report-native-parity-bounded.tap`: per-query logging isolated Summary's 29,090-byte query and its reused player aggregate; Players passed. Summary's alternative bounded SELECT plan failed even though its production capture INSERT had succeeded.
5. The one-clause `player_rows AS MATERIALIZED` barrier in Summary prevents repeated expansion of that complex aggregate. The final native run confirms the bounded diagnostic and every actual workflow are green. No common analysis query, schema or scheduler changes were made.

Production only executes saved query SQL inside the fenced, ordinal-bounded capture INSERT. Previews and encoders read immutable `report_rows`; admission reads the underlying count/bounds. The final receipt does not claim universal performance for unrestricted diagnostic queries, arbitrary locale collation or datasets beyond the measured envelope.
