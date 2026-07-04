'use client';

import { useState } from 'react';
import { IconButton } from '@/design-system/primitives';
import { Pencil } from '@/components/Icons';
import { LabelFacePreview } from '@/components/labels/LabelFacePreview';
import {
  ProductLabelEditPopover,
  type ProductLabelDraft,
} from '@/components/labels/ProductLabelEditPopover';
import { unitLabelToFace } from '@/lib/print/printProductLabel';

interface LabelPreviewCardProps {
  sku: string;
  /** Product title — fills the label's full top row. Falls back to the unit id when absent. */
  title?: string | null;
  /** @deprecated Use {@link title}. Kept for caller compatibility. */
  itemName?: string | null;
  /** @deprecated No longer rendered. */
  eyebrowLabel?: string;
  /** Condition grade rendered bottom-left — mirrors the printed label. */
  condition?: string | null;
  /** Product color rendered bottom-right — mirrors the printed label. */
  color?: string | null;
  /** Human serial — kept for caller compatibility; encoded in the DataMatrix, not shown on the face. */
  serialNumber?: string | null;
  dataMatrixValue: string;
  dataMatrixSymbology: 'gs1datamatrix' | 'datamatrix';
  heading?: string;
  /**
   * When provided, a pencil in the card header opens the {@link ProductLabelEditPopover}
   * to hand-edit the title / condition / color and print a custom label. The
   * callback receives the chosen draft so the page can persist + print.
   */
  onApplyAndPrint?: (draft: ProductLabelDraft) => void;
}

/**
 * Live preview of the printed product/unit label, shared by the testing and
 * products pages. A thin card around {@link LabelFacePreview}: maps the unit
 * fields onto the common {@link LabelFaceModel} via `unitLabelToFace` — the exact
 * model `printProductLabel` prints — so the preview and the sticker can't drift.
 * Pass `onApplyAndPrint` to surface the Edit-label pencil.
 */
export function LabelPreviewCard({
  sku,
  title,
  itemName,
  condition,
  color,
  dataMatrixValue,
  dataMatrixSymbology,
  heading = 'Live preview',
  onApplyAndPrint,
}: LabelPreviewCardProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const productTitle = (title ?? itemName ?? '').trim();
  const matrix = { value: dataMatrixValue, symbology: dataMatrixSymbology, scale: 4 } as const;
  const face = unitLabelToFace({ sku, title: productTitle, condition, color, matrix });

  return (
    <section className="rounded-2xl bg-surface-card p-5 shadow-sm ring-1 ring-border-soft/60">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-soft">
          {heading}
        </h3>
        {onApplyAndPrint ? (
          <IconButton
            icon={<Pencil className="h-4 w-4" />}
            ariaLabel="Edit label"
            title="Edit label — custom print"
            tone="accent"
            onClick={() => setEditorOpen(true)}
          />
        ) : null}
      </div>
      <div className="rounded border border-border-soft bg-surface-card px-2 py-2 shadow-sm">
        <LabelFacePreview model={face} embedded />
      </div>

      {onApplyAndPrint ? (
        <ProductLabelEditPopover
          open={editorOpen}
          defaults={{
            title: productTitle || sku,
            condition: (condition ?? '').trim(),
            color: (color ?? '').trim(),
          }}
          sku={sku}
          matrix={matrix}
          onApplyAndPrint={onApplyAndPrint}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
    </section>
  );
}
