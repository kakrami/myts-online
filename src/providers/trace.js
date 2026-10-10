import {
  bytes,
  day,
  fail,
  instant,
  key,
  native,
  parse,
  requireValue,
  stamp,
  text,
} from "../core.js";
import { unseal } from "../auth.js";
import { teamRecord } from "../db.js";
import { job } from "../jobs.js";
import { unique } from "./http.js";
import * as Q from "./trace-contracts.js";
export const APP = "https://go.traceup.com",
  TEAMS = "https://teams.traceup.com/webapp",
  GRAPH = APP + "/traceid-prod/graphql",
  LAPI = "https://lapi.traceup.com/traceid-prod/graphql";
export async function traceRequest(t, url, cookie = "", options = {}) {
  return t.get(
    url,
    {
      ...options,
      headers: {
        Accept: "application/json",
        Origin: APP,
        Referer: APP + "/",
        ...(cookie ? { Cookie: cookie } : {}),
        ...options.headers,
      },
    },
    options.maxBytes ? "radar" : "json",
  );
}
export async function graphql(
  t,
  cookie,
  query,
  variables,
  operationName,
  endpoint = GRAPH,
) {
  const r = await traceRequest(t, endpoint, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationName, query, variables }),
    }),
    p = r.value;
  requireValue(
    !p.errors?.length && p.data,
    "Trace GraphQL data is unavailable.",
    "trace_graphql",
  );
  return p.data;
}
export async function tokenFor(t, cookie) {
  const p = (await traceRequest(t, TEAMS + "/users/self/token", cookie)).value,
    token = p.data ?? p;
  requireValue(
    native(token.user_id) && text(token.token) && token.timestamp,
    "Trace session expired.",
    "trace_session",
  );
  return token;
}
export function cookieFrom(response) {
  const values = response.headers.getSetCookie?.() || [
    response.headers.get("set-cookie") || "",
  ];
  for (const raw of values) {
    const m = raw.match(/(?:^|,\s*)PHPSESSID=([^;,\s]+)/i);
    if (m) return "PHPSESSID=" + m[1];
  }
  return "";
}
export async function traceTeams(t, cookie) {
  const p = (
    await traceRequest(t, TEAMS + "/users/self/teams?sport_type=any", cookie)
  ).value;
  return unique(p.data ?? p, (r) => native(r.team_id));
}
function display(m) {
  return text(
    [m.user?.first_name, m.user?.last_name].filter(Boolean).join(" ") ||
      m.user?.name ||
      m.pg_name ||
      m.gid,
  );
}
function traceFixture(g, teamId) {
  const h = native(g.home_team?.team_id),
    a = native(g.away_team?.team_id);
  requireValue(
    native(g.game_id) && h && a && h !== a && [h, a].includes(teamId),
    "Trace fixture has foreign participants.",
  );
  const sc = (v) =>
    v == null || v === ""
      ? null
      : Number.isFinite(Number(v)) && Number(v) >= 0
        ? Number(v)
        : null;
  const start = /Z$|[+-]\d\d:\d\d$/.test(g.full_date || "")
      ? instant(g.full_date)
      : null,
    p = {
      home_name: text(g.home_team.title || g.home_team.name),
      away_name: text(g.away_team.title || g.away_team.name),
      half_minutes: Number(g.approx_half_duration) || null,
      source_url: APP + "/traceid/game/" + g.game_id,
      time_pending: !start,
    };
  return {
    id: key("trace", g.game_id),
    provider: "trace",
    native_id: String(g.game_id),
    competition_id: null,
    division_id: null,
    home_id: key("trace", h),
    away_id: key("trace", a),
    starts_at: start,
    local_day: start ? null : day(g.full_date),
    type: "game",
    status:
      sc(g.home_team.score) !== null && sc(g.away_team.score) !== null
        ? "FINAL"
        : "SCHEDULED",
    conditional: 0,
    home_score: sc(g.home_team.score),
    away_score: sc(g.away_team.score),
    payload: JSON.stringify(p),
    observed_at: stamp(),
  };
}
function player(m) {
  const id = native(m.user_id || m.user?.user_id);
  return id &&
    m.is_player === true &&
    m.user?.is_dummy !== true &&
    !/^(?:tracer|dummy|unidentified)(?:\s|$)/i.test(display(m))
    ? {
        id: key("trace", id),
        provider: "trace",
        native_id: id,
        name: display(m),
        jersey: text(m.jersey_number, 20),
        details: JSON.stringify({
          gid: text(m.gid),
          position: text(m.position),
          team_id: native(m.team_id),
          is_dummy: false,
        }),
        observed_at: stamp(),
      }
    : null;
}
function sourcePart(fixture_id, team_id, name, value) {
  requireValue(
    bytes(value) <= 1000000,
    "Trace component exceeds its per-record contract.",
    "trace_part_size",
  );
  return {
    fixture_id,
    team_id,
    part: name,
    value: JSON.stringify(value),
    observed_at: stamp(),
  };
}
function segments(ring) {
  requireValue(Array.isArray(ring), "Tracking response has no ring.");
  const out = [];
  let lo = null,
    hi = null;
  function flush() {
    if (lo !== null && hi > lo) out.push([lo / 1000, hi / 1000]);
    lo = null;
    hi = null;
  }
  for (const v of ring) {
    requireValue(Array.isArray(v) && v.length >= 2, "Invalid tracking sample.");
    if (v[1] === "DISCONTINUITY") flush();
    else if (
      v[1] === "L" &&
      typeof v[0] === "number" &&
      Number.isFinite(v[0])
    ) {
      lo = lo === null ? v[0] : Math.min(lo, v[0]);
      hi = hi === null ? v[0] : Math.max(hi, v[0]);
    }
  }
  flush();
  return out;
}
export async function collectTrace({
  db,
  env,
  j,
  args,
  cursor,
  transport: t,
  connection,
}) {
  requireValue(connection, "Trace is disconnected.");
  const cookie = await unseal(env, connection.secret),
    token = await tokenFor(t, cookie),
    options = parse(connection.options),
    records = {},
    jobs = [],
    out = { records, jobs, complete: true, cursor: { finished: true } },
    teamId = connection.native_id,
    teamKey = key("trace", teamId),
    part = (fixture, name, value) => sourcePart(fixture, teamKey, name, value);
  if (j.kind === "catalog") {
    const d = await graphql(
        t,
        cookie,
        Q.TEAM_GAMES_QUERY,
        { team_id: Number(teamId), token },
        "teamGames",
      ),
      games = unique(d.teamGames, (g) => native(g.game_id));
    out.fixtures = games.map((g) => traceFixture(g, teamId));
    records.teams = [
      ...new Map(
        games
          .flatMap((g) => [g.home_team, g.away_team])
          .map((r) => [
            String(r.team_id),
            teamRecord("trace", r.team_id, r.title || r.name),
          ]),
      ).values(),
    ];
    for (const g of games)
      jobs.push(
        job(
          "trace",
          "game",
          key("trace", g.game_id) + ":" + teamKey,
          { game_id: String(g.game_id) },
          connection.id,
        ),
      );
    return out;
  }
  if (j.kind === "roster") {
    const d = await graphql(
      t,
      cookie,
      Q.TEAM_MEMBERS_QUERY,
      { team_hash: options.slug, game_id: null, token, include_all: true },
      "getTeamMembers",
    );
    requireValue(Array.isArray(d.teamMembers), "Trace roster missing.");
    records.players = [
      ...new Map(
        d.teamMembers
          .map(player)
          .filter(Boolean)
          .map((p) => [p.id, p]),
      ).values(),
    ];
    records.team_players = records.players.map((p) => ({
      team_id: key("trace", teamId),
      player_id: p.id,
      active: 1,
      scan_id: j.kind === "roster" ? j.scan_id : "",
    }));
    out.mutations = [
      {
        sql: "UPDATE team_players SET active=0 WHERE team_id=? AND scan_id<>? AND $GUARD",
        args: [key("trace", teamId), j.scan_id],
      },
    ];
    return out;
  }
  const fixture_id = key("trace", args.game_id);
  if (j.kind === "game") {
    let profile = options.profile_hash || cursor.profile_hash;
    if (!profile) {
      if (!cursor.users) {
        const d = await graphql(
            t,
            cookie,
            Q.USER_RELATIONS_QUERY,
            { to_user_id: Number(token.user_id), token, include_self: true },
            "getUserRelations",
            LAPI,
          ),
          roster = (
            await db
              .prepare(
                "SELECT p.native_id FROM players p JOIN team_players tp ON tp.player_id=p.id WHERE tp.team_id=? AND tp.active=1 LIMIT 20",
              )
              .bind(key("trace", teamId))
              .all()
          ).results,
          ids = [
            ...new Set(
              [
                token.user_id,
                ...(d.userRelations || []).map(
                  (r) => r.user_id || r.user?.user_id,
                ),
                ...roster.map((p) => p.native_id),
              ]
                .map(native)
                .filter(Boolean),
            ),
          ];
        return { ...out, complete: false, cursor: { users: ids, index: 0 } };
      }
      const uid = cursor.users[cursor.index || 0];
      requireValue(
        uid,
        "No authorized Trace profile provides this game.",
        "trace_profile_unresolved",
      );
      const d = await graphql(
        t,
        cookie,
        Q.PROFILE_BY_USER_QUERY,
        { user_id: Number(uid), token },
        "findProfileByUserId",
        LAPI,
      );
      profile = text(d.profile?.hash_key);
      if (!profile)
        return {
          ...out,
          complete: false,
          cursor: { ...cursor, index: (cursor.index || 0) + 1 },
        };
    }
    const d = await graphql(
        t,
        cookie,
        Q.RICH_GAME_QUERY,
        {
          game_id: Number(args.game_id),
          hash_key: profile,
          moment_id: null,
          gid: null,
          token,
        },
        "game",
      ),
      g = d.game;
    requireValue(
      native(g?.game_id) === args.game_id &&
        Array.isArray(g.team_members) &&
        Array.isArray(g.moments),
      "Trace detailed game response is invalid.",
    );
    requireValue(
      [native(g.home_team?.team_id), native(g.away_team?.team_id)].includes(
        teamId,
      ),
      "Detailed game has a foreign team.",
    );
    if (!g.moments.length && !options.profile_hash)
      return {
        ...out,
        complete: false,
        cursor: { ...cursor, index: (cursor.index || 0) + 1 },
      };
    const own = native(g.home_team.team_id) === teamId ? "home" : "away",
      members = g.team_members.filter(
        (m) => m.side === own && m.is_player === true,
      ),
      header = {
        game_id: args.game_id,
        full_date: g.full_date,
        own_side: own,
        home: g.home_team,
        away: g.away_team,
        approx_half_duration: g.approx_half_duration,
        base_path: g.base_path,
        num_equip: g.num_equip,
        profile_hash: profile,
      };
    records.trace_parts = [
      part(fixture_id, "header", header),
      part(
        fixture_id,
        "roster",
        members.map((m) => ({
          gid: text(m.gid),
          side: m.side,
          user_id: native(m.user_id || m.user?.user_id) || null,
          name: display(m),
          jersey: text(m.jersey_number),
          position: text(m.position),
          dummy: m.user?.is_dummy === true,
          default_trace_number: m.default_trace_number ?? null,
        })),
      ),
    ];
    records.players = [
      ...new Map(
        members
          .map(player)
          .filter(Boolean)
          .map((p) => [p.id, p]),
      ).values(),
    ];
    records.team_players = records.players.map((p) => ({
      team_id: key("trace", teamId),
      player_id: p.id,
      active: 1,
      scan_id: j.kind === "roster" ? j.scan_id : "",
    }));
    for (let i = 0; i < g.moments.length; i += 100)
      records.trace_parts.push(
        part(
          fixture_id,
          "moments:" + String(i / 100).padStart(5, "0"),
          g.moments.slice(i, i + 100).map((m) => ({
            half: m.half,
            time: m.time,
            duration: m.duration,
            start_time: m.start_time,
            type: m.type,
            keywords: m.keywords || [],
            gids: m.gids || [],
            trace_numbers: m.trace_numbers || [],
            side: m.side,
            game_clip_id: m.game_clip_id,
            dynamic_jfile: m.dynamic_jfile,
            base_path: m.base_path,
            spotlights: m.spotlights || [],
            tags: m.tags || [],
          })),
        ),
      );
    const clips = [1, 2]
      .map((half) =>
        g.moments.find(
          (m) =>
            m.type === "FullGameVideo" &&
            Number(m.half) === half &&
            (!m.camera?.name || !m.camera.name.startsWith("sf_")),
        ),
      )
      .filter(Boolean);
    for (const m of clips) {
      const clip = {
        half: Number(m.half),
        game_clip_id: Number(m.game_clip_id),
        start: Number(m.start_time),
        duration: Number(m.duration || m.dynamic_duration),
      };
      requireValue(
        Number.isFinite(clip.start) && clip.duration > 0,
        "Trace full-half timing is incomplete.",
      );
      records.trace_parts.push(part(fixture_id, "clip:" + clip.half, clip));
      if (m.dynamic_jfile) {
        const base = m.base_path || g.base_path;
        try {
          const asset = new URL(
            m.dynamic_jfile,
            base?.startsWith("https:") ? base.replace(/\/?$/, "/") : APP + "/",
          );
          if (
            asset.protocol === "https:" &&
            (asset.hostname === "traceup.com" ||
              asset.hostname.endsWith(".traceup.com"))
          )
            jobs.push(
              job(
                "trace",
                "radar",
                fixture_id + ":" + clip.half,
                { game_id: args.game_id, half: clip.half, url: asset.href },
                connection.id,
              ),
            );
        } catch {}
      }
      for (const member of members) {
        if (!text(member.gid)) continue;
        const pid = native(member.user_id || member.user?.user_id),
          player_id = pid ? key("trace", pid) : "track:" + text(member.gid);
        jobs.push(
          job(
            "trace",
            "tracking",
            fixture_id + ":" + member.gid + ":" + clip.half,
            {
              game_id: args.game_id,
              half: clip.half,
              gid: text(member.gid),
              player_id,
              jersey: text(member.jersey_number),
              name: display(member),
              clip,
            },
            connection.id,
          ),
        );
      }
    }
    const periods = [
      { id: "full", start: null, end: null },
      ...clips.map((m) => ({
        id: String(m.half),
        start: Number(m.start_time),
        end:
          Number(m.start_time) +
          Number(m.duration || m.dynamic_duration) * 1000,
      })),
    ];
    for (const period of periods) {
      jobs.push(
        job(
          "trace",
          "analytics",
          fixture_id + ":" + teamKey + ":team:" + period.id,
          {
            game_id: args.game_id,
            player_id: "team",
            side: own,
            gids: [],
            period,
          },
          connection.id,
        ),
      );
      for (const m of members) {
        const p = player(m);
        if (p && m.gid)
          jobs.push(
            job(
              "trace",
              "analytics",
              fixture_id + ":" + p.id + ":" + period.id,
              {
                game_id: args.game_id,
                player_id: p.id,
                side: own,
                gids: [m.gid],
                period,
              },
              connection.id,
            ),
          );
      }
    }
    out.fixtures = [traceFixture(g, teamId)];
    out.mutations = [
      {
        sql: "UPDATE connections SET options=json_set(options,'$.profile_hash',?) WHERE id=? AND $GUARD",
        args: [profile, connection.id],
      },
    ];
    return out;
  }
  if (j.kind === "analytics") {
    const vars = {
        game_id: Number(args.game_id),
        side: args.side,
        gids: args.gids.length ? args.gids : null,
        start: args.period.start,
        end: args.period.end,
        invert_touches: false,
        token,
      },
      d = await graphql(
        t,
        cookie,
        Q.TRACE_NATIVE_STATS_QUERY,
        vars,
        "gameStats",
      ),
      stats = d.gameStats;
    requireValue(
      stats && typeof stats.available === "string",
      "Trace analytics availability is missing.",
    );
    const state = ["upgrade", "ask"].includes(stats.available)
      ? "restricted"
      : stats.available === "none"
        ? "unpublished"
        : "ready";
    let heatmap = null;
    if (state === "ready" && args.gids.length) {
      const h = await graphql(
        t,
        cookie,
        Q.TRACE_NATIVE_HEAT_QUERY,
        {
          game_id: Number(args.game_id),
          gids: args.gids,
          start: args.period.start,
          end: args.period.end,
          token,
        },
        "gameStatsHeatmap",
      );
      heatmap = h.playerGameHeatMap?.map ?? null;
      if (heatmap !== null)
        requireValue(
          Array.isArray(heatmap) &&
            (!heatmap.length ||
              heatmap.every(
                (r) =>
                  Array.isArray(r) &&
                  r.length === heatmap[0].length &&
                  r.every((v) => Number.isFinite(v) && v >= 0),
              )),
          "Invalid Trace heat map.",
        );
    }
    records.trace_stats = [
      {
        fixture_id,
        team_id: teamKey,
        player_id: args.player_id,
        period: args.period.id,
        value: JSON.stringify({ stats, heatmap }),
        state,
        observed_at: stamp(),
      },
    ];
    return out;
  }
  if (j.kind === "tracking") {
    const chunk = cursor.chunk || 0,
      count = 4,
      duration = Math.round(args.clip.duration * 1000),
      lo = Math.round((duration * chunk) / count),
      hi = Math.round((duration * (chunk + 1)) / count),
      gid = args.gid.replaceAll("-", "_"),
      vars = {
        segments: [
          {
            start: args.clip.start + lo,
            local_start: lo,
            duration: hi - lo,
            game_clip_id: args.clip.game_clip_id,
            gid,
            player_name: [args.jersey ? "#" + args.jersey : "", args.name]
              .filter(Boolean)
              .join(" "),
            sport_type: "soccer",
          },
        ],
        eduButtonSize: { width: 115, height: 72 },
      },
      d = await graphql(t, cookie, Q.HALO_QUERY, vars, "getHaloData");
    const segs = segments(d.halo?.ring);
    records.trace_parts = [
      part(fixture_id, `tracking:${args.half}:${args.gid}:${chunk}`, {
        player_id: args.player_id,
        gid: args.gid,
        half: args.half,
        chunk,
        segments: segs,
      }),
    ];
    return {
      ...out,
      complete: chunk === 3,
      cursor: chunk === 3 ? { finished: true } : { chunk: chunk + 1 },
    };
  }
  if (j.kind === "radar") {
    const { value: r } = await traceRequest(t, args.url, cookie, {
      maxBytes: 8_000_000,
    });
    requireValue(
      Array.isArray(r.frm) && r.frm.length > 1,
      "Trace radar is empty.",
    );
    const counts = r.frm
        .map((f) => Object.keys(f.a || {}).length)
        .sort((a, b) => a - b),
      population = counts[Math.floor(counts.length / 2)],
      start = Number(r.frm[0].t) / 100,
      end = Number(r.frm.at(-1).t) / 100;
    requireValue(
      Number.isFinite(start) && Number.isFinite(end) && end > start,
      "Trace radar timing is invalid.",
    );
    records.trace_parts = [
      part(fixture_id, "radar:" + args.half, {
        half: args.half,
        start,
        end,
        population,
        geometry: r.setup?.field?.coordinates ?? null,
        samples: r.frm.length,
      }),
    ];
    return out;
  }
  throw fail("Unsupported Trace job.", 500, "job_kind");
}
