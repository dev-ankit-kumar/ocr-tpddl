/** Small JPEG data URL of an image (for the register's photo column). */
export async function makeThumbnail(image: Blob, maxSide = 160, quality = 0.6): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return undefined // A missing thumbnail never blocks saving.
  }
}
