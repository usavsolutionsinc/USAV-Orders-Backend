'use client';

import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface Props {
  row: ReceivingLineRow;
  /** Reserved for future use — currently surfaced via PoLinesAccordion. */
  lineIndex?: number | null;
  lineTotal?: number | null;
}

/**
 * Top-of-workspace hero card. Title on the left, qty number on the right.
 * Product image and "done"/"qty" suffix removed — the qty pill speaks for
 * itself via color (emerald complete · amber multi · gray default).
 */
export function ReceivingContextCard({ row, lineIndex, lineTotal }: Props) {
  const title = row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
  const received = Number.isFinite(row.quantity_received) ? row.quantity_received : 0;
  const expected = row.quantity_expected ?? null;
  const qtyText = expected != null ? `${received}/${expected}` : `${received}`;

  const isComplete = expected != null && received >= expected;
  const isMulti = expected != null && expected > 1;
  const qtyClass = isComplete
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : isMulti
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-gray-100 text-gray-700 ring-gray-200';

  void lineIndex;
  void lineTotal;

  return (
    <section className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      <div className="min-w-0 flex-1">
        <p
          className="line-clamp-2 text-[15px] font-extrabold leading-snug tracking-tight text-gray-900"
          title={title}
        >
          {title}
        </p>
      </div>

      <span
        className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ring-1 ${qtyClass}`}
        title={isComplete ? 'Carton complete' : 'Received / Expected'}
      >
        {qtyText}
      </span>
    </section>
  );
}
