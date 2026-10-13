# Provider summary polish

Settings and Manage retain their original source controls and concise headline
style. The shared browser helper summarizes the existing status model; it does
not change collection, job scheduling, saved data, authorization or backend APIs.

- Queued, running and retrying work have distinct short labels.
- A blocked or failed component beside working components adds “Some data needs
  attention”; it does not describe the entire import as failed.
- Partial saved data, unpublished data and unavailable data remain distinct.
- “Source update complete” requires every reported group to be ready with
  complete coverage, with positive group counts accounting for the full provider
  total. It is not a claim that all provider history, canonical publication, or analyzed games are complete. Source completion can coexist with an Analyzed count of zero and the existing separate projection-pending notice.
- Job counts never become game counts, a progress denominator or a percentage.
- Zero-job connections use existing typed authorization context. Saved-only
  disconnected status requires saved evidence. An incomplete connection page
  cannot establish that every account is disconnected or needs reconnection.
- Existing non-synthetic provider headlines are preserved. Update details and
  Diagnostics retain the original technical counts, coverage, errors and timing.

Verification uses synthetic data without provider access. The focused pure suite
and actual-main DOM suite cover a live-shaped Trace distribution (9 blocked, 501
queued without coverage, 160 queued with partial coverage, 3 ready), all major
states, zero/missing status, existing Manage controls, repeated Settings open/close,
and the unmodified Update details and Diagnostics output. The source-summary tests are read-only; connection-action tests use synthetic fetch responses only. This is local verification, not a live deployment receipt.

## Provider Manage parity repair

The real `createApp` plus full feature composition reproduced the mismatch:
Settings → Manage retained the correct provider dataset and title, but every
provider began with Club logo and Club kits, followed by roster and season
controls. It was a shared presentation mismatch, not an overwritten Trace route.

Provider-specific controls now lead the existing sheet:

- TeamSnap: Sync now and Reconnect.
- Trace: Connection, Check for updates, import/export, source-evidence export,
  and eligible tracking capture. Connection reuses the matching saved account;
  explicit Reconnect retains the secure email-code flow.
- GotSport: club logo/kits, a public team ID/page field, Save team and Disconnect.
  Save uses the existing public resolve and explicit candidate-review flow. No
  private-account chooser or sign-in action is offered. The field is not filled
  with an internal source key: the current catalog does not expose a native page
  ID. The saved source name remains visible.

Disconnected providers stay on their Manage sheet until the user chooses to
connect; initial no-team onboarding stays unchanged. Close, Escape, backdrop and
Back reveal the same Settings and restore the provider opener without adding a
history entry. A guarded refresh replaces any stale headline after a Manage
update; a late refresh cannot replace newer navigation or reopen closed Settings.
A pending or failed refresh never retains a misleading completed headline.
Explicit navigation and entry into credential flows discard that bounded Settings
parent. Existing dirty-confirmation and late-response guards
remain in force. Source-job, roster and season evidence stays available below the
provider controls; detailed job groups remain in Update details and Diagnostics.

No backend, schema, import resets, provider transport, credential storage or
pending command-ID behavior changed.

## Final local verification

```sh
MYTS_JSDOM_MODULE=/tmp/myts-dom-harness/node_modules/jsdom \
  node --test tests/provider-manage-ui.test.mjs \
  tests/source-progress.test.mjs tests/source-progress-ui.test.mjs \
  tests/attendance-retry-ui.test.mjs tests/connection-ui.test.mjs \
  tests/feature-action-composition.test.mjs tests/connection-flow.test.mjs \
  tests/data-files-ui.test.mjs
```

Local receipt (2026-10-13): final combined scope passed 185/185 tests, zero skips.
It covers ordinary Settings clicks for all three providers, connected and
disconnected sheets, exact account/root isolation, reconnect and genuine
interrupted challenge restoration, Cancel/Close/Back/Escape/backdrop, newer
navigation, late status/auth/update/attendance replies, dirty confirmation,
public candidate review, immutable pending command IDs, source completion with
zero published analysis, Diagnostics detail preservation, data-file intents and
shared action composition. No npm-test wildcard, Miniflare, native Worker run,
production browser or real provider was used for this repair. This is local UI
verification, not a deployment or real authentication receipt.

## Historical baseline failures, since resolved

The earlier provider-summary receipt had 65/65 focused checks and 144/146 with
the then-current full connection DOM suite. Its two Schedule failures reproduced
on detached baseline `ee4b8c2`:

- Schedule pagination append/reversal/filter/season fencing expected `newest,
  older` and got only `newest`.
- Old-order cursor restart expected three requests and got one.

These are historical baseline reds, not open integration gaps. The 7.2.10
[shared pagination dispatch repair](shared-pagination-dispatch-repair.md) fixed
the shared More handler; both unchanged regressions pass in the final combined
receipt above. Their subsequent live acceptance belongs to the release record,
not this synthetic provider UI proof.
