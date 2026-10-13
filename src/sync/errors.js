import {teamSnapDiagnosticSuffix} from '../sources/teamsnap-diagnostics.js';
export class SyncError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.failureKind = options.kind || 'temporary';
    this.retryAfterMs = options.retryAfterMs || 0;
  }
}
const blocked = new Set(['authentication_required', 'authorization_revoked', 'human_verification', 'account_access_lost', 'source_access_denied']);
const permanent = new Set(['unsupported_response', 'invalid_job', 'contract_violation', 'source_contract', 'record_too_large']);
export function classifyFailure(error) {
  const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : 'collector_failed';
  const requestedKind = error?.failureKind || (blocked.has(code) ? 'blocked' : permanent.has(code) ? 'permanent' : 'temporary');
  const kind = ['temporary','blocked','permanent'].includes(requestedKind) ? requestedKind : 'temporary';
  // Provider response bodies, headers, URLs, cookies and tokens never become a status message.
  const messages = {
    authentication_required: 'Sign in to this source again.',
    authorization_revoked: 'Source authorization was revoked.',
    human_verification: 'This source requires human verification.',
    account_access_lost: 'This account no longer has access to the selected source.',
    source_access_denied: 'This source denied automated access.',
    unsupported_response: 'This source returned an unsupported data format.',
    contract_violation: 'The collector result did not satisfy its storage contract.',
    source_contract: 'Native source data did not satisfy its storage contract.',
    record_too_large: 'A source record exceeded its documented bound.',
    rate_limited: 'This source asked us to wait before retrying.',
    collector_timeout: 'This source did not respond in time.',
    source_changing: 'This source changed during collection. Saved data is available; verification will retry shortly.',
    collector_failed: 'The source update failed. Saved data is available.',
  };
  return { code, kind, message: (messages[code] || 'The source update failed. Saved data is available.') + teamSnapDiagnosticSuffix(error),
    retryAfterMs: Math.max(0, Number(error?.retryAfterMs) || 0) };
}

// Failure-only operational diagnostics. Never pass an error/lease/DB object to
// the logger: only these static labels and bounded numeric counters may leave.
const diagnosticPhases = new Set(['collect','commit','fail','runtime_setup','runtime_claim','runtime_job','runtime_after_job']);
const diagnosticMessages = new Map([
  ['CHECK constraint failed: expected_input=actual_input','precondition'],
  ['FOREIGN KEY constraint failed','constraint_foreign_key'],
  ['too many terms in compound SELECT','sql_terms'],
  ['too many SQL variables','sql_parameters'],
  ['string or blob too big','sql_size'], ['statement too long','sql_size'],
  ['installation_epoch_required','epoch'], ['installation_upgrade_permit_required','epoch'],
  ['installation_permit_mode_immutable','epoch'], ['installation_journal_immutable','epoch'],
  ['team_game_extension_permit_required','epoch'], ['team_game_upgrade_permit_required','epoch'],
  ['team_game_permit_mode_immutable','epoch'], ['team_game_installation_immutable','epoch'],
  ['team_game_legacy_open_failed','epoch'], ['team_game_legacy_close_failed','epoch'],
  ['team_game_scope_mismatch','constraint_scope'], ['team_game_target_scope','constraint_scope'],
  ['team_game_revision_mismatch','constraint_revision'],
  ['team_game_owner_decision_required','constraint_decision'],
  ['team_game_published_acceptance_required','constraint_decision'],
  ['team_game_run_format_immutable','constraint_immutable'], ['team_game_identity_immutable','constraint_immutable'],
  ['team_game_decision_immutable','constraint_immutable'], ['team_game_published_immutable','constraint_immutable'],
]);
const diagnosticCodes = new Map([
  ['invocation_budget','invocation_budget'], ['record_too_large','record_size'],
  ['contract_violation','contract'], ['source_contract','contract'],
  ['installation_maintenance','epoch'], ['installation_write_contract','epoch'],
  ['SQLITE_CONSTRAINT','constraint'], ['SQLITE_CONSTRAINT_CHECK','constraint_check'],
  ['SQLITE_CONSTRAINT_FOREIGNKEY','constraint_foreign_key'], ['SQLITE_CONSTRAINT_UNIQUE','constraint_unique'],
  ['SQLITE_CONSTRAINT_PRIMARYKEY','constraint_unique'], ['SQLITE_CONSTRAINT_NOTNULL','constraint_not_null'],
  ['SQLITE_CONSTRAINT_TRIGGER','constraint_trigger'], ['SQLITE_TOOBIG','sql_size'],
  [19,'constraint'], [275,'constraint_check'], [787,'constraint_foreign_key'],
  [2067,'constraint_unique'], [1555,'constraint_unique'], [1299,'constraint_not_null'],
  [1811,'constraint_trigger'], [18,'sql_size'],
]);
// Data properties only: do not invoke error getters, toString, toJSON or stacks.
function diagnosticValue(value,key) {
  if (!value || (typeof value!=='object' && typeof value!=='function')) return undefined;
  try { return Object.getOwnPropertyDescriptor(value,key)?.value; } catch { return undefined; }
}
function diagnosticReason(error) {
  let fallback='unknown';
  const seen=new Set();
  for(let depth=0;depth<4 && error && !seen.has(error);depth++) {
    seen.add(error);
    const message=diagnosticValue(error,'message');
    if(typeof message==='string' && message.length<=1024) {
      // Only known D1 wrappers and exact SQLite messages are recognized. The
      // unmatched text is neither copied into the output nor coerced to text.
      const normalized=message.replace(/: SQLITE_CONSTRAINT \(extended: (SQLITE_CONSTRAINT_(?:CHECK|FOREIGNKEY|UNIQUE|PRIMARYKEY|NOTNULL|TRIGGER))\)$/,': $1');
      const suffix=/: (SQLITE_(?:ERROR|TOOBIG|CONSTRAINT(?:_(?:CHECK|FOREIGNKEY|UNIQUE|PRIMARYKEY|NOTNULL|TRIGGER))?))$/.exec(normalized);
      const codeReason=diagnosticCodes.get(suffix?.[1]);
      if(codeReason && (fallback==='unknown' || fallback==='constraint'))fallback=codeReason;
      const text=normalized.replace(/^D1_ERROR: /,'').replace(/: SQLITE_(?:ERROR|TOOBIG|CONSTRAINT(?:_(?:CHECK|FOREIGNKEY|UNIQUE|PRIMARYKEY|NOTNULL|TRIGGER))?)$/,'');
      const known=diagnosticMessages.get(text);
      if(known)return known;
      if(/^Expression tree is too large \(maximum depth [0-9]{1,6}\)$/.test(text))return 'sql_depth';
      if(/^(?:UNIQUE|NOT NULL) constraint failed: [a-zA-Z_][a-zA-Z0-9_.]*(?:, [a-zA-Z_][a-zA-Z0-9_.]*)*$/.test(text))return text.startsWith('UNIQUE')?'constraint_unique':'constraint_not_null';
    }
    for(const key of ['code','errcode','errno']) {
      const known=diagnosticCodes.get(diagnosticValue(error,key));
      if(known && (fallback==='unknown' || fallback==='constraint'))fallback=known;
    }
    error=diagnosticValue(error,'cause');
  }
  return fallback;
}
function diagnosticCount(value,max) {
  return Number.isSafeInteger(value) && value>=0 ? Math.min(value,max) : undefined;
}
export function logSyncFailure(phase,error,{db,lease,started,leaseLost=false,originalError,originalPhase}={}) {
  try {
    if(!diagnosticPhases.has(phase))return;
    if(!phase.startsWith('runtime_') && !(diagnosticValue(lease,'provider')==='domain' && diagnosticValue(lease,'component')==='projection'))return;
    const output={event:'sync_failure_diagnostic',phase,reason:leaseLost?'lease_lost':diagnosticReason(error)};
    if(originalPhase==='collect' || originalPhase==='commit') {
      output.original_phase=originalPhase;output.original_reason=diagnosticReason(originalError);
    }
    const now=Date.now(),attemptAt=diagnosticValue(lease,'last_attempt_at'),until=diagnosticValue(lease,'lease_until');
    const start=Number.isSafeInteger(started)?started:attemptAt;
    const counts={statements_used:db?.used,statements_remaining:db?.remaining,
      attempt:diagnosticValue(lease,'attempts'),generation:diagnosticValue(lease,'generation'),
      elapsed_ms:Number.isSafeInteger(start)?Math.max(0,now-start):undefined,
      lease_remaining_ms:Number.isSafeInteger(until)?Math.max(0,until-now):undefined};
    for(const [key,value] of Object.entries(counts)) {
      const count=diagnosticCount(value,key.endsWith('_ms')?86400000:1000000);
      if(count!==undefined)output[key]=count;
    }
    console.warn(output);
  } catch { /* Diagnostics never replace the original result or exception. */ }
}
