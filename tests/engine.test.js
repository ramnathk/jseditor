import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { pageEngine } from '../extension/engine.js';
function fixture() {
  const window = { game: { score: 100, health: 100, name: 'Hero', numericText: '100', flag: true } };
  const context = vm.createContext({ window, crypto: webcrypto, performance, setTimeout, Node: class {}, Window: class {}, document: { querySelectorAll: () => [] } });
  const rawEngine = vm.runInContext(`(${pageEngine.toString()})`, context);
  const engine = async (...args) => { const result = await rawEngine(...args); if (result.error) throw new Error(result.error); return result; };
  return { window, engine, rawEngine, context };
}
test('exact text matching ignores case and does not match substrings', async () => {
  const { engine } = fixture();
  assert.equal((await engine('search', { query: 'hErO' })).results[0].path, 'window.game.name');
  assert.equal((await engine('search', { query: 'her' })).results.length, 0);
});
test('narrowing survives separate invocations and uses current values', async () => {
  const { window, engine } = fixture();
  assert.equal((await engine('search', { query: '100' })).results.length, 3);
  window.game.score = 90;
  assert.equal((await engine('state')).results.length, 3);
  const result = await engine('narrow', { query: '90' });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, 'window.game.score');
  await engine('set', { index: 0, value: '999' });
  assert.equal(window.game.score, 999);
});
test('values retain number, string, and boolean types', async () => {
  const { window, engine } = fixture();
  await engine('search', { query: 'Hero' });
  await engine('set', { index: 0, value: '123' });
  assert.equal(window.game.name, '123');
  await engine('search', { query: 'true' });
  await engine('set', { index: 0, value: 'FALSE' });
  assert.equal(window.game.flag, false);
  await engine('search', { query: '100' });
  await assert.rejects(engine('set', { index: 0, value: 'abc' }), /finite number/);
});
test('does not invoke accessors and handles cycles and read-only properties', async () => {
  const { window, engine } = fixture();
  let calls = 0;
  Object.defineProperty(window.game, 'getter', { get() { calls++; throw new Error('getter executed'); } });
  Object.defineProperty(window.game, 'locked', { value: 42, writable: false });
  window.game.self = window.game;
  const state = await engine('search', { query: '42' });
  assert.equal(calls, 0);
  assert.equal(state.results[0].writable, false);
  await assert.rejects(engine('set', { index: 0, value: '43' }), /read-only/);
});
test('reset clears results and rejects narrowing before first search', async () => {
  const { engine } = fixture();
  await engine('search', { query: '100' });
  const state = await engine('reset');
  assert.equal(state.results.length, 0);
  assert.equal(state.searched, false);
  await assert.rejects(engine('narrow', { query: '90' }), /Search first/);
});
test('removed properties become unavailable and replacement objects use current paths', async () => {
  const { window, engine } = fixture();
  await engine('search', { query: 'Hero' });
  delete window.game.name;
  await assert.rejects(engine('set', { index: 0, value: 'X' }), /no longer available/);
  window.game = { name: 'Other' };
  await engine('set', { index: 0, value: 'Updated' });
  assert.equal(window.game.name, 'Updated');
});
test('bounded traversal reports incomplete results', async () => {
  const { window, engine } = fixture();
  let node = window.game;
  for (let i = 0; i < 12; i++) { node.child = { score: 100 }; node = node.child; }
  const result = await engine('search', { query: '100' });
  assert.equal(result.truncated, true);
});
test('R-01: session initializes without randomUUID', async () => {
  const { context, engine } = fixture();
  context.crypto = {};
  const first = await engine('state');
  assert.equal(typeof first.id, 'string');
  assert.equal((await engine('state')).id, first.id);
});
test('R-02: engine returns serializable specific errors including initialization', async () => {
  const { rawEngine, context } = fixture();
  assert.equal((await rawEngine('narrow', { query: '1' })).error, 'Run Search first.');
  const broken = fixture();
  Object.preventExtensions(broken.window);
  assert.equal(typeof (await broken.rawEngine('state')).error, 'string');
  assert.equal(context.window[Symbol.for('game-value-editor.state.v2')].busy, false);
});
test('R-03: match cap at an object boundary reports omitted candidates', async () => {
  const { window, engine } = fixture();
  window.first = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => ['p' + i, 77]));
  window.later = { score: 77 };
  const result = await engine('search', { query: '77' });
  assert.equal(result.results.length, 10000);
  assert.equal(result.truncated, true);
});
test('R-04/R-09: result revisions and reset epochs invalidate stale UI state', async () => {
  const { engine } = fixture();
  const first = await engine('search', { query: '100' });
  const next = await engine('narrow', { query: '100' });
  assert.notEqual(first.revision, next.revision);
  await assert.rejects(engine('set', { index: 0, value: '2', revision: first.revision }), /Results changed/);
  const reset = await engine('reset');
  assert.notEqual(reset.resetEpoch, first.resetEpoch);
  assert.equal(reset.query, '');
});
test('R-05: large typed arrays do not consume results or become editable through replaced paths', async () => {
  const { window, engine } = fixture();
  window.large = new Float32Array(2_000_000);
  window.target = { score: 0 };
  const found = await engine('search', { query: '0' });
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].path, 'window.target.score');
  window.slots = { 0: 123 };
  await engine('search', { query: '123' });
  window.slots = new Float32Array([123]);
  await assert.rejects(engine('set', { index: 0, value: '0.1' }), /no longer available/);
  assert.equal(window.slots[0], 123);
});
test('R-10: an exhausted time budget prevents enumerating the next object', async () => {
  const { window, engine, context } = fixture();
  delete window.game; // isolate this test from the shared fixture's object shape
  let enumerations = 0, calls = 0;
  window.known = { a: 100, b: 100 }; // 2 keys; its enumeration should fully complete before the budget runs out
  window.later = new Proxy({}, { ownKeys() { enumerations++; return []; } }); // must never be reached
  // performance.now() calls: 1 (started) + 3 for `window` (top check, 2 keys)
  // + 3 for `known` (same shape) = 7, all within budget. Call #8 is the top-of-loop
  // check immediately before `later` (the proxy) would be dequeued; only that call reports
  // the budget exhausted, so a passing test proves window and known were fully scanned
  // while the proxy's ownKeys was never invoked.
  context.performance = { timeOrigin: 1, now() { calls++; return calls <= 7 ? calls : 100000; } };
  const result = await engine('search', { query: '100' });
  assert.equal(result.truncated, true);
  assert.equal(enumerations, 0);
  // Array.from (not .map) rebuilds the array in this realm; `result` crossed the vm boundary.
  assert.deepEqual(Array.from(result.results, r => r.path).sort(), ['window.known.a', 'window.known.b']);
});
