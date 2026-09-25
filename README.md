# SnapSheet: transformer nameplate to Excel

A frontend-only React app that reads four fields from a photo of a transformer nameplate and exports them to Excel:

| Field Name   | Value (reference photo) |
| ------------ | ----------------------- |
| KVA          | 315                     |
| Year of MFG  | 2011                    |
| Manufacturer | NUCON                   |
| Sr. No.      | 95230                   |

> The photo is processed on your device and is not uploaded anywhere. There is no backend, no database, no API key, no paid Vision API, and nothing is stored.

## Workflow

1. **Upload Image** or **Open Camera**. On phones, Upload also offers the phone's own camera, which gives the sharpest photos.
2. **Preview.** Optionally **Crop** to the plate (and rotate) for better accuracy.
3. **Extract Details.**
4. The four fields are shown. A field that can't be read confidently shows **Not detected**, never a guess. Try another photo in that case.
5. **Download Excel:** `transformer-data.xlsx` with exactly two columns (**Field Name**, **Value**) and one row per field. KVA and year are numbers, and the serial stays text so leading zeros are kept.

## How the extraction works

- **OCR:** [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv4 models run in the browser via ONNX Runtime Web, in a Web Worker (`src/workers/paddle.worker.ts`).
  - On dirty, faded and glary nameplate photos this is far more accurate than Tesseract.js. Tesseract missed the reference plate's year and read almost nothing on a stained plate.
  - The photo is contrast-normalized first (local mean and spread) so faint stamped text stands out.
  - Pre- and post-processing are in `src/services/paddle/paddleCore.ts`.
- **Fields** (`src/services/nameplate/extractNameplate.ts`):
  - **Labels are found despite OCR slips.**
    - KVA: KVA, kVA, K.V.A.
    - Year of MFG: YEAR OF MFG., YEAR OF MANUFACTURE, YEAR OF MANUFACTURING, and misreads such as "YEAROP MFG".
    - Sr. No.: TRF. SR. NO., SR. NO., SERIAL NO., SERIAL NUMBER.
  - **Value beside the label:** the value is read from the same row, to the right of its label. When it's missing or uncertain, the box next to the label is cropped, zoomed in and read again. This recovers faint stamped digits.
  - **Validation:**
    - Years must be between 1950 and the current year.
    - KVA must be a standard rating, and is cross-checked against the plate's own rated voltage × current (√3·V·I, e.g. 11000 V × 16.53 A = 315 kVA).
    - A serial with unclear characters is not reported.
  - **Manufacturer:** matched against known makes (`src/services/nameplate/makers.ts`; add yours there), otherwise taken from a clearly read "… LTD" line. Customer or owner lines such as "NORTH DELHI POWER LIMITED" are ignored.
  - **Confident means:** valid, confidence at least 75, and the readings don't disagree. Anything else is "Not detected".
- **Excel:** `src/services/nameplate/excelExport.ts`, SheetJS, loaded on demand.

## Local setup

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
npm run lint
npm test           # extraction rules, incl. OCR output recorded from real nameplates
```

`predev`/`prebuild` run `scripts/copy-ocr-assets.mjs`, which copies the OCR models and runtime from `node_modules` into `public/paddle/` (git-ignored). No CDN is used at runtime.

## Project structure

```
src/
  App.tsx                   the whole workflow (one screen)
  components/               Button, CameraCapture, CameraView, ImageCropper, FilePickerButton, …
  hooks/                    useCamera, useObjectUrl
  services/nameplate/       extractNameplate (field rules), makers, scanNameplate, excelExport
    __fixtures__/           OCR output of real nameplate photos (tests)
  services/paddle/          paddleCore (model pre/post-processing), paddleClient (worker RPC)
  workers/paddle.worker.ts  OCR in a Web Worker
```

## Camera

- `getUserMedia` with the rear camera preferred (`facingMode: environment`), up to 4K with continuous autofocus. It takes a full-resolution still photo where supported.
- It needs HTTPS (or `localhost`).
- Permission-denied, no-camera and camera-in-use errors are explained, with upload as a fallback.
- The camera is stopped as soon as a photo is taken or the camera view is closed.

## Deployment (Vercel / Netlify)

Static site: the build command is `npm run build` and the output directory is `dist`.

- **Cross-origin isolation headers** (COOP/COEP) let the OCR use several CPU threads, which makes it several times faster. They're configured in `vercel.json`, `public/_headers` (Netlify) and `vite.config.ts` (dev/preview).
- **First use downloads the OCR engine** (~30 MB, compressed in transit). It's then cached by the service worker, so later use works offline.
- The app is installable as a PWA: on iPhone, Share → Add to Home Screen.
