'use client';

import { cn } from '@/utils/_cn';
import {
  OUTBOUND_DOCUMENT_TYPE_LABELS,
  type OutboundDocumentTypeFilter,
  type OutboundMediaFilter,
} from '@/lib/photos/library-filter-state';

type OutboundChip = OutboundDocumentTypeFilter | 'pack_photos';

const DOCUMENT_OPTIONS: OutboundDocumentTypeFilter[] = ['all', 'shipping_label', 'packing_slip'];

function chipIsActive(
  chip: OutboundChip,
  documentType: OutboundDocumentTypeFilter,
  outboundMedia: OutboundMediaFilter,
): boolean {
  if (chip === 'pack_photos') return outboundMedia === 'pack_photos';
  return outboundMedia === 'documents' && documentType === chip;
}

export function OutboundDocumentTypeFilters({
  documentType,
  outboundMedia,
  onSelectDocumentType,
  onSelectPackPhotos,
}: {
  documentType: OutboundDocumentTypeFilter;
  outboundMedia: OutboundMediaFilter;
  onSelectDocumentType: (value: OutboundDocumentTypeFilter) => void;
  onSelectPackPhotos: () => void;
}) {
  const chips: OutboundChip[] = [...DOCUMENT_OPTIONS, 'pack_photos'];

  return (
    <div className="space-y-1.5 px-1">
      <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Document type</p>
      <ul className="flex flex-wrap gap-1">
        {chips.map((chip) => {
          const on = chipIsActive(chip, documentType, outboundMedia);
          return (
            <li key={chip}>
              <button
                type="button"
                onClick={() => (chip === 'pack_photos' ? onSelectPackPhotos() : onSelectDocumentType(chip))}
                aria-pressed={on}
                className={cn(
                  'ds-raw-button rounded-lg px-2.5 py-1 text-micro font-semibold transition',
                  on
                    ? 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-400'
                    : 'text-text-muted hover:bg-surface-hover',
                )}
              >
                {OUTBOUND_DOCUMENT_TYPE_LABELS[chip]}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
