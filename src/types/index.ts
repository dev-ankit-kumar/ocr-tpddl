export type Stage = 'home' | 'scan' | 'processing' | 'results' | 'review' | 'register'

/** nameplate: transformer nameplates → register of Make, Sr. No, KVA, Year. table: any document → table. */
export type ScanMode = 'nameplate' | 'table'

export interface Cell {
  value: string
  /** True when OCR confidence for this cell was low and it should be double-checked. */
  uncertain?: boolean
}

export interface TableData {
  headers: string[]
  rows: Cell[][]
}

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  confidence: number
  bbox: BBox
}

export interface OcrLine {
  words: OcrWord[]
  bbox: BBox
}

export interface OcrResult {
  text: string
  /** Overall page confidence reported by Tesseract, 0–100. */
  confidence: number
  lines: OcrLine[]
}

export type ParseMethod = 'layout' | 'delimiter' | 'key-value' | 'lines'

/** How raw text should be split into columns when (re)structuring it manually. */
export type SplitMode = 'auto' | 'tab' | 'pipe' | 'comma' | 'semicolon' | 'multi-space' | 'space' | 'key-value' | 'lines'

export interface ParseResult {
  table: TableData
  method: ParseMethod
  /** 0–1: how confident the parser is that it found real rows/columns. */
  confidence: number
  /** True when the parser believes it found a genuine table / key-value structure. */
  structured: boolean
  description: string
}

export type ProcessingStep = 'preprocess' | 'load-engine' | 'recognize' | 'parse'

export interface ProcessingProgress {
  step: ProcessingStep
  /** Overall progress, 0–1. */
  progress: number
  label: string
}

export interface ExtractionResult {
  ocr: OcrResult
  parse: ParseResult
}

export type CameraErrorKind = 'permission-denied' | 'not-found' | 'in-use' | 'unsupported' | 'insecure' | 'unknown'

export interface CameraError {
  kind: CameraErrorKind
  message: string
}
