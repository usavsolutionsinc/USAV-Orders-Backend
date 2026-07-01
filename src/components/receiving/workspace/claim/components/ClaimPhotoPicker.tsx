import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { Camera, Loader2, Plus, ZoomIn } from '@/components/Icons';
import { PhotoGridDisplayControls } from '@/components/photos/PhotoGridDisplayControls';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyClient } from '@/contexts/AblyContext';
import { useReceivingPhotosRealtimeRefresh } from '@/hooks/useReceivingPhotosRealtimeRefresh';
import { usePhotoGridDensity } from '@/hooks/usePhotoGridDensity';
import { publishReceivingPhotoRequest } from '@/lib/realtime/receiving-photo-request';
import { photoGridLeafClass } from '@/lib/photos/photo-grid-density';
import { usePhotoGallery } from '@/components/shipped/photo-gallery/usePhotoGallery';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button, IconButton } from '@/design-system/primitives';
import { toast } from '@/lib/toast';
import { cn } from '@/utils/_cn';
import { claimPhotoTileProps } from '../claim-helpers';
import type { UseClaimPhotos } from '../hooks/useClaimPhotos';

interface Props {
  photos: UseClaimPhotos;
  /** Carton receiving id — the photo request targets this carton. */
  receivingId: number | null | undefined;
}

/**
 * Photo-attachment grid with a send-to-phone capture trigger — the same flow as
 * the receiving workspace's `ReceivingPhotoButton`. The desktop never opens a
 * camera: clicking the camera/"+" publishes a `receiving_photo_request` to the
 * operator's paired phone (`publishReceivingPhotoRequest`), the phone captures,
 * and the uploads stream back over Ably — `useReceivingPhotosRealtimeRefresh`
 * refetches so the new photos appear here live, pre-selected, without leaving
 * the modal. Checked photos attach to the Zendesk ticket; all PO photos are
 * saved to local storage regardless.
 */
export function ClaimPhotoPicker({ photos, receivingId }: Props) {
  const { photos: list, selectedPhotoIds, togglePhoto, toggleSelectAll, refetch } = photos;
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const staffId = user?.staffId ?? 0;
  const { getClient } = useAblyClient();
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { density: gridDensity, setDensity: setGridDensity } = usePhotoGridDensity();

  // Live-refresh the grid when the phone's captures land (phone-bridge upload or
  // station NAS attach), matching this carton.
  useReceivingPhotosRealtimeRefresh(receivingId, staffId, refetch, !!orgId && staffId > 0);

  const g = usePhotoGallery({
    photos: list.map((p) => p.url),
    launcherTitle: 'Claim photos',
  });

  const handleSendToPhone = useCallback(async () => {
    if (!receivingId) {
      toast.error('No carton to attach photos to');
      return;
    }
    if (!orgId || staffId <= 0) {
      toast.error('Sign in on your phone to take photos');
      return;
    }
    setSending(true);
    try {
      const client = await getClient();
      await publishReceivingPhotoRequest(client, orgId, staffId, receivingId);
      toast.success('Sent to phone — take photos there; they appear here automatically');
    } catch {
      toast.error('Could not send to phone');
    } finally {
      setSending(false);
    }
  }, [getClient, orgId, staffId, receivingId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  // ── Empty state — no photos yet: one big send-to-phone tile ────────────────
  if (list.length === 0) {
    return (
      // ds-raw-button: large multi-line dashed send-to-phone card tile, not a standard action button
      <button
        type="button"
        onClick={() => void handleSendToPhone()}
        disabled={sending || !receivingId}
        className="group flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/60 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="relative grid h-11 w-11 place-items-center rounded-full bg-white text-gray-400 ring-1 ring-gray-200 transition-colors group-hover:text-blue-600 group-hover:ring-blue-300">
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          {!sending ? (
            <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-blue-600 text-white ring-2 ring-gray-50">
              <Plus className="h-2.5 w-2.5" />
            </span>
          ) : null}
        </span>
        <span className="text-caption font-bold text-gray-600 group-hover:text-blue-700">
          {sending ? 'Sending…' : 'No photos taken yet'}
        </span>
        <span className="max-w-xs text-micro font-medium leading-4 text-gray-400">
          {sending
            ? 'Opening the camera on your phone…'
            : 'Send to your phone to take photos — they appear here automatically.'}
        </span>
      </button>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <HoverTooltip label="Expand — view all photos closely" asChild>
            <IconButton
              icon={<ZoomIn className="h-3.5 w-3.5" />}
              ariaLabel="View all photos fullscreen"
              onClick={() => g.openViewer(0)}
              className="-ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            />
          </HoverTooltip>
          <p className="truncate text-micro font-black uppercase tracking-widest text-gray-500">
            Attach {selectedPhotoIds.size === 1 ? 'photo' : 'photos'} to ticket ({selectedPhotoIds.size}/{list.length})
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
            {selectedPhotoIds.size === list.length ? 'Clear all' : 'Select all'}
          </Button>
          <PhotoGridDisplayControls
            density={gridDensity}
            onDensityChange={setGridDensity}
            onRefresh={() => void handleRefresh()}
            isRefreshing={refreshing}
          />
        </div>
      </div>

      <div className={photoGridLeafClass(gridDensity)}>
        {list.map((p) => {
          const isSel = selectedPhotoIds.has(p.id);
          const tile = claimPhotoTileProps(p, gridDensity);
          return (
            <HoverTooltip
              key={p.id}
              label={isSel ? 'Selected — click to remove' : 'Click to attach'}
              asChild
            >
              {/* ds-raw-button: photo thumbnail image tile (img selection target), not a standard action button */}
              <button
                type="button"
                onClick={() => togglePhoto(p.id)}
                aria-label={isSel ? 'Selected — click to remove' : 'Click to attach'}
                className={cn(
                  'relative overflow-hidden rounded-lg ring-2 transition',
                  isSel ? 'ring-rose-500' : 'ring-transparent hover:ring-gray-300',
                  tile.ratio === 'natural' ? '' : 'aspect-square',
                )}
              >
                <PhotoThumb
                  src={tile.imageUrl}
                  alt=""
                  ratio={tile.ratio}
                  className={cn(!isSel && tile.ratio === 'square' ? 'opacity-70' : '')}
                />
                {isSel ? (
                  <span className="absolute right-1 top-1 z-10 grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-caption font-black text-white shadow-sm">
                    ✓
                  </span>
                ) : null}
              </button>
            </HoverTooltip>
          );
        })}

        {/* Send-to-phone tile — captures happen on the phone, stream back here. */}
        <HoverTooltip label="Send to phone to take more photos" asChild>
        {/* ds-raw-button: multi-line dashed send-to-phone card tile in the photo grid, not a standard action button */}
        <button
          type="button"
          onClick={() => void handleSendToPhone()}
          disabled={sending || !receivingId}
          aria-label="Send to phone to take more photos"
          className={cn(
            'group flex flex-col items-center justify-center gap-1 self-start rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-400 transition-colors hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60',
            gridDensity === 'lg' ? 'aspect-square w-full' : 'aspect-square',
          )}
        >
          {sending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <span className="relative grid h-7 w-7 place-items-center rounded-full bg-white ring-1 ring-gray-200 transition-colors group-hover:ring-blue-300">
                <Camera className="h-4 w-4" />
                <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-blue-600 text-white ring-2 ring-gray-50">
                  <Plus className="h-2 w-2" />
                </span>
              </span>
              <span className="text-eyebrow font-black uppercase tracking-widest">Phone</span>
            </>
          )}
        </button>
        </HoverTooltip>
      </div>
      <p className="mt-2 text-micro font-medium text-gray-400">
        Selected photos upload to Zendesk as files. All PO photos are also saved to local storage in
        a folder named after the ticket #.
      </p>

      {g.mounted && typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence mode="wait">{g.viewerOpen ? <PhotoViewerModal g={g} /> : null}</AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}
