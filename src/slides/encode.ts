// Turns a drawn canvas into a compact slide image.

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** WebP where the browser can make it, JPEG otherwise. Throws if neither works. */
export async function encodeSlideImage(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, 'image/webp', 0.85)
  if (webp && webp.type === 'image/webp' && webp.size > 0) return webp
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.88)
  if (!jpeg || jpeg.type !== 'image/jpeg' || jpeg.size === 0) {
    throw new Error('The browser could not encode the page image')
  }
  return jpeg
}
