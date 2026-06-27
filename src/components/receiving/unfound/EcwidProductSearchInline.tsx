'use client';

/**
 * Inline Ecwid product / repair-order search.
 *
 * The non-modal successor to the retired `EcwidProductSearchPopover` — composes
 * the same reusable pieces (`useEcwidProductSearch` + `EcwidSearchHeader` /
 * `EcwidSearchInputs` / `EcwidResultsList`) but renders in flow (no portal,
 * no backdrop, no Escape handler). Drop it into a tab/panel; the host owns
 * layout and when it's shown.
 *
 * Used by the triage Smart-Matching "Repair Service / Trade in" tab and the
 * Local-Pickup "Add item" panel.
 */

import { useEcwidProductSearch } from './ecwid-search/useEcwidProductSearch';
import { EcwidSearchHeader } from './ecwid-search/EcwidSearchHeader';
import { EcwidSearchInputs } from './ecwid-search/EcwidSearchInputs';
import { EcwidResultsList } from './ecwid-search/EcwidResultsList';
import type { EcwidProductSearchPopoverProps } from './ecwid-search/ecwid-search-shared';

export type {
  EcwidProductSelection,
  EcwidProductPopoverMode,
} from './ecwid-search/ecwid-search-shared';

interface EcwidProductSearchInlineProps extends EcwidProductSearchPopoverProps {
  /** Render the title + close header (for panel hosts). Omit when a tab labels it. */
  showHeader?: boolean;
  className?: string;
}

export function EcwidProductSearchInline({
  showHeader = false,
  className,
  ...props
}: EcwidProductSearchInlineProps) {
  const c = useEcwidProductSearch(props);

  return (
    <div
      className={`flex max-h-[60vh] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white ${
        className ?? ''
      }`}
    >
      {showHeader ? <EcwidSearchHeader c={c} onClose={props.onClose} /> : null}
      <EcwidSearchInputs c={c} />
      <EcwidResultsList c={c} />
    </div>
  );
}
