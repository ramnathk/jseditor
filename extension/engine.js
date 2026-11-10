// This function is serialized by chrome.scripting. Keep all dependencies inside it.
export async function pageEngine(command = 'state', payload = {}) {
  try {
    const stateKey = Symbol.for('game-value-editor.state.v2');
    if (!Object.hasOwn(window, stateKey)) {
      Object.defineProperty(window, stateKey, {
        value: { id: `${performance.timeOrigin}:${Math.random()}`, revision: 0, resetEpoch: 0, matches: [], searched: false, busy: false,
          message: 'Enter a value to begin.', truncated: false, query: '' },
        configurable: true,
      });
    }
    const state = window[stateKey];
    const isContainer = value => value !== null && (typeof value === 'object' || typeof value === 'function');
    const supported = value => ['number', 'string', 'boolean'].includes(typeof value);
    const matches = (value, query) => {
      if (typeof value === 'string') return value.toLowerCase() === query.toLowerCase();
      if (typeof value === 'number') return query.trim() !== '' && Number.isFinite(Number(query)) && value === Number(query);
      if (typeof value === 'boolean') return String(value) === query.toLowerCase();
      return false;
    };
    // Never invoke accessors to discover a property or follow a path.
    const resolve = path => {
      let parent = window;
      for (let index = 0; index < path.length; index++) {
        if (!isContainer(parent) || ArrayBuffer.isView(parent)) return null;
        let descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(parent, path[index]); } catch { return null; }
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
        if (index === path.length - 1) return { parent, key: path[index], descriptor, value: descriptor.value };
        parent = descriptor.value;
      }
      return null;
    };
    const pathLabel = path => 'window' + path.map(key => /^[a-zA-Z_$][\w$]*$/.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']').join('');
    const snapshot = () => ({
      id: state.id, revision: state.revision, resetEpoch: state.resetEpoch, searched: state.searched, busy: state.busy, message: state.message,
      query: state.query, truncated: state.truncated,
      results: state.matches.map(path => {
        const current = resolve(path);
        return { path: pathLabel(path), type: current ? typeof current.value : 'unavailable',
          value: current && supported(current.value) ? String(current.value) : '(unavailable)',
          writable: Boolean(current && supported(current.value) && current.descriptor.writable) };
      }),
    });
    if (command === 'frames') {
      return Array.from(document.querySelectorAll('iframe')).map(frame => {
        const rect = frame.getBoundingClientRect();
        const raw = frame.getAttribute('src');
        // Only resolve the URL here; the extension (popup-state.js) re-checks the scheme
        // before using it, since this code runs in the page and its output isn't trusted.
        let url = null;
        try { if (raw) url = new URL(raw, document.baseURI).href; } catch { /* No standalone URL. */ }
        return { url, title: frame.title || 'Embedded content', area: Math.max(0, rect.width) * Math.max(0, rect.height) };
      }).sort((a, b) => b.area - a.area);
    }
    if (command === 'state') return snapshot();
    if (state.busy) throw new Error('A search is still running.');
    if (command === 'reset') {
      state.revision++; state.resetEpoch++;
      state.matches = []; state.searched = false; state.truncated = false;
      state.query = ''; state.message = 'Enter a value to begin.';
    } else if (command === 'search' || command === 'narrow') {
      const query = String(payload.query ?? '');
      if (query.length === 0) throw new Error('Enter a search value.');
      if (command === 'narrow' && !state.searched) throw new Error('Run Search first.');
      state.revision++;
      state.busy = true;
      state.message = 'Searching…';
      try {
        if (command === 'narrow') {
          state.matches = state.matches.filter(path => { const current = resolve(path); return current && matches(current.value, query); });
        } else {
          const found = [], queue = [{ value: window, path: [] }], seen = new WeakSet([window]);
          const started = performance.now();
          let properties = 0, limited = false, cursor = 0;
          // One rule for every budget check below: time, property, and match limits (NF-06).
          const spent = () => properties >= 150000 || found.length >= 10000 || performance.now() - started > 2500;
          while (cursor < queue.length) {
            if (spent()) { limited = true; break; }
            const { value, path } = queue[cursor++];
            let keys;
            try { keys = Object.getOwnPropertyNames(value); } catch { continue; }
            for (const key of keys) {
              properties++;
              if (spent()) { limited = true; break; }
              let descriptor;
              try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { continue; }
              if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
              const child = descriptor.value, childPath = [...path, key];
              if (matches(child, query)) found.push(childPath);
              if (!isContainer(child) || seen.has(child) || ArrayBuffer.isView(child)) continue;
              seen.add(child);
              // DOM trees and other browsing contexts are outside this property scan.
              try { if (child instanceof Node || child instanceof Window) continue; } catch { continue; }
              if (path.length >= 7 || queue.length >= 20000) { limited = true; continue; }
              queue.push({ value: child, path: childPath });
            }
            if (cursor % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
          }
          state.matches = found; state.truncated = limited;
        }
        state.searched = true; state.query = query;
        state.message = `${state.matches.length} match${state.matches.length === 1 ? '' : 'es'}.` +
          (state.truncated ? ' Limited scan: results are incomplete. Search again narrows only these results.' : '');
      } finally { state.busy = false; }
    } else if (command === 'set') {
      if (payload.revision !== undefined && payload.revision !== state.revision) throw new Error('Results changed. Select a result again.');
      const path = state.matches[payload.index];
      const current = path && resolve(path);
      if (!current || !supported(current.value)) throw new Error('This property is no longer available. Search again.');
      if (!current.descriptor.writable) throw new Error('This property is read-only.');
      const raw = String(payload.value ?? '');
      if (raw.length === 0) throw new Error('Enter a new value.');
      let next = raw;
      if (typeof current.value === 'number') {
        if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error('Enter a finite number.');
        next = Number(raw);
      } else if (typeof current.value === 'boolean') {
        if (!/^(true|false)$/i.test(raw)) throw new Error('Enter true or false.');
        next = raw.toLowerCase() === 'true';
      }
      if (!Reflect.set(current.parent, current.key, next)) throw new Error('The page rejected this change.');
      const after = resolve(path);
      if (!after || !Object.is(after.value, next)) throw new Error('The value did not retain the change.');
      state.message = `Updated ${pathLabel(path)}. The game may overwrite this value later.`;
    } else { throw new Error('Unknown operation.'); }
    return snapshot();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
