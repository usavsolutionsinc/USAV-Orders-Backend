'use client';

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, User } from '@/components/Icons';
import { ToolbarButton } from '@/components/ui/ToolbarButton';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useStaffFilter } from '@/hooks/useStaffFilter';

/**
 * `StaffFilterButton` — the ONE shared all-staff ↔ single-staff header control
 * (P1-WORK-02). A {@link ToolbarButton} pill that opens a body-portal popover of
 * active staff and writes the canonical `?staff=` URL param via
 * {@link useStaffFilter}. Absent param = ALL staff (every surface's default);
 * picking the active staff again clears back to ALL.
 *
 * This is the same pattern the dashboard tables use (the unshipped board's
 * staff pill and the ⋮ TableOptionsMenu staff rows) promoted to a reusable
 * control, so Receiving / Packing / Unboxed stay consistent with them. Mount it
 * in a header/mode band; the surface's queries read `?staff=` themselves.
 */
export function StaffFilterButton({
  iconOnly = false,
  align = 'end',
  allLabel = 'All staff',
  className,
}: {
  /** Square icon-only trigger for tight bands (label lives in the tooltip). */
  iconOnly?: boolean;
  align?: 'start' | 'end';
  /** Trigger + reset-row label when no staff is picked (param absent). */
  allLabel?: string;
  className?: string;
}) {
  const { staffId, options, selectedName, setStaff } = useStaffFilter();
  const [open, setOpen] = useState(false);
  const active = staffId != null;
  const label = active ? selectedName || `#${staffId}` : allLabel;

  const Row = ({ id, name }: { id: number | null; name: string }) => {
    const isActive = id === staffId || (id == null && !active);
    return (
      <button
        type="button"
        onClick={() => {
          setStaff(id);
          setOpen(false);
        }}
        className={`ds-raw-button flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-caption font-semibold transition-colors ${
          isActive ? 'bg-surface-accent text-text-accent' : 'text-text-muted hover:bg-surface-hover'
        }`}
      >
        <span className="truncate">{name}</span>
        {isActive ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
      </button>
    );
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {iconOnly ? (
          <ToolbarButton
            active={active}
            iconOnly
            aria-label={`Filter by staff: ${label}`}
            className={className}
          >
            <HoverTooltip label={`Staff filter — ${label}`} focusable={false}>
              <User className="h-3.5 w-3.5 shrink-0" />
            </HoverTooltip>
          </ToolbarButton>
        ) : (
          <ToolbarButton
            active={active}
            aria-label={`Filter by staff: ${label}`}
            className={`max-w-[160px] ${className ?? ''}`}
          >
            <User className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 truncate">{label}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </ToolbarButton>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          className="z-dropdown max-h-[60vh] w-52 overflow-y-auto rounded-lg border border-border-soft bg-surface-card p-1 shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          <Row id={null} name={allLabel} />
          {options.length > 0 ? <div className="my-1 h-px bg-surface-sunken" /> : null}
          {options.map((o) => (
            <Row key={o.id} id={o.id} name={o.name} />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
