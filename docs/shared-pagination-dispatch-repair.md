# Shared pagination dispatch repair · 7.2.10

## Confirmed regression

The 7.2.9 Reports controller added a `more` action. The feature bridge previously
constructed a view-aware More dispatcher, then merged the Reports actions over
it. Reports pagination worked, but Schedule More returned through the report
handler without issuing its page request. The two existing actual-main Schedule
regressions failed on the exact unchanged 7.2.9 baseline. This was an integration
regression, not a provider, cursor, or test-timing failure.

## Correction

The existing shared dispatcher is installed last in the feature action map.
Its body and route decisions are unchanged: dirty editors are protected, Reports
uses its immutable snapshot paging, competition and detail paging use their
existing handlers, and ordinary screens append their own query cursor.

The action-name inventory instantiates every currently composed feature module.
The only duplicate action is the deliberate shared `more` / Reports `more` name;
a regression pins the shared handler's precedence. No backend, schema, scheduler,
provider collection, data, or report encoding changes are included.

## Verification

- Both unchanged Schedule regressions now pass: append/reversal/filter/season
  fencing and old-order cursor restart with late-filter response rejection.
- The full selected actual-main connection, Reports refresh-window and Reports UI
  aggregate passes 93/93 with JSDOM, zero skips. It includes reports >100 rows,
  preserved windows through background refresh, late More responses and sort/team
  changes.
- Two action-composition tests pass: all-module collision inventory and ordinary
  Schedule/Team paging with the Reports controller installed plus dirty-editor
  rejection.
- This is deterministic DOM evidence. No physical-device or production browser
  pagination result is claimed by these tests. The original 7.2.9 failing receipts
  remain separate from this repaired result.

The separately developing team-game matcher and provider-summary polish are not
part of this release.
