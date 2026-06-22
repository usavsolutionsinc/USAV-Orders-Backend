'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  dispatchManualsUpdated,
  ErrorBanner,
  FieldLabel,
  inputClass,
  ModalShell,
  PrimaryButton,
  SecondaryButton,
  selectClass,
  TYPE_OPTIONS,
} from './manual-crud-shared';

// ─── Edit metadata ─────────────────────────────────────────────────────────

export interface EditManualTarget {
  id: number;
  displayName: string | null;
  folderPath: string | null;
  type: string | null;
  status: string;
  sku: string | null;
  itemNumber: string | null;
}

interface EditManualModalProps {
  open: boolean;
  onClose: () => void;
  target: EditManualTarget | null;
}

export function EditManualModal({ open, onClose, target }: EditManualModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [type, setType] = useState('');
  const [sku, setSku] = useState('');
  const [itemNumber, setItemNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    setDisplayName(target.displayName ?? '');
    setType(target.type ?? '');
    setSku(target.sku ?? '');
    setItemNumber(target.itemNumber ?? '');
    setError(null);
    setBusy(false);
  }, [open, target]);

  const submit = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      // Folder path + status are intentionally omitted from this payload —
      // folder lives in the sidebar's rename flow, status is derived from
      // assignment state and not edited inline here.
      const res = await fetch('/api/product-manuals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: target.id,
          displayName: displayName.trim() || null,
          type: type || null,
          sku: sku.trim() || null,
          itemNumber: itemNumber.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      dispatchManualsUpdated();
      toast.success(`Saved “${displayName.trim() || target.displayName || `Manual #${target.id}`}”`);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [target, displayName, type, sku, itemNumber, onClose]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      eyebrow="Edit Manual"
      title={target?.displayName || 'Manual details'}
      busy={busy}
      footer={
        <>
          <SecondaryButton disabled={busy} onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton busy={busy} onClick={submit}>Save</PrimaryButton>
        </>
      }
    >
      <ErrorBanner message={error} />

      <div>
        <FieldLabel>Display Name</FieldLabel>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <FieldLabel>Type</FieldLabel>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>SKU</FieldLabel>
          <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
        </div>
        <div>
          <FieldLabel>Item Number</FieldLabel>
          <input
            type="text"
            value={itemNumber}
            onChange={(e) => setItemNumber(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
    </ModalShell>
  );
}
