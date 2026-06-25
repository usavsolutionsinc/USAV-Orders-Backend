'use client';

/**
 * Mobile handling-unit (box / LPN) page — `/m/h/[id]`.
 *
 * Routed to from /m/scan via `routeScan()` whenever the operator scans an
 * `H-{id}` box DataMatrix. One box scan opens the whole box: every member unit
 * with its test status and a `k/n tested` rollup chip, so a tech can work
 * through the box without re-scanning each unit (the existing multi-picker flow,
 * but native on the phone).
 *
 * Actions:
 *   1. Add unit   — POST /api/handling-units/[id]/assign  (scan a U-/serial)
 *   2. Remove     — POST /api/handling-units/[id]/unassign
 *   3. Print label — client-side ZPL/DataMatrix via printHandlingUnitLabel
 *
 * See docs/handling-unit-lpn-plan.md (Phase H5).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { unitStatusBadgeTone } from '@/components/station/receiving-constants';
import { conditionLabel } from '@/lib/conditions';
import { handlingUnitStatusChipClass } from '@/lib/handling-unit-status';
import { getLast4 } from '@/components/ui/CopyChip';
import { printHandlingUnitLabel } from '@/lib/print/printHandlingUnitLabel';
import { HandlingUnitChip } from '@/components/receiving/HandlingUnitChip';
import { ChevronLeft, Check, X, Printer, Plus, Package } from '@/components/Icons';

interface Member {
  id: number;
  serial_number: string;
  unit_uid: string | null;
  sku: string | null;
  current_status: string;
  current_location: string | null;
  condition_grade: string | null;
  origin_receiving_line_id: number | null;
}

interface Rollup {
  total: number;
  tested: number;
  untested: number;
}

interface BoxDetail {
  id: number;
  code: string;
  status: string;
  location_name: string | null;
  notes: string | null;
  units: Member[];
  rollup: Rollup;
}

interface BoxResponse {
  success: boolean;
  handling_unit: BoxDetail;
}

export default function MobileHandlingUnitPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const rawParam = String(params?.id ?? '');
  const { user, isLoaded } = useAuth();

  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [addInput, setAddInput] = useState('');
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null);

  useEffect(() => {
    if (isLoaded && !user) router.replace(`/signin?next=/m/h/${rawParam}`);
  }, [isLoaded, user, router, rawParam]);

  const { data, isLoading, isError, error, refetch } = useQuery<BoxResponse>({
    queryKey: ['handling-unit.mobile', rawParam],
    enabled: !!rawParam,
    queryFn: async () => {
      const res = await fetch(`/api/handling-units/${encodeURIComponent(rawParam)}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      return json as BoxResponse;
    },
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const box = data?.handling_unit;

  const submitAdd = useCallback(async () => {
    const ref = addInput.trim();
    if (!ref || busy || !box) return;
    setBusy('add');
    try {
      const res = await fetch(`/api/handling-units/${box.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          units: [ref],
          idempotencyKey: `hu-assign-${box.id}-${ref}-${Date.now()}`,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        const unresolved = Array.isArray(json?.unresolved) ? json.unresolved.join(', ') : '';
        throw new Error(unresolved ? `Not found: ${unresolved}` : json?.error || `HTTP ${res.status}`);
      }
      setAddInput('');
      setFlash({ kind: 'ok', msg: `Added to ${box.code}` });
      await refetch();
    } catch (e) {
      setFlash({ kind: 'err', msg: e instanceof Error ? e.message : 'Add failed' });
    } finally {
      setBusy(null);
    }
  }, [addInput, busy, box, refetch]);

  const removeUnit = useCallback(
    async (unitId: number) => {
      if (busy || !box) return;
      setBusy('remove');
      try {
        const res = await fetch(`/api/handling-units/${box.id}/unassign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            units: [unitId],
            idempotencyKey: `hu-unassign-${box.id}-${unitId}-${Date.now()}`,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
        setFlash({ kind: 'ok', msg: 'Removed' });
        await refetch();
      } catch (e) {
        setFlash({ kind: 'err', msg: e instanceof Error ? e.message : 'Remove failed' });
      } finally {
        setBusy(null);
      }
    },
    [busy, box, refetch],
  );

  const printLabel = useCallback(() => {
    if (!box) return;
    printHandlingUnitLabel({
      handlingUnitId: box.id,
      code: box.code,
      unitCount: box.rollup.total,
      locationName: box.location_name,
      date: new Date().toLocaleDateString(),
    });
  }, [box]);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
        <button
          onClick={() => router.push('/m/scan')}
          className="rounded-lg p-1.5 text-slate-500 active:bg-slate-100"
          aria-label="Back to scan"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <Package className="h-5 w-5 text-teal-600" />
        <div className="flex-1 truncate text-base font-extrabold tracking-tight text-slate-900">
          {box ? box.code : 'Box'}
        </div>
        {box && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${handlingUnitStatusChipClass(box.status)}`}>
            {box.status}
          </span>
        )}
        <button
          onClick={printLabel}
          disabled={!box}
          className="rounded-lg p-1.5 text-slate-500 active:bg-slate-100 disabled:opacity-40"
          aria-label="Print box label"
        >
          <Printer className="h-5 w-5" />
        </button>
      </div>

      {flash && (
        <div
          className={`mx-3 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
            flash.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {flash.kind === 'ok' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {flash.msg}
        </div>
      )}

      {isLoading && <div className="p-6 text-center text-sm text-slate-500">Loading box…</div>}
      {isError && (
        <div className="p-6 text-center text-sm text-rose-600">
          {error instanceof Error ? error.message : 'Failed to load box'}
        </div>
      )}

      {box && (
        <>
          {/* Rollup + meta */}
          <div className="mx-3 mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-700">
                {box.rollup.tested}/{box.rollup.total} tested
              </div>
              <HandlingUnitChip handlingUnitId={box.id} code={box.code} unitCount={box.rollup.total} dense />
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{
                  width: `${box.rollup.total > 0 ? Math.round((box.rollup.tested / box.rollup.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Add-unit scan bar */}
          <div className="mx-3 mt-3 flex gap-2">
            <input
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAdd();
              }}
              placeholder="Scan unit (U-… / serial) to add"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <button
              onClick={submitAdd}
              disabled={!addInput.trim() || busy === 'add'}
              className="flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-bold text-white active:bg-teal-700 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>

          {/* Member units */}
          <div className="mx-3 mt-3 space-y-1.5">
            {box.units.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
                Empty box — scan a unit above to add it.
              </div>
            )}
            {box.units.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm font-semibold text-slate-900">
                      …{getLast4(u.serial_number)}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${unitStatusBadgeTone(u.current_status)}`}>
                      {u.current_status}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {u.sku || '—'}
                    {u.condition_grade ? ` · ${conditionLabel(u.condition_grade, 'compact')}` : ''}
                    {u.current_location ? ` · ${u.current_location}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => removeUnit(u.id)}
                  disabled={busy === 'remove'}
                  className="rounded-lg p-1.5 text-slate-400 active:bg-slate-100 disabled:opacity-40"
                  aria-label="Remove from box"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
