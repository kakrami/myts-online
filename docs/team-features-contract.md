# Team profile binding and bookmarks

These are fresh-install contracts. They do not read an older schema or translate an older version.

## Verified club binding

`TeamFeatures.ensureProfile(teamId, {sourceTeamId, kind, prepare:true, revision?, club_choice?})` validates the owner, team lifecycle, discovered source identity, and active private-account ownership. It returns a trusted internal descriptor containing exact team/source IDs, captured SQL conditions/parameters, no more than eight prepared statements, and a preview. It does not write. The descriptor is never accepted from a browser.

The attachment route passes this descriptor into `ApplicationSyncService.attachSelected` and `DomainRepository.attachTeam`. A native D1 batch fences the captured profile, both logo revisions, source club identity, private entitlement, and current team/source/season lifecycle, and commits source attachment plus branding together. Any failed condition rejects the complete transaction. The same binding runs for an already active attachment so a renamed placeholder can be repaired.

A sole placeholder club is promoted to its verified native club identity while retaining its logo. Otherwise it is rebound to the existing shared club, copying its logo only when the shared club has no logo. A verified primary club from another provider remains primary; unrelated provider keys are not evidence of a different club. An actual conflicting club key within one provider/scope, or two explicit different logos, requires the owner to choose.

A collision returns HTTP 409, `error.code:'club_choice_required'`, with `error.details.club_choice` containing `kind:'club'|'logo'`, `expected:{profile_revision,current_logo_revision,source_logo_revision,current_club_team_count,source_club_team_count}`, and two choices (`current`/`source`). Each choice has at most 20 named `affected_teams:[{id,name}]` plus its complete `affected_team_count`, and current/source club name and logo previews. Retry the attachment with `revision:expected.profile_revision` and `club_choice:{kind,keep:'current'|'source',...expected}`. Exact revisions and membership counts are required. A stale choice returns 409 and does not attach the source. The transaction rejects a new shared member arriving after the reviewed choice, so it cannot silently extend the approved logo change.

Only source rows with provider provenance authorize a verified club key. Imported display text cannot authorize shared club membership. Logo writes also fence the current team profile's club, revision and active state, preventing a concurrent reattachment from writing the old club.

## Shared logo and named season kits

`branding(teamId,seasonId)` returns a single selected club logo and named kit model. The effective logo prefers the owner's shared override, then a consensus grounded public GotSport asset from verified attachments/correspondence. `club` includes `logo,override_logo,overridden,source_logo,source_available,source_state,logo_origin,revision,club_id`. Clearing an override actually falls back to an available provider logo. When none is available the model says `source_available:false`; the UI must not promise a source image.

The exact original kit contract is an ordered arbitrary list `{name,color}`, shared by verified teams in one club and season year. Game uniform instructions stay unchanged. Fresh storage uses `club_season_kits` and normalized `club_season_kit_rows`; no fixed home/away/goalkeeper text fields or older table readers exist.

`saveKits(teamId,seasonId,{items},revision)` accepts at most 32 unique normalized names of up to 80 characters and colors `''` or `#RRGGBB`. `items:null` restores source defaults; `items:[]` is an explicit empty owner list. The transaction fences the current active club binding, season and kit revision, replaces the bounded rows in one insert, and advances presentation revisions for every active same-club team with that season year. Other years remain independent.

GET `kits` contains `club_id,season_year,revision,overridden,items,effective_items,source_items,source_available,source_total,source_truncated`. Source defaults are actual selected-team event uniform names, not invented provider home/away kits. The default list shows at most 32 names with complete total and explicit truncation state. The original common color-name palette is presentation inference, labeled `color_origin:'name_palette'`; custom saved color is `owner_color`, and unknown color is `unset`. Matching a named kit decorates an exact normalized uniform instruction with an icon; it does not replace the instruction.

Paged catalog/event rows carry only safe provider logo URLs or `{team_id,club_id,revision}` owner asset references. `/api/teams/:id/logo` authorizes the team and serves one bounded uploaded image via the request headers. The frontend hydrates it once per distinct club/revision and authorization scope. Uploaded image data is not repeated across every row or catalog entry.

## Bookmarks

An owner can save a confirmed own-team game or a public game in a canonical division reachable through that team's active verified source attachment/correspondence. A private unrelated event, unfamiliar public category, conditional fixture, or unresolved identity is rejected. A single saved event uses a bounded scalar snapshot of at most 16 KB. Public result, clock, and identity changes refresh saved bookmark presentation from current canonical source facts. Missing native facts retain the saved snapshot.

`bookmarks(teamId,{team_filter:teamId|'all'|otherTeamId,period:'upcoming'|'past'|'all',limit:1..100,cursor,teams_limit:1..50,teams_cursor})` returns `{owner,team_filter,period,team_choices,teams_total,teams_next_cursor,events:{items,total,next_cursor}}`. Owners can select All active teams. Viewers can read only their authorized team and cannot request All or another team. Team choices use a separate signed continuation and are never silently truncated.

Totals and date filters are computed before event pagination. The event cursor is signed against selected-team content revisions, public changes, team lifecycle identity, actor scope, and filters. Its ordering includes kickoff/day, canonical event ID, and app team ID, preserving separate explicit team-scoped saved records when one canonical game is bookmarked by two teams. A page continuation freezes its date cutoff. Day-only fixtures use each selected team's validated IANA timezone; timezone diversity is explicitly bounded at 1,024 names per request.

Rows expose canonical event `id`, `app_team_id`, and authorized `team_season_id` for opening historical details. Own rows use their current published season. Public saved rows use explicit source competition season or the local day within an authorized attached/published division season; the lookup is bounded to two possible matches and ambiguous unknown season remains null. A visible public category stays bookmarkable after registration metadata disappears when an own published fixture still proves its division context. No private account IDs, raw evidence, source snapshots, or Coach records are returned.

## Native verification

The component suite checks placeholder repair, shared-logo preservation, real conflict without writes, chosen binding plus attachment, raced-branding rollback, provider-independent primary club, private ownership denial, more than 100 public category bookmarks, live updates, omissions, complete All-team paging, duplicate canonical IDs under different explicit team scopes, viewer restrictions, and IANA day-only filters. Browser presentation and real authenticated providers are verified separately by the application review workflow.

`writeTeam` fences team existence and lifecycle in the same native transaction for rename, logo, kits, and inclusion commands. Prepared profile bindings and bookmark save/remove transactions carry the equivalent guard. Injected deletion immediately before the write rejects edits without leaving new kit/bookmark rows.
