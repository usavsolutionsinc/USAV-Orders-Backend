import { X } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { ModeButton } from './ecwid-search-rows';
import type { EcwidProductSearchController } from './useEcwidProductSearch';

/** Header bar: catalog mode toggle / back buttons / mode label + close. */
export function EcwidSearchHeader({ c, onClose }: { c: EcwidProductSearchController; onClose: () => void }) {
  const { popoverMode, manualTitleMode, searchFieldOverride, searchField, repairManualMode } = c;
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
      {popoverMode === 'search' && !manualTitleMode && searchFieldOverride ? (
        <span className={`${microBadge} text-gray-700`}>Search Zoho catalog</span>
      ) : popoverMode === 'search' && !manualTitleMode ? (
        <div className="flex gap-1">
          <ModeButton
            active={searchField === 'title'}
            onClick={() => c.setSearchField('title')}
            label="By title"
          />
          <ModeButton
            active={searchField === 'ecwid_sku'}
            onClick={() => c.setSearchField('ecwid_sku')}
            label="By SKU"
          />
        </div>
      ) : popoverMode === 'search' && manualTitleMode ? (
        <button
          type="button"
          onClick={() => {
            c.setManualTitleMode(false);
            c.setManualTitle('');
          }}
          className={`${microBadge} rounded px-2 py-1 text-blue-700 transition-colors hover:bg-blue-50`}
        >
          {searchFieldOverride === 'zoho_catalog' ? '← Back to Zoho search' : '← Back to Ecwid search'}
        </button>
      ) : popoverMode === 'repair_service' && repairManualMode ? (
        <button
          type="button"
          onClick={() => {
            c.setRepairManualMode(false);
            c.setManualOrderId('');
            c.setManualTitle('');
          }}
          className={`${microBadge} rounded px-2 py-1 text-blue-700 transition-colors hover:bg-blue-50`}
        >
          ← Back to recent orders
        </button>
      ) : (
        <span className={`${microBadge} text-gray-700`}>
          Recent -RS Ecwid orders
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close search"
        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
