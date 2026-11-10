# Test plan — Game Value Editor

Updated: November 10, 2026. Scope: requirements in REQUIREMENTS.md and flows in USE_CASES.md. This is a plan, not a claim of completed execution. Observed results and exact tested browser versions are in TESTING.md.

## Environments and execution

Run automated engine tests with `npm test`. Install development dependencies with `npm ci`, then run browser checks with `npm run test:browser`. The browser runner currently targets locally installed macOS Chrome and Edge using temporary profiles and a local HTTP game fixture.

For manual tests, load the shipped extension directory through chrome://extensions or edge://extensions with Developer mode enabled. Run `python3 -m http.server 8000` in the project root and visit http://localhost:8000/tests/game.html. Invoke the popup through the real toolbar icon. Repeat manual cases in both browsers and record versions, OS, steps, expected/actual results, and evidence.

Important automation boundary: tests/browser-check.mjs opens the popup as a background tab and grants only its temporary manifest access to the local fixture. It does not test a physical toolbar click or the shipped activeTab grant. No third-party games have been verified.

## Automated coverage already executed

| ID | Requirements | Test and expected result | Coverage |
|---|---|---|---|
| A-01 | FR-04 | Hero matches hErO; her does not match. | Engine passed |
| A-02 | FR-03, FR-05, FR-10 | Search 100, change score to 90, invoke engine again, narrow to score, set 999. | Engine and both browsers passed |
| A-03 | FR-07–08 | Numeric edits preserve number type; text 123 remains a string; FALSE updates a boolean; abc fails for numbers. | Engine passed |
| A-04 | FR-17, NF-07 | Throwing getter is never read, cycle terminates, read-only property cannot be written. | Engine passed |
| A-05 | FR-09 | Reset clears results/searched state and prevents narrowing before another search. | Engine passed; UI reset passed in both browsers |
| A-06 | FR-05, FR-17 | Removed property rejects Set; a replacement parent is resolved through the current path. | Engine passed |
| A-07 | NF-06 | Excess depth sets incomplete-scan flag. | Engine passed; other limits pending |
| A-08 | FR-10 | Close popup document, change game score, reopen; query and original list survive. | Both browsers passed; physical popup pending |
| A-09 | FR-14, FR-16 | Iframe anchor has expected URL and popup contains WASM notice. | Both browsers passed; link activation pending |

## Manual acceptance cases still pending

All cases below are pending unless separately recorded in TESTING.md. Use fixture extensions only in test pages; do not add them to the shipped manifest.

| ID | Requirements / use case | Procedure | Expected result |
|---|---|---|---|
| M-01 | FR-01, NF-04 / UC-01 | Load the unchanged shipped manifest in both browsers. Visit the test game; invoke the actual toolbar icon; search 100. | Popup opens and finds score/health using activeTab, without permanent host permission. |
| M-02 | FR-05, FR-10 / UC-01, UC-04 | With popup open and results listed, click Spend 10 in the game. Reopen the actual popup; narrow to 90. | Popup dismissal preserves the query/results; narrowing leaves score only. |
| M-03 | FR-06–08, FR-10 / UC-04 | Select a result, enter 999, close/reopen before setting, then Set. | Selection and replacement survive; actual score becomes numeric 999. |
| M-04 | FR-05 / UC-02 | Prepare three properties at 100. Change two to 90 and narrow; change one to 80 and narrow. Change an unrelated property to 80. | Candidate counts shrink from three to two to one; unrelated property is never added. |
| M-05 | FR-03, FR-09 / UC-07 | Edit a value, Reset, close/reopen, then search another value. | Both fields, candidates, and selection stay cleared after Reset; previous game edit remains; fresh search works. |
| M-06 | FR-11 / UC-08 | Open two game tabs, make different searches/selections, and switch/reopen several times. | Each tab restores only its own fields/results/selection. |
| M-07 | FR-12 / UC-08 | Search and fill both fields, reload the game, reopen; repeat with a new-document navigation. | New document has empty state; old results cannot edit the new document. |
| M-08 | FR-10, NF-03 / UC-04 | Search, close popup, stop the extension worker from browser tools, reopen. | Page candidates and session-stored UI fields remain usable. |
| M-09 | FR-11–12 / UC-08 | Close a searched tab and inspect session storage; reload extension or restart browser with the game restored. | Closed-tab UI key removed; no stale candidates reused after restart. |
| M-10 | FR-13–15 / UC-05 | Click the frame link in the actual popup. Invoke extension in the new tab; search 50. | New tab opens to frame.html; frameGame.coins is found with independent state. |
| M-11 | FR-13–14 / UC-05 | Create multiple differently sized iframes, a relative URL, a missing source, srcdoc, and blob source. | Largest nonzero-size frame is highlighted; HTTP(S) sources resolve correctly; unusable sources have explanations. |
| M-12 | FR-15 / UC-05 | Use a cross-origin embedded test game, then open its direct HTTP(S) source. | Main-page search does not claim frame access; direct tab can be inspected when independently usable. |
| M-13 | FR-06, NF-08 | Expose at least 25 matching properties. Search, scroll, select with mouse and keyboard, and tab through controls. | Ten rows visible with scrolling; only one selection; labels/focus/status usable and paths readable. |
| M-14 | NF-08 | Check light/dark modes and long paths/values; resize display or change zoom. | Controls stay usable; overflow scrolls; labels and statuses are legible. |
| M-15 | FR-02, FR-07–08, FR-17 / UC-06 | Attempt empty fields, invalid numeric/boolean replacements, read-only property, and deletion after selection. | Controls disable as applicable; explicit errors for rejected writes; no unintended property creation. |
| M-16 | FR-04 / UC-03 | Test numeric 100, text "100", text "100.0", mixed case, substrings, whitespace, and scientific notation. | Behavior agrees with matching rules in REQUIREMENTS.md. |
| M-17 | FR-17 / UC-09 | Invoke extension on browser settings and extension-store pages. | Inspection fails clearly without falsely showing successful search. |
| M-18 | FR-18 / UC-04 | Start a large scan, close/reopen before completion, and attempt competing operations. | Busy state prevents overlapping searches/edits; reopening eventually shows results. |
| M-19 | NF-06 / UC-09 | Build separate fixtures exceeding time, property, queue, depth, and result limits. | Scan returns with incomplete warning, bounded candidates, and usable controls. |
| M-20 | NF-07 / UC-09 | Include cycles, getters, DOM references, inaccessible objects, and proxies. | Ordinary accessors are not invoked; recoverable errors do not abort the UI. Document any proxy-related delay; no absolute responsiveness guarantee. |
| M-21 | FR-08 / UC-01 | Have the fixture continuously overwrite the selected property. Apply an edit. | UI does not promise a permanent freeze; actual game can overwrite it. |
| M-22 | FR-16 / UC-09 | Use a WASM-only game or fixture. | Unsupported notice is visible; no claim to search or edit WASM memory. |
| M-23 | NF-01, NF-04–05 | Inspect packaged manifest/source and extension network activity during use. | MV3, only stated permissions, no remote code/telemetry/network requests. |
| M-24 | Platform scope | Repeat installation and main workflow on minimum declared browser versions and additional OS targets if support is claimed. | Record supported versions only after direct verification; current macOS results do not establish all-platform support. |

## Release acceptance and reporting

A release claiming fully verified Chrome/Edge support should pass M-01 through M-03 with the shipped manifest in both browsers, all relevant automated checks, and the remaining applicable functional cases. Record failures and limitations rather than treating unexecuted cases as passing. Use only controlled fixtures for destructive or edge-case data changes.

For each run, capture: date, tester, OS, browser/version, extension version, shipped or test-only permissions, case IDs, actual results, failures, and screenshots/logs when useful. Update TESTING.md with observed outcomes; keep planned coverage here.


## Resolution regression coverage

Dedicated automated tests now cover missing randomUUID, serializable engine errors, the exact 10,000-result boundary, selection revision/reset epoch recovery, large typed-array exclusion and replacement-path rejection, HTTP(S)-only frame URL parsing, and the pre-enumeration time guard. The browser harness uses an insecure mapped HTTP origin and tests invalid-number feedback, a two-million-element Float32Array, and reopening with deliberately stale storage after search/reset. Historical coverage rows above describe the initial run; current results are in TESTING.md. Manual toolbar and close-mid-search timing cases remain pending.
