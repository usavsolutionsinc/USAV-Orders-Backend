'use client';

import { useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  isNotConfigured,
  useTicketComments,
  useTicketPhotos,
  useZendeskTicket,
} from '@/hooks/useZendeskQueries';
import { useTicketPhotoStaging } from '@/hooks/useTicketPhotoStaging';
import { usePhotoDropzone } from '@/hooks/usePhotoDropzone';
import type { ZendeskComment } from '@/lib/zendesk';
import { EmptyState, Spinner } from '@/design-system/primitives';
import { Upload } from '@/components/Icons';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import { SupportChatHeader } from './SupportChatHeader';
import { SupportChatThread } from './SupportChatThread';
import { SupportChatComposer } from './SupportChatComposer';
import { SupportLinkedContext } from './SupportLinkedContext';
import { requesterFrom, requesterLabel } from './support-chat-utils';

/** Image attachment urls on a single Zendesk comment (full-res `content_url`). */
function commentImageUrls(c: ZendeskComment): string[] {
  const raw = (c as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<{ content_url?: string; file_name?: string; content_type?: string | null }>)
    .filter(
      (a) =>
        (a.content_type ?? '').startsWith('image/') ||
        /\.(png|jpe?g|webp|gif)$/i.test(a.file_name ?? ''),
    )
    .map((a) => a.content_url)
    .filter((u): u is string => Boolean(u));
}

/**
 * Chat-style ticket detail: sticky header (requester + Zendesk pickers + staff
 * assignment) → scrollable conversation + linked context → sticky composer.
 *
 * Owns ONE photo gallery aggregated across all message attachments + linked
 * photos, so clicking any photo opens the shared in-app PhotoViewerModal (no new
 * tab) and the viewer can page across the whole ticket.
 */
export function SupportTicketDetail({ ticketId, onBack }: { ticketId: number; onBack?: () => void }) {
  const { data: ticket, isLoading, error } = useZendeskTicket(ticketId);
  // These are cached by the thread / linked-context too — calling them here is a
  // dedupe, not a second fetch — and lets us build one viewer over every photo.
  const { data: commentsData } = useTicketComments(ticketId);
  const { data: photosData } = useTicketPhotos(ticketId);

  const photoUrls = useMemo(() => {
    const urls: string[] = [];
    for (const c of commentsData?.comments ?? []) urls.push(...commentImageUrls(c));
    for (const p of photosData?.photos ?? []) if (p.url) urls.push(p.url);
    return Array.from(new Set(urls));
  }, [commentsData, photosData]);

  const gallery = usePhotoGallery({ photos: photoUrls, showCopyLinks: false });
  const { openViewer } = gallery;

  const onOpenPhoto = useCallback(
    (url: string) => {
      const idx = photoUrls.indexOf(url);
      if (idx >= 0) openViewer(idx);
    },
    [photoUrls, openViewer],
  );

  // Drag-a-photo-onto-the-ticket: the dropzone covers the whole panel; dropping
  // uploads to GCS (linked to this ticket) and stages it in the composer.
  const staging = useTicketPhotoStaging(ticketId);
  const dz = usePhotoDropzone(staging.addFiles);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          title={isNotConfigured(error) ? 'Zendesk isn’t configured' : 'Couldn’t load ticket'}
          description={
            isNotConfigured(error)
              ? 'Set the Zendesk API credentials to use the console.'
              : 'Try selecting the ticket again.'
          }
        />
      </div>
    );
  }

  const requester = requesterFrom(ticket);

  return (
    <div {...dz.rootProps} className="relative flex h-full min-h-0 flex-col bg-gray-50/40">
      <SupportChatHeader ticket={ticket} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SupportChatThread
          ticketId={ticketId}
          requesterId={ticket.requester_id}
          requesterName={requesterLabel(ticket)}
          requesterEmail={requester.email}
          onOpenPhoto={onOpenPhoto}
        />
        <SupportLinkedContext ticketId={ticketId} onOpenPhoto={onOpenPhoto} />
      </div>
      <SupportChatComposer ticketId={ticketId} requesterEmail={requester.email} staging={staging} />

      {/* Full-panel drop overlay while dragging an OS file over the ticket. */}
      <AnimatePresence>
        {dz.isDragging ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50/80 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-2 text-blue-700">
              <Upload className="h-7 w-7" />
              <p className="text-sm font-bold">Drop photo to add to ticket #{ticketId}</p>
              <p className="text-caption font-semibold text-blue-500">Uploads to the library, attaches on your next reply</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Shared fullscreen viewer for every photo on this ticket. */}
      <AnimatePresence>
        {gallery.viewerOpen && gallery.photoItems.length > 0 ? (
          <PhotoViewerModal g={gallery} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
