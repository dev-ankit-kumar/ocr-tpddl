# SnapSheet: documents to Excel

A frontend-only React app. You photograph a document, receipt or printed table, the app reads it in your browser with **Tesseract.js**, lays the text out as an editable table, and downloads it as an **.xlsx** file.

> Your document is processed on your device and is not uploaded to any server. There is no backend, no database, no analytics, and no third-party requests at runtime.

## How it works

```
Scan → Capture → Extract → Review → Download
```

1. **Capture:** a live camera preview (rear camera preferred), or upload / drag-and-drop an image.
2. **Preprocess** (in a Web Worker): crop to the text area, resize, grayscale, even out lighting, stretch contrast, sharpen.
3. **OCR** (in Tesseract's own Web Worker): two recognition passes, merged by word position.
4. **Structure:** a client-side parser turns the word positions into rows and columns, a header row, or key–value pairs.
5. **Review:** an editable spreadsheet-style table. Low-confidence cells are highlighted, and a raw-text view lets you re-split the text by hand.
6. **Export:** SheetJS writes `document-data-YYYY-MM-DD.xlsx` in the browser.

## Tech stack and dependencies

| Package | Purpose |
| --- | --- |
| `react`, `react-dom` | UI |
| `tesseract.js` | OCR (WASM, runs in a Web Worker) |
| `xlsx` (SheetJS 0.20.3, from the official SheetJS CDN tarball) | Excel generation. The npm-registry `xlsx` is stuck at 0.18.5, which has known advisories. |
| `vite`, `@vitejs/plugin-react`, `typescript` | Build tooling |
| `tailwindcss`, `@tailwindcss/vite` | Styling (Tailwind v4) |
| `@tesseract.js-data/eng` (dev) | English language model, copied into the build |
| `oxlint`, `vitest` (dev) | Linting and unit tests |

## Local setup

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
npm run lint
npm test           # parser unit tests
```

`predev` and `prebuild` run `scripts/copy-tesseract-assets.mjs`. It copies the Tesseract worker, the WASM cores and `eng.traineddata.gz` from `node_modules` into `public/tesseract/` (git-ignored), so the app never loads OCR files from a CDN.

## Project structure

```
src/
  components/   Reusable UI (Button, CameraView, EditableTable, RawTextEditor, …)
  pages/        HomePage, ScannerPage, ProcessingPage, ResultsPage
  hooks/        useCamera, useExtraction, useTableEditor, useObjectUrl
  services/     extractionPipeline, imagePreprocessor, ocrService, excelExport
    parser/     layoutParser (word geometry), textParser (separators), tableBuilder
  workers/      preprocess.worker (OffscreenCanvas), tesseractWorker (engine lifecycle)
  utils/        imageFilters, renderForOcr, text, stats, date
  types/
scripts/        copy-tesseract-assets.mjs
```

OCR and parsing logic live in `services/` and `workers/` and have no React dependency.

## How camera access works

- `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })` asks for the rear camera on phones and falls back to any camera on desktops. A **Flip** button appears when more than one camera is available.
- The camera only works in a **secure context**: HTTPS, or `localhost` during development. Over plain HTTP, the app explains this and offers upload instead.
- Errors have clear messages and an upload fallback: permission denied, no camera, camera in use by another app, unsupported browser. Transient "device busy" errors when reopening the camera are retried automatically.
- Camera tracks are stopped as soon as a photo is taken or uploaded, and whenever you leave the scanner page. The camera is never left running.
- **Testing on a phone:** `npm run dev -- --host` exposes the dev server on your LAN, but phones need HTTPS for the camera. Use a deployed preview (Vercel/Netlify) or an HTTPS tunnel. Upload works over plain HTTP.

## How OCR works

- **Preprocessing** (`utils/imageFilters.ts`, run in `workers/preprocess.worker.ts` with a main-thread fallback):
  - **Auto-crop** to the region containing text strokes. Background around the page badly confuses Tesseract's layout analysis.
  - **Resize** so the long edge is 1200–2400 px.
  - **Grayscale.**
  - **Illumination normalization:** divide by the estimated paper brightness, which removes shadows and lighting gradients.
  - **Contrast stretch and sharpen.**
  - The **Auto-enhance** checkbox on the scanner turns all of this off (the image is still resized).
- **Recognition** (`services/ocrService.ts`): the engine runs in Tesseract.js's Web Worker, so the UI stays responsive, with a live progress bar and a Cancel button. Each image gets two passes:
  - *Single column* (PSM 4): keeps table rows intact.
  - *Sparse text* (PSM 11): recovers words the first pass occasionally drops on photos.
  - The passes are merged by bounding box.
- **Structuring** (`services/parser/`):
  - The **layout parser** estimates page skew from word positions, rebuilds visual rows, splits rows into cells at wide gaps or ruling lines (`|`), and finds column boundaries from vertical whitespace shared across rows.
  - The **text parser** handles tabs, pipes, commas (keeping `1,234` intact), semicolons, runs of spaces, single spaces, and `key: value` lines.
  - The most confident result is used. When nothing looks like a table, the results page opens on the **Raw text** view so you can shape the data yourself.
  - Words below 60% OCR confidence are highlighted in amber in the table.
- The engine and language data (~7 MB total, only the build matching your CPU's SIMD support is downloaded) are fetched from your own site on the first scan, then cached in IndexedDB.

OCR is never perfect. Always review the table before downloading.

## How Excel generation works

`services/excelExport.ts` lazy-loads SheetJS when you click **Download Excel**, so it isn't part of the initial bundle. It then:

- writes the headers and rows to an **Extracted Data** sheet, with column widths sized to their content and an auto-filter on the header row;
- converts plain numbers such as `1,450.00` into real Excel numbers, but keeps IDs with leading zeros, currency and percentages as text so nothing is lost;
- adds a **Raw Text** sheet with the OCR text for reference;
- saves the file as `document-data-YYYY-MM-DD.xlsx` (local date) using `XLSX.writeFile`, all in the browser.

## Deployment

The output is a static site in `dist/`. No server-side configuration or environment variables are needed.

**Vercel:** import the repo. The framework preset is **Vite**; the build command is `npm run build` and the output directory is `dist`.

**Netlify:** build command `npm run build`, publish directory `dist`. Or drag and drop `dist/` into the Netlify dashboard.

Both serve over HTTPS, which the camera requires. The app has a single URL (screens are driven by in-app state and browser history), so no SPA rewrite rules are needed.

## Browser support

Current Chrome, Edge, Firefox and Safari (desktop and mobile). Web Workers, WebAssembly and `getUserMedia` are required. Where OffscreenCanvas is unavailable, image preprocessing falls back to the main thread.
