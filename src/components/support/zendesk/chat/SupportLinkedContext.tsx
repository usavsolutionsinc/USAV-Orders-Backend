'use client';

import { useTicketPhotos } from '@/hooks/useZendeskQueries';
import { ExternalLink, Image as ImageIcon, Link2 } from '@/components/Icons';

/**
 * The ticket's linked internal record (Receiving / Repair / Packing / …) + its
 * photos — the "seamless integration with existing workflows" context, resolved
 * via the same entity link the photo strip uses. Degrades to nothing when the
 * ticket has no internal link (inbound / Zendesk-native tickets).
 */
const ENTITY_LABELS: Record<string, string> = {
  RECEIVING: 'Receiving carton',
  RECEIVING_LINE: 'Receiving line',
  SERIAL_UNIT: 'Repair / unit',
  PACKER_LOG: 'Packing log',
  ZENDESK_TICKET: 'Photo evidence',
  SKU: 'Product',
  SKU_STOCK: 'Stock',
};

export function SupportLinkedContext({
  ticketId,
  onOpenPhoto,
}: {
  ticketId: number;
  onOpenPhoto?: (url: string) => void;
}) {
  const { data } = useTicketPhotos(ticketId);
  const entity = (data?.entity ?? null) as { type?: string; id?: number; source?: string } | null;
  const photos = data?.photos ?? [];
  const libraryHref = `/ops/photos?sourceScope=claims&entityType=ZENDESK_TICKET&entityId=${ticketId}`;

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-gray-400" />
          <p className="text-micro font-black uppercase tracking-widest text-gray-500">Linked context</p>
        </div>
        <a
          href={libraryHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-caption font-semibold text-blue-600 hover:text-blue-800"
        >
          Media library <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {!entity?.type && photos.length === 0 ? (
        <p className="mt-2 text-caption text-gray-400">
          No internal record linked — use Library in the composer to attach media from the library.
        </p>
      ) : null}

      {entity?.type ? (
        <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
          <span className="text-label font-bold text-gray-700">{ENTITY_LABELS[entity.type] ?? entity.type}</span>
          {entity.id ? <span className="text-caption font-semibold text-gray-400">#{entity.id}</span> : null}
        </div>
      ) : null}

      {photos.length ? (
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1 text-caption font-semibold text-gray-400">
            <ImageIcon className="h-3 w-3" /> {photos.length} linked photo{photos.length === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenPhoto?.(p.url)}
                className="ds-raw-button block h-20 w-20 overflow-hidden rounded-lg ring-1 ring-inset ring-gray-200 transition hover:opacity-90 hover:ring-2 hover:ring-blue-300"
              >
                <img src={p.url} alt={p.caption ?? ''} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
