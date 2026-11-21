// Both functions are serialized by chrome.scripting. Keep all dependencies inside them.
export function detectRenpy() {
  try { return typeof window.renpy_exec === 'function'; } catch { return false; }
}

// `source` is the fixed Python program from renpy-python.js. The page never builds or alters it.
export async function renpyPageEngine(command = 'state', payload = {}, source = '') {
  try {
    const stateKey = Symbol.for('game-value-editor.renpy.v1');
    if (!Object.hasOwn(window, stateKey)) {
      Object.defineProperty(window, stateKey, {
        value: { id: `${performance.timeOrigin}:${Math.random()}`, revision: 0, resetEpoch: 0, matches: [], searched: false, busy: false,
          stalled: false, outstanding: null, wid: 0, ready: false, message: 'Enter a value to begin.', truncated: false, query: '', detail: '' },
        configurable: true,
      });
    }
    const state = window[stateKey];
    // Tests may shorten the per-command timeout; it can only make the engine give up sooner.
    const TIMEOUT = Number.isInteger(payload.timeoutMs) && payload.timeoutMs > 0 && payload.timeoutMs < 9000 ? payload.timeoutMs : 9000;
    const clean = item => ({
      segs: item.segs, label: String(item.label).slice(0, 300), type: String(item.type), value: String(item.value).slice(0, 200),
      writable: item.writable === true, cls: String(item.cls || '').slice(0, 60),
    });
    const snapshot = () => ({
      backend: 'renpy', id: state.id, revision: state.revision, resetEpoch: state.resetEpoch, searched: state.searched, busy: state.busy,
      stalled: state.stalled, message: state.message, query: state.query, truncated: state.truncated, detail: state.detail,
      results: state.matches.map(m => ({ path: m.label, type: m.type, value: m.value, writable: m.writable, cls: m.cls })),
    });
    // UTF-8, then base64: the bridge applies btoa() to the whole script, so the script must stay 7-bit ASCII.
    const encode = value => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x2000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
      return btoa(binary);
    };
    // One command at a time. A timed-out command stays outstanding until its promise settles, and Python
    // ignores it if its deadline passed, so "no response" never means "applied later".
    const call = async (op, args = {}, timeout = TIMEOUT) => {
      if (typeof window.renpy_exec !== 'function') throw new Error("This page has no Ren'Py script bridge.");
      if (state.outstanding) throw new Error('The game is still busy with the previous request. Try again shortly.');
      if (typeof source !== 'string' || /[^\x00-\x7F]/.test(source) || source.split('__GVE_ARGS__').length !== 2) throw new Error('Internal error: invalid script.');
      const encoded = encode({ ...args, op, deadline: Date.now() + timeout });
      const script = source.replace('__GVE_ARGS__', () => encoded);
      const exec = window.renpy_exec;
      const pending = Promise.resolve().then(() => exec.call(window, script));
      state.outstanding = pending;
      const release = () => { if (state.outstanding === pending) { state.outstanding = null; state.stalled = false; } };
      pending.then(release, release);
      let timer, reply;
      try {
        reply = await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GVE_TIMEOUT')), timeout + 1000); })]);
      } catch (error) {
        if (error?.message === 'GVE_TIMEOUT') {
          state.stalled = true;
          throw new Error('The game is not responding. Click into the game so it is waiting at a screen, then try again. No change was made.');
        }
        state.detail = String(error?.traceback ?? '').slice(0, 4096);
        throw new Error(String(error?.message ?? error).slice(0, 300));
      } finally { clearTimeout(timer); }
      if (!reply || typeof reply !== 'object' || reply.v !== 1) throw new Error('Unexpected reply from the game script.');
      if (reply.expired) throw new Error('The game did not respond in time. No change was made.');
      if (!reply.ok) {
        state.detail = String(reply.traceback ?? '').slice(0, 4096);
        throw new Error(String(reply.error ?? 'Script error').slice(0, 300));
      }
      return reply;
    };
    const ensureReady = async () => {
      if (state.ready) return;
      try { await call('probe', {}, Math.min(2500, TIMEOUT)); } catch (error) {
        if (!state.stalled) throw error;
        throw new Error("The game is not ready. Click into the game (Ren'Py only runs commands while it waits at a screen), then try again.");
      }
      state.ready = true;
    };
    if (command === 'state') return snapshot();
    if (command === 'probe') {
      try { await ensureReady(); state.message = state.matches.length ? state.message : "Ren'Py game detected. Enter a value to begin."; }
      catch (error) { state.message = error.message; }
      return snapshot();
    }
    if (state.busy) throw new Error('A search is still running.');
    if (command === 'reset') {
      state.revision++; state.resetEpoch++;
      state.matches = []; state.searched = false; state.truncated = false; state.query = ''; state.detail = '';
      state.message = 'Enter a value to begin.';
    } else if (command === 'search' || command === 'narrow') {
      const query = String(payload.query ?? '');
      if (query.length === 0) throw new Error('Enter a search value.');
      if (command === 'narrow' && !state.searched) throw new Error('Run Search first.');
      state.revision++; state.busy = true; state.detail = '';
      state.message = 'Searching…';
      try {
        await ensureReady();
        if (command === 'narrow') {
          const reply = await call('narrow', { query, segs: state.matches.map(m => m.segs) });
          state.matches = reply.results.map(clean);
        } else {
          const wid = ++state.wid, began = Date.now();
          await call('start', { query, wid });
          let reply;
          do {
            reply = await call('next', { wid });
            state.message = `Searching… ${Number(reply.checks) || 0} properties checked`;
            if (!reply.done && Date.now() - began > 30000) throw new Error('The search took too long. Try again while the game is idle.');
          } while (!reply.done);
          state.matches = reply.results.map(clean); state.truncated = reply.trunc === true;
        }
        state.searched = true; state.query = query;
        state.message = `${state.matches.length} match${state.matches.length === 1 ? '' : 'es'}.` +
          (state.truncated ? ' Limited scan: results are incomplete. Search again narrows only these results.' : '');
      } finally { state.busy = false; }
    } else if (command === 'set') {
      if (payload.revision !== undefined && payload.revision !== state.revision) throw new Error('Results changed. Select a result again.');
      const match = state.matches[payload.index];
      if (!match) throw new Error('This value is no longer available. Search again.');
      const value = payload.value;
      if (!value || typeof value.t !== 'string' || typeof value.s !== 'string') throw new Error('Enter a new value.');
      state.busy = true;
      try {
        await ensureReady();
        const reply = await call('set', { segs: match.segs, expect: match.type, value: { t: value.t, s: value.s } });
        state.matches[payload.index] = clean(reply.item);
        state.message = `Updated ${state.matches[payload.index].label}. Rollback can undo this, and later saves will include it.`;
      } finally { state.busy = false; }
    } else { throw new Error('Unknown operation.'); }
    return snapshot();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
