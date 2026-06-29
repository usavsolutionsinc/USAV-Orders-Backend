import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Package, Plus } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { printHandlingUnitLabel } from '@/lib/print/printHandlingUnitLabel';
import { toast } from '@/lib/toast';
import { type AssignedBox, type OpenBox } from './carton-add-types';

// ─── Box tab — handling unit (LPN) ───────────────────────────────────────────

/**
 * Friendly message from a handling-unit API failure. `withAuth` serializes a
 * 500 as `{ error: 'INTERNAL', message }`, so the bare `error` code reads as
 * "INTERNAL" to operators — almost always the unapplied migration. Prefer the
 * `message`, demote the raw code, and hint at the real cause on a 500.
 */
function boxApiError(
  body: { error?: string; message?: string },
  status: number,
): string {
  if (body.message) return body.message;
  if (status >= 500 || body.error === 'INTERNAL') {
    return 'Handling-units table not ready — apply the 2026-06-08 migration.';
  }
  return body.error || `request failed (${status})`;
}

function printBoxLabel(box: AssignedBox) {
  printHandlingUnitLabel({
    handlingUnitId: box.id,
    code: box.code,
    unitCount: box.total,
    locationName: box.locationName,
    date: new Date().toLocaleDateString(),
  });
}

export function BoxTab({
  unitIds,
  onAssigned,
  onClose,
}: {
  unitIds: number[];
  onAssigned?: (box: AssignedBox) => void;
  onClose: () => void;
}) {
  const [openBoxes, setOpenBoxes] = useState<OpenBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);

  const idemSuffix = useMemo(() => [...unitIds].sort((a, b) => a - b).join('-'), [unitIds]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/handling-units?status=OPEN&limit=50')
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          handling_units?: OpenBox[];
          error?: string;
          message?: string;
        };
        if (!res.ok || !body.success) throw new Error(boxApiError(body, res.status));
        if (!cancelled) setOpenBoxes(body.handling_units ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load boxes');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(
    (box: AssignedBox, count: number) => {
      toast.success(`Added ${count} ${count === 1 ? 'unit' : 'units'} to ${box.code}`);
      printBoxLabel(box);
      onAssigned?.(box);
      onClose();
    },
    [onAssigned, onClose],
  );

  const mintNew = useCallback(async () => {
    if (busyId != null || unitIds.length === 0) return;
    setBusyId('new');
    try {
      const res = await fetch('/api/handling-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: unitIds, idempotencyKey: `hu-mint-carton-${idemSuffix}` }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        message?: string;
        handling_unit?: { id: number; code: string; location_name?: string | null; rollup?: { total?: number } };
      };
      if (!res.ok || !json.success || !json.handling_unit) throw new Error(boxApiError(json, res.status));
      const hu = json.handling_unit;
      finish(
        { id: hu.id, code: hu.code, total: hu.rollup?.total ?? unitIds.length, locationName: hu.location_name ?? null },
        hu.rollup?.total ?? unitIds.length,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mint box');
      setBusyId(null);
    }
  }, [busyId, unitIds, idemSuffix, finish]);

  const assignExisting = useCallback(
    async (target: OpenBox) => {
      if (busyId != null || unitIds.length === 0) return;
      setBusyId(target.id);
      try {
        const res = await fetch(`/api/handling-units/${target.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ units: unitIds, idempotencyKey: `hu-assign-${target.id}-${idemSuffix}` }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          message?: string;
          handling_unit?: { id: number; code: string; location_name?: string | null; rollup?: { total?: number } };
        };
        if (!res.ok || !json.success || !json.handling_unit) throw new Error(boxApiError(json, res.status));
        const hu = json.handling_unit;
        finish(
          { id: hu.id, code: hu.code, total: hu.rollup?.total ?? target.unit_count + unitIds.length, locationName: hu.location_name ?? null },
          unitIds.length,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not assign units');
        setBusyId(null);
      }
    },
    [busyId, unitIds, idemSuffix, finish],
  );

  const noUnits = unitIds.length === 0;

  return (
    <>
      <div className="px-3 pt-3">
        <Button
          variant="primary"
          size="md"
          icon={<Plus />}
          loading={busyId === 'new'}
          disabled={busyId != null || noUnits}
          onClick={() => void mintNew()}
          className="w-full bg-teal-600 hover:bg-teal-700"
        >
          New box &amp; print label · {unitIds.length} {unitIds.length === 1 ? 'unit' : 'units'}
        </Button>
        {noUnits ? (
          <p className="mt-1.5 text-center text-micro text-gray-400">
            Scan a serial first — a box groups the carton&apos;s units.
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-1.5 text-eyebrow font-black uppercase tracking-widest text-gray-400">Or add to an open box</p>
        {loading ? (
          <div className="flex h-20 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">{error}</div>
        ) : openBoxes.length === 0 ? (
          <p className="px-1 py-2 text-label text-gray-400">No open boxes yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {openBoxes.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => void assignExisting(b)}
                  disabled={busyId != null || noUnits}
                  className="ds-raw-button flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left transition-colors hover:border-teal-300 hover:bg-teal-50/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Package className="h-4 w-4 shrink-0 text-teal-600" />
                  <span className="flex-1 truncate text-label font-bold text-gray-900">{b.code}</span>
                  <span className="text-micro font-semibold uppercase tracking-wider text-gray-500">
                    {b.unit_count} {b.unit_count === 1 ? 'unit' : 'units'}
                    {b.location_name ? ` · ${b.location_name}` : ''}
                  </span>
                  {busyId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
