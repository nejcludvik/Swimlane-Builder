# MESI Swimlane Builder — 2.0

A self-contained swimlane editor for GitHub Pages. No build step, accounts, server-side services, or external libraries are needed. Diagram content stays in the browser unless you download, print, or share it yourself.

## Update your GitHub site

1. Back up your current three app files and any saved diagram JSON files.
2. Upload **index.html**, **script.js**, and **styles.css** from this package to the same folder in your repository. Replace the previous JavaScript and CSS files.
3. The main page must be named **index.html**. The supplied `index.html` replaces the uploaded `index(2).html`; do not rename the new entry page to `index(2).html`.
4. Commit the changes. Keep your existing GitHub Pages publishing branch and folder configuration.
5. Once the site updates, reload the page. If it still looks like the old editor, perform a hard refresh.

You can also open `index.html` directly to use the editor offline. Browser recovery is most consistent on the hosted site; local-file browser storage behavior varies.

## What changed

- Safe JSON import: validate the entire file before changing the canvas. Invalid files preserve the current diagram. Opening a valid file is undoable.
- Versioned JSON format, duplicate-ID validation, safe text rendering, input limits, and support for diagrams exported by the original app.
- Undo/Redo for up to 100 editing actions, browser recovery, JSON-save status, and an unsaved-changes reminder on closing/reloading (subject to browser behavior).
- Multiple-tab recovery conflict detection: when another tab changes the recovery copy, this tab pauses its recovery writes and lets you choose which copy to retain.
- Shapes belong to stable stage and responsibility IDs. Reorder a row/column and its shapes move with it. Resizing rows/columns proportionally adjusts shape offsets inside their assigned cells. Shape sizes stay unchanged.
- Deleting a populated stage/responsibility offers to move its shapes to another one or delete those shapes and their connectors. At least one stage and responsibility are retained.
- Process, Decision, Start, End, and standalone Text shapes; inspector-based resizing; direct resize handles; text-aware height adjustment; and layer ordering.
- Shift-selection, group dragging, duplication including internal connections, in-app copy/paste, keyboard movement, center/edge alignment, and equal-gap distribution.
- Connectors retain their selected source and destination sides. Labels are attached to connectors. Clicking a connector selects it; deletion requires Delete or the inspector button.
- Automatic orthogonal routing avoids shapes where a clear route is available. Orange handles and additional route points allow manual routing. Reset restores automatic routing.
- Dynamic canvas bounds, movement constrained to non-negative content coordinates, center/grid snapping, and alignment guides that follow the canvas size. Hold Alt during a drag to bypass snapping.
- Zoom, fit-to-diagram, panning, pointer-event dragging, touch-accessible ports, a responsive layout, and keyboard-focusable shapes/connectors.
- Document title, reference, revision, date, and an optional footer.
- PNG downloads at selectable resolution, standalone SVG downloads, and PDF through the browser's Print / Save as PDF dialog.
- Native SVG rendering replaces the external Tailwind and html2canvas dependencies.

## Editing

Add shapes with the toolbar. Drag their bodies to move them. Double-click text to edit it, or select an item and use the properties panel.

For connections, drag a blue port to another port or shape. Dropping on a shape chooses its nearest side. Alternatively, choose **Connect**, then click or tap source and destination. Select the connector to edit its label and endpoint sides. Drag the orange handle to add a fixed routing point; the inspector can add more. Manual routes use horizontal/vertical segments through the supplied points and may cross shapes; reset to return to automatic avoidance.

Expand **Stages & responsibilities** to rename, reorder, delete, or resize rows/columns. A shape's membership follows its top-left corner when dragged. Shapes may extend across cell boundaries. The canvas grows to include content beyond the grid; it does not add new lanes or stages automatically.

Select more than one shape with Shift-click, then drag any selected shape to move the group. Manual route points move with a group when both connector endpoints belong to it. Reordering a stage/lane leaves manual route points fixed, so reset or adjust those routes afterward if needed.

On touch screens, use **Pan** to move around the canvas and **Select** to drag shapes. Use the visible zoom controls. The inspector remains available below the canvas on narrow screens.

## Save, recovery, and compatibility

**Save JSON** downloads a portable editable diagram. Automatic browser recovery is a convenience, not a backup. It stores the latest diagram for this origin/browser profile and is unavailable if the browser blocks or clears local storage. Keep portable JSON copies of important work.

Files exported by the original app can be opened directly. Text, phases, responsibilities, positions, and connections are migrated. The original format did not store shape dimensions, connection sides, or attached labels; imported diagrams use reasonable default dimensions and inferred connection sides. Review the layout after importing an old file.

Limits: 500 shapes, 1,000 connectors, 60 stages, 100 responsibilities, 50 manual route points per connector, and JSON files up to 10 MB. These limits keep accidental oversized imports manageable. Very dense diagrams may require manual routing. Overlapping nodes or blocked endpoint ports may make an obstacle-free route impossible; move the shapes or adjust the ports.

## Export

- **SVG:** resolution-independent vector output containing all diagram content and no selection controls. Useful for editing and document workflows that support SVG.
- **PNG:** white background, 1× / 2× / 3× resolution. Extremely large images are automatically reduced to remain within memory limits; SVG is preferable for large diagrams.
- **PDF / Print:** opens a clean vector print view and the print dialog. Choose **Save as PDF**, landscape orientation, and fit to page. If popups are blocked, allow a print tab for this site. If the automatic print dialog does not appear, use the button in the new tab. Paper size and scaling are controlled by the browser. For large procedures, choose a larger page size or use SVG.

Exports include the document title and metadata. The bottom document footer can be toggled separately.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Undo | Ctrl/Cmd + Z |
| Redo | Ctrl/Cmd + Shift + Z; Ctrl + Y |
| Save / Open JSON | Ctrl/Cmd + S / O |
| Select all | Ctrl/Cmd + A |
| Duplicate | Ctrl/Cmd + D |
| Copy / Paste within app | Ctrl/Cmd + C / V |
| Move selected shapes | Arrow keys; Shift for 10 px |
| Delete selected shapes/connector | Delete or Backspace |
| Cancel action / clear selection | Escape |
| Select / Connect / Pan | V / C / H |
| Temporary Pan | Hold Space and drag |
| Zoom at pointer | Ctrl/Cmd + mouse wheel |
| Bypass snapping | Hold Alt while dragging |

Text fields retain their normal typing and browser shortcuts. Tab can focus shapes and connectors; Enter selects them. Use the inspector to edit or delete the selected item.

## Files

- `index.html`: app page and controls.
- `styles.css`: responsive editor and print styles.
- `script.js`: state model, import validation, history, recovery, editing, routing, and exports.
- `example-diagram.json`: example approval workflow.
- `TEST_REPORT.md`: checks completed for this release.

The `window.SwimlaneBuilder` object exposes a read-only model snapshot (`getDiagram`) and a validation/migration utility (`validateDiagram`) for troubleshooting. Returned objects are copies.
