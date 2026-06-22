import type { GateReason } from '@/lib/vision/frame-quality';

export type ScanMode = 'live' | 'manual';
export const SCAN_MODE_KEY = 'usav.identify.scanMode';

/** Reticle border colour by gate state — green when a frame is good enough to send. */
export const RETICLE_TINT: Record<GateReason, string> = {
  ok: 'border-emerald-400',
  moving: 'border-amber-300/80',
  blurry: 'border-amber-300/80',
  dark: 'border-white/40',
  'too-bright': 'border-amber-300/80',
};

export interface AddedItem {
  id: string;
  title: string;
  lineId?: number;
}
