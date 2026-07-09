'use client';

import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  isNotConfigured,
  useTicketComments,
  useTicketPhotos,
  useZendeskTicket,
} from '@/hooks/useZendeskQueries';
import type { ZendeskComment } from '@/lib/zendesk';
import { EmptyState, Spinner } from '@/design-system/primitives';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import { SupportChatHeader } from './SupportChatHeader';
import { SupportChatThread } from './SupportChatThread';
import { SupportChatComposer } from './SupportChatComposer';
import { SupportSuggestionPanel } from './SupportSuggestionPanel';
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

  // Draft seeded into the composer when the agent accepts an AI suggestion.
  const [seed, setSeed] = useState<{ text: string; token: number } | null>(null);

  // The customer's latest message — what the AI drafts a reply to. Falls back to
  // the ticket's opening description if there are no customer comments yet.
  const question = useMemo(() => {
    const requesterId = (ticket as { requester_id?: number } | null)?.requester_id;
    const fromCustomer = (commentsData?.comments ?? []).filter((c) => c.author_id === requesterId);
    const last = fromCustomer[fromCustomer.length - 1];
    const text = last?.body || (ticket as { description?: string } | null)?.description || '';
    return text.trim();
  }, [commentsData, ticket]);

  const onOpenPhoto = useCallback(
    (url: string) => {
      const idx = photoUrls.indexOf(url);
      if (idx >= 0) openViewer(idx);
    },
    [photoUrls, openViewer],
  );

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
    <div className="flex h-full min-h-0 flex-col bg-gray-50/40">
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
      <SupportSuggestionPanel
        ticketId={ticketId}
        subject={(ticket as { subject?: string }).subject}
        question={question}
        onUse={(text) => setSeed({ text, token: Date.now() })}
      />
      <SupportChatComposer
        ticketId={ticketId}
        requesterEmail={requester.email}
        seedBody={seed?.text}
        seedToken={seed?.token}
      />

      {/* Shared fullscreen viewer for every photo on this ticket. */}
      <AnimatePresence>
        {gallery.viewerOpen && gallery.photoItems.length > 0 ? (
          <PhotoViewerModal g={gallery} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
