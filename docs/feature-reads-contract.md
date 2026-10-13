# Canonical feature reads

`FeatureReads(db,actor,{cursor,now,analysisReads})` extends the fresh `ReadRepository`. It accepts its common `{team_id,team_season_id,mode,type,period,date,search,direction}` selection. The injected analysis reader is the one shared season/match statistics model; this module does not derive a competing player statistics model and never joins Coach data.

All returned pages are `{items,total,next_cursor}`. Totals and filters apply to the complete selection before pagination. Limits are 1–100. Signed cursors bind actor scope, canonical resource, season and filters, content revision, and ordering position. Event period cutoff is frozen in the cursor. Competition/H2H cursors exclude unrelated private Trace history: category revisions use affected native division/competition revisions; H2H uses the public-only domain revision plus scalar native event counts/revisions. Identity mutations advance those revisions in the domain transaction. Revision queries return bounded scalar columns, never aggregated snapshots of event IDs or provider payloads.

## Reads

| Method | Options | Envelope data |
|---|---|---|
| `competitions(input,options)` | `limit=25,cursor` | `season_label,past_season,period,team_filter,competitions:Page` |
| `competition(input,competitionId,options)` | `division_id,view:'own'|'all',limit=50,cursor` | `competition,divisions,events:Page,standings,coverage,as_of,team_filter,period` |
| `match(input,eventId,options)` | `tab,limit,cursor` or explicit `players_limit/players_cursor,attendance_limit/attendance_cursor,h2h_limit/h2h_cursor` | `event,capabilities,players:Page,player_count,lineup,analytics,analysis_state,attendance,h2h,attendance_summary,editor?` |
| `overview(input)` | common selection | base full record/latest/next, team/season labels, roster count, analyzed count, top four G+A leaders from `playerSeasonQuery`, current provider standings |
| `trophies(input,options)` | `limit=50,cursor` | `items,total,next_cursor,all_seasons:true,official_completion_required:true,note` |

Competition cards provide canonical `id`, name/dates/division labels and safe official URL. Category fixtures use globally materialized canonical event IDs, include unfamiliar opponents and conditional/pending times, deduplicate explicit provider correspondences, prefer GotSport for public schedule/result authority, orient reversed provider scores through verified team crosswalks, and expose contradictions. They never merge games merely because names or dates match. Own and all-category views are distinct queries. Season boundaries use the team's IANA timezone, with an exclusive end date.

Coverage is explicit: schedule `complete|partial|projection_pending`; standings `complete|partial|pending|unpublished`. Missing identity materialization is reported, never replaced with an account/source ID pretending to be canonical. Standings from duplicate provider categories are selected per logical division rather than double counted. Neither a first-place pool row nor final fixtures imply a trophy.

Match logistics read only active selected team/season private source entitlements. Multiple different uniforms, arrival times, notes or addresses produce a null field plus `logistics_conflicts`, never latest-wins. Public category matches cannot acquire another team's private logistics. Arrival offsets are applied only when exact kickoff is known. Kickoff writes remain outside this contract.

Attendance totals include the whole canonical roster, independent of page size. Exact states are `Yes,No,Maybe,NR,Conflict,Unknown,Unavailable,Untracked`. Multiple account observations must agree. A missing response becomes NR only when typed availability is enabled and that team's source attendance retrieval is complete; incomplete/unknown retrieval is Unavailable. Disabled availability is Untracked. Attendance cursors additionally bind scoped source event revisions and retrieval completeness.

H2H uses public saved native meetings for the verified pair, including prior seasons, and orients the record to our side. It excludes conditional, identity-conflicted or result-conflicted matches from the record and gives full filtered totals before pagination. Coverage remains `saved_history`, `history_complete:false`; saved meetings do not prove a complete historical archive.

Match event rows use canonical app team IDs for our side. Public provider participant keys may identify a followable public opponent; account-scoped IDs are stripped. Viewer responses contain neither account IDs, raw evidence, credentials, source payloads, private attributes, Coach plans nor editor models. Every viewer still needs its configured category and exact team scope. `capabilities.can_coach` is owner-only and requires our confirmed non-followed game and a roster.

All match/category/H2H rows expose a boolean `bookmarked` scoped to the selected app team and resolved through current canonical aliases. Saving, reopening and removing a merged input identity therefore reflects the same saved state. Another team's bookmark cannot turn on this team's marker.

`home`/`away` presentation contains `{id,name,confirmed,logo,logo_ref}`. Provider `logo` is a grounded safe public GotSport asset; an owner's shared uploaded image is a bounded reference `{team_id,club_id,revision}`, hydrated separately through the authorized team-logo route. Schedule, Overview's two event cards and saved-game pages receive the same bounded branding carrier. Public participant logo consensus follows exact public provider correspondence, never another account's private team. `source_label` is a provider display name without account identifiers.

Match `uniform` preserves provider instruction consensus. `uniform_kit:{name,color,color_origin,origin,instructions,matched}` decorates those instructions with the selected club-season named/color kit. `origin` is `owner|source_uniform`; `color_origin` distinguishes an explicit owner color, the original common-name display palette, or unset. Resetting kits restores actual selected-team source uniform names; no provider home/away colors are invented. The kit read adds one bounded query and remains inside the verified full match request budget.

The owner match editor read is `{revision,override,effective:{home_score,away_score,venue},can_reset}`. Player editor mutations and statistical corrections are owned by the shared analysis service, not duplicated here.

## Explicit awards and verified qualifications

`AWARDS_SCHEMA` from `feature-schema.js` is fresh initialization DDL, not a migration. It stores normalized owner awards, a short-lived CAS write fence, typed provider qualifications, and per-native-category qualification revisions maintained by triggers.

`setAward(input,value,revision=0)` is owner-only. `value` contains `{id?,request_id,title,place?,note?,competition_id?}`. The referenced competition must be reachable for that selected team season. Revision zero creates; a repeated identical request ID is idempotent; updates require the current positive revision. The result is `{award,idempotent}`. `deleteAward(input,id,revision)` is owner-only and atomically rejects stale revisions. A successful write increments team content revision once; stale writes have no partial effects. HTTP routing must enforce same-origin mutation and normal body limits.

Owner awards are labeled `origin:'owner',owner_recorded:true,verified:false`. Provider awards require an explicit typed `source_competition_qualifications` row, provider completed/final competition status with a verification timestamp, complete category retrieval, complete published standings, canonical fixture identities, and no unfinished/unresolved confirmed category games. Provider qualifiers are `origin:'provider',verified:true`. All team seasons participate; the SQL filters/counts/pages the full award set without a per-season query loop. Raw qualification evidence is never returned.

The current live provider investigation found no verified overall competition completion/qualification status. Therefore no automatic provider trophy is fabricated from current standings; explicitly owner-recorded awards work independently.

## Verification boundary

The composed match uses the real shared AnalysisReads model and stays at or below 44 D1 statements before HTTP/authentication overhead. Native Miniflare D1 tests exercise >100 full category fixtures, own/all/search/period totals, deterministic pagination, timezone boundaries, public provider duplicate orientation, scoped source cursor invalidation, private logistics isolation, complete/incomplete attendance, shared match analysis injection, viewer privacy, historical H2H invalidation, explicit standings coverage, owner award CAS/idempotency, and provider trophy gates. Root integration must verify HTTP routes, frontend interaction, deployment bindings, live authorized private providers, and closed-browser scheduling separately.

An actual own event in the published selected-team/season projection authorizes its canonical competition and division independently of stale registration membership metadata. Category reads union that explicit correspondence with verified native registrations, without writing identities during a read. An unrelated team remains unauthorized. Competition metadata dates do not hide a competition that contains an actual selected-season own event.

Standings are bounded independently of fixture pages. Competition options `standings_limit:1..100`, `standings_cursor`, and `pool_counts_cursor` return `standings:{pools,total,pool_count,limit,next_cursor,pool_counts,state,coverage,published,complete,note,official_completion:false}`. Each pool fragment has stable `id`, verified public metadata `name` (or the exact pool ID label), scalar `rows`, its whole-pool `total`, and whether that fragment contains all rows. Row pages preserve native rank/name/participant order; the client merges fragments by pool ID without summing repeated totals. `pool_counts` is a separate signed Page of at most 100 `{id,name,total}` entries, so more than 100 pools remain accessible. Both cursors bind canonical division selections, native metadata/coverage revisions, actor scope, and the current own projection. A same-team content change may conservatively restart a public cursor because an own result override can change its overlay; unrelated private source input does not change native public versions.
