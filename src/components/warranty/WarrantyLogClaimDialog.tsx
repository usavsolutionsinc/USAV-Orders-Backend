'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { useWarrantyMutations } from '@/hooks/useWarrantyMutations';

interface WarrantyLogClaimDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (claimId: number) => void;
  /** Prefill the form (e.g. from a coverage lookup). `orderId` is the internal orders.id. */
  initial?: {
    orderId?: number | null;
    serialNumber?: string | null;
    sku?: string | null;
    productTitle?: string | null;
  };
}

/**
 * Minimal "Log Claim" form. Resolves the order's customer / SKU / warranty clock
 * server-side, so a serial OR order OR SKU is enough to start a claim. Opening it
 * with `initial` (from the coverage card) prefills the identifiers.
 */
export function WarrantyLogClaimDialog({ open, onClose, onCreated, initial }: WarrantyLogClaimDialogProps) {
  const { create } = useWarrantyMutations();
  // Portal target. The dialog launches from the warranty sidebar, which sits
  // inside framer-motion transformed ancestors — and a `transform` makes
  // `position: fixed` resolve against that box, not the viewport, clipping the
  // dialog into the sidebar column. Portalling to document.body escapes it.
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const [serialNumber, setSerialNumber] = useState('');
  const [orderId, setOrderId] = useState('');
  const [sku, setSku] = useState('');
  const [productTitle, setProductTitle] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  // Seed the form from `initial` each time the dialog opens (so a coverage-card
  // "Log claim" arrives prefilled, and a fresh open starts clean otherwise).
  useEffect(() => {
    if (!open) return;
    setSerialNumber(initial?.serialNumber ?? '');
    setOrderId(initial?.orderId != null ? String(initial.orderId) : '');
    setSku(initial?.sku ?? '');
    setProductTitle(initial?.productTitle ?? '');
    setNotes('');
  }, [open, initial?.serialNumber, initial?.orderId, initial?.sku, initial?.productTitle]);

  if (!open || !portalNode) return null;

  const orderIdNum = Number(orderId.trim());
  const hasIdentifier = Boolean(serialNumber.trim() || sku.trim() || (orderId.trim() && orderIdNum > 0));

  const reset = () => {
    setSerialNumber('');
    setOrderId('');
    setSku('');
    setProductTitle('');
    setNotes('');
  };

  const submit = () => {
    const body: Record<string, unknown> = {};
    if (serialNumber.trim()) body.serialNumber = serialNumber.trim();
    if (orderId.trim() && orderIdNum > 0) body.orderId = orderIdNum;
    if (sku.trim()) body.sku = sku.trim();
    if (productTitle.trim()) body.productTitle = productTitle.trim();
    if (notes.trim()) body.notes = notes.trim();
    create.mutate(body, {
      onSuccess: (data) => {
        reset();
        onClose();
        if (data.claim?.id) onCreated(data.claim.id);
      },
    });
  };

  const input = 'w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm';

  return createPortal(
    <div className="fixed inset-0 z-panelPopover flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Log warranty claim</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          {create.error && (
            <p className="text-xs text-rose-600">
              {create.error instanceof Error ? create.error.message : 'Failed to log claim.'}
            </p>
          )}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Serial number</label>
            <input className={input} value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="e.g. SN-12345" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Order # (internal id)</label>
              <input className={input} value={orderId} onChange={(e) => setOrderId(e.target.value)} inputMode="numeric" placeholder="e.g. 8421" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">SKU</label>
              <input className={input} value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Product title</label>
            <input className={input} value={productTitle} onChange={(e) => setProductTitle(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Notes</label>
            <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-[11px] text-gray-400">
            Provide a serial, order #, or SKU. The warranty clock + customer are resolved from the order when available.
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={cn(
              'rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50',
            )}
            disabled={!hasIdentifier || create.isPending}
            onClick={submit}
          >
            {create.isPending ? 'Logging…' : 'Log claim'}
          </button>
        </footer>
      </div>
    </div>,
    portalNode,
  );
}
