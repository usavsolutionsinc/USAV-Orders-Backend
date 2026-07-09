'use client';

import { useState } from 'react';
import {
  Folder,
  Image as ImageIcon,
  Loader2,
  Package,
  PackageOpen,
  Plus,
  ShoppingCart,
  Tag,
  Wrench,
  ZendeskMark,
  Truck,
} from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { useImageTypes } from '@/hooks/useImageTypes';
import type {
  OutboundDocumentTypeFilter,
  OutboundMediaFilter,
  PhotoLibrarySourceScope,
} from '@/lib/photos/library-filter-state';
import { OutboundDocumentTypeFilters } from './OutboundDocumentTypeFilters';
import { toast } from '@/lib/toast';

/** A paired icon component (mirrors the Icons.tsx glyph signature). */
type IconCmp = typeof Package;

/**
 * Image-type picker — the library's primary sidebar navigator. The five built-in
 * types (Unboxing / Pickups / Packing / Repair / Claims) scope the grid by
 * capture entity; operator-added custom types scope it by `photo_type` and route
 * uploads to their own GCS path. Picking a type scopes the grid (and its date
 * "folders"); the "+" adds a new custom type. Date navigation lives in the right
 * panel, not here.
 */
const ICONS: Record<string, IconCmp> = {
  PackageOpen,
  ShoppingCart,
  Package,
  Wrench,
  ZendeskMark,
  Tag,
  Folder,
  Image: ImageIcon,
  Truck,
};

/** Sidebar-only glyph overrides — preview Zendesk ticket mark for Claims without
 *  changing the `image-types` string key used elsewhere yet. */
const BUILTIN_ICON_OVERRIDE: Partial<Record<string, IconCmp>> = {
  claims:   ZendeskMark,
  Truck,
  FileText: ImageIcon,
};

export function PhotoStationFolders({
  activeScope,
  activeImageType,
  activeDocumentType = 'all',
  activeOutboundMedia = 'documents',
  inferredScope = null,
  onSelect,
  onDocumentTypeSelect,
  onPackPhotosSelect,
}: {
  activeScope: PhotoLibrarySourceScope;
  /** Active custom image type key, or null when a built-in scope is active. */
  activeImageType: string | null;
  /** Outbound scope — document kind chip filter. */
  activeDocumentType?: OutboundDocumentTypeFilter;
  activeOutboundMedia?: OutboundMediaFilter;
  /**
   * Scope derived from the photos currently in view (their entity links), used to
   * highlight the matching built-in row when no scope is explicitly picked — e.g.
   * an unboxing PO folder lights up "Unboxing" under the "All photos" scope.
   */
  inferredScope?: PhotoLibrarySourceScope | null;
  /** Built-in → `{ scope }`; custom → `{ imageType }`. */
  onSelect: (sel: { scope?: PhotoLibrarySourceScope; imageType?: string }) => void;
  onDocumentTypeSelect?: (documentType: OutboundDocumentTypeFilter) => void;
  onPackPhotosSelect?: () => void;
}) {
  const { builtIn, custom, isLoading, createType } = useImageTypes();
  const [adding, setAdding] = useState(false);
  // The row to light up: an explicitly-picked scope wins; otherwise fall back to
  // the scope inferred from the photos in view. A custom image type being active
  // suppresses the built-in highlight entirely.
  const highlightScope: PhotoLibrarySourceScope | null = activeImageType
    ? null
    : activeScope !== 'all'
      ? activeScope
      : inferredScope;

  const addType = async () => {
    const label = window.prompt('New media type name')?.trim();
    if (!label) return;
    setAdding(true);
    try {
      const created = await createType.mutateAsync({ label });
      onSelect({ imageType: created.key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create media type');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Media type</p>
        <HoverTooltip label="Add media type" asChild>
          <IconButton
            icon={adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            ariaLabel="Add media type"
            onClick={addType}
            disabled={adding}
            className="-my-1 inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-surface-sunken disabled:opacity-40"
          />
        </HoverTooltip>
      </div>

      <ul className="space-y-1">
        {builtIn.map((type) => {
          const active = highlightScope === type.key;
          const Icon = BUILTIN_ICON_OVERRIDE[type.key] ?? ICONS[type.icon] ?? Folder;
          return (
            <TypeRow
              key={type.key}
              label={type.label}
              Icon={Icon}
              active={active}
              onClick={() => onSelect({ scope: type.key })}
            />
          );
        })}

        {custom.map((type) => {
          const active = activeImageType === type.key;
          const Icon = (type.icon && ICONS[type.icon]) || Folder;
          return (
            <TypeRow
              key={type.id}
              label={type.label}
              Icon={Icon}
              active={active}
              onClick={() => onSelect({ imageType: type.key })}
            />
          );
        })}

        {isLoading && custom.length === 0 ? (
          <li className="flex items-center gap-2 px-3 py-2 text-caption text-text-faint">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </li>
        ) : null}
      </ul>

      {activeScope === 'outbound' && onDocumentTypeSelect && onPackPhotosSelect ? (
        <OutboundDocumentTypeFilters
          documentType={activeDocumentType}
          outboundMedia={activeOutboundMedia}
          onSelectDocumentType={onDocumentTypeSelect}
          onSelectPackPhotos={onPackPhotosSelect}
        />
      ) : null}
    </div>
  );
}

function TypeRow({
  label,
  Icon,
  active,
  onClick,
}: {
  label: string;
  Icon: IconCmp;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          'ds-raw-button flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold transition',
          active
            ? 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-400'
            : 'text-text-muted hover:bg-surface-hover',
        )}
      >
        <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-blue-600' : 'text-text-faint')} />
        <span className="flex-1 truncate">{label}</span>
      </button>
    </li>
  );
}
