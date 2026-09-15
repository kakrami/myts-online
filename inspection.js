// Read public source as data. Never eval, execute a captured expression, or forward credentials.
const SYSTEM = 'https://system.gotsport.com';
const numeric = value => /^[1-9]\d{0,11}$/.test(String(value ?? ''));
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function decodeEscape(source, index) {
  const char = source[index + 1];
  const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
  if (char === undefined) throw new Error('Incomplete JavaScript escape.');
  if (char === '\n') return { value: '', end: index + 2 };
  if (char === '\r') return { value: '', end: index + (source[index + 2] === '\n' ? 3 : 2) };
  if (char === 'x' || char === 'u') {
    const rest = source.slice(index + 2);
    const match = char === 'x' ? rest.match(/^[\da-f]{2}/i) : rest.match(/^\{[\da-f]{1,6}\}|^[\da-f]{4}/i);
    if (!match) throw new Error('Invalid JavaScript escape.');
    const code = parseInt(match[0].replace(/[{}]/g, ''), 16);
    if (code > 0x10ffff) throw new Error('Invalid Unicode code point.');
    return { value: String.fromCodePoint(code), end: index + 2 + match[0].length };
  }
  return { value: hasOwn(simple, char) ? simple[char] : char, end: index + 2 };
}
function interpolationEnd(source, start, depth = 0) {
  if (depth > 12) throw new Error('Nested source expression exceeds inspection limit.');
  let level = 1, index = start;
  for (; index < source.length; index++) {
    const char = source[index];
    if ('\'"`'.includes(char)) { index = readLiteral(source, index, depth + 1).end - 1; continue; }
    if (source.startsWith('//', index)) { const end = source.indexOf('\n', index + 2); if (end < 0) break; index = end; continue; }
    if (source.startsWith('/*', index)) { const end = source.indexOf('*/', index + 2); if (end < 0) break; index = end + 1; continue; }
    if (char === '{') level++;
    if (char === '}' && --level === 0) return index;
  }
  throw new Error('Unterminated source expression.');
}
function readLiteral(source, start, depth = 0) {
  const quote = source[start];
  if (!'\'"`'.includes(quote)) throw new Error('Expected a literal string or template.');
  const parts = []; let text = '', index = start + 1;
  for (; index < source.length;) {
    if (source[index] === '\\') { const decoded = decodeEscape(source, index); text += decoded.value; index = decoded.end; continue; }
    if (source[index] === quote) { parts.push({ literal: text }); return { parts, end: index + 1, expression: source.slice(start, index + 1) }; }
    if (quote === '`' && source.startsWith('${', index)) {
      parts.push({ literal: text }); text = '';
      const end = interpolationEnd(source, index + 2, depth);
      parts.push({ slot: source.slice(index + 2, end) }); index = end + 1; continue;
    }
    if (quote !== '`' && /[\n\r]/.test(source[index])) throw new Error('Unterminated JavaScript string.');
    text += source[index++];
  }
  throw new Error('Unterminated JavaScript literal.');
}
function resourcePathAllowed(path) {
  if (!path.startsWith('/') || path.startsWith('//') || /[%\\?#\s\x00-\x1f\x7f]/.test(path)) return false;
  if (path.split('/').some(part => part === '.' || part === '..')) return false;
  if (/(?:^|\/)(?:create|new|update|edit|destroy|delete|remove|cancel|accept|reject|approve|send|invite|export|login|logout|users?|people|players?|rosters?|payments?|registrations?)(?:\/|$)/i.test(path)) return false;
  return /(?:^|\/)(?:[a-z_]*events?|[a-z_]*flights?|[a-z_]*schedules?|schedule_groups?|brackets?|matches)(?:\/|$)/i.test(path);
}
function definitionsFromSource(source, sourceUrl, maxDefinitions = 200) {
  // These are source-literal candidates, NOT a claim that a network call ran.
  const pattern = /[,{]\s*(?:path|"path"|'path')\s*:\s*/g;
  const definitions = [], skipped = []; let matches = 0, truncated = false;
  for (const match of source.matchAll(pattern)) {
    matches++;
    if (definitions.length >= maxDefinitions) { truncated = true; break; }
    const offset = match.index + match[0].length;
    if (!'\'"`'.includes(source[offset] || ' ')) {
      skipped.push({ character_offset: offset, reason: 'Path is computed or supplied through a variable; retained for source inspection.' });
      continue;
    }
    try {
      const literal = readLiteral(source, offset);
      const samplePath = literal.parts.map(part => hasOwn(part, 'literal') ? part.literal : '1').join('');
      if (!resourcePathAllowed(samplePath)) continue;
      // Concatenation must not be mistaken for a complete path literal.
      if (!/^\s*[,}]/.test(source.slice(literal.end, literal.end + 100))) {
        skipped.push({ character_offset: offset, reason: 'Literal is part of a larger computed path; not executable by inspection.' });
        continue;
      }
      definitions.push({
        source_url: sourceUrl, character_offset: offset, expression: literal.expression,
        parts: literal.parts, slot_expressions: literal.parts.filter(part => hasOwn(part, 'slot')).map(part => part.slot),
        sample_shape: literal.parts.map(part => hasOwn(part, 'literal') ? part.literal : '{numeric-id}').join(''),
        context_start: Math.max(0, match.index - 1400),
        context: source.slice(Math.max(0, match.index - 1400), Math.min(source.length, literal.end + 1800)),
        basis: 'Published path property literal. Request method, parameter meaning, and response schema still require inspection.',
      });
    } catch (error) { skipped.push({ character_offset: offset, reason: error.message }); }
  }
  return { definitions, path_property_count: matches, skipped: skipped.slice(0, 100), skipped_truncated: skipped.length > 100, truncated };
}
function integer(value, fallback, max, label) {
  if (value === null || value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new Error(`${label} must be an integer from 0 to ${max}.`);
  return Number(value);
}
function sourceWindow(source, params, makeUrl) {
  let offset = integer(params.get('offset'), 0, source.length, 'offset');
  const length = integer(params.get('length'), 16000, 48000, 'length');
  if (length < 100) throw new Error('length must be at least 100 characters.');
  const term = params.get('find'); let matchOffset = null, nextMatch = null;
  if (term !== null) {
    if (!term || term.length > 160) throw new Error('find must contain 1–160 literal characters.');
    matchOffset = source.indexOf(term, offset);
    if (matchOffset < 0) return { total_characters: source.length, found: false, search_from: offset, find: term, next_url: null, source: '' };
    nextMatch = source.indexOf(term, matchOffset + term.length);
    offset = Math.max(0, matchOffset - Math.floor(length / 3));
  }
  const end = Math.min(source.length, offset + length);
  const value = { total_characters: source.length, offset, end, source: source.slice(offset, end),
    next_url: end < source.length ? makeUrl({ offset: end, length }) : null };
  if (term !== null) Object.assign(value, { found: true, find: term, match_offset: matchOffset,
    next_match_url: nextMatch >= 0 ? makeUrl({ find: term, offset: matchOffset + term.length, length }) : null });
  return value;
}
function requestUrl(definition, slotsRaw, queryRaw) {
  let slots, query;
  try { slots = JSON.parse(slotsRaw || '[]'); query = JSON.parse(queryRaw || '{}'); }
  catch { throw new Error('slots must be a JSON array and query must be a JSON object.'); }
  if (!Array.isArray(slots) || slots.length !== definition.slot_expressions.length || slots.some(value => !numeric(value))) throw new Error('Provide exactly one positive numeric ID for each recorded template slot.');
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).length > 16) throw new Error('query must be an object with at most 16 primitive fields.');
  let nextSlot = 0;
  const relative = definition.parts.map(part => hasOwn(part, 'literal') ? part.literal : String(slots[nextSlot++])).join('');
  if (!resourcePathAllowed(relative)) throw new Error('The recorded path is not an eligible public event/schedule/match resource.');
  const url = new URL(SYSTEM + '/api/v1' + relative);
  for (const [key, value] of Object.entries(query)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(key) || /(?:url|uri|redirect|callback|token|password|auth|cookie|secret|command|method|prototype|constructor)/i.test(key)) throw new Error('Unsupported inspection query key.');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Query numbers must be finite.');
    if (!['boolean', 'number', 'string'].includes(typeof value) || String(value).length > 100 || !/^[a-zA-Z0-9_. ,:+-]*$/.test(String(value))) throw new Error('Inspection query values must be small scalar values, not objects, paths, or URLs.');
    url.searchParams.set(key, String(value));
  }
  return { url: url.href, slots, query };
}
async function sha256(source) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export { definitionsFromSource, sourceWindow, requestUrl, sha256, integer, readLiteral, resourcePathAllowed };
