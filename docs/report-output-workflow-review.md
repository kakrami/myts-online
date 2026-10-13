# Reports output and workflow correction

Base: `15705ef1e1e51ff165ee12cf1319cb555fa6b07f` (7.2.8). This patch does not change the release version, publish, deploy, change schemas, or modify source/matcher behavior.

## Corrected behavior

### PDF row separators

`pdfPage` advanced to the next row baseline and then drew the previous separator at `y + 4`. That position intersected the next row's glyphs. The shared writer now uses `y + 10`, the same gap placement already used below the header. Font sizes, line heights, data, notes, page breaks, and object/checkpoint formats are unchanged. Existing PDF bytes remain intact when resuming; newly encoded pages use the corrected geometry.

The four report types are generated with 137 rows each, wrapped values, explicit newlines, descenders, evidence notes, and multiple pages. PDF parsing checks every horizontal rule against every glyph's bounding box. Every tested new rule clears the glyphs by at least 4.499 points. A resumed unversioned PDF retains its earlier pages, landscape format, all row identifiers, and valid page/object indexes. A six-row Summary/eleven-row Attendance before/after receipt also confirms crossed glyphs drop from 86/230 to zero (`tmp/report-output-review/before-after-geometry.json`). First and second pages of each report were rendered with Poppler and visually reviewed; the Summary and Attendance first pages were also inspected individually at readable resolution.

### Default order

Original 6.20.133 `reportRows` at original-ui.html:2450 establishes:

- Summary: the fixed six metric rows, already retained through `q.id`.
- Schedule: `mergedItems` → `allMatchItems` → `canonicalMatchItems`; parsed full instant/date ascending, then stable ID (838, 884, 899–902).
- Players and Attendance: `teamRows` maps the derived roster without adding a report-specific alphabetical or statistical order. This behavior is unchanged.

Schedule now supplies its explicit default ordering before immutable row ordinals are assigned. Known instants are compared at millisecond precision, including offset-equivalent instants. Source ingress and owner corrections canonicalize timestamps with `new Date(value).toISOString()` (`src/domain/repository.js:46–49,187,507`); file import requires that exact canonical representation (`src/domain/dataset.js:312`). A regression exercises source ingress with greater-than-millisecond fractional precision and verifies truncation before SQLite ordering. Missing/unparseable dates retain the original comparator's zero value. Equal dates use ID. Explicit requested column/direction remains authoritative, with this base order preserving ties across the whole snapshot and every preview/export page.

The original date-only parser used noon in the browser's local timezone. Server-generated immutable reports instead use noon in the selected team's saved IANA timezone. This is an intentional stable interpretation: two viewers in different device timezones must receive the same snapshot. It does not replace missing kickoff times or alter source timestamps. The existing timezone conversion helper gained an optional validated whole-hour argument, defaulting to zero; existing midnight callers are unchanged and Reports is the only new noon caller. LA spring/fall DST, equal instants, milliseconds, no-date rows, Santiago's skipped-midnight day, and Apia's skipped 2011-12-30 are covered. For an explicit daytime hour that does not exist, the helper still throws and includes its derived forward-gap candidate; only Reports chooses that candidate like JavaScript Date. Existing midnight callers remain strict. An unused skipped day therefore cannot invalidate the entire report's calendar map.

A compact UTC-noon array for only the selected season is persisted in `query_params`. It is limited to 366 days and 6,000 bytes; ordinary 365-day map size is 5,111 bytes and the complete query parameters are 5,197 bytes, below the existing 8,000-byte schema limit. A leap-season test uses 5,211 total parameter bytes. No per-row database reads or source writes are added. Local measured map construction was about 78 ms; this is not a production network latency claim.

### Preview pagination during background work

A cursorless status/content refresh previously replaced the accumulated ready preview with page one. Reports now retain one current immutable snapshot's last 200 loaded rows, absolute loaded count, and next cursor. The main view model and visible table use that same retained envelope. Scope/type/sort changes and cleanup release the old window.

Reports More uses its existing report action hook and a separate request key, so an unrelated view refresh cannot cancel an in-flight page request. Snapshot, generation, selected scope, and expected cursor must all still agree before merging. Duplicate clicks for one cursor share a request. A late page cannot enter another sort, report type, team, season, or restarted window.

Once older rows are trimmed, an explicit range label and **Return to first page** control let the user revisit every row of the same immutable snapshot and sort. This does not request a new capture. The preview remains bounded while exports always read every captured row.

## Verification

- `tests/reporting-refresh-window.test.mjs`: actual `main.js`, feature bridge, controller and shell; 137-row full preview/sort/reverse/refresh; 237-row bounded window and complete restart traversal; 337-row duplicate/restart race; late More under sort/type/team/season changes; a background-refresh race completes the original More without a second click.
- `tests/reporting-output-layout.test.mjs`: parsed glyph/rule checks for all four multi-page PDFs and legacy resume. Generated PDFs are in `tmp/report-output-layout`; rendered proof is in its `rendered` subdirectory.
- `tests/reporting-parity.test.mjs`: exact 137-row default order, explicit stable ties and reverse order, immutable source-mutation behavior, actual parsed XLSX/PDF content, all four original defaults, calendar bounds and timezone edges. Existing admission, capture, authority, notes, export and resume tests remain in place.
- Native report suites: `reporting-parity.native.mjs`, `reporting-refresh.native.mjs`, and `reporting-service-latency.native.mjs`, run serially, 3/3 passed with no skips; receipts in `tmp/report-output-review/native.log`. This native run preceded the subsequent narrow report-only skipped-day fallback; the final pure regression exercises that extra path, and the release integration must bind its native result to the final source. No contemporaneous native source-hash map was captured. Native 250-row admission used 431,280 row bytes and 31 epoch-wrapped statements including 16 reserved; busy 137-row exports both parsed fully while ordinary work continued (17 pages, at most 33 statements per turn).

Run focused pure/DOM coverage with:

```sh
MYTS_JSDOM_MODULE=/path/to/jsdom node --test --test-concurrency=1 tests/reporting-*.test.mjs tests/calendar-contract.test.mjs
```

Run native D1 coverage with:

```sh
node --test --test-concurrency=1 tests/reporting-parity.native.mjs tests/reporting-refresh.native.mjs tests/reporting-service-latency.native.mjs
```

## Export latency assessment (no optimization included)

The production service still persists one encoding phase per scheduler turn. A six- or eleven-row XLSX takes five turns: ZIP/header, rows, Notes header, Notes rows (even with no evidence notes), finish. A one-page PDF takes four: font/header, page, page tree, cross-reference/trailer. Local SQLite/encoding measurements were approximately 2–44 ms overall, excluding network, durable storage, alarm scheduling, queue service, and recovery work; this does not establish the exact breakdown of the observed live 40–60 seconds.

The PDF's initial phase emits 17 fenced statements, followed by 3, 3, and 2. XLSX phases emit 2, 2, 2, 1, and 2 in the no-note fixture. Small-report bounded phase batching could remove several scheduler round trips, but it needs separate evidence for statement/byte/lease limits, atomic persistence, legacy continuation, and fair service. This patch makes no scheduling or performance redesign and retains 7.2.8 admission, immutable snapshots, fences, and fair report/import service.
