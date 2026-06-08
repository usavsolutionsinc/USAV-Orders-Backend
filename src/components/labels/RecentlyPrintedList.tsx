'use client';

import { Printer, Clock } from '@/components/Icons';
import { timeAgo } from '@/utils/_date';
import { useLabelPrintFeed, type LabelPrintFeedItem } from '@/hooks/useLabelPrintFeed';
import { unitStatusBadgeClass } from '@/lib/unit-status';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';

/**
 * Lookup key for a feed row, resolvable by GET /api/serial-units/[id] (which
 * accepts a numeric id, a serial_number, OR a minted unit_uid). Prefer the
 * numeric id, then serial, then the minted `unit_id` — the last is what's
 * always present for label prints whose tech_serial_numbers cross-ref is null.
 */
export function recentLookupKey(item: LabelPrintFeedItem): string {
  if (item.serial_unit_id != null) return String(item.serial_unit_id);
  return item.serial_number || item.unit_id || '';
}

interface RecentlyPrintedListProps {
  /** Clicking a row selects that printed unit so the main pane shows its detail. */
  onSelect: (item: LabelPrintFeedItem) => void;
  /** Lookup key of the currently-selected unit (from `?historyId=`), for highlight. */
  selectedKey?: string | null;
}

/**
 * Recently Printed sub-view — server-backed list of every label issued
 * (per-staff by default). Reads `/api/labels/recent`, which joins
 * `station_activity_logs` → `sku_catalog` → `serial_units` so each row
 * carries product title, image, current status, and location without
 * the consumer needing a second lookup.
 *
 * Clicking a row selects that printed unit; the main pane (UnitHistoryWorkspace)
 * loads its full detail — SKU, condition grade, status, location, and lifecycle
 * timeline. Reprinting lives on the Products sub-view, not here.
 */
export function RecentlyPrintedList({ onSelect, selectedKey }: RecentlyPrintedListProps) {
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
          <RecentRow
            key={item.id}
            item={item}
            onSelect={onSelect}
            isSelected={!!selectedKey && recentLookupKey(item) === selectedKey}
          />
        ))}
      </ul>
    </div>
  );
}

function RecentRow({
  item,
  onSelect,
  isSelected,
}: {
  item: LabelPrintFeedItem;
  onSelect: (item: LabelPrintFeedItem) => void;
  isSelected: boolean;
}) {
  const hasDetail = recentLookupKey(item).length > 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => hasDetail && onSelect(item)}
        disabled={!hasDetail}
        aria-current={isSelected}
        className={`flex w-full items-start gap-3 ${SIDEBAR_GUTTER} py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isSelected ? 'bg-blue-50' : 'hover:bg-blue-50'
        }`}
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
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${unitStatusBadgeClass(status)}`}
    >
      {status}
    </span>
  );
}
