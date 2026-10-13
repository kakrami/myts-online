import { bytes, requireValue } from './common.js';

// This is a storage slice, independent of the provider's HTTP page size. Keep
// half of the coordinator's 2,000,000-byte allowance for continuation, coverage,
// audit and the application's at-most-128 UUID-based projection specs. These
// two components emit no provider children. This is not a sizing contract for
// arbitrary collector child specs. The source builder runs only once, after
// this prefix is chosen; trying successively smaller builds spends DB reads.
export const TEAMSNAP_SOURCE_PARAMETER_BUDGET = 1000000;

function attendanceParameterBytes(row, accountId) {
  // Admission estimate only: buildAuxiliaryPage remains the sole writer. Size
  // its persisted shape, not unused native_status/evidence DTO copies. Match
  // auxiliaryKey's URI expansion and the writer's status/null conversions.
  const ref = value => `teamsnap/${encodeURIComponent(accountId)}/${encodeURIComponent(value.slice(value.indexOf(':') + 1))}`;
  const source_team_id = ref(row.team_id), source_event_id = ref(row.fixture_id), source_player_id = ref(row.player_id);
  const nativeStatus = row.status_code ?? row.status ?? null;
  const stored = {
    id: `${source_team_id}|${source_event_id}|${source_player_id}`, account_id: accountId,
    source_team_id, source_event_id, source_player_id,
    status: row.normalized_status || ({0:'No',1:'Yes',2:'Maybe'}[String(nativeStatus)] || (nativeStatus == null || nativeStatus === '' ? 'NR' : 'Unknown')),
    source_status: nativeStatus == null ? null : String(nativeStatus),
    observed_at: row.observed_at || '0000-00-00T00:00:00.000Z', provenance: 'provider', content_hash: '0'.repeat(64),
  };
  // One JSON upsert plus event IDs in the epoch write and both dirty-consumer
  // inputs. Size their actual extra statement.params JSON layer. Per-row array
  // wrappers and repeated event IDs deliberately overcount shared punctuation
  // and deduplication. Attendance never serializes prior status/evidence or
  // event facts: dirty-consumer SQL reads those facts from existing events.
  return bytes([JSON.stringify([stored])]) + 3 * bytes([JSON.stringify([source_event_id])]);
}

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
  // Reserve fixed source envelopes, coverage, precondition/revision scalars
  // and their remaining account/scan copies before charging individual rows.
  let used = 32768 + 16 * (accountBytes + bytes(JSON.stringify(scanId)));
  // validatePage also bounds the selected DTOs to 1.75 MB. Attendance keeps
  // three status copies there even though only one is persisted. Include the
  // records/fixtures wrappers and one conservative comma per selected record.
  let attendanceDTOBytes = kind === 'attendance' ? bytes({attendance:[]}) + bytes([]) : 0;
  let count = 0;
  for (const row of rows) {
    requireValue(row && typeof row === 'object' && !Array.isArray(row), 'Invalid TeamSnap source record.', 'contract_violation');
    const json = JSON.stringify(row);
    const rowBytes = bytes(json);
    // Measure UTF-8 and the actual extra JSON layer used by statement.params.
    // Events: three source_events parameter copies, each at most twice this
    // DTO (evidence plus extracted labels/title/venue), plus one logistics copy.
    // 16 KiB per item covers generated keys/hash/column names, IDs and the two
    // dirty-consumer copies of current AND prior home/away/start/day facts. Prior
    // evidence is never serialized there. The 32 account copies cover URI keys
    // in those facts and auxiliary IDs, in addition to unencoded DTO fields.
    const cost = kind === 'attendance' ? attendanceParameterBytes(row, accountId) : 7 * bytes([json]) + 16384 + 32 * accountBytes;
    if (rowBytes > 64000 || used + cost > TEAMSNAP_SOURCE_PARAMETER_BUDGET || kind === 'attendance' && attendanceDTOBytes + rowBytes + 1 > 1750000) {
      requireValue(count > 0, 'A TeamSnap record exceeds its storage slice bound.', 'record_too_large');
      break;
    }
    used += cost;
    if (kind === 'attendance') attendanceDTOBytes += rowBytes + 1;
    count++;
  }
  return count;
}
