import { ChevronDown } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
import { INCOMING_SORT_LABELS, type IncomingSort } from '@/components/sidebar/receiving/IncomingPaneHeader';
import { TILES, TONE } from './incoming-tiles';
import type { IncomingSummary } from './incoming-summary-types';
import type { useIncomingFilters } from './useIncomingFilters';

const dropdownLabelClass = 'mb-1.5 block text-eyebrow font-black uppercase tracking-wider text-gray-500';
const selectClass =
  'h-9 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/** The Incoming filter dropdown: PO date range + sort + status tiles + by-carrier table. */
export function IncomingFilterDropdown({
  filters,
  summary,
}: {
  filters: ReturnType<typeof useIncomingFilters>;
  summary: IncomingSummary | null;
}) {
  const { dateRange, setDateRange, sort, setSort, state, setState } = filters;

  return (
    <div className="space-y-3">
      <div>
        <span className={dropdownLabelClass}>PO purchased between</span>
        <DateRangePickerField value={dateRange} onChange={setDateRange} placeholder="Any date" />
        <p className="mt-1 text-eyebrow font-medium text-gray-400">Date in header is when Zoho PO was created</p>
      </div>

      <label className="block">
        <span className={dropdownLabelClass}>Sort</span>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as IncomingSort)}
            className={selectClass}
            aria-label="Sort incoming POs by"
          >
            {(Object.keys(INCOMING_SORT_LABELS) as IncomingSort[]).map((k) => (
              <option key={k} value={k}>
                {INCOMING_SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <div>
        <span className={dropdownLabelClass}>Status</span>
        <div className="space-y-1.5">
          {TILES.map((t) => {
            const active = state === t.state;
            const tone = TONE[t.tone];
            const count = summary ? (summary[t.key] as number) : null;
            const Icon = t.icon;
            return (
              <HoverTooltip key={t.label} label={t.title} asChild>
                <button
                  type="button"
                  onClick={() => setState(active ? null : t.state)}
                  aria-pressed={active}
                  className={`ds-raw-button flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-label font-bold ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 ${
                    active ? tone.active : tone.inactive
                  } ${tone.ring}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? tone.iconActive : tone.iconInactive}`} />
                  <span className="flex-1 truncate">{t.label}</span>
                  <span className="ml-1 tabular-nums text-caption font-black">
                    {count == null ? '—' : count.toLocaleString()}
                  </span>
                </button>
              </HoverTooltip>
            );
          })}
        </div>
      </div>

      {summary?.by_carrier?.some(
        (c) => c.delivered_unscanned || c.tracking_unavailable || c.in_transit || c.carrier_mismatch,
      ) ? (
        <div>
          <span className={dropdownLabelClass}>By carrier</span>
          <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-gray-200">
            <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_2.75rem_2.25rem_2.25rem] items-center gap-x-1 bg-gray-50 px-2 py-1 text-mini font-black uppercase tracking-wide text-gray-400">
              <span>Carrier</span>
              <HoverTooltip label="In transit" asChild>
                <span className="text-right tabular-nums">Trans</span>
              </HoverTooltip>
              <HoverTooltip label="Tracking unavailable" asChild>
                <span className="text-right tabular-nums">Unav</span>
              </HoverTooltip>
              <HoverTooltip label="Delivered · not scanned" asChild>
                <span className="text-right tabular-nums">Deliv</span>
              </HoverTooltip>
              <HoverTooltip label="Carrier mismatch — carrier/number don’t match" asChild>
                <span className="text-right tabular-nums">Miss</span>
              </HoverTooltip>
            </div>
            {summary.by_carrier!.map((c) => (
              <div
                key={c.carrier}
                className="grid grid-cols-[minmax(0,1fr)_2.25rem_2.75rem_2.25rem_2.25rem] items-center gap-x-1 border-t border-gray-100 px-2 py-1 text-caption"
              >
                <span className="truncate font-bold text-gray-700">{c.carrier === 'UNKNOWN' ? 'Other' : c.carrier}</span>
                <span className={`text-right font-bold tabular-nums ${c.in_transit ? 'text-blue-600' : 'text-gray-300'}`}>{c.in_transit}</span>
                <span className={`text-right font-bold tabular-nums ${c.tracking_unavailable ? 'text-violet-600' : 'text-gray-300'}`}>{c.tracking_unavailable}</span>
                <span className={`text-right font-bold tabular-nums ${c.delivered_unscanned ? 'text-emerald-600' : 'text-gray-300'}`}>{c.delivered_unscanned}</span>
                <span className={`text-right font-bold tabular-nums ${c.carrier_mismatch ? 'text-red-600' : 'text-gray-300'}`}>{c.carrier_mismatch}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
