'use client';

import { useEffect, useState } from 'react';
import type { ClaimPhotoInput } from '@/components/support/zendesk/claim/claim-types';
import { MediaLibraryPickerModal } from '@/components/photos/MediaLibraryPickerModal';

interface SupportPhotoLibraryPickerProps {
  ticketId: number;
  open: boolean;
  onClose: () => void;
  excludePhotoIds?: Set<number>;
  onSelect: (photos: { id: number; url: string; thumbUrl: string; caption?: string | null }[]) => void;
}

/**
 * Browse the internal media library from the support console — pick photos to
 * link to the open ticket and stage for the next reply / customer send.
 */
export function SupportPhotoLibraryPicker({
  ticketId,
  open,
  onClose,
  excludePhotoIds,
  onSelect,
}: SupportPhotoLibraryPickerProps) {
  const [selected, setSelected] = useState<ClaimPhotoInput[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
  }, [open, ticketId]);

  return (
    <MediaLibraryPickerModal
      open={open}
      onClose={onClose}
      ticketId={ticketId}
      subtitle={`Link photos to ticket #${ticketId} and attach on your next reply`}
      selected={selected}
      onSelectedChange={setSelected}
      excludePhotoIds={excludePhotoIds}
      confirmLabel="Add to reply"
      onConfirm={(photos) => {
        onSelect(
          photos.map((p) => ({
            id: p.id,
            url: p.displayUrl ?? p.src,
            thumbUrl: p.src,
            caption: p.caption,
          })),
        );
        onClose();
      }}
    />
  );
}
