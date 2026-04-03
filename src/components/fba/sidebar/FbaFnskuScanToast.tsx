'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fbaPaths } from '@/lib/fba/api-paths';
import { X, Package, Loader2 } from '@/components/Icons';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import type { FbaPlanQueueItem } from '@/components/station/upnext/upnext-types';

const FBA_FNSKU_STATION_SCANNED = 'fba-fnsku-station-scanned';
const AUTO_DISMISS_MS = 12_000;

interface ScannedDetail {
  fnsku: string;
  productTitle: string | null;
  shipmentId: number | null;
  planRef: string | null;
}

interface FbaFnskuScanToastProps {
  pendingPlans: FbaPlanQueueItem[];
  stationTheme: StationTheme;
}

/**
 * Listens for FNSKU scans from the tech station and offers a one-click
 * "Add to plan" action so techs can attach scanned items to open FBA plans.
 */
export function FbaFnskuScanToast({ pendingPlans, stationTheme }: FbaFnskuScanToastProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  const [detail, setDetail] = useState<ScannedDetail | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    setDetail(null);
    setSelectedPlanId('');
    setAddedMsg(null);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  };

  const armDismissTimer = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ScannedDetail>).detail;
      if (!d?.fnsku) return;
      setDetail(d);
      setSelectedPlanId('');
      setAddedMsg(null);
      armDismissTimer();
    };
    window.addEventListener(FBA_FNSKU_STATION_SCANNED, handler);
    return () => {
      window.removeEventListener(FBA_FNSKU_STATION_SCANNED, handler);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    if (!detail) return;
    const planId = pendingPlans.length === 1
      ? pendingPlans[0].id
      : Number(selectedPlanId);
    if (!planId) return;

    setAdding(true);
    try {
      const res = await fetch(fbaPaths.planItems(planId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fnsku: detail.fnsku, expected_qty: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to add');
      const plan = pendingPlans.find((p) => p.id === planId);
      setAddedMsg(`Added to ${plan?.shipment_ref || `Plan ${planId}`}`);
      window.dispatchEvent(new Event('fba-plan-created'));
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(dismiss, 3_000);
    } catch {
      setAddedMsg('Failed to add — try manually');
    } finally {
      setAdding(false);
    }
  };

  return (
    <AnimatePresence>
      {detail ? (
        <motion.div
          key="fba-fnsku-toast"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
          className="mx-3 mb-2 mt-1 overflow-hidden rounded-xl border border-purple-200 bg-purple-50 p-3 shadow-sm"
        >
          <div className="flex items-start gap-2">
            <Package className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-purple-800">
                Station FNSKU scan
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] font-black text-gray-900">
                {detail.fnsku}
              </p>
              {detail.productTitle ? (
                <p className="mt-0.5 truncate text-[10px] text-gray-600">{detail.productTitle}</p>
              ) : null}

              {addedMsg ? (
                <p className="mt-1.5 text-[10px] font-bold text-emerald-700">{addedMsg}</p>
              ) : pendingPlans.length === 0 ? (
                <p className="mt-1.5 text-[10px] text-gray-500">No open plans to add to.</p>
              ) : pendingPlans.length === 1 ? (
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={adding}
                  className={`mt-1.5 flex items-center gap-1 rounded-full border border-purple-300 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50 ${chrome.cardFocusRing}`}
                >
                  {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Add to {pendingPlans[0].shipment_ref || 'plan'}
                </button>
              ) : (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <select
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    className="rounded-lg border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-gray-900 outline-none focus:border-purple-400"
                  >
                    <option value="">Pick plan…</option>
                    {pendingPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.shipment_ref || `Plan ${p.id}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={adding || !selectedPlanId}
                    className={`flex items-center gap-1 rounded-full border border-purple-300 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-40 ${chrome.cardFocusRing}`}
                  >
                    {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 rounded-full p-1 text-purple-400 transition-colors hover:bg-purple-100 hover:text-purple-700"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
