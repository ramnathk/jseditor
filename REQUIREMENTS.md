# Requirements — Game Value Editor

Version: 0.1.1. Updated: November 10, 2026.

This specification records the requested behavior and the scope of the current implementation. Implementation does not imply that every requirement has been verified. See TEST_PLAN.md for coverage and TESTING.md for observed results.

## Purpose and scope

Help a user locate accessible JavaScript properties in a browser game by searching for a known current value, narrowing the candidate list as gameplay changes the value, and editing a selected candidate. The game executes locally in the browser rather than being video streamed. Local execution alone does not guarantee accessible state.

Targets: desktop Chrome and Microsoft Edge, using Manifest V3. The manifest declares Chrome 102 as a minimum; that minimum has not been tested. Verified browser versions are recorded in TESTING.md. No build step or backend service is required.

## Functional requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| FR-01 | Toolbar dialog | Clicking the extension icon opens a lightweight popup for the active game tab. |
| FR-02 | Search field | Accept numeric or text input. Empty input disables Search and Search again. |
| FR-03 | Fresh search | Search discards previous candidates and finds accessible own data properties matching the entered value within the documented search limits. |
| FR-04 | Exact matching | Text comparisons ignore case and require a whole-value match. Substrings do not match. Numeric properties compare numerically. |
| FR-05 | Narrowing | After a completed search, Search again checks only previous candidate paths against the new input using their current values. It never discovers additional candidates. Repeated narrowing is supported. |
| FR-06 | Results | Initially empty. Show property path, current value, and type. Present ten visible rows with scrolling for more; permit only one selected row. Clear selection on fresh search, narrowing, and reset. |
| FR-07 | Replacement field | Accept a nonempty new value. Preserve the selected property's current primitive type. |
| FR-08 | Set | Enable only with a writable selected result, nonempty replacement, and no operation running. Change that property and report immediate success or failure. |
| FR-09 | Reset | Clear both fields, candidates, selection, and search state for the current page session. Do not undo prior game edits. |
| FR-10 | Popup persistence | Closing the popup or clicking elsewhere must preserve candidates, query, replacement text, and selection for reopening in the same tab and page session. Search again must read current game values. |
| FR-11 | Tab isolation | Each tab has independent fields, selection, and candidates. Closing a tab removes its saved UI fields. |
| FR-12 | Session boundaries | Reloading/navigating the document invalidates previous search candidates. Browser or extension restart need not restore search state. Reset affects only the current session. |
| FR-13 | Iframe discovery | List iframe source URLs found in the main document. Highlight the largest frame with nonzero dimensions as likely game content; this is a heuristic, not a guarantee. |
| FR-14 | Direct iframe link | Offer a clickable HTTP(S) URL opening in a new tab. Resolve relative sources. Explain when no usable URL exists, including srcdoc/blob cases. Do not navigate automatically. |
| FR-15 | Embedded-game limitations | Explain that games may require the embedding page. Search the main document only; direct inspection inside a cross-origin iframe is outside this release. |
| FR-16 | WASM disclosure | Display “WASM is not supported” in the popup and documentation. |
| FR-17 | Errors | Report unavailable pages/properties, read-only properties, invalid replacements, and unsuccessful writes without claiming success. |
| FR-18 | Busy state | Disable competing operations while searching/updating. Reopening during a search must show its current status and eventually display results. |

## Matching and editing rules

- Strings: compare the full value after JavaScript lowercasing; preserve whitespace. No locale-specific collation or Unicode normalization is promised.
- Numbers: convert the nonblank input using JavaScript Number and require a finite value. The number 100 matches `100`, `100.0`, or `1e2`. The string `100.0` does not match the query `100`.
- Booleans: match true/false case insensitively; replacements must also be true/false.
- Empty search/replacement inputs are unsupported in this release. Whitespace-only strings are allowed, but whitespace-only numeric replacements are rejected.
- Null, undefined, symbols, big integers, objects, and functions are not editable result values.
- Candidate identity is a saved property path from window. Search again and Set resolve that path against the current document. Replacing an object therefore targets the property on the replacement object. Missing or accessor-based paths become unavailable.
- Aliased objects are scanned once, using the first discovered path. Array entries can be matched through their own data properties; Map/Set entries and prototype-only properties are not enumerated.
- Set confirms the immediate resulting value. The game may overwrite it later; no freeze/lock behavior or lasting game effect is promised.

## Nonfunctional and technical requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| NF-01 | MV3 compatibility | Use an MV3 manifest and packaged JavaScript; no remote code or eval-based execution. |
| NF-02 | Page context | Execute the search in the page MAIN world rather than the extension's isolated JavaScript world. |
| NF-03 | Persistence architecture | Keep candidates in page state. Keep UI fields/selection in extension session storage keyed to tab and page-session ID. Do not depend on popup or background-worker globals for persistence. |
| NF-04 | Minimal permissions | Ship only activeTab, scripting, and storage; no permanent host grants. |
| NF-05 | Local data | No game-data transmission, telemetry, external services, or network requests from extension code. |
| NF-06 | Bounded scan | Bound scanning to approximately 2.5 seconds, 150,000 property checks, 20,000 queued objects, eight property levels, and 10,000 matches. Yield between batches. Clearly flag incomplete scans. |
| NF-07 | Accessor avoidance | Inspect own property descriptors without intentionally invoking getters; skip DOM trees and other windows, handle cycles, and catch inaccessible-object errors. Proxy traps may still execute and individual browser operations cannot be preempted. |
| NF-08 | Usable feedback | Label inputs, provide keyboard-operable standard controls, show status/errors, and display full paths in result details. Do not interpret page-provided strings as HTML. |

## Explicit exclusions and constraints

WASM memory, workers, private closure variables, module internals, streamed games, server-side state changes, unknown lexical-variable enumeration, cross-origin iframe inspection, automatic undo, arbitrary code evaluation, and value freezing are outside scope. Browser-protected pages cannot be inspected. Page scripts can see or alter the in-page scanner state; this is a utility rather than a security boundary.

## Open verification items

Physical toolbar activation and the shipped activeTab grant, minimum browser versions, two-tab isolation, real iframe-link activation, popup visual layout/scrolling, restricted-page error presentation, and third-party game compatibility require further manual verification. See TEST_PLAN.md for procedures.


Typed arrays and DataView are excluded from search and editing. Search time/property limits are cooperative: the scanner checks them before object enumeration, but a single synchronous own-property enumeration or proxy trap can exceed the nominal time limit. Saved selections are bound to a result revision; a completed Reset invalidates previously saved fields even if the popup closes before receiving its response.
