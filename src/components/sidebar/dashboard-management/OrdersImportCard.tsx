import { AnimatePresence, motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { Button } from '@/design-system/primitives';
import { Check, Database, Loader2, X } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import type { OrdersImportController } from './useOrdersImport';

/** Manual sheet name + Import/Cancel button + the compact running-status row. */
export function OrdersImportCard({ imp, canImportOrders }: { imp: OrdersImportController; canImportOrders: boolean }) {
  const expansionTransition = useMotionTransition(framerTransition.cardExpansion);
  if (!canImportOrders) return null;

  const { manualSheetName, setManualSheetName, isTransferring, handleCancelTransfer, handleTransfer, setIsSyncDialogOpen, sheetsTask, ecwidTask, elapsedMs } = imp;

  return (
    <>
      <input
        type="text"
        value={manualSheetName}
        onChange={(e) => setManualSheetName(e.target.value)}
        placeholder="e.g., Sheet_01_14_2026"
        className="w-full px-3 py-2 bg-surface-card border border-border-soft rounded-xl text-caption font-mono text-text-default outline-none focus:border-blue-500 transition-all"
        disabled={isTransferring}
      />

      {isTransferring ? (
        <Button
          variant="danger"
          size="lg"
          icon={<X />}
          onClick={handleCancelTransfer}
          className="w-full text-micro font-black uppercase tracking-[0.2em]"
        >
          Cancel Import
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          icon={<Database />}
          onClick={handleTransfer}
          className="w-full text-micro font-black uppercase tracking-[0.2em]"
        >
          Import Latest Orders
        </Button>
      )}

      {/* Compact status row — full details live in the centered OrderSyncDialog */}
      <AnimatePresence>
        {isTransferring || sheetsTask.status !== 'idle' || ecwidTask.status !== 'idle' ? (
          <motion.div
            initial={framerPresence.collapseHeight.initial}
            animate={framerPresence.collapseHeight.animate}
            exit={framerPresence.collapseHeight.exit}
            transition={expansionTransition}
            className="overflow-hidden"
          >
            {/* ds-raw-button: structured full-width status row (icon + label + live timer span), not the Button primitive shape */}
            <button
              type="button"
              onClick={() => setIsSyncDialogOpen(true)}
              className="ds-raw-button flex w-full items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-left transition hover:bg-blue-100/60"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isTransferring ? <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" /> : <Check className="w-3.5 h-3.5 text-blue-600" />}
                <span className={`${sectionLabel} text-blue-700`}>{isTransferring ? 'Importing orders…' : 'Import complete'}</span>
                <span className="text-eyebrow text-blue-400">View details</span>
              </div>
              <motion.span
                key={Math.floor(elapsedMs / 1000)}
                initial={{ opacity: 0.5, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-caption font-mono font-bold text-blue-500 tabular-nums"
              >
                {(elapsedMs / 1000).toFixed(1)}s
              </motion.span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
