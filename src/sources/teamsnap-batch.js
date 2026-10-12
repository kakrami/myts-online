import { bytes, requireValue } from './common.js';

// This is a storage slice, independent of the provider's HTTP page size. Keep
// half of the coordinator's 2,000,000-byte allowance for continuation, coverage,
// audit and the application's at-most-128 UUID-based projection specs. These
// two components emit no provider children. This is not a sizing contract for
// arbitrary collector child specs. The source builder runs only once, after
// this prefix is chosen; trying successively smaller builds spends DB reads.
export const TEAMSNAP_SOURCE_PARAMETER_BUDGET = 1000000;

/** Select a prefix of already-normalized event or attendance DTOs. The caller
 * advances its provider-page offset by this exact count, never by candidates.
 * Nothing is truncated or discarded, including an oversized later record: it
 * remains the first candidate next time and then fails with record_too_large.
 */
export function teamSnapBatchLength(kind, rows, { accountId, scanId = '' } = {}) {
  requireValue(['events', 'attendance'].includes(kind) && Array.isArray(rows) && typeof accountId === 'string' && accountId,
    'Invalid TeamSnap storage slice.', 'contract_violation');
  // Private source keys URI-encode account IDs. Charge that expansion directly,
  // rather than assuming all existing installations use UUID account IDs.
  const accountBytes = bytes(JSON.stringify(encodeURIComponent(accountId)));
  let used = 32768 + 16 * (accountBytes + bytes(JSON.stringify(scanId)));
  let count = 0;
  for (const row of rows) {
    requireValue(row && typeof row === 'object' && !Array.isArray(row), 'Invalid TeamSnap source record.', 'contract_violation');
    const json = JSON.stringify(row);
    // Measure UTF-8 and the actual extra JSON layer used by statement.params.
    // Events: three source_events parameter copies, each at most twice this
    // DTO (evidence plus extracted labels/title/venue), plus one logistics copy.
    // Attendance has one persisted row; the same factor is a conservative bound.
    // 16 KiB per item covers generated keys/hash/column names, IDs and the two
    // dirty-consumer copies of current AND prior home/away/start/day facts. Prior
    // evidence is never serialized there. The 32 account copies cover URI keys
    // in those facts and auxiliary IDs, in addition to unencoded DTO fields.
    const cost = 7 * bytes([json]) + 16384 + 32 * accountBytes;
    if (bytes(json) > 64000 || used + cost > TEAMSNAP_SOURCE_PARAMETER_BUDGET) {
      requireValue(count > 0, 'A TeamSnap record exceeds its storage slice bound.', 'record_too_large');
      break;
    }
    used += cost;
    count++;
  }
  return count;
}
