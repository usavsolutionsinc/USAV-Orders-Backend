'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar, Check, ChevronDown, Clipboard, ClipboardList,
  Loader2, Minus, Pencil, Plus, Trash2,
} from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { FnskuChip } from '@/components/ui/CopyChip';
import { DeferredQtyInput } from '@/design-system/primitives';
import { InlineSaveIndicator } from '@/design-system/components';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import { usePanelActions } from '@/hooks/usePanelActions';
import DeleteButton from '@/components/ui/DeleteButton';
import type { FbaBoardItem } from './FbaBoardTable';

/* ── Types ─────────────────────────────────────────────────────────── */

interface PlanEntry {
  item_id: number;
  fnsku: string;
  expected_qty: number;
  actual_qty: number;
  item_status: string;
  display_title: string;
  asin: string | null;
  sku: string | null;
  item_notes: string | null;
  condition: string | null;
  item_created_at: string;
  shipment_id: number;
  shipment_ref: string;
  due_date: string | null;
  shipment_status: string;
  destination_fc: string | null;
  amazon_shipment_id: string | null;
  plan_created_at: string;
  tracking_numbers: { tracking_number: string; carrier: string; label: string }[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/* ── Props ─────────────────────────────────────────────────────────── */

interface FbaBoardDetailPanelProps {
  item: FbaBoardItem;
  onClose: () => void;
  onNavigate: (direction: 'up' | 'down') => void;
  onSaved: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

async function patchFbaItem(
  shipmentId: number,
  itemId: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(`/api/fba/shipments/${shipmentId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function patchFnskuCatalog(
  fnsku: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(`/api/fba/fnskus/${encodeURIComponent(fnsku)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function deleteFbaItem(shipmentId: number, itemId: number): Promise<boolean> {
  const res = await fetch(`/api/fba/shipments/${shipmentId}/items/${itemId}`, {
    method: 'DELETE',
  });
  return res.ok;
}

/** True when the value is a 10-char Amazon ASIN (B0…). */
function looksLikeAsin(value: string): boolean {
  return /^B0[A-Z0-9]{8}$/i.test(value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

function formatPlanDate(raw: string | null): string {
  if (!raw) return 'No date';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCreatedAt(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/* ── Editable field row (ShippingInformationSection pattern) ───────── */

function EditableFieldRow({
  label,
  value,
  placeholder,
  onSave,
  multiline = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (next: string) => Promise<boolean>;
  multiline?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'error') return;
    const t = window.setTimeout(() => setSaveState('idle'), 1600);
    return () => window.clearTimeout(t);
  }, [saveState]);

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const commitSave = useCallback(async (next: string) => {
    const trimmed = next.trim();
    if (trimmed === (value || '').trim()) {
      setIsEditing(false);
      return;
    }
    setSaveState('saving');
    const ok = await onSave(trimmed);
    setSaveState(ok ? 'saved' : 'error');
    if (ok) setIsEditing(false);
  }, [value, onSave]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      const pasted = text.trim().toUpperCase();
      setDraft(pasted);
      setIsEditing(true);
      // Auto-save after paste with a short delay
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void commitSave(pasted), 400);
    } catch { /* clipboard blocked */ }
  }, [commitSave]);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">{label}</span>
          <InlineSaveIndicator state={saveState} />
        </div>
        {isEditing ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onBlur={() => void commitSave(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitSave(draft);
              if (e.key === 'Escape') { setDraft(value); setIsEditing(false); }
            }}
            placeholder={placeholder}
            autoFocus
            className="h-7 w-full border-0 bg-transparent px-0 text-[13px] font-bold text-gray-900 outline-none"
          />
        ) : (
          <button type="button" onClick={() => setIsEditing(true)} className="block w-full text-left">
            <p className={`text-[13px] font-bold text-gray-900 ${multiline ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
              {(value || '').trim() || <span className="text-gray-400">{placeholder}</span>}
            </p>
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-gray-400">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label={`Edit ${label}`}
          title={`Edit ${label}`}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => void handlePaste()}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label={`Paste ${label}`}
          title={`Paste from clipboard`}
        >
          <Clipboard className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* ── Entry Card (one plan row) ─────────────────────────────────────── */

function PlanEntryCard({
  entry,
  onQtySaved,
  onDeleted,
}: {
  entry: PlanEntry;
  onQtySaved: () => void;
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [qty, setQty] = useState(entry.expected_qty);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setQty(entry.expected_qty);
    setConfirmDelete(false);
  }, [entry.item_id, entry.expected_qty]);

  const saveQty = useCallback(
    async (next: number) => {
      const clamped = Math.max(1, next);
      setQty(clamped);
      setSaving(true);
      const ok = await patchFbaItem(entry.shipment_id, entry.item_id, { expected_qty: clamped });
      setSaving(false);
      if (ok) onQtySaved();
      else setQty(entry.expected_qty);
    },
    [entry.shipment_id, entry.item_id, entry.expected_qty, onQtySaved],
  );

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    const ok = await deleteFbaItem(entry.shipment_id, entry.item_id);
    setDeleting(false);
    if (ok) {
      onDeleted();
      window.dispatchEvent(new Event('usav-refresh-data'));
    }
  }, [entry.shipment_id, entry.item_id, onDeleted]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Calendar className="h-3 w-3 shrink-0 text-purple-500" />
            <span className="text-[12px] font-black text-gray-900">
              {entry.shipment_ref || formatPlanDate(entry.due_date)}
            </span>
          </div>
          <div className="flex items-center gap-3 pl-5 text-[11px]">
            <span className="flex items-center gap-1 font-bold text-gray-500">
              <ClipboardList className="h-3 w-3 text-purple-400" />
              <span className="tabular-nums">{entry.expected_qty}</span>
            </span>
            <span className="flex items-center gap-1 font-bold text-emerald-700">
              <Check className="h-3 w-3 text-emerald-500" />
              <span className="tabular-nums">{entry.actual_qty}</span>
            </span>
            <span className="text-[10px] font-bold text-gray-400">
              {formatCreatedAt(entry.plan_created_at)}
            </span>
          </div>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-gray-100 px-3 py-3">
          <div>
            <p className={`mb-2 ${sectionLabel}`}>Quantity</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void saveQty(qty - 1)}
                disabled={saving || qty <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
                aria-label="Decrease quantity"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <DeferredQtyInput
                value={qty}
                min={1}
                max={9999}
                onChange={(v) => void saveQty(v)}
                className="h-10 w-16 rounded-lg border border-gray-200 bg-white text-center text-lg font-black tabular-nums text-gray-900 outline-none transition-colors focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => void saveQty(qty + 1)}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
                aria-label="Increase quantity"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
            </div>
          </div>

          <dl className="space-y-1 text-[11px]">
            {entry.destination_fc && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-gray-500">Destination FC</dt>
                <dd className="font-black text-gray-800">{entry.destination_fc}</dd>
              </div>
            )}
            {entry.amazon_shipment_id && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-gray-500">Amazon Shipment</dt>
                <dd className="font-black text-gray-800">{entry.amazon_shipment_id}</dd>
              </div>
            )}
            {entry.condition && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-gray-500">Condition</dt>
                <dd className="font-black text-gray-800">{entry.condition}</dd>
              </div>
            )}
            {entry.item_notes && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-gray-500">Notes</dt>
                <dd className="max-w-[200px] text-right font-bold text-gray-700">{entry.item_notes}</dd>
              </div>
            )}
          </dl>

          {entry.tracking_numbers.length > 0 && (
            <div>
              <p className={`mb-1.5 ${sectionLabel}`}>Tracking</p>
              <div className="space-y-0.5">
                {entry.tracking_numbers.map((t, i) => (
                  <p key={i} className="font-mono text-[10px] font-bold text-gray-600">
                    {t.carrier && <span className="text-gray-400">{t.carrier} </span>}
                    {t.tracking_number}
                  </p>
                ))}
              </div>
            </div>
          )}

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-[10px] font-bold text-red-500 transition-colors hover:text-red-700"
            >
              <Trash2 className="h-3 w-3" />
              Remove entry
            </button>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-[11px] font-bold text-red-800">
                Remove this entry from {entry.shipment_ref || 'plan'}?
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="h-7 rounded-md border border-gray-200 bg-white text-[9px] font-black uppercase tracking-wider text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-red-600 text-[9px] font-black uppercase tracking-wider text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
                  {deleting ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Panel ────────────────────────────────────────────────────── */

export function FbaBoardDetailPanel({
  item,
  onClose,
  onNavigate,
  onSaved,
  disableMoveUp = false,
  disableMoveDown = false,
}: FbaBoardDetailPanelProps) {
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Editable catalog fields — local state seeded from item, saved to catalog + items
  const [productTitle, setProductTitle] = useState(item.display_title || '');
  const [condition, setCondition] = useState(item.condition || '');
  const [sku, setSku] = useState(item.sku || '');
  const [asin, setAsin] = useState(item.asin || '');

  // Resync when navigating between items
  useEffect(() => {
    setProductTitle(item.display_title || '');
    setCondition(item.condition || '');
    setSku(item.sku || '');
    setAsin(item.asin || '');
  }, [item.item_id, item.display_title, item.condition, item.sku, item.asin]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fba/board/${encodeURIComponent(item.fnsku.trim().toUpperCase())}/entries`);
      const data = await res.json();
      if (data.success) setEntries(data.entries ?? []);
    } catch {
      // silently fall back to empty
    } finally {
      setLoading(false);
    }
  }, [item.fnsku]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleEntryChange = useCallback(() => {
    fetchEntries();
    onSaved();
  }, [fetchEntries, onSaved]);

  // Save helpers for editable fields — update catalog + all item rows
  const saveProductTitle = useCallback(async (next: string): Promise<boolean> => {
    // B0-prefixed values are ASINs — save to ASIN field, not product title
    if (looksLikeAsin(next)) {
      const asinVal = next.trim().toUpperCase();
      const ok = await patchFnskuCatalog(item.fnsku, { asin: asinVal });
      if (ok) {
        setAsin(asinVal);
        for (const e of entries) {
          await patchFbaItem(e.shipment_id, e.item_id, { asin: asinVal });
        }
        onSaved();
      }
      return ok;
    }
    const ok = await patchFnskuCatalog(item.fnsku, { product_title: next || null });
    if (ok) {
      setProductTitle(next);
      for (const e of entries) {
        await patchFbaItem(e.shipment_id, e.item_id, { product_title: next || null });
      }
      onSaved();
    }
    return ok;
  }, [item.fnsku, entries, onSaved]);

  const saveSku = useCallback(async (next: string): Promise<boolean> => {
    const ok = await patchFnskuCatalog(item.fnsku, { sku: next || null });
    if (ok) {
      setSku(next);
      for (const e of entries) {
        await patchFbaItem(e.shipment_id, e.item_id, { sku: next || null });
      }
      onSaved();
    }
    return ok;
  }, [item.fnsku, entries, onSaved]);

  const saveCondition = useCallback(async (next: string): Promise<boolean> => {
    const ok = await patchFnskuCatalog(item.fnsku, { condition: next || null });
    if (ok) {
      setCondition(next);
      onSaved();
    }
    return ok;
  }, [item.fnsku, onSaved]);

  const saveAsin = useCallback(async (next: string): Promise<boolean> => {
    const ok = await patchFnskuCatalog(item.fnsku, { asin: next || null });
    if (ok) {
      setAsin(next);
      for (const e of entries) {
        await patchFbaItem(e.shipment_id, e.item_id, { asin: next || null });
      }
      onSaved();
    }
    return ok;
  }, [item.fnsku, entries, onSaved]);

  const panelActions = usePanelActions(
    { entityType: 'fba_item', entityId: item.item_id },
  );

  const totalExpected = entries.reduce((sum, e) => sum + (Number(e.expected_qty) || 0), 0);
  const totalActual = entries.reduce((sum, e) => sum + (Number(e.actual_qty) || 0), 0);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 360, mass: 0.45 }}
      className="fixed right-0 top-0 z-[100] flex h-screen w-[400px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-24px_0_48px_rgba(0,0,0,0.06)]"
    >
      {/* ── Fixed header (4 rows) — never scrolls ──────────────────── */}
      <div className="shrink-0 overflow-hidden bg-white">
        {/* Row 1: label */}
        <div className="px-6 pt-4 pb-0">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-purple-700">
            FBA Item
          </p>
        </div>

        {/* Row 2: title (clamped in header — full title in catalog info below) */}
        <div className="px-6 pt-1.5 pb-2 border-b border-gray-200 h-[100px]">
          <h2 className="line-clamp-4 text-[17px] font-black leading-snug tracking-tight text-gray-950">
            {productTitle || item.fnsku || asin || 'Untitled'}
          </h2>
        </div>

        {/* Row 3: navigation action bar */}
        <div className="pt-1 pb-0">
          <PanelActionBar
            onClose={onClose}
            onMoveUp={() => onNavigate('up')}
            onMoveDown={() => onNavigate('down')}
            disableMoveUp={disableMoveUp}
            disableMoveDown={disableMoveDown}
            actions={panelActions}
          />
        </div>

        {/* Row 4: FNSKU + totals */}
        <div className="flex items-center justify-between px-6 pt-2 pb-2">
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1 font-bold text-gray-600">
              <ClipboardList className="h-3 w-3 text-purple-500" />
              <span className="tabular-nums">{totalExpected}</span>
            </span>
            <span className="flex items-center gap-1 font-bold text-emerald-700">
              <Check className="h-3 w-3 text-emerald-500" />
              <span className="tabular-nums">{totalActual}</span>
            </span>
          </div>
          <FnskuChip value={item.fnsku} />
        </div>
      </div>

      {/* ── Scrollable body ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4">
          {/* Editable catalog fields — inline edit + paste like ShippingInformationSection */}
          <section>
            <p className={`mb-1 ${sectionLabel}`}>Catalog Info</p>
            <div>
              <EditableFieldRow
                label="Product Title"
                value={productTitle}
                placeholder="Enter product title"
                onSave={saveProductTitle}
                multiline
              />
              <EditableFieldRow
                label="Condition"
                value={condition}
                placeholder="N/A"
                onSave={saveCondition}
              />
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5 last:border-b-0">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500">FNSKU</span>
                  <p className="font-mono text-[13px] font-bold text-gray-900">{item.fnsku}</p>
                </div>
              </div>
              <EditableFieldRow
                label="SKU"
                value={sku}
                placeholder="Enter SKU"
                onSave={saveSku}
              />
              <EditableFieldRow
                label="ASIN"
                value={asin}
                placeholder="Enter ASIN"
                onSave={saveAsin}
              />
            </div>
          </section>

          <div className="h-px bg-gray-100" />

          {/* Static details */}
          <section className="py-4">
            <p className={`mb-2 ${sectionLabel}`}>Details</p>
            <dl className="space-y-1 text-[12px]">
              <div className="flex items-center justify-between gap-4">
                <dt className="font-semibold text-gray-500">Plans</dt>
                <dd className="font-black text-gray-800">{entries.length}</dd>
              </div>
            </dl>
          </section>

          <div className="h-px bg-gray-100" />

          {/* Plan entries list */}
          <section className="py-4">
            <p className={`mb-3 ${sectionLabel}`}>
              Plan Entries ({entries.length})
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : entries.length === 0 ? (
              <p className="py-4 text-center text-[11px] font-bold text-gray-400">
                No active plan entries
              </p>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) => (
                  <PlanEntryCard
                    key={entry.item_id}
                    entry={entry}
                    onQtySaved={handleEntryChange}
                    onDeleted={handleEntryChange}
                  />
                ))}
              </div>
            )}
          </section>

          {/* All tracking numbers across entries */}
          {entries.some((e) => e.tracking_numbers.length > 0) && (
            <>
              <div className="h-px bg-gray-100" />
              <section className="py-4">
                <p className={`mb-2 ${sectionLabel}`}>All Tracking</p>
                <div className="space-y-0.5">
                  {Array.from(
                    new Map(
                      entries
                        .flatMap((e) => e.tracking_numbers)
                        .map((t) => [t.tracking_number, t]),
                    ).values(),
                  ).map((t, i) => (
                    <p key={i} className="font-mono text-[11px] font-bold text-gray-700">
                      {t.carrier && <span className="text-gray-500">{t.carrier} </span>}
                      {t.tracking_number}
                    </p>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
