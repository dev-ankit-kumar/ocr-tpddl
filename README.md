# SnapSheet: documents to Excel

A frontend-only React app with two modes:

- **Transformer nameplates** (main mode): photograph plate after plate. The app reads **Make, Sr. No, KVA and Year of Mfg**, you check them, and at the end you download one formatted Excel **register** of all transformers.
- **Any table:** photograph a document, receipt or printed table, review it as an editable table, and download it as an **.xlsx** file.

> Your document is processed on your device and is not uploaded to any server. There is no backend, no database, no analytics, and no third-party requests at runtime.

## Transformer nameplate mode

```
Scan Nameplate → capture → Read Nameplate → check 4 fields → Save & scan next → … → Register → Download Excel
```

1. **OCR:** [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv4 models run on the device via ONNX Runtime Web, in a Web Worker (`workers/paddle.worker.ts`). PaddleOCR is far more accurate than Tesseract on photos of stamped, faded or glary metal plates.
   - The photo is contrast-normalized first (local mean and spread), which makes faint stamped text readable.
   - Detection and recognition follow the reference pipeline, with lightweight axis-aligned boxes instead of OpenCV (`services/paddle/paddleCore.ts`), which avoids a ~10 MB dependency.
2. **Fields** (`services/nameplate/extractNameplate.ts`, unit-tested on recorded real plates):
   - Labels are found even when OCR mangles them: "TRF.SR.NO.", "SERIAL NO", "YEAR OF MFG", "YEAROP MFG", "PANUTACT" (MANUFACTURE), "KVA".
   - The value next to each label is read. When a value is missing or uncertain, the value box beside the label is cropped, **zoomed in and re-read**. This is how faint years like "2011" and "2007" are recovered.
   - Validation: years must fall between 1950 and the current year; KVA is checked against standard ratings (IS 1180/2026) and **cross-checked with the plate's own voltage × current** (√3·V·I; e.g. 11000 V × 16.53 A = 315 kVA). Numeric serials get look-alike letters fixed (S→5, O→0), and the field is flagged.
   - Make is matched against known manufacturers (`services/nameplate/makers.ts`; add more there), falling back to the "… LTD" line that isn't the customer's.
3. **Review:** each field shows **Read ✓**, **Check** (with the reason) or **Enter**. Tap the photo to zoom in. Typing a value or tapping **Looks right** marks it verified.
4. **Register:** saved on the device (`localStorage`, with a small photo thumbnail), so closing the tab or losing signal never loses data. Everything stays editable. On phones it's shown as cards.
5. **Excel** (`services/nameplate/registerExport.ts`, ExcelJS, lazy-loaded): `transformer-register-YYYY-MM-DD.xlsx` with:
   - a title row, a bold white-on-teal header, borders, zebra rows, a frozen header row, filters and print setup;
   - KVA and Year as real numbers, and Sr. No as text (leading zeros kept);
   - values that were never verified highlighted amber, with a "please verify" note.

On the two sample plates, the clear Nucon plate reads all four fields correctly in about 4.5 s on a laptop. The badly stained Vijai plate yields the year (flagged); its serial, KVA and make are flagged for manual entry. Nothing is ever confidently wrong.

## Table mode

```
Scan any table → Capture → Extract → Review → Download
```

1. **Capture:** a live camera preview (rear camera preferred), **HD photo** (the phone's own camera app), or upload / drag-and-drop an image.
2. **Preprocess** (in a Web Worker): crop to the text area and resize.
3. **OCR:** two Tesseract engines run in parallel Web Workers and are merged word by word (see [How OCR works](#how-ocr-works)).
4. **Structure:** a client-side parser turns the word positions into rows and columns, a header row, or key–value pairs.
5. **Review:** an editable spreadsheet-style table. Cells that may be wrong are highlighted, and a raw-text view lets you re-split the text by hand.
6. **Export:** SheetJS writes `document-data-YYYY-MM-DD.xlsx` in the browser.

## Tech stack and dependencies

| Package | Purpose |
| --- | --- |
| `react`, `react-dom` | UI |
| `tesseract.js` | OCR for table mode (WASM, runs in Web Workers) |
| `onnxruntime-web` | Runs the PaddleOCR models for nameplate mode (WASM, multi-threaded) |
| `exceljs` | Formatted Excel register (styles, frozen header, notes). SheetJS's free edition can't write styles. |
| `xlsx` (SheetJS 0.20.3, from the official SheetJS CDN tarball) | Excel generation. The npm-registry `xlsx` is stuck at 0.18.5, which has known advisories. |
| `vite`, `@vitejs/plugin-react`, `typescript` | Build tooling |
| `tailwindcss`, `@tailwindcss/vite` | Styling (Tailwind v4) |
| `@tesseract.js-data/eng` (dev) | Tesseract English language models, copied into the build |
| `@gutenye/ocr-models` (dev) | PaddleOCR PP-OCRv4 detection/recognition models (ONNX), copied into the build |
| `oxlint`, `vitest` (dev) | Linting and unit tests |
| `vite-plugin-pwa` (dev) | Web manifest + Workbox service worker (installable, offline) |

## Local setup

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
npm run lint
npm test           # unit tests, incl. regression tests on recorded real-photo OCR output
```

`predev` and `prebuild` run `scripts/copy-ocr-assets.mjs`. It copies the OCR runtimes and models from `node_modules` into `public/tesseract/` and `public/paddle/` (both git-ignored), so the app never loads OCR files from a CDN.

## Project structure

```
src/
  components/   Reusable UI (Button, CameraView, EditableTable, RawTextEditor, …)
  pages/        HomePage, ScannerPage, ProcessingPage, ResultsPage (table), NameplateReviewPage, RegisterPage
  hooks/        useCamera, useProcessing, useRegister, useTableEditor, useObjectUrl, useInstallPrompt
  services/
    nameplate/  extractNameplate (fields), makers, scanNameplate (pipeline), registerExport (Excel)
    paddle/     paddleCore (pre/post-processing), paddleClient (worker RPC)
    parser/     table mode: layoutParser, textParser, tableBuilder
    …           table mode: extractionPipeline, imagePreprocessor, ocrService, ocrEnsemble, excelExport
    */__fixtures__/  OCR output recorded from real photos (regression tests)
  workers/      paddle.worker (ONNX), tesseractWorker, preprocess.worker (OffscreenCanvas)
  utils/        imageFilters, renderForOcr, thumbnail, text, stats, date
  types/
scripts/        copy-ocr-assets.mjs
```

OCR and parsing logic live in `services/` and `workers/` and have no React dependency.

## How camera access works

- `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })` asks for the rear camera on phones and falls back to any camera on desktops. A **Flip** button appears when more than one camera is available.
- It requests up to 4K and continuous autofocus. Where the browser supports `ImageCapture` (Chrome on Android), the capture button takes a real full-resolution still photo instead of grabbing a video frame.
- **HD photo** (touch devices) opens the phone's own camera app via `<input type="file" capture="environment">`. It gives full-resolution, focused, HDR photos, which read noticeably more accurately than the live preview. On iPhone, it's the only way to get full-quality photos in a web app.
- The camera only works in a **secure context**: HTTPS, or `localhost` during development. Over plain HTTP, the app explains this and offers upload instead.
- Errors have clear messages and an upload fallback: permission denied, no camera, camera in use by another app, unsupported browser. Transient "device busy" errors when reopening the camera are retried automatically.
- Camera tracks are stopped as soon as a photo is taken or uploaded, and whenever you leave the scanner page. The camera is never left running.
- **Testing on a phone:** `npm run dev -- --host` exposes the dev server on your LAN, but phones need HTTPS for the camera. Use a deployed preview (Vercel/Netlify) or an HTTPS tunnel. Upload works over plain HTTP.

## How OCR works

Every choice below was measured against a benchmark of phone photos (receipts, invoices, printed grids, forms and a real crinkled, watermarked nutrition label) with known correct values. It went from 54% of values found (44% in the right column) to 97.4% (97.0%).

- **Preprocessing** (`utils/imageFilters.ts` + `utils/renderForOcr.ts`, run in `workers/preprocess.worker.ts` with a main-thread fallback):
  - **Auto-crop** to the area containing text strokes (pixels clearly darker than their surroundings). Background around the page badly confuses Tesseract's layout analysis; whole columns can go missing. The **Auto-crop** checkbox on the scanner turns this off.
  - **Resize** so the long edge is at most 2400 px (small images are upscaled towards 1200 px).
  - No sharpening or contrast filters. They were tested and made accuracy *worse*.
- **Recognition** (`services/ocrService.ts`, `workers/tesseractWorker.ts`): two engines run in parallel in their own Web Workers, so the UI stays responsive, with a live progress bar and a Cancel button.
  - **LSTM engine** (neural, `best_int` model), two passes. *Single block* (PSM 6) keeps table rows intact. *Sparse text* (PSM 11) recovers words the first pass misses and cross-checks numbers.
  - **Legacy engine** (character-based, PSM 6 on the full page): it keeps decimal points and "%" signs that the LSTM engine often drops on photos ("1.5g" → "15g").
- **Merging** (`services/ocrEnsemble.ts`): words are paired by position. Text comes from the LSTM engine. Numbers are rebuilt from both readings:
  - a recovered decimal point with the same digits wins;
  - look-alikes are fixed only inside numbers (`I.5g` → `1.5g`, `IZ%` → `12%`);
  - a trailing `9` misread for `g` is restored;
  - a reading that kept its unit beats one that lost it.
- **Confidence and highlights:** a value both engines (or two passes) read the same way counts as confident. Numbers the engines read with different digits are always highlighted. Values that don't fit their column (text among numbers, a leading-zero number like `00mg`, a missing decimal where the other values with that unit have one) are highlighted too. On the recorded real photos, **every wrong cell is highlighted**; that's asserted in `src/services/parser/realScans.test.ts`.
- **Structuring** (`services/parser/`):
  - The **layout parser** estimates page skew from word positions, rebuilds visual rows, and splits them into cells at wide gaps (adapting to monospaced receipt fonts) or ruling lines (`|`). It finds column boundaries from vertical whitespace shared across rows.
  - It then picks the densest block of table rows, which leaves out titles, footnotes and watermarks, chooses the header row (merging two-line headers), and repairs misread "%" signs in percentage columns (flagged, never silent).
  - The **text parser** handles tabs, pipes, commas (keeping `1,234` intact), semicolons, runs of spaces, single spaces, and `key: value` lines.
  - The most confident result is used. When nothing looks like a table, the results page opens on the **Raw text** view so you can shape the data yourself.
- **First scan:** the engines and language data (about 20 MB; only the build matching your CPU's SIMD support is downloaded) are fetched from your own site once, then cached for offline use.
- **Speed:** clean documents take about 1–3 s on a laptop. Very noisy photos (creases, watermarks) take longer, mainly the legacy engine, and phones are slower. Giving the legacy engine only the text regions was faster but measurably less accurate, so it always sees the full page.

OCR is never perfect. Review the highlighted cells before downloading. For best results, use **HD photo**, fill the frame with the document, hold steady and avoid glare.

## How Excel generation works

`services/excelExport.ts` lazy-loads SheetJS when you click **Download Excel**, so it isn't part of the initial bundle. It then:

- writes the headers and rows to an **Extracted Data** sheet, with column widths sized to their content and an auto-filter on the header row;
- converts plain numbers such as `1,450.00` into real Excel numbers, but keeps IDs with leading zeros, currency and percentages as text so nothing is lost;
- adds a **Raw Text** sheet with the OCR text for reference;
- saves the file as `document-data-YYYY-MM-DD.xlsx` (local date) using `XLSX.writeFile`, all in the browser.

## Install as a mobile app (PWA)

SnapSheet is a Progressive Web App, set up with `vite-plugin-pwa`. It can be installed to the home screen and runs full-screen like a native app, offline included.

- **Android / Chrome / Edge:** tap **Install app** on the home screen, or use the browser menu → *Install app* / *Add to Home screen*.
- **iPhone / iPad (Safari):** tap **Share** → **Add to Home Screen**. The app shows this hint on iOS.
- **Offline:**
  - The app shell (HTML, JS, CSS, icons, the Excel library) is precached by the service worker.
  - The OCR engine for a mode is cached the first time you use it. Nameplate mode is about 30 MB (ONNX Runtime ~14 MB + models ~16 MB, less over the network thanks to compression); table mode is about 20 MB. Each mode downloads only its own engine.
  - After one successful scan, capture → OCR → Excel works with no connection.
- **Updates:** after a new deploy, the updated version activates the next time the app is fully closed and reopened. This is deliberate, so an update can never reload the page and wipe a table you're editing.
- **Files:** manifest and icons are in `vite.config.ts` and `public/*.png`. The service worker (`sw.js`) is generated at build time.

Installation and service workers need HTTPS (or `localhost`), which Vercel and Netlify provide. They are disabled in `npm run dev`; use `npm run build && npm run preview` to test them locally.

## Deployment

The output is a static site in `dist/`. No environment variables are needed.

**Cross-origin isolation headers** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) let the OCR engines use several CPU threads, which makes them several times faster. They're already configured in `vercel.json` (Vercel), `public/_headers` (Netlify) and `vite.config.ts` (dev/preview). Without them, everything still works, just single-threaded.

**Vercel:** import the repo. The framework preset is **Vite**; the build command is `npm run build` and the output directory is `dist`.

**Netlify:** build command `npm run build`, publish directory `dist`. Or drag and drop `dist/` into the Netlify dashboard.

Both serve over HTTPS, which the camera requires. The app has a single URL (screens are driven by in-app state and browser history), so no SPA rewrite rules are needed.

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile). Web Workers, WebAssembly and `getUserMedia` are required. Where OffscreenCanvas is unavailable, image preprocessing falls back to the main thread.
