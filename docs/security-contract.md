# Fresh installation security contract

Status: fresh implementation in `src/security/`, integrated into the review application and tested against native local D1. The review release uses this one security model and a fresh installation schema.

## Owner setup and ordinary sign-in

The existing `/admin` form remains a single password field. On a fresh installation, the entered password must match the existing deployment `ADMIN_KEY`; an arbitrary first visitor cannot claim the installation. The initial password is stored as PBKDF2-HMAC-SHA256 with 600,000 iterations, a random 128-bit salt and a 256-bit verifier. After initialization, the database verifier is the authority. Changing the deployment bootstrap value does not change the owner's password or destroy provider authorization.

Passwords are used exactly as entered, without trimming or Unicode normalization. Setup and password changes require 16–300 characters. Login attempts are bounded to ten per client/IP bucket per ten minutes; the route supplies its trusted request IP as `clientKey`. Rate-limit identities are hashed in storage. Routes must bound JSON bodies and must never log password fields.

Each login creates a different random 256-bit session token. Only its SHA-256 digest is stored. Sessions expire after seven days and can be revoked independently. The Secure, HttpOnly, SameSite=Lax cookie supports the existing cross-origin TeamSnap navigation. Every unsafe authenticated request still requires an exact same-origin `Origin` header. There is no raw `x-admin-key` authorization bypass.

Password rotation verifies the current password and active session, uses a revision/CAS guard, revokes existing owner sessions and pending provider sign-in attempts, and issues one replacement session. It does not revoke existing viewer links or change credential encryption.

## Provider credentials and installation boundary

Initialization generates one independent random AES-256-GCM vault key in `security_installation`. Every encryption uses a random 96-bit nonce, a 128-bit authentication tag, a version/key identifier, and the canonical provider account UUID as authenticated associated data. Copying an account A envelope to account B fails authentication. Pending Trace sign-in data uses a distinct attempt-bound context. Credential plaintext is limited to 32 KiB.

`security_account_credentials` references the domain's `provider_accounts.id`. Storage and retrieval are guarded by the captured account `generation` and `active=1`; credentials are never copied into source-team attachments or jobs. Stored provider expiry is enforced when one was actually returned. No refresh-token grant is assumed. Provider identity verification must complete before an account writer stores authorization.

The master key is stored in the same trusted D1 installation as the encrypted account credentials. This choice avoids introducing another deployment secret or tying background execution to the owner's password. It separates login-key and credential lifecycles and keeps credential plaintext out of ordinary account records and diagnostic exports. It does **not** protect credentials from an attacker who can read the entire database or run arbitrary server code. D1/admin access and server code are trusted. Neither the master key nor credential envelopes/plaintext may appear in API models, diagnostics, dataset exports or viewer responses.

`getCursorSigningKey()` derives a 256-bit key using HKDF-SHA256, installation key ID salt and the purpose `myts-cursor-signing-v1`. Only server cursor code receives it. It is separate from the AES key, stable across password changes and never returned to clients. Deliberate vault-key rotation is a separate operation; this module does not silently rotate, migrate or re-encrypt keys on login.

## Sharing and route authorization

Viewer tokens are random 256-bit values with SHA-256 digests in D1. One active link generation belongs to a canonical `app_teams.id`; issuing a replacement revokes previous links. A team deletion request immediately blocks authentication and owner link recovery before bounded cleanup removes its links. Optional expiry is supported.

Allowed projection categories are `overview`, `schedule`, `competitions`, `team`, `players`, `matches`, `bookmarks` and `reports`. A viewer may read only the explicit categories of its one team. `accounts`, `credentials`, raw source records, Coach, diagnostics and source dataset/evidence imports/exports are owner-only. Scoped report snapshot creation and report file export derive only whitelisted read-only team projections; they require the explicit `reports` category and same-origin requests. A projection permission is not permission to expose every private field attached to a public event: domain read models must omit private logistics, raw account data, credentials, Coach records and unapproved private analytics.

`authenticateRequest(request)` defaults to owner-only. A route may allow GET/HEAD viewers only by passing `{projection: {teamId, category}}`. It checks the same-origin requirement for writes, validates the cookie or hashed viewer token supplied in `x-view-key`, and rejects other scopes before a domain read. Share secrets are not accepted in query strings; links use `/view/<token>`. To use the domain/read repository's actor shape, convert only a verified principal: owner to `{owner: true}`; viewer to `{owner: false, teamId: principal.team_id}`. Never accept an actor, role or team scope from a client JSON body.

## Provider connection flows

TeamSnap retains the established browser implicit grant, `scope=read`, and `${origin}/admin` callback. Client ID is entered once inside the owner TeamSnap connection flow and reused for reconnection. It is not a new general Settings or deployment field. `teamSnapConfiguration(ownerToken)` is an owner-only connection read; it is absent from viewer/bootstrap projections.

OAuth state is random, hashed, ten-minute, bound to the exact owner session, callback origin and client registration. `completeTeamSnapOAuth` atomically deletes a matching unexpired state before accepting a token. Missing, null, empty, wrong, cross-session, wrong-origin, expired and replayed states fail. A provider `error` consumes valid state and returns a dedicated safe authorization error. Untrusted provider error descriptions are not reflected. The callback parser sends the returned fragment to a same-origin owner endpoint, then removes the fragment from browser history. Account `/me` verification follows state validation before storing a token. A missing expiry stays unknown; no token renewal is invented.

Trace attempts have separate random handles, hashed owner-session binding and twenty-minute expiry. Their email, provider user ID and guest cookie are encrypted with attempt-specific associated data. Codes are submitted to Trace and are never persisted here. A claim obtains a two-minute lease and unique claim ID; a stale response cannot finish another claim. The verification route must bound its complete provider exchange below that lease. A wrong code/network failure may release the same attempt for retry, up to eight verifications. A successful finish consumes the attempt. Explicit cancellation deletes it. Concurrent attempts do not overwrite one global pending row. Provider `/users/self` account identity must be confirmed before account authorization is saved.

## Integration API

`new SecurityStore(db, {now?, bootstrapPassword: env.ADMIN_KEY})` takes native D1. Apply exported `SECURITY_SCHEMA` as part of the fresh combined schema, after domain table definitions. `installSecuritySchema(db)` is the test/installation helper; it reads no old records.

| Method | Input / result |
| --- | --- |
| `ownerConfigured()` | Returns whether the fresh owner verifier exists; no secret |
| `initializeOwner(password, {clientKey})`, `login(password, {clientKey})` | Return `{token, expires_at}`; route writes `ownerCookie(token)` |
| `requireOwnerSession(token)` | Returns verified `{role:'owner', session_id, expires_at}` |
| `authenticateRequest(request, {projection?})` | Returns verified owner or team-scoped viewer principal |
| `rotateOwnerPassword(token, current, next)` | Returns replacement session; old sessions and pending auth are revoked |
| `revokeSession(token)` | Logout; route also expires the cookie |
| `createViewerToken(ownerToken, teamId, {categories?, expiresAt?})` | Returns the new share value; prior links revoked, recovery envelope encrypted independently of owner password |
| `retrieveOwnerViewerLink(ownerToken, teamId)` | Recovers only the current active owner share link; encrypted with team/hash binding |
| `viewerPrincipal(token)`, `authorizeViewer(token, teamId, category)` | Resolve/check one read-only projection scope |
| `revokeViewerTokens(ownerToken, teamId)` | Revoke all current team links |
| `storeAccountCredential(accountId, plaintext, {generation, expiresAt?})` | Trusted account writer; CAS against active generation |
| `loadAccountCredential(accountId, {generation})` | Trusted collector; returns plaintext only for the active captured generation |
| `encryptCredential(binding, plaintext)`, `decryptCredential(binding, envelope)` | Trusted internal vault primitives; never route handlers by themselves |
| `getCursorSigningKey()` | Trusted server-only HKDF key for cursor codec |
| `teamSnapConfiguration(ownerToken)` | Connection-only Client ID/required state |
| `beginTeamSnapOAuth(ownerToken, {origin, clientId?})` | Returns authorization URL, state, expiry and `/admin` redirect |
| `completeTeamSnapOAuth(ownerToken, fragmentFields, {origin})` | Returns validated token/client/known expiry for subsequent provider identity verification |
| `beginTraceAttempt(ownerToken, {email, userId, guestCookie})` | Returns attempt handle/expiry after successful provider code send |
| `claimTraceAttempt(ownerToken, handle)` | Returns claim ID and decrypted provider pending context to trusted verification code |
| `finishTraceAttempt(ownerToken, handle, claimId, {success, retryable?})` | Consume a verified attempt or release/close a failed claim |
| `cancelTraceAttempt(ownerToken, handle)`, `pruneExpired()` | Cancel a chosen pending attempt / bounded scheduled cleanup |

`SecurityError` carries `code`, safe `message`, and HTTP `status`. The ordinary route error handler must preserve these fields without logging raw request bodies. Helpers `requestSession`, `ownerCookie`, `assertSameOrigin`, `requireOwner`, and `authorizeProjection` are exported for route integration.

An explicit `x-view-key` selects viewer mode before any owner cookie. Projected reads stay in that token’s team/category scope; unsafe commands and private endpoints reject it even if the browser also holds a valid owner session. Invalid viewer keys do not fall back to owner privileges. The internal `shared_metadata` projection permits only the scoped team’s bounded GET season catalog, revision, summarized update status, branding and scoped logo models when the token has at least one valid granted category. It cannot be granted as a token category and does not permit Overview, another team’s data or private commands. Public source-team detail has its own additional `team`, `competitions` or `matches` category requirement and remains inside the selected season’s observed public participant/category graph. Viewer-link insertion and prior-link revocation check team lifecycle inside their atomic database transaction, so a delayed rotation cannot add or revoke links after deletion starts.

## Verification and limits

`node --test tests/security.test.js` uses a fresh native Miniflare D1 database. Its actual Workerd entry initializes the owner through WebCrypto PBKDF2 at the release work factor; it is not a Node-only hash test. Other store cases run the same module against native D1 and Node WebCrypto.

The meaningful cases cover unauthorized initial claim, wrong-password limits, unique hashed sessions, password rotation with credentials/share links retained, account-bound AES integrity, active-generation fencing/expiry, team/category viewer exclusions and deletion, purpose-separated cursor signing, OAuth session/origin/replay/error/expiry handling, independent Trace attempts/claim leases/retry budgets/session revocation, and same-origin route defaults.

These local tests do not establish Cloudflare production CPU quotas, provider consent/registration, Trace account entitlements, or integrated frontend behavior. Those gates remain part of full-release validation. On the installed Workerd, a direct runtime probe accepted both 100,000 and 600,000 PBKDF2 iterations; the obsolete 100,000 limit was not assumed. Production initialization/login must still be verified under the target deployment plan.

Primary implementation references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Cloudflare Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), and the original myTS `beginOAuth`/return validation extracted from `release-inspection/source/worker.js`. The OWASP reference supports the selected PBKDF2 work factor; native Workerd evidence establishes current local support.
