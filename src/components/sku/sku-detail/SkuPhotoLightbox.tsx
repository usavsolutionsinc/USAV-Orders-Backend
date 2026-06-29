import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';

/** Fullscreen photo lightbox; click backdrop or the X to close. */
export function SkuPhotoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <IconButton
        icon={<X className="h-5 w-5" />}
        onClick={onClose}
        ariaLabel="Close photo"
        className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
      />
      <img src={url} alt="SKU photo enlarged" className="max-h-[85vh] max-w-full rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
