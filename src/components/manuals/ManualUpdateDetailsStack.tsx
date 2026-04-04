'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Check, FileText, Loader2, RefreshCw, X } from '@/components/Icons';
import type { ManualAssignmentRow } from '@/components/admin/ManualAssignmentTable';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface ProductManualRecord {
  id: number;
  item_number: string | null;
  product_title: string | null;
  display_name: string | null;
  source_url: string | null;
  relative_path: string | null;
  folder_path: string | null;
  file_name: string | null;
  status: 'unassigned' | 'assigned' | 'archived';
  assigned_at: string | null;
  assigned_by: string | null;
  updated_at: string | null;
  name: string;
}

interface ManualUpdateDetailsStackProps {
  row: ManualAssignmentRow;
  onClose: () => void;
  onAssigned: (itemNumber: string) => void;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleString();
}

export function ManualUpdateDetailsStack({
  row,
  onClose,
  onAssigned,
}: ManualUpdateDetailsStackProps) {
  const [itemNumberDraft, setItemNumberDraft] = useState(String(row.itemNumber || '').trim().toUpperCase());
  const [linkedManuals, setLinkedManuals] = useState<ProductManualRecord[]>([]);
  const [unassignedManuals, setUnassignedManuals] = useState<ProductManualRecord[]>([]);
  const [linkedFolderPath, setLinkedFolderPath] = useState('');
  const [unassignedFolderPath, setUnassignedFolderPath] = useState('');
  const [selectedRelativePath, setSelectedRelativePath] = useState('');
  const [isLoadingLinked, setIsLoadingLinked] = useState(false);
  const [isLoadingUnassigned, setIsLoadingUnassigned] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setItemNumberDraft(String(row.itemNumber || '').trim().toUpperCase());
    setSelectedRelativePath('');
    setError(null);
    setSuccessMessage(null);
  }, [row]);

  const effectiveItemNumber = useMemo(
    () => String(itemNumberDraft || '').trim().toUpperCase(),
    [itemNumberDraft],
  );

  const syncInventory = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/product-manuals/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to sync manual inventory');
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const loadLinkedManuals = useCallback(async () => {
    if (!effectiveItemNumber) {
      setLinkedManuals([]);
      setLinkedFolderPath('');
      return;
    }

    setIsLoadingLinked(true);
    try {
      const params = new URLSearchParams({
        itemNumber: effectiveItemNumber,
        status: 'assigned',
        limit: '50',
      });
      const res = await fetch(`/api/product-manuals?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load linked manuals');
      }
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setLinkedManuals(rows.map((manual: any) => ({
        ...manual,
        name: String(manual?.file_name || manual?.display_name || manual?.product_title || 'Manual'),
      })));
      setLinkedFolderPath(String(rows[0]?.folder_path || `assigned/${effectiveItemNumber}`));
    } catch (loadError: any) {
      setLinkedManuals([]);
      setLinkedFolderPath('');
      setError(loadError?.message || 'Failed to load linked manuals');
    } finally {
      setIsLoadingLinked(false);
    }
  }, [effectiveItemNumber]);

  const loadUnassignedManuals = useCallback(async () => {
    setIsLoadingUnassigned(true);
    try {
      const params = new URLSearchParams({ status: 'unassigned', limit: '200' });
      const res = await fetch(`/api/product-manuals?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load unassigned manuals');
      }
      const manuals = Array.isArray(data?.rows) ? data.rows : [];
      setUnassignedManuals(manuals.map((manual: any) => ({
        ...manual,
        name: String(manual?.file_name || manual?.display_name || manual?.product_title || 'Manual'),
      })));
      setUnassignedFolderPath('unassigned');
      setSelectedRelativePath((prev) => manuals.some((manual: ProductManualRecord) => manual.relative_path === prev) ? prev : '');
    } catch (loadError: any) {
      setUnassignedManuals([]);
      setUnassignedFolderPath('');
      setError(loadError?.message || 'Failed to load unassigned manuals');
    } finally {
      setIsLoadingUnassigned(false);
    }
  }, []);

  useEffect(() => {
    void loadUnassignedManuals();
  }, [loadUnassignedManuals]);

  useEffect(() => {
    void loadLinkedManuals();
  }, [loadLinkedManuals]);

  useEffect(() => {
    setError(null);
    void (async () => {
      try {
        await syncInventory();
      } catch (syncError: any) {
        setError(syncError?.message || 'Failed to sync manual inventory');
      } finally {
        await Promise.all([loadLinkedManuals(), loadUnassignedManuals()]);
      }
    })();
  }, [row.orderId, syncInventory]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setError(null);
    try {
      await syncInventory();
    } catch (syncError: any) {
      setError(syncError?.message || 'Failed to sync manual inventory');
    } finally {
      await Promise.all([loadLinkedManuals(), loadUnassignedManuals()]);
    }
  };

  const handleAssign = async () => {
    if (!effectiveItemNumber) {
      setError('Enter an item number before assigning a manual.');
      return;
    }
    if (!selectedRelativePath) {
      setError('Select a manual from the unassigned folder first.');
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsAssigning(true);
    try {
      if (!row.itemNumber.trim() && row.dbId) {
        const itemRes = await fetch('/api/orders/set-item-number', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.dbId, item_number: effectiveItemNumber }),
        });
        const itemData = await itemRes.json().catch(() => ({}));
        if (!itemRes.ok || itemData?.success === false) {
          throw new Error(itemData?.error || 'Failed to save the item number to the order');
        }
      }

      const res = await fetch('/api/manual-server/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relativePath: selectedRelativePath,
          itemNumber: effectiveItemNumber,
          productTitle: row.productTitle || null,
          assignedBy: row.orderId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to assign manual');
      }

      setSuccessMessage(`Assigned to ${effectiveItemNumber}`);
      await Promise.all([loadLinkedManuals(), loadUnassignedManuals()]);
      onAssigned(effectiveItemNumber);
    } catch (assignError: any) {
      setError(assignError?.message || 'Failed to assign manual');
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.55 }}
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[520px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-18px_0_40px_rgba(15,23,42,0.12)]"
    >
      <div className="flex items-center justify-between border-b border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="min-w-0">
          <p className="text-[18px] font-black tracking-tight text-gray-900">Update Manuals</p>
          <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">
            {row.orderId || 'Order'} {effectiveItemNumber ? `• Item ${effectiveItemNumber}` : '• Item Number Needed'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isLoadingLinked || isLoadingUnassigned || isAssigning || isSyncing}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
            aria-label="Refresh manual folders"
            title="Refresh manual folders"
          >
            {isLoadingLinked || isLoadingUnassigned || isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50"
            aria-label="Close manual details"
            title="Close manual details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-5">
          <section className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
            <div className="grid gap-3">
              <div>
                <p className={sectionLabel}>Product</p>
                <p className="mt-1 text-sm font-bold text-gray-900">{row.productTitle || 'Unknown product'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className={sectionLabel}>Item Number</span>
                  <input
                    type="text"
                    value={itemNumberDraft}
                    onChange={(event) => {
                      setItemNumberDraft(event.target.value.toUpperCase());
                      setError(null);
                    }}
                    placeholder="Enter item number"
                    className="h-10 rounded-2xl border border-gray-200 bg-white px-3 text-xs font-black uppercase tracking-wider text-gray-900 outline-none transition-colors focus:border-blue-500"
                  />
                </label>
                <div>
                  <p className={sectionLabel}>Tracking</p>
                  <p className="mt-2 truncate rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-gray-700">
                    {row.trackingNumber || 'No tracking'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-red-500" />
              <p className="text-[11px] font-semibold text-red-700">{error}</p>
            </div>
          ) : null}

          {successMessage ? (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <Check className="h-4 w-4 text-emerald-600" />
              <p className="text-[11px] font-semibold text-emerald-700">{successMessage}</p>
            </div>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-900">Linked Folder</p>
                <p className="mt-1 text-[10px] font-semibold text-gray-500">
                  {linkedFolderPath || (effectiveItemNumber ? `assigned/${effectiveItemNumber}` : 'Enter an item number')}
                </p>
              </div>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700">
                {linkedManuals.length} file{linkedManuals.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="space-y-2">
              {isLoadingLinked ? (
                <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[11px] font-semibold text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading linked manuals...
                </div>
              ) : linkedManuals.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-4 text-[11px] font-semibold text-gray-500">
                  No manuals are linked for this item yet.
                </div>
              ) : (
                linkedManuals.map((manual) => (
                  <div key={manual.relative_path || manual.id} className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-xl bg-blue-50 p-2 text-blue-600">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-black tracking-tight text-gray-900">{manual.name}</p>
                        <p className="mt-1 truncate text-[10px] font-semibold text-gray-500">{manual.relative_path || linkedFolderPath}</p>
                        <p className="mt-1 text-[10px] font-semibold text-gray-500">
                          {manual.display_name || manual.product_title || 'Linked manual'}
                          {manual.updated_at ? ` • ${formatDate(manual.updated_at)}` : ''}
                        </p>
                        {manual.source_url ? (
                          <p className="mt-1 truncate text-[10px] font-semibold text-blue-600">{manual.source_url}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="space-y-3 pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-900">Unassigned Uploads</p>
                <p className="mt-1 text-[10px] font-semibold text-gray-500">
                  {unassignedFolderPath || 'unassigned'}
                </p>
              </div>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
                {unassignedManuals.length} waiting
              </span>
            </div>

            <div className="space-y-2">
              {isLoadingUnassigned ? (
                <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[11px] font-semibold text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading unassigned manuals...
                </div>
              ) : unassignedManuals.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-4 text-[11px] font-semibold text-gray-500">
                  No PDFs are waiting in the unassigned folder.
                </div>
              ) : (
                unassignedManuals.map((manual) => {
                  const isSelected = selectedRelativePath === manual.relative_path;
                  return (
                    <button
                      key={manual.relative_path || manual.id}
                      type="button"
                      onClick={() => {
                        setSelectedRelativePath(String(manual.relative_path || ''));
                        setError(null);
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 rounded-xl p-2 ${isSelected ? 'bg-blue-600 text-white' : 'bg-amber-50 text-amber-600'}`}>
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <p className="truncate text-[12px] font-black tracking-tight text-gray-900">{manual.name}</p>
                            {isSelected ? (
                              <span className="rounded-full bg-blue-600 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white">
                                Selected
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-[10px] font-semibold text-gray-500">{manual.relative_path || 'No path'}</p>
                          <p className="mt-1 text-[10px] font-semibold text-gray-500">
                            {manual.display_name || manual.product_title || 'Waiting for assignment'}
                            {manual.updated_at ? ` • ${formatDate(manual.updated_at)}` : ''}
                          </p>
                          {manual.source_url ? (
                            <p className="mt-1 truncate text-[10px] font-semibold text-blue-600">{manual.source_url}</p>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleAssign()}
              disabled={isAssigning || !effectiveItemNumber || !selectedRelativePath}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-[11px] font-black uppercase tracking-[0.22em] text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {isAssigning ? 'Assigning Manual' : 'Assign Selected Manual'}
            </button>
          </section>
          {isSyncing ? (
            <div className="sticky bottom-0 mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] font-semibold text-blue-700">
              Syncing manual inventory from the folder server...
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
