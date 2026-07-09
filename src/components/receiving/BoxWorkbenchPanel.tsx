'use client';

/**
 * BoxWorkbenchPanel — desktop parity with the mobile box page (`/m/h/[id]`).
 *
 * Opens in the shared right-rail drawer (`RightRailHost` via
 * `DetailStackRailRegistrar`) when an operator scans an H-#### license plate at
 * the testing bench. Lets them re-sort units across lines into/out of the box
 * WITHOUT reaching for a phone — the Phase 1 gap the plan closes.
 *
 * Pure UI over the existing handling-unit APIs — never writes
 * `serial_units.handling_unit_id` directly:
 *   - reads via `useHandlingUnitDetail` (GET /api/handling-units/[id])
 *   - adds a scanned unit via POST /api/handling-units/[id]/assign
 *   - removes a unit via POST /api/handling-units/[id]/unassign
 * Both mutations already emit HANDLING_UNIT_ASSIGN / _UNASSIGN audit server-side.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { X, Package, Printer, Loader2, History } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { getLast4 } from '@/components/ui/CopyChip';
import { UnitPrintHistory } from '@/components/receiving/UnitPrintHistory';
import { HandlingUnitChip } from '@/components/receiving/HandlingUnitChip';
import { handlingUnitStatusChipClass } from '@/lib/handling-unit-status';
import { unitStatusBadgeTone } from '@/components/station/receiving-constants';
import { conditionLabel } from '@/lib/conditions';
import { printHandlingUnitLabel } from '@/lib/print/printHandlingUnitLabel';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { useHandlingUnitDetail } from '@/hooks/useHandlingUnitDetail';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

export function BoxWorkbenchPanel({
  handlingUnitId,
  onClose,
  lines,
}: {
  handlingUnitId: number;
  onClose: () => void;
  /** The scan's receiving lines — used to label each unit's origin line. */
  lines?: ReceivingLineRow[];
}) {
  const { data, isLoading, isError, error, refetch } = useHandlingUnitDetail(handlingUnitId);
  const box = data?.handling_unit ?? null;

  const [addInput, setAddInput] = useState('');
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null);
  const [expandedUnitId, setExpandedUnitId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // origin_receiving_line_id → readable title, from the scan's rows when present.
  const lineTitleById = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of lines ?? []) {
      if (typeof l.id === 'number') m.set(l.id, l.item_name || l.sku || `Line #${l.id}`);
    }
    return m;
  }, [lines]);

  const submitAdd = useCallback(async () => {
    const ref = addInput.trim();
    if (!ref || busy) return;
    setBusy('add');
    try {
      const res = await fetch(`/api/handling-units/${handlingUnitId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: [ref], idempotencyKey: `hu-assign-${handlingUnitId}-${safeRandomUUID()}` }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const unresolved: string[] = json?.unresolved ?? [];
        toast.error(
          unresolved.length ? `Couldn't find unit "${unresolved[0]}"` : json?.error || `Add failed (${res.status})`,
        );
        return;
      }
      setAddInput('');
      await refetch();
      inputRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add request failed');
    } finally {
      setBusy(null);
    }
  }, [addInput, busy, handlingUnitId, refetch]);

  const removeUnit = useCallback(
    async (unitId: number) => {
      if (busy) return;
      setBusy('remove');
      try {
        const res = await fetch(`/api/handling-units/${handlingUnitId}/unassign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ units: [unitId], idempotencyKey: `hu-unassign-${handlingUnitId}-${safeRandomUUID()}` }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
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
    [busy, handlingUnitId, refetch],
  );

  const rollup = box?.rollup ?? { total: 0, tested: 0, untested: 0 };
  const pct = rollup.total > 0 ? Math.round((rollup.tested / rollup.total) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header — box identity + status + close. */}
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
        <Package className="h-4 w-4 shrink-0 text-teal-600" />
        <span className="min-w-0 flex-1 truncate text-caption font-bold text-text-default">
          {box?.code || `H-${handlingUnitId}`}
        </span>
        {box ? (
          <span
            className={`rounded-full px-2 py-0.5 text-eyebrow font-black uppercase tracking-widest ${handlingUnitStatusChipClass(box.status)}`}
          >
            {box.status}
          </span>
        ) : null}
        <IconButton
          ariaLabel="Print box label"
          icon={<Printer className="h-4 w-4" />}
          disabled={!box}
          onClick={() =>
            box &&
            printHandlingUnitLabel({
              handlingUnitId: box.id,
              code: box.code,
              unitCount: rollup.total,
              locationName: box.location_name,
            })
          }
        />
        <IconButton ariaLabel="Close box panel" icon={<X className="h-4 w-4" />} onClick={onClose} />
      </div>

      {/* Rollup band — k/n tested + progress. */}
      <div className="border-b border-border-soft px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption font-bold text-text-muted">
            {rollup.tested}/{rollup.total} tested
          </span>
          <HandlingUnitChip handlingUnitId={handlingUnitId} code={box?.code} unitCount={rollup.total} dense />
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Scan-in add. */}
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
            placeholder="Scan a serial to add…"
            className="min-w-0 flex-1 rounded-lg border border-border-soft bg-surface-card px-2.5 py-1.5 font-mono text-caption text-text-default outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
          {busy === 'add' ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" /> : null}
        </div>
      </div>

      {/* Body — unit list / loading / error / empty. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-caption text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading box…
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption text-rose-700">
            {error instanceof Error ? error.message : 'Could not load this box.'}
          </div>
        ) : !box || box.units.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-muted">
            No units in this box yet. Scan a serial above to add one.
          </div>
        ) : (
          <ul className="divide-y divide-border-soft">
            {box.units.map((u) => {
              const lineTitle =
                u.origin_receiving_line_id != null
                  ? lineTitleById.get(u.origin_receiving_line_id) ?? `Line #${u.origin_receiving_line_id}`
                  : null;
              return (
                <li key={u.id} className="py-2">
                  <div className="flex items-center gap-2">
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
                    <IconButton
                      ariaLabel="Print history"
                      icon={<History className="h-4 w-4" />}
                      onClick={() => setExpandedUnitId((id) => (id === u.id ? null : u.id))}
                    />
                    <IconButton
                      ariaLabel="Remove from box"
                      icon={<X className="h-4 w-4" />}
                      disabled={busy != null}
                      onClick={() => void removeUnit(u.id)}
                    />
                  </div>
                  {expandedUnitId === u.id ? (
                    <div className="mt-1 rounded-lg bg-surface-canvas px-2 py-1 ring-1 ring-inset ring-border-soft">
                      <UnitPrintHistory serialUnitId={u.id} />
                    </div>
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
