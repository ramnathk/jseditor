# Use cases — Game Value Editor

Updated: November 10, 2026. Actor: a user playing a browser-executed game. Unless stated otherwise, the extension is installed, the game is an ordinary HTTP(S) page, and its target value is a reachable JavaScript data property. Requirement IDs refer to REQUIREMENTS.md.

## UC-01 — Find and change a numeric game value

Requirements: FR-01–08, FR-10, FR-17.

Precondition: score and health both equal 100 and are reachable from window.

1. Open the extension; enter 100 in Search value and click Search.
2. See candidates for score and health, with paths, values, and types.
3. Click back into the game and spend 10 score, leaving health unchanged.
4. Reopen the popup; see the previous query and candidates retained.
5. Enter 90 and click Search again.
6. See only the score candidate, now equal to 90.
7. Select score, enter 999 in New value, and click Set.
8. See confirmation and the actual page property equal to the number 999.

Postcondition: candidates remain available until reset or document replacement. A visible game change depends on how the game uses this property. If the game overwrites it, the edit may be transient.

## UC-02 — Narrow repeatedly

Requirements: FR-05, FR-10.

Precondition: an initial search found several candidates equal to 100.

1. Play until the target becomes 90; narrow using 90.
2. Play until it becomes 80; narrow using 80.
3. Select the remaining target and optionally edit it.

Postcondition: each candidate set is a subset of its predecessor. A different property that later happens to equal 80 is not added. Zero matches is a valid outcome; use Search for a fresh discovery.

## UC-03 — Search and change text

Requirements: FR-02–04, FR-07–08.

1. With a reachable name equal to Hero, search for hErO.
2. Confirm the name matches while a search for her does not.
3. Select the name; set it to 123.

Postcondition: the property contains the string "123", not the number 123. Leading/trailing spaces are significant. Empty-string search/edit is outside the current UI's scope.

## UC-04 — Leave and reopen the popup

Requirements: FR-10, NF-03.

1. Search, select one candidate, and enter a replacement without applying it.
2. Click into the game, play, and reopen the popup.
3. Confirm fields, candidate list, and selection are restored.
4. Narrow using the game's new value, or apply a replacement to the selected candidate.

Postcondition: closing the popup does not lose search state. Search again and Set resolve current values rather than saved display values. If a search was still running when the popup closed, reopen to its running status and eventual results.

## UC-05 — Work with an embedded game

Requirements: FR-13–16.

1. Open the extension on a page containing iframes.
2. See available URLs, with the largest frame marked as likely game content.
3. Click the appropriate Open directly link.
4. In the newly opened tab, invoke the extension and start a fresh search.

Alternatives: no HTTP(S) source produces an unavailable-URL message. Multiple frames require the user to choose; largest does not establish which is the game. Games depending on the parent page may fail to initialize directly. Opening a frame does not transfer the original tab's search state.

## UC-06 — Reject an invalid or unavailable edit

Requirements: FR-07–08, FR-17.

- Select a numeric result and enter abc: Set reports a finite-number error and leaves the property unchanged.
- Select a boolean and enter yes: Set reports that true/false is required.
- Select a read-only result: Set remains disabled; the engine also rejects a direct write request.
- Remove a candidate property during gameplay: it becomes unavailable; Set fails rather than silently creating it.
- Replace the parent object with another containing the same path: operations use the replacement object's property.

Postcondition: feedback reflects whether an immediate write succeeded. There is no automatic rollback history.

## UC-07 — Reset and start again

Requirements: FR-03, FR-09.

1. After searching/editing, click Reset.
2. Confirm both fields, selection, and results are empty; Search again is disabled.
3. Enter a new value and click Search.

Postcondition: fresh discovery is possible. Previous writes to the game are not undone. Search itself can also start fresh without Reset.

## UC-08 — Use separate tabs and reload

Requirements: FR-11–12.

1. Open two game tabs; perform different searches and selections in each.
2. Switch between them and reopen the extension.
3. Confirm each restores only its own state.
4. Reload one game tab and reopen the popup.

Postcondition: the reloaded tab has a new session and empty candidates; the other tab's state remains intact. Closing a tab removes its stored UI fields. Browser/extension restart need not restore prior state.

## UC-09 — Understand incomplete or unsupported searches

Requirements: FR-16–18, NF-06–07.

1. Open the popup and see that WASM is not supported.
2. Search a large or deep reachable object graph.
3. If limits are reached, see the incomplete-scan notice with the candidate count.
4. Narrow those candidates, or start a new search after changing the search value.

Alternatives: a game with private/module/worker/WASM-only state may have no useful results. On a protected browser page the popup reports that inspection is unavailable. Neither zero matches nor a completed bounded scan proves that the value does not exist elsewhere in the game's memory.
