'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fbaPaths } from '@/lib/fba/api-paths';
import { ChevronDown, Loader2, Plus } from '@/components/Icons';
import { motion } from 'framer-motion';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';

interface FbaAddToShipmentPanelProps {
  shipmentOptions: number[];
  planRefById: Map<number, string>;
  onAdded?: () => void;
  stationTheme?: StationTheme;
}

export function FbaAddToShipmentPanel({
  shipmentOptions,
  planRefById,
  onAdded,
  stationTheme = 'blue',
}: FbaAddToShipmentPanelProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  const [open, setOpen] = useState(true);
  const dropdownEase = [0.22, 1, 0.36, 1] as const;
  const dropdownMotion = useRef(false);
  const toggleOpen = useCallback(() => {
    dropdownMotion.current = true;
    setOpen((o) => !o);
  }, []);
  const [addShipmentId, setAddShipmentId] = useState<number | ''>('');
  const [addFnsku, setAddFnsku] = useState('');
  const [addQty, setAddQty] = useState('1');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const sortedShipments = useMemo(() => Array.from(new Set(shipmentOptions)).sort((a, b) => a - b), [
    shipmentOptions,
  ]);

  useEffect(() => {
    if (addShipmentId === '' && sortedShipments.length === 1) {
      setAddShipmentId(sortedShipments[0]);
    }
  }, [addShipmentId, sortedShipments]);

  const handleAddFnsku = useCallback(async () => {
    const sid = addShipmentId === '' ? NaN : Number(addShipmentId);
    const fnsku = addFnsku.trim().toUpperCase();
    const quantity = Math.max(1, Math.floor(Number(addQty) || 0));
    if (!Number.isFinite(sid) || sid < 1) {
      setAddError('Choose a shipment');
      return;
    }
    if (!fnsku) {
      setAddError('Enter an FNSKU');
      return;
    }
    setAddError(null);
    setAddLoading(true);
    try {
      const validate = await fetch(
        `/api/fba/fnskus/validate?fnskus=${encodeURIComponent(fnsku)}&persist_missing=1`
      );
      const validateJson = await validate.json();
      const row = Array.isArray(validateJson?.results) ? validateJson.results[0] : null;
      const res = await fetch(fbaPaths.planItems(sid), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fnsku,
          expected_qty: quantity,
          product_title: row?.product_title ?? null,
          asin: row?.asin ?? null,
          sku: row?.sku ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success && !res.ok) {
        setAddError(data.error || 'Could not add line');
        return;
      }
      setAddFnsku('');
      setAddQty('1');
      window.dispatchEvent(new CustomEvent('fba-print-queue-refresh'));
      onAdded?.();
    } catch {
      setAddError('Request failed');
    } finally {
      setAddLoading(false);
    }
  }, [addFnsku, addQty, addShipmentId, onAdded]);

  const hasShipments = sortedShipments.length > 0;

  return (
    <div className="border-t border-zinc-200 bg-white">
      <div className="flex shrink-0 items-center border-b border-zinc-200 bg-zinc-50/95 px-3 py-1">
        <div className="relative min-w-0 w-full">
          <button
            type="button"
            onClick={toggleOpen}
            className={`w-full py-0 pr-10 text-left outline-none transition-colors hover:bg-zinc-100/80 ${chrome.cardFocusRing}`}
            aria-expanded={open}
            aria-controls="add-fnsku-panel"
            aria-label={
              open
                ? undefined
                : `Add FNSKU, ${sortedShipments.length} shipment${sortedShipments.length === 1 ? '' : 's'} available`
            }
            id="add-fnsku-dropdown-trigger"
          >
            <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">Add FNSKU</h2>
            {open ? (
              <p className={`${microBadge} tracking-widest ${chrome.sectionLabel}`}>Manual entry ready</p>
            ) : null}
          </button>
          <motion.span
            initial={false}
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: dropdownMotion.current ? 0.28 : 0, ease: dropdownEase }}
            className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center justify-center text-zinc-500"
            aria-hidden
          >
            <ChevronDown className="h-4 w-4 shrink-0" />
          </motion.span>
        </div>
      </div>
      <motion.div
        id="add-fnsku-panel"
        initial={false}
        animate={{
          height: open ? 'auto' : 0,
          opacity: open ? 1 : 0,
        }}
        transition={{
          height: { duration: dropdownMotion.current ? 0.34 : 0, ease: dropdownEase },
          opacity: { duration: dropdownMotion.current ? 0.18 : 0, ease: dropdownEase },
        }}
        className={open ? 'overflow-hidden' : 'overflow-hidden pointer-events-none'}
      >
        <div className="px-3 py-1">
          <div className="space-y-2">
            <select
              value={addShipmentId === '' ? '' : String(addShipmentId)}
              onChange={(e) => setAddShipmentId(e.target.value ? Number(e.target.value) : '')}
              disabled={!hasShipments}
              className={chrome.input}
            >
              <option value="">Shipment…</option>
              {sortedShipments.map((id) => (
                <option key={id} value={id}>
                  {planRefById.get(id) || `Shipment #${id}`}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              <input
                placeholder="FNSKU"
                value={addFnsku}
                onChange={(e) => setAddFnsku(e.target.value.toUpperCase())}
                className={chrome.monoInput}
                disabled={!hasShipments}
              />
              <input
                type="number"
                min={1}
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                className={`${chrome.input} text-center`}
                disabled={!hasShipments}
              />
            </div>
            {addError ? <p className="text-[10px] font-semibold text-red-600">{addError}</p> : null}
            <button
              type="button"
              onClick={() => void handleAddFnsku()}
              disabled={addLoading || !hasShipments}
              className={`flex h-10 items-center justify-center gap-1 ${chrome.primaryButton}`}
            >
              {addLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : <Plus className="h-3.5 w-3.5" />}
              Add to shipment
            </button>
            {!hasShipments ? (
              <p className="text-[10px] text-gray-500">
                Open a plan or select a shipment to enable manual entries.
              </p>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
