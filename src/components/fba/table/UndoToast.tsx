'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

export function UndoToast({
  open,
  label,
  onUndo,
}: {
  open: boolean;
  label: string;
  onUndo: () => void;
}) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={reduced ? undefined : { opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: 12 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-5 right-5 z-[80] max-w-sm rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-lg shadow-gray-300/35"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold leading-5 text-gray-800">{label}</p>
            <button
              type="button"
              onClick={onUndo}
              className="shrink-0 rounded-full border border-gray-200 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-700 transition-colors hover:border-violet-200 hover:text-violet-900"
            >
              Undo
            </button>
          </div>
          {!reduced ? (
            <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-gray-100">
              <motion.div
                key={label}
                className="h-full bg-violet-500"
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: 4, ease: 'linear' }}
              />
            </div>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
