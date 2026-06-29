'use client';

/**
 * Local pickup Review & Print panel.
 *
 * The pickup counterpart to {@link ../receiving/workspace/LineEditPanel}'s
 * review/print section. Two modes:
 *  - `finalize`: opened from the sidebar's Review button over the pickup pane.
 *    Operator names the pickup, reviews the items + the PO label preview, then
 *    finalizes — which creates one Zoho PO `LCPU-{NAME}-{MMDDYY}` and one
 *    receiving row — and prints the label.
 *  - `reprint`: opened from receiving history for a completed pickup PO. Same
 *    review + label, with reprint only (no finalize).
 *
 * The label itself is the receiving label ({@link printReceivingLabel} /
 * {@link ReceivingPoLabelPreview}) with the pickup name in the top-left slot
 * and the PO number as the scan value.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { Check, Loader2, Package, Printer, ShoppingCart, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { ReceivingPoLabelPreview } from '@/components/receiving/workspace/ReceivingPoLabelPreview';
import { printReceivingLabel } from '@/lib/print/printReceivingLabel';
import { buildLocalPickupPoNumber } from '@/lib/local-pickup/po-number';
import {
  closeReview,
  conditionLabel,
  finalize,
  formatMoney,
  parseMoney,
  useLocalPickupCart,
} from './localPickupStore';

interface ReviewItem {
  key: string;
  title: string;
  sku: string;
  quantity: number;
  total: number;
  conditionGrade: string;
  partsStatus: string;
}

interface LocalPickupReviewPanelProps {
  mode: 'finalize' | 'reprint';
  /** Completed pickup order id (reprint mode). */
  orderId?: number;
  onClose: () => void;
}

function labelDateToday(): string {
  return new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function LocalPickupReviewPanel({ mode, orderId, onClose }: LocalPickupReviewPanelProps) {
  if (mode === 'reprint') {
    return <ReprintReview orderId={orderId} onClose={onClose} />;
  }
  return <FinalizeReview onClose={onClose} />;
}

// ── Finalize mode ─────────────────────────────────────────────────────────────

function FinalizeReview({ onClose }: { onClose: () => void }) {
  const { cart, isSubmitting, submitError } = useLocalPickupCart();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<{ receivingId: number; poNumber: string } | null>(null);

  const items: ReviewItem[] = useMemo(
    () =>
      cart.map((l) => ({
        key: l.key,
        title: l.product_title,
        sku: l.sku,
        quantity: l.quantity,
        total: parseMoney(l.total),
        conditionGrade: l.conditionGrade,
        partsStatus: l.partsStatus,
      })),
    [cart],
  );

  const previewPo = useMemo(
    () => buildLocalPickupPoNumber(name || 'NAME', new Date().toISOString().slice(0, 10)),
    [name],
  );
  const poNumber = done?.poNumber ?? previewPo;
  const labelName = (name.trim() || 'Local pickup').toUpperCase();

  const handleFinalize = async () => {
    const res = await finalize(name, notes);
    if (res.ok && res.receivingId && res.poNumber) {
      setDone({ receivingId: res.receivingId, poNumber: res.poNumber });
    }
  };

  const handlePrint = () => {
    if (!done) return;
    printReceivingLabel({
      receivingId: done.receivingId,
      scanValue: done.poNumber,
      platform: labelName,
      notes: notes.trim(),
      conditionCode: ' ',
      receivingType: 'PICKUP',
      date: labelDateToday(),
    });
  };

  return (
    <ReviewShell
      title={done ? 'PO created' : 'Review & print'}
      onClose={done ? onClose : () => closeReview()}
    >
      {/* Name + notes (locked once finalized) */}
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
            Pickup name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!done || isSubmitting}
            placeholder="e.g. Ken"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-caption font-bold text-gray-900 outline-none focus:border-emerald-500 disabled:bg-gray-50"
          />
          <p className="mt-1 font-mono text-micro font-black uppercase tracking-wide text-emerald-600">
            {poNumber}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!!done || isSubmitting}
            rows={2}
            placeholder="Printed in the middle of the label…"
            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-caption text-gray-900 outline-none focus:border-emerald-500 disabled:bg-gray-50"
          />
        </div>
      </div>

      {/* Cart is cleared once finalized, so only show the live list pre-finalize. */}
      {done ? (
        <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-caption font-semibold text-emerald-700">
          Pushed to Zoho as <span className="font-mono font-black">{done.poNumber}</span>. Print the label below.
        </p>
      ) : (
        <ItemList items={items} />
      )}

      <LabelPreviewBlock
        receivingId={done?.receivingId}
        scanValue={poNumber}
        platform={labelName}
        notes={notes.trim()}
        date={labelDateToday()}
      />

      {submitError ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-caption font-semibold text-red-700">
          {submitError}
        </p>
      ) : null}

      {/* Footer actions */}
      {done ? (
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={handlePrint}
            icon={<Printer className="h-4 w-4" />}
            className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Print label
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => closeReview()}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleFinalize()}
            disabled={isSubmitting || !name.trim() || items.length === 0}
            loading={isSubmitting}
            icon={<ShoppingCart className="h-4 w-4" />}
            className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isSubmitting ? 'Pushing to Zoho…' : 'Finalize & push to Zoho'}
          </Button>
        </div>
      )}
    </ReviewShell>
  );
}

// ── Reprint mode ──────────────────────────────────────────────────────────────

interface PickupOrder {
  id: number;
  customer_name: string | null;
  notes: string | null;
  pickup_date: string;
  completed_at: string | null;
  receiving_id: number | null;
  zoho_purchaseorder_number: string | null;
  items: Array<{
    id: number;
    sku: string | null;
    display_name?: string | null;
    product_title: string | null;
    quantity: number;
    total_price: string | number | null;
    condition_grade: string | null;
    parts_status: string | null;
  }>;
}

function ReprintReview({ orderId, onClose }: { orderId?: number; onClose: () => void }) {
  const [order, setOrder] = useState<PickupOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) {
      setError('Missing order id');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/local-pickup-orders/${orderId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to load order');
        if (!cancelled) setOrder(data.order as PickupOrder);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load order');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const poNumber = useMemo(() => {
    if (!order) return '';
    return (
      order.zoho_purchaseorder_number ||
      buildLocalPickupPoNumber(order.customer_name || '', order.pickup_date)
    );
  }, [order]);

  const labelName = (order?.customer_name?.trim() || 'Local pickup').toUpperCase();
  const labelDate = useMemo(() => {
    const src = order?.completed_at || order?.pickup_date;
    if (!src) return labelDateToday();
    const d = new Date(src);
    return Number.isNaN(d.getTime())
      ? labelDateToday()
      : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  }, [order]);

  const items: ReviewItem[] = useMemo(
    () =>
      (order?.items ?? []).map((i) => ({
        key: String(i.id),
        title: i.display_name || i.product_title || i.sku || 'Item',
        sku: i.sku || '',
        quantity: i.quantity,
        total: Number(i.total_price) || 0,
        conditionGrade: i.condition_grade || '',
        partsStatus: i.parts_status || '',
      })),
    [order],
  );

  const handlePrint = () => {
    if (!order?.receiving_id) return;
    printReceivingLabel({
      receivingId: order.receiving_id,
      scanValue: poNumber,
      platform: labelName,
      notes: (order.notes || '').trim(),
      conditionCode: ' ',
      date: labelDate,
    });
  };

  return (
    <ReviewShell title="Local pickup PO" onClose={onClose}>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-caption font-semibold text-red-700">
          {error}
        </p>
      ) : order ? (
        <>
          <div>
            <p className="text-base font-black tracking-tight text-gray-900">
              {order.customer_name || 'Local pickup'}
            </p>
            <p className="mt-0.5 font-mono text-micro font-black uppercase tracking-wide text-emerald-600">
              {poNumber}
            </p>
            {order.notes ? (
              <p className="mt-1 text-caption text-gray-600">{order.notes}</p>
            ) : null}
          </div>

          <ItemList items={items} />

          <LabelPreviewBlock
            receivingId={order.receiving_id ?? undefined}
            scanValue={poNumber}
            platform={labelName}
            notes={(order.notes || '').trim()}
            date={labelDate}
          />

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={handlePrint}
              disabled={!order.receiving_id}
              icon={<Printer className="h-4 w-4" />}
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Reprint label
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </>
      ) : null}
    </ReviewShell>
  );
}

// ── Shared subcomponents (module scope per `rerender-no-inline-components`) ────

function ReviewShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (typeof window === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="pickup-review-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-panelPopover bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="pickup-review-dialog"
        role="dialog"
        aria-label={title}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.18, ease: motionBezier.easeOut }}
        className="pointer-events-none fixed inset-0 z-panelPopover flex items-start justify-center p-4 pt-[6vh] md:pl-[360px]"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl ring-1 ring-gray-200"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <ShoppingCart className="h-4 w-4" />
              </span>
              <span className="text-label font-black uppercase tracking-tight text-gray-900">
                {title}
              </span>
            </div>
            <IconButton
              onClick={onClose}
              ariaLabel="Close"
              className="rounded-lg p-1.5 transition-colors hover:bg-gray-100"
              icon={<X className="h-4 w-4" />}
            />
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function ItemList({ items }: { items: ReviewItem[] }) {
  const subtotal = items.reduce((sum, i) => sum + i.total, 0);
  const unitCount = items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-eyebrow font-black uppercase tracking-wider text-gray-500">
          {unitCount} item{unitCount === 1 ? '' : 's'}
        </span>
        <span className="text-caption font-black text-emerald-600">{formatMoney(subtotal)}</span>
      </div>
      <div className="max-h-52 divide-y divide-gray-100 overflow-y-auto">
        {items.map((i) => (
          <div key={i.key} className="flex items-center gap-2 px-3 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50">
              <Package className="h-4 w-4 text-gray-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption font-bold text-gray-900">{i.title}</p>
              <p className="text-mini font-bold uppercase tracking-wide text-gray-400">
                {i.sku || 'No SKU'} · x{i.quantity}
                {i.conditionGrade ? ` · ${conditionLabel(i.conditionGrade)}` : ''}
                {i.partsStatus === 'MISSING_PARTS' ? ' · Missing' : ''}
              </p>
            </div>
            <span className="shrink-0 text-caption font-black text-emerald-700">
              {formatMoney(i.total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LabelPreviewBlock({
  receivingId,
  scanValue,
  platform,
  notes,
  date,
}: {
  receivingId?: number;
  scanValue: string;
  platform: string;
  notes: string;
  date: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-eyebrow font-black uppercase tracking-wider text-gray-500">
        Label preview
      </p>
      <ReceivingPoLabelPreview
        embedded
        receivingId={receivingId ?? null}
        scanValue={scanValue}
        platform={platform}
        notes={notes}
        conditionCode=" "
        date={date}
      />
    </div>
  );
}
