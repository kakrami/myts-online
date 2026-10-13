import { SyncError } from './errors.js';
export class BudgetDB {
  constructor(raw, limit = 48) { this.raw = raw; this.limit = limit; this.used = 0; this.rowsRead = 0; this.rowsWritten = 0; }
  get remaining() { return this.limit - this.used; }
  reserve(n) {
    if (n > this.remaining) throw new SyncError('invocation_budget', 'Continue in another invocation.', { retryAfterMs: 1000 });
    this.used += n;
  }
  measure(result) { this.rowsRead += result?.meta?.rows_read || 0; this.rowsWritten += result?.meta?.rows_written || 0; }
  prepare(sql) {
    const owner = this;
    function wrap(statement) {
      return { _raw: statement, bind(...params) { return wrap(statement.bind(...params)); },
        async all() { owner.reserve(1); const result = await statement.all(); owner.measure(result); return result; },
        async first(column) { const result = await this.all(); const row = result.results[0] || null; return column && row ? row[column] : row; },
        async run() { owner.reserve(1); const result = await statement.run(); owner.measure(result); return result; } };
    }
    return wrap(this.raw.prepare(sql));
  }
  async batch(statements) {
    this.reserve(statements.length);
    const results = await this.raw.batch(statements.map(statement => statement._raw || statement));
    results.forEach(result => this.measure(result)); return results;
  }
}
