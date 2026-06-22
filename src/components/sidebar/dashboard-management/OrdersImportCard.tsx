import { AnimatePresence, motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
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
        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-caption font-mono text-gray-900 outline-none focus:border-blue-500 transition-all"
        disabled={isTransferring}
      />

      {isTransferring ? (
        <button
          onClick={handleCancelTransfer}
          className={`w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl ${sectionLabel} shadow-lg shadow-red-500/10 transition-all active:scale-95 flex items-center justify-center gap-2`}
        >
          <X className="w-3.5 h-3.5" />
          Cancel Import
        </button>
      ) : (
        <button
          onClick={handleTransfer}
          className={`w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl ${sectionLabel} shadow-lg shadow-blue-600/10 transition-all active:scale-95 flex items-center justify-center gap-2`}
        >
          <Database className="w-3.5 h-3.5" />
          Import Latest Orders
        </button>
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
            <button
              type="button"
              onClick={() => setIsSyncDialogOpen(true)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-left transition hover:bg-blue-100/60"
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
