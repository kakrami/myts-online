import { day, fail, instant, key, native, norm, parse, requireValue, safeUrl, stamp, text, localDate, teamRecord, job, hash } from "./common.js";
import { url, unique } from "./http.js";
const RANK = "https://system.gotsport.com/api/v1";
const LIVE = "https://gotsportlive-api.azurewebsites.net";
const SITE = "https://gotsportlive.com";
export const rankingsUrl = (path, params) =>
  url(RANK + "/", path.replace(/^\//, ""), params);
export async function ranking(t, path, params) {
  return (
    await t.get(rankingsUrl(path, params), {
      headers: {
        Accept: "application/json",
        "X-Rankings-Client": "rankings-web",
      },
    })
  ).value;
}
export async function live(t, path, params, timezone = "America/Los_Angeles") {
  return (
    await t.get(url(LIVE, path, params), {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Platform": "2",
        "X-Timezone": timezone,
        Origin: SITE,
        Referer: SITE + "/",
      },
    })
  ).value;
}
export function liveBridge(value) {
  const u = safeUrl(value);
  if (!u) return null;
  const link = new URL(u),
    match = link.pathname.match(
      /^\/(league|league-organizer)\/([1-9]\d{0,14})\/?$/,
    );
  if (
    link.protocol !== "https:" ||
    link.hostname !== "gotsportlive.com" ||
    link.port ||
    link.search ||
    link.hash ||
    !match
  )
    return null;
  return { kind: match[1], id: match[2], url: link.href };
}
function rankingLogo(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value, "https://system.gotsport.com/");
    return u.protocol === "https:" && u.hostname === "system.gotsport.com"
      ? safeUrl(u.href)
      : "";
  } catch {
    return "";
  }
}
const compactName = (club, name) =>
  norm(name).startsWith(norm(club))
    ? text(name)
    : [text(club), text(name)].filter(Boolean).join(" ");
function baseFixture(provider, id, p) {
  return {
    id: key(provider, id),
    provider,
    native_id: String(id),
    competition_id: null,
    division_id: null,
    home_id: null,
    away_id: null,
    starts_at: null,
    local_day: null,
    type: "game",
    status: "SCHEDULED",
    conditional: 0,
    home_score: null,
    away_score: null,
    payload: JSON.stringify(p),
    observed_at: stamp(),
  };
}
function score(v) {
  if (v === null || v === undefined || v === "") return null;
  requireValue(
    Number.isInteger(Number(v)) && Number(v) >= 0,
    "Invalid source score.",
  );
  return Number(v);
}
export function normalizeRankings(m, division = null, context = {}) {
  requireValue(
    native(m.id) && native(m.event_id) && native(m.schedule_id),
    "GotSport fixture identity is incomplete.",
  );
  const h = native(m.homeTeam?.team_id),
    a = native(m.awayTeam?.team_id);
  requireValue(!h || !a || h !== a, "A game has identical participants.");
  const hs = score(m.home_score),
    as = score(m.away_score),
    start = m.allDay === true ? null : instant(m.matchTime),
    date = day(m.match_date),
    conditional = !h || !a;
  const p = {
    home_name:
      text(m.homeTeam?.full_name) ||
      text(m.homeTeam?.team_name) ||
      "Participant TBD",
    away_name:
      text(m.awayTeam?.full_name) ||
      text(m.awayTeam?.team_name) ||
      "Participant TBD",
    venue: text(m.venue?.name),
    field: text(m.pitch?.name),
    address: text(m.venue?.full_address),
    number: m.match_number ?? null,
    match_number: m.match_number == null ? null : String(m.match_number),
    event_id: String(m.event_id),
    competition_id: key("gotsport", m.event_id),
    division_id: division,
    group_id: context.group || (division?.startsWith("gotsport:") ? division.slice(9) : null),
    context: context.event_context || null,
    round: text(m.playoff_element?.tier_title),
    bracket_id: native(m.bracket_id),
    schedule_id: String(m.schedule_id),
    home_registration: native(m.home_team_reg_id),
    away_registration: native(m.away_team_reg_id),
    home_logo: rankingLogo(m.homeTeam?.team_logo),
    away_logo: rankingLogo(m.awayTeam?.team_logo),
    home_native_id: h || null,
    away_native_id: a || null,
    venue_id: native(m.venue_id) || null,
    pitch_id: native(m.pitch_id) || null,
    live_game_url: safeUrl(m.live_game_url) || null,
    all_day: m.allDay === true,
    source_url: `https://system.gotsport.com/org_event/events/${m.event_id}/schedules${division ? "?group=" + division.split(":").at(-1) : ""}`,
    time_pending: !start,
    conditional,
  };
  const f = {
    ...baseFixture("gotsport", m.id, p),
    competition_id: key("gotsport", m.event_id),
    division_id: division,
    home_id: h ? key("gotsport", h) : null,
    away_id: a ? key("gotsport", a) : null,
    starts_at: start,
    local_day: date,
    conditional: +conditional,
    home_score: conditional ? null : hs,
    away_score: conditional ? null : as,
    status:
      m.is_canceled === true ||
      m.is_cancelled === true ||
      /^cancel/i.test(m.status || "")
        ? "CANCELLED"
        : /postpon/i.test(m.status || "")
          ? "POSTPONED"
          : !conditional && hs !== null && as !== null
            ? "FINAL"
            : "SCHEDULED",
  };
  return f;
}
export function normalizeLive(g, context = {}) {
  requireValue(
    native(g.GameID) &&
      native(g.LeagueOrganizerID) &&
      native(g.LeagueCategoryID) &&
      native(g.LeagueID),
    "GotSport Live fixture identity is incomplete.",
  );
  if (context.organizer)
    requireValue(
      String(g.LeagueOrganizerID) === context.organizer,
      "Fixture organizer did not match.",
    );
  if (context.category)
    requireValue(
      String(g.LeagueCategoryID) === context.category,
      "Fixture category did not match.",
    );
  if (context.leagues)
    requireValue(
      context.leagues.includes(String(g.LeagueID)),
      "Fixture league is outside the verified category.",
    );
  requireValue(
    [1, 2, 3, 4].includes(g.GameStatusID),
    "Unknown Live game status.",
  );
  for (const k of [
    "TimeNotSet",
    "HomeTeamIsSportswikTeam",
    "AwayTeamIsSportswikTeam",
    "Cancelled",
    "Postponed",
    "Interrupted",
    "HideResult",
  ])
    requireValue(
      typeof g[k] === "boolean",
      "Live fixture flags are incomplete.",
    );
  const h = native(g.HomeTeamID),
    a = native(g.AwayTeamID),
    realH = !!h && g.HomeTeamIsSportswikTeam,
    realA = !!a && g.AwayTeamIsSportswikTeam;
  requireValue(
    !realH || !realA || h !== a,
    "A game has identical participants.",
  );
  if (context.team)
    requireValue(
      (realH && h === context.team) !== (realA && a === context.team),
      "Team feed returned a foreign fixture.",
    );
  const conditional = !realH || !realA,
    canScore =
      !conditional &&
      !g.HideResult &&
      !g.Cancelled &&
      !g.Postponed &&
      !g.Interrupted &&
      [2, 3].includes(g.GameStatusID),
    start = g.TimeNotSet ? null : instant(g.GameTime);
  requireValue(g.TimeNotSet || start, "Scheduled game has no kickoff.");
  const p = {
    home_logo: realH ? rankingLogo(g.HomeTeamClubLogoURL) : "",
    away_logo: realA ? rankingLogo(g.AwayTeamClubLogoURL) : "",
    home_name:
      compactName(
        g.HomeTeamClubName,
        g.HomeTeamTeamName || g.HomeTeamDisplayName,
      ) || "Participant TBD",
    away_name:
      compactName(
        g.AwayTeamClubName,
        g.AwayTeamTeamName || g.AwayTeamDisplayName,
      ) || "Participant TBD",
    venue: text(g.ArenaName),
    field: "",
    number: g.GameNumber ?? null,
    match_number: g.GameNumber == null ? null : String(g.GameNumber),
    competition_id: key("live", g.LeagueOrganizerID),
    division_id: `live:${g.LeagueOrganizerID}:${g.LeagueCategoryID}`,
    round: text(g.LeaguePlayoffStage),
    league_id: String(g.LeagueID),
    organizer: String(g.LeagueOrganizerID),
    category: String(g.LeagueCategoryID),
    season_id: context.proof?.season || context.season || null,
    season_name: context.proof?.season_name || context.season_name || null,
    context: context.event_context || null,
    home_native_id: h || null,
    away_native_id: a || null,
    home_club_id: native(g.HomeTeamClubID) || null,
    away_club_id: native(g.AwayTeamClubID) || null,
    arena_id: native(g.ArenaID) || null,
    flags: Object.fromEntries(["TimeNotSet","HomeTeamIsSportswikTeam","AwayTeamIsSportswikTeam","Cancelled","Postponed","Interrupted","HideResult"].map((k)=>[k,g[k]])),
    game_status_id: g.GameStatusID,
    time_pending: g.TimeNotSet,
    conditional,
    home_real: realH,
    away_real: realA,
    source_url: `${SITE}/game-view/${g.GameID}`,
  };
  return {
    ...baseFixture("live", g.GameID, p),
    competition_id: key("live", g.LeagueOrganizerID),
    division_id: `live:${g.LeagueOrganizerID}:${g.LeagueCategoryID}`,
    home_id: realH ? key("live", h) : null,
    away_id: realA ? key("live", a) : null,
    starts_at: start,
    local_day: g.GameTime ? localDate(g.GameTime, context.timezone || "America/Los_Angeles") : null,
    conditional: +conditional,
    home_score: canScore ? score(g.HomeTeamScore) : null,
    away_score: canScore ? score(g.AwayTeamScore) : null,
    status: g.Cancelled
      ? "CANCELLED"
      : g.Postponed
        ? "POSTPONED"
        : g.Interrupted
          ? "INTERRUPTED"
          : g.GameStatusID === 1
            ? "SCHEDULED"
            : g.GameStatusID === 2
              ? "LIVE"
              : "FINAL",
  };
}
const eventRecord = (
  id,
  name,
  provider = "gotsport",
  details = {},
  extra = {},
) => ({
  id: key(provider, id),
  provider,
  native_id: String(id),
  name: text(name) || "Competition",
  kind: "unknown",
  starts_on: null,
  ends_on: null,
  details: JSON.stringify(details),
  observed_at: stamp(),
  ...extra,
});
function fixtureTeams(fixtures) {
  const map = new Map();
  for (const f of fixtures) {
    const p = parse(f.payload);
    for (const side of ["home", "away"])
      if (f[side + "_id"]) {
        const [provider, id] = f[side + "_id"].split(":");
        map.set(f[side + "_id"], teamRecord(provider, id, p[side + "_name"],{participant_observation:true,...(p[side+"_logo"]?{logo:p[side+"_logo"]}:{})}));
      }
  }
  return [...map.values()];
}
const minimalLiveDivisions = (fixtures) => [
  ...new Map(
    fixtures.map((f) => [
      f.division_id,
      {
        id: f.division_id,
        competition_id: f.competition_id,
        name: "Published category",
        details: JSON.stringify({
          organizer: parse(f.payload).organizer,
          category: parse(f.payload).category,
          leagues: [],
        }),
        observed_at: stamp(),
      },
    ]),
  ).values(),
];
function participantObservations(t, club, season, previous = []) {
  const relevant=(t.observations||[]).filter((o)=>["/api/clubapi/initclubteams","/api/clubapi/getteams"].some((p)=>o.endpoint?.endsWith(p)));
  return [...previous,...relevant].map((o)=>({endpoint:o.endpoint,params:typeof o.params==="string"?parse(o.params):o.params,status:o.status,at:o.at,hash:o.hash,complete:o.status===200}));
}
function participantChildren(fixtures,args,timezone) {
  const candidates=new Map();
  for(const f of fixtures) {
    const p=parse(f.payload);
    for(const side of ["home","away"]) {
      if(!p[side+"_real"] || !native(p[side+"_native_id"]) || !native(p[side+"_club_id"])) continue;
      const team=p[side+"_native_id"],club=p[side+"_club_id"];
      candidates.set(`${team}:${club}`,job("live","participant",`${team}:${club}:${args.proof?.season||args.season||"default"}`,{team_id:team,club_id:club,season:args.proof?.season||args.season||null,season_name:args.proof?.season_name||args.season_name||null,timezone}));
    }
  }
  return [...candidates.values()];
}
async function sourceSlice(rows,cursor,limit) {
  const fingerprint=await hash(rows.map((r)=>String(r.GameID??r.LeagueTeamID??r.LeagueID??r.id??(r.pool_id+'|'+r.team_id)))),offset=cursor.slice_offset||0;
  requireValue(!cursor.fingerprint||cursor.fingerprint===fingerprint,"Provider page identity changed during collection.","scan_changed");
  requireValue(Number.isSafeInteger(offset)&&offset>=0&&offset<=rows.length,"Invalid source slice checkpoint.");
  const page=rows.slice(offset,offset+limit),done=offset+page.length>=rows.length;
  return {rows:page,offset,done,next:done?{}:{slice_offset:offset+page.length,fingerprint}};
}
export async function collectGotSport({ j, args = {}, cursor = {}, transport: t }) {
  const records = {},
    children = [],
    out = { records, children, fixtures: [], complete: true, checkpoint: { finished: true } },
    id = args.team_id || j.scope,
    timezone = args.timezone || "America/Los_Angeles";
  if(j.provider==="live"&&j.kind==="participant") {
    const club=requireValue(native(args.club_id),"Live participant club is missing."),team=requireValue(native(args.team_id),"Live participant identity is missing.");
    const seasons=await live(t,"/api/clubapi/initclubteams",{ClubID:club},timezone);
    const defaults=(seasons.Seasons||[]).filter((s)=>s.IsDefault===true);
    requireValue(defaults.length===1&&native(defaults[0].SeasonID),"Participant season is ambiguous.");
    const season=String(defaults[0].SeasonID),seasonName=text(defaults[0].SeasonName);
    // Never create a current-season proof for an historical fixture.
    if((args.season&&String(args.season)!==season)||(args.season_name&&args.season_name!==seasonName)) return {...out,coverage:{kind:"participant_identity",complete:true,state:"season_unverified",team_id:team,club_id:club}};
    const rows=unique(await live(t,"/api/clubapi/getteams",{ClubID:club,SeasonID:season},timezone),(r)=>native(r.TeamID));
    const matches=rows.filter((r)=>native(r.TeamID)===team);
    requireValue(matches.length<=1,"Live participant identity is duplicated.");
    const r=matches[0];
    if(!r || r.ExternalDataSourceName!=="GotSport" || Number(r.ExternalDataSourceID)!==6 || !native(r.ExternalDataSourceKey)) return {...out,coverage:{kind:"participant_identity",complete:true,state:"external_key_unavailable",team_id:team,club_id:club}};
    requireValue(native(r.ItemID)===team&&native(r.SeasonID)===season&&(!r.ClubID||native(r.ClubID)===club),"Participant external key is outside its club/season.");
    const canonical=String(r.ExternalDataSourceKey),proof={team_id:canonical,live_team_id:team,club,season,season_name:seasonName,default_season:true,item_id:String(r.ItemID),external_key:canonical,external_source_id:r.ExternalDataSourceID,external_source_name:r.ExternalDataSourceName,verified_at:stamp(),checked_at:stamp(),expires_at:new Date(Date.now()+6*60*60*1000).toISOString(),observations:participantObservations(t,club,season)};
    records.teams=[teamRecord("live",team,compactName(r.ClubName,r.TeamName),{club_name:text(r.ClubName),proof},{club_id:key("live",club),season:seasonName}),teamRecord("gotsport",canonical,compactName(r.ClubName,r.TeamName),{external_identity_name:true})];
    records.identity_links=[{a:key("gotsport",canonical),b:key("live",team),kind:"provider_external_key",evidence:JSON.stringify(proof),observed_at:stamp()}];
    out.coverage={kind:"participant_identity",complete:true,state:"verified",team_id:team,club_id:club,season};
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "profile") {
    const r = await ranking(t, "/team_ranking_data/team_details", {
      team_id: id,
    });
    requireValue(
      native(r.id) === id && text(r.team_name || r.name),
      "Team profile does not match.",
    );
    const clubId = native(r.club_id || r.organization_id),
      club = clubId ? key("gotsport", clubId) : null;
    if (club)
      records.clubs = [
        {
          id: club,
          provider: "gotsport",
          native_id: clubId,
          name: text(r.club_name),
          logo: rankingLogo(r.image || r.team_logo_url_full),
        },
      ];
    records.teams = [
      teamRecord(
        "gotsport",
        id,
        compactName(r.club_name, r.team_name || r.name),
        {
          club_name: text(r.club_name),
          profile: true,
          logo: rankingLogo(r.image || r.team_logo_url_full),
        },
        { club_id: club },
      ),
    ];
    for (const kind of ["catalog", "history"])
      children.push(job("gotsport", kind, id, {team_id:id,club_name:text(r.club_name),logo:rankingLogo(r.image || r.team_logo_url_full),timezone}));
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "catalog") {
    const r = await ranking(t, "/team_ranking_data", { team_id: id });
    requireValue(
      native(r.team_ranking_data?.team_id) === id &&
        Array.isArray(r.events) &&
        r.events.length <= 2000,
      "Competition catalog does not match the canonical team.",
    );
    const allEvents = unique(r.events, (e) => native(e.id)).sort((a,b)=>Number(a.id)-Number(b.id));
    const fingerprint=await hash(allEvents.map((e)=>String(e.id))),offset=cursor.offset||0;
    requireValue(!cursor.fingerprint||cursor.fingerprint===fingerprint,"Competition catalog changed during collection.","scan_changed");
    const events=allEvents.slice(offset,offset+64),done=offset+events.length>=allEvents.length;
    records.references_data = events.map((e) => ({
      team_id: key("gotsport", id),
      kind: "competition_entry",
      id: key("gotsport", e.id),
      value: JSON.stringify({
        team_id: id,
        event_id: String(e.id),
        live_event_url: e.live_event_url || null,
      }),
      observed_at: stamp(),
    }));
    records.competitions = events.map((e) => eventRecord(e.id, e.name));
    for (const e of events)
      children.push(
        job("gotsport", "event", String(e.id), {
          event_id: String(e.id),
          timezone,
        }),
      );
    for(const e of events) children.push(job("gotsport","bridge",`${id}:${e.id}`,{team_id:id,event_id:String(e.id),club_name:args.club_name,logo:args.logo,bridge_url:safeUrl(e.live_event_url),timezone}));
    out.complete=done;
    out.checkpoint=done?{finished:true}:{offset:offset+events.length,fingerprint};
    out.coverage = done?"complete_competition_catalog":"partial_competition_catalog";
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "history") {
    const page = cursor.page || 1,
      r = await ranking(t, `/teams/${id}/matches`, {
        past: true,
        page,
        per_page: 50,
      }),
      p = r?.pagination;
    requireValue(
      Array.isArray(r.matches) &&
        p?.current_page === page &&
        Number.isInteger(p.total_pages) &&
        p.total_pages >= 0 &&
        Number.isInteger(p.total_entries) &&
        p.total_entries >= 0,
      "History pagination is invalid.",
    );
    if (cursor.total != null)
      requireValue(
        cursor.total === p.total_entries &&
          cursor.total_pages === p.total_pages,
        "History changed during pagination.",
        "scan_changed",
      );
    const rows = unique(r.matches, (m) => native(m.id)),
      fixtures = rows.map((m) => {
        const f = normalizeRankings(m);
        requireValue(
          [f.home_id, f.away_id].filter((x) => x === key("gotsport", id))
            .length === 1,
          "History contains a foreign team.",
        );
        return f;
      });
    const count = (cursor.count || 0) + rows.length,
      done = page >= Math.max(1, p.total_pages);
    if (done)
      requireValue(
        count === p.total_entries,
        "History terminal count did not match.",
      );
    else
      requireValue(rows.length > 0, "History ended before its terminal page.");
    out.fixtures = fixtures;
    out.scan_keys = fixtures.map((f) => f.id);
    records.teams = fixtureTeams(fixtures);
    records.competitions = [
      ...new Map(
        rows.map((m) => [
          String(m.event_id),
          eventRecord(m.event_id, m.event_name),
        ]),
      ).values(),
    ];
    records.memberships = rows.flatMap((m) => {
      const side = native(m.homeTeam?.team_id) === id ? "home" : "away",
        reg = native(m[side + "_team_reg_id"]);
      requireValue(reg, "History has no team registration.");
      return native(m.bracket_id)
        ? [
            {
              team_id: key("gotsport", id),
              division_id: key("gotsport", m.schedule_id),
              registration_id: reg,
              evidence: JSON.stringify({
                event_id: String(m.event_id),
                schedule_id: String(m.schedule_id),
                bracket_id: String(m.bracket_id),
              }),
              observed_at: stamp(),
            },
          ]
        : [];
    });
    records.memberships=[...new Map(records.memberships.map((m)=>[m.team_id+":"+m.division_id+":"+m.registration_id,m])).values()];
    for (const event of records.competitions) {
      const memberships=records.memberships.filter((m)=>String(parse(m.evidence).event_id)===event.native_id);
      const bracketIds=[...new Set(memberships.map((m)=>parse(m.evidence).bracket_id))].sort();
      children.push(
        job("gotsport", "event", event.native_id+":"+bracketIds.join(","), {
          event_id: event.native_id,
          bracket_ids:bracketIds,
          timezone,
        }),
        job("gotsport","bridge",`${id}:${event.native_id}`,{team_id:id,event_id:event.native_id,club_name:args.club_name,logo:args.logo,timezone}),
      );
    }
    out.complete = done;
    out.checkpoint = done
      ? { finished: true }
      : {
          page: page + 1,
          count,
          total: p.total_entries,
          total_pages: p.total_pages,
        };
    out.coverage = done ? "complete_history" : "partial_history";
    return out;
  }
  if(j.provider==="gotsport"&&j.kind==="bridge") {
    let bridge=liveBridge(args.bridge_url);
    if(!bridge) {
      const raw=await ranking(t,"/event_ranking_data/event_details",{event_id:args.event_id});
      requireValue(native(raw.event?.id)===args.event_id,"Bridge event identity mismatched.");
      bridge=liveBridge(raw.event.live_event_url);
    }
    if(bridge) children.push(job("live","resolve",`${args.team_id}:${args.event_id}`,{team_id:args.team_id,club_name:args.club_name,logo:args.logo,event:args.event_id,bridge_kind:bridge.kind,bridge_id:bridge.id,bridge_url:bridge.url,timezone}));
    out.coverage=bridge?"published_bridge":"no_published_bridge";
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "event") {
    const raw = await ranking(t, "/event_ranking_data/event_details", {
        event_id: args.event_id,
      }),
      e = raw?.event;
    requireValue(
      native(e?.id) === args.event_id &&
        Array.isArray(e.schedule_groups) &&
        typeof e.tournament === "boolean" &&
        typeof e.league === "boolean",
      "Competition details are invalid.",
    );
    records.competitions = [
      eventRecord(
        e.id,
        e.name,
        "gotsport",
        {
          website: safeUrl(e.website_url),
          official_name: text(e.name),
          starts_on:day(e.start_date_formatted?.dashed),
          ends_on:day(e.end_date_formatted?.dashed),
          seasonal_year:day(e.seasonal_year),
          live_event_url:safeUrl(e.live_event_url)||null,
          schedule_groups:e.schedule_groups.map((g)=>({id:String(g.id),name:text(g.division),brackets:(g.brackets||[]).map((b)=>({id:String(b.id),group_id:String(b.schedule_group_id),name:text(b.name)}))})),
          city: text(e.city),
          state: text(e.state),
          source_url: `https://rankings.gotsport.com/events/${e.id}`,
        },
        {
          kind:
            e.tournament && !e.league
              ? "tournament"
              : e.league && !e.tournament
                ? "league"
                : "unknown",
          starts_on: day(e.start_date_formatted?.dashed),
          ends_on: day(e.end_date_formatted?.dashed),
        },
      ),
    ];
    records.divisions = [];
    records.memberships = [];
    const eventContext={event_id:String(e.id),official_name:text(e.name),starts_on:day(e.start_date_formatted?.dashed),ends_on:day(e.end_date_formatted?.dashed),website:safeUrl(e.website_url),seasonal_year:day(e.seasonal_year),live_event_url:safeUrl(e.live_event_url)||null};
    const groups = unique(e.schedule_groups, (g) => native(g.id)),
      pending = (args.memberships || []).filter((m) => String(parse(m.evidence).event_id) === String(e.id));
    for (const g of groups) {
      requireValue(
        Array.isArray(g.brackets),
        "Competition brackets are missing.",
      );
      const brackets = unique(g.brackets, (b) => native(b.id));
      for (const b of brackets)
        requireValue(
          native(b.schedule_group_id) === String(g.id),
          "Bracket belongs to another division.",
        );
      const div = `gotsport:${g.id}`,
        relevant = pending.filter((m) =>
          brackets.some((b) => m.division_id === "gotsport:bracket:" + b.id),
        );
      if (!relevant.length && !brackets.some((b)=>(args.bracket_ids||[]).includes(String(b.id)))) continue;
      records.divisions.push({
        id: div,
        competition_id: key("gotsport", e.id),
        name: text(g.division) || "Division",
        details: JSON.stringify({
          event: String(e.id),
          group: String(g.id),
          brackets: brackets.map((b) => ({
            id: String(b.id),
            name: text(b.name),
          })),
        }),
        observed_at: stamp(),
      });
      records.memberships.push(
        ...relevant.map((m) => ({ ...m, division_id: div })),
      );
      children.push(
        job("gotsport", "division", div, {
          event: String(e.id),
          group: String(g.id),
          brackets: brackets.map((b) => String(b.id)),
          event_context:eventContext,
          timezone,
        }),
        job("gotsport", "standings", div, {
          event: String(e.id),
          group: String(g.id),
          brackets: brackets.map((b) => String(b.id)),
          event_context:eventContext,
          timezone,
        }),
      );
    }
    const bridge = liveBridge(e.live_event_url),
      entries = args.team_id ? [{team_id:key("gotsport",args.team_id)}] : [];
    if (bridge)
      for (const team of new Set(
        [...pending, ...entries].map((m) => m.team_id.split(":")[1]),
      ))
        children.push(
          job("live", "resolve", team + ":" + e.id, {
            team_id: team,
            bridge_kind: bridge.kind,
            bridge_id: bridge.id,
            bridge_url: bridge.url,
            event: String(e.id),
            club_name:args.club_name,
            logo:args.logo,
            timezone,
          }),
        );
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "division") {
    const allRows = unique(
      await ranking(t, "/event_ranking_data/flight_matches", {
        event_id: args.event,
        flight_id: args.group,
      }),
      (m) => native(m.id),
    );
    allRows.sort((a,b)=>Number(a.id)-Number(b.id));
    const fingerprint=await hash(allRows.map((m)=>String(m.id))),offset=cursor.offset||0;
    requireValue(!cursor.fingerprint||cursor.fingerprint===fingerprint,"Division changed during collection.","scan_changed");
    const rows=allRows.slice(offset,offset+100),done=offset+rows.length>=allRows.length;
    for (const m of rows)
      requireValue(
        native(m.event_id) === args.event &&
          ((args.brackets || []).includes(native(m.bracket_id)) ||
            m.playoff_element),
        "Fixture escaped its division.",
      );
    out.fixtures = rows.map((m) => normalizeRankings(m, j.scope, args));
    records.teams = fixtureTeams(out.fixtures);
    out.complete=done;out.checkpoint=done?{finished:true}:{offset:offset+rows.length,fingerprint};
    out.coverage={kind:"division_schedule",provider:"gotsport",scope:j.scope,division_id:j.scope,event:args.event,group:args.group,complete:done,count:offset+rows.length};
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "standings") {
    const rawRows = unique(
      await ranking(t, "/event_ranking_data/flight_registrations", {
        event_id: args.event,
        flight_id: args.group,
      }),
      (m) => native(m.id),
    );
    const slice=await sourceSlice(rawRows,cursor,100),rows=slice.rows;
    records.standings = rows.map((r) => {
      requireValue(
        native(r.event_id) === args.event &&
          native(r.schedule_group_id) === args.group &&
          args.brackets.includes(native(r.bracket_id)) &&
          text(r.full_name),
        "Standings escaped its division.",
      );
      const p = {
        name: text(r.full_name),
        registration_id: String(r.id),
        mp: r.matches_played,
        w: r.wins_total,
        d: r.draws_total,
        l: r.losses_total,
        gf: r.goals_for_total,
        ga: r.goals_against_total,
        gd: r.goal_difference_total,
        pts: r.points_total,
      };
      for (const k of ["mp", "w", "d", "l", "gf", "ga", "gd", "pts"])
        requireValue(
          typeof p[k] === "number" &&
            Number.isFinite(p[k]) &&
            (["gd", "pts"].includes(k) || p[k] >= 0),
          "Invalid standings total.",
        );
      return {
        division_id: j.scope,
        pool_id: String(r.bracket_id),
        team_id: native(r.team_id)
          ? key("gotsport", r.team_id)
          : "registration:" + r.id,
        rank:
          Number.isInteger(r.group_play_placement) && r.group_play_placement > 0
            ? r.group_play_placement
            : null,
        payload: JSON.stringify(p),
        scan_id: j.scan_id,
        observed_at: stamp(),
      };
    });
    out.complete=slice.done;out.checkpoint=slice.done?{finished:true}:slice.next;
    out.coverage={kind:"standings",provider:"gotsport",scope:j.scope,division_id:j.scope,complete:slice.done,count:slice.offset+rows.length,availability:rawRows.length?"published":slice.done?"unpublished":"pending"};
    if(slice.done) out.replacements = [{kind:"standings",division_id:j.scope,scan_id:j.scan_id}];
    return out;
  }
  if (j.kind === "resolve") {
    const profile = {details:JSON.stringify({club_name:args.club_name,logo:args.logo})},
      clubName = args.club_name || cursor.club_name;
    if (!clubName) {
      const p=await ranking(t,"/team_ranking_data/team_details",{team_id:id});
      requireValue(native(p.id)===id && text(p.club_name),"Canonical club profile does not match.");
      return {...out,complete:false,checkpoint:{...cursor,club_name:text(p.club_name),phase:cursor.phase||"bridge"}};
    }
    const phase = cursor.phase || "bridge";
    if (phase === "bridge") {
      requireValue(
        ["league", "league-organizer"].includes(args.bridge_kind) &&
          native(args.bridge_id),
        "Live bridge identity is incomplete.",
      );
      const organizerBridge = args.bridge_kind === "league-organizer",
        h = await live(
          t,
          organizerBridge
            ? "/api/leagueorganizerapi/getleagueorganizerheader"
            : "/api/leagueapi/getleagueheader",
          organizerBridge
            ? { LeagueOrganizerID: args.bridge_id }
            : { LeagueID: args.bridge_id },
          timezone,
        );
      requireValue(
        (organizerBridge ? native(h.LeagueOrganizerID) : native(h.LeagueID)) ===
          args.bridge_id && native(h.LeagueOrganizerID),
        "Live bridge identity did not match.",
      );
      return {
        ...out,
        complete: false,
        checkpoint: { ...cursor, phase: "clubs", organizer: String(h.LeagueOrganizerID) },
      };
    }
    if (phase === "clubs") {
      const raw = await live(
        t,
        "/api/leagueorganizerapi/getleagueorganizerclubs",
        { LeagueOrganizerID: cursor.organizer },
        timezone,
      );
      unique(raw, (r) => native(r.ClubID));
      const ids = raw
        .filter((r) => norm(r.Name) === norm(clubName))
        .map((r) => String(r.ClubID));
      requireValue(
        ids.length === 1,
        "No unique bounded club candidates could be verified.",
        "identity_unresolved",
      );
      return {
        ...out,
        complete: false,
        checkpoint: { ...cursor, phase: "season", clubs: ids, index: 0 },
      };
    }
    const club = cursor.clubs[cursor.index];
    requireValue(
      club,
      "No exact Live membership was found.",
      "identity_unresolved",
    );
    if (phase === "season") {
      const r = await live(
          t,
          "/api/clubapi/initclubteams",
          { ClubID: club },
          timezone,
        ),
        seasons = r?.Seasons?.filter((s) => s.IsDefault === true);
      requireValue(
        Array.isArray(seasons) &&
          seasons.length === 1 &&
          native(seasons[0].SeasonID),
        "Live default season is ambiguous.",
      );
      return {
        ...out,
        complete: false,
        checkpoint: {
          ...cursor,
          phase: "team",
          season: String(seasons[0].SeasonID),
          season_name: text(seasons[0].SeasonName),
          season_observations:participantObservations(t,club,String(seasons[0].SeasonID)),
        },
      };
    }
    if((cursor.season_observations||[]).some((o)=>!Number.isFinite(Date.parse(o.at))||Date.now()-Date.parse(o.at)>6*60*60*1000)) return {...out,complete:false,checkpoint:{...cursor,phase:"season"}};
    const raw = await live(
      t,
      "/api/clubapi/getteams",
      { ClubID: club, SeasonID: cursor.season },
      timezone,
    );
    unique(raw, (r) => native(r.TeamID));
    const matches = raw.filter(
      (r) =>
        r.ExternalDataSourceName === "GotSport" &&
        native(r.ExternalDataSourceKey) === id,
    );
    requireValue(matches.length <= 1, "Duplicate exact Live identities.");
    if (!matches.length)
      return {
        ...out,
        complete: false,
        checkpoint: { ...cursor, phase: "season", index: cursor.index + 1 },
      };
    const r = matches[0];
    requireValue(
      native(r.SeasonID) === cursor.season &&
        native(r.ItemID) === native(r.TeamID) &&
        Number(r.ExternalDataSourceID)===6 &&
        (!r.ClubID || native(r.ClubID) === club),
      "Live membership conflicts with its season or club.",
    );
    const liveTeam = String(r.TeamID),
      proof = {
        team_id: id,
        live_team_id: liveTeam,
        club,
        season: cursor.season,
        season_name: cursor.season_name,
        bridge_event: args.event,
        bridge_kind: args.bridge_kind,
        bridge_id: args.bridge_id,
        bridge_url: args.bridge_url,
        organizer: cursor.organizer,
        external_key: id,
        external_source_id:r.ExternalDataSourceID,
        external_source_name:r.ExternalDataSourceName,
        default_season:true,
        item_id:String(r.ItemID),
        observations:participantObservations(t,club,cursor.season,cursor.season_observations||[]),
        verified_at: stamp(),
        checked_at:stamp(),
        expires_at:new Date(Date.now()+6*60*60*1000).toISOString(),
      };
    records.teams = [
      teamRecord(
        "live",
        liveTeam,
        compactName(r.ClubName, r.TeamName),
        { club_name: text(r.ClubName), proof },
        { season: cursor.season_name, club_id: key("live", club) },
      ),
    ];
    records.clubs = [
      {
        id: key("live", club),
        provider: "live",
        native_id: club,
        name: clubName,
        logo: safeUrl(parse(profile?.details).logo) || null,
      },
    ];
    records.identity_links = [
      {
        a: key("gotsport", id),
        b: key("live", liveTeam),
        kind: "provider_external_key",
        evidence: JSON.stringify(proof),
        observed_at: stamp(),
      },
    ];
    children.push(
      job("live", "upcoming", liveTeam, { team_id: liveTeam, proof, timezone }),
      job("live", "membership", liveTeam, {
        team_id: liveTeam,
        proof,
        timezone,
      }),
    );
    return out;
  }
  if (j.kind === "upcoming") {
    const allRows = unique(
      await live(
        t,
        "/api/teamapi/getcomingteamgames",
        { TeamID: id, LastGameID: cursor.last || 0 },
        timezone,
      ),
      (g) => native(g.GameID),
    );
    if (!allRows.length) return { ...out, coverage: "complete_upcoming" };
    const slice=await sourceSlice(allRows,cursor,20),r=slice.rows;
    const last = String(allRows.at(-1).GameID);
    requireValue(
      last !== String(cursor.last || 0),
      "Live pagination did not advance.",
    );
    out.fixtures = r.map((g) => normalizeLive(g, { team: id, timezone }));
    out.scan_keys = out.fixtures.map((f) => f.id);
    records.teams = fixtureTeams(out.fixtures);
    children.push(...participantChildren(out.fixtures,args,timezone));
    records.competitions = [
      ...new Map(
        r.map((g) => [
          String(g.LeagueOrganizerID),
          eventRecord(g.LeagueOrganizerID, g.FederationOrCupName, "live"),
        ]),
      ).values(),
    ];
    records.divisions = minimalLiveDivisions(out.fixtures);
    records.memberships = records.divisions.map((d) => ({
      team_id: key("live", id),
      division_id: d.id,
      registration_id: "",
      evidence: JSON.stringify({
        source: "team_upcoming",
        season: args.proof.season,
      }),
      observed_at: stamp(),
    }));
    for (const c of records.competitions)
      children.push(
        job("live", "organizer", c.native_id+":"+args.proof.season, {
          organizer: c.native_id,
          proof:{season:args.proof.season,season_name:args.proof.season_name},
          timezone,
        }),
        job("live", "categories", c.native_id + ":" + args.proof.season+":"+records.divisions.filter((d)=>d.competition_id===c.id).map((d)=>parse(d.details).category).sort().join(","), {
          organizer: c.native_id,
          proof: {season:args.proof.season,season_name:args.proof.season_name},
          categories:records.divisions.filter((d)=>d.competition_id===c.id).map((d)=>parse(d.details).category),
          timezone,
        }),
      );
    return {
      ...out,
      complete: false,
      checkpoint: slice.done?{last}:{last:cursor.last||0,...slice.next},
      coverage: "partial_upcoming",
    };
  }
  if (j.kind === "membership") {
    const allRows = unique(
      await live(
        t,
        "/api/teamapi/getcomingteamadminleagueteams",
        { TeamID: id, LastLeagueTeamID: cursor.last || 0 },
        timezone,
      ),
      (r) => native(r.LeagueTeamID),
    );
    if (!allRows.length) return out;
    const slice=await sourceSlice(allRows,cursor,64),r=slice.rows;
    for (const m of r) {
      requireValue(
        native(m.TeamID) === id &&
          native(m.LeagueID) &&
          text(m.SeasonName) === args.proof.season_name,
        "Foreign Live membership.",
      );
      children.push(
        job("live", "league", String(m.LeagueID)+":"+id, {
          league: String(m.LeagueID),
          team_id: id,
          registration: String(m.LeagueTeamID),
          proof: args.proof,
          timezone,
        }),
      );
    }
    const last = String(allRows.at(-1).LeagueTeamID);
    requireValue(
      last !== String(cursor.last || 0),
      "Membership cursor did not advance.",
    );
    return { ...out, complete: false, checkpoint: slice.done?{last}:{last:cursor.last||0,...slice.next} };
  }
  if (j.kind === "league") {
    const h = await live(
      t,
      "/api/leagueapi/getleagueheader",
      { LeagueID: args.league },
      timezone,
    );
    requireValue(
      native(h.LeagueID) === args.league &&
        native(h.LeagueOrganizerID) &&
        text(h.SeasonName) === args.proof.season_name,
      "Membership league header mismatched.",
    );
    const organizer = String(h.LeagueOrganizerID);
    records.competitions = [eventRecord(organizer, h.FederationName, "live")];
    records.memberships = [
      {
        team_id: key("live", args.team_id),
        division_id: "live:league:" + args.league,
        registration_id: args.registration,
        evidence: JSON.stringify({
          organizer,
          season: args.proof.season,
          league: args.league,
        }),
        observed_at: stamp(),
      },
    ];
    children.push(
      job("live", "organizer", organizer+":"+args.proof.season, { organizer, proof:{season:args.proof.season,season_name:args.proof.season_name}, timezone }),
      job("live", "categories", organizer + ":" + args.proof.season+":"+args.league, {
        organizer,
        proof: {season:args.proof.season,season_name:args.proof.season_name},
        league:args.league,
        timezone,
      }),
    );
    return out;
  }
  if (j.kind === "organizer") {
    const h = await live(
      t,
      "/api/leagueorganizerapi/getleagueorganizerheader",
      { LeagueOrganizerID: args.organizer },
      timezone,
    );
    requireValue(
      native(h.LeagueOrganizerID) === args.organizer,
      "Organizer identity mismatched.",
    );
    records.competitions = [
      eventRecord(
        args.organizer,
        h.Name,
        "live",
        {
          city: text(h.City),
          state: text(h.State),
          website: safeUrl(h.WebPage),
          official_name:text(h.Name),
          organizer:args.organizer,
          starts_on:day(h.StartDate),
          ends_on:day(h.EndDate),
          season_id:args.proof?.season||args.season||null,
          season_name:args.proof?.season_name||args.season_name||null,
          description: text(h.Description, 3000),
          source_url: SITE + "/league-organizer/" + args.organizer,
        },
        { starts_on: day(h.StartDate), ends_on: day(h.EndDate) },
      ),
    ];
    return out;
  }
  if (j.kind === "categories") {
    const r = await live(
      t,
      "/api/leagueorganizerapi/initleagueorganizerleagueswithcategories",
      { LeagueOrganizerID: args.organizer },
      timezone,
    );
    requireValue(
      Array.isArray(r.Leagues) &&
        Array.isArray(r.Seasons) &&
        r.Seasons.some(
          (s) =>
            native(s.SeasonID) === args.proof.season &&
            text(s.SeasonName) === args.proof.season_name,
        ),
      "Organizer season is unverified.",
    );
    const header=await live(t,"/api/leagueorganizerapi/getleagueorganizerheader",{LeagueOrganizerID:args.organizer},timezone);
    requireValue(native(header.LeagueOrganizerID)===args.organizer,"Organizer context changed.");
    const eventContext={organizer:args.organizer,official_name:text(header.Name),starts_on:day(header.StartDate),ends_on:day(header.EndDate),website:safeUrl(header.WebPage),season_id:args.proof.season,season_name:args.proof.season_name};
    records.competitions=[eventRecord(args.organizer,header.Name,"live",eventContext,{starts_on:eventContext.starts_on,ends_on:eventContext.ends_on})];
    const memberships = args.memberships || [], requestedLeagues = (args.leagues || (args.league ? [args.league] : [])).map(String), requestedCategories=(args.categories||[]).map(String);
    records.divisions = [];
    records.memberships = [];
    for (const category of unique(r.Leagues, (c) =>
      native(c.LeagueCategoryID),
    )) {
      requireValue(
        Array.isArray(category.Leagues),
        "Category leagues missing.",
      );
      const leagues = category.Leagues.filter(
        (l) => native(l.SeasonID) === args.proof.season,
      );
      if (!leagues.length) continue;
      unique(leagues, (l) => native(l.LeagueID));
      const div = "live:" + args.organizer + ":" + category.LeagueCategoryID,
        related = memberships.filter(
          (m) =>
            m.division_id === div ||
            leagues.some((l) => m.division_id === "live:league:" + l.LeagueID),
        );
      if (!related.length && !requestedCategories.includes(String(category.LeagueCategoryID)) && !leagues.some((l)=>requestedLeagues.includes(String(l.LeagueID)))) continue;
      const ids = leagues.map((l) => String(l.LeagueID)),
        details = {
          organizer: args.organizer,
          category: String(category.LeagueCategoryID),
          season: args.proof.season,
          season_name:args.proof.season_name,
          event_context:eventContext,
          leagues: ids,
          pools: leagues.map((l) => ({
            id: String(l.LeagueID),
            name: text(l.LeagueName),
            format: l.LeagueTypeID,
          })),
        };
      records.divisions.push({
        id: div,
        competition_id: key("live", args.organizer),
        name: text(category.Name) || "Category",
        details: JSON.stringify(details),
        observed_at: stamp(),
      });
      records.memberships.push(
        ...related.map((m) => ({ ...m, division_id: div })),
      );
      children.push(
        job("live", "division", div, { ...details, timezone }),
        job("live", "standings", div, { ...details, timezone }),
      );
    }
    return out;
  }
  if (j.kind === "division") {
    const tense = cursor.tense || 1,
      skip = cursor.skip || 0,
      allRows = unique(
        await live(
          t,
          "/api/leagueorganizerapi/getleagueorganizerschedule",
          {
            division: args.category,
            LeagueOrganizerID: args.organizer,
            Tense: tense,
            Skip: skip,
            ShowMyTeamsOnly: false,
          },
          timezone,
        ),
        (g) => native(g.GameID),
      );
    if (!allRows.length) {
      if (tense === 1)
        return {
          ...out,
          complete: false,
          checkpoint: { tense: 3, skip: 0,count:cursor.count||0 },
          coverage: {kind:"division_schedule",provider:"live",scope:j.scope,division_id:j.scope,organizer:args.organizer,category:args.category,complete:false,count:cursor.count||0,terminal_tenses:[1]},
        };
      return { ...out, coverage: {kind:"division_schedule",provider:"live",scope:j.scope,division_id:j.scope,organizer:args.organizer,category:args.category,season:args.proof?.season||args.season||null,complete:true,count:cursor.count||0,terminal_tenses:[1,3]} };
    }
    const slice=await sourceSlice(allRows,cursor,50),r=slice.rows;
    out.fixtures = r.map((g) => normalizeLive(g, args));
    out.scan_keys = out.fixtures.map((f) => tense + ":" + f.id);
    records.teams = fixtureTeams(out.fixtures);
    children.push(...participantChildren(out.fixtures,args,timezone));
    return {
      ...out,
      complete: false,
      checkpoint: slice.done?{tense,skip:skip+allRows.length,count:(cursor.count||0)+r.length}:{tense,skip,count:(cursor.count||0)+r.length,...slice.next},
      coverage: {kind:"division_schedule",provider:"live",scope:j.scope,division_id:j.scope,organizer:args.organizer,category:args.category,season:args.proof?.season||args.season||null,complete:false,count:(cursor.count||0)+r.length},
    };
  }
  if (j.kind === "standings") {
    const skip = cursor.skip || 0,
      r = unique(
        await live(
          t,
          "/api/leagueorganizerapi/getleagueorganizerstandings",
          {
            division: args.category,
            LeagueOrganizerID: args.organizer,
            Skip: skip,
            ShowMyTeamsOnly: false,
          },
          timezone,
        ),
        (b) => native(b.LeagueID),
      );
    if (!r.length) {
      out.replacements = [{kind:"standings",division_id:j.scope,scan_id:j.scan_id}];
      out.coverage={kind:"standings",provider:"live",scope:j.scope,division_id:j.scope,complete:true,count:cursor.count||0,availability:cursor.count?"published":"unpublished"};
      return out;
    }
    records.standings = [];
    for (const block of r) {
      requireValue(
        args.leagues.includes(String(block.LeagueID)) &&
          native(block.LeagueTable?.LeagueID) === String(block.LeagueID),
        "Standings pool mismatched.",
      );
      for (const s of unique(block.LeagueTable.Rows, (s) =>
        native(s.LeagueTeamID),
      )) {
        requireValue(native(s.TeamID), "Standing has no team identity.");
        const p = {
          name: compactName(s.ClubName, s.TeamName),
          mp: s.Played,
          w: s.Won,
          d: s.Draws,
          l: s.Lost,
          pts: s.Points,
          gf: s.GoalsScored,
          ga: s.GoalsConceded,
          gd: s.GoalDifference,
        };
        for (const k of ["mp", "w", "d", "l", "pts", "gf", "ga", "gd"])
          requireValue(
            Number.isInteger(p[k]) && (["pts", "gd"].includes(k) || p[k] >= 0),
            "Invalid standings total.",
          );
        records.standings.push({
          division_id: j.scope,
          pool_id: String(block.LeagueID),
          team_id: key("live", s.TeamID),
          rank:
            Number.isInteger(s.Position) && s.Position > 0 ? s.Position : null,
          payload: JSON.stringify(p),
          scan_id: j.scan_id,
          observed_at: stamp(),
        });
      }
    }
    const flattened=records.standings,slice=await sourceSlice(flattened,cursor,100),count=(cursor.count||0)+slice.rows.length;
    records.standings=slice.rows;
    return { ...out, complete: false, checkpoint: slice.done?{skip:skip+r.length,count}:{skip,count,...slice.next},
      coverage:{kind:"standings",provider:"live",scope:j.scope,division_id:j.scope,complete:false,count,availability:count?"published":"pending"} };
  }
  if (j.kind === "fixture") {
    const r = await live(
      t,
      "/api/followgameapi/initgameview",
      { GameID: args.game_id },
      timezone,
    );
    requireValue(
      native(r.GameHeaderInfo?.GameID) === args.game_id,
      "Saved game response mismatched.",
    );
    out.fixtures = [normalizeLive(r.GameHeaderInfo)];
    records.teams = fixtureTeams(out.fixtures);
    return out;
  }
  throw fail("Unsupported GotSport job.", 500, "job_kind");
}
