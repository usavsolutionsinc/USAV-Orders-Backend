/**
 * Client-side image downscaler for receiving photos.
 *
 * Receiving photos are kept for years as evidence/audit material, so we
 * downscale to ~720p before upload — the longest side is clamped to 1280 px
 * (which is the 16:9 "720p" width and also the right ceiling for 9:16 portrait
 * captures from phones). JPEG at q=0.82 typically yields 80–180 KB per shot
 * versus 3–6 MB straight from a modern phone camera.
 *
 * Runs only in the browser. Falls back to the original blob if anything
 * goes wrong so a downscale failure never blocks a receiver from uploading.
 */

export const DOWNSCALE_LONG_EDGE = 1280;
export const DOWNSCALE_JPEG_QUALITY = 0.82;

export interface DownscaleResult {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  finalBytes: number;
  /** True if we returned the original blob untouched (fallback path). */
  passthrough: boolean;
}

async function decodeToBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function targetSize(srcW: number, srcH: number, longEdge: number) {
  const longest = Math.max(srcW, srcH);
  if (longest <= longEdge) return { w: srcW, h: srcH, scaled: false };
  const ratio = longEdge / longest;
  return {
    w: Math.round(srcW * ratio),
    h: Math.round(srcH * ratio),
    scaled: true,
  };
}

export async function downscaleImageTo720(
  source: Blob,
  opts: { longEdge?: number; quality?: number } = {},
): Promise<DownscaleResult> {
  const longEdge = opts.longEdge ?? DOWNSCALE_LONG_EDGE;
  const quality = opts.quality ?? DOWNSCALE_JPEG_QUALITY;
  const originalBytes = source.size;

  try {
    const bitmap = await decodeToBitmap(source);
    const srcW = 'width' in bitmap ? bitmap.width : (bitmap as HTMLImageElement).naturalWidth;
    const srcH = 'height' in bitmap ? bitmap.height : (bitmap as HTMLImageElement).naturalHeight;
    if (!srcW || !srcH) throw new Error('decoded bitmap has zero dimensions');

    const { w, h, scaled } = targetSize(srcW, srcH, longEdge);

    // Nothing to do — image is already <= long edge AND already a reasonable
    // size on disk. Skip the encode cycle to save battery on small thumbnails.
    if (!scaled && originalBytes < 400_000 && source.type === 'image/jpeg') {
      if ('close' in bitmap) bitmap.close();
      return {
        blob: source,
        width: srcW,
        height: srcH,
        originalBytes,
        finalBytes: originalBytes,
        passthrough: true,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
    if ('close' in bitmap) bitmap.close();

    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
    );
    if (!out) throw new Error('canvas.toBlob returned null');

    return {
      blob: out,
      width: w,
      height: h,
      originalBytes,
      finalBytes: out.size,
      passthrough: false,
    };
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[downscaleImageTo720] falling back to original blob', err);
    }
    return {
      blob: source,
      width: 0,
      height: 0,
      originalBytes,
      finalBytes: originalBytes,
      passthrough: true,
    };
  }
}

export async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}
