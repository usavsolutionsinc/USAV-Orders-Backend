'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ScanSurface } from '@/components/mobile/ScanSurface';
import { SkuIdentity } from '@/components/inventory/SkuIdentity';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { conditionBadgeTone, conditionGradeTableLabel } from '@/components/station/receiving-constants';
import type { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import type { PickTask } from './picker-shared';

/** The current-pick card — bin chip, SKU identity, progressive details, gated scanner. */
export function PickerTaskCard({
  currentTask,
  scanner,
  onDecode,
  scanError,
  detailsExpanded,
  onToggleDetails,
}: {
  currentTask: PickTask;
  scanner: ReturnType<typeof useBarcodeScanner>;
  onDecode: (value: string) => void;
  scanError: string | null;
  detailsExpanded: boolean;
  onToggleDetails: () => void;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.section
        key={currentTask.allocationId}
        initial={framerPresenceMobile.mobileCard.initial}
        animate={framerPresenceMobile.mobileCard.animate}
        exit={framerPresenceMobile.mobileCard.exit}
        transition={framerTransitionMobile.mobileCardMount}
        className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        {/* Bin chip — the thing the worker looks for. */}
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pick from bin</p>
        <p className="mt-1 font-mono text-3xl font-extrabold tabular-nums tracking-tight text-blue-700">
          {currentTask.bin ?? '—'}
        </p>

        {/* Product identity — canonical SKU primary, platform mappings beneath */}
        <div className="mt-4">
          <SkuIdentity
            canonicalSku={currentTask.sku}
            productTitle={currentTask.productTitle}
            platforms={currentTask.platforms}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold tabular-nums text-slate-800">
              Qty {currentTask.plannedQty}
            </span>
            {currentTask.conditionGrade && (
              <span
                className={`inline-flex items-center rounded-xl px-3 py-1 text-xs font-semibold uppercase tracking-wide ${conditionBadgeTone(
                  currentTask.conditionGrade,
                )}`}
              >
                {conditionGradeTableLabel(currentTask.conditionGrade)}
              </span>
            )}
          </div>
        </div>

        {/* Progressive disclosure */}
        <button
          type="button"
          onClick={onToggleDetails}
          className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-500 active:text-slate-700"
        >
          <span>{detailsExpanded ? 'Hide details' : 'Show details'}</span>
          <span aria-hidden="true">{detailsExpanded ? '▴' : '▾'}</span>
        </button>
        <AnimatePresence initial={false}>
          {detailsExpanded && (
            <motion.dl
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="mt-2 grid grid-cols-2 gap-2 overflow-hidden text-xs"
            >
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="font-semibold uppercase tracking-wider text-slate-500">Serial unit</dt>
                <dd className="mt-0.5 font-mono font-bold text-slate-900">#{currentTask.serialUnitId}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="font-semibold uppercase tracking-wider text-slate-500">Allocation</dt>
                <dd className="mt-0.5 font-mono font-bold text-slate-900">#{currentTask.allocationId}</dd>
              </div>
            </motion.dl>
          )}
        </AnimatePresence>

        {/* Scanner — gated. Hint above tells the picker exactly what to
            aim at; the in-place error appears if a wrong code decodes. */}
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold text-slate-500">
            Scan{' '}
            {currentTask.bin && (
              <span className="font-mono font-bold text-slate-700">{currentTask.bin}</span>
            )}
            {currentTask.bin && currentTask.serialNumber && ' or '}
            {currentTask.serialNumber && (
              <span className="font-mono font-bold text-slate-700">
                serial {currentTask.serialNumber}
              </span>
            )}
            {!currentTask.bin && !currentTask.serialNumber && (
              <span className="font-mono font-bold text-slate-700">{currentTask.sku}</span>
            )}
          </p>
          <ScanSurface
            scanner={scanner}
            onDecode={onDecode}
            manualPlaceholder="Type serial, bin, or SKU…"
          />
          {scanError && (
            <div
              role="alert"
              className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
            >
              {scanError}
            </div>
          )}
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
