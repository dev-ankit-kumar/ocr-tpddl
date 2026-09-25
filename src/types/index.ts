export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A rectangle in image pixels. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export type CameraErrorKind = 'permission-denied' | 'not-found' | 'in-use' | 'unsupported' | 'insecure' | 'unknown'

export interface CameraError {
  kind: CameraErrorKind
  message: string
}

export interface Progress {
  /** 0–1 */
  value: number
  label: string
}
