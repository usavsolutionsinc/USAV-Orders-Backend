'use client';

import { useTicketPhotos } from '@/hooks/useZendeskQueries';

/** Inline strip of the Blob photos linked to this ticket's internal entity. */
export function ZendeskTicketPhotos({ ticketId }: { ticketId: number }) {
  const { data } = useTicketPhotos(ticketId);
  const photos = data?.photos ?? [];
  if (!photos.length) return null;

  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <p className="mb-2 text-micro font-black uppercase tracking-widest text-gray-400">
        Linked photos ({photos.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <a
            key={p.id}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block h-16 w-16 overflow-hidden rounded-lg border border-gray-200 hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.caption ?? ''} className="h-full w-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  );
}
