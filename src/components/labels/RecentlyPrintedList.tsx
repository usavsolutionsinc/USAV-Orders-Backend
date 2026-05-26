'use client';

import { Printer, Clock } from '@/components/Icons';
import { timeAgo } from '@/utils/_date';
import { useLabelPrintFeed, type LabelPrintFeedItem } from '@/hooks/useLabelPrintFeed';

interface RecentlyPrintedListProps {
  /** Clicking a row fires this with the product SKU so the print workspace pre-fills. */
  onPick: (sku: string) => void;
}

/**
 * Recently Printed sub-view — server-backed list of every label issued
 * (per-staff by default). Reads `/api/labels/recent`, which joins
 * `station_activity_logs` → `sku_catalog` → `serial_units` so each row
 * carries product title, image, current status, and location without
 * the consumer needing a second lookup.
 *
 * Clicking a row fires the same `sku:fill` event the Products picker uses,
 * so the print workspace pre-fills the SKU and the operator can reprint or
 * issue a new unit without leaving the sub-view.
 */
export function RecentlyPrintedList({ onPick }: RecentlyPrintedListProps) {
  const { data, isLoading, isError } = useLabelPrintFeed(50);
  const items = data ?? [];

  if (isLoading && items.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 text-center text-caption font-semibold text-gray-400">
        Loading recent prints…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 text-center text-caption font-semibold text-red-500">
        Couldn't load recent prints.
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <Clock className="mb-3 h-8 w-8 text-gray-300" />
        <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">
          No recent prints
        </p>
        <p className="mt-2 max-w-[240px] text-caption font-medium text-gray-500">
          Issued labels appear here automatically — switch to Products to print your first one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="divide-y divide-gray-100">
        {items.map((item) => (
          <RecentRow key={item.id} item={item} onPick={onPick} />
        ))}
      </ul>
    </div>
  );
}

function RecentRow({ item, onPick }: { item: LabelPrintFeedItem; onPick: (sku: string) => void }) {
  const skuForPick = item.sku || item.unit_id || '';
  return (
    <li>
      <button
        type="button"
        onClick={() => skuForPick && onPick(skuForPick)}
        disabled={!skuForPick}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-50 ring-1 ring-gray-200">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Printer className="h-4 w-4 text-gray-300" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 text-label font-semibold leading-snug text-gray-900">
            {item.product_title || item.sku || item.unit_id || 'Untitled'}
          </span>
          <span className="truncate font-mono text-micro text-gray-500">
            {item.unit_id || item.sku || '—'}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-micro text-gray-400">
            <span>{timeAgo(item.printed_at)}</span>
            {item.current_status ? (
              <>
                <span className="text-gray-300">·</span>
                <StatusChip status={item.current_status} />
              </>
            ) : null}
            {item.current_location ? (
              <>
                <span className="text-gray-300">·</span>
                <span className="font-mono">{item.current_location}</span>
              </>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  UNKNOWN: 'bg-gray-100 text-gray-500',
  LABELED: 'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-blue-100 text-blue-700',
  TESTED: 'bg-indigo-100 text-indigo-700',
  STOCKED: 'bg-emerald-100 text-emerald-700',
  PICKED: 'bg-violet-100 text-violet-700',
  SHIPPED: 'bg-slate-200 text-slate-700',
  RETURNED: 'bg-orange-100 text-orange-700',
  RMA: 'bg-rose-100 text-rose-700',
  SCRAPPED: 'bg-red-100 text-red-700',
};
