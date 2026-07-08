'use client';

import { useMemo, useState } from 'react';
import { Printer } from '@/components/Icons';
import { deriveColorFromTitle, resolveTestingLineTitle } from '@/lib/print/printProductLabel';
import { receivingPayloadToFace } from '@/lib/print/printReceivingLabel';
import { FloatingButton } from '@/design-system/primitives';
import { LineEditToolbar } from '@/components/receiving/workspace/line-edit/LineEditToolbar';
import { LabelEditPopover, type LabelEditDraft } from '@/components/receiving/workspace/line-edit/LabelEditPopover';
import { LineTestingTabbedCard, TESTING_OPEN_SKU_PAIRING_EVENT } from '@/components/receiving/workspace/line-edit/LineTestingTabbedCard';
import { LabelPreviewCard } from '@/components/labels/LabelPreviewCard';
import type { ProductLabelDraft } from '@/components/labels/ProductLabelEditPopover';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { useTestingLineController } from '@/components/tech/hooks/useTestingLineController';
import { useTestingPrimaryAction } from './testing-panel/useTestingPrimaryAction';
import { TestingCartonHeader } from './testing-panel/TestingCartonHeader';
import { LabelTypeSelect, type LabelTypeOption } from './testing-panel/LabelTypeSelect';
import { TestingTicketReplyCard } from './testing-panel/TestingTicketReplyCard';
import { TestingPoUnboxingSection } from './testing-panel/TestingPoUnboxingSection';
import { TestingPanelModals } from './testing-panel/TestingPanelModals';

/**
 * Right-pane TESTING display. Anchored on LineEditPanel's composition — the same
 * shared cards (CartonContextCard header, PoLinesAccordion) and the unified
 * mode-driven toolbar — but the active-row slot renders verdict pills instead of
 * condition, and the terminal action is Pass + Print instead of Print · receive.
 *
 * Thin composition layer — all logic lives in `useTestingLineController`; the
 * header / active rows / modals / primary action live under `./testing-panel/`.
 */
export function TestingPanel({ row, staffId }: { row: ReceivingLineRow; staffId: string }) {
  const rowTitle = resolveTestingLineTitle(row);
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const labelColor = (colorOverride ?? deriveColorFromTitle(rowTitle)).trim();
  const productTitle = titleOverride ?? rowTitle;

  const c = useTestingLineController(row, staffId, { labelColor });
  const { primaryDisabled, primaryLabel, primaryTitle } = useTestingPrimaryAction(c, row);

  // ── Label preview selector ────────────────────────────────────────────────
  // The label preview's top-left dropdown picks which label is queued for print:
  // the per-unit testing label (default) or the main carton label. Options are
  // gated by availability; a line with no SKU still exposes the carton label.
  const unitLabelAvailable = Boolean(c.previewPayload && row.sku);
  const cartonLabelAvailable = Boolean(c.cartonLabelPayload);
  const labelOptions = useMemo<LabelTypeOption[]>(() => {
    const opts: LabelTypeOption[] = [];
    if (unitLabelAvailable) opts.push({ key: 'unit', name: 'Unit label' });
    if (cartonLabelAvailable) opts.push({ key: 'carton', name: 'Carton label' });
    return opts;
  }, [unitLabelAvailable, cartonLabelAvailable]);

  const [selectedLabel, setSelectedLabel] = useState('unit');
  const [cartonEditorOpen, setCartonEditorOpen] = useState(false);
  // Clamp to an available option — Unit is the testing-page default, falling
  // back to Carton on a line with no unit label.
  const activeLabel = labelOptions.some((o) => o.key === selectedLabel)
    ? selectedLabel
    : labelOptions[0]?.key ?? 'unit';
  const showCartonLabel = activeLabel === 'carton';

  const cartonFace = useMemo(
    () => (c.cartonLabelPayload ? receivingPayloadToFace(c.cartonLabelPayload) : null),
    [c.cartonLabelPayload],
  );

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col bg-surface-canvas">
        <LineEditToolbar
          mode="testing"
          receivingId={row.receiving_id ?? null}
          busy={c.saving || c.isMutating}
          copyingAll={c.copyingAll}
          handlers={{
            audit: () => c.setAuditOpen(true),
            pair:
              row.sku_catalog_id != null
                ? () => window.dispatchEvent(new CustomEvent(TESTING_OPEN_SKU_PAIRING_EVENT))
                : undefined,
            copy: () => void c.handleCopyAll(),
          }}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6">
            <TestingCartonHeader c={c} row={row} staffId={staffId} />

            <TestingPoUnboxingSection c={c} row={row} staffId={staffId} />

            <LineTestingTabbedCard
              notes={c.notes}
              onChange={c.setNotes}
              onBlur={() => {
                const next = c.notes.trim();
                if (next !== (row.notes || '')) c.patch({ notes: next || null });
              }}
              skuCatalogId={row.sku_catalog_id ?? null}
              headerTitle={productTitle}
              receivingLineId={row.id}
              sku={row.sku}
              serialUnitId={c.activeSerial?.id ?? null}
            />

            {c.providerTicketId != null && c.providerTicketId > 0 ? (
              <TestingTicketReplyCard
                ticketId={c.providerTicketId}
                ticketNumber={`#${c.providerTicketId}`}
                ticketUrl={c.zendeskHref}
              />
            ) : null}

            {labelOptions.length > 0 ? (
              <>
                <LabelPreviewCard
                  sku={c.activeAllocation?.unitId || row.sku || ''}
                  title={productTitle}
                  condition={row.condition_grade}
                  color={labelColor}
                  dataMatrixValue={c.previewPayload?.value ?? ''}
                  dataMatrixSymbology={c.previewPayload?.symbology ?? 'datamatrix'}
                  headerLeft={
                    <LabelTypeSelect
                      value={activeLabel}
                      options={labelOptions}
                      onChange={(key) => {
                        setSelectedLabel(key);
                        setCartonEditorOpen(false);
                      }}
                    />
                  }
                  faceOverride={showCartonLabel ? cartonFace : undefined}
                  // Both labels share ONE CTA: the header pencil → editor → Save & print.
                  onEdit={showCartonLabel ? () => setCartonEditorOpen(true) : undefined}
                  onApplyAndPrint={(draft: ProductLabelDraft) => {
                    setColorOverride(draft.color);
                    setTitleOverride(draft.title);
                    if ((draft.condition || '') !== (row.condition_grade || '')) {
                      c.patch({ condition_grade: draft.condition });
                    }
                    void c.handleApplyAndPrint({
                      title: draft.title,
                      color: draft.color,
                      condition: draft.condition,
                    });
                  }}
                />
                {cartonLabelAvailable ? (
                  <LabelEditPopover
                    open={showCartonLabel && cartonEditorOpen}
                    defaults={c.cartonLabelDraftDefaults}
                    buildPayload={c.buildCartonLabelPayload}
                    onApplyAndPrint={(draft: LabelEditDraft) => c.applyCartonLabel(draft)}
                    onClose={() => setCartonEditorOpen(false)}
                  />
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <FloatingButton
          label={primaryLabel}
          onClick={() => void c.handlePrimary()}
          disabled={primaryDisabled}
          loading={c.isPrinting}
          title={primaryTitle}
          icon={<Printer className="h-4 w-4 shrink-0" />}
          tone="emerald"
          maxWidth="max-w-[45rem]"
          fullWidth
        />
      </div>

      <TestingPanelModals c={c} row={row} />
    </>
  );
}
