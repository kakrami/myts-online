# Joined-game workflow regression

Original reproduction baseline: unpublished integration `8fd7ca0`. Final passing integration: `60fdb71` (including the reviewed projector correction). Synthetic data only; production untouched.

Command: `node --test tests/team-game-joined-workflow.test.mjs`.

Scope: production `DomainRepository.ingestSourcePage` accepts typed collector-shaped pages, production root reconciliation creates native canonical identities and season resolution, and the real bounded projector publishes normalized groups. SQLite replaces D1; complete coverage and refresh receipts are synthetic. This does not exercise provider HTTP collectors, job leases, native runtime, browser DOM, cross-season transitions, or production data.

The single connected lifecycle verifies Schedule, all four original/source detail references, TeamSnap attendance, manual player analysis, player detail, three immutable report captures, saved bookmark and correction keys, real owner rejection/reacceptance, wrong-team/account sources, and revoked private membership. Public H2H/history retains its public canonical identity. Native source rows and links stay byte-identical. Native spatial analytics remain explicitly unavailable.

The original red receipt exposed an authority defect: the joined row declared its public schedule source, but its kickoff remained the TeamSnap native time, 31 seconds later. The reviewed shared projector correction now uses the selected schedule fact while preserving owner corrections and retained accepted placement. The complete lifecycle passes with exact timestamp, venue and field assertions, including after reacceptance. The combined joined-workflow, batch-recovery and two-season analysis-admission run passed 17/17 with zero skips in 15.70 seconds; the earlier red remains historical evidence.

The TeamSnap observation remains SCHEDULED with an unverified reported 9–9; the synthetic public fixture independently supplies FINAL 2–1. This fixture does not claim Trace UNKNOWN-game aggregate coverage; that is a separate audit.
