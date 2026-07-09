'use client';

import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ToolbarButton } from '@/components/ui/ToolbarButton';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Check, Plus, SlidersHorizontal, Star, Trash2 } from '@/components/Icons';
import { useTableDensity } from '@/hooks/useTableDensity';
import { useSavedViews } from '@/hooks/useSavedViews';
import { TABLE_DENSITIES, TABLE_DENSITY_LABEL, type TableDensity } from '@/lib/tables/table-density';
import type { StationLayout, StationScope } from '@/lib/station/table-url-params';
import type { UseStaffFilterResult } from '@/hooks/useStaffFilter';

/**
 * `TableOptionsMenu` (⋮) — the station tables' options popover
 * (station-table-unification-plan §3.2). It owns the controls that used to be
 * scattered across sidebars + ad-hoc header pills: **Layout** (Pipeline/All),
 * **Staff scope** (My work/All staff) + the fine-grain staff filter, **Row
 * density** (via the `TableDensityProvider`), an optional **Columns** slot, and
 * **Saved views** (apply/save/delete, via the shared {@link useSavedViews}).
 *
 * Every section is optional — a surface passes only what it supports (e.g. the
 * Incoming table has no staff scope). Layout/scope/density write the URL so a
 * shared link reproduces the view; saved views capture only the surface's filter
 * params (never search text). House style: a quiet toolbar trigger opening a
 * body-portal popover; binary choices are `Segment` pill pairs.
 */
export interface TableOptionsMenuProps {
  layout?: { value: StationLayout; onChange: (next: StationLayout) => void };
  scope?: {
    value: StationScope;
    onChange: (next: StationScope) => void;
    /** Fine-grain staff picker, revealed when scope=all. */
    staffFilter?: UseStaffFilterResult;
  };
  /** Show the Row density toggle (reads/writes the nearest TableDensityProvider). */
  showDensity?: boolean;
  /** Saved-views config for this surface. Omit to hide the section. */
  savedViews?: { storageKey: string; paramKeys: readonly string[] };
  /** Extra content rendered as its own "Columns" section (a column list). */
  columnsSlot?: ReactNode;
  align?: 'start' | 'end';
}

/** One eyebrow-labelled section inside the menu. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-2 py-1.5">
      <p className="px-1 pb-1 text-eyebrow font-black uppercase tracking-widest text-text-faint">{label}</p>
      {children}
    </div>
  );
}

/** A pill-pair (or N-pill) segmented control for a small closed choice set. */
function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((o) => {
        const active = o.id === value;
        return (
          // ds-raw-button: compact two-state segmented toggle inside a popover
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`flex-1 rounded-md px-2 py-1 text-caption font-bold transition-colors ${
              active
                ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-400'
                : 'text-text-muted hover:bg-surface-hover'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const LAYOUT_OPTIONS: { id: StationLayout; label: string }[] = [
  { id: 'board', label: 'Pipeline' },
  { id: 'all', label: 'All' },
];
const SCOPE_OPTIONS: { id: StationScope; label: string }[] = [
  { id: 'mine', label: 'My work' },
  { id: 'all', label: 'All staff' },
];
const DENSITY_OPTIONS: { id: TableDensity; label: string }[] = TABLE_DENSITIES.map((d) => ({
  id: d,
  label: TABLE_DENSITY_LABEL[d],
}));

function SavedViewsSection({ storageKey, paramKeys }: { storageKey: string; paramKeys: readonly string[] }) {
  const { views, activeView, hasActiveFilters, applyView, saveView, removeView } = useSavedViews({
    storageKey,
    paramKeys,
  });
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    if (!draft.trim()) return;
    saveView(draft);
    setDraft('');
    setNaming(false);
  };

  return (
    <Section label="Saved views">
      {views.length === 0 ? (
        <p className="px-1 py-1 text-caption italic text-text-faint">No saved views yet.</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto">
          {views.map((view) => {
            const isActive = view.id === activeView?.id;
            return (
              <li key={view.id} className="group flex items-center">
                {/* ds-raw-button: text-left saved-view apply row */}
                <button
                  type="button"
                  onClick={() => applyView(view)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-caption transition-colors hover:bg-surface-hover ${
                    isActive ? 'font-semibold text-text-default' : 'text-text-muted'
                  }`}
                >
                  <Check className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-transparent'}`} />
                  <span className="truncate">{view.name}</span>
                </button>
                {/* ds-raw-button: hover-reveal delete affordance */}
                <button
                  type="button"
                  aria-label={`Delete view ${view.name}`}
                  onClick={() => removeView(view.id)}
                  className="mr-0.5 shrink-0 rounded p-1 text-text-faint opacity-0 transition-all hover:text-rose-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-1 border-t border-border-hairline pt-1.5">
        {naming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
            className="flex items-center gap-1.5"
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Name this view…"
              className="min-w-0 flex-1 rounded-md border border-border-soft px-2 py-1 text-caption outline-none focus:border-blue-400"
            />
            {/* ds-raw-button: inline save submit */}
            <button
              type="submit"
              disabled={!draft.trim()}
              className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-caption font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
            >
              Save
            </button>
          </form>
        ) : (
          <HoverTooltip
            label={hasActiveFilters ? (activeView ? 'These filters are already saved' : 'Save the current filters as a view') : 'Set a filter first'}
            focusable={false}
          >
            {/* ds-raw-button: full-width save-current-view disclosure */}
            <button
              type="button"
              onClick={() => setNaming(true)}
              disabled={!hasActiveFilters || Boolean(activeView)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-caption font-semibold text-text-muted transition-colors hover:bg-surface-hover disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" /> Save current view
            </button>
          </HoverTooltip>
        )}
      </div>
    </Section>
  );
}

export function TableOptionsMenu({
  layout,
  scope,
  showDensity = true,
  savedViews,
  columnsSlot,
  align = 'end',
}: TableOptionsMenuProps) {
  const [open, setOpen] = useState(false);
  const { density, setDensity } = useTableDensity();
  const savedActive = Boolean(savedViews);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ToolbarButton active={open} aria-label="Table options">
          {savedActive ? <Star className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 opacity-70" />}
        </ToolbarButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          className="z-dropdown w-64 divide-y divide-border-hairline overflow-hidden rounded-xl border border-border-soft bg-surface-card shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          {layout ? (
            <Section label="Layout">
              <Segment value={layout.value} options={LAYOUT_OPTIONS} onChange={layout.onChange} />
            </Section>
          ) : null}

          {scope ? (
            <Section label="Staff scope">
              <Segment value={scope.value} options={SCOPE_OPTIONS} onChange={scope.onChange} />
              {scope.value === 'all' && scope.staffFilter ? (
                <div className="mt-1.5 max-h-40 overflow-y-auto">
                  <StaffFilterList staffFilter={scope.staffFilter} />
                </div>
              ) : null}
            </Section>
          ) : null}

          {showDensity ? (
            <Section label="Row density">
              <Segment value={density} options={DENSITY_OPTIONS} onChange={setDensity} />
            </Section>
          ) : null}

          {columnsSlot ? <Section label="Columns">{columnsSlot}</Section> : null}

          {savedViews ? <SavedViewsSection storageKey={savedViews.storageKey} paramKeys={savedViews.paramKeys} /> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Compact staff picker rows for the scope=all fine-grain filter. */
function StaffFilterList({ staffFilter }: { staffFilter: UseStaffFilterResult }) {
  const { staffId, options, setStaff } = staffFilter;
  const Row = ({ id, name }: { id: number | null; name: string }) => {
    const active = id === staffId || (id == null && staffId == null);
    return (
      // ds-raw-button: text-left staff-filter select row
      <button
        type="button"
        onClick={() => setStaff(id)}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-caption font-semibold transition-colors ${
          active ? 'bg-blue-50 text-blue-700' : 'text-text-muted hover:bg-surface-hover'
        }`}
      >
        <span className="truncate">{name}</span>
        {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
      </button>
    );
  };
  return (
    <div>
      <Row id={null} name="All staff" />
      {options.map((o) => (
        <Row key={o.id} id={o.id} name={o.name} />
      ))}
    </div>
  );
}
