import { X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { ModeButton } from './ecwid-search-rows';
import type { EcwidProductSearchController } from './useEcwidProductSearch';

/** Header bar: catalog mode toggle / back buttons / mode label + close. */
export function EcwidSearchHeader({ c, onClose }: { c: EcwidProductSearchController; onClose: () => void }) {
  const { popoverMode, manualTitleMode, searchFieldOverride, searchField, orderScope } = c;
  return (
    <div className="flex items-center justify-between border-b border-border-hairline px-3 py-2">
      {popoverMode === 'search' && !manualTitleMode && searchFieldOverride ? (
        <span className={`${microBadge} text-text-muted`}>Search Zoho catalog</span>
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
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => {
            c.setManualTitleMode(false);
            c.setManualTitle('');
          }}
          className={`${microBadge} text-blue-700 hover:bg-blue-50 hover:text-blue-700`}
        >
          {searchFieldOverride === 'zoho_catalog' ? '← Back to Zoho search' : '← Back to Ecwid search'}
        </Button>
      ) : popoverMode === 'repair_service' ? (
        <span className={`${microBadge} text-text-muted`}>
          {orderScope === 'all' ? 'Recent Ecwid orders' : 'Recent repair orders'}
        </span>
      ) : (
        <span className={`${microBadge} text-text-muted`}>Ecwid search</span>
      )}
      <IconButton
        type="button"
        onClick={onClose}
        ariaLabel="Close search"
        icon={<X className="h-4 w-4" />}
        className="rounded-lg p-1.5 text-text-faint transition-colors hover:bg-surface-sunken hover:text-text-muted"
      />
    </div>
  );
}
