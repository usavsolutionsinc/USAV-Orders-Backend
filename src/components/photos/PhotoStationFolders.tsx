'use client';

import { useState } from 'react';
import {
  Folder,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Package,
  PackageOpen,
  Plus,
  ShoppingCart,
  Tag,
  Wrench,
} from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { useImageTypes } from '@/hooks/useImageTypes';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
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
  MessageSquare,
  Tag,
  Folder,
  Image: ImageIcon,
};

export function PhotoStationFolders({
  activeScope,
  activeImageType,
  inferredScope = null,
  onSelect,
}: {
  activeScope: PhotoLibrarySourceScope;
  /** Active custom image type key, or null when a built-in scope is active. */
  activeImageType: string | null;
  /**
   * Scope derived from the photos currently in view (their entity links), used to
   * highlight the matching built-in row when no scope is explicitly picked — e.g.
   * an unboxing PO folder lights up "Unboxing" under the "All photos" scope.
   */
  inferredScope?: PhotoLibrarySourceScope | null;
  /** Built-in → `{ scope }`; custom → `{ imageType }`. */
  onSelect: (sel: { scope?: PhotoLibrarySourceScope; imageType?: string }) => void;
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
    const label = window.prompt('New image type name')?.trim();
    if (!label) return;
    setAdding(true);
    try {
      const created = await createType.mutateAsync({ label });
      onSelect({ imageType: created.key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create image type');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">Image type</p>
        <HoverTooltip label="Add image type" asChild>
          <IconButton
            icon={adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            ariaLabel="Add image type"
            onClick={addType}
            disabled={adding}
            className="-my-1 inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-40"
          />
        </HoverTooltip>
      </div>

      <ul className="space-y-1">
        {builtIn.map((type) => {
          const active = highlightScope === type.key;
          const Icon = ICONS[type.icon] ?? Folder;
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
          <li className="flex items-center gap-2 px-3 py-2 text-caption text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </li>
        ) : null}
      </ul>
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
            : 'text-gray-700 hover:bg-gray-50',
        )}
      >
        <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-blue-600' : 'text-gray-400')} />
        <span className="flex-1 truncate">{label}</span>
      </button>
    </li>
  );
}
