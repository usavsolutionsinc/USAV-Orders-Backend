'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Edit, Plus, X } from '@/components/Icons';
import { CopyableValueFieldBlock } from './CopyableValueFieldBlock';

interface SerialNumberFieldBlockProps {
  rowId: number;
  trackingNumber: string | null | undefined;
  serialNumber: string | null | undefined;
  techId?: number | null;
  onUpdate?: () => void;
  onSerialNumberChange?: (nextSerialNumber: string) => void;
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
      serialNumber: serialNumber,
    };
  };

  if (Array.isArray(current)) {
    return current.map(patchRow);
  }

  if (Array.isArray(current?.orders)) {
    return { ...current, orders: current.orders.map(patchRow) };
  }

  if (Array.isArray(current?.results)) {
    return { ...current, results: current.results.map(patchRow) };
  }

  if (Array.isArray(current?.shipped)) {
    return { ...current, shipped: current.shipped.map(patchRow) };
  }

  return patchRow(current);
}

export function SerialNumberFieldBlock({
  rowId,
  trackingNumber,
  serialNumber,
  techId = null,
  onUpdate,
  onSerialNumberChange,
}: SerialNumberFieldBlockProps) {
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

  const patchCaches = (nextSerialNumber: string) => {
    const keysToPatch = [['orders'], ['shipped'], ['dashboard-table']];
    const snapshots: Array<{ key: readonly unknown[]; data: any }> = [];

    keysToPatch.forEach((key) => {
      const matches = queryClient.getQueriesData({ queryKey: key });
      matches.forEach(([queryKey, data]) => {
        snapshots.push({ key: queryKey, data });
        queryClient.setQueryData(queryKey, patchSerialNumberInData(data, rowId, nextSerialNumber));
      });
    });

    return snapshots;
  };

  const handleRowChange = (index: number, value: string) => {
    setSerialRows((current) => current.map((row, rowIndex) => (rowIndex === index ? value.toUpperCase() : row)));
  };

  const handleAddRow = () => {
    setSerialRows((current) => [...current, '']);
  };

  const handleRemoveRow = (index: number) => {
    setSerialRows((current) => {
      if (current.length <= 1) return [''];
      return current.filter((_, rowIndex) => rowIndex !== index);
    });
  };

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
    const snapshots = patchCaches(nextSerialNumber);

    setDisplaySerialNumber(nextSerialNumber);
    setSerialRows(normalizedRows.length > 0 ? normalizedRows : ['']);
    setIsEditing(false);
    setIsSaving(true);
    setError(null);
    onSerialNumberChange?.(nextSerialNumber);

    try {
      const response = await fetch('/api/tech/update-serials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking: trackingNumber,
          serialNumbers: normalizedRows,
          techId,
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
      patchCaches(savedSerialNumber);
      onSerialNumberChange?.(savedSerialNumber);
      onUpdate?.();
    } catch (saveError) {
      snapshots.forEach((snapshot) => {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      });
      setDisplaySerialNumber(previousSerialNumber);
      setSerialRows(parseSerialRows(previousSerialNumber));
      setIsEditing(true);
      setError(saveError instanceof Error ? saveError.message : 'Failed to update serials');
      onSerialNumberChange?.(previousSerialNumber);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <CopyableValueFieldBlock
        label="Serial Number"
        value={displaySerialNumber || 'N/A'}
        twoLineValue
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
            className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-300 hover:text-blue-600"
            title={isEditing ? 'Cancel serial edit' : 'Edit serial numbers'}
            aria-label={isEditing ? 'Cancel serial edit' : 'Edit serial numbers'}
          >
            <Edit className="w-3.5 h-3.5" />
          </button>
        }
      />

      {isEditing && (
        <div className="space-y-3">
          <div className="space-y-2">
            {serialRows.map((serial, index) => (
              <div key={`${index}-${serial}`} className="flex items-center gap-2">
                <input
                  type="text"
                  value={serial}
                  onChange={(e) => handleRowChange(index, e.target.value)}
                  placeholder={`Serial ${index + 1}`}
                  className="flex-1 border-0 border-b border-gray-200 bg-transparent px-0 py-2 text-sm font-mono font-bold text-gray-900 outline-none focus:border-gray-400 focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveRow(index)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                  aria-label={`Remove serial row ${index + 1}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleAddRow}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-700"
            >
              <Plus className="w-3 h-3" />
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

          {error && (
            <p className="text-[10px] font-bold text-red-600">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
