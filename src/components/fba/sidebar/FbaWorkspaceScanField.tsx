'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Check, Loader2 } from '@/components/Icons';
import StationFbaInput from '@/components/fba/StationFbaInput';
import StationGoalBar from '@/components/station/StationGoalBar';
import type { EnrichedItem } from '@/components/fba/table/types';
import {
  FBA_ID_RE,
  FBA_TRACKING_PATCH_EVENT,
  UPS_RE,
  normalizeFbaId,
  normalizeUps,
  persistAmazonShipmentId,
  persistUpsTracking,
} from '@/components/fba/sidebar/fbaShipmentTracking';
import {
  fbaWorkspaceScanChrome,
  getStaffThemeById,
  stationThemeColors,
} from '@/utils/staff-colors';

const sectionLabelClass = 'block text-[9px] font-bold uppercase tracking-widest text-gray-600';
const fieldBaseClass =
  'mt-1 w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-transparent focus:ring-2 disabled:opacity-50';

const LAYOUT_EASE = [0.22, 1, 0.36, 1] as const;

const PRINT_SIDEBAR_READY_EVENT = 'fba-print-sidebar-ready';

export interface FbaWorkspaceScanFieldProps {
  staffName: string;
  /** Staff selector id — drives goal bar + tracking/FNSKU chrome ({@link stationThemeColors}). */
  staffId?: number | string | null;
  /** When false, only Welcome + FBA goal (matches shipped sidebar strip). */
  scanEnabled?: boolean;
}

/** Sidebar: Welcome + FBA goal (same type scale as {@link StationTesting}) + scan; floating FBA/UPS for primary selected row. */
export function FbaWorkspaceScanField({ staffName, staffId = null, scanEnabled = true }: FbaWorkspaceScanFieldProps) {
  const [selectedItems, setSelectedItems] = useState<EnrichedItem[]>([]);
  const [trackingByShipment, setTrackingByShipment] = useState<
    Record<number, { amazon: string; ups: string }>
  >({});
  const [saving, setSaving] = useState(false);

  const stationTheme = useMemo(() => getStaffThemeById(staffId, 'technician'), [staffId]);
  const themeColors = stationThemeColors[stationTheme];
  const scanChrome = fbaWorkspaceScanChrome[stationTheme];
  const fieldClass = `${fieldBaseClass} ${scanChrome.fieldFocusRing}`;

  useEffect(() => {
    const h = (ev: Event) => {
      const e = ev as CustomEvent<{ selectedItems?: EnrichedItem[] }>;
      const list = Array.isArray(e.detail?.selectedItems) ? (e.detail!.selectedItems as EnrichedItem[]) : [];
      setSelectedItems(list);
    };
    window.addEventListener('fba-print-selection', h);
    return () => window.removeEventListener('fba-print-selection', h);
  }, []);

  useEffect(() => {
    setTrackingByShipment((prev) => {
      if (selectedItems.length === 0) return {};
      const allowed = new Set(selectedItems.map((i) => i.shipment_id));
      const next: Record<number, { amazon: string; ups: string }> = {};
      for (const sid of Array.from(allowed)) {
        next[sid] = prev[sid] ? { ...prev[sid] } : { amazon: '', ups: '' };
      }
      for (const it of selectedItems) {
        const sid = it.shipment_id;
        if (!next[sid]) next[sid] = { amazon: '', ups: '' };
        if (it.amazon_shipment_id && !next[sid].amazon) {
          next[sid] = { ...next[sid], amazon: String(it.amazon_shipment_id) };
        }
      }
      return next;
    });
  }, [selectedItems]);

  const primary = selectedItems[0] ?? null;
  const shipmentId = primary?.shipment_id ?? null;
  const primaryTracking =
    shipmentId != null ? (trackingByShipment[shipmentId] ?? { amazon: '', ups: '' }) : { amazon: '', ups: '' };

  const extraShipments = useMemo(() => {
    const ids = new Set(selectedItems.map((i) => i.shipment_id));
    return Math.max(0, ids.size - 1);
  }, [selectedItems]);

  useEffect(() => {
    const allowed = new Set(selectedItems.map((i) => i.shipment_id));
    const onPatch = (ev: Event) => {
      const e = ev as CustomEvent<{ shipmentId?: number; amazon?: string; ups?: string }>;
      const d = e.detail;
      if (!d?.shipmentId || !allowed.has(d.shipmentId)) return;
      setTrackingByShipment((prev) => {
        const cur = prev[d.shipmentId!] || { amazon: '', ups: '' };
        return {
          ...prev,
          [d.shipmentId!]: {
            amazon: d.amazon !== undefined ? d.amazon : cur.amazon,
            ups: d.ups !== undefined ? d.ups : cur.ups,
          },
        };
      });
    };
    window.addEventListener(FBA_TRACKING_PATCH_EVENT, onPatch);
    return () => window.removeEventListener(FBA_TRACKING_PATCH_EVENT, onPatch);
  }, [selectedItems]);

  const readyByShipmentId = useMemo(() => {
    const m: Record<number, boolean> = {};
    const ids = new Set(selectedItems.map((i) => i.shipment_id));
    for (const sid of Array.from(ids)) {
      const t = trackingByShipment[sid] || { amazon: '', ups: '' };
      m[sid] = FBA_ID_RE.test(normalizeFbaId(t.amazon)) && UPS_RE.test(normalizeUps(t.ups));
    }
    return m;
  }, [selectedItems, trackingByShipment]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(PRINT_SIDEBAR_READY_EVENT, { detail: { readyByShipmentId } })
    );
  }, [readyByShipmentId]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent(PRINT_SIDEBAR_READY_EVENT, { detail: { readyByShipmentId: {} } })
      );
    };
  }, []);

  const amazonOk = FBA_ID_RE.test(normalizeFbaId(primaryTracking.amazon));
  const upsOk = UPS_RE.test(normalizeUps(primaryTracking.ups));
  const trackingReady = amazonOk && upsOk;

  const setPrimaryTracking = useCallback((patch: Partial<{ amazon: string; ups: string }>) => {
    if (shipmentId == null) return;
    setTrackingByShipment((prev) => {
      const cur = prev[shipmentId] || { amazon: '', ups: '' };
      return { ...prev, [shipmentId]: { ...cur, ...patch } };
    });
  }, [shipmentId]);

  const onBlurAmazon = useCallback(async () => {
    if (shipmentId == null) return;
    if (!FBA_ID_RE.test(normalizeFbaId(primaryTracking.amazon))) return;
    setSaving(true);
    try {
      await persistAmazonShipmentId(shipmentId, primaryTracking.amazon);
    } finally {
      setSaving(false);
    }
  }, [shipmentId, primaryTracking.amazon]);

  const onBlurUps = useCallback(async () => {
    if (shipmentId == null) return;
    if (!UPS_RE.test(normalizeUps(primaryTracking.ups))) return;
    setSaving(true);
    try {
      await persistUpsTracking(shipmentId, primaryTracking.ups);
    } finally {
      setSaving(false);
    }
  }, [shipmentId, primaryTracking.ups]);

  const showTrackingCard = scanEnabled && primary != null && shipmentId != null;

  return (
    <LayoutGroup id="fba-workspace-scan">
      <motion.div layout className="space-y-2">
        <motion.div
          layout
          transition={{ layout: { duration: 0.32, ease: LAYOUT_EASE } }}
          className="space-y-2 pb-1"
        >
          <div className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-black tracking-tighter text-gray-900">Welcome, {staffName}</h2>
            </div>
          </div>
          <StationGoalBar count={0} goal={50} label="- FBA GOAL" colorClass={themeColors.text} />
        </motion.div>

        {scanEnabled ? (
          <motion.div layout transition={{ layout: { duration: 0.32, ease: LAYOUT_EASE } }} className="min-w-0">
            <StationFbaInput fbaScanOnly showLabels={false} />
          </motion.div>
        ) : null}

        <AnimatePresence initial={false}>
          {showTrackingCard ? (
            <motion.div
              key={shipmentId}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.24, ease: LAYOUT_EASE }}
              className={scanChrome.trackingCard}
            >
              {saving || trackingReady ? (
                <div className="flex items-center justify-end gap-2">
                  {saving ? (
                    <Loader2
                      className={`h-4 w-4 shrink-0 animate-spin ${scanChrome.savingSpinner}`}
                      aria-hidden
                    />
                  ) : (
                    <span className="inline-flex shrink-0 text-emerald-600" title="FBA + UPS valid" aria-label="Ready">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </div>
              ) : null}

              <div className="space-y-3">
                <label className="block">
                  <span className={sectionLabelClass}>Amazon FBA shipment ID</span>
                  <input
                    value={primaryTracking.amazon}
                    onChange={(e) => setPrimaryTracking({ amazon: e.target.value })}
                    onBlur={() => void onBlurAmazon()}
                    disabled={saving}
                    placeholder="FBA17XXXXXXXX"
                    className={`${fieldClass} font-mono text-xs ${
                      primaryTracking.amazon && !amazonOk ? 'border-amber-400' : ''
                    } ${!primaryTracking.amazon ? 'text-gray-500' : ''}`}
                  />
                </label>
                <label className="block">
                  <span className={sectionLabelClass}>UPS shipping label / tracking</span>
                  <input
                    value={primaryTracking.ups}
                    onChange={(e) => setPrimaryTracking({ ups: e.target.value })}
                    onBlur={() => void onBlurUps()}
                    disabled={saving}
                    placeholder="1Z999AA10123456784"
                    className={`${fieldClass} font-mono text-xs ${primaryTracking.ups && !upsOk ? 'border-amber-400' : ''} ${
                      !primaryTracking.ups ? 'text-gray-500' : ''
                    }`}
                  />
                </label>
              </div>

              {extraShipments > 0 ? (
                <p className="text-[9px] font-semibold text-amber-700">
                  +{extraShipments} other plan{extraShipments !== 1 ? 's' : ''} in selection — tracking fields above apply to plan{' '}
                  <span className="font-mono">{primary.shipment_ref}</span>{' '}
                  <span className="text-amber-600/90">(row id {primary.shipment_id})</span>
                </p>
              ) : null}

              <div className={`${scanChrome.trackingSectionBorder} pt-3`}>
                <p className={scanChrome.selectedItemsLabel}>Selected items</p>
                <ul className="mt-2.5 space-y-4">
                  {selectedItems.map((it) => (
                    <li key={it.item_id} className="min-w-0">
                      <p className="text-[15px] font-bold leading-snug tracking-tight text-gray-900 line-clamp-3">
                        {it.display_title}
                      </p>
                      <p className={`mt-1 ${scanChrome.fnskuSubtext}`}>{it.fnsku}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </LayoutGroup>
  );
}
