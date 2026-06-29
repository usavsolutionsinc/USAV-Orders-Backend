'use client';

/**
 * Carton add popover — one `+` entry point for every "add" a carton supports,
 * presented as tabs. Mirrors the EcwidProductSearchPopover chrome (portal +
 * backdrop + centered card) so it reads identically to the old per-action
 * popovers it unifies.
 *
 * Tabs (a caller passes the subset that applies to the carton):
 *   • Item — search the INTERNAL catalog (Zoho `items`) and add a line. This is
 *            the surface that used to say "internal"; it's now an explicit tab.
 *   • Web  — search eBay Browse (external/secondary market) and add a line from
 *            a web hit (title + image, no SKU).
 *   • Box  — mint or pick a handling unit (`H-{id}` LPN) and drop the carton's
 *            serial units into it, then print the box label.
 *
 * Item/Web add a receiving LINE, so they only make sense for unmatched cartons.
 * Box groups already-scanned units and applies to any carton.
 *
 * Thin composition layer: shared types + tab metadata live in
 * `./carton-add/carton-add-types`, the per-tab surfaces in `ItemTab`/`WebTab`/
 * `BoxTab`, and the small presentational bits in `carton-add-primitives`.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { microBadge } from '@/design-system/tokens/typography/presets';
import {
  TAB_META,
  type CartonAddPopoverProps,
  type CartonAddTab,
} from './carton-add/carton-add-types';
import { DisabledNote } from './carton-add/carton-add-primitives';
import { ItemTab } from './carton-add/ItemTab';
import { WebTab } from './carton-add/WebTab';
import { BoxTab } from './carton-add/BoxTab';

export type { CartonAddTab, AssignedBox, CartonAddSelection } from './carton-add/carton-add-types';

export function CartonAddPopover({
  tabs,
  initialTab,
  unitIds,
  onAddLine,
  addLineDisabledReason,
  addLineHint,
  onAssignedBox,
  onClose,
}: CartonAddPopoverProps) {
  const [tab, setTab] = useState<CartonAddTab>(initialTab && tabs.includes(initialTab) ? initialTab : tabs[0]!);

  // ─── Escape closes ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="carton-add-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-panelPopover bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="carton-add-dialog"
        role="dialog"
        aria-label="Add to carton"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.18, ease: motionBezier.easeOut }}
        className="pointer-events-none fixed inset-0 z-panelPopover flex items-start justify-center p-4 pt-[8vh] md:pl-[360px]"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl ring-1 ring-gray-200"
        >
          {/* Header: tab segment + close */}
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
            {tabs.length > 1 ? (
              <div className="flex gap-1">
                {tabs.map((t) => {
                  const { label, Icon } = TAB_META[t];
                  const active = t === tab;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`ds-raw-button flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-mini font-bold uppercase tracking-wider transition-colors ${
                        active
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className={`${microBadge} flex items-center gap-1.5 text-gray-700`}>
                {(() => {
                  const { label, Icon } = TAB_META[tab];
                  return (
                    <>
                      <Icon className="h-3.5 w-3.5 text-gray-500" />
                      Add to {label.toLowerCase()}
                    </>
                  );
                })()}
              </span>
            )}
            <IconButton
              onClick={onClose}
              ariaLabel="Close"
              icon={<X className="h-4 w-4" />}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            />
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col">
            {tab === 'item' ? (
              addLineDisabledReason ? (
                <DisabledNote reason={addLineDisabledReason} />
              ) : onAddLine ? (
                <ItemTab onAddLine={onAddLine} hint={addLineHint} />
              ) : null
            ) : null}
            {tab === 'web' ? (
              addLineDisabledReason ? (
                <DisabledNote reason={addLineDisabledReason} />
              ) : onAddLine ? (
                <WebTab onAddLine={onAddLine} hint={addLineHint} />
              ) : null
            ) : null}
            {tab === 'box' ? (
              <BoxTab unitIds={unitIds} onAssigned={onAssignedBox} onClose={onClose} />
            ) : null}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
