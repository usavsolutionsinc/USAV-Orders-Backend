'use client';

import { ExternalLink, Image as ImageIcon, X } from '@/components/Icons';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import type { ClaimPhotoInput } from '@/components/support/zendesk/claim/claim-types';
import { Button, IconButton } from '@/design-system/primitives';
import { MediaLibraryPickerContent } from './MediaLibraryPickerContent';

export interface MediaLibraryPickerModalProps {
  open: boolean;
  onClose: () => void;
  ticketId?: number;
  title?: string;
  subtitle?: string;
  selected: ClaimPhotoInput[];
  onSelectedChange: (photos: ClaimPhotoInput[]) => void;
  excludePhotoIds?: Set<number>;
  confirmLabel?: string;
  onConfirm: (photos: ClaimPhotoInput[]) => void;
  libraryHref?: string;
}

/**
 * Right-pane overlay for picking library photos — same shell as the receiving /
 * Zendesk claim modals ({@link RightPaneOverlay}).
 */
export function MediaLibraryPickerModal({
  open,
  onClose,
  ticketId,
  title = 'Media library',
  subtitle,
  selected,
  onSelectedChange,
  excludePhotoIds,
  confirmLabel = 'Continue',
  onConfirm,
  libraryHref,
}: MediaLibraryPickerModalProps) {
  const href =
    libraryHref ??
    (ticketId
      ? `/ops/photos?sourceScope=claims&entityType=ZENDESK_TICKET&entityId=${ticketId}`
      : '/ops/photos');

  return (
    <RightPaneOverlay
      open={open}
      onClose={onClose}
      align="center"
      resizable
      storageKey="media-library-picker-size"
      minWidth={460}
      minHeight={420}
      className="-mt-8 flex h-[min(86vh,44rem)] w-[min(94vw,52rem)] flex-col"
      aria-label={title}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 shrink-0 text-gray-500" />
            <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          </div>
          {subtitle ? <p className="mt-0.5 text-caption text-gray-500">{subtitle}</p> : null}
        </div>
        <IconButton
          type="button"
          onClick={onClose}
          ariaLabel="Close"
          className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          icon={<X className="h-4 w-4" />}
        />
      </div>

      <MediaLibraryPickerContent
        ticketId={ticketId}
        selected={selected}
        onSelectedChange={onSelectedChange}
        excludePhotoIds={excludePhotoIds}
      />

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-caption font-semibold text-blue-600 hover:text-blue-800"
        >
          Open full library <ExternalLink className="h-3 w-3" />
        </a>
        <div className="flex items-center gap-2">
          <span className="text-caption text-gray-500">{selected.length} selected</span>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={selected.length === 0}
            onClick={() => onConfirm(selected)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </RightPaneOverlay>
  );
}
