'use client';

/**
 * ManifestWorkbenchPanel — desktop detail for a preboxed KIT manifest, opened in
 * the shared right-rail drawer when an operator scans a `KIT-…` master label at
 * the testing bench (serial↔label pairing plan §5.2). Lists the child units with
 * line attribution and lets the operator combine (scan-in add), split (remove /
 * dissolve), seal, and reprint the master — over the existing manifest APIs.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { X, Package, Printer, Loader2, Check, Trash2 } from '@/components/Icons';
import { IconButton, Button } from '@/design-system/primitives';
import { getLast4 } from '@/components/ui/CopyChip';
import { unitStatusBadgeTone } from '@/components/station/receiving-constants';
import { conditionLabel } from '@/lib/conditions';
import { printManifestLabel } from '@/lib/print/printManifestLabel';
import { useManifestDetail } from '@/hooks/useManifestDetail';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

const MANIFEST_STATUS_TONE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-800',
  SEALED: 'bg-emerald-100 text-emerald-700',
  DISSOLVED: 'bg-surface-sunken text-text-muted',
};

export function ManifestWorkbenchPanel({
  manifestRef,
  onClose,
  lines,
}: {
  manifestRef: string | number;
  onClose: () => void;
  /** The scan's receiving lines — used to label each unit's origin line. */
  lines?: ReceivingLineRow[];
}) {
  const { data, isLoading, isError, error, refetch } = useManifestDetail(manifestRef);
  const manifest = data?.manifest ?? null;
  const [addInput, setAddInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lineTitleById = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of lines ?? []) {
      if (typeof l.id === 'number') m.set(l.id, l.item_name || l.sku || `Line #${l.id}`);
    }
    return m;
  }, [lines]);

  const manifestId = manifest?.id ?? null;
  const status = manifest?.status ?? 'OPEN';
  const isOpen = status === 'OPEN';

  const submitAdd = useCallback(async () => {
    const ref = addInput.trim();
    if (!ref || busy || manifestId == null) return;
    // Resolve the scanned serial/uid → serial_unit_id, then add to the manifest.
    setBusy('add');
    try {
      const rb = await fetch('/api/serial-units/resolve-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serials: [ref] }),
      });
      const rbJson = (await rb.json().catch(() => null)) as {
        units?: Array<{ serial_unit_id: number | null }>;
      } | null;
      const serialUnitId = rbJson?.units?.[0]?.serial_unit_id ?? null;
      if (!serialUnitId) {
        toast.error(`Couldn't find a unit for "${ref}"`);
        return;
      }
      const res = await fetch(`/api/label-manifests/${manifestId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialUnitIds: [serialUnitId] }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        toast.error(json?.error || `Add failed (${res.status})`);
        return;
      }
      if ((json.conflicts ?? []).length > 0) {
        toast.error('That unit is already in another live manifest.');
      }
      setAddInput('');
      await refetch();
      inputRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add request failed');
    } finally {
      setBusy(null);
    }
  }, [addInput, busy, manifestId, refetch]);

  const removeUnit = useCallback(
    async (serialUnitId: number) => {
      if (busy || manifestId == null) return;
      setBusy('remove');
      try {
        const res = await fetch(`/api/label-manifests/${manifestId}/items/${serialUnitId}`, {
          method: 'DELETE',
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          toast.error(json?.error || `Remove failed (${res.status})`);
          return;
        }
        await refetch();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Remove request failed');
      } finally {
        setBusy(null);
      }
    },
    [busy, manifestId, refetch],
  );

  const seal = useCallback(async () => {
    if (busy || manifestId == null) return;
    setBusy('seal');
    try {
      const res = await fetch(`/api/label-manifests/${manifestId}/seal`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        toast.error(json?.error || `Seal failed (${res.status})`);
        return;
      }
      printManifestLabel({
        manifestUid: json.manifest_uid,
        unitCount: manifest?.items.length ?? 0,
        sku: manifest?.sku ?? null,
      });
      toast.success('Sealed — printing master label');
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Seal request failed');
    } finally {
      setBusy(null);
    }
  }, [busy, manifestId, manifest, refetch]);

  const dissolve = useCallback(async () => {
    if (busy || manifestId == null) return;
    setBusy('dissolve');
    try {
      const res = await fetch(`/api/label-manifests/${manifestId}/dissolve`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        toast.error(json?.error || `Dissolve failed (${res.status})`);
        return;
      }
      toast.success('Kit dissolved — units freed');
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dissolve request failed');
    } finally {
      setBusy(null);
    }
  }, [busy, manifestId, refetch]);

  const items = manifest?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
        <Package className="h-4 w-4 shrink-0 text-violet-600" />
        <span className="min-w-0 flex-1 truncate font-mono text-caption font-bold text-text-default">
          {manifest?.manifest_uid || String(manifestRef)}
        </span>
        {manifest ? (
          <span
            className={`rounded-full px-2 py-0.5 text-eyebrow font-black uppercase tracking-widest ${MANIFEST_STATUS_TONE[status] ?? 'bg-surface-sunken text-text-muted'}`}
          >
            {status}
          </span>
        ) : null}
        <IconButton
          ariaLabel="Print master label"
          icon={<Printer className="h-4 w-4" />}
          disabled={!manifest}
          onClick={() =>
            manifest &&
            printManifestLabel({
              manifestUid: manifest.manifest_uid,
              unitCount: manifest.items.length,
              sku: manifest.sku,
            })
          }
        />
        <IconButton ariaLabel="Close manifest panel" icon={<X className="h-4 w-4" />} onClick={onClose} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2">
        <span className="text-caption font-bold text-text-muted">
          {items.length} unit{items.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {isOpen ? (
            <Button size="sm" variant="primary" disabled={busy != null || items.length === 0} onClick={() => void seal()}>
              <Check className="h-3.5 w-3.5" /> Seal
            </Button>
          ) : null}
          {status !== 'DISSOLVED' ? (
            <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => void dissolve()}>
              <Trash2 className="h-3.5 w-3.5" /> Dissolve
            </Button>
          ) : null}
        </div>
      </div>

      {/* Scan-in add (only while OPEN) */}
      {isOpen ? (
        <div className="border-b border-border-soft px-4 py-2">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitAdd();
                }
              }}
              placeholder="Scan a serial to add to the kit…"
              className="min-w-0 flex-1 rounded-lg border border-border-soft bg-surface-card px-2.5 py-1.5 font-mono text-caption text-text-default outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
            {busy === 'add' ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" /> : null}
          </div>
        </div>
      ) : null}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-caption text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading manifest…
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption text-rose-700">
            {error instanceof Error ? error.message : 'Could not load this manifest.'}
          </div>
        ) : !manifest || items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-muted">
            No units in this kit yet. Scan a serial above to add one.
          </div>
        ) : (
          <ul className="divide-y divide-border-soft">
            {items.map((u) => {
              const lineTitle =
                u.origin_receiving_line_id != null
                  ? lineTitleById.get(u.origin_receiving_line_id) ?? `Line #${u.origin_receiving_line_id}`
                  : null;
              return (
                <li key={u.serial_unit_id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-caption font-semibold text-text-default">
                        …{getLast4(u.serial_number)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${unitStatusBadgeTone(u.current_status)}`}
                      >
                        {u.current_status}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                      {u.sku || '—'}
                      {u.condition_grade ? ` · ${conditionLabel(u.condition_grade, 'compact')}` : ''}
                      {lineTitle ? ` · ${lineTitle}` : ''}
                    </div>
                  </div>
                  {isOpen ? (
                    <IconButton
                      ariaLabel="Remove from kit"
                      icon={<X className="h-4 w-4" />}
                      disabled={busy != null}
                      onClick={() => void removeUnit(u.serial_unit_id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
