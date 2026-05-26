/**
 * Client-side PDF → PNG thumbnail generator.
 *
 * Uses pdfjs-dist to render page 1 of the supplied PDF (or any source the
 * library can fetch) to an offscreen canvas, then exports it as a PNG Blob.
 *
 * Why client-side:
 *   - Vercel serverless runtime has no native PDF renderer (no ghostscript,
 *     no poppler), and bundling pdfjs + a canvas polyfill on the server
 *     adds ~10MB and a cold-start hit.
 *   - The operator's browser already has the PDF bytes in memory at upload
 *     time, so generating the thumb client-side is free network-wise.
 *
 * pdfjs ships its rendering loop on a Web Worker. We point at the worker
 * file bundled in node_modules via dynamic import — Next.js produces the
 * right URL at build time. If that fails (some bundler configs), the
 * generator returns null and the caller falls back to no thumbnail.
 *
 * Returns null on any failure (encrypted PDF, render error, unsupported
 * source). Callers must treat the result as best-effort.
 */

const THUMB_WIDTH = 320;       // target render width in CSS px
const JPEG_QUALITY = 0.85;     // PNG would be larger; JPEG is fine for a preview

export interface PdfThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
}

let pdfjsModulePromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = (async () => {
      const mod = await import('pdfjs-dist');
      // Point the worker at the bundled file. `new URL(..., import.meta.url)`
      // is the web-standard pattern Webpack/Turbopack rewrite at build time
      // to a hashed asset URL — works in both Next.js dev and production
      // without needing a custom loader.
      mod.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
      ).toString();
      return mod;
    })();
  }
  return pdfjsModulePromise;
}

/**
 * Render page 1 of `source` to a JPEG Blob. `source` accepts:
 *   - a File (the operator's upload pick)
 *   - a public URL (lazy-backfill path — we re-fetch the Blob URL)
 */
export async function generatePdfThumbnail(
  source: File | string,
): Promise<PdfThumbnailResult | null> {
  try {
    const pdfjs = await loadPdfjs();
    const data =
      typeof source === 'string'
        ? await fetch(source).then((r) => {
            if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
            return r.arrayBuffer();
          })
        : await source.arrayBuffer();

    const doc = await pdfjs.getDocument({ data }).promise;
    try {
      const page = await doc.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = THUMB_WIDTH / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      // White background — most PDFs render with transparency on missing
      // backgrounds, which looks broken next to other thumbs.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // pdfjs typings drift between minor versions; this `as any` smooths
      // the difference between the v4 `canvas` param and v5+'s shape.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      page.cleanup();

      const blob: Blob | null = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY);
      });
      if (!blob) return null;
      return { blob, width: canvas.width, height: canvas.height };
    } finally {
      doc.destroy().catch(() => {});
    }
  } catch (err) {
    // Encrypted PDFs, malformed inputs, unsupported sources — all land here.
    // Caller treats null as "no thumbnail; show the file-icon glyph".
    console.warn('[pdfThumbnail] generation failed:', err);
    return null;
  }
}
