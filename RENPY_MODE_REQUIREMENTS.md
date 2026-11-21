# Requirements — Ren'Py Mode

Status: implemented in 0.2.0, hardened after an independent review. Applies on top of REQUIREMENTS.md. Anything not overridden here keeps its existing behavior.

## Background

Ren'Py web exports run game state as Python objects in WASM, so the JS-heap search (FR-03) cannot see it. Verified against the loader (`renpy-pre.js`) of the sample game:

- The page exposes `window.renpy_exec(script) → Promise`. It base64-encodes the script with `btoa()` (throws above U+00FF), runs it with `exec` using the **store as globals and a throwaway dict as locals**, and resolves with the Python variable `result`. Commands are queued one at a time. There is no timeout or cancel, and a `btoa` failure leaves the queue jammed until reload.
- Commands run only from the interaction loop's periodic event, never between statements or before the first interaction.
- The store shadows `dict`, `list`, `set`, `object`, `range`, `sorted`, `eval` and `print` with Ren'Py versions. Nothing assigned in the script reaches the store.
- `renpy_get`/`renpy_set` paste their arguments into Python source, so they are injection sinks. **The extension never calls them.**
- Engine internals were read from Ren'Py 8.2.1 sources in the bundled zip, while `renpy.js` points at Python 3.11. Re-verify internals against the running version.

## Functional requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| RP-01 | Detection | Main frame has `typeof window.renpy_exec === 'function'` → popup shows "Ren'Py game" and uses the Python backend. Otherwise behavior is unchanged. |
| RP-02 | Readiness | A probe (2.5 s timeout) confirms the game is waiting at a screen. If not: "The game is not ready. Click into the game, then try again." Search is not attempted; no command is queued behind a stalled one. |
| RP-03 | Matching | Exact types only: `bool`, `int`, `float`, `str`. Subclasses (e.g. Ren'Py `absolute`) are skipped. Booleans match only `true`/`false`; numeric queries never match booleans. Numbers compare numerically, text exactly and case-insensitively (Python `lower()`). |
| RP-04 | Roots | Names in the store not starting with `_`, plus `persistent` as an explicit root. Recurse only into exact builtin or Revertable `list`/`dict`/`tuple`, and instances of classes whose module is `store`/`store.*` (user classes) or `renpy.persistent.Persistent`. Everything else (StoreModules like `gui`, Ren'Py objects, functions, modules, sets) is skipped. Persistent attributes starting with `_` are skipped. |
| RP-05 | Paths | Structured segments: `["g",name]`, `["a",attr]`, `["i",index]`, `["k",key]`. Only `str` and safe-range `int` keys; `bool` and other keys skipped. A hand-written resolver walks them; there is no `eval` and no path-to-source conversion. The label (`inv['bag'][0]`, `game_board.moves_left`) is display only. |
| RP-06 | Narrowing | Re-resolves each saved path and keeps those that still match. A path to a replaced object resolves on the replacement. Missing paths drop. |
| RP-07 | Set | Python re-validates type and value, writes, reads back, and calls `renpy.restart_interaction()` in one call. Writes use Ren'Py's tracked paths only (`RevertableObject.__setattr__`/`object.__setattr__`, Revertable containers, store dict). The target must still have the exact type that was shown, or the write is rejected. |
| RP-08 | Read-only | Tuple elements, objects with a custom `__setattr__`, ints beyond ±(2^53−1) and non-finite floats are read-only. Properties and set members never appear. |
| RP-09 | Results | List shows label, type and value; the detail line adds the owning class (`[Board]`). |
| RP-10 | Persistence | Candidates are kept in page JS state (a Ren'Py-specific key) and never in the game's store, so saves are unaffected. The popup stores `backend`; a mismatch discards saved fields. |
| RP-11 | Bounds | Walk runs in slices of about 150 ms across several commands (so the game keeps rendering). Totals: 150,000 checks, 20,000 queued objects, depth 8, 10,000 results, about 2.5 s of Python time. Hitting any limit marks results incomplete. Walk state lives in a private `sys.modules['_gve_state']` module, never reachable from the store. A single object's enumeration cannot be preempted. |
| RP-12 | No game code | Never calls getters, `__getattr__`, `__getattribute__` (types overriding it are skipped), `__iter__` or `__eq__` of game classes. Uses `type()` identity, `B.dict.items`/`get`, `B.list.__getitem__`, `object.__getattribute__(o,'__dict__')` and member descriptors for slots. Never indexes a default-dict. |
| RP-13 | Errors | Python errors return a short message plus a truncated traceback shown in a collapsible "Error details". Success is never reported on failure. |
| RP-14 | Serialization | Ints outside the safe range and non-finite floats are sent as strings and are read-only. Unknown values show `(unavailable)`; the extension never calls `repr` on game objects. |
| RP-15 | Concurrency/timeouts | At most one command outstanding. Each carries a deadline (≤ 9 s); Python ignores an expired command, so "no response" never means "applied later". After a timeout the engine is `stalled` and refuses new commands until the old promise settles. |
| RP-16 | Iframes | Ren'Py mode runs in the main frame only; FR-13/FR-14 unchanged. |
| RP-17 | Disclosure | The popup states that edits can be undone by rollback and are included in later saves. |

## Technical requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| RT-01 | Bridge | A MAIN-world function calls `window.renpy_exec(source)` and awaits it. |
| RT-02 | One fixed program | `renpy-python.js` is a single ASCII-only Python program with exactly one placeholder, `__GVE_ARGS__`, replaced by base64(UTF-8(JSON)). The engine refuses any other source. No user text is ever spliced into the source. |
| RT-03 | Namespace safety | Top-level code is one assignment (`result = _gve_main(...)`). All logic is nested closures inside `_gve_main`; builtins come from `import builtins as B`; no `print`, `global`, or store writes other than the Set target. Catches `BaseException` so nothing escapes the wrapper and jams the queue. Written for Python 3.8+. |
| RT-04 | Input safety | The path grammar is validated in Python before resolution. Replacement values are re-validated with strict regexes. |
| RT-05 | Untrusted replies | The popup runs every reply through `sanitizeSnapshot` (bounded counts and lengths, enum types, boolean coercion). Rendering uses `textContent` only. |
| RT-06 | Permissions | Unchanged: `activeTab`, `scripting`, `storage`. |
| RT-07 | ASCII | Every string given to `renpy_exec` is 7-bit ASCII; a test asserts it. |

## Security statement (NF-01 exception)

NF-01 still forbids remote code and `eval`/`Function` in extension pages. Ren'Py mode may pass **one packaged, fixed, ASCII Python program** to the page's own interpreter, with data only via base64 JSON. The page already owns that interpreter, so this is no escalation, and the security boundary stays in the extension realm. A hostile page can spoof or observe the bridge, as it can the JS scanner; its replies are therefore bounded and re-typed (RT-05).

## Known limits

- **Rollback:** edits revert if the player rolls back to the current statement or earlier.
- **Overwrites:** the game may reassign a value later. In the sample game `diff_moves` is reassigned from level data before each level, so editing it has no lasting effect; edit `game_board.*` during a level instead.
- **Unreachable:** screen-scoped `default` variables, function locals, sets and WASM memory.
- **Noise:** roots are chosen by type rather than by the game's `default` list, so Ren'Py's own store scalars can appear when they match.
- **Float timers:** values match exactly; "changed/decreased" filters are not implemented.
- **Not verified in a real Ren'Py game yet:** slice timing in WASM, `restart_interaction` visibly updating the counter, rollback and save interaction, `persistent` persistence, the deadline clock matching `Date.now()`, other Ren'Py versions. See TEST_PLAN.md.

## Acceptance scenarios

1. Setting a global: search `15`, see `diff_moves = 15 (int)`, Set `30`, the game variable is the int `30`.
2. In a level: search the displayed moves value N, make a move, Search again with N−1, Set `99`; the counter updates.
3. After a level ends, `game_board.*` remains until the next level replaces it; Search again keeps it only if it still matches.
4. `abc` is rejected for an int; `diff_limit_mode` stays a string; `flag` (True) never matches `1`.
5. A non-Ren'Py page behaves exactly as v0.1.2.
6. Opening the popup before the game is waiting shows "not ready", not an error, and queues nothing further.
7. Quotes, backslashes, newlines, emoji, accents and U+2028 in query or replacement are matched/written literally, run no code, and the queue keeps responding.
