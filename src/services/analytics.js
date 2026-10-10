import { localDate } from "./season.js";
import { parse, native, text, requireValue } from "../core.js";
const sum = (a) => a.reduce((s, v) => s + v, 0);
const rounded = (n) => Math.round(n * 10) / 10;
function merged(a) {
  const b = a
      .filter(
        (x) =>
          Array.isArray(x) &&
          x.length === 2 &&
          x.every(Number.isFinite) &&
          x[1] > x[0],
      )
      .sort((x, y) => x[0] - y[0]),
    out = [];
  for (const x of b) {
    const last = out.at(-1);
    if (last && x[0] <= last[1] + 0.25) last[1] = Math.max(last[1], x[1]);
    else out.push([...x]);
  }
  return out;
}
const overlap = (a, b, segs) =>
  sum(segs.map(([s, e]) => Math.max(0, Math.min(e, b) - Math.max(s, a))));
export function heatRole(map) {
  if (!Array.isArray(map) || !map.length) return null;
  let weight = 0,
    x = 0,
    y = 0;
  for (let j = 0; j < map.length; j++)
    for (let i = 0; i < map[j].length; i++) {
      weight += map[j][i];
      x += (map[j][i] * i) / Math.max(1, map[j].length - 1);
      y += (map[j][i] * j) / Math.max(1, map.length - 1);
    }
  if (!weight) return null;
  x /= weight;
  y /= weight;
  return {
    x,
    y,
    position:
      x < 0.15 || x > 0.85 ? "GK" : x < 0.35 ? "DEF" : x > 0.65 ? "FWD" : "MID",
  };
}
export function computeMatch(parts, scopes, corrections = []) {
  const map = new Map(
      parts.map((p) => [
        p.part,
        typeof p.value === "string" ? parse(p.value) : p.value,
      ]),
    ),
    header = map.get("header"),
    roster = map.get("roster") || [];
  requireValue(
    header,
    "Trace metadata has not been saved.",
    "trace_metadata_pending",
  );
  const match = corrections.find((c) => c.kind === "match")?.value || {},
    identities = corrections.filter(
      (c) =>
        c.kind === "identity" &&
        (!c.season ||
          c.season === header.game_id ||
          c.season === "trace:" + header.game_id),
    ),
    seasonYear = (() => {
      const d = localDate(header.full_date);
      return d
        ? String(Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 7 ? 1 : 0))
        : "";
    })(),
    season =
      corrections.find((c) => c.kind === "season" && c.season === seasonYear)
        ?.value || {},
    manualPlayer = corrections.filter(
      (c) =>
        c.kind === "player" &&
        (!c.season || c.season === "trace:" + header.game_id),
    ),
    players = new Map(),
    tracks = new Map(),
    warnings = [];
  for (const m of roster) {
    const override = identities.find((c) => c.entity_id === m.gid)?.value,
      uid = native(override?.user_id || m.user_id),
      dummy = !override && m.dummy;
    if (
      uid &&
      !dummy &&
      !/^(dummy|tracer|unidentified)(?:\s|$)/i.test(override?.name || m.name)
    ) {
      const pid = "trace:" + uid;
      if (!players.has(pid))
        players.set(pid, {
          id: pid,
          name: override?.name || m.name,
          jersey: m.jersey,
          gids: [],
          minutes: 0,
          field_minutes: 0,
          gk_minutes: 0,
          half_minutes: {},
          goals: 0,
          assists: 0,
          positions: [],
          confidence: "estimated",
        });
      players.get(pid).gids.push(m.gid);
      tracks.set(m.gid, pid);
    }
  }
  const clips = [1, 2].map((h) => map.get("clip:" + h)).filter(Boolean),
    pop = [1, 2]
      .map((h) => map.get("radar:" + h)?.population)
      .filter(Number.isFinite),
    explicit = Number(match.format),
    format = [7, 9].includes(explicit)
      ? explicit
      : pop.length === 2 && pop.every((p) => p >= 17 && p <= 22)
        ? 9
        : pop.length === 2 && pop.every((p) => p >= 12 && p <= 16)
          ? 7
          : null;
  const duration = clips.reduce((n, c) => n + c.duration / 60, 0),
    target = format ? format * duration : null;
  if (!format) warnings.push("Playing format requires confirmation.");
  const scopeMap = new Map(
    scopes.map((s) => [
      s.player_id + ":" + s.period,
      { ...s, value: typeof s.value === "string" ? parse(s.value) : s.value },
    ]),
  );
  let trackingComplete = clips.length === 2,
    unresolved = 0;
  for (const clip of clips) {
    const h = clip.half,
      radar = map.get("radar:" + h),
      start = radar?.start ?? 0,
      end = Math.min(radar?.end ?? clip.duration, clip.duration),
      segments = new Map(),
      spatial = [];
    for (const m of roster) {
      const chunks = [0, 1, 2, 3].map((c) =>
        map.get(`tracking:${h}:${m.gid}:${c}`),
      );
      if (chunks.some((c) => !c)) trackingComplete = false;
      const segs = merged(chunks.flatMap((c) => c?.segments || [])),
        pid = tracks.get(m.gid);
      if (pid)
        segments.set(pid, merged([...(segments.get(pid) || []), ...segs]));
    }
    for (const p of players.values()) {
      const role = heatRole(scopeMap.get(p.id + ":" + h)?.value.heatmap);
      if (role) {
        spatial.push({ id: p.id, ...role });
        const manualRole =
          match.lineup?.[h]?.[p.id] || season.positions?.[p.id];
        p.positions.push({
          half: h,
          ...role,
          position: manualRole || role.position,
          confidence: manualRole ? "manual" : "estimated",
        });
      }
    }
    const lineup = match.lineup?.[h] || match.lineup?.[String(h)] || {},
      manualGK = Object.entries(lineup).find(([, role]) => role === "GK")?.[0],
      gks = spatial.filter((p) => p.position === "GK"),
      seasonGK = Object.entries(season.positions || {}).find(
        ([, role]) => role === "GK",
      )?.[0],
      gk =
        manualGK && players.has(manualGK)
          ? manualGK
          : gks.length === 1
            ? gks[0].id
            : seasonGK && players.has(seasonGK)
              ? seasonGK
              : null;
    if (!gk) warnings.push(`Half ${h}: goalkeeper is unresolved.`);
    if (format) {
      for (let a = start; a < end; a += 5) {
        const b = Math.min(a + 5, end),
          ranked = [...players.values()]
            .map((p) => ({
              id: p.id,
              direct: overlap(a, b, segments.get(p.id) || []),
            }))
            .filter((p) => p.direct > 0 && p.id !== gk)
            .sort(
              (p, q) =>
                q.direct - p.direct ||
                (players.get(p.id).half_minutes[h] || 0) -
                  (players.get(q.id).half_minutes[h] || 0) ||
                p.id.localeCompare(q.id),
            ),
          chosen = ranked.slice(0, format - 1);
        for (const p of chosen) {
          players.get(p.id).field_minutes += (b - a) / 60;
          players.get(p.id).half_minutes[h] =
            (players.get(p.id).half_minutes[h] || 0) + (b - a) / 60;
        }
        if (gk) {
          players.get(gk).gk_minutes += (b - a) / 60;
          players.get(gk).half_minutes[h] =
            (players.get(gk).half_minutes[h] || 0) + (b - a) / 60;
        }
        unresolved += ((format - chosen.length - (gk ? 1 : 0)) * (b - a)) / 60;
      }
    } else
      for (const p of players.values()) {
        const mins =
          sum(
            (segments.get(p.id) || []).map(([s, e]) =>
              Math.max(0, Math.min(end, e) - Math.max(start, s)),
            ),
          ) / 60;
        p.field_minutes += mins;
        p.half_minutes[h] = mins;
      }
  }
  const moments = parts
      .filter((p) => p.part.startsWith("moments:"))
      .sort((a, b) => a.part.localeCompare(b.part))
      .flatMap((p) =>
        typeof p.value === "string" ? parse(p.value, []) : p.value,
      ),
    events = [];
  for (const m of moments) {
    const words = (m.keywords || []).map((v) => String(v).toLowerCase()),
      kind =
        /goal/i.test(m.type) || words.includes("goal")
          ? "goal"
          : /assist/i.test(m.type) || words.includes("assist")
            ? "assist"
            : null;
    if (!kind) continue;
    const side = m.side || ["home", "away"].find((s) => words.includes(s));
    if (side && side !== header.own_side) continue;
    const ids = [
        ...new Set((m.gids || []).map((g) => tracks.get(g)).filter(Boolean)),
      ],
      manual = match.events?.[String(m.game_clip_id)],
      pid = manual?.player_id || (ids.length === 1 ? ids[0] : null);
    events.push({
      id: m.game_clip_id,
      kind,
      half: m.half,
      time: m.time,
      player_id: pid,
      confidence: manual ? "manual" : pid ? "source" : "unresolved",
    });
    if (pid && players.has(pid))
      players.get(pid)[kind === "goal" ? "goals" : "assists"]++;
  }
  const list = [...players.values()];
  for (const p of list) {
    const override = manualPlayer
      .filter((c) => c.entity_id === p.id)
      .at(-1)?.value;
    if (override) {
      for (const f of ["field_minutes", "gk_minutes", "goals", "assists"])
        if (Number.isFinite(override[f]) && override[f] >= 0)
          p[f] = override[f];
      if (Number.isFinite(override.minutes)) {
        if (!Number.isFinite(override.field_minutes))
          p.field_minutes = Math.max(0, override.minutes - p.gk_minutes);
        p.explicit_minutes = override.minutes;
      }
      p.confidence = "manual";
    }
  }
  // Allocate tenths by largest remainder so rounding does not create or lose capacity.
  for (const key of ["field_minutes", "gk_minutes"]) {
    const values = list.map((p) => ({
        p,
        raw: p[key] * 10,
        units: Math.floor(p[key] * 10 + 1e-8),
      })),
      targetUnits = Math.round(sum(values.map((v) => v.raw))),
      extra = targetUnits - sum(values.map((v) => v.units));
    values.sort(
      (a, b) =>
        b.raw - b.units - (a.raw - a.units) || a.p.id.localeCompare(b.p.id),
    );
    for (let i = 0; i < values.length; i++)
      values[i].p[key] = (values[i].units + (i < extra ? 1 : 0)) / 10;
  }
  for (const p of list) {
    p.minutes = rounded(p.explicit_minutes ?? p.field_minutes + p.gk_minutes);
    delete p.explicit_minutes;
    p.half_minutes = Object.fromEntries(
      Object.entries(p.half_minutes).map(([k, v]) => [k, rounded(v)]),
    );
  }
  const total = rounded(sum([...players.values()].map((p) => p.minutes))),
    constraints = {
      format,
      match_minutes: rounded(duration),
      target_minutes: target === null ? null : rounded(target),
      assigned_minutes: total,
      unresolved_minutes:
        target === null ? null : rounded(Math.max(0, target - total)),
      over_target: target !== null && total > target + 0.2,
    };
  if (constraints.over_target)
    warnings.push(
      "Player minutes exceed the match capacity. Review corrections.",
    );
  if (constraints.unresolved_minutes > 0.2)
    warnings.push(
      "Some on-field minutes remain unresolved by the saved evidence.",
    );
  const ready =
    trackingComplete &&
    !!format &&
    !constraints.over_target &&
    constraints.unresolved_minutes <= 0.2;
  return {
    players: [...players.values()],
    events,
    constraints,
    warnings: [...new Set(warnings)],
    state: ready ? "estimated" : "partial",
    tracking_complete: trackingComplete,
    analytics_ready: scopes.filter((s) => s.state === "ready").length,
    analytics_restricted: scopes.filter((s) => s.state === "restricted").length,
    own_side: header.own_side,
    season: seasonYear,
    format_confidence: [7, 9].includes(explicit)
      ? "manual"
      : format
        ? "estimated"
        : "unresolved",
  };
}
export async function matchAnalytics(db, fixture, space, canonical = fixture) {
  const own = await db
      .prepare(
        "SELECT st.team_id FROM space_teams st JOIN fixtures f ON f.id=? WHERE st.space_id=? AND st.role<>'followed' AND st.team_id IN (f.home_id,f.away_id) AND st.team_id LIKE 'trace:%' ORDER BY st.team_id LIMIT 1",
      )
      .bind(fixture, space)
      .first(),
    team = own?.team_id || "",
    parts = (
      await db
        .prepare(
          "SELECT * FROM trace_parts WHERE fixture_id=? AND team_id=? ORDER BY part LIMIT 1000",
        )
        .bind(fixture, team)
        .all()
    ).results,
    scopes = (
      await db
        .prepare(
          "SELECT * FROM trace_stats WHERE fixture_id=? AND team_id=? ORDER BY player_id,period LIMIT 200",
        )
        .bind(fixture, team)
        .all()
    ).results,
    corrections = (
      await db
        .prepare(
          "SELECT * FROM corrections WHERE space_id=? AND ((kind='match' AND entity_id IN (?,?)) OR kind IN ('identity','player','season')) ORDER BY CASE WHEN season='' THEN 0 ELSE 1 END",
        )
        .bind(space, fixture, canonical)
        .all()
    ).results.map((c) => ({
      ...c,
      season: c.season === canonical ? fixture : c.season,
      value: parse(c.value),
    }));
  if (!parts.some((p) => p.part === "header"))
    return {
      state: "pending",
      players: [],
      events: [],
      warnings: ["Trace metadata is being collected."],
      scopes: [],
    };
  return {
    ...computeMatch(parts, scopes, corrections),
    scopes: scopes.map((s) => ({ ...s, value: parse(s.value) })),
    parts: parts
      .filter((p) => !p.part.startsWith("moments:"))
      .map((p) => ({ ...p, value: parse(p.value) })),
  };
}
