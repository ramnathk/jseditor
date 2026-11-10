import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const server = createServer(async (req,res) => {
  try { res.setHeader('Content-Type','text/html'); res.end(await readFile(new URL(req.url === '/frame.html' ? './frame.html' : './game.html',import.meta.url))); }
  catch { res.statusCode=404; res.end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://game-editor.test:${server.address().port}`;
const outcomes=[];
try {
for(const [name, executablePath] of [
  ['Chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['Edge','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
]) {
  const temp=await mkdtemp(join(tmpdir(),'game-editor-test-'));
  let context;
  try {
    const extension=join(temp,'extension'); await cp(resolve('extension'),extension,{recursive:true});
    const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
    // A popup opened as a test tab does not receive a toolbar activeTab grant.
    // Limit the test-only grant to this local fixture; shipped manifest stays minimal.
    manifest.host_permissions=[`${origin}/*`];
    await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
    context=await chromium.launchPersistentContext(join(temp,'profile'),{
      executablePath, headless:true, ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--host-resolver-rules=MAP game-editor.test 127.0.0.1', '--no-proxy-server', '--enable-unsafe-extension-debugging', ...(name === 'Chrome' ? [] : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`])],
    });
    let worker=context.serviceWorkers()[0], extensionId;
    if (!worker && name === 'Chrome') {
      const cdp = await context.browser().newBrowserCDPSession();
      const loaded = await cdp.send('Extensions.loadUnpacked', { path: extension });
      extensionId = loaded.id;
      await cdp.detach();
      worker = context.serviceWorkers()[0];
    }
    if(!worker && !extensionId) worker=await context.waitForEvent('serviceworker',{timeout:15000});
    const id=extensionId || new URL(worker.url()).host;
    const game=await context.newPage(); await game.goto(origin);
    assert.equal(await game.evaluate(() => isSecureContext), false);
    assert.equal(await game.evaluate(() => typeof crypto.randomUUID), 'undefined');
    const openPopup=async()=>{
      const popup=await context.newPage(); await game.bringToFront();
      await popup.goto(`chrome-extension://${id}/popup.html`);
      await popup.locator('#search').waitFor();
      await popup.waitForFunction(()=>document.querySelector('#status').textContent!=='Connecting to this tab…');
      return popup;
    };
    let popup=await openPopup();
    await popup.locator('#query').fill('100'); await popup.locator('#search').click();
    await popup.waitForFunction(()=>document.querySelector('#narrow').disabled===false);
    assert.equal(await popup.locator('#results option').count(),2);
    await popup.close();
    await game.locator('#spend').click();
    popup=await openPopup();
    assert.equal(await popup.locator('#query').inputValue(),'100');
    assert.equal(await popup.locator('#results option').count(),2);
    await popup.locator('#query').fill('90'); await popup.locator('#narrow').click();
    await popup.waitForFunction(()=>document.querySelector('#results').options.length===1);
    await popup.locator('#results').selectOption('0');
    await popup.locator('#replacement').fill('abc');
    await popup.locator('#set').click();
    await popup.waitForFunction(() => document.querySelector('#status').textContent === 'Enter a finite number.');
    await popup.locator('#replacement').fill('999');
    await popup.locator('#set').click();
    await game.waitForFunction(()=>window.testGame.score===999);
    assert.equal(await popup.locator('#frame-links a').getAttribute('href'),`${origin}/frame.html`);
    await popup.locator('#reset').click();
    await popup.waitForFunction(()=>document.querySelector('#results').options.length===0);
    assert.equal(await popup.locator('#query').inputValue(),'');
    assert.match(await popup.locator('.notice').textContent(),/WASM is not supported/);
    // Reopening after a lost response must reject old selection/fields.
    const invoke = async (command, payload = {}) => popup.evaluate(async ({ command, payload }) => {
      const { pageEngine } = await import('./engine.js');
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      return (await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:pageEngine,args:[command,payload]}))[0].result;
    }, { command, payload });
    await game.evaluate(() => { window.largeArray = new Float32Array(2_000_000); window.zeroGame = { score: 0 }; });
    const zeros = await invoke('search', {query:'0'});
    assert.ok(zeros.results.some(item => item.path === 'window.zeroGame.score'));
    assert.ok(!zeros.results.some(item => item.path.startsWith('window.largeArray[')));
    const selectedState = await invoke('search', {query:'999'});
    await popup.evaluate(async state => {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      await chrome.storage.session.set({['tab-'+tab.id]: {id:state.id,revision:state.revision,resetEpoch:state.resetEpoch,query:'999',replacement:'123',selected:0}});
    }, selectedState);
    await invoke('search', {query:'100'}); // Intentionally never save response in popup.
    await popup.close(); popup = await openPopup();
    assert.equal(await popup.locator('#results').evaluate(el=>el.selectedIndex), -1);
    assert.equal(await popup.locator('#set').isDisabled(), true);
    await invoke('reset'); // Intentionally leave old UI storage intact.
    await popup.close(); popup = await openPopup();
    assert.equal(await popup.locator('#query').inputValue(), '');
    assert.equal(await popup.locator('#replacement').inputValue(), '');
    outcomes.push({browser:name,version:context.browser()?.version(),result:'PASS: insecure HTTP search/narrow/set, specific error, typed-array exclusion, stale selection/reset recovery, iframe URL, WASM notice'});
  } catch(error) { outcomes.push({browser:name,result:'FAIL',error:error.message}); process.exitCode=1; }
  finally { if(context) await context.close(); await rm(temp,{recursive:true,force:true}); }
}
} finally { server.close(); }
console.log(JSON.stringify(outcomes,null,2));
