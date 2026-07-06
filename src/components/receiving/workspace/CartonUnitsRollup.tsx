'use client';

/**
 * Read-only carton-wide unit rollup — a single glance at every serialized unit
 * on the open carton, grouped by receiving line. Answers "what's on this carton
 * and which serials landed on which line?" without expanding each line.
 *
 * {@link CartonUnitsRollupBody} is the embeddable body (used inside the PO-items
 * tab card). {@link CartonUnitsRollup} is the legacy standalone card — kept for
 * any caller that still wants its own chrome; the unbox workspace composes the
 * body via {@link POUnboxingSection}'s tab slider instead.
 *
 * Pure re-render of the SAME `['receiving-siblings', receivingId]` cache the
 * accordion hydrates (`include=serials`) — it runs its own `useQuery` on the
 * identical key so it shares that fetch (or triggers it when it mounts first).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WorkspaceCard } from '@/design-system/components/WorkspaceCard';
import { Package } from '@/components/Icons';
import { SerialPreviewStrip, BoxMembershipHint } from '@/components/receiving/SerialPreviewStrip';
import { PreboxWizard, type PreboxWizardSerial } from '@/components/receiving/PreboxWizard';
import { receivingSiblingsQueryKey } from '@/lib/queries/receiving-queries';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

function useCartonSiblingLines(receivingId: number | null) {
  const enabled = typeof receivingId === 'number' && receivingId > 0;

  const { data } = useQuery<ApiResponse>({
    queryKey: receivingSiblingsQueryKey(receivingId ?? 0),
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving-lines?receiving_id=${receivingId}&include=serials`,
      );
      if (!res.ok) throw new Error('Failed to fetch carton siblings');
      return res.json();
    },
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const lines = data?.receiving_lines ?? [];
  const totalSerials = lines.reduce((n, l) => n + (l.serials?.length ?? 0), 0);
  const rows = lines.filter(
    (l) => (l.serials?.length ?? 0) > 0 || (l.quantity_received ?? 0) > 0,
  );
  const po = rows.find((l) => l.zoho_purchaseorder_number)?.zoho_purchaseorder_number;

  return { enabled, lines, rows, totalSerials, po };
}

/**
 * Bare rollup list — no card chrome. Used inside the PO-items tab card.
 * When `showEmpty`, paints a calm placeholder instead of returning null so the
 * tab always has a surface even before the first serial lands.
 */
export function CartonUnitsRollupBody({
  receivingId,
  activeLineId,
  showEmpty = false,
}: {
  receivingId: number | null;
  activeLineId: number | null;
  showEmpty?: boolean;
}) {
  const { enabled, rows, totalSerials, po } = useCartonSiblingLines(receivingId);
  const [wizardOpen, setWizardOpen] = useState(false);

  if (!enabled) return null;
  if (totalSerials === 0 && !showEmpty) return null;

  const wizardSerials: PreboxWizardSerial[] = rows.flatMap((l) =>
    (l.serials ?? []).map((s) => ({
      id: s.id,
      serial_number: s.serial_number,
      unit_uid: s.unit_uid ?? null,
      sku: l.sku ?? null,
    })),
  );
  const skuSet = new Set(rows.map((l) => (l.sku || '').trim()).filter(Boolean));
  const kitSku = skuSet.size === 1 ? Array.from(skuSet)[0] : null;

  return (
    <>
      <div className="min-w-0">
        {totalSerials > 0 ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                R-{receivingId}
                {po ? ` · PO-${po}` : ''}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  className="ds-raw-button -my-0.5 inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-violet-700 ring-1 ring-inset ring-violet-200 transition-colors hover:bg-violet-100"
                >
                  <Package className="h-3 w-3 shrink-0" /> Prebox
                </button>
                <span className="rounded bg-surface-canvas px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-text-muted ring-1 ring-inset ring-border-soft">
                  {totalSerials} unit{totalSerials === 1 ? '' : 's'}
                </span>
              </div>
            </div>
            <ul className="divide-y divide-border-soft">
              {rows.map((line) => {
                const active = activeLineId != null && line.id === activeLineId;
                return (
                  <li
                    key={line.id}
                    className={`rounded-md px-2 py-1.5 ${
                      active ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : ''
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-caption font-bold text-text-default">
                        {line.item_name || line.sku || `Line #${line.id}`}
                      </span>
                      <span className="shrink-0 text-eyebrow font-semibold uppercase tracking-widest text-text-muted">
                        {line.quantity_received ?? 0}/{line.quantity_expected ?? '?'}
                      </span>
                    </div>
                    {line.serials && line.serials.length > 0 ? (
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <SerialPreviewStrip serials={line.serials} />
                        <BoxMembershipHint serials={line.serials} />
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-border-soft bg-surface-canvas px-4 py-5 text-center text-caption text-text-soft">
            No serials scanned on this carton yet.
          </p>
        )}
      </div>
      {wizardOpen ? (
        <PreboxWizard
          serials={wizardSerials}
          sku={kitSku}
          onClose={() => setWizardOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Standalone card — prefer composing {@link CartonUnitsRollupBody} via tabs. */
export function CartonUnitsRollup({
  receivingId,
  activeLineId,
}: {
  receivingId: number | null;
  activeLineId: number | null;
}) {
  const { enabled, totalSerials } = useCartonSiblingLines(receivingId);

  if (!enabled || totalSerials === 0) return null;

  return (
    <WorkspaceCard variant="glass" label="Units on this carton" bodyClassName="px-3 py-2">
      <CartonUnitsRollupBody receivingId={receivingId} activeLineId={activeLineId} />
    </WorkspaceCard>
  );
}
