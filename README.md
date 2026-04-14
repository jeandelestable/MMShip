🇫🇷 [Version française](README.fr.md)

# MMShip — Shipping label cropper

A Chrome Extension (Manifest V3) to crop and print PDF shipping labels directly from the browser — no server, no external service. Everything runs locally.

**Supported carriers:** DPD · Mondial Relay · DHL

---

## Features

- **PDF import** via file picker or the "Send to editor" button in the popup (works on any HTTP(S) tab displaying a PDF)
- **Automatic carrier detection** via text extraction (pdf.js) and keyword matching
- **Visual crop zone** pre-drawn on load (calibrated coordinates per carrier, or a centered 10×15 cm default for unknown carriers) — resize by dragging any of the 8 handles (corners + edge midpoints), move by dragging the interior, or redraw from scratch by dragging an empty area
- **Crop mask** darkens the area outside the selection so you immediately see what will be printed
- **"Crop ON/OFF" toggle** — OFF prints the full page, ON prints the selected zone
- **Zoom** (×0.5 to ×3.0) on the displayed PDF
- **Print** via iframe (primary strategy) or canvas (fallback), with rotation support
- **Info panel** (left sidebar): load date/time, PDF filename, detected carrier, and a heuristically extracted recipient name/address
- **Green badge** on the extension icon when a PDF is confirmed in the active tab (file:// with permission, or HTTP with `Content-Type: application/pdf`)
- **Tab title** updates to `MMShip | {filename}` when a PDF is loaded, reverts to `MMShip label cropper` otherwise

---

## Architecture

### Tech stack

| Tool | Role |
|---|---|
| [Vite](https://vitejs.dev/) + [@crxjs/vite-plugin](https://crxjs.dev/) | Bundler + Chrome Extension packaging |
| [Tailwind CSS v3](https://tailwindcss.com/) | Styles (via PostCSS) |
| [pdf.js (pdfjs-dist v5)](https://mozilla.github.io/pdf.js/) | PDF rendering + text extraction |
| [pdf-lib](https://pdf-lib.js.org/) | PDF manipulation: setCropBox, rotation |

> **Tailwind v3** (not v4): required by @crxjs/vite-plugin (beta), which does not support Tailwind v4's CSS imports.

### File structure

```
manifest.json              # Manifest V3 — permissions, service worker, popup
vite.config.js             # Vite + CRXJS config
src/
  background.js            # Service Worker: context menu, PDF fetch, popup messages
  popup/
    index.html             # Popup UI (2 buttons)
    popup.js               # Popup logic: PDF tab detection, send to editor
  editor/
    editor.html            # Main editor interface
    editor.js              # Orchestration: loading, zoom, cropping, printing
    pdfRenderer.js         # pdf.js loading + canvas rendering
    cropOverlay.js         # Crop overlay: drawing, mask, corner handles
    pdfPrinter.js          # Print: iframe strategy (primary) + canvas (fallback)
  config/
    carriers.js            # Carrier definitions + detection logic
  styles/
    main.css               # Tailwind entry point (@tailwind base/components/utilities)
```

---

## Key modules

### `src/background.js` — Service Worker

- Registers the context menu item "Send to MMShip editor" (via `onInstalled`)
- On context menu click **or** `sendPdfToEditor` message from the popup:
  1. `fetch(pdfUrl)` — works on all domains thanks to `host_permissions: ["<all_urls>"]`
  2. Validates that `Content-Type` is `application/pdf` — throws otherwise (prevents closing the source tab for an HTML page)
  3. Base64-encodes in 8192-byte chunks (avoids stack overflow on large PDFs)
  4. Stores in `chrome.storage.session` (`pendingPdf: { base64, url }`)
  5. Opens the editor in a new maximized tab
  6. Closes the source tab after 1.5 s (only on success, only if `tabId` was provided)
- Responds `{ ok: true/false }` asynchronously (listener returns `true` to keep the message channel open)

### `src/popup/popup.js`

- On load: queries the active tab (`chrome.tabs.query`), then sends a `HEAD` request to check `Content-Type` before enabling the "Send" button:
  - `Content-Type: application/pdf` → button enabled + **green badge** set on the extension icon
  - HTTP 200 + non-PDF → button disabled + message *"No PDF detected in this tab."* + badge cleared
  - Network error, 401/403, HEAD not supported → button enabled optimistically (no badge; the SW will re-validate with GET)
  - Non-HTTP(S) URL (internal tab, local file) → button disabled + explanatory message + badge cleared
- "Send" button: switches to "Loading…", sends `{ action: 'sendPdfToEditor', url, tabId }` to the SW, awaits the async response, shows inline error on failure
- "Open editor" button: opens an empty editor (fire-and-forget)

### `src/editor/editor.js` — Main orchestration

**Global state:**
```js
pdfPage         // PDFPageProxy from pdf.js
pdfPageWidth/Height  // page dimensions in PDF points (scale 1)
pdfBytesOrig    // Uint8Array for pdf-lib
currentScale    // current zoom (default 1.5)
detectedCarrier // key from carriers.js, or null
cropRect        // { x, y, width, height } in canvas pixels at currentScale
cropEnabled     // crop ON/OFF toggle state
pdfTitle        // filename without extension (for tab title + info panel)
pdfRawText      // raw text extracted by pdf.js (for recipient heuristic)
```

**On PDF load (`loadPdfFromBuffer(arrayBuffer, title)`):**
1. Text extraction + carrier detection
2. `document.title` set to `MMShip | {title}`
3. `cropRect = computeInitialCropRect()` → carrier coordinates or centered 10×15 cm zone
4. Render + display crop mask
5. `activateDrawing(cropOverlay, cropRect, callback)` → pre-loads the initial zone so handles are immediately active
6. `updateInfoPanel()` → populates the left sidebar
7. `extractRecipient(pdfRawText)` → searches for "destinataire" keyword, then falls back to a French postal code pattern to extract name + address + city

**Coordinate conversions:**
```
canvas → PDF : x/scale, y = pageHeight − (y+h)/scale
PDF → canvas : x*scale, y = (pageHeight − y_pdf − h_pdf)*scale
```

The PDF coordinate system has its origin at the bottom-left corner (y increases upward), which is the opposite of the HTML canvas.

### `src/editor/cropOverlay.js`

- `activateDrawing(canvas, initialRect, onCropDefined)`: attaches mousedown/move/up listeners; pre-loads an existing rect so its handles are immediately draggable
- `deactivateDrawing(canvas)`: removes listeners (handlers stored in a module-level object for clean `removeEventListener`)
- `setCurrentRect(rect)`: syncs the module's internal rect when the editor changes it externally (zoom rescale, toggle reset) — prevents stale state during the next drag
- `drawRect(canvas, rect)`:
  1. Fills the entire canvas with `rgba(0,0,0,0.40)` (dark mask)
  2. `clearRect(rect)` → transparent cutout over the selected zone (shows the PDF beneath)
  3. Draws a dashed blue border + **8 square handles** (4 corners + 4 edge midpoints) with white border
- **Interaction model** (3 modes, driven by `hitTest`):
  - Drag a **handle** → `resizing` mode: `applyResize(handle, origRect, dx, dy)` moves the appropriate edges while enforcing a 10 px minimum size
  - Drag the **interior** → `moving` mode: translates the rect, clamped to canvas bounds
  - Drag an **empty area** → `drawing` mode: creates a new rect from scratch
- Document-level `mousemove`/`mouseup` listeners are registered on `mousedown` and removed on release, so dragging outside the canvas never loses tracking
- Contextual cursors: `nw-resize`, `ns-resize`, `ne-resize`, `ew-resize`, `sw-resize`, `se-resize`, `move`, `crosshair`

### `src/editor/pdfPrinter.js`

**Primary strategy (`printCropped`):**
- pdf-lib: `page.setCropBox(x, y, w, h)` + `page.setRotation(degrees(r))`
- Generates a PDF blob, injects it into an `<iframe>`, calls `iframe.contentWindow.print()`
- 3 s timeout: if the iframe fails to load (CSP would block the blob), throws → fallback

**Fallback strategy (`printViaCanvas`):**
- Off-screen render at scale 3.0 (print quality)
- Crop zone extracted via `drawImage`
- Rotation via `applyRotationToCanvas` (translate + rotate on 2D context)
- Shows the canvas, calls `window.print()`, hides the canvas

### `src/config/carriers.js`

```js
export const carriers = {
  DPD: {
    keywords: ['DPD', 'dpd france', 'dpdgroup', 'chronopost'],
    cropCoordinates: { x: 0, y: 421, width: 297, height: 421 },
    // A4 portrait (595×842 pt), top-left quarter
  },
  MondialRelay: {
    keywords: ['mondial relay', 'mondialrelay', ...],
    cropCoordinates: { x: 85, y: 34, width: 425, height: 283 },
    rotation: -90,
    // A4 portrait, bottom half, rotated 90° counter-clockwise when printing
  },
  DHL: {
    keywords: ['dhl', 'deutsche post', ...],
    cropCoordinates: { x: 85, y: 28, width: 283, height: 539 },
    // A4 landscape (842×595 pt), left half
  },
}
```

**Detection:** `rawText.toLowerCase().replace(/\s+/g, ' ')` then `includes(keyword)` — whitespace normalization is essential because pdf.js sometimes extracts text with extra spaces (e.g. `"MONDIAL  RELAY"`).

**Calibration:** to add a new carrier, load a PDF in the editor, draw the zone manually, and read the coordinates shown in the "Crop zone" indicator.

---

## Build & Installation

### Prerequisites

- Node.js ≥ 18 (tested with nvm)
- npm

### Build

```bash
npm install
npm run build        # outputs to dist/
```

For development with hot-reload (limited for extensions):
```bash
npm run dev
```

### Install in Chrome

1. `npm run build` → `dist/` folder is generated
2. Chrome → `chrome://extensions/` → enable "Developer mode"
3. "Load unpacked" → select the `dist/` folder
4. After each `npm run build`: click "Reload" on the extension card
5. ⚠️ After modifying `manifest.json`: disable/re-enable the extension (or remove and reload)

---

## Technical decisions & known pitfalls

### @crxjs/vite-plugin and `rollupOptions.input`
CRXJS treats HTML files referenced in `web_accessible_resources` as static assets (not Vite entry points). `editor.html` must be explicitly declared in `rollupOptions.input` for its `<script type="module">` imports to be bundled correctly.

### pdf.js and Vite (`optimizeDeps.exclude`)
pdf.js ships its own worker (`pdf.worker.min.mjs`). Vite must not pre-bundle it. Fix: `optimizeDeps: { exclude: ['pdfjs-dist'] }`. The worker is imported with the `?url` suffix to get its final path in the bundle.

### CORS when fetching a PDF from an external domain
The editor page (`chrome-extension://...`) cannot directly fetch a PDF from `https://third-party.com` (CORS). The Service Worker can, because `host_permissions: ["<all_urls>"]` bypasses CORS restrictions at the SW level. Flow: SW fetches → base64 → `chrome.storage.session` → editor reads on startup.

### Storing large binary files
`String.fromCharCode(...bytes)` on a large array causes a stack overflow (spreading a multi-MB Uint8Array). Fix: split into 8192-byte chunks before calling `btoa()`.

### PDF coordinate system
- Origin (0,0) = **bottom-left corner** of the page
- Y increases **upward** (opposite of the HTML canvas)
- Unit: **typographic points** (1 pt = 1/72 inch ≈ 0.353 mm, 1 cm ≈ 28.346 pt)
- A4 portrait page = 595 × 842 pt

### Mondial Relay rotation
The Mondial Relay label is landscape-oriented inside a portrait PDF. Printing requires a −90° rotation (90° counter-clockwise). iframe strategy: `page.setRotation(degrees(-90))` via pdf-lib. Canvas strategy: `ctx.translate(0, dest.height); ctx.rotate(-Math.PI / 2)`.

### Two-step PDF validation (popup + SW)
The popup sends a `HEAD` request to disable the "Send" button before the user even clicks (UX). The SW re-validates with a full `GET` and checks `Content-Type` again to ensure a HEAD false-positive doesn't close the source tab. This double validation covers: servers that don't support `HEAD` (popup fails → optimistic), redirects, and incorrect Content-Type headers.

### Source tab closing
The `tabId` of the source tab is passed by the popup in the `sendPdfToEditor` message. The SW calls `chrome.tabs.remove(tabId)` with a 1.5 s delay **only on success**, after the editor tab is open. On failure, the source tab is never touched.
