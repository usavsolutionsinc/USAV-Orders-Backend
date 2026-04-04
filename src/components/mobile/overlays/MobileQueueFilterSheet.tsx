'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from '@/components/Icons';
import { MobileSearchOverlay, type MobileSearchOverlayProps } from './MobileSearchOverlay';

export interface MobileQueueFilterSheetProps extends MobileSearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

/**
 * Bottom sheet that hosts `MobileSearchOverlay` — queue text search + quick-filter pills.
 * Portals to `document.body` so it stacks above nested mobile shells. Use for filtering the
 * current on-screen list (e.g. Up Next), not station tracking entry (`StationScanBar` / scan sheet).
 */
export function MobileQueueFilterSheet({
  isOpen,
  onClose,
  title = 'Filter queue',
  ...overlayProps
}: MobileQueueFilterSheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="queue-filter-sheet"
          className="fixed inset-0 z-[100] flex flex-col justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="queue-filter-sheet-title"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 380 }}
            className="relative max-h-[min(85vh,640px)] w-full overflow-hidden rounded-t-[1.25rem] bg-white shadow-[0_-8px_32px_rgba(0,0,0,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <h2 id="queue-filter-sheet-title" className="text-[13px] font-black uppercase tracking-[0.18em] text-gray-900">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95"
                aria-label="Done"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <MobileSearchOverlay {...overlayProps} />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
