// These helpers run in the extension realm, not in the inspected page.
export function directFrameURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
export function restoreFields(state, saved) {
  if (saved?.id !== state.id || saved.resetEpoch !== state.resetEpoch) {
    return { query: state.query, replacement: '', selected: -1 };
  }
  return { query: saved.query, replacement: saved.replacement,
    selected: saved.revision === state.revision && !state.busy && Number.isInteger(saved.selected) &&
      saved.selected >= 0 && saved.selected < state.results.length ? saved.selected : -1 };
}
export function unpackResult(results) {
  const result = results?.[0]?.result;
  if (result == null) throw new Error('The page did not respond. Try opening the extension again.');
  if (typeof result.error === 'string') throw new Error(result.error);
  return result;
}
