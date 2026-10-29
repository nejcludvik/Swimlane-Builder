# Release verification — Swimlane Builder 2.0

Verified on 29 October 2026 using automated Chromium browser checks, desktop and mobile viewport emulation, touchscreen input emulation, and visual inspection of the editor and exported PNG.

**Result: 29 checks passed. No uncaught JavaScript errors were recorded.** JavaScript syntax validation also passed.

## Checks completed

- PASS — Initial layout and zero external dependencies
- PASS — All five shape types and inspector editing
- PASS — Undo and redo preserve editing
- PASS — Legacy JSON import preserves shape positions
- PASS — Malformed file and duplicate IDs leave diagram untouched
- PASS — Connector selection does not delete; labels and ports persist
- PASS — Manual connector route and reset
- PASS — Connect tool creates an additional labelled connection
- PASS — Port drag respects exact source and target sides
- PASS — Stage reorder retains shape membership and undo restores order
- PASS — Grid resizing scales offsets; min/max rejected
- PASS — Group movement and duplication retain internal connections
- PASS — Shape resizing and text updates refresh geometry
- PASS — Populated lane deletion moves shapes and Undo restores lane
- PASS — SVG export is valid XML with no editing controls
- PASS — PNG export generates a non-empty high resolution image
- PASS — JSON download round-trips all model data
- PASS — Browser recovery survives reload
- PASS — PDF print view contains diagram and can generate a PDF
- PASS — Mobile viewport has accessible controls and no horizontal page overflow
- PASS — Automatic routing avoids an intervening shape
- PASS — Pointer drag moves a multi-shape group together
- PASS — Deleting a populated stage with its shapes removes dependent connections
- PASS — Zoom and fit update scale without altering diagram data
- PASS — Example JSON validates and opens
- PASS — Touchscreen pointer drag moves a shape
- PASS — Disabled local storage leaves editing and JSON save usable
- PASS — Keyboard connection creation and focus survive rendering
- PASS — Another tab cannot silently overwrite this editing session

## Export evidence

- SVG output parsed successfully as XML and contained no selection controls.
- PNG output was a valid non-empty image at the requested high resolution.
- Downloaded JSON matched the in-memory diagram and passed its own validation/migration function.
- The PDF print view produced a valid, one-page landscape PDF in Chromium.
- The example JSON opened and validated successfully.

## Scope and practical limits

Testing used Chromium and emulated touch input; physical phones, Firefox, Safari, and the user's live GitHub deployment were not tested. Browser print/PDF settings vary. Very dense or overlapping diagrams may need manual connector routing. Legacy JSON did not record shape dimensions or connector sides, so these are inferred during import and should be visually checked. The README documents diagram limits, browser recovery, and manual-route behavior when stages or lanes are reordered.
