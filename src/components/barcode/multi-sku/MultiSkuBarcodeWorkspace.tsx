import { Check } from '@/components/Icons';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';
import { SerialCard } from '@/components/receiving/workspace/SerialCard';
import { printProductLabel } from '@/lib/print/printProductLabel';
import type { ProductLabelDraft } from '@/components/labels/ProductLabelEditPopover';
import { MODE_ACCENT_THEME } from './mode-accent';
import { ModeDropdown } from './ModeDropdown';
import {
  WorkspaceCard,
  ModernSkuField,
  ProductContextCard,
  NotesCard,
  PreviewCardModern,
  PreviewPlaceholder,
  comfyHelperHint,
} from './MultiSkuWorkspaceCards';
import type { ConditionGrade, MultiSkuBarcodeController } from './useMultiSkuBarcode';

/** Desktop workspace layout — URL-driven mode, side-by-side inputs + live preview. */
export function MultiSkuBarcodeWorkspace({ b }: { b: MultiSkuBarcodeController }) {
  const { mode } = b;
  const accent = MODE_ACCENT_THEME[mode];
  const showSnCard = !!b.sku.trim() && (mode === 'print' || mode === 'sn-to-sku');
  const showPreviewCard = b.previewIsReady;

  // Print/log is allowed as soon as the user has a SKU and at least one serial.
  // When previewIsReady is false (eager pre-allocation failed or hasn't
  // returned), primaryAction falls through to handleNextStepSn which allocates
  // on demand — so we don't leave the button disabled forever.
  const hasRequiredInputs =
    mode === 'reprint' ? !!b.sku.trim() : !!b.sku.trim() && b.serialNumbers.length > 0;
  const primaryDisabled = b.isPosting || b.isGenerating || !hasRequiredInputs;

  const primaryLabel = b.isPosting
    ? mode === 'print'
      ? 'Saving & Printing…'
      : mode === 'reprint'
        ? 'Reprinting…'
        : 'Logging…'
    : mode === 'print'
      ? 'Save & Print Label'
      : mode === 'reprint'
        ? 'Reprint Label'
        : 'Log to Database';

  const primaryAction = () => (b.previewIsReady ? b.handleFinalAction() : b.handleNextStepSn());

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-gray-50 text-gray-900">
      {/* Mode switcher pinned to the top of the workspace; writes `?mode=`. */}
      <div className="shrink-0 border-b border-gray-200 bg-white">
        <div className="mx-auto w-full max-w-[720px] px-6 py-3">
          <ModeDropdown mode={mode} onChange={b.handleModeChange} />
        </div>
      </div>

      {/* Scrollable hero column */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 py-8 space-y-4 pb-32">
          <WorkspaceCard label="SKU" tone={accent.tone}>
            <ModernSkuField
              value={b.sku}
              inputRef={b.skuInputRef}
              accent={accent}
              onChange={b.handleSkuChange}
              onNext={b.handleNextStepSku}
              onFillAndSearch={b.handleSkuFillAndSearch}
            />
            {comfyHelperHint(mode)}
          </WorkspaceCard>

          {b.sku.trim() && (
            <ProductContextCard title={b.title} stock={b.stock} imageUrl={b.imageUrl} isLoading={b.isLoadingTitle} />
          )}

          {/* Condition + serial share one row — the same scan card the receiving
              workspace uses. */}
          {showSnCard && (
            <SerialCard
              saved={b.serialNumbers.map((sn, idx) => ({ id: idx, serial_number: sn }))}
              expected={null}
              isSubmitting={false}
              onAdd={b.handleSnAdd}
              onDeleteSerial={(s) => b.removeSerial(s.serial_number)}
              onReplaceSerial={(original, next) => {
                b.removeSerial(original.serial_number);
                b.handleSnAdd(next);
              }}
              condition={b.condition}
              onConditionChange={(next) => b.setCondition(next as ConditionGrade)}
            />
          )}

          {!!b.sku.trim() && (
            <NotesCard
              notes={b.notes}
              showNotes={b.showNotes}
              accent={accent}
              onToggleNotes={() => b.setShowNotes(!b.showNotes)}
              onNotesChange={b.setNotes}
            />
          )}

          {showPreviewCard ? (
            <PreviewCardModern
              mode={mode}
              uniqueSku={b.uniqueSku || b.sku}
              title={b.title}
              serialNumbers={b.serialNumbers}
              condition={b.condition}
              color={b.color}
              location={b.location}
              accent={accent}
              dataMatrixValue={b.previewPayload.value}
              dataMatrixSymbology={b.previewPayload.symbology}
              onApplyAndPrint={(draft: ProductLabelDraft) => {
                b.setCondition(draft.condition as ConditionGrade);
                b.setColorOverride(draft.color);
                b.setTitle(draft.title);
                // Custom one-off print of the current preview with the chosen fields.
                printProductLabel({
                  sku: b.uniqueSku || b.sku,
                  title: draft.title,
                  qrPayload: b.previewPayload.value,
                  condition: draft.condition,
                  color: draft.color,
                });
              }}
            />
          ) : (
            <PreviewPlaceholder mode={mode} sku={b.sku} />
          )}
        </div>
      </div>

      {/* Floating action bar — same primitive as the receiving unbox bar. */}
      <StickyActionBar
        floating
        maxWidth="max-w-[720px]"
        primary={{
          label: primaryLabel,
          onClick: primaryAction,
          disabled: primaryDisabled,
          isLoading: b.isPosting,
          icon: <Check className="h-4 w-4" />,
          toneClasses: { bg: accent.ctaBg, hover: accent.ctaHover },
          tone: accent.tone,
        }}
      />
    </div>
  );
}
