'use client';

/**
 * Block palette — the registry-driven "what can I add here" list. Renders
 * every registered block compatible with the target slot, grouped by
 * category, with the permissions it implies as chips. Click-to-add is the
 * canonical keyboard-safe path (drag is sugar to layer on later); adding
 * never creates a blank block — the caller opens the Config Sheet
 * immediately.
 */

import { useMemo, useState } from 'react';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { Search } from '@/components/Icons';
import { listBlockMeta } from '@/lib/stations';
import type { BlockMeta, SlotId } from '@/lib/stations/contract';
import { StationIcon } from './station-icons';

const CATEGORY_LABELS: Record<BlockMeta['category'], string> = {
  trigger: 'Triggers',
  list: 'Lists',
  workspace_step: 'Workspace steps',
  action_bar: 'Action bars',
  integration: 'Integrations',
};

interface BlockPaletteOverlayProps {
  open: boolean;
  slot: SlotId;
  onClose: () => void;
  onPick: (blockType: string) => void;
}

export function BlockPaletteOverlay({ open, slot, onClose, onPick }: BlockPaletteOverlayProps) {
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const compatible = listBlockMeta().filter(
      (b) => b.slots.includes(slot) && (!q || b.label.toLowerCase().includes(q) || b.type.includes(q)),
    );
    const byCategory = new Map<BlockMeta['category'], BlockMeta[]>();
    for (const b of compatible) {
      const list = byCategory.get(b.category) ?? [];
      list.push(b);
      byCategory.set(b.category, list);
    }
    return [...byCategory.entries()];
  }, [slot, search]);

  return (
    <RightPaneOverlay open={open} onClose={onClose} align="right" width={340} aria-label="Block palette">
      <div className="flex h-full flex-col bg-white">
        <div className="border-b border-gray-200 px-3 py-2.5">
          <h2 className="text-label font-black uppercase tracking-wider text-gray-700">Add a block</h2>
          <p className="mt-0.5 text-mini font-semibold text-gray-400">
            Into the <span className="font-mono">{slot}</span> slot — blocks are generic; the data source you bind next decides what they show.
          </p>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search blocks…"
              className="h-8 w-full rounded-md border border-gray-200 bg-white pl-7 pr-2 text-caption font-semibold text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {groups.length === 0 ? (
            <p className="py-4 text-caption font-semibold text-gray-400">No blocks fit this slot.</p>
          ) : (
            groups.map(([category, blocks]) => (
              <div key={category} className="mb-3">
                <p className="mb-1.5 text-eyebrow font-black uppercase tracking-wider text-gray-400">
                  {CATEGORY_LABELS[category]}
                </p>
                <div className="space-y-1.5">
                  {blocks.map((b) => (
                    <button
                      key={b.type}
                      type="button"
                      onClick={() => onPick(b.type)}
                      className="ds-raw-button flex w-full items-start gap-2.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600">
                        <StationIcon name={b.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-label font-bold text-gray-800">{b.label}</span>
                        {b.requiredPermissions.length > 0 ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {b.requiredPermissions.map((p) => (
                              <span key={p} className="rounded bg-amber-50 px-1 py-px font-mono text-mini font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                                {p}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </RightPaneOverlay>
  );
}
