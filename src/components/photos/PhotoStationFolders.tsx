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
  Wrench,
} from '@/components/Icons';
import { cn } from '@/utils/_cn';
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
  Folder,
  Image: ImageIcon,
};

export function PhotoStationFolders({
  activeScope,
  activeImageType,
  onSelect,
}: {
  activeScope: PhotoLibrarySourceScope;
  /** Active custom image type key, or null when a built-in scope is active. */
  activeImageType: string | null;
  /** Built-in → `{ scope }`; custom → `{ imageType }`. */
  onSelect: (sel: { scope?: PhotoLibrarySourceScope; imageType?: string }) => void;
}) {
  const { builtIn, custom, isLoading, createType } = useImageTypes();
  const [adding, setAdding] = useState(false);

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
        <button
          type="button"
          onClick={addType}
          disabled={adding}
          title="Add image type"
          aria-label="Add image type"
          className="-my-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>

      <ul className="space-y-1">
        {builtIn.map((type) => {
          const active = activeScope === type.key && !activeImageType;
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
          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold transition',
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
