'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, Loader2 } from '@/components/Icons';
import StationFbaInput from '@/components/fba/StationFbaInput';
import { useFbaWorkspace } from '@/contexts/FbaWorkspaceContext';
import StationGoalBar from '@/components/station/StationGoalBar';
import {
  FBA_ID_RE,
  UPS_RE,
  normalizeFbaId,
  normalizeUps,
  persistAmazonShipmentId,
  persistUpsTracking,
} from '@/components/fba/sidebar/fbaShipmentTracking';
import { findStaffIdByNormalizedName, useActiveStaffDirectory } from '@/components/sidebar/hooks';
import {
  fbaWorkspaceScanChrome,
  getStaffThemeById,
  stationThemeColors,
} from '@/utils/staff-colors';
import { SIDEBAR_INTAKE_LABEL_CLASS } from '@/design-system/components/sidebar-intake/intakeFormClasses';
import { framerTransition } from '@/design-system/foundations/motion-framer';

const fieldBaseClass =
  'mt-1 w-full rounded-xl border-2 border-gray-400 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:ring-2 disabled:opacity-50';

const TRACKING_PANEL_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
} as const;

const PRINT_SIDEBAR_READY_EVENT = 'fba-print-sidebar-ready';

export interface FbaWorkspaceScanFieldProps {
  staffName: string;
  staffId?: number | string | null;
  staffRole?: 'technician' | 'packer';
  scanEnabled?: boolean;
}

/** Sidebar: Welcome + FBA goal + scan, plus guarded plan pairing for the active print selection. */
export function FbaWorkspaceScanField({
  staffName,
  staffId = null,
  staffRole = 'technician',
  scanEnabled = true,
}: FbaWorkspaceScanFieldProps) {
  const { clearSelection, patchTracking, selection, trackingByPlan } = useFbaWorkspace();
  const staffDirectory = useActiveStaffDirectory();
  const lienStaffId = useMemo(
    () => findStaffIdByNormalizedName(staffDirectory, 'lien'),
    [staffDirectory]
  );
  const effectiveStaffId = useMemo(() => {
    if (staffId != null && staffId !== '') {
      const n = Number(staffId);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return lienStaffId;
  }, [staffId, lienStaffId]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const trackingTransition = useMemo(
    () => (reduceMotion ? { duration: 0 } : framerTransition.stationSerialRow),
    [reduceMotion]
  );

  const stationTheme = useMemo(
    () => getStaffThemeById(effectiveStaffId, staffRole),
    [effectiveStaffId, staffRole]
  );
  const themeColors = stationThemeColors[stationTheme];
  const scanChrome = fbaWorkspaceScanChrome[stationTheme];
  const fieldClass = `${fieldBaseClass} ${scanChrome.fieldFocusRing}`;
  const selectedItems = selection.selectedItems;

  const selectedPlanIds = useMemo(
    () => {
      const ids = new Set<number>();
      for (const item of selectedItems) {
        const id = Number(item.plan_id ?? item.shipment_id ?? 0);
        if (Number.isFinite(id) && id > 0) ids.add(id);
      }
      return Array.from(ids);
    },
    [selectedItems]
  );
  const activePlanId = selection.activePlanId;
  const trackingTargetPlanIds = selectedPlanIds.length > 0
    ? selectedPlanIds
    : activePlanId != null
      ? [activePlanId]
      : [];

  const readyByPlanId = useMemo(() => {
    const next: Record<number, boolean> = {};
    selectedPlanIds.forEach((planId) => {
      const tracking = trackingByPlan[planId] || { amazon: '', ups: '' };
      next[planId] =
        FBA_ID_RE.test(normalizeFbaId(tracking.amazon)) &&
        UPS_RE.test(normalizeUps(tracking.ups));
    });
    return next;
  }, [selectedPlanIds, trackingByPlan]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(PRINT_SIDEBAR_READY_EVENT, {
        detail: {
          readyByPlanId,
          readyByShipmentId: readyByPlanId,
        },
      })
    );
  }, [readyByPlanId]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent(PRINT_SIDEBAR_READY_EVENT, {
          detail: {
            readyByPlanId: {},
            readyByShipmentId: {},
          },
        })
      );
    };
  }, []);

  const activeTracking = useMemo(() => {
    if (trackingTargetPlanIds.length === 0) return { amazon: '', ups: '' };
    const base = trackingByPlan[trackingTargetPlanIds[0]] ?? { amazon: '', ups: '' };
    const amazonShared = trackingTargetPlanIds.every(
      (planId) => (trackingByPlan[planId]?.amazon ?? '') === (base.amazon ?? '')
    );
    const upsShared = trackingTargetPlanIds.every(
      (planId) => (trackingByPlan[planId]?.ups ?? '') === (base.ups ?? '')
    );
    return {
      amazon: amazonShared ? base.amazon ?? '' : '',
      ups: upsShared ? base.ups ?? '' : '',
    };
  }, [trackingByPlan, trackingTargetPlanIds]);
  const amazonOk = trackingTargetPlanIds.length > 0 && FBA_ID_RE.test(normalizeFbaId(activeTracking.amazon));
  const upsOk = trackingTargetPlanIds.length > 0 && UPS_RE.test(normalizeUps(activeTracking.ups));
  const trackingReady =
    trackingTargetPlanIds.length > 0 && trackingTargetPlanIds.every((planId) => readyByPlanId[planId]);

  const setActiveTracking = useCallback(
    (patch: Partial<{ amazon: string; ups: string }>) => {
      if (trackingTargetPlanIds.length === 0) return;
      trackingTargetPlanIds.forEach((planId) => patchTracking(planId, patch));
    },
    [patchTracking, trackingTargetPlanIds]
  );

  const onSaveTracking = useCallback(async () => {
    if (trackingTargetPlanIds.length === 0) return;
    if (!amazonOk || !upsOk) return;
    setSaving(true);
    setSaveError(null);
    try {
      const normalizedAmazon = normalizeFbaId(activeTracking.amazon);
      const normalizedUps = normalizeUps(activeTracking.ups);
      const amazonResults = await Promise.all(
        trackingTargetPlanIds.map((planId) => persistAmazonShipmentId(planId, normalizedAmazon))
      );
      const upsResults = await Promise.all(
        trackingTargetPlanIds.map((planId) => persistUpsTracking(planId, normalizedUps))
      );
      if (amazonResults.some(Boolean)) {
        trackingTargetPlanIds.forEach((planId) => patchTracking(planId, { amazon: normalizedAmazon }));
      }
      if (upsResults.some(Boolean)) {
        trackingTargetPlanIds.forEach((planId) => patchTracking(planId, { ups: normalizedUps }));
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save tracking');
    } finally {
      setSaving(false);
    }
  }, [
    activeTracking.amazon,
    activeTracking.ups,
    amazonOk,
    upsOk,
    patchTracking,
    trackingTargetPlanIds,
  ]);

  const selectedCount = selectedItems.length;
  const showTrackingCard = scanEnabled && selectedCount > 0;

  return (
    <div className="min-h-0 space-y-2">
      <div className="space-y-2 pb-1">
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-black tracking-tighter text-gray-900">Welcome, {staffName}</h2>
          </div>
        </div>
        <StationGoalBar count={0} goal={50} label="- FBA GOAL" colorClass={themeColors.text} />
      </div>

      {scanEnabled ? (
        <div className="min-w-0">
          <StationFbaInput
            fbaScanOnly
            showLabels={false}
            ignoreUrlPlan
            workspaceTheme={stationTheme}
            techStaffIdOverride={effectiveStaffId ?? undefined}
          />
        </div>
      ) : null}

      <AnimatePresence initial={false} mode="wait">
        {showTrackingCard ? (
          <motion.div
            key={`fba-tracking-${selectedPlanIds.join('-') || 'empty'}`}
            layout={false}
            variants={TRACKING_PANEL_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={trackingTransition}
            className={scanChrome.trackingCard}
          >
            {saving ? (
              <div className="flex items-center justify-end gap-2">
                <Loader2 className={`h-4 w-4 shrink-0 animate-spin ${scanChrome.savingSpinner}`} aria-hidden />
              </div>
            ) : null}

            <div className="space-y-3">
              {trackingTargetPlanIds.length > 1 ? (
                <div className={`rounded-2xl ${themeColors.border} ${themeColors.light} px-3 py-3`}>
                  <div className="flex items-start gap-2">
                    <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${themeColors.text}`} />
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-800">Apply to selected plans</p>
                      <p className="mt-1 text-[11px] leading-5 text-gray-900">
                        Changes here will apply to all {trackingTargetPlanIds.length} selected plans.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
              <label className="block">
                <span className={SIDEBAR_INTAKE_LABEL_CLASS}>Amazon FBA shipment ID</span>
                <input
                  value={activeTracking.amazon}
                  onChange={(e) => setActiveTracking({ amazon: e.target.value })}
                  disabled={saving || trackingTargetPlanIds.length === 0}
                  placeholder="FBA17XXXXXXXX"
                  className={`${fieldClass} font-mono text-xs ${
                    activeTracking.amazon && !amazonOk ? 'border-amber-400' : ''
                  } ${!activeTracking.amazon ? 'text-gray-500' : ''}`}
                />
              </label>
              <label className="block">
                <span className={SIDEBAR_INTAKE_LABEL_CLASS}>UPS shipping label / tracking</span>
                <input
                  value={activeTracking.ups}
                  onChange={(e) => setActiveTracking({ ups: e.target.value })}
                  disabled={saving || trackingTargetPlanIds.length === 0}
                  placeholder="1Z999AA10123456784"
                  className={`${fieldClass} font-mono text-xs ${activeTracking.ups && !upsOk ? 'border-amber-400' : ''} ${
                    !activeTracking.ups ? 'text-gray-500' : ''
                  }`}
                />
              </label>

              <button
                type="button"
                onClick={() => void onSaveTracking()}
                disabled={saving || !trackingReady}
                className={`w-full rounded-xl border-2 px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.12em] transition-colors ${
                  trackingReady && !saving
                    ? `${themeColors.border} ${themeColors.light} text-gray-900 hover:opacity-95`
                    : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                }`}
              >
                {trackingReady ? 'Save tracking' : 'Enter valid FBA ID and UPS to save'}
              </button>
            </div>

            {saveError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-semibold text-red-700">
                {saveError}
              </p>
            )}

            {/* Selection summary + clear */}
            <div className={`${scanChrome.trackingSectionBorder} flex items-center justify-between gap-2 pt-3`}>
              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
              </span>
              <button
                type="button"
                onClick={() => clearSelection()}
                className="rounded-full border border-gray-200 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
              >
                Clear
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
