'use client';

import { useMemo } from 'react';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { Pencil, Printer, X } from '@/components/Icons';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { ConditionPills } from '@/components/receiving/workspace/ConditionPills';
import { LabelFacePreview } from '@/components/labels/LabelFacePreview';
import { useLabelDraft } from '@/components/labels/useLabelDraft';
import { unitLabelToFace } from '@/lib/print/printProductLabel';
import type { LabelFaceModel } from '@/lib/print/labelFace';

/** The hand-editable product/unit label-face fields. */
export interface ProductLabelDraft {
  /** Full top-row title. */
  title: string;
  /** Bottom-left condition grade code. */
  condition: string;
  /** Bottom-right product color. */
  color: string;
}

const FIELD_LABEL = `${microBadge} mb-1.5 block text-gray-500 tracking-wider`;
const TEXT_INPUT =
  'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-label text-gray-900 outline-none transition-colors focus:border-blue-500';

/**
 * Custom-print editor for the product/unit (testing + products page) label.
 * Mirrors the receiving {@link LabelEditPopover} — same `RightPaneOverlay`
 * chrome, `ConditionPills`, live `LabelFacePreview`, and Save & print footer —
 * but for the product face: title (full top row), condition, and color. The
 * matrix is supplied by the caller (preview and print encode the same value),
 * so editing the text never touches the scannable code.
 */
export function ProductLabelEditPopover({
  open,
  defaults,
  sku,
  matrix,
  onApplyAndPrint,
  onClose,
}: {
  open: boolean;
  /** Seed values — re-read every time the popover opens. */
  defaults: ProductLabelDraft;
  sku: string;
  /** The DataMatrix the label encodes — rendered in the live preview as-is. */
  matrix: LabelFaceModel['matrix'];
  /** Apply the chosen fields + print. */
  onApplyAndPrint: (draft: ProductLabelDraft) => void;
  onClose: () => void;
}) {
  const { draft, set } = useLabelDraft<ProductLabelDraft>(defaults, open);

  const face = useMemo(
    () =>
      unitLabelToFace({
        sku,
        title: draft.title,
        condition: draft.condition,
        color: draft.color,
        matrix,
      }),
    [sku, draft.title, draft.condition, draft.color, matrix],
  );

  return (
    <RightPaneOverlay
      open={open}
      onClose={onClose}
      align="center"
      aria-label="Edit label"
      className="w-[min(94%,38rem)] rounded-2xl border-0 shadow-2xl ring-1 ring-gray-200"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3">
        <span className={`${microBadge} flex items-center gap-1.5 text-gray-700`}>
          <Pencil className="h-3.5 w-3.5 text-gray-500" />
          Edit label
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* Live preview — identical to the printed face. */}
        <div className="mb-4 rounded-xl border border-gray-200/80 bg-white px-3 py-3 shadow-sm">
          <LabelFacePreview model={face} embedded />
        </div>

        <div className="space-y-3.5">
          <div>
            <label className={FIELD_LABEL}>Title (top row)</label>
            <input
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Product title"
              className={TEXT_INPUT}
            />
          </div>

          <div>
            <label className={FIELD_LABEL}>Condition</label>
            <ConditionPills value={draft.condition} onChange={(g) => set('condition', g)} />
          </div>

          <div>
            <label className={FIELD_LABEL}>Color (bottom-right)</label>
            <input
              value={draft.color}
              onChange={(e) => set('color', e.target.value)}
              placeholder="e.g. Black"
              className={TEXT_INPUT}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-mini font-bold uppercase tracking-wider text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onApplyAndPrint(draft);
            onClose();
          }}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-mini font-bold uppercase tracking-wider text-white transition-colors hover:bg-blue-700"
        >
          <Printer className="h-3.5 w-3.5" />
          Save &amp; print
        </button>
      </div>
    </RightPaneOverlay>
  );
}
