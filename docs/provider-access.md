# Provider access contracts and verification boundaries

Review date: October 11, 2026 UTC. The preserved frontend reference is 6.20.133.
The current application uses the fresh modules in `src/`. Historical 7.0.1
observations below are provider-contract evidence, never fresh-build acceptance.
The final release verification report is authoritative for the delivered build.

## Verified scope

| Check | Evidence | Result and boundary |
| --- | --- | --- |
| Fresh source/analysis contract suite | `tests/evidence/fresh-source-analysis.json` | 41 tests pass: 23 source contracts, 14 native D1 analysis tests and 4 native branding tests, including deletion races. Private payloads are synthetic. This does not authenticate a live private account or deploy the fresh build. |
| Fresh branding source defaults | `tests/branding-contract.test.js` | Native D1 tests cover bounded public owner/viewer defaults, private current-authorization fences, exact public bridge, unsafe URLs, ambiguity, lifecycle absence and imported-fact rejection. Source logos are provider asset URLs; no kit colors are invented. |
| Fresh selective tracking evidence | `docs/tracking-capture-contract.md`; tracking source/artifact/HTTP suites | Controlled Trace responses exercise fresh game/half/window/track verification, bounded raw radar/Halo evidence, atomic generation/deletion fences and owner JSON download. An assembled HTTP request completed through native alarms with zero application requests while closed. This does not verify real private Trace capture or Cloudflare production entitlement/quotas. |
| Historical real public source collection | `tests/evidence/provider-public-access.json` | Historical 7.0.1 collectors: 77 jobs ready, zero errors, 233 GotSport and 51 Live fixture observations. Counts include competition/opponent fixtures, rather than only games played by the connected team. |
| Historical real public native alarms | `tests/evidence/provider-native-alarm.json` | Historical 7.0.1 local runtime completed 77 jobs in 138 seconds with native Durable Object alarms, no browser/manual runner after connection, and 100 real HTTP 200 responses. Native D1 saved 240 GotSport and 51 Live competition fixtures. |
| Historical connected-team read projection | Same historical alarm evidence | Read loop returned 79 native entries (65 GotSport, 14 Live), all involving GS212707/Live199135. It does not prove 79 reconciled matches or fresh-build integration. |
| Historical Cloudflare public background progression | `tests/evidence/production-background.json` | Existing 7.0.1 review Worker progressed from 14 ready components before close to 69 after reopen, with zero errors. Exact terminal completion within the entire closed interval was not established. |
| Historical Trace real browser authentication | Same historical production evidence | Trace email-code authentication established a real session and returned the named team chooser. Historical import progressed after selection; persisted closed-interval completion was unverified. This does not verify fresh-build private authentication. |
| TeamSnap live private acceptance | Official contracts and fresh synthetic tests | User-account consent, callback registration, discovery and private retrieval remain unverified for the fresh build. A public API/login page is not private access evidence. |
| Fresh production source updates and private access | Final release verification report | No claim here that the fresh build has been deployed, that all private entitlements work, or that fresh Cloudflare updates were verified with every browser closed. Review the final report for any later acceptance evidence. |

Historical public collection used a Node HTTPS transport binding with native
Miniflare D1 and Durable Object alarms. The provider responses were real. That
binding bridged local runtime outbound DNS limitations; it was not a production
network test. Machine evidence preserves hashes, checkpoints and scope without
credentials or complete provider response bodies. Historical probe script paths
are not part of the fresh release and are not fresh verification instructions.

## External contracts

### GotSport and GotSport Live

These are observed provider-hosted JSON contracts, not a promise that every
deployment or future response remains accessible.

| Responsibility | Current contract |
| --- | --- |
| Team profile | `system.gotsport.com/api/v1/team_ranking_data/team_details?team_id=212707` |
| Registered competitions | `system.gotsport.com/api/v1/team_ranking_data?team_id=212707` |
| Past matches | `system.gotsport.com/api/v1/teams/212707/matches?past=true&page=…&per_page=100`; validate native participant identity and pagination totals |
| Competition metadata | `system.gotsport.com/api/v1/event_ranking_data/event_details?event_id=…` |
| Division matches / standings | `event_ranking_data/flight_matches` and `event_ranking_data/flight_registrations`, with event and flight identities |
| Live bridge | Competition `event.live_event_url`; separate from `website_url`. Validate an HTTPS `gotsportlive.com/league/{id}` or `/league-organizer/{id}` link. |
| Live team identity | Provider-hosted organizer, club and season records on `gotsportlive-api.azurewebsites.net`; require `ExternalDataSourceName="GotSport"` and exact `ExternalDataSourceKey="212707"` |
| Live schedules / standings | Native team coming-games cursor and organizer/category schedule and standings endpoints, with organizer/category/league identity checks |

The successful run establishes that public source access is presently possible
from this review environment. It does not establish that a previous verification
failure was caused by an application bug or that every GotSport webpage is free
of verification challenges. A provider challenge must remain a distinct access
condition with saved-data timestamps, not become a successful empty import.

### TeamSnap

The fresh app preserves the original provider-hosted browser OAuth authorization:
`https://auth.teamsnap.com/oauth/authorize`, `response_type=token`, `scope=read`,
and `${origin}/admin` callback. Client ID is entered once in the connection flow
and retained for reconnection. It is not a team identifier, generic Settings
control, deployment secret or browser client secret. A new deployment origin must
be permitted by the existing provider OAuth registration.

The fresh security service creates a nonempty random state bound to the current
owner session, permitted callback and expiry. The callback claims it once and
rejects missing, mismatched, expired, reused or superseded-session state. It
checks a returned OAuth error, then verifies `/v3/me` before saving the encrypted
account credential and queuing account discovery. Returned `expires_in` is
retained as credential expiry; expired credentials require reconnect. This flow
has controlled native tests, while real fresh-build consent, callback and private
permissions remain unverified. No refresh-token support is claimed for this
grant without verified provider evidence.

TeamSnap's official SDK quick start documents browser authorization, application
registration, same-domain callback handling and Client ID initialization. The
separate official OmniAuth server-side integration does not imply this app needs
a deployment client secret. Those documents do not prove the user's actual
registration or private entitlement; the SDK quick start is historical and must
be checked against real consent/callback behavior for live acceptance.

### Trace

The fresh app preserves the original broad email-code/session flow:

1. Obtain a guest PHP session from `teams.traceup.com/webapp/users/self/logout`.
2. Resolve the account via `lapi.traceup.com/tracebot-prod/42/users/search`.
3. Send `email_type=magic-code` through `/autologin-url/send`.
4. Verify through `/users/login/by-code`, then confirm `/users/self`.
5. Enumerate `/users/self/teams?sport_type=any`; select an account-owned team.
6. Obtain `/users/self/token` for GraphQL calls to `go.traceup.com/traceid-prod/graphql`
   and relevant provider-hosted analytics services.

These endpoints are implementation contracts observed in the original app,
not a public API guarantee from Trace. Trace's official help pages confirm its
provider-owned Trace iD login and subscription-dependent access. They do not
document or validate the app's private session endpoints or account entitlement.
Historical real authentication succeeded as recorded above. Fresh authentication,
roster/game retrieval, statistics availability, tracking, goalkeeper identity and
subscription restrictions still require fresh live acceptance. Synthetic tests
validate the scoped implementation, rather than the account entitlement.

## Fresh failure classification

| Condition | Fresh interpretation / next action | Verification boundary |
| --- | --- | --- |
| DNS, connection failure, timeout, provider 5xx | `source_network`, `collector_timeout` or `source_http`; retry within independent job policy and retain successful records/checkpoints | Fresh bounded transport and resumable job tests; deployment egress remains a live check. |
| HTTP 429 | `rate_limited`; retain data and honor valid `Retry-After` | Controlled HTTP contract tests. |
| Expired/revoked private authorization | `authentication_required` or explicit account credential expiry; reconnect instead of claiming successful retries | Native security and synthetic provider tests; real expiry behavior still needs live verification. |
| Permission/entitlement denied | Bare 403 is `source_access_denied`; explicit private GraphQL denial is `account_access_lost` | A denial alone does not prove wrong password or human verification. |
| Redirect/non-JSON response | `source_redirect` or `unsupported_response` | Neither is human verification by itself. |
| Actual challenge marker/header | `human_verification`; retain saved records and report blocked scope | Requires `cf-mitigated:challenge` or an actual recognized provider challenge script marker. |
| Valid terminal empty result | Complete empty coverage, with a successful retrieval timestamp | Challenge, malformed and inaccessible responses never produce this state. |
| Changed schema/wrong identity | Contract failure; retain prior successful data and require review | Fresh source shape/participant scope tests; no name/time identity guessing. |
| Analytics unpublished/restricted | Explicit component availability, including unsupported, incomplete or human review | Does not imply the entire provider sync or analysis succeeded. |
| Related records pending/ambiguous identity | Independent pending dependency or owner review | No silent provider-person or match merge. |
| Local configuration/callback/vault failure | Application setup or credential-state error | Not labeled provider password failure or an invented security challenge. |

There is no evidence here that a wrong-password message is specifically an
anti-AI security feature. Identify the responding service, HTTP result, callback
error, or challenge before attributing a cause.

## Browser handoff and live acceptance

These steps are for the review build once its connection screens have been
corrected and its exact visible controls checked. They do not ask the user to
send credentials or codes through chat.

1. Owner opens the review site's `/admin`, signs in locally, and opens the existing
   TeamSnap connection flow. Preserve its one-time Client ID requirement and
   existing callback path. If registration is actually missing, stop at that
   concrete blocker rather than assuming the user must create another app.
2. Continue to the provider-owned TeamSnap page. The currently visible login
   labels are **Email Address**, **Password**, and **Log In**. Owner enters those
   directly there and completes any provider consent. Return must verify state,
   show a confirmed account, and offer account-owned teams for selection.
3. Owner opens the existing Trace connection for the selected myTS team. Enter
   the Trace email in the app's **Send sign-in code** flow; enter the emailed code
   only into its **Verify code** form. Team selection must display provider names
   and attach the selected team to the existing logical team.
4. Check account/team confirmation and actual schedules, rosters and attendance.
   Verify known games and players against provider screens. Confirm that a second
   provider creates linked records rather than another copy of the same team.
5. Close every app/browser window. Record server-side job attempts, saved times,
   source coverage and revision before and after a scheduled update. Reopen and
   confirm saved data changed without a browser request triggering collection.
6. Exercise reconnection, expired credentials and unavailable analytics with
   explicit status. Record exactly which tests are real, simulated, blocked, or
   unverified; do not mark authentication complete from local mocks.

Private authentication blocks only its dependent live acceptance checks.
Baseline preservation, domain design, public integration and synthetic recovery
checks can continue independently.

## Primary references

- TeamSnap official SDK browser-auth guide:
  https://github.com/teamsnap/teamsnap-javascript-sdk/wiki/Quick-Start
- TeamSnap official server-side OAuth strategy:
  https://github.com/teamsnap/omniauth-teamsnap
- TeamSnap current provider login: https://auth.teamsnap.com/login
- Trace official account entry: https://go.traceup.com/traceid
- Trace official subscription/account guide:
  https://support.traceup.com/content/how-to-subscribe-to-trace-highlights-playerfocus
- Trace official entitlement information:
  https://support.traceup.com/content/trace-id-faqs
- Real provider endpoints and response-derived identity evidence:
  `tests/evidence/provider-public-access.json` and
  `tests/evidence/provider-native-alarm.json`

## Fresh source-layer contract verification

The new `src/sources` layer contains no database, job-engine, authentication-store,
or visible-app-team writes. Its collector returns bounded native records,
fixtures, checkpoints, independently resumable child specifications, detailed
source coverage, and successful retrieval times. Provider requests and source
records remain separate from attachment and canonical projection.

The 23 source-contract tests validate observed public field shapes and synthetic
private payloads. They do not authenticate a private account or prove native
private content is available. The historical real native-alarm evidence above used
the historical 7.0.1 collectors; fresh source-layer production execution still
needs its own integrated acceptance evidence.

TeamSnap's official game-results help distinguishes entering a live score from
finalizing it. The public SDK event contracts inspected expose reported scores
and result fields, but no verified explicit final-state flag. Therefore the new
collector never infers FINAL from two non-null scores: future games are scheduled,
past games have unknown result finality, cancelled games are cancelled, and the
raw reported scores/results remain available with `record_eligible:false`.
This is a deliberate evidence boundary, not a claim that a scored game was never
completed. A documented API flag or independently reviewed result correction is
required before TeamSnap-only scores enter the official team record.

TeamSnap's official SDK availability constants are `NONE:null`, `NO:0`, `YES:1`,
and `MAYBE:2`. The collector preserves the native status and separately emits
NR, No, Yes, or Maybe. Unsupported values remain Unknown. A player with no
retrieved response must not be treated as No or as verified NR.

HTTP 403, redirects, HTTP 429, and non-JSON responses are different conditions.
The new transport calls a response human verification only when it observes
`cf-mitigated:challenge` or actual provider challenge script markers. Cloudflare's
official detection contract documents that header. Bare 403 is access denied,
an ordinary redirect is `source_redirect`, 429 is rate limited, and other HTML is
unsupported response. No response body, credentials, or raw challenge is stored
in observations. `at` records request start; `retrieved_at` is set only after
successful JSON parsing and hashing. The page's `retrievedAt` uses successful
retrieval observations, never failed attempt time.

Primary sources checked on October 11, 2026:

- https://helpme.teamsnap.com/article/594-enter-game-results
- https://github.com/teamsnap/teamsnap-javascript-sdk/blob/main/docs/collections/events.md
- https://raw.githubusercontent.com/teamsnap/teamsnap-SDK-iOS/master/TeamSnapSDK/SDK/DataTypes/TSDKEvent.h
- https://raw.githubusercontent.com/teamsnap/teamsnap-javascript-sdk/main/src/collections/availabilities.coffee
- https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/


## Fresh analysis and identity verification boundary

The recorded isolated fresh source/analysis contract suite includes 23 source tests and 14
native Miniflare D1 analysis tests. Private fixtures in these tests are synthetic
records shaped from the inspected provider contracts. They prove typed ingestion,
scoped resumable publication, canonical identity attribution, source updates and
owner reset/CAS behavior; they do not prove a live TeamSnap or Trace account can
retrieve every licensed component. Source access, app attachment, provider
coverage and derived analysis remain distinct states.

The shared analysis model publishes one immutable effective match-player run.
Roster, player pages, match pages, Overview leaders and report queries use that
model and the same complete-selection SQL. Native shots made are not soccer
goals; native scores alone do not prove finality. A reviewed owner result can
mark a game final. Unknown minutes, starts, goalkeeper minutes and unpublished
attendance stay unavailable rather than becoming zero. Native tracking minutes
are explicitly estimated; lineup positions do not invent minutes. Relevant
source/account/identity/override input changes invalidate an analysis commit;
unrelated teams cannot starve it. A semantic no-op does not republish a revision.

Owner native track choices are bounded server-discovered rows with opaque signed
commands. They require an active authorized own-team Trace game, a current
canonical roster choice, and CAS. Opponent tracks are excluded. Assignment
recollects only that game/account/own-side track and each observed half, then
enqueues independent analysis. Reset restores exact provider identity. Synthetic
D1 tests verify both attribution and overlapping-track minute deduplication.

Captured native maps preserve own/opponent and full/half distinctions and use
signed source-revision-bound pages. Trace points are rendered using the inspected
0–1000 provider coordinate scale, normalized by the server. Captured native
heatmap grids feed a bounded shared season aggregation weighted by known
effective minutes. Imported facts remain labeled file_import. Tactical
attacking direction, goalkeeper duration and named position cannot be inferred
from a heatmap. Live opponent entitlement, tactical orientation and all actual
private provider components still require the authorized live acceptance checks.
Multiple contradictory/native scope maps are reported for human review rather
than silently selecting or combining an unproved identity.

A real public Live standings response on October 11 returned its pool names
under LeagueTable.LeagueName; the bounded response-field evidence is
`tests/evidence/public-pool-fields.json`. This observation does not imply any
competition is finished or that qualification is known.

All owner analysis corrections, lineup writes and track assignments re-evaluate
active team/season membership and lifecycle absence inside their CAS transaction.
A native race test inserts the deletion marker after readonly authorization,
then verifies every create/update/reset is rejected with no changed rows or
queued work. The create case also runs after owner-row cleanup and verifies no
new child rows are recreated. A removed team is unavailable before any read.

## Shared source branding contract

GotSport profile `image` or `team_logo_url_full` becomes
`source_teams.evidence.logo`; `club_name` stays presentation text. GotSport
fixture `homeTeam.team_logo`/`awayTeam.team_logo` and Live real-participant
`HomeTeamClubLogoURL`/`AwayTeamClubLogoURL` are retained when actually returned.
The shared read helper permits only the original public GotSport numeric logo
asset route on `system.gotsport.com`, with an optional observed numeric cache
timestamp. It rejects foreign/API/token/userinfo URLs and never sends credentials
to an image host. Candidate rows are bounded; conflicting or excess semantic
values require human review rather than choosing a source arbitrarily.

Default candidates require provider provenance and active attachments. Private
metadata additionally requires the same active provider account, current
credential generation, unexpired credentials, account-owned discovery and the
exact entitled source team. Public participant fallback follows only the
verified public GS/Live bridge. Imported observations confer neither default
branding nor club authorization. Owner club overrides remain separate.

Current TeamSnap/Trace collectors expose no verified native logo or explicit
`{name,color}` kit-list contract. No such source default is synthesized. Native
TeamSnap event uniform instructions remain intact, and the original owner kit
list may match those names for display. Text instructions do not prove a color,
home/away role or goalkeeper kit. Owner logo/kit reset restores these available
source defaults, including an explicit unavailable state where no default exists.

## 7.1.3 connection entry and recovery

The connection flow reuses a stored, active, unexpired TeamSnap or Trace account
before offering sign-in. Multiple accounts are named and paginated; using another
account is explicit. This does not read another tab's provider cookies.
Candidate teams retain source names, season labels and archived status. The
confirmation defaults to the intended current myTS team/season, or creates a
team named by the source. Destination/name/group edits are under Change.
A consecutive source label such as 2026-2027 can prefill the season-start year;
ambiguous labels ask one explicit question. Existing shared-club conflicts still
require the owner to review affected teams and choose a record.

GotSport has one name-or-public-team-link entry. Public links need no sign-in.
Name searches progressively request the genuinely required U7–U19 age and
Boys/Girls category; there is no NV, Boys or U10 default. Each request fetches one
bounded page of the existing USA rankings search, with optional association and
explicit pagination. Coverage is limited to the provider's published rankings.
Unsupported event/schedule URL shapes are rejected inline with the query kept.
GotSport Live identity remains derived from the existing verified bridge.

TeamSnap's real app registration remains a prerequisite. The owner setup screen
shows the exact HTTPS site /admin callback and links to the provider's registration
instructions. The Client ID remains in security_connection_config, with a Change
app setup repair path even when a bad ID was saved. No deployment variable,
invented Client ID, automatic registration or unverified one-click flow is added.
Optional token_type/expires_in callback fields may be absent; supplied values and
read-only scope remain validated. Single-use, expiring, session-bound OAuth state
and exact callback origin are retained. Real registration eligibility, consent and
account entitlement remain live acceptance requirements.

Trace retains email-plus-code sign-in, encrypted pending context, session binding,
eight verification attempts and expiry. Dismissing a live sign-in requests server
cancellation; failed cancellation is disclosed. Late replies cannot reopen a
screen or authorize a redirect. Browser refresh can recover the opaque attempt
through a same-owner-session status read. The account and encrypted credential
commit consumes the attempt atomically, so a cancellation that wins prevents a
late account authorization. A commit that already won is retained and can be
reused; dismissing UI is not an account disconnect.

Only an explicit owner sign_in_required 401 signs the owner out. A provider 401
keeps saved myTS content and offers provider recovery. Discovery, queued import,
active import, partial/restricted content and ready coverage have distinct wording.
Source collection remains server-owned and continues independently of open tabs.
Queue acceptance is never presented as completed import.
