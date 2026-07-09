'use client';

import { useState, type ReactNode } from 'react';
import { IconButton } from '@/design-system/primitives';
import { Pencil } from '@/components/Icons';
import { LabelFacePreview } from '@/components/labels/LabelFacePreview';
import {
  ProductLabelEditPopover,
  type ProductLabelDraft,
} from '@/components/labels/ProductLabelEditPopover';
import { unitLabelToFace } from '@/lib/print/printProductLabel';
import type { LabelFaceModel } from '@/lib/print/labelFace';

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
  /**
   * Replaces the top-left heading text with custom content (e.g. a label-type
   * dropdown that selects which label is queued for printing). Opt-in — callers
   * that don't pass it keep the plain `heading`.
   */
  headerLeft?: ReactNode;
  /**
   * Render THIS face instead of the built-in unit face (e.g. a carton label
   * selected from the header dropdown). When set, the unit edit-pencil is
   * suppressed — supply the label's own action via {@link headerAction}.
   */
  faceOverride?: LabelFaceModel | null;
  /**
   * When provided, the header pencil calls this instead of opening the built-in
   * unit editor — so a caller (e.g. the carton label) can open its OWN editor
   * popover. Keeps the same pencil → editor CTA across label types.
   */
  onEdit?: () => void;
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
  headerLeft,
  faceOverride,
  onEdit,
}: LabelPreviewCardProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const productTitle = (title ?? itemName ?? '').trim();
  const matrix = { value: dataMatrixValue, symbology: dataMatrixSymbology, scale: 4 } as const;
  // A face override (e.g. the carton label) wins over the built-in unit face.
  const face = faceOverride ?? unitLabelToFace({ sku, title: productTitle, condition, color, matrix });
  // Built-in unit editor: a unit face + an apply handler and no caller-owned editor.
  const builtInEditor = !faceOverride && Boolean(onApplyAndPrint);
  // The pencil shows whenever there's something to edit — a caller-owned editor
  // (onEdit, e.g. the carton label) or the built-in unit editor — so the CTA is
  // identical across label types.
  const canEdit = Boolean(onEdit) || builtInEditor;

  return (
    <section className="rounded-2xl bg-surface-card p-5 shadow-sm ring-1 ring-border-soft/60">
      <div className="mb-3 flex items-start justify-between gap-2">
        {headerLeft ?? (
          <h3 className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-soft">
            {heading}
          </h3>
        )}
        {canEdit ? (
          <IconButton
            icon={<Pencil className="h-4 w-4" />}
            ariaLabel="Edit label"
            title="Edit label — custom print"
            tone="accent"
            onClick={() => (onEdit ? onEdit() : setEditorOpen(true))}
          />
        ) : null}
      </div>
      {/* Themed frame; the label face inside is theme-aware (dark card + inverted
          barcode in dark mode). Print output stays black-on-white. */}
      <div className="rounded border border-border-soft bg-surface-card px-2 py-2 shadow-sm">
        <LabelFacePreview model={face} embedded />
      </div>

      {builtInEditor && !onEdit && onApplyAndPrint ? (
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
