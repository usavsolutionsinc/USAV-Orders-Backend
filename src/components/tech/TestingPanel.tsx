'use client';

import { useState } from 'react';
import { toast } from '@/lib/toast';
import { Loader2, Printer } from '@/components/Icons';
import { deriveColorFromTitle, printProductLabel } from '@/lib/print/printProductLabel';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import { CartonContextCard } from '@/components/receiving/workspace/line-edit/CartonContextCard';
import { LineEditToolbar } from '@/components/receiving/workspace/line-edit/LineEditToolbar';
import { PoLinesAccordion } from '@/components/receiving/workspace/PoLinesAccordion';
import { UnmatchedItemsSection } from '@/components/receiving/workspace/UnmatchedItemsSection';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import { ReceivingAuditModal } from '@/components/receiving/workspace/ReceivingAuditModal';
import { LineNotesCard } from '@/components/receiving/workspace/line-edit/LineNotesCard';
import { LabelPreviewCard } from '@/components/labels/LabelPreviewCard';
import type { ProductLabelDraft } from '@/components/labels/ProductLabelEditPopover';
import { TestingLinePanel, type UnitSlotSerial } from '@/components/tech/TestingUnitSlots';
import { SkuTestingPanel } from '@/components/tech/SkuTestingPanel';
import { SkuPairingModal } from '@/components/products/pairing/SkuPairingModal';
import { unitStatusToVerdict } from '@/components/receiving/workspace/TestingStatusPills';
import {
  dispatchLineUpdated,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import {
  useTestingLineController,
  TESTING_PRINT_QTY_OPTIONS,
} from '@/components/tech/hooks/useTestingLineController';

const SECTION = 'rounded-2xl bg-white p-4 ring-1 ring-gray-200/70';

/**
 * Right-pane TESTING display. Anchored on LineEditPanel's composition — the same
 * shared cards (CartonContextCard header, PoLinesAccordion) and the unified
 * mode-driven toolbar — but the active-row slot renders verdict pills instead of
 * condition, and the terminal action is Pass + Print instead of Print · receive.
 * Receives a non-null `row` from TestingLineWorkspace; all logic lives in
 * useTestingLineController (which composes the shared useReceivingLineCore).
 */
export function TestingPanel({ row, staffId }: { row: ReceivingLineRow; staffId: string }) {
  // Display title always comes from the Zoho SKU's own title (items.name, the
  // canonical SoT) — NOT the PO line's listing-style item_name. Fall back to the
  // marketplace catalog title, then item_name, only when there's no Zoho item.
  const rowTitle =
    (row.zoho_item_title ?? '').trim() ||
    (row.catalog_product_title ?? '').trim() ||
    (row.item_name ?? '').trim();
  // Label-face overrides set from the Edit-label popover. Color prefills from the
  // SKU title (manual + title-derived, per the v1 plan); title can be shortened.
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const labelColor = (colorOverride ?? deriveColorFromTitle(rowTitle)).trim();
  const productTitle = titleOverride ?? rowTitle;
  const c = useTestingLineController(row, staffId, { labelColor });
  const {
    // toolbar / sync
    saving, copyingAll, handleCopyAll, setAuditOpen,
    // carton identity (from core)
    listingLink, setListingLink, listingEditorOpen, setListingEditorOpen, listingOpenHref,
    poOpenHref, trackingOpenHref, poNumber,
    poEditorOpen, setPoEditorOpen, poNumberEdit, setPoNumberEdit, persistPoNumber,
    zendesk, zendeskTrimmed, zendeskHref, zendeskChipDisplay, setZendesk,
    primaryTrackingTrimmed, filledExtraTrackingsCount, trackingEditorsOpen, toggleTrackingEditors,
    trackingEdit, setTrackingEdit, extraTrackings, setExtraTrackings, attachExtraBox,
    sourcePlatform, setSourcePlatform, savePlatform,
    receivingType, setReceivingType, saveType,
    priorityTier, handlePrioritySelect, patch,
    // testing
    notes, setNotes, serialSubmitting, headerSerialEdit, setHeaderSerialEdit, isMutating,
    activeSlot, activeSerial, activeAllocation, previewPayload, printQty, setPrintQty, isPrinting,
    activeSlotByLine, setActiveSlotByLine,
    handleSlotVerdict, applyLineVerdict, deriveLineVerdict,
    enqueueSerial, deleteSerial, replaceSerial, setLineNeedsTest, handlePrimary,
    // modals
    auditOpen, claimOpen, setClaimOpen, pairOpen, setPairOpen,
  } = c;

  const activeVerdict = unitStatusToVerdict(activeSerial?.current_status);
  const hasSku = Boolean((row.sku || '').trim());
  const hasActiveSerial = activeSerial != null;
  const primaryDisabled =
    !hasActiveSerial || activeVerdict !== 'PASS' || isPrinting || saving || !hasSku || row.receiving_id == null;
  const primaryTitle = row.receiving_id == null
    ? 'Line is not linked to a carton'
    : !hasSku
      ? 'Line has no SKU — link a product before printing'
      : !hasActiveSerial
        ? 'Scan a serial for this slot before printing'
        : activeVerdict == null
          ? 'Pick a testing verdict for this unit first'
          : activeVerdict !== 'PASS'
            ? 'Only Pass produces a label — Test Again re-queues; Testing Failed opens claim'
            : `Print ${printQty}× tested-OK label${printQty === 1 ? '' : 's'} for this unit`;
  const primaryLabel = isPrinting
    ? `Printing ${printQty}×…`
    : !hasSku
      ? 'Pass · No SKU'
      : !hasActiveSerial
        ? 'Pass · No Serial'
        : `Pass · Print ${printQty}× Label${printQty === 1 ? '' : 's'}`;

  return (
    <>
    <div className="relative flex h-full min-h-0 flex-col bg-gray-50">
      <LineEditToolbar
        mode="testing"
        receivingId={row.receiving_id ?? null}
        busy={saving || isMutating}
        copyingAll={copyingAll}
        pairing={pairOpen}
        handlers={{
          audit: () => setAuditOpen(true),
          pair: row.sku_catalog_id != null ? () => setPairOpen(true) : undefined,
          copy: () => void handleCopyAll(),
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6">
          <CartonContextCard
            receivingId={row.receiving_id ?? null}
            staffId={staffId}
            isUnmatched={row.receiving_source === 'unmatched'}
            showStaffPhotoRow
            onMakeClaim={() => setClaimOpen(true)}
            listingLink={listingLink}
            setListingLink={setListingLink}
            listingEditorOpen={listingEditorOpen}
            setListingEditorOpen={setListingEditorOpen}
            listingOpenHref={listingOpenHref}
            poOpenHref={poOpenHref}
            trackingOpenHref={trackingOpenHref}
            poDisplay={poNumber}
            poEditorOpen={poEditorOpen}
            setPoEditorOpen={setPoEditorOpen}
            poNumberEdit={poNumberEdit}
            setPoNumberEdit={setPoNumberEdit}
            onCommitPoNumber={(v) => {
              const trimmed = v.trim();
              const current = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
              if (trimmed !== current) void persistPoNumber(trimmed);
            }}
            lineId={row.id ?? null}
            zendeskTrimmed={zendeskTrimmed}
            zendeskHref={zendeskHref}
            zendeskChipDisplay={zendeskChipDisplay}
            onTicketUnlinked={() => {
              setZendesk('');
              dispatchLineUpdated({ id: row.id, zendesk_ticket: null, notes: row.notes });
            }}
            primaryTrackingTrimmed={primaryTrackingTrimmed}
            filledExtraTrackingsCount={filledExtraTrackingsCount}
            trackingEditorsOpen={trackingEditorsOpen}
            onToggleTrackingEditors={toggleTrackingEditors}
            trackingEdit={trackingEdit}
            setTrackingEdit={setTrackingEdit}
            onCommitTracking={(v) => {
              const trimmed = v.trim();
              if (trimmed !== (row.tracking_number || '').trim()) {
                patch({ zoho_reference_number: trimmed || null });
              }
            }}
            extraTrackings={extraTrackings}
            setExtraTrackings={setExtraTrackings}
            onCommitExtraTracking={(v, i) => void attachExtraBox(v, i)}
            platformValue={sourcePlatform}
            onPlatformSelect={(next) => {
              setSourcePlatform(next);
              void savePlatform(next);
            }}
            receivingType={receivingType}
            onTypeSelect={(next) => {
              setReceivingType(next);
              void saveType(next);
            }}
            priorityTier={priorityTier}
            onPrioritySelect={(tier) => void handlePrioritySelect(tier)}
          />

          {/* PO Items — verdict pills + serial scan per unit. Same accordion as
              receiving; only the active-row slot differs (verdict vs condition). */}
          {row.receiving_id != null ? (
            row.receiving_source === 'unmatched' ? (
              <UnmatchedItemsSection
                receivingId={row.receiving_id}
                renderLineActions={(line) => {
                  const lineSerials = (line.serials ?? []) as UnitSlotSerial[];
                  return (
                    <TestingLinePanel
                      lineId={line.id}
                      saved={lineSerials}
                      expected={line.quantity_expected ?? null}
                      verdict={deriveLineVerdict(lineSerials)}
                      isMutating={isMutating}
                      isSubmitting={serialSubmitting}
                      disabled={saving}
                      selectedIndex={activeSlotByLine[line.id] ?? 0}
                      onSelectIndex={(i) => setActiveSlotByLine((m) => ({ ...m, [line.id]: i }))}
                      onSetVerdict={(next) => void applyLineVerdict(line.id, lineSerials, next)}
                      onSetUnitVerdict={(serial, next) => void handleSlotVerdict(line.id, serial, next)}
                      onAddSerial={(sn) => enqueueSerial(line.id, sn)}
                      onDeleteSerial={(s) => {
                        if (s.id == null) return;
                        if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                        void deleteSerial(line.id, s.id);
                      }}
                      onReplaceSerial={(original, next) => void replaceSerial(line.id, original, next)}
                    />
                  );
                }}
              />
            ) : (
              <PoLinesAccordion
                receivingId={row.receiving_id}
                activeLineId={row.id}
                hideNoTestLines
                activeSerialActions={{
                  editingSerialId: headerSerialEdit?.id ?? null,
                  onEdit: (s) => setHeaderSerialEdit(s as UnitSlotSerial),
                  onDelete: (s, lineId) => {
                    if (s.id == null) return;
                    if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                    if (headerSerialEdit?.id === s.id) setHeaderSerialEdit(null);
                    void deleteSerial(lineId, s.id);
                  },
                }}
                activeRowSlot={({ serials }) => {
                  const lineSerials = serials as UnitSlotSerial[];
                  return (
                    <TestingLinePanel
                      lineId={row.id}
                      saved={lineSerials}
                      expected={row.quantity_expected ?? null}
                      verdict={deriveLineVerdict(lineSerials)}
                      isMutating={isMutating}
                      isSubmitting={serialSubmitting}
                      disabled={row.receiving_id == null || saving}
                      autoFocus
                      showSavedChips={false}
                      editingSerial={headerSerialEdit}
                      onEditingSerialChange={setHeaderSerialEdit}
                      selectedIndex={activeSlot}
                      onSelectIndex={(i) => setActiveSlotByLine((m) => ({ ...m, [row.id]: i }))}
                      onSetVerdict={(next) => void applyLineVerdict(row.id, lineSerials, next)}
                      onSetUnitVerdict={(serial, next) => void handleSlotVerdict(row.id, serial, next)}
                      onAddSerial={(sn) => enqueueSerial(row.id, sn)}
                      onDeleteSerial={(s) => {
                        if (s.id == null) return;
                        if (!window.confirm(`Remove serial ${s.serial_number}?`)) return;
                        void deleteSerial(row.id, s.id);
                      }}
                      onReplaceSerial={(original, next) => void replaceSerial(row.id, original, next)}
                    />
                  );
                }}
              />
            )
          ) : null}

          {/* SKU testing panel — checklist edit + manuals. */}
          {row.sku ? (
            <SkuTestingPanel
              receivingLineId={row.id}
              sku={row.sku}
              title={productTitle}
              serialUnitId={activeSerial?.id ?? null}
            />
          ) : null}

          {/* Needs-test toggle (per-line). Priority is the urgency pill in the
              header now (shared with unbox), so it's no longer duplicated here. */}
          {row.receiving_id ? (
            <section className={SECTION}>
              <label className="flex cursor-pointer items-center gap-2 text-caption font-bold text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-600"
                  checked={row.needs_test !== false}
                  onChange={(e) => setLineNeedsTest(e.target.checked)}
                />
                Needs test <span className="font-medium text-gray-400">(this item)</span>
              </label>
            </section>
          ) : null}

          {/* Notes (per-line) — same shared card the unbox panel uses. */}
          <LineNotesCard
            value={notes}
            onChange={setNotes}
            onBlur={() => {
              const next = notes.trim();
              if (next !== (row.notes || '')) patch({ notes: next || null });
            }}
          />

          {previewPayload && row.sku ? (
            <LabelPreviewCard
              sku={activeAllocation?.unitId || row.sku}
              title={productTitle}
              condition={row.condition_grade}
              color={labelColor}
              dataMatrixValue={previewPayload.value}
              dataMatrixSymbology={previewPayload.symbology}
              onApplyAndPrint={(draft: ProductLabelDraft) => {
                setColorOverride(draft.color);
                setTitleOverride(draft.title);
                if ((draft.condition || '') !== (row.condition_grade || '')) {
                  patch({ condition_grade: draft.condition });
                }
                printProductLabel({
                  sku: activeAllocation?.unitId || row.sku || '',
                  title: draft.title,
                  serialNumber: activeSerial?.serial_number,
                  gtin: activeAllocation?.gtin ?? undefined,
                  qrPayload: activeAllocation?.qrUrl ?? undefined,
                  condition: draft.condition,
                  color: draft.color,
                });
              }}
            />
          ) : null}
        </div>
      </div>

      <StickyActionBar
        floating
        primary={{
          label: primaryLabel,
          onClick: () => void handlePrimary(),
          disabled: primaryDisabled,
          isLoading: isPrinting,
          icon: isPrinting ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Printer className="h-4 w-4 shrink-0" />,
          toneClasses: { bg: 'bg-emerald-600', hover: 'hover:bg-emerald-700' },
          tone: 'emerald',
          menuLabel: 'Pick print quantity',
          menuTitle: 'Print quantity',
          menu: TESTING_PRINT_QTY_OPTIONS.map((qty) => ({
            label: `Print ${qty}× label${qty === 1 ? '' : 's'}`,
            icon: <Printer className="h-3.5 w-3.5 shrink-0" />,
            onClick: () => setPrintQty(qty),
            title: printQty === qty ? 'Currently selected' : `Set quantity to ${qty}`,
          })),
              title: primaryTitle,
        }}
      />
    </div>

    <ReceivingClaimModal
      open={claimOpen}
      row={row}
      onClose={() => setClaimOpen(false)}
      onTicketCreated={(tk) => {
        toast.success(`Claim filed — ${tk}`);
        dispatchLineUpdated({ id: row.id, zendesk_ticket: tk });
      }}
    />

    {row.receiving_id != null ? (
      <ReceivingAuditModal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        receivingId={row.receiving_id}
      />
    ) : null}

    <SkuPairingModal
      open={pairOpen}
      onClose={() => setPairOpen(false)}
      skuCatalogId={row.sku_catalog_id ?? null}
      headerTitle={productTitle}
    />
    </>
  );
}
