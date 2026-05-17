'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from '@/components/Icons';
import type { MobileContextOption } from '@/lib/mobile-context-navigation';
import { cn } from '@/utils/_cn';

export interface MobileNavPickerSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  options: MobileContextOption[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Bottom sheet for switching in-page sections (settings tabs, dashboard views, etc.).
 */
export function MobileNavPickerSheet({
  open,
  onClose,
  title,
  options,
  activeId,
  onSelect,
}: MobileNavPickerSheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            key="picker-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            aria-label="Close section picker"
            onClick={onClose}
          />
          <motion.div
            key="picker-panel"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320, mass: 0.85 }}
            className="fixed inset-x-0 bottom-0 z-[61] max-h-[min(70dvh,520px)] overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl"
          >
            <motion.div
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={0.12}
              onDragEnd={(_, info) => {
                if (info.offset.y > 72 || info.velocity.y > 420) onClose();
              }}
              className="flex max-h-[min(70dvh,520px)] flex-col"
            >
              <motion.div
                className="flex shrink-0 cursor-grab items-center justify-center py-2 active:cursor-grabbing"
                aria-hidden
              >
                <span className="h-1 w-10 rounded-full bg-gray-300" />
              </motion.div>

              <motion.div
                className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 pb-3"
              >
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
                  {title}
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-700 active:bg-gray-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </motion.div>

              <motion.ul
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]"
              >
                {options.map((option) => {
                  const isActive = option.id === activeId;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(option.id);
                          onClose();
                        }}
                        className={cn(
                          'flex w-full min-h-[52px] items-center gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors active:bg-gray-50',
                          isActive && 'bg-blue-50',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block text-sm font-semibold',
                              isActive ? 'text-blue-700' : 'text-gray-900',
                            )}
                          >
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="block truncate text-[11px] font-medium text-gray-500">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                        {isActive ? (
                          <Check className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </motion.ul>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
