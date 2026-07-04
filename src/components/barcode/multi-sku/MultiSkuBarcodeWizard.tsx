import { ModeSelector } from '@/components/barcode/ModeSelector';
import { SkuInput } from '@/components/barcode/SkuInput';
import { SerialNumberInput } from '@/components/barcode/SerialNumberInput';
import { BarcodePreview } from '@/components/barcode/BarcodePreview';
import { getSerialLast6 } from '@/utils/sku';
import type { MultiSkuBarcodeController } from './useMultiSkuBarcode';

/**
 * Narrow-column wizard layout (sidebar / mobile). Steps reveal one at a time;
 * the sidebar host owns the scroll container, so this adds no internal scroll.
 */
export function MultiSkuBarcodeWizard({ b }: { b: MultiSkuBarcodeController }) {
  const { mode } = b;
  const showSerialPanel = mode !== 'reprint' && b.step >= 2;
  const showPreviewPanel = b.step >= 3;

  return (
    <div className="flex min-w-0 flex-col bg-surface-card text-text-default">
      <ModeSelector mode={mode} onModeChange={b.handleModeChange} />

      <div className="min-w-0">
        <SkuInput
          sku={b.sku}
          uniqueSku={b.uniqueSku}
          mode={mode}
          skuInputRef={b.skuInputRef}
          isActive={b.step >= 1}
          density={b.density}
          onChange={b.handleSkuChange}
          onNext={b.handleNextStepSku}
          onFillAndSearch={b.handleSkuFillAndSearch}
        />

        {showSerialPanel ? (
          <SerialNumberInput
            sku={b.sku}
            mode={mode}
            title={b.title}
            stock={b.stock}
            snInput={b.snInput}
            serialNumbers={b.serialNumbers}
            location={b.location}
            currentLocation={b.currentLocation}
            snInputRef={b.snInputRef}
            isLoadingTitle={b.isLoadingTitle}
            isActive={b.step >= 2}
            showChangeSku={mode === 'print' && b.step === 2}
            density={b.density}
            imageUrl={b.imageUrl}
            onSnInputChange={b.handleSnInputChange}
            onSnAdd={b.handleSnAdd}
            onLocationChange={b.setLocation}
            onNext={b.handleNextStepSn}
            isPosting={b.isPosting}
            onChangeSku={b.handleChangeSku}
          />
        ) : null}

        {showPreviewPanel ? (
          <BarcodePreview
            mode={mode}
            uniqueSku={b.uniqueSku}
            sku={b.sku}
            title={b.title}
            serialNumbers={b.serialNumbers}
            notes={b.notes}
            location={b.location}
            showNotes={b.showNotes}
            dataMatrixValue={b.previewPayload.value}
            dataMatrixSymbology={b.previewPayload.symbology}
            isPosting={b.isPosting}
            isActive={b.step >= 3}
            density={b.density}
            getSerialLast6={getSerialLast6}
            onToggleNotes={() => b.setShowNotes(!b.showNotes)}
            onNotesChange={b.setNotes}
            onPrint={b.handleFinalAction}
          />
        ) : null}

        <div ref={b.bottomAnchorRef} aria-hidden />
      </div>
    </div>
  );
}
