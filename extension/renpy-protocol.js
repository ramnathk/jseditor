// These helpers run in the extension realm, not in the inspected page (RENPY_MODE_REQUIREMENTS.md).
const TYPES = new Set(['bool', 'int', 'float', 'str', 'unavailable']);

// Converts the replacement text into the canonical {t, s} form that the Python program re-validates.
export function parseReplacement(type, raw) {
  raw = String(raw ?? '');
  if (raw.length === 0) throw new Error('Enter a new value.');
  if (type === 'str') return { t: 'str', s: raw };
  if (type === 'int') {
    const n = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isSafeInteger(n)) throw new Error('Enter a whole number.');
    return { t: 'int', s: String(n === 0 ? 0 : n) };
  }
  if (type === 'float') {
    const n = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(n)) throw new Error('Enter a finite number.');
    return { t: 'float', s: String(n) };
  }
  if (type === 'bool') {
    if (!/^(true|false)$/i.test(raw)) throw new Error('Enter true or false.');
    return { t: 'bool', s: raw.toLowerCase() };
  }
  throw new Error('This value cannot be edited.');
}

// The page (or a spoofed bridge) produced this object, so bound and re-type everything.
export function sanitizeSnapshot(state) {
  if (!state || typeof state !== 'object') throw new Error('The page did not respond. Try opening the extension again.');
  const text = (value, max) => String(value ?? '').slice(0, max);
  const int = value => Number.isSafeInteger(value) ? value : 0;
  const rows = Array.isArray(state.results) ? state.results.slice(0, 10000) : [];
  return {
    backend: 'renpy', id: text(state.id, 100), revision: int(state.revision), resetEpoch: int(state.resetEpoch),
    searched: state.searched === true, busy: state.busy === true, stalled: state.stalled === true,
    truncated: state.truncated === true, message: text(state.message, 400), query: text(state.query, 400),
    detail: text(state.detail, 4096),
    results: rows.map(row => ({
      path: text(row?.path, 300), type: TYPES.has(row?.type) ? row.type : 'unavailable',
      value: text(row?.value, 200), writable: row?.writable === true, cls: text(row?.cls, 60),
    })),
  };
}
