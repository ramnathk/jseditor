import test from 'node:test';
import assert from 'node:assert/strict';
import { directFrameURL, restoreFields, unpackResult } from '../extension/popup-state.js';
const state = { id: 'doc', revision: 2, resetEpoch: 0, busy: false, query: '90', results: [{}] };
const saved = { id: 'doc', revision: 1, resetEpoch: 0, query: '90', replacement: '999', selected: 0 };
test('R-04: an in-range selection from old results is rejected on reopen', () => {
  assert.equal(restoreFields(state, saved).selected, -1);
  assert.equal(restoreFields(state, { ...saved, revision: 2 }).selected, 0);
  assert.equal(restoreFields({ ...state, busy: true }, { ...saved, revision: 2 }).selected, -1);
});
test('R-09: completed reset clears stale fields even if popup never saved its response', () => {
  assert.deepEqual(restoreFields({ ...state, query: '', resetEpoch: 1, results: [] }, saved),
    { query: '', replacement: '', selected: -1 });
});
test('R-07: only absolute HTTP(S) frame URLs become links', () => {
  for (const url of ['chrome://settings', 'file:///tmp/a', 'chrome-extension://abc/a', 'javascript:alert(1)', 'data:text/html,x', '/frame', null, {}]) assert.equal(directFrameURL(url), null);
  assert.equal(directFrameURL('https://example.com/game'), 'https://example.com/game');
  assert.equal(directFrameURL('http://example.com/game'), 'http://example.com/game');
});
test('R-02: specific page errors survive the transport boundary', () => {
  assert.throws(() => unpackResult([{ result: { error: 'Enter a finite number.' } }]), /Enter a finite number/);
  assert.throws(() => unpackResult([{ result: undefined }]), /page did not respond/);
  assert.deepEqual(unpackResult([{ result: [] }]), []);
});
