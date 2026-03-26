'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, Check, Loader2 } from '@/components/Icons';
import StationFbaInput from '@/components/fba/StationFbaInput';
import { useFbaWorkspace } from '@/contexts/FbaWorkspaceContext';
import StationGoalBar from '@/components/station/StationGoalBar';
import type { EnrichedItem } from '@/components/fba/table/types';
import { getPlanId, getPlanLabel } from '@/components/fba/table/utils';
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

const sectionLabelClass = 'block text-[9px] font-bold uppercase tracking-widest text-gray-600';
const fieldBaseClass =
  'mt-1 w-full rounded-xl border-2 border-gray-400 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:ring-2 disabled:opacity-50';

const LAYOUT_EASE = [0.22, 1, 0.36, 1] as const;

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
  const reduceMotion = useReducedMotion();

  const trackingTransition = useMemo(
    () => (reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [...LAYOUT_EASE] }),
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
    () => Array.from(new Set(selectedItems.map((item) => getPlanId(item)).filter((id) => id > 0))),
    [selectedItems]
  );
  const activePlanId = selection.activePlanId;
  const pairingLocked = selectedPlanIds.length > 1;

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

  const activeTracking =
    activePlanId != null ? trackingByPlan[activePlanId] ?? { amazon: '', ups: '' } : { amazon: '', ups: '' };
  const amazonOk = activePlanId != null && FBA_ID_RE.test(normalizeFbaId(activeTracking.amazon));
  const upsOk = activePlanId != null && UPS_RE.test(normalizeUps(activeTracking.ups));
  const trackingReady = amazonOk && upsOk;

  const setActiveTracking = useCallback(
    (patch: Partial<{ amazon: string; ups: string }>) => {
      if (activePlanId == null) return;
      patchTracking(activePlanId, patch);
    },
    [activePlanId, patchTracking]
  );

  const onBlurAmazon = useCallback(async () => {
    if (activePlanId == null || pairingLocked) return;
    if (!FBA_ID_RE.test(normalizeFbaId(activeTracking.amazon))) return;
    setSaving(true);
    try {
      const normalizedAmazon = normalizeFbaId(activeTracking.amazon);
      const ok = await persistAmazonShipmentId(activePlanId, normalizedAmazon);
      if (ok) patchTracking(activePlanId, { amazon: normalizedAmazon });
    } finally {
      setSaving(false);
    }
  }, [activePlanId, activeTracking.amazon, pairingLocked, patchTracking]);

  const onBlurUps = useCallback(async () => {
    if (activePlanId == null || pairingLocked) return;
    if (!UPS_RE.test(normalizeUps(activeTracking.ups))) return;
    setSaving(true);
    try {
      const normalizedUps = normalizeUps(activeTracking.ups);
      const ok = await persistUpsTracking(activePlanId, normalizedUps);
      if (ok) patchTracking(activePlanId, { ups: normalizedUps });
    } finally {
      setSaving(false);
    }
  }, [activePlanId, activeTracking.ups, pairingLocked, patchTracking]);

  const selectedItemRows = useMemo(() => {
    return [...selectedItems].sort((a, b) => {
      const planA = getPlanId(a);
      const planB = getPlanId(b);
      if (activePlanId != null) {
        if (planA === activePlanId && planB !== activePlanId) return -1;
        if (planB === activePlanId && planA !== activePlanId) return 1;
      }
      const labelA = getPlanLabel(a);
      const labelB = getPlanLabel(b);
      if (labelA !== labelB) return labelA.localeCompare(labelB);
      return String(a.display_title || a.fnsku).localeCompare(String(b.display_title || b.fnsku));
    });
  }, [activePlanId, selectedItems]);

  const showTrackingCard = scanEnabled && selectedItems.length > 0;

  return (
    <div className="space-y-2">
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

            {pairingLocked ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-800">Select 1 plan to pair</p>
                    <p className="mt-1 text-[11px] leading-5 text-amber-900">
                      {selectedPlanIds.length} plans are selected. Amazon FBA shipment ID and UPS tracking stay disabled until the selection narrows to a single internal plan row.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className={sectionLabelClass}>Amazon FBA shipment ID</span>
                  <input
                    value={activeTracking.amazon}
                    onChange={(e) => setActiveTracking({ amazon: e.target.value })}
                    onBlur={() => void onBlurAmazon()}
                    disabled={saving || activePlanId == null}
                    placeholder="FBA17XXXXXXXX"
                    className={`${fieldClass} font-mono text-xs ${
                      activeTracking.amazon && !amazonOk ? 'border-amber-400' : ''
                    } ${!activeTracking.amazon ? 'text-gray-500' : ''}`}
                  />
                </label>
                <label className="block">
                  <span className={sectionLabelClass}>UPS shipping label / tracking</span>
                  <input
                    value={activeTracking.ups}
                    onChange={(e) => setActiveTracking({ ups: e.target.value })}
                    onBlur={() => void onBlurUps()}
                    disabled={saving || activePlanId == null}
                    placeholder="1Z999AA10123456784"
                    className={`${fieldClass} font-mono text-xs ${activeTracking.ups && !upsOk ? 'border-amber-400' : ''} ${
                      !activeTracking.ups ? 'text-gray-500' : ''
                    }`}
                  />
                </label>
              </div>
            )}

            <div className={`${scanChrome.trackingSectionBorder} pt-3`}>
              <div className="flex items-center justify-between gap-2">
                <p className={scanChrome.selectedItemsLabel}>Selected items</p>
                <button
                  type="button"
                  onClick={() => clearSelection()}
                  className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50"
                >
                  Clear
                </button>
              </div>
              <motion.ul layout className="mt-2.5 space-y-2">
                <AnimatePresence initial={false}>
                  {selectedItemRows.map((item) => {
                    const itemPlanId = getPlanId(item);
                    const itemQty = (() => {
                      const actual = Number(item.actual_qty || 0);
                      const remaining = Math.max(0, Number(item.expected_qty || 0) - actual);
                      return actual > 0 ? actual : remaining;
                    })();
                    return (
                      <motion.li
                        key={item.item_id}
                        layout
                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                        transition={trackingTransition}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent('fba-print-focus-plan', {
                                detail: { planId: itemPlanId, shipmentId: itemPlanId },
                              })
                            );
                          }}
                          className="w-full border-b border-gray-200/80 pb-2 text-left last:border-b-0 last:pb-0"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[12px] font-black uppercase leading-snug tracking-[0.12em] text-gray-900">
                                {item.display_title || item.fnsku}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
                                <span className={scanChrome.fnskuSubtext}>{item.fnsku}</span>
                                {selectedPlanIds.length > 1 ? (
                                  <span className="font-semibold uppercase tracking-[0.12em] text-gray-500">
                                    {getPlanLabel(item)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <span className="shrink-0 text-[10px] font-black tabular-nums text-gray-700">Qty {itemQty}</span>
                          </div>
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </motion.ul>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

