'use client';

import { Plus } from '@/components/Icons';
import { Button } from '@/design-system/primitives/Button';
import { cn } from '@/utils/_cn';
import type { SkuGraphMode } from './types';

const MODES: Array<{ id: SkuGraphMode; label: string }> = [
  { id: 'parents', label: 'Item → Parents' },
  { id: 'children', label: 'Item → Children' },
  { id: 'tree', label: 'Full Tree' },
];

interface SkuGraphToolbarProps {
  mode: SkuGraphMode;
  onModeChange: (mode: SkuGraphMode) => void;
  focusedLabel: string | null;
  onAddConnection: () => void;
  canAdd: boolean;
}

/**
 * Canvas action bar. SKU search lives in the sidebar (`InventoryGraphSidebar`)
 * per the sidebar-mode contract; this bar only carries the focused-SKU label,
 * the view toggle, and the Add-Connection action (its modal lives in the
 * workspace).
 */
export function SkuGraphToolbar({
  mode,
  onModeChange,
  focusedLabel,
  onAddConnection,
  canAdd,
}: SkuGraphToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
      {/* Focused SKU */}
      <span className="text-[13px] font-semibold text-gray-900">
        {focusedLabel ?? <span className="font-medium text-gray-400">No SKU focused</span>}
      </span>

      {/* Mode toggle */}
      <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-0.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onModeChange(m.id)}
            className={cn(
              'ds-raw-button rounded-lg px-3 py-1.5 text-label font-medium transition-colors',
              mode === m.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="ml-auto">
        <Button size="sm" variant="primary" icon={<Plus />} onClick={onAddConnection} disabled={!canAdd}>
          Add Connection
        </Button>
      </div>
    </div>
  );
}
