import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, ZoomIn } from '@/components/Icons';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import { claimThumb } from '../claim-helpers';
import type { UseClaimPhotos } from '../hooks/useClaimPhotos';

/**
 * Photo-attachment grid. The checked photos upload to Zendesk as real file
 * attachments; all PO photos are archived to the ticket folder regardless.
 * Renders nothing when the carton has no photos.
 *
 * The expand affordance (left of the header) opens the shared
 * {@link PhotoViewerModal} for a close, fullscreen look. We feed it plain URL
 * strings (no ids) so the lightbox stays read-only — no delete of PO photos
 * from inside the claim flow.
 */
export function ClaimPhotoPicker({ photos }: { photos: UseClaimPhotos }) {
  const { photos: list, selectedPhotoIds, togglePhoto, toggleSelectAll } = photos;

  const [gridOpen, setGridOpen] = useState(true);

  const g = usePhotoGallery({
    photos: list.map((p) => p.url),
    showCopyLinks: false,
    launcherTitle: 'Claim photos',
  });

  if (list.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => g.openViewer(0)}
            aria-label="View all photos fullscreen"
            title="Expand — view all photos closely"
            className="-ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setGridOpen((v) => !v)}
            aria-expanded={gridOpen}
            aria-label={gridOpen ? 'Hide photos' : 'Show photos'}
            title={gridOpen ? 'Hide photos' : 'Show photos'}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${gridOpen ? '' : '-rotate-90'}`} />
          </button>
          <p className="truncate text-micro font-black uppercase tracking-widest text-gray-500">
            Attach {selectedPhotoIds.size === 1 ? 'photo' : 'photos'} to ticket ({selectedPhotoIds.size}/{list.length})
          </p>
        </div>
        <button
          type="button"
          onClick={toggleSelectAll}
          className="shrink-0 text-micro font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900"
        >
          {selectedPhotoIds.size === list.length ? 'Clear all' : 'Select all'}
        </button>
      </div>
      {gridOpen ? (
      <>
      <div className="grid grid-cols-8 gap-1">
        {list.map((p) => {
          const isSel = selectedPhotoIds.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => togglePhoto(p.id)}
              className={`relative aspect-square overflow-hidden rounded ring-2 transition ${
                isSel ? 'ring-rose-500' : 'ring-transparent hover:ring-gray-300'
              }`}
              title={isSel ? 'Selected — click to remove' : 'Click to attach'}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={claimThumb(p.url, p.id)}
                alt=""
                loading="lazy"
                decoding="async"
                className={`h-full w-full bg-gray-100 object-cover ${isSel ? '' : 'opacity-70'}`}
              />
              {isSel ? (
                <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-rose-600 text-mini font-black text-white">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-micro font-medium text-gray-400">
        Selected photos upload to Zendesk as files. All PO photos are also saved to a local folder
        named after the ticket #.
      </p>
      </>
      ) : null}

      {g.mounted && typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence mode="wait">{g.viewerOpen ? <PhotoViewerModal g={g} /> : null}</AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}
