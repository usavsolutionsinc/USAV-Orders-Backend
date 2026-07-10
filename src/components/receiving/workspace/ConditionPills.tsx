'use client';

import { useRef, useState } from 'react';
import { Pencil, Lock } from '@/components/Icons';
import { CONDITION_GRADES, conditionLabel, conditionDescription } from '@/lib/conditions';
import { conditionPillClass } from '@/lib/condition-tone';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { useHorizontalWheelScroll } from '@/hooks/useHorizontalWheelScroll';

interface Props {
  value: string | null | undefined;
  onChange: (next: string) => void;
  /**
   * When set, the picker starts as the full row (PO just opened → pick a
   * grade) and collapses to ONLY the selected pill + an edit pencil once a
   * grade is chosen — mirroring the serial copy-chip. Clicking the pencil (or
   * the pill) re-expands the full row.
   */
  collapsible?: boolean;
  /**
   * Controlled expanded state (collapsible mode only). When provided, the
   * parent owns expand/collapse — e.g. SerialCard collapses the picker while a
   * serial is being edited. Leave undefined to let the component self-manage.
   */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /**
   * Collapsible mode only. When false, the collapsed state renders JUST the edit
   * pencil (no selected-grade pill) — used where another surface already shows
   * the chosen grade (e.g. the PO-line meta row's condition chip), so the pill
   * would be a redundant second label directly beneath it. Defaults to true (the
   * copy-chip-style "selected pill + pencil") for surfaces where the collapsed
   * pill is the only grade readout (the unmatched / add-item flows).
   */
  collapsedLabel?: boolean;
  /**
   * Locked / non-interactive. Renders only the selected grade as a single static
   * pill with a lock affordance — no other grades, no edit, no `onChange`. Used
   * once an order has shipped (condition is frozen). Takes precedence over
   * `collapsible`.
   */
  readOnly?: boolean;
}

// Single flat row of grades, in display order. Used grades (A / B / C) are
// shown bare; retail-ready grades + parts follow — no "USED"/"NEW+" parents.
// Labels come from the shared `pill` variant (src/lib/conditions.ts) so the
// picker copy stays in lockstep with every other grade display.
const GRADES = CONDITION_GRADES.map((value) => ({
  value,
  label: conditionLabel(value, 'pill'),
}));

/**
 * Bare, mobile-first condition picker. Renders every grade as a single
 * horizontally-scrolling row of pills — no nested parents. In `collapsible`
 * mode it folds to the selected pill + an edit pencil after a grade is chosen.
 */
export function ConditionPills({
  value,
  onChange,
  collapsible = false,
  expanded: expandedProp,
  onExpandedChange,
  collapsedLabel = true,
  readOnly = false,
}: Props) {
  const selected = String(value || '').trim().toUpperCase();
  const selectedGrade = GRADES.find((g) => g.value === selected) ?? null;
  // The scrollbar is hidden, so without this a mouse wheel scrolls the parent
  // panel vertically and the overflowing grades (USED_C / PARTS) are
  // unreachable in narrow hosts like the shipped details sidebar.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Collapsible variant starts EXPANDED on mount (the SerialCard remounts per
  // line, so opening a PO line always shows the full row for selection); it
  // collapses to the chosen pill once a grade is picked. The parent may take
  // control via `expanded`/`onExpandedChange` (e.g. collapse while editing a
  // serial); otherwise it's self-managed.
  const [internalExpanded, setInternalExpanded] = useState(true);
  const expanded = expandedProp ?? internalExpanded;
  const setExpanded = (next: boolean) => {
    onExpandedChange?.(next);
    if (expandedProp === undefined) setInternalExpanded(next);
  };
  // The row scroller remounts across collapse/expand, so `expanded` re-binds
  // the wheel listener to the fresh element.
  useHorizontalWheelScroll(scrollerRef, expanded);

  // Locked: order has shipped, so the grade is frozen. Render just the selected
  // pill (styled active) with a lock affordance — no other grades, no click.
  if (readOnly) {
    return (
      <div role="group" aria-label="Condition grade (locked after shipping)" className="flex w-fit items-center gap-1.5">
        <HoverTooltip label="Condition locked after shipping" asChild focusable={false}>
          <span
            className={`${conditionPillClass(selectedGrade?.value ?? selected, true)} inline-flex cursor-default items-center gap-1`}
          >
            {selectedGrade?.label ?? 'Not graded'}
            <Lock className="h-3 w-3 opacity-70" />
          </span>
        </HoverTooltip>
      </div>
    );
  }

  // Collapsed: only the selected pill + an edit pencil (mirrors the copy-chip).
  // When `collapsedLabel` is off, the grade is already shown elsewhere (the meta
  // row chip), so collapse to just the edit pencil — no redundant second label.
  if (collapsible && !expanded && selectedGrade) {
    return (
      <div role="radiogroup" aria-label="Condition grade" className="flex w-fit items-center gap-1.5">
        {collapsedLabel ? (
          <HoverTooltip label={conditionDescription(selectedGrade.value)} asChild focusable={false}>
            {/* ds-raw-button: segmented condition-grade toggle — leave hand-rolled */}
            <button
              type="button"
              aria-label={`Condition ${selectedGrade.label} — change`}
              onClick={() => setExpanded(true)}
              className={`${conditionPillClass(selectedGrade.value, true)} ds-raw-button`}
            >
              {selectedGrade.label}
            </button>
          </HoverTooltip>
        ) : null}
        <HoverTooltip
          label={collapsedLabel ? 'Edit condition' : `Condition ${selectedGrade.label} — change`}
          asChild
          focusable={false}
        >
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={collapsedLabel ? 'Edit condition' : `Condition ${selectedGrade.label} — change`}
            className="ds-raw-button rounded p-0.5 text-text-faint transition-colors hover:bg-surface-sunken hover:text-text-muted"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </HoverTooltip>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      role="radiogroup"
      aria-label="Condition grade"
      className="-mx-1 flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {GRADES.map((g) => (
        <HoverTooltip key={g.value} label={conditionDescription(g.value)} asChild focusable={false}>
          {/* ds-raw-button: segmented condition-grade toggle — leave hand-rolled */}
          <button
            type="button"
            role="radio"
            aria-checked={selected === g.value}
            onClick={() => {
              onChange(g.value);
              if (collapsible) setExpanded(false);
            }}
            className={`${conditionPillClass(g.value, selected === g.value)} ds-raw-button`}
          >
            {g.label}
          </button>
        </HoverTooltip>
      ))}
    </div>
  );
}
