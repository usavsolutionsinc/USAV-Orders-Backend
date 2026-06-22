import { claimThumb } from '../claim-helpers';
import type { UseClaimPhotos } from '../hooks/useClaimPhotos';

/**
 * Photo-attachment grid. The checked photos upload to Zendesk as real file
 * attachments; all PO photos are archived to the ticket folder regardless.
 * Renders nothing when the carton has no photos.
 */
export function ClaimPhotoPicker({ photos }: { photos: UseClaimPhotos }) {
  const { photos: list, selectedPhotoIds, togglePhoto, toggleSelectAll } = photos;
  if (list.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-micro font-black uppercase tracking-[0.14em] text-gray-500">
          Attach photos ({selectedPhotoIds.size}/{list.length})
        </p>
        <button
          type="button"
          onClick={toggleSelectAll}
          className="text-micro font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900"
        >
          {selectedPhotoIds.size === list.length ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {list.map((p) => {
          const isSel = selectedPhotoIds.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => togglePhoto(p.id)}
              className={`relative aspect-square overflow-hidden rounded-md ring-2 transition ${
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
                <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-rose-600 text-[10px] font-black text-white">
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
    </div>
  );
}
