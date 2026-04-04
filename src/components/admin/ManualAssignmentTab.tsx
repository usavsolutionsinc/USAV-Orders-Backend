'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ManualAssignmentTable, type ManualAssignmentRow } from './ManualAssignmentTable';
import { ExternalLink, FileText, Loader2, Printer } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { framerTransition } from '@/design-system/foundations/motion-framer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryProductRow {
  id?: number | string;
  item_number: string;
  product_title: string;
  display_name?: string;
  google_file_id?: string;
}

interface RecentOrder {
  id: number;
  order_id: string;
  product_title: string;
  item_number: string | null;
  sku: string;
  quantity: string | number | null;
  shipping_tracking_number: string | null;
  is_shipped?: boolean; // derived from shipping_tracking_numbers
  has_manual: boolean;
}

interface RecentManual {
  id: number;
  itemNumber: string | null;
  productTitle: string | null;
  displayName: string | null;
  googleFileId: string;
  type: string | null;
  isActive: boolean;
  updatedAt: string;
  previewUrl: string;
  viewUrl: string;
  downloadUrl: string;
}

interface ManualAssignmentTabProps {
  manualMode?: 'category' | 'orders';
  categoryId?: string;
  orderId?: string;
  searchValue?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeGoogleDocId(rawValue: string): string {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return '';
  const docIdMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docIdMatch?.[1]) return docIdMatch[1];
  const fileIdMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch?.[1]) return fileIdMatch[1];
  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch?.[1]) return queryMatch[1];
  return trimmed;
}

function buildRows(products: CategoryProductRow[]): ManualAssignmentRow[] {
  return products
    .map((product) => ({
      itemNumber: String(product.item_number || '').trim(),
      productTitle: String(product.product_title || '').trim() || '-',
      manualDisplayName: String(product.display_name || '').trim(),
      googleDocId: String(product.google_file_id || '').trim(),
    }))
    .filter((row) => row.itemNumber.length > 0)
    .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
}

async function parseResponse(res: Response): Promise<any> {
  const raw = await res.text();
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// ─── Inline Expansion Form ────────────────────────────────────────────────────

interface InlineFormProps {
  row: ManualAssignmentRow;
  onSaved: (itemNumber: string, googleDocId: string, manualDisplayName: string) => void;
  onClose: () => void;
}

export function InlineManualForm({ row, onSaved, onClose }: InlineFormProps) {
  // When item_number is missing on the order row, let the user enter it here
  const [localItemNumber, setLocalItemNumber] = useState('');
  const effectiveItemNumber = row.itemNumber.trim() || localItemNumber.trim().toUpperCase();
  const itemNumberMissing = !row.itemNumber.trim();

  const [draft, setDraft] = useState(row.googleDocId || '');
  const [draftDisplayName, setDraftDisplayName] = useState(
    row.manualDisplayName || row.productTitle || (row.itemNumber ? `${row.itemNumber} Manual` : '')
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [manuals, setManuals] = useState<RecentManual[]>([]);
  const [manualsLoading, setManualsLoading] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemNumRef = useRef<HTMLInputElement>(null);

  // Reset when row changes
  useEffect(() => {
    setDraft(row.googleDocId || '');
    setDraftDisplayName(row.manualDisplayName || row.productTitle || (row.itemNumber ? `${row.itemNumber} Manual` : ''));
    setLocalItemNumber('');
    setSaveError(null);
    setSaveSuccess(false);
    setPreviewActive(false);
  }, [row.itemNumber, row.googleDocId, row.manualDisplayName, row.productTitle]);

  // Load linked manuals (only when we have a known item number)
  const loadManuals = useCallback(async () => {
    if (!effectiveItemNumber) return;
    setManualsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '5', itemNumber: effectiveItemNumber });
      const res = await fetch(`/api/manuals/recent?${params.toString()}`);
      const data = await res.json();
      setManuals(Array.isArray(data?.manuals) ? data.manuals : []);
    } catch { setManuals([]); }
    finally { setManualsLoading(false); }
  }, [effectiveItemNumber]);

  useEffect(() => { void loadManuals(); }, [loadManuals]);

  const handleSave = async () => {
    if (!effectiveItemNumber) {
      setSaveError('Enter the item number before linking a manual.');
      itemNumRef.current?.focus();
      return;
    }
    const docId = normalizeGoogleDocId(draft);
    if (!docId) { setSaveError('Paste a Google Drive link or file ID.'); return; }
    const displayName = draftDisplayName.trim() || row.productTitle || `${effectiveItemNumber} Manual`;
    if (!displayName) { setSaveError('Enter a manual name before saving.'); return; }
    setSaveError(null);
    setIsSaving(true);

    try {
      // If the order row had no item_number and the user typed one, persist it to the orders table
      if (itemNumberMissing && localItemNumber.trim() && row.dbId) {
        await fetch('/api/orders/set-item-number', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.dbId, item_number: effectiveItemNumber }),
        });
      }

      // Save the product manual
      const payload = {
        itemNumber: effectiveItemNumber,
        item_number: effectiveItemNumber,
        productTitle: row.productTitle || null,
        product_title: row.productTitle || null,
        displayName,
        display_name: displayName,
        googleDocId: docId,
        google_file_id: docId,
      };
      const res = await fetch('/api/product-manuals/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setSaveError(data?.error || `Save failed (HTTP ${res.status})`); return; }
      const savedId = String(data?.manual?.google_file_id || docId).trim();
      setDraft(savedId);
      setDraftDisplayName(String(data?.manual?.display_name || displayName));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      onSaved(effectiveItemNumber, savedId, String(data?.manual?.display_name || displayName));
      await loadManuals();
    } catch { setSaveError('Network error. Try again.'); }
    finally { setIsSaving(false); }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) { setDraft(text.trim()); setSaveError(null); }
    } catch { /* no clipboard access — ignore */ }
    inputRef.current?.focus();
  };

  const activeManual = manuals.find((m) => m.isActive) ?? null;
  const hasLinked = Boolean(activeManual || row.googleDocId.trim());
  const displayFileId = activeManual?.googleFileId || normalizeGoogleDocId(row.googleDocId);
  const manualTitle =
    activeManual?.displayName
    || row.manualDisplayName
    || row.productTitle
    || (effectiveItemNumber ? `${effectiveItemNumber} Manual` : 'Product Manual');
  const viewUrl = displayFileId ? `https://docs.google.com/document/d/${displayFileId}` : null;
  const previewUrl = displayFileId ? `https://docs.google.com/document/d/${displayFileId}/preview` : null;
  const downloadUrl = displayFileId ? `https://docs.google.com/document/d/${displayFileId}/export?format=pdf` : null;

  return (
    <div className="bg-white">
      {/* ── Linked manual banner ── */}
      <AnimatePresence mode="wait">
        {hasLinked && viewUrl && (
          <motion.div
            key="banner"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={framerTransition.overlayScrim}
          >
            {/* Banner header */}
            <div className="flex items-center justify-between gap-2 bg-indigo-600 px-5 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" />
                <p className={`${sectionLabel} text-white`}>
                  {manualTitle}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <a href={viewUrl} target="_blank" rel="noopener noreferrer"
                  className={`${sectionLabel} inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all`}>
                  <ExternalLink className="w-3 h-3" /> Open Doc
                </a>
                {downloadUrl && (
                  <a href={downloadUrl} target="_blank" rel="noopener noreferrer"
                    className={`${sectionLabel} inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all`}>
                    <Printer className="w-3 h-3" /> Print PDF
                  </a>
                )}
                <button type="button" onClick={() => setPreviewActive((v) => !v)}
                  className={`${sectionLabel} inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all`}>
                  {previewActive ? 'Hide Preview' : 'Show Preview'}
                </button>
              </div>
            </div>

            {/* Collapsible iframe */}
            <AnimatePresence>
              {previewActive && previewUrl && (
                <motion.div
                  initial={{ height: 0 }} animate={{ height: 260 }} exit={{ height: 0 }}
                  transition={framerTransition.workOrderSlideSpring}
                  className="overflow-hidden border-b border-indigo-100 bg-gray-50">
                  <iframe src={previewUrl} title="Manual preview" className="w-full h-[260px]" loading="lazy" referrerPolicy="no-referrer" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Linked paperwork — directly below banner ── */}
            {(manualsLoading || manuals.length > 0) && (
              <div className="bg-indigo-50 border-b border-indigo-100 px-5 py-3 space-y-1.5">
                <p className={`${sectionLabel} text-indigo-500 mb-2`}>Recent Manual Records</p>
                {manualsLoading ? (
                  <div className="flex items-center gap-2 py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    <p className="text-[10px] font-semibold text-indigo-500">Loading manual records...</p>
                  </div>
                ) : (
                  manuals.map((manual) => (
                    <div key={manual.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${
                        manual.isActive ? 'border-indigo-200 bg-white shadow-sm' : 'border-indigo-100 bg-indigo-50/60 opacity-55'
                      }`}>
                      <div className="min-w-0 flex-1">
                        <p className={`${sectionLabel} ${manual.isActive ? 'text-indigo-700' : 'text-indigo-500'}`}>
                          {manual.displayName || manual.type || 'Manual'}
                          {!manual.isActive && <span className="ml-1 text-[8px] normal-case tracking-normal font-semibold opacity-70">(inactive)</span>}
                        </p>
                        <p className="mt-0.5 text-[9px] font-mono text-gray-500 truncate">{manual.itemNumber || 'NO-ITEM'}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <a href={manual.viewUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-indigo-600 hover:bg-indigo-100 transition-colors" title="Open">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <a href={manual.downloadUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" title="Print">
                          <Printer className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add / Edit form ── */}
      <div className="px-5 py-4 bg-blue-50/40 border-b border-blue-100">
        <div className="flex items-center justify-between mb-3">
          <p className={sectionLabel}>
            {hasLinked ? 'Update Manual Link' : 'Add Manual Link'}
          </p>
          <button type="button" onClick={onClose}
            className={`${sectionLabel} text-gray-500 hover:text-gray-600 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100`}>
            Close
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {/* Step 1 — item number input (shown only when order has no item_number) */}
          {itemNumberMissing && (
            <div className="flex flex-col gap-1">
              <label className={`${sectionLabel} text-amber-600`}>
                Item Number
              </label>
              <input
                ref={itemNumRef}
                type="text"
                value={localItemNumber}
                onChange={(e) => { setLocalItemNumber(e.target.value.toUpperCase()); setSaveError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.focus(); }}
                placeholder="Enter item number first"
                autoComplete="off"
                autoFocus
                className="h-[38px] w-full rounded-xl border border-amber-300 bg-white px-4 text-xs font-bold text-gray-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 transition-colors shadow-sm"
              />
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className={`${sectionLabel} ${effectiveItemNumber ? 'text-blue-700' : 'text-gray-500'}`}>
              Manual Name
            </span>
            <input
              type="text"
              value={draftDisplayName}
              onChange={(e) => { setDraftDisplayName(e.target.value); setSaveError(null); }}
              placeholder={effectiveItemNumber ? `${effectiveItemNumber} Manual` : 'Enter item number first'}
              disabled={!effectiveItemNumber}
              autoComplete="off"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-900 outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500 transition-colors shadow-sm"
            />
          </label>

          {/* Step 2 — Google Doc input + Paste + Save */}
          <label className="flex flex-col gap-1">
            <span className={`${sectionLabel} ${effectiveItemNumber ? 'text-blue-700' : 'text-gray-500'}`}>
              Google Drive Link or File ID
            </span>
            <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setSaveError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              placeholder={effectiveItemNumber ? 'Paste Google Drive link or file ID' : 'Enter item number first'}
              disabled={!effectiveItemNumber}
              autoComplete="off"
              className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-900 outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500 transition-colors shadow-sm"
            />
            <button type="button" onClick={handlePaste} disabled={!effectiveItemNumber} title="Paste from clipboard"
              className={`${sectionLabel} flex-shrink-0 h-[38px] px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:text-gray-700 disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-sm`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Paste
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={isSaving || !draft.trim() || !draftDisplayName.trim() || !effectiveItemNumber}
              className={`${sectionLabel} flex-shrink-0 h-[38px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5 shadow-sm`}>
              {isSaving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving</> : saveSuccess ? 'Saved' : 'Save'}
            </button>
            </div>
          </label>
        </div>

        {saveError && (
          <p className={`${sectionLabel} mt-2 text-red-600`}>{saveError}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function ManualAssignmentTab({
  manualMode = 'category',
  categoryId = '',
  orderId = '',
  searchValue = '',
}: ManualAssignmentTabProps) {
  const [rows, setRows] = useState<ManualAssignmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<ManualAssignmentRow | null>(null);

  const attachedCount = useMemo(
    () => rows.filter((r) => r.googleDocId.trim().length > 0).length,
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.itemNumber, row.productTitle, row.googleDocId].some((v) =>
        String(v || '').toLowerCase().includes(q)
      )
    );
  }, [rows, searchValue]);

  const loadCategoryProducts = useCallback(async (catId: string) => {
    if (!catId) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      // Single request — server now joins Ecwid products + manual assignments together
      const res = await fetch(`/api/product-manuals/by-category?category=${encodeURIComponent(catId)}`);
      const data = await parseResponse(res);
      if (!res.ok) { setError(data.error || `Failed (HTTP ${res.status})`); return; }
      const products = Array.isArray(data?.products) ? data.products : [];
      setRows(buildRows(products));
    } catch { setError('Network error while loading products.'); }
    finally { setLoading(false); }
  }, []);

  const loadOrderRow = useCallback(async (oid: string) => {
    if (!oid) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/orders/recent?days=30`);
      const data = await parseResponse(res);
      if (!res.ok) { setError(data.error || 'Failed to load order.'); return; }
      const allOrders: RecentOrder[] = (data?.groups ?? []).flatMap((g: { orders: RecentOrder[] }) => g.orders);
      const order = allOrders.find((o) => String(o.id) === oid);
      if (!order) { setRows([]); setError('Order not found.'); return; }
      const manualRow: ManualAssignmentRow = {
        itemNumber: order.item_number || '',
        productTitle: order.product_title || '',
        googleDocId: '',
        orderId: order.order_id,
        dbId: order.id,
        trackingNumber: order.shipping_tracking_number,
        isShipped: order.is_shipped,
      };
      if (manualRow.itemNumber) {
        const manualRes = await fetch(`/api/manuals/recent?itemNumber=${encodeURIComponent(manualRow.itemNumber)}&limit=1`);
        const manualData = await parseResponse(manualRes);
        if (manualRes.ok && Array.isArray(manualData?.manuals) && manualData.manuals.length > 0) {
          manualRow.googleDocId = String(manualData.manuals[0]?.googleFileId || '');
          manualRow.manualDisplayName = String(manualData.manuals[0]?.displayName || '');
        }
      }
      setRows([manualRow]);
    } catch { setError('Network error while loading order.'); }
    finally { setLoading(false); }
  }, []);

  const prevCategoryId = useRef('');
  const prevOrderId = useRef('');
  const prevMode = useRef('');

  useEffect(() => {
    if (manualMode === 'category') {
      if (categoryId !== prevCategoryId.current || manualMode !== prevMode.current) {
        prevCategoryId.current = categoryId;
        prevMode.current = manualMode;
        setSelectedRow(null);
        void loadCategoryProducts(categoryId);
      }
    } else {
      if (orderId !== prevOrderId.current || manualMode !== prevMode.current) {
        prevOrderId.current = orderId;
        prevMode.current = manualMode;
        setSelectedRow(null);
        void loadOrderRow(orderId);
      }
    }
  }, [manualMode, categoryId, orderId, loadCategoryProducts, loadOrderRow]);

  const handleRowClick = (row: ManualAssignmentRow) => {
    setSelectedRow((prev) => (prev?.itemNumber === row.itemNumber ? null : row));
  };

  const handleSaved = (itemNumber: string, googleDocId: string, manualDisplayName: string) => {
    setRows((prev) => prev.map((r) => r.itemNumber === itemNumber ? { ...r, googleDocId, manualDisplayName } : r));
    setSelectedRow((prev) => prev?.itemNumber === itemNumber ? { ...prev, googleDocId, manualDisplayName } : prev);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Coverage bar */}
      {manualMode === 'category' && rows.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-3">
          <div>
            <p className={sectionLabel}>Manual Coverage</p>
            <p className="mt-0.5 text-base font-black text-gray-900">
              {attachedCount}<span className="text-sm font-semibold text-gray-500"> / {rows.length}</span>
            </p>
          </div>
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: rows.length > 0 ? `${(attachedCount / rows.length) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex-shrink-0 mx-6 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className={`${sectionLabel} text-red-700`}>{error}</p>
        </div>
      )}

      {/* Table with inline expansion */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {manualMode === 'category' && !categoryId ? (
          <div className="flex h-48 items-center justify-center">
            <p className={sectionLabel}>Choose a category from the sidebar to load products</p>
          </div>
        ) : manualMode === 'orders' && !orderId ? (
          <div className="flex h-48 items-center justify-center">
            <p className={sectionLabel}>Choose an order from the sidebar to load products</p>
          </div>
        ) : (
          <ManualAssignmentTable
            rows={filteredRows}
            selectedItemNumber={selectedRow?.itemNumber}
            onRowClick={handleRowClick}
            loading={loading}
            emptyMessage={
              loading ? 'Loading products...'
                : manualMode === 'category' ? 'No products were found in this category.'
                  : 'No product lines were found for this order.'
            }
            renderExpanded={(row) => (
              <InlineManualForm
                row={row}
                onSaved={handleSaved}
                onClose={() => setSelectedRow(null)}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
