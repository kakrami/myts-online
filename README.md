# GotSport diagnostic — v1.2.1

Standalone public-data diagnostic. It does not change myTS, connect to D1,
write to GotSport, or start a Cloudflare browser.

## Deploy over the existing probe

Replace the existing probe files with this ZIP's contents, then use the same
deployment process as before. The Worker name remains `myts-gotsport-probe`.
For command-line deployment:

```sh
npm install
npm run deploy
```

No dashboard configuration, browser binding, API key, tournament URL, or group
ID is required. The default Rankings team remains `212707`.

Open the Worker URL. It collects automatically. Use **Copy report link** to
share the public report URL; downloading and uploading JSON is optional.

## What changed

The previous version fetched the public JSON and JavaScript before launching a
browser, but only attached much of that evidence after the launch succeeded.
A browser-launch exception replaced the whole report with a fatal error.

This version removes Puppeteer and the BROWSER binding altogether. It collects:

- The existing public `GET /api/v1/teams/<team>/matches?upcoming=true` response.
- Exact home/away team IDs and their corresponding registration IDs.
- Rankings HTML and its same-origin script/module references.
- Bounded source excerpts mentioning API, bracket, schedule, group, and playoff
  fields, with the source URL and character offsets.

It does not execute the JavaScript, click tournament links, attempt CAPTCHA
verification, construct speculative API routes, or equate a bracket ID with a
group ID. Literal ECMAScript import references may be followed; interpolated
URLs and dependency-map strings are retained as evidence rather than guessed.

## Reading the result

`collection_status` describes evidence collection: `complete`, `partial`, or
`failed`. Complete means the supported collection steps completed within their
limits, not that all possible JavaScript routes were discovered.

`discovery_complete` means the upcoming-match response passed the exact team
identity checks. A valid empty array is distinguished from a failed request.

`success` remains **false** because the full division/playoff schedule has not
been proven by this collector. The proven team/event/registration relationships
are under `proof.team_event_registration_paths`. The missing proof is listed
separately. This diagnostic is not a working tournament integration.

Partial API and script evidence is returned even when another request fails.
Raw upcoming JSON is retained; script bodies are represented by bounded
excerpts. Truncation and uninspected script references are reported explicitly.

## Requests and resource use

Normal collection uses one public API request, one Rankings HTML request, and
up to five referenced JavaScript asset requests, excluding bounded redirects.
There are **zero browser acquisitions**. HTTP bodies and collection time are
bounded. Redirects outside the two public GotSport origins are refused.

Reports are cached for 15 minutes using the existing Workers Cache API, when
available. Simultaneous requests within a Worker isolate share a running
collection. Cache availability is best-effort and per Cloudflare data center;
this is not a global singleton or a permanently stored report.

A public HTTP 429 is recorded with its Retry-After header. The next check is
not scheduled earlier than that delay. The page permits at most two automatic
HTTP retries while it remains open. There are no scheduled background jobs,
CAPTCHA loops, browser retries, or paid-plan upgrade requirements introduced
by this change.

`GET /api/probe` returns the report for `212707`.
`GET /api/probe?team=<numeric-id>` retains the optional alternative team input.
The report includes its own public `report_url`.

## Verification included

```sh
npm test
npm run check
```

The tests replay the selected match identity/date fields captured in the
uploaded v1.1.0 report. Other upstream responses (HTML, JavaScript and error
cases) are controlled test fixtures, not claimed live GotSport responses.

Regression checks cover exact home/away registration selection, mismatches,
empty responses, duplicate matches, invalid JSON content, API/asset HTTP 429,
Retry-After, network failures, redirects, body limits, caching, concurrent
requests, and a browser binding that throws the exact uploaded 429 if accessed.
The shipped handler passes without accessing that binding.

Local tests do not establish access from your deployed Worker or prove the
remaining division-schedule endpoint. No production myTS files are included
or modified.
