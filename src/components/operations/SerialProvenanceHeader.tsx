'use client';

/**
 * The per-serial band header for Operations ▸ History "By unit" view — a compact
 * provenance card answering "what is this unit and where did it come from" at a
 * glance: serial · SKU · condition grade · current status · originating PO ·
 * sibling count · event count. Rendered through {@link EventTimeline}'s
 * `renderGroupHeader` slot, so the collapse chevron + latest-event peek chrome
 * stay owned by the timeline; this card is pure presentation.
 *
 * All values flow from SoT resolvers (condition grade → `ConditionGradeChip`;
 * status → `serial-status-display`; ids → the `CopyChip` family) — no inline
 * label/tone maps.
 */

import { SerialChip, ConditionGradeChip, OrderIdChip } from '@/components/ui/CopyChip';
import { serialStatusDot, serialStatusLabel } from '@/lib/inventory/serial-status-display';
import type { TimelineGroupView } from '@/components/ui/EventTimeline';
import type { SerialProvenance } from '@/lib/queries/operations-journey-queries';

export function SerialProvenanceHeader({
  group,
  provenance,
  siblingCount = 0,
}: {
  group: TimelineGroupView;
  provenance?: SerialProvenance;
  /** Other units in the same record (shown as "+N units"). */
  siblingCount?: number;
}) {
  const serial = (group.ref?.value ?? group.label ?? '').trim();
  const count = group.items.length;
  const sku = provenance?.sku?.trim() || null;
  const po = provenance?.poNumber?.trim() || null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {group.ref?.kind === 'serial' && serial ? (
        <SerialChip value={serial} width="w-auto" dense />
      ) : (
        <span className="text-mini font-bold uppercase tracking-[0.12em] text-gray-500">
          {group.label}
        </span>
      )}

      {sku ? (
        <span className="max-w-[180px] truncate text-caption font-semibold text-gray-700">{sku}</span>
      ) : null}

      {provenance?.grade ? <ConditionGradeChip grade={provenance.grade} dense /> : null}

      {provenance?.status ? (
        <span className="inline-flex items-center gap-1 text-eyebrow font-bold uppercase tracking-widest text-gray-500">
          <span className={`h-2 w-2 shrink-0 rounded-full ${serialStatusDot(provenance.status)}`} />
          {serialStatusLabel(provenance.status)}
        </span>
      ) : null}

      {po ? (
        <span className="inline-flex items-center gap-1 text-micro font-medium text-gray-400">
          PO
          <OrderIdChip value={po} display={po} dense />
        </span>
      ) : null}

      {siblingCount > 0 ? (
        <span className="text-eyebrow font-semibold uppercase tracking-widest text-gray-400">
          +{siblingCount} unit{siblingCount === 1 ? '' : 's'}
        </span>
      ) : null}

      <span className="ml-1 shrink-0 text-micro font-medium text-gray-300">
        {count} {count === 1 ? 'event' : 'events'}
      </span>
    </div>
  );
}
