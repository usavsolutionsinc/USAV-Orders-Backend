/**
 * On-device frame gating for live label scanning. Pure, framework-free, and cheap
 * enough to run on every camera tick (intended for a small ~160x120 downscale, not
 * the full frame).
 *
 * The live scan loop (useLiveLabelScan) uses this as the first tier of a two-tier
 * funnel: the browser decides "is this frame worth sending?" so the LAN vision box
 * (5070 Ti) only ever runs OCR on steady, sharp, well-lit shots. This typically cuts
 * frames-sent by 10-20x vs naive streaming and raises the OCR hit rate.
 *
 * Metrics:
 *  - sharpness: variance of the Laplacian over grayscale. Low = blurry / motion blur.
 *  - motion:    mean absolute grayscale diff vs the previous frame. High = camera moving.
 *  - luma:      mean grayscale brightness (0..255). Low = too dark to read.
 */

/** Minimal shape of a canvas ImageData — also satisfied by plain test fixtures. */
export interface ImageDataLike {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

export interface FrameMetrics {
  /** Variance of the Laplacian. Higher = sharper. Scene-dependent; tune on real labels. */
  sharpness: number;
  /** Mean abs grayscale diff vs previous frame, 0..255. Higher = more motion. NaN if no prev. */
  motion: number;
  /** Mean grayscale brightness, 0..255. */
  luma: number;
}

export type GateReason = 'ok' | 'moving' | 'blurry' | 'dark' | 'too-bright';

export interface GateResult {
  ok: boolean;
  reason: GateReason;
  metrics: FrameMetrics;
}

export interface GateThresholds {
  /** Below this Laplacian-variance ⇒ blurry. */
  sharpnessMin: number;
  /** Above this mean-diff ⇒ camera moving (skip to avoid motion blur). */
  motionMax: number;
  /** Below this mean luma ⇒ too dark to read. */
  lumaMin: number;
  /** Above this mean luma ⇒ blown out / glare. */
  lumaMax: number;
}

/**
 * Defaults tuned for a downscaled (~160px) grayscale frame of a printed white label.
 * Re-tune against real captures on the LAN; the scan hook surfaces these as one block.
 */
export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  sharpnessMin: 60,
  motionMax: 6,
  lumaMin: 35,
  lumaMax: 245,
};

/** Convert RGBA pixel data to a grayscale Float32Array (Rec. 601 luma). */
export function toGray(img: ImageDataLike): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    // 0.299 R + 0.587 G + 0.114 B
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

/** Mean brightness (0..255) of a grayscale buffer. */
export function meanLuma(gray: Float32Array): number {
  if (gray.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  return sum / gray.length;
}

/**
 * Variance of the 4-neighbour Laplacian over interior pixels. A standard, cheap blur
 * detector: a focused frame has strong edges (high Laplacian variance); a blurred one
 * is smooth (low variance). Returns 0 for frames too small to have an interior.
 */
export function sharpnessScore(gray: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Mean absolute grayscale difference between two same-sized frames, 0..255. Returns
 * NaN when there is no previous frame or the dimensions differ (caller treats as
 * "can't assess stability yet" → skip, forcing at least two frames before sending).
 */
export function motionScore(prev: Float32Array | null, curr: Float32Array): number {
  if (!prev || prev.length !== curr.length || curr.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < curr.length; i++) sum += Math.abs(curr[i] - prev[i]);
  return sum / curr.length;
}

/**
 * Score a frame and decide whether it should be sent to the vision box. `prev` is the
 * previous frame's grayscale buffer (pass null on the first tick). Check order matters:
 * brightness first (nothing else is meaningful in the dark), then stability, then focus.
 */
export function gateFrame(
  curr: ImageDataLike,
  prevGray: Float32Array | null,
  thresholds: GateThresholds = DEFAULT_GATE_THRESHOLDS,
): GateResult & { gray: Float32Array } {
  const gray = toGray(curr);
  const luma = meanLuma(gray);
  const motion = motionScore(prevGray, gray);
  const sharpness = sharpnessScore(gray, curr.width, curr.height);
  const metrics: FrameMetrics = { sharpness, motion, luma };

  let reason: GateReason = 'ok';
  if (luma < thresholds.lumaMin) reason = 'dark';
  else if (luma > thresholds.lumaMax) reason = 'too-bright';
  else if (Number.isNaN(motion) || motion > thresholds.motionMax) reason = 'moving';
  else if (sharpness < thresholds.sharpnessMin) reason = 'blurry';

  return { ok: reason === 'ok', reason, metrics, gray };
}

/** Human coaching copy for each gate reason — drives the live viewfinder hint. */
export const GATE_HINTS: Record<GateReason, string> = {
  ok: 'Hold steady…',
  moving: 'Hold steady',
  blurry: 'Move closer / focus',
  dark: 'Needs more light',
  'too-bright': 'Reduce glare',
};
