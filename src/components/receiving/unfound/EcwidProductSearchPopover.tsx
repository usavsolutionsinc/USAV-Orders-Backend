'use client';

/**
 * Ecwid product search popover.
 *
 * Used by UnmatchedItemsSection when the operator clicks [+ Add item] on an
 * unmatched receiving. Searches /api/sku-catalog/search which already covers
 * both Ecwid product titles and platform SKUs via sku_platform_ids.
 *
 * The search endpoint returns `items[]` shaped like:
 *   {
 *     id: number,          // sku_platform_ids.id  (when searchField=title|ecwid_sku)
 *     sku: string | null,  // platform_sku
 *     zoho_sku: string,    // sku_catalog.sku (when joined)
 *     product_title: string,
 *     image_url: string | null,
 *     platform_ids: [{ platform, platform_sku, platform_item_id, account_name }]
 *   }
 *
 * On select from catalog/repair lists, fires onSelect with platform + catalog identifiers
 * needed for POST /api/receiving/add-unmatched-line. Operators may use
 * “Product not added yet?” for a title-only line when Ecwid has no SKU (server
 * stores sku_platform_id_row NULL; PO Items hides the SKU chip until paired).
 * For catalog picks we resolve sku_catalog_id by re-querying /api/sku-catalog/search
 * with searchField=zoho_sku — the platform search returns the joined catalog SKU
 * but not its primary key, so the parent passes receiving_id into a flow that joins it back.
 *
 * Alternative considered: have /api/sku-catalog/search return sc.id directly
 * for platform searches. That's a one-line server change but would touch a
 * shared endpoint — keep it scoped to this feature for now.
 *
 * Thin composition shell: state + effects live in {@link useEcwidProductSearch};
 * the header / inputs / results list are presentational components under
 * `./ecwid-search/`.
 */

import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { useEcwidProductSearch } from './ecwid-search/useEcwidProductSearch';
import { EcwidSearchHeader } from './ecwid-search/EcwidSearchHeader';
import { EcwidSearchInputs } from './ecwid-search/EcwidSearchInputs';
import { EcwidResultsList } from './ecwid-search/EcwidResultsList';
import type { EcwidProductSearchPopoverProps } from './ecwid-search/ecwid-search-shared';

export type {
  EcwidProductSelection,
  EcwidProductPopoverMode,
  EcwidProductSearchPopoverProps,
} from './ecwid-search/ecwid-search-shared';

export function EcwidProductSearchPopover(props: EcwidProductSearchPopoverProps) {
  const { onClose } = props;
  const c = useEcwidProductSearch(props);

  if (typeof window === 'undefined') return null;

  // Portal-mounted centered modal so the workspace's overflow-y / stacking
  // contexts can't clip it. Backdrop covers the viewport; the dialog
  // wrapper pins to the top (items-start + top padding) and offsets right
  // by the desktop sidebar width so it visually centers on the workspace.
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="ecwid-search-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-panelPopover bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="ecwid-search-dialog"
        role="dialog"
        aria-label={c.dialogAria}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.18, ease: motionBezier.easeOut }}
        className="pointer-events-none fixed inset-0 z-panelPopover flex items-start justify-center p-4 pt-[8vh] md:pl-[360px]"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-2xl ring-1 ring-gray-200"
        >
          <EcwidSearchHeader c={c} onClose={onClose} />
          <EcwidSearchInputs c={c} />
          <EcwidResultsList c={c} />
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
