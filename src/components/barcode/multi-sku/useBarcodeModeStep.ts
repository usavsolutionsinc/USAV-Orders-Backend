'use client';

import { useEffect, useRef, useState } from 'react';
import { useBarcodeMode } from '@/hooks/useBarcodeMode';
import type { BarcodeMode } from '@/components/barcode/ModeSelector';

export interface UseBarcodeModeStep {
  mode: BarcodeMode;
  step: 1 | 2 | 3;
  setStep: React.Dispatch<React.SetStateAction<1 | 2 | 3>>;
  /** Switch mode (URL-driven when horizontal, local otherwise) + reset to step 1. */
  handleModeChange: (next: BarcodeMode) => void;
  /** Anchor the vertical wizard scrolls into view as steps reveal. */
  bottomAnchorRef: React.RefObject<HTMLDivElement>;
}

/**
 * Owns the print/log/reprint mode and the 1→2→3 wizard step. Horizontal layout
 * reads/writes mode via the URL (`useBarcodeMode`); vertical keeps it local and
 * reveals steps one at a time, auto-scrolling the parent container.
 *
 * @param isHorizontal Whether the desktop (URL-mode, side-by-side) layout is active.
 */
export function useBarcodeModeStep(isHorizontal: boolean): UseBarcodeModeStep {
  const urlMode = useBarcodeMode();
  const [localMode, setLocalMode] = useState<BarcodeMode>('print');
  const mode = isHorizontal ? urlMode.mode : localMode;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  // Scroll the parent container to reveal the newly added step (vertical only;
  // horizontal shows everything side-by-side). scrollIntoView walks up to the
  // nearest scroll ancestor, which is the narrow-column sidebar host.
  useEffect(() => {
    if (isHorizontal) return;
    if (step >= 2) {
      setTimeout(() => {
        bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 50);
    }
  }, [step, isHorizontal]);

  const handleModeChange = (newMode: BarcodeMode) => {
    if (isHorizontal) urlMode.setMode(newMode);
    else setLocalMode(newMode);
    setStep(1);
  };

  // When the URL-driven mode changes externally (e.g. a sidebar mode pill),
  // reset progression so each mode starts clean.
  useEffect(() => {
    if (!isHorizontal) return;
    setStep(1);
  }, [urlMode.mode, isHorizontal]);

  return { mode, step, setStep, handleModeChange, bottomAnchorRef };
}
