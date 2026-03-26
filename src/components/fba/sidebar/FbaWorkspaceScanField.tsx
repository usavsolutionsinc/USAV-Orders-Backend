'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, Check, Loader2 } from '@/components/Icons';
import StationFbaInput from '@/components/fba/StationFbaInput';
import { useFbaWorkspace } from '@/contexts/FbaWorkspaceContext';
import StationGoalBar from '@/components/station/StationGoalBar';
import { getPlanId, getPlanLabel } from '@/components/fba/table/utils';
import { resolveFbaItemDisplayQty } from '@/lib/fba/qty';
import { SelectionFloatingBar } from '@/components/fba/table/SelectionFloatingBar';
import type { EnrichedItem } from '@/components/fba/table/types';
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
  fbaSidebarThemeChrome,
  fbaWorkspaceScanChrome,
  getStaffThemeById,
  stationThemeColors,
} from '@/utils/staff-colors';
import { SIDEBAR_INTAKE_LABEL_CLASS } from '@/design-system/components/sidebar-intake/intakeFormClasses';
import { motionBezier, framerTransition } from '@/design-system/foundations/motion-framer';

const fieldBaseClass =
  'mt-1 w-full rounded-xl border-2 border-gray-400 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:ring-2 disabled:opacity-50';

const TRACKING_PANEL_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
} as const;

const PRINT_SIDEBAR_READY_EVENT = 'fba-print-sidebar-ready';

export interface FbaWorkspaceScanFieldProps {
  staffName: string;
  /**
   * Staff id from URL / explicit pick. When omitted, resolves Lien from active staff (`/api/staff?active=true`)
   * and uses that id for theme + FNSKU scan attribution.
   */
  staffId?: number | string | null;
  /** Matches selected row in staff directory so packers get packer theme colors. */
  staffRole?: 'technician' | 'packer';
  /** When false, only Welcome + FBA goal (matches shipped sidebar strip). */
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
  const sidebarChrome = fbaSidebarThemeChrome[stationTheme];
  const fieldClass = `${fieldBaseClass} ${scanChrome.fieldFocusRing}`;
  const selectedItems = selection.selectedItems;

  const selectedPlanIds = useMemo(
    () => Array.from(new Set(selectedItems.map((item) => getPlanId(item)).filter((id) => id > 0))),
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

  const onBlurAmazon = useCallback(async () => {
    if (trackingTargetPlanIds.length === 0) return;
    if (!FBA_ID_RE.test(normalizeFbaId(activeTracking.amazon))) return;
    setSaving(true);
    setSaveError(null);
    try {
      const normalizedAmazon = normalizeFbaId(activeTracking.amazon);
      const results = await Promise.all(
        trackingTargetPlanIds.map((planId) => persistAmazonShipmentId(planId, normalizedAmazon))
      );
      if (results.some(Boolean)) {
        trackingTargetPlanIds.forEach((planId) => patchTracking(planId, { amazon: normalizedAmazon }));
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save Amazon shipment ID');
    } finally {
      setSaving(false);
    }
  }, [activeTracking.amazon, patchTracking, trackingTargetPlanIds]);

  const onBlurUps = useCallback(async () => {
    if (trackingTargetPlanIds.length === 0) return;
    if (!UPS_RE.test(normalizeUps(activeTracking.ups))) return;
    setSaving(true);
    setSaveError(null);
    try {
      const normalizedUps = normalizeUps(activeTracking.ups);
      const results = await Promise.all(
        trackingTargetPlanIds.map((planId) => persistUpsTracking(planId, normalizedUps))
      );
      if (results.some(Boolean)) {
        trackingTargetPlanIds.forEach((planId) => patchTracking(planId, { ups: normalizedUps }));
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save UPS tracking');
    } finally {
      setSaving(false);
    }
  }, [activeTracking.ups, patchTracking, trackingTargetPlanIds]);


  /** Map board-selected items to EnrichedItem[] for the SelectionFloatingBar. */
  const selectedAsEnriched = useMemo((): EnrichedItem[] => {
    const sorted = [...selectedItems].sort((a, b) => {
      const pa = getPlanId(a);
      const pb = getPlanId(b);
      if (pa !== pb) return pa - pb;
      return (a.fnsku ?? '').localeCompare(b.fnsku ?? '');
    });
    return sorted.map((item) => ({
      item_id: item.item_id ?? 0,
      fnsku: item.fnsku ?? '',
      expected_qty: item.expected_qty ?? 0,
      actual_qty: item.actual_qty ?? 0,
      item_status: item.item_status ?? '',
      display_title: item.display_title || item.fnsku || '—',
      asin: item.asin ?? null,
      sku: item.sku ?? null,
      plan_id: getPlanId(item),
      plan_ref: getPlanLabel(item),
      shipment_id: getPlanId(item),
      shipment_ref: getPlanLabel(item),
      amazon_shipment_id: item.amazon_shipment_id ?? null,
      due_date: item.due_date ?? null,
      destination_fc: item.destination_fc ?? null,
      status: 'ready_to_print' as const,
      pending_reason: null,
      expanded: false,
    }));
  }, [selectedItems]);

  const selectedTotalQty = useMemo(
    () => selectedItems.reduce((sum, item) => sum + resolveFbaItemDisplayQty(item), 0),
    [selectedItems],
  );

  const showTrackingCard = scanEnabled && selectedItems.length > 0;

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
            {saving || trackingReady ? (
              <div className="flex items-center justify-end gap-2">
                {saving ? (
                  <Loader2 className={`h-4 w-4 shrink-0 animate-spin ${scanChrome.savingSpinner}`} aria-hidden />
                ) : (
                  <span className="inline-flex shrink-0 text-emerald-600" title="FBA + UPS valid" aria-label="Ready">
                    <Check className="h-4 w-4" />
                  </span>
                )}
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
                  onBlur={() => void onBlurAmazon()}
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
                  onBlur={() => void onBlurUps()}
                  disabled={saving || trackingTargetPlanIds.length === 0}
                  placeholder="1Z999AA10123456784"
                  className={`${fieldClass} font-mono text-xs ${activeTracking.ups && !upsOk ? 'border-amber-400' : ''} ${
                    !activeTracking.ups ? 'text-gray-500' : ''
                  }`}
                />
              </label>
            </div>

            {saveError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-semibold text-red-700">
                {saveError}
              </p>
            )}

            <div className={`${scanChrome.trackingSectionBorder} pt-3`}>
              <SelectionFloatingBar
                selectedItems={selectedAsEnriched}
                onClear={() => clearSelection()}
                attachmentQty={selectedTotalQty}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
