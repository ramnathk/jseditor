# Verification results

Verified November 10, 2026 on macOS.

| Check | Result |
|---|---|
| Engine tests (`npm test`) | 7 passed |
| Chrome 157.0.8103.50 | Passed |
| Edge 157.0.4341.42 | Passed |

Browser tests loaded an unpacked MV3 extension into temporary browser profiles, opened a local game, searched for 100, closed the popup document, changed the game score to 90, reopened the popup, checked retained fields/results, narrowed to the score, changed it to 999, verified the actual page value, checked the iframe URL and WASM notice, and reset the fields/results.

The automation opens the popup document in a background tab and adds a localhost-only host permission to a temporary copy of the manifest. It does not exercise a physical toolbar click or the production `activeTab` permission grant. The shipped manifest uses `activeTab` without host permissions. Real-game compatibility depends on whether the game exposes reachable JavaScript data; no third-party games were tested.

Chrome's current branded build requires the CDP `Extensions.loadUnpacked` debugging API to load the test extension; Edge accepted the command-line unpacked extension path. The test runner removes its default extension-disabling flag. These test setup details do not affect manual installation with Load unpacked.

A manual toolbar check is documented in README.md. Other recommended manual checks: two-tab state separation, page reload clearing results, clicking the iframe link, scrolling large result lists, and a game that overwrites edited values.


## Resolution fixes verification — November 10, 2026

- Node suite: **17 passed**, including dedicated resolution regressions.
- Chrome **157.0.8103.50**: updated browser regression suite passed.
- Edge **157.0.4341.42**: updated browser regression suite passed.

The new browser run used `http://game-editor.test` mapped to the local fixture server and asserted `isSecureContext === false` and `typeof crypto.randomUUID === 'undefined'`. Both browsers passed search, popup reopen, narrowing, and Set there. They also passed specific invalid-number feedback, exclusion of a two-million-element Float32Array while finding a nearby game value, stale selection rejection after a search whose response was deliberately not saved, and stale field clearing after a reset whose response was deliberately not saved. Iframe URL and WASM notice checks still passed.

The test-only local-origin host grant and background-tab popup limitations still apply. Full engine-error browser coverage, a physical toolbar click, actual close-during-search timing, and R-06/R-08 performance investigations remain pending. R-10 has a tested pre-enumeration guard, not a hard bound on synchronous enumeration or proxy execution.
