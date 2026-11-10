# Changelog

## 0.1.1 — 2026-11-10

### Fixed

- Initialize page sessions on insecure HTTP pages without requiring crypto.randomUUID.
- Preserve specific engine errors across the extension/page boundary, including initialization errors.
- Mark searches incomplete when a limit is reached exactly at an object boundary.
- Bind saved selections and Set requests to a result revision, preventing stale row selection after a search response is lost.
- Serialize UI storage writes and persist cleared selection before starting a new search.
- Invalidate saved fields after Reset using a reset epoch, including when its response is lost.
- Validate iframe links in the extension context and allow only absolute HTTP(S) URLs.

### Changed

- Exclude typed arrays and DataView from searching and editing, including paths whose parent was replaced with a typed array.
- Check scan budgets before enumerating each object. A single synchronous enumeration or proxy operation can still exceed the nominal time limit.
- Add detailed requirements, use cases, test plan, resolution plan, and verification records.

### Verification

- 17 automated tests passed.
- Chrome 157.0.8103.50 and Edge 157.0.4341.42 passed the updated browser regression suite, including insecure HTTP, specific invalid-number feedback, typed-array exclusion, and stale selection/reset recovery.
- Browser automation uses a temporary local-origin permission and a popup document opened as a background tab. Physical toolbar activation and close-mid-search timing remain pending.

### Known limitations

- WASM, private function/module state, and workers are unsupported.
- Built-in traversal ordering and timer overhead remain performance investigations.
- Large synchronous enumeration/proxy execution has no hard time bound.

## 0.1.0 — 2026-11-10

Initial implementation:

- Manifest V3 extension for desktop Chrome and Edge.
- Exact case-insensitive text matching and numeric value search.
- Repeated narrowing against previous candidates' current values.
- Single selection, type-preserving edits, and reset.
- Search state retained across popup closure, with separate tab/page sessions.
- Iframe source links for opening embedded content directly.
- Visible WASM limitation and bounded-scan feedback.

This version was not committed separately; the initial Git commit contains 0.1.1 and records the earlier release here for context.
