# GotSport diagnostic — v1.3.0

Standalone diagnostic. No myTS changes, D1 access, browser sessions, logins,
CAPTCHA attempts, or writes to GotSport.

## Deploy

Replace the existing **probe** project with the ZIP contents and use the same
deployment process. Keep the existing deployment's Worker name/address.
The included configuration retains its original `myts-gotsport-probe` name;
this ZIP does not automatically rename or deploy over the myTS application.

```sh
npm install
npm run deploy
```

The default team is still `212707`. Opening the probe collects public evidence
automatically. No tournament, registration, division, or calendar URL is needed.
The existing `/api/probe?team=212707` address remains the main report URL.
There is no need to download/upload JSON to read the resulting report remotely.

## Why this update exists

The v1.2.1 report established the team/event/registration relationship and
captured GotSport code that renders bracket matches and explicitly checks
`playoff_element.tier_title` for finals, semifinals, and quarterfinals.
It did not capture the request definitions supplying those matches.

The previous keyword collector primarily searched `/api/` and data field names.
Relative request paths supplied separately to the common API wrapper could be
missed. This update retains full source and catalogs literal `path:` properties
with their surrounding code, rather than requiring a rebuild for each excerpt.

## Evidence now available

- The existing public upcoming-matches API, raw JSON, and exact identity checks.
- Referenced public Rankings JavaScript, source hashes, and readable chunks.
- Literal event/schedule/match path definitions, interpolation expressions,
  source offsets, and surrounding code. Computed or unsupported paths are
  reported instead of evaluated.
- Source inspection by offset or literal search, with continuation URLs.
- Bounded read-only testing of an eligible path definition from the collected
  source. This is a diagnostic operation, not an automatically inferred API.

The main report includes up to 1.2 million JavaScript characters. Any source
omitted by that bound is explicitly marked incomplete and remains available
through its source-inspection URL. At most five referenced assets are fetched;
byte, time, excerpt, and definition limits remain explicit.

## Remote inspection interfaces

These interfaces are for investigating the remaining data path. They are not
setup fields for myTS users.

`GET /api/probe?team=212707`
Returns the usual evidence report plus source chunks and inspection links.

`GET /api/catalog?team=212707`
Returns literal path definitions and source links, without the full source body.
Each definition has a `template_id`, source hash, context, and template slots.
A source-literal candidate is not proof of an executed network request.

`GET /api/source?team=212707&asset=0`
Returns a source window. Optional fields: `offset`, `length`, `find`, `sha256`.
Search is literal, not regular-expression execution. Offsets count JavaScript
UTF-16 code units. Returned continuation URLs pin the source hash.
`download=1` returns inert plain-text source as an attachment.

`GET /api/request?team=212707`
Required query fields: `template` (the exact catalog ID) and `sha256`.
`slots` is a JSON array of positive numeric values, one per template slot.
`query` is an optional JSON object of small primitive query parameters.
The reviewer must read the source to establish what these values mean; the
probe does not assign bracket IDs to group IDs or infer parameter semantics.

Only eligible event/schedule/match resource paths actually present as literals
in the captured source are accepted. The API base must also appear in that
asset. Arbitrary URLs, writes, credential forwarding, private resource
families, path traversal, executable query values, and stale source hashes
are rejected. Source expressions are never executed. Requests use GET without
cookies or authorization and include the public `X-Rankings-Client` header
observed in the supplied Rankings wrapper code.

An inspected response contains its status, exact request/source evidence,
JSON body or failure preview, and `division_schedule_verified: false`.
HTTP 200 does not prove the correct division or complete playoff coverage.

## Resource use and safety

Reports are cached for 15 minutes. JavaScript is cached separately for one hour.
Changing the inspected source window does not download the bundle again while
its captured source remains available. Identical inspection requests reuse
cached results for 15 minutes. Failed requests are cached for at least one
minute or the longer Retry-After delay. No challenge retry loop is present.

Caching is best-effort and local to a Cloudflare data center; concurrent work
is shared within an isolate. This is not a durable/global coordination system.
The memory cache is bounded. There are no scheduled background jobs. The UI
retains its limited transient-error retry behavior while open.

The diagnostic is public and should not be used to store private credentials.
It cannot deploy changes or execute arbitrary code. It does not automatically
try every listed request definition or enumerate event IDs.

## Verification

```sh
npm test
npm run check
```

The 50 regression tests cover the existing recorded team identities, partial
failures, rate limits, caching, source reconstruction/pagination, literal path
extraction, unsupported computed expressions, source hashes, request allowlists,
no credentials/writes, and explicit unverified schedule state.

Test routes under `fixture_events` are synthetic fixtures. They are not
claimed GotSport endpoints. Local tests verify the diagnostic implementation,
not a successful live division/playoff integration. `success` remains false
until the separate full-schedule proof is established; this collector does
not manufacture that proof.
