'use client';

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AnchoredLayer } from '@/design-system/primitives/AnchoredLayer';
import { User, ChevronDown, Check } from '@/components/Icons';
import { StaffButtonGrid, type StaffOption } from '@/components/shipping/StaffButtonGrid';
import { cn } from '@/utils/_cn';

export interface StaffFilterProps {
  /** All-staff default = null. A positive id narrows to one staff. */
  selectedId: number | null;
  /** Picker options (active staff, optionally role-scoped). */
  options: StaffOption[];
  /** null clears back to ALL staff. */
  onSelect: (id: number | null) => void;
  /** Resolved display name for the active pill (falls back to the id). */
  selectedName?: string | null;
  /** Trigger label when no staff is selected. */
  allLabel?: string;
  className?: string;
}

/**
 * StaffFilter — the ONE shared all-staff ↔ single-staff control (P1-WORK-02).
 *
 * Reused across every mode (Unshipped / Shipped / Receiving / …). Defaults to
 * "All staff" and narrows to one. Mounts as a compact sidebar-band trigger +
 * a portaled popover (AnchoredLayer owns dismissal) that reuses the existing
 * {@link StaffButtonGrid} so the per-staff color theming matches the stations.
 */
export function StaffFilter({
  selectedId,
  options,
  onSelect,
  selectedName,
  allLabel = 'All staff',
  className,
}: StaffFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const active = selectedId != null;
  const triggerLabel = active ? selectedName || `Staff #${selectedId}` : allLabel;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.99 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'flex h-[40px] w-full items-center gap-2.5 bg-white px-3 transition-colors hover:bg-gray-50',
          active || open ? 'text-blue-600' : 'text-gray-500',
        )}
      >
        <User className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left text-micro font-black uppercase tracking-wider">
          {triggerLabel}
        </span>
        {active ? (
          <span className="shrink-0 rounded-full bg-blue-600 px-1.5 text-[9px] font-black leading-4 text-white">
            1
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-300',
            open ? 'rotate-180 text-blue-600' : 'text-gray-400',
          )}
        />
      </motion.button>

      <AnchoredLayer
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={containerRef}
        placement="bottom-stretch"
        gap={8}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
          className="overflow-hidden rounded-3xl border border-white/40 bg-white/90 p-4 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.18)] backdrop-blur-xl ring-1 ring-black/[0.08]"
        >
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors',
                !active
                  ? 'border-blue-300 bg-blue-50 text-gray-900'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
              )}
            >
              {allLabel}
              {!active ? <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" /> : null}
            </button>

            <StaffButtonGrid
              label="Filter to one"
              options={options}
              selectedId={selectedId}
              onSelect={(id) => {
                // Toggle off → back to ALL when the active staff is re-tapped.
                onSelect(id === selectedId ? null : id);
                setOpen(false);
              }}
              columns={2}
              emptyMessage="No active staff"
            />
          </div>
        </motion.div>
      </AnchoredLayer>
    </div>
  );
}
