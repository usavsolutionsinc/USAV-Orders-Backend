import { AnimatePresence, motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { AlertTriangle, Check, Database, ShieldCheck, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { sectionLabel, fieldLabel, microBadge } from '@/design-system/tokens/typography/presets';
import { PANEL_STATUS_BANNER_SPRING, PANEL_STATUS_ICON_SPRING, type ImportStatus } from './dashboard-management-shared';

/** Animated success/error banner with a stats + exceptions + tracking breakdown. */
export function SyncStatusBanner({ status, onDismiss }: { status: ImportStatus | null; onDismiss: () => void }) {
  const expansionDelayedTransition = useMotionTransition({ ...framerTransition.cardExpansion, delay: 0.15 });

  return (
    <AnimatePresence mode="wait">
      {status ? (
        <motion.div
          key={status.type + status.message}
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={PANEL_STATUS_BANNER_SPRING}
          className={`rounded-2xl border overflow-hidden ${status.type === 'success' ? 'bg-emerald-50/80 border-emerald-200/60' : 'bg-red-50/80 border-red-200/60'}`}
        >
          <div className={`flex items-center gap-2.5 px-4 py-3 ${status.type === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>
            <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={PANEL_STATUS_ICON_SPRING}>
              {status.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            </motion.div>
            <div className="min-w-0 flex-1">
              <p className={sectionLabel}>{status.type === 'success' ? 'Sync Complete' : 'Sync Failed'}</p>
              <p className="text-eyebrow font-medium leading-relaxed opacity-80">{status.message}</p>
            </div>
            <IconButton
              type="button"
              onClick={onDismiss}
              ariaLabel="Dismiss"
              className="shrink-0 p-1 rounded-lg hover:bg-scrim/5"
              icon={<X className={`w-3 h-3 opacity-50 ${status.type === 'success' ? 'text-emerald-700' : 'text-red-700'}`} />}
            />
          </div>

          {status.type === 'success' && status.details ? (
            <motion.div
              initial={framerPresence.collapseHeight.initial}
              animate={framerPresence.collapseHeight.animate}
              transition={expansionDelayedTransition}
              className="border-t border-emerald-200/40"
            >
              <div className="px-4 py-3 space-y-2.5">
                {status.details.tabName ? (
                  <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100/80 text-emerald-700">
                      <Database className="w-2.5 h-2.5" />
                      <span className={`${microBadge} text-emerald-700`}>{status.details.tabName}</span>
                    </span>
                    {status.details.durationMs ? (
                      <span className={`${microBadge} text-emerald-500`}>{(status.details.durationMs / 1000).toFixed(1)}s</span>
                    ) : null}
                  </motion.div>
                ) : null}

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Processed', value: status.details.processedRows ?? 0 },
                    { label: 'Inserted', value: status.details.inserted ?? 0 },
                    { label: 'Updated', value: status.details.updated ?? 0 },
                  ].map((stat, i) => (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25 + i * 0.05 }}
                      className="text-center rounded-xl bg-surface-card/60 border border-emerald-100/60 py-1.5"
                    >
                      <p className="text-sm font-black text-emerald-700 tabular-nums">{stat.value}</p>
                      <p className={`${microBadge} text-emerald-500`}>{stat.label}</p>
                    </motion.div>
                  ))}
                </div>

                {(status.details.exceptionsResolved ?? 0) > 0 ? (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50/80 border border-blue-100/60">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <p className={`${fieldLabel} text-blue-700`}>
                      <span className="font-black">{status.details.exceptionsResolved}</span> exception{status.details.exceptionsResolved === 1 ? '' : 's'} auto-resolved
                    </p>
                  </motion.div>
                ) : null}

                {(status.details.unresolvedTracking ?? 0) > 0 ? (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50/80 border border-amber-200/60">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <p className={`${fieldLabel} text-amber-700`}>
                      <span className="font-black">{status.details.unresolvedTracking}</span> tracking number{status.details.unresolvedTracking === 1 ? '' : 's'} not recognized — check the sheet for malformed or doubled values
                    </p>
                  </motion.div>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
