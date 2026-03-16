'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Pencil } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getAccountSourceLabel, getOrderIdUrl, getTrackingUrl } from '@/utils/order-links';
import { formatDateTimePST, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { useExternalItemUrl } from '@/hooks/useExternalItemUrl';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { DetailsPanelRow } from '@/components/shipped/details-panel/blocks/DetailsPanelRow';

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
  const [displaySerialNumber, setDisplaySerialNumber] = useState(serialNumber || '');
  const [serialRows, setSerialRows] = useState<string[]>(() => parseSerialRows(serialNumber));
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplaySerialNumber(serialNumber || '');
    setSerialRows(parseSerialRows(serialNumber));
    setIsEditing(false);
    setError(null);
  }, [rowId, serialNumber]);

  const handleCancel = () => {
    setSerialRows(parseSerialRows(displaySerialNumber));
    setIsEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!trackingNumber) {
      setError('Tracking number is required to update serials.');
      return;
    }

    const normalizedRows = serialRows
      .map((row) => row.trim().toUpperCase())
      .filter(Boolean);
    const nextSerialNumber = normalizedRows.join(', ');
    const previousSerialNumber = displaySerialNumber;
    const snapshots: Array<{ key: readonly unknown[]; data: any }> = [];

    [['orders'], ['shipped'], ['dashboard-table']].forEach((key) => {
      const matches = queryClient.getQueriesData({ queryKey: key });
      matches.forEach(([queryKey, data]) => {
        snapshots.push({ key: queryKey, data });
        queryClient.setQueryData(queryKey, patchSerialNumberInData(data, rowId, nextSerialNumber));
      });
    });

    setDisplaySerialNumber(nextSerialNumber);
    setSerialRows(normalizedRows.length > 0 ? normalizedRows : ['']);
    setIsEditing(false);
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/tech/update-serials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking: trackingNumber,
          serialNumbers: normalizedRows,
          techId: techId ?? null,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to update serials');
      }

      const savedSerials = Array.isArray(data.serialNumbers)
        ? data.serialNumbers.map((row: unknown) => String(row || '').trim().toUpperCase()).filter(Boolean)
        : normalizedRows;
      const savedSerialNumber = savedSerials.join(', ');

      setDisplaySerialNumber(savedSerialNumber);
      setSerialRows(savedSerials.length > 0 ? savedSerials : ['']);
      [['orders'], ['shipped'], ['dashboard-table']].forEach((key) => {
        const matches = queryClient.getQueriesData({ queryKey: key });
        matches.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, patchSerialNumberInData(data, rowId, savedSerialNumber));
        });
      });
      onUpdate?.();
    } catch (saveError) {
      snapshots.forEach((snapshot) => {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      });
      setDisplaySerialNumber(previousSerialNumber);
      setSerialRows(parseSerialRows(previousSerialNumber));
      setIsEditing(true);
      setError(saveError instanceof Error ? saveError.message : 'Failed to update serials');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-0">
      <CopyableValueFieldBlock
        label="Serial Number"
        value={displaySerialNumber || 'N/A'}
        twoLineValue
        variant="flat"
        keepBottomDivider
        trailingActions={
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isEditing) {
                handleCancel();
              } else {
                setSerialRows(parseSerialRows(displaySerialNumber));
                setIsEditing(true);
                setError(null);
              }
            }}
            className="transition-all text-gray-400 hover:text-gray-900"
            title={isEditing ? 'Cancel serial edit' : 'Edit serial numbers'}
            aria-label={isEditing ? 'Cancel serial edit' : 'Edit serial numbers'}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        }
      />

      {isEditing ? (
        <div className="space-y-2">
          <div className="space-y-1.5">
            {serialRows.map((serial, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={serial}
                  onChange={(e) => {
                    const nextValue = e.target.value.toUpperCase();
                    setSerialRows((current) => current.map((row, rowIndex) => (rowIndex === index ? nextValue : row)));
                  }}
                  placeholder={`Serial ${index + 1}`}
                  className="flex-1 border-0 border-b border-gray-200 bg-transparent px-0 py-2 text-sm font-mono font-bold text-gray-900 outline-none focus:border-gray-400 focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSerialRows((current) => {
                      if (current.length <= 1) return [''];
                      return current.filter((_, rowIndex) => rowIndex !== index);
                    });
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove serial row ${index + 1}`}
                >
                  <span className="text-sm leading-none">x</span>
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSerialRows((current) => [...current, ''])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-700"
            >
              <span className="text-xs leading-none">+</span>
              Add Row
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {isSaving ? 'Saving' : 'Save Serials'}
            </button>
          </div>

          {error ? (
            <p className="text-[10px] font-bold text-red-600">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface ShippingInformationSectionProps {
  shipped: ShippedOrder;
  copiedAll: boolean;
  onCopyAll: () => void;
  onUpdate?: () => void;
  showSerialNumber?: boolean;
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

  return (
    <section className="space-y-3">
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
            <DetailsPanelRow label="Packed By">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-bold text-gray-900">{metaFields.packedByName}</p>
                <p className="shrink-0 font-mono text-sm font-bold text-gray-900">{metaFields.packingDuration}</p>
              </div>
            </DetailsPanelRow>
            <DetailsPanelRow label="Tested By">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-bold text-gray-900">{metaFields.testedByName}</p>
                <p className="shrink-0 font-mono text-sm font-bold text-gray-900">{metaFields.testingDuration}</p>
              </div>
            </DetailsPanelRow>
          </>
        ) : null}

        {editableShippingFields?.isSaving ? (
          <p className="pt-2 text-[10px] font-bold uppercase tracking-wide text-blue-600">Saving shipping updates...</p>
        ) : null}
        {editableShippingFields?.isSavingShipByDate ? (
          <p className="pt-1 text-[10px] font-bold uppercase tracking-wide text-blue-600">Saving ship by date...</p>
        ) : null}
      </div>
    </section>
  );
}
