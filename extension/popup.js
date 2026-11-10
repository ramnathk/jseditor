import { pageEngine } from './engine.js';
import { directFrameURL, restoreFields, unpackResult } from './popup-state.js';
const $ = id => document.getElementById(id);
let writes = Promise.resolve();
let tabId, current, selected = -1, working = false, storageKey, poll;
const call = async (command, payload) => {
  const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageEngine, args: [command, payload || {}] });
  return unpackResult(results);
};
const error = err => {
  $('status').textContent = err.message || String(err);
  $('status').classList.add('error');
};
function saveFields() {
  if (!current || !storageKey) return;
  // No live objects are serialized. Candidate paths remain in the page itself.
  const fields = { id: current.id, revision: current.revision, resetEpoch: current.resetEpoch,
    query: $('query').value, replacement: $('replacement').value, selected };
  writes = writes.catch(() => {}).then(() => chrome.storage.session.set({ [storageKey]: fields }));
  writes.catch(error);
  return writes;
}
function controls() {
  const busy = working || current?.busy;
  $('search').disabled = !current || busy || !$('query').value.length;
  $('narrow').disabled = !current?.searched || busy || !$('query').value.length;
  $('set').disabled = !current || busy || !current.results[selected]?.writable || !$('replacement').value.length;
  $('reset').disabled = !current || busy;
  $('results').disabled = !current || busy;
  const item = current?.results[selected];
  $('detail').textContent = item ? `${item.path} · ${item.type} · ${item.value}${item.writable ? '' : ' · Read-only or unavailable'}` : 'Select one result to edit it.';
}
function render(state) {
  if (current && current.revision !== state.revision) selected = -1;
  if (current && current.resetEpoch !== state.resetEpoch) { $('query').value = ''; $('replacement').value = ''; }
  current = state;
  $('status').classList.remove('error');
  $('status').textContent = state.message;
  $('count').textContent = state.results.length;
  const options = state.results.map(item => {
    const option = document.createElement('option');
    option.value = item.index;
    option.textContent = `${item.path} = ${item.type === 'string' ? JSON.stringify(item.value) : item.value} (${item.type})`;
    option.title = option.textContent;
    return option;
  });
  $('results').replaceChildren(...options);
  if (selected >= state.results.length) selected = -1;
  $('results').selectedIndex = selected;
  controls();
  clearTimeout(poll);
  if (state.busy) poll = setTimeout(async () => { try { render(await call('state')); } catch (err) { error(err); } }, 500);
}
async function run(command) {
  if (!current || working || current.busy) return;
  working = true;
  $('status').textContent = command === 'search' || command === 'narrow' ? 'Searching…' : 'Updating…';
  controls();
  try {
    if (command !== 'set') selected = -1;
    if (command === 'reset') { $('query').value = ''; $('replacement').value = ''; }
    await saveFields();
    const state = await call(command, { query: $('query').value, value: $('replacement').value, index: selected, revision: current.revision });
    if (command !== 'set') selected = -1;
    if (command === 'reset') { $('query').value = ''; $('replacement').value = ''; }
    render(state);
    saveFields();
  } catch (err) { error(err); }
  finally { working = false; controls(); }
}
$('search-form').addEventListener('submit', event => { event.preventDefault(); run('search'); });
$('narrow').addEventListener('click', () => run('narrow'));
$('set-form').addEventListener('submit', event => { event.preventDefault(); run('set'); });
$('reset').addEventListener('click', () => run('reset'));
for (const id of ['query', 'replacement']) $(id).addEventListener('input', () => { controls(); saveFields(); });
$('results').addEventListener('change', () => { selected = $('results').selectedIndex; controls(); saveFields(); });
controls();
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a game tab first.');
  tabId = tab.id; storageKey = `tab-${tabId}`;
  const state = await call('state');
  const saved = (await chrome.storage.session.get(storageKey))[storageKey];
  const restored = restoreFields(state, saved);
  $('query').value = restored.query; $('replacement').value = restored.replacement; selected = restored.selected;
  render(state);
  const frames = await call('frames');
  $('frames').hidden = !frames.length;
  frames.forEach((frame, index) => {
    const row = document.createElement('div'); row.className = 'frame';
    const label = document.createElement('small');
    label.textContent = index === 0 && frame.area > 0 ? 'Largest iframe · likely game' : frame.title;
    row.append(label);
    const url = directFrameURL(frame.url);
    if (url) {
      const link = document.createElement('a'); link.textContent = `Open directly: ${url}`;
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link);
    } else {
      const note = document.createElement('div'); note.textContent = 'No usable direct URL (for example, srcdoc or blob content).'; row.append(note);
    }
    $('frame-links').append(row);
  });
} catch (err) { error(new Error(`Cannot inspect this page. Use a regular game webpage; browser settings and extension-store pages are restricted. ${err.message}`)); }
