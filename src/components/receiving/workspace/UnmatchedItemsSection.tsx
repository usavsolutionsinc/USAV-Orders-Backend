'use client';

/**
 * Items section for an unmatched (no-Zoho-PO) receiving carton.
 *
 * Mounted by {@link LineEditPanel} where {@link PoLinesAccordion} would
 * sit for a Zoho-matched carton. Owns:
 *   - fetching the carton's existing receiving_lines
 *   - the [+] CTA → CartonAddPopover (Item = zoho_catalog search · Web · Box)
 *   - per-line condition pill updates
 *
 * Repair-service linking was retired from here — it now lives in the triage
 * Smart-Matching "Repair Service / Trade in" tab (inline Ecwid order list).
 *
 * Kept deliberately small so LineEditPanel can drop it in without
 * branching on receiving_source for every prop.
 *
 * Thin composition shell: state + handlers live in {@link useUnmatchedItems};
 * the per-line row is {@link UnmatchedLineRow} under `./unmatched-items/`.
 */

import { motion } from 'framer-motion';
import { Loader2, PackageOpen, Pencil, Unlink } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button, IconButton } from '@/design-system/primitives';
import { WorkspaceCard, InlineNotice } from '@/design-system/components';
import { HandlingUnitChip } from '@/components/receiving/HandlingUnitChip';
import { LabelIdentifyButton } from '@/components/receiving/label-identify/LabelIdentifyButton';
import { SerialCard } from '@/components/receiving/workspace/SerialCard';
import { NoSerialControl } from '@/components/receiving/workspace/line-edit/NoSerialControl';
import {
  INTAKE_CLASSIFICATION_OPTS,
  type IntakeClassification,
  type IntakeTone,
} from '@/lib/receiving/intake-classification';
import { useUnmatchedItems } from './unmatched-items/useUnmatchedItems';
import { UnmatchedLineRow } from './unmatched-items/UnmatchedLineRow';
import type { UnmatchedItemsSectionProps } from './unmatched-items/unmatched-items-shared';

// Door-classification pill tones — desktop mirror of the mobile /m/receive
// "Receiving as" selector. Same semantic shades, paired active/inactive.
const INTAKE_PILL_BASE =
  'inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-eyebrow font-black uppercase tracking-widest transition-colors';
const INTAKE_ACTIVE: Record<IntakeTone, string> = {
  slate: 'border-slate-600 bg-slate-600 text-white',
  blue: 'border-blue-600 bg-blue-600 text-white',
  rose: 'border-rose-600 bg-rose-600 text-white',
  amber: 'border-amber-500 bg-amber-500 text-white',
  emerald: 'border-emerald-600 bg-emerald-600 text-white',
};
const INTAKE_INACTIVE: Record<IntakeTone, string> = {
  slate: 'border-border-soft bg-surface-card text-text-muted hover:border-border-default hover:bg-surface-hover',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
};

/**
 * "Receiving as" door-classification pill row — desktop triage parity with the
 * mobile selector. Flat, always-visible (no collapse), one tap re-classifies the
 * carton via the intake-classification SoT. `motion.button` (not raw `<button>`)
 * keeps it off the raw-button ratchet, matching {@link InlinePillPicker}.
 */
function IntakeClassifyRow({
  value,
  onSelect,
}: {
  value: IntakeClassification;
  onSelect: (next: IntakeClassification) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Receiving as</p>
      <div
        role="radiogroup"
        aria-label="Receiving as"
        className="flex flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-hide"
      >
        {INTAKE_CLASSIFICATION_OPTS.map((o) => {
          const active = o.value === value;
          return (
            <motion.button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.label}
              onClick={() => onSelect(o.value)}
              className={`${INTAKE_PILL_BASE} ${active ? INTAKE_ACTIVE[o.tone] : INTAKE_INACTIVE[o.tone]}`}
            >
              {o.label}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export type {
  UnfoundLine,
  UnmatchedLineRenderHelpers,
  UnmatchedItemsSectionProps,
} from './unmatched-items/unmatched-items-shared';

export function UnmatchedItemsSection(props: UnmatchedItemsSectionProps) {
  const {
    receivingId,
    staffId,
    receivingTypeHint = 'PO',
    activeLineId,
    onFileReturnClaim,
    onActiveConditionChange,
    serialAbsent,
    serialAbsentReason,
    requireSerialConfirmation,
    onSerialAbsentChange,
    renderLineActions,
    showSerialScan = true,
    onOpenInUnbox,
    embedded = false,
    headerRight,
  } = props;

  const c = useUnmatchedItems(props);

  // Header actions shared by the standalone card and the embedded form. The edit
  // pencil is dropped when embedded — the POUnboxingSection wrapper supplies the
  // single shared pencil (which also dispatches `receiving-open-pairing-add`).
  const headerActions = (
    <div className="flex items-center gap-1.5">
      {c.assignedBox ? (
        <HandlingUnitChip
          handlingUnitId={c.assignedBox.id}
          code={c.assignedBox.code}
          unitCount={c.assignedBox.total}
          dense
        />
      ) : null}
      {onOpenInUnbox ? (
        <HoverTooltip label="Open this carton in unbox mode (serial scan, photos, receive)" asChild>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={onOpenInUnbox}
            ariaLabel="Open this carton in unbox mode (serial scan, photos, receive)"
            icon={<PackageOpen />}
            className="h-6 gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-blue-700 hover:bg-blue-100"
          >
            Open in unbox
          </Button>
        </HoverTooltip>
      ) : null}
      {/* Repair-service linking is retired here — it now lives in the triage
          Smart-Matching "Repair Service / Trade in" tab. */}
      {!embedded ? (
        <HoverTooltip label="Edit carton items — opens Package Pairing (catalog item, web search, or a box)" asChild>
          <IconButton
            icon={<Pencil className="h-3.5 w-3.5 text-white" />}
            ariaLabel="Edit carton items"
            onClick={() => window.dispatchEvent(new CustomEvent('receiving-open-pairing-add'))}
            className="inline-flex h-6 w-6 items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700"
          />
        </HoverTooltip>
      ) : null}
    </div>
  );

  const body = (
    <>
      <div className="space-y-2">
        {/* Door-classification pill row — desktop triage parity with mobile
            /m/receive. Triage-only (gated on the triage-only onOpenInUnbox CTA)
            so the unbox workspace shows the read-only A4 banner instead. */}
        {onOpenInUnbox ? (
          <IntakeClassifyRow value={c.classification} onSelect={c.saveClassification} />
        ) : null}
        {c.showUnlinkPrompt ? (
          <InlineNotice
            tone="warning"
            size="sm"
            title={
              c.linkError
                ? 'Could not import — order already linked'
                : 'Order linked — no items yet'
            }
          >
            <div className="space-y-2">
              <p className="text-caption text-amber-900">
                {c.linkError ? (
                  <>
                    {c.linkError}
                    {c.linkedOrderNumber ? (
                      <>
                        {' '}
                        This carton is still paired to order{' '}
                        <span className="font-mono font-bold">{c.linkedOrderNumber}</span>.
                      </>
                    ) : null}
                  </>
                ) : c.linkedOrderNumber ? (
                  <>
                    Order{' '}
                    <span className="font-mono font-bold">{c.linkedOrderNumber}</span> is paired to
                    this carton but no line items were imported. Unlink to clear the pairing and
                    scan the serial again.
                  </>
                ) : (
                  'This carton has an order pairing but no line items. Unlink to clear it and try again.'
                )}
              </p>
              <HoverTooltip
                label="Clears the order#, platform, return flags, and per-line source linkage"
                asChild
                focusable={false}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  icon={c.unlinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink />}
                  onClick={() => void c.handleUnlinkOrder()}
                  disabled={c.unlinking}
                  className="h-7 border-rose-200 bg-rose-50 px-2.5 text-rose-700 hover:bg-rose-100"
                >
                  {c.unlinking ? 'Unlinking…' : 'Unlink order'}
                </Button>
              </HoverTooltip>
            </div>
          </InlineNotice>
        ) : null}
        {/* Primary entry for an unfound carton: scan a serial. On a shipped-serial
            match we pull the product details and create + populate the line — no
            manual Add-item step. Rendered as a regular unbox serial card (white
            card chrome + condition pills), not a themed callout. */}
        {showSerialScan ? (
          <SerialCard
            saved={[]}
            expected={null}
            isSubmitting={c.returnScanBusy}
            showSavedChips={false}
            condition={c.cartonScanCondition}
            onConditionChange={(next) => {
              c.setCartonScanCondition(next);
              onActiveConditionChange?.(next);
            }}
            onAdd={(sn) => c.handleReturnSerialScan(sn)}
            noSerialActive={serialAbsent ?? false}
            onMarkNoSerial={
              onSerialAbsentChange
                ? () =>
                    onSerialAbsentChange(
                      serialAbsent
                        ? { absent: false, reason: null }
                        : { absent: true, reason: serialAbsentReason ?? 'NOT_SERIALIZED' },
                    )
                : undefined
            }
            noSerialSlot={
              onSerialAbsentChange ? (
                <NoSerialControl
                  absent
                  reason={serialAbsentReason ?? null}
                  required={requireSerialConfirmation ?? false}
                  onChange={onSerialAbsentChange}
                />
              ) : undefined
            }
            resultSlot={
              // Importing loader — the only feedback surface for the scan.
              // On success the imported line row below (and the bound PO# /
              // platform chips above) ARE the result; no match band.
              c.returnScanBusy ? (
                <div className="flex items-center gap-2 rounded-lg border border-border-soft bg-surface-canvas px-3 py-2 text-caption font-bold uppercase tracking-wider text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                  Matching serial — importing the sales order…
                </div>
              ) : undefined
            }
          />
        ) : null}
        {/* Identify an item by photographing its printed label. The LAN vision box
            OCRs the Bose model, the server resolves it to a catalog SKU, and the
            confirmed candidate is added via the same add-unmatched-line path the
            CartonAddPopover uses. Hidden when no vision box is configured. */}
        <LabelIdentifyButton
          onConfirm={(cand) =>
            c.handleAddLine({
              sku_platform_id_row: null,
              sku_catalog_id: cand.sku_catalog_id,
              sku: cand.sku ?? '',
              item_name: cand.product_title ?? cand.item_name ?? cand.model,
              image_url: cand.image_url,
            })
          }
        />
        {c.lines.map((line) => (
          <UnmatchedLineRow
            key={line.id}
            line={line}
            receivingId={receivingId}
            staffId={staffId}
            receivingType={receivingTypeHint}
            onConditionChange={c.handleConditionChange}
            onRemove={c.handleRemoveLine}
            onFileReturnClaim={onFileReturnClaim}
            renderActions={
              renderLineActions
                ? (helpers) => renderLineActions(line, helpers)
                : undefined
            }
            refresh={c.refreshLines}
          />
        ))}
      </div>

      {/* Add-item is now the Package Pairing "Items" tab (one surface). The pencil
          above dispatches `receiving-open-pairing-add` to open it. */}
    </>
  );

  // Embedded → bare sub-section (eyebrow + content) so the unified
  // POUnboxingSection wrapper owns the single card chrome + edit pencil.
  if (embedded) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-caption font-bold uppercase tracking-[0.14em] text-text-soft">
            PO items · {c.lines.length}
          </h3>
          <div className="flex items-center gap-1.5">
            {headerActions}
            {headerRight ?? null}
          </div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <WorkspaceCard label={`PO items · ${c.lines.length}`} actions={headerActions}>
      {body}
    </WorkspaceCard>
  );
}
