import { X } from '@/components/Icons';

/** Fullscreen photo lightbox; click backdrop or the X to close. */
export function SkuPhotoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 z-10"
        aria-label="Close photo"
      >
        <X className="h-5 w-5" />
      </button>
      <img src={url} alt="SKU photo enlarged" className="max-h-[85vh] max-w-full rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
