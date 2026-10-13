# Trace membership-time contract repair in 7.2.7

## Observed failure and exact reproduced boundary

The real Trace sign-in and discovery succeeded, then 12 recent game jobs kept
retrying `source_contract` at their `members` stage with offset zero. The failed
member page is not persisted, so its exact private value shape was not recovered.
No raw response, credential or child identity is included in this diagnosis.

The frozen collector preserves native `join_time` and `leave_time`. The storage
builder passed both through generic `Number(value)` normalization, which rejects
zoned date strings. Synthetic ISO values in either field reproduce the exact
error code and temporary classification through the real collector and storage
builder; null and finite numeric controls succeed. Original myTS 6.20.133
`reduceTraceMember` preserves these native values (worker line 4478), and its
engine calls `Date.parse(leave_time)` (line 323). This proves a supported original
contract regression consistent with the live stage, without claiming the unseen
live payload was inspected.

## Bounded normalization

Only Trace membership times gain explicit absolute-date handling. Null remains
null. Finite numeric primitives and finite strict decimal/exponent strings retain
their numerical value with no seconds/milliseconds inference or magnitude-based
rescaling. A complete calendar-valid `YYYY-MM-DDTHH:mm:ss[.fraction]` with `Z` or
an explicit numeric offset normalizes to epoch milliseconds. Fractions of one to
nine digits are accepted; the millisecond projection does not discard the exact
original spelling and precision retained in source evidence.

Missing-zone dates, impossible calendar values, leap-second/24-hour spellings,
unknown `-00:00` offsets, booleans, arrays, objects, blank membership times,
hexadecimal strings and non-finite values fail the existing source contract.
Calendar checks precede conversion, avoiding permissive date-parser rollover.
The explicit format follows the relevant numeric-date structure in the
[ECMAScript date-time format](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date-time-string-format);
it deliberately does not rely on implementation-specific string parsing.

Other Trace optional numeric facts preserve the original reducer's blank-to-null
behavior; explicit zero remains zero. Decimal/exponent numeric strings remain
supported, but coercive truth values and composite values do not become numbers.
Other providers retain their existing normalization.

Portable import preserves a valid raw member-time spelling only when its numeric
projection agrees with the saved column. A legacy row whose evidence contains an
old permissively coerced blank/boolean/array uses its saved column, as before.
This keeps old history readable without weakening new provider validation or
letting contradictory file evidence override the saved typed value.

## Absolute statistics time is separate

The native statistics query requests `start`. Original UI lines 2129–2130 compare
that item value directly with half-period bounds; original worker line 4496
builds those bounds from `clip.startTime + durationSeconds * 1000`. Thus `start`
is an absolute clip-clock millisecond value. It remains in raw item evidence and
is not copied into the relative `time_seconds` column. Spatial reads already use
the preserved item evidence. No guessed units, zero clock or false timing fact is
introduced by this release.

## Failure and recovery behavior

Deterministic builder `source_contract` failures now classify as permanent, with
one static public storage-contract message. Raw error text and values are never
shown. Authentication/revocation remains blocked; timeout/rate-limit/transient
errors keep their existing retry behavior. A rejected member page cannot advance
its checkpoint, claim complete coverage or delete previously saved header/data.

Existing live jobs currently retrying can use their preserved `members` cursor
on the next eligible attempt after deployment. They do not require an account
reconnect, data reset or forced restart. This local fix does not establish live
Trace completion; normal background status and published analysis must still be
checked on the actual connected account.

## Verification boundary

The retained pre-fix receipt reproduces both direct normalization failure and the
production collector-to-repository failure. Focused tests cover strict dates,
offsets, fractions, null/zero/negative/numeric-string compatibility, malformed
values, safe classification, blank moments, exact raw evidence and portable
round trips. The production full-game fixture traverses header, members, moments,
derived jobs, both radars, tracking, analytics and heatmaps under existing scope
proofs. The independent focused suite passes **9/9**, zero skips. Native Workerd/D1
passes **1/1**: all **44 jobs** reach ready, comprising 4 game pages, 2 radars,
14 tracking jobs/56 segment rows and 27 analytics jobs/items/heatmaps. Ninety
manual invocations including idle used at most **31 SQL statements**, 36,823
native rows read, 4,217 rows written and 80,563 synthetic provider-response bytes.
The malformed-calendar case fails permanently on its second invocation, keeps
its exact members checkpoint and saved header, writes no members/moments, and
stays idle afterward (maximum 27 statements).

This is a synthetic-provider native collector/coordinator workflow with the
production domain/sync schemas and a 48-statement BudgetDB. It does not run the
full installation-epoch wrapper, owner HTTP route or alarm-only workflow; its
counts are not represented as those broader invocation totals. The change adds
no SQL. The test asserts its 151-module source fingerprint is unchanged before
and after execution:
`d4774dc6d52c5752bef3525ddeddac14f7df3e8c9ce37928610557a7a005479d`.
A subsequent per-file map reproduces that observed fingerprint; it is labeled
as subsequent verification, not a contemporaneously retained map.

The independent adjacent 70-case source-budget, report-refresh, portable-history
and Trace collector/resolver suite passes with zero skips. No schema, source
identity, account entitlement, scheduler priority, collector page limit or hard
SQL/byte budget changes are made. The separate shared team-local matching work
is excluded from this release.
