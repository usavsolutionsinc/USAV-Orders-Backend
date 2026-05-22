/**
 * Unified compression entry point for every photo upload path.
 *
 * Every capture site (camera, file picker, mobile receiving, packer spam,
 * station webcam) routes through here before it POSTs to a `/api/*-photos`
 * endpoint. That gives us one place to tune the 720p ceiling, JPEG quality,
 * and rollout telemetry — the underlying scaler lives in `./downscale.ts`.
 */

import {
  downscaleImageTo720,
  blobToBase64DataUrl,
  DOWNSCALE_LONG_EDGE,
  DOWNSCALE_JPEG_QUALITY,
  type DownscaleResult,
} from './downscale';

export interface CompressForUploadResult {
  blob: Blob;
  /** `data:image/jpeg;base64,…` — what most `/api/*-photos` POST bodies want. */
  base64: string;
  width: number;
  height: number;
  bytesIn: number;
  bytesOut: number;
  passthrough: boolean;
}

interface Options {
  longEdge?: number;
  quality?: number;
  /** Tag for the telemetry line so we can tell capture sites apart in logs. */
  source?: string;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL');
  const mime = match[1] || 'application/octet-stream';
  const payload = match[2] || '';
  const isBase64 = /;base64/.test(dataUrl);
  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

function logTelemetry(source: string | undefined, result: DownscaleResult) {
  if (typeof console === 'undefined') return;
  const tag = source ? `photo:${source}` : 'photo';
  const ratio =
    result.originalBytes > 0
      ? Math.round((result.finalBytes / result.originalBytes) * 100)
      : 100;
  console.info(
    `[${tag}] ${result.originalBytes} → ${result.finalBytes} bytes (${ratio}%) ${result.width}×${result.height}${result.passthrough ? ' [passthrough]' : ''}`,
  );
}

/**
 * Accepts a Blob or a base64 data URL. Always returns both forms so the
 * caller can pick whichever the backing API wants — receiving/inventory/sku
 * endpoints take base64, queued uploaders want a Blob.
 */
export async function compressPhotoForUpload(
  input: Blob | string,
  opts: Options = {},
): Promise<CompressForUploadResult> {
  const source = typeof input === 'string' ? dataUrlToBlob(input) : input;
  const scaled = await downscaleImageTo720(source, {
    longEdge: opts.longEdge ?? DOWNSCALE_LONG_EDGE,
    quality: opts.quality ?? DOWNSCALE_JPEG_QUALITY,
  });
  logTelemetry(opts.source, scaled);
  const base64 = await blobToBase64DataUrl(scaled.blob);
  return {
    blob: scaled.blob,
    base64,
    width: scaled.width,
    height: scaled.height,
    bytesIn: scaled.originalBytes,
    bytesOut: scaled.finalBytes,
    passthrough: scaled.passthrough,
  };
}
