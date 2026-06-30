import {
  ChevronRight, Image as ImageIcon, AlertCircle, Download, ExternalLink,
} from '../../Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import type { PhotoGalleryController } from './usePhotoGallery';

/** The launcher surface — thumbnail strip, slim toolbar, or the default button. */
export function PhotoLauncher({ g }: { g: PhotoGalleryController }) {
  const { photoItems, compact, className, loadedCount, errorCount } = g;

  if (g.launcherLayout === 'thumbnails') {
    return (
      <div className={`flex w-full flex-wrap items-center gap-1.5 ${className}`}>
        {photoItems.map((photo, index) => (
          <HoverTooltip key={index} label={`View photo ${index + 1} fullscreen`} asChild>
            {/* ds-raw-button: image tile (renders photo / loading / error states) — not a Button shape */}
            <button
              type="button"
              onClick={() => g.openViewer(index)}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-blue-200 bg-blue-50 transition-all hover:ring-2 hover:ring-blue-300 active:scale-95"
              aria-label={`View photo ${index + 1} fullscreen`}
            >
              {photo.status === 'loaded' ? (
                <img src={photo.url} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
              ) : photo.status === 'error' ? (
                <div className="flex h-full w-full items-center justify-center bg-red-50">
                  <AlertCircle className="h-4 w-4 text-red-400" />
                </div>
              ) : (
                <div className="h-full w-full animate-pulse bg-blue-100" />
              )}
            </button>
          </HoverTooltip>
        ))}
      </div>
    );
  }

  if (g.launcherLayout === 'toolbar') {
    const toolbarIconBtnInner = `${compact ? 'p-1.5' : 'p-2'} text-blue-700 transition-all hover:bg-blue-50 disabled:opacity-40 disabled:pointer-events-none`;
    return (
      <div
        className={`flex w-fit max-w-full items-stretch gap-0 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-blue-100/50 ${
          compact ? 'min-h-9 py-0.5 pl-1 pr-0.5' : 'min-h-[3.25rem] py-1 pl-2 pr-1'
        } ${className}`}
      >
        <HoverTooltip label="View photos fullscreen" asChild>
          {/* ds-raw-button: composite text-left launcher (icon tile + photo-count label + chevron) — not a Button shape */}
          <button
            type="button"
            onClick={() => g.openViewer(0)}
            className="flex min-w-0 shrink-0 items-center rounded-lg py-0.5 pl-0 pr-0.5 text-left transition-all hover:bg-blue-100/50 active:scale-[0.995]"
            aria-label="View photos fullscreen"
          >
            <div className={`flex min-w-0 items-center ${g.toolbarShowLabel ? 'gap-2' : 'gap-1'}`}>
              <div className={`flex shrink-0 items-center justify-center rounded-lg bg-blue-500 shadow-sm ${compact ? 'h-7 w-7' : 'h-9 w-9'}`}>
                <ImageIcon className={compact ? 'h-3.5 w-3.5 text-white' : 'h-4 w-4 text-white'} />
              </div>
              {g.toolbarShowLabel ? (
                <div className="flex min-w-0 flex-col">
                  <span className="text-micro font-black uppercase tracking-wider text-blue-600">
                    {photoItems.length} {photoItems.length === 1 ? 'photo' : 'photos'}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0 text-micro font-semibold">
                    {loadedCount < photoItems.length && errorCount === 0 ? <span className="text-amber-600">Loading…</span> : null}
                    {errorCount > 0 ? <span className="text-red-600">{errorCount} failed</span> : null}
                  </div>
                </div>
              ) : null}
              <ChevronRight className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />
            </div>
          </button>
        </HoverTooltip>
        <div className="flex shrink-0 items-stretch self-center overflow-hidden rounded-lg border border-blue-200/90 bg-white/90 shadow-sm">
          <HoverTooltip label="Download all photos" asChild>
            <IconButton
              onClick={(e) => { e.stopPropagation(); void g.handleDownloadAll(); }}
              disabled={g.downloadingAll || photoItems.length === 0 || photoItems.every((p) => p.status === 'error')}
              className={toolbarIconBtnInner}
              ariaLabel="Download all photos"
              icon={<Download className="h-4 w-4 text-blue-700" />}
            />
          </HoverTooltip>
          {g.libraryHref ? (
            <HoverTooltip label="Open in photo library" asChild>
              <a
                href={g.libraryHref}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`${toolbarIconBtnInner} border-l border-blue-200/90`}
                aria-label="Open in photo library"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </HoverTooltip>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    /* ds-raw-button: full-width composite launcher card (icon tile + title + photo counts + chevron) — not a Button shape */
    <button
      type="button"
      onClick={() => g.openViewer(0)}
      className={`w-full bg-gradient-to-r from-blue-50 to-blue-100/50 hover:from-blue-100 hover:to-blue-100 border border-blue-200 hover:border-blue-300 rounded-xl px-4 py-3 transition-all active:scale-[0.98] group ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-blue-500 rounded-lg flex items-center justify-center shadow-sm">
            <ImageIcon className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-sm font-bold text-gray-900">{g.launcherTitle}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-micro font-black text-blue-600 uppercase tracking-wider">
                {photoItems.length} {photoItems.length === 1 ? 'Photo' : 'Photos'}
              </span>
              {loadedCount < photoItems.length && errorCount === 0 && (
                <span className="text-micro font-semibold text-amber-600">• Loading...</span>
              )}
              {errorCount > 0 && <span className="text-micro font-semibold text-red-600">• {errorCount} Failed</span>}
            </div>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-blue-600 group-hover:translate-x-1 transition-transform" />
      </div>
    </button>
  );
}
