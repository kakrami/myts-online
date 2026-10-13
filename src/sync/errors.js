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
