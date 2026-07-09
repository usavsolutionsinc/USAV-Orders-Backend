'use client';

import { useCallback, useState } from 'react';
import { uploadPhotoClient, linkPhotoClient } from '@/lib/photos/upload-client';
import { toast } from '@/lib/toast';

/**
 * Staged photos for a support ticket. Dropping / picking a file uploads it to
 * GCS immediately (linked to the ZENDESK_TICKET entity) so it's persisted "under
 * that ticket" the moment it lands, then it rides along as an attachment on the
 * next reply/note (the composer sends `photoIds`). The blob `previewUrl` shows
 * instantly while the upload is in flight.
 */
export interface StagedPhoto {
  tempId: string;
  name: string;
  /** Local blob preview shown immediately (revoked on remove/clear). */
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  /** Set once the GCS upload resolves. */
  photoId?: number;
  url?: string;
  thumbUrl?: string;
}

let seq = 0;

export function useTicketPhotoStaging(ticketId: number) {
  const [staged, setStaged] = useState<StagedPhoto[]>([]);

  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      for (const file of images) {
        const tempId = `s-${(seq += 1)}`;
        const previewUrl = URL.createObjectURL(file);
        setStaged((prev) => [...prev, { tempId, name: file.name, previewUrl, status: 'uploading' }]);
        uploadPhotoClient({
          file,
          entityType: 'ZENDESK_TICKET',
          entityId: ticketId,
          linkRole: 'claim_evidence',
        })
          .then((res) => {
            setStaged((prev) =>
              prev.map((s) =>
                s.tempId === tempId
                  ? { ...s, status: 'done', photoId: res.id, url: res.url, thumbUrl: res.thumbUrl }
                  : s,
              ),
            );
          })
          .catch((err) => {
            console.error('[ticket-photo-staging] upload failed', err);
            toast.error(`Couldn’t upload ${file.name}`);
            setStaged((prev) => prev.map((s) => (s.tempId === tempId ? { ...s, status: 'error' } : s)));
          });
      }
    },
    [ticketId],
  );

  /** Link existing library photos to this ticket and stage them for the next reply. */
  const addLibraryPhotos = useCallback(
    (photos: { id: number; url: string; thumbUrl: string; caption?: string | null }[]) => {
      for (const photo of photos) {
        const tempId = `lib-${photo.id}`;
        setStaged((prev) => {
          if (prev.some((s) => s.photoId === photo.id)) return prev;
          return [
            ...prev,
            {
              tempId,
              name: photo.caption?.trim() || `Photo ${photo.id}`,
              previewUrl: photo.thumbUrl,
              status: 'uploading' as const,
              photoId: photo.id,
              url: photo.url,
              thumbUrl: photo.thumbUrl,
            },
          ];
        });
        void linkPhotoClient({
          photoId: photo.id,
          entityType: 'ZENDESK_TICKET',
          entityId: ticketId,
          linkRole: 'claim_evidence',
        })
          .then(() => {
            setStaged((prev) => prev.map((s) => (s.tempId === tempId ? { ...s, status: 'done' } : s)));
          })
          .catch((err) => {
            // Already linked to this ticket — still stage for Zendesk attach.
            console.warn('[ticket-photo-staging] linkPhoto failed (may already be linked)', err);
            setStaged((prev) => prev.map((s) => (s.tempId === tempId ? { ...s, status: 'done' } : s)));
          });
      }
    },
    [ticketId],
  );

  const remove = useCallback((tempId: string) => {
    setStaged((prev) => {
      const target = prev.find((s) => s.tempId === tempId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.tempId !== tempId);
    });
  }, []);

  const clear = useCallback(() => {
    setStaged((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.previewUrl));
      return [];
    });
  }, []);

  const uploading = staged.some((s) => s.status === 'uploading');

  return { staged, addFiles, addLibraryPhotos, remove, clear, uploading };
}

export type TicketPhotoStaging = ReturnType<typeof useTicketPhotoStaging>;
