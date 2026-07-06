'use client';

/**
 * PreboxWizard — the "Create prebox label" flow (serial↔label pairing plan
 * §6.4.C). Confirm a serial checklist → choose *one master label for the kit*
 * (creates + seals a label_manifest, prints the master QR) or *one label per
 * unit* (prints each unit's product label). Opened from the receiving carton
 * rollup overflow.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '@/lib/toast';
import { X, Package, Barcode, Loader2, Check } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { getLast4 } from '@/components/ui/CopyChip';
import { printProductLabels } from '@/lib/print/printProductLabel';
import { printManifestLabel } from '@/lib/print/printManifestLabel';

export interface PreboxWizardSerial {
  id: number;
  serial_number: string;
  unit_uid?: string | null;
  sku?: string | null;
}

export function PreboxWizard({
  serials,
  sku,
  onClose,
  onCreated,
}: {
  serials: PreboxWizardSerial[];
  /** Kit SKU when the units are homogeneous; null for a mixed kit. */
  sku?: string | null;
  onClose: () => void;
  /** Called with the sealed manifest_uid so the caller can open its panel. */
  onCreated?: (manifestUid: string) => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(serials.map((s) => s.id)));
  const [mode, setMode] = useState<'master' | 'per-unit'>('master');
  const [busy, setBusy] = useState(false);

  const chosen = serials.filter((s) => checked.has(s.id));

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      if (mode === 'master') {
        const res = await fetch('/api/label-manifests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manifestType: 'PREBOX',
            sku: sku ?? null,
            serialUnitIds: chosen.map((s) => s.id),
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          toast.error(json?.error || `Create failed (${res.status})`);
          return;
        }
        const manifestId = json.manifest.id as number;
        const conflicts: number[] = json.conflicts ?? [];
        const sealRes = await fetch(`/api/label-manifests/${manifestId}/seal`, { method: 'POST' });
        const sealJson = await sealRes.json().catch(() => null);
        if (!sealRes.ok || !sealJson?.ok) {
          toast.error(sealJson?.error || `Seal failed (${sealRes.status})`);
          return;
        }
        printManifestLabel({
          manifestUid: sealJson.manifest_uid,
          unitCount: chosen.length - conflicts.length,
          sku: sku ?? null,
        });
        toast.success(`Sealed ${sealJson.manifest_uid} — printing master label`, {
          description: conflicts.length ? `${conflicts.length} unit(s) skipped (already in a kit)` : undefined,
        });
        onCreated?.(sealJson.manifest_uid);
        onClose();
      } else {
        // Group by the unit's own SKU so a MIXED carton prints correct per-SKU
        // labels (each unit keeps its own unit_uid as the QR payload).
        const bySku = new Map<string, PreboxWizardSerial[]>();
        for (const s of chosen) {
          const k = (s.sku || sku || '').trim();
          if (!k) continue;
          const arr = bySku.get(k) ?? [];
          arr.push(s);
          bySku.set(k, arr);
        }
        for (const [k, group] of bySku) {
          printProductLabels({
            sku: k,
            serialNumbers: group.map((g) => g.serial_number),
            qrPayloads: group.map((g) => g.unit_uid ?? undefined),
          });
        }
        const jobs = chosen
          .filter((s) => s.unit_uid)
          .map((s) => ({
            jobType: 'UNIT' as const,
            serialUnitId: s.id,
            unitUid: s.unit_uid as string,
            qrPayload: s.unit_uid as string,
            templateId: 'product' as const,
          }));
        if (jobs.length) {
          void fetch('/api/label-print-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobs }),
          }).catch(() => {});
        }
        toast.success(`Printing ${chosen.length} unit label${chosen.length === 1 ? '' : 's'}`);
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <div
        role="presentation"
        className="absolute inset-0 bg-scrim/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-xl">
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
          <Package className="h-4 w-4 shrink-0 text-violet-600" />
          <span className="flex-1 text-caption font-bold text-text-default">Create prebox label</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ds-raw-button rounded p-1 text-text-muted hover:bg-surface-canvas"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Template choice */}
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2.5">
          <button
            type="button"
            onClick={() => setMode('master')}
            className={`ds-raw-button flex-1 rounded-lg px-2 py-1.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset transition-colors ${
              mode === 'master'
                ? 'bg-violet-50 text-violet-700 ring-violet-300'
                : 'bg-surface-card text-text-muted ring-border-soft hover:bg-surface-canvas'
            }`}
          >
            One master label
          </button>
          <button
            type="button"
            onClick={() => setMode('per-unit')}
            className={`ds-raw-button flex-1 rounded-lg px-2 py-1.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset transition-colors ${
              mode === 'per-unit'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-300'
                : 'bg-surface-card text-text-muted ring-border-soft hover:bg-surface-canvas'
            }`}
          >
            One label per unit
          </button>
        </div>

        {/* Serial checklist */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {serials.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-muted">
              No serialized units to prebox.
            </div>
          ) : (
            <ul className="divide-y divide-border-soft">
              {serials.map((s) => {
                const on = checked.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      className="ds-raw-button flex w-full items-center gap-2 py-2 text-left"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 ring-inset ${
                          on ? 'bg-blue-500 text-white ring-blue-500' : 'bg-surface-card ring-border-soft'
                        }`}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <Barcode className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span className="font-mono text-caption font-semibold text-text-default">
                        …{getLast4(s.serial_number)}
                      </span>
                      {s.unit_uid ? (
                        <span className="ml-auto truncate font-mono text-eyebrow text-text-soft">{s.unit_uid}</span>
                      ) : (
                        <span className="ml-auto text-eyebrow font-semibold uppercase tracking-widest text-text-muted">
                          not labeled
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border-soft px-4 py-3">
          <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-muted">
            {chosen.length} selected
          </span>
          <Button size="sm" variant="primary" disabled={busy || chosen.length === 0} onClick={() => void run()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {mode === 'master' ? 'Seal + print master' : 'Print unit labels'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
