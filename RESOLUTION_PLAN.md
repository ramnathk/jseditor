# Resolution plan — Game Value Editor evaluation findings

Updated: November 10, 2026.

The review covered extension/engine.js and extension/popup.js. Both files were read against REQUIREMENTS.md and TEST_PLAN.md. Some findings were checked in real Chrome, some with targeted Node reproductions, and the rest by code trace or documented API behavior. One independent model cross-check was also run. Each finding below states how it was verified. A finding marked unconfirmed has not been reproduced and should not be treated as an established defect. The findings below describe the original defects. Implementation and current verification status are recorded at the end; historical line numbers refer to the reviewed version.

## Findings

| ID | Severity | Summary | Verification | Requirement |
|---|---|---|---|---|
| R-01 | Critical | engine.js:6 calls `crypto.randomUUID()`, which only exists in secure contexts. On non-localhost HTTP pages the call throws, engine state never initializes, and every popup action fails with a generic error. | Real Chrome on a plain `http://<LAN-IP>` page: `isSecureContext` false, `crypto.randomUUID` undefined. tests/browser-check.mjs misses this because it only uses 127.0.0.1, which Chrome always treats as secure. | FR-01, FR-18; UC-01 |
| R-02 | Critical | popup.js:6 treats any falsy `executeScript` result as "page did not respond." `chrome.scripting.executeScript` returns `result: undefined` whenever the injected function throws, and every engine.js error is raised that way. All FR-17 messages collapse into one generic message, and that message suggests reloading, which discards candidates. | Documented API behavior, plus the symptom observed in Chrome through R-01. | FR-17 |
| R-03 | Moderate | The per-key limit check (around engine.js:76) sets the incomplete-scan flag. The loop-exit check (around engine.js:89) breaks without setting it. A scan can be truncated and still report itself as complete. | Targeted Node reproduction: an object holding exactly the first 10,000 matches, followed by a second object holding one more match, returns `truncated: false` and the later match is missing. | NF-06 |
| R-04 | Moderate | `run()` in popup.js resets the selected-row index and calls `saveFields()` only after the engine call resolves. If the popup is closed mid-search and reopened, the old selection is restored from session storage. Render clears it only when it is out of range, not when it is stale, so Set can be enabled against the wrong row with the old replacement text. | Code trace. Not reproduced manually. | FR-06, FR-10 |
| R-05 | Moderate | The scan does not exclude typed arrays. A large typed array fills the 10,000-match cap with index entries and crowds out game state. Separately, writing 0.1 into a Float32Array slot stores 0.10000000149, so the `Object.is` post-write check would report that the value did not keep the change even though it did. | Cap flooding: real Chrome. A `Float32Array(2_000_000)` searched for "0" filled the cap in about 540 ms. Set mismatch subsequently reproduced through the Node Set path: the value changed to 0.10000000149011612 while Set reported failure. | NF-06, FR-08, FR-17 |
| R-06 | Low, unconfirmed | The breadth-first order visits built-in globals (Array, Object, their prototypes and methods) before most game state, so common queries may spend scan budget on irrelevant matches. | A stripped-down Node check produced hundreds of matches for "0" and "1" against built-ins. A real Chrome test with a depth-5 game-like property holding 12345 found it with `truncated: false`. No failure has been shown for realistic searches. | NF-06 |
| R-07 | Low | popup.js renders an iframe link from a `frame.url` computed in the page MAIN world. The engine checks the http/https scheme once, but a hostile page can tamper with `URL` or `Array.from` in its own realm before that check runs. The extension CSP already blocks `javascript:` hrefs. The remaining gap is that chrome://, file:, and chrome-extension: URLs could be offered as direct links. | Code trace. | FR-14, NF-08 |
| R-08 | Low | The cooperative yield (engine.js:90) uses `setTimeout(0)`. Chrome clamps nested timers to about 4 ms, and timers in background tabs to about 1000 ms. Yield overhead could use up most of the 2.5-second budget, especially when the tab is not in the foreground. | Documented browser throttling behavior only. No timing measurements taken. | NF-06 |
| R-09 | Moderate | Reset clears fields only after the engine response. Closing the popup after Reset executes but before its response is saved can restore old fields from session storage. | Code trace; regression tests now simulate an engine reset with its popup response discarded. | FR-09, FR-10 |
| R-10 | Moderate | `Object.getOwnPropertyNames` enumerates and allocates all property names before per-key limits apply. A large object or slow proxy can exceed the nominal budget in one synchronous operation. | Code trace. A dedicated test verifies no next object is enumerated once the time budget is exhausted; it does not establish a hard bound on an enumeration already running. | NF-06, NF-07 |

## Resolution plan

Fix in the order below. R-02 hides the specific error behind every other failure. Had it been fixed first, R-01 would have shown up as a specific error instead of a generic one. Fix R-02 together with R-01 so the remaining fixes can be diagnosed from real error messages.

| Order | ID | Fix | Effort |
|---|---|---|---|
| 1 | R-02 | Catch errors inside `pageEngine` and return `{error: message}` instead of throwing across the `executeScript` boundary. In popup.js, check for `error` and rethrow it with that message. Keep the "page did not respond" message only for a missing result. | Small function |
| 1 | R-01 | Replace `crypto.randomUUID()` with `String(performance.timeOrigin) + Math.random()`. The ID only needs to be unique per document load. | One line |
| 1 | R-04 | Clear and persist selection before dispatch. Store result-set revisions with saved selections; reject mismatches on restore and on Set. Serialize and await storage writes before dispatch. | Small, a few lines |
| 2 | R-03 | Set the same incomplete-scan flag on the engine.js:89 exit path before breaking. | One line |
| 2 | R-05 | Skip containers where `ArrayBuffer.isView(value)` is true during the scan. This is an explicit new scope restriction: typed-array elements are primitive but unsupported. Also reject paths resolving through typed arrays at Set time, including replacement objects. | One line |
| 3 | R-07 | Parse the returned string using the extension realm’s URL implementation and allow only HTTP(S) before setting href. Otherwise show the existing no-usable-URL explanation. | One line |
| 3 | R-06 | No code change yet. Build a more realistic repro first: a deep nested game object competing against real Chrome's built-in surface, which is roughly 10x larger than the Node stub. Decide on scan ordering only if that repro shows a failure. | Needs design |
| 3 | R-08 | Measure first. If yield overhead is confirmed, switch to a yield that is not clamped (for example a `MessageChannel` post) or yield less often, based on elapsed time. | Needs design |
| 1 | R-09 | Clear and persist fields before Reset dispatch; increment an engine reset epoch so completed resets invalidate old saved fields even when a response is lost. | Implemented |
| 2 | R-10 | Check budget before each object enumeration, skip typed arrays, and document that individual synchronous enumerations/proxy traps cannot be interrupted. | Mitigated; hard bound remains unavailable |

R-06 and R-08 remain optional investigations. Do not equate them with confirmed defects.

## Verification after fix

Treat a finding as fixed only after it has been re-verified the same way it was found. If a finding was found in a real browser, unit tests alone do not close it.

| ID | Re-test required |
|---|---|
| R-01 | Add a browser-check case that loads the test game from a non-localhost HTTP origin (LAN IP or a hostname mapped to it) where `isSecureContext` is false. Search, narrow, and Set must succeed. |
| R-02 | In real Chrome, trigger each FR-17 path (invalid replacement, read-only property, write that does not stick, search already running) and confirm the popup shows the specific message, not the generic one. Re-run TEST_PLAN M-15 and M-17. |
| R-03 | Add a Node unit test in tests/engine.test.js with 10,000 matches in one object followed by one more match in a later object. Expect `truncated: true`. Extend A-07 to cover the match-cap limit. |
| R-04 | Manual case: select a row, enter replacement text, start a slow search, close the popup mid-search, and reopen. The selection must be cleared and Set disabled until a new row is selected. Add as a variant of M-18. |
| R-05 | In real Chrome, repeat the `Float32Array(2_000_000)` search for "0" next to a real game value of 0, and confirm the game value is found and the array contributes no matches. If typed arrays were ever made editable again, the Set mismatch would need its own reproduction. |
| R-06 | Run the realistic repro described above in real Chrome before deciding anything. |
| R-07 | Unit or manual case: feed popup.js frame entries with chrome://, file:, and chrome-extension: URLs and confirm none is rendered as a link. |
| R-08 | Time a full scan in real Chrome with the tab in the foreground and in the background. Record wall time against scan work done. Add the results to TESTING.md. |


## Implementation update — November 10, 2026

- R-01: removed the secure-context dependency from document-session IDs.
- R-02: the entire injected engine, including initialization, returns serializable specific errors. The popup unwraps these without recommending destructive reloads; injection/permission rejections remain separate. Existing engine tests unwrap this envelope, and dedicated tests exercise the raw envelope.
- R-03: both scan exit paths flag incomplete results when limits stop scanning.
- R-04: every accepted search/narrow/reset advances a result revision. Saved selections carry that revision; stale and busy-state selections are discarded. Set requests include their revision. Storage writes are serialized and the pre-operation clearing write is awaited.
- R-05: ArrayBuffer views are excluded before enumeration and from path resolution. This prevents cap flooding and edits through typed-array replacement objects. Typed arrays and DataView are explicitly outside scope.
- R-07: popup-side URL parsing permits only absolute HTTP(S) links; tests cover browser-internal, file, extension, JavaScript, data, relative, malformed/nonstring inputs.
- R-09: a reset epoch invalidates all earlier saved fields even if the popup disappears before saving the reset response. Fields also clear and persist before reset dispatch.
- R-10: pre-enumeration budget checks and typed-array exclusion reduce exposure. There is no general interruptible own-property enumeration API in this implementation. The remaining synchronous enumeration/proxy risk is documented rather than claimed fixed.
- R-06/R-08: no traversal-order or timer change. Realistic performance measurement remains pending.

Dedicated Node regression tests cover R-01, R-02, R-03, R-04, R-05, R-07, R-09, and the R-10 pre-enumeration guard. The browser harness now uses a mapped non-localhost HTTP origin, explicitly checks that it is insecure and lacks randomUUID, verifies specific invalid-number feedback and large typed-array exclusion, and discards operation responses to verify stale-selection/reset recovery. This deterministic response-loss test supplements rather than replaces the manual close-mid-search timing test. See TESTING.md for executed outcomes.

Remaining acceptance checks: full FR-17 browser error matrix, actual toolbar permission flow, manual close-mid-search timing, minimum supported browser versions, realistic built-in traversal competition, and foreground/background timing. R-10's hard responsiveness bound remains an accepted limitation, not a passing test claim.
