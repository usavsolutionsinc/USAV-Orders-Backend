import type { DateRange } from 'react-day-picker';
import { ChevronDown } from '@/components/Icons';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
import { FilterDropdownSelect } from '@/design-system/components/FilterDropdownSelect';
import type { CarrierCode, ShipmentStatusCategory } from '@/components/shipping/ShipmentStatusBadge';
import { SHIPPED_SEARCH_FIELDS, type ShippedSearchField } from '@/lib/shipped-search';
import { CARRIERS, STATUS_CATEGORIES, TYPE_ITEMS, type ShippedTypeFilter } from './shipped-filter-constants';
import { useShippedFilterRefinements } from './useShippedFilterRefinements';
import { NeedsAttentionButton } from './ShippedFilterControls';

const selectClass =
  'h-9 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white pl-2.5 pr-7 text-caption font-semibold text-gray-900 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const labelClass = 'mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500';

export function ShippedFilterDropdown({
  onClose,
  searchField,
  onSearchFieldChange,
}: {
  onClose: () => void;
  /** Optional "Search by" axis — when provided, surfaces a field dropdown below
   *  Needs attention (replaces the search bar's focus-reveal pills). */
  searchField?: ShippedSearchField;
  onSearchFieldChange?: (next: ShippedSearchField) => void;
}) {
  const { state, actions } = useShippedFilterRefinements();
  const dateRange: DateRange | undefined = state.dateFrom ? { from: state.dateFrom, to: state.dateTo } : undefined;
  const staffOptions = state.allStaff.map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className="space-y-3">
      <NeedsAttentionButton active={state.exceptionsOnly} onClick={actions.toggleExceptions} />

      {onSearchFieldChange && searchField !== undefined ? (
        <label className="block">
          <span className={labelClass}>Search field</span>
          <div className="relative">
            <select value={searchField} onChange={(e) => onSearchFieldChange(e.target.value as ShippedSearchField)} className={selectClass} aria-label="Search field">
              {SHIPPED_SEARCH_FIELDS.map((field) => (
                <option key={field.id} value={field.id}>{field.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          </div>
        </label>
      ) : null}

      <label className="block">
        <span className={labelClass}>Type</span>
        <div className="relative">
          <select value={state.typeFilter} onChange={(e) => actions.setTypeFilter(e.target.value as ShippedTypeFilter)} className={selectClass}>
            {TYPE_ITEMS.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <div>
        <span className={labelClass}>Packed date</span>
        <DateRangePickerField value={dateRange} onChange={actions.setDateRange} placeholder="Any date" />
      </div>

      <label className="block">
        <span className={labelClass}>Carrier</span>
        <div className="relative">
          <select value={state.carrier ?? ''} onChange={(e) => actions.setCarrier((e.target.value || null) as CarrierCode | null)} className={selectClass}>
            <option value="">All carriers</option>
            {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <label className="block">
        <span className={labelClass}>Carrier status</span>
        <div className="relative">
          <select value={state.statusCategory ?? ''} onChange={(e) => actions.setStatus((e.target.value || null) as ShipmentStatusCategory | null)} className={selectClass}>
            <option value="">All statuses</option>
            {STATUS_CATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        </div>
      </label>

      <FilterDropdownSelect
        label="Tested by"
        value={state.testedBy}
        onChange={(next) => actions.setTestedBy(next ? Number(next) : null)}
        emptyOption={{ value: '', label: 'Any staff' }}
        options={staffOptions}
      />

      <FilterDropdownSelect
        label="Packed by"
        value={state.packedBy}
        onChange={(next) => actions.setPackedBy(next ? Number(next) : null)}
        emptyOption={{ value: '', label: 'Any staff' }}
        options={staffOptions}
      />

      <button onClick={onClose} className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-bold text-white transition-colors hover:bg-black">
        Done
      </button>
    </div>
  );
}
