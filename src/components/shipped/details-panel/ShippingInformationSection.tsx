'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Clipboard, Copy, ExternalLink, Image as ImageIcon, Pencil, Plus, Trash2, X } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getAccountSourceLabel, getOrderIdUrl, getTrackingUrl } from '@/utils/order-links';
import { formatDateTimePST, getCurrentPSTDateKey, toPSTDateKey, getDaysLateNumber } from '@/utils/date';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { InlineSaveIndicator } from '@/design-system/components';
import { getStaffName } from '@/utils/staff';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import { parseSerialRows, patchSerialNumberInData } from './serial-helpers';
import { useOrderFieldSave } from '@/hooks/useOrderFieldSave';

export interface EditableShippingFields {
  orderNumber: string;
  itemNumber: string;
  trackingNumber: string;
  shipByDate: string;
  isSaving?: boolean;
  isSavingShipByDate?: boolean;
  onOrderNumberChange: (value: string) => void;
  onItemNumberChange: (value: string) => void;
  onTrackingNumberChange: (value: string) => void;
  onShipByDateChange: (value: string) => void;
  onBlur: () => void;
  onShipByDateBlur: () => void;
}

interface ShippingMetaFields {
  packedByName: string;
  packingDuration: string;
  testedByName: string;
  testingDuration: string;
}



function normalizeTrackingList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v || '').trim()).filter(Boolean);
      }
    } catch {}
    return [trimmed];
  }
  return [];
}

type TrackingRow = {
  shipmentId: number | null;
  tracking: string;
  isPrimary: boolean;
};

function normalizeTrackingRows(raw: unknown): TrackingRow[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackingRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as any;
    const tracking = String(item.tracking_number_raw || item.tracking || '').trim();
    if (!tracking) continue;
    const shipmentIdNum = Number(item.shipment_id);
    out.push({
      shipmentId: Number.isFinite(shipmentIdNum) && shipmentIdNum > 0 ? shipmentIdNum : null,
      tracking,
      isPrimary: Boolean(item.is_primary),
    });
  }
  return out;
}

function normalizeShipByDraft(value: string | null | undefined): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^\d{1,2}-\d{1,2}(?:-\d{2,4})?$/.test(trimmed)) return trimmed;
  const pstDateKey = toPSTDateKey(trimmed);
  if (!pstDateKey) return '';
  const [year, month, day] = pstDateKey.split('-').map(Number);
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
}

function parseSerialTextDraft(value: string): string[] {
  return String(value || '')
    .split(/[\n,]+/)
    .map((row) => row.trim().toUpperCase())
    .filter(Boolean);
}

function PasteableDraftInput({
  value,
  onChange,
  onPaste,
  placeholder,
  inputClassName = '',
  ariaLabel,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  onPaste: () => Promise<void>;
  placeholder: string;
  inputClassName?: string;
  ariaLabel: string;
  title: string;
}) {
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white transition-colors focus-within:border-blue-400">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-10 w-full border-0 bg-transparent px-3 pr-10 text-sm font-bold text-gray-900 outline-none ${inputClassName}`}
      />
      <button
        type="button"
        onClick={() => { void onPaste(); }}
        className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-gray-400 transition-all duration-100 ease-out hover:text-blue-600 active:scale-95"
        aria-label={ariaLabel}
        title={title}
      >
        <Clipboard className="h-4 w-4" />
      </button>
    </div>
  );
}


function ShippingEditableRow({
  label,
  value,
  placeholder,
  onChange,
  onBlur,
  externalUrl,
  headerAccessory,
  headerAccessoryClassName,
  allowEdit = true,
  className,
  dividerClassName,
  onPasteReplace,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  externalUrl?: string | null;
  headerAccessory?: string;
  headerAccessoryClassName?: string;
  allowEdit?: boolean;
  className?: string;
  dividerClassName?: string;
  onPasteReplace?: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const displayValue = String(value || '').trim();
  const iconClassName = 'h-3.5 w-3.5';
  const actions = (
    <div className="flex items-center gap-1.5 text-gray-400">
      {onPasteReplace ? (
        <button
          type="button"
          onClick={() => { void onPasteReplace(); }}
          className="transition-colors hover:text-blue-600"
          aria-label={`Paste & replace ${label}`}
          title={`Paste & replace ${label}`}
        >
          <Clipboard className={iconClassName} />
        </button>
      ) : null}
      {externalUrl ? (
        <button
          type="button"
          onClick={() => {
            window.open(externalUrl, '_blank', 'noopener,noreferrer');
          }}
          className="transition-colors hover:text-blue-700"
          aria-label={`Open ${label} in external link`}
          title={`Open ${label}`}
        >
          <ExternalLink className={iconClassName} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (!displayValue) return;
          navigator.clipboard.writeText(displayValue);
        }}
        className="transition-colors hover:text-gray-900"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        <Copy className={iconClassName} />
      </button>
    </div>
  );

  return (
    <DetailsPanelRow
      label={label}
      headerAccessory={headerAccessory ? (
        <span className={headerAccessoryClassName || 'text-[10px] font-black uppercase tracking-wide text-gray-500'}>
          {headerAccessory}
        </span>
      ) : null}
      actions={actions}
      className={className ? `${className} last:border-b-0` : 'last:border-b-0'}
      dividerClassName={dividerClassName}
    >
      {allowEdit && isEditing ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            setIsEditing(false);
            onBlur();
          }}
          placeholder={placeholder}
          autoFocus
          className="h-8 w-full border-0 bg-transparent px-0 text-sm font-bold text-gray-900 outline-none ring-0"
        />
      ) : (
        allowEdit ? (
          <button type="button" onClick={() => setIsEditing(true)} className="block w-full py-0 text-left">
            <p className="truncate text-sm font-bold text-gray-900">{displayValue || placeholder}</p>
          </button>
        ) : (
          <p className="truncate text-sm font-bold text-gray-900">{displayValue || placeholder}</p>
        )
      )}
    </DetailsPanelRow>
  );
}

function ShippingSerialNumberRow({
  rowId,
  trackingNumber,
  serialNumber,
  techId,
  fnskuLogId,
  salId,
  onUpdate,
  allowEdit = true,
}: {
  rowId: number;
  trackingNumber: string | null | undefined;
  serialNumber: string | null | undefined;
  techId?: number | null;
  fnskuLogId?: number | null;
  salId?: number | null;
  onUpdate?: () => void;
  allowEdit?: boolean;
}) {
  const queryClient = useQueryClient();
  const [serialRows, setSerialRows] = useState<string[]>(() => parseSerialRows(serialNumber));
  const serialRowsRef = useRef<string[]>(parseSerialRows(serialNumber));
  const [isEditing, setIsEditing] = useState(false);
  // Mirror isEditing into a ref so effects that must not re-run on every edit
  // can still read the current value without adding isEditing to their deps.
  const isEditingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimerRef = useRef<number | null>(null);
  const skuColonLookupTimerRef = useRef<number | null>(null);
  const skuColonLookupSeqRef = useRef(0);
  const lastSavedSerialNumberRef = useRef(
    parseSerialRows(serialNumber)
      .map((row) => row.trim().toUpperCase())
      .filter(Boolean)
      .join(', ')
  );

  // Keep the ref in sync with state so other effects can read it.
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  useEffect(() => {
    const incoming = parseSerialRows(serialNumber)
      .map((row) => row.trim().toUpperCase())
      .filter(Boolean)
      .join(', ');

    // If the user is actively editing, don't blow away their unsaved changes.
    // Just update the "last saved" baseline so the comparison stays accurate.
    if (isEditingRef.current) {
      lastSavedSerialNumberRef.current = incoming;
      return;
    }

    const parsedRows = parseSerialRows(serialNumber);
    setSerialRows(parsedRows);
    serialRowsRef.current = parsedRows;
    setIsEditing(false);
    setError(null);
    setSaveState('idle');
    lastSavedSerialNumberRef.current = incoming;
  }, [rowId, serialNumber]);

  useEffect(() => {
    if (saveState === 'idle' || saveState === 'saving') return;
    const timeout = window.setTimeout(() => setSaveState('idle'), 1600);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (skuColonLookupTimerRef.current) {
        window.clearTimeout(skuColonLookupTimerRef.current);
      }
    };
  }, []);

  const scheduleSkuColonExpand = (rowIndex: number, rawValue: string) => {
    const trimmed = rawValue.trim().toUpperCase();
    if (!trimmed.includes(':')) return;
    const left = trimmed.split(':')[0]?.trim() ?? '';
    if (!left) return;

    if (skuColonLookupTimerRef.current) {
      window.clearTimeout(skuColonLookupTimerRef.current);
      skuColonLookupTimerRef.current = null;
    }

    const seq = ++skuColonLookupSeqRef.current;
    skuColonLookupTimerRef.current = window.setTimeout(async () => {
      skuColonLookupTimerRef.current = null;
      if (seq !== skuColonLookupSeqRef.current) return;

      try {
        const res = await fetch(`/api/sku/serials-from-code?code=${encodeURIComponent(trimmed)}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          setError(String(data?.error || 'SKU lookup failed'));
          setSaveState('error');
          return;
        }
        const serials = Array.isArray(data.serials)
          ? data.serials.map((s: unknown) => String(s || '').trim().toUpperCase()).filter(Boolean)
          : [];
        if (serials.length === 0) {
          setError('No serials on file for this SKU.');
          setSaveState('error');
          return;
        }
        if (seq !== skuColonLookupSeqRef.current) return;

        if (data.notes) {
          window.alert(`Notes for SKU:\n\n${data.notes}`);
        }

      setSerialRows((current) => {
        const next = [...current];
        next.splice(rowIndex, 1, ...serials);
        serialRowsRef.current = next.length > 0 ? next : [''];
        return next.length > 0 ? next : [''];
      });
        setError(null);
        setSaveState('idle');
      } catch {
        setError('Network error loading SKU serials');
        setSaveState('error');
      }
    }, 400);
  };

  const normalizedRows = serialRows
    .map((row) => row.trim().toUpperCase())
    .filter(Boolean);
  const normalizedSerialNumber = normalizedRows.join(', ');

  const saveSerialRows = async (rowsToSave: string[]): Promise<boolean> => {
    if (!trackingNumber && !fnskuLogId && !salId) {
      setError('Tracking number or scan session is required to update serials.');
      setSaveState('error');
      return false;
    }

    const nextSerialNumber = rowsToSave.join(', ');
    const snapshots: Array<{ key: readonly unknown[]; data: any }> = [];

    [['orders'], ['shipped'], ['dashboard-table']].forEach((key) => {
      const matches = queryClient.getQueriesData({ queryKey: key });
      matches.forEach(([queryKey, data]) => {
        snapshots.push({ key: queryKey, data });
        queryClient.setQueryData(queryKey, patchSerialNumberInData(data, rowId, nextSerialNumber));
      });
    });

    setError(null);
    setSaveState('saving');

    try {
      // Prefer new SAL-based API when salId is available
      const response = salId
        ? await fetch('/api/tech/serial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              salId,
              serials: rowsToSave,
              techId: techId ?? null,
            }),
          })
        : await fetch('/api/tech/update-serials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tracking: trackingNumber || null,
              serialNumbers: rowsToSave,
              techId: techId ?? null,
              fnskuLogId: fnskuLogId ?? null,
            }),
          });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.details || data?.error || 'Failed to update serials');
      }

      const savedSerials = Array.isArray(data.serialNumbers)
        ? data.serialNumbers.map((row: unknown) => String(row || '').trim().toUpperCase()).filter(Boolean)
        : rowsToSave;
      const savedSerialNumber = savedSerials.join(', ');

      setSerialRows(savedSerials.length > 0 ? savedSerials : ['']);
      serialRowsRef.current = savedSerials.length > 0 ? savedSerials : [''];
      lastSavedSerialNumberRef.current = savedSerialNumber;
      setSaveState('saved');
      [['orders'], ['shipped'], ['dashboard-table']].forEach((key) => {
        const matches = queryClient.getQueriesData({ queryKey: key });
        matches.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, patchSerialNumberInData(data, rowId, savedSerialNumber));
        });
      });
      // tech-logs rows use SAL/TSN ids (not order id) so surgical patch by
      // rowId won't hit them — invalidate to force a fresh fetch instead.
      queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
      onUpdate?.();
      return true;
    } catch (saveError) {
      snapshots.forEach((snapshot) => {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      });
      setSaveState('error');
      setError(saveError instanceof Error ? saveError.message : 'Failed to update serials');
      return false;
    }
  };

  useEffect(() => {
    if (!isEditing) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (normalizedSerialNumber === lastSavedSerialNumberRef.current) return;

    // Read from the ref inside the callback so we always save the latest value
    // even if more renders happen before the 700 ms window closes.
    saveTimerRef.current = window.setTimeout(() => {
      const latestRows = serialRowsRef.current
        .map((row) => row.trim().toUpperCase())
        .filter(Boolean);
      void saveSerialRows(latestRows);
    }, 700);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
    // normalizedRows intentionally omitted: it's a new array reference every render
    // and would continuously reset the timer. normalizedSerialNumber (string) is
    // the stable signal; serialRowsRef.current is read inside the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, normalizedSerialNumber, trackingNumber]);

  const copyAllSerials = () => {
    if (!normalizedSerialNumber) return;
    navigator.clipboard.writeText(normalizedSerialNumber);
  };

  return (
    <DetailsPanelRow
      label="Serial Number"
      dividerClassName="border-b border-gray-100"
      className="!border-b !border-gray-100"
      actions={(
        <div className="flex items-center gap-1.5 text-gray-400">
          <InlineSaveIndicator state={saveState} />
          {allowEdit && isEditing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setSerialRows((current) => [...current, '']);
                  serialRowsRef.current = [...serialRowsRef.current, ''];
                  setError(null);
                }}
                className="transition-all hover:text-blue-700"
                aria-label="Add serial row"
                title="Add serial row"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (saveTimerRef.current) {
                    window.clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                  }

                  const latestRows = serialRowsRef.current
                    .map((row) => row.trim().toUpperCase())
                    .filter(Boolean);
                  const latestSerialNumber = latestRows.join(', ');

                  if (latestSerialNumber !== lastSavedSerialNumberRef.current) {
                    const ok = await saveSerialRows(latestRows);
                    if (!ok) return;
                  }

                  setIsEditing(false);
                  setError(null);
                }}
                className="transition-all hover:text-red-600"
                aria-label="Close serial editing"
                title="Close serial editing"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : allowEdit ? (
            <button
              type="button"
              onClick={() => {
                setSerialRows(parseSerialRows(lastSavedSerialNumberRef.current));
                setIsEditing(true);
                setError(null);
              }}
              className="transition-all hover:text-gray-900"
              aria-label="Edit serial numbers"
              title="Edit serial numbers"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={copyAllSerials}
            disabled={!normalizedSerialNumber}
            className="transition-all hover:text-gray-900 disabled:opacity-40"
            aria-label="Copy all serial numbers"
            title="Copy all serial numbers"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    >
      {allowEdit && isEditing ? (
        <div>
          {serialRows.map((serial, index) => (
            <div key={index} className="flex items-center gap-2 border-b border-gray-100 last:border-b-0">
              <input
                type="text"
                value={serial}
                onChange={(e) => {
                  const nextValue = e.target.value.toUpperCase();
                  setSerialRows((current) => {
                    const next = current.map((row, rowIndex) => (rowIndex === index ? nextValue : row));
                    serialRowsRef.current = next;
                    return next;
                  });
                  setError(null);
                  setSaveState('idle');
                  scheduleSkuColonExpand(index, nextValue);
                }}
                placeholder={`Serial ${index + 1} · or SKU:tag`}
                className="flex-1 border-0 bg-transparent px-0 py-1.5 text-sm font-mono font-bold text-gray-900 outline-none focus:ring-0 placeholder:font-dm-sans placeholder:font-normal placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text.trim()) {
                      const nextValue = text.trim().toUpperCase();
                      setSerialRows((current) => {
                        const next = current.map((row, rowIndex) => (rowIndex === index ? nextValue : row));
                        serialRowsRef.current = next;
                        return next;
                      });
                      setError(null);
                      setSaveState('idle');
                      scheduleSkuColonExpand(index, nextValue);
                    }
                  } catch {
                    // noop
                  }
                }}
                className="shrink-0 text-gray-400 transition-colors hover:text-blue-600"
                aria-label={`Paste serial ${index + 1} from clipboard`}
                title="Paste from clipboard"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : allowEdit ? (
        <button
          type="button"
          onClick={() => {
            const rows = parseSerialRows(lastSavedSerialNumberRef.current);
            const initial = rows.length > 0 ? rows : [''];
            setSerialRows(initial);
            serialRowsRef.current = initial;
            setIsEditing(true);
            setError(null);
          }}
          className="block w-full text-left"
        >
          {normalizedRows.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {normalizedRows.map((serial, idx) => (
                <p key={idx} className="truncate py-1 last:pb-0 font-mono text-sm font-bold text-gray-900">{serial}</p>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 py-1">
              <p className="text-sm font-dm-sans font-normal text-gray-400">No serials — click to add</p>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const text = await navigator.clipboard.readText();
                    const pasted = text.trim().toUpperCase();
                    const initial = pasted ? [pasted] : [''];
                    setSerialRows(initial);
                    serialRowsRef.current = initial;
                    setIsEditing(true);
                    setError(null);
                  } catch {
                    setSerialRows(['']);
                    serialRowsRef.current = [''];
                    setIsEditing(true);
                    setError(null);
                  }
                }}
                className="shrink-0 text-gray-400 transition-colors hover:text-blue-600"
                aria-label="Paste serial from clipboard"
                title="Paste from clipboard"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </button>
      ) : (
        normalizedRows.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {normalizedRows.map((serial, idx) => (
              <p key={idx} className="truncate py-1 last:pb-0 font-mono text-sm font-bold text-gray-900">{serial}</p>
            ))}
          </div>
        ) : (
          <p className="py-0.5 text-sm font-dm-sans font-normal text-gray-400">No serials</p>
        )
      )}

      {error ? (
        <p className="pt-1 text-[10px] font-bold text-red-600">{error}</p>
      ) : saveState === 'saved' ? (
        <p className="pt-1 text-[10px] font-bold text-emerald-600">Serial numbers saved.</p>
      ) : null}
    </DetailsPanelRow>
  );
}

export interface PrepackedSkuInfo {
  staticSku: string;
  productTitle?: string | null;
  photos?: string[];
}

function PrepackedSkuRow({ sku }: { sku: PrepackedSkuInfo }) {
  const hasPhotos = Array.isArray(sku.photos) && sku.photos.length > 0;
  const skuBrowserUrl = `/sku-stock?view=sku_history&search=${encodeURIComponent(sku.staticSku)}`;

  return (
    <DetailsPanelRow
      label="From Prepacked SKU"
      actions={
        <button
          type="button"
          onClick={() => {
            window.open(skuBrowserUrl, '_blank', 'noopener,noreferrer');
          }}
          className="text-gray-400 transition-colors hover:text-blue-700"
          aria-label="Open SKU table view"
          title="Open SKU table view"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="space-y-1.5">
        <p className="text-sm font-bold text-black font-mono">{sku.staticSku}</p>
        {sku.productTitle ? (
          <p className="text-[10px] font-semibold text-gray-500 truncate">{sku.productTitle}</p>
        ) : null}
        {hasPhotos && (
          <PhotoGallery
            photos={sku.photos!}
            orderId={sku.staticSku}
            compact
          />
        )}
      </div>
    </DetailsPanelRow>
  );
}

interface ShippingInformationSectionProps {
  shipped: ShippedOrder;
  copiedAll?: boolean;
  onCopyAll?: () => void;
  onUpdate?: () => void;
  showSerialNumber?: boolean;
  showReturnInformation?: boolean;
  showShippingTimestamp?: boolean;
  editableShippingFields?: EditableShippingFields;
  metaFields?: ShippingMetaFields;
  prepackedSku?: PrepackedSkuInfo | null;
}

type TrackingDraftRow = {
  shipmentId: number | null;
  tracking: string;
};

type ShippingInfoEditDraft = {
  shipByDate: string;
  orderNumber: string;
  itemNumber: string;
  trackingRows: TrackingDraftRow[];
  serialRows: string[];
};

function ShippingInfoEditModal({
  open,
  draft,
  setDraft,
  isSaving,
  isSaveSuccess,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  draft: ShippingInfoEditDraft;
  setDraft: (updater: ShippingInfoEditDraft | ((current: ShippingInfoEditDraft) => ShippingInfoEditDraft)) => void;
  isSaving: boolean;
  isSaveSuccess: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="shipping-edit-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={onClose}
        >
          <motion.div
            key="shipping-edit-modal-panel"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="w-full max-w-2xl rounded-3xl border border-gray-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-500">Shipping Info</p>
                <h3 className="mt-1 text-lg font-black tracking-tight text-gray-900">Edit Order Details</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close shipping editor"
                title="Close shipping editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Ship By Date</span>
                  <input
                    type="text"
                    value={draft.shipByDate}
                    onChange={(e) => setDraft((current) => ({ ...current, shipByDate: e.target.value }))}
                    placeholder="MM-DD-YY"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-blue-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Order ID</span>
                  <input
                    type="text"
                    value={draft.orderNumber}
                    onChange={(e) => setDraft((current) => ({ ...current, orderNumber: e.target.value }))}
                    placeholder="Enter order ID"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-900 outline-none transition-colors focus:border-blue-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Item Number</span>
                  <PasteableDraftInput
                    value={draft.itemNumber}
                    onChange={(value) => setDraft((current) => ({ ...current, itemNumber: value }))}
                    onPaste={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (!text.trim()) return;
                        setDraft((current) => ({ ...current, itemNumber: text.trim().toUpperCase() }));
                      } catch {}
                    }}
                    placeholder="Enter item number"
                    ariaLabel="Paste item number"
                    title="Paste item number"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Tracking Numbers</p>
                </div>
                <div className="space-y-2">
                  {draft.trackingRows.map((row, index) => (
                    <div key={`tracking-${row.shipmentId ?? 'new'}-${index}`} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <PasteableDraftInput
                          value={row.tracking}
                          onChange={(value) => {
                            setDraft((current) => ({
                              ...current,
                              trackingRows: current.trackingRows.map((entry, i) =>
                                i === index ? { ...entry, tracking: value } : entry
                              ),
                            }));
                          }}
                          onPaste={async () => {
                            try {
                              const text = await navigator.clipboard.readText();
                              if (!text.trim()) return;
                              const pasted = text.trim().toUpperCase();
                              setDraft((current) => ({
                                ...current,
                                trackingRows: current.trackingRows.map((entry, i) =>
                                  i === index ? { ...entry, tracking: pasted } : entry
                                ),
                              }));
                            } catch {}
                          }}
                          placeholder={`Tracking Number ${index + 1}`}
                          ariaLabel={`Paste tracking number ${index + 1}`}
                          title="Paste tracking number"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft((current) => {
                            const next = current.trackingRows.filter((_, i) => i !== index);
                            return {
                              ...current,
                              trackingRows: next.length > 0 ? next : [{ shipmentId: null, tracking: '' }],
                            };
                          });
                        }}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete tracking number ${index + 1}`}
                        title={`Delete tracking number ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((current) => ({
                        ...current,
                        trackingRows: [...current.trackingRows, { shipmentId: null, tracking: '' }],
                      }));
                    }}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 text-xs font-bold text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600"
                    aria-label="Add tracking number"
                    title="Add tracking number"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Tracking Number
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Serial Numbers</p>
                </div>
                <div className="space-y-2">
                  {(draft.serialRows.length > 0 ? draft.serialRows : ['']).map((row, index) => {
                    const input = (
                      <PasteableDraftInput
                        value={row}
                        onChange={(value) => {
                          setDraft((current) => ({
                            ...current,
                            serialRows: current.serialRows.map((entry, entryIndex) => (
                              entryIndex === index ? value.toUpperCase() : entry
                            )),
                          }));
                        }}
                        onPaste={async () => {
                          try {
                            const text = await navigator.clipboard.readText();
                            if (!text.trim()) return;
                            const pasted = text.trim().toUpperCase();
                            setDraft((current) => ({
                              ...current,
                              serialRows: current.serialRows.length > 0
                                ? current.serialRows.map((entry, entryIndex) => (entryIndex === index ? pasted : entry))
                                : [pasted],
                            }));
                          } catch {}
                        }}
                        placeholder={`Serial ${index + 1}`}
                        inputClassName="font-mono"
                        ariaLabel={`Paste serial ${index + 1}`}
                        title="Paste serial"
                      />
                    );

                    if (index === 0) {
                      return (
                        <div key={`serial-${index}`} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">{input}</div>
                          <button
                            type="button"
                            onClick={() => {
                              setDraft((current) => ({
                                ...current,
                                serialRows: current.serialRows.length > 0 ? [...current.serialRows, ''] : [''],
                              }));
                            }}
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-600 bg-blue-600 text-white transition-colors hover:border-blue-700 hover:bg-blue-700"
                            aria-label="Add serial number"
                            title="Add serial number"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    }

                    return <div key={`serial-${index}`}>{input}</div>;
                  })}
                </div>
              </div>

              {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving || isSaveSuccess}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving || isSaveSuccess}
                className={`relative min-w-[140px] rounded-xl px-4 py-2 text-sm font-bold text-white transition-all duration-200 disabled:opacity-50 ${
                  isSaveSuccess
                    ? 'bg-emerald-600 hover:bg-emerald-600'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <span className="flex items-center justify-center">
                  {isSaveSuccess ? 'Saved' : isSaving ? 'Saving…' : 'Save Changes'}
                </span>
                <span className={`absolute right-4 top-1/2 -translate-y-1/2 transition-all duration-200 ${
                  isSaveSuccess ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                }`}>
                  <Check className="h-4 w-4" />
                </span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

export function ShippingInformationSection({
  shipped,
  copiedAll: _copiedAll,
  onCopyAll: _onCopyAll,
  onUpdate,
  showSerialNumber = true,
  showReturnInformation = true,
  showShippingTimestamp = false,
  editableShippingFields,
  metaFields,
  prepackedSku,
}: ShippingInformationSectionProps) {
  const { getExternalUrlByItemNumber } = useExternalItemUrl();
  const queryClient = useQueryClient();
  const [linkedTrackingDrafts, setLinkedTrackingDrafts] = useState<Record<string, string>>({});
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isEditModalSaving, setIsEditModalSaving] = useState(false);
  const isEditModalSavingRef = useRef(false);
  const [isEditModalSaveSuccess, setIsEditModalSaveSuccess] = useState(false);
  const [editModalError, setEditModalError] = useState<string | null>(null);
  const accountSourceLabel = getAccountSourceLabel(shipped.order_id, shipped.account_source);

  // Internal editable state — used when no editableShippingFields prop is provided
  const orderId = typeof shipped.id === 'number' ? shipped.id : Number(shipped.id);
  const [internalOrderNumber, setInternalOrderNumber] = useState(shipped.order_id || '');
  const [internalItemNumber, setInternalItemNumber] = useState(shipped.item_number || '');
  const [internalTrackingNumber, setInternalTrackingNumber] = useState(shipped.shipping_tracking_number || '');
  const [internalShipByDate, setInternalShipByDate] = useState(String(shipped.ship_by_date || '').trim().split(/[T ]/)[0] || '');
  const internalFieldSave = useOrderFieldSave({
    orderId: Number.isFinite(orderId) && orderId > 0 ? orderId : -1,
    initialOrderNumber: shipped.order_id || '',
    initialItemNumber: shipped.item_number || '',
    initialTrackingNumber: shipped.shipping_tracking_number || '',
    onUpdate,
  });
  const { resetRefs } = internalFieldSave;
  const internalOnBlur = useCallback(() => {
    void internalFieldSave.saveInlineFields(internalOrderNumber, internalItemNumber, internalTrackingNumber);
  }, [internalFieldSave, internalOrderNumber, internalItemNumber, internalTrackingNumber]);
  const [editDraft, setEditDraft] = useState<ShippingInfoEditDraft>({
    shipByDate: '',
    orderNumber: '',
    itemNumber: '',
    trackingRows: [],
    serialRows: [],
  });

  // Sync internal state when shipped record changes
  useEffect(() => {
    const nextOrderNumber = shipped.order_id || '';
    const nextItemNumber = shipped.item_number || '';
    const nextTrackingNumber = shipped.shipping_tracking_number || '';

    setInternalOrderNumber(nextOrderNumber);
    setInternalItemNumber(nextItemNumber);
    setInternalTrackingNumber(nextTrackingNumber);
    setInternalShipByDate(String(shipped.ship_by_date || '').trim().split(/[T ]/)[0] || '');
    resetRefs(nextOrderNumber, nextItemNumber, nextTrackingNumber);
  }, [
    resetRefs,
    shipped.id,
    shipped.item_number,
    shipped.order_id,
    shipped.ship_by_date,
    shipped.shipping_tracking_number,
  ]);

  // Resolve effective editable fields — external prop or internal state
  const ef: EditableShippingFields = editableShippingFields ?? {
    orderNumber: internalOrderNumber,
    itemNumber: internalItemNumber,
    trackingNumber: internalTrackingNumber,
    shipByDate: internalShipByDate,
    isSaving: internalFieldSave.isSavingInlineFields,
    isSavingShipByDate: internalFieldSave.isSavingShipByDate,
    onOrderNumberChange: setInternalOrderNumber,
    onItemNumberChange: setInternalItemNumber,
    onTrackingNumberChange: setInternalTrackingNumber,
    onShipByDateChange: setInternalShipByDate,
    onBlur: internalOnBlur,
    onShipByDateBlur: () => { void internalFieldSave.saveShipByDate(internalShipByDate); },
  };
  const daysLate = getDaysLateNumber(shipped.ship_by_date || shipped.created_at || null);
  const daysLateClassName =
    daysLate > 1
      ? 'text-[10px] font-black uppercase tracking-wide text-red-600'
      : daysLate === 1
        ? 'text-[10px] font-black uppercase tracking-wide text-yellow-600'
        : 'text-[10px] font-black uppercase tracking-wide text-gray-500';
  const shippedAtDisplay =
    shipped.packed_at && shipped.packed_at !== '1'
      ? formatDateTimePST(shipped.packed_at)
      : 'N/A';
  // Packer from actual SAL/packer_logs scan data only — not from work_assignment packer_id
  const packerNameDisplay = String(
    (shipped as any).packed_by_name
    || (shipped as any).packer_name
    || getStaffName((shipped as any).packed_by ?? null)
  ).trim() || 'Not specified';
  const techNameDisplay = String(
    (shipped as any).tester_name
    || (shipped as any).tested_by_name
    || getStaffName((shipped as any).tested_by ?? (shipped as any).tester_id ?? null)
  ).trim() || 'Not specified';
  const serialNumberRows = parseSerialRows(shipped.serial_number)
    .map((row) => row.trim())
    .filter(Boolean);
  // Build a single flat list of ALL tracking numbers for this order.
  // No primary vs secondary distinction — just Tracking 1, 2, 3, etc.
  const allTrackingRows: Array<{ tracking: string; shipmentId: number | null }> = (() => {
    const fromRows = normalizeTrackingRows((shipped as any).tracking_number_rows);
    const seen = new Set<string>();
    const out: Array<{ tracking: string; shipmentId: number | null }> = [];

    // Start with whatever tracking_number_rows the query returned (already
    // includes primary + linked + sibling tracking from the UNION query).
    if (fromRows.length > 0) {
      for (const row of fromRows) {
        const key = normalizeTrackingKey(row.tracking);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ tracking: row.tracking, shipmentId: row.shipmentId });
      }
    }

    // If the query didn't return rows, fall back to the primary tracking field.
    if (out.length === 0) {
      const primary = String(
        editableShippingFields?.trackingNumber ?? shipped.shipping_tracking_number ?? ''
      ).trim();
      if (primary) {
        const primaryShipmentId = shipped.shipment_id != null ? Number(shipped.shipment_id) : null;
        out.push({
          tracking: primary,
          shipmentId: primaryShipmentId != null && Number.isFinite(primaryShipmentId) && primaryShipmentId > 0
            ? primaryShipmentId
            : null,
        });
      }
    }

    return out;
  })();
  const hasRowsAfterItemNumber =
    showSerialNumber
    || Boolean(prepackedSku)
    || Boolean(metaFields?.packedByName)
    || Boolean(metaFields?.testedByName);

  useEffect(() => {
    const next: Record<string, string> = {};
    allTrackingRows.forEach((row, index) => {
      const key = `${row.shipmentId ?? 'none'}:${index}`;
      next[key] = row.tracking;
    });
    setLinkedTrackingDrafts(next);
  }, [JSON.stringify(allTrackingRows.map((row) => [row.shipmentId, row.tracking]))]);

  const saveLinkedTracking = async (shipmentId: number | null, nextTracking: string) => {
    const orderId = Number((shipped as any).id);
    if (!Number.isFinite(orderId) || orderId <= 0) return;
    if (!Number.isFinite(Number(shipmentId)) || Number(shipmentId) <= 0) return;
    const trimmed = String(nextTracking || '').trim();
    if (!trimmed) return;
    try {
      const res = await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          trackingLinkEdits: [
            {
              shipmentId: Number(shipmentId),
              shippingTrackingNumber: trimmed,
            },
          ],
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(String(payload?.details || payload?.error || 'Failed to update tracking'));
      }
      onUpdate?.();
    } catch (error: any) {
      console.error(error);
      throw new Error(error?.message || 'Failed to update tracking');
    }
  };

  const syncOrderExceptions = async () => {
    const res = await fetch('/api/orders-exceptions/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || data?.message || 'Failed to sync orders exceptions');
    }
  };

  const openEditModal = useCallback(() => {
    setEditDraft({
      shipByDate: normalizeShipByDraft(ef.shipByDate),
      orderNumber: ef.orderNumber,
      itemNumber: ef.itemNumber,
      trackingRows: allTrackingRows.length > 0
        ? allTrackingRows.map((row) => ({ shipmentId: row.shipmentId, tracking: row.tracking }))
        : [{ shipmentId: null, tracking: '' }],
      serialRows: serialNumberRows.length > 0 ? serialNumberRows.map((row) => row.toUpperCase()) : [''],
    });
    setEditModalError(null);
    setIsEditModalSaveSuccess(false);
    setIsEditModalOpen(true);
  }, [allTrackingRows, ef.itemNumber, ef.orderNumber, ef.shipByDate, serialNumberRows]);

  const saveSerialRowsFromModal = useCallback(async (serials: string[], trackingOverride?: string) => {
    const trackingNumber = String(trackingOverride || shipped.shipping_tracking_number || '').trim();
    const fnskuLogId = shipped.fnsku_log_id ?? null;
    const salId = shipped.sal_id ?? null;

    if (!trackingNumber && !fnskuLogId && !salId) {
      throw new Error('Tracking number or scan session is required to update serials.');
    }

    const response = salId
      ? await fetch('/api/tech/serial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            salId,
            serials,
            techId: shipped.tested_by ?? shipped.tester_id ?? null,
          }),
        })
      : await fetch('/api/tech/update-serials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracking: trackingNumber || null,
            serialNumbers: serials,
            techId: shipped.tested_by ?? shipped.tester_id ?? null,
            fnskuLogId,
          }),
        });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      throw new Error(data?.details || data?.error || 'Failed to update serials');
    }

    queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
  }, [queryClient, shipped.fnsku_log_id, shipped.sal_id, shipped.shipping_tracking_number, shipped.tested_by, shipped.tester_id]);

  const handleModalSave = useCallback(async () => {
    if (isEditModalSavingRef.current) return;
    isEditModalSavingRef.current = true;
    setIsEditModalSaving(true);
    setIsEditModalSaveSuccess(false);
    setEditModalError(null);
    try {
      const currentOrderId = Number((shipped as any).id);

      // ── 1. Save non-tracking order fields ────────────────────────────────
      // Pass ORIGINAL tracking so saveInlineFields skips the tracking path;
      // tracking is handled entirely through the unified pipeline below.
      await internalFieldSave.saveInlineFields(
        editDraft.orderNumber,
        editDraft.itemNumber,
        ef.trackingNumber,
      );

      if (normalizeShipByDraft(editDraft.shipByDate) !== normalizeShipByDraft(ef.shipByDate)) {
        await internalFieldSave.saveShipByDate(editDraft.shipByDate);
      }

      // ── 2. Diff tracking rows ────────────────────────────────────────────
      //
      // Phase A: Primary tracking (row 0) → always routed through
      //   `shippingTrackingNumber` which calls `upsertOrderTracking` on the
      //   API. This correctly handles shipmentId=null (looks up via
      //   order_shipment_links), updates in place, and creates when needed.
      //
      // Phase B: Additional tracking (rows 1+) → diff into edits/creates/
      //   deletes using shipmentId. Only rows with a valid shipmentId can
      //   be edited or deleted; new rows go through creates.

      const primaryDraftTracking = String(editDraft.trackingRows[0]?.tracking || '').trim();
      const originalPrimaryTracking = String(allTrackingRows[0]?.tracking || '').trim();
      const primaryTrackingChanged = normalizeTrackingKey(primaryDraftTracking) !== normalizeTrackingKey(originalPrimaryTracking);

      // Build map of ALL original rows with valid shipmentIds.
      // Row 0's primary tracking is routed through shippingTrackingNumber (Phase A),
      // but its shipmentId still needs cleanup if deleted.
      const originalById = new Map<number, string>();
      for (const row of allTrackingRows) {
        const sid = Number(row.shipmentId);
        if (Number.isFinite(sid) && sid > 0) {
          originalById.set(sid, String(row.tracking || '').trim());
        }
      }

      const nextSeenIds = new Set<number>();
      const trackingLinkDeletes: Array<{ shipmentId: number }> = [];
      const trackingLinkEdits: Array<{ shipmentId: number; shippingTrackingNumber: string }> = [];
      const trackingLinkCreates: Array<{ shippingTrackingNumber: string }> = [];

      // Build a set of tracking numbers already owned by this order so we
      // can detect moves (e.g. STN 2 pasted into slot 1) and skip them
      // instead of treating them as duplicates.
      const ownedTrackingKeys = new Set(
        allTrackingRows.map((r) => normalizeTrackingKey(r.tracking)).filter(Boolean)
      );

      // Track row 0's shipmentId so the delete loop doesn't double-delete it
      // (Phase A already handles primary cleanup via upsertOrderTracking)
      const row0Sid = Number(editDraft.trackingRows[0]?.shipmentId);
      if (Number.isFinite(row0Sid) && row0Sid > 0) {
        nextSeenIds.add(row0Sid);
      }

      // Phase B: Diff additional rows (index 1+)
      for (let idx = 1; idx < editDraft.trackingRows.length; idx++) {
        const nextRow = editDraft.trackingRows[idx];
        const sid = Number(nextRow.shipmentId);
        const nextTracking = String(nextRow.tracking || '').trim();

        if (Number.isFinite(sid) && sid > 0) {
          nextSeenIds.add(sid);
          if (!nextTracking) {
            trackingLinkDeletes.push({ shipmentId: sid });
            continue;
          }
          const prev = String(originalById.get(sid) || '').trim();
          if (nextTracking !== prev) {
            const nextKey = normalizeTrackingKey(nextTracking);
            const isOwnedElsewhere = nextKey && ownedTrackingKeys.has(nextKey)
              && normalizeTrackingKey(prev) !== nextKey;
            if (!isOwnedElsewhere) {
              trackingLinkEdits.push({ shipmentId: sid, shippingTrackingNumber: nextTracking });
            }
          }
          continue;
        }

        // New row — create, unless the tracking already exists on this order
        if (nextTracking) {
          const nextKey = normalizeTrackingKey(nextTracking);
          if (!nextKey || !ownedTrackingKeys.has(nextKey)) {
            trackingLinkCreates.push({ shippingTrackingNumber: nextTracking });
          }
        }
      }

      // Original additional rows that disappeared from the draft → delete
      for (const sid of originalById.keys()) {
        if (!nextSeenIds.has(sid)) {
          trackingLinkDeletes.push({ shipmentId: sid });
        }
      }

      // Resolve which shipment should be primary after the save
      const draftRow0 = editDraft.trackingRows[0];
      const draftRow0Tracking = normalizeTrackingKey(draftRow0?.tracking);
      const draftRow0ShipmentId = (() => {
        const sid = Number(draftRow0?.shipmentId);
        if (Number.isFinite(sid) && sid > 0) return sid;
        if (!draftRow0Tracking) return null;
        const match = allTrackingRows.find(
          (r) => r.shipmentId != null && normalizeTrackingKey(r.tracking) === draftRow0Tracking
        );
        return match ? Number(match.shipmentId) : null;
      })();

      let trackingChanged = false;
      const hasTrackingChanges =
        primaryTrackingChanged
        || trackingLinkDeletes.length > 0
        || trackingLinkEdits.length > 0
        || trackingLinkCreates.length > 0;

      if (hasTrackingChanges) {
        const res = await fetch('/api/orders/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: currentOrderId,
            // Phase A: primary tracking via upsertOrderTracking (handles null shipmentId)
            ...(primaryTrackingChanged ? { shippingTrackingNumber: primaryDraftTracking || null } : {}),
            // Phase B: additional tracking via link operations
            trackingLinkDeletes,
            trackingLinkEdits,
            trackingLinkCreates,
            setPrimaryShipmentId: draftRow0ShipmentId,
          }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(String(payload?.details || payload?.error || 'Failed to update tracking links'));
        }

        trackingChanged = true;
      }

      // ── 3. Save serial numbers ────────────────────────────────────────────
      const nextSerialRows = editDraft.serialRows
        .map((row) => row.trim().toUpperCase())
        .filter(Boolean);
      const currentSerialRows = serialNumberRows.map((row) => row.trim().toUpperCase()).filter(Boolean);
      const firstDraftTracking = editDraft.trackingRows[0]?.tracking || '';
      if (nextSerialRows.join(', ') !== currentSerialRows.join(', ')) {
        await saveSerialRowsFromModal(nextSerialRows, firstDraftTracking);
      }

      // ── 4. Reflect draft into local component state ───────────────────────
      if (editDraft.orderNumber !== ef.orderNumber) {
        ef.onOrderNumberChange(editDraft.orderNumber);
      }
      if (editDraft.itemNumber !== ef.itemNumber) {
        ef.onItemNumberChange(editDraft.itemNumber);
      }
      if (firstDraftTracking !== ef.trackingNumber) {
        ef.onTrackingNumberChange(firstDraftTracking);
      }
      if (editDraft.shipByDate !== ef.shipByDate) {
        ef.onShipByDateChange(editDraft.shipByDate);
      }

      setLinkedTrackingDrafts(() => {
        const next: Record<string, string> = {};
        editDraft.trackingRows.forEach((row, index) => {
          const key = `${row.shipmentId ?? 'none'}:${index}`;
          next[key] = row.tracking;
        });
        return next;
      });

      setIsEditModalSaveSuccess(true);

      // Bust all cached order views and AWAIT refetch so the parent
      // passes fresh `shipped` data before we close the modal.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['shipped-table'] }),
        queryClient.invalidateQueries({ queryKey: ['shipped-table-fba'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-table'] }),
      ]);

      onUpdate?.();

      await new Promise((resolve) => window.setTimeout(resolve, 400));

      setIsEditModalOpen(false);
      setIsEditModalSaveSuccess(false);

      if (trackingChanged) {
        void syncOrderExceptions().catch((error) => {
          console.error('Background orders exception sync failed:', error);
        });
      }
    } catch (error) {
      setEditModalError(error instanceof Error ? error.message : 'Failed to save shipping details');
    } finally {
      isEditModalSavingRef.current = false;
      setIsEditModalSaving(false);
    }
  }, [
    allTrackingRows,
    editDraft,
    ef,
    internalFieldSave,
    onUpdate,
    queryClient,
    saveSerialRowsFromModal,
    serialNumberRows,
    shipped.id,
    syncOrderExceptions,
  ]);

  return (
    <section className="space-y-6">
      <ShippingInfoEditModal
        open={isEditModalOpen}
        draft={editDraft}
        setDraft={setEditDraft}
        isSaving={isEditModalSaving}
        isSaveSuccess={isEditModalSaveSuccess}
        error={editModalError}
        onClose={() => {
          if (isEditModalSaving || isEditModalSaveSuccess) return;
          setIsEditModalOpen(false);
          setIsEditModalSaveSuccess(false);
          setEditModalError(null);
        }}
        onSave={() => { void handleModalSave(); }}
      />
      {showReturnInformation && shipped.packed_at && shipped.packed_at !== '1' ? (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Return Information</h3>
          <div className="space-y-0">
            <DetailsPanelRow label="Packed">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-bold text-gray-900">{shippedAtDisplay}</p>
                <p className="shrink-0 text-sm font-bold text-gray-900">{packerNameDisplay}</p>
              </div>
            </DetailsPanelRow>
            <DetailsPanelRow label="Serial Numbers">
              {serialNumberRows.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {serialNumberRows.map((serial, idx) => (
                    <p key={idx} className="truncate py-1 last:pb-0 font-mono text-sm font-bold text-gray-900">{serial}</p>
                  ))}
                </div>
              ) : (
                <p className="py-0.5 text-sm font-bold text-gray-400">N/A</p>
              )}
            </DetailsPanelRow>
            <DetailsPanelRow label="Tested By" className="last:border-b-0">
              <p className="text-sm font-bold text-gray-900">{techNameDisplay}</p>
            </DetailsPanelRow>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Shipping Information</h3>
          <button
            type="button"
            onClick={openEditModal}
            className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Edit shipping information"
            title="Edit shipping information"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-0">
          {showShippingTimestamp && (
            <DetailsPanelRow label="Shipped">
              <p className="text-sm font-bold text-gray-900">
                {shipped.packed_at && shipped.packed_at !== '1'
                  ? formatDateTimePST(shipped.packed_at)
                  : 'N/A'}
              </p>
            </DetailsPanelRow>
          )}

          <ShippingEditableRow
            label="Ship By Date"
            headerAccessory={String(daysLate)}
            headerAccessoryClassName={daysLateClassName}
            value={ef.shipByDate}
            placeholder="MM-DD-YY"
            onChange={ef.onShipByDateChange}
            onBlur={ef.onShipByDateBlur}
            allowEdit={false}
          />
          {allTrackingRows.length > 0 ? allTrackingRows.map((row, index) => {
            const draftKey = `${row.shipmentId ?? 'none'}:${index}`;
            const draftValue = linkedTrackingDrafts[draftKey] ?? row.tracking;
            return (
              <ShippingEditableRow
                key={`tracking-${index}-${row.shipmentId ?? 'none'}`}
                label={`Tracking Number${allTrackingRows.length > 1 ? ` ${index + 1}` : ''}`}
                value={draftValue}
                placeholder="Enter tracking number"
                onChange={(value) => {
                  setLinkedTrackingDrafts((prev) => ({ ...prev, [draftKey]: value }));
                  if (index === 0) ef.onTrackingNumberChange(value);
                }}
                onBlur={() => {
                  if (index === 0) {
                    void internalFieldSave.saveInlineFields(ef.orderNumber, ef.itemNumber, draftValue);
                  } else {
                    void saveLinkedTracking(row.shipmentId, draftValue);
                  }
                }}
                externalUrl={getTrackingUrl(draftValue)}
                allowEdit={false}
                onPasteReplace={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    const pasted = String(text || '').trim();
                    if (!pasted) return;
                    setLinkedTrackingDrafts((prev) => ({ ...prev, [draftKey]: pasted }));
                    if (index === 0) {
                      ef.onTrackingNumberChange(pasted);
                      await internalFieldSave.saveInlineFields(ef.orderNumber, ef.itemNumber, pasted);
                    } else {
                      await saveLinkedTracking(row.shipmentId, pasted);
                    }
                  } catch {}
                }}
              />
            );
          }) : (
            <ShippingEditableRow
              label="Tracking Number"
              value=""
              placeholder="No tracking number"
              onChange={() => {}}
              onBlur={() => {}}
              allowEdit={false}
            />
          )}
          <ShippingEditableRow
            label="Order ID"
            value={ef.orderNumber}
            placeholder="Enter order ID"
            onChange={ef.onOrderNumberChange}
            onBlur={ef.onBlur}
            externalUrl={getOrderIdUrl(ef.orderNumber)}
            headerAccessory={accountSourceLabel || undefined}
            headerAccessoryClassName="text-[10px] font-black tracking-wide text-blue-600"
            allowEdit={false}
          />
          <ShippingEditableRow
            label="Item Number"
            value={ef.itemNumber}
            placeholder="Enter item number"
            onChange={ef.onItemNumberChange}
            onBlur={ef.onBlur}
            externalUrl={getExternalUrlByItemNumber(ef.itemNumber)}
            dividerClassName="border-b-0"
            className={hasRowsAfterItemNumber ? '!border-b-0' : '!border-b-0 pb-0'}
            allowEdit={false}
          />

          {showSerialNumber ? (
            <ShippingSerialNumberRow
              rowId={shipped.id}
              trackingNumber={shipped.shipping_tracking_number}
              serialNumber={shipped.serial_number}
              techId={shipped.tested_by ?? shipped.tester_id ?? null}
              fnskuLogId={shipped.fnsku_log_id ?? null}
              salId={shipped.sal_id ?? null}
              onUpdate={onUpdate}
              allowEdit={false}
            />
          ) : null}

          {prepackedSku ? <PrepackedSkuRow sku={prepackedSku} /> : null}

          {metaFields ? (
            <>
              {metaFields.packedByName ? (
                <DetailsPanelRow label="Packed By">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-bold text-gray-900">{metaFields.packedByName}</p>
                    <p className="shrink-0 font-mono text-sm font-bold text-gray-900">{metaFields.packingDuration}</p>
                  </div>
                </DetailsPanelRow>
              ) : null}
              {metaFields.testedByName ? (
                <DetailsPanelRow label="Tested By">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-bold text-gray-900">{metaFields.testedByName}</p>
                    <p className="shrink-0 font-mono text-sm font-bold text-gray-900">{metaFields.testingDuration}</p>
                  </div>
                </DetailsPanelRow>
              ) : null}
            </>
          ) : null}

          {ef.isSaving ? (
            <p className="pt-2 text-[10px] font-bold uppercase tracking-wide text-blue-600">Saving shipping updates...</p>
          ) : null}
          {ef.isSavingShipByDate ? (
            <p className="pt-1 text-[10px] font-bold uppercase tracking-wide text-blue-600">Saving ship by date...</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
