import { parse } from "../core.js";
export function assessAwards(
  competition,
  fixtures,
  standings,
  ownIds,
  now = Date.now(),
) {
  const result = (state, reason, awards = []) => ({ state, reason, awards });
  if (
    !competition.ends_on ||
    Date.parse(competition.ends_on + "T23:59:59Z") >= now
  )
    return result(
      "pending",
      "Competition is still active or its end date is unpublished.",
    );
  if (!fixtures.length || standings.length < 2)
    return result(
      "pending",
      "Schedule results and final standings have not both been saved.",
    );
  const pools = new Set(standings.map((r) => r.pool_id));
  if (pools.size !== 1)
    return result(
      "unresolved",
      "Multiple pools require a verified championship path.",
    );
  const teams = new Map(
      standings.map((r) => [
        r.team_id,
        { mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 },
      ]),
    ),
    pairs = new Map();
  if (teams.size !== standings.length)
    return result(
      "unresolved",
      "The published table contains duplicate team identities.",
    );
  for (const f of fixtures) {
    if (
      f.conditional ||
      f.status !== "FINAL" ||
      !Number.isFinite(f.home_score) ||
      !Number.isFinite(f.away_score) ||
      !teams.has(f.home_id) ||
      !teams.has(f.away_id) ||
      f.home_id === f.away_id ||
      parse(f.payload).round
    )
      return result(
        "unresolved",
        "A complete round robin cannot be reconciled with the saved results.",
      );
    const pair = [f.home_id, f.away_id].sort().join("/");
    pairs.set(pair, (pairs.get(pair) || 0) + 1);
    for (const [id, forGoals, against] of [
      [f.home_id, f.home_score, f.away_score],
      [f.away_id, f.away_score, f.home_score],
    ]) {
      const c = teams.get(id);
      c.mp++;
      c.gf += forGoals;
      c.ga += against;
      c[forGoals > against ? "w" : forGoals < against ? "l" : "d"]++;
    }
  }
  if (
    pairs.size !== (teams.size * (teams.size - 1)) / 2 ||
    new Set(pairs.values()).size !== 1
  )
    return result(
      "unresolved",
      "The saved results do not cover a balanced full round robin.",
    );
  for (const r of standings) {
    const tally = teams.get(r.team_id),
      source = typeof r.payload === "string" ? parse(r.payload) : r.payload;
    if (Object.keys(tally).some((k) => source[k] !== tally[k]))
      return result(
        "unresolved",
        "Final standings disagree with the saved results.",
      );
  }
  if (
    [1, 2].some((rank) => standings.filter((r) => r.rank === rank).length !== 1)
  )
    return result(
      "unresolved",
      "The final winner and runner-up are not unique.",
    );
  return result(
    "complete",
    "Final standings and the complete round robin reconcile.",
    standings
      .filter((r) => ownIds.includes(r.team_id) && [1, 2].includes(r.rank))
      .map((r) => ({
        title:
          competition.name + " · " + (r.rank === 1 ? "Winner" : "Runner-up"),
        place: r.rank,
        date: competition.ends_on,
        source: "verified_round_robin",
      })),
  );
}
