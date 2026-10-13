import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOpponentName, normalizeVenue, resolveUserGameGroups, resolveScopedGameReference, TEAM_GAME_LIMITS,TEAM_GAME_MANUAL_POLICY,TEAM_GAME_MANUAL_REASONS} from '../src/domain/team-game-resolver.js';

// Independent audit oracle, SHA256 365cf35fd549eec1350a4dd70b4486e199c3bec51cc3246fb5d8e70fcac9c3dd.
// Copied as base + lossless patches: no runtime dependency on /tmp audit files.
// These are PURE core tests, not SQLite projection, read-consumer or browser acceptance.
const ORACLE_BASE = {
  "scope": {
    "app_team": "owner-a",
    "season": "2026",
    "private_account": "ts-account-a",
    "private_team": "ts-team-a",
    "public_team": "live-own-a",
    "active": true,
    "complete": true,
    "overflow": false,
    "timezone": "America/Los_Angeles"
  },
  "ts": {
    "source_id": "teamsnap/account-a/game-a",
    "provider": "teamsnap",
    "type": "game",
    "starts_at": "2026-10-24T17:40:31Z",
    "time_precision": "instant",
    "conditional": false,
    "status": "SCHEDULED",
    "all_day": false,
    "opponent": "Fresno Heat FC U11 Central",
    "opponent_id": "opponent-fresno",
    "orientation_verified": true,
    "own_side": "home",
    "venue": "Kellogg Zaher Sports Complex",
    "field": null
  },
  "public": {
    "source_id": "live/public/game-a",
    "provider": "live",
    "canonical_group": "public-game-a",
    "type": "game",
    "starts_at": "2026-10-24T17:40:00Z",
    "time_precision": "instant",
    "conditional": false,
    "status": "SCHEDULED",
    "all_day": false,
    "opponent": "FRESNO HEAT FC U11 BOYS Central",
    "opponent_id": "live-fresno",
    "own_side": "home",
    "own_identity_verified": true,
    "opponent_real": true,
    "venue": "Kellogg-Zaher Soccer Complex",
    "field": "01 South"
  },
  "candidate_counts": {
    "ts": 1,
    "public": 1
  },
  "owner_decision": null,
  "manual_conflict": false
};
const PAIR_ORACLES = [
  {
    "id": "fresno-31-second-offset",
    "expected": "accepted",
    "patch": {}
  },
  {
    "id": "albion-30-second-offset-unknown-side",
    "expected": "accepted",
    "patch": {
      "ts": {
        "starts_at": "2026-10-24T00:40:30Z",
        "opponent": "Albion SC Las Vegas BU11 Academy",
        "orientation_verified": false
      },
      "public": {
        "starts_at": "2026-10-24T00:40:00Z",
        "opponent": "Albion SC Las Vegas BU11 Academy CM Blue",
        "own_side": "away",
        "field": "07 North"
      }
    }
  },
  {
    "id": "chivas-compact-full-year",
    "expected": "accepted",
    "patch": {
      "ts": {
        "starts_at": "2026-10-25T17:40:00Z",
        "opponent": "Chivas Denver Soccer Academy2016/2017Premier"
      },
      "public": {
        "starts_at": "2026-10-25T17:40:00Z",
        "opponent": "Chivas Denver Soccer Academy 2016/17 Premier",
        "field": "05 South"
      }
    }
  },
  {
    "id": "same-club-explicit-color-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "opponent": "Albion SC Las Vegas BU11 Academy CM Red"
      },
      "public": {
        "opponent": "Albion SC Las Vegas BU11 Academy CM Blue"
      }
    }
  },
  {
    "id": "same-club-explicit-squad-initials-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "opponent": "Albion SC Las Vegas BU11 Academy CM Blue"
      },
      "public": {
        "opponent": "Albion SC Las Vegas BU11 Academy AB Blue"
      }
    }
  },
  {
    "id": "same-club-explicit-age-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "opponent": "Fresno Heat FC U10 Boys Central"
      }
    }
  },
  {
    "id": "same-club-explicit-gender-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "opponent": "Fresno Heat FC U11 Girls Central"
      }
    }
  },
  {
    "id": "overlapping-birthyear-range-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "opponent": "Chivas Denver Soccer Academy 2015/2016 Premier"
      },
      "public": {
        "opponent": "Chivas Denver Soccer Academy 2016/17 Premier"
      }
    }
  },
  {
    "id": "same-club-tier-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "opponent": "Chivas Denver Soccer Academy 2016/17 Elite"
      },
      "public": {
        "opponent": "Chivas Denver Soccer Academy 2016/17 Premier"
      }
    }
  },
  {
    "id": "verified-homeaway-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "own_side": "away"
      }
    }
  },
  {
    "id": "unknown-side-not-conflict",
    "expected": "accepted",
    "patch": {
      "ts": {
        "orientation_verified": false,
        "own_side": "away"
      }
    }
  },
  {
    "id": "exactly-60-seconds",
    "expected": "accepted",
    "patch": {
      "ts": {
        "starts_at": "2026-10-24T17:41:00Z"
      }
    }
  },
  {
    "id": "61-seconds",
    "expected": "review",
    "patch": {
      "ts": {
        "starts_at": "2026-10-24T17:41:01Z"
      }
    }
  },
  {
    "id": "two-hour-reschedule",
    "expected": "review",
    "patch": {
      "ts": {
        "starts_at": "2026-10-24T19:40:00Z"
      }
    }
  },
  {
    "id": "different-local-day",
    "expected": "separate",
    "patch": {
      "ts": {
        "starts_at": "2026-10-25T17:40:00Z"
      }
    }
  },
  {
    "id": "equivalent-timezone-offsets",
    "expected": "accepted",
    "patch": {
      "ts": {
        "starts_at": "2026-10-24T10:40:00-07:00"
      }
    }
  },
  {
    "id": "missing-timezone-offset",
    "expected": "pending",
    "patch": {
      "ts": {
        "starts_at": "2026-10-24T10:40:00"
      }
    }
  },
  {
    "id": "date-only",
    "expected": "pending",
    "patch": {
      "ts": {
        "starts_at": null,
        "time_precision": "day"
      }
    }
  },
  {
    "id": "dst-ambiguous-wall-time",
    "expected": "pending",
    "patch": {
      "ts": {
        "starts_at": "2026-11-01T01:30:00"
      },
      "public": {
        "starts_at": "2026-11-01T08:30:00Z"
      }
    }
  },
  {
    "id": "same-named-venue-field-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "field": "02 South"
      }
    }
  },
  {
    "id": "same-number-field-direction-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "field": "01 North"
      }
    }
  },
  {
    "id": "equivalent-field-leading-zero",
    "expected": "accepted",
    "patch": {
      "ts": {
        "field": "1 South"
      }
    }
  },
  {
    "id": "venue-name-conflict",
    "expected": "review",
    "patch": {
      "ts": {
        "venue": "Ed Fountain Park"
      }
    }
  },
  {
    "id": "generic-venue-only",
    "expected": "pending",
    "patch": {
      "ts": {
        "venue": "Sports Complex"
      },
      "public": {
        "venue": "Soccer Complex"
      }
    }
  },
  {
    "id": "venue-missing",
    "expected": "pending",
    "patch": {
      "ts": {
        "venue": null
      }
    }
  },
  {
    "id": "public-candidate-duplicate",
    "expected": "review",
    "patch": {
      "candidate_counts": {
        "ts": 2
      }
    }
  },
  {
    "id": "teamsnap-candidate-duplicate",
    "expected": "review",
    "patch": {
      "candidate_counts": {
        "public": 2
      }
    }
  },
  {
    "id": "conditional-public-opponent",
    "expected": "separate",
    "patch": {
      "public": {
        "conditional": true,
        "opponent_real": false
      }
    }
  },
  {
    "id": "practice-not-game",
    "expected": "separate",
    "patch": {
      "ts": {
        "type": "practice"
      }
    }
  },
  {
    "id": "all-day",
    "expected": "pending",
    "patch": {
      "ts": {
        "all_day": true
      }
    }
  },
  {
    "id": "postponed-initial",
    "expected": "review",
    "patch": {
      "ts": {
        "status": "POSTPONED"
      }
    }
  },
  {
    "id": "coverage-incomplete",
    "expected": "pending",
    "patch": {
      "scope": {
        "complete": false
      }
    }
  },
  {
    "id": "candidate-bound-overflow",
    "expected": "pending",
    "patch": {
      "scope": {
        "overflow": true
      }
    }
  },
  {
    "id": "connection-revoked",
    "expected": "separate",
    "patch": {
      "scope": {
        "active": false
      }
    }
  },
  {
    "id": "foreign-owner-context",
    "expected": "separate",
    "patch": {
      "scope": {
        "app_team": "owner-b"
      }
    }
  },
  {
    "id": "foreign-private-account",
    "expected": "separate",
    "patch": {
      "scope": {
        "private_account": "ts-account-b"
      }
    }
  },
  {
    "id": "foreign-private-source-team",
    "expected": "separate",
    "patch": {
      "scope": {
        "private_team": "ts-team-b"
      }
    }
  },
  {
    "id": "unknown-public-own-identity",
    "expected": "pending",
    "patch": {
      "public": {
        "own_identity_verified": false
      }
    }
  },
  {
    "id": "explicit-owner-rejection",
    "expected": "separate",
    "patch": {
      "owner_decision": "rejected"
    }
  },
  {
    "id": "two-coach-sessions",
    "expected": "review",
    "patch": {
      "manual_conflict": true
    }
  },
  {
    "id": "unknown-extra-opponent-token",
    "expected": "review",
    "patch": {
      "ts": {
        "opponent": "Fresno Heat FC U11 Central East"
      }
    }
  },
  {
    "id": "authoritative-final-score-conflict",
    "expected": "review",
    "patch": {
      "authoritative_final_score_conflict": true
    }
  },
  {
    "id": "unverified-teamsnap-score-discrepancy",
    "expected": "accepted",
    "patch": {
      "unverified_score_discrepancy": true
    }
  }
];
const LEXICAL_ORACLES = [
  {
    "raw": "Albion SC Las Vegas BU11 Academy CM Blue",
    "stem": "albion sc las vegas academy",
    "age": 11,
    "gender": "boys",
    "initials": "CM",
    "color": "blue"
  },
  {
    "raw": "Albion SC Las Vegas BU11 Academy",
    "stem": "albion sc las vegas academy",
    "age": 11,
    "gender": "boys",
    "initials": null,
    "color": null
  },
  {
    "raw": "Fresno Heat FC U11 Central",
    "stem": "fresno heat fc central",
    "age": 11,
    "gender": null
  },
  {
    "raw": "FRESNO HEAT FC U11 BOYS Central",
    "stem": "fresno heat fc central",
    "age": 11,
    "gender": "boys"
  },
  {
    "raw": "Chivas Denver Soccer Academy2016/2017Premier",
    "stem": "chivas denver soccer academy premier",
    "birth_years": [
      2016,
      2017
    ]
  },
  {
    "raw": "Chivas Denver Soccer Academy 2016/17 Premier",
    "stem": "chivas denver soccer academy premier",
    "birth_years": [
      2016,
      2017
    ]
  }
];
const SET_ORACLES = [
  {
    "id": "doubleheader",
    "description": "Two TS and two public games with same opponents/venue but kickoffs17:40Z and20:40Z; each reciprocal one-to-one.",
    "expected_groups": 2
  },
  {
    "id": "ambiguous-missing-color",
    "description": "Generic TS Albion U11 Academy candidate versus separate Blue and Red public canonical games within60sec at same named venue.",
    "expected": "review_all_three"
  },
  {
    "id": "cross-page-candidate",
    "description": "Unique TS/public counterparts lie on different24-row projector pages.",
    "expected": "accepted_after_complete_scoped_lookup"
  },
  {
    "id": "triangle-ambiguity",
    "description": "A compatible withB, B compatible withC, butA conflicts withC.",
    "expected": "no_transitive_merge"
  },
  {
    "id": "owner-isolation",
    "description": "Two owner teams share same public game. Onlyowner-a has qualifying private calendar observation.",
    "expected": "owner-a_grouped_owner-b_unchanged"
  },
  {
    "id": "refresh-idempotence",
    "description": "Refresh with same sources and newer observation timestamps only.",
    "expected": "same_group_id_source_ids_and_user_state"
  },
  {
    "id": "withdrawn-proof",
    "description": "Accepted prior group now has explicit changed opponent/field/side contradiction.",
    "expected": "review_preserve_all_sources_and_state_no_global_alias"
  },
  {
    "id": "consumer-consistency",
    "description": "Open group from schedule, native public competition link, bookmark and attendance report.",
    "expected": "same_scoped_target_full_authorized_sources_and_correct_stored_bookmark_action"
  },
  {
    "id": "contradictory-candidate-outside-ui-page",
    "description": "Public candidate1 matchesTS. Another concrete same-own-team public game lies within60sec on a later source page but has a different opponent/venue.",
    "expected": "review_all_competing_records_do_not_prefilter_contradiction"
  },
  {
    "id": "public-private-isolation",
    "description": "Accepted owner-a user-game group contains privateTS attendance and publicLive fixture. Open another public team H2H/history.",
    "expected": "public_history_retains_only_native_public_scope_no_private_details"
  }
];
const clone = value => structuredClone(value);
function oracleInput(patch = {}) {
  const input = clone(ORACLE_BASE);
  for (const [key, value] of Object.entries(patch)) input[key] = value && typeof value === 'object' && !Array.isArray(value) ? {...input[key], ...value} : value;
  return input;
}
function snapshot(input = oracleInput()) {
  const scope = input.scope;
  const connections = [
    {id: 'connection-ts', provider: 'teamsnap', account_id: scope.private_account, source_team_id: scope.private_team},
    {id: 'connection-live', provider: 'live', account_id: null, source_team_id: scope.public_team},
  ].map(c => ({...c, app_team_id: scope.app_team, team_season_id: scope.season, active: scope.active, excluded: false, generation: 7, account_generation: 3, membership_generation: 5}));
  const ts = {...input.ts, account_id: 'ts-account-a', source_team_id: 'ts-team-a', connection_id: 'connection-ts', connection_generation: 7, account_generation: 3, membership_generation: 5, provenance: 'provider',
    participants: [{source_team_id: 'ts-team-a', side: input.ts.own_side, real: true}]};
  const pub = {...input.public, connection_id: 'connection-live', connection_generation: 7, account_generation: 3, membership_generation: 5, provenance: 'provider',
    participants: input.public.own_identity_verified ? [{source_team_id: 'live-own-a', side: input.public.own_side, real: true}, {source_team_id: input.public.opponent_id, side: input.public.own_side === 'home' ? 'away' : 'home', real: input.public.opponent_real}] : []};
  const args = {teamId: 'owner-a', seasonId: '2026', timezone: scope.timezone,
    connectionSnapshot: {teamId: scope.app_team, seasonId: scope.season, revision: 12, connections},
    sourceSnapshot: {teamId: scope.app_team, seasonId: scope.season, revision: 34, connection_revision: 12, complete: scope.complete, overflow: scope.overflow,
      windows: [{from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z'}], events: [ts, pub], coverage: connections.map(c => ({id: `coverage-${c.id}`, connection_id: c.id, provider: c.provider, source_team_id: c.source_team_id, generation: 7, source_revision: 34, complete: true,
        from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z'}))},
    canonicalGroups: [{event_id: 'native-ts-game-a', source_ids: [ts.source_id], established: true}, {event_id: input.public.canonical_group, source_ids: [pub.source_id], established: true}],
    previousPublishedGroups: [], ownerDecisions: [], manualState: []};
  // Counts from the oracle are realized as actual observations. The resolver
  // computes its neighborhood independently and never receives candidate counts.
  if (input.candidate_counts.ts > 1) addPublic(args, {...pub, source_id: 'live/public/game-b'}, 'public-game-b');
  if (input.candidate_counts.public > 1) addTeamSnap(args, {...ts, source_id: 'teamsnap/account-a/game-b'}, 'native-ts-game-b');
  if (input.owner_decision) args.ownerDecisions.push({type: 'pair', teamId: args.teamId, seasonId: args.seasonId, decision: input.owner_decision, source_ids: [ts.source_id, pub.source_id]});
  if (input.manual_conflict) args.manualState.push(
    {teamId: args.teamId, seasonId: args.seasonId, event_id: 'native-ts-game-a', kind: 'coach_session', state_id: 'coach-ts'},
    {teamId: args.teamId, seasonId: args.seasonId, event_id: input.public.canonical_group, kind: 'coach_session', state_id: 'coach-public'});
  if (input.authoritative_final_score_conflict || input.unverified_score_discrepancy) {
    Object.assign(ts, {home_score: 2, away_score: 1, result_authority: input.authoritative_final_score_conflict ? 'official' : 'reported', result_verified: !!input.authoritative_final_score_conflict, result_final: !!input.authoritative_final_score_conflict});
    Object.assign(pub, {home_score: 4, away_score: 0, result_authority: 'official', result_verified: true, result_final: true});
  }
  return args;
}
function addPublic(args, event, eventId) {
  args.sourceSnapshot.events.push(event); args.canonicalGroups.push({event_id: eventId, source_ids: [event.source_id], established: true});
}
function addTeamSnap(args, event, eventId) { addPublic(args, event, eventId); }
function pairFor(result, tsId = ORACLE_BASE.ts.source_id, pubId = ORACLE_BASE.public.source_id) {
  return result.assessments.find(p => p.source_ids.includes(tsId) && p.source_ids.includes(pubId));
}
function durableRecord(args, group) {
  const event = args.sourceSnapshot.events.find(e => group.source_ids.includes(e.source_id) && e.provider !== 'teamsnap');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: args.timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(event.starts_at)).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return {accepted_season_id: args.seasonId, starts_at: event.starts_at, local_day: day, effective_day: day, type: 'team_game_association', association_id: 'association-1', revision: 1, teamId: args.teamId, seasonId: args.seasonId, decision: 'accepted', event_id: group.event_id, source_ids: [...group.source_ids],
    scope_refs: group.source_ids.map(id => { const e = args.sourceSnapshot.events.find(e => e.source_id === id), c = args.connectionSnapshot.connections.find(c => c.basis === 'legacy_attachment' ? c.attachment_id === e.attachment_id : c.id === e.connection_id); return {source_id: id, connection_id: c.basis === 'legacy_attachment' ? null : c.id, attachment_id: c.attachment_id ?? null, attachment_generation: c.attachment_generation ?? null, account_id: c.account_id ?? null, source_team_id: c.source_team_id, entitlement_kind: c.basis ?? 'root'}; })};
}
function accepted(result) { return result.groups.filter(g => g.decision === 'accepted'); }
function deepFreeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }

for (const oracle of LEXICAL_ORACLES) test(`lexical oracle: ${oracle.raw}`, () => {
  const actual = normalizeOpponentName(oracle.raw);
  for (const [key, value] of Object.entries(oracle)) assert.deepEqual(actual[key], value, key);
});
for (const oracle of PAIR_ORACLES) test(`pair oracle: ${oracle.id}`, async () => {
  const args = snapshot(oracleInput(oracle.patch)), before = clone(args);
  deepFreeze(args);
  const result = await resolveUserGameGroups(args), pair = pairFor(result);
  assert.ok(pair, 'actual pair was assessed');
  assert.equal(pair.decision, oracle.expected, JSON.stringify(pair.reasons));
  assert.deepEqual(args, before, 'resolver did not mutate native evidence, IDs, decisions or state');
  assert.ok(pair.evidence.source_content.every(s => /^[a-f0-9]{64}$/.test(s.content_hash)));
  if (oracle.expected === 'accepted') {
    assert.equal(accepted(result).length, 1);
    assert.equal(accepted(result)[0].event_id, 'native-ts-game-a');
    assert.deepEqual(accepted(result)[0].source_ids, [ORACLE_BASE.public.source_id, ORACLE_BASE.ts.source_id]);
    assert.equal(pair.evidence.coverage.length, 2);
    assert.equal(pair.evidence.venues[0].field_evidence, oracle.id === 'equivalent-field-leading-zero' ? 'agreement' : 'one_sided');
  } else assert.equal(accepted(result).length, 0);
  if (oracle.id === 'unverified-teamsnap-score-discrepancy') {
    assert.equal(pair.evidence.results.unverified_discrepancy, true);
    assert.equal(pair.evidence.results.official_results.length, 1);
    assert.equal(pair.evidence.results.official_results[0].source_id, ORACLE_BASE.public.source_id);
  }
  if (oracle.id === 'albion-30-second-offset-unknown-side') {
    assert.equal(pair.evidence.time[0].local_day, '2026-10-23');
    assert.equal(pair.evidence.time[0].delta_ms, 30_000);
    assert.ok(pair.evidence.uncertainties.some(u => u.startsWith('unknown_orientation:')));
  }
});

const setImplementations = {
  async doubleheader() {
    const args = snapshot(), [ts, pub] = args.sourceSnapshot.events;
    addTeamSnap(args, {...ts, source_id: `${ts.source_id}-second`, starts_at: '2026-10-24T20:40:31Z'}, 'ts-second');
    addPublic(args, {...pub, source_id: `${pub.source_id}-second`, starts_at: '2026-10-24T20:40:00Z'}, 'public-second');
    const result = await resolveUserGameGroups(args);
    assert.equal(accepted(result).length, 2);
    assert.ok(accepted(result).every(g => g.source_ids.length === 2));
  },
  async 'ambiguous-missing-color'() {
    const args = snapshot(oracleInput(PAIR_ORACLES.find(c => c.id === 'albion-30-second-offset-unknown-side').patch));
    const pub = args.sourceSnapshot.events[1];
    addPublic(args, {...pub, source_id: 'live/red', opponent: pub.opponent.replace('Blue', 'Red')}, 'public-red');
    const result = await resolveUserGameGroups(args);
    assert.equal(result.groups.length, 3); assert.equal(accepted(result).length, 0);
    assert.ok(result.groups.every(g => g.decision === 'review'));
  },
  async 'cross-page-candidate'() {
    const args = snapshot(), [ts, pub] = args.sourceSnapshot.events;
    // Twenty-four unrelated rows separate the counterparts in a simulated scan.
    for (let n = 0; n < 24; n++) addPublic(args, {...pub, source_id: `live/page-fill-${n}`, starts_at: `2026-09-${String(n + 1).padStart(2, '0')}T12:00:00Z`}, `page-fill-${n}`);
    args.sourceSnapshot.events = [ts, ...args.sourceSnapshot.events.slice(2), pub];
    const incomplete = clone(args); incomplete.sourceSnapshot.complete = false;
    assert.equal(pairFor(await resolveUserGameGroups(incomplete)).decision, 'pending');
    const result = await resolveUserGameGroups(args);
    assert.equal(pairFor(result).decision, 'accepted'); assert.equal(accepted(result).length, 1);
  },
  async 'triangle-ambiguity'() {
    const args = snapshot(), [ts] = args.sourceSnapshot.events;
    addTeamSnap(args, {...ts, source_id: 'teamsnap/account-a/other', starts_at: '2026-10-24T17:39:30Z'}, 'ts-other');
    const result = await resolveUserGameGroups(args);
    assert.equal(accepted(result).length, 0); assert.equal(result.groups.length, 3);
    assert.ok(result.groups.every(g => g.decision === 'review'));
  },
  async 'owner-isolation'() {
    const a = await resolveUserGameGroups(snapshot()); assert.equal(accepted(a).length, 1);
    const b = snapshot(); b.teamId = 'owner-b'; b.connectionSnapshot.teamId = b.sourceSnapshot.teamId = 'owner-b';
    b.connectionSnapshot.connections.forEach(c => c.app_team_id = 'owner-b');
    b.connectionSnapshot.connections = b.connectionSnapshot.connections.filter(c => c.provider !== 'teamsnap');
    b.sourceSnapshot.events = b.sourceSnapshot.events.filter(e => e.provider !== 'teamsnap');
    b.canonicalGroups = b.canonicalGroups.filter(g => g.event_id === 'public-game-a');
    b.previousPublishedGroups = a.groups;
    const result = await resolveUserGameGroups(b);
    assert.equal(result.groups.length, 1); assert.equal(result.groups[0].event_id, 'public-game-a');
    assert.deepEqual(result.groups[0].source_ids, [ORACLE_BASE.public.source_id]);
    assert.equal(resolveScopedGameReference({teamId: 'owner-b', seasonId: '2026', groups: a.groups, reference: ORACLE_BASE.public.source_id}), null);
  },
  async 'refresh-idempotence'() {
    const args = snapshot(); args.manualState.push({teamId: 'owner-a', seasonId: '2026', event_id: 'public-game-a', state_id: 'note-1', kind: 'note', text: 'Keep this'});
    const first = await resolveUserGameGroups(args);
    assert.equal(first.groups[0].event_id, 'public-game-a');
    args.previousPublishedGroups = first.groups;
    args.sourceSnapshot.events.forEach(e => e.observed_at = '2026-10-13T04:00:00Z');
    const next = await resolveUserGameGroups(args);
    assert.deepEqual(next.groups, first.groups); assert.equal(next.proof_hash, first.proof_hash);
    assert.deepEqual(next.groups[0].state_refs.map(s => s.state_id), args.manualState.map(s => s.state_id));
  },
  async 'withdrawn-proof'() {
    const args = snapshot(); args.manualState.push({teamId: 'owner-a', seasonId: '2026', event_id: 'native-ts-game-a', state_id: 'note-1', kind: 'note', text: 'Keep this'});
    const first = await resolveUserGameGroups(args); args.previousPublishedGroups = first.groups; args.acceptedAssociations = [durableRecord(args, first.groups[0])];
    args.sourceSnapshot.events[0].field = '2 North';
    const next = await resolveUserGameGroups(args);
    assert.equal(accepted(next).length, 0); assert.equal(next.groups.length, 1);
    assert.equal(next.groups[0].event_id, first.groups[0].event_id); assert.equal(next.groups[0].decision, 'review');
    assert.equal(next.groups[0].previous_proof_withdrawn, true); assert.deepEqual(next.groups[0].source_ids, first.groups[0].source_ids);
    assert.deepEqual(next.groups[0].state_refs.map(s => s.state_id), args.manualState.map(s => s.state_id)); assert.notEqual(next.proof_hash, first.proof_hash);
    assert.ok(!('aliases' in next));
  },
  async 'consumer-consistency'() {
    // Pure lookup contract only: no existing application consumer is integrated.
    const result = await resolveUserGameGroups(snapshot()), expected = result.groups[0];
    for (const reference of [expected.event_id, 'public-game-a', ...expected.source_ids]) {
      const resolved = resolveScopedGameReference({teamId: 'owner-a', seasonId: '2026', groups: result.groups, reference, storedBookmarkKey: 'original-stored-native-bookmark'});
      assert.equal(resolved.event_id, expected.event_id); assert.deepEqual(resolved.source_ids, expected.source_ids);
      assert.equal(resolved.stored_bookmark_key, 'original-stored-native-bookmark');
    }
  },
  async 'contradictory-candidate-outside-ui-page'() {
    const args = snapshot(), pub = args.sourceSnapshot.events[1];
    for (let n = 0; n < 24; n++) addPublic(args, {...pub, source_id: `live/filler-${n}`, starts_at: `2026-09-${String(n + 1).padStart(2, '0')}T12:00:00Z`}, `filler-${n}`);
    addPublic(args, {...pub, source_id: 'live/late-page-conflict', opponent: 'Different United U12 Girls', venue: 'Ed Fountain Park'}, 'late-page-conflict');
    const result = await resolveUserGameGroups(args);
    assert.equal(accepted(result).length, 0);
    for (const id of [ORACLE_BASE.ts.source_id, pub.source_id, 'live/late-page-conflict']) assert.equal(result.groups.find(g => g.source_ids.includes(id)).decision, 'review');
    assert.equal(pairFor(result).evidence.reciprocal_candidate_counts.teamsnap, 2);
  },
  async 'public-private-isolation'() {
    const args = snapshot(), initial = clone(args), result = await resolveUserGameGroups(args);
    assert.equal(resolveScopedGameReference({teamId: 'owner-a', seasonId: '2026', groups: result.groups, reference: 'public-game-a', audience: 'public'}), null);
    assert.equal(resolveScopedGameReference({teamId: 'owner-a', seasonId: '2025', groups: result.groups, reference: 'public-game-a'}), null);
    assert.deepEqual(args.canonicalGroups, initial.canonicalGroups);
    assert.deepEqual(args.sourceSnapshot, initial.sourceSnapshot);
  },
};
for (const oracle of SET_ORACLES) test(`set/lifecycle oracle (pure core): ${oracle.id}`, async () => {
  assert.equal(typeof setImplementations[oracle.id], 'function'); await setImplementations[oracle.id]();
});

test('oracle inventory is exactly 43 pair, 10 set/lifecycle and 6 lexical cases', () => {
  assert.equal(PAIR_ORACLES.length, 43); assert.equal(SET_ORACLES.length, 10); assert.equal(LEXICAL_ORACLES.length, 6);
});
test('venue lexical rule retains kind, named words, field number and direction', () => {
  assert.equal(normalizeVenue('Kellogg-Zaher Soccer Complex #07 North').name, 'kellogg zaher complex');
  assert.equal(normalizeVenue('Kellogg-Zaher Soccer Complex #07 North').field, '7 north');
  assert.equal(normalizeVenue('Kellogg Zaher Sports Complex Field 7 South').field, '7 south');
  assert.equal(normalizeVenue('Sports Complex').distinctive, false);
  assert.notEqual(normalizeVenue('Kellogg Zaher Park').name, normalizeVenue('Kellogg Zaher Complex').name);
});
test('lexical parsing retains unknown words, gender absence and Unicode equivalence', () => {
  assert.equal(normalizeOpponentName('Fresnó Heat FC U11BOYS Central').stem, 'fresno heat fc central');
  assert.equal(normalizeOpponentName('Fresno Heat FC U11 Central').gender, null);
  assert.equal(normalizeOpponentName('Fresno Heat FC U11 Central East').stem, 'fresno heat fc central east');
  assert.deepEqual(normalizeOpponentName('Academy 2017/18 Premier').birth_years, [2017, 2018]);
});
test('source revision and connection generation fences fail closed', async () => {
  for (const mutate of [a => a.sourceSnapshot.connection_revision++, a => a.sourceSnapshot.events[0].connection_generation++, a => a.sourceSnapshot.coverage[0].source_revision++, a => a.sourceSnapshot.coverage[0].to = '2026-10-24T17:40:45Z']) {
    const args = snapshot(); mutate(args); assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'pending');
  }
});
test('invalid timezone, calendar instant and source provenance remain pending', async () => {
  for (const mutate of [a => a.timezone = 'Mars/Olympus', a => a.sourceSnapshot.events[0].starts_at = '2026-02-30T17:40:00Z', a => a.sourceSnapshot.events[0].provenance = 'imported']) {
    const args = snapshot(); mutate(args); assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'pending');
  }
});
test('public group checks all official members, not a convenient matching member', async () => {
  const args = snapshot(), [ts, live] = args.sourceSnapshot.events;
  const gs = {...clone(live), source_id: 'gotsport/public/game', provider: 'gotsport', connection_id: 'connection-gs', opponent: 'Fresno Heat FC U11 Girls Central'};
  args.connectionSnapshot.connections.push({...args.connectionSnapshot.connections[1], id: 'connection-gs', provider: 'gotsport'});
  args.sourceSnapshot.coverage.push({...args.sourceSnapshot.coverage[1], id: 'coverage-gs', connection_id: 'connection-gs', provider: 'gotsport'});
  args.sourceSnapshot.events.push(gs); args.canonicalGroups[1].source_ids.push(gs.source_id);
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'review');
  gs.opponent = live.opponent;
  Object.assign(live, {home_score: 2, away_score: 1, result_authority: 'official', result_verified: true, result_final: true});
  Object.assign(gs, {home_score: 1, away_score: 2, result_authority: 'official', result_verified: true, result_final: true});
  assert.ok(pairFor(await resolveUserGameGroups(args)).reasons.includes('authoritative_final_score_conflict'));
  assert.equal(ts.result_final, undefined);
});
test('same-provider public members cannot be collapsed inside one canonical group', async () => {
  const args = snapshot(), duplicate = {...args.sourceSnapshot.events[1], source_id: 'live/other'};
  args.sourceSnapshot.events.push(duplicate); args.canonicalGroups[1].source_ids.push(duplicate.source_id);
  assert.ok(pairFor(await resolveUserGameGroups(args)).reasons.includes('same_provider_group_collision'));
});
test('revocation never exposes old private sources and preserves state hold references', async () => {
  const args = snapshot(); args.manualState.push({teamId: 'owner-a', seasonId: '2026', event_id: 'native-ts-game-a', state_id: 'coach-original', kind: 'coach_session'});
  args.previousPublishedGroups = (await resolveUserGameGroups(args)).groups;
  args.connectionSnapshot.connections[0].active = false;
  const result = await resolveUserGameGroups(args);
  assert.ok(result.groups.every(g => !g.source_ids.includes(ORACLE_BASE.ts.source_id)));
  assert.equal(result.state_holds[0].state_refs[0].state_id, 'coach-original');
  const publicRef = resolveScopedGameReference({teamId: 'owner-a', seasonId: '2026', groups: result.groups, reference: 'public-game-a'});
  assert.deepEqual(publicRef.source_ids, [ORACLE_BASE.public.source_id]);
});
test('explicit owner split is respected while unsafe state movement is held', async () => {
  const args = snapshot(); args.previousPublishedGroups = (await resolveUserGameGroups(args)).groups;
  args.ownerDecisions.push({teamId: 'owner-a', seasonId: '2026', type: 'pair', decision: 'unlinked', source_ids: args.previousPublishedGroups[0].source_ids});
  const result = await resolveUserGameGroups(args);
  assert.equal(result.groups.length, 2); assert.equal(accepted(result).length, 0);
  assert.equal(result.state_holds[0].reason, 'owner_split_requires_state_resolution');
});
test('opponent mapping is scoped and cannot override a different independent gate', async () => {
  const args = snapshot(), ts = args.sourceSnapshot.events[0], pub = args.sourceSnapshot.events[1];
  ts.opponent = 'Different Club U11 Central';
  args.ownerDecisions.push({teamId: 'owner-a', seasonId: '2026', type: 'opponent_mapping', id: 'mapping-1', valid: true, account_id: ts.account_id, source_team_id: ts.source_team_id,
    private_opponent_id: ts.opponent_id, public_provider: 'live', public_opponent_id: pub.opponent_id});
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'accepted');
  ts.venue = 'Different Stadium'; assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'review');
  ts.venue = ORACLE_BASE.ts.venue; args.ownerDecisions[0].account_id = 'foreign-account';
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'review');
});
test('Trace and followed-team data never become inferred source membership', async () => {
  const args = snapshot();
  addPublic(args, {...args.sourceSnapshot.events[0], source_id: 'trace/private/game', provider: 'trace'}, 'trace-canonical');
  const result = await resolveUserGameGroups(args);
  assert.equal(accepted(result).length, 1); assert.ok(!accepted(result)[0].source_ids.includes('trace/private/game'));
  args.connectionSnapshot.connections[0].followed = true;
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'separate');
});
test('input order does not select a winner or change accepted identity', async () => {
  const args = snapshot(), before = await resolveUserGameGroups(args);
  args.sourceSnapshot.events.reverse(); args.canonicalGroups.reverse(); args.connectionSnapshot.connections.reverse(); args.sourceSnapshot.coverage.reverse();
  assert.deepEqual(await resolveUserGameGroups(args), before);
});
test('a missing-time competitor cannot disappear from the uniqueness universe', async () => {
  const args = snapshot(), pub = args.sourceSnapshot.events[1];
  addPublic(args, {...pub, source_id: 'live/time-missing', starts_at: null, time_precision: 'day'}, 'time-missing');
  const result = await resolveUserGameGroups(args);
  assert.equal(accepted(result).length, 0);
  assert.ok(pairFor(result).reasons.includes('reciprocal_candidate_collision'));
});
test('malformed canonical membership cannot create two accepted groups for one target', async () => {
  const args = snapshot(), pub = args.sourceSnapshot.events[1];
  addPublic(args, {...pub, source_id: 'live/duplicate-target'}, 'public-game-a');
  const result = await resolveUserGameGroups(args);
  assert.equal(accepted(result).length, 0);
  assert.ok(pairFor(result).reasons.includes('canonical_target_ambiguous'));
});
test('missing canonical source evidence blocks complete-scope acceptance', async () => {
  const args = snapshot(); args.canonicalGroups.push({event_id: 'missing-public-group', source_ids: ['live/unloaded'], established: true});
  const result = await resolveUserGameGroups(args);
  assert.equal(pairFor(result).decision, 'pending');
  assert.ok(pairFor(result).reasons.includes('canonical_member_evidence_missing'));
});
test('a new pairing cannot orphan state on a previously accepted different target', async () => {
  const args = snapshot();
  args.manualState.push({teamId: 'owner-a', seasonId: '2026', event_id: 'public-game-a', kind: 'note', state_id: 'original-note'});
  args.previousPublishedGroups = (await resolveUserGameGroups(args)).groups;
  args.acceptedAssociations = [durableRecord(args, args.previousPublishedGroups[0])];
  const pub = args.sourceSnapshot.events[1];
  addPublic(args, {...pub, source_id: 'live/new-counterpart'}, 'public-new-counterpart');
  pub.starts_at = '2026-10-24T20:40:00Z';
  const result = await resolveUserGameGroups(args);
  assert.equal(accepted(result).length, 0);
  assert.ok(result.assessments.some(p => p.reasons.includes('previous_group_membership_conflict')));
  assert.equal(result.groups.find(g => g.source_ids.includes(ORACLE_BASE.ts.source_id)).event_id, 'public-game-a');
});
test('account and membership generations are required evidence and fenced', async () => {
  for (const field of ['account_generation', 'membership_generation']) {
    const args = snapshot(); args.sourceSnapshot.events[0][field]++;
    assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'pending');
    const baseline = snapshot(), first = await resolveUserGameGroups(baseline);
    baseline.connectionSnapshot.connections[0][field]++;
    assert.notEqual((await resolveUserGameGroups(baseline)).fence.connection_snapshot_hash, first.fence.connection_snapshot_hash);
  }
});
test('color words within club stems are not silently removed as squad suffixes', async () => {
  assert.equal(normalizeOpponentName('Red Bull FC U11').stem, 'red bull fc');
  assert.equal(normalizeOpponentName('Blue Angels U11').stem, 'blue angels');
  const args = snapshot(); args.sourceSnapshot.events[0].opponent = 'Red Bull FC U11'; args.sourceSnapshot.events[1].opponent = 'Bull FC U11';
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'review');
});
test('revoked private contents are not emitted inside evidence on the public row', async () => {
  const args = snapshot(); args.connectionSnapshot.connections[0].active = false;
  args.sourceSnapshot.events[0].opponent = 'PRIVATE SECRET OPPONENT'; args.sourceSnapshot.events[0].venue = 'PRIVATE SECRET VENUE';
  const result = await resolveUserGameGroups(args), json = JSON.stringify(result);
  assert.equal(pairFor(result).decision, 'separate');
  assert.ok(!json.includes('PRIVATE SECRET'));
  assert.ok(result.assessments.every(p => p.evidence.restricted && !p.evidence.names && !p.evidence.venues));
});
test('an active entitled connection with missing coverage invalidates the full universe', async () => {
  const args = snapshot();
  args.connectionSnapshot.connections.push({...args.connectionSnapshot.connections[1], id: 'another-live-connection', source_team_id: 'another-own-team'});
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'pending');
});
test('public opponent must be the unique real opposite participant', async () => {
  for (const mutate of [p => p.participants.pop(), p => p.participants[1].real = false, p => p.participants[1].source_team_id = 'contradictory-opponent']) {
    const args = snapshot(); mutate(args.sourceSnapshot.events[1]);
    assert.notEqual(pairFor(await resolveUserGameGroups(args)).decision, 'accepted');
  }
});
test('partially consuming a multi-source private native group cannot duplicate targets', async () => {
  const args = snapshot(), ts = {...args.sourceSnapshot.events[0], source_id: 'teamsnap/second-native', starts_at: '2026-10-24T20:40:00Z'};
  args.sourceSnapshot.events.push(ts); args.canonicalGroups[0].source_ids.push(ts.source_id);
  const result = await resolveUserGameGroups(args);
  assert.equal(accepted(result).length, 0);
  assert.equal(new Set(result.groups.map(g => g.event_id)).size, result.groups.length);
});
test('bare geographic or unknown uppercase suffixes are never guessed away', async () => {
  assert.equal(normalizeOpponentName('SAN FRANCISCO BAY U11').stem, 'san francisco bay');
  assert.equal(normalizeOpponentName('Albion Academy U11 CM').stem, 'albion academy cm');
  const args = snapshot(); args.sourceSnapshot.events[0].opponent = 'SAN FRANCISCO BAY U11'; args.sourceSnapshot.events[1].opponent = 'San Francisco U11';
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'review');
});
test('unknown orientation retains raw reported score and visible orientation-invariant discrepancy', async () => {
  const args = snapshot(), [ts, pub] = args.sourceSnapshot.events;
  Object.assign(ts, {orientation_verified: false, home_score: 0, away_score: 9, result_authority: 'reported'});
  Object.assign(pub, {home_score: 1, away_score: 2, result_authority: 'official', result_verified: true, result_final: true});
  const pair = pairFor(await resolveUserGameGroups(args));
  assert.equal(pair.decision, 'accepted'); assert.equal(pair.evidence.results.unverified_discrepancy, true);
  assert.deepEqual(pair.evidence.results.unoriented_results[0], {source_id: ts.source_id, home_score: 0, away_score: 9, orientation_verified: false, asserted_authority: 'reported', asserted_final: false});
});
test('cancelled status is normalized and an unproven private target cannot be selected', async () => {
  const args = snapshot(); args.sourceSnapshot.events[0].status = ' cancelled ';
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'review');
  const unproven = snapshot(); unproven.canonicalGroups[0].established = false;
  assert.equal(pairFor(await resolveUserGameGroups(unproven)).decision, 'pending');
});
test('one-sided or empty scopes still report incomplete coverage and fence failures', async () => {
  for (const mutate of [a => a.sourceSnapshot.complete = false, a => a.sourceSnapshot.overflow = true, a => a.sourceSnapshot.connection_revision++, a => a.sourceSnapshot.windows = []]) {
    const args = snapshot(); args.sourceSnapshot.events.pop(); args.canonicalGroups.pop(); mutate(args);
    const result = await resolveUserGameGroups(args);
    assert.equal(result.pending, true); assert.equal(result.groups[0].decision, 'pending'); assert.ok(result.reasons.length);
  }
});
test('typed proof overflow never produces a truncated accepted association', async () => {
  const args = snapshot(), giantName = 'Fresno ' + 'Distinctive '.repeat(1800);
  args.sourceSnapshot.events.forEach(e => e.opponent = giantName);
  const result = await resolveUserGameGroups(args), pair = pairFor(result);
  assert.equal(pair.decision, 'pending'); assert.ok(pair.reasons.includes('proof_bound_exceeded'));
  assert.equal(pair.evidence.overflow, true); assert.ok(pair.evidence.original_bytes > TEAM_GAME_LIMITS.max_proof_bytes);
  assert.equal(accepted(result).length, 0);
});
test('accepted evidence stays under the explicit typed-proof bound', async () => {
  const result = await resolveUserGameGroups(snapshot());
  assert.ok(Buffer.byteLength(JSON.stringify(pairFor(result))) <= TEAM_GAME_LIMITS.max_proof_bytes);
});
test('fetch disconnection does not revoke explicit saved-domain entitlement', async () => {
  const args = snapshot(); args.connectionSnapshot.connections[0].account_active = false;
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'accepted');
  Object.assign(args.connectionSnapshot.connections[0], {basis: 'legacy_attachment', attachment_id: 'attachment-ts', attachment_generation: 7, membership_generation: null});
  Object.assign(args.sourceSnapshot.events[0], {connection_id: null, attachment_id: 'attachment-ts', attachment_generation: 7, membership_generation: null});
  Object.assign(args.sourceSnapshot.coverage[0], {connection_id: null, attachment_id: 'attachment-ts', attachment_generation: 7});
  const pair = pairFor(await resolveUserGameGroups(args));
  assert.equal(pair.decision, 'accepted');
  assert.equal(pair.own_sides.find(s => s.source_id === ORACLE_BASE.ts.source_id).scope_basis, 'legacy_attachment');
});
test('large season Cartesian inputs fail closed rather than accepting a bounded prefix', async () => {
  const args = snapshot(), [ts, pub] = args.sourceSnapshot.events;
  for (let i = 1; i < 33; i++) {
    addTeamSnap(args, {...ts, source_id: `teamsnap/large-${i}`}, `ts-large-${i}`);
    addPublic(args, {...pub, source_id: `live/large-${i}`}, `public-large-${i}`);
  }
  const result = await resolveUserGameGroups(args);
  assert.ok(result.candidate_counts.pairs > TEAM_GAME_LIMITS.max_pairs);
  assert.equal(result.pending, true); assert.equal(accepted(result).length, 0);
  assert.ok(result.reasons.includes('candidate_pair_bound_exceeded'));
  assert.equal(result.groups.length, 66);
});
test('duplicate canonical targets are quarantined instead of returning duplicate publishable rows', async () => {
  const args = snapshot(), pub = args.sourceSnapshot.events[1];
  addPublic(args, {...pub, source_id: 'live/ambiguous-target'}, 'public-game-a');
  const result = await resolveUserGameGroups(args);
  assert.equal(new Set(result.groups.map(g => g.event_id)).size, result.groups.length);
  assert.equal(result.review_records.filter(g => g.publishable === false).length, 2);
  assert.equal(result.state_holds.find(g => g.event_id === 'public-game-a').reason, 'canonical_target_ambiguous');
});
test('new scan receipt IDs and observation times preserve semantic grouping proof', async () => {
  const args = snapshot(), first = await resolveUserGameGroups(args);
  args.sourceSnapshot.coverage.forEach(c => { c.id += '-new-receipt'; c.observed_at = '2026-10-13T12:00:00Z'; });
  args.sourceSnapshot.events.forEach(e => e.observed_at = '2026-10-13T12:00:00Z');
  const next = await resolveUserGameGroups(args);
  assert.equal(next.semantic_hash, first.semantic_hash);
  assert.notEqual(next.proof_hash, first.proof_hash, 'exact receipt proof remains auditable');
});
test('previous publication alone never authorizes retaining an invalid mixed-source group', async () => {
  const args = snapshot(); args.manualState.push({teamId: 'owner-a', seasonId: '2026', event_id: 'native-ts-game-a', kind: 'note', state_id: 'saved-note'});
  args.previousPublishedGroups = (await resolveUserGameGroups(args)).groups;
  args.sourceSnapshot.events[0].starts_at = '2026-10-24T19:40:00Z';
  const result = await resolveUserGameGroups(args);
  assert.equal(result.groups.length, 2); assert.equal(accepted(result).length, 0);
  assert.ok(result.groups.every(g => g.source_ids.length === 1));
  assert.equal(result.state_holds[0].reason, 'durable_acceptance_unproven');
  assert.equal(result.state_holds[0].state_refs[0].state_id, 'saved-note');
});
test('typed durable prior acceptance permits review retention but never bypasses current gates', async () => {
  const args = snapshot(), first = await resolveUserGameGroups(args);
  args.previousPublishedGroups = first.groups; args.acceptedAssociations = [durableRecord(args, first.groups[0])];
  args.sourceSnapshot.events[0].starts_at = '2026-10-24T19:40:00Z';
  const retained = await resolveUserGameGroups(args);
  assert.equal(retained.groups.length, 1); assert.equal(retained.groups[0].decision, 'review');
  assert.deepEqual(retained.groups[0].retained_association, {association_id: 'association-1', revision: 1});
  assert.equal(accepted(retained).length, 0);
  args.acceptedAssociations[0].scope_refs[0].connection_id = 'different-root';
  const invalid = await resolveUserGameGroups(args);
  assert.equal(invalid.groups.length, 2); assert.equal(invalid.state_holds[0].reason, 'durable_acceptance_unproven');
});
test('owner pair rejection survives season change while other-team decisions remain isolated', async () => {
  const args = snapshot(); args.ownerDecisions.push({type: 'pair', teamId: 'owner-a', seasonId: '2025', decision: 'rejected', source_ids: args.sourceSnapshot.events.map(e => e.source_id)});
  assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'separate');
  args.ownerDecisions[0].teamId = 'owner-b'; assert.equal(pairFor(await resolveUserGameGroups(args)).decision, 'accepted');
});
test('global source revisions do not churn semantic proof, but coverage semantics do', async () => {
  const args = snapshot(), first = await resolveUserGameGroups(args);
  args.sourceSnapshot.revision++; args.sourceSnapshot.coverage.forEach(c => c.source_revision++);
  const refreshed = await resolveUserGameGroups(args);
  assert.equal(refreshed.semantic_hash, first.semantic_hash); assert.notEqual(refreshed.proof_hash, first.proof_hash);
  args.sourceSnapshot.coverage.forEach(c => c.from = '2025-12-31T00:00:00Z');
  assert.notEqual((await resolveUserGameGroups(args)).semantic_hash, first.semantic_hash);
});
function bridgedSnapshot(rootProvider, observedProvider) {
  const args = snapshot(), c = args.connectionSnapshot.connections[1], e = args.sourceSnapshot.events[1], coverage = args.sourceSnapshot.coverage[1];
  Object.assign(c, {id: 'public-root', provider: rootProvider, source_team_id: `${rootProvider}-root-own`});
  Object.assign(e, {provider: observedProvider, connection_id: c.id, opponent_id: `${observedProvider}-opponent`});
  e.participants = [{source_team_id: `${observedProvider}-observed-own`, side: 'home', real: true}, {source_team_id: e.opponent_id, side: 'away', real: true}];
  Object.assign(coverage, {connection_id: c.id, provider: rootProvider, source_team_id: c.source_team_id});
  args.connectionSnapshot.aliases = [{connection_id: c.id, root_provider: rootProvider, root_source_team_id: c.source_team_id, provider: observedProvider, source_team_id: e.participants[0].source_team_id,
    generation: 7, method: 'provider_external_key', valid: true, proof_id: 'verified-provider-link'}];
  args.sourceSnapshot.coverage.push({...coverage, id: 'coverage-observed-provider', provider: observedProvider, source_team_id: e.participants[0].source_team_id});
  return args;
}
test('existing public provider-key entitlement works in both root/observed directions', async () => {
  for (const [root, observed] of [['gotsport', 'live'], ['live', 'gotsport']]) {
    const result = await resolveUserGameGroups(bridgedSnapshot(root, observed)), pair = pairFor(result);
    assert.equal(pair.decision, 'accepted');
    const own = pair.own_sides.find(s => s.source_id === ORACLE_BASE.public.source_id);
    assert.equal(own.root_provider, root); assert.equal(own.observed_provider, observed);
    assert.equal(own.method, 'provider_external_key'); assert.equal(own.alias_proof_id, 'verified-provider-link');
    assert.equal(pair.evidence.coverage.length, 3);
  }
});
test('public root bridge rejects missing, foreign, stale or non-provider link proof', async () => {
  for (const mutate of [a => a.connectionSnapshot.aliases = [], a => a.connectionSnapshot.aliases[0].root_source_team_id = 'foreign-root', a => a.connectionSnapshot.aliases[0].generation++, a => a.connectionSnapshot.aliases[0].method = 'display_name', a => a.sourceSnapshot.coverage.pop()]) {
    const args = bridgedSnapshot('gotsport', 'live'); mutate(args);
    assert.notEqual(pairFor(await resolveUserGameGroups(args)).decision, 'accepted');
  }
});
function juneMoveSnapshot() {
  const args = snapshot();
  args.sourceSnapshot.events[0].starts_at = '2027-05-31T17:40:31Z'; args.sourceSnapshot.events[1].starts_at = '2027-05-31T17:40:00Z';
  args.sourceSnapshot.windows[0].to = '2027-12-31T23:59:59Z'; args.sourceSnapshot.coverage.forEach(c => c.to = '2027-12-31T23:59:59Z');
  args.manualState.push({teamId: 'owner-a', seasonId: '2026', event_id: 'public-game-a', kind: 'note', state_id: 'old-season-note'});
  return args;
}
function destinationSeason(args) {
  args.seasonId = args.connectionSnapshot.seasonId = args.sourceSnapshot.seasonId = '2027';
  args.connectionSnapshot.connections.forEach(c => c.team_season_id = '2027');
}
test('both-source June move preserves team-wide durable target and original old-season keys', async () => {
  const args = juneMoveSnapshot(), first = await resolveUserGameGroups(args);
  assert.equal(first.groups[0].event_id, 'public-game-a');
  args.previousPublishedGroups = first.groups; args.acceptedAssociations = [durableRecord(args, first.groups[0])];
  args.sourceSnapshot.events.forEach(e => e.starts_at = e.starts_at.replace('05-31', '06-01')); destinationSeason(args);
  const moved = await resolveUserGameGroups(args);
  assert.equal(accepted(moved).length, 1); assert.equal(accepted(moved)[0].event_id, 'public-game-a');
  assert.equal(accepted(moved)[0].state_refs[0].seasonId, '2026');
  assert.equal(accepted(moved)[0].state_refs[0].state_id, 'old-season-note');
});
test('one-sided June move retains accepted date and season only on the old-season path', async () => {
  const args = juneMoveSnapshot(), first = await resolveUserGameGroups(args);
  args.previousPublishedGroups = first.groups; args.acceptedAssociations = [durableRecord(args, first.groups[0])];
  args.sourceSnapshot.events[0].starts_at = args.sourceSnapshot.events[0].starts_at.replace('05-31', '06-01');
  const old = await resolveUserGameGroups(args);
  assert.equal(old.groups.length, 1); assert.equal(old.groups[0].decision, 'review');
  assert.deepEqual(old.groups[0].placement, {season_id: '2026', starts_at: '2027-05-31T17:40:00Z', local_day: '2027-05-31', effective_day: '2027-05-31'});
  destinationSeason(args); const destination = await resolveUserGameGroups(args);
  assert.equal(accepted(destination).length, 0); assert.ok(destination.groups.every(g => g.source_ids.length === 1 && !g.placement));
  assert.equal(destination.state_holds[0].seasonId, '2026');
});
test('durable conflicting partner blocks fresh auto-pairing even without prior publication rows', async () => {
  const args = snapshot(), first = await resolveUserGameGroups(args);
  args.acceptedAssociations = [durableRecord(args, first.groups[0])];
  args.sourceSnapshot.events[1].source_id = 'live/replacement'; args.canonicalGroups[1].source_ids = ['live/replacement'];
  const result = await resolveUserGameGroups(args);
  assert.equal(accepted(result).length, 0); assert.ok(result.assessments[0].reasons.includes('durable_association_membership_conflict'));
  assert.equal(result.state_holds[0].event_id, first.groups[0].event_id);
});
test('durable retained association remains reachable without an old mixed published row', async () => {
  const args = juneMoveSnapshot(), first = await resolveUserGameGroups(args);
  args.acceptedAssociations = [durableRecord(args, first.groups[0])];
  args.sourceSnapshot.events[0].starts_at = args.sourceSnapshot.events[0].starts_at.replace('05-31', '06-01');
  args.previousPublishedGroups = [];
  const retained = await resolveUserGameGroups(args);
  assert.equal(retained.groups.length, 1); assert.equal(retained.groups[0].decision, 'review');
  assert.equal(retained.groups[0].event_id, 'public-game-a'); assert.equal(retained.groups[0].placement.effective_day, '2027-05-31');
  assert.equal(retained.groups[0].state_refs[0].state_id, 'old-season-note');
});
test('previous pending singletons do not prevent first acceptance when coverage completes', async () => {
  const args = snapshot(); args.sourceSnapshot.complete = false;
  args.previousPublishedGroups = (await resolveUserGameGroups(args)).groups;
  assert.ok(args.previousPublishedGroups.every(g => g.source_ids.length === 1));
  args.sourceSnapshot.complete = true;
  assert.equal(accepted(await resolveUserGameGroups(args)).length, 1);
});
test('one source mapped to conflicting native canonical targets is quarantined', async () => {
  const args = snapshot(); args.canonicalGroups.push({event_id: 'conflicting-native-target', source_ids: [ORACLE_BASE.public.source_id], established: true});
  const result = await resolveUserGameGroups(args);
  assert.equal(accepted(result).length, 0);
  assert.ok(result.groups.every(g => !g.source_ids.includes(ORACLE_BASE.public.source_id)));
  assert.ok(result.review_records.some(g => g.publishable === false && g.source_ids.includes(ORACLE_BASE.public.source_id)));
  assert.equal(resolveScopedGameReference({teamId: 'owner-a', seasonId: '2026', groups: result.groups, reference: ORACLE_BASE.public.source_id}), null);
});


test('legacy entitlement requires null membership generation and exact real attachment authority', async () => {
  const legacy = () => {const args=snapshot(); Object.assign(args.connectionSnapshot.connections[0], {basis:'legacy_attachment', attachment_id:'attachment-ts', attachment_generation:7, membership_generation:null}); Object.assign(args.sourceSnapshot.events[0], {connection_id:null, attachment_id:'attachment-ts', attachment_generation:7, membership_generation:null}); Object.assign(args.sourceSnapshot.coverage[0], {connection_id:null, attachment_id:'attachment-ts', attachment_generation:7}); return args;};
  assert.equal(pairFor(await resolveUserGameGroups(legacy())).decision,'accepted');
  for (const change of [args=>{args.connectionSnapshot.connections[0].membership_generation=5;}, args=>{args.sourceSnapshot.events[0].membership_generation=5;}, args=>{delete args.sourceSnapshot.events[0].membership_generation;}, args=>{args.sourceSnapshot.events[0].attachment_generation=8;}, args=>{args.sourceSnapshot.events[0].account_generation=4;}, args=>{args.connectionSnapshot.connections[0].attachment_generation=0;args.sourceSnapshot.events[0].attachment_generation=0;}]) {const args=legacy();change(args);assert.equal(accepted(await resolveUserGameGroups(args)).length,0);}
  for (const value of [null,undefined,0,'5']) {const args=snapshot();args.connectionSnapshot.connections[0].membership_generation=value;args.sourceSnapshot.events[0].membership_generation=value;assert.equal(pairFor(await resolveUserGameGroups(args)).decision,'pending');}
});
function manualConfirm(args){const ids=args.sourceSnapshot.events.slice(0,2).map(e=>e.source_id),d=durableRecord(args,{event_id:'native-ts-game-a',source_ids:ids});const decision={type:'pair',teamId:args.teamId,association_id:'manual-pair',revision:2,decision:'accepted',source_ids:ids,scope_refs:d.scope_refs,manual_policy:TEAM_GAME_MANUAL_POLICY,owner_confirmation:'same_game_for_this_team'};args.ownerDecisions.push(decision);return decision;}
const manualReasonCases={
 opponent_age_conflict:a=>{a.sourceSnapshot.events[0].opponent='Albion U11';a.sourceSnapshot.events[1].opponent='Albion U12';},
 opponent_gender_conflict:a=>{a.sourceSnapshot.events[0].opponent='Albion U11 Boys';a.sourceSnapshot.events[1].opponent='Albion U11 Girls';},
 opponent_initials_conflict:a=>{a.sourceSnapshot.events[0].opponent='Albion SC CM Blue';a.sourceSnapshot.events[1].opponent='Albion SC DN Blue';},
 opponent_color_conflict:a=>{a.sourceSnapshot.events[0].opponent='Albion Blue';a.sourceSnapshot.events[1].opponent='Albion Red';},
 opponent_tier_conflict:a=>{a.sourceSnapshot.events[0].opponent='Albion Premier';a.sourceSnapshot.events[1].opponent='Albion Elite';},
 opponent_birth_year_conflict:a=>{a.sourceSnapshot.events[0].opponent='Albion 2016/2017';a.sourceSnapshot.events[1].opponent='Albion 2017/2018';},
 opponent_stem_conflict:a=>{a.sourceSnapshot.events[0].opponent='Different Opponent';},
 opponent_qualifier_unparsed:a=>{a.sourceSnapshot.events[0].opponent='Albion U11 U12';},
 opponent_name_insufficient:a=>{a.sourceSnapshot.events[0].opponent='Team';},
 venue_field_labels_conflict:a=>{a.sourceSnapshot.events[0].venue='Kellogg Zaher Sports Complex Field 7';a.sourceSnapshot.events[0].field='8';},
 venue_field_conflict:a=>{a.sourceSnapshot.events[0].field='7';a.sourceSnapshot.events[1].field='8';},
 venue_address_conflict:a=>{a.sourceSnapshot.events[0].venue_address='1 Elm';a.sourceSnapshot.events[1].venue_address='2 Elm';},
 venue_identity_conflict:a=>{a.sourceSnapshot.events[0].venue_identity='a';a.sourceSnapshot.events[1].venue_identity='b';},
 venue_surface_conflict:a=>{a.sourceSnapshot.events[0].surface='turf';a.sourceSnapshot.events[1].surface='grass';},
 venue_name_conflict:a=>{a.sourceSnapshot.events[0].venue='Different Park';},
 venue_identity_insufficient:a=>{a.sourceSnapshot.events[0].venue=null;},
 reciprocal_candidate_collision:a=>addPublic(a,{...a.sourceSnapshot.events[1],source_id:'another-public'},'another-target'),
};
assert.deepEqual(Object.keys(manualReasonCases).sort(),[...TEAM_GAME_MANUAL_REASONS].sort());
for(const [reason,mutate]of Object.entries(manualReasonCases))test('explicit owner pair alone may acknowledge '+reason,async()=>{const args=snapshot();mutate(args);assert.notEqual(pairFor(await resolveUserGameGroups(args)).decision,'accepted');const d=manualConfirm(args),result=pairFor(await resolveUserGameGroups(args));assert.equal(result.decision,'accepted',JSON.stringify(result.reasons));assert.ok(result.reasons.includes(reason));assert.ok(result.evidence.owner_confirmation.overridden_reasons.includes(reason));for(const change of [d=>d.manual_policy='unrecognized',d=>d.owner_confirmation='same_game',d=>d.source_ids=['wrong'],d=>d.scope_refs[0].account_id='foreign']){const bad=clone(args);change(bad.ownerDecisions[0]);assert.notEqual(pairFor(await resolveUserGameGroups(bad)).decision,'accepted');}assert.equal(d.association_id,'manual-pair');});
for(const [name,mutate]of Object.entries({
 time:a=>a.sourceSnapshot.events[0].starts_at='2026-10-24T18:40:31Z',
 date:a=>a.sourceSnapshot.events[0].starts_at='2026-10-25T17:40:31Z',
 scope:a=>a.connectionSnapshot.connections[0].active=false,
 ownside:a=>a.sourceSnapshot.events[0].own_side='away',
 incomplete:a=>a.sourceSnapshot.complete=false,
 state:a=>a.manualState=[{teamId:a.teamId,event_id:'native-ts-game-a',state_id:'a',kind:'coach_session'},{teamId:a.teamId,event_id:a.canonicalGroups[1].event_id,state_id:'b',kind:'coach_session'}],
 mapping:a=>a.ownerDecisions.push({type:'opponent_mapping',teamId:a.teamId,seasonId:a.seasonId,id:'mapping',valid:true,account_id:'ts-account-a',source_team_id:'ts-team-a',private_opponent_id:a.sourceSnapshot.events[0].opponent_id,public_provider:'live',public_opponent_id:'wrong'}),
 conditional:a=>a.sourceSnapshot.events[0].conditional=true,
 provenance:a=>a.sourceSnapshot.events[0].provenance='owner',
 conflicting_owner:a=>a.ownerDecisions.push({type:'pair',teamId:a.teamId,decision:'accepted',source_ids:[a.sourceSnapshot.events[0].source_id,'other']}),
 public_member:a=>{const p={...a.sourceSnapshot.events[1],provider:'gotsport',source_id:'public-peer',opponent:'Different Club'};a.sourceSnapshot.events.push(p);a.canonicalGroups[1].source_ids.push(p.source_id);a.connectionSnapshot.connections.push({...a.connectionSnapshot.connections[1],id:'peer-connection',provider:'gotsport'});p.connection_id='peer-connection';a.sourceSnapshot.coverage.push({...a.sourceSnapshot.coverage[1],connection_id:p.connection_id,provider:'gotsport'});},
}))test('manual confirmation never bypasses '+name,async()=>{const args=snapshot();manualConfirm(args);mutate(args);const pair=pairFor(await resolveUserGameGroups(args));assert.notEqual(pair.decision,'accepted',JSON.stringify(pair));});
test('manual identity preserves separately unresolved provider value conflicts',async()=>{for(const patch of [{authoritative_final_score_conflict:true},{public:{status:'CANCELLED'}}]){const args=snapshot(oracleInput(patch));manualConfirm(args);const p=pairFor(await resolveUserGameGroups(args));assert.equal(p.decision,'accepted');assert.ok(p.evidence.owner_confirmation.value_conflicts.length);assert.deepEqual(p.evidence.owner_confirmation.overridden_reasons,[]);}});
