import {
  fail,
  instant,
  key,
  native,
  parse,
  requireValue,
  stamp,
  text,
} from "../core.js";
import { teamRecord } from "../db.js";
import { job } from "../jobs.js";
import { unseal } from "../auth.js";
import { url, unique } from "./http.js";
const API = "https://api.teamsnap.com/v3/";
export function collection(raw) {
  requireValue(
    Array.isArray(raw?.collection?.items) && !raw.collection.error,
    "TeamSnap returned an invalid collection.",
  );
  return raw.collection.items.map((i) => {
    const o = {};
    for (const d of i.data || []) if (d.name) o[d.name] = d.value;
    o.links = Object.fromEntries(
      (i.links || [])
        .filter((l) => l.rel && l.href)
        .map((l) => [l.rel, l.href]),
    );
    o.href = i.href;
    return o;
  });
}
export function tsURL(v) {
  const u = new URL(v, API);
  requireValue(
    u.origin === "https://api.teamsnap.com" &&
      u.pathname.startsWith("/v3/") &&
      !u.username &&
      !u.password,
    "Unsupported TeamSnap link.",
  );
  return u.href;
}
export async function ts(t, v, token) {
  return (
    await t.get(tsURL(v), {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.collection+json, application/json",
      },
    })
  ).value;
}
function nextPage(raw) {
  const links = (raw.collection?.links || []).filter((l) => l.rel === "next");
  requireValue(links.length <= 1, "TeamSnap returned ambiguous pagination.");
  return links[0]?.href ? tsURL(links[0].href) : null;
}
export async function collectTeamSnap({
  db,
  env,
  j,
  args,
  cursor,
  transport: t,
  connection,
}) {
  requireValue(connection, "TeamSnap is disconnected.");
  const token = await unseal(env, connection.secret),
    records = {},
    jobs = [],
    out = { records, jobs, complete: true, cursor: { finished: true } };
  if (j.kind === "catalog") {
    if (!cursor.url) {
      const meRaw = await ts(t, "me", token),
        me = collection(meRaw)[0];
      requireValue(native(me?.id), "TeamSnap account identity is missing.");
      const links = [
        ...new Set([
          url(API, "teams/search", { user_id: me.id }),
          ...(meRaw.collection.links || [])
            .filter((l) =>
              [
                "teams",
                "active_teams",
                "archived_teams",
                "past_teams",
                "retired_teams",
                "team_history",
              ].includes(l.rel),
            )
            .map((l) => tsURL(l.href)),
          ...Object.entries(me.links || {})
            .filter(([rel]) =>
              [
                "teams",
                "active_teams",
                "archived_teams",
                "past_teams",
                "retired_teams",
                "team_history",
              ].includes(rel),
            )
            .map(([, v]) => tsURL(v)),
        ]),
      ];
      return {
        ...out,
        complete: false,
        cursor: { url: links[0], remaining: links.slice(1), visited: [] },
      };
    }
    const raw = await ts(t, cursor.url, token),
      rows = unique(collection(raw), (r) => native(r.id));
    records.teams = [];
    records.spaces = [];
    records.space_teams = [];
    for (const r of rows) {
      const id = String(r.id),
        tid = key("teamsnap", id),
        sid = "space:" + tid,
        details = {
          timezone: text(r.time_zone || r.timezone) || "America/Los_Angeles",
          links: r.links,
          source_url: r.href,
          catalog_scan_id: j.scan_id,
          account_id: connection.native_id,
        };
      records.teams.push(
        teamRecord("teamsnap", id, r.name || r.team_name, details, {
          season: text(r.season_name || r.season_label || r.season),
          archived: +(r.is_archived === true || r.is_retired === true),
        }),
      );
      records.spaces.push({
        id: sid,
        name: text(r.name || r.team_name) || "Team",
        created_at: stamp(),
      });
      records.space_teams.push({
        space_id: sid,
        team_id: tid,
        role: "primary",
      });
      for (const kind of [
        "roster",
        "events",
        "attendance",
        "locations",
        "opponents",
      ]) {
        const rel = {
            roster: "members",
            events: "events",
            attendance: "availabilities",
            locations: "locations",
            opponents: "opponents",
          }[kind],
          endpoint =
            r.links?.[rel] || url(API, rel + "/search", { team_id: id });
        jobs.push(
          job(
            "teamsnap",
            kind,
            tid,
            { team_id: id, url: tsURL(endpoint) },
            connection.id,
          ),
        );
      }
    }
    const next = nextPage(raw),
      remaining = cursor.remaining || [],
      visited = [...(cursor.visited || []), cursor.url];
    requireValue(
      visited.length <= 200,
      "TeamSnap catalog page chain is too long.",
    );
    requireValue(
      !next || !visited.includes(next),
      "TeamSnap pagination repeated a page.",
    );
    const newURL = next || remaining[0];
    if (!newURL)
      out.mutations = [
        {
          sql: "DELETE FROM space_teams WHERE role='primary' AND team_id LIKE 'teamsnap:%' AND team_id IN (SELECT id FROM teams WHERE COALESCE(json_extract(details,'$.catalog_scan_id'),'')<>?) AND $GUARD",
          args: [j.scan_id],
        },
      ];
    return {
      ...out,
      complete: !newURL,
      cursor: newURL
        ? {
            url: newURL,
            remaining: next ? remaining : remaining.slice(1),
            visited,
          }
        : { finished: true },
    };
  }
  const raw = await ts(t, cursor.url || args.url, token),
    rows = unique(collection(raw), (r) => native(r.id)),
    next = nextPage(raw);
  requireValue(
    !next || next !== (cursor.url || args.url),
    "TeamSnap page cursor did not advance.",
  );
  const visited = [...(cursor.visited || []), cursor.url || args.url];
  requireValue(
    !next || !visited.includes(next),
    "TeamSnap pagination repeated a page.",
  );
  requireValue(visited.length <= 150, "TeamSnap page chain is too long.");
  out.complete = !next;
  out.cursor = next ? { url: next, visited } : { finished: true };
  const team = key("teamsnap", args.team_id);
  if (j.kind === "roster") {
    records.players = rows
      .filter(
        (r) =>
          r.is_non_player !== true &&
          r.is_player !== false &&
          !["coach", "manager", "owner"].includes(
            String(r.member_type || r.type).toLowerCase(),
          ),
      )
      .map((r) => ({
        id: key("teamsnap", r.id),
        provider: "teamsnap",
        native_id: String(r.id),
        name: text(
          [r.first_name, r.last_name].filter(Boolean).join(" ") ||
            r.name ||
            r.label,
        ),
        jersey: text(r.jersey_number || r.jersey || r.number, 20),
        details: JSON.stringify({
          position: text(r.position || r.position_name),
          active: r.is_active !== false,
        }),
        observed_at: stamp(),
      }));
    records.team_players = records.players.map((p) => ({
      team_id: team,
      player_id: p.id,
      active: +(JSON.parse(p.details).active !== false),
      scan_id: j.scan_id,
    }));
  }
  if (!next && j.kind === "roster")
    out.mutations = [
      {
        sql: "UPDATE team_players SET active=0 WHERE team_id=? AND scan_id<>? AND $GUARD",
        args: [team, j.scan_id],
      },
    ];
  if (j.kind === "events") {
    const teamRow = await db
        .prepare("SELECT name FROM teams WHERE id=?")
        .bind(team)
        .first(),
      refs = (
        await db
          .prepare("SELECT kind,id,value FROM references_data WHERE team_id=?")
          .bind(team)
          .all()
      ).results;
    const find = (kind, id) =>
      parse(refs.find((r) => r.kind === kind && r.id === String(id))?.value);
    out.fixtures = rows.map((r) => {
      const opponent = find("opponents", r.opponent_id),
        location = find("locations", r.location_id),
        isGame = r.is_game === true || r.is_game === 1,
        ownHome = !/away/i.test(String(r.home_or_away || r.home_away || "")),
        home = ownHome
          ? teamRow.name
          : text(r.opponent_name || opponent.name) || "Opponent",
        away = ownHome
          ? text(r.opponent_name || opponent.name) || "Opponent"
          : teamRow.name,
        sf = r.points_for_team ?? r.team_score ?? null,
        sa = r.points_for_opponent ?? r.opponent_score ?? null,
        sc = (v) =>
          v === null || v === ""
            ? null
            : Number.isFinite(Number(v)) && Number(v) >= 0
              ? Number(v)
              : null,
        start = instant(r.start_date || r.start_at || r.starts_at || r.date);
      requireValue(start, "TeamSnap event has no kickoff.");
      return {
        id: key("teamsnap", r.id),
        provider: "teamsnap",
        native_id: String(r.id),
        competition_id: null,
        division_id: null,
        home_id: ownHome ? team : null,
        away_id: ownHome ? null : team,
        starts_at: start,
        local_day: null,
        type: isGame
          ? "game"
          : /practice/i.test(r.type || r.name || "")
            ? "practice"
            : "event",
        status:
          r.is_canceled || r.is_cancelled || /cancel/i.test(r.status || "")
            ? "CANCELLED"
            : /postpon/i.test(r.status || "")
              ? "POSTPONED"
              : sc(sf) !== null && sc(sa) !== null
                ? "FINAL"
                : "SCHEDULED",
        conditional: 0,
        home_score: ownHome ? sc(sf) : sc(sa),
        away_score: ownHome ? sc(sa) : sc(sf),
        payload: JSON.stringify({
          home_name: home,
          away_name: away,
          title: text(r.name || r.formatted_title || r.label),
          venue: text(r.location_name || location.name),
          address: text(
            [location.address, location.city, location.state, location.zip]
              .filter(Boolean)
              .join(", "),
          ),
          notes: text(r.notes, 8000),
          uniform: text(r.uniform),
          arrival_at: r.arrival_date || null,
          arrival_minutes: r.minutes_to_arrive_early ?? null,
          availability_enabled:
            r.is_availability_enabled ?? r.availability_enabled ?? null,
          source_url: r.href,
          time_pending: false,
        }),
        observed_at: stamp(),
      };
    });
  } else if (j.kind === "attendance") {
    records.attendance = rows.map((r) => {
      requireValue(
        native(r.event_id) && native(r.member_id),
        "Attendance identity is incomplete.",
      );
      return {
        fixture_id: key("teamsnap", r.event_id),
        player_id: key("teamsnap", r.member_id),
        status: String(r.status_code ?? ""),
        observed_at: stamp(),
      };
    });
  } else if (["locations", "opponents"].includes(j.kind)) {
    records.references_data = rows.map((r) => ({
      team_id: team,
      kind: j.kind,
      id: String(r.id),
      value: JSON.stringify({
        name: text(r.name || r.label),
        address: text(r.address),
        city: text(r.city),
        state: text(r.state),
        zip: text(r.zip),
      }),
      observed_at: stamp(),
    }));
  } else if (j.kind !== "roster")
    throw fail("Unsupported TeamSnap job.", 500, "job_kind");
  return out;
}
