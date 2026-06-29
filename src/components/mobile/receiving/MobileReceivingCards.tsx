'use client';

import { useState } from 'react';
import { ChevronDown } from '@/components/Icons';
import { MOBILE_GUTTER_X } from '@/components/mobile/redesign/DesignSystem';
import { OrderIdChip, TrackingChip } from '@/components/ui/CopyChip';
import { getLast4 } from '@/lib/copy-chip-format';
import { MobileReceivingUnitRow } from '@/components/mobile/receiving/MobileReceivingUnitRow';
import type { ReceivingFeedEntry } from '@/components/mobile/receiving/receiving-feed-entries';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

/** Per-row wiring the feed owns (hrefs + handlers + fresh / expanded predicates). */
export interface ReceivingCardCallbacks {
  buildHrefs: (row: ReceivingLineRow) => { captureHref: string; galleryHref: string };
  onOpenGallery: (row: ReceivingLineRow) => void;
  onOpenSheet: (row: ReceivingLineRow) => void;
  isFresh: (row: ReceivingLineRow) => boolean;
  /** True only for the single bottom-most (newest) row in the whole feed. */
  isExpanded: (row: ReceivingLineRow) => boolean;
}

const CARD_BASE = `${MOBILE_GUTTER_X} mb-3 overflow-hidden rounded-2xl shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)]`;

/** Standalone arrival — a white card holding a single unit (PO + tracking in its detail panel). */
export function MobileReceivingUnitCard({
  row,
  cb,
}: {
  row: ReceivingLineRow;
  cb: ReceivingCardCallbacks;
}) {
  const { captureHref, galleryHref } = cb.buildHrefs(row);
  return (
    <div className={`${CARD_BASE} border border-gray-100 bg-white p-4`}>
      <MobileReceivingUnitRow
        row={row}
        fresh={cb.isFresh(row)}
        expanded={cb.isExpanded(row)}
        captureHref={captureHref}
        galleryHref={galleryHref}
        onOpenGallery={() => cb.onOpenGallery(row)}
        onOpenSheet={() => cb.onOpenSheet(row)}
      />
    </div>
  );
}

/**
 * Package group — a collapsible card for one inbound carton. Shared PO / tracking
 * (CopyChips, last-4) / carrier live once on the header; each unit carries its
 * own qty, condition, and photos. Default open.
 */
export function MobilePackageGroup({
  entry,
  cb,
}: {
  entry: Extract<ReceivingFeedEntry, { kind: 'package' }>;
  cb: ReceivingCardCallbacks;
}) {
  const [open, setOpen] = useState(true);
  const count = entry.items.length;

  return (
    <div className={`${CARD_BASE} border border-indigo-100 bg-white`}>
      <div className="flex w-full items-center gap-2 bg-indigo-50/70 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Collapse package' : 'Expand package'}
          className="ds-raw-button flex shrink-0 items-center gap-2 text-left"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-indigo-500 transition-transform ${open ? '' : '-rotate-90'}`}
          />
          <span className="shrink-0 text-caption font-black uppercase tracking-widest text-indigo-600">
            {entry.label}
          </span>
        </button>
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {entry.po ? <OrderIdChip value={entry.po} display={getLast4(entry.po)} dense /> : null}
          {entry.trk ? <TrackingChip value={entry.trk} display={getLast4(entry.trk)} dense /> : null}
          {entry.carrier ? (
            <span className="shrink-0 text-eyebrow font-bold uppercase tracking-widest text-gray-500">
              {entry.carrier}
            </span>
          ) : null}
        </span>
        <span className="ml-auto shrink-0 text-eyebrow font-black uppercase tracking-widest text-indigo-600">
          {count} {count === 1 ? 'Item' : 'Items'}
        </span>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {entry.items.map((row) => {
              const { captureHref, galleryHref } = cb.buildHrefs(row);
              return (
                <li key={row.id} className="p-4">
                  <MobileReceivingUnitRow
                    row={row}
                    fresh={cb.isFresh(row)}
                    expanded={cb.isExpanded(row)}
                    headerSharesPoTracking
                    captureHref={captureHref}
                    galleryHref={galleryHref}
                    onOpenGallery={() => cb.onOpenGallery(row)}
                    onOpenSheet={() => cb.onOpenSheet(row)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
