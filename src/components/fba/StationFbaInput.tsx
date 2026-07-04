'use client';

import { motion } from 'framer-motion';
import { AlertCircle, Loader2, Package } from '@/components/Icons';
import { StationScanBar } from '@/components/station/StationScanBar';
import { FBA_SCAN_FOCUS_RING, FBA_SCAN_BAND_HALO } from './fba-scan-theme';
import { useFbaStationInput, type StationFbaInputProps } from './station-input/useFbaStationInput';
import { FbaPendingPlanQueue } from './station-input/FbaPendingPlanQueue';
import { FbaPlanPreviewList } from './station-input/FbaPlanPreviewList';

// Scan-bar theme maps live in fba-scan-theme.ts; re-exported here so existing
// importers of FBA_SCAN_BAND_HALO (FbaWorkspaceSidebar) keep their path.
export { FBA_SCAN_BAND_HALO };
export type { StationFbaInputProps };

/**
 * FBA station scan bar — thin composition shell. All scan-flow logic lives in
 * {@link useFbaStationInput}; the review queue + plan preview are presentational
 * components under `./station-input/`.
 */
export default function StationFbaInput(props: StationFbaInputProps) {
  const {
    showLabels = true,
    className = '',
    fbaScanOnly = false,
    scanMode,
    sidebarHeaderBand = false,
  } = props;

  const c = useFbaStationInput(props);

  return (
    <div className={`${c.stackBelowScan ? 'space-y-2' : ''} ${className}`.trim()}>
      {showLabels ? (
        <>
          {fbaScanOnly ? (
            <p className="text-micro font-black uppercase tracking-widest text-text-muted">
              Adding To Today Current Plan
            </p>
          ) : (
            <p className="text-micro font-semibold uppercase tracking-widest text-text-soft">Station scan</p>
          )}
          <p className="text-caption leading-snug text-text-soft">{fbaScanOnly ? c.fbaOnlyHint : c.routingHint}</p>
        </>
      ) : null}

      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 120 }}
        // Soft staff-tint halo band — matches the receiving/testing sidebars so
        // the FBA scan bar presents as the same station component. In the sidebar
        // header band the parent row owns the halo + 40px height.
        className={
          fbaScanOnly && !sidebarHeaderBand
            ? `rounded-xl px-1.5 py-1 ${FBA_SCAN_BAND_HALO[c.stationTheme]}`
            : undefined
        }
      >
        <StationScanBar
          value={c.inputValue}
          onChange={c.handleInputChange}
          onSubmit={c.handleFormSubmit}
          inputRef={c.inputRef}
          inputBorderClassName={c.scanOutlineClass}
          placeholder={fbaScanOnly ? 'FNSKU (X00…) or ASIN (B0…)' : 'FNSKU, ASIN, tracking, RS-, serial'}
          autoFocus={false}
          hasRightContent={fbaScanOnly || c.busy}
          onPaste={fbaScanOnly ? c.handleInputChange : undefined}
          icon={
            <Package
              className={`${fbaScanOnly ? 'h-[17px] w-[17px]' : 'h-4 w-4'} ${fbaScanOnly ? c.workspaceChrome.fnskuScanIconClass : 'text-violet-600'}`}
            />
          }
          iconClassName=""
          // fbaScanOnly mirrors the receiving/testing scan bar: inherit the
          // shared h-10 input chrome + pl-8 left inset; only the themed focus ring differs.
          inputClassName={
            fbaScanOnly
              ? FBA_SCAN_FOCUS_RING[c.stationTheme]
              : '!py-2.5 !text-sm focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20'
          }
          rightContentClassName={fbaScanOnly ? 'right-1.5 gap-0.5' : 'right-2'}
          showModeButtons={fbaScanOnly}
          visibleModes={scanMode ? [scanMode] : ['plan', 'select']}
          activeMode={c.fbaMode}
          onPlanMode={() => {
            c.setFbaMode('plan');
            c.setSelectResult(null);
          }}
          onSelectMode={() => {
            c.setFbaMode('select');
            c.setPlanHint(null);
            c.setFbaError(null);
            c.setPlanPreviewLines([]);
            c.clearPendingTodayPlan();
          }}
          rightContent={
            c.busy ? (
              <Loader2
                className={`h-4 w-4 shrink-0 animate-spin ${fbaScanOnly ? c.workspaceChrome.savingSpinner : 'text-text-muted'}`}
              />
            ) : null
          }
        />
      </motion.div>

      {fbaScanOnly && (c.isFbaLoading || c.planHint || c.selectedCount > 0) ? (
        <div className="flex items-center gap-1.5">
          {c.isFbaLoading ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-text-faint" />
          ) : null}
          <p
            className={`text-micro font-bold uppercase tracking-widest ${
              c.planHint
                ? 'text-emerald-600'
                : c.selectedCount > 0
                  ? 'text-blue-600'
                  : 'text-text-soft'
            }`}
          >
            {c.isFbaLoading
              ? 'Updating plan…'
              : c.planHint
                ? c.planHint
                : `${c.selectedCount} selected · ${c.selectedQty} unit${c.selectedQty !== 1 ? 's' : ''}`}
          </p>
        </div>
      ) : null}

      {fbaScanOnly && c.fbaMode === 'plan' && c.pendingTodayPlanRows && c.pendingTodayPlanRows.length > 0 ? (
        <FbaPendingPlanQueue
          rows={c.pendingTodayPlanRows}
          stationTheme={c.stationTheme}
          todayPlanQtyByFnsku={c.todayPlanQtyByFnsku}
          isLoading={c.isFbaLoading}
          touchesExistingLine={c.pendingTodayTouchesExistingLine}
          onPatchQty={c.patchPendingTodayQty}
          onCancel={c.clearPendingTodayPlan}
          onSubmit={(rows) => void c.handleBulkFnskuPlanFlow(rows)}
          onSetError={c.setFbaError}
        />
      ) : null}

      {!fbaScanOnly && c.planPreviewLines.length > 0 ? (
        <FbaPlanPreviewList
          lines={c.planPreviewLines}
          stationTheme={c.stationTheme}
          onPatchQty={(line, nextQty) => void c.patchPlanLineQty(line, nextQty)}
        />
      ) : null}

      {c.scanError ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-semibold text-red-800"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 leading-snug">{c.scanError}</span>
        </div>
      ) : null}

      {/* FbaPairedReviewPanel removed — the parent FbaSidebar renders it via boardSelection */}
    </div>
  );
}
