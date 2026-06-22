import type { BarcodeMode } from '@/components/barcode/ModeSelector';

/** Per-mode accent tokens for the horizontal workspace (tone + CTA + focus ring). */
export interface ModeAccent {
  tone: 'blue' | 'emerald' | 'orange' | 'violet';
  ctaBg: string;
  ctaHover: string;
  focusRing: string;
}

export const MODE_ACCENT_THEME: Record<BarcodeMode, ModeAccent> = {
  print: {
    tone: 'blue',
    ctaBg: 'bg-blue-600',
    ctaHover: 'hover:bg-blue-700',
    focusRing: 'focus:ring-blue-500/30 focus:border-blue-500',
  },
  'sn-to-sku': {
    tone: 'emerald',
    ctaBg: 'bg-emerald-600',
    ctaHover: 'hover:bg-emerald-700',
    focusRing: 'focus:ring-emerald-500/30 focus:border-emerald-500',
  },
  reprint: {
    tone: 'violet',
    ctaBg: 'bg-violet-700',
    ctaHover: 'hover:bg-violet-800',
    focusRing: 'focus:ring-violet-500/30 focus:border-violet-500',
  },
};
