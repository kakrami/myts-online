/**
 * Pure, schema-free TeamSnap -> established public user-game inference.
 * This module does not read/write a database, create global aliases, or establish
 * provider-native identity. Callers must supply a complete fenced source scope.
 * It is NOT wired into projection or application read consumers yet.
 *
 * Input DTO contract:
 * connectionSnapshot: {teamId, seasonId, revision, connections:[{id, provider,
 *   app_team_id, team_season_id, account_id, source_team_id, generation,
 *   active, excluded, account_generation, membership_generation,
 *   basis?:'root'|'legacy_attachment', attachment_id?, attachment_generation?}],
 *   aliases?:[{connection_id, attachment_id?, attachment_generation?,
 *   root_provider, root_source_team_id, source_team_id, provider,
 *   method:'provider_external_key', generation, valid:true, proof_id}]}
 * `active` above means saved-domain entitlement, not account fetch/login state.
 * A disconnected provider account can retain readable saved members. Account
 * generation still fences rebuilds; it does not itself revoke this entitlement.
 * Legacy attachment adapters use membership_generation:null on the connection
 * and event; only typed roots have a seasonal membership generation.
 * Legacy attachment adapters must use the exact attachment id/generation and
 * basis:'legacy_attachment', never fabricate a typed root or provider alias.
 * sourceSnapshot: {teamId, seasonId, revision, connection_revision, complete,
 *   overflow, windows:[{from,to}], coverage:[{id, connection_id, attachment_id?, attachment_generation?,
 *   provider, source_team_id, generation, source_revision,
 *   complete, from, to}], events:[{source_id, provider, connection_id,
 *   connection_generation, attachment_id?, attachment_generation?,
 *   account_generation, membership_generation,
 *   account_id, source_team_id, provenance:'provider',
 *   participants:[{source_team_id, side, real}], ...schedule/result fields}]}
 * canonicalGroups: [{event_id, source_ids, established:true}]. Membership here
 * is established native authority supplied by the caller, never inferred here.
 * previousPublishedGroups: this module's prior groups, scoped to team/season.
 * ownerDecisions: CURRENT team-local pair decisions (season is provenance),
 * or team+season scoped opponent_mapping decisions. Never pass historical heads.
 * acceptedAssociations: explicit durable records {type:'team_game_association',
 * association_id, revision:positive integer, teamId, accepted_season_id,
 * starts_at, local_day, effective_day, decision:'accepted', event_id, source_ids,
 * scope_refs:[{source_id,connection_id,account_id,source_team_id,entitlement_kind,
 * attachment_id?,attachment_generation?}]}. Association scope is app-team-local; season
 * records provenance. Every retained source must also pass current entitlement.
 * Previous publication alone is NOT authority to retain a mixed-source group.
 * manualState: team-wide original-key records {teamId,seasonId,event_id,state_id,kind,...};
 * incompatible:true blocks merging; independent state-bearing targets do too.
 *
 * Supply complete BOUNDED candidate neighborhoods, not a UI page or an entire
 * season Cartesian product. Include every competing TS/public observation from
 * all entitled connections, plus prior accepted members even after reschedules
 * move them outside the initial time window. The adapter must partition large
 * histories into complete neighborhoods, with boundary overlap, rather than
 * repeatedly submitting an oversized season. No prefix is accepted on overflow.
 *
 * A preserved complete saved-history receipt is not proof that a recent scan
 * has observed every current candidate. The adapter must bind full/recent job
 * receipts, relevant in-flight scan state and input revisions to these windows,
 * or set complete:false until that neighborhood settles. coverage.complete by
 * itself is insufficient; this pure core cannot inspect provider jobs.
 *
 * Coverage uses inclusive from/to instants and must cover each candidate's
 * +/-60-second neighborhood. Snapshot revisions/generations must be rechecked
 * by an atomic publisher; the returned fence is not a database lock.
 */
export const TEAM_GAME_ALGORITHM = 'team-game-composite-v1';
export const TEAM_GAME_MANUAL_POLICY = 'owner-team-game-v1';
// Manual pair identity is separately attributed. These comparisons remain in
// evidence; confirmation does not assert that either provider's values are true.
export const TEAM_GAME_MANUAL_REASONS = Object.freeze([
 'opponent_age_conflict','opponent_gender_conflict','opponent_initials_conflict','opponent_color_conflict','opponent_tier_conflict','opponent_birth_year_conflict','opponent_stem_conflict','opponent_qualifier_unparsed','opponent_name_insufficient',
 'venue_field_labels_conflict','venue_field_conflict','venue_address_conflict','venue_identity_conflict','venue_surface_conflict','venue_name_conflict','venue_identity_insufficient','reciprocal_candidate_collision',
]);
const MANUAL_IDENTITY_REASONS=new Set(TEAM_GAME_MANUAL_REASONS);
const MANUAL_VALUE_REASONS=new Set(['authoritative_final_score_conflict','initial_game_status_conflict']);
function manualPairConfirmation(decisions,sourceIds,proofs){
 const accepted=decisions.filter(d=>d.decision==='accepted'&&d.manual_policy===TEAM_GAME_MANUAL_POLICY&&d.owner_confirmation==='same_game_for_this_team'&&sameSet(d.source_ids,sourceIds)&&present(d.association_id)&&Number.isSafeInteger(d.revision)&&d.revision>0);
 if(accepted.length!==1)return null;const d=accepted[0];
 if(!Array.isArray(d.scope_refs)||d.scope_refs.length!==sourceIds.length||!sameSet(d.scope_refs.map(r=>r.source_id),sourceIds))return null;
 if(!d.scope_refs.every(r=>{const p=proofs.get(r.source_id);return p?.decision==='accepted'&&(r.connection_id??null)===p.connection_id&&(r.account_id??null)===p.account_id&&r.source_team_id===p.connected_source_team_id&&r.entitlement_kind===p.scope_basis&&(p.scope_basis!=='legacy_attachment'||r.attachment_id===p.attachment_id&&r.attachment_generation===p.attachment_generation);}))return null;
 return {policy:TEAM_GAME_MANUAL_POLICY,association_id:d.association_id,revision:d.revision};
}
const WINDOW_MS = 60_000;
export const TEAM_GAME_LIMITS = Object.freeze({max_pairs: 1024, max_proof_bytes: 16_000, max_state_refs: 256, max_assessment_bytes: 256_000});
const MAX_PAIRS = TEAM_GAME_LIMITS.max_pairs;
const byteLength = value => new TextEncoder().encode(stableJSON(value)).byteLength;
const PUBLIC = new Set(['gotsport', 'live']);
const SIDES = new Set(['home', 'away']);
const COLORS = new Set('blue red white black green gold silver orange yellow purple pink navy maroon gray grey teal burgundy'.split(' '));
const TIERS = new Set(['premier', 'elite', 'select', 'recreational']);
const GENERIC_TEAM = new Set('academy club soccer football sc fc sports team boys girls youth united premier elite select central north south east west'.split(' '));
const GENERIC_VENUE = new Set('sports soccer football athletic athletics recreation recreational complex park center centre field fields pitch stadium grounds facility north south east west'.split(' '));
const unique = values => [...new Set(values)].sort();
const sameSet = (a, b) => JSON.stringify(unique(a)) === JSON.stringify(unique(b));
const present = x => x !== undefined && x !== null && x !== '';
const fold = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = value => fold(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const scoped = (value, teamId, seasonId) => value?.teamId === teamId && value?.seasonId === seasonId;
const stableJSON = value => JSON.stringify(canonicalJSON(value));
function canonicalJSON(value) {
  if (Array.isArray(value)) return value.map(canonicalJSON);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonicalJSON(value[k])]));
  return value;
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJSON(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function one(values) { const v = unique(values); return v.length === 1 ? v[0] : null; }

/** Recognized qualifiers are extracted; unrecognized words are never dropped. */
export function normalizeOpponentName(raw) {
  let text = String(raw ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2');
  const birthYears = [], issues = [];
  text = text.replace(/\b((?:19|20)\d{2})\s*\/\s*((?:19|20)\d{2}|\d{2})\b/g, (match, start, end) => {
    const a = Number(start), b = end.length === 2 ? Math.floor(a / 100) * 100 + Number(end) : Number(end);
    if (b !== a + 1) { issues.push('unrecognized_birth_year_range'); return match; }
    birthYears.push(a, b); return ' ';
  });
  text = text.replace(/\b(?:19|20)\d{2}\b/g, year => { birthYears.push(Number(year)); return ' '; });
  const tokens = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const keep = [], ages = [], genders = [], colors = [], tiers = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = fold(tokens[i]), next = fold(tokens[i + 1]);
    if (['u', 'bu', 'gu'].includes(token) && /^\d{1,2}$/.test(next)) {
      const age = Number(next);
      if (age < 4 || age > 23) { issues.push('unrecognized_age'); keep.push(tokens[i], tokens[++i]); continue; }
      ages.push(age); if (token !== 'u') genders.push(token === 'bu' ? 'boys' : 'girls'); i++; continue;
    }
    if ((token === 'b' || token === 'g') && next === 'u' && /^\d{1,2}$/.test(tokens[i + 2] ?? '')) {
      genders.push(token === 'b' ? 'boys' : 'girls'); continue;
    }
    if (['boys', 'boy', 'girls', 'girl'].includes(token)) { genders.push(token.startsWith('boy') ? 'boys' : 'girls'); continue; }
    if (TIERS.has(token)) tiers.push(token); // Retain tier in the exact stem (oracle contract).
    keep.push(tokens[i]);
  }
  // Color words inside a club name (Red Bull, Blue Angels) are part of the
  // exact stem. Only a trailing squad suffix is extracted as a color.
  while (keep.length > 1 && COLORS.has(fold(keep.at(-1)))) { const color = fold(keep.pop()); colors.push(color === 'grey' ? 'gray' : color); }
  // Defined squad suffix: exactly two uppercase letters immediately before
  // a recognized color, after a substantive stem. A bare BAY/LA/CM suffix is
  // retained, not guessed away. Club/geographic designators remain stem words.
  let initials = null;
  if (colors.length && keep.length >= 3 && /^[A-Z]{2}$/.test(keep.at(-1)) && !['FC', 'SC', 'AC', 'CF', 'LA', 'LV', 'NY', 'NJ', 'SF', 'SD', 'DC', 'NE', 'NW', 'SE', 'SW', 'UK'].includes(keep.at(-1))) initials = keep.pop();
  for (const [key, values] of [['age', ages], ['gender', genders], ['color', colors], ['tier', tiers]]) if (unique(values).length > 1) issues.push(`multiple_${key}_qualifiers`);
  const stem = words(keep.join(' '));
  return {raw: raw ?? null, stem, age: one(ages), gender: one(genders), initials, color: one(colors), tier: one(tiers),
    birth_years: [...new Set(birthYears)].sort((a, b) => a - b),
    distinctive: stem.split(' ').some(t => t.length > 2 && !GENERIC_TEAM.has(t) && !/^\d+$/.test(t)), issues: unique(issues)};
}

export function normalizeVenue(raw, explicitField = null) {
  let text = fold(raw).replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2');
  let embedded = null;
  text = text.replace(/(?:#\s*|\b(?:field|pitch)\s+)(\d+[a-z]?(?:\s+(?:north|south|east|west|northeast|northwest|southeast|southwest))?)\s*$/i, (_, field) => { embedded = field; return ''; });
  const normalizeField = v => present(v) ? words(v).replace(/^(?:field|pitch)\s+/, '').replace(/^0+(?=\d)/, '') : null;
  const a = normalizeField(embedded), b = normalizeField(explicitField);
  const name = words(text).replace(/\b(?:sports|soccer|football|athletic|athletics)\s+(complex|park|center|centre|stadium|grounds)\b/g, '$1');
  return {raw: raw ?? null, name, field: b || a, embedded_field: a, explicit_field: b,
    distinctive: name.split(' ').some(t => t.length > 2 && !GENERIC_VENUE.has(t) && !/^\d+$/.test(t)),
    issues: a && b && a !== b ? ['contradictory_field_labels'] : []};
}

function instant(value) {
  // Date.parse alone accepts rolled-over invalid dates and offset-free wall time.
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!m) return null;
  const [, y, month, d, h, min, sec = '0', offset] = m;
  const days = new Date(Date.UTC(Number(y), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(d) < 1 || Number(d) > days || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59) return null;
  if (offset !== 'Z' && offset !== 'z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return null;
  const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null;
}
function dayFormatter(timezone) { try { return new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}); } catch { return null; } }
function localDay(ms, formatter) { if (ms === null || !formatter) return null; const p = Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type, p.value])); return `${p.year}-${p.month}-${p.day}`; }
function isConcrete(e) { return e.type === 'game' && !e.conditional && (!PUBLIC.has(e.provider) || e.opponent_real === true); }
function stateReference(s) { return {teamId: s.teamId, seasonId: s.seasonId, event_id: s.event_id, state_id: s.state_id, kind: s.kind, revision: s.revision ?? null}; }
function sourceFacts(e) {
  // Observation/retrieval clocks do not change identity proof. Payload content,
  // provider hash, source revision and every other supplied fact remain hashed.
  return Object.fromEntries(Object.entries(e).filter(([key]) => !['observed_at', 'retrieved_at', 'fetched_at'].includes(key)));
}
const scopeGeneration = c => c.basis === 'legacy_attachment' ? c.attachment_generation : c.generation;
const sameEntitlement = (ref, c) => c.basis === 'legacy_attachment'
  ? ref.connection_id == null && ref.attachment_id === c.attachment_id && ref.attachment_generation === c.attachment_generation
  : ref.connection_id === c.id && ref.attachment_id == null;
function validPublicAliases(c, aliases) {
  return aliases.filter(a => PUBLIC.has(c.provider) && PUBLIC.has(a.provider) && sameEntitlement(a, c) &&
    a.root_provider === c.provider && a.root_source_team_id === c.source_team_id && a.generation === scopeGeneration(c) &&
    a.method === 'provider_external_key' && a.valid === true && present(a.proof_id) && present(a.source_team_id));
}
function ownProof(e, connections, aliases, teamId, seasonId) {
  const candidates = connections.filter(c => sameEntitlement(e, c) && c.app_team_id === teamId && c.team_season_id === seasonId);
  const c = candidates.length === 1 ? candidates[0] : null;
  if (c && ![undefined, 'root', 'legacy_attachment'].includes(c.basis)) return {decision: 'pending', reason: 'scope_basis_unproven'};
  if (!c || c.active !== true || c.excluded === true || c.followed === true) return {decision: 'separate', reason: 'connection_not_entitled'};
  if (c.basis === 'legacy_attachment' && (!present(c.attachment_id) || !present(c.attachment_generation))) return {decision: 'pending', reason: 'attachment_identity_unproven'};
  if (e.provider !== c.provider && !(PUBLIC.has(e.provider) && PUBLIC.has(c.provider))) return {decision: 'separate', reason: 'provider_scope_mismatch'};
  if (e.provider === 'teamsnap' && (e.account_id !== c.account_id || e.source_team_id !== c.source_team_id || !present(c.account_id))) return {decision: 'separate', reason: 'private_scope_mismatch'};
  const observedGeneration = c.basis === 'legacy_attachment' ? e.attachment_generation : e.connection_generation;
  if (!present(scopeGeneration(c)) || observedGeneration !== scopeGeneration(c)) return {decision: 'pending', reason: 'connection_generation_mismatch'};
  const membershipValid = c.basis === 'legacy_attachment'
    ? c.membership_generation === null && e.membership_generation === null && Number.isSafeInteger(c.attachment_generation) && c.attachment_generation > 0
    : Number.isSafeInteger(c.membership_generation) && c.membership_generation > 0 && e.membership_generation === c.membership_generation;
  if (!membershipValid || (e.provider === 'teamsnap' && (!present(c.account_generation) || e.account_generation !== c.account_generation))) return {decision: 'pending', reason: 'entitlement_generation_mismatch'};
  if (e.provenance !== 'provider') return {decision: 'pending', reason: 'provider_provenance_missing'};
  const validAliases = validPublicAliases(c, aliases).filter(a => a.provider === e.provider);
  const identities = new Set([...(c.provider === e.provider ? [c.source_team_id] : []), ...validAliases.map(a => a.source_team_id)].filter(present));
  const own = (e.participants || []).filter(p => identities.has(p.source_team_id));
  if (own.length !== 1 || !SIDES.has(own[0]?.side)) return {decision: own.length > 1 ? 'review' : 'pending', reason: own.length > 1 ? 'own_participant_not_unique' : 'own_identity_unproven'};
  if (PUBLIC.has(e.provider)) {
    const otherSide = own[0].side === 'home' ? 'away' : 'home';
    const opponents = (e.participants || []).filter(p => p.side === otherSide);
    if (opponents.length !== 1 || e.participants.length !== 2) return {decision: opponents.length > 1 ? 'review' : 'pending', reason: 'public_opponent_participant_unproven'};
    if (opponents[0].real === false) return {decision: 'separate', reason: 'public_opponent_not_concrete'};
    if (opponents[0].real !== true || !present(e.opponent_id)) return {decision: 'pending', reason: 'public_opponent_identity_unproven'};
    if (opponents[0].source_team_id !== (e.opponent_source_team_id ?? e.opponent_id)) return {decision: 'review', reason: 'public_opponent_identity_conflict'};
  }
  const side = e.provider === 'teamsnap' && e.orientation_verified !== true ? null : own[0].side;
  if (side && present(e.own_side) && e.own_side !== side) return {decision: 'review', reason: 'own_side_evidence_conflict'};
  if (PUBLIC.has(e.provider) && own[0].real !== true) return {decision: 'pending', reason: 'own_participant_not_real'};
  return {decision: 'accepted', connection_id: c.basis === 'legacy_attachment' ? null : c.id, generation: scopeGeneration(c),
    attachment_id: c.basis === 'legacy_attachment' ? c.attachment_id : null, attachment_generation: c.basis === 'legacy_attachment' ? c.attachment_generation : null,
    account_generation: c.account_generation ?? null, membership_generation: c.membership_generation, account_id: e.provider === 'teamsnap' ? c.account_id : null,
    scope_basis: c.basis ?? 'root', root_provider: c.provider, observed_provider: e.provider, connected_source_team_id: c.source_team_id, participant_source_team_id: own[0].source_team_id, side,
    orientation_absent: side === null, method: c.provider === e.provider && own[0].source_team_id === c.source_team_id ? 'connected_source_team' : 'provider_external_key',
    alias_proof_id: validAliases.find(a => a.source_team_id === own[0].source_team_id)?.proof_id ?? null};
}
function nameAssessment(ts, pub, mapping) {
  const a = normalizeOpponentName(ts.opponent), b = normalizeOpponentName(pub.opponent), conflicts = [];
  for (const key of ['age', 'gender', 'initials', 'color', 'tier']) if (present(a[key]) && present(b[key]) && a[key] !== b[key]) conflicts.push(`opponent_${key}_conflict`);
  if (a.birth_years.length && b.birth_years.length && !sameSet(a.birth_years, b.birth_years)) conflicts.push('opponent_birth_year_conflict');
  if (a.issues.length || b.issues.length) conflicts.push('opponent_qualifier_unparsed');
  const missing = ['age', 'gender', 'initials', 'color', 'tier'].filter(k => !present(a[k]) || !present(b[k]));
  if (mapping?.conflict) conflicts.push('opponent_mapping_conflict');
  let decision = conflicts.length ? 'review' : 'accepted';
  if (!conflicts.length && !mapping?.valid) {
    if (!a.distinctive || !b.distinctive) { decision = 'pending'; conflicts.push('opponent_name_insufficient'); }
    else if (a.stem !== b.stem) { decision = 'review'; conflicts.push('opponent_stem_conflict'); }
  }
  return {decision, reasons: conflicts, teamsnap: a, public: b, absent_qualifiers: missing, method: mapping?.valid ? 'scoped_opponent_mapping' : 'exact_lexical_stem', mapping_id: mapping?.id ?? null};
}
function venueAssessment(a, b) {
  const av = normalizeVenue(a.venue, a.field), bv = normalizeVenue(b.venue, b.field), reasons = [];
  if (av.issues.length || bv.issues.length) reasons.push('venue_field_labels_conflict');
  if (av.field && bv.field && av.field !== bv.field) reasons.push('venue_field_conflict');
  if (present(a.venue_address) && present(b.venue_address) && words(a.venue_address) !== words(b.venue_address)) reasons.push('venue_address_conflict');
  if (present(a.venue_identity) && present(b.venue_identity) && a.venue_identity !== b.venue_identity) reasons.push('venue_identity_conflict');
  if (present(a.surface) && present(b.surface) && words(a.surface) !== words(b.surface)) reasons.push('venue_surface_conflict');
  const named = av.distinctive && bv.distinctive;
  const verifiedCrosswalk = present(a.venue_identity) && a.venue_identity === b.venue_identity && a.venue_identity_verified === true && b.venue_identity_verified === true;
  if (named && av.name !== bv.name && !verifiedCrosswalk) reasons.push('venue_name_conflict');
  const decision = reasons.length ? 'review' : named || verifiedCrosswalk ? 'accepted' : 'pending';
  if (decision === 'pending') reasons.push('venue_identity_insufficient');
  return {decision, reasons, teamsnap: av, public: bv, method: verifiedCrosswalk ? 'verified_venue_crosswalk' : 'exact_named_venue',
    field_evidence: av.field && bv.field ? av.field === bv.field ? 'agreement' : 'conflict' : av.field || bv.field ? 'one_sided' : 'absent'};
}
function scoreAssessment(events, proofs) {
  const scored = events.filter(e => Number.isFinite(e.home_score) && Number.isFinite(e.away_score));
  const oriented = scored.filter(e => SIDES.has(proofs.get(e.source_id)?.side)).map(e => ({source_id: e.source_id,
    score: proofs.get(e.source_id).side === 'home' ? [e.home_score, e.away_score] : [e.away_score, e.home_score],
    authoritative: e.result_authority === 'official' && e.result_verified === true && e.result_final === true}));
  const official = oriented.filter(s => s.authoritative), distinct = new Set(official.map(s => JSON.stringify(s.score)));
  const unoriented = scored.filter(e => !SIDES.has(proofs.get(e.source_id)?.side)).map(e => ({source_id: e.source_id, home_score: e.home_score, away_score: e.away_score, orientation_verified: false, asserted_authority: e.result_authority ?? null, asserted_final: e.result_final === true}));
  return {decision: distinct.size > 1 ? 'review' : 'accepted', reasons: distinct.size > 1 ? ['authoritative_final_score_conflict'] : [],
    official_results: official, reported_results: oriented.filter(s => !s.authoritative),
    unverified_discrepancy: oriented.some(s => !s.authoritative && official.some(o => !sameSetScore(s.score, o.score))) || unoriented.some(s => official.some(o => !sameSetScore([s.home_score,s.away_score],o.score) && !sameSetScore([s.away_score,s.home_score],o.score))),
    unoriented_results: unoriented,
    unoriented_source_ids: scored.filter(e => !SIDES.has(proofs.get(e.source_id)?.side)).map(e => e.source_id)};
}
const sameSetScore = (a, b) => a[0] === b[0] && a[1] === b[1];
function decisionFor(issues) { return ['separate', 'review', 'pending'].find(d => issues.some(i => i.decision === d)) || 'accepted'; }
function pairDecisions(decisions, ids, teamId, seasonId) {
  return decisions.filter(d => d?.teamId === teamId && d.type === 'pair' && Array.isArray(d.source_ids) && d.source_ids.some(id => ids.includes(id)));
}
function mappingFor(decisions, ts, pub, teamId, seasonId) {
  if (!present(ts.opponent_id) || !present(pub.opponent_id)) return null;
  const relevant = decisions.filter(d => scoped(d, teamId, seasonId) && d.type === 'opponent_mapping' && d.valid === true && present(d.id) &&
    d.account_id === ts.account_id && d.source_team_id === ts.source_team_id && d.private_opponent_id === ts.opponent_id && d.public_provider === pub.provider);
  if (!relevant.length) return null;
  const targets = unique(relevant.map(d => d.public_opponent_id));
  return {valid: targets.length === 1 && targets[0] === pub.opponent_id, conflict: targets.length !== 1 || targets[0] !== pub.opponent_id, id: one(relevant.map(d => d.id))};
}
function targetFor(ids, baseGroups, previous, manual, tsTarget) {
  const candidates = unique(baseGroups.filter(g => g.source_ids.some(id => ids.includes(id))).map(g => g.event_id));
  const state = manual.filter(s => candidates.includes(s.event_id) || previous.some(p => p.event_id === s.event_id && p.source_ids.some(id => ids.includes(id))));
  const stateTargets = unique(state.map(s => s.event_id));
  const exactPrevious = previous.filter(p => sameSet(p.source_ids, ids));
  const oldTargets = unique(exactPrevious.map(p => p.event_id));
  const conflict = oldTargets.length > 1 || stateTargets.length > 1 || state.some(s => s.incompatible === true) || unique(state.filter(s => s.kind === 'coach_session').map(s => s.state_id)).length > 1;
  return {event_id: oldTargets.length === 1 ? oldTargets[0] : stateTargets.length === 1 ? stateTargets[0] : tsTarget,
    decision: conflict ? 'review' : 'accepted', reasons: conflict ? ['state_bearing_target_conflict'] : [], state_refs: state.map(stateReference), candidate_targets: candidates};
}
function coverageFor(events, snapshot, connectionSnapshot) {
  const checks = [], coverage = [];
  if (snapshot.complete !== true || snapshot.overflow !== false) checks.push({decision: 'pending', reason: snapshot.overflow ? 'candidate_scope_overflow' : 'candidate_scope_incomplete'});
  if (!present(snapshot.revision) || snapshot.connection_revision !== connectionSnapshot.revision || !present(connectionSnapshot.revision)) checks.push({decision: 'pending', reason: 'snapshot_revision_mismatch'});
  const connections = (connectionSnapshot.connections || []).filter(c => c.app_team_id === snapshot.teamId && c.team_season_id === snapshot.seasonId && c.active === true && c.excluded !== true && c.followed !== true && (c.provider === 'teamsnap' || PUBLIC.has(c.provider)));
  if (!Array.isArray(snapshot.windows) || !snapshot.windows.length || snapshot.windows.some(w => instant(w.from) === null || instant(w.to) === null || instant(w.from) > instant(w.to))) checks.push({decision: 'pending', reason: 'candidate_windows_unproven'});
  const scopes = connections.flatMap(connection => [{connection, provider: connection.provider, source_team_id: connection.source_team_id}, ...validPublicAliases(connection, connectionSnapshot.aliases || []).map(a => ({connection, provider: a.provider, source_team_id: a.source_team_id}))]);
  const scopeMatches = (row, scope) => sameEntitlement(row, scope.connection) && row.provider === scope.provider && row.source_team_id === scope.source_team_id && row.generation === scopeGeneration(scope.connection) && row.source_revision === snapshot.revision && row.complete === true && present(row.id);
  for (const window of snapshot.windows || []) for (const scope of scopes) {
    const rows = (snapshot.coverage || []).filter(c => scopeMatches(c, scope) && instant(c.from) !== null && instant(c.to) !== null && instant(c.from) <= instant(window.from) && instant(c.to) >= instant(window.to));
    if (!rows.length) checks.push({decision: 'pending', reason: 'connection_universe_coverage_unproven'});
    coverage.push(...rows);
  }
  for (const e of events) for (const scope of scopes) {
    const at = instant(e.starts_at);
    const rows = (snapshot.coverage || []).filter(c => scopeMatches(c, scope) && at !== null && instant(c.from) !== null && instant(c.to) !== null && instant(c.from) <= at - WINDOW_MS && instant(c.to) >= at + WINDOW_MS);
    if (!rows.length) checks.push({decision: 'pending', reason: 'coverage_neighborhood_unproven'});
    coverage.push(...rows);
  }
  return {checks, coverage: [...new Map(coverage.map(c => [c.id, {...c}])).values()].sort((a, b) => a.id.localeCompare(b.id))};
}

/** Resolve a full supplied snapshot, never just one UI/projector page. */
export async function resolveUserGameGroups({teamId, seasonId, timezone, connectionSnapshot = {}, sourceSnapshot = {}, canonicalGroups = [], previousPublishedGroups = [], ownerDecisions = [], manualState = [], acceptedAssociations = []}) {
  const formatter = present(timezone) ? dayFormatter(timezone) : null;
  const scopedSnapshots = scoped(connectionSnapshot, teamId, seasonId) && scoped(sourceSnapshot, teamId, seasonId) && present(teamId) && present(seasonId);
  const events = [...(sourceSnapshot.events || [])].sort((a, b) => String(a.source_id).localeCompare(String(b.source_id)));
  const ids = events.map(e => e.source_id), duplicateIds = new Set(ids.filter((id, i) => !id || ids.indexOf(id) !== i));
  const byId = new Map(events.map(e => [e.source_id, e]));
  const bases = canonicalGroups.map(g => ({...g, source_ids: unique(g.source_ids || [])})).sort((a, b) => String(a.event_id).localeCompare(String(b.event_id)));
  const previous = previousPublishedGroups.filter(g => scoped(g, teamId, seasonId) && ['accepted', 'review', 'pending'].includes(g.decision));
  const manual = manualState.filter(s => s.teamId === teamId); // Original keys may belong to a prior season.
  const proofs = new Map(events.map(e => [e.source_id, scopedSnapshots ? ownProof(e, connectionSnapshot.connections || [], connectionSnapshot.aliases || [], teamId, seasonId) : {decision: 'separate', reason: 'snapshot_scope_mismatch'}]));
  const hashes = new Map(await Promise.all(events.map(async e => [e.source_id, await digest(sourceFacts(e))])));
  const retainedAuthority = (eventId, sourceIds) => {
    const candidates = acceptedAssociations.filter(a => a.type === 'team_game_association' && a.teamId === teamId && a.decision === 'accepted' && present(a.association_id) && Number.isInteger(a.revision) && a.revision > 0 && a.event_id === eventId && Array.isArray(a.source_ids) && sameSet(a.source_ids, sourceIds) && present(a.accepted_season_id) && instant(a.starts_at) !== null && a.local_day === a.effective_day && localDay(instant(a.starts_at), formatter) === a.effective_day);
    if (candidates.length !== 1) return null;
    const a = candidates[0];
    if (!Array.isArray(a.scope_refs) || a.scope_refs.length !== sourceIds.length || !sameSet(a.scope_refs.map(r => r.source_id), sourceIds)) return null;
    return a.scope_refs.every(r => { const p = proofs.get(r.source_id); return p?.decision === 'accepted' && (r.connection_id ?? null) === p.connection_id && (r.account_id ?? null) === p.account_id && r.source_team_id === p.connected_source_team_id && (r.entitlement_kind ?? r.scope_basis ?? 'root') === p.scope_basis && (p.scope_basis !== 'legacy_attachment' || r.attachment_id === p.attachment_id && r.attachment_generation === p.attachment_generation); }) ? a : null;
  };
  const memberships = new Map(events.map(e => [e.source_id, bases.filter(g => g.source_ids.includes(e.source_id))]));
  const relevantEvents = events.filter(e => e.provider === 'teamsnap' || PUBLIC.has(e.provider));
  const scopeIssues = coverageFor(relevantEvents.filter(e => proofs.get(e.source_id).decision !== 'separate'), sourceSnapshot, connectionSnapshot).checks;
  if (relevantEvents.some(e => duplicateIds.has(e.source_id) || memberships.get(e.source_id)?.length !== 1)) scopeIssues.push({decision: 'review', reason: 'candidate_scope_membership_ambiguous'});
  if (bases.some(g => !present(g.event_id) || bases.filter(other => other.event_id === g.event_id).length !== 1)) scopeIssues.push({decision: 'review', reason: 'canonical_target_ambiguous'});
  if (bases.some(g => g.source_ids.length > 1 && g.source_ids.some(id => byId.get(id)?.provider === 'teamsnap') && !g.source_ids.some(id => PUBLIC.has(byId.get(id)?.provider)))) scopeIssues.push({decision: 'review', reason: 'private_canonical_group_requires_explicit_resolution'});
  if (bases.some(g => g.source_ids.some(id => !byId.has(id)))) scopeIssues.push({decision: 'pending', reason: 'canonical_member_evidence_missing'});
  const publicGroups = bases.filter(g => g.source_ids.length && g.source_ids.every(id => PUBLIC.has(byId.get(id)?.provider)));
  const tsEvents = events.filter(e => e.provider === 'teamsnap' && !(memberships.get(e.source_id) || []).some(g => g.source_ids.some(id => PUBLIC.has(byId.get(id)?.provider))));
  const pairs = [], graph = new Map(), tooMany = tsEvents.length * publicGroups.length > MAX_PAIRS;
  const neighbors = key => { if (!graph.has(key)) graph.set(key, new Set()); return graph.get(key); };
  // Build collision edges BEFORE opponent, venue, side or compatibility filters.
  // Unproven own identity also blocks a coincident match conservatively; an
  // explicitly unauthorized source does not enter this team's candidate set.
  if (!tooMany) for (const ts of tsEvents) for (const group of publicGroups) {
    const pubs = group.source_ids.map(id => byId.get(id));
    if (proofs.get(ts.source_id).decision === 'separate' || pubs.every(p => proofs.get(p.source_id).decision === 'separate')) continue;
    if (isConcrete(ts) && pubs.some(p => isConcrete(p) && (instant(ts.starts_at) === null || instant(p.starts_at) === null || Math.abs(instant(ts.starts_at) - instant(p.starts_at)) <= WINDOW_MS))) {
      neighbors(`ts:${ts.source_id}`).add(`public:${group.event_id}`); neighbors(`public:${group.event_id}`).add(`ts:${ts.source_id}`);
    }
  }
  if (!tooMany) for (const ts of tsEvents) for (const group of publicGroups) {
    const pubs = group.source_ids.map(id => byId.get(id)), sources = [ts, ...pubs], sourceIds = unique(sources.map(e => e.source_id)), issues = [...scopeIssues];
    const add = (decision, reason) => { if (decision !== 'accepted') issues.push({decision, reason}); };
    for (const e of sources) { const p = proofs.get(e.source_id); add(p.decision, p.reason); }
    // Rejected entitlement may be reported by opaque source reference, but no
    // revoked/foreign private labels, scores, venue, hashes or state are emitted.
    if (sources.some(e => proofs.get(e.source_id).decision === 'separate')) {
      pairs.push({decision: 'separate', reasons: unique(issues.filter(i => i.decision === 'separate').map(i => i.reason)), source_ids: sourceIds, anchor_event_id: null, own_sides: [],
        evidence: {algorithm: TEAM_GAME_ALGORITHM, team_id: teamId, season_id: seasonId, source_content: [], restricted: true}});
      continue;
    }
    if (!formatter) add('pending', 'invalid_team_timezone');
    if (sources.some(e => memberships.get(e.source_id)?.some(g => g.established !== true))) add('pending', 'native_canonical_group_unproven');
    if (group.established !== true) add('pending', 'public_canonical_group_unproven');
    if (new Set(pubs.map(p => p.provider)).size !== pubs.length) add('review', 'same_provider_group_collision');
    for (const e of sources) {
      if (duplicateIds.has(e.source_id) || memberships.get(e.source_id)?.length !== 1 || !memberships.get(e.source_id)?.[0]?.event_id) add('review', 'source_canonical_membership_ambiguous');
      if (!isConcrete(e)) add('separate', 'not_concrete_game');
      if (e.time_precision !== 'instant' || e.all_day || e.time_pending || instant(e.starts_at) === null) add('pending', 'instant_evidence_incomplete');
      if (['CANCELLED', 'CANCELED', 'POSTPONED', 'INTERRUPTED'].includes(String(e.status).trim().toUpperCase())) add('review', 'initial_game_status_conflict');
    }
    const scope = coverageFor(sources, sourceSnapshot, connectionSnapshot); issues.push(...scope.checks);
    const allDays = unique(sources.map(e => localDay(instant(e.starts_at), formatter)).filter(present));
    if (allDays.length > 1) add('separate', 'different_local_day');
    const time = pubs.map(p => ({source_id: p.source_id, teamsnap_instant: ts.starts_at, public_instant: p.starts_at,
      delta_ms: instant(ts.starts_at) === null || instant(p.starts_at) === null ? null : Math.abs(instant(ts.starts_at) - instant(p.starts_at)),
      teamsnap_precision: ts.time_precision, public_precision: p.time_precision, local_day: localDay(instant(p.starts_at), formatter)}));
    if (time.some(t => t.delta_ms > WINDOW_MS)) add('review', 'initial_time_window_exceeded');
    const names = pubs.map(p => ({source_id: p.source_id, ...nameAssessment(ts, p, mappingFor(ownerDecisions, ts, p, teamId, seasonId))}));
    const venues = pubs.map(p => ({source_id: p.source_id, ...venueAssessment(ts, p)}));
    for (const assessment of [...names, ...venues]) for (const reason of assessment.reasons) add(assessment.decision, reason);
    // Check each official member against every other, even when a less-specific
    // calendar label would independently match either (e.g. Blue versus Red).
    for (let i = 0; i < pubs.length; i++) for (let j = i + 1; j < pubs.length; j++) {
      for (const assessment of [nameAssessment(pubs[i], pubs[j], null), venueAssessment(pubs[i], pubs[j])]) if (assessment.decision === 'review') for (const reason of assessment.reasons) add('review', `public_member_${reason}`);
    }
    const ownSides = sources.map(e => ({source_id: e.source_id, ...proofs.get(e.source_id)}));
    if (new Set(ownSides.map(p => p.side).filter(present)).size > 1) add('review', 'verified_own_side_conflict');
    const counts = {teamsnap: neighbors(`ts:${ts.source_id}`).size, public: neighbors(`public:${group.event_id}`).size};
    if (counts.teamsnap > 1 || counts.public > 1) add('review', 'reciprocal_candidate_collision');
    else if (counts.teamsnap !== 1 || counts.public !== 1) add('pending', 'reciprocal_uniqueness_unproven');
    const decisions = pairDecisions(ownerDecisions, sourceIds, teamId, seasonId);
    if (decisions.some(d => ['rejected', 'unlinked'].includes(d.decision) && d.source_ids.every(id => sourceIds.includes(id)))) add('separate', 'owner_pair_rejected');
    if (decisions.some(d => d.decision === 'accepted' && !d.source_ids.every(id => sourceIds.includes(id)))) add('review', 'conflicting_owner_pair');
    if (previous.some(old => old.source_ids.length > 1 && old.source_ids.some(id => sourceIds.includes(id)) && !sameSet(old.source_ids, sourceIds))) add('review', 'previous_group_membership_conflict');
    const durableRelated = acceptedAssociations.filter(a => a.type === 'team_game_association' && a.teamId === teamId && a.decision === 'accepted' && Array.isArray(a.source_ids) && a.source_ids.some(id => sourceIds.includes(id)));
    if (durableRelated.some(a => !sameSet(a.source_ids, sourceIds))) add('review', 'durable_association_membership_conflict');
    if (durableRelated.some(a => sameSet(a.source_ids, sourceIds) && !retainedAuthority(a.event_id, sourceIds))) add('pending', 'durable_acceptance_scope_unproven');
    const durableTargets = acceptedAssociations.filter(a => retainedAuthority(a.event_id, sourceIds)).map(a => ({...a, decision: 'accepted'}));
    const target = targetFor(sourceIds, bases, [...previous, ...durableTargets], manual, memberships.get(ts.source_id)?.[0]?.event_id ?? null);
    for (const reason of target.reasons) add(target.decision, reason);
    if (target.state_refs.length > TEAM_GAME_LIMITS.max_state_refs || byteLength(target.state_refs) > TEAM_GAME_LIMITS.max_proof_bytes) add('pending', 'owner_state_bound_exceeded');
    const scores = scoreAssessment(sources, proofs); for (const reason of scores.reasons) add(scores.decision, reason);
    const confirmation=manualPairConfirmation(decisions,sourceIds,proofs);
    const overridden=confirmation?unique(issues.filter(i=>MANUAL_IDENTITY_REASONS.has(i.reason)).map(i=>i.reason)):[],valueConflicts=confirmation?unique(issues.filter(i=>MANUAL_VALUE_REASONS.has(i.reason)).map(i=>i.reason)):[];
    const decision = decisionFor(confirmation?issues.filter(i=>!MANUAL_IDENTITY_REASONS.has(i.reason)&&!MANUAL_VALUE_REASONS.has(i.reason)):issues);
    pairs.push({decision, reasons: unique(issues.map(i => i.reason)), source_ids: sourceIds, anchor_event_id: target.event_id, own_sides: ownSides,
      evidence: {algorithm: TEAM_GAME_ALGORITHM, team_id: teamId, season_id: seasonId,
        ...(confirmation?{owner_confirmation:{...confirmation,overridden_reasons:overridden,value_conflicts:valueConflicts}}:{}),
        source_content: sources.map(e => ({source_id: e.source_id, content_hash: hashes.get(e.source_id), provider_content_hash: e.content_hash ?? null})).sort((a, b) => a.source_id.localeCompare(b.source_id)),
        connection_revision: connectionSnapshot.revision, source_revision: sourceSnapshot.revision, coverage: scope.coverage,
        time, names, venues, reciprocal_candidate_counts: counts, results: scores, state_refs: target.state_refs,
        canonical_event_ids: unique(sources.flatMap(e => memberships.get(e.source_id).map(g => g.event_id))),
        uncertainties: unique([...ownSides.filter(s => s.orientation_absent).map(s => `unknown_orientation:${s.source_id}`), ...venues.filter(v => v.field_evidence === 'one_sided').map(v => `one_sided_field:${v.source_id}`)])}});
  }
  for (const pair of pairs) if (byteLength(pair) > TEAM_GAME_LIMITS.max_proof_bytes) {
    const bytes = byteLength(pair);
    if (pair.decision === 'accepted') pair.decision = 'pending';
    pair.reasons = unique([...pair.reasons, 'proof_bound_exceeded']);
    pair.evidence = {algorithm: TEAM_GAME_ALGORITHM, overflow: true, original_bytes: bytes, source_content: pair.evidence.source_content, reciprocal_candidate_counts: pair.evidence.reciprocal_candidate_counts};
  }
  const assessmentOverflow = byteLength(pairs) > TEAM_GAME_LIMITS.max_assessment_bytes;
  if (assessmentOverflow) for (const pair of pairs) {
    if (pair.decision === 'accepted') pair.decision = 'pending';
    pair.reasons = unique([...pair.reasons, 'assessment_output_bound_exceeded']);
    pair.own_sides = []; pair.evidence = {algorithm: TEAM_GAME_ALGORITHM, overflow: true};
  }
  const groups = [], consumed = new Set(), stateHolds = [];
  const makeGroup = (eventId, sourceIds, decision, assessments, extras = {}) => ({teamId, seasonId, event_id: eventId, source_ids: unique(sourceIds), decision,
    native_event_ids: unique(sourceIds.flatMap(id => (memberships.get(id) || []).map(g => g.event_id))),
    state_refs: manual.filter(s => s.event_id === eventId || sourceIds.some(id => (memberships.get(id) || []).some(g => g.event_id === s.event_id))).map(stateReference),
    assessments, ...extras});
  for (const pair of pairs.filter(p => p.decision === 'accepted')) {
    groups.push(makeGroup(pair.anchor_event_id, pair.source_ids, 'accepted', [pair])); pair.source_ids.forEach(id => consumed.add(id));
  }
  // Durable records remain reachable even when the last projection split into
  // singletons/state holds. They are retention candidates, not relabeled prior
  // published membership; current entitlement and archived placement still gate.
  const retentionCandidates = previous.filter(g => g.source_ids.length > 1);
  for (const authority of acceptedAssociations.filter(a => a.type === 'team_game_association' && a.teamId === teamId && a.decision === 'accepted' && a.accepted_season_id === seasonId && Array.isArray(a.source_ids))) {
    if (!retentionCandidates.some(g => g.event_id === authority.event_id && sameSet(g.source_ids, authority.source_ids))) retentionCandidates.push({teamId, seasonId, event_id: authority.event_id, source_ids: [...authority.source_ids], retention_origin: 'durable'});
  }
  for (const old of retentionCandidates) {
    if (old.source_ids.some(id => consumed.has(id))) continue;
    const related = pairs.filter(p => p.source_ids.some(id => old.source_ids.includes(id)));
    const revoked = old.source_ids.some(id => !byId.has(id) || proofs.get(id)?.decision !== 'accepted');
    const rejected = pairDecisions(ownerDecisions, old.source_ids, teamId, seasonId).some(d => ['rejected', 'unlinked'].includes(d.decision) && d.source_ids.every(id => old.source_ids.includes(id)));
    const authority = retainedAuthority(old.event_id, old.source_ids);
    const overlap = retentionCandidates.some(other => other !== old && other.source_ids.some(id => old.source_ids.includes(id)));
    if (authority && authority.accepted_season_id === seasonId && !revoked && !rejected && !overlap && old.source_ids.length > 1 && old.source_ids.every(id => !consumed.has(id))) {
      const status = related.some(p => p.decision === 'review' || p.decision === 'separate') ? 'review' : 'pending';
      groups.push(makeGroup(old.event_id, old.source_ids, status, related, {previous_proof_withdrawn: true, retained_association: {association_id: authority.association_id, revision: authority.revision}, placement: {season_id: authority.accepted_season_id, starts_at: authority.starts_at, local_day: authority.local_day, effective_day: authority.effective_day}})); old.source_ids.forEach(id => consumed.add(id));
    } else {
      stateHolds.push({teamId, seasonId, event_id: old.event_id, historical_source_ids: [...old.source_ids], decision: 'review',
        reason: rejected ? 'owner_split_requires_state_resolution' : revoked ? 'source_scope_withdrawn' : !authority ? 'durable_acceptance_unproven' : authority.accepted_season_id !== seasonId ? 'accepted_placement_belongs_to_other_season' : 'previous_target_overlap',
        state_refs: manual.filter(s => s.event_id === old.event_id).map(stateReference)});
    }
  }
  for (const authority of acceptedAssociations.filter(a => a.type === 'team_game_association' && a.teamId === teamId && a.decision === 'accepted' && Array.isArray(a.source_ids))) {
    if (!groups.some(g => g.event_id === authority.event_id && sameSet(g.source_ids, authority.source_ids)) && !stateHolds.some(h => h.event_id === authority.event_id)) stateHolds.push({teamId, seasonId: authority.accepted_season_id, event_id: authority.event_id, historical_source_ids: [...authority.source_ids], decision: 'review', reason: 'durable_association_requires_resolution', state_refs: manual.filter(s => s.event_id === authority.event_id).map(stateReference)});
  }
  for (const base of bases) {
    const visible = base.source_ids.filter(id => byId.has(id) && !consumed.has(id) && proofs.get(id)?.decision !== 'separate');
    if (!visible.length) continue;
    const related = pairs.filter(p => p.source_ids.some(id => visible.includes(id)) && p.decision !== 'accepted');
    const decisions = related.map(p => p.decision);
    const ownDecisions = visible.map(id => proofs.get(id)?.decision);
    const decision = scopeIssues.some(i => i.decision === 'review') || ownDecisions.includes('review') || decisions.includes('review') ? 'review' : tooMany || scopeIssues.length || ownDecisions.includes('pending') || decisions.includes('pending') ? 'pending' : 'separate';
    groups.push(makeGroup(base.event_id, visible, decision, related, {inferred: false})); visible.forEach(id => consumed.add(id));
  }
  // Malformed input must not yield duplicate publishable target rows, even in
  // review. Quarantine the entire target and preserve its state references.
  const ambiguousTargets = new Set([...groups.filter((g, i) => groups.findIndex(other => other.event_id === g.event_id) !== i).map(g => g.event_id), ...bases.filter(g => g.source_ids.some(id => duplicateIds.has(id) || memberships.get(id)?.length !== 1)).map(g => g.event_id)]);
  const quarantined = groups.filter(g => ambiguousTargets.has(g.event_id)).map(g => ({...g, decision: 'review', publishable: false, reasons: ['canonical_target_ambiguous']}));
  for (let i = groups.length - 1; i >= 0; i--) if (ambiguousTargets.has(groups[i].event_id)) { groups[i].source_ids.forEach(id => consumed.delete(id)); groups.splice(i, 1); }
  for (const eventId of ambiguousTargets) stateHolds.push({teamId, seasonId, event_id: eventId, historical_source_ids: unique([...quarantined, ...bases].filter(g => g.event_id === eventId).flatMap(g => g.source_ids)), decision: 'review', reason: 'canonical_target_ambiguous', state_refs: manual.filter(s => s.event_id === eventId).map(stateReference)});
  const unmatched = events.filter(e => !consumed.has(e.source_id)).map(e => ({source_id: e.source_id, decision: proofs.get(e.source_id)?.decision === 'separate' ? 'separate' : 'pending',
    reason: proofs.get(e.source_id)?.reason || 'canonical_membership_missing'}));
  groups.sort((a, b) => String(a.event_id).localeCompare(String(b.event_id)));
  const fence = {teamId, seasonId,
    connection_snapshot_hash: await digest({...connectionSnapshot, connections: [...(connectionSnapshot.connections || [])].sort((a, b) => a.id.localeCompare(b.id)), aliases: [...(connectionSnapshot.aliases || [])].sort((a, b) => stableJSON(a).localeCompare(stableJSON(b)))}),
    accepted_association_hash: await digest([...acceptedAssociations].sort((a, b) => stableJSON(a).localeCompare(stableJSON(b)))),
    canonical_group_hash: await digest(bases), owner_decision_hash: await digest([...ownerDecisions].sort((a, b) => stableJSON(a).localeCompare(stableJSON(b)))),
    manual_state_hash: await digest([...manualState].sort((a, b) => stableJSON(a).localeCompare(stableJSON(b)))),
    source_revision: sourceSnapshot.revision ?? null, connection_revision: connectionSnapshot.revision ?? null,
    connections: (connectionSnapshot.connections || []).filter(c => c.app_team_id === teamId && c.team_season_id === seasonId).map(c => ({id: c.id, generation: c.generation, account_generation: c.account_generation ?? null, membership_generation: c.membership_generation ?? null, active: c.active, excluded: c.excluded})).sort((a, b) => a.id.localeCompare(b.id))};
  // Receipt/fence hashes are exact publication evidence. Semantic grouping
  // excludes freshness-only scan receipt identities so reports can distinguish
  // renewed proof from a changed game, source fact, decision or saved state.
  const semanticPair = pair => {
    const {coverage, connection_revision, source_revision, ...evidence} = pair.evidence;
    const coverageSemantics = unique((coverage || []).map(c => stableJSON({connection_id: c.connection_id ?? null, attachment_id: c.attachment_id ?? null, attachment_generation: c.attachment_generation ?? null, provider: c.provider, source_team_id: c.source_team_id, generation: c.generation, complete: c.complete, from: c.from, to: c.to}))).map(v => JSON.parse(v));
    return {...pair, evidence: {...evidence, coverage: coverageSemantics}};
  };
  const semanticGroups = groups.map(g => ({...g, assessments: g.assessments.map(semanticPair)}));
  const semanticHash = await digest({algorithm: TEAM_GAME_ALGORITHM, teamId, seasonId, coverage_scope: {complete: sourceSnapshot.complete, overflow: sourceSnapshot.overflow, windows: [...(sourceSnapshot.windows || [])].sort((a,b) => stableJSON(a).localeCompare(stableJSON(b)))}, groups: semanticGroups, unmatched, stateHolds, quarantined: quarantined.map(g => ({...g, assessments: g.assessments.map(semanticPair)}))});
  return {algorithm: TEAM_GAME_ALGORITHM, teamId, seasonId, groups, assessments: pairs, unmatched, state_holds: stateHolds,
    review_records: [...groups.filter(g => g.decision === 'review'), ...quarantined], pending: tooMany || assessmentOverflow || scopeIssues.some(i => i.decision === 'pending') || groups.some(g => g.decision === 'pending') || unmatched.some(g => g.decision === 'pending'),
    reasons: unique([...scopeIssues.map(i => i.reason), ...(tooMany ? ['candidate_pair_bound_exceeded'] : []), ...(assessmentOverflow ? ['assessment_output_bound_exceeded'] : [])]),
    candidate_counts: {teamsnap: tsEvents.length, public: publicGroups.length, pairs: tsEvents.length * publicGroups.length}, fence,
    semantic_hash: semanticHash,
    proof_hash: await digest({fence, groups, unmatched, stateHolds, quarantined})};
}

/** Pure read contract for future shared consumers. Reject public contexts: this
 * association must never authorize private expansion of H2H/opponent history.
 * storedBookmarkKey is returned unchanged and is never replaced by the target.
 */
export function resolveScopedGameReference({teamId, seasonId, groups, reference, audience = 'team', storedBookmarkKey = null}) {
  if (audience !== 'team' || !present(reference)) return null;
  const matches = groups.filter(g => scoped(g, teamId, seasonId) && (g.event_id === reference || g.source_ids.includes(reference) || g.native_event_ids?.includes(reference)));
  if (matches.length !== 1) return null;
  const g = matches[0];
  return {teamId, seasonId, event_id: g.event_id, source_ids: [...g.source_ids], decision: g.decision, stored_bookmark_key: storedBookmarkKey};
}
