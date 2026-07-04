'use client';

/**
 * Custom-print editor for the receiving (PO/carton) label. Opened from the
 * pencil in the label preview card's header. Lets an operator hand-edit the
 * printed *face* of the label — platform + type, center notes, condition, the
 * bottom-right corner (order# / ticket# / tracking#), and the date — then
 * "Save & print".
 *
 * Built for UNFOUND cartons, where the record is missing the info that would
 * normally fill the label, but it's available on every PO-label line so any
 * carton can get a one-off custom print.
 *
 * WYSIWYG: the popover renders the SAME {@link ReceivingPoLabelPreview} the
 * card shows, fed by the live draft via `buildPayload`, so what you see is
 * exactly what prints. The scannable DataMatrix encodes the carton's
 * receiving id (not the face), so editing the text never breaks scanning.
 *
 * Chrome is {@link RightPaneOverlay} (align="center"), matching ReceivingClaimModal
 * — the card sits over the right pane, not the whole viewport.
 *
 * Persistence is "where it can": notes / condition / reference / type write
 * back to the carton record through the controller's handlers; the label-only
 * platform-display, date, and corner choice are kept as a print-time override.
 * All of that lives in the controller — this component only owns draft UI state
 * and hands the final draft back via `onApplyAndPrint`.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Calendar } from '@/design-system/components/Calendar';
import { type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { CornerField } from '@/components/labels/CornerField';
import { useLabelDraft } from '@/components/labels/useLabelDraft';
import { formatLabelDate, parseLabelDate } from '@/components/labels/labelDate';
import { usePlatformCatalog, useReceivingTypeCatalog } from '@/hooks/useCatalog';
import { Calendar as CalendarIcon, ChevronDown, Pencil, Printer, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { ConditionPills } from '../ConditionPills';
import { ReceivingPoLabelPreview } from '../ReceivingPoLabelPreview';
import type { ReceivingLabelPayload } from '../receiving-label-helpers';
import { CatalogManagerPopover, type CatalogKind } from './CatalogManagerPopover';

export type LabelCornerMode = 'order' | 'ticket' | 'tracking';

/** The hand-editable label-face fields. */
export interface LabelEditDraft {
  /** Top-left display string before the " - " (e.g. "Unfound", "eBay"). */
  platform: string;
  /** Receiving type shown after the platform as "Platform - Type". */
  receivingType: string;
  /** Center free text. */
  notes: string;
  /** Bottom-left condition grade code. */
  conditionCode: string;
  /** Which value prints in the bottom-right corner. */
  cornerMode: LabelCornerMode;
  /** Order / PO# (corner when cornerMode === 'order'; empty → `R-{id}`). */
  reference: string;
  /** Ticket # (corner when cornerMode === 'ticket'). */
  ticket: string;
  /** Tracking # (corner when cornerMode === 'tracking'). */
  tracking: string;
  /** Top-right date string (locale m/d/yy). */
  date: string;
}

const FIELD_LABEL = `${microBadge} mb-1.5 block text-text-soft tracking-wider`;
const TEXT_INPUT =
  'w-full rounded-lg border border-border-soft bg-surface-card px-2.5 py-1.5 text-label text-text-default outline-none transition-colors focus:border-blue-500';

// Label-face-only platform displays appended after the org's real platforms.
const PLATFORM_SPECIALS = ['Unfound', 'Local pickup'];

const CORNER_ITEMS: HorizontalSliderItem[] = [
  { id: 'order', label: 'Order #' },
  { id: 'ticket', label: 'Ticket #' },
  { id: 'tracking', label: 'Tracking #' },
];

/** Styled native select with a custom chevron, matching TEXT_INPUT chrome. */
function SelectField({
  value,
  onChange,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={`${TEXT_INPUT} cursor-pointer appearance-none pr-8`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
    </div>
  );
}

/** Field label with a pencil that opens the catalog manager for that list. */
function ManagedFieldLabel({ children, onManage }: { children: ReactNode; onManage: () => void }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className={`${microBadge} text-text-soft tracking-wider`}>{children}</span>
      <HoverTooltip label="Add / edit / delete" asChild>
        <IconButton
          icon={<Pencil className="h-3 w-3" />}
          ariaLabel={`Manage ${typeof children === 'string' ? children.toLowerCase() : 'list'}`}
          onClick={onManage}
          tone="accent"
          className="text-text-faint hover:text-blue-600"
        />
      </HoverTooltip>
    </div>
  );
}

export function LabelEditPopover({
  open,
  defaults,
  buildPayload,
  onApplyAndPrint,
  onClose,
}: {
  open: boolean;
  /** Seed values — re-read every time the popover opens. */
  defaults: LabelEditDraft;
  /** Assembles the exact payload to preview + print from a draft. */
  buildPayload: (draft: LabelEditDraft) => ReceivingLabelPayload;
  /** Persist (where it can) + apply the print-time override + print. */
  onApplyAndPrint: (draft: LabelEditDraft) => void;
  onClose: () => void;
}) {
  const { draft, set } = useLabelDraft<LabelEditDraft>(defaults, open);
  const [calOpen, setCalOpen] = useState(false);
  const [managerKind, setManagerKind] = useState<CatalogKind | null>(null);

  // Org-editable catalogs (fall back to the built-in lists until seeded).
  const platformCat = usePlatformCatalog();
  const typeCat = useReceivingTypeCatalog();
  // Platform dropdown = the org's platform labels + label-face specials, with
  // the current value guaranteed present.
  const platformOptions = useMemo(() => {
    const merged = [...platformCat.options.map((o) => o.label), ...PLATFORM_SPECIALS];
    if (draft.platform && !merged.includes(draft.platform)) merged.unshift(draft.platform);
    return Array.from(new Set(merged));
  }, [platformCat.options, draft.platform]);

  // Reseed of the draft itself happens in useLabelDraft on the open transition;
  // also collapse the calendar when the popover (re)opens.
  useEffect(() => {
    if (open) setCalOpen(false);
  }, [open]);

  const preview = useMemo(() => buildPayload(draft), [buildPayload, draft]);
  const selectedDate = parseLabelDate(draft.date);

  // Bottom-right corner: which draft field the single input maps to, plus its
  // placeholder + sanitizing, switched by the active mode.
  const cornerValue =
    draft.cornerMode === 'order'
      ? draft.reference
      : draft.cornerMode === 'ticket'
        ? draft.ticket
        : draft.tracking;
  const cornerPlaceholder =
    draft.cornerMode === 'order'
      ? 'Order / PO# — e.g. PO-1234'
      : draft.cornerMode === 'ticket'
        ? 'Ticket # — e.g. 12345'
        : 'Tracking # — full carrier number';
  const onCornerValue = (v: string) => {
    if (draft.cornerMode === 'order') set('reference', v);
    else if (draft.cornerMode === 'ticket') set('ticket', v.replace(/[^\d]/g, ''));
    else set('tracking', v);
  };

  return (
    <>
    <RightPaneOverlay
      open={open}
      onClose={onClose}
      align="center"
      aria-label="Edit label"
      className="w-[min(94%,38rem)] rounded-2xl border-0 shadow-2xl ring-1 ring-border-soft"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-hairline px-5 py-3">
        <span className={`${microBadge} flex items-center gap-1.5 text-text-muted`}>
          <Pencil className="h-3.5 w-3.5 text-text-soft" />
          Edit label
        </span>
        <IconButton
          icon={<X className="h-4 w-4" />}
          ariaLabel="Close"
          onClick={onClose}
          className="rounded-lg p-1.5 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
        />
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* Live preview — identical to the printed face. */}
        <div className="mb-4 rounded-xl border border-border-soft/80 bg-surface-card px-3 py-3 shadow-sm">
          <ReceivingPoLabelPreview {...preview} embedded />
        </div>

        <div className="space-y-3.5">
          {/* Platform · Type · Date — one condensed row of dropdowns. */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <ManagedFieldLabel onManage={() => setManagerKind('platform')}>Platform</ManagedFieldLabel>
              <SelectField value={draft.platform} onChange={(v) => set('platform', v)} ariaLabel="Platform">
                {platformOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </SelectField>
            </div>
            <div>
              <ManagedFieldLabel onManage={() => setManagerKind('type')}>Type</ManagedFieldLabel>
              <SelectField
                value={draft.receivingType || 'PO'}
                onChange={(v) => set('receivingType', v)}
                ariaLabel="Receiving type"
              >
                {typeCat.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
            </div>
            <div>
              <label className={FIELD_LABEL}>Date</label>
              <Popover.Root open={calOpen} onOpenChange={setCalOpen}>
                <Popover.Trigger asChild>
                  {/* ds-raw-button: Radix Popover.Trigger asChild (select-like date trigger), not a DS Button */}
                  <button
                    type="button"
                    className={`${TEXT_INPUT} flex items-center justify-between gap-2 text-left`}
                  >
                    <span className={`truncate ${draft.date ? '' : 'text-text-faint'}`}>
                      {draft.date || 'Pick'}
                    </span>
                    <CalendarIcon className="h-4 w-4 shrink-0 text-text-faint" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="end"
                    sideOffset={6}
                    // panelOverlay (130) clears the RightPaneOverlay panel (120).
                    className="z-panelOverlay rounded-xl border border-border-soft bg-surface-card shadow-lg ring-1 ring-black/5 focus:outline-none"
                  >
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      defaultMonth={selectedDate}
                      onSelect={(d?: Date) => {
                        if (d) set('date', formatLabelDate(d));
                        setCalOpen(false);
                      }}
                    />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>
          </div>

          <div>
            <label className={FIELD_LABEL}>Condition</label>
            <ConditionPills value={draft.conditionCode} onChange={(g) => set('conditionCode', g)} />
          </div>

          <div>
            <label className={FIELD_LABEL}>Bottom-right corner</label>
            <CornerField
              items={CORNER_ITEMS}
              mode={draft.cornerMode}
              onModeChange={(id) => set('cornerMode', id as LabelCornerMode)}
              value={cornerValue}
              onValueChange={onCornerValue}
              placeholder={cornerPlaceholder}
              inputMode={draft.cornerMode === 'ticket' ? 'numeric' : 'text'}
              ariaLabel="Bottom-right corner shows order, ticket, or tracking number"
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>Notes (center text)</label>
            <textarea
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Anything to print across the middle…"
              className={`${TEXT_INPUT} resize-none`}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-hairline bg-surface-canvas px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<Printer className="h-3.5 w-3.5" />}
          onClick={() => {
            onApplyAndPrint(draft);
            onClose();
          }}
        >
          Save &amp; print
        </Button>
      </div>
    </RightPaneOverlay>

    {/* Catalog CRUD manager — opened by the pencil beside Platform / Type. */}
    <CatalogManagerPopover
      open={managerKind != null}
      kind={managerKind ?? 'platform'}
      onClose={() => setManagerKind(null)}
    />
    </>
  );
}
