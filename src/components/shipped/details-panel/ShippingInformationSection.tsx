'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Pencil, Plus, X } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getAccountSourceLabel, getOrderIdUrl, getTrackingUrl } from '@/utils/order-links';
import { formatDateTimePST, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { DetailsPanelRow } from '@/components/shipped/details-panel/blocks/DetailsPanelRow';
import { InlineSaveIndicator } from '@/design-system/components';
import { getStaffName } from '@/utils/staff';

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

function getDaysLateNumber(deadlineAt: string | null | undefined): number {
  const deadlineKey = toPSTDateKey(deadlineAt);
  if (!deadlineKey) return 0;
  const todayKey = getCurrentPSTDateKey();
  if (!todayKey) return 0;
  const [dy, dm, dd] = deadlineKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const deadlineIndex = Math.floor(Date.UTC(dy, dm - 1, dd) / 86400000);
  const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - deadlineIndex);
}

function parseSerialRows(value: string | null | undefined): string[] {
  const rows = String(value || '')
    .split(',')
    .map((serial) => serial.trim())
    .filter(Boolean);

  return rows.length > 0 ? rows : [''];
}

function patchSerialNumberInData(current: any, rowId: number, serialNumber: string): any {
  if (!current) return current;

  const patchRow = (row: any) => {
    if (!row || Number(row.id) !== rowId) return row;
    return {
      ...row,
      serial_number: serialNumber,
      serialNumber,
    };
  };

  if (Array.isArray(current)) return current.map(patchRow);
  if (Array.isArray(current?.orders)) return { ...current, orders: current.orders.map(patchRow) };
  if (Array.isArray(current?.results)) return { ...current, results: current.results.map(patchRow) };
  if (Array.isArray(current?.shipped)) return { ...current, shipped: current.shipped.map(patchRow) };

  return patchRow(current);
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
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  externalUrl?: string | null;
  headerAccessory?: string;
  headerAccessoryClassName?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const displayValue = String(value || '').trim();
  const iconClassName = 'h-3.5 w-3.5';
  const actions = (
    <div className="flex items-center gap-1.5 text-gray-400">
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
        onClick={() => setIsEditing((prev) => !prev)}
        className="transition-colors hover:text-gray-900"
        aria-label={`Edit ${label}`}
        title={`Edit ${label}`}
      >
        <Pencil className={iconClassName} />
      </button>
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
      className="last:border-b-0"
    >
      {isEditing ? (
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
        <button type="button" onClick={() => setIsEditing(true)} className="block w-full py-0 text-left">
          <p className="truncate text-sm font-bold text-gray-900">{displayValue || placeholder}</p>
        </button>
      )}
    </DetailsPanelRow>
  );
}

function ShippingSerialNumberRow({
  rowId,
  trackingNumber,
  serialNumber,
  techId,
  onUpdate,
}: {
  rowId: number;
  trackingNumber: string | null | undefined;
  serialNumber: string | null | undefined;
  techId?: number | null;
  onUpdate?: () => void;
}) {
  const queryClient = useQueryClient();
  const [serialRows, setSerialRows] = useState<string[]>(() => parseSerialRows(serialNumber));
  const [isEditing, setIsEditing] = useState(false);
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

  useEffect(() => {
    setSerialRows(parseSerialRows(serialNumber));
    setIsEditing(false);
    setError(null);
    setSaveState('idle');
    lastSavedSerialNumberRef.current = parseSerialRows(serialNumber)
      .map((row) => row.trim().toUpperCase())
      .filter(Boolean)
      .join(', ');
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

  const saveSerialRows = async (rowsToSave: string[]) => {
    if (!trackingNumber) {
      setError('Tracking number is required to update serials.');
      setSaveState('error');
      return;
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
      const response = await fetch('/api/tech/update-serials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking: trackingNumber,
          serialNumbers: rowsToSave,
          techId: techId ?? null,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to update serials');
      }

      const savedSerials = Array.isArray(data.serialNumbers)
        ? data.serialNumbers.map((row: unknown) => String(row || '').trim().toUpperCase()).filter(Boolean)
        : rowsToSave;
      const savedSerialNumber = savedSerials.join(', ');

      setSerialRows(savedSerials.length > 0 ? savedSerials : ['']);
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
    } catch (saveError) {
      snapshots.forEach((snapshot) => {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      });
      setSaveState('error');
      setError(saveError instanceof Error ? saveError.message : 'Failed to update serials');
    }
  };

  useEffect(() => {
    if (!isEditing) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (normalizedSerialNumber === lastSavedSerialNumberRef.current) return;

    saveTimerRef.current = window.setTimeout(() => {
      void saveSerialRows(normalizedRows);
    }, 700);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [isEditing, normalizedRows, normalizedSerialNumber, trackingNumber]);

  const copyAllSerials = () => {
    if (!normalizedSerialNumber) return;
    navigator.clipboard.writeText(normalizedSerialNumber);
  };

  return (
    <DetailsPanelRow
      label="Serial Number"
      actions={(
        <div className="flex items-center gap-1.5 text-gray-400">
          <InlineSaveIndicator state={saveState} />
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setSerialRows((current) => [...current, '']);
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
                onClick={() => {
                  setSerialRows(parseSerialRows(lastSavedSerialNumberRef.current));
                  setIsEditing(false);
                  setError(null);
                  setSaveState('idle');
                }}
                className="transition-all hover:text-red-600"
                aria-label="Close serial editing"
                title="Close serial editing"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
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
          )}
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
      dividerClassName="border-b border-gray-100"
      className="!border-b !border-gray-100"
    >
      {isEditing ? (
        <div>
          {serialRows.map((serial, index) => (
            <div key={index} className="flex items-center gap-2 border-b border-gray-100 last:border-b-0">
              <input
                type="text"
                value={serial}
                onChange={(e) => {
                  const nextValue = e.target.value.toUpperCase();
                  setSerialRows((current) => current.map((row, rowIndex) => (rowIndex === index ? nextValue : row)));
                  setError(null);
                  setSaveState('idle');
                  scheduleSkuColonExpand(index, nextValue);
                }}
                placeholder={`Serial ${index + 1} · or SKU:tag`}
                className="flex-1 border-0 bg-transparent px-0 py-2 text-sm font-mono font-bold text-gray-900 outline-none focus:ring-0"
              />
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setSerialRows(parseSerialRows(lastSavedSerialNumberRef.current));
            setIsEditing(true);
            setError(null);
          }}
          className="block w-full py-0 text-left"
        >
          <p className="truncate py-2 text-sm font-mono font-bold text-gray-900">
            {normalizedSerialNumber || 'Serial 1'}
          </p>
        </button>
      )}

      {error ? (
        <p className="pt-1 text-[10px] font-bold text-red-600">{error}</p>
      ) : null}
    </DetailsPanelRow>
  );
}

interface ShippingInformationSectionProps {
  shipped: ShippedOrder;
  copiedAll: boolean;
  onCopyAll: () => void;
  onUpdate?: () => void;
  showSerialNumber?: boolean;
  showReturnInformation?: boolean;
  showShippingTimestamp?: boolean;
  editableShippingFields?: EditableShippingFields;
  metaFields?: ShippingMetaFields;
}

export function ShippingInformationSection({
  shipped,
  copiedAll,
  onCopyAll,
  onUpdate,
  showSerialNumber = true,
  showReturnInformation = true,
  showShippingTimestamp = false,
  editableShippingFields,
  metaFields,
}: ShippingInformationSectionProps) {
  const { getExternalUrlByItemNumber } = useExternalItemUrl();
  const accountSourceLabel = getAccountSourceLabel(shipped.order_id, shipped.account_source);
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
  const packerNameDisplay = String(
    (shipped as any).packed_by_name
    || (shipped as any).packer_name
    || getStaffName((shipped as any).packed_by ?? (shipped as any).packer_id ?? null)
  ).trim() || 'Not specified';
  const techNameDisplay = String(
    (shipped as any).tester_name
    || (shipped as any).tested_by_name
    || getStaffName((shipped as any).tested_by ?? (shipped as any).tester_id ?? null)
  ).trim() || 'Not specified';
  const serialNumbersDisplay = parseSerialRows(shipped.serial_number)
    .map((row) => row.trim())
    .filter(Boolean)
    .join(', ') || 'N/A';

  return (
    <section className="space-y-6">
      {showReturnInformation ? (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Return Information</h3>
          <div className="space-y-0">
            <DetailsPanelRow label="Shipment / Packer">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-bold text-gray-900">{shippedAtDisplay}</p>
                <p className="shrink-0 text-sm font-bold text-gray-900">{packerNameDisplay}</p>
              </div>
            </DetailsPanelRow>
            <DetailsPanelRow label="Serial Numbers">
              <p className="break-all py-0.5 text-sm font-mono font-bold text-gray-900">{serialNumbersDisplay}</p>
            </DetailsPanelRow>
            <DetailsPanelRow label="Tech Name" className="last:border-b-0">
              <p className="text-sm font-bold text-gray-900">{techNameDisplay}</p>
            </DetailsPanelRow>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">Shipping Information</h3>
          <button
            onClick={onCopyAll}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-white transition-all hover:bg-blue-700 hover:shadow-md active:scale-95"
            aria-label="Copy all shipping information"
          >
            {copiedAll ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-wider">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-wider">Copy</span>
              </>
            )}
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

          {editableShippingFields ? (
            <>
              <ShippingEditableRow
                label="Ship By Date"
                headerAccessory={String(daysLate)}
                headerAccessoryClassName={daysLateClassName}
                value={editableShippingFields.shipByDate}
                placeholder="MM-DD-YY"
                onChange={editableShippingFields.onShipByDateChange}
                onBlur={editableShippingFields.onShipByDateBlur}
              />
              <ShippingEditableRow
                label="Tracking Number"
                value={editableShippingFields.trackingNumber}
                placeholder="Enter tracking number"
                onChange={editableShippingFields.onTrackingNumberChange}
                onBlur={editableShippingFields.onBlur}
                externalUrl={getTrackingUrl(editableShippingFields.trackingNumber)}
              />
              <ShippingEditableRow
                label="Order ID"
                value={editableShippingFields.orderNumber}
                placeholder="Enter order ID"
                onChange={editableShippingFields.onOrderNumberChange}
                onBlur={editableShippingFields.onBlur}
                externalUrl={getOrderIdUrl(editableShippingFields.orderNumber)}
                headerAccessory={accountSourceLabel || undefined}
                headerAccessoryClassName="text-[10px] font-black tracking-wide text-blue-600"
              />
              <ShippingEditableRow
                label="Item Number"
                value={editableShippingFields.itemNumber}
                placeholder="Enter item number"
                onChange={editableShippingFields.onItemNumberChange}
                onBlur={editableShippingFields.onBlur}
                externalUrl={getExternalUrlByItemNumber(editableShippingFields.itemNumber)}
              />
            </>
          ) : (
            <>
              <CopyableValueFieldBlock
                label="Ship By Date"
                value={String(shipped.ship_by_date || '').trim() || 'N/A'}
                headerAccessory={<span className={daysLateClassName}>{daysLate}</span>}
                variant="flat"
              />
              <CopyableValueFieldBlock
                label="Tracking Number"
                value={shipped.shipping_tracking_number || 'Not available'}
                externalUrl={getTrackingUrl(shipped.shipping_tracking_number || '')}
                externalLabel="Open shipment tracking in new tab"
                variant="flat"
              />
              <CopyableValueFieldBlock
                label="Order ID"
                value={shipped.order_id || 'Not available'}
                externalUrl={getOrderIdUrl(shipped.order_id)}
                externalLabel={/^\d{3}-\d+-\d+$/.test(shipped.order_id) ? 'Open Amazon order in Seller Central in new tab' : 'Open Ecwid order in new tab'}
                headerAccessory={accountSourceLabel ? <span className="text-[10px] font-black tracking-wide text-blue-600">{accountSourceLabel}</span> : null}
                variant="flat"
              />
              <CopyableValueFieldBlock
                label="Item Number"
                value={shipped.item_number || 'N/A'}
                externalUrl={getExternalUrlByItemNumber(shipped.item_number)}
                externalLabel="Open product page in new tab"
                variant="flat"
              />
            </>
          )}

          {showSerialNumber ? (
            <ShippingSerialNumberRow
              rowId={shipped.id}
              trackingNumber={shipped.shipping_tracking_number}
              serialNumber={shipped.serial_number}
              techId={shipped.tested_by ?? shipped.tester_id ?? null}
              onUpdate={onUpdate}
            />
          ) : null}

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

          {editableShippingFields?.isSaving ? (
            <p className="pt-2 text-[10px] font-bold uppercase tracking-wide text-blue-600">Saving shipping updates...</p>
          ) : null}
          {editableShippingFields?.isSavingShipByDate ? (
            <p className="pt-1 text-[10px] font-bold uppercase tracking-wide text-blue-600">Saving ship by date...</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
