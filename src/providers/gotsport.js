import {
  day,
  fail,
  instant,
  key,
  native,
  norm,
  parse,
  requireValue,
  safeUrl,
  stamp,
  text,
} from "../core.js";
import { localDate } from "../services/season.js";
import { teamRecord } from "../db.js";
import { job } from "../jobs.js";
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
export function normalizeRankings(m, division = null) {
  requireValue(
    native(m.id) && native(m.event_id) && native(m.schedule_id),
    "GotSport fixture identity is incomplete.",
  );
  const h = native(m.homeTeam?.team_id),
    a = native(m.awayTeam?.team_id);
  requireValue(!h || !a || h !== a, "A game has identical participants.");
  const hs = score(m.home_score),
    as = score(m.away_score),
    start = instant(m.matchTime),
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
    round: text(m.playoff_element?.tier_title),
    bracket_id: native(m.bracket_id),
    schedule_id: String(m.schedule_id),
    home_registration: native(m.home_team_reg_id),
    away_registration: native(m.away_team_reg_id),
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
    home_score: hs,
    away_score: as,
    status:
      m.is_canceled === true ||
      m.is_cancelled === true ||
      /^cancel/i.test(m.status || "")
        ? "CANCELLED"
        : /postpon/i.test(m.status || "")
          ? "POSTPONED"
          : hs !== null && as !== null
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
    round: text(g.LeaguePlayoffStage),
    league_id: String(g.LeagueID),
    organizer: String(g.LeagueOrganizerID),
    category: String(g.LeagueCategoryID),
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
    local_day: g.TimeNotSet
      ? localDate(g.GameTime, context.timezone || "America/Los_Angeles")
      : null,
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
        map.set(f[side + "_id"], teamRecord(provider, id, p[side + "_name"]));
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
export async function collectGotSport({ db, j, args, cursor, transport: t }) {
  const records = {},
    jobs = [],
    out = { records, jobs, complete: true, cursor: { finished: true } },
    id = args.team_id || j.scope,
    timezone = args.timezone || "America/Los_Angeles";
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
          logo: safeUrl(r.image || r.team_logo_url_full),
        },
      ];
    records.teams = [
      teamRecord(
        "gotsport",
        id,
        compactName(r.club_name, r.team_name || r.name),
        {
          club_name: text(r.club_name),
          logo: safeUrl(r.image || r.team_logo_url_full),
        },
        { club_id: club },
      ),
    ];
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "history") {
    const page = cursor.page || 1,
      r = await ranking(t, `/teams/${id}/matches`, {
        past: true,
        page,
        per_page: 100,
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
              division_id: "gotsport:bracket:" + m.bracket_id,
              registration_id: reg,
              evidence: JSON.stringify({
                event_id: String(m.event_id),
                schedule_id: String(m.schedule_id),
              }),
              observed_at: stamp(),
            },
          ]
        : [];
    });
    for (const event of records.competitions)
      jobs.push(
        job("gotsport", "event", event.native_id, {
          event_id: event.native_id,
          timezone,
        }),
      );
    out.complete = done;
    out.cursor = done
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
    const groups = unique(e.schedule_groups, (g) => native(g.id)),
      pending = (
        await db
          .prepare(
            "SELECT * FROM memberships WHERE division_id LIKE 'gotsport:bracket:%' AND json_extract(evidence,'$.event_id')=?",
          )
          .bind(String(e.id))
          .all()
      ).results;
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
      if (!relevant.length) continue;
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
      jobs.push(
        job("gotsport", "division", div, {
          event: String(e.id),
          group: String(g.id),
          brackets: brackets.map((b) => String(b.id)),
        }),
        job("gotsport", "standings", div, {
          event: String(e.id),
          group: String(g.id),
          brackets: brackets.map((b) => String(b.id)),
        }),
      );
    }
    const u = safeUrl(
      /^https?:/i.test(e.website_url || "")
        ? e.website_url
        : "https://" + (e.website_url || ""),
    );
    let league = "";
    if (u) {
      const link = new URL(u);
      if (link.hostname === "gotsportlive.com" && !link.search && !link.hash)
        league = native(link.pathname.match(/^\/league\/(\d+)\/?$/)?.[1]);
    }
    if (league)
      for (const team of new Set(pending.map((m) => m.team_id.split(":")[1])))
        jobs.push(
          job("live", "resolve", team + ":" + e.id, {
            team_id: team,
            bridge_league: league,
            event: String(e.id),
            timezone,
          }),
        );
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "division") {
    const rows = unique(
      await ranking(t, "/event_ranking_data/flight_matches", {
        event_id: args.event,
        flight_id: args.group,
      }),
      (m) => native(m.id),
    );
    for (const m of rows)
      requireValue(
        native(m.event_id) === args.event &&
          ((args.brackets || []).includes(native(m.bracket_id)) ||
            m.playoff_element),
        "Fixture escaped its division.",
      );
    out.fixtures = rows.map((m) => normalizeRankings(m, j.scope));
    records.teams = fixtureTeams(out.fixtures);
    return out;
  }
  if (j.provider === "gotsport" && j.kind === "standings") {
    const rows = unique(
      await ranking(t, "/event_ranking_data/flight_registrations", {
        event_id: args.event,
        flight_id: args.group,
      }),
      (m) => native(m.id),
    );
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
    out.mutations = [
      {
        sql: "DELETE FROM standings WHERE division_id=? AND scan_id<>? AND $GUARD",
        args: [j.scope, j.scan_id],
      },
    ];
    return out;
  }
  if (j.kind === "resolve") {
    const profile = await db
        .prepare("SELECT details FROM teams WHERE id=?")
        .bind(key("gotsport", id))
        .first(),
      clubName = parse(profile?.details).club_name;
    requireValue(
      clubName,
      "Canonical club profile has not been collected.",
      "dependency_pending",
    );
    const phase = cursor.phase || "bridge";
    if (phase === "bridge") {
      const h = await live(
        t,
        "/api/leagueapi/getleagueheader",
        { LeagueID: args.bridge_league },
        timezone,
      );
      requireValue(
        native(h.LeagueID) === args.bridge_league &&
          native(h.LeagueOrganizerID),
        "Live bridge league identity did not match.",
      );
      return {
        ...out,
        complete: false,
        cursor: { phase: "clubs", organizer: String(h.LeagueOrganizerID) },
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
        ids.length && ids.length <= 20,
        "No unique bounded club candidates could be verified.",
        "identity_unresolved",
      );
      return {
        ...out,
        complete: false,
        cursor: { ...cursor, phase: "season", clubs: ids, index: 0 },
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
        cursor: {
          ...cursor,
          phase: "team",
          season: String(seasons[0].SeasonID),
          season_name: text(seasons[0].SeasonName),
        },
      };
    }
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
        cursor: { ...cursor, phase: "season", index: cursor.index + 1 },
      };
    const r = matches[0];
    requireValue(
      native(r.SeasonID) === cursor.season &&
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
        bridge_league: args.bridge_league,
        organizer: cursor.organizer,
        external_key: id,
        verified_at: stamp(),
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
        logo: null,
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
    jobs.push(
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
    const r = unique(
      await live(
        t,
        "/api/teamapi/getcomingteamgames",
        { TeamID: id, LastGameID: cursor.last || 0 },
        timezone,
      ),
      (g) => native(g.GameID),
    );
    if (!r.length) return { ...out, coverage: "complete_upcoming" };
    const last = String(r.at(-1).GameID);
    requireValue(
      last !== String(cursor.last || 0),
      "Live pagination did not advance.",
    );
    out.fixtures = r.map((g) => normalizeLive(g, { team: id, timezone }));
    out.scan_keys = out.fixtures.map((f) => f.id);
    records.teams = fixtureTeams(out.fixtures);
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
      jobs.push(
        job("live", "organizer", c.native_id, {
          organizer: c.native_id,
          timezone,
        }),
        job("live", "categories", c.native_id + ":" + args.proof.season, {
          organizer: c.native_id,
          proof: args.proof,
          timezone,
        }),
      );
    return {
      ...out,
      complete: false,
      cursor: { last },
      coverage: "partial_upcoming",
    };
  }
  if (j.kind === "membership") {
    const r = unique(
      await live(
        t,
        "/api/teamapi/getcomingteamadminleagueteams",
        { TeamID: id, LastLeagueTeamID: cursor.last || 0 },
        timezone,
      ),
      (r) => native(r.LeagueTeamID),
    );
    if (!r.length) return out;
    for (const m of r) {
      requireValue(
        native(m.TeamID) === id &&
          native(m.LeagueID) &&
          text(m.SeasonName) === args.proof.season_name,
        "Foreign Live membership.",
      );
      jobs.push(
        job("live", "league", String(m.LeagueID), {
          league: String(m.LeagueID),
          team_id: id,
          registration: String(m.LeagueTeamID),
          proof: args.proof,
          timezone,
        }),
      );
    }
    const last = String(r.at(-1).LeagueTeamID);
    requireValue(
      last !== String(cursor.last || 0),
      "Membership cursor did not advance.",
    );
    return { ...out, complete: false, cursor: { last } };
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
    jobs.push(
      job("live", "organizer", organizer, { organizer, timezone }),
      job("live", "categories", organizer + ":" + args.proof.season, {
        organizer,
        proof: args.proof,
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
    const memberships = (
      await db
        .prepare(
          "SELECT * FROM memberships WHERE (division_id LIKE 'live:league:%' AND json_extract(evidence,'$.organizer')=?) OR division_id LIKE ?",
        )
        .bind(args.organizer, "live:" + args.organizer + ":%")
        .all()
    ).results;
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
      if (!related.length) continue;
      const ids = leagues.map((l) => String(l.LeagueID)),
        details = {
          organizer: args.organizer,
          category: String(category.LeagueCategoryID),
          season: args.proof.season,
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
      jobs.push(
        job("live", "division", div, { ...details, timezone }),
        job("live", "standings", div, { ...details, timezone }),
      );
    }
    return out;
  }
  if (j.kind === "division") {
    const tense = cursor.tense || 1,
      skip = cursor.skip || 0,
      r = unique(
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
    if (!r.length) {
      if (tense === 1)
        return {
          ...out,
          complete: false,
          cursor: { tense: 3, skip: 0 },
          coverage: "complete_upcoming",
        };
      return { ...out, coverage: "complete_schedule" };
    }
    out.fixtures = r.map((g) => normalizeLive(g, args));
    out.scan_keys = out.fixtures.map((f) => tense + ":" + f.id);
    records.teams = fixtureTeams(out.fixtures);
    return {
      ...out,
      complete: false,
      cursor: { tense, skip: skip + r.length },
      coverage: "partial_schedule",
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
      out.mutations = [
        {
          sql: "DELETE FROM standings WHERE division_id=? AND scan_id<>? AND $GUARD",
          args: [j.scope, j.scan_id],
        },
      ];
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
    return { ...out, complete: false, cursor: { skip: skip + r.length } };
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
