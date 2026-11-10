# Game Value Editor

A lightweight Manifest V3 extension for desktop Chrome and Microsoft Edge. Search accessible JavaScript properties by their current values, narrow previous results after playing, and edit one selected property.

**WebAssembly (WASM) is not supported.** The extension also cannot enumerate variables hidden inside private function scopes, JavaScript modules, or workers. A game running in the browser does not guarantee that its state is accessible. Server-authoritative games may ignore or overwrite local changes.

## Install

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this project's **extension** directory (the directory containing `manifest.json`).
4. Open your game, then click the extension's toolbar icon. Pin it if desired.

No build step is needed. If using the ZIP, extract it first and load the extracted extension directory. Browser settings, extension-store pages, and other protected browser pages cannot be inspected.

## Use

1. Enter a number or text in **Search value**, then click **Search**.
2. Click back into the game and change the relevant value through gameplay.
3. Reopen the extension, enter the new value, and click **Search again**. This filters only the previous candidates, using their current values. Repeat as needed.
4. Select one result, enter **New value**, and click **Set**.
5. **Reset** clears fields, selection, and results. It does not undo values already changed.

Text matching is exact and case insensitive; it does not match substrings. Numbers are compared numerically (`100`, `100.0`, and `1e2` match the number 100). Text values remain text, so the string `100.0` does not match a search for `100`. Surrounding spaces in text are significant. Boolean values can be found using `true` or `false`.

Set preserves the current property's type: text stays text; numbers require a finite numeric input; booleans require true/false. Empty inputs are disabled in this version. Read-only or missing properties cannot be set. Rows show property paths, values, and types. Only one row can be selected, with ten visible rows and scrolling for more.

## Persistence

Candidate paths and search state remain in the game's main JavaScript environment. Fields and selection use extension session storage, keyed to the tab and page session. Closing the popup, clicking outside it, switching tabs, or the background worker stopping does not clear results. Each tab is separate. Reloading/navigating the page, closing the tab, browser restart, or extension reload invalidates the previous session.

Search again follows each saved property path in the current page, so replacing a game object uses the property on the replacement object. Missing paths are dropped. Objects reachable under multiple aliases are scanned once and displayed using the first path found.

## Embedded games

The popup lists iframe URLs and highlights the largest frame as the likely game. Click a URL to open it directly, then use the extension in that new tab. Frames without a usable HTTP(S) source (such as srcdoc or blob content) have an explanatory message. Games that depend on their embedding page, login context, or initialization may not work directly. This version searches only the main frame and does not request extra cross-origin iframe permissions.

## Search limits

Search uses own data properties and avoids calling getters. It skips DOM trees and other windows, handles cycles, and yields between batches. It is bounded to 150,000 property checks, 20,000 queued objects, eight property levels, 10,000 results, and approximately 2.5 seconds of elapsed search time. A limited scan is clearly indicated; its narrowing searches remain incomplete. Large objects and proxies can still cause delays. Page scripts can see or alter the in-page search state.

## Permissions and privacy

- `activeTab`: temporary access when you click the extension.
- `scripting`: run the property search in the page's MAIN environment.
- `storage`: restore fields and selection after the popup closes.

The shipped extension has no permanent host permissions, external libraries, remote code, telemetry, or network requests.

## Development and verification

- `npm test`: search engine tests using Node's built-in test runner; no dependency install required.
- `npm ci`, then `node tests/browser-check.mjs`: automated checks against locally installed macOS Chrome and Edge, using temporary profiles and a local sample game. The harness adds a test-only local host grant because it opens the popup as a background tab rather than clicking the toolbar icon. The shipped manifest does not include that grant.
- For a manual toolbar check, run `python3 -m http.server 8000`, visit `http://localhost:8000/tests/game.html`, and follow the on-page instructions. Also check two-tab isolation, reloading, and the iframe link.

Browser automation requires permission to launch browsers and bind a local test server. Test profiles are temporary; existing browser profiles are not used.

## Project documentation

- [Requirements](REQUIREMENTS.md): scope, functional requirements, limits, and acceptance criteria.
- [Use cases](USE_CASES.md): user workflows, alternatives, and expected outcomes.
- [Test plan](TEST_PLAN.md): automated coverage and pending manual acceptance procedures.
- [Verification results](TESTING.md): actual test outcomes and limitations of the browser test harness.


Typed arrays and DataView are excluded from search and editing. Search time/property limits are cooperative: the scanner checks them before object enumeration, but a single synchronous own-property enumeration or proxy trap can exceed the nominal time limit. Saved selections are bound to a result revision; a completed Reset invalidates previously saved fields even if the popup closes before receiving its response.
