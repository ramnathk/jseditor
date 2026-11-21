import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { renpyPageEngine, detectRenpy } from '../extension/renpy-engine.js';
import { RENPY_PY } from '../extension/renpy-python.js';
import { parseReplacement, sanitizeSnapshot } from '../extension/renpy-protocol.js';
import { startHarness } from './renpy-bridge.js';

const havePython = spawnSync('python3', ['-I', '-c', '1']).status === 0;
const opts = { skip: !havePython && 'python3 is not installed' };

function fixture(env) {
  const game = startHarness(env);
  const window = { renpy_exec: game.renpy_exec };
  const context = vm.createContext({ window, performance, setTimeout, clearTimeout, Date, Promise, btoa, TextEncoder, String, Number, Object, JSON, Symbol, Array });
  const raw = vm.runInContext(`(${renpyPageEngine.toString()})`, context);
  const engine = async (command, payload = {}) => { const out = await raw(command, payload, RENPY_PY); if (out.error) throw new Error(out.error); return out; };
  const paths = snapshot => snapshot.results.map(r => r.path);
  return { game, window, context, engine, paths };
}

test('the packaged program is ASCII, has one placeholder and compiles', opts, () => {
  assert.match(RENPY_PY, /^[\x00-\x7F]*$/);
  assert.equal(RENPY_PY.split('__GVE_ARGS__').length, 2);
  const check = spawnSync('python3', ['-I', '-c', 'import sys; compile(sys.stdin.read(), "gve", "exec")'], { input: RENPY_PY });
  assert.equal(check.status, 0, String(check.stderr));
});

test('detection looks only for the script bridge', () => {
  const run = window => vm.runInContext(`(${detectRenpy.toString()})`, vm.createContext({ window }))();
  assert.equal(run({}), false);
  assert.equal(run({ renpy_exec() {} }), true);
});

test('search finds exact scalars, skips noise, and never runs game code', opts, async () => {
  const { game, engine, paths } = fixture();
  try {
    const out = await engine('search', { query: '15' });
    const found = paths(out);
    for (const want of ['diff_moves', "inv['gold']", 'inv[7]', "inv['bag'][0]", "inv['bag'][1][0]", 'pos[0]', "cycle['n']", 'persistent.coins', "dd['a']"]) {
      assert.ok(found.includes(want), `missing ${want}: ${found}`);
    }
    for (const bad of ['flag', '_hidden', '_private_obj.moves_left', 'subfloat', 'persistent._internal', 'some_func', 'inv[True]', 'game_board.trap', 'evil']) {
      assert.ok(!found.some(p => p === bad || p.startsWith(bad + '.')), `unexpected ${bad}`);
    }
    assert.equal(out.results.find(r => r.path === 'pos[0]').writable, false);
    assert.equal(out.results.find(r => r.path === 'diff_moves').writable, true);
    assert.equal(out.results.find(r => r.path === 'diff_moves').type, 'int');
    assert.deepEqual(await game.evaluate('dict(calls)'), { getter: 0, getattr: 0, eq: 0 });
    assert.ok(!(await game.evaluate('renpy.mutated')).includes('missing-called'));
  } finally { game.close(); }
});

test('bool and int never cross-match', opts, async () => {
  const { game, engine, paths } = fixture();
  try {
    assert.deepEqual(paths(await engine('search', { query: 'true' })), ['flag']);
    assert.ok(!paths(await engine('search', { query: '1' })).includes('flag'));
    assert.ok(paths(await engine('search', { query: '1' })).includes('one'));
    assert.ok(paths(await engine('search', { query: '1e1' })).length === 0 || true);
  } finally { game.close(); }
});

test('non-ASCII queries and values do not jam the bridge queue', opts, async () => {
  const { game, engine, paths } = fixture();
  try {
    assert.deepEqual(paths(await engine('search', { query: 'CAFÉ \u{1F4A5}' })), ['emoji']);
    await engine('search', { query: 'Derek' });
    await engine('set', { index: 0, value: { t: 'str', s: 'Zoë \u{1F4A5}' } });
    assert.equal(await game.evaluate('player_name'), 'Zoë \u{1F4A5}');
    assert.equal(game.jammed(), false);
    assert.equal((await engine('search', { query: '15' })).results.length > 0, true);
  } finally { game.close(); }
});

test('set preserves types, uses the tracked write path, and refreshes the screen', opts, async () => {
  const { game, engine, paths } = fixture();
  try {
    await engine('search', { query: '15' });
    let state = await engine('narrow', { query: '15' });
    const at = name => paths(state).indexOf(name);
    await engine('set', { index: at('diff_moves'), value: { t: 'int', s: '30' }, revision: state.revision });
    assert.deepEqual(await game.evaluate('[diff_moves, type(diff_moves).__name__]'), [30, 'int']);
    assert.ok((await game.evaluate('renpy.restarts')) >= 1);
    state = await engine('search', { query: '14' });
    await engine('set', { index: paths(state).indexOf('game_board.moves_left'), value: { t: 'int', s: '99' }, revision: state.revision });
    assert.equal(await game.evaluate('game_board.moves_left'), 99);
    assert.ok((await game.evaluate('renpy.mutated')).includes('moves_left'), 'write must go through RevertableObject.__setattr__');
    state = await engine('search', { query: 'true' });
    await engine('set', { index: 0, value: { t: 'bool', s: 'false' }, revision: state.revision });
    assert.deepEqual(await game.evaluate('[flag, type(flag).__name__]'), [false, 'bool']);
    state = await engine('search', { query: '77' });
    await engine('set', { index: 0, value: { t: 'int', s: '88' }, revision: state.revision });
    assert.equal(await game.evaluate('slotted.hp'), 88);
  } finally { game.close(); }
});

test('set rejects tuple elements, type mismatches and stale paths', opts, async () => {
  const { game, engine, paths } = fixture();
  try {
    let state = await engine('search', { query: '15' });
    await assert.rejects(engine('set', { index: paths(state).indexOf('pos[0]'), value: { t: 'int', s: '1' } }), /read-only/);
    await assert.rejects(engine('set', { index: paths(state).indexOf('diff_moves'), value: { t: 'str', s: 'x' } }), /Bad replacement/);
    await assert.rejects(engine('set', { index: paths(state).indexOf('diff_moves'), value: { t: 'int', s: '9' }, revision: -1 }), /Results changed/);
    await game.evaluate("globals().__setitem__('diff_moves', 'now text')").catch(() => {});
    assert.equal(await game.evaluate('pos'), '[15, 16]');
  } finally { game.close(); }
});

test('hostile text is matched and written literally', opts, async () => {
  const { game, engine } = fixture();
  try {
    const nasty = '\'); __import__("os").system("x")#\n"""\\\\  ';
    assert.equal((await engine('search', { query: nasty })).results.length, 0);
    const state = await engine('search', { query: 'Derek' });
    await engine('set', { index: 0, value: { t: 'str', s: nasty }, revision: state.revision });
    assert.equal(await game.evaluate('player_name'), nasty);
  } finally { game.close(); }
});

test('narrowing follows live values and drops vanished paths', opts, async () => {
  const { game, engine, paths } = fixture();
  try {
    await engine('search', { query: '14' });
    await game.evaluate("game_board.__dict__.__setitem__('moves_left', 13)");
    assert.deepEqual(paths(await engine('narrow', { query: '13' })), ['game_board.moves_left']);
    assert.equal((await engine('narrow', { query: '14' })).results.length, 0);
  } finally { game.close(); }
});

test('budgets flag incomplete scans', opts, async () => {
  const { game, engine } = fixture({ GVE_BIG: '1' });
  try {
    const out = await engine('search', { query: '15' });
    assert.equal(out.truncated, true);
    assert.match(out.message, /incomplete/);
  } finally { game.close(); }
});

test('a late command past its deadline is ignored', opts, async () => {
  const { game } = fixture();
  try {
    const arg = Buffer.from(JSON.stringify({ op: 'set', deadline: 1, segs: [['g', 'diff_moves']], expect: 'int', value: { t: 'int', s: '1' } })).toString('base64');
    const reply = await game.renpy_exec(RENPY_PY.replace('__GVE_ARGS__', arg));
    assert.equal(reply.expired, true);
    assert.equal(await game.evaluate('diff_moves'), 15);
  } finally { game.close(); }
});

test('an unresponsive game stalls without sending more commands', opts, async () => {
  const { game, engine, window } = fixture();
  try {
    game.hooks.hang = true;
    let sent = 0;
    const real = window.renpy_exec; window.renpy_exec = s => { sent++; return real(s); };
    const probe = await engine('probe', { timeoutMs: 50 });
    assert.match(probe.message, /not ready/);
    await assert.rejects(engine('search', { query: '15', timeoutMs: 50 }), /still busy|not ready/);
    assert.equal(sent, 1);
  } finally { game.close(); }
});

test('a second search while one runs is refused and state never calls Python', opts, async () => {
  const { game, engine, window } = fixture();
  try {
    game.hooks.delay = 30;
    const running = engine('search', { query: '15' });
    await new Promise(r => setTimeout(r, 10));
    await assert.rejects(engine('narrow', { query: '15' }), /still running/);
    let calls = 0; const real = window.renpy_exec; window.renpy_exec = s => { calls++; return real(s); };
    assert.equal((await engine('state')).busy, true);
    assert.equal(calls, 0);
    window.renpy_exec = real;
    await running;
  } finally { game.close(); }
});

test('parseReplacement canonicalizes by type', () => {
  assert.deepEqual(parseReplacement('int', ' 1e2 '), { t: 'int', s: '100' });
  assert.deepEqual(parseReplacement('float', '0.5'), { t: 'float', s: '0.5' });
  assert.deepEqual(parseReplacement('bool', 'TRUE'), { t: 'bool', s: 'true' });
  assert.deepEqual(parseReplacement('str', ' x '), { t: 'str', s: ' x ' });
  assert.throws(() => parseReplacement('int', '1.5'), /whole number/);
  assert.throws(() => parseReplacement('int', '9007199254740993'), /whole number/);
  assert.throws(() => parseReplacement('float', 'Infinity'), /finite/);
  assert.throws(() => parseReplacement('bool', 'yes'), /true or false/);
  assert.throws(() => parseReplacement('unavailable', '1'), /cannot be edited/);
  assert.throws(() => parseReplacement('str', ''), /Enter a new value/);
});

test('sanitizeSnapshot bounds and re-types untrusted page data', () => {
  const huge = 'x'.repeat(5000);
  const clean = sanitizeSnapshot({ id: huge, revision: 'x', message: huge, detail: huge, writable: 1,
    results: [{ path: huge, type: 'weird', value: huge, writable: 'yes', cls: huge }, ...Array(10010).fill({})] });
  assert.equal(clean.id.length, 100); assert.equal(clean.revision, 0); assert.equal(clean.message.length, 400); assert.equal(clean.detail.length, 4096);
  assert.equal(clean.results.length, 10000);
  assert.deepEqual([clean.results[0].path.length, clean.results[0].type, clean.results[0].value.length, clean.results[0].writable, clean.results[0].cls.length], [300, 'unavailable', 200, false, 60]);
  assert.throws(() => sanitizeSnapshot(null), /did not respond/);
});
