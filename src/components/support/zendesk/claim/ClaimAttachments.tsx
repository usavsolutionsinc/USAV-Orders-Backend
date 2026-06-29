'use client';

import { Check, Upload, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives/IconButton';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { usePhotoDropzone } from '@/hooks/usePhotoDropzone';
import { cn } from '@/utils/_cn';
import type { ZendeskClaimController } from './useZendeskClaimController';

/**
 * Selected library photos (toggle each on/off) plus a drop zone for ad-hoc files.
 * Both sets ride along as real Zendesk attachments on submit.
 */
export function ClaimAttachments({ c }: { c: ZendeskClaimController }) {
  const dz = usePhotoDropzone(c.addFiles);
  const hasLibrary = c.photos.length > 0;

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-micro font-black uppercase tracking-widest text-gray-500">Attachments</p>
        <span className="text-caption font-semibold text-gray-400">{c.totalAttach} selected</span>
      </div>

      {hasLibrary ? (
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {c.photos.map((p) => {
            const on = !c.excluded.has(p.id);
            return (
              <HoverTooltip
                key={p.id}
                label={on ? 'Attached — click to skip' : 'Skipped — click to attach'}
                asChild
              >
                <button
                  type="button"
                  onClick={() => c.togglePhoto(p.id)}
                  aria-pressed={on}
                  className={cn(
                    'ds-raw-button group relative aspect-square overflow-hidden rounded-lg ring-1 ring-inset transition',
                    on ? 'ring-blue-400' : 'opacity-40 grayscale ring-gray-200 hover:opacity-75',
                  )}
                >
                  <PhotoThumb src={p.src} alt={p.caption ?? `Photo ${p.id}`} ratio="square" className="h-full w-full" />
                  <span
                    className={cn(
                      'absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-white shadow-sm',
                      on ? 'bg-blue-500' : 'bg-gray-400',
                    )}
                  >
                    {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  </span>
                </button>
              </HoverTooltip>
            );
          })}
        </div>
      ) : null}

      <div
        {...dz.rootProps}
        className={cn(
          'rounded-xl border border-dashed px-4 py-3.5 transition',
          dz.isDragging ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200 bg-gray-50/60',
        )}
      >
        {c.added.length > 0 ? (
          <div className="mb-3 grid grid-cols-5 gap-2 sm:grid-cols-6">
            {c.added.map((a) => (
              <div
                key={a.id}
                className="relative aspect-square overflow-hidden rounded-lg ring-1 ring-inset ring-gray-200"
              >
                {/* blob preview of a just-dropped file (not a library tile) */}
                <img src={a.url} alt={a.file.name} className="h-full w-full object-cover" />
                <IconButton
                  type="button"
                  onClick={() => c.removeAdded(a.id)}
                  ariaLabel="Remove"
                  icon={<X className="h-2.5 w-2.5 text-white" />}
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-900/70 transition hover:bg-gray-900"
                />
              </div>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={dz.openPicker}
          className="ds-raw-button flex w-full flex-col items-center justify-center gap-1.5 py-1.5 text-center"
        >
          <Upload className="h-5 w-5 text-gray-400" />
          <span className="text-label font-semibold text-gray-600">
            Drag photos here or <span className="text-blue-600">browse</span>
          </span>
        </button>
        <input ref={dz.inputRef} {...dz.inputProps} />
      </div>
    </section>
  );
}
