# Selective native tracking evidence

This feature preserves the original Source Manage workflow: choose an attached Trace game, a native half, a start and duration, and 1–4 observed tracks; request fresh provider evidence; download a JSON report. It is separate from a saved season dataset or evidence ZIP.

## Owner workflow

`GET /api/tracking/games` lists authorized saved canonical games for the selected team, season and Trace attachment, newest first, using signed continuation cursors (maximum 50 games per page). `POST /api/tracking/plans` creates a 15-minute plan for one unambiguous native game. The plan lists saved native half durations and observed own-side track names/jerseys, including unresolved or dummy tracks. Track choices are opaque IDs; names and jerseys never assert a person identity. The stable plan paginates at most 50 choices per page and preserves selections across pages.

`POST /api/tracking/captures` accepts `plan_id`, `half` (1 or 2), `start_seconds` (0–7200), `duration_seconds` (1–600), and 1–4 distinct `track_ids`. The window must fit the declared half. Each attachment permits one new capture per minute. Admission rechecks the current owner session, active team/season, absence of a deletion marker, native event correspondence, provider entitlement, account and attachment generations, credential expiry, and plan/source revision within the actual write.

The response identifies a durable capture. `GET /api/tracking/captures` lists at most 20 recent captures per page; `GET /api/tracking/captures/:id` reports queued, capturing, complete, partial, blocked or failed state, counts of captured/failed/truncated/unavailable records, and the protected download URL. Reopening Source Manage finds the same job and artifact. `GET /api/tracking/captures/:id/download` returns `myts_tracking_evidence_<native-game>.json` when the artifact is terminal. Every route requires the current owner; viewer links cannot plan, request, list or download this private evidence.

## Independent fresh collection

The durable job is `trace / tracking-capture` in the export stage, with an explicit account generation and team demand. It continues through native Durable Object alarms without browser polling. Closing the browser or expiration of the initiating session does not cancel valid work. Account revocation, changed authorization generation, detached/replaced attachment or team deletion prevents additional captured bytes. Current owner authentication and the authorized source scope are required again for download.

The collector first retrieves a fresh native token and detailed game. It verifies the token's native account, exact game and team participants, native own-side, selected observed tracks, requested half clip and actual window. Explicit denied permissions remain restricted. It keeps the native home/away side; it never rewrites away tracks into home tracks. It then captures the explicitly declared radar asset, when present, and one bounded Halo response per selected track. Each Halo segment preserves the requested start, local start, duration, native clip and the grounded provider query track ID. Raw command rings remain raw evidence; positions or time samples are not silently converted into published player facts.

| Bound | Contract |
| --- | --- |
| HTTP requests | 7 total attempts, including redirects |
| Response bytes | 12 MiB cumulative |
| Fresh game metadata | 2 MiB per response |
| Halo response | 1 MiB per selected track |
| Radar retained prefix | 128 KiB; truncation is explicit |
| One invocation | 22-second deadline, 10-second request timeout |
| Redirects | At most 2, same origin only |
| Artifact storage | 64,000-byte parts; 12 MiB artifact cap |
| Artifact retention | 24 hours; bounded background cleanup |

Only explicit HTTPS Trace endpoints/assets are requested. Unsupported hosts, credentials, user-info, ports and guessed radar URLs are rejected. Provider cookies are sent only to `go.traceup.com` and `teams.traceup.com`, never to foreign asset hosts. A bare 403 is access denied; only actual challenge evidence is human verification. Successful retrieval timestamps come from successful response observations, never from attempted or failed requests.

## Partial results and isolation

The JSON format is `myts.raw-tracking-evidence`, version 1, with a visible Worker version, selected window, bounded records, usage and any failure stage/code. Missing radar metadata is unavailable; a retained radar prefix is truncated; a denied or failed request is recorded explicitly. A terminal partial artifact remains downloadable and never claims that unavailable commands were captured. Tokens, cookies, owner credentials, account UUIDs and private Coach data are not included.

Each committed page atomically persists its artifact parts, checkpoint and record statuses under the job lease plus current team/account/attachment scope. An interruption resumes from the last committed page. Terminal artifacts are immutable. Orphaned queued work is recovered by the scheduled bounded scan. Deletion and expiry cleanup remove parts before their headers in bounded batches.

Capture writes touch only capture artifacts and normal job/usage status. They do not ingest a source snapshot, create source players, alter native track assignments, recalculate stats, or advance canonical content/source revisions. The UI states that saved stats stay unchanged. This JSON is not an importable source dataset.

## Verification scope

The source contract suite exercises fresh identity/half/window checks, exact native query payloads, four-track request limits, retained/truncated radar prefixes, explicit missing assets, response budgets, safe credentials and redirects, account-generation checkpoint changes, 401/403/429 and actual challenge classification. Native D1 artifact tests verify paged stable choices, atomic command and publication fences, resumable parts, safe JSON download, source/stat isolation, and bounded list/download requests. The final release verification report records the authoritative test counts and HTTP/native alarm proof for the packaged candidate.

Fresh private Trace capture against the real provider account has not been accepted by these controlled tests. Real entitlement behavior, current provider responses and Cloudflare production capture remain explicit acceptance items; a passing fixture is not a real account verification claim.
